/**
 * belfort-api — service Cloudflare Worker du site belfort-systems.fr.
 *
 * Sans aucune dépendance : routeur maison, D1 (base « belfort-systems »), KV
 * (sessions, limitation de débit, cache). Contrat : docs/TABLEAU-DE-BORD.md.
 *
 * Conventions :
 *  - réponses JSON `{ok:true, ...}` ou `{ok:false, erreur:"phrase en français"}` ;
 *  - toute écriture passe par `journaliser()` (piste d'audit, table `journal`) ;
 *  - trois niveaux d'accès : public, admin (session KV), client (jeton haché).
 */

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const TAILLE_MAX_CORPS = 32 * 1024;          // 32 Ko par corps de requête
const PBKDF2_ITERATIONS = 100_000;           // PBKDF2-SHA256 (contrat §2)
const SESSION_TTL_S = 12 * 3600;             // 12 h
const LOGIN_MAX = 5;                         // tentatives par IP…
const LOGIN_FENETRE_S = 15 * 60;             // …et par 15 min
const CONTACT_MAX = 10;                      // envois par IP…
const CONTACT_FENETRE_S = 3600;              // …et par heure
const CONTACT_DELAI_MIN_MS = 3000;           // délai minimal affichage → envoi
const SSE_DUREE_MAX_MS = 25 * 60 * 1000;     // 25 min par connexion SSE
const SSE_INTERVALLE_MS = 3000;              // relecture du journal toutes les 3 s
const CATALOGUE_URL = "https://belfort-systems.fr/assets/catalogue.json";
const CATALOGUE_CACHE_S = 600;               // 10 min
const ECHEANCE_JOURS = 30;                   // échéance par défaut d'une facture

const STATUTS_DEMANDE = ["nouveau", "lu", "en_cours", "repondu", "traite", "abandonne", "partiel"];
const TARIFS = ["forfait", "extra", "offert", "devis"];
const TYPES_EVENEMENT = ["echange", "livrable", "site", "decision", "facture"];
const STATUTS_CONTACT = ["nouveau", "lu", "repondu", "archive"];
const STATUTS_PROJET = ["nouveau", "en_cours", "termine", "en_pause", "proposition"];
const STATUTS_RDV = ["propose", "confirme", "annule"];
const CANAUX = ["Mail", "WhatsApp", "SMS", "Téléphone", "Sur place", "Teams", "Word", "Guide", "Portail"];
const FORMULES = ["forfait", "heure", "abonnement", "devis", "autre"];

// Créneaux d'une heure proposés les jours ouvrés (heure de Paris).
// Créneaux d'une heure proposés au public : 9 h – 12 h et 14 h – 17 h, du lundi au vendredi.
const HEURES_CRENEAUX = [9, 10, 11, 14, 15, 16];

// ---------------------------------------------------------------------------
// Erreurs HTTP
// ---------------------------------------------------------------------------

/** Erreur métier portant un code HTTP ; convertie en `{ok:false, erreur}`. */
class ErreurHttp extends Error {
  constructor(code, message, extra) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}
const err400 = (m) => new ErreurHttp(400, m);
const err401 = (m = "Authentification requise.") => new ErreurHttp(401, m);
const err404 = (m = "Introuvable.") => new ErreurHttp(404, m);
const err409 = (m) => new ErreurHttp(409, m);

// ---------------------------------------------------------------------------
// Outils génériques
// ---------------------------------------------------------------------------

const enc = new TextEncoder();

/** Date-heure ISO courante (UTC). */
const maintenant = () => new Date().toISOString();

/** Date du jour AAAA-MM-JJ (heure de Paris). */
function aujourdhui() {
  return dateParis(new Date()).date;
}

/** Décompose un instant en date/heure locales de Paris. */
function dateParis(d) {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  const heure = parts.hour === "24" ? "00" : parts.hour;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, heure: `${heure}:${parts.minute}` };
}

/** Ajoute `jours` jours à une date AAAA-MM-JJ. */
function ajouterJours(dateIso, jours) {
  const d = new Date(dateIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

/** Encodage base64url d'un tableau d'octets. */
function base64url(octets) {
  let s = "";
  for (const o of octets) s += String.fromCharCode(o);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Hexadécimal d'un tableau d'octets. */
function hex(octets) {
  return [...octets].map((o) => o.toString(16).padStart(2, "0")).join("");
}

/** Identifiant court aléatoire (12 caractères base64url, 72 bits). */
function nouvelId() {
  return base64url(crypto.getRandomValues(new Uint8Array(9)));
}

/** Jeton aléatoire de 32 octets en base64url (sessions, jetons clients). */
function nouveauJeton() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** SHA-256 hexadécimal d'une chaîne. */
async function sha256(texte) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(texte))));
}

/**
 * PBKDF2-SHA256 (100 000 itérations) d'un mot de passe avec un sel ; renvoie les
 * 32 octets dérivés. Le sel est dérivé du secret SESSION_SALT ou, à défaut, du
 * mot de passe admin lui-même (contrat §2).
 */
async function pbkdf2(motDePasse, sel, iterations = PBKDF2_ITERATIONS) {
  const cle = await crypto.subtle.importKey("raw", enc.encode(motDePasse), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(sel), iterations }, cle, 256);
  return new Uint8Array(bits);
}

