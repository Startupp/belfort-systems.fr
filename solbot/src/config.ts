/**
 * Configuration : variables d'environnement (fichier .env, voir .env.example) + valeurs par défaut
 * prudentes + PLAFONDS EN DUR que la configuration ne peut jamais dépasser.
 *
 * Les plafonds en dur protègent contre une faute de frappe (« 5 » au lieu de « 0.5 ») ou un
 * fichier .env modifié par quelqu'un d'autre : ils ne se changent qu'en modifiant ce fichier.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { Mode } from './types.ts';

/** Limites absolues. Modifier ici seulement en connaissance de cause. */
export const HARD_LIMITS = {
  /** Taille maximale d'UNE position, quelle que soit l'equity. */
  maxPositionSol: 1,
  maxOpenPositions: 5,
  maxTradesPerHour: 12,
  /** Part maximale de l'equity engagée dans l'ensemble des positions. */
  maxExposurePct: 50,
  /** Part maximale de la liquidité d'une paire qu'une position peut représenter. */
  maxPoolSharePct: 2,
  /** Au-delà, le bot refuse de démarrer en live : ce n'est plus un « petit budget ». */
  maxWalletSol: 25,
  /** Coût aller-retour toléré au maximum par le filtre anti-rug. */
  maxRoundTripCostPct: 15,
  /** Perte totale depuis le départ au-delà de laquelle le bot s'arrête définitivement. */
  maxHaltDrawdownPct: 80,
} as const;

export interface ScannerConfig {
  minLiquidityUsd: number;
  minAgeMinutes: number;
  maxAgeHours: number;
  minVol5mUsd: number;
  minSpikeRatio: number;
  minBuys5m: number;
  minBuySellRatio: number;
  /** On n'achète pas une bougie déjà verticale. */
  maxPriceChange5mPct: number;
  minPriceChange5mPct: number;
  minMarketCapUsd: number;
  maxMarketCapUsd: number;
  /** Symboles de cotation acceptés pour la paire de référence. */
  quoteSymbols: string[];
  /** Nombre maximal de candidats renvoyés par scan. */
  maxCandidates: number;
}

export interface RugConfig {
  maxTopHoldersPct: number;
  /** Nombre d'avertissements RugCheck (niveau « warn ») tolérés. */
  maxRugcheckWarnings: number;
  maxRoundTripCostPct: number;
  /** Taille de la sonde utilisée pour mesurer le coût aller-retour. */
  roundTripProbeSol: number;
  /** 0 = désactivé. */
  minOrganicScore: number;
  /** Sous-chaînes (minuscules) de noms de risques RugCheck qui rejettent toujours. */
  blockedRiskNames: string[];
  /** Durée de validité d'un verdict en cache. */
  cacheMinutes: number;
}

export interface SizerConfig {
  positionPct: number;
  minPositionSol: number;
  maxPositionSol: number;
  maxOpenPositions: number;
  maxExposurePct: number;
  maxPoolSharePct: number;
  /** SOL jamais engagé : frais, loyer des comptes de tokens. */
  feeReserveSol: number;
  /** Au-delà de ce drawdown (depuis le plus haut), la taille est divisée par 2. */
  drawdownHalveAtPct: number;
}

export interface ExitConfig {
  stopLossPct: number;
  takeProfitPct: number;
  /** Le stop suiveur s'arme quand la position gagne au moins ce %. */
  trailArmPct: number;
  /** Puis vend si la valeur recule de ce % depuis son plus haut. */
  trailPct: number;
  maxHoldMinutes: number;
  /** Vend si la liquidité de la paire fond de ce % depuis l'entrée. */
  liquidityDrainPct: number;
  /** Impact/slippage maximal accepté sur un devis d'achat (bps). */
  maxEntryPriceImpactBps: number;
}

export interface GuardConfig {
  dailyLossLimitPct: number;
  maxConsecutiveLosses: number;
  pauseAfterLossesMinutes: number;
  maxTradesPerHour: number;
  haltDrawdownPct: number;
  tokenCooldownHours: number;
  maxWalletSol: number;
}

export interface PaperConfig {
  startSol: number;
  /** Pénalité ajoutée au devis pour simuler latence, MEV et mouvement de prix (bps). */
  extraSlippageBps: number;
  /** Frais réseau + priorité simulés par transaction (lamports). */
  feeLamportsPerTx: number;
  /** Loyer d'un compte de token, compté comme perdu à chaque nouvel achat (lamports). */
  rentLamportsPerBuy: number;
}

