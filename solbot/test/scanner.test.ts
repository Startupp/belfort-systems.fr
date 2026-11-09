/** Tests du scanner : client DexScreener, filtres de marché, nettoyage des textes, chaîne scan(). */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import type { Config, ScannerConfig } from '../src/config.ts';
import { decodeBase58, encodeBase58 } from '../src/lib/base58.ts';
import { DEX_MAX_ADDRESSES_PER_CALL, createDexScreener, normalizePair } from '../src/lib/dexscreener.ts';
import type { DexPair, DexScreener, DexTokenRef } from '../src/lib/dexscreener.ts';
import { HttpError } from '../src/lib/http.ts';
import type { Http } from '../src/lib/http.ts';
import type { JupiterClient, JupiterToken } from '../src/lib/jupiter.ts';
import { fixedClock } from '../src/lib/store.ts';
import { SOL_MINT, USDC_MINT } from '../src/types.ts';
import {
  MAX_MINTS_PER_SCAN,
  PAIRS_SOURCE,
  SCAN_SOURCES,
  computeScore,
  computeSpikeRatio,
  createScanner,
  evaluatePair,
  formatUsd,
  pickReferencePair,
  sanitizeText,
} from '../src/workers/scanner.ts';
import type { ScannerDeps } from '../src/workers/scanner.ts';

const NOW = Date.parse('2026-11-08T16:00:00.000Z');
const MIN = 60_000;
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const BASE_URL = 'https://api.dexscreener.test';

/** Seuils figés ici (les défauts de config.ts peuvent changer sans casser ces tests). */
const SCAN: ScannerConfig = {
  minLiquidityUsd: 25_000,
  minAgeMinutes: 30,
  maxAgeHours: 72,
  minVol5mUsd: 5_000,
  minSpikeRatio: 3,
  minBuys5m: 20,
  minBuySellRatio: 1.2,
  maxPriceChange5mPct: 30,
  minPriceChange5mPct: 0,
  minMarketCapUsd: 100_000,
  maxMarketCapUsd: 50_000_000,
  quoteSymbols: ['SOL', 'WSOL', 'USDC'],
  maxCandidates: 5,
};

function makeConfig(scanner: Partial<ScannerConfig> = {}): Config {
  return { ...loadConfig({ JUPITER_API_KEY: 'cle-de-test' }, '/tmp'), scanner: { ...SCAN, ...scanner } };
}

/** Adresse base58 valide et déterministe : `tag` sépare les familles (mints, paires…), `i` les numérote. */
function address(tag: number, i: number): string {
  const b = new Uint8Array(32).fill(tag);
  b[0] = i & 0xff;
  b[1] = (i >> 8) & 0xff;
  return encodeBase58(b);
}
const mintAt = (i: number): string => address(1, i);
const MINT = mintAt(0);
/** Adresse de paire par défaut d'un mint : ses octets à l'envers (distincte, valide). */
const pairAddressFor = (mint: string): string => encodeBase58(decodeBase58(mint).reverse());
/** vol1h qui donne exactement le pic demandé pour ce vol5m. */
const vol1hFor = (vol5m: number, spike: number): number => vol5m + (11 * vol5m) / spike;

interface Metrics {
  liq: number;
  vol5m: number;
  vol1h: number;
  buys: number;
  sells: number;
  ageMin: number;
  mcap: number;
  fdv: number;
  pc5m: number;
  pc1h: number;
  priceUsd: string;
  symbol: string;
  name: string;
  quoteSymbol: string;
  quoteAddress: string;
  dexId: string;
  pairAddress?: string;
}

/** Paire « type » qui passe tous les filtres : pic ×4.2, achats/ventes 64/40, 52 k$, 1.2 M$, 3 h 10. */
const GOOD: Metrics = {
  liq: 52_000,
  vol5m: 18_200,
  vol1h: 65_500,
  buys: 64,
  sells: 40,
  ageMin: 190,
  mcap: 1_200_000,
  fdv: 1_300_000,
  pc5m: 12.3,
  pc1h: 40.1,
  priceUsd: '0.0012',
  symbol: 'PEPE2',
  name: 'Pepe Deux',
  quoteSymbol: 'SOL',
  quoteAddress: SOL_MINT,
  dexId: 'raydium',
};

/** Paire au format brut de l'API DexScreener (nombres parfois en chaîne). */
function rawPair(mint: string, m: Partial<Metrics> = {}): Record<string, unknown> {
  const v = { ...GOOD, ...m };
  const pairAddress = m.pairAddress ?? pairAddressFor(mint);
  return {
    chainId: 'solana',
    dexId: v.dexId,
    url: `https://dexscreener.com/solana/${pairAddress}`,
    pairAddress,
    labels: ['v4'],
    baseToken: { address: mint, name: v.name, symbol: v.symbol },
    quoteToken: { address: v.quoteAddress, name: 'Wrapped SOL', symbol: v.quoteSymbol },
    priceNative: '0.0000081',
    priceUsd: v.priceUsd,
    txns: {
      m5: { buys: v.buys, sells: v.sells },
      h1: { buys: 300, sells: 210 },
      h6: { buys: 1_500, sells: 1_200 },
      h24: { buys: 6_000, sells: 5_000 },
    },
    volume: { m5: v.vol5m, h1: v.vol1h, h6: 200_000, h24: 900_000 },
    priceChange: { m5: v.pc5m, h1: v.pc1h, h6: 80, h24: 150 },
    liquidity: { usd: v.liq, base: 21_000_000, quote: 120 },
    fdv: v.fdv,
    marketCap: v.mcap,
    pairCreatedAt: NOW - v.ageMin * MIN,
    boosts: { active: 10 },
  };
}

function pairOf(mint: string, m: Partial<Metrics> = {}): DexPair {
  const p = normalizePair(rawPair(mint, m));
  assert.ok(p, 'paire de test invalide');
  return p;
}

