// v5.5 « Simplification » — réponses Microsoft MAQUETTÉES, données FICTIVES.
// Lancer depuis la racine du dépôt (Chromium déjà installé) :
//   EB_PORT=8798 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=$(npm root -g) node espace-breteuil/tests/simplification.playwright.mjs [dossier-captures]
// Contrôles à 375 et 1280 px, palettes crème et Bleu élégant :
//   - premier lancement : carte « Vous êtes : Gestionnaire / Lecteur » (droits RÉELS), questionnaire filtré par les droits,
//     ordre des choix, écran ouvert = 1er choix, choix gardé par compte, « Plus tard », stockage bloqué ;
//   - Accueil : tuiles dans l'ordre choisi ; Moi : carte du niveau ; Lecteur : actions d'ajout CACHÉES (pas grisées) ;
//   - « Comment faire ? » → « Montrez-moi » : bon écran, bouton entouré, bulle « Touchez ici », Échap / toucher ferme ;
//   - Gérer : tuile « 🛠️ Suivi informatique » → #/suivi (mêmes profils que #/suivi) ;
//   - feuille d'actions et écran dossier : AUCUN texte ne chevauche un autre (aussi en police agrandie, 412 px, sombre) ;
//   - fil d'Ariane sur une ligne, boutons d'action de même taille, aucune erreur console, pas de défilement horizontal ;
//   - v5.5.1 « Qui fait quoi » (412 sombre police agrandie, 1280 clair et sombre) : boîtes partagées toujours dans
//     « Les adresses partagées » (avec ou sans licence, liste config.js ou userPurpose), photo de FetP, groupe
//     « Prestataire informatique », « Sans licence » = vraies personnes, noms longs sans chevauchement, homonymes.
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

/* ---------- v5.5.1 « Qui fait quoi » : annuaire proche du vrai (données FICTIVES pour les personnes) ---------- */
const STD = "sku-std", BAS = "sku-bas";
const SKUS = [{ skuId: STD, skuPartNumber: "O365_BUSINESS_PREMIUM", prepaidUnits: { enabled: 25 }, consumedUnits: 20 },
  { skuId: BAS, skuPartNumber: "O365_BUSINESS_ESSENTIALS", prepaidUnits: { enabled: 10 }, consumedUnits: 4 }];
const qu = (id, nom, mail, sku, extra = {}) => ({ id, displayName: nom, givenName: extra.givenName === undefined ? nom.split(" ")[0] : extra.givenName, mail, userPrincipalName: extra.upn || mail || "",
  userType: "Member", accountEnabled: true, assignedLicenses: sku ? [{ skuId: sku }] : [] });
// Les 11 adresses de service converties en boîtes partagées, encore avec une licence d'essai Business Standard (sauf 4).
const BOITES_SERVICE = [["chanteclerc", "chanteclerc", STD], ["chanteclercdeveloppement", "Développement", STD], ["escapegame", "Escape game", null], ["hfb", "hfb", STD],
  ["intendance", "Intendance", STD], ["jardins", "Jardins", null], ["jecharrault", "jecharrault", null], ["klefur", "Klefur", STD], ["marketing", "Marketing", null],
  ["newsletter", "newsletter", STD], ["travaux", "Travaux", STD]];
