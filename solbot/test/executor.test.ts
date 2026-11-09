/**
 * Tests de l'exécuteur : papier (chiffres exacts) et live avec une VRAIE clé Ed25519.
 * Aucun réseau : Jupiter et le RPC sont simulés autour d'un wallet fictif (soldes avant/après).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, verify as edVerify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { loadConfig, LIVE_CONFIRM_PHRASE } from '../src/config.ts';
import type { Config } from '../src/config.ts';
import { encodeBase58 } from '../src/lib/base58.ts';
import type { JupiterClient, JupiterExecuteResult, JupiterOrder, OrderParams } from '../src/lib/jupiter.ts';
import { signerFromSecretKey } from '../src/lib/keypair.ts';
import type { Signer } from '../src/lib/keypair.ts';
import type { Rpc, SignatureStatus, SimulationResult } from '../src/lib/rpc.ts';
import { compileLegacyTransaction, fromBase64, parseTransaction, systemTransfer, toBase64, TOKEN_PROGRAM_ID } from '../src/lib/solanaTx.ts';
import { fixedClock } from '../src/lib/store.ts';
import { SOL_MINT } from '../src/types.ts';
import type { Position, SizeDecision, TokenCandidate } from '../src/types.ts';
import {
  createExecutor,
  NO_ROUTE_ERROR,
  slippageBps,
  UNKNOWN_OUTCOME_ERROR,
  ZERO_TOKEN_BALANCE_ERROR,
} from '../src/workers/executor.ts';
import type { PaperLedger } from '../src/workers/executor.ts';

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

const T0 = Date.parse('2026-11-08T12:00:00.000Z');
const MIN = 60_000;
const randomAddress = (): string => encodeBase58(randomBytes(32));
const OTHER = randomAddress();
const NETWORK_FEE = 5_000;
const RENT = 2_039_280;

const paperConfig = (env: Record<string, string> = {}): Config => loadConfig({ JUPITER_API_KEY: 'test', ...env }, '/tmp');
const liveConfig = (env: Record<string, string> = {}): Config =>
  loadConfig({ JUPITER_API_KEY: 'test', MODE: 'live', RPC_URL: 'http://127.0.0.1:8899', LIVE_CONFIRM: LIVE_CONFIRM_PHRASE, ...env }, '/tmp');

function near(actual: number, expected: number, eps = 1e-12): void {
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≠ ${expected}`);
}

function candidate(mint: string, over: Partial<TokenCandidate> = {}): TokenCandidate {
  return {
    mint,
    symbol: 'MEME',
    name: 'Meme',
    pairAddress: randomAddress(),
    dexId: 'raydium',
    quoteSymbol: 'SOL',
    priceUsd: 0.0002,
    liquidityUsd: 80_000,
    marketCapUsd: 500_000,
    pairCreatedAtMs: T0 - 3_600_000,
    ageMinutes: 60,
    vol5mUsd: 20_000,
    vol1hUsd: 60_000,
    buys5m: 80,
    sells5m: 40,
    priceChange5mPct: 5,
    priceChange1hPct: 10,
    spikeRatio: 4,
    buySellRatio: 2,
    sources: ['test'],
    score: 1,
    signals: [],
    observedAt: new Date(T0).toISOString(),
    ...over,
  };
}

const size = (lamports: number): SizeDecision => ({ ok: true, sizeSol: lamports / 1e9, lamports, reason: 'test', capsApplied: [] });

function memLedger(sol: number): PaperLedger & { sol: number; moves: number[] } {
  const l = {
    sol,
    moves: [] as number[],
    getSol: () => l.sol,
    addSol: (d: number) => {
      l.moves.push(d);
      l.sol += d;
    },
  };
  return l;
}

/** Vraie clé Ed25519 : graine (fin du DER pkcs8) ‖ clé publique (fin du DER spki). */
function makeSigner(): { signer: Signer; publicKeyObject: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const secret = new Uint8Array(64);
  secret.set(pkcs8.subarray(pkcs8.length - 32), 0);
  secret.set(spki.subarray(spki.length - 32), 32);
  return { signer: signerFromSecretKey(secret), publicKeyObject: publicKey };
}

function countingSigner(s: Signer): Signer & { count: number } {
  const w = {
    publicKey: s.publicKey,
    publicKeyBytes: s.publicKeyBytes,
    count: 0,
    sign(message: Uint8Array): Uint8Array {
      w.count++;
      return s.sign(message);
    },
  };
  return w;
}

/** Comportement d'un appel à /execute (le dernier de la liste se répète). */
type ExecStep =
  | { kind: 'success'; outputAmount?: string; noAmounts?: boolean }
  | { kind: 'failed'; code: number; error?: string }
  | { kind: 'throw'; landed?: boolean }
  | { kind: 'garbage' };

interface Wallet {
  sol: number;
  tokens: Map<string, bigint>;
}

interface HarnessOptions {
  sol?: number;
  tokens?: Array<[string, bigint]>;
  /** Champs du devis (remplacent les valeurs par défaut) ; peut lever pour simuler une API en panne. */
  quote?: (p: OrderParams, n: number) => Partial<JupiterOrder>;
  /** SOL transféré par l'instruction System de la transaction fabriquée. */
  transferLamports?: (p: OrderParams) => bigint;
  exec?: ExecStep[];
  simulate?: (tx: string, wallet: Wallet) => SimulationResult;
  status?: (sig: string) => SignatureStatus | null;
  onExecute?: () => void;
  orderDelay?: () => Promise<void>;
  decimals?: number;
}

interface Harness {
  jupiter: JupiterClient;
  rpc: Rpc;
  wallet: Wallet;
  orders: OrderParams[];
  executes: Array<{ tx: string; requestId: string }>;
  simulations: Array<{ tx: string; accounts: string[] }>;
  statuses: string[];
  sleeps: number[];
  sleep: (ms: number) => Promise<void>;
}

const sigOf = (txBase64: string): string => encodeBase58(parseTransaction(fromBase64(txBase64)).signatures[0] as Uint8Array);
const notUsed = async (): Promise<never> => {
  throw new Error('non utilisé dans ce test');
};

/**
 * Jupiter + RPC simulés autour d'un même wallet. Un achat coûte montant + frais + loyer et crédite
 * les tokens ; une vente débite les tokens et crédite la sortie moins les frais. Une même
 * transaction signée n'atterrit qu'une fois (comme sur Solana).
 */
