// v5.6 « Pièces jointes » de l'aide — réponses Microsoft et Worker MAQUETTÉES, données FICTIVES.
// Lancer depuis la racine du dépôt (Chromium déjà installé) :
//   EB_PORT=8799 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=$(npm root -g) node espace-breteuil/tests/aide-pj.playwright.mjs [dossier-captures]
// Contrôles à 375 et 1280 px, palettes crème et Bleu élégant :
//   - « 📎 Joindre un fichier » : grosse image réduite (≤ 2000 px, JPEG), PDF gardé tel quel, type refusé → message clair,
//     capture COLLÉE (Ctrl+V), fichier GLISSÉ-DÉPOSÉ, puce « retirer », envoi multipart (donnees + fichier × n) ;
//   - fil : vignettes lues avec le jeton (blob:), visionneuse, fichier PDF en puce, réponse avec pièce jointe ;
//   - #/aide/<n°>/pj/<id> : pièce mise en évidence ; vue prestataire : joindre aussi ;
//   - Worker sans pièces jointes (pj: false) : bouton caché ;
//   - filtres « En cours / Résolues / Toutes » (compteurs) ; requalification par le prestataire (type, facturable, temps) ;
//     écran Statistiques (#/demandes/stats : tuiles, par type, par personne, 6 mois, mois précédent, export CSV), entrée dans Gérer ;
//   - aperçu du MAIL HTML envoyé à Damien (clair, sombre, téléphone) ; aucune erreur console, pas de défilement horizontal.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const RACINE = fileURLToPath(new URL("../", import.meta.url));
const SORTIE = process.argv[2] || "";
const PORT = Number(process.env.EB_PORT) || 8799;
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
async function capturer(cible, nom, opts = {}) {
  if (!SORTIE) return;
  const page = typeof cible.page === "function" ? cible.page() : cible;
  await page.evaluate(() => { const t = document.getElementById("toast"); if (t) { t.classList.remove("visible"); t.style.visibility = "hidden"; } });
  await cible.screenshot({ path: `${SORTIE}/${nom}.png`, ...opts });
  captures++;
}
async function sansDebord(page, ou) {
  const trop = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (trop) problemes.push(`${ou} : défilement horizontal`);
}

// Le vrai Worker (sans « cloudflare:email ») : mail HTML et agrégats des statistiques calculés par SON code.
const W = await import("data:text/javascript;charset=utf-8," + encodeURIComponent(readFileSync(new URL("../../api-planning/worker.js", import.meta.url), "utf8")
  .replace(/^import \{ EmailMessage \} from "cloudflare:email";$/m, "class EmailMessage {}")));

