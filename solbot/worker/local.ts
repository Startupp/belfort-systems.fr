/**
 * Essai local du Worker avec les vrais cours et une base D1 en mémoire (sauvegardée entre deux essais) :
 *
 *   NODE_USE_ENV_PROXY=1 node worker/local.ts [passages] [--tout] [--depuis=AAAA-MM-JJ] [--base=fichier.json] [--page=fichier.html]
 *
 * Affiche pour chaque passage le temps de calcul (CPU), les séries lues, les comptes repris et les remarques.
 * --depuis : départ du suivi avancé (pour voir les comptes travailler avant le vrai départ).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PARIS, zonedToUtc } from '../src/arena/strategies.ts';
import worker, { cycle, resetMemory, warmMemory } from './index.ts';
import type { Summary } from './index.ts';
import { MemoryD1 } from './memory-d1.ts';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const n = Number(args.find((a) => /^\d+$/.test(a)) ?? 1);
const basePath = opt('base') ?? 'data/worker-local.json';
const db = MemoryD1.from(existsSync(basePath) ? JSON.parse(readFileSync(basePath, 'utf8')) : null);
const since = opt('depuis');
const env = { DB: db, TOKEN: 'essai-local', START_MS: since ? String(zonedToUtc(since, 0, PARIS)) : undefined };

if (args.includes('--mesure')) {
  // Temps de calcul du Worker seul : un passage avec le réseau enregistré, puis rejoué 6 fois (même instant, même base,
  // réponses lues depuis la mémoire) ; le réseau et le chiffrement ne comptent pas dans la limite de Cloudflare.
  const now = Date.now();
  // --creneau=MM : passage prévu à la minute MM de l'heure en cours (UTC), pour mesurer un créneau donné.
  const minute = opt('creneau');
  const slot = minute === undefined ? now : Math.floor(now / 3_600_000) * 3_600_000 + Number(minute) * 60_000;
  const before = db.dump();
  const recorded = new Map<string, string>();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const r = await realFetch(input, init);
    const text = await r.text();
    recorded.set(url, text);
    return new Response(text, { status: r.status });
  }) as typeof fetch;
  await cycle(env, { now, slot, force: args.includes('--tout') });
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const text = recorded.get(url);
    return text === undefined ? new Response('absent', { status: 404 }) : new Response(text);
  }) as typeof fetch;
  // Instance neuve (rien en mémoire) puis instance déjà chaude ; temps du fil principal (performance.now) et CPU du
  // processus (process.cpuUsage, qui compte aussi les fils d'arrière-plan de V8).
  for (const warm of [false, true]) {
    const wall: number[] = [];
    const cpus: number[] = [];
    for (let i = 0; i < 6; i++) {
      const copy = MemoryD1.from(before);
      resetMemory();
      if (warm) await warmMemory(copy);
      const c0 = process.cpuUsage();
      const w0 = performance.now();
      await cycle({ ...env, DB: copy }, { now, slot, force: args.includes('--tout') });
      wall.push(performance.now() - w0);
      const cpu = process.cpuUsage(c0);
      cpus.push((cpu.user + cpu.system) / 1000);
    }
    console.log(`${warm ? 'instance chaude' : 'instance neuve '} : fil principal ${wall.map((t) => t.toFixed(1)).join(' · ')} ms · CPU processus ${cpus.map((t) => t.toFixed(1)).join(' · ')} ms`);
  }
  globalThis.fetch = realFetch;
  console.log(`${recorded.size} réponses enregistrées, ${(([...recorded.values()].reduce((s, t) => s + t.length, 0)) / 1024).toFixed(0)} Ko`);
  process.exit(0);
}

for (let i = 0; i < n; i++) {
  const c0 = process.cpuUsage();
  const w0 = performance.now();
  const r = await cycle(env, { force: args.includes('--tout') });
  const cpu = process.cpuUsage(c0);
  console.log(`passage ${i + 1} : CPU ${((cpu.user + cpu.system) / 1000).toFixed(1)} ms · durée ${(performance.now() - w0).toFixed(0)} ms · séries ${r.fetched.join(', ') || '—'} · comptes ${r.ran.join(', ') || '—'}${r.notes.length ? ` · remarques : ${r.notes.join(' | ')}` : ''}`);
}
writeFileSync(basePath, JSON.stringify(db.dump()));
const s = JSON.parse(db.rows.get('summary')?.v ?? 'null') as Summary | null;
if (s) for (const a of s.accounts) console.log(`  ${a.id.padEnd(20)} ${a.equity.toFixed(2).padStart(9)} $ ${a.pnlPct >= 0 ? '+' : ''}${a.pnlPct.toFixed(2)} % · ${a.trades} trades · ${a.open.length} ouverte(s)`);
const meta = db.rows.get('meta')?.v;
if (meta) console.log(`  séries encore à compléter : ${(JSON.parse(meta) as { short: string[] }).short.join(', ') || 'aucune'}`);
const page = opt('page');
if (page) {
  const res = await worker.fetch(new Request('https://essai.local/essai-local/'), env);
  writeFileSync(page, await res.text());
  console.log(`page : ${page}`);
}