const EXPECTED_SIGNALS = [
  'pic de volume ×4.2 (5 min : 18.2 k$ vs 4.3 k$ en moyenne)',
  'achats/ventes 5 min : 64/40 (×1.6)',
  'liquidité 52.0 k$, capitalisation 1.2 M$, âge 3 h 10',
  'prix +12.3 % sur 5 min, +40.1 % sur 1 h',
  'score organique Jupiter 72',
  'traders 5 min : 54',
  'sources : jup:toptrending:5m, dex:profiles',
];

// ---------------------------------------------------------------------------
// Faux clients
// ---------------------------------------------------------------------------

/** Http factice : enregistre les URL et vérifie qu'aucune requête n'en chevauche une autre. */
function recordingHttp(respond: (url: string) => unknown): { http: Http; urls: string[]; maxInFlight: () => number } {
  const urls: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const http: Http = {
    async getJson<T>(url: string): Promise<T> {
      urls.push(url);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise<void>((r) => setImmediate(r));
        return respond(url) as T;
      } finally {
        inFlight--;
      }
    },
    async postJson<T>(): Promise<T> {
      throw new Error('postJson non utilisé');
    },
  };
  return { http, urls, maxInFlight: () => maxInFlight };
}

/** Une valeur Error = la source échoue ; sinon la valeur est renvoyée telle quelle (même invalide). */
function fakeJupiter(o: { trending?: unknown; organic?: unknown; recent?: unknown } = {}): JupiterClient & { calls: string[] } {
  const calls: string[] = [];
  const answer = (v: unknown): Promise<JupiterToken[]> =>
    v instanceof Error ? Promise.reject(v) : Promise.resolve((v ?? []) as JupiterToken[]);
  const unused = (): Promise<never> => Promise.reject(new Error('non utilisé par le scanner'));
  return {
    calls,
    order: unused,
    execute: unused,
    tokensSearch: unused,
    prices: unused,
    tokensByCategory(category, interval) {
      calls.push(`${category}:${interval}`);
      return answer(category === 'toptrending' ? o.trending : category === 'toporganicscore' ? o.organic : undefined);
    },
    tokensRecent() {
      calls.push('recent');
      return answer(o.recent);
    },
  };
}

function fakeDex(
  o: { profiles?: unknown; boosts?: unknown; pairs?: DexPair[] | Error } = {},
): DexScreener & { pairCalls: Array<{ chainId: string; addresses: string[] }> } {
  const pairCalls: Array<{ chainId: string; addresses: string[] }> = [];
  const answer = (v: unknown): Promise<DexTokenRef[]> =>
    v instanceof Error ? Promise.reject(v) : Promise.resolve((v ?? []) as DexTokenRef[]);
  return {
    pairCalls,
    latestProfiles: () => answer(o.profiles),
    latestBoosts: () => answer(o.boosts),
    async pairsForTokens(chainId, addresses) {
      pairCalls.push({ chainId, addresses: [...addresses] });
      if (o.pairs instanceof Error) throw o.pairs;
      const wanted = new Set(addresses);
      return (o.pairs ?? []).filter((p) => wanted.has(p.baseToken.address));
    },
  };
}

const jup = (id: string, extra: Partial<JupiterToken> = {}): JupiterToken => ({ id, ...extra });
const ref = (tokenAddress: string, chainId = 'solana'): DexTokenRef => ({ chainId, tokenAddress });

function makeScanner(
  jupiter: JupiterClient,
  dex: DexScreener,
  scanner: Partial<ScannerConfig> = {},
  extra: Partial<ScannerDeps> = {},
): { clock: ReturnType<typeof fixedClock>; scanner: ReturnType<typeof createScanner> } {
  const clock = fixedClock(NOW);
  return { clock, scanner: createScanner({ jupiter, dex, clock, config: makeConfig(scanner), ...extra }) };
}

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

test('computeSpikeRatio : cas limites', () => {
  assert.equal(computeSpikeRatio(18_200, 65_500), 18_200 / 4_300);
  assert.equal(computeSpikeRatio(1_000, 1_000 + 11 * 1_000), 1); // volume régulier
  assert.equal(computeSpikeRatio(10, 21), 10); // moyenne exactement 1 $
  assert.equal(computeSpikeRatio(10, 20.9), 99); // moyenne < 1 $
  assert.equal(computeSpikeRatio(5_000, 5_000), 99); // toute l'heure dans les 5 dernières minutes
  assert.equal(computeSpikeRatio(5_000, 1_000), 99); // vol1h < vol5m (fenêtres décalées)
  assert.equal(computeSpikeRatio(1_000_000, 1_000_000 + 11 * 1_000), 99); // ×1000 plafonné
  assert.equal(computeSpikeRatio(0, 0), 0); // pas de volume : pas de pic
  assert.equal(computeSpikeRatio(0, 50_000), 0);
  assert.equal(computeSpikeRatio(-5, 100), 0);
  for (const [a, b] of [[NaN, 100], [100, NaN], [Infinity, 100], [100, Infinity], [-Infinity, 0]] as const) {
    assert.equal(computeSpikeRatio(a, b), 0, `${a}, ${b}`);
  }
});

test('computeScore : formule documentée, déterministe et jamais NaN', () => {
  assert.equal(computeScore({ spikeRatio: 18_200 / 4_300, buySellRatio: 1.6, organicScore: 72, liquidityUsd: 52_000 }), 11);
  assert.equal(computeScore({ spikeRatio: 4, buySellRatio: 2, organicScore: 100, liquidityUsd: 1_000_000 }), 4 + 2 + 4 + 3);
  // organique inconnu → 50 (2 points) ; achats/ventes plafonné à 3
  assert.equal(computeScore({ spikeRatio: 1, buySellRatio: 10, liquidityUsd: 10_000 }), 0 + 3 + 2 + 2);
  assert.equal(computeScore({ spikeRatio: 0.5, buySellRatio: 0, organicScore: 0, liquidityUsd: 0 }), 0);
  assert.ok(Number.isFinite(computeScore({ spikeRatio: NaN, buySellRatio: NaN, organicScore: NaN, liquidityUsd: NaN })));
});

