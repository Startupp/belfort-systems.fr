/**
 * Données de marché gratuites (Yahoo Finance, barres d'une minute) et outils de calcul :
 * heures de Paris et de New York, séances, VWAP, efficacité de tendance, ATR, volatilité.
 */

import type { Http } from '../lib/http.ts';
import type { AssetClass, Bar } from './types.ts';

// ---------------------------------------------------------------------------
// Fuseaux horaires (Paris pour la fenêtre de trading, New York pour la Bourse US)
// ---------------------------------------------------------------------------

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export interface LocalTime {
  date: string;
  /** Minutes depuis minuit, heure locale. */
  minutes: number;
}

export function localTime(ms: number, tz: string): LocalTime {
  const parts = fmt(tz).formatToParts(new Date(ms));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

export const paris = (ms: number): LocalTime => localTime(ms, 'Europe/Paris');
export const newYork = (ms: number): LocalTime => localTime(ms, 'America/New_York');

export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Bourse US : 9 h 30 – 16 h, heure de New York. */
export function inUsSession(ms: number): boolean {
  const ny = newYork(ms).minutes;
  return ny >= 9 * 60 + 30 && ny < 16 * 60;
}

// ---------------------------------------------------------------------------
// Yahoo Finance
// ---------------------------------------------------------------------------

interface YahooChart {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null>; volume?: Array<number | null> }> };
    }> | null;
    error?: { description?: string } | null;
  };
}

/** Convertit une réponse « chart » en barres propres (minutes vides ou incohérentes ignorées). */
export function parseYahooChart(raw: unknown): Bar[] {
  const r = (raw as YahooChart)?.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const q = r?.indicators?.quote?.[0];
  if (!q) return [];
  const out: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    const v = q.volume?.[i] ?? 0;
    if ([o, h, l, c].some((x) => typeof x !== 'number' || !Number.isFinite(x) || x <= 0)) continue;
    if ((h as number) < (l as number)) continue;
    out.push({ t: (ts[i] as number) * 1000, o: o as number, h: h as number, l: l as number, c: c as number, v: typeof v === 'number' && v > 0 ? v : 0 });
  }
  return out;
}

export interface ScreenerQuote {
  symbol: string;
  price: number;
  volume: number;
  avgVolume: number;
}

export interface MarketData {
  /** Barres d'une minute entre deux instants (ms). */
  bars(symbol: string, fromMs: number, toMs: number): Promise<Bar[]>;
  /** Listes Yahoo du jour : « most_actives », « day_gainers »… (25 valeurs chacune). */
  screener?(ids: string[]): Promise<ScreenerQuote[]>;
}

