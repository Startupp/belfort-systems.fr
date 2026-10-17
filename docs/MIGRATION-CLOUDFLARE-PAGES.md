# Passer belfort-systems.fr de GitHub Pages à Cloudflare Pages

Guide pas à pas, **dans l'ordre**, pour changer d'hébergeur **sans coupure du site**, puis passer le dépôt en privé.
Compter environ une heure, plus l'étape G (facultative).

> **À savoir avant de commencer**
> - Le site reste en ligne sur GitHub Pages jusqu'à l'étape C. Tant que le DNS n'a pas changé, rien n'est visible pour les visiteurs.
> - GitHub Pages ne fonctionne pas sur un dépôt **privé** avec un compte GitHub gratuit. L'ordre compte : Cloudflare d'abord (A à E), dépôt privé ensuite (F).
> - La PR #12 (« ne publier que le site public ») doit être fusionnée **avant** l'étape A : c'est elle qui empêche de publier `api/`, `docs/`, les données d'aperçu, etc. Cette PR-ci part de la #12.

## Ce que fait le build

| Réglage Cloudflare Pages | Valeur |
|---|---|
| Commande de build | `bash scripts/build-site.sh` |
| Dossier de sortie | `_site` |
| Dossier racine | *(vide : racine du dépôt)* |
| Branche de production | `main` |
| Variables d'environnement | aucune obligatoire (Node.js est déjà dans l'image de build) |

`scripts/build-site.sh` :
1. copie dans `_site/` uniquement la **liste d'autorisation** (`PUBLIC` dans le script) ;
2. retire les tests, notes `.md`, scripts, `package.json`… ;
3. génère `_site/_headers` (en-têtes de sécurité, CSP par section, voir plus bas) et copie `_site/_redirects` ;
4. **échoue** si un chemin interdit (`api/`, `docs/`, `admin/apercu/`, `*.sql`, `.github/`, `scripts/`, `wrangler.toml`…) se retrouve dans `_site/`, ou si les limites de Cloudflare (20 000 fichiers, 25 Mio par fichier) sont dépassées.

Le même script sert au workflow GitHub Pages actuel : les deux hébergeurs publient exactement la même chose pendant la transition.

### Tester en local (facultatif)

```bash
bash scripts/build-site.sh
node scripts/servir-site.mjs          # http://localhost:8788, avec les en-têtes de _headers
# dans un autre terminal (Playwright installé à part) :
node scripts/verifier-csp.mjs         # ouvre chaque page dans Chromium, signale toute violation CSP
```

Dernier résultat : **14 pages, 0 violation CSP** (chargement plus clics sur les boutons visibles).

### Les en-têtes de sécurité (`_site/_headers`)

| En-tête | Valeur | Où |
|---|---|---|
| Strict-Transport-Security | `max-age=31536000; includeSubDomains` | partout |
| X-Content-Type-Options | `nosniff` | partout |
| Referrer-Policy | `strict-origin-when-cross-origin` | partout |
| X-Frame-Options + CSP `frame-ancestors 'none'` | aucune page ne peut être affichée dans un cadre | partout (aucun besoin réel trouvé) |
| Cross-Origin-Resource-Policy | `same-site` | partout |
| Content-Security-Policy | une par page, selon sa section : scripts du site + **empreintes SHA-256** des scripts écrits dans la page, recalculées à chaque build | chaque page HTML |
| Permissions-Policy | tout fermé (caméra, micro, position…) ; caméra rouverte pour `/haccp/` (scan), capteurs de mouvement pour l'ancien jeu | chaque page HTML |
| X-Robots-Tag `noindex` | sections privées (`/admin/`, `/portail/`, `/clients/`, `/factures/`, `/haccp/`, `/espace-breteuil/`) et toutes les adresses `*.pages.dev` | |
| Cache-Control `no-cache` | `sw.js`, `config.js`, `version.js`, `manifest.webmanifest` ; `no-store` pour `maj.json` | |

Sources autorisées par section (modifiables dans `SECTIONS`, `scripts/generer-headers.mjs`) :

