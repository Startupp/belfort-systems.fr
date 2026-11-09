/** Tests du logger : fichiers JSONL, raisons des trades, masquage des secrets, terminal assaini. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEntryReasons, createLogger, formatTradeLine, redact, sanitizeForTerminal } from '../src/workers/logger.ts';
import { fixedClock } from '../src/lib/store.ts';
import type { ClosedTrade, Fill, GuardDecision, Position, RugVerdict, SizeDecision, TokenCandidate } from '../src/types.ts';

const T0 = Date.parse('2026-11-09T23:59:30.000Z');

const candidate: TokenCandidate = {
  mint: 'MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  symbol: 'TEST',
  name: 'Test',
  pairAddress: 'Pair',
  dexId: 'raydium',
  quoteSymbol: 'SOL',
  priceUsd: 0.001,
  liquidityUsd: 52_000,
  marketCapUsd: 1_200_000,
  pairCreatedAtMs: T0 - 3 * 3_600_000,
  ageMinutes: 180,
  vol5mUsd: 18_200,
  vol1hUsd: 65_000,
  buys5m: 64,
  sells5m: 40,
  priceChange5mPct: 6,
  priceChange1hPct: 14,
  spikeRatio: 4.2,
  buySellRatio: 1.6,
  organicScore: 72,
  sources: ['jup:toptrending:5m'],
  score: 9.1,
  signals: ['pic de volume ×4.2', 'achats/ventes 5 min : 64/40 (×1.6)'],
  observedAt: new Date(T0).toISOString(),
};

const verdict: RugVerdict = {
  mint: candidate.mint,
  pass: true,
  rejectCodes: [],
  reasons: [],
  warnings: ['RugCheck : Mutable metadata'],
  rugcheckScore: 12,
  roundTripCostPct: 1.4,
  topHoldersPct: 18,
  checkedAt: new Date(T0).toISOString(),
  details: {},
};

const size: SizeDecision = { ok: true, sizeSol: 0.285, lamports: 285_000_000, reason: '4 % de l’equity 7.120 SOL = 0.285 SOL', capsApplied: [] };

const fill = (over: Partial<Fill> = {}): Fill => ({
  side: 'sell',
  mode: 'paper',
  ok: true,
  at: new Date(T0).toISOString(),
  inputMint: candidate.mint,
  outputMint: 'So11111111111111111111111111111111111111112',
  inAmount: '1000',
  quotedOutAmount: '1000',
  actualOutAmount: '985',
  slippageBps: 150,
  feeLamports: 150_000,
  ...over,
});

const trade = (pnlSol: number): ClosedTrade => ({
  id: 'p-1',
  mode: 'paper',
  mint: candidate.mint,
  symbol: 'TEST',
  openedAt: new Date(T0 - 41 * 60_000).toISOString(),
  closedAt: new Date(T0).toISOString(),
  holdMinutes: 41,
  entrySol: 0.285,
  exitSol: 0.285 + pnlSol,
  pnlSol,
  pnlPct: (pnlSol / 0.285) * 100,
  feesSol: 0.0004,
  entrySlippageBps: 150,
  exitSlippageBps: 150,
  entryReasons: buildEntryReasons(candidate, verdict, size),
  exitReason: pnlSol > 0 ? 'TAKE_PROFIT' : 'STOP_LOSS',
  exitDetail: pnlSol > 0 ? '+35.2 % depuis l’entrée' : '−20.4 % depuis l’entrée (stop à −20 %)',
});

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'solbot-log-'));
  const clock = fixedClock(T0);
  const lines: string[] = [];
  const logger = createLogger({ dataDir, clock, mode: 'paper', print: (l) => lines.push(l) });
  return { dataDir, clock, lines, logger };
}

const readLines = (path: string): unknown[] => readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('journal quotidien : un fichier par date UTC, bascule à minuit', () => {
  const { dataDir, clock, logger, lines } = setup();
  logger.event('info', 'avant minuit');
  clock.advance(60_000);
  logger.event('info', 'après minuit');
  assert.equal(readLines(join(dataDir, 'journal', '2026-11-09.jsonl')).length, 1);
  assert.equal(readLines(join(dataDir, 'journal', '2026-11-10.jsonl')).length, 1);
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /^\d\d:\d\d:\d\d \[PAPIER\] INFO\s+avant minuit$/);
});

test('raisons d’entrée : signaux, puis anti-rug et avertissements, puis taille', () => {
  const r = buildEntryReasons(candidate, verdict, size);
  assert.deepEqual(r.slice(0, 2), candidate.signals);
  const rug = r.findIndex((x) => x.startsWith('anti-rug'));
  const warn = r.findIndex((x) => x.startsWith('attention'));
  const sz = r.findIndex((x) => x.startsWith('taille'));
  assert.ok(rug > 1 && warn > rug && sz > warn, r.join(' | '));
  assert.match(r[rug]!, /1\.40 %|1\.4 %/);
});

test('trades.jsonl : chaque trade fermé avec sa chaîne de raisons ; ligne console lisible', () => {
  const { dataDir, logger, lines } = setup();
  logger.close(trade(0.035), fill());
  logger.close(trade(-0.058), fill());
  const t = readLines(join(dataDir, 'trades.jsonl')) as ClosedTrade[];
  assert.equal(t.length, 2);
  assert.equal(t[0]!.exitReason, 'TAKE_PROFIT');
  assert.ok(t[0]!.entryReasons.length >= 4);
  assert.match(formatTradeLine(trade(0.035)), /TEST/);
  assert.match(formatTradeLine(trade(0.035)), /\+/);
  assert.match(formatTradeLine(trade(-0.058)), /STOP_LOSS/);
  assert.ok(lines.some((l) => l.includes('TAKE_PROFIT')));
});

test('rejects.jsonl : instantané du candidat + motifs, pour l’analyse a posteriori', () => {
  const { dataDir, logger } = setup();
  logger.reject(candidate, { ...verdict, pass: false, rejectCodes: ['ROUNDTRIP_COST'], reasons: ['aller-retour 0.3 SOL : coût 7.80 % (max 5 %)'], roundTripCostPct: 7.8 });
  const [r] = readLines(join(dataDir, 'rejects.jsonl')) as Array<Record<string, unknown>>;
  assert.deepEqual(r!.rejectCodes, ['ROUNDTRIP_COST']);
  assert.equal((r!.candidate as Record<string, unknown>).spikeRatio, 4.2);
  assert.equal(r!.roundTripCostPct, 7.8);
});

test('redact : masque les secrets à toute profondeur, gère bigint, chaînes longues et cycles', () => {
  const cyclic: Record<string, unknown> = { a: 1 };
  cyclic.self = cyclic;
  const out = redact({
    signedTransaction: 'AQAB…',
    nested: { privateKey: [1, 2, 3], apiKey: 'k', 'x-api-key': 'k2', Authorization: 'Bearer abc', ok: 'visible' },
    seedPhrase: 'mots',
    amount: 12n,
    long: 'x'.repeat(5000),
    cyclic,
  }) as Record<string, unknown>;
  const json = JSON.stringify(out);
  for (const leak of ['AQAB', '[1,2,3]', '"k"', '"k2"', 'Bearer abc', 'mots']) assert.ok(!json.includes(leak), leak);
  assert.ok(json.includes('visible'));
  assert.equal(out.amount, '12');
  assert.ok((out.long as string).length < 2100);
});

test('sanitizeForTerminal : retire séquences ANSI/OSC, caractères de contrôle et bidi', () => {
  const s = sanitizeForTerminal('\u001b]52;c;ZXZpbA==\u0007BONK\u202e\u200bkcuf\u001b[2J');
  assert.ok(!/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/.test(s), JSON.stringify(s));
  assert.ok(s.includes('BONK'));
  assert.ok(sanitizeForTerminal('a'.repeat(1000)).length <= 301);
});

test('un symbole piégé n’arrive jamais brut dans le terminal', () => {
  const { logger, lines } = setup();
  logger.reject({ ...candidate, symbol: 'EVIL\u001b[2J\u001b]0;pwned\u0007' }, { ...verdict, pass: false, rejectCodes: ['RUGCHECK_DANGER'], reasons: ['x'] });
  assert.ok(lines.every((l) => !l.includes('\u001b') && !l.includes('\u0007')));
});

test('garde-fous : journalisés seulement quand les motifs changent', () => {
  const { logger, lines } = setup();
  const d = (reasons: string[]): GuardDecision => ({ allowEntries: reasons.length === 0, panic: false, halt: false, reasons });
  logger.guard(d(['fichier STOP présent']));
  logger.guard(d(['fichier STOP présent']));
  logger.guard(d(['fichier STOP présent', 'perte du jour 10.2 %']));
  assert.equal(lines.length, 2);
});

test('open / openFailed / closeFailed / error : écrits sans lever d’exception', () => {
  const { dataDir, logger } = setup();
  const position: Position = {
    id: 'p-1',
    mint: candidate.mint,
    symbol: 'TEST',
    decimals: 6,
    pairAddress: 'Pair',
    openedAt: new Date(T0).toISOString(),
    entrySol: 0.2872,
    tokenAmountRaw: '285000000000',
    entryLiquidityUsd: 52_000,
    peakValueSol: 0.2872,
    lastValueSol: 0.2872,
    lastCheckedAt: new Date(T0).toISOString(),
    entryReasons: buildEntryReasons(candidate, verdict, size),
    entryFill: fill({ side: 'buy' }),
  };
  logger.open(position, size);
  logger.openFailed(candidate, fill({ ok: false, error: 'pare-feu : programme hors liste blanche' }));
  logger.closeFailed(position, fill({ ok: false, error: 'NO_ROUTE' }), 'STOP_LOSS');
  logger.error('test', new Error('boom'));
  const ev = readLines(join(dataDir, 'journal', '2026-11-09.jsonl')) as Array<{ type: string }>;
  assert.deepEqual(ev.map((e) => e.type), ['open', 'open_failed', 'close_failed', 'error']);
});

test('écriture impossible (dossier = fichier) : le bot continue, aucune exception', () => {
  const dir = mkdtempSync(join(tmpdir(), 'solbot-log-bad-'));
  const file = join(dir, 'pas-un-dossier');
  writeFileSync(file, 'x');
  const errs: string[] = [];
  const orig = console.error;
  console.error = (m: string) => errs.push(m);
  try {
    const logger = createLogger({ dataDir: file, clock: fixedClock(T0), mode: 'paper', print: () => {} });
    assert.doesNotThrow(() => logger.event('info', 'test'));
    assert.doesNotThrow(() => logger.close(trade(0.01), fill()));
  } finally {
    console.error = orig;
  }
  assert.ok(errs.length >= 1);
  assert.ok(!existsSync(join(file, 'journal')));
});
