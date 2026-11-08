/**
 * Bilan : statistiques des trades, frais cachés, slippage, rejets de l'anti-rug,
 * et régénération de equity.html.
 *
 *   npm run report
 *
 * Ne demande aucune clé : lit seulement DATA_DIR.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadDotEnv } from '../src/config.ts';
import { readJson, readJsonl, systemClock, writeTextAtomic } from '../src/lib/store.ts';
import { computeStats, createEquityTracker, renderEquityHtml } from '../src/workers/equity.ts';
import type { BotState } from '../src/types.ts';

loadDotEnv();
const dataDir = resolve(process.env.DATA_DIR?.trim() || 'data');
const state = readJson<BotState | null>(join(dataDir, 'state.json'), null);
if (!state) {
  console.log(`Aucun état dans ${dataDir} : lance d'abord le bot (npm run once).`);
  process.exit(0);
}

const tracker = createEquityTracker({ dataDir, clock: systemClock, mode: state.mode, getState: () => state, patchState: () => {} });
const { points, trades } = tracker.load();
const stats = computeStats(trades, points, state.initialEquitySol);
const pct = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(1)} %`;
const sol = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(4)} SOL`;

console.log(`\n=== solbot — ${state.mode === 'paper' ? 'MODE PAPIER (simulation)' : 'LIVE'} — ${dataDir}`);
console.log(`capital de départ ${state.initialEquitySol.toFixed(4)} SOL, mis à l'abri ${state.totalSweptSol.toFixed(4)} SOL`);
console.log(`trades fermés ${stats.trades} (${stats.wins} gagnants, ${stats.losses} perdants), réussite ${stats.winRatePct.toFixed(1)} %`);
console.log(`PnL total ${sol(stats.totalPnlSol)}, rendement ${pct(stats.returnPct)}, drawdown max ${stats.maxDrawdownPct.toFixed(1)} %`);
console.log(`espérance par trade ${sol(stats.expectancySol)} (${pct(stats.expectancyPct)}), profit factor ${stats.profitFactor === null ? '—' : stats.profitFactor.toFixed(2)}`);
console.log(`gain moyen ${sol(stats.avgWinSol)}, perte moyenne ${sol(stats.avgLossSol)}, durée moyenne ${stats.avgHoldMinutes.toFixed(0)} min`);
console.log(`frais totaux ${stats.totalFeesSol.toFixed(4)} SOL = ${stats.feesPctOfVolume.toFixed(2)} % du volume ; slippage moyen entrée ${stats.avgEntrySlippageBps.toFixed(0)} bps, sortie ${stats.avgExitSlippageBps.toFixed(0)} bps`);
if (Object.keys(stats.byExitReason).length) {
  console.log('\npar raison de sortie :');
  for (const [r, v] of Object.entries(stats.byExitReason).sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${r.padEnd(16)} ${String(v.count).padStart(4)} trades  ${sol(v.pnlSol)}`);
  }
}

// Rejets de l'anti-rug : le filtre écarte-t-il surtout des arnaques, ou aussi des gagnants ?
type Reject = { rejectCodes?: string[] };
const rejects = readJsonl<Reject>(join(dataDir, 'rejects.jsonl'));
if (rejects.length) {
  const counts = new Map<string, number>();
  for (const r of rejects) for (const c of new Set(r.rejectCodes ?? [])) counts.set(c, (counts.get(c) ?? 0) + 1);
  console.log(`\nrejets anti-rug : ${rejects.length} tokens`);
  for (const [c, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${c.padEnd(20)} ${n}`);
}

// Verdict honnête, selon les critères du README (à écrire AVANT de regarder les résultats).
console.log('\nvérification des critères de passage à la phase suivante :');
const checks: Array<[boolean, string]> = [
  [stats.trades >= 50, `au moins 50 trades fermés (${stats.trades})`],
  [stats.expectancySol > 0, `espérance positive après frais (${sol(stats.expectancySol)})`],
  [stats.maxDrawdownPct < 25, `drawdown max < 25 % (${stats.maxDrawdownPct.toFixed(1)} %)`],
];
for (const [ok, label] of checks) console.log(`  ${ok ? 'ok   ' : 'non  '} ${label}`);

const htmlPath = join(dataDir, 'equity.html');
writeTextAtomic(
  htmlPath,
  renderEquityHtml({ points, stats, trades, mode: state.mode, initialEquitySol: state.initialEquitySol, generatedAt: systemClock.iso() }),
);
console.log(`\ncourbe : ${existsSync(htmlPath) ? htmlPath : '(non générée)'}`);
