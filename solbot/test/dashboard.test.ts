/** Tests du tableau de bord : prévision, budget outils, rendu sûr (échappement, aucun script). */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideTools, esc, project, renderDashboard, MIN_TRADES_FOR_OBSERVED } from '../src/dashboard.ts';
import type { Radar } from '../src/dashboard.ts';
import { computeStats } from '../src/workers/equity.ts';
import { loadConfig } from '../src/config.ts';
import { initialState } from '../src/guards/killswitch.ts';
import type { ClosedTrade } from '../src/types.ts';

const T0 = Date.parse('2026-11-09T12:00:00.000Z');
const cfg = loadConfig({}, '/tmp');

function trade(i: number, pnlPct: number, symbol = `T${i}`): ClosedTrade {
  const entrySol = 0.28;
  const pnlSol = (entrySol * pnlPct) / 100;
  return {
    id: `p-${i}`,
    mode: 'paper',
    mint: `mint${i}`,
    symbol,
    openedAt: new Date(T0 - (i + 1) * 3_600_000).toISOString(),
    closedAt: new Date(T0 - i * 3_600_000).toISOString(),
    holdMinutes: 40,
    entrySol,
    exitSol: entrySol + pnlSol,
    pnlSol,
    pnlPct,
    feesSol: 0.004,
    entrySlippageBps: 150,
    exitSlippageBps: 150,
    entryReasons: ['pic de volume ×4.0'],
    exitReason: pnlPct > 0 ? 'TAKE_PROFIT' : 'STOP_LOSS',
    exitDetail: 'détail',
  };
}

const base = {
  positionPct: 4,
  stopLossPct: 20,
  takeProfitPct: 35,
  haltDrawdownPct: 50,
  startEquitySol: 7,
  initialEquitySol: 7,
};

test('prévision sans données : hypothèse prudente, espérance négative, seuil > 50 %', () => {
  const p = project({ ...base, trades: [] });
  assert.equal(p.basis, 'hypothèse');
  assert.ok(p.expectancyPct < 0, String(p.expectancyPct));
  assert.ok(p.breakEvenWinRatePct > 45 && p.breakEvenWinRatePct < 60, String(p.breakEvenWinRatePct));
  assert.equal(p.p50.length, 101);
  assert.ok(p.finalP5Pct <= p.finalP50Pct && p.finalP50Pct <= p.finalP95Pct);
  assert.ok(p.p50.every((v) => v >= 7 * 0.5 - 1), 'jamais sous l’arrêt de beaucoup (positions de 4 %)');
  assert.match(p.verdict, /hypothèse prudente/);
  // Déterministe : même entrée, même prévision.
  assert.deepEqual(project({ ...base, trades: [] }).p50, p.p50);
});

test('prévision observée : stratégie gagnante → médiane positive ; perdante → négative', () => {
  const winning = Array.from({ length: 30 }, (_, i) => trade(i, i % 2 === 0 ? 30 : -15));
  const w = project({ ...base, trades: winning });
  assert.equal(w.basis, 'observé');
  assert.equal(w.winRatePct, 50);
  assert.equal(w.breakEvenWinRatePct, 33.3);
  assert.ok(w.expectancyPct > 0);
  assert.ok(w.finalP50Pct > 0);
  assert.match(w.verdict, /rentable sur 30 trades/);

  const losing = Array.from({ length: MIN_TRADES_FOR_OBSERVED }, (_, i) => trade(i, i % 3 === 0 ? 20 : -22));
  const l = project({ ...base, trades: losing });
  assert.ok(l.expectancyPct < 0);
  assert.ok(l.finalP50Pct < 0);
  assert.match(l.verdict, /non rentable/);
});