/** Comparaison à temps constant de deux tableaux d'octets. */
function egalConstant(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Empreinte dérivée du mot de passe admin attendu (mise en cache par isolat). */
let empreinteAdmin = null;
async function empreinteAttendue(env) {
  if (!empreinteAdmin) {
    if (!env.ADMIN_PASSWORD) throw new ErreurHttp(503, "Le secret ADMIN_PASSWORD n'est pas configuré.");
    empreinteAdmin = await pbkdf2(env.ADMIN_PASSWORD, selSession(env));
  }
  return empreinteAdmin;
}

/** Sel fixe par déploiement. */
function selSession(env) {
  return "belfort-api:" + (env.SESSION_SALT || env.ADMIN_PASSWORD || "");
}

/** Adresse IP du client (Cloudflare) ou repli local. */
function ipDe(req) {
  return req.headers.get("CF-Connecting-IP") || req.headers.get("X-Forwarded-For")?.split(",")[0].trim() || "local";
}

// ---------------------------------------------------------------------------
// Validation des entrées
// ---------------------------------------------------------------------------

const RE_EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_DATE_HEURE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const RE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RE_SEMAINE = /^(\d{4})-W(\d{2})$/;

/**
 * Lit et valide un champ d'un objet.
 * options : {requis, max, min, enum, type:"texte"|"entier"|"nombre"|"booleen"|"email"|"date"|"dateheure"|"id"|"tableau", defaut}
 * Renvoie la valeur nettoyée (texte rogné) ou `undefined` si absent et non requis.
 */
function champ(obj, nom, options = {}) {
  const { requis = false, max = 4000, min = 0, type = "texte", defaut } = options;
  let v = obj?.[nom];
  if (v === undefined || v === null || v === "") {
    if (requis) throw err400(`Le champ « ${nom} » est obligatoire.`);
    return defaut;
  }
  switch (type) {
    case "texte":
    case "email":
    case "date":
    case "dateheure":
    case "id":
      if (typeof v !== "string") throw err400(`Le champ « ${nom} » doit être un texte.`);
      v = v.trim();
      if (v.length > max) throw err400(`Le champ « ${nom} » dépasse ${max} caractères.`);
      if (v.length < min) throw err400(`Le champ « ${nom} » est trop court.`);
      if (type === "email" && !RE_EMAIL.test(v)) throw err400("L'adresse e-mail n'est pas valide.");
      if (type === "date" && !RE_DATE.test(v)) throw err400(`Le champ « ${nom} » doit être une date AAAA-MM-JJ.`);
      if (type === "dateheure" && !RE_DATE_HEURE.test(v)) throw err400(`Le champ « ${nom} » doit être au format AAAA-MM-JJTHH:MM.`);
      if (type === "id" && !RE_ID.test(v)) throw err400(`Le champ « ${nom} » n'est pas un identifiant valide.`);
      if (v === "" && requis) throw err400(`Le champ « ${nom} » est obligatoire.`);
      break;
    case "entier":
      if (typeof v === "string" && /^-?\d+$/.test(v)) v = Number(v);
      if (!Number.isInteger(v)) throw err400(`Le champ « ${nom} » doit être un entier.`);
      break;
    case "nombre":
      if (typeof v === "string" && v.trim() !== "") v = Number(v.replace(",", "."));
      if (typeof v !== "number" || !Number.isFinite(v)) throw err400(`Le champ « ${nom} » doit être un nombre.`);
      break;
    case "booleen":
      if (v === "true" || v === 1 || v === "1") v = true;
      if (v === "false" || v === 0 || v === "0") v = false;
      if (typeof v !== "boolean") throw err400(`Le champ « ${nom} » doit être vrai ou faux.`);
      break;
    case "tableau":
      if (!Array.isArray(v)) throw err400(`Le champ « ${nom} » doit être une liste.`);
      if (v.length > max) throw err400(`Le champ « ${nom} » contient trop d'éléments.`);
      break;
    default:
      throw new Error("type de champ inconnu : " + type);
  }
  if (options.enum && !options.enum.includes(v)) {
    throw err400(`Le champ « ${nom} » doit valoir l'une des valeurs : ${options.enum.join(", ")}.`);
  }
  return v;
}

/**
 * Valide les lignes d'une facture : [{ref, designation, quantite, unite, prix}]
 * (forme du panneau ; `prix_unitaire` accepté comme synonyme de `prix`).
 * Renvoie {lignes, total_ht}. Les montants sont arrondis au centime.
 */
function validerLignes(brut) {
  if (!Array.isArray(brut)) throw err400("Les lignes de la facture doivent être une liste.");
  if (brut.length > 100) throw err400("Une facture ne peut pas dépasser 100 lignes.");
  const lignes = brut.map((l, i) => {
    if (!l || typeof l !== "object") throw err400(`La ligne ${i + 1} est invalide.`);
    const ref = champ(l, "ref", { max: 60, defaut: "" });
    const designation = champ(l, "designation", { requis: true, max: 500 });
    const quantite = champ(l, "quantite", { type: "nombre", defaut: 1 });
    const prix = l.prix !== undefined ? champ(l, "prix", { type: "nombre", requis: true }) : champ(l, "prix_unitaire", { type: "nombre", requis: true });
    const unite = champ(l, "unite", { max: 20, defaut: "" });
    const total = Math.round(quantite * prix * 100) / 100;
    return { ref, designation, quantite, unite, prix, total };
  });
  const total_ht = Math.round(lignes.reduce((s, l) => s + l.total, 0) * 100) / 100;
  return { lignes, total_ht };
}

// ---------------------------------------------------------------------------
// Réponses HTTP et CORS
// ---------------------------------------------------------------------------

const EN_TETES_BASE = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

/** L'origine est-elle autorisée (liste ORIGINES + localhost en dev) ? */
function origineAutorisee(origine, env) {
  if (!origine) return false;
  const liste = String(env.ORIGINES || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (liste.includes(origine)) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origine);
}

/** En-têtes CORS pour la requête (vides si l'origine n'est pas autorisée). */
function enTetesCors(req, env) {
  const origine = req.headers.get("Origin");
  if (!origineAutorisee(origine, env)) return {};
  return {
    "Access-Control-Allow-Origin": origine,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

/** Réponse JSON standard. */
function json(corps, code = 200, enTetes = {}) {
  return new Response(JSON.stringify(corps), { status: code, headers: { ...EN_TETES_BASE, ...enTetes } });
}

/**
 * Lit le corps JSON d'une requête (32 Ko max). Renvoie {} si vide.
 */
async function lireCorps(req) {
  const longueur = Number(req.headers.get("Content-Length") || 0);
  if (longueur > TAILLE_MAX_CORPS) throw new ErreurHttp(413, "Le corps de la requête dépasse 32 Ko.");
  const texte = await req.text();
  if (texte.length > TAILLE_MAX_CORPS) throw new ErreurHttp(413, "Le corps de la requête dépasse 32 Ko.");
  if (!texte.trim()) return {};
  try {
    const v = JSON.parse(texte);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw err400("Le corps de la requête doit être un objet JSON.");
  }
}

// ---------------------------------------------------------------------------
// Limitation de débit (KV)
// ---------------------------------------------------------------------------

/**
 * Compte une tentative pour `cle` ; lève 429 si `max` est dépassé dans la fenêtre.
 * (KV étant à cohérence différée, la limite est indicative mais suffisante.)
 */
async function limiter(env, cle, max, fenetreS, { compterSeulementSi = true } = {}) {
  const brut = await env.KV.get(cle, "json");
  const nowS = Math.floor(Date.now() / 1000);
  let etat = brut && brut.exp > nowS ? brut : { n: 0, exp: nowS + fenetreS };
  if (etat.n >= max) {
    const attente = Math.max(1, etat.exp - nowS);
    throw new ErreurHttp(429, `Trop de tentatives. Réessayez dans ${Math.ceil(attente / 60)} min.`, { "Retry-After": String(attente) });
  }
  if (compterSeulementSi) {
    etat.n += 1;
    await env.KV.put(cle, JSON.stringify(etat), { expirationTtl: Math.max(60, etat.exp - nowS) });
  }
  return etat;
}

// ---------------------------------------------------------------------------
// Authentification
// ---------------------------------------------------------------------------

/** Jeton Bearer de la requête (ou paramètre `t` / `jeton` pour EventSource). */
function jetonDe(req, url) {
  const auth = req.headers.get("Authorization") || "";
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(auth);
  if (m) return m[1];
  const q = url?.searchParams.get("t") || url?.searchParams.get("jeton");
  return q && /^[A-Za-z0-9_-]{20,200}$/.test(q) ? q : null;
}

/** Vérifie la session admin (KV `s:<jeton>`) ; renvoie {jeton, session}. */
async function exigerAdmin(req, env, url) {
  const jeton = jetonDe(req, url);
  if (!jeton) throw err401();
  const session = await env.KV.get("s:" + jeton, "json");
  if (!session || session.role !== "admin" || session.exp < Date.now()) throw err401("Session expirée ou invalide.");
  return { jeton, session };
}

/** Vérifie un jeton client (haché SHA-256 dans D1) ; renvoie le client. */
async function exigerClient(req, env, url) {
  const jeton = jetonDe(req, url);
  if (!jeton) throw err401();
  const h = await sha256(jeton);
  const client = await env.DB.prepare("SELECT id, slug, nom, contact, email, cree FROM clients WHERE token_hash = ?").bind(h).first();
  if (!client) throw err401("Jeton client invalide.");
  return client;
}

// ---------------------------------------------------------------------------
// Journal d'audit
// ---------------------------------------------------------------------------

/** Instruction préparée d'insertion dans le journal (à inclure dans un batch). */
function stmtJournal(env, qui, action, table, id) {
  return env.DB.prepare("INSERT INTO journal (quand, qui, action, cible) VALUES (?, ?, ?, ?)")
    .bind(maintenant(), qui, action, `${table}:${id}`);
}

/** Journalise immédiatement une écriture. */
async function journaliser(env, qui, action, table, id) {
  await stmtJournal(env, qui, action, table, id).run();
}

// ---------------------------------------------------------------------------
// Routeur maison
// ---------------------------------------------------------------------------

const routes = [];

/**
 * Déclare une route. `motif` : chemin avec paramètres `:nom`.
 * `acces` : "public" | "admin" | "client".
 */
function route(methode, motif, acces, handler) {
  const noms = [];
  const re = new RegExp("^" + motif.replace(/\//g, "\\/").replace(/:(\w+)/g, (_, n) => (noms.push(n), "([A-Za-z0-9_-]+)")) + "\\/?$");
  routes.push({ methode, re, noms, acces, handler });
}

/** Trouve la route correspondante ; renvoie {route, params} ou null, et si le chemin existe pour une autre méthode. */
function resoudre(methode, chemin) {
  let cheminConnu = false;
  for (const r of routes) {
    const m = r.re.exec(chemin);
    if (!m) continue;
    cheminConnu = true;
    if (r.methode !== methode) continue;
    const params = {};
    r.noms.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
    return { route: r, params, cheminConnu };
  }
  return { route: null, params: {}, cheminConnu };
}

// ---------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const cors = enTetesCors(req, env);

    // Pré-vol CORS : réponse vide, uniquement si l'origine est autorisée.
    if (req.method === "OPTIONS") {
      const origine = req.headers.get("Origin");
      if (origine && !origineAutorisee(origine, env)) return json({ ok: false, erreur: "Origine non autorisée." }, 403);
      return new Response(null, { status: 204, headers: { ...cors, "Cache-Control": "no-store" } });
    }

    // Une requête de navigateur venant d'une origine inconnue est refusée.
    const origine = req.headers.get("Origin");
    if (origine && !origineAutorisee(origine, env)) {
      return json({ ok: false, erreur: "Origine non autorisée." }, 403);
    }

    try {
      const { route: r, params, cheminConnu } = resoudre(req.method, url.pathname);
      if (!r) {
        if (cheminConnu) return json({ ok: false, erreur: "Méthode non autorisée." }, 405, cors);
        return json({ ok: false, erreur: "Route inconnue." }, 404, cors);
      }

      const contexte = { req, env, ctx, url, params, cors, ip: ipDe(req) };
      if (r.acces === "admin") {
        const { jeton, session } = await exigerAdmin(req, env, url);
        contexte.jeton = jeton;
        contexte.session = session;
        contexte.qui = "admin";
      } else if (r.acces === "client") {
        contexte.client = await exigerClient(req, env, url);
        contexte.qui = "client:" + contexte.client.slug;
      }

      const resultat = await r.handler(contexte);
      if (resultat instanceof Response) {
        // Réponses spéciales (SSE) : on ajoute juste les en-têtes CORS.
        for (const [k, v] of Object.entries(cors)) resultat.headers.set(k, v);
        return resultat;
      }
      return json({ ok: true, ...resultat }, 200, cors);
    } catch (e) {
      if (e instanceof ErreurHttp) {
        return json({ ok: false, erreur: e.message }, e.code, { ...cors, ...(e.extra || {}) });
      }
      console.error("Erreur interne :", e && e.stack || e);
      return json({ ok: false, erreur: "Erreur interne du service." }, 500, cors);
    }
  },
};

// ---------------------------------------------------------------------------
// Routes publiques
// ---------------------------------------------------------------------------

route("GET", "/", "public", async () => ({ service: "belfort-api", version: 1 }));

// ---------------------------------------------------------------------------
// Espace Breteuil : planning partagé (calendrier « Contact » publié en ICS)
// ---------------------------------------------------------------------------

/** Durée de fraîcheur du planning en cache (10 min). */
const PLANNING_TTL_S = 600;
/** Taille maximale acceptée pour l'ICS distant (5 Mo). */
const PLANNING_MAX_OCTETS = 5 * 1024 * 1024;
/** Préfixe des clés KV de la dernière version reçue (une par source). */
const PLANNING_CLE_KV = "breteuil:planning";
/** Nombre maximal de calendriers relayés (BRETEUIL_ICS_URL, BRETEUIL_ICS_URL_2 … _4). */
const PLANNING_MAX_SOURCES = 4;

/** Nom du secret de la source n : 1 → BRETEUIL_ICS_URL, n ≥ 2 → BRETEUIL_ICS_URL_n. */
function secretPlanning(n) {
  return n === 1 ? "BRETEUIL_ICS_URL" : `BRETEUIL_ICS_URL_${n}`;
}

/** URL ICS de la source n, normalisée (webcal:// → https://) ; null si absente ou invalide. */
function urlPlanning(env, n = 1) {
  const brute = String(env[secretPlanning(n)] || "").trim();
  if (!brute) return null;
  const u = brute.replace(/^webcals?:\/\//i, "https://");
  try {
    const x = new URL(u);
    return x.protocol === "https:" ? x.toString() : null;
  } catch {
    return null;
  }
}

/** Le texte ressemble-t-il à un calendrier ICS ? */
function estUnIcs(texte) {
  return /^\s*BEGIN:VCALENDAR/i.test(texte || "") && /END:VCALENDAR\s*$/i.test(texte || "");
}

/** Réponse text/calendar avec l'état du cache (frais / source / ancien). */
function reponsePlanning(texte, etat, quand) {
  return new Response(texte, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": `public, max-age=${PLANNING_TTL_S}`,
      "X-Content-Type-Options": "nosniff",
      "X-Planning-Etat": etat,
      "X-Planning-Date": new Date(quand).toISOString(),
      "Access-Control-Expose-Headers": "X-Planning-Etat, X-Planning-Date",
    },
  });
}

/** Origine obligatoire et autorisée (le relais ne sert que les pages du site). */
function exigerOriginePlanning(req, env) {
  if (!origineAutorisee(req.headers.get("Origin"), env)) {
    throw new ErreurHttp(403, "Planning réservé à l'Espace Breteuil (belfort-systems.fr).");
  }
}

/**
 * Relais d'une source ICS (Outlook « Publier un calendrier » ou adresse secrète
 * Google Agenda). Les adresses restent des secrets du Worker, jamais dans le dépôt.
 * Cache KV de 10 min ; si la source échoue, la dernière version connue est servie.
 */
async function relaisPlanning(env, n) {
  const source = urlPlanning(env, n);
  if (!source) {
    return json({ ok: false, code: "non_configure", erreur: `Calendrier ${n} non configuré (secret ${secretPlanning(n)} absent).` }, 503);
  }
  const cle = n === 1 ? PLANNING_CLE_KV : `${PLANNING_CLE_KV}:${n}`;
  const cache = env.KV ? await env.KV.get(cle, "json") : null;
  if (cache && cache.texte && Date.now() - cache.quand < PLANNING_TTL_S * 1000) {
    return reponsePlanning(cache.texte, "cache", cache.quand);
  }

  try {
    const r = await fetch(source, {
      headers: { "Accept": "text/calendar, text/plain;q=0.8, */*;q=0.1", "User-Agent": "belfort-api (Espace Breteuil)" },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`source HTTP ${r.status}`);
    const texte = await r.text();
    if (texte.length > PLANNING_MAX_OCTETS) throw new Error("source trop volumineuse");
    if (!estUnIcs(texte)) throw new Error("la source n'est pas un calendrier ICS");
    const quand = Date.now();
    if (env.KV) await env.KV.put(cle, JSON.stringify({ texte, quand }));
    return reponsePlanning(texte, "source", quand);
  } catch (e) {
    console.error(`Planning Breteuil (source ${n}) :`, e && e.message);
    if (cache && cache.texte) return reponsePlanning(cache.texte, "ancien", cache.quand);
    return json({ ok: false, code: "source_indisponible", erreur: "Le calendrier du Château ne répond pas pour le moment." }, 502);
  }
}

/** GET /breteuil/planning.ics — première source (compatibilité V1). */
route("GET", "/breteuil/planning.ics", "public", async ({ req, env }) => {
  exigerOriginePlanning(req, env);
  return relaisPlanning(env, 1);
});

/** GET /breteuil/planning/:n.ics — source n (1 à 4), chacune avec son secret. */
route("GET", "/breteuil/planning/:n.ics", "public", async ({ req, env, params }) => {
  exigerOriginePlanning(req, env);
  const n = Number(params.n);
  if (!Number.isInteger(n) || n < 1 || n > PLANNING_MAX_SOURCES) throw new ErreurHttp(404, "Calendrier inconnu.");
  return relaisPlanning(env, n);
});

/** GET /breteuil/sources — numéros des calendriers configurés (jamais leurs adresses). */
route("GET", "/breteuil/sources", "public", async ({ req, env }) => {
  exigerOriginePlanning(req, env);
  const sources = [];
  for (let n = 1; n <= PLANNING_MAX_SOURCES; n++) if (urlPlanning(env, n)) sources.push(n);
  return { sources };
});

/**
 * POST /contact — formulaire public.
 * Pot-de-miel `website` (doit rester vide) et délai minimal 3 s (`t` = horodatage
 * d'affichage en ms) : en cas de robot détecté, réponse 200 silencieuse sans insertion.
 */
route("POST", "/contact", "public", async ({ req, env, ip }) => {
  const corps = await lireCorps(req);

  // Robots : on répond « ok » sans rien enregistrer, pour ne pas les renseigner.
  const potDeMiel = typeof corps.website === "string" && corps.website.trim() !== "";
  const t = Number(corps.t);
  const tropRapide = !Number.isFinite(t) || t <= 0 || Date.now() - t < CONTACT_DELAI_MIN_MS;
  if (potDeMiel || tropRapide) return {};

  await limiter(env, "rl:contact:" + ip, CONTACT_MAX, CONTACT_FENETRE_S);

  const nom = champ(corps, "nom", { requis: true, max: 200, min: 2 });
  const email = champ(corps, "email", { requis: true, type: "email", max: 320 });
  const tel = champ(corps, "tel", { max: 40 });
  const sujet = champ(corps, "sujet", { max: 200 });
  const message = champ(corps, "message", { requis: true, max: 4000, min: 2 });
  const formule = champ(corps, "formule", { max: 300 });
  const creneau = champ(corps, "creneau", { type: "dateheure" });

  const id = nouvelId();
  const quand = maintenant();
  const ipHash = await sha256(ip + "|" + selSession(env));
  const stmts = [
    env.DB.prepare(`INSERT INTO contacts (id, nom, email, tel, sujet, message, formule, creneau, statut, ip_hash, cree)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'nouveau', ?, ?)`)
      .bind(id, nom, email, tel ?? null, sujet ?? null, message, formule ?? null, creneau ?? null, ipHash, quand),
    stmtJournal(env, "public", "creer", "contacts", id),
  ];
  if (creneau) {
    // Un créneau demandé devient un rdv « propose » d'une heure, à confirmer par l'admin.
    const rdvId = nouvelId();
    stmts.push(env.DB.prepare(`INSERT INTO rdv (id, contact_id, debut, fin, statut, note) VALUES (?, ?, ?, ?, 'propose', ?)`)
      .bind(rdvId, id, creneau, finDeCreneau(creneau), "Demandé depuis le site"));
    stmts.push(stmtJournal(env, "public", "creer", "rdv", rdvId));
  }
  await env.DB.batch(stmts);
  return {};
});

/** Fin d'un créneau d'une heure (AAAA-MM-JJTHH:MM → +1 h). */
function finDeCreneau(debut) {
  const [date, heure] = debut.split("T");
  const h = Number(heure.slice(0, 2)) + 1;
  if (h >= 24) return ajouterJours(date, 1) + "T00:" + heure.slice(3);
  return `${date}T${String(h).padStart(2, "0")}:${heure.slice(3)}`;
}

/** Lundi (AAAA-MM-JJ) d'une semaine ISO AAAA-WW. */
function lundiDeSemaine(annee, semaine) {
  // Le 4 janvier est toujours dans la semaine 1.
  const j4 = new Date(Date.UTC(annee, 0, 4));
  const jour = j4.getUTCDay() || 7;
  const lundi1 = new Date(j4);
  lundi1.setUTCDate(j4.getUTCDate() - jour + 1);
  lundi1.setUTCDate(lundi1.getUTCDate() + (semaine - 1) * 7);
  return lundi1.toISOString().slice(0, 10);
}

/** Semaine ISO courante « AAAA-WW » (heure de Paris). */
function semaineCourante() {
  const d = new Date(aujourdhui() + "T00:00:00Z");
  const jour = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - jour);
  const annee = d.getUTCFullYear();
  const debut = new Date(Date.UTC(annee, 0, 1));
  const semaine = Math.ceil(((d - debut) / 86400000 + 1) / 7);
  return `${annee}-W${String(semaine).padStart(2, "0")}`;
}

/**
 * GET /disponibilites?semaine=AAAA-WW — créneaux libres d'une heure, jours ouvrés
 * 9-12 h et 14-18 h, moins les rdv confirmés et les créneaux passés.
 */
route("GET", "/disponibilites", "public", async ({ env, url }) => {
  const semaine = url.searchParams.get("semaine") || semaineCourante();
  const m = RE_SEMAINE.exec(semaine);
  if (!m) throw err400("Le paramètre « semaine » doit être au format AAAA-WW.");
  const annee = Number(m[1]), num = Number(m[2]);
  if (num < 1 || num > 53 || annee < 2020 || annee > 2100) throw err400("Semaine hors limites.");
  const lundi = lundiDeSemaine(annee, num);
  const dimanche = ajouterJours(lundi, 6);

  const { results: pris } = await env.DB.prepare(
    "SELECT debut, fin FROM rdv WHERE statut = 'confirme' AND debut < ? AND fin > ?")
    .bind(dimanche + "T23:59", lundi + "T00:00").all();

  const { date: dateNow, heure: heureNow } = dateParis(new Date());
  const now = `${dateNow}T${heureNow}`;
  const creneaux = [];
  for (let j = 0; j < 5; j++) {               // lundi → vendredi
    const date = ajouterJours(lundi, j);
    for (const h of HEURES_CRENEAUX) {
      const debut = `${date}T${String(h).padStart(2, "0")}:00`;
      const fin = finDeCreneau(debut);
      if (debut <= now) continue;             // créneau passé
      if (pris.some((r) => r.debut < fin && r.fin > debut)) continue; // chevauche un rdv confirmé
      creneaux.push({ debut, fin });
    }
  }
  return { semaine, lundi, creneaux };
});

/** GET /catalogue — relais du catalogue statique, mis en cache 10 min dans KV. */
route("GET", "/catalogue", "public", async ({ env }) => {
  const cache = await env.KV.get("cache:catalogue", "json");
  if (cache) return { catalogue: cache, cache: true };
  let rep;
  try {
    rep = await fetch(CATALOGUE_URL, { headers: { Accept: "application/json" } });
  } catch {
    throw new ErreurHttp(502, "Catalogue injoignable.");
  }
  if (!rep.ok) throw new ErreurHttp(502, "Catalogue injoignable.");
  const catalogue = await rep.json();
  await env.KV.put("cache:catalogue", JSON.stringify(catalogue), { expirationTtl: CATALOGUE_CACHE_S });
  return { catalogue, cache: false };
});

// ---------------------------------------------------------------------------
// Admin : session
// ---------------------------------------------------------------------------

/** POST /admin/login {password} → {token, exp}. 5 essais par IP et par 15 min. */
route("POST", "/admin/login", "public", async ({ req, env, ip }) => {
  const cleLimite = "rl:login:" + ip;
  await limiter(env, cleLimite, LOGIN_MAX, LOGIN_FENETRE_S);
  const corps = await lireCorps(req);
  const password = champ(corps, "password", { requis: true, max: 1024 });

  const attendu = await empreinteAttendue(env);
  const fourni = await pbkdf2(password, selSession(env));
  if (!egalConstant(attendu, fourni)) throw err401("Mot de passe incorrect.");

  const token = nouveauJeton();
  const exp = Date.now() + SESSION_TTL_S * 1000;
  await env.KV.put("s:" + token, JSON.stringify({ role: "admin", exp }), { expirationTtl: SESSION_TTL_S });
  await env.KV.delete(cleLimite);              // connexion réussie : compteur remis à zéro
  await journaliser(env, "admin", "connexion", "session", token.slice(0, 6) + "…");
  return { token, exp };
});

/** POST /admin/logout — supprime la session. */
route("POST", "/admin/logout", "admin", async ({ env, jeton }) => {
  await env.KV.delete("s:" + jeton);
  return {};
});

// ---------------------------------------------------------------------------
// Admin : résumé, contacts, journal, flux
// ---------------------------------------------------------------------------

/**
 * GET /admin/resume — compteurs du tableau de bord :
 * {contacts_nouveaux, demandes_a_traiter, factures_en_attente, prochain_rdv:{debut,fin,avec,statut}, dernier_evenement:{date,titre}}
 */
route("GET", "/admin/resume", "admin", async ({ env }) => {
  const { date: dateNow, heure: heureNow } = dateParis(new Date());
  const now = `${dateNow}T${heureNow}`;
  const [contacts, demandes, factures, rdvs, prochain, dernier] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n FROM contacts WHERE statut = 'nouveau'"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM demandes WHERE statut IN ('nouveau', 'lu', 'en_cours', 'partiel')"),
    env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total_ht), 0) AS total FROM factures WHERE statut = 'envoyee'"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM rdv WHERE statut = 'propose'"),
    env.DB.prepare(`SELECT r.id, r.debut, r.fin, r.statut, r.note, COALESCE(c.nom, r.note, '') AS avec, r.contact_id
                    FROM rdv r LEFT JOIN contacts c ON c.id = r.contact_id
                    WHERE r.statut IN ('propose', 'confirme') AND r.fin >= ? ORDER BY r.debut LIMIT 1`).bind(now),
    env.DB.prepare("SELECT e.id, e.date, e.type, e.titre, e.projet_id FROM evenements e WHERE e.date IS NOT NULL AND e.date != '' ORDER BY e.date DESC, e.id DESC LIMIT 1"),
  ]);
  return {
    contacts_nouveaux: contacts.results[0].n,
    demandes_a_traiter: demandes.results[0].n,
    factures_en_attente: factures.results[0].n,
    montant_en_attente: factures.results[0].total,
    rdv_a_confirmer: rdvs.results[0].n,
    prochain_rdv: prochain.results[0] || null,
    dernier_evenement: dernier.results[0] || null,
    messages_nouveaux: await compterMessagesNouveaux(env),
  };
});

