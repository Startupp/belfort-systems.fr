// Vérification visuelle de l'écran « Vérifier la connexion » en mode maquette (aucune connexion réelle).
// Lancer depuis la racine du dépôt :
//   NODE_PATH=$(npm root -g) node espace-breteuil/tests/diagnostic.playwright.mjs [dossier-captures]
// Scénarios : tout vert, consentement manquant, CORS refusé, non propriétaire (+ onglet Plus).
// Les réponses Graph et SharePoint sont maquettées ; ?maquette=1 n'agit que sur localhost.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const RACINE = fileURLToPath(new URL("../", import.meta.url));
const SORTIE = process.argv[2] || "/tmp/espace-breteuil-captures";
const PORT = 8766;
const BASE = `http://localhost:${PORT}/?maquette=1`;
mkdirSync(SORTIE, { recursive: true });

const MANAGE = String(Math.pow(2, 24) + 0xFFFF);
const SANS_MANAGE = "1011030767";
const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

function reponses(sc) {
  return {
    "/v1.0/me": { id: "moi", displayName: "Pauline de Breteuil", userPrincipalName: "pdebreteuil@breteuil.fr" },
    "/v1.0/users": sc === "consentement"
      ? { statut: 403, corps: { error: { code: "Authorization_RequestDenied", message: "Insufficient privileges to complete the operation." } } }
      : { value: [{ id: "u1" }] },
    "/v1.0/subscribedSkus": sc === "consentement"
      ? { statut: 403, corps: { error: { code: "Authorization_RequestDenied", message: "Insufficient privileges to complete the operation." } } }
      : { value: [{ skuId: "a", skuPartNumber: "O365_BUSINESS_PREMIUM" }, { skuId: "b", skuPartNumber: "O365_BUSINESS_ESSENTIALS" }] },
    "/v1.0/directoryRoles": { value: [{ id: "r1", displayName: "Global Administrator" }] },
    "/v1.0/sites/breteuil02.sharepoint.com:/sites/ChateaudeBreteuil": { id: "site1", displayName: "Château de Breteuil", webUrl: "https://breteuil02.sharepoint.com/sites/ChateaudeBreteuil" },
    "/v1.0/sites/site1/drive": { id: "drive1", name: "Documents" },
    "/v1.0/drives/drive1/root:/Commun": { id: "c1", name: "Commun", folder: { childCount: 14 } },
    "/sites/ChateaudeBreteuil/_api/web/currentuser": { Id: 7, Title: "Pauline de Breteuil", Email: "pdebreteuil@breteuil.fr", IsSiteAdmin: false },
    "/sites/ChateaudeBreteuil/_api/web/associatedownergroup/users": { value: sc === "proprietaire" ? [{ Id: 3, Email: "fdebreteuil@breteuil.fr" }] : [{ Id: 3, Email: "fdebreteuil@breteuil.fr" }, { Id: 7, Email: "pdebreteuil@breteuil.fr" }] },
    "/sites/ChateaudeBreteuil/_api/web/effectivebasepermissions": { High: "432", Low: sc === "proprietaire" ? SANS_MANAGE : MANAGE },
  };
}

const SCENARIOS = [
  { id: "tout-vert", attendu: "vert", init: {} },
  { id: "consentement-manquant", attendu: "rouge", sc: "consentement",
    init: { scopes: { graph: ["User.Read", "User.ReadBasic.All", "Files.ReadWrite.All", "Sites.ReadWrite.All"] },
      erreurJeton: { sp: "AADSTS65001: The user or administrator has not consented to use the application with ID '…' named 'Espace Breteuil'." } } },
  { id: "cors-refuse", attendu: "rouge", sc: "cors", init: {} },
  { id: "non-proprietaire", attendu: "orange", sc: "proprietaire", init: {} },
];

