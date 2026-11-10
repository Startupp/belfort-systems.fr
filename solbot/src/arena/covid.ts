/**
 * « Depuis le Covid » : entraînement en marche avant, année par année, de 2021 à aujourd'hui.
 * Pour chaque année Y : la variante est choisie sur les années précédentes seulement (depuis janvier 2020), puis
 * jugée sur l'année Y, qu'elle n'a jamais vue. Chaque année repart de 5 000 $ ; le cumul enchaîne les années.
 *
 * Comptes concernés : ceux dont les données remontent à 2020 (crypto au comptant et perpétuels, ETF). Les comptes
 * intraday en 5 min (Nasdaq, S&P 500, or, forex) n'ont que 60 jours de barres : ils ne sont pas dans cet entraînement.
 * Perpétuels et portage : prix au comptant Coinbase en approximation du perpétuel (écart de base ignoré), financement
 * réel de Binance (BTCUSDT, ETHUSDT) jusqu'en octobre 2025 puis de Kraken Futures.
 *
 *   NODE_USE_ENV_PROXY=1 node src/arena/covid.ts       écrit arene/covid.json et régénère la page
 */

import { join, resolve } from 'node:path';
import { writeJsonAtomic } from '../lib/store.ts';
import { paris } from '../desk/market.ts';
import type { Bar } from '../desk/types.ts';
import { runPortfolio, stats } from './engine.ts';
import type { Stats } from './engine.ts';
import { createArenaData } from './data.ts';
import type { DataKey } from './portfolios.ts';
import { ACCOUNTS, a1Variants, b3Variants } from './roster.ts';
import type { Variant } from './roster.ts';
import { FUNDING, PARIS, zonedToUtc } from './strategies.ts';
import { writeArenaPage } from './report.ts';

export interface CovidRow {
  year: number;
  label: string;
  returnPct: number;
  maxDrawdownPct: number;
  trades: number;
}
export interface CovidAccount {
  id: string;
  rows: CovidRow[];
  /** Années enchaînées (2021 → aujourd'hui). */
  cumulativePct: number;
  /** Pire baisse d'une année. */
  worstDrawdownPct: number;
  /** Réglage retenu pour le suivi de 12 mois : le meilleur sur tout l'historique jusqu'à la veille du départ. */
  final: { index: number; label: string };
}
export interface CovidFile {
  generatedAt: number;
  years: number[];
  accounts: CovidAccount[];
  /** Achat-conservation par année, pour situer chaque année. */
  context: Record<string, Record<number, number>>;
  skipped: string[];
}

const dayOf = (ms: number): string => paris(ms).date;
const score = (s: Stats): number => s.returnPct / Math.max(1, s.maxDrawdownPct);
const yearStart = (y: number): number => zonedToUtc(`${y}-01-01`, 0, PARIS);

