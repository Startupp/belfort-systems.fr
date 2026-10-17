# Espace Breteuil — application (V2)

Application installable (PWA) pour l'équipe du Château de Breteuil, **sur mobile
d'abord**. Elle s'adresse à des personnes qui ne sont pas du tout techniques :

- gros boutons ;
- un pictogramme et une phrase par action ;
- une barre d'onglets en bas de l'écran ;
- une confirmation en 2 étapes avant chaque changement.

Adresses :

- `/espace-breteuil/` sur belfort-systems.fr ;
- un projet Cloudflare Pages séparé pour la version connectée
  (voir **[ESPACE-BRETEUIL-CONNEXION.md](ESPACE-BRETEUIL-CONNEXION.md)**).

## Ce qui est réel, ce qui est démo

| Fonction | Sans connexion | Connecté à Microsoft (Pauline, François) |
|---|---|---|
| Planning (plusieurs calendriers colorés), « Aujourd'hui au Château » | **Réel** (calendriers publiés en ICS, relayés par le Worker) ; exemple fictif tant que non branché | idem |
| Dossier commun : naviguer, créer (dans Commun ou juste au-dessus), renommer, déplacer | — | **Réel** (Graph, délégué) |
| Qui a accès : hérité / personnalisé, « Partager uniquement avec… », ajouter, retirer, rétablir | — | **Réel** (REST SharePoint, délégué) |
| Personnes, « Ce que je peux utiliser », licences, étiquette **EXTERNE** | — | **Réel** (lecture seule) |
| Comprendre l'organisation | Exemple fictif | **Réel** |
| Gestion du Château et Finance (équipe, rôles, boîtes, arrivées, départs, absences, factures…) | **Démo** (données fictives, pastille « Démo ») | Démo |

Règle « Externe » : **toute personne sans adresse @breteuil.fr est considérée comme
externe**. Une seule étiquette, en gras, qui s'explique au toucher. Il n'y a rien à
configurer.

## Choix du chemin

L'application est servie sous **`/espace-breteuil/`**.

Le dossier `clients/chateau-de-breteuil/` existe déjà : c'est l'espace client
**chiffré** (mot de passe, documents de migration, démo chiffrée dans `demo/`).
L'Espace Breteuil, lui, doit être **public et installable sans connexion** : le
mélanger avec un dossier chiffré (et son propre service worker de portée `./`)
aurait créé des conflits de cache et de portée. Il a donc son propre dossier,
sa propre portée de service worker et son propre manifeste. Rien de l'existant
n'est modifié (seul ajout hors du dossier : une route dans le Worker).

## Architecture

```
espace-breteuil/            ← autonome : peut être servi tel quel sur un autre domaine
  index.html                coquille (aucun script en ligne : CSP stricte possible)
  prechargement.js          thème et taille du texte avant le 1er affichage
  version.js                NUMÉRO DE VERSION (à incrémenter à chaque publication)
  config.js                 Worker, calendriers, connexion Microsoft, site SharePoint (aucun secret)
  app.js                    cœur : planning, Aujourd'hui, accueil, réglages, onglets, mises à jour
  connecte.js               écrans connectés (dossier commun, accès, personnes, organisation)
  graph.js                  MSAL (jetons en mémoire), Graph, REST SharePoint, mode maquette local
  droits.js                 traduction en clair : niveaux, Externe, licences, garde-fous (testé)
  resume.js                 « Aujourd'hui au Château » : lecture des titres de l'accueil (testé)
  ics.js                    parseur ICS (testé)
  demo.js                   données fictives des écrans de démo (testé)
  personnes.json, fiches.json, exemple.ics, exemple-accueil.ics
  _headers                  en-têtes de sécurité Cloudflare Pages (CSP, pas d'iframe, HSTS…)
  sw.js, manifest.webmanifest, icones/, polices/, vendor/msal-browser-3.30.0.min.js (MIT)
  tests/                    node --test espace-breteuil/tests/*.test.mjs

api/src/index.js            GET /breteuil/planning.ics, /breteuil/planning/:n.ics, /breteuil/sources
```

MSAL est livré dans le dépôt (version figée, SHA-256
`273d446b381814e563442267a072904fb3b7fd0164f4a688ede80f0d74565b3e`) et non chargé depuis un
CDN, pour que la CSP puisse s'en tenir à `script-src 'self'`.


## Brancher les calendriers (à faire par Damien)

