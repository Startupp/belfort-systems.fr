/**
 * Page de l'arène des 12 comptes de 5 000 $ : suivi en direct, classement sur la période de test, fiches (règles,
 * variantes essayées, choix fait sur l'apprentissage), méthode. Fragment sans squelette HTML, thèmes clair et sombre.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, readJsonl } from '../lib/store.ts';
import type { ArenaFile, RunSummary } from './main.ts';
import { ACCOUNTS } from './roster.ts';
import type { Account, Tier } from './roster.ts';
import type { AccountResult, ComptesFile } from './valide.ts';
import type { CovidFile } from './covid.ts';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c] ?? c);
const fr = (x: number, d = 2): string => (Number.isFinite(x) ? x.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const sgn = (x: number, d = 2): string => `${x > 0 ? '+' : ''}${fr(x, d)}`;
const dateFr = (ms: number): string => new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', year: 'numeric' });
const TIER: Record<Tier, { label: string; cls: string }> = {
  sniper: { label: 'sniper', cls: 't-a' },
  modéré: { label: 'modéré', cls: 't-b' },
  'long terme': { label: 'long terme', cls: 't-c' },
};
const byId = new Map(ACCOUNTS.map((a) => [a.id, a]));

function spark(daily: Array<[string, number]>, capital: number): string {
  const pts = [capital, ...daily.map((d) => d[1])];
  if (pts.length < 2) return '';
  const W = 120;
  const H = 30;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const span = hi - lo || 1;
  const x = (i: number): number => (i / (pts.length - 1)) * W;
  const y = (v: number): number => H - 2 - ((v - lo) / span) * (H - 4);
  const end = pts.at(-1) as number;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="courbe"><line class="base" x1="0" x2="${W}" y1="${y(capital).toFixed(1)}" y2="${y(capital).toFixed(1)}"/><polyline class="${end >= capital ? 'up' : 'down'}" points="${pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/></svg>`;
}

const chip = (a: Account): string => `<span class="chip ${TIER[a.tier].cls}">${esc(TIER[a.tier].label)}</span>`;

function ranking(results: AccountResult[]): string {
  const rows = [...results].sort((x, y) => y.monthlyPct - x.monthlyPct);
  return `<div class="scroll"><table class="board"><thead><tr><th>#</th><th>Compte</th><th>Test</th><th>Par mois</th><th>Baisse max</th><th>Trades</th><th>Courbe</th></tr></thead><tbody>${rows
    .map((r, i) => {
      const a = byId.get(r.id) as Account;
      const v = r.variants[r.chosen];
      if (!v) return '';
      const s = v.test;
      return `<tr class="${s.returnPct > 0 ? 'win' : 'loss'}"><td class="num">${i + 1}</td><td class="wrap"><b>${esc(a.name)}</b> ${chip(a)}<br><span class="muted">${esc(a.market)} · ${esc(a.leverageLabel)} · réglage : ${esc(v.label)}</span></td><td class="num ${s.returnPct >= 0 ? 'good' : 'bad'}"><b>${sgn(s.returnPct)} %</b><br><span class="muted">${esc(dateFr(r.test[0]))} → ${esc(dateFr(r.test[1] - 1))}</span></td><td class="num ${r.monthlyPct >= 0 ? 'good' : 'bad'}">${sgn(r.monthlyPct)} %</td><td class="num">${fr(s.maxDrawdownPct)} %</td><td class="num">${s.trades}</td><td>${spark(v.testDaily, 5000)}</td></tr>`;
    })
    .join('')}</tbody></table></div>`;
}

function live(suivi: ArenaFile | null): string {
  const w = suivi?.windows.suivi;
  const started = w && w.runs.some((r) => r.daily.length > 0);
  if (!w || !started) return '<p>Le suivi des 12 comptes démarre le <b>jeudi 12 novembre à 0 h</b> (Paris) : chaque compte part de 5 000 $ et avance sur les cours réels avec le réglage figé ci-dessous.</p>';
  const rows = [...w.runs].sort((x, y) => y.equity - x.equity);
  const total = rows.reduce((s, r) => s + r.equity, 0);
  return `<p class="muted">${esc(w.label)} · total des 12 comptes : <b class="num">${fr(total)} $</b> (${sgn(((total - 60_000) / 60_000) * 100)} %)</p><div class="scroll"><table class="board"><thead><tr><th>#</th><th>Compte</th><th>PnL</th><th>Equity</th><th>Trades</th><th>Ouvertes</th><th>Courbe</th></tr></thead><tbody>${rows
    .map((r: RunSummary, i) => {
      const a = byId.get(r.id);
      const pnl = r.equity - r.capital;
      return `<tr class="${pnl >= 0 ? 'win' : 'loss'}"><td class="num">${i + 1}</td><td class="wrap"><b>${esc(a?.name ?? r.id)}</b> ${a ? chip(a) : ''}</td><td class="num ${pnl >= 0 ? 'good' : 'bad'}"><b>${sgn(pnl)} $</b><br><span class="muted">${sgn(r.stats.returnPct)} %</span></td><td class="num">${fr(r.equity)} $</td><td class="num">${r.stats.trades}</td><td class="num">${r.open.length}</td><td>${spark(r.daily, r.capital)}</td></tr>`;
    })
    .join('')}</tbody></table></div>`;
}

function fiche(a: Account, r: AccountResult | undefined): string {
  const rows = (r?.variants ?? [])
    .map((v, i) => `<tr class="${i === r?.chosen ? 'chosen' : ''}"><td>${i === r?.chosen ? '→ ' : ''}${esc(v.label)}</td><td class="num">${sgn(v.train.returnPct, 1)} % <span class="muted">(${fr(v.train.maxDrawdownPct, 1)} %)</span></td><td class="num ${v.test.returnPct >= 0 ? 'good' : 'bad'}">${sgn(v.test.returnPct)} % <span class="muted">(${fr(v.test.maxDrawdownPct, 1)} %)</span></td><td class="num">${v.test.trades}</td></tr>`)
    .join('');
  return `<details class="fiche"><summary><b>${a.rank}. ${esc(a.name)}</b> ${chip(a)} <span class="muted">${esc(a.market)} · ${esc(a.leverageLabel)}</span></summary>
<p>${esc(a.rules)}</p>
<p class="muted"><b>Source</b> : ${esc(a.source)}</p>
${r ? `<p class="muted">Apprentissage du ${esc(dateFr(r.train[0]))} au ${esc(dateFr(r.train[1] - 1))} ; test du ${esc(dateFr(r.test[0]))} au ${esc(dateFr(r.test[1] - 1))}. La flèche marque la variante choisie sur l’apprentissage (rendement par point de baisse).</p>
<div class="scroll"><table><thead><tr><th>Variante</th><th>Apprentissage (baisse)</th><th>Test (baisse)</th><th>Trades test</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
</details>`;
}

/** Événements marquants de chaque année, pour lire le tableau « depuis le Covid ». */
const EVENTS: Record<number, string> = {
  2021: 'euphorie : cryptos et actions « mèmes » ; financement des perpétuels BTC jusqu’à ~170 %/an en janvier',
  2022: 'hausse brutale des taux ; krach crypto (Terra-Luna en mai, FTX en novembre)',
  2023: 'faillite de Silicon Valley Bank en mars, puis reprise portée par l’IA',
  2024: 'ETF bitcoin au comptant en janvier ; krach éclair du 5 août (yen)',
  2025: 'chute des marchés en avril sur les droits de douane américains',
};