// ---------------------------------------------------------------------------
// Publications : demandes de fusion (PR) du dépôt GitHub du site
// ---------------------------------------------------------------------------

const GITHUB_API = "https://api.github.com";
const GITHUB_DEPOT = "Startupp/belfort-systems.fr";
const PAGES_PROJET = "belfort-systems-fr";

/** Nom de branche → sous-domaine d'aperçu Cloudflare Pages (minuscules, tout le reste en tirets). */
function brancheNormalisee(branche) {
  return String(branche || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
const urlApercuPages = (branche) => `https://${brancheNormalisee(branche)}.${PAGES_PROJET}.pages.dev`;

/** Appel à l'API GitHub avec le jeton du Worker ; renvoie {statut, corps}. */
async function appelGitHub(env, methode, chemin, corps) {
  if (!env.GITHUB_TOKEN) throw new ErreurHttp(503, "Jeton GitHub non configuré.");
  const rep = await fetch(GITHUB_API + chemin, {
    method: methode,
    headers: {
      "Authorization": "Bearer " + env.GITHUB_TOKEN,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "belfort-admin",
      ...(corps ? { "Content-Type": "application/json" } : {}),
    },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  let json = null;
  try { json = await rep.json(); } catch { json = null; }
  return { statut: rep.status, corps: json };
}

/** Forme d'une PR renvoyée au tableau de bord (rien de plus que nécessaire). */
function formerPr(p) {
  return {
    numero: p.number,
    titre: p.title,
    branche: p.head?.ref || "",
    cible: p.base?.ref || "",
    auteur: p.user?.login || "",
    brouillon: Boolean(p.draft),
    cree: p.created_at,
    maj: p.updated_at,
    url: p.html_url,
    apercu: urlApercuPages(p.head?.ref),
  };
}

/** GET /admin/publications → {configure, depot, pulls:[…]} ; sans jeton : configure:false, pulls:[]. */
route("GET", "/admin/publications", "admin", async ({ env }) => {
  if (!env.GITHUB_TOKEN) return { configure: false, depot: GITHUB_DEPOT, pulls: [] };
  const { statut, corps } = await appelGitHub(env, "GET", `/repos/${GITHUB_DEPOT}/pulls?state=open&sort=updated&direction=desc&per_page=50`);
  if (statut === 401 || statut === 403) throw new ErreurHttp(502, "GitHub refuse le jeton (droits insuffisants ou jeton expiré).");
  if (statut !== 200 || !Array.isArray(corps)) throw new ErreurHttp(502, `GitHub a répondu ${statut}.`);
  return { configure: true, depot: GITHUB_DEPOT, pulls: corps.map(formerPr) };
});

/** POST /admin/publications/:numero/fusionner → fusion (méthode merge) de la PR dans sa branche cible. */
route("POST", "/admin/publications/:numero/fusionner", "admin", async ({ env, params, qui }) => {
  const numero = Number(params.numero);
  if (!Number.isInteger(numero) || numero <= 0) throw err400("Numéro de publication invalide.");
  if (!env.GITHUB_TOKEN) throw new ErreurHttp(503, "Jeton GitHub non configuré.");
  const pr = await appelGitHub(env, "GET", `/repos/${GITHUB_DEPOT}/pulls/${numero}`);
  if (pr.statut === 404) throw err404("Publication introuvable.");
  if (pr.statut !== 200 || !pr.corps) throw new ErreurHttp(502, `GitHub a répondu ${pr.statut}.`);
  if (pr.corps.state !== "open") throw err409("Cette publication n'est plus ouverte.");
  if (pr.corps.draft) throw err409("Cette publication est encore un brouillon.");
  const r = await appelGitHub(env, "PUT", `/repos/${GITHUB_DEPOT}/pulls/${numero}/merge`, { merge_method: "merge" });
  if (r.statut === 405 || r.statut === 409) throw err409((r.corps && r.corps.message) || "Fusion impossible (conflit ou vérifications en attente).");
  if (r.statut !== 200) throw new ErreurHttp(502, (r.corps && r.corps.message) || `GitHub a répondu ${r.statut}.`);
  await journaliser(env, qui, "fusionner:" + pr.corps.head?.ref, "publications", numero);
  return { numero, fusionne: true, sha: r.corps?.sha || null, titre: pr.corps.title, branche: pr.corps.head?.ref || "" };
});

// ---------------------------------------------------------------------------
// Premier contact : messages du formulaire du site (base « belfort_contact »)
// ---------------------------------------------------------------------------

const STATUTS_MESSAGE = ["nouveau", "lu", "repondu", "classe"];
const MESSAGES_MAX = 200;

/** Lance 503 si la base du formulaire de contact n'est pas reliée (binding CONTACTS absent). */
function baseContacts(env) {
  if (!env.CONTACTS) throw new ErreurHttp(503, "Base des messages non reliée : binding CONTACTS absent (api/wrangler.toml).");
  return env.CONTACTS;
}

/** Erreur D1 « table absente » (base pas encore migrée par le Worker belfort-contact). */
const estTableAbsente = (e) => /no such table/i.test(String(e && e.message || e));

/** Nombre de messages sans suivi ou encore « nouveau » (0 si la base n'est pas reliée). */
async function compterMessagesNouveaux(env) {
  if (!env.CONTACTS) return 0;
  try {
    const [{ results: ids }, { results: suivis }] = await Promise.all([
      env.CONTACTS.prepare("SELECT id FROM contacts ORDER BY recu_le DESC LIMIT ?").bind(MESSAGES_MAX).all(),
      env.DB.prepare("SELECT contact_id FROM contacts_suivi WHERE statut != 'nouveau'").all(),
    ]);
    const traites = new Set(suivis.map((s) => s.contact_id));
    return ids.filter((c) => !traites.has(c.id)).length;
  } catch (e) {
    if (estTableAbsente(e)) return 0;
    throw e;
  }
}

/**
 * GET /admin/premier-contact → {messages:[{id, recu_le, nom, email, tel, sujet, formule, message,
 * creneau, origine, statut, note, suivi_le}]} — 200 messages au plus, plus récents d'abord.
 * Les messages sont lus dans la base belfort_contact ; le statut vient de contacts_suivi (DB).
 */
route("GET", "/admin/premier-contact", "admin", async ({ env }) => {
  const base = baseContacts(env);
  let messages = [];
  try {
    ({ results: messages } = await base.prepare(
      "SELECT id, recu_le, nom, email, tel, sujet, formule, message, creneau, origine FROM contacts ORDER BY recu_le DESC, id DESC LIMIT ?")
      .bind(MESSAGES_MAX).all());
  } catch (e) {
    if (estTableAbsente(e)) throw new ErreurHttp(503, "La base belfort_contact n'a pas encore sa table « contacts » (migrations du Worker belfort-contact).");
    throw e;
  }
  const { results: suivis } = await env.DB.prepare("SELECT contact_id, statut, note, maj FROM contacts_suivi").all();
  const suivi = new Map(suivis.map((s) => [s.contact_id, s]));
  return {
    messages: messages.map((m) => {
      const s = suivi.get(m.id);
      return { ...m, statut: s ? s.statut : "nouveau", note: s ? s.note || "" : "", suivi_le: s ? s.maj : null };
    }),
  };
});

/** PATCH /admin/premier-contact/:id {statut, note} — suivi d'un message (table contacts_suivi). */
route("PATCH", "/admin/premier-contact/:id", "admin", async ({ req, env, params, qui }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) throw err400("Identifiant de message invalide.");
  const corps = await lireCorps(req);
  const statut = champ(corps, "statut", { enum: STATUTS_MESSAGE });
  const note = champ(corps, "note", { max: 2000 });
  if (statut === undefined && note === undefined) throw err400("Indiquez un statut ou une note.");
  const base = baseContacts(env);
  const existe = await base.prepare("SELECT id FROM contacts WHERE id = ?").bind(id).first();
  if (!existe) throw err404("Message introuvable.");
  const quand = maintenant();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO contacts_suivi (contact_id, statut, note, maj) VALUES (?, COALESCE(?, 'nouveau'), ?, ?)
                    ON CONFLICT(contact_id) DO UPDATE SET
                      statut = COALESCE(?, contacts_suivi.statut),
                      note = COALESCE(?, contacts_suivi.note),
                      maj = ?`).bind(id, statut ?? null, note ?? null, quand, statut ?? null, note ?? null, quand),
    stmtJournal(env, qui, statut ? "statut:" + statut : "note", "premier-contact", id),
  ]);
  const ligne = await env.DB.prepare("SELECT contact_id AS id, statut, note, maj AS suivi_le FROM contacts_suivi WHERE contact_id = ?").bind(id).first();
  return ligne;
});

/** GET /admin/contacts?statut= — liste des contacts (200 max, plus récents d'abord). */
route("GET", "/admin/contacts", "admin", async ({ env, url }) => {
  const statut = url.searchParams.get("statut");
  if (statut && !STATUTS_CONTACT.includes(statut)) throw err400("Statut de contact inconnu.");
  const q = statut
    ? env.DB.prepare("SELECT * FROM contacts WHERE statut = ? ORDER BY cree DESC LIMIT 200").bind(statut)
    : env.DB.prepare("SELECT * FROM contacts ORDER BY cree DESC LIMIT 200");
  const { results } = await q.all();
  const { results: rdvs } = await env.DB.prepare("SELECT * FROM rdv ORDER BY debut").all();
  // Chaque contact porte son rendez-vous (le plus récent non annulé, sinon null).
  const parContact = new Map();
  for (const r of rdvs) if (r.contact_id && (r.statut !== "annule" || !parContact.has(r.contact_id))) parContact.set(r.contact_id, r);
  return { contacts: results.map(({ ip_hash, ...c }) => ({ ...c, rdv: parContact.get(c.id) || null })), rdv: rdvs };
});

/** PATCH /admin/contacts/:id {statut} */
route("PATCH", "/admin/contacts/:id", "admin", async ({ req, env, params, qui }) => {
  const corps = await lireCorps(req);
  const statut = champ(corps, "statut", { requis: true, enum: STATUTS_CONTACT });
  const r = await env.DB.prepare("UPDATE contacts SET statut = ? WHERE id = ?").bind(statut, params.id).run();
  if (!r.meta.changes) throw err404("Contact introuvable.");
  await journaliser(env, qui, "statut:" + statut, "contacts", params.id);
  return { id: params.id, statut };
});

/** PATCH /admin/rdv/:id {statut, note} — confirmer / annuler un rendez-vous. */
route("PATCH", "/admin/rdv/:id", "admin", async ({ req, env, params, qui }) => {
  const corps = await lireCorps(req);
  const statut = champ(corps, "statut", { enum: STATUTS_RDV });
  const note = champ(corps, "note", { max: 1000 });
  const sets = [], vals = [];
  if (statut) { sets.push("statut = ?"); vals.push(statut); }
  if (note !== undefined) { sets.push("note = ?"); vals.push(note); }
  if (!sets.length) throw err400("Rien à modifier.");
  const r = await env.DB.prepare(`UPDATE rdv SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, params.id).run();
  if (!r.meta.changes) throw err404("Rendez-vous introuvable.");
  await journaliser(env, qui, "modifier", "rdv", params.id);
  return { id: params.id };
});

/** GET /admin/journal?limit= — dernières lignes de la piste d'audit. */
route("GET", "/admin/journal", "admin", async ({ env, url }) => {
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const { results } = await env.DB.prepare("SELECT * FROM journal ORDER BY id DESC LIMIT ?").bind(limit).all();
  return { journal: results.map((l) => ({ ...l, table: String(l.cible || "").split(":")[0] || null })) };
});

/**
 * GET /admin/flux — Server-Sent Events : un événement `maj` {table, id, quand}
 * pour chaque nouvelle ligne du journal, relu toutes les 3 s ; fermeture à 25 min.
 * Le navigateur (EventSource) ne peut pas envoyer d'en-tête : le jeton est accepté
 * en paramètre `?t=` (forme du panneau) ou `?jeton=`.
 */
route("GET", "/admin/flux", "admin", async ({ env, ctx }) => {
  const dernier = await env.DB.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM journal").first();
  let depuis = dernier.id;
  const debut = Date.now();
  const encodeur = new TextEncoder();

  const flux = new ReadableStream({
    start(ctrl) {
      const envoyer = (texte) => ctrl.enqueue(encodeur.encode(texte));
      envoyer("retry: 5000\nevent: bonjour\ndata: {}\n\n");
      let fini = false;
      const fermer = () => {
        if (fini) return;
        fini = true;
        clearInterval(minuteur);
        try { envoyer("event: fin\ndata: {}\n\n"); ctrl.close(); } catch { /* déjà fermé */ }
      };
      const tic = async () => {
        if (fini) return;
        if (Date.now() - debut > SSE_DUREE_MAX_MS) return fermer();
        try {
          const { results } = await env.DB.prepare(
            "SELECT id, quand, action, cible FROM journal WHERE id > ? ORDER BY id LIMIT 100").bind(depuis).all();
          for (const l of results) {
            depuis = l.id;
            const [table, id] = String(l.cible || "").split(":");
            envoyer(`event: maj\ndata: ${JSON.stringify({ table, id, quand: l.quand, action: l.action })}\n\n`);
          }
          if (!results.length) envoyer(": battement\n\n");
        } catch (e) {
          // Le client a fermé la connexion : on arrête proprement.
          fermer();
        }
      };
      const minuteur = setInterval(tic, SSE_INTERVALLE_MS);
      this.annuler = fermer;
    },
    cancel() { this.annuler?.(); },
  });

  return new Response(flux, {
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
});

// ---------------------------------------------------------------------------
// Admin : clients
// ---------------------------------------------------------------------------

route("GET", "/admin/clients", "admin", async ({ env }) => {
  const { results } = await env.DB.prepare(`
    SELECT c.id, c.slug, c.nom, c.contact, c.email, c.cree, (c.token_hash IS NOT NULL) AS a_jeton,
      (SELECT COUNT(*) FROM projets p WHERE p.client_id = c.id) AS projets
    FROM clients c ORDER BY c.nom`).all();
  return { clients: results.map((c) => ({ ...c, a_jeton: !!c.a_jeton })) };
});

/** POST /admin/clients {slug, nom, contact, email} → jeton en clair, UNE fois. */
route("POST", "/admin/clients", "admin", async ({ req, env, qui }) => {
  const corps = await lireCorps(req);
  const slug = champ(corps, "slug", { requis: true, type: "id", max: 60 }).toLowerCase();
  const nom = champ(corps, "nom", { requis: true, max: 200 });
  const contact = champ(corps, "contact", { max: 200 });
  const email = champ(corps, "email", { type: "email", max: 320 });
  const id = champ(corps, "id", { type: "id", defaut: slug });
  const jeton = nouveauJeton();
  const quand = maintenant();
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO clients (id, slug, nom, contact, email, token_hash, cree) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(id, slug, nom, contact ?? null, email ?? null, await sha256(jeton), quand),
      stmtJournal(env, qui, "creer", "clients", id),
    ]);
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) throw err409("Un client avec cet identifiant ou ce slug existe déjà.");
    throw e;
  }
  return { id, token: jeton, jeton, client: { id, slug, nom, contact, email, cree: quand } };
});

