/**
 * Desk de day trading papier (500 $, sans levier, 15 h – 19 h heure de Paris).
 *
 *   node src/desk/main.ts live              séance du jour en direct (attend 15 h si besoin, s'arrête à 19 h)
 *   node src/desk/main.ts replay [jours]    rejeu des N dernières séances (5 par défaut) dans data/desk-rejeu
 *   node src/desk/main.ts carnet [rejeu]    régénère carnet.html et carnet.csv
 *   node src/desk/main.ts resume [date]     résumé texte d'une séance (la dernière par défaut)
 *
 * DESK_DATA_DIR : dossier des données (défaut data/desk). Aucune clé ni compte nécessaire.
 */

import { resolve } from 'node:path';
import { createHttp } from '../lib/http.ts';
import { createYahoo } from './market.ts';
import { live, replay } from './run.ts';
import { loadDays, resumeJour, writeCarnet } from './report.ts';
import { DEFAULT_DESK_CONFIG, REPLAY_EXTRA, UNIVERSE } from './types.ts';

const [cmd = 'live', arg] = process.argv.slice(2);
const cfg = DEFAULT_DESK_CONFIG;
const http = createHttp({ minIntervalMsByHost: { 'query1.finance.yahoo.com': 600 }, timeoutMs: 15_000, retries: 2 });
const market = createYahoo(http);
const print = (l: string): void => console.log(l);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

if (cmd === 'replay') {
  const dir = resolve(process.env.DESK_DATA_DIR?.trim() || 'data/desk-rejeu');
  const days = Math.max(1, Math.min(10, Number(arg ?? 5) || 5));
  const out = await replay({ market, universe: [...UNIVERSE, ...REPLAY_EXTRA], cfg, dir, days, nowMs: Date.now(), print });
  for (const s of out) print(`${s.day} : ${s.trades.length} trades, ${s.pnlUsd >= 0 ? '+' : ''}${s.pnlUsd.toFixed(2)} $ (${s.pnlPct.toFixed(2)} %)`);
  print(`carnet : ${dir}/carnet.html`);
} else if (cmd === 'carnet') {
  const mode = arg === 'rejeu' ? 'rejeu' : 'direct';
  const dir = resolve(process.env.DESK_DATA_DIR?.trim() || (mode === 'rejeu' ? 'data/desk-rejeu' : 'data/desk'));
  print(`carnet : ${writeCarnet(dir, cfg, { mode })}`);
} else if (cmd === 'resume') {
  const dir = resolve(process.env.DESK_DATA_DIR?.trim() || 'data/desk');
  const days = loadDays(dir);
  const s = arg ? days.find((d) => d.day === arg) : days.at(-1);
  if (!s) {
    console.error(arg ? `aucune séance clôturée le ${arg} dans ${dir}` : `aucune séance clôturée dans ${dir}`);
    process.exit(1);
  }
  print(resumeJour(s));
} else if (cmd === 'live') {
  const dir = resolve(process.env.DESK_DATA_DIR?.trim() || 'data/desk');
  const s = await live({ market, universe: UNIVERSE, cfg, dir, now: () => Date.now(), sleep, print });
  if (s) print(`séance terminée : ${s.trades.length} trades, ${s.pnlUsd >= 0 ? '+' : ''}${s.pnlUsd.toFixed(2)} $ — carnet : ${dir}/carnet.html`);
} else {
  console.error('usage : node src/desk/main.ts live | replay [jours] | carnet [rejeu] | resume [AAAA-MM-JJ]');
  process.exit(1);
}
