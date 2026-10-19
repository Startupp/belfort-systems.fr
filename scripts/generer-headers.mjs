// Génère <sortie>/_headers pour Cloudflare Pages (appelé par scripts/build-site.sh).
//
// Pourquoi un générateur plutôt qu'un fichier écrit à la main :
//  - plusieurs pages ont des <script> dans la page (inline). Une CSP stricte les bloque, sauf si
//    on autorise leur empreinte SHA-256. Écrites à la main, ces empreintes seraient fausses à la
//    première retouche d'une page (et la page cesserait de marcher sans bruit). Ici elles sont
//    recalculées à chaque build ;
//  - chaque section (site, admin, factures, HACCP, jeu, espace-breteuil…) a ses propres besoins
//    (Google Fonts, API, Microsoft, caméra…) : SECTIONS ci-dessous.
//
// Règles Cloudflare Pages respectées : 100 règles au plus, 2 000 caractères par ligne ; si deux
// règles posent le même en-tête, les valeurs sont jointes par une virgule (deux CSP = les deux
// s'appliquent). D'où : la CSP et Permissions-Policy ne sont posées que sur des chemins EXACTS
// (une page = une règle), jamais sur /*.
//
// Aucune dépendance : Node.js seul (fs, path, crypto).
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createHash } from "node:crypto";

const SORTIE = process.argv[2] || "_site";

// --- Valeurs lues dans la configuration du site (pas de copie à maintenir) -------------------
function lireConfig() {
  const f = join(SORTIE, "assets", "config.js");
  const txt = existsSync(f) ? readFileSync(f, "utf8") : "";
  const api = (txt.match(/BS_API\s*=\s*["']([^"']*)["']/) || [])[1] || "";
  const contact = (txt.match(/BS_CONTACT_API\s*=\s*["']([^"']*)["']/) || [])[1] || "";
  const turnstile = (txt.match(/BS_TURNSTILE\s*=\s*["']([^"']*)["']/) || [])[1] || "";
  const origine = (u) => { try { return u ? new URL(u).origin : ""; } catch { return ""; } };
  return { origineApi: origine(api), origineContact: origine(contact), turnstile: Boolean(turnstile) };
}
const CFG = lireConfig();
const API = CFG.origineApi ? [CFG.origineApi] : [];
// Worker du formulaire de contact (contact-worker/), distinct de l'API : seule la section « / »
// l'appelle (fetch) et lui soumet le formulaire (form-action, repli sans JavaScript).
const CONTACT = CFG.origineContact ? [CFG.origineContact] : [];
const GOOGLE_FONTS = { style: ["https://fonts.googleapis.com"], font: ["https://fonts.gstatic.com"] };
const TURNSTILE = CFG.turnstile ? { script: ["https://challenges.cloudflare.com"], frame: ["https://challenges.cloudflare.com"] } : {};

// Permissions-Policy : tout fermé par défaut ; une section rouvre ce dont elle a besoin.
const PERMISSIONS_FERMEES = {
  camera: "()", microphone: "()", geolocation: "()", payment: "()", usb: "()", serial: "()",
  bluetooth: "()", hid: "()", midi: "()", magnetometer: "()", gyroscope: "()", accelerometer: "()",
  "display-capture": "()", "browsing-topics": "()", "interest-cohort": "()",
};

