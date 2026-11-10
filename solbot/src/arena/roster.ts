/**
 * Les 12 comptes de 5 000 $ (papier), du plus agressif au plus long terme :
 * - 1 à 4 « sniper » : peu de trades, choisis, risque par trade élevé, levier aux plafonds de chaque marché ;
 * - 5 à 8 « modéré » : risque moyen ;
 * - 9 à 12 « long terme » : peu de décisions, positions gardées des mois.
 * Chaque compte a une ou plusieurs variantes : la meilleure est choisie sur la période d'apprentissage seulement,
 * puis jugée sur la période de test, jamais vue pendant le choix.
 */

import type { Costs } from './engine.ts';
import type { ArenaPortfolio, DataKey } from './portfolios.ts';
import { COSTS } from './costs.ts';
import {
  NY,
  buyHold,
  donchian,
  donchianTf,
  faber,
  fundingAt,
  fundingCarry,
  noiseArea,
  orbFirstCandle,
  permanent,
  rsi2,
  sessionBreakout,
  squeezeBreakout,
  trend200,
} from './strategies.ts';


export type Tier = 'sniper' | 'modéré' | 'long terme';
export type WindowKey = '5m' | 'crypto' | 'perps' | 'daily';

export interface Variant {
  label: string;
  spec: ArenaPortfolio;
  /** Source des données par symbole quand le compte mélange plusieurs sources. */
  dataBySymbol?: Record<string, DataKey>;
}

export interface Account {
  id: string;
  rank: number;
  name: string;
  tier: Tier;
  market: string;
  leverageLabel: string;
  window: WindowKey;
  source: string;
  rules: string;
  variants: Variant[];
}

const DAY = 86_400_000;
const H = 3_600_000;
const M5 = 5 * 60_000;
const SESSION = 390 * 60_000;
const CAPITAL = 5000;

/** Perpétuels Kraken Futures : 0,05 % par ordre au marché, financement horaire réel (pas de financement de CFD). */
const PERPS: Costs = { feeBps: 5, slipBps: 1, financingPct: 0, minNotional: 1 };
/** Forex EUR/USD en CFD : écart ~0,8 pip ; financement de nuit. */
const FX: Costs = { feeBps: 0, slipBps: 0.5, financingPct: 5, minNotional: 1 };
/** Portage : une jambe au comptant (Revolut X, 0,09 %), une jambe perpétuel (0,05 %) : moyenne par côté. */
const CARRY: Costs = { feeBps: 7, slipBps: 2, financingPct: 0, minNotional: 1 };

function spec(id: string, over: Partial<ArenaPortfolio> & Pick<ArenaPortfolio, 'data' | 'symbols' | 'strategy' | 'barMs' | 'costs' | 'maxLeverage' | 'allowShort'>): ArenaPortfolio {
  return { id, name: id, capital: CAPITAL, market: '', leverageLabel: '', source: '', rules: '', role: 'publiée', ...over };
}

/** Comptes perpétuels (A1) : tendance 4 h ou 1 jour, ou cassure après compression en 1 h ; symboles et données au choix. */
export function a1Variants(symbols: string[], data: DataKey): Variant[] {
  const base = { data, symbols, barMs: H, costs: PERPS, maxLeverage: 5, allowShort: true, fundingPerHour: fundingAt };
  return [
    ...[4, 24].map((hours) => ({
      label: `tendance ${hours === 24 ? '1 jour' : '4 h'}, achat et vente`,
      spec: spec('a1-perps', { ...base, maxHoldMs: 14 * DAY, strategy: () => donchianTf({ symbols, hours, risk: 0.02, atrMult: 3, shorts: true }) }),
    })),
    ...[
      [2, 1.5],
      [3, 1.5],
      [3, 2.5],
      [5, 2.5],
    ].map(([tR, a]) => ({
      label: `compression 1 h, objectif ${tR} R, stop ${a} ATR`,
      spec: spec('a1-perps', { ...base, strategy: () => squeezeBreakout({ symbols, risk: 0.02, atrStop: a as number, targetR: tR as number, shorts: true }) }),
    })),
  ];
}