test('formatUsd : montants compacts, point décimal', () => {
  assert.equal(formatUsd(0), '0 $');
  assert.equal(formatUsd(850.4), '850 $');
  assert.equal(formatUsd(999.4), '999 $');
  assert.equal(formatUsd(999.5), '1.0 k$');
  assert.equal(formatUsd(4_300), '4.3 k$');
  assert.equal(formatUsd(18_200), '18.2 k$');
  assert.equal(formatUsd(52_000), '52.0 k$');
  assert.equal(formatUsd(999_949), '999.9 k$');
  assert.equal(formatUsd(999_950), '1.0 M$');
  assert.equal(formatUsd(1_200_000), '1.2 M$');
  assert.equal(formatUsd(3_400_000_000), '3.4 Md$');
  assert.equal(formatUsd(-18_200), '-18.2 k$');
  assert.equal(formatUsd(NaN), '? $');
});

test('sanitizeText : injection de terminal, caractères invisibles, inversions du sens d’écriture', () => {
  assert.equal(sanitizeText('\u001b[2Jevil‮', 32), '[2Jevil');
  assert.equal(sanitizeText('\u009b31m\u0007ok\u007f', 32), '31mok'); // CSI C1, BEL, DEL
  assert.equal(sanitizeText('P​E‍P⁠E﻿', 32), 'PEPE');
  assert.equal(sanitizeText('⁦abc⁩ ‭xyz‬', 32), 'abc xyz');
  assert.equal(sanitizeText('ligne deux ', 32), 'lignedeux');
  assert.equal(sanitizeText('cach\u{e0068}\u{e0069}é', 32), 'caché'); // caractères « tag » (texte caché)
  assert.equal(sanitizeText('ㅤᅟ', 32), ''); // remplissages hangul invisibles
  assert.equal(sanitizeText('a\ud800b', 32), 'ab'); // demi-paire orpheline
  assert.equal(sanitizeText('  Pepe \n\t Coin   ', 64), 'Pepe Coin');

  // Tous les intervalles cités par la spécification, chacun suivi d'une lettre.
  const forbidden: number[] = [];
  const ranges = [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]] as const;
  for (const [lo, hi] of ranges) for (let c = lo; c <= hi; c++) forbidden.push(c);
  const dirty = forbidden.map((c) => `${String.fromCodePoint(c)}a`).join('');
  assert.equal(sanitizeText(dirty, 10_000), 'a'.repeat(forbidden.length));
});

test('sanitizeText : longueur plafonnée sans couper un emoji ; entrées non textuelles', () => {
  assert.equal(sanitizeText('x'.repeat(100), 32), 'x'.repeat(32));
  assert.equal(sanitizeText('y'.repeat(100), 64), 'y'.repeat(64));
  assert.equal(sanitizeText('🐸'.repeat(40), 32), '🐸'.repeat(32));
  assert.equal(sanitizeText('abc   def', 4), 'abc'); // pas d'espace final après la coupe
  assert.equal(sanitizeText(420, 32), '420');
  for (const v of [undefined, null, {}, [], NaN, true]) assert.equal(sanitizeText(v, 32), '');
  assert.equal(sanitizeText('abc', NaN), '');
  assert.equal(sanitizeText('abc', -1), '');
});

test('pickReferencePair : la plus liquide parmi les cotations acceptées, token en base seulement', () => {
  const solPair = pairOf(MINT, { liq: 30_000, pairAddress: address(3, 1) });
  const usdcPair = pairOf(MINT, { liq: 80_000, quoteSymbol: 'USDC', quoteAddress: USDC_MINT, pairAddress: address(3, 2) });
  const fooPair = pairOf(MINT, { liq: 900_000, quoteSymbol: 'FOO', quoteAddress: address(4, 1), pairAddress: address(3, 3) });
  const otherBase = pairOf(mintAt(9), { liq: 5_000_000, pairAddress: address(3, 4) });
  const all = [solPair, fooPair, usdcPair, otherBase];
  assert.equal(pickReferencePair(all, MINT, ['SOL', 'USDC'])?.pairAddress, usdcPair.pairAddress);
  assert.equal(pickReferencePair(all, MINT, ['SOL'])?.pairAddress, solPair.pairAddress);
  assert.equal(pickReferencePair([fooPair, otherBase], MINT, ['SOL', 'USDC']), undefined);
  assert.equal(pickReferencePair([], MINT, ['SOL']), undefined);
});

test('pickReferencePair : symbole insensible à la casse ; fausse cotation « SOL » refusée', () => {
  assert.ok(pickReferencePair([pairOf(MINT, { quoteSymbol: 'sol' })], MINT, ['Sol']));
  const fakeSol = pairOf(MINT, { quoteAddress: address(5, 1), liq: 10_000_000, pairAddress: address(3, 5) });
  const real = pairOf(MINT, { liq: 40_000 });
  assert.equal(pickReferencePair([fakeSol, real], MINT, ['SOL'])?.pairAddress, real.pairAddress);
  assert.equal(pickReferencePair([fakeSol], MINT, ['SOL']), undefined);
  // Symbole ajouté par l'utilisateur (hors table des adresses officielles) : vérifié par le nom seulement.
  const jupQuote = pairOf(MINT, { quoteSymbol: 'JUP', quoteAddress: address(6, 1), pairAddress: address(3, 6) });
  assert.ok(pickReferencePair([jupQuote], MINT, ['JUP']));
});