// --- Sections : le préfixe le plus long l'emporte ---------------------------------------------
// script/style/connect/img/font/frame/media : sources ajoutées à 'self' ; formAction : à 'self'
// dans form-action.
const SECTIONS = {
  "/": {
    nom: "Site vitrine (accueil, qui-suis-je, 404)",
    script: [...(TURNSTILE.script || [])], frame: [...(TURNSTILE.frame || [])],
    connect: [...API, ...CONTACT], formAction: [...CONTACT],
  },
  "/admin/": {
    nom: "Tableau de bord (panneau admin, données via l'API)",
    connect: [...API], style: GOOGLE_FONTS.style, font: GOOGLE_FONTS.font,
    robots: true,
  },
  "/portail/": { nom: "Portail client (connexion)", style: GOOGLE_FONTS.style, font: GOOGLE_FONTS.font, robots: true },
  // Coffres chiffrés : après le mot de passe, la page déchiffre un document HTML et l'injecte
  // (document.write / DOMParser) avec SES PROPRES scripts, dont on ne peut pas connaître les
  // empreintes au build (contenu chiffré). Exception assumée : 'unsafe-inline' pour les scripts,
  // images https. Raison de plus pour retirer ces pages du site (docs/INVENTAIRE-PUBLIC.md).
  "/factures/": { nom: "Factures (coffre chiffré)", style: GOOGLE_FONTS.style, font: GOOGLE_FONTS.font, inlineLibre: true, img: ["https:"], robots: true },
  "/clients/": { nom: "Espaces clients (coffres chiffrés)", style: GOOGLE_FONTS.style, font: GOOGLE_FONTS.font, connect: [...API], inlineLibre: true, img: ["https:"], robots: true },
  "/haccp/": {
    nom: "Achille HACCP (PWA hors ligne, scan de codes-barres)",
    style: GOOGLE_FONTS.style, font: GOOGLE_FONTS.font, media: ["blob:"],
    permissions: { camera: "(self)" }, robots: true,
  },
  "/ecorce/": { nom: "TinKnight a déménagé (page de renvoi)" },
  "/ecorce/ancienne/concepts/": {
    // Planche de concepts : vignettes hébergées chez Higgsfield (CloudFront), polices Google.
    nom: "TinKnight, planche de concepts",
    img: ["https://d8j0ntlcm91z4.cloudfront.net"], style: GOOGLE_FONTS.style, font: GOOGLE_FONTS.font,
  },
  "/ecorce/ancienne/": {
    nom: "TinKnight, ancienne version (jeu 3D, sauvegardes, multijoueur PeerJS)",
    script: ["https://cdn.jsdelivr.net"],
    connect: ["https://jeu-sauvegarde.damien-belfort.workers.dev", "https://0.peerjs.com", "wss://0.peerjs.com", "https://cdn.jsdelivr.net"],
    media: ["blob:", "data:"],
    permissions: { gyroscope: "(self)", accelerometer: "(self)", magnetometer: "(self)" },
  },
  "/espace-breteuil/": {
    // Reprend espace-breteuil/_headers (ignoré ici car hors racine), en attendant que l'appli
    // ne soit plus servie que par son propre projet Pages.
    nom: "Espace Breteuil (appli Microsoft 365 du client)",
    connect: [...API, "https://graph.microsoft.com", "https://login.microsoftonline.com", "https://*.sharepoint.com"],
    frame: ["https://login.microsoftonline.com"],
    coop: "same-origin-allow-popups", robots: true,
  },
};

function section(chemin) {
  let meilleur = "/";
  for (const p of Object.keys(SECTIONS)) if (chemin.startsWith(p) && p.length > meilleur.length) meilleur = p;
  return SECTIONS[meilleur];
}

// --- Empreintes des scripts et gestionnaires inline -------------------------------------------
const sha = (s) => "'sha256-" + createHash("sha256").update(s, "utf8").digest("base64") + "'";
const decoder = (s) => s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function empreintes(brut) {
  // Le navigateur normalise les fins de ligne (CRLF et CR → LF) avant de calculer l'empreinte.
  const html = brut.replace(/\r\n?/g, "\n");
  const scripts = new Set();
  const gestionnaires = new Set();
  // Scripts inline exécutables (on ignore src=… et les blocs de données JSON-LD / JSON).
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (type && !/^(text\/javascript|module|application\/javascript)$/i.test(type)) continue;
    scripts.add(sha(m[2]));
  }
  // Gestionnaires d'évènements dans le HTML (onclick="…", onerror="…").
  const reAttr = /\son[a-z]+\s*=\s*("([^"]*)"|'([^']*)')/gi;
  const sansScripts = html.replace(re, "");
  while ((m = reAttr.exec(sansScripts))) gestionnaires.add(sha(decoder(m[2] ?? m[3])));
  return { scripts: [...scripts], gestionnaires: [...gestionnaires] };
}

function csp(sec, emp) {
  const s = (base, extra = []) => [...base, ...extra].join(" ");
  // Avec une empreinte présente, le navigateur ignore 'unsafe-inline' : on n'en met donc pas
  // dans les sections « inlineLibre ».
  const script = sec.inlineLibre ? ["'self'", "'unsafe-inline'", ...(sec.script || [])] : ["'self'", ...emp.scripts, ...(sec.script || [])];
  if (!sec.inlineLibre && emp.gestionnaires.length) script.push("'unsafe-hashes'", ...emp.gestionnaires);
  const d = [
    "default-src 'self'",
    "script-src " + script.join(" "),
    // 'unsafe-inline' pour les styles seulement : beaucoup de style="…" et de <style> dans les
    // pages ; le risque (injection de CSS) est faible face aux scripts, qui restent verrouillés.
    "style-src " + s(["'self'", "'unsafe-inline'"], sec.style),
    "img-src " + s(["'self'", "data:", "blob:"], sec.img),
    "font-src " + s(["'self'", "data:"], sec.font),
    "connect-src " + s(["'self'"], sec.connect),
    "media-src " + s(["'self'"], sec.media),
    "frame-src " + (sec.frame && sec.frame.length ? sec.frame.join(" ") : "'none'"),
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action " + s(["'self'"], sec.formAction),
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ];
  return d.join("; ");
}

