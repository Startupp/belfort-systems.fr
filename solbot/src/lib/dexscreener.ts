/**
 * Client DexScreener (API publique gratuite, sans clé ; base : config.dexscreenerBaseUrl).
 *
 *   GET /token-profiles/latest/v1            derniers profils de tokens       (60 req/min)
 *   GET /token-boosts/latest/v1              derniers tokens « boostés »      (60 req/min)
 *   GET /tokens/v1/{chainId}/{a1,a2,…}       paires des tokens, 30 adresses max (300 req/min)
 *
 * Le site de documentation n'était pas joignable depuis l'environnement de développement : on
 * s'appuie sur le schéma public historique et on lit TOUT de façon défensive, car une réponse
 * inattendue ne doit jamais devenir une « bonne » donnée :
 *   - les nombres arrivent parfois en chaîne (priceUsd, priceNative) : conversion stricte, NaN si
 *     la valeur est absente ou illisible (jamais 0 par défaut : Number(null) vaut 0 !) ;
 *   - une liste peut être un tableau nu ou enveloppée dans { pairs: [...] } ({ pairs: null } = vide) ;
 *   - une forme de réponse inconnue (page HTML, objet d'erreur…) lève une erreur : l'appelant
 *     compte alors la source en échec au lieu de croire qu'elle est vide.
 *
 * Débit : le scanner n'appelle les profils et les boosts qu'une fois par scan (un scan toutes les
 * 15 s au minimum, soit ≤ 4 req/min, loin des 60 req/min). Les lots de paires sont envoyés l'un
 * après l'autre et l'espacement par hôte de lib/http.ts (250 ms) les garde sous 300 req/min.
 */

import type { Http } from './http.ts';

/** Nombre maximal d'adresses par appel à /tokens/v1 (limite de l'API). */
export const DEX_MAX_ADDRESSES_PER_CALL = 30;

export interface DexToken {
  address: string;
  name: string;
  symbol: string;
}

export interface DexTxns {
  buys: number;
  sells: number;
}

/** Référence de token renvoyée par les listes « latest » (profils, boosts). */
export interface DexTokenRef {
  chainId: string;
  tokenAddress: string;
}

/**
 * Paire normalisée. Chaînes vides quand le texte est absent ; nombres à NaN quand la valeur est
 * absente ou illisible : l'appelant doit traiter NaN comme « inconnu » (et donc refuser).
 */
export interface DexPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  labels: string[];
  baseToken: DexToken;
  quoteToken: DexToken;
  priceNative: number;
  priceUsd: number;
  txns: { m5: DexTxns; h1: DexTxns; h6: DexTxns; h24: DexTxns };
  /** Volumes en USD. */
  volume: { m5: number; h1: number; h6: number; h24: number };
  /** Variations de prix en % (12.5 = +12,5 %). */
  priceChange: { m5: number; h1: number; h6: number; h24: number };
  liquidity: { usd: number; base: number; quote: number };
  fdv: number;
  marketCap: number;
  /** Création de la paire, en MILLISECONDES depuis l'epoch. */
  pairCreatedAt: number;
  /** Nombre de boosts actifs (NaN si absent). */
  boostsActive: number;
}

export interface DexScreener {
  latestProfiles(): Promise<DexTokenRef[]>;
  latestBoosts(): Promise<DexTokenRef[]>;
  /** Découpe en lots de 30 adresses, envoyés l'un après l'autre ; un lot en échec fait échouer l'appel. */
  pairsForTokens(chainId: string, addresses: string[]): Promise<DexPair[]>;
}

export interface DexScreenerDeps {
  http: Http;
  baseUrl: string;
}