export function createYahoo(http: Http, base = 'https://query1.finance.yahoo.com'): MarketData {
  return {
    async bars(symbol, fromMs, toMs) {
      // Yahoo limite l'historique 1 min à 7 jours par requête (et 30 jours en arrière).
      const out: Bar[] = [];
      const WEEK = 7 * 86_400_000 - 60_000;
      for (let a = fromMs; a < toMs; a += WEEK) {
        const b = Math.min(toMs, a + WEEK);
        const url = `${base}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&period1=${Math.floor(a / 1000)}&period2=${Math.floor(b / 1000)}&includePrePost=false`;
        out.push(...parseYahooChart(await http.getJson(url, { headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) desk-papier/1.0' } })));
      }
      // Dédoublonnage et tri.
      const seen = new Map<number, Bar>();
      for (const bar of out) seen.set(bar.t, bar);
      return [...seen.values()].sort((x, y) => x.t - y.t);
    },
    async screener(ids) {
      const out = new Map<string, ScreenerQuote>();
      for (const id of ids) {
        const raw = await http.getJson<{ finance?: { result?: Array<{ quotes?: Array<Record<string, unknown>> }> } }>(
          `${base}/v1/finance/screener/predefined/saved?scrIds=${encodeURIComponent(id)}&count=25&lang=en-US&region=US`,
          { headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) desk-papier/1.0' } },
        );
        for (const q of raw?.finance?.result?.[0]?.quotes ?? []) {
          const symbol = typeof q.symbol === 'string' ? q.symbol : '';
          const price = Number(q.regularMarketPrice);
          const volume = Number(q.regularMarketVolume);
          const avgVolume = Number(q.averageDailyVolume3Month);
          if (!/^[A-Z]{1,5}$/.test(symbol) || ![price, volume, avgVolume].every(Number.isFinite)) continue;
          out.set(symbol, { symbol, price, volume, avgVolume });
        }
      }
      return [...out.values()];
    },
  };
}

/** Filtres de l'étude ORB : prix ≥ 5 $, volume moyen ≥ 1 million de titres par jour. */
export function inPlayCandidates(quotes: ScreenerQuote[], exclude: Set<string>, max: number): string[] {
  return quotes
    .filter((q) => q.price >= 5 && q.avgVolume >= 1_000_000 && !exclude.has(q.symbol))
    .sort((a, b) => b.volume / b.avgVolume - a.volume / a.avgVolume)
    .slice(0, max)
    .map((q) => q.symbol);
}

// ---------------------------------------------------------------------------
// Indicateurs
// ---------------------------------------------------------------------------

/** VWAP cumulée et écart-type de (prix − VWAP), barre par barre. */
export function vwapSeries(bars: Bar[]): Array<{ vwap: number; sd: number }> {
  let pv = 0;
  let vol = 0;
  let n = 0;
  let sumD = 0;
  let sumD2 = 0;
  const out: Array<{ vwap: number; sd: number }> = [];
  for (const b of bars) {
    const typical = (b.h + b.l + b.c) / 3;
    // Forex et certaines cotes sans volume : pondération égale.
    const w = b.v > 0 ? b.v : 1;
    pv += typical * w;
    vol += w;
    const vwap = pv / vol;
    const d = b.c - vwap;
    n++;
    sumD += d;
    sumD2 += d * d;
    const varD = n > 1 ? Math.max(0, sumD2 / n - (sumD / n) ** 2) : 0;
    out.push({ vwap, sd: Math.sqrt(varD) });
  }
  return out;
}

/** Efficacité de Kaufman sur n barres : 1 = tendance pure, 0 = va-et-vient. */
export function efficiency(bars: Bar[], n = 30): number {
  if (bars.length < n + 1) return 0.5;
  const s = bars.slice(-n - 1);
  const net = Math.abs((s.at(-1) as Bar).c - (s[0] as Bar).c);
  let path = 0;
  for (let i = 1; i < s.length; i++) path += Math.abs((s[i] as Bar).c - (s[i - 1] as Bar).c);
  return path > 0 ? net / path : 0;
}

export function regimeOf(er: number): 'tendance' | 'range' | 'mixte' {
  return er >= 0.4 ? 'tendance' : er <= 0.25 ? 'range' : 'mixte';
}

/** Regroupe des barres par jour (date de la séance pour un fuseau donné). */
export function byDay(bars: Bar[], tz: string): Map<string, Bar[]> {
  const out = new Map<string, Bar[]>();
  for (const b of bars) {
    const d = localTime(b.t, tz).date;
    const arr = out.get(d);
    if (arr) arr.push(b);
    else out.set(d, [b]);
  }
  return out;
}

/** ATR journalier (moyenne des vraies amplitudes) à partir des barres de séance de plusieurs jours. */
export function dailyAtr(days: Bar[][]): number {
  const ranges: number[] = [];
  let prevClose: number | undefined;
  for (const d of days) {
    if (!d.length) continue;
    const hi = Math.max(...d.map((b) => b.h));
    const lo = Math.min(...d.map((b) => b.l));
    const tr = prevClose === undefined ? hi - lo : Math.max(hi - lo, Math.abs(hi - prevClose), Math.abs(lo - prevClose));
    ranges.push(tr);
    prevClose = (d.at(-1) as Bar).c;
  }
  return ranges.length ? ranges.reduce((a, b) => a + b, 0) / ranges.length : 0;
}

/**
 * « Zone de bruit » (Zarattini, Aziz & Barbon, 2024) : pour chaque minute après l'ancre de séance,
 * mouvement absolu moyen |prix / prix d'ancre − 1| sur les jours précédents.
 */
export function noiseProfile(days: Array<{ anchor: number; bars: Bar[]; anchorTime: number }>, maxMinutes: number): number[] {
  const sums = new Array<number>(maxMinutes + 1).fill(0);
  const counts = new Array<number>(maxMinutes + 1).fill(0);
  for (const d of days) {
    for (const b of d.bars) {
      const m = Math.round((b.t - d.anchorTime) / 60_000);
      if (m < 0 || m > maxMinutes) continue;
      sums[m] = (sums[m] as number) + Math.abs(b.c / d.anchor - 1);
      counts[m] = (counts[m] as number) + 1;
    }
  }
  // Moyenne, puis remplissage des trous par la dernière valeur connue.
  const out: number[] = [];
  let last = 0;
  for (let m = 0; m <= maxMinutes; m++) {
    const c = counts[m] as number;
    if (c > 0) last = (sums[m] as number) / c;
    out.push(last);
  }
  return out;
}

export function costBps(cls: AssetClass, costs: Record<AssetClass, { feeBps: number; slipBps: number }>): number {
  const c = costs[cls];
  return c.feeBps + c.slipBps;
}
