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
  /** Profondeur d'historique demandée, en jours, par jeu de données (défaut : le maximum utile au rejeu). */
  historyDays?: Partial<Record<DataKey, number>>;
}

/** Spécification des séries par jeu de données. */
const SPEC: Record<DataKey, { source: 'yahoo' | 'yahoo1m' | 'coinbase' | 'kraken'; interval: string; barMs: number; days: number }> = {
  us1m: { source: 'yahoo1m', interval: '1m', barMs: 60_000, days: 29 },
  y5m: { source: 'yahoo', interval: '5m', barMs: 5 * 60_000, days: 60 },
  crypto1d: { source: 'coinbase', interval: '86400', barMs: 86_400_000, days: 365 * 8 },
  kfut1h: { source: 'kraken', interval: '1h', barMs: 3_600_000, days: 400 },
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
    createHttp({ minIntervalMsByHost: { 'query1.finance.yahoo.com': 800, 'api.exchange.coinbase.com': 260, 'futures.kraken.com': 400 }, timeoutMs: 20_000, retries: 3 });
  const now = opts.now ?? Date.now();
  const log = opts.log ?? (() => {});
  const days = (key: DataKey): number => opts.historyDays?.[key] ?? SPEC[key].days;
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
    const from = Math.max(old.length ? (old.at(-1) as Bar).t + 60_000 : 0, now - days(key) * 86_400_000);
    return merge(old, await createYahoo(http).bars(sym, from, now));
  }

  async function coinbase(key: DataKey, sym: string, old: Bar[]): Promise<Bar[]> {
    const s = SPEC[key];
    const g = Number(s.interval);
    const step = 300 * g * 1000;
    let from = old.length ? (old.at(-1) as Bar).t + g * 1000 : now - days(key) * 86_400_000;
    from = Math.max(from, now - days(key) * 86_400_000);
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

  /** Kraken Futures (perpétuels) : bougies d'une heure, par tranches de 1 000 h. */
  async function kraken(key: DataKey, sym: string, old: Bar[]): Promise<Bar[]> {
    const step = 1000 * 3_600_000;
    const from = Math.max(old.length ? (old.at(-1) as Bar).t + 3_600_000 : 0, now - days(key) * 86_400_000);
    const out: Bar[] = [];
    for (let a = from; a < now; a += step) {
      const b = Math.min(now, a + step);
      const url = `https://futures.kraken.com/api/charts/v1/trade/${sym}/1h?from=${Math.floor(a / 1000)}&to=${Math.floor(b / 1000)}`;
      const raw = await http.getJson<{ candles?: Array<{ time: number; open: string; high: string; low: string; close: string; volume: string }> }>(url, { headers: UA });
      for (const c of raw?.candles ?? []) {
        const bar = { t: c.time, o: Number(c.open), h: Number(c.high), l: Number(c.low), c: Number(c.close), v: Number(c.volume) };
        if ([bar.o, bar.h, bar.l, bar.c].every((x) => Number.isFinite(x) && x > 0)) out.push(bar);
      }
    }
    return merge(old, out);
  }

  return {
    /** Taux de financement horaire d'un perpétuel Kraken (part du montant par heure ; positif = les acheteurs paient). */
    async funding(sym: string): Promise<Array<{ t: number; rate: number }>> {
      const f = join(opts.dir, `funding-${sym}.json`);
      const cached = existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as { fetchedAt: number; rates: Array<{ t: number; rate: number }> }) : null;
      if (cached && now - cached.fetchedAt <= opts.maxAgeMs) return cached.rates;
      try {
        const raw = await http.getJson<{ rates?: Array<{ timestamp: string; relativeFundingRate: number }> }>(`https://futures.kraken.com/derivatives/api/v4/historicalfundingrates?symbol=${sym}`, { headers: UA });
        const rates = (raw?.rates ?? []).map((r) => ({ t: Date.parse(r.timestamp), rate: r.relativeFundingRate })).filter((r) => Number.isFinite(r.t) && Number.isFinite(r.rate));
        writeJsonAtomic(f, { fetchedAt: now, rates });
        log(`financement ${sym} : ${rates.length} heures`);
        return rates;
      } catch (e) {
        log(`financement ${sym} : indisponible (${e instanceof Error ? e.message : String(e)})`);
        return cached?.rates ?? [];
      }
    },
    async load(key: DataKey, symbols: string[]): Promise<Map<string, Bar[]>> {
      const s = SPEC[key];
      const res = new Map<string, Bar[]>();
      for (const sym of symbols) {
        const f = file(key, sym);
        const cached: Cached | null = existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Cached) : null;
        let bars = cached?.bars ?? [];
        if (!cached || now - cached.fetchedAt > opts.maxAgeMs) {
          try {
            bars =
              s.source === 'yahoo' ? await yahoo(key, sym, bars) : s.source === 'yahoo1m' ? await yahoo1m(key, sym, bars) : s.source === 'kraken' ? await kraken(key, sym, bars) : await coinbase(key, sym, bars);
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
