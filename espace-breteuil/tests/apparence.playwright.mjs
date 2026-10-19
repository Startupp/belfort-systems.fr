// v5.7 « Apparence, installation, accès » — réponses Microsoft MAQUETTÉES, données FICTIVES.
// Lancer depuis la racine du dépôt (Chromium déjà installé) :
//   EB_PORT=8801 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=$(npm root -g) node espace-breteuil/tests/apparence.playwright.mjs [dossier-captures]
// Contrôles :
//   - Apparence : réservé à qui peut modifier apparence.json ; aperçu ; couleur trop claire refusée ; appliquer (écrit le fichier,
//     tout le monde le reçoit) ; version précédente ; revenir à l'original ; logo (PNG) → icônes + demande à Damien ;
//   - captures 375 / 1280, clair / sombre, 3 palettes (crème d'origine, vert sauge, personnalisée) : Accueil + Apparence ;
//   - Réglages › Couleurs « Comme le Château » par défaut ; choix personnel possible ;
//   - Installer : iPhone Safari (2 gestes), iPhone Chrome (ouvrir dans Safari), Android (invitation en 1 geste),
//     Firefox ordinateur (honnête) ; installée : Gérer l'application, Désinstaller (geste), bandeau « Le logo a changé » ;
//   - Planning public : #/planning sans connexion (aucune redirection), gros bouton « Ajouter à l'écran d'accueil »,
//     appli installée non connectée → planning ; refus Microsoft AADSTS50105 → message clair + « Voir le planning » ;
//   - Qui peut utiliser l'application (Microsoft) : consentement incrémental, prestataire en clair, garde-fous, PATCH ;
//   - Rôles et administrateurs : encadré, taper « RETIRER » ; Bientôt ; partage du lien du planning ; « Application mise à jour ».
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const RACINE = fileURLToPath(new URL("../", import.meta.url));
const SORTIE = process.argv[2] || "";
const PORT = Number(process.env.EB_PORT) || 8801;
const BASE = `http://localhost:${PORT}/?maquette=1`;
if (SORTIE) mkdirSync(SORTIE, { recursive: true });
const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

/** PNG RVB l×h (dégradé + disque) — vrai fichier pour le logo. */
function png(l, h) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xFFFFFFFF; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const bloc = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(l, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const brut = Buffer.alloc((l * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < l; x++) {
    const i = y * (l * 3 + 1) + 1 + x * 3, dans = (x - l / 2) ** 2 + (y - h / 2) ** 2 < (h / 3) ** 2;
    brut[i] = dans ? 201 : 90; brut[i + 1] = dans ? 160 : 40 + y; brut[i + 2] = dans ? 74 : 60;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc("IHDR", ihdr), bloc("IDAT", deflateSync(brut)), bloc("IEND", Buffer.alloc(0))]);
}
const LOGO = png(160, 120), PIXEL = png(1, 1);

const GA = "62e90394-69f5-4237-9190-012177145e10";
const u = (id, nom, mail) => ({ id, displayName: nom, givenName: nom.split(" ")[0], mail, userPrincipalName: mail, userType: "Member", accountEnabled: true, assignedLicenses: [{ skuId: "a" }] });
const USERS = { u1: u("u1", "Pauline Exemple", "pauline@chateau-exemple.fr"), u2: u("u2", "François Exemple", "francois@chateau-exemple.fr"),
  u4: u("u4", "Fanny Martin", "fanny@chateau-exemple.fr"), u5: u("u5", "Guillaumette Graphiste", "guillaumette@chateau-exemple.fr"),
  dam: u("dam", "Damien Prestataire", "damien@exemple.onmicrosoft.com") };
const pers = (Id, Title, mail) => ({ Id, Title, Email: mail, LoginName: "i:0#.f|membership|" + mail, PrincipalType: 1 });
const SP = "/sites/ChateaudeBreteuil/_api/web";
const AVEC_GERER = { High: "432", Low: String(2 ** 24 + 0xFFFF) }, LECTURE = { High: "176", Low: "138612833" }, EDITION = { High: "176", Low: "138612847" };
const PROFILS = {
  gestionnaire: { moi: USERS.u1, sp: pers(7, "Pauline Exemple", USERS.u1.mail), perm: AVEC_GERER, roles: [], apparence: EDITION },
  admin: { moi: USERS.u2, sp: pers(8, "François Exemple", USERS.u2.mail), perm: AVEC_GERER, roles: [{ id: "r1", displayName: "Global Administrator", roleTemplateId: GA }], apparence: LECTURE },
  lecteur: { moi: USERS.u4, sp: pers(10, "Fanny Martin", USERS.u4.mail), perm: LECTURE, roles: [], apparence: LECTURE },
  graphiste: { moi: USERS.u5, sp: pers(11, "Guillaumette Graphiste", USERS.u5.mail), perm: LECTURE, roles: [], apparence: EDITION },
};

const problemes = [];
let captures = 0;
const calme = (page) => page.evaluate(() => Promise.race([new Promise((ok) => setTimeout(ok, 1500)), Promise.all(document.getAnimations()
  .filter((a) => a.timeline === document.timeline && isFinite(a.effect.getComputedTiming().endTime)).map((a) => a.finished.catch(() => {})))]));
