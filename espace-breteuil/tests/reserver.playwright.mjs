// v5.4.1 « Réserver à certaines personnes » (Qui a accès ?) — réponses Microsoft MAQUETTÉES, données FICTIVES.
// Lancer depuis la racine du dépôt (Chromium déjà installé) :
//   EB_PORT=8797 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=$(npm root -g) node espace-breteuil/tests/reserver.playwright.mjs [dossier-captures]
// Contrôles à 375 et 1280 px, palettes crème et Bleu Breteuil :
//   - dossier commun : badge « 🔒 Réservé » (une seule requête pour tout le dossier) ;
//   - menu d'un FICHIER : « Qui a accès ? » et « Déplacer vers… » ;
//   - Qui a accès ? d'un fichier : « Visible par toute l'équipe », retour vers le dossier, carte « Réserver » en premier ;
//   - Réserver : vous coché d'office, direction suggérée, recherche, « Peut modifier » par défaut, UNE confirmation en clair,
//     puis exactement : casser l'héritage, ajouter Pauline, retirer les autres, JAMAIS les propriétaires ;
//   - dossier réservé : « 🔒 Accès réservé », « Rendre à nouveau visible par tous » → resetroleinheritance ;
//   - déplacer un fichier vers un dossier réservé : 🔒 dans le choix, avertissement dans la confirmation ;
//   - aucune erreur console, pas de défilement horizontal.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const RACINE = fileURLToPath(new URL("../", import.meta.url));
const SORTIE = process.argv[2] || "";
const PORT = Number(process.env.EB_PORT) || 8797;
const BASE = `http://localhost:${PORT}/?maquette=1`;
if (SORTIE) mkdirSync(SORTIE, { recursive: true });
const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

const u = (id, nom, mail, type = "Member") => ({ id, displayName: nom, givenName: nom.split(" ")[0], mail, userPrincipalName: mail, userType: type, accountEnabled: true, assignedLicenses: [{ skuId: "a" }] });
const USERS = [u("u1", "Pauline de Breteuil", "pdebreteuil@breteuil.fr"), u("u2", "François de Breteuil", "fdebreteuil@breteuil.fr"),
  u("u3", "Valérie Durand", "vdurand@breteuil.fr"), u("u4", "Fanny Martin", "fmartin@breteuil.fr"), u("u7", "Camille Roux", "croux@breteuil.fr")];
const pers = (Id, Title, mail) => ({ Id, Title, Email: mail, LoginName: "i:0#.f|membership|" + mail, PrincipalType: 1 });
const PAULINE = pers(7, "Pauline de Breteuil", "pdebreteuil@breteuil.fr"), FRANCOIS = pers(8, "François de Breteuil", "fdebreteuil@breteuil.fr");
const SP = "/sites/ChateaudeBreteuil/_api/web";
const LISTE = SP + "/lists(guid'list1')";
const ra = (m, kind, nom) => ({ PrincipalId: m.Id, Member: m, RoleDefinitionBindings: [{ RoleTypeKind: kind, Name: nom }] });
const PROPS = { Id: 3, Title: "Propriétaires de Château de Breteuil", PrincipalType: 8 };
const ACCES_FICHIER = [ra(PROPS, 5, "Contrôle total"), ra({ Id: 4, Title: "Membres de Château de Breteuil", PrincipalType: 8 }, 3, "Collaboration"),
  ra({ Id: 5, Title: "SharingLinks.abc.OrganizationView.1", PrincipalType: 8 }, 2, "Lecture"), ra(pers(9, "Valérie Durand", "vdurand@breteuil.fr"), 3, "Collaboration"),
  ra(FRANCOIS, 3, "Collaboration"), ra({ Id: 1, Title: "Accès limité", PrincipalType: 8 }, 1, "Accès limité")];