| Section | Autorisé en plus du site lui-même |
|---|---|
| `/`, `/qui-suis-je/` | l'API `belfort-api` (lue dans `assets/config.js`) ; Turnstile ajouté tout seul si `BS_TURNSTILE` est rempli |
| `/admin/` | l'API, Google Fonts |
| `/portail/`, `/haccp/` | Google Fonts |
| `/clients/`, `/factures/` | Google Fonts, l'API, images https, **scripts inline** (exception : voir encadré) |
| `/ecorce/ancienne/` | jsDelivr (three.js de secours), Worker `jeu-sauvegarde`, PeerJS (`0.peerjs.com`) |
| `/ecorce/ancienne/concepts/` | images CloudFront (Higgsfield), Google Fonts |
| `/espace-breteuil/` | l'API, Microsoft Graph, connexion Microsoft, `*.sharepoint.com` (reprend `espace-breteuil/_headers`) |

> **Exception assumée : les coffres chiffrés** (`/clients/…`, `/factures/`). Après le mot de passe, la page déchiffre un document et l'injecte avec ses propres scripts. Le contenu étant chiffré, le build ne peut pas calculer leurs empreintes : ces pages autorisent donc les scripts inline. Les retirer du site (voir `docs/INVENTAIRE-PUBLIC.md`) supprime l'exception.

> **HSTS `includeSubDomains`** : tous les sous-domaines de belfort-systems.fr doivent être en HTTPS (c'est le cas de `jeu.` s'il passe par Cloudflare). Pas de `preload` : on peut revenir en arrière.

> **Si une page casse après une modification** : relancer `node scripts/verifier-csp.mjs`. La console du navigateur (F12) indique la directive bloquante ; on ajoute la source dans `SECTIONS`, jamais `'unsafe-inline'` au hasard.

---

## A. Créer le projet Pages « belfort-systems » relié au dépôt