/** POST /admin/clients/:id/regenerer → nouveau jeton en clair, l'ancien est révoqué. */
route("POST", "/admin/clients/:id/regenerer", "admin", async ({ env, params, qui }) => {
  const jeton = nouveauJeton();
  const r = await env.DB.prepare("UPDATE clients SET token_hash = ? WHERE id = ?").bind(await sha256(jeton), params.id).run();
  if (!r.meta.changes) throw err404("Client introuvable.");
  await journaliser(env, qui, "regenerer-jeton", "clients", params.id);
  return { id: params.id, token: jeton, jeton };
});

/** PATCH /admin/clients/:id {nom, contact, email} */
route("PATCH", "/admin/clients/:id", "admin", async ({ req, env, params, qui }) => {
  const corps = await lireCorps(req);
  const sets = [], vals = [];
  const nom = champ(corps, "nom", { max: 200 });
  const contact = champ(corps, "contact", { max: 200 });
  const email = champ(corps, "email", { type: "email", max: 320 });
  if (nom !== undefined) { sets.push("nom = ?"); vals.push(nom); }
  if (contact !== undefined) { sets.push("contact = ?"); vals.push(contact); }
  if (email !== undefined) { sets.push("email = ?"); vals.push(email); }
  if (!sets.length) throw err400("Rien à modifier.");
  const r = await env.DB.prepare(`UPDATE clients SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, params.id).run();
  if (!r.meta.changes) throw err404("Client introuvable.");
  await journaliser(env, qui, "modifier", "clients", params.id);
  return { id: params.id };
});

// ---------------------------------------------------------------------------
// Admin : projets
// ---------------------------------------------------------------------------

/** GET /admin/projets → {projets:[{…projet, client:{…}, compteurs:{statut:n}, nb_demandes}]} */
route("GET", "/admin/projets", "admin", async ({ env }) => {
  const [projets, comptes] = await env.DB.batch([
    env.DB.prepare(SELECT_PROJET + " ORDER BY p.maj DESC"),
    env.DB.prepare("SELECT projet_id, statut, COUNT(*) AS n FROM demandes GROUP BY projet_id, statut"),
  ]);
  const parProjet = new Map();
  for (const c of comptes.results) {
    if (!parProjet.has(c.projet_id)) parProjet.set(c.projet_id, COMPTEURS_VIDES());
    parProjet.get(c.projet_id)[c.statut] = c.n;
  }
  return {
    projets: projets.results.map((p) => {
      const compteurs = parProjet.get(p.id) || COMPTEURS_VIDES();
      return { ...formerProjet(p), compteurs, nb_demandes: Object.values(compteurs).reduce((s, n) => s + n, 0) };
    }),
  };
});

/**
 * GET /admin/projets/:id → projet + demandes + evenements + conversations (+ messages) + fichiers.
 * Les demandes « nouveau » passent « lu » à cette première lecture par l'admin.
 */
route("GET", "/admin/projets/:id", "admin", async ({ env, params, qui }) => {
  const ligne = await env.DB.prepare(SELECT_PROJET + " WHERE p.id = ?").bind(params.id).first();
  if (!ligne) throw err404("Projet introuvable.");
  const projet = formerProjet(ligne);

  // Marquage « lu » des demandes nouvelles, journalisé une à une.
  const { results: nouvelles } = await env.DB.prepare("SELECT id FROM demandes WHERE projet_id = ? AND statut = 'nouveau'").bind(params.id).all();
  if (nouvelles.length) {
    const quand = maintenant();
    await env.DB.batch(nouvelles.flatMap((d) => [
      env.DB.prepare("UPDATE demandes SET statut = 'lu', maj = ? WHERE id = ? AND statut = 'nouveau'").bind(quand, d.id),
      stmtJournal(env, qui, "statut:lu", "demandes", d.id),
    ]));
  }

  const [demandes, evenements, conversations, messages, fichiers] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM demandes WHERE projet_id = ? ORDER BY n, cree").bind(params.id),
    env.DB.prepare("SELECT id, projet_id, COALESCE(date, '') AS date, type, titre, COALESCE(detail, '') AS detail FROM evenements WHERE projet_id = ? ORDER BY (date IS NULL OR date = ''), date, id").bind(params.id),
    env.DB.prepare("SELECT * FROM conversations WHERE projet_id = ? ORDER BY maj DESC").bind(params.id),
    env.DB.prepare("SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.projet_id = ? ORDER BY m.date, m.id").bind(params.id),
    env.DB.prepare("SELECT * FROM fichiers WHERE projet_id = ? ORDER BY cree DESC").bind(params.id),
  ]);
  // Messages imbriqués dans leur conversation (forme attendue par le panneau).
  const parConv = new Map();
  for (const m of messages.results) {
    if (!parConv.has(m.conversation_id)) parConv.set(m.conversation_id, []);
    parConv.get(m.conversation_id).push(m);
  }
  return {
    projet, demandes: demandes.results, evenements: evenements.results,
    conversations: conversations.results.map((c) => ({ ...c, messages: parConv.get(c.id) || [] })),
    fichiers: fichiers.results,
  };
});

/** POST /admin/projets {client_id, titre, statut, resume, id?} */
route("POST", "/admin/projets", "admin", async ({ req, env, qui }) => {
  const corps = await lireCorps(req);
  const client_id = champ(corps, "client_id", { requis: true, type: "id" });
  const titre = champ(corps, "titre", { requis: true, max: 300 });
  const statut = champ(corps, "statut", { enum: STATUTS_PROJET, defaut: "en_cours" });
  const resume = champ(corps, "resume", { max: 4000 });
  const id = champ(corps, "id", { type: "id", defaut: nouvelId() });
  const client = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(client_id).first();
  if (!client) throw err400("Client inconnu.");
  const quand = maintenant();
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO projets (id, client_id, titre, statut, resume, cree, maj) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(id, client_id, titre, statut, resume ?? null, quand, quand),
      stmtJournal(env, qui, "creer", "projets", id),
    ]);
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) throw err409("Un projet avec cet identifiant existe déjà.");
    throw e;
  }
  return { id, projet: { id, client_id, titre, statut, resume, cree: quand, maj: quand } };
});

/** PATCH /admin/projets/:id {titre, statut, resume} */
route("PATCH", "/admin/projets/:id", "admin", async ({ req, env, params, qui }) => {
  const corps = await lireCorps(req);
  const sets = [], vals = [];
  const titre = champ(corps, "titre", { max: 300 });
  const statut = champ(corps, "statut", { enum: STATUTS_PROJET });
  const resume = champ(corps, "resume", { max: 4000 });
  if (titre !== undefined) { sets.push("titre = ?"); vals.push(titre); }
  if (statut !== undefined) { sets.push("statut = ?"); vals.push(statut); }
  if (resume !== undefined) { sets.push("resume = ?"); vals.push(resume); }
  if (!sets.length) throw err400("Rien à modifier.");
  sets.push("maj = ?"); vals.push(maintenant());
  const r = await env.DB.prepare(`UPDATE projets SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, params.id).run();
  if (!r.meta.changes) throw err404("Projet introuvable.");
  await journaliser(env, qui, "modifier", "projets", params.id);
  return { id: params.id };
});

