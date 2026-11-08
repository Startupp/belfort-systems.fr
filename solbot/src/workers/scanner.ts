/**
 * Scanner : repère les tokens Solana récents dont le volume s'emballe, à partir de sources
 * gratuites (Jupiter Tokens V2, DexScreener), et applique des filtres de marché PRUDENTS.
 * Ce n'est qu'un premier tamis : chaque candidat passe ensuite par le filtre anti-rug.
 *
 * Étapes de scan() :
 *   1. Collecte en parallèle (Promise.allSettled) : jup:toptrending:5m, jup:toporganicscore:5m,
 *      jup:recent, dex:profiles, dex:boosts (chaîne « solana » seulement). Une source en échec
 *      n'arrête pas le scan (sourcesFailed) ; si toutes échouent, aucun candidat.
 *   2. Dédoublonnage ; retrait des mints exclus (positions ouvertes, cooldowns…) et de SOL, USDC, USDT.
 *   3. Données Jupiter gardées par mint : score organique, traders distincts sur 5 min.
 *   4. Paires DexScreener (lots de 30) → paire de référence → filtres (evaluatePair).
 *   5. Tri par score décroissant ; on garde les maxCandidates premiers.
 *
 * Échoue fermé : une donnée absente, NaN ou incohérente écarte le token avec un code stable
 * (ScanResult.rejectedCounts, voir SCAN_REJECT_REASONS), jamais l'inverse. Chaque token examiné
 * finit soit candidat, soit avec au moins un code.
 *
 * SÉCURITÉ : symbole et nom des tokens sont écrits par n'importe qui. sanitizeText retire les
 * caractères de contrôle (séquences ESC d'injection de terminal), les caractères invisibles et
 * les inversions du sens d'écriture, puis tronque. Les mints venant des sources sont validés
 * (base58) avant de servir dans une URL.
 */

import type { Config, ScannerConfig } from '../config.ts';
import { isValidAddress } from '../config.ts';
import type { DexPair, DexScreener } from '../lib/dexscreener.ts';
import type { JupiterClient } from '../lib/jupiter.ts';
import type { Clock, ScanResult, TokenCandidate } from '../types.ts';
import { SOL_MINT, USDC_MINT } from '../types.ts';

const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

/** Jamais candidats : la monnaie native et les stablecoins. */
const NEVER_CANDIDATES: ReadonlySet<string> = new Set([SOL_MINT, USDC_MINT, USDT_MINT]);

/**
 * Pour les symboles de cotation connus, l'adresse doit être la vraie : n'importe quel token peut
 * s'appeler « SOL » et servir de fausse cotation (liquidité en USD gonflée). Les symboles absents
 * de cette table (ajoutés via QUOTE_SYMBOLS) ne sont vérifiés que par leur nom.
 */
const CANONICAL_QUOTE_MINTS: ReadonlyMap<string, string> = new Map([
  ['SOL', SOL_MINT],
  ['WSOL', SOL_MINT],
  ['USDC', USDC_MINT],
  ['USDT', USDT_MINT],
]);

/** Garde-fou : au-delà, les tokens ne sont pas examinés (10 lots de 30 adresses au plus par scan). */
export const MAX_MINTS_PER_SCAN = 300;
export const SYMBOL_MAX_LEN = 32;
export const NAME_MAX_LEN = 64;
/** Plafond du ratio de pic de volume. */
export const SPIKE_CAP = 99;

/** Libellés des sources de mints, dans l'ordre de collecte. */
export const SCAN_SOURCES = [
  'jup:toptrending:5m',
  'jup:toporganicscore:5m',
  'jup:recent',
  'dex:profiles',
  'dex:boosts',
] as const;

/** Libellé de l'appel des paires DexScreener dans sourcesOk / sourcesFailed (quand il a lieu). */
export const PAIRS_SOURCE = 'dex:pairs';

