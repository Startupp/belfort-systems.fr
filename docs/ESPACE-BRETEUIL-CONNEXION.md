# Espace Breteuil — mise en service de la version connectée (test réel)

> **Ordre pour le premier essai** (depuis la Surface, sans rien installer) :
> 1. Pages : projet `espace-breteuil`, branche de production **`main`** (§ 1).
> 2. Entra : inscription SPA + permissions + consentement (§ 2 et 3).
> 3. Entra : **affectation requise** → Pauline, François, Damien (§ 3).
> 4. GitHub, dans le navigateur : coller le `clientId` dans `config.js` (§ 2.6).
> 5. Ouvrir l'appli → **Se connecter**. La **pastille de l'en-tête** doit passer au vert.
>    Orange ou rouge : la toucher, ou **Moi → Réglages → Détails techniques** (§ 6) →
>    « Copier le rapport » et le coller dans un message.
> 6. v4 : pour l'écran **Déléguer**, ajouter la permission **RoleManagement.ReadWrite.Directory**
>    (§ 3 bis). Ce n'est pas nécessaire pour le reste de l'appli.
> 7. Seulement ensuite, le test avec Pauline (§ 7).

Objectif : que Pauline se connecte avec **pdebreteuil@breteuil.fr** et utilise pour de
vrai :

- le dossier commun : naviguer, créer un dossier dans « Commun » ou juste au-dessus,
  renommer, déplacer ;
- l'écran « Qui a accès ? » : droits hérités ou personnalisés, « Partager uniquement
  avec… », ajouter ou retirer une personne, rétablir les droits du dossier parent ;
- les personnes : fiche « Ce que je peux utiliser », licences, étiquette **EXTERNE** ;
- « Comprendre l'organisation ».

L'appli agit **uniquement avec les droits de Pauline** (permissions déléguées). Les jetons
sont gardés **le temps de la session de l'onglet** (voir « Session et sécurité » plus bas),
jamais dans `localStorage`. Aucun secret n'est dans le dépôt : `clientId` et `tenantId` ne
sont pas des secrets.

Durée estimée : 30 à 45 minutes. Ordre : 1 → 2 → 3 → 4 → 5 → 6 → 7.

---

## 1. Créer le projet Cloudflare Pages (5 min)

L'appli est un site statique. Elle tient entièrement dans le dossier `espace-breteuil/`
(polices, icônes, MSAL 3.30.0 dans `vendor/`). Elle est servie sur une **origine séparée**
de belfort-systems.fr.

