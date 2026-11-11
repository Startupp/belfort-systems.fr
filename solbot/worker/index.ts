/**
 * Worker Cloudflare « arene-papier » : les 12 comptes papier de 5 000 $ de l'arène, en direct.
 *
 * Une tâche planifiée chaque minute ; chaque passage ne fait qu'une petite partie du travail (créneaux, en UTC) :
 * - minute ≡ 1 (mod 5) : barres de 5 min des marchés dans leur plage (config.ts) ;
 * - minute 2 de chaque heure : barres horaires Kraken Futures ; minute 3 : barre horaire Coinbase ;
 * - 22 h 41 – 22 h 45 : barres journalières Yahoo (deux symboles par minute) ; 0 h 42 – 0 h 44 : Coinbase ;
 * - à chaque passage : au plus une série complétée vers le passé, les comptes dont une série a bougé (repris là où
 *   ils s'étaient arrêtés : même moteur, mêmes réglages que l'arène, état dans D1), puis le PnL en direct de tous.
 *
 * Page : https://arene-papier.<sous-domaine>.workers.dev/<TOKEN>/ (lien secret) ; /<TOKEN>/api : les chiffres en JSON ;
 * /<TOKEN>/run : un passage tout de suite (?tout : toutes les séries, comme si tout était dû).
 * Papier uniquement : aucune clé, aucun ordre réel.
 */

import { runPortfolio } from '../src/arena/engine.ts';
import type { EngineState, Trade } from '../src/arena/engine.ts';
import { ACCOUNTS } from '../src/arena/roster.ts';
import type { Account, Variant } from '../src/arena/roster.ts';
import type { DataKey } from '../src/arena/portfolios.ts';
import { FUNDING, NY } from '../src/arena/strategies.ts';
import { localTime } from '../src/desk/market.ts';
import type { Bar } from '../src/desk/types.ts';
import { CHOICES, SESSIONS, START_MS } from './config.ts';
import * as feed from './feeds.ts';
import { pageHtml } from './dash.ts';

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface D1Database {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown>;
}
export interface Env {
  DB: D1Database;
  TOKEN: string;
  /** Départ du suivi (ms) ; par défaut celui de l'arène (mercredi 11 novembre 2026, 15 h 25 à Paris). */
  START_MS?: string;
}

type Tf = '5m' | '1h' | '1d';
type Src = 'yahoo' | 'coinbase' | 'kraken';
export interface Feed {
  tf: Tf;
  sym: string;
  src: Src;
  /** Barres gardées : de quoi calculer les indicateurs de la stratégie, pas plus. */
  keep: number;
  /** Échelle des cours et des volumes stockés en entiers (cours × px). */
  px: number;
  vs: number;
}
const MS: Record<Tf, number> = { '5m': 5 * 60_000, '1h': 3_600_000, '1d': 86_400_000 };
const H = 3_600_000;
const DAY = 86_400_000;
/** Attente maximale d'une série en retard avant qu'un compte avance sans elle. */
const WAIT: Record<Tf, number> = { '5m': 2 * H, '1h': 3 * H, '1d': 4 * DAY };
/** Requêtes sortantes par passage (limite du plan gratuit : 50). */
const BUDGET = 30;

/** Les séries dont chaque jeu de données de l'arène a besoin, avec la longueur gardée et l'échelle de stockage. */
export function feedOf(key: DataKey, sym: string): Feed {
  // Perpétuels : tendance en barres de 4 h (moyenne 50, Donchian 20, ATR) : 30 jours suffisent.
  if (key === 'kfut1h') return { tf: '1h', sym, src: 'kraken', keep: 720, px: 100, vs: 10_000 };
  // Jambe au comptant du portage : seulement le cours (le financement est gardé à part).
  if (key === 'crypto1h') return { tf: '1h', sym, src: 'coinbase', keep: 240, px: 100, vs: 10_000 };
  // Journalier : moyenne 200 jours et canaux, avec de la marge.
  if (key === 'crypto1d') return { tf: '1d', sym, src: 'coinbase', keep: 330, px: 100, vs: 10_000 };
  if (key === 'daily') return { tf: '1d', sym, src: 'yahoo', keep: 330, px: 10_000, vs: 1 };
  // 5 min : les cassures n'utilisent que la séance du jour ; la zone de bruit (SPY) veut 15 séances complètes de plus.
  const px = sym === 'EURUSD=X' ? 1_000_000 : sym === 'GC=F' ? 100 : 10_000;
  return { tf: '5m', sym, src: 'yahoo', keep: sym === 'SPY' ? 1600 : sym === 'QQQ' ? 240 : 600, px, vs: 1 };
}