/** Codes d'écartement stables (clés de ScanResult.rejectedCounts) et leur explication. */
export const SCAN_REJECT_REASONS = {
  INVALID_MINT: "adresse de mint invalide renvoyée par une source (jamais mise dans une URL)",
  SCAN_LIMIT: `au-delà des ${MAX_MINTS_PER_SCAN} tokens examinés par scan`,
  PAIRS_UNAVAILABLE: 'paires DexScreener indisponibles pendant ce scan (erreur API)',
  NO_PAIR: "aucune paire DexScreener où le token est le token de base",
  QUOTE_NOT_ALLOWED: "aucune paire cotée dans une monnaie acceptée (QUOTE_SYMBOLS, adresse vérifiée pour SOL/USDC/USDT)",
  MISSING_DATA: 'donnée de marché absente, illisible ou incohérente',
  LOW_LIQUIDITY: 'liquidité sous MIN_LIQUIDITY_USD',
  TOO_YOUNG: 'paire plus jeune que MIN_AGE_MIN',
  TOO_OLD: 'paire plus vieille que MAX_AGE_HOURS',
  MCAP_OUT_OF_RANGE: 'capitalisation (ou FDV) hors de [MIN_MCAP_USD ; MAX_MCAP_USD]',
  LOW_VOLUME: 'volume 5 min sous MIN_VOL5M_USD',
  NO_SPIKE: 'pic de volume sous MIN_SPIKE_RATIO',
  FEW_BUYS: "moins d'achats sur 5 min que MIN_BUYS_5M",
  SELL_PRESSURE: 'ratio achats/ventes 5 min sous MIN_BUY_SELL_RATIO',
  PRICE_TOO_HOT: 'hausse 5 min au-dessus de MAX_PRICE_CHANGE_5M_PCT (bougie déjà verticale)',
  PRICE_FALLING: 'variation 5 min sous MIN_PRICE_CHANGE_5M_PCT',
  RANKED_OUT: 'tous les filtres passés, mais hors des MAX_CANDIDATES meilleurs scores',
} as const;

export type ScanRejectCode = keyof typeof SCAN_REJECT_REASONS;

export interface ScannerDeps {
  jupiter: JupiterClient;
  dex: DexScreener;
  clock: Clock;
  config: Config;
  /**
   * Facultatif : appelé pour chaque source en échec, avec l'erreur (ScanResult ne garde que le
   * libellé de la source). Une exception levée ici est ignorée.
   */
  onSourceError?: (source: string, error: unknown) => void;
}

export interface Scanner {
  scan(exclude?: ReadonlySet<string>): Promise<ScanResult>;
}

interface MintInfo {
  sources: string[];
  organicScore?: number;
  traders5m?: number;
}

interface SourceFetch {
  label: string;
  kind: 'jup' | 'dex';
  run: () => Promise<unknown>;
}

