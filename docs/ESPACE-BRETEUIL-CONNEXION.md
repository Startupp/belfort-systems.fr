# Espace Breteuil — mise en service de la version connectée (ce soir)

Objectif : que Pauline se connecte avec **pdebreteuil@breteuil.fr** et utilise pour de
vrai :

- le dossier commun : naviguer, créer un dossier dans « Commun » ou juste au-dessus,
  renommer, déplacer ;
- l'écran « Qui a accès ? » : droits hérités ou personnalisés, « Partager uniquement
  avec… », ajouter ou retirer une personne, rétablir les droits du dossier parent ;
- les personnes : fiche « Ce que je peux utiliser », licences, étiquette **EXTERNE** ;
- « Comprendre l'organisation ».

L'appli agit **uniquement avec les droits de Pauline** (permissions déléguées). Les jetons
restent **en mémoire** et ne sont jamais enregistrés sur le téléphone. Aucun secret
n'est dans le dépôt : `clientId` et `tenantId` ne sont pas des secrets.

Durée estimée : 30 à 45 minutes. Ordre : 1 → 2 → 3 → 4 → 5 → 6.

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
   | Branche de production | `feat/espace-breteuil-v1` pour le test de ce soir (puis `main` après la fusion) |
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
   `graph.microsoft.com`, `*.sharepoint.com` et le Worker `belfort-api`. Aucune iframe
   (`frame-ancestors 'none'`, `X-Frame-Options: DENY`) et aucun script externe.

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
5. **Vue d'ensemble** : copier l'**ID d'application (client)**.
6. Dans le dépôt, fichier `espace-breteuil/config.js`, renseigner :

   ```js
   microsoft: {
     clientId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",   // ← ID d'application (client)
     tenantId: "breteuil02.onmicrosoft.com",             // déjà rempli
     ...
   ```

   Faire un commit sur `feat/espace-breteuil-v1` : Pages redéploie tout seul en environ
   1 minute. Tant que `clientId` est vide, l'appli reste en mode démo.

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

**Recommandé : limiter l'appli à Pauline et François.**
**Applications d'entreprise** → `Espace Breteuil` → **Propriétés** → **Affectation
requise : Oui** → **Utilisateurs et groupes** → ajouter Pauline et François. Les autres
comptes ne pourront pas s'y connecter.

**Révoquer à tout moment** (du plus doux au plus radical) :

1. **Applications d'entreprise** → `Espace Breteuil` → **Propriétés** → *Activé pour la
   connexion des utilisateurs* : **Non**. Plus personne ne peut se connecter.
2. **Applications d'entreprise** → `Espace Breteuil` → **Autorisations** → **Examiner
   les autorisations** → révoquer.
3. **Inscriptions d'applications** → `Espace Breteuil` → **Supprimer**.

Les jetons déjà émis expirent en une heure au plus.

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

## 5. Planning sur la nouvelle adresse (facultatif ce soir)

Le Worker `belfort-api` n'accepte que les origines listées. Ajouter l'adresse Pages dans
`api/wrangler.toml` :

```toml
ORIGINES = "https://belfort-systems.fr,https://espace-breteuil.pages.dev"
```

Puis déployer le Worker (`cd api && npx wrangler deploy`, ou fusionner). Sans cela,
l'appli affiche le planning d'exemple, clairement marqué, et tout le reste fonctionne.

---

## 6. Test avec Pauline (15 min)

Sur son téléphone, dans Safari ou Chrome :

- [ ] Ouvrir `https://espace-breteuil.pages.dev/`, puis onglet **Château** →
      **Se connecter avec Microsoft** → `pdebreteuil@breteuil.fr` (+ 2ᵉ facteur s'il est
      actif). Retour dans l'appli, « Connecté à Microsoft ».
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

- connexion MSAL et consentement ;
- réponses réelles de Graph et SharePoint : formes exactes, `sharePointIds`, groupes
  `SharingLinks` ;
- CORS de l'API REST SharePoint avec un jeton OAuth (normalement accepté, à confirmer au
  premier test) ;
- invitation d'une adresse extérieure : elle dépend des réglages de partage externe du
  tenant ;
- suffisance de `AllSites.Manage`.

En cas d'erreur, l'appli affiche un message simple et le détail technique en petit :
faire une capture et l'envoyer à Damien.
