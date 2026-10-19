// belfort-api (version minimale) — relais des calendriers de l'Espace Breteuil
// et vérificateur des liens du bas de page de www.breteuil.fr.
// Aucun secret ici : les adresses ICS sont des SECRETS du Worker
// (BRETEUIL_ICS_URL, BRETEUIL_ICS_URL_2 … _4), posés dans le tableau de bord Cloudflare.
// Routes : GET /breteuil/planning.ics, /breteuil/planning/2.ics … /4.ics, GET /breteuil/site/liens[?forcer=1],
//          « Aide / demandes » (v5.4) : /breteuil/aide… (voir plus bas) + mails entrants (export email,
//          règle Email Routing « demande@<domaine de AIDE_EXPEDITEUR> » → Worker, sous-adressage « + » activé).
// Tests : node api-planning/worker.test.mjs
// Aide : liaisons AIDE_DB (D1) et AIDE_MAIL (envoi d'e-mails), variables AIDE_TENANT_ID, AIDE_CLIENT_ID,
// AIDE_EXPEDITEUR, AIDE_DESTINATAIRE, AIDE_PRESTATAIRES, secret AIDE_SECRET — voir docs/AIDE-INSTALLATION.md.
import { EmailMessage } from "cloudflare:email";
const ORIGINES = ["https://espace-breteuil.pages.dev", "https://belfort-systems.fr", "https://breteuil.belfort-systems.fr"];
const TTL_S = 600; // fraîcheur : 10 min
const MAX_OCTETS = 5 * 1024 * 1024;

function cors(origine) {
  return {
    "Access-Control-Allow-Origin": origine,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    "Access-Control-Expose-Headers": "X-Planning-Etat, X-Planning-Date, Content-Disposition",
    "Vary": "Origin",
  };
}
function json(obj, status, origine) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors(origine) } });
}
function urlSource(env, n) {
  const brute = String(env[n === 1 ? "BRETEUIL_ICS_URL" : "BRETEUIL_ICS_URL_" + n] || "").trim();
  if (!brute) return null;
  try {
    const u = new URL(brute.replace(/^webcals?:\/\//i, "https://"));
    return u.protocol === "https:" ? u.toString() : null;
  } catch { return null; }
}
function ics(texte, etat, quand, origine) {
  return new Response(texte, { status: 200, headers: {
    "Content-Type": "text/calendar; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Planning-Etat": etat,
    "X-Planning-Date": new Date(quand).toISOString(),
    ...cors(origine),
  } });
}

/* ------------------------------------------------------------------ */
/* Vérificateur des liens du bas de page de www.breteuil.fr            */
/* ------------------------------------------------------------------ */
// Seules ces pages sont lues (adresses fixes : le Worker n'est pas un relais ouvert).
const SITE_PAGES = [{ page: "fr", url: "https://www.breteuil.fr/" }, { page: "en", url: "https://www.breteuil.fr/en/" }];
const LIENS_MAX = 40;          // liens vérifiés au plus (1 sous-requête chacun + GET de secours si le budget le permet)
const SOUS_REQUETES = 48;      // Cloudflare gratuit : 50 sous-requêtes par appel (marge de 2)
const LIENS_TTL_S = 3600;      // résultat gardé 1 h
const FORCER_MIN_S = 60;       // « Revérifier » : pas plus d'une vraie vérification par minute
const DELAI_MS = 8000;
const EN_PARALLELE = 6;
const UA = "Mozilla/5.0 (compatible; belfort-api/1.0; verificateur de liens de l'Espace Breteuil)";
let memoire = null;            // copie en mémoire (si caches.default est inactif, ex. *.workers.dev)

// Entités HTML nommées courantes (français, typographie, symboles). Sensibles à la casse (&Eacute; ≠ &eacute;).
const ENTITES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", thinsp: "\u2009", ensp: "\u2002", emsp: "\u2003", shy: "",
  rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201d", ldquo: "\u201c", sbquo: "\u201a", bdquo: "\u201e", laquo: "\u00ab", raquo: "\u00bb",
  lsaquo: "\u2039", rsaquo: "\u203a", hellip: "\u2026", ndash: "\u2013", mdash: "\u2014", bull: "\u2022", middot: "\u00b7", prime: "\u2032",
  agrave: "à", aacute: "á", acirc: "â", atilde: "ã", auml: "ä", aring: "å", aelig: "æ", ccedil: "ç",
  egrave: "è", eacute: "é", ecirc: "ê", euml: "ë", igrave: "ì", iacute: "í", icirc: "î", iuml: "ï",
  ntilde: "ñ", ograve: "ò", oacute: "ó", ocirc: "ô", otilde: "õ", ouml: "ö", oslash: "ø", oelig: "œ",
  ugrave: "ù", uacute: "ú", ucirc: "û", uuml: "ü", yacute: "ý", yuml: "ÿ", szlig: "ß",
  Agrave: "À", Aacute: "Á", Acirc: "Â", Atilde: "Ã", Auml: "Ä", Aring: "Å", AElig: "Æ", Ccedil: "Ç",
  Egrave: "È", Eacute: "É", Ecirc: "Ê", Euml: "Ë", Igrave: "Ì", Iacute: "Í", Icirc: "Î", Iuml: "Ï",
  Ntilde: "Ñ", Ograve: "Ò", Oacute: "Ó", Ocirc: "Ô", Otilde: "Õ", Ouml: "Ö", Oslash: "Ø", OElig: "Œ",
  Ugrave: "Ù", Uacute: "Ú", Ucirc: "Û", Uuml: "Ü", Yacute: "Ý", Yuml: "Ÿ",
  euro: "€", pound: "£", cent: "¢", yen: "¥", deg: "°", copy: "©", reg: "®", trade: "™", sect: "§", para: "¶",
  times: "×", divide: "÷", plusmn: "±", frac12: "½", frac14: "¼", frac34: "¾", sup2: "²", sup3: "³", ordf: "ª", ordm: "º",
  iexcl: "¡", iquest: "¿", dagger: "†", larr: "←", rarr: "→", uarr: "↑", darr: "↓", hearts: "♥", check: "✓",
};
/** Décode les entités HTML (nommées, &#233; et &#xE9;). Texte brut en sortie, jamais de HTML interprété. */
export function decoder(t) {
  return String(t || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    const v = Object.hasOwn(ENTITES, e) ? ENTITES[e] : Object.hasOwn(ENTITES, e.toLowerCase()) ? ENTITES[e.toLowerCase()] : null;
    return v ?? m;
  });
}
function attribut(balise, nom) {
  const m = new RegExp("\\s" + nom + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i").exec(balise);
  return m ? decoder(m[2] ?? m[3] ?? m[4] ?? "") : "";
}
/** Partie « bas de page » du HTML : de la 1re balise <footer> à la dernière </footer>, sinon le dernier tiers. */
export function basDePage(html) {
  const debut = html.search(/<footer[\s>]/i);
  const fin = html.toLowerCase().lastIndexOf("</footer>");
  if (debut > -1 && fin > debut) return html.slice(debut, fin + 9);
  return html.slice(Math.floor(html.length * 2 / 3));
}
/** Liens <a href> d'un morceau de HTML : [{ texte, url }] (http(s) seulement, adresses absolues). */
export function extraireLiens(fragment, base) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let m;
  while ((m = re.exec(fragment))) {
    const href = attribut(m[1], "href").trim();
    if (!href || href[0] === "#") continue;
    let u;
    try { u = new URL(href, base); } catch { continue; }
    if (u.protocol !== "https:" && u.protocol !== "http:") continue;
    u.hash = "";
    let texte = decoder(m[2].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
    if (!texte) texte = attribut(m[1], "aria-label") || attribut(m[1], "title") || attribut(m[2].match(/<img\b[^>]*>/i)?.[0] || "", "alt") || u.hostname.replace(/^www\./, "");
    out.push({ texte: texte.slice(0, 120), url: u.toString() });
  }
  return out;
}
function normaliser(u) { return String(u || "").replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "").toLowerCase(); }

// En-têtes d'un vrai navigateur pour les vérifications : certains WordPress (WP Rocket, Cloudflare)
// répondent 403/404 aux robots ou aux requêtes HEAD alors que la page existe.
const NAVIGATEUR = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
};
const HOTE_SITE = new URL(SITE_PAGES[0].url).hostname;
/** HEAD à refaire en GET avant de conclure (ordre = priorité quand le budget manque). */
function prioriteGet(statut) {
  if (statut === 404 || statut === 410) return 0;      // « cassé » à confirmer en premier
  if (statut === 403 || statut === 405 || statut === 429) return 1;
  if (statut != null && statut >= 500) return 2;
  return -1;
}
async function essai(url, methode) {
  let r = null, statut = null;
  try {
    r = await fetch(url, { method: methode, redirect: "follow", headers: NAVIGATEUR, signal: AbortSignal.timeout(DELAI_MS) });
    statut = r.status;
  } catch (e) { r = null; statut = null; }
  try { if (r && r.body) await r.body.cancel(); } catch {}
  return { statut, finale: r && r.url ? r.url : url, methode };
}
function resultat(lien, e) {
  const redirigeVers = e.statut != null && normaliser(e.finale) !== normaliser(lien.url) ? e.finale : null;
  return { ...lien, statut: e.statut, ok: e.statut != null && e.statut >= 200 && e.statut < 400, redirigeVers, methode: e.methode };
}
async function enParallele(n, taches) {
  let i = 0;
  const travail = async () => { while (i < taches.length) { const k = i++; await taches[k](); } };
  await Promise.all(Array.from({ length: Math.min(n, taches.length) }, travail));
}