function covidSection(c: CovidFile | null): string {
  if (!c || !c.accounts.length) return '';
  const cell = (x: number | undefined, sub = ''): string => (x === undefined || !Number.isFinite(x) ? '<td class="num muted">—</td>' : `<td class="num ${x >= 0 ? 'good' : 'bad'}">${sgn(x, 1)} %${sub ? `<br><span class="muted small">${esc(sub)}</span>` : ''}</td>`);
  const head = `<tr><th>Compte</th>${c.years.map((y) => `<th>${y}${y === c.years.at(-1) ? '*' : ''}</th>`).join('')}<th>Cumul</th><th>Pire baisse</th></tr>`;
  const ctx = Object.entries(c.context)
    .map(([label, byYear]) => `<tr class="ctx"><td class="wrap"><b>${esc(label)}</b> <span class="muted">achat-conservation</span></td>${c.years.map((y) => cell(byYear[y])).join('')}<td class="num muted">${sgn((c.years.reduce((g, y) => g * (1 + (byYear[y] ?? 0) / 100), 1) - 1) * 100, 0)} %</td><td></td></tr>`)
    .join('');
  const rows = [...c.accounts]
    .sort((x, y) => y.cumulativePct - x.cumulativePct)
    .map((a) => {
      const acc = byId.get(a.id);
      const multi = (acc?.variants.length ?? 1) > 1;
      return `<tr class="${a.cumulativePct >= 0 ? 'win' : 'loss'}"><td class="wrap"><b>${esc(acc?.name ?? a.id)}</b> ${acc ? chip(acc) : ''}</td>${c.years.map((y) => {
        const r = a.rows.find((x) => x.year === y);
        return cell(r?.returnPct, multi ? r?.label : '');
      }).join('')}<td class="num ${a.cumulativePct >= 0 ? 'good' : 'bad'}"><b>${sgn(a.cumulativePct, 0)} %</b></td><td class="num">${fr(a.worstDrawdownPct, 1)} %</td></tr>`;
    })
    .join('');
  return `<section class="card"><h2>Depuis le Covid, année par année</h2>
<p class="muted">Chaque année est jugée avec le réglage choisi sur les années précédentes seulement (depuis janvier 2020) : c’est ce qu’un élève aurait réellement fait. Chaque année repart de 5 000 $ ; le cumul les enchaîne. * année en cours.</p>
<div class="scroll"><table><thead>${head}</thead><tbody>${ctx}${rows}</tbody></table></div>
<ul class="plain note">${c.years.filter((y) => EVENTS[y]).map((y) => `<li><b>${y}</b> : ${esc(EVENTS[y] as string)}</li>`).join('')}</ul>
<p class="muted">Pas dans ce tableau : ${c.skipped.map((id) => esc(byId.get(id)?.name ?? id)).join(', ')}. Leurs barres de 5 min n’existent que sur 60 jours ; ils seront jugés sur les 12 mois de suivi. Perpétuels et portage : prix au comptant en approximation du perpétuel, financement réel de Binance puis de Kraken.</p>
</section>`;
}

