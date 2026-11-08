/**
 * Tests du sizer : taille depuis l'equity, plafonds dans l'ordre, refus (échoue fermé), arrondi au
 * lamport. Valeurs de référence : les défauts de src/config.ts.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HARD_LIMITS } from '../src/config.ts';
import type { SizerConfig } from '../src/config.ts';
import { LAMPORTS_PER_SOL, SOL_MINT } from '../src/types.ts';
import type { EquitySnapshot, Fill, Position, SizeDecision, TokenCandidate } from '../src/types.ts';
import { sizePosition } from '../src/workers/sizer.ts';
import type { SizeInput } from '../src/workers/sizer.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Défauts de src/config.ts (loadConfig sans variable d'environnement). */
const CFG: SizerConfig = {
  positionPct: 4,
  minPositionSol: 0.05,
  maxPositionSol: 0.4,
  maxOpenPositions: 3,
  maxExposurePct: 30,
  maxPoolSharePct: 1,
  feeReserveSol: 0.05,
  drawdownHalveAtPct: 25,
};

const AT = '2026-11-08T16:00:00.000Z';
/** Prix du SOL choisi pour retrouver l'exemple de la spécification : 1 % de 52 k$ = 0.741 SOL. */
const SOL_USD = 701.75;
const CANDIDATE_MINT = 'CandMint1111111111111111111111111111111111';

/** Compte à son plus haut (drawdown 0) ; par défaut equity = SOL libre + valeur des positions. */
function equity(o: Partial<EquitySnapshot> = {}): EquitySnapshot {
  const freeSol = o.freeSol ?? 7.12;
  const positionsValueSol = o.positionsValueSol ?? 0;
  const equitySol = o.equitySol ?? freeSol + positionsValueSol;
  const initialEquitySol = o.initialEquitySol ?? equitySol;
  return {
    at: AT,
    freeSol,
    positionsValueSol,
    equitySol,
    peakEquitySol: o.peakEquitySol ?? equitySol,
    initialEquitySol,
    drawdownPct: o.drawdownPct ?? 0,
    returnPct: o.returnPct ?? (initialEquitySol > 0 ? ((equitySol - initialEquitySol) / initialEquitySol) * 100 : 0),
  };
}

function entryFill(mint: string, entrySol: number): Fill {
  return {
    side: 'buy',
    mode: 'paper',
    ok: true,
    at: AT,
    inputMint: SOL_MINT,
    outputMint: mint,
    inAmount: String(Math.round(entrySol * LAMPORTS_PER_SOL)),
    quotedOutAmount: '1000000000',
    actualOutAmount: '985000000',
    slippageBps: 150,
    feeLamports: 150_000,
  };
}

/** Position ouverte dont la dernière valeur de liquidation est lastValueSol. */
function position(mint: string, lastValueSol: number): Position {
  return {
    id: `pos-${mint}`,
    mint,
    symbol: mint.slice(0, 8),
    decimals: 6,
    pairAddress: `pair-${mint}`,
    openedAt: AT,
    entrySol: lastValueSol,
    tokenAmountRaw: '985000000',
    entryLiquidityUsd: 60_000,
    peakValueSol: lastValueSol,
    lastValueSol,
    lastCheckedAt: AT,
    entryReasons: ['fixture'],
    entryFill: entryFill(mint, lastValueSol),
  };
}

function candidate(o: Partial<TokenCandidate> = {}): TokenCandidate {
  return {
    mint: CANDIDATE_MINT,
    symbol: 'CAND',
    name: 'Candidat',
    pairAddress: 'CandPair1111111111111111111111111111111111',
    dexId: 'raydium',
    quoteSymbol: 'SOL',
    priceUsd: 0.00042,
    liquidityUsd: 52_000,
    marketCapUsd: 420_000,
    pairCreatedAtMs: Date.parse(AT) - 3 * 3_600_000,
    ageMinutes: 180,
    vol5mUsd: 14_000,
    vol1hUsd: 50_000,
    buys5m: 90,
    sells5m: 45,
    priceChange5mPct: 8,
    priceChange1hPct: 25,
    spikeRatio: 4,
    buySellRatio: 2,
    organicScore: 60,
    traders5m: 70,
    sources: ['jup:toptrending:5m'],
    score: 72,
    signals: ['volume 5 min ×4 sur la moyenne de l\'heure'],
    observedAt: AT,
    ...o,
  };
}

