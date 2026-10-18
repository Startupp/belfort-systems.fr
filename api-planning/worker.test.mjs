// Tests du Worker minimal belfort-api (planning + vérificateur de liens), sans réseau :
//   node api-planning/worker.test.mjs
// fetch et caches.default sont remplacés par des maquettes ; chaque test charge une copie neuve du Worker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
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
  const appels = [];
  const f = async (url, init = {}) => {
    const methode = (init.method || "GET").toUpperCase();
    appels.push(methode + " " + url);
    const def = table[url];
    if (!def) throw new TypeError("réseau : " + url);
    const r = typeof def === "function" ? def(methode) : def;
    if (r instanceof Error) throw r;
    const corps = r.corps ?? "";
    return { ok: r.status >= 200 && r.status < 300, status: r.status, url: r.url || url, headers: new Headers({ "Content-Type": r.type || "text/html; charset=UTF-8" }),
      text: async () => corps, body: methode === "HEAD" ? null : { cancel: async () => {} } };
  };
  f.appels = appels;
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
  for (const l of j.liens) assert.deepEqual(Object.keys(l).sort(), ["ok", "page", "redirigeVers", "statut", "texte", "url"]);
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
