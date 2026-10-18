# Espace Breteuil — application (v4.0.0)

Application installable (PWA) pour l'équipe du Château de Breteuil, **sur mobile d'abord**,
branchée sur le vrai tenant Microsoft. Pour des personnes non techniques : écrans courts,
cibles tactiles d'au moins 44 px, confirmation avant chaque changement.

## Ce que voit chacun (v4 : selon les DROITS RÉELS)

**Pas connecté (première ouverture)** : seulement 2 gros boutons.

- **Voir le calendrier** : le planning seul, mémorisé sur l'appareil, avec un petit lien
  « Revenir à l'accueil ».
- **Se connecter** : connexion Microsoft par redirection pleine page.

**Connecté** : l'appli lit en arrière-plan, en parallèle, ce que la personne peut faire
(`acces.js`, logique pure et testée dans `profil.js`) :

| Information | Appel | Sert à |
|---|---|---|
| Rôles d'annuaire | Graph `/me/transitiveMemberOf/microsoft.graph.directoryRole` (repli `/me/memberOf`) | Administrateur général, de facturation, des utilisateurs, Exchange |
| Propriétaire du site | REST `associatedownergroup/users` (+ `IsSiteAdmin`) | Équipe, droits des dossiers |
| Droit de gérer les accès | REST `effectivebasepermissions` (ManagePermissions) | « Qui a accès ? » |
| Licences | Graph `/me/licenseDetails` | « Ce que je peux utiliser » (Moi) |
| Groupes (v5.1) | Graph `/me/transitiveMemberOf/microsoft.graph.group` (repli : sans filtre) | Section « Site web » si membre du groupe `siteWeb.groupe` de `config.js` (nom comparé sans casse) |

Une information illisible vaut « non » : l'appli n'affiche jamais plus que ce qui est sûr.

| Profil | Onglets (4 au plus) |
|---|---|
| Administrateur général (François, Damien) | Planning · Fichiers · **Gérer** (Administration avec **Déléguer**, Équipe, Finance) · Moi |
| Propriétaire du site (Pauline) | Planning · Fichiers (avec « Qui a accès ? ») · **Équipe** · Moi |
| Administrateur de facturation (Valérie) | Planning · Fichiers · **Finance** · Moi |
| Simple collaborateur | Planning · Fichiers · Moi |

Plusieurs rôles à la fois (ex. propriétaire + facturation) : un seul onglet **Gérer**. Une route
réservée ouverte sans le droit renvoie au Planning. **Finance** n'est visible que par un
administrateur général ou de facturation ; il n'y a plus de code d'écran (« direction »).

- **Planning** : « Mes épingles » (connecté) puis le calendrier, **en lecture seule**. Plus de
  bandeau d'absences ni de pointage. Grille **dézoomable** : « Ajuster à l'écran » par défaut
  (la semaine tient en entier de 320 à 1280 px), boutons − / + et pincement (le défilement se
  fait alors dans la grille, jamais la page). Zoom mémorisé sur l'appareil.