const R = {
  "/v1.0/me": USERS[0],
  "/v1.0/users": { value: USERS },
  "/v1.0/subscribedSkus": { value: [{ skuId: "a", skuPartNumber: "O365_BUSINESS_PREMIUM", prepaidUnits: { enabled: 6 }, consumedUnits: 5 }] },
  "/v1.0/me/drive": { id: "od1", webUrl: "https://breteuil02-my.sharepoint.com/personal/x" },
  "/v1.0/sites/breteuil02.sharepoint.com:/sites/ChateaudeBreteuil": { id: "site1", displayName: "Château de Breteuil", webUrl: "https://breteuil02.sharepoint.com/sites/ChateaudeBreteuil" },
  "/v1.0/sites/site1/drive": { id: "drive1", name: "Documents", webUrl: "https://breteuil02.sharepoint.com/sites/ChateaudeBreteuil/Shared%20Documents" },
  "/v1.0/drives/drive1/list": { id: "list1" },
  "/v1.0/drives/drive1/root:/Commun": { id: "c1", name: "Commun", folder: { childCount: 3 }, listItem: { id: "5" } },
  "/v1.0/drives/drive1/root:/Commun:/children": { value: [{ id: "d1", name: "Accueil", folder: { childCount: 12 } }, { id: "d2", name: "Finance", folder: { childCount: 3 } },
    { id: "f1", name: "Planning été.xlsx", file: {}, webUrl: "https://breteuil02.sharepoint.com/x.xlsx" }] },
  "/v1.0/drives/drive1/root:/Commun/Finance": { id: "d2", name: "Finance", folder: { childCount: 3 }, listItem: { id: "6" } },
  "/v1.0/drives/drive1/root:/Commun/Finance:/children": { value: [{ id: "f9", name: "Factures 2026.pdf", file: {} }] },
  "/v1.0/drives/drive1/root:/Commun/Planning été.xlsx": { id: "f1", name: "Planning été.xlsx", file: {}, listItem: { id: "7" } },
  [SP + "/currentuser"]: { ...PAULINE, IsSiteAdmin: false },
  [SP + "/associatedownergroup"]: PROPS,
  [SP + "/associatedownergroup/users"]: { value: [PAULINE, FRANCOIS] },
  [SP + "/sitegroups/getbyid(3)/users"]: { value: [PAULINE, FRANCOIS] },
  [SP + "/effectivebasepermissions"]: { High: "432", Low: String(2 ** 24 + 0xFFFF) },
  [SP + "/roledefinitions/getbytype(3)"]: { Id: 1073741827 },
  [SP + "/roledefinitions/getbytype(2)"]: { Id: 1073741826 },
  [SP + "/GetFolderByServerRelativePath(decodedurl='/sites/ChateaudeBreteuil/Shared Documents/Commun')"]: {
    Folders: [{ Name: "Accueil", ListItemAllFields: { HasUniqueRoleAssignments: false } }, { Name: "Finance", ListItemAllFields: { HasUniqueRoleAssignments: true } }, { Name: "Forms" }],
    Files: [{ Name: "Planning été.xlsx", ListItemAllFields: { HasUniqueRoleAssignments: false } }] },
  [LISTE + "/items(7)"]: { HasUniqueRoleAssignments: false },
  [LISTE + "/items(7)/roleassignments"]: { value: ACCES_FICHIER },
  [LISTE + "/items(6)"]: { HasUniqueRoleAssignments: true },
  [LISTE + "/items(6)/roleassignments"]: { value: [ra(PROPS, 5, "Contrôle total"), ra(PAULINE, 3, "Collaboration")] },
};

async function nouvellePage(navigateur, vp, palette) {
  const contexte = await navigateur.newContext({ viewport: vp, deviceScaleFactor: 1, serviceWorkers: "block", locale: "fr-FR", colorScheme: "light" });
  const journal = [], lectures = [];
  await contexte.addInitScript((m) => { self.EB_MAQUETTE = m; }, { compte: { name: "Pauline de Breteuil", username: "pdebreteuil@breteuil.fr", localAccountId: "u1" }, permissions: [] });
  if (palette === "bleu") await contexte.addInitScript(() => localStorage.setItem("eb:reglages", JSON.stringify({ palette: "bleu" })));
  await contexte.route(/https:\/\/(graph\.microsoft\.com|[a-z0-9-]+\.sharepoint\.com)\/.*/, async (route) => {
    const req = route.request(), url = new URL(req.url()), chemin = decodeURIComponent(url.pathname);
    if (/\/photos\//.test(url.pathname)) return route.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "image/png" }, body: PNG });
    if (req.method() !== "GET") {
      journal.push({ methode: req.method(), chemin, entetes: req.headers(), corps: req.postData() });
      if (/\/ensureuser$/.test(chemin)) return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ Id: 7 }) });
      return route.fulfill({ status: req.method() === "POST" ? 200 : 204, headers: CORS, body: req.method() === "POST" ? "{}" : "" });
    }
    lectures.push(chemin);
    // Écrans hors sujet (planning, suivi…) : réponse vide plutôt qu'une erreur.
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(R[chemin] || { value: [] }) });
  });
  await contexte.route("https://belfort-api.damien-belfort.workers.dev/**", (r) => r.fulfill({ status: 200, headers: CORS, body: "{}" }));
  const page = await contexte.newPage();
  const erreurs = [];
  page.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text()); });
  page.on("pageerror", (e) => erreurs.push(String(e)));
  return { contexte, page, journal, lectures, erreurs };
}
const calme = (page) => page.evaluate(() => Promise.race([new Promise((ok) => setTimeout(ok, 2000)), Promise.all(document.getAnimations()
  .filter((a) => a.timeline === document.timeline && isFinite(a.effect.getComputedTiming().endTime)).map((a) => a.finished.catch(() => {})))]));
