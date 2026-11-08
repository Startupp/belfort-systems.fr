/**
 * Format binaire des transactions Solana (legacy et v0), sans dépendance.
 *
 *   transaction = compact-u16 n · n × signature(64) · message
 *   message     = [0x80 | version]? · en-tête(3) · clés statiques · blockhash(32) · instructions · [lookups v0]
 *
 * Sert à : (1) inspecter une transaction reçue de Jupiter AVANT de la signer (pare-feu),
 * (2) la signer, (3) construire nous-mêmes de petites transactions legacy (virement vers le coffre,
 * fermeture de comptes de tokens vides pour récupérer le loyer).
 */

import { decodeAddress, decodeBase58, encodeBase58 } from './base58.ts';
import type { Signer } from './keypair.ts';

export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';

// ---------------------------------------------------------------------------
// compact-u16
// ---------------------------------------------------------------------------

export function encodeCompactU16(n: number): number[] {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new Error(`compact-u16 hors bornes : ${n}`);
  const out: number[] = [];
  let rem = n;
  for (;;) {
    const elem = rem & 0x7f;
    rem >>= 7;
    if (rem === 0) {
      out.push(elem);
      return out;
    }
    out.push(elem | 0x80);
  }
}

export function decodeCompactU16(bytes: Uint8Array, offset: number): { value: number; size: number } {
  let value = 0;
  for (let size = 0; size < 3; size++) {
    const b = bytes[offset + size];
    if (b === undefined) throw new Error('transaction tronquée (compact-u16)');
    value |= (b & 0x7f) << (size * 7);
    if ((b & 0x80) === 0) return { value, size: size + 1 };
  }
  throw new Error('compact-u16 invalide');
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export interface CompiledInstruction {
  programIdIndex: number;
  accountIndexes: number[];
  data: Uint8Array;
}

export interface AddressTableLookup {
  accountKey: string;
  writableIndexes: number[];
  readonlyIndexes: number[];
}

export interface ParsedTransaction {
  signatures: Uint8Array[];
  /** Octets du message (ce qui est signé). */
  messageBytes: Uint8Array;
  /** Position du message dans la transaction complète. */
  messageOffset: number;
  version: 'legacy' | 0;
  header: { numRequiredSignatures: number; numReadonlySigned: number; numReadonlyUnsigned: number };
  staticKeys: string[];
  recentBlockhash: string;
  instructions: CompiledInstruction[];
  lookups: AddressTableLookup[];
}

class Reader {
  offset = 0;
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  u8(): number {
    const b = this.bytes[this.offset];
    if (b === undefined) throw new Error('transaction tronquée');
    this.offset++;
    return b;
  }
  take(n: number): Uint8Array {
    if (this.offset + n > this.bytes.length) throw new Error('transaction tronquée');
    const s = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    return s;
  }
  len(): number {
    const { value, size } = decodeCompactU16(this.bytes, this.offset);
    this.offset += size;
    return value;
  }
}

export function parseTransaction(bytes: Uint8Array): ParsedTransaction {
  const r = new Reader(bytes);
  const nSig = r.len();
  const signatures: Uint8Array[] = [];
  for (let i = 0; i < nSig; i++) signatures.push(new Uint8Array(r.take(64)));
  const messageOffset = r.offset;

  let version: 'legacy' | 0 = 'legacy';
  const first = bytes[r.offset];
  if (first === undefined) throw new Error('message vide');
  if (first & 0x80) {
    const v = first & 0x7f;
    if (v !== 0) throw new Error(`version de message non gérée : ${v}`);
    version = 0;
    r.offset++;
  }
  const header = { numRequiredSignatures: r.u8(), numReadonlySigned: r.u8(), numReadonlyUnsigned: r.u8() };
  const nKeys = r.len();
  const staticKeys: string[] = [];
  for (let i = 0; i < nKeys; i++) staticKeys.push(encodeBase58(r.take(32)));
  const recentBlockhash = encodeBase58(r.take(32));
  const nIx = r.len();
  const instructions: CompiledInstruction[] = [];
  for (let i = 0; i < nIx; i++) {
    const programIdIndex = r.u8();
    const nAcc = r.len();
    const accountIndexes = Array.from(r.take(nAcc));
    const dataLen = r.len();
    instructions.push({ programIdIndex, accountIndexes, data: new Uint8Array(r.take(dataLen)) });
  }
  const lookups: AddressTableLookup[] = [];
  if (version === 0) {
    const nLookups = r.len();
    for (let i = 0; i < nLookups; i++) {
      const accountKey = encodeBase58(r.take(32));
      const writableIndexes = Array.from(r.take(r.len()));
      const readonlyIndexes = Array.from(r.take(r.len()));
      lookups.push({ accountKey, writableIndexes, readonlyIndexes });
    }
  }
  if (r.offset !== bytes.length) throw new Error(`octets inattendus après le message (${bytes.length - r.offset})`);
  if (signatures.length !== header.numRequiredSignatures) {
    throw new Error(`incohérence : ${signatures.length} signatures pour ${header.numRequiredSignatures} signataires`);
  }
  return {
    signatures,
    messageBytes: new Uint8Array(bytes.subarray(messageOffset)),
    messageOffset,
    version,
    header,
    staticKeys,
    recentBlockhash,
    instructions,
    lookups,
  };
}

/** Nombre total de comptes adressables (statiques + chargés via tables de correspondance). */
export function totalAccountCount(tx: ParsedTransaction): number {
  return tx.staticKeys.length + tx.lookups.reduce((n, l) => n + l.writableIndexes.length + l.readonlyIndexes.length, 0);
}

/** Clé d'un index de compte, ou null si elle vient d'une table de correspondance (inconnue hors RPC). */
export function staticKeyAt(tx: ParsedTransaction, index: number): string | null {
  return index < tx.staticKeys.length ? (tx.staticKeys[index] as string) : null;
}

export function isStaticSigner(tx: ParsedTransaction, index: number): boolean {
  return index < tx.header.numRequiredSignatures;
}

export function isStaticWritable(tx: ParsedTransaction, index: number): boolean {
  const { numRequiredSignatures: s, numReadonlySigned: rs, numReadonlyUnsigned: ru } = tx.header;
  if (index < s) return index < s - rs;
  return index < tx.staticKeys.length - ru;
}

// ---------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------

/** Signe la transaction : place la signature dans l'emplacement correspondant à notre clé. */
export function signTransaction(bytes: Uint8Array, signer: Signer): Uint8Array {
  const tx = parseTransaction(bytes);
  const idx = tx.staticKeys.indexOf(signer.publicKey);
  if (idx < 0 || idx >= tx.header.numRequiredSignatures) {
    throw new Error('notre clé ne fait pas partie des signataires requis de cette transaction');
  }
  const sig = signer.sign(tx.messageBytes);
  const out = new Uint8Array(bytes);
  // Les signatures commencent juste après le compact-u16 du nombre de signatures.
  const sigStart = decodeCompactU16(bytes, 0).size + idx * 64;
  out.set(sig, sigStart);
  return out;
}

/** Signature de la transaction (identifiant, base58) : la première signature. */
export function transactionId(bytes: Uint8Array): string {
  const tx = parseTransaction(bytes);
  const first = tx.signatures[0];
  if (!first) throw new Error('transaction sans signature');
  return encodeBase58(first);
}

// ---------------------------------------------------------------------------
// Construction (legacy) : nos propres petites transactions
// ---------------------------------------------------------------------------

export interface AccountMeta {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

export interface Instruction {
  programId: string;
  keys: AccountMeta[];
  data: Uint8Array;
}

/** Construit une transaction legacy NON signée (emplacements de signature à zéro). */
export function compileLegacyTransaction(payer: string, instructions: Instruction[], recentBlockhash: string): Uint8Array {
  type Flags = { signer: boolean; writable: boolean };
  const metas = new Map<string, Flags>();
  const touch = (k: string, signer: boolean, writable: boolean): void => {
    decodeAddress(k); // valide
    const f = metas.get(k) ?? { signer: false, writable: false };
    f.signer ||= signer;
    f.writable ||= writable;
    metas.set(k, f);
  };
  touch(payer, true, true);
  for (const ix of instructions) {
    for (const k of ix.keys) touch(k.pubkey, k.isSigner, k.isWritable);
    touch(ix.programId, false, false);
  }
  const others = [...metas.entries()].filter(([k]) => k !== payer);
  const group = (signer: boolean, writable: boolean): string[] =>
    others.filter(([, f]) => f.signer === signer && f.writable === writable).map(([k]) => k);
  const keys = [payer, ...group(true, true), ...group(true, false), ...group(false, true), ...group(false, false)];
  const numSigners = 1 + group(true, true).length + group(true, false).length;
  const header = [numSigners, group(true, false).length, group(false, false).length];

  const index = new Map(keys.map((k, i) => [k, i]));
  const msg: number[] = [...header, ...encodeCompactU16(keys.length)];
  for (const k of keys) msg.push(...decodeAddress(k));
  const bh = decodeBase58(recentBlockhash);
  if (bh.length !== 32) throw new Error('blockhash invalide');
  msg.push(...bh);
  msg.push(...encodeCompactU16(instructions.length));
  for (const ix of instructions) {
    msg.push(index.get(ix.programId) as number);
    msg.push(...encodeCompactU16(ix.keys.length));
    for (const k of ix.keys) msg.push(index.get(k.pubkey) as number);
    msg.push(...encodeCompactU16(ix.data.length));
    msg.push(...ix.data);
  }
  const sigCount = encodeCompactU16(numSigners);
  const out = new Uint8Array(sigCount.length + numSigners * 64 + msg.length);
  out.set(sigCount, 0);
  out.set(msg, sigCount.length + numSigners * 64);
  return out;
}

function u64le(n: bigint): Uint8Array {
  if (n < 0n || n > 0xffffffffffffffffn) throw new Error('u64 hors bornes');
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
}

/** Virement de SOL (System Program, instruction 2). */
export function systemTransfer(from: string, to: string, lamports: bigint): Instruction {
  const data = new Uint8Array(12);
  new DataView(data.buffer).setUint32(0, 2, true);
  data.set(u64le(lamports), 4);
  return {
    programId: SYSTEM_PROGRAM_ID,
    keys: [
      { pubkey: from, isSigner: true, isWritable: true },
      { pubkey: to, isSigner: false, isWritable: true },
    ],
    data,
  };
}

/** Fermeture d'un compte de token VIDE ; le loyer (~0,002 SOL) revient à `destination`. */
export function tokenCloseAccount(account: string, destination: string, owner: string, programId = TOKEN_PROGRAM_ID): Instruction {
  return {
    programId,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Uint8Array.of(9),
  };
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export function fromBase64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'));
}
