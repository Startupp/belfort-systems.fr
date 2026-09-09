/* Espace client chateau-de-breteuil — cache applicatif */
var CACHE = 'bsv-chateau-de-breteuil-v1';
var SHELL = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png', '/favicon.svg'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.allSettled(SHELL.map(function (u) { return c.add(u); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (k) {
    return Promise.all(k.filter(function (n) { return n !== CACHE; }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

/* Pages : réseau d'abord, cache en secours hors ligne. Le contenu reste chiffré au repos. */
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  var isDoc = req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') > -1;
  if (isDoc) {
    e.respondWith(fetch(req).then(function (r) {
      var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); return r;
    }).catch(function () {
      return caches.match(req).then(function (m) { return m || caches.match('./'); });
    }));
    return;
  }
  e.respondWith(caches.match(req).then(function (m) {
    return m || fetch(req).then(function (r) {
      var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); return r;
    });
  }));
});