async function capturer(page, nom) {
  if (!SORTIE) return;
  await page.evaluate(() => { window.scrollTo(0, 0); document.getElementById("toast")?.classList.remove("visible"); });
  await calme(page);
  await page.screenshot({ path: `${SORTIE}/${nom}.png`, fullPage: true });
  captures++;
}
async function sansDebord(page, ou) {
  await calme(page);
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) problemes.push(`${ou} : défilement horizontal`);
}

/** Contexte maquetté. etat : { apparence (objet ou null), sp: { requis }, affectations, appels: [] } partagé et observable. */
async function nouvellePage(navigateur, opts) {
  const p = opts.profil ? PROFILS[opts.profil] : PROFILS.lecteur;
  const etat = opts.etat || { apparence: null, requis: false, affectations: [], appels: [] };
  const contexte = await navigateur.newContext({ viewport: opts.vp || { width: 375, height: 812 }, deviceScaleFactor: 1, serviceWorkers: "block", locale: "fr-FR",
    colorScheme: opts.theme || "light", userAgent: opts.ua, permissions: ["clipboard-read", "clipboard-write"] });
  const m = { compte: { name: p.moi.displayName, username: p.moi.mail, localAccountId: p.moi.id }, permissions: opts.permissions || [] };
  if (opts.deconnecte) m.deconnecte = true;
  if (opts.erreurConnexion) m.erreurConnexion = opts.erreurConnexion;
  await contexte.addInitScript((m) => { self.EB_MAQUETTE = m; }, m);
  // Config de test : prestataire et version d'icône publiée (sans toucher config.js).
  await contexte.addInitScript((o) => {
    let v; Object.defineProperty(self, "EB_CONFIG", { configurable: true, get: () => v, set: (x) => { v = x; if (o.prestataires) x.prestataires = o.prestataires; if (o.icone) x.icone = { version: o.icone }; } });
  }, { prestataires: ["damien@exemple.onmicrosoft.com"], icone: opts.iconePubliee || null });
  if (opts.local) await contexte.addInitScript((l) => { for (const [k, v] of Object.entries(l)) localStorage.setItem(k, JSON.stringify(v)); }, opts.local);
  if (opts.standalone) await contexte.addInitScript(() => {
    const vrai = window.matchMedia.bind(window);
    window.matchMedia = (q) => /display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : vrai(q);
    Object.defineProperty(navigator, "standalone", { get: () => true });
  });
  if (opts.tactile) await contexte.addInitScript(() => Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 }));
  const R = {
    "/v1.0/me": p.moi, "/v1.0/me/transitiveMemberOf/microsoft.graph.directoryRole": { value: p.roles },
    "/v1.0/me/licenseDetails": { value: [{ skuPartNumber: "O365_BUSINESS_PREMIUM" }] }, "/v1.0/users": { value: Object.values(USERS) },
    "/v1.0/subscribedSkus": { value: [{ skuId: "a", skuPartNumber: "O365_BUSINESS_PREMIUM" }] },
    "/v1.0/sites/breteuil02.sharepoint.com:/sites/ChateaudeBreteuil": { id: "site1", displayName: "Château", webUrl: "https://breteuil02.sharepoint.com/sites/ChateaudeBreteuil" },
    "/v1.0/sites/site1/drive": { id: "drive1", name: "Documents", webUrl: "https://breteuil02.sharepoint.com/sites/ChateaudeBreteuil/Shared%20Documents" },
    "/v1.0/drives/drive1/list": { id: "list1" },
    "/v1.0/drives/drive1/root:/Commun": { id: "c1", name: "Commun", folder: { childCount: 3 } },
    "/v1.0/directoryRoles": { value: [{ id: "dr1", displayName: "Global Administrator", roleTemplateId: GA, members: [USERS.u2, USERS.dam].map((x) => ({ ...x, "@odata.type": "#microsoft.graph.user" })) }] },
    [SP + "/currentuser"]: { ...p.sp, IsSiteAdmin: false }, [SP + "/associatedownergroup"]: { Id: 3, Title: "Propriétaires", PrincipalType: 8 },
    [SP + "/associatedownergroup/users"]: { value: [pers(7, "Pauline Exemple", USERS.u1.mail), pers(8, "François Exemple", USERS.u2.mail)] },
    [SP + "/effectivebasepermissions"]: p.perm,
  };
  const FICHIER = "/v1.0/drives/drive1/root:/Commun/Suivi informatique/apparence.json:/content";
  await contexte.route(/https:\/\/(graph\.microsoft\.com|[a-z0-9-]+\.sharepoint\.com)\/.*/, async (route) => {
    const req = route.request(), url = new URL(req.url()), chemin = decodeURIComponent(url.pathname), met = req.method();
    const ok = (corps, statut = 200) => route.fulfill({ status: statut, headers: CORS, body: JSON.stringify(corps) });
    if (met !== "GET") etat.appels.push(`${met} ${chemin}${met === "PATCH" || met === "POST" ? " " + (req.postData() || "").slice(0, 300) : ""}`);
    if (/\/photos\//.test(chemin)) return route.fulfill({ status: 200, headers: { ...CORS, "Content-Type": "image/png" }, body: PIXEL });
    if (/EffectiveBasePermissions$/.test(chemin) && /GetFile|GetFolder/.test(chemin)) return ok(p.apparence);
    if (chemin === FICHIER && met === "PUT") { etat.apparence = JSON.parse(req.postDataBuffer().toString("utf8")); return ok({ id: "app1" }); }
    if (chemin === "/v1.0/drives/drive1/root:/Commun/Suivi informatique:/children") return ok({ value: etat.apparence ? [{ id: "app1", name: "apparence.json", file: {} }] : [] });
    if (chemin === "/v1.0/drives/drive1/items/app1/content") return ok(etat.apparence);
    if (/\/logo-\d+\.png:\/content$/.test(chemin) && met === "GET") return route.fulfill({ status: 200, headers: { ...CORS, "Content-Type": "image/png" }, body: LOGO });
    if (met === "PUT") return ok({ id: "f" + etat.appels.length });
    if (/servicePrincipals\(appId=/.test(chemin)) return ok({ id: "sp1", appId: "x", displayName: "Espace Breteuil", appRoleAssignmentRequired: etat.requis });
    if (chemin === "/v1.0/servicePrincipals/sp1/appRoleAssignedTo") {
      if (met === "POST") { const b = JSON.parse(req.postData()); etat.affectations.push({ id: "a-" + b.principalId, principalId: b.principalId, principalType: "User" }); return ok({ id: "a-" + b.principalId }, 201); }
      return ok({ value: etat.affectations });
    }
    if (/\/servicePrincipals\/sp1\/appRoleAssignedTo\/a-/.test(chemin) && met === "DELETE") { const id = chemin.split("/").pop(); etat.affectations = etat.affectations.filter((a) => a.id !== id); return route.fulfill({ status: 204, headers: CORS, body: "" }); }
    if (chemin === "/v1.0/servicePrincipals/sp1" && met === "PATCH") { etat.requis = JSON.parse(req.postData()).appRoleAssignmentRequired; return route.fulfill({ status: 204, headers: CORS, body: "" }); }
    if (chemin === "/v1.0/roleManagement/directory/roleAssignments" && met === "GET") return ok({ value: [{ id: "ra1" }] });
    if (met !== "GET") return route.fulfill({ status: 204, headers: CORS, body: "" });
    return ok(R[chemin] || { value: [] });
  });
  await contexte.route("https://belfort-api.damien-belfort.workers.dev/**", (r) => {
    const url = r.request().url();
    if (/\/aide\/moi/.test(url)) return r.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ prestataire: false, pj: true }) });
    if (/\/aide$/.test(url) && r.request().method() === "POST") { etat.appels.push("AIDE " + (r.request().postDataBuffer() || Buffer.alloc(0)).toString("utf8").match(/Nouveau logo[^"\\]*/)?.[0]); return r.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ id: 42 }) }); }
    if (/aide/.test(url)) return r.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ prestataire: false, demandes: [] }) });
    return r.fulfill({ status: 503, headers: CORS, body: JSON.stringify({ code: "non_configure" }) });
  });
  const page = await contexte.newPage();
  const erreurs = [];
  page.on("console", (msg) => { if (msg.type() === "error" && !/Failed to load resource/.test(msg.text())) erreurs.push(msg.text()); });
  page.on("pageerror", (e) => erreurs.push(String(e)));
  return { contexte, page, erreurs, etat };
}
const fin = async (x, ou) => { if (x.erreurs.length) problemes.push(`${ou} : erreurs console ${x.erreurs.join(" | ")}`); await x.contexte.close(); };
const texte = async (page, sel) => String(await page.textContent(sel)).replace(/\u00a0/g, " ");
async function confirmer2(page) { await page.click("#detail .btn.large"); await page.click("#detail .btn.large"); }

