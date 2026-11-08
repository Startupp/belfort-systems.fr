/** Tests du socle : base58, clé, format des transactions, client HTTP, configuration. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, randomBytes, verify } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeBase58, encodeBase58, decodeAddress } from '../src/lib/base58.ts';
import { generateKeypairFile, loadKeypairFile, parseSecretKey, signerFromSecretKey } from '../src/lib/keypair.ts';
import {
  compileLegacyTransaction,
  decodeCompactU16,
  encodeCompactU16,
  parseTransaction,
  signTransaction,
  systemTransfer,
  tokenCloseAccount,
  isStaticSigner,
  isStaticWritable,
  SYSTEM_PROGRAM_ID,
} from '../src/lib/solanaTx.ts';
import { createHttp, HttpError, redact } from '../src/lib/http.ts';
import { ConfigError, HARD_LIMITS, loadConfig } from '../src/config.ts';
import { BLOCKHASH, buildV0, makeSecret } from './helpers.ts';

const addr = (): string => encodeBase58(randomBytes(32));

test('base58 : vecteurs connus et aller-retour', () => {
  assert.equal(encodeBase58(new Uint8Array(32)), '11111111111111111111111111111111');
  assert.deepEqual(decodeBase58('11111111111111111111111111111111'), new Uint8Array(32));
  assert.equal(encodeBase58(Buffer.from('hello world')), 'StV1DL6CwTryKyV');
  assert.equal(Buffer.from(decodeBase58('StV1DL6CwTryKyV')).toString(), 'hello world');
  for (let i = 0; i < 50; i++) {
    const b = randomBytes(1 + (i % 64));
    if (i % 5 === 0) b[0] = 0;
    assert.deepEqual(decodeBase58(encodeBase58(b)), new Uint8Array(b));
  }
  assert.throws(() => decodeBase58('0OIl'), /invalide/);
  assert.equal(decodeAddress('So11111111111111111111111111111111111111112').length, 32);
});

test('clé : signe, refuse une clé incohérente, lit JSON et base58', () => {
  const secret = makeSecret();
  const signer = signerFromSecretKey(secret);
  assert.equal(signer.publicKey, encodeBase58(secret.subarray(32)));
  const msg = randomBytes(100);
  const sig = signer.sign(msg);
  assert.equal(sig.length, 64);
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(secret.subarray(32))]);
  assert.ok(verify(null, msg, createPublicKey({ key: spki, format: 'der', type: 'spki' }), sig));

  const bad = new Uint8Array(secret);
  bad[40] = (bad[40] as number) ^ 1;
  assert.throws(() => signerFromSecretKey(bad), /incohérente/);

  assert.deepEqual(parseSecretKey(JSON.stringify(Array.from(secret))), secret);
  assert.deepEqual(parseSecretKey(encodeBase58(secret)), secret);
  assert.throws(() => parseSecretKey('[1,2,3]'), /64/);
  // La clé secrète n'apparaît dans aucun champ du signataire.
  assert.ok(!JSON.stringify(signer).includes(String(secret[0]) + ',' + String(secret[1])));
});

test('keygen : écrit un fichier 600, refuse d’écraser, se relit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'solbot-key-'));
  const path = join(dir, 'sub', 'keypair.json');
  const { publicKey } = generateKeypairFile(path);
  assert.throws(() => generateKeypairFile(path), /existe déjà/);
  const { signer, warnings } = loadKeypairFile(path);
  assert.equal(signer.publicKey, publicKey);
  assert.deepEqual(warnings, []);
  if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).length, 64);
});

test('compact-u16 : encodage/décodage', () => {
  for (const n of [0, 1, 127, 128, 255, 16383, 16384, 65535]) {
    const enc = encodeCompactU16(n);
    assert.deepEqual(decodeCompactU16(Uint8Array.from(enc), 0), { value: n, size: enc.length });
  }
  assert.deepEqual(encodeCompactU16(0x80), [0x80, 0x01]);
});

test('transaction legacy : compile, relit, signe au bon emplacement', () => {
  const secret = makeSecret();
  const signer = signerFromSecretKey(secret);
  const to = addr();
  const tokenAcc = addr();
  const unsigned = compileLegacyTransaction(
    signer.publicKey,
    [systemTransfer(signer.publicKey, to, 123_456_789n), tokenCloseAccount(tokenAcc, signer.publicKey, signer.publicKey)],
    BLOCKHASH,
  );
  const tx = parseTransaction(unsigned);
  assert.equal(tx.version, 'legacy');
  assert.equal(tx.header.numRequiredSignatures, 1);
  assert.equal(tx.staticKeys[0], signer.publicKey);
  assert.equal(tx.recentBlockhash, BLOCKHASH);
  assert.equal(tx.instructions.length, 2);
  const ix0 = tx.instructions[0]!;
  assert.equal(tx.staticKeys[ix0.programIdIndex], SYSTEM_PROGRAM_ID);
  assert.equal(new DataView(ix0.data.buffer, ix0.data.byteOffset).getBigUint64(4, true), 123_456_789n);
  assert.ok(isStaticSigner(tx, 0) && isStaticWritable(tx, 0));
  const toIdx = tx.staticKeys.indexOf(to);
  assert.ok(!isStaticSigner(tx, toIdx) && isStaticWritable(tx, toIdx));
  const progIdx = tx.staticKeys.indexOf(SYSTEM_PROGRAM_ID);
  assert.ok(!isStaticWritable(tx, progIdx));

  const signed = signTransaction(unsigned, signer);
  const ptx = parseTransaction(signed);
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(secret.subarray(32))]);
  assert.ok(verify(null, ptx.messageBytes, createPublicKey({ key: spki, format: 'der', type: 'spki' }), ptx.signatures[0]!));
  // Le message lui-même n'a pas changé.
  assert.deepEqual(ptx.messageBytes, tx.messageBytes);

  const other = signerFromSecretKey(makeSecret());
  assert.throws(() => signTransaction(unsigned, other), /signataires/);
});

test('transaction v0 : lecture avec table de correspondance et signature', () => {
  const signer = signerFromSecretKey(makeSecret());
  const payer = addr(); // swap « gasless » : quelqu'un d'autre paie, nous signons en 2e
  const bytes = buildV0({
    signers: [payer, signer.publicKey],
    readonlyUnsigned: [SYSTEM_PROGRAM_ID],
    instructions: [{ programIdIndex: 2, accounts: [1, 3], data: [2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0] }],
    lookup: { key: addr(), writable: [5], readonly: [1, 2] },
  });
  const tx = parseTransaction(bytes);
  assert.equal(tx.version, 0);
  assert.equal(tx.lookups.length, 1);
  assert.deepEqual(tx.lookups[0]!.readonlyIndexes, [1, 2]);
  const signed = signTransaction(bytes, signer);
  const p = parseTransaction(signed);
  assert.deepEqual(p.signatures[0], new Uint8Array(64)); // emplacement du payeur intact
  assert.notDeepEqual(p.signatures[1], new Uint8Array(64));
  assert.throws(() => parseTransaction(Uint8Array.from([...bytes, 0])), /inattendus/);
  assert.throws(() => parseTransaction(bytes.subarray(0, 100)), /tronquée/);
});

test('http : nouvelle tentative sur 429 puis succès, pas de nouvelle tentative sur 400', async () => {
  const calls: string[] = [];
  let n = 0;
  const http = createHttp({
    sleep: async () => {},
    fetch: async (url) => {
      calls.push(url);
      n++;
      if (url.includes('/ok') && n === 1) return new Response('slow down', { status: 429 });
      if (url.includes('/bad')) return new Response(JSON.stringify({ error: 'x' }), { status: 400 });
      return new Response(JSON.stringify({ fine: true }), { status: 200 });
    },
    minIntervalMsByHost: { 'example.test': 0 },
  });
  assert.deepEqual(await http.getJson('https://example.test/ok'), { fine: true });
  assert.equal(calls.length, 2);
  await assert.rejects(http.getJson('https://example.test/bad'), (e: unknown) => e instanceof HttpError && e.status === 400 && !e.retryable);
  assert.equal(calls.length, 3);
});

test('http : erreur réseau rejouée puis HttpError status 0', async () => {
  let n = 0;
  const http = createHttp({
    sleep: async () => {},
    retries: 2,
    fetch: async () => {
      n++;
      throw new TypeError('fetch failed');
    },
  });
  await assert.rejects(http.getJson('https://example.test/x'), (e: unknown) => e instanceof HttpError && e.status === 0);
  assert.equal(n, 3);
});

test('http : espacement minimal par hôte (file d’attente)', async () => {
  // Horloge immobile : chaque requête doit attendre son créneau (0, +1 s, +2 s).
  const waits: number[] = [];
  const http = createHttp({
    now: () => 0,
    sleep: async (ms) => {
      waits.push(ms);
    },
    fetch: async () => new Response('{}', { status: 200 }),
    minIntervalMsByHost: { 'slow.test': 1000 },
  });
  await Promise.all([http.getJson('https://slow.test/a'), http.getJson('https://slow.test/b'), http.getJson('https://slow.test/c')]);
  assert.deepEqual(waits, [1000, 2000]);
});

test('redact : masque les clés d’API dans les URL', () => {
  assert.equal(redact('https://rpc.test/?api-key=abc&x=1'), 'https://rpc.test/?api-key=***&x=1');
});

test('config : défauts prudents, plafonds en dur, erreurs claires', () => {
  const base = { JUPITER_API_KEY: 'k' };
  const c = loadConfig(base, '/tmp');
  assert.equal(c.mode, 'paper');
  assert.equal(c.liveConfirmed, false);
  assert.ok(c.sizer.maxPositionSol <= HARD_LIMITS.maxPositionSol);
  assert.ok(c.allowedPrograms.includes('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'));
  // Une faute de frappe ne peut pas dépasser le plafond en dur.
  assert.equal(loadConfig({ ...base, MAX_POSITION_SOL: '50' }, '/tmp').sizer.maxPositionSol, HARD_LIMITS.maxPositionSol);
  assert.equal(loadConfig({ ...base, MAX_OPEN_POSITIONS: '40' }, '/tmp').sizer.maxOpenPositions, HARD_LIMITS.maxOpenPositions);
  assert.equal(loadConfig({ ...base, POSITION_PCT: '4,5' }, '/tmp').sizer.positionPct, 4.5);
  assert.throws(() => loadConfig({}, '/tmp'), ConfigError);
  assert.throws(() => loadConfig({ ...base, MODE: 'yolo' }, '/tmp'), /MODE/);
  assert.throws(() => loadConfig({ ...base, MODE: 'live' }, '/tmp'), /RPC_URL/);
  assert.throws(() => loadConfig({ ...base, POSITION_PCT: '90' }, '/tmp'), /hors bornes/);
  assert.throws(() => loadConfig({ ...base, VAULT_ADDRESS: 'pas-une-adresse' }, '/tmp'), /VAULT_ADDRESS/);
  const live = loadConfig({ ...base, MODE: 'live', RPC_URL: 'https://rpc.test', LIVE_CONFIRM: 'je-peux-perdre-ce-budget' }, '/tmp');
  assert.equal(live.liveConfirmed, true);
});

test('keypair : avertit si le fichier est lisible par d’autres', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'solbot-key2-'));
  const path = join(dir, 'k.json');
  writeFileSync(path, JSON.stringify(Array.from(makeSecret())), { mode: 0o644 });
  const { warnings } = loadKeypairFile(path);
  assert.equal(warnings.length, 1);
});
