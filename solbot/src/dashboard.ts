/**
 * Tableau de bord : <DATA_DIR>/dashboard.html, régénéré à chaque scan et à chaque clôture.
 *
 *   1. état du bot et chiffres clés ;
 *   2. positions ouvertes et prochains déclencheurs ;
 *   3. actions prises et pourquoi (achats, ventes, rejets, garde-fous) ;
 *   4. radar : ce que le bot surveille au dernier scan, et ce qu'il en a fait ;
 *   5. prévision : ce que la stratégie devrait donner, et comment (simulation sur les vrais trades) ;
 *   6. budget outils : quand un outil payant devient rentable (payé uniquement sur les bénéfices).
 *
 * Page autonome : aucun script, aucune ressource externe, rafraîchie toutes les 60 s par le navigateur.
 * Tout texte venu de l'extérieur (noms de tokens, raisons) est échappé : ils sont écrits par des inconnus.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.ts';
import { readJson, readJsonlTail, utcDate, writeTextAtomic } from './lib/store.ts';
import { computeStats, createEquityTracker } from './workers/equity.ts';
import type { EquityPoint, EquityStats } from './workers/equity.ts';
import type { BotState, ClosedTrade, Clock, JournalEvent, Mode, Position } from './types.ts';

// ---------------------------------------------------------------------------
// Radar (écrit par l'orchestrateur après chaque scan)
// ---------------------------------------------------------------------------

export type RadarDecision = 'achat' | 'rejet anti-rug' | 'taille refusée' | 'achat échoué' | 'non évalué';

export interface RadarEntry {
  mint: string;
  symbol: string;
  score: number;
  signals: string[];
  liquidityUsd: number;
  marketCapUsd: number;
  spikeRatio: number;
  ageMinutes: number;
  decision: RadarDecision;
  why: string[];
}

export interface Radar {
  at: string;
  examined: number;
  rejectedCounts: Record<string, number>;
  sourcesFailed: string[];
  /** Raisons pour lesquelles aucune entrée n'était permise (garde-fous). */
  blockedBy: string[];
  solUsd?: number;
  candidates: RadarEntry[];
}

export const RADAR_FILE = 'radar.json';
export const DASHBOARD_FILE = 'dashboard.html';

interface RejectRecord {
  at?: string;
  mint?: string;
  symbol?: string;
  rejectCodes?: string[];
  reasons?: string[];
}

// ---------------------------------------------------------------------------
// Prévision
// ---------------------------------------------------------------------------

/** Hypothèse de départ (avant d'avoir 20 vrais trades) : volontairement prudente. */
export const PRIOR = {
  winRate: 0.4,
  /** Part des positions qui s'effondrent avant que le stop ne puisse vendre (rug, liquidité retirée). */
  rugRate: 0.03,
  /** Coût d'un aller-retour : frais Jupiter (jusqu'à 0,5 % par swap sur les tokens < 24 h), réseau, loyer, glissement. */
  costPct: 4,
} as const;

export const MIN_TRADES_FOR_OBSERVED = 20;

export interface ProjectionInput {
  trades: ClosedTrade[];
  positionPct: number;
  stopLossPct: number;
  takeProfitPct: number;
  haltDrawdownPct: number;
  startEquitySol: number;
  initialEquitySol: number;
  horizon?: number;
  paths?: number;
  seed?: number;
}

export interface Projection {
  basis: 'observé' | 'hypothèse';
  sampleSize: number;
  winRatePct: number;
  breakEvenWinRatePct: number;
  avgWinPct: number;
  avgLossPct: number;
  costPct: number;
  /** Espérance par trade, en % de la mise. */
  expectancyPct: number;
  horizon: number;
  p10: number[];
  p50: number[];
  p90: number[];
  finalP5Pct: number;
  finalP50Pct: number;
  finalP95Pct: number;
  probProfitPct: number;
  probHaltPct: number;
  verdict: string;
}

/** Générateur pseudo-aléatoire déterministe (mulberry32) : même entrée → même prévision. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx] as number;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

/**
 * Simule `paths` futurs de `horizon` trades : chaque trade engage positionPct % de l'equity et
 * rapporte un rendement tiré soit des vrais trades (≥ 20), soit de l'hypothèse prudente.
 * L'arrêt définitif (HALT_DRAWDOWN_PCT) est appliqué comme dans le bot.
 */
