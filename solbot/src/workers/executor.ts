/**
 * Exécuteur : ouvre et ferme les positions par Jupiter Swap V2 et mesure ce que chaque swap a
 * réellement coûté ou rapporté (slippage contre le devis, frais, SOL dépensé ou reçu).
 *
 * PAPIER — aucune signature, aucune transaction. Devis réels (/order sans `taker`), portefeuille
 *   virtuel (PaperLedger). Prudent par construction : pénalité retirée au devis
 *   (PAPER_EXTRA_SLIPPAGE_BPS), frais réseau à chaque transaction, loyer d'un compte de token
 *   compté comme perdu à chaque achat.
 *
 * LIVE — devis avec `taker` → pare-feu (transaction inspectée AVANT signature) → solde avant →
 *   simulation RPC de la transaction exacte qui sera signée → signature → /execute. Le SOL
 *   dépensé ou reçu se mesure par différence de solde du wallet.
 *
 *   Idempotence : si /execute ne répond pas (réseau, délai), on renvoie EXACTEMENT le même payload
 *   signé + requestId (Jupiter ne l'exécute jamais deux fois), au plus 3 fois, 5 s d'écart, dans
 *   les 90 s qui suivent le devis. Tant que l'issue est inconnue, on ne redemande jamais de devis
 *   et on ne re-signe jamais : ce serait risquer un double achat. Si l'issue reste inconnue, on
 *   interroge le RPC sur la signature ; à défaut, échec « UNKNOWN_OUTCOME » à réconcilier.
 *   Un échec « rejouable » annoncé par Jupiter dès le premier envoi (codes -1, -1000…) donne droit
 *   à UNE nouvelle tentative complète (devis → pare-feu → simulation → signature → exécution).
 *
 * Les échecs attendus (pas de route, pare-feu, API, fonds insuffisants) ne lèvent jamais
 * d'exception : Fill ok:false avec une erreur en français. Une fois l'argent parti, plus rien ne
 * peut lever : la position ou le trade est toujours rendu, avec des valeurs de repli prudentes.
 */

import { HARD_LIMITS, isValidAddress } from '../config.ts';
import type { Config } from '../config.ts';
import { checkSimulatedBalance, inspectSwapTransaction } from '../guards/firewall.ts';
import type { JupiterClient, JupiterExecuteResult, JupiterOrder, OrderParams } from '../lib/jupiter.ts';
import type { Signer } from '../lib/keypair.ts';
import type { Rpc, SimulationResult, TokenBalance } from '../lib/rpc.ts';
import { fromBase64, parseTransaction, signTransaction, toBase64, transactionId } from '../lib/solanaTx.ts';
import { newId } from '../lib/store.ts';
import { LAMPORTS_PER_SOL, SOL_MINT } from '../types.ts';
import type {
  Clock,
  ClosedTrade,
  ExitReason,
  Fill,
  Mode,
  Position,
  PositionMark,
  Side,
  SizeDecision,
  TokenCandidate,
} from '../types.ts';

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

/** Portefeuille virtuel du mode papier (SOL libre). */
export interface PaperLedger {
  getSol(): number;
  addSol(delta: number): void;
}

/** Données de marché (DexScreener) fournies par l'orchestrateur ; toutes facultatives. */
export interface MarketInfo {
  priceUsd?: number;
  liquidityUsd?: number;
  solUsd?: number;
}

export interface ExecutorDeps {
  mode: Mode;
  config: Config;
  clock: Clock;
  jupiter: JupiterClient;
  /** Prix et liquidité d'un mint : suivi de la liquidité, repli d'évaluation sans devis. */
  marketInfo?: (mint: string) => Promise<MarketInfo | undefined>;
  /** Live uniquement (obligatoires en live). */
  signer?: Signer;
  rpc?: Rpc;
  /** Papier uniquement (obligatoire en papier). */
  ledger?: PaperLedger;
  /** Attente entre deux envois à /execute (injectable pour les tests). */
  sleep?: (ms: number) => Promise<void>;
}

export interface Executor {
  /** SOL libre : solde du wallet (live) ou du portefeuille virtuel (papier). Rejette si le RPC échoue. */
  freeSol(): Promise<number>;
  open(c: TokenCandidate, size: SizeDecision, entryReasons: string[]): Promise<{ position?: Position; fill: Fill }>;
  mark(p: Position): Promise<PositionMark>;
  close(p: Position, reason: ExitReason, detail: string): Promise<{ trade?: ClosedTrade; fill: Fill }>;
}

/** Préfixe d'erreur d'une vente sans route : l'orchestrateur réessaie au tour suivant. */
export const NO_ROUTE_ERROR = 'NO_ROUTE';
/** Erreur (exacte) d'une vente alors que le wallet ne détient plus ce token. */
export const ZERO_TOKEN_BALANCE_ERROR = 'solde de tokens nul';
/** Préfixe d'erreur quand on ignore si la transaction a atterri : réconcilier le wallet avant de rejouer. */
export const UNKNOWN_OUTCOME_ERROR = 'UNKNOWN_OUTCOME';