test('budget outils : rien de payant sans bénéfice ; VPS seulement en live', () => {
  const trades = [trade(0, 10), trade(1, -5)];
  const stats = computeStats(trades, [], 7);
  const d = decideTools({ stats, trades, nowMs: T0, solUsd: 86, budgetPct: 20, mode: 'paper' });
  const byName = Object.fromEntries(d.decisions.map((x) => [x.name, x]));
  assert.equal(byName['Clé API Jupiter (portail)']?.decision, 'oui');
  assert.equal(byName['Petit VPS en Europe']?.decision, 'non');
  assert.equal(byName['Helius Developer']?.decision, 'non');
  assert.match(byName['Helius Developer']!.why, /budget outils/);
  const live = decideTools({ stats, trades, nowMs: T0, solUsd: 86, budgetPct: 20, mode: 'live' });
  assert.equal(live.decisions.find((x) => x.name.includes('VPS'))?.decision, 'oui');

  // Gros bénéfice mais petit volume : l'outil à 49 $ reste « non » (gain d'espérance irréaliste).
  const rich = { ...stats, totalPnlSol: 10 };
  const r = decideTools({ stats: rich, trades, nowMs: T0, solUsd: 86, budgetPct: 20, mode: 'live' });
  assert.match(r.decisions.find((x) => x.name === 'Helius Developer')!.why, /espérance/);
});

test('rendu : chaînes d’inconnus échappées, aucun script, sections présentes', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const state = initialState('paper', 7, T0);
  state.positions.push({
    id: 'p-x',
    mint: 'MintXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    symbol: evil,
    decimals: 6,
    pairAddress: 'pair',
    openedAt: new Date(T0 - 600_000).toISOString(),
    entrySol: 0.28,
    tokenAmountRaw: '1000',
    entryLiquidityUsd: 50_000,
    peakValueSol: 0.3,
    lastValueSol: 0.29,
    lastCheckedAt: new Date(T0).toISOString(),
    entryReasons: [`<script>alert(2)</script>`],
    entryFill: {
      side: 'buy',
      mode: 'paper',
      ok: true,
      at: new Date(T0).toISOString(),
      inputMint: 'a',
      outputMint: 'b',
      inAmount: '1',
      quotedOutAmount: '1',
      actualOutAmount: '1',
      slippageBps: 150,
      feeLamports: 2_189_280,
    },
  });
  const radar: Radar = {
    at: new Date(T0).toISOString(),
    examined: 148,
    rejectedCounts: { NO_SPIKE: 56, TOO_OLD: 51 },
    sourcesFailed: [],
    blockedBy: [],
    solUsd: 86.5,
    candidates: [
      {
        mint: 'MintYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
        symbol: `"><svg onload=alert(3)>`,
        score: 9.9,
        signals: ['pic de volume ×3.2'],
        liquidityUsd: 636_900,
        marketCapUsd: 45_200_000,
        spikeRatio: 3.2,
        ageMinutes: 20_000,
        decision: 'rejet anti-rug',
        why: ['RugCheck danger : Freeze Authority still enabled'],
      },
    ],
  };
  const trades = [trade(0, 12, evil)];
  const html = renderDashboard({
    mode: 'paper',
    generatedAt: new Date(T0).toISOString(),
    nowMs: T0,
    state,
    cfg,
    trades,
    points: [],
    stats: computeStats(trades, [], 7),
    events: [],
    rejects: [{ at: new Date(T0).toISOString(), symbol: evil, rejectCodes: ['RUGCHECK_DANGER'], reasons: ['x'] }],
    radar,
    stopFile: true,
  });
  assert.ok(!html.includes('<img'), 'balise injectée');
  assert.ok(!/<script/i.test(html), 'script injecté');
  assert.ok(!html.includes('<svg onload'));
  assert.ok(html.includes(esc(evil)));
  for (const title of ['Positions ouvertes', 'Actions prises et pourquoi', 'Sur le radar', 'Prévision', 'Budget outils', 'MODE PAPIER', 'STOP']) {
    assert.ok(html.includes(title), title);
  }
  assert.ok(html.includes('<meta http-equiv="refresh" content="60">'));
  assert.ok(html.includes(`default-src 'none'`));
});