export async function verifierLiens(maintenant = Date.now()) {
  const budget = { reste: SOUS_REQUETES };
  const vus = new Set(), liens = [], pages = [];
  for (const p of SITE_PAGES) {
    let html = null;
    try {
      budget.reste--;
      const r = await fetch(p.url, { headers: { "User-Agent": UA, "Accept": "text/html" }, redirect: "follow", signal: AbortSignal.timeout(DELAI_MS) });
      if (r.ok && /html/i.test(r.headers.get("Content-Type") || "text/html")) html = (await r.text()).slice(0, MAX_OCTETS);
      else if (r.body) await r.body.cancel();
    } catch (e) { html = null; }
    pages.push({ page: p.page, lue: html != null });
    if (html == null) continue;
    for (const l of extraireLiens(basDePage(html), p.url)) {
      if (vus.has(l.url) || liens.length >= LIENS_MAX) continue;
      vus.add(l.url);
      liens.push({ texte: l.texte, url: l.url, page: p.page });
    }
  }
  if (!pages[0].lue) throw Object.assign(new Error("www.breteuil.fr ne répond pas"), { code: "site_indisponible" });
  // 1re passe (une sous-requête par lien) : GET direct pour les pages de www.breteuil.fr (WordPress
  // répond parfois 404 à un HEAD), HEAD pour les autres sites.
  liens.splice(Math.max(0, budget.reste));
  budget.reste -= liens.length;
  const resultats = new Array(liens.length);
  await enParallele(EN_PARALLELE, liens.map((l, k) => async () => {
    resultats[k] = resultat(l, await essai(l.url, new URL(l.url).hostname === HOTE_SITE ? "GET" : "HEAD"));
  }));
  // 2e passe : HEAD 404/410/403/405/429/5xx → refait en GET avant de conclure, dans la limite du budget
  // (les « cassés » d'abord). Un lien non revérifié garde methode « HEAD » : l'appli ne le dit pas cassé.
  const aRefaire = resultats.map((x, k) => ({ k, p: x.methode === "HEAD" ? prioriteGet(x.statut) : -1 }))
    .filter((x) => x.p >= 0).sort((a, b) => a.p - b.p || a.k - b.k).slice(0, Math.max(0, budget.reste));
  budget.reste -= aRefaire.length;
  await enParallele(EN_PARALLELE, aRefaire.map(({ k }) => async () => { resultats[k] = resultat(liens[k], await essai(liens[k].url, "GET")); }));
  return { verifieLe: new Date(maintenant).toISOString(), pages, liens: resultats };
}