/* ---------- Worker « aide » simulé, avec pièces jointes ---------- */
const PDF = Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
let PHOTO = null; // JPEG réaliste, fabriqué au démarrage (capture d'un faux écran)
function multipart(req) {
  const ct = req.headers()["content-type"] || "", buf = req.postDataBuffer();
  if (!/multipart\/form-data/.test(ct) || !buf) return null;
  const borne = /boundary=(.+)$/.exec(ct)[1], texte = buf.toString("latin1"), parties = [];
  for (const p of texte.split("--" + borne).slice(1, -1)) {
    const i = p.indexOf("\r\n\r\n"), t = p.slice(0, i), corps = p.slice(i + 4, -2);
    parties.push({ nom: /name="([^"]+)"/.exec(t)[1], fichier: /filename="([^"]*)"/.exec(t)?.[1], type: /Content-Type: (.+)/i.exec(t)?.[1]?.trim(), taille: corps.length, corps });
  }
  return parties;
}
function workerAide(o, journal) {
  const prestataire = !!o.prestataire;
  const s = {
    demandes: [
      { id: 11, cree: "2026-10-16T08:10:00.000Z", type: "probleme", statut: "repondue", nom: "Fanny Martin", adresse: "fmartin@breteuil.fr", ecran: "Planning (#/planning)", version: "5.5.0", appareil: "iPhone · Safari", nonLu: true },
      { id: 10, cree: "2026-10-14T10:00:00.000Z", type: "question", statut: "nouvelle", nom: "Camille Roux", adresse: "croux@breteuil.fr", ecran: "Dossiers (#/fichiers)", version: "5.5.0", appareil: "Ordinateur Windows · Edge", autre: true, facturable: null, minutes: 0 },
      { id: 9, cree: "2026-10-12T15:00:00.000Z", type: "amelioration", statut: "resolue", nom: "Fanny Martin", adresse: "fmartin@breteuil.fr", ecran: "Moi (#/moi)", version: "5.5.0", appareil: "iPhone · Safari" },
    ],
    messages: {
      11: [{ id: 1, cree: "2026-10-16T08:10:00.000Z", auteur: "client", texte: "Le planning de l'accueil ne s'affiche plus depuis ce matin. Voici une capture.", origine: "appli",
        pj: [{ id: 1, nom: "capture-ecran.jpg", type: "image/jpeg", taille: 184320, apercu: true }] },
        { id: 2, cree: "2026-10-16T09:02:00.000Z", auteur: "prestataire", texte: "Bonjour Fanny,\n\nC'est réglé. Je vous joins la marche à suivre si cela recommence.\n\nDamien", origine: "mail",
          pj: [{ id: 2, nom: "Marche à suivre - planning.pdf", type: "application/pdf", taille: 245760, apercu: false }, { id: 3, nom: "réglage.png", type: "image/png", taille: 20480, apercu: true }] }],
      10: [{ id: 5, cree: "2026-10-14T10:00:00.000Z", auteur: "client", texte: "Comment partager un dossier avec un prestataire extérieur ?", origine: "appli", pj: [] }],
      9: [{ id: 6, cree: "2026-10-12T15:00:00.000Z", auteur: "client", texte: "Pourrait-on voir les anniversaires dans le planning ?", origine: "appli", pj: [] }],
    },
  };
  let suivant = 12, pjSuivante = 10;
  const H = { ...CORS, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS" };
  const rep = (route, status, corps) => route.fulfill({ status, headers: H, body: JSON.stringify(corps) });
  const vue = (d) => ({ ...d, ...(prestataire ? { facturable: W.estFacturable(d), facturableChoisi: d.facturable != null, minutes: d.minutes || 0 } : { facturable: undefined, minutes: undefined }), nonLu: !prestataire && !!d.nonLu, dernier: s.messages[d.id].at(-1).cree, nbMessages: s.messages[d.id].length, extrait: s.messages[d.id][0].texte });
  const pjs = (parties) => (parties || []).filter((p) => p.nom === "fichier").map((p) => ({ id: pjSuivante++, nom: p.fichier, type: p.type, taille: p.taille, apercu: /^image\/(jpeg|png|webp)$/.test(p.type) }));
  return async (route) => {
    const req = route.request(), url = new URL(req.url()), m = req.method();
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: H });
    const auth = (await req.allHeaders()).authorization || "";
    const parties = m === "POST" ? multipart(req) : null;
    journal.push({ methode: m, chemin: url.pathname, parties, json: m !== "GET" && !parties ? req.postData() : null });
    if (auth !== "Bearer maquette-id-token") return rep(route, 401, { code: "non_connecte" });
    const seg = url.pathname.split("/").slice(3).filter(Boolean);
    const visibles = () => s.demandes.filter((d) => prestataire || !d.autre);
    if (seg[0] === "moi") return rep(route, 200, { prestataire, pj: o.pj !== false });
    if (seg[0] === "stats") {
      if (!prestataire) return rep(route, 403, { code: "interdit" });
      return rep(route, 200, W.statsAide(STATS_LIGNES, url.searchParams.get("mois"), Date.parse("2026-10-19T12:00:00Z")));
    }
    if (!seg.length && m === "GET") return rep(route, 200, { prestataire, pj: o.pj !== false, demandes: visibles().map(vue).sort((a, b) => b.dernier.localeCompare(a.dernier)) });
    if (!seg.length && m === "POST") {
      const c = JSON.parse(parties ? parties.find((p) => p.nom === "donnees").corps : req.postData());
      const d = { id: suivant++, cree: new Date().toISOString(), type: c.type, statut: "nouvelle", nom: "Fanny Martin", adresse: "fmartin@breteuil.fr", ecran: c.ecran, version: c.version, appareil: c.appareil };
      const pj = pjs(parties);
      s.demandes.push(d); s.messages[d.id] = [{ id: 99, cree: d.cree, auteur: "client", texte: c.message, origine: "appli", pj }];
      return rep(route, 201, { ok: true, id: d.id, statut: "nouvelle", mailEnvoye: true, pj });
    }
    const d = visibles().find((x) => x.id === Number(seg[0]));
    if (!d) return rep(route, 404, { code: "introuvable" });
    if (seg.length === 1 && m === "GET") { const v = vue(d); d.nonLu = false; return rep(route, 200, { prestataire, pj: o.pj !== false, demande: { ...v, nonLu: false }, messages: s.messages[d.id] }); }
    if (seg[1] === "pj" && m === "GET") {
      const p = s.messages[d.id].flatMap((x) => x.pj).find((x) => x.id === Number(seg[2]));
      if (!p) return rep(route, 404, { code: "introuvable" });
      return route.fulfill({ status: 200, headers: { ...H, "Content-Type": p.type }, body: /pdf/.test(p.type) ? PDF : PHOTO });
    }
    if (seg[1] === "messages" && m === "POST") {
      const c = JSON.parse(parties ? parties.find((p) => p.nom === "donnees").corps : req.postData());
      s.messages[d.id].push({ id: 100 + s.messages[d.id].length, cree: new Date().toISOString(), auteur: prestataire ? "prestataire" : "client", texte: c.texte, origine: "appli", pj: pjs(parties) });
      d.statut = prestataire ? "repondue" : "nouvelle";
      return rep(route, 201, { ok: true, statut: d.statut });
    }
    if (m === "PATCH") { Object.assign(d, JSON.parse(req.postData())); return rep(route, 200, { ok: true, id: d.id, statut: d.statut, demande: vue(d) }); }
    return rep(route, 405, {});
  };
}

