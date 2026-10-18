// belfort-api (version minimale) — relais des calendriers de l'Espace Breteuil
// et vérificateur des liens du bas de page de www.breteuil.fr.
// Aucun secret ici : les adresses ICS sont des SECRETS du Worker
// (BRETEUIL_ICS_URL, BRETEUIL_ICS_URL_2 … _4), posés dans le tableau de bord Cloudflare.
// Routes : GET /breteuil/planning.ics, /breteuil/planning/2.ics … /4.ics, GET /breteuil/site/liens[?forcer=1].
// Tests : node api-planning/worker.test.mjs
const ORIGINES = ["https://espace-breteuil.pages.dev", "https://belfort-systems.fr", "https://breteuil.belfort-systems.fr"];
const TTL_S = 600; // fraîcheur : 10 min
const MAX_OCTETS = 5 * 1024 * 1024;

function cors(origine) {
  return {
    "Access-Control-Allow-Origin": origine,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
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
const LIENS_MAX = 40;          // liens vérifiés au plus
const SOUS_REQUETES = 48;      // Cloudflare gratuit : 50 sous-requêtes par appel (marge de 2)
const LIENS_TTL_S = 3600;      // résultat gardé 1 h
const FORCER_MIN_S = 60;       // « Revérifier » : pas plus d'une vraie vérification par minute
const DELAI_MS = 8000;
const EN_PARALLELE = 6;
const UA = "Mozilla/5.0 (compatible; belfort-api/1.0; verificateur de liens de l'Espace Breteuil)";
let memoire = null;            // copie en mémoire (si caches.default est inactif, ex. *.workers.dev)

const ENTITES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decoder(t) {
  return String(t || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENTITES[e.toLowerCase()] ?? m;
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

async function verifierUn(lien, budget) {
  // Les HEAD sont réservés d'avance ; budget.reste = sous-requêtes encore libres pour les GET de secours.
  const essai = async (methode) => {
    if (methode !== "HEAD") budget.reste--;
    return fetch(lien.url, { method: methode, redirect: "follow", headers: { "User-Agent": UA, "Accept": "text/html,*/*;q=0.8" }, signal: AbortSignal.timeout(DELAI_MS) });
  };
  let r = null, statut = null;
  try {
    r = await essai("HEAD");
    statut = r.status;
    if ((statut === 405 || statut === 403) && budget.reste > 0) { r = await essai("GET"); statut = r.status; }
  } catch (e) { statut = null; r = null; }
  try { if (r && r.body) await r.body.cancel(); } catch {}
  const finale = r && r.url ? r.url : lien.url;
  const redirigeVers = r && normaliser(finale) !== normaliser(lien.url) ? finale : null;
  return { ...lien, statut, ok: statut != null && statut >= 200 && statut < 400, redirigeVers };
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
  // Vérifications en parallèle, dans la limite des sous-requêtes.
  liens.splice(Math.max(0, budget.reste));
  budget.reste -= liens.length;
  const resultats = new Array(liens.length);
  let i = 0;
  const travail = async () => { while (i < liens.length) { const k = i++; resultats[k] = await verifierUn(liens[k], budget); } };
  await Promise.all(Array.from({ length: Math.min(EN_PARALLELE, liens.length) }, travail));
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

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origine = req.headers.get("Origin") || "";
    const permise = ORIGINES.includes(origine) || /^http:\/\/localhost(:\d+)?$/.test(origine);
    if (!permise) return new Response("Réservé à l'Espace Breteuil.", { status: 403 });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origine) });
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
