// Tests du Worker minimal belfort-api (planning + vérificateur de liens), sans réseau :
//   node api-planning/worker.test.mjs
// fetch et caches.default sont remplacés par des maquettes ; chaque test charge une copie neuve du Worker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// « cloudflare:email » n'existe que chez Cloudflare : remplacé par une classe témoin (from, to, raw).
const SOURCE = readFileSync(new URL("./worker.js", import.meta.url), "utf8")
  .replace(/^import \{ EmailMessage \} from "cloudflare:email";$/m, "class EmailMessage { constructor(from, to, raw) { this.from = from; this.to = to; this.raw = raw; } }");
assert.ok(!/cloudflare:email/.test(SOURCE.replace(/^\/\/.*$/gm, "")), "import cloudflare:email remplacé pour Node");
let n = 0;
const charger = () => import("data:text/javascript;charset=utf-8," + encodeURIComponent(SOURCE + "\n// copie " + (n++)));
const ORIGINE = "https://espace-breteuil.pages.dev";
const req = (chemin, opts = {}) => new Request("https://belfort-api.exemple.workers.dev" + chemin, { method: opts.method || "GET", headers: { Origin: opts.origine ?? ORIGINE } });

function cacheMaquette() {
  const m = new Map();
  return { m, match: async (r) => { const v = m.get(r.url); return v ? v.clone() : undefined; }, put: async (r, rep) => { m.set(r.url, rep.clone()); } };
}
/** Maquette de fetch : table url → fonction(méthode) → { status, url?, type?, corps? } ; journal des appels. */
function fetchMaquette(table) {
  const appels = [], entetes = [];
  const f = async (url, init = {}) => {
    const methode = (init.method || "GET").toUpperCase();
    appels.push(methode + " " + url);
    entetes.push(init.headers || {});
    const def = table[url];
    if (!def) throw new TypeError("réseau : " + url);
    const r = typeof def === "function" ? def(methode) : def;
    if (r instanceof Error) throw r;
    const corps = r.corps ?? "";
    return { ok: r.status >= 200 && r.status < 300, status: r.status, url: r.url || url, headers: new Headers({ "Content-Type": r.type || "text/html; charset=UTF-8" }),
      text: async () => corps, body: methode === "HEAD" ? null : { cancel: async () => {} } };
  };
  f.appels = appels; f.entetes = entetes;
  return f;
}
function installer(table) { const f = fetchMaquette(table); globalThis.fetch = f; globalThis.caches = { default: cacheMaquette() }; return f; }

const PIED_FR = `<!doctype html><html><body><header><a href="/a-propos/">À propos (en-tête, ignoré)</a></header><main>…</main>
<footer data-elementor-type="footer" class="elementor-location-footer">
  <a href="/horaires-tarifs-acces/">Horaires, tarifs &amp; accès</a>
  <a href="https://breteuil.tickeasy.com/">E-billetterie</a>
  <a href='/page-disparue/'><span>Escape&nbsp;Game</span></a>
  <a href="/ancienne-presse/">Presse</a>
  <a href="/horaires-tarifs-acces/#plan">Horaires (doublon)</a>
  <a href="mailto:contact@exemple.fr">Écrire</a>
  <a href="tel:+33100000000">Appeler</a>
  <a href="#haut">Haut de page</a>
  <a class="badge" href="https://www.culture.gouv.fr/"><img src="/logo.png" alt="Ministère de la Culture"></a>
  <a href="https://www.facebook.com/exemple" aria-label="Facebook"><svg></svg></a>
  <a href="/mentions-legales/">Mentions légales</a>
</footer></body></html>`;
const PIED_EN = `<html><body><footer><a href="/en/contact/">Contact</a><a href="https://breteuil.tickeasy.com/">Tickets</a></footer></body></html>`;

function tableSite(extra = {}) {
  return {
    "https://www.breteuil.fr/": { status: 200, corps: PIED_FR },
    "https://www.breteuil.fr/en/": { status: 200, corps: PIED_EN },
    "https://www.breteuil.fr/horaires-tarifs-acces/": { status: 200 },
    "https://breteuil.tickeasy.com/": (m) => m === "HEAD" ? { status: 405 } : { status: 200 },
    "https://www.breteuil.fr/page-disparue/": { status: 404 },
    "https://www.breteuil.fr/ancienne-presse/": { status: 200, url: "https://www.breteuil.fr/presse/" },
    "https://www.culture.gouv.fr/": { status: 200, url: "https://culture.gouv.fr" },
    "https://www.facebook.com/exemple": (m) => m === "HEAD" ? { status: 403 } : { status: 403 },
    "https://www.breteuil.fr/mentions-legales/": new Error("délai dépassé"),
    "https://www.breteuil.fr/en/contact/": { status: 200 },
    ...extra,
  };
}

test("origine refusée, OPTIONS et méthode : comme avant", async () => {
  const W = (await charger()).default; installer({});
  assert.equal((await W.fetch(req("/breteuil/site/liens", { origine: "https://pirate.example" }), {})).status, 403);
  const o = await W.fetch(req("/breteuil/site/liens", { method: "OPTIONS" }), {});
  assert.equal(o.status, 204); assert.equal(o.headers.get("Access-Control-Allow-Origin"), ORIGINE);
  assert.equal((await W.fetch(new Request("https://x.dev/breteuil/site/liens", { method: "POST", headers: { Origin: ORIGINE } }), {})).status, 405);
  assert.equal((await W.fetch(req("/breteuil/autre"), {})).status, 404);
});

test("planning : routes inchangées (non configuré, source, cache, calendrier inconnu)", async () => {
  const W = (await charger()).default;
  const ics = "BEGIN:VCALENDAR\r\nEND:VCALENDAR";
  const f = installer({ "https://cal.exemple/a.ics": { status: 200, corps: ics, type: "text/calendar" } });
  assert.equal((await W.fetch(req("/breteuil/planning.ics"), {})).status, 503);
  const env = { BRETEUIL_ICS_URL: "webcal://cal.exemple/a.ics" };
  const r1 = await W.fetch(req("/breteuil/planning.ics"), env);
  assert.equal(r1.status, 200); assert.equal(r1.headers.get("X-Planning-Etat"), "source"); assert.equal(await r1.text(), ics);
  const r2 = await W.fetch(req("/breteuil/planning.ics"), env);
  assert.equal(r2.headers.get("X-Planning-Etat"), "cache"); assert.equal(f.appels.length, 1);
  assert.equal((await W.fetch(req("/breteuil/planning/2.ics"), env)).status, 503);
  assert.equal((await W.fetch(req("/breteuil/planning/9.ics"), env)).status, 404);
});

test("liens du bas de page : <footer> seulement, http(s), dédoublonnés, FR puis EN, statuts", async () => {
  const W = (await charger()).default; const f = installer(tableSite());
  const r = await W.fetch(req("/breteuil/site/liens"), {});
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), ORIGINE);
  const j = await r.json();
  assert.match(j.verifieLe, /^\d{4}-\d\d-\d\dT/);
  const parUrl = Object.fromEntries(j.liens.map((l) => [l.url, l]));
  assert.deepEqual(j.liens.map((l) => l.url), [
    "https://www.breteuil.fr/horaires-tarifs-acces/", "https://breteuil.tickeasy.com/", "https://www.breteuil.fr/page-disparue/",
    "https://www.breteuil.fr/ancienne-presse/", "https://www.culture.gouv.fr/", "https://www.facebook.com/exemple",
    "https://www.breteuil.fr/mentions-legales/", "https://www.breteuil.fr/en/contact/"], "ni en-tête, ni mailto/tel/#, ni doublon");
  assert.equal(parUrl["https://www.breteuil.fr/horaires-tarifs-acces/"].texte, "Horaires, tarifs & accès");
  assert.equal(parUrl["https://www.breteuil.fr/page-disparue/"].texte, "Escape Game");
  assert.equal(parUrl["https://www.culture.gouv.fr/"].texte, "Ministère de la Culture", "texte d'un badge = alt de l'image");
  assert.equal(parUrl["https://www.facebook.com/exemple"].texte, "Facebook", "texte = aria-label");
  assert.equal(parUrl["https://www.breteuil.fr/en/contact/"].page, "en");
  assert.equal(parUrl["https://breteuil.tickeasy.com/"].page, "fr", "doublon FR/EN gardé une fois");
  // Statuts
  assert.deepEqual([parUrl["https://www.breteuil.fr/horaires-tarifs-acces/"].ok, parUrl["https://www.breteuil.fr/horaires-tarifs-acces/"].statut], [true, 200]);
  assert.deepEqual([parUrl["https://breteuil.tickeasy.com/"].ok, parUrl["https://breteuil.tickeasy.com/"].statut], [true, 200], "HEAD 405 → GET");
  assert.ok(f.appels.includes("GET https://breteuil.tickeasy.com/"));
  assert.deepEqual([parUrl["https://www.breteuil.fr/page-disparue/"].ok, parUrl["https://www.breteuil.fr/page-disparue/"].statut], [false, 404]);
  assert.equal(parUrl["https://www.breteuil.fr/ancienne-presse/"].redirigeVers, "https://www.breteuil.fr/presse/");
  assert.equal(parUrl["https://www.culture.gouv.fr/"].redirigeVers, null, "www / barre finale : pas une vraie redirection");
  assert.deepEqual([parUrl["https://www.facebook.com/exemple"].ok, parUrl["https://www.facebook.com/exemple"].statut], [false, 403]);
  assert.deepEqual([parUrl["https://www.breteuil.fr/mentions-legales/"].ok, parUrl["https://www.breteuil.fr/mentions-legales/"].statut], [false, null], "ne répond pas");
  for (const l of j.liens) assert.deepEqual(Object.keys(l).sort(), ["methode", "ok", "page", "redirigeVers", "statut", "texte", "url"]);
  assert.ok(!f.appels.some((a) => /^HEAD https:\/\/www\.breteuil\.fr\//.test(a)), "pages de www.breteuil.fr : GET direct, jamais HEAD");
  assert.equal(parUrl["https://www.breteuil.fr/page-disparue/"].methode, "GET", "cassé = confirmé par un GET");
});

