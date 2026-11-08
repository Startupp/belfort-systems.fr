/**
 * Courbe d'equity (un point à chaque clôture), statistiques de performance et décision de mise
 * à l'abri des gains vers le coffre.
 *
 * Fichiers dans DATA_DIR :
 *   equity.csv    une ligne par clôture, précédée d'un point initial au capital de départ ;
 *                 écrit ici, en ajout seul.
 *   trades.jsonl  un ClosedTrade par ligne ; écrit par le logger, seulement LU ici.
 *   equity.html   page autonome (aucun script, aucune ressource externe), réécrite à chaque clôture.
 *   stats.json    EquityStats + { generatedAt, mode, initialEquitySol }, réécrit à chaque clôture.
 *
 * Seules les données de l'état courant comptent : points datés d'au moins state.createdAt et
 * trades du même mode. Si state.json est recréé (remise à zéro, passage papier → live) sans vider
 * DATA_DIR, l'ancienne courbe et les anciens trades ne faussent ni le drawdown ni les stats.
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonl, writeJsonAtomic, writeTextAtomic } from '../lib/store.ts';
import type { BotState, Clock, ClosedTrade, EquitySnapshot, ExitReason, Mode } from '../types.ts';

// ---------------------------------------------------------------------------
// Contrat
// ---------------------------------------------------------------------------

export interface EquityPoint {
  at: string;
  equitySol: number;
  freeSol: number;
  positionsValueSol: number;
  drawdownPct: number;
  tradeId?: string;
  pnlSol?: number;
}

export interface EquityStats {
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  totalPnlSol: number;
  /** Gain moyen des trades gagnants (0 s'il n'y en a pas). */
  avgWinSol: number;
  /** Perte moyenne des trades perdants, signée (≤ 0 ; 0 s'il n'y en a pas). */
  avgLossSol: number;
  /** Σ gains / |Σ pertes| ; null tant qu'aucune perte n'a été enregistrée. */
  profitFactor: number | null;
  /** PnL moyen par trade, en SOL. */
  expectancySol: number;
  /** Moyenne des pnlPct (PnL en % de la mise de chaque trade). */
  expectancyPct: number;
  maxDrawdownPct: number;
  totalFeesSol: number;
  /** Frais / Σ entrySol × 100 : le coût caché des frais. */
  feesPctOfVolume: number;
  avgEntrySlippageBps: number;
  avgExitSlippageBps: number;
  avgHoldMinutes: number;
  bestTrade?: { symbol: string; pnlPct: number };
  worstTrade?: { symbol: string; pnlPct: number };
  byExitReason: Record<string, { count: number; pnlSol: number }>;
  /** Dernière equity de la courbe par rapport au capital initial, en %. */
  returnPct: number;
}

export interface EquityTrackerDeps {
  dataDir: string;
  clock: Clock;
  mode: Mode;
  getState: () => BotState;
  patchState: (p: Partial<BotState>) => void;
}

export interface EquityTracker {
  /** Equity = SOL libre + valeur des positions ; relève peakEquitySol (patchState) quand il est dépassé. */
  snapshot(freeSol: number, positionsValueSol: number): EquitySnapshot;
  /** Ajoute la ligne de equity.csv, réécrit equity.html et stats.json, renvoie les stats à jour. */
  onClose(trade: ClosedTrade, snap: EquitySnapshot): EquityStats;
  /** Relit equity.csv et trades.jsonl (état courant seulement, voir l'en-tête du fichier). */
  load(): { points: EquityPoint[]; trades: ClosedTrade[] };
}

export interface EquityHtmlInput {
  points: EquityPoint[];
  stats: EquityStats;
  trades: ClosedTrade[];
  mode: Mode;
  initialEquitySol: number;
  generatedAt: string;
  /** Gains déjà mis à l'abri vers le coffre (state.totalSweptSol) ; tuile affichée s'il est > 0. */
  totalSweptSol?: number;
}

export const EQUITY_FILES = {
  csv: 'equity.csv',
  html: 'equity.html',
  stats: 'stats.json',
  trades: 'trades.jsonl',
} as const;

const CSV_HEADER = 'at,equity_sol,free_sol,positions_sol,drawdown_pct,trade_id,pnl_sol';
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const LAST_TRADES_SHOWN = 20;

// ---------------------------------------------------------------------------
// Petits outils numériques (jamais de NaN en sortie)
// ---------------------------------------------------------------------------

function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function num(x: unknown): number {
  return isNum(x) ? x : 0;
}

/** a / b, ou 0 si b ≤ 0 ou si le résultat n'est pas fini. */
function ratio(a: number, b: number): number {
  if (!(b > 0)) return 0;
  const q = a / b;
  return Number.isFinite(q) ? q : 0;
}

/** Arrondi décimal sans « -0 » ni NaN (les stats restent lisibles dans stats.json). */
function round(x: number, decimals: number): number {
  if (!Number.isFinite(x)) return 0;
  const f = 10 ** decimals;
  const r = Math.round(x * f) / f;
  return r === 0 ? 0 : r;
}

const sol9 = (x: number): number => round(x, 9); // précision du lamport
const pct4 = (x: number): number => round(x, 4);

function tradePct(t: ClosedTrade): number {
  if (isNum(t.pnlPct)) return t.pnlPct;
  return ratio(num(t.pnlSol), num(t.entrySol)) * 100;
}

// ---------------------------------------------------------------------------
// Statistiques (pur)
// ---------------------------------------------------------------------------

/**
 * Statistiques de performance. Gagnant : pnlSol > 0 ; perdant : pnlSol ≤ 0.
 * maxDrawdownPct : plus haut courant sur les points (point initial compris), max de
 * (plus haut − equity) / plus haut × 100 ; le drawdown enregistré dans chaque point (mesuré depuis
 * le plus haut de l'état, qui voit aussi les hausses latentes entre deux clôtures) est pris en
 * compte quand il est plus grand : on ne sous-estime jamais la pire baisse vécue.
 */
