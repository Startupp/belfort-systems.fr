// Vérification visuelle et fonctionnelle de la v3 (navigation par écrans, charte bleue).
// Lancer depuis la racine du dépôt (Chromium déjà installé, ne pas lancer « playwright install ») :
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=$(npm root -g) node espace-breteuil/tests/navigation.playwright.mjs [dossier-captures]
// Contrôles, à 375 px et 1280 px, en clair et en sombre :
//   - aucun défilement horizontal, aucune erreur console ni réponse en erreur ;
//   - 5 onglets au plus, un seul actif ;
//   - AUCUNE répétition : une destination n'apparaît que dans un seul écran d'onglet ou espace ;
//   - cibles tactiles ≥ 44 px (tuiles, onglets, boutons de l'en-tête) ;
//   - mouvement réduit respecté (aucune animation d'écran).
// Les réponses Microsoft et le Worker sont maquettés ; ?maquette=1 n'agit que sur localhost.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const RACINE = fileURLToPath(new URL("../", import.meta.url));
const SORTIE = process.argv[2] || "";
const PORT = 8767;
const BASE = `http://localhost:${PORT}/?maquette=1`;
if (SORTIE) mkdirSync(SORTIE, { recursive: true });
const fiches = JSON.parse(readFileSync(RACINE + "fiches.json", "utf8"));
const ICS = readFileSync(RACINE + "exemple.ics", "utf8");
const ICS2 = readFileSync(RACINE + "exemple-accueil.ics", "utf8");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const u = (id, nom, mail, lic, type = "Member") => ({ id, displayName: nom, givenName: nom.split(" ")[0], mail, userPrincipalName: mail, userType: type, accountEnabled: true, assignedLicenses: lic ? [{ skuId: lic }] : [] });
const REPONSES = {
  "/v1.0/me": { id: "moi", displayName: "Pauline de Breteuil", userPrincipalName: "pdebreteuil@breteuil.fr" },
  "/v1.0/users": { value: [u("u1", "Pauline de Breteuil", "pdebreteuil@breteuil.fr", "a"), u("u2", "François de Breteuil", "fdebreteuil@breteuil.fr", "a"),
    u("u3", "Valérie Durand", "vdurand@breteuil.fr", "a"), u("u4", "Fanny Martin", "fmartin@breteuil.fr", "b"), u("u5", "Contact", "contact@breteuil.fr", null),
    u("u6", "Damien Belfort", "damien@belfort-systems.fr", null, "Guest")] },
  "/v1.0/subscribedSkus": { value: [{ skuId: "a", skuPartNumber: "O365_BUSINESS_PREMIUM", prepaidUnits: { enabled: 5 }, consumedUnits: 3 }, { skuId: "b", skuPartNumber: "O365_BUSINESS_ESSENTIALS", prepaidUnits: { enabled: 3 }, consumedUnits: 1 }] },
  "/v1.0/directoryRoles": { value: [{ id: "r1", displayName: "Global Administrator" }] },
  "/v1.0/sites/breteuil02.sharepoint.com:/sites/ChateaudeBreteuil": { id: "site1", displayName: "Château de Breteuil", webUrl: "https://breteuil02.sharepoint.com/sites/ChateaudeBreteuil" },
  "/v1.0/sites/site1/drive": { id: "drive1", name: "Documents" },
  "/v1.0/drives/drive1/list": { id: "list1" },
  "/v1.0/drives/drive1/root:/Commun": { id: "c1", name: "Commun", folder: { childCount: 4 } },
  "/v1.0/drives/drive1/root:/Commun:/children": { value: [{ id: "d1", name: "Accueil", folder: { childCount: 12 } }, { id: "d2", name: "Finance", folder: { childCount: 30 } },
    { id: "d3", name: "Jardins", folder: { childCount: 5 } }, { id: "d4", name: "Restauration", folder: { childCount: 8 } },
    { id: "f1", name: "Planning été.xlsx", file: {}, webUrl: "https://breteuil02.sharepoint.com/x.xlsx" }] },
  "/sites/ChateaudeBreteuil/_api/web/currentuser": { Id: 7, Title: "Pauline de Breteuil", Email: "pdebreteuil@breteuil.fr", IsSiteAdmin: false },
  "/sites/ChateaudeBreteuil/_api/web/associatedownergroup": { Id: 3, Title: "Propriétaires" },
  "/sites/ChateaudeBreteuil/_api/web/associatedownergroup/users": { value: [{ Id: 7, Email: "pdebreteuil@breteuil.fr" }] },
  "/sites/ChateaudeBreteuil/_api/web/effectivebasepermissions": { High: "432", Low: String(Math.pow(2, 24) + 0xFFFF) },
};
async function preparer(contexte) {
  await contexte.addInitScript((f) => {
    localStorage.setItem("eb:ouvert:admin", JSON.stringify(f.admin.codeEmpreinte));
    localStorage.setItem("eb:ouvert:finance", JSON.stringify(f.finance.codeEmpreinte));
  }, fiches);
  await contexte.route("https://belfort-api.damien-belfort.workers.dev/**", (r) => r.fulfill({ status: 200,
    headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "text/calendar" }, body: /\/2\.ics/.test(r.request().url()) ? ICS2 : ICS }));
  await contexte.route(/https:\/\/(graph\.microsoft\.com|[a-z0-9-]+\.sharepoint\.com)\/.*/, async (route) => {
    const url = new URL(route.request().url());
    if (/\/photos\//.test(url.pathname)) return route.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "image/png" }, body: PNG });
    const v = REPONSES[decodeURIComponent(url.pathname)];
    if (!v) return route.fulfill({ status: 404, headers: CORS, body: JSON.stringify({ error: { code: "itemNotFound", message: "introuvable " + url.pathname } }) });
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(v) });
  });
}

