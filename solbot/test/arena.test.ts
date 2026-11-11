/** Tests de l'arène : moteur papier (levier, marge, stops, ordres), stratégies, page. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJsonAtomic } from '../src/lib/store.ts';
import type { Bar } from '../src/desk/types.ts';
import { runPortfolio, stats } from '../src/arena/engine.ts';
import type { Costs, Intent, PortfolioSpec, Strategy } from '../src/arena/engine.ts';
import { FUNDING, NY, faber, fundingAt, fundingCarry, orbFirstCandle, orbStudy, randomSignals, rsi, zonedToUtc } from '../src/arena/strategies.ts';
import { localTime, localTimeIntl } from '../src/desk/market.ts';
import { renderComptes } from '../src/arena/comptes-page.ts';
import { writeArenaPage } from '../src/arena/report.ts';
import { bootstrapMonths, runComposite } from '../src/arena/composite.ts';
import type { Composite } from '../src/arena/composite.ts';
import type { ArenaPortfolio } from '../src/arena/portfolios.ts';

const T0 = Date.UTC(2026, 10, 10, 15, 0); // mardi 10 novembre 2026, 16 h à Paris
const M = 60_000;
const FREE: Costs = { feeBps: 0, slipBps: 0, financingPct: 0, minNotional: 0 };

function bars(rows: Array<[number, number, number, number]>, step = M, t0 = T0): Bar[] {
  return rows.map(([o, h, l, c], i) => ({ t: t0 + i * step, o, h, l, c, v: 1000 }));
}

/** Stratégie scriptée : intentions données par indice de barre du symbole X. */
function scripted(plan: Record<number, (v: Parameters<Strategy['onBar']>[0]) => Intent[]>): () => Strategy {
  return () => ({ onBar: (v) => (v.fresh.has('X') ? (plan[v.idx.get('X') as number]?.(v) ?? []) : []) });
}

function spec(over: Partial<PortfolioSpec>): PortfolioSpec {
  return { id: 't', name: 't', capital: 1000, maxLeverage: 1, allowShort: true, costs: FREE, barMs: M, symbols: ['X'], strategy: scripted({}), ...over };
}

const flat = (n: number, px = 100): Array<[number, number, number, number]> => Array.from({ length: n }, () => [px, px, px, px]);

test('levier : le montant total ne dépasse jamais capital × levier maximal', () => {
  const s = spec({ maxLeverage: 2, strategy: scripted({ 0: () => [{ type: 'enter', symbol: 'X', side: 'long', order: 'close', size: { notional: 10 }, reason: 'test' }] }) });
  const r = runPortfolio(s, new Map([['X', bars(flat(3))]]), T0, T0 + 10 * M);
  assert.equal(r.open.length, 1);
  assert.ok(Math.abs((r.open[0]?.qty ?? 0) * 100 - 2000) < 1e-6, 'qty × prix = 2 × 1 000 $');
});

test('stop : exécuté au prix du stop, ou à l’ouverture si le cours saute par-dessus ; glissement appliqué', () => {
  const enter: Intent = { type: 'enter', symbol: 'X', side: 'long', order: 'close', stop: 95, size: { risk: 0.01 }, reason: 'test' };
  const costs = { ...FREE, slipBps: 10 };
  const a = runPortfolio(spec({ costs, strategy: scripted({ 0: () => [enter] }) }), new Map([['X', bars([[100, 100, 100, 100], [100, 101, 94, 96]])]]), T0, T0 + 10 * M);
  assert.equal(a.trades[0]?.exitReason, 'stop');
  assert.ok(Math.abs((a.trades[0]?.exit ?? 0) - 95 * 0.999) < 1e-9, 'vente au stop moins le glissement');
  const b = runPortfolio(spec({ strategy: scripted({ 0: () => [enter] }) }), new Map([['X', bars([[100, 100, 100, 100], [90, 91, 89, 90]])]]), T0, T0 + 10 * M);
  assert.equal(b.trades[0]?.exitReason, 'stop (ouverture au-delà)');
  assert.equal(b.trades[0]?.exit, 90);
});

