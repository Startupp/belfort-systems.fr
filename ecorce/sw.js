// TinKnight — le « service worker » : il garde une copie du jeu sur l'appareil pour qu'il se lance sans réseau,
// et c'est lui qui rend la page installable comme une application.
// Ce fichier est un modèle : build.mjs y inscrit la version et la liste des fichiers, puis l'écrit dans www/sw.js.
const CACHE = 'ecorce-7c3b02bddd';
const FILES = ["index.html","three.min.js","peerjs.min.js","manifest.webmanifest","modeles.js","modeles/liste.json","modeles/chevalier.glb","fonts/figtree-latin-400-normal.woff2","fonts/figtree-latin-600-normal.woff2","fonts/figtree-latin-700-normal.woff2","fonts/fonts.css","fonts/grenze-gotisch-latin-500-normal.woff2","fonts/grenze-gotisch-latin-700-normal.woff2","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png"];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { // une nouvelle version : les anciennes copies sont jetées
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('ecorce-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  if (r.mode === 'navigate') { // la page : le réseau d'abord (une mise à jour se voit au lancement suivant), la copie si l'appareil est hors ligne
    e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put('index.html', cp)); } return res; }).catch(() => caches.match('index.html')));
    return;
  }
  // le reste : la copie d'abord. Un modèle 3D (créature, arme) est gardé la première fois qu'il sert, pour rejouer hors ligne
  e.respondWith(caches.match(r, { ignoreSearch: true }).then(hit => hit || fetch(r).then(res => { if (res.ok && u.pathname.includes('/modeles/')) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); } return res; })));
});