export interface Live {
  account: Account;
  variant: Variant;
  feeds: Map<string, Feed>;
}
export function roster(): Live[] {
  return ACCOUNTS.map((a) => {
    const variant = a.variants[CHOICES[a.id] ?? 0] ?? (a.variants[0] as Variant);
    const feeds = new Map(variant.spec.symbols.map((s) => [s, feedOf(variant.dataBySymbol?.[s] ?? variant.spec.data, s)]));
    return { account: a, variant, feeds };
  });
}
const keyOf = (f: Feed): string => `${f.tf}|${f.sym}`;
const LIVE = roster();
const FEEDS = new Map<string, Feed>();
for (const l of LIVE) for (const f of l.feeds.values()) FEEDS.set(keyOf(f), f);
/** Rang d'une série journalière parmi celles de sa source (pour étaler les lectures sur plusieurs minutes). */
const DAILY_RANK = new Map<string, number>();
for (const src of ['yahoo', 'coinbase'] as const) {
  [...FEEDS.values()]
    .filter((f) => f.tf === '1d' && f.src === src)
    .map((f) => f.sym)
    .sort()
    .forEach((s, i) => DAILY_RANK.set(`1d|${s}`, i));
}

/** Jour de la semaine (0 = dimanche) d'une date « AAAA-MM-JJ ». */
const weekday = (date: string): number => new Date(`${date}T12:00:00Z`).getUTCDay();

/** Fin de barre de 5 min dans la plage du marché (jours ouvrés, heure locale) ; sans plage connue : toujours. */
export function inSession(sym: string, t: number): boolean {
  const s = SESSIONS[sym];
  if (!s) return true;
  const l = localTime(t, s.tz);
  const wd = weekday(l.date);
  return wd >= 1 && wd <= 5 && l.minutes >= s.from + 5 && l.minutes <= s.to;
}

/** La série est-elle à lire au créneau `slot` (heure prévue du passage) ? */
export function dueAt(f: Feed, slot: number): boolean {
  const d = new Date(slot);
  const min = d.getUTCMinutes();
  const hour = d.getUTCHours();
  // 5 min : une minute après la fin de chaque barre, si cette fin tombe dans la plage du marché.
  if (f.tf === '5m') return min % 5 === 1 && inSession(f.sym, slot - 60_000);
  if (f.tf === '1h') return min === (f.src === 'kraken' ? 2 : 3);
  const rank = DAILY_RANK.get(keyOf(f)) ?? 0;
  if (f.src === 'yahoo') return hour === 22 && min === 41 + (rank % 5);
  return hour === 0 && min === 42 + (rank % 3);
}

// ---------------------------------------------------------------------------- stockage (une table clé → texte)

export const SCHEMA = 'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated INTEGER NOT NULL)';

/** Barres en colonnes d'entiers (écarts de temps en secondes, cours × px) : rapide à écrire et à relire. */
interface Columns {
  px: number;
  vs: number;
  t0: number;
  d: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
}
export function encodeBars(bars: Bar[], f: Pick<Feed, 'px' | 'vs'>): string {
  const n = bars.length;
  const col: Columns = { px: f.px, vs: f.vs, t0: bars[0]?.t ?? 0, d: new Array(n), o: new Array(n), h: new Array(n), l: new Array(n), c: new Array(n), v: new Array(n) };
  let prev = col.t0;
  for (let i = 0; i < n; i++) {
    const b = bars[i] as Bar;
    col.d[i] = Math.round((b.t - prev) / 1000);
    prev = b.t;
    col.o[i] = Math.round(b.o * f.px);
    col.h[i] = Math.round(b.h * f.px);
    col.l[i] = Math.round(b.l * f.px);
    col.c[i] = Math.round(b.c * f.px);
    col.v[i] = Math.round(b.v * f.vs);
  }
  return JSON.stringify(col);
}
export function decodeBars(text: string): Bar[] {
  const j = JSON.parse(text) as Columns;
  const out = new Array<Bar>(j.d.length);
  let t = j.t0;
  for (let i = 0; i < j.d.length; i++) {
    t += (j.d[i] as number) * 1000;
    out[i] = { t, o: (j.o[i] as number) / j.px, h: (j.h[i] as number) / j.px, l: (j.l[i] as number) / j.px, c: (j.c[i] as number) / j.px, v: (j.v[i] as number) / j.vs };
  }
  return out;
}
const decode = (k: string, v: string): unknown => (k.startsWith('bars|') ? decodeBars(v) : JSON.parse(v));