// ---------------------------------------------------------------------------
// Admin : demandes
// ---------------------------------------------------------------------------

/** Ligne de projet jointe → {…projet, client:{id,slug,nom,contact,email}}. */
function formerProjet(p) {
  const { client_slug, client_nom, client_contact, client_email, ...reste } = p;
  return { ...reste, client: p.client_id ? { id: p.client_id, slug: client_slug, nom: client_nom, contact: client_contact, email: client_email } : null };
}
const SELECT_PROJET = "SELECT p.*, c.slug AS client_slug, c.nom AS client_nom, c.contact AS client_contact, c.email AS client_email FROM projets p LEFT JOIN clients c ON c.id = p.client_id";
const COMPTEURS_VIDES = () => ({ nouveau: 0, lu: 0, en_cours: 0, repondu: 0, traite: 0, abandonne: 0, partiel: 0 });

/** Vérifie qu'un projet existe et renvoie sa ligne. */
async function projetExistant(env, id) {
  const p = await env.DB.prepare("SELECT id, client_id FROM projets WHERE id = ?").bind(id).first();
  if (!p) throw err400("Projet inconnu.");
  return p;
}

/** Insère une demande (utilisé par l'admin et par les clients). */
async function creerDemande(env, qui, corps, { projet_id, statut }) {
  const titre = champ(corps, "titre", { requis: true, max: 300, min: 2 });
  const groupe = champ(corps, "groupe", { max: 200 });
  const demandeur = champ(corps, "qui", { max: 200 });
  const date_txt = champ(corps, "date_txt", { max: 100 });
  const tarif = champ(corps, "tarif", { enum: TARIFS, defaut: "forfait" });
  const livre = champ(corps, "livre", { max: 4000 });
  const reste = champ(corps, "reste", { max: 4000 });
  const n = champ(corps, "n", { type: "entier" });
  const id = nouvelId();
  const quand = maintenant();
  const numero = n ?? ((await env.DB.prepare("SELECT COALESCE(MAX(n), 0) + 1 AS n FROM demandes WHERE projet_id = ?").bind(projet_id).first()).n);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO demandes (id, projet_id, n, groupe, titre, qui, date_txt, statut, tarif, livre, reste, cree, maj)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, projet_id, numero, groupe ?? null, titre, demandeur ?? null, date_txt ?? null, statut, tarif, livre ?? null, reste ?? null, quand, quand),
    env.DB.prepare("UPDATE projets SET maj = ? WHERE id = ?").bind(quand, projet_id),
    stmtJournal(env, qui, "creer", "demandes", id),
  ]);
  return { id, projet_id, n: numero, groupe, titre, qui: demandeur, date_txt, statut, tarif, livre, reste, note: null, encore: 0, encore_le: null, cree: quand, maj: quand };
}