/** Renvois du même payload à /execute quand l'appel lève (réseau, délai). */
const EXECUTE_REPOSTS = 3;
const EXECUTE_REPOST_WAIT_MS = 5_000;
/** Tous les envois d'un même payload partent dans cette fenêtre après le devis (TTL Jupiter ~2 min). */
const EXECUTE_BUDGET_MS = 90_000;
/** Tentatives complètes (devis → … → exécution) : la première + une après un échec rejouable. */
const SWAP_ATTEMPTS = 2;
/** Marge pour frais réseau, priorité et loyer de comptes (0.01 SOL). */
const FEE_MARGIN_LAMPORTS = 10_000_000;
const MAX_PRIORITY_FEE_LAMPORTS = 5_000_000n;
const SIGNATURE_FEE_LAMPORTS = 5_000;
/** Tolérance d'arrondi sur le plafond de taille. */
const SIZE_TOLERANCE_LAMPORTS = 1_000;
const RETRYABLE_EXECUTE_CODES: ReadonlySet<number> = new Set([-1, -1000, -1001, -1004, -2000, -2001, -2003, -2004]);

/**
 * Slippage réalisé en bps : (devis − réel) / devis × 10 000, arrondi au dixième.
 * Positif = moins bien que le devis. Devis nul → 0. Calcul exact en entiers (montants > 2^53).
 */
export function slippageBps(quotedOut: bigint, actualOut: bigint): number {
  if (quotedOut <= 0n) return 0;
  const scaled = (quotedOut - actualOut) * 100_000n; // dixièmes de bps × devis
  const abs = scaled < 0n ? -scaled : scaled;
  const rounded = (abs * 2n + quotedOut) / (2n * quotedOut); // arrondi au plus proche, demi vers le haut
  return Number(scaled < 0n ? -rounded : rounded) / 10;
}

export function createExecutor(deps: ExecutorDeps): Executor {
  const { mode, config } = deps;
  const ctx: Ctx = {
    mode,
    config,
    clock: deps.clock,
    jupiter: deps.jupiter,
    marketInfo: deps.marketInfo,
    sleep: deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
  };

  let core: Core;
  if (mode === 'live') {
    const { signer, rpc } = deps;
    if (!signer) throw new Error('exécuteur live : signer obligatoire (clé du wallet)');
    if (!rpc) throw new Error('exécuteur live : rpc obligatoire (solde, simulation, réconciliation)');
    if (config.mode !== 'live') throw new Error('exécuteur live demandé avec une configuration papier : refus');
    if (!config.liveConfirmed) throw new Error('exécuteur live sans LIVE_CONFIRM : refus');
    core = createLiveCore(ctx, signer, rpc);
  } else if (mode === 'paper') {
    const { ledger } = deps;
    if (!ledger) throw new Error('exécuteur papier : ledger obligatoire (portefeuille virtuel)');
    core = createPaperCore(ctx, ledger);
  } else {
    throw new Error(`exécuteur : mode inconnu ${String(mode)}`);
  }

  const gate = createGate();
  const busy = 'une opération est déjà en cours sur ce token : demande ignorée';

  return {
    freeSol: () => core.freeSol(),
    open(c, size, entryReasons) {
      if (gate.isBusy(c.mint)) {
        const fill = newFill(ctx, 'buy', SOL_MINT, c.mint, String(size.lamports));
        return Promise.resolve({ fill: finishFill(ctx, fill, ctx.clock.now(), busy) });
      }
      return gate.run(c.mint, () => core.open(c, size, entryReasons));
    },
    mark: (p) => markPosition(ctx, p),
    close(p, reason, detail) {
      if (gate.isBusy(p.mint)) {
        const fill = newFill(ctx, 'sell', p.mint, SOL_MINT, String(p.tokenAmountRaw));
        return Promise.resolve({ fill: finishFill(ctx, fill, ctx.clock.now(), busy) });
      }
      return gate.run(p.mint, () => core.close(p, reason, detail));
    },
  };
}

// ---------------------------------------------------------------------------
// Commun aux deux modes
// ---------------------------------------------------------------------------

interface Ctx {
  mode: Mode;
  config: Config;
  clock: Clock;
  jupiter: JupiterClient;
  marketInfo?: (mint: string) => Promise<MarketInfo | undefined>;
  sleep: (ms: number) => Promise<void>;
}

interface Core {
  freeSol(): Promise<number>;
  open(c: TokenCandidate, size: SizeDecision, entryReasons: string[]): Promise<{ position?: Position; fill: Fill }>;
  close(p: Position, reason: ExitReason, detail: string): Promise<{ trade?: ClosedTrade; fill: Fill }>;
}

/**
 * Sérialise les opérations (les mesures de solde avant/après ne doivent pas se chevaucher) et
 * refuse une deuxième opération simultanée sur un même mint (double achat, double vente).
 */
function createGate(): { isBusy(mint: string): boolean; run<T>(mint: string, fn: () => Promise<T>): Promise<T> } {
  const busy = new Set<string>();
  let tail: Promise<unknown> = Promise.resolve();
  return {
    isBusy: (mint) => busy.has(mint),
    async run<T>(mint: string, fn: () => Promise<T>): Promise<T> {
      busy.add(mint); // synchrone : visible dès le retour de l'appel
      const run = tail.then(() => fn());
      tail = run.catch(() => undefined);
      try {
        return await run;
      } finally {
        busy.delete(mint);
      }
    },
  };
}

type Quote = { ok: true; order: JupiterOrder; outAmount: bigint } | { ok: false; order?: JupiterOrder; error: string };

