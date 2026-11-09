/**
 * Les trois stratégies du desk, toutes tirées de méthodes publiées ou très répandues :
 *
 *  orb   — cassure du range des 5 premières minutes sur les actions « en jeu » (volume relatif élevé).
 *          Zarattini, Barbon & Aziz (2024), « A Profitable Day Trading Strategy For The U.S. Equity
 *          Market » : stop à 10 % de l'ATR 14 jours. Ici : achat seulement (compte cash).
 *  noise — momentum intraday « zone de bruit » : on suit le prix quand il sort de la zone où il
 *          oscille d'habitude à cette heure-là. Zarattini, Aziz & Barbon (2024), « Beat the Market:
 *          An Effective Intraday Momentum Strategy for S&P500 ETF (SPY) » ; sortie par stop suiveur
 *          sur max(borne, VWAP).
 *  vwap  — retour à la VWAP quand le marché est sans tendance (pratique classique des desks) :
 *          prix à plus de 2 écarts-types de la VWAP, objectif = la VWAP.
 *
 * Fonctions pures : elles renvoient un signal ou une note expliquant pourquoi il n'y en a pas.
 */

import { costBps, efficiency, regimeOf } from './market.ts';
import type { Bar, DeskConfig, Instrument, Signal } from './types.ts';

export interface DayContext {
  inst: Instrument;
  /** Barres de séance depuis l'ancre (actions : 9 h 30 New York ; forex/crypto : 15 h Paris). */
  session: Bar[];
  anchor: number;
  anchorTime: number;
  /** Clôture de la veille (actions) pour ajuster les bornes en cas d'écart d'ouverture. */
  prevClose?: number;
  /** Bruit moyen par minute depuis l'ancre (fraction). */
  noise: number[];
  /** Volume moyen des 5 premières minutes sur l'historique (actions). */
  orAvgVol: number;
  /** ATR journalier sur l'historique (en prix). */
  atr: number;
  /** VWAP et écart-type, alignés sur `session`. */
  vw: Array<{ vwap: number; sd: number }>;
}

export interface Thresholds {
  rvMin: number;
  noiseK: number;
  zMin: number;
}

export const NORMAL: Thresholds = { rvMin: 1.5, noiseK: 1, zMin: 2 };
/** « Mode chasse » : trop peu de trades à 17 h 30, seuils assouplis (et risque divisé par 2). */
export const HUNT: Thresholds = { rvMin: 1.2, noiseK: 0.8, zMin: 1.6 };

export interface StrategyResult {
  signal?: Signal;
  note?: string;
}

const pct = (x: number, d = 2): string => `${(x * 100).toFixed(d)} %`;
const px = (x: number): string => (x >= 100 ? x.toFixed(2) : x >= 1 ? x.toFixed(4) : x.toPrecision(5));

/** ORB 5 minutes, actions uniquement, une fois par jour et par action, entre 9 h 35 et 11 h (New York). */
export function orbSignal(ctx: DayContext, j: number, th: Thresholds, market?: { above: boolean; label: string }): StrategyResult {
  if (ctx.inst.cls !== 'stock') return {};
  if (j < 5) return {};
  const minutesFromOpen = Math.round(((ctx.session[j] as Bar).t - ctx.anchorTime) / 60_000);
  if (minutesFromOpen > 90) return {};
  const or = ctx.session.slice(0, 5);
  const orHigh = Math.max(...or.map((b) => b.h));
  const orLow = Math.min(...or.map((b) => b.l));
  const orOpen = (or[0] as Bar).o;
  const orClose = (or[4] as Bar).c;
  const orVol = or.reduce((s, b) => s + b.v, 0);
  if (!(ctx.orAvgVol > 0)) return { note: `${ctx.inst.symbol} ORB : volume historique inconnu` };
  const rv = orVol / ctx.orAvgVol;
  if (rv < th.rvMin) return { note: `${ctx.inst.symbol} ORB : volume relatif ${rv.toFixed(2)}× < ${th.rvMin}× (pas « en jeu »)` };
  if (orClose <= orOpen) return { note: `${ctx.inst.symbol} ORB : 1re bougie baissière, vente à découvert impossible en compte cash` };
  const bar = ctx.session[j] as Bar;
  if (bar.c <= orHigh) return {};
  if (market && !market.above) return { note: `${ctx.inst.symbol} ORB : cassure mais ${market.label} sous sa VWAP (pas de vent porteur)` };
  const entry = bar.c;
  if (!(ctx.atr >= 0.5)) return { note: `${ctx.inst.symbol} ORB : ATR 14 j < 0,50 $ (filtre de l'étude)` };
  // Stop classique de l'ORB : sous le plus bas des 5 premières minutes (au moins 10 % de l'ATR).
  const stop = Math.min(orLow, entry - 0.1 * ctx.atr);
  const dist = entry - stop;
  return {
    signal: {
      symbol: ctx.inst.symbol,
      cls: ctx.inst.cls,
      strategy: 'orb',
      side: 'long',
      entry,
      stop,
      quality: rv,
      regime: regimeOf(efficiency(ctx.session.slice(0, j + 1))),
      reasons: [
        `ORB 5 min : clôture ${px(entry)} au-dessus du plus haut des 5 premières minutes (${px(orHigh)} ; bas ${px(orLow)})`,
        `volume relatif ${rv.toFixed(2)}× la moyenne de 14 jours : action « en jeu »`,
        `stop sous le plus bas des 5 premières minutes : ${px(stop)} (${pct(dist / entry)} sous l'entrée)`,
      ],
    },
  };
}