export function createScanner(deps: ScannerDeps): Scanner {
  const { jupiter, dex, clock, config } = deps;

  function reportError(source: string, error: unknown): void {
    try {
      deps.onSourceError?.(source, error);
    } catch {
      // le journal ne doit jamais casser le scan
    }
  }

  return {
    async scan(exclude: ReadonlySet<string> = new Set<string>()): Promise<ScanResult> {
      const cfg = config.scanner;
      const sourcesOk: string[] = [];
      const sourcesFailed: string[] = [];
      const rejectedCounts: Record<string, number> = {};
      const reject = (codes: readonly string[]): void => {
        for (const code of new Set(codes)) rejectedCounts[code] = (rejectedCounts[code] ?? 0) + 1;
      };

      // 1. Collecte des mints, toutes sources en parallèle ; une source en échec n'arrête rien.
      const fetches: SourceFetch[] = [
        { label: 'jup:toptrending:5m', kind: 'jup', run: () => jupiter.tokensByCategory('toptrending', '5m') },
        { label: 'jup:toporganicscore:5m', kind: 'jup', run: () => jupiter.tokensByCategory('toporganicscore', '5m') },
        { label: 'jup:recent', kind: 'jup', run: () => jupiter.tokensRecent() },
        { label: 'dex:profiles', kind: 'dex', run: () => dex.latestProfiles() },
        { label: 'dex:boosts', kind: 'dex', run: () => dex.latestBoosts() },
      ];
      // Promise.resolve().then : une exception synchrone devient un rejet comme les autres.
      const settled = await Promise.allSettled(fetches.map((f) => Promise.resolve().then(() => f.run())));

      const mints = new Map<string, MintInfo>(); // ordre d'insertion = ordre des sources
      const touch = (mint: string, label: string): MintInfo => {
        let info = mints.get(mint);
        if (!info) {
          info = { sources: [] };
          mints.set(mint, info);
        }
        if (!info.sources.includes(label)) info.sources.push(label);
        return info;
      };

      for (const [i, f] of fetches.entries()) {
        const r = settled[i];
        if (r === undefined) continue;
        if (r.status === 'rejected') {
          sourcesFailed.push(f.label);
          reportError(f.label, r.reason);
          continue;
        }
        const items: unknown = r.value;
        if (!Array.isArray(items)) {
          sourcesFailed.push(f.label);
          reportError(f.label, new Error(`${f.label} : réponse inattendue (pas une liste)`));
          continue;
        }
        sourcesOk.push(f.label);
        for (const item of items) {
          if (!isRecord(item)) continue;
          if (f.kind === 'jup') {
            const mint = item['id'];
            if (typeof mint !== 'string' || mint === '') continue;
            const info = touch(mint, f.label);
            // 3. Données Jupiter : la première valeur valide rencontrée est gardée.
            if (info.organicScore === undefined) {
              const organic = validOrganicScore(item['organicScore']);
              if (organic !== undefined) info.organicScore = organic;
            }
            if (info.traders5m === undefined) {
              const stats = item['stats5m'];
              const traders = isRecord(stats) ? validCount(stats['numTraders']) : undefined;
              if (traders !== undefined) info.traders5m = traders;
            }
          } else {
            const mint = item['tokenAddress'];
            if (item['chainId'] !== 'solana' || typeof mint !== 'string' || mint === '') continue;
            touch(mint, f.label);
          }
        }
      }

      // 2. Exclusions (dédoublonnage déjà fait par la Map), puis validation des adresses.
      const examined = [...mints.keys()].filter((m) => !exclude.has(m) && !NEVER_CANDIDATES.has(m));
      const lookup: string[] = [];
      for (const mint of examined) {
        if (!isValidAddress(mint)) reject(['INVALID_MINT']);
        else if (lookup.length >= MAX_MINTS_PER_SCAN) reject(['SCAN_LIMIT']);
        else lookup.push(mint);
      }

      // 4. Paires DexScreener. Un échec ici n'est pas une absence de paire : code distinct.
      let pairs: DexPair[] | undefined;
      if (lookup.length > 0) {
        try {
          const got: unknown = await dex.pairsForTokens('solana', lookup);
          if (!Array.isArray(got)) throw new Error('DexScreener : réponse inattendue (pas une liste de paires)');
          pairs = got as DexPair[];
          sourcesOk.push(PAIRS_SOURCE);
        } catch (error) {
          sourcesFailed.push(PAIRS_SOURCE);
          reportError(PAIRS_SOURCE, error);
        }
      }

      // Instant d'observation : après réception des paires (sert au calcul de l'âge).
      const nowMs = clock.now();
      const at = clock.iso();

      const byBase = new Map<string, DexPair[]>();
      for (const p of pairs ?? []) {
        if (!isRecord(p) || p.chainId !== 'solana') continue;
        const list = byBase.get(p.baseToken.address);
        if (list) list.push(p);
        else byBase.set(p.baseToken.address, [p]);
      }

      const passing: TokenCandidate[] = [];
      for (const mint of lookup) {
        if (pairs === undefined) {
          reject(['PAIRS_UNAVAILABLE']);
          continue;
        }
        const forMint = byBase.get(mint) ?? [];
        if (forMint.length === 0) {
          reject(['NO_PAIR']);
          continue;
        }
        const ref = pickReferencePair(forMint, mint, cfg.quoteSymbols);
        if (!ref) {
          reject(['QUOTE_NOT_ALLOWED']);
          continue;
        }
        const info = mints.get(mint) ?? { sources: [] };
        const { candidate, rejectCodes } = evaluatePair(ref, nowMs, cfg, info);
        if (candidate) passing.push(candidate);
        else reject(rejectCodes.length > 0 ? rejectCodes : ['MISSING_DATA']);
      }

      // 5. Classement.
      passing.sort(compareCandidates);
      const maxN = Number.isFinite(cfg.maxCandidates) ? Math.max(0, Math.floor(cfg.maxCandidates)) : 0;
      const candidates = passing.slice(0, maxN);
      for (let i = candidates.length; i < passing.length; i++) reject(['RANKED_OUT']);

      return { at, candidates, examined: examined.length, rejectedCounts, sourcesOk, sourcesFailed };
    },
  };
}

