// Tests de la traduction des erreurs Microsoft : node --test espace-breteuil/tests/erreurs.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const E = require("../erreurs.js");

test("AADSTS : consentement, redirection, non affecté, mauvaise plateforme", () => {
  const c = E.expliquer({ errorCode: "invalid_grant", errorMessage: "AADSTS65001: The user or administrator has not consented to use the application" });
  assert.equal(c.code, "AADSTS65001");
  assert.equal(c.qui, "François");
  assert.match(c.action, /consentement d'administrateur/);
  const r = E.expliquer({ errorMessage: "AADSTS50011: The redirect URI 'https://espace-breteuil.pages.dev/' specified in the request does not match" });
  assert.equal(r.code, "AADSTS50011");
  assert.match(r.action, /monopage/);
  const n = E.expliquer({ errorMessage: "AADSTS50105: Your administrator has configured the application to block users unless they are specifically granted ('assigned') access" });
  assert.equal(n.code, "AADSTS50105");
  assert.match(n.action, /Utilisateurs et groupes/);
  assert.equal(E.expliquer({ errorMessage: "AADSTS9002326: Cross-origin token redemption is permitted only for the 'Single-Page Application' client-type" }).code, "AADSTS9002326");
  assert.equal(E.expliquer({ errorMessage: "AADSTS700016: Application with identifier 'x' was not found" }).code, "AADSTS700016");
});

test("MSAL : annulation, popup bloquée, réseau", () => {
  assert.equal(E.expliquer({ errorCode: "user_cancelled" }).code, "user_cancelled");
  assert.equal(E.expliquer({ errorCode: "popup_window_error" }).code, "popup_window_error");
  const x = E.expliquer({ errorCode: "no_network_connectivity" });
  assert.equal(x.code, "reseau");
  assert.equal(x.reessayer, true);
});

test("HTTP Graph et SharePoint : 401, 403, 404 site, 429", () => {
  assert.equal(E.expliquer({ statut: 401, ressource: "graph" }).qui, "vous");
  assert.match(E.expliquer({ statut: 401, ressource: "sp" }).action, /AllSites\.FullControl/);
  const p = E.expliquer({ statut: 403, ressource: "graph", codeGraph: "Authorization_RequestDenied", detail: "Insufficient privileges to complete the operation." });
  assert.equal(p.qui, "François");
  assert.match(p.titre, /permission/);
  assert.match(E.expliquer({ statut: 403, ressource: "sp", detail: "Access denied." }).action, /Propriétaire/);
  assert.match(E.expliquer({ statut: 404, ressource: "graph" }, { site: true }).titre, /site SharePoint/);
  assert.match(E.expliquer({ statut: 404, ressource: "graph" }, { dossier: true }).action, /dossierCommun/);
  const q = E.expliquer({ statut: 429, ressource: "graph" });
  assert.equal(q.reessayer, true);
  assert.equal(q.code, "HTTP 429");
});

test("CORS : fetch refusé vers SharePoint, ou hors ligne", () => {
  const c = E.expliquer({ cors: true, ressource: "sp", message: "TypeError: Failed to fetch" });
  assert.equal(c.code, "CORS");
  assert.equal(E.expliquer({ cors: true, ressource: "sp", message: "Failed to fetch" }, { horsLigne: true }).code, "hors_ligne");
  assert.equal(E.expliquer({ cors: true, ressource: "graph", message: "Failed to fetch" }).code, "reseau");
});

test("nettoyage : ni jeton ni adresse complète dans le détail", () => {
  const d = E.expliquer({ statut: 403, ressource: "sp", detail: "Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF_ghi refusé pour pdebreteuil@breteuil.fr" }).detail;
  assert.doesNotMatch(d, /eyJ/);
  assert.doesNotMatch(d, /pdebreteuil@/);
  assert.match(d, /p•••@breteuil\.fr/);
  assert.equal(E.masquerAdresse("pdebreteuil@breteuil.fr"), "p•••@breteuil.fr");
});

test("délai de réessai : Retry-After en secondes, borné, sinon exponentiel", () => {
  assert.equal(E.delaiReessai("3", 0), 3000);
  assert.equal(E.delaiReessai("120", 0), 10000);
  assert.equal(E.delaiReessai(null, 0), 1000);
  assert.equal(E.delaiReessai(null, 2), 4000);
});
