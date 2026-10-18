// Vérification de la v4 : premier lancement (2 boutons) et 4 profils maquettés selon les DROITS RÉELS.
// Lancer depuis la racine du dépôt (Chromium déjà installé, ne pas lancer « playwright install ») :
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=$(npm root -g) node espace-breteuil/tests/v4.playwright.mjs [dossier-captures]
// Contrôles à 375 px et 1280 px :
//   - premier lancement : 2 gros boutons seulement (ni onglets, ni démo, ni tuiles) ; « Voir le calendrier »
//     mémorisé sur l'appareil, petit lien « Revenir à l'accueil » ;
//   - administrateur général, propriétaire du site, facturation, simple collaborateur : UNIQUEMENT les
//     onglets attendus (4 au plus), routes réservées refusées, pastille verte ;
//   - « Déléguer » : permission demandée seulement sur cet écran, garde-fous, POST roleAssignments ;
//   - dossier commun introuvable : pastille orange et message dans Dossiers ;
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
const PORT = 8768;
const BASE = `http://localhost:${PORT}/?maquette=1`;
if (SORTIE) mkdirSync(SORTIE, { recursive: true });
const ICS = readFileSync(RACINE + "exemple.ics", "utf8");
const ICS2 = readFileSync(RACINE + "exemple-accueil.ics", "utf8");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

const GA = "62e90394-69f5-4237-9190-012177145e10", BILLING = "b0f54661-2d74-4c50-afa3-1ec803f12efe";
const u = (id, nom, mail, lic, type = "Member") => ({ id, displayName: nom, givenName: nom.split(" ")[0], mail, userPrincipalName: mail, userType: type, accountEnabled: true, assignedLicenses: lic ? [{ skuId: lic }] : [] });
const USERS = [u("u1", "Pauline de Breteuil", "pdebreteuil@breteuil.fr", "a"), u("u2", "François de Breteuil", "fdebreteuil@breteuil.fr", "a"),
  u("u3", "Valérie Durand", "vdurand@breteuil.fr", "a"), u("u4", "Fanny Martin", "fmartin@breteuil.fr", "b"), u("u5", "Contact", "contact@breteuil.fr", null),
  u("u6", "Damien Belfort", "damien@breteuil02.onmicrosoft.com", null)];
const SP = { u1: 7, u2: 8, u3: 9, u4: 10, u6: 11 };
const PROPRIETAIRES = [{ Id: 7, Title: "Pauline de Breteuil", Email: "pdebreteuil@breteuil.fr", LoginName: "i:0#.f|membership|pdebreteuil@breteuil.fr", PrincipalType: 1 },
  { Id: 8, Title: "François de Breteuil", Email: "fdebreteuil@breteuil.fr", LoginName: "i:0#.f|membership|fdebreteuil@breteuil.fr", PrincipalType: 1 }];
const AVEC_GERER = { High: "432", Low: String(2 ** 24 + 0xFFFF) }, SANS_GERER = { High: "176", Low: "138612833" };

const PROFILS = {
  admin: { user: "u2", roles: [{ id: "r1", displayName: "Global Administrator", roleTemplateId: GA }], lic: ["O365_BUSINESS_PREMIUM"],
    attendus: ["planning", "fichiers", "gerer", "moi"], interdits: [], autorises: ["deleguer", "personnes", "licences-reel"] },
  proprietaire: { user: "u1", roles: [], lic: ["O365_BUSINESS_PREMIUM"],
    attendus: ["planning", "fichiers", "equipe", "moi"], interdits: ["deleguer", "finance", "gerer"], autorises: ["personnes", "acces/Commun"] },
  facturation: { user: "u3", roles: [{ id: "r2", displayName: "Billing Administrator", roleTemplateId: BILLING }], lic: ["O365_BUSINESS_PREMIUM"],
    attendus: ["planning", "fichiers", "finance", "moi"], interdits: ["deleguer", "personnes", "acces/Commun", "gerer"], autorises: ["licences-reel"] },
  collaborateur: { user: "u4", roles: [], lic: ["O365_BUSINESS_ESSENTIALS"],
    attendus: ["planning", "fichiers", "moi"], interdits: ["deleguer", "personnes", "finance", "gerer", "equipe", "acces/Commun", "absences"], autorises: [] },
};

function reponses(nomProfil, variante) {
  const p = PROFILS[nomProfil], moi = USERS.find((x) => x.id === p.user);
  const proprietaire = PROPRIETAIRES.some((x) => x.Id === SP[p.user]);
  const r = {
    "/v1.0/me": moi,
    "/v1.0/me/transitiveMemberOf/microsoft.graph.directoryRole": { value: p.roles },
    "/v1.0/me/licenseDetails": { value: p.lic.map((s) => ({ skuPartNumber: s })) },
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
  await contexte.route("https://belfort-api.damien-belfort.workers.dev/**", (r) => r.fulfill({ status: 200,
    headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "text/calendar" }, body: /\/2\.ics/.test(r.request().url()) ? ICS2 : ICS }));
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
  await page.waitForTimeout(250);
  // v5 : attendre la fin des apparitions (animations finies seulement ; les boucles infinies et le défilement sont ignorés).
  await page.evaluate(() => Promise.race([new Promise((ok) => setTimeout(ok, 2000)), Promise.all(document.getAnimations()
    .filter((a) => a.timeline === document.timeline && isFinite(a.effect.getComputedTiming().endTime)).map((a) => a.finished.catch(() => {})))]));
  await page.screenshot({ path: `${SORTIE}/${nom}.png`, fullPage: true });
  captures++;
}
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

    /* ---------- 4 profils ---------- */
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
      if (nom === "admin") {
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
        for (const route of ["gerer", "personnes", "personnes/u4", "organisation", "licences-reel", "guides/admin", "guides/finance", "commun", "commun/Commun/Finance", "acces/Commun",
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
console.log(`OK : premier lancement + 4 profils + Fichiers + épingles + problème réel (375 et 1280 px) + semaine à 320/375/414/768/1280 px (${captures} captures).`);
