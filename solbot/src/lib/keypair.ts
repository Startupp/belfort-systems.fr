/**
 * Clé du wallet du bot, sans aucune dépendance : Ed25519 natif de Node (node:crypto).
 *
 * Formats acceptés pour le fichier de clé :
 *   - JSON de 64 nombres (format `solana-keygen`, et celui écrit par `npm run keygen`) ;
 *   - chaîne base58 de 64 octets (export « clé privée » de Phantom).
 *
 * La clé secrète reste enfermée dans la fermeture de `Signer.sign` : aucun champ ne l'expose,
 * elle n'est jamais journalisée ni envoyée où que ce soit.
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as edSign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { decodeBase58, encodeBase58 } from './base58.ts';

export interface Signer {
  /** Adresse publique en base58. */
  readonly publicKey: string;
  readonly publicKeyBytes: Uint8Array;
  /** Signature Ed25519 (64 octets) du message. */
  sign(message: Uint8Array): Uint8Array;
}

// Préfixe DER PKCS#8 d'une clé privée Ed25519 brute de 32 octets (RFC 8410).
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function privateKeyFromSeed(seed: Uint8Array): KeyObject {
  if (seed.length !== 32) throw new Error('graine Ed25519 : 32 octets attendus');
  return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' });
}

function publicKeyBytesOf(priv: KeyObject): Uint8Array {
  const spki = createPublicKey(priv).export({ format: 'der', type: 'spki' });
  return new Uint8Array(spki.subarray(spki.length - 32));
}

/** Construit un signataire depuis la clé secrète Solana de 64 octets (graine ‖ clé publique). */
export function signerFromSecretKey(secret64: Uint8Array): Signer {
  if (secret64.length !== 64) throw new Error(`clé secrète : 64 octets attendus, ${secret64.length} reçus`);
  const priv = privateKeyFromSeed(secret64.subarray(0, 32));
  const pub = publicKeyBytesOf(priv);
  const declared = secret64.subarray(32, 64);
  if (!pub.every((b, i) => b === declared[i])) {
    throw new Error('clé incohérente : la clé publique stockée ne correspond pas à la clé privée');
  }
  const publicKey = encodeBase58(pub);
  return {
    publicKey,
    publicKeyBytes: pub,
    sign(message: Uint8Array): Uint8Array {
      return new Uint8Array(edSign(null, message, priv));
    },
  };
}

export function parseSecretKey(text: string): Uint8Array {
  const t = text.trim();
  if (t.startsWith('[')) {
    const arr: unknown = JSON.parse(t);
    if (!Array.isArray(arr) || arr.length !== 64 || !arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      throw new Error('fichier de clé JSON : tableau de 64 octets attendu');
    }
    return Uint8Array.from(arr as number[]);
  }
  const b = decodeBase58(t);
  if (b.length !== 64) throw new Error(`clé base58 : 64 octets attendus, ${b.length} décodés`);
  return b;
}

export interface LoadedKeypair {
  signer: Signer;
  /** Avertissements (ex. permissions trop ouvertes). */
  warnings: string[];
}

export function loadKeypairFile(path: string): LoadedKeypair {
  if (!existsSync(path)) {
    throw new Error(`fichier de clé introuvable : ${path} (crée-le avec « npm run keygen »)`);
  }
  const warnings: string[] = [];
  if (process.platform !== 'win32') {
    const mode = statSync(path).mode & 0o777;
    if (mode & 0o077) warnings.push(`permissions ${mode.toString(8)} sur ${path} : lisible par d'autres comptes, fais « chmod 600 »`);
  }
  return { signer: signerFromSecretKey(parseSecretKey(readFileSync(path, 'utf8'))), warnings };
}

/** Génère une nouvelle clé et l'écrit (refuse d'écraser un fichier existant). */
export function generateKeypairFile(path: string): { publicKey: string } {
  if (existsSync(path)) throw new Error(`${path} existe déjà : je n'écrase jamais une clé`);
  const { privateKey } = generateKeyPairSync('ed25519');
  const der = privateKey.export({ format: 'der', type: 'pkcs8' });
  const seed = new Uint8Array(der.subarray(der.length - 32));
  const pub = publicKeyBytesOf(privateKey);
  const secret = new Uint8Array(64);
  secret.set(seed, 0);
  secret.set(pub, 32);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(Array.from(secret)), { mode: 0o600, flag: 'wx' });
  if (process.platform !== 'win32') chmodSync(path, 0o600);
  secret.fill(0);
  seed.fill(0);
  return { publicKey: encodeBase58(pub) };
}
