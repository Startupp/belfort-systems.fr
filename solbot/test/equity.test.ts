/** Courbe d'equity, statistiques de performance, page HTML et mise à l'abri des gains. */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { appendJsonl, fixedClock } from '../src/lib/store.ts';
import type { BotState, ClosedTrade, ExitReason } from '../src/types.ts';
import { computeStats, createEquityTracker, renderEquityHtml, sweepAmountSol } from '../src/workers/equity.ts';
import type { EquityPoint, EquityTracker } from '../src/workers/equity.ts';

const CREATED_AT = '2026-11-08T10:00:00.000Z';
const HEADER = 'at,equity_sol,free_sol,positions_sol,drawdown_pct,trade_id,pnl_sol';

function makeState(over: Partial<BotState> = {}): BotState {
  return {
    version: 1,
    mode: 'paper',
    createdAt: CREATED_AT,
    initialEquitySol: 7,
    peakEquitySol: 7,
    paperSol: 7,
    positions: [],
    cooldowns: {},
    day: { date: '2026-11-08', startEquitySol: 7, realizedPnlSol: 0, trades: 0 },
    consecutiveLosses: 0,
    recentOpens: [],
    totalSweptSol: 0,
    closedTrades: 0,
    ...over,
  };
}

function makeTrade(over: Partial<ClosedTrade> = {}): ClosedTrade {
  return {
    id: 't-1',
    mode: 'paper',
    mint: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    symbol: 'TEST',
    openedAt: '2026-11-08T10:30:00.000Z',
    closedAt: '2026-11-08T11:00:00.000Z',
    holdMinutes: 30,
    entrySol: 0.5,
    exitSol: 0.6,
    pnlSol: 0.1,
    pnlPct: 20,
    feesSol: 0.003,
    entrySlippageBps: 50,
    exitSlippageBps: 80,
    entryReasons: ['volume 5 min ×4'],
    exitReason: 'TAKE_PROFIT',
    exitDetail: "+20 % depuis l'entrée",
    ...over,
  };
}

function point(at: string, equitySol: number, extra: Partial<EquityPoint> = {}): EquityPoint {
  return { at, equitySol, freeSol: equitySol, positionsValueSol: 0, drawdownPct: 0, ...extra };
}

function approx(actual: number, expected: number, eps = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≠ ${expected} (±${eps})`);
}

/** Aucun NaN ni Infinity, à n'importe quelle profondeur. */
function assertAllFinite(value: unknown, where = 'stats'): void {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${where} = ${value}`);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertAllFinite(v, `${where}.${k}`);
  }
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'solbot-eq-'));
}

/** Suivi branché sur un état en mémoire (getState / patchState). */
function setup(dataDir: string, startIso = '2026-11-08T11:00:00.000Z', over: Partial<BotState> = {}) {
  const clock = fixedClock(Date.parse(startIso));
  const box = { state: makeState(over), patches: [] as Array<Partial<BotState>> };
  const tracker: EquityTracker = createEquityTracker({
    dataDir,
    clock,
    mode: 'paper',
    getState: () => box.state,
    patchState: (p) => {
      box.patches.push(p);
      box.state = { ...box.state, ...p };
    },
  });
  return { clock, box, tracker };
}

const T_A = makeTrade({ id: 'tA', symbol: 'WINA', entrySol: 0.5, exitSol: 0.6, pnlSol: 0.1, pnlPct: 20, feesSol: 0.003, entrySlippageBps: 50, exitSlippageBps: 80, holdMinutes: 30, exitReason: 'TAKE_PROFIT' });
const T_B = makeTrade({ id: 'tB', symbol: 'LOSEB', entrySol: 0.5, exitSol: 0.4, pnlSol: -0.1, pnlPct: -20, feesSol: 0.003, entrySlippageBps: 100, exitSlippageBps: 150, holdMinutes: 60, exitReason: 'STOP_LOSS' });
const T_C = makeTrade({ id: 'tC', symbol: 'BESTC', entrySol: 0.25, exitSol: 0.325, pnlSol: 0.075, pnlPct: 30, feesSol: 0.002, entrySlippageBps: 30, exitSlippageBps: 40, holdMinutes: 20, exitReason: 'TRAILING_STOP' });
const T_D = makeTrade({ id: 'tD', symbol: 'FLATD', entrySol: 0.25, exitSol: 0.25, pnlSol: 0, pnlPct: 0, feesSol: 0.002, entrySlippageBps: 20, exitSlippageBps: 30, holdMinutes: 90, exitReason: 'TIME_STOP' });
const T_E = makeTrade({ id: 'tE', symbol: 'LOSEE', entrySol: 0.5, exitSol: 0.45, pnlSol: -0.05, pnlPct: -10, feesSol: 0.003, entrySlippageBps: 50, exitSlippageBps: 75, holdMinutes: 40, exitReason: 'STOP_LOSS' });
const FIXTURE = [T_A, T_B, T_C, T_D, T_E];

