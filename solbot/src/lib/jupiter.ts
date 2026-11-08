/**
 * Client Jupiter (https://api.jup.ag, clé « x-api-key » du portail https://developers.jup.ag).
 *
 *   Swap V2   GET  /swap/v2/order    devis (+ transaction à signer si `taker` est fourni)
 *             POST /swap/v2/execute  Jupiter fait atterrir la transaction signée
 *   Tokens V2 GET  /tokens/v2/{toptrending|toporganicscore|toptraded}/{5m|1h|6h|24h}, /recent, /search
 *   Price V3  GET  /price/v3?ids=…   (max 50 mints ; un mint absent = pas de prix fiable)
 *
 * Notes de la doc officielle (agent-skills jup-ag, nov. 2026) :
 *   - Ultra (/ultra/v1) n'est plus maintenu : Swap V2 le remplace (mêmes paramètres) ;
 *     /execute renvoie inputAmountResult / outputAmountResult (montants réels on-chain).
 *   - Frais Swap V2 : 0 à 10 bps selon la paire, 50 bps pour les tokens de moins de 24 h.
 *   - /execute accepte le même signedTransaction + requestId pendant ~2 min sans double exécution.
 *   - Limite de base : 50 requêtes / 10 s.
 * Les champs sont typés en optionnel : l'API évolue, le code appelant doit échouer fermé.
 */

import type { Http } from './http.ts';

export interface JupiterOrder {
  requestId: string;
  /** Base64 de la transaction à signer ; null/vide sans `taker` ou si le solde est insuffisant. */
  transaction: string | null;
  inputMint?: string;
  outputMint?: string;
  inAmount?: string;
  outAmount?: string;
  otherAmountThreshold?: string;
  slippageBps?: number;
  priceImpactPct?: string | number;
  priceImpact?: number;
  feeBps?: number;
  feeMint?: string;
  router?: string;
  mode?: string;
  swapType?: string;
  gasless?: boolean;
  prioritizationFeeLamports?: number;
  signatureFeeLamports?: number;
  rentFeeLamports?: number;
  routePlan?: Array<{ swapInfo?: { label?: string; ammKey?: string }; percent?: number }>;
  error?: string;
  errorCode?: number;
  errorMessage?: string;
}

export interface JupiterExecuteResult {
  status: string;
  code: number;
  signature?: string;
  slot?: string | number;
  error?: string;
  inputAmountResult?: string;
  outputAmountResult?: string;
  totalInputAmount?: string;
  totalOutputAmount?: string;
}

export interface JupiterTokenStats {
  priceChange?: number;
  holderChange?: number;
  liquidityChange?: number;
  volumeChange?: number;
  buyVolume?: number;
  sellVolume?: number;
  buyOrganicVolume?: number;
  sellOrganicVolume?: number;
  numBuys?: number;
  numSells?: number;
  numTraders?: number;
  numOrganicBuyers?: number;
  numNetBuyers?: number;
}

export interface JupiterToken {
  id: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  tokenProgram?: string;
  usdPrice?: number;
  liquidity?: number;
  mcap?: number;
  fdv?: number;
  holderCount?: number;
  organicScore?: number;
  organicScoreLabel?: string;
  isVerified?: boolean | null;
  tags?: string[];
  launchpad?: string;
  firstPool?: { id?: string; createdAt?: string };
  audit?: {
    isSus?: boolean;
    mintAuthorityDisabled?: boolean | null;
    freezeAuthorityDisabled?: boolean | null;
    topHoldersPercentage?: number | null;
    devBalancePercentage?: number | null;
    devMigrations?: number | null;
    devMints?: number | null;
  };
  stats5m?: JupiterTokenStats;
  stats1h?: JupiterTokenStats;
  stats6h?: JupiterTokenStats;
  stats24h?: JupiterTokenStats;
}

export interface JupiterPrice {
  usdPrice: number;
  blockId?: number;
  decimals?: number;
  priceChange24h?: number;
  liquidity?: number;
}

export type TokenCategory = 'toptrending' | 'toporganicscore' | 'toptraded';
export type TokenInterval = '5m' | '1h' | '6h' | '24h';

export interface OrderParams {
  inputMint: string;
  outputMint: string;
  /** Montant brut (lamports si SOL), en chaîne. */
  amount: string;
  /** Adresse du wallet qui signera ; absent = simple devis (transaction null). */
  taker?: string;
}

export interface JupiterClient {
  order(p: OrderParams): Promise<JupiterOrder>;
  execute(signedTransactionBase64: string, requestId: string): Promise<JupiterExecuteResult>;
  tokensByCategory(category: TokenCategory, interval: TokenInterval, limit?: number): Promise<JupiterToken[]>;
  tokensRecent(): Promise<JupiterToken[]>;
  /** Jusqu'à 100 mints par appel. */
  tokensSearch(mints: string[]): Promise<JupiterToken[]>;
  /** Jusqu'à 50 mints par appel ; les mints sans prix fiable sont absents du résultat. */
  prices(mints: string[]): Promise<Record<string, JupiterPrice>>;
}

export interface JupiterDeps {
  http: Http;
  baseUrl: string;
  apiKey: string;
}

export function createJupiterClient({ http, baseUrl, apiKey }: JupiterDeps): JupiterClient {
  const headers = { 'x-api-key': apiKey };
  const asArray = (v: unknown): JupiterToken[] => (Array.isArray(v) ? (v as JupiterToken[]) : []);

  return {
    async order(p) {
      const q = new URLSearchParams({ inputMint: p.inputMint, outputMint: p.outputMint, amount: p.amount });
      if (p.taker) q.set('taker', p.taker);
      // Devis : 5 s max (recommandation Jupiter).
      return http.getJson<JupiterOrder>(`${baseUrl}/swap/v2/order?${q}`, { headers, timeoutMs: 5_000 });
    },
    async execute(signedTransaction, requestId) {
      // Jamais de nouvelle tentative automatique ici : l'exécuteur gère l'idempotence (même payload).
      return http.postJson<JupiterExecuteResult>(
        `${baseUrl}/swap/v2/execute`,
        { signedTransaction, requestId },
        { headers, retries: 0, timeoutMs: 30_000 },
      );
    },
    async tokensByCategory(category, interval, limit = 50) {
      return asArray(await http.getJson(`${baseUrl}/tokens/v2/${category}/${interval}?limit=${limit}`, { headers }));
    },
    async tokensRecent() {
      return asArray(await http.getJson(`${baseUrl}/tokens/v2/recent`, { headers }));
    },
    async tokensSearch(mints) {
      if (mints.length === 0) return [];
      if (mints.length > 100) throw new Error('tokensSearch : 100 mints maximum par appel');
      return asArray(await http.getJson(`${baseUrl}/tokens/v2/search?query=${encodeURIComponent(mints.join(','))}`, { headers }));
    },
    async prices(mints) {
      if (mints.length === 0) return {};
      if (mints.length > 50) throw new Error('prices : 50 mints maximum par appel');
      const r = await http.getJson<Record<string, JupiterPrice> | null>(
        `${baseUrl}/price/v3?ids=${encodeURIComponent(mints.join(','))}`,
        { headers },
      );
      return r && typeof r === 'object' ? r : {};
    },
  };
}