function deskRows(root: string): string {
  const desks = [
    { label: 'Desk ORB + momentum + VWAP (15 h – 19 h)', dir: join(root, 'carnet') },
    { label: 'Portefeuille crypto du desk (15 h – 19 h)', dir: join(root, 'carnet-crypto') },
  ];
  const rows = desks
    .filter((d) => existsSync(join(d.dir, 'state.json')))
    .map((d) => {
      const st = readJson<{ startEquity?: number } | null>(join(d.dir, 'state.json'), null);
      const trades = readJsonl<{ pnlUsd: number; equityAfter: number }>(join(d.dir, 'trades.jsonl'));
      const start = st?.startEquity ?? 500;
      const eq = trades.at(-1)?.equityAfter ?? start;
      return `<tr class="${eq >= start ? 'win' : 'loss'}"><td class="wrap"><b>${esc(d.label)}</b><br><span class="muted">500 $, sans levier, semaine d’essai</span></td><td class="num ${eq >= start ? 'good' : 'bad'}">${sgn(((eq - start) / start) * 100)} %<br><span class="muted">${fr(eq)} $</span></td><td class="num">${trades.length}</td></tr>`;
    })
    .join('');
  return rows ? `<section class="card"><h2>Hors concours : les portefeuilles du desk</h2><div class="scroll"><table class="board"><thead><tr><th>Portefeuille</th><th>Résultat</th><th>Trades</th></tr></thead><tbody>${rows}</tbody></table></div></section>` : '';
}