test("entités HTML : apostrophes, guillemets, accents, symboles (textes des liens)", async () => {
  const { decoder } = await charger();
  assert.equal(decoder("Groupes d&rsquo;enfants"), "Groupes d\u2019enfants");
  assert.equal(decoder("Breteuil dans l&rsquo;Histoire"), "Breteuil dans l\u2019Histoire");
  assert.equal(decoder("&laquo;&nbsp;&Eacute;t&eacute;&nbsp;&raquo; &ndash; &hellip;"), "\u00ab\u00a0Été\u00a0\u00bb \u2013 \u2026");
  assert.equal(decoder("&OElig;uvre, c&oelig;ur, &agrave; &ccedil;a, &icirc;le, 5&euro;, 20&deg;, &copy;"), "Œuvre, cœur, à ça, île, 5€, 20°, ©");
  assert.equal(decoder("&#8217; &#x2019; &AMP; &inconnu; &lt;b&gt;"), "\u2019 \u2019 & &inconnu; <b>", "numériques, casse, inconnue laissée telle quelle");
  assert.equal(decoder("&constructor; &toString;"), "&constructor; &toString;", "noms de propriétés JS : pas des entités");
  const W = (await charger()).default;
  installer(tableSite({ "https://www.breteuil.fr/": { status: 200, corps: '<footer><a href="/en-famille/">Groupes d&rsquo;enfants</a><a href="/histoire/">Breteuil dans l&#8217;Histoire</a></footer>' },
    "https://www.breteuil.fr/en-famille/": { status: 200 }, "https://www.breteuil.fr/histoire/": { status: 200 } }));
  const j = await (await W.fetch(req("/breteuil/site/liens"), {})).json();
  assert.deepEqual(j.liens.slice(0, 2).map((l) => l.texte), ["Groupes d\u2019enfants", "Breteuil dans l\u2019Histoire"]);
});

test("cache 1 h, ?forcer=1 (au plus une fois par minute)", async () => {
  const W = (await charger()).default; const f = installer(tableSite());
  const reel = Date.now; let maintenant = reel();
  Date.now = () => maintenant;
  try {
    await (await W.fetch(req("/breteuil/site/liens"), {})).json();
    const apres1 = f.appels.length;
    maintenant += 30 * 60000;
    const j2 = await (await W.fetch(req("/breteuil/site/liens"), {})).json();
    assert.equal(f.appels.length, apres1, "dans l'heure : rien n'est revérifié"); assert.equal(j2.depuisCache, true);
    await W.fetch(req("/breteuil/site/liens?forcer=1"), {});
    assert.ok(f.appels.length > apres1, "forcer=1 : nouvelle vérification");
    const apres2 = f.appels.length;
    maintenant += 20000;
    await W.fetch(req("/breteuil/site/liens?forcer=1"), {});
    assert.equal(f.appels.length, apres2, "forcer=1 deux fois en une minute : copie");
    maintenant += 61 * 60000;
    await W.fetch(req("/breteuil/site/liens"), {});
    assert.ok(f.appels.length > apres2, "après 1 h : nouvelle vérification");
  } finally { Date.now = reel; }
});

test("faux « cassés » : HEAD 404/403/429/5xx refait en GET (navigateur, français) avant de conclure", async () => {
  const W = (await charger()).default;
  const pied = '<footer><a href="https://ext.exemple/en-famille/">En famille</a><a href="https://ext.exemple/histoire/">Histoire</a>'
    + '<a href="https://ext.exemple/vraiment-disparue/">Disparue</a><a href="https://ext.exemple/robot/">Robot</a><a href="https://ext.exemple/panne/">Panne</a>'
    + '<a href="/wp-page/">Page WordPress</a></footer>';
  const f = installer({
    "https://www.breteuil.fr/": { status: 200, corps: pied }, "https://www.breteuil.fr/en/": { status: 404 },
    "https://ext.exemple/en-famille/": (m) => ({ status: m === "HEAD" ? 404 : 200 }),
    "https://ext.exemple/histoire/": (m) => ({ status: m === "HEAD" ? 403 : 200 }),
    "https://ext.exemple/vraiment-disparue/": { status: 410 },
    "https://ext.exemple/robot/": (m) => ({ status: m === "HEAD" ? 429 : 403 }),
    "https://ext.exemple/panne/": (m) => ({ status: m === "HEAD" ? 503 : 200 }),
    "https://www.breteuil.fr/wp-page/": (m) => ({ status: m === "HEAD" ? 404 : 200 }),
  });
  const j = await (await W.fetch(req("/breteuil/site/liens"), {})).json();
  const parTexte = Object.fromEntries(j.liens.map((l) => [l.texte, l]));
  assert.deepEqual([parTexte["En famille"].ok, parTexte["En famille"].statut, parTexte["En famille"].methode], [true, 200, "GET"], "HEAD 404 puis GET 200 : bon");
  assert.deepEqual([parTexte["Histoire"].ok, parTexte["Histoire"].statut], [true, 200], "HEAD 403 puis GET 200 : bon");
  assert.deepEqual([parTexte["Disparue"].ok, parTexte["Disparue"].statut, parTexte["Disparue"].methode], [false, 410, "GET"], "410 confirmé en GET");
  assert.deepEqual([parTexte["Robot"].statut, parTexte["Robot"].methode], [403, "GET"]);
  assert.deepEqual([parTexte["Panne"].ok, parTexte["Panne"].statut], [true, 200], "HEAD 503 puis GET 200 : bon");
  assert.deepEqual([parTexte["Page WordPress"].ok, parTexte["Page WordPress"].methode], [true, "GET"]);
  assert.ok(!f.appels.includes("HEAD https://www.breteuil.fr/wp-page/"));
  const iGet = f.appels.indexOf("GET https://ext.exemple/en-famille/");
  assert.ok(iGet > -1);
  const e = f.entetes[iGet];
  assert.match(e["User-Agent"], /^Mozilla\/5\.0 \(Windows NT 10\.0.*Chrome\/\d+/, "User-Agent de navigateur");
  assert.match(e["Accept-Language"], /^fr-FR,fr/);
  assert.match(e["Accept"], /text\/html/);
});

test("budget : sans sous-requête libre, un HEAD 404 n'est pas revérifié et reste « HEAD » (non confirmé)", async () => {
  const W = (await charger()).default;
  const liens = Array.from({ length: 40 }, (_, i) => `<a href="https://ext${i}.exemple/">Ext ${i}</a>`).join("");
  const table = { "https://www.breteuil.fr/": { status: 200, corps: "<footer>" + liens + "</footer>" }, "https://www.breteuil.fr/en/": { status: 200, corps: "<footer></footer>" } };
  for (let i = 0; i < 40; i++) table[`https://ext${i}.exemple/`] = (m) => ({ status: m === "HEAD" ? 404 : 200 });
  const f = installer(table);
  const j = await (await W.fetch(req("/breteuil/site/liens"), {})).json();
  assert.ok(f.appels.length <= 50, f.appels.length + " sous-requêtes");
  const confirmes = j.liens.filter((l) => l.methode === "GET"), restes = j.liens.filter((l) => l.methode === "HEAD");
  assert.equal(confirmes.length, 6, "48 - 2 pages - 40 HEAD = 6 GET de secours");
  assert.ok(confirmes.every((l) => l.ok));
  assert.ok(restes.every((l) => l.statut === 404 && !l.ok), "non revérifiés : marqués HEAD");
});

test("40 liens au plus et jamais plus de 50 sous-requêtes", async () => {
  const W = (await charger()).default;
  const liens = Array.from({ length: 70 }, (_, i) => `<a href="/p${i}/">Page ${i}</a>`).join("");
  const table = { "https://www.breteuil.fr/": { status: 200, corps: "<footer>" + liens + "</footer>" }, "https://www.breteuil.fr/en/": { status: 404 } };
  for (let i = 0; i < 70; i++) table[`https://www.breteuil.fr/p${i}/`] = (m) => ({ status: m === "HEAD" ? 405 : 200 });
  const f = installer(table);
  const j = await (await W.fetch(req("/breteuil/site/liens"), {})).json();
  assert.equal(j.liens.length, 40);
  assert.ok(f.appels.length <= 50, f.appels.length + " sous-requêtes");
});

test("sans <footer> : le dernier tiers du HTML", async () => {
  const W = (await charger()).default;
  const html = `<body><a href="/haut/">Haut</a>${"x".repeat(3000)}<div class="pied"><a href="/bas/">Bas</a></div></body>`;
  installer({ "https://www.breteuil.fr/": { status: 200, corps: html }, "https://www.breteuil.fr/en/": new Error("hors ligne"), "https://www.breteuil.fr/bas/": { status: 200 } });
  const j = await (await W.fetch(req("/breteuil/site/liens"), {})).json();
  assert.deepEqual(j.liens.map((l) => l.texte), ["Bas"]);
});

test("site injoignable : 502 JSON clair, ou dernière copie connue", async () => {
  const W = (await charger()).default;
  installer({ "https://www.breteuil.fr/": new Error("hors ligne") });
  const r = await W.fetch(req("/breteuil/site/liens"), {});
  assert.equal(r.status, 502);
  const j = await r.json();
  assert.equal(j.ok, false); assert.match(j.erreur, /ne répond pas/);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), ORIGINE);
});

