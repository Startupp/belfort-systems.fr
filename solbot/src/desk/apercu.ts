/**
 * Aperçu en direct du carnet : petit serveur web local qui affiche la page du carnet, rafraîchie
 * toutes les 60 s, avec le dernier prix et le gain latent des positions ouvertes.
 *
 *   DESK_DATA_DIR=carnet node src/desk/apercu.ts [port]      (port 8080 par défaut)
 *
 * Lecture seule : il lit les fichiers du desk et quelques cours Yahoo (en cache 60 s), rien d'autre.
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHttp } from '../lib/http.ts';
import { readJson } from '../lib/store.ts';
import { createYahoo } from './market.ts';
import { renderCarnet } from './report.ts';
import { DEFAULT_DESK_CONFIG } from './types.ts';
import type { DeskState } from './types.ts';

const dir = resolve(process.env.DESK_DATA_DIR?.trim() || 'data/desk');
const port = Number(process.argv[2] ?? 8080);
const market = createYahoo(createHttp({ minIntervalMsByHost: { 'query1.finance.yahoo.com': 600 }, timeoutMs: 10_000, retries: 1 }));
const cache = new Map<string, { at: number; price: number }>();

async function lastPrice(symbol: string): Promise<number | undefined> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < 60_000) return hit.price;
  try {
    const bars = await market.bars(symbol, Date.now() - 30 * 60_000, Date.now());
    const p = bars.at(-1)?.c;
    if (p !== undefined) cache.set(symbol, { at: Date.now(), price: p });
    return p ?? hit?.price;
  } catch {
    return hit?.price;
  }
}

createServer(async (req, res) => {
  try {
    if (req.url?.startsWith('/carnet.csv')) {
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store' });
      res.end(readFileSync(join(dir, 'carnet.csv')));
      return;
    }
    const state = readJson<DeskState | null>(join(dir, 'state.json'), null);
    const prices: Record<string, number> = {};
    for (const o of state?.open ?? []) {
      const p = await lastPrice(o.symbol);
      if (p !== undefined) prices[o.symbol] = p;
    }
    const body = renderCarnet(dir, DEFAULT_DESK_CONFIG, { mode: 'direct', prices });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(
      `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta http-equiv="refresh" content="60"></head><body>${body}</body></html>`,
    );
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`aperçu indisponible : ${e instanceof Error ? e.message : String(e)}`);
  }
}).listen(port, '0.0.0.0', () => console.log(`aperçu du carnet : http://localhost:${port}/ (données : ${dir})`));