// Statistiques : demandes FICTIVES sur 6 mois (agrégées par le code du Worker).
const STATS_LIGNES = (() => {
  const gens = [["Fanny Martin", "fmartin@breteuil.fr"], ["Camille Roux", "croux@breteuil.fr"], ["Marc Petit", "mpetit@breteuil.fr"], ["Inès Laurent", "ilaurent@breteuil.fr"]];
  const types = ["probleme", "question", "probleme", "amelioration", "avis", "probleme", "question"];
  const l = []; let id = 1;
  for (const [mois, n] of [["2026-05", 4], ["2026-06", 7], ["2026-07", 5], ["2026-08", 3], ["2026-09", 9], ["2026-10", 12]]) for (let i = 0; i < n; i++) {
    const cree = `${mois}-${String(2 + i * 2).padStart(2, "0")}T0${7 + (i % 3)}:15:00.000Z`, type = types[(id + i) % types.length], [nom, adresse] = gens[(id + Math.floor(id / 3)) % gens.length];
    l.push({ id, cree, nom, adresse, type, statut: i % 4 === 0 && mois === "2026-10" ? "nouvelle" : i % 3 === 0 ? "repondue" : "resolue",
      facturable: type === "question" && i % 2 ? 1 : null, minutes: [15, 30, 45, 60, 90, 20][i % 6],
      premiere_reponse: new Date(Date.parse(cree) + (35 + i * 40) * 60000).toISOString(), extrait: "Demande fictive n° " + id + " ; détails ici" });
    id++;
  }
  return l;
})();

