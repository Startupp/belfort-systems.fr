/**
 * Orchestrateur : la chaîne des six workers, dans cet ordre, à chaque tour.
 *
 *   scanner ──► rugcheck ──► sizer ──► executor ──► logger ──► equity
 *   (paires,     (filtre        (taille     (achat/vente,  (raison de   (courbe mise
 *    pics de      AVANT toute    depuis      slippage       chaque       à jour à
 *    volume)      exécution)     l'equity)   mesuré)        trade)       chaque clôture)
 *
 * Deux boucles : sorties toutes les EXIT_CHECK_SEC (stop, objectif, stop suiveur, durée,
 * liquidité qui fond), scan + au plus UNE entrée toutes les SCAN_INTERVAL_SEC.
 *
 * Usage : npm start (boucle)   npm run once (un tour puis arrêt)   node src/main.ts --status
 * Mode papier par défaut : aucune transaction, capital virtuel, devis Jupiter réels.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigError, LIVE_CONFIRM_PHRASE, describeConfig, loadConfig, loadDotEnv } from './config.ts';
import type { Config } from './config.ts';
import { createHttp } from './lib/http.ts';
import type { Http } from './lib/http.ts';
import { createJupiterClient } from './lib/jupiter.ts';
import type { JupiterClient } from './lib/jupiter.ts';
import { createRpc } from './lib/rpc.ts';
import type { Rpc } from './lib/rpc.ts';
import { loadKeypairFile } from './lib/keypair.ts';
import type { Signer } from './lib/keypair.ts';
import { ensureDir, readJson, systemClock, writeJsonAtomic } from './lib/store.ts';
import { evaluateGuards, initialState } from './guards/killswitch.ts';
import { createDexScreener } from './lib/dexscreener.ts';
import type { DexScreener } from './lib/dexscreener.ts';
import { createScanner, pickReferencePair } from './workers/scanner.ts';
import { createRugcheckApi } from './lib/rugcheckApi.ts';
import { createRugChecker } from './workers/rugcheck.ts';
import { sizePosition } from './workers/sizer.ts';
import { createExecutor } from './workers/executor.ts';
import type { Executor, MarketInfo } from './workers/executor.ts';
import { decideExit } from './workers/exits.ts';
import { buildEntryReasons, createLogger } from './workers/logger.ts';
import type { Logger } from './workers/logger.ts';
import { createEquityTracker, sweepAmountSol } from './workers/equity.ts';
import { sweepToVault } from './maintenance.ts';
import { SOL_MINT } from './types.ts';
import type { BotState, ClosedTrade, Clock, EquitySnapshot, ExitReason, GuardDecision, Position } from './types.ts';

/** Après autant d'échecs de vente d'affilée, la position est comptée perdue (rug, plus de route). */
const MAX_CLOSE_FAILURES = 10;
/** Après un achat raté, on laisse ce token tranquille pendant 1 h. */
const FAILED_OPEN_COOLDOWN_MS = 3_600_000;

