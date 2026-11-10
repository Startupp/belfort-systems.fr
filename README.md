# belfort-systems.fr

Site personnel de Damien Belfort — Belfort Systems.

- `/` — site vitrine (offre, tarifs, contact)
- `/qui-suis-je/` — présentation
- `/admin/` — tableau de bord (privé, données via l'API)
- `/haccp/` — mini-app Achille HACCP (prototype)
- `/ecorce/` — renvoi vers le jeu (jeu.belfort-systems.fr)

Depuis le 27/10/2026, les espaces clients (`/clients/`), les factures (`/factures/`), le portail
(`/portail/`) et l'Espace Breteuil ne sont plus publiés ici : les documents passent par SharePoint
ou Indy, l'appli vit sur espace-breteuil.pages.dev. Les dossiers restent dans le dépôt.

Hébergé sur **Cloudflare Pages** (projet `belfort-systems-fr`, branche `main`, commande de build
`bash scripts/build-site.sh`, dossier de sortie `_site`). L'ancien workflow GitHub Pages est
désactivé (copie dans `docs/archives/deploy-pages.yml.disabled`).

## Service

Le site reste statique ; ce qui doit être reçu, stocké ou partagé passe par le service
`belfort-api` (dossier `api/`) : un Worker Cloudflare sans dépendance, une base D1
`belfort-systems` et un espace KV pour les sessions. Il sert le formulaire de contact,
les disponibilités, le panneau `/admin/` (demandes, factures numérotées en continu,
journal d'audit, flux temps réel) et les outils déployés chez les clients (`/client/*`).
Le formulaire de contact du site, lui, passe par un Worker à part : voir ci-dessous.
Déploiement automatique par `.github/workflows/deploy-worker.yml` à chaque push sur
`main` qui touche `api/**`, avec trois secrets GitHub à créer une fois
(`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ADMIN_PASSWORD`).
Mise en route, tests locaux, import des données et décisions : voir [api/NOTES.md](api/NOTES.md).
Contrat d'architecture : [docs/TABLEAU-DE-BORD.md](docs/TABLEAU-DE-BORD.md).

## Formulaire de contact

Le formulaire de `index.html` est traité par un Worker **séparé**, `belfort-contact`
(dossier [`contact-worker/`](contact-worker/README.md)), pour ne pas toucher à `belfort-api`
qui sert aussi l'application du Château. Il enregistre chaque demande dans une base D1
`belfort_contact`, envoie un e-mail à `damien@belfort-systems.fr` (Email Workers) et limite
à 10 envois par heure et par adresse IP (KV). Côté site : `BS_CONTACT_API` dans
`assets/config.js`, lu par `assets/site.js` et par le générateur d'en-têtes (CSP).

### Mise en route (une fois, depuis l'ordinateur de Damien)

Prérequis : Node.js et un compte Cloudflare connecté (`npx wrangler login`).

```bash
cd contact-worker

# 1. Espace KV pour la limitation de débit → note l'id renvoyé
npx wrangler kv namespace create RATE

# 2. Base D1 → note le database_id renvoyé
npx wrangler d1 create belfort_contact

# 3. Coller les deux identifiants dans wrangler.toml (voir « Identifiants » plus bas), puis
#    créer la table « contacts » dans la base distante
npx wrangler d1 migrations apply belfort_contact --remote

# 4. Facultatif : vérification Turnstile (clé secrète du widget, jamais dans le dépôt)
npx wrangler secret put TURNSTILE_SECRET

# 5. Déployer
npx wrangler deploy
```

Le Worker répond ensuite sur `https://belfort-contact.damien-belfort.workers.dev/contact`
(contrôle rapide : `curl https://belfort-contact.damien-belfort.workers.dev/` doit renvoyer
`{"ok":true,"service":"belfort-contact"}`).

### Activer l'envoi d'e-mail (Cloudflare Email Routing)

Le binding `send_email` de `wrangler.toml` n'envoie qu'à une **adresse de destination vérifiée**.

1. Cloudflare → domaine **belfort-systems.fr** → **Email** → **Email Routing** : activer le service
   si ce n'est pas fait (Cloudflare ajoute les enregistrements MX/TXT, à accepter).
2. Onglet **Destination addresses** → **Add destination address** → `damien@belfort-systems.fr`
   (ou l'adresse réelle où lire ces mails) → cliquer sur le lien de confirmation reçu.
3. Si `damien@belfort-systems.fr` n'est pas une boîte réelle mais une adresse du domaine :
   onglet **Routing rules** → créer la règle `damien@belfort-systems.fr → <boîte réelle>`,
   et vérifier **cette** boîte réelle comme destination à l'étape 2.
4. Redéployer (`npx wrangler deploy`) pour que le binding soit pris en compte.

Si le binding manque ou si l'envoi échoue, le Worker enregistre quand même la demande en base,
répond `{ "ok": true }` au visiteur et écrit un avertissement dans ses journaux
(`npx wrangler tail` ou tableau de bord → Workers & Pages → belfort-contact → Logs).

### Identifiants KV et D1 dans wrangler.toml

Les identifiants ne sont **pas** des secrets (ils n'ouvrent aucun accès sans le compte), mais
deux façons de faire selon la préférence :

| | Comment |
|---|---|
| Les commiter | remplacer `REMPLACER_PAR_ID_KV` et `REMPLACER_PAR_ID_D1` dans `contact-worker/wrangler.toml` et commiter. Le plus simple ; c'est ce que fait déjà `api/wrangler.toml`. |
| Ne pas les commiter | `cp wrangler.toml wrangler.local.toml` (fichier ignoré par git), y coller les identifiants, puis toujours déployer avec `npx wrangler deploy --config wrangler.local.toml` (et `--config wrangler.local.toml` aussi pour `d1 migrations apply`). |

### Tester

1. Sur l'aperçu Cloudflare Pages (`https://<branche>.belfort-systems-fr.pages.dev/#contact`) ou sur
   le site : remplir le formulaire et envoyer. Message attendu : « Merci …, votre demande est bien
   envoyée ».
2. Vérifier la ligne en base : `npx wrangler d1 execute belfort_contact --remote --command "SELECT id, recu_le, nom, email, sujet FROM contacts ORDER BY id DESC LIMIT 5"`.
3. Vérifier l'e-mail reçu (objet `[Site] <sujet> — <nom>`, répondre = répondre au visiteur).
4. Anti-robot : remplir le champ caché `website` (via la console : `document.getElementById("c-website").value="x"`)
   → réponse ok mais rien en base ; 11 envois en une heure depuis la même IP → message « Trop de messages ».
