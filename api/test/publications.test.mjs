// Tests unitaires des vues « Publications » et « Premier contact » : routes appelées directement
// avec un GitHub simulé (fetch remplacé) et des bases D1 factices. Sans réseau ni wrangler.
//   node --test api/test/publications.test.mjs
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { _interne as W } from "../src/index.js";

const { resoudre, brancheNormalisee, urlApercuPages, ErreurHttp } = W;

function handler(methode, chemin) {
  const r = resoudre(methode, chemin);
  assert.ok(r.route, `route ${methode} ${chemin}`);
  assert.equal(r.route.acces, "admin", "route protégée");
  return (ctx) => r.route.handler({ qui: "admin", params: r.params, ...ctx });
}

/** D1 factice : `reponses` associe un fragment de SQL à {results} ou à une fonction (sql, binds) → résultat. */
function d1(reponses) {
  const appels = [];
  const stmt = (sql) => {
    let binds = [];
    const executer = () => {
      appels.push({ sql, binds });
      for (const [frag, rep] of Object.entries(reponses)) if (sql.includes(frag)) return typeof rep === "function" ? rep(sql, binds) : rep;
      return { results: [], meta: { changes: 0 } };
    };
    const s = {
      bind: (...b) => { binds = b; return s; },
      all: async () => executer(),
      first: async () => (executer().results || [])[0] || null,
      run: async () => executer(),
    };
    return s;
  };
  return { prepare: stmt, batch: async (stmts) => Promise.all(stmts.map((s) => s.all())), appels };
}

const fetchOrigine = globalThis.fetch;
let requetes;
function githubSimule(reponses) {
  requetes = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    requetes.push({ url: u.pathname + u.search, methode: init.method || "GET", entetes: init.headers || {}, corps: init.body ? JSON.parse(init.body) : null });
    const cle = (init.method || "GET") + " " + u.pathname;
    const rep = reponses[cle];
    if (!rep) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    return new Response(JSON.stringify(rep.corps), { status: rep.statut || 200 });
  };
}
beforeEach(() => { requetes = []; });
afterEach(() => { globalThis.fetch = fetchOrigine; });

const PR = (n, extra = {}) => ({ number: n, title: "Titre " + n, state: "open", draft: false, created_at: "2026-10-18T10:00:00Z", updated_at: "2026-10-19T08:00:00Z",
  html_url: "https://github.com/Startupp/belfort-systems.fr/pull/" + n, head: { ref: "feat/Bloc_Pour-qui" }, base: { ref: "main" }, user: { login: "Startupp" }, ...extra });

test("brancheNormalisee / urlApercuPages : minuscules, tirets", () => {
  assert.equal(brancheNormalisee("feat/Bloc_Pour-qui"), "feat-bloc-pour-qui");
  assert.equal(urlApercuPages("fix/pied.de.page"), "https://fix-pied-de-page.belfort-systems-fr.pages.dev");
});

test("GET /admin/publications sans jeton : configure:false, aucun appel GitHub", async () => {
  githubSimule({});
  const r = await handler("GET", "/admin/publications")({ env: {} });
  assert.deepEqual(r, { configure: false, depot: "Startupp/belfort-systems.fr", pulls: [] });
  assert.equal(requetes.length, 0);
});

test("GET /admin/publications : liste des PR ouvertes avec aperçu Pages", async () => {
  githubSimule({ "GET /repos/Startupp/belfort-systems.fr/pulls": { corps: [PR(42), PR(40, { draft: true, head: { ref: "feat/grille-2027" } })] } });
  const r = await handler("GET", "/admin/publications")({ env: { GITHUB_TOKEN: "jeton-de-test" } });
  assert.equal(r.configure, true);
  assert.equal(r.pulls.length, 2);
  assert.equal(r.pulls[0].numero, 42);
  assert.equal(r.pulls[0].branche, "feat/Bloc_Pour-qui");
  assert.equal(r.pulls[0].apercu, "https://feat-bloc-pour-qui.belfort-systems-fr.pages.dev");
  assert.equal(r.pulls[1].brouillon, true);
  assert.ok(requetes[0].url.includes("state=open"));
  assert.equal(requetes[0].entetes.Authorization, "Bearer jeton-de-test");
  assert.equal(requetes[0].entetes["X-GitHub-Api-Version"], "2022-11-28");
});

test("GET /admin/publications : jeton refusé par GitHub → 502 explicite", async () => {
  githubSimule({ "GET /repos/Startupp/belfort-systems.fr/pulls": { statut: 401, corps: { message: "Bad credentials" } } });
  await assert.rejects(handler("GET", "/admin/publications")({ env: { GITHUB_TOKEN: "x" } }), (e) => e instanceof ErreurHttp && e.code === 502 && /jeton/.test(e.message));
});

