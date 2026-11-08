/**
 * Filtre anti-rug : décide si un candidat du scanner peut être acheté. Il ÉCHOUE FERMÉ : un token ne
 * passe que si TOUS les contrôles obligatoires ont répondu et sont bons. Une API en erreur, un délai
 * dépassé ou une réponse illisible ne laissent jamais passer un token.
 *
 * Trois groupes de contrôles, lancés en parallèle (Promise.allSettled) :
 *   1. RugCheck (résumé du rapport) : risque de niveau « danger » → RUGCHECK_DANGER ; nom de risque
 *      qui contient un motif de BLOCKED_RISK_NAMES → BLOCKED_RISK ; plus de risques « warn » que
 *      MAX_RUGCHECK_WARNINGS → TOO_MANY_WARNINGS ; champ `error` → API_ERROR. Les scores sont
 *      conservés dans le verdict, sans seuil.
 *   2. Jupiter (audit Tokens V2) : isSus → SUSPICIOUS ; autorité de mint / de gel encore active →
 *      MINT_AUTHORITY / FREEZE_AUTHORITY ; principaux détenteurs > MAX_TOP_HOLDERS_PCT → TOP_HOLDERS ;
 *      score organique < MIN_ORGANIC_SCORE → LOW_ORGANIC. Token ou champs absents → simples
 *      avertissements : RugCheck fait foi pour les autorités.
 *   3. Aller-retour SOL → token → SOL sur devis Jupiter (sonde ROUNDTRIP_PROBE_SOL) : il faut une
 *      route dans les deux sens (sinon NO_ROUTE : impossible de revendre, honeypot possible) et un
 *      coût ≤ MAX_ROUNDTRIP_COST_PCT (sinon ROUNDTRIP_COST : taxe cachée, liquidité factice…).
 *      Les devis ne sont pas exécutés et partent tous deux de l'état actuel du pool : l'impact de prix
 *      est compté à l'achat ET à la vente, la mesure est donc prudente. Jupiter prend jusqu'à 50 bps
 *      par swap sur les tokens de moins de 24 h : un aller-retour sain sur un token jeune coûte ≥ 1 %.
 *
 * Toute promesse rejetée (erreur HTTP, réponse invalide, délai dépassé) → API_ERROR pour cette
 * source, avec une raison qui la nomme. Mint mal formé → INVALID_MINT, sans appel réseau.
 * check() ne lève jamais d'exception : même une erreur interne donne un verdict de rejet.
 *
 * Cache : par mint, RUG_CACHE_MIN minutes (horloge injectée), verdicts acceptés comme rejetés, rendus
 * tels quels (checkedAt d'origine). Jamais un verdict qui contient API_ERROR : on réessaie au scan suivant.
 */

import { isValidAddress } from '../config.ts';
import type { Config, RugConfig } from '../config.ts';
import type { JupiterClient, JupiterToken } from '../lib/jupiter.ts';
import type { RugcheckApi, RugcheckSummary } from '../lib/rugcheckApi.ts';
import { LAMPORTS_PER_SOL, SOL_MINT } from '../types.ts';
import type { Clock, RugVerdict, TokenCandidate } from '../types.ts';

export interface RugCheckerDeps {
  rugcheck: RugcheckApi;
  jupiter: JupiterClient;
  clock: Clock;
  config: Config;
  /** Délai maximal de chaque groupe de contrôles, en ms (défaut 60 000 ; 0 = aucun). Au-delà : API_ERROR. */
  timeoutMs?: number;
}

export interface RugChecker {
  check(c: TokenCandidate): Promise<RugVerdict>;
}

/** Résultat d'un évaluateur : codes de rejet sans doublon, une phrase par rejet, avertissements. */
export interface RugFindings {
  rejectCodes: string[];
  reasons: string[];
  warnings: string[];
}

const DEFAULT_GROUP_TIMEOUT_MS = 60_000;
const MINUTE_MS = 60_000;

const SOURCE_RUGCHECK = 'RugCheck';
const SOURCE_JUPITER_AUDIT = 'Jupiter (audit du token)';
const SOURCE_ROUND_TRIP = 'Jupiter (aller-retour)';

