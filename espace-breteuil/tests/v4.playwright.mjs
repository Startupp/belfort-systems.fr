// Vérification de la v4 : premier lancement (2 boutons) et 4 profils maquettés selon les DROITS RÉELS.
// Lancer depuis la racine du dépôt (Chromium déjà installé, ne pas lancer « playwright install ») :
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=$(npm root -g) node espace-breteuil/tests/v4.playwright.mjs [dossier-captures]
// Contrôles à 375 px et 1280 px :
//   - premier lancement : 2 gros boutons seulement (ni onglets, ni démo, ni tuiles) ; « Voir le calendrier »
//     mémorisé sur l'appareil, petit lien « Revenir à l'accueil » ;
//   - administrateur général, propriétaire du site, facturation, simple collaborateur, membre du groupe
//     « Site web » : UNIQUEMENT les onglets attendus (4 au plus), routes réservées refusées, pastille verte ;
//   - v5.1 « Site web » : onglet Site, tuiles WordPress (nouvel onglet), vérificateur de liens (réponse
//     maquettée : 1 cassé, 1 redirigé, 3 bons), « Corriger » → pas-à-pas, vérificateur absent → message clair ;
//   - « Déléguer » : permission demandée seulement sur cet écran, garde-fous, POST roleAssignments ;
//   - dossier commun introuvable : pastille orange et message dans Dossiers ;
//   - v5.2 « Suivi informatique » (#/suivi ; données FICTIVES, tests/suivi-exemple.json) : tuile en tête de Gérer / Équipe /
//     Finance, frise du plus récent au plus ancien, « Ouvrir » → PDF déposé (nouvel onglet), « document à
//     venir », tous/gestion, contact ; Moi → Guides pour tous ; dossier absent → message clair ; #/pilotage
//     redirigé ; ancien emplacement « Pilotage/pilotage.json » lu en repli ;
//   - aucune erreur console, pas de défilement horizontal, cibles ≥ 44 px.
// Réponses Microsoft et Worker maquettées ; ?maquette=1 n'agit que sur localhost.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const RACINE = fileURLToPath(new URL("../", import.meta.url));
const SORTIE = process.argv[2] || "";
const PORT = Number(process.env.EB_PORT) || 8768; // EB_PORT : autre port si un autre test tourne déjà
const BASE = `http://localhost:${PORT}/?maquette=1`;
if (SORTIE) mkdirSync(SORTIE, { recursive: true });
const ICS = readFileSync(RACINE + "exemple.ics", "utf8");
const ICS2 = readFileSync(RACINE + "exemple-accueil.ics", "utf8");
// v5.2 Suivi informatique : contenu et PDF FICTIFS (Château d'exemple) — jamais de données du client dans le dépôt.
const PILOTAGE = JSON.parse(readFileSync(RACINE + "tests/suivi-exemple.json", "utf8"));
const GUIDES_PDF = [
  { name: "guide-demarrage.pdf", file: {}, webUrl: "https://breteuil02.sharepoint.com/exemple/guide-demarrage.pdf", size: 245760, lastModifiedDateTime: "2026-05-05T09:00:00Z" },
  { name: "Memo Messagerie.pdf", file: {}, webUrl: "https://breteuil02.sharepoint.com/exemple/memo.pdf", size: 1300000 },
  { name: "Plan de bascule.pdf", file: {}, webUrl: "https://breteuil02.sharepoint.com/exemple/plan.pdf", size: 52000 },
  { name: "Notes internes.pdf", file: {}, webUrl: "https://breteuil02.sharepoint.com/exemple/notes.pdf", size: 1000 },
];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

const GA = "62e90394-69f5-4237-9190-012177145e10", BILLING = "b0f54661-2d74-4c50-afa3-1ec803f12efe";
const u = (id, nom, mail, lic, type = "Member") => ({ id, displayName: nom, givenName: nom.split(" ")[0], mail, userPrincipalName: mail, userType: type, accountEnabled: true, assignedLicenses: lic ? [{ skuId: lic }] : [] });
const USERS = [u("u1", "Pauline de Breteuil", "pdebreteuil@breteuil.fr", "a"), u("u2", "François de Breteuil", "fdebreteuil@breteuil.fr", "a"),
  u("u3", "Valérie Durand", "vdurand@breteuil.fr", "a"), u("u4", "Fanny Martin", "fmartin@breteuil.fr", "b"), u("u5", "Contact", "contact@breteuil.fr", null),
  u("u6", "Damien Belfort", "damien@breteuil02.onmicrosoft.com", null), u("u7", "Camille Roux", "croux@breteuil.fr", "b")];
const SP = { u1: 7, u2: 8, u3: 9, u4: 10, u6: 11, u7: 12 };
const PROPRIETAIRES = [{ Id: 7, Title: "Pauline de Breteuil", Email: "pdebreteuil@breteuil.fr", LoginName: "i:0#.f|membership|pdebreteuil@breteuil.fr", PrincipalType: 1 },
  { Id: 8, Title: "François de Breteuil", Email: "fdebreteuil@breteuil.fr", LoginName: "i:0#.f|membership|fdebreteuil@breteuil.fr", PrincipalType: 1 }];
// Plans de service réels d'une licence Business Standard / Basic (extraits de /licenseDetails).
const PLANS_STANDARD = ["MDOLITE_ENTERPRISE", "EXCHANGE_STORAGE_50GB", "INSIGHTS_BY_MYANALYTICS", "TEAMS1", "SHAREPOINTSTANDARD", "EXCHANGE_S_STANDARD",
  "SHAREPOINTWAC", "MCOSTANDARD", "OFFICESUBSCRIPTION", "FORMS_PLAN_E1", "FLOW_O365_P1", "POWERAPPS_O365_P1", "BPOS_S_TODO_1", "MICROSOFTBOOKINGS", "SWAY",
  "STREAM_O365_SMB", "WHITEBOARD_PLAN1", "PROJECTWORKMANAGEMENT", "INTUNE_O365", "VIVAENGAGE_CORE", "YAMMER_ENTERPRISE", "Bing_Chat_Enterprise",
  "MICROSOFT_SEARCH", "OFFICEMOBILE_SUBSCRIPTION", "MYANALYTICS_P2", "DYN365_CDS_O365_P2", "EXCHANGE_S_FOUNDATION"];
const PLANS_BASIC = PLANS_STANDARD.filter((x) => x !== "OFFICESUBSCRIPTION");
const detailsLicence = (sku) => ({ skuPartNumber: sku, servicePlans: (sku === "O365_BUSINESS_PREMIUM" ? PLANS_STANDARD : PLANS_BASIC)
  .map((n) => ({ servicePlanName: n, provisioningStatus: "Success" })).concat([{ servicePlanName: "KAIZALA_O365_P2", provisioningStatus: "Disabled" }]) });
const AVEC_GERER = { High: "432", Low: String(2 ** 24 + 0xFFFF) }, SANS_GERER = { High: "176", Low: "138612833" };