function harness(o: HarnessOptions = {}): Harness {
  const wallet: Wallet = { sol: o.sol ?? 0, tokens: new Map(o.tokens ?? []) };
  const orders: OrderParams[] = [];
  const executes: Array<{ tx: string; requestId: string }> = [];
  const simulations: Array<{ tx: string; accounts: string[] }> = [];
  const statuses: string[] = [];
  const sleeps: number[] = [];
  const byRequest = new Map<string, { p: OrderParams; out: bigint }>();
  const byTx = new Map<string, { p: OrderParams; out: bigint }>();
  const applied = new Set<string>();
  let execCount = 0;

  const isBuy = (p: OrderParams): boolean => p.inputMint === SOL_MINT;
  const solDelta = (p: OrderParams, out: bigint): number => (isBuy(p) ? -(Number(p.amount) + NETWORK_FEE + RENT) : Number(out) - NETWORK_FEE);
  function land(payload: string, p: OrderParams, out: bigint): void {
    if (applied.has(payload)) return;
    applied.add(payload);
    wallet.sol += solDelta(p, out);
    const mint = isBuy(p) ? p.outputMint : p.inputMint;
    wallet.tokens.set(mint, (wallet.tokens.get(mint) ?? 0n) + (isBuy(p) ? out : -BigInt(p.amount)));
  }

  const jupiter: JupiterClient = {
    async order(p) {
      orders.push({ ...p });
      const n = orders.length;
      if (o.orderDelay) await o.orderDelay();
      const custom = o.quote ? o.quote(p, n) : {};
      const transfer = o.transferLamports ? o.transferLamports(p) : isBuy(p) ? BigInt(p.amount) : 5_000n;
      const tx = p.taker
        ? toBase64(compileLegacyTransaction(p.taker, [systemTransfer(p.taker, OTHER, transfer)], randomAddress()))
        : null;
      const order: JupiterOrder = {
        requestId: `req-${n}`,
        transaction: tx,
        inputMint: p.inputMint,
        outputMint: p.outputMint,
        inAmount: p.amount,
        outAmount: '1000000000',
        otherAmountThreshold: '990000000',
        slippageBps: 50,
        feeBps: 10,
        router: 'metis',
        ...custom,
      };
      const out = BigInt(order.outAmount ?? '0');
      byRequest.set(order.requestId, { p, out });
      if (typeof order.transaction === 'string') byTx.set(order.transaction, { p, out });
      return order;
    },
    async execute(tx, requestId): Promise<JupiterExecuteResult> {
      executes.push({ tx, requestId });
      o.onExecute?.();
      const steps: ExecStep[] = o.exec ?? [{ kind: 'success' }];
      const step: ExecStep = steps[Math.min(execCount, steps.length - 1)] ?? { kind: 'success' };
      execCount++;
      const r = byRequest.get(requestId);
      if (!r) throw new Error(`requestId inconnu : ${requestId}`);
      const defaultOut = (r.out * 996n) / 1000n; // 40 bps de slippage réel
      switch (step.kind) {
        case 'throw':
          if (step.landed) land(tx, r.p, defaultOut);
          throw new Error('POST /swap/v2/execute → échec réseau : délai dépassé');
        case 'garbage':
          return { status: 'Pending', code: 0 };
        case 'failed':
          return { status: 'Failed', code: step.code, error: step.error, signature: sigOf(tx) };
        case 'success': {
          const out = step.outputAmount !== undefined ? BigInt(step.outputAmount) : defaultOut;
          land(tx, r.p, out);
          if (step.noAmounts) return { status: 'Success', code: 0, signature: sigOf(tx) };
          return {
            status: 'Success',
            code: 0,
            signature: sigOf(tx),
            slot: 123,
            inputAmountResult: r.p.amount,
            outputAmountResult: out.toString(),
            totalInputAmount: r.p.amount,
            totalOutputAmount: out.toString(),
          };
        }
      }
    },
    tokensByCategory: notUsed,
    tokensRecent: notUsed,
    async tokensSearch(mints) {
      return mints.map((id) => ({ id, symbol: 'MEME', decimals: o.decimals ?? 6 }));
    },
    prices: notUsed,
  };

  const rpc: Rpc = {
    async getBalanceLamports() {
      return wallet.sol;
    },
    async getTokenBalances() {
      return [...wallet.tokens]
        .filter(([, v]) => v > 0n)
        .map(([mint, v]) => ({ account: `ata-${mint.slice(0, 8)}`, mint, amountRaw: v.toString(), decimals: 6, programId: TOKEN_PROGRAM_ID }));
    },
    getLatestBlockhash: notUsed,
    sendTransaction: notUsed,
    async getSignatureStatus(sig) {
      statuses.push(sig);
      return o.status ? o.status(sig) : null;
    },
    async simulate(tx, accounts) {
      simulations.push({ tx, accounts: [...accounts] });
      if (o.simulate) return o.simulate(tx, wallet);
      const r = byTx.get(tx);
      if (!r) return { err: 'transaction inconnue', logs: [], postLamports: [null] };
      return { err: null, logs: [], postLamports: [wallet.sol + solDelta(r.p, r.out)] };
    },
  };

  return {
    jupiter,
    rpc,
    wallet,
    orders,
    executes,
    simulations,
    statuses,
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
  };
}

// ---------------------------------------------------------------------------
// slippageBps (pur)
// ---------------------------------------------------------------------------

describe('slippageBps', () => {
  it('formule (devis − réel) / devis × 10 000, au dixième', () => {
    assert.equal(slippageBps(1000n, 990n), 100);
    assert.equal(slippageBps(1000n, 1000n), 0);
    assert.equal(slippageBps(3n, 2n), 3333.3);
    assert.equal(slippageBps(1_000_000_000n, 985_000_000n), 150);
  });

  it('négatif quand on obtient mieux que le devis', () => {
    assert.equal(slippageBps(1000n, 1010n), -100);
    assert.equal(slippageBps(200_000n, 200_001n), -0.1);
  });

  it('arrondi au plus proche (demi vers le haut)', () => {
    assert.equal(slippageBps(20_000n, 19_999n), 0.5); // 0.5 bps exactement
    assert.equal(slippageBps(40_000n, 39_999n), 0.3); // 0.25 bps → 0.3
    assert.equal(slippageBps(200_000n, 199_999n), 0.1); // 0.05 bps → 0.1
    assert.equal(slippageBps(2_000_000n, 1_999_999n), 0); // 0.005 bps → 0
    assert.equal(slippageBps(2_000_001n, 2_000_000n), 0); // 0.0049… bps → 0
  });

  it('devis nul → 0 ; calcul exact au-delà de 2^53', () => {
    assert.equal(slippageBps(0n, 5n), 0);
    assert.equal(slippageBps(10n ** 19n, 10n ** 19n - 10n ** 15n), 1);
    assert.equal(slippageBps(10n ** 19n, 10n ** 19n - 123_456_789_000_000n), 0.1);
    assert.equal(slippageBps(18_446_744_073_709_551_615n, 0n), 10_000);
  });
});

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------