// Écrans d'onglet et espaces qui proposent des destinations (pour l'inventaire des doublons).
const HUBS = ["", "dossiers", "equipe", "plus", "finance"];
// Écrans capturés et contrôlés.
const ECRANS = ["", "planning", "dossiers", "equipe", "plus", "reglages", "finance", "personnes", "licences-reel", "organisation",
  "commun", "personne/fanny", "absences", "securite", "verifier"];

const serveur = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: RACINE, stdio: "ignore" });
await new Promise((ok) => setTimeout(ok, 800));
const navigateur = await chromium.launch();
const problemes = [];
const defilement = {};
try {
  for (const [nom, vp] of [["375", { width: 375, height: 812 }], ["1280", { width: 1280, height: 900 }]]) {
    for (const theme of ["light", "dark"]) {
      const contexte = await navigateur.newContext({ viewport: vp, deviceScaleFactor: 1, serviceWorkers: "block", colorScheme: theme, locale: "fr-FR" });
      await preparer(contexte);
      const page = await contexte.newPage();
      const erreurs = [];
      page.on("pageerror", (e) => erreurs.push("JS : " + e));
      page.on("console", (m) => { if (m.type() === "error") erreurs.push("console : " + m.text()); });
      page.on("response", (r) => { if (r.status() >= 400) erreurs.push(r.status() + " " + r.url()); });
      await page.goto(BASE + "#/");
      await page.waitForSelector(".carte-aujourdhui", { timeout: 15000 });
      for (const e of ECRANS) {
        await page.evaluate((h) => { location.hash = h; }, "#/" + e);
        await page.waitForTimeout(700);
        const m = await page.evaluate(() => ({
          larg: document.documentElement.scrollWidth, vue: innerWidth, haut: document.documentElement.scrollHeight, vueH: innerHeight,
          onglets: document.querySelectorAll(".onglets a").length, actifs: document.querySelectorAll(".onglets a.actif").length,
          petits: [...document.querySelectorAll(".t, .onglets a, .barre .btn-rond, .barre .btn-retour, .segments button")]
            .filter((x) => x.offsetParent && (x.getBoundingClientRect().height < 43.5 || x.getBoundingClientRect().width < 43.5)).map((x) => x.className + ":" + x.textContent.trim().slice(0, 20)),
        }));
        const ici = `${nom}/${theme}/#/${e}`;
        if (m.larg > m.vue) problemes.push(`${ici} : défilement horizontal (${m.larg} > ${m.vue})`);
        if (m.onglets > 5 || m.actifs !== 1) problemes.push(`${ici} : ${m.onglets} onglets, ${m.actifs} actif(s)`);
        if (m.petits.length) problemes.push(`${ici} : cibles < 44 px ${m.petits.join(", ")}`);
        if (theme === "light") defilement[nom + " " + (e || "accueil")] = +(m.haut / m.vueH).toFixed(2);
        if (SORTIE && ["", "planning", "dossiers", "equipe", "plus", "reglages", "finance", "personnes"].includes(e)) {
          await page.screenshot({ path: `${SORTIE}/apres-${(e || "accueil").replace(/\//g, "_")}-${nom}-${theme === "light" ? "clair" : "sombre"}.png`, fullPage: true });
        }
      }
      // Doublons : chaque destination (#/…) proposée dans le contenu d'un seul écran d'onglet / espace.
      if (nom === "375" && theme === "light") {
        const vu = {};
        for (const hub of HUBS) {
          await page.evaluate((h) => { location.hash = h; }, "#/" + hub);
          await page.waitForTimeout(600);
          const liens = await page.$$eval(".ecran a[href^='#/']:not(.btn-retour)", (l) => [...new Set(l.map((a) => a.getAttribute("href")))]);
          for (const l of liens) {
            if (/^#\/personne\//.test(l)) continue; // une tuile par personne (« Mon espace »), seulement à l'accueil
            if (vu[l] && vu[l] !== hub) problemes.push(`doublon : ${l} dans #/${vu[l]} et #/${hub}`);
            vu[l] = hub;
          }
        }
      }
      if (erreurs.length) problemes.push(`${nom}/${theme} : ${[...new Set(erreurs)].join(" | ")}`);
      await contexte.close();
    }
  }
  // Mouvement réduit : aucune animation sur les écrans.
  const ctx = await navigateur.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: "block", reducedMotion: "reduce" });
  await preparer(ctx);
  const p = await ctx.newPage();
  await p.goto(BASE + "#/");
  await p.waitForSelector(".carte-aujourdhui");
  await p.evaluate(() => { location.hash = "#/equipe"; });
  await p.waitForTimeout(300);
  await p.evaluate(() => { location.hash = "#/personnes"; });
  await p.waitForTimeout(100);
  const anim = await p.$eval(".ecran", (x) => getComputedStyle(x).animationName);
  if (anim !== "none") problemes.push("mouvement réduit non respecté : " + anim);
  // Sans mouvement réduit : glissement en descendant, fondu en changeant d'onglet.
  const ctx2 = await navigateur.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: "block" });
  await preparer(ctx2);
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + "#/equipe");
  await p2.waitForSelector(".tuiles");
  await p2.waitForTimeout(1500); // laisser finir le démarrage (connexion maquette, planning)
  await p2.click("a[href='#/personnes']");
  await p2.waitForTimeout(80); // l'événement hashchange arrive juste après le clic
  const avant = await p2.$eval(".ecran", (x) => x.className);
  if (!/avant/.test(avant)) problemes.push("pas de glissement vers un écran enfant : " + avant);
  await p2.click(".onglets a[href='#/planning']");
  await p2.waitForTimeout(80);
  const fondu = await p2.$eval(".ecran", (x) => [x.className, getComputedStyle(x).animationDuration]);
  if (/avant|arriere/.test(fondu[0])) problemes.push("changement d'onglet : glissement au lieu d'un fondu");
  const ms = parseFloat(fondu[1]) * (fondu[1].endsWith("ms") ? 1 : 1000);
  if (ms < 150 || ms > 250) problemes.push("durée de transition hors 150–250 ms : " + fondu[1]);
  await ctx.close(); await ctx2.close();
} finally {
  await navigateur.close();
  serveur.kill();
}
console.log("Défilement vertical (hauteur de page / hauteur d'écran, 1 = tient sans défiler) :");
console.log(Object.entries(defilement).map(([k, v]) => `  ${k.padEnd(26)} ${v}`).join("\n"));
assert.deepEqual(problemes, [], "Problèmes :\n" + problemes.join("\n"));
console.log("\nOK : aucun défilement horizontal, aucune erreur, pas de doublon, cibles ≥ 44 px" + (SORTIE ? ", captures dans " + SORTIE : ""));
