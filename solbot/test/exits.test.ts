/** Tests des règles de sortie (fonction pure decideExit) : chaque branche et l'ordre de priorité. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ExitConfig } from '../src/config.ts';
import { SOL_MINT } from '../src/types.ts';
import type { Fill, Position, PositionMark } from '../src/types.ts';
import { decideExit } from '../src/workers/exits.ts';

const T0 = Date.parse('2026-11-08T12:00:00.000Z');
const MIN = 60_000;

const cfg: ExitConfig = {
  stopLossPct: 20,
  takeProfitPct: 35,
  trailArmPct: 15,
  trailPct: 12,
  maxHoldMinutes: 90,
  liquidityDrainPct: 40,
  maxEntryPriceImpactBps: 150,
};

function position(over: Partial<Position> = {}): Position {
  const at = new Date(T0).toISOString();
  const entryFill: Fill = {
    side: 'buy',
    mode: 'paper',
    ok: true,
    at,
    inputMint: SOL_MINT,
    outputMint: 'MemeMint1111111111111111111111111111111111',
    inAmount: '100000000',
    quotedOutAmount: '1000000',
    actualOutAmount: '985000',
    slippageBps: 150,
    feeLamports: 2_189_280,
  };
  return {
    id: 'p-test',
    mint: 'MemeMint1111111111111111111111111111111111',
    symbol: 'MEME',
    decimals: 6,
    pairAddress: 'Pair111111111111111111111111111111111111111',
    openedAt: at,
    entrySol: 0.1,
    tokenAmountRaw: '985000',
    entryLiquidityUsd: 50_000,
    peakValueSol: 0.1,
    lastValueSol: 0.1,
    lastCheckedAt: at,
    entryReasons: ['test'],
    entryFill,
    ...over,
  };
}

const quoted = (valueSol: number, liquidityUsd?: number): PositionMark => ({ ok: true, valueSol, liquidityUsd, source: 'quote' });
const at = (minutes: number): number => T0 + minutes * MIN;

describe('decideExit : pas de sortie', () => {
  it('position saine : rien ne se déclenche', () => {
    assert.deepEqual(decideExit(position(), quoted(0.105, 48_000), at(10), cfg), { exit: false });
  });

  it("ne modifie jamais la position (fonction pure)", () => {
    const p = position({ peakValueSol: 0.12 });
    const before = structuredClone(p);
    decideExit(p, quoted(0.2, 10_000), at(200), cfg);
    decideExit(p, quoted(0.05), at(5), cfg);
    assert.deepEqual(p, before);
  });

  it('horodatage invalide : erreur de programmation, on lève', () => {
    assert.throws(() => decideExit(position(), quoted(0.1), Number.NaN, cfg), /horodatage invalide/);
  });
});

describe('decideExit : stop-loss', () => {
  it('se déclenche pile au seuil (−20 %), malgré les arrondis binaires', () => {
    const d = decideExit(position(), quoted(0.08), at(5), cfg);
    assert.equal(d.exit, true);
    assert.equal(d.reason, 'STOP_LOSS');
    assert.equal(d.detail, "−20 % depuis l'entrée (stop à −20 %)");
  });

  it('libellé avec une décimale et un point (exemple de la spécification)', () => {
    const d = decideExit(position(), quoted(0.0796), at(5), cfg);
    assert.equal(d.reason, 'STOP_LOSS');
    assert.equal(d.detail, "−20.4 % depuis l'entrée (stop à −20 %)");
  });

  it('juste au-dessus du seuil (−19.9 %) : pas de sortie', () => {
    assert.equal(decideExit(position(), quoted(0.0801), at(5), cfg).exit, false);
  });

  it('valeur nulle (rug) : stop-loss à −100 %', () => {
    const d = decideExit(position(), quoted(0), at(1), cfg);
    assert.equal(d.reason, 'STOP_LOSS');
    assert.match(d.detail ?? '', /^−100 % depuis l'entrée/);
  });

  it('marche aussi avec une évaluation au prix (source « price »)', () => {
    const d = decideExit(position(), { ok: true, valueSol: 0.07, source: 'price' }, at(1), cfg);
    assert.equal(d.reason, 'STOP_LOSS');
  });
});

describe('decideExit : liquidité qui fond', () => {
  it('baisse de 40 % (seuil inclus) : LIQUIDITY_DRAIN avec les montants', () => {
    const d = decideExit(position(), quoted(0.1, 30_000), at(5), cfg);
    assert.equal(d.reason, 'LIQUIDITY_DRAIN');
    assert.equal(d.detail, "liquidité en baisse de 40 % depuis l'entrée (50000 $ → 30000 $, seuil 40 %)");
  });

  it('baisse de 38 % : pas de sortie', () => {
    assert.equal(decideExit(position(), quoted(0.1, 31_000), at(5), cfg).exit, false);
  });

  it('liquidité inconnue ou liquidité d\'entrée nulle : règle ignorée', () => {
    assert.equal(decideExit(position(), quoted(0.1), at(5), cfg).exit, false);
    assert.equal(decideExit(position({ entryLiquidityUsd: 0 }), quoted(0.1, 1), at(5), cfg).exit, false);
  });

  it('liquidité tombée à zéro : 100 % de baisse', () => {
    const d = decideExit(position(), quoted(0.1, 0), at(5), cfg);
    assert.equal(d.reason, 'LIQUIDITY_DRAIN');
    assert.match(d.detail ?? '', /baisse de 100 %/);
  });
});

describe('decideExit : prise de bénéfice', () => {
  it('+35 % pile : TAKE_PROFIT', () => {
    const d = decideExit(position(), quoted(0.135, 50_000), at(5), cfg);
    assert.equal(d.reason, 'TAKE_PROFIT');
    assert.equal(d.detail, "+35 % depuis l'entrée (objectif +35 %)");
  });

  it('+34.9 % : pas de sortie (le nouveau plus haut ne déclenche pas le stop suiveur)', () => {
    assert.equal(decideExit(position(), quoted(0.1349, 50_000), at(5), cfg).exit, false);
  });
});

describe('decideExit : stop suiveur', () => {
  it('armé (plus haut +20 % ≥ 15 %) et recul de 16.7 % ≥ 12 % : TRAILING_STOP', () => {
    const d = decideExit(position({ peakValueSol: 0.12 }), quoted(0.1), at(5), cfg);
    assert.equal(d.reason, 'TRAILING_STOP');
    assert.equal(d.detail, 'recul de 16.7 % depuis le plus haut 0.12 SOL (stop suiveur 12 %)');
  });

  it('libellé de la spécification : recul de 13.1 % depuis 0.412 SOL', () => {
    const d = decideExit(position({ entrySol: 0.3, peakValueSol: 0.412 }), quoted(0.358028), at(5), cfg);
    assert.equal(d.reason, 'TRAILING_STOP');
    assert.equal(d.detail, 'recul de 13.1 % depuis le plus haut 0.412 SOL (stop suiveur 12 %)');
  });

  it('non armé (plus haut +14 % < 15 %) : un recul de 12.3 % ne déclenche rien', () => {
    assert.equal(decideExit(position({ peakValueSol: 0.114 }), quoted(0.1), at(5), cfg).exit, false);
  });

  it('armé pile au seuil (+15 %) avec un recul pile de 12 % : déclenché', () => {
    const d = decideExit(position({ peakValueSol: 0.115 }), quoted(0.1012), at(5), cfg);
    assert.equal(d.reason, 'TRAILING_STOP');
  });

  it('armé mais recul de 10.8 % < 12 % : pas de sortie', () => {
    assert.equal(decideExit(position({ peakValueSol: 0.12 }), quoted(0.107), at(5), cfg).exit, false);
  });

  it('la valeur mesurée devient le plus haut : aucun recul, pas de sortie', () => {
    assert.equal(decideExit(position({ peakValueSol: 0.1 }), quoted(0.13), at(5), cfg).exit, false);
  });

  it("plus haut stocké illisible : on repart de la valeur mesurée", () => {
    assert.equal(decideExit(position({ peakValueSol: Number.NaN }), quoted(0.12), at(5), cfg).exit, false);
  });
});

describe('decideExit : durée maximale', () => {
  it('90 min pile : TIME_STOP avec le P&L courant', () => {
    const d = decideExit(position(), quoted(0.104), at(90), cfg);
    assert.equal(d.reason, 'TIME_STOP');
    assert.equal(d.detail, "détenue depuis 90 min (maximum 90 min), +4 % depuis l'entrée");
  });

  it('89 min : pas encore', () => {
    assert.equal(decideExit(position(), quoted(0.104), at(89), cfg).exit, false);
  });

  it('date d\'ouverture illisible : sortie par prudence', () => {
    const d = decideExit(position({ openedAt: 'pas une date' }), quoted(0.104), at(1), cfg);
    assert.equal(d.reason, 'TIME_STOP');
    assert.match(d.detail ?? '', /date d'ouverture illisible/);
  });
});

describe('decideExit : position non évaluable', () => {
  const unpriced: PositionMark = { ok: false, valueSol: 0, liquidityUsd: 1_000, source: 'none', error: 'pas de route' };

  it('avant la durée maximale : rien, même si la valeur 0 et la liquidité vidée feraient sortir', () => {
    assert.deepEqual(decideExit(position(), unpriced, at(30), cfg), { exit: false });
  });

  it('à la durée maximale : TIME_STOP, détail « valeur inconnue »', () => {
    const d = decideExit(position(), unpriced, at(95), cfg);
    assert.equal(d.reason, 'TIME_STOP');
    assert.equal(d.detail, 'détenue depuis 95 min (maximum 90 min), valeur inconnue (pas de route)');
  });

  it("source « none » même avec ok:true : traitée comme non évaluable", () => {
    const m: PositionMark = { ok: true, valueSol: 0, source: 'none' };
    assert.equal(decideExit(position(), m, at(10), cfg).exit, false);
    assert.equal(decideExit(position(), m, at(90), cfg).reason, 'TIME_STOP');
  });

  it("valeur non finie ou prix d'entrée nul : non évaluable", () => {
    assert.equal(decideExit(position(), quoted(Number.NaN), at(10), cfg).exit, false);
    assert.equal(decideExit(position({ entrySol: 0 }), quoted(0.5), at(10), cfg).exit, false);
    assert.equal(decideExit(position({ entrySol: 0 }), quoted(0.5), at(90), cfg).reason, 'TIME_STOP');
  });
});

describe('decideExit : ordre de priorité', () => {
  it('stop-loss avant liquidité, avant durée', () => {
    assert.equal(decideExit(position(), quoted(0.07, 10_000), at(120), cfg).reason, 'STOP_LOSS');
  });

  it('stop-loss avant prise de bénéfice (configuration artificielle où les deux se déclenchent)', () => {
    const odd: ExitConfig = { ...cfg, stopLossPct: -10, takeProfitPct: 5 }; // « stop » si P&L ≤ +10 %
    assert.equal(decideExit(position(), quoted(0.108), at(1), odd).reason, 'STOP_LOSS');
  });

  it('liquidité avant prise de bénéfice', () => {
    assert.equal(decideExit(position(), quoted(0.15, 20_000), at(5), cfg).reason, 'LIQUIDITY_DRAIN');
  });

  it('prise de bénéfice avant stop suiveur (+40 % mais recul de 30 % depuis 0.2 SOL)', () => {
    assert.equal(decideExit(position({ peakValueSol: 0.2 }), quoted(0.14), at(5), cfg).reason, 'TAKE_PROFIT');
  });

  it('stop suiveur avant durée', () => {
    assert.equal(decideExit(position({ peakValueSol: 0.12 }), quoted(0.1), at(120), cfg).reason, 'TRAILING_STOP');
  });

  it('liquidité avant stop suiveur et durée', () => {
    assert.equal(decideExit(position({ peakValueSol: 0.12 }), quoted(0.1, 5_000), at(120), cfg).reason, 'LIQUIDITY_DRAIN');
  });
});
