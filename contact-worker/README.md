# belfort-contact — Worker du formulaire de contact

Worker Cloudflare **séparé** de `belfort-api` (dossier `api/`, qui sert aussi l'Espace Breteuil).
Il ne fait qu'une chose : recevoir le formulaire de contact de belfort-systems.fr.

| Élément | Valeur |
|---|---|
| Adresse | `https://belfort-contact.damien-belfort.workers.dev/contact` (POST) |
| Origines acceptées (CORS) | `https://belfort-systems.fr`, `https://www.belfort-systems.fr`, `https://*.belfort-systems-fr.pages.dev` |
| Anti-robot | pot-de-miel `website`, 10 envois/heure/IP (KV `RATE`), Turnstile si `TURNSTILE_SECRET` est posé |
| Stockage | D1 `belfort_contact`, table `contacts` (`migrations/0001_contacts.sql`) |
| Notification | e-mail à `damien@belfort-systems.fr` via Email Workers (binding `MAIL`) ; sans binding, la demande est quand même enregistrée |
| Réponses | `{ "ok": true, "id": 12 }` ou `{ "ok": false, "error": "…" }` ; sans JavaScript, redirection 303 vers le site |

Champs acceptés : `nom`*, `email`*, `message`* (10 caractères minimum), `tel`, `sujet`, `formule`, `creneau`, `website` (pot-de-miel, doit rester vide).

Mise en route pas à pas (commandes, Email Routing, identifiants KV/D1) : **README.md du dépôt, section « Formulaire de contact »**.

Journaux : Cloudflare → Workers & Pages → belfort-contact → Logs (ou `npx wrangler tail`).