test('pickReferencePair : une liquidité inconnue passe après une liquidité connue', () => {
  const unknownLiq: DexPair = { ...pairOf(MINT, { pairAddress: address(3, 7) }), liquidityUsd: NaN };
  const known = pairOf(MINT, { liq: 1_000, pairAddress: address(3, 8) });
  assert.equal(pickReferencePair([unknownLiq, known], MINT, ['SOL'])?.pairAddress, known.pairAddress);
  assert.equal(pickReferencePair([unknownLiq], MINT, ['SOL'])?.pairAddress, unknownLiq.pairAddress);
});

test('evaluatePair : la paire type est retenue, chiffres et raisons lisibles', () => {
  const { candidate, rejectCodes } = evaluatePair(pairOf(MINT), NOW, SCAN, {
    sources: ['jup:toptrending:5m', 'dex:profiles'],
    organicScore: 72,
    traders5m: 54,
  });
  assert.deepEqual(rejectCodes, []);
  assert.deepEqual(candidate, {
    mint: MINT,
    symbol: 'PEPE2',
    name: 'Pepe Deux',
    pairAddress: pairAddressFor(MINT),
    dexId: 'raydium',
    quoteSymbol: 'SOL',
    priceUsd: 0.0012,
    liquidityUsd: 52_000,
    marketCapUsd: 1_200_000,
    pairCreatedAtMs: NOW - 190 * MIN,
    ageMinutes: 190,
    vol5mUsd: 18_200,
    vol1hUsd: 65_500,
    buys5m: 64,
    sells5m: 40,
    priceChange5mPct: 12.3,
    priceChange1hPct: 40.1,
    spikeRatio: 18_200 / 4_300,
    buySellRatio: 1.6,
    organicScore: 72,
    traders5m: 54,
    sources: ['jup:toptrending:5m', 'dex:profiles'],
    score: 11,
    signals: EXPECTED_SIGNALS,
    observedAt: '2026-11-08T16:00:00.000Z',
  });
  // Aucune valeur NaN / undefined : le candidat survit tel quel au journal JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(candidate)), candidate);
});

test('evaluatePair : bornes incluses, aucune vente → ratio = achats, données Jupiter invalides ignorées', () => {
  const edge: DexPair = { ...pairOf(MINT), liquidityUsd: 25_000, sells5m: 0, priceChange5mPct: 30, pairCreatedAtMs: NOW - 30 * MIN };
  const { candidate, rejectCodes } = evaluatePair(edge, NOW, SCAN, { sources: [], organicScore: 150, traders5m: -1 });
  assert.deepEqual(rejectCodes, []);
  assert.ok(candidate);
  assert.equal(candidate.buySellRatio, 64);
  assert.ok(candidate.signals.includes('achats/ventes 5 min : 64/0 (×64.0)'));
  assert.ok(candidate.signals.some((s) => s.endsWith('âge 30 min')));
  assert.equal('organicScore' in candidate, false);
  assert.equal('traders5m' in candidate, false);
  assert.equal(candidate.signals.some((s) => s.startsWith('sources') || s.startsWith('score organique')), false);
});

test('evaluatePair : repli sur la FDV et formats d’âge', () => {
  const fdvOnly = evaluatePair({ ...pairOf(MINT), marketCapUsd: NaN }, NOW, SCAN, { sources: [] }).candidate;
  assert.ok(fdvOnly);
  assert.equal(fdvOnly.marketCapUsd, 1_300_000);
  assert.ok(fdvOnly.signals.includes('liquidité 52.0 k$, FDV 1.3 M$, âge 3 h 10'));
  const zeroCap = evaluatePair({ ...pairOf(MINT), marketCapUsd: 0 }, NOW, SCAN, { sources: [] }).candidate;
  assert.equal(zeroCap?.marketCapUsd, 1_300_000); // capitalisation 0 = absente
  const old = evaluatePair(pairOf(MINT, { ageMin: 50 * 60 + 5 }), NOW, SCAN, { sources: [] }).candidate;
  assert.ok(old?.signals.some((s) => s.endsWith('âge 2 j 2 h')));
});

