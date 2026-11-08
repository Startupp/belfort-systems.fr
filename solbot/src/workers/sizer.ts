/**
 * Sizer : fixe la taille d'une nouvelle position à partir de l'equity, jamais un ticket fixe.
 *
 * Base « anti-martingale » : un pourcentage de l'equity en valeur de LIQUIDATION (SOL libre + ce que
 * rapporterait la vente des positions ouvertes maintenant). Après des pertes l'equity baisse, donc la
 * taille aussi ; après des gains elle remonte. On ne mise jamais plus gros pour « se refaire ».
 *
 * Ensuite, des plafonds qui ne peuvent que RÉDUIRE la taille, appliqués dans cet ordre :
 *   DRAWDOWN_HALF  drawdown depuis le plus haut ≥ seuil → taille divisée par 2 ;
 *   MAX_POSITION   taille maximale d'une position ;
 *   EXPOSURE       part maximale de l'equity engagée dans l'ensemble des positions ;
 *   POOL_SHARE     part maximale de la liquidité du pool (notre propre impact de prix) ;
 *   FREE_SOL       SOL réellement disponible, hors réserve pour les frais.
 * Sous le minimum, on n'entre pas : les frais fixes mangeraient le gain.
 *
 * Échoue fermé : une entrée invalide (NaN, infini, négatif, absente) donne ok:false avec la raison,
 * jamais une taille qu'on ne saurait justifier. Fonction pure (ni horloge, ni réseau, ni état), qui
 * ne lève jamais d'exception.
 */

import { HARD_LIMITS } from '../config.ts';
import type { SizerConfig } from '../config.ts';
import { LAMPORTS_PER_SOL } from '../types.ts';
import type { EquitySnapshot, Position, SizeDecision, TokenCandidate } from '../types.ts';

/** Codes des plafonds, dans l'ordre où ils s'appliquent. */
export type SizeCap = 'DRAWDOWN_HALF' | 'MAX_POSITION' | 'EXPOSURE' | 'POOL_SHARE' | 'FREE_SOL';

export interface SizeInput {
  equity: EquitySnapshot;
  /** Positions ouvertes : leur lastValueSol mesure l'exposition actuelle. */
  openPositions: Position[];
  candidate: TokenCandidate;
  /** Prix du SOL en dollars : convertit la liquidité du pool (en $) en SOL. */
  solUsd: number;
  cfg: SizerConfig;
}

/** Champs de l'equity qui doivent être des nombres finis ≥ 0 (returnPct peut être négatif). */
const EQUITY_FIELDS = [
  'freeSol',
  'positionsValueSol',
  'equitySol',
  'peakEquitySol',
  'initialEquitySol',
  'drawdownPct',
] as const satisfies readonly (keyof EquitySnapshot)[];

const CONFIG_FIELDS = [
  'positionPct',
  'minPositionSol',
  'maxPositionSol',
  'maxOpenPositions',
  'maxExposurePct',
  'maxPoolSharePct',
  'feeReserveSol',
  'drawdownHalveAtPct',
] as const satisfies readonly (keyof SizerConfig)[];

/**
 * Taille de la prochaine position. ok:false (sizeSol 0, lamports 0) dès qu'une règle refuse ;
 * capsApplied liste alors les plafonds déjà appliqués avant le refus (vide si le refus précède le
 * calcul de la taille).
 */
export function sizePosition(i: SizeInput): SizeDecision {
  try {
    return computeSize(i);
  } catch (err) {
    // Filet ultime : une entrée malformée (ex. state.json corrompu) ne doit ni faire planter la
    // boucle ni produire une taille. On refuse, avec la cause.
    const cause = err instanceof Error ? err.message : String(err);
    return skip(`calcul de taille impossible (${cause}) : pas d'entrée`);
  }
}