/** Devis Jupiter ; ne lève jamais. outAmount peut valoir 0 (à l'appelant de juger). */
async function quote(ctx: Ctx, params: OrderParams): Promise<Quote> {
  let order: JupiterOrder;
  try {
    order = await ctx.jupiter.order(params);
  } catch (e) {
    return { ok: false, error: `devis Jupiter impossible (${describeError(e)})` };
  }
  if (!order || typeof order !== 'object') return { ok: false, error: 'réponse de devis Jupiter illisible' };
  const out = parseRaw(order.outAmount);
  if (out === null) {
    const why = orderErrorText(order);
    const missing = order.outAmount === undefined || order.outAmount === null;
    return {
      ok: false,
      order,
      error: why ?? (missing ? 'devis sans montant de sortie' : `montant de sortie illisible « ${String(order.outAmount)} »`),
    };
  }
  // Un devis pour d'autres tokens que ceux demandés : réponse incohérente, on n'y touche pas.
  if (typeof order.inputMint === 'string' && order.inputMint !== params.inputMint) {
    return { ok: false, order, error: `devis incohérent (inputMint ${order.inputMint} au lieu de ${params.inputMint})` };
  }
  if (typeof order.outputMint === 'string' && order.outputMint !== params.outputMint) {
    return { ok: false, order, error: `devis incohérent (outputMint ${order.outputMint} au lieu de ${params.outputMint})` };
  }
  return { ok: true, order, outAmount: out };
}

function newFill(ctx: Ctx, side: Side, inputMint: string, outputMint: string, inAmount: string): Fill {
  return {
    side,
    mode: ctx.mode,
    ok: false,
    at: ctx.clock.iso(),
    inputMint,
    outputMint,
    inAmount,
    quotedOutAmount: '0',
    actualOutAmount: '0',
    slippageBps: 0,
    feeLamports: 0,
    jupiterFeeBps: undefined,
    router: undefined,
    requestId: undefined,
    signature: undefined,
    error: undefined,
    latencyMs: undefined,
  };
}

/** Recopie dans le Fill ce que le devis nous apprend (requestId, route, frais Jupiter, sortie annoncée). */
function noteOrder(fill: Fill, order: JupiterOrder | undefined, quoted: bigint | undefined): void {
  if (quoted !== undefined) fill.quotedOutAmount = quoted.toString();
  if (!order) return;
  if (typeof order.requestId === 'string' && order.requestId) fill.requestId = order.requestId;
  if (typeof order.router === 'string' && order.router) fill.router = order.router;
  if (typeof order.feeBps === 'number' && Number.isFinite(order.feeBps)) fill.jupiterFeeBps = order.feeBps;
}

function finishFill(ctx: Ctx, fill: Fill, startMs: number, error?: string): Fill {
  fill.at = ctx.clock.iso();
  fill.latencyMs = Math.max(0, ctx.clock.now() - startMs);
  fill.ok = error === undefined;
  fill.error = error;
  return fill;
}

/** Contrôles avant tout achat : mint, taille (dernier rempart si le sizer avait un bug). */
function preflightError(ctx: Ctx, c: TokenCandidate, size: SizeDecision): string | undefined {
  if (typeof c.mint !== 'string' || !isValidAddress(c.mint)) return `achat refusé : mint invalide (${String(c.mint)})`;
  if (c.mint === SOL_MINT) return 'achat refusé : le token demandé est le SOL lui-même';
  if (!size || size.ok !== true) return `achat refusé : taille refusée par le sizer${size?.reason ? ` (${size.reason})` : ''}`;
  if (!Number.isSafeInteger(size.lamports) || size.lamports <= 0) return `achat refusé : taille invalide (${String(size.lamports)} lamports)`;
  const capSol = Math.min(ctx.config.sizer.maxPositionSol, HARD_LIMITS.maxPositionSol);
  const capLamports = Math.round(capSol * LAMPORTS_PER_SOL);
  if (size.lamports > capLamports + SIZE_TOLERANCE_LAMPORTS) {
    return `achat refusé : taille ${fmt(size.lamports / LAMPORTS_PER_SOL, 9)} SOL au-dessus du plafond ${fmt(capSol, 9)} SOL`;
  }
  return undefined;
}

/** Jupiter fixe le slippage toléré selon la volatilité attendue : trop haut = marché trop agité pour entrer. */
function entrySlippageError(ctx: Ctx, order: JupiterOrder): string | undefined {
  const s = order.slippageBps;
  const max = ctx.config.exits.maxEntryPriceImpactBps;
  if (typeof s === 'number' && s > max) {
    return `entrée refusée : slippage prévu par Jupiter ${fmt(s, 1)} bps au-dessus du maximum ${fmt(max, 1)} bps (marché trop volatil)`;
  }
  return undefined;
}

/** Décimales du token via Jupiter ; 0 si inconnu (ne lève jamais). */
async function fetchDecimals(ctx: Ctx, mint: string): Promise<number> {
  try {
    const list = await ctx.jupiter.tokensSearch([mint]);
    const t = Array.isArray(list) ? list.find((x) => x && x.id === mint) : undefined;
    const d = t?.decimals;
    return typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 30 ? d : 0;
  } catch {
    return 0;
  }
}