{
  const base = pairOf(MINT);
  const cases: Array<{ label: string; pair: DexPair; codes: string[]; cfg?: Partial<ScannerConfig>; now?: number }> = [
    { label: 'liquidité absente', pair: { ...base, liquidityUsd: NaN }, codes: ['MISSING_DATA'] },
    { label: 'volume 5 min absent', pair: { ...base, vol5mUsd: NaN }, codes: ['MISSING_DATA'] },
    { label: 'volume 1 h absent', pair: { ...base, vol1hUsd: NaN }, codes: ['MISSING_DATA'] },
    { label: 'achats 5 min absents', pair: { ...base, buys5m: NaN }, codes: ['MISSING_DATA'] },
    { label: 'ventes 5 min absentes', pair: { ...base, sells5m: NaN }, codes: ['MISSING_DATA'] },
    { label: 'date de création absente', pair: { ...base, pairCreatedAtMs: NaN }, codes: ['MISSING_DATA'] },
    { label: 'prix USD absent', pair: { ...base, priceUsd: NaN }, codes: ['MISSING_DATA'] },
    { label: 'prix USD nul', pair: { ...base, priceUsd: 0 }, codes: ['MISSING_DATA'] },
    { label: 'variation 5 min absente', pair: { ...base, priceChange5mPct: NaN }, codes: ['MISSING_DATA'] },
    { label: 'variation 1 h absente', pair: { ...base, priceChange1hPct: NaN }, codes: ['MISSING_DATA'] },
    { label: 'ni capitalisation ni FDV', pair: { ...base, marketCapUsd: NaN, fdvUsd: NaN }, codes: ['MISSING_DATA'] },
    { label: 'volume négatif', pair: { ...base, vol5mUsd: -5 }, codes: ['MISSING_DATA'] },
    { label: 'adresse de paire invalide', pair: { ...base, pairAddress: '../../latest' }, codes: ['MISSING_DATA'] },
    { label: 'horloge invalide', pair: base, now: NaN, codes: ['MISSING_DATA'] },
    { label: 'liquidité 10 k$', pair: { ...base, liquidityUsd: 10_000 }, codes: ['LOW_LIQUIDITY'] },
    { label: 'paire de 10 min', pair: { ...base, pairCreatedAtMs: NOW - 10 * MIN }, codes: ['TOO_YOUNG'] },
    { label: 'paire datée dans le futur', pair: { ...base, pairCreatedAtMs: NOW + 5 * MIN }, codes: ['TOO_YOUNG'] },
    { label: 'paire de 100 h', pair: { ...base, pairCreatedAtMs: NOW - 100 * 60 * MIN }, codes: ['TOO_OLD'] },
    { label: 'capitalisation 60 M$', pair: { ...base, marketCapUsd: 60_000_000 }, codes: ['MCAP_OUT_OF_RANGE'] },
    { label: 'repli sur une FDV de 50 k$', pair: { ...base, marketCapUsd: NaN, fdvUsd: 50_000 }, codes: ['MCAP_OUT_OF_RANGE'] },
    { label: 'volume 5 min de 3 k$', pair: { ...base, vol5mUsd: 3_000, vol1hUsd: vol1hFor(3_000, 6) }, codes: ['LOW_VOLUME'] },
    { label: 'pic ×1.8', pair: { ...base, vol1hUsd: 18_200 + 11 * 10_000 }, codes: ['NO_SPIKE'] },
    { label: '10 achats', pair: { ...base, buys5m: 10, sells5m: 5 }, codes: ['FEW_BUYS'] },
    { label: 'achats/ventes 64/60', pair: { ...base, sells5m: 60 }, codes: ['SELL_PRESSURE'] },
    { label: '+45 % en 5 min', pair: { ...base, priceChange5mPct: 45 }, codes: ['PRICE_TOO_HOT'] },
    { label: '-3 % en 5 min', pair: { ...base, priceChange5mPct: -3 }, codes: ['PRICE_FALLING'] },
    { label: 'seuil de configuration NaN', pair: base, cfg: { minLiquidityUsd: NaN }, codes: ['LOW_LIQUIDITY'] },
    {
      label: 'plusieurs motifs à la fois',
      pair: { ...base, liquidityUsd: 10_000, pairCreatedAtMs: NOW - 10 * MIN, vol1hUsd: 18_200 + 11 * 10_000, priceChange5mPct: 45 },
      codes: ['LOW_LIQUIDITY', 'TOO_YOUNG', 'NO_SPIKE', 'PRICE_TOO_HOT'],
    },
    {
      label: 'donnée absente + seuil franchi',
      pair: { ...base, priceUsd: NaN, sells5m: 60 },
      codes: ['MISSING_DATA', 'SELL_PRESSURE'],
    },
  ];
  for (const c of cases) {
    test(`evaluatePair : ${c.codes.join(' + ')} (${c.label})`, () => {
      const res = evaluatePair(c.pair, c.now ?? NOW, { ...SCAN, ...c.cfg }, { sources: ['jup:recent'] });
      assert.deepEqual(res.rejectCodes, c.codes);
      assert.equal(res.candidate, undefined);
    });
  }
}

// ---------------------------------------------------------------------------
// Client DexScreener
// ---------------------------------------------------------------------------

test('normalizePair : nombres en chaîne convertis, absents en NaN (jamais 0), identité exigée', () => {
  const raw = rawPair(MINT);
  const p = normalizePair(raw);
  assert.ok(p);
  assert.equal(p.priceUsd, 0.0012);
  assert.equal(p.priceNative, 0.0000081);
  assert.equal(p.liquidityUsd, 52_000);
  assert.equal(p.vol5mUsd, 18_200);
  assert.equal(p.vol24hUsd, 900_000);
  assert.equal(p.buys5m, 64);
  assert.equal(p.sells24h, 5_000);
  assert.equal(p.priceChange24hPct, 150);
  assert.equal(p.marketCapUsd, 1_200_000);
  assert.equal(p.fdvUsd, 1_300_000);
  assert.equal(p.pairCreatedAtMs, NOW - 190 * MIN);
  assert.equal(p.boostsActive, 10);
  assert.deepEqual(p.baseToken, { address: MINT, name: 'Pepe Deux', symbol: 'PEPE2' });
  assert.deepEqual(p.labels, ['v4']);

  const holes = normalizePair({
    ...raw,
    priceUsd: null,
    liquidity: { usd: null, base: '', quote: true },
    volume: { m5: '', h1: 'abc', h6: '  ' },
    txns: { m5: { buys: null }, h1: 'texte' },
    priceChange: undefined,
    marketCap: 'Infinity',
    fdv: [],
    pairCreatedAt: {},
    boosts: null,
    labels: ['ok', 3, null],
  });
  assert.ok(holes);
  const numeric = ['priceUsd', 'liquidityUsd', 'liquidityBase', 'liquidityQuote', 'vol5mUsd', 'vol1hUsd', 'vol6hUsd',
    'buys5m', 'sells5m', 'buys1h', 'priceChange5mPct', 'priceChange1hPct', 'marketCapUsd', 'fdvUsd', 'pairCreatedAtMs',
    'boostsActive'] as const;
  for (const k of numeric) assert.ok(Number.isNaN(holes[k]), `${k} devrait être NaN`);
  assert.deepEqual(holes.labels, ['ok']);

  assert.equal(normalizePair(null), null);
  assert.equal(normalizePair([]), null);
  assert.equal(normalizePair('paire'), null);
  assert.equal(normalizePair({ ...raw, pairAddress: undefined }), null);
  assert.equal(normalizePair({ ...raw, baseToken: { symbol: 'X' } }), null);
});

