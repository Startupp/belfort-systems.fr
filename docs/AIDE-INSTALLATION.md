# Installer « Aide et demandes » (Espace Breteuil v5.4)

Ce guide s'adresse à Damien. Il se fait **une seule fois**, dans le tableau de bord Cloudflare,
en 20 minutes environ. Rien à coder : on clique, on colle.

Tant que ce n'est pas fait, l'appli affiche : « L'aide n'est pas encore installée — appelez
Damien au 06 09 89 74 43 ». Rien ne casse.

> **À retenir — aucune adresse ni aucun secret dans GitHub.** Les adresses mail et le secret se
> tapent **uniquement** dans Cloudflare (étape 5). Le dépôt est public.

---

## Ce que ça fait

| Qui | Quoi |
|---|---|
| Un salarié du Château | Touche le bouton **?** (en bas à droite), choisit Question / Avis / Amélioration / Problème, écrit, envoie. Il voit ses demandes dans le même panneau, et dans **Moi → Mes demandes**. |
| Damien | Reçoit un mail : « Application Breteuil - Retour client - Problème - n°12 ». Il **répond au mail** : sa réponse s'ajoute à la demande. Ou il répond dans l'appli : **Moi → Demandes (toutes)**. |
| Le salarié | Une **pastille rouge** apparaît sur le bouton **?** quand Damien a répondu. |

---

## Étape 1 — Créer la base de données