/** Champs d'audit Jupiter recopiés dans verdict.details (petites valeurs seulement). */
const AUDIT_FIELDS = [
  'isSus',
  'mintAuthorityDisabled',
  'freezeAuthorityDisabled',
  'topHoldersPercentage',
  'devBalancePercentage',
  'devMigrations',
  'devMints',
] as const;

// ---------------------------------------------------------------------------
// Évaluateurs purs
// ---------------------------------------------------------------------------

export function evaluateRugcheckSummary(s: RugcheckSummary, cfg: RugConfig): RugFindings {
  const f = emptyFindings();
  const apiError = errorText(s.error);
  if (apiError !== undefined) reject(f, 'API_ERROR', `RugCheck : erreur renvoyée par l'API (${apiError})`);
  if (!Array.isArray(s.risks)) {
    reject(f, 'API_ERROR', 'RugCheck : liste des risques absente, contrôle impossible');
    return f;
  }

  const patterns = cfg.blockedRiskNames.map(normalizeName).filter((p) => p !== '');
  const warned: string[] = [];
  for (const risk of s.risks) {
    const rawName = typeof risk.name === 'string' ? risk.name : '';
    const name = clip(rawName, 80) || '(risque sans nom)';
    const rawLevel = typeof risk.level === 'string' ? risk.level : '';
    const level = rawLevel.trim().toLowerCase();

    if (level === 'danger') {
      reject(f, 'RUGCHECK_DANGER', `RugCheck danger : ${name}`);
    } else if (level === 'warn' || level === 'warning') {
      warned.push(name);
      f.warnings.push(`RugCheck avertissement : ${name}`);
    } else if (level !== 'info') {
      // Niveau vide ou inconnu : impossible à juger, il compte comme un avertissement.
      warned.push(name);
      f.warnings.push(`RugCheck avertissement (niveau « ${clip(rawLevel, 20) || 'vide'} » non reconnu) : ${name}`);
    }

    // Quel que soit son niveau, un risque dont le nom contient un motif bloqué rejette.
    const lowered = normalizeName(rawName);
    const pattern = patterns.find((p) => lowered.includes(p));
    if (pattern !== undefined) reject(f, 'BLOCKED_RISK', `RugCheck risque bloqué : ${name} (motif « ${pattern} »)`);
  }

  if (exceeds(warned.length, cfg.maxRugcheckWarnings)) {
    reject(
      f,
      'TOO_MANY_WARNINGS',
      `RugCheck : ${warned.length} avertissements (max ${fmt(cfg.maxRugcheckWarnings)}) : ${warned.join(', ')}`,
    );
  }
  return f;
}

export function evaluateJupiterAudit(t: JupiterToken | undefined, cfg: RugConfig): RugFindings {
  const f = emptyFindings();
  if (!t) {
    f.warnings.push('Jupiter : token introuvable dans la recherche, audit Jupiter non vérifié (RugCheck fait foi)');
    return f;
  }

  const audit = auditOf(t);
  if (!audit) {
    f.warnings.push("Jupiter : aucune donnée d'audit, audit Jupiter non vérifié (RugCheck fait foi)");
  } else {
    // isSus n'est présent que lorsqu'il vaut true : toute valeur autre que false/null est un signal.
    const sus = audit['isSus'];
    if (sus !== undefined && sus !== null && sus !== false) {
      reject(f, 'SUSPICIOUS', 'Jupiter : token signalé comme suspect (audit isSus)');
    }

    const mintDisabled = audit['mintAuthorityDisabled'];
    if (mintDisabled === false) {
      reject(f, 'MINT_AUTHORITY', 'Jupiter : autorité de mint encore active (création de nouveaux tokens possible)');
    } else if (mintDisabled !== true) {
      f.warnings.push("Jupiter : état de l'autorité de mint inconnu");
    }

    const freezeDisabled = audit['freezeAuthorityDisabled'];
    if (freezeDisabled === false) {
      reject(f, 'FREEZE_AUTHORITY', 'Jupiter : autorité de gel encore active (nos tokens pourraient être gelés)');
    } else if (freezeDisabled !== true) {
      f.warnings.push("Jupiter : état de l'autorité de gel inconnu");
    }

    const top = finiteNumber(audit['topHoldersPercentage']);
    if (top === undefined) {
      f.warnings.push('Jupiter : part des principaux détenteurs inconnue');
    } else if (exceeds(top, cfg.maxTopHoldersPct)) {
      reject(
        f,
        'TOP_HOLDERS',
        `Jupiter : les principaux détenteurs possèdent ${fmt(top)} % de l'offre (max ${fmt(cfg.maxTopHoldersPct)} %)`,
      );
    }
  }

  if (cfg.minOrganicScore > 0) {
    const organic = finiteNumber(t.organicScore);
    if (organic === undefined) {
      f.warnings.push(`Jupiter : score organique inconnu (minimum ${fmt(cfg.minOrganicScore)} non vérifié)`);
    } else if (organic < cfg.minOrganicScore) {
      reject(f, 'LOW_ORGANIC', `Jupiter : score organique ${fmt(organic)} (min ${fmt(cfg.minOrganicScore)})`);
    }
  }
  return f;
}

