/**
 * Moteur du desk : courtier papier + gestion du risque + choix des trades, minute par minute.
 * Le même code sert au rejeu (données passées) et au direct (données de la minute).
 *
 * Règles de risque (sans levier) :
 *   - risque par trade = 0,5 % de l'equity × poids adaptatif de la stratégie (× 0,5 en mode chasse) ;
 *   - une position ≤ 50 % de l'equity, somme des positions ≤ equity ; actions en compte cash ;
 *   - 3 positions max, 10 trades max par jour, stop journalier −1,5 %, arrêt de la semaine à −4 % ;
 *   - tout est soldé à 18 h 55 (heure de Paris) : rien ne reste ouvert d'un jour à l'autre.
 * Sorties : ORB = stop ou 18 h 55 ; momentum = stop suiveur max(borne, VWAP) ; VWAP = objectif ou stop.
 * Adaptation en temps réel : après chaque trade, le poids de sa stratégie est multiplié par
 * exp(0,25 × R) (borné à [0,25 ; 2]) ; 3 pertes d'affilée d'une stratégie la coupent pour la journée.
 */

import { HUNT, NORMAL, noiseBands, noiseSignal, noiseTrail, orbSignal, vwapSignal } from './strategies.ts';
import type { DayContext, StrategyResult, Thresholds } from './strategies.ts';
import { efficiency, hhmm, paris, regimeOf } from './market.ts';
import type { AssetClass, Bar, ClosedTrade, DeskConfig, DeskState, OpenTrade, Signal, StrategyId } from './types.ts';

export type DeskEventType = 'day_start' | 'open' | 'close' | 'skip' | 'note' | 'guard' | 'analysis' | 'weights' | 'hunt' | 'day_end';

export interface DeskEvent {
  at: number;
  type: DeskEventType;
  msg: string;
  data?: unknown;
}

export interface DayAnalysis {
  stocksInPlay: Array<{ symbol: string; rv: number; bullish: boolean }>;
  regimes: Array<{ time: string; items: Array<{ symbol: string; regime: string; z: number; band: number }> }>;
  signalsSeen: number;
  signalsTaken: number;
  skipped: Record<string, number>;
  notes: Record<string, number>;
  huntAt?: string;
  dailyStopAt?: string;
}

export interface DaySummary {
  day: string;
  equityStart: number;
  equityEnd: number;
  pnlUsd: number;
  pnlPct: number;
  trades: ClosedTrade[];
  winRatePct: number;
  avgR: number;
  byStrategy: Record<StrategyId, { n: number; pnlUsd: number }>;
  weightsStart: Record<StrategyId, number>;
  weightsEnd: Record<StrategyId, number>;
  analysis: DayAnalysis;
  forecast: Forecast;
}

export interface Forecast {
  watchlist: Array<{ symbol: string; why: string }>;
  outlook: string[];
  week: { pnlPct: number; targetPct: number; tradingDaysLeft: number; neededPerDayPct: number };
}

const STRATS: StrategyId[] = ['orb', 'noise', 'vwap'];
export const STRATEGY_LABEL: Record<StrategyId, string> = { orb: 'ORB 5 min', noise: 'momentum zone de bruit', vwap: 'retour VWAP' };

export function newDeskState(cfg: DeskConfig): DeskState {
  return {
    version: 1,
    startEquity: cfg.startEquity,
    cash: cfg.startEquity,
    day: '',
    dayStartEquity: cfg.startEquity,
    tradesToday: 0,
    stockCashUsedToday: 0,
    weights: { orb: 1, noise: 1, vwap: 1 },
    lossStreak: { orb: 0, noise: 0, vwap: 0 },
    weekId: '',
    weekStartEquity: cfg.startEquity,
    open: [],
    cooldown: {},
    orbDone: {},
    closedCount: 0,
  };
}