async function main(): Promise<void> {
  const now = Date.now();
  const dir = resolve(process.env.ARENA_DIR?.trim() || 'arene');
  const since2019 = Math.ceil((now - Date.parse('2019-11-01T00:00:00Z')) / 86_400_000);
  const data = createArenaData({ dir: resolve(process.env.ARENA_CACHE?.trim() || 'data/arena-cache'), maxAgeMs: 12 * 3_600_000, now, log: (m) => console.log(m), historyDays: { crypto1h: since2019, crypto1d: since2019 + 400 } });

  // Financement : Binance jusqu'au premier taux Kraken, puis Kraken.
  for (const [base, pair, kraken] of [
    ['BTC', 'BTCUSDT', 'PF_XBTUSD'],
    ['ETH', 'ETHUSDT', 'PF_ETHUSD'],
  ] as const) {
    const k = await data.funding(kraken);
    const first = k[0]?.t ?? now;
    const b = (await data.binanceFunding(pair, '2019-11', '2025-11')).filter((r) => r.t < first);
    const m = new Map<number, number>([...b, ...k].map((r) => [r.t, r.rate]));
    FUNDING.set(`${base}-USD`, m);
    if (base === 'BTC') FUNDING.set('BTC-PERP', m);
    FUNDING.set(kraken, m);
  }

  const cache = new Map<string, Bar[]>();
  const series = async (v: Variant): Promise<Map<string, Bar[]>> => {
    const out = new Map<string, Bar[]>();
    for (const s of v.spec.symbols) {
      // Alias : la jambe au comptant (BTC-SPOT, sans financement) et le perpétuel approché (BTC-PERP) lisent les cours Coinbase.
      const real = s === 'BTC-PERP' || s === 'BTC-SPOT' ? 'BTC-USD' : s;
      const key: DataKey = v.dataBySymbol?.[s] ?? v.spec.data;
      const k = `${key}|${real}`;
      if (!cache.has(k)) cache.set(k, (await data.load(key, [real])).get(real) ?? []);
      out.set(s, cache.get(k) as Bar[]);
    }
    return out;
  };

  const byId = new Map(ACCOUNTS.map((a) => [a.id, a]));
  const plan: Array<{ id: string; variants: Variant[] }> = [
    { id: 'a1-perps', variants: a1Variants(['BTC-USD', 'ETH-USD'], 'crypto1h') },
    { id: 'b2-crypto-tendance', variants: byId.get('b2-crypto-tendance')?.variants ?? [] },
    { id: 'b3-portage', variants: b3Variants('BTC-SPOT', 'BTC-PERP', { 'BTC-SPOT': 'crypto1h', 'BTC-PERP': 'crypto1h' }) },
    ...['b4-swing-etf', 'c1-sp500', 'c2-faber', 'c3-btc-eth-200j', 'c4-permanent'].map((id) => ({ id, variants: byId.get(id)?.variants ?? [] })),
  ];
  const end = zonedToUtc(dayOf(now), 0, PARIS);
  const lastYear = Number(dayOf(now).slice(0, 4));
  const years: number[] = [];
  for (let y = 2021; y <= lastYear; y++) years.push(y);

  const accounts: CovidAccount[] = [];
  for (const p of plan) {
    const rows: CovidRow[] = [];
    let chain = 1;
    for (const y of years) {
      const from = yearStart(y);
      const to = Math.min(end, yearStart(y + 1));
      let best = 0;
      if (p.variants.length > 1) {
        let bestScore = -Infinity;
        for (const [i, v] of p.variants.entries()) {
          const st = stats(runPortfolio(v.spec, await series(v), yearStart(2020), from), dayOf);
          if (score(st) > bestScore) {
            bestScore = score(st);
            best = i;
          }
        }
      }
      const v = p.variants[best] as Variant;
      const st = stats(runPortfolio(v.spec, await series(v), from, to), dayOf);
      rows.push({ year: y, label: v.label, returnPct: st.returnPct, maxDrawdownPct: st.maxDrawdownPct, trades: st.trades });
      chain *= 1 + st.returnPct / 100;
      console.log(`${p.id.padEnd(20)} ${y} ${v.label.padEnd(44)} ${st.returnPct >= 0 ? '+' : ''}${st.returnPct.toFixed(1).padStart(6)} %  baisse ${st.maxDrawdownPct.toFixed(1).padStart(5)} %  ${st.trades} trades`);
    }
    // Réglage final : le meilleur sur tout l'historique disponible (janvier 2020 → hier).
    let final = 0;
    if (p.variants.length > 1) {
      let bestScore = -Infinity;
      for (const [i, v] of p.variants.entries()) {
        const st = stats(runPortfolio(v.spec, await series(v), yearStart(2020), end), dayOf);
        if (score(st) > bestScore) {
          bestScore = score(st);
          final = i;
        }
      }
    }
    accounts.push({ id: p.id, rows, cumulativePct: (chain - 1) * 100, worstDrawdownPct: Math.max(...rows.map((r) => r.maxDrawdownPct)), final: { index: final, label: (p.variants[final] as Variant).label } });
    console.log(`${p.id.padEnd(20)} réglage pour le suivi : ${(p.variants[final] as Variant).label}`);
    console.log(`${p.id.padEnd(20)} cumul 2021 → aujourd'hui : ${((chain - 1) * 100).toFixed(1)} %`);
  }

  // Repères : achat-conservation du S&P 500 et du bitcoin, année par année.
  const context: Record<string, Record<number, number>> = {};
  for (const [label, key, sym] of [
    ['S&P 500 (SPY)', 'daily', 'SPY'],
    ['Bitcoin', 'crypto1d', 'BTC-USD'],
    ['Or (GLD)', 'daily', 'GLD'],
  ] as const) {
    const bars = (await data.load(key as DataKey, [sym])).get(sym) ?? [];
    context[label] = {};
    for (const y of years) {
      const inYear = bars.filter((b) => b.t >= yearStart(y) && b.t < Math.min(end, yearStart(y + 1)));
      const before = bars.filter((b) => b.t < yearStart(y)).at(-1);
      const last = inYear.at(-1);
      if (before && last) (context[label] as Record<number, number>)[y] = (last.c / before.c - 1) * 100;
    }
  }

  const out: CovidFile = { generatedAt: now, years, accounts, context, skipped: ['a2-orb-qqq', 'a3-or', 'a4-forex', 'b1-momentum-spx'] };
  writeJsonAtomic(join(dir, 'covid.json'), out);
  console.log(`page : ${writeArenaPage(dir)}`);
}

await main();
