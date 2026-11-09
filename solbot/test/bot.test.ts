/**
 * Test de bout en bout en mode papier : la chaîne complète des six workers sur de fausses API.
 * scan → anti-rug → taille → achat → valorisation → sortie → journal → courbe d'equity.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createBot } from '../src/main.ts';
import { loadConfig } from '../src/config.ts';
import { encodeBase58 } from '../src/lib/base58.ts';
import { fixedClock } from '../src/lib/store.ts';
import type { Http } from '../src/lib/http.ts';
import type { JupiterClient, JupiterOrder, JupiterToken } from '../src/lib/jupiter.ts';
import type { DexPair, DexScreener } from '../src/lib/dexscreener.ts';
import { SOL_MINT } from '../src/types.ts';
import type { ClosedTrade } from '../src/types.ts';

const T0 = Date.parse('2026-11-09T10:00:00.000Z');
const MINT = encodeBase58(randomBytes(32));
const TOKENS_PER_LAMPORT = 1000n;

interface World {
  /** Multiplicateur du prix du token (1 = prix d'entrée). */
  priceFactor: number;
  /** Liquidité de la paire, en $. */
  liquidityUsd: number;
  rugRisks: Array<{ name: string; value: string; description: string; score: number; level: string }>;
}

function setup(envOverrides: Record<string, string> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'solbot-bot-'));
  const clock = fixedClock(T0);
  const world: World = { priceFactor: 1, liquidityUsd: 60_000, rugRisks: [] };
  const config = loadConfig({ JUPITER_API_KEY: 'test', DATA_DIR: dataDir, PAPER_START_SOL: '7', ...envOverrides }, dataDir);

  const pair = (): DexPair => ({
    chainId: 'solana',
    dexId: 'raydium',
    url: 'https://dexscreener.com/solana/x',
    pairAddress: encodeBase58(new Uint8Array(32).fill(9)),
    labels: [],
    baseToken: { address: MINT, name: 'Test Token', symbol: 'TEST' },
    quoteToken: { address: SOL_MINT, name: 'Wrapped SOL', symbol: 'SOL' },
    priceNative: 0.000001 * world.priceFactor,
    priceUsd: 0.00015 * world.priceFactor,
    liquidityUsd: world.liquidityUsd,
    liquidityBase: 1e8,
    liquidityQuote: 200,
    vol5mUsd: 20_000,
    vol1hUsd: 20_000 + (11 * 20_000) / 4, // pic ×4
    vol6hUsd: 300_000,
    vol24hUsd: 900_000,
    buys5m: 60,
    sells5m: 30,
    buys1h: 300,
    sells1h: 200,
    buys6h: 1500,
    sells6h: 1200,
    buys24h: 5000,
    sells24h: 4500,
    priceChange5mPct: 5,
    priceChange1hPct: 12,
    priceChange6hPct: 30,
    priceChange24hPct: 50,
    marketCapUsd: 2_000_000,
    fdvUsd: 2_000_000,
    pairCreatedAtMs: T0 - 3 * 3_600_000,
    boostsActive: NaN,
  });

  const token: JupiterToken = {
    id: MINT,
    symbol: 'TEST',
    name: 'Test Token',
    decimals: 6,
    organicScore: 70,
    isVerified: false,
    audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 18 },
    stats5m: { numTraders: 54 },
  };

  const jupiter: JupiterClient = {
    async order(p) {
      const amount = BigInt(p.amount);
      let out: bigint;
      if (p.inputMint === SOL_MINT) out = amount * TOKENS_PER_LAMPORT;
      else out = BigInt(Math.floor((Number(amount / TOKENS_PER_LAMPORT) * world.priceFactor * 997) / 1000));
      const o: JupiterOrder = {
        requestId: `req-${Math.random()}`,
        transaction: null,
        inputMint: p.inputMint,
        outputMint: p.outputMint,
        inAmount: p.amount,
        outAmount: out.toString(),
        slippageBps: 50,
        feeBps: 50,
        router: 'metis',
      };
      return o;
    },
    async execute() {
      throw new Error('jamais appelé en papier');
    },
    async tokensByCategory() {
      return [token];
    },
    async tokensRecent() {
      return [];
    },
    async tokensSearch(mints) {
      return mints.includes(MINT) ? [token] : [];
    },
    async prices() {
      return { [SOL_MINT]: { usdPrice: 150 } };
    },
  };

  const dex: DexScreener = {
    async latestProfiles() {
      return [];
    },
    async latestBoosts() {
      return [];
    },
    async pairsForTokens(_chain, addresses) {
      return addresses.includes(MINT) ? [pair()] : [];
    },
  };

  const http: Http = {
    async getJson<T>(url: string): Promise<T> {
      if (url.includes('rugcheck')) {
        return { tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', tokenType: '', risks: world.rugRisks, score: 1, score_normalised: 1, lpLockedPct: 100, mint: MINT } as T;
      }
      throw new Error(`URL inattendue : ${url}`);
    },
    async postJson<T>(): Promise<T> {
      throw new Error('postJson inattendu');
    },
  };

  const lines: string[] = [];
  const bot = createBot({ config, clock, http, jupiter, dex, print: (l) => lines.push(l), sleep: async () => {} });
  return { bot, clock, world, dataDir, lines, config };
}