function computeSize({ equity, openPositions, candidate, solUsd, cfg }: SizeInput): SizeDecision {
  // 1. Validation des entrées : un seul NaN, infini ou négatif et on refuse, avec le champ fautif.
  //    Un NaN traverse tous les calculs sans bruit et toutes ses comparaisons sont fausses : il
  //    pourrait désactiver un plafond en silence.
  for (const k of EQUITY_FIELDS) {
    if (!isNonNegative(equity[k])) {
      return skip(`equity invalide : ${k} = ${describe(equity[k])} (attendu un nombre fini ≥ 0)`);
    }
  }
  if (!isFiniteNumber(equity.returnPct)) {
    return skip(`equity invalide : returnPct = ${describe(equity.returnPct)} (attendu un nombre fini)`);
  }
  if (!isFiniteNumber(solUsd) || !(solUsd > 0)) {
    return skip(`prix du SOL inconnu (solUsd = ${describe(solUsd)}) : impossible de convertir la liquidité du pool en SOL`);
  }
  if (typeof candidate.mint !== 'string' || candidate.mint === '') {
    return skip('mint du candidat absent : impossible de vérifier les positions déjà ouvertes');
  }
  if (!isFiniteNumber(candidate.liquidityUsd) || !(candidate.liquidityUsd > 0)) {
    return skip(
      `liquidité du pool inconnue ou nulle (liquidityUsd = ${describe(candidate.liquidityUsd)}) : impossible de borner notre part du pool`,
    );
  }
  if (!Array.isArray(openPositions)) {
    return skip('liste des positions ouvertes illisible : exposition inconnue');
  }
  for (const p of openPositions) {
    if (!isNonNegative(p.lastValueSol)) {
      return skip(
        `valeur de la position ${p.symbol} inconnue (lastValueSol = ${describe(p.lastValueSol)}) : exposition impossible à calculer`,
      );
    }
  }
  for (const k of CONFIG_FIELDS) {
    if (!isNonNegative(cfg[k])) {
      return skip(`configuration du sizer invalide : ${k} = ${describe(cfg[k])} (attendu un nombre fini ≥ 0)`);
    }
  }

  // Plafonds effectifs : jamais au-delà des plafonds en dur. loadConfig le garantit déjà ; on le
  // répète ici pour qu'une SizerConfig construite à la main ne puisse pas les contourner.
  const maxPositionSol = Math.min(cfg.maxPositionSol, HARD_LIMITS.maxPositionSol);
  const maxOpenPositions = Math.min(cfg.maxOpenPositions, HARD_LIMITS.maxOpenPositions);
  const maxExposurePct = Math.min(cfg.maxExposurePct, HARD_LIMITS.maxExposurePct);
  const maxPoolSharePct = Math.min(cfg.maxPoolSharePct, HARD_LIMITS.maxPoolSharePct);

  // 2. Une seule position par token (on compare le mint, pas le symbole : les copies reprennent
  //    souvent le symbole) ; puis nombre maximal de positions simultanées.
  if (openPositions.some((p) => p.mint === candidate.mint)) {
    return skip(
      `déjà une position ouverte sur ${candidate.symbol} (${shortMint(candidate.mint)}) : pas de seconde entrée sur le même token`,
    );
  }
  const n = openPositions.length;
  if (n >= maxOpenPositions) {
    const s = n > 1 ? 's' : '';
    return skip(`${n} position${s} ouverte${s} ≥ maximum ${maxOpenPositions} : pas de nouvelle entrée`);
  }

  // 3. Base = positionPct % de l'equity. L'equity est la valeur de LIQUIDATION (SOL libre + ce que
  //    rapporteraient les positions ouvertes) : la taille rétrécit après des pertes et grandit après
  //    des gains (anti-martingale). Le texte de chaque étape alimente la raison finale.
  const base = (equity.equitySol * cfg.positionPct) / 100;
  const steps = [`${pct(cfg.positionPct)} % de l'equity ${sol(equity.equitySol)} = ${sol(base)}`];
  // Comparaisons écrites « !(x > 0) » plutôt que « x <= 0 » : un NaN fait échouer le test et mène
  // au refus au lieu de laisser passer.
  if (!(base > 0)) return skip(`${steps.join(' ; ')} : rien à engager`);
  const caps: SizeCap[] = [];
  let size = base;

  // 4. En drawdown profond (depuis le plus haut), on divise la taille par 2 : la stratégie traverse
  //    peut-être une mauvaise passe, on réduit la voilure avant que les garde-fous n'arrêtent tout.
  if (equity.drawdownPct >= cfg.drawdownHalveAtPct) {
    size /= 2;
    caps.push('DRAWDOWN_HALF');
    steps.push(
      `drawdown ${equity.drawdownPct.toFixed(1)} % ≥ ${pct(cfg.drawdownHalveAtPct)} % : taille divisée par 2 = ${sol(size)}`,
    );
  }

  // 5. Taille maximale d'une position, quelle que soit l'equity.
  if (size > maxPositionSol) {
    size = maxPositionSol;
    caps.push('MAX_POSITION');
    steps.push(`plafond par position = ${sol(maxPositionSol)}`);
  }

  // 6. Exposition totale : la somme des valeurs des positions ouvertes, plus la nouvelle, ne doit
  //    pas dépasser maxExposurePct % de l'equity. Plus de place → pas d'entrée.
  const exposure = openPositions.reduce((sum, p) => sum + p.lastValueSol, 0);
  const exposureCap = (equity.equitySol * maxExposurePct) / 100;
  const room = exposureCap - exposure;
  if (!(room > 0)) {
    return skip(
      `exposition ${sol(exposure)} ≥ plafond ${sol(exposureCap)} (${pct(maxExposurePct)} % de l'equity ${sol(equity.equitySol)}) : plus de place pour une nouvelle position`,
      caps,
    );
  }
  if (size > room) {
    size = room;
    caps.push('EXPOSURE');
    steps.push(
      `plafond d'exposition (${pct(maxExposurePct)} % de l'equity ${sol(equity.equitySol)} − ${sol(exposure)} déjà engagés) = ${sol(room)}`,
    );
  }

  // 7. Part du pool : notre ordre doit rester une infime fraction de la liquidité, sinon notre propre
  //    impact de prix (à l'achat puis à la vente) mange l'avantage. Seul plafond qui dépend du
  //    marché : il figure toujours dans la raison, même quand il ne réduit pas la taille.
  const maxByPool = (candidate.liquidityUsd * maxPoolSharePct) / 100 / solUsd;
  steps.push(`plafond liquidité (${pct(maxPoolSharePct)} % de ${usd(candidate.liquidityUsd)}) = ${sol(maxByPool)}`);
  if (!(size <= maxByPool)) {
    size = maxByPool;
    caps.push('POOL_SHARE');
  }

  // 8. SOL réellement disponible : la réserve paie les frais réseau et le loyer des comptes de tokens,
  //    elle n'est jamais engagée. Avec des données cohérentes le plafond d'exposition est plus strict ;
  //    celui-ci protège quand le solde réel s'écarte de l'equity (SOL en transit, frais déjà payés…).
  const available = equity.freeSol - cfg.feeReserveSol;
  if (!(available > 0)) {
    return skip(
      `SOL libre ${sol(equity.freeSol)} ≤ réserve ${sol(cfg.feeReserveSol)} (frais réseau, loyer des comptes de tokens) : rien à engager`,
      caps,
    );
  }
  if (size > available) {
    size = available;
    caps.push('FREE_SOL');
    steps.push(`plafond SOL libre (${sol(equity.freeSol)} − réserve ${sol(cfg.feeReserveSol)}) = ${sol(available)}`);
  }

  // 9. Taille minimale : en dessous, les frais fixes (réseau, loyer du compte de token) pèsent trop
  //    lourd par rapport au gain espéré.
  const trail = steps.join(' ; ');
  if (!(size >= cfg.minPositionSol)) return skip(`${trail} ; ${belowMinimum(size, cfg.minPositionSol)}`, caps);

  // 10. Conversion en lamports, arrondie vers le BAS : on n'engage jamais plus que la taille justifiée.
  //     Filet : l'arrondi ne doit ni donner 0 lamport ni repasser sous le minimum (cas d'un minimum
  //     qui ne tombe pas sur un lamport entier).
  const lamports = Math.floor(size * LAMPORTS_PER_SOL);
  const sizeSol = lamports / LAMPORTS_PER_SOL;
  if (!Number.isSafeInteger(lamports) || lamports < 1) {
    return skip(`${trail} ; taille arrondie à 0 lamport : rien à engager`, caps);
  }
  if (sizeSol < cfg.minPositionSol) return skip(`${trail} ; ${belowMinimum(sizeSol, cfg.minPositionSol)}`, caps);

  return { ok: true, sizeSol, lamports, reason: `${trail} ; taille retenue ${sol(sizeSol)}`, capsApplied: caps };
}

