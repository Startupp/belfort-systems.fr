/** Tests du desk papier : heures de Paris, courtier sans levier, sorties, garde-fous, carnet. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendJsonl, writeJsonAtomic } from '../src/lib/store.ts';
import { createEngine, isoWeek, newDeskState, tradingDaysLeft } from '../src/desk/engine.ts';
import type { DeskEvent } from '../src/desk/engine.ts';
import { paris, vwapSeries, efficiency, inPlayCandidates } from '../src/desk/market.ts';
import { parisToUtc } from '../src/desk/run.ts';
import { carnetCsv, resumeJour, writeCarnet } from '../src/desk/report.ts';
import type { DayContext } from '../src/desk/strategies.ts';
import { DEFAULT_DESK_CONFIG } from '../src/desk/types.ts';
import type { Bar, ClosedTrade } from '../src/desk/types.ts';

const DAY = '2026-11-10'; // mardi, heure d'hiver : Paris = UTC+1, New York = UTC−5
const OPEN = parisToUtc(DAY, 15 * 60 + 30); // 9 h 30 à New York

test('heures : Paris ↔ UTC, semaine ISO, jours restants', () => {
  assert.equal(OPEN, Date.UTC(2026, 10, 10, 14, 30));
  assert.deepEqual(paris(OPEN), { date: DAY, minutes: 15 * 60 + 30 });
  assert.equal(parisToUtc('2026-07-01', 15 * 60), Date.UTC(2026, 6, 1, 13, 0)); // heure d'été
  assert.equal(isoWeek('2026-11-09'), '2026-S46');
  assert.equal(isoWeek('2026-01-01'), '2026-S01');
  assert.equal(tradingDaysLeft('2026-11-09'), 4);
  assert.equal(tradingDaysLeft('2026-11-13'), 0);
});

test('indicateurs : VWAP pondérée par le volume, efficacité de tendance', () => {
  const bars: Bar[] = [
    { t: 0, o: 10, h: 10, l: 10, c: 10, v: 100 },
    { t: 60_000, o: 20, h: 20, l: 20, c: 20, v: 300 },
  ];
  assert.equal(vwapSeries(bars)[1]?.vwap, 17.5);
  const trend = Array.from({ length: 40 }, (_, i) => ({ t: i * 60_000, o: 100 + i, h: 100 + i, l: 100 + i, c: 100 + i, v: 1 }));
  assert.equal(efficiency(trend), 1);
  const chop = Array.from({ length: 40 }, (_, i) => ({ t: i * 60_000, o: 100, h: 101, l: 99, c: i % 2 ? 101 : 99, v: 1 }));
  assert.ok(efficiency(chop) < 0.1);
});

test('actions « en jeu » : filtres de l’étude (prix ≥ 5 $, volume moyen ≥ 1 M), tri par volume relatif', () => {
  const q = [
    { symbol: 'AAA', price: 50, volume: 9e6, avgVolume: 3e6 },
    { symbol: 'BBB', price: 3, volume: 9e7, avgVolume: 1e7 },
    { symbol: 'CCC', price: 80, volume: 5e6, avgVolume: 5e5 },
    { symbol: 'DDD', price: 40, volume: 8e6, avgVolume: 2e6 },
  ];
  assert.deepEqual(inPlayCandidates(q, new Set(['DDD']), 5), ['AAA']);
});

/** Contexte d'une action fictive : range d'ouverture haussier sur gros volume, puis le scénario donné. */
function stockCtx(after: Array<[number, number, number, number]>): DayContext {
  const bars: Bar[] = [];
  const or: Array<[number, number, number, number]> = [
    [100, 100.4, 99.9, 100.2],
    [100.2, 100.5, 100.1, 100.4],
    [100.4, 100.6, 100.3, 100.5],
    [100.5, 100.7, 100.4, 100.6],
    [100.6, 100.8, 100.5, 100.7],
  ];
  [...or, ...after].forEach(([o, h, l, c], i) => bars.push({ t: OPEN + i * 60_000, o, h, l, c, v: i < 5 ? 200_000 : 50_000 }));
  return {
    inst: { symbol: 'TEST', cls: 'stock', label: 'Test' },
    session: bars,
    anchor: 100,
    anchorTime: OPEN,
    noise: new Array(421).fill(0.01),
    orAvgVol: 300_000, // volume des 5 premières minutes du jour = 1 M → volume relatif 3.3×
    atr: 3,
    vw: vwapSeries(bars),
  };
}