/** Bornes de la zone de bruit à l'index j. */
export function noiseBands(ctx: DayContext, j: number, k: number): { upper: number; lower: number; sigma: number } | null {
  const m = Math.round(((ctx.session[j] as Bar).t - ctx.anchorTime) / 60_000);
  const sigma = ctx.noise[Math.min(m, ctx.noise.length - 1)] ?? 0;
  if (!(sigma > 0)) return null;
  const hi = ctx.prevClose !== undefined ? Math.max(ctx.anchor, ctx.prevClose) : ctx.anchor;
  const lo = ctx.prevClose !== undefined ? Math.min(ctx.anchor, ctx.prevClose) : ctx.anchor;
  return { upper: hi * (1 + k * sigma), lower: lo * (1 - k * sigma), sigma };
}

/** Momentum « zone de bruit » : contrôle toutes les 5 min, à partir de 15 min après l'ancre. */
export const NOISE_SYMBOLS = new Set(['SPY', 'QQQ', 'IWM']);

export function noiseSignal(ctx: DayContext, j: number, th: Thresholds, cfg: DeskConfig): StrategyResult {
  if (ctx.inst.cls === 'stock' && !NOISE_SYMBOLS.has(ctx.inst.symbol)) return {};
  const bar = ctx.session[j] as Bar;
  const m = Math.round((bar.t - ctx.anchorTime) / 60_000);
  if (m < 15 || m % 5 !== 0) return {};
  const bands = noiseBands(ctx, j, th.noiseK);
  if (!bands) return {};
  const vw = ctx.vw[j];
  if (!vw) return {};
  const er = efficiency(ctx.session.slice(0, j + 1));
  const regime = regimeOf(er);
  const c = bar.c;
  const longOk = c > bands.upper && c > vw.vwap;
  const shortOk = ctx.inst.cls === 'fx' && c < bands.lower && c < vw.vwap;
  if (!longOk && !shortOk) return {};
  if (regime === 'range') return { note: `${ctx.inst.symbol} momentum : sortie de zone mais marché en range (efficacité ${er.toFixed(2)})` };
  const unit = bands.sigma * ctx.anchor;
  // Le stop ne doit pas être plus serré que les frais : au moins 3 allers-retours de coûts.
  const roundTrip = (2 * costBps(ctx.inst.cls, cfg.costs)) / 1e4;
  if (unit < 4 * roundTrip * c) {
    return { note: `${ctx.inst.symbol} momentum : bruit habituel (${pct(bands.sigma)}) trop faible face aux frais (${pct(roundTrip)})` };
  }
  const minDist = Math.max(0.25 * unit, 3 * roundTrip * c);
  const maxDist = Math.max(1.0 * unit, minDist);
  if (longOk) {
    const raw = c - Math.max(bands.upper, vw.vwap);
    const dist = Math.min(Math.max(raw, minDist), maxDist);
    return {
      signal: {
        symbol: ctx.inst.symbol,
        cls: ctx.inst.cls,
        strategy: 'noise',
        side: 'long',
        entry: c,
        stop: c - dist,
        quality: (c / bands.upper - 1) / bands.sigma,
        regime,
        reasons: [
          `momentum « zone de bruit » : ${px(c)} au-dessus de la borne haute ${px(bands.upper)} (bruit moyen ${pct(bands.sigma)} à cette heure sur 14 jours)`,
          `au-dessus de la VWAP ${px(vw.vwap)} ; régime ${regime} (efficacité ${er.toFixed(2)})`,
          `stop suiveur sur max(borne, VWAP)`,
        ],
      },
    };
  }
  const raw = Math.min(bands.lower, vw.vwap) - c;
  const dist = Math.min(Math.max(raw, minDist), maxDist);
  return {
    signal: {
      symbol: ctx.inst.symbol,
      cls: ctx.inst.cls,
      strategy: 'noise',
      side: 'short',
      entry: c,
      stop: c + dist,
      quality: (1 - c / bands.lower) / bands.sigma,
      regime,
      reasons: [
        `momentum « zone de bruit » vendeur : ${px(c)} sous la borne basse ${px(bands.lower)} (bruit moyen ${pct(bands.sigma)})`,
        `sous la VWAP ${px(vw.vwap)} ; régime ${regime} (efficacité ${er.toFixed(2)})`,
        `stop suiveur sur min(borne, VWAP)`,
      ],
    },
  };
}

