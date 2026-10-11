# belfort-systems.fr

Site personnel de Damien Belfort — Belfort Systems.

- `/` — CV en ligne
- `/factures/` — générateur de factures (privé, protégé par mot de passe)
- `/clients/<nom>/` — espaces clients (privés, protégés par mot de passe)

Les pages privées sont chiffrées en AES-256-GCM et déchiffrées dans le navigateur.
Hébergé sur GitHub Pages.

## Service

Le site reste statique ; ce qui doit être reçu, stocké ou partagé passe par le service
`belfort-api` (dossier `api/`) : un Worker Cloudflare sans dépendance, une base D1
`belfort-systems` et un espace KV pour les sessions. Il sert le formulaire de contact,
les disponibilités, le panneau `/admin/` (demandes, factures numérotées en continu,
journal d'audit, flux temps réel) et les outils déployés chez les clients (`/client/*`).
Déploiement automatique par `.github/workflows/deploy-worker.yml` à chaque push sur
`main` qui touche `api/**`, avec trois secrets GitHub à créer une fois
(`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ADMIN_PASSWORD`).
Mise en route, tests locaux, import des données et décisions : voir [api/NOTES.md](api/NOTES.md).
Contrat d'architecture : [docs/TABLEAU-DE-BORD.md](docs/TABLEAU-DE-BORD.md).
