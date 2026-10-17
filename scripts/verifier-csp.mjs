// Vérifie qu'aucune page de _site/ ne déclenche de violation CSP (Chromium via Playwright).
//
//   bash scripts/build-site.sh
//   node scripts/servir-site.mjs &            # http://localhost:8788
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/verifier-csp.mjs
//
// Playwright n'est PAS une dépendance du site : il doit être installé à part (npx playwright…,
// ou NODE_PATH vers une installation globale). Code de sortie 1 s'il y a une violation.
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch {
  try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || "/opt/npm-tools/node_modules/playwright")); } catch {
    console.error("Playwright introuvable : npm i -D playwright (hors dépôt) ou PLAYWRIGHT_MODULE=<chemin>."); process.exit(2);
  }
}

const BASE = process.env.BASE_URL || "http://localhost:8788";
const RACINE = process.argv[2] || "_site";
const ATTENTE = Number(process.env.ATTENTE_MS || 2500);

function pages(dir) {
  const out = [];
  for (const nom of readdirSync(dir)) {
    const p = join(dir, nom);
    if (statSync(p).isDirectory()) out.push(...pages(p));
    else if (nom.endsWith(".html")) {
      let u = "/" + relative(RACINE, p).split(sep).join("/");
      u = u.endsWith("/index.html") ? u.slice(0, -10) : u === "/404.html" ? "/page-inexistante" : u.slice(0, -5);
      out.push(u);
    }
  }
  return out.sort();
}

const navigateur = await chromium.launch();
let total = 0;
const bilan = [];
for (const chemin of pages(RACINE)) {
  const ctx = await navigateur.newContext({ serviceWorkers: "block" });
  const page = await ctx.newPage();
  const violations = [];
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__csp.push(`${e.effectiveDirective} bloque ${e.blockedURI || "(inline)"} ${e.sourceFile ? "dans " + e.sourceFile + ":" + e.lineNumber : ""}`);
    });
  });
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push("console : " + m.text().slice(0, 300)); });
  let statut = "?";
  try {
    const rep = await page.goto(BASE + chemin, { waitUntil: "load", timeout: 30000 });
    statut = rep ? rep.status() : "?";
    const csp = rep ? (await rep.allHeaders())["content-security-policy"] : undefined;
    if (!csp && chemin !== "/page-inexistante") violations.push("aucun en-tête Content-Security-Policy");
    await page.waitForTimeout(ATTENTE);
    for (const v of await page.evaluate(() => window.__csp || [])) violations.push("évènement : " + v);
    // Un peu d'interaction : clique les boutons visibles (onglets, menus, mode démo…),
    // pour faire tourner le code qui ne s'exécute qu'après un clic.
    const boutons = await page.locator("button:visible, [role=tab]:visible").all();
    for (const b of boutons.slice(0, Number(process.env.CLICS || 12))) {
      try { await b.click({ timeout: 1500, noWaitAfter: true }); await page.waitForTimeout(300); } catch { /* bouton disparu ou couvert */ }
      try { for (const v of await page.evaluate(() => window.__csp || [])) violations.push("évènement : " + v); } catch { /* page changée */ }
    }
  } catch (e) { violations.push("erreur de chargement : " + e.message.split("\n")[0]); }
  const uniques = [...new Set(violations)];
  total += uniques.length;
  bilan.push({ chemin, statut, uniques });
  console.log(`${uniques.length ? "ÉCHEC" : "ok   "}  ${statut}  ${chemin}`);
  for (const v of uniques) console.log("        - " + v);
  await ctx.close();
}
await navigateur.close();
console.log(`\n${bilan.length} pages vérifiées, ${total} violation(s) CSP.`);
process.exit(total ? 1 : 0);