test('DexScreener : profils et boosts récents (URL, lecture défensive)', async () => {
  const h = recordingHttp((url) => {
    if (url.endsWith('/token-profiles/latest/v1')) {
      return [
        { url: 'https://dexscreener.com/solana/x', chainId: 'solana', tokenAddress: MINT, icon: 'x', description: 'd' },
        { chainId: 'ethereum', tokenAddress: '0xabc' },
        { chainId: 'solana' },
        null,
        'texte',
      ];
    }
    // Ancienne documentation : un objet seul au lieu d'une liste.
    if (url.endsWith('/token-boosts/latest/v1')) return { chainId: 'solana', tokenAddress: mintAt(2), amount: 10, totalAmount: 50 };
    throw new Error(`URL inattendue : ${url}`);
  });
  const dex = createDexScreener({ http: h.http, baseUrl: `${BASE_URL}/` });
  assert.deepEqual(await dex.latestProfiles(), [ref(MINT), ref('0xabc', 'ethereum')]);
  assert.deepEqual(await dex.latestBoosts(), [ref(mintAt(2))]);
  assert.deepEqual(h.urls, [`${BASE_URL}/token-profiles/latest/v1`, `${BASE_URL}/token-boosts/latest/v1`]);
});

test('DexScreener : une réponse de forme inconnue est une erreur, pas une liste vide', async () => {
  for (const body of ['<html>bloqué</html>', null, { error: 'rate limited' }, 42]) {
    const dex = createDexScreener({ http: recordingHttp(() => body).http, baseUrl: BASE_URL });
    await assert.rejects(dex.latestProfiles(), /réponse inattendue/);
    await assert.rejects(dex.latestBoosts(), /réponse inattendue/);
    await assert.rejects(dex.pairsForTokens('solana', [MINT]), /réponse inattendue/);
  }
});

test(`DexScreener : paires par lots de ${DEX_MAX_ADDRESSES_PER_CALL}, l'un après l'autre, adresses dédoublonnées`, async () => {
  const prefix = `${BASE_URL}/tokens/v1/solana/`;
  const mints = Array.from({ length: 65 }, (_, i) => mintAt(i));
  // Le faux serveur ne fabrique de paire que pour des adresses base58 valides.
  const h = recordingHttp((url) =>
    url
      .slice(prefix.length)
      .split(',')
      .map((m) => decodeURIComponent(m))
      .filter((m) => /^[1-9A-HJ-NP-Za-km-z]+$/.test(m))
      .map((m) => rawPair(m)),
  );
  const dex = createDexScreener({ http: h.http, baseUrl: BASE_URL });

  const pairs = await dex.pairsForTokens('solana', [...mints, ...mints.slice(0, 2)]);
  assert.equal(h.urls.length, 3);
  assert.ok(h.urls.every((u) => u.startsWith(prefix)));
  const batches = h.urls.map((u) => u.slice(prefix.length).split(','));
  assert.deepEqual(batches.map((b) => b.length), [30, 30, 5]);
  assert.deepEqual(batches.flat(), mints);
  assert.equal(h.maxInFlight(), 1);
  assert.deepEqual(pairs.map((p) => p.baseToken.address), mints);

  assert.deepEqual(await dex.pairsForTokens('solana', []), []);
  assert.equal(h.urls.length, 3); // liste vide : aucun appel

  await dex.pairsForTokens('solana', ['a/b?c=1', MINT]);
  assert.equal(h.urls.at(-1), `${prefix}a%2Fb%3Fc%3D1,${MINT}`); // jamais de sortie du chemin
});

test('DexScreener : tableau nu, { pairs: [...] } ou { pairs: null } ; une paire en double gardée une fois', async () => {
  const shared = rawPair(MINT);
  const bodies: Array<[unknown, number]> = [
    [[shared, shared, { junk: true }], 1],
    [{ schemaVersion: '1.0.0', pairs: [shared] }, 1],
    [{ schemaVersion: '1.0.0', pairs: null }, 0],
  ];
  for (const [body, count] of bodies) {
    const dex = createDexScreener({ http: recordingHttp(() => body).http, baseUrl: BASE_URL });
    assert.equal((await dex.pairsForTokens('solana', [MINT])).length, count);
  }
  // Même paire renvoyée par deux lots différents (ses deux tokens demandés) : une seule fois.
  const twoBatches = createDexScreener({ http: recordingHttp(() => [shared]).http, baseUrl: BASE_URL });
  const pairs = await twoBatches.pairsForTokens('solana', Array.from({ length: 31 }, (_, i) => mintAt(i)));
  assert.equal(pairs.length, 1);
});

test('DexScreener : un lot en échec fait échouer l’appel (les suivants ne partent pas)', async () => {
  let n = 0;
  const h = recordingHttp((url) => {
    n++;
    if (n === 2) throw new HttpError(`GET ${url} → HTTP 429`, 429, url, null, true);
    return [];
  });
  const dex = createDexScreener({ http: h.http, baseUrl: BASE_URL });
  await assert.rejects(
    dex.pairsForTokens('solana', Array.from({ length: 70 }, (_, i) => mintAt(i))),
    (e: unknown) => e instanceof HttpError && e.status === 429,
  );
  assert.equal(h.urls.length, 2);
});

// ---------------------------------------------------------------------------
// scan()
// ---------------------------------------------------------------------------

