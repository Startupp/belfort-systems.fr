/**
 * Carnet de trades : carnet.html (page lisible sur téléphone, publiable telle quelle en page Claude)
 * et carnet.csv (tableur). Pour chaque séance : actions prises et pourquoi, analyses effectuées,
 * prévisions pour la suivante. resumeJour() donne le même résumé en texte, pour un message.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, readJsonl, writeTextAtomic } from '../lib/store.ts';
import { hhmm, paris } from './market.ts';
import { STRATEGY_LABEL } from './engine.ts';
import type { DaySummary } from './engine.ts';
import type { ClosedTrade, DeskConfig, DeskState, OpenTrade, StrategyId } from './types.ts';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c] ?? c);
const fr = (x: number, d = 2): string => (Number.isFinite(x) ? x.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const sgn = (x: number, d = 2): string => `${x > 0 ? '+' : ''}${fr(x, d)}`;
const time = (ms: number): string => hhmm(paris(ms).minutes);
const price = (x: number): string => (x >= 100 ? fr(x, 2) : x >= 1 ? fr(x, 4) : x.toPrecision(5));
const SIDE = { long: 'achat', short: 'vente' } as const;
const TITLE = { direct: 'Carnet de trades', rejeu: 'Rejeu du desk' } as const;

/** Un changement de réglage, noté dans reglages.json du dossier du carnet (le plus ancien en premier). */
export interface Reglage {
  date: string;
  avant: string;
  apres: string;
  pourquoi: string;
}

