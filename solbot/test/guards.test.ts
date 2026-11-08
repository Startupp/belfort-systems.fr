/** Tests du pare-feu de transactions et des garde-fous (kill switch). */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encodeBase58 } from '../src/lib/base58.ts';
import { signerFromSecretKey } from '../src/lib/keypair.ts';
import { compileLegacyTransaction, systemTransfer, SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID, COMPUTE_BUDGET_PROGRAM_ID } from '../src/lib/solanaTx.ts';
import type { Instruction } from '../src/lib/solanaTx.ts';
import { checkSimulatedBalance, inspectSwapTransaction } from '../src/guards/firewall.ts';
import type { FirewallContext } from '../src/guards/firewall.ts';
import { evaluateGuards, initialState } from '../src/guards/killswitch.ts';
import { DEFAULT_ALLOWED_PROGRAMS, loadConfig } from '../src/config.ts';
import type { EquitySnapshot, Position } from '../src/types.ts';
import { buildV0, makeSecret } from './helpers.ts';

const addr = (): string => encodeBase58(randomBytes(32));
const BLOCKHASH = encodeBase58(new Uint8Array(32).fill(3));
const owner = signerFromSecretKey(makeSecret()).publicKey;
const JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

const ctx = (over: Partial<FirewallContext> = {}): FirewallContext => ({
  owner,
  side: 'buy',
  maxSolOutLamports: 310_000_000n,
  maxPriorityFeeLamports: 5_000_000n,
  allowedPrograms: DEFAULT_ALLOWED_PROGRAMS,
  ...over,
});

function computeBudget(units: number, microLamports: bigint): Instruction[] {
  const limit = new Uint8Array(5);
  limit[0] = 2;
  new DataView(limit.buffer).setUint32(1, units, true);
  const price = new Uint8Array(9);
  price[0] = 3;
  new DataView(price.buffer).setBigUint64(1, microLamports, true);
  return [
    { programId: COMPUTE_BUDGET_PROGRAM_ID, keys: [], data: limit },
    { programId: COMPUTE_BUDGET_PROGRAM_ID, keys: [], data: price },
  ];
}

const jupSwap = (): Instruction => ({
  programId: JUP,
  keys: [{ pubkey: owner, isSigner: true, isWritable: true }, { pubkey: addr(), isSigner: false, isWritable: true }],
  data: Uint8Array.of(1, 2, 3),
});

function tokenIx(kind: number, accounts: string[], ownerPos: number): Instruction {
  return {
    programId: TOKEN_PROGRAM_ID,
    keys: accounts.map((k, i) => ({ pubkey: k, isSigner: i === ownerPos, isWritable: i !== ownerPos })),
    data: Uint8Array.of(kind, 0, 0, 0, 0, 0, 0, 0, 0),
  };
}

test('pare-feu : swap normal accepté (SOL sortant ≤ plafond, frais de priorité raisonnables)', () => {
  const tx = compileLegacyTransaction(
    owner,
    [...computeBudget(300_000, 100_000n), systemTransfer(owner, addr(), 300_000_000n), jupSwap()],
    BLOCKHASH,
  );
  const v = inspectSwapTransaction(tx, ctx());
  assert.deepEqual(v.reasons, []);
  assert.ok(v.ok);
  assert.equal(v.solOutLamports, 300_000_000n);
  assert.equal(v.priorityFeeLamports, 30_000n);
  assert.equal(v.gasless, false);
});

test('pare-feu : refuse un transfert de SOL au-delà du montant prévu', () => {
  const tx = compileLegacyTransaction(owner, [systemTransfer(owner, addr(), 5_000_000_000n), jupSwap()], BLOCKHASH);
  const v = inspectSwapTransaction(tx, ctx());
  assert.equal(v.ok, false);
  assert.match(v.reasons.join(' '), /ferait sortir 5 SOL/);
});

test('pare-feu : refuse un programme hors liste blanche', () => {
  const evil = addr();
  const tx = compileLegacyTransaction(owner, [{ programId: evil, keys: [{ pubkey: owner, isSigner: true, isWritable: true }], data: Uint8Array.of(0) }], BLOCKHASH);
  const v = inspectSwapTransaction(tx, ctx());
  assert.equal(v.ok, false);
  assert.deepEqual(v.unknownPrograms, [evil]);
  // …mais l'accepte si on l'ajoute explicitement.
  assert.ok(inspectSwapTransaction(tx, ctx({ allowedPrograms: [...DEFAULT_ALLOWED_PROGRAMS, evil] })).ok);
});