describe('createExecutor : dépendances obligatoires', () => {
  const h = harness();
  const clock = fixedClock(T0);
  const { signer } = makeSigner();

  it('live sans signer, sans rpc, sans LIVE_CONFIRM ou avec une config papier : refus', () => {
    assert.throws(() => createExecutor({ mode: 'live', config: liveConfig(), clock, jupiter: h.jupiter, rpc: h.rpc }), /signer obligatoire/);
    assert.throws(() => createExecutor({ mode: 'live', config: liveConfig(), clock, jupiter: h.jupiter, signer }), /rpc obligatoire/);
    assert.throws(
      () => createExecutor({ mode: 'live', config: liveConfig({ LIVE_CONFIRM: '' }), clock, jupiter: h.jupiter, rpc: h.rpc, signer }),
      /LIVE_CONFIRM/,
    );
    assert.throws(
      () => createExecutor({ mode: 'live', config: paperConfig(), clock, jupiter: h.jupiter, rpc: h.rpc, signer }),
      /configuration papier/,
    );
  });

  it('papier sans ledger : refus', () => {
    assert.throws(() => createExecutor({ mode: 'paper', config: paperConfig(), clock, jupiter: h.jupiter }), /ledger obligatoire/);
  });

  it('freeSol : solde virtuel en papier, solde RPC en live', async () => {
    const paper = createExecutor({ mode: 'paper', config: paperConfig(), clock, jupiter: h.jupiter, ledger: memLedger(3.25) });
    assert.equal(await paper.freeSol(), 3.25);
    const live = harness({ sol: 1_234_500_000 });
    const ex = createExecutor({ mode: 'live', config: liveConfig(), clock, jupiter: live.jupiter, rpc: live.rpc, signer });
    assert.equal(await ex.freeSol(), 1.2345);
  });

  it('freeSol live : une panne RPC rejette (jamais un 0 inventé qui fausserait l\'equity)', async () => {
    const live = harness();
    const rpc: Rpc = { ...live.rpc, getBalanceLamports: async () => Promise.reject(new Error('RPC indisponible')) };
    const ex = createExecutor({ mode: 'live', config: liveConfig(), clock, jupiter: live.jupiter, rpc, signer });
    await assert.rejects(ex.freeSol(), /RPC indisponible/);
  });
});

// ---------------------------------------------------------------------------
// Papier
// ---------------------------------------------------------------------------