async function safeMarketInfo(ctx: Ctx, mint: string): Promise<MarketInfo | undefined> {
  if (!ctx.marketInfo) return undefined;
  try {
    const info = await ctx.marketInfo(mint);
    return info && typeof info === 'object' ? info : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Valeur de liquidation : devis de vente de toute la position (papier : moins la pénalité, comme
 * à la vente). Sans devis : repli sur le prix (tokens × prix USD / prix du SOL) ; sinon 'none'.
 */
async function markPosition(ctx: Ctx, p: Position): Promise<PositionMark> {
  const infoP = safeMarketInfo(ctx, p.mint);
  const tokens = parseRaw(p.tokenAmountRaw);
  if (tokens === null || tokens <= 0n) {
    const info = await infoP;
    return {
      ok: false,
      valueSol: 0,
      liquidityUsd: usdOrUndefined(info?.liquidityUsd),
      source: 'none',
      error: `quantité de tokens nulle ou illisible (« ${String(p.tokenAmountRaw)} »)`,
    };
  }
  const [q, info] = await Promise.all([
    quote(ctx, { inputMint: p.mint, outputMint: SOL_MINT, amount: tokens.toString() }),
    infoP,
  ]);
  const liquidityUsd = usdOrUndefined(info?.liquidityUsd);
  if (q.ok) {
    const lamports = ctx.mode === 'paper' ? applyPaperPenalty(q.outAmount, ctx.config.paper.extraSlippageBps) : q.outAmount;
    return { ok: true, valueSol: Number(lamports) / LAMPORTS_PER_SOL, liquidityUsd, source: 'quote' };
  }
  const priceUsd = info?.priceUsd;
  const solUsd = info?.solUsd;
  if (Number.isInteger(p.decimals) && p.decimals > 0 && isPositive(priceUsd) && isPositive(solUsd)) {
    const valueSol = ((Number(tokens) / 10 ** p.decimals) * priceUsd) / solUsd;
    if (Number.isFinite(valueSol) && valueSol >= 0) return { ok: true, valueSol, liquidityUsd, source: 'price' };
  }
  return { ok: false, valueSol: 0, liquidityUsd, source: 'none', error: `ni devis de vente (${q.error}) ni prix de repli` };
}

function buildPosition(
  c: TokenCandidate,
  entryLamports: number,
  tokens: bigint,
  decimals: number,
  fill: Fill,
  entryReasons: string[],
): Position {
  const entrySol = entryLamports / LAMPORTS_PER_SOL;
  return {
    id: newId('p'),
    mint: c.mint,
    symbol: c.symbol,
    decimals,
    pairAddress: c.pairAddress,
    openedAt: fill.at,
    entrySol,
    tokenAmountRaw: tokens.toString(),
    entryLiquidityUsd: Number.isFinite(c.liquidityUsd) ? c.liquidityUsd : 0,
    peakValueSol: entrySol,
    lastValueSol: entrySol,
    lastCheckedAt: fill.at,
    entryReasons: [...entryReasons],
    entryFill: fill,
  };
}

function buildTrade(ctx: Ctx, p: Position, fill: Fill, exitLamports: number, reason: ExitReason, detail: string): ClosedTrade {
  // Calcul en lamports entiers : pas de bruit flottant dans le P&L cumulé.
  const entryLamports = Math.round(p.entrySol * LAMPORTS_PER_SOL);
  const pnlLamports = exitLamports - entryLamports;
  const openedMs = Date.parse(p.openedAt);
  const closedMs = Date.parse(fill.at);
  const holdMinutes = Number.isFinite(openedMs) && Number.isFinite(closedMs) ? Math.max(0, (closedMs - openedMs) / 60_000) : 0;
  const entryFee = Number(p.entryFill?.feeLamports);
  const entrySlippage = Number(p.entryFill?.slippageBps);
  return {
    id: p.id,
    mode: ctx.mode,
    mint: p.mint,
    symbol: p.symbol,
    openedAt: p.openedAt,
    closedAt: fill.at,
    holdMinutes: Math.round(holdMinutes * 100) / 100,
    entrySol: p.entrySol,
    exitSol: exitLamports / LAMPORTS_PER_SOL,
    pnlSol: pnlLamports / LAMPORTS_PER_SOL,
    pnlPct: entryLamports > 0 ? (pnlLamports / entryLamports) * 100 : 0,
    feesSol: ((Number.isFinite(entryFee) ? entryFee : 0) + fill.feeLamports) / LAMPORTS_PER_SOL,
    entrySlippageBps: Number.isFinite(entrySlippage) ? entrySlippage : 0,
    exitSlippageBps: fill.slippageBps,
    entryReasons: [...(p.entryReasons ?? [])],
    exitReason: reason,
    exitDetail: detail,
    entrySignature: p.entryFill?.signature,
    exitSignature: fill.signature,
  };
}

// ---------------------------------------------------------------------------
// Mode papier
// ---------------------------------------------------------------------------

function createPaperCore(ctx: Ctx, ledger: PaperLedger): Core {
  const { config, clock } = ctx;
  const feeLamports = Math.ceil(Math.max(0, config.paper.feeLamportsPerTx));
  const rentLamports = Math.ceil(Math.max(0, config.paper.rentLamportsPerBuy));
  const extraBps = config.paper.extraSlippageBps;

  return {
    async freeSol() {
      return ledger.getSol();
    },

    async open(c, size, entryReasons) {
      const fill = newFill(ctx, 'buy', SOL_MINT, c.mint, String(size.lamports));
      const bad = preflightError(ctx, c, size);
      if (bad) return { fill: finishFill(ctx, fill, clock.now(), bad) };
      const decimals = await fetchDecimals(ctx, c.mint);
      const start = clock.now();

      const q = await quote(ctx, { inputMint: SOL_MINT, outputMint: c.mint, amount: String(size.lamports) });
      noteOrder(fill, q.order, q.ok ? q.outAmount : undefined);
      if (!q.ok) return { fill: finishFill(ctx, fill, start, `pas de route : ${q.error}`) };
      if (q.outAmount <= 0n) return { fill: finishFill(ctx, fill, start, 'pas de route : devis à 0 token') };
      const slip = entrySlippageError(ctx, q.order);
      if (slip) return { fill: finishFill(ctx, fill, start, slip) };

      const tokens = applyPaperPenalty(q.outAmount, extraBps);
      if (tokens <= 0n) return { fill: finishFill(ctx, fill, start, 'pas de route : quantité de tokens nulle après la pénalité papier') };
      // Coût total : montant du swap + frais réseau + loyer du compte de token (compté comme perdu).
      const costLamports = size.lamports + feeLamports + rentLamports;
      const costSol = costLamports / LAMPORTS_PER_SOL;
      const free = ledger.getSol();
      if (!(free >= costSol)) {
        return {
          fill: finishFill(
            ctx,
            fill,
            start,
            `solde papier insuffisant : ${fmt(free, 9)} SOL disponibles, ${fmt(costSol, 9)} SOL nécessaires (montant + frais + loyer)`,
          ),
        };
      }
      ledger.addSol(-costSol);

      fill.actualOutAmount = tokens.toString();
      fill.slippageBps = slippageBps(q.outAmount, tokens);
      fill.feeLamports = feeLamports + rentLamports;
      finishFill(ctx, fill, start);
      return { position: buildPosition(c, costLamports, tokens, decimals, fill, entryReasons), fill };
    },

    async close(p, reason, detail) {
      const start = clock.now();
      const tokens = parseRaw(p.tokenAmountRaw);
      const fill = newFill(ctx, 'sell', p.mint, SOL_MINT, tokens === null ? '0' : tokens.toString());
      if (tokens === null || tokens <= 0n) return { fill: finishFill(ctx, fill, start, ZERO_TOKEN_BALANCE_ERROR) };

      const q = await quote(ctx, { inputMint: p.mint, outputMint: SOL_MINT, amount: tokens.toString() });
      noteOrder(fill, q.order, q.ok ? q.outAmount : undefined);
      if (!q.ok) return { fill: finishFill(ctx, fill, start, `${NO_ROUTE_ERROR} : pas de route de vente (${q.error})`) };
      if (q.outAmount <= 0n) return { fill: finishFill(ctx, fill, start, `${NO_ROUTE_ERROR} : devis de vente à 0 SOL`) };

      const gross = applyPaperPenalty(q.outAmount, extraBps);
      const exitLamports = Number(gross) - feeLamports;
      ledger.addSol(exitLamports / LAMPORTS_PER_SOL);

      fill.actualOutAmount = gross.toString();
      fill.slippageBps = slippageBps(q.outAmount, gross);
      fill.feeLamports = feeLamports;
      finishFill(ctx, fill, start);
      return { trade: buildTrade(ctx, p, fill, exitLamports, reason, detail), fill };
    },
  };
}

// ---------------------------------------------------------------------------
// Mode live
// ---------------------------------------------------------------------------

interface SwapPlan {
  side: Side;
  inputMint: string;
  outputMint: string;
  /** Montant d'entrée brut (lamports pour un achat, tokens pour une vente). */
  amount: bigint;
  /** Préfixe de l'erreur « pas de route ». */
  noRoute: string;
}

interface Landed {
  kind: 'landed';
  order: JupiterOrder;
  quoted: bigint;
  /** null quand l'atterrissage n'est connu que par le RPC (réponse de Jupiter perdue). */
  result: JupiterExecuteResult | null;
  preLamports: number;
  estFeeLamports: number;
  signature?: string;
}

interface Failed {
  kind: 'failed';
  error: string;
}

interface Retryable {
  kind: 'retryable';
  error: string;
}

interface ExecOutcome {
  /** Réponse Success/Failed de Jupiter, ou null si aucun envoi n'a obtenu de réponse exploitable. */
  result: JupiterExecuteResult | null;
  posts: number;
  lastError: string;
}

function createLiveCore(ctx: Ctx, signer: Signer, rpc: Rpc): Core {
  const { config, clock } = ctx;
  const owner = signer.publicKey;

  async function safeBalance(): Promise<number | null> {
    try {
      const v = await rpc.getBalanceLamports(owner);
      return Number.isSafeInteger(v) && v >= 0 ? v : null;
    } catch {
      return null;
    }
  }

  async function safeHeld(mint: string): Promise<{ sum: bigint; decimals?: number } | null> {
    try {
      return sumForMint(await rpc.getTokenBalances(owner), mint);
    } catch {
      return null;
    }
  }

  /** Envoie le payload signé ; s'il n'y a pas de réponse, renvoie LE MÊME (jamais de re-signature). */
  async function executeIdempotent(payload: string, requestId: string, budgetStartMs: number): Promise<ExecOutcome> {
    let lastError = '';
    let posts = 0;
    for (;;) {
      posts++;
      try {
        const res = await ctx.jupiter.execute(payload, requestId);
        if (res && typeof res === 'object' && (res.status === 'Success' || res.status === 'Failed')) {
          return { result: res, posts, lastError };
        }
        lastError = `réponse inattendue de /execute (${safeJson(res)})`;
      } catch (e) {
        lastError = describeError(e);
      }
      if (posts > EXECUTE_REPOSTS) break;
      if (clock.now() - budgetStartMs + EXECUTE_REPOST_WAIT_MS > EXECUTE_BUDGET_MS) break;
      await ctx.sleep(EXECUTE_REPOST_WAIT_MS);
    }
    return { result: null, posts, lastError };
  }

  /** Statut de la transaction côté RPC, quand Jupiter n'a pas pu nous le dire. */
  async function landedStatus(sig: string | undefined): Promise<{ state: 'landed' | 'failed' | 'unknown'; detail: string }> {
    if (!sig) return { state: 'unknown', detail: 'signature inconnue (frais payés par un tiers) : statut non vérifiable' };
    try {
      const st = await rpc.getSignatureStatus(sig);
      if (!st) return { state: 'unknown', detail: `transaction ${sig} introuvable sur le RPC pour l'instant` };
      if (st.err !== null && st.err !== undefined) return { state: 'failed', detail: `${safeJson(st.err)} (signature ${sig})` };
      return { state: 'landed', detail: `transaction ${sig} vue par le RPC (${st.confirmationStatus ?? 'statut ?'})` };
    } catch (e) {
      return { state: 'unknown', detail: `statut de ${sig} illisible (${describeError(e)})` };
    }
  }

  /** Une tentative complète : devis → pare-feu → solde avant → simulation → signature → exécution. */
  async function attempt(plan: SwapPlan, fill: Fill): Promise<Landed | Failed | Retryable> {
    const fail = (error: string): Failed => ({ kind: 'failed', error });

    // 1. Devis + transaction à signer.
    const q = await quote(ctx, {
      inputMint: plan.inputMint,
      outputMint: plan.outputMint,
      amount: plan.amount.toString(),
      taker: owner,
    });
    noteOrder(fill, q.order, q.ok ? q.outAmount : undefined);
    if (!q.ok) return fail(`${plan.noRoute} : ${q.error}`);
    if (q.outAmount <= 0n) return fail(`${plan.noRoute} : devis à 0 en sortie`);
    const order = q.order;
    const orderAtMs = clock.now();
    if (plan.side === 'buy') {
      const slip = entrySlippageError(ctx, order);
      if (slip) return fail(slip);
    }
    const requestId = typeof order.requestId === 'string' ? order.requestId.trim() : '';
    if (!requestId) return fail('devis Jupiter sans requestId : exécution impossible');
    if (typeof order.transaction !== 'string' || order.transaction.trim() === '') {
      const why = orderErrorText(order);
      return fail(`Jupiter n'a pas fourni de transaction à signer (${why ?? 'solde insuffisant ?'})`);
    }

    // 2. Pare-feu : on ne signe que ce qu'on comprend.
    const bytes = fromBase64(order.transaction);
    const maxSolOut = plan.side === 'buy' ? plan.amount + BigInt(FEE_MARGIN_LAMPORTS) : BigInt(FEE_MARGIN_LAMPORTS);
    const verdict = inspectSwapTransaction(bytes, {
      owner,
      side: plan.side,
      maxSolOutLamports: maxSolOut,
      maxPriorityFeeLamports: MAX_PRIORITY_FEE_LAMPORTS,
      allowedPrograms: config.allowedPrograms,
    });
    if (!verdict.ok) return fail(`pare-feu : ${verdict.reasons.join(' ; ')}`);

    // 3. Solde avant, puis simulation de la transaction exacte qui sera signée (octets inspectés).
    const unsigned = toBase64(bytes);
    let pre: number;
    try {
      pre = await rpc.getBalanceLamports(owner);
    } catch (e) {
      return fail(`RPC : solde du wallet illisible avant le swap (${describeError(e)})`);
    }
    if (!Number.isSafeInteger(pre) || pre < 0) return fail(`RPC : solde du wallet invalide (${String(pre)})`);
    let sim: SimulationResult;
    try {
      sim = await rpc.simulate(unsigned, [owner]);
    } catch (e) {
      return fail(`simulation impossible (${describeError(e)})`);
    }
    const problems = checkSimulatedBalance({
      side: plan.side,
      preLamports: pre,
      postLamports: sim?.postLamports?.[0] ?? null,
      maxSolOutLamports: Number(maxSolOut),
      minSolInLamports: plan.side === 'sell' ? minSolInLamports(order, q.outAmount) : 0,
      simulationError: sim?.err,
    });
    if (problems.length > 0) return fail(problems.join(' ; '));

    // 4. Signature : une seule par devis.
    let signed: Uint8Array;
    try {
      signed = signTransaction(bytes, signer);
    } catch (e) {
      return fail(`signature impossible (${describeError(e)})`);
    }
    const payload = toBase64(signed);
    const ownSig = ownTransactionId(signed, owner);
    if (ownSig) fill.signature = ownSig;
    const estFee = estimateFeeLamports(order, verdict.gasless, verdict.priorityFeeLamports);
    const landed = (result: JupiterExecuteResult | null): Landed => ({
      kind: 'landed',
      order,
      quoted: q.outAmount,
      result,
      preLamports: pre,
      estFeeLamports: estFee,
      signature: (typeof result?.signature === 'string' && result.signature) || ownSig,
    });

    // 5. Exécution (renvois idempotents du même payload).
    const exec = await executeIdempotent(payload, requestId, orderAtMs);
    const res = exec.result;
    if (res && typeof res.signature === 'string' && res.signature) fill.signature = res.signature;
    if (res && res.status === 'Success') return landed(res);
    if (res && res.status === 'Failed' && exec.posts === 1) {
      // Échec annoncé dès le premier envoi : l'issue est connue, un nouveau devis est sans risque.
      const msg = executeFailure(res);
      return RETRYABLE_EXECUTE_CODES.has(res.code) ? { kind: 'retryable', error: msg } : fail(msg);
    }

    // 6. Issue inconnue (aucune réponse, ou échec annoncé après des envois sans réponse) :
    //    ni nouveau devis ni nouvelle signature ; on demande au RPC si la transaction a atterri.
    const st = await landedStatus(ownSig);
    if (st.state === 'landed') return landed(null);
    if (st.state === 'failed') return fail(`transaction échouée on-chain : ${st.detail}`);
    const said = res ? ` ; dernière réponse de Jupiter : ${executeFailure(res)}` : '';
    return fail(
      `${UNKNOWN_OUTCOME_ERROR} : issue de l'exécution inconnue après ${exec.posts} envoi(s) du même payload ` +
        `(${exec.lastError || 'pas de réponse'})${said} ; ${st.detail} ; vérifier le wallet avant toute nouvelle tentative`,
    );
  }

  async function swap(plan: SwapPlan, fill: Fill): Promise<Landed | Failed> {
    let last: Retryable | undefined;
    for (let i = 0; i < SWAP_ATTEMPTS; i++) {
      const r = await attempt(plan, fill);
      if (r.kind !== 'retryable') return r;
      last = r;
    }
    return { kind: 'failed', error: `${last?.error ?? 'échec'} (${SWAP_ATTEMPTS} tentatives complètes)` };
  }

  return {
    async freeSol() {
      // Pas de valeur par défaut : un 0 inventé fausserait l'equity (drawdown, arrêt durable).
      return (await rpc.getBalanceLamports(owner)) / LAMPORTS_PER_SOL;
    },

    async open(c, size, entryReasons) {
      const fill = newFill(ctx, 'buy', SOL_MINT, c.mint, String(size.lamports));
      const bad = preflightError(ctx, c, size);
      if (bad) return { fill: finishFill(ctx, fill, clock.now(), bad) };
      const searchDecimals = await fetchDecimals(ctx, c.mint);
      const start = clock.now();

      const r = await swap(
        { side: 'buy', inputMint: SOL_MINT, outputMint: c.mint, amount: BigInt(size.lamports), noRoute: 'pas de route' },
        fill,
      );
      if (r.kind === 'failed') return { fill: finishFill(ctx, fill, start, r.error) };

      // L'argent est parti : à partir d'ici rien ne lève, la position est toujours rendue.
      const held = await safeHeld(c.mint);
      const post = await safeBalance();
      const inputUsed = parseRaw(r.result?.inputAmountResult) ?? BigInt(size.lamports);
      const outResult = parseRaw(r.result?.outputAmountResult);
      // Tokens détenus : solde on-chain ; repli sur la sortie annoncée, puis sur le minimum garanti du devis.
      const tokens = held && held.sum > 0n ? held.sum : (outResult ?? parseRaw(r.order.otherAmountThreshold) ?? r.quoted);
      let entryLamports: number;
      let feeLamports: number;
      if (post !== null && r.preLamports - post >= Number(inputUsed)) {
        // Mesure réelle : tout ce qui a quitté le wallet (swap + frais + loyer des comptes créés).
        entryLamports = r.preLamports - post;
        feeLamports = entryLamports - Number(inputUsed);
      } else {
        // RPC en retard ou illisible : montant engagé + frais estimés.
        feeLamports = r.estFeeLamports;
        entryLamports = Number(inputUsed) + feeLamports;
      }
      const actualOut = outResult ?? tokens;
      fill.actualOutAmount = actualOut.toString();
      fill.slippageBps = slippageBps(r.quoted, actualOut);
      fill.feeLamports = feeLamports;
      if (r.signature) fill.signature = r.signature;
      finishFill(ctx, fill, start);
      const decimals = searchDecimals > 0 ? searchDecimals : (held?.decimals ?? 0);
      return { position: buildPosition(c, entryLamports, tokens, decimals, fill, entryReasons), fill };
    },

    async close(p, reason, detail) {
      const start = clock.now();
      const stored = parseRaw(p.tokenAmountRaw);
      const fill = newFill(ctx, 'sell', p.mint, SOL_MINT, stored === null ? '0' : stored.toString());
      let held: { sum: bigint; decimals?: number };
      try {
        held = sumForMint(await rpc.getTokenBalances(owner), p.mint);
      } catch (e) {
        return { fill: finishFill(ctx, fill, start, `RPC : soldes de tokens illisibles (${describeError(e)}), vente reportée`) };
      }
      if (held.sum <= 0n) return { fill: finishFill(ctx, fill, start, ZERO_TOKEN_BALANCE_ERROR) };
      // On ne vend jamais plus que ce que la position détient, ni plus que ce que le wallet a vraiment.
      const toSell = stored !== null && stored > 0n && stored < held.sum ? stored : held.sum;
      fill.inAmount = toSell.toString();

      const r = await swap({ side: 'sell', inputMint: p.mint, outputMint: SOL_MINT, amount: toSell, noRoute: NO_ROUTE_ERROR }, fill);
      if (r.kind === 'failed') return { fill: finishFill(ctx, fill, start, r.error) };

      // L'argent a bougé : rien ne lève, le trade est toujours rendu.
      const post = await safeBalance();
      const outResult = parseRaw(r.result?.outputAmountResult);
      let exitLamports: number;
      let feeLamports: number;
      if (post !== null && post !== r.preLamports) {
        // Mesure réelle : SOL reçu net de tous les frais.
        exitLamports = post - r.preLamports;
        feeLamports = outResult !== null ? Math.max(0, Number(outResult) - exitLamports) : r.estFeeLamports;
      } else {
        // RPC en retard ou illisible : sortie annoncée (sinon minimum garanti du devis) moins frais estimés.
        const gross = outResult ?? parseRaw(r.order.otherAmountThreshold) ?? r.quoted;
        feeLamports = r.estFeeLamports;
        exitLamports = Number(gross) - feeLamports;
      }
      const actualOut = outResult ?? BigInt(Math.max(0, exitLamports + feeLamports));
      fill.actualOutAmount = actualOut.toString();
      fill.slippageBps = slippageBps(r.quoted, actualOut);
      fill.feeLamports = feeLamports;
      if (r.signature) fill.signature = r.signature;
      finishFill(ctx, fill, start);
      return { trade: buildTrade(ctx, p, fill, exitLamports, reason, detail), fill };
    },
  };
}

/** Vente : SOL minimal attendu à la simulation, d'après le seuil garanti du devis (marge de 5 % et de frais). */
function minSolInLamports(order: JupiterOrder, quoted: bigint): number {
  const threshold = parseRaw(order.otherAmountThreshold) ?? quoted;
  return Math.max(0, Math.floor(Number(threshold) * 0.95) - FEE_MARGIN_LAMPORTS);
}

/** Frais estimés quand la mesure par solde est impossible. */
function estimateFeeLamports(order: JupiterOrder, gasless: boolean, priorityFee: bigint): number {
  const nonNeg = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
  const rent = nonNeg(order.rentFeeLamports) ?? 0;
  if (gasless) return Math.round(rent);
  const signature = nonNeg(order.signatureFeeLamports) ?? SIGNATURE_FEE_LAMPORTS;
  const priority = nonNeg(order.prioritizationFeeLamports) ?? Number(priorityFee);
  return Math.round(signature + priority + rent);
}

/** Identifiant de la transaction (1re signature) si c'est nous qui payons les frais ; sinon inconnu avant co-signature. */
function ownTransactionId(signed: Uint8Array, owner: string): string | undefined {
  try {
    return parseTransaction(signed).staticKeys[0] === owner ? transactionId(signed) : undefined;
  } catch {
    return undefined;
  }
}

function executeFailure(res: JupiterExecuteResult): string {
  const err = typeof res.error === 'string' && res.error ? ` : ${res.error}` : '';
  return `échec de l'exécution Jupiter (code ${String(res.code)}${err})`;
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

/** Montant brut (chaîne décimale d'entier ≥ 0) → bigint ; null si illisible. */
function parseRaw(v: unknown): bigint | null {
  if (typeof v === 'bigint') return v >= 0n ? v : null;
  if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null;
  if (typeof v === 'string') {
    const s = v.trim();
    return /^\d{1,20}$/.test(s) ? BigInt(s) : null;
  }
  return null;
}

/** Retire la pénalité papier (bps, décimales acceptées) ; arrondi vers le bas (prudent). */
function applyPaperPenalty(raw: bigint, extraBps: number): bigint {
  const bps = Math.min(Math.max(Number.isFinite(extraBps) ? extraBps : 0, 0), 10_000);
  const keepMillionths = BigInt(Math.round((10_000 - bps) * 100)); // sur 1 000 000
  return (raw * keepMillionths) / 1_000_000n;
}

function sumForMint(balances: TokenBalance[], mint: string): { sum: bigint; decimals?: number } {
  let sum = 0n;
  let decimals: number | undefined;
  for (const b of Array.isArray(balances) ? balances : []) {
    if (!b || b.mint !== mint) continue;
    const amount = parseRaw(b.amountRaw);
    if (amount !== null) sum += amount;
    if (decimals === undefined && Number.isInteger(b.decimals) && b.decimals >= 0) decimals = b.decimals;
  }
  return { sum, decimals };
}

function isPositive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function usdOrUndefined(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function orderErrorText(o: JupiterOrder): string | undefined {
  const msg = [o.errorMessage, o.error].find((s): s is string => typeof s === 'string' && s.trim() !== '');
  const code = typeof o.errorCode === 'number' ? `code ${o.errorCode}` : undefined;
  if (msg && code) return `${msg} (${code})`;
  return msg ?? code;
}

function describeError(e: unknown): string {
  if (e instanceof Error) {
    const detail = apiMessage((e as Error & { body?: unknown }).body);
    return detail && !e.message.includes(detail) ? `${e.message} : ${detail}` : e.message;
  }
  return typeof e === 'string' ? e : safeJson(e);
}

/** Message d'erreur lisible dans le corps d'une réponse d'API (HttpError.body). */
function apiMessage(body: unknown): string | undefined {
  if (typeof body === 'string') return body.trim().slice(0, 200) || undefined;
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    for (const k of ['errorMessage', 'error', 'message']) {
      const v = b[k];
      if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 200);
    }
  }
  return undefined;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : x)) ?? String(v);
  } catch {
    return String(v);
  }
}

/** Nombre avec au plus `decimals` décimales, point décimal, sans zéros inutiles. */
function fmt(n: number, decimals: number): string {
  if (!Number.isFinite(n)) return String(n);
  let s = n.toFixed(decimals);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}
