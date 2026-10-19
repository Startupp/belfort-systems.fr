// v5.5 « Simplification » — réponses Microsoft MAQUETTÉES, données FICTIVES.
// Lancer depuis la racine du dépôt (Chromium déjà installé) :
//   EB_PORT=8798 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=$(npm root -g) node espace-breteuil/tests/simplification.playwright.mjs [dossier-captures]
// Contrôles à 375 et 1280 px, palettes crème et Bleu Breteuil :
//   - premier lancement : carte « Vous êtes : Gestionnaire / Lecteur » (droits RÉELS), questionnaire filtré par les droits,
//     ordre des choix, écran ouvert = 1er choix, choix gardé par compte, « Plus tard », stockage bloqué ;
//   - Accueil : tuiles dans l'ordre choisi ; Moi : carte du niveau ; Lecteur : actions d'ajout CACHÉES (pas grisées) ;
//   - « Comment faire ? » → « Montrez-moi » : bon écran, bouton entouré, bulle « Touchez ici », Échap / toucher ferme ;
//   - Gérer : tuile « 🛠️ Suivi informatique » → #/suivi (mêmes profils que #/suivi) ;
//   - feuille d'actions et écran dossier : AUCUN texte ne chevauche un autre (aussi en police agrandie, 412 px, sombre) ;
//   - fil d'Ariane sur une ligne, boutons d'action de même taille, aucune erreur console, pas de défilement horizontal.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const RACINE = fileURLToPath(new URL("../", import.meta.url));
const SORTIE = process.argv[2] || "";
const PORT = Number(process.env.EB_PORT) || 8798;
const BASE = `http://localhost:${PORT}/?maquette=1`;
if (SORTIE) mkdirSync(SORTIE, { recursive: true });
const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const GA = "62e90394-69f5-4237-9190-012177145e10";

const u = (id, nom, mail) => ({ id, displayName: nom, givenName: nom.split(" ")[0], mail, userPrincipalName: mail, userType: "Member", accountEnabled: true, assignedLicenses: [{ skuId: "a" }] });
const USERS = { u1: u("u1", "Pauline de Breteuil", "pdebreteuil@breteuil.fr"), u2: u("u2", "François de Breteuil", "fdebreteuil@breteuil.fr"), u4: u("u4", "Fanny Martin", "fmartin@breteuil.fr") };
const pers = (Id, Title, mail) => ({ Id, Title, Email: mail, LoginName: "i:0#.f|membership|" + mail, PrincipalType: 1 });
const PAULINE = pers(7, "Pauline de Breteuil", "pdebreteuil@breteuil.fr"), FRANCOIS = pers(8, "François de Breteuil", "fdebreteuil@breteuil.fr"), FANNY = pers(10, "Fanny Martin", "fmartin@breteuil.fr");
const SP = "/sites/ChateaudeBreteuil/_api/web";
const AVEC_GERER = { High: "432", Low: String(2 ** 24 + 0xFFFF) }, LECTURE = { High: "176", Low: "138612833" };
// gestionnaire : propriétaire du site ; lecteur : lecture seule ; admin : administrateur général ET propriétaire (→ Gérer).
const PROFILS = {
  gestionnaire: { moi: USERS.u1, sp: PAULINE, perm: AVEC_GERER, roles: [] },
  lecteur: { moi: USERS.u4, sp: FANNY, perm: LECTURE, roles: [] },
  admin: { moi: USERS.u2, sp: FRANCOIS, perm: AVEC_GERER, roles: [{ id: "r1", displayName: "Global Administrator", roleTemplateId: GA }] },
};
function reponses(p) {
  return {
    "/v1.0/me": p.moi,
    "/v1.0/me/transitiveMemberOf/microsoft.graph.directoryRole": { value: p.roles },
    "/v1.0/me/licenseDetails": { value: [{ skuPartNumber: "O365_BUSINESS_PREMIUM" }] },
    "/v1.0/users": { value: Object.values(USERS) },
    "/v1.0/me/drive": { id: "od1", webUrl: "https://breteuil02-my.sharepoint.com/personal/x" },
    "/v1.0/me/drive/recent": { value: [{ id: "rf1", name: "Menu de Noël.docx", file: {}, webUrl: "https://breteuil02.sharepoint.com/Menu.docx", lastModifiedDateTime: "2026-10-16T10:00:00Z", remoteItem: { id: "rf1", parentReference: { driveId: "drive1" } } }] },
    "/v1.0/me/drive/root/children": { value: [{ id: "o1", name: "Notes", folder: { childCount: 2 } }] },
    "/v1.0/sites/breteuil02.sharepoint.com:/sites/ChateaudeBreteuil": { id: "site1", displayName: "Château de Breteuil", webUrl: "https://breteuil02.sharepoint.com/sites/ChateaudeBreteuil" },
    "/v1.0/sites/site1/drive": { id: "drive1", name: "Documents", webUrl: "https://breteuil02.sharepoint.com/sites/ChateaudeBreteuil/Shared%20Documents" },
    "/v1.0/drives/drive1/list": { id: "list1" },
    "/v1.0/drives/drive1/root:/Commun": { id: "c1", name: "Commun", folder: { childCount: 3 }, listItem: { id: "5" } },
    "/v1.0/drives/drive1/root:/Commun:/children": { value: [{ id: "d1", name: "Accueil", folder: { childCount: 12 } }, { id: "d2", name: "François et Pauline", folder: { childCount: 3 } },
      { id: "d3", name: "Restauration et événements de l'été au Château", folder: { childCount: 8 } }, { id: "f1", name: "Planning été.xlsx", file: {}, webUrl: "https://breteuil02.sharepoint.com/x.xlsx" }] },
    "/v1.0/drives/drive1/root:/Commun/François et Pauline:/children": { value: [{ id: "f9", name: "Notes de la direction.docx", file: {}, webUrl: "https://breteuil02.sharepoint.com/n.docx" }] },
    [SP + "/currentuser"]: { ...p.sp, IsSiteAdmin: false },
    [SP + "/associatedownergroup"]: { Id: 3, Title: "Propriétaires de Château de Breteuil", PrincipalType: 8 },
    [SP + "/associatedownergroup/users"]: { value: [PAULINE, FRANCOIS] },
    [SP + "/effectivebasepermissions"]: p.perm,
  };
}