export function computeStats(trades: ClosedTrade[], points: EquityPoint[], initialEquitySol: number): EquityStats {
  let wins = 0;
  let losses = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let totalPnl = 0;
  let sumPct = 0;
  let fees = 0;
  let volume = 0;
  let slipIn = 0;
  let slipOut = 0;
  let hold = 0;
  let best: { symbol: string; pnlPct: number } | undefined;
  let worst: { symbol: string; pnlPct: number } | undefined;
  // Map puis Object.fromEntries : une raison « __proto__ » devient une clé normale, sans effet de bord.
  const byReason = new Map<string, { count: number; pnlSol: number }>();

  for (const t of trades) {
    const pnl = num(t.pnlSol);
    const pnlPct = tradePct(t);
    totalPnl += pnl;
    sumPct += pnlPct;
    if (pnl > 0) {
      wins += 1;
      grossWin += pnl;
    } else {
      losses += 1;
      grossLoss -= pnl;
    }
    fees += num(t.feesSol);
    volume += num(t.entrySol);
    slipIn += num(t.entrySlippageBps);
    slipOut += num(t.exitSlippageBps);
    hold += num(t.holdMinutes);
    const symbol = typeof t.symbol === 'string' ? t.symbol : '';
    if (best === undefined || pnlPct > best.pnlPct) best = { symbol, pnlPct };
    if (worst === undefined || pnlPct < worst.pnlPct) worst = { symbol, pnlPct };
    const reason = typeof t.exitReason === 'string' && t.exitReason !== '' ? t.exitReason : 'INCONNUE';
    const agg = byReason.get(reason);
    if (agg) {
      agg.count += 1;
      agg.pnlSol += pnl;
    } else {
      byReason.set(reason, { count: 1, pnlSol: pnl });
    }
  }

  let peak = -Infinity;
  let maxDd = 0;
  for (const p of points) {
    if (!isNum(p.equitySol)) continue;
    peak = Math.max(peak, p.equitySol);
    if (peak > 0) maxDd = Math.max(maxDd, ((peak - p.equitySol) / peak) * 100);
    if (isNum(p.drawdownPct)) maxDd = Math.max(maxDd, Math.min(p.drawdownPct, 100));
  }

  const last = points.findLast((p) => isNum(p.equitySol));
  const returnPct =
    last && isNum(initialEquitySol) && initialEquitySol > 0
      ? ((last.equitySol - initialEquitySol) / initialEquitySol) * 100
      : 0;

  const n = trades.length;
  const stats: EquityStats = {
    trades: n,
    wins,
    losses,
    winRatePct: pct4(ratio(wins, n) * 100),
    totalPnlSol: sol9(totalPnl),
    avgWinSol: sol9(ratio(grossWin, wins)),
    avgLossSol: sol9(-ratio(grossLoss, losses)),
    profitFactor: grossLoss > 0 ? pct4(grossWin / grossLoss) : null,
    expectancySol: sol9(ratio(totalPnl, n)),
    expectancyPct: pct4(ratio(sumPct, n)),
    maxDrawdownPct: pct4(maxDd),
    totalFeesSol: sol9(fees),
    feesPctOfVolume: pct4(ratio(fees, volume) * 100),
    avgEntrySlippageBps: pct4(ratio(slipIn, n)),
    avgExitSlippageBps: pct4(ratio(slipOut, n)),
    avgHoldMinutes: round(ratio(hold, n), 2),
    byExitReason: Object.fromEntries(
      [...byReason].map(([reason, a]): [string, { count: number; pnlSol: number }] => [
        reason,
        { count: a.count, pnlSol: sol9(a.pnlSol) },
      ]),
    ),
    returnPct: pct4(returnPct),
  };
  if (best) stats.bestTrade = { symbol: best.symbol, pnlPct: pct4(best.pnlPct) };
  if (worst) stats.worstTrade = { symbol: worst.symbol, pnlPct: pct4(worst.pnlPct) };
  return stats;
}

// ---------------------------------------------------------------------------
// Mise à l'abri des gains (pur)
// ---------------------------------------------------------------------------

/**
 * SOL à envoyer au coffre pour que le bot ne risque jamais plus que son budget initial.
 * Seulement si equity > initial × (1 + triggerPct / 100) : min(SOL libre − réserve de frais,
 * equity − initial), arrondi au lamport puis tronqué au micro-SOL, jamais négatif.
 * Échoue fermé (0) sur une entrée non finie ou un capital initial inconnu (≤ 0).
 */
export function sweepAmountSol(
  freeSol: number,
  equitySol: number,
  initialEquitySol: number,
  triggerPct: number,
  feeReserveSol: number,
): number {
  if (![freeSol, equitySol, initialEquitySol, triggerPct, feeReserveSol].every(Number.isFinite)) return 0;
  if (initialEquitySol <= 0) return 0;
  if (!(equitySol > initialEquitySol * (1 + triggerPct / 100))) return 0;
  const raw = Math.min(freeSol - Math.max(0, feeReserveSol), equitySol - initialEquitySol);
  const microSol = Math.floor(Math.round(raw * 1e9) / 1000);
  return microSol > 0 ? microSol / 1e6 : 0;
}

// ---------------------------------------------------------------------------
// equity.csv
// ---------------------------------------------------------------------------

/** toFixed sans « -0.000000 ». */
function fixed(x: number, decimals: number): string {
  const s = x.toFixed(decimals);
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}