const PROFILS = {
  admin: { user: "u2", roles: [{ id: "r1", displayName: "Global Administrator", roleTemplateId: GA }], lic: ["O365_BUSINESS_PREMIUM"],
    attendus: ["planning", "fichiers", "gerer", "moi"], interdits: [], autorises: ["deleguer", "personnes", "licences-reel"] },
  proprietaire: { user: "u1", roles: [], lic: ["O365_BUSINESS_PREMIUM"],
    attendus: ["planning", "fichiers", "equipe", "moi"], interdits: ["deleguer", "finance", "gerer"], autorises: ["personnes", "acces/Commun"] },
  facturation: { user: "u3", roles: [{ id: "r2", displayName: "Billing Administrator", roleTemplateId: BILLING }], lic: ["O365_BUSINESS_PREMIUM"],
    attendus: ["planning", "fichiers", "finance", "moi"], interdits: ["deleguer", "personnes", "acces/Commun", "gerer"], autorises: ["licences-reel"] },
  collaborateur: { user: "u4", roles: [], lic: ["O365_BUSINESS_ESSENTIALS"], groupes: [{ id: "g2", displayName: "Accueil" }],
    attendus: ["planning", "fichiers", "moi"], interdits: ["deleguer", "personnes", "finance", "gerer", "equipe", "acces/Commun", "absences", "site", "liens", "guides/site"], autorises: [] },
  // Membre du groupe « Site web » (nom en majuscules : comparaison sans casse), aucun autre droit.
  siteweb: { user: "u7", roles: [], lic: ["O365_BUSINESS_ESSENTIALS"], groupes: [{ id: "g2", displayName: "Accueil" }, { id: "g1", displayName: "SITE WEB" }],
    attendus: ["planning", "fichiers", "site", "moi"], interdits: ["deleguer", "personnes", "finance", "gerer", "equipe", "acces/Commun", "guides/admin"], autorises: ["liens", "guides/site", "guides/site/pied"] },
};
// Réponse maquettée du Worker (GET /breteuil/site/liens) : 1 cassé, 1 redirigé, 4 bons.
const LIENS = { verifieLe: "2026-10-18T12:05:00.000Z", liens: [
  { texte: "Horaires, tarifs et accès", url: "https://www.breteuil.fr/horaires-tarifs-acces/", page: "fr", statut: 200, ok: true, redirigeVers: null },
  { texte: "Escape Game", url: "https://www.breteuil.fr/escape-game-du-chateau-de-breteuil/", page: "fr", statut: 404, ok: false, redirigeVers: null, methode: "GET" },
  { texte: "Presse", url: "https://www.breteuil.fr/presse/", page: "fr", statut: 200, ok: true, redirigeVers: "https://www.breteuil.fr/espace-presse-et-medias-2026/" },
  { texte: "E-billetterie", url: "https://breteuil.tickeasy.com/", page: "fr", statut: 200, ok: true, redirigeVers: null },
  // Ancienne réponse du Worker (cache d'1 h) : entité HTML non décodée → l'appli la décode en texte.
  { texte: "Groupes d&rsquo;enfants", url: "https://www.breteuil.fr/en-famille/", page: "fr", statut: 200, ok: true, redirigeVers: null },
  { texte: "Contact", url: "https://www.breteuil.fr/en/contact/", page: "en", statut: 200, ok: true, redirigeVers: null },
] };

function reponses(nomProfil, variante) {
  const p = PROFILS[nomProfil], moi = USERS.find((x) => x.id === p.user);
  const proprietaire = PROPRIETAIRES.some((x) => x.Id === SP[p.user]);
  const r = {
    "/v1.0/me": moi,
    "/v1.0/me/transitiveMemberOf/microsoft.graph.directoryRole": { value: p.roles },
    "/v1.0/me/licenseDetails": { value: p.lic.map(detailsLicence) },
    ...Object.fromEntries(USERS.filter((x) => x.assignedLicenses.length).map((x) => ["/v1.0/users/" + x.id + "/licenseDetails",
      { value: [detailsLicence(x.assignedLicenses[0].skuId === "a" ? "O365_BUSINESS_PREMIUM" : "O365_BUSINESS_ESSENTIALS")] }])),
    "/v1.0/me/transitiveMemberOf/microsoft.graph.group": { value: p.groupes || [] },
    "/v1.0/users": { value: USERS },
    "/v1.0/subscribedSkus": { value: [{ skuId: "a", skuPartNumber: "O365_BUSINESS_PREMIUM", prepaidUnits: { enabled: 6 }, consumedUnits: 4 }, { skuId: "b", skuPartNumber: "O365_BUSINESS_ESSENTIALS", prepaidUnits: { enabled: 6 }, consumedUnits: 1 }] },
    "/v1.0/directoryRoles": { value: [
      { id: "r1", displayName: "Global Administrator", roleTemplateId: GA, members: [{ "@odata.type": "#microsoft.graph.user", id: "u2", displayName: "François de Breteuil", mail: "fdebreteuil@breteuil.fr" }, { "@odata.type": "#microsoft.graph.user", id: "u6", displayName: "Damien Belfort", userPrincipalName: "damien@breteuil02.onmicrosoft.com" }] },
      { id: "r2", displayName: "Billing Administrator", roleTemplateId: BILLING, members: [{ "@odata.type": "#microsoft.graph.user", id: "u3", displayName: "Valérie Durand", mail: "vdurand@breteuil.fr" }] }] },
    "/v1.0/users/fmartin@breteuil.fr": { id: "u4", displayName: "Fanny Martin" },
    "/v1.0/me/drive": { id: "od1", webUrl: "https://breteuil02-my.sharepoint.com/personal/x" },
    "/v1.0/me/drive/recent": { value: [
      { id: "rf1", name: "Menu de Noël.docx", file: {}, webUrl: "https://breteuil02.sharepoint.com/Menu.docx", lastModifiedDateTime: "2026-10-16T10:00:00Z", remoteItem: { id: "rf1", parentReference: { driveId: "drive1" } } },
      { id: "rf2", name: "Budget 2027.xlsx", file: {}, webUrl: "https://breteuil02-my.sharepoint.com/Budget.xlsx", lastModifiedDateTime: "2026-10-15T10:00:00Z", remoteItem: { id: "rf2", parentReference: { driveId: "od1" } } }] },
    "/v1.0/me/drive/root/children": { value: [{ id: "o1", name: "Notes", folder: { childCount: 2 } }, { id: "o2", name: "Photo façade.jpg", file: {}, webUrl: "https://breteuil02-my.sharepoint.com/p.jpg", parentReference: { driveId: "od1" } }] },
    "/v1.0/sites/breteuil02.sharepoint.com:/sites/ChateaudeBreteuil": { id: "site1", displayName: "Château de Breteuil", webUrl: "https://breteuil02.sharepoint.com/sites/ChateaudeBreteuil" },
    "/v1.0/sites/site1/drive": { id: "drive1", name: "Documents" },
    "/v1.0/drives/drive1/list": { id: "list1" },
    "/v1.0/drives/drive1/root:/Commun": { id: "c1", name: "Commun", folder: { childCount: 4 } },
    "/v1.0/drives/drive1/root:/Commun:/children": { value: [{ id: "d1", name: "Accueil", folder: { childCount: 12 } }, { id: "d2", name: "Finance", folder: { childCount: 30 } },
      { id: "d3", name: "Jardins", folder: { childCount: 5 } }, { id: "d4", name: "Restauration", folder: { childCount: 8 } },
      { id: "f1", name: "Planning été.xlsx", file: {}, webUrl: "https://breteuil02.sharepoint.com/x.xlsx" }] },
    "/v1.0/drives/drive1/root:/Commun/Finance:/children": { value: [{ id: "f9", name: "Factures 2026.pdf", file: {}, webUrl: "https://breteuil02.sharepoint.com/f.pdf" }] },
    "/v1.0/drives/drive1/root/children": { value: [{ id: "c1", name: "Commun", folder: { childCount: 4 } }] },
    "/v1.0/drives/drive1/root:/Commun:": { id: "c1", name: "Commun", listItem: { id: "5" } },
    "/sites/ChateaudeBreteuil/_api/web/currentuser": { Id: SP[p.user], Title: moi.displayName, Email: moi.mail, LoginName: "i:0#.f|membership|" + moi.mail, IsSiteAdmin: false },
    "/sites/ChateaudeBreteuil/_api/web/associatedownergroup": { Id: 3, Title: "Propriétaires de Château de Breteuil" },
    "/sites/ChateaudeBreteuil/_api/web/associatedownergroup/users": { value: PROPRIETAIRES },
    "/sites/ChateaudeBreteuil/_api/web/sitegroups/getbyid(3)/users": { value: PROPRIETAIRES },
    "/sites/ChateaudeBreteuil/_api/web/effectivebasepermissions": proprietaire ? AVEC_GERER : SANS_GERER,
    "/sites/ChateaudeBreteuil/_api/web/lists(guid'list1')/items(5)": { HasUniqueRoleAssignments: false },
    "/sites/ChateaudeBreteuil/_api/web/lists(guid'list1')/items(5)/roleassignments": { value: [
      { PrincipalId: 3, Member: { Id: 3, Title: "Propriétaires de Château de Breteuil", PrincipalType: 8 }, RoleDefinitionBindings: [{ RoleTypeKind: 5, Name: "Contrôle total" }] }] },
  };
  if (variante === "suivi-ancien") {
    r["/v1.0/drives/drive1/root:/Commun/Pilotage/pilotage.json:/content"] = PILOTAGE;
    r["/v1.0/drives/drive1/root:/Commun/Pilotage/Guides:/children"] = { value: GUIDES_PDF.slice(0, 1) };
  } else if (variante !== "suivi-absent") {
    r["/v1.0/drives/drive1/root:/Commun/Suivi informatique/suivi.json:/content"] = PILOTAGE;
    r["/v1.0/drives/drive1/root:/Commun/Suivi informatique/Guides:/children"] = { value: GUIDES_PDF };
  }
  if (variante === "commun-introuvable") { delete r["/v1.0/drives/drive1/root:/Commun"]; delete r["/v1.0/drives/drive1/root:/Commun:/children"]; }
  return { r, moi };
}