/** Coût d'un aller-retour en % : (1 − retour/mise) × 100, arrondi au centième (calcul exact en entiers). */
export function roundTripCostPct(solInLamports: bigint, solBackLamports: bigint): number {
  if (solInLamports <= 0n) {
    throw new RangeError(`roundTripCostPct : mise invalide (${solInLamports} lamports)`);
  }
  // En centièmes de point : (mise − retour) × 10 000 / mise, arrondi au plus proche.
  const num = (solInLamports - solBackLamports) * 10_000n;
  const hundredths = floorDiv(2n * num + solInLamports, 2n * solInLamports);
  return Number(hundredths) / 100;
}

// ---------------------------------------------------------------------------
// Filtre
// ---------------------------------------------------------------------------

interface CacheEntry {
  atMs: number;
  verdict: RugVerdict;
}

/** Avancement de l'aller-retour, rempli au fil des devis (utile même en cas d'échec à mi-chemin). */
interface RoundTripProgress {
  probeLamports?: bigint;
  tokensOut?: bigint;
  lamportsBack?: bigint;
  buyRouter?: string;
  sellRouter?: string;
  buyFeeBps?: number;
  sellFeeBps?: number;
}

type QuoteReading =
  | { ok: true; outAmount: bigint; router?: string; feeBps?: number }
  | { ok: false; problem: string; router?: string; feeBps?: number };

