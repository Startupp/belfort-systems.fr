# Espace Breteuil — application publique (V1)

Application installable (PWA) pour l'équipe du Château de Breteuil : le planning
partagé, une tuile par personne avec ses raccourcis Microsoft, et deux panneaux
de liens pour la direction (Administration) et la comptabilité (Finance).

Public visé : personnes **pas du tout techniques**. Grosses tuiles, gros textes,
français simple, navigation minimale (bouton « Retour » toujours en haut à gauche).

Adresse : **https://belfort-systems.fr/espace-breteuil/**

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
espace-breteuil/
  index.html            coquille (charge /assets/config.js, ics.js, app.js)
  app.js                l'application (écrans, navigation par #/…)
  app.css               styles (polices locales /assets/fonts, thème clair/sombre)
  ics.js                parseur ICS léger (navigateur + Node)
  personnes.json        tuiles par personne, liens, boîtes partagées   ← à éditer
  fiches.json           tuiles et fiches Administration / Finance       ← à éditer
  exemple.ics           planning FICTIF (affiché si le vrai n'est pas branché)
  manifest.webmanifest  + icones/   installation sur l'écran d'accueil
  sw.js                 service worker (hors ligne)
  tests/ics.test.mjs    tests du parseur

api/src/index.js        route GET /breteuil/planning.ics (Worker belfort-api)
```

Flux du planning :

```
Outlook (calendrier « Contact » publié en ICS)
   │  adresse secrète BRETEUIL_ICS_URL (jamais dans le dépôt)
   ▼
Worker belfort-api  GET /breteuil/planning.ics
   │  cache KV 10 min ; si Outlook ne répond pas → dernière version connue
   │  réservé aux pages de belfort-systems.fr (en-tête Origin vérifié, CORS)
   ▼
Espace Breteuil (navigateur)
   │  analyse l'ICS (ics.js), affiche Jour / Semaine / Mois / Liste
   │  garde une copie sur l'appareil (Cache API « eb-planning »)
   ▼
Hors ligne : dernière copie + bandeau « Pas de connexion »
Non configuré (503 non_configure) : exemple.ics + bandeau « EXEMPLE »
```

Écrans : `#/` accueil · `#/planning` (et `#/planning/<id>` filtré pour une
personne) · `#/personne/<id>` « Mon espace » · `#/admin`, `#/finance` et
`#/admin/fiche/<id>` · `#/reglages` · `#/installer`.

Aucun compte, aucune connexion côté Espace Breteuil : les tuiles sont de simples
liens. La connexion se fait chez Microsoft quand on ouvre un lien.

## Brancher le vrai planning (à faire par Damien)

1. Dans Outlook (web) connecté à la boîte **contact@** : Paramètres → Calendrier →
   Calendriers partagés → **Publier un calendrier** → choisir le calendrier,
   « Peut afficher tous les détails » (ou « titres et lieux » si l'on veut moins
   de détails) → Publier → copier le lien **ICS**.
2. Poser le secret sur le Worker (le lien ne doit jamais être écrit dans le dépôt) :

   ```bash
   cd api
   npx wrangler secret put BRETEUIL_ICS_URL
   # coller le lien ICS (https://outlook.office365.com/owa/calendar/…/calendar.ics)
   ```

   Un lien `webcal://` est accepté (converti en `https://`).
3. Déployer le Worker : fusionner la PR (le workflow `deploy-worker.yml` se lance
   car `api/**` change) ou `cd api && npx wrangler deploy`.
   Le secret est conservé d'un déploiement à l'autre.
4. Vérifier : ouvrir l'Espace Breteuil → le bandeau jaune « EXEMPLE » disparaît.
   En ligne de commande :
   `curl -i -H "Origin: https://belfort-systems.fr" https://belfort-api.damien-belfort.workers.dev/breteuil/planning.ics`
   → `200`, `Content-Type: text/calendar`, `X-Planning-Etat: source` puis `cache`.

> Le lien ICS publié est lisible par quiconque le connaît : c'est pour ça qu'il
> reste un secret du Worker. Le relais n'ajoute pas de vraie protection (l'en-tête
> `Origin` se falsifie) : ne publiez dans ce calendrier que ce que toute l'équipe
> peut voir. Pour revenir en arrière : « Annuler la publication » dans Outlook.

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