async function nouvellePage(navigateur, opts) {
  const p = PROFILS[opts.profil];
  const contexte = await navigateur.newContext({ viewport: opts.vp, deviceScaleFactor: 1, serviceWorkers: "block", locale: "fr-FR", colorScheme: opts.theme || "light" });
  await contexte.addInitScript((m) => { self.EB_MAQUETTE = m; }, { compte: { name: p.moi.displayName, username: p.moi.mail, localAccountId: p.moi.id }, permissions: [] });
  await contexte.addInitScript((id) => localStorage.setItem("eb:usages:" + id, JSON.stringify({ choix: ["planning"] })), p.moi.id);
  if (opts.palette === "bleu") await contexte.addInitScript(() => localStorage.setItem("eb:reglages", JSON.stringify({ palette: "bleu" })));
  const R = reponses(p);
  await contexte.route(/https:\/\/(graph\.microsoft\.com|[a-z0-9-]+\.sharepoint\.com)\/.*/, async (route) => {
    const req = route.request(), url = new URL(req.url()), chemin = decodeURIComponent(url.pathname);
    if (/\/photos\//.test(url.pathname)) return route.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "image/png" }, body: PNG });
    if (req.method() !== "GET") return route.fulfill({ status: 204, headers: CORS, body: "" });
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(R[chemin] || { value: [] }) });
  });
  const journal = [];
  const aide = workerAide(opts.aide || {}, journal);
  await contexte.route("https://belfort-api.damien-belfort.workers.dev/**", (r) => /\/breteuil\/aide/.test(r.request().url()) ? aide(r) : r.fulfill({ status: 200, headers: CORS, body: "{}" }));
  const page = await contexte.newPage();
  const erreurs = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) erreurs.push(m.text()); });
  page.on("pageerror", (e) => erreurs.push(String(e)));
  return { contexte, page, erreurs, journal };
}
const puces = (page) => page.$$eval(".aide-pj-puce:not(.prepa)", (l) => l.map((x) => x.dataset.pjNom));
/** Fichier « collé » ou « déposé » dans la page (DataTransfer réel, image dessinée sur un canvas). */
async function evenementFichier(page, sel, type, nom, l, h) {
  await page.evaluate(async ([sel, type, nom, l, h]) => {
    const c = document.createElement("canvas"); c.width = l; c.height = h;
    const x = c.getContext("2d"); x.fillStyle = "#3d6fa8"; x.fillRect(0, 0, l, h); x.fillStyle = "#fff"; x.font = "80px sans-serif"; x.fillText("Capture", 40, 120);
    const b = await new Promise((ok) => c.toBlob(ok, "image/png"));
    const dt = new DataTransfer(); dt.items.add(new File([b], nom, { type: "image/png" }));
    const el = document.querySelector(sel);
    if (type === "paste") el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    else for (const k of ["dragenter", "dragover", "drop"]) el.dispatchEvent(new DragEvent(k, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [sel, type, nom, l, h]);
}

const serveur = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: RACINE, stdio: "ignore" });
await new Promise((ok) => setTimeout(ok, 800));
const navigateur = await chromium.launch();
try {
  // Image réaliste (JPEG) servie comme pièce jointe + grosse photo à réduire (3000 × 2250).
  {
    const p = await navigateur.newPage({ viewport: { width: 640, height: 480 } });
    await p.setContent(`<body style="margin:0;font:28px sans-serif;background:#FBF6EE"><div style="background:#5B3833;color:#FBF6EE;padding:18px">Planning · Accueil</div>
      <div style="padding:18px;display:grid;gap:12px">${["Visite 10 h", "Atelier 14 h", "Groupe 16 h"].map((t) => `<div style="background:#fff;border-left:6px solid #C9A04A;padding:14px">${t}</div>`).join("")}</div></body>`);
    PHOTO = await p.screenshot({ type: "jpeg", quality: 85 });
    await p.setViewportSize({ width: 3000, height: 2250 });
    var GROSSE = await p.screenshot({ type: "png" });
    await p.close();
  }
  for (const [taille, vp] of [["375", { width: 375, height: 812 }], ["1280", { width: 1280, height: 900 }]]) for (const palette of ["creme", "bleu"]) {
    const suffixe = `${palette}-${taille}`;
    /* ---------- Collaboratrice : nouvelle demande avec pièces jointes ---------- */
    {
      const { contexte, page, erreurs, journal } = await nouvellePage(navigateur, { profil: "lecteur", vp, palette });
      await page.goto(BASE + "#/planning");
      await page.waitForSelector(".aide-fab");
      await page.click(".aide-fab");
      await page.waitForSelector('#aide-panneau [data-action="aide-joindre"]');
      // Bouton + sélection : grosse image (réduite) et PDF (gardé), puis un type refusé.
      await page.setInputFiles("#aide-panneau .aide-pj-input", [{ name: "Photo écran.png", mimeType: "image/png", buffer: GROSSE }, { name: "Devis été.pdf", mimeType: "application/pdf", buffer: PDF }]);
      await page.waitForFunction(() => document.querySelectorAll(".aide-pj-puce:not(.prepa)").length === 2);
      assert.deepEqual(await puces(page), ["Photo écran.jpg", "Devis été.pdf"], "image convertie en JPEG");
      await page.setInputFiles("#aide-panneau .aide-pj-input", [{ name: "photos.zip", mimeType: "application/zip", buffer: Buffer.from("PK\x03\x04") }]);
      assert.match(await page.textContent(".aide-pj-erreur"), /« photos\.zip » : ce type de fichier n'est pas accepté/);
      // Coller une capture d'écran ; glisser-déposer un fichier.
      await evenementFichier(page, "#aide-message", "paste", "image.png", 1170, 2532);
      await page.waitForFunction(() => document.querySelectorAll(".aide-pj-puce:not(.prepa)").length === 3);
      await evenementFichier(page, "#aide-panneau .aide-form", "drop", "plan.png", 400, 300);
      await page.waitForFunction(() => document.querySelectorAll(".aide-pj-puce:not(.prepa)").length === 4);
      assert.deepEqual(await puces(page), ["Photo écran.jpg", "Devis été.pdf", "capture-ecran.jpg", "plan.jpg"], "capture collée renommée");
      assert.equal(await page.$$eval(".depot-voile:not([hidden])", (l) => l.length), 0, "pas de voile « dépôt dans Dossiers »");
      // Retirer.
      await page.click('.aide-pj-puce[data-pj-nom="plan.jpg"] [data-action="aide-pj-retirer"]');
      assert.deepEqual(await puces(page), ["Photo écran.jpg", "Devis été.pdf", "capture-ecran.jpg"]);
      const cibles = await page.$$eval('#aide-panneau [data-action="aide-joindre"], #aide-panneau [data-action="aide-pj-retirer"]', (l) => l.map((e) => { const b = e.getBoundingClientRect(); return Math.min(b.width, b.height); }));
      if (cibles.some((x) => x < 44)) problemes.push(`pj ${suffixe} : cibles < 44 px (${cibles.join(", ")})`);
      await page.click('.aide-type[data-type="probleme"]');
      await page.fill("#aide-message", "Le planning ne s'affiche plus. Captures et devis joints.");
      await page.locator("#aide-panneau .aide-pj-puces").scrollIntoViewIfNeeded();
      await calme(page);
      await capturer(page, `pj-nouvelle-${suffixe}`);
      await page.click('[data-action="aide-envoyer"]');
      await page.waitForSelector(".aide-confirmation");
      const envoi = journal.find((j) => j.methode === "POST" && j.chemin === "/breteuil/aide");
      assert.ok(envoi.parties, "envoi multipart");
      assert.equal(JSON.parse(envoi.parties.find((p) => p.nom === "donnees").corps).type, "probleme");
      const f = envoi.parties.filter((p) => p.nom === "fichier");
      assert.deepEqual(f.map((x) => [Buffer.from(x.fichier, "latin1").toString("utf8"), x.type]), [["Photo écran.jpg", "image/jpeg"], ["Devis été.pdf", "application/pdf"], ["capture-ecran.jpg", "image/jpeg"]]);
      assert.ok(f[0].taille < GROSSE.length, `photo réduite (${f[0].taille} o au lieu de ${GROSSE.length})`);
      assert.equal(f[1].taille, PDF.length, "PDF envoyé tel quel");
      const dims = await page.evaluate(async (b64) => { const i = await createImageBitmap(await (await fetch("data:image/jpeg;base64," + b64)).blob()); return [i.width, i.height]; }, Buffer.from(f[0].corps, "latin1").toString("base64"));
      assert.deepEqual(dims, [2000, 1500], "côté le plus long : 2000 px");
      // Fil : vignettes (lues avec le jeton → blob:), PDF en puce, visionneuse, réponse avec fichier.
      await page.click("text=Voir mes demandes");
      await page.click('#aide-panneau .aide-carte[data-demande="11"]');
      await page.waitForSelector("#aide-panneau .aide-piece.chargee .aide-vignette");
      await page.waitForFunction(() => [...document.querySelectorAll("#aide-panneau .aide-vignette")].every((i) => i.complete && i.naturalWidth > 0 && i.src.startsWith("blob:")));
      assert.match(await page.textContent('#aide-panneau [data-action="aide-ouvrir-pj"]'), /Marche à suivre - planning\.pdf/);
      assert.ok(journal.filter((j) => /\/pj\//.test(j.chemin)).length >= 2);
      await calme(page);
      await capturer(page.locator("#aide-panneau"), `pj-fil-${suffixe}`);
      // (Chromium sans interface ignore les noms non ASCII de l'attribut download : on contrôle l'attribut lui-même.)
      await page.evaluate(() => { const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { window.__telechargement = this.download; return c.call(this); }; });
      await Promise.all([page.waitForEvent("download"), page.click('#aide-panneau [data-action="aide-ouvrir-pj"]')]);
      assert.equal(await page.evaluate(() => window.__telechargement), "Marche à suivre - planning.pdf");
      await page.click('#aide-panneau [data-action="aide-voir-pj"]');
      await page.waitForSelector("dialog.aide-visionneuse[open] .aide-vision-img");
      await calme(page);
      if (palette === "creme") await capturer(page, `pj-visionneuse-${suffixe}`);
      await page.keyboard.press("Escape");
      await page.setInputFiles("#aide-panneau form:has(#aide-reponse-11) .aide-pj-input", [{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Étapes faites") }]);
      await page.waitForFunction(() => document.querySelectorAll(".aide-pj-puce:not(.prepa)").length === 1);
      await page.click('#aide-panneau [data-action="aide-repondre"]');
      await page.waitForFunction(() => [...document.querySelectorAll("#aide-panneau .aide-bulle.client [data-action=aide-ouvrir-pj]")].some((b) => /notes\.txt/.test(b.textContent)));
      const rep = journal.find((j) => j.methode === "POST" && j.chemin === "/breteuil/aide/11/messages");
      assert.equal(JSON.parse(rep.parties.find((p) => p.nom === "donnees").corps).texte, "", "fichier seul, sans texte");
      await page.keyboard.press("Escape");
      // Lien du mail : #/aide/11/pj/2 → pièce mise en évidence.
      await page.goto(BASE + "#/aide/11/pj/2");
      await page.waitForSelector('.ecran .aide-piece.cible[data-pj="2"]');
      await calme(page);
      await sansDebord(page, `pj écran ${suffixe}`);
      if (erreurs.length) problemes.push(`pj collaboratrice ${suffixe} : erreurs console ${erreurs.join(" | ")}`);
      await contexte.close();
    }
    /* ---------- Prestataire : joindre aussi dans sa réponse ---------- */
    {
      const { contexte, page, erreurs, journal } = await nouvellePage(navigateur, { profil: "admin", vp, palette, aide: { prestataire: true } });
      await page.goto(BASE + "#/aide/10");
      await page.waitForSelector('.ecran [data-action="aide-joindre"]');
      await page.setInputFiles(".ecran .aide-pj-input", [{ name: "Partage.pdf", mimeType: "application/pdf", buffer: PDF }]);
      await page.waitForFunction(() => document.querySelectorAll(".aide-pj-puce:not(.prepa)").length === 1);
      await page.fill("#aide-reponse-10", "Voici la marche à suivre en PDF.");
      await calme(page);
      await page.locator(".ecran .aide-pj-puces").scrollIntoViewIfNeeded();
      await calme(page);
      if (palette === "creme") await capturer(page, `pj-prestataire-${suffixe}`);
      await page.click('.ecran [data-action="aide-repondre"]');
      await page.waitForFunction(() => document.querySelectorAll(".ecran .aide-bulle.damien [data-action=aide-ouvrir-pj]").length === 1);
      const r = journal.find((j) => j.methode === "POST" && j.chemin === "/breteuil/aide/10/messages");
      assert.deepEqual(r.parties.filter((p) => p.nom === "fichier").map((p) => p.fichier), ["Partage.pdf"]);
      await sansDebord(page, `pj prestataire ${suffixe}`);
      if (erreurs.length) problemes.push(`pj prestataire ${suffixe} : erreurs console ${erreurs.join(" | ")}`);
      await contexte.close();
    }
  }
  /* ---------- Filtres, requalification, statistiques, Gérer ---------- */
  for (const [taille, vp] of [["375", { width: 375, height: 812 }], ["1280", { width: 1280, height: 900 }]]) for (const palette of ["creme", "bleu"]) {
    const suffixe = `${palette}-${taille}`;
    // Collaboratrice : filtres dans « Mes demandes », pas de requalification.
    {
      const { contexte, page, erreurs } = await nouvellePage(navigateur, { profil: "lecteur", vp, palette });
      await page.goto(BASE + "#/aide");
      await page.waitForSelector('.ecran [data-filtre-statut="encours"][aria-pressed="true"]');
      assert.deepEqual(await page.$$eval(".ecran [data-filtre-statut]", (l) => l.map((b) => b.textContent)), ["En cours1", "Résolues1", "Toutes2"]);
      assert.deepEqual(await page.$$eval(".ecran .aide-carte", (l) => l.map((c) => c.dataset.demande)), ["11"]);
      await page.click('.ecran [data-filtre-statut="resolue"]');
      assert.deepEqual(await page.$$eval(".ecran .aide-carte", (l) => l.map((c) => c.dataset.demande)), ["9"]);
      await page.click('.ecran [data-filtre-statut=""]');
      assert.equal(await page.$$eval(".ecran .aide-carte", (l) => l.length), 2);
      await calme(page); await sansDebord(page, `filtres ${suffixe}`);
      if (palette === "creme") await capturer(page, `filtres-mes-demandes-${suffixe}`);
      await page.goto(BASE + "#/aide/11");
      await page.waitForSelector(".ecran .aide-bulle.damien");
      assert.equal(await page.$$eval(".aide-requal, [data-requal]", (l) => l.length), 0, "pas de requalification pour le demandeur");
      assert.doesNotMatch(await page.textContent(".ecran"), /Facturable|Temps passé/);
      await page.goto(BASE + "#/demandes/stats");
      await page.waitForFunction(() => /réservé à Damien/.test(document.querySelector(".aide-stats")?.textContent || ""));
      if (erreurs.filter((e) => !/403/.test(e)).length) problemes.push(`filtres collaboratrice ${suffixe} : erreurs console ${erreurs.join(" | ")}`);
      await contexte.close();
    }
    // Prestataire : Demandes (filtres), requalification, statistiques, Gérer.
    {
      const { contexte, page, erreurs, journal } = await nouvellePage(navigateur, { profil: "admin", vp, palette, aide: { prestataire: true } });
      await page.goto(BASE + "#/demandes");
      await page.waitForSelector('.aide-demandes [data-filtre-statut="encours"][aria-pressed="true"]');
      assert.deepEqual(await page.$$eval(".aide-demandes [data-filtre-statut]", (l) => l.map((b) => b.textContent)), ["En cours2", "Résolues1", "Toutes3"]);
      assert.ok(await page.isVisible('[data-filtre="type"]') && await page.isVisible('[data-filtre="personne"]'), "filtres type et personne gardés");
      await calme(page); await sansDebord(page, `demandes ${suffixe}`);
      if (palette === "creme" || taille === "375") await capturer(page, `filtres-prestataire-${suffixe}`);
      // Requalifier la n° 10 : Question → Problème (facturable coché tout seul), + 30 min + 1 h.
      await page.click('.aide-demandes .aide-carte[data-demande="10"]');
      await page.waitForSelector('.ecran .aide-requal [data-requal="type"]');
      assert.equal(await page.isChecked('[data-requal="facturable"]'), false, "Question : non facturable par défaut");
      await page.selectOption('[data-requal="type"]', "probleme");
      assert.equal(await page.isChecked('[data-requal="facturable"]'), true, "Problème : facturable par défaut");
      await page.click('[data-ajout="30"]'); await page.click('[data-ajout="60"]');
      assert.equal(await page.inputValue('[data-requal="minutes"]'), "90");
      assert.match(await page.textContent(".aide-requal .aide-note"), /Soit 1\u00a0h 30/);
      await page.locator(".aide-requal").scrollIntoViewIfNeeded(); await calme(page);
      if (palette === "creme" || taille === "375") await capturer(page, `requalifier-${suffixe}`);
      await page.click('[data-action="aide-requalifier"]');
      await page.waitForFunction(() => document.querySelector('[data-requal="type"]')?.value === "probleme" && /Problème/.test(document.querySelector(".aide-fil-tete")?.textContent || ""));
      let patchs = journal.filter((j) => j.methode === "PATCH").map((j) => JSON.parse(j.json));
      assert.deepEqual(patchs.at(-1), { type: "probleme", minutes: 90 }, "facturable non choisi : pas envoyé (suit le type)");
      await page.uncheck('[data-requal="facturable"]');
      await page.fill('[data-requal="minutes"]', "1h45");
      await page.click('[data-action="aide-requalifier"]');
      await page.waitForFunction(() => document.querySelector('[data-requal="minutes"]')?.value === "105");
      patchs = journal.filter((j) => j.methode === "PATCH").map((j) => JSON.parse(j.json));
      assert.deepEqual(patchs.at(-1), { type: "probleme", minutes: 105, facturable: false });
      assert.equal(await page.isChecked('[data-requal="facturable"]'), false, "choix gardé");
      await page.fill('[data-requal="minutes"]', "beaucoup");
      await page.click('[data-action="aide-requalifier"]');
      assert.match(await page.textContent(".aide-requal .erreur"), /nombre de minutes/);
      // Statistiques : depuis Demandes, puis mois précédent, export CSV.
      await page.goto(BASE + "#/demandes");
      await page.click('[data-action="aide-stats"]');
      await page.waitForSelector('.aide-stats [data-mois-affiche="2026-10"]');
      const tuiles = await page.$$eval(".aide-stat", (l) => Object.fromEntries(l.map((t) => [t.dataset.stat, t.querySelector("b").textContent])));
      const attendu = W.statsAide(STATS_LIGNES, "2026-10", Date.parse("2026-10-19T12:00:00Z")).tuiles;
      assert.equal(tuiles.demandes, String(attendu.demandes)); assert.equal(tuiles.problemes, String(attendu.problemes));
      assert.equal(tuiles.facturables, String(attendu.facturables)); assert.equal(tuiles.encours, String(attendu.enCours));
      assert.match(tuiles.temps, /h/); assert.notEqual(tuiles.delai, "—");
      assert.equal(await page.$$eval(".aide-evolution li", (l) => l.length), 6);
      assert.equal(await page.$$eval(".aide-barres li", (l) => l.length), 4);
      assert.equal(await page.$$eval('[data-mois="suivant"]', (l) => l.length), 0, "pas de mois futur");
      await calme(page); await sansDebord(page, `stats ${suffixe}`);
      await capturer(page, `stats-${suffixe}`, { fullPage: true });
      await page.evaluate(() => { const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { window.__telechargement = this.download; return c.call(this); }; });
      const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="aide-export-csv"]')]);
      assert.equal(await page.evaluate(() => window.__telechargement), "demandes-2026-10.csv");
      const csv = readFileSync(await dl.path(), "utf8");
      assert.ok(csv.startsWith("\ufeffN°;Date;Personne;Type;Statut;Facturable;Temps (min);Début du message\r\n"), "CSV : BOM + en-tête");
      assert.equal(csv.trim().split("\r\n").length, 1 + attendu.demandes);
      assert.match(csv, /"Demande fictive n° \d+ ; détails ici"/, "« ; » entre guillemets");
      await page.click('[data-mois="precedent"]');
      await page.waitForSelector('.aide-stats [data-mois-affiche="2026-09"]');
      assert.equal(await page.evaluate(() => location.hash), "#/demandes/stats/2026-09");
      assert.ok(journal.some((j) => j.chemin === "/breteuil/aide/stats" ), "route stats appelée");
      await page.waitForSelector('[data-mois="suivant"]');
      // Gérer : section « Demandes d'aide » (prestataire).
      await page.goto(BASE + "#/gerer");
      await page.waitForSelector('.aide-gerer:not([hidden]) a[href="#/demandes/stats"]');
      await calme(page);
      if (palette === "creme" && taille === "375") await capturer(page, `gerer-demandes-${suffixe}`, { fullPage: true });
      if (erreurs.length) problemes.push(`prestataire stats ${suffixe} : erreurs console ${erreurs.join(" | ")}`);
      await contexte.close();
    }
  }
  /* ---------- Worker sans pièces jointes : bouton caché, le reste marche ---------- */
  {
    const { contexte, page, erreurs } = await nouvellePage(navigateur, { profil: "lecteur", vp: { width: 375, height: 812 }, aide: { pj: false } });
    await page.goto(BASE + "#/planning");
    await page.click(".aide-fab");
    await page.waitForSelector("#aide-panneau .aide-form");
    await page.waitForTimeout(500);
    assert.equal(await page.$$eval('[data-action="aide-joindre"]', (l) => l.length), 0, "pas de bouton 📎");
    await page.goto(BASE + "#/aide/11");
    await page.waitForSelector(".ecran .aide-bulle.damien");
    assert.equal(await page.$$eval('[data-action="aide-joindre"]', (l) => l.length), 0);
    if (erreurs.length) problemes.push(`pj absentes : erreurs console ${erreurs.join(" | ")}`);
    await contexte.close();
  }
  /* ---------- Aperçu du mail HTML envoyé à Damien ---------- */
  {
    const html = W.htmlMail({ id: 12, type: "probleme", nom: "Fanny Martin", adresse: "fmartin@chateau-exemple.fr", ecran: "Planning (#/planning)", version: "5.6.0",
      appareil: "iPhone · Safari · appli installée · 390 px", date: Date.UTC(2026, 9, 19, 8, 42), premier: true, lien: "https://espace-breteuil.pages.dev/#/aide/12",
      texte: "Bonjour Damien,\n\nLe planning de l'accueil ne s'affiche plus depuis ce matin sur mon téléphone : l'écran reste blanc après « Chargement… ».\nJe vous mets deux captures et le devis <reçu> hier.\n\nMerci !",
      pj: [{ nom: "capture-ecran.jpg", taille: 412000, lien: "https://espace-breteuil.pages.dev/#/aide/12/pj/31" }, { nom: "Devis été 2026.pdf", taille: 1310720, lien: "https://espace-breteuil.pages.dev/#/aide/12/pj/32" }],
      ignorees: [] });
    const html2 = W.htmlMail({ id: 12, type: "question", nom: "Fanny Martin", adresse: "fmartin@chateau-exemple.fr", ecran: "Moi (#/moi)", version: "5.6.0", appareil: "Ordinateur Windows · Edge",
      date: Date.UTC(2026, 9, 19, 9, 5), premier: false, lien: "https://espace-breteuil.pages.dev/#/aide/12", texte: "C'est encore le cas cet après-midi.", pj: [] });
    for (const [nom, h, vpm, theme] of [["mail-clair", html, { width: 720, height: 900 }, "light"], ["mail-sombre", html, { width: 720, height: 900 }, "dark"],
      ["mail-telephone", html, { width: 390, height: 844 }, "light"], ["mail-nouveau-message", html2, { width: 720, height: 700 }, "light"]]) {
      const ctx = await navigateur.newContext({ viewport: vpm, colorScheme: theme, deviceScaleFactor: 1 });
      const p = await ctx.newPage();
      await p.setContent(h);
      const large = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      if (large) problemes.push(`${nom} : défilement horizontal`);
      await capturer(p, nom, { fullPage: true });
      await ctx.close();
    }
  }
} catch (e) {
  problemes.push("ÉCHEC : " + (e && e.stack || e));
} finally {
  await navigateur.close();
  serveur.kill();
}
console.log(`aide-pj : ${captures} captures${SORTIE ? " dans " + SORTIE : ""}`);
if (problemes.length) { console.error("PROBLÈMES :\n- " + problemes.join("\n- ")); process.exit(1); }
console.log("OK");
