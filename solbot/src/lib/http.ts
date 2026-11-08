/**
 * Client HTTP minimal : délai maximal, nouvelles tentatives (réseau, 429, 5xx) avec attente
 * exponentielle, et espacement minimal des requêtes par hôte pour rester sous les limites
 * des API gratuites (DexScreener 60–300 req/min, Jupiter 50 req/10 s, RugCheck…).
 *
 * Tout est injectable (fetch, sleep, horloge) pour les tests.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface RequestOptions {
  headers?: Record<string, string>;
  /** Nombre de nouvelles tentatives (défaut : celui du client). 0 pour les appels non rejouables. */
  retries?: number;
  timeoutMs?: number;
}

export interface Http {
  getJson<T = unknown>(url: string, opts?: RequestOptions): Promise<T>;
  postJson<T = unknown>(url: string, body: unknown, opts?: RequestOptions): Promise<T>;
}

export class HttpError extends Error {
  override name = 'HttpError';
  readonly status: number;
  readonly url: string;
  readonly body: unknown;
  readonly retryable: boolean;
  constructor(message: string, status: number, url: string, body: unknown, retryable: boolean) {
    super(message);
    this.status = status;
    this.url = url;
    this.body = body;
    this.retryable = retryable;
  }
}

export interface HttpOptions {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  retries?: number;
  /** Espacement minimal entre deux requêtes vers un même hôte, en ms. */
  minIntervalMsByHost?: Record<string, number>;
  defaultMinIntervalMs?: number;
  userAgent?: string;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Espacements par défaut, prudents, pour les API utilisées par le bot. */
export const DEFAULT_HOST_INTERVALS: Record<string, number> = {
  'api.dexscreener.com': 250, // 300 req/min pour les paires ; les profils (60/min) sont espacés par le scanner
  'api.jup.ag': 250, // 50 req / 10 s en offre de base
  'api.rugcheck.xyz': 1100,
};

export function createHttp(options: HttpOptions = {}): Http {
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const defaultRetries = options.retries ?? 2;
  const intervals = { ...DEFAULT_HOST_INTERVALS, ...(options.minIntervalMsByHost ?? {}) };
  const defaultInterval = options.defaultMinIntervalMs ?? 100;
  const userAgent = options.userAgent ?? 'solbot/0.1';

  // File d'attente par hôte : chaque requête attend la précédente + l'espacement minimal.
  const nextSlot = new Map<string, number>();
  async function waitTurn(host: string): Promise<void> {
    const interval = intervals[host] ?? defaultInterval;
    const t = now();
    const slot = Math.max(t, nextSlot.get(host) ?? 0);
    nextSlot.set(host, slot + interval);
    if (slot > t) await sleep(slot - t);
  }

  async function request<T>(method: 'GET' | 'POST', url: string, body: unknown, opts: RequestOptions = {}): Promise<T> {
    const host = new URL(url).host;
    const retries = opts.retries ?? defaultRetries;
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      await waitTurn(host);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? timeoutMs);
      try {
        const headers: Record<string, string> = { accept: 'application/json', 'user-agent': userAgent, ...(opts.headers ?? {}) };
        if (method === 'POST') headers['content-type'] = 'application/json';
        const res = await doFetch(url, {
          method,
          headers,
          body: method === 'POST' ? JSON.stringify(body) : undefined,
          signal: ctrl.signal,
        });
        const text = await res.text();
        let parsed: unknown = text;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          // corps non JSON : on garde le texte
        }
        if (res.ok) return parsed as T;
        const retryable = res.status === 429 || res.status >= 500;
        const err = new HttpError(`${method} ${redact(url)} → HTTP ${res.status}`, res.status, redact(url), parsed, retryable);
        if (!retryable || attempt === retries) throw err;
        lastError = err;
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt);
        await sleep(Math.min(wait, 30_000));
      } catch (e) {
        if (e instanceof HttpError) throw e;
        // Erreur réseau ou délai dépassé : rejouable.
        lastError = e;
        if (attempt === retries) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new HttpError(`${method} ${redact(url)} → échec réseau : ${msg}`, 0, redact(url), null, true);
        }
        await sleep(backoff(attempt));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  return {
    getJson: (url, opts) => request('GET', url, undefined, opts),
    postJson: (url, body, opts) => request('POST', url, body, opts),
  };
}

function backoff(attempt: number): number {
  return Math.min(1000 * 2 ** attempt + Math.floor(Math.random() * 300), 10_000);
}

/** Retire les paramètres sensibles d'une URL avant de l'écrire dans un message (ex. clé d'API RPC). */
export function redact(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) {
      if (/key|token|secret|auth/i.test(k)) u.searchParams.set(k, '***');
    }
    return u.toString();
  } catch {
    return url;
  }
}
