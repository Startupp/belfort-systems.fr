/**
 * Contrat partagé entre les six « workers » du bot et l'orchestrateur (src/main.ts).
 *
 *   scanner  → TokenCandidate[]      (nouvelles paires, pics de volume)
 *   rugcheck → RugVerdict            (filtre AVANT toute exécution ; échoue fermé)
 *   sizer    → SizeDecision          (taille depuis l'equity, jamais un ticket fixe)
 *   executor → Fill / Position / ClosedTrade (ouverture, sortie, slippage mesuré)
 *   logger   → journal JSONL         (la raison de chaque décision)
 *   equity   → EquitySnapshot / courbe (mise à jour à chaque clôture)
 *
 * Conventions :
 *   - montants SOL en nombre décimal (ex. 0.25), lamports en entier (1 SOL = 1e9 lamports) ;
 *   - montants de tokens « bruts » (plus petite unité) en chaîne décimale pour éviter les pertes
 *     de précision (ex. "123456789000") ; conversion avec BigInt si besoin ;
 *   - dates en ISO 8601 UTC (ex. "2026-11-08T16:00:00.000Z") ;
 *   - pourcentages en « points » (12.5 = 12,5 %), bps = points de base (100 bps = 1 %).
 */

export type Mode = 'paper' | 'live';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const LAMPORTS_PER_SOL = 1_000_000_000;