test('scan : collecte, dédoublonnage, filtre de chaîne, données Jupiter gardées, horloge', async () => {
  const A = mintAt(10);
  const B = mintAt(11);
  const C = mintAt(12);
  const D = mintAt(13);
  const jupiter = fakeJupiter({
    trending: [jup(A, { organicScore: 72, stats5m: { numTraders: 54 } }), jup(B)],
    organic: [jup(A, { organicScore: 10, stats5m: { numTraders: 3 } }), jup(C, { organicScore: 150 })],
    recent: [jup(C), { symbol: 'sans id' }, null],
  });
  const dex = fakeDex({
    profiles: [ref(A), ref(D, 'ethereum')],
    boosts: [ref(B), ref(B)],
    pairs: [pairOf(A), pairOf(B, { liq: 40_000 }), pairOf(C, { liq: 30_000 })],
  });
  const { clock, scanner } = makeScanner(jupiter, dex);
  const r = await scanner.scan();

  assert.equal(r.at, clock.iso());
  assert.deepEqual(jupiter.calls, ['toptrending:5m', 'toporganicscore:5m', 'recent']);
  assert.deepEqual(r.sourcesOk, [...SCAN_SOURCES, PAIRS_SOURCE]);
  assert.deepEqual(r.sourcesFailed, []);
  assert.equal(r.examined, 3); // D est sur une autre chaîne
  assert.deepEqual(r.rejectedCounts, {});
  assert.deepEqual(dex.pairCalls, [{ chainId: 'solana', addresses: [A, B, C] }]);
  assert.deepEqual(r.candidates.map((c) => c.mint), [A, B, C]);

  const [ca, cb, cc] = r.candidates;
  assert.ok(ca && cb && cc);
  assert.deepEqual(ca.sources, ['jup:toptrending:5m', 'jup:toporganicscore:5m', 'dex:profiles']);
  assert.equal(ca.organicScore, 72); // première valeur valide gardée
  assert.equal(ca.traders5m, 54);
  assert.ok(ca.signals.includes('score organique Jupiter 72'));
  assert.ok(ca.signals.includes('sources : jup:toptrending:5m, jup:toporganicscore:5m, dex:profiles'));
  assert.deepEqual(cb.sources, ['jup:toptrending:5m', 'dex:boosts']);
  assert.deepEqual(cc.sources, ['jup:toporganicscore:5m', 'jup:recent']);
  assert.equal('organicScore' in cc, false); // 150 : hors bornes, ignoré
  for (const c of r.candidates) assert.equal(c.observedAt, r.at);
});

test('scan : une source en échec ne fait pas échouer le scan (onSourceError prévenu)', async () => {
  const A = mintAt(20);
  const boom = new HttpError('GET https://api.jup.ag/tokens/v2/toptrending/5m → HTTP 500', 500, 'u', null, true);
  const errors: Array<[string, unknown]> = [];
  const jupiter = fakeJupiter({ trending: boom, recent: { pas: 'une liste' } });
  const dex = fakeDex({ profiles: [ref(A)], pairs: [pairOf(A)] });
  const { scanner } = makeScanner(jupiter, dex, {}, {
    onSourceError: (source, error) => {
      errors.push([source, error]);
      throw new Error('journal en panne'); // ignoré par le scanner
    },
  });
  const r = await scanner.scan();
  assert.deepEqual(r.sourcesFailed, ['jup:toptrending:5m', 'jup:recent']);
  assert.deepEqual(r.sourcesOk, ['jup:toporganicscore:5m', 'dex:profiles', 'dex:boosts', PAIRS_SOURCE]);
  assert.deepEqual(r.candidates.map((c) => c.mint), [A]);
  assert.deepEqual(errors.map(([s]) => s), ['jup:toptrending:5m', 'jup:recent']);
  assert.equal(errors[0]?.[1], boom);
});

test('scan : toutes les sources en échec → aucun candidat, aucune requête de paires', async () => {
  const err = new Error('réseau coupé');
  const jupiter: JupiterClient = {
    ...fakeJupiter({ trending: err, organic: err }),
    tokensRecent: () => {
      throw new Error('exception synchrone');
    },
  };
  const dex = fakeDex({ profiles: err, boosts: err, pairs: [pairOf(MINT)] });
  const { scanner } = makeScanner(jupiter, dex);
  const r = await scanner.scan();
  assert.deepEqual(r.candidates, []);
  assert.equal(r.examined, 0);
  assert.deepEqual(r.sourcesOk, []);
  assert.deepEqual(r.sourcesFailed, [...SCAN_SOURCES]);
  assert.deepEqual(r.rejectedCounts, {});
  assert.equal(dex.pairCalls.length, 0);
});

test('scan : exclusions respectées, SOL / USDC / USDT jamais examinés ni demandés', async () => {
  const A = mintAt(30);
  const X = mintAt(31);
  const jupiter = fakeJupiter({ trending: [jup(SOL_MINT), jup(USDC_MINT), jup(A), jup(X)], recent: [jup(USDT_MINT)] });
  const dex = fakeDex({ boosts: [ref(X), ref(SOL_MINT)], pairs: [pairOf(A), pairOf(X), pairOf(SOL_MINT)] });
  const { scanner } = makeScanner(jupiter, dex);
  const exclude = new Set([X]);
  const r = await scanner.scan(exclude);
  assert.equal(r.examined, 1);
  assert.deepEqual(dex.pairCalls.map((c) => c.addresses), [[A]]);
  assert.deepEqual(r.candidates.map((c) => c.mint), [A]);
  assert.deepEqual(r.rejectedCounts, {});
  assert.deepEqual([...exclude], [X]); // l'ensemble passé n'est pas modifié
});

test('scan : chaque code compté une fois par token ; NO_PAIR, QUOTE_NOT_ALLOWED, INVALID_MINT', async () => {
  const ok = mintAt(40);
  const young = mintAt(41);
  const young2 = mintAt(42);
  const noPair = mintAt(43);
  const fooOnly = mintAt(44);
  const bad = 'pas/une/adresse?x=1';
  const jupiter = fakeJupiter({ trending: [jup(ok), jup(young), jup(young2), jup(noPair), jup(fooOnly), jup(bad)] });
  const dex = fakeDex({
    pairs: [
      pairOf(ok),
      pairOf(young, { ageMin: 5, liq: 1_000 }),
      // deux paires pour un même token : seule la référence (la plus liquide) est évaluée
      pairOf(young2, { ageMin: 5, pairAddress: address(3, 40) }),
      pairOf(young2, { ageMin: 5, liq: 2_000, pairAddress: address(3, 41) }),
      pairOf(fooOnly, { quoteSymbol: 'FOO', quoteAddress: address(4, 2) }),
    ],
  });
  const { scanner } = makeScanner(jupiter, dex);
  const r = await scanner.scan();
  assert.equal(r.examined, 6);
  assert.deepEqual(r.rejectedCounts, { INVALID_MINT: 1, NO_PAIR: 1, QUOTE_NOT_ALLOWED: 1, TOO_YOUNG: 2, LOW_LIQUIDITY: 1 });
  assert.deepEqual(r.candidates.map((c) => c.mint), [ok]);
  assert.deepEqual(dex.pairCalls[0]?.addresses, [ok, young, young2, noPair, fooOnly]); // jamais l'adresse invalide
});