const trades = (dir: string): ClosedTrade[] =>
  existsSync(join(dir, 'trades.jsonl'))
    ? readFileSync(join(dir, 'trades.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as ClosedTrade)
    : [];

test('cycle complet papier : achat sur pic de volume, vente à l’objectif, courbe mise à jour', async () => {
  const { bot, clock, world, dataDir, lines } = setup();
  await bot.init();
  assert.equal(bot.state.paperSol, 7);

  await bot.scanAndEnter();
  assert.equal(bot.state.positions.length, 1, lines.join('\n'));
  const p = bot.state.positions[0]!;
  assert.equal(p.mint, MINT);
  // 4 % de 7 SOL = 0.28 SOL, plus frais et loyer simulés.
  assert.ok(Math.abs(p.entrySol - (0.28 + 0.00015 + 0.00203928)) < 1e-9, String(p.entrySol));
  assert.ok(p.entryReasons.some((r) => r.includes('anti-rug')), 'la raison anti-rug est dans la chaîne de raisons');
  assert.ok(p.entryReasons.some((r) => r.startsWith('taille')), 'la raison de taille est dans la chaîne de raisons');

  // Le prix reste stable : aucune sortie.
  clock.advance(60_000);
  await bot.manageExits();
  assert.equal(bot.state.positions.length, 1);

  // Le prix monte de 50 % : objectif (+35 %) atteint.
  world.priceFactor = 1.5;
  clock.advance(60_000);
  await bot.manageExits();
  assert.equal(bot.state.positions.length, 0);
  const [t] = trades(dataDir);
  assert.ok(t);
  assert.equal(t.exitReason, 'TAKE_PROFIT');
  assert.ok(t.pnlSol > 0);
  assert.ok(t.entryReasons.length >= 3);
  assert.ok(bot.state.paperSol > 7, 'le capital virtuel a augmenté');
  assert.ok(bot.state.cooldowns[MINT], 'le token est mis en pause après la vente');

  const csv = readFileSync(join(dataDir, 'equity.csv'), 'utf8').trim().split('\n');
  assert.equal(csv.length, 3, 'en-tête + point initial + une clôture');
  assert.ok(existsSync(join(dataDir, 'equity.html')));
  assert.ok(existsSync(join(dataDir, 'stats.json')));
  assert.ok(existsSync(join(dataDir, 'journal', '2026-11-09.jsonl')));

  // Le token est en pause : pas de rachat immédiat.
  world.priceFactor = 1;
  clock.advance(60_000);
  await bot.scanAndEnter();
  assert.equal(bot.state.positions.length, 0);
});

test('stop à −20 % puis pas de nouvelle entrée sur le même token', async () => {
  const { bot, clock, world, dataDir } = setup();
  await bot.init();
  await bot.scanAndEnter();
  assert.equal(bot.state.positions.length, 1);
  world.priceFactor = 0.7;
  clock.advance(30_000);
  await bot.manageExits();
  const [t] = trades(dataDir);
  assert.equal(t?.exitReason, 'STOP_LOSS');
  assert.ok((t?.pnlSol ?? 0) < 0);
  assert.equal(bot.state.consecutiveLosses, 1);
});

test('anti-rug : un risque « danger » bloque l’achat et le rejet est journalisé', async () => {
  const { bot, world, dataDir } = setup();
  world.rugRisks = [{ name: 'Freeze Authority still enabled', value: '', description: 'x', score: 5000, level: 'danger' }];
  await bot.init();
  await bot.scanAndEnter();
  assert.equal(bot.state.positions.length, 0);
  const rejects = readFileSync(join(dataDir, 'rejects.jsonl'), 'utf8');
  assert.match(rejects, /RUGCHECK_DANGER|BLOCKED_RISK/);
});

test('fichier STOP : aucune entrée ; fichier PANIC : tout est vendu', async () => {
  const { bot, clock, dataDir } = setup();
  await bot.init();
  writeFileSync(join(dataDir, 'STOP'), '');
  await bot.scanAndEnter();
  assert.equal(bot.state.positions.length, 0);

  const { bot: bot2, clock: clock2, dataDir: dir2 } = setup();
  await bot2.init();
  await bot2.scanAndEnter();
  assert.equal(bot2.state.positions.length, 1);
  writeFileSync(join(dir2, 'PANIC'), '');
  clock2.advance(10_000);
  await bot2.manageExits();
  assert.equal(bot2.state.positions.length, 0);
  assert.equal(trades(dir2)[0]?.exitReason, 'PANIC');
  void clock;
});

test('liquidité qui fond de 40 % : sortie immédiate', async () => {
  const { bot, clock, world, dataDir } = setup();
  await bot.init();
  await bot.scanAndEnter();
  world.liquidityUsd = 20_000;
  world.priceFactor = 0.95;
  clock.advance(20_000);
  await bot.manageExits();
  assert.equal(trades(dataDir)[0]?.exitReason, 'LIQUIDITY_DRAIN');
});

test('état papier relu au redémarrage ; un dossier papier refuse le mode live', async () => {
  const { bot, dataDir } = setup();
  await bot.init();
  await bot.scanAndEnter();
  const state = JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8'));
  assert.equal(state.positions.length, 1);
  assert.equal(state.mode, 'paper');
  const live = loadConfig({ JUPITER_API_KEY: 'k', MODE: 'live', RPC_URL: 'https://rpc.test', DATA_DIR: dataDir }, dataDir);
  assert.throws(() => createBot({ config: live, print: () => {} }), /DATA_DIR/);
});
