/**
 * Tests du filtre anti-rug (src/workers/rugcheck.ts) et du client RugCheck (src/lib/rugcheckApi.ts).
 * Aucun réseau : RugCheck, Jupiter et HTTP sont remplacés par des faux.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { loadConfig } from '../src/config.ts';
import type { Config, RugConfig } from '../src/config.ts';
import { HttpError, createHttp } from '../src/lib/http.ts';
import type { Http, RequestOptions } from '../src/lib/http.ts';
import type { JupiterClient, JupiterOrder, JupiterToken, OrderParams } from '../src/lib/jupiter.ts';
import { createRugcheckApi, parseRugcheckSummary } from '../src/lib/rugcheckApi.ts';
import type { RugcheckApi, RugcheckRisk, RugcheckSummary } from '../src/lib/rugcheckApi.ts';
import { fixedClock } from '../src/lib/store.ts';
import { SOL_MINT } from '../src/types.ts';
import type { RugVerdict, TokenCandidate } from '../src/types.ts';
import {
  createRugChecker,
  evaluateJupiterAudit,
  evaluateRugcheckSummary,
  roundTripCostPct,
} from '../src/workers/rugcheck.ts';

// ---------------------------------------------------------------------------
// Données de test
// ---------------------------------------------------------------------------

const START = Date.UTC(2026, 10, 8, 16, 0, 0);
const MINT = `MemeToken${'1'.repeat(35)}`;
/** Second mint valide (base58 : ni 0, ni O, ni I, ni l). */
const OTHER_MINT = `SecondMint${'1'.repeat(34)}`;
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKENS_OUT = '123456789000';
const HEALTHY_BACK = '294000000'; // 0.294 SOL récupérés sur 0.3 : coût 2 %

const RUG: RugConfig = {
  maxTopHoldersPct: 30,
  maxRugcheckWarnings: 2,
  maxRoundTripCostPct: 5,
  roundTripProbeSol: 0.3,
  minOrganicScore: 30,
  blockedRiskNames: ['freeze authority', 'mint authority', 'permanent delegate', 'transfer fee', 'copycat', 'honeypot'],
  cacheMinutes: 10,
};

const BASE_CONFIG = loadConfig({ JUPITER_API_KEY: 'cle-de-test' }, '/tmp/solbot-test');

function makeConfig(rug: Partial<RugConfig> = {}): Config {
  return { ...BASE_CONFIG, rug: { ...RUG, ...rug } };
}

function candidate(mint = MINT): TokenCandidate {
  return {
    mint,
    symbol: 'MEME',
    name: 'Meme Token',
    pairAddress: `Pair${'1'.repeat(40)}`,
    dexId: 'raydium',
    quoteSymbol: 'SOL',
    priceUsd: 0.0012,
    liquidityUsd: 80_000,
    marketCapUsd: 1_200_000,
    pairCreatedAtMs: START - 3 * 3_600_000,
    ageMinutes: 180,
    vol5mUsd: 25_000,
    vol1hUsd: 60_000,
    buys5m: 120,
    sells5m: 60,
    priceChange5mPct: 8,
    priceChange1hPct: 20,
    spikeRatio: 5,
    buySellRatio: 2,
    sources: ['jup:toptrending:5m'],
    score: 1,
    signals: [],
    observedAt: new Date(START).toISOString(),
  };
}

function risk(name: string, level: string, value = ''): RugcheckRisk {
  return { name, value, description: `description de ${name}`, score: 100, level };
}

function healthySummary(): RugcheckSummary {
  return {
    mint: MINT,
    tokenProgram: TOKEN_PROGRAM,
    tokenType: '',
    risks: [risk('Mutable metadata', 'warn')],
    score: 101,
    score_normalised: 1,
    lpLockedPct: 99.5,
  };
}

function summaryWith(risks: RugcheckRisk[], extra: Partial<RugcheckSummary> = {}): RugcheckSummary {
  return { ...healthySummary(), risks, ...extra };
}

function healthyToken(audit: Partial<NonNullable<JupiterToken['audit']>> = {}, extra: Partial<JupiterToken> = {}): JupiterToken {
  return {
    id: MINT,
    symbol: 'MEME',
    organicScore: 72.5,
    isVerified: false,
    audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 18.4, ...audit },
    ...extra,
  };
}

function quote(p: OrderParams, outAmount: string | undefined, extra: Partial<JupiterOrder> = {}): JupiterOrder {
  const q: JupiterOrder = {
    requestId: `req-${p.inputMint.slice(0, 6)}`,
    transaction: null,
    inputMint: p.inputMint,
    outputMint: p.outputMint,
    inAmount: p.amount,
    router: 'iris',
    feeBps: 50,
    ...extra,
  };
  if (outAmount !== undefined) q.outAmount = outAmount;
  return q;
}

/** Devis d'aller-retour : `tokensOut` à l'achat, `lamportsBack` à la revente. */
function roundTrip(
  tokensOut: string | undefined,
  lamportsBack: string | undefined,
  extra: { buy?: Partial<JupiterOrder>; sell?: Partial<JupiterOrder> } = {},
): (p: OrderParams) => Promise<JupiterOrder> {
  return async (p) => (p.inputMint === SOL_MINT ? quote(p, tokensOut, extra.buy) : quote(p, lamportsBack, extra.sell));
}