/* ================================================================== */
/* Aide / demandes (v5.4) : jeton Microsoft, D1, mails sortants/entrants */
/* ================================================================== */
// Clé RSA de TEST générée à chaque lancement, JWKS simulé, base D1 simulée par node:sqlite (mémoire).
// Adresses fictives (exemple.fr) : aucune vraie adresse dans le dépôt.
import { DatabaseSync } from "node:sqlite";

const TENANT_GUID = "11111111-2222-3333-4444-555555555555";
const ISS = `https://login.microsoftonline.com/${TENANT_GUID}/v2.0`;
const CLIENT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PRESTA = "damien.prestataire@exemple.fr", PRESTA_TENANT = "damien@chateau-exemple.onmicrosoft.com";
const paire = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const autrePaire = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwkPublic = await crypto.subtle.exportKey("jwk", paire.publicKey);
const JWKS = { keys: [{ kty: "RSA", use: "sig", kid: "cle-test", n: jwkPublic.n, e: jwkPublic.e }] };
const b64u = (o) => Buffer.from(o).toString("base64url");
async function jeton(charge, opts = {}) {
  const maintenant = Math.floor(Date.now() / 1000);
  const c = { iss: ISS, aud: CLIENT, iat: maintenant, nbf: maintenant, exp: maintenant + 3600, ...charge };
  const tete = b64u(JSON.stringify({ alg: "RS256", typ: "JWT", kid: opts.kid || "cle-test" })) + "." + b64u(JSON.stringify(c));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", (opts.paire || paire).privateKey, new TextEncoder().encode(tete));
  return tete + "." + b64u(new Uint8Array(sig));
}
const FANNY = { oid: "oid-fanny", name: "Fanny Martin", preferred_username: "fmartin@chateau-exemple.fr" };
const CAMILLE = { oid: "oid-camille", name: "Camille Roux", preferred_username: "croux@chateau-exemple.fr" };
const DAMIEN = { oid: "oid-damien", name: "Damien Belfort", preferred_username: PRESTA_TENANT };

function d1() {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql, v = []) => ({
    bind: (...x) => stmt(sql, x),
    first: async () => db.prepare(sql).get(...v) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...v) }),
    run: async () => { const r = db.prepare(sql).run(...v); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return { brut: db, prepare: (sql) => stmt(sql), batch: async (l) => { for (const s of l) await s.run(); } };
}
function envAide(extra = {}) {
  const envoyes = [];
  return { envoyes, AIDE_DB: d1(), AIDE_MAIL: { send: async (m) => { envoyes.push(m); return { messageId: "x" }; } },
    AIDE_TENANT_ID: "chateau-exemple.onmicrosoft.com", AIDE_CLIENT_ID: CLIENT, AIDE_SECRET: "secret-de-test-tres-long-0123456789",
    AIDE_EXPEDITEUR: "aide@aide.exemple.fr", AIDE_DESTINATAIRE: PRESTA, AIDE_PRESTATAIRES: PRESTA + ", " + PRESTA_TENANT, ...extra };
}
function installerMicrosoft() {
  return installer({
    "https://login.microsoftonline.com/chateau-exemple.onmicrosoft.com/v2.0/.well-known/openid-configuration": { status: 200, type: "application/json", corps: JSON.stringify({ issuer: ISS }) },
    "https://login.microsoftonline.com/chateau-exemple.onmicrosoft.com/discovery/v2.0/keys": { status: 200, type: "application/json", corps: JSON.stringify(JWKS) },
  });
}
// La maquette de fetch n'a que text() : json() ajouté ici.
const fetchAvecJson = () => { const f = globalThis.fetch; globalThis.fetch = async (u, i) => { const r = await f(u, i); r.json = async () => JSON.parse(await r.text()); return r; }; globalThis.fetch.appels = f.appels; };
async function appel(W, env, chemin, { methode = "GET", qui, corps, brut } = {}) {
  const headers = { Origin: ORIGINE };
  if (qui) headers.Authorization = "Bearer " + (typeof qui === "string" ? qui : await jeton(qui));
  if (corps) headers["Content-Type"] = "application/json";
  const r = await W.fetch(new Request("https://belfort-api.exemple.workers.dev" + chemin, { method: methode, headers, body: brut ?? (corps ? JSON.stringify(corps) : undefined) }), env);
  return { status: r.status, j: await r.json(), r };
}
async function prete() { const mod = await charger(); installerMicrosoft(); fetchAvecJson(); return mod; }
/** Décode le MIME produit : en-têtes dépliés + corps base64. */
function lireMime(raw) {
  const i0 = raw.indexOf("\r\n\r\n"), tete = raw.slice(0, i0), reste = raw.slice(i0 + 4);
  const h = {};
  for (const l of tete.replace(/\r\n[ \t]+/g, " ").split("\r\n")) { const i = l.indexOf(":"); h[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim(); }
  const mots = (v) => v.replace(/=\?UTF-8\?B\?([^?]+)\?=\s*/g, (m, b) => Buffer.from(b, "base64").toString("utf8"));
  const deB64 = (s) => Buffer.from(s.replace(/\s/g, ""), "base64").toString("utf8");
  const parties = {};
  const borne = /boundary="([^"]+)"/.exec(h["content-type"] || "");
  if (borne) {
    for (const p of reste.split("--" + borne[1]).slice(1)) {
      if (p.startsWith("--")) break;
      const j = p.indexOf("\r\n\r\n"), th = p.slice(0, j), type = /Content-Type: ([^;\r\n]+)/i.exec(th)[1];
      parties[type] = { tete: th, corps: deB64(p.slice(j + 4)), brut: p.slice(j + 4) };
    }
  }
  return { h, sujet: mots(h.subject), corps: borne ? parties["text/plain"].corps : deB64(reste), html: parties["text/html"]?.corps, parties, tete };
}

test("aide : non configurée → 503 aide_non_configuree ; CORS : Authorization, POST, PATCH", async () => {
  const W = (await prete()).default;
  const r = await appel(W, {}, "/breteuil/aide/moi");
  assert.equal(r.status, 503); assert.equal(r.j.code, "aide_non_configuree");
  const sansMail = envAide({ AIDE_MAIL: undefined });
  assert.equal((await appel(W, sansMail, "/breteuil/aide", { methode: "POST", qui: FANNY, corps: { type: "avis", message: "x" } })).j.code, "aide_non_configuree");
  const o = await W.fetch(new Request("https://x.dev/breteuil/aide", { method: "OPTIONS", headers: { Origin: ORIGINE } }), {});
  assert.equal(o.status, 204);
  assert.match(o.headers.get("Access-Control-Allow-Headers"), /Authorization/); assert.match(o.headers.get("Access-Control-Allow-Headers"), /Content-Type/);
  assert.match(o.headers.get("Access-Control-Allow-Methods"), /POST/); assert.match(o.headers.get("Access-Control-Allow-Methods"), /PATCH/);
  assert.equal((await W.fetch(new Request("https://x.dev/breteuil/aide", { headers: { Origin: "https://pirate.example" } }), envAide())).status, 403, "origine toujours contrôlée");
});