test('pare-feu : refuse Approve / SetAuthority / transfert direct / fermeture au profit d’un tiers', () => {
  const thief = addr();
  const cases: Array<[string, Instruction]> = [
    ['Approve', tokenIx(4, [addr(), thief, owner], 2)],
    ['SetAuthority', tokenIx(6, [addr(), owner], 1)],
    ['transfert direct', tokenIx(3, [addr(), addr(), owner], 2)],
    ['TransferChecked', tokenIx(12, [addr(), addr(), addr(), owner], 3)],
    ['fermeture', tokenIx(9, [addr(), thief, owner], 2)],
  ];
  for (const [name, ix] of cases) {
    const v = inspectSwapTransaction(compileLegacyTransaction(owner, [ix], BLOCKHASH), ctx());
    assert.equal(v.ok, false, name);
  }
  // Fermeture d'un compte avec le loyer rendu à nous : accepté.
  const okClose = tokenIx(9, [addr(), owner, owner], 2);
  okClose.keys[1] = { pubkey: owner, isSigner: true, isWritable: true };
  assert.ok(inspectSwapTransaction(compileLegacyTransaction(owner, [okClose], BLOCKHASH), ctx()).ok);
});

test('pare-feu : refuse Assign du wallet et frais de priorité délirants', () => {
  const assign: Instruction = {
    programId: SYSTEM_PROGRAM_ID,
    keys: [{ pubkey: owner, isSigner: true, isWritable: true }],
    data: Uint8Array.of(1, 0, 0, 0, ...randomBytes(32)),
  };
  assert.equal(inspectSwapTransaction(compileLegacyTransaction(owner, [assign], BLOCKHASH), ctx()).ok, false);
  const burn = compileLegacyTransaction(owner, [...computeBudget(1_400_000, 1_000_000_000n), jupSwap()], BLOCKHASH);
  const v = inspectSwapTransaction(burn, ctx());
  assert.equal(v.ok, false);
  assert.match(v.reasons.join(' '), /frais de priorité/);
});

test('pare-feu : refuse si nous ne sommes pas signataires, ou programme chargé dynamiquement', () => {
  const stranger = addr();
  const tx = compileLegacyTransaction(stranger, [systemTransfer(stranger, addr(), 1n)], BLOCKHASH);
  assert.match(inspectSwapTransaction(tx, ctx()).reasons.join(' '), /pas signataire/);

  const v0 = buildV0({
    signers: [owner],
    readonlyUnsigned: [SYSTEM_PROGRAM_ID],
    instructions: [{ programIdIndex: 3, accounts: [0], data: [0] }], // index 3 = adresse chargée
    lookup: { key: addr(), writable: [], readonly: [4, 5] },
  });
  assert.match(inspectSwapTransaction(v0, ctx()).reasons.join(' '), /table de correspondance/);
  assert.equal(inspectSwapTransaction(Uint8Array.of(1, 2, 3), ctx()).ok, false);
});

test('pare-feu : swap gasless (payeur tiers) → nos frais ne sont pas comptés', () => {
  const payer = addr();
  const v0 = buildV0({
    signers: [payer, owner],
    readonlyUnsigned: [JUP],
    instructions: [{ programIdIndex: 2, accounts: [1], data: [9, 9] }],
  });
  const v = inspectSwapTransaction(v0, ctx());
  assert.ok(v.ok, v.reasons.join(' '));
  assert.equal(v.gasless, true);
});

test('simulation : plafonds d’achat et minimum de vente', () => {
  const base = { preLamports: 1_000_000_000, maxSolOutLamports: 310_000_000, minSolInLamports: 0, simulationError: null };
  assert.deepEqual(checkSimulatedBalance({ ...base, side: 'buy', postLamports: 700_000_000 }), []);
  assert.equal(checkSimulatedBalance({ ...base, side: 'buy', postLamports: 100_000_000 }).length, 1);
  assert.equal(checkSimulatedBalance({ ...base, side: 'buy', postLamports: null }).length, 1);
  assert.equal(checkSimulatedBalance({ ...base, side: 'buy', postLamports: 900_000_000, simulationError: { InstructionError: [2, 'x'] } }).length, 1);
  const sell = { ...base, side: 'sell' as const, minSolInLamports: 250_000_000 };
  assert.deepEqual(checkSimulatedBalance({ ...sell, postLamports: 1_260_000_000 }), []);
  assert.equal(checkSimulatedBalance({ ...sell, postLamports: 1_100_000_000 }).length, 1);
});

// ---------------------------------------------------------------------------

const cfg = loadConfig({ JUPITER_API_KEY: 'k' }, '/tmp');
const T0 = Date.parse('2026-11-08T12:00:00.000Z');

