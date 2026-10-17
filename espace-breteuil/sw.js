/* Espace Breteuil — service worker (portée /espace-breteuil/).
 * - Coquille de l'appli mise en cache à l'installation : l'appli s'ouvre hors ligne.
 * - Pages et fichiers JSON : réseau d'abord, cache en secours.
 * - Autres fichiers (CSS, JS, icônes, polices) : cache d'abord, rafraîchi en arrière-plan.
 * Le planning (autre domaine : le Worker) est mis en cache par l'appli elle-même
 * dans le cache « eb-planning », que ce service worker ne supprime jamais.
 */
var VERSION = "eb-v1";
var COQUILLE = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./ics.js",
  "./personnes.json",
  "./fiches.json",
  "./exemple.ics",
  "./manifest.webmanifest",
  "./icones/icon-192.png",
  "./icones/icon.svg",
  "/assets/config.js",
  "/assets/fonts/archivo-latin-400-normal.woff2",
  "/assets/fonts/archivo-latin-600-normal.woff2",
  "/assets/fonts/archivo-latin-700-normal.woff2",
  "/assets/fonts/spectral-latin-600-normal.woff2",
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return Promise.allSettled(COQUILLE.map(function (u) { return c.add(new Request(u, { cache: "reload" })); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (cles) {
    return Promise.all(cles.filter(function (n) { return n.indexOf("eb-v") === 0 && n !== VERSION; })
      .map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

function mettreEnCache(req, rep) {
  if (rep && rep.ok && rep.type === "basic") {
    var copie = rep.clone();
    caches.open(VERSION).then(function (c) { c.put(req, copie); });
  }
  return rep;
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;
  var dansAppli = url.pathname.indexOf("/espace-breteuil/") === 0;
  var partage = url.pathname.indexOf("/assets/") === 0;
  if (!dansAppli && !partage) return;

  var reseauDabord = req.mode === "navigate" || /\.(json|ics|webmanifest)$/.test(url.pathname) || url.pathname.endsWith("/");
  if (reseauDabord) {
    e.respondWith(fetch(req).then(function (r) { return mettreEnCache(req, r); }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (m) {
        return m || (req.mode === "navigate" ? caches.match("./index.html") : Response.error());
      });
    }));
    return;
  }

  e.respondWith(caches.match(req).then(function (m) {
    var reseau = fetch(req).then(function (r) { return mettreEnCache(req, r); });
    if (m) { e.waitUntil(reseau.catch(function () {})); return m; }
    return reseau;
  }));
});