test("aide : jeton Microsoft vérifié (signature, iss, aud, exp/nbf avec 5 min de tolérance)", async () => {
  const W = (await prete()).default, env = envAide();
  const maintenant = Math.floor(Date.now() / 1000);
  assert.equal((await appel(W, env, "/breteuil/aide/moi")).status, 401, "sans jeton");
  assert.equal((await appel(W, env, "/breteuil/aide/moi", { qui: "pas.un.jeton" })).status, 401);
  assert.equal((await appel(W, env, "/breteuil/aide/moi", { qui: await jeton(FANNY, { paire: autrePaire }) })).status, 401, "autre clé");
  assert.equal((await appel(W, env, "/breteuil/aide/moi", { qui: await jeton(FANNY, { kid: "inconnue" }) })).status, 401, "kid inconnu");
  assert.equal((await appel(W, env, "/breteuil/aide/moi", { qui: { ...FANNY, aud: "autre-appli" } })).status, 401, "aud");
  assert.equal((await appel(W, env, "/breteuil/aide/moi", { qui: { ...FANNY, iss: "https://login.microsoftonline.com/autre/v2.0" } })).status, 401, "iss");
  assert.equal((await appel(W, env, "/breteuil/aide/moi", { qui: { ...FANNY, exp: maintenant - 400 } })).status, 401, "expiré");
  assert.equal((await appel(W, env, "/breteuil/aide/moi", { qui: { ...FANNY, nbf: maintenant + 400 } })).status, 401, "pas encore valable");
  assert.equal((await appel(W, env, "/breteuil/aide/moi", { qui: { ...FANNY, oid: undefined } })).status, 401, "sans oid");
  // Jeton altéré : charge changée, signature d'origine.
  const t = (await jeton(FANNY)).split("."); t[1] = b64u(JSON.stringify({ ...JSON.parse(Buffer.from(t[1], "base64url")), preferred_username: PRESTA_TENANT }));
  assert.equal((await appel(W, env, "/breteuil/aide/moi", { qui: t.join(".") })).status, 401, "charge altérée");
  const ok = await appel(W, env, "/breteuil/aide/moi", { qui: { ...FANNY, exp: maintenant - 120 } });
  assert.equal(ok.status, 200, "expiré depuis 2 min : toléré");
  assert.deepEqual(ok.j, { prestataire: false, nom: "Fanny Martin", adresse: "fmartin@chateau-exemple.fr", pj: false });
  assert.equal((await appel(W, env, "/breteuil/aide/moi", { qui: DAMIEN })).j.prestataire, true);
  // Clés en cache : un seul chargement des JWKS pour tous ces appels.
  assert.equal(globalThis.fetch.appels.filter((a) => /keys$/.test(a)).length, 1, "JWKS chargées une fois (kid inconnu : pas de rechargement avant 1 min)");
});

test("aide : création, mail sortant MIME (sujet exact encodé RFC 2047, Reply-To signé, corps complet)", async () => {
  const mod = await prete(), W = mod.default, env = envAide();
  const r = await appel(W, env, "/breteuil/aide", { methode: "POST", qui: FANNY, corps: { type: "probleme", message: "Le planning ne s'affiche plus\u0007 <b>depuis ce matin</b>.", ecran: "Planning", version: "5.4.0", appareil: "iPhone (Safari)" } });
  assert.equal(r.status, 201); assert.equal(r.j.id, 1); assert.equal(r.j.mailEnvoye, true);
  assert.equal(env.envoyes.length, 1);
  const m = env.envoyes[0];
  assert.equal(m.from, "aide@aide.exemple.fr"); assert.equal(m.to, PRESTA);
  const x = lireMime(m.raw);
  assert.equal(x.sujet, "Application Breteuil - Retour client - Problème - n°1");
  assert.match(x.h.subject, /^=\?UTF-8\?B\?/, "sujet encodé (accent)");
  assert.ok(x.tete.split("\r\n").every((l) => l.length <= 78), "lignes d'en-tête ≤ 78 caractères");
  const sig = await mod.signature(env.AIDE_SECRET, 1);
  assert.match(sig, /^[0-9a-f]{12}$/);
  assert.equal(x.h["reply-to"], `<demande+1-${sig}@aide.exemple.fr>`);
  assert.match(x.h.from, /<aide@aide\.exemple\.fr>$/);
  assert.match(x.h["content-type"], /^multipart\/alternative; +boundary="=_eb_[0-9a-f]{32}"$/);
  assert.ok(Object.keys(x.parties).join() === "text/plain,text/html", "texte brut d'abord (secours), puis HTML");
  for (const p of Object.values(x.parties)) {
    assert.match(p.tete, /charset=UTF-8\r\nContent-Transfer-Encoding: base64/);
    assert.ok(p.brut.trim().split("\r\n").every((l) => l.length <= 76), "base64 : lignes ≤ 76 caractères");
  }
  // HTML : contenu utilisateur échappé (balises du message affichées, jamais interprétées).
  assert.ok(x.html.includes("Le planning ne s&#39;affiche plus &lt;b&gt;depuis ce matin&lt;/b&gt;."), "message échappé");
  assert.ok(!x.html.includes("<b>depuis"), "aucune balise venue de l'utilisateur");
  for (const attendu of ["Espace Breteuil</span> · Demande n°1", ">Problème</td>", "Fanny Martin", "fmartin@chateau-exemple.fr", "Ouvrir la demande",
    'href="https://espace-breteuil.pages.dev/#/aide/1"', "Répondez simplement à ce mail&nbsp;: votre réponse s'ajoute à la demande.", "Nouvelle demande"]) assert.ok(x.html.includes(attendu), "HTML : " + attendu);
  for (const attendu of ["Nom : Fanny Martin", "Adresse : fmartin@chateau-exemple.fr", "Écran : Planning", "Version : 5.4.0", "Appareil : iPhone (Safari)",
    "Le planning ne s'affiche plus <b>depuis ce matin</b>.", "https://espace-breteuil.pages.dev/#/aide/1"]) assert.ok(x.corps.includes(attendu), "corps : " + attendu);
  assert.ok(!x.corps.includes("\u0007"), "caractères de contrôle retirés");
  // « n° » n'est pas ASCII : le sujet est toujours encodé, et se relit à l'identique.
  await appel(W, env, "/breteuil/aide", { methode: "POST", qui: FANNY, corps: { type: "avis", message: "Bravo" } });
  assert.equal(lireMime(env.envoyes[1].raw).sujet, "Application Breteuil - Retour client - Avis - n°2");
  assert.equal(mod.enTete("Re: simple ASCII"), "Re: simple ASCII", "ASCII : non encodé");
  for (const [t, l] of [["question", "Question"], ["amelioration", "Amélioration"]]) assert.equal(mod.sujetDemande(t, 7), `Application Breteuil - Retour client - ${l} - n°7`);
  // Constructeur MIME seul : en-tête long non ASCII découpé en plusieurs mots encodés.
  const long = mod.enTete("Amélioration ".repeat(8));
  assert.ok(long.split("\r\n ").length > 1 && long.split("\r\n ").every((w) => w.length <= 75));
});