/** Score décroissant, puis liquidité décroissante, puis mint : ordre total et déterministe. */
function compareCandidates(a: TokenCandidate, b: TokenCandidate): number {
  return b.score - a.score || b.liquidityUsd - a.liquidityUsd || (a.mint < b.mint ? -1 : a.mint > b.mint ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

/**
 * Pic de volume : volume des 5 dernières minutes rapporté à la moyenne des 11 autres tranches de
 * 5 min de l'heure, baseline = (vol1h − vol5m) / 11.
 *   - entrée non finie → 0 ; aucun volume sur 5 min (≤ 0) → 0 : pas de volume, pas de pic ;
 *   - baseline < 1 $ (heure vide avant ces 5 min, ou vol1h < vol5m par décalage des fenêtres) → 99 ;
 *   - plafonné à 99.
 */
export function computeSpikeRatio(vol5m: number, vol1h: number): number {
  if (!Number.isFinite(vol5m) || !Number.isFinite(vol1h)) return 0;
  if (vol5m <= 0) return 0;
  const baseline = (vol1h - vol5m) / 11;
  if (baseline < 1) return SPIKE_CAP;
  return Math.min(vol5m / baseline, SPIKE_CAP);
}

/**
 * Paire de référence d'un mint : le mint est le token de BASE, la cotation est acceptée
 * (symbole insensible à la casse ; pour SOL/WSOL/USDC/USDT, adresse officielle exigée), et la
 * liquidité USD est la plus haute (une liquidité inconnue passe après toute liquidité connue ;
 * à égalité, la première paire gagne).
 */
export function pickReferencePair(pairs: DexPair[], mint: string, quoteSymbols: string[]): DexPair | undefined {
  const accepted = new Set(quoteSymbols.map((s) => s.trim().toUpperCase()));
  let best: DexPair | undefined;
  let bestLiquidity = -Infinity;
  for (const p of pairs) {
    if (p.baseToken.address !== mint || !isAcceptedQuote(p, accepted)) continue;
    const liquidity = Number.isFinite(p.liquidityUsd) ? p.liquidityUsd : -Infinity;
    if (best === undefined || liquidity > bestLiquidity) {
      best = p;
      bestLiquidity = liquidity;
    }
  }
  return best;
}

function isAcceptedQuote(p: DexPair, accepted: ReadonlySet<string>): boolean {
  const symbol = p.quoteToken.symbol.trim().toUpperCase();
  if (symbol === '' || !accepted.has(symbol)) return false;
  const canonical = CANONICAL_QUOTE_MINTS.get(symbol);
  return canonical === undefined || p.quoteToken.address === canonical;
}

/**
 * Applique les filtres de marché à la paire de référence. Tous les codes qui s'appliquent sont
 * rassemblés (ordre stable). Une donnée absente, NaN ou incohérente donne MISSING_DATA (les seuils
 * qui en dépendent ne sont alors pas évalués) ; les comparaisons sont écrites « !(x ≥ seuil) »
 * pour qu'un seuil NaN refuse aussi. Candidat renvoyé seulement si aucun code.
 */
export function evaluatePair(
  pair: DexPair,
  nowMs: number,
  cfg: ScannerConfig,
  extra: { sources: string[]; organicScore?: number; traders5m?: number },
): { candidate?: TokenCandidate; rejectCodes: string[] } {
  const codes: ScanRejectCode[] = [];

  const mint = pair.baseToken.address;
  const liquidityUsd = pair.liquidityUsd;
  const vol5m = pair.vol5mUsd;
  const vol1h = pair.vol1hUsd;
  const buys5m = pair.buys5m;
  const sells5m = pair.sells5m;
  const createdAt = pair.pairCreatedAtMs;
  const priceUsd = pair.priceUsd;
  const change5m = pair.priceChange5mPct;
  const change1h = pair.priceChange1hPct;
  // marketCap, sinon fdv ; une valeur ≤ 0 compte comme absente.
  const usesMarketCap = isPositive(pair.marketCapUsd);
  const marketCapUsd = usesMarketCap ? pair.marketCapUsd : isPositive(pair.fdvUsd) ? pair.fdvUsd : NaN;
  const ageMinutes = (nowMs - createdAt) / 60_000;
  const spikeRatio = computeSpikeRatio(vol5m, vol1h);
  const buySellRatio = buys5m / Math.max(1, sells5m);

  const liquidityOk = isNonNegative(liquidityUsd);
  const volumeOk = isNonNegative(vol5m) && isNonNegative(vol1h);
  const txnsOk = isNonNegative(buys5m) && isNonNegative(sells5m);
  const ageOk = isPositive(createdAt) && Number.isFinite(ageMinutes);
  const mcapOk = Number.isFinite(marketCapUsd);
  const change5mOk = Number.isFinite(change5m);
  const missing =
    !isValidAddress(mint) ||
    !isValidAddress(pair.pairAddress) ||
    !liquidityOk ||
    !volumeOk ||
    !txnsOk ||
    !ageOk ||
    !mcapOk ||
    !change5mOk ||
    !isPositive(priceUsd) ||
    !Number.isFinite(change1h);
  if (missing) codes.push('MISSING_DATA');

  if (liquidityOk && !(liquidityUsd >= cfg.minLiquidityUsd)) codes.push('LOW_LIQUIDITY');
  if (ageOk) {
    if (!(ageMinutes >= cfg.minAgeMinutes)) codes.push('TOO_YOUNG');
    if (!(ageMinutes <= cfg.maxAgeHours * 60)) codes.push('TOO_OLD');
  }
  if (mcapOk && !(marketCapUsd >= cfg.minMarketCapUsd && marketCapUsd <= cfg.maxMarketCapUsd)) {
    codes.push('MCAP_OUT_OF_RANGE');
  }
  if (volumeOk) {
    if (!(vol5m >= cfg.minVol5mUsd)) codes.push('LOW_VOLUME');
    if (!(spikeRatio >= cfg.minSpikeRatio)) codes.push('NO_SPIKE');
  }
  if (txnsOk) {
    if (!(buys5m >= cfg.minBuys5m)) codes.push('FEW_BUYS');
    if (!(buySellRatio >= cfg.minBuySellRatio)) codes.push('SELL_PRESSURE');
  }
  if (change5mOk) {
    if (!(change5m <= cfg.maxPriceChange5mPct)) codes.push('PRICE_TOO_HOT');
    if (!(change5m >= cfg.minPriceChange5mPct)) codes.push('PRICE_FALLING');
  }
  if (codes.length > 0) return { rejectCodes: codes };

  const organicScore = validOrganicScore(extra.organicScore);
  const traders5m = validCount(extra.traders5m);
  const sources = [...extra.sources];
  const baseline = Math.max(0, (vol1h - vol5m) / 11);

  const signals = [
    `pic de volume ×${spikeRatio.toFixed(1)} (5 min : ${formatUsd(vol5m)} vs ${formatUsd(baseline)} en moyenne)`,
    `achats/ventes 5 min : ${formatPlain(buys5m)}/${formatPlain(sells5m)} (×${buySellRatio.toFixed(1)})`,
    `liquidité ${formatUsd(liquidityUsd)}, ${usesMarketCap ? 'capitalisation' : 'FDV'} ${formatUsd(marketCapUsd)}, âge ${formatAge(ageMinutes)}`,
    `prix ${formatPct(change5m)} sur 5 min, ${formatPct(change1h)} sur 1 h`,
  ];
  if (organicScore !== undefined) signals.push(`score organique Jupiter ${formatPlain(organicScore)}`);
  if (traders5m !== undefined) signals.push(`traders 5 min : ${formatPlain(traders5m)}`);
  if (sources.length > 0) signals.push(`sources : ${sources.join(', ')}`);

  const candidate: TokenCandidate = {
    mint,
    symbol: sanitizeText(pair.baseToken.symbol, SYMBOL_MAX_LEN),
    name: sanitizeText(pair.baseToken.name, NAME_MAX_LEN),
    pairAddress: pair.pairAddress,
    dexId: sanitizeText(pair.dexId, SYMBOL_MAX_LEN),
    quoteSymbol: sanitizeText(pair.quoteToken.symbol, SYMBOL_MAX_LEN),
    priceUsd,
    liquidityUsd,
    marketCapUsd,
    pairCreatedAtMs: createdAt,
    ageMinutes,
    vol5mUsd: vol5m,
    vol1hUsd: vol1h,
    buys5m,
    sells5m,
    priceChange5mPct: change5m,
    priceChange1hPct: change1h,
    spikeRatio,
    buySellRatio,
    ...(organicScore !== undefined ? { organicScore } : {}),
    ...(traders5m !== undefined ? { traders5m } : {}),
    sources,
    score: computeScore({ spikeRatio, buySellRatio, organicScore, liquidityUsd }),
    signals,
    observedAt: new Date(nowMs).toISOString(),
  };
  return { candidate, rejectCodes: [] };
}

/**
 * Score de classement, déterministe (plus haut = plus intéressant), arrondi à 2 décimales :
 *
 *   score = 2 · log2(max(spikeRatio, 1))         pic de volume : chaque doublement vaut 2 points
 *         + min(buySellRatio, 3)                 pression acheteuse, plafonnée à 3 points
 *         + (organicScore ?? 50) / 25            score organique Jupiter 0–100 → 0–4 points (2 si inconnu)
 *         + log10(max(liquidityUsd, 1)) / 2      profondeur : 10 k$ → 2 points, 1 M$ → 3 points
 *
 * Exemple : pic ×4.23, achats/ventes ×1.6, organique 72, liquidité 52 k$ → 4.16 + 1.6 + 2.88 + 2.36 = 11.
 * Une entrée non finie compte pour le minimum (organique : 50), pour ne jamais trier sur NaN.
 */
export function computeScore(m: {
  spikeRatio: number;
  buySellRatio: number;
  organicScore?: number;
  liquidityUsd: number;
}): number {
  const spike = Number.isFinite(m.spikeRatio) ? Math.max(m.spikeRatio, 1) : 1;
  const buySell = Number.isFinite(m.buySellRatio) ? Math.min(Math.max(m.buySellRatio, 0), 3) : 0;
  const organic = m.organicScore !== undefined && Number.isFinite(m.organicScore) ? m.organicScore : 50;
  const liquidity = Number.isFinite(m.liquidityUsd) ? Math.max(m.liquidityUsd, 1) : 1;
  const raw = 2 * Math.log2(spike) + buySell + organic / 25 + Math.log10(liquidity) / 2;
  return Math.round(raw * 100) / 100;
}

/**
 * Caractères retirés des textes écrits par des inconnus :
 *   Cc  contrôles C0, DEL, C1 (ESC → séquences d'échappement de terminal ; tabulations, retours ligne) ;
 *   Cf  formats invisibles : U+200B–U+200F, inversions U+202A–U+202E, isolats U+2066–U+2069, U+FEFF,
 *       caractères « tag » U+E0000… (texte caché) ;
 *   Cs  demi-paires de substitution orphelines ; Zl/Zp séparateurs de ligne et de paragraphe ;
 *   Default_Ignorable_Code_Point  le reste de l'invisible (remplissages hangul, sélecteurs de variante…).
 */
const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/gu;

/**
 * Nettoie un texte venu de l'extérieur avant de l'afficher ou de le journaliser : retire les
 * caractères dangereux ou invisibles (UNSAFE_TEXT), ramène chaque suite d'espaces à une espace,
 * coupe les espaces de bord et tronque à maxLen points de code (sans couper un emoji en deux).
 * Tout ce qui n'est ni une chaîne ni un nombre fini donne ''.
 */
export function sanitizeText(s: unknown, maxLen: number): string {
  let text: string;
  if (typeof s === 'string') text = s;
  else if (typeof s === 'number' && Number.isFinite(s)) text = String(s);
  else return '';
  const limit = Number.isFinite(maxLen) ? Math.max(0, Math.floor(maxLen)) : 0;
  const cleaned = text.replace(UNSAFE_TEXT, '').replace(/\s+/gu, ' ').trim();
  const codePoints = Array.from(cleaned);
  return codePoints.length <= limit ? cleaned : codePoints.slice(0, limit).join('').trimEnd();
}

// ---------------------------------------------------------------------------
// Formatage des messages (point décimal, pour rester facile à rechercher avec grep)
// ---------------------------------------------------------------------------

/** Montant USD compact : « 850 $ », « 18.2 k$ », « 1.2 M$ », « 3.4 Md$ ». */
export function formatUsd(v: number): string {
  if (!Number.isFinite(v)) return '? $';
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a < 999.5) return `${sign}${Math.round(a)} $`;
  if (a < 999_950) return `${sign}${(a / 1e3).toFixed(1)} k$`;
  if (a < 999_950_000) return `${sign}${(a / 1e6).toFixed(1)} M$`;
  return `${sign}${(a / 1e9).toFixed(1)} Md$`;
}

/** Âge lisible : « 45 min », « 3 h 10 », « 2 j 5 h ». */
function formatAge(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  if (hours < 24) return `${hours} h ${String(total % 60).padStart(2, '0')}`;
  return `${Math.floor(hours / 24)} j ${hours % 24} h`;
}

function formatPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)} %`;
}

function formatPlain(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// ---------------------------------------------------------------------------
// Petites validations
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPositive(v: number): boolean {
  return Number.isFinite(v) && v > 0;
}

function isNonNegative(v: number): boolean {
  return Number.isFinite(v) && v >= 0;
}

/** Nombre fini (ou chaîne numérique) ; undefined sinon. */
function finiteOrUndefined(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** Score organique Jupiter : 0–100, sinon inconnu. */
function validOrganicScore(v: unknown): number | undefined {
  const n = finiteOrUndefined(v);
  return n !== undefined && n >= 0 && n <= 100 ? n : undefined;
}

/** Compteur ≥ 0, sinon inconnu. */
function validCount(v: unknown): number | undefined {
  const n = finiteOrUndefined(v);
  return n !== undefined && n >= 0 ? n : undefined;
}
