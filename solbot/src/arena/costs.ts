/**
 * Coûts par plateforme (par côté), partagés par les portefeuilles de l'arène et les 12 comptes. Module à part : le
 * Worker du suivi en direct les importe sans charger la liste complète des portefeuilles.
 */

import type { Costs } from './engine.ts';

/** Coûts par plateforme (par côté). */
export const COSTS = {
  /** Actions et ETF US au comptant, courtier sans commission ; écart et glissement prudents. */
  actions: { feeBps: 0, slipBps: 3, financingPct: 0, minNotional: 1 },
  /** SPY au comptant (l'ETF le plus liquide du monde : écart d'un cent). */
  spy: { feeBps: 0, slipBps: 1, financingPct: 0, minNotional: 1 },
  /** CFD sur actions (sans commission, écart) ; financement de nuit ~ taux + 2,5 %. */
  cfdActions: { feeBps: 0, slipBps: 3, financingPct: 6.5, minNotional: 1 },
  /** CFD sur l'indice S&P 500. */
  cfdIndice: { feeBps: 0, slipBps: 0.5, financingPct: 6.5, minNotional: 1 },
  /** CFD or : écart ~0,30–0,40 $ l'once ; lot minimal 0,01 (1 once). */
  cfdOr: { feeBps: 0, slipBps: 1, financingPct: 6.5, minNotional: 1 },
  /** Or chez un courtier étranger à levier extrême (façon groupes Telegram) : écart plus large. */
  orOffshore: { feeBps: 0, slipBps: 1.5, financingPct: 8, minNotional: 1 },
  /** Revolut X au comptant : 0 % maker, 0,09 % taker, plus le glissement des ordres au marché. */
  revolutX: { feeBps: 9, makerFeeBps: 0, slipBps: 2, financingPct: 0, minNotional: 1 },
  /** CFD crypto (levier 2:1 maximum pour un particulier en Europe) : écart plus large, financement élevé. */
  cfdCrypto: { feeBps: 0, slipBps: 5, financingPct: 20, minNotional: 1 },
} satisfies Record<string, Costs>;
