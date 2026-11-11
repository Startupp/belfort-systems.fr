/**
 * Page du Worker : classement des 12 comptes papier, PnL en direct. Autonome (aucune ressource extérieure) ; les
 * chiffres du dernier passage sont inclus dans la page, puis relus toutes les minutes sur ./api.
 */

const PAGE_HEAD = String.raw`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<title>Arène papier en direct</title>
<style>
:root{--bg:#f5f3ee;--panel:#fffdf9;--ink:#1c2230;--muted:#5f6675;--faint:#8a909c;--line:#e2ddd2;--up:#0d7a4e;--down:#b4261d;--flat:#5f6675;--s:#a85a08;--m:#1f5ea8;--l:#6a4ca6;--chip:#efebe2;--focus:#1f5ea8;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#11141a;--panel:#191d25;--ink:#e9e7e2;--muted:#a1a7b3;--faint:#787f8c;--line:#2a303b;--up:#3fcf8e;--down:#ff6f61;--flat:#a1a7b3;--s:#f0a64e;--m:#74abff;--l:#b9a2e0;--chip:#232833;--focus:#74abff;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#11141a;--panel:#191d25;--ink:#e9e7e2;--muted:#a1a7b3;--faint:#787f8c;--line:#2a303b;--up:#3fcf8e;--down:#ff6f61;--flat:#a1a7b3;--s:#f0a64e;--m:#74abff;--l:#b9a2e0;--chip:#232833;--focus:#74abff;color-scheme:dark}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
.tabs{display:flex;flex-wrap:wrap;gap:6px;padding-block:10px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));border-bottom:1px solid var(--line);font-size:14px}
.tabs a{padding:6px 12px;border-radius:99px;text-decoration:none;font-weight:600;color:var(--muted)}
.tabs a[aria-current]{background:var(--m);color:var(--panel)}
.wrap{max-width:1080px;margin:0 auto;padding-block:20px 40px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum"}
header{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:8px 24px;margin-bottom:16px}
.kicker{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 2px}
h1{font-size:26px;line-height:1.15;margin:0;text-wrap:balance}
.status{margin:0;color:var(--muted);font-size:13px;display:flex;align-items:center;gap:8px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--up);box-shadow:0 0 0 3px color-mix(in srgb,var(--up) 22%,transparent)}
.dot.stale{background:var(--s);box-shadow:0 0 0 3px color-mix(in srgb,var(--s) 22%,transparent)}
.banner{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--m);border-radius:10px;padding:12px 14px;margin-bottom:16px}
.banner b{font-weight:600}
.tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:18px}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;min-width:0}
.tile .lab{font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.tile .val{font-size:20px;font-weight:650;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile .sub{font-size:13px;color:var(--muted)}
.tile.t-s{border-top:3px solid var(--s)}.tile.t-m{border-top:3px solid var(--m)}.tile.t-l{border-top:3px solid var(--l)}
.up{color:var(--up)}.down{color:var(--down)}.flat{color:var(--flat)}
.board{display:flex;flex-direction:column;gap:8px}
details.acc{background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
details.acc[open]{border-color:color-mix(in srgb,var(--ink) 25%,var(--line))}
summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:34px minmax(0,1fr) 120px 128px 118px 86px;align-items:center;gap:12px;padding:10px 14px}
summary::-webkit-details-marker{display:none}
summary:focus-visible{outline:2px solid var(--focus);outline-offset:-2px}
.pos{font-size:20px;font-weight:700;color:var(--muted);text-align:center}
.who{min-width:0}
.name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta{font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chip{display:inline-block;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;padding:1px 7px;border-radius:99px;background:var(--chip);margin-right:6px;vertical-align:1px}
.chip.t-s{color:var(--s)}.chip.t-m{color:var(--m)}.chip.t-l{color:var(--l)}
.spark{width:120px;height:34px;display:block}
.eq{text-align:right}
.eq .big{font-weight:650;font-size:16px}
.eq .small{font-size:12.5px}
.side{text-align:right;font-size:12.5px;color:var(--muted)}
.side b{color:var(--ink);font-weight:600}
.body{border-top:1px solid var(--line);padding:12px 14px 14px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}
.body h3{font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin:0 0 6px;font-weight:600}
.body p{margin:0 0 8px;font-size:13.5px;color:var(--muted)}
.tbl{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{padding:4px 6px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
th:first-child,td:first-child{text-align:left}
th{font-weight:600;color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:.05em}
td.why{white-space:normal;text-align:left;color:var(--muted);min-width:160px}
.empty{font-size:13px;color:var(--faint)}
footer{margin-top:22px;font-size:12.5px;color:var(--muted);display:flex;flex-direction:column;gap:6px}
footer .notes{color:var(--s)}
@media (max-width:760px){
  .tiles{grid-template-columns:repeat(2,minmax(0,1fr))}
  summary{grid-template-columns:28px minmax(0,1fr) auto;grid-template-areas:"pos who eq" "pos spark side";row-gap:4px}
  .pos{grid-area:pos;font-size:17px}.who{grid-area:who}.eq{grid-area:eq}.sparkc{grid-area:spark}.side{grid-area:side}
  .dd{display:none}
  .spark{width:100%;max-width:180px}
  .body{grid-template-columns:minmax(0,1fr)}
  h1{font-size:22px}
}
</style>
</head>
<body>
<nav aria-label="Pages" class="tabs"><a href="./" aria-current="page">12 comptes</a><a href="desk">Desk 500 $</a><a href="crypto">Crypto 500 $</a></nav>
<div class="wrap">
<header>
  <div><p class="kicker">Arène papier · aucun ordre réel</p><h1>12 comptes de 5 000 $, en direct</h1></div>
  <p class="status"><span class="dot" id="dot"></span><span id="status">chargement…</span></p>
</header>
<div id="banner"></div>
<section class="tiles" id="tiles"></section>
<section class="board" id="board" aria-label="Classement des comptes"></section>
<footer>
  <div class="notes" id="notes"></div>
  <div>Chaque compte suit les règles et le réglage figés de l’arène (choisis sur l’historique depuis 2020, jamais retouchés pendant le suivi). Un passage chaque minute : nouvelles barres (5 min, 1 h ou 1 jour selon le compte), ordres simulés au cours suivant, frais, financement et glissement compris ; le PnL des positions ouvertes est recalculé au dernier cours. Cours : Yahoo Finance (ETF, or, forex), Coinbase (crypto au comptant), Kraken Futures (perpétuels et financement).</div>
  <div>Touchez un compte pour voir ses positions et ses derniers trades. Papier uniquement : ce Worker ne détient aucune clé et ne passe aucun ordre.</div>
</footer>
</div>
`;