test('stop et objectif dans la même barre : le stop compte ; pas d’objectif sur la barre d’entrée', () => {
  const enter: Intent = { type: 'enter', symbol: 'X', side: 'long', order: 'stop', price: 101, stop: 99, target: 103, size: { risk: 0.01 }, reason: 'test' };
  // Barre 1 : l'ordre stop est exécuté à 101 et la barre monte jusqu'à 104 : l'objectif n'est pas pris sur cette barre.
  // Barre 2 : touche 98 et 104 : le stop compte.
  const r = runPortfolio(spec({ strategy: scripted({ 0: () => [enter] }) }), new Map([['X', bars([[100, 100, 100, 100], [100, 104, 100.5, 103.5], [103, 104, 98, 100]])]]), T0, T0 + 10 * M);
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0]?.entry, 101);
  assert.equal(r.trades[0]?.exitReason, 'stop');
});

test('ordre limite : exécuté seulement si le cours passe au travers ; frais maker', () => {
  const costs = { ...FREE, feeBps: 9, makerFeeBps: 0 };
  const enter: Intent = { type: 'enter', symbol: 'X', side: 'long', order: 'limit', price: 99, target: 100, size: { notional: 0.5 }, reason: 'grille' };
  const touched = runPortfolio(spec({ costs, strategy: scripted({ 0: () => [enter] }) }), new Map([['X', bars([[100, 100, 100, 100], [100, 100, 99, 99.5], [99.5, 99.8, 99.2, 99.6]])]]), T0, T0 + 10 * M);
  assert.equal(touched.open.length + touched.trades.length, 0, 'un simple contact du prix ne suffit pas');
  const through = runPortfolio(spec({ costs, strategy: scripted({ 0: () => [enter] }) }), new Map([['X', bars([[100, 100, 100, 100], [100, 100, 98.5, 99.5], [99.5, 100.5, 99.2, 100.2]])]]), T0, T0 + 10 * M);
  assert.equal(through.trades.length, 1);
  assert.equal(through.trades[0]?.exitReason, 'objectif');
  assert.equal(through.fees, 0, 'ordres limites : 0 % de frais');
});

test('OCO : le premier ordre exécuté annule l’autre', () => {
  const mk = (side: 'long' | 'short', price: number, stop: number): Intent => ({ type: 'enter', symbol: 'X', side, order: 'stop', price, stop, size: { risk: 0.01 }, oco: 'g', reason: 'test' });
  const r = runPortfolio(spec({ strategy: scripted({ 0: () => [mk('long', 101, 99), mk('short', 99, 101)] }) }), new Map([['X', bars([[100, 100, 100, 100], [100, 102, 100, 101.5], [101.5, 101.6, 98, 98.5]])]]), T0, T0 + 10 * M);
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0]?.side, 'long');
  assert.equal(r.open.length, 0, 'la vente stop a été annulée');
});

test('marge : clôture sous 50 % de la marge, jamais de solde négatif', () => {
  const enter: Intent = { type: 'enter', symbol: 'X', side: 'long', order: 'close', size: { notional: 20 }, reason: 'test' };
  const r = runPortfolio(spec({ maxLeverage: 20, strategy: scripted({ 0: () => [enter] }) }), new Map([['X', bars([[100, 100, 100, 100], [100, 100, 97.4, 97.4], [97.4, 97.4, 97.4, 97.4]])]]), T0, T0 + 10 * M);
  assert.equal(r.trades[0]?.exitReason, 'clôture de marge (equity < 50 % de la marge)');
  assert.ok(r.equity > 0 && r.equity < 600);
  const crash = runPortfolio(spec({ maxLeverage: 20, strategy: scripted({ 0: () => [enter] }) }), new Map([['X', bars([[100, 100, 100, 100], [90, 90, 90, 90]])]]), T0, T0 + 10 * M);
  assert.equal(crash.equity, 0);
  assert.ok(crash.liquidatedAt !== undefined);
});