À faire **avant** de passer le dépôt en privé (l'application GitHub de Cloudflare gardera ensuite l'accès aux dépôts qu'on lui a autorisés).

1. Cloudflare → **Workers & Pages** → **Créer** → onglet **Pages** → **Se connecter à Git**.
2. Si GitHub n'est pas encore relié : **Ajouter un compte**, installer l'application « Cloudflare Workers and Pages » sur le compte `Startupp`, avec **« Only select repositories »** → `belfort-systems.fr` (et `espace-breteuil` s'il est dans un autre dépôt). Ne pas donner « All repositories ».
3. Choisir le dépôt `Startupp/belfort-systems.fr` → **Commencer la configuration**.
4. Nom du projet : `belfort-systems` (donne l'adresse `belfort-systems.pages.dev`).
5. Branche de production : `main`. Préréglage du framework : **Aucun**.
6. Commande de build : `bash scripts/build-site.sh`. Répertoire de sortie : `_site`.
7. **Enregistrer et déployer**. Le premier build dure une à deux minutes (le jeu pèse 150 Mo).
8. Puis, dans **Paramètres → Builds** :
   - **Contrôle des branches** : production = `main` ; aperçus = **Aucun** ou **Branches personnalisées** (seulement les branches de travail utiles). Sinon, chaque branche du dépôt est publiée sur une adresse `xxxx.belfort-systems.pages.dev` publique, y compris d'anciennes branches qui contiennent de vraies données.
   - **Chemins surveillés** (facultatif, pour économiser les 500 builds par mois) : exclure `ASSETS - CONCEPTS - ARTS/*`, `api/*`, `docs/*`.
9. **Paramètres → Général → Politique d'accès** : activer, pour que les aperçus de branches ne soient visibles que par Damien (Cloudflare Access).

## B. Tester sur belfort-systems.pages.dev

Ouvrir `https://belfort-systems.pages.dev` et vérifier :

| Page | À contrôler |
|---|---|
| `/` | La page s'affiche, les polices et images aussi |
| `/qui-suis-je/` | Idem |
| `/ecorce/` | Renvoie vers jeu.belfort-systems.fr |
| `/admin/` | La page s'affiche (la connexion à l'API échouera ici : normal, voir ci-dessous) |
| `/espace-breteuil/` | L'écran d'accueil s'affiche |
| `/api/`, `/docs/`, `/admin/apercu/clients.json`, `/scripts/build-site.sh` | **Doivent répondre « 404 »** |

En-têtes : `F12` → **Réseau** → recharger → cliquer sur la page → **En-têtes de réponse** : on doit voir `content-security-policy`, `strict-transport-security`, `x-robots-tag: noindex` (sur pages.dev). **Console** : aucune ligne « Content Security Policy ».

> **Le formulaire de contact et le tableau de bord ne marchent pas sur pages.dev** : le Worker n'accepte que l'origine `https://belfort-systems.fr` (variable `ORIGINES`). Pour tester, ajouter temporairement l'adresse dans `api/wrangler.toml` :
> ```toml
> ORIGINES = "https://belfort-systems.fr,https://belfort-systems.pages.dev"
> ```
> puis pousser sur `main` (le workflow « Déployer le service » redéploie le Worker). La retirer à l'étape D si on ne veut pas que la copie pages.dev puisse appeler l'API.

## C. Brancher belfort-systems.fr et www sur Pages

1. Dans Cloudflare → **DNS** de belfort-systems.fr, **noter** (capture ou copie) les enregistrements actuels vers GitHub Pages. En général :

   | Type | Nom | Contenu |
   |---|---|---|
   | A | `@` | 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153 |
   | AAAA | `@` | 2606:50c0:8000::153 … 8003::153 (si présents) |
   | CNAME | `www` | `startupp.github.io` |

   Noter aussi s'ils sont **proxifiés** (nuage orange) ou **DNS seulement** (gris). C'est le plan de retour arrière.
2. Projet Pages `belfort-systems` → **Domaines personnalisés** → **Configurer un domaine** → `belfort-systems.fr` → **Continuer**.
   - La zone étant déjà chez Cloudflare, Pages propose de créer lui-même l'enregistrement (un CNAME aplati vers `belfort-systems.pages.dev`).
   - **Si Cloudflare signale des enregistrements existants** (les A/AAAA de GitHub), il propose de les remplacer : accepter. S'il refuse, supprimer les A et AAAA de `@`, puis cliquer aussitôt sur **Réessayer** : les enregistrements proxifiés basculent en quelques secondes, la coupure est négligeable.
   - Ne **jamais** créer le CNAME à la main avant d'avoir ajouté le domaine dans Pages : on obtient une erreur 522.
3. Recommencer avec `www.belfort-systems.fr` : Pages remplace le CNAME `www → startupp.github.io` par `www → belfort-systems.pages.dev`.
4. Attendre l'état **Actif** (certificat émis, de quelques minutes à une heure). Si l'état reste bloqué : vérifier qu'aucun enregistrement **CAA** n'interdit les autorités de Cloudflare (letsencrypt.org, pki.goog, ssl.com).
5. **www → belfort-systems.fr** : `_redirects` ne sait pas rediriger un nom de domaine. Créer une **règle de redirection** : Cloudflare → belfort-systems.fr → **Règles** → **Redirect Rules** → modèle « Redirect from WWW to root » (301, conserver le chemin et les paramètres).
6. Vérifier qu'il ne reste **aucun** enregistrement vers `github.io` ou `185.199.*`.

## D. Vérifier le site et le Worker

| Vérification | Résultat attendu |
|---|---|
| `https://belfort-systems.fr` | Le site s'affiche ; F12 → Réseau → en-tête `cf-ray` présent et **pas** d'en-tête `x-github-request-id` |
| `https://www.belfort-systems.fr/qui-suis-je/` | Redirection 301 vers `https://belfort-systems.fr/qui-suis-je/` |
| Formulaire de contact | Le message arrive dans le tableau de bord |
| `/admin/` | Connexion et données OK |
| Calendrier de disponibilités | S'affiche |
| `/ecorce/ancienne/` | Le jeu démarre ; une partie existante est retrouvée (même origine : le stockage du navigateur est conservé) |
| `/api/`, `/docs/`, `/admin/apercu/clients.json` | 404 |

Worker `belfort-api` : la variable `ORIGINES` (`api/wrangler.toml`) doit contenir `https://belfort-systems.fr`. Avec la redirection www → racine, `www` est inutile. Retirer `belfort-systems.pages.dev` si on l'avait ajouté à l'étape B. Si l'Espace Breteuil appelle l'API depuis son propre projet, ajouter son adresse (ex. `https://espace-breteuil.pages.dev`).

## E. Désactiver GitHub Pages

Une fois D validé (attendre 24 h de bon fonctionnement si possible) :

1. GitHub → dépôt → **Settings → Pages** → **Custom domain** : vider le champ et enregistrer, puis **Source** : *None* (ou « Unpublish site »).
2. Supprimer le workflow `.github/workflows/deploy-pages.yml` (ou, pour le garder sous la main, retirer `push:` de son bloc `on:` pour qu'il ne parte plus tout seul).
3. Supprimer les fichiers `CNAME` et `.nojekyll` à la racine du dépôt (le build ne les publie déjà plus sur Cloudflare).
4. Facultatif mais conseillé : **Settings (du compte) → Pages → Verified domains** → vérifier `belfort-systems.fr`. Personne d'autre ne pourra alors rattacher ce domaine à un site GitHub Pages.

## F. Passer le dépôt en privé

1. GitHub → dépôt → **Settings → General → Danger Zone → Change visibility → Private**.
2. Vérifier dans Cloudflare → projet Pages → **Déploiements** qu'un nouveau push sur `main` construit toujours (l'application GitHub de Cloudflare garde l'accès).
3. Points à savoir :
   - Les workflows GitHub Actions (déploiement du Worker, assets TinKnight) consomment alors des **minutes** : 2 000 par mois sur un compte gratuit pour les dépôts privés *(à vérifier sur la page de facturation GitHub)*.
   - Les copies déjà faites du dépôt (clones, forks, archives) restent publiques : d'où l'étape G.

## G. Facultatif : effacer les données du client de l'historique Git, puis de Google

### G1. Nettoyer l'historique avec git filter-repo

Même privé, l'historique contient les anciennes versions avec de vraies données : `admin/apercu/*.json` (Château, contact, finance@…), `api/seed/` (vraies demandes et évènements), adresses @breteuil.fr dans `docs/` et `espace-breteuil/`.

> **Risques**
> - Tous les identifiants de commits changent : chaque clone existant doit être **supprimé et recloné** ; les branches et PR ouvertes deviennent inutilisables. À faire **après** avoir fusionné ou fermé toutes les PR (dont celle de l'Espace Breteuil).
> - C'est un `push --force` sur `main` : à faire une fois, en connaissance de cause, avec une sauvegarde.
> - GitHub garde les références des PR (`refs/pull/*`) et peut garder des vues en cache : seul le support GitHub peut les purger (formulaire « Remove sensitive data »).
> - Ce qui a déjà été copié ailleurs (archive.org, clones, robots) n'est pas effacé par cette opération.

Procédure (sur l'ordinateur de Damien, dépôt **déjà privé**, PR fusionnées) :

```bash
pip install git-filter-repo                      # ou : brew install git-filter-repo
git clone --mirror https://github.com/Startupp/belfort-systems.fr.git sauvegarde.git   # sauvegarde intacte, à garder
git clone https://github.com/Startupp/belfort-systems.fr.git nettoyage && cd nettoyage

# 1. Mettre de côté les versions FICTIVES actuelles (elles seront remises après)
mkdir ../fictif && cp -r admin/apercu api/seed ../fictif/

# 2. Retirer ces chemins de TOUT l'historique
git filter-repo --invert-paths \
  --path admin/apercu/ --path api/seed/demandes/ --path api/seed/evenements/ --path api/seed/seed.sql

# 3. Remplacer les adresses restantes partout dans l'historique
cat > ../remplacements.txt <<'EOF'
regex:[A-Za-z0-9._%+-]+@breteuil\.fr==>adresse@client.example
EOF
git filter-repo --replace-text ../remplacements.txt --force

# 4. Remettre les données fictives et publier
cp -r ../fictif/apercu admin/ && cp -r ../fictif/seed api/
git add -A && git commit -m "Données d'aperçu fictives (après nettoyage de l'historique)"
git remote add origin https://github.com/Startupp/belfort-systems.fr.git
git push --force --all origin && git push --force --tags origin
```

Puis : vérifier `git log -S "breteuil.fr" --all` (aucun résultat attendu hors adresses fictives), supprimer les anciens clones (dont ceux des agents), et demander au support GitHub de purger les vues en cache. Attention : l'étape 3 remplace aussi les adresses Microsoft utilisées par l'Espace Breteuil dans son code ; si l'appli en a besoin, il faut les garder hors dépôt (configuration) **avant** le nettoyage.

### G2. Faire retirer les adresses de Google

1. **Search Console** → propriété `belfort-systems.fr` (la créer et la vérifier par DNS si besoin : Cloudflare ajoute l'enregistrement TXT).
2. **Indexation → Suppressions → Nouvelle demande → Supprimer toutes les URL avec ce préfixe**, une demande par préfixe :
   `https://belfort-systems.fr/admin/apercu/`, `/api/`, `/docs/`, `/clients/`, `/factures/`, `/espace-breteuil/`, `/ASSETS%20-%20CONCEPTS%20-%20ARTS/`.
3. Cette suppression est **temporaire (environ 6 mois)** : elle devient définitive parce que ces adresses répondent maintenant 404 (ou `noindex`). Vérifier avec l'outil **Inspection d'URL**.
4. Même chose côté Bing (Bing Webmaster Tools → Content Removal), et demander l'exclusion sur archive.org si des captures existent (`https://web.archive.org/web/*/belfort-systems.fr/*`).

---

## Espace Breteuil : deux projets Pages ou un seul ?

**Recommandation : garder deux projets**, c'est-à-dire une origine séparée pour l'appli (d'accord avec Damien).

| | Un seul projet (`belfort-systems.fr/espace-breteuil/`) | Deux projets (site + `espace-breteuil`) |
|---|---|---|
| Isolation | L'appli partage l'origine du site : le stockage du navigateur, les jetons Microsoft (MSAL) et le service worker sont exposés à toute faille d'une autre page du site (ancien jeu, coffres avec scripts inline) | Origine à part : une faille du site ne touche pas l'appli, et inversement |
| Sécurité | Une seule CSP par chemin, mêlée aux règles du site | CSP, `noindex` et Cloudflare Access sur **tout** l'hôte de l'appli |
| Microsoft (Azure) | Adresse de redirection liée au site | Adresse de redirection propre et stable |
| Déploiements | Chaque retouche de l'appli republie le site (et l'inverse) | Indépendants ; l'appli peut avoir ses propres aperçus protégés |
| Coût | — | Gratuit (100 projets par compte) |

Mise en œuvre :
1. L'appli a déjà son projet (`espace-breteuil.pages.dev`, sortie `espace-breteuil`). Lui donner idéalement un sous-domaine (ex. `espace.belfort-systems.fr`) et l'ajouter dans l'inscription d'application Azure (adresses de redirection).
2. Protéger ce projet par **Cloudflare Access** (Paramètres → Politique d'accès) si l'appli ne doit être vue que du personnel du Château.
3. Ajouter son adresse à `ORIGINES` du Worker si elle appelle l'API.
4. Quand l'adresse dédiée est en service : retirer `espace-breteuil` de `PUBLIC` (`scripts/build-site.sh`) et décommenter la redirection prévue dans `scripts/site/_redirects`.

---

## Limites des offres gratuites Cloudflare

Relevées dans la documentation officielle le 18 octobre 2026 (les liens font foi).

**Pages** — [developers.cloudflare.com/pages/platform/limits](https://developers.cloudflare.com/pages/platform/limits/)

| Limite | Offre gratuite | Notre site |
|---|---|---|
| Builds | 500 par mois, 1 à la fois, 20 min maximum chacun | quelques dizaines par mois |
| Fichiers par site | 20 000 | environ 4 300 (dont 4 200 pour l'ancien jeu) |
| Taille d'un fichier | 25 Mio | aucun au-dessus (vérifié par le build) |
| Domaines personnalisés | 100 par projet | 2 |
| `_headers` | 100 règles, 2 000 caractères par ligne | environ 50 (vérifié par le build) |
| `_redirects` | 2 000 statiques + 100 dynamiques | 2 |
| Projets | 100 par compte | 2 |
| Aperçus | illimités ; publics par défaut (protéger avec la politique d'accès) | |

**Workers** — [developers.cloudflare.com/workers/platform/limits](https://developers.cloudflare.com/workers/platform/limits/)

| Limite | Offre gratuite |
|---|---|
| Requêtes | 100 000 par jour |
| Temps processeur | 10 ms par requête |
| Sous-requêtes | 50 par requête |
| Tâches planifiées (Cron) | 5 par compte |
| Workers | 100 par compte |

**D1** — [developers.cloudflare.com/workers/platform/pricing](https://developers.cloudflare.com/workers/platform/pricing/#d1)

| Limite | Offre gratuite |
|---|---|
| Lignes lues | 5 millions par jour |
| Lignes écrites | 100 000 par jour |
| Stockage | 5 Go au total |
| Taille maximale d'une base, nombre de bases | *à vérifier* sur [d1/platform/limits](https://developers.cloudflare.com/d1/platform/limits/) |

Depuis le 1er septembre 2026, une fois ces quotas journaliers atteints, les requêtes D1 **échouent** jusqu'à minuit UTC (les données restent intactes) ; Cloudflare prévient par mail.

**KV** (sessions, limitation de débit) — [developers.cloudflare.com/kv/platform/limits](https://developers.cloudflare.com/kv/platform/limits/) : 100 000 lectures et **1 000 écritures par jour**, 1 Go. À surveiller : la limitation de débit écrit dans KV à chaque requête comptée.

**Cloudflare Access** (pour `/admin/`, les aperçus, l'Espace Breteuil) : gratuit jusqu'à 50 utilisateurs *(à vérifier sur la page des offres Zero Trust)*.
