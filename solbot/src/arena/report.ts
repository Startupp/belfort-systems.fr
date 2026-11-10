/**
 * Page de l'arène (arene.html) : classement des portefeuilles parallèles, suivi en direct, rejeux, fiches des règles,
 * méthode. Fragment sans squelette HTML (la page Claude l'ajoute), thèmes clair et sombre, lisible sur téléphone.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, readJsonl, writeTextAtomic } from '../lib/store.ts';
import { paris } from '../desk/market.ts';
import type { ArenaFile, RunSummary } from './main.ts';
import { COMPOSITES, PORTFOLIOS } from './portfolios.ts';
import type { ArenaPortfolio } from './portfolios.ts';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c] ?? c);
const fr = (x: number, d = 2): string => (Number.isFinite(x) ? x.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const sgn = (x: number, d = 2): string => `${x > 0 ? '+' : ''}${fr(x, d)}`;
const dateFr = (ms: number): string => new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long' });
type Meta = { name: string; market: string; leverageLabel: string; role: ArenaPortfolio['role'] | 'combiné' };
const byId = new Map<string, Meta>([...PORTFOLIOS.map((p): [string, Meta] => [p.id, p]), ...COMPOSITES.map((c): [string, Meta] => [c.id, c])]);
const ROLE: Record<Meta['role'], string> = { publiée: 'étude publiée', 'pratique courante': 'pratique courante', témoin: 'témoin', référence: 'référence', combiné: 'portefeuille combiné' };
const chipClass = (role: Meta['role']): string => (role === 'témoin' ? 'ctl' : role === 'combiné' ? 'mix' : '');

function spark(daily: Array<[string, number]>, capital: number): string {
  const pts = [capital, ...daily.map((d) => d[1])];
  if (pts.length < 2) return '';
  const W = 120;
  const H = 30;
  const lo = Math.min(...pts, capital);
  const hi = Math.max(...pts, capital);
  const span = hi - lo || 1;
  const x = (i: number): number => (i / (pts.length - 1)) * W;
  const y = (v: number): number => H - 2 - ((v - lo) / span) * (H - 4);
  const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const end = pts.at(-1) as number;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="courbe d'equity"><line class="base" x1="0" x2="${W}" y1="${y(capital).toFixed(1)}" y2="${y(capital).toFixed(1)}"/><polyline class="${end >= capital ? 'up' : 'down'}" points="${line}"/></svg>`;
}

function board(runs: RunSummary[], opts: { sparkline: boolean }): string {
  const rows = [...runs].sort((a, b) => b.stats.returnPct - a.stats.returnPct);
  const body = rows
    .map((r, i) => {
      const p = byId.get(r.id);
      const s = r.stats;
      const liq = r.liquidatedAt !== undefined;
      return `<tr class="${s.returnPct > 0 ? 'win' : 'loss'}">
<td class="num">${i + 1}</td>
<td class="wrap"><b>${esc(p?.name ?? r.id)}</b>${p ? ` <span class="chip ${chipClass(p.role)}">${esc(ROLE[p.role])}</span>` : ''}<br><span class="muted">${esc(p?.market ?? '')} · ${esc(p?.leverageLabel ?? '')} · ${fr(r.capital, 0)} $</span></td>
<td class="num ${s.returnPct >= 0 ? 'good' : 'bad'}"><b>${sgn(s.returnPct)} %</b><br><span class="muted">${fr(r.equity)} $</span>${liq ? '<br><span class="badge">compte liquidé</span>' : ''}</td>
<td class="num">${fr(s.maxDrawdownPct)} %</td>
<td class="num">${s.trades}</td>
<td class="num">${s.trades ? `${fr(s.winRatePct, 0)} %` : '—'}</td>
<td class="num">${s.days ? `${sgn(s.worstDayPct)} %` : '—'}</td>
${opts.sparkline ? `<td>${spark(r.daily, r.capital)}</td>` : ''}
</tr>`;
    })
    .join('');
  return `<div class="scroll"><table class="board"><thead><tr><th>#</th><th>Portefeuille</th><th>Résultat</th><th>Baisse max</th><th>Trades</th><th>Réussite</th><th>Pire jour</th>${opts.sparkline ? '<th>Courbe</th>' : ''}</tr></thead><tbody>${body}</tbody></table></div>`;
}

interface DeskLike {
  label: string;
  dir: string;
}

/** Les deux portefeuilles du desk qui tournent en direct (ORB 15 h – 19 h, crypto). */
function deskRows(root: string): string {
  const desks: DeskLike[] = [
    { label: 'Desk ORB + momentum + VWAP (15 h – 19 h), ma stratégie de la semaine', dir: join(root, 'carnet') },
    { label: 'Portefeuille crypto du desk (15 h – 19 h)', dir: join(root, 'carnet-crypto') },
  ];
  const rows = desks
    .filter((d) => existsSync(join(d.dir, 'state.json')))
    .map((d) => {
      const st = readJson<{ startEquity?: number; cash?: number; open?: unknown[] } | null>(join(d.dir, 'state.json'), null);
      const trades = readJsonl<{ pnlUsd: number; equityAfter: number; openedAt: number }>(join(d.dir, 'trades.jsonl'));
      const start = st?.startEquity ?? 500;
      const eq = trades.at(-1)?.equityAfter ?? start;
      const since = trades[0] ? dateFr(trades[0].openedAt) : '—';
      return `<tr class="${eq >= start ? 'win' : 'loss'}"><td class="wrap"><b>${esc(d.label)}</b><br><span class="muted">sans levier · ${fr(start, 0)} $ · depuis le ${esc(since)}</span></td><td class="num ${eq >= start ? 'good' : 'bad'}"><b>${sgn(((eq - start) / start) * 100)} %</b><br><span class="muted">${fr(eq)} $</span></td><td class="num">${trades.length}</td><td class="num">${trades.length ? `${fr((trades.filter((t) => t.pnlUsd > 0).length / trades.length) * 100, 0)} %` : '—'}</td><td class="num">${st?.open?.length ?? 0}</td></tr>`;
    })
    .join('');
  if (!rows) return '';
  return `<section class="card"><h2>Portefeuilles du desk, en direct</h2><p class="muted">Ils tournent minute par minute pendant la fenêtre ; leur carnet détaillé est sur la page « Carnet de trades ».</p><div class="scroll"><table class="board"><thead><tr><th>Portefeuille</th><th>Résultat</th><th>Trades</th><th>Réussite</th><th>Ouvertes</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function fiche(p: ArenaPortfolio, run: RunSummary | undefined): string {
  const c = p.costs;
  const costs = [
    c.feeBps ? `commission ${fr(c.feeBps / 100, 2)} % par ordre au marché` : 'sans commission',
    c.makerFeeBps !== undefined ? `${fr(c.makerFeeBps / 100, 2)} % en ordre limite` : '',
    `glissement ${fr(c.slipBps, 1)} pb par côté`,
    c.financingPct ? `financement de nuit ${fr(c.financingPct, 1)} %/an` : '',
    c.qtyStep ? `lot minimal ${c.qtyStep} once` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const last = (run?.trades ?? []).slice(-4).reverse();
  return `<details class="fiche"><summary><b>${esc(p.name)}</b> <span class="chip ${chipClass(p.role)}">${esc(ROLE[p.role])}</span> <span class="muted">${esc(p.market)} · ${esc(p.leverageLabel)}</span></summary>
<p>${esc(p.rules)}</p>
<p class="muted"><b>Source</b> : ${esc(p.source)}</p>
<p class="muted"><b>Coûts</b> : ${esc(costs)}</p>
${last.length ? `<ul class="plain">${last.map((t) => `<li><span class="num">${esc(paris(t.openedAt).date.slice(5))}</span> ${esc(t.symbol)} ${t.side === 'long' ? 'achat' : 'vente'} ${fr(t.notional, 0)} $ → <span class="num ${t.pnl > 0 ? 'good' : 'bad'}">${sgn(t.pnl)} $</span> <span class="muted">(${esc(t.exitReason)})</span></li>`).join('')}</ul>` : ''}
</details>`;
}


/** Carte d'un portefeuille combiné : règles, poches, fourchette d'un mois. */
function comboCard(c: (typeof COMPOSITES)[number], run: RunSummary | undefined, longRun: RunSummary | undefined): string {
  const e = run?.espoir;
  const parts = run?.parts ?? [];
  const pct = (x: number): string => `${sgn(x)} %`;
  return `<section class="card combo"><h2>${esc(c.name)}</h2>
<p>${esc(c.rules)}</p>
<p class="muted">${esc(c.source)}. Les poches sont indépendantes ; ce qu'une poche gagne ou perd reste dans la poche.</p>
${run ? `<p><b>Rejeu sur la période commune</b> : <span class="num ${run.stats.returnPct >= 0 ? 'good' : 'bad'}">${pct(run.stats.returnPct)}</span> (${fr(run.equity)} $), baisse maximale ${fr(run.stats.maxDrawdownPct)} %, pire jour ${pct(run.stats.worstDayPct)}${longRun ? ` ; depuis le ${esc(dateFr(longRun.from))} : <span class="num ${longRun.stats.returnPct >= 0 ? 'good' : 'bad'}">${pct(longRun.stats.returnPct)}</span>, baisse maximale ${fr(longRun.stats.maxDrawdownPct)} %` : ''}.</p>` : ''}
${parts.length ? `<div class="scroll"><table><thead><tr><th>Poche</th><th>Capital</th><th>Résultat</th><th>Baisse max</th><th>Trades</th></tr></thead><tbody>${parts.map((p) => `<tr class="${p.returnPct > 0 ? 'win' : 'loss'}"><td>${esc(p.label)}</td><td class="num">${fr(p.capital, 0)} $</td><td class="num ${p.returnPct >= 0 ? 'good' : 'bad'}">${pct(p.returnPct)}</td><td class="num">${fr(p.maxDrawdownPct)} %</td><td class="num">${p.trades}</td></tr>`).join('')}</tbody></table></div>` : ''}
${e ? `<p><b>Ce qu'on peut espérer sur un mois</b> (tirages de mois fictifs dans les ${e.days} journées depuis le ${esc(dateFr(e.from))} ; fourchette, pas promesse) :</p>
<div class="range"><div><span class="kl">Mauvais mois (1 sur 10)</span><span class="kv num ${e.p10 >= 0 ? 'good' : 'bad'}">${pct(e.p10)}</span></div><div><span class="kl">Mois médian</span><span class="kv num ${e.p50 >= 0 ? 'good' : 'bad'}">${pct(e.p50)}</span></div><div><span class="kl">Bon mois (1 sur 10)</span><span class="kv num good">${pct(e.p90)}</span></div><div><span class="kl">Mois négatifs</span><span class="kv num">${fr(e.negative, 0)} %</span></div></div>` : ''}
</section>`;
}

export function renderArena(dir: string): string {
  const rejeu = readJson<ArenaFile | null>(join(dir, 'rejeu.json'), null);
  const suivi = readJson<ArenaFile | null>(join(dir, 'suivi.json'), null);
  const lecture = readJson<string[]>(join(dir, 'lecture.json'), []);
  const commun = rejeu?.windows.commun;
  const long = rejeu?.windows.long;
  const live = suivi?.windows.suivi;
  const liveStarted = live && live.runs.some((r) => r.daily.length > 0);
  const best = commun ? [...commun.runs].sort((a, b) => b.stats.returnPct - a.stats.returnPct)[0] : undefined;
  const witness = commun?.runs.find((r) => r.id === 'hasard-spy');
  const kpi = (label: string, value: string, sub: string, cls = ''): string => `<div class="kpi"><span class="kl">${esc(label)}</span><span class="kv ${cls}">${value}</span><span class="ks">${sub}</span></div>`;
  const updated = Math.max(rejeu?.generatedAt ?? 0, suivi?.generatedAt ?? 0) || Date.now();
  return `<meta charset="utf-8">
<title>Arène des stratégies</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@600&family=IBM+Plex+Sans:wght@400;600&display=swap">
<style>
/* Arène : un tableau de classement par fenêtre de test, puis les fiches des règles. Même identité que le carnet du desk. */
:root{
  --bg:#f2f4f7;--surface:#ffffff;--ink:#121821;--muted:#5b6876;--rule:#dce2e9;
  --accent:#2c52cf;--accent-soft:rgba(44,82,207,.12);--gain:#0a7a4e;--loss:#b3242f;--goal:#985a00;--ctl:#6b4fa3;--ctl-soft:rgba(107,79,163,.12);--gold-soft:rgba(152,90,0,.12);
  --display:"IBM Plex Sans Condensed","Arial Narrow",system-ui,sans-serif;
  --body:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --data:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#0d1116;--surface:#151b23;--ink:#e4e9ef;--muted:#93a1b0;--rule:#27303b;
  --accent:#8aa2ff;--accent-soft:rgba(138,162,255,.16);--gain:#3fcf8e;--loss:#ff7b80;--goal:#f0b23c;--ctl:#c4a8ff;--ctl-soft:rgba(196,168,255,.14);--gold-soft:rgba(240,178,60,.14);color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#0d1116;--surface:#151b23;--ink:#e4e9ef;--muted:#93a1b0;--rule:#27303b;
  --accent:#8aa2ff;--accent-soft:rgba(138,162,255,.16);--gain:#3fcf8e;--loss:#ff7b80;--goal:#f0b23c;--ctl:#c4a8ff;--ctl-soft:rgba(196,168,255,.14);--gold-soft:rgba(240,178,60,.14);color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 var(--body)}
main{max-width:1040px;margin:0 auto;padding-block:20px 28px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:grid;gap:14px}
main>*{min-width:0}
h1,h2{font-family:var(--display);font-weight:600;text-wrap:balance;margin:0}
h1{font-size:26px;letter-spacing:.2px}h2{font-size:19px;margin-bottom:6px}
p{margin:0}.muted{color:var(--muted)}.good{color:var(--gain)}.bad{color:var(--loss)}
.num{font-family:var(--data);font-variant-numeric:tabular-nums}
.top{display:grid;gap:6px}
.banner{border-left:3px solid var(--accent);background:var(--accent-soft);padding:10px 12px;border-radius:0 8px 8px 0}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule);border-radius:10px;overflow:hidden}
.kpi{background:var(--surface);padding:12px;display:grid;gap:2px;align-content:start}
.kl{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.kv{font-family:var(--data);font-variant-numeric:tabular-nums;font-size:20px;font-weight:500}
.ks{font-size:12px;color:var(--muted)}
.card{background:var(--surface);border:1px solid var(--rule);border-radius:10px;padding:16px;display:grid;gap:8px}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--rule);vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600;white-space:nowrap}
td.num{white-space:nowrap}
td.wrap{min-width:220px}
tr.win td:first-child{box-shadow:inset 3px 0 var(--gain)}tr.loss td:first-child{box-shadow:inset 3px 0 var(--loss)}
.chip{font-size:11px;background:var(--accent-soft);color:var(--accent);border-radius:4px;padding:0 6px;white-space:nowrap}
.chip.ctl{background:var(--ctl-soft);color:var(--ctl)}.chip.mix{background:var(--gold-soft);color:var(--goal)}
.combo{border-left:3px solid var(--goal)}
.range{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
.range div{background:var(--bg);border-radius:8px;padding:8px 10px;display:grid;gap:2px}
.badge{font-size:11px;border:1px solid var(--loss);color:var(--loss);border-radius:999px;padding:0 7px;white-space:nowrap}
.spark{width:120px;height:30px;display:block}
.spark .base{stroke:var(--rule);stroke-width:1}
.spark polyline{fill:none;stroke-width:1.6}.spark .up{stroke:var(--gain)}.spark .down{stroke:var(--loss)}
ul.plain{margin:0;padding-left:18px;display:grid;gap:4px}
details.fiche{border-top:1px solid var(--rule);padding:10px 0;display:grid;gap:6px}
details.fiche summary{cursor:pointer;list-style-position:outside}
details.fiche p{margin-top:6px;font-size:14px}
.note{font-size:14px}
footer{font-size:12px;color:var(--muted)}
</style>
<main>
<header class="top">
<h1>Arène des stratégies</h1>
<p class="muted">Mis à jour le ${esc(new Date(updated).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' }))} (heure de Paris) · code des stratégies : ${esc(suivi?.commit ?? rejeu?.commit ?? '?')}</p>
<p class="banner"><b>Papier</b> : ${PORTFOLIOS.length} portefeuilles fictifs en parallèle, une stratégie chacun, 500 $ de départ (1 500 $ ou 2 500 $ pour deux versions réalistes, quand le plus petit ordre possible l’exige). Avec ou sans levier selon le portefeuille, aux plafonds autorisés aux particuliers en Europe, sauf le témoin « façon Telegram ». Aucun ordre réel, aucune clé.</p>
</header>
${commun ? `<section class="kpis" aria-label="Chiffres clés">
${best ? kpi('Meilleur sur la période commune', `${sgn(best.stats.returnPct)} %`, esc(byId.get(best.id)?.name ?? best.id), best.stats.returnPct >= 0 ? 'good' : 'bad') : ''}
${witness ? kpi('Témoin au hasard (SPY)', `${sgn(witness.stats.returnPct)} %`, 'à battre pour prouver quelque chose', witness.stats.returnPct >= 0 ? 'good' : 'bad') : ''}
${kpi('Portefeuilles gagnants', `${commun.runs.filter((r) => r.stats.returnPct > 0).length} / ${commun.runs.length}`, esc(commun.label.replace(/^Rejeu sur la même période pour tous \((.*)\)$/, '$1')))}
</section>` : ''}
${COMPOSITES.map((c) => comboCard(c, commun?.runs.find((r) => r.id === c.id), long?.runs.find((r) => r.id === c.id))).join('')}
${lecture.length ? `<section class="card"><h2>Ma lecture</h2><ul class="plain note">${lecture.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>` : ''}
<section class="card"><h2>Suivi en direct</h2>
${liveStarted && live ? `<p class="muted">${esc(live.label)} : tout est rejoué chaque jour depuis le départ avec les mêmes règles ; seules les nouvelles barres changent le résultat.</p>${board(live.runs, { sparkline: true })}` : '<p>Le suivi démarre le <b>mercredi 11 novembre à 0 h</b> (Paris) : à partir de là, chaque portefeuille avance sur les cours réels, sans retouche des règles. D’ici là, seul le rejeu ci-dessous donne une indication.</p>'}
</section>
${deskRows(join(dir, '..'))}
${commun ? `<section class="card"><h2>${esc(commun.label)}</h2><p class="muted">Mêmes données, mêmes coûts, mêmes règles d’exécution prudentes pour tous. Quelques semaines ne prouvent rien : c’est une première indication.</p>${board(commun.runs, { sparkline: true })}</section>` : ''}
${long && long.runs.length ? `<section class="card"><h2>${esc(long.label)}</h2><p class="muted">Chaque portefeuille sur toute la durée de ses données : stratégies journalières depuis 2010, crypto sur 1 à 2 ans, stratégies de 5 min sur ~7 semaines. Périodes différentes : à comparer avec prudence.</p>${board(long.runs, { sparkline: false })}</section>` : ''}
<section class="card"><h2>Fiches des stratégies</h2>${PORTFOLIOS.map((p) => fiche(p, commun?.runs.find((r) => r.id === p.id))).join('')}</section>
<section class="card"><h2>Méthode et limites</h2><ul class="plain note">
<li><b>Exécution prudente</b> : ordres au marché à la clôture de la barre du signal (ou à l’ouverture suivante), stops au prix du stop ou à l’ouverture si le cours a sauté par-dessus, ordres limites seulement si le cours passe au travers ; stop et objectif dans la même barre : le stop compte.</li>
<li><b>Levier</b> : la somme des positions ne dépasse jamais capital × levier ; clôture de toutes les positions sous 50 % de la marge (règle européenne) ; jamais de solde négatif. Plafonds pour un particulier en Europe : 5:1 sur actions, 20:1 sur indices et or, 2:1 sur cryptos.</li>
<li><b>Durée</b> : rien ne reste ouvert plus de 3 jours.</li>
<li><b>Données</b> : Yahoo Finance (5 min sur 60 jours, journalier sur 20 ans) ; Coinbase pour BTC et ETH. Les cours de Revolut X demandent une clé signée : les frais simulés sont ceux de Revolut X (0 % en ordre limite, 0,09 % au marché).</li>
<li><b>Limites</b> : l’ORB est testé en barres de 1 min sur 59 actions liquides, pas sur tout le marché US comme dans l’étude ; les autres stratégies intraday en barres de 5 min ; quelques semaines de rejeu ne suffisent pas à conclure. Sur l’or, la taille n’est pas arrondie au lot de 0,01 (1 once) : en réel, il faudrait ~2 500 $ pour garder 1 % de risque par trade.</li>
</ul></section>
<footer>Simulation à but d’apprentissage. Rien ici n’est un conseil en investissement.</footer>
</main>
`;
}

export function writeArenaPage(dir: string): string {
  const path = join(dir, 'arene.html');
  writeTextAtomic(path, renderArena(dir));
  return path;
}
