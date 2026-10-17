// Petit serveur local qui imite Cloudflare Pages pour tester _site/ AVANT de publier :
// applique _site/_headers (CSP comprise) et _site/_redirects, URL « jolies » (/page → page.html,
// /dossier → /dossier/), 404.html. Sans dépendance.
//
//   bash scripts/build-site.sh && node scripts/servir-site.mjs      → http://localhost:8788
//   PORT=9000 node scripts/servir-site.mjs _site
//
// Approximation : suffisant pour vérifier la CSP et la navigation ; la référence reste
// l'adresse *.pages.dev de Cloudflare.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";

const RACINE = process.argv[2] || "_site";
const PORT = Number(process.env.PORT || 8788);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml", ".webmanifest": "application/manifest+json", ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".ics": "text/calendar",
  ".pdf": "application/pdf",
};

function lireRegles(fichier) {
  if (!existsSync(fichier)) return [];
  const regles = [];
  let cur = null;
  for (const brut of readFileSync(fichier, "utf8").split("\n")) {
    if (!brut.trim() || brut.trim().startsWith("#")) continue;
    if (!/^\s/.test(brut)) { cur = { motif: brut.trim(), en: [] }; regles.push(cur); continue; }
    const l = brut.trim(); const i = l.indexOf(":");
    if (cur && i > 0) cur.en.push([l.slice(0, i).trim(), l.slice(i + 1).trim()]);
  }
  return regles;
}
const correspond = (motif, chemin) => {
  if (/^https?:/.test(motif)) return false; // règles par nom d'hôte (*.pages.dev) : ignorées en local
  const re = new RegExp("^" + motif.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/:[a-z]+/g, "[^/]+") + "$");
  return re.test(chemin);
};
const HEADERS = lireRegles(join(RACINE, "_headers"));
const REDIRECTS = existsSync(join(RACINE, "_redirects"))
  ? readFileSync(join(RACINE, "_redirects"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => l.split(/\s+/))
  : [];

function entetes(chemin) {
  const h = {};
  for (const r of HEADERS) if (correspond(r.motif, chemin)) for (const [k, v] of r.en) h[k] = h[k] ? h[k] + ", " + v : v;
  return h;
}

function resoudre(chemin) {
  const p = normalize(decodeURIComponent(chemin)).replace(/^(\.\.[/\\])+/, "");
  const f = join(RACINE, p);
  if (existsSync(f) && statSync(f).isFile()) {
    if (p.endsWith("/index.html")) return { redirige: p.slice(0, -"index.html".length) };
    if (p.endsWith(".html")) return { redirige: p.slice(0, -".html".length) };
    return { fichier: f };
  }
  if (existsSync(f) && statSync(f).isDirectory()) {
    if (!p.endsWith("/")) return { redirige: p + "/" };
    if (existsSync(join(f, "index.html"))) return { fichier: join(f, "index.html") };
  }
  if (existsSync(f + ".html")) return { fichier: f + ".html" };
  return null;
}

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const chemin = url.pathname;
  for (const [src, dest, code] of REDIRECTS) {
    if (src === chemin) { res.writeHead(Number(code || 302), { Location: dest }); return res.end(); }
  }
  const r = resoudre(chemin);
  if (r && r.redirige) { res.writeHead(308, { Location: r.redirige + url.search }); return res.end(); }
  const fichier = r ? r.fichier : join(RACINE, "404.html");
  const statut = r ? 200 : 404;
  const h = entetes(r ? chemin : "/404.html");
  h["Content-Type"] = TYPES[extname(fichier).toLowerCase()] || "application/octet-stream";
  res.writeHead(statut, h);
  res.end(existsSync(fichier) ? readFileSync(fichier) : "404");
}).listen(PORT, () => console.log(`${RACINE}/ servi sur http://localhost:${PORT} (en-têtes de _headers appliqués)`));