export function renderComptes(dir: string): string {
  const comptes = readJson<ComptesFile | null>(join(dir, 'comptes.json'), null);
  const suivi = readJson<ArenaFile | null>(join(dir, 'suivi.json'), null);
  const lecture = readJson<string[]>(join(dir, 'lecture.json'), []);
  const covid = readJson<CovidFile | null>(join(dir, 'covid.json'), null);
  const results = comptes?.results ?? [];
  const best = [...results].sort((x, y) => y.monthlyPct - x.monthlyPct)[0];
  const winners = results.filter((r) => (r.variants[r.chosen]?.test.returnPct ?? 0) > 0).length;
  const updated = Math.max(comptes?.generatedAt ?? 0, suivi?.generatedAt ?? 0) || Date.now();
  const kpi = (label: string, value: string, sub: string, cls = ''): string => `<div class="kpi"><span class="kl">${esc(label)}</span><span class="kv ${cls}">${value}</span><span class="ks">${sub}</span></div>`;
  const tiers: Tier[] = ['sniper', 'modéré', 'long terme'];
  return `<meta charset="utf-8">
<title>Arène des stratégies</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@600&family=IBM+Plex+Sans:wght@400;600&display=swap">
<style>
/* Arène : 12 comptes rangés du plus agressif au plus long terme ; classement sur une période de test jamais vue au réglage. */
:root{
  --bg:#f2f4f7;--surface:#ffffff;--ink:#121821;--muted:#5b6876;--rule:#dce2e9;
  --accent:#2c52cf;--accent-soft:rgba(44,82,207,.12);--gain:#0a7a4e;--loss:#b3242f;
  --ta:#b3242f;--ta-soft:rgba(179,36,47,.10);--tb:#985a00;--tb-soft:rgba(152,90,0,.12);--tc:#0a7a4e;--tc-soft:rgba(10,122,78,.12);
  --display:"IBM Plex Sans Condensed","Arial Narrow",system-ui,sans-serif;
  --body:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --data:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#0d1116;--surface:#151b23;--ink:#e4e9ef;--muted:#93a1b0;--rule:#27303b;
  --accent:#8aa2ff;--accent-soft:rgba(138,162,255,.16);--gain:#3fcf8e;--loss:#ff7b80;
  --ta:#ff7b80;--ta-soft:rgba(255,123,128,.14);--tb:#f0b23c;--tb-soft:rgba(240,178,60,.14);--tc:#3fcf8e;--tc-soft:rgba(63,207,142,.14);color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#0d1116;--surface:#151b23;--ink:#e4e9ef;--muted:#93a1b0;--rule:#27303b;
  --accent:#8aa2ff;--accent-soft:rgba(138,162,255,.16);--gain:#3fcf8e;--loss:#ff7b80;
  --ta:#ff7b80;--ta-soft:rgba(255,123,128,.14);--tb:#f0b23c;--tb-soft:rgba(240,178,60,.14);--tc:#3fcf8e;--tc-soft:rgba(63,207,142,.14);color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 var(--body)}
main{max-width:1040px;margin:0 auto;padding-block:20px 28px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:grid;gap:14px}
main>*{min-width:0}
h1,h2,h3{font-family:var(--display);font-weight:600;text-wrap:balance;margin:0}
h1{font-size:26px}h2{font-size:19px;margin-bottom:6px}h3{font-size:16px;margin:8px 0 2px}
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
td.num{white-space:nowrap}td.wrap{min-width:220px}
tr.win td:first-child{box-shadow:inset 3px 0 var(--gain)}tr.loss td:first-child{box-shadow:inset 3px 0 var(--loss)}
tr.chosen td{font-weight:600}
.chip{font-size:11px;border-radius:4px;padding:0 6px;white-space:nowrap}
.t-a{background:var(--ta-soft);color:var(--ta)}.t-b{background:var(--tb-soft);color:var(--tb)}.t-c{background:var(--tc-soft);color:var(--tc)}
.spark{width:120px;height:30px;display:block}
.spark .base{stroke:var(--rule);stroke-width:1}
.spark polyline{fill:none;stroke-width:1.6}.spark .up{stroke:var(--gain)}.spark .down{stroke:var(--loss)}
ul.plain{margin:0;padding-left:18px;display:grid;gap:4px}
details.fiche{border-top:1px solid var(--rule);padding:10px 0;display:grid;gap:6px}
details.fiche summary{cursor:pointer}
details.fiche p{margin-top:6px;font-size:14px}
.note{font-size:14px}
.small{font-size:11px}
tr.ctx td{background:var(--bg)}
footer{font-size:12px;color:var(--muted)}
</style>
<main>
<header class="top">
<h1>Arène : 12 comptes de 5 000 $</h1>
<p class="muted">Mis à jour le ${esc(new Date(updated).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' }))} (heure de Paris)</p>
<p class="banner"><b>Papier</b> : 12 comptes fictifs de 5 000 $, une stratégie chacun, du plus agressif au plus long terme : <span class="chip t-a">sniper</span> 1 à 4, <span class="chip t-b">modéré</span> 5 à 8, <span class="chip t-c">long terme</span> 9 à 12. Perpétuels crypto, Nasdaq, or, forex, S&amp;P 500, crypto au comptant, ETF. Aucun ordre réel, aucune clé.</p>
</header>
${results.length ? `<section class="kpis" aria-label="Chiffres clés">
${best ? kpi('Meilleur en test (par mois)', `${sgn(best.monthlyPct)} %`, esc(byId.get(best.id)?.name ?? best.id), best.monthlyPct >= 0 ? 'good' : 'bad') : ''}
${kpi('Comptes gagnants en test', `${winners} / ${results.length}`, 'période jamais vue pendant le réglage')}
${kpi('Objectif', '12 mois', 'classement final des 12 comptes')}
</section>` : ''}
<section class="card"><h2>Suivi en direct</h2>${live(suivi)}</section>
${lecture.length ? `<section class="card"><h2>Ma lecture</h2><ul class="plain note">${lecture.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>` : ''}
${results.length ? `<section class="card"><h2>Classement sur la période de test</h2><p class="muted">Réglage choisi sur l’apprentissage seulement, puis jugé sur les derniers mois (4 semaines pour les stratégies en 5 min, faute de données plus anciennes ; 4 mois pour les autres). Classés par rendement ramené à un mois.</p>${ranking(results)}</section>` : ''}
${covidSection(covid)}
${tiers.map((t) => `<section class="card"><h2>Comptes ${esc(TIER[t].label)}</h2>${ACCOUNTS.filter((a) => a.tier === t).map((a) => fiche(a, results.find((r) => r.id === a.id))).join('')}</section>`).join('')}
${deskRows(join(dir, '..'))}
<section class="card"><h2>Méthode et limites</h2><ul class="plain note">
<li><b>Sans biais</b> : chaque variante est d’abord jugée sur une période d’apprentissage ; la meilleure (rendement par point de baisse maximale) est figée, puis jugée sur la période de test, jamais utilisée pour choisir. Toutes les variantes sont montrées en test, pour vérifier qu’on n’a pas choisi après coup.</li>
<li><b>Périodes</b> : apprentissage depuis 2010 pour les ETF, depuis janvier 2025 pour la crypto au comptant, depuis novembre 2025 pour les perpétuels ; test du 13 juillet à aujourd’hui. Les barres de 5 min (Nasdaq, S&amp;P 500, or, forex) n’existent que sur 60 jours : apprentissage de mi-septembre au 11 octobre, test depuis le 12 octobre.</li>
<li><b>Exécution prudente</b> : stops au prix du stop ou à l’ouverture si le cours a sauté, stop prioritaire sur l’objectif, ordres limites seulement si le cours passe au travers, clôture de marge sous 50 %, jamais de solde négatif.</li>
<li><b>Coûts</b> : perpétuels Kraken Futures (0,05 % par ordre, financement horaire réel), Revolut X au comptant (0,09 % au marché), CFD sans commission avec écart et financement de nuit, ETF au comptant.</li>
<li><b>Données</b> : Kraken Futures (perpétuels et financement), Coinbase (crypto au comptant), Yahoo Finance (actions, ETF, or, forex).</li>
</ul></section>
<footer>Simulation à but d’apprentissage. Rien ici n’est un conseil en investissement.</footer>
</main>
`;
}