function input(o: Partial<SizeInput> = {}): SizeInput {
  return { equity: equity(), openPositions: [], candidate: candidate(), solUsd: SOL_USD, cfg: CFG, ...o };
}

/** Forme d'un refus : rien à engager et une raison qui contient le motif attendu. */
function assertSkip(d: SizeDecision, reasonPart: string): void {
  assert.equal(d.ok, false, `refus attendu, obtenu : ${d.reason}`);
  assert.equal(d.sizeSol, 0);
  assert.equal(d.lamports, 0);
  assert.ok(d.reason.includes(reasonPart), `raison inattendue : ${d.reason}`);
}

// ---------------------------------------------------------------------------
// Cas de base et plafonds
// ---------------------------------------------------------------------------

test("cas de base : 4 % de l'equity, aucun plafond atteint (exemple de la spécification)", () => {
  const d = sizePosition(input());
  assert.equal(d.ok, true);
  assert.equal(d.lamports, 284_800_000);
  assert.equal(d.sizeSol, 0.2848);
  assert.deepEqual(d.capsApplied, []);
  assert.equal(
    d.reason,
    "4 % de l'equity 7.120 SOL = 0.285 SOL ; plafond liquidité (1 % de 52.0 k$) = 0.741 SOL ; taille retenue 0.285 SOL",
  );
});

test('MAX_POSITION : la taille ne dépasse jamais maxPositionSol', () => {
  const d = sizePosition(input({ equity: equity({ freeSol: 12 }) })); // 4 % de 12 = 0.48
  assert.equal(d.ok, true);
  assert.equal(d.lamports, 400_000_000);
  assert.deepEqual(d.capsApplied, ['MAX_POSITION']);
  assert.equal(
    d.reason,
    "4 % de l'equity 12.000 SOL = 0.480 SOL ; plafond par position = 0.400 SOL ; plafond liquidité (1 % de 52.0 k$) = 0.741 SOL ; taille retenue 0.400 SOL",
  );
});

test("un plafond égal à la taille ne la réduit pas : il n'est pas listé", () => {
  const d = sizePosition(input({ equity: equity({ freeSol: 10 }) })); // 4 % de 10 = 0.4 = maxPositionSol
  assert.equal(d.ok, true);
  assert.equal(d.lamports, 400_000_000);
  assert.deepEqual(d.capsApplied, []);
});

test("EXPOSURE : l'ensemble des positions reste sous 30 % de l'equity", () => {
  // equity 7.2 = 5.3 libres + 1.9 en positions ; place = 30 % × 7.2 − 1.9 = 0.26 < base 0.288.
  const d = sizePosition(
    input({
      equity: equity({ freeSol: 5.3, positionsValueSol: 1.9, equitySol: 7.2 }),
      openPositions: [position('TokenA', 1.1), position('TokenB', 0.8)],
    }),
  );
  assert.equal(d.ok, true);
  assert.equal(d.lamports, 260_000_000);
  assert.deepEqual(d.capsApplied, ['EXPOSURE']);
  assert.equal(
    d.reason,
    "4 % de l'equity 7.200 SOL = 0.288 SOL ; plafond d'exposition (30 % de l'equity 7.200 SOL − 1.900 SOL déjà engagés) = 0.260 SOL ; plafond liquidité (1 % de 52.0 k$) = 0.741 SOL ; taille retenue 0.260 SOL",
  );
});

test('POOL_SHARE : notre ordre reste ≤ 1 % de la liquidité du pool', () => {
  // 1 % de 4 000 $ = 40 $, à 160 $/SOL = 0.25 SOL < base 0.2848.
  const d = sizePosition(input({ candidate: candidate({ liquidityUsd: 4_000 }), solUsd: 160 }));
  assert.equal(d.ok, true);
  assert.equal(d.lamports, 250_000_000);
  assert.deepEqual(d.capsApplied, ['POOL_SHARE']);
  assert.equal(
    d.reason,
    "4 % de l'equity 7.120 SOL = 0.285 SOL ; plafond liquidité (1 % de 4.0 k$) = 0.250 SOL ; taille retenue 0.250 SOL",
  );
});

