# belfort-api — notes de service

Service Cloudflare du site belfort-systems.fr : un Worker (`src/index.js`, sans dépendance), une base D1 (`belfort-systems`), la base D1 `belfort_contact` du Worker belfort-contact reliée en lecture (binding `CONTACTS`, vue « Premier contact ») et un espace KV (sessions, limitation, cache). Contrat de référence : `docs/TABLEAU-DE-BORD.md`.

## 1. Déployer (GitHub Actions)

Le workflow `.github/workflows/deploy-worker.yml` se lance à chaque push sur `main` qui touche `api/**`, ou à la main (*Actions → Déployer le service → Run workflow*) avec deux cases :

| Entrée   | Défaut | Effet |
|----------|--------|-------|
| `schema` | oui    | applique `api/schema.sql` sur la base distante (idempotent) |
| `seed`   | non    | importe `api/seed/seed.sql` (idempotent, `INSERT OR IGNORE`) — à cocher au **premier** déploiement seulement |

Trois secrets GitHub sont obligatoires (*Settings → Secrets and variables → Actions → New repository secret*). Sans eux, la première étape du workflow échoue avec un message qui explique quoi créer.

| Secret | Où le trouver chez Cloudflare |
|--------|-------------------------------|
| `CLOUDFLARE_API_TOKEN` | https://dash.cloudflare.com/profile/api-tokens → *Create Token* → modèle **« Edit Cloudflare Workers »**, puis ajouter les permissions **Account → D1 → Edit** et **Account → Workers KV Storage → Edit**. Restreindre au compte `damien-belfort`. |
| `CLOUDFLARE_ACCOUNT_ID` | Tableau de bord → *Workers & Pages* → colonne de droite **Account ID** (32 caractères hexadécimaux). |
| `ADMIN_PASSWORD` | Mot de passe du panneau `/admin/` : long et aléatoire (ex. 24 caractères). Il est poussé au Worker comme secret à chaque déploiement, jamais écrit dans le dépôt. |

