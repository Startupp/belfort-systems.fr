/**
 * Envoie la page en direct du desk 500 $ et du portefeuille crypto au Worker « arene-papier » : onglets « Desk » et
 * « Crypto » de la page des 12 comptes. Une fois par minute pendant la séance, jusqu'à 19 h 05 (heure de Paris).
 *
 *   node src/desk/pousser.ts [adresse]     (défaut : https://arene-papier.damien-belfort.workers.dev/desk)
 *
 * Le jeton d'accès n'est ni dans le dépôt ni dans ce script : le proxy de l'environnement cloud l'ajoute à chaque requête
 * vers cette adresse (en-tête Authorization). Côté desk, lecture seule : fichiers du carnet et quelques cours Yahoo.
 */

import { join, resolve } from 'node:path';
import { createHttp } from '../lib/http.ts';
import { readJson } from '../lib/store.ts';
import { CRYPTO_CONFIG } from './crypto.ts';
import { createYahoo, paris } from './market.ts';
import { renderCarnet } from './report.ts';
import { DEFAULT_DESK_CONFIG } from './types.ts';
import type { DeskConfig, DeskState } from './types.ts';

export interface Portefeuille {
  id: 'desk' | 'crypto';
  dir: string;
  cfg: DeskConfig;
  title?: string;
  crypto?: boolean;
}

export const PORTEFEUILLES: Portefeuille[] = [
  { id: 'desk', dir: 'carnet', cfg: DEFAULT_DESK_CONFIG },
  { id: 'crypto', dir: 'carnet-crypto', cfg: CRYPTO_CONFIG, title: 'Carnet crypto (papier)', crypto: true },
];

/** Page du carnet en direct (positions ouvertes au dernier cours), comme l'aperçu local de l'opérateur. */
export async function pageDe(p: Portefeuille, lastPrice: (symbol: string) => Promise<number | undefined>): Promise<string> {
  const state = readJson<DeskState | null>(join(p.dir, 'state.json'), null);
  const prices: Record<string, number> = {};
  for (const o of state?.open ?? []) {
    const px = await lastPrice(o.symbol);
    if (px !== undefined) prices[o.symbol] = px;
  }
  return renderCarnet(p.dir, p.cfg, { mode: 'direct', prices, title: p.title, crypto: p.crypto });
}

/** Envoie une page ; renvoie le code HTTP (204 attendu). */
export async function pousser(url: string, p: Portefeuille, html: string, fetchImpl: typeof fetch = fetch): Promise<number> {
  const r = await fetchImpl(`${url}?portefeuille=${p.id}`, {
    method: 'POST',
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: html,
    signal: AbortSignal.timeout(20_000),
  });
  return r.status;
}

async function main(): Promise<void> {
  const url = process.argv[2] ?? 'https://arene-papier.damien-belfort.workers.dev/desk';
  const market = createYahoo(createHttp({ minIntervalMsByHost: { 'query1.finance.yahoo.com': 600 }, timeoutMs: 10_000, retries: 1 }));
  const cache = new Map<string, { at: number; price: number }>();
  const lastPrice = async (symbol: string): Promise<number | undefined> => {
    const hit = cache.get(symbol);
    if (hit && Date.now() - hit.at < 50_000) return hit.price;
    try {
      const p = (await market.bars(symbol, Date.now() - 30 * 60_000, Date.now())).at(-1)?.c;
      if (p !== undefined) cache.set(symbol, { at: Date.now(), price: p });
      return p ?? hit?.price;
    } catch {
      return hit?.price;
    }
  };
  const portefeuilles = PORTEFEUILLES.map((p) => ({ ...p, dir: resolve(p.dir) }));
  console.log(`envoi de la page en direct vers ${url} (desk et crypto), chaque minute jusqu'à 19 h 05 (Paris)`);
  for (;;) {
    for (const p of portefeuilles) {
      try {
        const code = await pousser(url, p, await pageDe(p, lastPrice));
        if (code !== 204) console.log(`${paris(Date.now()).date} ${p.id} : réponse ${code}${code === 401 ? ' (jeton absent : le proxy ne l’a pas ajouté)' : ''}`);
      } catch (e) {
        console.log(`${p.id} : envoi impossible (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    if (paris(Date.now()).minutes >= 19 * 60 + 5) break;
    await new Promise((r) => setTimeout(r, 60_000));
  }
  console.log('fin de séance : envoi arrêté');
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
