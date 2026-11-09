/**
 * Carnet de trades : carnet.html (lisible sur téléphone, sans script) et carnet.csv (tableur).
 * Pour chaque séance : actions prises et pourquoi, analyses effectuées, prévisions pour la suivante.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, readJsonl, writeTextAtomic } from '../lib/store.ts';
import { hhmm, paris } from './market.ts';
import { STRATEGY_LABEL } from './engine.ts';
import type { DaySummary } from './engine.ts';
import type { ClosedTrade, DeskConfig, DeskState, StrategyId } from './types.ts';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c] ?? c);
const fr = (x: number, d = 2): string => (Number.isFinite(x) ? x.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const sgn = (x: number, d = 2): string => `${x > 0 ? '+' : ''}${fr(x, d)}`;
const time = (ms: number): string => hhmm(paris(ms).minutes);
const price = (x: number): string => (x >= 100 ? fr(x, 2) : x >= 1 ? fr(x, 4) : x.toPrecision(5));
const SIDE = { long: 'achat', short: 'vente' } as const;

function loadDays(dir: string): DaySummary[] {
  const d = join(dir, 'days');
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => readJson<DaySummary | null>(join(d, f), null))
    .filter((x): x is DaySummary => x !== null);
}

export function carnetCsv(trades: ClosedTrade[]): string {
  const head = 'date;heure_entree;heure_sortie;instrument;classe;sens;strategie;quantite;prix_entree;prix_sortie;montant_usd;pnl_usd;r;frais_usd;raison_sortie;raisons_entree';
  const q = (s: string): string => `"${s.replace(/"/g, '""')}"`;
  const rows = trades.map((t) =>
    [
      paris(t.openedAt).date,
      time(t.openedAt),
      time(t.closedAt),
      t.symbol,
      t.cls,
      SIDE[t.side],
      STRATEGY_LABEL[t.strategy],
      t.qty.toFixed(6),
      t.entry.toFixed(6),
      t.exit.toFixed(6),
      t.notionalUsd.toFixed(2),
      t.pnlUsd.toFixed(4),
      t.r.toFixed(2),
      t.costsUsd.toFixed(4),
      q(t.exitReason),
      q(t.reasons.join(' | ')),
    ].join(';'),
  );
  return [head, ...rows].join('\n') + '\n';
}

function equityChart(trades: ClosedTrade[], start: number): string {
  if (trades.length < 1) return '<p class="muted">La courbe apparaîtra après le premier trade.</p>';
  const pts = [start, ...trades.map((t) => t.equityAfter)];
  const W = 640;
  const H = 160;
  const lo = Math.min(...pts, start * 0.99);
  const hi = Math.max(...pts, start * 1.01);
  const x = (i: number): number => 40 + (i / (pts.length - 1 || 1)) * (W - 48);
  const y = (v: number): number => 8 + (1 - (v - lo) / (hi - lo)) * (H - 24);
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const target = start * 1.01;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Equity après chaque trade">
<line x1="40" x2="${W - 8}" y1="${y(start).toFixed(1)}" y2="${y(start).toFixed(1)}" class="ref"/>
<line x1="40" x2="${W - 8}" y1="${y(target).toFixed(1)}" y2="${y(target).toFixed(1)}" class="goal"/>
<path d="${d}" class="line"/>
<text x="36" y="${y(start).toFixed(1)}" class="ax" text-anchor="end" dominant-baseline="middle">${fr(start, 0)} $</text>
<text x="${W - 10}" y="${(y(target) - 4).toFixed(1)}" class="ax goalx" text-anchor="end">objectif +1 %</text>
<text x="40" y="${H - 4}" class="ax">trade 1</text><text x="${W - 8}" y="${H - 4}" class="ax" text-anchor="end">trade ${trades.length}</text>
</svg>`;
}

function tradeRows(trades: ClosedTrade[], withDate: boolean): string {
  return trades
    .map(
      (t) => `<tr class="${t.pnlUsd > 0 ? 'win' : 'loss'}">
${withDate ? `<td>${esc(paris(t.openedAt).date.slice(5))}</td>` : ''}<td>${time(t.openedAt)} → ${time(t.closedAt)}</td><td><b>${esc(t.symbol)}</b></td><td>${SIDE[t.side]}</td><td>${esc(STRATEGY_LABEL[t.strategy])}</td>
<td>${fr(t.notionalUsd, 0)} $</td><td>${price(t.entry)} → ${price(t.exit)}</td><td class="${t.pnlUsd > 0 ? 'good' : 'bad'}">${sgn(t.pnlUsd)} $</td><td>${sgn(t.r)} R</td>
<td><details><summary>${esc(t.exitReason)}</summary><ul>${t.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}<li>frais ${fr(t.costsUsd, 3)} $ · durée ${t.holdMinutes} min</li></ul></details></td></tr>`,
    )
    .join('');
}

function daySection(s: DaySummary): string {
  const a = s.analysis;
  const regimes = a.regimes
    .map((r) => {
      const tr = r.items.filter((i) => i.regime === 'tendance').length;
      const rg = r.items.filter((i) => i.regime === 'range').length;
      return `${esc(r.time)} : ${tr} en tendance, ${rg} en range, ${r.items.length - tr - rg} mixtes`;
    })
    .join(' · ');
  const notes = Object.entries(a.notes)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 6)
    .map(([k, v]) => `<li>${esc(k.replace(/#/g, '…'))} <span class="muted">(${v}×)</span></li>`)
    .join('');
  const skipped = Object.entries(a.skipped)
    .map(([k, v]) => `${esc(k)} (${v})`)
    .join(', ');
  const strat = (Object.keys(s.byStrategy) as StrategyId[])
    .map((k) => `${esc(STRATEGY_LABEL[k])} : ${s.byStrategy[k].n} trade(s), ${sgn(s.byStrategy[k].pnlUsd)} $ — poids ${fr(s.weightsStart[k])} → ${fr(s.weightsEnd[k])}`)
    .map((x) => `<li>${x}</li>`)
    .join('');
  return `<section class="card">
<h2>Séance du ${esc(s.day)} — <span class="${s.pnlUsd >= 0 ? 'good' : 'bad'}">${sgn(s.pnlUsd)} $ (${sgn(s.pnlPct)} %)</span></h2>
<p class="muted">${s.trades.length} trade(s), réussite ${fr(s.winRatePct, 0)} %, R moyen ${sgn(s.avgR)} · equity ${fr(s.equityStart)} → ${fr(s.equityEnd)} $</p>
<h3>Actions prises</h3>
${s.trades.length ? `<div class="scroll"><table><tr><th>Heure</th><th>Instrument</th><th>Sens</th><th>Stratégie</th><th>Taille</th><th>Prix</th><th>PnL</th><th>R</th><th>Pourquoi (clic)</th></tr>${tradeRows(s.trades, false)}</table></div>` : '<p>Aucun trade : aucun setup ne passait les filtres, ou un garde-fou a bloqué.</p>'}
<ul>${strat}</ul>
<h3>Analyses effectuées</h3>
<ul>
<li>Actions « en jeu » à l'ouverture (volume relatif des 5 premières minutes) : ${a.stocksInPlay.length ? a.stocksInPlay.slice(0, 6).map((x) => `${esc(x.symbol)} ${fr(x.rv)}× ${x.bullish ? '↑' : '↓'}`).join(', ') : '—'}</li>
<li>Régimes de marché : ${regimes || '—'}</li>
<li>Signaux valides : ${a.signalsSeen}, pris : ${a.signalsTaken}${skipped ? ` ; écartés : ${skipped}` : ''}${a.huntAt ? ` ; mode chasse à ${esc(a.huntAt)}` : ''}${a.dailyStopAt ? ` ; stop journalier à ${esc(a.dailyStopAt)}` : ''}</li>
${notes ? `<li>Setups refusés les plus fréquents :<ul>${notes}</ul></li>` : ''}
</ul>
<h3>Prévisions pour la séance suivante</h3>
<ul>${s.forecast.outlook.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>
${s.forecast.watchlist.length ? `<p><b>À surveiller :</b></p><ul>${s.forecast.watchlist.map((w) => `<li><b>${esc(w.symbol)}</b> — ${esc(w.why)}</li>`).join('')}</ul>` : ''}
</section>`;
}

export function writeCarnet(dir: string, cfg: DeskConfig, opts: { title: string; mode: 'direct' | 'rejeu' }): string {
  const trades = readJsonl<ClosedTrade>(join(dir, 'trades.jsonl'));
  const days = loadDays(dir);
  const state = readJson<DeskState | null>(join(dir, 'state.json'), null);
  writeTextAtomic(join(dir, 'carnet.csv'), carnetCsv(trades));
  const start = state?.startEquity ?? cfg.startEquity;
  const eq = trades.at(-1)?.equityAfter ?? start;
  const pnl = eq - start;
  const wins = trades.filter((t) => t.pnlUsd > 0).length;
  const fees = trades.reduce((s, t) => s + t.costsUsd, 0);
  let peak = start;
  let mdd = 0;
  for (const t of trades) {
    peak = Math.max(peak, t.equityAfter);
    mdd = Math.max(mdd, ((peak - t.equityAfter) / peak) * 100);
  }
  const lastDay = days.at(-1);
  const weekPct = lastDay?.forecast.week.pnlPct ?? 0;
  const progress = Math.max(0, Math.min(100, weekPct * 100));
  const avgPerDay = days.length ? trades.length / days.length : 0;
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="120">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>Carnet de trades — desk papier</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#14171c;--muted:#667085;--line:#e4e7ec;--good:#0a7a4b;--bad:#b42318;--acc:#3b5bdb;--goal:#a15c07}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a21;--fg:#e6e8ec;--muted:#98a2b3;--line:#2a2f3a;--good:#3ccf91;--bad:#f97066;--acc:#8ea2ff;--goal:#fdb022}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1080px;margin:0 auto;padding:16px}h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:0 0 6px}h3{font-size:14px;margin:14px 0 6px}
.muted{color:var(--muted)}.good{color:var(--good)}.bad{color:var(--bad)}.banner{border:1px solid var(--acc);border-radius:10px;padding:10px 12px;margin:10px 0;background:var(--card)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:12px 0}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}.kpi{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px}
.kl{font-size:12px;color:var(--muted)}.kv{font-size:20px;font-weight:650}.ks{font-size:12px;color:var(--muted)}
.bar{height:8px;border-radius:4px;background:var(--line);overflow:hidden;margin-top:6px}.bar>div{height:100%;background:var(--good)}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:5px 7px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;color:var(--muted)}
tr.win td:first-child{border-left:3px solid var(--good)}tr.loss td:first-child{border-left:3px solid var(--bad)}details ul{margin:4px 0 0 16px;padding:0}summary{cursor:pointer}
svg{width:100%;height:auto;display:block}.line{fill:none;stroke:var(--acc);stroke-width:2}.ref{stroke:var(--muted);stroke-dasharray:4 4}.goal{stroke:var(--goal);stroke-dasharray:2 4}.ax{fill:var(--muted);font-size:11px}.goalx{fill:var(--goal)}
footer{font-size:12px;color:var(--muted);margin:18px 0}
</style></head><body><main>
<h1>${esc(opts.title)}</h1>
<div class="muted">Mis à jour le ${esc(new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }))} (heure de Paris)</div>
<div class="banner"><b>PAPIER</b> — 500 $ fictifs, aucun levier, fenêtre 15 h – 19 h (Paris), tout soldé à 18 h 55. ${opts.mode === 'rejeu' ? '<b>Rejeu de séances passées</b> avec exactement les mêmes règles qu’en direct.' : 'Séances en direct, décisions minute par minute.'}</div>
<section class="kpis">
<div class="kpi"><div class="kl">Equity</div><div class="kv">${fr(eq)} $</div><div class="ks">départ ${fr(start)} $</div></div>
<div class="kpi"><div class="kl">Résultat total</div><div class="kv ${pnl >= 0 ? 'good' : 'bad'}">${sgn(pnl)} $</div><div class="ks">${sgn((pnl / start) * 100)} %</div></div>
<div class="kpi"><div class="kl">Semaine vs objectif +1 %</div><div class="kv ${weekPct >= 0 ? 'good' : 'bad'}">${sgn(weekPct)} %</div><div class="bar"><div style="width:${progress.toFixed(0)}%"></div></div></div>
<div class="kpi"><div class="kl">Trades</div><div class="kv">${trades.length}</div><div class="ks">${fr(avgPerDay, 1)} par séance · objectif ≥ ${cfg.minTradesPerDay}</div></div>
<div class="kpi"><div class="kl">Réussite</div><div class="kv">${trades.length ? fr((wins / trades.length) * 100, 0) : '—'} %</div><div class="ks">R moyen ${trades.length ? sgn(trades.reduce((s, t) => s + t.r, 0) / trades.length) : '—'}</div></div>
<div class="kpi"><div class="kl">Frais payés</div><div class="kv">${fr(fees)} $</div><div class="ks">drawdown max ${fr(mdd)} %</div></div>
</section>
<section class="card"><h2>Courbe d'equity</h2>${equityChart(trades, start)}</section>
${[...days].reverse().map(daySection).join('\n')}
<section class="card"><h2>Carnet complet (${trades.length} trades)</h2>
${trades.length ? `<div class="scroll"><table><tr><th>Date</th><th>Heure</th><th>Instrument</th><th>Sens</th><th>Stratégie</th><th>Taille</th><th>Prix</th><th>PnL</th><th>R</th><th>Sortie</th></tr>${tradeRows([...trades].reverse(), true)}</table></div>` : '<p class="muted">Aucun trade pour l’instant.</p>'}
<p class="muted">Export tableur : carnet.csv (même dossier).</p></section>
<section class="card"><h2>Méthode</h2><ul>
<li><b>ORB 5 min sur actions « en jeu »</b> — Zarattini, Barbon &amp; Aziz (2024) : les 8 actions au plus fort volume relatif d'ouverture (prix ≥ 5 $, volume moyen ≥ 1 M, ATR ≥ 0,50 $, listes Yahoo « plus actives » et « plus fortes hausses »), cassure du range des 5 premières minutes, stop sous ce range, seulement si le S&amp;P 500 est au-dessus de sa VWAP. Achat seulement (compte cash).</li>
<li><b>Momentum « zone de bruit »</b> — Zarattini, Aziz &amp; Barbon (2024) : on suit le prix quand il sort de sa zone d'oscillation habituelle à cette heure, au-dessus de la VWAP ; stop suiveur max(borne, VWAP). ETF SPY, QQQ, IWM et cryptos (achat).</li>
<li><b>Retour à la VWAP</b> en marché sans tendance : écart ≥ 2 écarts-types, objectif la VWAP, seulement si le gain attendu vaut au moins 3 fois les frais.</li>
<li><b>Risque</b> : ${cfg.baseRiskPct} % de l'equity par trade × poids adaptatif (0,25 à 2), une position ≤ ${cfg.maxPositionPct} % de l'equity, ${cfg.maxOpen} positions max, stop journalier −${cfg.dailyLossLimitPct} %, arrêt de la semaine à −${cfg.weeklyLossLimitPct} %. Moins de ${cfg.minTradesPerDay} trades à 17 h 30 : « mode chasse » (seuils assouplis, risque ÷ 2).</li>
<li><b>Coûts simulés par côté</b> : actions 0 commission + ${cfg.costs.stock.slipBps} bps de glissement ; forex ${cfg.costs.fx.slipBps} bp ; crypto ${cfg.costs.crypto.feeBps} bps de frais + ${cfg.costs.crypto.slipBps} bps. Entrées au prix de clôture de la minute du signal (pas d'ordre « parfait »), stop et objectif touchés dans la même minute = stop.</li>
<li><b>Données</b> : barres d'une minute Yahoo Finance (gratuites ; quelques secondes de retard possibles).</li>
</ul></section>
<footer>Simulation à but d'apprentissage. Rien ici n'est un conseil en investissement ; une semaine de résultats ne prouve rien statistiquement.</footer>
</main></body></html>
`;
  const path = join(dir, 'carnet.html');
  writeTextAtomic(path, html);
  return path;
}