let captures = 0;
async function capturer(page, nom) {
  if (!SORTIE) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await calme(page);
  await page.screenshot({ path: `${SORTIE}/${nom}.png`, fullPage: true });
  captures++;
}
const problemes = [];
async function sansDebord(page, ou) {
  await calme(page); // le glissement d'arrivée de l'écran déborde un instant
  const trop = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1
    ? [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).slice(-3).map((e) => e.tagName + "." + e.className + " " + Math.round(e.getBoundingClientRect().right)).join(" ; ") : "");
  if (trop) problemes.push(`${ou} : défilement horizontal (${trop})`);
}
async function choisir(page, texte) { await page.click(`dialog .choix:has-text("${texte}")`); await calme(page); }
async function bouton(page, texte) { await page.click(`dialog button:has-text("${texte}")`); await calme(page); }

const serveur = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: RACINE, stdio: "ignore" });
await new Promise((ok) => setTimeout(ok, 800));
const navigateur = await chromium.launch();
try {
  for (const [taille, vp] of [["375", { width: 375, height: 812 }], ["1280", { width: 1280, height: 900 }]]) {
    for (const palette of ["creme", "bleu"]) {
      const ou = `${taille} ${palette}`;
      const { contexte, page, journal, lectures, erreurs } = await nouvellePage(navigateur, vp, palette);

      /* Dossier commun : badge 🔒 Réservé sur Finance seulement, en UNE requête. */
      await page.goto(BASE + "#/commun/Commun");
      await page.waitForSelector('.tuile-lien[data-nom="Finance"] .etiquette.reserve');
      assert.equal(await page.$$eval(".etiquette.reserve", (l) => l.length), 1, `${ou} : un seul badge`);
      assert.equal(lectures.filter((c) => /GetFolderByServerRelativePath/.test(c)).length, 1, `${ou} : une seule requête pour les badges`);
      await sansDebord(page, `${ou} commun`);
      if (palette === "creme") await capturer(page, `reserver-commun-${taille}`);

      /* Déplacer un fichier vers un dossier réservé. */
      await page.click('.fichier[data-fichier="Planning été.xlsx"]');
      await page.waitForSelector("dialog .choix");
      const menu = await page.$$eval("dialog .choix b", (l) => l.map((b) => b.textContent));
      assert.ok(menu.includes("Qui a accès ?") && menu.includes("Déplacer vers…"), `${ou} : menu fichier ${menu}`);
      await choisir(page, "Déplacer vers…");
      await page.waitForSelector('dialog .choix[data-nom="Finance"]');
      assert.match(await page.textContent('dialog .choix[data-nom="Finance"]'), /🔒[\s\S]*Accès réservé/, `${ou} : 🔒 dans le choix`);
      assert.doesNotMatch(await page.textContent('dialog .choix[data-nom="Accueil"]'), /🔒/);
      await page.click('dialog .choix[data-nom="Finance"]');
      await page.waitForSelector('dialog .phrase:has-text("Commun › Finance")');
      await bouton(page, "Ranger ici");
      await bouton(page, "Continuer");
      assert.match(await page.textContent("dialog"), /Il ne sera visible que par les personnes qui ont accès à ce dossier\./, `${ou} : avertissement`);
      await bouton(page, "Oui, déplacer");
      await page.waitForFunction(() => /rangé/.test(document.getElementById("toast")?.textContent || ""));
      const deplacement = journal.find((j) => j.methode === "PATCH");
      assert.ok(deplacement && deplacement.chemin === "/v1.0/drives/drive1/items/f1" && JSON.parse(deplacement.corps).parentReference.id === "d2", `${ou} : PATCH déplacement`);

      /* Qui a accès ? d'un FICHIER, depuis son menu. */
      await page.waitForSelector('.fichier[data-fichier="Planning été.xlsx"]');
      await page.click('.fichier[data-fichier="Planning été.xlsx"]');
      await choisir(page, "Qui a accès ?");
      await page.waitForSelector('[data-etat="visible"]');
      assert.match(await page.textContent('[data-etat="visible"]'), /Visible par toute l'équipe/);
      assert.equal(await page.getAttribute(".barre .btn-retour", "href"), "#/commun/Commun", `${ou} : retour vers le dossier du fichier`);
      assert.equal(await page.$eval(".actions-acces > *", (e) => e.dataset.action), "reserver", `${ou} : Réserver en premier`);
      assert.equal(await page.$('[data-action="rendre-visible"]'), null);
      const texteAcces = await page.textContent("#app, main, body");
      assert.match(texteAcces, /Toute l'équipe/);
      assert.doesNotMatch(texteAcces, /h[ée]rit|Membres du site|Droits personnalisés/i, `${ou} : pas de jargon`);
      await sansDebord(page, `${ou} acces`);
      if (palette === "bleu") await capturer(page, `reserver-acces-fichier-${taille}-bleu`);

      /* Réserver à Pauline et François. */
      await page.click('[data-action="reserver"]');
      await page.waitForSelector('[data-liste="suggestions"] input');
      const coches = await page.$$eval('[data-liste="suggestions"] input', (l) => l.map((i) => [i.dataset.adresse, i.checked]));
      assert.deepEqual(coches, [["pdebreteuil@breteuil.fr", true], ["fdebreteuil@breteuil.fr", false]], `${ou} : vous coché, direction suggérée`);
      assert.equal(await page.isChecked("#niveau-modifier"), true, `${ou} : Peut modifier par défaut`);
      await page.check('[data-liste="suggestions"] input[data-adresse="fdebreteuil@breteuil.fr"]');
      await page.fill('input[type="search"]', "fanny");
      assert.deepEqual(await page.$$eval('[data-liste="equipe"] input', (l) => l.map((i) => i.dataset.adresse)), ["fmartin@breteuil.fr"]);
      await page.fill('input[type="search"]', "");
      assert.match(await page.textContent(".resume-choix"), /2 personnes choisies : Pauline de Breteuil et François de Breteuil/);
      await sansDebord(page, `${ou} reserver`);
      await capturer(page, `reserver-choix-${taille}-${palette}`);
      await page.click('[data-action="continuer-reserve"]');
      await page.waitForSelector("dialog .phrase");
      assert.equal(await page.textContent("dialog .phrase"),
        "Seuls Pauline de Breteuil et François de Breteuil pourront ouvrir « Planning été.xlsx » + l'administrateur du site (obligatoire). Les autres ne le verront plus.");
      assert.match(await page.textContent("dialog .phrase.consequence"), /Ne pourront plus l'ouvrir : Toute l'équipe, Lien pour l'entreprise et Valérie Durand\./);
      assert.equal(await page.$("dialog .etape"), null, `${ou} : une seule confirmation`);
      await capturer(page, `reserver-confirmation-${taille}-${palette}`);
      await bouton(page, "Oui, réserver");
      await page.waitForFunction(() => /^#\/acces\//.test(location.hash));
      const ecritures = journal.filter((j) => j.methode === "POST").map((j) => j.chemin.replace(LISTE + "/items(7)", "ITEM") + (j.entetes["x-http-method"] ? " " + j.entetes["x-http-method"] : ""));
      assert.deepEqual(ecritures, [
        "ITEM/breakroleinheritance(copyRoleAssignments=true,clearSubscopes=true)",
        SP + "/ensureuser", "ITEM/roleassignments/addroleassignment(principalid=7,roledefid=1073741827)",
        "ITEM/roleassignments/getbyprincipalid(4) DELETE", "ITEM/roleassignments/getbyprincipalid(5) DELETE", "ITEM/roleassignments/getbyprincipalid(9) DELETE",
      ], `${ou} : ordre des écritures`);
      assert.ok(!ecritures.some((e) => /getbyprincipalid\((3|8|1)\)/.test(e)), `${ou} : propriétaires jamais retirés`);
      assert.equal(JSON.parse(journal.find((j) => /ensureuser/.test(j.chemin)).corps).logonName, "i:0#.f|membership|pdebreteuil@breteuil.fr");
      const j = await page.evaluate(() => JSON.parse(localStorage.getItem("eb:journal") || "[]")[0]);
      assert.match(j.action, /Réservé à certaines personnes/);

      /* Dossier réservé : état et « Rendre à nouveau visible par tous ». */
      await page.goto(BASE + "#/acces/Commun/Finance");
      await page.waitForSelector('[data-etat="reserve"]');
      assert.match(await page.textContent('[data-etat="reserve"]'), /🔒[\s\S]*Accès réservé/);
      await page.click('[data-action="rendre-visible"]');
      await page.waitForSelector("dialog .phrase");
      assert.match(await page.textContent("dialog .phrase"), /« Finance » aura de nouveau les mêmes accès que « Commun »/);
      await bouton(page, "Oui, rendre visible");
      await page.waitForFunction(() => /C'est fait/.test(document.getElementById("toast")?.textContent || ""));
      assert.ok(journal.some((x) => x.chemin === LISTE + "/items(6)/resetroleinheritance"), `${ou} : resetroleinheritance`);

      if (erreurs.length) problemes.push(`${ou} : erreurs console ${erreurs.join(" | ")}`);
      await contexte.close();
      console.log("ok", ou);
    }
  }
} finally {
  await navigateur.close();
  serveur.kill();
}
if (problemes.length) { console.error(problemes.join("\n")); process.exit(1); }
console.log(`Réserver : tout est bon (${captures} captures).`);
