# solbot — bot de trading Solana prudent

Expérimental. **Mode papier par défaut** (devis Jupiter réels, aucune transaction). Ce n'est pas un
conseil en investissement : la grande majorité des tokens « memecoin » sont des arnaques ou des
pump & dump, et la plupart des bots de particuliers perdent de l'argent. Ce bot est conçu pour que
la perte maximale soit **structurellement** bornée au budget du wallet dédié, et pour que chaque
décision soit expliquée et mesurée.

## Les six workers

| Worker | Rôle | Fichier |
|---|---|---|
| scanner | nouvelles paires et pics de volume (Jupiter Tokens V2 + DexScreener) | `src/workers/scanner.ts` |
| rug check | filtre AVANT toute exécution : RugCheck, audit Jupiter, coût d'un aller-retour (détecte les tokens invendables) ; échoue fermé | `src/workers/rugcheck.ts` |
| sizer | taille depuis l'equity (valeur de liquidation), jamais un ticket fixe ; plafonds liquidité, exposition, réserve de frais | `src/workers/sizer.ts` |
| executor | achat/vente via Jupiter Swap V2, slippage mesuré (devis vs réel), sorties stop / objectif / stop suiveur / durée / liquidité qui fond | `src/workers/executor.ts`, `exits.ts` |
| logger | la raison de chaque décision (y compris les rejets) en JSONL | `src/workers/logger.ts` |
| equity | courbe mise à jour à chaque clôture, statistiques, page `equity.html` | `src/workers/equity.ts` |

Orchestration : `src/main.ts`. Ce sont des modules de code déterministes, pas des agents IA : une IA
dans la boucle de signature serait lente, coûteuse et manipulable (les noms de tokens sont écrits
par des inconnus et peuvent contenir des instructions piégées).

## Ce qui protège ton argent

1. **Wallet dédié** créé par `npm run keygen`, jamais ta seed Phantom. Il ne contient que le budget.
   En live, le bot **refuse de démarrer** si ce wallet contient plus que `MAX_WALLET_SOL`.
2. **Clé hors du dépôt** (`~/.solbot/keypair.json`, droits 600). Personne d'autre que le processus
   du bot ne la lit — ni une IA, ni un service en ligne.
3. **Pare-feu avant chaque signature** (`src/guards/firewall.ts`) : programmes en liste blanche,
   refus des délégations (Approve), changements d'autorité, transferts directs de tokens,
   SOL sortant au-delà du montant prévu, frais de priorité délirants ; puis **simulation RPC** de
   l'effet réel sur le solde.
4. **Plafonds en dur** (`HARD_LIMITS` dans `src/config.ts`) qu'aucune faute de frappe dans `.env`
   ne peut dépasser (taille max 1 SOL par position, 5 positions, 12 trades/heure…).