// ---------------------------------------------------------------------------
// Faux services
// ---------------------------------------------------------------------------

function fakeRugcheck(impl: (mint: string) => Promise<RugcheckSummary> = async () => healthySummary()): RugcheckApi & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    async summary(mint) {
      calls.push(mint);
      return impl(mint);
    },
  };
}

function fakeJupiter(
  opts: { search?: (mints: string[]) => Promise<JupiterToken[]>; order?: (p: OrderParams) => Promise<JupiterOrder> } = {},
): JupiterClient & { orders: OrderParams[]; searches: string[][] } {
  const orders: OrderParams[] = [];
  const searches: string[][] = [];
  const search = opts.search ?? (async () => [healthyToken()]);
  const order = opts.order ?? roundTrip(TOKENS_OUT, HEALTHY_BACK);
  const unexpected = async (): Promise<never> => {
    throw new Error('appel inattendu dans le test');
  };
  return {
    orders,
    searches,
    async order(p) {
      orders.push({ ...p });
      return order(p);
    },
    async tokensSearch(mints) {
      searches.push([...mints]);
      return search(mints);
    },
    execute: unexpected,
    tokensByCategory: unexpected,
    tokensRecent: unexpected,
    prices: unexpected,
  };
}

function setup(
  o: {
    rug?: Partial<RugConfig>;
    summary?: (mint: string) => Promise<RugcheckSummary>;
    search?: (mints: string[]) => Promise<JupiterToken[]>;
    order?: (p: OrderParams) => Promise<JupiterOrder>;
    timeoutMs?: number;
  } = {},
) {
  const clock = fixedClock(START);
  const rugcheck = fakeRugcheck(o.summary);
  const jupiter = fakeJupiter({ search: o.search, order: o.order });
  const checker = createRugChecker({ rugcheck, jupiter, clock, config: makeConfig(o.rug), timeoutMs: o.timeoutMs });
  return { clock, rugcheck, jupiter, checker };
}

function group(v: RugVerdict, key: string): Record<string, unknown> {
  const g = v.details[key];
  assert.ok(g !== null && typeof g === 'object', `details.${key} absent`);
  return g as Record<string, unknown>;
}

function rugcheckHttpError(status: number, body: unknown = null): HttpError {
  const url = `https://api.rugcheck.xyz/v1/tokens/${MINT}/report/summary`;
  return new HttpError(`GET ${url} → HTTP ${status}`, status, url, body, status >= 500);
}

// ---------------------------------------------------------------------------
// roundTripCostPct
// ---------------------------------------------------------------------------

describe('roundTripCostPct', () => {
  test('(1 − retour/mise) × 100, arrondi au centième', () => {
    assert.equal(roundTripCostPct(300_000_000n, 276_000_000n), 8);
    assert.equal(roundTripCostPct(300_000_000n, 276_600_000n), 7.8);
    assert.equal(roundTripCostPct(300_000_000n, 294_000_000n), 2);
    assert.equal(roundTripCostPct(1_000_000_000n, 1_000_000_000n), 0);
    assert.equal(roundTripCostPct(3n, 2n), 33.33);
    assert.equal(roundTripCostPct(3n, 1n), 66.67);
    assert.equal(roundTripCostPct(300_000_000n, 0n), 100);
    assert.equal(roundTripCostPct(100n, 101n), -1);
    assert.equal(roundTripCostPct(10_000n, 9_999n), 0.01);
    assert.equal(roundTripCostPct(20_000n, 19_999n), 0.01); // 0.005 % arrondi vers le haut
  });

  test('mise nulle ou négative → erreur', () => {
    assert.throws(() => roundTripCostPct(0n, 0n), RangeError);
    assert.throws(() => roundTripCostPct(-5n, 1n), RangeError);
  });
});

// ---------------------------------------------------------------------------
// evaluateRugcheckSummary
// ---------------------------------------------------------------------------