/** POST /admin/demandes {projet_id, titre, …} — créée par l'admin : statut « lu » (déjà vue). */
route("POST", "/admin/demandes", "admin", async ({ req, env, qui }) => {
  const corps = await lireCorps(req);
  const projet_id = champ(corps, "projet_id", { requis: true, type: "id" });
  await projetExistant(env, projet_id);
  const statut = champ(corps, "statut", { enum: STATUTS_DEMANDE, defaut: "lu" });
  const demande = await creerDemande(env, qui, corps, { projet_id, statut });
  return { id: demande.id, demande };
});

/**
 * Applique une action métier à une demande :
 *  traiter → en_cours ; fait (solution obligatoire) → traite ;
 *  abandonner (motif obligatoire) → abandonne ; rouvrir → en_cours.
 * Les champs `reste` et `note` du corps sont appliqués en même temps s'ils sont présents.
 */
async function actionDemande(env, qui, id, action, corps) {
  const demande = await env.DB.prepare("SELECT * FROM demandes WHERE id = ?").bind(id).first();
  if (!demande) throw err404("Demande introuvable.");
  const sets = ["maj = ?"], vals = [maintenant()];
  const reste = champ(corps, "reste", { max: 4000 });
  if (reste !== undefined) { sets.push("reste = ?"); vals.push(reste); }
  const note = champ(corps, "note", { max: 8000 });
  if (note !== undefined) { sets.push("note = ?"); vals.push(note); }
  let statut;
  switch (action) {
    case "traiter":
      statut = "en_cours";
      break;
    case "fait": {
      const solution = champ(corps, "solution", { max: 4000 });
      if (!solution) throw err400("Indiquez la solution apportée pour clore la demande.");
      statut = "traite";
      sets.push("solution = ?"); vals.push(solution);
      if (reste === undefined) sets.push("reste = ''");
      break;
    }
    case "abandonner": {
      const motif = champ(corps, "motif", { max: 4000 });
      if (!motif) throw err400("Indiquez le motif de l'abandon.");
      statut = "abandonne";
      sets.push("motif = ?"); vals.push(motif);
      break;
    }
    case "rouvrir":
      statut = "en_cours";
      break;
    default:
      throw err400("Action inconnue : traiter, fait, abandonner ou rouvrir.");
  }
  sets.push("statut = ?"); vals.push(statut);
  await env.DB.batch([
    env.DB.prepare(`UPDATE demandes SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id),
    env.DB.prepare("UPDATE projets SET maj = ? WHERE id = ?").bind(vals[0], demande.projet_id),
    stmtJournal(env, qui, action, "demandes", id),
  ]);
  return { id, statut };
}

/** POST /admin/demandes/:id/:action — traiter | fait | abandonner | rouvrir. */
route("POST", "/admin/demandes/:id/:action", "admin", async ({ req, env, params, qui }) => {
  const corps = await lireCorps(req);
  return actionDemande(env, qui, params.id, params.action, corps);
});

/**
 * PATCH /admin/demandes/:id {action?, statut, solution, motif, reste, note, livre, titre, groupe, qui, date_txt, tarif, n}
 * Avec `action` ("traiter" | "fait" | "abandonner" | "rouvrir"), l'action métier prime
 * (le `statut` envoyé en plus par le panneau est ignoré au profit de la règle).
 */
route("PATCH", "/admin/demandes/:id", "admin", async ({ req, env, params, qui }) => {
  const corps = await lireCorps(req);
  if (corps.action) return actionDemande(env, qui, params.id, String(corps.action), corps);

  const sets = [], vals = [];
  const texte = (nom, max) => { const v = champ(corps, nom, { max }); if (v !== undefined) { sets.push(`${nom} = ?`); vals.push(v); } };
  texte("titre", 300); texte("groupe", 200); texte("qui", 200); texte("date_txt", 100);
  texte("livre", 4000); texte("reste", 4000); texte("solution", 4000); texte("motif", 4000); texte("note", 8000);
  const statut = champ(corps, "statut", { enum: STATUTS_DEMANDE });
  if (statut) {
    if (statut === "traite" && !corps.solution) {
      const actuelle = await env.DB.prepare("SELECT solution FROM demandes WHERE id = ?").bind(params.id).first();
      if (!actuelle?.solution) throw err400("Indiquez la solution apportée pour clore la demande.");
    }
    if (statut === "abandonne" && !corps.motif) {
      const actuelle = await env.DB.prepare("SELECT motif FROM demandes WHERE id = ?").bind(params.id).first();
      if (!actuelle?.motif) throw err400("Indiquez le motif de l'abandon.");
    }
    sets.push("statut = ?"); vals.push(statut);
  }
  const tarif = champ(corps, "tarif", { enum: TARIFS });
  if (tarif) { sets.push("tarif = ?"); vals.push(tarif); }
  const n = champ(corps, "n", { type: "entier" });
  if (n !== undefined) { sets.push("n = ?"); vals.push(n); }
  if (!sets.length) throw err400("Rien à modifier.");
  sets.push("maj = ?"); vals.push(maintenant());
  const r = await env.DB.prepare(`UPDATE demandes SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, params.id).run();
  if (!r.meta.changes) throw err404("Demande introuvable.");
  await journaliser(env, qui, "modifier", "demandes", params.id);
  return { id: params.id };
});

// ---------------------------------------------------------------------------
// Admin : événements, conversations, messages, fichiers
// ---------------------------------------------------------------------------

route("POST", "/admin/evenements", "admin", async ({ req, env, qui }) => {
  const corps = await lireCorps(req);
  const projet_id = champ(corps, "projet_id", { requis: true, type: "id" });
  await projetExistant(env, projet_id);
  const date = champ(corps, "date", { type: "date" });
  const type = champ(corps, "type", { enum: TYPES_EVENEMENT, defaut: "echange" });
  const titre = champ(corps, "titre", { requis: true, max: 300 });
  const detail = champ(corps, "detail", { max: 4000 });
  const id = nouvelId();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO evenements (id, projet_id, date, type, titre, detail) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, projet_id, date ?? null, type, titre, detail ?? null),
    env.DB.prepare("UPDATE projets SET maj = ? WHERE id = ?").bind(maintenant(), projet_id),
    stmtJournal(env, qui, "creer", "evenements", id),
  ]);
  return { id, evenement: { id, projet_id, date: date ?? "", type, titre, detail: detail ?? "" } };
});

