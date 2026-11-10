/**
 * Stratégies de l'arène : versions fidèles de stratégies publiées, plus des témoins au hasard.
 * Chaque fabrique renvoie une stratégie neuve (état propre) ; les indicateurs sont calculés une fois,
 * au premier appel, et ne lisent jamais une barre future (indicateur en i = barres 0..i).
 */

import { fastOffsets, localTime } from '../desk/market.ts';
import type { Bar } from '../desk/types.ts';
import type { Intent, Position, Strategy, StrategyView } from './engine.ts';

// ---------------------------------------------------------------------------
// Outils : heures locales, conversions, indicateurs
// ---------------------------------------------------------------------------

export interface Clock {
  date: string;
  /** Minutes depuis minuit, heure locale. */
  min: number;
}

const clockCache = new Map<string, WeakMap<Bar[], Clock[]>>();
/** Heure locale de chaque barre (mise en cache par série). */
export function clocks(bars: Bar[], tz: string): Clock[] {
  let byTz = clockCache.get(tz);
  if (!byTz) clockCache.set(tz, (byTz = new WeakMap()));
  let c = byTz.get(bars);
  if (!c) {
    c = bars.map((b) => {
      const l = localTime(b.t, tz);
      return { date: l.date, min: l.minutes };
    });
    byTz.set(bars, c);
  }
  return c;
}

export const NY = 'America/New_York';
export const PARIS = 'Europe/Paris';

/** Instant UTC (ms) d'une heure locale donnée (date AAAA-MM-JJ, minutes depuis minuit). */
export function zonedToUtc(date: string, minutes: number, tz: string): number {
  const base = Date.parse(`${date}T00:00:00Z`) + minutes * 60_000;
  // Fuseaux des marchés suivis : seulement leurs deux décalages, dans le même ordre que la recherche complète ci-dessous
  // (heure ambiguë au changement d'heure : même réponse ; heure inexistante : même erreur).
  const offs = fastOffsets(tz);
  if (offs) {
    for (const off of offs) {
      const t = base - off * 60_000;
      const l = localTime(t, tz);
      if (l.date === date && l.minutes === minutes) return t;
    }
    throw new Error(`heure locale introuvable : ${date} ${minutes} (${tz})`);
  }
  for (let off = -14 * 60; off <= 14 * 60; off += 15) {
    const t = base - off * 60_000;
    const l = localTime(t, tz);
    if (l.date === date && l.minutes === minutes) return t;
  }
  throw new Error(`heure locale introuvable : ${date} ${minutes} (${tz})`);
}

export function sma(x: number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    s += x[i] as number;
    if (i >= n) s -= x[i - n] as number;
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

export function ema(x: number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  const k = 2 / (n + 1);
  let e = NaN;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] as number;
    e = Number.isNaN(e) ? v : v * k + e * (1 - k);
    if (i >= n - 1) out[i] = e;
  }
  return out;
}

export function stdev(x: number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  for (let i = n - 1; i < x.length; i++) {
    let m = 0;
    for (let j = i - n + 1; j <= i; j++) m += x[j] as number;
    m /= n;
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += ((x[j] as number) - m) ** 2;
    out[i] = Math.sqrt(v / n);
  }
  return out;
}

/** RSI de Wilder. */
export function rsi(closes: number[], n: number): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  let up = 0;
  let dn = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = (closes[i] as number) - (closes[i - 1] as number);
    const u = Math.max(0, d);
    const w = Math.max(0, -d);
    if (i <= n) {
      up += u / n;
      dn += w / n;
    } else {
      up = (up * (n - 1) + u) / n;
      dn = (dn * (n - 1) + w) / n;
    }
    if (i >= n) out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
  }
  return out;
}

/** ATR de Wilder sur les barres elles-mêmes. */
export function atr(bars: Bar[], n: number): number[] {
  const out = new Array<number>(bars.length).fill(NaN);
  let a = NaN;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i] as Bar;
    const pc = i > 0 ? (bars[i - 1] as Bar).c : b.c;
    const tr = Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
    if (i < n) a = Number.isNaN(a) ? tr : a + tr;
    if (i === n - 1) a = a / n;
    else if (i >= n) a = (a * (n - 1) + tr) / n;
    if (i >= n - 1) out[i] = a;
  }
  return out;
}

/** Plus haut des n barres précédentes (barre courante exclue). */
export function priorMax(bars: Bar[], n: number): number[] {
  return bars.map((_, i) => (i < n ? NaN : Math.max(...bars.slice(i - n, i).map((b) => b.h))));
}
export function priorMin(bars: Bar[], n: number): number[] {
  return bars.map((_, i) => (i < n ? NaN : Math.min(...bars.slice(i - n, i).map((b) => b.l))));
}

/** Petit générateur pseudo-aléatoire reproductible (mulberry32), graine = texte. */
export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  let a = (h << 13) | (h >>> 19);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Séances US en barres de 5 min
// ---------------------------------------------------------------------------

export interface UsDay {
  date: string;
  /** Indices [start, end) des barres de la séance 9 h 30 – 16 h. */
  start: number;
  end: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Instant de la clôture (16 h, New York). */
  closeT: number;
}

/** Découpe une série 5 min en séances US (barres 9 h 30 – 15 h 55 seulement). */
export function usDays(bars: Bar[]): { days: UsDay[]; dayOf: Int32Array } {
  const ck = clocks(bars, NY);
  const days: UsDay[] = [];
  const dayOf = new Int32Array(bars.length).fill(-1);
  for (let i = 0; i < bars.length; i++) {
    const c = ck[i] as Clock;
    if (c.min < 570 || c.min >= 960) continue;
    const b = bars[i] as Bar;
    let d = days.at(-1);
    if (!d || d.date !== c.date) {
      d = { date: c.date, start: i, end: i + 1, open: b.o, high: b.h, low: b.l, close: b.c, volume: 0, closeT: zonedToUtc(c.date, 960, NY) };
      days.push(d);
    }
    d.end = i + 1;
    d.high = Math.max(d.high, b.h);
    d.low = Math.min(d.low, b.l);
    d.close = b.c;
    d.volume += b.v;
    dayOf[i] = days.length - 1;
  }
  return { days, dayOf };
}

const posOn = (v: StrategyView, sym: string): Position | undefined => v.positions.find((p) => p.symbol === sym);
const pendingOn = (v: StrategyView, sym: string): boolean => v.pending.some((o) => o.intent.symbol === sym);
const bar = (v: StrategyView, sym: string): Bar | undefined => {
  const i = v.idx.get(sym) ?? -1;
  return i >= 0 ? v.series.get(sym)?.[i] : undefined;
};

