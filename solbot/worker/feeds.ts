/**
 * Cours pour le Worker de l'arène, par des requêtes courtes (rien que l'utile à chaque passage) :
 * Yahoo Finance (5 min et journalier, plus un appel « spark » groupé pour les derniers cours des ETF), Coinbase
 * (crypto au comptant), Kraken Futures (perpétuels : bougies, cours et financement), Kraken (cours au comptant).
 */

import { parseYahooChart } from '../src/desk/market.ts';
import type { Bar } from '../src/desk/types.ts';

const UA = { 'user-agent': 'Mozilla/5.0 (compatible; arene-papier/1.0)' };

async function json<T>(url: string): Promise<T> {
  // Délai court : un passage par minute, un service lent ne doit pas le bloquer.
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return (await r.json()) as T;
}

/**
 * Yahoo : barres de 5 min (`range` : 1d, 5d, 1mo), et l'heure de la dernière cotation (`asOf`, ms) : une barre n'est
 * finie que si elle se termine avant cette heure (l'or est publié avec 10 min de retard, la barre « en cours » a donc
 * l'air terminée à l'horloge).
 */
export async function yahoo5m(symbol: string, range: string): Promise<{ bars: Bar[]; asOf: number }> {
  const raw = await json<{ chart?: { result?: Array<{ meta?: { regularMarketTime?: number } }> } }>(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=${range}&includePrePost=false`);
  const bars = parseYahooChart(raw);
  const t = raw.chart?.result?.[0]?.meta?.regularMarketTime;
  return { bars, asOf: typeof t === 'number' && t > 0 ? t * 1000 : Math.max(0, ...bars.map((b) => b.t)) };
}

/** Yahoo : barres journalières, début normalisé à 9 h 30 (New York) par l'appelant. */
export async function yahooDaily(symbol: string, range: string): Promise<Bar[]> {
  return parseYahooChart(await json(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`));
}

/** Yahoo « spark » : dernier cours de plusieurs symboles en un appel. */
export async function yahooLast(symbols: string[]): Promise<Record<string, number>> {
  const raw = await json<Record<string, { close?: Array<number | null> }>>(`https://query1.finance.yahoo.com/v8/finance/spark?symbols=${symbols.map(encodeURIComponent).join(',')}&range=1d&interval=5m`);
  const out: Record<string, number> = {};
  for (const [s, v] of Object.entries(raw ?? {})) {
    const c = (v?.close ?? []).filter((x): x is number => typeof x === 'number' && x > 0).at(-1);
    if (c !== undefined) out[s] = c;
  }
  return out;
}

/** Coinbase : bougies (granularité en secondes : 3600 ou 86400), 300 au plus par appel. */
export async function coinbase(product: string, granularity: number, fromMs: number, toMs: number): Promise<Bar[]> {
  const out: Bar[] = [];
  const step = 300 * granularity * 1000;
  for (let a = fromMs; a < toMs; a += step) {
    const b = Math.min(toMs, a + step);
    const raw = await json<number[][]>(`https://api.exchange.coinbase.com/products/${product}/candles?granularity=${granularity}&start=${new Date(a).toISOString()}&end=${new Date(b).toISOString()}`);
    for (const [time, low, high, open, close, vol] of raw as Array<[number, number, number, number, number, number]>) {
      if ([low, high, open, close].every((x) => Number.isFinite(x) && x > 0)) out.push({ t: time * 1000, o: open, h: high, l: low, c: close, v: vol });
    }
  }
  return out.sort((x, y) => x.t - y.t);
}

/**
 * Kraken (comptant) : bougies d'une heure ou d'un jour (720 au plus, les plus récentes), en secours de Coinbase, qui
 * refuse souvent les adresses partagées de Cloudflare (erreur 429). Mêmes heures de début de bougie (UTC).
 */