async function preparer(contexte, nomProfil, opts = {}) {
  const journal = [];
  if (nomProfil) {
    const { r, moi } = reponses(nomProfil, opts.variante);
    await contexte.addInitScript((m) => { self.EB_MAQUETTE = m; }, { compte: { name: moi.displayName, username: moi.mail, localAccountId: moi.id }, permissions: [] });
    await contexte.route(/https:\/\/(graph\.microsoft\.com|[a-z0-9-]+\.sharepoint\.com)\/.*/, async (route) => {
      const req = route.request(), url = new URL(req.url()), chemin = decodeURIComponent(url.pathname);
      if (/\/photos\//.test(url.pathname)) return route.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "image/png" }, body: PNG });
      if (req.method() !== "GET") {
        journal.push({ methode: req.method(), chemin, corps: req.method() === "PUT" ? null : req.postData() });
        if (/\/createLink$/.test(chemin)) return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ link: { webUrl: "https://breteuil02.sharepoint.com/:w:/s/lien-interne" } }) });
        if (req.method() === "PUT") return route.fulfill({ status: 201, headers: CORS, body: JSON.stringify({ id: "nouveau", name: "x" }) });
        return route.fulfill({ status: req.method() === "POST" ? 201 : 204, headers: CORS, body: req.method() === "POST" ? JSON.stringify({ id: "ra-nouveau" }) : "" });
      }
      const v = r[chemin];
      if (!v) return route.fulfill({ status: 404, headers: CORS, body: JSON.stringify({ error: { code: "itemNotFound", message: "introuvable " + chemin } }) });
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(v) });
    });
  } else {
    await contexte.addInitScript(() => { self.EB_MAQUETTE = { deconnecte: true }; });
  }
  await contexte.route("https://belfort-api.damien-belfort.workers.dev/**", (r) => {
    const url = r.request().url();
    if (/\/breteuil\/site\/liens/.test(url)) {
      journal.push({ methode: "GET", chemin: new URL(url).pathname + new URL(url).search });
      if (opts.liens === "absent") return r.fulfill({ status: 404, headers: CORS, body: JSON.stringify({ ok: false, erreur: "Introuvable." }) });
      return r.fulfill({ status: 200, headers: CORS, body: JSON.stringify(LIENS) });
    }
    return r.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "text/calendar" }, body: /\/2\.ics/.test(url) ? ICS2 : ICS });
  });
  return journal;
}

const serveur = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: RACINE, stdio: "ignore" });
await new Promise((ok) => setTimeout(ok, 800));
const navigateur = await chromium.launch();
const problemes = [];
let captures = 0;

async function nouvellePage(vp, nomProfil, opts) {
  const contexte = await navigateur.newContext({ viewport: vp, deviceScaleFactor: 1, serviceWorkers: "block", locale: "fr-FR", colorScheme: opts && opts.theme || "light" });
  const journal = await preparer(contexte, nomProfil, opts || {});
  const page = await contexte.newPage();
  const erreurs = [];
  page.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text()); });
  page.on("pageerror", (e) => erreurs.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 400 && process.env.EB_DEBUG) console.log("HTTP", r.status(), r.url()); });
  return { contexte, page, erreurs, journal };
}
async function capturer(page, nom) {
  if (!SORTIE) return;
  // Capture pleine page prise depuis le haut : sinon l'en-tête collant et les onglets fixes sont
  // dessinés au milieu de l'image (artefact de capture, pas un défaut de l'appli).
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  // v5 : attendre la fin des apparitions (animations finies seulement ; les boucles infinies et le défilement sont ignorés).
  await page.evaluate(() => Promise.race([new Promise((ok) => setTimeout(ok, 2000)), Promise.all(document.getAnimations()
    .filter((a) => a.timeline === document.timeline && isFinite(a.effect.getComputedTiming().endTime)).map((a) => a.finished.catch(() => {})))]));
  await page.screenshot({ path: `${SORTIE}/${nom}.png`, fullPage: true });
  captures++;
}
/** Attendre la fin des apparitions (glissement d'écran) avant de mesurer. */
const calme = (page) => page.evaluate(() => Promise.race([new Promise((ok) => setTimeout(ok, 2000)), Promise.all(document.getAnimations()
  .filter((a) => a.timeline === document.timeline && isFinite(a.effect.getComputedTiming().endTime)).map((a) => a.finished.catch(() => {})))]));
async function controlesCommuns(page, ou) {
  const r = await page.evaluate(() => ({ large: document.documentElement.scrollWidth > window.innerWidth + 1,
    petites: [...document.querySelectorAll(".onglets a, .barre .btn-rond, .barre .btn-retour, .pastille-etat, .gros-bouton, .t, .lien-discret button")]
      .filter((e) => e.offsetParent !== null).map((e) => { const b = e.getBoundingClientRect(); return { t: (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 30), w: b.width, h: b.height }; })
      .filter((b) => b.w < 44 || b.h < 44) }));
  if (r.large) problemes.push(`${ou} : défilement horizontal`);
  if (r.petites.length) problemes.push(`${ou} : cibles < 44 px : ${JSON.stringify(r.petites.slice(0, 3))}`);
}
const ongletsVisibles = (page) => page.$$eval("#onglets:not([hidden]) a", (l) => l.map((a) => a.dataset.onglet));