1. Ouvrir [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **D1 SQL Database**
   ([lien direct](https://dash.cloudflare.com/?to=/:account/workers/d1)).
2. **Create database** → nom : `breteuil-aide` → **Create**.

Les tables se créent toutes seules au premier usage. Rien d'autre à faire ici.

## Étape 2 — Brancher la base sur le Worker

1. **Workers & Pages** → **belfort-api** → **Settings** (Paramètres) → **Bindings** (Liaisons) → **Add binding**.
2. Choisir **D1 database**.
3. Variable name : `AIDE_DB` — Database : `breteuil-aide` → **Add binding** (ou **Deploy**).

## Étape 3 — Recevoir les mails sur `aide.belfort-systems.fr`

> **Attention :** on active le routage **seulement pour le sous-domaine** `aide.belfort-systems.fr`.
> Ne pas toucher au domaine principal `belfort-systems.fr` : vos mails actuels doivent continuer comme avant.
>
> **STOP si Cloudflare propose de supprimer ou de remplacer les enregistrements MX de
> `belfort-systems.fr`** (ceux de votre messagerie actuelle). Cliquez sur **Annuler** et prévenez-moi :
> on utilisera un autre domaine pour l'aide (seule la variable `AIDE_EXPEDITEUR` change, rien dans le code).

1. Ouvrir **Email Routing** : [lien direct](https://dash.cloudflare.com/?to=/:account/email-service/routing)
   (selon l'affichage : **Compute** → **Email Service** → **Email Routing**, ou domaine → **Email** → **Email Routing**).
   Choisir **belfort-systems.fr** → **Settings**.
2. Rubrique **Subdomains** : taper `aide` (pour `aide.belfort-systems.fr`) → valider.
   Cloudflare ajoute lui-même les enregistrements DNS (MX et TXT) **sur `aide.belfort-systems.fr`
   seulement** ([documentation](https://developers.cloudflare.com/email-service/configuration/subdomains/)).
3. Toujours dans **Settings** : activer **Subaddressing** (adresses avec « + »).
4. Onglet **Destination addresses** → **Add destination address** → votre adresse **Gmail** →
   ouvrir le mail de Cloudflare dans Gmail et cliquer sur **Verify email address**.
   Tant que l'adresse n'est pas « Verified », aucun mail ne part.
5. Onglet **Routing rules** → **Create address** : adresse `demande` @ `aide.belfort-systems.fr` →
   Action : **Send to a Worker** → Destination : **belfort-api** → **Save**.

Pourquoi `demande` et pas « catch-all » ? Cloudflare ne permet le « catch-all » que sur le domaine
principal. Les mails envoyés à Damien ont comme adresse de réponse `demande+12-a1b2c3d4e5f6@aide.belfort-systems.fr` :
grâce au « + » (étape 3), ils arrivent tous sur la règle `demande@` et le Worker lit le numéro et la signature.

## Étape 4 — Autoriser le Worker à envoyer des mails

1. **Workers & Pages** → **belfort-api** → **Settings** → **Bindings** → **Add binding** → **Send email**
   ([documentation](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)).
2. Variable name : `AIDE_MAIL`.
3. Destination : choisir **votre adresse Gmail vérifiée** (étape 3.3) → **Add binding**.

## Étape 5 — Les réglages du Worker

**belfort-api** → **Settings** → **Variables and Secrets** → **Add**. Taper exactement :

| Nom | Type | Valeur |
|---|---|---|
| `AIDE_TENANT_ID` | Text | `breteuil02.onmicrosoft.com` |
| `AIDE_CLIENT_ID` | Text | le `clientId` de `espace-breteuil/config.js` (36 caractères, forme `xxxxxxxx-xxxx-…`) |
| `AIDE_EXPEDITEUR` | Text | `aide@aide.belfort-systems.fr` |
| `AIDE_DESTINATAIRE` | Text | votre adresse **Gmail** (celle vérifiée à l'étape 3) |
| `AIDE_PRESTATAIRES` | Text | vos adresses, **séparées par des virgules** : votre Gmail (pour répondre par mail) **et** votre compte du Château (`…@breteuil02.onmicrosoft.com` ou `…@breteuil.fr`, celui avec lequel vous vous connectez à l'appli) |
| `AIDE_SECRET` | **Secret** | un long texte au hasard (40 caractères ou plus). Par exemple, générez-le sur [1password.com/password-generator](https://1password.com/password-generator) ; vous n'aurez jamais à le retaper. |
| `AIDE_APPLI_URL` | Text (facultatif) | adresse de l'appli pour le lien dans le mail. Par défaut : `https://espace-breteuil.pages.dev/` |

> Le **clientId** et le **tenant** ne sont pas secrets. Les adresses, si : elles restent dans Cloudflare.
> Changer `AIDE_SECRET` plus tard rend les anciens mails impossibles à « répondre » (c'est voulu).

## Étape 6 — Mettre à jour le code du Worker

1. Ouvrir `api-planning/worker.js` sur GitHub (branche `main` une fois fusionnée) → bouton **Copy raw file**.
2. **belfort-api** → **Edit code** → tout sélectionner → coller → **Deploy**.

Les calendriers et le vérificateur de liens continuent de marcher comme avant (mêmes adresses).

## Étape 7 — Tester (5 minutes)

1. Ouvrir l'appli, se connecter, toucher **?** → **Problème** → écrire « Test » → **Envoyer à Damien**.
   Attendu : « Demande n° 1 envoyée à Damien ».
2. Dans Gmail : un mail « Application Breteuil - Retour client - Problème - n°1 » arrive
   (nom, adresse, écran, version, message, lien vers la demande).
3. **Répondre** à ce mail depuis Gmail : « Bien reçu ».
4. Dans l'appli (≈ 1 minute) : la pastille rouge apparaît sur **?**. **Mes demandes** → n°1 →
   la réponse « Bien reçu » est là, marquée « par mail ». Le statut est passé à **Répondue**.
5. **Moi → Demandes (toutes)** (visible seulement avec un compte listé dans `AIDE_PRESTATAIRES`) :
   filtrer, répondre, passer en **Résolue**.

En cas de souci : **belfort-api** → **Logs** (journal en direct) ; les erreurs commencent par « Aide ».

---

## Limites à connaître

- **Les salariés ne reçoivent pas de mail.** Cloudflare (gratuit) n'envoie des mails **qu'aux adresses
  vérifiées** de votre compte, donc seulement à vous. Les salariés voient la réponse **dans l'appli**,
  avec la pastille rouge sur le bouton **?**.
- **Seules vos adresses peuvent répondre par mail.** Une réponse venant d'une autre adresse, ou envoyée à
  une adresse inventée, est refusée (« Adresse inconnue »). Chaque adresse de réponse contient une
  signature propre à la demande : on ne peut pas écrire dans une autre demande en devinant un numéro.
  L'adresse d'expéditeur d'un mail peut être falsifiée : la vraie protection est la signature, connue
  seulement de vous (elle n'apparaît que dans les mails reçus dans votre Gmail). Ne transférez pas ces mails.
- **Réponse par mail = texte seul.** Les pièces jointes et les images sont ignorées ; la citation de
  l'ancien mail et la signature « -- » sont retirées. 4000 caractères au plus.
- **10 demandes par heure et par personne** au maximum (protection contre les erreurs et les abus).
- La pastille se met à jour à l'ouverture de l'appli, à chaque changement d'écran (au plus une fois
  par minute) et toutes les 5 minutes : ce n'est pas une notification sur le téléphone.
- Il faut être **connecté** pour écrire. Sans connexion, le bouton **?** propose de se connecter ou
  d'appeler le 06 09 89 74 43.
