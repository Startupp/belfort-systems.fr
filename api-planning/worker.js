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
    "Access-Control-Expose-Headers": "X-Planning-Etat, X-Planning-Date",
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
const AIDE_RAW_MAX = 2 * 1024 * 1024; // mail entrant : 2 Mo au plus
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

/** Message MIME complet (texte brut UTF-8 en base64). */
export function construireMime({ de, nomDe, a, repondreA, sujet, texte, messageId, references, date }) {
  const corps = b64(new TextEncoder().encode(String(texte).replace(/\r?\n/g, "\r\n"))).replace(/.{76}(?=.)/g, "$&\r\n");
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
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);
  return l.join("\r\n") + "\r\n\r\n" + corps + "\r\n";
}

async function hmacHex(secret, texte) {
  const cle = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cle, new TextEncoder().encode(String(texte))));
  return Array.from(sig, (x) => x.toString(16).padStart(2, "0")).join("");
}
export async function signature(secret, id) { return (await hmacHex(secret, "demande-" + id)).slice(0, 12); }
function egal(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
export function sujetDemande(type, id) { return "Application Breteuil - Retour client - " + (AIDE_TYPES[type] || "Question") + " - n°" + id; }
function lienAppli(env, id) { return String(env.AIDE_APPLI_URL || "https://espace-breteuil.pages.dev/").replace(/#.*$/, "").replace(/\/?$/, "/") + "#/aide/" + id; }

async function envoyerMail(env, d, texte, premier) {
  const domaine = domaineDe(env.AIDE_EXPEDITEUR);
  // « demande+<n°>-<signature>@… » : une seule règle Email Routing « demande@… → Worker » suffit
  // (sous-adressage « + » ; les règles « catch-all » n'existent que sur le domaine principal).
  const repondreA = "demande+" + d.id + "-" + (await signature(env.AIDE_SECRET, d.id)) + "@" + domaine;
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
    texte,
    "",
    "Voir la demande dans l'appli : " + lienAppli(env, d.id),
    "",
    "Pour répondre : répondez simplement à ce mail. Votre réponse s'ajoute au fil de la demande (la citation est retirée).",
  ].join("\n");
  const mime = construireMime({
    de: env.AIDE_EXPEDITEUR, nomDe: "Espace Breteuil", a: env.AIDE_DESTINATAIRE, repondreA,
    sujet: sujetDemande(d.type, d.id), texte: corps,
    messageId: "demande-" + d.id + "-" + crypto.randomUUID() + "@" + domaine, references: "demande-" + d.id + "@" + domaine,
  });
  await env.AIDE_MAIL.send(new EmailMessage(env.AIDE_EXPEDITEUR, env.AIDE_DESTINATAIRE, mime));
}
async function essayerMail(env, d, texte, premier) {
  try { await envoyerMail(env, d, texte, premier); return true; }
  catch (e) { console.error("Aide, mail sortant :", e && e.message); return false; }
}

/* ---------- Routes HTTP ---------- */
function vueDemande(r, moi, prestataire) {
  return { id: r.id, cree: r.cree, type: r.type, statut: r.statut, nom: r.nom, adresse: r.adresse, ecran: r.ecran, version: r.version, appareil: r.appareil,
    nonLu: !prestataire && r.oid === moi.oid && r.lu_par_demandeur === 0, dernier: r.dernier || r.cree, nbMessages: r.nb || 0,
    extrait: r.extrait != null ? ligneCourte(r.extrait, 140) : undefined, dernierAuteur: r.dernier_auteur || undefined };
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
    if (segments.length === 1 && segments[0] === "moi" && m === "GET") return repondre({ prestataire, nom: moi.nom, adresse: moi.adresse }, 200);

    if (segments.length === 0 && m === "POST") {
      const c = await lireCorps(req);
      const type = String(c.type || ""), texte = texteBrut(c.message);
      if (!Object.hasOwn(AIDE_TYPES, type)) return repondre({ ok: false, code: "type_invalide", erreur: "Type de demande inconnu." }, 400);
      if (!texte) return repondre({ ok: false, code: "message_vide", erreur: "Le message est vide." }, 400);
      if (texteBrut(c.message).length > AIDE_MAX) return repondre({ ok: false, code: "message_trop_long", erreur: "4000 caractères au plus." }, 400);
      const maintenant = Date.now();
      const n = await db.prepare("SELECT COUNT(*) AS n FROM demandes WHERE oid = ? AND cree > ?").bind(moi.oid, iso(maintenant - 3600000)).first();
      if (n && n.n >= AIDE_LIMITE_HEURE) return repondre({ ok: false, code: "trop_de_demandes", erreur: "Trop de demandes en une heure." }, 429);
      const d = { cree: iso(maintenant), oid: moi.oid, nom: moi.nom, adresse: moi.adresse, type, statut: "nouvelle",
        ecran: ligneCourte(c.ecran, 120), version: ligneCourte(c.version, 20), appareil: ligneCourte(c.appareil, 120) };
      const r = await db.prepare("INSERT INTO demandes(cree, oid, nom, adresse, type, statut, ecran, version, appareil, lu_par_demandeur) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1) RETURNING id")
        .bind(d.cree, d.oid, d.nom, d.adresse, d.type, d.statut, d.ecran, d.version, d.appareil).first();
      d.id = r.id;
      await db.prepare("INSERT INTO messages(demande_id, cree, auteur, texte, origine) VALUES (?, ?, 'client', ?, 'appli')").bind(d.id, d.cree, texte).run();
      const mailEnvoye = await essayerMail(env, d, texte, true);
      return repondre({ ok: true, id: d.id, statut: d.statut, mailEnvoye }, 201);
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
      return repondre({ prestataire, demandes: (r.results || []).map((x) => vueDemande(x, moi, prestataire)) }, 200);
    }

    const id = segments[0] && /^\d{1,9}$/.test(segments[0]) ? Number(segments[0]) : null;
    if (id == null) return repondre({ ok: false, erreur: "Introuvable." }, 404);
    const d = await demandeAccessible(db, id, moi, prestataire);
    if (!d) return repondre({ ok: false, code: "introuvable", erreur: "Demande introuvable." }, 404);
    const proprietaire = d.oid === moi.oid;

    if (segments.length === 1 && m === "GET") {
      const msgs = await db.prepare("SELECT id, cree, auteur, texte, origine FROM messages WHERE demande_id = ? ORDER BY id").bind(id).all();
      const nonLu = proprietaire && d.lu_par_demandeur === 0;
      if (nonLu) await db.prepare("UPDATE demandes SET lu_par_demandeur = 1 WHERE id = ?").bind(id).run();
      return repondre({ prestataire, demande: { ...vueDemande(d, moi, prestataire), nonLu: false }, messages: msgs.results || [] }, 200);
    }

    if (segments.length === 2 && segments[1] === "messages" && m === "POST") {
      const c = await lireCorps(req);
      const texte = texteBrut(c.texte);
      if (!texte) return repondre({ ok: false, code: "message_vide", erreur: "Le message est vide." }, 400);
      if (texte.length > AIDE_MAX) return repondre({ ok: false, code: "message_trop_long", erreur: "4000 caractères au plus." }, 400);
      const maintenant = Date.now();
      const auteur = prestataire ? "prestataire" : "client";
      if (auteur === "client") {
        const n = await db.prepare("SELECT COUNT(*) AS n FROM messages m JOIN demandes d ON d.id = m.demande_id WHERE d.oid = ? AND m.auteur = 'client' AND m.cree > ?").bind(moi.oid, iso(maintenant - 3600000)).first();
        if (n && n.n >= AIDE_MESSAGES_HEURE) return repondre({ ok: false, code: "trop_de_messages", erreur: "Trop de messages en une heure." }, 429);
      }
      await db.prepare("INSERT INTO messages(demande_id, cree, auteur, texte, origine) VALUES (?, ?, ?, ?, 'appli')").bind(id, iso(maintenant), auteur, texte).run();
      let mailEnvoye = null;
      if (auteur === "client") {
        await db.prepare("UPDATE demandes SET statut = 'nouvelle' WHERE id = ?").bind(id).run();
        mailEnvoye = await essayerMail(env, d, texte, false);
      } else {
        await db.prepare("UPDATE demandes SET statut = 'repondue', lu_par_demandeur = 0 WHERE id = ?").bind(id).run();
      }
      return repondre({ ok: true, statut: auteur === "client" ? "nouvelle" : "repondue", mailEnvoye }, 201);
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
/** Partie texte d'un mail brut (chaîne « binaire », 1 caractère = 1 octet) : text/plain d'abord, sinon HTML sans balises. */
export function partieTexte(binaire, profondeur = 0) {
  const { entetes, corps } = separer(binaire);
  const type = (entetes["content-type"] || "text/plain").toLowerCase();
  if (/^multipart\//.test(type) && profondeur < 5) {
    const borne = parametre(entetes["content-type"], "boundary");
    if (!borne) return null;
    const morceaux = corps.split("--" + borne).slice(1);
    const parties = [];
    for (const p of morceaux) { if (/^--/.test(p)) break; parties.push(p.replace(/^\r?\n/, "")); }
    let html = null;
    for (const p of parties) {
      const t = partieTexte(p, profondeur + 1);
      if (t && t.type === "text/plain") return t;
      if (t && !html) html = t;
    }
    return html;
  }
  if (/attachment/i.test(entetes["content-disposition"] || "")) return null;
  if (!/^text\/(plain|html)/.test(type)) return null;
  const cte = (entetes["content-transfer-encoding"] || "7bit").toLowerCase();
  let octets;
  if (cte === "base64") { try { octets = octetsDe(atob(corps.replace(/[^A-Za-z0-9+/=]/g, ""))); } catch { return null; } }
  else if (cte === "quoted-printable") octets = octetsDe(quotedPrintable(corps));
  else octets = octetsDe(corps);
  let texte = decoderCharset(octets, parametre(entetes["content-type"], "charset"));
  if (/^text\/html/.test(type)) {
    texte = decoder(texte.replace(/<(style|script)[\s\S]*?<\/\1>/gi, "").replace(/<blockquote[\s\S]*$/i, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div)>/gi, "\n").replace(/<[^>]+>/g, ""));
    return { type: "text/html", texte };
  }
  return { type: "text/plain", texte };
}
/** Retire la citation et la signature d'une réponse (Gmail, Apple Mail, Outlook, français ou anglais). */
export function sansCitation(texte) {
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
  return texteBrut(l.slice(0, fin).filter((y) => !/^\s*>/.test(y)).join("\n"), AIDE_MAX);
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
  const partie = partieTexte(binaire);
  const texte = sansCitation(partie ? partie.texte : "");
  if (!texte) return message.setReject("Réponse vide");
  await db.prepare("INSERT INTO messages(demande_id, cree, auteur, texte, origine) VALUES (?, ?, 'prestataire', ?, 'mail')").bind(id, iso(Date.now()), texte).run();
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
