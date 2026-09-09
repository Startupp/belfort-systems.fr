/* Belfort Systems — coffre client (bsv)
   Format de charge utile : base64( salt[16] || iv[12] || chiffré )
   Dérivation PBKDF2-SHA256, 310 000 itérations — chiffrement AES-GCM 256.
   Compatible avec les pages client déjà publiées. */
(function (global) {
  'use strict';
  var ITER = 310000;
  var enc = new TextEncoder(), dec = new TextDecoder();

  function b64e(bytes) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }
  function b64d(str) {
    return Uint8Array.from(atob(str.trim()), function (c) { return c.charCodeAt(0); });
  }
  async function derive(password, salt, usage) {
    var km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: ITER, hash: 'SHA-256' },
      km, { name: 'AES-GCM', length: 256 }, false, [usage]);
  }

  /** Chiffre du texte et renvoie la charge utile base64. */
  async function encrypt(plaintext, password) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var key = await derive(password, salt, 'encrypt');
    var ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(plaintext)));
    var out = new Uint8Array(16 + 12 + ct.length);
    out.set(salt, 0); out.set(iv, 16); out.set(ct, 28);
    return b64e(out);
  }

  /** Déchiffre une charge utile base64. Lève une erreur si le mot de passe est faux. */
  async function decrypt(payload, password) {
    var raw = b64d(payload);
    var salt = raw.slice(0, 16), iv = raw.slice(16, 28), ct = raw.slice(28);
    var key = await derive(password, salt, 'decrypt');
    return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct));
  }

  /** Monte le portail : déverrouille #payload et remplace le document. */
  function gate(opts) {
    var slug = opts.slug;
    var SKEY = 'bsv:' + slug;
    var form = document.getElementById(opts.form || 'gate');
    var input = document.getElementById(opts.input || 'pw');
    var err = document.getElementById(opts.error || 'err');
    var payload = function () { return document.getElementById('payload').textContent; };

    async function unlock(pw) {
      var html = await decrypt(payload(), pw);
      try { sessionStorage.setItem(SKEY, pw); } catch (e) {}
      document.open(); document.write(html); document.close();
    }

    (async function () {
      var saved = null;
      try { saved = sessionStorage.getItem(SKEY); } catch (e) {}
      if (saved) { try { await unlock(saved); return; } catch (e) { try { sessionStorage.removeItem(SKEY); } catch (_) {} } }
      if (form) form.hidden = false;
      if (input) input.focus();
    })();

    if (form) form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (err) err.textContent = '';
      var btn = form.querySelector('button');
      if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Ouverture…'; }
      try { await unlock(input.value); }
      catch (_) {
        if (err) err.textContent = 'Mot de passe incorrect.';
        input.select();
        if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; }
      }
    });
  }

  global.BSV = { encrypt: encrypt, decrypt: decrypt, gate: gate, ITERATIONS: ITER };
})(window);