// ---------------------------------------------------------------------------
// computeStats
// ---------------------------------------------------------------------------

test('computeStats : réussite, profit factor, espérance, frais, slippage, raisons de sortie', () => {
  const points = [
    point(CREATED_AT, 7),
    point('2026-11-08T11:00:00.000Z', 7.1),
    point('2026-11-08T12:00:00.000Z', 7.0),
    point('2026-11-08T13:00:00.000Z', 7.075),
    point('2026-11-08T14:00:00.000Z', 7.075),
    point('2026-11-08T15:00:00.000Z', 7.025),
  ];
  const s = computeStats(FIXTURE, points, 7);

  assert.equal(s.trades, 5);
  assert.equal(s.wins, 2);
  assert.equal(s.losses, 3, 'un trade à 0 compte comme perdant');
  assert.equal(s.winRatePct, 40);
  approx(s.totalPnlSol, 0.025);
  approx(s.avgWinSol, 0.0875);
  approx(s.avgLossSol, -0.05);
  assert.equal(s.profitFactor, 1.1667, '0,175 / 0,15');
  approx(s.expectancySol, 0.005);
  approx(s.expectancyPct, 4);
  approx(s.totalFeesSol, 0.013);
  approx(s.feesPctOfVolume, 0.65, 1e-9); // 0,013 / 2 SOL engagés
  approx(s.avgEntrySlippageBps, 50);
  approx(s.avgExitSlippageBps, 75);
  approx(s.avgHoldMinutes, 48);
  assert.deepEqual(s.bestTrade, { symbol: 'BESTC', pnlPct: 30 });
  assert.deepEqual(s.worstTrade, { symbol: 'LOSEB', pnlPct: -20 });
  assert.deepEqual(s.byExitReason, {
    TAKE_PROFIT: { count: 1, pnlSol: 0.1 },
    STOP_LOSS: { count: 2, pnlSol: -0.15 },
    TRAILING_STOP: { count: 1, pnlSol: 0.075 },
    TIME_STOP: { count: 1, pnlSol: 0 },
  });
  assert.equal(s.maxDrawdownPct, 1.4085, '(7,1 − 7,0) / 7,1');
  assert.equal(s.returnPct, 0.3571, '(7,025 − 7) / 7');
  assertAllFinite(s);
});

test('computeStats : sans trade ni point → zéros, profit factor null, aucun NaN', () => {
  for (const initial of [7, 0, Number.NaN]) {
    const s = computeStats([], [], initial);
    assert.equal(s.trades, 0);
    assert.equal(s.wins, 0);
    assert.equal(s.losses, 0);
    assert.equal(s.winRatePct, 0);
    assert.equal(s.totalPnlSol, 0);
    assert.equal(s.expectancySol, 0);
    assert.equal(s.feesPctOfVolume, 0);
    assert.equal(s.maxDrawdownPct, 0);
    assert.equal(s.returnPct, 0);
    assert.equal(s.profitFactor, null);
    assert.equal(s.bestTrade, undefined);
    assert.equal(s.worstTrade, undefined);
    assert.deepEqual(s.byExitReason, {});
    assertAllFinite(s);
  }
  // Des points mais capital initial inconnu : rendement 0, pas de division par zéro.
  assertAllFinite(computeStats([], [point(CREATED_AT, 7)], 0));
  // Que des gains : pas de perte, donc profit factor null (et pas Infinity).
  const onlyWins = computeStats([T_A, T_C], [], 7);
  assert.equal(onlyWins.profitFactor, null);
  assert.equal(onlyWins.avgLossSol, 0);
  // Champs numériques corrompus (ligne JSONL abîmée) : ignorés, jamais de NaN.
  const garbage = makeTrade({ pnlSol: Number.NaN, pnlPct: Number.NaN, entrySol: Number.NaN, feesSol: Number.POSITIVE_INFINITY, holdMinutes: Number.NaN });
  assertAllFinite(computeStats([garbage], [point(CREATED_AT, Number.NaN)], 7));
});

