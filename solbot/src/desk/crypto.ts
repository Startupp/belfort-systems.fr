/**
 * Second portefeuille PAPIER : cryptos seulement (500 $ fictifs, sans levier, même fenêtre 15 h – 19 h de Paris).
 * Séparé du desk ORB : son propre dossier (carnet-crypto), son propre état, sa propre page.
 * Même moteur et mêmes garde-fous que le desk ; aucun ordre réel, aucune clé, aucun compte.
 *
 *   node src/desk/crypto.ts live                 séance crypto du jour en direct
 *   node src/desk/crypto.ts replay [jours]       rejeu des N derniers jours ouvrés (dossier carnet-crypto-rejeu)
 *   node src/desk/crypto.ts carnet               régénère carnet.html et carnet.csv
 *   node src/desk/crypto.ts resume [date]        résumé d'une séance
 *   node src/desk/crypto.ts call SYMBOLE SENS "source" ["texte"]   note un « call » public (X, presse…) au prix du moment
 *   node src/desk/crypto.ts calls                que serait-il arrivé en suivant les calls (après 1 h, 4 h, 24 h)
 *
 * Les calls ne déclenchent jamais de trade : ils sont seulement notés et mesurés (calls.jsonl).
 * CRYPTO_DATA_DIR : dossier des données (défaut carnet-crypto).
 */

import { join, resolve } from 'node:path';
import { createHttp } from '../lib/http.ts';
import { appendJsonl, readJsonl } from '../lib/store.ts';
import { createYahoo, paris } from './market.ts';
import type { MarketData } from './market.ts';
import { buildDayContexts, deskFiles, fetchAll, live, parisToUtc } from './run.ts';
import { createEngine, newDeskState } from './engine.ts';
import type { DaySummary } from './engine.ts';
import { loadDays, resumeJour, writeCarnet } from './report.ts';
import { DEFAULT_DESK_CONFIG } from './types.ts';
import type { DeskConfig, Instrument } from './types.ts';

/** Grosses cryptos liquides et quelques plus petites, toutes cotées à la minute sur Yahoo Finance. */
export const CRYPTO_UNIVERSE: Instrument[] = [
  ['BTC-USD', 'Bitcoin'],
  ['ETH-USD', 'Ether'],
  ['SOL-USD', 'Solana'],
  ['XRP-USD', 'XRP'],
  ['BNB-USD', 'BNB'],
  ['DOGE-USD', 'Dogecoin'],
  ['ADA-USD', 'Cardano'],
  ['AVAX-USD', 'Avalanche'],
  ['LINK-USD', 'Chainlink'],
  ['SUI20947-USD', 'Sui'],
  ['TON11419-USD', 'Toncoin'],
  ['LTC-USD', 'Litecoin'],
  ['DOT-USD', 'Polkadot'],
  ['NEAR-USD', 'Near'],
  ['HYPE32196-USD', 'Hyperliquid'],
  ['PEPE24478-USD', 'Pepe'],
].map(([symbol, label]) => ({ symbol: symbol as string, cls: 'crypto' as const, label: label as string }));

/** Mêmes réglages que le desk, sans ORB (actions seulement) : les 4 places vont au momentum. */
export const CRYPTO_CONFIG: DeskConfig = { ...DEFAULT_DESK_CONFIG, maxOrbOpen: 0 };

const TITLE = 'Carnet crypto (papier)';

/** Rejeu des `days` derniers jours ouvrés (la crypto cote tous les jours ; on garde le rythme du desk). */
export async function replayCrypto(opts: {
  market: MarketData;
  universe: Instrument[];
  cfg: DeskConfig;
  dir: string;
  days: number;
  nowMs: number;
  print: (line: string) => void;
}): Promise<DaySummary[]> {
  const { cfg, nowMs } = opts;
  const files = deskFiles(opts.dir, opts.print);
  const state = newDeskState(cfg);
  const engine = createEngine({ cfg, state, log: (e) => files.log(e) });
  const all = await fetchAll(opts.market, opts.universe, nowMs - 29 * 86_400_000, nowMs, (s, e) =>
    opts.print(`données indisponibles pour ${s} : ${e instanceof Error ? e.message : String(e)}`),
  );
  const today = paris(nowMs);
  const sessions: string[] = [];
  for (let k = 0; sessions.length < opts.days && k < 40; k++) {
    const d = paris(nowMs - k * 86_400_000).date;
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (d === today.date && today.minutes < cfg.windowEnd) continue;
    sessions.unshift(d);
  }
  const summaries: DaySummary[] = [];
  for (const day of sessions) {
    const ctxs = buildDayContexts(day, all, opts.universe, cfg);
    const start = parisToUtc(day, cfg.windowStart);
    const end = parisToUtc(day, cfg.windowEnd);
    engine.startDay(day, start);
    for (let t = start; t < end; t += 60_000) engine.step(t, ctxs);
    const summary = engine.endDay(end - 60_000, ctxs);
    files.saveDay(summary);
    summaries.push(summary);
  }
  files.saveState(state);
  writeCarnet(opts.dir, cfg, { mode: 'rejeu', title: 'Rejeu crypto (papier)', crypto: true });
  return summaries;
}

export interface CryptoCall {
  at: number;
  symbol: string;
  side: 'long' | 'short';
  source: string;
  text?: string;
  price: number;
}