/**
 * Mémoire du Worker entre deux passages (tant que Cloudflare garde la même instance) : valeurs déjà décodées, avec
 * leur estampille. Une lecture ne décode que ce qui a changé depuis.
 */
const cache = new Map<string, { updated: number; value: unknown }>();
let schemaReady = false;
/** Oublie la mémoire du Worker (essais : comme une instance neuve). */
export function resetMemory(): void {
  cache.clear();
  schemaReady = false;
}
/** Remplit la mémoire avec tout ce que la base contient pour ces comptes (essais : comme une instance déjà chaude). */
export async function warmMemory(db: D1Database): Promise<void> {
  await load(db, ['meta', 'summary', ...[...FEEDS.keys()].map((k) => `bars|${k}`), ...LIVE.map((l) => `book|${l.account.id}`), ...[...FEEDS.values()].filter((f) => f.src === 'kraken').map((f) => `funding|${f.sym}`)]);
}

async function load(db: D1Database, keys: string[]): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  const uniq = [...new Set(keys)];
  if (!uniq.length) return out;
  const marks = (await db.prepare(`SELECT k, updated FROM kv WHERE k IN (${uniq.map(() => '?').join(',')})`).bind(...uniq).all<{ k: string; updated: number }>()).results;
  const stale = marks.filter((r) => cache.get(r.k)?.updated !== Number(r.updated)).map((r) => r.k);
  if (stale.length) {
    const rows = (await db.prepare(`SELECT k, v, updated FROM kv WHERE k IN (${stale.map(() => '?').join(',')})`).bind(...stale).all<{ k: string; v: string; updated: number }>()).results;
    for (const r of rows) cache.set(r.k, { updated: Number(r.updated), value: decode(r.k, r.v) });
  }
  for (const r of marks) {
    const c = cache.get(r.k);
    if (c) out.set(r.k, c.value);
  }
  return out;
}

/** Écritures d'un passage, envoyées ensemble à la fin. */
class Writes {
  private readonly items = new Map<string, unknown>();
  set(k: string, v: unknown): void {
    this.items.set(k, v);
  }
  async flush(db: D1Database, now: number): Promise<void> {
    if (!this.items.size) return;
    const sql = 'INSERT INTO kv (k, v, updated) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated';
    const stmts = [...this.items].map(([k, v]) => {
      const f = k.startsWith('bars|') ? FEEDS.get(k.slice(5)) : undefined;
      return db.prepare(sql).bind(k, f ? encodeBars(v as Bar[], f) : JSON.stringify(v), now);
    });
    try {
      await db.batch(stmts);
      for (const [k, v] of this.items) cache.set(k, { updated: now, value: v });
    } catch (e) {
      for (const k of this.items.keys()) cache.delete(k);
      throw e;
    }
  }
}

function merge(a: Bar[], b: Bar[], keep: number): Bar[] {
  const m = new Map<number, Bar>();
  for (const x of a) m.set(x.t, x);
  for (const x of b) m.set(x.t, x);
  return [...m.values()].sort((x, y) => x.t - y.t).slice(-keep);
}
const sameBar = (a: Bar | undefined, b: Bar | undefined): boolean => !!a && !!b && a.t === b.t && a.o === b.o && a.h === b.h && a.l === b.l && a.c === b.c && a.v === b.v;
/** Arrondi à l'échelle de stockage : les cours relus et les cours frais sont alors comparables. */
const rounded = (bars: Bar[], f: Feed): Bar[] => bars.map((b) => ({ t: b.t, o: Math.round(b.o * f.px) / f.px, h: Math.round(b.h * f.px) / f.px, l: Math.round(b.l * f.px) / f.px, c: Math.round(b.c * f.px) / f.px, v: Math.round(b.v * f.vs) / f.vs }));