test('durée : rien ne reste ouvert plus de 3 jours ; sortie à l’ouverture pour la stratégie de nuit', () => {
  const hold = runPortfolio(spec({ barMs: 3_600_000, strategy: scripted({ 0: () => [{ type: 'enter', symbol: 'X', side: 'long', order: 'close', size: { notional: 1 }, reason: 'test' }] }) }), new Map([['X', bars(flat(100), 3_600_000)]]), T0, T0 + 100 * 3_600_000);
  assert.equal(hold.trades[0]?.exitReason, 'durée maximale (3 jours)');
  assert.ok((hold.trades[0]?.closedAt ?? 0) - (hold.trades[0]?.openedAt ?? 0) <= 72 * 3_600_000);
  const night = runPortfolio(spec({ strategy: scripted({ 0: () => [{ type: 'enter', symbol: 'X', side: 'long', order: 'close', exitAtNextOpen: true, size: { notional: 1 }, reason: 'nuit' }] }) }), new Map([['X', bars([[100, 100, 100, 100], [103, 104, 99, 100]])]]), T0, T0 + 10 * M);
  assert.equal(night.trades[0]?.exit, 103);
  assert.equal(night.trades[0]?.exitReason, 'sortie à l’ouverture');
});

test('compte cash : pas de vente à découvert ; lot minimal de 1 once arrondi vers le bas', () => {
  const short: Intent = { type: 'enter', symbol: 'X', side: 'short', order: 'close', size: { notional: 1 }, reason: 'test' };
  assert.equal(runPortfolio(spec({ allowShort: false, strategy: scripted({ 0: () => [short] }) }), new Map([['X', bars(flat(2))]]), T0, T0 + 5 * M).open.length, 0);
  const gold: Intent = { type: 'enter', symbol: 'X', side: 'long', order: 'close', stop: 3990, size: { risk: 0.01 }, reason: 'or' };
  const r = runPortfolio(spec({ maxLeverage: 20, costs: { ...FREE, qtyStep: 1 }, strategy: scripted({ 0: () => [gold] }) }), new Map([['X', bars(flat(2, 4000))]]), T0, T0 + 5 * M);
  assert.equal(r.open[0]?.qty, 1, '10 $ de risque / 10 $ de stop = 1 once');
});

test('statistiques : rendement, baisse maximale, réussite', () => {
  const enter: Intent = { type: 'enter', symbol: 'X', side: 'long', order: 'close', size: { notional: 1 }, reason: 'test' };
  const r = runPortfolio(spec({ strategy: scripted({ 0: () => [enter], 2: (v) => [{ type: 'exit', id: v.positions[0]?.id ?? '', order: 'close', reason: 'fin' }] }) }), new Map([['X', bars([[100, 100, 100, 100], [100, 100, 90, 90], [90, 110, 90, 110]])]]), T0, T0 + 10 * M);
  const s = stats(r, () => '2026-11-10');
  assert.ok(Math.abs(s.returnPct - 10) < 1e-9);
  assert.ok(Math.abs(s.maxDrawdownPct - 10) < 1e-9);
  assert.equal(s.winRatePct, 100);
});

test('RSI de Wilder : 100 sur une hausse continue, bas après une forte baisse', () => {
  const up = rsi([1, 2, 3, 4, 5, 6], 2);
  assert.equal(up.at(-1), 100);
  const down = rsi([10, 11, 12, 11, 9, 7], 2);
  assert.ok((down.at(-1) as number) < 10);
});