const problemes = [];
let captures = 0;
const calme = (page) => page.evaluate(() => Promise.race([new Promise((ok) => setTimeout(ok, 2000)), Promise.all(document.getAnimations()
  .filter((a) => a.timeline === document.timeline && isFinite(a.effect.getComputedTiming().endTime)).map((a) => a.finished.catch(() => {})))]));
async function capturer(page, nom, pleine = true) {
  if (!SORTIE) return;
  if (pleine) await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.getElementById("toast")?.classList.remove("visible"));
  await calme(page);
  await page.screenshot({ path: `${SORTIE}/${nom}.png`, fullPage: pleine });
  captures++;
}
async function sansDebord(page, ou) {
  await calme(page);
  const trop = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (trop) problemes.push(`${ou} : défilement horizontal`);
}
/** Aucun texte de « sel » n'en chevauche un autre (rectangles de chaque ligne de texte), ni ne sort de sa boîte. */
async function sansChevauchement(page, sel, boite, ou) {
  const r = await page.evaluate(([sel, boite]) => {
    const rects = [];
    for (const el of document.querySelectorAll(sel)) {
      if (!el.offsetParent && getComputedStyle(el).position !== "fixed") continue;
      const range = document.createRange(); range.selectNodeContents(el);
      for (const q of range.getClientRects()) if (q.width > 1 && q.height > 1) rects.push({ t: el.textContent.trim().slice(0, 30), x: q.left, y: q.top, r: q.right, b: q.bottom, el });
    }
    const conflits = [];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], c = rects[j];
      if (a.el === c.el || a.el.contains(c.el) || c.el.contains(a.el)) continue;
      const ix = Math.min(a.r, c.r) - Math.max(a.x, c.x), iy = Math.min(a.b, c.b) - Math.max(a.y, c.y);
      if (ix > 2 && iy > 2) conflits.push(a.t + " ⟷ " + c.t);
    }
    // Chaque texte reste dans sa boîte (ligne de la feuille, bouton…).
    if (boite) for (const x of rects) {
      const b = x.el.closest(boite); if (!b) continue;
      const q = b.getBoundingClientRect();
      if (x.b > q.bottom + 1 || x.y < q.top - 1) conflits.push(x.t + " déborde de sa boîte");
    }
    return { n: rects.length, conflits: [...new Set(conflits)] };
  }, [sel, boite]);
  if (!r.n) problemes.push(`${ou} : aucun texte trouvé pour ${sel}`);
  if (r.conflits.length) problemes.push(`${ou} : textes qui se chevauchent : ${r.conflits.slice(0, 4).join(" | ")}`);
}

