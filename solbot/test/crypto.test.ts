import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CRYPTO_CONFIG, CRYPTO_UNIVERSE, callMove } from '../src/desk/crypto.ts';
import type { CryptoCall } from '../src/desk/crypto.ts';

test('portefeuille crypto : uniquement des cryptos, sans ORB, mêmes plafonds que le desk', () => {
  assert.ok(CRYPTO_UNIVERSE.length >= 10);
  assert.ok(CRYPTO_UNIVERSE.every((u) => u.cls === 'crypto'));
  assert.equal(CRYPTO_CONFIG.maxOrbOpen, 0);
  assert.equal(CRYPTO_CONFIG.startEquity, 500);
  assert.equal(CRYPTO_CONFIG.maxOpen, 4);
});

test('callMove : variation dans le sens du call, null si pas encore connue', () => {
  const call: CryptoCall = { at: 0, symbol: 'BTC-USD', side: 'long', source: 'x', price: 100 };
  const priceAt = (t: number): number | null => (t <= 3_600_000 ? 110 : null);
  assert.ok(Math.abs((callMove(call, priceAt, 1) as number) - 0.1) < 1e-12);
  assert.equal(callMove(call, priceAt, 4), null);
  assert.ok(Math.abs((callMove({ ...call, side: 'short' }, priceAt, 1) as number) + 0.1) < 1e-12);
});
