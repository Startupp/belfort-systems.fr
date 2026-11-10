/**
 * Arène des stratégies (papier) : portefeuilles parallèles, une stratégie chacun.
 *
 *   node src/arena/main.ts rejeu       rejeu de tous les portefeuilles : période commune (~6 semaines) et historique long
 *   node src/arena/main.ts avance      suivi en direct : tout est rejoué depuis le départ du suivi avec le code figé
 *   node src/arena/main.ts page        régénère arene/arene.html à partir des derniers résultats
 *
 * ARENA_DIR : dossier des résultats (défaut arene). ARENA_CACHE : cache des cours (défaut data/arena-cache, hors git).
 */

import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeJsonAtomic } from '../lib/store.ts';
import { paris } from '../desk/market.ts';
import type { Bar } from '../desk/types.ts';
import { runPortfolio, stats } from './engine.ts';
import type { RunResult, Stats } from './engine.ts';
import { createArenaData } from './data.ts';
import { bootstrapMonths, runComposite } from './composite.ts';
import type { Composite, Sleeve } from './composite.ts';
import { COMPOSITES, PORTFOLIOS } from './portfolios.ts';
import type { ArenaPortfolio, DataKey } from './portfolios.ts';
import { writeArenaPage } from './report.ts';
import { PARIS, zonedToUtc } from './strategies.ts';

/** Départ du suivi en direct : mercredi 11 novembre 2026, 0 h (Paris). */
export const SUIVI_START = zonedToUtc('2026-11-11', 0, PARIS);

export interface RunSummary {
  id: string;
  from: number;
  to: number;
  capital: number;
  equity: number;
  stats: Stats;
  liquidatedAt?: number;
  fees: number;
  financing: number;
  /** Equity en fin de journée (Paris), pour la courbe. */
  daily: Array<[string, number]>;
  trades: RunResult['trades'];
  open: RunResult['open'];
  /** Portefeuille combiné : résultat de chaque poche sur la même période. */
  parts?: Array<{ id: string; label: string; capital: number; returnPct: number; maxDrawdownPct: number; trades: number }>;
  /** Portefeuille combiné : fourchette de résultats sur un mois (tirages dans les journées passées). */
  espoir?: { from: number; days: number; p10: number; p50: number; p90: number; negative: number };
}

export interface ArenaFile {
  generatedAt: number;
  commit: string;
  windows: Record<string, { label: string; from: number; to: number; runs: RunSummary[] }>;
}

const dayOf = (ms: number): string => paris(ms).date;
const dayFr = (ms: number): string => new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', year: 'numeric' });

export function summarize(r: RunResult, keepTrades: number): RunSummary {
  const daily = new Map<string, number>();
  for (const [t, e] of r.curve) daily.set(dayOf(t), Math.round(e * 100) / 100);
  return {
    id: r.id,
    from: r.from,
    to: r.to,
    capital: r.capital,
    equity: r.equity,
    stats: stats(r, dayOf),
    liquidatedAt: r.liquidatedAt,
    fees: r.fees,
    financing: r.financing,
    // Au plus ~400 points (un sur n pour les historiques longs), le dernier toujours gardé.
    daily: [...daily.entries()].filter((_, i, a) => a.length <= 400 || i % Math.ceil(a.length / 400) === 0 || i === a.length - 1),
    trades: keepTrades > 0 ? r.trades.slice(-keepTrades) : [],
    open: r.open,
  };
}