/** Évaluation d'un call : variation dans le sens annoncé après h heures (null si pas encore connue). */
export function callMove(call: CryptoCall, priceAt: (t: number) => number | null, hours: number): number | null {
  const p = priceAt(call.at + hours * 3_600_000);
  if (p === null || !(call.price > 0)) return null;
  const raw = p / call.price - 1;
  return call.side === 'long' ? raw : -raw;
}

async function main(): Promise<void> {
  const [cmd = 'live', ...args] = process.argv.slice(2);
  const cfg = CRYPTO_CONFIG;
  const http = createHttp({ minIntervalMsByHost: { 'query1.finance.yahoo.com': 600 }, timeoutMs: 15_000, retries: 2 });
  // Pas de liste « actions en jeu » : ce portefeuille ne touche qu'aux cryptos.
  const market: MarketData = { ...createYahoo(http), screener: undefined };
  const print = (l: string): void => console.log(l);
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  const dirOf = (def: string): string => resolve(process.env.CRYPTO_DATA_DIR?.trim() || def);

  if (cmd === 'replay') {
    const dir = dirOf('carnet-crypto-rejeu');
    const days = Math.max(1, Math.min(15, Number(args[0] ?? 10) || 10));
    const out = await replayCrypto({ market, universe: CRYPTO_UNIVERSE, cfg, dir, days, nowMs: Date.now(), print });
    for (const s of out) print(`${s.day} : ${s.trades.length} trades, ${s.pnlUsd >= 0 ? '+' : ''}${s.pnlUsd.toFixed(2)} $ (${s.pnlPct.toFixed(2)} %)`);
    const tot = out.reduce((a, s) => a + s.pnlUsd, 0);
    print(`total : ${tot >= 0 ? '+' : ''}${tot.toFixed(2)} $, ${out.reduce((a, s) => a + s.trades.length, 0)} trades — carnet : ${dir}/carnet.html`);
  } else if (cmd === 'carnet') {
    const dir = dirOf('carnet-crypto');
    print(`carnet : ${writeCarnet(dir, cfg, { mode: 'direct', title: TITLE, crypto: true })}`);
  } else if (cmd === 'resume') {
    const dir = dirOf('carnet-crypto');
    const days = loadDays(dir);
    const s = args[0] ? days.find((d) => d.day === args[0]) : days.at(-1);
    if (!s) {
      console.error(`aucune séance crypto clôturée dans ${dir}`);
      process.exit(1);
    }
    print(resumeJour(s));
  } else if (cmd === 'live') {
    const dir = dirOf('carnet-crypto');
    const s = await live({ market, universe: CRYPTO_UNIVERSE, cfg, dir, now: () => Date.now(), sleep, print });
    writeCarnet(dir, cfg, { mode: 'direct', title: TITLE, crypto: true });
    if (s) print(`séance crypto terminée : ${s.trades.length} trades, ${s.pnlUsd >= 0 ? '+' : ''}${s.pnlUsd.toFixed(2)} $`);
  } else if (cmd === 'call') {
    const [symbolRaw, sideRaw, source, text] = args;
    const symbol = CRYPTO_UNIVERSE.find((u) => u.symbol === symbolRaw || u.symbol.split(/\d*-/)[0] === symbolRaw?.toUpperCase())?.symbol;
    const side = sideRaw === 'short' || sideRaw === 'vente' ? 'short' : sideRaw === 'long' || sideRaw === 'achat' ? 'long' : null;
    if (!symbol || !side || !source) {
      console.error('usage : node src/desk/crypto.ts call SYMBOLE achat|vente "source" ["texte"] (symbole de l\'univers crypto)');
      process.exit(2);
    }
    const now = Date.now();
    const bars = await market.bars(symbol, now - 30 * 60_000, now);
    const price = bars.at(-1)?.c;
    if (!price) throw new Error(`prix indisponible pour ${symbol}`);
    const call: CryptoCall = { at: now, symbol, side, source, text, price };
    appendJsonl(join(dirOf('carnet-crypto'), 'calls.jsonl'), call);
    print(`call noté (aucun trade) : ${source} — ${side === 'long' ? 'achat' : 'vente'} ${symbol} à ${price}`);
  } else if (cmd === 'calls') {
    const calls = readJsonl<CryptoCall>(join(dirOf('carnet-crypto'), 'calls.jsonl'));
    if (!calls.length) return print('aucun call noté');
    const now = Date.now();
    const f = (x: number | null): string => (x === null ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)} %`);
    for (const c of calls) {
      const bars = await market.bars(c.symbol, c.at - 60_000, Math.min(now, c.at + 25 * 3_600_000));
      const priceAt = (t: number): number | null => (t > now ? null : (bars.findLast((b) => b.t <= t)?.c ?? null));
      const p = paris(c.at);
      print(
        `${p.date} ${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')} ${c.source} : ` +
          `${c.side === 'long' ? 'achat' : 'vente'} ${c.symbol} à ${c.price} → 1 h ${f(callMove(c, priceAt, 1))}, 4 h ${f(callMove(c, priceAt, 4))}, 24 h ${f(callMove(c, priceAt, 24))}`,
      );
    }
  } else {
    console.error('usage : node src/desk/crypto.ts live | replay [jours] | carnet | resume [date] | call … | calls');
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