/** Semaine ISO (AAAA-Sxx) d'une date AAAA-MM-JJ. */
export function isoWeek(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(dt.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((dt.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${dt.getUTCFullYear()}-S${String(week).padStart(2, '0')}`;
}

/** Jours de bourse restants dans la semaine (lundi–vendredi), aujourd'hui exclu. */
export function tradingDaysLeft(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 dimanche … 6 samedi
  return dow >= 1 && dow <= 5 ? 5 - dow : 0;
}

export interface EngineDeps {
  cfg: DeskConfig;
  state: DeskState;
  log: (e: DeskEvent) => void;
  onClose?: (t: ClosedTrade) => void;
  newId?: () => string;
}

export interface Engine {
  startDay(day: string, at: number): void;
  /** Traite la minute qui commence à t (barre déjà close). */
  step(t: number, ctxs: Map<string, DayContext>, opts?: { entries?: boolean }): void;
  endDay(t: number, ctxs: Map<string, DayContext>): DaySummary;
  equity(ctxs: Map<string, DayContext>, t: number): number;
  /** L'univers a changé (actions « en jeu » ajoutées) : refaire le classement par volume relatif. */
  resetInPlay(): void;
  readonly analysis: DayAnalysis;
}

function indexAt(ctx: DayContext, t: number): number {
  // Recherche dichotomique de la barre qui commence exactement à t.
  let lo = 0;
  let hi = ctx.session.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const bt = (ctx.session[mid] as Bar).t;
    if (bt === t) return mid;
    if (bt < t) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

function lastPrice(ctx: DayContext | undefined, t: number): number | undefined {
  if (!ctx) return undefined;
  let price: number | undefined;
  for (const b of ctx.session) {
    if (b.t > t) break;
    price = b.c;
  }
  return price;
}

function emptyAnalysis(): DayAnalysis {
  return { stocksInPlay: [], regimes: [], signalsSeen: 0, signalsTaken: 0, skipped: {}, notes: {} };
}

export function createEngine(deps: EngineDeps): Engine {
  const { cfg } = deps;
  const st = deps.state;
  const newId = deps.newId ?? (() => `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`);
  let analysis = emptyAnalysis();
  let dayTrades: ClosedTrade[] = [];
  let weightsStart = { ...st.weights };
  let lastGuard = '';
  let huntLogged = false;
  let sipDone = false;
  let inPlay = new Set<string>();
  // Actions dont la cassure ORB a été écartée faute de place ORB (comptée une fois par jour).
  let orbCapped = new Set<string>();
  // Signaux « instrument · stratégie » manqués parce que toutes les places étaient prises (une fois par jour).
  let missed = new Set<string>();

  const slip = (cls: AssetClass): number => cfg.costs[cls].slipBps / 1e4;
  const fee = (cls: AssetClass): number => cfg.costs[cls].feeBps / 1e4;
  const round = (x: number, d = 2): number => Math.round(x * 10 ** d) / 10 ** d;

  function markValue(tr: OpenTrade, price: number): number {
    return tr.side === 'long' ? tr.qty * price : tr.qty * tr.entry + tr.qty * (tr.entry - price);
  }

  function equity(ctxs: Map<string, DayContext>, t: number): number {
    let e = st.cash;
    for (const tr of st.open) e += markValue(tr, lastPrice(ctxs.get(tr.symbol), t) ?? tr.entry);
    return e;
  }

  function closeTrade(tr: OpenTrade, rawExit: number, at: number, reason: string, ctxs: Map<string, DayContext>): void {
    const exitFill = tr.side === 'long' ? rawExit * (1 - slip(tr.cls)) : rawExit * (1 + slip(tr.cls));
    const exitFee = tr.qty * exitFill * fee(tr.cls);
    const gross = tr.side === 'long' ? tr.qty * (exitFill - tr.entry) : tr.qty * (tr.entry - exitFill);
    st.cash += tr.qty * tr.entry + gross - exitFee;
    const pnlUsd = gross - exitFee - tr.costsUsd;
    st.open = st.open.filter((o) => o.id !== tr.id);
    const r = tr.riskUsd > 0 ? pnlUsd / tr.riskUsd : 0;
    const before = st.weights[tr.strategy];
    st.weights[tr.strategy] = Math.min(2, Math.max(0.25, before * Math.exp(0.25 * Math.max(-2, Math.min(3, r)))));
    st.lossStreak[tr.strategy] = pnlUsd <= 0 ? st.lossStreak[tr.strategy] + 1 : 0;
    st.cooldown[tr.symbol] = at + cfg.cooldownMinutes * 60_000;
    st.closedCount++;
    const closed: ClosedTrade = {
      ...tr,
      costsUsd: tr.costsUsd + exitFee,
      closedAt: at,
      exit: exitFill,
      pnlUsd: round(pnlUsd, 4),
      r: round(r, 2),
      exitReason: reason,
      holdMinutes: Math.round((at - tr.openedAt) / 60_000),
      equityAfter: round(equity(ctxs, at), 4),
    };
    dayTrades.push(closed);
    deps.log({
      at,
      type: 'close',
      msg: `${tr.side === 'long' ? 'VENTE' : 'RACHAT'} ${tr.symbol} ${pnlUsd >= 0 ? '+' : ''}${pnlUsd.toFixed(2)} $ (${r >= 0 ? '+' : ''}${r.toFixed(2)} R) — ${reason}`,
      data: closed,
    });
    deps.log({
      at,
      type: 'weights',
      msg: `poids ${STRATEGY_LABEL[tr.strategy]} ${before.toFixed(2)} → ${st.weights[tr.strategy].toFixed(2)}`,
      data: { ...st.weights },
    });
    deps.onClose?.(closed);
  }

  function manageExit(tr: OpenTrade, ctx: DayContext, j: number, t: number, ctxs: Map<string, DayContext>, th: Thresholds): void {
    const bar = ctx.session[j] as Bar;
    if (tr.side === 'long') {
      if (bar.l <= tr.stop) return closeTrade(tr, Math.min(tr.stop, bar.o), t, tr.stop > tr.initialStop ? 'stop suiveur' : 'stop', ctxs);
      if (tr.target !== undefined && bar.h >= tr.target) return closeTrade(tr, Math.max(tr.target, bar.o), t, 'objectif atteint', ctxs);
      tr.best = Math.max(tr.best, bar.h);
      if (tr.strategy === 'noise') {
        const trail = noiseTrail(ctx, j, 'long', th.noiseK);
        if (trail !== null && bar.c < trail) return closeTrade(tr, bar.c, t, 'retour dans la zone de bruit / sous la VWAP', ctxs);
        if (trail !== null) tr.stop = Math.max(tr.stop, Math.min(trail, bar.c));
      }
    } else {
      if (bar.h >= tr.stop) return closeTrade(tr, Math.max(tr.stop, bar.o), t, tr.stop < tr.initialStop ? 'stop suiveur' : 'stop', ctxs);
      if (tr.target !== undefined && bar.l <= tr.target) return closeTrade(tr, Math.min(tr.target, bar.o), t, 'objectif atteint', ctxs);
      tr.best = Math.min(tr.best, bar.l);
      if (tr.strategy === 'noise') {
        const trail = noiseTrail(ctx, j, 'short', th.noiseK);
        if (trail !== null && bar.c > trail) return closeTrade(tr, bar.c, t, 'retour dans la zone de bruit / au-dessus de la VWAP', ctxs);
        if (trail !== null) tr.stop = Math.min(tr.stop, Math.max(trail, bar.c));
      }
    }
    // Pas de stop suiveur générique : l'ORB garde son stop jusqu'à 18 h 55 (comme l'étude, qui
    // tient jusqu'à la clôture : les gros gagnants font la performance), le momentum suit sa borne,
    // le retour VWAP vise la VWAP.
  }

  function guard(eq: number, at: number): string | null {
    if (st.halted) return st.halted;
    const dayPct = ((eq - st.dayStartEquity) / st.dayStartEquity) * 100;
    if (dayPct <= -cfg.dailyLossLimitPct) {
      analysis.dailyStopAt ??= hhmm(paris(at).minutes);
      return `stop journalier : ${dayPct.toFixed(2)} % (limite −${cfg.dailyLossLimitPct} %)`;
    }
    const weekPct = ((eq - st.weekStartEquity) / st.weekStartEquity) * 100;
    if (weekPct <= -cfg.weeklyLossLimitPct) {
      st.halted = `semaine arrêtée : ${weekPct.toFixed(2)} % (limite −${cfg.weeklyLossLimitPct} %)`;
      return st.halted;
    }
    if (st.tradesToday >= cfg.maxTradesPerDay) return `${st.tradesToday} trades aujourd'hui (max ${cfg.maxTradesPerDay})`;
    return null;
  }

  function size(sig: Signal, eq: number, hunt: boolean): { qty: number; fill: number; riskUsd: number; notional: number; reason?: string } {
    const fill = sig.side === 'long' ? sig.entry * (1 + slip(sig.cls)) : sig.entry * (1 - slip(sig.cls));
    const dist = Math.abs(fill - sig.stop);
    if (!(dist > 0) || (sig.side === 'long' ? sig.stop >= fill : sig.stop <= fill)) return { qty: 0, fill, riskUsd: 0, notional: 0, reason: 'stop incohérent' };
    const risk = ((eq * cfg.baseRiskPct) / 100) * st.weights[sig.strategy] * (hunt ? 0.5 : 1);
    let qty = risk / dist;
    const stockRoom = sig.cls === 'stock' ? st.dayStartEquity - st.stockCashUsedToday : Infinity;
    const cap = Math.min((eq * cfg.maxPositionPct) / 100, st.cash, stockRoom);
    if (qty * fill > cap) qty = Math.max(0, cap / fill);
    const notional = qty * fill;
    if (notional < cfg.minNotionalUsd) {
      return { qty: 0, fill, riskUsd: 0, notional, reason: sig.cls === 'stock' && stockRoom < cfg.minNotionalUsd ? 'compte cash : liquidités du jour déjà engagées (réglement J+1)' : 'lot trop petit' };
    }
    return { qty, fill, riskUsd: qty * dist, notional };
  }

  function open(sig: Signal, at: number, eq: number, hunt: boolean): boolean {
    const s = size(sig, eq, hunt);
    if (s.reason) {
      analysis.skipped[s.reason] = (analysis.skipped[s.reason] ?? 0) + 1;
      return false;
    }
    const entryFee = s.notional * fee(sig.cls);
    st.cash -= s.notional + entryFee;
    if (sig.cls === 'stock') st.stockCashUsedToday += s.notional;
    const tr: OpenTrade = {
      id: newId(),
      symbol: sig.symbol,
      cls: sig.cls,
      strategy: sig.strategy,
      side: sig.side,
      qty: s.qty,
      entry: s.fill,
      stop: sig.stop,
      initialStop: sig.stop,
      target: sig.target,
      openedAt: at,
      riskUsd: s.riskUsd,
      notionalUsd: s.notional,
      costsUsd: entryFee,
      best: s.fill,
      regime: sig.regime,
      reasons: [
        ...sig.reasons,
        `taille : risque ${s.riskUsd.toFixed(2)} $ (${cfg.baseRiskPct} % × poids ${st.weights[sig.strategy].toFixed(2)}${hunt ? ' × 0.5 mode chasse' : ''}), position ${s.notional.toFixed(2)} $`,
      ],
    };
    st.open.push(tr);
    st.tradesToday++;
    if (sig.strategy === 'orb') st.orbDone[sig.symbol] = 1;
    analysis.signalsTaken++;
    deps.log({
      at,
      type: 'open',
      msg: `${sig.side === 'long' ? 'ACHAT' : 'VENTE'} ${sig.symbol} ${s.notional.toFixed(2)} $ — ${STRATEGY_LABEL[sig.strategy]} (stop ${sig.stop.toPrecision(6)})`,
      data: tr,
    });
    return true;
  }

  function snapshot(t: number, ctxs: Map<string, DayContext>, th: Thresholds): void {
    const items: DayAnalysis['regimes'][number]['items'] = [];
    for (const ctx of ctxs.values()) {
      const j = indexAt(ctx, t);
      if (j < 0) continue;
      const vw = ctx.vw[j];
      const bar = ctx.session[j] as Bar;
      const bands = noiseBands(ctx, j, th.noiseK);
      const z = vw && vw.sd > 0 ? (bar.c - vw.vwap) / vw.sd : 0;
      const band = bands ? (bar.c - ctx.anchor) / (bands.sigma * ctx.anchor) : 0;
      items.push({ symbol: ctx.inst.symbol, regime: regimeOf(efficiency(ctx.session.slice(0, j + 1))), z: round(z, 2), band: round(band, 2) });
    }
    if (items.length) {
      const entry = { time: hhmm(paris(t).minutes), items };
      analysis.regimes.push(entry);
      const trend = items.filter((i) => i.regime === 'tendance').length;
      const range = items.filter((i) => i.regime === 'range').length;
      deps.log({ at: t, type: 'analysis', msg: `analyse ${entry.time} : ${trend} en tendance, ${range} en range, ${items.length - trend - range} mixtes`, data: entry });
    }
  }

  function stocksInPlay(t: number, ctxs: Map<string, DayContext>): void {
    const list: DayAnalysis['stocksInPlay'] = [];
    for (const ctx of ctxs.values()) {
      if (ctx.inst.cls !== 'stock' || ctx.session.length < 5 || !(ctx.orAvgVol > 0)) continue;
      if ((ctx.session[4] as Bar).t > t) continue;
      if ((ctx.session[0] as Bar).o < 5) continue;
      const or = ctx.session.slice(0, 5);
      list.push({ symbol: ctx.inst.symbol, rv: round(or.reduce((s, b) => s + b.v, 0) / ctx.orAvgVol, 2), bullish: (or[4] as Bar).c > (or[0] as Bar).o });
    }
    if (list.length) {
      list.sort((a, b) => b.rv - a.rv);
      analysis.stocksInPlay = list;
      // L'ORB ne vise que le haut du classement, comme l'étude (top 20 de tout le marché).
      inPlay = new Set(list.slice(0, cfg.inPlayTop).map((x) => x.symbol));
      sipDone = true;
      deps.log({
        at: t,
        type: 'analysis',
        msg: `actions en jeu à l'ouverture : ${list.slice(0, 5).map((s) => `${s.symbol} ${s.rv}×${s.bullish ? '↑' : '↓'}`).join(', ')}`,
        data: list,
      });
    }
  }

  return {
    get analysis() {
      return analysis;
    },
    equity,
    resetInPlay() {
      sipDone = false;
    },

    startDay(day, at) {
      if (st.day === day) return;
      const week = isoWeek(day);
      const eq = st.cash + st.open.reduce((s, o) => s + o.qty * o.entry, 0);
      if (st.weekId !== week) {
        st.weekId = week;
        st.weekStartEquity = eq;
        delete st.halted;
      }
      st.day = day;
      st.dayStartEquity = eq;
      st.tradesToday = 0;
      st.stockCashUsedToday = 0;
      st.lossStreak = { orb: 0, noise: 0, vwap: 0 };
      st.orbDone = {};
      analysis = emptyAnalysis();
      dayTrades = [];
      weightsStart = { ...st.weights };
      lastGuard = '';
      huntLogged = false;
      sipDone = false;
      inPlay = new Set();
      orbCapped = new Set();
      missed = new Set();
      deps.log({ at, type: 'day_start', msg: `séance du ${day} — equity ${eq.toFixed(2)} $, poids ORB ${st.weights.orb.toFixed(2)} / momentum ${st.weights.noise.toFixed(2)} / VWAP ${st.weights.vwap.toFixed(2)}` });
    },

    step(t, ctxs, opts) {
      const p = paris(t).minutes;
      const hunt = p >= cfg.huntFrom && st.tradesToday < cfg.minTradesPerDay;
      const th = hunt ? HUNT : NORMAL;

      // 1. Sorties.
      for (const tr of [...st.open]) {
        const ctx = ctxs.get(tr.symbol);
        if (!ctx) continue;
        const j = indexAt(ctx, t);
        if (j < 0) continue;
        if (p >= cfg.flatAt) {
          closeTrade(tr, (ctx.session[j] as Bar).c, t, `clôture de fin de fenêtre (${hhmm(cfg.flatAt)})`, ctxs);
          continue;
        }
        manageExit(tr, ctx, j, t, ctxs, th);
      }
      if (p >= cfg.flatAt) {
        // Instrument sans barre à cette minute : on solde au dernier prix connu.
        for (const tr of [...st.open]) closeTrade(tr, lastPrice(ctxs.get(tr.symbol), t) ?? tr.entry, t, `clôture de fin de fenêtre (${hhmm(cfg.flatAt)})`, ctxs);
        return;
      }

      // 2. Analyses.
      if (!sipDone) stocksInPlay(t, ctxs);
      if (p % 30 === 0 && p >= cfg.windowStart) snapshot(t, ctxs, th);
      if (p < cfg.windowStart || p >= cfg.lastEntry || opts?.entries === false) return;

      // 3. Entrées.
      if (hunt && !huntLogged) {
        huntLogged = true;
        analysis.huntAt = hhmm(p);
        deps.log({ at: t, type: 'hunt', msg: `mode chasse : ${st.tradesToday} trade(s) à ${hhmm(p)}, seuils assouplis et risque divisé par 2` });
      }
      const eq = equity(ctxs, t);
      const blocked = guard(eq, t);
      // Places toutes prises : on regarde quand même les signaux, sans rien ouvrir, pour compter
      // les occasions manquées (une fois par instrument et par stratégie dans la journée).
      const full = !blocked && st.open.length >= cfg.maxOpen;
      const guardMsg = blocked ?? (full ? `${st.open.length} positions ouvertes (max ${cfg.maxOpen})` : '');
      if (guardMsg !== lastGuard && guardMsg) deps.log({ at: t, type: 'guard', msg: guardMsg });
      lastGuard = guardMsg;
      if (blocked) return;
      const signals: Signal[] = [];
      // Vent porteur pour l'ORB : le S&P 500 (SPY) au-dessus de sa VWAP du jour.
      const spy = ctxs.get('SPY');
      const sj = spy ? indexAt(spy, t) : -1;
      const spyVw = spy && sj >= 0 ? spy.vw[sj] : undefined;
      const market = spy && sj >= 0 && spyVw ? { above: (spy.session[sj] as Bar).c > spyVw.vwap, label: 'le S&P 500 (SPY)' } : undefined;
      for (const ctx of ctxs.values()) {
        const j = indexAt(ctx, t);
        if (j < 0) continue;
        const sym = ctx.inst.symbol;
        if (st.open.some((o) => o.symbol === sym)) continue;
        if ((st.cooldown[sym] ?? 0) > t) continue;
        const orb: StrategyResult = st.orbDone[sym] || st.lossStreak.orb >= 3 || !inPlay.has(sym) ? {} : orbSignal(ctx, j, th, market);
        // L'ORB garde sa position jusqu'à 18 h 55 : on lui laisse au plus maxOrbOpen places,
        // pour que les trades rapides (momentum, VWAP) gardent de quoi entrer l'après-midi.
        if (orb.signal && !full && st.open.filter((o) => o.strategy === 'orb').length >= cfg.maxOrbOpen) {
          if (!orbCapped.has(sym)) {
            orbCapped.add(sym);
            const k = `ORB : déjà ${cfg.maxOrbOpen} positions ORB ouvertes (places gardées pour les trades rapides)`;
            analysis.skipped[k] = (analysis.skipped[k] ?? 0) + 1;
          }
          orb.signal = undefined;
        }
        const results = [
          orb,
          st.lossStreak.noise >= 3 ? {} : noiseSignal(ctx, j, th, cfg),
          st.lossStreak.vwap >= 3 ? {} : vwapSignal(ctx, j, th, cfg),
        ];
        for (const r of results) {
          if (r.note && !full) {
            // Les mesures qui changent d'une minute à l'autre (nombres à décimales) sont masquées pour
            // regrouper les refus identiques ; les constantes (« 1re bougie », « 14 j < 0,50 $ ») restent lisibles.
            const key = r.note.replace(/[-+]?\d+\.\d+/g, '#');
            analysis.notes[key] = (analysis.notes[key] ?? 0) + 1;
          }
          if (r.signal) signals.push(r.signal);
        }
      }
      if (full) {
        const k = `places pleines (${cfg.maxOpen} positions ouvertes) : signal non pris`;
        for (const s of signals) {
          if (missed.has(`${s.symbol}·${s.strategy}`)) continue;
          missed.add(`${s.symbol}·${s.strategy}`);
          analysis.skipped[k] = (analysis.skipped[k] ?? 0) + 1;
        }
        return;
      }
      analysis.signalsSeen += signals.length;
      if (!signals.length) return;
      signals.sort((a, b) => b.quality * st.weights[b.strategy] - a.quality * st.weights[a.strategy]);
      // Une entrée par minute au plus : la meilleure ; les autres sont notées.
      const [best, ...rest] = signals as [Signal, ...Signal[]];
      if (!open(best, t, eq, hunt)) return;
      if (rest.length) analysis.skipped['une seule entrée par minute'] = (analysis.skipped['une seule entrée par minute'] ?? 0) + rest.length;
    },

    endDay(t, ctxs) {
      for (const tr of [...st.open]) closeTrade(tr, lastPrice(ctxs.get(tr.symbol), t) ?? tr.entry, t, 'fin de séance', ctxs);
      const eqEnd = equity(ctxs, t);
      const wins = dayTrades.filter((x) => x.pnlUsd > 0).length;
      const byStrategy = Object.fromEntries(STRATS.map((s) => [s, { n: 0, pnlUsd: 0 }])) as DaySummary['byStrategy'];
      for (const x of dayTrades) {
        byStrategy[x.strategy].n++;
        byStrategy[x.strategy].pnlUsd = round(byStrategy[x.strategy].pnlUsd + x.pnlUsd, 4);
      }
      const forecast = buildForecast(ctxs, t, eqEnd);
      const summary: DaySummary = {
        day: st.day,
        equityStart: round(st.dayStartEquity, 4),
        equityEnd: round(eqEnd, 4),
        pnlUsd: round(eqEnd - st.dayStartEquity, 4),
        pnlPct: round(((eqEnd - st.dayStartEquity) / st.dayStartEquity) * 100, 3),
        trades: dayTrades,
        winRatePct: dayTrades.length ? round((wins / dayTrades.length) * 100, 1) : 0,
        avgR: dayTrades.length ? round(dayTrades.reduce((s, x) => s + x.r, 0) / dayTrades.length, 2) : 0,
        byStrategy,
        weightsStart,
        weightsEnd: { ...st.weights },
        analysis,
        forecast,
      };
      deps.log({ at: t, type: 'day_end', msg: `fin de séance : ${dayTrades.length} trades, ${summary.pnlUsd >= 0 ? '+' : ''}${summary.pnlUsd.toFixed(2)} $ (${summary.pnlPct.toFixed(2)} %)`, data: { pnlUsd: summary.pnlUsd } });
      return summary;
    },
  };

  /** Prévisions pour la séance suivante : liste de surveillance, poids, et chemin vers l'objectif hebdo. */
  function buildForecast(ctxs: Map<string, DayContext>, t: number, eqEnd: number): Forecast {
    const moves: Array<{ symbol: string; sigmas: number; regime: string }> = [];
    for (const ctx of ctxs.values()) {
      const last = ctx.session.filter((b) => b.t <= t).at(-1);
      if (!last || !ctx.session.length) continue;
      const m = Math.round((last.t - ctx.anchorTime) / 60_000);
      const sigma = ctx.noise[Math.min(m, ctx.noise.length - 1)] ?? 0;
      if (!(sigma > 0)) continue;
      moves.push({ symbol: ctx.inst.symbol, sigmas: (last.c / ctx.anchor - 1) / sigma, regime: regimeOf(efficiency(ctx.session.filter((b) => b.t <= t))) });
    }
    moves.sort((a, b) => Math.abs(b.sigmas) - Math.abs(a.sigmas));
    const watchlist: Forecast['watchlist'] = moves.slice(0, 4).map((mv) => ({
      symbol: mv.symbol,
      why: `a fini la fenêtre à ${mv.sigmas >= 0 ? '+' : ''}${mv.sigmas.toFixed(1)} fois son bruit habituel (${mv.regime}) : suite ou retournement à surveiller dès l'ouverture`,
    }));
    for (const s of analysis.stocksInPlay.slice(0, 2)) {
      if (!watchlist.some((w) => w.symbol === s.symbol)) watchlist.push({ symbol: s.symbol, why: `action « en jeu » aujourd'hui (volume relatif ${s.rv}×) : l'intérêt persiste souvent le lendemain` });
    }
    const weekPct = ((eqEnd - st.weekStartEquity) / st.weekStartEquity) * 100;
    const left = tradingDaysLeft(st.day);
    const needed = left > 0 ? Math.max(0, (1 - weekPct) / left) : 0;
    const best = (Object.entries(st.weights) as Array<[StrategyId, number]>).sort((a, b) => b[1] - a[1])[0] as [StrategyId, number];
    const trend = moves.filter((m) => m.regime === 'tendance').length;
    const range = moves.filter((m) => m.regime === 'range').length;
    const outlook = [
      `poids pour la prochaine séance : ORB ${st.weights.orb.toFixed(2)}, momentum ${st.weights.noise.toFixed(2)}, VWAP ${st.weights.vwap.toFixed(2)} — priorité à « ${STRATEGY_LABEL[best[0]]} »`,
      `risque par trade prévu : ${((eqEnd * cfg.baseRiskPct) / 100).toFixed(2)} $ × poids (entre ${((eqEnd * cfg.baseRiskPct) / 100 * 0.25).toFixed(2)} et ${((eqEnd * cfg.baseRiskPct) / 100 * 2).toFixed(2)} $)`,
      trend > range
        ? `fin de séance plutôt en tendance (${trend} vs ${range} en range) : je m'attends à plus de signaux momentum que de retours VWAP`
        : `fin de séance plutôt hésitante (${range} en range vs ${trend} en tendance) : les retours à la VWAP devraient dominer`,
      left > 0
        ? `objectif hebdo +1 % : semaine à ${weekPct >= 0 ? '+' : ''}${weekPct.toFixed(2)} %, il faut en moyenne ${needed.toFixed(2)} % par séance sur les ${left} restantes`
        : `semaine terminée à ${weekPct >= 0 ? '+' : ''}${weekPct.toFixed(2)} % (objectif +1 %)`,
    ];
    if (analysis.dailyStopAt) outlook.push(`stop journalier atteint à ${analysis.dailyStopAt} : les poids des stratégies perdantes ont baissé, le risque suit`);
    if (analysis.huntAt) outlook.push(`mode chasse déclenché à ${analysis.huntAt} : peu de setups propres aujourd'hui, à surveiller`);
    return { watchlist, outlook, week: { pnlPct: round(weekPct, 3), targetPct: 1, tradingDaysLeft: left, neededPerDayPct: round(needed, 3) } };
  }
}
