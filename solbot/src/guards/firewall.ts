/**
 * Pare-feu de transactions : inspecte une transaction de swap AVANT de la signer.
 *
 * Pourquoi : la transaction arrive toute faite d'une API (Jupiter). Si cette API, une dépendance
 * ou une injection quelconque la remplace par « transférer tout le wallet ailleurs », signer
 * aveuglément suffit à tout perdre. Le bot ne signe que ce qu'il comprend :
 *
 *   1. notre clé est bien signataire, aucun programme n'est chargé dynamiquement ;
 *   2. chaque programme appelé est dans une liste blanche (Jupiter, Token, System…) ;
 *   3. instructions dangereuses refusées : réassigner le wallet, déléguer nos tokens
 *      (Approve), changer une autorité (SetAuthority), envoyer le loyer d'un compte fermé
 *      ailleurs que chez nous, transférer directement nos tokens hors d'un programme de swap ;
 *   4. le SOL qui sort du wallet par des instructions System ne dépasse pas le montant prévu ;
 *   5. les frais de priorité restent raisonnables (sinon un « bug » peut brûler le solde en frais) ;
 *   6. en live, une simulation RPC confirme l'effet réel sur le solde (checkSimulatedBalance).
 */

import {
  COMPUTE_BUDGET_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  parseTransaction,
  staticKeyAt,
} from '../lib/solanaTx.ts';
import type { ParsedTransaction } from '../lib/solanaTx.ts';

export interface FirewallContext {
  /** Adresse du wallet du bot. */
  owner: string;
  side: 'buy' | 'sell';
  /** SOL maximal (lamports) qui peut quitter le wallet via des instructions System de premier niveau. */
  maxSolOutLamports: bigint;
  /** Frais de priorité maximaux acceptés (lamports). */
  maxPriorityFeeLamports: bigint;
  allowedPrograms: Iterable<string>;
}

export interface FirewallVerdict {
  ok: boolean;
  reasons: string[];
  programs: string[];
  unknownPrograms: string[];
  /** SOL sortant via System (CreateAccount, Transfer…) depuis notre wallet. */
  solOutLamports: bigint;
  priorityFeeLamports: bigint;
  /** true si quelqu'un d'autre paie les frais (swap « gasless »). */
  gasless: boolean;
}

const MAX_COMPUTE_UNITS = 1_400_000n;
const DEFAULT_UNITS_PER_IX = 200_000n;