test("mail HTML : tout est échappé (nom, adresse, contexte, pièces jointes), pastille du type, nouveau message", async () => {
  const mod = await charger();
  const piege = `<script>alert("x")</script>&'"`;
  const html = mod.htmlMail({ id: 7, type: "question", nom: piege, adresse: "a@b.fr<img src=x onerror=alert(1)>", ecran: piege, version: piege, appareil: piege,
    date: Date.UTC(2026, 9, 19, 12, 5), texte: "Ligne 1\n" + piege, premier: false, lien: 'https://x.fr/#/aide/7"><script>',
    pj: [{ nom: piege + ".pdf", taille: 1536, lien: "https://x.fr/#/aide/7/pj/3" }], ignorees: ["Pièce jointe ignorée : trop lourde (" + piege + ")"] });
  assert.ok(!/<script|<img|onerror=alert\(1\)>/.test(html), "aucune balise injectée");
  assert.ok(html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;&quot;"));
  assert.ok(html.includes("Ligne 1<br>"), "sauts de ligne → <br>");
  assert.ok(html.includes("Nouveau message sur la demande n°7"));
  assert.ok(html.includes("#E2ECF7") && html.includes(">Question</td>"), "pastille Question (bleu)");
  assert.ok(html.includes("2 Ko") && html.includes('href="https://x.fr/#/aide/7/pj/3"'), "pièce jointe : taille + lien vers l'appli");
  assert.ok(html.includes("19 octobre 2026"), "date en français (Europe/Paris)");
  assert.match(html, /max-width:600px/); assert.doesNotMatch(html, /<link|<script/);
  assert.equal(mod.tailleLisible(500), "500 o"); assert.equal(mod.tailleLisible(2048), "2 Ko"); assert.equal(mod.tailleLisible(1.25 * 1024 * 1024), "1,3 Mo");
  // MIME sans HTML : texte seul, comme avant.
  const brut = mod.construireMime({ de: "a@x.fr", a: "b@x.fr", sujet: "S", texte: "t", messageId: "m@x.fr" });
  assert.match(brut, /Content-Type: text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64/);
});

test("aide : validations, limite de 10 demandes par heure, envoi de mail en échec non bloquant", async () => {
  const W = (await prete()).default, env = envAide();
  const post = (corps, qui = FANNY) => appel(W, env, "/breteuil/aide", { methode: "POST", qui, corps });
  assert.equal((await post({ type: "inconnu", message: "x" })).status, 400);
  assert.equal((await post({ type: "avis", message: "   " })).j.code, "message_vide");
  assert.equal((await post({ type: "avis", message: "é".repeat(4001) })).j.code, "message_trop_long");
  assert.equal((await post({ type: "avis", message: "é".repeat(4000) })).status, 201);
  assert.equal((await appel(W, env, "/breteuil/aide", { methode: "POST", qui: FANNY, brut: "{pas du json" })).status, 400);
  for (let i = 0; i < 9; i++) assert.equal((await post({ type: "question", message: "Q" + i })).status, 201);
  const trop = await post({ type: "question", message: "une de trop" });
  assert.equal(trop.status, 429); assert.equal(trop.j.code, "trop_de_demandes");
  assert.equal((await post({ type: "question", message: "autre personne" }, CAMILLE)).status, 201, "limite par personne");
  // Une heure plus tard : de nouveau permis.
  env.AIDE_DB.brut.exec("UPDATE demandes SET cree = '2000-01-01T00:00:00.000Z'");
  assert.equal((await post({ type: "question", message: "plus tard" })).status, 201);
  const enPanne = envAide({ AIDE_MAIL: { send: async () => { throw new Error("destination non vérifiée"); } } });
  const r = await appel(W, enPanne, "/breteuil/aide", { methode: "POST", qui: FANNY, corps: { type: "avis", message: "x" } });
  assert.equal(r.status, 201); assert.equal(r.j.mailEnvoye, false, "demande gardée même si le mail échoue");
});

test("aide : droits (chacun ses demandes, prestataire tout), fil, réponse, non lu, statuts, filtres", async () => {
  const W = (await prete()).default, env = envAide();
  const creer = async (qui, type, message) => (await appel(W, env, "/breteuil/aide", { methode: "POST", qui, corps: { type, message, ecran: "Moi" } })).j.id;
  const a = await creer(FANNY, "probleme", "Imprimante"), b = await creer(CAMILLE, "question", "Mot de passe");
  // Camille ne voit ni ne modifie la demande de Fanny (404 : rien n'est révélé).
  assert.equal((await appel(W, env, "/breteuil/aide/" + a, { qui: CAMILLE })).status, 404);
  assert.equal((await appel(W, env, "/breteuil/aide/" + a + "/messages", { methode: "POST", qui: CAMILLE, corps: { texte: "intrus" } })).status, 404);
  assert.equal((await appel(W, env, "/breteuil/aide/" + a, { methode: "PATCH", qui: CAMILLE, corps: { statut: "resolue" } })).status, 404);
  assert.deepEqual((await appel(W, env, "/breteuil/aide", { qui: CAMILLE })).j.demandes.map((d) => d.id), [b]);
  // Prestataire : tout, filtrable.
  const tout = await appel(W, env, "/breteuil/aide", { qui: DAMIEN });
  assert.equal(tout.j.prestataire, true); assert.deepEqual(tout.j.demandes.map((d) => d.id).sort(), [a, b]);
  assert.deepEqual((await appel(W, env, "/breteuil/aide?type=probleme", { qui: DAMIEN })).j.demandes.map((d) => d.id), [a]);
  assert.deepEqual((await appel(W, env, "/breteuil/aide?personne=CROUX@chateau-exemple.fr", { qui: DAMIEN })).j.demandes.map((d) => d.id), [b]);
  // Réponse de Damien dans l'appli → Répondue, non lue chez Fanny, pas de mail.
  const avant = env.envoyes.length;
  const rep = await appel(W, env, "/breteuil/aide/" + a + "/messages", { methode: "POST", qui: DAMIEN, corps: { texte: "Je regarde ça." } });
  assert.equal(rep.status, 201); assert.equal(rep.j.statut, "repondue"); assert.equal(env.envoyes.length, avant);
  const l = (await appel(W, env, "/breteuil/aide", { qui: FANNY })).j.demandes[0];
  assert.equal(l.statut, "repondue"); assert.equal(l.nonLu, true); assert.equal(l.nbMessages, 2); assert.equal(l.dernierAuteur, "prestataire");
  assert.equal((await appel(W, env, "/breteuil/aide/" + a, { qui: DAMIEN })).j.demande.nonLu, false, "lu par le prestataire : ne change rien");
  assert.equal((await appel(W, env, "/breteuil/aide", { qui: FANNY })).j.demandes[0].nonLu, true);
  const fil = await appel(W, env, "/breteuil/aide/" + a, { qui: FANNY });
  assert.deepEqual(fil.j.messages.map((m) => [m.auteur, m.texte, m.origine]), [["client", "Imprimante", "appli"], ["prestataire", "Je regarde ça.", "appli"]]);
  assert.equal((await appel(W, env, "/breteuil/aide", { qui: FANNY })).j.demandes[0].nonLu, false, "ouvert → lu");
  // Fanny répond → Nouvelle + mail à Damien (même sujet).
  const r2 = await appel(W, env, "/breteuil/aide/" + a + "/messages", { methode: "POST", qui: FANNY, corps: { texte: "Toujours en panne." } });
  assert.equal(r2.j.statut, "nouvelle"); assert.equal(r2.j.mailEnvoye, true);
  const dernier = lireMime(env.envoyes.at(-1).raw);
  assert.equal(dernier.sujet, "Application Breteuil - Retour client - Problème - n°" + a);
  assert.match(dernier.corps, /Nouveau message sur la demande n°1/); assert.match(dernier.corps, /Toujours en panne\./);
  // Statuts : le client peut seulement marquer « Résolue » ; le prestataire peut tout.
  assert.equal((await appel(W, env, "/breteuil/aide/" + a, { methode: "PATCH", qui: FANNY, corps: { statut: "repondue" } })).status, 403);
  assert.equal((await appel(W, env, "/breteuil/aide/" + a, { methode: "PATCH", qui: FANNY, corps: { statut: "resolue" } })).j.statut, "resolue");
  assert.equal((await appel(W, env, "/breteuil/aide/" + a, { methode: "PATCH", qui: DAMIEN, corps: { statut: "bidon" } })).status, 400);
  assert.equal((await appel(W, env, "/breteuil/aide/" + b, { methode: "PATCH", qui: DAMIEN, corps: { statut: "resolue" } })).status, 200);
  assert.deepEqual((await appel(W, env, "/breteuil/aide?statut=resolue", { qui: DAMIEN })).j.demandes.map((d) => d.id).sort(), [a, b]);
  assert.equal((await appel(W, env, "/breteuil/aide/" + a + "/messages", { methode: "POST", qui: FANNY, corps: { texte: "x".repeat(4001) } })).status, 400);
  assert.equal((await appel(W, env, "/breteuil/aide/abc", { qui: FANNY })).status, 404);
  assert.equal((await appel(W, env, "/breteuil/aide/999", { qui: DAMIEN })).status, 404);
});

/* ---------- Mail entrant ---------- */
// Réponse Gmail réaliste : multipart/alternative, texte en quoted-printable, ligne « Le … a écrit : » coupée en deux.
function reponseGmail(a, de) {
  return [
    "Received: by mail-wr1-f41.google.com with SMTP id 5b1f17b1804b1-46e0;",
    "        Sun, 18 Oct 2026 05:07:12 -0700 (PDT)",
    "DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=exemple.fr; s=20230601; h=to:subject:message-id:date:from;",
    "        bh=AAAA; b=BBBB",
    "MIME-Version: 1.0",
    "References: <demande-1@aide.exemple.fr> <demande-1-0f1e2d3c@aide.exemple.fr>",
    "In-Reply-To: <demande-1-0f1e2d3c@aide.exemple.fr>",
    `From: Damien Belfort <${de}>`,
    "Date: Sun, 18 Oct 2026 14:07:12 +0200",
    "Message-ID: <CAF8x9Q0r=YpZk_exemple@mail.gmail.com>",
    "Subject: Re: Application Breteuil - Retour client - =?UTF-8?B?UHJvYmzDqG1l?= - n°1",
    `To: ${a}`,
    'Content-Type: multipart/alternative; boundary="000000000000c0ffee0123456789"',
    "",
    "--000000000000c0ffee0123456789",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "Bonjour Fanny,",
    "",
    "C'est r=C3=A9gl=C3=A9 : le planning s'affiche de nouveau. Pouvez-vous v=C3=A9rif=",
    "ier de votre c=C3=B4t=C3=A9 ?",
    "",
    "> Une ligne citée au milieu (ignorée)",
    "Bonne journ=C3=A9e,",
    "Damien",
    "",
    "Le dim. 18 oct. 2026 =C3=A0 14:05, Espace Breteuil <aide@aide.exemple.fr> a",
    "=C3=A9crit :",
    "",
    "> Nouvelle demande n=C2=B01 =E2=80=94 Probl=C3=A8me",
    ">",
    "> Nom : Fanny Martin",
    "> Message :",
    "> Le planning ne s'affiche plus.",
    ">",
    "",
    "--000000000000c0ffee0123456789",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    '<div dir=3D"ltr">Bonjour Fanny,<div><br></div><div>C&#39;est r=C3=A9gl=C3=A9 (HTML)</div></div>',
    "",
    "--000000000000c0ffee0123456789--",
    "",
  ].join("\r\n");
}
function mailEntrant(a, de, brut) {
  const octets = new TextEncoder().encode(brut);
  return { to: a, from: de, rawSize: octets.length, rejet: null,
    raw: new ReadableStream({ start(c) { c.enqueue(octets); c.close(); } }), setReject(r) { this.rejet = r; } };
}

test("mail entrant : réponse Gmail (quoted-printable) ajoutée au fil sans la citation → Répondue, non lue", async () => {
  const mod = await prete(), W = mod.default, env = envAide();
  await appel(W, env, "/breteuil/aide", { methode: "POST", qui: FANNY, corps: { type: "probleme", message: "Le planning ne s'affiche plus." } });
  const a = `demande+1-${await mod.signature(env.AIDE_SECRET, 1)}@aide.exemple.fr`;
  const msg = mailEntrant(a, PRESTA, reponseGmail(a, PRESTA));
  await W.email(msg, env, {});
  assert.equal(msg.rejet, null);
  const fil = await appel(W, env, "/breteuil/aide/1", { qui: DAMIEN });
  const m = fil.j.messages.at(-1);
  assert.equal(m.auteur, "prestataire"); assert.equal(m.origine, "mail");
  assert.equal(m.texte, "Bonjour Fanny,\n\nC'est réglé : le planning s'affiche de nouveau. Pouvez-vous vérifier de votre côté ?\n\nBonne journée,\nDamien");
  assert.equal(fil.j.demande.statut, "repondue");
  assert.equal((await appel(W, env, "/breteuil/aide", { qui: FANNY })).j.demandes[0].nonLu, true, "pastille chez Fanny");
  // Forme « demande-<n°>-<sig> » (catch-all) aussi acceptée ; adresse en MAJUSCULES et expéditeur avec nom : acceptés.
  const tiret = a.replace("demande+", "demande-"), m3 = mailEntrant(tiret, PRESTA, reponseGmail(tiret, PRESTA));
  await W.email(m3, env, {}); assert.equal(m3.rejet, null);
  const m2 = mailEntrant(a.toUpperCase(), "Damien <" + PRESTA.toUpperCase() + ">", reponseGmail(a, PRESTA));
  await W.email(m2, env, {}); assert.equal(m2.rejet, null);
});

test("mail entrant : signature invalide, expéditeur non autorisé, autre domaine, demande inconnue → rejet", async () => {
  const mod = await prete(), W = mod.default, env = envAide();
  await appel(W, env, "/breteuil/aide", { methode: "POST", qui: FANNY, corps: { type: "avis", message: "x" } });
  const bon = `demande+1-${await mod.signature(env.AIDE_SECRET, 1)}@aide.exemple.fr`;
  const cas = [
    ["demande+1-000000000000@aide.exemple.fr", PRESTA, "signature fausse"],
    [bon.replace("demande+", "demande_"), PRESTA, "autre séparateur"],
    [`demande-2-${(await mod.signature(env.AIDE_SECRET, 1))}@aide.exemple.fr`, PRESTA, "signature d'une autre demande"],
    [bon, "pirate@exemple.org", "expéditeur non autorisé"],
    [bon, "fmartin@chateau-exemple.fr", "le client ne répond pas par mail"],
    [bon.replace("aide.exemple.fr", "autre.exemple.fr"), PRESTA, "autre domaine"],
    ["contact@aide.exemple.fr", PRESTA, "adresse quelconque"],
    [`demande-9-${await mod.signature(env.AIDE_SECRET, 9)}@aide.exemple.fr`, PRESTA, "demande inexistante"],
  ];
  for (const [a, de, pourquoi] of cas) {
    const m = mailEntrant(a, de, reponseGmail(a, de));
    await W.email(m, env, {});
    assert.equal(m.rejet, "Adresse inconnue", pourquoi);
  }
  assert.equal((await appel(W, env, "/breteuil/aide/1", { qui: DAMIEN })).j.messages.length, 1, "rien ajouté");
  // Aide non configurée : rejet aussi.
  const m = mailEntrant(bon, PRESTA, reponseGmail(bon, PRESTA)); await W.email(m, {}, {}); assert.equal(m.rejet, "Adresse inconnue");
});

test("mail entrant : base64, HTML seul, anglais « On … wrote: », signature « -- », Outlook", async () => {
  const mod = await prete();
  const b64 = Buffer.from("Réponse en base64.\n\nOn Sun, Oct 18, 2026 at 2:05 PM Espace Breteuil <aide@aide.exemple.fr> wrote:\n> cité", "utf8").toString("base64");
  assert.equal(mod.sansCitation(mod.partieTexte(`Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64}\r\n`).texte), "Réponse en base64.");
  const html = 'Content-Type: text/html; charset=UTF-8\r\n\r\n<div>Bonjour &amp; merci<br>Damien</div><div class="gmail_quote"><blockquote>vieux</blockquote></div>';
  assert.equal(mod.sansCitation(mod.partieTexte(html).texte), "Bonjour & merci\nDamien");
  assert.equal(mod.sansCitation("Merci !\n-- \nDamien Belfort\n06 00 00 00 00"), "Merci !");
  assert.equal(mod.sansCitation("Ok pour moi.\n\nDe : Espace Breteuil <aide@aide.exemple.fr>\nEnvoyé : dimanche 18 octobre 2026 14:05\nÀ : moi"), "Ok pour moi.");
  assert.equal(mod.sansCitation("Vu.\n\n-----Original Message-----\nFrom: x"), "Vu.");
  assert.equal(mod.sansCitation("Le plus simple : redémarrer.\nLe portable est prêt."), "Le plus simple : redémarrer.\nLe portable est prêt.", "phrases commençant par « Le » gardées");
  // Pièce jointe ignorée ; charset latin-1.
  const mixte = 'Content-Type: multipart/mixed; boundary=XYZ\r\n\r\n--XYZ\r\nContent-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nD=E9j=E0 fait.\r\n--XYZ\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename=a.txt\r\n\r\npièce\r\n--XYZ--\r\n';
  assert.equal(mod.partieTexte(mixte).texte.trim(), "Déjà fait.");
});

/* ================================================================== */
/* v5.6 : pièces jointes (KV « AIDE_PJ » simulé)                        */
/* ================================================================== */
function kv() {
  const m = new Map();
  return { m, put: async (k, v, o) => { m.set(k, { v: new Uint8Array(v), meta: o && o.metadata }); },
    get: async (k, o) => { const x = m.get(k); if (!x) return null; return o && o.type === "stream" ? new Blob([x.v]).stream() : x.v; } };
}
// Petits fichiers d'exemple (signatures réelles).
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, ...new Array(64).fill(7)]);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");
const WEBP = new Uint8Array([...new TextEncoder().encode("RIFF"), 30, 0, 0, 0, ...new TextEncoder().encode("WEBPVP8 "), ...new Array(20).fill(1)]);
const HEIC = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypheic"), 0, 0, 0, 0, ...new TextEncoder().encode("mif1heic"), ...new Array(16).fill(0)]);
const zip = (dossier) => new Uint8Array([...new TextEncoder().encode("PK\x03\x04"), ...new Array(30).fill(0), ...new TextEncoder().encode("[Content_Types].xml " + dossier + "document.xml PK\x01\x02 PK\x05\x06")]);