function csvField(s: string): string {
  const oneLine = s.replace(/[\r\n]+/g, ' ');
  return /[",]/.test(oneLine) ? `"${oneLine.replace(/"/g, '""')}"` : oneLine;
}

function csvRow(p: EquityPoint): string {
  const fields = [
    p.at,
    fixed(p.equitySol, 6),
    fixed(p.freeSol, 6),
    fixed(p.positionsValueSol, 6),
    fixed(p.drawdownPct, 4),
    p.tradeId ?? '',
    p.pnlSol === undefined ? '' : fixed(p.pnlSol, 6),
  ];
  return fields.map(csvField).join(',') + '\n';
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line.charAt(i);
    if (quoted) {
      if (c !== '"') cur += c;
      else if (line.charAt(i + 1) === '"') {
        cur += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Nombre d'un champ CSV ; undefined si vide ou invalide (Number('') vaudrait 0). */
function csvNum(s: string | undefined): number | undefined {
  if (s === undefined || s.trim() === '') return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
}

/** Lignes invalides ou tronquées (coupure pendant l'écriture) ignorées. */
function parsePoints(text: string): EquityPoint[] {
  const out: EquityPoint[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/^﻿/, '').replace(/\r$/, '');
    if (line.trim() === '' || line.startsWith('at,')) continue;
    const f = parseCsvLine(line);
    if (f.length < 7) continue;
    const at = f[0] ?? '';
    const equitySol = csvNum(f[1]);
    const freeSol = csvNum(f[2]);
    const positionsValueSol = csvNum(f[3]);
    const drawdownPct = csvNum(f[4]);
    if (!ISO_RE.test(at) || !Number.isFinite(Date.parse(at))) continue;
    if (equitySol === undefined || freeSol === undefined || positionsValueSol === undefined || drawdownPct === undefined) {
      continue;
    }
    const p: EquityPoint = { at, equitySol, freeSol, positionsValueSol, drawdownPct };
    const tradeId = f[5];
    if (tradeId) p.tradeId = tradeId;
    const pnlSol = csvNum(f[6]);
    if (pnlSol !== undefined) p.pnlSol = pnlSol;
    out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Suivi (fichiers)
// ---------------------------------------------------------------------------

function stateSinceMs(state: BotState): number | undefined {
  const ms = Date.parse(state.createdAt);
  return Number.isFinite(ms) ? ms : undefined;
}

/** Date absente ou illisible : on garde (ne jamais cacher un trade, surtout une perte). */
function isSince(at: unknown, sinceMs: number | undefined): boolean {
  if (sinceMs === undefined || typeof at !== 'string') return true;
  const ms = Date.parse(at);
  return !Number.isFinite(ms) || ms >= sinceMs;
}

function isTrade(x: unknown): x is ClosedTrade {
  return typeof x === 'object' && x !== null && isNum((x as { pnlSol?: unknown }).pnlSol);
}

/** Un même id écrit deux fois (nouvelle tentative du logger) ne compte qu'une fois. */
function dedupeTrades(trades: ClosedTrade[]): ClosedTrade[] {
  const byKey = new Map<string, ClosedTrade>();
  trades.forEach((t, i) => byKey.set(typeof t.id === 'string' ? `id:${t.id}` : `#${i}`, t));
  return [...byKey.values()];
}

function assertSnapshot(snap: EquitySnapshot): void {
  const values: Array<[string, number]> = [
    ['equitySol', snap.equitySol],
    ['freeSol', snap.freeSol],
    ['positionsValueSol', snap.positionsValueSol],
    ['drawdownPct', snap.drawdownPct],
  ];
  for (const [name, v] of values) {
    if (!Number.isFinite(v)) throw new Error(`equity : instantané invalide (${name}=${v}), erreur de programmation en amont`);
  }
  if (typeof snap.at !== 'string' || !ISO_RE.test(snap.at)) {
    throw new Error(`equity : date d'instantané invalide (${String(snap.at)})`);
  }
}

export function createEquityTracker(deps: EquityTrackerDeps): EquityTracker {
  const csvPath = join(deps.dataDir, EQUITY_FILES.csv);
  const tradesPath = join(deps.dataDir, EQUITY_FILES.trades);
  const htmlPath = join(deps.dataDir, EQUITY_FILES.html);
  const statsPath = join(deps.dataDir, EQUITY_FILES.stats);

  const readCsv = (): string => (existsSync(csvPath) ? readFileSync(csvPath, 'utf8') : '');

  function loadTrades(sinceMs: number | undefined): ClosedTrade[] {
    const rows = readJsonl<unknown>(tradesPath);
    return dedupeTrades(rows.filter((t): t is ClosedTrade => isTrade(t) && t.mode === deps.mode && isSince(t.closedAt, sinceMs)));
  }

  return {
    snapshot(freeSol: number, positionsValueSol: number): EquitySnapshot {
      if (!Number.isFinite(freeSol) || !Number.isFinite(positionsValueSol)) {
        throw new Error(
          `equity : valeurs non finies (SOL libre=${freeSol}, positions=${positionsValueSol}), erreur de programmation en amont`,
        );
      }
      const state = deps.getState();
      const equitySol = freeSol + positionsValueSol;
      const previousPeak = isNum(state.peakEquitySol) ? state.peakEquitySol : -Infinity;
      const peakEquitySol = Math.max(previousPeak, equitySol);
      if (peakEquitySol > previousPeak) deps.patchState({ peakEquitySol });
      const initialEquitySol = num(state.initialEquitySol);
      return {
        at: deps.clock.iso(),
        freeSol,
        positionsValueSol,
        equitySol,
        peakEquitySol,
        initialEquitySol,
        drawdownPct: peakEquitySol > 0 ? ((peakEquitySol - equitySol) / peakEquitySol) * 100 : 0,
        returnPct: initialEquitySol > 0 ? ((equitySol - initialEquitySol) / initialEquitySol) * 100 : 0,
      };
    },

    onClose(trade: ClosedTrade, snap: EquitySnapshot): EquityStats {
      assertSnapshot(snap);
      const state = deps.getState();
      const initial = num(state.initialEquitySol);
      const sinceMs = stateSinceMs(state);
      const existing = readCsv();
      const current = parsePoints(existing).filter((p) => isSince(p.at, sinceMs));
      const tradeId = typeof trade.id === 'string' && trade.id !== '' ? trade.id : undefined;

      // Même trade signalé deux fois (nouvelle tentative) : pas de second point sur la courbe.
      const alreadyRecorded = tradeId !== undefined && current.some((p) => p.tradeId === tradeId);
      let added: EquityPoint[] = [];
      if (!alreadyRecorded) {
        const fresh: EquityPoint[] = [];
        // La courbe de l'état courant commence au capital de départ.
        if (current.length === 0 && initial > 0) {
          const at = ISO_RE.test(state.createdAt) ? state.createdAt : snap.at;
          fresh.push({ at, equitySol: initial, freeSol: initial, positionsValueSol: 0, drawdownPct: 0 });
        }
        const point: EquityPoint = {
          at: snap.at,
          equitySol: snap.equitySol,
          freeSol: snap.freeSol,
          positionsValueSol: snap.positionsValueSol,
          drawdownPct: snap.drawdownPct,
        };
        if (tradeId !== undefined) point.tradeId = tradeId;
        if (isNum(trade.pnlSol)) point.pnlSol = trade.pnlSol;
        fresh.push(point);
        const rows = fresh.map(csvRow).join('');
        if (existing.trim() === '') writeTextAtomic(csvPath, `${CSV_HEADER}\n${rows}`);
        else appendFileSync(csvPath, (existing.endsWith('\n') ? '' : '\n') + rows, { mode: 0o600 });
        // Relu depuis le texte écrit : mêmes arrondis que load().
        added = parsePoints(rows);
      }

      const points = [...current, ...added];
      const trades = loadTrades(sinceMs);
      // L'ordre logger / equity n'est pas garanti : le trade passé en argument compte toujours.
      if (!trades.some((t) => t.id === trade.id)) trades.push(trade);

      const stats = computeStats(trades, points, initial);
      const generatedAt = deps.clock.iso();
      writeJsonAtomic(statsPath, { generatedAt, mode: deps.mode, initialEquitySol: initial, ...stats });
      writeTextAtomic(
        htmlPath,
        renderEquityHtml({
          points,
          stats,
          trades,
          mode: deps.mode,
          initialEquitySol: initial,
          generatedAt,
          totalSweptSol: num(state.totalSweptSol),
        }),
      );
      return stats;
    },

    load(): { points: EquityPoint[]; trades: ClosedTrade[] } {
      const sinceMs = stateSinceMs(deps.getState());
      return {
        points: parsePoints(readCsv()).filter((p) => isSince(p.at, sinceMs)),
        trades: loadTrades(sinceMs),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// HTML : gabarit qui échappe tout par construction
// ---------------------------------------------------------------------------

/** Fragment HTML sûr : écrit par ce module ou déjà échappé. */
class Html {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

function htmlPiece(v: unknown): string {
  if (v instanceof Html) return v.value;
  if (Array.isArray(v)) return v.map(htmlPiece).join('');
  if (v === undefined || v === null || v === false) return '';
  return escapeHtml(String(v));
}

/** Gabarit : TOUTES les valeurs interpolées sont échappées, sauf les fragments Html. */
function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0] ?? '';
  values.forEach((v, i) => {
    out += htmlPiece(v) + (strings[i + 1] ?? '');
  });
  return new Html(out);
}

/**
 * Texte venu d'inconnus (symbole, mint, raison, détail) : sans caractères de contrôle ni
 * d'inversion bidi (affichage trompeur), tronqué pour ne pas casser la mise en page.
 */
function untrusted(s: unknown, max: number): string {
  const str = typeof s === 'string' ? s : s === undefined || s === null ? '' : String(s);
  const cleaned = str.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '').trim();
  const chars = Array.from(cleaned);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : cleaned;
}

// ---------------------------------------------------------------------------
// Formats d'affichage (français : virgule décimale, espace insécable avant l'unité)
// ---------------------------------------------------------------------------

const NBSP = ' ';
const NNBSP = ' ';
const MINUS = '−';

function frNumber(x: number, decimals: number, signed = false): string {
  if (!Number.isFinite(x)) return '—';
  const s = Math.abs(x).toFixed(decimals);
  const [intPart = '0', frac] = s.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
  const body = frac ? `${grouped},${frac}` : grouped;
  if (/^0(\.0+)?$/.test(s)) return body;
  return (x < 0 ? MINUS : signed ? '+' : '') + body;
}

const fmtSol = (x: number, decimals = 4, signed = false): string => `${frNumber(x, decimals, signed)}${NBSP}SOL`;
const fmtPct = (x: number, decimals = 1, signed = false): string => `${frNumber(x, decimals, signed)}${NBSP}%`;

/** Classe de couleur d'un montant signé, d'après la valeur affichée (pas de vert sur « 0,0000 »). */
function tone(x: number, decimals: number): string {
  if (!Number.isFinite(x) || Math.abs(x) < 0.5 * 10 ** -decimals) return '';
  return x > 0 ? 'pos' : 'neg';
}

function fmtDuration(minutes: unknown): string {
  if (!isNum(minutes) || minutes < 0) return '—';
  if (minutes < 1) return `<${NBSP}1${NBSP}min`;
  const m = Math.round(minutes);
  if (m < 60) return `${m}${NBSP}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}${NBSP}h${NBSP}${String(m % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)}${NBSP}j${NBSP}${h % 24}${NBSP}h`;
}

/** Date ISO → « 08/11/2026 16:42 » (UTC). */
function fmtDate(iso: unknown): string {
  if (typeof iso !== 'string') return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return untrusted(iso, 30) || '—';
  const d = new Date(ms);
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}${NBSP}${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

function plural(n: number, word: string): string {
  return `${n}${NBSP}${word}${n > 1 ? 's' : ''}`;
}

function shortMint(mint: unknown): string {
  const chars = Array.from(untrusted(mint, 64));
  return chars.length > 12 ? `${chars.slice(0, 4).join('')}…${chars.slice(-4).join('')}` : chars.join('');
}

const EXIT_LABEL_TEXT: Record<ExitReason, string> = {
  STOP_LOSS: 'Stop loss',
  TAKE_PROFIT: 'Prise de bénéfice',
  TRAILING_STOP: 'Stop suiveur',
  TIME_STOP: 'Durée maximale atteinte',
  LIQUIDITY_DRAIN: 'Liquidité en fuite',
  NO_ROUTE: 'Plus de route de vente',
  PANIC: 'Vente de panique (fichier PANIC)',
  SHUTDOWN: 'Arrêt du bot',
  MANUAL: 'Vente manuelle',
};
/** Map : une raison « constructor » ou « __proto__ » ne remonte pas le prototype d'Object. */
const EXIT_LABELS = new Map<string, string>(Object.entries(EXIT_LABEL_TEXT));

function exitLabel(reason: unknown): string {
  const code = untrusted(reason, 40);
  return EXIT_LABELS.get(code) ?? (code || 'inconnue');
}

// ---------------------------------------------------------------------------
// Graphique SVG : x en % de la largeur, y en px. Pas de viewBox mis à l'échelle, donc des
// libellés à taille réelle sur téléphone comme sur grand écran. Survol sans script : colonne
// transparente par point (réticule + infobulle native <title>).
// ---------------------------------------------------------------------------

const CHART_H = 280;
const PLOT_TOP = 30;
const PLOT_BOTTOM = 236;
const X_LEFT = 1; // % de la largeur
const X_RIGHT = 97;
const MAX_DRAWN_POINTS = 600;

function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}

function stepDecimals(step: number): number {
  for (let d = 0; d < 9; d++) {
    const scaled = step * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6) return d;
  }
  return 9;
}

/** Au-delà de `max` points : min et max de chaque tranche (les creux restent visibles), extrémités gardées. */
function pickIndices(values: number[], max: number): number[] {
  const n = values.length;
  if (n <= max) return values.map((_, i) => i);
  const buckets = Math.floor(max / 2);
  const keep = new Set<number>([0, n - 1]);
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor((b * n) / buckets);
    const end = Math.floor(((b + 1) * n) / buckets);
    let iMin = start;
    let iMax = start;
    for (let i = start; i < end; i++) {
      const v = values[i] ?? 0;
      if (v < (values[iMin] ?? 0)) iMin = i;
      if (v > (values[iMax] ?? 0)) iMax = i;
    }
    keep.add(iMin);
    keep.add(iMax);
  }
  return [...keep].sort((a, b) => a - b);
}

function renderChart(points: EquityPoint[], initialEquitySol: number, tradesById: Map<string, ClosedTrade>): Html {
  const pts = points.filter((p) => isNum(p.equitySol));
  if (pts.length === 0) {
    return html`<p class="empty">Aucune clôture pour l'instant : la courbe démarrera au premier trade fermé.</p>`;
  }
  const n = pts.length;
  const values = pts.map((p) => p.equitySol);
  const showBase = isNum(initialEquitySol) && initialEquitySol > 0;

  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (showBase) {
    lo = Math.min(lo, initialEquitySol);
    hi = Math.max(hi, initialEquitySol);
  }
  const pad = hi > lo ? (hi - lo) * 0.08 : Math.max(Math.abs(hi) * 0.02, 0.01);
  lo -= pad;
  hi += pad;

  const yOf = (v: number): number => PLOT_TOP + ((hi - v) / (hi - lo)) * (PLOT_BOTTOM - PLOT_TOP);
  const xOf = (i: number): number => (n > 1 ? X_LEFT + ((X_RIGHT - X_LEFT) * i) / (n - 1) : X_LEFT);
  const px = (v: number): string => v.toFixed(1);
  const pc = (v: number): string => `${v.toFixed(3)}%`;

  const step = niceStep((hi - lo) / 4);
  const decimals = stepDecimals(step);
  const grid: Html[] = [];
  for (let k = Math.ceil(lo / step), guard = 0; k * step <= hi + step * 1e-9 && guard < 20; k++, guard++) {
    const y = yOf(k * step);
    grid.push(
      html`<line class="grid" x1="0" x2="100%" y1="${px(y)}" y2="${px(y)}"/><text x="0" y="${px(y - 4)}">${frNumber(k * step, decimals)}</text>`,
    );
  }

  const lastIndex = n - 1;
  const lastValue = values[lastIndex] ?? 0;
  const lastY = yOf(lastValue);
  const inGain = !showBase || lastValue >= initialEquitySol;

  // Pointillés au capital de départ ; leur libellé du côté opposé au libellé du dernier point.
  let base: Html | string = '';
  if (showBase) {
    const yb = yOf(initialEquitySol);
    base = html`<line class="base" x1="0" x2="100%" y1="${px(yb)}" y2="${px(yb)}" stroke-dasharray="6 4"/><text x="100%" dx="-2" y="${px(inGain ? yb + 15 : yb - 6)}" text-anchor="end">départ ${fmtSol(initialEquitySol)}</text>`;
  }

  const keep = pickIndices(values, MAX_DRAWN_POINTS);
  const segments: Html[] = [];
  for (let j = 1; j < keep.length; j++) {
    const a = keep[j - 1] ?? 0;
    const b = keep[j] ?? 0;
    segments.push(
      html`<line class="eq" x1="${pc(xOf(a))}" y1="${px(yOf(values[a] ?? 0))}" x2="${pc(xOf(b))}" y2="${px(yOf(values[b] ?? 0))}"/>`,
    );
  }

  let labelY = inGain ? lastY - 12 : lastY + 20;
  if (labelY < 14) labelY = lastY + 20;
  if (labelY > PLOT_BOTTOM + 8) labelY = lastY - 12;
  const lastX = xOf(lastIndex);
  const lastMark = html`<circle class="last" cx="${pc(lastX)}" cy="${px(lastY)}" r="5"/><text class="lbl" x="${pc(lastX)}" y="${px(labelY)}" text-anchor="${lastX > 50 ? 'end' : 'start'}">${fmtSol(lastValue)}</text>`;

  const hits = keep.map((i, j) => {
    const p = pts[i];
    const v = values[i] ?? 0;
    const x = xOf(i);
    const left = j > 0 ? (xOf(keep[j - 1] ?? i) + x) / 2 : 0;
    const right = j < keep.length - 1 ? (x + xOf(keep[j + 1] ?? i)) / 2 : 100;
    const trade = p?.tradeId !== undefined ? tradesById.get(p.tradeId) : undefined;
    const what = i === 0 && p?.tradeId === undefined ? 'Départ' : `Clôture n°${i}`;
    let tip = `${what} · ${fmtDate(p?.at)} · equity ${fmtSol(v)} · drawdown ${fmtPct(num(p?.drawdownPct), 1)}`;
    if (trade) tip += ` · ${untrusted(trade.symbol, 24) || '?'} ${fmtSol(num(trade.pnlSol), 4, true)}`;
    else if (p?.pnlSol !== undefined) tip += ` · PnL ${fmtSol(p.pnlSol, 4, true)}`;
    return html`<g class="hit"><title>${tip}</title><rect x="${pc(left)}" y="${PLOT_TOP}" width="${pc(right - left)}" height="${PLOT_BOTTOM - PLOT_TOP}"/><line class="xh" x1="${pc(x)}" x2="${pc(x)}" y1="${PLOT_TOP}" y2="${PLOT_BOTTOM}"/><circle class="hd" cx="${pc(x)}" cy="${px(yOf(v))}" r="4"/></g>`;
  });

  const xLabelY = PLOT_BOTTOM + 18;
  const xLabels: Html[] = [html`<text x="${pc(X_LEFT)}" y="${xLabelY}">0</text>`];
  if (n > 2) {
    const mid = Math.round(lastIndex / 2);
    xLabels.push(html`<text x="${pc(xOf(mid))}" y="${xLabelY}" text-anchor="middle">${mid}</text>`);
  }
  if (n > 1) xLabels.push(html`<text x="${pc(X_RIGHT)}" y="${xLabelY}" text-anchor="end">${lastIndex}</text>`);

  const firstValue = values[0] ?? 0;
  const aria = `Courbe d'equity : ${plural(lastIndex, 'clôture')}, de ${fmtSol(firstValue)} à ${fmtSol(lastValue)}`;
  return html`<svg class="chart" width="100%" height="${CHART_H}" role="img" aria-label="${aria}"><text class="axt" x="0" y="12">Equity (SOL)</text>${grid}${base}${segments}${lastMark}${hits}${xLabels}<text class="axt" x="50%" y="${CHART_H - 6}" text-anchor="middle">n° de clôture (0 = capital de départ)</text></svg>`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function tile(label: string, value: string, sub: string | Html = '', valueClass = ''): Html {
  return html`<div class="tile"><div class="k">${label}</div><div class="v ${valueClass}">${value}</div>${sub ? html`<div class="s">${sub}</div>` : ''}</div>`;
}

function renderTiles(stats: EquityStats, equity: number, initial: number, totalSweptSol: number): Html {
  const hasTrades = stats.trades > 0;
  const pf = stats.profitFactor;
  const tiles: Html[] = [
    tile('Equity actuelle', fmtSol(equity), `départ ${fmtSol(initial)}`),
    tile('Rendement', fmtPct(stats.returnPct, 2, true), `PnL réalisé ${fmtSol(stats.totalPnlSol, 4, true)}`, tone(stats.returnPct, 2)),
    tile('Trades', String(stats.trades), `${plural(stats.wins, 'gagnant')} · ${plural(stats.losses, 'perdant')}`),
    tile(
      'Taux de réussite',
      hasTrades ? fmtPct(stats.winRatePct, 1) : '—',
      hasTrades ? `gain moyen ${fmtSol(stats.avgWinSol, 4, true)} · perte moyenne ${fmtSol(stats.avgLossSol, 4, true)}` : '',
    ),
    tile(
      'Profit factor',
      pf === null ? '—' : frNumber(pf, 2),
      pf === null ? (hasTrades ? "aucune perte pour l'instant" : 'pas encore de trade') : 'gains bruts / pertes brutes',
      pf === null ? '' : pf >= 1 ? 'pos' : 'neg',
    ),
    tile(
      'Espérance par trade',
      hasTrades ? fmtSol(stats.expectancySol, 4, true) : '—',
      hasTrades ? `${fmtPct(stats.expectancyPct, 2, true)} de la mise en moyenne` : '',
      tone(stats.expectancySol, 4),
    ),
    tile('Drawdown max', fmtPct(stats.maxDrawdownPct, 1), 'pire baisse depuis un plus haut'),
    tile('Frais totaux', fmtSol(stats.totalFeesSol, 4), `${fmtPct(stats.feesPctOfVolume, 2)} du volume engagé`),
    tile(
      'Slippage moyen',
      hasTrades ? `${frNumber(stats.avgEntrySlippageBps, 0)} / ${frNumber(stats.avgExitSlippageBps, 0)}${NBSP}bps` : '—',
      'entrée / sortie (positif = pire que le devis)',
    ),
    tile('Durée moyenne', hasTrades ? fmtDuration(stats.avgHoldMinutes) : '—', 'par position'),
  ];
  if (totalSweptSol > 0) {
    const withVault = initial > 0 ? ((equity + totalSweptSol - initial) / initial) * 100 : 0;
    tiles.push(tile("Mis à l'abri (coffre)", fmtSol(totalSweptSol), `rendement coffre inclus ${fmtPct(withVault, 2, true)}`));
  }
  return html`<section class="tiles" aria-label="Indicateurs">${tiles}</section>`;
}

function renderTradesTable(trades: ClosedTrade[], equityByTrade: Map<string, number>): Html {
  if (trades.length === 0) return html`<p class="empty">Aucun trade clôturé pour l'instant.</p>`;
  const rows = trades
    .slice(-LAST_TRADES_SHOWN)
    .reverse()
    .map((t) => {
      const pnl = num(t.pnlSol);
      const pnlPct = tradePct(t);
      const eqAfter = (typeof t.id === 'string' ? equityByTrade.get(t.id) : undefined) ?? (isNum(t.equityAfterSol) ? t.equityAfterSol : undefined);
      const detail = untrusted(t.exitDetail, 160);
      return html`<tr><td data-label="Date (UTC)">${fmtDate(t.closedAt)}</td><td data-label="Token"><span class="c"><span class="sym">${untrusted(t.symbol, 24) || '?'}</span><span class="mint">${shortMint(t.mint)}</span></span></td><td class="n" data-label="Mise (SOL)">${frNumber(num(t.entrySol), 4)}</td><td class="n" data-label="Sortie (SOL)">${frNumber(num(t.exitSol), 4)}</td><td class="n" data-label="Durée">${fmtDuration(t.holdMinutes)}</td><td class="n ${tone(pnl, 4)}" data-label="PnL (SOL)">${frNumber(pnl, 4, true)}</td><td class="n ${tone(pnlPct, 1)}" data-label="PnL (%)">${fmtPct(pnlPct, 1, true)}</td><td class="n" data-label="Equity après (SOL)">${eqAfter === undefined ? '—' : frNumber(eqAfter, 4)}</td><td data-label="Raison de sortie"><span class="c">${exitLabel(t.exitReason)}${detail ? html`<span class="detail">${detail}</span>` : ''}</span></td></tr>`;
    });
  return html`<table class="cards"><thead><tr><th scope="col">Date (UTC)</th><th scope="col">Token</th><th scope="col" class="n">Mise (SOL)</th><th scope="col" class="n">Sortie (SOL)</th><th scope="col" class="n">Durée</th><th scope="col" class="n">PnL (SOL)</th><th scope="col" class="n">PnL (%)</th><th scope="col" class="n">Equity après (SOL)</th><th scope="col">Raison de sortie</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderReasonTable(stats: EquityStats): Html {
  const entries = Object.entries(stats.byExitReason).sort(
    (a, b) => num(b[1].count) - num(a[1].count) || num(a[1].pnlSol) - num(b[1].pnlSol),
  );
  if (entries.length === 0) return html`<p class="empty">Aucun trade clôturé pour l'instant.</p>`;
  const rows = entries.map(([reason, agg]) => {
    const count = num(agg.count);
    const pnl = num(agg.pnlSol);
    const avg = ratio(pnl, count);
    const label = exitLabel(reason);
    const code = untrusted(reason, 40);
    return html`<tr><td data-label="Raison"><span class="c">${label}${code && code !== label ? html`<span class="code">${code}</span>` : ''}</span></td><td class="n" data-label="Trades">${count}</td><td class="n ${tone(pnl, 4)}" data-label="PnL total (SOL)">${frNumber(pnl, 4, true)}</td><td class="n ${tone(avg, 4)}" data-label="PnL moyen (SOL)">${frNumber(avg, 4, true)}</td></tr>`;
  });
  return html`<table class="cards"><thead><tr><th scope="col">Raison</th><th scope="col" class="n">Trades</th><th scope="col" class="n">PnL total (SOL)</th><th scope="col" class="n">PnL moyen (SOL)</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const PAGE_CSS = `
*,*::before,*::after{box-sizing:border-box}
:root{color-scheme:light dark;--page:#f9f9f7;--card:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;--border:rgba(11,11,11,.1);--line:#2a78d6;--pos:#006300;--neg:#b42323;--warn-bg:#fff3d1;--warn-ink:#6b4a00;--warn-edge:#fab219}
@media (prefers-color-scheme:dark){:root{--page:#0d0d0d;--card:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--axis:#4a4a46;--border:rgba(255,255,255,.1);--line:#3987e5;--pos:#0ca30c;--neg:#f07070;--warn-bg:#3a2c05;--warn-ink:#ffd36b;--warn-edge:#fab219}}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--page);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow-wrap:anywhere}
main{max-width:1040px;margin:0 auto;padding:16px}
h1{font-size:1.35rem;line-height:1.25;margin:4px 0 4px}
h2{font-size:1.02rem;margin:0 0 10px}
.meta{color:var(--ink2);font-size:.88rem;margin:0 0 14px}
.banner{display:flex;gap:10px;align-items:flex-start;background:var(--warn-bg);color:var(--warn-ink);border:1px solid var(--warn-edge);border-left-width:5px;border-radius:10px;padding:10px 12px;margin:0 0 14px}
.banner svg{flex:none;margin-top:1px}
.banner strong{letter-spacing:.03em}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:10px;margin:0 0 14px}
.tile{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:10px 12px;min-width:0}
.tile .k{color:var(--ink2);font-size:.8rem}
.tile .v{font-size:1.18rem;font-weight:600;margin-top:2px;overflow-wrap:normal}
.tile .s{color:var(--ink2);font-size:.76rem;margin-top:3px}
.pos{color:var(--pos)}
.neg{color:var(--neg)}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 12px;margin:0 0 14px}
.chart{display:block;width:100%;height:${CHART_H}px}
.chart text{fill:var(--ink2);font-size:11px;font-variant-numeric:tabular-nums}
.chart .axt{fill:var(--muted)}
.chart .lbl{fill:var(--ink);font-size:12px;font-weight:600}
.chart .grid{stroke:var(--grid);stroke-width:1}
.chart .base{stroke:var(--muted);stroke-width:1.5}
.chart .eq{stroke:var(--line);stroke-width:2;stroke-linecap:round}
.chart .last{fill:var(--line);stroke:var(--card);stroke-width:2}
.chart .hit rect{fill:transparent;pointer-events:all}
.chart .hit .xh{stroke:var(--axis);stroke-width:1;opacity:0}
.chart .hit .hd{fill:var(--line);stroke:var(--card);stroke-width:2;opacity:0}
.chart .hit:hover .xh,.chart .hit:hover .hd{opacity:1}
.note{color:var(--ink2);font-size:.8rem;margin:8px 0 0}
table{width:100%;border-collapse:collapse;font-size:.86rem}
th,td{padding:7px 8px;border-bottom:1px solid var(--grid);text-align:left;vertical-align:top}
th{color:var(--ink2);font-weight:600;font-size:.76rem;white-space:nowrap}
.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.c{display:block}
.sym{font-weight:600}
.mint,.code{display:block;color:var(--muted);font-size:.74rem}
.detail{display:block;color:var(--ink2);font-size:.76rem}
.empty{color:var(--ink2);margin:6px 0}
footer{color:var(--ink2);font-size:.78rem;margin:4px 0 28px}
footer p{margin:0 0 6px}
@media (max-width:640px){
.cards thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.cards,.cards tbody,.cards tr,.cards td{display:block;width:100%}
.cards tr{border:1px solid var(--border);border-radius:10px;padding:4px 10px;margin:0 0 8px}
.cards td{display:flex;justify-content:space-between;align-items:baseline;gap:12px;border:0;padding:4px 0;text-align:right;white-space:normal}
.cards td::before{content:attr(data-label);color:var(--ink2);font-size:.76rem;text-align:left;flex:none}
}
`;

const WARNING_ICON = html`<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20.5h20z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 9.5v5M12 17.6v.1" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;

/** Page autonome : aucun script, aucune police ni image externe ; tout texte interpolé est échappé. */
export function renderEquityHtml(input: EquityHtmlInput): string {
  const { points, stats, trades, mode, generatedAt } = input;
  const initial = num(input.initialEquitySol);
  const lastPoint = points.findLast((p) => isNum(p.equitySol));
  const equity = lastPoint ? lastPoint.equitySol : initial;

  const tradesById = new Map<string, ClosedTrade>();
  for (const t of trades) if (typeof t.id === 'string') tradesById.set(t.id, t);
  const equityByTrade = new Map<string, number>();
  for (const p of points) if (p.tradeId !== undefined && isNum(p.equitySol)) equityByTrade.set(p.tradeId, p.equitySol);

  const banner =
    mode === 'paper'
      ? html`<div class="banner" role="note">${WARNING_ICON}<div><strong>MODE PAPIER (simulation)</strong> : aucun SOL réel n'est engagé. Slippage et frais sont simulés ; le réel peut faire moins bien (transactions échouées, MEV, liquidité qui fond).</div></div>`
      : '';
  const modeLabel = mode === 'paper' ? 'mode papier (simulation)' : 'mode réel : SOL engagés';

  const best = stats.bestTrade;
  const worst = stats.worstTrade;
  const extremes =
    best && worst
      ? html`<p class="meta">Meilleur trade&nbsp;: <strong>${untrusted(best.symbol, 24) || '?'}</strong> (${fmtPct(best.pnlPct, 1, true)}) · pire trade&nbsp;: <strong>${untrusted(worst.symbol, 24) || '?'}</strong> (${fmtPct(worst.pnlPct, 1, true)})</p>`
      : '';
  const shown = Math.min(trades.length, LAST_TRADES_SHOWN);

  const page = html`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Courbe d'equity — solbot</title>
<style>${new Html(PAGE_CSS)}</style>
</head>
<body>
<main>
${banner}
<header>
<h1>Courbe d'equity — solbot</h1>
<p class="meta">Généré le ${fmtDate(generatedAt)} UTC · ${modeLabel} · mise à jour à chaque clôture</p>
</header>
${renderTiles(stats, equity, initial, num(input.totalSweptSol))}
<section class="card">
<h2>Equity après chaque clôture</h2>
${renderChart(points, initial, tradesById)}
<p class="note">Axe horizontal : n° de clôture (0 = capital de départ). Axe vertical : equity en SOL. Pointillés : capital de départ. Survoler la courbe affiche le détail de chaque point.</p>
</section>
<section class="card">
<h2>${shown > 1 ? `${shown} derniers trades` : 'Dernier trade'}</h2>
${extremes}
${renderTradesTable(trades, equityByTrade)}
</section>
<section class="card">
<h2>PnL par raison de sortie</h2>
${renderReasonTable(stats)}
</section>
<footer>
<p>Equity = SOL libre + valeur de liquidation des positions ouvertes (ce qu'une vente immédiate rapporterait). Frais = frais réseau et de priorité, achat et vente cumulés. Slippage = écart entre le devis et l'exécution réelle.</p>
<p>Données brutes dans le même dossier : equity.csv, trades.jsonl, stats.json.</p>
</footer>
</main>
</body>
</html>
`;
  return page.value;
}