/** Horloge injectable (les tests utilisent une horloge figée). */
export interface Clock {
  /** Millisecondes depuis l'epoch. */
  now(): number;
  /** Date ISO UTC de now(). */
  iso(): string;
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

/** Un token qui a passé les filtres de marché du scanner (pas encore le filtre anti-rug). */
export interface TokenCandidate {
  mint: string;
  symbol: string;
  name: string;
  /** Paire de référence (la plus liquide) chez DexScreener. */
  pairAddress: string;
  dexId: string;
  /** Symbole du token de cotation de la paire (SOL, USDC…). */
  quoteSymbol: string;
  priceUsd: number;
  liquidityUsd: number;
  /** marketCap, ou fdv si marketCap absent. */
  marketCapUsd: number;
  pairCreatedAtMs: number;
  ageMinutes: number;
  vol5mUsd: number;
  vol1hUsd: number;
  buys5m: number;
  sells5m: number;
  priceChange5mPct: number;
  priceChange1hPct: number;
  /** vol5m / moyenne des tranches de 5 min du reste de l'heure. */
  spikeRatio: number;
  /** buys5m / max(1, sells5m). */
  buySellRatio: number;
  /** Score organique Jupiter 0–100 quand disponible. */
  organicScore?: number;
  /** Nombre de traders distincts sur 5 min (Jupiter) quand disponible. */
  traders5m?: number;
  /** D'où vient le token : 'jup:toptrending:5m', 'jup:recent', 'dex:profiles', 'dex:boosts'… */
  sources: string[];
  /** Score de classement (plus haut = plus intéressant). */
  score: number;
  /** Phrases lisibles qui expliquent pourquoi le token est retenu. */
  signals: string[];
  observedAt: string;
}

export interface ScanResult {
  at: string;
  /** Candidats triés par score décroissant. */
  candidates: TokenCandidate[];
  /** Nombre de tokens examinés (après dédoublonnage). */
  examined: number;
  /** Comptage des motifs d'écartement, ex. { LOW_LIQUIDITY: 12, NO_SPIKE: 40 }. */
  rejectedCounts: Record<string, number>;
  sourcesOk: string[];
  sourcesFailed: string[];
}

// ---------------------------------------------------------------------------
// Rug check
// ---------------------------------------------------------------------------

export interface RugVerdict {
  mint: string;
  /** true seulement si TOUS les contrôles obligatoires ont répondu et sont bons. */
  pass: boolean;
  /** Codes stables, ex. 'MINT_AUTHORITY', 'FREEZE_AUTHORITY', 'RUGCHECK_DANGER', 'ROUNDTRIP_COST', 'API_ERROR'. */
  rejectCodes: string[];
  /** Phrases lisibles (une par motif de rejet ou d'avertissement). */
  reasons: string[];
  warnings: string[];
  rugcheckScore?: number;
  rugcheckScoreNormalised?: number;
  /** Coût d'un aller-retour SOL→token→SOL sur la taille sonde, en % (frais + impact). */
  roundTripCostPct?: number;
  topHoldersPct?: number;
  checkedAt: string;
  /** Données brutes utiles pour l'analyse a posteriori (petites). */
  details: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Equity, sizing
// ---------------------------------------------------------------------------

export interface EquitySnapshot {
  at: string;
  /** SOL libre du wallet (papier : virtuel). */
  freeSol: number;
  /** Valeur de liquidation des positions ouvertes (ce qu'on récupérerait en vendant maintenant). */
  positionsValueSol: number;
  equitySol: number;
  peakEquitySol: number;
  initialEquitySol: number;
  /** Baisse depuis le plus haut, en % positif (0 = au plus haut). */
  drawdownPct: number;
  /** Variation depuis le capital initial, en % (négatif = perte). */
  returnPct: number;
}

export interface SizeDecision {
  ok: boolean;
  /** 0 si ok = false. */
  sizeSol: number;
  lamports: number;
  /** Phrase lisible, ex. « 4 % de l'equity 7.120 SOL = 0.285 SOL ; plafond liquidité (1 % de 52.0 k$) = 0.741 SOL ». */
  reason: string;
  /** Plafonds qui ont réduit la taille, ex. ['MAX_POSITION', 'POOL_SHARE', 'DRAWDOWN_HALF']. */
  capsApplied: string[];
}

// ---------------------------------------------------------------------------
// Exécution, positions, trades
// ---------------------------------------------------------------------------

export type Side = 'buy' | 'sell';

export interface Fill {
  side: Side;
  mode: Mode;
  ok: boolean;
  at: string;
  inputMint: string;
  outputMint: string;
  /** Montant d'entrée brut (lamports si SOL). */
  inAmount: string;
  /** Sortie annoncée par le devis (/order). */
  quotedOutAmount: string;
  /** Sortie réellement obtenue (live : outputAmountResult ; papier : devis − pénalité simulée). */
  actualOutAmount: string;
  /** (devis − réel) / devis × 10 000. Positif = moins bien que le devis. */
  slippageBps: number;
  /** Frais réseau / priorité estimés ou mesurés, en lamports. */
  feeLamports: number;
  /** Frais Jupiter en bps (champ feeBps du devis) si connus. */
  jupiterFeeBps?: number;
  router?: string;
  requestId?: string;
  signature?: string;
  error?: string;
  /** Durée devis → confirmation, en ms. */
  latencyMs?: number;
}

export interface Position {
  id: string;
  mint: string;
  symbol: string;
  decimals: number;
  pairAddress: string;
  openedAt: string;
  /** SOL dépensé au total pour ouvrir (montant du swap + frais). */
  entrySol: number;
  /** Quantité de tokens détenue (brute). */
  tokenAmountRaw: string;
  entryLiquidityUsd: number;
  /** Plus haute valeur de liquidation observée (pour le stop suiveur). */
  peakValueSol: number;
  lastValueSol: number;
  lastCheckedAt: string;
  /** Chaîne de raisons de l'entrée (signaux + anti-rug + taille). */
  entryReasons: string[];
  entryFill: Fill;
}

export type ExitReason =
  | 'STOP_LOSS'
  | 'TAKE_PROFIT'
  | 'TRAILING_STOP'
  | 'TIME_STOP'
  | 'LIQUIDITY_DRAIN'
  | 'NO_ROUTE'
  | 'PANIC'
  | 'SHUTDOWN'
  | 'MANUAL';

/** Résultat de l'évaluation de valeur d'une position (vente simulée de toute la position). */
export interface PositionMark {
  ok: boolean;
  /** SOL qu'on obtiendrait en vendant tout maintenant (devis Jupiter). */
  valueSol: number;
  /** Liquidité de la paire au moment du contrôle, si connue. */
  liquidityUsd?: number;
  /** Source de la valeur : 'quote' (devis de vente) ou 'price' (prix DexScreener, repli). */
  source: 'quote' | 'price' | 'none';
  error?: string;
}

export interface ExitDecision {
  exit: boolean;
  reason?: ExitReason;
  /** Phrase lisible, ex. « −20,4 % depuis l'entrée (stop à −20 %) ». */
  detail?: string;
}

export interface ClosedTrade {
  id: string;
  mode: Mode;
  mint: string;
  symbol: string;
  openedAt: string;
  closedAt: string;
  holdMinutes: number;
  entrySol: number;
  /** SOL récupéré à la vente (net des frais réseau). */
  exitSol: number;
  pnlSol: number;
  pnlPct: number;
  /** Frais réseau + priorité cumulés (achat + vente), en SOL. */
  feesSol: number;
  entrySlippageBps: number;
  exitSlippageBps: number;
  entryReasons: string[];
  exitReason: ExitReason;
  exitDetail: string;
  entrySignature?: string;
  exitSignature?: string;
  /** Equity juste après la clôture (rempli par l'orchestrateur). */
  equityAfterSol?: number;
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

export type JournalType =
  | 'start'
  | 'stop'
  | 'scan'
  | 'reject'
  | 'size_skip'
  | 'open'
  | 'open_failed'
  | 'close'
  | 'close_failed'
  | 'mark'
  | 'guard'
  | 'firewall'
  | 'sweep'
  | 'reconcile'
  | 'equity'
  | 'error'
  | 'info';

export interface JournalEvent {
  at: string;
  type: JournalType;
  mode: Mode;
  mint?: string;
  symbol?: string;
  /** Phrase lisible en français. */
  msg: string;
  data?: unknown;
}

// ---------------------------------------------------------------------------
// État persistant (data/state.json)
// ---------------------------------------------------------------------------

export interface BotState {
  version: 1;
  mode: Mode;
  createdAt: string;
  /** Capital de départ (papier : PAPER_START_SOL ; live : mesuré au premier démarrage). */
  initialEquitySol: number;
  peakEquitySol: number;
  /** SOL libre virtuel du mode papier (ignoré en live). */
  paperSol: number;
  positions: Position[];
  /** mint → date ISO jusqu'à laquelle on ne retouche pas ce token. */
  cooldowns: Record<string, string>;
  day: { date: string; startEquitySol: number; realizedPnlSol: number; trades: number };
  consecutiveLosses: number;
  pausedUntil?: string;
  /** Dates ISO des ouvertures récentes (limite de trades par heure). */
  recentOpens: string[];
  halted?: { reason: string; at: string };
  /** Total des gains mis à l'abri vers le coffre (live). */
  totalSweptSol: number;
  closedTrades: number;
}

/** Décision des garde-fous à chaque tour de boucle. */
export interface GuardDecision {
  allowEntries: boolean;
  /** Vendre toutes les positions immédiatement (fichier PANIC). */
  panic: boolean;
  /** Arrêt durable : plus aucune entrée tant que l'humain n'a pas réarmé. */
  halt: boolean;
  reasons: string[];
}