test('FREE_SOL : jamais plus que le SOL libre moins la réserve de frais', () => {
  // Fixture volontairement incohérente : equity 7.12 SOL mais 0.25 SOL libres seulement (SOL en
  // transit, solde en retard…). Avec equity = libre + positions, l'exposition mord toujours avant.
  const d = sizePosition(input({ equity: equity({ freeSol: 0.25, equitySol: 7.12 }) }));
  assert.equal(d.ok, true);
  assert.equal(d.lamports, 200_000_000);
  assert.deepEqual(d.capsApplied, ['FREE_SOL']);
  assert.equal(
    d.reason,
    "4 % de l'equity 7.120 SOL = 0.285 SOL ; plafond liquidité (1 % de 52.0 k$) = 0.741 SOL ; plafond SOL libre (0.250 SOL − réserve 0.050 SOL) = 0.200 SOL ; taille retenue 0.200 SOL",
  );
});

test('DRAWDOWN_HALF : drawdown ≥ 25 % depuis le plus haut → taille divisée par 2', () => {
  const d = sizePosition(input({ equity: equity({ peakEquitySol: 10.2, drawdownPct: 30.2 }) }));
  assert.equal(d.ok, true);
  assert.equal(d.lamports, 142_400_000);
  assert.deepEqual(d.capsApplied, ['DRAWDOWN_HALF']);
  assert.equal(
    d.reason,
    "4 % de l'equity 7.120 SOL = 0.285 SOL ; drawdown 30.2 % ≥ 25 % : taille divisée par 2 = 0.142 SOL ; plafond liquidité (1 % de 52.0 k$) = 0.741 SOL ; taille retenue 0.142 SOL",
  );
});

test('DRAWDOWN_HALF : seuil inclus (25 %), pas en dessous (24.9 %)', () => {
  const at = sizePosition(input({ equity: equity({ peakEquitySol: 9.4934, drawdownPct: 25 }) }));
  assert.deepEqual(at.capsApplied, ['DRAWDOWN_HALF']);
  assert.equal(at.lamports, 142_400_000);
  const below = sizePosition(input({ equity: equity({ peakEquitySol: 9.48, drawdownPct: 24.9 }) }));
  assert.deepEqual(below.capsApplied, []);
  assert.equal(below.lamports, 284_800_000);
});

test("capsApplied : chaque plafond qui a réduit la taille, dans l'ordre d'application", () => {
  // Fixture artificielle où les cinq plafonds mordent l'un après l'autre :
  //   4 % de 25 = 1 → drawdown /2 = 0.5 → par position 0.4 → exposition 7.5 − 7.2 = 0.3
  //   → pool 1 % de 4 000 $ à 160 $ = 0.25 → SOL libre 0.25 − 0.05 = 0.2.
  const d = sizePosition(
    input({
      equity: equity({ equitySol: 25, freeSol: 0.25, positionsValueSol: 7.2, peakEquitySol: 36, drawdownPct: 30.6 }),
      openPositions: [position('TokenA', 3.6), position('TokenB', 3.6)],
      candidate: candidate({ liquidityUsd: 4_000 }),
      solUsd: 160,
    }),
  );
  assert.equal(d.ok, true);
  assert.deepEqual(d.capsApplied, ['DRAWDOWN_HALF', 'MAX_POSITION', 'EXPOSURE', 'POOL_SHARE', 'FREE_SOL']);
  assert.equal(d.lamports, 200_000_000);
  assert.equal(
    d.reason,
    "4 % de l'equity 25.000 SOL = 1.000 SOL ; drawdown 30.6 % ≥ 25 % : taille divisée par 2 = 0.500 SOL ; plafond par position = 0.400 SOL ; plafond d'exposition (30 % de l'equity 25.000 SOL − 7.200 SOL déjà engagés) = 0.300 SOL ; plafond liquidité (1 % de 4.0 k$) = 0.250 SOL ; plafond SOL libre (0.250 SOL − réserve 0.050 SOL) = 0.200 SOL ; taille retenue 0.200 SOL",
  );
});

test("capsApplied : seuls les plafonds qui ont mordu, dans l'ordre (MAX_POSITION puis POOL_SHARE)", () => {
  const d = sizePosition(
    input({ equity: equity({ freeSol: 12 }), candidate: candidate({ liquidityUsd: 4_000 }), solUsd: 160 }),
  );
  assert.equal(d.ok, true);
  assert.deepEqual(d.capsApplied, ['MAX_POSITION', 'POOL_SHARE']);
  assert.equal(d.lamports, 250_000_000);
});