function readU32(data: Uint8Array, offset: number): number | null {
  if (data.length < offset + 4) return null;
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

function readU64(data: Uint8Array, offset: number): bigint | null {
  if (data.length < offset + 8) return null;
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}

export function inspectSwapTransaction(txBytes: Uint8Array, ctx: FirewallContext): FirewallVerdict {
  const reasons: string[] = [];
  const allowed = new Set(ctx.allowedPrograms);
  const verdict = (tx: ParsedTransaction | null, extra: Partial<FirewallVerdict> = {}): FirewallVerdict => ({
    ok: reasons.length === 0,
    reasons,
    programs: tx ? [...new Set(tx.instructions.map((ix) => staticKeyAt(tx, ix.programIdIndex) ?? '?'))] : [],
    unknownPrograms: [],
    solOutLamports: 0n,
    priorityFeeLamports: 0n,
    gasless: false,
    ...extra,
  });

  let tx: ParsedTransaction;
  try {
    tx = parseTransaction(txBytes);
  } catch (e) {
    reasons.push(`transaction illisible : ${e instanceof Error ? e.message : String(e)}`);
    return verdict(null);
  }

  const ownerIndex = tx.staticKeys.indexOf(ctx.owner);
  if (ownerIndex < 0 || ownerIndex >= tx.header.numRequiredSignatures) {
    reasons.push("notre wallet n'est pas signataire de cette transaction");
  }
  const gasless = ownerIndex > 0;
  const isOwner = (accIndex: number | undefined): boolean => accIndex !== undefined && accIndex === ownerIndex;

  const unknownPrograms = new Set<string>();
  let solOut = 0n;
  let cuLimit: bigint | null = null;
  let cuPriceMicroLamports = 0n;

  for (const [n, ix] of tx.instructions.entries()) {
    const programId = staticKeyAt(tx, ix.programIdIndex);
    if (programId === null) {
      reasons.push(`instruction ${n} : programme chargé depuis une table de correspondance (refusé)`);
      continue;
    }
    if (!allowed.has(programId)) {
      unknownPrograms.add(programId);
      continue;
    }
    const acc = ix.accountIndexes;

    if (programId === SYSTEM_PROGRAM_ID) {
      const kind = readU32(ix.data, 0);
      switch (kind) {
        case 0: {
          // CreateAccount : [financeur, nouveau compte] ; lamports en 4..12
          const lamports = readU64(ix.data, 4);
          if (lamports === null) reasons.push(`instruction ${n} : CreateAccount mal formé`);
          else if (isOwner(acc[0])) solOut += lamports;
          break;
        }
        case 2: {
          // Transfer : [source, destination] ; lamports en 4..12
          const lamports = readU64(ix.data, 4);
          if (lamports === null) reasons.push(`instruction ${n} : Transfer mal formé`);
          else if (isOwner(acc[0])) solOut += lamports;
          break;
        }
        case 3: {
          // CreateAccountWithSeed : u32 · base(32) · seed(u64 len + octets) · lamports · space · owner
          const seedLen = readU64(ix.data, 36);
          const lamports = seedLen === null || seedLen > 32n ? null : readU64(ix.data, 44 + Number(seedLen));
          if (lamports === null) reasons.push(`instruction ${n} : CreateAccountWithSeed mal formé`);
          else if (isOwner(acc[0])) solOut += lamports;
          break;
        }
        case 1:
        case 8:
        case 9:
        case 10:
          // Assign, Allocate, AllocateWithSeed, AssignWithSeed : jamais sur notre wallet
          if (isOwner(acc[0])) reasons.push(`instruction ${n} : tentative de réassigner/allouer notre wallet (System ${kind})`);
          break;
        default:
          reasons.push(`instruction ${n} : instruction System ${kind} inattendue dans un swap`);
      }
      continue;
    }

    if (programId === TOKEN_PROGRAM_ID || programId === TOKEN_2022_PROGRAM_ID) {
      const kind = ix.data[0];
      switch (kind) {
        case 3: // Transfer [source, dest, autorité]
          if (isOwner(acc[2])) reasons.push(`instruction ${n} : transfert direct de nos tokens hors programme de swap`);
          break;
        case 12: // TransferChecked [source, mint, dest, autorité]
          if (isOwner(acc[3])) reasons.push(`instruction ${n} : transfert direct de nos tokens hors programme de swap`);
          break;
        case 4: // Approve [source, délégué, propriétaire]
          if (isOwner(acc[2])) reasons.push(`instruction ${n} : délégation (Approve) de nos tokens à un tiers`);
          break;
        case 13: // ApproveChecked [source, mint, délégué, propriétaire]
          if (isOwner(acc[3])) reasons.push(`instruction ${n} : délégation (ApproveChecked) de nos tokens à un tiers`);
          break;
        case 6: // SetAuthority [compte, autorité actuelle]
          if (isOwner(acc[1])) reasons.push(`instruction ${n} : changement d'autorité (SetAuthority) sur un de nos comptes`);
          break;
        case 9: // CloseAccount [compte, destination, propriétaire]
          if (isOwner(acc[2]) && !isOwner(acc[1])) reasons.push(`instruction ${n} : fermeture d'un de nos comptes au profit d'un tiers`);
          break;
        default:
          break;
      }
      continue;
    }

    if (programId === COMPUTE_BUDGET_PROGRAM_ID) {
      const kind = ix.data[0];
      if (kind === 2) {
        const units = readU32(ix.data, 1);
        if (units !== null) cuLimit = BigInt(units);
      } else if (kind === 3) {
        const price = readU64(ix.data, 1);
        if (price !== null) cuPriceMicroLamports = price;
      }
    }
  }

  if (unknownPrograms.size > 0) {
    reasons.push(
      `programme(s) hors liste blanche : ${[...unknownPrograms].join(', ')} (vérifie sur solscan.io puis ajoute à ALLOWED_PROGRAMS si légitime)`,
    );
  }

  if (solOut > ctx.maxSolOutLamports) {
    reasons.push(`la transaction ferait sortir ${fmtSol(solOut)} SOL du wallet, plafond prévu ${fmtSol(ctx.maxSolOutLamports)} SOL`);
  }

  const units = cuLimit ?? minBig(DEFAULT_UNITS_PER_IX * BigInt(tx.instructions.length), MAX_COMPUTE_UNITS);
  const priorityFee = (units * cuPriceMicroLamports + 999_999n) / 1_000_000n;
  if (!gasless && priorityFee > ctx.maxPriorityFeeLamports) {
    reasons.push(`frais de priorité ${fmtSol(priorityFee)} SOL au-dessus du plafond ${fmtSol(ctx.maxPriorityFeeLamports)} SOL`);
  }

  return verdict(tx, {
    unknownPrograms: [...unknownPrograms],
    solOutLamports: solOut,
    priorityFeeLamports: priorityFee,
    gasless,
  });
}

export interface SimulatedBalanceCheck {
  side: 'buy' | 'sell';
  preLamports: number;
  postLamports: number | null;
  /** Achat : SOL maximal qui peut quitter le wallet (montant + frais + loyer). */
  maxSolOutLamports: number;
  /** Vente : SOL minimal à recevoir (net), typiquement le seuil du devis moins les frais. */
  minSolInLamports: number;
  simulationError: unknown;
}

/** Vérifie l'effet simulé sur le solde SOL ; renvoie la liste des problèmes (vide = OK). */
export function checkSimulatedBalance(c: SimulatedBalanceCheck): string[] {
  const problems: string[] = [];
  if (c.simulationError !== null && c.simulationError !== undefined) {
    problems.push(`la simulation échoue : ${JSON.stringify(c.simulationError)}`);
    return problems;
  }
  if (c.postLamports === null) {
    problems.push('simulation : solde du wallet introuvable après exécution');
    return problems;
  }
  const delta = c.postLamports - c.preLamports; // positif = SOL reçu
  if (c.side === 'buy' && -delta > c.maxSolOutLamports) {
    problems.push(`simulation : l'achat coûterait ${fmtSol(BigInt(-delta))} SOL, plafond ${fmtSol(BigInt(c.maxSolOutLamports))} SOL`);
  }
  if (c.side === 'sell' && delta < c.minSolInLamports) {
    problems.push(`simulation : la vente ne rapporterait que ${fmtSol(BigInt(delta))} SOL, minimum attendu ${fmtSol(BigInt(c.minSolInLamports))} SOL`);
  }
  return problems;
}

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function fmtSol(lamports: bigint): string {
  const neg = lamports < 0n;
  const abs = neg ? -lamports : lamports;
  const whole = abs / 1_000_000_000n;
  const frac = (abs % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}