const serveur = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: RACINE, stdio: "ignore" });
await new Promise((ok) => setTimeout(ok, 800));
const navigateur = await chromium.launch();
try {
  /* ---------- 1. Apparence : réservé ---------- */
  {
    const x = await nouvellePage(navigateur, { profil: "lecteur", local: { "eb:usages:u4": { choix: ["planning"] } } });
    await x.page.goto(BASE + "#/apparence");
    await x.page.waitForSelector('[data-etat="reserve"]');
    assert.equal(await x.page.$(".ap-palettes"), null, "lecteur : pas d'éditeur");
    await x.page.goto(BASE + "#/gerer"); await x.page.goto(BASE + "#/moi"); await x.page.waitForSelector(".carte-role");
    await x.page.waitForTimeout(400);
    assert.equal(await x.page.isVisible('a[href="#/apparence"]'), false, "lecteur : pas de lien Apparence dans Moi");
    await fin(x, "apparence réservé");
  }

  /* ---------- 2. Apparence : Guillaumette (droit de modifier apparence.json, sans autre droit) ---------- */
  {
    const x = await nouvellePage(navigateur, { profil: "graphiste", vp: { width: 1280, height: 900 }, local: { "eb:usages:u5": { choix: ["planning"] } } });
    const { page, etat } = x;
    await page.goto(BASE + "#/moi");
    await page.waitForSelector('a[href="#/apparence"]');
    await page.click('a[href="#/apparence"]');
    await page.waitForSelector(".ap-palettes .ap-pal");
    assert.equal(await page.$$eval(".ap-pal", (l) => l.length), 10, "10 palettes");
    assert.equal(await page.getAttribute('.ap-pal[data-palette="creme"]', "aria-pressed"), "true", "rien d'enregistré : l'original");
    assert.equal(await page.isDisabled('[data-action="ap-appliquer"]'), true, "rien à appliquer");
    await page.click('.ap-pal[data-palette="sauge"]');
    assert.equal(await page.isDisabled('[data-action="ap-appliquer"]'), false);
    // Couleur trop claire : refusée avec une phrase simple ; un peu trop claire : ajustée.
    await page.$eval("#ap-primaire", (i) => { i.value = "#f5e6a0"; i.dispatchEvent(new Event("change")); });
    assert.equal(await texte(page, '[data-msg="primaire"]'), "Trop clair : le texte serait illisible. Choisissez une couleur plus foncée.");
    await page.$eval("#ap-primaire", (i) => { i.value = "#b07060"; i.dispatchEvent(new Event("change")); });
    assert.match(await texte(page, '[data-msg="primaire"]'), /un peu foncée/);
    const aper = await page.$eval(".ap-apercu .ap-btn", (b) => [getComputedStyle(b).backgroundColor, getComputedStyle(b).color]);
    assert.notEqual(aper[0], aper[1]);
    await page.click('[data-reglage="coins"] [data-valeur="rond"]');
    await page.click('[data-reglage="apercu"] [data-valeur="sombre"]');
    assert.equal(await page.getAttribute(".ap-apercu", "data-apercu"), "sombre");
    await capturer(page, "apparence-brouillon-1280");
    // La page elle-même ne change pas tant que rien n'est appliqué.
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--primaire")), "");
    await page.click('[data-action="ap-appliquer"]'); await confirmer2(page);
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--primaire") !== "");
    assert.equal(etat.apparence.palette, "sauge"); assert.equal(etat.apparence.coins, "rond"); assert.equal(etat.apparence.modifiePar, "Guillaumette Graphiste");
    assert.equal(await page.getAttribute("html", "data-coins"), "rond", "appliqué tout de suite ici");
    // 2e version, puis revenir à la précédente.
    await page.waitForSelector('.ap-pal[data-palette="bordeaux"]');
    await page.click('.ap-pal[data-palette="bordeaux"]');
    await page.click('[data-action="ap-appliquer"]'); await confirmer2(page);
    await page.waitForSelector('[data-action="ap-precedente"]');
    assert.equal(etat.apparence.palette, "bordeaux"); assert.equal(etat.apparence.historique.length, 1);
    await page.click('[data-action="ap-precedente"]'); await page.click("#detail .btn.large");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("eb:apparence")).donnees.palette === "sauge");
    assert.equal(etat.apparence.palette, "sauge"); assert.equal(etat.apparence.historique.length, 0);
    // Logo : SVG refusé, PNG accepté → aperçu, icônes, publication (fichiers + demande n° 42).
    await page.setInputFiles("#ap-logo-fichier", { name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
    assert.match(await texte(page, '[data-msg="logo"]'), /SVG ne sont pas acceptés/);
    await page.setInputFiles("#ap-logo-fichier", { name: "logo.png", mimeType: "image/png", buffer: LOGO });
    await page.waitForSelector('[data-action="ap-publier-logo"]');
    assert.equal(await page.$$eval(".ap-icones img", (l) => l.length), 2, "icônes proposées");
    assert.ok(await page.$(".ap-apercu .ap-logo"), "logo dans l'aperçu");
    await capturer(page, "apparence-logo-1280");
    await page.click('[data-action="ap-publier-logo"]'); await page.click("#detail .btn.large");
    await page.waitForFunction(() => !!document.querySelector(".barre img.logo") || !!(JSON.parse(localStorage.getItem("eb:apparence")).donnees || {}).logo, null, { timeout: 8000 });
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem("eb:apparence")).donnees.icone || {}).demande === 42, null, { timeout: 8000 });
    const puts = etat.appels.filter((a) => a.startsWith("PUT"));
    assert.ok(puts.some((a) => /logo-1\.png/.test(a)), "logo déposé");
    assert.equal(puts.filter((a) => /Icônes\/icone-2-/.test(a)).length, 3, "3 icônes (192, 512, masquable)");
    assert.ok(etat.appels.some((a) => /AIDE Nouveau logo à publier/.test(a)), "demande « Nouveau logo à publier » envoyée");
    assert.deepEqual(etat.apparence.logo, { fichier: "logo-1.png", version: 1 });
    assert.equal(etat.apparence.palette, "sauge", "publier le logo ne change pas les couleurs");
    await page.goto(BASE + "#/moi"); await page.waitForSelector(".barre img.logo");
    // Revenir à l'original (le logo reste).
    await page.goto(BASE + "#/apparence"); await page.waitForSelector('[data-action="ap-original"]');
    await page.click('[data-action="ap-original"]'); await confirmer2(page);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("eb:apparence")).donnees.palette === "creme");
    assert.equal(etat.apparence.palette, "creme"); assert.equal(etat.apparence.logo.fichier, "logo-1.png");
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--primaire")), "", "original : variables d'app.css");
    await sansDebord(page, "apparence 1280");
    await fin(x, "apparence graphiste");
  }

  /* ---------- 3. Tout le monde reçoit l'apparence ; choix personnel ; captures 3 palettes ---------- */
  const PERSO = { palette: "bordeaux", primaire: "#2F5A7A", accent: "#D49BB0", ton: "froid", coins: "rond", police: "moderne", entete: "clair" };
  for (const [nomP, app] of [["creme", null], ["sauge", { palette: "sauge", entete: "degrade" }], ["perso", PERSO]]) {
    for (const [taille, vp] of [["375", { width: 375, height: 812 }], ["1280", { width: 1280, height: 900 }]]) {
      for (const theme of ["light", "dark"]) {
        const ou = `${nomP} ${taille} ${theme}`;
        const x = await nouvellePage(navigateur, { profil: "gestionnaire", vp, theme, etat: { apparence: app, requis: false, affectations: [], appels: [] }, local: { "eb:usages:u1": { choix: ["planning", "acces"] } } });
        await x.page.goto(BASE + "#/accueil");
        await x.page.waitForSelector(".tuiles-grandes [data-usage]");
        await x.page.waitForFunction((p) => { const c = JSON.parse(localStorage.getItem("eb:apparence") || "null"); return c && (p ? c.donnees && c.donnees.palette === p : true); }, app && app.palette);
        if (app) {
          await x.page.waitForFunction(() => document.documentElement.style.getPropertyValue("--fond") !== "");
          // Contrastes réels de la page (texte sur fond, en-tête).
          const r = await x.page.evaluate(() => {
            const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
            const rat = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
            const b = getComputedStyle(document.body), h = getComputedStyle(document.querySelector(".barre h1"));
            const v = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
            const c = document.createElement("i"); document.body.appendChild(c);
            const rgb = (hex) => { c.style.color = hex; return getComputedStyle(c).color; };
            return { texte: rat(b.color, b.backgroundColor), entete: rat(h.color, rgb(v("--entete"))) };
          });
          if (r.texte < 4.5 || r.entete < 4.5) problemes.push(`${ou} : contraste insuffisant ${JSON.stringify(r)}`);
        } else assert.equal(await x.page.evaluate(() => document.documentElement.style.getPropertyValue("--fond")), "");
        assert.ok(await x.page.$('[data-section="bientot"] .bientot-carte'), `${ou} : carte Bientôt (direction)`);
        await sansDebord(x.page, ou);
        await capturer(x.page, `accueil-${nomP}-${taille}-${theme === "dark" ? "sombre" : "clair"}`);
        await x.page.goto(BASE + "#/apparence");
        await x.page.waitForSelector(".ap-apercu");
        await sansDebord(x.page, ou + " apparence");
        await capturer(x.page, `apparence-${nomP}-${taille}-${theme === "dark" ? "sombre" : "clair"}`);
        if (nomP === "perso" && taille === "375" && theme === "light") {
          // Choix personnel : Bleu élégant sur cet appareil seulement ; « Comme le Château » par défaut.
          await x.page.goto(BASE + "#/reglages");
          await x.page.waitForSelector('[data-reglage="palette"]');
          assert.equal(await x.page.getAttribute('[data-reglage="palette"] button:has-text("Comme le Château")', "aria-pressed"), "true");
          await x.page.click('[data-reglage="palette"] button:has-text("Bleu élégant")');
          await x.page.waitForFunction(() => document.documentElement.getAttribute("data-palette") === "bleu");
          assert.equal(await x.page.getAttribute("html", "data-coins"), "rond", "coins du Château gardés");
          await capturer(x.page, "reglages-couleurs-perso-375");
          await x.page.click('[data-action="autres-palettes"]');
          await x.page.click('#detail .choix:has-text("Lavande")');
          await x.page.waitForSelector('[data-reglage="palette"] button:has-text("Lavande")[aria-pressed="true"]');
        }
        if (nomP === "sauge" && taille === "375" && theme === "light") {
          await x.page.goto(BASE + "#/accueil"); await x.page.waitForSelector(".bientot-carte");
          await x.page.click(".bientot-carte");
          await x.page.waitForSelector('[data-feuille="bientot"]');
          assert.match(await texte(x.page, '[data-feuille="bientot"]'), /HACCP Restauration.*En préparation/s);
          await capturer(x.page, "bientot-375");
        }
        await fin(x, ou);
      }
    }
  }

  /* ---------- 4. Installer : par appareil ---------- */
  const UA = {
    iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1",
    android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
    firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
  };
  for (const [nom, ua, vp] of [["iphone", UA.iphone], ["iphone-chrome", UA.iphoneChrome], ["android", UA.android], ["firefox", UA.firefox, { width: 1280, height: 900 }]]) {
    const x = await nouvellePage(navigateur, { profil: "lecteur", ua, vp, local: { "eb:usages:u4": { choix: ["planning"] } } });
    await x.page.goto(BASE + "#/installer");
    await x.page.waitForSelector(".inst-carte");
    if (nom === "android") {
      await x.page.evaluate(() => { const e = new Event("beforeinstallprompt"); e.prompt = () => { window.__invite = true; }; e.userChoice = Promise.resolve({ outcome: "accepted" }); window.dispatchEvent(e); });
      await x.page.evaluate(() => window.EB.rendre()); await x.page.waitForSelector('[data-action="installer"]');
      await x.page.click('[data-action="installer"]');
      assert.equal(await x.page.evaluate(() => window.__invite), true, "android : invitation native en un geste");
    } else if (nom === "iphone") {
      assert.equal(await x.page.$$eval('[data-action="installer"]', (l) => l.length), 1, "un seul bouton");
      assert.ok(await x.page.isVisible('[data-etat="rassurant"]'), "encadré rassurant sous le bouton");
      await x.page.click('[data-action="installer"]');
      await x.page.waitForSelector('[data-guide="ios-safari"]:not([hidden])');
      assert.match(await texte(x.page, ".inst-etapes"), /Partager ⬆️.*Sur l'écran d'accueil/s);
    } else if (nom === "iphone-chrome") {
      await x.page.waitForSelector('[data-guide="ios-autre"]:not([hidden])');
      assert.match(await texte(x.page, ".inst-guide h3"), /Safari/);
    } else {
      await x.page.waitForSelector('[data-guide="bureau-firefox"]:not([hidden])');
      assert.match(await texte(x.page, ".inst-guide"), /Chrome ou Edge/);
    }
    await sansDebord(x.page, "installer " + nom);
    await capturer(x.page, "installer-" + nom);
    await fin(x, "installer " + nom);
  }
  // Installée (iPhone, standalone) : Gérer l'application, désinstaller, logo changé (publié v2, installé v1).
  {
    const x = await nouvellePage(navigateur, { profil: "lecteur", ua: UA.iphone, standalone: true, iconePubliee: 2, local: { "eb:usages:u4": { choix: ["planning"] }, "eb:icone-installee": 1 } });
    await x.page.goto(BASE + "#/planning");
    await x.page.waitForSelector('#maj[data-banniere="icone"]:not([hidden])');
    assert.match(await texte(x.page, "#maj"), /Le logo a changé : pour le voir sur votre écran d'accueil, supprimez puis rajoutez l'appli \(30 s\)/);
    await capturer(x.page, "banniere-logo-iphone");
    await x.page.click('[data-action="icone-comment"]');
    await x.page.waitForSelector('[data-action="rechercher-maj"]');
    assert.match(await texte(x.page, ".barre h1"), /Gérer l'application/);
    assert.ok(await x.page.$('[data-etat="icone-ancienne"]'));
    assert.ok(await x.page.isVisible('[data-etat="rassurant"]'), "encadré rassurant (Gérer l'application)");
    await x.page.click('[data-action="desinstaller"]');
    assert.match(await texte(x.page, '[data-feuille="desinstaller"]'), /ne peut pas se supprimer elle-même.*appui long.*Supprimer l'app/s);
    await capturer(x.page, "gerer-appli-iphone");
    await x.page.reload(); await x.page.waitForSelector(".barre");
    await x.page.waitForTimeout(500);
    assert.equal(await x.page.isVisible('#maj[data-banniere="icone"]'), false, "bandeau montré une seule fois");
    await fin(x, "gérer l'appli");
  }

  /* ---------- 5. Planning public, appli installée non connectée, refus Microsoft ---------- */
  {
    const x = await nouvellePage(navigateur, { deconnecte: true, ua: UA.android });
    const logins = []; x.page.on("request", (r) => { if (/login\.microsoftonline/.test(r.url())) logins.push(r.url()); });
    await x.page.goto(BASE + "#/planning");
    await x.page.waitForSelector(".bloc-planning");
    assert.ok(await x.page.isVisible('[data-action="ajouter-ecran"]'), "gros bouton « Ajouter à l'écran d'accueil »");
    assert.match(await texte(x.page, '[data-action="ajouter-ecran"]'), /Ajouter à l'écran d'accueil/);
    assert.match(await texte(x.page, '[data-etat="rassurant"]'), /moins de 3 Mo.*jamais téléchargés.*Seul le planning est gardé/s, "encadré rassurant");
    assert.equal(new URL(x.page.url()).hash, "#/planning", "adresse gardée");
    assert.equal(logins.length, 0, "aucune demande de connexion");
    await capturer(x.page, "planning-public-375");
    await x.page.click('[data-action="ajouter-ecran"]');
    await x.page.waitForSelector('[data-action="installer"]');
    assert.equal(logins.length, 0);
    await fin(x, "planning public");
  }
  {
    const x = await nouvellePage(navigateur, { deconnecte: true, ua: UA.iphone, standalone: true });
    await x.page.goto(BASE);
    await x.page.waitForSelector(".bloc-planning");
    assert.equal(await x.page.$(".gros-bouton.principal"), null, "pas d'écran de connexion");
    assert.ok(await x.page.isVisible('[data-action="connexion-discrete"]'), "« Se connecter » discret");
    assert.equal(await x.page.$('[data-action="ajouter-ecran"]'), null, "déjà installée : pas de bouton d'ajout");
    await capturer(x.page, "appli-installee-non-connectee");
    await fin(x, "installée non connectée");
  }
  {
    const x = await nouvellePage(navigateur, { deconnecte: true, erreurConnexion: "AADSTS50105: The signed in user is not assigned to a role for the application." });
    await x.page.goto(BASE);
    await x.page.waitForSelector('[data-etat="non-ouverte"]');
    assert.match(await texte(x.page, ".carte-refus"), /L'application n'est pas ouverte pour vous.*François/s);
    await capturer(x.page, "refus-aadsts50105");
    await x.page.click('[data-action="refus-planning"]');
    await x.page.waitForSelector(".bloc-planning");
    await fin(x, "refus 50105");
  }

  /* ---------- 6. Qui peut utiliser l'application (François, administrateur général) ---------- */
  for (const [taille, vp] of [["375", { width: 375, height: 812 }], ["1280", { width: 1280, height: 900 }]]) {
    const etat = { apparence: null, requis: false, affectations: [], appels: [] };
    const x = await nouvellePage(navigateur, { profil: "admin", vp, etat, local: { "eb:usages:u2": { choix: ["planning"] } } });
    const { page } = x;
    await page.goto(BASE + "#/gerer");
    await page.waitForSelector('[data-action="acces-appli"]');
    assert.ok(await page.$('[data-action="roles-admins"]'), "tuile « Rôles et administrateurs »");
    await page.click('[data-action="acces-appli"]');
    await page.waitForSelector('[data-etat="consentement"]');
    assert.match(await texte(page, '[data-etat="consentement"]'), /Microsoft va vous demander/);
    await capturer(page, `acces-consentement-${taille}`);
    await page.click('[data-action="autoriser"]');
    await page.waitForSelector(".acces-liste .acces-ligne");
    assert.equal(await page.$('[data-etat="consentement"]'), null);
    assert.match(await texte(page, '[data-ligne="prestataire"]'), /Prestataire informatique — accès de maintenance.*tester et de dépanner/s);
    assert.equal(await page.isChecked('[data-ligne="prestataire"] input'), true, "prestataire coché par défaut");
    assert.equal(await page.isDisabled('[data-personne="u2"]'), true, "vous : verrouillé");
    await capturer(page, `acces-liste-${taille}`);
    if (taille === "375") {
      // Retirer le prestataire : confirmation explicite.
      await page.click('[data-ligne="prestataire"] input');
      await page.waitForSelector("#detail[open]");
      assert.match(await texte(page, "#detail"), /Mettre fin à l'accès du prestataire.*Damien ne pourra plus/s);
      await page.click('#detail .btn.secondaire'); // non, annuler
      assert.equal(await page.isChecked('[data-ligne="prestataire"] input'), true);
    }
    // Restreindre : vous, les admins généraux et le prestataire sont affectés AVANT le PATCH.
    await page.click('[data-mode="choisis"]');
    assert.match(await texte(page, "#detail"), /Seulement les personnes cochées/);
    await confirmer2(page);
    await page.waitForFunction(() => /Seules les personnes cochées/.test(document.querySelector(".acces-resume")?.textContent || ""));
    const ordre = etat.appels.filter((a) => /appRoleAssignedTo|servicePrincipals\/sp1 /.test(a) || /PATCH/.test(a));
    assert.deepEqual(ordre.map((a) => (a.match(/"principalId":"(\w+)"/) || [, "PATCH"])[1]), ["u2", "dam", "PATCH"], "affectations d'abord (François admin, prestataire admin aussi), puis Affectation requise");
    assert.equal(etat.requis, true);
    await page.check('[data-personne="u4"]');
    await page.waitForFunction(() => document.querySelector('[data-personne="u4"]')?.checked && !document.querySelector('[data-personne="u4"]').disabled);
    assert.ok(etat.affectations.some((a) => a.principalId === "u4"));
    // Invitation proposée tout de suite : aperçu, puis envoi (Mail.Send demandé à ce moment-là), ou repli messagerie.
    await page.waitForSelector('[data-feuille="invitation"]');
    assert.match(await texte(page, '[data-feuille="invitation"]'), /À : fanny@chateau-exemple\.fr.*Bonjour Fanny.*François vous a ouvert l'accès.*Ouvrir l'application.*Connectez-vous avec votre adresse du Château/s);
    await capturer(page, `invitation-apercu-${taille}`);
    if (taille === "1280") await page.evaluate(() => { self.EB_MAQUETTE.refuserConsentement = true; });
    await page.click('[data-action="envoyer-invitation"]');
    if (taille === "375") {
      await page.waitForFunction(() => /Invitation envoyée à Fanny Martin/.test(document.getElementById("toast")?.textContent || ""));
      assert.ok(etat.appels.some((a) => /POST \/v1\.0\/me\/sendMail .*Fran/.test(a)), "mail envoyé par Graph");
    } else {
      await page.waitForFunction(() => /Votre messagerie s'ouvre/.test(document.getElementById("toast")?.textContent || ""));
      assert.ok(!etat.appels.some((a) => /sendMail/.test(a)), "consentement refusé : repli mailto, rien envoyé par Graph");
    }
    await page.waitForSelector('[data-action="inviter-u4"]');
    await capturer(page, `acces-restreint-${taille}`);
    await sansDebord(page, `acces ${taille}`);
    await fin(x, "accès " + taille);
  }
  // Consentement refusé : message + marche à suivre Entra.
  {
    const x = await nouvellePage(navigateur, { profil: "admin", local: { "eb:usages:u2": { choix: ["planning"] } } });
    await x.page.addInitScript(() => { self.EB_MAQUETTE.refuserConsentement = true; });
    await x.page.goto(BASE + "#/acces-appli");
    await x.page.waitForSelector('[data-action="autoriser"]');
    await x.page.click('[data-action="autoriser"]');
    await x.page.waitForSelector('[data-etat="refuse"]');
    assert.ok(await x.page.$(".acces-entra[open]"), "marche à suivre Entra ouverte");
    assert.match(await texte(x.page, ".acces-entra"), /Affectation requise/);
    await fin(x, "consentement refusé");
  }
  // Lecteur : écran réservé (renvoyé au planning).
  {
    const x = await nouvellePage(navigateur, { profil: "lecteur", local: { "eb:usages:u4": { choix: ["planning"] } } });
    await x.page.goto(BASE + "#/acces-appli");
    await x.page.waitForFunction(() => location.hash === "#/planning");
    await fin(x, "accès lecteur");
  }

  /* ---------- 7. Rôles et administrateurs : encadré, « RETIRER », prestataire en clair ---------- */
  {
    const etat = { apparence: null, requis: false, affectations: [], appels: [] };
    const x = await nouvellePage(navigateur, { profil: "admin", etat, permissions: ["RoleManagement.ReadWrite.Directory"], local: { "eb:usages:u2": { choix: ["planning"] } } });
    const { page } = x;
    await page.goto(BASE + "#/deleguer");
    await page.waitForSelector('[data-role="admin"] [data-titulaire="dam"]');
    assert.match(await texte(page, '[data-role="admin"] [data-titulaire="dam"]'), /Prestataire informatique/);
    await page.click('[data-role="admin"] [data-titulaire="dam"] button');
    assert.match(await texte(page, "#detail"), /Toute modification prend effet immédiatement chez Microsoft/);
    await page.click("#detail .btn.large");
    assert.match(await texte(page, "#detail"), /Damien \(prestataire informatique\) ne pourra plus.*Toute modification prend effet/s);
    await page.click("#detail .btn.large");
    await page.waitForSelector('[data-action="taper-retirer"]');
    assert.equal(await page.isDisabled('[data-action="confirmer-retirer"]'), true);
    await page.fill('[data-action="taper-retirer"]', "retirer");
    await capturer(page, "roles-taper-retirer");
    await page.click('[data-action="confirmer-retirer"]');
    await page.waitForFunction(() => true);
    await page.waitForTimeout(400);
    assert.ok(etat.appels.some((a) => /DELETE .*roleAssignments\/ra1/.test(a)), "rôle retiré après « RETIRER »");
    await fin(x, "rôles");
  }

  /* ---------- 8. Planning connecté : partager le lien ; « Application mise à jour » ---------- */
  {
    const x = await nouvellePage(navigateur, { profil: "lecteur", local: { "eb:usages:u4": { choix: ["planning"] }, "eb:version": "5.6.0" } });
    await x.page.goto(BASE + "#/planning");
    await x.page.waitForSelector("#toast.visible");
    assert.equal(await texte(x.page, "#toast"), "Application mise à jour (5.7.0)");
    await x.page.waitForSelector(".partage-planning");
    assert.match(await texte(x.page, ".partage-planning"), /Partager le planning avec l'équipe.*sans compte Microsoft.*Ce n'est pas une obligation/s);
    assert.match(await x.page.getAttribute(".partage-lien", "data-lien"), /\/\?maquette=1#\/planning$|\/#\/planning$/);
    await x.page.click('[data-action="copier-lien-planning"]');
    await x.page.waitForFunction(() => /Lien copié/.test(document.getElementById("toast")?.textContent || ""));
    assert.match(await x.page.evaluate(() => navigator.clipboard.readText()), /#\/planning$/);
    await capturer(x.page, "planning-partage-375");
    assert.equal(await x.page.evaluate(() => JSON.parse(localStorage.getItem("eb:version"))), "5.7.0", "version notée : le message ne revient pas");
    await fin(x, "planning partage");
  }
} catch (e) {
  problemes.push("ÉCHEC : " + (e && e.stack || e));
} finally {
  await navigateur.close();
  serveur.kill();
}
if (problemes.length) { console.error(problemes.join("\n")); process.exit(1); }
console.log(`OK : apparence (réservé, éditeur, refus/ajustement, appliquer, précédente, original, logo + icônes + demande), 3 palettes × 375/1280 × clair/sombre, réglage personnel, Bientôt, installer (iPhone, iPhone Chrome, Android, Firefox), gérer l'appli + bandeau logo, planning public sans connexion, appli installée non connectée, refus AADSTS50105, qui peut utiliser l'appli (consentement, prestataire, garde-fous), rôles (« RETIRER »), partage du planning, « Application mise à jour » (${captures} captures).`);