export function loadDays(dir: string): DaySummary[] {
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

/** Courbe d'equity après chaque trade, à l'échelle, avec le capital de départ et l'objectif +1 %. */
function equityChart(trades: ClosedTrade[], start: number): string {
  if (trades.length < 1) return '<p class="muted">La courbe apparaîtra après le premier trade.</p>';
  const pts = [start, ...trades.map((t) => t.equityAfter)];
  // Repère pensé pour un téléphone (≈ 340 px de large) : le texte y reste lisible ; plafonné sur grand écran.
  const W = 360;
  const H = 168;
  const L = 46;
  const R = 8;
  const T = 14;
  const B = 20;
  const target = start * 1.01;
  const lo = Math.min(...pts, start * 0.99);
  const hi = Math.max(...pts, target * 1.001);
  const x = (i: number): number => L + (i / (pts.length - 1 || 1)) * (W - L - R);
  const y = (v: number): number => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const base = y(lo).toFixed(1);
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${base} L${x(0).toFixed(1)},${base} Z`;
  const last = pts.at(-1) as number;
  const lx = x(pts.length - 1);
  const ly = y(last);
  // Étiquette de fin : au-dessus du point, sauf s'il touche le haut du dessin.
  const labelY = ly - 9 < T + 4 ? ly + 16 : ly - 9;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Equity après chaque trade : départ ${fr(start)} $, maintenant ${fr(last)} $">
<line x1="${L}" x2="${W - R}" y1="${y(start).toFixed(1)}" y2="${y(start).toFixed(1)}" class="ref"/>
<line x1="${L}" x2="${W - R}" y1="${y(target).toFixed(1)}" y2="${y(target).toFixed(1)}" class="goal"/>
<path d="${area}" class="area"/>
<path d="${line}" class="line"/>
<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4" class="dot"/>
<text x="${L - 6}" y="${y(start).toFixed(1)}" class="ax" text-anchor="end" dominant-baseline="middle">${fr(start, 0)} $</text>
<text x="${L - 6}" y="${y(target).toFixed(1)}" class="ax goalx" text-anchor="end" dominant-baseline="middle">${fr(target, 0)} $</text>
<text x="${W - R}" y="${(y(target) - 6).toFixed(1)}" class="ax goalx" text-anchor="end">objectif +1 %</text>
<text x="${(lx - 6).toFixed(1)}" y="${labelY.toFixed(1)}" class="ax end" text-anchor="end">${fr(last)} $</text>
<text x="${L}" y="${H - 5}" class="ax">départ</text><text x="${W - R}" y="${H - 5}" class="ax" text-anchor="end">trade ${trades.length}</text>
</svg>`;
}

/** Un trade clôturé avec ses raisons d'entrée et de sortie, lisibles sans clic. */
function tradeItem(t: ClosedTrade): string {
  const ok = t.pnlUsd > 0;
  return `<li class="trade ${ok ? 'win' : 'loss'}">
<div class="tl"><span class="num">${time(t.openedAt)} → ${time(t.closedAt)}</span><b class="sym">${esc(t.symbol)}</b><span class="chip">${esc(STRATEGY_LABEL[t.strategy])}</span><span>${SIDE[t.side]} ${fr(t.notionalUsd, 0)} $</span><span class="num muted">${price(t.entry)} → ${price(t.exit)}</span><span class="num pnl ${ok ? 'good' : 'bad'}">${sgn(t.pnlUsd)} $ · ${sgn(t.r)} R</span></div>
<p class="why"><span class="lab">Pourquoi</span>${t.reasons.map(esc).join(' · ')}</p>
<p class="why"><span class="lab">Sortie</span>${esc(t.exitReason)} · frais ${fr(t.costsUsd, 3)} $ · ${t.holdMinutes} min</p>
</li>`;
}

/** Valeur d'une position au prix donné (vente à découvert : mise + gain). */
const markValue = (o: OpenTrade, px: number): number => (o.side === 'long' ? o.qty * px : o.qty * o.entry + o.qty * (o.entry - px));

function openItem(o: OpenTrade, last?: number): string {
  let latent = '';
  if (last !== undefined) {
    const pnl = markValue(o, last) - o.qty * o.entry;
    latent = `<span class="num pnl ${pnl >= 0 ? 'good' : 'bad'}">${price(last)} · latent ${sgn(pnl)} $ (${sgn((pnl / o.notionalUsd) * 100)} %)</span>`;
  }
  return `<li class="trade open">
<div class="tl"><span class="num">depuis ${time(o.openedAt)}</span><b class="sym">${esc(o.symbol)}</b><span class="chip">${esc(STRATEGY_LABEL[o.strategy])}</span><span>${SIDE[o.side]} ${fr(o.notionalUsd, 0)} $</span><span class="num muted">entrée ${price(o.entry)} · stop ${price(o.stop)}</span>${latent}</div>
<p class="why"><span class="lab">Pourquoi</span>${o.reasons.map(esc).join(' · ')}</p>
</li>`;
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
    .map((k) => `<li>${esc(STRATEGY_LABEL[k])} : ${s.byStrategy[k].n} trade(s), <span class="num">${sgn(s.byStrategy[k].pnlUsd)} $</span> — poids ${fr(s.weightsStart[k])} → ${fr(s.weightsEnd[k])}</li>`)
    .join('');
  return `<section class="card day" id="seance-${esc(s.day)}">
<header class="dayhead"><h2>Séance du ${esc(s.day)}</h2><span class="num big ${s.pnlUsd >= 0 ? 'good' : 'bad'}">${sgn(s.pnlUsd)} $ (${sgn(s.pnlPct)} %)</span></header>
<p class="muted">${s.trades.length} trade(s) · réussite ${fr(s.winRatePct, 0)} % · R moyen ${sgn(s.avgR)} · equity <span class="num">${fr(s.equityStart)} → ${fr(s.equityEnd)} $</span></p>
<h3>Actions prises</h3>
${s.trades.length ? `<ul class="trades">${s.trades.map(tradeItem).join('')}</ul>` : '<p>Aucun trade : aucun setup ne passait les filtres, ou un garde-fou a bloqué.</p>'}
<ul class="plain">${strat}</ul>
<h3>Analyses effectuées</h3>
<ul class="plain">
<li>Actions « en jeu » à l'ouverture (volume relatif des 5 premières minutes) : ${a.stocksInPlay.length ? a.stocksInPlay.slice(0, 6).map((x) => `${esc(x.symbol)} ${fr(x.rv)}× ${x.bullish ? '↑' : '↓'}`).join(', ') : '—'}</li>
<li>Régimes de marché : ${regimes || '—'}</li>
<li>Signaux valides : ${a.signalsSeen}, pris : ${a.signalsTaken}${skipped ? ` ; écartés : ${skipped}` : ''}${a.huntAt ? ` ; mode chasse à ${esc(a.huntAt)}` : ''}${a.dailyStopAt ? ` ; stop journalier à ${esc(a.dailyStopAt)}` : ''}</li>
${notes ? `<li>Setups refusés les plus fréquents :<ul>${notes}</ul></li>` : ''}
</ul>
<h3>Prévisions pour la séance suivante</h3>
<ul class="plain">${s.forecast.outlook.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>
${s.forecast.watchlist.length ? `<p class="lab2">À surveiller</p><ul class="plain">${s.forecast.watchlist.map((w) => `<li><b>${esc(w.symbol)}</b> — ${esc(w.why)}</li>`).join('')}</ul>` : ''}
</section>`;
}

/** Résumé d'une séance en texte (message à l'utilisateur) : actions, analyses, prévisions. */
export function resumeJour(s: DaySummary): string {
  const a = s.analysis;
  const lines: string[] = [];
  lines.push(`Séance du ${s.day} : ${sgn(s.pnlUsd)} $ (${sgn(s.pnlPct)} %) · ${s.trades.length} trade(s) · réussite ${fr(s.winRatePct, 0)} % · equity ${fr(s.equityEnd)} $`);
  const w = s.forecast.week;
  lines.push(
    w.tradingDaysLeft > 0
      ? `Semaine : ${sgn(w.pnlPct)} % pour un objectif de +${fr(w.targetPct, 0)} % ; il faut ${fr(w.neededPerDayPct)} % par séance sur les ${w.tradingDaysLeft} restantes.`
      : `Semaine terminée à ${sgn(w.pnlPct)} % (objectif +${fr(w.targetPct, 0)} %).`,
  );
  lines.push('', 'Actions prises :');
  if (!s.trades.length) lines.push('- aucun trade (aucun setup ne passait les filtres, ou un garde-fou a bloqué)');
  for (const t of s.trades) {
    lines.push(
      `- ${time(t.openedAt)} → ${time(t.closedAt)} ${t.symbol} ${SIDE[t.side]} ${fr(t.notionalUsd, 0)} $ (${STRATEGY_LABEL[t.strategy]}) : ${sgn(t.pnlUsd)} $, ${sgn(t.r)} R. ` +
        `Pourquoi : ${t.reasons.join(' ; ')}. Sortie : ${t.exitReason}.`,
    );
  }
  lines.push('', 'Analyses effectuées :');
  if (a.stocksInPlay.length) lines.push(`- en jeu à l'ouverture : ${a.stocksInPlay.slice(0, 6).map((x) => `${x.symbol} ${fr(x.rv)}×${x.bullish ? '↑' : '↓'}`).join(', ')}`);
  const lastRegime = a.regimes.at(-1);
  if (lastRegime) {
    const tr = lastRegime.items.filter((i) => i.regime === 'tendance').length;
    const rg = lastRegime.items.filter((i) => i.regime === 'range').length;
    lines.push(`- régimes à ${lastRegime.time} : ${tr} en tendance, ${rg} en range, ${lastRegime.items.length - tr - rg} mixtes`);
  }
  lines.push(`- signaux valides ${a.signalsSeen}, pris ${a.signalsTaken}${a.huntAt ? `, mode chasse à ${a.huntAt}` : ''}${a.dailyStopAt ? `, stop journalier à ${a.dailyStopAt}` : ''}`);
  for (const [k, v] of Object.entries(a.skipped)) lines.push(`- écarté ${v}× : ${k}`);
  const topNotes = Object.entries(a.notes).sort((x, y) => y[1] - x[1]).slice(0, 3);
  for (const [k, v] of topNotes) lines.push(`- refusé ${v}× : ${k.replace(/#/g, '…')}`);
  lines.push('', 'Prévisions :');
  for (const o of s.forecast.outlook) lines.push(`- ${o}`);
  for (const x of s.forecast.watchlist) lines.push(`- à surveiller : ${x.symbol} — ${x.why}`);
  return lines.join('\n');
}

export interface CarnetOptions {
  mode: 'direct' | 'rejeu';
  title?: string;
  /** Aperçu en direct : derniers prix connus des positions ouvertes (gain latent, equity en direct). */
  prices?: Record<string, number>;
}

/** Écrit carnet.csv et carnet.html ; renvoie le chemin de la page. */
export function writeCarnet(dir: string, cfg: DeskConfig, opts: CarnetOptions): string {
  writeTextAtomic(join(dir, 'carnet.csv'), carnetCsv(readJsonl<ClosedTrade>(join(dir, 'trades.jsonl'))));
  const path = join(dir, 'carnet.html');
  writeTextAtomic(path, renderCarnet(dir, cfg, opts));
  return path;
}

/** La page du carnet (fragment HTML : la page Claude ou l'aperçu ajoutent le squelette). */
export function renderCarnet(dir: string, cfg: DeskConfig, opts: CarnetOptions): string {
  const trades = readJsonl<ClosedTrade>(join(dir, 'trades.jsonl'));
  const days = loadDays(dir);
  const state = readJson<DeskState | null>(join(dir, 'state.json'), null);
  const reglages = readJson<Reglage[]>(join(dir, 'reglages.json'), []);
  const name = opts.title ?? TITLE[opts.mode];
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
  // Séance en cours (pas encore de résumé du jour) : positions ouvertes et trades déjà clôturés.
  const closedDays = new Set(days.map((d) => d.day));
  const liveDay = state?.day && !closedDays.has(state.day) ? state.day : '';
  const liveTrades = liveDay ? trades.filter((t) => paris(t.openedAt).date === liveDay) : [];
  const prices = opts.prices ?? {};
  const liveEq = state ? state.cash + state.open.reduce((sum, o) => sum + markValue(o, prices[o.symbol] ?? o.entry), 0) : start;
  const liveCard = liveDay
    ? `<section class="card day live"><header class="dayhead"><h2>Séance du ${esc(liveDay)} en cours</h2><span class="pill">en direct</span></header>
${opts.prices ? `<p>Equity en direct : <b class="num">${fr(liveEq)} $</b> <span class="num ${liveEq >= (state?.dayStartEquity ?? start) ? 'good' : 'bad'}">(${sgn(liveEq - (state?.dayStartEquity ?? start))} $ depuis 15 h)</span></p>` : ''}
${state?.open.length ? `<h3>Positions ouvertes</h3><ul class="trades">${state.open.map((o) => openItem(o, prices[o.symbol])).join('')}</ul>` : '<p class="muted">Aucune position ouverte.</p>'}
${liveTrades.length ? `<h3>Déjà clôturés aujourd'hui</h3><ul class="trades">${liveTrades.map(tradeItem).join('')}</ul>` : ''}
<p class="muted">Le résumé complet (analyses et prévisions) arrive à la clôture de 19 h.</p></section>`
    : '';
  const html = `<meta charset="utf-8">
<title>${esc(name)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@600&family=IBM+Plex+Sans:wght@400;600&display=swap">
<style>
/* Journal de desk : bandeau de chiffres, courbe, puis une fiche par séance (la plus récente en haut), carnet complet, méthode. */
:root{
  --bg:#f2f4f7;--surface:#ffffff;--ink:#121821;--muted:#5b6876;--rule:#dce2e9;
  --accent:#2c52cf;--accent-soft:rgba(44,82,207,.12);--gain:#0a7a4e;--loss:#b3242f;--goal:#985a00;
  --display:"IBM Plex Sans Condensed","Arial Narrow",system-ui,sans-serif;
  --body:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --data:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#0d1116;--surface:#151b23;--ink:#e4e9ef;--muted:#93a1b0;--rule:#27303b;
  --accent:#8aa2ff;--accent-soft:rgba(138,162,255,.16);--gain:#3fcf8e;--loss:#ff7b80;--goal:#f0b23c;color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#0d1116;--surface:#151b23;--ink:#e4e9ef;--muted:#93a1b0;--rule:#27303b;
  --accent:#8aa2ff;--accent-soft:rgba(138,162,255,.16);--gain:#3fcf8e;--loss:#ff7b80;--goal:#f0b23c;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 var(--body)}
main{max-width:1040px;margin:0 auto;padding-block:20px 28px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:grid;gap:14px}
main>*{min-width:0}
h1,h2{font-family:var(--display);font-weight:600;text-wrap:balance;margin:0}
h1{font-size:26px;letter-spacing:.2px}h2{font-size:19px}h3{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:16px 0 8px}
p{margin:0}.muted{color:var(--muted)}.good{color:var(--gain)}.bad{color:var(--loss)}
.num{font-family:var(--data);font-variant-numeric:tabular-nums}
.top{display:grid;gap:6px}
.banner{border-left:3px solid var(--accent);background:var(--accent-soft);padding:10px 12px;border-radius:0 8px 8px 0}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule);border-radius:10px;overflow:hidden}
.kpi{background:var(--surface);padding:12px;display:grid;gap:2px;align-content:start}
.kl{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.kv{font-family:var(--data);font-variant-numeric:tabular-nums;font-size:21px;font-weight:500}
.ks{font-size:12px;color:var(--muted)}
.bar{height:6px;border-radius:3px;background:var(--rule);overflow:hidden;margin-top:6px}.bar>div{height:100%;background:var(--gain)}
.card{background:var(--surface);border:1px solid var(--rule);border-radius:10px;padding:16px}
.dayhead{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px;margin-bottom:4px}
.big{font-size:17px;font-weight:500}
.pill{font-size:12px;border:1px solid var(--accent);color:var(--accent);border-radius:999px;padding:1px 9px}
ul.plain{margin:0;padding-left:18px;display:grid;gap:4px}ul.plain ul{margin-top:4px;padding-left:18px}
.lab2{font-weight:600;margin:10px 0 4px}
ul.trades{list-style:none;margin:0 0 10px;padding:0;display:grid;gap:8px}
.trade{border:1px solid var(--rule);border-left:3px solid var(--muted);border-radius:6px;padding:8px 10px;display:grid;gap:4px;min-width:0}
.trade.win{border-left-color:var(--gain)}.trade.loss{border-left-color:var(--loss)}.trade.open{border-left-color:var(--accent)}
.tl{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline}
.sym{font-family:var(--data);font-size:15px}
.chip{font-size:12px;background:var(--accent-soft);color:var(--accent);border-radius:4px;padding:0 6px}
.pnl{margin-left:auto;font-weight:500}
.why{font-size:13px;color:var(--muted);overflow-wrap:anywhere}
.lab{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink);margin-right:8px}
svg{width:100%;max-width:620px;height:auto;display:block}
.line{fill:none;stroke:var(--accent);stroke-width:2}.area{fill:var(--accent-soft);stroke:none}.dot{fill:var(--accent);stroke:var(--surface);stroke-width:2}
.ref{stroke:var(--muted);stroke-dasharray:4 4;fill:none}.goal{stroke:var(--goal);stroke-dasharray:2 4;fill:none}
.ax{fill:var(--muted);font:10.5px var(--data)}.goalx{fill:var(--goal)}.end{fill:var(--ink)}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--rule);vertical-align:top;white-space:nowrap}
th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600}
td.wrap{white-space:normal;min-width:220px}
tr.win td:first-child{box-shadow:inset 3px 0 var(--gain)}tr.loss td:first-child{box-shadow:inset 3px 0 var(--loss)}
footer{font-size:12px;color:var(--muted)}
</style>
<main>
<header class="top">
<h1>${esc(name)}</h1>
<p class="muted">Mis à jour le ${esc(new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' }))} (heure de Paris)</p>
<p class="banner"><b>Papier</b> : ${fr(start, 0)} $ fictifs, aucun levier, fenêtre 15 h – 19 h (Paris), tout est soldé à 18 h 55. ${opts.mode === 'rejeu' ? 'Rejeu de séances passées avec exactement les mêmes règles qu’en direct.' : 'Séances en direct, décisions minute par minute.'}</p>
</header>
<section class="kpis" aria-label="Chiffres clés">
<div class="kpi"><span class="kl">Equity</span><span class="kv">${fr(eq)} $</span><span class="ks">départ ${fr(start)} $</span></div>
<div class="kpi"><span class="kl">Résultat total</span><span class="kv ${pnl >= 0 ? 'good' : 'bad'}">${sgn(pnl)} $</span><span class="ks">${sgn((pnl / start) * 100)} %</span></div>
<div class="kpi"><span class="kl">Semaine / objectif +1 %</span><span class="kv ${weekPct >= 0 ? 'good' : 'bad'}">${sgn(weekPct)} %</span><div class="bar"><div style="width:${progress.toFixed(0)}%"></div></div></div>
<div class="kpi"><span class="kl">Trades</span><span class="kv">${trades.length}</span><span class="ks">${fr(avgPerDay, 1)} par séance · objectif ≥ ${cfg.minTradesPerDay}</span></div>
<div class="kpi"><span class="kl">Réussite</span><span class="kv">${trades.length ? fr((wins / trades.length) * 100, 0) : '—'} %</span><span class="ks">R moyen ${trades.length ? sgn(trades.reduce((s, t) => s + t.r, 0) / trades.length) : '—'}</span></div>
<div class="kpi"><span class="kl">Commissions</span><span class="kv">${fr(fees)} $</span><span class="ks">glissement inclus dans les prix · baisse max ${fr(mdd)} %</span></div>
</section>
<section class="card"><h2>Courbe d'equity</h2>${equityChart(trades, start)}</section>
${liveCard}
${[...days].reverse().map(daySection).join('\n')}
<section class="card"><h2>Carnet complet (${trades.length} trades)</h2>
${trades.length ? `<div class="scroll"><table><thead><tr><th>Date</th><th>Heure</th><th>Instrument</th><th>Sens</th><th>Stratégie</th><th>Taille</th><th>Prix</th><th>PnL</th><th>R</th><th>Sortie</th></tr></thead><tbody>${[...trades]
      .reverse()
      .map(
        (t) => `<tr class="${t.pnlUsd > 0 ? 'win' : 'loss'}"><td>${esc(paris(t.openedAt).date.slice(5))}</td><td>${time(t.openedAt)} → ${time(t.closedAt)}</td><td><b>${esc(t.symbol)}</b></td><td>${SIDE[t.side]}</td><td>${esc(STRATEGY_LABEL[t.strategy])}</td><td>${fr(t.notionalUsd, 0)} $</td><td>${price(t.entry)} → ${price(t.exit)}</td><td class="${t.pnlUsd > 0 ? 'good' : 'bad'}">${sgn(t.pnlUsd)} $</td><td>${sgn(t.r)}</td><td class="wrap">${esc(t.exitReason)}</td></tr>`,
      )
      .join('')}</tbody></table></div>` : '<p class="muted">Aucun trade pour l’instant.</p>'}
<p class="muted">Export tableur : carnet.csv, dans le même dossier du dépôt.</p></section>
${reglages.length ? `<section class="card"><h2>Réglages modifiés</h2><ul class="plain">${[...reglages]
      .reverse()
      .map((r) => `<li><b>${esc(r.date)}</b> : ${esc(r.avant)} → <b>${esc(r.apres)}</b>.<br><span class="muted">${esc(r.pourquoi)}</span></li>`)
      .join('')}</ul></section>` : ''}
<section class="card"><h2>Méthode</h2><ul class="plain">
<li><b>ORB 5 min sur actions « en jeu »</b>, d'après Zarattini, Barbon &amp; Aziz (2024) : les ${cfg.inPlayTop} actions au plus fort volume relatif d'ouverture (prix ≥ 5 $, volume moyen ≥ 1 M, ATR ≥ 0,50 $, listes Yahoo « plus actives » et « plus fortes hausses »), cassure du range des 5 premières minutes, stop sous ce range, seulement si le S&amp;P 500 est au-dessus de sa VWAP. Achat seulement (compte cash).</li>
<li><b>Momentum « zone de bruit »</b>, d'après Zarattini, Aziz &amp; Barbon (2024) : on suit le prix quand il sort de sa zone d'oscillation habituelle à cette heure, au-dessus de la VWAP ; stop suiveur max(borne, VWAP). ETF SPY, QQQ, IWM et cryptos (achat).</li>
<li><b>Retour à la VWAP</b> en marché sans tendance : écart ≥ 2 écarts-types, objectif la VWAP, seulement si le gain attendu vaut au moins 3 fois les frais.</li>
<li><b>Risque</b> : ${cfg.baseRiskPct} % de l'equity par trade × poids adaptatif (0,25 à 2), une position ≤ ${cfg.maxPositionPct} % de l'equity, ${cfg.maxOpen} positions max dont ${cfg.maxOrbOpen} au plus pour l'ORB, stop journalier −${cfg.dailyLossLimitPct} %, arrêt de la semaine à −${cfg.weeklyLossLimitPct} %. Moins de ${cfg.minTradesPerDay} trades à 17 h 30 : « mode chasse » (seuils assouplis, risque ÷ 2).</li>
<li><b>Coûts simulés par ordre</b> : actions 0 commission + ${cfg.costs.stock.slipBps} points de base de glissement ; crypto ${cfg.costs.crypto.feeBps} points de base de frais + ${cfg.costs.crypto.slipBps} de glissement. Entrée au prix de clôture de la minute du signal ; si le stop et l'objectif sont touchés dans la même minute, c'est le stop qui compte.</li>
<li><b>Données</b> : barres d'une minute Yahoo Finance (gratuites ; quelques secondes de retard possibles).</li>
</ul></section>
<footer>Simulation à but d'apprentissage. Rien ici n'est un conseil en investissement, et une semaine de résultats ne prouve rien statistiquement.</footer>
</main>
`;
  return html;
}
