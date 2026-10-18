/* Espace Breteuil — service worker.
 * - Le numéro de version vient de version.js : le changer = nouvelle version publiée.
 * - Une nouvelle version s'installe en arrière-plan puis ATTEND : l'appli affiche
 *   « Nouvelle version disponible — Mettre à jour » (message SKIP_WAITING), ou
 *   l'active d'elle-même au lancement suivant (voir app.js).
 * - Coquille en cache : l'appli s'ouvre hors ligne.
 * - Pages, JSON, ICS : réseau d'abord, cache en secours. Le reste : cache d'abord.
 * Le planning (autre domaine : le Worker) est gardé par l'appli dans « eb-planning ».
 * Chemins relatifs : fonctionne sous /espace-breteuil/ comme sur un sous-domaine.
 */
importScripts("version.js");
var VERSION = "eb-v" + (self.EB_VERSION || "0");
var COQUILLE = [
  "./", "./index.html", "./app.css", "./prechargement.js", "./version.js", "./config.js",
  "./ics.js", "./demo.js", "./resume.js", "./droits.js", "./erreurs.js", "./graph.js", "./diagnostic.js", "./diagnostic.css", "./app.js", "./connecte.js",
  "./cache.js", "./profil.js", "./acces.js", "./deleguer.js", "./siteweb.js", "./siteweb-ecrans.js", "./suivi.js", "./suivi-ecrans.js", "./fichiers.js", "./epingles.js", "./boites-partagees.json",
  "./demos/demos.css", "./demos/donnees.js", "./demos/commun.js", "./demos/roles.js", "./demos/equipe.js",
  "./demos/boites.js", "./demos/finance.js", "./demos/securite.js",
  "./personnes.json", "./fiches.json", "./exemple.ics", "./exemple-accueil.ics", "./manifest.webmanifest",
  "./icones/icon-192.png", "./icones/icon.svg",
  "./polices/archivo-latin-400-normal.woff2", "./polices/archivo-latin-600-normal.woff2",
  "./polices/archivo-latin-700-normal.woff2", "./polices/spectral-latin-600-normal.woff2",
];
var PORTEE = new URL("./", self.location).pathname;

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return Promise.allSettled(COQUILLE.map(function (u) { return c.add(new Request(u, { cache: "reload" })); }));
  }));
  // Pas de skipWaiting ici : c'est l'appli qui décide du bon moment.
});

self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
  if (e.data && e.data.type === "VERSION" && e.ports && e.ports[0]) e.ports[0].postMessage(self.EB_VERSION);
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
  if (url.origin !== location.origin || url.pathname.indexOf(PORTEE) !== 0) return;
  if (/\/(sw|version)\.js$/.test(url.pathname)) return; // toujours le réseau

  var reseauDabord = req.mode === "navigate" || /\.(json|ics|webmanifest)$/.test(url.pathname) || /\/(config)\.js$/.test(url.pathname) || url.pathname.endsWith("/");
  if (reseauDabord) {
    e.respondWith(fetch(req).then(function (r) { return mettreEnCache(req, r); }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (m) {
        return m || (req.mode === "navigate" ? caches.match("./index.html") : Response.error());
      });
    }));
    return;
  }

  // Cache de CETTE version d'abord (cohérence des fichiers), puis réseau.
  e.respondWith(caches.open(VERSION).then(function (c) { return c.match(req); }).then(function (m) {
    return m || fetch(req).then(function (r) { return mettreEnCache(req, r); });
  }));
});