route("PATCH", "/admin/evenements/:id", "admin", async ({ req, env, params, qui }) => {
  const corps = await lireCorps(req);
  const sets = [], vals = [];
  // date "" = « à venir » (sans date)
  const date = corps.date === "" ? "" : champ(corps, "date", { type: "date" });
  const type = champ(corps, "type", { enum: TYPES_EVENEMENT });
  const titre = champ(corps, "titre", { max: 300 });
  const detail = champ(corps, "detail", { max: 4000 });
  if (date !== undefined) { sets.push("date = ?"); vals.push(date); }
  if (type !== undefined) { sets.push("type = ?"); vals.push(type); }
  if (titre !== undefined) { sets.push("titre = ?"); vals.push(titre); }
  if (detail !== undefined) { sets.push("detail = ?"); vals.push(detail); }
  if (!sets.length) throw err400("Rien à modifier.");
  const r = await env.DB.prepare(`UPDATE evenements SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, params.id).run();
  if (!r.meta.changes) throw err404("Événement introuvable.");
  await journaliser(env, qui, "modifier", "evenements", params.id);
  return { id: params.id };
});

route("DELETE", "/admin/evenements/:id", "admin", async ({ env, params, qui }) => {
  const r = await env.DB.prepare("DELETE FROM evenements WHERE id = ?").bind(params.id).run();
  if (!r.meta.changes) throw err404("Événement introuvable.");
  await journaliser(env, qui, "supprimer", "evenements", params.id);
  return { id: params.id };
});

/** POST /admin/conversations {projet_id, canal, titre, participants} */
route("POST", "/admin/conversations", "admin", async ({ req, env, qui }) => {
  const corps = await lireCorps(req);
  const projet_id = champ(corps, "projet_id", { requis: true, type: "id" });
  await projetExistant(env, projet_id);
  const canal = champ(corps, "canal", { requis: true, enum: CANAUX });
  const titre = champ(corps, "titre", { max: 300 });
  const participants = champ(corps, "participants", { max: 500 });
  const id = nouvelId();
  const quand = maintenant();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO conversations (id, projet_id, canal, titre, participants, maj) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, projet_id, canal, titre ?? null, participants ?? null, quand),
    stmtJournal(env, qui, "creer", "conversations", id),
  ]);
  return { id, conversation: { id, projet_id, canal, titre, participants, maj: quand } };
});

/** Insère un message dans une conversation (admin ou client). */
async function creerMessage(env, qui, { conversation_id, demande_id, de, date, texte, piece }) {
  const conv = await env.DB.prepare("SELECT id, projet_id FROM conversations WHERE id = ?").bind(conversation_id).first();
  if (!conv) throw err400("Conversation inconnue.");
  if (demande_id) {
    const d = await env.DB.prepare("SELECT id FROM demandes WHERE id = ? AND projet_id = ?").bind(demande_id, conv.projet_id).first();
    if (!d) throw err400("Demande inconnue dans ce projet.");
  }
  const id = nouvelId();
  const quand = maintenant();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO messages (id, conversation_id, demande_id, de, date, texte, piece) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, conversation_id, demande_id ?? null, de, date ?? quand, texte, piece ?? null),
    env.DB.prepare("UPDATE conversations SET maj = ? WHERE id = ?").bind(quand, conversation_id),
    env.DB.prepare("UPDATE projets SET maj = ? WHERE id = ?").bind(quand, conv.projet_id),
    stmtJournal(env, qui, "creer", "messages", id),
  ]);
  return { id, conversation_id, demande_id, de, date: date ?? quand, texte, piece };
}

/** POST /admin/messages {conversation_id, demande_id?, de?, date?, texte, piece?} */
route("POST", "/admin/messages", "admin", async ({ req, env, qui }) => {
  const corps = await lireCorps(req);
  const message = await creerMessage(env, qui, {
    conversation_id: champ(corps, "conversation_id", { requis: true, type: "id" }),
    demande_id: champ(corps, "demande_id", { type: "id" }),
    de: champ(corps, "de", { max: 100, defaut: "Damien" }),
    date: champ(corps, "date", { max: 40 }),
    texte: champ(corps, "texte", { requis: true, max: 8000 }),
    piece: champ(corps, "piece", { max: 500 }),
  });
  return { id: message.id, message };
});

/** POST /admin/fichiers {projet_id, nom, type, taille, url, note} — métadonnées seulement. */
route("POST", "/admin/fichiers", "admin", async ({ req, env, qui }) => {
  const corps = await lireCorps(req);
  const projet_id = champ(corps, "projet_id", { requis: true, type: "id" });
  await projetExistant(env, projet_id);
  const nom = champ(corps, "nom", { requis: true, max: 300 });
  const type = champ(corps, "type", { max: 100 });
  const taille = champ(corps, "taille", { type: "entier" });
  const url = champ(corps, "url", { max: 2000 });
  if (url && !/^(https?:\/\/|\/)/.test(url)) throw err400("L'adresse du fichier doit commencer par http(s):// ou par /.");
  const note = champ(corps, "note", { max: 2000 });
  const id = nouvelId();
  const quand = maintenant();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO fichiers (id, projet_id, nom, type, taille, url, note, cree) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, projet_id, nom, type ?? null, taille ?? null, url ?? null, note ?? null, quand),
    stmtJournal(env, qui, "creer", "fichiers", id),
  ]);
  return { id, fichier: { id, projet_id, nom, type, taille, url, note, cree: quand } };
});

route("DELETE", "/admin/fichiers/:id", "admin", async ({ env, params, qui }) => {
  const r = await env.DB.prepare("DELETE FROM fichiers WHERE id = ?").bind(params.id).run();
  if (!r.meta.changes) throw err404("Fichier introuvable.");
  await journaliser(env, qui, "supprimer", "fichiers", params.id);
  return { id: params.id };
});

// ---------------------------------------------------------------------------
// Admin : factures
// ---------------------------------------------------------------------------

/** Ligne de facture avec `lignes` décodées. */
function decoderFacture(f) {
  if (!f) return f;
  let lignes = [];
  try { lignes = JSON.parse(f.lignes || "[]"); } catch { lignes = []; }
  return { ...f, lignes };
}

const SELECT_FACTURE = "SELECT f.*, c.nom AS client_nom, c.contact AS client_contact, c.email AS client_email FROM factures f LEFT JOIN clients c ON c.id = f.client_id";

/** GET /admin/factures[?statut=] → {factures:[{…, client_nom, client_contact, client_email, lignes:[…], type, reference}]} */
route("GET", "/admin/factures", "admin", async ({ env, url }) => {
  const statut = url.searchParams.get("statut");
  if (statut && !["brouillon", "envoyee", "payee", "annulee"].includes(statut)) throw err400("Statut de facture inconnu.");
  const q = statut
    ? env.DB.prepare(SELECT_FACTURE + " WHERE f.statut = ? ORDER BY f.cree DESC LIMIT 500").bind(statut)
    : env.DB.prepare(SELECT_FACTURE + " ORDER BY f.cree DESC LIMIT 500");
  const { results } = await q.all();
  return { factures: results.map(decoderFacture) };
});

route("GET", "/admin/factures/:id", "admin", async ({ env, params }) => {
  const f = await env.DB.prepare(SELECT_FACTURE + " WHERE f.id = ?").bind(params.id).first();
  if (!f) throw err404("Facture introuvable.");
  return { facture: decoderFacture(f) };
});

/**
 * Prépare un brouillon d'avoir à partir d'une facture d'origine (par identifiant ou par numéro).
 * Renvoie {origine, lignes, total_ht, reference}. L'origine doit être émise ; un seul avoir par facture.
 */
async function preparerAvoir(env, { id, numero, lignesFournies }) {
  const origine = id
    ? await env.DB.prepare("SELECT * FROM factures WHERE id = ?").bind(id).first()
    : await env.DB.prepare("SELECT * FROM factures WHERE numero = ?").bind(numero).first();
  if (!origine) throw err404("Facture d'origine introuvable.");
  if (!["envoyee", "payee"].includes(origine.statut)) throw err409("Un avoir ne peut être créé que sur une facture émise.");
  if (origine.type === "avoir") throw err409("Impossible de créer un avoir sur un avoir.");
  const existant = await env.DB.prepare("SELECT id FROM factures WHERE ref = ? AND statut != 'annulee'").bind(origine.id).first();
  if (existant) throw err409("Un avoir existe déjà pour cette facture.");
  // Lignes : celles fournies (déjà négatives ou non), sinon celles de l'origine, toujours mises en négatif.
  const base = lignesFournies ? validerLignes(lignesFournies).lignes : JSON.parse(origine.lignes || "[]");
  const lignes = base.map((l) => ({ ...l, prix: -Math.abs(l.prix), total: -Math.abs(l.total) }));
  const total_ht = Math.round(lignes.reduce((s, l) => s + l.total, 0) * 100) / 100;
  return { origine, lignes, total_ht, reference: origine.numero };
}

/**
 * POST /admin/factures {client_id, lignes:[{ref,designation,quantite,unite,prix}], date?, echeance?, tva?, note?, objet?}
 * → brouillon {id, facture}. Avec {type:"avoir", reference:"BS-AAAA-NNN"} : brouillon d'avoir lié
 * à cette facture (lignes mises en négatif), l'origine passera « annulee » à l'émission de l'avoir.
 */
route("POST", "/admin/factures", "admin", async ({ req, env, qui }) => {
  const corps = await lireCorps(req);
  const type = champ(corps, "type", { enum: ["facture", "avoir"], defaut: "facture" });
  const date = champ(corps, "date", { type: "date" });
  const echeance = champ(corps, "echeance", { type: "date" });
  const tva = champ(corps, "tva", { type: "entier", defaut: 0 });
  if (tva < 0 || tva > 100) throw err400("Le taux de TVA doit être entre 0 et 100.");
  const note = champ(corps, "note", { max: 2000 });
  const objet = champ(corps, "objet", { max: 300 });
  const id = nouvelId();
  const quand = maintenant();

  let client_id, lignes, total_ht, ref = null, reference = null;
  if (type === "avoir") {
    const reference_ = champ(corps, "reference", { requis: true, max: 20 });
    const a = await preparerAvoir(env, { numero: reference_, lignesFournies: corps.lignes });
    client_id = a.origine.client_id; lignes = a.lignes; total_ht = a.total_ht; ref = a.origine.id; reference = a.reference;
  } else {
    client_id = champ(corps, "client_id", { requis: true, type: "id" });
    const client = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(client_id).first();
    if (!client) throw err400("Client inconnu.");
    ({ lignes, total_ht } = validerLignes(corps.lignes ?? []));
  }
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO factures (id, numero, client_id, date, echeance, lignes, total_ht, tva, statut, note, type, ref, reference, objet, cree, maj)
                    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'brouillon', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, client_id, date ?? null, echeance ?? null, JSON.stringify(lignes), total_ht, tva, note ?? null, type, ref, reference, objet ?? null, quand, quand),
    stmtJournal(env, qui, type === "avoir" ? "creer-avoir" : "creer", "factures", id),
  ]);
  const facture = await env.DB.prepare(SELECT_FACTURE + " WHERE f.id = ?").bind(id).first();
  return { id, facture: decoderFacture(facture) };
});

/** PATCH /admin/factures/:id — seulement un brouillon est modifiable. */
route("PATCH", "/admin/factures/:id", "admin", async ({ req, env, params, qui }) => {
  const corps = await lireCorps(req);
  const f = await env.DB.prepare("SELECT id, statut, type FROM factures WHERE id = ?").bind(params.id).first();
  if (!f) throw err404("Facture introuvable.");
  if (f.statut !== "brouillon") throw err409("Une facture émise ne se modifie plus : créez un avoir.");
  const sets = [], vals = [];
  if (corps.lignes !== undefined) {
    let { lignes, total_ht } = validerLignes(corps.lignes);
    if (f.type === "avoir") {
      lignes = lignes.map((l) => ({ ...l, prix: -Math.abs(l.prix), total: -Math.abs(l.total) }));
      total_ht = Math.round(lignes.reduce((s, l) => s + l.total, 0) * 100) / 100;
    }
    sets.push("lignes = ?", "total_ht = ?"); vals.push(JSON.stringify(lignes), total_ht);
  }
  const date = champ(corps, "date", { type: "date" });
  const echeance = champ(corps, "echeance", { type: "date" });
  const tva = champ(corps, "tva", { type: "entier" });
  const note = champ(corps, "note", { max: 2000 });
  const objet = champ(corps, "objet", { max: 300 });
  const client_id = champ(corps, "client_id", { type: "id" });
  if (date !== undefined) { sets.push("date = ?"); vals.push(date); }
  if (echeance !== undefined) { sets.push("echeance = ?"); vals.push(echeance); }
  if (tva !== undefined) { if (tva < 0 || tva > 100) throw err400("Le taux de TVA doit être entre 0 et 100."); sets.push("tva = ?"); vals.push(tva); }
  if (note !== undefined) { sets.push("note = ?"); vals.push(note); }
  if (objet !== undefined) { sets.push("objet = ?"); vals.push(objet); }
  if (client_id !== undefined && f.type !== "avoir") {
    const c = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(client_id).first();
    if (!c) throw err400("Client inconnu.");
    sets.push("client_id = ?"); vals.push(client_id);
  }
  if (!sets.length) throw err400("Rien à modifier.");
  sets.push("maj = ?"); vals.push(maintenant());
  await env.DB.batch([
    env.DB.prepare(`UPDATE factures SET ${sets.join(", ")} WHERE id = ? AND statut = 'brouillon'`).bind(...vals, params.id),
    stmtJournal(env, qui, "modifier", "factures", params.id),
  ]);
  return { id: params.id };
});

/**
 * POST /admin/factures/:id/emettre — fige la facture, attribue le numéro continu
 * BS-AAAA-NNN (compteur par année, transaction `batch`), statut « envoyee ».
 * Date d'émission = aujourd'hui si absente ; échéance = date + 30 jours si absente.
 * Si c'est un avoir (`ref`), la facture d'origine passe « annulee ».
 */
route("POST", "/admin/factures/:id/emettre", "admin", async ({ env, params, qui }) => {
  const f = await env.DB.prepare("SELECT * FROM factures WHERE id = ?").bind(params.id).first();
  if (!f) throw err404("Facture introuvable.");
  if (f.statut !== "brouillon") throw err409("Cette facture est déjà émise.");
  const lignes = JSON.parse(f.lignes || "[]");
  if (!lignes.length) throw err400("Ajoutez au moins une ligne avant d'émettre la facture.");

  const date = f.date || aujourdhui();
  const echeance = f.echeance || ajouterJours(date, ECHEANCE_JOURS);
  const annee = date.slice(0, 4);
  const cle = "facture:" + annee;
  const quand = maintenant();

  // Transaction : incrément du compteur puis numérotation à partir de sa valeur (sous-requête),
  // le tout dans un même batch D1 (atomique). Le numéro n'est jamais réutilisé.
  const stmts = [
    env.DB.prepare("INSERT INTO compteurs (cle, valeur) VALUES (?, 1) ON CONFLICT(cle) DO UPDATE SET valeur = valeur + 1").bind(cle),
    env.DB.prepare(`UPDATE factures
                    SET numero = 'BS-' || ? || '-' || printf('%03d', (SELECT valeur FROM compteurs WHERE cle = ?)),
                        statut = 'envoyee', date = ?, echeance = ?, maj = ?
                    WHERE id = ? AND statut = 'brouillon'`)
      .bind(annee, cle, date, echeance, quand, params.id),
    stmtJournal(env, qui, "emettre", "factures", params.id),
  ];
  if (f.ref) {
    stmts.push(env.DB.prepare("UPDATE factures SET statut = 'annulee', maj = ? WHERE id = ? AND statut IN ('envoyee', 'payee')").bind(quand, f.ref));
    stmts.push(stmtJournal(env, qui, "annuler-par-avoir", "factures", f.ref));
  }
  await env.DB.batch(stmts);
  const maj = await env.DB.prepare(SELECT_FACTURE + " WHERE f.id = ?").bind(params.id).first();
  return { id: params.id, facture: decoderFacture(maj) };
});

/** POST /admin/factures/:id/payee {date_paiement?} — seulement depuis « envoyee ». */
route("POST", "/admin/factures/:id/payee", "admin", async ({ req, env, params, qui }) => {
  const corps = await lireCorps(req);
  const paye_le = champ(corps, "date_paiement", { type: "date", defaut: aujourdhui() });
  const f = await env.DB.prepare("SELECT id, statut FROM factures WHERE id = ?").bind(params.id).first();
  if (!f) throw err404("Facture introuvable.");
  if (f.statut !== "envoyee") throw err409("Seule une facture émise (envoyée) peut être marquée payée.");
  await env.DB.batch([
    env.DB.prepare("UPDATE factures SET statut = 'payee', paye_le = ?, maj = ? WHERE id = ? AND statut = 'envoyee'").bind(paye_le, maintenant(), params.id),
    stmtJournal(env, qui, "payee", "factures", params.id),
  ]);
  return { id: params.id, statut: "payee", paye_le };
});

/**
 * POST /admin/factures/:id/avoir {motif?} — crée un brouillon d'avoir (lignes négatives) lié
 * à une facture émise. L'annulation effective a lieu à l'émission de l'avoir.
 * Une facture émise n'est jamais supprimée.
 */
route("POST", "/admin/factures/:id/avoir", "admin", async ({ req, env, params, qui }) => {
  const corps = await lireCorps(req);
  const { origine, lignes, total_ht, reference } = await preparerAvoir(env, { id: params.id });
  const motif = champ(corps, "motif", { max: 2000, defaut: "" });
  const note = `Avoir sur la facture ${reference}${motif ? " — " + motif : ""}`;
  const id = nouvelId();
  const quand = maintenant();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO factures (id, numero, client_id, date, echeance, lignes, total_ht, tva, statut, note, type, ref, reference, cree, maj)
                    VALUES (?, NULL, ?, NULL, NULL, ?, ?, ?, 'brouillon', ?, 'avoir', ?, ?, ?, ?)`)
      .bind(id, origine.client_id, JSON.stringify(lignes), total_ht, origine.tva, note, origine.id, reference, quand, quand),
    stmtJournal(env, qui, "creer-avoir", "factures", id),
  ]);
  const facture = await env.DB.prepare(SELECT_FACTURE + " WHERE f.id = ?").bind(id).first();
  return { id, facture: decoderFacture(facture) };
});