- **Mes épingles** : chacun épingle une boîte partagée (`boites-partagees.json`), l'agenda
  Outlook, le dossier commun, « Mes fichiers » ou un dossier (menu ⋯). Gardées sur l'appareil
  (`eb:epingles`) ; glisser pour réordonner (clavier : Alt + flèches), appui long pour retirer
  (clavier : Suppr). Une boîte épinglée est un **raccourci** : web
  `https://outlook.office.com/mail/<adresse>/`, téléphone : l'appli Outlook si elle s'ouvre
  (`ms-outlook://`, il faut alors choisir la boîte dans l'appli), sinon le web. **Aucune
  permission mail.**
- **Fichiers** (un seul écran) : **Récents** (`/me/drive/recent`), **Mes fichiers** (OneDrive),
  **Dossier commun** (SharePoint, droits déjà en place). Ouvrir dans Word, Excel, PowerPoint
  (`ms-word:ofe|u|…`) ou sur le web, créer un dossier, **téléverser** (≤ 4 Mo en un envoi,
  au-delà par morceaux ; jamais d'écrasement), **copier un lien de partage interne**
  (`createLink`, portée « organisation »). Permissions déjà accordées : Files.ReadWrite.All,
  Sites.ReadWrite.All.
- **Moi** : identité, mes droits, ce que je peux utiliser, mes outils Microsoft, Réglages,
  Appeler Damien, Se déconnecter.
- **Déléguer** (administrateur général) : voir [ESPACE-BRETEUIL-CONNEXION.md](ESPACE-BRETEUIL-CONNEXION.md) § 3 bis.

**Pastille d'état** dans l'en-tête, alimentée par les appels réels : vert = connecté, orange =
une partie ne répond pas, rouge = problème (session expirée, Microsoft injoignable), gris =
vérification en cours. Le message apparaît aussi **à l'endroit concerné** (ex. Fichiers : « Le
dossier commun est introuvable »). Le diagnostic complet reste dans **Réglages → Détails
techniques** (il n'est plus un passage obligé).

**Réactivité** : réponses Microsoft gardées **en mémoire** pour la session (`cache.js`) : un écran
déjà vu s'affiche aussitôt avec le dernier état connu, se rafraîchit en arrière-plan et ne se
redessine que si quelque chose a changé ; appels lancés en parallèle ; squelettes de
chargement ; la barre d'onglets n'est reconstruite que si la liste change ; transitions de
140 à 200 ms (aucune si « réduire les animations »).

**Thème** : fond blanc crème, praline (brun rosé) et touches de **doré** — le doré ne sert qu'aux
accents (bordures, soulignés, points), jamais pour du texte sur fond crème ; mode sombre
chocolat et doré. Toutes les couleurs sont des variables CSS en tête de `app.css`, contrastes
du texte ≥ 4,5:1 (AA) vérifiés. Icônes colorées : une teinte douce par service (praline, doré,
sauge, ciel, lavande, corail).

**Démos** : les écrans fictifs (arrivée, départ, rôles, boîtes, double authentification,
historique, coût, simulateur, factures, paiement) sont cachés derrière **Réglages → Afficher les
démos** (désactivé par défaut), puis regroupés dans **Moi → Démos**. L'écran Absences est retiré.

Vérification automatique : `tests/v4.playwright.mjs` (premier lancement, 4 profils maquettés,
Fichiers, épingles, Déléguer, problème réel, semaine à 320/375/414/768/1280 px).

Adresses :

- `/espace-breteuil/` sur belfort-systems.fr ;
- un projet Cloudflare Pages séparé pour la version connectée
  (voir **[ESPACE-BRETEUIL-CONNEXION.md](ESPACE-BRETEUIL-CONNEXION.md)**).

## Section « Site web » (v5.1)

Pour les administrateurs généraux (dans **Gérer**) et les membres du groupe Microsoft 365 ou de
sécurité **« Site web »** (onglet **Site** s'ils n'ont pas d'autre section de gestion).
Fichiers : `siteweb.js` (adresses WordPress, pas-à-pas, tri des liens — testé), `siteweb-ecrans.js`.

- Tuiles vers l'administration WordPress de www.breteuil.fr (nouvel onglet ; WordPress demande son
  propre identifiant) + pas-à-pas en 3 étapes (`#/guides/site`, `#/guides/site/<id>`) adaptés à
  Elementor Pro (Theme Builder), Astra, WPML (FR/EN), WP Rocket (vider le cache), Smush.
- **Vérifier les liens** (`#/liens`) : le Worker `belfort-api` lit le bas de page FR et EN
  (`GET /breteuil/site/liens`, `?forcer=1` pour revérifier), essaie chaque lien (40 au plus) et
  l'appli les trie : cassés (rouge), à vérifier (orange : redirigés ou sites qui refusent les robots,
  comme Facebook ou Instagram), bons (repliés).

**À faire par Damien** :
1. Cloudflare → Workers → `belfort-api` → Modifier le code → coller `api-planning/worker.js` → Déployer
   (les routes du planning sont inchangées ; tests : `node api-planning/worker.test.mjs`).
2. Centre d'administration Microsoft 365 → Équipes et groupes → créer le groupe « Site web » et y
   ajouter les personnes chargées du site. Effet à la prochaine ouverture de l'appli (≤ 5 min).

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
  app.js                    cœur : accueil (Aujourd'hui), planning, Mon espace, Équipe, Plus, Finance,
                            réglages, onglets, transitions, mises à jour
  diagnostic.js/.css        « Détails techniques » (Réglages)
  cache.js                  cache de session en mémoire (dernier état connu puis mise à jour, testé)
  profil.js                 droits réels → profil, onglets, garde-fous, pastille (testé)
  acces.js                  détection des droits en arrière-plan, sondes, pastille d'état
  deleguer.js               écran « Déléguer » (propriétaires du site, rôles d'annuaire)
  fichiers.js               onglet Fichiers (Récents, Mes fichiers, Dossier commun)
  epingles.js               « Mes épingles » ; boites-partagees.json = boîtes proposées
  erreurs.js                erreurs Microsoft en français simple (testé)
  demos/                    écrans de démo (rôles, arrivée/départ, absences, boîtes, Finance, double auth.)
  connecte.js               onglet Dossiers et écrans connectés (dossier commun, accès, personnes, organisation)
  graph.js                  MSAL (jetons en mémoire), Graph, REST SharePoint, mode maquette local
  droits.js                 traduction en clair : niveaux, Externe, licences, garde-fous (testé)
  resume.js                 « Aujourd'hui au Château » : lecture des titres de l'accueil (testé)
  ics.js                    parseur ICS (testé)
  demo.js                   données fictives des écrans de démo (testé)
  demos/                    écrans de démo de Gestion et Finance (voir « Écrans de démo ») :
    donnees.js              données fictives et calculs purs (testé : tests/demos.test.mjs)
    commun.js               outils communs (en-tête, bandeau « Démo », visages, assistants)
    roles.js, equipe.js, boites.js, finance.js, securite.js, demos.css
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

*(v4 : le résumé « Aujourd'hui au Château » — absents, congés, télétravail — n'est plus affiché ; `resume.js` reste dans le dépôt mais n'est plus utilisé à l'écran.)*

Vérification :
`curl -i -H "Origin: https://belfort-systems.fr" https://belfort-api.damien-belfort.workers.dev/breteuil/sources`
→ `{"ok":true,"sources":[1,2]}`. Les adresses ne sont jamais renvoyées.

> Le relais n'ajoute pas de vraie protection (l'en-tête `Origin` se falsifie). Il ne faut
> mettre dans ces calendriers que ce que toute l'équipe peut voir.

## Mises à jour : publier une nouvelle version

1. Modifier les fichiers de `espace-breteuil/`.
2. **Incrémenter `espace-breteuil/version.js`** (par exemple `3.0.0` → `3.0.1`).
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
- le numéro est visible dans **Moi → Réglages** (bouton « Rechercher une mise à jour »).


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
- `codeEmpreinte` : **plus utilisé depuis la v4** (le code d'écran de Finance et de Gestion est
  supprimé). Ce que l'on voit dépend des droits Microsoft réels. Le champ peut rester, il est
  ignoré.

Les liens profonds `admin.microsoft.com/Adminportal/Home#/…` (users, licenses,
SharedMailbox, groups, billoverview, subscriptions, catalog, BillingNotifications)
sont ceux en usage à l'écriture : Microsoft les change parfois. Si une tuile
tombe sur l'accueil de l'admin, corriger l'adresse dans `fiches.json`.

## Réglages mémorisés sur l'appareil

`localStorage` (lu et écrit dans des `try/catch` ; en navigation privée, l'appli marche avec les
réglages par défaut) :

- `eb:reglages` : **taille de l'interface** (petit / normal / grand / très grand), thème (auto /
  clair / sombre), vue du planning au départ, événements passés, zoom de la grille, mode
  « calendrier seul », « Afficher les démos » ;
- `eb:epingles` : les épingles de l'accueil ;
- `eb:journal` : « Ce que j'ai fait » (dossiers, droits, délégations).

Pour la session de l'onglet seulement (`sessionStorage`) : jetons MSAL et dernier profil connu
(uniquement des rôles, pour afficher les bons onglets tout de suite).

## Mode « calendrier seul »

Premier écran → **Voir le calendrier**. Ensuite chaque ouverture affiche directement le planning
(vue, flèches, « Aujourd'hui », zoom). Le petit lien « Revenir à l'accueil », en bas, ramène aux
2 boutons. *(Le pointage des présences et le bandeau d'absences sont retirés.)*

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


## Écrans de démo (onglet Équipe et espace Finance)

Les anciennes tuiles « Bientôt » ouvrent maintenant de vrais écrans, **tous en démo** : données
fictives (prénoms de l'équipe), bandeau « Démo — données fictives » sur chaque écran, confirmation
en 2 étapes pour toute modification, chaque changement noté dans l'**Historique**. Tout reste sur
l'appareil (`localStorage` « eb:demos ») ; « Moi → Réglages → Remettre la démo à zéro » (visible si « Afficher les démos » est activé) l'efface aussi.
Point de départ : 12 licences (6 Formule Complète = Business Standard à 11,70 € HT, 6 Formule
Express + Teams = Business Basic à 5,60 € HT, soit 103,80 € HT par mois — prix indicatifs) et
8 boîtes partagées (contact, finance, restauration, marketing, jardins, intendance, HFB, Chanteclerc).

Le code est dans `espace-breteuil/demos/` ; dans les fichiers existants, seuls quelques
branchements : tuiles de `ecranGestion` / `ecranFinance`, un appel dans `ecranReglages`
(`window.EBDemosReglages`), les balises dans `index.html`, la liste `COQUILLE` de `sw.js`.

### 1. Rôles et délégations — `#/roles`, `#/historique`

- **Démo** : une carte par rôle (Administrateur principal, Facturation, Responsable de pôle,
  Accès à une boîte partagée), expliqué en une phrase. Toucher un visage retire le rôle, « Donner
  ce rôle » l'ajoute. Garde-fous : jamais moins d'un administrateur principal, avertissement
  au-delà de deux. Historique « qui a fait quoi ».
- **Plus tard (réel)** : Graph délégué — rôles d'annuaire (`roleManagement/directory/roleAssignments`,
  RoleManagement.ReadWrite.Directory, réservé à un administrateur général) ; responsables de pôle
  = propriétaires des groupes Microsoft 365 (Group.ReadWrite.All). L'accès aux boîtes partagées
  demande la brique serveur Exchange (voir 3). Historique : journal D1 du Worker, ou journal
  d'audit Microsoft en lecture (AuditLog.Read.All).

### 2. Arrivée, départ, absences — `#/arrivee/1…5`, `#/depart`, `#/absences`

- **Démo** :
  - arrivée en 4 étapes (identité, poste et pôle, licence avec son coût mensuel, boîtes et
    dossiers pré-cochés selon le pôle) + récapitulatif ; mot de passe provisoire d'exemple
    « à transmettre de vive voix ou par WhatsApp, jamais par mail » ;
  - départ : bloquer le compte (tout de suite ou le jour du départ), transmettre la boîte au
    responsable, récupérer les fichiers de travail, garder ou rendre la licence ; mention
    claire « on ne parcourt pas les fichiers personnels » ;
  - absences : congés, absence ou télétravail sur une frise d'équipe à la semaine, sans motif.
- **Plus tard (réel)** : Graph délégué — `POST /users`, `assignLicense`, `accountEnabled=false`,
  `revokeSignInSessions` (User.ReadWrite.All + rôle Administrateur des utilisateurs) ; membres des
  groupes et droits des dossiers comme le dossier commun actuel. Transmettre la boîte et convertir
  en boîte partagée : brique serveur Exchange. Fichiers de travail : copie d'un dossier précis de
  son OneDrive vers le dossier commun, **sans lister le reste**. Absences partagées : un calendrier
  Outlook dédié (Calendars.ReadWrite) ou D1 via le Worker.

### 3. Boîtes mail — `#/boites`, `#/boites/<id>`, `#/boites/perso/<id>`

- **Démo** : boîtes personnelles et partagées avec leur photo ; changer la photo d'une boîte
  partagée (appareil photo ou galerie, recadrage carré au doigt avec zoom, aperçu rond, image
  256 px gardée sur l'appareil) ; qui peut **ouvrir** la boîte et qui peut **envoyer en son nom**
  (interrupteurs, confirmation en 2 étapes).
- **Plus tard (réel)** : Graph délégué ne sait ni lister ces accès ni changer la photo d'une boîte
  partagée. Il faut la **brique serveur Exchange** : le Worker (identité d'application avec
  certificat, rôle Exchange limité) appelle `Add/Remove-MailboxPermission` (FullAccess),
  `Add-RecipientPermission` (SendAs) ou `GrantSendOnBehalfTo`, et `Set-UserPhoto` ; il valide
  le jeton Entra de la personne, vérifie son rôle et journalise dans D1.

### 4. Pack Finance — `#/licences`, `#/simulateur`, `#/factures`, `#/paiement`

- **Démo** : licences et coût mensuel / annuel par formule (achetées, attribuées, libres) ;
  simulateur « ajouter ou retirer une licence » avec impact mois et an, refus sous le nombre
  attribué ; factures fictives avec aperçu et **exemple PDF** généré sur l'appareil (marqué
  EXEMPLE) ; moyen de paiement (carte ou prélèvement) et adresse qui reçoit les factures.
- **Plus tard (réel)** : licences en lecture via Graph (`subscribedSkus`, déjà utilisé dans
  « Les vraies licences ») ; factures en lecture par l'API Billing (rôle Facturation) ;
  achat / retrait et changement de moyen de paiement : centre d'administration Microsoft
  (lien direct), l'appli ne voit jamais de numéro de carte.

### 5. Double authentification — `#/securite`, `#/securite/guide/1…4`, `/sms`

- **Démo** : désactivée par défaut ; l'administrateur l'active dans l'écran lui-même
  (**Équipe → Double auth.**, code « Gestion » demandé). Ensuite : tableau
  de suivi pour François (anneau « 4 / 11 protégés », état de chacun, « Envoyer un rappel »,
  « Relancer tous ») et lien « Sécuriser mon compte » dans « Mon espace ». Guide pas à pas
  (installer Microsoft Authenticator, scanner le QR code, tester) avec alternative SMS ; liens
  réels vers les magasins d'applications et la page « Mes informations de sécurité ».
- **Plus tard (réel)** : qui l'a activée : Graph `reports/authenticationMethods/userRegistrationDetails`
  (AuditLog.Read.All) ; activation : stratégie d'accès conditionnel ou « paramètres de sécurité
  par défaut » dans Entra (centre d'administration) ; rappels : mail envoyé par Graph
  (`sendMail`, Mail.Send) au nom de l'administrateur.

## Checklist de test

Automatique :

- [ ] `for f in espace-breteuil/tests/*.test.mjs; do node --test "$f"; done` : parseur ICS,
      démo, droits, profil (droits réels → onglets, garde-fous), cache, garde-fous v4, tous verts
- [ ] `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=$(npm root -g) node espace-breteuil/tests/v4.playwright.mjs <captures>`
- [ ] `… node espace-breteuil/tests/diagnostic.playwright.mjs <captures>` (Détails techniques)
- [ ] `cd api && npm test`

Version connectée : voir la checklist de [ESPACE-BRETEUIL-CONNEXION.md](ESPACE-BRETEUIL-CONNEXION.md).

À la main (téléphone + ordinateur) :

- [ ] Ouvrir l'appli : 2 boutons seulement. « Voir le calendrier », fermer, rouvrir : le
      calendrier revient ; « Revenir à l'accueil ».
- [ ] Se connecter (Pauline, François, Valérie, un collaborateur) : onglets du tableau
      « Ce que voit chacun », pastille verte.
- [ ] Installer sur l'écran d'accueil (iPhone, Android, ordinateur).
- [ ] Planning : épingler contact@ et un dossier, réordonner, retirer ; − / + et pincement ;
      rendez-vous du jour, couleurs par calendrier.
- [ ] Planning : Jour / Semaine / Mois / Liste, « Aujourd'hui », détail d'un rendez-vous.
- [ ] Mode avion : dernière version enregistrée, bandeau « Pas de connexion ».
- [ ] Moi → Réglages : taille de l'interface, thème sombre, Afficher les démos (activer, rouvrir
      l'appli, revenir).
- [ ] Mise à jour : changer `version.js`, publier, rouvrir l'appli → nouvelle version
      active ; appli ouverte pendant la publication → bandeau « Mettre à jour ».
- [ ] Largeur 375 px : pas de défilement horizontal, boutons ≥ 44 px
      (automatique : `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=$(npm root -g) node espace-breteuil/tests/v4.playwright.mjs`).
- [ ] Écrans de démo (si activés) : rôles (retirer / donner), arrivée complète, départ complet,
      photo d'une boîte partagée (appareil photo et galerie), simulateur,
      exemple PDF, activation de la double authentification (Moi → Démos → Double auth.) puis rappel.