describe('evaluateRugcheckSummary', () => {
  test('résumé propre : aucun rejet, chaque « warn » devient un avertissement', () => {
    const r = evaluateRugcheckSummary(healthySummary(), RUG);
    assert.deepEqual(r, { rejectCodes: [], reasons: [], warnings: ['RugCheck avertissement : Mutable metadata'] });
    assert.deepEqual(evaluateRugcheckSummary(summaryWith([]), RUG), { rejectCodes: [], reasons: [], warnings: [] });
  });

  test('risque « danger » (casse indifférente) → RUGCHECK_DANGER, une raison par risque, code unique', () => {
    const r = evaluateRugcheckSummary(
      summaryWith([risk('Low Liquidity', 'DANGER'), risk('Large Amount of LP Unlocked', ' danger ', '100.00%')]),
      RUG,
    );
    assert.deepEqual(r.rejectCodes, ['RUGCHECK_DANGER']);
    assert.deepEqual(r.reasons, ['RugCheck danger : Low Liquidity', 'RugCheck danger : Large Amount of LP Unlocked']);
  });

  test('nom de risque bloqué → BLOCKED_RISK, même en simple « warn » ou « info »', () => {
    const r = evaluateRugcheckSummary(summaryWith([risk('Freeze Authority still enabled', 'warn')]), RUG);
    assert.deepEqual(r.rejectCodes, ['BLOCKED_RISK']);
    assert.deepEqual(r.reasons, ['RugCheck risque bloqué : Freeze Authority still enabled (motif « freeze authority »)']);
    assert.deepEqual(r.warnings, ['RugCheck avertissement : Freeze Authority still enabled']);

    const info = evaluateRugcheckSummary(summaryWith([risk('Copycat token', 'info')]), RUG);
    assert.deepEqual(info.rejectCodes, ['BLOCKED_RISK']);

    const both = evaluateRugcheckSummary(summaryWith([risk('Mint Authority still enabled', 'danger')]), RUG);
    assert.deepEqual(both.rejectCodes, ['RUGCHECK_DANGER', 'BLOCKED_RISK']);
    assert.equal(both.reasons.length, 2);
  });

  test('motifs bloqués : casse et espaces normalisés, motif vide ignoré', () => {
    const cfg = { ...RUG, blockedRiskNames: ['  Transfer   Fee ', '', '   '] };
    assert.deepEqual(evaluateRugcheckSummary(summaryWith([risk('Transfer fee  enabled', 'warn')]), cfg).rejectCodes, ['BLOCKED_RISK']);
    // Un motif vide ne doit pas tout rejeter.
    assert.deepEqual(evaluateRugcheckSummary(summaryWith([risk('Mutable metadata', 'warn')]), cfg).rejectCodes, []);
  });

  test('trop d\'avertissements → TOO_MANY_WARNINGS qui liste les noms ; chaque « warn » reste un avertissement', () => {
    const r = evaluateRugcheckSummary(
      summaryWith([risk('Mutable metadata', 'warn'), risk('Low amount of LP Providers', 'Warn'), risk('Top 10 holders high ownership', 'warning')]),
      RUG,
    );
    assert.deepEqual(r.rejectCodes, ['TOO_MANY_WARNINGS']);
    assert.deepEqual(r.reasons, [
      'RugCheck : 3 avertissements (max 2) : Mutable metadata, Low amount of LP Providers, Top 10 holders high ownership',
    ]);
    assert.equal(r.warnings.length, 3);
  });

  test('pile au maximum d\'avertissements → pas de rejet', () => {
    const r = evaluateRugcheckSummary(summaryWith([risk('Mutable metadata', 'warn'), risk('Low amount of LP Providers', 'warn')]), RUG);
    assert.deepEqual(r.rejectCodes, []);
    assert.equal(r.warnings.length, 2);
  });

  test('niveau « info » ignoré ; niveau vide ou inconnu compté comme avertissement', () => {
    const info = evaluateRugcheckSummary(summaryWith([risk('Token-2022 program', 'info')]), RUG);
    assert.deepEqual(info, { rejectCodes: [], reasons: [], warnings: [] });

    const unknown = evaluateRugcheckSummary(
      summaryWith([risk('A', 'critical'), risk('B', ''), risk('C', 'warn')]),
      { ...RUG, maxRugcheckWarnings: 2 },
    );
    assert.deepEqual(unknown.rejectCodes, ['TOO_MANY_WARNINGS']);
    assert.match(unknown.warnings[0] ?? '', /niveau « critical » non reconnu/);
    assert.match(unknown.warnings[1] ?? '', /niveau « vide » non reconnu/);
  });

  test('champ error → API_ERROR (même si les risques sont propres)', () => {
    const r = evaluateRugcheckSummary(summaryWith([], { error: 'token not found' }), RUG);
    assert.deepEqual(r.rejectCodes, ['API_ERROR']);
    assert.match(r.reasons[0] ?? '', /RugCheck : erreur renvoyée par l'API \(token not found\)/);
  });
});

// ---------------------------------------------------------------------------
// evaluateJupiterAudit
// ---------------------------------------------------------------------------

describe('evaluateJupiterAudit', () => {
  test('audit sain → ni rejet ni avertissement', () => {
    assert.deepEqual(evaluateJupiterAudit(healthyToken(), RUG), { rejectCodes: [], reasons: [], warnings: [] });
  });

  test('token absent → avertissement seulement (RugCheck fait foi)', () => {
    const r = evaluateJupiterAudit(undefined, RUG);
    assert.deepEqual(r.rejectCodes, []);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0] ?? '', /introuvable/);
  });

  test('autorité de mint active → MINT_AUTHORITY ; autorité de gel active → FREEZE_AUTHORITY', () => {
    assert.deepEqual(evaluateJupiterAudit(healthyToken({ mintAuthorityDisabled: false }), RUG).rejectCodes, ['MINT_AUTHORITY']);
    assert.deepEqual(evaluateJupiterAudit(healthyToken({ freezeAuthorityDisabled: false }), RUG).rejectCodes, ['FREEZE_AUTHORITY']);
  });

  test('isSus → SUSPICIOUS', () => {
    const r = evaluateJupiterAudit(healthyToken({ isSus: true }), RUG);
    assert.deepEqual(r.rejectCodes, ['SUSPICIOUS']);
    assert.match(r.reasons[0] ?? '', /suspect/);
  });

  test('principaux détenteurs au-dessus du maximum → TOP_HOLDERS', () => {
    const r = evaluateJupiterAudit(healthyToken({ topHoldersPercentage: 45.25 }), RUG);
    assert.deepEqual(r.rejectCodes, ['TOP_HOLDERS']);
    assert.deepEqual(r.reasons, ["Jupiter : les principaux détenteurs possèdent 45.25 % de l'offre (max 30 %)"]);
    assert.deepEqual(evaluateJupiterAudit(healthyToken({ topHoldersPercentage: 30 }), RUG).rejectCodes, []);
  });

  test('score organique : faible → LOW_ORGANIC ; inconnu → avertissement ; minimum 0 → pas de contrôle', () => {
    const low = evaluateJupiterAudit(healthyToken({}, { organicScore: 12.5 }), RUG);
    assert.deepEqual(low.rejectCodes, ['LOW_ORGANIC']);
    assert.deepEqual(low.reasons, ['Jupiter : score organique 12.5 (min 30)']);

    const unknown = evaluateJupiterAudit(healthyToken({}, { organicScore: undefined }), RUG);
    assert.deepEqual(unknown.rejectCodes, []);
    assert.match(unknown.warnings[0] ?? '', /score organique inconnu/);

    assert.deepEqual(evaluateJupiterAudit(healthyToken({}, { organicScore: 12.5 }), { ...RUG, minOrganicScore: 0 }), {
      rejectCodes: [],
      reasons: [],
      warnings: [],
    });
  });

  test('champs null ou audit absent → avertissements seulement', () => {
    const nulls = evaluateJupiterAudit(
      healthyToken({ mintAuthorityDisabled: null, freezeAuthorityDisabled: null, topHoldersPercentage: null }),
      RUG,
    );
    assert.deepEqual(nulls.rejectCodes, []);
    assert.equal(nulls.warnings.length, 3);

    const noAudit = evaluateJupiterAudit({ id: MINT, organicScore: 80 }, RUG);
    assert.deepEqual(noAudit.rejectCodes, []);
    assert.match(noAudit.warnings[0] ?? '', /aucune donnée d'audit/);
  });

  test('plusieurs problèmes → tous les codes', () => {
    const r = evaluateJupiterAudit(
      healthyToken({ isSus: true, mintAuthorityDisabled: false, freezeAuthorityDisabled: false, topHoldersPercentage: 80 }, { organicScore: 3 }),
      RUG,
    );
    assert.deepEqual(r.rejectCodes, ['SUSPICIOUS', 'MINT_AUTHORITY', 'FREEZE_AUTHORITY', 'TOP_HOLDERS', 'LOW_ORGANIC']);
    assert.equal(r.reasons.length, 5);
  });
});