export interface SweepConfig {
  /** Adresse publique du coffre (ex. ton wallet Phantom principal). Vide = pas de mise à l'abri. */
  vaultAddress?: string;
  /** Mettre à l'abri quand l'equity dépasse le capital initial de ce %. */
  triggerPct: number;
}

export interface Config {
  mode: Mode;
  /** Garde-fou explicite : le live exige LIVE_CONFIRM=je-peux-perdre-ce-budget. */
  liveConfirmed: boolean;
  dataDir: string;
  keypairPath: string;
  /** apiKey vide = accès sans clé (débit réduit). */
  jupiter: { baseUrl: string; apiKey: string };
  rpcUrl?: string;
  rugcheck: { baseUrl: string; apiKey?: string };
  dexscreenerBaseUrl: string;
  loop: { scanIntervalSec: number; exitCheckSec: number };
  scanner: ScannerConfig;
  rug: RugConfig;
  sizer: SizerConfig;
  exits: ExitConfig;
  guards: GuardConfig;
  paper: PaperConfig;
  sweep: SweepConfig;
  /** Programmes Solana autorisés dans une transaction de swap (pare-feu avant signature). */
  allowedPrograms: string[];
}

export const LIVE_CONFIRM_PHRASE = 'je-peux-perdre-ce-budget';

/** Programmes connus utilisés par les routes Jupiter. Ajoutables via ALLOWED_PROGRAMS. */
export const DEFAULT_ALLOWED_PROGRAMS = [
  'ComputeBudget111111111111111111111111111111',
  '11111111111111111111111111111111', // System
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Account
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter Aggregator v6 (Metis)
  '61DFfeTKM7trxYcPQCM78bJ794ddZprZpAwAnLiwTpYH', // Jupiter Order Engine (JupiterZ)
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', // Memo
];

export class ConfigError extends Error {
  override name = 'ConfigError';
}

type Env = Record<string, string | undefined>;

function num(env: Env, key: string, def: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return def;
  const v = Number(raw.replace(',', '.'));
  if (!Number.isFinite(v)) throw new ConfigError(`${key}=${raw} n'est pas un nombre`);
  if (v < min || v > max) throw new ConfigError(`${key}=${v} hors bornes [${min} ; ${max}]`);
  return v;
}

function str(env: Env, key: string, def: string): string {
  const raw = env[key];
  return raw === undefined || raw.trim() === '' ? def : raw.trim();
}

function list(env: Env, key: string, def: string[]): string[] {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return def;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2));
  return p;
}

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidAddress(s: string): boolean {
  return BASE58_ADDRESS.test(s);
}

/** Charge .env (s'il existe) dans process.env. Les variables déjà définies l'emportent. */
export function loadDotEnv(path = '.env'): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