export function createRugChecker(deps: RugCheckerDeps): RugChecker {
  const { rugcheck, jupiter, clock } = deps;
  const cache = new Map<string, CacheEntry>();

  async function rugcheckGroup(mint: string, cfg: RugConfig): Promise<{ summary: RugcheckSummary; findings: RugFindings }> {
    const summary = await rugcheck.summary(mint);
    return { summary, findings: evaluateRugcheckSummary(summary, cfg) };
  }

  async function jupiterGroup(mint: string, cfg: RugConfig): Promise<{ token: JupiterToken | undefined; findings: RugFindings }> {
    const tokens: unknown = await jupiter.tokensSearch([mint]);
    if (!Array.isArray(tokens)) throw new Error(`réponse de recherche invalide (liste attendue, reçu ${describeValue(tokens)})`);
    const list: unknown[] = tokens;
    const token = list.find((t): t is JupiterToken => isRecord(t) && t['id'] === mint);
    return { token, findings: evaluateJupiterAudit(token, cfg) };
  }

  async function roundTripGroup(
    mint: string,
    cfg: RugConfig,
    p: RoundTripProgress,
  ): Promise<{ findings: RugFindings; costPct?: number }> {
    const f = emptyFindings();
    const probeLamports = Math.round(cfg.roundTripProbeSol * LAMPORTS_PER_SOL);
    if (!Number.isSafeInteger(probeLamports) || probeLamports <= 0) {
      throw new Error(`taille de sonde invalide (ROUNDTRIP_PROBE_SOL = ${cfg.roundTripProbeSol})`);
    }
    const amountIn = BigInt(probeLamports);
    p.probeLamports = amountIn;

    // Simples devis : pas de `taker`, donc aucune transaction n'est construite.
    const buy = readQuote(await jupiter.order({ inputMint: SOL_MINT, outputMint: mint, amount: amountIn.toString() }), SOL_MINT, mint);
    p.buyRouter = buy.router;
    p.buyFeeBps = buy.feeBps;
    if (!buy.ok) {
      reject(f, 'NO_ROUTE', `aller-retour : pas de route d'achat SOL → token (${buy.problem})`);
      return { findings: f };
    }
    p.tokensOut = buy.outAmount;

    const sell = readQuote(
      await jupiter.order({ inputMint: mint, outputMint: SOL_MINT, amount: buy.outAmount.toString() }),
      mint,
      SOL_MINT,
    );
    p.sellRouter = sell.router;
    p.sellFeeBps = sell.feeBps;
    if (!sell.ok) {
      reject(f, 'NO_ROUTE', `aller-retour : pas de route de revente token → SOL (${sell.problem}) : sortie impossible, honeypot possible`);
      return { findings: f };
    }
    p.lamportsBack = sell.outAmount;

    const costPct = roundTripCostPct(amountIn, sell.outAmount);
    if (exceeds(costPct, cfg.maxRoundTripCostPct)) {
      reject(
        f,
        'ROUNDTRIP_COST',
        `aller-retour ${fmt(probeLamports / LAMPORTS_PER_SOL, 9)} SOL : coût ${costPct.toFixed(2)} % (max ${fmt(cfg.maxRoundTripCostPct)} %)`,
      );
    }
    return { findings: f, costPct };
  }

  async function runChecks(mint: string, cfg: RugConfig, checkedAt: string): Promise<RugVerdict> {
    if (!isValidAddress(mint)) {
      return {
        mint,
        pass: false,
        rejectCodes: ['INVALID_MINT'],
        reasons: [`adresse de mint invalide (« ${clip(mint, 60)} ») : aucun contrôle possible`],
        warnings: [],
        checkedAt,
        details: {},
      };
    }

    const timeoutMs = deps.timeoutMs ?? DEFAULT_GROUP_TIMEOUT_MS;
    const progress: RoundTripProgress = {};
    const [rc, jup, rt] = await Promise.allSettled([
      withTimeout(rugcheckGroup(mint, cfg), timeoutMs),
      withTimeout(jupiterGroup(mint, cfg), timeoutMs),
      withTimeout(roundTripGroup(mint, cfg, progress), timeoutMs),
    ]);

    const f = emptyFindings();
    const details: Record<string, unknown> = {};
    const verdict: RugVerdict = { mint, pass: false, rejectCodes: [], reasons: [], warnings: [], checkedAt, details };

    // 1. RugCheck
    if (rc.status === 'fulfilled') {
      const { summary: s, findings } = rc.value;
      merge(f, findings);
      verdict.rugcheckScore = s.score;
      if (s.score_normalised !== undefined) verdict.rugcheckScoreNormalised = s.score_normalised;
      details['rugcheck'] = {
        score: s.score,
        score_normalised: s.score_normalised,
        lpLockedPct: s.lpLockedPct,
        tokenProgram: s.tokenProgram,
        risks: s.risks.map((r) => {
          const risk: Record<string, string> = { name: clip(r.name, 80), level: r.level };
          if (r.value) risk['value'] = clip(r.value, 60);
          return risk;
        }),
        ...(s.error === undefined ? {} : { error: s.error }),
      };
    } else {
      sourceFailed(f, SOURCE_RUGCHECK, rc.reason);
      details['rugcheck'] = { error: errorMessage(rc.reason) };
    }

    // 2. Audit Jupiter
    if (jup.status === 'fulfilled') {
      const { token, findings } = jup.value;
      merge(f, findings);
      const audit = auditOf(token);
      const top = audit ? finiteNumber(audit['topHoldersPercentage']) : undefined;
      if (top !== undefined) verdict.topHoldersPct = top;
      details['jupiter'] = {
        found: token !== undefined,
        organicScore: finiteNumber(token?.organicScore),
        isVerified: typeof token?.isVerified === 'boolean' ? token.isVerified : null,
        audit: audit ? pickAudit(audit) : null,
      };
    } else {
      sourceFailed(f, SOURCE_JUPITER_AUDIT, jup.reason);
      details['jupiter'] = { error: errorMessage(jup.reason) };
    }

    // 3. Aller-retour
    if (rt.status === 'fulfilled') {
      merge(f, rt.value.findings);
      if (rt.value.costPct !== undefined) {
        verdict.roundTripCostPct = rt.value.costPct;
      } else if (rt.value.findings.rejectCodes.length === 0) {
        // Garde-fou : un aller-retour non mesuré ne doit jamais valoir « bon ».
        reject(f, 'API_ERROR', `${SOURCE_ROUND_TRIP} : contrôle impossible, coût non mesuré`);
      }
    } else {
      sourceFailed(f, SOURCE_ROUND_TRIP, rt.reason);
    }
    details['roundTrip'] = roundTripDetails(progress, rt.status === 'rejected' ? errorMessage(rt.reason) : undefined);

    verdict.rejectCodes = [...new Set(f.rejectCodes)];
    verdict.reasons = f.reasons;
    verdict.warnings = f.warnings;
    verdict.pass = verdict.rejectCodes.length === 0;
    return verdict;
  }

  return {
    async check(c) {
      const cfg = deps.config.rug;
      const nowMs = clock.now();
      const ttlMs = Number.isFinite(cfg.cacheMinutes) && cfg.cacheMinutes > 0 ? cfg.cacheMinutes * MINUTE_MS : 0;
      for (const [key, entry] of cache) {
        const age = nowMs - entry.atMs;
        if (!(age >= 0 && age < ttlMs)) cache.delete(key);
      }

      const mint = typeof c.mint === 'string' ? c.mint : '';
      const cached = cache.get(mint);
      // Copie : l'appelant peut modifier le verdict sans abîmer le cache.
      if (cached) return structuredClone(cached.verdict);

      const checkedAt = clock.iso();
      let verdict: RugVerdict;
      try {
        verdict = await runChecks(mint, cfg, checkedAt);
      } catch (e) {
        verdict = {
          mint,
          pass: false,
          rejectCodes: ['API_ERROR'],
          reasons: [`filtre anti-rug : erreur interne, ${errorMessage(e)}`],
          warnings: [],
          checkedAt,
          details: { error: errorMessage(e) },
        };
      }
      if (ttlMs > 0 && !verdict.rejectCodes.includes('API_ERROR')) {
        cache.set(mint, { atMs: nowMs, verdict: structuredClone(verdict) });
      }
      return verdict;
    },
  };
}

