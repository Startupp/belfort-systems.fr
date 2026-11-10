/**
 * Validation des 12 comptes de 5 000 $, sans biais :
 * 1. chaque variante tourne sur la période d'apprentissage ;
 * 2. la meilleure (rendement / baisse maximale) est figée ;
 * 3. elle est jugée sur la période de test (les derniers mois), jamais utilisée pour choisir ;
 * toutes les variantes sont aussi montrées sur la période de test, pour qu'on voie que le choix n'a pas été fait après coup.
 *
 *   NODE_USE_ENV_PROXY=1 node src/arena/valide.ts        écrit arene/comptes.json et régénère la page
 */

import { join, resolve } from 'node:path';
import { writeJsonAtomic } from '../lib/store.ts';
import { paris } from '../desk/market.ts';
import type { Bar } from '../desk/types.ts';
import { runPortfolio, stats } from './engine.ts';
import type { Stats } from './engine.ts';
import { createArenaData } from './data.ts';
import type { DataKey } from './portfolios.ts';
import { ACCOUNTS, windows } from './roster.ts';
import type { Account, Variant, WindowKey } from './roster.ts';
import { FUNDING } from './strategies.ts';
import { writeArenaPage } from './report.ts';

export interface VariantResult {
  label: string;
  train: Stats;
  test: Stats;
  /** Equity de fin de journée sur la période de test. */
  testDaily: Array<[string, number]>;
}

export interface AccountResult {
  id: string;
  window: WindowKey;
  train: [number, number];
  test: [number, number];
  chosen: number;
  variants: VariantResult[];
  /** Rendement de la variante choisie ramené à un mois de 30,4 jours (périodes de test de longueurs différentes). */
  monthlyPct: number;
}

export interface ComptesFile {
  generatedAt: number;
  results: AccountResult[];
}

const dayOf = (ms: number): string => paris(ms).date;
/** Score d'apprentissage : rendement par point de baisse maximale (au moins 1 point), pour ne pas récompenser le seul levier. */
const score = (s: Stats): number => s.returnPct / Math.max(1, s.maxDrawdownPct);

async function main(): Promise<void> {
  const now = Date.now();
  const dir = resolve(process.env.ARENA_DIR?.trim() || 'arene');
  const data = createArenaData({ dir: resolve(process.env.ARENA_CACHE?.trim() || 'data/arena-cache'), maxAgeMs: 6 * 3_600_000, now, log: (m) => console.log(m) });
  for (const sym of ['PF_XBTUSD', 'PF_ETHUSD']) FUNDING.set(sym, new Map((await data.funding(sym)).map((r) => [r.t, r.rate])));

  const cache = new Map<string, Bar[]>();
  const series = async (v: Variant): Promise<Map<string, Bar[]>> => {
    const out = new Map<string, Bar[]>();
    for (const s of v.spec.symbols) {
      const key: DataKey = v.dataBySymbol?.[s] ?? v.spec.data;
      const k = `${key}|${s}`;
      if (!cache.has(k)) cache.set(k, (await data.load(key, [s])).get(s) ?? []);
      out.set(s, cache.get(k) as Bar[]);
    }
    return out;
  };

  // Début des barres de 5 min (QQQ) : la période d'apprentissage intraday commence 3 semaines après.
  const qqq = (await data.load('y5m', ['QQQ'])).get('QQQ') ?? [];
  if (qqq.length < 100) throw new Error('barres de 5 min indisponibles');
  const W = windows(now, (qqq[0] as Bar).t);

  const results: AccountResult[] = [];
  for (const a of ACCOUNTS as Account[]) {
    const w = W[a.window];
    const variants: VariantResult[] = [];
    for (const v of a.variants) {
      const s = await series(v);
      const tr = runPortfolio(v.spec, s, w.train[0], w.train[1]);
      const te = runPortfolio(v.spec, s, w.test[0], w.test[1]);
      const daily = new Map<string, number>();
      for (const [t, e] of te.curve) daily.set(dayOf(t), Math.round(e * 100) / 100);
      variants.push({ label: v.label, train: stats(tr, dayOf), test: stats(te, dayOf), testDaily: [...daily.entries()] });
    }
    let chosen = 0;
    variants.forEach((r, i) => {
      if (score(r.train) > score((variants[chosen] as VariantResult).train)) chosen = i;
    });
    const c = variants[chosen] as VariantResult;
    const days = (w.test[1] - w.test[0]) / 86_400_000;
    const monthlyPct = ((1 + c.test.returnPct / 100) ** (30.44 / days) - 1) * 100;
    results.push({ id: a.id, window: a.window, train: w.train, test: w.test, chosen, variants, monthlyPct });
    console.log(
      `${a.id.padEnd(20)} choix : ${c.label.padEnd(36)} apprentissage ${c.train.returnPct >= 0 ? '+' : ''}${c.train.returnPct.toFixed(1)} % (baisse ${c.train.maxDrawdownPct.toFixed(1)} %) | test ${c.test.returnPct >= 0 ? '+' : ''}${c.test.returnPct.toFixed(2)} % sur ${days.toFixed(0)} j (${monthlyPct >= 0 ? '+' : ''}${monthlyPct.toFixed(2)} %/mois), baisse ${c.test.maxDrawdownPct.toFixed(2)} %, ${c.test.trades} trades`,
    );
    for (const [i, r] of variants.entries()) if (variants.length > 1) console.log(`   ${i === chosen ? '→' : ' '} ${r.label.padEnd(40)} appr. ${r.train.returnPct.toFixed(1).padStart(6)} % / baisse ${r.train.maxDrawdownPct.toFixed(1).padStart(5)} %   test ${r.test.returnPct.toFixed(2).padStart(7)} %`);
  }
  writeJsonAtomic(join(dir, 'comptes.json'), { generatedAt: now, results } satisfies ComptesFile);
  console.log(`page : ${writeArenaPage(dir)}`);
}

await main();