async function nouvellePage(navigateur, opts) {
  const p = PROFILS[opts.profil];
  const contexte = await navigateur.newContext({ viewport: opts.vp, deviceScaleFactor: 1, serviceWorkers: "block", locale: "fr-FR", colorScheme: opts.theme || "light" });
  await contexte.addInitScript((m) => { self.EB_MAQUETTE = m; }, { compte: { name: p.moi.displayName, username: p.moi.mail, localAccountId: p.moi.id }, permissions: [] });
  const reglages = {};
  if (opts.palette === "bleu") reglages.palette = "bleu";
  if (opts.texte) reglages.texte = opts.texte;
  if (Object.keys(reglages).length) await contexte.addInitScript((r) => localStorage.setItem("eb:reglages", JSON.stringify(r)), reglages);
  if (opts.choix) await contexte.addInitScript(([k, c]) => localStorage.setItem(k, JSON.stringify({ choix: c })), ["eb:usages:" + p.moi.id, opts.choix]);
  if (opts.stockageBloque) await contexte.addInitScript(() => {
    const vrai = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (String(k).indexOf("eb:usages:") === 0) throw new Error("QuotaExceededError"); return vrai.call(this, k, v); };
  });
  if (opts.policeAgrandie) await contexte.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
    const s = document.createElement("style"); s.textContent = "html { font-size: 130% !important; }"; document.head.appendChild(s);
  }));
  const R = reponses(p);
  await contexte.route(/https:\/\/(graph\.microsoft\.com|[a-z0-9-]+\.sharepoint\.com)\/.*/, async (route) => {
    const req = route.request(), url = new URL(req.url()), chemin = decodeURIComponent(url.pathname);
    if (/\/photos\//.test(url.pathname)) return route.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "image/png" }, body: PNG });
    if (req.method() !== "GET") return route.fulfill({ status: 204, headers: CORS, body: "" });
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(R[chemin] || { value: [] }) });
  });
  await contexte.route("https://belfort-api.damien-belfort.workers.dev/**", (r) => r.fulfill({ status: 200, headers: CORS, body: /aide/.test(r.request().url()) ? JSON.stringify({ prestataire: false, demandes: [] }) : "{}" }));
  const page = await contexte.newPage();
  const erreurs = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) erreurs.push(m.text()); });
  page.on("pageerror", (e) => erreurs.push(String(e)));
  return { contexte, page, erreurs };
}
const usagesProposes = (page) => page.$$eval(".carte-usage", (l) => l.map((b) => b.dataset.usage));
const texte = (page, sel) => page.textContent(sel);