test('ORB de l’étude : achat stop au plus haut de la 1re bougie haussière d’une action en jeu, sortie à la clôture', () => {
  // 15 séances d'historique (5 min), puis une séance où la 1re bougie a 3 fois le volume habituel.
  const all: Bar[] = [];
  const days = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09'];
  for (const [k, d] of days.entries()) {
    const open = zonedToUtc(d, 570, NY);
    const last = k === days.length - 1;
    for (let i = 0; i < 78; i++) {
      const base = 100;
      let bar: Bar = { t: open + i * 5 * M, o: base, h: base + 1, l: base - 1, c: base, v: 200_000 };
      if (last && i === 0) bar = { ...bar, o: 100, h: 101, l: 99.5, c: 100.8, v: 600_000 };
      if (last && i === 1) bar = { ...bar, o: 100.85, h: 102, l: 100.85, c: 101.8 };
      if (last && i > 1) bar = { ...bar, o: 102, h: 102.5, l: 101.9, c: 102.2 };
      all.push(bar);
    }
  }
  const from = zonedToUtc('2026-11-09', 0, NY);
  const r = runPortfolio(
    { id: 'orb', name: 'orb', capital: 500, maxLeverage: 4, allowShort: true, costs: FREE, barMs: 5 * M, symbols: ['TEST'], strategy: () => orbStudy({ symbols: ['TEST'] }) },
    new Map([['TEST', all]]),
    from,
    from + 2 * 86_400_000,
  );
  assert.equal(r.trades.length, 1, JSON.stringify(r.trades));
  const t = r.trades[0];
  assert.equal(t?.side, 'long');
  assert.equal(t?.entry, 101);
  assert.equal(t?.exitReason, 'fin de séance');
  assert.ok((t?.pnl ?? 0) > 0);
  assert.ok((t?.notional ?? 0) <= 2000 + 1e-6, 'levier 4 au plus');
});

test('ORB en barres de 1 min : moyennes de 14 jours prises dans l’historique 5 min, entrée au plus haut des 5 premières minutes', () => {
  const hist: Bar[] = [];
  const days = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
  for (const d of days) {
    const open = zonedToUtc(d, 570, NY);
    for (let i = 0; i < 78; i++) hist.push({ t: open + i * 5 * M, o: 100, h: 101, l: 99, c: 100, v: 200_000 });
  }
  // Séance du 9 novembre : en 5 min (volumes, range d'ouverture) et en 1 min (exécution). 1re bougie de 5 min en
  // hausse avec 3 fois le volume habituel ; une minute aberrante (volume énorme) dans la série 1 min est ignorée.
  const open = zonedToUtc('2026-11-09', 570, NY);
  hist.push({ t: open, o: 100, h: 101.1, l: 99.9, c: 101, v: 600_000 });
  for (let i = 1; i < 78; i++) hist.push({ t: open + i * 5 * M, o: 102, h: 102.3, l: 101.9, c: 102.1, v: 200_000 });
  const one: Bar[] = [];
  for (let i = 0; i < 390; i++) {
    let b: Bar = { t: open + i * M, o: 102, h: 102.3, l: 101.9, c: 102.1, v: 40_000 };
    if (i < 5) b = { t: open + i * M, o: 100 + i * 0.2, h: 100.3 + i * 0.2, l: 99.9 + i * 0.2, c: 100.2 + i * 0.2, v: 120_000 };
    if (i === 5) b = { t: open + i * M, o: 101, h: 101.5, l: 100.95, c: 101.4, v: 40_000 };
    if (i === 200) b = { ...b, v: 90_000_000 };
    one.push(b);
  }
  const r = runPortfolio(
    { id: 'orb1', name: 'orb1', capital: 500, maxLeverage: 4, allowShort: true, costs: FREE, barMs: M, symbols: ['TEST'], strategy: (aux) => orbStudy({ symbols: ['TEST'], history: aux }) },
    new Map([['TEST', one]]),
    open - 3_600_000,
    open + 400 * M,
    new Map([['TEST', hist]]),
  );
  assert.equal(r.trades.length, 1, JSON.stringify(r.trades));
  assert.ok(Math.abs((r.trades[0]?.entry ?? 0) - 101.1) < 1e-9, 'plus haut des 5 premières minutes');
  assert.equal(r.trades[0]?.exitReason, 'fin de séance');
});