/** Dernier commit qui a modifié le code de l'arène (les règles des stratégies). */
function commit(): string {
  try {
    return execFileSync('git', ['log', '-1', '--format=%h (%ad)', '--date=short', '--', 'src/arena'], { encoding: 'utf8' }).trim() || 'non commité';
  } catch {
    return '?';
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'page';
  const dir = resolve(process.env.ARENA_DIR?.trim() || 'arene');
  const now = Date.now();
  const log = (m: string): void => console.log(m);
  if (cmd === 'page') {
    log(`page : ${writeArenaPage(dir)}`);
    return;
  }
  // Suivi : seulement l'historique utile depuis le départ (plus le temps de chauffe des indicateurs).
  const since = Math.max(0, Math.ceil((now - SUIVI_START) / 86_400_000));
  const historyDays: Partial<Record<DataKey, number>> | undefined =
    cmd === 'avance' ? { us1m: Math.min(29, since + 2), crypto1h: since + 30, crypto15m: since + 10, btc1m: since + 2 } : undefined;
  const data = createArenaData({ dir: resolve(process.env.ARENA_CACHE?.trim() || 'data/arena-cache'), maxAgeMs: cmd === 'avance' ? 30 * 60_000 : 6 * 3_600_000, now, log, historyDays });
  const cache = new Map<DataKey, Map<string, Bar[]>>();
  const load = async (key: DataKey, symbols: string[]): Promise<Map<string, Bar[]>> => {
    let m = cache.get(key);
    if (!m) cache.set(key, (m = new Map()));
    const missing = symbols.filter((s) => !m.has(s));
    if (missing.length) for (const [s, b] of await data.load(key, missing)) m.set(s, b);
    return new Map(symbols.map((s) => [s, m.get(s) ?? []]));
  };
  const seriesFor = (p: ArenaPortfolio): Promise<Map<string, Bar[]>> => load(p.data, p.symbols);
  const auxFor = (p: ArenaPortfolio): Promise<Map<string, Bar[]> | undefined> => (p.auxData ? load(p.auxData, p.symbols) : Promise.resolve(undefined));
  /** Portefeuille combiné : données de chaque poche chargées d'abord, puis rejeu synchrone. */
  const combine = async (c: Composite, from: number, to: number): Promise<{ summary: RunSummary; daily: number[] }> => {
    const data = new Map<string, { series: Map<string, Bar[]>; aux?: Map<string, Bar[]> }>();
    for (const s of c.sleeves) data.set(s.spec.id, { series: await seriesFor(s.spec), aux: await auxFor(s.spec) });
    const { result, parts } = runComposite(c, (s: Sleeve) => data.get(s.spec.id) as { series: Map<string, Bar[]> }, from, to, dayOf);
    const summary = summarize(result, 30);
    summary.parts = parts.map((r, i) => {
      const st = stats(r, dayOf);
      return { id: r.id, label: (c.sleeves[i] as Sleeve).label, capital: r.capital, returnPct: st.returnPct, maxDrawdownPct: st.maxDrawdownPct, trades: st.trades };
    });
    const eq = [c.capital, ...result.curve.map((x) => x[1])];
    const daily = eq.slice(1).map((e, i) => e / (eq[i] as number) - 1);
    return { summary, daily };
  };
  /** Début de l'historique long d'un portefeuille (null si rien de plus long que la période commune). */
  const warm: Partial<Record<DataKey, number>> = { crypto1h: 10, crypto15m: 10, us5m: 21, spy5m: 21, gold5m: 21, btc1m: 1 };
  const longStart = (p: ArenaPortfolio, series: Map<string, Bar[]>): number => {
    const first = Math.min(...[...series.values()].map((b) => b[0]?.t ?? Infinity));
    return p.data === 'daily' ? zonedToUtc('2010-01-04', 0, PARIS) : warm[p.data] !== undefined ? zonedToUtc(paris(first + (warm[p.data] as number) * 86_400_000).date, 0, PARIS) : NaN;
  };

  if (cmd === 'rejeu') {
    // Période commune : celle des barres de 1 min (~29 jours), nécessaires à l'ORB ; les autres ont plus d'historique.
    const orb = PORTFOLIOS.find((p) => p.data === 'us1m') as ArenaPortfolio;
    const firsts = [...(await seriesFor(orb)).values()].map((b) => b[0]?.t).filter((t): t is number => t !== undefined).sort((a, b) => a - b);
    if (firsts.length < 10) throw new Error('données 1 min indisponibles');
    const commonFrom = zonedToUtc(paris((firsts[Math.floor(firsts.length / 2)] as number) + 86_400_000).date, 0, PARIS);
    // Le rejeu s'arrête à la fin de la veille : la séance du jour appartient au suivi en direct.
    const end = zonedToUtc(dayOf(now), 0, PARIS);
    const runs: RunSummary[] = [];
    const longRuns: RunSummary[] = [];
    for (const p of PORTFOLIOS) {
      const series = await seriesFor(p);
      const aux = await auxFor(p);
      const r = runPortfolio(p, series, commonFrom, end, aux);
      runs.push(summarize(r, 30));
      const s = runs.at(-1)?.stats as Stats;
      log(`${p.id.padEnd(20)} ${s.returnPct >= 0 ? '+' : ''}${s.returnPct.toFixed(2)} % · ${s.trades} trades · réussite ${s.winRatePct.toFixed(0)} % · baisse max ${s.maxDrawdownPct.toFixed(2)} %${r.liquidatedAt ? ' · LIQUIDÉ' : ''}`);
      // Historique long là où les données le permettent.
      const longFrom = longStart(p, series);
      if (Number.isFinite(longFrom) && longFrom < commonFrom - 3 * 86_400_000) {
        const rl = runPortfolio(p, series, longFrom, end, aux);
        longRuns.push(summarize(rl, 0));
        const sl = longRuns.at(-1)?.stats as Stats;
        log(`  historique depuis ${dayOf(longFrom)} : ${sl.returnPct >= 0 ? '+' : ''}${sl.returnPct.toFixed(1)} % · ${sl.trades} trades · baisse max ${sl.maxDrawdownPct.toFixed(1)} %`);
      }
    }
    // Portefeuilles combinés : même période commune, puis la plus longue période où toutes les poches ont des données.
    for (const c of COMPOSITES) {
      const common = await combine(c, commonFrom, end);
      const starts: number[] = [];
      for (const s of c.sleeves) starts.push(longStart(s.spec, await seriesFor(s.spec)));
      const from = Math.max(...starts.filter((x) => Number.isFinite(x)));
      const longer = await combine(c, from, end);
      const e = bootstrapMonths(longer.daily);
      common.summary.espoir = { from, days: longer.daily.length, ...e };
      runs.push(common.summary);
      longRuns.push({ ...longer.summary, espoir: common.summary.espoir });
      const s = common.summary.stats;
      log(`${c.id.padEnd(20)} ${s.returnPct >= 0 ? '+' : ''}${s.returnPct.toFixed(2)} % · ${s.trades} trades · baisse max ${s.maxDrawdownPct.toFixed(2)} % · un mois : ${e.p10.toFixed(1)} / ${e.p50.toFixed(1)} / ${e.p90.toFixed(1)} % (10 / 50 / 90 %), négatif ${e.negative.toFixed(0)} % du temps`);
      log(`  depuis ${dayOf(from)} : ${longer.summary.stats.returnPct >= 0 ? '+' : ''}${longer.summary.stats.returnPct.toFixed(2)} % · baisse max ${longer.summary.stats.maxDrawdownPct.toFixed(2)} %`);
    }
    const out: ArenaFile = {
      generatedAt: now,
      commit: commit(),
      windows: {
        commun: { label: `Rejeu sur la même période pour tous (du ${dayFr(commonFrom)} au ${dayFr(end - 1)})`, from: commonFrom, to: end, runs },
        long: { label: 'Historique plus long (autant que les données le permettent)', from: Math.min(...longRuns.map((r) => r.from)), to: end, runs: longRuns },
      },
    };
    writeJsonAtomic(join(dir, 'rejeu.json'), out);
    log(`rejeu : ${join(dir, 'rejeu.json')}`);
  } else if (cmd === 'avance') {
    const runs: RunSummary[] = [];
    for (const p of PORTFOLIOS) {
      const r = runPortfolio(p, await seriesFor(p), SUIVI_START, now, await auxFor(p));
      runs.push(summarize(r, 400));
      const s = runs.at(-1)?.stats as Stats;
      log(`${p.id.padEnd(20)} ${r.equity.toFixed(2)} $ (${s.returnPct >= 0 ? '+' : ''}${s.returnPct.toFixed(2)} %) · ${s.trades} trades${r.open.length ? ` · ${r.open.length} ouverte(s)` : ''}`);
    }
    for (const c of COMPOSITES) {
      const { summary } = await combine(c, SUIVI_START, now);
      runs.push(summary);
      log(`${c.id.padEnd(20)} ${summary.equity.toFixed(2)} $ (${summary.stats.returnPct >= 0 ? '+' : ''}${summary.stats.returnPct.toFixed(2)} %) · ${summary.stats.trades} trades`);
    }
    const out: ArenaFile = {
      generatedAt: now,
      commit: commit(),
      windows: { suivi: { label: `Suivi en direct depuis le ${dayFr(SUIVI_START)}`, from: SUIVI_START, to: now, runs } },
    };
    writeJsonAtomic(join(dir, 'suivi.json'), out);
  } else {
    console.error('usage : node src/arena/main.ts rejeu | avance | page');
    process.exit(1);
  }
  log(`page : ${writeArenaPage(dir)}`);
}

await main();
