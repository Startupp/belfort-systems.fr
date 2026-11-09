/**
 * Exécution du desk : chargement des données, contextes du jour, rejeu (backtest) et séance en direct.
 * Fichiers (DESK_DATA_DIR, par défaut data/desk) :
 *   state.json, trades.jsonl, days/AAAA-MM-JJ.json (résumé du jour), events/AAAA-MM-JJ.jsonl,
 *   carnet.html, carnet.csv
 */

import { join } from 'node:path';
import { appendJsonl, ensureDir, readJson, writeJsonAtomic } from '../lib/store.ts';
import { byDay, dailyAtr, hhmm, inPlayCandidates, inUsSession, newYork, noiseProfile, paris, vwapSeries } from './market.ts';
import type { MarketData } from './market.ts';
import { createEngine, newDeskState } from './engine.ts';
import type { DaySummary, DeskEvent, Engine } from './engine.ts';
import type { DayContext } from './strategies.ts';
import { writeCarnet } from './report.ts';
import type { Bar, DeskConfig, DeskState, Instrument } from './types.ts';

/** Heure de Paris → instant UTC (gère l'heure d'été). */
export function parisToUtc(date: string, minutes: number): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  for (const offset of [60, 120]) {
    const t = Date.UTC(y, m - 1, d, 0, 0) + (minutes - offset) * 60_000;
    const p = paris(t);
    if (p.date === date && p.minutes === minutes) return t;
  }
  throw new Error(`heure de Paris introuvable : ${date} ${hhmm(minutes)}`);
}

function inWindow(t: number, cfg: DeskConfig): boolean {
  const p = paris(t).minutes;
  return p >= cfg.windowStart && p < cfg.windowEnd;
}

/** Contextes de la séance `day` pour chaque instrument (historique = jours précédents seulement). */
export function buildDayContexts(day: string, all: Map<string, Bar[]>, universe: Instrument[], cfg: DeskConfig): Map<string, DayContext> {
  const out = new Map<string, DayContext>();
  for (const inst of universe) {
    const bars = all.get(inst.symbol) ?? [];
    const groups =
      inst.cls === 'stock'
        ? byDay(bars.filter((b) => inUsSession(b.t)), 'America/New_York')
        : byDay(bars.filter((b) => inWindow(b.t, cfg)), 'Europe/Paris');
    const today = groups.get(day);
    if (!today || today.length === 0) continue;
    const histDates = [...groups.keys()].filter((d) => d < day).sort().slice(-cfg.historyDays);
    const hist = histDates.map((d) => groups.get(d) as Bar[]).filter((b) => b.length > 5);
    const first = today[0] as Bar;
    const noise = noiseProfile(
      hist.map((b) => ({ anchor: (b[0] as Bar).o, anchorTime: (b[0] as Bar).t, bars: b })),
      420,
    );
    const orVols = inst.cls === 'stock' ? hist.map((b) => b.slice(0, 5).reduce((s, x) => s + x.v, 0)).filter((v) => v > 0) : [];
    out.set(inst.symbol, {
      inst,
      session: today,
      anchor: first.o,
      anchorTime: first.t,
      prevClose: inst.cls === 'stock' && hist.length ? ((hist.at(-1) as Bar[]).at(-1) as Bar).c : undefined,
      noise,
      orAvgVol: orVols.length ? orVols.reduce((a, b) => a + b, 0) / orVols.length : 0,
      atr: dailyAtr(hist),
      vw: vwapSeries(today),
    });
  }
  return out;
}

export async function fetchAll(
  market: MarketData,
  universe: Instrument[],
  fromMs: number,
  toMs: number,
  onError: (symbol: string, e: unknown) => void,
): Promise<Map<string, Bar[]>> {
  const out = new Map<string, Bar[]>();
  for (const inst of universe) {
    try {
      out.set(inst.symbol, await market.bars(inst.symbol, fromMs, toMs));
    } catch (e) {
      onError(inst.symbol, e);
    }
  }
  return out;
}

export interface DeskFiles {
  dir: string;
  loadState(cfg: DeskConfig): DeskState;
  saveState(s: DeskState): void;
  log(e: DeskEvent): void;
  saveDay(s: DaySummary): void;
}

export function deskFiles(dir: string, print: (line: string) => void): DeskFiles {
  ensureDir(dir);
  const statePath = join(dir, 'state.json');
  return {
    dir,
    loadState: (cfg) => readJson<DeskState | null>(statePath, null) ?? newDeskState(cfg),
    saveState: (s) => writeJsonAtomic(statePath, s),
    log(e) {
      const p = paris(e.at);
      appendJsonl(join(dir, 'events', `${p.date}.jsonl`), e);
      if (e.type === 'close') appendJsonl(join(dir, 'trades.jsonl'), e.data);
      if (e.type !== 'weights') print(`${p.date} ${hhmm(p.minutes)} [PAPIER] ${e.type.toUpperCase().padEnd(9)} ${e.msg}`);
    },
    saveDay: (s) => writeJsonAtomic(join(dir, 'days', `${s.day}.json`), s),
  };
}

