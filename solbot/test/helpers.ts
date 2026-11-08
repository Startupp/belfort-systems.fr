/** Outils partagés par les tests (ce fichier n'est pas lui-même un test). */

import { generateKeyPairSync } from 'node:crypto';
import { decodeAddress, decodeBase58, encodeBase58 } from '../src/lib/base58.ts';
import { encodeCompactU16 } from '../src/lib/solanaTx.ts';

export const BLOCKHASH = encodeBase58(new Uint8Array(32).fill(7));

/** Clé secrète Solana de 64 octets (graine ‖ clé publique) fraîchement générée. */
export function makeSecret(): Uint8Array {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const s = new Uint8Array(64);
  s.set(seed, 0);
  s.set(pub, 32);
  return s;
}

/** Construit une transaction v0 minimale à la main (avec une table de correspondance). */
export function buildV0(opts: {
  signers: string[];
  readonlyUnsigned: string[];
  writableUnsigned?: string[];
  instructions: Array<{ programIdIndex: number; accounts: number[]; data: number[] }>;
  lookup?: { key: string; writable: number[]; readonly: number[] };
}): Uint8Array {
  const keys = [...opts.signers, ...(opts.writableUnsigned ?? []), ...opts.readonlyUnsigned];
  const msg: number[] = [0x80, opts.signers.length, 0, opts.readonlyUnsigned.length, ...encodeCompactU16(keys.length)];
  for (const k of keys) msg.push(...decodeAddress(k));
  msg.push(...decodeBase58(BLOCKHASH));
  msg.push(...encodeCompactU16(opts.instructions.length));
  for (const ix of opts.instructions) {
    msg.push(ix.programIdIndex, ...encodeCompactU16(ix.accounts.length), ...ix.accounts, ...encodeCompactU16(ix.data.length), ...ix.data);
  }
  const lookups = opts.lookup ? [opts.lookup] : [];
  msg.push(...encodeCompactU16(lookups.length));
  for (const l of lookups) {
    msg.push(...decodeAddress(l.key), ...encodeCompactU16(l.writable.length), ...l.writable, ...encodeCompactU16(l.readonly.length), ...l.readonly);
  }
  const n = opts.signers.length;
  return Uint8Array.from([...encodeCompactU16(n), ...new Array(64 * n).fill(0), ...msg]);
}

