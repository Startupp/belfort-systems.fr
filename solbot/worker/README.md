# Worker « arene-papier » : les 12 comptes de l'arène en direct (papier)

Un Worker Cloudflare (plan gratuit) qui fait tourner les 12 comptes de 5 000 $ avec le **même moteur et les mêmes
réglages figés** que `node src/arena/main.ts avance`, et affiche leur PnL en direct sur une page à lien secret.
Papier uniquement : aucune clé de plateforme, aucun ordre réel.

- **Tâche planifiée chaque minute** (`* * * * *`) ; chaque passage ne fait qu'une petite partie du travail
  (créneaux dans `index.ts`) pour rester sous la limite de 10 ms de calcul du plan gratuit.
- **Base D1** (une table `kv` : clé → texte) : séries de cours (en colonnes d'entiers), état de chaque compte,
  résumé lu par la page.
- **Page** : `https://arene-papier.<sous-domaine>.workers.dev/<TOKEN>/` ; `…/<TOKEN>/api` (JSON) ;
  `…/<TOKEN>/run` (un passage tout de suite). `TOKEN` est un secret du Worker, jamais dans le dépôt.

## Construire, essayer

```sh
npm run worker:build                                   # worker/dist/worker.js (esbuild, sans dépendance installée)
NODE_USE_ENV_PROXY=1 node worker/local.ts 20 --depuis=2026-11-03   # 20 passages avec les vrais cours, base en mémoire
NODE_USE_ENV_PROXY=1 node worker/local.ts --mesure --creneau=21    # temps de calcul d'un créneau (sans le réseau)
```

## Déploiement (API Cloudflare)

Module `worker.js`, `compatibility_date` récente, liaisons : D1 `DB` (base `arene-papier`), secret `TOKEN`.
Planification : `* * * * *`. Sous-domaine workers.dev activé pour ce script.