export async function krakenOhlc(product: string, granularity: number, fromMs: number): Promise<Bar[]> {
  const pair = { 'BTC-USD': 'XBTUSD', 'ETH-USD': 'ETHUSD', 'SOL-USD': 'SOLUSD' }[product];
  if (!pair) throw new Error(`Kraken : paire inconnue ${product}`);
  const raw = await json<{ error?: string[]; result?: Record<string, unknown> }>(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${granularity / 60}&since=${Math.floor(fromMs / 1000) - 1}`);
  if (raw.error?.length) throw new Error(`Kraken : ${raw.error.join(', ')}`);
  const rows = Object.entries(raw.result ?? {}).find(([k]) => k !== 'last')?.[1] as Array<[number, string, string, string, string, string, string, number]> | undefined;
  return (rows ?? [])
    .map(([t, o, h, l, c, , v]) => ({ t: t * 1000, o: Number(o), h: Number(h), l: Number(l), c: Number(c), v: Number(v) }))
    .filter((b) => b.t >= fromMs && [b.o, b.h, b.l, b.c].every((x) => Number.isFinite(x) && x > 0));
}

/** Kraken Futures : bougies d'une heure d'un perpétuel. */
export async function krakenFutures1h(symbol: string, fromMs: number, toMs: number): Promise<Bar[]> {
  const raw = await json<{ candles?: Array<{ time: number; open: string; high: string; low: string; close: string; volume: string }> }>(
    `https://futures.kraken.com/api/charts/v1/trade/${symbol}/1h?from=${Math.floor(fromMs / 1000)}&to=${Math.floor(toMs / 1000)}`,
  );
  return (raw.candles ?? [])
    .map((c) => ({ t: c.time, o: Number(c.open), h: Number(c.high), l: Number(c.low), c: Number(c.close), v: Number(c.volume) }))
    .filter((b) => [b.o, b.h, b.l, b.c].every((x) => Number.isFinite(x) && x > 0));
}

/**
 * Kraken Futures : cours et financement de l'heure en cours (part du montant par heure) pour chaque perpétuel. Un appel
 * par symbole (la liste complète pèse ~130 Ko, un symbole ~600 octets).
 */
export async function krakenTickers(symbols: string[]): Promise<Record<string, { last: number; funding: number }>> {
  type T = { symbol: string; last?: number; markPrice?: number; relativeFundingRate?: number };
  const all = await Promise.all(symbols.map((s) => json<{ ticker?: T }>(`https://futures.kraken.com/derivatives/api/v3/tickers/${encodeURIComponent(s)}`)));
  const out: Record<string, { last: number; funding: number }> = {};
  for (const r of all) {
    const t = r.ticker;
    const last = t?.markPrice ?? t?.last;
    if (t && symbols.includes(t.symbol) && typeof last === 'number' && last > 0) out[t.symbol] = { last, funding: typeof t.relativeFundingRate === 'number' ? t.relativeFundingRate : 0 };
  }
  return out;
}

/** Kraken Futures : historique du financement (12 derniers mois), pour l'amorçage. */
export async function krakenFundingHistory(symbol: string, sinceMs: number): Promise<Array<[number, number]>> {
  const raw = await json<{ rates?: Array<{ timestamp: string; relativeFundingRate: number }> }>(`https://futures.kraken.com/derivatives/api/v4/historicalfundingrates?symbol=${symbol}`);
  return (raw.rates ?? []).map((r): [number, number] => [Date.parse(r.timestamp), r.relativeFundingRate]).filter(([t, r]) => t >= sinceMs && Number.isFinite(r));
}

/** Kraken (comptant) : derniers cours de BTC, ETH, SOL en dollars. */
export async function krakenSpot(): Promise<Record<string, number>> {
  const raw = await json<{ result?: Record<string, { c?: [string, string] }> }>('https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,SOLUSD');
  const out: Record<string, number> = {};
  for (const [pair, v] of Object.entries(raw.result ?? {})) {
    const px = Number(v.c?.[0]);
    if (!(px > 0)) continue;
    if (pair.includes('XBT')) out['BTC-USD'] = px;
    else if (pair.includes('ETH')) out['ETH-USD'] = px;
    else if (pair.includes('SOL')) out['SOL-USD'] = px;
  }
  return out;
}
