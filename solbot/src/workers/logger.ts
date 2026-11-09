/**
 * Journal : la raison de chaque décision du bot, lisible par un humain comme par un script.
 *
 * Fichiers dans DATA_DIR (JSONL en ajout seul, un objet JSON par ligne) :
 *   journal/AAAA-MM-JJ.jsonl  tous les événements, un fichier par jour UTC (date du champ `at`) ;
 *   trades.jsonl              un ClosedTrade complet par ligne + `fill` (le Fill de sortie), lu par l'equity ;
 *   rejects.jsonl             un rejet anti-rug par ligne : de quoi rejouer « et si on les avait achetés ? ».
 *
 * Console : une ligne par événement, `HH:MM:SS [PAPIER|LIVE] TYPE  message` (heure UTC, comme le
 * journal). Le champ `data` n'est jamais affiché.
 *
 * Sécurité :
 *   - redact() passe sur tout ce qui est écrit : clés sensibles masquées, chaînes tronquées, bigint,
 *     cycles, octets bruts ;
 *   - symboles et noms de tokens sont choisis par des inconnus : chaque ligne console passe par
 *     sanitizeForTerminal() et, dans les fichiers, les mêmes caractères (contrôles C1, bidi,
 *     invisibles) sont échappés en \uXXXX — sans perte, JSON.parse les restitue — pour qu'un
 *     `tail -f` ou un `grep` sur le journal ne puisse pas piloter le terminal ;
 *   - le logger ne fait JAMAIS planter le bot : tout est rattrapé ; une panne d'écriture est signalée
 *     une seule fois sur stderr (puis son rétablissement).
 */

import { appendFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { ensureDir, utcDate } from '../lib/store.ts';
import { LAMPORTS_PER_SOL, SOL_MINT } from '../types.ts';
import type {
  Clock,
  ClosedTrade,
  ExitReason,
  Fill,
  GuardDecision,
  JournalEvent,
  JournalType,
  Mode,
  Position,
  RugVerdict,
  ScanResult,
  SizeDecision,
  TokenCandidate,
} from '../types.ts';

export interface LoggerDeps {
  dataDir: string;
  clock: Clock;
  mode: Mode;
  /** Sortie console, une ligne par événement (défaut : console.log). */
  print?: (line: string) => void;
}

export interface Logger {
  /** Événement libre ; renvoie l'événement tel qu'il est écrit (après redact). */
  event(type: JournalType, msg: string, extra?: { mint?: string; symbol?: string; data?: unknown }): JournalEvent;
  scan(r: ScanResult): void;
  reject(c: TokenCandidate, v: RugVerdict): void;
  sizeSkip(c: TokenCandidate, s: SizeDecision): void;
  open(p: Position, size: SizeDecision): void;
  openFailed(c: TokenCandidate, fill: Fill): void;
  close(t: ClosedTrade, fill: Fill): void;
  closeFailed(p: Position, fill: Fill, reason: ExitReason): void;
  /** N'écrit que si l'ensemble des motifs a changé depuis l'appel précédent (pas de bruit à chaque tour). */
  guard(d: GuardDecision): void;
  error(where: string, err: unknown, data?: unknown): void;
}

type EventExtra = { mint?: string; symbol?: string; data?: unknown };

const MASK = '[masqué]';
const SENSITIVE_KEY = /secret|private|seed|mnemonic|api.?key|signedTransaction|authorization/i;
const MAX_STRING = 2000;
const MAX_DEPTH = 20;
/** Budget de valeurs visitées par redact() : une donnée énorme ne bloque pas la boucle. */
const MAX_NODES = 5000;
const MAX_TERMINAL = 300;
/** Largeur de la colonne TYPE : « close_failed », le type le plus long. */
const TYPE_WIDTH = 12;
const MAX_LABEL = 20;
/** Candidats mémorisés (par mint) pour résumer un achat : open() ne reçoit que la Position. */
const CANDIDATE_CACHE_MAX = 500;

// Préfixes posés par buildEntryReasons, relus par open() pour résumer l'achat.
const RUG_PREFIX = 'anti-rug : ';
const WARN_PREFIX = 'attention : ';
const SIZE_PREFIX = 'taille : ';

/** Contrôles « blancs » (tabulation, fins de ligne) : une espace, pour garder une seule ligne lisible. */
const TERMINAL_BLANKS = /[\t\n\v\f\r\u0085\u2028\u2029]+/g;
/** Contrôles C0/C1 (ESC, BEL, CSI 8 bits…) et caractères de format : bidi, largeur nulle, BOM, étiquettes. */
const TERMINAL_UNSAFE = /[\p{Cc}\p{Cf}]/gu;
/** Ce que JSON.stringify laisse passer tel quel mais qui ne doit pas arriver brut dans un terminal. */
const JSON_UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** Valeurs secrètes glissées dans du texte : paramètre d'URL (?api-key=…), identifiants d'URL, jeton Bearer. */
const URL_SECRET_PARAM = /([?&;#][^=&;#\s]*(?:key|token|secret|auth|pass|pwd)[^=&;#\s]*=)[^&;#\s"'<>]+/gi;
const URL_USERINFO = /(\/\/[^/\s:@]+:)[^/\s@]+@/g;
const BEARER = /\b(Bearer\s+)[\w.~+/-]+=*/gi;

export function createLogger(deps: LoggerDeps): Logger {
  const print = deps.print ?? ((line: string) => console.log(line));
  const tag = deps.mode === 'live' ? 'LIVE' : deps.mode === 'paper' ? 'PAPIER' : safeString(deps.mode).toUpperCase();

  /** Pannes déjà signalées (`cible:code`) et cibles actuellement en panne. */
  const reported = new Set<string>();
  const broken = new Set<string>();
  const candidates = new Map<string, TokenCandidate>();
  let lastGuardKey = '';

  function nowIso(): string {
    try {
      const iso = deps.clock.iso();
      if (typeof iso === 'string' && iso !== '') return iso;
    } catch {
      // horloge défaillante : repli sur l'horloge système
    }
    return new Date().toISOString();
  }

  function warn(text: string): void {
    try {
      console.error(sanitizeForTerminal(`[journal] ${text}`));
    } catch {
      // stderr indisponible : plus rien à faire
    }
  }

  function reportOnce(key: string, text: string): void {
    if (reported.has(key)) return;
    reported.add(key);
    warn(`${text} (signalé une seule fois, le bot continue)`);
  }

  function fault(target: string, err: unknown, what: string): void {
    broken.add(target);
    reportOnce(`${target}:${errCode(err)}`, `${what} : ${errText(err)}`);
  }

  /** Une écriture a réussi : si la cible était en panne, on le dit et une prochaine panne sera signalée. */
  function healthy(target: string): void {
    if (!broken.delete(target)) return;
    for (const key of [...reported]) if (key.startsWith(`${target}:`)) reported.delete(key);
    warn(`${target} : de nouveau opérationnel`);
  }

  /** `value` doit déjà être passée par redact(). */
  function writeLine(target: string, path: () => string, value: unknown): void {
    let file = '?';
    try {
      file = path();
      ensureDir(dirname(file));
      appendFileSync(file, toJsonLine(value), { mode: 0o600 });
      healthy(target);
    } catch (err) {
      fault(target, err, `${target} : écriture impossible dans ${file}`);
    }
  }

  function printEvent(ev: JournalEvent): void {
    try {
      print(consoleLine(tag, ev));
      healthy('console');
    } catch (err) {
      fault('console', err, 'console : affichage impossible');
    }
  }

  function emit(type: JournalType, msg: string, extra?: EventExtra, at?: string): JournalEvent {
    const raw: Record<string, unknown> = { at: at ?? nowIso(), type, mode: deps.mode };
    const mint = read(extra, 'mint');
    const symbol = read(extra, 'symbol');
    const data = read(extra, 'data');
    if (mint !== undefined) raw.mint = mint;
    if (symbol !== undefined) raw.symbol = symbol;
    raw.msg = typeof msg === 'string' ? msg : safeString(msg);
    if (data !== undefined) raw.data = data;
    const clean = redact(raw);
    const ev = (isRecord(clean) ? clean : { at: raw.at, type, mode: deps.mode, msg: '[événement illisible]' }) as unknown as JournalEvent;
    printEvent(ev);
    writeLine('journal', () => join(deps.dataDir, 'journal', `${dayOf(ev.at)}.jsonl`), ev);
    return ev;
  }

  /** Exécute fn ; si une donnée inattendue la fait échouer, écrit quand même un événement minimal. */
  function safely(type: JournalType, fn: () => void, raw: () => unknown): void {
    try {
      fn();
    } catch (err) {
      try {
        emit(type, `journalisation dégradée : ${errText(err)}`, { data: { brut: tryCall(raw) } });
      } catch (err2) {
        reportOnce(`interne:${type}`, `erreur interne du journal (${type}) : ${errText(err2)}`);
      }
    }
  }

  function internalError(where: string, err: unknown): void {
    try {
      emit('error', `journal (${where}) : ${errText(err)}`, { data: { where: `logger.${where}`, error: describeError(err) } });
    } catch (err2) {
      reportOnce(`interne:${where}`, `erreur interne du journal (${where}) : ${errText(err2)}`);
    }
  }

  function remember(c: TokenCandidate): void {
    if (!isRecord(c) || typeof c.mint !== 'string') return;
    candidates.delete(c.mint); // réinsertion : devient le plus récent
    candidates.set(c.mint, c);
    if (candidates.size > CANDIDATE_CACHE_MAX) {
      const oldest = candidates.keys().next().value;
      if (oldest !== undefined) candidates.delete(oldest);
    }
  }

  return {
    event(type, msg, extra) {
      try {
        return emit(type, msg, extra);
      } catch (err) {
        reportOnce('interne:event', `erreur interne du journal : ${errText(err)}`);
        return { at: nowIso(), type, mode: deps.mode, msg: typeof msg === 'string' ? msg : '' };
      }
    },

    scan(r) {
      safely(
        'scan',
        () => {
          const list = Array.isArray(r.candidates) ? r.candidates.filter(isRecord) : [];
          for (const c of list) remember(c);
          const top = list.slice(0, 3).map((c) => ({ symbol: c.symbol, mint: c.mint, score: c.score }));
          emit('scan', scanMessage(r, list), {
            data: {
              examined: r.examined,
              candidates: list.length,
              top,
              rejectedCounts: r.rejectedCounts,
              sourcesOk: r.sourcesOk,
              sourcesFailed: r.sourcesFailed,
            },
          });
        },
        () => r,
      );
    },

    reject(c, v) {
      safely(
        'reject',
        () => {
          remember(c);
          const at = nowIso();
          const codes = textList(v.rejectCodes);
          const reasons = textList(v.reasons);
          const line = {
            at,
            mint: c.mint,
            symbol: c.symbol,
            candidate: {
              liquidityUsd: c.liquidityUsd,
              marketCapUsd: c.marketCapUsd,
              ageMinutes: c.ageMinutes,
              vol5mUsd: c.vol5mUsd,
              spikeRatio: c.spikeRatio,
              buySellRatio: c.buySellRatio,
              priceChange5mPct: c.priceChange5mPct,
              organicScore: c.organicScore,
              score: c.score,
              sources: c.sources,
              // Pour l'analyse a posteriori : prix au moment du rejet et paire où suivre la suite.
              priceUsd: c.priceUsd,
              pairAddress: c.pairAddress,
            },
            rejectCodes: codes,
            reasons,
            roundTripCostPct: v.roundTripCostPct,
            rugcheckScore: v.rugcheckScore,
          };
          writeLine('rejects.jsonl', () => join(deps.dataDir, 'rejects.jsonl'), redact(line));
          let msg = `REJET ${label(c.symbol, c.mint)}`;
          if (codes.length > 0) msg += ` (${codes.join(', ')})`;
          msg += ` — ${reasons.length > 0 ? reasons.join(' ; ') : 'motif non précisé'}`;
          emit(
            'reject',
            msg,
            {
              mint: c.mint,
              symbol: c.symbol,
              data: {
                rejectCodes: codes,
                reasons,
                warnings: v.warnings,
                rugcheckScore: v.rugcheckScore,
                roundTripCostPct: v.roundTripCostPct,
                topHoldersPct: v.topHoldersPct,
              },
            },
            at,
          );
        },
        () => ({ candidate: c, verdict: v }),
      );
    },

    sizeSkip(c, s) {
      safely(
        'size_skip',
        () => {
          remember(c);
          // La conclusion d'une raison « étape ; étape ; verdict » est à la fin : on garde la fin.
          const reason = typeof s.reason === 'string' && s.reason.trim() !== '' ? s.reason.trim() : 'taille nulle';
          emit('size_skip', `PAS D'ACHAT ${label(c.symbol, c.mint)} — ${SIZE_PREFIX}${clipStart(reason, 220)}`, {
            mint: c.mint,
            symbol: c.symbol,
            data: { reason: s.reason, capsApplied: s.capsApplied, sizeSol: s.sizeSol, score: c.score },
          });
        },
        () => ({ candidate: c, size: s }),
      );
    },

    open(p, size) {
      safely(
        'open',
        () => {
          const cached = typeof p.mint === 'string' ? candidates.get(p.mint) : undefined;
          const summary = entrySummary(textList(p.entryReasons), cached);
          emit('open', `ACHAT ${label(p.symbol, p.mint)} ${fmtSol(p.entrySol)} SOL${summary ? ` — ${summary}` : ''}`, {
            mint: p.mint,
            symbol: p.symbol,
            data: {
              positionId: p.id,
              entrySol: p.entrySol,
              tokenAmountRaw: p.tokenAmountRaw,
              decimals: p.decimals,
              pairAddress: p.pairAddress,
              entryLiquidityUsd: p.entryLiquidityUsd,
              signature: p.entryFill?.signature,
              entryReasons: p.entryReasons,
              sizeSol: size?.sizeSol,
              sizeReason: size?.reason,
              capsApplied: size?.capsApplied,
              fill: p.entryFill,
            },
          });
        },
        () => ({ position: p, size }),
      );
    },

    openFailed(c, fill) {
      safely(
        'open_failed',
        () => {
          remember(c);
          const amount = solIn(fill);
          emit('open_failed', `ACHAT ÉCHOUÉ ${label(c.symbol, c.mint)}${amount ? ` ${amount} SOL` : ''} — ${fillError(fill)}`, {
            mint: c.mint,
            symbol: c.symbol,
            data: { error: fill?.error, fill, score: c.score, priceUsd: c.priceUsd, liquidityUsd: c.liquidityUsd },
          });
        },
        () => ({ candidate: c, fill }),
      );
    },

    close(t, fill) {
      // D'abord trades.jsonl (l'equity en dépend), même si la mise en forme échouait ensuite.
      try {
        if (!isRecord(t)) throw new TypeError('ClosedTrade absent ou invalide : trades.jsonl non écrit');
        const line: Record<string, unknown> = { ...t };
        const exitSignature = read(fill, 'signature');
        if (line.exitSignature === undefined && typeof exitSignature === 'string') line.exitSignature = exitSignature;
        line.fill = fill;
        writeLine('trades.jsonl', () => join(deps.dataDir, 'trades.jsonl'), redact(line));
      } catch (err) {
        internalError('close', err);
      }
      safely(
        'close',
        () => {
          emit('close', formatTradeLine(t), {
            mint: t.mint,
            symbol: t.symbol,
            data: {
              id: t.id,
              pnlSol: t.pnlSol,
              pnlPct: t.pnlPct,
              entrySol: t.entrySol,
              exitSol: t.exitSol,
              feesSol: t.feesSol,
              holdMinutes: t.holdMinutes,
              exitReason: t.exitReason,
              exitDetail: t.exitDetail,
              entrySlippageBps: t.entrySlippageBps,
              exitSlippageBps: t.exitSlippageBps,
              entrySignature: t.entrySignature,
              exitSignature: t.exitSignature ?? fill?.signature,
              equityAfterSol: t.equityAfterSol,
              fill,
            },
          });
        },
        () => ({ trade: t, fill }),
      );
    },

    closeFailed(p, fill, reason) {
      safely(
        'close_failed',
        () => {
          emit('close_failed', `VENTE ÉCHOUÉE ${label(p.symbol, p.mint)} (${safeString(reason)}) — ${fillError(fill)}`, {
            mint: p.mint,
            symbol: p.symbol,
            data: {
              positionId: p.id,
              exitReason: reason,
              error: fill?.error,
              entrySol: p.entrySol,
              lastValueSol: p.lastValueSol,
              tokenAmountRaw: p.tokenAmountRaw,
              fill,
            },
          });
        },
        () => ({ position: p, fill, reason }),
      );
    },

    guard(d) {
      safely(
        'guard',
        () => {
          const reasons = textList(d.reasons);
          const key = [...new Set(reasons)].sort().join('\n');
          if (key === lastGuardKey) return;
          lastGuardKey = key;
          emit('guard', guardMessage(d, reasons), {
            data: { allowEntries: d.allowEntries, panic: d.panic, halt: d.halt, reasons },
          });
        },
        () => d,
      );
    },

    error(where, err, data) {
      safely(
        'error',
        () => {
          const info = describeError(err);
          const place = typeof where === 'string' && where !== '' ? where : '?';
          emit('error', errorMessage(place, info), {
            data: data === undefined ? { where: place, error: info } : { where: place, error: info, data },
          });
        },
        () => ({ where, err: errText(err), data }),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Raisons et résumés (fonctions pures)
// ---------------------------------------------------------------------------

/**
 * LA raison de l'achat, dans l'ordre : signaux du scanner, résumé anti-rug (+ avertissements
 * « attention : … »), taille (« taille : … »).
 */
export function buildEntryReasons(c: TokenCandidate, v: RugVerdict, s: SizeDecision): string[] {
  const out: string[] = [];
  const signals = textList(c.signals);
  if (signals.length > 0) out.push(...signals);
  else out.push(marketSummary(c));
  out.push(rugSummary(v));
  for (const w of textList(v.warnings)) out.push(`${WARN_PREFIX}${w}`);
  const reason = typeof s.reason === 'string' && s.reason.trim() !== '' ? s.reason.trim() : `${fmtSol(s.sizeSol)} SOL`;
  out.push(`${SIZE_PREFIX}${reason}`);
  return out;
}

/** Ex. « VENTE BONK +12.3 % (+0.035 SOL) en 41 min — TAKE_PROFIT : +35.2 % depuis l'entrée ». */
export function formatTradeLine(t: ClosedTrade): string {
  let line = `VENTE ${label(t.symbol, t.mint)} ${signedPct(t.pnlPct)} (${signedSol(t.pnlSol)} SOL) en ${fmtDuration(t.holdMinutes)} — ${safeString(t.exitReason)}`;
  const detail = typeof t.exitDetail === 'string' ? t.exitDetail.trim() : '';
  if (detail !== '') line += ` : ${detail}`;
  return line;
}

function rugSummary(v: RugVerdict): string {
  const details: string[] = [];
  if (isNum(v.rugcheckScore)) details.push(`RugCheck score ${fmtPlain(v.rugcheckScore)}`);
  else if (isNum(v.rugcheckScoreNormalised)) details.push(`RugCheck score normalisé ${fmtPlain(v.rugcheckScoreNormalised)}`);
  if (isNum(v.roundTripCostPct)) details.push(`aller-retour ${v.roundTripCostPct.toFixed(2)} %`);
  if (isNum(v.topHoldersPct)) details.push(`top holders ${v.topHoldersPct.toFixed(1)} %`);
  // Seul un pass === true s'écrit OK : un verdict douteux n'est jamais présenté comme bon.
  let line = `${RUG_PREFIX}${v.pass === true ? 'OK' : 'ÉCHEC'}`;
  const codes = textList(v.rejectCodes);
  if (v.pass !== true && codes.length > 0) line += ` [${codes.join(', ')}]`;
  if (details.length > 0) line += ` (${details.join(', ')})`;
  return line;
}

/** Repli quand le scanner n'a fourni aucun signal : la raison d'un achat n'est jamais vide. */
function marketSummary(c: TokenCandidate): string {
  const parts: string[] = [];
  if (isNum(c.spikeRatio)) parts.push(`pic de volume ×${c.spikeRatio.toFixed(1)}`);
  if (isNum(c.buySellRatio)) parts.push(`achats/ventes ×${c.buySellRatio.toFixed(1)}`);
  if (isNum(c.liquidityUsd)) parts.push(`liquidité ${fmtUsd(c.liquidityUsd)}`);
  if (isNum(c.priceChange5mPct)) parts.push(`prix ${signedPct(c.priceChange5mPct)} sur 5 min`);
  if (isNum(c.ageMinutes)) parts.push(`âge ${fmtDuration(c.ageMinutes)}`);
  return parts.length > 0 ? `marché : ${parts.join(', ')}` : 'marché : aucun signal transmis par le scanner';
}

/** « pic ×4.2, achats/ventes ×1.6, RugCheck OK, aller-retour 1.4 % » pour le message d'achat. */
function entrySummary(reasons: string[], c: TokenCandidate | undefined): string {
  const parts: string[] = [];
  if (c !== undefined && (isNum(c.spikeRatio) || isNum(c.buySellRatio))) {
    if (isNum(c.spikeRatio)) parts.push(`pic ×${c.spikeRatio.toFixed(1)}`);
    if (isNum(c.buySellRatio)) parts.push(`achats/ventes ×${c.buySellRatio.toFixed(1)}`);
  } else {
    // Candidat inconnu (pas vu au scan) : premier signal de la chaîne de raisons.
    const signal = reasons.find((r) => !r.startsWith(RUG_PREFIX) && !r.startsWith(WARN_PREFIX) && !r.startsWith(SIZE_PREFIX));
    if (signal !== undefined) parts.push(clip(signal, 80));
  }
  const rug = reasons.find((r) => r.startsWith(RUG_PREFIX));
  if (rug !== undefined) {
    if (rug.startsWith(`${RUG_PREFIX}OK`)) {
      const warnings = reasons.filter((r) => r.startsWith(WARN_PREFIX)).length;
      parts.push(warnings > 0 ? `RugCheck OK (${plural(warnings, 'avertissement')})` : 'RugCheck OK');
    } else {
      parts.push('ATTENTION anti-rug en échec');
    }
    const roundTrip = /aller-retour (-?\d+(?:\.\d+)?) %/.exec(rug)?.[1];
    if (roundTrip !== undefined) parts.push(`aller-retour ${Number(roundTrip).toFixed(1)} %`);
  }
  return parts.join(', ');
}

function scanMessage(r: ScanResult, list: TokenCandidate[]): string {
  const n = list.length;
  let msg = `${isNum(r.examined) ? r.examined : '?'} tokens examinés, ${n === 0 ? 'aucun candidat' : plural(n, 'candidat')}`;
  if (n > 0) msg += ` : ${list.slice(0, 3).map((c) => `${label(c.symbol, c.mint)} ${fmtScore(c.score)}`).join(', ')}`;
  const counts = Object.entries(isRecord(r.rejectedCounts) ? r.rejectedCounts : {})
    .filter(([, count]) => isNum(count) && count > 0)
    .sort((a, b) => b[1] - a[1]);
  if (counts.length > 0) {
    msg += ` — écartés : ${counts.slice(0, 4).map(([code, count]) => `${code} ${count}`).join(', ')}${counts.length > 4 ? ', …' : ''}`;
  }
  const failed = textList(r.sourcesFailed);
  if (failed.length > 0) msg += ` — sources en échec : ${failed.join(', ')}`;
  return msg;
}

function guardMessage(d: GuardDecision, reasons: string[]): string {
  if (reasons.length === 0) {
    return d.allowEntries === false ? 'ENTRÉES BLOQUÉES (motif non précisé)' : 'garde-fous levés : entrées de nouveau autorisées';
  }
  const head = d.panic ? 'PANIQUE' : d.halt ? 'ARRÊT DURABLE' : d.allowEntries === false ? 'ENTRÉES BLOQUÉES' : 'garde-fous';
  return `${head} — ${reasons.join(' ; ')}`;
}

function fillError(fill: Fill): string {
  const error = read(fill, 'error');
  if (typeof error === 'string' && error.trim() !== '') return error.trim();
  return read(fill, 'ok') === true ? 'résultat inattendu' : 'erreur inconnue';
}

/** Montant engagé en SOL si le Fill part de SOL, sinon ''. */
function solIn(fill: Fill): string {
  if (read(fill, 'inputMint') !== SOL_MINT) return '';
  const lamports = Number(read(fill, 'inAmount'));
  return isNum(lamports) && lamports > 0 ? fmtSol(lamports / LAMPORTS_PER_SOL) : '';
}

// ---------------------------------------------------------------------------
// Erreurs
// ---------------------------------------------------------------------------

interface ErrorInfo {
  name?: string;
  message: string;
  code?: string | number;
  status?: number;
  cause?: string;
  /** Première ligne « at … » de la pile, chemins raccourcis. */
  frame?: string;
  /** Corps de réponse d'une erreur HTTP, abrégé. */
  body?: string;
}

function describeError(err: unknown): ErrorInfo {
  if (typeof err === 'string') return { message: err };
  if (err === null || typeof err !== 'object') return { message: safeString(err) };
  const message = read(err, 'message');
  if (!(err instanceof Error) && typeof message !== 'string') return { message: briefJson(err) };
  const info: ErrorInfo = { message: typeof message === 'string' ? message : safeString(message) };
  const name = read(err, 'name');
  if (typeof name === 'string' && name !== '' && name !== 'Error') info.name = name;
  const code = read(err, 'code');
  if (typeof code === 'string' || isNum(code)) info.code = code;
  const status = read(err, 'status');
  if (isNum(status)) info.status = status;
  const cause = read(err, 'cause');
  if (cause !== undefined && cause !== null) info.cause = clip(errText(cause), 300);
  const frame = firstFrame(read(err, 'stack'));
  if (frame !== undefined) info.frame = frame;
  const body = read(err, 'body');
  if (body !== undefined && body !== null && body !== '') info.body = briefJson(body);
  return info;
}

function errorMessage(where: string, info: ErrorInfo): string {
  let msg = `${where} : ${info.name ? `${info.name} : ` : ''}${info.message || 'erreur sans message'}`;
  if (info.cause) msg += ` (cause : ${info.cause})`;
  if (info.frame) msg += ` — à ${info.frame}`;
  return msg;
}

/** Description courte d'une erreur quelconque ; ne lève jamais. */
function errText(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err !== null && typeof err === 'object') {
    const message = read(err, 'message');
    if (typeof message === 'string') {
      const name = read(err, 'name');
      return typeof name === 'string' && name !== '' && name !== 'Error' ? `${name} : ${message}` : message;
    }
    return briefJson(err, 200);
  }
  return safeString(err);
}

function errCode(err: unknown): string {
  const code = read(err, 'code');
  return typeof code === 'string' && code !== '' ? code : 'ERREUR';
}

function firstFrame(stack: unknown): string | undefined {
  if (typeof stack !== 'string') return undefined;
  for (const line of stack.split('\n')) {
    const t = line.trim();
    if (t.startsWith('at ')) return clip(shortenPaths(t.slice(3)), 200);
  }
  return undefined;
}

/** file:///home/…/solbot/src/x.ts → src/x.ts */
function shortenPaths(s: string): string {
  let out = s.replaceAll('file://', '');
  try {
    out = out.replaceAll(process.cwd() + sep, '');
  } catch {
    // répertoire courant introuvable : chemins laissés tels quels
  }
  return out;
}

function briefJson(x: unknown, max = 500): string {
  try {
    const s = typeof x === 'string' ? x : JSON.stringify(redact(x));
    return clip(s === undefined ? safeString(x) : s, max);
  } catch {
    return '[illisible]';
  }
}

// ---------------------------------------------------------------------------
// Sécurité : redact, terminal, lignes JSONL
// ---------------------------------------------------------------------------

interface Walk {
  nodes: number;
  /** Objets en cours de visite : un objet qui se contient lui-même est un cycle. */
  ancestors: Set<object>;
}

/**
 * Copie profonde sûre à écrire : valeur des clés sensibles remplacée par « [masqué] », chaînes de plus
 * de 2000 caractères tronquées (« … »), bigint → chaîne, cycles → « [cycle] », octets bruts et
 * tableaux de 64 octets (format des fichiers de clé Solana) jamais recopiés, secrets glissés dans du
 * texte (?api-key=…, Bearer …) masqués. Ne lève jamais.
 */
export function redact(value: unknown): unknown {
  try {
    return walk(value, 0, { nodes: 0, ancestors: new Set() });
  } catch {
    return '[non sérialisable]';
  }
}

function walk(v: unknown, depth: number, w: Walk): unknown {
  w.nodes++;
  switch (typeof v) {
    case 'string':
      return redactString(v);
    case 'bigint':
      return v.toString();
    case 'symbol':
      return v.toString();
    case 'function':
      return undefined;
    case 'object':
      break;
    default:
      return v; // number, boolean, undefined
  }
  if (v === null) return null;
  if (w.ancestors.has(v)) return '[cycle]';
  if (depth >= MAX_DEPTH) return '[trop profond]';
  if (w.nodes > MAX_NODES) return '[tronqué]';
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString() : null;
  if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return `[binaire ${v.byteLength} octets]`;
  w.ancestors.add(v);
  try {
    if (Array.isArray(v)) return looksLikeSecretKey(v) ? MASK : walkList(v, depth, w);
    if (v instanceof Set) return walkList([...v], depth, w);
    if (v instanceof Map) return walkObject(Object.fromEntries([...v].map(([k, x]) => [String(k), x])), depth, w);
    if (v instanceof Error) return walkError(v, depth, w);
    const toJSON: unknown = (v as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === 'function') {
      const j: unknown = toJSON.call(v);
      if (j !== v) return walk(j, depth + 1, w);
    }
    return walkObject(v, depth, w);
  } finally {
    w.ancestors.delete(v);
  }
}

function walkChild(x: unknown, depth: number, w: Walk): unknown {
  try {
    return walk(x, depth + 1, w);
  } catch {
    return '[illisible]';
  }
}

function walkList(list: readonly unknown[], depth: number, w: Walk): unknown[] {
  const out: unknown[] = [];
  const n = list.length;
  for (let i = 0; i < n; i++) {
    if (w.nodes >= MAX_NODES) {
      out.push(`[tronqué : ${n - i} de plus]`);
      break;
    }
    let x: unknown;
    try {
      x = list[i];
    } catch {
      out.push('[illisible]');
      continue;
    }
    const r = walkChild(x, depth, w);
    out.push(r === undefined ? null : r);
  }
  return out;
}

function walkObject(obj: object, depth: number, w: Walk): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let keys: string[];
  try {
    keys = Object.keys(obj);
  } catch {
    return { illisible: true };
  }
  for (const k of keys) {
    if (w.nodes >= MAX_NODES) {
      put(out, '…', '[tronqué]');
      break;
    }
    let x: unknown;
    try {
      x = (obj as Record<string, unknown>)[k];
    } catch {
      put(out, k, '[illisible]');
      continue;
    }
    if (SENSITIVE_KEY.test(k)) {
      if (x !== undefined) put(out, k, MASK);
      continue;
    }
    const r = walkChild(x, depth, w);
    if (r !== undefined) put(out, k, r);
  }
  return out;
}

function walkError(err: Error, depth: number, w: Walk): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const name = read(err, 'name');
  const message = read(err, 'message');
  out.name = typeof name === 'string' ? name : 'Error';
  out.message = redactString(typeof message === 'string' ? message : safeString(message));
  const frame = firstFrame(read(err, 'stack'));
  if (frame !== undefined) out.stack = redactString(frame);
  const cause = read(err, 'cause');
  if (cause !== undefined) out.cause = walkChild(cause, depth, w);
  // Propriétés propres (status, url, body d'une HttpError, code/path d'une erreur système…).
  for (const [k, x] of Object.entries(walkObject(err, depth, w))) {
    if (!Object.hasOwn(out, k)) put(out, k, x);
  }
  return out;
}

/** Une clé « __proto__ » venue d'un JSON externe reste une simple donnée. */
function put(out: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
  else out[key] = value;
}

/** 64 entiers 0–255 : le format d'un fichier de clé Solana (solana-keygen). Jamais dans un journal. */
function looksLikeSecretKey(list: readonly unknown[]): boolean {
  return list.length === 64 && list.every((x) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 255);
}

function redactString(s: string): string {
  if (s.length <= MAX_STRING) return scrubSecrets(s);
  return `${scrubSecrets(s.slice(0, safeCut(s, MAX_STRING)))}…`;
}

function scrubSecrets(s: string): string {
  if (!/[=@]|bearer/i.test(s)) return s;
  return s.replace(URL_SECRET_PARAM, `$1${MASK}`).replace(URL_USERINFO, `$1${MASK}@`).replace(BEARER, `$1${MASK}`);
}

/**
 * Texte sûr pour un terminal : les symboles et noms de tokens sont écrits par des inconnus et peuvent
 * contenir des séquences ANSI (effacer l'écran, OSC 52 = écrire dans le presse-papiers…) ou des
 * inversions bidi. Retire tous les contrôles C0/C1 (tabulations et fins de ligne deviennent une
 * espace), les caractères bidi, de largeur nulle et le BOM ; 300 caractères au plus.
 */
export function sanitizeForTerminal(s: string): string {
  const text = typeof s === 'string' ? s : safeString(s);
  return clip(text.replace(TERMINAL_BLANKS, ' ').replace(TERMINAL_UNSAFE, ''), MAX_TERMINAL);
}

function consoleLine(tag: string, ev: JournalEvent): string {
  const type = safeString(ev.type).toUpperCase().padEnd(TYPE_WIDTH);
  return sanitizeForTerminal(`${clockTime(ev.at)} [${tag}] ${type}  ${safeString(ev.msg)}`);
}

/** JSON sur une ligne ; les caractères dangereux pour un terminal sont échappés (\uXXXX), sans perte. */
function toJsonLine(value: unknown): string {
  const json = JSON.stringify(value) ?? 'null';
  return `${json.replace(JSON_UNSAFE, escapeUnits)}\n`;
}

function escapeUnits(ch: string): string {
  let out = '';
  for (let i = 0; i < ch.length; i++) out += `\\u${ch.charCodeAt(i).toString(16).padStart(4, '0')}`;
  return out;
}

// ---------------------------------------------------------------------------
// Petits utilitaires
// ---------------------------------------------------------------------------

function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

/** Lecture de propriété qui ne lève jamais (objet absent, accesseur qui lève…). */
function read(obj: unknown, key: string): unknown {
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function tryCall(fn: () => unknown): unknown {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function safeString(x: unknown): string {
  try {
    return String(x);
  } catch {
    return '[illisible]';
  }
}

function textList(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : [];
}

/** Position de coupe ≤ max qui ne sépare pas une paire de substitution (emoji…). */
function safeCut(s: string, max: number): number {
  const c = s.charCodeAt(max - 1);
  return c >= 0xd800 && c <= 0xdbff ? max - 1 : max;
}

/** Au plus `max` caractères, points de suspension compris. */
function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, safeCut(s, max - 1))}…`;
}

/** Comme clip, mais garde la FIN du texte. */
function clipStart(s: string, max: number): string {
  if (s.length <= max) return s;
  let start = s.length - (max - 1);
  const c = s.charCodeAt(start);
  if (c >= 0xdc00 && c <= 0xdfff) start++;
  return `…${s.slice(start)}`;
}

/** Symbole lisible pour un message : nettoyé, court ; à défaut, mint abrégé. */
function label(symbol: unknown, mint: unknown): string {
  const s = typeof symbol === 'string' ? sanitizeForTerminal(symbol).trim() : '';
  if (s !== '') return clip(s, MAX_LABEL);
  if (typeof mint === 'string' && mint.length > 8) return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  return typeof mint === 'string' && mint !== '' ? mint : '?';
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n >= 2 ? 's' : ''}`;
}

/** Sans « -0.0 » ni « +0.0 » : zéro s'écrit sans signe. */
function withSign(x: number, digits: number): string {
  const s = x.toFixed(digits);
  if (Number(s) === 0) return (0).toFixed(digits);
  return x > 0 ? `+${s}` : s;
}

/** SOL : 3 décimales, 4 sous 0.01 pour ne pas afficher « 0.000 ». */
function solDigits(x: number): number {
  const abs = Math.abs(x);
  return abs > 0 && abs < 0.01 ? 4 : 3;
}

function fmtSol(x: unknown): string {
  return isNum(x) ? x.toFixed(solDigits(x)) : '?';
}

function signedSol(x: unknown): string {
  return isNum(x) ? withSign(x, solDigits(x)) : '?';
}

function signedPct(x: unknown): string {
  return isNum(x) ? `${withSign(x, 1)} %` : '? %';
}

function fmtScore(x: unknown): string {
  return isNum(x) ? x.toFixed(1) : '?';
}

function fmtPlain(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

function fmtUsd(x: number): string {
  const abs = Math.abs(x);
  if (abs >= 1e6) return `${(x / 1e6).toFixed(1)} M$`;
  if (abs >= 1e3) return `${(x / 1e3).toFixed(1)} k$`;
  return `${x.toFixed(0)} $`;
}

function fmtDuration(minutes: unknown): string {
  if (!isNum(minutes) || minutes < 0) return '? min';
  if (minutes < 1) return `${Math.round(minutes * 60)} s`;
  if (minutes < 120) return `${Math.round(minutes)} min`;
  return `${(minutes / 60).toFixed(1)} h`;
}

/** HH:MM:SS (UTC) d'une date ISO. */
function clockTime(at: unknown): string {
  const ms = typeof at === 'string' ? Date.parse(at) : Number.NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(11, 19) : '--:--:--';
}

/** Date UTC (AAAA-MM-JJ) du champ `at` d'un événement : nom du fichier du jour. */
function dayOf(at: unknown): string {
  const ms = typeof at === 'string' ? Date.parse(at) : Number.NaN;
  return utcDate(Number.isFinite(ms) ? ms : Date.now());
}
