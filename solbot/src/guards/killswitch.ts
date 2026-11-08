/**
 * Garde-fous évalués à chaque tour de boucle, avant toute nouvelle entrée.
 * Fonction pure : renvoie une décision + les champs d'état à mettre à jour.
 *
 * Fichiers de commande (dans DATA_DIR) — utilisables depuis n'importe quel terminal ou à distance :
 *   STOP   → plus aucune entrée ; les positions ouvertes continuent d'être gérées et vendues.
 *   PANIC  → vend toutes les positions tout de suite, puis s'arrête.
 */

import type { Config } from '../config.ts';
import { utcDate } from '../lib/store.ts';
import type { BotState, EquitySnapshot, GuardDecision } from '../types.ts';

export interface GuardInput {
  state: BotState;
  equity: EquitySnapshot;
  nowMs: number;
  cfg: Config;
  stopFile: boolean;
  panicFile: boolean;
}

export interface GuardResult {
  decision: GuardDecision;
  patch: Partial<BotState>;
}

const HOUR_MS = 3_600_000;

export function evaluateGuards({ state, equity, nowMs, cfg, stopFile, panicFile }: GuardInput): GuardResult {
  const g = cfg.guards;
  const reasons: string[] = [];
  const patch: Partial<BotState> = {};
  let allowEntries = true;
  let halt = false;
  let panic = false;

  // Changement de jour (UTC) : on repart d'un compteur de pertes à zéro.
  const today = utcDate(nowMs);
  let day = state.day;
  if (day.date !== today) {
    day = { date: today, startEquitySol: equity.equitySol, realizedPnlSol: 0, trades: 0 };
    patch.day = day;
  }

  // Ouvertures de la dernière heure.
  const recentOpens = state.recentOpens.filter((iso) => nowMs - Date.parse(iso) < HOUR_MS);
  if (recentOpens.length !== state.recentOpens.length) patch.recentOpens = recentOpens;

  if (panicFile) {
    panic = true;
    halt = true;
    allowEntries = false;
    reasons.push('fichier PANIC présent : vente de toutes les positions puis arrêt');
  }

  if (state.halted) {
    halt = true;
    allowEntries = false;
    reasons.push(`arrêt durable depuis ${state.halted.at} : ${state.halted.reason} (supprime « halted » de state.json pour réarmer)`);
  } else if (equity.initialEquitySol > 0) {
    const lossPct = ((equity.initialEquitySol - equity.equitySol) / equity.initialEquitySol) * 100;
    if (lossPct >= g.haltDrawdownPct) {
      halt = true;
      allowEntries = false;
      const reason = `perte de ${lossPct.toFixed(1)} % depuis le départ (seuil ${g.haltDrawdownPct} %) : la stratégie ne marche pas, analyse avant de relancer`;
      patch.halted = { reason, at: new Date(nowMs).toISOString() };
      reasons.push(reason);
    }
  }

  if (stopFile) {
    allowEntries = false;
    reasons.push('fichier STOP présent : plus de nouvelles entrées (les sorties continuent)');
  }

  if (day.startEquitySol > 0) {
    const dayLossPct = (-day.realizedPnlSol / day.startEquitySol) * 100;
    if (dayLossPct >= g.dailyLossLimitPct) {
      allowEntries = false;
      reasons.push(`perte du jour ${dayLossPct.toFixed(1)} % ≥ ${g.dailyLossLimitPct} % : pause jusqu'à minuit UTC`);
    }
  }

  let pausedUntil = state.pausedUntil;
  if (state.consecutiveLosses >= g.maxConsecutiveLosses) {
    pausedUntil = new Date(nowMs + g.pauseAfterLossesMinutes * 60_000).toISOString();
    patch.pausedUntil = pausedUntil;
    patch.consecutiveLosses = 0;
    reasons.push(`${state.consecutiveLosses} pertes d'affilée : pause de ${g.pauseAfterLossesMinutes} min`);
  }
  if (pausedUntil && Date.parse(pausedUntil) > nowMs) {
    allowEntries = false;
    if (!patch.pausedUntil) reasons.push(`en pause jusqu'à ${pausedUntil}`);
  }

  if (recentOpens.length >= g.maxTradesPerHour) {
    allowEntries = false;
    reasons.push(`${recentOpens.length} entrées dans la dernière heure (max ${g.maxTradesPerHour})`);
  }

  if (state.positions.length >= cfg.sizer.maxOpenPositions) {
    allowEntries = false;
    reasons.push(`${state.positions.length} positions ouvertes (max ${cfg.sizer.maxOpenPositions})`);
  }

  if (cfg.mode === 'live' && equity.equitySol > g.maxWalletSol) {
    allowEntries = false;
    reasons.push(
      `le wallet vaut ${equity.equitySol.toFixed(3)} SOL, au-dessus de MAX_WALLET_SOL=${g.maxWalletSol} : ce n'est plus le petit budget prévu, retire l'excédent`,
    );
  }

  return { decision: { allowEntries, panic, halt, reasons }, patch };
}

/** État initial au tout premier démarrage. */
export function initialState(mode: BotState['mode'], initialEquitySol: number, nowMs: number): BotState {
  const iso = new Date(nowMs).toISOString();
  return {
    version: 1,
    mode,
    createdAt: iso,
    initialEquitySol,
    peakEquitySol: initialEquitySol,
    paperSol: mode === 'paper' ? initialEquitySol : 0,
    positions: [],
    cooldowns: {},
    day: { date: utcDate(nowMs), startEquitySol: initialEquitySol, realizedPnlSol: 0, trades: 0 },
    consecutiveLosses: 0,
    recentOpens: [],
    totalSweptSol: 0,
    closedTrades: 0,
  };
}
