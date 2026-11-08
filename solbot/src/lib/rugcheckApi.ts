/**
 * Client RugCheck (https://api.rugcheck.xyz) : API publique ; si RUGCHECK_API_KEY est définie, elle
 * est envoyée dans l'en-tête « Authorization: Bearer <clé> ».
 *
 *   GET /v1/tokens/{mint}/report/summary   résumé des risques d'un token
 *
 * L'API n'a pas de schéma officiel publié : les noms de champs viennent du schéma pydantic du
 * wrapper Python « cyhole », qui reflète l'API réelle. Un `score` plus haut = plus risqué ; l'échelle
 * de `score_normalised` n'est pas documentée ; `level` vaut en général « danger » ou « warn ».
 *
 * La réponse est validée ici et toute forme inattendue lève une Error explicite (pas d'objet JSON,
 * `risks` qui n'est pas une liste, `score` non numérique, risque illisible, rapport d'un autre mint) :
 * le filtre anti-rug la transforme en rejet API_ERROR (échec fermé). Un champ `error` présent dans
 * une réponse par ailleurs bien formée est conservé dans le résumé : le filtre le rejette aussi.
 */

import type { Http } from './http.ts';

/** Un risque listé par RugCheck. */
export interface RugcheckRisk {
  name: string;
  /** Valeur associée (ex. « 100.00% » de LP non verrouillée) ; souvent vide. */
  value: string;
  description: string;
  /** Poids du risque dans le score global (plus haut = plus risqué), si fourni. */
  score?: number;
  /** En général « danger » ou « warn » (parfois « info ») ; casse d'origine conservée. */
  level: string;
}

export interface RugcheckSummary {
  /** Mint du rapport quand l'API le renvoie (vérifié égal au mint demandé). */
  mint?: string;
  tokenProgram: string;
  tokenType: string;
  risks: RugcheckRisk[];
  /** Score brut : plus haut = plus risqué. */
  score: number;
  /** Score normalisé (échelle non documentée) ; absent si l'API ne le fournit pas. */
  score_normalised?: number;
  /** Part de la liquidité verrouillée, en % ; absent si l'API ne le fournit pas. */
  lpLockedPct?: number;
  /** Texte du champ `error` de l'API quand il est présent : le filtre anti-rug rejette alors (API_ERROR). */
  error?: string;
}

export interface RugcheckApi {
  summary(mint: string): Promise<RugcheckSummary>;
}

export interface RugcheckDeps {
  http: Http;
  baseUrl: string;
  apiKey?: string;
}

export function createRugcheckApi({ http, baseUrl, apiKey }: RugcheckDeps): RugcheckApi {
  const root = baseUrl.trim().replace(/\/+$/, '');
  const key = apiKey?.trim();
  return {
    async summary(mint) {
      const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
      const raw = await http.getJson<unknown>(`${root}/v1/tokens/${encodeURIComponent(mint)}/report/summary`, { headers });
      return parseRugcheckSummary(raw, mint);
    },
  };
}

/** Valide et normalise une réponse /report/summary ; lève une Error explicite si elle est inexploitable. */
export function parseRugcheckSummary(raw: unknown, mint: string): RugcheckSummary {
  const where = `réponse RugCheck pour ${mint}`;
  if (!isRecord(raw)) throw new Error(`${where} illisible : objet JSON attendu, reçu ${describeValue(raw)}`);

  const apiError = errorText(raw['error']);
  const withApiError = apiError === undefined ? '' : ` (erreur de l'API : ${apiError})`;

  const risksRaw = raw['risks'];
  if (!Array.isArray(risksRaw)) {
    throw new Error(`${where} invalide : « risks » n'est pas une liste (${describeValue(risksRaw)})${withApiError}`);
  }
  const score = finiteNumber(raw['score']);
  if (score === undefined) {
    throw new Error(`${where} invalide : « score » absent ou non numérique (${describeValue(raw['score'])})${withApiError}`);
  }
  // Un rapport qui concerne un autre token ne doit jamais servir à juger celui-ci.
  const reportMint = raw['mint'];
  if (reportMint !== undefined && reportMint !== null && reportMint !== '' && reportMint !== mint) {
    throw new Error(`${where} incohérente : le rapport concerne un autre mint (${describeValue(reportMint)})`);
  }

  const summary: RugcheckSummary = {
    tokenProgram: text(raw['tokenProgram']),
    tokenType: text(raw['tokenType']),
    risks: risksRaw.map((r: unknown, i) => parseRisk(r, i, where)),
    score,
  };
  if (typeof reportMint === 'string' && reportMint !== '') summary.mint = reportMint;
  const normalised = finiteNumber(raw['score_normalised']);
  if (normalised !== undefined) summary.score_normalised = normalised;
  const lpLocked = finiteNumber(raw['lpLockedPct']);
  if (lpLocked !== undefined) summary.lpLockedPct = lpLocked;
  if (apiError !== undefined) summary.error = apiError;
  return summary;
}

function parseRisk(r: unknown, index: number, where: string): RugcheckRisk {
  // Un risque illisible ne peut pas être jugé : on échoue plutôt que de l'ignorer.
  if (!isRecord(r)) throw new Error(`${where} invalide : risque n°${index + 1} illisible (${describeValue(r)})`);
  const risk: RugcheckRisk = {
    name: text(r['name']),
    value: text(r['value']),
    description: text(r['description']),
    level: text(r['level']),
  };
  const score = finiteNumber(r['score']);
  if (score !== undefined) risk.score = score;
  return risk;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Nombre fini, ou chaîne numérique ; sinon undefined. */
function finiteNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function text(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** Texte d'un champ « error » : undefined s'il est absent, null, false ou vide. */
function errorText(v: unknown): string | undefined {
  if (v === undefined || v === null || v === false) return undefined;
  if (typeof v === 'string') return v.trim() === '' ? undefined : clip(v, 200);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return clip(JSON.stringify(v), 200);
  } catch {
    return 'erreur illisible';
  }
}

function describeValue(v: unknown): string {
  if (v === undefined) return 'absent';
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'liste';
  if (typeof v === 'string') return `texte « ${clip(v, 60)} »`;
  if (typeof v === 'number') return `nombre ${v}`;
  if (typeof v === 'boolean') return `booléen ${v}`;
  if (typeof v === 'object') return 'objet';
  return typeof v;
}

/** Texte externe sur une ligne, tronqué : les messages restent courts et lisibles dans le journal. */
function clip(s: string, max: number): string {
  const t = s.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
