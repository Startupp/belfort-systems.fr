/**
 * Crée la clé du wallet DÉDIÉ au bot (jamais ta seed Phantom principale).
 *
 *   npm run keygen          → écrit ~/.solbot/keypair.json (ou KEYPAIR_PATH), droits 600
 *
 * Le fichier est hors du dépôt git par défaut : impossible de le publier par erreur.
 */

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadDotEnv } from '../src/config.ts';
import { generateKeypairFile } from '../src/lib/keypair.ts';

loadDotEnv();
const raw = process.env.KEYPAIR_PATH?.trim() || '~/.solbot/keypair.json';
const path = raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\') ? join(homedir(), raw.slice(2)) : resolve(raw);

try {
  const { publicKey } = generateKeypairFile(path);
  console.log(`
Clé créée : ${path}
Adresse publique du bot : ${publicKey}

À faire maintenant :
  1. Sauvegarde ce fichier hors ligne (clé USB) : sans lui, les fonds du bot sont perdus.
  2. Ne le mets JAMAIS dans un dossier synchronisé (iCloud, Google Drive, OneDrive, Dropbox),
     dans git, dans un message, ni dans une capture d'écran.
  3. N'envoie à cette adresse que le budget que tu acceptes de perdre, en commençant petit
     (ex. 0.1 SOL pour les premiers essais live), toujours après un virement test de 0.01 SOL.
  4. Copie l'adresse depuis ce terminal, pas depuis ton historique de transactions
     (empoisonnement d'adresse : des escrocs envoient des micro-montants depuis des adresses
     qui ressemblent à la tienne pour que tu copies la mauvaise).
`);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
