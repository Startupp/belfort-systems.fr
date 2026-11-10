/**
 * Base D1 en mémoire, pour les tests et les essais locaux du Worker : seulement les quatre requêtes qu'il utilise
 * (création de la table, lecture d'une clé, lecture de plusieurs clés, écriture d'une clé).
 */

import type { D1Database, D1Statement } from './index.ts';

export class MemoryD1 implements D1Database {
  readonly rows = new Map<string, { v: string; updated: number }>();
  /** Requêtes reçues (pour vérifier ce qu'un passage lit et écrit). */
  readonly log: string[] = [];

  prepare(sql: string): D1Statement {
    const db = this;
    let args: unknown[] = [];
    const stmt: D1Statement = {
      bind(...values: unknown[]) {
        args = values;
        return stmt;
      },
      async first<T>() {
        db.log.push(sql);
        if (/^SELECT v FROM kv WHERE k = \?$/.test(sql)) {
          const r = db.rows.get(String(args[0]));
          return (r ? { v: r.v } : null) as T | null;
        }
        throw new Error(`requête non prise en charge : ${sql}`);
      },
      async all<T>() {
        db.log.push(sql);
        const m = /^SELECT (k(?:, v)?(?:, updated)?) FROM kv WHERE k IN \(/.exec(sql);
        if (m) {
          const cols = (m[1] as string).split(', ');
          return {
            results: args.flatMap((k) => {
              const r = db.rows.get(String(k));
              if (!r) return [];
              const row: Record<string, unknown> = { k: String(k) };
              if (cols.includes('v')) row.v = r.v;
              if (cols.includes('updated')) row.updated = r.updated;
              return [row];
            }) as T[],
          };
        }
        throw new Error(`requête non prise en charge : ${sql}`);
      },
      async run() {
        db.log.push(sql);
        if (sql.startsWith('CREATE TABLE IF NOT EXISTS kv')) return {};
        if (sql.startsWith('INSERT INTO kv (k, v, updated)')) {
          db.rows.set(String(args[0]), { v: String(args[1]), updated: Number(args[2]) });
          return {};
        }
        throw new Error(`requête non prise en charge : ${sql}`);
      },
    };
    return stmt;
  }

  async batch(statements: D1Statement[]): Promise<unknown> {
    for (const s of statements) await s.run();
    return [];
  }

  /** Contenu complet (pour reprendre un essai local plus tard). */
  dump(): Record<string, { v: string; updated: number }> {
    return Object.fromEntries(this.rows);
  }
  static from(dump: Record<string, { v: string; updated: number }> | null): MemoryD1 {
    const db = new MemoryD1();
    for (const [k, r] of Object.entries(dump ?? {})) db.rows.set(k, r);
    return db;
  }
}