export function createDexScreener({ http, baseUrl }: DexScreenerDeps): DexScreener {
  const base = baseUrl.replace(/\/+$/, '');

  return {
    async latestProfiles() {
      return parseTokenRefs(await http.getJson(`${base}/token-profiles/latest/v1`), '/token-profiles/latest/v1');
    },
    async latestBoosts() {
      return parseTokenRefs(await http.getJson(`${base}/token-boosts/latest/v1`), '/token-boosts/latest/v1');
    },
    async pairsForTokens(chainId, addresses) {
      const unique = [...new Set(addresses.filter((a) => typeof a === 'string' && a !== ''))];
      const out: DexPair[] = [];
      const seen = new Set<string>();
      for (let i = 0; i < unique.length; i += DEX_MAX_ADDRESSES_PER_CALL) {
        const batch = unique.slice(i, i + DEX_MAX_ADDRESSES_PER_CALL);
        // Les adresses viennent de sources externes : encodées pour ne jamais sortir du chemin.
        const path = `/tokens/v1/${encodeURIComponent(chainId)}/${batch.map((a) => encodeURIComponent(a)).join(',')}`;
        const items = listFrom(await http.getJson(`${base}${path}`), '/tokens/v1');
        for (const item of items) {
          const pair = normalizePair(item);
          if (!pair) continue;
          // Une même paire peut revenir dans deux lots (ses deux tokens demandés) : on la garde une fois.
          const key = `${pair.chainId}:${pair.pairAddress}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(pair);
        }
      }
      return out;
    },
  };
}

/**
 * Normalise une paire brute de l'API. Renvoie null si ce n'est pas un objet ou s'il manque
 * l'identité de la paire (adresse de paire, adresse du token de base) ; tout le reste est
 * conservé, avec NaN / '' pour les valeurs absentes.
 */
export function normalizePair(raw: unknown): DexPair | null {
  if (!isRecord(raw)) return null;
  const baseToken = token(raw['baseToken']);
  const pairAddress = str(raw['pairAddress']);
  if (baseToken.address === '' || pairAddress === '') return null;
  const txns = rec(raw['txns']);
  const volume = rec(raw['volume']);
  const priceChange = rec(raw['priceChange']);
  const liquidity = rec(raw['liquidity']);
  const labels = raw['labels'];
  return {
    chainId: str(raw['chainId']),
    dexId: str(raw['dexId']),
    url: str(raw['url']),
    pairAddress,
    labels: Array.isArray(labels) ? labels.filter((l): l is string => typeof l === 'string') : [],
    baseToken,
    quoteToken: token(raw['quoteToken']),
    priceNative: num(raw['priceNative']),
    priceUsd: num(raw['priceUsd']),
    txns: { m5: txn(txns['m5']), h1: txn(txns['h1']), h6: txn(txns['h6']), h24: txn(txns['h24']) },
    volume: { m5: num(volume['m5']), h1: num(volume['h1']), h6: num(volume['h6']), h24: num(volume['h24']) },
    priceChange: {
      m5: num(priceChange['m5']),
      h1: num(priceChange['h1']),
      h6: num(priceChange['h6']),
      h24: num(priceChange['h24']),
    },
    liquidity: { usd: num(liquidity['usd']), base: num(liquidity['base']), quote: num(liquidity['quote']) },
    fdv: num(raw['fdv']),
    marketCap: num(raw['marketCap']),
    pairCreatedAt: num(raw['pairCreatedAt']),
    boostsActive: num(rec(raw['boosts'])['active']),
  };
}

// ---------------------------------------------------------------------------
// Lecture défensive
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function rec(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {};
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Nombre fini, ou NaN. Seuls les nombres et les chaînes non vides sont acceptés (pas null, '', true…). */
function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

function token(v: unknown): DexToken {
  const t = rec(v);
  return { address: str(t['address']), name: str(t['name']), symbol: str(t['symbol']) };
}

function txn(v: unknown): DexTxns {
  const t = rec(v);
  return { buys: num(t['buys']), sells: num(t['sells']) };
}

/** Description courte d'une réponse inattendue (sans recopier son contenu, écrit par des inconnus). */
function shapeOf(v: unknown): string {
  if (v === null || v === undefined) return 'vide';
  if (Array.isArray(v)) return 'tableau';
  if (typeof v === 'string') return 'texte non JSON';
  return typeof v;
}

/** Tableau nu, ou { pairs: [...] } ; { pairs: null } = aucune paire. Sinon : erreur. */
function listFrom(raw: unknown, endpoint: string): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (isRecord(raw)) {
    const pairs = raw['pairs'];
    if (Array.isArray(pairs)) return pairs;
    if (pairs === null) return [];
  }
  throw new Error(`DexScreener ${endpoint} : réponse inattendue (${shapeOf(raw)})`);
}

function parseTokenRefs(raw: unknown, endpoint: string): DexTokenRef[] {
  // L'ancienne documentation décrivait un objet seul : accepté comme une liste d'un élément.
  const items = isRecord(raw) && typeof raw['tokenAddress'] === 'string' ? [raw] : listFrom(raw, endpoint);
  const out: DexTokenRef[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const chainId = str(item['chainId']);
    const tokenAddress = str(item['tokenAddress']);
    if (chainId === '' || tokenAddress === '') continue;
    out.push({ chainId, tokenAddress });
  }
  return out;
}