test('clôture de marge en cours de barre : coupée au cours où l’equity touche 50 % de la marge', () => {
  // 1 000 $, levier 20 : 200 unités à 100 $ ; marge 1 000 $ ; seuil 500 $ → coupure à 97,50 $.
  const enter: Intent = { type: 'enter', symbol: 'X', side: 'long', order: 'close', size: { notional: 20 }, reason: 'test' };
  const r = runPortfolio(spec({ maxLeverage: 20, strategy: scripted({ 0: () => [enter] }) }), new Map([['X', bars([[100, 100, 100, 100], [99.9, 100, 96, 98]])]]), T0, T0 + 10 * M);
  assert.equal(r.trades[0]?.exitReason, 'clôture de marge (equity < 50 % de la marge)');
  assert.ok(Math.abs((r.trades[0]?.exit ?? 0) - 97.5) < 1e-9);
  assert.ok(Math.abs(r.equity - 500) < 1e-6, 'il reste 50 % de la marge');
});

test('témoin au hasard : même tirage à chaque rejeu (graine fixe)', () => {
  const b = bars(Array.from({ length: 600 }, () => [100, 100.1, 99.9, 100] as [number, number, number, number]), 5 * M, zonedToUtc('2026-11-10', 8 * 60, 'Europe/Paris'));
  const mk = (): PortfolioSpec => spec({ barMs: 5 * M, symbols: ['X'], strategy: () => randomSignals({ symbol: 'X', seed: 's', fromParis: 945, toParis: 1080, exitParis: 1140, stopPct: 0.3, targetPct: 0.6, size: { risk: 0.01 } }) });
  const a = runPortfolio(mk(), new Map([['X', b]]), b[0]?.t ?? 0, (b.at(-1)?.t ?? 0) + 1);
  const c = runPortfolio(mk(), new Map([['X', b]]), b[0]?.t ?? 0, (b.at(-1)?.t ?? 0) + 1);
  assert.equal(a.trades.length, 2, 'deux jours de semaine dans les données');
  assert.deepEqual(a.trades.map((t) => [t.openedAt, t.side]), c.trades.map((t) => [t.openedAt, t.side]));
});

test('portefeuille combiné : les poches s’additionnent jour par jour, chacune avec son capital', () => {
  const day = 86_400_000;
  const up = bars(Array.from({ length: 3 }, (_, i) => [100 + i, 100 + i, 100 + i, 100 + i] as [number, number, number, number]), day);
  const sleeve = (id: string, capital: number, side: 'long' | 'short'): ArenaPortfolio => ({
    ...spec({ id, capital, barMs: day, strategy: scripted({ 0: () => [{ type: 'enter', symbol: 'X', side, order: 'close', size: { notional: 1 }, reason: 't' }] }) }),
    data: 'daily', market: 'test', leverageLabel: 'sans', source: 's', rules: 'r', role: 'publiée',
  });
  const c: Composite = { id: 'mix', name: 'mix', market: 'm', leverageLabel: 'l', capital: 1500, role: 'combiné', source: 's', rules: 'r', sleeves: [{ label: 'achat', spec: sleeve('a', 1000, 'long') }, { label: 'vente', spec: sleeve('b', 500, 'short') }] };
  const { result, parts } = runComposite(c, () => ({ series: new Map([['X', up]]) }), T0, T0 + 3 * day, (ms) => new Date(ms).toISOString().slice(0, 10));
  assert.equal(parts.length, 2);
  // +2 % sur 1 000 $ (achat) et −2 % sur 500 $ (vente) : +10 $ au total.
  assert.ok(Math.abs(result.equity - 1510) < 1e-6, String(result.equity));
  assert.ok(Math.abs((result.curve.at(-1)?.[1] ?? 0) - 1510) < 1e-6);
  assert.equal(result.trades.length + result.open.length, 2);
});