function annuaireQfq(licencesRetirees) {
  return [
    qu("q1", "Pauline de Breteuil", "pdebreteuil@breteuil.fr", STD), qu("q2", "François de Breteuil", "fdebreteuil@breteuil.fr", STD),
    qu("q3", "Valérie Durand", "vdurand@breteuil.fr", STD), qu("q4", "Valérie Martin", "vmartin@breteuil.fr", BAS),
    qu("q5", "Fanny Martin", "fmartin@breteuil.fr", BAS), qu("q6", "Maximilien-Alexandre de Montmorency", "mmontmorency@breteuil.fr", STD),
    qu("q7", "Accueilbilletterieboutiquechateau", "accueil@breteuil.fr", STD, { givenName: "" }),
    qu("q8", "Camille Roux", "croux@breteuil.fr", null),
    qu("q9", "Damien", null, null, { upn: "damien@breteuil02.onmicrosoft.com" }),
    qu("q10", "FetP", "fetpdebreteuil@breteuil.fr", null),
    qu("q11", "Réservations", "reservations@breteuil.fr", STD), // boîte repérée seulement par userPurpose
    ...BOITES_SERVICE.map(([id, nom, sku], i) => qu("b" + i, nom, id + "@breteuil.fr", licencesRetirees ? null : sku, { givenName: "" })),
  ];
}
const QFQ_PHOTOS = ["q1", "q10"]; // Pauline et FetP ont une photo ; les autres non (404)

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
      // Texte coupé exprès (overflow caché, ex. nom sur 2 lignes puis « … ») : les lignes masquées ne comptent pas.
      const coupe = getComputedStyle(el).overflow !== "visible" ? el.getBoundingClientRect() : null;
      for (const q of range.getClientRects()) if (q.width > 1 && q.height > 1 && (!coupe || q.top < coupe.bottom - 1)) rects.push({ t: el.textContent.trim().slice(0, 30), x: q.left, y: q.top, r: q.right, b: q.bottom, el });
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
  await contexte.addInitScript((m) => { self.EB_MAQUETTE = m; }, { compte: { name: p.moi.displayName, username: p.moi.mail, localAccountId: p.moi.id }, permissions: [], ...(opts.scopes ? { scopes: { graph: opts.scopes } } : {}), ...(opts.deconnecte ? { deconnecte: true } : {}) });
  // Réglages de config.js propres au test (ex. prestataires, vide dans le dépôt) : posés au chargement de config.js.
  if (opts.config) await contexte.addInitScript((extra) => {
    let c; Object.defineProperty(self, "EB_CONFIG", { configurable: true, get: () => c, set: (v) => { c = Object.assign(v, extra); } });
  }, opts.config);
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
  const R = { ...reponses(p), ...(opts.reponses || {}) };
  await contexte.route(/https:\/\/(graph\.microsoft\.com|[a-z0-9-]+\.sharepoint\.com)\/.*/, async (route) => {
    const req = route.request(), url = new URL(req.url()), chemin = decodeURIComponent(url.pathname);
    if (/\/photos\//.test(url.pathname)) {
      const id = (/\/users\/([^/]+)\/photos/.exec(chemin) || [])[1];
      if (opts.photos && !opts.photos.includes(id)) return route.fulfill({ status: 404, headers: CORS, body: "{}" });
      return route.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "image/png" }, body: PNG });
    }
    const usage = /^\/v1\.0\/users\/([^/]+)\/mailboxSettings\/userPurpose$/.exec(chemin);
    if (usage) return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ value: usage[1] === "q11" ? "shared" : "user" }) });
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
// Les titres utilisent des espaces insécables avant « ? : ! » : comparaison sur des espaces simples.
const texte = async (page, sel) => String(await page.textContent(sel)).replace(/\u00a0/g, " ");
/** Le bouton « ? » flottant ne couvre aucun contrôle de l'écran (en bas de page, là où il se pose). */
async function fabLibre(page, ou) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await calme(page);
  const r = await page.evaluate(() => {
    const f = document.querySelector(".aide-fab"); if (!f || getComputedStyle(f).display === "none") return [];
    const a = f.getBoundingClientRect();
    return [...document.querySelectorAll(".ecran a, .ecran button, .ecran input")].filter((e) => e.offsetParent !== null).filter((e) => {
      const b = e.getBoundingClientRect();
      return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
    }).map((e) => (e.textContent || "").trim().slice(0, 30));
  });
  if (r.length) problemes.push(`${ou} : le bouton « ? » couvre : ${r.join(" | ")}`);
}

