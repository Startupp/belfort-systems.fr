/* ============================================================
   Belfort Systems — tableau de bord auto-entrepreneur (/admin/)
   Écrit contre le contrat docs/TABLEAU-DE-BORD.md.
   - Une seule couche api() : fetch + Bearer (sessionStorage), 401 → connexion, 429 → attente.
   - Service injoignable → mode aperçu : données d'exemple admin/apercu/*.json, lecture seule.
   - Aucune donnée brute en innerHTML : passer par html`…` (échappement automatique) ou esc().
   ============================================================ */
(function () {
  'use strict';

  /* ---------- utilitaires ---------- */
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function Raw(s) { this.s = s; }
  function raw(s) { return new Raw(s); }
  /* Gabarit : toute valeur interpolée est échappée, sauf Raw (= déjà échappé) et tableaux de Raw. */
  function html(parts) {
    var out = parts[0];
    for (var i = 1; i < parts.length; i++) {
      out += val(arguments[i]) + parts[i];
    }
    return new Raw(out);
  }
  function val(v) {
    if (v instanceof Raw) return v.s;
    if (Array.isArray(v)) return v.map(val).join('');
    if (v === null || v === undefined || v === false) return '';
    return esc(v);
  }
  function render(el, r) { el.innerHTML = (r instanceof Raw) ? r.s : esc(r); }

  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var MOIS_C = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  function parseDate(s) {
    if (!s) return null;
    var d = new Date(s.length === 10 ? s + 'T12:00:00' : s);
    return isNaN(d) ? null : d;
  }
  function fmtDate(s) { var d = parseDate(s); if (!d) return 'à venir'; return d.getDate() + ' ' + MOIS_C[d.getMonth()] + ' ' + d.getFullYear(); }
  function fmtDateLong(s) { var d = parseDate(s); if (!d) return '—'; return d.getDate() + ' ' + MOIS[d.getMonth()] + ' ' + d.getFullYear(); }
  function fmtJour(s) { var d = parseDate(s); if (!d) return '—'; return d.getDate() + ' ' + MOIS_C[d.getMonth()]; }
  function fmtHeure(s) { var d = parseDate(s); if (!d) return ''; return (d.getHours() < 10 ? '0' : '') + d.getHours() + 'h' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); }
  function fmtDateHeure(s) { var d = parseDate(s); if (!d) return '—'; return fmtDate(s) + (s.length > 10 ? ' à ' + fmtHeure(s) : ''); }
  function aujourdhuiISO() { var d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function plusJours(iso, n) { var d = parseDate(iso) || new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function ecoule(s) {
    var d = parseDate(s); if (!d) return '';
    var j = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (j < 0) return 'dans ' + (-j) + ' j';
    if (j === 0) return 'aujourd’hui';
    if (j === 1) return 'hier';
    if (j < 30) return 'il y a ' + j + ' jours';
    var m = Math.floor(j / 30);
    return 'il y a ' + m + ' mois';
  }
  function euros(n) {
    n = Number(n) || 0;
    var s = n.toFixed(2).replace('.', ',');
    s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return s + ' €';
  }
  function slugify(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function uid(p) { return (p || 'x') + Math.random().toString(36).slice(2, 8); }
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, ms || 3200);
  }

  /* ---------- constantes métier ---------- */
  var STATUTS = { nouveau: 'Nouveau', lu: 'Lu', en_cours: 'En cours', repondu: 'Répondu', traite: 'Traité', abandonne: 'Abandonné', partiel: 'Partiel' };
  var A_TRAITER = ['nouveau', 'lu', 'en_cours', 'partiel'];
  var TARIFS = { forfait: 'Forfait', extra: 'En plus', offert: 'Offert', devis: 'Devis' };
  var TYPES_EVT = { echange: 'Échange', livrable: 'Livrable', site: 'Sur site', decision: 'Décision', facture: 'Facture' };
  var CANAUX = ['Mail', 'WhatsApp', 'SMS', 'Téléphone', 'Sur place'];
  var STATUTS_CONTACT = { nouveau: 'Nouveau', lu: 'Lu', repondu: 'Répondu', archive: 'Archivé' };
  var STATUTS_MESSAGE = { nouveau: 'Nouveau', lu: 'Lu', repondu: 'Répondu', classe: 'Classé' };
  var STATUTS_FACT = { brouillon: 'Brouillon', envoyee: 'Envoyée', payee: 'Payée', annulee: 'Annulée' };
  var SOLUTIONS = ['Réglage corrigé à distance', 'Expliqué par téléphone', 'Guide envoyé', 'Réglé sur place', 'Transmis au prestataire concerné'];
  var MOI = { nom: 'Damien Belfort', entreprise: 'Belfort Systems', adresse: '7 square des Genêts', cp: '78114', ville: 'Magny-les-Hameaux',
    siret: '894 449 032 00024', tel: '06 09 89 74 43', email: 'contact@belfort-systems.fr', site: 'belfort-systems.fr' };
  var SIGNATURE = 'Damien Belfort — Belfort Systems — 06 09 89 74 43';

  /* ---------- état ---------- */
  var BS_API = (typeof window.BS_API === 'string' && window.BS_API) ? window.BS_API.replace(/\/$/, '') : '';
  var JETON_CLE = 'bs-admin-jeton';
  var etat = { demo: false, jeton: null, catalogue: null, cache: {}, essais: 0, flux: null, minuterie: null };
  function jeton() { try { return sessionStorage.getItem(JETON_CLE); } catch (e) { return etat.jeton; } }
  function setJeton(t) { etat.jeton = t; try { if (t) sessionStorage.setItem(JETON_CLE, t); else sessionStorage.removeItem(JETON_CLE); } catch (e) {} }

  /* ---------- couche API unique ---------- */
  function DemoError() { this.demo = true; this.message = 'Démo : rien n’est enregistré'; }
  function ApiError(code, msg) { this.code = code; this.message = msg; }

  async function api(chemin, options) {
    options = options || {};
    var methode = (options.method || 'GET').toUpperCase();
    if (etat.demo) return apiDemo(chemin, methode, options.body);
    var entetes = { 'Accept': 'application/json' };
    var t = jeton();
    if (t) entetes['Authorization'] = 'Bearer ' + t;
    var init = { method: methode, headers: entetes, cache: 'no-store' };
    if (options.body !== undefined) { entetes['Content-Type'] = 'application/json'; init.body = JSON.stringify(options.body); }
    var rep;
    try {
      rep = await fetch(BS_API + chemin, init);
    } catch (e) {
      throw new ApiError(0, 'Service injoignable. Vérifiez la connexion.');
    }
    var corps = null;
    try { corps = await rep.json(); } catch (e) { corps = null; }
    if (rep.status === 401) {
      if (chemin !== '/admin/login') { setJeton(null); deconnecte('Session expirée : reconnectez-vous.'); }
      throw new ApiError(401, (corps && corps.erreur) || 'Mot de passe refusé.');
    }
    if (rep.status === 429) {
      var attente = rep.headers.get('Retry-After');
      throw new ApiError(429, 'Trop de tentatives. Patientez ' + (attente ? attente + ' s' : 'un quart d’heure') + ' avant de réessayer.');
    }
    if (!rep.ok) throw new ApiError(rep.status, (corps && corps.erreur) || ('Erreur ' + rep.status));
    return corps;
  }

  /* Données d'exemple (lecture seule) */
  async function chargerApercu(nom) {
    if (etat.cache[nom]) return etat.cache[nom];
    var rep = await fetch('/admin/apercu/' + nom + '.json', { cache: 'no-store' });
    if (!rep.ok) throw new ApiError(rep.status, 'Données d’exemple introuvables : ' + nom);
    var j = await rep.json();
    etat.cache[nom] = j;
    return j;
  }
  async function apiDemo(chemin, methode) {
    if (methode !== 'GET') throw new DemoError();
    var c = chemin.split('?')[0];
    if (c === '/admin/resume') return chargerApercu('resume');
    if (c === '/admin/premier-contact') return chargerApercu('premier-contact');
    if (c === '/admin/publications') return chargerApercu('publications');
    if (c === '/admin/contacts') return chargerApercu('contacts');
    if (c === '/admin/projets') return chargerApercu('projets');
    if (/^\/admin\/projets\/[^/]+$/.test(c)) return chargerApercu('projet-exemple');
    if (c === '/admin/factures') return chargerApercu('factures');
    if (c === '/admin/clients') return chargerApercu('clients');
    if (c === '/admin/journal') return chargerApercu('journal');
    throw new ApiError(404, 'Pas de données d’exemple pour ' + c);
  }

  /* Détection : le service répond-il ? (401 attendu sans jeton = en ligne) */
  async function detecterService() {
    if (!BS_API) return false;
    var ctrl = new AbortController(); var tm = setTimeout(function () { ctrl.abort(); }, 4000);
    try {
      var r = await fetch(BS_API + '/admin/resume', { signal: ctrl.signal, cache: 'no-store', headers: { 'Accept': 'application/json' } });
      clearTimeout(tm);
      return r.status > 0;
    } catch (e) { clearTimeout(tm); return false; }
  }

  /* ---------- connexion / déconnexion ---------- */
  function montrerConnexion() {
    $('app').hidden = true; $('ecran-connexion').hidden = false;
    $('note-demo').hidden = !etat.demo;
    $('mdp').value = '';
    setTimeout(function () { $('mdp').focus(); }, 50);
  }
  function montrerApp() {
    $('ecran-connexion').hidden = true; $('app').hidden = false;
    demarrerFlux();
    router();
  }
  function deconnecte(msg) {
    arreterFlux();
    setJeton(null);
    etat.cache = {};
    montrerConnexion();
    if (msg) { $('err-connexion').textContent = msg; }
  }
  $('form-connexion').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var err = $('err-connexion'); err.textContent = '';
    var mdp = $('mdp').value;
    if (!mdp) { err.textContent = 'Saisissez le mot de passe.'; return; }
    var b = $('btn-entrer'); b.disabled = true;
    try {
      if (etat.demo) {
        setJeton('demo-' + uid());
      } else {
        var r = await api('/admin/login', { method: 'POST', body: { password: mdp } });
        if (!r || !r.token) throw new ApiError(500, 'Réponse inattendue du service.');
        setJeton(r.token);
      }
      $('mdp').value = '';
      etat.essais = 0; majCompteurEssais();
      montrerApp();
    } catch (e) {
      $('mdp').value = '';
      if (e.code === 401) { etat.essais++; majCompteurEssais(); err.textContent = 'Mot de passe refusé.' + (etat.essais >= 5 ? ' Limite atteinte : attendez un quart d’heure.' : ''); }
      else err.textContent = e.message || 'Connexion impossible.';
    }
    b.disabled = false;
  });
  function majCompteurEssais() {
    var reste = Math.max(0, 5 - etat.essais);
    $('compteur-essais').textContent = etat.essais ? reste + ' essai' + (reste > 1 ? 's' : '') + ' restant' + (reste > 1 ? 's' : '') + ' sur 5 par quart d’heure' : '5 essais par quart d’heure';
  }
  $('btn-deconnexion').addEventListener('click', async function () {
    try { if (!etat.demo) await api('/admin/logout', { method: 'POST' }); } catch (e) { /* on déconnecte quand même */ }
    deconnecte();
    toast('Déconnecté.');
  });

  /* ---------- flux en direct (SSE) ---------- */
  function setDirect(on) {
    var d = $('direct'); d.classList.toggle('on', !!on);
    d.querySelector('.direct-txt').textContent = on ? 'En direct' : 'Hors ligne';
  }
  function demarrerFlux() {
    arreterFlux();
    if (etat.demo || !('EventSource' in window)) { setDirect(false); return; }
    try {
      /* Le contrat accepte Bearer ; EventSource ne permet pas d'en-tête, donc le jeton passe en ?t= (voir admin/NOTES.md). */
      var es = new EventSource(BS_API + '/admin/flux?t=' + encodeURIComponent(jeton() || ''));
      etat.flux = es;
      es.onopen = function () { setDirect(true); };
      es.onerror = function () { setDirect(false); if (!etat.minuterie) etat.minuterie = setInterval(rafraichir, 15000); };
      es.addEventListener('maj', function (ev) {
        var d = null; try { d = JSON.parse(ev.data); } catch (e) {}
        etat.cache = {};
        rafraichir(d);
      });
      es.onmessage = function () { etat.cache = {}; rafraichir(); };
    } catch (e) { setDirect(false); etat.minuterie = setInterval(rafraichir, 15000); }
  }
  function arreterFlux() {
    if (etat.flux) { try { etat.flux.close(); } catch (e) {} etat.flux = null; }
    if (etat.minuterie) { clearInterval(etat.minuterie); etat.minuterie = null; }
    setDirect(false);
  }
  function rafraichir() {
    if ($('app').hidden || $('dialogue').open) return;
    if (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    router(true);
  }

  /* ---------- dialogue générique (aperçu + confirmation) ---------- */
  var dlg = $('dialogue');
  /* opts : {titre, corps (Raw), champs:[{id,label,type,options,requis,valeur,aide}], apercu:[{champ,avant,apres}], valider:'Confirmer', danger, action(valeurs)} */
  function dialogue(opts) {
    return new Promise(function (resolve) {
      $('dialogue-titre').textContent = opts.titre || '';
      var corps = [];
      if (opts.corps) corps.push(opts.corps);
      if (opts.apercu && opts.apercu.length) {
        corps.push(html`<div class="apercu-chg"><b>Ce qui va changer</b><dl>${opts.apercu.map(function (a) {
          return html`<dt>${a.champ}</dt><dd>${a.avant !== undefined && a.avant !== '' && a.avant !== null ? html`<span class="avant">${a.avant}</span>` : ''}<span class="apres">${a.apres}</span></dd>`;
        })}</dl></div>`);
      }
      (opts.champs || []).forEach(function (c) {
        var id = 'dlg-' + c.id;
        var champ;
        if (c.type === 'select') {
          champ = html`<select id="${id}" name="${c.id}" ${c.requis ? 'required' : ''}>${(c.options || []).map(function (o) {
            var v = typeof o === 'string' ? o : o.valeur, l = typeof o === 'string' ? o : o.libelle;
            return html`<option value="${v}" ${v === c.valeur ? 'selected' : ''}>${l}</option>`;
          })}</select>`;
        } else if (c.type === 'textarea') {
          champ = html`<textarea id="${id}" name="${c.id}" ${c.requis ? 'required' : ''} placeholder="${c.placeholder || ''}">${c.valeur || ''}</textarea>`;
        } else if (c.type === 'phrases') {
          champ = html`<div class="puces" role="group" aria-label="Phrases prêtes">${(c.phrases || []).map(function (p) {
            return html`<button type="button" class="puce" data-phrase="${p}" data-cible="${id}">${p}</button>`;
          })}</div><textarea id="${id}" name="${c.id}" ${c.requis ? 'required' : ''} placeholder="${c.placeholder || ''}">${c.valeur || ''}</textarea>`;
        } else {
          champ = html`<input id="${id}" name="${c.id}" type="${c.type || 'text'}" value="${c.valeur || ''}" ${c.requis ? 'required' : ''} placeholder="${c.placeholder || ''}" ${c.attrs ? raw(c.attrs) : ''}>`;
        }
        corps.push(html`<div class="field"><label for="${id}">${c.label}${c.requis ? ' *' : ''}</label>${champ}${c.aide ? html`<p class="aide">${c.aide}</p>` : ''}</div>`);
      });
      render($('dialogue-corps'), html`${corps}`);
      $('dialogue-err').textContent = '';
      render($('dialogue-actions'), html`<button type="button" class="btn ghost" data-dlg="annuler">${opts.annuler || 'Annuler'}</button>
        ${opts.valider === null ? '' : html`<button type="submit" class="btn ${opts.danger ? 'danger' : ''}" data-dlg="valider">${opts.valider || 'Confirmer'}</button>`}`);
      $('dialogue-corps').querySelectorAll('.puce[data-phrase]').forEach(function (b) {
        b.addEventListener('click', function () { var t = $(b.dataset.cible); t.value = b.dataset.phrase; t.focus(); });
      });
      var fini = false;
      function fermer(res) { if (fini) return; fini = true; dlg.close(); resolve(res); }
      $('dialogue-actions').querySelector('[data-dlg="annuler"]').onclick = function () { fermer(null); };
      $('dialogue-form').onsubmit = async function (ev) {
        ev.preventDefault();
        var valeurs = {};
        var manque = null;
        (opts.champs || []).forEach(function (c) {
          var el = $('dlg-' + c.id); var v = el ? el.value.trim() : '';
          valeurs[c.id] = v;
          if (c.requis && !v && !manque) manque = c.label;
        });
        if (manque) { $('dialogue-err').textContent = 'Le champ « ' + manque + ' » est obligatoire.'; return; }
        if (opts.action) {
          var b = $('dialogue-actions').querySelector('[data-dlg="valider"]'); if (b) b.disabled = true;
          try { await opts.action(valeurs); }
          catch (e) {
            if (b) b.disabled = false;
            if (e && e.demo) { fermer({ demo: true }); toast('Démo : rien n’est enregistré.'); return; }
            $('dialogue-err').textContent = e.message || 'Échec.'; return;
          }
        }
        fermer(valeurs);
      };
      dlg.oncancel = function (ev) { ev.preventDefault(); fermer(null); };
      dlg.showModal();
      var premier = $('dialogue-corps').querySelector('input,select,textarea,button');
      if (premier) premier.focus();
    });
  }
  /* Action standard : aperçu → confirmation → appel API → message → rechargement de la vue */
  async function action(opts) {
    var r = await dialogue(opts);
    if (r && !r.demo) { toast(opts.succes || 'Enregistré.'); etat.cache = {}; router(true); }
    return r;
  }

  /* ---------- routeur ---------- */
  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('/').filter(Boolean).map(decodeURIComponent);
    return parts.length ? parts : ['premier'];
  }
  function naviguer(h) { location.hash = '#/' + h; }
  var VUES = { premier: vuePremierContact, aujourdhui: vueAujourdhui, boite: vueBoite, projets: vueProjets, factures: vueFactures, publications: vuePublications, outils: vueOutils, clients: vueClients, reglages: vueReglages, plus: vuePlus, espaces: vueEspaces };
  var SOUS_PLUS = ['factures', 'publications', 'outils', 'clients', 'reglages', 'espaces'];
  var rendu = 0;
  async function router(silencieux) {
    if ($('app').hidden) return;
    var p = route(); var nom = VUES[p[0]] ? p[0] : 'premier';
    document.querySelectorAll('.nav a').forEach(function (a) {
      var n = a.dataset.nav; var actif = n === nom || (n === 'plus' && SOUS_PLUS.indexOf(nom) >= 0 && a.classList.contains('nav-petit'));
      a.classList.toggle('actif', actif);
      if (actif) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var vue = $('vue'), legacy = $('ecran-espaces');
    if (nom === 'espaces') { vue.hidden = true; legacy.hidden = false; return; }
    legacy.hidden = true; vue.hidden = false;
    var id = ++rendu;
    if (!silencieux) { render(vue, html`<p class="vide">Chargement…</p>`); window.scrollTo(0, 0); }
    try {
      var r = await VUES[nom](p.slice(1));
      if (id !== rendu) return;
      render(vue, r);
      brancher(vue);
    } catch (e) {
      if (id !== rendu) return;
      render(vue, html`<div class="carte"><h2>Impossible d’afficher cet écran</h2><p class="err">${e.message || 'Erreur inconnue'}</p>
        <div class="actions"><button class="btn ghost sm" type="button" data-act="recharger">Réessayer</button></div></div>`);
      brancher(vue);
    }
    majBadgeBoite();
  }
  window.addEventListener('hashchange', function () { router(false); });

  /* Branchement des actions déléguées (data-act) */
  var ACTIONS = {};
  function brancher(racine) {
    racine.querySelectorAll('[data-act]').forEach(function (el) {
      if (el._branche) return; el._branche = true;
      el.addEventListener('click', function (ev) {
        var f = ACTIONS[el.dataset.act];
        if (!f) return;
        ev.preventDefault();
        f(el.dataset, el).catch(function (e) {
          if (e && e.demo) toast(e.message); else toast(e.message || 'Échec.');
        });
      });
    });
    racine.querySelectorAll('[data-nav-to]').forEach(function (el) {
      el.addEventListener('click', function () { naviguer(el.dataset.navTo); });
    });
  }
  ACTIONS.recharger = async function () { etat.cache = {}; router(); };

  async function majBadgeBoite() {
    try {
      var r = await api('/admin/resume'); var n = r.contacts_nouveaux || 0;
      var b = $('badge-boite'); b.hidden = !n; b.textContent = n;
      var m = r.messages_nouveaux || 0;
      var bp = $('badge-premier'); if (bp) { bp.hidden = !m; bp.textContent = m; }
    } catch (e) {}
  }

  /* ============================================================
     ÉCRAN : PREMIER CONTACT (messages du formulaire du site)
     Source : base belfort_contact du Worker belfort-contact, lue par
     GET /admin/premier-contact ; statut et note dans contacts_suivi.
     ============================================================ */
  /* Numéro français (06 12 34 56 78, +33 6…, 0033 6…) → 33612345678 ; sinon null. */
  function telInternational(t) {
    var d = String(t || '').replace(/[^\d+]/g, '');
    if (/^\+33[1-9]\d{8}$/.test(d)) return d.slice(1);
    if (/^0033[1-9]\d{8}$/.test(d)) return d.slice(2);
    if (/^0[1-9]\d{8}$/.test(d)) return '33' + d.slice(1);
    return null;
  }
  function prenom(nom) { return (nom || '').trim().split(/\s+/)[0] || ''; }
  function citer(texte) { return String(texte || '').split('\n').map(function (l) { return '> ' + l; }).join('\n'); }
  function mailtoMessage(m) {
    var corps = 'Bonjour ' + prenom(m.nom) + ',\n\nMerci pour votre message au sujet de « ' + (m.sujet || 'votre demande') + ' ».\n\n1. \n2. \n3. \n\nBien cordialement,\n' + SIGNATURE +
      '\n\n' + citer('Le ' + fmtDateHeure(m.recu_le) + ', ' + m.nom + ' a écrit :\n' + (m.message || ''));
    return 'mailto:' + encodeURIComponent(m.email || '') + '?subject=' + encodeURIComponent('Re : ' + (m.sujet || 'votre demande') + ' — Belfort Systems') + '&body=' + encodeURIComponent(corps);
  }
  function whatsappMessage(m) {
    var n = telInternational(m.tel); if (!n) return '';
    var texte = 'Bonjour ' + prenom(m.nom) + ', Damien Belfort (Belfort Systems). Merci pour votre message au sujet de « ' + (m.sujet || 'votre demande') + ' » envoyé depuis belfort-systems.fr. Quand puis-je vous appeler ?';
    return 'https://wa.me/' + n + '?text=' + encodeURIComponent(texte);
  }
  async function vuePremierContact() {
    var r = await api('/admin/premier-contact');
    var messages = (r.messages || []).slice().sort(function (a, b) { return String(b.recu_le || '').localeCompare(String(a.recu_le || '')); });
    var filtre = etat.filtrePremier || 'a_traiter';
    var liste = messages.filter(function (m) {
      var st = m.statut || 'nouveau';
      return filtre === 'tous' ? true : filtre === 'a_traiter' ? (st === 'nouveau' || st === 'lu') : st === filtre;
    });
    var nb = messages.filter(function (m) { return (m.statut || 'nouveau') === 'nouveau'; }).length;
    return html`
      <div class="entete-vue"><div><h1>Premier contact</h1><p class="hint">Messages reçus par le formulaire du site, du plus récent au plus ancien${nb ? ' — ' + nb + ' nouveau' + (nb > 1 ? 'x' : '') : ''}.</p></div></div>
      <div class="puces" role="group" aria-label="Filtrer">${[['a_traiter', 'À traiter'], ['nouveau', 'Nouveaux'], ['repondu', 'Répondus'], ['classe', 'Classés'], ['tous', 'Tous']].map(function (f) {
        return html`<button type="button" class="puce" aria-pressed="${filtre === f[0]}" data-act="filtre-premier" data-f="${f[0]}">${f[1]}</button>`;
      })}</div>
      <div class="carte">${liste.length ? liste.map(ligneMessage) : html`<p class="vide">Aucun message dans cette liste.</p>`}</div>
      <p class="aide">« Répondre par e-mail » ouvre votre messagerie avec un brouillon signé « ${SIGNATURE} » et le message cité ; « WhatsApp » ouvre une conversation avec un texte prêt. Pensez ensuite à cliquer « Répondu ».</p>`;
  }
  function ligneMessage(m) {
    var st = m.statut || 'nouveau';
    var wa = whatsappMessage(m);
    var tel = String(m.tel || '').trim();
    return html`<article class="message ${st}" id="msg-${m.id}">
      <div class="tete"><b>${m.sujet || '(sans objet)'}</b><span class="quand">${fmtDateHeure(m.recu_le)} · ${ecoule(m.recu_le)}</span></div>
      <div class="coord"><span><b>${m.nom}</b></span>${m.email ? html`<a href="mailto:${m.email}">${m.email}</a>` : ''}${tel ? html`<a href="tel:${tel.replace(/[^\d+]/g, '')}">${tel}</a>` : ''}</div>
      <div class="infos"><span class="etiquette ${st}">${STATUTS_MESSAGE[st] || st}</span>
        <span>Formule : <b>${m.formule || '—'}</b></span><span>Créneau : <b>${m.creneau ? fmtDateHeure(m.creneau) : '—'}</b></span>${m.suivi_le ? html`<span>Suivi : ${fmtDateHeure(m.suivi_le)}</span>` : ''}</div>
      <p class="texte">${m.message}</p>
      ${m.note ? html`<p class="note-suivi">Note : ${m.note}</p>` : ''}
      <div class="actions">
        <a class="btn sm" href="${mailtoMessage(m)}" data-act="msg-repondre" data-id="${m.id}" data-statut="${st}">Répondre par e-mail</a>
        ${wa ? html`<a class="btn ghost sm" href="${wa}" target="_blank" rel="noopener" data-act="msg-repondre" data-id="${m.id}" data-statut="${st}">WhatsApp</a>` : ''}
        ${st === 'nouveau' ? html`<button type="button" class="btn ghost sm" data-act="msg-statut" data-id="${m.id}" data-apres="lu">Marquer lu</button>` : ''}
        ${st !== 'repondu' ? html`<button type="button" class="btn ghost sm" data-act="msg-statut" data-id="${m.id}" data-apres="repondu">Répondu</button>` : ''}
        ${st !== 'classe' ? html`<button type="button" class="btn ghost sm" data-act="msg-statut" data-id="${m.id}" data-apres="classe">Classer</button>` : html`<button type="button" class="btn ghost sm" data-act="msg-statut" data-id="${m.id}" data-apres="lu">Rouvrir</button>`}
        <button type="button" class="btn ghost sm" data-act="msg-note" data-id="${m.id}" data-note="${m.note || ''}">Note</button>
      </div></article>`;
  }
  ACTIONS['filtre-premier'] = async function (d) { etat.filtrePremier = d.f; router(true); };
  ACTIONS['msg-statut'] = async function (d) {
    await api('/admin/premier-contact/' + d.id, { method: 'PATCH', body: { statut: d.apres } });
    etat.cache = {}; toast('Message : ' + STATUTS_MESSAGE[d.apres] + '.'); router(true);
  };
  ACTIONS['msg-repondre'] = async function (d, el) {
    var href = el.getAttribute('href');
    if (el.getAttribute('target') === '_blank') window.open(href, '_blank', 'noopener'); else window.location.href = href;
    if (d.statut === 'nouveau') { try { await api('/admin/premier-contact/' + d.id, { method: 'PATCH', body: { statut: 'lu' } }); etat.cache = {}; router(true); } catch (e) {} }
  };
  ACTIONS['msg-note'] = async function (d) {
    await action({ titre: 'Note sur ce message', champs: [{ id: 'note', label: 'Note (pour vous seul)', type: 'textarea', valeur: d.note, placeholder: 'Rappelé le 12, devis à envoyer…' }],
      valider: 'Enregistrer', action: function (v) { return api('/admin/premier-contact/' + d.id, { method: 'PATCH', body: { note: v.note } }); }, succes: 'Note enregistrée.' });
  };

  /* ============================================================
     ÉCRAN : PUBLICATIONS (demandes de fusion GitHub → mise en ligne)
     GET /admin/publications ; POST /admin/publications/:numero/fusionner.
     Sans jeton GitHub côté serveur : {configure:false}, bouton désactivé.
     ============================================================ */
  async function vuePublications() {
    var r = await api('/admin/publications');
    var pulls = r.pulls || [];
    var ok = !!r.configure;
    return html`
      <div class="entete-vue"><div><h1>Publications</h1><p class="hint">Modifications proposées sur le site (dépôt ${r.depot || 'Startupp/belfort-systems.fr'}). « Review & Merge » met en ligne après confirmation.</p></div>
        <button type="button" class="btn ghost sm" data-act="recharger">Actualiser</button></div>
      ${ok ? '' : html`<p class="note avert"><strong>Jeton GitHub non configuré.</strong> Ajoutez le secret <code>ADMIN_GITHUB_TOKEN</code> au dépôt GitHub (jeton fine-grained limité au dépôt, droits Contents et Pull requests en lecture/écriture) puis relancez le déploiement du Worker.</p>`}
      <div class="carte">${pulls.length ? pulls.map(function (p) {
        return html`<article class="pr" id="pr-${p.numero}">
          <div class="tete"><b>${p.titre}</b><span class="numero">#${p.numero}</span></div>
          <div class="meta"><span class="branche">${p.branche}</span><span>→ ${p.cible || 'main'}</span><span>ouverte ${ecoule(p.cree)}</span>${p.maj && p.maj !== p.cree ? html`<span>· mise à jour ${ecoule(p.maj)}</span>` : ''}${p.auteur ? html`<span>· ${p.auteur}</span>` : ''}${p.brouillon ? html`<span class="etiquette brouillon">Brouillon</span>` : ''}</div>
          <div class="actions">
            <a class="btn ghost sm" href="${p.apercu}" target="_blank" rel="noopener">Aperçu</a>
            <a class="btn ghost sm" href="${p.url}" target="_blank" rel="noopener">Voir sur GitHub</a>
            <button type="button" class="btn sm" data-act="pr-fusionner" data-numero="${p.numero}" data-titre="${p.titre}" data-branche="${p.branche}" data-cible="${p.cible || 'main'}" ${ok && !p.brouillon ? '' : 'disabled'} title="${ok ? (p.brouillon ? 'Brouillon : à finaliser sur GitHub d’abord' : 'Fusionner dans ' + (p.cible || 'main')) : 'Jeton GitHub non configuré'}">Review &amp; Merge</button>
          </div></article>`;
      }) : html`<p class="vide">${ok ? 'Aucune modification en attente.' : 'Jeton GitHub non configuré : la liste ne peut pas être lue.'}</p>`}</div>
      <p class="aide">L’aperçu Cloudflare Pages d’une branche est à <code>https://&lt;branche&gt;.belfort-systems-fr.pages.dev</code> (branche en minuscules, caractères spéciaux remplacés par des tirets). Après fusion, le site se met à jour en une à deux minutes.</p>`;
  }
  ACTIONS['pr-fusionner'] = async function (d) {
    await action({ titre: 'Fusionner « ' + d.titre + ' » dans ' + d.cible + ' ?', danger: false, valider: 'Fusionner et publier',
      corps: html`<p>La branche <code>${d.branche}</code> sera fusionnée dans <code>${d.cible}</code> (fusion classique) et le site sera mis en ligne par Cloudflare Pages. Cette action ne se défait pas depuis ici.</p>
        <p class="petit">Vérifiez d’abord l’aperçu sur téléphone puis sur PC.</p>`,
      action: function () { return api('/admin/publications/' + d.numero + '/fusionner', { method: 'POST' }); }, succes: 'Fusionnée : mise en ligne en cours.' });
  };

  /* ============================================================
     ÉCRAN : OUTILS (raccourcis ; liste dans admin/outils.js)
     ============================================================ */
  var ICONES = {
    indy: '<path d="M4 7h16v10H4z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 11h8M8 14h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 9a4.5 4.5 0 0 1 .5 9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    github: '<path d="M12 3a9 9 0 0 0-2.8 17.5c.4.1.6-.2.6-.4v-1.6c-2.5.5-3-1.1-3-1.1-.4-1-1-1.3-1-1.3-.8-.6.1-.6.1-.6.9.1 1.4.9 1.4.9.8 1.4 2.1 1 2.6.8.1-.6.3-1 .6-1.2-2-.2-4.1-1-4.1-4.4 0-1 .3-1.8.9-2.4-.1-.2-.4-1.2.1-2.4 0 0 .8-.2 2.5.9a8.6 8.6 0 0 1 4.6 0c1.7-1.1 2.5-.9 2.5-.9.5 1.2.2 2.2.1 2.4.6.6.9 1.4.9 2.4 0 3.4-2.1 4.2-4.1 4.4.3.3.6.8.6 1.6v2.4c0 .2.2.5.6.4A9 9 0 0 0 12 3z" fill="currentColor"/>',
    actions: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 9l5 3-5 3z" fill="currentColor"/>',
    loupe: '<circle cx="10.5" cy="10.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    fiche: '<path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="11" r="2" fill="currentColor"/>',
    notion: '<path d="M6 4h10l2 2v14H6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 9v6M9 9l6 6V9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    linkedin: '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 10v6M8 7.5v.2M12 16v-3.5a2 2 0 0 1 4 0V16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    canva: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M14.5 10a3 3 0 1 0 0 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    malt: '<path d="M7 17l10-10M7 7l10 10M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    urssaf: '<path d="M5 20V9l7-5 7 5v11z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 20v-6h6v6" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    inpi: '<path d="M6 4h12v16H6z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 8h6M9 12h6M9 16h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    kit: '<path d="M4 8h16v11H4z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 8V6h6v2M4 13h16" fill="none" stroke="currentColor" stroke-width="1.8"/>'
  };
  function iconeOutil(o) {
    if (o.ico && ICONES[o.ico]) return html`<span class="ico"><svg viewBox="0 0 24 24" aria-hidden="true">${raw(ICONES[o.ico])}</svg></span>`;
    return html`<span class="ico">${(o.lettre || o.nom || '?').slice(0, 2)}</span>`;
  }
  async function vueOutils() {
    var outils = Array.isArray(window.BS_OUTILS) ? window.BS_OUTILS : [];
    return html`
      <div class="entete-vue"><div><h1>Outils</h1><p class="hint">Raccourcis vers les services utilisés au quotidien. Chaque lien s’ouvre dans un nouvel onglet ; la liste se modifie dans <code>admin/outils.js</code>.</p></div></div>
      <div class="outils-grille">${outils.map(function (o) {
        var hote = o.hote; if (hote === undefined) { try { hote = new URL(o.url).host.replace(/^www\./, ''); } catch (e) { hote = ''; } }
        return html`<a class="outil" href="${o.url}" target="_blank" rel="noopener">${iconeOutil(o)}<span class="corps"><b>${o.nom}</b><small>${o.ligne || ''}</small><span class="lien">${hote}</span></span></a>`;
      })}</div>
      ${outils.length ? '' : html`<p class="vide">Aucun raccourci : vérifiez <code>admin/outils.js</code>.</p>`}`;
  }

  /* ============================================================
     ÉCRAN : AUJOURD'HUI
     ============================================================ */
  async function vueAujourdhui() {
    var r = await api('/admin/resume');
    var j = null; try { j = await api('/admin/journal?limit=10'); } catch (e) { j = { journal: [] }; }
    var rdv = r.prochain_rdv;
    return html`
      <div class="entete-vue"><div><h1>Aujourd’hui</h1><p class="hint">${fmtDateLong(aujourdhuiISO())} — ${etat.demo ? 'aperçu avec des données d’exemple' : 'données en direct'}</p></div></div>
      <div class="tuiles">
        <a class="tuile" href="#/premier"><span class="chiffre">${r.messages_nouveaux || 0}</span><span class="libelle">Premiers contacts</span><span class="detail">formulaire du site, à traiter</span></a>
        <a class="tuile" href="#/projets"><span class="chiffre">${r.demandes_a_traiter || 0}</span><span class="libelle">Demandes à traiter</span><span class="detail">tous projets</span></a>
        <a class="tuile" href="#/factures"><span class="chiffre">${r.factures_en_attente || 0}</span><span class="libelle">Factures en attente</span><span class="detail">envoyées, non payées</span></a>
        <a class="tuile" href="#/boite"><span class="chiffre">${rdv ? fmtJour(rdv.debut) : '—'}</span><span class="libelle">Prochain rendez-vous</span><span class="detail">${rdv ? fmtHeure(rdv.debut) + ' · ' + rdv.avec + (rdv.statut === 'propose' ? ' (à confirmer)' : '') : 'aucun'}</span></a>
      </div>
      <div class="carte">
        <h2>Dernière activité</h2>
        ${(j.journal || []).length ? html`<ul class="liste">${(j.journal || []).slice(0, 10).map(function (l) {
          return html`<li><span class="quand">${fmtJour(l.quand)}<br>${fmtHeure(l.quand)}</span><span class="corps">${l.action}${l.table ? html` <span class="etiquette">${l.table}</span>` : ''}</span></li>`;
        })}</ul>` : html`<p class="vide">Rien pour le moment.</p>`}
        <p class="petit">${etat.flux && !etat.demo ? 'Mise à jour en direct.' : 'Hors ligne : le journal se rafraîchit toutes les 15 s quand le service répond.'}</p>
      </div>`;
  }

  /* ============================================================
     ÉCRAN : BOÎTE DE RÉCEPTION
     ============================================================ */
  async function vueBoite(p) {
    var r = await api('/admin/contacts');
    var contacts = (r.contacts || []).slice().sort(function (a, b) { return (b.cree || '').localeCompare(a.cree || ''); });
    if (p[0]) {
      var c = contacts.filter(function (x) { return x.id === p[0]; })[0];
      if (!c) throw new ApiError(404, 'Message introuvable.');
      return vueContact(c);
    }
    var filtre = etat.filtreBoite || 'actifs';
    var liste = contacts.filter(function (c) { return filtre === 'tous' ? true : filtre === 'actifs' ? c.statut !== 'archive' : c.statut === filtre; });
    return html`
      <div class="entete-vue"><div><h1>Boîte de réception</h1><p class="hint">Messages reçus par le formulaire du site.</p></div></div>
      <div class="puces" role="group" aria-label="Filtrer">${[['actifs', 'À traiter'], ['nouveau', 'Nouveaux'], ['repondu', 'Répondus'], ['archive', 'Archivés'], ['tous', 'Tous']].map(function (f) {
        return html`<button type="button" class="puce" aria-pressed="${filtre === f[0]}" data-act="filtre-boite" data-f="${f[0]}">${f[1]}</button>`;
      })}</div>
      <div class="carte">${liste.length ? liste.map(function (c) {
        return html`<button type="button" class="ligne-clic" data-nav-to="boite/${c.id}">
          <b>${c.sujet || '(sans objet)'}</b>
          <span class="meta"><span class="etiquette ${c.statut}">${STATUTS_CONTACT[c.statut] || c.statut}</span>${c.nom} · ${fmtDateHeure(c.cree)}${c.rdv ? html` · <span class="etiquette">Rendez-vous demandé</span>` : ''}</span>
        </button>`;
      }) : html`<p class="vide">Aucun message dans cette liste.</p>`}</div>`;
  }
  ACTIONS['filtre-boite'] = async function (d) { etat.filtreBoite = d.f; router(true); };

  function vueContact(c) {
    var corpsMail = 'Bonjour ' + (c.nom || '').split(' ')[0] + ',\n\nMerci pour votre message au sujet de « ' + (c.sujet || '') + ' ».\n\n1. \n2. \n3. \n\nBien cordialement,\n' + SIGNATURE;
    var mailto = 'mailto:' + encodeURIComponent(c.email || '') + '?subject=' + encodeURIComponent('Re : ' + (c.sujet || 'votre demande') + ' — Belfort Systems') + '&body=' + encodeURIComponent(corpsMail);
    var rdv = c.rdv;
    var autreCreneau = rdv ? 'mailto:' + encodeURIComponent(c.email || '') + '?subject=' + encodeURIComponent('Rendez-vous — autre créneau proposé') + '&body=' + encodeURIComponent('Bonjour ' + (c.nom || '').split(' ')[0] + ',\n\nLe créneau du ' + fmtDateHeure(rdv.debut) + ' ne m’est pas possible. Je vous propose :\n\n1. \n2. \n3. \n\nDites-moi ce qui vous convient.\n\n' + SIGNATURE) : '';
    return html`
      <a class="retour" href="#/boite">← Boîte de réception</a>
      <div class="entete-vue"><div><h1>${c.sujet || '(sans objet)'}</h1><p class="hint">${c.nom} · reçu le ${fmtDateHeure(c.cree)}</p></div><span class="etiquette ${c.statut}">${STATUTS_CONTACT[c.statut] || c.statut}</span></div>
      <div class="carte">
        <dl class="def">
          <dt>De</dt><dd>${c.nom}</dd>
          <dt>E-mail</dt><dd>${c.email ? html`<a href="mailto:${c.email}">${c.email}</a>` : '—'}</dd>
          <dt>Téléphone</dt><dd>${c.tel ? html`<a href="tel:${c.tel.replace(/\s/g, '')}">${c.tel}</a>` : '—'}</dd>
          <dt>Formule</dt><dd>${libelleFormule(c.formule)}</dd>
          <dt>Message</dt><dd style="white-space:pre-wrap">${c.message}</dd>
        </dl>
      </div>
      ${rdv ? html`<div class="carte"><h2>Rendez-vous demandé</h2>
        <p>${fmtDateLong(rdv.debut)} de ${fmtHeure(rdv.debut)} à ${fmtHeure(rdv.fin)} <span class="etiquette ${rdv.statut}">${rdv.statut === 'propose' ? 'À confirmer' : rdv.statut === 'confirme' ? 'Confirmé' : rdv.statut}</span></p>
        ${rdv.note ? html`<p class="petit">${rdv.note}</p>` : ''}
        <div class="actions">
          ${rdv.statut !== 'confirme' ? html`<button type="button" class="btn ok sm" data-act="rdv-confirmer" data-id="${rdv.id}" data-cid="${c.id}" data-quand="${rdv.debut}" data-nom="${c.nom}">Confirmer</button>` : ''}
          <a class="btn ghost sm" href="${autreCreneau}">Proposer un autre créneau</a>
        </div></div>` : ''}
      <div class="carte"><h2>Actions</h2>
        <div class="actions">
          <a class="btn sm" href="${mailto}" data-act="contact-repondre" data-id="${c.id}" data-statut="${c.statut}">Répondre par e-mail</a>
          <button type="button" class="btn ghost sm" data-act="contact-convertir" data-id="${c.id}">Convertir en projet</button>
          ${c.statut === 'nouveau' ? html`<button type="button" class="btn ghost sm" data-act="contact-statut" data-id="${c.id}" data-avant="${c.statut}" data-apres="lu">Marquer comme lu</button>` : ''}
          ${c.statut !== 'repondu' ? html`<button type="button" class="btn ghost sm" data-act="contact-statut" data-id="${c.id}" data-avant="${c.statut}" data-apres="repondu">Marquer comme répondu</button>` : ''}
          ${c.statut !== 'archive' ? html`<button type="button" class="btn ghost sm" data-act="contact-statut" data-id="${c.id}" data-avant="${c.statut}" data-apres="archive">Archiver</button>` : html`<button type="button" class="btn ghost sm" data-act="contact-statut" data-id="${c.id}" data-avant="${c.statut}" data-apres="lu">Sortir des archives</button>`}
        </div>
        <p class="aide">« Répondre » ouvre votre messagerie avec un brouillon signé « ${SIGNATURE} » ; pensez ensuite à marquer le message comme répondu.</p>
      </div>`;
  }
  function libelleFormule(f) {
    if (!f) return '—';
    var cat = etat.catalogue; if (!cat) return f;
    var tous = (cat.prestations || []).concat(cat.forfaits_mensuels || [], cat.site_web ? [cat.site_web] : []);
    var p = tous.filter(function (x) { return x.id === f; })[0];
    return p ? p.nom : f;
  }
  ACTIONS['contact-repondre'] = async function (d, el) {
    window.location.href = el.getAttribute('href');
    if (d.statut === 'nouveau') { try { await api('/admin/contacts/' + d.id, { method: 'PATCH', body: { statut: 'lu' } }); etat.cache = {}; } catch (e) {} }
  };
  ACTIONS['contact-statut'] = async function (d) {
    await action({ titre: 'Changer le statut du message', apercu: [{ champ: 'Statut', avant: STATUTS_CONTACT[d.avant], apres: STATUTS_CONTACT[d.apres] }],
      action: function () { return api('/admin/contacts/' + d.id, { method: 'PATCH', body: { statut: d.apres } }); }, succes: 'Statut mis à jour.' });
  };
  ACTIONS['rdv-confirmer'] = async function (d) {
    await action({ titre: 'Confirmer le rendez-vous', apercu: [{ champ: 'Rendez-vous', avant: 'À confirmer', apres: 'Confirmé — ' + fmtDateHeure(d.quand) + ' avec ' + d.nom }],
      corps: html`<p class="petit">Pensez à prévenir la personne par e-mail ou SMS : la confirmation n’envoie rien automatiquement.</p>`,
      action: function () { return api('/admin/rdv/' + d.id, { method: 'PATCH', body: { statut: 'confirme' } }); }, succes: 'Rendez-vous confirmé.' });
  };
  ACTIONS['contact-convertir'] = async function (d) {
    var r = await api('/admin/contacts'); var c = (r.contacts || []).filter(function (x) { return x.id === d.id; })[0];
    if (!c) return;
    var nomClient = c.nom.split(' — ').pop();
    await action({ titre: 'Convertir en projet',
      corps: html`<p class="petit">Crée un client et un projet à partir de ce message. Le jeton du client sera affiché une seule fois.</p>`,
      champs: [
        { id: 'nom', label: 'Nom du client', valeur: nomClient, requis: true },
        { id: 'slug', label: 'Identifiant (URL)', valeur: slugify(nomClient), requis: true, aide: 'Lettres, chiffres et tirets.' },
        { id: 'contact', label: 'Contact', valeur: c.nom },
        { id: 'email', label: 'E-mail', type: 'email', valeur: c.email || '' },
        { id: 'titre', label: 'Titre du projet', valeur: c.sujet || 'Nouveau projet', requis: true }
      ],
      valider: 'Créer le client et le projet',
      action: async function (v) {
        var cl = await api('/admin/clients', { method: 'POST', body: { slug: slugify(v.slug), nom: v.nom, contact: v.contact, email: v.email } });
        await api('/admin/projets', { method: 'POST', body: { client_id: cl.id || cl.client && cl.client.id, titre: v.titre, statut: 'nouveau', resume: c.message } });
        await api('/admin/contacts/' + c.id, { method: 'PATCH', body: { statut: 'repondu' } });
        if (cl.token) await dialogue({ titre: 'Jeton du client', valider: null, annuler: 'Fermer', corps: html`<div class="encadre"><b>Copiez-le maintenant</b> : il ne sera plus jamais affiché.<code>${cl.token}</code></div>` });
      }, succes: 'Client et projet créés.' });
  };

  /* ============================================================
     ÉCRAN : PROJETS
     ============================================================ */
  async function vueProjets(p) {
    if (p[0]) return vueProjet(p[0], p[1] || 'vue', p.slice(2));
    var r = await api('/admin/projets');
    var projets = r.projets || [];
    return html`
      <div class="entete-vue"><div><h1>Projets</h1><p class="hint">Un projet par chantier client.</p></div>
        <button type="button" class="btn sm" data-act="projet-creer">Nouveau projet</button></div>
      <div class="carte">${projets.length ? projets.map(function (pr) {
        var c = pr.compteurs || {};
        var aTraiter = A_TRAITER.reduce(function (s, k) { return s + (c[k] || 0); }, 0);
        return html`<button type="button" class="ligne-clic" data-nav-to="projets/${pr.id}/vue"><b>${pr.titre}</b>
          <span class="meta">${pr.client ? pr.client.nom : pr.client_id} · <span class="etiquette ${pr.statut}">${pr.statut === 'en_cours' ? 'En cours' : pr.statut}</span> · ${pr.nb_demandes || 0} demandes, ${aTraiter} à traiter · mis à jour ${ecoule(pr.maj)}</span></button>`;
      }) : html`<p class="vide">Aucun projet.</p>`}</div>`;
  }
  ACTIONS['projet-creer'] = async function () {
    var cl = await api('/admin/clients');
    await action({ titre: 'Nouveau projet', champs: [
      { id: 'client_id', label: 'Client', type: 'select', options: (cl.clients || []).map(function (c) { return { valeur: c.id, libelle: c.nom }; }), requis: true },
      { id: 'titre', label: 'Titre', requis: true, placeholder: 'Migration de la messagerie' },
      { id: 'resume', label: 'Résumé', type: 'textarea' }
    ], valider: 'Créer', action: function (v) { return api('/admin/projets', { method: 'POST', body: { client_id: v.client_id, titre: v.titre, resume: v.resume, statut: 'en_cours' } }); }, succes: 'Projet créé.' });
  };

  var ONGLETS = [['vue', 'Vue d’ensemble'], ['demandes', 'Demandes'], ['chrono', 'Chronologie'], ['conv', 'Conversations'], ['fichiers', 'Fichiers'], ['retours', 'Retours et problèmes']];
  async function vueProjet(id, onglet, reste) {
    var r = await api('/admin/projets/' + encodeURIComponent(id));
    var P = r.projet; P.demandes = r.demandes || []; P.evenements = r.evenements || []; P.conversations = r.conversations || []; P.fichiers = r.fichiers || [];
    etat.projetCourant = P;
    var contenu;
    switch (onglet) {
      case 'demandes': contenu = reste[0] ? vueDemande(P, reste[0]) : vueDemandes(P); break;
      case 'chrono': contenu = vueChrono(P); break;
      case 'conv': contenu = vueConversations(P); break;
      case 'fichiers': contenu = vueFichiers(P); break;
      case 'retours': contenu = vueRetours(P); break;
      default: onglet = 'vue'; contenu = vueEnsemble(P);
    }
    return html`
      <a class="retour" href="#/projets">← Projets</a>
      <div class="entete-vue"><div><h1>Projet : ${P.client ? P.client.nom.replace(/^Château de /, '') : P.client_id}</h1><p class="hint">${P.titre}</p></div></div>
      <nav class="sous-onglets" aria-label="Sections du projet">${ONGLETS.map(function (o) {
        return html`<a href="#/projets/${P.id}/${o[0]}" class="${o[0] === onglet ? 'actif' : ''}" aria-current="${o[0] === onglet ? 'page' : 'false'}">${o[1]}</a>`;
      })}</nav>
      ${contenu}`;
  }

  function vueEnsemble(P) {
    var cpt = {}; Object.keys(STATUTS).forEach(function (k) { cpt[k] = 0; });
    P.demandes.forEach(function (d) { cpt[d.statut] = (cpt[d.statut] || 0) + 1; });
    var evts = P.evenements.filter(function (e) { return e.date; }).sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 5);
    var fichiers = P.fichiers.slice().sort(function (a, b) { return (b.cree || '').localeCompare(a.cree || ''); }).slice(0, 4);
    var encore = P.demandes.filter(function (d) { return d.encore; }).length;
    return html`
      <div class="carte"><h2>Résumé</h2><p>${P.resume || '—'}</p>
        <dl class="def"><dt>Client</dt><dd>${P.client ? P.client.nom + ' — ' + P.client.contact + (P.client.email ? ' · ' + P.client.email : '') : P.client_id}</dd>
        <dt>Depuis</dt><dd>${fmtDateLong(P.cree)}</dd><dt>Mis à jour</dt><dd>${fmtDateLong(P.maj)}</dd></dl>
        <div class="actions"><button type="button" class="btn ghost sm" data-act="projet-modifier">Modifier le résumé</button></div></div>
      <div class="tuiles">${Object.keys(STATUTS).map(function (k) {
        return html`<a class="tuile" href="#/projets/${P.id}/demandes" data-act="filtre-demandes" data-statut="${k}"><span class="chiffre">${cpt[k] || 0}</span><span class="libelle">${STATUTS[k]}</span></a>`;
      })}${encore ? html`<a class="tuile" href="#/projets/${P.id}/retours"><span class="chiffre" style="color:var(--danger)">${encore}</span><span class="libelle">« Ça ne marche toujours pas »</span></a>` : ''}</div>
      <div class="carte"><h2>Derniers événements</h2>
        ${evts.length ? evts.map(function (e) { return ligneEvt(e, false); }) : html`<p class="vide">Aucun événement.</p>`}
        <p><a href="#/projets/${P.id}/chrono">Toute la chronologie →</a></p></div>
      <div class="carte"><h2>Fichiers récents</h2>
        ${fichiers.length ? html`<ul class="liste">${fichiers.map(function (f) { return html`<li><span class="quand">${fmtJour(f.cree)}</span><span class="corps"><a href="${f.url}" target="_blank" rel="noopener">${f.nom}</a> <small>${f.type} · ${taille(f.taille)}</small></span></li>`; })}</ul>` : html`<p class="vide">Aucun fichier.</p>`}
        <p><a href="#/projets/${P.id}/fichiers">Tous les fichiers →</a></p></div>`;
  }
  ACTIONS['filtre-demandes'] = async function (d) { etat.filtreStatut = d.statut; naviguer('projets/' + etat.projetCourant.id + '/demandes'); };
  ACTIONS['projet-modifier'] = async function () {
    var P = etat.projetCourant;
    await action({ titre: 'Modifier le projet', champs: [{ id: 'titre', label: 'Titre', valeur: P.titre, requis: true }, { id: 'resume', label: 'Résumé', type: 'textarea', valeur: P.resume },
      { id: 'statut', label: 'Statut', type: 'select', valeur: P.statut, options: [{ valeur: 'en_cours', libelle: 'En cours' }, { valeur: 'termine', libelle: 'Terminé' }, { valeur: 'nouveau', libelle: 'Nouveau' }] }],
      valider: 'Enregistrer', action: function (v) { return api('/admin/projets/' + P.id, { method: 'PATCH', body: v }); } });
  };
  function taille(n) { n = Number(n) || 0; return n > 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' Mo' : n > 1024 ? Math.round(n / 1024) + ' Ko' : n + ' o'; }

  /* ----- Demandes ----- */
  function vueDemandes(P) {
    var fs = etat.filtreStatut || 'a_traiter', ft = etat.filtreTarif || 'tous', q = (etat.rechercheDemandes || '').toLowerCase();
    var liste = P.demandes.filter(function (d) {
      if (fs === 'a_traiter' && A_TRAITER.indexOf(d.statut) < 0) return false;
      if (fs !== 'tous' && fs !== 'a_traiter' && d.statut !== fs) return false;
      if (ft !== 'tous' && d.tarif !== ft) return false;
      if (q && (d.titre + ' ' + d.groupe + ' ' + d.qui + ' ' + d.reste + ' ' + d.livre).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var groupes = []; var parGroupe = {};
    liste.forEach(function (d) { if (!parGroupe[d.groupe]) { parGroupe[d.groupe] = []; groupes.push(d.groupe); } parGroupe[d.groupe].push(d); });
    return html`
      <div class="filtres">
        <div class="field"><label for="f-statut">Statut</label><select id="f-statut" data-filtre="statut">
          <option value="a_traiter" ${fs === 'a_traiter' ? 'selected' : ''}>À traiter</option><option value="tous" ${fs === 'tous' ? 'selected' : ''}>Tous</option>
          ${Object.keys(STATUTS).map(function (k) { return html`<option value="${k}" ${fs === k ? 'selected' : ''}>${STATUTS[k]}</option>`; })}</select></div>
        <div class="field"><label for="f-tarif">Tarif</label><select id="f-tarif" data-filtre="tarif"><option value="tous">Tous</option>
          ${Object.keys(TARIFS).map(function (k) { return html`<option value="${k}" ${ft === k ? 'selected' : ''}>${TARIFS[k]}</option>`; })}</select></div>
        <div class="field" style="flex:2 1 200px"><label for="f-q">Rechercher</label><input id="f-q" type="search" data-filtre="q" value="${etat.rechercheDemandes || ''}" placeholder="titre, personne, mot-clé"></div>
        <button type="button" class="btn sm" data-act="demande-creer" style="flex:0 0 auto">Nouvelle demande</button>
      </div>
      <p class="petit">${liste.length} demande${liste.length > 1 ? 's' : ''} sur ${P.demandes.length}.</p>
      ${groupes.length ? groupes.map(function (g) {
        return html`<h2 class="groupe-titre">${g} <small>${parGroupe[g].length}</small></h2><div class="carte">${parGroupe[g].map(function (d) { return ligneDemande(P, d); })}</div>`;
      }) : html`<div class="carte"><p class="vide">Aucune demande ne correspond.</p></div>`}`;
  }
  function ligneDemande(P, d) {
    return html`<button type="button" class="ligne-clic" data-nav-to="projets/${P.id}/demandes/${d.id}"><b>n° ${d.n} — ${d.titre}</b>
      <span class="meta"><span class="etiquette ${d.statut}">${STATUTS[d.statut] || d.statut}</span><span class="etiquette ${d.tarif}">${TARIFS[d.tarif] || d.tarif}</span>${d.encore ? html`<span class="etiquette encore">Ça ne marche toujours pas ×${d.encore}</span>` : ''}${d.qui} · ${d.date_txt}</span>
      ${d.reste && d.statut !== 'traite' ? html`<span class="meta">Reste : ${d.reste}</span>` : ''}</button>`;
  }
  document.addEventListener('change', function (ev) {
    var f = ev.target.dataset && ev.target.dataset.filtre; if (!f) return;
    if (f === 'statut') etat.filtreStatut = ev.target.value;
    if (f === 'tarif') etat.filtreTarif = ev.target.value;
    if (f === 'q') etat.rechercheDemandes = ev.target.value;
    router(true);
  });
  document.addEventListener('input', function (ev) {
    if (ev.target.dataset && ev.target.dataset.filtre === 'q') { etat.rechercheDemandes = ev.target.value; clearTimeout(etat._rq); etat._rq = setTimeout(function () { var pos = ev.target.selectionStart; router(true).then(function () { var e = $('f-q'); if (e) { e.focus(); try { e.setSelectionRange(pos, pos); } catch (x) {} } }); }, 250); }
  });

  function friseStatut(statut) {
    var etapes = ['nouveau', 'lu', 'en_cours', 'repondu', 'traite'];
    var pos = statut === 'partiel' ? 2 : etapes.indexOf(statut);
    if (statut === 'abandonne') {
      return html`<div class="frise">${etapes.slice(0, 3).map(function (e) { return html`<div class="etape fait">${STATUTS[e]}</div>`; })}<div class="etape abandon actuel">Abandonné</div></div>`;
    }
    return html`<div class="frise">${etapes.map(function (e, i) {
      return html`<div class="etape ${i < pos ? 'fait' : i === pos ? 'actuel' : ''}">${i === pos && statut === 'partiel' ? 'Partiel' : STATUTS[e]}</div>`;
    })}</div>`;
  }
  function messagesDe(P, did) {
    var out = [];
    P.conversations.forEach(function (c) { (c.messages || []).forEach(function (m) { if (m.demande_id === did) out.push({ m: m, canal: c.canal, conv: c.id }); }); });
    return out.sort(function (a, b) { return (a.m.date || '').localeCompare(b.m.date || ''); });
  }
  function vueDemande(P, did) {
    var d = P.demandes.filter(function (x) { return x.id === did; })[0];
    if (!d) throw new ApiError(404, 'Demande introuvable.');
    var msgs = messagesDe(P, did);
    var ouverte = d.statut !== 'traite' && d.statut !== 'abandonne';
    return html`
      <a class="retour" href="#/projets/${P.id}/demandes">← Demandes</a>
      <div class="carte">
        <div class="entete-vue"><div><h2>n° ${d.n} — ${d.titre}</h2><p class="hint">${d.groupe} · ${d.qui} · ${d.date_txt}</p></div>
          <div><span class="etiquette ${d.statut}">${STATUTS[d.statut]}</span> <span class="etiquette ${d.tarif}">${TARIFS[d.tarif]}</span></div></div>
        ${friseStatut(d.statut)}
        ${d.encore ? html`<p class="note avert">Le client a signalé ${d.encore} fois que ça ne marche toujours pas${d.encore_le ? ' (dernier signalement le ' + fmtDate(d.encore_le) + ')' : ''}.</p>` : ''}
        <dl class="def">
          ${d.livre ? html`<dt>Livré</dt><dd>${d.livre}</dd>` : ''}
          ${d.reste ? html`<dt>Reste à faire</dt><dd>${d.reste}</dd>` : ''}
          ${d.solution ? html`<dt>Solution</dt><dd>${d.solution}</dd>` : ''}
          ${d.motif ? html`<dt>Motif d’abandon</dt><dd>${d.motif}</dd>` : ''}
          ${d.note ? html`<dt>Note</dt><dd style="white-space:pre-wrap">${d.note}</dd>` : ''}
          <dt>Créée</dt><dd>${fmtDate(d.cree)} · mise à jour ${fmtDate(d.maj)} (${ecoule(d.maj)})</dd>
        </dl>
        <div class="actions">
          ${ouverte && d.statut !== 'en_cours' ? html`<button type="button" class="btn sm" data-act="demande-traiter" data-id="${d.id}">Traiter</button>` : ''}
          ${ouverte ? html`<button type="button" class="btn ok sm" data-act="demande-fait" data-id="${d.id}">Marquer comme fait</button>` : ''}
          ${ouverte ? html`<button type="button" class="btn ghost danger sm" data-act="demande-abandonner" data-id="${d.id}">Abandonner</button>` : ''}
          ${!ouverte ? html`<button type="button" class="btn sm" data-act="demande-rouvrir" data-id="${d.id}">Rouvrir</button>` : ''}
          <button type="button" class="btn ghost sm" data-act="demande-note" data-id="${d.id}">Ajouter une note</button>
          <button type="button" class="btn ghost sm" data-act="demande-modifier" data-id="${d.id}">Modifier</button>
        </div>
      </div>
      <div class="carte"><h2>Échanges rattachés <small>(${msgs.length})</small></h2>
        ${msgs.length ? html`<ul class="liste">${msgs.map(function (x) {
          return html`<li><span class="quand">${fmtJour(x.m.date)}</span><span class="corps"><span class="etiquette">${x.canal}</span> <b>${x.m.de}</b> : ${x.m.texte}${x.m.piece ? html` <small>(pièce : ${x.m.piece})</small>` : ''}</span></li>`;
        })}</ul>` : html`<p class="vide">Aucun échange rattaché.</p>`}
        <div class="actions"><button type="button" class="btn ghost sm" data-act="message-ajouter" data-demande="${d.id}">Ajouter un échange</button></div>
      </div>`;
  }
  function demandeDe(id) { return etat.projetCourant.demandes.filter(function (x) { return x.id === id; })[0]; }
  ACTIONS['demande-traiter'] = async function (d) {
    var dm = demandeDe(d.id);
    await action({ titre: 'Traiter la demande n° ' + dm.n, apercu: [{ champ: 'Statut', avant: STATUTS[dm.statut], apres: 'En cours' }],
      corps: html`<p class="petit">${dm.titre}</p>`, valider: 'Passer en cours',
      action: function () { return api('/admin/demandes/' + dm.id, { method: 'PATCH', body: { action: 'traiter', statut: 'en_cours' } }); }, succes: 'Demande en cours.' });
  };
  ACTIONS['demande-fait'] = async function (d) {
    var dm = demandeDe(d.id);
    await action({ titre: 'Marquer comme fait — n° ' + dm.n, apercu: [{ champ: 'Statut', avant: STATUTS[dm.statut], apres: 'Traité' }, { champ: 'Reste à faire', avant: dm.reste || '', apres: '(vidé)' }],
      champs: [{ id: 'solution', label: 'Solution apportée', type: 'phrases', phrases: SOLUTIONS, requis: true, valeur: dm.solution || '', placeholder: 'Ce qui a été fait, en une phrase' }],
      valider: 'Marquer comme fait',
      action: function (v) { return api('/admin/demandes/' + dm.id, { method: 'PATCH', body: { action: 'fait', statut: 'traite', solution: v.solution, reste: '' } }); }, succes: 'Demande traitée.' });
  };
  ACTIONS['demande-abandonner'] = async function (d) {
    var dm = demandeDe(d.id);
    await action({ titre: 'Abandonner la demande n° ' + dm.n, danger: true, apercu: [{ champ: 'Statut', avant: STATUTS[dm.statut], apres: 'Abandonné' }],
      champs: [{ id: 'motif', label: 'Motif', type: 'phrases', phrases: ['Abandonné d’un commun accord', 'Hors périmètre', 'Plus nécessaire', 'Pris en charge par un autre prestataire'], requis: true }],
      valider: 'Abandonner',
      action: function (v) { return api('/admin/demandes/' + dm.id, { method: 'PATCH', body: { action: 'abandonner', statut: 'abandonne', motif: v.motif } }); }, succes: 'Demande abandonnée.' });
  };
  ACTIONS['demande-rouvrir'] = async function (d) {
    var dm = demandeDe(d.id);
    await action({ titre: 'Rouvrir la demande n° ' + dm.n, apercu: [{ champ: 'Statut', avant: STATUTS[dm.statut], apres: 'En cours' }],
      champs: [{ id: 'reste', label: 'Reste à faire', type: 'textarea', valeur: dm.reste || '' }], valider: 'Rouvrir',
      action: function (v) { return api('/admin/demandes/' + dm.id, { method: 'PATCH', body: { action: 'rouvrir', statut: 'en_cours', reste: v.reste } }); }, succes: 'Demande rouverte.' });
  };
  ACTIONS['demande-note'] = async function (d) {
    var dm = demandeDe(d.id);
    await action({ titre: 'Ajouter une note — n° ' + dm.n, champs: [{ id: 'note', label: 'Note', type: 'textarea', requis: true, placeholder: 'Pour vous : contexte, à vérifier…' }], valider: 'Ajouter',
      action: function (v) { return api('/admin/demandes/' + dm.id, { method: 'PATCH', body: { note: (dm.note ? dm.note + '\n' : '') + fmtDate(aujourdhuiISO()) + ' — ' + v.note } }); }, succes: 'Note ajoutée.' });
  };
  ACTIONS['demande-modifier'] = async function (d) {
    var dm = demandeDe(d.id);
    await action({ titre: 'Modifier la demande n° ' + dm.n, champs: [
      { id: 'titre', label: 'Titre', valeur: dm.titre, requis: true }, { id: 'groupe', label: 'Groupe', valeur: dm.groupe, requis: true }, { id: 'qui', label: 'Qui', valeur: dm.qui },
      { id: 'tarif', label: 'Tarif', type: 'select', valeur: dm.tarif, options: Object.keys(TARIFS).map(function (k) { return { valeur: k, libelle: TARIFS[k] }; }) },
      { id: 'livre', label: 'Livré', type: 'textarea', valeur: dm.livre }, { id: 'reste', label: 'Reste à faire', type: 'textarea', valeur: dm.reste }],
      valider: 'Enregistrer', action: function (v) { return api('/admin/demandes/' + dm.id, { method: 'PATCH', body: v }); } });
  };
  ACTIONS['demande-creer'] = async function () {
    var P = etat.projetCourant; var groupes = []; P.demandes.forEach(function (d) { if (groupes.indexOf(d.groupe) < 0) groupes.push(d.groupe); });
    await action({ titre: 'Nouvelle demande', champs: [
      { id: 'titre', label: 'Titre', requis: true }, { id: 'groupe', label: 'Groupe', requis: true, valeur: groupes[0] || '', aide: 'Groupes existants : ' + groupes.join(', ') },
      { id: 'qui', label: 'Qui', placeholder: 'Claire' }, { id: 'tarif', label: 'Tarif', type: 'select', options: Object.keys(TARIFS).map(function (k) { return { valeur: k, libelle: TARIFS[k] }; }) },
      { id: 'reste', label: 'À faire', type: 'textarea' }], valider: 'Créer',
      action: function (v) { return api('/admin/demandes', { method: 'POST', body: { projet_id: P.id, titre: v.titre, groupe: v.groupe, qui: v.qui, tarif: v.tarif, reste: v.reste, statut: 'nouveau', date_txt: fmtJour(aujourdhuiISO()) } }); }, succes: 'Demande créée.' });
  };

  /* ----- Chronologie ----- */
  function ligneEvt(e, outils) {
    return html`<div class="evt"><span class="type-point type-${e.type}" title="${TYPES_EVT[e.type] || e.type}"></span><span class="quand">${e.date ? fmtJour(e.date) : 'à venir'}</span>
      <span class="corps">${e.titre}${e.detail ? html`<small>${e.detail}</small>` : ''}</span>
      ${outils ? html`<span class="outils"><button type="button" class="btn-ico" data-act="evt-modifier" data-id="${e.id}" aria-label="Modifier">✎</button><button type="button" class="btn-ico" data-act="evt-supprimer" data-id="${e.id}" aria-label="Supprimer">✕</button></span>` : ''}</div>`;
  }
  function vueChrono(P) {
    var evts = P.evenements.slice().sort(function (a, b) { return (b.date || '9999').localeCompare(a.date || '9999'); });
    var mois = []; var parMois = {};
    evts.forEach(function (e) { var k = e.date ? e.date.slice(0, 7) : 'avenir'; if (!parMois[k]) { parMois[k] = []; mois.push(k); } parMois[k].push(e); });
    return html`
      <div class="entete-vue"><div class="legende">${Object.keys(TYPES_EVT).map(function (k) { return html`<span><span class="type-point type-${k}"></span>${TYPES_EVT[k]}</span>`; })}</div>
        <div class="actions"><button type="button" class="btn sm" data-act="evt-ajouter" data-jour="1">Ajouter l’événement du jour</button><button type="button" class="btn ghost sm" data-act="evt-ajouter">Ajouter un événement</button></div></div>
      ${mois.map(function (k) {
        var titre = k === 'avenir' ? 'À venir' : MOIS[parseInt(k.slice(5), 10) - 1] + ' ' + k.slice(0, 4);
        return html`<h2 class="mois">${titre}</h2><div class="carte">${parMois[k].map(function (e) { return ligneEvt(e, true); })}</div>`;
      })}`;
  }
  function champsEvt(e) {
    return [{ id: 'date', label: 'Date', type: 'date', valeur: e.date || '', aide: 'Vide = à venir' },
      { id: 'type', label: 'Type', type: 'select', valeur: e.type || 'echange', options: Object.keys(TYPES_EVT).map(function (k) { return { valeur: k, libelle: TYPES_EVT[k] }; }) },
      { id: 'titre', label: 'Titre', valeur: e.titre || '', requis: true }, { id: 'detail', label: 'Détail', type: 'textarea', valeur: e.detail || '' }];
  }
  ACTIONS['evt-ajouter'] = async function (d) {
    var P = etat.projetCourant;
    await action({ titre: d.jour ? 'Événement du jour' : 'Ajouter un événement', champs: champsEvt({ date: d.jour ? aujourdhuiISO() : '' }), valider: 'Ajouter',
      action: function (v) { return api('/admin/evenements', { method: 'POST', body: { projet_id: P.id, date: v.date, type: v.type, titre: v.titre, detail: v.detail } }); }, succes: 'Événement ajouté.' });
  };
  ACTIONS['evt-modifier'] = async function (d) {
    var e = etat.projetCourant.evenements.filter(function (x) { return x.id === d.id; })[0];
    await action({ titre: 'Modifier l’événement', champs: champsEvt(e), valider: 'Enregistrer', action: function (v) { return api('/admin/evenements/' + e.id, { method: 'PATCH', body: v }); } });
  };
  ACTIONS['evt-supprimer'] = async function (d) {
    var e = etat.projetCourant.evenements.filter(function (x) { return x.id === d.id; })[0];
    await action({ titre: 'Supprimer l’événement', danger: true, apercu: [{ champ: 'Événement', avant: e.titre, apres: 'supprimé définitivement' }], valider: 'Supprimer',
      action: function () { return api('/admin/evenements/' + e.id, { method: 'DELETE' }); }, succes: 'Événement supprimé.' });
  };

  /* ----- Conversations ----- */
  function vueConversations(P) {
    var parCanal = {}; P.conversations.forEach(function (c) { parCanal[c.canal] = c; });
    return html`<div class="actions"><button type="button" class="btn sm" data-act="message-ajouter">Ajouter un message</button></div>
      <div class="canaux">${CANAUX.map(function (canal) {
        var c = parCanal[canal]; var msgs = c ? (c.messages || []).slice().sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); }) : [];
        return html`<section class="canal" aria-label="${canal}"><h3>${canal} <small>${msgs.length}</small></h3>
          <div class="fil">${msgs.length ? msgs.map(function (m) {
            var moi = /^damien/i.test(m.de || '');
            var dm = m.demande_id ? P.demandes.filter(function (x) { return x.id === m.demande_id; })[0] : null;
            return html`<div class="bulle ${moi ? 'moi' : 'lui'}">${m.texte}${m.piece ? html` <small>pièce : ${m.piece}</small>` : ''}<small>${m.de} · ${fmtDate(m.date)}${dm ? html` · <a href="#/projets/${P.id}/demandes/${dm.id}">demande n° ${dm.n}</a>` : ''}</small></div>`;
          }) : html`<p class="vide">Aucun message.</p>`}</div>
          <div class="actions"><button type="button" class="btn ghost sm" data-act="message-ajouter" data-canal="${canal}">Ajouter</button></div></section>`;
      })}</div>`;
  }
  ACTIONS['message-ajouter'] = async function (d) {
    var P = etat.projetCourant;
    var dems = [{ valeur: '', libelle: '— aucune —' }].concat(P.demandes.map(function (x) { return { valeur: x.id, libelle: 'n° ' + x.n + ' — ' + x.titre.slice(0, 50) }; }));
    await action({ titre: 'Ajouter un message', champs: [
      { id: 'canal', label: 'Canal', type: 'select', valeur: d.canal || 'Mail', options: CANAUX },
      { id: 'de', label: 'De', type: 'select', valeur: 'Damien', options: ['Damien', P.client ? P.client.contact : 'Client', 'Autre'] },
      { id: 'date', label: 'Date', type: 'date', valeur: aujourdhuiISO(), requis: true },
      { id: 'texte', label: 'Message (résumé)', type: 'textarea', requis: true },
      { id: 'demande_id', label: 'Demande rattachée', type: 'select', valeur: d.demande || '', options: dems },
      { id: 'piece', label: 'Pièce jointe (nom)', placeholder: 'facultatif' }], valider: 'Ajouter',
      action: async function (v) {
        var conv = P.conversations.filter(function (c) { return c.canal === v.canal; })[0];
        var convId = conv ? conv.id : (await api('/admin/conversations', { method: 'POST', body: { projet_id: P.id, canal: v.canal, titre: v.canal } })).id;
        return api('/admin/messages', { method: 'POST', body: { conversation_id: convId, demande_id: v.demande_id || null, de: v.de, date: v.date, texte: v.texte, piece: v.piece || null } });
      }, succes: 'Message ajouté.' });
  };

  /* ----- Fichiers ----- */
  function vueFichiers(P) {
    var fs = P.fichiers.slice().sort(function (a, b) { return (b.cree || '').localeCompare(a.cree || ''); });
    return html`<p class="note">Les fichiers restent sur OneDrive ou GitHub, on garde ici le lien. Aucun envoi de fichier depuis cette page.</p>
      <div class="actions"><button type="button" class="btn sm" data-act="fichier-ajouter">Ajouter un lien</button></div>
      <div class="carte">${fs.length ? html`<div class="defile"><table class="tableau"><thead><tr><th>Nom</th><th>Type</th><th class="num">Taille</th><th>Note</th><th>Ajouté</th><th></th></tr></thead><tbody>${fs.map(function (f) {
        return html`<tr><td><a href="${f.url}" target="_blank" rel="noopener">${f.nom}</a></td><td>${f.type}</td><td class="num">${taille(f.taille)}</td><td>${f.note || ''}</td><td>${fmtJour(f.cree)}</td>
          <td><button type="button" class="btn-ico" data-act="fichier-supprimer" data-id="${f.id}" aria-label="Retirer le lien">✕</button></td></tr>`;
      })}</tbody></table></div>` : html`<p class="vide">Aucun fichier.</p>`}</div>`;
  }
  ACTIONS['fichier-ajouter'] = async function () {
    var P = etat.projetCourant;
    await action({ titre: 'Ajouter un lien de fichier', champs: [{ id: 'nom', label: 'Nom', requis: true }, { id: 'url', label: 'Lien (OneDrive, GitHub…)', type: 'url', requis: true, placeholder: 'https://' },
      { id: 'type', label: 'Type', type: 'select', options: ['PDF', 'Word', 'Excel', 'HTML', 'Image', 'Autre'] }, { id: 'taille', label: 'Taille (Ko, facultatif)', type: 'number' }, { id: 'note', label: 'Note' }], valider: 'Ajouter',
      action: function (v) { return api('/admin/fichiers', { method: 'POST', body: { projet_id: P.id, nom: v.nom, url: v.url, type: v.type, taille: v.taille ? Number(v.taille) * 1024 : null, note: v.note } }); }, succes: 'Lien ajouté.' });
  };
  ACTIONS['fichier-supprimer'] = async function (d) {
    var f = etat.projetCourant.fichiers.filter(function (x) { return x.id === d.id; })[0];
    await action({ titre: 'Retirer le lien', danger: true, apercu: [{ champ: 'Fichier', avant: f.nom, apres: 'lien retiré (le fichier lui-même n’est pas touché)' }], valider: 'Retirer',
      action: function () { return api('/admin/fichiers/' + f.id, { method: 'DELETE' }); }, succes: 'Lien retiré.' });
  };

  /* ----- Retours et problèmes ----- */
  function vueRetours(P) {
    var encore = P.demandes.filter(function (d) { return d.encore; }).sort(function (a, b) { return (a.encore_le || a.maj || '').localeCompare(b.encore_le || b.maj || ''); });
    var ouvertes = P.demandes.filter(function (d) { return A_TRAITER.indexOf(d.statut) >= 0 && !d.encore; }).sort(function (a, b) { return (a.maj || a.cree || '').localeCompare(b.maj || b.cree || ''); });
    var attente = P.demandes.filter(function (d) { return d.statut === 'repondu'; });
    function bloc(titre, liste, vide) {
      return html`<h2 class="groupe-titre">${titre} <small>${liste.length}</small></h2><div class="carte">${liste.length ? liste.map(function (d) {
        return html`<button type="button" class="ligne-clic" data-nav-to="projets/${P.id}/demandes/${d.id}"><b>n° ${d.n} — ${d.titre}</b>
          <span class="meta"><span class="etiquette ${d.statut}">${STATUTS[d.statut]}</span>${d.encore ? html`<span class="etiquette encore">×${d.encore}</span>` : ''}<strong>${ecoule(d.encore_le || d.maj || d.cree)}</strong> · ${d.qui}</span>
          ${d.reste ? html`<span class="meta">${d.reste}</span>` : ''}</button>`;
      }) : html`<p class="vide">${vide}</p>`}</div>`;
    }
    return html`<p class="hint">Ce que le client remonte, du plus ancien au plus récent.</p>
      ${bloc('« Ça ne marche toujours pas »', encore, 'Aucun signalement.')}
      ${bloc('Demandes non traitées', ouvertes, 'Tout est traité.')}
      ${bloc('En attente du client', attente, 'Rien en attente.')}`;
  }

  /* ============================================================
     ÉCRAN : FACTURES
     ============================================================ */
  async function vueFactures(p) {
    if (p[0] === 'nouvelle') return editeurFacture(null, p[1]);
    if (p[0]) return vueFacture(p[0], p[1]);
    var r = await api('/admin/factures');
    var fs = (r.factures || []).slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var filtre = etat.filtreFact || 'toutes';
    var liste = fs.filter(function (f) { return filtre === 'toutes' || f.statut === filtre; });
    return html`
      <div class="entete-vue"><div><h1>Factures</h1><p class="hint">Numérotation continue BS-AAAA-NNN attribuée à l’émission. Franchise de TVA. La facturation, l’URSSAF et la comptabilité se font sur <a href="https://app.indy.fr" target="_blank" rel="noopener">Indy</a> ; ces brouillons ne servent qu’aux aperçus.</p></div>
        <a class="btn sm" href="#/factures/nouvelle">Nouvelle facture</a></div>
      <div class="puces" role="group" aria-label="Filtrer">${[['toutes', 'Toutes'], ['brouillon', 'Brouillons'], ['envoyee', 'Envoyées'], ['payee', 'Payées']].map(function (f) {
        return html`<button type="button" class="puce" aria-pressed="${filtre === f[0]}" data-act="filtre-fact" data-f="${f[0]}">${f[1]}</button>`;
      })}</div>
      <div class="carte">${liste.length ? liste.map(function (f) {
        return html`<button type="button" class="ligne-clic" data-nav-to="factures/${f.id}"><b>${f.numero || 'Brouillon (sans numéro)'} — ${f.client_nom || f.client_id}</b>
          <span class="meta"><span class="etiquette ${f.statut}">${STATUTS_FACT[f.statut] || f.statut}</span>${euros(f.total_ht)} · ${fmtDate(f.date)} · échéance ${fmtDate(f.echeance)}${f.statut === 'envoyee' && parseDate(f.echeance) < new Date() ? html` · <span class="etiquette nouveau">En retard</span>` : ''}</span></button>`;
      }) : html`<p class="vide">Aucune facture.</p>`}</div>`;
  }
  ACTIONS['filtre-fact'] = async function (d) { etat.filtreFact = d.f; router(true); };

  async function chargerCatalogue() {
    if (etat.catalogue) return etat.catalogue;
    var r = await fetch('/assets/catalogue.json', { cache: 'no-store' });
    etat.catalogue = await r.json();
    return etat.catalogue;
  }
  function optionsCatalogue(cat) {
    var out = [];
    (cat.prestations || []).forEach(function (p) { out.push({ id: p.id, nom: p.nom, prix: p.prix, unite: p.unite, cat: p.categorie }); });
    (cat.forfaits_mensuels || []).forEach(function (p) { out.push({ id: 'mensuel-' + p.id, nom: 'Forfait mensuel ' + p.nom, prix: p.prix, unite: 'mois', cat: 'Forfaits mensuels' }); });
    if (cat.site_web) out.push({ id: cat.site_web.id, nom: cat.site_web.nom, prix: cat.site_web.prix, unite: cat.site_web.unite, cat: 'Site web' });
    if (cat.heure_supplementaire) out.push({ id: 'heure-supp', nom: 'Heure supplémentaire', prix: cat.heure_supplementaire, unite: 'heure', cat: 'Forfaits mensuels' });
    return out;
  }
  function totalFacture(f) { return (f.lignes || []).reduce(function (s, l) { return s + (Number(l.quantite) || 0) * (Number(l.prix) || 0); }, 0); }

  async function vueFacture(id, sous) {
    var r = await api('/admin/factures');
    var f = (r.factures || []).filter(function (x) { return x.id === id; })[0];
    if (!f) throw new ApiError(404, 'Facture introuvable.');
    if (f.statut === 'brouillon' && sous === 'modifier') return editeurFacture(f);
    etat.factureCourante = f;
    var sujet = 'Facture ' + (f.numero || '') + ' — Belfort Systems';
    var corps = 'Bonjour,\n\nVeuillez trouver ci-joint la facture ' + (f.numero || '') + ' :\n\n1. Montant : ' + euros(totalFacture(f)) + ' (TVA non applicable, art. 293 B du CGI)\n2. Échéance : ' + fmtDateLong(f.echeance) + ', par virement\n3. Détail : ' + (f.lignes || []).map(function (l) { return l.designation; }).join(' ; ') + '\n\nMerci de votre confiance.\n\n' + SIGNATURE + '\n\n(Pensez à joindre le PDF téléchargé avant d’envoyer.)';
    var mailto = 'mailto:' + encodeURIComponent(f.client_email || '') + '?subject=' + encodeURIComponent(sujet) + '&body=' + encodeURIComponent(corps);
    return html`
      <a class="retour" href="#/factures">← Factures</a>
      <div class="entete-vue"><div><h1>${f.numero || 'Brouillon'}</h1><p class="hint">${f.client_nom || f.client_id} · ${euros(totalFacture(f))} · <span class="etiquette ${f.statut}">${STATUTS_FACT[f.statut]}</span></p></div></div>
      <div class="carte"><div class="actions">
        ${f.statut === 'brouillon' ? html`<a class="btn sm" href="#/factures/${f.id}/modifier">Modifier le brouillon</a><button type="button" class="btn ok sm" data-act="facture-emettre" data-id="${f.id}">Émettre</button>` : ''}
        <button type="button" class="btn ghost sm" data-act="facture-pdf">Télécharger le PDF</button>
        ${f.statut !== 'brouillon' ? html`<a class="btn ghost sm" href="${mailto}">Envoyer par e-mail</a>` : ''}
        ${f.statut === 'envoyee' ? html`<button type="button" class="btn ok sm" data-act="facture-payee" data-id="${f.id}">Marquer payée</button>` : ''}
        ${f.statut === 'envoyee' || f.statut === 'payee' ? html`<button type="button" class="btn ghost danger sm" data-act="facture-avoir" data-id="${f.id}">Créer un avoir</button>` : ''}
      </div>
      ${f.statut !== 'brouillon' ? html`<p class="aide">« Envoyer par e-mail » prépare le message (objet, trois points, signature) ; joignez le PDF téléchargé avant d’envoyer.</p>` : html`<p class="aide">Un brouillon n’a pas de numéro : il est attribué à l’émission, puis la facture ne peut plus être modifiée.</p>`}
      ${f.note ? html`<p class="petit">Note : ${f.note}</p>` : ''}</div>
      <div class="field"><label for="iban-detail">IBAN à afficher sur cette impression (facultatif)</label><input id="iban-detail" data-iban="1" placeholder="FR76 …" autocomplete="off" spellcheck="false"><p class="aide">Saisi à chaque fois, jamais enregistré ni envoyé au service.</p></div>
      <h2>Aperçu A4</h2>
      <div class="a4-cadre"><div class="a4-wrap" id="a4-zone">${renderA4(f, '')}</div></div>`;
  }
  document.addEventListener('input', function (ev) {
    if (ev.target.dataset && ev.target.dataset.iban) {
      var f = etat.factureCourante; var z = $('a4-zone'); if (f && z) render(z, renderA4(f, ev.target.value));
    }
  });
  function renderA4(f, iban) {
    var total = totalFacture(f);
    var numero = f.numero || 'Brouillon — numéro attribué à l’émission';
    return html`<article class="a4" aria-label="Facture">
      ${f.statut === 'brouillon' ? html`<div class="filigrane">BROUILLON</div>` : f.statut === 'annulee' ? html`<div class="filigrane">ANNULÉE</div>` : ''}
      <div class="ent"><div class="qui"><b>${MOI.entreprise}</b>${MOI.nom}<br>Micro-entrepreneur<br>${MOI.adresse}<br>${MOI.cp} ${MOI.ville}<br>${MOI.tel} · ${MOI.email}<br>SIRET ${MOI.siret}</div>
        <div style="text-align:right"><div class="titre">${f.type === 'avoir' ? 'Avoir' : 'Facture'}</div><div class="meta">N° <b>${numero}</b><br>Date : ${fmtDateLong(f.date)}<br>Échéance : ${fmtDateLong(f.echeance)}</div></div></div>
      <div class="adr"><div class="bloc"><small>Facturé à</small><br><b>${f.client_nom || f.client_id}</b>${f.client_contact ? html`<br>${f.client_contact}` : ''}${f.client_adresse ? html`<br>${f.client_adresse}` : ''}${f.client_email ? html`<br>${f.client_email}` : ''}</div>
        ${f.objet ? html`<div><small>Objet</small><br>${f.objet}</div>` : ''}</div>
      <table><thead><tr><th>Désignation</th><th class="num">Qté</th><th class="num">Prix unitaire</th><th class="num">Total</th></tr></thead><tbody>${(f.lignes || []).map(function (l) {
        return html`<tr><td>${l.designation}${l.detail ? html`<br><small>${l.detail}</small>` : ''}</td><td class="num">${l.quantite} ${l.unite || ''}</td><td class="num">${euros(l.prix)}</td><td class="num">${euros((Number(l.quantite) || 0) * (Number(l.prix) || 0))}</td></tr>`;
      })}</tbody></table>
      <div class="totaux"><div><span>Total HT</span><span>${euros(total)}</span></div><div><span>TVA</span><span>non applicable</span></div><div class="grand"><span>Net à payer</span><span>${euros(total)}</span></div></div>
      <div class="mentions">
        <p><b>TVA non applicable, art. 293 B du CGI.</b></p>
        <p>Paiement à réception, au plus tard le ${fmtDateLong(f.echeance)}, par virement bancaire${iban ? ' sur le compte ' + iban : ''}. Pas d’escompte pour paiement anticipé.</p>
        <p>En cas de retard de paiement : pénalités au taux légal en vigueur et indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 du Code de commerce).</p>
        ${f.note ? html`<p>${f.note}</p>` : ''}
      </div>
      <div class="pied">${MOI.nom} — ${MOI.entreprise} — SIRET ${MOI.siret} — ${MOI.adresse}, ${MOI.cp} ${MOI.ville} — ${MOI.tel} — ${MOI.site}</div>
    </article>`;
  }
  ACTIONS['facture-pdf'] = async function () {
    var z = $('a4-zone'); if (!z) return;
    var imp = $('impression'); imp.innerHTML = ''; imp.appendChild(z.firstElementChild.cloneNode(true)); imp.hidden = false;
    toast('Dans la fenêtre d’impression, choisissez « Enregistrer au format PDF ».', 5000);
    setTimeout(function () { window.print(); setTimeout(function () { imp.hidden = true; imp.innerHTML = ''; }, 1000); }, 100);
  };
  window.addEventListener('afterprint', function () { var imp = $('impression'); imp.hidden = true; imp.innerHTML = ''; });
  ACTIONS['facture-emettre'] = async function (d) {
    var f = etat.factureCourante;
    await action({ titre: 'Émettre la facture', apercu: [{ champ: 'Numéro', avant: 'brouillon', apres: 'attribué à l’émission (BS-' + (f.date || '').slice(0, 4) + '-NNN)' }, { champ: 'Statut', avant: 'Brouillon', apres: 'Envoyée' }, { champ: 'Montant', apres: euros(totalFacture(f)) }],
      corps: html`<p class="note avert">Le numéro sera attribué et la facture ne pourra plus être modifiée.</p>`, valider: 'Émettre',
      action: function () { return api('/admin/factures/' + f.id + '/emettre', { method: 'POST' }); }, succes: 'Facture émise.' });
  };
  ACTIONS['facture-payee'] = async function (d) {
    var f = etat.factureCourante;
    await action({ titre: 'Marquer comme payée', apercu: [{ champ: 'Statut', avant: 'Envoyée', apres: 'Payée' }, { champ: 'Montant', apres: euros(totalFacture(f)) }],
      champs: [{ id: 'date', label: 'Date du paiement', type: 'date', valeur: aujourdhuiISO(), requis: true }], valider: 'Marquer payée',
      action: function (v) { return api('/admin/factures/' + f.id + '/payee', { method: 'POST', body: { date_paiement: v.date } }); }, succes: 'Facture payée.' });
  };
  ACTIONS['facture-avoir'] = async function (d) {
    var f = etat.factureCourante;
    await action({ titre: 'Créer un avoir', corps: html`<p class="petit">Crée un brouillon d’avoir reprenant les lignes en négatif, qui référence la facture ${f.numero || ''}. Il sera numéroté à l’émission.</p>`,
      champs: [{ id: 'motif', label: 'Motif', requis: true, placeholder: 'Erreur de montant, prestation annulée…' }], valider: 'Créer le brouillon d’avoir',
      action: function (v) { return api('/admin/factures', { method: 'POST', body: { client_id: f.client_id, type: 'avoir', reference: f.numero, date: aujourdhuiISO(), echeance: aujourdhuiISO(),
        lignes: (f.lignes || []).map(function (l) { return { designation: l.designation, quantite: l.quantite, unite: l.unite, prix: -Math.abs(Number(l.prix) || 0) }; }), note: 'Avoir sur la facture ' + (f.numero || '') + ' — ' + v.motif, statut: 'brouillon' } }); }, succes: 'Brouillon d’avoir créé.' });
  };

  /* ----- Éditeur de facture ----- */
  async function editeurFacture(f) {
    var cat = await chargerCatalogue(); var cl = await api('/admin/clients'); var clients = cl.clients || [];
    var opts = optionsCatalogue(cat);
    var F = f ? JSON.parse(JSON.stringify(f)) : { id: null, client_id: clients[0] ? clients[0].id : '', date: aujourdhuiISO(), echeance: plusJours(aujourdhuiISO(), 30), lignes: [], note: '', statut: 'brouillon' };
    if (!F.lignes.length) F.lignes.push({ ref: '', designation: '', quantite: 1, unite: '', prix: 0 });
    etat.editeur = { F: F, opts: opts, clients: clients };
    majClientFacture();
    return html`
      <a class="retour" href="#/factures">← Factures</a>
      <h1>${f ? 'Modifier le brouillon' : 'Nouvelle facture'}</h1>
      <div class="carte">
        <div class="row">
          <div class="field"><label for="fa-client">Client</label><select id="fa-client" data-fact="client_id">${clients.map(function (c) { return html`<option value="${c.id}" ${c.id === F.client_id ? 'selected' : ''}>${c.nom}</option>`; })}</select></div>
          <div class="field"><label for="fa-date">Date</label><input id="fa-date" type="date" data-fact="date" value="${F.date}"></div>
          <div class="field"><label for="fa-ech">Échéance</label><input id="fa-ech" type="date" data-fact="echeance" value="${F.echeance}"></div>
        </div>
        <div class="field"><label for="fa-objet">Objet (facultatif)</label><input id="fa-objet" data-fact="objet" value="${F.objet || ''}" placeholder="Migration de la messagerie — Domaine des Tilleuls"></div>
        <h2>Lignes</h2>
        <div id="fa-lignes">${F.lignes.map(function (l, i) { return ligneEditeur(l, i, opts); })}</div>
        <div class="actions"><button type="button" class="btn ghost sm" data-act="ligne-ajouter">Ajouter une prestation du catalogue</button><button type="button" class="btn ghost sm" data-act="ligne-ajouter" data-libre="1">Ajouter une ligne libre</button></div>
        <div class="total" id="fa-total">Total : ${euros(totalFacture(F))}</div>
        <div class="field"><label for="fa-note">Note sur la facture (facultatif)</label><textarea id="fa-note" data-fact="note">${F.note || ''}</textarea></div>
        <div class="field"><label for="fa-iban">IBAN à afficher (facultatif)</label><input id="fa-iban" data-fact="iban" placeholder="FR76 …" autocomplete="off" spellcheck="false"><p class="aide">Saisi à chaque fois, jamais enregistré ni envoyé au service : il n’apparaît que sur l’aperçu et le PDF.</p></div>
        <div class="actions">
          <button type="button" class="btn sm" data-act="facture-enregistrer">Enregistrer le brouillon</button>
          <button type="button" class="btn ok sm" data-act="facture-enregistrer" data-emettre="1">Émettre</button>
          <button type="button" class="btn ghost sm" data-act="facture-pdf">Télécharger le PDF</button>
        </div>
      </div>
      <h2>Aperçu A4</h2>
      <div class="a4-cadre"><div class="a4-wrap" id="a4-zone">${renderA4(F, '')}</div></div>`;
  }
  function ligneEditeur(l, i, opts) {
    return html`<div class="ligne-fact" data-i="${i}">
      <div class="field"><label for="li-ref-${i}">Prestation</label><select id="li-ref-${i}" data-ligne="ref" data-i="${i}"><option value="">Ligne libre</option>${opts.map(function (o) {
        return html`<option value="${o.id}" ${o.id === l.ref ? 'selected' : ''}>${o.nom}${o.prix !== null && o.prix !== undefined ? ' — ' + euros(o.prix) + ' / ' + o.unite : ' — sur devis'}</option>`;
      })}</select></div>
      <div class="field"><label for="li-des-${i}">Désignation</label><input id="li-des-${i}" data-ligne="designation" data-i="${i}" value="${l.designation || ''}"></div>
      <div class="champs">
        <div class="field"><label for="li-q-${i}">Qté</label><input id="li-q-${i}" type="number" min="0" step="0.5" data-ligne="quantite" data-i="${i}" value="${l.quantite}"></div>
        <div class="field"><label for="li-p-${i}">Prix unitaire (€)</label><input id="li-p-${i}" type="number" step="0.01" data-ligne="prix" data-i="${i}" value="${l.prix}"></div>
        <button type="button" class="btn-ico" data-act="ligne-supprimer" data-i="${i}" aria-label="Supprimer la ligne">✕</button>
      </div>
      <div class="sous-total" id="li-st-${i}">${euros((Number(l.quantite) || 0) * (Number(l.prix) || 0))}</div></div>`;
  }
  function majClientFacture() {
    var E = etat.editeur; if (!E) return; var c = E.clients.filter(function (x) { return x.id === E.F.client_id; })[0];
    if (c) { E.F.client_nom = c.nom; E.F.client_contact = c.contact; E.F.client_email = c.email; }
  }
  function majApercuFacture() {
    var E = etat.editeur; if (!E) return;
    var t = $('fa-total'); if (t) t.textContent = 'Total : ' + euros(totalFacture(E.F));
    var z = $('a4-zone'); var iban = $('fa-iban'); if (z) render(z, renderA4(E.F, iban ? iban.value : ''));
  }
  document.addEventListener('input', function (ev) {
    var E = etat.editeur; var el = ev.target; if (!E || !el.dataset) return;
    if (el.dataset.fact) {
      if (el.dataset.fact !== 'iban') E.F[el.dataset.fact] = el.value;
      if (el.dataset.fact === 'client_id') majClientFacture();
      majApercuFacture();
    } else if (el.dataset.ligne) {
      var i = Number(el.dataset.i); var l = E.F.lignes[i]; if (!l) return;
      if (el.dataset.ligne === 'ref') {
        l.ref = el.value; var o = E.opts.filter(function (x) { return x.id === el.value; })[0];
        if (o) { l.designation = o.nom; l.prix = o.prix || 0; l.unite = o.unite; var d = $('li-des-' + i), p = $('li-p-' + i); if (d) d.value = o.nom; if (p) p.value = o.prix || 0; }
      } else if (el.dataset.ligne === 'quantite' || el.dataset.ligne === 'prix') l[el.dataset.ligne] = Number(el.value) || 0;
      else l[el.dataset.ligne] = el.value;
      var st = $('li-st-' + i); if (st) st.textContent = euros((Number(l.quantite) || 0) * (Number(l.prix) || 0));
      majApercuFacture();
    }
  });
  ACTIONS['ligne-ajouter'] = async function (d) {
    var E = etat.editeur; var o = d.libre ? null : E.opts[0];
    E.F.lignes.push(o ? { ref: o.id, designation: o.nom, quantite: 1, unite: o.unite, prix: o.prix || 0 } : { ref: '', designation: '', quantite: 1, unite: '', prix: 0 });
    render($('fa-lignes'), html`${E.F.lignes.map(function (l, i) { return ligneEditeur(l, i, E.opts); })}`); brancher($('fa-lignes')); majApercuFacture();
    var dern = $('li-des-' + (E.F.lignes.length - 1)); if (dern) dern.focus();
  };
  ACTIONS['ligne-supprimer'] = async function (d) {
    var E = etat.editeur; E.F.lignes.splice(Number(d.i), 1);
    if (!E.F.lignes.length) E.F.lignes.push({ ref: '', designation: '', quantite: 1, unite: '', prix: 0 });
    render($('fa-lignes'), html`${E.F.lignes.map(function (l, i) { return ligneEditeur(l, i, E.opts); })}`); brancher($('fa-lignes')); majApercuFacture();
  };
  ACTIONS['facture-enregistrer'] = async function (d) {
    var E = etat.editeur; var F = E.F;
    if (!F.client_id) throw new ApiError(400, 'Choisissez un client.');
    if (!F.lignes.length || F.lignes.some(function (l) { return !l.designation; })) throw new ApiError(400, 'Chaque ligne doit avoir une désignation.');
    var corps = { client_id: F.client_id, date: F.date, echeance: F.echeance, objet: F.objet || '', lignes: F.lignes, note: F.note || '', total_ht: totalFacture(F), tva: 0, statut: 'brouillon' };
    var apercu = [{ champ: 'Client', apres: F.client_nom || F.client_id }, { champ: 'Lignes', apres: F.lignes.length + ' ligne' + (F.lignes.length > 1 ? 's' : '') }, { champ: 'Total', apres: euros(totalFacture(F)) }, { champ: 'Échéance', apres: fmtDateLong(F.echeance) }];
    if (d.emettre) apercu.push({ champ: 'Numéro', avant: 'brouillon', apres: 'attribué à l’émission' }, { champ: 'Statut', avant: 'Brouillon', apres: 'Envoyée' });
    var r = await action({ titre: d.emettre ? 'Émettre la facture' : 'Enregistrer le brouillon', apercu: apercu,
      corps: d.emettre ? html`<p class="note avert">Le numéro sera attribué et la facture ne pourra plus être modifiée.</p>` : html`<p class="petit">Le brouillon reste modifiable et n’a pas de numéro.</p>`,
      valider: d.emettre ? 'Émettre' : 'Enregistrer',
      action: async function () {
        var res = F.id ? await api('/admin/factures/' + F.id, { method: 'PATCH', body: corps }) : await api('/admin/factures', { method: 'POST', body: corps });
        var id = F.id || (res && (res.id || (res.facture && res.facture.id)));
        if (d.emettre && id) await api('/admin/factures/' + id + '/emettre', { method: 'POST' });
        etat._apresFacture = id;
      }, succes: d.emettre ? 'Facture émise.' : 'Brouillon enregistré.' });
    if (r && !r.demo && etat._apresFacture) naviguer('factures/' + etat._apresFacture);
  };

  /* ============================================================
     ÉCRAN : CLIENTS
     ============================================================ */
  async function vueClients() {
    var r = await api('/admin/clients');
    var cs = r.clients || [];
    return html`
      <div class="entete-vue"><div><h1>Clients</h1><p class="hint">Chaque client a un jeton d’accès (affiché une seule fois) pour ses outils déployés.</p></div>
        <button type="button" class="btn sm" data-act="client-creer">Nouveau client</button></div>
      <div class="carte">${cs.length ? cs.map(function (c) {
        return html`<div class="ligne-clic" style="cursor:default"><b>${c.nom}</b>
          <span class="meta">${c.contact || '—'} · ${c.email || '—'} · ${c.projets || 0} projet${c.projets > 1 ? 's' : ''} · depuis ${fmtDate(c.cree)}</span>
          <span class="actions"><a class="btn ghost sm" href="/clients/${c.slug}/" target="_blank" rel="noopener">Ouvrir /clients/${c.slug}/</a>
            <button type="button" class="btn ghost sm" data-act="client-jeton" data-id="${c.id}" data-nom="${c.nom}">Régénérer le jeton</button></span></div>`;
      }) : html`<p class="vide">Aucun client.</p>`}</div>`;
  }
  function montrerJeton(nom, token) {
    return dialogue({ titre: 'Jeton de ' + nom, valider: null, annuler: 'Fermer', corps: html`<div class="encadre"><b>Copiez-le maintenant</b> : il ne sera plus jamais affiché. L’ancien jeton ne fonctionne plus.<code>${token}</code></div>` });
  }
  ACTIONS['client-creer'] = async function () {
    await action({ titre: 'Nouveau client', champs: [
      { id: 'nom', label: 'Nom', requis: true, placeholder: 'Domaine des Tilleuls' }, { id: 'slug', label: 'Identifiant (URL)', requis: true, placeholder: 'tilleuls', aide: 'Lettres, chiffres, tirets : /clients/<identifiant>/' },
      { id: 'contact', label: 'Contact', placeholder: 'Claire Martin' }, { id: 'email', label: 'E-mail', type: 'email' }], valider: 'Créer et générer le jeton',
      action: async function (v) {
        var r = await api('/admin/clients', { method: 'POST', body: { slug: slugify(v.slug), nom: v.nom, contact: v.contact, email: v.email } });
        if (r && r.token) await montrerJeton(v.nom, r.token);
      }, succes: 'Client créé.' });
  };
  ACTIONS['client-jeton'] = async function (d) {
    await action({ titre: 'Régénérer le jeton', danger: true, apercu: [{ champ: 'Jeton de ' + d.nom, avant: 'actuel', apres: 'nouveau (l’ancien cesse de fonctionner immédiatement)' }], valider: 'Régénérer',
      action: async function () { var r = await api('/admin/clients/' + d.id + '/regenerer', { method: 'POST' }); if (r && r.token) await montrerJeton(d.nom, r.token); }, succes: 'Jeton régénéré.' });
  };

  /* ============================================================
     ÉCRAN : RÉGLAGES, PLUS, ESPACES
     ============================================================ */
  function pref(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function setPref(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }
  async function vueReglages() {
    var theme = pref('bs-admin-theme') || 'systeme', taille = pref('bs-admin-taille') || 'normal';
    return html`
      <h1>Réglages</h1>
      <div class="carte"><h2>Service</h2>
        <dl class="def"><dt>URL de l’API</dt><dd><code>${BS_API || '(non définie dans assets/config.js)'}</code></dd><dt>État</dt><dd>${etat.demo ? 'Injoignable — aperçu avec des données d’exemple' : 'Joignable'}</dd>
        <dt>Session</dt><dd>Jeton gardé en mémoire de session seulement (fermé avec l’onglet).</dd></dl>
        <p class="aide">L’URL se change dans <code>assets/config.js</code>, pas ici.</p>
        <div class="actions"><button type="button" class="btn ghost sm" data-act="recharger">Retester le service</button><button type="button" class="btn danger sm" data-act="deconnexion">Se déconnecter</button></div></div>
      <div class="carte"><h2>Affichage</h2>
        <div class="field"><label for="r-theme">Thème</label><select id="r-theme" data-reglage="theme"><option value="systeme" ${theme === 'systeme' ? 'selected' : ''}>Comme le système</option><option value="clair" ${theme === 'clair' ? 'selected' : ''}>Clair</option><option value="sombre" ${theme === 'sombre' ? 'selected' : ''}>Sombre</option></select></div>
        <div class="field"><label for="r-taille">Taille du texte</label><select id="r-taille" data-reglage="taille"><option value="normal" ${taille === 'normal' ? 'selected' : ''}>Normale</option><option value="grand" ${taille === 'grand' ? 'selected' : ''}>Grande</option><option value="tres-grand" ${taille === 'tres-grand' ? 'selected' : ''}>Très grande</option></select></div>
        <p class="aide">Ces préférences restent sur cet appareil.</p></div>
      <div class="carte"><h2>Mentions de facturation</h2>
        <dl class="def"><dt>Nom</dt><dd>${MOI.nom} — ${MOI.entreprise}</dd><dt>Adresse</dt><dd>${MOI.adresse}, ${MOI.cp} ${MOI.ville}</dd><dt>SIRET</dt><dd>${MOI.siret}</dd><dt>TVA</dt><dd>Non applicable, art. 293 B du CGI</dd><dt>Tarif</dt><dd>${etat.catalogue ? etat.catalogue.taux_horaire + ' € HT l’heure (catalogue du ' + etat.catalogue.version + ')' : 'voir assets/catalogue.json'}</dd></dl></div>`;
  }
  document.addEventListener('change', function (ev) {
    var r = ev.target.dataset && ev.target.dataset.reglage; if (!r) return;
    if (r === 'theme') { var v = ev.target.value; setPref('bs-admin-theme', v === 'systeme' ? '' : v); if (v === 'systeme') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = (v === 'sombre' ? 'dark' : 'light'); }
    if (r === 'taille') { var t = ev.target.value; setPref('bs-admin-taille', t === 'normal' ? '' : t); if (t === 'normal') delete document.documentElement.dataset.taille; else document.documentElement.dataset.taille = t; }
  });
  ACTIONS.deconnexion = async function () { $('btn-deconnexion').click(); };
  async function vuePlus() {
    return html`<h1>Plus</h1><div class="carte">
      <a class="ligne-clic" href="#/factures"><b>Factures</b><span class="meta">Brouillons et factures émises depuis le tableau de bord</span></a>
      <a class="ligne-clic" href="#/publications"><b>Publications</b><span class="meta">Modifications du site en attente, aperçu et mise en ligne</span></a>
      <a class="ligne-clic" href="#/outils"><b>Outils</b><span class="meta">Raccourcis : Indy, Cloudflare, GitHub, Search Console…</span></a>
      <a class="ligne-clic" href="#/clients"><b>Clients</b><span class="meta">Jetons d’accès, espaces /clients/</span></a>
      <a class="ligne-clic" href="#/reglages"><b>Réglages</b><span class="meta">Thème, taille du texte, déconnexion</span></a>
      <a class="ligne-clic" href="#/espaces"><b>Espaces chiffrés (ancien outil)</b><span class="meta">Génération et rotation des pages chiffrées</span></a></div>`;
  }
  async function vueEspaces() { return html``; }

  /* ---------- démarrage ---------- */
  (async function demarrer() {
    chargerCatalogue().catch(function () {});
    var enLigne = await detecterService();
    etat.demo = !enLigne;
    var b = $('bandeau');
    if (etat.demo) { b.textContent = 'Service injoignable : aperçu avec des données d’exemple (rien n’est enregistré).'; b.hidden = false; }
    if (jeton()) montrerApp(); else montrerConnexion();
  })();
})();