// ---------------------------------------------------------------------------
// createRugChecker
// ---------------------------------------------------------------------------

describe('createRugChecker', () => {
  test('tout est bon → accepté, scores et détails remplis', async () => {
    const { checker, rugcheck, jupiter, clock } = setup();
    const v = await checker.check(candidate());

    assert.equal(v.pass, true);
    assert.equal(v.mint, MINT);
    assert.deepEqual(v.rejectCodes, []);
    assert.deepEqual(v.reasons, []);
    assert.deepEqual(v.warnings, ['RugCheck avertissement : Mutable metadata']);
    assert.equal(v.checkedAt, clock.iso());
    assert.equal(v.rugcheckScore, 101);
    assert.equal(v.rugcheckScoreNormalised, 1);
    assert.equal(v.roundTripCostPct, 2);
    assert.equal(v.topHoldersPct, 18.4);

    assert.deepEqual(rugcheck.calls, [MINT]);
    assert.deepEqual(jupiter.searches, [[MINT]]);
    // Deux devis successifs, sans taker : SOL → token avec la sonde, puis token → SOL avec ce qui est sorti.
    assert.deepEqual(jupiter.orders, [
      { inputMint: SOL_MINT, outputMint: MINT, amount: '300000000' },
      { inputMint: MINT, outputMint: SOL_MINT, amount: TOKENS_OUT },
    ]);

    assert.deepEqual(group(v, 'rugcheck'), {
      score: 101,
      score_normalised: 1,
      lpLockedPct: 99.5,
      tokenProgram: TOKEN_PROGRAM,
      risks: [{ name: 'Mutable metadata', level: 'warn' }],
    });
    assert.deepEqual(group(v, 'jupiter'), {
      found: true,
      organicScore: 72.5,
      isVerified: false,
      audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 18.4 },
    });
    assert.deepEqual(group(v, 'roundTrip'), {
      probeLamports: '300000000',
      tokensOut: TOKENS_OUT,
      lamportsBack: HEALTHY_BACK,
      router: { buy: 'iris', sell: 'iris' },
      feeBps: { buy: 50, sell: 50 },
    });
    // Les détails doivent pouvoir aller tels quels dans le journal JSONL.
    assert.doesNotThrow(() => JSON.stringify(v));
  });

  test('risque RugCheck « danger » → rejet RUGCHECK_DANGER', async () => {
    const { checker } = setup({ summary: async () => summaryWith([risk('Low Liquidity', 'danger', '$812.00')]) });
    const v = await checker.check(candidate());
    assert.equal(v.pass, false);
    assert.deepEqual(v.rejectCodes, ['RUGCHECK_DANGER']);
    assert.deepEqual(v.reasons, ['RugCheck danger : Low Liquidity']);
    assert.deepEqual(group(v, 'rugcheck')['risks'], [{ name: 'Low Liquidity', level: 'danger', value: '$812.00' }]);
  });

  test('nom bloqué « Freeze Authority still enabled » → rejet BLOCKED_RISK', async () => {
    const { checker } = setup({ summary: async () => summaryWith([risk('Freeze Authority still enabled', 'warn')]) });
    const v = await checker.check(candidate());
    assert.equal(v.pass, false);
    assert.deepEqual(v.rejectCodes, ['BLOCKED_RISK']);
    assert.match(v.reasons[0] ?? '', /Freeze Authority still enabled/);
  });

  test('trop d\'avertissements RugCheck → rejet TOO_MANY_WARNINGS', async () => {
    const { checker } = setup({
      summary: async () => summaryWith([risk('Mutable metadata', 'warn'), risk('Low amount of LP Providers', 'warn'), risk('High ownership', 'warn')]),
    });
    const v = await checker.check(candidate());
    assert.equal(v.pass, false);
    assert.deepEqual(v.rejectCodes, ['TOO_MANY_WARNINGS']);
    assert.equal(v.warnings.filter((w) => w.startsWith('RugCheck avertissement')).length, 3);
  });

  test('Jupiter mintAuthorityDisabled = false → rejet MINT_AUTHORITY', async () => {
    const { checker } = setup({ search: async () => [healthyToken({ mintAuthorityDisabled: false })] });
    const v = await checker.check(candidate());
    assert.equal(v.pass, false);
    assert.deepEqual(v.rejectCodes, ['MINT_AUTHORITY']);
  });

  test('Jupiter isSus → rejet SUSPICIOUS', async () => {
    const { checker } = setup({ search: async () => [healthyToken({ isSus: true })] });
    const v = await checker.check(candidate());
    assert.equal(v.pass, false);
    assert.deepEqual(v.rejectCodes, ['SUSPICIOUS']);
  });

  test('Jupiter : seul le token dont id === mint compte ; absent → simple avertissement', async () => {
    const other = { ...healthyToken({ isSus: true }), id: OTHER_MINT };
    const { checker } = setup({ search: async () => [other] });
    const v = await checker.check(candidate());
    assert.equal(v.pass, true);
    assert.equal(group(v, 'jupiter')['found'], false);
    assert.equal(v.topHoldersPct, undefined);
    assert.ok(v.warnings.some((w) => /introuvable/.test(w)));
  });

  test('aller-retour à 8 % de coût → rejet ROUNDTRIP_COST', async () => {
    const { checker } = setup({ order: roundTrip(TOKENS_OUT, '276000000') });
    const v = await checker.check(candidate());
    assert.equal(v.pass, false);
    assert.deepEqual(v.rejectCodes, ['ROUNDTRIP_COST']);
    assert.deepEqual(v.reasons, ['aller-retour 0.3 SOL : coût 8.00 % (max 5 %)']);
    assert.equal(v.roundTripCostPct, 8);
  });

  test('RugCheck lève une HttpError → API_ERROR qui nomme la source ; les autres contrôles ont tourné', async () => {
    const { checker } = setup({
      summary: async () => {
        throw rugcheckHttpError(502, { message: 'Bad gateway' });
      },
    });
    const v = await checker.check(candidate());
    assert.equal(v.pass, false);
    assert.deepEqual(v.rejectCodes, ['API_ERROR']);
    assert.equal(v.reasons.length, 1);
    assert.match(v.reasons[0] ?? '', /^RugCheck : contrôle impossible, GET .*HTTP 502 \(Bad gateway\)$/);
    assert.equal(v.rugcheckScore, undefined);
    assert.match(String(group(v, 'rugcheck')['error']), /HTTP 502/);
    assert.equal(v.roundTripCostPct, 2);
    assert.equal(group(v, 'jupiter')['found'], true);
  });

  test('réponse RugCheck invalide (le client lève une Error) → API_ERROR', async () => {
    const { checker } = setup({ summary: async (mint) => parseRugcheckSummary({ risks: 'aucun', score: 1 }, mint) });
    const v = await checker.check(candidate());
    assert.deepEqual(v.rejectCodes, ['API_ERROR']);
    assert.match(v.reasons[0] ?? '', /^RugCheck : contrôle impossible, .*« risks » n'est pas une liste/);
  });

  test('champ error dans le résumé RugCheck → API_ERROR', async () => {
    const { checker } = setup({ summary: async () => summaryWith([], { error: 'analyse en cours' }) });
    const v = await checker.check(candidate());
    assert.deepEqual(v.rejectCodes, ['API_ERROR']);
    assert.match(v.reasons[0] ?? '', /analyse en cours/);
  });

  test('tokensSearch lève une erreur → API_ERROR qui nomme Jupiter', async () => {
    const { checker } = setup({
      search: async () => {
        throw new HttpError('GET https://api.jup.ag/tokens/v2/search → HTTP 429', 429, 'https://api.jup.ag/tokens/v2/search', null, true);
      },
    });
    const v = await checker.check(candidate());
    assert.equal(v.pass, false);
    assert.deepEqual(v.rejectCodes, ['API_ERROR']);
    assert.match(v.reasons[0] ?? '', /^Jupiter \(audit du token\) : contrôle impossible, .*HTTP 429/);
    assert.equal(v.rugcheckScore, 101);
  });

  test('tokensSearch renvoie autre chose qu\'une liste → API_ERROR', async () => {
    const { checker } = setup({ search: async () => ({ tokens: [] }) as unknown as JupiterToken[] });
    const v = await checker.check(candidate());
    assert.deepEqual(v.rejectCodes, ['API_ERROR']);
  });

  test('devis d\'achat sans outAmount → NO_ROUTE, pas de devis de revente', async () => {
    const { checker, jupiter } = setup({ order: roundTrip(undefined, HEALTHY_BACK) });
    const v = await checker.check(candidate());
    assert.equal(v.pass, false);
    assert.deepEqual(v.rejectCodes, ['NO_ROUTE']);
    assert.deepEqual(v.reasons, ["aller-retour : pas de route d'achat SOL → token (outAmount absent)"]);
    assert.equal(jupiter.orders.length, 1);
    assert.equal(v.roundTripCostPct, undefined);
    assert.equal(group(v, 'roundTrip')['tokensOut'], undefined);
  });

  test('devis de revente nul, non numérique ou en erreur → NO_ROUTE (honeypot possible)', async () => {
    const cases: Array<[(p: OrderParams) => Promise<JupiterOrder>, RegExp]> = [
      [roundTrip(TOKENS_OUT, '0'), /outAmount nul/],
      [roundTrip(TOKENS_OUT, '1e9'), /outAmount non numérique/],
      [roundTrip(TOKENS_OUT, ''), /outAmount non numérique/],
      [roundTrip(TOKENS_OUT, HEALTHY_BACK, { sell: { error: 'Could not find any route' } }), /erreur Jupiter : Could not find any route/],
      [roundTrip(TOKENS_OUT, HEALTHY_BACK, { sell: { errorCode: 3, errorMessage: 'Minimum amount' } }), /erreur Jupiter \(code 3\) : Minimum amount/],
      [roundTrip(TOKENS_OUT, HEALTHY_BACK, { sell: { outputMint: MINT } }), /devis incohérent/],
    ];
    for (const [order, expected] of cases) {
      const { checker, jupiter } = setup({ order });
      const v = await checker.check(candidate());
      assert.deepEqual(v.rejectCodes, ['NO_ROUTE'], String(expected));
      assert.match(v.reasons[0] ?? '', /pas de route de revente token → SOL/);
      assert.match(v.reasons[0] ?? '', expected);
      assert.equal(jupiter.orders.length, 2);
      assert.equal(group(v, 'roundTrip')['tokensOut'], TOKENS_OUT);
    }
  });

  test('devis d\'achat avec errorCode → NO_ROUTE même si outAmount est présent', async () => {
    const { checker } = setup({ order: roundTrip(TOKENS_OUT, HEALTHY_BACK, { buy: { errorCode: 1 } }) });
    const v = await checker.check(candidate());
    assert.deepEqual(v.rejectCodes, ['NO_ROUTE']);
    assert.match(v.reasons[0] ?? '', /pas de route d'achat/);
  });

  test('order lève une erreur au 2e devis → API_ERROR, détails partiels conservés', async () => {
    const { checker } = setup({
      order: async (p) => {
        if (p.inputMint === SOL_MINT) return quote(p, TOKENS_OUT);
        throw new HttpError('GET https://api.jup.ag/swap/v2/order → HTTP 500', 500, 'https://api.jup.ag/swap/v2/order', null, true);
      },
    });
    const v = await checker.check(candidate());
    assert.deepEqual(v.rejectCodes, ['API_ERROR']);
    assert.match(v.reasons[0] ?? '', /^Jupiter \(aller-retour\) : contrôle impossible, .*HTTP 500/);
    const rt = group(v, 'roundTrip');
    assert.equal(rt['probeLamports'], '300000000');
    assert.equal(rt['tokensOut'], TOKENS_OUT);
    assert.match(String(rt['error']), /HTTP 500/);
  });

  test('plusieurs sources en panne → un seul code API_ERROR, une raison par source', async () => {
    const boom = async (): Promise<never> => {
      throw new Error('réseau coupé');
    };
    const { checker } = setup({ summary: boom, search: boom, order: boom });
    const v = await checker.check(candidate());
    assert.equal(v.pass, false);
    assert.deepEqual(v.rejectCodes, ['API_ERROR']);
    assert.equal(v.reasons.length, 3);
    assert.match(v.reasons[0] ?? '', /^RugCheck/);
    assert.match(v.reasons[1] ?? '', /^Jupiter \(audit du token\)/);
    assert.match(v.reasons[2] ?? '', /^Jupiter \(aller-retour\)/);
  });

  test('source qui ne répond jamais → API_ERROR « délai dépassé »', async () => {
    const { checker } = setup({ summary: () => new Promise<RugcheckSummary>(() => {}), timeoutMs: 20 });
    const v = await checker.check(candidate());
    assert.equal(v.pass, false);
    assert.deepEqual(v.rejectCodes, ['API_ERROR']);
    assert.match(v.reasons[0] ?? '', /^RugCheck : contrôle impossible, délai dépassé \(0.02 s\)$/);
  });

  test('mint mal formé → INVALID_MINT sans aucun appel réseau', async () => {
    const { checker, rugcheck, jupiter } = setup();
    const v = await checker.check(candidate('../../v1/admin'));
    assert.equal(v.pass, false);
    assert.deepEqual(v.rejectCodes, ['INVALID_MINT']);
    assert.equal(rugcheck.calls.length + jupiter.searches.length + jupiter.orders.length, 0);
  });

  test('sonde invalide dans la config → API_ERROR, jamais un passage', async () => {
    const { checker, jupiter } = setup({ rug: { roundTripProbeSol: Number.NaN } });
    const v = await checker.check(candidate());
    assert.deepEqual(v.rejectCodes, ['API_ERROR']);
    assert.match(v.reasons[0] ?? '', /taille de sonde invalide/);
    assert.equal(jupiter.orders.length, 0);
  });

  test('seuil de coût invalide (NaN) → rejet plutôt que passage', async () => {
    const { checker } = setup({ rug: { maxRoundTripCostPct: Number.NaN } });
    const v = await checker.check(candidate());
    assert.deepEqual(v.rejectCodes, ['ROUNDTRIP_COST']);
  });

  describe('cache', () => {
    test('verdict réutilisé pendant la durée de cache (faux appelés une fois), recalculé ensuite', async () => {
      const { checker, rugcheck, jupiter, clock } = setup({ rug: { cacheMinutes: 10 } });
      const first = await checker.check(candidate());

      clock.advance(10 * 60_000 - 1);
      const second = await checker.check(candidate());
      assert.deepEqual(second, first);
      assert.equal(second.checkedAt, first.checkedAt);
      assert.equal(rugcheck.calls.length, 1);
      assert.equal(jupiter.searches.length, 1);
      assert.equal(jupiter.orders.length, 2);

      clock.advance(1);
      const third = await checker.check(candidate());
      assert.equal(rugcheck.calls.length, 2);
      assert.equal(jupiter.searches.length, 2);
      assert.equal(jupiter.orders.length, 4);
      assert.equal(third.checkedAt, new Date(START + 10 * 60_000).toISOString());
    });

    test('un rejet définitif est aussi mis en cache', async () => {
      const { checker, rugcheck } = setup({ summary: async () => summaryWith([risk('Rug pull', 'danger')]) });
      const first = await checker.check(candidate());
      const second = await checker.check(candidate());
      assert.deepEqual(first.rejectCodes, ['RUGCHECK_DANGER']);
      assert.deepEqual(second, first);
      assert.equal(rugcheck.calls.length, 1);
    });

    test('le cache est par mint', async () => {
      const other = OTHER_MINT;
      const { checker, rugcheck } = setup();
      await checker.check(candidate());
      await checker.check(candidate(other));
      assert.deepEqual(rugcheck.calls, [MINT, other]);
    });

    test('modifier le verdict rendu n\'abîme pas le cache', async () => {
      const { checker } = setup();
      const first = await checker.check(candidate());
      first.pass = false;
      first.reasons.push('modifié par l\'appelant');
      const second = await checker.check(candidate());
      assert.equal(second.pass, true);
      assert.deepEqual(second.reasons, []);
    });

    test('API_ERROR jamais mis en cache : on réessaie au scan suivant', async () => {
      let n = 0;
      const { checker, rugcheck } = setup({
        summary: async () => {
          n++;
          if (n === 1) throw rugcheckHttpError(503);
          return healthySummary();
        },
      });
      const first = await checker.check(candidate());
      assert.deepEqual(first.rejectCodes, ['API_ERROR']);

      const second = await checker.check(candidate());
      assert.equal(second.pass, true);
      assert.equal(rugcheck.calls.length, 2);

      const third = await checker.check(candidate());
      assert.deepEqual(third, second);
      assert.equal(rugcheck.calls.length, 2);
    });

    test('verdict mêlant API_ERROR et un autre rejet : pas de cache non plus', async () => {
      const { checker, rugcheck } = setup({
        summary: async () => summaryWith([risk('Rug pull', 'danger')]),
        search: async () => {
          throw new Error('panne');
        },
      });
      await checker.check(candidate());
      await checker.check(candidate());
      assert.equal(rugcheck.calls.length, 2);
    });

    test('cacheMinutes = 0 → aucun cache', async () => {
      const { checker, rugcheck } = setup({ rug: { cacheMinutes: 0 } });
      await checker.check(candidate());
      await checker.check(candidate());
      assert.equal(rugcheck.calls.length, 2);
    });
  });
});

// ---------------------------------------------------------------------------
// Client RugCheck
// ---------------------------------------------------------------------------

describe('client RugCheck', () => {
  function fakeHttp(body: unknown): { http: Http; calls: Array<{ url: string; opts: RequestOptions | undefined }> } {
    const calls: Array<{ url: string; opts: RequestOptions | undefined }> = [];
    const http: Http = {
      async getJson<T>(url: string, opts?: RequestOptions): Promise<T> {
        calls.push({ url, opts });
        return body as T;
      },
      async postJson<T>(): Promise<T> {
        throw new Error('POST inattendu');
      },
    };
    return { http, calls };
  }

  const LIVE_LIKE = {
    tokenProgram: TOKEN_PROGRAM,
    tokenType: '',
    risks: [
      { name: 'Mutable metadata', value: '', description: 'Token metadata can be changed by the owner', score: 100, level: 'warn' },
      { name: 'Large Amount of LP Unlocked', value: '100.00%', description: 'LP unlocked', score: 10999, level: 'danger' },
    ],
    score: 11100,
    score_normalised: 52,
    lpLockedPct: 0,
  };

  test('GET /v1/tokens/{mint}/report/summary avec « Authorization: Bearer <clé> »', async () => {
    const { http, calls } = fakeHttp(LIVE_LIKE);
    const api = createRugcheckApi({ http, baseUrl: 'https://api.rugcheck.xyz/', apiKey: 'secret' });
    const s = await api.summary(MINT);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, `https://api.rugcheck.xyz/v1/tokens/${MINT}/report/summary`);
    assert.deepEqual(calls[0]?.opts?.headers, { Authorization: 'Bearer secret' });
    assert.deepEqual(s, LIVE_LIKE);
  });

  test('sans clé : aucun en-tête Authorization', async () => {
    const { http, calls } = fakeHttp(LIVE_LIKE);
    await createRugcheckApi({ http, baseUrl: 'https://api.rugcheck.xyz' }).summary(MINT);
    assert.deepEqual(calls[0]?.opts?.headers, {});
  });

  test('analyse défensive : champs facultatifs absents, nombres en texte, risque incomplet', () => {
    const s = parseRugcheckSummary({ risks: [{ name: 'Mutable metadata', level: 'warn' }], score: '101' }, MINT);
    assert.deepEqual(s, {
      tokenProgram: '',
      tokenType: '',
      risks: [{ name: 'Mutable metadata', value: '', description: '', level: 'warn' }],
      score: 101,
    });
  });

  test('forme inattendue → Error explicite', () => {
    assert.throws(() => parseRugcheckSummary('<html>Too Many Requests</html>', MINT), /objet JSON attendu/);
    assert.throws(() => parseRugcheckSummary(null, MINT), /objet JSON attendu/);
    assert.throws(() => parseRugcheckSummary({ ...LIVE_LIKE, risks: null }, MINT), /« risks » n'est pas une liste/);
    assert.throws(() => parseRugcheckSummary({ ...LIVE_LIKE, score: undefined }, MINT), /« score » absent ou non numérique/);
    assert.throws(() => parseRugcheckSummary({ ...LIVE_LIKE, score: 'élevé' }, MINT), /« score » absent ou non numérique/);
    assert.throws(() => parseRugcheckSummary({ ...LIVE_LIKE, risks: ['Mutable metadata'] }, MINT), /risque n°1 illisible/);
    assert.throws(() => parseRugcheckSummary({ ...LIVE_LIKE, mint: OTHER_MINT }, MINT), /autre mint/);
  });

  test('champ error : conservé si la réponse est bien formée, cité dans l\'erreur sinon', () => {
    const s = parseRugcheckSummary({ ...LIVE_LIKE, error: 'partial report' }, MINT);
    assert.equal(s.error, 'partial report');
    assert.deepEqual(evaluateRugcheckSummary(s, RUG).rejectCodes, ['API_ERROR', 'RUGCHECK_DANGER']);

    assert.equal(parseRugcheckSummary({ ...LIVE_LIKE, error: null }, MINT).error, undefined);
    assert.equal(parseRugcheckSummary({ ...LIVE_LIKE, error: '' }, MINT).error, undefined);

    assert.throws(() => parseRugcheckSummary({ error: 'not found' }, MINT), /erreur de l'API : not found/);
  });

  test('une erreur HTTP remonte telle quelle (le filtre en fait un API_ERROR)', async () => {
    const http: Http = {
      async getJson<T>(): Promise<T> {
        throw rugcheckHttpError(429);
      },
      async postJson<T>(): Promise<T> {
        throw new Error('POST inattendu');
      },
    };
    await assert.rejects(createRugcheckApi({ http, baseUrl: 'https://api.rugcheck.xyz' }).summary(MINT), HttpError);
  });

  test('de bout en bout avec le vrai client HTTP : en-tête envoyé, erreur 400 de l\'API → API_ERROR qui la cite', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
      seen.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
      return new Response(JSON.stringify({ error: 'invalid token mint' }), { status: 400 });
    };
    const http = createHttp({ fetch, sleep: async () => {}, now: () => 0, retries: 0 });
    const rugcheck = createRugcheckApi({ http, baseUrl: 'https://api.rugcheck.xyz', apiKey: 'secret' });
    const checker = createRugChecker({ rugcheck, jupiter: fakeJupiter(), clock: fixedClock(START), config: makeConfig() });

    const v = await checker.check(candidate());
    assert.equal(v.pass, false);
    assert.deepEqual(v.rejectCodes, ['API_ERROR']);
    assert.match(v.reasons[0] ?? '', /^RugCheck : contrôle impossible, GET .* → HTTP 400 \(invalid token mint\)$/);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.url, `https://api.rugcheck.xyz/v1/tokens/${MINT}/report/summary`);
    assert.equal(seen[0]?.headers['Authorization'], 'Bearer secret');
  });
});