test("pièces jointes : type réel d'après les octets (nombres magiques), pas l'extension", async () => {
  const { typeFichier: t, nomFichier, disposition } = await charger();
  assert.equal(t(JPG, "photo.jpg").type, "image/jpeg");
  assert.equal(t(JPG, "capture.png").ext, "jpg", "JPEG nommé .png : vu comme JPEG");
  assert.equal(t(PNG, "x").type, "image/png");
  assert.equal(t(WEBP, "x.webp").type, "image/webp");
  assert.equal(t(HEIC, "IMG_0001.HEIC").type, "image/heic");
  assert.equal(t(PDF, "devis.pdf").type, "application/pdf");
  assert.equal(t(zip("word/"), "lettre.docx").ext, "docx");
  assert.equal(t(zip("xl/"), "budget.xlsx").ext, "xlsx");
  assert.equal(t(zip("ppt/"), "expo.pptx").ext, "pptx");
  assert.equal(t(zip("xl/"), "faux.docx"), null, "ZIP sans word/ : refusé");
  assert.equal(t(zip("word/"), "archive.zip"), null, "ZIP quelconque : refusé");
  assert.equal(t(new TextEncoder().encode("Bonjour, été"), "notes.txt").type, "text/plain; charset=utf-8");
  assert.equal(t(new Uint8Array([0x42, 0xe9, 0x74, 0xe9]), "ancien.txt").type, "text/plain; charset=windows-1252");
  assert.equal(t(new TextEncoder().encode("<svg onload=alert(1)>"), "image.svg"), null, "SVG refusé");
  assert.equal(t(new TextEncoder().encode("<html><script>"), "page.html"), null, "HTML refusé");
  assert.equal(t(new TextEncoder().encode("<html>"), "x.txt").type.startsWith("text/plain"), true, "texte : servi en text/plain (jamais HTML)");
  assert.equal(t(new Uint8Array([0x4d, 0x5a, 0x90, 0]), "virus.pdf"), null, "exécutable renommé .pdf : refusé");
  assert.equal(t(new Uint8Array([65, 0, 66]), "binaire.txt"), null, "octet nul : pas du texte");
  assert.equal(t(new Uint8Array(0), "vide.pdf"), null);
  // Noms : chemin, contrôles, extension corrigée selon le type réel, longueur.
  assert.equal(nomFichier("C:\\Users\\x\\capture.png", "jpg"), "capture.jpg");
  assert.equal(nomFichier("../../etc/passwd\u0007", "txt"), "passwd.txt");
  assert.equal(nomFichier("Photo.JPEG", "jpg"), "Photo.JPEG");
  assert.equal(nomFichier("rapport v2.final", "pdf"), "rapport v2.final.pdf");
  assert.equal(nomFichier("", "pdf"), "fichier.pdf");
  assert.ok(nomFichier("é".repeat(300) + ".pdf", "pdf").length <= 100 && nomFichier("é".repeat(300) + ".pdf", "pdf").endsWith(".pdf"));
  assert.equal(disposition("Été 2026.pdf", true), "inline; filename=\"Ete 2026.pdf\"; filename*=UTF-8''%C3%89t%C3%A9%202026.pdf");
  assert.match(disposition('a"b.txt', false), /^attachment; filename="a_b\.txt"/);
});