1. Cloudflare → **Workers & Pages** → **Créer** → onglet **Pages** → **Se connecter à Git**.
2. Choisir le dépôt **Startupp/belfort-systems.fr**.
3. Réglages :

   | Champ | Valeur |
   |---|---|
   | Nom du projet | `espace-breteuil` (l'adresse sera `https://espace-breteuil.pages.dev`) |
   | Branche de production | **`main`** (les PR #7, #8 et #9 sont fusionnées) |
   | Préréglage du framework | Aucun |
   | Commande de build | *(vide)* |
   | Répertoire de sortie du build | `espace-breteuil` |

4. **Enregistrer et déployer**. Noter l'adresse exacte, par exemple
   `https://espace-breteuil.pages.dev/`.
5. Vérifier les en-têtes de sécurité (fichier `espace-breteuil/_headers`, appliqué
   automatiquement par Pages) :

   ```bash
   curl -sI https://espace-breteuil.pages.dev/ | grep -iE "content-security|x-frame|strict-transport"
   ```

   La CSP n'autorise que : le site lui-même, `login.microsoftonline.com`,
   `graph.microsoft.com`, `breteuil02.sharepoint.com`, `breteuil02-my.sharepoint.com`
   (et `*.sharepoint.com` pour les redirections de contenu Graph) et le Worker
   `belfort-api`. Aucune iframe chez autrui (`frame-ancestors 'none'`,
   `X-Frame-Options: DENY`) et aucun script externe. Le test `tests/csp.test.mjs` vérifie
   que la CSP couvre bien tout ce que `config.js` utilise.

   Si le projet existe déjà sur `feat/espace-breteuil-v1` : projet Pages → **Paramètres →
   Builds et déploiements → Branche de production** → `main` → Enregistrer, puis
   **Déploiements → Réessayer le déploiement** sur le dernier commit de `main`.

**Plus tard, le sous-domaine** : projet Pages → **Domaines personnalisés** →
`breteuil.belfort-systems.fr`. La zone est chez Cloudflare, donc le CNAME est créé tout
seul. Il faudra alors ajouter cette adresse dans Entra (étape 2.4) et dans le Worker
(étape 5).

---

## 2. Inscrire l'appli dans Entra ID, tenant du Château (10 min)

Se connecter sur <https://entra.microsoft.com> avec le compte d'administration du Château.

1. **Identité** → **Applications** → **Inscriptions d'applications** → **Nouvelle inscription**.
2. Nom : `Espace Breteuil`. Types de comptes : **Comptes dans cet annuaire
   organisationnel uniquement** (locataire unique).
3. URI de redirection : plateforme **Application monopage (SPA)**, adresse
   **`https://espace-breteuil.pages.dev/`**. Elle doit être identique à l'adresse de
   l'appli, barre oblique finale comprise.
4. Après la création, **Authentification** → **Ajouter un URI** si besoin :
   - `https://breteuil.belfort-systems.fr/` (plus tard, pour le sous-domaine) ;
   - `http://localhost:8766/` (facultatif, pour tester en local).

   Laisser **décochés** « Jetons d'accès » et « Jetons d'ID » (flux implicite inutile).
   Laisser « Autoriser les flux de clients publics » sur **Non**.
5. **Vue d'ensemble** : copier l'**ID d'application (client)** (icône Copier à droite).
   Pas l'« ID d'objet », pas l'« ID de l'annuaire (locataire) ».
6. **Coller le clientId depuis la Surface, sans rien installer (interface web GitHub)** :
   1. Ouvrir <https://github.com/Startupp/belfort-systems.fr/blob/main/espace-breteuil/config.js>.
   2. Cliquer sur le **crayon** ✏️ (« Edit this file »), en haut à droite du fichier.
   3. Repérer l'encadré `👉👉👉 À REMPLIR PAR DAMIEN`. Juste dessous, coller le code
      **entre les guillemets** :

      ```js
      clientId: "1a2b3c4d-1234-5678-9abc-def012345678",
      ```

      Ne rien changer d'autre (garder la virgule finale).
   4. Bouton vert **Commit changes…** → message « Espace Breteuil : clientId » →
      **Commit directly to the main branch** → **Commit changes**.
   5. Pages redéploie tout seul en environ 1 minute (Cloudflare → projet → Déploiements :
      le dernier doit être « Réussi »).

   Tant que `clientId` est vide, l'appli reste en mode démo et l'écran « Vérifier la
   connexion » le dit en rouge dès la 1ʳᵉ ligne.

---

## 3. Permissions déléguées (5 min)

**API autorisées** → **Ajouter une autorisation**.

**Microsoft Graph → Autorisations déléguées :**

| Permission | Pourquoi |
|---|---|
| `User.Read` | Connexion, nom de la personne connectée |
| `User.ReadBasic.All` | Noms et photos de l'équipe (demandée, recouverte par la suivante) |
| `User.Read.All` | Liste des personnes avec licences attribuées, compte actif ou non, invités |
| `Directory.Read.All` | Licences du tenant (`subscribedSkus`), rôles d'administration (« Qui gère quoi ») |
| `Files.ReadWrite.All` | Dossier commun : lister, créer, renommer, déplacer, inviter une adresse extérieure |
| `Sites.ReadWrite.All` | Trouver le site « ChateaudeBreteuil » et sa bibliothèque Documents |

**SharePoint → Autorisations déléguées :**

| Permission | Pourquoi |
|---|---|
| `AllSites.FullControl` | Lire et **changer les droits d'un dossier** : `breakroleinheritance`, `ensureuser`, `addroleassignment`, retrait, `resetroleinheritance` |

**Pourquoi `AllSites.FullControl` plutôt que `AllSites.Manage`** : `AllSites.Manage`
permet de créer et modifier des listes et des éléments, mais **pas de gérer les
autorisations**. Or c'est le cœur de l'écran « Qui a accès ? ». Avec une permission
**déléguée**, l'appli n'a jamais plus de droits que la personne connectée. Si Pauline
n'est pas propriétaire du site, SharePoint refuse, même avec FullControl. Pour essayer
le minimum : remplacer `sharepointScope` dans `config.js` par
`https://breteuil02.sharepoint.com/AllSites.Manage` et ne consentir qu'à celle-ci. La
lecture des droits marchera ; leur modification renverra « Vous n'avez pas le droit ».

**Consentement administrateur** (avec l'**accord de François**) : bouton **Accorder un
consentement d'administrateur pour Château de Breteuil** → Oui. Toutes les lignes doivent
passer au vert « Accordé ».

**À faire : limiter l'appli à Pauline, François et Damien (affectation requise).**

1. **Applications d'entreprise** → `Espace Breteuil` → **Propriétés** → **Affectation
   requise ?** : **Oui** → Enregistrer.
2. **Utilisateurs et groupes** → **Ajouter un utilisateur/groupe** → sélectionner
   **Pauline**, **François** et **Damien** (le compte de Damien dans le tenant du Château)
   → Attribuer.

Tout autre compte du Château verra l'erreur **AADSTS50105** ; l'appli l'explique en clair
(« Votre compte n'est pas autorisé… ») avec la marche à suivre.

**Révoquer à tout moment** (du plus doux au plus radical) :

1. **Applications d'entreprise** → `Espace Breteuil` → **Propriétés** → *Activé pour la
   connexion des utilisateurs* : **Non**. Plus personne ne peut se connecter.
2. **Applications d'entreprise** → `Espace Breteuil` → **Autorisations** → **Examiner
   les autorisations** → révoquer.
3. **Inscriptions d'applications** → `Espace Breteuil` → **Supprimer**.

Les jetons déjà émis expirent en une heure au plus.

---

## 3 bis. v4 : la permission de l'écran « Déléguer » (5 min, seulement pour l'administrateur général)

L'écran **Gérer → Déléguer** (visible uniquement par un administrateur général : François,
Damien) permet, pour de vrai :

- de **rendre une personne propriétaire du site SharePoint du Château**, ou de lui retirer ce
  rôle : REST SharePoint sur le groupe des propriétaires du site, avec les permissions
  **déjà en place** (`AllSites.FullControl`) — rien à ajouter ;
- de **donner ou retirer un rôle d'annuaire** : Administrateur de facturation, Administrateur des
  utilisateurs, Administrateur Exchange (et Administrateur général) — Graph
  `roleManagement/directory/roleAssignments`. Cela demande **une permission déléguée
  nouvelle** :

| Permission (Microsoft Graph, déléguée) | Pourquoi |
|---|---|
| `RoleManagement.ReadWrite.Directory` | Créer et supprimer des attributions de rôle d'annuaire (`POST` / `DELETE roleAssignments`). Aucune permission déjà accordée ne le permet : `Directory.Read.All` ne fait que lire. |

**Pourquoi elle n'est pas demandée à la connexion** : c'est une permission très puissante, utile
à une ou deux personnes, quelques fois par an. L'appli la demande **seulement au moment
d'utiliser l'écran Déléguer** (« consentement incrémental », bouton **Autoriser la gestion des
rôles**, par redirection). Pour tous les autres, rien ne change. Et comme toute permission
**déléguée**, elle ne donne jamais plus que les droits de la personne : chez Microsoft, seul un
administrateur général (ou « Administrateur des rôles privilégiés ») peut attribuer des rôles.

À faire par Damien :

1. Entra → **Inscriptions d'applications** → `Espace Breteuil` → **API autorisées** →
   **Ajouter une autorisation** → Microsoft Graph → **Autorisations déléguées** →
   `RoleManagement.ReadWrite.Directory` → Ajouter.
2. **Accorder un consentement d'administrateur pour Château de Breteuil** (avec l'accord de
   François) → la ligne passe au vert « Accordé ».
3. Dans l'appli : **Gérer → Déléguer → Autoriser la gestion des rôles**. Les boutons « Donner ce
   rôle… » et « Retirer » s'activent.

Tant que ce n'est pas fait, l'écran l'affiche clairement : « Damien doit ajouter la permission
RoleManagement.ReadWrite.Directory dans Entra, puis accorder le consentement ». La liste des
titulaires reste lisible (`/directoryRoles`, `Directory.Read.All`).

**Garde-fous** (testés : `tests/profil.test.mjs`) : impossible de retirer son propre rôle
d'administrateur général ; impossible de retirer le dernier administrateur général ; impossible
de se retirer soi-même ou de retirer le dernier propriétaire du site ; **confirmation en 2
étapes** ; chaque action est notée dans le **journal des délégations** (sur l'appareil) — la
trace officielle reste le journal d'audit d'Entra. Un rôle attribué par un groupe ou en
« éligible » (PIM) ne se retire pas depuis l'appli : elle le dit et renvoie vers Entra.

**Note** : si le site du Château est relié à un groupe Microsoft 365, « propriétaire du site »
dans l'appli = membre du groupe SharePoint des propriétaires ; cela ne rend pas propriétaire du
groupe Microsoft 365 (gestion des groupes : pas pour l'instant).

**Aucune autre permission n'est ajoutée en v4** : les épingles de boîtes partagées sont de
simples liens (aucune lecture ni envoi de mails) ; l'onglet Fichiers utilise
`Files.ReadWrite.All` et `Sites.ReadWrite.All`, déjà accordées ; le planning reste en lecture
(l'écriture dans l'agenda viendra plus tard).

---

## 4. Vérifier que Pauline est « Propriétaire » du site SharePoint (5 min)

Sans ce rôle, elle peut voir et créer des dossiers, mais **pas gérer les droits**.

1. Ouvrir <https://breteuil02.sharepoint.com/sites/ChateaudeBreteuil>.
2. Roue dentée → **Autorisations du site**. Si le site est relié à un groupe Microsoft 365,
   la liste s'appelle **Propriétaires du site**. Pauline doit y figurer.
3. Sinon : **Partager le site** ou **Ajouter des membres** → la choisir → rôle
   **Propriétaire**. Autre chemin : centre d'administration SharePoint → **Sites actifs**
   → *Château de Breteuil* → **Membres** → **Propriétaires** → Ajouter.
4. Vérifier aussi que le dossier **Commun** est bien à la racine de la bibliothèque
   **Documents**. Sinon, corriger `dossierCommun` dans `config.js`.

---

## 5. Planning sur la nouvelle adresse (facultatif)

Le Worker `belfort-api` n'accepte que les origines listées. C'est déjà fait dans
`api/wrangler.toml` :

```toml
ORIGINES = "https://belfort-systems.fr,https://espace-breteuil.pages.dev,https://breteuil.belfort-systems.fr"
```

(`breteuil.belfort-systems.fr` est prévu pour le futur sous-domaine.) Il reste à
redéployer le Worker (workflow GitHub après fusion, ou `cd api && npx wrangler deploy`).
Sans cela, l'appli affiche le planning d'exemple, clairement marqué, et tout le reste
fonctionne.

---

## 6. La pastille d'état et les « Détails techniques » (5 min)

v4 : plus d'écran de vérification obligatoire. Une **pastille** dans l'en-tête suit les appels
réels : 🟢 connecté, 🟠 une partie ne répond pas, 🔴 problème (session expirée, Microsoft
injoignable), gris = vérification en cours. La toucher explique le problème ; le message
apparaît aussi à l'endroit concerné (ex. Fichiers : « Le dossier commun est introuvable »).

Le diagnostic complet, pour Damien :

1. Ouvrir `https://espace-breteuil.pages.dev/` → **Se connecter** (redirection pleine page).
2. **Moi → Réglages → Détails techniques**.
3. Lire les 14 lignes. Chaque ligne a une pastille et un mot :

   | Pastille | Sens |
   |---|---|
   | 🟢 **OK** | ça marche |
   | 🟠 **À regarder** | l'appli marche en partie (ex. : pas propriétaire → « Qui a accès ? » en lecture seule) |
   | 🔴 **Bloquant** | à corriger avant d'aller plus loin ; la ligne dit **quoi faire et qui** |
   | ⚪ **Pas testé** | une étape précédente bloque |

   Les étapes : configuration → connexion → permissions accordées (lues dans le jeton) →
   Graph `/me`, `/users`, `/subscribedSkus`, `/directoryRoles` → site SharePoint → Documents
   → Commun → jeton SharePoint → REST `_api/web/currentuser` (vérifie le CORS) →
   propriétaire du site (`IsSiteAdmin` + groupe des propriétaires) → droit
   `ManagePermissions` (`effectivebasepermissions`).
4. **Copier le rapport** et le coller dans un message à Damien. Il ne contient ni jeton,
   ni mot de passe, ni adresse mail complète (`p•••@breteuil.fr`).

**Les blocages les plus probables et leur remède :**

| Message de l'appli | Code | Remède |
|---|---|---|
| « L'appli n'a pas encore été autorisée pour le Château » | AADSTS65001 | § 3 : consentement administrateur (François) |
| « L'adresse de l'appli n'est pas déclarée chez Microsoft » | AADSTS50011 | § 2.3 : URI exacte, barre oblique finale comprise |
| « …déclarée avec le mauvais type de plateforme » | AADSTS9002326 | § 2.3 : plateforme **SPA**, pas « Web » |
| « Votre compte n'est pas autorisé à utiliser cette appli » | AADSTS50105 | § 3 : ajouter le compte dans Utilisateurs et groupes |
| « Microsoft ne trouve pas l'appli dans le Château » | AADSTS700016 | § 2.6 : mauvais `clientId` (ID d'objet collé ?) |
| « Une permission n'a pas été accordée à l'appli » | HTTP 403 | § 3 : permission manquante ou non accordée |
| « SharePoint refuse : votre compte n'a pas ce droit » | HTTP 403 (SP) | § 4 : devenir Propriétaire du site |
| « SharePoint refuse de répondre à l'appli (CORS) » | CORS | ouvrir l'adresse officielle ; vérifier CSP et permission SharePoint |
| « Le site SharePoint du Château est introuvable » | HTTP 404 | adresse `site` dans `config.js` |
| « Microsoft est très sollicité » | HTTP 429 | rien : l'appli réessaie seule (3 fois), puis réessayer plus tard |

---

## Session et sécurité (compromis assumé)

MSAL garde les jetons dans **`sessionStorage`** : la connexion tient **tant que l'onglet
ou l'appli installée reste ouvert**, sans se reconnecter à chaque écran.

- **Effacé** dès qu'on ferme l'onglet ou qu'on quitte vraiment l'appli (glisser vers le
  haut sur iPhone). Rien ne reste sur le téléphone d'un jour à l'autre.
- **Jamais `localStorage`** pour les jetons (il survivrait à la fermeture).
- **Risque accepté** : pendant que l'onglet est ouvert, un script malveillant exécuté
  dans la page pourrait lire `sessionStorage`. Parade : la CSP n'autorise **que** les
  scripts du site (`script-src 'self'`, aucun script externe, MSAL livré dans `vendor/`),
  et tout texte venant de Microsoft est inséré comme texte, jamais comme HTML.
- Les jetons d'accès durent **1 heure au plus**. « Se déconnecter de l'appli » vide le
  cache MSAL de l'onglet. Pour couper tout de suite : § 3 « Révoquer à tout moment ».
- v4 : les réponses Microsoft sont gardées **en mémoire** le temps de la session (rien sur
  le disque) ; `sessionStorage` garde aussi le dernier profil connu (uniquement les rôles,
  pour afficher les bons onglets tout de suite). Sur l'appareil (`localStorage`) : réglages,
  épingles (adresses de boîtes partagées, liens de dossiers) et journal « Ce que j'ai fait ».

---

## 7. Test avec Pauline (15 min)

Sur son téléphone, dans Safari ou Chrome :

- [ ] Ouvrir `https://espace-breteuil.pages.dev/` → **Se connecter** →
      `pdebreteuil@breteuil.fr` (+ 2ᵉ facteur s'il est actif). Retour dans l'appli : onglets
      Planning, Fichiers, Équipe, Moi ; pastille verte ; **Fichiers** → Dossier commun.
- [ ] **Le dossier commun** : les dossiers de « Commun » apparaissent en grosses tuiles,
      et le fil d'Ariane indique « Documents › Commun ».
- [ ] **Nouveau dossier** → « Dans Commun » → `Test Pauline` → Continuer → 2
      confirmations. Le dossier apparaît (vérifier aussi dans SharePoint).
- [ ] Recommencer avec « Juste au-dessus » : le dossier est créé à côté de Commun.
- [ ] Sur `Test Pauline` : **⋯ → Renommer**, puis **⋯ → Déplacer vers…**.
- [ ] **Qui a accès ?** sur Commun : bandeau « Hérités du dossier parent », groupes du site,
      niveaux « Peut voir » / « Peut modifier ». Toucher **EXTERNE** affiche
      l'explication.
- [ ] Sur `Test Pauline` : **Partager uniquement avec…** → décocher un groupe (par exemple
      Visiteurs) → ajouter Yara en « Peut voir » → Continuer → récapitulatif → 2
      confirmations. Le bandeau devient « Droits personnalisés ». Pauline et les
      propriétaires restent marqués 🔒, et on ne peut pas les retirer.
- [ ] **Modifier** sur Yara → « Pas d'accès » → confirmer. Elle disparaît de la liste.
- [ ] **Rétablir les droits du dossier parent** → confirmer. Le bandeau redevient
      « Hérités ».
- [ ] **Les personnes** : filtre Boîtes partagées, puis Externes. Fiche d'une personne
      Business Standard et d'une personne Business Basic. **Voir les licences** : les
      compteurs correspondent au centre d'administration.
- [ ] **Comprendre l'organisation** : toucher une licence, une boîte partagée, le dossier
      Commun, « Qui gère quoi ».
- [ ] **Ce que j'ai fait** : toutes les actions du test y figurent.
- [ ] Supprimer `Test Pauline` dans SharePoint (la suppression n'existe pas dans l'appli,
      volontairement).

---

## Ce qui a été testé, et ce qui ne l'a pas été

**Testé hors ligne** (Playwright, réponses Graph et SharePoint maquettées, `?maquette=1`
sur localhost uniquement), à 375 px et 1280 px, en thème sombre et en très grand texte :

- tous les écrans ;
- l'ordre exact des appels :
  - `POST …/Commun:/children` ;
  - `breakroleinheritance(copyRoleAssignments=true,clearSubscopes=true)` → retrait
    `getbyprincipalid(n)` (DELETE) → `ensureuser` → `addroleassignment(principalid,roledefid)` ;
  - `resetroleinheritance` ;
- les garde-fous (soi-même et propriétaires jamais retirables) ;
- l'étiquette EXTERNE ;
- le masquage de l'« Accès limité ».

**Pas testé en réel** (pas d'accès au tenant de mon côté) :

- connexion MSAL et consentement (pastille d'état et Réglages → Détails techniques) ;
- réponses réelles de Graph et SharePoint : formes exactes, `sharePointIds`, groupes
  `SharingLinks` ;
- CORS de l'API REST SharePoint avec un jeton OAuth (normalement accepté, à confirmer au
  premier test) ;
- invitation d'une adresse extérieure : elle dépend des réglages de partage externe du
  tenant ;
- suffisance de `AllSites.Manage`.

**Testé hors ligne aussi** : l'écran « Détails techniques » dans 4 cas maquettés
(tout vert, consentement manquant, CORS refusé, non propriétaire), à 375 px et 1280 px :
`NODE_PATH=$(npm root -g) node espace-breteuil/tests/diagnostic.playwright.mjs`.

En cas d'erreur, l'appli affiche un message simple, l'action à faire et le détail technique
en petit : ouvrir **Moi → Réglages → Détails techniques → Copier le rapport** et l'envoyer à
Damien.

**v4, testé hors ligne** (`tests/v4.playwright.mjs`, `?maquette=1`) : premier lancement, 4 profils
maquettés (administrateur général, propriétaire du site, facturation, simple collaborateur) à
375 et 1280 px — onglets attendus seulement, routes réservées refusées, aucune erreur console ;
Déléguer (permission absente puis accordée, garde-fous, corps exact du `POST roleAssignments`) ;
Fichiers (`createLink` interne, téléversement) ; épingles ; dossier commun introuvable (pastille
orange et message) ; semaine « ajustée » à 320, 375, 414, 768 et 1280 px. **Pas testé en réel** :
`/me/transitiveMemberOf` et `roleAssignments` sur le tenant, le consentement incrémental, l'ouverture
de l'appli Outlook sur téléphone.
