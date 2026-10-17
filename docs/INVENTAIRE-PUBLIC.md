# Inventaire de ce que le site publie

État au 18 octobre 2026. Ce document sert à **décider** : rien n'a été supprimé.
Pour chaque ligne, Damien choisit l'action ; ensuite on modifie `PUBLIC` dans `scripts/build-site.sh` (retirer du site) ou on supprime du dépôt.

## Deux situations à distinguer

| | Aujourd'hui : `main` sur GitHub Pages | Avec `_site/` (PR #12 et cette PR) |
|---|---|---|
| Ce qui est publié | **Tout le dépôt** (`path: '.'` dans le workflow) : code, notes, données d'aperçu, 222 Mo d'images du jeu… | Seulement la liste d'autorisation de `scripts/build-site.sh` |
| Données réelles du client en ligne | **Oui** : `admin/apercu/*.json`, `api/seed/`, `docs/*.md` (noms, adresses @breteuil.fr) | Non (garde-fou dans le build) ; il reste les coffres chiffrés et l'Espace Breteuil (voir plus bas) |
| Le dépôt lui-même | Public : tout l'historique Git est lisible | Bientôt privé (décision de Damien) |

**Conséquence** : tant que la #12 n'est pas fusionnée, les fichiers de la deuxième partie du tableau sont en ligne sur belfort-systems.fr. Fusionner la #12 est l'action la plus urgente.

## Légende

- **Statut** : Production (sert à de vrais visiteurs ou clients) · Prototype (en construction, pas encore livré) · Exemple-démo (données fictives, pour montrer) · Obsolète (remplacé ou plus utilisé).
- **Recommandation** : garder en ligne · garder mais protégé (Cloudflare Access ou projet séparé) · retirer du site (reste dans le dépôt) · supprimer du dépôt.

## 1. Ce que `_site/` publie (liste d'autorisation)