try {
  for (const [taille, vp] of [["375", { width: 375, height: 812 }], ["1280", { width: 1280, height: 900 }]]) {
    /* ---------- Premier lancement ---------- */
    {
      const { contexte, page, erreurs } = await nouvellePage(vp, null);
      await page.goto(BASE);
      await page.waitForSelector(".gros-bouton");
      const boutons = await page.$$eval(".gros-bouton", (l) => l.map((b) => b.querySelector("b").textContent));
      assert.deepEqual(boutons, ["Voir le calendrier", "Se connecter"], "premier écran : 2 boutons");
      assert.equal(await page.isVisible("#onglets"), false, "premier écran : pas d'onglets");
      assert.equal(await page.$$eval(".tuiles, .pastille-demo, .t", (l) => l.length), 0, "premier écran : ni tuiles ni démo");
      await controlesCommuns(page, `premier ${taille}`);
      await capturer(page, `premier-lancement-${taille}`);
      await page.click('[data-action="calendrier"]');
      await page.waitForSelector(".bloc-planning .zone-planning .evts, .bloc-planning .zone-planning .semaine, .bloc-planning .zone-planning .vide");
      assert.equal(await page.isVisible("#onglets"), false, "calendrier seul : pas d'onglets");
      assert.ok(await page.isVisible('[data-action="accueil"]'), "lien discret « Revenir à l'accueil »");
      await page.reload();
      await page.waitForSelector('[data-action="accueil"]');
      await controlesCommuns(page, `calendrier ${taille}`);
      await capturer(page, `calendrier-seul-${taille}`);
      await page.click('[data-action="accueil"]');
      await page.waitForSelector(".gros-bouton");
      if (erreurs.length) problemes.push(`premier ${taille} : erreurs console ${erreurs.join(" | ")}`);
      await contexte.close();
    }

    /* ---------- 5 profils ---------- */
    for (const [nom, p] of Object.entries(PROFILS)) {
      const { contexte, page, erreurs, journal } = await nouvellePage(vp, nom, { theme: nom === "facturation" ? "dark" : "light" });
      await page.goto(BASE + "#/planning");
      await page.waitForFunction((n) => document.querySelectorAll("#onglets a").length === n, p.attendus.length, { timeout: 8000 });
      await page.waitForFunction((ids) => [...document.querySelectorAll("#onglets a")].map((a) => a.dataset.onglet).join() === ids.join(), p.attendus, { timeout: 8000 });
      assert.deepEqual(await ongletsVisibles(page), p.attendus, `${nom} : onglets attendus`);
      assert.ok(p.attendus.length <= 4);
      await page.waitForSelector(".pastille-etat.vert", { timeout: 8000 });
      for (const onglet of p.attendus) {
        await page.click(`#onglets a[data-onglet="${onglet}"]`);
        await page.waitForFunction((o) => location.hash === "#/" + o, onglet);
        await page.waitForTimeout(150);
        await controlesCommuns(page, `${nom} ${onglet} ${taille}`);
        await capturer(page, `${nom}-${onglet}-${taille}`);
      }
      // Fichiers : 3 sections ; « Qui a accès ? » seulement avec ManagePermissions.
      await page.goto(BASE + "#/fichiers");
      await page.waitForSelector('[data-fichier="Menu de Noël.docx"]');
      await page.waitForSelector('#t-commun ~ div .tuiles, .section-fichiers .tuiles');
      assert.deepEqual(await page.$$eval(".section-fichiers h2", (l) => l.map((x) => x.textContent)), ["Récents", "Mes fichiers", "Dossier commun"]);
      const quiAcces = !!(await page.$('a[href^="#/acces"]'));
      assert.equal(quiAcces, nom === "proprietaire" || nom === "admin", `${nom} : « Qui a accès » selon le droit réel`);
      for (const route of p.interdits) {
        await page.goto(BASE + "#/" + route);
        await page.waitForFunction(() => location.hash === "#/planning", null, { timeout: 4000 }).catch(() => problemes.push(`${nom} : #/${route} aurait dû être refusé`));
      }
      for (const route of p.autorises) {
        await page.goto(BASE + "#/" + route);
        await page.waitForTimeout(300);
        if ((await page.evaluate(() => location.hash)) !== "#/" + route) problemes.push(`${nom} : #/${route} aurait dû être permis`);
      }
      if (nom === "collaborateur") {
        // Fichiers : lien de partage interne, ouverture dans Office, téléversement.
        await page.goto(BASE + "#/fichiers");
        await page.click('[data-fichier="Menu de Noël.docx"]');
        assert.ok(await page.isVisible('dialog .choix:has-text("Ouvrir dans Word")'), "ouvrir dans Office");
        await page.click('dialog .choix:has-text("Copier un lien de partage")');
        await page.waitForFunction(() => /Lien copié|Sélectionnez/.test((document.getElementById("toast")?.textContent || "") + (document.querySelector("dialog[open]")?.textContent || "")));
        const lien = journal.find((x) => x.methode === "POST" && /\/createLink$/.test(x.chemin));
        assert.ok(lien, "createLink envoyé"); assert.deepEqual(JSON.parse(lien.corps), { type: "view", scope: "organization" });
        await page.keyboard.press("Escape");
        const [choixFichier] = await Promise.all([page.waitForEvent("filechooser"), page.click('[data-action="televerser-moi"]')]);
        await choixFichier.setFiles({ name: "Compte rendu.txt", mimeType: "text/plain", buffer: Buffer.from("bonjour") });
        await page.click('dialog button:has-text("Oui, téléverser")');
        await page.waitForFunction(() => /téléversé/.test(document.getElementById("toast")?.textContent || ""));
        assert.ok(journal.some((x) => x.methode === "PUT" && x.chemin === "/v1.0/drives/od1/root:/Compte rendu.txt:/content"), "PUT de téléversement");
        await capturer(page, `collaborateur-fichiers-televerse-${taille}`);
        // Épingles : boîte partagée → Outlook web, ordre au clavier, retrait.
        await page.goto(BASE + "#/planning");
        await page.click('[data-action="epingler"]');
        await page.click('dialog .choix:has-text("contact@breteuil.fr")');
        await page.click('[data-action="epingler"]');
        await page.click('dialog .choix:has-text("finance@breteuil.fr")');
        let ep = await page.evaluate(() => window.EBEpingles.lire());
        assert.deepEqual(ep.map((e) => e.url), ["https://outlook.office.com/mail/contact%40breteuil.fr/", "https://outlook.office.com/mail/finance%40breteuil.fr/"]);
        await page.focus('[data-epingle="https://outlook.office.com/mail/finance%40breteuil.fr/"]');
        await page.keyboard.press("Alt+ArrowLeft");
        ep = await page.evaluate(() => window.EBEpingles.lire());
        assert.equal(ep[0].adresse, "finance@breteuil.fr", "réordonner");
        await capturer(page, `collaborateur-epingles-${taille}`);
        await page.focus('[data-epingle="https://outlook.office.com/mail/contact%40breteuil.fr/"]');
        await page.keyboard.press("Delete");
        await page.click('dialog button:has-text("Oui, retirer")');
        assert.equal((await page.evaluate(() => window.EBEpingles.lire())).length, 1, "retirer");
        assert.ok(!journal.some((x) => /mail|messages|sendMail/i.test(x.chemin)), "aucun appel de messagerie");
      }
      if (nom === "siteweb") {
        // Onglet Site : rappel de l'identifiant WordPress, 8 tuiles, liens WordPress dans un nouvel onglet.
        await page.goto(BASE + "#/site");
        await page.waitForSelector(".section-site .tuiles .t");
        assert.match(await page.textContent(".section-site .bandeau"), /propre identifiant/);
        const tuilesSite = await page.$$eval(".section-site .t", (l) => l.map((a) => ({ lib: a.querySelector(".lib").textContent, href: a.getAttribute("href"), cible: a.getAttribute("target") })));
        assert.equal(tuilesSite.length, 8);
        for (const t of tuilesSite.filter((x) => /^https:/.test(x.href))) assert.equal(t.cible, "_blank", t.lib);
        assert.ok(tuilesSite.some((t) => t.href === "https://www.breteuil.fr/wp-admin/upload.php"));
        await page.click('#fiche-pied > summary');
        await page.waitForSelector('#fiche-pied[open] .etapes li');
        await calme(page);
        await controlesCommuns(page, `siteweb fiche ${taille}`);
        await capturer(page, `siteweb-site-fiche-ouverte-${taille}`);
        // Vérificateur de liens : cassé d'abord (rouge), puis à vérifier (orange), bons repliés.
        await page.click('.section-site a[href="#/liens"]');
        await page.waitForSelector(".carte-lien.casse");
        const groupes = await page.$$eval(".zone-liens .carte-lien", (l) => l.map((c) => c.className.replace("carte-lien ", "")));
        assert.deepEqual(groupes, ["casse", "verifier", "ok", "ok", "ok", "ok"]);
        assert.equal(await page.isVisible(".liens-ok .carte-lien"), false, "bons liens repliés");
        assert.match(await page.textContent(".bilan-liens"), /1 cassé.*1 à vérifier.*4 bons/);
        // Entités HTML décodées (texte), jamais affichées telles quelles.
        assert.equal(await page.textContent('[data-lien="https://www.breteuil.fr/en-famille/"] .quoi b'), "Groupes d\u2019enfants");
        assert.ok(!/&[a-z]+;/i.test(await page.textContent(".zone-liens")), "aucune entité HTML visible");
        await calme(page);
        await controlesCommuns(page, `siteweb liens ${taille}`);
        await capturer(page, `siteweb-liens-${taille}`);
        await page.click(".liens-ok > summary");
        await page.waitForSelector('.liens-ok[open] [data-lien="https://www.breteuil.fr/en-famille/"]');
        await calme(page);
        await capturer(page, `siteweb-liens-bons-ouverts-${taille}`);
        await page.click('[data-action="reverifier"]');
        await page.waitForFunction(() => !document.querySelector('[data-action="reverifier"]').disabled);
        assert.ok(journal.some((x) => x.chemin === "/breteuil/site/liens?forcer=1"), "Revérifier → ?forcer=1");
        await page.click('.carte-lien.casse a:has-text("Corriger")');
        await page.waitForFunction(() => location.hash === "#/guides/site/pied");
        await page.waitForSelector(".etapes li");
        assert.equal(await page.$$eval(".etapes li", (l) => l.length), 3);
        await capturer(page, `siteweb-guide-pied-${taille}`);
        await page.goto(BASE + "#/guides/site/couleurs");
        await page.waitForSelector('.bandeau.exemple:has-text("site de test")');
      }
      if (nom === "admin") {
        // « Ce que je peux utiliser » : outils en français, codes Microsoft repliés en bas, rien sous l'en-tête.
        await page.goto(BASE + "#/personnes/u3");
        await page.waitForSelector(".outils-inclus ul.liste-inclus li");
        await calme(page);
        const inclus = await page.$$eval(".outils-inclus ul.liste-inclus li", (l) => l.map((li) => li.textContent.trim()));
        for (const n of ["Teams", "Boîte mail Outlook (50 Go)", "Dossiers partagés (SharePoint)", "Word, Excel, PowerPoint à installer", "Planner (projets)"])
          assert.ok(inclus.some((t) => t.endsWith(n)), "outil traduit : " + n);
        assert.equal(new Set(inclus).size, inclus.length, "outils dédoublonnés");
        assert.ok(!inclus.some((t) => /[A-Z0-9]+_[A-Z0-9_]+/.test(t)), "aucun code Microsoft dans la liste");
        assert.equal(await page.$$eval("details.support-codes", (l) => l.length), 1, "un seul repli support");
        assert.equal(await page.$eval("details.support-codes", (d) => d.open), false, "repli support fermé par défaut");
        assert.equal(await page.isVisible("details.support-codes ul.codes"), false);
        assert.equal(await page.$("ul.plans"), null, "plus de liste brute sur deux colonnes");
        assert.ok(await page.$eval("details.support-codes", (d) => !d.nextElementSibling && d.parentElement.matches(".outils-inclus") && !d.parentElement.nextElementSibling), "repli tout en bas");
        // Défilement vers la carte de licence : elle s'arrête sous l'en-tête collant.
        const sousEntete = async () => page.evaluate(() => { const c = document.querySelector(".carte-profil"); c.scrollIntoView(); const b = document.querySelector(".barre").getBoundingClientRect();
          const o = document.getElementById("onglets"), ob = o && !o.hidden && getComputedStyle(o).position === "fixed" && o.getBoundingClientRect().top < 10 ? o.getBoundingClientRect().bottom : 0;
          return { carte: c.getBoundingClientRect().top, entete: Math.max(b.bottom, ob) }; });
        await page.evaluate(() => { document.querySelector(".ecran").style.minHeight = "300vh"; });
        const m1 = await sousEntete();
        if (m1.carte < m1.entete - 1) problemes.push(`licence ${taille} : la carte passe sous l'en-tête (${JSON.stringify(m1)})`);
        await page.evaluate(() => { document.querySelector(".ecran").style.minHeight = ""; window.scrollTo(0, 0); });
        await controlesCommuns(page, `admin licence ${taille}`);
        await capturer(page, `admin-licence-${taille}`);
        await page.click("details.support-codes > summary");
        await page.waitForSelector("details.support-codes ul.codes li");
        const codes = await page.$$eval("details.support-codes ul.codes li", (l) => l.map((x) => x.textContent));
        assert.ok(codes.some((c) => /^MDOLITE_ENTERPRISE/.test(c)) && codes.some((c) => /KAIZALA_O365_P2.*désactivé/.test(c)), "codes non reconnus et désactivés");
        assert.equal(await page.$eval("details.support-codes ul.codes", (u) => getComputedStyle(u).columnCount), "auto", "une colonne");
        await controlesCommuns(page, `admin licence support ${taille}`);
        await capturer(page, `admin-licence-support-ouvert-${taille}`);
        // Moi : la même liste pour ses propres licences.
        await page.goto(BASE + "#/moi");
        await page.waitForSelector(".outils-inclus ul.liste-inclus li");
        await calme(page);
        await controlesCommuns(page, `admin moi ${taille}`);
        await capturer(page, `admin-moi-licence-${taille}`);
        await page.goto(BASE + "#/gerer");
        await page.waitForSelector("#t-site");
        assert.equal(await page.$$eval(".section-site .t", (l) => l.length), 8, "admin : section Site web dans Gérer");
        await capturer(page, `admin-gerer-site-web-${taille}`);
        await page.goto(BASE + "#/deleguer");
        await page.waitForSelector('[data-permission="manquante"]');
        assert.ok(await page.isDisabled('[data-action="donner-facturation"]'), "sans permission : boutons désactivés");
        await capturer(page, `admin-deleguer-sans-permission-${taille}`);
        await page.click('[data-action="autoriser-roles"]');
        await page.waitForSelector('[data-action="donner-facturation"]:not([disabled])');
        assert.equal(await page.$('[data-permission="manquante"]'), null);
        assert.ok(await page.isDisabled('[data-titulaire="u2"] button'), "garde-fou : son propre rôle d'administrateur général");
        assert.ok(await page.isDisabled('[data-proprietaire="fdebreteuil@breteuil.fr"] button'), "garde-fou : se retirer soi-même des propriétaires");
        await capturer(page, `admin-deleguer-${taille}`);
        // Donner le rôle Facturation à Fanny : choix, 2 confirmations, POST roleAssignments.
        await page.click('[data-action="donner-facturation"]');
        await page.click('dialog .choix:has-text("Fanny Martin")');
        await page.click('dialog button:has-text("Continuer")');
        await page.click('dialog button:has-text("Oui, donner le rôle")');
        await page.waitForFunction(() => /Fanny Martin est maintenant/.test(document.getElementById("toast")?.textContent || ""));
        const post = journal.find((x) => x.methode === "POST" && x.chemin === "/v1.0/roleManagement/directory/roleAssignments");
        assert.ok(post, "POST roleAssignments envoyé");
        assert.deepEqual(JSON.parse(post.corps), { "@odata.type": "#microsoft.graph.unifiedRoleAssignment", roleDefinitionId: BILLING, principalId: "u4", directoryScopeId: "/" });
        await page.waitForSelector(".journal .ligne-journal");
        // Tous les écrans de l'administrateur (et les démos, une fois le réglage activé) s'ouvrent sans erreur.
        await page.evaluate(() => { const r = JSON.parse(localStorage.getItem("eb:reglages") || "{}"); r.demos = true; localStorage.setItem("eb:reglages", JSON.stringify(r)); });
        await page.reload();
        for (const route of ["gerer", "liens", "guides/site", "guides/site/cache", "personnes", "personnes/u4", "organisation", "licences-reel", "guides/admin", "guides/finance", "commun", "commun/Commun/Finance", "acces/Commun",
          "onedrive", "journal", "reglages", "details", "installer", "demos", "arrivee/1", "depart", "roles", "boites", "securite", "historique", "licences", "simulateur", "factures", "paiement"]) {
          await page.goto(BASE + "#/" + route);
          await page.waitForSelector(".barre h1");
          await page.waitForTimeout(150);
          if (!(await page.evaluate(() => location.hash)).startsWith("#/" + route)) problemes.push(`admin : #/${route} redirigé`);
        }
        await page.goto(BASE + "#/absences");
        await page.waitForFunction(() => location.hash === "#/planning").catch(() => problemes.push("#/absences devrait être retiré"));
      }
      if (erreurs.length) problemes.push(`${nom} ${taille} : erreurs console ${erreurs.join(" | ")}`);
      await contexte.close();
    }

    /* ---------- v5.2 Suivi informatique (données fictives) ---------- */
    for (const nom of ["admin", "proprietaire", "facturation", "collaborateur"]) {
      const { contexte, page, erreurs, journal } = await nouvellePage(vp, nom);
      await page.goto(BASE + "#/planning");
      await page.waitForFunction((n) => document.querySelectorAll("#onglets a").length === n, PROFILS[nom].attendus.length, { timeout: 8000 });
      const gestion = PROFILS[nom].attendus[2];
      if (nom !== "collaborateur") {
        // Tuile en tête de l'onglet de gestion (avant toute section).
        await page.goto(BASE + "#/" + gestion);
        await page.waitForSelector(".carte-suivi");
        assert.ok(await page.evaluate(() => { const t = document.querySelector(".carte-suivi"), s = document.querySelector(".ecran .section");
          return !s || !!(t.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING); }), `${nom} : tuile Suivi informatique en tête`);
        assert.match(await page.textContent(".carte-suivi"), /^Suivi informatique — tout ce qui a été fait pour vous/);
        await page.click(".carte-suivi");
        await page.waitForFunction(() => location.hash === "#/suivi");
        await page.waitForSelector(".frise-suivi .etape-frise");
        assert.equal((await page.textContent(".barre h1")).startsWith("Suivi informatique"), true, "titre « Suivi informatique »");
        assert.doesNotMatch(await page.textContent(".ecran"), /Pilotage/, "plus aucun « Pilotage » à l'écran");
        assert.deepEqual(await ongletsVisibles(page), PROFILS[nom].attendus, `${nom} : 4 onglets au plus, inchangés`);
        assert.equal(await page.getAttribute("#onglets a.actif", "data-onglet"), gestion, `${nom} : Suivi informatique sous l'onglet ${gestion}`);
        assert.deepEqual(await page.$$eval(".frise-suivi time", (l) => l.map((t) => t.textContent)), ["1er juin 2026", "5 mai 2026", "5 mai 2026", "20 avril 2026", "2 mars 2026"], "frise : récent → ancien, date en toutes lettres");
        assert.equal(await page.$$eval(".zone-suivi img", (l) => l.length), 0, "aucun HTML interprété");
        assert.match(await page.textContent(".frise-suivi"), /<img src=x onerror=alert\(1\)> reste du texte/);
        const ouvrir = await page.$$eval(".docs-frise a", (l) => l.map((a) => [a.getAttribute("href"), a.target, a.rel]));
        assert.deepEqual(ouvrir.map((x) => x[0]), ["https://breteuil02.sharepoint.com/exemple/guide-demarrage.pdf", "https://breteuil02.sharepoint.com/exemple/memo.pdf", "https://breteuil02.sharepoint.com/exemple/plan.pdf"]);
        assert.ok(ouvrir.every((x) => x[1] === "_blank" && /noopener/.test(x[2])), "Ouvrir : nouvel onglet");
        assert.deepEqual(await page.$$eval(".docs-frise .a-venir", (l) => l.map((x) => x.textContent)), ["document à venir"], "devis pas encore déposé");
        assert.deepEqual(await page.$$eval(".liste-docs .doc b", (l) => l.map((x) => x.textContent)),
          ["Guide de démarrage", "Mémo messagerie (1 page)", "Plan de bascule et coûts", "Devis postes et sauvegarde", "Notes internes.pdf"], "tous les documents (gestion)");
        assert.equal(await page.$$eval(".carte-theme", (l) => l.length), 3);
        assert.ok(await page.$('.carte-contact a[href="tel:+33123456789"]'));
        assert.ok(await page.$('.carte-contact a[href="mailto:jean@exemple.test"]'));
        assert.ok(journal.length === 0 || !journal.some((x) => /Suivi|Pilotage/.test(x.chemin)), "lecture seule");
        await calme(page);
        await controlesCommuns(page, `${nom} suivi ${taille}`);
        if (nom === "admin") await capturer(page, `suivi-${taille}`);
        // Ancienne adresse : #/pilotage → #/suivi.
        await page.goto(BASE + "#/pilotage");
        await page.waitForFunction(() => location.hash === "#/suivi");
        await page.waitForSelector(".frise-suivi .etape-frise");
        await page.click('.sommaire-suivi button:has-text("Contacter")');
      } else {
        for (const route of ["suivi", "pilotage"]) {
          await page.goto(BASE + "#/" + route);
          await page.waitForFunction(() => location.hash === "#/planning", null, { timeout: 4000 }).catch(() => problemes.push(`collaborateur : #/${route} aurait dû être refusé`));
        }
      }
      // Moi → Guides : pour tout le monde, seulement les guides « pour: tous ».
      await page.goto(BASE + "#/moi");
      await page.click('a.action[href="#/moi/guides"]');
      await page.waitForFunction(() => location.hash === "#/moi/guides");
      await page.waitForSelector(".liste-docs .doc");
      assert.equal(await page.getAttribute("#onglets a.actif", "data-onglet"), "moi");
      assert.deepEqual(await page.$$eval(".liste-docs .doc b", (l) => l.map((x) => x.textContent)), ["Guide de démarrage", "Mémo messagerie (1 page)"], `${nom} : guides pour tous`);
      assert.doesNotMatch(await page.textContent(".ecran"), /réservé à la gestion|Plan de bascule|Notes internes/);
      const pas = await page.$$eval(".liste-fiches a", (l) => l.map((a) => a.getAttribute("href")));
      assert.deepEqual(pas, { admin: ["#/guides/admin", "#/guides/finance", "#/guides/site"], proprietaire: ["#/guides/admin"], facturation: ["#/guides/finance"], collaborateur: [] }[nom], `${nom} : pas-à-pas selon le profil`);
      for (const href of pas) { await page.goto(BASE + href); await page.waitForTimeout(200); if ((await page.evaluate(() => location.hash)) !== href) problemes.push(`${nom} : ${href} refusé depuis Moi → Guides`); }
      await page.goto(BASE + "#/moi/guides");
      await page.waitForSelector(".liste-docs .doc");
      await calme(page);
      await controlesCommuns(page, `${nom} moi-guides ${taille}`);
      if (nom === "collaborateur") await capturer(page, `moi-guides-${taille}`);
      if (erreurs.length) problemes.push(`suivi ${nom} ${taille} : erreurs console ${erreurs.join(" | ")}`);
      await contexte.close();
    }
    /* ---------- v5.2 Suivi informatique : ancien emplacement lu en repli ---------- */
    {
      const { contexte, page, erreurs } = await nouvellePage(vp, "proprietaire", { variante: "suivi-ancien" });
      await page.goto(BASE + "#/suivi");
      await page.waitForSelector(".frise-suivi .etape-frise", { timeout: 8000 });
      assert.equal(await page.$$eval(".liste-docs a.doc", (l) => l.length), 1, "PDF lus dans Pilotage/Guides");
      const autres = erreurs.filter((e) => !/404/.test(e));
      if (autres.length) problemes.push(`suivi ancien ${taille} : erreurs console ${autres.join(" | ")}`);
      await contexte.close();
    }
    /* ---------- v5.2 Suivi informatique : dossier pas encore déposé ---------- */
    {
      const { contexte, page, erreurs } = await nouvellePage(vp, "proprietaire", { variante: "suivi-absent" });
      await page.goto(BASE + "#/suivi");
      await page.waitForSelector('[data-etat="absent"]', { timeout: 8000 });
      assert.equal(await page.textContent('[data-etat="absent"]'), "Le dossier Suivi informatique n'est pas encore en place — Damien doit le déposer dans le dossier commun.");
      assert.equal(await page.$(".bandeau.erreur"), null, "pas d'erreur technique");
      await capturer(page, `suivi-absent-${taille}`);
      await page.goto(BASE + "#/moi/guides");
      await page.waitForSelector('[data-etat="absent"]');
      const autres = erreurs.filter((e) => !/404/.test(e));
      if (autres.length) problemes.push(`suivi absent ${taille} : erreurs console ${autres.join(" | ")}`);
      await contexte.close();
    }

    /* ---------- Vérificateur de liens pas encore installé (Worker sans la route) ---------- */
    {
      const { contexte, page, erreurs } = await nouvellePage(vp, "siteweb", { liens: "absent" });
      await page.goto(BASE + "#/liens");
      await page.waitForSelector('[data-etat="erreur"]', { timeout: 8000 });
      assert.match(await page.textContent('[data-etat="erreur"]'), /pas encore installé.*Damien doit mettre à jour le service/);
      await capturer(page, `siteweb-liens-absent-${taille}`);
      const autres = erreurs.filter((e) => !/404/.test(e));
      if (autres.length) problemes.push(`liens absent ${taille} : erreurs console ${autres.join(" | ")}`);
      await contexte.close();
    }

    /* ---------- Liste des boîtes partagées : démo « Boîtes mail » (fictif) puis « Qui a quoi » (vraies données) ---------- */
    {
      const { contexte, page, erreurs } = await nouvellePage(vp, "admin");
      await page.addInitScript(() => localStorage.setItem("eb:reglages", JSON.stringify({ demos: true })));
      await page.goto(BASE + "#/boites");
      await page.waitForSelector(".liste-boites .ligne-boite");
      const lignes = await page.$$eval(".liste-boites .ligne-boite", (l) => l.map((x) => ({ nom: x.querySelector(".quoi b").textContent,
        adresse: x.querySelector(".quoi small").textContent, ouvrir: x.querySelector('a.btn[href^="https://outlook.office.com/mail/"]')?.getAttribute("href"),
        pastilles: x.querySelectorAll(".pastille-initiales").length, personne: !!x.querySelector(".qui-boite.personne"), epingler: !!x.querySelector("[data-epingler]"),
        regler: x.querySelector('a.btn[href^="#/boites/"]')?.getAttribute("href"),
        deborde: x.scrollWidth > x.clientWidth + 1 })));
      assert.ok(lignes.length >= 5, "démo : une ligne par boîte");
      const noms = lignes.map((x) => x.nom);
      assert.deepEqual(noms, [...noms].sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" })), "tri alphabétique");
      for (const x of lignes) {
        assert.equal(x.ouvrir, "https://outlook.office.com/mail/" + encodeURIComponent(x.adresse) + "/", "Ouvrir → Outlook web");
        assert.ok(x.pastilles <= 4 && (x.pastilles > 0 || x.personne), `${x.nom} : pastilles (4 au plus) ou « Personne »`);
        assert.equal(x.epingler, false, "démo : pas d'épingles");
        assert.ok(x.regler, `${x.nom} : bouton « Régler »`);
        if (x.deborde) problemes.push(`boîtes ${taille} : la ligne « ${x.nom} » déborde`);
      }
      assert.equal(await page.$(".zone-liste-boites .recherche"), null, "pas de recherche pour 8 boîtes ou moins");
      await controlesCommuns(page, `boîtes démo ${taille}`);
      await capturer(page, `boites-liste-demo-${taille}`);
      // Plus de 8 boîtes et plus de 4 personnes : recherche et « +n ».
      const r = await page.evaluate(() => {
        const qui = ["Anne", "Bruno", "Chloé", "David", "Emma", "Farid"].map((nom) => ({ nom }));
        const l = Array.from({ length: 10 }, (_, i) => ({ nom: "Boîte " + String.fromCharCode(74 - i), adresse: "b" + i + "@exemple.fr", qui: i === 0 ? qui : [] }));
        const z = window.EBListeBoites.liste(l, {});
        document.querySelector(".zone-liste-boites").after(z);
        const champ = z.querySelector("input.recherche");
        const plus = z.querySelector(".pastille-initiales.plus")?.textContent;
        const total = z.querySelectorAll(".ligne-boite").length;
        champ.value = "b3@"; champ.dispatchEvent(new Event("input"));
        const filtre = [...z.querySelectorAll(".ligne-boite .quoi b")].map((b) => b.textContent);
        const premier = (champ.value = "", champ.dispatchEvent(new Event("input")), z.querySelector(".ligne-boite .quoi b").textContent);
        z.remove();
        return { champ: !!champ, plus, total, filtre, premier };
      });
      assert.deepEqual(r, { champ: true, plus: "+3", total: 10, filtre: ["Boîte G"], premier: "Boîte A" }, "recherche, tri et « +n »");
      if (erreurs.length) problemes.push(`boîtes démo ${taille} : erreurs console ${erreurs.join(" | ")}`);
      await contexte.close();
    }
    {
      const { contexte, page, erreurs, journal } = await nouvellePage(vp, "admin");
      await page.goto(BASE + "#/organisation");
      await page.waitForSelector(".pastille-demo.reel");
      await page.waitForSelector('.liste-boites .ligne-boite[data-boite="contact@breteuil.fr"]');
      assert.ok(await page.isVisible('.ligne-boite[data-boite="contact@breteuil.fr"] .qui-boite.inconnu'), "vraies données : accès non fournis par Microsoft");
      await page.click('[data-epingler="contact@breteuil.fr"]');
      assert.deepEqual((await page.evaluate(() => window.EBEpingles.lire())).map((e) => e.url), ["https://outlook.office.com/mail/contact%40breteuil.fr/"], "Épingler");
      assert.match(await page.textContent('[data-epingler="contact@breteuil.fr"]'), /Épinglée/);
      await controlesCommuns(page, `boîtes réelles ${taille}`);
      await capturer(page, `boites-liste-reel-${taille}`);
      assert.ok(!journal.some((x) => /mail|messages|sendMail/i.test(x.chemin)), "aucun appel de messagerie");
      if (erreurs.length) problemes.push(`boîtes réelles ${taille} : erreurs console ${erreurs.join(" | ")}`);
      await contexte.close();
    }

    /* ---------- Palette « Bleu Breteuil » (375 px) : clair et sombre ---------- */
    for (const theme of taille === "375" ? ["light", "dark"] : []) {
      const nomT = theme === "light" ? "clair" : "sombre", entete = theme === "light" ? "#14213D" : "#0F1A33";
      const verifier = async (page, ou) => {
        const v = await page.evaluate(() => ({ palette: document.documentElement.getAttribute("data-palette"),
          meta: document.querySelector('meta[name="theme-color"]').content, entete: getComputedStyle(document.documentElement).getPropertyValue("--entete").trim() }));
        assert.deepEqual(v, { palette: "bleu", meta: entete, entete }, `bleu ${nomT} : ${ou}`);
      };
      {
        const { contexte, page, erreurs } = await nouvellePage(vp, null, { theme });
        await page.addInitScript(() => localStorage.setItem("eb:reglages", JSON.stringify({ palette: "bleu" })));
        await page.goto(BASE);
        await page.waitForSelector(".gros-bouton");
        await verifier(page, "premier écran");
        await controlesCommuns(page, `bleu premier ${nomT}`);
        await capturer(page, `bleu-premier-${nomT}-375`);
        if (erreurs.length) problemes.push(`bleu premier ${nomT} : erreurs console ${erreurs.join(" | ")}`);
        await contexte.close();
      }
      {
        const { contexte, page, erreurs } = await nouvellePage(vp, "collaborateur", { theme });
        await page.goto(BASE + "#/reglages");
        await page.waitForSelector('.reglage button:has-text("Bleu Breteuil")');
        assert.equal(await page.getAttribute('.reglage button:has-text("Crème et praline")', "aria-pressed"), "true", "crème par défaut");
        await page.click('.reglage button:has-text("Bleu Breteuil")');
        await verifier(page, "réglage");
        assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem("eb:reglages"))).palette, "bleu", "mémorisé sur l'appareil");
        await capturer(page, `bleu-reglages-${nomT}-375`);
        await page.goto(BASE + "#/planning");
        await page.reload();
        await page.waitForSelector(".pastille-etat.vert", { timeout: 8000 });
        await verifier(page, "après rechargement");
        await controlesCommuns(page, `bleu planning ${nomT}`);
        await capturer(page, `bleu-planning-${nomT}-375`);
        await page.click('#onglets a[data-onglet="moi"]');
        await page.waitForFunction(() => location.hash === "#/moi");
        await page.waitForTimeout(150);
        await controlesCommuns(page, `bleu moi ${nomT}`);
        await capturer(page, `bleu-moi-${nomT}-375`);
        if (theme === "light") {
          // Suivi informatique et Moi → Guides (v5.2) en Bleu Breteuil (palette déjà mémorisée ci-dessus).
          const adm = await nouvellePage(vp, "admin", { theme });
          await adm.page.addInitScript(() => localStorage.setItem("eb:reglages", JSON.stringify({ palette: "bleu" })));
          await adm.page.goto(BASE + "#/suivi");
          await adm.page.waitForSelector(".frise-suivi .etape-frise", { timeout: 8000 });
          await verifier(adm.page, "Suivi informatique");
          await controlesCommuns(adm.page, "bleu suivi clair");
          await capturer(adm.page, "bleu-suivi-clair-375");
          await adm.page.goto(BASE + "#/moi/guides");
          await adm.page.waitForSelector(".barre h1");
          await adm.page.waitForTimeout(300);
          await verifier(adm.page, "Moi → Guides");
          await controlesCommuns(adm.page, "bleu guides clair");
          await capturer(adm.page, "bleu-moi-guides-clair-375");
          if (adm.erreurs.length) problemes.push(`bleu suivi : erreurs console ${adm.erreurs.join(" | ")}`);
          await adm.contexte.close();
        }
        // Retour à la palette crème : l'attribut disparaît, la couleur du navigateur revient au praline.
        await page.goto(BASE + "#/reglages");
        await page.click('.reglage button:has-text("Crème et praline")');
        assert.deepEqual(await page.evaluate(() => [document.documentElement.getAttribute("data-palette"), document.querySelector('meta[name="theme-color"]').content]),
          [null, theme === "light" ? "#5B3833" : "#2E1D19"], "retour à la palette crème");
        if (erreurs.length) problemes.push(`bleu ${nomT} : erreurs console ${erreurs.join(" | ")}`);
        await contexte.close();
      }
    }

    /* ---------- Problème réel : dossier commun introuvable ---------- */
    // (voir plus bas)

    {
      const { contexte, page, erreurs } = await nouvellePage(vp, "collaborateur", { variante: "commun-introuvable" });
      await page.goto(BASE + "#/fichiers");
      await page.waitForSelector(".pastille-etat.orange", { timeout: 8000 });
      await page.waitForSelector('.zone-alerte .bandeau.erreur:has-text("Le dossier commun est introuvable")');
      await capturer(page, `probleme-commun-introuvable-${taille}`);
      // Les 404 de la maquette sont voulus ici : seules les autres erreurs comptent.
      const autres = erreurs.filter((e) => !/404/.test(e));
      if (autres.length) problemes.push(`commun introuvable ${taille} : erreurs console ${autres.join(" | ")}`);
      await contexte.close();
    }
  }
  /* ---------- Calendrier « ajuster à l'écran » : la semaine tient en entier ---------- */
  for (const w of [320, 375, 414, 768, 1280]) {
    const { contexte, page, erreurs } = await nouvellePage({ width: w, height: 800 }, null);
    await page.goto(BASE);
    await page.click('[data-action="calendrier"]');
    await page.waitForSelector(".zone-planning.ajuster .semaine .jour-boite");
    const m = await page.evaluate(() => { const j = [...document.querySelectorAll(".semaine .jour-boite")];
      return { lignes: new Set(j.map((x) => Math.round(x.getBoundingClientRect().top))).size, droite: Math.max(...j.map((x) => x.getBoundingClientRect().right)), page: document.documentElement.scrollWidth }; });
    if (m.lignes !== 1 || m.droite > w || m.page > w + 1) problemes.push(`semaine ${w} px : ne tient pas (${JSON.stringify(m)})`);
    await capturer(page, `calendrier-semaine-${w}`);
    await page.click('[data-zoom="plus"]');
    const z = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, interne: document.querySelector(".zone-planning").scrollWidth > document.querySelector(".zone-planning").clientWidth }));
    if (z.page > w + 1) problemes.push(`zoom + ${w} px : la page défile`);
    if (w < 1280 && !z.interne) problemes.push(`zoom + ${w} px : la grille devrait défiler`);
    await page.click('[data-zoom="ajuster"]');
    await page.waitForSelector(".zone-planning.ajuster");
    if (erreurs.length) problemes.push(`calendrier ${w} : erreurs console ${erreurs.join(" | ")}`);
    await contexte.close();
  }
} finally {
  await navigateur.close();
  serveur.kill();
}
if (problemes.length) { console.error("PROBLÈMES :\n- " + problemes.join("\n- ")); process.exit(1); }
console.log(`OK : premier lancement + 5 profils (dont « Site web ») + Suivi informatique et Moi → Guides + vérificateur de liens + Fichiers + épingles + boîtes partagées + problème réel (375 et 1280 px) + Bleu Breteuil clair/sombre (375 px) + semaine à 320/375/414/768/1280 px (${captures} captures).`);
