// Tests de l'écran « Vérifier la connexion » (logique) : node --test espace-breteuil/tests/diagnostic.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const D = require("../diagnostic.js");
const E = require("../erreurs.js");

const CFG = {
  microsoft: {
    clientId: "11111111-2222-3333-4444-555555555555", tenantId: "breteuil02.onmicrosoft.com",
    scopes: ["User.Read", "User.ReadBasic.All", "User.Read.All", "Directory.Read.All", "Files.ReadWrite.All", "Sites.ReadWrite.All"],
    sharepointScope: "https://breteuil02.sharepoint.com/AllSites.FullControl",
  },
  sharepoint: { site: "https://breteuil02.sharepoint.com/sites/ChateaudeBreteuil", dossierCommun: "Commun" },
  domainesInternes: ["breteuil.fr", "breteuil02.onmicrosoft.com"],
};
// Low avec le bit 24 (ManagePermissions) : 2^24 + quelques autres droits.
const LOW_GERER = String(Math.pow(2, 24) + 0xFFFF);

function httpErr(statut, ressource, codeGraph, detail) {
  const x = E.expliquer({ statut, ressource, codeGraph, detail });
  return Object.assign(new Error(x.titre), { statut, ressource, codeGraph, detail, explication: x });
}

/** Faux client Graph/SharePoint : réponses par défaut « tout vert », surcharges par scénario. */
function fauxG(sur = {}) {
  const rep = {
    "graph /me": { id: "moi", displayName: "Pauline de Breteuil" },
    "graph /users": { value: [{ id: "u1" }] },
    "graph /subscribedSkus": { value: [{ skuId: "a" }, { skuId: "b" }] },
    "graph /directoryRoles": { value: [] },
    "graph /sites/": { id: "site1", displayName: "Château de Breteuil" },
    "graph /sites/site1/drive": { id: "drive1", name: "Documents" },
    "graph /drives/drive1/root:/Commun": { id: "c1", name: "Commun", folder: { childCount: 12 } },
    "sp /_api/web/currentuser": { Id: 7, Email: "pdebreteuil@breteuil.fr", IsSiteAdmin: false },
    "sp /_api/web/associatedownergroup/users": { value: [{ Id: 7, Email: "pdebreteuil@breteuil.fr" }] },
    "sp /_api/web/effectivebasepermissions": { High: "432", Low: LOW_GERER },
    ...sur.rep,
  };
  function repondre(res, chemin) {
    const cle = Object.keys(rep).filter((k) => { const [r, c] = k.split(" "); return r === res && chemin.split("?")[0].startsWith(c); })
      .sort((a, b) => b.length - a.length)[0];
    const v = rep[cle];
    if (v instanceof Error) return Promise.reject(v);
    return Promise.resolve(typeof v === "function" ? v() : v);
  }
  return {
    estMaquette: () => false,
    estConfigure: () => true,
    estConnecte: () => sur.connecte !== false,
    erreurDetail: () => sur.erreurConnexion || null,
    compte: () => ({ username: "pdebreteuil@breteuil.fr", name: "Pauline" }),
    scopesAccordes: (r) => Promise.resolve(r === "sp" ? (sur.scopesSp || ["AllSites.FullControl"]) : (sur.scopesGraph || CFG.microsoft.scopes)),
    jeton: () => (sur.erreurJetonSp ? Promise.reject(sur.erreurJetonSp) : Promise.resolve(true)),
    graph: (m, c) => repondre("graph", c),
    sp: (m, c) => repondre("sp", c),
  };
}
const statuts = (res) => Object.fromEntries(res.map((x) => [x.id, x.statut]));

test("tout vert", async () => {
  const res = await D.executer(fauxG(), CFG);
  assert.ok(res.every((x) => x.statut === "vert"), JSON.stringify(statuts(res)));
  assert.equal(D.bilan(res).statut, "vert");
});

test("clientId vide : rouge dès la configuration, le reste n'est pas testé", async () => {
  const cfg = { ...CFG, microsoft: { ...CFG.microsoft, clientId: "" } };
  const res = await D.executer(fauxG(), cfg);
  assert.equal(res[0].statut, "rouge");
  assert.match(res[0].action, /config\.js/);
  assert.ok(res.slice(1).every((x) => x.statut === "gris"));
});

test("pas connecté : orange, puis rien d'autre", async () => {
  const res = await D.executer(fauxG({ connecte: false }), CFG);
  assert.equal(statuts(res).connexion, "orange");
  assert.equal(statuts(res).me, "gris");
});