function permissions(sec) {
  const p = { ...PERMISSIONS_FERMEES, ...(sec.permissions || {}) };
  return Object.entries(p).map(([k, v]) => `${k}=${v}`).join(", ");
}

// --- Parcours des pages HTML ------------------------------------------------------------------
function pagesHtml(dir) {
  const out = [];
  for (const nom of readdirSync(dir)) {
    const p = join(dir, nom);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...pagesHtml(p));
    else if (nom.endsWith(".html")) out.push(p);
  }
  return out;
}

const regles = [];
const ajouter = (motif, lignes) => regles.push({ motif, lignes });

// Partout : en-têtes sans risque de casse.
ajouter("/*", [
  "Strict-Transport-Security: max-age=31536000; includeSubDomains",
  "X-Content-Type-Options: nosniff",
  "Referrer-Policy: strict-origin-when-cross-origin",
  "X-Frame-Options: DENY",
  "Cross-Origin-Resource-Policy: same-site",
]);

// Une règle par page (chemin exact) : CSP, Permissions-Policy, COOP.
const fichiers = pagesHtml(SORTIE).sort();
for (const f of fichiers) {
  const rel = "/" + relative(SORTIE, f).split(sep).join("/");
  const html = readFileSync(f, "utf8");
  const chemins = [];
  if (rel === "/404.html") chemins.push("/404.html");
  else if (rel.endsWith("/index.html")) chemins.push(rel.slice(0, -"index.html".length), rel);
  else chemins.push(rel.slice(0, -".html".length), rel);
  const sec = section(chemins[0]);
  const lignes = [
    "Content-Security-Policy: " + csp(sec, empreintes(html)),
    "Permissions-Policy: " + permissions(sec),
    "Cross-Origin-Opener-Policy: " + (sec.coop || "same-origin"),
  ];
  for (const c of chemins) ajouter(c, lignes);
}

// Sections privées : jamais indexées (X-Robots-Tag se cumule sans problème).
for (const [p, sec] of Object.entries(SECTIONS)) if (sec.robots) ajouter(p + "*", ["X-Robots-Tag: noindex, nofollow"]);

// Fichiers à toujours redemander (services workers, versions, configuration).
const sansCache = [];
(function chercher(dir) {
  for (const nom of readdirSync(dir)) {
    const p = join(dir, nom);
    if (statSync(p).isDirectory()) { chercher(p); continue; }
    if (["sw.js", "version.js", "config.js", "maj.json", "manifest.webmanifest"].includes(nom)) sansCache.push("/" + relative(SORTIE, p).split(sep).join("/"));
  }
})(SORTIE);
for (const c of sansCache.sort()) ajouter(c, ["Cache-Control: " + (c.endsWith("maj.json") ? "no-store" : "no-cache")]);

// Polices : longues durées (fichiers versionnés par nom).
ajouter("/assets/fonts/*", ["Cache-Control: public, max-age=31536000, immutable"]);

// Adresses d'essai *.pages.dev : jamais indexées (évite le contenu en double avec belfort-systems.fr).
ajouter("https://:project.pages.dev/*", ["X-Robots-Tag: noindex"]);
ajouter("https://:version.:project.pages.dev/*", ["X-Robots-Tag: noindex"]);

// --- Contrôles et écriture --------------------------------------------------------------------
if (regles.length > 100) { console.error(`ERREUR : ${regles.length} règles dans _headers (limite Cloudflare : 100).`); process.exit(1); }
let texte = "# Généré par scripts/generer-headers.mjs à chaque build : NE PAS MODIFIER À LA MAIN.\n" +
  "# Sections et sources autorisées : SECTIONS dans scripts/generer-headers.mjs.\n";
for (const r of regles) {
  texte += "\n" + r.motif + "\n";
  for (const l of r.lignes) {
    if (l.length + 2 > 2000) { console.error(`ERREUR : ligne de plus de 2 000 caractères pour ${r.motif}.`); process.exit(1); }
    texte += "  " + l + "\n";
  }
}
writeFileSync(join(SORTIE, "_headers"), texte);
console.log(`_headers : ${regles.length} règles, ${fichiers.length} pages avec CSP.`);