// ---------------------------------------------------------------------------
// Refus
// ---------------------------------------------------------------------------

test('refus : nombre maximal de positions ouvertes atteint', () => {
  const d = sizePosition(
    input({
      equity: equity({ freeSol: 6.22, positionsValueSol: 0.9 }),
      openPositions: [position('TokenA', 0.3), position('TokenB', 0.3), position('TokenC', 0.3)],
    }),
  );
  assertSkip(d, '3 positions ouvertes ≥ maximum 3 : pas de nouvelle entrée');
  assert.deepEqual(d.capsApplied, []);
});

test('refus : token déjà détenu (même mint), vérifié avant le nombre de positions', () => {
  const held = sizePosition(input({ openPositions: [position(CANDIDATE_MINT, 0.28)] }));
  assertSkip(held, 'déjà une position ouverte sur CAND (Cand…1111) : pas de seconde entrée sur le même token');
  const heldAndFull = sizePosition(
    input({ openPositions: [position('TokenA', 0.3), position(CANDIDATE_MINT, 0.3), position('TokenC', 0.3)] }),
  );
  assertSkip(heldAndFull, 'déjà une position ouverte sur CAND');
});

test("même symbole mais autre mint (copie) : n'est pas pris pour la position détenue", () => {
  const copycat = { ...position('OtherMint111111111111111111111111111111111', 0.3), symbol: 'CAND' };
  assert.equal(sizePosition(input({ openPositions: [copycat] })).ok, true);
});

test("refus : plus de place dans l'exposition (30 % de l'equity déjà engagés)", () => {
  const d = sizePosition(
    input({
      equity: equity({ freeSol: 4.9, positionsValueSol: 2.22, equitySol: 7.12 }),
      openPositions: [position('TokenA', 1.2), position('TokenB', 1.02)],
    }),
  );
  assertSkip(
    d,
    "exposition 2.220 SOL ≥ plafond 2.136 SOL (30 % de l'equity 7.120 SOL) : plus de place pour une nouvelle position",
  );
  // Pile au plafond (3 SOL engagés sur 10) : place restante 0, refus aussi.
  const full = sizePosition(
    input({ equity: equity({ freeSol: 7, positionsValueSol: 3 }), openPositions: [position('TokenA', 3)] }),
  );
  assertSkip(full, 'exposition 3.000 SOL ≥ plafond 3.000 SOL');
});

test('refus : pas de SOL libre au-delà de la réserve de frais', () => {
  // Wallet presque vide : 0.04 SOL < réserve 0.05 SOL.
  assertSkip(
    sizePosition(input({ equity: equity({ freeSol: 0.04 }) })),
    'SOL libre 0.040 SOL ≤ réserve 0.050 SOL (frais réseau, loyer des comptes de tokens) : rien à engager',
  );
  // Pile la réserve : rien à engager non plus.
  assertSkip(sizePosition(input({ equity: equity({ freeSol: 0.05 }) })), 'SOL libre 0.050 SOL ≤ réserve 0.050 SOL');
});

test('refus : taille finale sous le minimum (les frais fixes mangeraient le gain)', () => {
  const d = sizePosition(input({ equity: equity({ freeSol: 0.78 }) })); // 4 % de 0.78 = 0.0312
  assertSkip(d, '0.031 SOL < minimum 0.050 SOL : les frais fixes (réseau, loyer du compte ~0.002 SOL) mangeraient le gain');
  assert.equal(
    d.reason,
    "4 % de l'equity 0.780 SOL = 0.031 SOL ; plafond liquidité (1 % de 52.0 k$) = 0.741 SOL ; 0.031 SOL < minimum 0.050 SOL : les frais fixes (réseau, loyer du compte ~0.002 SOL) mangeraient le gain",
  );
  assert.deepEqual(d.capsApplied, []);
});

test('refus sous le minimum à cause du pool : capsApplied garde la trace du plafond', () => {
  const d = sizePosition(input({ candidate: candidate({ liquidityUsd: 500 }), solUsd: 160 })); // 5 $ / 160 = 0.031 SOL
  assertSkip(d, 'plafond liquidité (1 % de 500 $) = 0.031 SOL ; 0.031 SOL < minimum 0.050 SOL');
  assert.deepEqual(d.capsApplied, ['POOL_SHARE']);
});