export function project(i: ProjectionInput): Projection {
  const horizon = i.horizon ?? 100;
  const paths = i.paths ?? 2000;
  const rand = rng(i.seed ?? 42);
  const f = i.positionPct / 100;
  const floor = i.initialEquitySol * (1 - i.haltDrawdownPct / 100);
  const observed = i.trades.length >= MIN_TRADES_FOR_OBSERVED;

  const returns = i.trades.map((t) => t.pnlPct / 100).filter((r) => Number.isFinite(r));
  let sample: () => number;
  let winRate: number;
  let avgWin: number;
  let avgLoss: number;
  let costPct: number;

  if (observed) {
    // Rendements réels, nets de tous les frais : on les rejoue au hasard.
    sample = () => returns[Math.floor(rand() * returns.length)] as number;
    const wins = returns.filter((r) => r > 0);
    const losses = returns.filter((r) => r <= 0);
    winRate = wins.length / returns.length;
    avgWin = mean(wins) * 100;
    avgLoss = -mean(losses) * 100;
    const fees = i.trades.reduce((s, t) => s + t.feesSol, 0);
    const vol = i.trades.reduce((s, t) => s + t.entrySol, 0);
    costPct = vol > 0 ? (fees / vol) * 100 : 0;
  } else {
    // Hypothèse : gains entre 60 % et 110 % de l'objectif (stop suiveur, sortie au temps),
    // pertes entre 60 % et 130 % du stop (le prix saute parfois au-delà), quelques rugs à −95 %.
    const c = PRIOR.costPct / 100;
    const tp = i.takeProfitPct / 100;
    const sl = i.stopLossPct / 100;
    sample = () => {
      const u = rand();
      if (u < PRIOR.rugRate) return -0.95 - c;
      if (u < PRIOR.rugRate + PRIOR.winRate) return tp * (0.6 + 0.5 * rand()) - c;
      return -sl * (0.6 + 0.7 * rand()) - c;
    };
    winRate = PRIOR.winRate;
    avgWin = (i.takeProfitPct * 0.85) - PRIOR.costPct;
    const lossShare = 1 - PRIOR.winRate - PRIOR.rugRate;
    avgLoss = ((lossShare * i.stopLossPct * 0.95 + PRIOR.rugRate * 95) / (1 - PRIOR.winRate)) + PRIOR.costPct;
    costPct = PRIOR.costPct;
  }

  // Espérance par trade et seuil de rentabilité (part de trades gagnants qui annule l'espérance).
  const expectancyPct = winRate * avgWin - (1 - winRate) * avgLoss;
  const breakEven = avgWin + avgLoss > 0 ? avgLoss / (avgWin + avgLoss) : 1;

  const steps: number[][] = Array.from({ length: horizon + 1 }, () => new Array<number>(paths));
  const finals: number[] = [];
  let halted = 0;
  let profit = 0;
  for (let p = 0; p < paths; p++) {
    let e = i.startEquitySol;
    let stopped = false;
    (steps[0] as number[])[p] = e;
    for (let k = 1; k <= horizon; k++) {
      if (!stopped) {
        e = Math.max(0, e * (1 + f * sample()));
        if (e <= floor) stopped = true;
      }
      (steps[k] as number[])[p] = e;
    }
    if (stopped) halted++;
    if (e > i.startEquitySol) profit++;
    finals.push(((e - i.startEquitySol) / i.startEquitySol) * 100);
  }
  const p10: number[] = [];
  const p50: number[] = [];
  const p90: number[] = [];
  for (const s of steps) {
    const sorted = [...s].sort((a, b) => a - b);
    p10.push(percentile(sorted, 0.1));
    p50.push(percentile(sorted, 0.5));
    p90.push(percentile(sorted, 0.9));
  }
  finals.sort((a, b) => a - b);
  const r = (x: number): number => Math.round(x * 10) / 10;
  const proj: Projection = {
    basis: observed ? 'observé' : 'hypothèse',
    sampleSize: i.trades.length,
    winRatePct: r(winRate * 100),
    breakEvenWinRatePct: r(breakEven * 100),
    avgWinPct: r(avgWin),
    avgLossPct: r(avgLoss),
    costPct: r(costPct),
    expectancyPct: r(expectancyPct),
    horizon,
    p10,
    p50,
    p90,
    finalP5Pct: r(percentile(finals, 0.05)),
    finalP50Pct: r(percentile(finals, 0.5)),
    finalP95Pct: r(percentile(finals, 0.95)),
    probProfitPct: r((profit / paths) * 100),
    probHaltPct: r((halted / paths) * 100),
    verdict: '',
  };
  proj.verdict = verdictOf(proj, i.haltDrawdownPct);
  return proj;
}

function signed(x: number): string {
  return `${x > 0 ? '+' : ''}${fr(x, 1)}`;
}