function eq(equitySol: number, initial = 7): EquitySnapshot {
  return {
    at: new Date(T0).toISOString(),
    freeSol: equitySol,
    positionsValueSol: 0,
    equitySol,
    peakEquitySol: Math.max(equitySol, initial),
    initialEquitySol: initial,
    drawdownPct: 0,
    returnPct: ((equitySol - initial) / initial) * 100,
  };
}

test('garde-fous : état neuf → entrées autorisées', () => {
  const s = initialState('paper', 7, T0);
  const r = evaluateGuards({ state: s, equity: eq(7), nowMs: T0, cfg, stopFile: false, panicFile: false });
  assert.deepEqual(r.decision, { allowEntries: true, panic: false, halt: false, reasons: [] });
});

test('garde-fous : STOP, PANIC, arrêt durable sur drawdown', () => {
  const s = initialState('paper', 7, T0);
  assert.equal(evaluateGuards({ state: s, equity: eq(7), nowMs: T0, cfg, stopFile: true, panicFile: false }).decision.allowEntries, false);
  const p = evaluateGuards({ state: s, equity: eq(7), nowMs: T0, cfg, stopFile: false, panicFile: true }).decision;
  assert.ok(p.panic && p.halt && !p.allowEntries);
  const h = evaluateGuards({ state: s, equity: eq(3.4), nowMs: T0, cfg, stopFile: false, panicFile: false });
  assert.ok(h.decision.halt);
  assert.ok(h.patch.halted);
  const again = evaluateGuards({ state: { ...s, ...h.patch }, equity: eq(7), nowMs: T0, cfg, stopFile: false, panicFile: false });
  assert.ok(again.decision.halt, 'reste arrêté même si l’equity remonte');
});

test('garde-fous : perte du jour, pertes d’affilée, trades par heure, positions max', () => {
  const s = initialState('paper', 7, T0);
  const day = { ...s, day: { ...s.day, realizedPnlSol: -0.8 } };
  assert.equal(evaluateGuards({ state: day, equity: eq(6.2), nowMs: T0, cfg, stopFile: false, panicFile: false }).decision.allowEntries, false);
  // Le lendemain, le compteur repart à zéro.
  const next = evaluateGuards({ state: day, equity: eq(6.2), nowMs: T0 + 86_400_000, cfg, stopFile: false, panicFile: false });
  assert.equal(next.decision.allowEntries, true);
  assert.equal(next.patch.day?.realizedPnlSol, 0);

  const losses = evaluateGuards({ state: { ...s, consecutiveLosses: 5 }, equity: eq(7), nowMs: T0, cfg, stopFile: false, panicFile: false });
  assert.equal(losses.decision.allowEntries, false);
  assert.equal(losses.patch.consecutiveLosses, 0);
  const later = evaluateGuards({ state: { ...s, ...losses.patch }, equity: eq(7), nowMs: T0 + 7 * 3_600_000, cfg, stopFile: false, panicFile: false });
  assert.equal(later.decision.allowEntries, true);

  const opens = Array.from({ length: 6 }, (_, i) => new Date(T0 - i * 60_000).toISOString());
  assert.equal(evaluateGuards({ state: { ...s, recentOpens: opens }, equity: eq(7), nowMs: T0, cfg, stopFile: false, panicFile: false }).decision.allowEntries, false);
  const pruned = evaluateGuards({ state: { ...s, recentOpens: opens }, equity: eq(7), nowMs: T0 + 2 * 3_600_000, cfg, stopFile: false, panicFile: false });
  assert.deepEqual(pruned.patch.recentOpens, []);

  const pos = Array.from({ length: 3 }, () => ({ mint: addr() }) as Position);
  assert.equal(evaluateGuards({ state: { ...s, positions: pos }, equity: eq(7), nowMs: T0, cfg, stopFile: false, panicFile: false }).decision.allowEntries, false);
});

test('garde-fous : en live, wallet au-dessus de MAX_WALLET_SOL → pas d’entrée', () => {
  const live = loadConfig({ JUPITER_API_KEY: 'k', MODE: 'live', RPC_URL: 'https://rpc.test', MAX_WALLET_SOL: '8' }, '/tmp');
  const s = initialState('live', 7, T0);
  const r = evaluateGuards({ state: s, equity: eq(9), nowMs: T0, cfg: live, stopFile: false, panicFile: false });
  assert.equal(r.decision.allowEntries, false);
  assert.match(r.decision.reasons.join(' '), /MAX_WALLET_SOL/);
});
