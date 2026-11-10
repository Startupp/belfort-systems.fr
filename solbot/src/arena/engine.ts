/**
 * Arène : moteur papier commun à tous les portefeuilles parallèles.
 *
 * Un portefeuille = une stratégie, un marché, un capital fictif, un levier maximal et un modèle de coûts.
 * Le moteur avance barre par barre, dans l'ordre du temps ; la stratégie ne voit que les barres déjà closes.
 * Aucun ordre réel, aucune clé, aucun compte.
 *
 * Règles d'exécution (prudentes) :
 * - ordre « close » : exécuté au cours de clôture de la barre qui l'a déclenché ; « open » : à l'ouverture de la suivante ;
 * - ordre stop : exécuté au prix du stop, ou à l'ouverture si le cours a sauté par-dessus ;
 * - ordre limite : exécuté seulement si le cours passe strictement à travers le prix (file d'attente) ;
 * - si le stop et l'objectif tombent dans la même barre, c'est le stop qui compte ; sur la barre d'entrée, seul le stop
 *   est vérifié ;
 * - levier : la somme des montants engagés ne dépasse jamais equity × levier maximal ; clôture de toutes les positions
 *   quand l'equity passe sous 50 % de la marge utilisée (règle européenne) ; jamais de solde négatif ;
 * - aucune position ne reste ouverte plus de `maxHoldMs` (3 jours par défaut) ;
 * - financement des positions à levier tenues au passage de 22 h UTC (CFD).
 */

import type { Bar } from '../desk/types.ts';

export type Side = 'long' | 'short';

export interface Costs {
  /** Commission par côté, en points de base du montant (ordres au marché et stop). */
  feeBps: number;
  /** Commission des ordres limites passifs, par côté (défaut : feeBps). */
  makerFeeBps?: number;
  /** Glissement et demi-écart par côté sur les ordres au marché et stop, en points de base. */
  slipBps: number;
  /** Financement d'une position à levier tenue la nuit, en % annuel du montant. */
  financingPct: number;
  /** Plus petit montant d'ordre, en $. */
  minNotional: number;
  /** Pas de quantité (ex. 1 once = 0,01 lot pour le CFD or) ; quantité libre sinon. */
  qtyStep?: number;
}

export interface EntryIntent {
  type: 'enter';
  symbol: string;
  side: Side;
  /** close : à la clôture de la barre courante ; open : à l'ouverture suivante ; stop / limit : ordre en attente à `price`. */
  order: 'close' | 'open' | 'stop' | 'limit';
  price?: number;
  /** Fin de validité d'un ordre en attente (ms). */
  expires?: number;
  /** Stop de protection (prix). */
  stop?: number;
  /** Objectif (ordre limite de sortie). */
  target?: number;
  /** Sortie forcée à la clôture de la première barre qui se termine à cet instant ou après. */
  exitBy?: number;
  /** Sortie à l'ouverture de la barre suivante (stratégie « de nuit »). */
  exitAtNextOpen?: boolean;
  /** risk : part de l'equity perdue si le stop est touché (0,01 = 1 %) ; notional : montant en multiple de l'equity. */
  size: { risk: number } | { notional: number };
  reason: string;
  /** Étiquette libre (niveau de grille, sens…) pour retrouver l'ordre ou la position. */
  tag?: string;
  /** Annule les autres ordres en attente portant ce groupe quand celui-ci est exécuté (OCO). */
  oco?: string;
}

export type Intent =
  | EntryIntent
  | { type: 'exit'; id: string; order: 'close' | 'open'; reason: string }
  | { type: 'stop'; id: string; stop: number }
  | { type: 'cancel'; tag?: string; symbol?: string };

export interface Position {
  id: string;
  symbol: string;
  side: Side;
  qty: number;
  entry: number;
  stop?: number;
  initialStop?: number;
  target?: number;
  exitBy?: number;
  exitAtNextOpen?: boolean;
  openedAt: number;
  /** Clôture de la barre d'entrée : l'objectif n'est pas vérifié avant. */
  enteredBarT: number;
  reason: string;
  tag?: string;
  fees: number;
  financing: number;
  equityAtEntry: number;
}

export interface PendingOrder {
  id: string;
  intent: EntryIntent;
  createdAt: number;
}

