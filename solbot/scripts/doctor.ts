/**
 * Diagnostic avant de lancer le bot (et à relancer quand quelque chose semble bizarre) :
 *   - configuration et clé d'API ;
 *   - chaque API répond ET renvoie les champs attendus (les API changent sans prévenir :
 *     un champ renommé ne doit pas devenir « token sûr » par défaut) ;
 *   - RPC, clé du wallet, solde ;
 *   - essai à blanc du pare-feu sur une VRAIE transaction Jupiter (jamais signée ni envoyée).
 *
 *   npm run doctor
 */

import { existsSync } from 'node:fs';
import { loadConfig, loadDotEnv } from '../src/config.ts';
import { createHttp } from '../src/lib/http.ts';
import { createJupiterClient } from '../src/lib/jupiter.ts';
import { createRpc } from '../src/lib/rpc.ts';
import { loadKeypairFile } from '../src/lib/keypair.ts';
import { fromBase64 } from '../src/lib/solanaTx.ts';
import { createDexScreener } from '../src/lib/dexscreener.ts';
import { createRugcheckApi } from '../src/lib/rugcheckApi.ts';
import { pickReferencePair } from '../src/workers/scanner.ts';
import { checkSimulatedBalance, inspectSwapTransaction } from '../src/guards/firewall.ts';
import { SOL_MINT, USDC_MINT } from '../src/types.ts';

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
let ok = 0;
let ko = 0;

function line(pass: boolean, label: string, detail = ''): void {
  if (pass) ok++;
  else ko++;
  console.log(`${pass ? '  ok  ' : '  ÉCHEC'} ${label}${detail ? ` — ${detail}` : ''}`);
}

function fields(obj: unknown, paths: string[]): string[] {
  const missing: string[] = [];
  for (const p of paths) {
    let cur: unknown = obj;
    for (const k of p.split('.')) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[k] : undefined;
    if (cur === undefined || cur === null) missing.push(p);
  }
  return missing;
}

async function check(label: string, fn: () => Promise<string | void>): Promise<void> {
  try {
    const detail = await fn();
    line(true, label, detail ?? '');
  } catch (e) {
    line(false, label, e instanceof Error ? e.message : String(e));
  }
}

loadDotEnv();
let config;
try {
  config = loadConfig();
  line(true, 'configuration', `mode ${config.mode}, données dans ${config.dataDir}`);
} catch (e) {
  line(false, 'configuration', e instanceof Error ? e.message : String(e));
  process.exit(1);
}

const http = createHttp({ minIntervalMsByHost: { 'api.jup.ag': config.jupiter.apiKey ? 250 : 1100 } });
const jupiter = createJupiterClient({ http, baseUrl: config.jupiter.baseUrl, apiKey: config.jupiter.apiKey });
const dex = createDexScreener({ http, baseUrl: config.dexscreenerBaseUrl });
const rugcheck = createRugcheckApi({ http, baseUrl: config.rugcheck.baseUrl, apiKey: config.rugcheck.apiKey });

console.log('\nAPI de données');
await check('Jupiter prix SOL', async () => {
  const p = await jupiter.prices([SOL_MINT]);
  const v = p[SOL_MINT]?.usdPrice;
  if (!v) throw new Error('usdPrice absent');
  return `1 SOL = ${v.toFixed(2)} $`;
});
await check('Jupiter devis SOL→USDC (sans signature)', async () => {
  const o = await jupiter.order({ inputMint: SOL_MINT, outputMint: USDC_MINT, amount: '10000000' });
  const missing = fields(o, ['requestId', 'outAmount']);
  if (missing.length) throw new Error(`champs absents : ${missing.join(', ')}`);
  return `0.01 SOL → ${(Number(o.outAmount) / 1e6).toFixed(4)} USDC, routeur ${o.router ?? '?'}, frais ${o.feeBps ?? '?'} bps`;
});
await check('Jupiter tokens tendance 5 min', async () => {
  const t = await jupiter.tokensByCategory('toptrending', '5m', 20);
  if (!t.length) throw new Error('liste vide');
  const missing = fields(t[0], ['id', 'symbol', 'organicScore', 'stats5m']);
  return `${t.length} tokens${missing.length ? ` (champs absents sur le 1er : ${missing.join(', ')})` : ''}`;
});
await check('Jupiter tokens récents', async () => `${(await jupiter.tokensRecent()).length} tokens`);
await check('Jupiter audit (recherche BONK)', async () => {
  const [t] = await jupiter.tokensSearch([BONK]);
  if (!t) throw new Error('BONK introuvable');
  const missing = fields(t, ['audit.mintAuthorityDisabled', 'audit.freezeAuthorityDisabled', 'organicScore']);
  return missing.length ? `champs absents : ${missing.join(', ')}` : `organicScore ${t.organicScore}`;
});
await check('DexScreener profils récents', async () => {
  const p = await dex.latestProfiles();
  return `${p.length} profils (${p.filter((x) => x.chainId === 'solana').length} Solana)`;
});
await check('DexScreener paires BONK', async () => {
  const pairs = await dex.pairsForTokens('solana', [BONK]);
  const ref = pickReferencePair(pairs, BONK, config.scanner.quoteSymbols);
  if (!ref) throw new Error('aucune paire de référence');
  const bad = (['liquidityUsd', 'vol5mUsd', 'vol1hUsd', 'buys5m', 'pairCreatedAtMs', 'priceUsd'] as const).filter(
    (k) => !Number.isFinite((ref as unknown as Record<string, number>)[k]),
  );
  if (bad.length) throw new Error(`champs non numériques : ${bad.join(', ')}`);
  return `${pairs.length} paires, référence ${ref.dexId} liquidité ${Math.round(ref.liquidityUsd)} $`;
});
await check('RugCheck résumé BONK', async () => {
  const s = await rugcheck.summary(BONK);
  return `score ${s.score}, ${s.risks.length} risque(s) listé(s)`;
});