async function routeLiens(url, origine) {
  const cle = new Request("https://cache.interne/site/liens");
  const cache = caches.default;
  const forcer = url.searchParams.get("forcer") === "1";
  let copie = memoire;
  try {
    const c = await cache.match(cle);
    if (c) { const j = await c.json(); if (!copie || j.quand > copie.quand) copie = j; }
  } catch {}
  const age = copie ? (Date.now() - copie.quand) / 1000 : Infinity;
  if (copie && (age < (forcer ? FORCER_MIN_S : LIENS_TTL_S))) return json({ ...copie.donnees, depuisCache: true }, 200, origine);
  try {
    const donnees = await verifierLiens();
    const quand = Date.now();
    memoire = { quand, donnees };
    try { await cache.put(cle, new Response(JSON.stringify(memoire), { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=" + LIENS_TTL_S } })); } catch {}
    return json(donnees, 200, origine);
  } catch (e) {
    console.error("Liens du site :", e && e.message);
    if (copie) return json({ ...copie.donnees, depuisCache: true, ancien: true }, 200, origine);
    return json({ ok: false, code: (e && e.code) || "erreur", erreur: "Le site www.breteuil.fr ne répond pas pour le moment." }, 502, origine);
  }
}

/* ------------------------------------------------------------------ */
/* Aide / demandes (v5.4) : tickets de l'Espace Breteuil               */
/* ------------------------------------------------------------------ */
// Le client (salarié du Château, connecté avec Microsoft) envoie une demande depuis l'appli ;
// Damien (« prestataire ») reçoit un mail et répond en répondant au mail ou dans l'appli.
// Rien de secret ici : tout est dans les variables / secrets du Worker.
const AIDE_TYPES = { question: "Question", avis: "Avis", amelioration: "Amélioration", probleme: "Problème" };
const AIDE_STATUTS = ["nouvelle", "repondue", "resolue"];
const AIDE_MAX = 4000;               // caractères par message
const AIDE_LIMITE_HEURE = 10;        // demandes par heure et par personne
const AIDE_MESSAGES_HEURE = 40;      // messages par heure et par personne (garde-fou)
const AIDE_TOLERANCE_S = 300;        // horloges : 5 min de tolérance (exp / nbf)
const AIDE_CLES_TTL_MS = 6 * 3600 * 1000;
const AIDE_RAW_MAX = 25 * 1024 * 1024; // mail entrant : 25 Mo au plus (limite d'Email Routing ; pièces jointes comprises)
let aideTablesPretes = null;          // base partagée par isolat : tables créées une fois
let aideCles = null;                  // { tenant, quand, issuer, cles: Map(kid → CryptoKey) }

function aideConfiguree(env) {
  return !!(env && env.AIDE_DB && env.AIDE_MAIL && env.AIDE_TENANT_ID && env.AIDE_CLIENT_ID && env.AIDE_SECRET && env.AIDE_EXPEDITEUR && env.AIDE_DESTINATAIRE);
}
export function listeAdresses(v) { return String(v || "").split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean); }
function estPrestataire(env, adresse) { return !!adresse && listeAdresses(env.AIDE_PRESTATAIRES).includes(String(adresse).toLowerCase()); }

/** Texte brut sûr : caractères de contrôle retirés (sauf saut de ligne et tabulation), fins de ligne unifiées. */
export function texteBrut(t, max) {
  let s = String(t == null ? "" : t).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, "");
  s = s.replace(/[ \t]+$/gm, "").replace(/\n{4,}/g, "\n\n\n").trim();
  return max ? s.slice(0, max) : s;
}
const ligneCourte = (t, max) => texteBrut(t).replace(/\s+/g, " ").slice(0, max);

/* ---------- Jeton d'identité Microsoft (RS256, clés JWKS du tenant) ---------- */
function b64uOctets(s) {
  const b = atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4));
  const o = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i);
  return o;
}
const b64uJson = (s) => JSON.parse(new TextDecoder().decode(b64uOctets(s)));
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function clesTenant(env, forcer) {
  const tenant = String(env.AIDE_TENANT_ID).trim();
  if (!forcer && aideCles && aideCles.tenant === tenant && Date.now() - aideCles.quand < AIDE_CLES_TTL_MS) return aideCles;
  if (forcer && aideCles && aideCles.tenant === tenant && Date.now() - aideCles.quand < 60000) return aideCles; // pas plus d'un rechargement par minute
  const base = "https://login.microsoftonline.com/" + encodeURIComponent(tenant);
  let issuer;
  if (GUID.test(tenant)) issuer = "https://login.microsoftonline.com/" + tenant.toLowerCase() + "/v2.0";
  else {
    const r = await fetch(base + "/v2.0/.well-known/openid-configuration", { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error("openid-configuration HTTP " + r.status);
    issuer = (await r.json()).issuer;
  }
  const r = await fetch(base + "/discovery/v2.0/keys", { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("JWKS HTTP " + r.status);
  const cles = new Map();
  for (const k of (await r.json()).keys || []) {
    if (k.kty !== "RSA" || !k.kid || !k.n || !k.e) continue;
    try { cles.set(k.kid, await crypto.subtle.importKey("jwk", { kty: "RSA", n: k.n, e: k.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"])); } catch {}
  }
  aideCles = { tenant, quand: Date.now(), issuer, cles };
  return aideCles;
}

/** Vérifie l'ID token (en-tête Authorization: Bearer) → { oid, nom, adresse } ou null. */
export async function verifierJeton(jeton, env, maintenantS = Date.now() / 1000) {
  const p = String(jeton || "").split(".");
  if (p.length !== 3) return null;
  let entete, charge;
  try { entete = b64uJson(p[0]); charge = b64uJson(p[1]); } catch { return null; }
  if (!entete || entete.alg !== "RS256" || !entete.kid) return null;
  let c = await clesTenant(env, false);
  let cle = c.cles.get(entete.kid);
  if (!cle) { c = await clesTenant(env, true); cle = c.cles.get(entete.kid); } // rotation des clés Microsoft
  if (!cle) return null;
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cle, b64uOctets(p[2]), new TextEncoder().encode(p[0] + "." + p[1]));
  if (!ok) return null;
  if (charge.iss !== c.issuer) return null;
  if (charge.aud !== String(env.AIDE_CLIENT_ID).trim()) return null;
  if (typeof charge.exp !== "number" || charge.exp + AIDE_TOLERANCE_S < maintenantS) return null;
  if (typeof charge.nbf === "number" && charge.nbf - AIDE_TOLERANCE_S > maintenantS) return null;
  const adresse = String(charge.preferred_username || "").trim().toLowerCase();
  if (!charge.oid || !adresse) return null;
  return { oid: String(charge.oid), nom: ligneCourte(charge.name || adresse, 120), adresse: adresse.slice(0, 200) };
}

/* ---------- Base D1 ---------- */
async function tables(db) {
  if (aideTablesPretes && aideTablesPretes.db === db) return;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS demandes(id INTEGER PRIMARY KEY, cree TEXT, oid TEXT, nom TEXT, adresse TEXT, type TEXT, statut TEXT, ecran TEXT, version TEXT, appareil TEXT, lu_par_demandeur INTEGER)"),
    db.prepare("CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, demande_id INTEGER, cree TEXT, auteur TEXT, texte TEXT, origine TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS demandes_oid ON demandes(oid, cree)"),
    db.prepare("CREATE INDEX IF NOT EXISTS messages_demande ON messages(demande_id, id)"),
    db.prepare("CREATE TABLE IF NOT EXISTS pieces_jointes(id INTEGER PRIMARY KEY, demande_id INTEGER, message_id INTEGER, nom TEXT, type TEXT, taille INTEGER, cle TEXT, cree_le TEXT, auteur TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS pj_demande ON pieces_jointes(demande_id, id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS pj_quota ON pieces_jointes(cree_le, auteur)"),
  ]);
  aideTablesPretes = { db };
}
const iso = (ms) => new Date(ms).toISOString();

/* ---------- Mail sortant : petit constructeur MIME (texte UTF-8, en-têtes RFC 2047) ---------- */
function b64(octets) {
  let s = "";
  for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
  return btoa(s);
}
/** En-tête encodé RFC 2047 (=?UTF-8?B?…?=) si non ASCII, découpé en mots de 75 caractères au plus. */
export function enTete(valeur) {
  const v = String(valeur).replace(/[\r\n]+/g, " ");
  if (/^[\x20-\x7e]*$/.test(v)) return v;
  const mots = [];
  let morceau = "";
  for (const car of v) {
    const essai = morceau + car;
    if (new TextEncoder().encode(essai).length > 39) { mots.push(morceau); morceau = car; } else morceau = essai;
  }
  if (morceau) mots.push(morceau);
  return mots.map((m) => "=?UTF-8?B?" + b64(new TextEncoder().encode(m)) + "?=").join("\r\n ");
}
function adresseNommee(nom, adresse) { return nom ? enTete(String(nom).replace(/["\\<>]/g, "")) + " <" + adresse + ">" : "<" + adresse + ">"; }
export function domaineDe(adresse) { return String(adresse || "").split("@")[1]?.trim().toLowerCase() || ""; }

/** Corps encodé en base64 (RFC 2045 : lignes de 76 caractères au plus, fins de ligne CRLF). */
function base64Lignes(texte) { return b64(new TextEncoder().encode(String(texte).replace(/\r?\n/g, "\r\n"))).replace(/.{76}(?=.)/g, "$&\r\n"); }

/**
 * Message MIME complet. Sans `html` : texte brut UTF-8 en base64 (comme avant).
 * Avec `html` : multipart/alternative — texte brut d'abord (secours), puis HTML (base64 tous les deux).
 */
export function construireMime({ de, nomDe, a, repondreA, sujet, texte, html, messageId, references, date }) {
  const borne = html ? "=_eb_" + crypto.randomUUID().replace(/-/g, "") : null; // « =_ » n'apparaît jamais en base64
  const corps = html
    ? "Ce message est au format MIME (texte et HTML).\r\n\r\n" +
      "--" + borne + "\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" + base64Lignes(texte) + "\r\n" +
      "--" + borne + "\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" + base64Lignes(html) + "\r\n" +
      "--" + borne + "--"
    : base64Lignes(texte);
  const l = [
    "From: " + adresseNommee(nomDe, de),
    "To: <" + a + ">",
    repondreA ? "Reply-To: <" + repondreA + ">" : null,
    "Subject: " + enTete(sujet),
    "Date: " + new Date(date || Date.now()).toUTCString().replace("GMT", "+0000"),
    "Message-ID: <" + messageId + ">",
    references ? "References: <" + references + ">" : null,
    references ? "In-Reply-To: <" + references + ">" : null,
    "MIME-Version: 1.0",
    ...(html ? ['Content-Type: multipart/alternative;\r\n boundary="' + borne + '"'] : ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64"]),
  ].filter(Boolean);
  return l.join("\r\n") + "\r\n\r\n" + corps + "\r\n";
}

/* ---------- Mail HTML à Damien (tableaux + styles en ligne : Gmail, Outlook, Apple Mail) ---------- */
/** Échappe TOUT contenu venu d'un utilisateur avant de l'insérer dans le HTML. */
export function echapperHtml(t) {
  return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const AIDE_COULEURS = { // texte / fond de la pastille du type (contraste ≥ 4,5:1)
  question: ["#1F4F7A", "#E2ECF7"], avis: ["#2D6142", "#E1F0E6"], amelioration: ["#7A5410", "#F6EAD0"], probleme: ["#9E2A20", "#F9E1DE"],
};
export function tailleLisible(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + " o";
  if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + " Ko";
  return (Math.round(n / 1024 / 1024 * 10) / 10).toString().replace(".", ",") + " Mo";
}
function dateFr(ms) {
  try { return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ms)); }
  catch { return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC"; }
}

/**
 * Mail HTML d'une demande (nouvelle ou nouveau message). Tout texte utilisateur est échappé.
 * p : { id, type, nom, adresse, ecran, version, appareil, date (ms), texte, premier, lien, pj: [{ nom, taille, lien }], ignorees: [texte] }
 */
export function htmlMail(p) {
  const e = echapperHtml, type = AIDE_TYPES[p.type] || "Demande", [coulT, coulF] = AIDE_COULEURS[p.type] || ["#5B3833", "#F3E9DF"];
  const POL = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
  const SERIF = "font-family:Georgia,'Times New Roman',serif;";
  const titre = p.premier ? "Nouvelle demande" : "Nouveau message sur la demande n°" + p.id;
  const texte = e(p.texte || "").replace(/\r?\n/g, "<br>");
  const extrait = e(ligneCourte(p.texte || "", 110));
  const ligneMeta = (k, v) => `<tr><td class="eb-doux" style="${POL}padding:6px 12px 6px 0;font-size:13px;color:#7A6458;white-space:nowrap;vertical-align:top;">${k}</td>` +
    `<td class="eb-texte" style="${POL}padding:6px 0;font-size:13px;color:#2B1F1B;word-break:break-word;">${e(v || "—")}</td></tr>`;
  const pj = (p.pj || []).map((f) => `<tr><td style="padding:0 0 8px 0;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="eb-carte-pj" style="border:1px solid #E6D9C6;border-radius:8px;background:#FFFFFF;"><tr>` +
    `<td style="${POL}padding:10px 12px;font-size:14px;color:#2B1F1B;word-break:break-all;" class="eb-texte">📎&nbsp;<b>${e(f.nom)}</b> <span class="eb-doux" style="color:#7A6458;font-size:12px;white-space:nowrap;">${e(tailleLisible(f.taille))}</span></td>` +
    `<td align="right" style="${POL}padding:10px 12px;font-size:13px;white-space:nowrap;"><a href="${e(f.lien)}" style="color:#8A6A1F;font-weight:700;text-decoration:underline;">Ouvrir</a></td>` +
    `</tr></table></td></tr>`).join("");
  const ignorees = (p.ignorees || []).map((t) => `<tr><td class="eb-doux" style="${POL}padding:0 0 6px 0;font-size:12px;color:#7A6458;">${e(t)}</td></tr>`).join("");
  return `<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${e(type)} · Demande n°${e(p.id)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .eb-fond { background:#1C1513 !important; }
    .eb-carte, .eb-carte-pj { background:#2A201D !important; border-color:#4A3A33 !important; }
    .eb-citation { background:#231A17 !important; }
    .eb-texte { color:#F3EAE0 !important; }
    .eb-doux { color:#C9B8AA !important; }
  }
  @media (max-width: 480px) { .eb-pad { padding-left:18px !important; padding-right:18px !important; } }
</style>
</head>
<body style="margin:0;padding:0;background:#FBF6EE;" class="eb-fond">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#FBF6EE;">${extrait}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FBF6EE" class="eb-fond" style="background:#FBF6EE;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td bgcolor="#5B3833" style="background:#5B3833;border-radius:12px 12px 0 0;padding:20px 28px;" class="eb-pad">
  <div style="${SERIF}font-size:20px;line-height:1.3;color:#FBF6EE;"><span style="color:#E2BE6E;">Espace Breteuil</span> · Demande n°${e(p.id)}</div>
  <div style="${POL}font-size:13px;line-height:1.4;color:#EADBC8;padding-top:4px;">${e(titre)}</div>
</td></tr>
<tr><td bgcolor="#C9A04A" style="background:#C9A04A;height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
<tr><td bgcolor="#FFFFFF" class="eb-carte eb-pad" style="background:#FFFFFF;border:1px solid #E6D9C6;border-top:0;border-radius:0 0 12px 12px;padding:24px 28px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td bgcolor="${coulF}" style="background:${coulF};border-radius:99px;padding:5px 12px;${POL}font-size:13px;font-weight:700;color:${coulT};">${e(type)}</td>
  </tr></table>
  <div class="eb-texte" style="${POL}font-size:17px;font-weight:700;color:#2B1F1B;padding-top:14px;">${e(p.nom)}</div>
  <div class="eb-doux" style="${POL}font-size:14px;color:#7A6458;padding-top:2px;word-break:break-all;">${e(p.adresse)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;"><tr>
    <td class="eb-citation eb-texte" bgcolor="#FBF6EE" style="background:#FBF6EE;border-left:4px solid #C9A04A;border-radius:0 8px 8px 0;padding:14px 16px;${POL}font-size:15px;line-height:1.55;color:#2B1F1B;word-break:break-word;">${texte || "<i>(pièce jointe seule)</i>"}</td>
  </tr></table>
  ${pj || ignorees ? `<div class="eb-texte" style="${POL}font-size:14px;font-weight:700;color:#2B1F1B;padding:20px 0 8px;">Pièces jointes</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${pj}${ignorees}</table>` : ""}
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;border-top:1px solid #EFE4D4;width:100%;">
    ${ligneMeta("Écran", p.ecran)}${ligneMeta("Version", p.version)}${ligneMeta("Appareil", p.appareil)}${ligneMeta("Date", dateFr(p.date || Date.now()))}
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;"><tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td bgcolor="#5B3833" style="background:#5B3833;border-radius:8px;">
        <a href="${e(p.lien)}" style="display:inline-block;padding:14px 32px;${POL}font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:8px;">Ouvrir la demande</a>
      </td>
    </tr></table>
  </td></tr></table>
</td></tr>
<tr><td class="eb-doux" style="${POL}padding:18px 12px 0;font-size:13px;line-height:1.5;color:#7A6458;text-align:center;">
  Répondez simplement à ce mail : votre réponse s'ajoute à la demande.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/* ---------- Pièces jointes (v5.6) : Workers KV « AIDE_PJ », index dans D1 « pieces_jointes » ---------- */
const PJ_MAX = 5;                       // fichiers par message
const PJ_TAILLE = 8 * 1024 * 1024;      // 8 Mo par fichier
const PJ_SIGNATURE = 5 * 1024;          // mail entrant : image « inline » plus petite = logo de signature, ignorée
const PJ_PERSONNE_JOUR = 40;            // fichiers par personne et par 24 h (hors prestataire)
const PJ_JOUR = 900;                    // tous comptes : KV gratuit = 1000 écritures par jour (marge)
const PJ_TYPES = {
  jpg: { type: "image/jpeg", inline: true, image: true }, png: { type: "image/png", inline: true, image: true },
  webp: { type: "image/webp", inline: true, image: true }, heic: { type: "image/heic", inline: false },
  pdf: { type: "application/pdf", inline: true },
  docx: { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", inline: false, dossier: "word/" },
  xlsx: { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", inline: false, dossier: "xl/" },
  pptx: { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", inline: false, dossier: "ppt/" },
  txt: { type: "text/plain; charset=utf-8", inline: false },
};
const pjOk = (env) => !!(env && env.AIDE_PJ && typeof env.AIDE_PJ.put === "function");
const ascii = (o, debut, fin) => String.fromCharCode(...o.subarray(debut, fin));
function extension(nom) { const m = /\.([a-z0-9]{1,5})$/i.exec(String(nom || "")); return m ? m[1].toLowerCase() : ""; }

/**
 * Type RÉEL d'un fichier, d'après ses premiers octets (« nombres magiques »), jamais d'après le nom seul.
 * → { ext, type, inline, image } ou null (type refusé). Le nom ne sert qu'à distinguer docx/xlsx/pptx (tous des ZIP)
 * et le texte brut (sans signature) ; l'archive doit alors contenir le bon dossier (word/, xl/, ppt/).
 */
export function typeFichier(octets, nom) {
  const o = octets instanceof Uint8Array ? octets : new Uint8Array(octets || []), n = o.length, ext = extension(nom);
  const r = (e) => ({ ext: e, ...PJ_TYPES[e] });
  if (n >= 3 && o[0] === 0xff && o[1] === 0xd8 && o[2] === 0xff) return r("jpg");
  if (n >= 8 && ascii(o, 0, 8) === "\x89PNG\r\n\x1a\n") return r("png");
  if (n >= 12 && ascii(o, 0, 4) === "RIFF" && ascii(o, 8, 12) === "WEBP") return r("webp");
  if (n >= 12 && ascii(o, 4, 8) === "ftyp" && /^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)$/.test(ascii(o, 8, 12))) return r("heic");
  if (n >= 5 && ascii(o, 0, 5) === "%PDF-") return r("pdf");
  if (n >= 4 && ascii(o, 0, 4) === "PK\x03\x04") {
    if (!["docx", "xlsx", "pptx"].includes(ext)) return null;
    // Le répertoire central (fin du ZIP) liste tous les noms : on y cherche « word/ », « xl/ » ou « ppt/ ».
    const fin = new TextDecoder("latin1").decode(o.subarray(Math.max(0, n - 65536)));
    return fin.includes(PJ_TYPES[ext].dossier) && fin.includes("[Content_Types].xml") ? r(ext) : null;
  }
  if (ext === "txt" && n > 0) {
    const debut = o.subarray(0, 8192);
    if (debut.includes(0)) return null; // octet nul : pas du texte
    try { new TextDecoder("utf-8", { fatal: true }).decode(o.subarray(0, 65536), { stream: true }); return r("txt"); }
    catch { return { ...r("txt"), type: "text/plain; charset=windows-1252" }; }
  }
  return null;
}
/** Nom de fichier sûr : sans chemin ni caractère de contrôle, 100 caractères au plus, extension = type réel. */
export function nomFichier(nom, ext) {
  let s = String(nom == null ? "" : nom).split(/[\\/]/).pop().normalize("NFC")
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069"<>|:*?]/g, "").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  if (ext) {
    const actuelle = extension(s), equiv = { jpeg: "jpg", jpe: "jpg", heif: "heic" }, connue = Object.hasOwn(PJ_TYPES, actuelle) || Object.hasOwn(equiv, actuelle);
    if ((equiv[actuelle] || actuelle) !== ext) s = (connue ? s.slice(0, -actuelle.length - 1) : s) + "." + ext; // « photo.png » en vrai JPEG → « photo.jpg »
  }
  if (!s || s === "." + ext) s = "fichier" + (ext ? "." + ext : "");
  if (s.length > 100) { const e = extension(s); s = s.slice(0, 100 - (e ? e.length + 1 : 0)).trim() + (e ? "." + e : ""); }
  return s;
}
/** En-tête Content-Disposition (RFC 6266 : filename ASCII de secours + filename* UTF-8). */
export function disposition(nom, inline) {
  const secours = String(nom).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]|["\\]/g, "_");
  const utf8 = encodeURIComponent(nom).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return (inline ? "inline" : "attachment") + '; filename="' + secours + "\"; filename*=UTF-8''" + utf8;
}
/** Contrôle d'une liste de fichiers {nom, octets} → { ok: [{nom, octets, t}], erreur?: {code, erreur} }. */
export function controlerFichiers(fichiers) {
  if (fichiers.length > PJ_MAX) return { erreur: { code: "trop_de_fichiers", erreur: PJ_MAX + " fichiers au plus par message." } };
  const ok = [];
  for (const f of fichiers) {
    if (f.octets.length > PJ_TAILLE) return { erreur: { code: "fichier_trop_lourd", erreur: "« " + nomFichier(f.nom) + " » est trop lourd (8 Mo au plus)." } };
    if (!f.octets.length) return { erreur: { code: "fichier_vide", erreur: "« " + nomFichier(f.nom) + " » est vide." } };
    const t = typeFichier(f.octets, f.nom);
    if (!t) return { erreur: { code: "type_fichier", erreur: "« " + nomFichier(f.nom) + " » : type de fichier non accepté (photos, PDF, Word, Excel, PowerPoint, texte)." } };
    ok.push({ nom: nomFichier(f.nom, t.ext), octets: f.octets, t });
  }
  return { ok };
}
/** Quota de pièces jointes : par personne (24 h) et pour tout le compte (écritures KV gratuites). */
async function quotaPj(db, oid, nombre, prestataire) {
  if (!nombre) return null;
  const depuis = iso(Date.now() - 86400000);
  const tous = await db.prepare("SELECT COUNT(*) AS n FROM pieces_jointes WHERE cree_le > ?").bind(depuis).first();
  if (tous && tous.n + nombre > PJ_JOUR) return { code: "quota_pj", erreur: "Limite du jour atteinte pour les pièces jointes. Réessayez demain." };
  if (prestataire || !oid) return null;
  const moi = await db.prepare("SELECT COUNT(*) AS n FROM pieces_jointes WHERE auteur = ? AND cree_le > ?").bind(oid, depuis).first();
  if (moi && moi.n + nombre > PJ_PERSONNE_JOUR) return { code: "trop_de_pj", erreur: "Beaucoup de pièces jointes aujourd'hui : réessayez demain." };
  return null;
}
/** Enregistre les fichiers contrôlés : octets dans KV (pj/<demande>/<uuid>), ligne dans D1. → [{id, nom, type, taille}] */
async function stockerPj(env, demandeId, messageId, fichiers, auteur) {
  const faits = [], echecs = [];
  for (const f of fichiers) {
    const cle = "pj/" + demandeId + "/" + crypto.randomUUID(), cree = iso(Date.now());
    try {
      await env.AIDE_PJ.put(cle, f.octets, { metadata: { nom: f.nom, type: f.t.type, taille: f.octets.length, auteur, date: cree } });
      const r = await env.AIDE_DB.prepare("INSERT INTO pieces_jointes(demande_id, message_id, nom, type, taille, cle, cree_le, auteur) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
        .bind(demandeId, messageId, f.nom, f.t.type, f.octets.length, cle, cree, auteur).first();
      faits.push({ id: r.id, nom: f.nom, type: f.t.type, taille: f.octets.length });
    } catch (e) { console.error("Aide, pièce jointe :", e && e.message); echecs.push("Pièce jointe non enregistrée : " + f.nom); }
  }
  return { faits, echecs };
}
const vuePj = (p) => ({ id: p.id, nom: p.nom, type: p.type, taille: p.taille, apercu: /^image\/(jpeg|png|webp)$/.test(p.type) });

async function hmacHex(secret, texte) {
  const cle = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cle, new TextEncoder().encode(String(texte))));
  return Array.from(sig, (x) => x.toString(16).padStart(2, "0")).join("");
}
export async function signature(secret, id) { return (await hmacHex(secret, "demande-" + id)).slice(0, 12); }
function egal(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
export function sujetDemande(type, id) { return "Application Breteuil - Retour client - " + (AIDE_TYPES[type] || "Question") + " - n°" + id; }
function lienAppli(env, id, pjId) { return String(env.AIDE_APPLI_URL || "https://espace-breteuil.pages.dev/").replace(/#.*$/, "").replace(/\/?$/, "/") + "#/aide/" + id + (pjId ? "/pj/" + pjId : ""); }

async function envoyerMail(env, d, texte, premier, pj = [], ignorees = []) {
  const domaine = domaineDe(env.AIDE_EXPEDITEUR);
  // « demande+<n°>-<signature>@… » : une seule règle Email Routing « demande@… → Worker » suffit
  // (sous-adressage « + » ; les règles « catch-all » n'existent que sur le domaine principal).
  const repondreA = "demande+" + d.id + "-" + (await signature(env.AIDE_SECRET, d.id)) + "@" + domaine;
  // Pièces jointes : listées avec un lien vers l'appli, jamais jointes au mail (mail léger, accès contrôlé).
  const listePj = pj.map((f) => ({ nom: f.nom, taille: f.taille, lien: lienAppli(env, d.id, f.id) }));
  const corps = [
    (premier ? "Nouvelle demande n°" : "Nouveau message sur la demande n°") + d.id + " — " + (AIDE_TYPES[d.type] || d.type),
    "",
    "Nom : " + d.nom,
    "Adresse : " + d.adresse,
    "Écran : " + (d.ecran || "—"),
    "Version : " + (d.version || "—"),
    "Appareil : " + (d.appareil || "—"),
    "",
    "Message :",
    texte || "(pièce jointe seule)",
    ...(listePj.length || ignorees.length ? ["", "Pièces jointes :", ...listePj.map((f) => "- " + f.nom + " (" + tailleLisible(f.taille) + ") : " + f.lien), ...ignorees.map((t) => "- " + t)] : []),
    "",
    "Voir la demande dans l'appli : " + lienAppli(env, d.id),
    "",
    "Pour répondre : répondez simplement à ce mail. Votre réponse s'ajoute au fil de la demande (la citation est retirée).",
  ].join("\n");
  const html = htmlMail({ id: d.id, type: d.type, nom: d.nom, adresse: d.adresse, ecran: d.ecran, version: d.version, appareil: d.appareil,
    date: Date.now(), texte, premier, lien: lienAppli(env, d.id), pj: listePj, ignorees });
  const mime = construireMime({
    de: env.AIDE_EXPEDITEUR, nomDe: "Espace Breteuil", a: env.AIDE_DESTINATAIRE, repondreA,
    sujet: sujetDemande(d.type, d.id), texte: corps, html,
    messageId: "demande-" + d.id + "-" + crypto.randomUUID() + "@" + domaine, references: "demande-" + d.id + "@" + domaine,
  });
  await env.AIDE_MAIL.send(new EmailMessage(env.AIDE_EXPEDITEUR, env.AIDE_DESTINATAIRE, mime));
}
async function essayerMail(env, d, texte, premier, pj, ignorees) {
  try { await envoyerMail(env, d, texte, premier, pj, ignorees); return true; }
  catch (e) { console.error("Aide, mail sortant :", e && e.message); return false; }
}

/* ---------- Routes HTTP ---------- */
function vueDemande(r, moi, prestataire) {
  return { id: r.id, cree: r.cree, type: r.type, statut: r.statut, nom: r.nom, adresse: r.adresse, ecran: r.ecran, version: r.version, appareil: r.appareil,
    nonLu: !prestataire && r.oid === moi.oid && r.lu_par_demandeur === 0, dernier: r.dernier || r.cree, nbMessages: r.nb || 0,
    extrait: r.extrait != null ? ligneCourte(r.extrait, 140) : undefined, dernierAuteur: r.dernier_auteur || undefined };
}
/**
 * Corps d'un envoi : JSON (sans fichier, comme avant) ou multipart/form-data (v5.6) avec un champ « donnees »
 * (le même JSON) et jusqu'à 5 champs « fichier ». → { c, fichiers: [{ nom, octets }] }
 */
async function lireEnvoi(req) {
  if (!/^multipart\/form-data/i.test(req.headers.get("Content-Type") || "")) return { c: await lireCorps(req), fichiers: [] };
  const longueur = Number(req.headers.get("Content-Length") || 0);
  if (longueur > PJ_MAX * PJ_TAILLE + 1024 * 1024) throw Object.assign(new Error("trop lourd"), { statut: 413 });
  let fd;
  try { fd = await req.formData(); } catch { throw Object.assign(new Error("multipart invalide"), { statut: 400 }); }
  const brut = fd.get("donnees");
  if (typeof brut !== "string" || brut.length > 20000) throw Object.assign(new Error("donnees"), { statut: 400 });
  let c;
  try { c = JSON.parse(brut || "{}"); } catch { c = null; }
  if (!c || typeof c !== "object" || Array.isArray(c)) throw Object.assign(new Error("JSON invalide"), { statut: 400 });
  const fichiers = [];
  for (const f of fd.getAll("fichier")) {
    if (!f || typeof f === "string" || typeof f.arrayBuffer !== "function") continue;
    if (fichiers.length >= PJ_MAX) { fichiers.push({ nom: f.name, octets: new Uint8Array(0) }); break; } // compté, refusé plus loin
    fichiers.push({ nom: f.name, octets: f.size > PJ_TAILLE ? new Uint8Array(PJ_TAILLE + 1) : new Uint8Array(await f.arrayBuffer()) });
  }
  return { c, fichiers };
}
async function lireCorps(req) {
  const t = await req.text();
  if (t.length > 20000) throw Object.assign(new Error("trop long"), { statut: 413 });
  try { const j = JSON.parse(t || "{}"); if (j && typeof j === "object" && !Array.isArray(j)) return j; } catch {}
  throw Object.assign(new Error("JSON invalide"), { statut: 400 });
}
async function demandeAccessible(db, id, moi, prestataire) {
  const d = await db.prepare("SELECT * FROM demandes WHERE id = ?").bind(id).first();
  if (!d || (!prestataire && d.oid !== moi.oid)) return null; // 404 dans les deux cas : on ne révèle rien
  return d;
}

/** Fichiers d'un envoi : installés ? contrôlés (nombre, poids, type réel) ? quota ? → { ok: [...] } ou { reponse, statut }. */
async function preparerPj(env, db, moi, prestataire, fichiers) {
  if (!fichiers.length) return { ok: [] };
  if (!pjOk(env)) return { reponse: { ok: false, code: "pj_non_installees", erreur: "Les pièces jointes ne sont pas encore installées." }, statut: 400 };
  const c = controlerFichiers(fichiers);
  if (c.erreur) return { reponse: { ok: false, ...c.erreur }, statut: c.erreur.code === "fichier_trop_lourd" ? 413 : 400 };
  const q = await quotaPj(db, moi.oid, c.ok.length, prestataire);
  if (q) return { reponse: { ok: false, ...q }, statut: 429 };
  return { ok: c.ok };
}

async function routeAide(req, url, env, origine) {
  const repondre = (obj, status) => json(obj, status, origine);
  if (!aideConfiguree(env)) return repondre({ ok: false, code: "aide_non_configuree", erreur: "L'aide n'est pas encore installée." }, 503);
  const auth = req.headers.get("Authorization") || "";
  let moi = null;
  try { moi = /^Bearer\s+\S+$/i.test(auth) ? await verifierJeton(auth.replace(/^Bearer\s+/i, ""), env) : null; }
  catch (e) { console.error("Aide, clés Microsoft :", e && e.message); return repondre({ ok: false, code: "verification_impossible", erreur: "Vérification de la connexion impossible pour le moment." }, 502); }
  if (!moi) return repondre({ ok: false, code: "non_connecte", erreur: "Connexion requise." }, 401);
  const db = env.AIDE_DB, prestataire = estPrestataire(env, moi.adresse);
  const segments = url.pathname.split("/").slice(3).filter(Boolean); // après /breteuil/aide
  const m = req.method;
  try {
    await tables(db);
    if (segments.length === 1 && segments[0] === "moi" && m === "GET") return repondre({ prestataire, nom: moi.nom, adresse: moi.adresse, pj: pjOk(env) }, 200);

    if (segments.length === 0 && m === "POST") {
      const { c, fichiers } = await lireEnvoi(req);
      const type = String(c.type || ""), texte = texteBrut(c.message);
      if (!Object.hasOwn(AIDE_TYPES, type)) return repondre({ ok: false, code: "type_invalide", erreur: "Type de demande inconnu." }, 400);
      if (!texte) return repondre({ ok: false, code: "message_vide", erreur: "Le message est vide." }, 400);
      if (texteBrut(c.message).length > AIDE_MAX) return repondre({ ok: false, code: "message_trop_long", erreur: "4000 caractères au plus." }, 400);
      const maintenant = Date.now();
      const n = await db.prepare("SELECT COUNT(*) AS n FROM demandes WHERE oid = ? AND cree > ?").bind(moi.oid, iso(maintenant - 3600000)).first();
      if (n && n.n >= AIDE_LIMITE_HEURE) return repondre({ ok: false, code: "trop_de_demandes", erreur: "Trop de demandes en une heure." }, 429);
      const pj = await preparerPj(env, db, moi, prestataire, fichiers);
      if (pj.reponse) return repondre(pj.reponse, pj.statut);
      const d = { cree: iso(maintenant), oid: moi.oid, nom: moi.nom, adresse: moi.adresse, type, statut: "nouvelle",
        ecran: ligneCourte(c.ecran, 120), version: ligneCourte(c.version, 20), appareil: ligneCourte(c.appareil, 120) };
      const r = await db.prepare("INSERT INTO demandes(cree, oid, nom, adresse, type, statut, ecran, version, appareil, lu_par_demandeur) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1) RETURNING id")
        .bind(d.cree, d.oid, d.nom, d.adresse, d.type, d.statut, d.ecran, d.version, d.appareil).first();
      d.id = r.id;
      const msg = await db.prepare("INSERT INTO messages(demande_id, cree, auteur, texte, origine) VALUES (?, ?, 'client', ?, 'appli') RETURNING id").bind(d.id, d.cree, texte).first();
      const { faits, echecs } = pj.ok.length ? await stockerPj(env, d.id, msg.id, pj.ok, moi.oid) : { faits: [], echecs: [] };
      const mailEnvoye = await essayerMail(env, d, texte, true, faits, echecs);
      return repondre({ ok: true, id: d.id, statut: d.statut, mailEnvoye, pj: faits.map(vuePj), pjEchecs: echecs }, 201);
    }

    if (segments.length === 0 && m === "GET") {
      const conditions = [], valeurs = [];
      if (!prestataire) { conditions.push("d.oid = ?"); valeurs.push(moi.oid); }
      const statut = url.searchParams.get("statut"), type = url.searchParams.get("type"), personne = url.searchParams.get("personne");
      if (statut && AIDE_STATUTS.includes(statut)) { conditions.push("d.statut = ?"); valeurs.push(statut); }
      if (type && Object.hasOwn(AIDE_TYPES, type)) { conditions.push("d.type = ?"); valeurs.push(type); }
      if (prestataire && personne) { conditions.push("d.adresse = ?"); valeurs.push(String(personne).toLowerCase().slice(0, 200)); }
      const sql = "SELECT d.*, (SELECT MAX(cree) FROM messages WHERE demande_id = d.id) AS dernier, (SELECT COUNT(*) FROM messages WHERE demande_id = d.id) AS nb, " +
        "(SELECT texte FROM messages WHERE demande_id = d.id ORDER BY id LIMIT 1) AS extrait, (SELECT auteur FROM messages WHERE demande_id = d.id ORDER BY id DESC LIMIT 1) AS dernier_auteur " +
        "FROM demandes d" + (conditions.length ? " WHERE " + conditions.join(" AND ") : "") + " ORDER BY dernier DESC, d.id DESC LIMIT 200";
      const r = await db.prepare(sql).bind(...valeurs).all();
      return repondre({ prestataire, pj: pjOk(env), demandes: (r.results || []).map((x) => vueDemande(x, moi, prestataire)) }, 200);
    }

    const id = segments[0] && /^\d{1,9}$/.test(segments[0]) ? Number(segments[0]) : null;
    if (id == null) return repondre({ ok: false, erreur: "Introuvable." }, 404);
    const d = await demandeAccessible(db, id, moi, prestataire);
    if (!d) return repondre({ ok: false, code: "introuvable", erreur: "Demande introuvable." }, 404);
    const proprietaire = d.oid === moi.oid;

    if (segments.length === 1 && m === "GET") {
      const msgs = await db.prepare("SELECT id, cree, auteur, texte, origine FROM messages WHERE demande_id = ? ORDER BY id").bind(id).all();
      const pjs = (await db.prepare("SELECT id, message_id, nom, type, taille FROM pieces_jointes WHERE demande_id = ? ORDER BY id").bind(id).all()).results || [];
      const messages = (msgs.results || []).map((x) => ({ ...x, pj: pjs.filter((p) => p.message_id === x.id).map(vuePj) }));
      const nonLu = proprietaire && d.lu_par_demandeur === 0;
      if (nonLu) await db.prepare("UPDATE demandes SET lu_par_demandeur = 1 WHERE id = ?").bind(id).run();
      return repondre({ prestataire, pj: pjOk(env), demande: { ...vueDemande(d, moi, prestataire), nonLu: false }, messages }, 200);
    }

    if (segments.length === 2 && segments[1] === "messages" && m === "POST") {
      const { c, fichiers } = await lireEnvoi(req);
      const texte = texteBrut(c.texte);
      if (!texte && !fichiers.length) return repondre({ ok: false, code: "message_vide", erreur: "Le message est vide." }, 400);
      if (texte.length > AIDE_MAX) return repondre({ ok: false, code: "message_trop_long", erreur: "4000 caractères au plus." }, 400);
      const maintenant = Date.now();
      const auteur = prestataire ? "prestataire" : "client";
      if (auteur === "client") {
        const n = await db.prepare("SELECT COUNT(*) AS n FROM messages m JOIN demandes d ON d.id = m.demande_id WHERE d.oid = ? AND m.auteur = 'client' AND m.cree > ?").bind(moi.oid, iso(maintenant - 3600000)).first();
        if (n && n.n >= AIDE_MESSAGES_HEURE) return repondre({ ok: false, code: "trop_de_messages", erreur: "Trop de messages en une heure." }, 429);
      }
      const pj = await preparerPj(env, db, moi, prestataire, fichiers);
      if (pj.reponse) return repondre(pj.reponse, pj.statut);
      const msg = await db.prepare("INSERT INTO messages(demande_id, cree, auteur, texte, origine) VALUES (?, ?, ?, ?, 'appli') RETURNING id").bind(id, iso(maintenant), auteur, texte).first();
      const { faits, echecs } = pj.ok.length ? await stockerPj(env, id, msg.id, pj.ok, prestataire ? "prestataire" : moi.oid) : { faits: [], echecs: [] };
      let mailEnvoye = null;
      if (auteur === "client") {
        await db.prepare("UPDATE demandes SET statut = 'nouvelle' WHERE id = ?").bind(id).run();
        mailEnvoye = await essayerMail(env, d, texte, false, faits, echecs);
      } else {
        await db.prepare("UPDATE demandes SET statut = 'repondue', lu_par_demandeur = 0 WHERE id = ?").bind(id).run();
      }
      return repondre({ ok: true, statut: auteur === "client" ? "nouvelle" : "repondue", mailEnvoye, pj: faits.map(vuePj), pjEchecs: echecs }, 201);
    }

    // Pièce jointe : mêmes droits que le fil (demandeur ou prestataire), rendue avec son type RÉEL.
    if (segments.length === 3 && segments[1] === "pj" && m === "GET") {
      const pjId = /^\d{1,9}$/.test(segments[2]) ? Number(segments[2]) : null;
      const p = pjId == null ? null : await db.prepare("SELECT * FROM pieces_jointes WHERE id = ? AND demande_id = ?").bind(pjId, id).first();
      if (!p) return repondre({ ok: false, code: "introuvable", erreur: "Pièce jointe introuvable." }, 404);
      if (!pjOk(env)) return repondre({ ok: false, code: "pj_non_installees", erreur: "Les pièces jointes ne sont pas installées." }, 503);
      const corps = await env.AIDE_PJ.get(p.cle, { type: "stream" });
      if (!corps) return repondre({ ok: false, code: "introuvable", erreur: "Pièce jointe introuvable." }, 404);
      const t = Object.values(PJ_TYPES).find((x) => x.type === p.type);
      return new Response(corps, { status: 200, headers: {
        "Content-Type": p.type, "Content-Length": String(p.taille), "Content-Disposition": disposition(p.nom, !!(t && t.inline)),
        "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox", ...cors(origine),
      } });
    }

    if (segments.length === 1 && m === "PATCH") {
      const c = await lireCorps(req);
      const statut = String(c.statut || "");
      if (!AIDE_STATUTS.includes(statut)) return repondre({ ok: false, code: "statut_invalide", erreur: "Statut inconnu." }, 400);
      if (!prestataire && statut !== "resolue") return repondre({ ok: false, code: "interdit", erreur: "Seul Damien peut changer ce statut." }, 403);
      await db.prepare("UPDATE demandes SET statut = ? WHERE id = ?").bind(statut, id).run();
      return repondre({ ok: true, id, statut }, 200);
    }
    return repondre({ ok: false, erreur: "Méthode non permise." }, 405);
  } catch (e) {
    if (e && e.statut) return repondre({ ok: false, erreur: e.statut === 413 ? "Envoi trop volumineux." : "Requête invalide." }, e.statut);
    console.error("Aide :", e && e.message);
    return repondre({ ok: false, code: "erreur", erreur: "Erreur du service d'aide." }, 500);
  }
}

/* ---------- Mail entrant : lecture MIME (multipart, quoted-printable, base64) ---------- */
function octetsDe(binaire) { const o = new Uint8Array(binaire.length); for (let i = 0; i < binaire.length; i++) o[i] = binaire.charCodeAt(i) & 255; return o; }
function decoderCharset(octets, charset) {
  try { return new TextDecoder(String(charset || "utf-8").trim().toLowerCase().replace(/^"|"$/g, "")).decode(octets); }
  catch { return new TextDecoder("utf-8").decode(octets); }
}
function quotedPrintable(binaire) {
  const s = binaire.replace(/=\r?\n/g, "");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) { out += String.fromCharCode(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
    else out += s[i];
  }
  return out;
}
function separer(binaire) {
  const m = /\r?\n\r?\n/.exec(binaire);
  const brut = m ? binaire.slice(0, m.index) : binaire, corps = m ? binaire.slice(m.index + m[0].length) : "";
  const entetes = {};
  for (const l of brut.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = l.indexOf(":");
    if (i > 0) { const k = l.slice(0, i).trim().toLowerCase(); if (!(k in entetes)) entetes[k] = l.slice(i + 1).trim(); }
  }
  return { entetes, corps };
}
function parametre(valeur, nom) {
  const m = new RegExp(";\\s*" + nom + "\\s*=\\s*(\"([^\"]*)\"|([^;\\s]+))", "i").exec(valeur || "");
  return m ? (m[2] ?? m[3]) : "";
}
/** Mots encodés RFC 2047 (=?charset?B|Q?…?=) d'un en-tête (nom de fichier, sujet). */
export function decoderMots(v) {
  return String(v || "").replace(/\?=\s+=\?/g, "?==?").replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (m, cs, enc, t) => {
    try {
      const bin = enc.toLowerCase() === "b" ? atob(t.replace(/[^A-Za-z0-9+/=]/g, "")) : quotedPrintable(t.replace(/_/g, " "));
      return decoderCharset(octetsDe(bin), cs);
    } catch { return m; }
  });
}
/** Nom de fichier d'une partie : filename / name, RFC 2231 (filename*=UTF-8''…, suites *0*, *1*…) ou RFC 2047. */
function nomPartie(entetes) {
  for (const [h, nom] of [["content-disposition", "filename"], ["content-type", "name"]]) {
    const v = entetes[h] || "";
    const etoile = new RegExp(";\\s*" + nom + "\\*(?:0\\*?)?\\s*=\\s*\"?([^\";]*)\"?", "i").exec(v);
    if (etoile) {
      let brut = etoile[1];
      for (let i = 1; i < 20; i++) { const s = new RegExp(";\\s*" + nom + "\\*" + i + "\\*?\\s*=\\s*\"?([^\";]*)\"?", "i").exec(v); if (!s) break; brut += s[1]; }
      const m = /^([^']*)'[^']*'(.*)$/.exec(brut);
      try { return decoderCharset(octetsDe(unescape(m ? m[2] : brut)), m ? m[1] || "utf-8" : "utf-8"); } catch { return brut; }
    }
    const simple = parametre(v, nom);
    if (simple) return decoderMots(simple);
  }
  return "";
}
/** Base64 → octets (natif si le moteur le permet : moins de temps de calcul sur les grosses pièces). */
function octetsBase64(t) {
  const propre = t.replace(/[^A-Za-z0-9+/=]/g, "");
  if (typeof Uint8Array.fromBase64 === "function") { try { return Uint8Array.fromBase64(propre.replace(/=+$/, ""), { lastChunkHandling: "loose" }); } catch {} }
  return octetsDe(atob(propre));
}
/**
 * Lecture d'un mail brut (chaîne « binaire », 1 caractère = 1 octet) : partie texte (text/plain d'abord, sinon HTML
 * sans balises) et pièces jointes { nom, typeDeclare, inline, taille, octets? } (octets absents si trop lourde).
 */
export function analyserMail(binaire, profondeur = 0, pieces = []) {
  const { entetes, corps } = separer(binaire);
  const type = (entetes["content-type"] || "text/plain").toLowerCase();
  if (/^multipart\//.test(type)) {
    if (profondeur >= 5) return { texte: null, pieces };
    const borne = parametre(entetes["content-type"], "boundary");
    if (!borne) return { texte: null, pieces };
    const morceaux = corps.split("--" + borne).slice(1);
    let plain = null, html = null;
    for (const p of morceaux) {
      if (/^--/.test(p)) break;
      const t = analyserMail(p.replace(/^\r?\n/, ""), profondeur + 1, pieces).texte;
      if (t && t.type === "text/plain" && !plain) plain = t;
      if (t && t.type === "text/html" && !html) html = t;
    }
    return { texte: plain || html, pieces };
  }
  const cd = entetes["content-disposition"] || "", nom = nomPartie(entetes);
  const cte = (entetes["content-transfer-encoding"] || "7bit").toLowerCase();
  const estTexte = /^text\/(plain|html)/.test(type) && !/^\s*attachment/i.test(cd) && !nom;
  if (!estTexte) {
    if (/^message\//.test(type)) return { texte: null, pieces }; // mail transféré en pièce jointe : ignoré
    const estime = cte === "base64" ? Math.floor(corps.replace(/[^A-Za-z0-9+/]/g, "").length * 3 / 4) : corps.length;
    const piece = { nom: nom || "piece-jointe", typeDeclare: type.split(";")[0].trim(), inline: /^\s*inline/i.test(cd) || (!cd && !!entetes["content-id"]), taille: estime };
    if (estime <= PJ_TAILLE) {
      try { piece.octets = cte === "base64" ? octetsBase64(corps) : cte === "quoted-printable" ? octetsDe(quotedPrintable(corps)) : octetsDe(corps.replace(/\r?\n$/, "")); piece.taille = piece.octets.length; }
      catch { piece.octets = null; }
    }
    pieces.push(piece);
    return { texte: null, pieces };
  }
  let octets;
  if (cte === "base64") { try { octets = octetsBase64(corps); } catch { return { texte: null, pieces }; } }
  else if (cte === "quoted-printable") octets = octetsDe(quotedPrintable(corps));
  else octets = octetsDe(corps);
  let texte = decoderCharset(octets, parametre(entetes["content-type"], "charset"));
  if (/^text\/html/.test(type)) {
    texte = decoder(texte.replace(/<(style|script)[\s\S]*?<\/\1>/gi, "").replace(/<div[^>]*class="?gmail_signature[\s\S]*$/i, "").replace(/<blockquote[\s\S]*$/i, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div)>/gi, "\n").replace(/<[^>]+>/g, ""));
    return { texte: { type: "text/html", texte }, pieces };
  }
  return { texte: { type: "text/plain", texte }, pieces };
}
/** Partie texte d'un mail brut (compatibilité) : { type, texte } ou null. */
export function partieTexte(binaire) { return analyserMail(binaire).texte; }
/**
 * Tri des pièces d'un mail entrant : petites images « inline » (logos de signature) ignorées sans bruit ;
 * trop lourdes, type refusé, au-delà de 5 : ignorées avec une note. → { gardees: [{nom, octets}], notes: [texte] }
 */
export function trierPiecesMail(pieces, installees = true) {
  const gardees = [], notes = [];
  for (const p of pieces) {
    if (p.inline && /^image\//.test(p.typeDeclare) && p.taille < PJ_SIGNATURE) continue;
    const nom = nomFichier(p.nom);
    if (!installees) { notes.push("Pièce jointe ignorée : pièces jointes non installées (" + nom + ")"); continue; }
    if (!p.octets || p.taille > PJ_TAILLE) { notes.push("Pièce jointe ignorée : trop lourde (" + nom + ", " + tailleLisible(p.taille) + ")"); continue; }
    if (!typeFichier(p.octets, p.nom)) { notes.push("Pièce jointe ignorée : type non accepté (" + nom + ")"); continue; }
    if (gardees.length >= PJ_MAX) { notes.push("Pièce jointe ignorée : " + PJ_MAX + " au plus par message (" + nom + ")"); continue; }
    gardees.push({ nom: p.nom, octets: p.octets });
  }
  return { gardees, notes };
}
/** Retire la citation et la signature d'une réponse (Gmail, Apple Mail, Outlook, français ou anglais). */
export function sansCitation(texte, signatureFin) {
  const l = String(texte || "").replace(/\r\n?/g, "\n").split("\n");
  let fin = l.length;
  for (let i = 0; i < l.length; i++) {
    const x = l[i].trim();
    if (x === "--" || l[i] === "-- ") { fin = i; break; }
    if (/^-{2,}\s*(original message|message d'origine|message transféré|forwarded message)/i.test(x) || /^_{8,}$/.test(x)) { fin = i; break; }
    if (/^(le|on)\s/i.test(x)) {
      const bloc = [x, (l[i + 1] || "").trim(), (l[i + 2] || "").trim()];
      if (/(a écrit|wrote)\s*:\s*$/i.test(bloc[0]) || /(a écrit|wrote)\s*:\s*$/i.test(bloc[0] + " " + bloc[1]) || /(a écrit|wrote)\s*:\s*$/i.test(bloc.join(" "))) { fin = i; break; }
    }
    if (/^(de|from)\s*:\s*\S/i.test(x) && /^(envoyé|sent|date|à|to)\s*:/i.test((l[i + 1] || "").trim())) { fin = i; break; }
    if (/^>/.test(x) && l.slice(i).every((y) => /^\s*(>|$)/.test(y))) { fin = i; break; }
  }
  return retirerSignature(texteBrut(l.slice(0, fin).filter((y) => !/^\s*>/.test(y)).join("\n")), signatureFin).slice(0, AIDE_MAX);
}
/**
 * Signature SANS délimiteur « -- » (variable AIDE_SIGNATURE) : ses lignes, séparées par « | » ou des sauts de ligne,
 * sont retirées quand elles TERMINENT le message (casse, espaces et ponctuation finale ignorés), puis les lignes vides de fin.
 */
export function retirerSignature(texte, signatureFin) {
  const norm = (x) => String(x).toLowerCase().replace(/\s+/g, "").replace(/[.,;:!]+$/, "");
  const lignesSig = new Set(String(signatureFin || "").split(/\r?\n|\\n|\|/).map(norm).filter(Boolean));
  const l = String(texte || "").replace(/\r\n?/g, "\n").split("\n");
  while (l.length && !l[l.length - 1].trim()) l.pop();
  if (lignesSig.size) while (l.length && (lignesSig.has(norm(l[l.length - 1])) || !l[l.length - 1].trim())) l.pop();
  return l.join("\n").trim();
}

export async function recevoirMail(message, env) {
  const rejeter = () => message.setReject("Adresse inconnue");
  if (!aideConfiguree(env)) return rejeter();
  // demande+<n°>-<sig>@… (règle « demande@ » + sous-adressage) ou demande-<n°>-<sig>@… (catch-all).
  const m = /^demande[+-](\d{1,9})-([0-9a-f]{12})@(.+)$/i.exec(String(message.to || "").trim().toLowerCase());
  if (!m || m[3] !== domaineDe(env.AIDE_EXPEDITEUR)) return rejeter();
  if (!egal(m[2], await signature(env.AIDE_SECRET, Number(m[1])))) return rejeter();
  const de = String(message.from || "").trim().toLowerCase().replace(/^.*<([^>]+)>.*$/, "$1");
  if (!estPrestataire(env, de)) return rejeter();
  if (message.rawSize && message.rawSize > AIDE_RAW_MAX) return message.setReject("Message trop volumineux");
  const db = env.AIDE_DB;
  await tables(db);
  const id = Number(m[1]);
  const d = await db.prepare("SELECT id FROM demandes WHERE id = ?").bind(id).first();
  if (!d) return rejeter();
  const brut = new Uint8Array(await new Response(message.raw).arrayBuffer()).subarray(0, AIDE_RAW_MAX);
  let binaire = "";
  for (let i = 0; i < brut.length; i += 0x8000) binaire += String.fromCharCode.apply(null, brut.subarray(i, i + 0x8000));
  const { texte: partie, pieces } = analyserMail(binaire);
  let texte = sansCitation(partie ? partie.texte : "", env.AIDE_SIGNATURE);
  let { gardees, notes } = trierPiecesMail(pieces, pjOk(env));
  let fichiers = [];
  if (gardees.length) {
    const c = controlerFichiers(gardees); // déjà triées : ne refuse plus rien
    fichiers = c.ok || [];
    const q = await quotaPj(db, null, fichiers.length, true);
    if (q) { notes.push(...fichiers.map((f) => "Pièce jointe ignorée : limite du jour atteinte (" + f.nom + ")")); fichiers = []; }
  }
  if (!texte && !fichiers.length) return message.setReject("Réponse vide");
  if (notes.length) texte = (texte ? texte + "\n\n" : "") + notes.map((n) => "(" + n + ")").join("\n");
  const msg = await db.prepare("INSERT INTO messages(demande_id, cree, auteur, texte, origine) VALUES (?, ?, 'prestataire', ?, 'mail') RETURNING id").bind(id, iso(Date.now()), texteBrut(texte, AIDE_MAX + 2000)).first();
  if (fichiers.length) await stockerPj(env, id, msg.id, fichiers, "prestataire");
  await db.prepare("UPDATE demandes SET statut = 'repondue', lu_par_demandeur = 0 WHERE id = ?").bind(id).run();
}

export default {
  /** Mail entrant (Email Routing, règle « demande@… » → Worker) : réponse de Damien à une demande. */
  async email(message, env, ctx) {
    try { await recevoirMail(message, env); }
    catch (e) { console.error("Aide, mail entrant :", e && e.message); message.setReject("Adresse inconnue"); }
  },
  async fetch(req, env) {
    const url = new URL(req.url);
    const origine = req.headers.get("Origin") || "";
    const permise = ORIGINES.includes(origine) || /^http:\/\/localhost(:\d+)?$/.test(origine);
    if (!permise) return new Response("Réservé à l'Espace Breteuil.", { status: 403 });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origine) });
    if (url.pathname === "/breteuil/aide" || url.pathname.startsWith("/breteuil/aide/")) return routeAide(req, url, env, origine);
    if (req.method !== "GET") return json({ ok: false, erreur: "Méthode non permise." }, 405, origine);

    if (url.pathname === "/breteuil/site/liens") return routeLiens(url, origine);

    const m = url.pathname.match(/^\/breteuil\/planning(?:\/(\d))?\.ics$/);
    if (!m) return json({ ok: false, erreur: "Introuvable." }, 404, origine);
    const n = m[1] ? Number(m[1]) : 1;
    if (n < 1 || n > 4) return json({ ok: false, erreur: "Calendrier inconnu." }, 404, origine);

    const source = urlSource(env, n);
    if (!source) return json({ ok: false, code: "non_configure", erreur: "Calendrier " + n + " non configuré." }, 503, origine);

    // Cache Cloudflare : copie fraîche (< 10 min) et dernière copie connue (secours).
    const cache = caches.default;
    const cleCache = new Request("https://cache.interne/planning/" + n);
    const enCache = await cache.match(cleCache);
    let copie = null;
    if (enCache) copie = { texte: await enCache.text(), quand: Number(enCache.headers.get("X-Quand")) || 0 };
    if (copie && Date.now() - copie.quand < TTL_S * 1000) return ics(copie.texte, "cache", copie.quand, origine);

    try {
      const r = await fetch(source, { headers: { "Accept": "text/calendar, */*;q=0.1", "User-Agent": "belfort-api (Espace Breteuil)" }, redirect: "follow", signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error("source HTTP " + r.status);
      const texte = await r.text();
      if (texte.length > MAX_OCTETS) throw new Error("source trop volumineuse");
      if (!/^\s*BEGIN:VCALENDAR/i.test(texte)) throw new Error("pas un calendrier ICS");
      const quand = Date.now();
      await cache.put(cleCache, new Response(texte, { headers: { "Cache-Control": "max-age=604800", "X-Quand": String(quand) } }));
      return ics(texte, "source", quand, origine);
    } catch (e) {
      console.error("Planning source " + n + " :", e && e.message);
      if (copie) return ics(copie.texte, "ancien", copie.quand, origine);
      return json({ ok: false, code: "source_indisponible", erreur: "Le calendrier ne répond pas pour le moment." }, 502, origine);
    }
  },
};