describe('exécuteur papier', () => {
  const buyQuote = { outAmount: '1000000000', otherAmountThreshold: '990000000', slippageBps: 50, feeBps: 10, router: 'iris' };

  it('ouverture, évaluation et clôture : chiffres exacts (pénalité, frais, loyer, slippage, P&L)', async () => {
    const mint = randomAddress();
    const clock = fixedClock(T0);
    const ledger = memLedger(7);
    let sellOut = '250000000';
    const h = harness({
      quote: (p) => (p.inputMint === SOL_MINT ? buyQuote : { outAmount: sellOut, otherAmountThreshold: '1', slippageBps: 50, feeBps: 10, router: 'iris' }),
    });
    const ex = createExecutor({
      mode: 'paper',
      config: paperConfig(),
      clock,
      jupiter: h.jupiter,
      ledger,
      marketInfo: async () => ({ liquidityUsd: 75_000, priceUsd: 0.0002, solUsd: 200 }),
    });

    const reasons = ['pic de volume ×4', 'anti-rug OK', 'taille 0.2 SOL'];
    const { position, fill } = await ex.open(candidate(mint), size(200_000_000), reasons);
    assert.equal(fill.ok, true, fill.error);
    assert.deepEqual(h.orders[0], { inputMint: SOL_MINT, outputMint: mint, amount: '200000000' });
    assert.equal(fill.side, 'buy');
    assert.equal(fill.mode, 'paper');
    assert.equal(fill.inputMint, SOL_MINT);
    assert.equal(fill.outputMint, mint);
    assert.equal(fill.inAmount, '200000000');
    assert.equal(fill.quotedOutAmount, '1000000000');
    assert.equal(fill.actualOutAmount, '985000000'); // devis × (1 − 150 / 10 000)
    assert.equal(fill.slippageBps, 150);
    assert.equal(fill.feeLamports, 150_000 + 2_039_280); // frais + loyer
    assert.equal(fill.jupiterFeeBps, 10);
    assert.equal(fill.router, 'iris');
    assert.equal(fill.requestId, 'req-1');
    assert.equal(fill.signature, undefined);
    assert.equal(fill.error, undefined);
    assert.equal(fill.latencyMs, 0);
    assert.equal(fill.at, new Date(T0).toISOString());
    assert.equal(h.executes.length, 0, 'aucune exécution en papier');

    assert.ok(position);
    assert.match(position.id, /^p-/);
    assert.equal(position.mint, mint);
    assert.equal(position.symbol, 'MEME');
    assert.equal(position.decimals, 6);
    assert.equal(position.openedAt, new Date(T0).toISOString());
    assert.equal(position.tokenAmountRaw, '985000000');
    assert.equal(position.entrySol, 0.20218928); // 200 000 000 + 150 000 + 2 039 280 lamports
    assert.equal(position.peakValueSol, position.entrySol);
    assert.equal(position.lastValueSol, position.entrySol);
    assert.equal(position.entryLiquidityUsd, 80_000);
    assert.deepEqual(position.entryReasons, reasons);
    assert.notEqual(position.entryReasons, reasons, 'copie, pas la même référence');
    assert.equal(position.entryFill, fill);
    near(ledger.sol, 7 - 0.20218928);
    assert.deepEqual(ledger.moves, [-0.20218928]);

    // Évaluation : devis de vente moins la pénalité papier.
    clock.advance(10 * MIN);
    const m = await ex.mark(position);
    assert.deepEqual(h.orders[1], { inputMint: mint, outputMint: SOL_MINT, amount: '985000000' });
    assert.equal(m.ok, true);
    assert.equal(m.source, 'quote');
    near(m.valueSol, 0.24625); // 250 000 000 × 0.985 / 1e9
    assert.equal(m.liquidityUsd, 75_000);
    assert.equal(m.error, undefined);

    // Clôture.
    sellOut = '300000000';
    clock.advance(20 * MIN);
    const { trade, fill: exit } = await ex.close(position, 'TAKE_PROFIT', "+46.1 % depuis l'entrée (objectif +35 %)");
    assert.equal(exit.ok, true, exit.error);
    assert.equal(exit.side, 'sell');
    assert.equal(exit.inputMint, mint);
    assert.equal(exit.outputMint, SOL_MINT);
    assert.equal(exit.inAmount, '985000000');
    assert.equal(exit.quotedOutAmount, '300000000');
    assert.equal(exit.actualOutAmount, '295500000');
    assert.equal(exit.slippageBps, 150);
    assert.equal(exit.feeLamports, 150_000);
    near(ledger.sol, 7 - 0.20218928 + 0.29535);

    assert.ok(trade);
    assert.equal(trade.id, position.id);
    assert.equal(trade.mode, 'paper');
    assert.equal(trade.openedAt, position.openedAt);
    assert.equal(trade.closedAt, new Date(T0 + 30 * MIN).toISOString());
    assert.equal(trade.holdMinutes, 30);
    assert.equal(trade.entrySol, 0.20218928);
    assert.equal(trade.exitSol, 0.29535); // (295 500 000 − 150 000) / 1e9
    assert.equal(trade.pnlSol, 0.09316072);
    near(trade.pnlPct, (93_160_720 / 202_189_280) * 100, 1e-9);
    assert.equal(trade.feesSol, 0.00233928); // 2 189 280 + 150 000 lamports
    assert.equal(trade.entrySlippageBps, 150);
    assert.equal(trade.exitSlippageBps, 150);
    assert.deepEqual(trade.entryReasons, reasons);
    assert.equal(trade.exitReason, 'TAKE_PROFIT');
    assert.equal(trade.exitDetail, "+46.1 % depuis l'entrée (objectif +35 %)");
    assert.equal(trade.entrySignature, undefined);
    assert.equal(trade.exitSignature, undefined);
  });

  it('pas de route à l\'achat (erreur Jupiter ou devis sans outAmount) : rien n\'est débité', async () => {
    const ledger = memLedger(7);
    const clock = fixedClock(T0);
    const noRoute = harness({ quote: () => ({ outAmount: undefined, error: 'No routes found' }) });
    let ex = createExecutor({ mode: 'paper', config: paperConfig(), clock, jupiter: noRoute.jupiter, ledger });
    let r = await ex.open(candidate(randomAddress()), size(100_000_000), []);
    assert.equal(r.fill.ok, false);
    assert.equal(r.position, undefined);
    assert.match(r.fill.error ?? '', /^pas de route : No routes found/);

    const down = harness({
      quote: () => {
        throw new Error('GET https://api.jup.ag/swap/v2/order → HTTP 503');
      },
    });
    ex = createExecutor({ mode: 'paper', config: paperConfig(), clock, jupiter: down.jupiter, ledger });
    r = await ex.open(candidate(randomAddress()), size(100_000_000), []);
    assert.equal(r.fill.ok, false);
    assert.match(r.fill.error ?? '', /^pas de route : devis Jupiter impossible .*HTTP 503/);
    assert.equal(ledger.sol, 7);
    assert.deepEqual(ledger.moves, []);
  });

  it('entrée refusée si Jupiter prévoit un slippage au-dessus du maximum (150 bps)', async () => {
    const ledger = memLedger(7);
    const h = harness({ quote: () => ({ slippageBps: 151 }) });
    const ex = createExecutor({ mode: 'paper', config: paperConfig(), clock: fixedClock(T0), jupiter: h.jupiter, ledger });
    const r = await ex.open(candidate(randomAddress()), size(100_000_000), []);
    assert.equal(r.fill.ok, false);
    assert.equal(r.fill.error, 'entrée refusée : slippage prévu par Jupiter 151 bps au-dessus du maximum 150 bps (marché trop volatil)');
    assert.equal(r.fill.quotedOutAmount, '1000000000');
    assert.equal(ledger.sol, 7);

    const atMax = harness({ quote: () => ({ slippageBps: 150 }) });
    const ok = await createExecutor({ mode: 'paper', config: paperConfig(), clock: fixedClock(T0), jupiter: atMax.jupiter, ledger }).open(
      candidate(randomAddress()),
      size(100_000_000),
      [],
    );
    assert.equal(ok.fill.ok, true, 'pile au maximum : accepté');
  });

  it('solde papier insuffisant : refus, rien n\'est débité', async () => {
    const ledger = memLedger(0.2); // il faut 0.20218928 SOL
    const h = harness();
    const ex = createExecutor({ mode: 'paper', config: paperConfig(), clock: fixedClock(T0), jupiter: h.jupiter, ledger });
    const r = await ex.open(candidate(randomAddress()), size(200_000_000), []);
    assert.equal(r.fill.ok, false);
    assert.match(r.fill.error ?? '', /solde papier insuffisant : 0\.2 SOL disponibles, 0\.20218928 SOL nécessaires/);
    assert.deepEqual(ledger.moves, []);
  });

  it('taille refusée, hors plafond ou mint invalide : aucun devis demandé', async () => {
    const ledger = memLedger(7);
    const h = harness();
    const ex = createExecutor({ mode: 'paper', config: paperConfig(), clock: fixedClock(T0), jupiter: h.jupiter, ledger });
    const refused = await ex.open(candidate(randomAddress()), { ok: false, sizeSol: 0, lamports: 0, reason: 'exposition max', capsApplied: [] }, []);
    assert.match(refused.fill.error ?? '', /taille refusée par le sizer \(exposition max\)/);
    const tooBig = await ex.open(candidate(randomAddress()), size(400_001_001), []); // MAX_POSITION_SOL = 0.4
    assert.match(tooBig.fill.error ?? '', /au-dessus du plafond 0\.4 SOL/);
    const fractional = await ex.open(candidate(randomAddress()), size(1.5), []);
    assert.match(fractional.fill.error ?? '', /taille invalide/);
    const badMint = await ex.open(candidate('pas-une-adresse'), size(100_000_000), []);
    assert.match(badMint.fill.error ?? '', /mint invalide/);
    const sol = await ex.open(candidate(SOL_MINT), size(100_000_000), []);
    assert.match(sol.fill.error ?? '', /SOL lui-même/);
    assert.equal(h.orders.length, 0);
    assert.deepEqual(ledger.moves, []);
    const atCap = await ex.open(candidate(randomAddress()), size(400_000_000), []);
    assert.equal(atCap.fill.ok, true, 'pile au plafond : accepté');
  });

  it('évaluation sans devis : repli sur le prix, sinon « none »', async () => {
    const mint = randomAddress();
    const h = harness({
      quote: (p) => {
        if (p.inputMint === SOL_MINT) return {};
        throw new Error('pas de route');
      },
    });
    const clock = fixedClock(T0);
    let info: { priceUsd?: number; solUsd?: number; liquidityUsd?: number } | undefined = { priceUsd: 0.0002, solUsd: 200, liquidityUsd: 60_000 };
    const ex = createExecutor({ mode: 'paper', config: paperConfig(), clock, jupiter: h.jupiter, ledger: memLedger(7), marketInfo: async () => info });
    const { position } = await ex.open(candidate(mint), size(200_000_000), []);
    assert.ok(position);

    let m = await ex.mark(position); // 985 tokens × 0.0002 $ / 200 $
    assert.equal(m.ok, true);
    assert.equal(m.source, 'price');
    near(m.valueSol, 0.000985);
    assert.equal(m.liquidityUsd, 60_000);

    m = await ex.mark({ ...position, decimals: 0 });
    assert.equal(m.ok, false, 'décimales inconnues : pas de repli au prix');
    assert.equal(m.source, 'none');

    info = { liquidityUsd: 60_000 };
    m = await ex.mark(position);
    assert.equal(m.ok, false);
    assert.equal(m.source, 'none');
    assert.equal(m.valueSol, 0);
    assert.equal(m.liquidityUsd, 60_000);
    assert.match(m.error ?? '', /ni devis de vente \(devis Jupiter impossible \(pas de route\)\) ni prix de repli/);

    info = undefined;
    m = await ex.mark(position);
    assert.equal(m.source, 'none');
    assert.equal(m.liquidityUsd, undefined);

    const failing = createExecutor({
      mode: 'paper',
      config: paperConfig(),
      clock,
      jupiter: h.jupiter,
      ledger: memLedger(7),
      marketInfo: async () => {
        throw new Error('DexScreener en panne');
      },
    });
    m = await failing.mark(position);
    assert.equal(m.source, 'none', 'marketInfo qui lève : ignoré sans planter');
  });

  it('clôture sans route : erreur NO_ROUTE, rien n\'est crédité', async () => {
    const mint = randomAddress();
    const ledger = memLedger(7);
    const h = harness({ quote: (p) => (p.inputMint === SOL_MINT ? {} : { outAmount: undefined, errorMessage: 'Could not find any route' }) });
    const ex = createExecutor({ mode: 'paper', config: paperConfig(), clock: fixedClock(T0), jupiter: h.jupiter, ledger });
    const { position } = await ex.open(candidate(mint), size(100_000_000), []);
    assert.ok(position);
    const before = ledger.sol;
    const r = await ex.close(position, 'STOP_LOSS', 'test');
    assert.equal(r.fill.ok, false);
    assert.equal(r.trade, undefined);
    assert.ok(r.fill.error?.startsWith(`${NO_ROUTE_ERROR} : `), r.fill.error);
    assert.match(r.fill.error ?? '', /Could not find any route/);
    assert.equal(ledger.sol, before);

    const empty = await ex.close({ ...position, tokenAmountRaw: '0' }, 'STOP_LOSS', 'test');
    assert.equal(empty.fill.error, ZERO_TOKEN_BALANCE_ERROR);
  });

  it('deux opérations simultanées sur le même token : la seconde est refusée', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const mint = randomAddress();
    const ledger = memLedger(7);
    const h = harness({ orderDelay: () => gate });
    const ex = createExecutor({ mode: 'paper', config: paperConfig(), clock: fixedClock(T0), jupiter: h.jupiter, ledger });
    const first = ex.open(candidate(mint), size(100_000_000), []);
    const second = await ex.open(candidate(mint), size(100_000_000), []);
    assert.equal(second.fill.ok, false);
    assert.match(second.fill.error ?? '', /déjà en cours/);
    release();
    const r1 = await first;
    assert.equal(r1.fill.ok, true, r1.fill.error);
    assert.equal(ledger.moves.length, 1, 'un seul achat débité');
    const third = await ex.open(candidate(mint), size(100_000_000), []);
    assert.equal(third.fill.ok, true, 'une fois la première terminée, le token est à nouveau disponible');
  });
});