export interface Trade {
  id: string;
  symbol: string;
  side: Side;
  qty: number;
  entry: number;
  exit: number;
  openedAt: number;
  closedAt: number;
  notional: number;
  /** Résultat net (frais et financement compris), en $. */
  pnl: number;
  /** Résultat net en % de l'equity au moment de l'entrée. */
  pnlPct: number;
  /** Résultat en multiple du risque initial, si un stop existait. */
  r?: number;
  fees: number;
  financing: number;
  reason: string;
  exitReason: string;
  tag?: string;
}

export interface StrategyView {
  /** Début de la barre courante (ms). */
  t: number;
  /** Séries complètes par symbole : la stratégie ne doit lire que les indices ≤ idx. */
  series: ReadonlyMap<string, Bar[]>;
  /** Dernière barre connue par symbole (−1 si aucune). */
  idx: ReadonlyMap<string, number>;
  /** Symboles qui ont une barre qui se termine maintenant. */
  fresh: ReadonlySet<string>;
  positions: readonly Position[];
  pending: readonly PendingOrder[];
  equity: number;
}

export interface Strategy {
  onBar(v: StrategyView): Intent[];
}

export interface PortfolioSpec {
  id: string;
  name: string;
  capital: number;
  maxLeverage: number;
  allowShort: boolean;
  costs: Costs;
  /** Durée d'une barre (ms) ; pour des barres journalières, durée de la séance. */
  barMs: number;
  symbols: string[];
  maxHoldMs?: number;
  /** Clôture de marge (part de la marge utilisée) ; 0,5 = règle européenne. */
  closeOutLevel?: number;
  /** Fabrique de la stratégie ; `aux` : séries d'appoint (ex. historique 5 min pour une stratégie en 1 min). */
  strategy: (aux?: ReadonlyMap<string, Bar[]>) => Strategy;
}

export interface RunResult {
  id: string;
  from: number;
  to: number;
  capital: number;
  equity: number;
  cash: number;
  trades: Trade[];
  open: Position[];
  /** Courbe d'equity : un point par barre traitée. */
  curve: Array<[number, number]>;
  liquidatedAt?: number;
  fees: number;
  financing: number;
  /** Temps passé avec au moins une position, en ms. */
  exposureMs: number;
}

const DAY = 86_400_000;
export const THREE_DAYS = 3 * DAY;

