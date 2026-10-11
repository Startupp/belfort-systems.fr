# Tableau de bord Belfort Systems — architecture (v1, octobre 2026)

Ce document est le contrat commun des trois chantiers : `api/` (service Cloudflare), `admin/` (panneau privé de Damien) et le site public (`index.html`, `assets/`). Les agents qui travaillent sur un chantier ne modifient pas les fichiers des autres.

## 1. Vue d'ensemble

```
belfort-systems.fr (GitHub Pages, statique)          Cloudflare (compte damien-belfort)
├── /               site public + simulateur + contact ──► Worker « belfort-api »
├── /qui-suis-je/   page « Qui suis-je »                    https://belfort-api.damien-belfort.workers.dev
├── /admin/         panneau privé (mot de passe)   ◄──────  ├── D1  belfort-systems  (66de32b0-01d9-4f8e-a909-05598f941e41)
├── /clients/<slug>/ outils déployés par client    ──►      └── KV  belfort-sessions (24f34957a1644d729c773708e6e05088)
└── /factures/      (ancien générateur chiffré, conservé tel quel)
```

- Le site reste statique : tout ce qui doit être **reçu, stocké ou partagé** passe par l'API.
- Déploiement du Worker : workflow `.github/workflows/deploy-worker.yml` (wrangler-action) sur push `main` quand `api/**` change. Secrets GitHub à créer par Damien : `CLOUDFLARE_API_TOKEN` (modèle « Edit Cloudflare Workers » + D1 Edit + KV Edit), `CLOUDFLARE_ACCOUNT_ID`, `ADMIN_PASSWORD` (mot de passe du panneau, transmis au Worker comme secret). Aucun secret dans le dépôt, jamais.
- Base URL de l'API côté pages : `window.BS_API = "https://belfort-api.damien-belfort.workers.dev"` défini dans `assets/config.js` (un seul endroit).

## 2. Sécurité (non négociable)

