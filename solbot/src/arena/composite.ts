/**
 * Portefeuilles combinés : plusieurs poches indépendantes (une stratégie chacune, son propre capital), additionnées
 * jour par jour. Pas de rééquilibrage entre poches pendant la période : ce qu'une poche gagne ou perd reste dans la poche.
 */

import type { Bar } from '../desk/types.ts';
import { runPortfolio } from './engine.ts';
import type { RunResult } from './engine.ts';
import type { ArenaPortfolio } from './portfolios.ts';

export interface Sleeve {
  /** Spécification complète de la poche (capital = part du total). */
  spec: ArenaPortfolio;
  /** Rôle de la poche, en clair. */
  label: string;
}

export interface Composite {
  id: string;
  name: string;
  market: string;
  leverageLabel: string;
  capital: number;
  role: 'combiné';
  source: string;
  rules: string;
  sleeves: Sleeve[];
}

/**
 * Fait tourner chaque poche puis additionne les equity : le résultat a la forme d'un RunResult (courbe = un point par
 * instant de fin de journée de Paris, trades = ceux de toutes les poches), ce qui permet d'utiliser les mêmes statistiques.
 */
export function runComposite(
  c: Composite,
  dataFor: (s: Sleeve) => { series: ReadonlyMap<string, Bar[]>; aux?: ReadonlyMap<string, Bar[]> },
  from: number,
  to: number,
  dayKey: (ms: number) => string,
): { result: RunResult; parts: RunResult[] } {
  const parts = c.sleeves.map((s) => {
    const d = dataFor(s);
    return runPortfolio(s.spec, d.series, from, to, d.aux);
  });
  // Equity de chaque poche en fin de journée (dernier point de la journée), complétée vers l'avant.
  const days = new Map<string, number>();
  const perPart = parts.map((r) => {
    const m = new Map<string, number>();
    for (const [t, e] of r.curve) {
      const k = dayKey(t);
      m.set(k, e);
      days.set(k, Math.max(days.get(k) ?? 0, t));
    }
    return m;
  });
  const ordered = [...days.entries()].sort((a, b) => a[1] - b[1]);
  const lastSeen = parts.map((r) => r.capital);
  const curve: Array<[number, number]> = [];
  for (const [k, t] of ordered) {
    let total = 0;
    perPart.forEach((m, i) => {
      const e = m.get(k);
      if (e !== undefined) lastSeen[i] = e;
      total += lastSeen[i] as number;
    });
    curve.push([t, total]);
  }
  const result: RunResult = {
    id: c.id,
    from,
    to,
    capital: c.capital,
    equity: parts.reduce((s, r) => s + r.equity, 0),
    cash: parts.reduce((s, r) => s + r.cash, 0),
    trades: parts.flatMap((r) => r.trades).sort((a, b) => a.closedAt - b.closedAt),
    open: parts.flatMap((r) => r.open),
    curve,
    fees: parts.reduce((s, r) => s + r.fees, 0),
    financing: parts.reduce((s, r) => s + r.financing, 0),
    exposureMs: Math.max(0, ...parts.map((r) => r.exposureMs)),
  };
  return { result, parts };
}

/**
 * « Ce qu'on peut espérer » : tirages de mois fictifs (21 séances) par blocs de 5 journées réelles consécutives,
 * pris au hasard dans l'historique disponible. Donne une fourchette, pas une promesse : l'échantillon est court.
 */
export function bootstrapMonths(dailyReturns: number[], opts: { draws?: number; block?: number; length?: number; seed?: number } = {}): { p10: number; p50: number; p90: number; negative: number } {
  const draws = opts.draws ?? 4000;
  const block = Math.min(opts.block ?? 5, dailyReturns.length);
  const length = opts.length ?? 21;
  let seed = opts.seed ?? 12345;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  if (dailyReturns.length < block || block <= 0) return { p10: 0, p50: 0, p90: 0, negative: 0 };
  const months: number[] = [];
  for (let d = 0; d < draws; d++) {
    let growth = 1;
    let n = 0;
    while (n < length) {
      const start = Math.floor(rand() * (dailyReturns.length - block + 1));
      for (let j = 0; j < block && n < length; j++, n++) growth *= 1 + (dailyReturns[start + j] as number);
    }
    months.push((growth - 1) * 100);
  }
  months.sort((a, b) => a - b);
  const q = (p: number): number => months[Math.floor(p * (months.length - 1))] as number;
  return { p10: q(0.1), p50: q(0.5), p90: q(0.9), negative: (months.filter((x) => x < 0).length / months.length) * 100 };
}