function formulaire(donnees, fichiers) {
  const fd = new FormData();
  fd.set("donnees", JSON.stringify(donnees));
  for (const [nom, octets, type] of fichiers) fd.append("fichier", new File([octets], nom, { type: type || "application/octet-stream" }));
  return fd;
}
async function envoyerFd(W, env, chemin, qui, fd) {
  const r = await W.fetch(new Request("https://belfort-api.exemple.workers.dev" + chemin, { method: "POST", headers: { Origin: ORIGINE, Authorization: "Bearer " + await jeton(qui) }, body: fd }), env);
  return { status: r.status, j: await r.json() };
}
async function lirePj(W, env, chemin, qui) {
  const r = await W.fetch(new Request("https://belfort-api.exemple.workers.dev" + chemin, { headers: { Origin: ORIGINE, Authorization: "Bearer " + await jeton(qui) } }), env);
  return r;
}

test("pièces jointes : envoi multipart (création et message), KV + D1, mail qui les liste, lecture réservée", async () => {
  const W = (await prete()).default, env = envAide({ AIDE_PJ: kv() });
  assert.equal((await appel(W, env, "/breteuil/aide/moi", { qui: FANNY })).j.pj, true, "capacité annoncée");
  assert.equal((await appel(W, env, "/breteuil/aide", { qui: FANNY })).j.pj, true);
  const r = await envoyerFd(W, env, "/breteuil/aide", FANNY, formulaire({ type: "probleme", message: "Voir la capture", ecran: "Planning" },
    [["capture.png", JPG, "image/png"], ["Devis été.pdf", PDF, "application/pdf"]]));
  assert.equal(r.status, 201, JSON.stringify(r.j));
  assert.deepEqual(r.j.pj.map((p) => [p.nom, p.type, p.apercu]), [["capture.jpg", "image/jpeg", true], ["Devis été.pdf", "application/pdf", false]]);
  // KV : clé pj/<demande>/<uuid>, métadonnées.
  const cles = [...env.AIDE_PJ.m.keys()];
  assert.equal(cles.length, 2); assert.match(cles[0], /^pj\/1\/[0-9a-f-]{36}$/);
  assert.deepEqual(Object.keys(env.AIDE_PJ.m.get(cles[0]).meta).sort(), ["auteur", "date", "nom", "taille", "type"]);
  // Mail : pièces listées avec lien vers l'appli, aucun octet joint.
  const x = lireMime(env.envoyes[0].raw);
  assert.ok(x.corps.includes("capture.jpg (") && x.corps.includes("#/aide/1/pj/1"), "texte : pièces + liens");
  assert.ok(x.html.includes("Devis été.pdf") && x.html.includes("#/aide/1/pj/2"), "HTML : pièces + liens");
  assert.doesNotMatch(env.envoyes[0].raw, /Content-Disposition: attachment/);
  // Fil : pièces sous le bon message.
  const fil = await appel(W, env, "/breteuil/aide/1", { qui: FANNY });
  assert.deepEqual(fil.j.messages[0].pj.map((p) => p.id), [1, 2]);
  // Lecture : demandeur et prestataire oui, autre personne non (404), sans jeton non (401), autre demande non.
  const ok = await lirePj(W, env, "/breteuil/aide/1/pj/1", FANNY);
  assert.equal(ok.status, 200); assert.equal(ok.headers.get("Content-Type"), "image/jpeg");
  assert.equal(ok.headers.get("Content-Disposition"), "inline; filename=\"capture.jpg\"; filename*=UTF-8''capture.jpg");
  assert.equal(ok.headers.get("X-Content-Type-Options"), "nosniff"); assert.match(ok.headers.get("Content-Security-Policy"), /sandbox/);
  assert.deepEqual(new Uint8Array(await ok.arrayBuffer()), JPG);
  assert.equal((await lirePj(W, env, "/breteuil/aide/1/pj/2", DAMIEN)).status, 200, "prestataire");
  assert.equal((await lirePj(W, env, "/breteuil/aide/1/pj/1", CAMILLE)).status, 404, "autre personne : 404");
  assert.equal((await W.fetch(new Request("https://x.dev/breteuil/aide/1/pj/1", { headers: { Origin: ORIGINE } }), env)).status, 401);
  await appel(W, env, "/breteuil/aide", { methode: "POST", qui: CAMILLE, corps: { type: "avis", message: "x" } });
  assert.equal((await lirePj(W, env, "/breteuil/aide/2/pj/1", CAMILLE)).status, 404, "pièce d'une autre demande via sa propre demande : 404");
  assert.equal((await lirePj(W, env, "/breteuil/aide/1/pj/abc", DAMIEN)).status, 404);
  // Message avec fichier seul (sans texte), côté prestataire aussi.
  const rep = await envoyerFd(W, env, "/breteuil/aide/1/messages", DAMIEN, formulaire({ texte: "" }, [["notes.txt", new TextEncoder().encode("Étapes : 1, 2, 3")]]));
  assert.equal(rep.status, 201); assert.equal(rep.j.pj[0].type, "text/plain; charset=utf-8");
  const t = await lirePj(W, env, "/breteuil/aide/1/pj/3", FANNY);
  assert.match(t.headers.get("Content-Disposition"), /^attachment;/, "texte : téléchargé, jamais affiché");
  // Message client avec fichier → mail « Nouveau message » qui le liste.
  await envoyerFd(W, env, "/breteuil/aide/1/messages", FANNY, formulaire({ texte: "Et le PDF" }, [["b.pdf", PDF]]));
  const dernier = lireMime(env.envoyes.at(-1).raw);
  assert.ok(dernier.html.includes("Nouveau message sur la demande n°1") && dernier.html.includes("b.pdf"));
});

test("pièces jointes : refus clairs (nombre, poids, type, non installées), quotas", async () => {
  const W = (await prete()).default, env = envAide({ AIDE_PJ: kv() });
  const post = (fichiers, qui = FANNY) => envoyerFd(W, env, "/breteuil/aide", qui, formulaire({ type: "avis", message: "x" }, fichiers));
  let r = await post(Array.from({ length: 6 }, (_, i) => ["p" + i + ".pdf", PDF]));
  assert.equal(r.status, 400); assert.equal(r.j.code, "trop_de_fichiers");
  r = await post([["gros.pdf", new Uint8Array(8 * 1024 * 1024 + 1).fill(37)]]);
  assert.equal(r.status, 413); assert.equal(r.j.code, "fichier_trop_lourd"); assert.match(r.j.erreur, /gros\.pdf.*8 Mo/);
  r = await post([["virus.pdf", new Uint8Array([0x4d, 0x5a, 1, 2])]]);
  assert.equal(r.j.code, "type_fichier"); assert.match(r.j.erreur, /virus\.pdf/);
  assert.equal((await appel(W, env, "/breteuil/aide", { qui: FANNY })).j.demandes.length, 0, "rien créé si un fichier est refusé");
  assert.equal(env.AIDE_PJ.m.size, 0);
  // Sans liaison AIDE_PJ : le reste marche, les fichiers sont refusés clairement, la capacité est annoncée « false ».
  const sans = envAide();
  assert.equal((await appel(W, sans, "/breteuil/aide", { methode: "POST", qui: FANNY, corps: { type: "avis", message: "sans fichier" } })).status, 201);
  const r2 = await envoyerFd(W, sans, "/breteuil/aide", FANNY, formulaire({ type: "avis", message: "x" }, [["a.pdf", PDF]]));
  assert.equal(r2.j.code, "pj_non_installees");
  // Quota par personne (40 / 24 h) ; le prestataire n'y est pas soumis.
  env.AIDE_DB.brut.exec("INSERT INTO pieces_jointes(demande_id, message_id, nom, type, taille, cle, cree_le, auteur) SELECT 1, 1, 'x', 'application/pdf', 1, 'k', '" + new Date().toISOString() + "', 'oid-fanny' FROM (WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 39) SELECT i FROM n)");
  r = await post([["a.pdf", PDF], ["b.pdf", PDF]]);
  assert.equal(r.status, 429); assert.equal(r.j.code, "trop_de_pj");
  assert.equal((await post([["a.pdf", PDF]], CAMILLE)).status, 201, "autre personne : permis");
  // Quota global (écritures KV gratuites).
  env.AIDE_DB.brut.exec("UPDATE pieces_jointes SET auteur = 'oid-autre'");
  env.AIDE_DB.brut.exec("INSERT INTO pieces_jointes(demande_id, message_id, nom, type, taille, cle, cree_le, auteur) SELECT 1, 1, 'x', 'application/pdf', 1, 'k', '" + new Date().toISOString() + "', 'oid-autre' FROM (WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 900) SELECT i FROM n)");
  r = await post([["a.pdf", PDF]], DAMIEN);
  assert.equal(r.status, 429); assert.equal(r.j.code, "quota_pj");
});