L'accueil (Fanny) tient déjà chaque jour un calendrier d'équipe. Avant, c'était un Google
Agenda ; c'est peut-être aujourd'hui le calendrier Outlook de contact@. L'appli **lit ce
calendrier tel quel** et ne demande aucun travail en plus. Chaque source a sa couleur
(`config.js` → `calendriers`) et son secret dans le Worker :

| Source | Secret du Worker | Exemple affiché tant qu'il est vide |
|---|---|---|
| 1 — Calendrier du Château (Outlook contact@) | `BRETEUIL_ICS_URL` | `exemple.ics` |
| 2 — Équipe du jour (calendrier de l'accueil) | `BRETEUIL_ICS_URL_2` | `exemple-accueil.ics` |
| 3, 4 — au besoin | `BRETEUIL_ICS_URL_3`, `_4` | — |

```bash
cd api
npx wrangler secret put BRETEUIL_ICS_URL      # coller l'adresse ICS Outlook
npx wrangler secret put BRETEUIL_ICS_URL_2    # coller l'adresse ICS secrète Google (ou Outlook)
```

**Adresse ICS d'un calendrier Outlook** : Outlook web connecté à la boîte → Paramètres →
Calendrier → Calendriers partagés → **Publier un calendrier** → choisir le calendrier,
« Peut afficher tous les détails » → Publier → copier le lien **ICS**.

**Adresse ICS secrète d'un Google Agenda** (à faire par la personne propriétaire de
l'agenda, sur ordinateur) :

1. <https://calendar.google.com> → à gauche, survoler l'agenda → **⋮** →
   **Paramètres et partage**.
2. Descendre jusqu'à **Intégrer l'agenda** → **Adresse secrète au format iCal**. Elle se
   termine par `/private-…/basic.ics`.
3. Cliquer sur **Copier**. Ne jamais la mettre dans le dépôt ni l'envoyer par mail :
   elle donne accès à tout l'agenda. La coller directement dans
   `wrangler secret put BRETEUIL_ICS_URL_2`.
4. Pour la changer (fuite, départ) : même écran → **Réinitialiser**, puis remettre la
   nouvelle adresse dans le secret.

Google ne met à jour son fichier ICS qu'environ toutes les heures. Le Worker garde un
cache de 10 min.

**« Aujourd'hui au Château »** classe les événements du jour d'après leur titre (sans
accents ni majuscules) :

- « absent », « malade », « repos », « récup » → **Absents** ;
- « congé », « vacances », « CP », « RTT » → **En congé** ;
- « télétravail », « TT » → **Télétravail** ;
- « permanence », « présent » → **De permanence** ;
- le reste → **Rendez-vous** (avec une heure) ou **À savoir** (journée entière).

Le prénom est reconnu tel qu'il figure dans `personnes.json` (« Valérie D. » ou
« Valérie L. » : en cas de doute, personne n'est reconnu plutôt que la mauvaise personne).
**Rien n'est demandé à l'accueil** : il suffit d'écrire « Marco absent » comme d'habitude.

Vérification :
`curl -i -H "Origin: https://belfort-systems.fr" https://belfort-api.damien-belfort.workers.dev/breteuil/sources`
→ `{"ok":true,"sources":[1,2]}`. Les adresses ne sont jamais renvoyées.

> Le relais n'ajoute pas de vraie protection (l'en-tête `Origin` se falsifie). Il ne faut
> mettre dans ces calendriers que ce que toute l'équipe peut voir.

## Mises à jour : publier une nouvelle version

1. Modifier les fichiers de `espace-breteuil/`.
2. **Incrémenter `espace-breteuil/version.js`** (par exemple `2.0.0` → `2.0.1`).
   C'est obligatoire : c'est ce changement que le service worker détecte.
3. Si un **nouveau fichier** est ajouté, l'ajouter aussi à la liste `COQUILLE` de `sw.js`
   (fonctionnement hors ligne).
4. Publier (fusion ou push sur la branche suivie par Pages).

Côté utilisateurs :

- l'appli vérifie les mises à jour à l'ouverture, au retour sur l'appli (toutes les
  30 min au plus) et toutes les heures ;
- une version prête **pendant l'utilisation** affiche le bandeau « ✨ Nouvelle version
  disponible — Mettre à jour » (un toucher = rechargement) ;
- une version prête **au lancement** s'installe d'elle-même, sauf si l'utilisateur est en
  train de saisir quelque chose ;
- le numéro est visible dans **Réglages** (bouton « Rechercher une mise à jour »).


