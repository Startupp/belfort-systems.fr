/**
 * Arène des stratégies (papier) : portefeuilles parallèles, une stratégie chacun.
 *
 *   node src/arena/main.ts rejeu       rejeu de tous les portefeuilles : période commune (~6 semaines) et historique long
 *   node src/arena/main.ts avance      suivi en direct : tout est rejoué depuis le départ du suivi avec le code figé
 *   node src/arena/main.ts page        régénère arene/arene.html à partir des derniers résultats
 *
 * ARENA_DIR : dossier des résultats (défaut arene). Cache des cours : data/arena-cache (hors git).
 */

import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeJsonAtomic } from '../lib/store.ts';
import { paris } from '../desk/market.ts';
import type { Bar } from '../desk/types.ts';
import { runPortfolio, stats } from './engine.ts';
import type { RunResult, Stats } from './engine.ts';
import { createArenaData } from './data.ts';
import { PORTFOLIOS } from './portfolios.ts';
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
  const data = createArenaData({ dir: resolve('data/arena-cache'), maxAgeMs: cmd === 'avance' ? 30 * 60_000 : 6 * 3_600_000, now, log });
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
      const first = Math.min(...[...series.values()].map((b) => b[0]?.t ?? Infinity));
      const warm: Partial<Record<DataKey, number>> = { crypto1h: 10, crypto15m: 10, us5m: 21, spy5m: 21, gold5m: 21, btc1m: 1 };
      const longFrom = p.data === 'daily' ? zonedToUtc('2010-01-04', 0, PARIS) : warm[p.data] !== undefined ? zonedToUtc(paris(first + (warm[p.data] as number) * 86_400_000).date, 0, PARIS) : NaN;
      if (Number.isFinite(longFrom) && longFrom < commonFrom - 3 * 86_400_000) {
        const rl = runPortfolio(p, series, longFrom, end, aux);
        longRuns.push(summarize(rl, 0));
        const sl = longRuns.at(-1)?.stats as Stats;
        log(`  historique depuis ${dayOf(longFrom)} : ${sl.returnPct >= 0 ? '+' : ''}${sl.returnPct.toFixed(1)} % · ${sl.trades} trades · baisse max ${sl.maxDrawdownPct.toFixed(1)} %`);
      }
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