/* ---------- v5.6 : mail entrant avec pièces jointes, signature sans « -- » ---------- */
const b64l = (o) => Buffer.from(o).toString("base64").replace(/.{76}/g, "$&\r\n");
function reponseAvecPj(a, de, { texte = "Voici le devis signé.\r\n\r\nBELFORT Damien,\r\n06 00 00 00 00\r\n", gros = false, zip = false, six = false } = {}) {
  const pdfs = six ? Array.from({ length: 6 }, (_, i) => ["p" + i + ".pdf", PDF]) : [];
  return [
    `From: Damien <${de}>`, `To: ${a}`, "Subject: Re: demande", "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="mixte01"', "",
    "--mixte01", 'Content-Type: multipart/related; boundary="rel02"', "",
    "--rel02", 'Content-Type: multipart/alternative; boundary="alt03"', "",
    "--alt03", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: quoted-printable", "",
    texte + "Le lun. 19 oct. 2026 =C3=A0 10:00, Espace Breteuil a =C3=A9crit :", "> cité", "",
    "--alt03", 'Content-Type: text/html; charset="UTF-8"', "", "<div>Voici le devis sign&eacute;.</div>", "",
    "--alt03--", "",
    "--rel02", "Content-Type: image/png; name=\"logo.png\"", "Content-Disposition: inline; filename=\"logo.png\"", "Content-ID: <ii_logo>", "Content-Transfer-Encoding: base64", "",
    b64l(PNG), "",
    "--rel02--", "",
    "--mixte01", "Content-Type: application/pdf; name=\"=?UTF-8?B?RGV2aXMgw6l0w6kucGRm?=\"", "Content-Disposition: attachment; filename*=UTF-8''Devis%20%C3%A9t%C3%A9.pdf", "Content-Transfer-Encoding: base64", "",
    b64l(PDF), "",
    "--mixte01", "Content-Type: image/jpeg; name=\"=?UTF-8?Q?Capture_=C3=A9cran.jpg?=\"", "Content-Disposition: attachment", "Content-Transfer-Encoding: base64", "",
    b64l(JPG), "",
    ...(gros ? ["--mixte01", "Content-Type: application/pdf; name=\"plan.pdf\"", "Content-Disposition: attachment; filename=\"plan.pdf\"", "Content-Transfer-Encoding: base64", "",
      b64l(Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(9 * 1024 * 1024, 65)])), ""] : []),
    ...(zip ? ["--mixte01", "Content-Type: application/zip; name=\"photos.zip\"", "Content-Disposition: attachment; filename=\"photos.zip\"", "Content-Transfer-Encoding: base64", "",
      b64l(Buffer.from("PK\x03\x04zzzz")), ""] : []),
    ...pdfs.flatMap(([n, o]) => ["--mixte01", `Content-Type: application/pdf; name="${n}"`, `Content-Disposition: attachment; filename="${n}"`, "Content-Transfer-Encoding: base64", "", b64l(o), ""]),
    "--mixte01--", "",
  ].join("\r\n");
}

test("mail entrant : extraction des pièces jointes (RFC 2231 / 2047, imbriquées), logo de signature ignoré", async () => {
  const mod = await charger();
  const { texte, pieces } = mod.analyserMail(reponseAvecPj("a@x.fr", "d@x.fr"));
  assert.equal(texte.type, "text/plain");
  assert.deepEqual(pieces.map((p) => [p.nom, p.typeDeclare, p.inline, p.taille]), [
    ["logo.png", "image/png", true, PNG.length], ["Devis été.pdf", "application/pdf", false, PDF.length], ["Capture écran.jpg", "image/jpeg", false, JPG.length]]);
  assert.deepEqual(pieces[1].octets, PDF);
  const tri = mod.trierPiecesMail(pieces);
  assert.deepEqual(tri.gardees.map((g) => g.nom), ["Devis été.pdf", "Capture écran.jpg"], "logo inline < 5 Ko ignoré");
  assert.deepEqual(tri.notes, []);
  const gros = mod.trierPiecesMail(mod.analyserMail(reponseAvecPj("a@x.fr", "d@x.fr", { gros: true, zip: true })).pieces);
  assert.deepEqual(gros.notes, ["Pièce jointe ignorée : trop lourde (plan.pdf, 9 Mo)", "Pièce jointe ignorée : type non accepté (photos.zip)"]);
  const six = mod.trierPiecesMail(mod.analyserMail(reponseAvecPj("a@x.fr", "d@x.fr", { six: true })).pieces);
  assert.equal(six.gardees.length, 5); assert.equal(six.notes.length, 3, "au-delà de 5 : ignorées avec une note");
  assert.deepEqual(mod.trierPiecesMail(pieces, false).notes, ["Pièce jointe ignorée : pièces jointes non installées (Devis été.pdf)", "Pièce jointe ignorée : pièces jointes non installées (Capture écran.jpg)"]);
  assert.equal(mod.decoderMots("=?UTF-8?Q?R=C3=A9ponse_rapide?= =?UTF-8?B?w6l0w6k=?="), "Réponse rapideété");
});

test("mail entrant : réponse avec pièces jointes → fil + KV ; signature AIDE_SIGNATURE retirée ; notes d'ignorées", async () => {
  const mod = await prete(), W = mod.default, env = envAide({ AIDE_PJ: kv(), AIDE_SIGNATURE: "BELFORT Damien,|06 00 00 00 00" });
  await appel(W, env, "/breteuil/aide", { methode: "POST", qui: FANNY, corps: { type: "probleme", message: "Devis ?" } });
  const a = `demande+1-${await mod.signature(env.AIDE_SECRET, 1)}@aide.exemple.fr`;
  const m = mailEntrant(a, PRESTA, reponseAvecPj(a, PRESTA, { zip: true }));
  await W.email(m, env, {});
  assert.equal(m.rejet, null);
  const fil = await appel(W, env, "/breteuil/aide/1", { qui: FANNY });
  const dernier = fil.j.messages.at(-1);
  assert.equal(dernier.texte, "Voici le devis signé.\n\n(Pièce jointe ignorée : type non accepté (photos.zip))", "signature et citation retirées, note ajoutée");
  assert.deepEqual(dernier.pj.map((p) => [p.nom, p.type]), [["Devis été.pdf", "application/pdf"], ["Capture écran.jpg", "image/jpeg"]]);
  assert.equal(env.AIDE_PJ.m.size, 2);
  assert.equal((await lirePj(W, env, "/breteuil/aide/1/pj/" + dernier.pj[0].id, FANNY)).status, 200);
  // Pièce jointe seule, sans texte : acceptée.
  const seul = mailEntrant(a, PRESTA, reponseAvecPj(a, PRESTA, { texte: "\r\n" }));
  await W.email(seul, env, {});
  assert.equal(seul.rejet, null);
  // Sans liaison AIDE_PJ : texte gardé, note « non installées ».
  const env2 = envAide({ AIDE_SIGNATURE: "BELFORT Damien,\n06 00 00 00 00" });
  await appel(W, env2, "/breteuil/aide", { methode: "POST", qui: FANNY, corps: { type: "avis", message: "x" } });
  const m2 = mailEntrant(a, PRESTA, reponseAvecPj(a, PRESTA));
  await W.email(m2, env2, {});
  assert.match((await appel(W, env2, "/breteuil/aide/1", { qui: FANNY })).j.messages.at(-1).texte, /^Voici le devis signé\.\n\n\(Pièce jointe ignorée : pièces jointes non installées \(Devis été\.pdf\)\)/);
});

test("signature sans délimiteur : retirée seulement en fin de message, lignes vides de fin retirées", async () => {
  const { sansCitation, retirerSignature } = await charger();
  const SIG = "BELFORT Damien,|06 09 00 00 00";
  assert.equal(sansCitation("C'est fait.\n\nBELFORT Damien,\n06 09 00 00 00\n\n\n", SIG), "C'est fait.");
  assert.equal(sansCitation("C'est fait.\nBelfort damien\n06 09 00 00 00", SIG), "C'est fait.", "casse, virgule et espaces ignorés");
  assert.equal(sansCitation("C'est fait.\n0609000000", SIG), "C'est fait.", "téléphone sans espaces");
  assert.equal(sansCitation("BELFORT Damien, voici la réponse.\nMerci", SIG), "BELFORT Damien, voici la réponse.\nMerci", "pas en fin : gardé");
  assert.equal(sansCitation("Appelez le 06 09 00 00 00 si besoin.\nBonne journée", SIG), "Appelez le 06 09 00 00 00 si besoin.\nBonne journée");
  assert.equal(retirerSignature("Ok\n\n\n", ""), "Ok", "sans variable : lignes vides de fin retirées");
  assert.equal(retirerSignature("Ok\nBELFORT Damien,", "BELFORT Damien,\\n06 09 00 00 00"), "Ok", "« \\n » littéral accepté");
  assert.equal(sansCitation("Merci !\n-- \nDamien Belfort", SIG), "Merci !", "« -- » toujours géré");
});