console.log('\nWallet et RPC');
const rpc = config.rpcUrl ? createRpc({ http, url: config.rpcUrl }) : undefined;
if (!rpc) line(config.mode === 'paper', 'RPC', config.mode === 'paper' ? 'non configuré (normal en papier)' : 'RPC_URL obligatoire en live');
else await check('RPC', async () => `blockhash ${(await rpc.getLatestBlockhash()).blockhash.slice(0, 8)}…`);

if (!existsSync(config.keypairPath)) {
  line(config.mode === 'paper', 'clé du wallet', config.mode === 'paper' ? 'pas encore créée (npm run keygen quand tu passeras en live)' : `introuvable : ${config.keypairPath}`);
} else {
  const { signer, warnings } = loadKeypairFile(config.keypairPath);
  line(warnings.length === 0, 'clé du wallet', warnings.length ? warnings.join(' ; ') : `adresse ${signer.publicKey}`);
  if (rpc) {
    const lamports = await rpc.getBalanceLamports(signer.publicKey).catch(() => -1);
    line(lamports >= 0, 'solde du wallet', `${(lamports / 1e9).toFixed(4)} SOL (plafond MAX_WALLET_SOL ${config.guards.maxWalletSol})`);
    if (lamports > config.guards.maxWalletSol * 1e9) line(false, 'budget', 'le wallet dépasse MAX_WALLET_SOL : le bot refusera de démarrer');
    if (lamports >= 2_000_000) {
      await check('pare-feu à blanc sur une vraie transaction Jupiter (0.001 SOL → USDC, non signée)', async () => {
        const o = await jupiter.order({ inputMint: SOL_MINT, outputMint: USDC_MINT, amount: '1000000', taker: signer.publicKey });
        if (!o.transaction) throw new Error(`pas de transaction (${o.error ?? o.errorMessage ?? 'solde ?'})`);
        const bytes = fromBase64(o.transaction);
        const v = inspectSwapTransaction(bytes, {
          owner: signer.publicKey,
          side: 'buy',
          maxSolOutLamports: 1_000_000n + 10_000_000n,
          maxPriorityFeeLamports: 5_000_000n,
          allowedPrograms: config.allowedPrograms,
        });
        const sim = await rpc.simulate(o.transaction, [signer.publicKey]);
        const problems = checkSimulatedBalance({
          side: 'buy',
          preLamports: lamports,
          postLamports: sim.postLamports[0] ?? null,
          maxSolOutLamports: 11_000_000,
          minSolInLamports: 0,
          simulationError: sim.err,
        });
        const all = [...v.reasons, ...problems];
        if (all.length) throw new Error(all.join(' ; '));
        return `programmes : ${v.programs.join(', ')} ; routeur ${o.router ?? '?'}`;
      });
    } else {
      console.log('  (pare-feu à blanc ignoré : il faut au moins 0.002 SOL sur le wallet)');
    }
  }
}

console.log(`\n${ok} ok, ${ko} problème(s).`);
process.exit(ko ? 1 : 0);