- Mot de passe admin : secret Worker `ADMIN_PASSWORD`. Comparaison à temps constant après PBKDF2-SHA256 (100 000 itérations, sel fixe par déploiement dérivé du secret `SESSION_SALT` ou, à défaut, de `ADMIN_PASSWORD`). Jamais renvoyé, jamais loggé.
- Limitation : 5 tentatives de connexion par IP et par 15 minutes (KV, TTL), puis 429 avec délai.
- Session : jeton aléatoire 32 octets (base64url) stocké dans KV `s:<jeton>` → `{role:"admin", exp}` TTL 12 h, renvoyé dans le corps JSON ; le navigateur le garde en `sessionStorage` (jamais en localStorage) et l'envoie en `Authorization: Bearer`. Déconnexion = suppression de la clé.
- Jetons clients : chaque client a un `token` (32 octets) stocké **haché** (SHA-256) dans D1 ; le clair n'est montré qu'une fois à la création. Les outils déployés (ex. l'application Breteuil) l'enverront en `Authorization: Bearer` pour `/client/*`.
- CORS : origine `https://belfort-systems.fr` uniquement (+ `http://localhost:*` en dev). Méthodes GET/POST/PATCH/DELETE. Pas de cookies.
- Entrées : taille max 32 Ko par corps, champs validés (types, longueurs), HTML échappé à l'affichage côté pages (jamais `innerHTML` avec une donnée brute).
- Formulaire public `/contact` : champ pot-de-miel `website` (doit rester vide), délai minimal 3 s entre affichage et envoi (champ `t`), 10 envois par IP et par heure, e-mail validé, longueur max 4 000 caractères. Prévoir le branchement Turnstile plus tard (clé publique dans `assets/config.js`, vide = désactivé).
- En-têtes de réponse : `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.
- Aucune donnée bancaire, aucun mot de passe de client stocké nulle part. Les factures ne contiennent pas d'IBAN par défaut (champ optionnel saisi à chaque fois, jamais stocké).

## 3. Base D1 — schéma (`api/schema.sql`)

```sql
clients(id TEXT PK, slug TEXT UNIQUE, nom TEXT, contact TEXT, email TEXT, token_hash TEXT, cree TEXT)
projets(id TEXT PK, client_id TEXT, titre TEXT, statut TEXT, resume TEXT, cree TEXT, maj TEXT)
demandes(id TEXT PK, projet_id TEXT, n INTEGER, groupe TEXT, titre TEXT, qui TEXT, date_txt TEXT, statut TEXT,
         tarif TEXT, livre TEXT, reste TEXT, solution TEXT, motif TEXT, cree TEXT, maj TEXT)
  -- statut ∈ nouveau|lu|en_cours|repondu|traite|abandonne|partiel ; tarif ∈ forfait|extra|offert|devis
evenements(id TEXT PK, projet_id TEXT, date TEXT, type TEXT, titre TEXT, detail TEXT)
  -- type ∈ echange|livrable|site|decision|facture
conversations(id TEXT PK, projet_id TEXT, canal TEXT, titre TEXT, participants TEXT, maj TEXT)
messages(id TEXT PK, conversation_id TEXT, demande_id TEXT NULL, de TEXT, date TEXT, texte TEXT, piece TEXT NULL)
fichiers(id TEXT PK, projet_id TEXT, nom TEXT, type TEXT, taille INTEGER, url TEXT, note TEXT, cree TEXT)
  -- métadonnées seulement (les fichiers restent sur GitHub Pages / OneDrive / lien)
contacts(id TEXT PK, nom TEXT, email TEXT, tel TEXT, sujet TEXT, message TEXT, formule TEXT NULL, creneau TEXT NULL,
         statut TEXT, ip_hash TEXT, cree TEXT)   -- statut ∈ nouveau|lu|repondu|archive
rdv(id TEXT PK, contact_id TEXT NULL, debut TEXT, fin TEXT, statut TEXT, note TEXT)  -- créneaux proposés / confirmés
factures(id TEXT PK, numero TEXT UNIQUE, client_id TEXT, date TEXT, echeance TEXT, lignes TEXT /*JSON*/,
         total_ht REAL, tva INTEGER /*0 = franchise*/, statut TEXT, note TEXT, cree TEXT, maj TEXT)
  -- statut ∈ brouillon|envoyee|payee|annulee ; numérotation continue BS-AAAA-NNN attribuée à l'envoi, jamais réutilisée
compteurs(cle TEXT PK, valeur INTEGER)
journal(id INTEGER PK AUTOINCREMENT, quand TEXT, qui TEXT, action TEXT, cible TEXT)  -- piste d'audit
```

## 4. API — routes (`api/src/index.js`, sans dépendance)

Public (sans jeton) :
- `POST /contact` → crée `contacts` (et `rdv` si créneau) ; réponse `{ok:true}`.
- `GET /disponibilites?semaine=AAAA-WW` → créneaux libres (règle simple : jours ouvrés 9h-12h / 14h-18h moins les `rdv` confirmés).
- `GET /catalogue` → renvoie `assets/catalogue.json` mis en cache (facultatif ; le site peut le lire en statique).

Admin (`Authorization: Bearer <session>`) :
- `POST /admin/login {password}` → `{token, exp}` ; `POST /admin/logout`.
- `GET /admin/resume` → compteurs (contacts nouveaux, demandes à traiter, factures en attente, dernier événement).
- `GET /admin/contacts?statut=` ; `PATCH /admin/contacts/:id {statut}`.
- `GET /admin/projets` ; `GET /admin/projets/:id` → projet + demandes + evenements + conversations + fichiers.
- `POST /admin/projets` ; `PATCH /admin/projets/:id`.
- `POST /admin/demandes` ; `PATCH /admin/demandes/:id` (statut, solution, motif, reste…) ; actions : `traiter`, `fait` (solution obligatoire), `abandonner` (motif obligatoire), `rouvrir`.
- `POST /admin/evenements` ; `PATCH` ; `DELETE`.
- `POST /admin/conversations` ; `POST /admin/messages`.
- `POST /admin/fichiers` ; `DELETE`.
- `GET /admin/factures` ; `POST /admin/factures` (brouillon) ; `PATCH /admin/factures/:id` ; `POST /admin/factures/:id/emettre` (attribue le numéro, verrouille) ; `POST /admin/factures/:id/payee`.
- `GET /admin/clients` ; `POST /admin/clients` → renvoie le jeton en clair UNE fois ; `POST /admin/clients/:id/regenerer`.
- `GET /admin/journal?limit=`.
- `GET /admin/flux` → **Server-Sent Events** : un événement `maj` `{table, id, quand}` à chaque écriture (diffusion simple : le Worker relit `journal` toutes les 3 s pendant la connexion, 25 min max, le navigateur se reconnecte). Repli : les pages re-interrogent toutes les 15 s si SSE indisponible.

Client (`Authorization: Bearer <jeton client>`) :
- `GET /client/moi` → client + projets.
- `GET /client/demandes` ; `POST /client/demandes` (nouvelle demande depuis un outil déployé) ; `POST /client/demandes/:id/messages` ; `POST /client/demandes/:id/encore` (« ça ne marche toujours pas »).
- `GET /client/evenements`.

Toute réponse d'erreur : `{ok:false, erreur:"phrase en français"}` avec le bon code HTTP.

## 5. Données de départ (`api/seed/`)

- Client `breteuil` (Château de Breteuil, contact Pauline de Breteuil, e-mail finance@breteuil.fr à confirmer).
- Projet `breteuil-migration` « Migration de la messagerie et prise en main » : les 49 demandes et 36 événements du suivi actuel (copies JSON dans `api/seed/demandes/*.json` et `api/seed/evenements/*.json`, même format que l'artefact de suivi : `n,g,t,who,d,s,p,l,r,c[]`) ; chaque entrée `c[]` d'une demande devient un message de la conversation du canal correspondant (Mail / WhatsApp / SMS / Téléphone / Sur place) et un rattachement `demande_id`.
- `api/seed/importer.mjs` : transforme ces JSON en `api/seed/seed.sql` (idempotent, `INSERT OR IGNORE`). L'import en production se fait par le workflow (`wrangler d1 execute belfort-systems --remote --file=api/seed/seed.sql`) seulement au premier déploiement (étape manuelle `workflow_dispatch` avec case « seed »).

## 6. Pages

- `admin/index.html` + `admin/admin.css` + `admin/admin.js` (les anciens `assets/admin.js`, `assets/portal.css` ne servent plus qu'au portail ; ne pas les casser).
- Le panneau lit `assets/config.js` ; sans API joignable il affiche un bandeau « Service injoignable » et des données d'exemple en lecture seule (mode démonstration), pour que la page reste utilisable et testable hors ligne.
- Mode « aperçu avant action » partout : toute écriture (statut, facture, suppression) montre un récapitulatif et demande une confirmation ; les factures ont une prévisualisation fidèle (A4) avant émission et un bouton « Télécharger le PDF » (impression navigateur avec feuille de style `@page A4`).
- Facture : mentions obligatoires micro-entreprise : nom, adresse (7 square des Genêts, 78114 Magny-les-Hameaux), SIRET 894 449 032 00024, « TVA non applicable, art. 293 B du CGI », numéro continu, date, date d'échéance, pénalités de retard et indemnité forfaitaire 40 €, désignation, quantité, prix unitaire, total ; mention « Dispensé d'immatriculation au RCS et au RM » n'est plus exigée depuis 2023 — ne pas l'inscrire.
- Tarif de référence : 35 € HT l'heure (hors taxes = net, franchise de TVA). Le catalogue (`assets/catalogue.json`) est la seule source des prix : simulateur, factures et devis le lisent.