| Chemin | Ce que c'est | Statut | Données personnelles ou client | Recommandation |
|---|---|---|---|---|
| `/` (`index.html`, `404.html`, `favicon.svg`, `robots.txt`, `sitemap.xml`) | Site vitrine Belfort Systems : offre, tarifs, formulaire de contact, calendrier de disponibilités (via l'API) | Production | Celles de Damien, publiées volontairement : nom, Gmail, 06 09 89 74 43. Aucune donnée client | **Garder en ligne**. `robots.txt` liste les chemins privés (`/clients/`, `/factures/`…) : à alléger quand ils seront retirés |
| `/qui-suis-je/` | Page de présentation | Production | Nom, commune (Magny-les-Hameaux), Gmail, téléphone : volontaires | **Garder en ligne** |
| `/assets/` | CSS, JS, polices, icônes, image de partage ; `config.js` (adresse de l'API) ; `catalogue.json` (grille tarifaire) ; `bsv.js` (chiffrement des coffres) ; `admin.js` | Production | Aucune. Attention : `catalogue.json` contient des montants marqués `a_valider` et une note « propositions à confirmer par Damien » | **Garder en ligne** ; relire `catalogue.json` avant la bascule |
| `/admin/` (`index.html`, `admin.css`, `admin.js`) | Tableau de bord de Damien (clients, projets, demandes, factures) ; les données viennent de l'API après mot de passe | Production (outil interne) | Aucune dans les fichiers publiés ; les données sont dans D1, derrière l'API | **Garder mais protégé** : ajouter Cloudflare Access sur `belfort-systems.fr/admin/*` (gratuit jusqu'à 50 utilisateurs, à vérifier) en plus du mot de passe |
| `/portail/` | Page « Espace client » : identifiant + mot de passe, renvoie vers `/clients/<identifiant>/` | Prototype | Le placeholder affiche « chateau-de-breteuil » (révèle le nom du client) | **Retirer du site** en même temps que `/clients/` ; le futur portail sera l'Espace Breteuil ou le tableau de bord par client |
| `/clients/chateau-de-breteuil/` | Coffre chiffré (AES-GCM 256, PBKDF2 310 000 itérations) : documents livrés au Château, déchiffrés dans le navigateur | Production (ancienne livraison) | **Oui, chiffrées** : documents du client. Le texte chiffré est public et archivable : quiconque le copie peut tenter des mots de passe hors ligne, sans limite | **Retirer du site et supprimer du dépôt** ; remettre ces documents au client par un canal privé (SharePoint du Château, Espace Breteuil) |
| `/clients/chateau-de-breteuil/demo/` | « Démonstration privée » chiffrée (application de démonstration) | Exemple-démo | Contenu chiffré, non vérifiable ici ; à confirmer par Damien | **Retirer du site** ; montrer la démo depuis un projet Pages protégé par Cloudflare Access |
| `/factures/` | Coffre chiffré des factures | Production | **Oui, chiffrées** : factures (montants, coordonnées du client ; contenu non vérifiable ici). Même risque hors ligne | **Retirer du site et supprimer du dépôt** ; les factures se conservent hors dépôt (obligation comptable de 10 ans) et s'envoient par mail ou via l'espace client |
| `/haccp/` | « Achille HACCP » : appli hors ligne (PWA) de relevés de températures, contrôles de livraisons, scan de codes-barres, export PDF | Prototype | Aucune dans les fichiers ; les relevés restent sur l'appareil (stockage local) | **Garder en ligne** (rien de sensible) ; à terme, son propre projet Pages ou sous-domaine, comme l'Espace Breteuil |
| `/ecorce/` | Page « TinKnight a déménagé » : renvoie vers jeu.belfort-systems.fr | Production (renvoi) | Aucune | **Garder en ligne** tant que des liens anciens circulent |
| `/ecorce/ancienne/` | Ancienne version du jeu (147 Mo, environ 4 200 fichiers : modèles 3D, sons, cartes) | Obsolète | Aucune donnée personnelle. Les **sauvegardes des joueurs** sont dans le navigateur, sur l'origine belfort-systems.fr : cette page est le seul moyen de les transférer (code « Associer ») | **Garder en ligne** jusqu'à la fin du transfert des parties, puis **retirer du site**. Le changement d'hébergeur ne perd rien : l'origine reste belfort-systems.fr |
| `/ecorce/ancienne/admin.html` | Administration du jeu (éditeur de niveaux, réglages ; mot de passe vérifié par le Worker `jeu-sauvegarde`) | Obsolète | Aucune dans le fichier | **Retirer du site** (l'administration vit avec le nouveau jeu) |
| `/ecorce/ancienne/concepts/` | Planche de concepts du jeu ; vignettes hébergées chez Higgsfield (CloudFront, l'adresse contient l'identifiant de compte Higgsfield) | Obsolète | Identifiant de compte Higgsfield dans les URL d'images | **Retirer du site** |
| `/espace-breteuil/` | Appli Microsoft 365 du Château (tuiles, agenda, fiches « comment faire ») ; aussi servie par son propre projet `espace-breteuil.pages.dev` ; en refonte par un autre agent | Prototype | **Oui, en clair** : prénoms du personnel, adresses @breteuil.fr (direction, finance, restauration, marketing, jardins…), organisation des boîtes partagées ; `fiches.json` contient l'empreinte SHA-256 d'un code court (un code court se retrouve par essais en quelques secondes : ce n'est qu'un cache-écran, comme le dit le fichier) | **Retirer du site principal** et ne servir l'appli que depuis son projet Pages (origine séparée), protégé par Cloudflare Access ; voir docs/MIGRATION-CLOUDFLARE-PAGES.md, « Espace Breteuil » |

## 2. Publié aujourd'hui par `main`, plus par `_site/`

Ces chemins sont en ligne **tant que la #12 n'est pas fusionnée** (GitHub Pages publie tout le dépôt).

| Chemin | Ce que c'est | Statut | Données personnelles ou client | Recommandation |
|---|---|---|---|---|
| `/admin/apercu/` | Données d'aperçu du tableau de bord | Exemple-démo (fictives depuis la #12) | **Sur `main` : réelles** (Château de Breteuil, contact Pauline de Breteuil, finance@breteuil.fr, projets, factures) | **Retirer du site** (fait par `_site`) ; garder la version fictive dans le dépôt ; données réelles à purger de l'historique (étape G de la migration) |
| `/api/` | Code du Worker `belfort-api`, `schema.sql`, `wrangler.toml` (identifiants D1 et KV, non secrets), `seed/` | Production (code) | **Sur `main` : `api/seed/` contient de vraies demandes et évènements du Château** ; fictifs depuis la #12 | **Retirer du site** (fait) ; garder dans le dépôt privé ; historique à purger |
| `/docs/` | Notes de projet (site, tableau de bord, Espace Breteuil, cadre légal, feuille de route) | Production (documentation interne) | Prénoms et noms des dirigeants et de la responsable restauration du Château, pdebreteuil@breteuil.fr, finance@breteuil.fr | **Retirer du site** (fait) ; garder dans le dépôt privé |
| `/ASSETS - CONCEPTS - ARTS/` | 222 Mo d'images et d'outils du jeu (774 fichiers) | Prototype (matériel de travail du jeu) | Aucune connue | **Retirer du site** (fait) ; à terme, le déplacer dans le dépôt du jeu |
| `/README.md`, `/admin/NOTES.md`, `/api/NOTES.md` | Notes de dépôt | Production (documentation) | Aucune relevée | **Retirer du site** (fait) |
| `/.github/` (workflows, `reorg/`) | Automatisations GitHub | Production (outillage) | Aucune ; les secrets sont dans GitHub, pas dans les fichiers | **Retirer du site** (fait) |
| `/modeles` | Fichier vide d'un octet | Obsolète | Aucune | **Supprimer du dépôt** |
| `/CNAME`, `/.nojekyll` | Réglages GitHub Pages | Production (jusqu'à la bascule) | Aucune | **Supprimer du dépôt** après la bascule (étape E) ; le build ne les publie déjà plus sur Cloudflare |

## Résumé

- **Production à garder en ligne** : `/`, `/qui-suis-je/`, `/assets/`, `/ecorce/` (renvoi) ; `/admin/` à protéger en plus.
- **Prototypes (3)** : `/portail/`, `/haccp/`, `/espace-breteuil/` (plus le dossier d'images du jeu, qui n'est plus publié).
- **Exemples-démos (2)** : `/clients/chateau-de-breteuil/demo/`, `/admin/apercu/` (ce dernier n'est plus publié avec `_site`).
- **Obsolètes (2)** : `/ecorce/ancienne/` (à garder tant que des parties restent à transférer), `/modeles`.
- **Données client encore publiées avec `_site`** : les coffres chiffrés `/clients/chateau-de-breteuil/` et `/factures/` (en clair : rien ; chiffré : tout), et l'Espace Breteuil (adresses et prénoms en clair). Ce sont les trois décisions prioritaires.
- **Exception CSP** : les coffres chiffrés injectent, après le mot de passe, une page déchiffrée avec ses propres scripts ; leur CSP autorise donc les scripts inline (`scripts/generer-headers.mjs`). Les retirer du site supprime aussi cette exception.
