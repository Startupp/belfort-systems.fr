/* Belfort Systems — logique de la console d'administration.
   Aucun secret n'est stocké : le registre local ne contient que noms, slugs et couleurs. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var REG = 'bsv:registry';

  /* ---------- onglets ---------- */
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.setAttribute('aria-selected', 'false'); });
      t.setAttribute('aria-selected', 'true');
      ['spaces', 'publish', 'rotate'].forEach(function (p) { $('p-' + p).hidden = (p !== t.dataset.p); });
    });
  });

  /* ---------- utilitaires ---------- */
  function slugify(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function download(name, text, mime) {
    var b = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function fileCard(name, content, mime) {
    var d = document.createElement('div'); d.className = 'card';
    d.innerHTML = '<div class="ic" style="background:linear-gradient(160deg,#2E2760,#7C6BD6)">↓</div>' +
      '<div class="meta"><b>' + esc(name) + '</b><small>' +
      (content.length > 1024 ? Math.round(content.length / 1024) + ' Ko' : content.length + ' octets') +
      '</small></div>';
    var b = document.createElement('button');
    b.className = 'btn ghost sm'; b.style.flex = 'none'; b.textContent = 'Télécharger';
    b.onclick = function () { download(name, content, mime); };
    d.appendChild(b);
    return d;
  }
  function dataURLtoCard(name, dataURL) {
    var d = document.createElement('div'); d.className = 'card';
    d.innerHTML = '<img src="' + dataURL + '" width="42" height="42" style="border-radius:11px;flex:none" alt="">' +
      '<div class="meta"><b>' + esc(name) + '</b><small>icône PNG</small></div>';
    var b = document.createElement('button');
    b.className = 'btn ghost sm'; b.style.flex = 'none'; b.textContent = 'Télécharger';
    b.onclick = function () { var a = document.createElement('a'); a.href = dataURL; a.download = name; a.click(); };
    d.appendChild(b);
    return d;
  }

  /* ---------- icônes générées ---------- */
  function icon(letter, color, size, maskable) {
    var c = document.createElement('canvas'); c.width = c.height = size;
    var x = c.getContext('2d');
    var pad = maskable ? size * 0.19 : 0, s = size - pad * 2, r = maskable ? s * 0.24 : size * 0.22;
    if (maskable) { x.fillStyle = color; x.fillRect(0, 0, size, size); }
    var g = x.createLinearGradient(pad, pad, pad, pad + s);
    g.addColorStop(0, color); g.addColorStop(1, '#7C6BD6');
    x.fillStyle = g; x.beginPath();
    if (x.roundRect) x.roundRect(pad, pad, s, s, r); else x.rect(pad, pad, s, s);
    x.fill();
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = '600 ' + Math.round(s * 0.56) + 'px Spectral, Georgia, serif';
    x.fillText(letter, size / 2, size / 2 + s * 0.03);
    return c.toDataURL('image/png');
  }

  function iconSvg(letter, color, maskable) {
    var e = function (t) { return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;'); };
    var head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">\n' +
      '  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + color + '"/><stop offset="1" stop-color="#7C6BD6"/>' +
      '</linearGradient></defs>\n';
    var body = maskable
      ? '  <rect width="512" height="512" fill="' + color + '"/>\n' +
        '  <rect x="97" y="97" width="318" height="318" rx="76" fill="url(#g)"/>\n' +
        '  <text x="256" y="345" font-family="Georgia,serif" font-size="186" font-weight="600" fill="#fff" text-anchor="middle">' + e(letter) + '</text>\n'
      : '  <rect width="512" height="512" rx="112" fill="url(#g)"/>\n' +
        '  <text x="256" y="360" font-family="Georgia,serif" font-size="300" font-weight="600" fill="#fff" text-anchor="middle">' + e(letter) + '</text>\n';
    return head + body + '</svg>\n';
  }

  /* ---------- gabarits ---------- */
  function pageTpl(slug, title, color, payload) {
    return '<!DOCTYPE html>\n<html lang="fr">\n<head>\n' +
'<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'<title>' + esc(title) + '</title>\n<meta name="robots" content="noindex, nofollow">\n' +
'<meta name="theme-color" content="' + color + '">\n' +
'<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n' +
'<link rel="apple-touch-icon" href="icon-180.png">\n' +
'<link rel="manifest" href="manifest.webmanifest">\n' +
'<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
'<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
'<link href="https://fonts.googleapis.com/css2?family=Spectral:wght@500;600&family=Archivo:wght@400;500;600;700&display=swap" rel="stylesheet">\n' +
'<link rel="stylesheet" href="/assets/portal.css">\n</head>\n<body>\n' +
'<div class="shell">\n  <main class="panel">\n' +
'    <a class="brand" href="/"><span class="mark" style="background:linear-gradient(160deg,' + color + ',#7C6BD6)">B</span><b>Belfort <span>Systems</span></b></a>\n' +
'    <h1>' + esc(title) + '</h1>\n' +
'    <p class="hint">Espace privé — saisissez le mot de passe qui vous a été communiqué.</p>\n' +
'    <form id="gate" hidden>\n' +
'      <div class="field"><label for="pw">Mot de passe</label>\n' +
'        <input id="pw" type="password" autocomplete="current-password" required></div>\n' +
'      <button class="btn" type="submit">Ouvrir</button>\n' +
'      <p class="err" id="err" role="alert"></p>\n    </form>\n' +
'    <p class="foot"><a href="mailto:damien.belfort@gmail.com">Contacter Belfort Systems</a></p>\n' +
'  </main>\n</div>\n' +
'<script type="text/plain" id="payload">' + payload + '<\/script>\n' +
'<script src="/assets/bsv.js"><\/script>\n' +
'<script>\n  BSV.gate({ slug: ' + JSON.stringify(slug) + ' });\n' +
'  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function(){});\n<\/script>\n' +
'</body>\n</html>\n';
  }

  function manifestTpl(slug, name, color) {
    return JSON.stringify({
      name: name + ' — Belfort Systems', short_name: name, lang: 'fr', dir: 'ltr',
      start_url: './', scope: './', display: 'standalone', orientation: 'portrait',
      background_color: '#F6F5FC', theme_color: color,
      description: 'Espace client ' + name + '. Documents chiffrés, accessibles avec votre mot de passe.',
      icons: [
        { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    }, null, 2);
  }

  function swTpl(slug) {
    return "/* Espace client " + slug + " — cache applicatif */\n" +
"var CACHE = 'bsv-" + slug + "-v1';\n" +
"var SHELL = ['./', './manifest.webmanifest', './icon.svg', './icon-maskable.svg',\n" +
"             '/assets/portal.css', '/assets/bsv.js', '/favicon.svg'];\n\n" +
"self.addEventListener('install', function (e) {\n" +
"  /* allSettled : un fichier absent ne fait pas echouer toute l'installation */\n" +
"  e.waitUntil(caches.open(CACHE).then(function (c) {\n" +
"    return Promise.allSettled(SHELL.map(function (u) { return c.add(u); }));\n" +
"  }).then(function () { return self.skipWaiting(); }));\n});\n\n" +
"self.addEventListener('activate', function (e) {\n" +
"  e.waitUntil(caches.keys().then(function (k) {\n" +
"    return Promise.all(k.filter(function (n) { return n !== CACHE; }).map(function (n) { return caches.delete(n); }));\n" +
"  }).then(function () { return self.clients.claim(); }));\n});\n\n" +
"/* Pages : réseau d'abord (pour recevoir les mises à jour), cache en secours hors ligne.\n" +
"   Ressources : cache d'abord. Le contenu reste chiffré, le cache ne révèle rien. */\n" +
"self.addEventListener('fetch', function (e) {\n" +
"  var req = e.request;\n" +
"  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;\n" +
"  if (req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') > -1) {\n" +
"    e.respondWith(fetch(req).then(function (r) {\n" +
"      var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); return r;\n" +
"    }).catch(function () { return caches.match(req).then(function (m) { return m || caches.match('./'); }); }));\n" +
"    return;\n  }\n" +
"  e.respondWith(caches.match(req).then(function (m) {\n" +
"    return m || fetch(req).then(function (r) {\n" +
"      var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); return r;\n" +
"    });\n  }));\n});\n";
  }

  function homeTpl(name) {
    return '<!DOCTYPE html>\n<html lang="fr"><head><meta charset="UTF-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'<title>' + esc(name) + ' — Espace client</title>\n' +
'<link rel="stylesheet" href="/assets/portal.css"></head>\n<body>\n<div class="shell">\n<main class="panel">\n' +
'  <a class="brand" href="/"><span class="mark">B</span><b>Belfort <span>Systems</span></b></a>\n' +
'  <h1>' + esc(name) + '</h1>\n' +
'  <p class="hint">Vos documents et outils.</p>\n' +
'  <div class="card"><div class="ic" style="background:linear-gradient(160deg,#2E2760,#7C6BD6)">◆</div>\n' +
'    <div class="meta"><b>Aucun document pour le moment</b><small>Les documents publiés apparaîtront ici.</small></div></div>\n' +
'  <p class="foot">Belfort Systems · <a href="tel:+33609897443">06 09 89 74 43</a></p>\n' +
'</main></div>\n</body></html>\n';
  }

  /* ---------- registre local ---------- */
  function reg() { try { return JSON.parse(localStorage.getItem(REG) || '[]'); } catch (e) { return []; } }
  function saveReg(r) { try { localStorage.setItem(REG, JSON.stringify(r)); } catch (e) {} }
  function renderReg() {
    var r = reg(), el = $('list'); el.innerHTML = '';
    if (!r.length) { el.innerHTML = '<p class="empty">Aucun espace enregistré sur cet appareil.</p>'; return; }
    r.forEach(function (s, i) {
      var d = document.createElement('div'); d.className = 'card';
      d.innerHTML = '<div class="ic" style="background:linear-gradient(160deg,' + s.color + ',#7C6BD6)">' +
        esc((s.name || '?')[0].toUpperCase()) + '</div><div class="meta"><b>' + esc(s.name) +
        '</b><small>/clients/' + esc(s.slug) + '/ · créé le ' + esc(s.created || '—') + '</small></div>';
      var open = document.createElement('a');
      open.className = 'btn ghost sm'; open.style.flex = 'none'; open.textContent = 'Ouvrir';
      open.href = '/clients/' + s.slug + '/'; open.target = '_blank'; open.rel = 'noopener';
      var del = document.createElement('button');
      del.className = 'btn ghost sm'; del.style.flex = 'none'; del.textContent = 'Retirer';
      del.onclick = function () {
        if (!confirm('Retirer « ' + s.name + ' » du registre ?\n\nLes fichiers en ligne ne sont pas supprimés.')) return;
        var a = reg(); a.splice(i, 1); saveReg(a); renderReg();
      };
      d.appendChild(open); d.appendChild(del);
      el.appendChild(d);
    });
  }
  renderReg();

  $('exp').onclick = function () { download('registre-espaces.json', JSON.stringify(reg(), null, 2), 'application/json'); };
  $('imp').onclick = function () {
    var i = document.createElement('input'); i.type = 'file'; i.accept = '.json';
    i.onchange = function () {
      var f = i.files[0]; if (!f) return;
      f.text().then(function (t) {
        try { var a = JSON.parse(t); if (Array.isArray(a)) { saveReg(a); renderReg(); } }
        catch (e) { alert('Fichier illisible.'); }
      });
    };
    i.click();
  };

  /* ---------- mot de passe proposé ---------- */
  var WORDS = ['aurore','banquise','cedre','dolmen','ecume','falaise','givre','hameau','isard','jonquille',
               'kayak','lagune','marbre','nacre','obsidienne','pergola','quinte','rivage','sillage','tourbe',
               'ubac','vallon','wagon','xenon','yourte','zephyr'];
  $('gen').onclick = function () {
    var n = crypto.getRandomValues(new Uint32Array(4));
    $('nPw').value = WORDS[n[0] % WORDS.length] + '-' + WORDS[n[1] % WORDS.length] + '-' +
                     WORDS[n[2] % WORDS.length] + '-' + (n[3] % 9000 + 1000);
  };
  $('nName').addEventListener('input', function () {
    if (!$('nSlug').dataset.touched) $('nSlug').value = slugify($('nName').value);
  });
  $('nSlug').addEventListener('input', function () { $('nSlug').dataset.touched = '1'; });

  /* ---------- créer un espace ---------- */
  $('create').onclick = async function () {
    var err = $('cErr'), out = $('cOut'); err.textContent = ''; out.innerHTML = '';
    var name = $('nName').value.trim(), slug = slugify($('nSlug').value || name);
    var color = $('nColor').value, pw = $('nPw').value;
    if (!name || !slug) { err.textContent = 'Nom et identifiant requis.'; return; }
    if (pw.length < 12) { err.textContent = 'Mot de passe : 12 caractères minimum.'; return; }
    var btn = this; btn.disabled = true; btn.textContent = 'Chiffrement…';
    try {
      var payload = await BSV.encrypt(homeTpl(name), pw);
      var letter = name[0].toUpperCase();
      out.appendChild(fileCard('clients/' + slug + '/index.html', pageTpl(slug, name, color, payload), 'text/html'));
      out.appendChild(fileCard('clients/' + slug + '/manifest.webmanifest', manifestTpl(slug, name, color), 'application/manifest+json'));
      out.appendChild(fileCard('clients/' + slug + '/sw.js', swTpl(slug), 'text/javascript'));
      out.appendChild(fileCard('clients/' + slug + '/icon.svg', iconSvg(letter, color, false), 'image/svg+xml'));
      out.appendChild(fileCard('clients/' + slug + '/icon-maskable.svg', iconSvg(letter, color, true), 'image/svg+xml'));
      out.appendChild(dataURLtoCard('clients/' + slug + '/icon-192.png', icon(letter, color, 192, false)));
      out.appendChild(dataURLtoCard('clients/' + slug + '/icon-512.png', icon(letter, color, 512, false)));
      out.appendChild(dataURLtoCard('clients/' + slug + '/icon-512-maskable.png', icon(letter, color, 512, true)));
      out.appendChild(dataURLtoCard('clients/' + slug + '/icon-180.png', icon(letter, color, 180, false)));
      var r = reg();
      if (!r.some(function (x) { return x.slug === slug; })) {
        r.push({ name: name, slug: slug, color: color, created: new Date().toISOString().slice(0, 10) });
        saveReg(r); renderReg();
      }
      var p = document.createElement('p'); p.className = 'ok';
      p.textContent = 'Espace prêt. Téléchargez les 9 fichiers et déposez-les dans clients/' + slug + '/ du dépôt.';
      out.appendChild(p);
    } catch (e) { err.textContent = 'Échec : ' + e.message; }
    btn.disabled = false; btn.textContent = 'Générer l’espace';
  };

  /* ---------- publier un document ---------- */
  $('dPick').onclick = function () { $('dInput').click(); };
  $('dInput').onchange = function () {
    var f = this.files[0]; if (!f) return;
    f.text().then(function (t) { $('dSrc').value = t; if (!$('dFile').value) $('dFile').value = f.name; });
  };
  $('dGo').onclick = async function () {
    var err = $('dErr'), out = $('dOut'); err.textContent = ''; out.innerHTML = '';
    var slug = slugify($('dSlug').value), file = $('dFile').value.trim() || 'document.html';
    var title = $('dTitle').value.trim() || 'Document — Belfort Systems';
    var pw = $('dPw').value, src = $('dSrc').value;
    if (!slug) { err.textContent = 'Espace requis.'; return; }
    if (!pw) { err.textContent = 'Mot de passe requis.'; return; }
    if (!src.trim()) { err.textContent = 'Contenu vide.'; return; }
    if (!/\.html?$/i.test(file)) file += '.html';
    var btn = this; btn.disabled = true; btn.textContent = 'Chiffrement…';
    try {
      var space = reg().filter(function (x) { return x.slug === slug; })[0];
      var payload = await BSV.encrypt(src, pw);
      out.appendChild(fileCard('clients/' + slug + '/' + file,
        pageTpl(slug, title, space ? space.color : '#2E2760', payload), 'text/html'));
      var p = document.createElement('p'); p.className = 'ok';
      p.textContent = 'Document chiffré (' + Math.round(payload.length / 1024) + ' Ko). Déposez-le dans clients/' + slug + '/';
      out.appendChild(p);
    } catch (e) { err.textContent = 'Échec : ' + e.message; }
    btn.disabled = false; btn.textContent = 'Chiffrer et générer la page';
  };

  /* ---------- rotation ---------- */
  $('rGo').onclick = async function () {
    var err = $('rErr'), out = $('rOut'); err.textContent = ''; out.innerHTML = '';
    var oldPw = $('rOld').value, newPw = $('rNew').value, files = $('rFiles').files;
    if (!oldPw || !newPw) { err.textContent = 'Les deux mots de passe sont requis.'; return; }
    if (newPw.length < 12) { err.textContent = 'Nouveau mot de passe : 12 caractères minimum.'; return; }
    if (!files.length) { err.textContent = 'Sélectionnez au moins une page.'; return; }
    var btn = this; btn.disabled = true; btn.textContent = 'Traitement…';
    var done = 0, failed = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      try {
        var html = await f.text();
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var node = doc.getElementById('payload');
        if (!node) throw new Error('pas de charge utile');
        var plain = await BSV.decrypt(node.textContent, oldPw);
        var fresh = await BSV.encrypt(plain, newPw);
        node.textContent = fresh;
        var rebuilt = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML + '\n';
        out.appendChild(fileCard(f.name, rebuilt, 'text/html'));
        done++;
      } catch (e) { failed++; out.appendChild(fileCard(f.name + ' — ÉCHEC (' + e.message + ')', '', 'text/plain')); }
    }
    var p = document.createElement('p'); p.className = failed ? 'err' : 'ok';
    p.textContent = done + ' page(s) re-chiffrée(s)' + (failed ? ', ' + failed + ' en échec — vérifiez l’ancien mot de passe.' : '.');
    out.appendChild(p);
    btn.disabled = false; btn.textContent = 'Re-chiffrer les pages';
  };
})();