test('computeStats : drawdown max depuis le plus haut courant, point initial compris', () => {
  const points = [7, 8, 6, 7.5, 9, 8.1].map((e, i) => point(`2026-11-08T1${i}:00:00.000Z`, e));
  const s = computeStats([], points, 7);
  assert.equal(s.maxDrawdownPct, 25, '(8 − 6) / 8, pas (9 − 8,1) / 9');
  assert.equal(s.returnPct, 15.7143);
  // Le point initial compte : une première clôture en perte est déjà un drawdown.
  assert.equal(computeStats([], [point(CREATED_AT, 7), point('2026-11-08T11:00:00.000Z', 6.3)], 7).maxDrawdownPct, 10);
  // Drawdown enregistré au moment de la clôture (plus haut latent entre deux clôtures) : jamais sous-estimé.
  const latent = [point(CREATED_AT, 7), point('2026-11-08T11:00:00.000Z', 7, { drawdownPct: 12.5 })];
  assert.equal(computeStats([], latent, 7).maxDrawdownPct, 12.5);
});

test('computeStats : une raison « __proto__ » reste une clé ordinaire', () => {
  const s = computeStats([makeTrade({ exitReason: '__proto__' as ExitReason })], [], 7);
  assert.ok(Object.hasOwn(s.byExitReason, '__proto__'));
  assert.equal(Object.getPrototypeOf(s.byExitReason), Object.prototype);
  assert.equal((Object.prototype as Record<string, unknown>)['count'], undefined);
  assert.match(JSON.stringify(s.byExitReason), /"__proto__":\{"count":1/);
});

// ---------------------------------------------------------------------------
// sweepAmountSol
// ---------------------------------------------------------------------------

test('sweepAmountSol : rien sous le seuil, plafonné par SOL libre − réserve et par le gain, jamais négatif', () => {
  // Seuil : 7 × 1,2 = 8,4 SOL.
  assert.equal(sweepAmountSol(8.3, 8.3, 7, 20, 0.05), 0, 'sous le seuil');
  assert.equal(sweepAmountSol(8.4, 8.4, 7, 20, 0.05), 0, 'pile au seuil : il faut le dépasser');
  assert.equal(sweepAmountSol(8.5, 8.5, 7, 20, 0.05), 1.5, "borné par le gain : l'equity revient au capital initial");
  assert.equal(sweepAmountSol(0.5, 9, 7, 20, 0.05), 0.45, 'borné par le SOL libre moins la réserve (le reste est en positions)');
  assert.equal(sweepAmountSol(0.01, 9, 7, 20, 0.05), 0, 'SOL libre sous la réserve : jamais négatif');
  assert.equal(sweepAmountSol(10, 8.4123456789, 7, 20, 0.05), 1.412345, 'tronqué au micro-SOL');
  assert.equal(sweepAmountSol(1, 9, 7, 20, -5), 1, 'réserve négative ignorée : jamais plus que le SOL libre');
  // Échoue fermé.
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(sweepAmountSol(bad, 9, 7, 20, 0.05), 0);
    assert.equal(sweepAmountSol(9, bad, 7, 20, 0.05), 0);
    assert.equal(sweepAmountSol(9, 9, bad, 20, 0.05), 0);
    assert.equal(sweepAmountSol(9, 9, 7, bad, 0.05), 0);
    assert.equal(sweepAmountSol(9, 9, 7, 20, bad), 0);
  }
  assert.equal(sweepAmountSol(9, 9, 0, 20, 0.05), 0, 'capital initial inconnu');
});

// ---------------------------------------------------------------------------
// snapshot
// ---------------------------------------------------------------------------

