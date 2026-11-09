/**
 * Desk de day trading papier — contrat de données.
 *
 * Capital en dollars, aucun levier : la somme des positions ouvertes ne dépasse jamais l'equity.
 * Actions US en compte cash : achat seulement (pas de vente à découvert), et l'argent d'une vente
 * n'est réutilisable que le lendemain (règlement T+1) — d'où les « lots » du jour.
 */

export type AssetClass = 'stock' | 'fx' | 'crypto';
export type StrategyId = 'orb' | 'noise' | 'vwap';
export type Side = 'long' | 'short';

export interface Instrument {
  /** Symbole Yahoo Finance (ex. NVDA, EURUSD=X, BTC-USD). */
  symbol: string;
  cls: AssetClass;
  label: string;
}

/** Barre d'une minute ; t = début de la minute (ms epoch UTC). */
export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Signal {
  symbol: string;
  cls: AssetClass;
  strategy: StrategyId;
  side: Side;
  /** Prix de déclenchement (avant glissement). */
  entry: number;
  stop: number;
  target?: number;
  /** Plus haut = plus prometteur (pour départager les signaux d'une même minute). */
  quality: number;
  regime: string;
  reasons: string[];
}

export interface OpenTrade {
  id: string;
  symbol: string;
  cls: AssetClass;
  strategy: StrategyId;
  side: Side;
  qty: number;
  /** Prix d'entrée effectif (glissement compris). */
  entry: number;
  stop: number;
  initialStop: number;
  target?: number;
  openedAt: number;
  /** Risque engagé à l'entrée : qty × |entrée − stop initial|, en $. */
  riskUsd: number;
  notionalUsd: number;
  costsUsd: number;
  /** Meilleur prix atteint depuis l'entrée (pour le stop suiveur). */
  best: number;
  regime: string;
  reasons: string[];
}

export interface ClosedTrade extends OpenTrade {
  closedAt: number;
  exit: number;
  /** PnL net de tous les frais, en $. */
  pnlUsd: number;
  /** PnL en multiple du risque initial (R). */
  r: number;
  exitReason: string;
  holdMinutes: number;
  /** Equity juste après la clôture. */
  equityAfter: number;
}

export interface DeskState {
  version: 1;
  startEquity: number;
  /** Liquidités (positions ouvertes non comprises). */
  cash: number;
  /** Jour de séance (date de Paris, AAAA-MM-JJ). */
  day: string;
  dayStartEquity: number;
  tradesToday: number;
  /** Argent des actions déjà engagé aujourd'hui (compte cash : réutilisable demain). */
  stockCashUsedToday: number;
  /** Poids adaptatifs par stratégie (0.25 à 2) : la stratégie évolue avec les résultats. */
  weights: Record<StrategyId, number>;
  /** Pertes d'affilée du jour, par stratégie. */
  lossStreak: Record<StrategyId, number>;
  weekId: string;
  weekStartEquity: number;
  open: OpenTrade[];
  /** symbole → ms jusqu'à laquelle on ne le retouche pas. */
  cooldown: Record<string, number>;
  /** symbole → nombre de trades ORB aujourd'hui (une fois par jour et par action). */
  orbDone: Record<string, number>;
  halted?: string;
  closedCount: number;
}

export interface DeskConfig {
  startEquity: number;
  /** Risque de base par trade, en % de l'equity. */
  baseRiskPct: number;
  /** Part maximale de l'equity dans une seule position. */
  maxPositionPct: number;
  maxOpen: number;
  /**
   * Places au plus pour l'ORB, qui garde ses positions jusqu'à 18 h 55 : le reste est gardé pour les trades
   * rapides (momentum, VWAP). Changement du 9 novembre 2026, raison dans carnet/reglages.json.
   */
  maxOrbOpen: number;
  maxTradesPerDay: number;
  /** Objectif d'activité : sous ce nombre à 17 h 30, le desk passe en « mode chasse ». */
  minTradesPerDay: number;
  dailyLossLimitPct: number;
  weeklyLossLimitPct: number;
  /** Heures de Paris (minutes depuis minuit). */
  windowStart: number;
  lastEntry: number;
  flatAt: number;
  windowEnd: number;
  huntFrom: number;
  /** Coûts par côté. */
  costs: Record<AssetClass, { feeBps: number; slipBps: number }>;
  minNotionalUsd: number;
  cooldownMinutes: number;
  historyDays: number;
  /** Nombre d'actions « en jeu » (top volume relatif) éligibles à l'ORB chaque jour. */
  inPlayTop: number;
}