test('minimum : pile au minimum accepté ; juste en dessous refusé sans affichage « 0.050 < 0.050 »', () => {
  const at = sizePosition(input({ equity: equity({ freeSol: 1.25 }) })); // 4 % de 1.25 = 0.05
  assert.equal(at.ok, true);
  assert.equal(at.lamports, 50_000_000);
  const below = sizePosition(input({ equity: equity({ freeSol: 1.24 }) })); // 0.0496, arrondi à 0.050
  assertSkip(below, '0.049600000 SOL < minimum 0.050000000 SOL');
});

test('refus : equity nulle', () => {
  assertSkip(sizePosition(input({ equity: equity({ freeSol: 0 }) })), "4 % de l'equity 0.000 SOL = 0.000 SOL : rien à engager");
});

// ---------------------------------------------------------------------------
// Entrées invalides : échoue fermé
// ---------------------------------------------------------------------------

test('refus : prix du SOL inconnu (0, NaN, négatif, infini, absent, texte)', () => {
  for (const solUsd of [0, NaN, -150, Infinity, undefined, '150'] as unknown as number[]) {
    const d = sizePosition(input({ solUsd }));
    assertSkip(d, 'prix du SOL inconnu');
    assert.ok(d.reason.startsWith('prix du SOL inconnu (solUsd = '), d.reason);
  }
});

test("refus : equity invalide (NaN, infini ou négatif sur n'importe quel champ)", () => {
  const fields = ['freeSol', 'positionsValueSol', 'equitySol', 'peakEquitySol', 'initialEquitySol', 'drawdownPct'] as const;
  for (const field of fields) {
    for (const bad of [NaN, Infinity, -Infinity, -0.5]) {
      const d = sizePosition(input({ equity: { ...equity(), [field]: bad } }));
      assertSkip(d, `equity invalide : ${field} = ${bad} (attendu un nombre fini ≥ 0)`);
    }
  }
  // returnPct peut être négatif (perte depuis le départ), mais pas NaN.
  assert.equal(sizePosition(input({ equity: { ...equity(), returnPct: -40 } })).ok, true);
  assertSkip(sizePosition(input({ equity: { ...equity(), returnPct: NaN } })), 'equity invalide : returnPct = NaN');
});

test('refus : valeur de position invalide (exposition inconnue)', () => {
  for (const bad of [NaN, -0.1, Infinity]) {
    const broken = { ...position('TokenB', 0.2), lastValueSol: bad };
    const d = sizePosition(input({ openPositions: [position('TokenA', 0.2), broken] }));
    assertSkip(d, `valeur de la position TokenB inconnue (lastValueSol = ${bad})`);
  }
});

test('refus : liquidité du pool inconnue, nulle ou négative', () => {
  for (const liquidityUsd of [0, -1, NaN, Infinity]) {
    assertSkip(sizePosition(input({ candidate: candidate({ liquidityUsd }) })), 'liquidité du pool inconnue ou nulle');
  }
});

test('refus : configuration invalide (NaN ou négatif)', () => {
  for (const field of Object.keys(CFG) as (keyof SizerConfig)[]) {
    for (const bad of [NaN, -1]) {
      assertSkip(
        sizePosition(input({ cfg: { ...CFG, [field]: bad } })),
        `configuration du sizer invalide : ${field} = ${bad}`,
      );
    }
  }
});

test("entrées malformées : refus, jamais d'exception", () => {
  const cases: [SizeInput, string][] = [
    [input({ openPositions: null as unknown as Position[] }), 'liste des positions ouvertes illisible'],
    [input({ candidate: candidate({ mint: '' }) }), 'mint du candidat absent'],
    [input({ equity: null as unknown as EquitySnapshot }), 'calcul de taille impossible'],
    [input({ openPositions: [null as unknown as Position] }), 'calcul de taille impossible'],
  ];
  for (const [i, reason] of cases) assertSkip(sizePosition(i), reason);
});

// ---------------------------------------------------------------------------
// Lamports, proportionnalité, plafonds en dur
// ---------------------------------------------------------------------------