test('scan : tri par score décroissant, maxCandidates respecté, le reste compté RANKED_OUT', async () => {
  const mints = Array.from({ length: 8 }, (_, i) => mintAt(50 + i));
  const jupiter = fakeJupiter({ trending: mints.map((m) => jup(m)) });
  // pic ×3.5, ×4.5 … ×10.5 : le score croît avec l'indice ; ordre d'arrivée volontairement inverse
  const dex = fakeDex({ pairs: mints.map((m, i) => pairOf(m, { vol1h: vol1hFor(18_200, 3.5 + i) })) });
  const { scanner } = makeScanner(jupiter, dex, { maxCandidates: 3 });
  const r = await scanner.scan();
  assert.deepEqual(r.candidates.map((c) => c.mint), [mints[7], mints[6], mints[5]]);
  const scores = r.candidates.map((c) => c.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  assert.ok((scores[0] ?? 0) > (scores[2] ?? 0));
  assert.equal(r.examined, 8);
  assert.deepEqual(r.rejectedCounts, { RANKED_OUT: 5 });
});

test('scan : paires DexScreener indisponibles → aucun candidat, code distinct, pas d’exception', async () => {
  const A = mintAt(60);
  const B = mintAt(61);
  const errors: string[] = [];
  const jupiter = fakeJupiter({ trending: [jup(A), jup(B)] });
  const dex = fakeDex({ pairs: new HttpError('GET … → HTTP 503', 503, 'u', null, true) });
  const { scanner } = makeScanner(jupiter, dex, {}, { onSourceError: (s) => errors.push(s) });
  const r = await scanner.scan();
  assert.deepEqual(r.candidates, []);
  assert.equal(r.examined, 2);
  assert.deepEqual(r.rejectedCounts, { PAIRS_UNAVAILABLE: 2 });
  assert.deepEqual(r.sourcesFailed, [PAIRS_SOURCE]);
  assert.deepEqual(errors, [PAIRS_SOURCE]);
});

test('scan : symbole et nom écrits par des inconnus sont nettoyés dans le candidat', async () => {
  const A = mintAt(70);
  const jupiter = fakeJupiter({ trending: [jup(A)] });
  const symbol = '\u001b[2J\u001b[31mRUG‮';
  const name = `Nom​ ${'très long '.repeat(20)}`;
  const dex = fakeDex({ pairs: [pairOf(A, { symbol, name })] });
  const { scanner } = makeScanner(jupiter, dex);
  const [c] = (await scanner.scan()).candidates;
  assert.ok(c);
  assert.equal(c.symbol, '[2J[31mRUG');
  assert.ok(Array.from(c.name).length <= 64);
  assert.ok(c.name.startsWith('Nom très long'));
  assert.doesNotMatch(c.symbol + c.name, /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/);
});

test('scan + vrai client DexScreener : 40 tokens → 2 requêtes de paires (30 + 10)', async () => {
  const prefix = `${BASE_URL}/tokens/v1/solana/`;
  const mints = Array.from({ length: 40 }, (_, i) => mintAt(100 + i));
  const h = recordingHttp((url) => {
    if (url.endsWith('/token-profiles/latest/v1') || url.endsWith('/token-boosts/latest/v1')) return [];
    if (url.startsWith(prefix)) return url.slice(prefix.length).split(',').map((m) => rawPair(decodeURIComponent(m)));
    throw new Error(`URL inattendue : ${url}`);
  });
  const dex = createDexScreener({ http: h.http, baseUrl: BASE_URL });
  // Deux sources qui se recouvrent (15 mints en commun) : 40 tokens uniques.
  const jupiter = fakeJupiter({ trending: mints.slice(0, 25).map((m) => jup(m)), recent: mints.slice(10).map((m) => jup(m)) });
  const { scanner } = makeScanner(jupiter, dex);
  const r = await scanner.scan();
  const pairUrls = h.urls.filter((u) => u.startsWith(prefix));
  assert.deepEqual(pairUrls.map((u) => u.slice(prefix.length).split(',').length), [30, 10]);
  assert.deepEqual(pairUrls.flatMap((u) => u.slice(prefix.length).split(',')), mints);
  assert.equal(r.examined, 40);
  assert.equal(r.candidates.length, 5);
  assert.deepEqual(r.rejectedCounts, { RANKED_OUT: 35 });
  assert.deepEqual(r.sourcesFailed, []);
});

test(`scan : au plus ${MAX_MINTS_PER_SCAN} tokens demandés par scan, le reste compté SCAN_LIMIT`, async () => {
  const mints = Array.from({ length: MAX_MINTS_PER_SCAN + 5 }, (_, i) => mintAt(1_000 + i));
  const jupiter = fakeJupiter({ trending: mints.map((m) => jup(m)) });
  const dex = fakeDex({ pairs: [] });
  const { scanner } = makeScanner(jupiter, dex);
  const r = await scanner.scan();
  assert.equal(r.examined, MAX_MINTS_PER_SCAN + 5);
  assert.deepEqual(dex.pairCalls.map((c) => c.addresses.length), [MAX_MINTS_PER_SCAN]);
  assert.deepEqual(r.rejectedCounts, { NO_PAIR: MAX_MINTS_PER_SCAN, SCAN_LIMIT: 5 });
});