test("POST /admin/publications/:numero/fusionner : fusion merge + journal", async () => {
  githubSimule({
    "GET /repos/Startupp/belfort-systems.fr/pulls/42": { corps: PR(42) },
    "PUT /repos/Startupp/belfort-systems.fr/pulls/42/merge": { corps: { sha: "abc123", merged: true } },
  });
  const DB = d1({});
  const r = await handler("POST", "/admin/publications/42/fusionner")({ env: { GITHUB_TOKEN: "x", DB } });
  assert.equal(r.fusionne, true);
  assert.equal(r.sha, "abc123");
  assert.equal(r.numero, 42);
  const fusion = requetes.find((q) => q.methode === "PUT");
  assert.deepEqual(fusion.corps, { merge_method: "merge" });
  assert.ok(DB.appels.some((a) => a.sql.includes("INSERT INTO journal") && a.binds.includes("publications:42")), "journalisé");
});

test("POST …/fusionner : refus sans jeton, brouillon, PR fermée, conflit", async () => {
  githubSimule({
    "GET /repos/Startupp/belfort-systems.fr/pulls/40": { corps: PR(40, { draft: true }) },
    "GET /repos/Startupp/belfort-systems.fr/pulls/39": { corps: PR(39, { state: "closed" }) },
    "GET /repos/Startupp/belfort-systems.fr/pulls/38": { corps: PR(38) },
    "PUT /repos/Startupp/belfort-systems.fr/pulls/38/merge": { statut: 405, corps: { message: "Pull Request is not mergeable" } },
  });
  const DB = d1({});
  const f = (n, env) => handler("POST", `/admin/publications/${n}/fusionner`)({ env });
  await assert.rejects(f(42, { DB }), (e) => e.code === 503 && /non configuré/.test(e.message));
  await assert.rejects(f(40, { GITHUB_TOKEN: "x", DB }), (e) => e.code === 409 && /brouillon/.test(e.message));
  await assert.rejects(f(39, { GITHUB_TOKEN: "x", DB }), (e) => e.code === 409);
  await assert.rejects(f(38, { GITHUB_TOKEN: "x", DB }), (e) => e.code === 409 && /mergeable/.test(e.message));
  await assert.rejects(f(77, { GITHUB_TOKEN: "x", DB }), (e) => e.code === 404);
  assert.equal(DB.appels.filter((a) => a.sql.includes("journal")).length, 0, "rien journalisé en cas de refus");
});

test("GET /admin/premier-contact : messages de belfort_contact + statut de contacts_suivi", async () => {
  const CONTACTS = d1({ "FROM contacts ORDER BY recu_le": { results: [
    { id: 7, recu_le: "2026-10-19T17:48:12.000Z", nom: "Nadia", email: "n@exemple.fr", tel: "06 45 67 89 01", sujet: "M365", formule: "", message: "Bonjour", creneau: null, origine: "https://belfort-systems.fr" },
    { id: 6, recu_le: "2026-10-18T09:00:00.000Z", nom: "Marc", email: "m@exemple.fr", tel: null, sujet: null, formule: null, message: "Aide", creneau: null, origine: null },
  ] } });
  const DB = d1({ "FROM contacts_suivi": { results: [{ contact_id: 6, statut: "repondu", note: "Devis envoyé", maj: "2026-10-18T12:00:00.000Z" }] } });
  const r = await handler("GET", "/admin/premier-contact")({ env: { DB, CONTACTS } });
  assert.equal(r.messages.length, 2);
  assert.equal(r.messages[0].statut, "nouveau");
  assert.equal(r.messages[1].statut, "repondu");
  assert.equal(r.messages[1].note, "Devis envoyé");
  await assert.rejects(handler("GET", "/admin/premier-contact")({ env: { DB } }), (e) => e.code === 503 && /CONTACTS/.test(e.message));
});

test("PATCH /admin/premier-contact/:id : statut validé, upsert dans contacts_suivi, message inconnu → 404", async () => {
  const CONTACTS = d1({ "SELECT id FROM contacts WHERE id": (sql, b) => ({ results: b[0] === 7 ? [{ id: 7 }] : [] }) });
  const DB = d1({ "FROM contacts_suivi WHERE contact_id": { results: [{ id: 7, statut: "lu", note: null, suivi_le: "x" }] } });
  const req = (corps) => ({ headers: new Headers(), text: async () => JSON.stringify(corps) });
  const r = await handler("PATCH", "/admin/premier-contact/7")({ env: { DB, CONTACTS }, req: req({ statut: "lu" }) });
  assert.equal(r.statut, "lu");
  const ins = DB.appels.find((a) => a.sql.includes("INSERT INTO contacts_suivi"));
  assert.ok(ins && ins.binds[0] === 7 && ins.binds[1] === "lu");
  await assert.rejects(handler("PATCH", "/admin/premier-contact/7")({ env: { DB, CONTACTS }, req: req({ statut: "archive" }) }), (e) => e.code === 400);
  await assert.rejects(handler("PATCH", "/admin/premier-contact/7")({ env: { DB, CONTACTS }, req: req({}) }), (e) => e.code === 400);
  await assert.rejects(handler("PATCH", "/admin/premier-contact/99")({ env: { DB, CONTACTS }, req: req({ statut: "lu" }) }), (e) => e.code === 404);
});