export function loadConfig(env: Env = process.env, cwd = process.cwd()): Config {
  const modeRaw = str(env, 'MODE', 'paper');
  if (modeRaw !== 'paper' && modeRaw !== 'live') throw new ConfigError(`MODE=${modeRaw} : attendu paper ou live`);
  const mode: Mode = modeRaw;

  const dataDirRaw = expandHome(str(env, 'DATA_DIR', 'data'));
  const dataDir = isAbsolute(dataDirRaw) ? dataDirRaw : resolve(cwd, dataDirRaw);
  const keypairPath = resolve(cwd, expandHome(str(env, 'KEYPAIR_PATH', '~/.solbot/keypair.json')));

  // Facultative : sans clé, Jupiter répond à faible débit (suffisant en papier). Une clé gratuite
  // du portail https://developers.jup.ag donne plus de marge ; une clé FAUSSE est refusée (HTTP 401).
  const apiKey = str(env, 'JUPITER_API_KEY', '');

  const rpcUrl = str(env, 'RPC_URL', '') || undefined;
  if (mode === 'live' && !rpcUrl) {
    throw new ConfigError('RPC_URL obligatoire en live (ex. Helius, offre gratuite) : solde, simulation, réconciliation');
  }

  const vault = str(env, 'VAULT_ADDRESS', '');
  if (vault && !isValidAddress(vault)) throw new ConfigError(`VAULT_ADDRESS=${vault} n'est pas une adresse Solana valide`);

  const extraPrograms = list(env, 'ALLOWED_PROGRAMS', []);
  for (const p of extraPrograms) {
    if (!isValidAddress(p)) throw new ConfigError(`ALLOWED_PROGRAMS : ${p} n'est pas une adresse valide`);
  }

  const config: Config = {
    mode,
    liveConfirmed: str(env, 'LIVE_CONFIRM', '') === LIVE_CONFIRM_PHRASE,
    dataDir,
    keypairPath,
    jupiter: { baseUrl: str(env, 'JUPITER_BASE_URL', 'https://api.jup.ag').replace(/\/+$/, ''), apiKey },
    rpcUrl,
    rugcheck: {
      baseUrl: str(env, 'RUGCHECK_BASE_URL', 'https://api.rugcheck.xyz').replace(/\/+$/, ''),
      apiKey: str(env, 'RUGCHECK_API_KEY', '') || undefined,
    },
    dexscreenerBaseUrl: str(env, 'DEXSCREENER_BASE_URL', 'https://api.dexscreener.com').replace(/\/+$/, ''),
    loop: {
      scanIntervalSec: num(env, 'SCAN_INTERVAL_SEC', 60, 15, 3600),
      exitCheckSec: num(env, 'EXIT_CHECK_SEC', 20, 5, 600),
    },
    scanner: {
      minLiquidityUsd: num(env, 'MIN_LIQUIDITY_USD', 25_000, 1_000, 1e9),
      minAgeMinutes: num(env, 'MIN_AGE_MIN', 30, 0, 1e6),
      maxAgeHours: num(env, 'MAX_AGE_HOURS', 72, 1, 1e6),
      minVol5mUsd: num(env, 'MIN_VOL5M_USD', 5_000, 0, 1e9),
      minSpikeRatio: num(env, 'MIN_SPIKE_RATIO', 3, 1, 1000),
      minBuys5m: num(env, 'MIN_BUYS_5M', 20, 0, 1e6),
      minBuySellRatio: num(env, 'MIN_BUY_SELL_RATIO', 1.2, 0, 100),
      maxPriceChange5mPct: num(env, 'MAX_PRICE_CHANGE_5M_PCT', 30, -100, 10_000),
      minPriceChange5mPct: num(env, 'MIN_PRICE_CHANGE_5M_PCT', 0, -100, 10_000),
      minMarketCapUsd: num(env, 'MIN_MCAP_USD', 100_000, 0, 1e12),
      maxMarketCapUsd: num(env, 'MAX_MCAP_USD', 50_000_000, 0, 1e12),
      quoteSymbols: list(env, 'QUOTE_SYMBOLS', ['SOL', 'WSOL', 'USDC']).map((s) => s.toUpperCase()),
      maxCandidates: num(env, 'MAX_CANDIDATES', 5, 1, 50),
    },
    rug: {
      maxTopHoldersPct: num(env, 'MAX_TOP_HOLDERS_PCT', 30, 1, 100),
      maxRugcheckWarnings: num(env, 'MAX_RUGCHECK_WARNINGS', 2, 0, 50),
      maxRoundTripCostPct: Math.min(num(env, 'MAX_ROUNDTRIP_COST_PCT', 5, 0.1, 100), HARD_LIMITS.maxRoundTripCostPct),
      roundTripProbeSol: num(env, 'ROUNDTRIP_PROBE_SOL', 0.3, 0.001, HARD_LIMITS.maxPositionSol),
      minOrganicScore: num(env, 'MIN_ORGANIC_SCORE', 30, 0, 100),
      blockedRiskNames: list(env, 'BLOCKED_RISK_NAMES', [
        'freeze authority',
        'mint authority',
        'permanent delegate',
        'transfer fee',
        'transfer hook',
        'non-transferable',
        'copycat',
        'rugged',
        'honeypot',
      ]).map((s) => s.toLowerCase()),
      cacheMinutes: num(env, 'RUG_CACHE_MIN', 10, 0, 1440),
    },
    sizer: {
      positionPct: num(env, 'POSITION_PCT', 4, 0.1, 25),
      minPositionSol: num(env, 'MIN_POSITION_SOL', 0.05, 0.001, HARD_LIMITS.maxPositionSol),
      maxPositionSol: Math.min(num(env, 'MAX_POSITION_SOL', 0.4, 0.001, 1e6), HARD_LIMITS.maxPositionSol),
      maxOpenPositions: Math.min(num(env, 'MAX_OPEN_POSITIONS', 3, 1, 1e3), HARD_LIMITS.maxOpenPositions),
      maxExposurePct: Math.min(num(env, 'MAX_EXPOSURE_PCT', 30, 1, 100), HARD_LIMITS.maxExposurePct),
      maxPoolSharePct: Math.min(num(env, 'MAX_POOL_SHARE_PCT', 1, 0.01, 100), HARD_LIMITS.maxPoolSharePct),
      feeReserveSol: num(env, 'FEE_RESERVE_SOL', 0.05, 0.01, 10),
      drawdownHalveAtPct: num(env, 'DRAWDOWN_HALVE_AT_PCT', 25, 1, 100),
    },
    exits: {
      stopLossPct: num(env, 'STOP_LOSS_PCT', 20, 1, 95),
      takeProfitPct: num(env, 'TAKE_PROFIT_PCT', 35, 1, 10_000),
      trailArmPct: num(env, 'TRAIL_ARM_PCT', 15, 0, 10_000),
      trailPct: num(env, 'TRAIL_PCT', 12, 1, 95),
      maxHoldMinutes: num(env, 'MAX_HOLD_MIN', 90, 1, 100_000),
      liquidityDrainPct: num(env, 'LIQ_DRAIN_EXIT_PCT', 40, 1, 100),
      maxEntryPriceImpactBps: num(env, 'MAX_ENTRY_IMPACT_BPS', 150, 1, 5_000),
    },
    guards: {
      dailyLossLimitPct: num(env, 'DAILY_LOSS_LIMIT_PCT', 10, 1, 100),
      maxConsecutiveLosses: num(env, 'MAX_CONSECUTIVE_LOSSES', 5, 1, 1000),
      pauseAfterLossesMinutes: num(env, 'PAUSE_AFTER_LOSSES_MIN', 360, 1, 100_000),
      maxTradesPerHour: Math.min(num(env, 'MAX_TRADES_PER_HOUR', 6, 1, 1e3), HARD_LIMITS.maxTradesPerHour),
      haltDrawdownPct: Math.min(num(env, 'HALT_DRAWDOWN_PCT', 50, 5, 100), HARD_LIMITS.maxHaltDrawdownPct),
      tokenCooldownHours: num(env, 'TOKEN_COOLDOWN_HOURS', 24, 0, 10_000),
      maxWalletSol: Math.min(num(env, 'MAX_WALLET_SOL', 10, 0.01, 1e6), HARD_LIMITS.maxWalletSol),
    },
    paper: {
      startSol: num(env, 'PAPER_START_SOL', 7, 0.01, 1e6),
      extraSlippageBps: num(env, 'PAPER_EXTRA_SLIPPAGE_BPS', 150, 0, 5_000),
      feeLamportsPerTx: num(env, 'PAPER_FEE_LAMPORTS', 150_000, 0, 1e9),
      rentLamportsPerBuy: num(env, 'PAPER_RENT_LAMPORTS', 2_039_280, 0, 1e9),
    },
    sweep: {
      vaultAddress: vault || undefined,
      triggerPct: num(env, 'SWEEP_TRIGGER_PCT', 20, 1, 10_000),
    },
    allowedPrograms: [...new Set([...DEFAULT_ALLOWED_PROGRAMS, ...extraPrograms])],
  };

  if (config.sizer.minPositionSol > config.sizer.maxPositionSol) {
    throw new ConfigError('MIN_POSITION_SOL ne peut pas dépasser MAX_POSITION_SOL');
  }
  if (config.scanner.minMarketCapUsd > config.scanner.maxMarketCapUsd) {
    throw new ConfigError('MIN_MCAP_USD ne peut pas dépasser MAX_MCAP_USD');
  }
  return config;
}

/** Version courte et sans secret de la config, pour le journal de démarrage. */
export function describeConfig(c: Config): Record<string, unknown> {
  return {
    mode: c.mode,
    dataDir: c.dataDir,
    rpc: c.rpcUrl ? new URL(c.rpcUrl).host : null,
    vault: c.sweep.vaultAddress ? `${c.sweep.vaultAddress.slice(0, 4)}…${c.sweep.vaultAddress.slice(-4)}` : null,
    scanner: c.scanner,
    rug: { ...c.rug, blockedRiskNames: c.rug.blockedRiskNames.length },
    sizer: c.sizer,
    exits: c.exits,
    guards: c.guards,
    paper: c.mode === 'paper' ? c.paper : undefined,
  };
}