/** Barres journalières Yahoo : début à 9 h 30 (New York), comme dans l'arène. */
export function normalizeDaily(bars: Bar[]): Bar[] {
  return bars.map((b) => {
    const d = localTime(b.t + 3 * H, NY).date;
    let t = Date.parse(`${d}T14:30:00Z`);
    if (localTime(t, NY).minutes !== 570) t -= H;
    return { ...b, t };
  });
}
/** Fin d'une barre : journalier Yahoo = séance de 6 h 30 ; sinon la durée de la barre. */
const barEnd = (f: Feed, b: Bar): number => b.t + (f.tf === '1d' && f.src === 'yahoo' ? 390 * 60_000 : MS[f.tf]);

/** Heures d'ouverture pour le cours en direct des positions Yahoo : forex et or presque 24 h/24, ETF en séance. */
function yahooOpen(sym: string, t: number): boolean {
  const ny = localTime(t, NY);
  const wd = weekday(ny.date);
  if (sym === 'GC=F' || sym === 'EURUSD=X') return !(wd === 6 || (wd === 0 && ny.minutes < 1080) || (wd === 5 && ny.minutes >= 1020));
  return wd >= 1 && wd <= 5 && ny.minutes >= 570 && ny.minutes <= 965;
}

// ---------------------------------------------------------------------------- ce que lit la page

export interface OpenView {
  symbol: string;
  side: 'long' | 'short';
  qty: number;
  entry: number;
  last: number;
  pnl: number;
}
export interface AccountView {
  id: string;
  rank: number;
  name: string;
  tier: string;
  market: string;
  leverage: string;
  setting: string;
  capital: number;
  cash: number;
  equity: number;
  pnl: number;
  pnlPct: number;
  peak: number;
  maxDrawdownPct: number;
  trades: number;
  wins: number;
  open: OpenView[];
  lastTrades: Array<{ symbol: string; side: string; openedAt: number; closedAt: number; pnl: number; exitReason: string; reason: string }>;
  /** Equity en fin de journée (Paris), un point par jour depuis le départ. */
  daily: Array<[string, number]>;
  /** Dernière reprise du moteur pour ce compte (ms), 0 si jamais. */
  ranAt: number;
}
export interface Summary {
  generatedAt: number;
  startMs: number;
  mode: 'papier';
  accounts: AccountView[];
  notes: string[];
  /** Séries dont l'historique est encore en cours de chargement. */
  filling: number;
}
/** État d'un compte entre deux passages. */
interface Book {
  state?: EngineState;
  trades: Trade[];
  tradeCount: number;
  wins: number;
  /** Comptes journaliers : départ immédiat, cours pris au départ et heure de ce départ (ms). */
  startPrices?: Record<string, number>;
  startAt?: number;
}
/** Compte qui ne décide que sur des barres d'un jour (ETF, crypto journalier). */
const isDaily = (l: Live): boolean => [...l.feeds.values()].every((f) => f.tf === '1d');
interface Meta {
  /** Séries encore trop courtes, dans l'ordre où elles seront complétées. */
  short: string[];
  /** Heure (ms) du dernier financement noté. */
  fundingHour?: number;
}

// ---------------------------------------------------------------------------- un passage

export interface CycleOptions {
  /** Instant présent (ms). */
  now?: number;
  /** Heure prévue du passage (créneaux) ; par défaut `now`. */
  slot?: number;
  /** Toutes les séries complètes, comme si tout était dû. */
  force?: boolean;
}