test('fourchette d’un mois : médiane proche de la tendance, part de mois négatifs cohérente', () => {
  const flatUp = Array.from({ length: 60 }, () => 0.001);
  const e = bootstrapMonths(flatUp);
  assert.ok(Math.abs(e.p50 - (1.001 ** 21 - 1) * 100) < 1e-9);
  assert.equal(e.negative, 0);
  const mixed = Array.from({ length: 60 }, (_, i) => (i % 2 ? 0.01 : -0.01));
  const m = bootstrapMonths(mixed);
  assert.ok(m.p10 < 0 && m.p90 > 0 && m.negative > 20 && m.negative < 80);
});

test('perpétuels : le vendeur encaisse le financement horaire, l’acheteur le paie', () => {
  const hourly = bars(Array.from({ length: 5 }, () => [100, 100, 100, 100] as [number, number, number, number]), 3_600_000, Date.UTC(2026, 10, 10, 0, 0));
  const mk = (side: 'long' | 'short') =>
    runPortfolio(
      spec({ barMs: 3_600_000, maxLeverage: 5, fundingPerHour: () => 1e-4, strategy: scripted({ 0: () => [{ type: 'enter', symbol: 'X', side, order: 'close', size: { notional: 1 }, reason: 't' }] }) }),
      new Map([['X', hourly]]),
      hourly[0]?.t ?? 0,
      (hourly.at(-1)?.t ?? 0) + 3_600_000,
    );
  // 1 000 $ de position, 4 heures pleines à 0,01 % : 0,40 $.
  assert.ok(Math.abs(mk('short').equity - 1000.4) < 1e-6, String(mk('short').equity));
  assert.ok(Math.abs(mk('long').equity - 999.6) < 1e-6, String(mk('long').equity));
});

test('ORB QQQ (Zarattini & Aziz) : entrée à l’ouverture de la 2e bougie, stop au plus bas de la 1re', () => {
  const open = zonedToUtc('2026-11-09', 570, NY);
  const b: Bar[] = Array.from({ length: 78 }, (_, i) => ({ t: open + i * 5 * M, o: 101, h: 101.4, l: 100.9, c: 101.2, v: 1000 }));
  b[0] = { t: open, o: 100, h: 100.6, l: 99.8, c: 100.5, v: 1000 };
  b[1] = { t: open + 5 * M, o: 100.55, h: 101, l: 100.4, c: 100.9, v: 1000 };
  const r = runPortfolio(spec({ barMs: 5 * M, maxLeverage: 4, symbols: ['QQQ'], strategy: () => orbFirstCandle({ symbol: 'QQQ', risk: 0.01 }) }), new Map([['QQQ', b]]), open - M, open + 400 * M);
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0]?.entry, 100.55);
  assert.equal(r.trades[0]?.side, 'long');
  assert.equal(r.trades[0]?.exitReason, 'fin de séance');
  assert.ok(Math.abs((r.trades[0]?.qty ?? 0) - 10 / 0.75) < 1e-6, '1 % de 1 000 $ / (100,55 − 99,80)');
});

test('portage : seule la jambe perpétuel reçoit le financement, la jambe au comptant n’en paie pas', () => {
  const H = 3_600_000;
  const t0 = Date.UTC(2026, 10, 1, 0, 0);
  const flatH = Array.from({ length: 200 }, (_, i) => ({ t: t0 + i * H, o: 100, h: 100, l: 100, c: 100, v: 1 }));
  FUNDING.set('TEST-PERP', new Map(flatH.map((b) => [b.t, 1e-5])));
  const r = runPortfolio(
    spec({ barMs: H, maxLeverage: 1, symbols: ['TEST-SPOT', 'TEST-PERP'], maxHoldMs: Infinity, fundingPerHour: fundingAt, strategy: () => fundingCarry({ spot: 'TEST-SPOT', perp: 'TEST-PERP', enterAbove: 1e-6, exitBelow: 0, hours: 72 }) }),
    new Map([['TEST-SPOT', flatH], ['TEST-PERP', flatH]]),
    t0,
    t0 + 200 * H,
  );
  FUNDING.delete('TEST-PERP');
  const legs = r.open.map((p) => p.symbol).sort();
  assert.deepEqual(legs, ['TEST-PERP', 'TEST-SPOT']);
  // Entrée dès que la moyenne couvre 36 h (moitié de la fenêtre), puis 164 h de financement sur 500 $ à 0,001 %/h :
  // +0,82 $ sur la seule jambe perpétuel, rien sur la jambe au comptant.
  assert.ok(Math.abs(r.equity - 1000.82) < 1e-6, String(r.equity));
  assert.equal(r.open.find((p) => p.symbol === 'TEST-SPOT')?.financing, 0);
});