## Limites connues (V1)

- **Récurrences** : gérées — FREQ=DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT,
  UNTIL, BYDAY (hebdo ; mensuel « 1er lundi », « dernier vendredi »), BYMONTHDAY,
  EXDATE, occurrences déplacées (RECURRENCE-ID), annulées (STATUS:CANCELLED).
  Ignorées : BYSETPOS, BYWEEKNO, BYYEARDAY, BYHOUR, RDATE ; YEARLY+BYMONTH ne
  garde que le mois de départ. Cas rares dans un agenda de bureau.
- **Fuseaux** : IANA et noms Windows d'Outlook (« Romance Standard Time »…) ;
  un fuseau inconnu est lu comme Europe/Paris. Tout est affiché à l'heure de Paris.
- « Mon planning » repose sur des **mots-clés** (pas sur les participants : le
  calendrier publié par Outlook ne les contient pas).
- Les liens « Dans l'appli » (ms-outlook://…) n'apparaissent que sur téléphone et
  ne marchent que si l'appli Microsoft est installée.
- Pas de notification ni de rappel.
- Fenêtre de calcul : chaque vue développe uniquement la période affichée ;
  une récurrence très ancienne (plus de 5 000 périodes) est tronquée.

## Phase 2 (prévue, non faite)

1. **Connexion Microsoft Entra ID** (MSAL.js, application « SPA » inscrite dans le
   tenant du Château, consentement administrateur) : l'appli sait qui est
   connecté → plus besoin de choisir sa tuile, plus de code d'écran.
2. **Microsoft Graph** via le Worker (jetons jamais stockés dans le dépôt) :
   - licences en direct (`/subscribedSkus`, `/users?$select=assignedLicenses`) ;
   - boîtes partagées accessibles réellement par la personne ;
   - son vrai agenda et le calendrier Contact (`/users/{id}/calendarView`) au lieu
     de l'ICS publié — plus besoin de lien public ;
   - factures et abonnements (API Billing / Commerce, rôle Administrateur de
     facturation) affichés dans le pack Finance.
3. **Rôles** : direction (Administration + Finance), finance, équipe, saisonniers ;
   menus construits à partir des groupes Entra.
4. Actions simples sans passer par le centre d'admin (débloquer un compte,
   ajouter un membre à une boîte partagée), toutes journalisées dans D1.

## Checklist de test

Automatique :

- [ ] `node --test espace-breteuil/tests/ics.test.mjs` → 10 tests OK
- [ ] `cd api && npm test` → tests du Worker OK (dont 4 pour le planning)

À la main (téléphone + ordinateur) :

- [ ] Ouvrir `/espace-breteuil/` : aucune demande de connexion ; bandeau
      « EXEMPLE » tant que le secret n'est pas posé.
- [ ] Installer : iPhone (Safari → Partager → Sur l'écran d'accueil), Android
      (Chrome → Installer l'application), ordinateur (Chrome/Edge, icône dans la
      barre d'adresse). L'icône château apparaît, l'appli s'ouvre en plein écran.
- [ ] Planning : Jour / Semaine / Mois / Liste, flèches, « Aujourd'hui », toucher
      un rendez-vous ouvre le détail, « Fermer » le referme.
- [ ] Après `wrangler secret put BRETEUIL_ICS_URL` + déploiement : les vrais
      rendez-vous apparaissent, heures justes (comparer avec Outlook, y compris
      un rendez-vous récurrent et un sur la journée).
- [ ] Mode avion : l'appli s'ouvre, le planning affiche « Pas de connexion » et la
      dernière version.
- [ ] Tuile d'une personne : raccourcis (Outlook web, OneDrive, Commun), boîtes
      partagées, « Mon planning » filtré, « Ouvrir mon espace au démarrage ».
- [ ] Tuile « Visiteur » : ouvre directement le planning.
- [ ] Administration / Finance : mauvais code refusé, bon code accepté, cadenas
      pour reverrouiller ; chaque tuile ouvre la bonne page Microsoft (vérifier
      les liens profonds) ; fiches lisibles.
- [ ] Réglages : texte très grand, thème sombre, masquer les événements passés,
      vue par défaut — conservés après fermeture de l'appli.
- [ ] Largeur 375 px : aucun défilement horizontal.
