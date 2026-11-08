/**
 * Appels JSON-RPC Solana strictement nécessaires (fetch natif, aucune dépendance).
 * Obligatoire en live : solde réel, simulation avant signature, réconciliation au démarrage.
 * Un RPC gratuit (Helius, QuickNode…) suffit ; le RPC public de Solana limite trop vite.
 */

import type { Http } from './http.ts';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from './solanaTx.ts';

export interface TokenBalance {
  /** Adresse du compte de token. */
  account: string;
  mint: string;
  amountRaw: string;
  decimals: number;
  programId: string;
}

export interface SimulationResult {
  err: unknown;
  logs: string[];
  /** Lamports des comptes demandés APRÈS simulation (null si le compte n'existe pas). */
  postLamports: Array<number | null>;
  unitsConsumed?: number;
}

export interface SignatureStatus {
  confirmationStatus?: 'processed' | 'confirmed' | 'finalized' | string;
  err: unknown;
  slot?: number;
}

export interface Rpc {
  getBalanceLamports(address: string): Promise<number>;
  getTokenBalances(owner: string): Promise<TokenBalance[]>;
  getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  sendTransaction(base64: string): Promise<string>;
  getSignatureStatus(signature: string): Promise<SignatureStatus | null>;
  /** Simulation sans vérification de signature, blockhash remplacé : sert au pare-feu. */
  simulate(base64: string, accounts: string[]): Promise<SimulationResult>;
}

export class RpcError extends Error {
  override name = 'RpcError';
  readonly code: number | undefined;
  constructor(message: string, code?: number) {
    super(message);
    this.code = code;
  }
}

export function createRpc({ http, url }: { http: Http; url: string }): Rpc {
  let id = 0;
  async function call<T>(method: string, params: unknown[], retries?: number): Promise<T> {
    const res = await http.postJson<{ result?: T; error?: { code: number; message: string } }>(
      url,
      { jsonrpc: '2.0', id: ++id, method, params },
      retries === undefined ? {} : { retries },
    );
    if (res && typeof res === 'object' && res.error) throw new RpcError(`${method} : ${res.error.message}`, res.error.code);
    if (!res || typeof res !== 'object' || !('result' in res)) throw new RpcError(`${method} : réponse inattendue`);
    return res.result as T;
  }

  async function tokenAccounts(owner: string, programId: string): Promise<TokenBalance[]> {
    type Parsed = {
      value: Array<{
        pubkey: string;
        account: { data: { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string; decimals?: number } } } } };
      }>;
    };
    const r = await call<Parsed>('getTokenAccountsByOwner', [owner, { programId }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    const out: TokenBalance[] = [];
    for (const v of r.value ?? []) {
      const info = v.account?.data?.parsed?.info;
      if (!info?.mint || info.tokenAmount?.amount === undefined) continue;
      out.push({
        account: v.pubkey,
        mint: info.mint,
        amountRaw: info.tokenAmount.amount,
        decimals: info.tokenAmount.decimals ?? 0,
        programId,
      });
    }
    return out;
  }

  return {
    async getBalanceLamports(address) {
      const r = await call<{ value: number }>('getBalance', [address, { commitment: 'confirmed' }]);
      return r.value;
    },
    async getTokenBalances(owner) {
      const [a, b] = await Promise.all([tokenAccounts(owner, TOKEN_PROGRAM_ID), tokenAccounts(owner, TOKEN_2022_PROGRAM_ID)]);
      return [...a, ...b];
    },
    async getLatestBlockhash() {
      const r = await call<{ value: { blockhash: string; lastValidBlockHeight: number } }>('getLatestBlockhash', [
        { commitment: 'confirmed' },
      ]);
      return r.value;
    },
    async sendTransaction(base64) {
      // Pas de nouvelle tentative HTTP : renvoyer la même transaction est sans danger, mais c'est
      // l'appelant qui décide (il connaît la signature et vérifie le statut avant de rejouer).
      return call<string>('sendTransaction', [base64, { encoding: 'base64', skipPreflight: false, maxRetries: 3 }], 0);
    },
    async getSignatureStatus(signature) {
      const r = await call<{ value: Array<SignatureStatus | null> }>('getSignatureStatuses', [
        [signature],
        { searchTransactionHistory: true },
      ]);
      return r.value?.[0] ?? null;
    },
    async simulate(base64, accounts) {
      type Sim = {
        value: { err: unknown; logs?: string[] | null; accounts?: Array<{ lamports: number } | null> | null; unitsConsumed?: number };
      };
      const r = await call<Sim>('simulateTransaction', [
        base64,
        {
          encoding: 'base64',
          sigVerify: false,
          replaceRecentBlockhash: true,
          commitment: 'processed',
          accounts: { encoding: 'base64', addresses: accounts },
        },
      ]);
      return {
        err: r.value.err,
        logs: r.value.logs ?? [],
        postLamports: (r.value.accounts ?? []).map((a) => (a ? a.lamports : null)),
        unitsConsumed: r.value.unitsConsumed,
      };
    },
  };
}