/** Fait tourner un portefeuille de `from` à `to` (les barres antérieures servent d'historique aux indicateurs). */
export function runPortfolio(spec: PortfolioSpec, series: ReadonlyMap<string, Bar[]>, from: number, to: number, aux?: ReadonlyMap<string, Bar[]>): RunResult {
  const strategy = spec.strategy(aux);
  const maxHold = spec.maxHoldMs ?? THREE_DAYS;
  const closeOut = spec.closeOutLevel ?? 0.5;
  const c = spec.costs;
  const slip = c.slipBps / 1e4;
  const fee = (notional: number, limit: boolean): number => (notional * (limit ? (c.makerFeeBps ?? c.feeBps) : c.feeBps)) / 1e4;

  let cash = spec.capital;
  let seq = 0;
  const positions: Position[] = [];
  let pending: PendingOrder[] = [];
  const trades: Trade[] = [];
  const curve: Array<[number, number]> = [];
  const last = new Map<string, number>();
  const idx = new Map<string, number>(spec.symbols.map((s) => [s, -1]));
  let liquidatedAt: number | undefined;
  let fees = 0;
  let financing = 0;
  let exposureMs = 0;
  let lastT = from;

  // Calendrier commun : tous les débuts de barre, tous symboles confondus.
  const times = new Set<number>();
  for (const s of spec.symbols) for (const b of series.get(s) ?? []) if (b.t < to) times.add(b.t);
  const timeline = [...times].sort((a, b) => a - b);
  const cursor = new Map<string, number>(spec.symbols.map((s) => [s, 0]));

  const unreal = (p: Position, px: number): number => (p.side === 'long' ? 1 : -1) * p.qty * (px - p.entry);
  const equityNow = (): number => cash + positions.reduce((s, p) => s + unreal(p, last.get(p.symbol) ?? p.entry), 0);
  const usedNotional = (): number => positions.reduce((s, p) => s + p.qty * p.entry, 0);

  function close(p: Position, rawPx: number, at: number, why: string, kind: 'market' | 'limit' | 'stop'): void {
    const px = kind === 'limit' ? rawPx : p.side === 'long' ? rawPx * (1 - slip) : rawPx * (1 + slip);
    const f = fee(p.qty * px, kind === 'limit');
    const gross = unreal(p, px);
    cash += gross - f;
    fees += f;
    const totalFees = p.fees + f;
    const pnl = gross - totalFees - p.financing;
    const risk = p.initialStop !== undefined ? p.qty * Math.abs(p.entry - p.initialStop) : 0;
    trades.push({
      id: p.id,
      symbol: p.symbol,
      side: p.side,
      qty: p.qty,
      entry: p.entry,
      exit: px,
      openedAt: p.openedAt,
      closedAt: at,
      notional: p.qty * p.entry,
      pnl,
      pnlPct: (pnl / p.equityAtEntry) * 100,
      r: risk > 0 ? pnl / risk : undefined,
      fees: totalFees,
      financing: p.financing,
      reason: p.reason,
      exitReason: why,
      tag: p.tag,
    });
    positions.splice(positions.indexOf(p), 1);
    last.set(p.symbol, rawPx);
  }

  function open(intent: EntryIntent, rawPx: number, at: number, barT: number, kind: 'market' | 'limit' | 'stop'): void {
    if (liquidatedAt !== undefined) return;
    if (intent.side === 'short' && !spec.allowShort) return;
    const px = kind === 'limit' ? rawPx : intent.side === 'long' ? rawPx * (1 + slip) : rawPx * (1 - slip);
    const eq = equityNow();
    if (!(eq > 0)) return;
    let qty: number;
    if ('risk' in intent.size) {
      const dist = intent.stop !== undefined ? Math.abs(px - intent.stop) : 0;
      const wrongSide = intent.stop !== undefined && (intent.side === 'long' ? intent.stop >= px : intent.stop <= px);
      if (!(dist > 0) || wrongSide) return;
      qty = (eq * intent.size.risk) / dist;
    } else {
      qty = (eq * intent.size.notional) / px;
    }
    const room = eq * spec.maxLeverage - usedNotional();
    qty = Math.min(qty, Math.max(0, room) / px);
    if (c.qtyStep) qty = Math.floor(qty / c.qtyStep + 1e-9) * c.qtyStep;
    if (!(qty > 0) || qty * px < c.minNotional) return;
    const f = fee(qty * px, kind === 'limit');
    cash -= f;
    fees += f;
    positions.push({
      id: `${spec.id}-${++seq}`,
      symbol: intent.symbol,
      side: intent.side,
      qty,
      entry: px,
      stop: intent.stop,
      initialStop: intent.stop,
      target: intent.target,
      exitBy: intent.exitBy,
      exitAtNextOpen: intent.exitAtNextOpen,
      openedAt: at,
      enteredBarT: barT,
      reason: intent.reason,
      tag: intent.tag,
      fees: f,
      financing: 0,
      equityAtEntry: eq,
    });
    if (intent.oco) pending = pending.filter((o) => o.intent.oco !== intent.oco);
  }

  for (const t of timeline) {
    if (liquidatedAt !== undefined) break;
    const fresh = new Set<string>();
    const barOf = new Map<string, Bar>();
    for (const s of spec.symbols) {
      const arr = series.get(s) ?? [];
      let k = cursor.get(s) as number;
      while (k < arr.length && (arr[k] as Bar).t < t) k++;
      if (k < arr.length && (arr[k] as Bar).t === t) {
        idx.set(s, k);
        fresh.add(s);
        barOf.set(s, arr[k] as Bar);
        cursor.set(s, k + 1);
      } else cursor.set(s, k);
    }
    if (t < from) {
      for (const [s, b] of barOf) last.set(s, b.c);
      continue;
    }
    const barEnd = t + spec.barMs;

    // Financement des positions tenues au passage de 22 h UTC (CFD, avec ou sans levier).
    if (c.financingPct > 0) {
      const rolls = Math.floor((t - 22 * 3_600_000) / DAY) - Math.floor((lastT - 22 * 3_600_000) / DAY);
      if (rolls > 0) {
        for (const p of positions) {
          const cost = ((p.qty * p.entry * c.financingPct) / 100 / 365) * rolls;
          p.financing += cost;
          cash -= cost;
          financing += cost;
        }
      }
    }
    if (positions.length) exposureMs += Math.max(0, t - lastT);
    lastT = t;

    for (const [s, b] of barOf) {
      // a) Ordres en attente créés avant cette barre.
      for (const o of [...pending]) {
        if (!pending.includes(o) || o.intent.symbol !== s || o.createdAt >= t) continue;
        const it = o.intent;
        if (it.expires !== undefined && t >= it.expires) {
          pending = pending.filter((x) => x !== o);
          continue;
        }
        let px: number | undefined;
        let kind: 'market' | 'limit' | 'stop' = 'market';
        if (it.order === 'open') px = b.o;
        else if (it.order === 'stop' && it.price !== undefined) {
          kind = 'stop';
          if (it.side === 'long' ? b.o >= it.price : b.o <= it.price) px = b.o;
          else if (it.side === 'long' ? b.h >= it.price : b.l <= it.price) px = it.price;
        } else if (it.order === 'limit' && it.price !== undefined) {
          kind = 'limit';
          if (it.side === 'long' ? b.o < it.price : b.o > it.price) px = b.o;
          else if (it.side === 'long' ? b.l < it.price : b.h > it.price) px = it.price;
        }
        if (px === undefined) continue;
        pending = pending.filter((x) => x !== o);
        open(it, px, t, t, kind);
      }
      // b) Positions : sortie à l'ouverture, stop, objectif, sortie à l'heure, durée maximale.
      for (const p of positions.filter((x) => x.symbol === s)) {
        const long = p.side === 'long';
        // Position ouverte pendant cette barre : l'ouverture de la barre est antérieure à l'entrée.
        const before = p.enteredBarT < t;
        if (p.exitAtNextOpen && before) {
          close(p, b.o, t, 'sortie à l’ouverture', 'market');
          continue;
        }
        if (p.stop !== undefined) {
          if (before && (long ? b.o <= p.stop : b.o >= p.stop)) {
            close(p, b.o, t, 'stop (ouverture au-delà)', 'market');
            continue;
          }
          if (long ? b.l <= p.stop : b.h >= p.stop) {
            close(p, p.stop, barEnd, 'stop', 'stop');
            continue;
          }
        }
        if (p.target !== undefined && before) {
          if (long ? b.o >= p.target : b.o <= p.target) {
            close(p, b.o, t, 'objectif (ouverture au-delà)', 'market');
            continue;
          }
          if (long ? b.h > p.target : b.l < p.target) {
            close(p, p.target, barEnd, 'objectif', 'limit');
            continue;
          }
        }
        if (p.exitBy !== undefined && barEnd >= p.exitBy) {
          close(p, b.c, barEnd, 'fin de séance', 'market');
          continue;
        }
        if (barEnd - p.openedAt >= maxHold) close(p, b.c, barEnd, 'durée maximale (3 jours)', 'market');
      }
      // Clôture de marge en cours de barre : au pire cours de la barre pour les positions sur cet instrument.
      const mine = positions.filter((x) => x.symbol === s);
      if (spec.maxLeverage > 1 && mine.length) {
        const adverse = (p: Position): number => (p.side === 'long' ? b.l : b.h);
        const worst = cash + positions.reduce((sum, p) => sum + unreal(p, p.symbol === s ? adverse(p) : (last.get(p.symbol) ?? p.entry)), 0);
        const limit = (closeOut * usedNotional()) / spec.maxLeverage;
        if (worst < limit) {
          const why = 'clôture de marge (equity < 50 % de la marge)';
          const only = positions.length === 1 ? positions[0] : undefined;
          if (only) {
            // Seule position : la plateforme la coupe au cours où l'equity touche le seuil (ou à l'ouverture si le cours a sauté).
            const dir = only.side === 'long' ? 1 : -1;
            const trigger = only.entry + (limit - cash) / (dir * only.qty);
            const gapped = only.side === 'long' ? b.o <= trigger : b.o >= trigger;
            close(only, gapped ? b.o : trigger, gapped ? t : barEnd, why, 'market');
          } else {
            for (const p of [...positions]) close(p, p.symbol === s ? adverse(p) : (last.get(p.symbol) ?? p.entry), barEnd, why, 'market');
          }
        }
      }
      last.set(s, b.c);
    }
    // Instruments sans barre à cet instant : la sortie à l'heure et la durée maximale s'appliquent au dernier cours.
    for (const p of positions.filter((x) => !barOf.has(x.symbol))) {
      const px = last.get(p.symbol) ?? p.entry;
      if (p.exitBy !== undefined && barEnd >= p.exitBy) close(p, px, barEnd, 'fin de séance', 'market');
      else if (barEnd - p.openedAt >= maxHold) close(p, px, barEnd, 'durée maximale (3 jours)', 'market');
    }

    // c) Garde-fous de marge.
    let eq = equityNow();
    if (eq <= 0) {
      for (const p of [...positions]) close(p, last.get(p.symbol) ?? p.entry, barEnd, 'compte à zéro', 'market');
      cash = Math.max(0, cash);
      liquidatedAt = barEnd;
      pending = [];
      curve.push([barEnd, 0]);
      break;
    }
    if (spec.maxLeverage > 1 && positions.length) {
      const margin = usedNotional() / spec.maxLeverage;
      if (eq < closeOut * margin) for (const p of [...positions]) close(p, last.get(p.symbol) ?? p.entry, barEnd, 'clôture de marge (equity < 50 % de la marge)', 'market');
    }

    // d) La stratégie décide sur les barres closes.
    const view: StrategyView = { t, series, idx, fresh, positions, pending, equity: equityNow() };
    for (const it of strategy.onBar(view)) {
      if (it.type === 'enter') {
        if (it.order === 'close') {
          const b = barOf.get(it.symbol);
          if (b) open(it, b.c, barEnd, t, 'market');
        } else pending.push({ id: `o${++seq}`, intent: it, createdAt: t });
      } else if (it.type === 'exit') {
        const p = positions.find((x) => x.id === it.id);
        if (!p) continue;
        if (it.order === 'close') close(p, last.get(p.symbol) ?? p.entry, barEnd, it.reason, 'market');
        else p.exitAtNextOpen = true;
      } else if (it.type === 'stop') {
        const p = positions.find((x) => x.id === it.id);
        if (p) p.stop = it.stop;
      } else if (it.type === 'cancel') {
        pending = pending.filter((o) => (it.tag !== undefined && o.intent.tag !== it.tag) || (it.symbol !== undefined && o.intent.symbol !== it.symbol));
      }
    }
    eq = equityNow();
    curve.push([barEnd, eq]);
  }

  return {
    id: spec.id,
    from,
    to,
    capital: spec.capital,
    equity: liquidatedAt !== undefined ? 0 : equityNow(),
    cash,
    trades,
    open: positions,
    curve,
    liquidatedAt,
    fees,
    financing,
    exposureMs,
  };
}

