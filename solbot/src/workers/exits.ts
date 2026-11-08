/**
 * Règles de sortie : fonction PURE (aucun appel réseau, aucune mutation de la position).
 *
 * Ordre de priorité, la première règle qui se déclenche l'emporte :
 *   a. position non évaluable (ni devis ni prix) : seule la durée maximale peut déclencher ;
 *      on ne sait pas ce qu'elle vaut, mais on ne la garde pas indéfiniment ;
 *   b. STOP_LOSS        perte ≥ stopLossPct depuis l'entrée ;
 *   c. LIQUIDITY_DRAIN  liquidité de la paire en baisse ≥ liquidityDrainPct depuis l'entrée
 *                       (souvent le début d'un rug : on sort avant qu'il n'y ait plus de route) ;
 *   d. TAKE_PROFIT      gain ≥ takeProfitPct ;
 *   e. TRAILING_STOP    armé dès que le plus haut a gagné trailArmPct sur l'entrée, déclenché
 *                       quand la valeur recule de trailPct depuis ce plus haut ;
 *   f. TIME_STOP        détenue depuis maxHoldMinutes ou plus.
 *
 * Pourcentages en points (12.5 = 12,5 %). Les seuils sont inclusifs ; une tolérance minuscule
 * absorbe les arrondis binaires (0.08 / 0.1 − 1 ne vaut pas exactement −0.2 en flottant).
 */

import type { ExitConfig } from '../config.ts';
import type { ExitDecision, ExitReason, Position, PositionMark } from '../types.ts';

/** Tolérance sur les seuils, en points de pourcentage (ou en minutes pour la durée). */
const EPS = 1e-9;
const MINUS = '−';
const MINUTE_MS = 60_000;

export function decideExit(p: Position, mark: PositionMark, nowMs: number, cfg: ExitConfig): ExitDecision {
  if (!Number.isFinite(nowMs)) throw new Error(`decideExit : horodatage invalide (${String(nowMs)})`);
  // NaN si la date d'ouverture est illisible : traité plus bas comme « durée dépassée » (prudence).
  const heldMinutes = (nowMs - Date.parse(p.openedAt)) / MINUTE_MS;

  const priced =
    mark.ok &&
    mark.source !== 'none' &&
    Number.isFinite(mark.valueSol) &&
    mark.valueSol >= 0 &&
    Number.isFinite(p.entrySol) &&
    p.entrySol > 0;

  // a. Impossible d'évaluer la position : seule la limite de durée s'applique.
  if (!priced) {
    const unknown = mark.error ? `valeur inconnue (${mark.error})` : 'valeur inconnue';
    return timeStop(p, heldMinutes, cfg, unknown) ?? noExit();
  }

  const value = mark.valueSol;
  const pnlPct = (value / p.entrySol - 1) * 100;

  // b. Stop-loss.
  if (pnlPct <= -cfg.stopLossPct + EPS) {
    return exit('STOP_LOSS', `${signed(pnlPct)} % depuis l'entrée (stop à ${signed(-cfg.stopLossPct, 2)} %)`);
  }

  // c. Liquidité de la paire qui fond.
  const liq = mark.liquidityUsd;
  const entryLiq = p.entryLiquidityUsd;
  if (typeof liq === 'number' && Number.isFinite(liq) && liq >= 0 && Number.isFinite(entryLiq) && entryLiq > 0) {
    const dropPct = (1 - liq / entryLiq) * 100;
    if (dropPct >= cfg.liquidityDrainPct - EPS) {
      return exit(
        'LIQUIDITY_DRAIN',
        `liquidité en baisse de ${num(dropPct)} % depuis l'entrée (${usd(entryLiq)} $ → ${usd(liq)} $, seuil ${num(cfg.liquidityDrainPct, 2)} %)`,
      );
    }
  }

  // d. Objectif de gain atteint.
  if (pnlPct >= cfg.takeProfitPct - EPS) {
    return exit('TAKE_PROFIT', `${signed(pnlPct)} % depuis l'entrée (objectif ${signed(cfg.takeProfitPct, 2)} %)`);
  }

  // e. Stop suiveur : le plus haut inclut la valeur qu'on vient de mesurer.
  const peak = Math.max(Number.isFinite(p.peakValueSol) ? p.peakValueSol : 0, value);
  if (peak > 0) {
    const peakGainPct = (peak / p.entrySol - 1) * 100;
    const retreatPct = (1 - value / peak) * 100;
    if (peakGainPct >= cfg.trailArmPct - EPS && retreatPct >= cfg.trailPct - EPS) {
      return exit(
        'TRAILING_STOP',
        `recul de ${num(retreatPct)} % depuis le plus haut ${num(peak, 4)} SOL (stop suiveur ${num(cfg.trailPct, 2)} %)`,
      );
    }
  }

  // f. Durée maximale de détention.
  return timeStop(p, heldMinutes, cfg, `${signed(pnlPct)} % depuis l'entrée`) ?? noExit();
}

function timeStop(p: Position, heldMinutes: number, cfg: ExitConfig, context: string): ExitDecision | null {
  if (!Number.isFinite(heldMinutes)) {
    // État corrompu : on ne sait pas depuis quand on détient la position, on ne la garde pas.
    return exit('TIME_STOP', `date d'ouverture illisible (« ${String(p.openedAt)} ») : sortie par prudence, ${context}`);
  }
  if (heldMinutes >= cfg.maxHoldMinutes - EPS) {
    return exit('TIME_STOP', `détenue depuis ${num(heldMinutes)} min (maximum ${num(cfg.maxHoldMinutes, 2)} min), ${context}`);
  }
  return null;
}

function exit(reason: ExitReason, detail: string): ExitDecision {
  return { exit: true, reason, detail };
}

function noExit(): ExitDecision {
  return { exit: false };
}

/** Nombre avec au plus `decimals` décimales, point décimal, sans zéros inutiles, signe moins typographique. */
function num(n: number, decimals = 1): string {
  if (!Number.isFinite(n)) return String(n);
  let s = Math.abs(n).toFixed(decimals);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '0') return '0';
  return n < 0 ? `${MINUS}${s}` : s;
}

/** Comme num(), avec un « + » explicite pour les valeurs positives. */
function signed(n: number, decimals = 1): string {
  const s = num(n, decimals);
  return n > 0 && s !== '0' ? `+${s}` : s;
}

function usd(n: number): string {
  return String(Math.round(n));
}