/** Portage du financement (B3) : jambe au comptant et jambe perpétuel, fenêtre de 72 h ou de 7 jours. */
export function b3Variants(spot: string, perp: string, dataBySymbol: Record<string, DataKey>): Variant[] {
  return (
    [
      [72, 1e-6, 0],
      [72, 3e-6, 0],
      [168, 1e-6, -1e-6],
      [168, 3e-6, -3e-6],
    ] as Array<[number, number, number]>
  ).map(([hours, th, out]) => ({
    label: `moyenne ${hours === 168 ? '7 jours' : '72 h'}, entrée au-dessus de ${(th * 24 * 365 * 100).toFixed(1)} %/an, sortie sous ${(out * 24 * 365 * 100).toFixed(1)} %/an`,
    dataBySymbol,
    spec: spec('b3-portage', { data: dataBySymbol[perp] ?? 'kfut1h', symbols: [spot, perp], barMs: H, costs: CARRY, maxLeverage: 1, allowShort: true, maxHoldMs: Infinity, fundingPerHour: fundingAt, strategy: () => fundingCarry({ spot, perp, enterAbove: th, exitBelow: out, hours }) }),
  }));
}

export const ACCOUNTS: Account[] = [
  // ------------------------------------------------------------------ sniper
  {
    id: 'a1-perps',
    rank: 1,
    name: 'Sniper perpétuels BTC et ETH',
    tier: 'sniper',
    market: 'Crypto perpétuels (Kraken Futures), 24 h/24',
    leverageLabel: '×5 max',
    window: 'perps',
    source: 'Deux familles essayées : cassure après compression de volatilité en 1 h (« squeeze ») et suivi de tendance Donchian en 4 h ou en 1 jour ; financement horaire réel de Kraken Futures',
    rules: 'Achat et vente, risque 2 % par trade, levier ×5 au plus, financement horaire payé ou reçu. Compression : cassure des 20 dernières heures quand les bandes de Bollinger sont au plus serré, stop en ATR, objectif en multiple du risque, 3 jours au plus. Tendance : cassure des 20 dernières barres dans le sens de la moyenne 50, stop suiveur à 3 ATR, 14 jours au plus.',
    variants: a1Variants(['PF_XBTUSD', 'PF_ETHUSD'], 'kfut1h'),
  },
  {
    id: 'a2-orb-qqq',
    rank: 2,
    name: 'Sniper ORB Nasdaq (QQQ)',
    tier: 'sniper',
    market: 'Nasdaq 100 (CFD), 15 h 30 – 22 h',
    leverageLabel: '×4 max',
    window: '5m',
    source: 'Zarattini & Aziz (2023), « Can Day Trading Really Be Profitable? », SSRN 4416622',
    rules: '1re bougie de 5 min en hausse : achat à l’ouverture de la 2e, stop au plus bas de la 1re ; en baisse : vente, stop au plus haut. Objectif en multiple du risque, sinon sortie à la clôture. Risque 1 % par trade, levier ×4 au plus (règles de l’étude).',
    variants: [10, 5].map((tR) => ({
      label: `objectif ${tR} R`,
      spec: spec('a2-orb-qqq', { data: 'y5m', symbols: ['QQQ'], barMs: M5, costs: COSTS.cfdIndice, maxLeverage: 4, allowShort: true, strategy: () => orbFirstCandle({ symbol: 'QQQ', risk: 0.01, targetR: tR }) }),
    })),
  },
  {
    id: 'a3-or',
    rank: 3,
    name: 'Sniper or (ouverture de New York)',
    tier: 'sniper',
    market: 'Or (CFD XAUUSD), 15 h 30 – 19 h',
    leverageLabel: '×20 max',
    window: '5m',
    source: 'Cassure de range d’ouverture sur l’or, avec ou sans filtre de compression (pratique courante)',
    rules: 'Range de 9 h 30 à 9 h 45 (New York) ; ordres stop des deux côtés jusqu’à 11 h 30 ; stop de l’autre côté ; sortie à 13 h (19 h à Paris). Variante « comprimé » : seulement si le range du jour est plus étroit que la médiane des 20 séances. Risque 2 % par trade.',
    variants: [
      [false, 2],
      [false, 3],
      [true, 2],
      [true, 3],
    ].map(([comp, tR]) => ({
      label: `${comp ? 'range comprimé seulement' : 'tous les jours'}, objectif ${tR} R`,
      spec: spec('a3-or', {
        data: 'gold5m',
        symbols: ['GC=F'],
        barMs: M5,
        costs: COSTS.cfdOr,
        maxLeverage: 20,
        allowShort: true,
        strategy: () => sessionBreakout({ symbol: 'GC=F', tz: NY, rangeStart: 570, rangeEnd: 585, entryUntil: 690, exitAt: 780, targetR: tR as number, risk: 0.02, compression: comp as boolean, label: 'or NY' }),
      }),
    })),
  },
  {
    id: 'a4-forex',
    rank: 4,
    name: 'Sniper forex EUR/USD',
    tier: 'sniper',
    market: 'Forex EUR/USD (CFD), sessions de Londres ou de New York',
    leverageLabel: '×30 max',
    window: '5m',
    source: 'Cassure du range d’ouverture de Londres ou de l’annonce de 8 h 30 à New York (pratiques courantes du forex)',
    rules: 'Londres : range de 8 h à 8 h 30 (heure de Londres), entrées jusqu’à midi, sortie à 17 h. New York : range de 8 h 30 à 8 h 45 (heure des statistiques américaines), entrées jusqu’à 11 h, sortie à 16 h. Stop de l’autre côté, objectif 2 R, risque 1,5 % par trade.',
    variants: [
      ['Londres', 'Europe/London', 480, 510, 720, 1020],
      ['New York', NY, 510, 525, 660, 960],
    ].flatMap(([name, tz, rs, re, until, exit]) =>
      [false, true].map((comp) => ({
        label: `${name}${comp ? ', range comprimé seulement' : ''}`,
        spec: spec('a4-forex', {
          data: 'y5m',
          symbols: ['EURUSD=X'],
          barMs: M5,
          costs: FX,
          maxLeverage: 30,
          allowShort: true,
          strategy: () => sessionBreakout({ symbol: 'EURUSD=X', tz: tz as string, rangeStart: rs as number, rangeEnd: re as number, entryUntil: until as number, exitAt: exit as number, targetR: 2, risk: 0.015, compression: comp, label: `EUR/USD ${name}` }),
        }),
      })),
    ),
  },
  // ------------------------------------------------------------------ modéré
  {
    id: 'b1-momentum-spx',
    rank: 5,
    name: 'Momentum S&P 500 ×2',
    tier: 'modéré',
    market: 'S&P 500 (CFD), 16 h – 22 h',
    leverageLabel: '×2 max',
    window: '5m',
    source: 'Zarattini, Aziz & Barbon (2024), « Beat the Market », SSRN 4824172 (zone de bruit)',
    rules: 'Toutes les 30 min de 10 h à 15 h 30 (New York) : achat au-dessus de la zone de bruit, vente en dessous, stop suiveur borne ou VWAP, sortie à la clôture. Levier piloté par la volatilité, ×2 au plus.',
    variants: [{ label: 'règles de l’étude, levier ×2 au plus', spec: spec('b1-momentum-spx', { data: 'spy5m', symbols: ['SPY'], barMs: M5, costs: COSTS.cfdIndice, maxLeverage: 2, allowShort: true, strategy: () => noiseArea({ symbol: 'SPY', maxLev: 2 }) }) }],
  },
  {
    id: 'b2-crypto-tendance',
    rank: 6,
    name: 'Tendance crypto au comptant (Revolut X)',
    tier: 'modéré',
    market: 'BTC, ETH, SOL au comptant, 24 h/24',
    leverageLabel: 'sans levier',
    window: 'crypto',
    source: 'Suivi de tendance Donchian ; momentum des cryptos documenté sur des horizons de jours à semaines (Liu & Tsyvinski, 2021)',
    rules: 'Achat sur cassure du plus haut de 20 barres au-dessus de la moyenne ; stop suiveur en ATR ; jamais de vente à découvert ; 14 jours au plus. Risque 1 % par trade, frais Revolut X. Unité de temps choisie sur la période d’apprentissage : 1 h, 4 h ou 1 jour.',
    variants: [
      { label: 'barres de 1 h', spec: spec('b2-crypto-tendance', { data: 'crypto1h', symbols: ['BTC-USD', 'ETH-USD', 'SOL-USD'], barMs: H, costs: COSTS.revolutX, maxLeverage: 1, allowShort: false, maxHoldMs: 14 * DAY, strategy: () => donchian({ symbols: ['BTC-USD', 'ETH-USD', 'SOL-USD'], risk: 0.01 }) }) },
      { label: 'barres de 4 h', spec: spec('b2-crypto-tendance', { data: 'crypto1h', symbols: ['BTC-USD', 'ETH-USD', 'SOL-USD'], barMs: H, costs: COSTS.revolutX, maxLeverage: 1, allowShort: false, maxHoldMs: 14 * DAY, strategy: () => donchianTf({ symbols: ['BTC-USD', 'ETH-USD', 'SOL-USD'], hours: 4, risk: 0.01, atrMult: 3 }) }) },
      { label: 'barres de 1 jour', spec: spec('b2-crypto-tendance', { data: 'crypto1d', symbols: ['BTC-USD', 'ETH-USD', 'SOL-USD'], barMs: DAY, costs: COSTS.revolutX, maxLeverage: 1, allowShort: false, maxHoldMs: 14 * DAY, strategy: () => donchian({ symbols: ['BTC-USD', 'ETH-USD', 'SOL-USD'], risk: 0.01 }) }) },
    ],
  },
  {
    id: 'b3-portage',
    rank: 7,
    name: 'Portage du financement BTC (delta neutre)',
    tier: 'modéré',
    market: 'BTC au comptant + perpétuel vendu (Kraken Futures)',
    leverageLabel: 'sans levier (2 jambes de 50 %)',
    window: 'perps',
    source: 'Portage « cash and carry » : on encaisse le financement payé par les acheteurs de perpétuels (pratique courante des fonds crypto)',
    rules: 'Achat de BTC au comptant et vente du perpétuel pour le même montant (50 % du compte chacun) : le prix s’annule et l’on encaisse le financement. Entrée quand le financement moyen (72 h ou 7 jours) dépasse un seuil, sortie quand il passe sous un autre : la fenêtre longue évite d’entrer et sortir trop souvent.',
    variants: b3Variants('BTC-USD', 'PF_XBTUSD', { 'BTC-USD': 'crypto1h', PF_XBTUSD: 'kfut1h' }),
  },
  {
    id: 'b4-swing-etf',
    rank: 8,
    name: 'Swing ETF : RSI(2) sur SPY, QQQ, IWM',
    tier: 'modéré',
    market: 'ETF US au comptant',
    leverageLabel: 'sans levier',
    window: 'daily',
    source: 'Connors & Alvarez (2008), « Short Term Trading Strategies That Work »',
    rules: 'Achat à la clôture si le cours est au-dessus de sa moyenne 200 jours et RSI(2) < 10 ; vente au-dessus de la moyenne 5 jours ; 7 jours au plus. Un tiers du compte par ETF.',
    variants: [{ label: 'règles de Connors', spec: spec('b4-swing-etf', { data: 'daily', symbols: ['SPY', 'QQQ', 'IWM'], barMs: SESSION, costs: COSTS.spy, maxLeverage: 1, allowShort: false, maxHoldMs: 7 * DAY, strategy: () => rsi2({ symbols: ['SPY', 'QQQ', 'IWM'], perSymbol: 1 / 3 }) }) }],
  },
  // ------------------------------------------------------------------ long terme
  {
    id: 'c1-sp500',
    rank: 9,
    name: 'Achat-conservation S&P 500',
    tier: 'long terme',
    market: 'ETF SPY',
    leverageLabel: 'sans levier',
    window: 'daily',
    source: 'Référence de tout investisseur : le marché lui-même',
    rules: 'Tout le compte en SPY dès le premier jour, jamais revendu.',
    variants: [{ label: 'achat-conservation', spec: spec('c1-sp500', { data: 'daily', symbols: ['SPY'], barMs: SESSION, costs: COSTS.spy, maxLeverage: 1, allowShort: false, maxHoldMs: Infinity, strategy: () => buyHold({ symbol: 'SPY' }) }) }],
  },
  {
    id: 'c2-faber',
    rank: 10,
    name: 'Allocation tactique de Faber',
    tier: 'long terme',
    market: 'ETF : actions US et monde, obligations, immobilier, matières premières',
    leverageLabel: 'sans levier',
    window: 'daily',
    source: 'Faber (2007), « A Quantitative Approach to Tactical Asset Allocation », Journal of Wealth Management',
    rules: 'Chaque mois : SPY, EFA, IEF, VNQ et DBC pèsent 20 % chacun s’ils sont au-dessus de leur moyenne de 10 mois, sinon leur part reste en liquidités.',
    variants: [{ label: 'règles de Faber', spec: spec('c2-faber', { data: 'daily', symbols: ['SPY', 'EFA', 'IEF', 'VNQ', 'DBC'], barMs: SESSION, costs: COSTS.spy, maxLeverage: 1, allowShort: false, maxHoldMs: Infinity, strategy: () => faber({ symbols: ['SPY', 'EFA', 'IEF', 'VNQ', 'DBC'] }) }) }],
  },
  {
    id: 'c3-btc-eth-200j',
    rank: 11,
    name: 'BTC et ETH au-dessus de la moyenne 200 jours',
    tier: 'long terme',
    market: 'BTC, ETH au comptant (Revolut X), 24 h/24',
    leverageLabel: 'sans levier',
    window: 'crypto',
    source: 'Filtre de tendance de 200 jours appliqué aux cryptos (pratique courante, peu de transactions)',
    rules: 'Moitié du compte par crypto, détenue tant que la clôture quotidienne est au-dessus de sa moyenne 200 jours, sinon en liquidités. Frais Revolut X.',
    variants: [{ label: 'moyenne 200 jours', spec: spec('c3-btc-eth-200j', { data: 'crypto1d', symbols: ['BTC-USD', 'ETH-USD'], barMs: DAY, costs: COSTS.revolutX, maxLeverage: 1, allowShort: false, maxHoldMs: Infinity, strategy: () => trend200({ symbols: ['BTC-USD', 'ETH-USD'], perSymbol: 0.5 }) }) }],
  },
  {
    id: 'c4-permanent',
    rank: 12,
    name: 'Portefeuille permanent',
    tier: 'long terme',
    market: 'ETF : actions, obligations longues, or, monétaire',
    leverageLabel: 'sans levier',
    window: 'daily',
    source: 'Harry Browne (1981), « portefeuille permanent »',
    rules: '25 % SPY, 25 % TLT, 25 % GLD, 25 % BIL (monétaire), rééquilibrés chaque trimestre.',
    variants: [{ label: '4 × 25 %', spec: spec('c4-permanent', { data: 'daily', symbols: ['SPY', 'TLT', 'GLD', 'BIL'], barMs: SESSION, costs: COSTS.spy, maxLeverage: 1, allowShort: false, maxHoldMs: Infinity, strategy: () => permanent({ symbols: ['SPY', 'TLT', 'GLD', 'BIL'] }) }) }],
  },
];

/** Périodes d'apprentissage et de test par famille de données (la période de test n'est jamais vue pendant le choix). */
export function windows(now: number, firstIntraday: number): Record<WindowKey, { train: [number, number]; test: [number, number] }> {
  const day0 = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) - 3_600_000; // minuit à Paris (heure d'hiver)
  const todayParis = Math.floor((now + 3_600_000) / DAY) * DAY - 3_600_000;
  const split4m = day0('2026-07-13');
  const intradayStart = firstIntraday + 21 * DAY;
  return {
    '5m': { train: [intradayStart, day0('2026-10-12')], test: [day0('2026-10-12'), todayParis] },
    crypto: { train: [day0('2025-01-06'), split4m], test: [split4m, todayParis] },
    perps: { train: [day0('2025-11-10'), split4m], test: [split4m, todayParis] },
    daily: { train: [day0('2010-01-04'), split4m], test: [split4m, todayParis] },
  };
}
