/**
 * Petites transactions construites par le bot lui-même (pas par Jupiter) :
 *   - mise à l'abri des gains vers le coffre (VAULT_ADDRESS) ;
 *   - fermeture des comptes de tokens vides pour récupérer leur loyer (~0,002 SOL chacun).
 *
 * Chaque compte de token créé à l'achat immobilise ~0,00204 SOL de « loyer ». Sur 100 trades,
 * c'est ~0,2 SOL bloqué : récupérable en fermant les comptes vides (npm run reclaim).
 */

import type { Rpc } from './lib/rpc.ts';
import type { Signer } from './lib/keypair.ts';
import { compileLegacyTransaction, signTransaction, systemTransfer, tokenCloseAccount, toBase64, transactionId } from './lib/solanaTx.ts';
import type { Instruction } from './lib/solanaTx.ts';
import { isValidAddress } from './config.ts';

export interface SendOptions {
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Signe, envoie et attend la confirmation ; vérifie le statut avant de conclure à un échec. */
export async function sendSimpleTransaction(
  rpc: Rpc,
  signer: Signer,
  instructions: Instruction[],
  opts: SendOptions = {},
): Promise<{ signature: string; confirmed: boolean }> {
  const sleep = opts.sleep ?? defaultSleep;
  const { blockhash } = await rpc.getLatestBlockhash();
  const signed = signTransaction(compileLegacyTransaction(signer.publicKey, instructions, blockhash), signer);
  const signature = transactionId(signed);
  let sendError: unknown;
  try {
    await rpc.sendTransaction(toBase64(signed));
  } catch (e) {
    // Elle a peut-être quand même été transmise : on vérifie son statut avant de conclure.
    sendError = e;
  }
  const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
  while (Date.now() < deadline) {
    const st = await rpc.getSignatureStatus(signature).catch(() => null);
    if (st) {
      if (st.err) throw new Error(`transaction ${signature} échouée : ${JSON.stringify(st.err)}`);
      if (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized') return { signature, confirmed: true };
    } else if (sendError) {
      throw new Error(`envoi impossible : ${sendError instanceof Error ? sendError.message : String(sendError)}`);
    }
    await sleep(2_000);
  }
  return { signature, confirmed: false };
}

/** Vire `amountSol` vers le coffre. Refuse toute destination invalide ou égale au wallet du bot. */
export async function sweepToVault(rpc: Rpc, signer: Signer, vault: string, amountSol: number, opts: SendOptions = {}) {
  if (!isValidAddress(vault) || vault === signer.publicKey) throw new Error('adresse de coffre invalide');
  const lamports = BigInt(Math.floor(amountSol * 1e9));
  if (lamports <= 0n) throw new Error('montant de mise à l’abri nul');
  const balance = await rpc.getBalanceLamports(signer.publicKey);
  if (BigInt(balance) - lamports < 10_000_000n) throw new Error('solde insuffisant pour mettre à l’abri ce montant');
  return sendSimpleTransaction(rpc, signer, [systemTransfer(signer.publicKey, vault, lamports)], opts);
}

export interface ReclaimResult {
  emptyAccounts: string[];
  signatures: string[];
  /** Estimation : 2 039 280 lamports par compte standard. */
  estimatedLamports: number;
}

/** Ferme les comptes de tokens VIDES du wallet (par lots de 8). dryRun = liste sans rien envoyer. */
export async function reclaimRent(rpc: Rpc, signer: Signer, dryRun: boolean, opts: SendOptions = {}): Promise<ReclaimResult> {
  const balances = await rpc.getTokenBalances(signer.publicKey);
  const empty = balances.filter((b) => b.amountRaw === '0');
  const result: ReclaimResult = {
    emptyAccounts: empty.map((b) => b.account),
    signatures: [],
    estimatedLamports: empty.length * 2_039_280,
  };
  if (dryRun) return result;
  for (let i = 0; i < empty.length; i += 8) {
    const batch = empty.slice(i, i + 8);
    const ixs = batch.map((b) => tokenCloseAccount(b.account, signer.publicKey, signer.publicKey, b.programId));
    const { signature } = await sendSimpleTransaction(rpc, signer, ixs, opts);
    result.signatures.push(signature);
  }
  return result;
}