function run(ctx: DayContext, minutes: number, cfg = DEFAULT_DESK_CONFIG) {
  const state = newDeskState(cfg);
  const events: DeskEvent[] = [];
  const closed: ClosedTrade[] = [];
  const engine = createEngine({ cfg, state, log: (e) => events.push(e), onClose: (t) => closed.push(t), newId: () => `t${events.length}` });
  const ctxs = new Map([[ctx.inst.symbol, ctx]]);
  engine.startDay(DAY, parisToUtc(DAY, 15 * 60));
  for (let t = parisToUtc(DAY, 15 * 60); t < OPEN + minutes * 60_000; t += 60_000) engine.step(t, ctxs);
  return { state, events, closed, engine, ctxs };
}

test('ORB : achat sur cassure, sans levier, puis stop sous le range d’ouverture', () => {
  // Minute 6 : clôture 101 > plus haut du range (100.8) → achat ; minute 8 : chute sous 99.9 → stop.
  const ctx = stockCtx([
    [100.7, 101.1, 100.7, 101],
    [101, 101.2, 100.9, 101.1],
    [101, 101, 99.5, 99.6],
  ]);
  const { state, closed, events } = run(ctx, 9);
  const open = events.find((e) => e.type === 'open');
  assert.ok(open, events.map((e) => e.msg).join('\n'));
  const tr = closed[0];
  assert.ok(tr);
  assert.equal(tr.strategy, 'orb');
  assert.ok(tr.notionalUsd <= 250 + 1e-9, 'jamais plus de 50 % de l’equity dans une position');
  assert.ok(tr.exitReason.startsWith('stop'));
  assert.ok(tr.pnlUsd < 0);
  assert.ok(tr.reasons.some((r) => r.includes('volume relatif')));
  assert.ok(state.weights.orb < 1, 'le poids de la stratégie perdante baisse');
  assert.equal(state.open.length, 0);
  assert.ok(Math.abs(state.cash - (500 + tr.pnlUsd)) < 1e-3, 'cash = départ + PnL net (PnL arrondi au 1/10 000 de dollar)');
});

test('fin de fenêtre : tout est soldé à 18 h 55, rien ne reste ouvert', () => {
  const flat: Array<[number, number, number, number]> = [[100.7, 101.1, 100.7, 101]];
  for (let i = 0; i < 220; i++) flat.push([101 + i * 0.001, 101.1 + i * 0.001, 100.95 + i * 0.001, 101.05 + i * 0.001]);
  const ctx = stockCtx(flat);
  const { state, closed } = run(ctx, 226);
  assert.equal(state.open.length, 0);
  assert.equal(closed.at(-1)?.exitReason, 'clôture de fin de fenêtre (18:55)');
});

test('stop journalier : plus aucune entrée après −1,5 %', () => {
  const ctx = stockCtx([[100.7, 101.1, 100.7, 101]]);
  const cfg = DEFAULT_DESK_CONFIG;
  const state = newDeskState(cfg);
  const events: DeskEvent[] = [];
  const engine = createEngine({ cfg, state, log: (e) => events.push(e) });
  engine.startDay(DAY, parisToUtc(DAY, 15 * 60));
  state.cash = 490; // −2 % sur la journée
  for (let t = OPEN; t < OPEN + 6 * 60_000; t += 60_000) engine.step(t, new Map([['TEST', ctx]]));
  assert.ok(!events.some((e) => e.type === 'open'));
  assert.ok(events.some((e) => e.type === 'guard' && e.msg.includes('stop journalier')));
});