/** Retour à la VWAP en marché sans tendance (actions : achat seulement ; forex : deux sens ; pas de crypto, trop de frais). */
export function vwapSignal(ctx: DayContext, j: number, th: Thresholds, cfg: DeskConfig): StrategyResult {
  if (ctx.inst.cls === 'crypto') return {};
  if (j < 30) return {};
  // Actions : pas avant 11 h (New York). La première heure et demie est la plus directionnelle ;
  // les allers-retours autour de la VWAP sont plus fiables en milieu de séance.
  if (ctx.inst.cls === 'stock' && ((ctx.session[j] as Bar).t - ctx.anchorTime) / 60_000 < 90) return {};
  const vw = ctx.vw[j];
  if (!vw || !(vw.sd > 0)) return {};
  const bar = ctx.session[j] as Bar;
  const z = (bar.c - vw.vwap) / vw.sd;
  if (Math.abs(z) < th.zMin) return {};
  const er = efficiency(ctx.session.slice(0, j + 1));
  if (er > 0.25) return { note: `${ctx.inst.symbol} retour VWAP : écart ${z.toFixed(1)} σ mais tendance trop nette (efficacité ${er.toFixed(2)})` };
  const side = z < 0 ? 'long' : 'short';
  if (side === 'short' && ctx.inst.cls !== 'fx') return {};
  const gain = Math.abs(vw.vwap - bar.c) / bar.c;
  const roundTrip = (2 * costBps(ctx.inst.cls, cfg.costs)) / 1e4;
  if (gain < 3 * roundTrip) {
    return { note: `${ctx.inst.symbol} retour VWAP : gain attendu ${pct(gain)} < 3× les frais (${pct(roundTrip)})` };
  }
  const stop = side === 'long' ? bar.c - vw.sd : bar.c + vw.sd;
  return {
    signal: {
      symbol: ctx.inst.symbol,
      cls: ctx.inst.cls,
      strategy: 'vwap',
      side,
      entry: bar.c,
      stop,
      target: vw.vwap,
      quality: Math.abs(z),
      regime: regimeOf(er),
      reasons: [
        `retour à la VWAP : écart de ${z.toFixed(2)} écarts-types ${z < 0 ? 'sous' : 'au-dessus de'} la VWAP ${px(vw.vwap)}`,
        `marché sans tendance (efficacité ${er.toFixed(2)})`,
        `objectif la VWAP (${pct(gain)}), stop à 1 écart-type (${pct(vw.sd / bar.c)})`,
      ],
    },
  };
}

/** Stop suiveur spécifique au momentum : max(borne, VWAP) pour un achat, min(...) pour une vente. */
export function noiseTrail(ctx: DayContext, j: number, side: 'long' | 'short', k: number): number | null {
  const bands = noiseBands(ctx, j, k);
  const vw = ctx.vw[j];
  if (!bands || !vw) return null;
  return side === 'long' ? Math.max(bands.upper, vw.vwap) : Math.min(bands.lower, vw.vwap);
}