## Éditer `personnes.json`

Fichier JSON simple, modifiable directement sur GitHub (crayon « Edit »).
Après modification : vérifier qu'il reste valide (par exemple sur jsonlint.com).

- **`liens`** : les raccourcis réutilisables. Chaque lien a `titre`, `texte`,
  `icone`, `url`, et facultativement `appli` (ouverture dans l'appli Microsoft
  sur téléphone : `ms-outlook://`, `ms-onedrive://`, `msteams://`).
  ⚠ L'adresse du **Dossier Commun** (`commun`) est supposée :
  `https://breteuil02.sharepoint.com/sites/Commun` — **à vérifier** et corriger.
- **`boitesPartagees`** : `nom` et `adresse` de chaque boîte partagée. La tuile
  ouvre `https://outlook.office.com/mail/<adresse>/` (la personne doit avoir
  l'accès dans Microsoft 365, sinon Outlook l'indique).
- **`personnes`** : une entrée par tuile, dans l'ordre d'affichage.

| Champ | Exemple | Rôle |
|---|---|---|
| `id` | `"yara"` | identifiant dans l'adresse (minuscules, sans espace) |
| `prenom` | `"Yara"` | **prénom seulement** (dépôt public) |
| `role` | `"Restauration"` | sous-titre de la tuile |
| `icone` | `"couverts"` | voir la liste ci-dessous |
| `couleur` | `"#7A3E8E"` | couleur de la pastille |
| `motsCles` | `["Yara", "Restauration"]` | « Mon planning » : événements dont le titre, le lieu ou la description contient l'un de ces mots (sans tenir compte des accents ni des majuscules) |
| `raccourcis` | `["mail", "agenda", "commun"]` | clés de `liens` |
| `boites` | `["restauration"]` | clés de `boitesPartagees` (accès supposés, **à vérifier**) |
| `packs` | `["admin", "finance"]` | tuiles vers les panneaux Administration / Finance |

Icônes disponibles : `agenda mail nuage dossier bulles grille couronne euro
megaphone accueil couverts feuille personne personnes cle badge boite facture
carte panier horloge moins arrivee depart reglages info cadenas`.

Pour que « Mon planning » marche bien, une règle simple pour l'équipe : **mettre
le prénom ou le pôle dans le titre** des rendez-vous du calendrier Contact
(ex. « Restauration : livraison traiteur »).

## Panneaux Administration et Finance (`fiches.json`)

- `tuiles` : liens profonds vers le centre d'administration Microsoft 365.
- `fiches` : « comment faire » en 3 étapes (`etapes`), un bouton (`lien`) et une
  `note`.
- `codeEmpreinte` : empreinte SHA-256 du code d'écran. Code par défaut communiqué
  par Damien ; **à changer avant de diffuser** :

  ```bash
  printf 'espace-breteuil:MON-NOUVEAU-CODE' | sha256sum
  ```

  Coller le résultat (64 caractères) dans `codeEmpreinte` (admin et/ou finance).
  Changer le code reverrouille les appareils déjà ouverts.

> **Ce code n'est PAS une sécurité.** Il masque seulement l'écran aux curieux
> (le contenu de `fiches.json` est public, comme tout le dépôt). Il ne contient
> que des liens et des procédures. La vraie sécurité, c'est la connexion
> Microsoft : sans compte administrateur (ou « Administrateur de facturation »
> pour Valérie D.), les liens n'affichent rien.

Les liens profonds `admin.microsoft.com/Adminportal/Home#/…` (users, licenses,
SharedMailbox, groups, billoverview, subscriptions, catalog, BillingNotifications)
sont ceux en usage à l'écriture : Microsoft les change parfois. Si une tuile
tombe sur l'accueil de l'admin, corriger l'adresse dans `fiches.json`.

## Réglages mémorisés sur l'appareil

`localStorage` (lu et écrit dans des `try/catch` ; en navigation privée, l'appli
marche avec les réglages par défaut) :

- `eb:reglages` : vue du planning au départ, taille du texte (normal / grand /
  très grand), thème (auto / clair / sombre), événements passés (afficher /
  masquer), espace ouvert au démarrage ;
- `eb:ouvert:admin`, `eb:ouvert:finance` : écran déverrouillé sur cet appareil.

## Mode « calendrier seul »