const serveur = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: RACINE, stdio: "ignore" });
await new Promise((ok) => setTimeout(ok, 800));
const navigateur = await chromium.launch();
try {
  for (const [taille, vp] of [["375", { width: 375, height: 812 }], ["1280", { width: 1280, height: 900 }]]) {
    for (const palette of ["creme", "bleu"]) {
      const ou = `${taille} ${palette}`;
      /* ---------- Gestionnaire : premier lancement ---------- */
      {
        const { contexte, page, erreurs } = await nouvellePage(navigateur, { profil: "gestionnaire", vp, palette });
        await page.goto(BASE);
        await page.waitForSelector('[data-action="bienvenue-continuer"]');
        assert.equal(await page.isVisible("#onglets"), false, `${ou} : pas d'onglets pendant le premier lancement`);
        assert.match(await texte(page, ".carte-role h2"), /Vous êtes : Gestionnaire/, `${ou} : niveau réel`);
        assert.equal(await page.$(".carte-role .nepeut"), null, `${ou} : gestionnaire, rien d'interdit`);
        assert.match(await texte(page, ".barre h1"), /Bienvenue, Pauline/);
        await sansDebord(page, `${ou} bienvenue`);
        if (palette === "creme") await capturer(page, `bienvenue-role-${taille}`);
        await page.click('[data-action="bienvenue-continuer"]');
        await page.waitForSelector(".carte-usage");
        assert.equal(await texte(page, "h2.question"), "Qu'allez-vous faire surtout ici ?");
        assert.deepEqual(await usagesProposes(page), ["planning", "equipe", "perso", "acces", "suivi"], `${ou} : choix selon les droits`);
        await page.click('.carte-usage[data-usage="acces"]');
        await page.click('.carte-usage[data-usage="planning"]');
        assert.deepEqual(await page.$$eval('.carte-usage[aria-pressed="true"] .ordre', (l) => l.map((x) => x.textContent)), ["2", "1"], `${ou} : numéros d'ordre (planning 2e, accès 1er)`);
        await sansDebord(page, `${ou} questionnaire`);
        await capturer(page, `questionnaire-${taille}-${palette}`);
        await page.click('[data-action="usages-valider"]');
        await page.waitForFunction(() => location.hash === "#/acces/Commun", null, { timeout: 5000 });
        assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem("eb:usages:u1"))).choix, ["acces", "planning"], `${ou} : choix gardé par compte`);
        // Accueil : mes choix d'abord, dans l'ordre.
        await page.goto(BASE + "#/accueil");
        await page.waitForSelector(".tuiles-grandes [data-usage]");
        await page.waitForFunction(() => document.querySelectorAll("#onglets a").length === 5);
        assert.deepEqual(await page.$$eval("#onglets a", (l) => l.map((a) => a.dataset.onglet)), ["accueil", "planning", "fichiers", "equipe", "moi"]);
        assert.deepEqual(await page.$$eval('[aria-labelledby="t-mes-usages"] [data-usage]', (l) => l.map((a) => a.dataset.usage)), ["acces", "planning"], `${ou} : accueil dans l'ordre choisi`);
        assert.deepEqual(await page.$$eval('[aria-labelledby="t-autres"] [data-usage]', (l) => l.map((a) => a.dataset.usage)), ["equipe", "perso", "suivi"]);
        await sansDebord(page, `${ou} accueil`);
        await capturer(page, `accueil-${taille}-${palette}`);
        // Rechargement : plus de questionnaire, écran ouvert = 1er choix.
        await page.goto(BASE);
        await page.waitForFunction(() => location.hash === "#/acces/Commun", null, { timeout: 5000 });
        assert.equal(await page.$('[data-action="bienvenue-continuer"]'), null);
        // Gérer (ici l'onglet Équipe) : tuile Suivi informatique.
        await page.goto(BASE + "#/equipe");
        await page.waitForSelector('.tuiles-grandes a[data-action="suivi"]');
        assert.equal(await page.getAttribute('.tuiles-grandes a[data-action="suivi"]', "href"), "#/suivi");
        assert.match(await texte(page, '.tuiles-grandes a[data-action="suivi"]'), /🛠️Suivi informatique.*Ce que Damien a fait/);
        if (palette === "creme") await capturer(page, `equipe-${taille}`);
        // Tutoriel : « Ranger un document de l'équipe » → bouton entouré + bulle ; Échap ferme.
        await page.goto(BASE + "#/comment-faire");
        await page.waitForSelector(".carte-tache");
        const taches = await page.$$eval(".carte-tache", (l) => l.map((x) => x.dataset.tache));
        assert.ok(taches.includes("prive") && taches.includes("ranger") && taches.includes("suivi"), `${ou} : tâches du gestionnaire ${taches}`);
        await page.click('.carte-tache[data-tache="ranger"] [data-action="montrer"]');
        await page.waitForSelector('.eb-montre[data-action="televerser-commun"]', { timeout: 8000 });
        await page.waitForSelector(".bulle-tuto");
        assert.equal((await texte(page, ".bulle-tuto")).trim(), "👆Touchez ici");
        assert.equal(await page.evaluate(() => location.hash), "#/commun/Commun");
        await page.waitForTimeout(500);
        await capturer(page, `tutoriel-surbrillance-${taille}-${palette}`, false);
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.querySelector(".eb-montre") && !document.querySelector(".bulle-tuto"));
        // Toucher ailleurs ferme aussi.
        await page.goto(BASE + "#/comment-faire");
        await page.click('.carte-tache[data-tache="prive"] [data-action="montrer"]');
        await page.waitForSelector(".tuile-menu.eb-montre", { timeout: 8000 });
        await page.mouse.click(5, vp.height - 5);
        await page.waitForFunction(() => !document.querySelector(".eb-montre"));
        // Écran dossier : fil d'Ariane sur une ligne, boutons carrés de même taille, aucun chevauchement.
        await page.goto(BASE + "#/commun/Commun/François et Pauline");
        await page.waitForSelector(".boutons-carres .bc");
        assert.equal(await texte(page, ".ariane"), "Documents de l'équipe›François et Pauline");
        const bc = await page.$$eval(".boutons-carres .bc", (l) => l.map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent, w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.top) }; }));
        assert.deepEqual(bc.map((b) => b.t), ["Ajouter un document", "Créer un dossier", "Qui peut ouvrir ?"]);
        assert.equal(new Set(bc.map((b) => b.w)).size, 1, `${ou} : même largeur ${JSON.stringify(bc)}`);
        assert.equal(new Set(bc.map((b) => b.h)).size, 1, `${ou} : même hauteur`);
        assert.equal(new Set(bc.map((b) => b.y)).size, 1, `${ou} : sur une rangée`);
        assert.ok(bc.every((b) => b.h >= 48 && b.w >= 48));
        const ariane = await page.$eval(".ariane", (n) => ({ h: n.getBoundingClientRect().height, l: parseFloat(getComputedStyle(n).lineHeight) || 20 }));
        assert.ok(ariane.h < ariane.l * 1.9, `${ou} : fil d'Ariane sur une ligne (${ariane.h})`);
        await sansChevauchement(page, ".ecran .barre h1, .ariane a, .ariane span, .bc-lib, .tuile b, .fichier span", null, `${ou} dossier`);
        // Feuille d'actions d'un dossier : lignes qui grandissent avec le texte.
        await page.goto(BASE + "#/commun/Commun");
        await page.waitForSelector(".tuile-menu");
        await page.click(".tuile-menu");
        await page.waitForSelector("dialog[open] .choix");
        assert.deepEqual(await page.$$eval("dialog .choix b", (l) => l.map((b) => b.textContent)), ["Ouvrir", "Choisir qui peut l'ouvrir", "Changer le nom", "Ranger ailleurs", "Copier un lien", "Épingler sur l'accueil"]);
        await sansChevauchement(page, "dialog .choix b, dialog .choix small", "dialog .choix", `${ou} feuille`);
        await page.keyboard.press("Escape");
        if (erreurs.length) problemes.push(`${ou} gestionnaire : erreurs console ${erreurs.join(" | ")}`);
        await contexte.close();
      }
      /* ---------- Lecteur : niveau, « Plus tard », actions cachées ---------- */
      {
        const { contexte, page, erreurs } = await nouvellePage(navigateur, { profil: "lecteur", vp, palette });
        await page.goto(BASE);
        await page.waitForSelector(".carte-role");
        assert.match(await texte(page, ".carte-role h2"), /Vous êtes : Lecteur/);
        assert.match(await texte(page, ".carte-role .nepeut"), /Ajouter ou modifier des documents de l'équipe/);
        await page.waitForFunction(() => /Pauline de Breteuil/.test(document.querySelector(".qui-demander")?.textContent || ""));
        assert.match(await texte(page, ".carte-role .demander"), /Pour cela, demandez à : (Pauline de Breteuil et François de Breteuil|François de Breteuil et Pauline de Breteuil)/);
        if (palette === "creme") await capturer(page, `bienvenue-lecteur-${taille}`);
        await page.click('[data-action="bienvenue-continuer"]');
        await page.waitForSelector(".carte-usage");
        assert.deepEqual(await usagesProposes(page), ["planning", "equipe", "perso"], `${ou} : lecteur, rien de réservé`);
        await page.click('[data-action="plus-tard"]');
        await page.waitForFunction(() => location.hash === "#/accueil");
        await page.waitForSelector('[aria-labelledby="t-que-faire"] [data-usage]');
        assert.equal(await page.evaluate(() => localStorage.getItem("eb:usages:u4")), null, "Plus tard : rien d'enregistré");
        // Pas redemandé pendant la session.
        await page.click('#onglets a[data-onglet="planning"]');
        await page.waitForFunction(() => location.hash === "#/planning");
        assert.equal(await page.$(".carte-usage, .carte-role"), null);
        // Moi : même carte.
        await page.click('#onglets a[data-onglet="moi"]');
        await page.waitForSelector(".carte-role");
        assert.match(await texte(page, ".carte-role h2"), /Lecteur/);
        // Documents de l'équipe : aucune action d'ajout (cachées, pas grisées).
        await page.goto(BASE + "#/commun/Commun");
        await page.waitForSelector(".tuile-menu");
        assert.equal(await page.$$eval('[data-action="televerser-commun"], [data-action="nouveau-dossier"], [data-action="qui-peut-ouvrir"], [disabled]', (l) => l.length), 0, `${ou} : actions d'ajout cachées`);
        await page.click(".tuile-menu");
        await page.waitForSelector("dialog[open] .choix");
        assert.deepEqual(await page.$$eval("dialog .choix b", (l) => l.map((b) => b.textContent)), ["Ouvrir", "Copier un lien", "Épingler sur l'accueil"]);
        await page.keyboard.press("Escape");
        // Comment faire ? : pas de tâche réservée.
        await page.goto(BASE + "#/comment-faire");
        await page.waitForSelector(".carte-tache");
        const t = await page.$$eval(".carte-tache", (l) => l.map((x) => x.dataset.tache));
        assert.ok(!t.includes("ranger") && !t.includes("prive") && !t.includes("suivi"), `${ou} : tâches du lecteur ${t}`);
        assert.equal(await page.$('#onglets a[data-onglet="gerer"], #onglets a[data-onglet="equipe"]'), null);
        await page.goto(BASE + "#/suivi");
        await page.waitForFunction(() => location.hash === "#/planning", null, { timeout: 5000 });
        if (erreurs.length) problemes.push(`${ou} lecteur : erreurs console ${erreurs.join(" | ")}`);
        await contexte.close();
      }
      /* ---------- Administrateur : onglet Gérer avec la tuile Suivi informatique ---------- */
      {
        const { contexte, page, erreurs } = await nouvellePage(navigateur, { profil: "admin", vp, palette, choix: ["suivi"] });
        await page.goto(BASE);
        await page.waitForFunction(() => location.hash === "#/suivi", null, { timeout: 5000 });
        await page.goto(BASE + "#/gerer");
        await page.waitForSelector('.tuiles-grandes a[data-action="suivi"]');
        const titres = await page.$$eval(".ecran .section > h2", (l) => l.map((x) => x.textContent));
        assert.deepEqual(titres, ["Informatique", "Équipe", "Factures", "Administration", "Site internet"], `${ou} : sections de Gérer`);
        const tuiles = await page.$$eval(".tuiles-grandes .t.gt", (l) => l.map((a) => { const r = a.getBoundingClientRect(); return { lib: a.querySelector(".lib").textContent, sous: a.querySelector(".sous")?.textContent || "", h: r.height }; }));
        assert.ok(tuiles.every((x) => x.sous && x.h >= 64), `${ou} : chaque tuile a une ligne d'explication`);
        await sansChevauchement(page, ".tuiles-grandes .lib, .tuiles-grandes .sous", ".t.gt", `${ou} gérer`);
        await sansDebord(page, `${ou} gérer`);
        await capturer(page, `gerer-${taille}-${palette}`);
        if (erreurs.length) problemes.push(`${ou} admin : erreurs console ${erreurs.join(" | ")}`);
        await contexte.close();
      }
      console.log("ok", ou);
    }
  }

  /* ---------- Téléphone Android : 412 px, sombre, police agrandie (130 % + « Très grand ») ---------- */
  for (const palette of ["creme", "bleu"]) {
    const ou = `412 sombre police agrandie ${palette}`;
    const { contexte, page, erreurs } = await nouvellePage(navigateur, { profil: "gestionnaire", vp: { width: 412, height: 915 }, palette, theme: "dark", texte: "tres-grand", policeAgrandie: true, choix: ["equipe"] });
    await page.goto(BASE + "#/commun/Commun");
    await page.waitForSelector(".tuile-menu");
    await sansDebord(page, `${ou} dossier`);
    await sansChevauchement(page, ".ecran .barre h1, .ariane a, .ariane span, .bc-lib, .tuile b, .tuile .sous, .fichier span", null, `${ou} dossier`);
    await capturer(page, `grand-texte-dossier-412-${palette}`);
    await page.click('.tuile:has([data-nom="François et Pauline"]) .tuile-menu');
    await page.waitForSelector("dialog[open] .choix");
    await sansChevauchement(page, "dialog .choix b, dialog .choix small", "dialog .choix", `${ou} feuille`);
    const defile = await page.$eval("dialog[open]", (d) => getComputedStyle(d).overflowY);
    assert.ok(/auto|scroll/.test(defile), `${ou} : la feuille défile si trop haute`);
    await capturer(page, `grand-texte-feuille-412-${palette}`, false);
    // En-tête derrière la feuille : voilé net (flou), pas « grisé ».
    assert.match(await page.$eval("dialog[open]", (d) => getComputedStyle(d, "::backdrop").backdropFilter), /blur/);
    await page.keyboard.press("Escape");
    await page.goto(BASE + "#/fichiers");
    await page.waitForSelector('[data-action="ouvrir-commun"]');
    await sansChevauchement(page, ".t.gt .lib, .t.gt .sous, .bc-lib, .fichier span, .section h2", null, `${ou} documents`);
    await capturer(page, `grand-texte-documents-412-${palette}`);
    await page.goto(BASE + "#/accueil");
    await page.waitForSelector(".tuiles-grandes [data-usage]");
    await sansChevauchement(page, ".t.gt .lib, .t.gt .sous", ".t.gt", `${ou} accueil`);
    await sansDebord(page, `${ou} accueil`);
    if (erreurs.length) problemes.push(`${ou} : erreurs console ${erreurs.join(" | ")}`);
    await contexte.close();
    console.log("ok", ou);
  }

  /* ---------- Stockage bloqué (navigation privée stricte) : l'appli marche, pas de boucle ---------- */
  {
    const { contexte, page, erreurs } = await nouvellePage(navigateur, { profil: "gestionnaire", vp: { width: 375, height: 812 }, stockageBloque: true });
    await page.goto(BASE);
    await page.click('[data-action="bienvenue-continuer"]');
    await page.click('.carte-usage[data-usage="equipe"]');
    await page.click('[data-action="usages-valider"]');
    await page.waitForFunction(() => location.hash === "#/commun/Commun", null, { timeout: 5000 });
    await page.click('#onglets a[data-onglet="accueil"]');
    await page.waitForSelector('[aria-labelledby="t-mes-usages"] [data-usage="equipe"]');
    assert.equal(await page.$(".carte-usage"), null, "stockage bloqué : pas redemandé dans la session");
    if (erreurs.length) problemes.push(`stockage bloqué : erreurs console ${erreurs.join(" | ")}`);
    await contexte.close();
  }
} finally {
  await navigateur.close();
  serveur.kill();
}
if (problemes.length) { console.error("PROBLÈMES :\n- " + problemes.join("\n- ")); process.exit(1); }
console.log(`Simplification : tout est bon (${captures} captures).`);