test("erreur de connexion AADSTS50105 : rouge avec l'action d'affectation", async () => {
  const x = E.expliquer({ errorMessage: "AADSTS50105: not assigned" });
  const res = await D.executer(fauxG({ connecte: false, erreurConnexion: x }), CFG);
  assert.equal(statuts(res).connexion, "rouge");
  assert.match(res[1].action, /Utilisateurs et groupes/);
});

test("consentement manquant : User.Read.All absent du jeton et jeton SharePoint refusé", async () => {
  const res = await D.executer(fauxG({
    scopesGraph: ["User.Read", "User.ReadBasic.All"],
    rep: { "graph /users": httpErr(403, "graph", "Authorization_RequestDenied", "Insufficient privileges to complete the operation.") },
    erreurJetonSp: Object.assign(new Error("x"), { errorCode: "invalid_grant", errorMessage: "AADSTS65001: The user or administrator has not consented" }),
  }), CFG);
  const s = statuts(res);
  assert.equal(s.scopes, "orange");
  assert.match(res.find((x) => x.id === "scopes").texte, /User\.Read\.All/);
  assert.equal(s.users, "rouge");
  assert.equal(s.jetonsp, "rouge");
  assert.match(res.find((x) => x.id === "jetonsp").action, /consentement d'administrateur/);
  assert.equal(s.rest, "gris");
  assert.equal(D.bilan(res).statut, "rouge");
});

test("CORS refusé : jeton SharePoint OK mais REST bloqué", async () => {
  const cors = Object.assign(new Error("Failed to fetch"), { cors: true, ressource: "sp" });
  const res = await D.executer(fauxG({ rep: { "sp /_api/web/currentuser": cors } }), CFG);
  const s = statuts(res);
  assert.equal(s.jetonsp, "vert");
  assert.equal(s.rest, "rouge");
  assert.equal(res.find((x) => x.id === "rest").code, "CORS");
  assert.equal(s.proprietaire, "gris");
  assert.equal(s.gerer, "gris");
});

test("non propriétaire : orange, et ManagePermissions absent", async () => {
  const res = await D.executer(fauxG({ rep: {
    "sp /_api/web/associatedownergroup/users": { value: [{ Id: 3, Email: "fdebreteuil@breteuil.fr" }] },
    "sp /_api/web/effectivebasepermissions": { High: "432", Low: "1011030767" },
  } }), CFG);
  const s = statuts(res);
  assert.equal(s.proprietaire, "orange");
  assert.equal(s.gerer, "orange");
  assert.equal(D.bilan(res).statut, "orange");
});

test("site introuvable : rouge, Documents et Commun pas testés", async () => {
  const res = await D.executer(fauxG({ rep: { "graph /sites/": httpErr(404, "graph", "itemNotFound", "Requested site could not be found") } }), CFG);
  const s = statuts(res);
  assert.equal(s.site, "rouge");
  assert.match(res.find((x) => x.id === "site").action, /config\.js/);
  assert.equal(s.documents, "gris");
});

test("rapport : bilan, étapes, aucun jeton ni adresse complète", async () => {
  const res = await D.executer(fauxG({ rep: { "sp /_api/web/currentuser": Object.assign(new Error("Failed"), { cors: true, ressource: "sp", detail: "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig pdebreteuil@breteuil.fr" }) } }), CFG);
  const t = D.rapport(res, { version: "2.1.0", adresse: "https://espace-breteuil.pages.dev/", appareil: "iPhone · Safari · navigateur", date: "17/10/2026 20:00" });
  assert.match(t, /Bilan : ❌/);
  assert.match(t, /12\. Dialogue direct avec SharePoint/);
  assert.doesNotMatch(t, /eyJ/);
  assert.doesNotMatch(t, /pdebreteuil@/);
  assert.match(t, /p•••@breteuil\.fr/);
});

test("outils : bit ManagePermissions, permissions manquantes, appareil", () => {
  assert.equal(D.aLeBit(LOW_GERER, "0", 24), true);
  assert.equal(D.aLeBit("1011030767", "0", 24), false);
  assert.deepEqual(D.manquantes(["User.Read", "https://x.sharepoint.com/AllSites.FullControl"], ["user.read"]), ["AllSites.FullControl"]);
  assert.equal(D.appareil("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Version/18.0 Mobile Safari/604.1", true), "iPhone · Safari · appli installée");
  assert.equal(D.appareil("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36 Edg/130", false), "Windows · Edge · navigateur");
});