export interface Stats {
  returnPct: number;
  maxDrawdownPct: number;
  trades: number;
  winRatePct: number;
  profitFactor: number;
  avgTradePct: number;
  bestDayPct: number;
  worstDayPct: number;
  daysUp: number;
  days: number;
  exposurePct: number;
}

/** Statistiques d'un rejeu ; les journées sont comptées en heure de Paris. */
export function stats(r: RunResult, dayOf: (ms: number) => string): Stats {
  let peak = r.capital;
  let mdd = 0;
  const endOfDay = new Map<string, number>();
  for (const [t, e] of r.curve) {
    peak = Math.max(peak, e);
    if (peak > 0) mdd = Math.max(mdd, ((peak - e) / peak) * 100);
    endOfDay.set(dayOf(t), e);
  }
  const dailyRets: number[] = [];
  let prev = r.capital;
  for (const e of endOfDay.values()) {
    dailyRets.push(prev > 0 ? ((e - prev) / prev) * 100 : 0);
    prev = e;
  }
  const wins = r.trades.filter((t) => t.pnl > 0);
  const losses = r.trades.filter((t) => t.pnl <= 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0);
  const gl = -losses.reduce((s, t) => s + t.pnl, 0);
  return {
    returnPct: ((r.equity - r.capital) / r.capital) * 100,
    maxDrawdownPct: mdd,
    trades: r.trades.length,
    winRatePct: r.trades.length ? (wins.length / r.trades.length) * 100 : 0,
    profitFactor: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0,
    avgTradePct: r.trades.length ? r.trades.reduce((s, t) => s + t.pnlPct, 0) / r.trades.length : 0,
    bestDayPct: dailyRets.length ? Math.max(...dailyRets) : 0,
    worstDayPct: dailyRets.length ? Math.min(...dailyRets) : 0,
    daysUp: dailyRets.filter((x) => x > 0).length,
    days: dailyRets.length,
    exposurePct: r.to > r.from ? (r.exposureMs / (r.to - r.from)) * 100 : 0,
  };
}