const PAGE_SCRIPT = String.raw`<script>
(function () {
  var el = function (id) { return document.getElementById(id); };
  var data = null;
  try { data = JSON.parse(el('d').textContent || 'null'); } catch (e) { data = null; }
  var base = location.pathname.replace(/\/?$/, '/');
  var openIds = {};
  var lastOk = Date.now();
  var TIER = { 'sniper': 'Sniper', 'modéré': 'Modéré', 'long terme': 'Long terme' };
  var TC = { 'sniper': 't-s', 'modéré': 't-m', 'long terme': 't-l' };
  var SYM = { 'PF_XBTUSD': 'BTC perp.', 'PF_ETHUSD': 'ETH perp.', 'GC=F': 'Or', 'EURUSD=X': 'EUR/USD', 'BTC-USD': 'BTC', 'ETH-USD': 'ETH', 'SOL-USD': 'SOL' };
  var f2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var f0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  function usd(x) { return f2.format(x) + ' $'; }
  function sgn(x) { return x > 0.004 ? '+' : x < -0.004 ? '−' : ''; }
  function money(x) { return sgn(x) + f2.format(Math.abs(x)) + ' $'; }
  function pct(x) { return sgn(x) + f2.format(Math.abs(x)) + ' %'; }
  function cls(x) { return x > 0.004 ? 'up' : x < -0.004 ? 'down' : 'flat'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function sym(s) { return SYM[s] || s; }
  function qty(q) { return q >= 100 ? f0.format(q) : q >= 1 ? f2.format(q) : new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 4 }).format(q); }
  function px(p) { return p >= 1000 ? f2.format(p) : new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 6 }).format(p); }
  function when(ms, withDay) {
    var o = { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' };
    if (withDay) { o.day = '2-digit'; o.month = '2-digit'; }
    return new Date(ms).toLocaleString('fr-FR', o);
  }
  function ago(ms) {
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return 'à l’instant';
    var m = Math.round(s / 60);
    if (m < 60) return 'il y a ' + m + ' min';
    var h = Math.floor(m / 60);
    return 'il y a ' + h + ' h ' + String(m % 60).padStart(2, '0');
  }
  function until(ms) {
    var m = Math.max(0, Math.round((ms - Date.now()) / 60000));
    var d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    return (d ? d + ' j ' : '') + (d || h ? h + ' h ' : '') + mm + ' min';
  }
  function spark(a) {
    var pts = (a.daily || []).map(function (x) { return x[1]; });
    if (!pts.length || pts[pts.length - 1] !== a.equity) pts.push(a.equity);
    if (pts.length < 2) pts.unshift(a.capital);
    var lo = Math.min.apply(null, pts.concat([a.capital])), hi = Math.max.apply(null, pts.concat([a.capital]));
    var span = hi - lo || a.capital * 0.002 || 1;
    var W = 120, H = 34, P = 3;
    var x = function (i) { return (i / (pts.length - 1)) * W; };
    var y = function (v) { return P + (1 - (v - lo) / span) * (H - 2 * P); };
    var d = pts.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join(' ');
    var c = cls(a.equity - a.capital);
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<line x1="0" x2="' + W + '" y1="' + y(a.capital).toFixed(1) + '" y2="' + y(a.capital).toFixed(1) + '" stroke="currentColor" stroke-opacity=".25" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>' +
      '<path d="' + d + '" fill="none" stroke="var(--' + (c === 'flat' ? 'flat' : c) + ')" stroke-width="1.8" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
  }
  function openTable(a) {
    if (!a.open.length) return '<p class="empty">Aucune position ouverte.</p>';
    return '<div class="tbl"><table><thead><tr><th>Marché</th><th>Sens</th><th>Quantité</th><th>Entrée</th><th>Dernier</th><th>PnL</th></tr></thead><tbody>' +
      a.open.map(function (o) {
        return '<tr><td>' + esc(sym(o.symbol)) + '</td><td>' + (o.side === 'long' ? 'achat' : 'vente') + '</td><td class="num">' + qty(o.qty) + '</td><td class="num">' + px(o.entry) + '</td><td class="num">' + px(o.last) + '</td><td class="num ' + cls(o.pnl) + '">' + money(o.pnl) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function tradesTable(a) {
    if (!a.lastTrades.length) return '<p class="empty">Pas encore de trade clôturé.</p>';
    return '<div class="tbl"><table><thead><tr><th>Clôturé</th><th>Marché</th><th>Sens</th><th>PnL</th><th>Sortie</th></tr></thead><tbody>' +
      a.lastTrades.map(function (t) {
        return '<tr title="' + esc(t.reason) + '"><td class="num">' + when(t.closedAt, true) + '</td><td>' + esc(sym(t.symbol)) + '</td><td>' + (t.side === 'long' ? 'achat' : 'vente') + '</td><td class="num ' + cls(t.pnl) + '">' + money(t.pnl) + '</td><td class="why">' + esc(t.exitReason) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function row(a, i) {
    var c = cls(a.pnl);
    var win = a.trades ? Math.round((a.wins / a.trades) * 100) + ' % gagnants' : 'aucun trade';
    return '<details class="acc" data-id="' + esc(a.id) + '"' + (openIds[a.id] ? ' open' : '') + '>' +
      '<summary>' +
        '<div class="pos num">' + (i + 1) + '</div>' +
        '<div class="who"><div class="name">' + esc(a.name) + '</div><div class="meta"><span class="chip ' + (TC[a.tier] || '') + '">' + esc(TIER[a.tier] || a.tier) + '</span>' + esc(a.market) + '</div></div>' +
        '<div class="sparkc">' + spark(a) + '</div>' +
        '<div class="eq num"><div class="big">' + usd(a.equity) + '</div><div class="small ' + c + '">' + money(a.pnl) + ' · ' + pct(a.pnlPct) + '</div></div>' +
        '<div class="side num"><div><b>' + a.trades + '</b> trade' + (a.trades > 1 ? 's' : '') + (a.open.length ? ' · <b>' + a.open.length + '</b> ouverte' + (a.open.length > 1 ? 's' : '') : '') + '</div><div>' + win + '</div></div>' +
        '<div class="side num dd"><div>baisse max</div><div><b>' + f2.format(a.maxDrawdownPct) + ' %</b></div></div>' +
      '</summary>' +
      '<div class="body">' +
        '<div><h3>Positions ouvertes</h3>' + openTable(a) + '<h3 style="margin-top:12px">Réglage</h3><p>' + esc(a.setting) + ' · levier ' + esc(a.leverage) + '</p></div>' +
        '<div><h3>Derniers trades</h3>' + tradesTable(a) + '</div>' +
      '</div></details>';
  }
  function tiles(list) {
    var groups = [['Total des 12', null, ''], ['Sniper', 'sniper', 't-s'], ['Modéré', 'modéré', 't-m'], ['Long terme', 'long terme', 't-l']];
    return groups.map(function (g) {
      var xs = list.filter(function (a) { return !g[1] || a.tier === g[1]; });
      var cap = xs.reduce(function (s, a) { return s + a.capital; }, 0);
      var eq = xs.reduce(function (s, a) { return s + a.equity; }, 0);
      var p = eq - cap;
      return '<div class="tile ' + g[2] + '"><div class="lab">' + g[0] + ' · ' + xs.length + ' comptes</div><div class="val num">' + usd(eq) + '</div><div class="sub num ' + cls(p) + '">' + money(p) + ' · ' + pct(cap ? (p / cap) * 100 : 0) + '</div></div>';
    }).join('');
  }
  function render() {
    if (!data || !data.accounts || !data.accounts.length) {
      el('status').textContent = 'pas encore de passage';
      el('board').innerHTML = '<p class="empty">Le premier passage n’a pas encore eu lieu.</p>';
      return;
    }
    var list = data.accounts.slice().sort(function (a, b) { return b.pnlPct - a.pnlPct || a.rank - b.rank; });
    el('tiles').innerHTML = tiles(list);
    el('board').innerHTML = list.map(row).join('');
    var pre = Date.now() < data.startMs;
    el('banner').innerHTML = pre ? '<div class="banner"><b>Départ du suivi : ' + new Date(data.startMs).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) + ' (Paris)</b>, dans ' + until(data.startMs) + '. D’ici là, chaque compte reste à 5 000 $ ; les cours et l’historique se remplissent déjà.</div>' : '';
    var fill = data.filling ? 'Historique des cours en cours de chargement (' + data.filling + ' série' + (data.filling > 1 ? 's' : '') + ' restante' + (data.filling > 1 ? 's' : '') + ', une par minute). ' : '';
    el('notes').textContent = fill + (data.notes && data.notes.length ? 'Remarques du dernier passage : ' + data.notes.join(' · ') : '');
    status();
  }
  function status() {
    if (!data) return;
    var stale = Date.now() - data.generatedAt > 12 * 60000;
    el('dot').className = 'dot' + (stale ? ' stale' : '');
    el('status').textContent = 'Dernier passage ' + when(data.generatedAt) + ' (Paris), ' + ago(data.generatedAt) + (stale ? ' — en retard' : '') + (Date.now() - lastOk > 3 * 60000 ? ' · page hors ligne' : '');
  }
  document.addEventListener('toggle', function (e) {
    var t = e.target;
    if (t && t.matches && t.matches('details.acc')) openIds[t.getAttribute('data-id')] = t.open;
  }, true);
  function refresh() {
    fetch(base + 'api', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (j) {
      lastOk = Date.now();
      if (!data || j.generatedAt !== data.generatedAt) { data = j; render(); } else status();
    }).catch(function () { status(); });
  }
  render();
  setInterval(refresh, 60000);
  setInterval(status, 15000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
})();
</script>
</body>
</html>`;

/** Page complète, avec le résumé du dernier passage inclus (JSON déjà sérialisé). */
export function pageHtml(summaryJson: string): string {
  // « < » échappé : le JSON ne peut pas fermer la balise script.
  const safe = summaryJson.replace(/</g, '\\u003c');
  return `${PAGE_HEAD}<script id="d" type="application/json">${safe}</script>\n${PAGE_SCRIPT}`;
}