function verdictOf(p: Projection, haltPct: number): string {
  const range = `médiane ${signed(p.finalP50Pct)} %, 9 fois sur 10 entre ${signed(p.finalP5Pct)} % et ${signed(p.finalP95Pct)} %`;
  if (p.basis === 'hypothèse') {
    return (
      `Pas encore assez de trades (${p.sampleSize}/${MIN_TRADES_FOR_OBSERVED}) : je pars d'une hypothèse prudente. ` +
      `Avec ${fr(p.winRatePct, 0)} % de trades gagnants et ${fr(p.costPct, 1)} % de frais par aller-retour, l'espérance serait de ` +
      `${signed(p.expectancyPct)} % par trade ; sur ${p.horizon} trades : ${range}. ` +
      `Pour gagner, il faut au moins ${fr(p.breakEvenWinRatePct, 0)} % de trades gagnants : c'est ce que la phase papier doit prouver.`
    );
  }
  const head =
    p.expectancyPct > 0
      ? `Stratégie rentable sur ${p.sampleSize} trades`
      : `Stratégie non rentable sur ${p.sampleSize} trades`;
  return (
    `${head} : ${fr(p.winRatePct, 0)} % de gagnants (seuil de rentabilité ${fr(p.breakEvenWinRatePct, 0)} %), ` +
    `espérance ${signed(p.expectancyPct)} % par trade. Si ça continue, ${p.horizon} trades de plus donneraient ${range} ; ` +
    `chance de finir en gain ${fr(p.probProfitPct, 0)} %, de toucher l'arrêt à −${haltPct} % : ${fr(p.probHaltPct, 0)} %.`
  );
}

// ---------------------------------------------------------------------------
// Budget outils
// ---------------------------------------------------------------------------

export interface ToolOption {
  name: string;
  costUsdMonth: number;
  benefit: string;
  when: string;
}

/** Outils envisagés, par ordre d'utilité. Prix indicatifs (nov. 2026) : à revérifier avant achat. */
export const TOOLS: ToolOption[] = [
  { name: 'Clé API Jupiter (portail)', costUsdMonth: 0, benefit: 'plus de débit, moins de refus 429', when: 'dès maintenant' },
  { name: 'RPC Helius, offre gratuite', costUsdMonth: 0, benefit: 'solde, simulation avant signature', when: 'au passage en live (obligatoire)' },
  { name: 'Petit VPS en Europe', costUsdMonth: 6, benefit: 'positions surveillées 24 h/24', when: 'au passage en live' },
  { name: 'Helius Developer', costUsdMonth: 49, benefit: 'meilleur atterrissage des transactions, flux temps réel', when: 'si les échecs d’exécution coûtent plus que l’abonnement' },
];

export interface ToolDecision extends ToolOption {
  decision: 'oui' | 'non' | 'à tester';
  why: string;
}

export function decideTools(input: {
  stats: EquityStats;
  trades: ClosedTrade[];
  nowMs: number;
  solUsd?: number;
  budgetPct: number;
  mode: Mode;
}): { budgetSol: number; monthlyVolumeSol: number; decisions: ToolDecision[] } {
  const profit = Math.max(0, input.stats.totalPnlSol);
  const budgetSol = (profit * input.budgetPct) / 100;
  const monthAgo = input.nowMs - 30 * 86_400_000;
  const monthlyVolumeSol = input.trades.filter((t) => Date.parse(t.closedAt) >= monthAgo).reduce((s, t) => s + t.entrySol, 0);
  const decisions = TOOLS.map((t): ToolDecision => {
    if (t.costUsdMonth === 0) return { ...t, decision: 'oui', why: 'gratuit' };
    if (t.name.includes('VPS')) {
      return input.mode === 'live'
        ? { ...t, decision: 'oui', why: 'en live, un PC éteint laisse des positions sans surveillance : coût minime face au risque' }
        : { ...t, decision: 'non', why: 'inutile en papier' };
    }
    if (!input.solUsd || input.solUsd <= 0) return { ...t, decision: 'non', why: 'prix du SOL inconnu : pas de calcul possible' };
    const costSol = t.costUsdMonth / input.solUsd;
    if (budgetSol < 3 * costSol) {
      return { ...t, decision: 'non', why: `budget outils ${fr(budgetSol, 3)} SOL < 3 mois d’abonnement (${fr(3 * costSol, 3)} SOL)` };
    }
    const needed = monthlyVolumeSol > 0 ? ((2 * costSol) / monthlyVolumeSol) * 100 : Infinity;
    if (needed > 2) {
      return {
        ...t,
        decision: 'non',
        why: Number.isFinite(needed)
          ? `il faudrait +${fr(needed, 1)} % d’espérance par trade pour rapporter 2× son coût : irréaliste à ce volume`
          : 'aucun volume ce mois-ci',
      };
    }
    return { ...t, decision: 'à tester', why: `rentable s’il ajoute +${fr(needed, 1)} % d’espérance par trade : A/B en papier d’abord` };
  });
  return { budgetSol, monthlyVolumeSol, decisions };
}

