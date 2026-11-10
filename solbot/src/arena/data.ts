/**
 * Données de l'arène, mises en cache hors du dépôt (data/arena-cache, ignoré par git) :
 * - Yahoo Finance : barres de 5 min (60 derniers jours) pour les actions, SPY et l'or (GC=F), barres journalières (20 ans) ;
 * - Coinbase Exchange (API publique, sans clé) : BTC et ETH en 1 min, 15 min et 1 h. Les cours de Revolut X ne sont
 *   accessibles qu'avec une clé signée : Coinbase sert de référence de prix, les frais restent ceux de Revolut X.
 * Les barres pas encore terminées sont écartées (Yahoo en 1 et 5 min : voir `finishedBars`).
 */

import { existsSync, readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { createHttp } from '../lib/http.ts';
import type { Http } from '../lib/http.ts';
import { writeJsonAtomic } from '../lib/store.ts';
import { localTime, parseYahooChart, yahooQuoteTime, yahooSessionEnds } from '../desk/market.ts';
import type { Bar } from '../desk/types.ts';
import type { DataKey } from './portfolios.ts';
import { NY, zonedToUtc } from './strategies.ts';

interface Cached {
  fetchedAt: number;
  /**
   * Yahoo en 1 et 5 min : les barres gardées sont terminées à cette heure (dernière cotation lue, au plus l'heure de la
   * requête). Absente des fichiers écrits avant ce contrôle, qui pouvaient garder des points « fantômes » et des barres
   * en cours.
   */
  asOf?: number;
  bars: Bar[];
}

/** Ce que rapporte une lecture : les barres, et pour Yahoo en 1 et 5 min, l'heure jusqu'à laquelle elles sont finies. */
interface Fetched {
  bars: Bar[];
  asOf?: number;
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

/** Séries Yahoo en 1 et 5 min (le journalier est gardé tel quel). */
function yahooIntraday(key: DataKey): boolean {
  const s = SPEC[key];
  return s.source === 'yahoo1m' || (s.source === 'yahoo' && s.interval !== '1d');
}

/**
 * Barres Yahoo terminées, même règle que le Worker. Yahoo ajoute aux barres un point de cotation : en séance, à l'heure
 * de la dernière cotation, hors de la grille (ex. 20:10:59) ; après la clôture, à la fin de la séance (16 h pile à New
 * York), sur la grille, même quand la cotation est plus tardive (déclarations tardives à la Bourse de New York : 16:02:05).
 * Et la barre en cours, qui a l'air finie à l'horloge quand les cours sont publiés en retard (l'or : 10 min). Une barre
 * compte si elle est alignée sur la grille, se termine au plus tard à `asOf` (heure de la cotation, ou de la requête) et
 * ne commence pas à une fin de séance (`sessionEnds`, connues seulement à la lecture).
 */
function finishedBars(bars: Bar[], barMs: number, asOf: number, sessionEnds: ReadonlySet<number> = new Set()): Bar[] {
  return bars.filter((b) => b.t % barMs === 0 && b.t + barMs <= asOf && !sessionEnds.has(b.t));
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

  /**
   * Réponse « chart » de Yahoo : barres, heure de la dernière cotation (à défaut, début de la dernière barre, comme le
   * Worker) et fins des séances listées.
   */
  async function chart(url: string): Promise<{ bars: Bar[]; quote: number; sessionEnds: number[] }> {
    const raw = await http.getJson(url, { headers: UA });
    const bars = parseYahooChart(raw);
    return { bars, quote: yahooQuoteTime(raw) ?? bars.reduce((m, b) => Math.max(m, b.t), 0), sessionEnds: yahooSessionEnds(raw) };
  }

  async function yahoo(key: DataKey, sym: string, old: Bar[]): Promise<Fetched> {
    const s = SPEC[key];
    const range = s.interval === '1d' ? '20y' : '60d';
    const r = await chart(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${s.interval}&range=${range}&includePrePost=false`);
    if (s.interval === '1d') return { bars: merge(old, normalizeDaily(r.bars)) };
    const asOf = Math.min(r.quote, now);
    return { bars: merge(old, finishedBars(r.bars, s.barMs, asOf, new Set(r.sessionEnds))), asOf };
  }

  /**
   * Yahoo 1 min : 30 jours d'historique au plus, par tranches de 7 jours ; seules les barres manquantes sont demandées,
   * à partir de la minute qui suit la dernière barre finie (Yahoo ne renvoie que les barres qui commencent à `period1` ou après).
   */
  async function yahoo1m(key: DataKey, sym: string, old: Bar[]): Promise<Fetched> {
    const from = Math.max(old.length ? (old.at(-1) as Bar).t + 60_000 : 0, now - days(key) * 86_400_000);
    const WEEK = 7 * 86_400_000 - 60_000;
    const got: Bar[] = [];
    const sessionEnds = new Set<number>();
    let quote = 0;
    for (let a = from; a < now; a += WEEK) {
      const b = Math.min(now, a + WEEK);
      const r = await chart(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&period1=${Math.floor(a / 1000)}&period2=${Math.floor(b / 1000)}&includePrePost=false`);
      got.push(...r.bars);
      for (const e of r.sessionEnds) sessionEnds.add(e);
      quote = Math.max(quote, r.quote);
    }
    const asOf = Math.min(quote, now);
    return { bars: merge(old, finishedBars(got, SPEC[key].barMs, asOf, sessionEnds)), asOf };
  }

  async function coinbase(key: DataKey, sym: string, old: Bar[]): Promise<Bar[]> {
    const s = SPEC[key];
    const g = Number(s.interval);
    const step = 300 * g * 1000;
    const start = now - days(key) * 86_400_000;
    let from = old.length ? (old.at(-1) as Bar).t + g * 1000 : start;
    from = Math.max(from, start);
    // Plages à demander : l'historique manquant au début (quand on demande plus loin que le cache), puis la suite.
    const ranges: Array<[number, number]> = [];
    if (old.length && (old[0] as Bar).t - g * 1000 > start) ranges.push([start, (old[0] as Bar).t]);
    ranges.push([from, now]);
    const out: Bar[] = [];
    for (const [ra, rb] of ranges) for (let a = ra; a < rb; a += step) {
      const b = Math.min(rb, a + step);
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

  /**
   * Historique public des taux de financement de Binance (fichiers mensuels, un taux toutes les 8 h) ramené à l'heure :
   * un taux payé à T pour la période de `h` heures vaut taux / h pour chacune de ces heures.
   */
  async function binanceFunding(pair: string, fromMonth: string, toMonth: string): Promise<Array<{ t: number; rate: number }>> {
    const f = join(opts.dir, `binance-funding-${pair}-${fromMonth}-${toMonth}.json`);
    if (existsSync(f)) return (JSON.parse(readFileSync(f, 'utf8')) as { rates: Array<{ t: number; rate: number }> }).rates;
    const out: Array<{ t: number; rate: number }> = [];
    const H = 3_600_000;
    for (let d = new Date(`${fromMonth}-01T00:00:00Z`); d.toISOString().slice(0, 7) <= toMonth; d.setUTCMonth(d.getUTCMonth() + 1)) {
      const ym = d.toISOString().slice(0, 7);
      const url = `https://data.binance.vision/data/futures/um/monthly/fundingRate/${pair}/${pair}-fundingRate-${ym}.zip`;
      const res = await fetch(url, { headers: UA });
      if (!res.ok) {
        log(`financement Binance ${pair} ${ym} : ${res.status}`);
        continue;
      }
      const csv = unzipFirst(new Uint8Array(await res.arrayBuffer()));
      for (const line of csv.split('\n').slice(1)) {
        const [time, hours, rate] = line.split(',').map(Number) as [number, number, number];
        if (!Number.isFinite(time) || !Number.isFinite(rate) || !(hours > 0)) continue;
        const end = Math.round(time / H) * H;
        for (let k = 1; k <= hours; k++) out.push({ t: end - k * H, rate: rate / hours });
      }
    }
    out.sort((a, b) => a.t - b.t);
    writeJsonAtomic(f, { rates: out });
    log(`financement Binance ${pair} : ${out.length} heures (${fromMonth} → ${toMonth})`);
    return out;
  }

  return {
    binanceFunding,
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
      const intraday = yahooIntraday(key);
      const res = new Map<string, Bar[]>();
      for (const sym of symbols) {
        const f = file(key, sym);
        const cached: Cached | null = existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Cached) : null;
        let bars = cached?.bars ?? [];
        // Yahoo en 1 et 5 min : seulement les barres finies à la dernière lecture. Un fichier sans `asOf` date d'avant ce
        // contrôle : ses points hors de la grille et sa barre en cours sont écartés ici, puis il est relu en entier (le point
        // ajouté après la clôture tombe sur la grille et ne se reconnaît qu'avec la réponse de Yahoo ; en 1 min, les barres
        // lues en cours n'étaient jamais redemandées).
        const legacy = intraday && cached !== null && cached.asOf === undefined;
        if (intraday && cached) bars = finishedBars(bars, s.barMs, cached.asOf ?? cached.fetchedAt);
        // Cache trop court vers le passé (on demande plus d'historique qu'il n'en contient) : on le complète.
        const tooShort = s.source !== 'yahoo' && bars.length > 0 && (bars[0] as Bar).t > now - days(key) * 86_400_000 + 2 * 86_400_000;
        if (!cached || tooShort || legacy || now - cached.fetchedAt > opts.maxAgeMs) {
          try {
            const old = legacy ? [] : bars;
            const got: Fetched =
              s.source === 'yahoo' ? await yahoo(key, sym, old) : s.source === 'yahoo1m' ? await yahoo1m(key, sym, old) : { bars: s.source === 'kraken' ? await kraken(key, sym, old) : await coinbase(key, sym, old) };
            if (legacy && !got.bars.length) throw new Error('aucune barre reçue');
            // Ancien fichier : remplacé sur toute la période relue, gardé avant (historique que Yahoo ne donne plus).
            bars = legacy ? merge(bars.filter((b) => b.t < (got.bars[0] as Bar).t), got.bars) : got.bars;
            writeJsonAtomic(f, { fetchedAt: now, asOf: got.asOf === undefined ? undefined : Math.max(got.asOf, cached?.asOf ?? 0), bars } satisfies Cached);
            log(`${key} ${sym} : ${bars.length} barres${legacy ? ' (ancien cache relu en entier)' : ''}`);
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

/** Premier fichier d'une archive zip (méthode « deflate » ou sans compression), via le répertoire central. */
export function unzipFirst(buf: Uint8Array): string {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip : fin de répertoire introuvable');
  const cd = dv.getUint32(eocd + 16, true);
  if (dv.getUint32(cd, true) !== 0x02014b50) throw new Error('zip : répertoire central illisible');
  const method = dv.getUint16(cd + 10, true);
  const size = dv.getUint32(cd + 20, true);
  const local = dv.getUint32(cd + 42, true);
  const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
  const data = buf.subarray(start, start + size);
  const raw = method === 8 ? inflateRawSync(data) : data;
  return new TextDecoder().decode(raw);
}