Secret facultatif du dépôt : `ADMIN_GITHUB_TOKEN` — jeton GitHub *fine-grained* limité au dépôt `Startupp/belfort-systems.fr`, droits **Contents : lecture/écriture** et **Pull requests : lecture/écriture** (Metadata : lecture, ajouté d'office). Le workflow le pousse au Worker sous le nom `GITHUB_TOKEN` ; il sert à la vue « Publications » (liste des PR ouvertes, bouton « Review & Merge »). Sans lui, la vue affiche « Jeton GitHub non configuré ».

Secret facultatif côté Worker : `SESSION_SALT` (`wrangler secret put SESSION_SALT`), sel du PBKDF2 ; à défaut le sel est dérivé de `ADMIN_PASSWORD`.

Après déploiement, l'API répond sur `https://belfort-api.damien-belfort.workers.dev/` (`{ok:true, service:"belfort-api"}`).

## 2. Lancer en local

```bash
cd api
npm i                       # installe wrangler (devDependency)
echo "ADMIN_PASSWORD=test-local" > .dev.vars   # ignoré par git
npm run schema:local        # schéma sur la D1 locale
npm run seed:local          # données de départ en local
npm run dev                 # http://localhost:8787
```

Tests :

- `npm test` — tests unitaires du code pur (validation, routeur, PBKDF2, CORS, dates) et des routes « Publications » / « Premier contact » avec un GitHub simulé et des bases D1 factices, sans réseau.
- `npm run test:local` — test de bout en bout : lance `wrangler dev --local` sur le port 8799 avec un état D1/KV temporaire, applique schéma et seed, puis 72 vérifications (CORS, limitation du login, demandes, factures et numérotation, contact, disponibilités, jetons clients, SSE, et les formes de réponse exactes consommées par `admin/admin.js`). Une ligne par vérification et un bilan.

## 3. Importer / régénérer le seed

```bash
node api/seed/importer.mjs   # relit seed/demandes/*.json et seed/evenements/*.json → seed/seed.sql
```

**Les données commitées sont FICTIVES** (client de démonstration `tilleuls`, « Domaine des Tilleuls ») : le dépôt est public, aucune vraie donnée client ne doit y entrer. Elles servent aux tests (`npm run test:local`) et au mode aperçu du panneau. **Ne cochez pas `seed` en production** : cela créerait le client fictif dans la vraie base.

Vraies données (hors dépôt) : placez-les dans `api/seed/prive/` (ignoré par git) — `demandes/*.json`, `evenements/*.json` et un `client.json` facultatif `{client:{id,slug,nom,contact,email}, projet:{id,titre,resume}, participants, prenoms:[…]}` — puis :

```bash
node api/seed/importer.mjs --source api/seed/prive      # écrit api/seed/prive/seed.sql
cd api && npx wrangler d1 execute belfort-systems --remote --file=seed/prive/seed.sql
```

Le client est créé **sans jeton** : générez-le depuis le panneau (`POST /admin/clients/<id>/regenerer`), il n'est montré qu'une fois.

## 4. Décisions prises (points du contrat adaptés)

- **Formes de réponse = celles du panneau** (`admin/NOTES.md`, `admin/apercu/*.json`) : `GET /admin/projets` → `client:{id,slug,nom,contact,email}`, `compteurs:{statut:n}`, `nb_demandes` ; `GET /admin/projets/:id` → `projet.client` imbriqué, `conversations[].messages[]` imbriqués, événements avec `date:""` pour « à venir » ; `GET /admin/contacts` → `rdv:{…}|null` joint sur chaque contact ; `GET /admin/factures` → `client_nom`, `client_contact`, `client_email`, `type`, `reference` ; `GET /admin/journal` → `table` déduit de `cible` ; `GET /admin/resume` → `prochain_rdv:{debut,fin,avec,statut}` (prochain rdv proposé ou confirmé, `avec` = nom du contact) et `dernier_evenement:{date,titre}` ; `POST /admin/clients` → `{id, token}` (le clair, une fois) ; `POST …/regenerer` → `{token}` ; toute création renvoie `id` en tête.
- **Colonnes ajoutées au contrat** (nullables, sans valeur par défaut gênante) : `demandes.note` (notes libres cumulées), `demandes.encore` (compteur « ça ne marche toujours pas », +1 à chaque `POST /client/demandes/:id/encore`), `demandes.encore_le` ; `factures.type` (`facture|avoir`), `factures.ref` (id de la facture d'origine d'un avoir), `factures.reference` (son numéro), `factures.objet`, `factures.paye_le` (`POST …/payee {date_paiement}`). Le schéma n'étant pas encore déployé, `schema.sql` a été modifié directement.
- **Lignes de facture** : forme du panneau `{ref, designation, quantite, unite, prix}` (`prix_unitaire` accepté comme synonyme) ; `total` par ligne et `total_ht` recalculés côté Worker, jamais pris du client.
- **Avoir** : deux entrées équivalentes — `POST /admin/factures {type:"avoir", reference:"BS-AAAA-NNN", lignes}` (ce que fait le panneau) ou `POST /admin/factures/:id/avoir {motif}`. Les lignes sont mises en négatif, un seul avoir par facture, l'origine doit être émise ; à l'émission de l'avoir (numéro continu), l'origine passe `annulee`. Jamais de suppression d'une facture émise (`DELETE` n'accepte que les brouillons).
- **`PATCH /admin/demandes/:id`** : `{action, statut, solution, motif, reste, note}` — avec `action`, la règle métier prime (le `statut` envoyé en plus est ignoré) et `reste`/`note` sont appliqués en même temps ; sans `action`, mise à jour de champs (`traite` exige une solution, `abandonne` un motif).
- **Rendez-vous** : statuts `propose|confirme|annule` (le contrat disait « proposés / confirmés » ; le panneau teste `propose`). `POST /contact` avec `creneau` crée un rdv `propose` d'une heure ; `PATCH /admin/rdv/:id {statut}` le confirme ou l'annule.
- **Numérotation** `BS-AAAA-NNN` : compteur `compteurs['facture:AAAA']` incrémenté et numéro attribué par sous-requête dans un même `batch` D1 (transaction) ; l'année est celle de la date d'émission.
- **SSE `/admin/flux`** : `EventSource` ne peut pas envoyer d'en-tête `Authorization`, le jeton de session est donc aussi accepté en paramètre `?t=` (ce qu'envoie le panneau) ou `?jeton=` ; il n'est jamais journalisé.
- **Limitation du login** : 5 tentatives par IP et 15 min via KV (cohérence différée : limite indicative). Une connexion réussie remet le compteur à zéro. Pendant le blocage, même le bon mot de passe reçoit 429.
- **Formulaire `/contact`** : pot-de-miel rempli ou envoi en moins de 3 s (`t` manquant ou trop récent) → réponse `200 {ok:true}` silencieuse sans insertion (ne pas renseigner les robots). 10 envois par IP et par heure ensuite.
- **Origine inconnue** : toute requête de navigateur dont l'`Origin` n'est ni `ORIGINES` ni `http://localhost:*` reçoit 403 (CORS strict). Les appels sans `Origin` (curl, serveurs) passent, l'authentification faisant le tri.
- **Seed** — même table de conversion que l'aperçu du panneau (`admin/NOTES.md`) : statuts `fait→traite`, `afaire→lu` (sauf les demandes venues du Word du 06/10 → `nouveau`), `aconfirmer→en_cours`, `partiel→partiel`, `attente→repondu` ; tarif `hors` (hors forfait) → `extra` ; types d'événement `jalon→decision`, `incident→echange` (detail « Incident »), `avenir→decision` avec `date:""` ; canaux `Sur site→Sur place`, `Teams→Téléphone`, `Word`/`Guide`→`Mail` avec `piece` « Document Word » / « Guide PDF » (5 conversations). Résultat : 16 traitées, 7 en cours, 17 lues, 7 partielles, 1 nouvelle, 1 répondue — identique à `admin/apercu/projet-exemple.json`. Les 36 événements sont rattachés au seul projet `tilleuls-migration` (chantier « site » indiqué dans `detail`). Auteur des messages : « Damien » si le texte commence par Ta/Ton/Tu ou est un envoi évident, « Client » sinon — simple repère.
- **Première lecture** : `GET /admin/projets/:id` passe les demandes `nouveau` en `lu` (journalisé). Un message ou un « encore » du client sur une demande close la remet en `nouveau`.
- **Mot de passe admin** : PBKDF2-SHA256 100 000 itérations sur le mot de passe fourni et sur `ADMIN_PASSWORD`, comparaison à temps constant ; l'empreinte attendue est calculée une fois par isolat.