// ---------------------------------------------------------------------------
// Rendu HTML
// ---------------------------------------------------------------------------

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c] ?? c);
}

function fr(x: number, d: number): string {
  if (!Number.isFinite(x)) return '—';
  return x.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function time(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
}

interface Action {
  at: string;
  kind: 'ACHAT' | 'VENTE' | 'REJET' | 'TAILLE' | 'ÉCHEC' | 'GARDE-FOU' | 'COFFRE' | 'ERREUR';
  title: string;
  details: string[];
  tone: 'good' | 'bad' | 'neutral' | 'warn';
}

function buildActions(trades: ClosedTrade[], positions: Position[], rejects: RejectRecord[], events: JournalEvent[]): Action[] {
  const out: Action[] = [];
  const buy = (p: { openedAt: string; symbol: string; entrySol: number; entryReasons: string[] }): Action => ({
    at: p.openedAt,
    kind: 'ACHAT',
    title: `Achat ${p.symbol} — ${fr(p.entrySol, 3)} SOL`,
    details: p.entryReasons,
    tone: 'neutral',
  });
  for (const t of trades) {
    out.push(buy(t));
    out.push({
      at: t.closedAt,
      kind: 'VENTE',
      title: `Vente ${t.symbol} ${signed(t.pnlPct)} % (${signed(t.pnlSol)} SOL) après ${Math.round(t.holdMinutes)} min`,
      details: [
        `${t.exitReason} : ${t.exitDetail}`,
        `glissement entrée ${fr(t.entrySlippageBps, 0)} bps, sortie ${fr(t.exitSlippageBps, 0)} bps ; frais ${fr(t.feesSol, 4)} SOL`,
      ],
      tone: t.pnlSol > 0 ? 'good' : 'bad',
    });
  }
  for (const p of positions) out.push(buy(p));
  for (const r of rejects) {
    if (!r.at) continue;
    out.push({ at: r.at, kind: 'REJET', title: `Rejet ${r.symbol ?? '?'} (${(r.rejectCodes ?? []).join(', ')})`, details: r.reasons ?? [], tone: 'warn' });
  }
  const kinds: Partial<Record<JournalEvent['type'], Action['kind']>> = {
    size_skip: 'TAILLE',
    open_failed: 'ÉCHEC',
    close_failed: 'ÉCHEC',
    guard: 'GARDE-FOU',
    sweep: 'COFFRE',
  };
  for (const e of events) {
    const kind = kinds[e.type];
    if (!kind) continue;
    out.push({ at: e.at, kind, title: e.msg, details: [], tone: kind === 'COFFRE' ? 'good' : 'warn' });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 40);
}

function fanChart(p: Projection, initial: number, floor: number): string {
  const W = 640;
  const H = 220;
  const padL = 56;
  const padB = 24;
  const padT = 10;
  const vals = [...p.p10, ...p.p90, initial, floor];
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi - lo < 1e-9) {
    hi += 1;
    lo -= 1;
  }
  const x = (k: number): number => padL + (k / p.horizon) * (W - padL - 8);
  const y = (v: number): number => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const line = (arr: number[]): string => arr.map((v, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const band =
    p.p90.map((v, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(' ') +
    ' ' +
    [...p.p10].reverse().map((v, k) => `L${x(p.horizon - k).toFixed(1)},${y(v).toFixed(1)}`).join(' ') +
    ' Z';
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Projection de l'equity sur ${p.horizon} trades">
  <path d="${band}" class="band"/>
  <path d="${line(p.p50)}" class="median"/>
  <line x1="${padL}" x2="${W - 8}" y1="${y(initial).toFixed(1)}" y2="${y(initial).toFixed(1)}" class="ref"/>
  <line x1="${padL}" x2="${W - 8}" y1="${y(floor).toFixed(1)}" y2="${y(floor).toFixed(1)}" class="halt"/>
  <text x="${padL - 6}" y="${y(hi).toFixed(1)}" class="ax" text-anchor="end" dominant-baseline="hanging">${fr(hi, 2)}</text>
  <text x="${padL - 6}" y="${y(lo).toFixed(1)}" class="ax" text-anchor="end">${fr(lo, 2)}</text>
  <text x="${padL - 6}" y="${y(initial).toFixed(1)}" class="ax" text-anchor="end" dominant-baseline="middle">départ</text>
  <text x="${W - 10}" y="${(y(floor) - 4).toFixed(1)}" class="ax haltx" text-anchor="end">arrêt automatique</text>
  <text x="${padL}" y="${H - 6}" class="ax">aujourd'hui</text>
  <text x="${W - 8}" y="${H - 6}" class="ax" text-anchor="end">+${p.horizon} trades</text>
</svg>`;
}

function sparkline(points: EquityPoint[], initial: number): string {
  if (points.length < 2) return '<p class="muted">La courbe apparaîtra après la première vente.</p>';
  const W = 640;
  const H = 120;
  const vals = [...points.map((p) => p.equitySol), initial];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals) + 1e-9;
  const x = (k: number): number => 8 + (k / (points.length - 1)) * (W - 16);
  const y = (v: number): number => 8 + (1 - (v - lo) / (hi - lo)) * (H - 16);
  const d = points.map((p, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(p.equitySol).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Courbe d'equity réelle"><line x1="8" x2="${W - 8}" y1="${y(initial).toFixed(1)}" y2="${y(initial).toFixed(1)}" class="ref"/><path d="${d}" class="median"/></svg>`;
}

export interface DashboardInput {
  mode: Mode;
  generatedAt: string;
  nowMs: number;
  state: BotState;
  cfg: Pick<Config, 'sizer' | 'exits' | 'guards' | 'tools'>;
  trades: ClosedTrade[];
  points: EquityPoint[];
  stats: EquityStats;
  events: JournalEvent[];
  rejects: RejectRecord[];
  radar: Radar | null;
  stopFile: boolean;
}

export function renderDashboard(i: DashboardInput): string {
  const s = i.state;
  const positionsValue = s.positions.reduce((a, p) => a + p.lastValueSol, 0);
  const free = i.mode === 'paper' ? s.paperSol : (i.points.at(-1)?.freeSol ?? 0);
  const equity = free + positionsValue;
  const ret = s.initialEquitySol > 0 ? ((equity + s.totalSweptSol - s.initialEquitySol) / s.initialEquitySol) * 100 : 0;
  const proj = project({
    trades: i.trades,
    positionPct: i.cfg.sizer.positionPct,
    stopLossPct: i.cfg.exits.stopLossPct,
    takeProfitPct: i.cfg.exits.takeProfitPct,
    haltDrawdownPct: i.cfg.guards.haltDrawdownPct,
    startEquitySol: equity > 0 ? equity : s.initialEquitySol,
    initialEquitySol: s.initialEquitySol,
  });
  const floor = s.initialEquitySol * (1 - i.cfg.guards.haltDrawdownPct / 100);
  const tools = decideTools({ stats: i.stats, trades: i.trades, nowMs: i.nowMs, solUsd: i.radar?.solUsd, budgetPct: i.cfg.tools.budgetPct, mode: i.mode });
  const actions = buildActions(i.trades, s.positions, i.rejects, i.events);
  const usd = i.radar?.solUsd;
  const inUsd = (sol: number): string => (usd ? ` <span class="muted">≈ ${fr(sol * usd, 0)} $</span>` : '');

  const status: string[] = [];
  if (s.halted) status.push(`<b>Arrêt définitif</b> : ${esc(s.halted.reason)}`);
  if (i.stopFile) status.push('<b>STOP</b> : plus de nouvelles entrées (les sorties continuent)');
  if (s.pausedUntil && Date.parse(s.pausedUntil) > i.nowMs) status.push(`En pause jusqu'au ${esc(time(s.pausedUntil))}`);
  for (const b of i.radar?.blockedBy ?? []) status.push(esc(b));
  const phaseOk = i.stats.trades >= 50 && i.stats.expectancySol > 0 && i.stats.maxDrawdownPct < 25;

  const kpi = (label: string, value: string, sub = ''): string =>
    `<div class="kpi"><div class="kl">${label}</div><div class="kv">${value}</div>${sub ? `<div class="ks">${sub}</div>` : ''}</div>`;

  const positionsRows = s.positions
    .map((p) => {
      const pnl = p.entrySol > 0 ? (p.lastValueSol / p.entrySol - 1) * 100 : 0;
      const held = Math.round((i.nowMs - Date.parse(p.openedAt)) / 60_000);
      const armed = p.peakValueSol >= p.entrySol * (1 + i.cfg.exits.trailArmPct / 100);
      const next = [
        `stop à ${fr(p.entrySol * (1 - i.cfg.exits.stopLossPct / 100), 4)} SOL`,
        `objectif ${fr(p.entrySol * (1 + i.cfg.exits.takeProfitPct / 100), 4)} SOL`,
        armed ? `stop suiveur à ${fr(p.peakValueSol * (1 - i.cfg.exits.trailPct / 100), 4)} SOL` : '',
        `vente forcée dans ${Math.max(0, i.cfg.exits.maxHoldMinutes - held)} min`,
      ].filter(Boolean);
      return `<tr><td><b>${esc(p.symbol)}</b></td><td>${fr(p.entrySol, 4)}</td><td>${fr(p.lastValueSol, 4)}</td><td class="${pnl >= 0 ? 'good' : 'bad'}">${signed(pnl)} %</td><td>${held} min</td><td>${esc(next.join(' · '))}</td></tr>`;
    })
    .join('');

  const actionItems = actions
    .map(
      (a) =>
        `<li class="act ${a.tone}"><details><summary><span class="when">${esc(time(a.at))}</span><span class="tag">${esc(a.kind)}</span>${esc(a.title)}</summary>${
          a.details.length ? `<ul>${a.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''
        }</details></li>`,
    )
    .join('');

  const radarRows = (i.radar?.candidates ?? [])
    .map(
      (c) =>
        `<tr><td><b>${esc(c.symbol)}</b><div class="muted mono">${esc(c.mint.slice(0, 4))}…${esc(c.mint.slice(-4))}</div></td><td>${fr(c.score, 1)}</td><td>×${fr(c.spikeRatio, 1)}</td><td>${fr(c.liquidityUsd / 1000, 0)} k$</td><td><span class="dec">${esc(c.decision)}</span></td><td><details><summary>${esc(c.why[0] ?? c.signals[0] ?? '')}</summary><ul>${[...c.why, ...c.signals]
          .map((w) => `<li>${esc(w)}</li>`)
          .join('')}</ul></details></td></tr>`,
    )
    .join('');
  const topRejects = Object.entries(i.radar?.rejectedCounts ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => `${esc(k)} ${v}`)
    .join(' · ');

  const toolRows = tools.decisions
    .map(
      (t) =>
        `<tr><td>${esc(t.name)}</td><td>${t.costUsdMonth ? `${t.costUsdMonth} $/mois` : 'gratuit'}</td><td>${esc(t.benefit)}</td><td class="${t.decision === 'oui' ? 'good' : t.decision === 'non' ? 'bad' : 'warn'}"><b>${esc(t.decision)}</b></td><td>${esc(t.why)}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>solbot — tableau de bord</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#14171c;--muted:#667085;--line:#e4e7ec;--good:#0a7a4b;--bad:#b42318;--warn:#a15c07;--acc:#3b5bdb;--band:rgba(59,91,219,.16)}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a21;--fg:#e6e8ec;--muted:#98a2b3;--line:#2a2f3a;--good:#3ccf91;--bad:#f97066;--warn:#fdb022;--acc:#8ea2ff;--band:rgba(142,162,255,.18)}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1040px;margin:0 auto;padding:16px}h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:0 0 10px}
.muted{color:var(--muted)}.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}.good{color:var(--good)}.bad{color:var(--bad)}.warn{color:var(--warn)}
.banner{border-radius:10px;padding:10px 12px;margin:10px 0;background:var(--card);border:1px solid var(--line)}.paper{border-color:var(--acc)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:12px 0}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}.kpi{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px}
.kl{font-size:12px;color:var(--muted)}.kv{font-size:20px;font-weight:650}.ks{font-size:12px;color:var(--muted)}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;color:var(--muted);font-weight:600}
ul.acts{list-style:none;margin:0;padding:0}li.act{border-left:3px solid var(--line);padding:6px 10px;margin:4px 0}li.good{border-left-color:var(--good)}li.bad{border-left-color:var(--bad)}li.warn{border-left-color:var(--warn)}
summary{cursor:pointer}.when{color:var(--muted);font-size:12px;margin-right:8px}.tag{font-size:11px;font-weight:700;letter-spacing:.04em;margin-right:8px;padding:1px 6px;border-radius:6px;border:1px solid var(--line)}
details ul{margin:6px 0 2px 18px;padding:0}.dec{font-size:12px;padding:1px 6px;border:1px solid var(--line);border-radius:6px;white-space:nowrap}
svg{width:100%;height:auto;display:block}.band{fill:var(--band)}.median{fill:none;stroke:var(--acc);stroke-width:2}.ref{stroke:var(--muted);stroke-dasharray:4 4}.halt{stroke:var(--bad);stroke-dasharray:2 4}.ax{fill:var(--muted);font-size:11px}.haltx{fill:var(--bad)}
.verdict{font-size:15px;margin:0 0 10px}.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
footer{font-size:12px;color:var(--muted);margin:20px 0}
</style>
</head>
<body><main>
<h1>solbot — tableau de bord</h1>
<div class="muted">Mis à jour le ${esc(time(i.generatedAt))} (heure de Paris) · rafraîchi toutes les 60 s · si cette heure n'avance plus, le bot est arrêté.</div>
${i.mode === 'paper' ? '<div class="banner paper"><b>MODE PAPIER</b> — simulation sur de vrais prix, aucune transaction réelle.</div>' : '<div class="banner"><b>LIVE</b> — argent réel.</div>'}
${status.length ? `<div class="banner warn">${status.join('<br>')}</div>` : ''}

<section class="kpis">
${kpi('Equity', `${fr(equity, 3)} SOL`, `départ ${fr(s.initialEquitySol, 3)} SOL${usd ? ` · ≈ ${fr(equity * usd, 0)} $` : ''}`)}
${kpi('Rendement', `<span class="${ret >= 0 ? 'good' : 'bad'}">${signed(ret)} %</span>`, s.totalSweptSol > 0 ? `dont ${fr(s.totalSweptSol, 3)} SOL mis à l'abri` : 'gains au coffre au-delà de +20 %')}
${kpi('Trades fermés', `${i.stats.trades}`, `${i.stats.wins} gagnants · ${i.stats.losses} perdants`)}
${kpi('Réussite', `${fr(i.stats.winRatePct, 0)} %`, `seuil de rentabilité ≈ ${fr(proj.breakEvenWinRatePct, 0)} %`)}
${kpi('Espérance / trade', `${signed(i.stats.expectancyPct)} %`, `frais = ${fr(i.stats.feesPctOfVolume, 1)} % du volume`)}
${kpi('Drawdown max', `${fr(i.stats.maxDrawdownPct, 1)} %`, `arrêt automatique à −${i.cfg.guards.haltDrawdownPct} %`)}
</section>

<section class="card"><h2>Positions ouvertes (${s.positions.length})</h2>
${s.positions.length ? `<div class="scroll"><table><tr><th>Token</th><th>Entrée (SOL)</th><th>Valeur de vente</th><th>PnL</th><th>Depuis</th><th>Prochains déclencheurs</th></tr>${positionsRows}</table></div>` : '<p class="muted">Aucune position ouverte.</p>'}
</section>

<section class="card"><h2>Actions prises et pourquoi</h2>
<p class="muted">Clique sur une ligne pour voir la chaîne complète des raisons.</p>
${actions.length ? `<ul class="acts">${actionItems}</ul>` : '<p class="muted">Aucune action pour l’instant.</p>'}
</section>

<section class="card"><h2>Sur le radar (dernier scan${i.radar ? ` à ${esc(time(i.radar.at))}` : ''})</h2>
${
  i.radar
    ? `<p class="muted">${i.radar.examined} tokens examinés, ${i.radar.candidates.length} retenus par le scanner${topRejects ? ` · écartés : ${topRejects}` : ''}${
        i.radar.sourcesFailed.length ? ` · sources en panne : ${esc(i.radar.sourcesFailed.join(', '))}` : ''
      }</p>${
        radarRows
          ? `<div class="scroll"><table><tr><th>Token</th><th>Score</th><th>Pic</th><th>Liquidité</th><th>Décision</th><th>Pourquoi</th></tr>${radarRows}</table></div>`
          : '<p>Rien ne passe les filtres en ce moment : le bot attend. Ne rien faire est souvent la meilleure décision.</p>'
      }`
    : '<p class="muted">Pas encore de scan.</p>'
}
</section>

<section class="card"><h2>Prévision : ce que j'attends, et comment</h2>
<p class="verdict">${esc(proj.verdict)}</p>
${fanChart(proj, s.initialEquitySol, floor)}
<p class="muted">Zone bleue : 8 scénarios sur 10 sur les ${proj.horizon} prochains trades (simulation de 2 000 futurs ${
    proj.basis === 'observé' ? 'à partir des vrais trades' : 'à partir de l’hypothèse prudente'
  }) ; trait plein : scénario médian ; pointillés : capital de départ et arrêt automatique.</p>
<div class="grid2">
<div><h2>Les chiffres qui décident</h2><table>
<tr><td>Base</td><td><b>${esc(proj.basis)}</b> (${proj.sampleSize} trades)</td></tr>
<tr><td>Trades gagnants</td><td>${fr(proj.winRatePct, 0)} % — il en faut ≥ ${fr(proj.breakEvenWinRatePct, 0)} %</td></tr>
<tr><td>Gain moyen / perte moyenne</td><td>${signed(proj.avgWinPct)} % / −${fr(proj.avgLossPct, 1)} %</td></tr>
<tr><td>Coût d'un aller-retour</td><td>${fr(proj.costPct, 1)} %</td></tr>
<tr><td>Espérance par trade</td><td class="${proj.expectancyPct > 0 ? 'good' : 'bad'}">${signed(proj.expectancyPct)} %</td></tr>
<tr><td>Chance de finir en gain</td><td>${fr(proj.probProfitPct, 0)} %</td></tr>
<tr><td>Chance de déclencher l’arrêt</td><td>${fr(proj.probHaltPct, 0)} %</td></tr>
</table></div>
<div><h2>Comment le bot compte gagner</h2><ul>
<li>Il n'achète pas les nouveautés des premières minutes (perdu d'avance contre les robots du bloc de création) : il cherche des tokens qui ont <b>survécu</b> (30 min à 7 jours) et dont le volume s'emballe avec plus d'acheteurs que de vendeurs.</li>
<li>Il écarte tout token suspect avant d'acheter : autorités actives, détenteurs concentrés, aller-retour trop cher.</li>
<li>Il coupe vite (−${i.cfg.exits.stopLossPct} %), laisse courir les gagnants (objectif +${i.cfg.exits.takeProfitPct} %, stop suiveur ${i.cfg.exits.trailPct} % après +${i.cfg.exits.trailArmPct} %) et ne garde rien plus de ${i.cfg.exits.maxHoldMinutes} min.</li>
<li>Chaque position = ${i.cfg.sizer.positionPct} % de l'equity : après une série de pertes, il mise moins ; après des gains, un peu plus.</li>
<li>Étape suivante : ${phaseOk ? '<b class="good">critères remplis, passage à l’étape suivante possible</b>' : 'rester en papier jusqu’à 50 trades avec une espérance positive après frais et un drawdown < 25 %'}.</li>
</ul></div>
</div>
</section>

<section class="card"><h2>Courbe réelle</h2>${sparkline(i.points, s.initialEquitySol)}<p class="muted">Détail complet : equity.html (même dossier).</p></section>

<section class="card"><h2>Budget outils (payé uniquement sur les bénéfices)</h2>
<p>Règle : ${i.cfg.tools.budgetPct} % des bénéfices réalisés forment le budget outils. Un outil payant n'est pris que si 3 mois d'abonnement tiennent dans ce budget <b>et</b> s'il peut rapporter au moins 2 fois son prix ; il est d'abord testé en papier contre la version sans lui.</p>
<p>Bénéfice réalisé : <b>${fr(Math.max(0, i.stats.totalPnlSol), 4)} SOL</b>${inUsd(Math.max(0, i.stats.totalPnlSol))} · budget outils : <b>${fr(tools.budgetSol, 4)} SOL</b>${inUsd(tools.budgetSol)} · volume des 30 derniers jours : ${fr(tools.monthlyVolumeSol, 2)} SOL</p>
<div class="scroll"><table><tr><th>Outil</th><th>Prix</th><th>Apport</th><th>Décision</th><th>Pourquoi</th></tr>${toolRows}</table></div>
</section>

<footer>Généré par solbot à partir de ses propres fichiers (journal, trades, rejets, état). Rien ici n'est un conseil en investissement : le bot peut perdre tout son budget, et il est conçu pour ne jamais perdre plus.</footer>
</main></body></html>
`;
}

// ---------------------------------------------------------------------------
// Lecture des fichiers et écriture de la page
// ---------------------------------------------------------------------------

export function writeDashboard(dataDir: string, cfg: Pick<Config, 'mode' | 'sizer' | 'exits' | 'guards' | 'tools'>, clock: Clock): string {
  const state = readJson<BotState | null>(join(dataDir, 'state.json'), null);
  const path = join(dataDir, DASHBOARD_FILE);
  if (!state) return path;
  const tracker = createEquityTracker({ dataDir, clock, mode: state.mode, getState: () => state, patchState: () => {} });
  const { points, trades } = tracker.load();
  const stats = computeStats(trades, points, state.initialEquitySol);
  const now = clock.now();
  const events: JournalEvent[] = [];
  for (const day of [utcDate(now - 86_400_000), utcDate(now)]) {
    events.push(...readJsonlTail<JournalEvent>(join(dataDir, 'journal', `${day}.jsonl`)));
  }
  const rejects = readJsonlTail<RejectRecord>(join(dataDir, 'rejects.jsonl')).slice(-200);
  const radar = readJson<Radar | null>(join(dataDir, RADAR_FILE), null);
  const html = renderDashboard({
    mode: state.mode,
    generatedAt: clock.iso(),
    nowMs: now,
    state,
    cfg,
    trades,
    points,
    stats,
    events: events.slice(-500),
    rejects,
    radar,
    stopFile: existsSync(join(dataDir, 'STOP')),
  });
  writeTextAtomic(path, html);
  return path;
}