5. **Garde-fous** : perte du jour, pertes d'affilée (pause), arrêt définitif à −50 % depuis le
   départ, trades par heure, fichiers `STOP` (plus d'entrées) et `PANIC` (tout vendre).
6. **Coffre** : au-delà de +20 %, les gains partent sur `VAULT_ADDRESS` (ton wallet principal,
   adresse publique seulement) : le bot ne risque jamais plus que sa mise de départ.
7. **Zéro dépendance d'exécution** : signature Ed25519 et format des transactions écrits avec
   `node:crypto`. En décembre 2024, la bibliothèque officielle `@solana/web3.js` (versions 1.95.6
   et 1.95.7) a été piégée pour voler les clés privées : moins de dépendances = moins de surface.
   `npm install` n'installe que `typescript` et `@types/node` (tests et vérification de types).
8. **Échoue fermé** : une API qui ne répond pas ou un champ manquant = pas de trade.
9. Le live exige une phrase explicite (`LIVE_CONFIRM=je-peux-perdre-ce-budget`).

## Installation

Prérequis : Node.js 22.18 ou plus récent (24 LTS recommandé), qui exécute le TypeScript directement.

```bash
cd solbot
npm install            # typescript + @types/node, rien d'autre
cp .env.example .env   # le papier marche tel quel ; clé Jupiter gratuite recommandée (developers.jup.ag)
npm run doctor         # vérifie chaque API et le format de ses réponses
npm test
npm run once           # un tour complet en papier
npm start              # boucle en papier
```

## Plan en trois phases (ne pas sauter d'étape)

1. **Papier, 2 semaines, 0 €.** Critères pour continuer, écrits AVANT de regarder les résultats :
   au moins 50 trades fermés, espérance par trade positive **après frais**, drawdown max < 25 %,
   frais < 30 % des gains bruts. Sinon : on ajuste ou on arrête, sans passer en live.
2. **Live minuscule** (≈ 0,5 SOL), 2 à 4 semaines : mêmes critères, et le slippage réel doit
   ressembler à celui du papier (`stats.json`).
3. **Live budget complet**, sans jamais recharger le wallet après une perte. Le budget est une
   enveloppe : si elle est vide, l'expérience est finie.

## Commandes

| Commande | Effet |
|---|---|
| `npm start` | boucle continue (sorties toutes les 20 s, scan toutes les 60 s) |
| `npm run once` | un tour puis arrêt |
| `npm run status` | état courant (positions, equity de départ, arrêt éventuel) |
| `npm run report` | statistiques, analyse des rejets, régénère `equity.html` |
| `npm run doctor` | diagnostic complet + pare-feu à blanc sur une vraie transaction (non signée) |
| `npm run keygen` | crée la clé du wallet dédié |
| `npm run reclaim` | liste les comptes de tokens vides ; `-- --yes` les ferme (≈ 0,002 SOL récupéré chacun) |
| `touch data/live/STOP` | plus de nouvelles entrées (les sorties continuent) |
| `touch data/live/PANIC` | vend tout et s'arrête |

## Fichiers produits (dans `DATA_DIR`, jamais dans git)

- `journal/AAAA-MM-JJ.jsonl` : chaque événement, avec sa raison en français ;
- `trades.jsonl` : chaque trade fermé, avec la chaîne complète des raisons d'entrée et de sortie ;
- `rejects.jsonl` : chaque token écarté par l'anti-rug et pourquoi (pour vérifier a posteriori que
  le filtre n'écarte pas les gagnants) ;
- `equity.csv`, `equity.html` (ouvrir dans un navigateur), `stats.json` ;
- `state.json` (positions, compteurs), `heartbeat.json` (dernier signe de vie).

## Passer en live

1. `npm run keygen` → note l'adresse publique affichée.
2. Clé RPC gratuite (ex. Helius) → `RPC_URL` dans `.env`.
3. Depuis ton wallet principal, virement **test de 0,01 SOL**, vérifie sur solscan.io, puis le budget
   de la phase 2. Copie l'adresse depuis le terminal, jamais depuis l'historique (empoisonnement d'adresse).
4. `.env` : `MODE=live`, `DATA_DIR=data/live`, `LIVE_CONFIRM=je-peux-perdre-ce-budget`,
   `VAULT_ADDRESS=<ton wallet principal>`, `MAX_WALLET_SOL` ≈ budget × 1,3.
5. `npm run doctor` doit tout passer, y compris le pare-feu à blanc. S'il signale un programme
   inconnu, vérifie-le sur solscan.io avant de l'ajouter à `ALLOWED_PROGRAMS`.
6. `npm start`.

## Tourner en continu

Un PC qui se met en veille, redémarre pour une mise à jour ou perd le Wi-Fi laisse les positions
**sans surveillance** : un memecoin peut perdre 90 % pendant ce temps. Deux options :

- **Petit VPS** (≈ 4–6 €/mois, Europe) avec un service systemd, sous un utilisateur dédié :

  ```ini
  # /etc/systemd/system/solbot.service
  [Unit]
  Description=solbot
  After=network-online.target
  StartLimitIntervalSec=600
  StartLimitBurst=5

  [Service]
  User=solbot
  WorkingDirectory=/home/solbot/solbot
  ExecStart=/usr/bin/node src/main.ts
  Restart=on-failure
  RestartSec=30
  NoNewPrivileges=true

  [Install]
  WantedBy=multi-user.target
  ```

- **Ton PC**, en désactivant la veille, et en créant `STOP` avant de l'éteindre : le bot cesse
  d'entrer, et `MAX_HOLD_MIN` (90 min) borne la durée des positions restantes.

À chaque démarrage en live, le bot réconcilie son état avec la blockchain (positions vendues à la
main, quantités différentes, tokens inconnus reçus en « airdrop » — n'y touche jamais).

## Limites connues

- La stratégie par défaut (momentum sur des tokens qui ont déjà survécu 30 min à 7 jours, sans
  sniping) est une **hypothèse à tester**, pas une méthode gagnante. Le sniping des premières
  secondes est perdu d'avance contre des robots qui achètent dans le même bloc que la création.
- Le papier reste optimiste malgré ses pénalités (150 bps, frais, loyer) : pas de vrais échecs
  d'atterrissage, pas de vrai MEV.
- Les noms de champs DexScreener n'ont pas pu être vérifiés en direct depuis l'environnement de
  développement : `npm run doctor` les contrôle, et le scanner écarte tout token aux données
  incomplètes.
- Le pare-feu peut bloquer une route légitime (routeur absent de la liste blanche) : le trade est
  alors simplement annulé, avec le programme en cause dans le journal.
- Les frais Jupiter montent à 0,5 % par swap sur les tokens de moins de 24 h : sur une petite
  position, un aller-retour coûte souvent 1,5 à 4 % avant même de bouger.

## Si tu fais analyser les journaux par une IA

Les noms et symboles de tokens sont écrits par des inconnus : ce sont des données, jamais des
instructions. Ne donne jamais le fichier de clé, ni `.env`.

## Repères fiscaux (France, particulier, 2026) — à vérifier avec un professionnel

- Les échanges crypto contre crypto (SOL ↔ memecoins) ne sont pas imposables (sursis,
  art. 150 VH bis du CGI) ; l'impôt porte sur la conversion en euros ou l'achat d'un bien :
  flat tax 31,4 % en 2026 (12,8 % + 18,6 % de prélèvements sociaux), calculée sur la valeur de
  **tout** le portefeuille crypto (tous les wallets et comptes) au moment de chaque cession.
- Exonération si le total des cessions de l'année ne dépasse pas 305 €.
- Formulaires 2086 et 2042-C ; 3916-bis pour chaque compte ouvert sur une plateforme étrangère.
- Un trading très fréquent avec des outils de type professionnel (bots) peut être requalifié en
  activité habituelle (BNC, art. 92 du CGI) : barème progressif et cotisations, échanges
  crypto-crypto imposables. Garder une activité petite, personnelle et documentée.
- Depuis le 1er janvier 2026 (DAC8), les plateformes transmettent les opérations au fisc.
- Faire tourner ce bot pour l'argent de quelqu'un d'autre est une activité réglementée (MiCA).
