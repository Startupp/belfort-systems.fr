/**
 * Récupère le loyer des comptes de tokens VIDES du wallet du bot (~0.002 SOL chacun).
 *
 *   npm run reclaim            → liste seulement (aucune transaction)
 *   npm run reclaim -- --yes   → ferme les comptes vides (le loyer revient au wallet du bot)
 *
 * Ne touche jamais un compte qui contient encore des tokens (la fermeture échouerait de toute façon).
 */

import { loadConfig, loadDotEnv } from '../src/config.ts';
import { createHttp } from '../src/lib/http.ts';
import { loadKeypairFile } from '../src/lib/keypair.ts';
import { createRpc } from '../src/lib/rpc.ts';
import { reclaimRent } from '../src/maintenance.ts';

loadDotEnv();
const config = loadConfig();
if (!config.rpcUrl) {
  console.error('RPC_URL manquant dans .env');
  process.exit(1);
}
const yes = process.argv.includes('--yes');
const { signer, warnings } = loadKeypairFile(config.keypairPath);
for (const w of warnings) console.warn(`ATTENTION : ${w}`);
const rpc = createRpc({ http: createHttp(), url: config.rpcUrl });

const r = await reclaimRent(rpc, signer, !yes);
console.log(`${r.emptyAccounts.length} compte(s) de token vide(s) sur ${signer.publicKey}`);
console.log(`loyer récupérable estimé : ${(r.estimatedLamports / 1e9).toFixed(5)} SOL`);
if (!yes) {
  console.log(r.emptyAccounts.length ? 'Relance avec « npm run reclaim -- --yes » pour les fermer.' : 'Rien à faire.');
} else {
  for (const s of r.signatures) console.log(`ok : https://solscan.io/tx/${s}`);
}
