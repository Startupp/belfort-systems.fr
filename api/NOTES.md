# belfort-api — notes de service

Service Cloudflare du site belfort-systems.fr : un Worker (`src/index.js`, sans dépendance), une base D1 (`belfort-systems`) et un espace KV (sessions, limitation, cache). Contrat de référence : `docs/TABLEAU-DE-BORD.md`.

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

- `npm test` — tests unitaires du code pur (validation, routeur, PBKDF2, CORS, dates), sans réseau.
- `npm run test:local` — test de bout en bout : lance `wrangler dev --local` sur le port 8799 avec un état D1/KV temporaire, applique schéma et seed, puis 61 vérifications (CORS, limitation du login, demandes, factures et numérotation, contact, disponibilités, jetons clients, SSE). Une ligne par vérification et un bilan.

## 3. Importer / régénérer le seed

```bash
node api/seed/importer.mjs   # relit seed/demandes/*.json et seed/evenements/*.json → seed/seed.sql
```

`seed.sql` est commité ; en production, cochez `seed` dans le workflow (une seule fois ; rejouer ne crée pas de doublons). Le client `breteuil` est créé **sans jeton** : générez-le depuis le panneau (`POST /admin/clients/breteuil/regenerer`), il n'est montré qu'une fois.

## 4. Décisions prises (points du contrat adaptés)

- **Colonne `factures.ref`** ajoutée (nullable) : lien d'un avoir vers sa facture d'origine. L'annulation d'une facture émise ne se fait que par un avoir (`POST /admin/factures/:id/avoir` crée un brouillon négatif ; son émission passe l'origine en `annulee`). Jamais de suppression d'une facture émise (`DELETE` n'accepte que les brouillons).
- **Numérotation** `BS-AAAA-NNN` : compteur `compteurs['facture:AAAA']` incrémenté et numéro attribué par sous-requête dans un même `batch` D1 (transaction) ; l'année est celle de la date d'émission.
- **SSE `/admin/flux`** : `EventSource` ne peut pas envoyer d'en-tête `Authorization`, le jeton de session est donc aussi accepté en paramètre `?jeton=` (uniquement sur cette route et sur les routes authentifiées ; il n'est jamais journalisé).
- **Limitation du login** : 5 tentatives par IP et 15 min via KV (cohérence différée : limite indicative). Une connexion réussie remet le compteur à zéro. Pendant le blocage, même le bon mot de passe reçoit 429.
- **Formulaire `/contact`** : pot-de-miel rempli ou envoi en moins de 3 s (`t` manquant ou trop récent) → réponse `200 {ok:true}` silencieuse sans insertion (ne pas renseigner les robots). 10 envois par IP et par heure ensuite.
- **Origine inconnue** : toute requête de navigateur dont l'`Origin` n'est ni `ORIGINES` ni `http://localhost:*` reçoit 403 (CORS strict). Les appels sans `Origin` (curl, serveurs) passent, l'authentification faisant le tri.
- **Seed** — correspondances avec les JSON d'origine : statuts `fait→traite`, `partiel→partiel`, `en cours→en_cours`, `afaire→nouveau`, `aconfirmer`/`attente`→`lu` ; tarif `hors` (hors forfait) → `extra` ; types d'événement `jalon→decision`, `incident→echange`, `avenir→decision` (type d'origine conservé dans `detail`) ; canaux `Sur site→Sur place`, et les canaux `Teams`, `Word`, `Guide` conservés tels quels (une conversation chacun). Les 36 événements sont rattachés au seul projet `breteuil-migration` (chantier « site » indiqué dans `detail`). Auteur des messages : « Damien » si le texte commence par Ta/Ton/Tu ou est un envoi évident, « Château » sinon — simple repère.
- **Première lecture** : `GET /admin/projets/:id` passe les demandes `nouveau` en `lu` (journalisé). Un message ou un « encore » du client sur une demande close la remet en `nouveau`.
- **Mot de passe admin** : PBKDF2-SHA256 100 000 itérations sur le mot de passe fourni et sur `ADMIN_PASSWORD`, comparaison à temps constant ; l'empreinte attendue est calculée une fois par isolat.

## 5. Limites connues

- KV est à cohérence différée : la limitation de débit et la révocation de session peuvent prendre jusqu'à ~60 s pour être vues par tous les centres de données.
- `/admin/flux` relit la table `journal` toutes les 3 s ; chaque connexion dure au plus 25 min (le navigateur se reconnecte, `retry: 5000`). Pas de diffusion instantanée.
- `GET /catalogue` relaie `https://belfort-systems.fr/assets/catalogue.json` avec un cache KV de 10 min ; les pages peuvent lire le fichier statique directement.
- Les disponibilités suivent une règle fixe (jours ouvrés, 9-12 h et 14-18 h, heure de Paris) sans jours fériés.
- Turnstile n'est pas branché (prévu : clé publique dans `assets/config.js`).
- Pas d'envoi d'e-mail : les contacts se consultent dans le panneau.