test('lamports : arrondi vers le bas, jamais vers le haut', () => {
  const d = sizePosition(input({ equity: equity({ freeSol: 4.9999999975 }) })); // 0.1999999999 SOL
  assert.equal(d.ok, true);
  assert.equal(d.lamports, 199_999_999); // un arrondi au plus proche donnerait 200 000 000
  assert.equal(d.sizeSol, 0.199999999);
  const e = sizePosition(input({ equity: equity({ freeSol: 3.3333333333 }) })); // 0.133333333332 SOL
  assert.equal(e.lamports, 133_333_333);
  assert.equal(e.sizeSol, e.lamports / LAMPORTS_PER_SOL);
  assert.ok(Number.isSafeInteger(e.lamports));
});

test("la taille suit l'equity (anti-martingale) : equity × 2 → taille × 2 tant qu'aucun plafond ne mord", () => {
  const a = sizePosition(input({ equity: equity({ freeSol: 3 }) }));
  const b = sizePosition(input({ equity: equity({ freeSol: 6 }) }));
  assert.equal(a.lamports, 120_000_000);
  assert.equal(b.lamports, 240_000_000);
  assert.equal(b.lamports, 2 * a.lamports);
  assert.deepEqual([a.capsApplied, b.capsApplied], [[], []]);
  // Après une perte (liquidation 7.12 → 5 SOL) la taille baisse ; après un gain (→ 9 SOL) elle monte.
  const ref = sizePosition(input()).sizeSol;
  assert.ok(sizePosition(input({ equity: equity({ freeSol: 5 }) })).sizeSol < ref);
  assert.ok(sizePosition(input({ equity: equity({ freeSol: 9 }) })).sizeSol > ref);
});

test('plafonds en dur : une SizerConfig hors bornes ne peut pas les dépasser', () => {
  const loose: SizerConfig = { ...CFG, maxPositionSol: 5, maxOpenPositions: 50, maxExposurePct: 100, maxPoolSharePct: 10 };
  const rich = equity({ freeSol: 30 });
  // Par position : 4 % de 30 = 1.2 SOL → plafonné à HARD_LIMITS.maxPositionSol (1 SOL), pas à 5.
  const big = sizePosition(
    input({ equity: rich, cfg: loose, candidate: candidate({ liquidityUsd: 5_000_000 }), solUsd: 160 }),
  );
  assert.equal(big.lamports, HARD_LIMITS.maxPositionSol * LAMPORTS_PER_SOL);
  assert.deepEqual(big.capsApplied, ['MAX_POSITION']);
  // Pool : 2 % (en dur) de 6 000 $ à 160 $/SOL = 0.75 SOL, et non 10 % (3.75 SOL).
  const pool = sizePosition(input({ equity: rich, cfg: loose, candidate: candidate({ liquidityUsd: 6_000 }), solUsd: 160 }));
  assert.equal(pool.lamports, 750_000_000);
  assert.ok(pool.reason.includes('plafond liquidité (2 % de 6.0 k$) = 0.750 SOL'), pool.reason);
  // Positions : 5 ouvertes (maximum en dur) → refus malgré maxOpenPositions = 50.
  const five = ['TokenA', 'TokenB', 'TokenC', 'TokenD', 'TokenE'].map((m) => position(m, 0.1));
  assertSkip(
    sizePosition(input({ equity: equity({ freeSol: 29.5, positionsValueSol: 0.5 }), cfg: loose, openPositions: five })),
    '5 positions ouvertes ≥ maximum 5',
  );
  // Exposition : 50 % (en dur) de 10 SOL déjà engagés → refus malgré maxExposurePct = 100.
  assertSkip(
    sizePosition(
      input({ equity: equity({ freeSol: 5, positionsValueSol: 5 }), cfg: loose, openPositions: [position('TokenA', 5)] }),
    ),
    "exposition 5.000 SOL ≥ plafond 5.000 SOL (50 % de l'equity 10.000 SOL)",
  );
});

// ---------------------------------------------------------------------------
// Propriété : quelles que soient les entrées, jamais une taille injustifiable
// ---------------------------------------------------------------------------