/** DELETE /admin/factures/:id — brouillon uniquement. */
route("DELETE", "/admin/factures/:id", "admin", async ({ env, params, qui }) => {
  const f = await env.DB.prepare("SELECT id, statut FROM factures WHERE id = ?").bind(params.id).first();
  if (!f) throw err404("Facture introuvable.");
  if (f.statut !== "brouillon") throw err409("Une facture émise ne se supprime jamais : créez un avoir.");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM factures WHERE id = ? AND statut = 'brouillon'").bind(params.id),
    stmtJournal(env, qui, "supprimer", "factures", params.id),
  ]);
  return { id: params.id };
});

// ---------------------------------------------------------------------------
// Client (jeton haché)
// ---------------------------------------------------------------------------

/** GET /client/moi → client + projets. */
route("GET", "/client/moi", "client", async ({ env, client }) => {
  const { results } = await env.DB.prepare("SELECT id, titre, statut, resume, cree, maj FROM projets WHERE client_id = ? ORDER BY maj DESC").bind(client.id).all();
  return { client, projets: results };
});

/** GET /client/demandes[?projet_id=] → demandes des projets du client (+ messages). */
route("GET", "/client/demandes", "client", async ({ env, client, url }) => {
  const projet_id = url.searchParams.get("projet_id");
  const q = projet_id
    ? env.DB.prepare("SELECT d.* FROM demandes d JOIN projets p ON p.id = d.projet_id WHERE p.client_id = ? AND d.projet_id = ? ORDER BY d.n, d.cree").bind(client.id, projet_id)
    : env.DB.prepare("SELECT d.* FROM demandes d JOIN projets p ON p.id = d.projet_id WHERE p.client_id = ? ORDER BY d.projet_id, d.n, d.cree").bind(client.id);
  const { results } = await q.all();
  const { results: messages } = await env.DB.prepare(
    "SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id JOIN projets p ON p.id = c.projet_id WHERE p.client_id = ? AND m.demande_id IS NOT NULL ORDER BY m.date, m.id")
    .bind(client.id).all();
  return { demandes: results, messages };
});

/** Projet d'un client (vérifie l'appartenance) ; le premier projet si non précisé. */
async function projetDuClient(env, client, projet_id) {
  const p = projet_id
    ? await env.DB.prepare("SELECT id FROM projets WHERE id = ? AND client_id = ?").bind(projet_id, client.id).first()
    : await env.DB.prepare("SELECT id FROM projets WHERE client_id = ? ORDER BY maj DESC LIMIT 1").bind(client.id).first();
  if (!p) throw err400("Projet inconnu pour ce client.");
  return p;
}

/** Conversation « Portail » d'un projet (créée au besoin). */
async function conversationPortail(env, qui, projet_id) {
  let conv = await env.DB.prepare("SELECT id FROM conversations WHERE projet_id = ? AND canal = 'Portail'").bind(projet_id).first();
  if (conv) return conv.id;
  const id = nouvelId();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO conversations (id, projet_id, canal, titre, participants, maj) VALUES (?, ?, 'Portail', 'Messages du portail client', NULL, ?)")
      .bind(id, projet_id, maintenant()),
    stmtJournal(env, qui, "creer", "conversations", id),
  ]);
  return id;
}

/** POST /client/demandes {projet_id?, titre, groupe?, qui?, texte?} → nouvelle demande « nouveau ». */
route("POST", "/client/demandes", "client", async ({ req, env, client, qui }) => {
  const corps = await lireCorps(req);
  const p = await projetDuClient(env, client, champ(corps, "projet_id", { type: "id" }));
  const demande = await creerDemande(env, qui, { ...corps, qui: corps.qui || client.contact || client.nom, date_txt: corps.date_txt || aujourdhui(), tarif: undefined },
    { projet_id: p.id, statut: "nouveau" });
  const texte = champ(corps, "texte", { max: 8000 });
  if (texte) {
    const conv = await conversationPortail(env, qui, p.id);
    await creerMessage(env, qui, { conversation_id: conv, demande_id: demande.id, de: corps.qui || client.nom, texte });
  }
  return { demande };
});

/** Demande appartenant au client (vérifie l'appartenance). */
async function demandeDuClient(env, client, id) {
  const d = await env.DB.prepare("SELECT d.* FROM demandes d JOIN projets p ON p.id = d.projet_id WHERE d.id = ? AND p.client_id = ?").bind(id, client.id).first();
  if (!d) throw err404("Demande introuvable.");
  return d;
}

/** POST /client/demandes/:id/messages {texte, de?} */
route("POST", "/client/demandes/:id/messages", "client", async ({ req, env, client, params, qui }) => {
  const corps = await lireCorps(req);
  const d = await demandeDuClient(env, client, params.id);
  const texte = champ(corps, "texte", { requis: true, max: 8000, min: 1 });
  const de = champ(corps, "de", { max: 100, defaut: client.nom });
  const conv = await conversationPortail(env, qui, d.projet_id);
  const message = await creerMessage(env, qui, { conversation_id: conv, demande_id: d.id, de, texte });
  // Un message du client sur une demande close la signale à nouveau.
  if (["traite", "repondu"].includes(d.statut)) {
    await env.DB.batch([
      env.DB.prepare("UPDATE demandes SET statut = 'nouveau', maj = ? WHERE id = ?").bind(maintenant(), d.id),
      stmtJournal(env, qui, "statut:nouveau", "demandes", d.id),
    ]);
  }
  return { message };
});

/** POST /client/demandes/:id/encore {texte?} — « ça ne marche toujours pas » : la demande repasse « nouveau ». */
route("POST", "/client/demandes/:id/encore", "client", async ({ req, env, client, params, qui }) => {
  const corps = await lireCorps(req);
  const d = await demandeDuClient(env, client, params.id);
  const texte = champ(corps, "texte", { max: 8000, defaut: "Ça ne marche toujours pas." });
  const conv = await conversationPortail(env, qui, d.projet_id);
  await creerMessage(env, qui, { conversation_id: conv, demande_id: d.id, de: client.nom, texte });
  const quand = maintenant();
  await env.DB.batch([
    env.DB.prepare("UPDATE demandes SET statut = 'nouveau', encore = encore + 1, encore_le = ?, maj = ? WHERE id = ?").bind(aujourdhui(), quand, d.id),
    env.DB.prepare("UPDATE projets SET maj = ? WHERE id = ?").bind(quand, d.projet_id),
    stmtJournal(env, qui, "encore", "demandes", d.id),
  ]);
  return { id: d.id, statut: "nouveau", encore: (d.encore || 0) + 1 };
});

/** GET /client/evenements → événements des projets du client. */
route("GET", "/client/evenements", "client", async ({ env, client }) => {
  const { results } = await env.DB.prepare(
    "SELECT e.* FROM evenements e JOIN projets p ON p.id = e.projet_id WHERE p.client_id = ? ORDER BY (e.date IS NULL OR e.date = ''), e.date")
    .bind(client.id).all();
  return { evenements: results };
});

// ---------------------------------------------------------------------------
// Exports pour les tests unitaires (sans effet sur le Worker)
// ---------------------------------------------------------------------------

export const _interne = {
  champ, validerLignes, resoudre, routes, pbkdf2, egalConstant, sha256, base64url, hex,
  origineAutorisee, enTetesCors, lundiDeSemaine, finDeCreneau, ajouterJours, semaineCourante,
  ErreurHttp, jetonDe, dateParis, urlPlanning, estUnIcs, secretPlanning,
  brancheNormalisee, urlApercuPages, formerPr,
};