**Réglages → Mode « calendrier seul » → Activé.** Ensuite, chaque ouverture affiche
directement le planning en plein écran, avec seulement le choix de la vue, les flèches et
« Aujourd'hui ». Le petit lien « Revenir à l'appli complète », en bas, désactive ce mode
après une confirmation. *(Le pointage des présences a été retiré à la demande de Damien.)*

## Limites connues

- **Récurrences ICS** gérées :
  - FREQ, INTERVAL, COUNT, UNTIL ;
  - BYDAY, y compris en mensuel (« 1er lundi », « dernier vendredi ») ;
  - BYMONTHDAY, EXDATE, RECURRENCE-ID, STATUS:CANCELLED.

  Ignorées : BYSETPOS, BYWEEKNO, BYYEARDAY, BYHOUR, RDATE.
- **Fuseaux** : noms IANA et noms Windows d'Outlook. Un fuseau inconnu est lu comme
  Europe/Paris.
- **« Mon planning »** et « Aujourd'hui » reposent sur les **titres** des événements.
  Le calendrier publié ne contient pas les participants.
- **Version connectée** : jetons en mémoire, donc il faut se reconnecter à chaque
  ouverture. Pas de suppression de dossier dans l'appli (volontairement).
- **Boîtes partagées** : Microsoft Graph délégué ne dit pas **qui** peut ouvrir une boîte
  partagée, et ne permet pas d'en changer la **photo** (c'est du ressort d'Exchange). Ces
  écrans restent en démo.

## Feuille de route : version connectée

| Fonction | Faisable en Graph / SharePoint **délégué** (comme aujourd'hui) | Demande une **brique serveur** |
|---|---|---|
| Dossier commun, droits des dossiers | ✅ fait (Graph + REST SharePoint) | — |
| Personnes, licences (lecture), rôles d'administration (lecture) | ✅ fait | — |
| Attribuer ou retirer une licence | Graph `assignLicense` (User.ReadWrite.All) | — |
| Créer ou bloquer un compte, réinitialiser un mot de passe | Graph (User.ReadWrite.All, rôle Administrateur des utilisateurs) | — |
| Groupes et équipes (membres) | Graph (GroupMember.ReadWrite.All) | — |
| Double authentification : qui l'a activée | Graph `authentication/methods` (UserAuthenticationMethod.Read.All) | — |
| Boîtes partagées : qui y a accès, « envoyer au nom de », photo de la boîte | ✗ | Exchange Online PowerShell / API Exchange, via le Worker avec une identité d'application (certificat) et un journal d'audit |
| Factures, moyens de paiement | Lecture partielle (API Billing) | Changement de moyen de paiement : centre d'administration seulement |
| Absences partagées entre téléphones | Un calendrier Outlook dédié (Calendars.ReadWrite) | ou D1 via le Worker, avec validation du jeton Entra |

Pour toute écriture côté serveur : le Worker valide le jeton Entra (signature JWKS,
audience, rôle), journalise dans D1 et n'ouvre **aucune** écriture publique non
authentifiée.


## Checklist de test

Automatique :

- [ ] `for f in espace-breteuil/tests/*.test.mjs; do node --test "$f"; done` : parseur ICS,
      démo, « Aujourd'hui », droits, tous verts
- [ ] `cd api && npm test` → 14/14, dont 5 pour le relais des calendriers

Version connectée : voir la checklist de [ESPACE-BRETEUIL-CONNEXION.md](ESPACE-BRETEUIL-CONNEXION.md).

À la main (téléphone + ordinateur) :

- [ ] Ouvrir l'appli : aucune demande de connexion. Barre d'onglets en bas (Accueil,
      Aujourd'hui, Planning, Château, Réglages).
- [ ] Installer sur l'écran d'accueil (iPhone, Android, ordinateur).
- [ ] « Aujourd'hui au Château » : absents, congés et télétravail avec les visages,
      rendez-vous du jour, couleurs par calendrier.
- [ ] Planning : Jour / Semaine / Mois / Liste, « Aujourd'hui », détail d'un rendez-vous.
- [ ] Mode avion : dernière version enregistrée, bandeau « Pas de connexion ».
- [ ] Réglages : texte très grand, thème sombre, mode calendrier seul (activer, rouvrir
      l'appli, revenir).
- [ ] Mise à jour : changer `version.js`, publier, rouvrir l'appli → nouvelle version
      active ; appli ouverte pendant la publication → bandeau « Mettre à jour ».
- [ ] Largeur 375 px : pas de défilement horizontal, boutons ≥ 44 px.