// ---------------------------------------------------------------------------
// Live (vraie signature Ed25519, Jupiter et RPC simulés)
// ---------------------------------------------------------------------------

describe('exécuteur live', () => {
  const sellQuote = { outAmount: '300000000', otherAmountThreshold: '297000000', slippageBps: 50 };

  function setup(o: HarnessOptions = {}): {
    h: Harness;
    signer: Signer & { count: number };
    publicKeyObject: KeyObject;
    clock: ReturnType<typeof fixedClock>;
    ex: ReturnType<typeof createExecutor>;
  } {
    const { signer, publicKeyObject } = makeSigner();
    const counting = countingSigner(signer);
    const h = harness({ sol: 2_000_000_000, ...o });
    const clock = fixedClock(T0);
    const ex = createExecutor({ mode: 'live', config: liveConfig(), clock, jupiter: h.jupiter, rpc: h.rpc, signer: counting, sleep: h.sleep });
    return { h, signer: counting, publicKeyObject, clock, ex };
  }

  it('achat puis vente : pare-feu, simulation, signature Ed25519 valide, soldes mesurés', async () => {
    const mint = randomAddress();
    const { h, signer, publicKeyObject, clock, ex } = setup({
      quote: (p) => (p.inputMint === SOL_MINT ? {} : sellQuote),
      exec: [{ kind: 'success', outputAmount: '996000000' }, { kind: 'success', outputAmount: '298500000' }],
    });

    const { position, fill } = await ex.open(candidate(mint), size(200_000_000), ['raison']);
    assert.equal(fill.ok, true, fill.error);
    assert.equal(h.orders.length, 1);
    assert.equal(h.orders[0]?.taker, signer.publicKey);
    assert.equal(h.orders[0]?.amount, '200000000');

    // Simulation de la transaction NON signée, avec notre wallet comme compte observé.
    assert.equal(h.simulations.length, 1);
    assert.deepEqual(h.simulations[0]?.accounts, [signer.publicKey]);
    const simulated = parseTransaction(fromBase64(h.simulations[0]?.tx ?? ''));
    assert.ok(simulated.signatures[0]?.every((b) => b === 0), 'simulée avant signature');

    // Le payload exécuté porte une signature Ed25519 valide du message, par notre clé.
    assert.equal(h.executes.length, 1);
    assert.equal(h.executes[0]?.requestId, 'req-1');
    const sent = parseTransaction(fromBase64(h.executes[0]?.tx ?? ''));
    assert.deepEqual(sent.messageBytes, simulated.messageBytes, 'on signe exactement ce qui a été inspecté et simulé');
    assert.equal(sent.staticKeys[0], signer.publicKey);
    assert.ok(edVerify(null, sent.messageBytes, publicKeyObject, sent.signatures[0] as Uint8Array), 'signature valide');
    assert.equal(signer.count, 1);

    // Mesures : 2 000 000 000 → 1 797 955 720 lamports (swap + frais + loyer).
    assert.equal(fill.mode, 'live');
    assert.equal(fill.quotedOutAmount, '1000000000');
    assert.equal(fill.actualOutAmount, '996000000');
    assert.equal(fill.slippageBps, 40);
    assert.equal(fill.feeLamports, NETWORK_FEE + RENT);
    assert.equal(fill.signature, encodeBase58(sent.signatures[0] as Uint8Array));
    assert.equal(fill.requestId, 'req-1');
    assert.equal(fill.router, 'metis');
    assert.equal(fill.jupiterFeeBps, 10);
    assert.ok(position);
    assert.equal(position.entrySol, 0.20204428);
    assert.equal(position.tokenAmountRaw, '996000000');
    assert.equal(position.decimals, 6);
    assert.deepEqual(h.sleeps, []);

    // Vente : le wallet détient un peu plus que la position (poussière) → on vend la quantité de la position.
    h.wallet.tokens.set(mint, 1_000_000_000n);
    clock.advance(45 * MIN);
    const { trade, fill: exit } = await ex.close(position, 'TRAILING_STOP', 'recul de 13 %');
    assert.equal(exit.ok, true, exit.error);
    assert.equal(h.orders[1]?.amount, '996000000');
    assert.equal(h.orders[1]?.taker, signer.publicKey);
    assert.equal(exit.inAmount, '996000000');
    assert.equal(exit.quotedOutAmount, '300000000');
    assert.equal(exit.actualOutAmount, '298500000');
    assert.equal(exit.slippageBps, 50);
    assert.equal(exit.feeLamports, NETWORK_FEE);
    const sold = parseTransaction(fromBase64(h.executes[1]?.tx ?? ''));
    assert.ok(edVerify(null, sold.messageBytes, publicKeyObject, sold.signatures[0] as Uint8Array));
    assert.equal(signer.count, 2);
    assert.equal(h.wallet.tokens.get(mint), 4_000_000n, 'la poussière hors position reste');

    assert.ok(trade);
    assert.equal(trade.mode, 'live');
    assert.equal(trade.exitSol, 0.298495); // + 298 500 000 − 5 000 lamports mesurés
    assert.equal(trade.pnlSol, 0.09645072);
    assert.equal(trade.feesSol, (NETWORK_FEE + RENT + NETWORK_FEE) / 1e9);
    assert.equal(trade.holdMinutes, 45);
    assert.equal(trade.entrySlippageBps, 40);
    assert.equal(trade.exitSlippageBps, 50);
    assert.equal(trade.entrySignature, fill.signature);
    assert.equal(trade.exitSignature, encodeBase58(sold.signatures[0] as Uint8Array));
    assert.equal(trade.exitReason, 'TRAILING_STOP');
  });

  it('pare-feu : transaction qui ferait sortir plus que prévu → refus avant simulation et signature', async () => {
    const { h, signer, ex } = setup({ transferLamports: (p) => BigInt(p.amount) + 10_000_001n });
    const r = await ex.open(candidate(randomAddress()), size(200_000_000), []);
    assert.equal(r.fill.ok, false);
    assert.equal(r.position, undefined);
    assert.ok(r.fill.error?.startsWith('pare-feu : '), r.fill.error);
    assert.match(r.fill.error ?? '', /ferait sortir 0\.210000001 SOL du wallet, plafond prévu 0\.21 SOL/);
    assert.equal(h.simulations.length, 0);
    assert.equal(h.executes.length, 0);
    assert.equal(signer.count, 0);
    assert.equal(h.wallet.sol, 2_000_000_000);
  });

  it('pare-feu : une vente ne peut pas faire sortir plus de 0.01 SOL', async () => {
    const mint = randomAddress();
    const { h, signer, ex } = setup({ tokens: [[mint, 5_000_000n]], transferLamports: () => 10_000_001n });
    const p = livePosition(mint, '5000000');
    const r = await ex.close(p, 'STOP_LOSS', 'test');
    assert.equal(r.fill.ok, false);
    assert.ok(r.fill.error?.startsWith('pare-feu : '), r.fill.error);
    assert.equal(signer.count, 0);
    assert.equal(h.executes.length, 0);
  });

  it('simulation : coût réel au-dessus du plafond, ou simulation en échec → refus avant signature', async () => {
    const costly = setup({ simulate: (_tx, w) => ({ err: null, logs: [], postLamports: [w.sol - 250_000_000] }) });
    let r = await costly.ex.open(candidate(randomAddress()), size(200_000_000), []);
    assert.equal(r.fill.ok, false);
    assert.match(r.fill.error ?? '', /simulation : l'achat coûterait 0\.25 SOL, plafond 0\.21 SOL/);
    assert.equal(costly.h.simulations.length, 1);
    assert.equal(costly.h.executes.length, 0);
    assert.equal(costly.signer.count, 0);

    const broken = setup({ simulate: () => ({ err: { InstructionError: [3, { Custom: 6001 }] }, logs: [], postLamports: [null] }) });
    r = await broken.ex.open(candidate(randomAddress()), size(200_000_000), []);
    assert.equal(r.fill.ok, false);
    assert.match(r.fill.error ?? '', /la simulation échoue : \{"InstructionError":\[3,\{"Custom":6001\}\]\}/);
    assert.equal(broken.signer.count, 0);
  });

  it('simulation de vente : SOL reçu sous le minimum garanti → refus', async () => {
    const mint = randomAddress();
    const { h, signer, ex } = setup({
      tokens: [[mint, 996_000_000n]],
      quote: () => sellQuote,
      simulate: (_tx, w) => ({ err: null, logs: [], postLamports: [w.sol + 100_000_000] }),
    });
    const r = await ex.close(livePosition(mint, '996000000'), 'STOP_LOSS', 'test');
    assert.equal(r.fill.ok, false);
    // minimum = floor(297 000 000 × 0.95) − 10 000 000 = 272 150 000 lamports
    assert.match(r.fill.error ?? '', /ne rapporterait que 0\.1 SOL, minimum attendu 0\.27215 SOL/);
    assert.equal(signer.count, 0);
    assert.equal(h.executes.length, 0);
  });

  it('entrée refusée si Jupiter prévoit trop de slippage (live) : ni simulation ni signature', async () => {
    const { h, signer, ex } = setup({ quote: () => ({ slippageBps: 300 }) });
    const r = await ex.open(candidate(randomAddress()), size(200_000_000), []);
    assert.equal(r.fill.ok, false);
    assert.match(r.fill.error ?? '', /300 bps au-dessus du maximum 150 bps/);
    assert.equal(h.simulations.length, 0);
    assert.equal(signer.count, 0);
  });

  it('Jupiter sans transaction (solde insuffisant) : échec propre', async () => {
    const { h, ex } = setup({ quote: () => ({ transaction: null, errorMessage: 'Insufficient funds' }) });
    const r = await ex.open(candidate(randomAddress()), size(200_000_000), []);
    assert.equal(r.fill.ok, false);
    assert.equal(r.fill.error, "Jupiter n'a pas fourni de transaction à signer (Insufficient funds)");
    assert.equal(h.simulations.length, 0);
  });

  it('/execute lève deux fois puis répond : le MÊME payload est renvoyé, sans re-signer ni re-coter', async () => {
    const { h, signer, ex } = setup({ exec: [{ kind: 'throw' }, { kind: 'throw' }, { kind: 'success' }] });
    const r = await ex.open(candidate(randomAddress()), size(200_000_000), []);
    assert.equal(r.fill.ok, true, r.fill.error);
    assert.equal(h.executes.length, 3);
    const [a, b, c] = h.executes;
    assert.equal(b?.tx, a?.tx);
    assert.equal(c?.tx, a?.tx);
    assert.deepEqual(new Set(h.executes.map((e) => e.requestId)), new Set(['req-1']));
    assert.equal(signer.count, 1, 'une seule signature');
    assert.equal(h.orders.length, 1, 'un seul devis');
    assert.deepEqual(h.sleeps, [5_000, 5_000]);
    assert.ok(r.position);
    assert.equal(r.position.entrySol, 0.20204428);
    assert.equal(h.wallet.sol, 2_000_000_000 - 202_044_280, 'exécuté une seule fois');
  });

  it('/execute ne répond jamais : 4 envois du même payload, puis statut RPC ; inconnu → UNKNOWN_OUTCOME', async () => {
    const { h, signer, ex } = setup({ exec: [{ kind: 'throw' }] });
    const r = await ex.open(candidate(randomAddress()), size(200_000_000), []);
    assert.equal(r.fill.ok, false);
    assert.equal(r.position, undefined);
    assert.ok(r.fill.error?.startsWith(`${UNKNOWN_OUTCOME_ERROR} : `), r.fill.error);
    assert.match(r.fill.error ?? '', /4 envoi\(s\) du même payload/);
    assert.equal(h.executes.length, 4);
    assert.equal(new Set(h.executes.map((e) => e.tx)).size, 1);
    assert.equal(signer.count, 1);
    assert.equal(h.orders.length, 1);
    assert.deepEqual(h.sleeps, [5_000, 5_000, 5_000]);
    const sig = sigOf(h.executes[0]?.tx ?? '');
    assert.deepEqual(h.statuses, [sig], 'statut demandé au RPC pour notre signature');
    assert.equal(r.fill.signature, sig, 'signature rendue pour la réconciliation');
  });

  it('réponse perdue mais transaction atterrie (vue par le RPC) : position construite depuis les soldes', async () => {
    const mint = randomAddress();
    const { h, signer, ex } = setup({
      exec: [{ kind: 'throw', landed: true }],
      status: () => ({ err: null, confirmationStatus: 'confirmed', slot: 42 }),
    });
    const r = await ex.open(candidate(mint), size(200_000_000), []);
    assert.equal(r.fill.ok, true, r.fill.error);
    assert.ok(r.position);
    assert.equal(h.executes.length, 4);
    assert.equal(signer.count, 1);
    assert.equal(r.position.tokenAmountRaw, '996000000', 'quantité lue on-chain');
    assert.equal(r.position.entrySol, 0.20204428, 'coût mesuré par différence de solde');
    assert.equal(r.fill.slippageBps, 40);
    assert.equal(r.fill.signature, sigOf(h.executes[0]?.tx ?? ''));
  });

  it('transaction vue en échec par le RPC après des envois sans réponse : échec définitif', async () => {
    const { h, ex } = setup({ exec: [{ kind: 'throw' }], status: () => ({ err: { InstructionError: [2, 'Custom'] } }) });
    const r = await ex.open(candidate(randomAddress()), size(200_000_000), []);
    assert.equal(r.fill.ok, false);
    assert.match(r.fill.error ?? '', /^transaction échouée on-chain : /);
    assert.equal(h.orders.length, 1);
  });

  it('les renvois restent dans les 90 s qui suivent le devis', async () => {
    const { signer, publicKeyObject: _unused } = makeSigner();
    const clock = fixedClock(T0);
    const h = harness({ sol: 2_000_000_000, exec: [{ kind: 'throw' }], onExecute: () => clock.advance(40_000) });
    const ex = createExecutor({
      mode: 'live',
      config: liveConfig(),
      clock,
      jupiter: h.jupiter,
      rpc: h.rpc,
      signer,
      sleep: async (ms) => {
        h.sleeps.push(ms);
        clock.advance(ms);
      },
    });
    const r = await ex.open(candidate(randomAddress()), size(200_000_000), []);
    // Envois à t = 0, 45 s, 90 s ; le suivant partirait à 135 s : abandon.
    assert.equal(h.executes.length, 3);
    assert.ok(r.fill.error?.startsWith(UNKNOWN_OUTCOME_ERROR), r.fill.error);
  });

  it('réponse illisible de /execute : traitée comme une absence de réponse (même payload renvoyé)', async () => {
    const { h, signer, ex } = setup({ exec: [{ kind: 'garbage' }, { kind: 'success' }] });
    const r = await ex.open(candidate(randomAddress()), size(200_000_000), []);
    assert.equal(r.fill.ok, true, r.fill.error);
    assert.equal(h.executes.length, 2);
    assert.equal(h.executes[0]?.tx, h.executes[1]?.tx);
    assert.equal(signer.count, 1);
  });

  it('échec rejouable (-1000) : UNE nouvelle tentative complète (nouveau devis, nouvelle signature)', async () => {
    const { h, signer, publicKeyObject, ex } = setup({ exec: [{ kind: 'failed', code: -1000, error: 'Failed to land' }, { kind: 'success' }] });
    const r = await ex.open(candidate(randomAddress()), size(200_000_000), []);
    assert.equal(r.fill.ok, true, r.fill.error);
    assert.equal(h.orders.length, 2);
    assert.equal(h.simulations.length, 2);
    assert.equal(h.executes.length, 2);
    assert.notEqual(h.executes[0]?.tx, h.executes[1]?.tx);
    assert.deepEqual(h.executes.map((e) => e.requestId), ['req-1', 'req-2']);
    assert.equal(signer.count, 2);
    assert.equal(r.fill.requestId, 'req-2');
    const second = parseTransaction(fromBase64(h.executes[1]?.tx ?? ''));
    assert.ok(edVerify(null, second.messageBytes, publicKeyObject, second.signatures[0] as Uint8Array));
    assert.equal(h.wallet.sol, 2_000_000_000 - 202_044_280, 'un seul achat exécuté');
  });

  it('deux échecs rejouables : on s\'arrête après la seconde tentative', async () => {
    const { h, ex } = setup({ exec: [{ kind: 'failed', code: -1000 }, { kind: 'failed', code: -2003, error: 'Quote expired' }] });
    const r = await ex.open(candidate(randomAddress()), size(200_000_000), []);
    assert.equal(r.fill.ok, false);
    assert.equal(h.orders.length, 2);
    assert.match(r.fill.error ?? '', /code -2003 : Quote expired.*2 tentatives complètes/);
  });

  it('échec non rejouable (6001, slippage) : pas de nouvelle tentative', async () => {
    const { h, signer, ex } = setup({ exec: [{ kind: 'failed', code: 6001, error: 'Slippage tolerance exceeded' }] });
    const r = await ex.open(candidate(randomAddress()), size(200_000_000), []);
    assert.equal(r.fill.ok, false);
    assert.equal(r.fill.error, "échec de l'exécution Jupiter (code 6001 : Slippage tolerance exceeded)");
    assert.equal(h.orders.length, 1);
    assert.equal(h.executes.length, 1);
    assert.equal(signer.count, 1);
  });

  it('échec annoncé APRÈS un envoi sans réponse : pas de nouveau devis (issue incertaine)', async () => {
    const { h, signer, ex } = setup({ exec: [{ kind: 'throw' }, { kind: 'failed', code: -1, error: 'Missing cached order' }] });
    const r = await ex.open(candidate(randomAddress()), size(200_000_000), []);
    assert.equal(r.fill.ok, false);
    assert.ok(r.fill.error?.startsWith(UNKNOWN_OUTCOME_ERROR), r.fill.error);
    assert.match(r.fill.error ?? '', /Missing cached order/);
    assert.equal(h.orders.length, 1, 'jamais de nouveau devis tant que l\'issue est inconnue');
    assert.equal(signer.count, 1);
    assert.equal(h.statuses.length, 1);
  });

  it('succès sans montants ni solde à jour : replis prudents (montant engagé + frais estimés)', async () => {
    const mint = randomAddress();
    const { h, ex } = setup({ exec: [{ kind: 'success', noAmounts: true }] });
    // RPC en retard : le solde et les tokens ne bougent pas après l'exécution.
    const frozenSol = h.wallet.sol;
    h.rpc.getBalanceLamports = async () => frozenSol;
    h.rpc.getTokenBalances = async () => [];
    const r = await ex.open(candidate(mint), size(200_000_000), []);
    assert.equal(r.fill.ok, true, r.fill.error);
    assert.ok(r.position);
    assert.equal(r.position.tokenAmountRaw, '990000000', 'minimum garanti du devis');
    assert.equal(r.fill.feeLamports, 5_000, 'frais de signature estimés');
    assert.equal(r.position.entrySol, 0.200005);
  });

  it('vente : solde de tokens nul on-chain → erreur dédiée, aucun devis', async () => {
    const mint = randomAddress();
    const { h, ex } = setup();
    const r = await ex.close(livePosition(mint, '996000000'), 'STOP_LOSS', 'test');
    assert.equal(r.fill.ok, false);
    assert.equal(r.fill.error, ZERO_TOKEN_BALANCE_ERROR);
    assert.equal(h.orders.length, 0);
  });

  it('vente : RPC illisible → vente reportée (pas « solde nul »)', async () => {
    const mint = randomAddress();
    const { h, ex } = setup();
    h.rpc.getTokenBalances = async () => Promise.reject(new Error('429 Too Many Requests'));
    const r = await ex.close(livePosition(mint, '996000000'), 'STOP_LOSS', 'test');
    assert.equal(r.fill.ok, false);
    assert.match(r.fill.error ?? '', /^RPC : soldes de tokens illisibles .*vente reportée/);
    assert.equal(h.orders.length, 0);
  });

  it('vente : on ne vend jamais plus que le solde on-chain', async () => {
    const mint = randomAddress();
    const { h, ex } = setup({ tokens: [[mint, 700_000_000n]], quote: () => sellQuote });
    const r = await ex.close(livePosition(mint, '996000000'), 'TIME_STOP', 'test');
    assert.equal(r.fill.ok, true, r.fill.error);
    assert.equal(h.orders[0]?.amount, '700000000');
    assert.equal(r.fill.inAmount, '700000000');
    assert.equal(h.wallet.tokens.get(mint), 0n);
  });

  it('vente sans route : erreur NO_ROUTE (l\'orchestrateur réessaiera)', async () => {
    const mint = randomAddress();
    const { h, ex } = setup({
      tokens: [[mint, 996_000_000n]],
      quote: () => {
        throw new Error('GET https://api.jup.ag/swap/v2/order → HTTP 400');
      },
    });
    const r = await ex.close(livePosition(mint, '996000000'), 'STOP_LOSS', 'test');
    assert.equal(r.fill.ok, false);
    assert.ok(r.fill.error?.startsWith(`${NO_ROUTE_ERROR} : `), r.fill.error);
    assert.equal(h.simulations.length, 0);
  });

  it('évaluation live : devis de vente sans taker ni pénalité papier', async () => {
    const mint = randomAddress();
    const { h, ex } = setup({ quote: () => ({ outAmount: '250000000' }) });
    const m = await ex.mark(livePosition(mint, '996000000'));
    assert.equal(m.ok, true);
    assert.equal(m.source, 'quote');
    assert.equal(m.valueSol, 0.25);
    assert.equal(h.orders[0]?.taker, undefined);
    assert.equal(h.executes.length, 0);
  });
});

function livePosition(mint: string, tokenAmountRaw: string): Position {
  const at = new Date(T0).toISOString();
  return {
    id: 'p-live',
    mint,
    symbol: 'MEME',
    decimals: 6,
    pairAddress: randomAddress(),
    openedAt: at,
    entrySol: 0.20204428,
    tokenAmountRaw,
    entryLiquidityUsd: 80_000,
    peakValueSol: 0.20204428,
    lastValueSol: 0.20204428,
    lastCheckedAt: at,
    entryReasons: ['test'],
    entryFill: {
      side: 'buy',
      mode: 'live',
      ok: true,
      at,
      inputMint: SOL_MINT,
      outputMint: mint,
      inAmount: '200000000',
      quotedOutAmount: '1000000000',
      actualOutAmount: tokenAmountRaw,
      slippageBps: 40,
      feeLamports: NETWORK_FEE + RENT,
      signature: 'sig-entree',
    },
  };
}