export async function cycle(env: Env, opts: CycleOptions = {}): Promise<{ notes: string[]; ran: string[]; fetched: string[] }> {
  const now = opts.now ?? Date.now();
  const slot = opts.slot ?? now;
  const db = env.DB;
  if (!schemaReady) {
    await db.prepare(SCHEMA).run();
    schemaReady = true;
  }
  const start = Number(env.START_MS ?? START_MS);
  const notes: string[] = [];
  const writes = new Writes();
  let budget = BUDGET;
  const spend = (n = 1): boolean => {
    if (budget < n) return false;
    budget -= n;
    return true;
  };

  const head = await load(db, ['meta', 'summary']);
  const stored = head.get('meta') as Meta | undefined;
  const meta: Meta = stored ? { ...stored, short: [...stored.short] } : { short: [...FEEDS.keys()] };
  const prev = (head.get('summary') as Summary | undefined) ?? null;
  const shortSet = new Set(meta.short.filter((k) => FEEDS.has(k)));
  const backfill = [...shortSet].slice(0, 1);
  const wanted = [...FEEDS.entries()].filter(([k, f]) => backfill.includes(k) || (!shortSet.has(k) && (opts.force || dueAt(f, slot))));

  // 1. Séries à lire, financement des perpétuels si l'heure a changé.
  const hour = Math.floor(now / H) * H;
  const perps = [...new Set([...FEEDS.values()].filter((f) => f.src === 'kraken').map((f) => f.sym))];
  const openNow = new Set((prev?.accounts ?? []).flatMap((a) => a.open.map((o) => o.symbol)));
  // Financement relu quand l'heure change et quand un compte sur perpétuels peut bouger (une de ses séries est lue).
  const perpFeeds = new Set(LIVE.filter((l) => [...l.feeds.values()].some((f) => f.src === 'kraken')).flatMap((l) => [...l.feeds.values()].map(keyOf)));
  const needFunding = meta.fundingHour !== hour || !!opts.force || wanted.some(([k]) => perpFeeds.has(k));
  const got = await load(db, [...wanted.map(([k]) => `bars|${k}`), ...(needFunding ? perps.map((s) => `funding|${s}`) : [])]);

  const prices: Record<string, number> = {};
  if (perps.length && (needFunding || perps.some((s) => openNow.has(s))) && spend(perps.length)) {
    try {
      const tk = await feed.krakenTickers(perps);
      for (const s of perps) if (tk[s]) prices[s] = (tk[s] as { last: number }).last;
      if (meta.fundingHour !== hour) {
        for (const s of perps) {
          const hist = (got.get(`funding|${s}`) as Array<[number, number]> | undefined) ?? [];
          const t = tk[s];
          if (t && !hist.some(([h]) => h === hour)) {
            const next = [...hist.filter(([h]) => h > now - 14 * DAY), [hour, t.funding] as [number, number]];
            writes.set(`funding|${s}`, next);
            got.set(`funding|${s}`, next);
          }
        }
        if (perps.every((s) => tk[s])) meta.fundingHour = hour;
      }
    } catch (e) {
      notes.push(`Kraken Futures : ${String(e)}`);
    }
  }
  for (const s of perps) if (got.has(`funding|${s}`)) FUNDING.set(s, new Map(got.get(`funding|${s}`) as Array<[number, number]>));

  // 2. Séries : complétées vers l'avant ; celle dont c'est le tour, vers le passé.
  const series = new Map<string, Bar[]>();
  const changed = new Set<string>();
  for (const [key, f] of wanted) {
    const old = (got.get(`bars|${key}`) as Bar[] | undefined) ?? [];
    const filling = shortSet.has(key);
    const lastT = old.at(-1)?.t ?? 0;
    let fresh: Bar[] = [];
    try {
      if (f.src === 'yahoo' && f.tf === '5m') {
        // Yahoo ajoute une barre « en cours » à l'heure de la dernière cotation : seules les barres alignées comptent,
        // et seulement celles terminées avant cette cotation (cours publiés en retard pour l'or).
        if (spend()) {
          const r = await feed.yahoo5m(f.sym, filling ? '1mo' : '1d');
          fresh = r.bars.filter((b) => b.t % MS['5m'] === 0 && b.t + MS['5m'] <= Math.min(r.asOf, now));
        }
      } else if (f.src === 'yahoo') {
        if (spend()) fresh = normalizeDaily(await feed.yahooDaily(f.sym, filling ? '2y' : '5d'));
      } else {
        const from = filling || !lastT ? now - f.keep * MS[f.tf] : lastT - MS[f.tf];
        if (f.src === 'coinbase') {
          // Coinbase d'abord (la source de l'arène) ; en cas de refus (souvent 429 depuis Cloudflare), Kraken au comptant.
          try {
            if (spend(Math.ceil((now - from) / (300 * MS[f.tf])))) fresh = await feed.coinbase(f.sym, MS[f.tf] / 1000, from, now);
          } catch (e) {
            if (!spend()) throw e;
            fresh = await feed.krakenOhlc(f.sym, MS[f.tf] / 1000, from);
          }
        } else if (spend()) fresh = await feed.krakenFutures1h(f.sym, from, now);
      }
    } catch (e) {
      notes.push(`${f.sym} (${f.tf}) : ${String(e)}`);
    }
    // Seulement des barres terminées : une barre gardée « en cours » passerait plus tard pour finie avec de faux cours.
    fresh = fresh.filter((b) => barEnd(f, b) <= now);
    let bars = old;
    if (fresh.length) {
      bars = merge(old, rounded(fresh, f), f.keep);
      if (bars.length !== old.length || !sameBar(bars.at(-1), old.at(-1)) || bars[0]?.t !== old[0]?.t) {
        writes.set(`bars|${key}`, bars);
        changed.add(key);
      }
    }
    if (filling) {
      // Complète : assez de barres (le 5 min : ce qu'il y a sur un mois). Sinon, au bout de la file.
      shortSet.delete(key);
      if (!(bars.length >= f.keep * 0.6 || (f.tf === '5m' && fresh.length > 0))) shortSet.add(key);
    }
    series.set(key, bars);
  }
  meta.short = [...shortSet];
  if (JSON.stringify(meta) !== JSON.stringify(stored ?? null)) writes.set('meta', meta);

  // 3. Comptes dont une série a bougé : reprise du moteur jusqu'à la dernière barre complète commune à leurs séries.
  const movers = LIVE.filter((l) => opts.force || [...l.feeds.values()].some((f) => changed.has(keyOf(f))));
  const more = await load(db, [
    ...movers.map((l) => `book|${l.account.id}`),
    ...movers.flatMap((l) => [...l.feeds.values()].map((f) => `bars|${keyOf(f)}`)).filter((k) => !series.has(k.slice(5))),
  ]);
  const ran: string[] = [];
  const books = new Map<string, Book>();
  const ranBefore = (id: string): boolean => (prev?.accounts.find((a) => a.id === id)?.ranAt ?? 0) > 0;
  for (const l of movers) {
    const id = l.account.id;
    const saved = more.get(`book|${id}`) as Book | undefined;
    const book: Book = saved ? structuredClone(saved) : { trades: [], tradeCount: 0, wins: 0 };
    if (now < start) continue;
    // Compte journalier pas encore parti : son départ immédiat (plus bas) passe d'abord.
    if (isDaily(l) && !book.state && !ranBefore(id)) continue;
    const data = new Map<string, Bar[]>();
    for (const [s, f] of l.feeds) {
      const all = series.get(keyOf(f)) ?? (more.get(`bars|${keyOf(f)}`) as Bar[] | undefined) ?? [];
      const last = all.at(-1);
      data.set(s, last && barEnd(f, last) <= now ? all : all.filter((b) => barEnd(f, b) <= now));
    }
    const lasts = [...data.values()].map((b) => b.at(-1)?.t ?? 0);
    if (lasts.some((t) => t === 0)) continue;
    // Une série en retard (barre pas encore lue ou publiée) retient le compte ; une série muette trop longtemps (panne)
    // ne le bloque plus : 2 h en 5 min, 3 h en horaire, 4 jours en journalier (week-end prolongé compris).
    const hi = Math.max(...lasts);
    const tol = Math.max(...[...l.feeds.values()].map((f) => WAIT[f.tf]));
    const upTo = Math.min(...lasts.filter((t) => t >= hi - tol));
    if (upTo <= (book.state?.lastT ?? start - 1)) continue;
    try {
      const r = runPortfolio(l.variant.spec, data, start, upTo + 1, undefined, book.state);
      book.state = r.state;
      for (const t of r.trades) {
        book.tradeCount++;
        if (t.pnl > 0) book.wins++;
      }
      book.trades = [...book.trades, ...r.trades].slice(-30);
      books.set(id, book);
      writes.set(`book|${id}`, book);
      ran.push(id);
    } catch (e) {
      notes.push(`${l.account.name} : ${String(e)}`);
    }
  }

  // 3 bis. Départ immédiat des comptes journaliers : au départ du suivi, ils n'attendent pas la prochaine clôture d'un
  // jour. Ils décident tout de suite sur leurs barres terminées, comme si une barre se fermait au départ au dernier cours
  // (leurs ordres « à la clôture » sont remplis à ce cours), puis continuent sur les vraies clôtures. Deux par passage.
  if (now >= start) {
    const starters = LIVE.filter((l) => isDaily(l) && !ran.includes(l.account.id) && !ranBefore(l.account.id)).slice(0, 2);
    if (starters.length) {
      const got2 = await load(db, [
        ...starters.map((l) => `book|${l.account.id}`),
        ...starters.flatMap((l) => [...l.feeds.values()].map((f) => `bars|${keyOf(f)}`)).filter((k) => !series.has(k.slice(5))),
      ]);
      const ySyms = [...new Set(starters.flatMap((l) => [...l.feeds.values()].filter((f) => f.src === 'yahoo').map((f) => f.sym)))];
      try {
        if (ySyms.length && spend()) Object.assign(prices, await feed.yahooLast(ySyms));
        if (starters.some((l) => [...l.feeds.values()].some((f) => f.src !== 'yahoo')) && spend()) Object.assign(prices, await feed.krakenSpot());
      } catch (e) {
        notes.push(`départ immédiat (cours) : ${String(e)}`);
      }
      for (const l of starters) {
        const id = l.account.id;
        if (got2.has(`book|${id}`)) continue;
        const startPrices: Record<string, number> = {};
        const data = new Map<string, Bar[]>();
        for (const [s, f] of l.feeds) {
          const px = prices[s];
          if (!(typeof px === 'number' && px > 0)) break;
          startPrices[s] = px;
          const all = series.get(keyOf(f)) ?? (got2.get(`bars|${keyOf(f)}`) as Bar[] | undefined) ?? [];
          data.set(s, [...all.filter((b) => b.t < start && barEnd(f, b) <= now), { t: start, o: px, h: px, l: px, c: px, v: 0 }]);
        }
        if (data.size < l.feeds.size) continue;
        try {
          const r = runPortfolio(l.variant.spec, data, start, start + 1);
          const book: Book = { state: r.state, trades: r.trades, tradeCount: r.trades.length, wins: r.trades.filter((t) => t.pnl > 0).length, startPrices, startAt: now };
          books.set(id, book);
          writes.set(`book|${id}`, book);
          ran.push(id);
        } catch (e) {
          notes.push(`${l.account.name} : ${String(e)}`);
        }
      }
    }
  }

  // 4. Derniers cours des positions ouvertes : Kraken (déjà lu), Yahoo pendant les heures de marché, crypto au comptant.
  const openSyms = new Set<string>();
  for (const l of LIVE) {
    const st = books.get(l.account.id)?.state;
    const open = st ? st.positions.map((p) => p.symbol) : (prev?.accounts.find((a) => a.id === l.account.id)?.open ?? []).map((o) => o.symbol);
    for (const s of open) openSyms.add(s);
  }
  const yahooSyms = [...openSyms].filter((s) => [...FEEDS.values()].some((f) => f.sym === s && f.src === 'yahoo'));
  if (yahooSyms.length && (opts.force || new Date(slot).getUTCMinutes() % 15 === 0 || yahooSyms.some((s) => yahooOpen(s, now))) && spend()) {
    try {
      Object.assign(prices, await feed.yahooLast(yahooSyms));
    } catch (e) {
      notes.push(`Yahoo (derniers cours) : ${String(e)}`);
    }
  }
  if ([...openSyms].some((s) => s.endsWith('-USD')) && spend()) {
    try {
      Object.assign(prices, await feed.krakenSpot());
    } catch (e) {
      notes.push(`Kraken (comptant) : ${String(e)}`);
    }
  }

  // 5. PnL en direct de chaque compte.
  const views: AccountView[] = [];
  for (const l of LIVE) {
    const a = l.account;
    const cap = l.variant.spec.capital;
    const old = prev?.accounts.find((x) => x.id === a.id);
    const book = books.get(a.id);
    const st = book?.state;
    const cash = st ? st.cash : (old?.cash ?? cap);
    const lastOf = st ? new Map(st.last) : new Map((old?.open ?? []).map((o) => [o.symbol, o.last]));
    const positions = st ? st.positions.map((p) => ({ symbol: p.symbol, side: p.side, qty: p.qty, entry: p.entry })) : (old?.open ?? []);
    const open: OpenView[] = positions.map((p) => {
      const last = prices[p.symbol] ?? series.get(`5m|${p.symbol}`)?.at(-1)?.c ?? lastOf.get(p.symbol) ?? p.entry;
      return { symbol: p.symbol, side: p.side, qty: p.qty, entry: p.entry, last, pnl: (p.side === 'long' ? 1 : -1) * p.qty * (last - p.entry) };
    });
    const liquidated = st ? st.liquidatedAt !== undefined : old !== undefined && old.equity <= 0 && old.open.length === 0 && old.cash <= 0;
    const equity = liquidated ? 0 : Math.max(0, cash + open.reduce((s, o) => s + o.pnl, 0));
    let peak = old?.peak ?? cap;
    let mdd = old?.maxDrawdownPct ?? 0;
    let daily = old?.daily ?? [];
    if (now >= start) {
      peak = Math.max(peak, equity);
      mdd = Math.max(mdd, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
      const d = localTime(now, 'Europe/Paris').date;
      daily = daily.filter(([x]) => x !== d).concat([[d, Math.round(equity * 100) / 100]]).slice(-400);
    }
    views.push({
      id: a.id,
      rank: a.rank,
      name: a.name,
      tier: a.tier,
      market: a.market,
      leverage: a.leverageLabel,
      setting: l.variant.label,
      capital: cap,
      cash,
      equity,
      pnl: equity - cap,
      pnlPct: ((equity - cap) / cap) * 100,
      peak,
      maxDrawdownPct: mdd,
      trades: book ? book.tradeCount : (old?.trades ?? 0),
      wins: book ? book.wins : (old?.wins ?? 0),
      open,
      lastTrades: book ? book.trades.slice(-5).reverse().map((t) => ({ symbol: t.symbol, side: t.side, openedAt: t.openedAt, closedAt: t.closedAt, pnl: t.pnl, exitReason: t.exitReason, reason: t.reason })) : (old?.lastTrades ?? []),
      daily,
      ranAt: ran.includes(a.id) ? now : (old?.ranAt ?? 0),
    });
  }
  writes.set('summary', { generatedAt: now, startMs: start, mode: 'papier', accounts: views, notes, filling: shortSet.size } satisfies Summary);
  await writes.flush(db, now);
  return { notes, ran, fetched: [...changed] };
}

// ---------------------------------------------------------------------------- HTTP

/** Comparaison en temps constant du jeton du lien. */
function sameToken(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' };
const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

async function summaryText(db: D1Database): Promise<string> {
  if (!schemaReady) {
    await db.prepare(SCHEMA).run();
    schemaReady = true;
  }
  const row = await db.prepare('SELECT v FROM kv WHERE k = ?').bind('summary').first<{ v: string }>();
  return row?.v ?? JSON.stringify({ generatedAt: 0, startMs: START_MS, mode: 'papier', accounts: [], notes: ['pas encore de passage'], filling: FEEDS.size } satisfies Summary);
}

export default {
  async scheduled(controller: { scheduledTime: number }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(
      cycle(env, { now: Date.now(), slot: controller.scheduledTime }).then(
        (r) => {
          if (r.ran.length || r.fetched.length || r.notes.length) console.log(JSON.stringify(r));
        },
        (e) => console.error(`passage en échec : ${String(e)}`),
      ),
    );
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const [token, action, ...rest] = url.pathname.split('/').filter(Boolean);
    if (!sameToken(token ?? '', env.TOKEN ?? '') || rest.length) return new Response('introuvable', { status: 404 });
    if (!action && !url.pathname.endsWith('/')) return Response.redirect(`${url.origin}/${token}/`, 301);
    if (action === 'api') return new Response(await summaryText(env.DB), { headers: JSON_HEADERS });
    if (action === 'run') return new Response(JSON.stringify(await cycle(env, { force: url.searchParams.has('tout') })), { headers: JSON_HEADERS });
    if (action) return new Response('introuvable', { status: 404 });
    return new Response(pageHtml(await summaryText(env.DB)), { headers: PAGE_HEADERS });
  },
};