test('compte cash : l’argent des actions vendues n’est pas réutilisable le jour même', () => {
  const ctx = stockCtx([[100.7, 101.1, 100.7, 101]]);
  const cfg = { ...DEFAULT_DESK_CONFIG };
  const state = newDeskState(cfg);
  const events: DeskEvent[] = [];
  const engine = createEngine({ cfg, state, log: (e) => events.push(e) });
  engine.startDay(DAY, parisToUtc(DAY, 15 * 60));
  state.stockCashUsedToday = 490; // presque tout déjà engagé aujourd'hui
  for (let t = OPEN; t < OPEN + 7 * 60_000; t += 60_000) engine.step(t, new Map([['TEST', ctx]]));
  assert.ok(!events.some((e) => e.type === 'open'));
  assert.ok((engine.analysis.skipped['compte cash : liquidités du jour déjà engagées (réglement J+1)'] ?? 0) >= 1);
});

test('carnet CSV : en-tête stable, raisons échappées', () => {
  const csv = carnetCsv([
    {
      id: 't1', symbol: 'NVDA', cls: 'stock', strategy: 'orb', side: 'long', qty: 1.25, entry: 190, stop: 188, initialStop: 188,
      openedAt: OPEN + 360_000, riskUsd: 2.5, notionalUsd: 237.5, costsUsd: 0.14, best: 192, regime: 'tendance',
      reasons: ['cassure "nette"', 'volume ×2'], closedAt: OPEN + 3_600_000, exit: 192, pnlUsd: 2.36, r: 0.94,
      exitReason: 'stop suiveur', holdMinutes: 54, equityAfter: 502.36,
    },
  ]);
  const [head, row] = csv.trim().split('\n');
  assert.match(head ?? '', /^date;heure_entree;heure_sortie;instrument/);
  assert.match(row ?? '', /"cassure ""nette"" \| volume ×2"$/);
});

test('carnet : page sans squelette HTML, thèmes clair et sombre, raisons visibles, résumé texte du jour', () => {
  const ctx = stockCtx([
    [100.7, 101.1, 100.7, 101],
    [101, 101.2, 100.9, 101.1],
    [101, 101, 99.5, 99.6],
  ]);
  const { engine, ctxs, closed } = run(ctx, 9);
  const summary = engine.endDay(OPEN + 9 * 60_000, ctxs);
  assert.equal(summary.trades.length, 1);
  const txt = resumeJour(summary);
  assert.match(txt, /^Séance du 2026-11-10 : /);
  assert.match(txt, /TEST achat .* Pourquoi : .*volume relatif/);
  assert.match(txt, /Prévisions :\n- poids pour la prochaine séance/);
  const dir = mkdtempSync(join(tmpdir(), 'desk-carnet-'));
  writeJsonAtomic(join(dir, 'days', `${summary.day}.json`), summary);
  for (const t of closed) appendJsonl(join(dir, 'trades.jsonl'), t);
  const html = readFileSync(writeCarnet(dir, DEFAULT_DESK_CONFIG, { mode: 'direct' }), 'utf8');
  assert.ok(!/<!doctype|<(html|head|body)[\s>]/i.test(html), 'la page Claude ajoute elle-même le squelette HTML');
  assert.match(html.slice(0, 400), /<title>Carnet de trades<\/title>/);
  assert.match(html, /@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\)/);
  assert.match(html, /:root\[data-theme="dark"\]/);
  assert.match(html, /padding-left:max\(16px,env\(safe-area-inset-left,0px\)\)/);
  assert.match(html, /Pourquoi<\/span>[^<]*volume relatif/);
  assert.match(html, /Prévisions pour la séance suivante/);
});
