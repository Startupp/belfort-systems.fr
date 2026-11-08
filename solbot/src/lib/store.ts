/** Fichiers de données : JSON écrit de façon atomique, journaux JSONL en ajout seul. */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Clock } from '../types.ts';

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** Écrit dans un fichier temporaire puis renomme : jamais de fichier à moitié écrit après un crash. */
export function writeJsonAtomic(path: string, value: unknown): void {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, path);
}

export function writeTextAtomic(path: string, text: string): void {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, path);
}

export function appendJsonl(path: string, value: unknown): void {
  ensureDir(dirname(path));
  appendFileSync(path, JSON.stringify(value) + '\n', { mode: 0o600 });
}

/** Lit un JSONL ; ignore une dernière ligne tronquée (coupure pendant l'écriture). */
export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const out: T[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // ligne corrompue : ignorée
    }
  }
  return out;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  iso: () => new Date().toISOString(),
};

/** Horloge figée pour les tests ; `advance(ms)` la fait avancer. */
export function fixedClock(startMs: number): Clock & { advance(ms: number): void; set(ms: number): void } {
  let t = startMs;
  return {
    now: () => t,
    iso: () => new Date(t).toISOString(),
    advance(ms: number) {
      t += ms;
    },
    set(ms: number) {
      t = ms;
    },
  };
}

/** Identifiant court et unique (horodatage + aléa), lisible dans les journaux. */
export function newId(prefix = 't'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
