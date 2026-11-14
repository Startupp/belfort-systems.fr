# Journal des 12 comptes (suivi en direct)

Chaque changement de règle, de réglage ou de fonctionnement est daté ici, avec sa raison et la preuve qu'il améliore
les comptes sur l'historique (choix sur le passé, jugé sur la période suivante, jamais sur quelques jours en direct).
Les résultats déjà obtenus en direct ne sont jamais réécrits : un changement vaut à partir de sa date.

## Méthode de revue

- **Chaque matin** : état technique (passages, erreurs, données), ce que chaque compte a fait la veille, comparaison avec
  son comportement attendu (fréquence des trades, tailles, sorties). Un bug avéré est corrigé tout de suite ; une idée
  d'amélioration est seulement notée ci-dessous.
- **Chaque samedi** : revue d'optimisation. Les idées notées sont testées sur l'historique (comme l'entraînement depuis
  le Covid) ; seules celles qui tiennent sur la période de test sont appliquées, datées ici.

## Journal

### 2026-11-11

- **Départ du suivi à 15 h 25 (Paris)**, demandé par l'utilisateur pour voir les comptes jouer le jour même
  (prévu d'abord le jeudi 12 à 0 h).
- **Départ immédiat des comptes journaliers** (ETF et crypto journalier) : au départ, ils décident sur leurs barres
  terminées comme si une barre se fermait au cours du moment, au lieu d'attendre la clôture suivante. Ensuite, règles
  inchangées.
- **Kraken en secours de Coinbase** pour les bougies crypto (Coinbase refuse souvent les adresses de Cloudflare).
- Réglages des 12 comptes : ceux de l'entraînement depuis 2020 (`covid.json`), sinon de la validation (`comptes.json`).

### 2026-11-14

- **Bug : bougies crypto pas lues, deux comptes figés.** Depuis Cloudflare, Coinbase répond 429 et Kraken « Too many
  requests » à beaucoup de requêtes. Chaque série n'était lue qu'à une minute prévue (0 h 42 – 0 h 44 UTC en
  journalier, minute 3 en horaire) : une lecture refusée attendait le lendemain. L'ETH journalier n'a plus été lu du
  mercredi 11 au samedi 14 (le SOL et le BTC certains jours) ; « Tendance crypto » (b2) et « BTC et ETH au-dessus de la
  moyenne 200 jours » (c3) sont restés figés depuis leur départ du mercredi à 15 h 25. La page montrait c3 à −213 $
  avec son BTC encore tenu ; une fois l'ETH relu (passage forcé du samedi 14), c3 a traité la clôture du jeudi 12 et
  vendu au cours de cette clôture (71 370 $, sous sa moyenne 200 jours de 73 080 $) : −76 $. Les ordres « à la
  clôture » sont remplis au cours de la clôture même s'ils sont traités en retard : le résultat des comptes ne dépend
  pas du retard, seul l'affichage était faux pendant ce temps.
- **Correctif (Worker)** : une série crypto dont la barre suivante aurait dû être lue est relue toutes les 10 minutes
  (une série par minute, de x5 à x9, jamais aux minutes des lectures prévues) jusqu'au succès. Plus d'une heure
  d'essais sans succès s'affiche dans les remarques de la page (« barres en retard depuis … », avec la dernière
  erreur). Preuve : la simulation de 32 h minute par minute où Kraken refuse chaque lecture prévue échoue sans le
  correctif (ETH figé sur la barre du mardi 10, comme en direct) et passe avec (toutes les séries à jour, rejeu
  unique identique pour les 12 comptes).
- Affichage seulement : la position ouverte au départ immédiat d'un compte journalier porte comme date d'ouverture la
  fin de la barre de départ (départ + 1 jour), par exemple c3 « ouvert le jeudi 12 à 15 h 25 » au lieu du mercredi 11.
  Sans effet sur les cours et les résultats.

## Idées à tester (revue du samedi)

- **Forex EUR/USD (a4), cassure de Londres** : deux stops en deux jours (−81 $ et −78 $) sur des ranges très étroits
  (0,00062 le 12). Tester un range minimal (en pips ou en part de l'ATR journalier) sur l'historique, avec la méthode de
  l'entraînement.
- **Bougies crypto depuis Cloudflare** : si les nouveaux essais ne suffisent pas (retards répétés dans les remarques),
  ajouter une troisième source publique (Bitstamp ou Gemini) après Coinbase et Kraken.
