/**
 * Données de l'arène, mises en cache hors du dépôt (data/arena-cache, ignoré par git) :
 * - Yahoo Finance : barres de 5 min (60 derniers jours) pour les actions, SPY et l'or (GC=F), barres journalières (20 ans) ;
 * - Coinbase Exchange (API publique, sans clé) : BTC et ETH en 1 min, 15 min et 1 h. Les cours de Revolut X ne sont
 *   accessibles qu'avec une clé signée : Coinbase sert de référence de prix, les frais restent ceux de Revolut X.
 * Les barres pas encore terminées sont écartées.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHttp } from '../lib/http.ts';
import type { Http } from '../lib/http.ts';
import { writeJsonAtomic } from '../lib/store.ts';
import { createYahoo, localTime, parseYahooChart } from '../desk/market.ts';
import type { Bar } from '../desk/types.ts';
import type { DataKey } from './portfolios.ts';
import { NY, zonedToUtc } from './strategies.ts';

interface Cached {
  fetchedAt: number;
  bars: Bar[];
}

const UA = { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) arene-papier/1.0' };

export interface DataOptions {
  dir: string;
  /** Âge maximal du cache avant nouvelle requête (ms). */
  maxAgeMs: number;
  now?: number;
  http?: Http;
  log?: (msg: string) => void;
}

/** Spécification des séries par jeu de données. */
const SPEC: Record<DataKey, { source: 'yahoo' | 'yahoo1m' | 'coinbase'; interval: string; barMs: number; days: number }> = {
  us1m: { source: 'yahoo1m', interval: '1m', barMs: 60_000, days: 29 },
  us5m: { source: 'yahoo', interval: '5m', barMs: 5 * 60_000, days: 60 },
  spy5m: { source: 'yahoo', interval: '5m', barMs: 5 * 60_000, days: 60 },
  gold5m: { source: 'yahoo', interval: '5m', barMs: 5 * 60_000, days: 60 },
  daily: { source: 'yahoo', interval: '1d', barMs: 390 * 60_000, days: 365 * 20 },
  crypto1h: { source: 'coinbase', interval: '3600', barMs: 3_600_000, days: 730 },
  crypto15m: { source: 'coinbase', interval: '900', barMs: 900_000, days: 365 },
  btc1m: { source: 'coinbase', interval: '60', barMs: 60_000, days: 60 },
};

export function barMsOf(key: DataKey): number {
  return SPEC[key].barMs;
}

function merge(a: Bar[], b: Bar[]): Bar[] {
  const m = new Map<number, Bar>();
  for (const x of a) m.set(x.t, x);
  for (const x of b) m.set(x.t, x);
  return [...m.values()].sort((x, y) => x.t - y.t);
}

/** Barres journalières Yahoo : début normalisé à 9 h 30 (New York) pour que la clôture tombe à 16 h. */
export function normalizeDaily(bars: Bar[]): Bar[] {
  return bars.map((b) => ({ ...b, t: zonedToUtc(localTime(b.t + 3 * 3_600_000, NY).date, 570, NY) }));
}

export function createArenaData(opts: DataOptions) {
  const http =
    opts.http ??
    createHttp({ minIntervalMsByHost: { 'query1.finance.yahoo.com': 800, 'api.exchange.coinbase.com': 260 }, timeoutMs: 20_000, retries: 3 });
  const now = opts.now ?? Date.now();
  const log = opts.log ?? (() => {});
  const file = (key: DataKey, sym: string): string => join(opts.dir, `${key}-${sym.replace(/[^A-Za-z0-9-]/g, '_')}.json`);

  async function yahoo(key: DataKey, sym: string, old: Bar[]): Promise<Bar[]> {
    const s = SPEC[key];
    const range = s.interval === '1d' ? '20y' : '60d';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${s.interval}&range=${range}&includePrePost=false`;
    let bars = parseYahooChart(await http.getJson(url, { headers: UA }));
    if (s.interval === '1d') bars = normalizeDaily(bars);
    return merge(old, bars);
  }

  /** Yahoo 1 min : 30 jours d'historique au plus, par tranches de 7 jours ; seules les barres manquantes sont demandées. */
  async function yahoo1m(key: DataKey, sym: string, old: Bar[]): Promise<Bar[]> {
    const from = Math.max(old.length ? (old.at(-1) as Bar).t + 60_000 : 0, now - SPEC[key].days * 86_400_000);
    return merge(old, await createYahoo(http).bars(sym, from, now));
  }

  async function coinbase(key: DataKey, sym: string, old: Bar[]): Promise<Bar[]> {
    const s = SPEC[key];
    const g = Number(s.interval);
    const step = 300 * g * 1000;
    let from = old.length ? (old.at(-1) as Bar).t + g * 1000 : now - s.days * 86_400_000;
    from = Math.max(from, now - s.days * 86_400_000);
    const out: Bar[] = [];
    for (let a = from; a < now; a += step) {
      const b = Math.min(now, a + step);
      const url = `https://api.exchange.coinbase.com/products/${sym}/candles?granularity=${g}&start=${new Date(a).toISOString()}&end=${new Date(b).toISOString()}`;
      const raw = (await http.getJson<number[][]>(url, { headers: UA })) ?? [];
      for (const r of raw) {
        const [time, low, high, open, close, vol] = r as [number, number, number, number, number, number];
        if (![low, high, open, close].every((x) => Number.isFinite(x) && x > 0)) continue;
        out.push({ t: time * 1000, o: open, h: high, l: low, c: close, v: vol });
      }
    }
    return merge(old, out);
  }

  return {
    async load(key: DataKey, symbols: string[]): Promise<Map<string, Bar[]>> {
      const s = SPEC[key];
      const res = new Map<string, Bar[]>();
      for (const sym of symbols) {
        const f = file(key, sym);
        const cached: Cached | null = existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Cached) : null;
        let bars = cached?.bars ?? [];
        if (!cached || now - cached.fetchedAt > opts.maxAgeMs) {
          try {
            bars = s.source === 'yahoo' ? await yahoo(key, sym, bars) : s.source === 'yahoo1m' ? await yahoo1m(key, sym, bars) : await coinbase(key, sym, bars);
            writeJsonAtomic(f, { fetchedAt: now, bars } satisfies Cached);
            log(`${key} ${sym} : ${bars.length} barres`);
          } catch (e) {
            log(`${key} ${sym} : indisponible (${e instanceof Error ? e.message : String(e)}), cache conservé`);
          }
        }
        // Barres pas encore terminées : écartées.
        res.set(sym, bars.filter((b) => b.t + s.barMs <= now));
      }
      return res;
    },
  };
}