/** Générateur pseudo-aléatoire déterministe (mulberry32) : le test est reproductible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

test("propriété : 5 000 entrées aléatoires, tous les plafonds respectés et aucune entrée invalide acceptée", () => {
  const rnd = mulberry32(20261108);
  const BAD = [NaN, Infinity, -Infinity, -1, -1e-12];
  const TOL = 1e-12; // bien en dessous du lamport (1e-9 SOL)
  let accepted = 0;
  for (let n = 0; n < 5000; n++) {
    let invalid = false;
    // Valeur valide la plupart du temps ; une fois sur 50, une valeur invalide.
    const v = (x: number): number => {
      if (rnd() >= 0.02) return x;
      invalid = true;
      return BAD[Math.floor(rnd() * BAD.length)] ?? NaN;
    };
    const positions: Position[] = [];
    const count = Math.floor(rnd() * 5);
    for (let k = 0; k < count; k++) {
      positions.push(position(rnd() < 0.05 ? CANDIDATE_MINT : `Token${k}`, v(rnd() * 1.5)));
    }
    const exposure = positions.reduce((sum, p) => sum + p.lastValueSol, 0);
    const freeSol = v(rnd() * 20);
    // Equity cohérente 3 fois sur 4, sinon quelconque (SOL en transit, valeurs périmées…).
    const equitySol = v(rnd() < 0.75 ? freeSol + exposure : rnd() * 30);
    const eq: EquitySnapshot = {
      at: AT,
      freeSol,
      positionsValueSol: exposure,
      equitySol,
      peakEquitySol: v(equitySol * (1 + rnd())),
      initialEquitySol: v(10),
      drawdownPct: v(rnd() * 60),
      returnPct: rnd() * 200 - 100,
    };
    const cfg: SizerConfig =
      rnd() < 0.5
        ? CFG
        : {
            positionPct: v(rnd() * 10),
            minPositionSol: v(rnd() * 0.2),
            maxPositionSol: v(rnd() * 2),
            maxOpenPositions: v(Math.floor(rnd() * 7)),
            maxExposurePct: v(rnd() * 120),
            maxPoolSharePct: v(rnd() * 5),
            feeReserveSol: v(rnd() * 0.2),
            drawdownHalveAtPct: v(rnd() * 50),
          };
    const cand = candidate({ liquidityUsd: v(10 ** (2 + rnd() * 5)) });
    const solUsd = v(50 + rnd() * 300);

    const d = sizePosition({ equity: eq, openPositions: positions, candidate: cand, solUsd, cfg });

    assert.ok(d.reason.length > 0);
    if (!d.ok) {
      assert.equal(d.sizeSol, 0);
      assert.equal(d.lamports, 0);
      continue;
    }
    accepted++;
    assert.equal(invalid, false, `entrée invalide acceptée : ${d.reason}`);
    assert.ok(Number.isSafeInteger(d.lamports) && d.lamports >= 1);
    assert.equal(d.sizeSol, d.lamports / LAMPORTS_PER_SOL);
    assert.ok(d.sizeSol >= cfg.minPositionSol, 'sous le minimum');
    const halving = eq.drawdownPct >= cfg.drawdownHalveAtPct ? 2 : 1;
    assert.ok(d.sizeSol <= (eq.equitySol * cfg.positionPct) / 100 / halving + TOL, 'au-delà de la base');
    assert.ok(d.sizeSol <= Math.min(cfg.maxPositionSol, HARD_LIMITS.maxPositionSol) + TOL, 'au-delà du plafond par position');
    const exposurePct = Math.min(cfg.maxExposurePct, HARD_LIMITS.maxExposurePct);
    assert.ok(exposure + d.sizeSol <= (eq.equitySol * exposurePct) / 100 + TOL, "au-delà du plafond d'exposition");
    const poolPct = Math.min(cfg.maxPoolSharePct, HARD_LIMITS.maxPoolSharePct);
    assert.ok(d.sizeSol <= (cand.liquidityUsd * poolPct) / 100 / solUsd + TOL, 'au-delà de la part du pool');
    assert.ok(d.sizeSol <= eq.freeSol - cfg.feeReserveSol + TOL, 'au-delà du SOL libre hors réserve');
    assert.ok(positions.length < Math.min(cfg.maxOpenPositions, HARD_LIMITS.maxOpenPositions), 'trop de positions');
    assert.ok(!positions.some((p) => p.mint === cand.mint), 'token déjà détenu');
    assert.ok(d.reason.includes('taille retenue'));
  }
  assert.ok(accepted > 500, `trop peu de cas acceptés pour que la propriété soit probante (${accepted})`);
});