test('reprise : rejouer par morceaux avec l’état sauvegardé donne exactement le même compte', () => {
  // Allocation de Faber sur 3 actifs journaliers synthétiques (mémoire de la stratégie : dernier mois rééquilibré).
  const day = 86_400_000;
  const mk = (drift: number, seed: number): Bar[] => {
    const out: Bar[] = [];
    let px = 100;
    for (let i = 0; i < 700; i++) {
      px *= 1 + drift + 0.012 * Math.sin(i * 0.37 + seed);
      out.push({ t: Date.UTC(2024, 0, 1) + i * day + 14.5 * 3_600_000, o: px, h: px * 1.004, l: px * 0.996, c: px, v: 1 });
    }
    return out;
  };
  const series = new Map([['A', mk(0.0006, 1)], ['B', mk(-0.0002, 2)], ['C', mk(0.0003, 3)]]);
  const sp = spec({ barMs: 6.5 * 3_600_000, symbols: ['A', 'B', 'C'], maxHoldMs: Infinity, costs: { ...FREE, slipBps: 1 }, strategy: () => faber({ symbols: ['A', 'B', 'C'] }) });
  const from = Date.UTC(2024, 9, 1);
  const to = Date.UTC(2025, 11, 1);
  const whole = runPortfolio(sp, series, from, to);
  let state = runPortfolio(sp, series, from, from + 40 * day).state;
  let closed = 0;
  for (let cut = from + 40 * day; cut < to; cut += 37 * day) {
    const part = runPortfolio(sp, series, from, Math.min(to, cut + 37 * day), undefined, state);
    closed += part.trades.length;
    state = part.state;
  }
  const first = runPortfolio(sp, series, from, from + 40 * day).trades.length;
  assert.ok(whole.trades.length > 10, 'des rééquilibrages ont eu lieu');
  assert.equal(first + closed, whole.trades.length);
  assert.ok(Math.abs(state.cash - whole.state.cash) < 1e-9, `${state.cash} ≠ ${whole.state.cash}`);
  assert.deepEqual(state.positions.map((p) => [p.symbol, p.qty]), whole.state.positions.map((p) => [p.symbol, p.qty]));
});

test('heures locales sans Intl : identiques à Intl pour New York, Paris et Londres (2019 → 2027)', () => {
  for (const tz of ['America/New_York', 'Europe/Paris', 'Europe/London']) {
    for (let t = Date.UTC(2019, 0, 1); t < Date.UTC(2027, 11, 31); t += 47 * 60_000 * 7) assert.deepEqual(localTime(t, tz), localTimeIntl(t, tz), `${tz} ${new Date(t).toISOString()}`);
  }
});

