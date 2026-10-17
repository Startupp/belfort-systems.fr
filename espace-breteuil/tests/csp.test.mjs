// La CSP de _headers autorise-t-elle tout ce dont l'appli a besoin ? node --test espace-breteuil/tests/csp.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ici = new URL("../", import.meta.url);
const entetes = readFileSync(new URL("_headers", ici), "utf8");
const csp = /Content-Security-Policy:\s*(.+)/.exec(entetes)[1];
const directive = (nom) => (new RegExp("(?:^|;)\\s*" + nom + "\\s+([^;]+)").exec(csp) || [, ""])[1].trim().split(/\s+/);
const bac = { self: {} };
vm.runInNewContext(readFileSync(new URL("config.js", ici), "utf8"), bac);
const CFG = bac.self.EB_CONFIG;

/** Une origine est-elle couverte par une liste de sources CSP (gère *.domaine) ? */
function autorise(sources, url) {
  const u = new URL(url);
  return sources.some((s) => {
    if (s === "'self'") return false;
    const m = /^https:\/\/\*\.(.+)$/.exec(s);
    if (m) return u.protocol === "https:" && u.hostname.endsWith("." + m[1]);
    return new URL(s).origin === u.origin;
  });
}

test("connect-src : Worker, connexion Microsoft, Graph, SharePoint du Château et OneDrive", () => {
  const c = directive("connect-src");
  for (const url of [CFG.api, "https://login.microsoftonline.com/breteuil02.onmicrosoft.com/oauth2/v2.0/token", "https://graph.microsoft.com/v1.0/me",
    CFG.sharepoint.site + "/_api/web/currentuser", new URL(CFG.microsoft.sharepointScope).origin, "https://breteuil02-my.sharepoint.com/personal/x"]) {
    assert.ok(autorise(c, url), "connect-src doit autoriser " + url);
  }
  assert.ok(c.includes("https://login.microsoftonline.com"), "login.microsoftonline.com écrit en clair");
  assert.ok(c.includes("https://breteuil02-my.sharepoint.com"), "breteuil02-my.sharepoint.com écrit en clair");
});

test("frame-src : renouvellement silencieux MSAL ; scripts uniquement locaux ; pas d'iframe chez autrui", () => {
  assert.ok(autorise(directive("frame-src"), "https://login.microsoftonline.com/x"));
  assert.deepEqual(directive("script-src"), ["'self'"]);
  assert.deepEqual(directive("frame-ancestors"), ["'none'"]);
  assert.ok(directive("img-src").includes("blob:"), "photos de profil Graph (blob:)");
  assert.match(entetes, /Cross-Origin-Opener-Policy: same-origin-allow-popups/, "COOP compatible avec la connexion par fenêtre");
});

test("config.js : aucun secret, clientId vide par défaut", () => {
  const brut = readFileSync(new URL("config.js", ici), "utf8");
  assert.doesNotMatch(brut, /secret\s*[:=]\s*"[^"]+"/i);
  assert.equal(typeof CFG.microsoft.clientId, "string");
});