## 5. Limites connues

- KV est à cohérence différée : la limitation de débit et la révocation de session peuvent prendre jusqu'à ~60 s pour être vues par tous les centres de données.
- `/admin/flux` relit la table `journal` toutes les 3 s ; chaque connexion dure au plus 25 min (le navigateur se reconnecte, `retry: 5000`). Pas de diffusion instantanée.
- `GET /catalogue` relaie `https://belfort-systems.fr/assets/catalogue.json` avec un cache KV de 10 min ; les pages peuvent lire le fichier statique directement.
- Les disponibilités suivent une règle fixe (jours ouvrés, 9-12 h et 14-18 h, heure de Paris) sans jours fériés.
- Turnstile n'est pas branché (prévu : clé publique dans `assets/config.js` ; le site enverra `cf-turnstile-response`, à vérifier ici).
- Site public : `/contact` accepte exactement ce que `assets/site.js` envoie (`nom, email, tel, sujet, formule, message, website, t, creneau`, `t` en millisecondes) et `/disponibilites` renvoie `{ok:true, semaine, lundi, creneaux:[{debut, fin}]}`, première forme acceptée par `extraireLibres()`. « Convertir en projet » enchaîne encore deux appels (`POST /admin/clients` puis `POST /admin/projets`) ; pas de route unique.
- Pas d'envoi d'e-mail : les contacts se consultent dans le panneau.