export const DEFAULT_DESK_CONFIG: DeskConfig = {
  startEquity: 500,
  baseRiskPct: 0.5,
  maxPositionPct: 50,
  maxOpen: 4,
  maxOrbOpen: 2,
  maxTradesPerDay: 10,
  minTradesPerDay: 3,
  dailyLossLimitPct: 1.5,
  weeklyLossLimitPct: 4,
  windowStart: 15 * 60,
  lastEntry: 18 * 60 + 30,
  flatAt: 18 * 60 + 55,
  windowEnd: 19 * 60,
  huntFrom: 17 * 60 + 30,
  costs: {
    // Courtier à 0 % de commission sur actions US (compte en USD) ; glissement prudent.
    stock: { feeBps: 0, slipBps: 3 },
    // Forex sans commission : l'écart achat-vente (~0,8 à 1,2 pip) ≈ 1 bp par côté.
    fx: { feeBps: 0, slipBps: 1 },
    // Plateforme crypto au comptant à 0,10 % par ordre (Binance), plus le glissement.
    crypto: { feeBps: 10, slipBps: 2 },
  },
  minNotionalUsd: 25,
  cooldownMinutes: 15,
  historyDays: 10,
  inPlayTop: 8,
};

/** Univers : ce qui bouge le plus et se traite le mieux pendant 15 h – 19 h (ouverture de New York). */
export const UNIVERSE: Instrument[] = [
  { symbol: 'SPY', cls: 'stock', label: 'S&P 500 (ETF)' },
  { symbol: 'QQQ', cls: 'stock', label: 'Nasdaq 100 (ETF)' },
  { symbol: 'IWM', cls: 'stock', label: 'Russell 2000 (ETF)' },
  { symbol: 'NVDA', cls: 'stock', label: 'Nvidia' },
  { symbol: 'TSLA', cls: 'stock', label: 'Tesla' },
  { symbol: 'AMD', cls: 'stock', label: 'AMD' },
  { symbol: 'AAPL', cls: 'stock', label: 'Apple' },
  { symbol: 'MSFT', cls: 'stock', label: 'Microsoft' },
  { symbol: 'META', cls: 'stock', label: 'Meta' },
  { symbol: 'AMZN', cls: 'stock', label: 'Amazon' },
  { symbol: 'GOOGL', cls: 'stock', label: 'Alphabet' },
  { symbol: 'AVGO', cls: 'stock', label: 'Broadcom' },
  { symbol: 'NFLX', cls: 'stock', label: 'Netflix' },
  { symbol: 'PLTR', cls: 'stock', label: 'Palantir' },
  { symbol: 'COIN', cls: 'stock', label: 'Coinbase' },
  { symbol: 'MSTR', cls: 'stock', label: 'Strategy' },
  { symbol: 'MU', cls: 'stock', label: 'Micron' },
  { symbol: 'HOOD', cls: 'stock', label: 'Robinhood' },
  // Forex retiré : sans levier, un mouvement typique de 0,05 % sur 250 $ rapporte quelques centimes
  // (rejeu du 2 au 6 novembre 2026) tout en occupant une place de position.
  { symbol: 'BTC-USD', cls: 'crypto', label: 'Bitcoin' },
  { symbol: 'ETH-USD', cls: 'crypto', label: 'Ether' },
  { symbol: 'SOL-USD', cls: 'crypto', label: 'Solana' },
];

/**
 * Actions liquides supplémentaires pour le rejeu : à défaut de la liste « actions les plus actives »
 * du jour (impossible à reconstituer pour le passé), le rejeu classe chaque jour ces valeurs par
 * volume relatif d'ouverture, comme l'étude ORB le fait sur tout le marché.
 */
export const REPLAY_EXTRA: Instrument[] = [
  'INTC', 'SMCI', 'ARM', 'SOFI', 'RIVN', 'UBER', 'SHOP', 'DKNG', 'RBLX', 'MARA', 'RIOT', 'CLSK', 'IREN', 'WULF',
  'IONQ', 'RGTI', 'QBTS', 'SOUN', 'NU', 'CCL', 'AAL', 'DAL', 'UAL', 'XOM', 'OXY', 'BAC', 'WMT', 'DIS', 'BABA',
  'SNAP', 'PYPL', 'CRWD', 'PANW', 'SNOW', 'ORCL', 'CRM', 'ADBE', 'QCOM', 'TSM', 'ASML', 'LLY', 'UNH', 'JPM', 'GS',
].map((symbol) => ({ symbol, cls: 'stock' as const, label: symbol }));
