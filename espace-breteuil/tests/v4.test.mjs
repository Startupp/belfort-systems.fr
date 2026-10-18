// Garde-fous de la v4 (sans navigateur) : node --test espace-breteuil/tests/v4.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const lire = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

test("aucune permission Microsoft nouvelle à la connexion (ni mail, ni écriture d'agenda)", () => {
  const ctx = { self: {} }; vm.runInNewContext(lire("config.js"), ctx);
  const m = ctx.self.EB_CONFIG.microsoft;
  assert.deepEqual([...m.scopes].sort(), ["Directory.Read.All", "Files.ReadWrite.All", "Sites.ReadWrite.All", "User.Read", "User.Read.All", "User.ReadBasic.All"]);
  assert.ok(!m.scopes.some((s) => /Mail|Calendars|RoleManagement/i.test(s)), "RoleManagement seulement à la demande (Déléguer)");
  const code = ["app.js", "connecte.js", "acces.js", "fichiers.js", "epingles.js", "graph.js"].map(lire).join("\n");
  assert.doesNotMatch(code, /Mail\.(Read|Send)|Calendars\.ReadWrite|\/messages|sendMail/);
});

test("boîtes partagées proposées à l'épinglage : 6 adresses valides", () => {
  const j = JSON.parse(lire("boites-partagees.json"));
  assert.deepEqual(j.boites.map((b) => b.id), ["contact", "finance", "restauration", "marketing", "jardins", "intendance"]);
  for (const b of j.boites) assert.match(b.adresse, /^[a-z]+@breteuil\.fr$/);
});

test("tous les scripts de index.html sont dans la coquille hors ligne (sw.js)", () => {
  const sw = lire("sw.js");
  const scripts = [...lire("index.html").matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  for (const s of scripts) assert.ok(sw.includes('"./' + s + '"'), s);
  assert.ok(sw.includes('"./boites-partagees.json"'));
});

test("version 4.x ou 5.x", () => { assert.match(lire("version.js"), /EB_VERSION = "[45]\.\d+\.\d+"/); });