/** Options de page pour « Qui fait quoi » (annuaire réaliste, prestataire configuré, userPurpose lisible). */
function optsQfq(licencesRetirees) {
  return { profil: "admin", photos: QFQ_PHOTOS, config: { prestataires: ["damien@breteuil02.onmicrosoft.com"] },
    scopes: ["User.Read", "User.Read.All", "Directory.Read.All", "MailboxSettings.Read"],
    reponses: { "/v1.0/users": { value: annuaireQfq(licencesRetirees) }, "/v1.0/subscribedSkus": { value: SKUS } } };
}
/** « Qui fait quoi » : rangement, photos, homonymes, noms longs. */
async function verifierQfq(page, ou, licencesRetirees) {
  await page.goto(BASE + "#/organisation");
  await page.waitForSelector(".pastille-demo.reel");
  await page.waitForSelector('.ligne-boite[data-boite="fetpdebreteuil@breteuil.fr"] .eb-anneau.photo img', { timeout: 8000 });
  const r = await page.evaluate(() => {
    const groupes = [...document.querySelectorAll(".groupe-schema[data-groupe]")].map((g) => ({ g: g.dataset.groupe,
      noms: [...g.querySelectorAll(".visage")].map((v) => v.getAttribute("title")) }));
    const boites = [...document.querySelectorAll(".ligne-boite")].map((l) => l.dataset.boite).sort();
    const photos = [...document.querySelectorAll(".ligne-boite")].filter((l) => l.querySelector(".eb-anneau img")).map((l) => l.dataset.boite);
    const fetp = document.querySelector('.ligne-boite[data-boite="fetpdebreteuil@breteuil.fr"]');
    const ordreFetp = fetp ? [...fetp.children].slice(0, 2).map((e) => e.className.split(" ")[0]) : [];
    const homonymes = [...document.querySelectorAll(".adresse-visage")].map((s) => s.textContent);
    // Chaque nom tient dans sa cellule (largeur), sur 2 lignes au plus.
    const debords = [...document.querySelectorAll(".groupe-schema .visage")].filter((v) => {
      const n = v.querySelector(".nom-visage"), a = v.getBoundingClientRect(), b = n.getBoundingClientRect();
      const lignes = Math.round(b.height / parseFloat(getComputedStyle(n).lineHeight));
      return b.left < a.left - 1 || b.right > a.right + 1 || lignes > 2;
    }).map((v) => v.getAttribute("title"));
    const largeurs = new Set([...document.querySelectorAll(".groupe-schema:not(.prestataire) .visage")].map((v) => Math.round(v.getBoundingClientRect().width)));
    return { groupes, boites, photos, ordreFetp, homonymes, debords, largeurs: [...largeurs] };
  });
  const attendues = ["chanteclerc", "chanteclercdeveloppement", "escapegame", "fetpdebreteuil", "hfb", "intendance", "jardins", "jecharrault", "klefur",
    "marketing", "newsletter", "reservations", "travaux"].map((x) => x + "@breteuil.fr").sort();
  assert.deepEqual(r.boites, attendues, `${ou} : toutes les boîtes partagées (licence ou pas) dans « Les adresses partagées »`);
  assert.deepEqual(r.groupes.map((g) => g.g), ["standard", "basic", "aucune", "prestataire"], `${ou} : groupes ${JSON.stringify(r.groupes)}`);
  const de = (g) => r.groupes.find((x) => x.g === g).noms;
  assert.deepEqual(de("standard").sort(), ["Accueilbilletterieboutiquechateau", "François de Breteuil", "Maximilien-Alexandre de Montmorency", "Pauline de Breteuil", "Valérie Durand (vdurand)"].sort(), `${ou} : Business Standard sans les boîtes`);
  assert.deepEqual(de("basic").sort(), ["Fanny Martin", "Valérie Martin (vmartin)"], `${ou} : Business Basic`);
  assert.deepEqual(de("aucune"), ["Camille Roux"], `${ou} : Sans licence = vraies personnes seulement`);
  assert.deepEqual(de("prestataire"), ["Damien"], `${ou} : Prestataire informatique`);
  assert.deepEqual(r.photos, ["fetpdebreteuil@breteuil.fr"], `${ou} : photo de FetP, enveloppe pour les autres`);
  assert.deepEqual(r.ordreFetp, ["eb-anneau", "quoi"], `${ou} : photo puis nom/adresse`);
  assert.equal(await page.textContent('.ligne-boite[data-boite="fetpdebreteuil@breteuil.fr"] .quoi'), "FetPfetpdebreteuil@breteuil.fr");
  assert.deepEqual(r.homonymes.sort(), ["vdurand", "vmartin"], `${ou} : deux « Valérie » distinguées`);
  assert.deepEqual(r.debords, [], `${ou} : noms qui sortent de leur cellule ou sur plus de 2 lignes`);
  assert.equal(r.largeurs.length, 1, `${ou} : cellules de même largeur ${r.largeurs}`);
  await sansChevauchement(page, ".groupe-schema .nom-visage, .groupe-schema .adresse-visage, .titre-groupe-schema, .ligne-boite .quoi b, .ligne-boite .quoi small", ".visage, .ligne-boite", `${ou} qui fait quoi`);
  await sansDebord(page, `${ou} qui fait quoi`);
  if (!licencesRetirees) {
    // Abonnements : les boîtes qui gardent une licence sont signalées.
    await page.goto(BASE + "#/licences-reel");
    await page.waitForSelector(".carte-profil.standard .boites-licence");
    assert.match(await page.textContent(".carte-profil.standard .boites-licence"), /Dont 8 adresses partagées qui utilisent encore cette licence/);
    assert.equal(await page.$(".carte-profil.basic .boites-licence"), null);
    await page.goto(BASE + "#/organisation");
    await page.waitForSelector('.ligne-boite[data-boite="fetpdebreteuil@breteuil.fr"] .eb-anneau.photo img', { timeout: 8000 });
  }
}

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
        assert.equal(await page.isVisible(".aide-fab"), false, `${ou} : pas de bouton « ? » au premier lancement`);
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
        assert.equal(await page.isVisible(".aide-fab"), false, `${ou} : pas de bouton « ? » sur le questionnaire`);
        assert.ok(!/ \?$/.test(await page.textContent("h2.question")), "espace insécable avant « ? »");
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
        assert.equal(await page.isVisible(".aide-fab"), true, `${ou} : bouton « ? » revenu après le premier lancement`);
        await fabLibre(page, `${ou} accueil`);
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
        const bc = await page.$$eval(".boutons-carres .bc", (l) => l.map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.replace(/\u00a0/g, " "), w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.top) }; }));
        assert.deepEqual(bc.map((b) => b.t), ["Ajouter un document", "Créer un dossier", "Qui peut ouvrir ?"]);
        assert.equal(new Set(bc.map((b) => b.w)).size, 1, `${ou} : même largeur ${JSON.stringify(bc)}`);
        assert.equal(new Set(bc.map((b) => b.h)).size, 1, `${ou} : même hauteur`);
        assert.equal(new Set(bc.map((b) => b.y)).size, 1, `${ou} : sur une rangée`);
        assert.ok(bc.every((b) => b.h >= 48 && b.w >= 48));
        assert.match(await page.textContent('[data-action="qui-peut-ouvrir"]'), /ouvrir\u00a0\?/, "« Qui peut ouvrir ? » : espace insécable");
        await fabLibre(page, `${ou} dossier`);
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
        await fabLibre(page, `${ou} gérer`);
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
    await fabLibre(page, `${ou} accueil`);
    await sansDebord(page, `${ou} accueil`);
    if (erreurs.length) problemes.push(`${ou} : erreurs console ${erreurs.join(" | ")}`);
    await contexte.close();
    // v5.5.1 « Qui fait quoi » : même téléphone, annuaire réaliste (boîtes à licence d'essai, FetP, Damien, deux Valérie).
    {
      const { contexte, page, erreurs } = await nouvellePage(navigateur, { ...optsQfq(false), vp: { width: 412, height: 915 }, palette, theme: "dark", texte: "tres-grand", policeAgrandie: true, choix: ["equipe"] });
      await verifierQfq(page, `${ou} (licences d'essai)`, false);
      await capturer(page, `qui-fait-quoi-412-sombre-grand-${palette}`);
      if (erreurs.length) problemes.push(`${ou} qui fait quoi : erreurs console ${erreurs.join(" | ")}`);
      await contexte.close();
    }
    console.log("ok", ou);
  }

  /* ---------- v5.5.1 « Qui fait quoi » à 1280 px, clair et sombre ; avant et après le retrait des licences ---------- */
  for (const theme of ["light", "dark"]) {
    for (const retirees of [false, true]) {
      const ou = `qui fait quoi 1280 ${theme}${retirees ? " licences retirées" : ""}`;
      const { contexte, page, erreurs } = await nouvellePage(navigateur, { ...optsQfq(retirees), vp: { width: 1280, height: 900 }, theme, choix: ["equipe"] });
      await verifierQfq(page, ou, retirees);
      if (!retirees) await capturer(page, `qui-fait-quoi-1280-${theme === "light" ? "clair" : "sombre"}`);
      if (erreurs.length) problemes.push(`${ou} : erreurs console ${erreurs.join(" | ")}`);
      await contexte.close();
      console.log("ok", ou);
    }
  }

  /* ---------- v5.5.1 Site web : encadré « 🔑 Accès au site à prévoir » (accesPret false par défaut) ---------- */
  for (const [nomVp, vp, extra] of [["375 clair", { width: 375, height: 812 }, {}], ["412 sombre police agrandie", { width: 412, height: 915 }, { theme: "dark", texte: "tres-grand", policeAgrandie: true }],
    ["1280 sombre", { width: 1280, height: 900 }, { theme: "dark" }]]) {
    const ou = `site web ${nomVp}`;
    const { contexte, page, erreurs } = await nouvellePage(navigateur, { profil: "admin", vp, choix: ["equipe"], ...extra });
    for (const route of ["#/gerer", "#/liens", "#/guides/site", "#/guides/site/pied"]) {
      await page.goto(BASE + route);
      await page.waitForSelector('[data-encadre="acces-site"]');
      assert.equal(await page.$$eval('[data-encadre="acces-site"]', (l) => l.length), 1, `${ou} ${route} : un seul encadré`);
      const enTete = await page.evaluate(() => { const e = document.querySelector('[data-encadre="acces-site"]'), p = e.parentElement;
        return p.classList.contains("section-site") ? p.querySelector("h2").nextElementSibling === e : e.previousElementSibling?.classList.contains("barre"); });
      assert.ok(enTete, `${ou} ${route} : encadré en tête`);
      assert.equal(await page.$$eval('.ecran a[href*="wp-admin"]', (l) => l.length), 0, `${ou} ${route} : aucun bouton vers l'administration WordPress`);
      await sansChevauchement(page, ".encadre-acces .titre, .encadre-acces .texte, .encadre-acces .btn", ".encadre-acces", `${ou} ${route}`);
      await sansDebord(page, `${ou} ${route}`);
    }
    // Le mode d'emploi reste lisible, le bouton WordPress est remplacé par une phrase.
    assert.equal(await page.$$eval(".etapes li", (l) => l.length), 3);
    assert.match(await texte(page, ".acces-attente"), /« Ouvrir les modèles » apparaîtra quand l'accès au site sera prêt/);
    await page.goto(BASE + "#/gerer");
    await page.waitForSelector('[data-encadre="acces-site"]');
    assert.equal(await texte(page, '[data-encadre="acces-site"] .titre'), "🔑 Accès au site à prévoir");
    assert.match(await texte(page, '[data-encadre="acces-site"] .texte'), /compte WordPress « éditeur » et l'accord de M\. Defecques.*rien n'est modifié\./);
    await page.evaluate(() => document.querySelector(".section-site").scrollIntoView());
    await capturer(page, `site-acces-a-prevoir-${nomVp.replace(/ /g, "-")}`, false);
    // « Écrire à Damien » : panneau d'aide, type Question, message pré-rempli.
    await page.click('[data-action="ecrire-acces-site"]');
    await page.waitForSelector("dialog[open] #aide-message");
    assert.equal(await page.inputValue("#aide-message"), "Je souhaite pouvoir modifier le site internet.");
    assert.equal(await page.getAttribute('.aide-type[data-type="question"]', "aria-checked"), "true");
    await capturer(page, `site-acces-ecrire-${nomVp.replace(/ /g, "-")}`, false);
    if (erreurs.length) problemes.push(`${ou} : erreurs console ${erreurs.join(" | ")}`);
    await contexte.close();
    console.log("ok", ou);
  }
  /* accesPret: true → plus d'encadré, les boutons WordPress reviennent. */
  {
    const { contexte, page, erreurs } = await nouvellePage(navigateur, { profil: "admin", vp: { width: 375, height: 812 }, choix: ["equipe"],
      config: { siteWeb: { url: "https://www.breteuil.fr", admin: "https://www.breteuil.fr/wp-admin/", groupe: "Site web", accesPret: true } } });
    await page.goto(BASE + "#/gerer");
    await page.waitForSelector(".section-site .tuiles-grandes .t");
    assert.equal(await page.$('[data-encadre="acces-site"]'), null, "accès prêt : pas d'encadré");
    assert.ok(await page.$('.section-site a[href="https://www.breteuil.fr/wp-admin/upload.php"][target="_blank"]'), "accès prêt : tuile Médiathèque");
    await page.goto(BASE + "#/guides/site/pied");
    await page.waitForSelector('.actions a[href*="wp-admin"]');
    assert.equal(await page.$(".acces-attente"), null);
    if (erreurs.length) problemes.push(`site web accès prêt : erreurs console ${erreurs.join(" | ")}`);
    await contexte.close();
  }

  /* ---------- v5.5.1 Lien profond ouvert depuis un mail : non connecté → connexion → écran demandé ; 2e onglet déjà connecté ---------- */
  for (const [taille, vp] of [["375", { width: 375, height: 812 }], ["1280", { width: 1280, height: 900 }]]) {
    const ou = `lien profond ${taille}`;
    const { contexte, page, erreurs } = await nouvellePage(navigateur, { profil: "gestionnaire", vp, deconnecte: true, choix: ["equipe"] });
    await page.goto(BASE + "#/comment-faire");
    await page.waitForSelector('[data-action="connexion"]');
    assert.equal(await page.evaluate(() => sessionStorage.getItem("eb:retour")), "#/comment-faire", `${ou} : écran demandé retenu avant la connexion`);
    await page.click('[data-action="connexion"]');
    await page.waitForSelector(".carte-tache");
    assert.equal(await page.evaluate(() => location.hash), "#/comment-faire", `${ou} : arrive sur l'écran demandé (pas « Documents de l'équipe »)`);
    if (taille === "375") await capturer(page, "lien-profond-apres-connexion-375", false);
    // 2e onglet (lien d'un autre mail) : déjà connecté, directement sur l'écran demandé.
    const page2 = await contexte.newPage();
    await page2.goto(BASE + "#/installer");
    await page2.waitForSelector(".ecran .barre h1");
    assert.equal(await page2.$('[data-action="connexion"]'), null, `${ou} : 2e onglet déjà connecté`);
    assert.equal(await page2.evaluate(() => location.hash), "#/installer", `${ou} : 2e onglet sur #/installer`);
    const page3 = await contexte.newPage();
    await page3.goto(BASE + "#/commun/Commun");
    await page3.waitForSelector(".tuile-menu");
    assert.equal(await page3.evaluate(() => location.hash), "#/commun/Commun");
    // Se déconnecter : plus aucune donnée du compte sur l'appareil ; un nouvel onglet redemande la connexion.
    await page3.evaluate(() => { localStorage.setItem("eb:epingles", "[]"); localStorage.setItem("eb:journal", "[]"); });
    await page3.goto(BASE + "#/moi");
    await page3.click('[data-action="deconnexion"]');
    await page3.waitForSelector('[data-action="connexion"]');
    const restes = await page3.evaluate(() => [...Array(localStorage.length).keys()].map((i) => localStorage.key(i)).concat([...Array(sessionStorage.length).keys()].map((i) => sessionStorage.key(i))));
    assert.deepEqual(restes.filter((k) => /^(eb:|msal\.)/.test(k) && k !== "eb:reglages" && !k.startsWith("eb:planning:")), [], `${ou} : clés restantes ${restes}`);
    const page4 = await contexte.newPage();
    await page4.goto(BASE + "#/comment-faire");
    await page4.waitForSelector('[data-action="connexion"]');
    if (erreurs.length) problemes.push(`${ou} : erreurs console ${erreurs.join(" | ")}`);
    await contexte.close();
    console.log("ok", ou);
  }
  /* Premier lancement (questionnaire) : après « C'est parti », retour à l'écran demandé, pas au 1er choix. */
  {
    const { contexte, page, erreurs } = await nouvellePage(navigateur, { profil: "gestionnaire", vp: { width: 375, height: 812 }, deconnecte: true });
    await page.goto(BASE + "#/installer");
    await page.click('[data-action="connexion"]');
    await page.click('[data-action="bienvenue-continuer"]');
    await page.click('.carte-usage[data-usage="equipe"]');
    await page.click('[data-action="usages-valider"]');
    await page.waitForFunction(() => location.hash === "#/installer", null, { timeout: 5000 });
    await page.waitForSelector(".ecran .barre h1");
    assert.equal(await page.$(".carte-usage"), null);
    if (erreurs.length) problemes.push(`lien profond + questionnaire : erreurs console ${erreurs.join(" | ")}`);
    await contexte.close();
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