test('snapshot : relève le plus haut seulement quand il monte, drawdown et rendement', () => {
  const { clock, box, tracker } = setup(path.join(os.tmpdir(), 'solbot-eq-unused'), '2026-11-08T12:00:00.000Z');

  const s1 = tracker.snapshot(7.5, 0.5);
  assert.equal(s1.at, '2026-11-08T12:00:00.000Z');
  assert.equal(s1.equitySol, 8);
  assert.equal(s1.freeSol, 7.5);
  assert.equal(s1.positionsValueSol, 0.5);
  assert.equal(s1.peakEquitySol, 8);
  assert.equal(s1.initialEquitySol, 7);
  assert.equal(s1.drawdownPct, 0);
  approx(s1.returnPct, 100 / 7);
  assert.deepEqual(box.patches, [{ peakEquitySol: 8 }]);
  assert.equal(box.state.peakEquitySol, 8);

  clock.advance(60_000);
  const s2 = tracker.snapshot(6, 0);
  assert.equal(s2.at, '2026-11-08T12:01:00.000Z');
  assert.equal(s2.peakEquitySol, 8);
  assert.equal(s2.drawdownPct, 25);
  approx(s2.returnPct, -100 / 7);
  assert.equal(box.patches.length, 1, 'pas de patch quand le plus haut ne monte pas');

  tracker.snapshot(5.5, 2.5); // égal au plus haut
  assert.equal(box.patches.length, 1);

  assert.throws(() => tracker.snapshot(Number.NaN, 0), /non finies/);
  assert.throws(() => tracker.snapshot(1, Number.POSITIVE_INFINITY), /non finies/);
  assert.equal(box.patches.length, 1);
});

// ---------------------------------------------------------------------------
// onClose / load
// ---------------------------------------------------------------------------