function skip(reason: string, capsApplied: readonly SizeCap[] = []): SizeDecision {
  return { ok: false, sizeSol: 0, lamports: 0, reason, capsApplied: [...capsApplied] };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonNegative(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0;
}

/** Valeur fautive lisible : un nombre tel quel, un texte entre guillemets (« "150" » n'est pas un nombre). */
function describe(v: unknown): string {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  return v === null ? 'null' : typeof v;
}

// Formats des raisons : point décimal (grep), 3 décimales pour les SOL.

function sol(v: number): string {
  return `${v.toFixed(3)} SOL`;
}

/** Pourcentage de configuration sans zéros inutiles : 4 → « 4 », 2.5 → « 2.5 ». */
function pct(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function usd(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)} M$`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)} k$`;
  return `${v.toFixed(0)} $`;
}

function shortMint(mint: string): string {
  return mint.length > 12 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}

/**
 * « 0.031 SOL < minimum 0.050 SOL : … ». Si l'arrondi à 3 décimales rendait les deux nombres
 * identiques (« 0.050 SOL < minimum 0.050 SOL »), on affiche la précision du lamport.
 */
function belowMinimum(size: number, min: number): string {
  let a = size.toFixed(3);
  let b = min.toFixed(3);
  if (a === b) {
    a = size.toFixed(9);
    b = min.toFixed(9);
  }
  return `${a} SOL < minimum ${b} SOL : les frais fixes (réseau, loyer du compte ~0.002 SOL) mangeraient le gain`;
}
