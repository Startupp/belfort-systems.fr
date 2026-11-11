/**
 * Réglages figés du suivi en direct, les mêmes que `node src/arena/main.ts avance` : pour chaque compte, la variante
 * choisie sur tout l'historique depuis 2020 (arene/covid.json, `final`) quand elle existe, sinon celle de la validation
 * (arene/comptes.json, `chosen`). Un test vérifie que ce fichier suit ces deux fichiers.
 */

import { NY, PARIS, zonedToUtc } from '../src/arena/strategies.ts';

/** Indice de la variante suivie, par compte. */
export const CHOICES: Record<string, number> = {
  'a1-perps': 0,
  'a2-orb-qqq': 0,
  'a3-or': 2,
  'a4-forex': 0,
  'b1-momentum-spx': 0,
  'b2-crypto-tendance': 2,
  'b3-portage': 3,
  'b4-swing-etf': 0,
  'c1-sp500': 0,
  'c2-faber': 0,
  'c3-btc-eth-200j': 0,
  'c4-permanent': 0,
};

/** Départ du suivi : mercredi 11 novembre 2026, 15 h 25 (Paris), comme SUIVI_START dans src/arena/main.ts. */
export const START_MS = zonedToUtc('2026-11-11', 925, PARIS);

/**
 * Barres de 5 min : lues seulement pendant la plage où le compte qui les utilise peut agir (jours ouvrés, heure locale
 * du marché, en minutes depuis minuit). En dehors, ces stratégies n'ont ni position ni ordre en attente.
 * Un test vérifie que ces plages suivent les variantes choisies ci-dessus.
 */
export const SESSIONS: Record<string, { tz: string; from: number; to: number; why: string }> = {
  QQQ: { tz: NY, from: 570, to: 975, why: 'ORB QQQ : 1re bougie de 9 h 30, sortie à la clôture (16 h)' },
  SPY: { tz: NY, from: 570, to: 975, why: 'zone de bruit SPY : décisions de 10 h à 15 h 30, sortie à la clôture (16 h)' },
  'GC=F': { tz: NY, from: 570, to: 795, why: 'or : range de 9 h 30 à 9 h 45, entrées jusqu’à 11 h 30, sortie à 13 h' },
  'EURUSD=X': { tz: 'Europe/London', from: 480, to: 1035, why: 'EUR/USD Londres : range de 8 h à 8 h 30, entrées jusqu’à midi, sortie à 17 h' },
};