test('onClose : en-tête + point initial + une ligne par clôture, equity.html et stats.json écrits', () => {
  const dir = tempDir();
  try {
    const { clock, tracker } = setup(dir);
    const tradesFile = path.join(dir, 'trades.jsonl');
    const csvFile = path.join(dir, 'equity.csv');

    appendJsonl(tradesFile, T_A); // écrit par le logger
    const stats1 = tracker.onClose(T_A, tracker.snapshot(7.1, 0));
    assert.equal(stats1.trades, 1);
    assert.equal(stats1.wins, 1);
    assert.equal(stats1.profitFactor, null);
    assert.deepEqual(fs.readFileSync(csvFile, 'utf8').split('\n'), [
      HEADER,
      '2026-11-08T10:00:00.000Z,7.000000,7.000000,0.000000,0.0000,,',
      '2026-11-08T11:00:00.000Z,7.100000,7.100000,0.000000,0.0000,tA,0.100000',
      '',
    ]);

    const page = fs.readFileSync(path.join(dir, 'equity.html'), 'utf8');
    assert.ok(page.includes("<title>Courbe d'equity — solbot</title>"));
    assert.ok(page.includes('MODE PAPIER (simulation)'));
    assert.ok(page.includes('<svg class="chart"'));
    assert.ok(page.includes('WINA'));

    const statsFile = JSON.parse(fs.readFileSync(path.join(dir, 'stats.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(statsFile['generatedAt'], clock.iso());
    assert.equal(statsFile['mode'], 'paper');
    assert.equal(statsFile['initialEquitySol'], 7);
    assert.equal(statsFile['trades'], 1);
    assert.equal(statsFile['profitFactor'], null);
    assert.deepEqual(statsFile['byExitReason'], { TAKE_PROFIT: { count: 1, pnlSol: 0.1 } });

    // Deuxième clôture signalée AVANT que le logger n'écrive le trade : elle compte quand même.
    clock.advance(3_600_000);
    const tB = makeTrade({ id: 'tB', symbol: 'LOSEB', pnlSol: -0.2, pnlPct: -40, exitReason: 'STOP_LOSS' });
    const snap2 = tracker.snapshot(6.9, 0);
    const stats2 = tracker.onClose(tB, snap2);
    assert.equal(stats2.trades, 2);
    assert.equal(stats2.losses, 1);
    assert.equal(stats2.profitFactor, 0.5);
    assert.equal(stats2.maxDrawdownPct, 2.8169, '(7,1 − 6,9) / 7,1');
    const lines = fs.readFileSync(csvFile, 'utf8').split('\n');
    assert.equal(lines.length, 5, 'en-tête + point initial + 2 clôtures + fin de ligne');
    assert.equal(lines[3], '2026-11-08T12:00:00.000Z,6.900000,6.900000,0.000000,2.8169,tB,-0.200000');

    // Même clôture signalée deux fois (nouvelle tentative) : pas de doublon sur la courbe.
    tracker.onClose(tB, snap2);
    assert.equal(fs.readFileSync(csvFile, 'utf8').split('\n').length, 5);
    appendJsonl(tradesFile, tB);
    appendJsonl(tradesFile, tB); // le logger réessaie
    assert.equal(tracker.load().trades.length, 2, 'trade écrit deux fois : compté une fois');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('load() : aller-retour de equity.csv et trades.jsonl', () => {
  const dir = tempDir();
  try {
    const { clock, tracker } = setup(dir);
    const tradesFile = path.join(dir, 'trades.jsonl');
    assert.deepEqual(tracker.load(), { points: [], trades: [] }, 'dossier vide');

    appendJsonl(tradesFile, T_A);
    tracker.onClose(T_A, tracker.snapshot(7.1, 0));
    clock.advance(3_600_000);
    const odd = makeTrade({ id: 'odd,"id"', symbol: 'ODD', pnlSol: -0.05, pnlPct: -10, exitReason: 'TIME_STOP' });
    appendJsonl(tradesFile, odd);
    tracker.onClose(odd, tracker.snapshot(6.5, 0.55));

    const { points, trades } = tracker.load();
    assert.deepEqual(points, [
      { at: CREATED_AT, equitySol: 7, freeSol: 7, positionsValueSol: 0, drawdownPct: 0 },
      { at: '2026-11-08T11:00:00.000Z', equitySol: 7.1, freeSol: 7.1, positionsValueSol: 0, drawdownPct: 0, tradeId: 'tA', pnlSol: 0.1 },
      {
        at: '2026-11-08T12:00:00.000Z',
        equitySol: 7.05,
        freeSol: 6.5,
        positionsValueSol: 0.55,
        drawdownPct: 0.7042,
        tradeId: 'odd,"id"',
        pnlSol: -0.05,
      },
    ]);
    assert.deepEqual(trades, [T_A, odd]);
    // stats.json = computeStats(load()) : mêmes données, mêmes arrondis.
    const statsFile = JSON.parse(fs.readFileSync(path.join(dir, 'stats.json'), 'utf8')) as Record<string, unknown>;
    const { generatedAt: _g, mode: _m, initialEquitySol: _i, ...fileStats } = statsFile;
    assert.deepEqual(fileStats, JSON.parse(JSON.stringify(computeStats(trades, points, 7))));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("load() : ignore la courbe et les trades d'un état précédent ou de l'autre mode", () => {
  const dir = tempDir();
  try {
    // Ancienne session papier à 3 SOL, fichier coupé en pleine écriture (pas de fin de ligne).
    const csvFile = path.join(dir, 'equity.csv');
    fs.writeFileSync(
      csvFile,
      `${HEADER}\n2026-11-01T09:00:00.000Z,3.000000,3.000000,0.000000,0.0000,,\n2026-11-01T10:00:00.000Z,2.500000,2.500000,0.000000,16.6667,old,-0.500000\n2026-11-01T11:00:00.000Z,2.4`,
    );
    const tradesFile = path.join(dir, 'trades.jsonl');
    appendJsonl(tradesFile, makeTrade({ id: 'old', closedAt: '2026-11-01T10:00:00.000Z', pnlSol: -0.5 }));
    appendJsonl(tradesFile, makeTrade({ id: 'live-1', mode: 'live', closedAt: '2026-11-08T10:30:00.000Z', pnlSol: -0.3 }));
    appendJsonl(tradesFile, T_A);

    const { tracker } = setup(dir);
    const stats = tracker.onClose(T_A, tracker.snapshot(7.2, 0));
    assert.equal(stats.trades, 1);
    assert.equal(stats.maxDrawdownPct, 0, "l'ancienne session (3 → 2,5 SOL) ne fausse pas le drawdown");

    const { points, trades } = tracker.load();
    assert.deepEqual(
      points.map((p) => [p.at, p.equitySol]),
      [
        [CREATED_AT, 7],
        ['2026-11-08T11:00:00.000Z', 7.2],
      ],
      "point initial de l'état courant ajouté, ligne tronquée ignorée",
    );
    assert.deepEqual(trades.map((t) => t.id), ['tA']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// renderEquityHtml
// ---------------------------------------------------------------------------

test("renderEquityHtml : échappe les chaînes venues d'inconnus, aucun script ni ressource externe", () => {
  const evil = makeTrade({
    id: 'x1',
    symbol: '<img src=x onerror=alert(1)>',
    mint: '"><svg onload=alert(3)>',
    exitReason: '<b>RAISON</b>' as ExitReason,
    exitDetail: `"><script>alert(2)</script> l'entrée & co`,
  });
  const quote = makeTrade({ id: 'x2', symbol: "O'Rug", closedAt: '2026-11-08T12:00:00.000Z' });
  const points = [
    point(CREATED_AT, 7),
    point('2026-11-08T11:00:00.000Z', 7.1, { tradeId: 'x1', pnlSol: 0.1 }),
    point('2026-11-08T12:00:00.000Z', 7.2, { tradeId: 'x2', pnlSol: 0.1 }),
  ];
  const trades = [evil, quote];
  const page = renderEquityHtml({
    points,
    stats: computeStats(trades, points, 7),
    trades,
    mode: 'live',
    initialEquitySol: 7,
    generatedAt: '2026-11-08T12:00:00.000Z',
  });

  assert.ok(!page.includes('<img'), 'balise <img> injectée');
  assert.ok(!/<script/i.test(page), 'balise <script> injectée');
  assert.ok(!page.includes('<svg onload'));
  assert.ok(!page.includes('<b>RAISON'));
  // Les textes peuvent être tronqués pour l'affichage : on vérifie qu'ils sont échappés, pas leur longueur.
  assert.ok(page.includes('&lt;img src=x onerror='));
  assert.ok(page.includes('&lt;b&gt;RAISON&lt;/b&gt;'));
  assert.ok(page.includes('O&#39;Rug'));

  assert.ok(
    page.includes(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`),
  );
  assert.ok(page.includes('<meta name="viewport" content="width=device-width, initial-scale=1">'));
  assert.ok(page.includes('prefers-color-scheme:dark'));
  assert.ok(!/https?:\/\//.test(page), 'aucune URL externe');
  for (const s of ['<link', '@import', 'url(', '<iframe', '<object', '<embed', ' on']) {
    if (s === ' on') assert.ok(!/<[^>]+\son\w+=/i.test(page), "attribut d'évènement injecté");
    else assert.ok(!page.includes(s), s);
  }
  assert.ok(!page.includes('NaN'));
  assert.ok(!page.includes('undefined'));
  assert.ok(!page.includes('MODE PAPIER'), 'pas de bandeau papier en live');
});

test('renderEquityHtml : bandeau MODE PAPIER, pointillés au départ, dernier point, page vide sans NaN', () => {
  const generatedAt = '2026-11-08T12:00:00.000Z';
  const empty = computeStats([], [], 7);
  const blank = renderEquityHtml({ points: [], stats: empty, trades: [], mode: 'paper', initialEquitySol: 7, generatedAt });
  assert.ok(blank.includes('MODE PAPIER (simulation)'));
  assert.ok(blank.includes('Aucune clôture'));
  assert.ok(!blank.includes('NaN') && !blank.includes('undefined'));

  const points = [point(CREATED_AT, 7), point('2026-11-08T11:00:00.000Z', 7.3, { tradeId: 'tA', pnlSol: 0.1 })];
  const page = renderEquityHtml({ points, stats: computeStats([T_A], points, 7), trades: [T_A], mode: 'paper', initialEquitySol: 7, generatedAt });
  assert.ok(page.includes('MODE PAPIER (simulation)'));
  assert.ok(page.includes('class="base"') && page.includes('stroke-dasharray'), 'pointillés au capital initial');
  assert.ok(page.includes('class="last"'), 'dernier point mis en valeur');
  assert.ok(page.includes('PnL par raison de sortie'));
  assert.ok(page.includes('Prise de bénéfice'));
  assert.ok(!page.includes('NaN') && !page.includes('undefined'));
});
