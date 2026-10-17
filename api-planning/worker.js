// belfort-api (version minimale) — relais des calendriers de l'Espace Breteuil.
// Aucun secret ici : les adresses ICS sont des SECRETS du Worker
// (BRETEUIL_ICS_URL, BRETEUIL_ICS_URL_2 … _4), posés dans le tableau de bord Cloudflare.
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

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origine = req.headers.get("Origin") || "";
    const permise = ORIGINES.includes(origine) || /^http:\/\/localhost(:\d+)?$/.test(origine);
    if (!permise) return new Response("Réservé à l'Espace Breteuil.", { status: 403 });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origine) });
    if (req.method !== "GET") return json({ ok: false, erreur: "Méthode non permise." }, 405, origine);

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