async function preparer(contexte, sc, init) {
  await contexte.addInitScript((m) => { window.EB_MAQUETTE = m; }, init);
  const rep = reponses(sc);
  await contexte.route("https://belfort-api.damien-belfort.workers.dev/**", (r) => r.fulfill({ status: 404, headers: CORS, body: "{}" }));
  await contexte.route(/https:\/\/(graph\.microsoft\.com|[a-z0-9-]+\.sharepoint\.com)\/.*/, (route) => {
    const u = new URL(route.request().url());
    if (sc === "cors" && u.hostname.endsWith(".sharepoint.com")) return route.abort("failed");
    const v = rep[decodeURIComponent(u.pathname)];
    if (!v) return route.fulfill({ status: 404, headers: CORS, body: JSON.stringify({ error: { code: "itemNotFound", message: "introuvable " + u.pathname } }) });
    if (v.statut) return route.fulfill({ status: v.statut, headers: CORS, body: JSON.stringify(v.corps) });
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(v) });
  });
}

const serveur = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: RACINE, stdio: "ignore" });
await new Promise((ok) => setTimeout(ok, 800));
const navigateur = await chromium.launch();
const bilans = [];
try {
  for (const s of SCENARIOS) {
    for (const [nom, vp, theme] of [["mobile", { width: 375, height: 812 }, "light"], ["bureau", { width: 1280, height: 900 }, "light"]]) {
      const contexte = await navigateur.newContext({ viewport: vp, deviceScaleFactor: 2, serviceWorkers: "block", colorScheme: theme, locale: "fr-FR",
        permissions: ["clipboard-read", "clipboard-write"] });
      await preparer(contexte, s.sc, s.init);
      const page = await contexte.newPage();
      const erreurs = [];
      page.on("pageerror", (e) => erreurs.push(String(e)));
      await page.goto(BASE + "#/verifier");
      await page.waitForSelector(".diag-actions button", { timeout: 15000 });
      const bilan = await page.getAttribute(".diag-bilan", "class");
      assert.ok(bilan.includes(s.attendu), `${s.id} : bilan ${bilan}, attendu ${s.attendu}`);
      assert.deepEqual(erreurs, [], `${s.id} : erreurs JS`);
      const etapes = await page.$$eval(".diag-etape", (l) => l.map((x) => x.dataset.etape + ":" + x.className.split(" ").pop()));
      if (nom === "mobile") {
        // Ouvrir le premier détail technique non vert, puis copier le rapport.
        const det = await page.$(".diag-etape.rouge details, .diag-etape.orange details");
        if (det) await det.evaluate((d) => { d.open = true; });
        await page.click("text=Copier le rapport");
        const rapport = await page.evaluate(() => navigator.clipboard.readText());
        assert.match(rapport, /Espace Breteuil — vérification de la connexion/);
        assert.doesNotMatch(rapport, /pdebreteuil@/);
        assert.doesNotMatch(rapport, /eyJ/);
        bilans.push({ scenario: s.id, etapes, rapport });
      }
      await page.screenshot({ path: `${SORTIE}/diagnostic-${s.id}-${nom}.png`, fullPage: true });
      await contexte.close();
    }
  }
  // v4 : Réglages → « Détails techniques », en sombre et très grand texte.
  for (const [nom, vp] of [["mobile", { width: 375, height: 812 }], ["bureau", { width: 1280, height: 900 }]]) {
    const contexte = await navigateur.newContext({ viewport: vp, deviceScaleFactor: 2, serviceWorkers: "block", colorScheme: "dark", locale: "fr-FR" });
    await preparer(contexte, "", {});
    const page = await contexte.newPage();
    await page.goto(BASE + "#/reglages");
    await page.waitForSelector("text=Détails techniques");
    await page.screenshot({ path: `${SORTIE}/reglages-lien-diagnostic-sombre-${nom}.png`, fullPage: true });
    await page.click("text=Détails techniques");
    await page.waitForSelector(".diag-actions button");
    await page.evaluate(() => document.documentElement.setAttribute("data-texte", "tres-grand"));
    await page.screenshot({ path: `${SORTIE}/diagnostic-tout-vert-sombre-tres-grand-${nom}.png`, fullPage: true });
    await contexte.close();
  }
} finally {
  await navigateur.close();
  serveur.kill();
}
for (const b of bilans) console.log(`\n=== ${b.scenario} ===\n${b.etapes.join("  ")}\n--- rapport ---\n${b.rapport}`);
console.log("\nOK : " + SCENARIOS.length + " scénarios, captures dans " + SORTIE);