export interface BotDeps {
  config: Config;
  clock?: Clock;
  http?: Http;
  jupiter?: JupiterClient;
  dex?: DexScreener;
  rpc?: Rpc;
  signer?: Signer;
  print?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface Bot {
  readonly state: BotState;
  readonly logger: Logger;
  /** Démarrage : chargement de l'état, réconciliation live, vérifications de budget. */
  init(): Promise<void>;
  /** Vérifie chaque position ouverte et vend si une règle de sortie se déclenche. */
  manageExits(): Promise<void>;
  /** Garde-fous, scan, anti-rug, taille, au plus une entrée. */
  scanAndEnter(): Promise<void>;
  equity(): Promise<EquitySnapshot>;
  runForever(): Promise<void>;
  stop(): void;
}

export function createBot(deps: BotDeps): Bot {
  const cfg = deps.config;
  const clock = deps.clock ?? systemClock;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const http = deps.http ?? createHttp();
  const jupiter = deps.jupiter ?? createJupiterClient({ http, baseUrl: cfg.jupiter.baseUrl, apiKey: cfg.jupiter.apiKey });
  const dex = deps.dex ?? createDexScreener({ http, baseUrl: cfg.dexscreenerBaseUrl });
  const rpc = deps.rpc ?? (cfg.rpcUrl ? createRpc({ http, url: cfg.rpcUrl }) : undefined);
  const signer = deps.signer;
  const statePath = join(cfg.dataDir, 'state.json');
  const stopPath = join(cfg.dataDir, 'STOP');
  const panicPath = join(cfg.dataDir, 'PANIC');

  ensureDir(cfg.dataDir);
  const logger = createLogger({ dataDir: cfg.dataDir, clock, mode: cfg.mode, print: deps.print });

  let state: BotState = readJson<BotState | null>(statePath, null) ?? initialState(cfg.mode, cfg.paper.startSol, clock.now());
  const fresh = !existsSync(statePath);
  const save = (): void => writeJsonAtomic(statePath, state);
  const patch = (p: Partial<BotState>): void => {
    state = { ...state, ...p };
  };

  const scanner = createScanner({ jupiter, dex, clock, config: cfg });
  const rug = createRugChecker({ rugcheck: createRugcheckApi({ http, baseUrl: cfg.rugcheck.baseUrl, apiKey: cfg.rugcheck.apiKey }), jupiter, clock, config: cfg });
  const equityTracker = createEquityTracker({ dataDir: cfg.dataDir, clock, mode: cfg.mode, getState: () => state, patchState: patch });

  // Prix et liquidité DexScreener : repli pour valoriser une position et détecter la fuite de liquidité.
  let solUsdCache: { at: number; value: number } | null = null;
  async function solUsd(): Promise<number> {
    if (solUsdCache && clock.now() - solUsdCache.at < 60_000) return solUsdCache.value;
    const p = await jupiter.prices([SOL_MINT]);
    const v = p[SOL_MINT]?.usdPrice;
    if (!v || !Number.isFinite(v) || v <= 0) throw new Error('prix du SOL indisponible');
    solUsdCache = { at: clock.now(), value: v };
    return v;
  }
  async function marketInfo(mint: string): Promise<MarketInfo | undefined> {
    try {
      const pairs = await dex.pairsForTokens('solana', [mint]);
      const ref = pickReferencePair(pairs, mint, cfg.scanner.quoteSymbols);
      return { priceUsd: ref?.priceUsd, liquidityUsd: ref?.liquidityUsd, solUsd: await solUsd().catch(() => undefined) };
    } catch {
      return undefined;
    }
  }

  const executor: Executor = createExecutor({
    mode: cfg.mode,
    config: cfg,
    clock,
    jupiter,
    marketInfo,
    signer,
    rpc,
    sleep,
    ledger:
      cfg.mode === 'paper'
        ? {
            getSol: () => state.paperSol,
            addSol: (d: number) => {
              state.paperSol = Math.max(0, Math.round((state.paperSol + d) * 1e9) / 1e9);
            },
          }
        : undefined,
  });

  const closeFailures = new Map<string, number>();
  let lastGuard: GuardDecision | null = null;
  let running = false;

  async function equity(): Promise<EquitySnapshot> {
    const free = await executor.freeSol();
    const positions = state.positions.reduce((s, p) => s + p.lastValueSol, 0);
    return equityTracker.snapshot(free, positions);
  }

  function guards(snap: EquitySnapshot): GuardDecision {
    const { decision, patch: p } = evaluateGuards({
      state,
      equity: snap,
      nowMs: clock.now(),
      cfg,
      stopFile: existsSync(stopPath),
      panicFile: existsSync(panicPath),
    });
    if (Object.keys(p).length) {
      patch(p);
      save();
    }
    logger.guard(decision);
    lastGuard = decision;
    return decision;
  }

  async function recordClose(p: Position, trade: ClosedTrade, fillOk: Parameters<Logger['close']>[1]): Promise<void> {
    state.positions = state.positions.filter((x) => x.id !== p.id);
    closeFailures.delete(p.id);
    const now = clock.now();
    state.day = { ...state.day, realizedPnlSol: state.day.realizedPnlSol + trade.pnlSol, trades: state.day.trades + 1 };
    state.consecutiveLosses = trade.pnlSol <= 0 ? state.consecutiveLosses + 1 : 0;
    state.closedTrades += 1;
    state.cooldowns[p.mint] = new Date(now + cfg.guards.tokenCooldownHours * 3_600_000).toISOString();
    const snap = await equity();
    trade.equityAfterSol = snap.equitySol;
    logger.close(trade, fillOk);
    // La courbe montre l'equity « totale » : wallet + gains déjà mis à l'abri dans le coffre.
    equityTracker.onClose(trade, { ...snap, equitySol: snap.equitySol + state.totalSweptSol });
    save();
    await maybeSweep(snap);
  }

  async function closePosition(p: Position, reason: ExitReason, detail: string): Promise<void> {
    const res = await executor.close(p, reason, detail);
    if (res.fill.ok && res.trade) {
      await recordClose(p, res.trade, res.fill);
      return;
    }
    logger.closeFailed(p, res.fill, reason);
    const n = (closeFailures.get(p.id) ?? 0) + 1;
    closeFailures.set(p.id, n);
    if (n >= MAX_CLOSE_FAILURES) {
      // Plus de route de vente depuis longtemps : on assume la perte (−100 %) au lieu de se mentir.
      const at = clock.iso();
      const lost: ClosedTrade = {
        id: p.id,
        mode: cfg.mode,
        mint: p.mint,
        symbol: p.symbol,
        openedAt: p.openedAt,
        closedAt: at,
        holdMinutes: Math.round((clock.now() - Date.parse(p.openedAt)) / 60_000),
        entrySol: p.entrySol,
        exitSol: 0,
        pnlSol: -p.entrySol,
        pnlPct: -100,
        feesSol: p.entryFill.feeLamports / 1e9,
        entrySlippageBps: p.entryFill.slippageBps,
        exitSlippageBps: 0,
        entryReasons: p.entryReasons,
        exitReason: 'NO_ROUTE',
        exitDetail: `${n} ventes impossibles d'affilée (${res.fill.error ?? 'raison inconnue'}) : position comptée perdue`,
        entrySignature: p.entryFill.signature,
      };
      await recordClose(p, lost, res.fill);
    }
  }

  async function manageExits(): Promise<void> {
    const panic = existsSync(panicPath);
    for (const p of [...state.positions]) {
      try {
        if (panic) {
          await closePosition(p, 'PANIC', 'fichier PANIC : vente immédiate demandée');
          continue;
        }
        const mark = await executor.mark(p);
        if (mark.ok) {
          p.lastValueSol = mark.valueSol;
          p.peakValueSol = Math.max(p.peakValueSol, mark.valueSol);
        }
        p.lastCheckedAt = clock.iso();
        const d = decideExit(p, mark, clock.now(), cfg.exits);
        if (d.exit && d.reason) await closePosition(p, d.reason, d.detail ?? '');
      } catch (e) {
        logger.error('sorties', e, { mint: p.mint });
      }
    }
    save();
    writeJsonAtomic(join(cfg.dataDir, 'heartbeat.json'), {
      at: clock.iso(),
      mode: cfg.mode,
      positions: state.positions.map((p) => ({ symbol: p.symbol, entrySol: p.entrySol, lastValueSol: p.lastValueSol })),
      guards: lastGuard?.reasons ?? [],
    });
  }

  async function maybeSweep(snap: EquitySnapshot): Promise<void> {
    const vault = cfg.sweep.vaultAddress;
    if (!vault) return;
    const amount = sweepAmountSol(snap.freeSol, snap.equitySol, state.initialEquitySol, cfg.sweep.triggerPct, cfg.sizer.feeReserveSol);
    if (amount < 0.001) return;
    try {
      let signature: string | undefined;
      if (cfg.mode === 'live') {
        if (!rpc || !signer) return;
        ({ signature } = await sweepToVault(rpc, signer, vault, amount, { sleep }));
      } else {
        state.paperSol = Math.round((state.paperSol - amount) * 1e9) / 1e9;
      }
      state.totalSweptSol += amount;
      state.peakEquitySol = Math.max(state.initialEquitySol, state.peakEquitySol - amount);
      save();
      logger.event('sweep', `${amount.toFixed(4)} SOL mis à l'abri vers le coffre (total ${state.totalSweptSol.toFixed(4)} SOL)`, {
        data: { amount, signature, vault: `${vault.slice(0, 4)}…${vault.slice(-4)}` },
      });
    } catch (e) {
      logger.error('mise à l’abri', e);
    }
  }

  async function scanAndEnter(): Promise<void> {
    let snap = await equity();
    let g = guards(snap);
    if (!g.allowEntries) return;

    const now = clock.now();
    for (const [mint, until] of Object.entries(state.cooldowns)) {
      if (Date.parse(until) <= now) delete state.cooldowns[mint];
    }
    const exclude = new Set([...state.positions.map((p) => p.mint), ...Object.keys(state.cooldowns)]);
    const result = await scanner.scan(exclude);
    logger.scan(result);
    if (result.candidates.length === 0) return;

    let sol: number;
    try {
      sol = await solUsd();
    } catch (e) {
      logger.error('prix du SOL', e);
      return; // échoue fermé : pas d'entrée sans prix de référence
    }

    for (const c of result.candidates) {
      const verdict = await rug.check(c);
      if (!verdict.pass) {
        logger.reject(c, verdict);
        continue;
      }
      const size = sizePosition({ equity: snap, openPositions: state.positions, candidate: c, solUsd: sol, cfg: cfg.sizer });
      if (!size.ok) {
        logger.sizeSkip(c, size);
        continue;
      }
      const reasons = buildEntryReasons(c, verdict, size);
      const res = await executor.open(c, size, reasons);
      if (res.position) {
        state.positions.push(res.position);
        state.recentOpens.push(clock.iso());
        save();
        logger.open(res.position, size);
      } else {
        state.cooldowns[c.mint] = new Date(clock.now() + FAILED_OPEN_COOLDOWN_MS).toISOString();
        save();
        logger.openFailed(c, res.fill);
      }
      // Une seule entrée par tour : on laisse le marché et les garde-fous respirer.
      snap = await equity();
      g = guards(snap);
      break;
    }
  }

  async function reconcileLive(): Promise<void> {
    if (!rpc || !signer) throw new Error('live : RPC et clé obligatoires');
    const balances = await rpc.getTokenBalances(signer.publicKey);
    const held = new Map<string, bigint>();
    for (const b of balances) held.set(b.mint, (held.get(b.mint) ?? 0n) + BigInt(b.amountRaw));
    for (const p of [...state.positions]) {
      const onchain = held.get(p.mint) ?? 0n;
      if (onchain === 0n) {
        state.positions = state.positions.filter((x) => x.id !== p.id);
        logger.event('reconcile', `${p.symbol} : plus aucun token on-chain (vendu à la main ?) → retiré du suivi`, { mint: p.mint, symbol: p.symbol });
      } else if (onchain.toString() !== p.tokenAmountRaw) {
        logger.event('reconcile', `${p.symbol} : quantité on-chain ${onchain} ≠ suivie ${p.tokenAmountRaw} → mise à jour`, { mint: p.mint });
        p.tokenAmountRaw = onchain.toString();
      }
    }
    const tracked = new Set(state.positions.map((p) => p.mint));
    const strangers = [...held.entries()].filter(([m, a]) => a > 0n && !tracked.has(m) && m !== SOL_MINT);
    if (strangers.length) {
      logger.event(
        'reconcile',
        `${strangers.length} token(s) non suivis dans le wallet (airdrops de spam probables) : n'y touche pas, ne visite aucun lien associé`,
        { data: strangers.map(([m]) => m) },
      );
    }
    save();
  }

  async function init(): Promise<void> {
    if (state.mode !== cfg.mode) {
      throw new ConfigError(`${statePath} contient un état « ${state.mode} » : utilise un autre DATA_DIR pour le mode ${cfg.mode}`);
    }
    if (cfg.mode === 'live') {
      if (!signer) throw new ConfigError('live : clé du wallet non chargée');
      if (fresh) {
        const free = await executor.freeSol();
        if (free > cfg.guards.maxWalletSol) {
          throw new ConfigError(
            `le wallet du bot contient ${free.toFixed(3)} SOL, plus que MAX_WALLET_SOL=${cfg.guards.maxWalletSol}. Ce n'est pas le petit budget prévu : retire l'excédent avant de démarrer.`,
          );
        }
        if (free < cfg.sizer.minPositionSol + cfg.sizer.feeReserveSol) {
          throw new ConfigError(`le wallet du bot ne contient que ${free.toFixed(4)} SOL : alimente-le d'abord (adresse ${signer.publicKey})`);
        }
        state = initialState('live', free, clock.now());
      }
      await reconcileLive();
    }
    save();
    const snap = await equity();
    logger.event(
      'start',
      `démarrage ${cfg.mode === 'paper' ? 'PAPIER (aucune transaction réelle)' : 'LIVE'} — equity ${snap.equitySol.toFixed(4)} SOL, ${state.positions.length} position(s) ouverte(s)`,
      { data: { config: describeConfig(cfg), wallet: signer?.publicKey } },
    );
  }

  async function runForever(): Promise<void> {
    running = true;
    let nextScan = 0;
    let nextExit = 0;
    while (running) {
      const now = clock.now();
      try {
        if (now >= nextExit) {
          await manageExits();
          nextExit = clock.now() + cfg.loop.exitCheckSec * 1000;
        }
        if (now >= nextScan) {
          await scanAndEnter();
          nextScan = clock.now() + cfg.loop.scanIntervalSec * 1000;
        }
        if (existsSync(panicPath) && state.positions.length === 0) {
          logger.event('stop', 'PANIC traité : toutes les positions sont fermées, arrêt du bot');
          running = false;
          break;
        }
      } catch (e) {
        logger.error('boucle', e);
      }
      await sleep(1_000);
    }
  }

  return {
    get state() {
      return state;
    },
    logger,
    init,
    manageExits,
    scanAndEnter,
    equity,
    runForever,
    stop() {
      running = false;
    },
  };
}

// ---------------------------------------------------------------------------
// Point d'entrée en ligne de commande
// ---------------------------------------------------------------------------

async function cli(): Promise<void> {
  loadDotEnv();
  const args = new Set(process.argv.slice(2));
  let config: Config;
  try {
    config = loadConfig();
  } catch (e) {
    console.error(`Configuration : ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  if (args.has('--status')) {
    const s = readJson<BotState | null>(join(config.dataDir, 'state.json'), null);
    console.log(s ? JSON.stringify({ mode: s.mode, initialEquitySol: s.initialEquitySol, peakEquitySol: s.peakEquitySol, paperSol: s.paperSol, positions: s.positions.map((p) => ({ symbol: p.symbol, entrySol: p.entrySol, lastValueSol: p.lastValueSol, openedAt: p.openedAt })), closedTrades: s.closedTrades, halted: s.halted, totalSweptSol: s.totalSweptSol }, null, 2) : 'Aucun état : le bot n’a jamais tourné avec ce DATA_DIR.');
    return;
  }

  let signer: Signer | undefined;
  if (config.mode === 'live') {
    if (!config.liveConfirmed) {
      console.error(
        `Mode live refusé : ajoute LIVE_CONFIRM=${LIVE_CONFIRM_PHRASE} dans .env pour confirmer que tu acceptes de perdre tout le solde de ce wallet.`,
      );
      process.exit(1);
    }
    const { signer: s, warnings } = loadKeypairFile(config.keypairPath);
    for (const w of warnings) console.warn(`ATTENTION : ${w}`);
    signer = s;
  }

  const bot = createBot({ config, signer });
  try {
    await bot.init();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  const shutdown = (sig: string): void => {
    bot.stop();
    const n = bot.state.positions.length;
    bot.logger.event('stop', `arrêt (${sig})${n ? ` — ${n} position(s) ouverte(s) restent SANS surveillance tant que le bot est arrêté` : ''}`);
    setTimeout(() => process.exit(0), 200);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  if (args.has('--once')) {
    await bot.manageExits();
    await bot.scanAndEnter();
    await bot.manageExits();
    const snap = await bot.equity();
    bot.logger.event('info', `tour unique terminé — equity ${snap.equitySol.toFixed(4)} SOL`);
    return;
  }
  await bot.runForever();
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('main.ts')) {
  cli().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