// ---------------------------------------------------------------------------
// Outils internes
// ---------------------------------------------------------------------------

function emptyFindings(): RugFindings {
  return { rejectCodes: [], reasons: [], warnings: [] };
}

function reject(f: RugFindings, code: string, reason: string): void {
  if (!f.rejectCodes.includes(code)) f.rejectCodes.push(code);
  f.reasons.push(reason);
}

function merge(into: RugFindings, from: RugFindings): void {
  for (const code of from.rejectCodes) if (!into.rejectCodes.includes(code)) into.rejectCodes.push(code);
  into.reasons.push(...from.reasons);
  into.warnings.push(...from.warnings);
}

function sourceFailed(f: RugFindings, source: string, err: unknown): void {
  reject(f, 'API_ERROR', `${source} : contrôle impossible, ${errorMessage(err)}`);
}

/** « Dépasse le maximum », écrit pour qu'un seuil invalide (NaN) rejette au lieu de laisser passer. */
function exceeds(value: number, max: number): boolean {
  return !(value <= max);
}

/** Nombre avec un point décimal, sans zéros inutiles : 0.3, 5, 45.25. */
function fmt(n: number, maxDecimals = 2): string {
  return String(Number(n.toFixed(maxDecimals)));
}

/** Texte externe sur une ligne, tronqué. */
function clip(s: string, max: number): string {
  const t = s.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function normalizeName(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
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

/** Texte d'un champ d'erreur : undefined s'il est absent, null, false ou vide. */
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

/** Message d'une erreur, complété par le message d'erreur du corps JSON d'une HttpError s'il y en a un. */
function errorMessage(e: unknown): string {
  let msg = e instanceof Error ? e.message || e.name : String(e);
  const body = isRecord(e) ? e['body'] : undefined;
  if (isRecord(body)) {
    const detail = errorText(body['error']) ?? errorText(body['message']) ?? errorText(body['errorMessage']);
    if (detail !== undefined && !msg.includes(detail)) msg += ` (${detail})`;
  }
  return clip(msg, 300);
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

function auditOf(t: JupiterToken | undefined): Record<string, unknown> | undefined {
  const audit: unknown = t?.audit;
  return isRecord(audit) ? audit : undefined;
}

function pickAudit(audit: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of AUDIT_FIELDS) {
    const v = audit[k];
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
  }
  return out;
}

/** Montant brut : chaîne de chiffres (format Jupiter) ou entier sûr ≥ 0 ; sinon undefined. */
function parseRawAmount(v: unknown): bigint | undefined {
  if (typeof v === 'string' && /^[0-9]+$/.test(v)) return BigInt(v);
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  return undefined;
}

function readQuote(q: unknown, inputMint: string, outputMint: string): QuoteReading {
  if (!isRecord(q)) return { ok: false, problem: `devis illisible (${describeValue(q)})` };
  const meta = {
    router: typeof q['router'] === 'string' && q['router'] !== '' ? clip(q['router'], 40) : undefined,
    feeBps: finiteNumber(q['feeBps']),
  };

  const error = errorText(q['error']);
  const code = q['errorCode'];
  if (error !== undefined || (code !== undefined && code !== null)) {
    const codeText = code !== undefined && code !== null ? ` (code ${clip(String(code), 20)})` : '';
    const message = error ?? errorText(q['errorMessage']) ?? 'sans message';
    return { ok: false, problem: `erreur Jupiter${codeText} : ${message}`, ...meta };
  }

  const mismatch = (v: unknown, expected: string): boolean => v !== undefined && v !== null && v !== '' && v !== expected;
  if (mismatch(q['inputMint'], inputMint) || mismatch(q['outputMint'], outputMint)) {
    return { ok: false, problem: 'devis incohérent : mints différents de ceux demandés', ...meta };
  }

  const raw = q['outAmount'];
  const out = parseRawAmount(raw);
  if (out === undefined) {
    const problem = raw === undefined || raw === null ? 'outAmount absent' : `outAmount non numérique (${describeValue(raw)})`;
    return { ok: false, problem, ...meta };
  }
  if (out === 0n) return { ok: false, problem: 'outAmount nul', ...meta };
  return { ok: true, outAmount: out, ...meta };
}

function roundTripDetails(p: RoundTripProgress, error: string | undefined): Record<string, unknown> {
  const d: Record<string, unknown> = {
    probeLamports: p.probeLamports?.toString(),
    tokensOut: p.tokensOut?.toString(),
    lamportsBack: p.lamportsBack?.toString(),
    router: { buy: p.buyRouter, sell: p.sellRouter },
    feeBps: { buy: p.buyFeeBps, sell: p.sellFeeBps },
  };
  if (error !== undefined) d['error'] = error;
  return d;
}

/** Division entière arrondie vers −∞ (b > 0). */
function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n ? q - 1n : q;
}

/** Rejette après `ms` (minuteur libéré dans tous les cas, sans retenir le processus). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (!(ms > 0) || !Number.isFinite(ms)) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rejectTimeout) => {
    timer = setTimeout(() => rejectTimeout(new Error(`délai dépassé (${fmt(ms / 1000, 3)} s)`)), ms);
    timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