/** Rejeu des `days` dernières séances terminées, dans un dossier dédié (le carnet réel n'est pas touché). */
export async function replay(opts: {
  market: MarketData;
  universe: Instrument[];
  cfg: DeskConfig;
  dir: string;
  days: number;
  nowMs: number;
  print: (line: string) => void;
}): Promise<DaySummary[]> {
  const { cfg, nowMs } = opts;
  const files = deskFiles(opts.dir, opts.print);
  const state = newDeskState(cfg);
  const engine = createEngine({ cfg, state, log: (e) => files.log(e) });
  const all = await fetchAll(opts.market, opts.universe, nowMs - 29 * 86_400_000, nowMs, (s, e) =>
    opts.print(`données indisponibles pour ${s} : ${e instanceof Error ? e.message : String(e)}`),
  );
  const ref = all.get('SPY') ?? [];
  const today = paris(nowMs);
  const sessions = [...byDay(ref.filter((b) => inUsSession(b.t)), 'America/New_York').keys()]
    .filter((d) => d < today.date || (d === today.date && today.minutes >= cfg.windowEnd))
    .sort()
    .slice(-opts.days);
  const summaries: DaySummary[] = [];
  for (const day of sessions) {
    const ctxs = buildDayContexts(day, all, opts.universe, cfg);
    const start = parisToUtc(day, cfg.windowStart);
    const end = parisToUtc(day, cfg.windowEnd);
    engine.startDay(day, start);
    for (let t = start; t < end; t += 60_000) engine.step(t, ctxs);
    const summary = engine.endDay(end - 60_000, ctxs);
    files.saveDay(summary);
    summaries.push(summary);
  }
  files.saveState(state);
  writeCarnet(opts.dir, cfg, { mode: 'rejeu' });
  return summaries;
}

/** Séance du jour en direct (papier) : de maintenant à 19 h, minute par minute. */
export async function live(opts: {
  market: MarketData;
  universe: Instrument[];
  cfg: DeskConfig;
  dir: string;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  print: (line: string) => void;
}): Promise<DaySummary | null> {
  const { cfg } = opts;
  const files = deskFiles(opts.dir, opts.print);
  let now = opts.now();
  const today = paris(now);
  const dow = new Date(`${today.date}T12:00:00Z`).getUTCDay();
  if (dow === 0 || dow === 6) {
    opts.print(`${today.date} : week-end, Bourse US fermée — pas de séance`);
    return null;
  }
  if (today.minutes >= cfg.windowEnd) {
    opts.print(`${today.date} ${hhmm(today.minutes)} : fenêtre 15 h – 19 h terminée`);
    return null;
  }
  const state = files.loadState(cfg);
  const engine: Engine = createEngine({ cfg, state, log: (e) => files.log(e) });
  const dayStart = parisToUtc(today.date, 0);
  const history = await fetchAll(opts.market, opts.universe, dayStart - Math.ceil(cfg.historyDays * 1.6 + 4) * 86_400_000, dayStart, (s, e) =>
    opts.print(`historique indisponible pour ${s} : ${e instanceof Error ? e.message : String(e)}`),
  );
  const windowStart = parisToUtc(today.date, cfg.windowStart);
  const windowEnd = parisToUtc(today.date, cfg.windowEnd);
  while (opts.now() < windowStart - 60_000) await opts.sleep(Math.min(60_000, windowStart - 60_000 - opts.now()));
  engine.startDay(today.date, opts.now());
  let lastT = windowStart - 60_000;
  let ctxs = new Map<string, DayContext>();
  let lastCarnet = 0;
  let universe = [...opts.universe];
  let inPlayLoaded = false;
  while ((now = opts.now()) < windowEnd + 60_000) {
    // 6 minutes après l'ouverture de New York : on ajoute les actions « en jeu » du jour.
    if (!inPlayLoaded && opts.market.screener && newYork(now).minutes >= 9 * 60 + 36 && newYork(now).minutes < 11 * 60) {
      inPlayLoaded = true;
      try {
        const quotes = await opts.market.screener(['most_actives', 'day_gainers']);
        const extra = inPlayCandidates(quotes, new Set(universe.map((u) => u.symbol)), 12);
        const added = await fetchAll(opts.market, extra.map((symbol) => ({ symbol, cls: 'stock' as const, label: symbol })), dayStart - Math.ceil(cfg.historyDays * 1.6 + 4) * 86_400_000, dayStart, () => {});
        for (const [s, bars] of added) history.set(s, bars);
        universe = [...universe, ...[...added.keys()].map((symbol) => ({ symbol, cls: 'stock' as const, label: symbol }))];
        engine.resetInPlay();
        opts.print(`actions « en jeu » ajoutées depuis les listes Yahoo : ${[...added.keys()].join(', ') || 'aucune'}`);
      } catch (e) {
        opts.print(`listes Yahoo indisponibles : ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const todayBars = await fetchAll(opts.market, universe, dayStart, now, () => {});
    const merged = new Map(history);
    for (const [s, bars] of todayBars) merged.set(s, [...(history.get(s) ?? []), ...bars]);
    ctxs = buildDayContexts(today.date, merged, universe, cfg);
    const latest = Math.min(Math.floor(now / 60_000) * 60_000 - 60_000, windowEnd - 60_000);
    for (let t = lastT + 60_000; t <= latest; t += 60_000) {
      // Démarrage tardif : on rattrape les sorties mais on n'entre pas « dans le passé ».
      engine.step(t, ctxs, { entries: now - t <= 3 * 60_000 });
      lastT = t;
    }
    files.saveState(state);
    if (now - lastCarnet > 5 * 60_000) {
      writeCarnet(opts.dir, cfg, { mode: 'direct' });
      lastCarnet = now;
    }
    if (lastT >= windowEnd - 60_000) break;
    await opts.sleep(Math.max(5_000, Math.floor(now / 60_000) * 60_000 + 65_000 - opts.now()));
  }
  const summary = engine.endDay(lastT, ctxs);
  files.saveDay(summary);
  files.saveState(state);
  writeCarnet(opts.dir, cfg, { mode: 'direct' });
  return summary;
}