test('page des 12 comptes : sans squelette, classement par rendement mensuel, départ du suivi annoncé', () => {
  const dir = mkdtempSync(join(tmpdir(), 'comptes-'));
  const st = (ret: number) => ({ returnPct: ret, maxDrawdownPct: 1, trades: 3, winRatePct: 50, profitFactor: 1, avgTradePct: 0, bestDayPct: 1, worstDayPct: -1, daysUp: 1, days: 2, exposurePct: 10 });
  const res = (id: string, m: number) => ({ id, window: 'daily', train: [T0, T0 + 1], test: [T0, T0 + 86_400_000], chosen: 0, monthlyPct: m, variants: [{ label: 'v', train: st(1), test: st(m), testDaily: [['2026-11-10', 5000 * (1 + m / 100)]] }] });
  writeJsonAtomic(join(dir, 'comptes.json'), { generatedAt: T0, results: [res('c1-sp500', 0.1), res('a2-orb-qqq', 9)] });
  const html = renderComptes(dir);
  assert.ok(!/<!doctype|<(html|head|body)[\s>]/i.test(html));
  assert.match(html, /:root\[data-theme="dark"\]/);
  assert.ok(html.indexOf('Sniper ORB Nasdaq (QQQ)') < html.indexOf('Achat-conservation S&amp;P 500'), 'le meilleur en premier');
  assert.match(html, /mercredi 11 novembre/);
});

test('page de l’arène : fragment sans squelette, thèmes clair et sombre, classement trié', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arene-'));
  const run = (id: string, ret: number) => ({
    id, from: T0, to: T0 + 1, capital: 500, equity: 500 * (1 + ret / 100), liquidatedAt: undefined, fees: 0, financing: 0, daily: [['2026-11-10', 500 * (1 + ret / 100)]], trades: [], open: [],
    stats: { returnPct: ret, maxDrawdownPct: 1, trades: 3, winRatePct: 50, profitFactor: 1, avgTradePct: 0, bestDayPct: 1, worstDayPct: -1, daysUp: 1, days: 2, exposurePct: 10 },
  });
  writeJsonAtomic(join(dir, 'rejeu.json'), { generatedAt: T0, commit: 'abc', windows: { commun: { label: 'Rejeu sur la même période pour tous (x)', from: T0, to: T0, runs: [run('rsi2', -1), run('orb-x4', 3)] }, long: { label: 'long', from: T0, to: T0, runs: [] } } });
  const html = readFileSync(writeArenaPage(dir), 'utf8');
  assert.ok(!/<!doctype|<(html|head|body)[\s>]/i.test(html));
  assert.match(html.slice(0, 300), /<title>Arène des stratégies<\/title>/);
  assert.match(html, /@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\)/);
  assert.match(html, /:root\[data-theme="dark"\]/);
  assert.ok(html.indexOf('ORB actions en jeu ×4') < html.indexOf('RSI(2) de Connors SPY + QQQ'), 'le meilleur en premier');
  assert.match(html, /Le suivi démarre le <b>mercredi 11 novembre/);
});

test('heure locale → UTC : calcul direct identique à la recherche complète (changements d’heure 2019-2027)', () => {
  // Référence : l'ancienne recherche sur la grille de 15 min.
  const ref = (date: string, minutes: number, tz: string): number | 'erreur' => {
    const base = Date.parse(`${date}T00:00:00Z`) + minutes * 60_000;
    for (let off = -840; off <= 840; off += 15) {
      const t = base - off * 60_000;
      const l = localTime(t, tz);
      if (l.date === date && l.minutes === minutes) return t;
    }
    return 'erreur';
  };
  let n = 0;
  for (const tz of ['America/New_York', 'Europe/Paris', 'Europe/London']) {
    for (let day = Date.UTC(2019, 0, 1); day < Date.UTC(2028, 0, 1); day += 86_400_000) {
      const date = new Date(day).toISOString().slice(0, 10);
      // Jours de changement d'heure (mars, octobre, novembre) en détail, les autres à quelques heures clés.
      const month = date.slice(5, 7);
      const minutes = month === '03' || month === '10' || month === '11' ? Array.from({ length: 48 }, (_, i) => i * 30) : [0, 570, 960];
      for (const m of minutes) {
        let fast: number | 'erreur';
        try {
          fast = zonedToUtc(date, m, tz);
        } catch {
          fast = 'erreur';
        }
        assert.equal(fast, ref(date, m, tz), `${tz} ${date} ${m}`);
        n++;
      }
    }
  }
  assert.ok(n > 30_000);
});