// ---------------------------------------------------------------------------
// 1. ORB 5 min sur actions « en jeu » (Zarattini, Barbon & Aziz, 2024)
// ---------------------------------------------------------------------------

/**
 * Chaque jour, à 9 h 35 (New York) : actions à prix ≥ 5 $, volume moyen ≥ 1 M, ATR(14 j) ≥ 0,50 $, volume relatif
 * des 5 premières minutes ≥ 100 % ; les `top` plus fortes. Première bougie de 5 min haussière → ordre d'achat stop au
 * plus haut du range ; baissière → vente stop au plus bas. Stop à 10 % de l'ATR(14 j). Sortie à la clôture. Risque 1 %.
 * `history` (barres de 5 min) : sert aux volumes, à l'ATR et au range d'ouverture (les volumes à la minute de Yahoo
 * contiennent des valeurs aberrantes) ; la série du portefeuille (1 ou 5 min) sert à l'exécution.
 */
export function orbStudy(opts: { symbols: string[]; top?: number; risk?: number; history?: ReadonlyMap<string, Bar[]> }): Strategy {
  const top = opts.top ?? 20;
  const risk = opts.risk ?? 0.01;
  type DayStat = { date: string; high: number; low: number; close: number; volume: number; or?: { o: number; h: number; l: number; c: number; v: number } };
  type Prior = { atr: number; vol: number; orVol: number };
  let pre: Map<string, { days: UsDay[]; dayOf: Int32Array; stat: Map<string, DayStat>; prior: Map<string, Prior> }> | undefined;
  const done = new Set<string>();
  const statsOf = (bars: Bar[]): DayStat[] => {
    const ck = clocks(bars, NY);
    return usDays(bars).days.map((d) => {
      const orb = bars.slice(d.start, d.end).filter((_, j) => (ck[d.start + j] as Clock).min < 575);
      const full = orb.length > 0 && (ck[d.start] as Clock).min === 570;
      return {
        date: d.date,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volume,
        or: full ? { o: (orb[0] as Bar).o, h: Math.max(...orb.map((b) => b.h)), l: Math.min(...orb.map((b) => b.l)), c: (orb.at(-1) as Bar).c, v: orb.reduce((a, b) => a + b.v, 0) } : undefined,
      };
    });
  };
  // Moyenne des 14 séances précédentes (au moins 10 valeurs connues).
  const mean14 = (x: number[], k: number): number => {
    const w = x.slice(Math.max(0, k - 14), k).filter((y) => Number.isFinite(y));
    return w.length >= 10 ? w.reduce((a, b) => a + b, 0) / w.length : NaN;
  };
  return {
    onBar(v) {
      if (!pre) {
        pre = new Map();
        for (const s of opts.symbols) {
          const bars = v.series.get(s) ?? [];
          const all = statsOf([...(opts.history?.get(s) ?? bars)]).filter((d) => d.or !== undefined || d.volume > 0);
          const tr = all.map((d, k) => (k === 0 ? d.high - d.low : Math.max(d.high - d.low, Math.abs(d.high - (all[k - 1] as DayStat).close), Math.abs(d.low - (all[k - 1] as DayStat).close))));
          const vols = all.map((d) => d.volume);
          const orVols = all.map((d) => d.or?.v ?? NaN);
          const prior = new Map<string, Prior>();
          all.forEach((d, k) => prior.set(d.date, { atr: mean14(tr, k), vol: mean14(vols, k), orVol: mean14(orVols, k) }));
          pre.set(s, { ...usDays(bars), stat: new Map(all.map((d) => [d.date, d])), prior });
        }
      }
      const out: Intent[] = [];
      const cands: Array<{ s: string; rv: number; d: UsDay; atr: number; o: number; h: number; l: number; c: number }> = [];
      for (const s of v.fresh) {
        const p = pre.get(s);
        if (!p) continue;
        const bars = v.series.get(s) as Bar[];
        const i = v.idx.get(s) as number;
        const k = p.dayOf[i] as number;
        if (k < 0) continue;
        const d = p.days[k] as UsDay;
        const ck = clocks(bars, NY);
        const barMin = i + 1 < bars.length && ck[i + 1]?.date === d.date ? Math.round(((bars[i + 1] as Bar).t - (bars[i] as Bar).t) / 60_000) : i > d.start ? Math.round(((bars[i] as Bar).t - (bars[i - 1] as Bar).t) / 60_000) : 5;
        if ((ck[i] as Clock).min + barMin !== 575) continue;
        const key = `${s}|${d.date}`;
        if (done.has(key)) continue;
        done.add(key);
        const st = p.stat.get(d.date);
        const pr = p.prior.get(d.date);
        if (!st?.or || !pr) continue;
        const rv = st.or.v / pr.orVol;
        if (!(st.or.c >= 5) || !(pr.vol >= 1e6) || !(pr.atr >= 0.5) || !(rv >= 1)) continue;
        cands.push({ s, rv, d, atr: pr.atr, ...st.or });
      }
      cands.sort((x, y) => y.rv - x.rv);
      for (const c of cands.slice(0, top)) {
        const bull = c.c > c.o;
        const bear = c.c < c.o;
        if (!bull && !bear) continue;
        const entry = bull ? c.h : c.l;
        const stop = bull ? entry - 0.1 * c.atr : entry + 0.1 * c.atr;
        out.push({
          type: 'enter',
          symbol: c.s,
          side: bull ? 'long' : 'short',
          order: 'stop',
          price: entry,
          expires: c.d.closeT,
          stop,
          exitBy: c.d.closeT,
          size: { risk },
          reason: `ORB : 5 premières minutes ${bull ? 'en hausse' : 'en baisse'}, volume relatif ${(c.rv * 100).toFixed(0)} %, stop à 10 % de l'ATR (${c.atr.toFixed(2)} $)`,
        });
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Momentum « zone de bruit » sur SPY (Zarattini, Aziz & Barbon, 2024)
// ---------------------------------------------------------------------------

/**
 * Zone de bruit : mouvement absolu moyen depuis l'ouverture, à la même heure, sur 14 jours. Toutes les 30 min de 10 h à
 * 15 h 30 (New York) : achat au-dessus de la borne haute, vente sous la borne basse ; stop suiveur = borne ou VWAP ;
 * sortie à la clôture. Taille : volatilité visée 2 % par jour, levier au plus `maxLev`.
 */
export function noiseArea(opts: { symbol: string; maxLev: number }): Strategy {
  const s = opts.symbol;
  // Calculs par séance faits à la demande (le suivi en direct ne lit que la séance du jour) : mêmes valeurs.
  type Pre = { days: UsDay[]; dayOf: Int32Array; sigma: Map<number, number[]>; vwap: number[]; vol: number[] };
  let pre: Pre | undefined;
  const sigmaOf = (bars: Bar[], p: Pre, k: number): number[] => {
    let row = p.sigma.get(k);
    if (row) return row;
    row = [];
    if (k >= 14) {
      // Mouvement |close/open − 1| par minute de séance, puis moyenne des 14 jours précédents.
      const ck = clocks(bars, NY);
      const moves: Array<Map<number, number>> = [];
      for (let j = k - 14; j < k; j++) {
        const d = p.days[j] as UsDay;
        const m = new Map<number, number>();
        for (let i = d.start; i < d.end; i++) m.set((ck[i] as Clock).min, Math.abs((bars[i] as Bar).c / d.open - 1));
        moves.push(m);
      }
      const d = p.days[k] as UsDay;
      for (let i = d.start; i < d.end; i++) {
        const min = (ck[i] as Clock).min;
        let sum = 0;
        let n = 0;
        for (const m of moves) {
          const x = m.get(min);
          if (x !== undefined) {
            sum += x;
            n++;
          }
        }
        row.push(n >= 10 ? sum / n : NaN);
      }
    }
    p.sigma.set(k, row);
    return row;
  };
  const vwapOf = (bars: Bar[], p: Pre, k: number, i: number): number => {
    if (Number.isNaN(p.vwap[i] as number)) {
      const d = p.days[k] as UsDay;
      let pv = 0;
      let vv = 0;
      for (let j = d.start; j < d.end; j++) {
        const b = bars[j] as Bar;
        pv += ((b.h + b.l + b.c) / 3) * b.v;
        vv += b.v;
        p.vwap[j] = vv > 0 ? pv / vv : b.c;
      }
    }
    return p.vwap[i] as number;
  };
  return {
    onBar(v) {
      const bars = v.series.get(s) ?? [];
      if (!pre) {
        const { days, dayOf } = usDays(bars);
        const vwap = new Array<number>(bars.length).fill(NaN);
        const rets = days.map((d, k) => (k === 0 ? NaN : d.close / (days[k - 1] as UsDay).close - 1));
        const vol = days.map((_, k) => {
          const w = rets.slice(Math.max(1, k - 14), k).filter((x) => Number.isFinite(x));
          if (w.length < 10) return NaN;
          const m = w.reduce((a, b) => a + b, 0) / w.length;
          return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length);
        });
        pre = { days, dayOf, sigma: new Map(), vwap, vol };
      }
      if (!v.fresh.has(s)) return [];
      const i = v.idx.get(s) as number;
      const k = pre.dayOf[i] as number;
      if (k < 1) return [];
      const d = pre.days[k] as UsDay;
      const closeMin = (clocks(bars, NY)[i]?.min as number) + 5;
      if (closeMin < 600 || closeMin > 930 || closeMin % 30 !== 0) return [];
      const sig = sigmaOf(bars, pre, k)[i - d.start];
      const dv = pre.vol[k] as number;
      if (sig === undefined || !Number.isFinite(sig) || !Number.isFinite(dv) || dv <= 0) return [];
      const prevClose = (pre.days[k - 1] as UsDay).close;
      const upper = Math.max(d.open, prevClose) * (1 + sig);
      const lower = Math.min(d.open, prevClose) * (1 - sig);
      const px = (bars[i] as Bar).c;
      const vw = vwapOf(bars, pre, k, i);
      const lev = Math.min(opts.maxLev, 0.02 / dv);
      const out: Intent[] = [];
      const enter = (side: 'long' | 'short'): Intent => ({
        type: 'enter',
        symbol: s,
        side,
        order: 'close',
        exitBy: d.closeT,
        size: { notional: lev },
        reason: `zone de bruit : ${px.toFixed(2)} ${side === 'long' ? `au-dessus de ${upper.toFixed(2)}` : `sous ${lower.toFixed(2)}`} (bruit ${(sig * 100).toFixed(2)} %), levier ${lev.toFixed(2)}`,
      });
      const p = posOn(v, s);
      if (p?.side === 'long') {
        if (px < Math.max(upper, vw)) {
          out.push({ type: 'exit', id: p.id, order: 'close', reason: 'retour sous max(borne haute, VWAP)' });
          if (px < lower) out.push(enter('short'));
        }
      } else if (p?.side === 'short') {
        if (px > Math.min(lower, vw)) {
          out.push({ type: 'exit', id: p.id, order: 'close', reason: 'retour au-dessus de min(borne basse, VWAP)' });
          if (px > upper) out.push(enter('long'));
        }
      } else if (px > upper) out.push(enter('long'));
      else if (px < lower) out.push(enter('short'));
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Momentum de la dernière demi-heure (Gao, Han, Li & Zhou, 2018)
// ---------------------------------------------------------------------------

/** Rendement de la veille 16 h à 10 h ; même sens sur SPY de 15 h 30 à 16 h (New York). */
export function lastHalfHour(opts: { symbol: string }): Strategy {
  const s = opts.symbol;
  let pre: { days: UsDay[]; dayOf: Int32Array } | undefined;
  return {
    onBar(v) {
      const bars = v.series.get(s) ?? [];
      pre ??= usDays(bars);
      if (!v.fresh.has(s)) return [];
      const i = v.idx.get(s) as number;
      const k = pre.dayOf[i] as number;
      if (k < 1) return [];
      const closeMin = (clocks(bars, NY)[i]?.min as number) + 5;
      if (closeMin !== 930 || posOn(v, s)) return [];
      const d = pre.days[k] as UsDay;
      const at10 = bars.slice(d.start, i + 1).find((_, j) => (clocks(bars, NY)[d.start + j]?.min as number) + 5 === 600);
      if (!at10) return [];
      const r1 = at10.c / (pre.days[k - 1] as UsDay).close - 1;
      if (r1 === 0) return [];
      return [
        {
          type: 'enter',
          symbol: s,
          side: r1 > 0 ? 'long' : 'short',
          order: 'close',
          exitBy: d.closeT,
          size: { notional: 1 },
          reason: `première demi-heure ${r1 > 0 ? '+' : ''}${(r1 * 100).toFixed(2)} % (depuis la clôture de la veille)`,
        },
      ];
    },
  };
}

// ---------------------------------------------------------------------------
// Barres journalières (SPY, QQQ) : RSI(2), nuit, tournant du mois
// ---------------------------------------------------------------------------

/** RSI(2) de Connors : achat à la clôture si cours > MM200 et RSI(2) < 10 ; vente à la clôture au-dessus de la MM5. */
export function rsi2(opts: { symbols: string[]; perSymbol: number }): Strategy {
  let pre: Map<string, { m200: number[]; m5: number[]; r2: number[] }> | undefined;
  return {
    onBar(v) {
      pre ??= new Map(
        opts.symbols.map((s) => {
          const c = (v.series.get(s) ?? []).map((b) => b.c);
          return [s, { m200: sma(c, 200), m5: sma(c, 5), r2: rsi(c, 2) }];
        }),
      );
      const out: Intent[] = [];
      for (const s of v.fresh) {
        const p = pre.get(s);
        if (!p) continue;
        const i = v.idx.get(s) as number;
        const c = ((v.series.get(s) as Bar[])[i] as Bar).c;
        const pos = posOn(v, s);
        if (pos) {
          if (c > (p.m5[i] as number)) out.push({ type: 'exit', id: pos.id, order: 'close', reason: `clôture ${c.toFixed(2)} au-dessus de la MM5` });
        } else if (c > (p.m200[i] as number) && (p.r2[i] as number) < 10) {
          out.push({ type: 'enter', symbol: s, side: 'long', order: 'close', size: { notional: opts.perSymbol }, reason: `RSI(2) ${(p.r2[i] as number).toFixed(1)} < 10, au-dessus de la MM200` });
        }
      }
      return out;
    },
  };
}

/** Nuit : achat à la clôture, vente à l'ouverture du lendemain, chaque jour. */
export function overnight(opts: { symbol: string }): Strategy {
  return {
    onBar(v) {
      if (!v.fresh.has(opts.symbol) || posOn(v, opts.symbol)) return [];
      return [{ type: 'enter', symbol: opts.symbol, side: 'long', order: 'close', exitAtNextOpen: true, size: { notional: 1 }, reason: 'achat à la clôture, vente à l’ouverture' }];
    },
  };
}

/** Tournant du mois : achat à la clôture du dernier jour de bourse du mois, vente à la clôture du 2e jour du suivant. */
export function turnOfMonth(opts: { symbol: string }): Strategy {
  const nextWeekday = (date: string): string => {
    let t = Date.parse(`${date}T12:00:00Z`);
    do t += 86_400_000;
    while ([0, 6].includes(new Date(t).getUTCDay()));
    return new Date(t).toISOString().slice(0, 10);
  };
  return {
    onBar(v) {
      const s = opts.symbol;
      if (!v.fresh.has(s)) return [];
      const bars = v.series.get(s) as Bar[];
      const i = v.idx.get(s) as number;
      const ck = clocks(bars, NY);
      const date = (ck[i] as Clock).date;
      const pos = posOn(v, s);
      if (pos) {
        // Jours de bourse écoulés depuis l'entrée.
        const k = bars.findIndex((b) => b.t + 6.5 * 3_600_000 >= pos.openedAt);
        if (k >= 0 && i - k >= 2) return [{ type: 'exit', id: pos.id, order: 'close', reason: '2e jour de bourse du mois' }];
        return [];
      }
      // Le calendrier des séances est connu d'avance : on lit la date de la séance suivante (pas son prix).
      const next = ck[i + 1]?.date ?? nextWeekday(date);
      if (next.slice(0, 7) === date.slice(0, 7)) return [];
      return [{ type: 'enter', symbol: s, side: 'long', order: 'close', size: { notional: 1 }, reason: 'dernier jour de bourse du mois' }];
    },
  };
}

// ---------------------------------------------------------------------------
// Crypto
// ---------------------------------------------------------------------------

/** Suivi de tendance en 1 h : cassure du plus haut de 20 h au-dessus de la MME 100, stop suiveur à 2 ATR. */
export function donchian(opts: { symbols: string[]; risk?: number; shorts?: boolean }): Strategy {
  const risk = opts.risk ?? 0.01;
  let pre: Map<string, { e100: number[]; a14: number[]; hi20: number[]; lo20: number[] }> | undefined;
  return {
    onBar(v) {
      pre ??= new Map(
        opts.symbols.map((s) => {
          const bars = v.series.get(s) ?? [];
          return [s, { e100: ema(bars.map((b) => b.c), 100), a14: atr(bars, 14), hi20: priorMax(bars, 20), lo20: priorMin(bars, 20) }];
        }),
      );
      const out: Intent[] = [];
      for (const s of v.fresh) {
        const p = pre.get(s);
        if (!p) continue;
        const i = v.idx.get(s) as number;
        const b = (v.series.get(s) as Bar[])[i] as Bar;
        const a = p.a14[i] as number;
        if (!Number.isFinite(a)) continue;
        const pos = posOn(v, s);
        if (pos?.side === 'long') {
          const ns = b.c - 2 * a;
          if (pos.stop === undefined || ns > pos.stop) out.push({ type: 'stop', id: pos.id, stop: ns });
        } else if (pos?.side === 'short') {
          const ns = b.c + 2 * a;
          if (pos.stop === undefined || ns < pos.stop) out.push({ type: 'stop', id: pos.id, stop: ns });
        } else if (b.c > (p.hi20[i] as number) && b.c > (p.e100[i] as number)) {
          out.push({ type: 'enter', symbol: s, side: 'long', order: 'close', stop: b.c - 2 * a, size: { risk }, reason: `cassure du plus haut de 20 h (${(p.hi20[i] as number).toFixed(2)}), au-dessus de la MME 100` });
        } else if (opts.shorts && b.c < (p.lo20[i] as number) && b.c < (p.e100[i] as number)) {
          out.push({ type: 'enter', symbol: s, side: 'short', order: 'close', stop: b.c + 2 * a, size: { risk }, reason: `cassure du plus bas de 20 h (${(p.lo20[i] as number).toFixed(2)}), sous la MME 100` });
        }
      }
      return out;
    },
  };
}

/** Retour à la moyenne en 15 min : achat sous la bande de Bollinger basse avec RSI(14) < 30, sortie à la moyenne. */
export function bollinger(opts: { symbols: string[]; risk?: number }): Strategy {
  const risk = opts.risk ?? 0.01;
  let pre: Map<string, { m20: number[]; s20: number[]; r14: number[]; a14: number[] }> | undefined;
  return {
    onBar(v) {
      pre ??= new Map(
        opts.symbols.map((s) => {
          const bars = v.series.get(s) ?? [];
          const c = bars.map((b) => b.c);
          return [s, { m20: sma(c, 20), s20: stdev(c, 20), r14: rsi(c, 14), a14: atr(bars, 14) }];
        }),
      );
      const out: Intent[] = [];
      for (const s of v.fresh) {
        const p = pre.get(s);
        if (!p) continue;
        const i = v.idx.get(s) as number;
        const b = (v.series.get(s) as Bar[])[i] as Bar;
        const pos = posOn(v, s);
        const mid = p.m20[i] as number;
        if (pos) {
          if (b.c >= mid) out.push({ type: 'exit', id: pos.id, order: 'close', reason: 'retour à la moyenne 20' });
          else if (b.t + 15 * 60_000 - pos.openedAt >= 24 * 3_600_000) out.push({ type: 'exit', id: pos.id, order: 'close', reason: '24 h sans retour à la moyenne' });
        } else if (b.c < mid - 2 * (p.s20[i] as number) && (p.r14[i] as number) < 30 && Number.isFinite(p.a14[i] as number)) {
          out.push({ type: 'enter', symbol: s, side: 'long', order: 'close', stop: b.c - 1.5 * (p.a14[i] as number), size: { risk }, reason: `sous la bande basse (${(mid - 2 * (p.s20[i] as number)).toFixed(2)}), RSI(14) ${(p.r14[i] as number).toFixed(0)}` });
        }
      }
      return out;
    },
  };
}

/**
 * Grille d'achats (bot « grille » des plateformes crypto) : chaque jour à 0 h UTC, 8 ordres d'achat limites tous les
 * 0,5 % sous le cours, chacun revendu 0,5 % plus haut, réarmé après chaque revente ; tout est soldé à 0 h UTC suivant.
 * Ordres limites passifs : frais « maker ».
 */
export function grid(opts: { symbol: string; levels?: number; stepPct?: number }): Strategy {
  const n = opts.levels ?? 8;
  const step = (opts.stepPct ?? 0.5) / 100;
  let day = '';
  let p0 = 0;
  let dayEnd = 0;
  return {
    onBar(v) {
      const s = opts.symbol;
      if (!v.fresh.has(s)) return [];
      const b = bar(v, s) as Bar;
      const d = new Date(b.t).toISOString().slice(0, 10);
      const out: Intent[] = [];
      const reset = d !== day;
      if (reset) {
        day = d;
        p0 = b.c;
        dayEnd = Date.parse(`${d}T00:00:00Z`) + 86_400_000;
        for (const p of v.positions) out.push({ type: 'exit', id: p.id, order: 'close', reason: 'remise à zéro quotidienne de la grille' });
        out.push({ type: 'cancel' });
      }
      for (let k = 1; k <= n; k++) {
        const tag = `g${k}`;
        if (!reset && (v.positions.some((p) => p.tag === tag) || v.pending.some((o) => o.intent.tag === tag))) continue;
        const price = p0 * (1 - k * step);
        out.push({
          type: 'enter',
          symbol: s,
          side: 'long',
          order: 'limit',
          price,
          expires: dayEnd,
          target: price * (1 + step),
          size: { notional: 1 / n },
          tag,
          reason: `grille : niveau ${k} (−${(k * step * 100).toFixed(1)} % sous ${p0.toFixed(0)})`,
        });
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// Or : range de l'ouverture de New York
// ---------------------------------------------------------------------------

/**
 * Range de 9 h 30 à 9 h 45 (New York) ; cassure par ordre stop jusqu'à 11 h 30 (New York), dans les deux sens (le
 * premier exécuté annule l'autre). Stop de l'autre côté du range, objectif 2 fois le range, sortie à 19 h (Paris).
 */
export function goldNyOpen(opts: { symbol: string; risk?: number; exitParis?: number }): Strategy {
  const s = opts.symbol;
  const risk = opts.risk ?? 0.01;
  const done = new Set<string>();
  return {
    onBar(v) {
      if (!v.fresh.has(s)) return [];
      const bars = v.series.get(s) as Bar[];
      const i = v.idx.get(s) as number;
      const ck = clocks(bars, NY);
      const c = ck[i] as Clock;
      if (c.min + 5 !== 585 || done.has(c.date)) return [];
      done.add(c.date);
      const range = bars.slice(Math.max(0, i - 2), i + 1).filter((_, j) => (ck[i - 2 + j]?.min ?? 0) >= 570 && ck[i - 2 + j]?.date === c.date);
      if (range.length < 3) return [];
      const hi = Math.max(...range.map((b) => b.h));
      const lo = Math.min(...range.map((b) => b.l));
      const w = hi - lo;
      if (!(w > 0)) return [];
      const exitBy = zonedToUtc(localTime(bars[i]!.t, PARIS).date, opts.exitParis ?? 19 * 60, PARIS);
      const expires = zonedToUtc(c.date, 690, NY);
      const oco = `ny-${c.date}`;
      return [
        { type: 'enter', symbol: s, side: 'long', order: 'stop', price: hi, expires, stop: lo, target: hi + 2 * w, exitBy, size: { risk }, oco, reason: `cassure du haut du range 9 h 30 – 9 h 45 (${hi.toFixed(1)}, largeur ${w.toFixed(1)} $)` },
        { type: 'enter', symbol: s, side: 'short', order: 'stop', price: lo, expires, stop: hi, target: lo - 2 * w, exitBy, size: { risk }, oco, reason: `cassure du bas du range 9 h 30 – 9 h 45 (${lo.toFixed(1)}, largeur ${w.toFixed(1)} $)` },
      ];
    },
  };
}

// ---------------------------------------------------------------------------
// Témoins
// ---------------------------------------------------------------------------

/**
 * Témoin au hasard : chaque jour de semaine, une minute tirée au sort entre `fromParis` et `toParis`, un sens tiré au
 * sort ; stop et objectif fixes en % ; sortie à `exitParis`. Sert à mesurer ce qu'une stratégie apporte de plus que le hasard.
 */
export function randomSignals(opts: {
  symbol: string;
  seed: string;
  fromParis: number;
  toParis: number;
  exitParis: number;
  /** Stop en % du prix (0 : pas de stop, le compte sert de stop). */
  stopPct: number;
  targetPct?: number;
  /** Objectif en écart de prix absolu (ex. 20 $ = « 200 pips » sur l'or). */
  targetAbs?: number;
  size: { risk: number } | { notional: number };
  /** Taille « loterie » : position telle qu'un mouvement de `move` $ rapporte 3 fois le compte (façon groupes Telegram). */
  lotteryMove?: number;
}): Strategy {
  const s = opts.symbol;
  const chosen = new Map<string, { min: number; side: 'long' | 'short' }>();
  return {
    onBar(v) {
      if (!v.fresh.has(s)) return [];
      const bars = v.series.get(s) as Bar[];
      const i = v.idx.get(s) as number;
      const c = clocks(bars, PARIS)[i] as Clock;
      const wd = new Date(`${c.date}T12:00:00Z`).getUTCDay();
      if (wd === 0 || wd === 6) return [];
      let pick = chosen.get(c.date);
      if (!pick) {
        const r = rng(`${opts.seed}|${c.date}`);
        const slots = Math.floor((opts.toParis - opts.fromParis) / 5);
        pick = { min: opts.fromParis + 5 * Math.floor(r() * slots), side: r() < 0.5 ? 'long' : 'short' };
        chosen.set(c.date, pick);
      }
      if (c.min + 5 !== pick.min || posOn(v, s) || pendingOn(v, s)) return [];
      const px = (bars[i] as Bar).c;
      const dir = pick.side === 'long' ? 1 : -1;
      const target = opts.targetAbs ? px + dir * opts.targetAbs : opts.targetPct ? px * (1 + (dir * opts.targetPct) / 100) : undefined;
      return [
        {
          type: 'enter',
          symbol: s,
          side: pick.side,
          order: 'close',
          stop: opts.stopPct > 0 ? px * (1 - (dir * opts.stopPct) / 100) : undefined,
          target,
          exitBy: zonedToUtc(c.date, opts.exitParis, PARIS),
          size: opts.lotteryMove ? { notional: (3 * px) / opts.lotteryMove } : opts.size,
          reason: `tirage au sort : ${pick.side === 'long' ? 'achat' : 'vente'} à ${Math.floor(pick.min / 60)} h ${String(pick.min % 60).padStart(2, '0')}`,
        },
      ];
    },
  };
}

// ---------------------------------------------------------------------------
// Comptes de 5 000 $ : stratégies supplémentaires
// ---------------------------------------------------------------------------

/** Taux de financement horaire des perpétuels, chargés par le programme principal (symbole → heure → taux). */
export const FUNDING = new Map<string, Map<number, number>>();
export function fundingAt(symbol: string, hourStart: number): number | undefined {
  return FUNDING.get(symbol)?.get(hourStart);
}

/**
 * ORB 5 min sur QQQ (Zarattini & Aziz, 2023, « Can Day Trading Really Be Profitable? ») : 1re bougie de 5 min en
 * hausse → achat à l'ouverture de la 2e, stop au plus bas de la 1re ; en baisse → vente, stop au plus haut ; objectif
 * 10 R, sinon sortie à la clôture. Risque 1 % par trade.
 */
export function orbFirstCandle(opts: { symbol: string; risk?: number; targetR?: number }): Strategy {
  const s = opts.symbol;
  const risk = opts.risk ?? 0.01;
  const targetR = opts.targetR ?? 10;
  let pre: { days: UsDay[]; dayOf: Int32Array } | undefined;
  return {
    onBar(v) {
      const bars = v.series.get(s) ?? [];
      pre ??= usDays(bars);
      if (!v.fresh.has(s)) return [];
      const i = v.idx.get(s) as number;
      const k = pre.dayOf[i] as number;
      if (k < 0) return [];
      const d = pre.days[k] as UsDay;
      if (i !== d.start || clocks(bars, NY)[i]?.min !== 570) return [];
      const b = bars[i] as Bar;
      if (b.c === b.o) return [];
      const long = b.c > b.o;
      const stop = long ? b.l : b.h;
      const dist = Math.abs(b.c - stop);
      if (!(dist > 0)) return [];
      return [
        {
          type: 'enter',
          symbol: s,
          side: long ? 'long' : 'short',
          order: 'open',
          stop,
          target: long ? b.c + targetR * dist : b.c - targetR * dist,
          exitBy: d.closeT,
          size: { risk },
          reason: `ORB QQQ : 1re bougie ${long ? 'haussière' : 'baissière'} (${b.o.toFixed(2)} → ${b.c.toFixed(2)}), stop ${stop.toFixed(2)}, objectif ${targetR} R`,
        },
      ];
    },
  };
}

/**
 * Cassure d'un range de séance pour n'importe quel marché : range entre `rangeStart` et `rangeEnd` (heure locale de
 * `tz`), ordres stop des deux côtés jusqu'à `entryUntil` (le premier exécuté annule l'autre), stop de l'autre côté du
 * range, objectif `targetR` fois le risque, sortie à `exitAt`. `compression` : seulement si le range du jour est plus
 * étroit que la médiane des 20 séances précédentes (marché comprimé, cassure plus franche).
 */
export function sessionBreakout(opts: {
  symbol: string;
  tz: string;
  rangeStart: number;
  rangeEnd: number;
  entryUntil: number;
  exitAt: number;
  targetR?: number;
  risk?: number;
  compression?: boolean;
  label: string;
}): Strategy {
  const s = opts.symbol;
  const targetR = opts.targetR ?? 2;
  const risk = opts.risk ?? 0.01;
  const done = new Set<string>();
  return {
    onBar(v) {
      if (!v.fresh.has(s)) return [];
      // Largeurs des ranges des séances passées : en mémoire, pour survivre aux reprises du suivi en direct.
      const widths = (v.memo.widths ??= []) as number[];
      const bars = v.series.get(s) as Bar[];
      const i = v.idx.get(s) as number;
      const ck = clocks(bars, opts.tz);
      const c = ck[i] as Clock;
      const barMin = i > 0 ? Math.round(((bars[i] as Bar).t - (bars[i - 1] as Bar).t) / 60_000) : 5;
      if (c.min + Math.min(barMin, 5) !== opts.rangeEnd || done.has(c.date)) return [];
      done.add(c.date);
      const range: Bar[] = [];
      for (let j = i; j >= 0 && ck[j]?.date === c.date && (ck[j] as Clock).min >= opts.rangeStart; j--) range.push(bars[j] as Bar);
      if (range.length < Math.max(1, Math.floor((opts.rangeEnd - opts.rangeStart) / 5) - 1)) return [];
      const hi = Math.max(...range.map((b) => b.h));
      const lo = Math.min(...range.map((b) => b.l));
      const w = hi - lo;
      if (!(w > 0)) return [];
      const prior = widths.slice(-20);
      widths.push(w);
      if (opts.compression) {
        if (prior.length < 10) return [];
        const med = [...prior].sort((a, b) => a - b)[Math.floor(prior.length / 2)] as number;
        if (w > med) return [];
      }
      const exitBy = zonedToUtc(c.date, opts.exitAt, opts.tz);
      const expires = zonedToUtc(c.date, opts.entryUntil, opts.tz);
      const oco = `${s}-${c.date}`;
      return [
        { type: 'enter', symbol: s, side: 'long', order: 'stop', price: hi, expires, stop: lo, target: hi + targetR * w, exitBy, size: { risk }, oco, reason: `${opts.label} : cassure du haut du range (${hi}, largeur ${w.toFixed(5)})` },
        { type: 'enter', symbol: s, side: 'short', order: 'stop', price: lo, expires, stop: hi, target: lo - targetR * w, exitBy, size: { risk }, oco, reason: `${opts.label} : cassure du bas du range (${lo}, largeur ${w.toFixed(5)})` },
      ];
    },
  };
}

/**
 * Cassure après compression (« squeeze ») en 1 h : la largeur des bandes de Bollinger est dans les 20 % les plus
 * étroites des 120 dernières heures, puis le cours casse le plus haut (ou le plus bas) des 20 heures. Stop à
 * `atrStop` ATR, objectif `targetR` R. Le marché très calme précède souvent les grands mouvements.
 */
export function squeezeBreakout(opts: { symbols: string[]; risk?: number; atrStop?: number; targetR?: number; shorts?: boolean }): Strategy {
  const risk = opts.risk ?? 0.02;
  const atrStop = opts.atrStop ?? 1.5;
  const targetR = opts.targetR ?? 3;
  let pre: Map<string, { width: number[]; hi20: number[]; lo20: number[]; a14: number[]; squeeze: boolean[] }> | undefined;
  return {
    onBar(v) {
      pre ??= new Map(
        opts.symbols.map((s) => {
          const bars = v.series.get(s) ?? [];
          const c = bars.map((b) => b.c);
          const m = sma(c, 20);
          const sd = stdev(c, 20);
          const width = c.map((_, i) => (4 * (sd[i] as number)) / (m[i] as number));
          const squeeze = width.map((w, i) => {
            if (i < 140 || !Number.isFinite(w)) return false;
            const win = width.slice(i - 120, i).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
            return win.length > 60 && w <= (win[Math.floor(win.length * 0.2)] as number);
          });
          return [s, { width, hi20: priorMax(bars, 20), lo20: priorMin(bars, 20), a14: atr(bars, 14), squeeze }];
        }),
      );
      const out: Intent[] = [];
      for (const s of v.fresh) {
        const p = pre.get(s);
        if (!p || posOn(v, s)) continue;
        const i = v.idx.get(s) as number;
        const b = (v.series.get(s) as Bar[])[i] as Bar;
        const a = p.a14[i] as number;
        const recent = p.squeeze.slice(Math.max(0, i - 5), i + 1).some(Boolean);
        if (!recent || !Number.isFinite(a) || a <= 0) continue;
        if (b.c > (p.hi20[i] as number)) {
          const stop = b.c - atrStop * a;
          out.push({ type: 'enter', symbol: s, side: 'long', order: 'close', stop, target: b.c + targetR * (b.c - stop), size: { risk }, reason: `sortie de compression par le haut (largeur ${((p.width[i] as number) * 100).toFixed(2)} %)` });
        } else if (opts.shorts && b.c < (p.lo20[i] as number)) {
          const stop = b.c + atrStop * a;
          out.push({ type: 'enter', symbol: s, side: 'short', order: 'close', stop, target: b.c - targetR * (stop - b.c), size: { risk }, reason: `sortie de compression par le bas (largeur ${((p.width[i] as number) * 100).toFixed(2)} %)` });
        }
      }
      return out;
    },
  };
}

/** Barres de `hours` heures (alignées sur l'heure UTC) à partir de barres d'une heure ; `end[k]` = indice de la dernière barre horaire. */
export function aggregateHours(bars: Bar[], hours: number): { bars: Bar[]; end: number[] } {
  const out: Bar[] = [];
  const end: number[] = [];
  const H = hours * 3_600_000;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i] as Bar;
    const slot = Math.floor(b.t / H) * H;
    const last = out.at(-1);
    if (!last || last.t !== slot) {
      out.push({ t: slot, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
      end.push(i);
    } else {
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.c = b.c;
      last.v += b.v;
      end[end.length - 1] = i;
    }
  }
  return { bars: out, end };
}

/** Suivi de tendance Donchian sur des barres de `hours` heures reconstituées, décidé à la clôture de chaque barre. */
export function donchianTf(opts: { symbols: string[]; hours: number; risk?: number; atrMult?: number; channel?: number; shorts?: boolean }): Strategy {
  const risk = opts.risk ?? 0.01;
  const k = opts.atrMult ?? 3;
  const n = opts.channel ?? 20;
  let pre: Map<string, { agg: Bar[]; at: Map<number, number>; e50: number[]; a14: number[]; hi: number[]; lo: number[] }> | undefined;
  return {
    onBar(v) {
      pre ??= new Map(
        opts.symbols.map((s) => {
          const { bars: agg, end } = aggregateHours(v.series.get(s) ?? [], opts.hours);
          // Une barre agrégée n'est connue qu'à la clôture de sa dernière heure.
          const at = new Map<number, number>();
          end.forEach((e, j) => {
            const full = (agg[j] as Bar).t + opts.hours * 3_600_000 - 3_600_000;
            if (((v.series.get(s) ?? [])[e] as Bar).t === full) at.set(e, j);
          });
          return [s, { agg, at, e50: ema(agg.map((b) => b.c), 50), a14: atr(agg, 14), hi: priorMax(agg, n), lo: priorMin(agg, n) }];
        }),
      );
      const out: Intent[] = [];
      for (const s of v.fresh) {
        const p = pre.get(s);
        if (!p) continue;
        const j = p.at.get(v.idx.get(s) as number);
        if (j === undefined) continue;
        const b = p.agg[j] as Bar;
        const a = p.a14[j] as number;
        if (!Number.isFinite(a)) continue;
        const pos = posOn(v, s);
        if (pos?.side === 'long') {
          const ns = b.c - k * a;
          if (pos.stop === undefined || ns > pos.stop) out.push({ type: 'stop', id: pos.id, stop: ns });
        } else if (pos?.side === 'short') {
          const ns = b.c + k * a;
          if (pos.stop === undefined || ns < pos.stop) out.push({ type: 'stop', id: pos.id, stop: ns });
        } else if (b.c > (p.hi[j] as number) && b.c > (p.e50[j] as number)) {
          out.push({ type: 'enter', symbol: s, side: 'long', order: 'close', stop: b.c - k * a, size: { risk }, reason: `tendance ${opts.hours} h : cassure du plus haut de ${n} barres, au-dessus de la MME 50` });
        } else if (opts.shorts && b.c < (p.lo[j] as number) && b.c < (p.e50[j] as number)) {
          out.push({ type: 'enter', symbol: s, side: 'short', order: 'close', stop: b.c + k * a, size: { risk }, reason: `tendance ${opts.hours} h : cassure du plus bas de ${n} barres, sous la MME 50` });
        }
      }
      return out;
    },
  };
}

/**
 * Portage du financement (« cash and carry ») : achat au comptant et vente du perpétuel pour le même montant ; le
 * prix s'annule, on encaisse le financement payé par les acheteurs du perpétuel. Entrée quand la moyenne des 72 h
 * précédentes dépasse `enterAbove` par heure, sortie quand elle passe sous `exitBelow`.
 */
export function fundingCarry(opts: { spot: string; perp: string; enterAbove?: number; exitBelow?: number; hours?: number; leg?: number }): Strategy {
  const enter = opts.enterAbove ?? 2e-6;
  const exit = opts.exitBelow ?? 0;
  const hours = opts.hours ?? 72;
  const leg = opts.leg ?? 0.5;
  const avg = (t: number): number | undefined => {
    const H = 3_600_000;
    const h0 = Math.floor(t / H) * H;
    let sum = 0;
    let n = 0;
    for (let h = h0 - hours * H; h < h0; h += H) {
      const r = fundingAt(opts.perp, h);
      if (r !== undefined) {
        sum += r;
        n++;
      }
    }
    return n >= hours / 2 ? sum / n : undefined;
  };
  return {
    onBar(v) {
      if (!v.fresh.has(opts.spot) || !v.fresh.has(opts.perp)) return [];
      const a = avg((bar(v, opts.perp) as Bar).t + 3_600_000);
      if (a === undefined) return [];
      const held = v.positions.filter((p) => p.symbol === opts.spot || p.symbol === opts.perp);
      const yearly = (a * 24 * 365 * 100).toFixed(1);
      if (held.length) {
        if (a < exit) return held.map((p) => ({ type: 'exit' as const, id: p.id, order: 'close' as const, reason: `financement moyen 72 h à ${yearly} %/an : on sort` }));
        return [];
      }
      if (a <= enter) return [];
      return [
        { type: 'enter', symbol: opts.spot, side: 'long', order: 'close', size: { notional: leg }, reason: `portage : financement moyen 72 h à ${yearly} %/an (jambe au comptant)`, tag: 'carry' },
        { type: 'enter', symbol: opts.perp, side: 'short', order: 'close', size: { notional: leg }, reason: `portage : financement moyen 72 h à ${yearly} %/an (jambe perpétuel vendue)`, tag: 'carry' },
      ];
    },
  };
}

/** Achat-conservation : achat à la première séance, jamais revendu. */
export function buyHold(opts: { symbol: string }): Strategy {
  return {
    onBar(v) {
      if (!v.fresh.has(opts.symbol) || posOn(v, opts.symbol)) return [];
      return [{ type: 'enter', symbol: opts.symbol, side: 'long', order: 'close', size: { notional: 1 }, reason: 'achat-conservation' }];
    },
  };
}

/**
 * Allocation périodique : à la première séance de chaque mois (ou trimestre), tout est revendu puis racheté selon les
 * poids du jour (calculés sur les cours connus). Poids nul = part laissée en liquidités.
 */
export function allocator(opts: { symbols: string[]; period: 'month' | 'quarter'; weights: (closes: Map<string, number[]>, idx: Map<string, number>) => Record<string, number>; label: string }): Strategy {
  let closes: Map<string, number[]> | undefined;
  return {
    onBar(v) {
      const ref = opts.symbols[0] as string;
      if (!v.fresh.has(ref)) return [];
      closes ??= new Map(opts.symbols.map((s) => [s, (v.series.get(s) ?? []).map((b) => b.c)]));
      const bars = v.series.get(ref) as Bar[];
      const i = v.idx.get(ref) as number;
      const date = (clocks(bars, NY)[i] as Clock).date;
      const key = opts.period === 'month' ? date.slice(0, 7) : `${date.slice(0, 4)}-T${Math.floor((Number(date.slice(5, 7)) - 1) / 3)}`;
      // Dernière période rééquilibrée : en mémoire, pour survivre aux reprises du suivi en direct.
      if (v.memo.lastPeriod === key) return [];
      v.memo.lastPeriod = key;
      const idx = new Map(opts.symbols.map((s) => [s, v.idx.get(s) ?? -1]));
      const w = opts.weights(closes, idx);
      const out: Intent[] = v.positions.map((p) => ({ type: 'exit' as const, id: p.id, order: 'close' as const, reason: `${opts.label} : rééquilibrage` }));
      for (const s of opts.symbols) {
        const x = w[s] ?? 0;
        if (x > 0 && v.fresh.has(s)) out.push({ type: 'enter', symbol: s, side: 'long', order: 'close', size: { notional: x }, reason: `${opts.label} : ${(x * 100).toFixed(0)} % du compte` });
      }
      return out;
    },
  };
}

/** Allocation tactique de Faber (2007) : chaque actif pèse 1/N s'il est au-dessus de sa moyenne de 10 mois, sinon liquidités. */
export function faber(opts: { symbols: string[] }): Strategy {
  return allocator({
    symbols: opts.symbols,
    period: 'month',
    label: 'allocation de Faber',
    weights: (closes, idx) => {
      const w: Record<string, number> = {};
      for (const s of opts.symbols) {
        const c = closes.get(s) ?? [];
        const i = idx.get(s) ?? -1;
        if (i < 210) continue;
        const m = c.slice(i - 209, i + 1).reduce((a, b) => a + b, 0) / 210;
        if ((c[i] as number) > m) w[s] = 1 / opts.symbols.length;
      }
      return w;
    },
  });
}

/** Portefeuille permanent (Browne) : 25 % actions, obligations longues, or, monétaire ; rééquilibré chaque trimestre. */
export function permanent(opts: { symbols: [string, string, string, string] }): Strategy {
  return allocator({ symbols: opts.symbols, period: 'quarter', label: 'portefeuille permanent', weights: () => Object.fromEntries(opts.symbols.map((s) => [s, 0.25])) });
}

/** Tendance longue : on détient l'actif tant que sa clôture est au-dessus de sa moyenne de 200 jours. */
export function trend200(opts: { symbols: string[]; perSymbol: number }): Strategy {
  let pre: Map<string, number[]> | undefined;
  return {
    onBar(v) {
      pre ??= new Map(opts.symbols.map((s) => [s, sma((v.series.get(s) ?? []).map((b) => b.c), 200)]));
      const out: Intent[] = [];
      for (const s of v.fresh) {
        const m = pre.get(s);
        if (!m) continue;
        const i = v.idx.get(s) as number;
        const c = ((v.series.get(s) as Bar[])[i] as Bar).c;
        const ma = m[i] as number;
        if (!Number.isFinite(ma)) continue;
        const pos = posOn(v, s);
        if (pos && c < ma) out.push({ type: 'exit', id: pos.id, order: 'close', reason: `clôture ${c.toFixed(0)} sous la moyenne 200 jours (${ma.toFixed(0)})` });
        else if (!pos && c > ma) out.push({ type: 'enter', symbol: s, side: 'long', order: 'close', size: { notional: opts.perSymbol }, reason: `clôture ${c.toFixed(0)} au-dessus de la moyenne 200 jours (${ma.toFixed(0)})` });
      }
      return out;
    },
  };
}
