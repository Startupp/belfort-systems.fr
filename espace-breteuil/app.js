/*
 * Espace Breteuil — cœur de l'application (sans dépendance, sans compte).
 *
 * Ce fichier : outils communs (window.EB), planning (plusieurs calendriers),
 * « Aujourd'hui au Château », accueil, Mon espace, réglages, mode « calendrier seul »,
 * mises à jour, barre d'onglets, verrou des espaces Gestion / Finance.
 * Onglets (v3) : Accueil, Planning, Dossiers (connecte.js), Équipe, Plus. Écrans de démo : demos/.
 *
 * Tout ce qui vient d'un calendrier ou d'une saisie est inséré comme TEXTE.
 */
(function () {
  "use strict";

  var ICS = window.BreteuilICS;
  var CONFIG = self.EB_CONFIG || {};
  var VERSION = self.EB_VERSION || "?";
  var TZ = "Europe/Paris";
  var JOUR_MS = 86400000;
  var CACHE_PLANNING = "eb-planning";

  /* ------------------------------------------------------------------ */
  /* Stockage local (toujours protégé : navigation privée, blocages…)    */
  /* ------------------------------------------------------------------ */
  function lire(cle, defaut) {
    try { var v = localStorage.getItem(cle); return v == null ? defaut : JSON.parse(v); } catch (e) { return defaut; }
  }
  function ecrire(cle, valeur) {
    try { if (valeur == null) localStorage.removeItem(cle); else localStorage.setItem(cle, JSON.stringify(valeur)); return true; } catch (e) { return false; }
  }

  var REGLAGES_DEFAUT = { vue: "semaine", texte: "normal", theme: "auto", passes: "afficher", moi: "", ouvrirMonEspace: false, calendrierSeul: false };
  var reglages = Object.assign({}, REGLAGES_DEFAUT, lire("eb:reglages", {}));
  if (reglages.monEspace && !reglages.moi) { reglages.moi = reglages.monEspace; reglages.ouvrirMonEspace = true; } // reprise V1
  delete reglages.monEspace;
  function sauverReglages() { ecrire("eb:reglages", reglages); appliquerAffichage(); }
  function appliquerAffichage() {
    var r = document.documentElement;
    if (reglages.theme === "clair" || reglages.theme === "sombre") r.setAttribute("data-theme", reglages.theme); else r.removeAttribute("data-theme");
    if (reglages.texte === "grand" || reglages.texte === "tres-grand") r.setAttribute("data-texte", reglages.texte); else r.removeAttribute("data-texte");
  }

  /* ------------------------------------------------------------------ */
  /* Icônes (dessins fixes)                                              */
  /* ------------------------------------------------------------------ */
  var ICONES = {
    agenda: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
    soleil: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    maison: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    nuage: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    dossier: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    bulles: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    grille: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    couronne: '<path d="M3 7l5 5 4-7 4 7 5-5-2 11H5z"/><path d="M5 21h14"/>',
    euro: '<path d="M4 10h12M4 14h9"/><path d="M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2"/>',
    megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    accueil: '<path d="M3 18h18"/><path d="M5 18a7 7 0 0 1 14 0"/><path d="M12 11V8M10 8h4"/>',
    couverts: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
    feuille: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
    personne: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    personnes: '<circle cx="9" cy="7" r="4"/><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    cle: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
    reglages: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    retour: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    gauche: '<path d="m15 18-6-6 6-6"/>',
    droite: '<path d="m9 18 6-6-6-6"/>',
    lieu: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    cadenas: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    installer: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    horsligne: '<path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M2 8.82a15 15 0 0 1 4.17-2.65M10.66 5c4.01-.36 8.14.9 11.34 3.76M16.85 11.25a10 10 0 0 1 2.22 1.68M5 13a10 10 0 0 1 5.24-2.76M12 20h.01"/>',
    ouvrir: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    actualiser: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    exemple: '<path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>',
    horloge: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    coche: '<path d="M20 6 9 17l-5-5"/>',
    croix: '<path d="M18 6 6 18M6 6l12 12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    moins: '<path d="M5 12h14"/>',
    crayon: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    photo: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    etoile: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
    deplacer: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
    bouclier: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    points: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    livre: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
    reseau: '<rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v5M5 17v-3h14v3"/>',
    arrivee: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5M15 12H3"/>',
    depart: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    telephone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
    carte: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    facture: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
    calcul: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h8"/>',
    pouls: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    badge: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17a3.5 3.5 0 0 1 7 0M15 9h3M15 13h3"/>',
    palmier: '<path d="M13 8c0-2.8-2.2-5-5-5S3 5.2 3 8"/><path d="M13 8c0-2.8 2.2-5 5-5s5 2.2 5 5"/><path d="M13 8c-3 0-7 2-8 6M13 8c3 0 7 2 8 6M13 8v14"/>',
  };
  function icone(nom) {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("class", "ic");
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = ICONES[nom] || ICONES.info;
    return s;
  }

  /* ------------------------------------------------------------------ */
  /* Fabrique d'éléments : le texte est toujours inséré en texte         */
  /* ------------------------------------------------------------------ */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") el.className = v;
      else if (k.indexOf("on") === 0 && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "style" && typeof v === "object") {
        Object.keys(v).forEach(function (p) { if (p.indexOf("--") === 0) el.style.setProperty(p, v[p]); else el.style[p] = v[p]; });
      }
      else if (k === "value") el.value = v;
      else el.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) ajouter(el, arguments[i]);
    return el;
  }
  function ajouter(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { ajouter(el, x); }); return; }
    el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  function lienExterne(url, attrs) { return Object.assign({ href: url, target: "_blank", rel: "noopener noreferrer" }, attrs || {}); }
  function emoji(e, cls) { return h("span", { class: "emoji " + (cls || ""), "aria-hidden": "true" }, e); }

  /* ------------------------------------------------------------------ */
  /* Dates (toujours à l'heure de Paris)                                 */
  /* ------------------------------------------------------------------ */
  function jourDe(ms) { var p = ICS.partiesDans(ms, TZ); return { y: p.y, m: p.m, d: p.d }; }
  function debutJour(j) { return ICS.versInstant({ y: j.y, m: j.m, d: j.d, h: 0, mi: 0, s: 0 }, TZ); }
  function midi(j) { return ICS.versInstant({ y: j.y, m: j.m, d: j.d, h: 12, mi: 0, s: 0 }, TZ); }
  function plusJours(j, n) { var t = new Date(Date.UTC(j.y, j.m - 1, j.d) + n * JOUR_MS); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; }
  function plusMois(j, n) { var t = new Date(Date.UTC(j.y, j.m - 1 + n, 1)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: 1 }; }
  function cle(j) { return j.y * 10000 + j.m * 100 + j.d; }
  function rangLundi(j) { return (new Date(Date.UTC(j.y, j.m - 1, j.d)).getUTCDay() + 6) % 7; }
  function lundiDe(j) { return plusJours(j, -rangLundi(j)); }
  function aujourdhui() { return jourDe(Date.now()); }
  function versIso(j) { return j.y + "-" + String(j.m).padStart(2, "0") + "-" + String(j.d).padStart(2, "0"); }
  function depuisIso(s) { return { y: +s.slice(0, 4), m: +s.slice(5, 7), d: +s.slice(8, 10) }; }
  var formats = {};
  function fmt(ms, opts) {
    var k = JSON.stringify(opts);
    if (!formats[k]) formats[k] = new Intl.DateTimeFormat("fr-FR", Object.assign({ timeZone: TZ }, opts));
    return formats[k].format(ms);
  }
  function heure(ms) { var p = ICS.partiesDans(ms, TZ); return p.h + " h" + (p.mi ? " " + String(p.mi).padStart(2, "0") : ""); }
  function maj(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }
  function jourLong(j) { return fmt(midi(j), { weekday: "long", day: "numeric", month: "long" }); }
  function jourAvecAnnee(j) { return fmt(midi(j), { weekday: "long", day: "numeric", month: "long", year: "numeric" }); }
  function jourCourt(iso) { return fmt(midi(depuisIso(iso)), { weekday: "short", day: "numeric", month: "short" }); }

  /* ------------------------------------------------------------------ */
  /* Données : personnes, fiches, démo, annuaire Microsoft               */
  /* ------------------------------------------------------------------ */
  var donnees = { personnes: [], liens: {}, boites: {}, fiches: null };
  var demo = window.EBDemo.charger();
  var reel = null; // annuaire Microsoft (lecture seule) quand connecté
  var planning = null;
  var vuePlanning = { vue: reglages.vue, jour: aujourdhui() };

  function chargerJson(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(url + " : " + r.status); return r.json(); });
  }
  function personneParId(id) {
    for (var i = 0; i < donnees.personnes.length; i++) if (donnees.personnes[i].id === id) return donnees.personnes[i];
    return null;
  }
  /** Collaborateurs affichés : réels (Microsoft, lecture seule) ou fictifs (démo). */
  function collaborateurs() { return reel ? reel.collaborateurs : demo.collaborateurs; }
  function collaborateurParId(id) {
    var l = collaborateurs();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  function sauverDemo() { window.EBDemo.sauver(demo); }
  function quiAgit() {
    var p = reglages.moi && personneParId(reglages.moi);
    return p ? p.prenom : "Gestion";
  }
  function journal(action, detail) {
    window.EBDemo.journal(demo, quiAgit(), action + (reel ? " (simulation)" : ""), detail);
    sauverDemo();
  }

  /* ------------------------------------------------------------------ */
  /* Planning : plusieurs calendriers, chacun avec sa couleur            */
  /* ------------------------------------------------------------------ */
  function calendriers() {
    return CONFIG.calendriers && CONFIG.calendriers.length ? CONFIG.calendriers
      : [{ n: 1, nom: "Calendrier du Château", couleur: "#1F4BA8", exemple: "exemple.ics" }];
  }

  function sauverPlanningLocal(n, texte, quand) {
    try {
      if (window.caches) {
        caches.open(CACHE_PLANNING).then(function (c) {
          return c.put("planning-" + n + ".ics", new Response(texte, { headers: { "Content-Type": "text/calendar", "X-Quand": String(quand) } }));
        }).catch(function () {});
        return;
      }
    } catch (e) {}
    if (texte.length < 1500000) ecrire("eb:planning:" + n, { texte: texte, quand: quand });
  }
  function lirePlanningLocal(n) {
    var secours = lire("eb:planning:" + n, null);
    try {
      if (!window.caches) return Promise.resolve(secours);
      return caches.open(CACHE_PLANNING).then(function (c) { return c.match("planning-" + n + ".ics"); }).then(function (r) {
        if (!r) return secours;
        return r.text().then(function (t) { return { texte: t, quand: +(r.headers.get("X-Quand") || 0) }; });
      }).catch(function () { return secours; });
    } catch (e) { return Promise.resolve(secours); }
  }

  /** Charge une source : { etat: direct|ancien|hors-ligne|non-configure|panne, texte, quand }. */
  function chargerSource(cal) {
    var api = String(CONFIG.api || "").replace(/\/+$/, "");
    var res = { etat: "panne", texte: null, quand: null };
    var ctrl = window.AbortController ? new AbortController() : null;
    var minuteur = ctrl && setTimeout(function () { ctrl.abort(); }, 12000);
    var reseau = !api ? Promise.resolve() : fetch(api + "/breteuil/planning/" + cal.n + ".ics", { cache: "no-store", mode: "cors", signal: ctrl && ctrl.signal })
      .then(function (r) {
        if (r.ok) return r.text().then(function (t) {
          if (!/BEGIN:VCALENDAR/i.test(t)) return;
          res.texte = t;
          res.quand = Date.parse(r.headers.get("X-Planning-Date") || "") || Date.now();
          res.etat = r.headers.get("X-Planning-Etat") === "ancien" ? "ancien" : "direct";
          sauverPlanningLocal(cal.n, t, res.quand);
        });
        if (r.status === 503) return r.json().then(function (j) { if (j && j.code === "non_configure") res.etat = "non-configure"; }, function () {});
      }).catch(function () {});
    return reseau.then(function () {
      if (minuteur) clearTimeout(minuteur);
      if (res.texte || res.etat === "non-configure") return res;
      return lirePlanningLocal(cal.n).then(function (c) {
        if (c && c.texte) { res.texte = c.texte; res.quand = c.quand; res.etat = "hors-ligne"; }
        return res;
      });
    });
  }

  function chargerPlanning() {
    var cals = calendriers();
    return Promise.all(cals.map(chargerSource)).then(function (resultats) {
      var reels = resultats.filter(function (r) { return r.texte; });
      var tousNonConfigures = resultats.every(function (r) { return r.etat === "non-configure"; });
      if (reels.length) {
        var sources = [];
        resultats.forEach(function (r, i) {
          if (r.texte) sources.push({ cal: cals[i], analyse: ICS.analyser(r.texte), etat: r.etat, quand: r.quand });
        });
        var horsLigne = sources.some(function (s) { return s.etat === "hors-ligne"; });
        var ancien = sources.some(function (s) { return s.etat === "ancien"; });
        planning = { sources: sources, mode: horsLigne ? "hors-ligne" : ancien ? "ancien" : "direct",
          quand: Math.min.apply(null, sources.map(function (s) { return s.quand || Date.now(); })) };
        return;
      }
      // Rien de réel : exemples (un par calendrier), clairement signalés.
      return Promise.all(cals.map(function (c) {
        return fetch(c.exemple || "exemple.ics").then(function (r) { return r.ok ? r.text() : ""; }).catch(function () { return ""; });
      })).then(function (textes) {
        planning = { sources: textes.map(function (t, i) { return { cal: cals[i], analyse: ICS.analyser(t), etat: "exemple" }; }),
          mode: tousNonConfigures ? "exemple" : "exemple-panne", quand: null };
      });
    }).catch(function () { planning = { sources: [], mode: "exemple-panne", quand: null }; });
  }

  function simplifier(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function concerne(o, personne) {
    if (!personne || !personne.motsCles || !personne.motsCles.length) return true;
    var texte = simplifier([o.titre, o.lieu, o.description, o.categories].join(" "));
    return personne.motsCles.some(function (m) { return m && texte.indexOf(simplifier(m)) > -1; });
  }
  /** Occurrences de tous les calendriers entre deux instants (avec couleur de la source). */
  function occurrences(deMs, aMs, personne, ignorerPasses) {
    if (!planning) return [];
    var maintenant = Date.now(), out = [];
    planning.sources.forEach(function (s) {
      ICS.developper(s.analyse, deMs, aMs).forEach(function (o) {
        o.couleur = s.cal.couleur; o.source = s.cal.nom;
        if (!concerne(o, personne)) return;
        if (!ignorerPasses && reglages.passes === "masquer" && o.fin <= maintenant) return;
        out.push(o);
      });
    });
    out.sort(function (a, b) { return a.debut - b.debut || (b.journee - a.journee); });
    return out;
  }
  function duJour(liste, j) {
    var a = debutJour(j), b = debutJour(plusJours(j, 1));
    return liste.filter(function (o) { return o.debut < b && (o.fin > a || (o.fin === o.debut && o.debut >= a)); });
  }

  /* ------------------------------------------------------------------ */
  /* Éléments communs                                                    */
  /* ------------------------------------------------------------------ */
  /** En-tête bleu de chaque écran : bouton retour (sauf écrans d'onglet), titre, actions à droite. */
  function barre(titre, retour, droite, sousTitre) {
    return h("header", { class: "barre" },
      retour ? h("a", { class: "btn-retour", href: retour.href, "aria-label": "Retour : " + (retour.texte || "page précédente") }, icone("retour"), h("span", { class: "txt" }, retour.texte || "Retour")) : null,
      h("h1", null, titre, sousTitre ? h("small", null, sousTitre) : null),
      droite || null);
  }

  /**
   * Tuile compacte (4 par ligne sur téléphone) : icône + libellé court.
   * t : { href | onclick, icone, libelle, aide (phrase lue par les lecteurs d'écran), demo, bientot, couleur, avatar }.
   */
  function tuile(t) {
    var ico = t.avatar ? t.avatar : h("span", { class: "ico" + (t.couleur ? " ronde" : ""), style: t.couleur ? { background: t.couleur } : null }, icone(t.icone));
    var contenu = [ico, h("span", { class: "lib" }, t.libelle), t.sous ? h("span", { class: "sous" }, t.sous) : null,
      t.aide ? h("span", { class: "sr" }, " — " + t.aide) : null,
      t.demo ? h("span", { class: "marque", "aria-hidden": "true" }, "Démo") : null,
      t.bientot ? h("span", { class: "marque", "aria-hidden": "true" }, "Bientôt") : null];
    if (t.bientot) return h("div", { class: "t bientot", "aria-disabled": "true" }, contenu, h("span", { class: "sr" }, " (bientôt)"));
    var attrs = { class: "t" + (t.choisi ? " choisi" : ""), title: t.aide || null };
    if (t.href) { attrs.href = t.href; if (t.externe) { attrs.target = "_blank"; attrs.rel = "noopener noreferrer"; } return h("a", attrs, contenu); }
    attrs.type = "button"; attrs.onclick = t.onclick;
    return h("button", attrs, contenu);
  }
  function tuiles(liste, attrs) { return h("div", Object.assign({ class: "tuiles" }, attrs || {}), liste.filter(Boolean).map(tuile)); }

  /** Squelette de chargement (appels Microsoft) : n lignes grises animées. */
  function squelette(n, forme) {
    var el = h("div", { class: "squelettes" + (forme === "tuiles" ? " en-tuiles" : ""), role: "status", "aria-busy": "true" }, h("span", { class: "sr" }, "Chargement…"));
    for (var i = 0; i < (n || 3); i++) el.appendChild(h("div", { class: "squelette", "aria-hidden": "true" }));
    return el;
  }
  function bandeauDemo(texte) {
    if (reel && !texte) return h("p", { class: "pastille-demo reel" }, icone("coche"), "Données réelles de Microsoft — lecture seule");
    return h("p", { class: "pastille-demo" }, icone("info"), texte || "Démo — données fictives");
  }
  function bandeauSimulation() {
    return reel ? h("div", { class: "bandeau info" }, icone("info"), h("span", null, "Les changements sont simulés : rien n'est modifié chez Microsoft.")) : null;
  }
  function bandeauPlanning() {
    if (!planning) return null;
    var m = planning.mode;
    var date = planning.quand ? jourLong(jourDe(planning.quand)) + " à " + heure(planning.quand) : "";
    if (m === "exemple") return h("div", { class: "bandeau exemple", role: "note" }, icone("exemple"),
      h("div", null, h("strong", null, "Exemple — données fictives"), "Calendriers du Château pas encore branchés."));
    if (m === "exemple-panne") return h("div", { class: "bandeau exemple", role: "note" }, icone("exemple"),
      h("div", null, h("strong", null, "EXEMPLE — données fictives"), "Les calendriers ne répondent pas et rien n'est encore enregistré sur ce téléphone."));
    if (m === "hors-ligne") return h("div", { class: "bandeau info", role: "note" }, icone("horsligne"),
      h("div", null, h("strong", null, "Pas de connexion"), "Voici la dernière version enregistrée" + (date ? " (" + date + ")." : ".")));
    if (m === "ancien") return h("div", { class: "bandeau info", role: "note" }, icone("info"),
      h("div", null, h("strong", null, "Un calendrier ne répond pas"), "Voici la dernière version connue" + (date ? " (" + date + ")." : ".")));
    return null;
  }
  function legendeSources() {
    if (!planning || planning.sources.length < 2) return null;
    return h("div", { class: "legende", "aria-label": "Calendriers affichés" }, planning.sources.map(function (s) {
      return h("span", null, h("i", { style: { background: s.cal.couleur } }), s.cal.nom);
    }));
  }

  function carteEvenement(o, j) {
    var a = j ? debutJour(j) : null;
    var etiquette = o.journee ? "Journée" : (a != null && o.debut < a ? "Suite" : heure(o.debut));
    var passe = o.fin <= Date.now();
    return h("button", { class: "evt" + (o.journee ? " journee" : "") + (passe ? " passe" : ""), type: "button",
      style: { borderLeftColor: o.couleur || "" }, onclick: function () { ouvrirDetail(o); } },
      h("span", { class: "heure" }, etiquette),
      h("span", { class: "quoi" }, o.titre),
      o.lieu ? h("span", { class: "ou" }, icone("lieu"), o.lieu) : null);
  }

  /* Fenêtre (dialog) réutilisable */
  function dialogue() { var d = document.getElementById("detail"); d.textContent = ""; d.oncancel = null; return d; }
  function ouvrirDialogue(d, focus) {
    if (d.showModal) { if (!d.open) d.showModal(); } else d.setAttribute("open", "");
    if (focus) setTimeout(function () { focus.focus(); }, 30);
  }
  function fermerDialogue() { var d = document.getElementById("detail"); if (d.open) d.close(); }
  /* Clic sur le fond ou touche Échap : comme « Annuler » (l'événement cancel ne part pas lors d'une fermeture par le code). */
  document.addEventListener("click", function (e) { var d = document.getElementById("detail"); if (d && e.target === d) { if (d.oncancel) d.oncancel(); if (d.open) d.close(); } });

  function ouvrirDetail(o) {
    var d = dialogue();
    var j1 = jourDe(o.debut), jFin = jourDe(o.journee ? o.fin - 1 : o.fin), quand;
    if (o.journee) quand = cle(j1) === cle(jFin) ? jourAvecAnnee(j1) + " — toute la journée" : "Du " + jourLong(j1) + " au " + jourAvecAnnee(jFin);
    else if (cle(j1) === cle(jFin)) quand = jourAvecAnnee(j1) + ", de " + heure(o.debut) + " à " + heure(o.fin);
    else quand = "Du " + jourLong(j1) + " à " + heure(o.debut) + " au " + jourLong(jFin) + " à " + heure(o.fin);
    var fermer = h("button", { class: "btn large", type: "button", onclick: fermerDialogue }, "Fermer");
    d.appendChild(h("div", { class: "contenu" },
      h("h2", { id: "detail-titre" }, o.titre),
      h("div", { class: "ligne" }, icone("horloge"), h("span", null, maj(quand))),
      o.lieu ? h("div", { class: "ligne" }, icone("lieu"), h("span", null, o.lieu)) : null,
      o.source && planning && planning.sources.length > 1 ? h("div", { class: "ligne" }, h("i", { class: "rond", style: { background: o.couleur } }), h("span", null, o.source)) : null,
      o.recurrent ? h("div", { class: "ligne" }, icone("actualiser"), h("span", null, "Revient régulièrement")) : null,
      o.description ? h("div", { class: "description" }, o.description) : null,
      fermer));
    ouvrirDialogue(d, fermer);
  }

  /**
   * Confirmation en 2 étapes : 1) ce qui va se passer, 2) dernière vérification.
   * opts : { emoji, titre, phrase, consequence, bouton, deuxEtapes (défaut true) }.
   */
  function confirmer(opts) {
    return new Promise(function (fin) {
      var d = dialogue(), fini = false;
      function terminer(v) { if (fini) return; fini = true; fermerDialogue(); fin(v); }
      d.oncancel = function () { terminer(false); };
      function etape1() {
        d.textContent = "";
        var suite = h("button", { class: "btn large", type: "button", onclick: function () { opts.deuxEtapes === false ? terminer(true) : etape2(); } },
          opts.deuxEtapes === false ? (opts.bouton || "Confirmer") : "Continuer");
        d.appendChild(h("div", { class: "contenu centre" },
          opts.emoji ? emoji(opts.emoji, "grand") : null,
          h("h2", { id: "detail-titre" }, opts.titre || "Vérifions ensemble"),
          h("p", { class: "phrase" }, opts.phrase || ""),
          opts.deuxEtapes === false ? null : h("p", { class: "etape" }, "Étape 1 sur 2"),
          suite,
          h("button", { class: "btn secondaire large", type: "button", onclick: function () { terminer(false); } }, "Annuler")));
        ouvrirDialogue(d, suite);
      }
      function etape2() {
        d.textContent = "";
        var ok = h("button", { class: "btn large", type: "button", onclick: function () { terminer(true); } }, icone("coche"), opts.bouton || "Oui, je confirme");
        d.appendChild(h("div", { class: "contenu centre" },
          emoji("✋", "grand"),
          h("h2", { id: "detail-titre" }, "Dernière vérification"),
          h("p", { class: "phrase" }, opts.consequence || opts.phrase || ""),
          h("p", { class: "etape" }, "Étape 2 sur 2"),
          ok,
          h("button", { class: "btn secondaire large", type: "button", onclick: function () { terminer(false); } }, "Non, annuler")));
        ok.focus();
      }
      etape1();
    });
  }

  /** Choisir dans une liste de grosses cartes. elements : [{ valeur, titre, sous, emoji, avatar }]. */
  function choisir(titre, elements, phrase) {
    return new Promise(function (fin) {
      var d = dialogue(), fini = false;
      function terminer(v) { if (fini) return; fini = true; fermerDialogue(); fin(v); }
      d.oncancel = function () { terminer(null); };
      var liste = h("div", { class: "choix-liste" }, elements.map(function (e) {
        return h("button", { class: "choix", type: "button", onclick: function () { terminer(e.valeur); } },
          e.avatar || (e.emoji ? emoji(e.emoji) : null),
          h("span", null, h("b", null, e.titre), e.sous ? h("small", null, e.sous) : null));
      }));
      var annuler = h("button", { class: "btn secondaire large", type: "button", onclick: function () { terminer(null); } }, "Annuler");
      d.appendChild(h("div", { class: "contenu" }, h("h2", { id: "detail-titre" }, titre), phrase ? h("p", { class: "phrase" }, phrase) : null, liste, annuler));
      ouvrirDialogue(d, liste.firstChild || annuler);
    });
  }

  /* Message bref en bas d'écran */
  var minuteurToast = null;
  function toast(texte) {
    var t = document.getElementById("toast");
    if (!t) { t = h("div", { id: "toast", class: "toast", role: "status" }); document.body.appendChild(t); }
    t.textContent = texte;
    t.classList.add("visible");
    clearTimeout(minuteurToast);
    minuteurToast = setTimeout(function () { t.classList.remove("visible"); }, 3200);
  }

  /** Pastille de personne : photo, sinon initiales sur sa couleur. */
  function avatar(c, taille) {
    var el = h("span", { class: "avatar" + (taille ? " " + taille : ""), style: { background: (c && c.couleur) || "#1F4BA8" }, "aria-hidden": "true" });
    if (c && c.photo) el.appendChild(h("img", { src: c.photo, alt: "" }));
    else el.appendChild(document.createTextNode(initiales(c ? c.prenom : "?")));
    return el;
  }
  function initiales(prenom) {
    var p = String(prenom || "?").replace(/\./g, "").trim().split(/\s+/);
    return (p[0] ? p[0][0] : "?").toUpperCase() + (p[1] ? p[1][0].toUpperCase() : "");
  }

  /** Grosse ligne d'action : pictogramme + titre + une phrase. */
  function action(href, pictogramme, titre, phrase) {
    return h("a", { class: "action", href: href },
      emoji(pictogramme), h("span", null, h("b", null, titre), phrase ? h("small", null, phrase) : null),
      h("span", { class: "fleche", "aria-hidden": "true" }, "›"));
  }

  /* L'aide (téléphone de Damien) est à un seul endroit : onglet Plus. Les écrans qui appellent
   * encore pied() reçoivent un fragment vide (compatibilité avec les modules). */
  function pied() { return document.createDocumentFragment(); }

  /* ------------------------------------------------------------------ */
  /* Verrou des espaces Gestion / Finance (masque l'écran, pas sécurité) */
  /* ------------------------------------------------------------------ */
  function empreinte(texte) {
    if (!window.crypto || !crypto.subtle || !window.TextEncoder) return Promise.reject(new Error("crypto"));
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    });
  }
  function estOuvert(k) {
    var pack = donnees.fiches && donnees.fiches[k];
    return !!pack && (!pack.codeEmpreinte || lire("eb:ouvert:" + k, "") === pack.codeEmpreinte);
  }
  /** Vrai si l'un des espaces est ouvert ; sinon affiche le verrou du premier et renvoie faux. */
  function exiger(app, packs, retour) {
    for (var i = 0; i < packs.length; i++) if (estOuvert(packs[i])) return true;
    ecranVerrou(app, packs[0], retour);
    return false;
  }
  function ecranVerrou(app, k, retour) {
    var pack = donnees.fiches && donnees.fiches[k];
    app.appendChild(barre(pack ? pack.titre : "Espace réservé", retour || { href: "#/", texte: "Accueil" }));
    var champ = h("input", { class: "champ", type: "password", id: "code", autocomplete: "off", autocapitalize: "none", spellcheck: "false", inputmode: "text", "aria-describedby": "code-aide" });
    var erreur = h("p", { class: "erreur", role: "alert" });
    app.appendChild(h("div", { class: "verrou boite" },
      emoji("🔒", "grand"),
      h("h2", null, pack ? pack.titre : "Espace réservé"),
      h("p", null, "Tapez le code donné par Damien."),
      h("form", { onsubmit: function (e) {
        e.preventDefault();
        empreinte("espace-breteuil:" + champ.value.trim()).then(function (x) {
          if (pack && x === pack.codeEmpreinte) { ecrire("eb:ouvert:" + k, x); rendre(); }
          else { erreur.textContent = "Ce n'est pas le bon code."; champ.select(); }
        }, function () { erreur.textContent = "Ce navigateur ne permet pas de vérifier le code."; });
      } },
        h("label", { class: "sr", for: "code" }, "Code"), champ, erreur,
        h("button", { class: "btn large", type: "submit" }, icone("cle"), "Ouvrir")),
      h("p", { class: "petit", id: "code-aide" }, "Ce code cache seulement l'écran. La vraie protection, c'est votre connexion Microsoft.")));
    setTimeout(function () { champ.focus(); }, 50);
  }

  /* ------------------------------------------------------------------ */
  /* Connexion Microsoft (lecture seule) — invisible si non configurée   */
  /* ------------------------------------------------------------------ */
  /** Compte Microsoft (Réglages, un seul endroit) : état de la connexion, se déconnecter. */
  function blocMicrosoft() {
    var G = window.EBGraph;
    if (!G || !G.estConfigure()) return null;
    if (G.estConnecte()) {
      var c = G.compte();
      return h("div", { class: "boite reglage" }, h("h2", null, "Connecté" + (c && c.name ? " : " + c.name : "")),
        h("p", null, "L'appli agit avec vos droits Microsoft, ni plus ni moins."),
        h("button", { class: "btn secondaire", type: "button", onclick: function () { G.oublier(); reel = null; if (window.EBConnecte && window.EBConnecte.oublier) window.EBConnecte.oublier(); rendre(); } }, "Se déconnecter de l'appli"));
    }
    return h("div", { class: "boite reglage" }, h("h2", null, "Pas connecté"),
      h("p", null, "La connexion se fait depuis l'onglet Dossiers, avec votre adresse du Château."),
      G.erreur() ? h("p", { class: "erreur" }, G.erreur()) : null);
  }
  function chargerReel() {
    if (window.EBConnecte) window.EBConnecte.apresConnexion();
    return Promise.resolve();
  }
  var attenteRendu = null;
  function rendrePlusTard() { clearTimeout(attenteRendu); attenteRendu = setTimeout(rendre, 400); }

  /* ------------------------------------------------------------------ */
  /* Écran : accueil                                                     */
  /* ------------------------------------------------------------------ */
  var invitationInstallation = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); invitationInstallation = e; });
  function estInstallee() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
  }

  function resumeDuJour() {
    var auj = aujourdhui();
    return window.EBResume.resumer(occurrences(debutJour(auj), debutJour(plusJours(auj, 1)), null, true), donnees.personnes);
  }

  /* ------------------------------------------------------------------ */
  /* Onglet Accueil : « Aujourd'hui au Château » + « Qui êtes-vous ? »   */
  /* (l'ancien écran « Aujourd'hui » est fusionné ici : un seul endroit) */
  /* ------------------------------------------------------------------ */
  function ecranAccueil(app) {
    var auj = aujourdhui();
    app.appendChild(barre("Espace Breteuil", null,
      h("button", { class: "btn-rond", type: "button", "aria-label": "Actualiser le planning", title: "Actualiser", onclick: actualiserPlanning }, icone("actualiser")),
      maj(jourLong(auj))));
    var zone = h("section", { class: "zone-aujourdhui", "aria-label": "Aujourd'hui au Château" });
    app.appendChild(zone);
    surPlanning(zone, function () { dessinerAujourdhui(zone); });
    dessinerAujourdhui(zone);

    // Qui êtes-vous ? → Mon espace (raccourcis, boîtes, mon planning)
    var moi = reglages.moi;
    app.appendChild(h("section", { class: "section" },
      h("h2", null, "Mon espace"),
      tuiles(donnees.personnes.map(function (p) {
        return { href: "#/personne/" + encodeURIComponent(p.id), couleur: p.couleur || "#1F4BA8", icone: p.icone, libelle: p.prenom,
          aide: "Mon espace : raccourcis, boîtes mail et planning de " + p.prenom + " (" + p.role + ")", choisi: moi === p.id };
      }), { class: "tuiles personnes-accueil" })));
  }

  /** Contenu « Aujourd'hui » : redessiné seul quand le planning arrive (pas tout l'écran). */
  function dessinerAujourdhui(zone) {
    var auj = aujourdhui();
    zone.textContent = "";
    var b = bandeauPlanning(); if (b) zone.appendChild(b);
    if (!planning) { zone.appendChild(squelette(3)); return; }
    var r = resumeDuJour();
    var absents = r.absents.concat(r.conges);
    function groupe(cls, pictogramme, titre, liste, vide) {
      return h("div", { class: "groupe-jour " + cls },
        h("h3", null, emoji(pictogramme), titre, h("span", { class: "compte" }, String(liste.length))),
        liste.length ? h("div", { class: "visages" }, liste.map(function (x) {
          var c = collaborateurParId(x.personne.id) || x.personne;
          return h("button", { class: "visage", type: "button", "aria-label": x.personne.prenom + " : " + x.evenement.titre, onclick: function () { ouvrirDetail(x.evenement); } },
            avatar(Object.assign({}, c, { couleur: c.couleur || x.personne.couleur })), h("span", { "aria-hidden": "true" }, x.personne.prenom));
        })) : h("p", { class: "vide-doux" }, vide));
    }
    var carte = h("div", { class: "carte-aujourdhui" },
      h("p", { class: "phrase-jour" }, h("span", null, absents.length ? "Toute l'équipe est là, sauf " + absents.map(function (x) { return x.personne.prenom; }).join(", ") + "." : "Toute l'équipe est là aujourd'hui."),
        h("button", { class: "btn-info", type: "button", "aria-label": "Comment ce résumé est fait", onclick: function () {
          toast("Ce résumé lit le calendrier tenu par l'accueil : « Marco absent », « Yara congé » ou « Valérie D. télétravail » suffit.");
        } }, icone("info"))),
      h("div", { class: "groupes-jour" },
        groupe("absents", "🚫", "Absents", r.absents, "Personne"),
        groupe("conges", "🌴", "En congé", r.conges, "Personne"),
        groupe("teletravail", "🏠", "Télétravail", r.teletravail, "Personne"),
        groupe("presents", "🛎️", "Permanence", r.presents, "—")));
    zone.appendChild(carte);

    // Rendez-vous du jour et « À savoir » : 4 lignes au plus, la suite dans le planning du jour.
    var lignes = r.rendezVous.concat(r.infos);
    var MAX = 4;
    zone.appendChild(h("section", { class: "section" },
      h("h2", null, "Rendez-vous du jour"),
      lignes.length ? h("div", { class: "liste-rdv" }, lignes.slice(0, MAX).map(function (o) {
        return h("button", { class: "ligne-rdv" + (o.journee ? " journee" : ""), type: "button", style: { borderLeftColor: o.couleur || "" }, onclick: function () { ouvrirDetail(o); } },
          h("span", { class: "heure" }, o.journee ? "Journée" : heure(o.debut)), h("span", { class: "quoi" }, o.titre));
      })) : h("p", { class: "vide" }, "Aucun rendez-vous aujourd'hui."),
      lignes.length > MAX ? h("a", { class: "lien-plus", href: "#/planning", onclick: function () { vuePlanning.vue = "jour"; vuePlanning.jour = aujourdhui(); } },
        "+ " + (lignes.length - MAX) + " autre" + (lignes.length - MAX > 1 ? "s" : "") + " dans le planning du jour ›") : null));
  }

  function actualiserPlanning() {
    var bouton = this; if (bouton) bouton.disabled = true;
    chargerPlanning().then(function () { if (bouton) bouton.disabled = false; planningPret(); });
  }

  /* ------------------------------------------------------------------ */
  /* Écran : planning                                                    */
  /* ------------------------------------------------------------------ */
  var VUES = [["jour", "Jour"], ["semaine", "Semaine"], ["mois", "Mois"], ["liste", "Liste"]];
  var redessinerPlanning = function () {};

  /* Parties d'écran qui dépendent du planning : quand il arrive (ou est actualisé),
   * seules ces parties sont redessinées, pas l'écran entier. */
  var abonnesPlanning = [];
  function surPlanning(el, fn) { abonnesPlanning.push({ el: el, fn: fn }); }
  function planningPret() {
    abonnesPlanning = abonnesPlanning.filter(function (a) { return document.body.contains(a.el); });
    abonnesPlanning.forEach(function (a) { a.fn(); });
  }

  /** Bloc planning : changer de vue ou de période ne redessine QUE ce bloc (pas tout l'écran). */
  function blocPlanning(app, personne) {
    var bloc = h("div", { class: "bloc-planning" });
    app.appendChild(bloc);
    function dessiner(focus) {
      var v = vuePlanning;
      bloc.textContent = "";
      ajouter(bloc, bandeauPlanning());
      var seg = h("div", { class: "segments", role: "group", "aria-label": "Affichage", style: { "--n": "4" } });
      VUES.forEach(function (x) {
        seg.appendChild(h("button", { type: "button", "aria-pressed": String(v.vue === x[0]), "data-vue": x[0], onclick: function () { v.vue = x[0]; dessiner("vue-" + x[0]); } }, x[1]));
      });
      bloc.appendChild(seg);
      var titre, pas, auj = aujourdhui();
      if (v.vue === "jour") { titre = maj(jourAvecAnnee(v.jour)); pas = function (n) { v.jour = plusJours(v.jour, n); }; }
      else if (v.vue === "semaine" || v.vue === "liste") {
        var l = lundiDe(v.jour), d = plusJours(l, 6);
        titre = v.vue === "liste" ? (cle(debutListe(v.jour)) < cle(v.jour) ? "Depuis le " : "À partir du ") + jourLong(debutListe(v.jour)) :
          fmt(midi(l), { day: "numeric", month: l.m === d.m ? undefined : "short" }) + " – " + fmt(midi(d), { day: "numeric", month: "short", year: "numeric" });
        pas = function (n) { v.jour = plusJours(v.jour, 7 * n); };
      } else { titre = maj(fmt(midi(v.jour), { month: "long", year: "numeric" })); pas = function (n) { v.jour = plusMois(v.jour, n); }; }
      var estAuj = cle(v.jour) === cle(auj);
      bloc.appendChild(h("div", { class: "nav-periode" },
        h("button", { class: "btn-rond", type: "button", "aria-label": "Précédent", "data-nav": "prec", onclick: function () { pas(-1); dessiner("prec"); } }, icone("gauche")),
        h("div", { class: "titre-periode", "aria-live": "polite" }, titre),
        h("button", { class: "btn-rond", type: "button", "aria-label": "Suivant", "data-nav": "suiv", onclick: function () { pas(1); dessiner("suiv"); } }, icone("droite")),
        h("button", { class: "btn" + (estAuj ? " secondaire" : ""), type: "button", "data-nav": "auj", onclick: function () { v.jour = aujourdhui(); dessiner("auj"); } }, "Aujourd'hui")));
      ajouter(bloc, legendeSources());
      var zone = h("div", { class: "zone-planning" });
      if (!planning) zone.appendChild(squelette(4));
      else if (v.vue === "jour") vueJour(zone, v.jour, personne);
      else if (v.vue === "semaine") vueSemaine(zone, v.jour, personne);
      else if (v.vue === "mois") vueMois(zone, v.jour, personne);
      else vueListe(zone, v.jour, personne);
      bloc.appendChild(zone);
      // Garder le focus sur le bouton touché (clavier, lecteurs d'écran).
      if (focus) {
        var cible = focus.indexOf("vue-") === 0 ? bloc.querySelector('[data-vue="' + focus.slice(4) + '"]') : bloc.querySelector('[data-nav="' + focus + '"]');
        if (cible) cible.focus({ preventScroll: true });
      }
    }
    redessinerPlanning = function () { if (document.body.contains(bloc)) dessiner(); };
    surPlanning(bloc, function () { dessiner(); });
    dessiner();
  }

  function ecranPlanning(app, chemin) {
    var personne = chemin[1] ? personneParId(chemin[1]) : null;
    var actualiser = h("button", { class: "btn-rond", type: "button", "aria-label": "Actualiser le planning", title: "Actualiser", onclick: actualiserPlanning }, icone("actualiser"));
    app.appendChild(barre(personne ? "Planning de " + personne.prenom : "Planning",
      personne ? { href: "#/personne/" + encodeURIComponent(personne.id), texte: "Mon espace" } : null, actualiser));
    if (personne) app.appendChild(h("div", { class: "filtre-personne" },
      h("span", null, "Seulement ce qui concerne ", h("b", null, personne.prenom), "."),
      h("a", { class: "btn secondaire petit", href: "#/planning" }, "Tout voir")));
    blocPlanning(app, personne);
  }

  /* Mode « calendrier seul » : le planning en plein écran, rien d'autre. */
  function ecranCalendrierSeul(app) {
    app.appendChild(barre("Planning du Château", null, h("button", { class: "btn-rond", type: "button", "aria-label": "Actualiser le planning", onclick: actualiserPlanning }, icone("actualiser"))));
    blocPlanning(app, null);
    app.appendChild(h("p", { class: "lien-discret" }, h("button", { type: "button", onclick: function () {
      confirmer({ emoji: "🏠", titre: "Revenir à l'appli complète ?", phrase: "L'appli s'ouvrira de nouveau sur l'accueil, avec toutes les rubriques.", bouton: "Oui, appli complète", deuxEtapes: false })
        .then(function (ok) { if (ok) { reglages.calendrierSeul = false; sauverReglages(); location.hash = "#/"; rendre(); } });
    } }, "Revenir à l'appli complète")));
  }

  function vueJour(zone, j, personne) {
    var liste = occurrences(debutJour(j), debutJour(plusJours(j, 1)), personne);
    if (!liste.length) { zone.appendChild(h("p", { class: "vide" }, "Rien de prévu ce jour-là.")); return; }
    zone.appendChild(h("div", { class: "evts" }, liste.map(function (o) { return carteEvenement(o, j); })));
  }
  function vueSemaine(zone, j, personne) {
    var l = lundiDe(j), auj = cle(aujourdhui());
    var liste = occurrences(debutJour(l), debutJour(plusJours(l, 7)), personne);
    var grille = h("div", { class: "semaine" });
    for (var i = 0; i < 7; i++) (function (jj) {
      var evts = duJour(liste, jj);
      grille.appendChild(h("div", { class: "jour-boite" + (cle(jj) === auj ? " aujourdhui" : "") },
        h("button", { class: "jour-titre", type: "button", onclick: function () { vuePlanning.vue = "jour"; vuePlanning.jour = jj; redessinerPlanning(); } },
          maj(fmt(midi(jj), { weekday: "long", day: "numeric" }))),
        evts.length ? h("div", { class: "evts" }, evts.map(function (o) { return carteEvenement(o, jj); })) : h("p", { class: "rien" }, "—")));
    })(plusJours(l, i));
    zone.appendChild(grille);
  }
  function vueMois(zone, j, personne) {
    var premier = { y: j.y, m: j.m, d: 1 }, depart = lundiDe(premier), auj = cle(aujourdhui());
    var liste = occurrences(debutJour(depart), debutJour(plusJours(depart, 42)), personne);
    var g = h("div", { class: "mois", "aria-label": fmt(midi(premier), { month: "long", year: "numeric" }) });
    ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."].forEach(function (n) { g.appendChild(h("div", { class: "entete-jour", "aria-hidden": "true" }, n)); });
    for (var i = 0; i < 42; i++) (function (jj) {
      var evts = duJour(liste, jj);
      var titres = evts.slice(0, 3).map(function (o) { return h("span", { style: { borderLeftColor: o.couleur } }, (o.journee ? "" : heure(o.debut) + " ") + o.titre); });
      if (evts.length > 3) titres.push(h("span", { class: "plus" }, "+ " + (evts.length - 3) + " autre" + (evts.length > 4 ? "s" : "")));
      g.appendChild(h("button", {
        class: "case" + (jj.m !== j.m ? " dehors" : "") + (cle(jj) === auj ? " aujourdhui" : ""), type: "button",
        "aria-label": jourLong(jj) + (evts.length ? ", " + evts.length + " rendez-vous" : ", rien de prévu"),
        onclick: function () { vuePlanning.vue = "jour"; vuePlanning.jour = jj; redessinerPlanning(); },
      },
        h("span", { class: "num" }, String(jj.d)),
        h("span", { class: "points", "aria-hidden": "true" }, evts.slice(0, 4).map(function (o) { return h("i", { style: { background: o.couleur } }); })),
        h("span", { class: "titres", "aria-hidden": "true" }, titres)));
    })(plusJours(depart, i));
    zone.appendChild(g);
  }
  function debutListe(j) { return reglages.passes === "afficher" && cle(j) === cle(aujourdhui()) ? plusJours(j, -7) : j; }
  function vueListe(zone, j, personne, nbJours, sansPasses) {
    nbJours = nbJours || 60;
    var debut = sansPasses ? j : debutListe(j);
    var liste = occurrences(debutJour(debut), debutJour(plusJours(j, nbJours)), personne, sansPasses);
    if (sansPasses) { var t = Date.now(); liste = liste.filter(function (o) { return o.fin > t; }); }
    var auj = cle(aujourdhui()), jours = 0;
    for (var i = 0; cle(plusJours(debut, i)) < cle(plusJours(j, nbJours)); i++) {
      var jj = plusJours(debut, i), evts = duJour(liste, jj);
      if (!evts.length) continue;
      jours++;
      zone.appendChild(h("section", { class: "liste-jour" + (cle(jj) === auj ? " aujourdhui" : "") },
        h("h3", null, cle(jj) === auj ? "Aujourd'hui — " + jourLong(jj) : maj(jourLong(jj))),
        h("div", { class: "evts" }, evts.map(function (o) { return carteEvenement(o, jj); }))));
    }
    if (!jours) zone.appendChild(h("p", { class: "vide" }, "Rien de prévu sur cette période."));
  }

  /* ------------------------------------------------------------------ */
  /* Écran : Mon espace                                                  */
  /* ------------------------------------------------------------------ */
  function ecranPersonne(app, chemin) {
    var p = personneParId(chemin[1]);
    if (!p) { location.hash = "#/"; return; }
    app.appendChild(barre("Bonjour " + p.prenom, { href: "#/", texte: "Accueil" }, null, "Mon espace · " + p.role));

    // Raccourcis Microsoft : petites tuiles ; « dans l'appli » (téléphone) regroupé en une ligne.
    var raccourcis = (p.raccourcis || []).map(function (k) { return donnees.liens[k]; }).filter(Boolean);
    var mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (raccourcis.length) {
      var applis = [], vues = {};
      raccourcis.forEach(function (l) { if (mobile && l.appli && !vues[l.appli]) { vues[l.appli] = 1; applis.push(l); } });
      app.appendChild(h("section", { class: "section" },
        h("h2", null, "Mes raccourcis"),
        tuiles(raccourcis.map(function (l) { return { href: l.url, externe: true, icone: l.icone, libelle: l.titre, aide: l.texte }; })),
        applis.length ? h("div", { class: "puces-appli" }, "Dans l'appli :", applis.map(function (l) {
          return h("a", { class: "tuile-appli", href: l.appli }, icone("ouvrir"), { "ms-outlook://": "Outlook", "ms-onedrive://": "OneDrive", "msteams://": "Teams" }[l.appli] || l.titre);
        })) : null));
    }

    var boites = (p.boites || []).map(function (k) { return donnees.boites[k]; }).filter(Boolean);
    if (boites.length) app.appendChild(h("section", { class: "section" },
      h("h2", null, "Boîtes partagées"),
      tuiles(boites.map(function (b) {
        return { href: "https://outlook.office.com/mail/" + encodeURIComponent(b.adresse) + "/", externe: true, icone: "mail", libelle: b.nom,
          aide: "Ouvrir la boîte partagée " + b.adresse + " (une adresse que plusieurs personnes lisent)" };
      }))));

    if (demo.mfa && demo.mfa.obligatoire) app.appendChild(h("section", { class: "section" }, h("div", { class: "actions-liste" },
      action("#/securite/guide", "🛡️", "Sécuriser mon compte", "Activer la double authentification en 3 étapes."))));

    var zone = h("div", null);
    function dessinerMonPlanning() {
      zone.textContent = "";
      ajouter(zone, bandeauPlanning());
      if (planning) vueListe(zone, aujourdhui(), p, 7, true);
      else zone.appendChild(squelette(2));
    }
    surPlanning(zone, dessinerMonPlanning);
    dessinerMonPlanning();
    app.appendChild(h("section", { class: "section" },
      h("h2", null, "Mon planning — 7 jours"), zone,
      h("a", { class: "lien-plus", href: "#/planning/" + encodeURIComponent(p.id) }, "Mon planning complet ›")));
  }

  /* ------------------------------------------------------------------ */
  /* Onglets Équipe et Plus, espace Finance, guides                      */
  /* Chaque fonction n'est accessible qu'à UN endroit (voir la PR v3).   */
  /* ------------------------------------------------------------------ */
  function verrouiller(k, retour) {
    var pack = donnees.fiches && donnees.fiches[k];
    if (!pack || !pack.codeEmpreinte || !estOuvert(k)) return null;
    return h("button", { class: "btn-rond", type: "button", "aria-label": "Verrouiller cet écran", title: "Verrouiller",
      onclick: function () { ecrire("eb:ouvert:" + k, null); toast("Écran verrouillé sur ce téléphone."); location.hash = retour || "#/"; } }, icone("cadenas"));
  }
  function ecranEquipe(app) {
    app.appendChild(barre("Équipe", null, verrouiller("admin", "#/equipe")));
    app.appendChild(h("section", { class: "section" }, h("h2", null, "Annuaire Microsoft"),
      tuiles([
        { href: "#/personnes", icone: "personnes", libelle: "Personnes", aide: "L'équipe, les boîtes partagées et les externes (étiquette EXTERNE)" },
        { href: "#/licences-reel", icone: "badge", libelle: "Licences", aide: "Qui a quelle licence Microsoft, combien il en reste" },
        { href: "#/organisation", icone: "reseau", libelle: "Qui a quoi", aide: "Organisation : comprendre qui a quoi, en un schéma à toucher" },
      ])));
    app.appendChild(h("section", { class: "section" }, h("h2", null, "Gestion du Château", h("span", { class: "pastille-demo mini" }, "Démo")),
      tuiles([
        { href: "#/absences", icone: "palmier", libelle: "Absences", aide: "Congés, absences et télétravail de l'équipe" },
        { href: "#/arrivee/1", icone: "arrivee", libelle: "Arrivée", aide: "Quelqu'un arrive : créer son compte en 4 étapes" },
        { href: "#/depart", icone: "depart", libelle: "Départ", aide: "Quelqu'un part : bloquer son compte et transmettre son travail" },
        { href: "#/roles", icone: "etoile", libelle: "Rôles", aide: "Rôles et délégations : qui peut gérer quoi" },
        { href: "#/boites", icone: "mail", libelle: "Boîtes mail", aide: "Les boîtes de chacun et les boîtes partagées, avec leur photo" },
        { href: "#/securite", icone: "bouclier", libelle: "Double auth.", aide: "Double authentification : activer, suivre, relancer" },
        { href: "#/historique", icone: "horloge", libelle: "Historique", aide: "Qui a fait quoi, et quand" },
        { href: "#/guides/admin", icone: "livre", libelle: "Guides", aide: "Les mêmes gestes, pas à pas, sur le site de Microsoft" },
        { bientot: true, icone: "cle", libelle: "Mot de passe", aide: "Donner un mot de passe provisoire" },
      ])));
  }
  function ecranPlus(app) {
    app.appendChild(barre("Plus", null));
    app.appendChild(tuiles([
      { href: "#/finance", icone: "euro", libelle: "Finance", aide: "Coût des licences, factures, moyen de paiement" },
      { href: "#/reglages", icone: "reglages", libelle: "Réglages", aide: "Texte, couleurs, ce téléphone, planning, compte Microsoft" },
      window.EBDiagnostic ? { href: "#/verifier", icone: "pouls", libelle: "Vérifier la connexion", aide: "Tester pas à pas la connexion au Château et copier un rapport pour Damien" } : null,
      estInstallee() ? null : { href: "#/installer", icone: "installer", libelle: "Installer l'appli", aide: "Une icône sur l'écran d'accueil, sans compte" },
      { href: "tel:+33609897443", icone: "telephone", libelle: "Appeler Damien", aide: "Besoin d'aide ? Damien, Belfort Systems, 06 09 89 74 43" },
    ]));
    app.appendChild(h("p", { class: "pied" }, "Espace Breteuil · version " + VERSION + " · Belfort Systems"));
  }
  function ecranFinance(app) {
    if (!exiger(app, ["finance"], { href: "#/plus", texte: "Plus" })) return;
    app.appendChild(barre("Finance", { href: "#/plus", texte: "Plus" }, verrouiller("finance", "#/plus")));
    app.appendChild(bandeauDemo("Démo — données fictives"));
    app.appendChild(tuiles([
      { href: "#/licences", icone: "euro", libelle: "Coût", aide: "Licences et coût par mois : combien on paie, pour qui" },
      { href: "#/simulateur", icone: "calcul", libelle: "Simulateur", aide: "Acheter ou retirer des licences : voir le nouveau prix avant de décider" },
      { href: "#/factures", icone: "facture", libelle: "Factures", aide: "Les factures Microsoft, mois par mois" },
      { href: "#/paiement", icone: "carte", libelle: "Paiement", aide: "Moyen de paiement : carte bancaire ou prélèvement" },
      { href: "#/guides/finance", icone: "livre", libelle: "Guides", aide: "Les mêmes gestes sur le site de Microsoft" },
    ]));
  }
  function ecranGuides(app, chemin) {
    var k = chemin[1] === "finance" ? "finance" : "admin";
    var retourHub = k === "admin" ? { href: "#/equipe", texte: "Équipe" } : { href: "#/finance", texte: "Finance" };
    if (!exiger(app, [k], retourHub)) return;
    var pack = donnees.fiches[k], idFiche = chemin[2];
    if (idFiche) {
      var f = (pack.fiches || []).filter(function (x) { return x.id === idFiche; })[0];
      if (!f) { location.hash = "#/guides/" + k; return; }
      app.appendChild(barre(f.titre, { href: "#/guides/" + k, texte: "Guides" }));
      app.appendChild(h("ol", { class: "etapes" }, f.etapes.map(function (e) { return h("li", null, h("span", null, e)); })));
      if (f.lien) app.appendChild(h("div", { class: "actions" }, h("a", lienExterne(f.lien.url, { class: "btn large" }), icone("ouvrir"), f.lien.texte)));
      if (f.note) app.appendChild(h("div", { class: "note" }, icone("info"), h("span", null, f.note)));
      return;
    }
    app.appendChild(barre("Guides Microsoft", retourHub));
    app.appendChild(h("p", { class: "aide-ecran" }, "Pour faire ces gestes pour de vrai, sur le site de Microsoft."));
    app.appendChild(h("div", { class: "liste-fiches" }, (pack.fiches || []).map(function (f) {
      return h("a", { href: "#/guides/" + k + "/" + encodeURIComponent(f.id) }, icone(f.icone), h("span", null, f.titre), h("span", { class: "fleche", "aria-hidden": "true" }, "›"));
    })));
  }

  /* ------------------------------------------------------------------ */
  /* Écran : réglages                                                    */
  /* ------------------------------------------------------------------ */
  /** Choix en segments. Par défaut, seul le groupe touché est mis à jour (pas tout l'écran) ;
   * opts.structure = vrai quand le choix change le contenu de l'écran (alors on redessine). */
  function choix(titre, aide, cleR, options, apres, opts) {
    var seg = h("div", { class: "segments", role: "group", "aria-label": titre, style: { "--n": String(options.length) } });
    options.forEach(function (o) {
      seg.appendChild(h("button", { type: "button", "aria-pressed": String(reglages[cleR] === o[0]),
        onclick: function () {
          reglages[cleR] = o[0]; if (cleR === "vue") vuePlanning.vue = o[0]; sauverReglages(); if (apres) apres(o[0]);
          if (opts && opts.structure) { rendre(); return; }
          Array.prototype.forEach.call(seg.children, function (b, i) { b.setAttribute("aria-pressed", String(options[i][0] === o[0])); });
        } }, o[1]));
    });
    return h("div", { class: "boite reglage" }, h("h2", null, titre), aide ? h("p", null, aide) : null, seg);
  }

  function ecranReglages(app) {
    app.appendChild(barre("Réglages", { href: "#/plus", texte: "Plus" }, null, "Gardés sur ce téléphone uniquement"));
    app.appendChild(h("h2", { class: "titre-groupe" }, "Affichage"));
    app.appendChild(h("div", { class: "grille-reglages" },
      choix("Taille du texte", null, "texte", [["normal", "Normal"], ["grand", "Grand"], ["tres-grand", "Très grand"]]),
      choix("Couleurs", null, "theme", [["auto", "Auto"], ["clair", "Clair"], ["sombre", "Sombre"]])));

    app.appendChild(h("h2", { class: "titre-groupe" }, "Ce téléphone"));
    var select = h("select", { class: "champ", id: "moi", onchange: function () { reglages.moi = this.value; if (!this.value) reglages.ouvrirMonEspace = false; sauverReglages(); rendre(); } },
      h("option", { value: "" }, "Personne en particulier"),
      donnees.personnes.map(function (p) { return h("option", { value: p.id, selected: reglages.moi === p.id }, p.prenom + " (" + p.role + ")"); }));
    app.appendChild(h("div", { class: "grille-reglages" },
      h("div", { class: "boite reglage" }, h("h2", null, h("label", { for: "moi" }, "C'est le téléphone de…")), select),
      reglages.moi ? choix("Ouvrir mon espace au démarrage", null, "ouvrirMonEspace", [[true, "Oui"], [false, "Non"]]) : null,
      choix("Mode « calendrier seul »", "Ouvre directement le planning en plein écran. Un petit lien en bas permet de revenir.",
        "calendrierSeul", [[true, "Activé"], [false, "Désactivé"]], function (v) { if (v) location.hash = "#/"; }, { structure: true })));

    app.appendChild(h("h2", { class: "titre-groupe" }, "Planning"));
    app.appendChild(h("div", { class: "grille-reglages" },
      choix("Affichage au départ", null, "vue", VUES),
      choix("Rendez-vous passés", null, "passes", [["afficher", "Afficher"], ["masquer", "Masquer"]])));

    var compte = blocMicrosoft();
    if (compte) { app.appendChild(h("h2", { class: "titre-groupe" }, "Compte Microsoft")); app.appendChild(compte); }

    app.appendChild(h("h2", { class: "titre-groupe" }, "Démo et version"));
    app.appendChild(h("div", { class: "grille-reglages" },
      h("div", { class: "boite reglage" },
        h("p", null, "Les essais faits dans la démo restent sur ce téléphone."),
        h("button", { class: "btn secondaire", type: "button", onclick: function () {
          confirmer({ emoji: "🧹", titre: "Effacer les essais de la démo ?", phrase: "La démo revient comme au premier jour. Les vrais comptes Microsoft ne sont pas concernés.", bouton: "Oui, tout remettre", deuxEtapes: false })
            .then(function (ok) { if (ok) { demo = window.EBDemo.reinitialiser(); toast("La démo est remise à zéro."); rendre(); } });
        } }, "Remettre la démo à zéro")),
      h("div", { class: "boite reglage version" },
        h("h2", null, "Version " + VERSION),
        h("p", null, "L'appli se met à jour toute seule."),
        h("button", { class: "btn secondaire", type: "button", onclick: function () { verifierMiseAJour(true); } }, icone("actualiser"), "Rechercher une mise à jour"))));
    app.appendChild(h("div", { class: "actions" },
      h("button", { class: "btn secondaire", type: "button", onclick: function () {
        reglages = Object.assign({}, REGLAGES_DEFAUT); vuePlanning.vue = reglages.vue; sauverReglages(); rendre();
      } }, "Remettre les réglages d'origine")));
  }

  /* ------------------------------------------------------------------ */
  /* Écran : installer                                                   */
  /* ------------------------------------------------------------------ */
  function ecranInstaller(app) {
    app.appendChild(barre("Installer l'appli", { href: "#/plus", texte: "Plus" }));
    if (estInstallee()) { app.appendChild(h("div", { class: "boite" }, h("p", null, "C'est fait : l'Espace Breteuil est installé sur ce téléphone."))); return; }
    app.appendChild(h("p", { class: "aide-ecran" }, "L'Espace Breteuil s'installe comme une appli, sans compte et sans mot de passe."));
    if (invitationInstallation) app.appendChild(h("div", { class: "actions" }, h("button", { class: "btn large", type: "button", onclick: function () {
      var inv = invitationInstallation; invitationInstallation = null;
      inv.prompt(); inv.userChoice.then(rendre, rendre);
    } }, icone("installer"), "Installer maintenant")));
    app.appendChild(h("div", { class: "boite" }, h("h3", null, emoji("🍎"), " iPhone ou iPad (Safari)"),
      h("ol", { class: "etapes" },
        h("li", null, h("span", null, "Touchez le bouton Partager (le carré avec une flèche vers le haut).")),
        h("li", null, h("span", null, "Choisissez « Sur l'écran d'accueil ».")),
        h("li", null, h("span", null, "Touchez « Ajouter ». C'est fini.")))));
    app.appendChild(h("div", { class: "boite" }, h("h3", null, emoji("🤖"), " Android (Chrome)"),
      h("ol", { class: "etapes" },
        h("li", null, h("span", null, "Touchez les trois petits points en haut à droite.")),
        h("li", null, h("span", null, "Choisissez « Installer l'application ».")),
        h("li", null, h("span", null, "Confirmez. C'est fini.")))));
  }

  /* ------------------------------------------------------------------ */
  /* Mises à jour (service worker)                                       */
  /* ------------------------------------------------------------------ */
  var enregistrement = null, rechargementEnCours = false;
  function afficherMiseAJour(attente) {
    var m = document.getElementById("maj");
    m.textContent = "";
    m.appendChild(h("span", null, emoji("✨"), " Nouvelle version disponible"));
    m.appendChild(h("button", { class: "btn", type: "button", onclick: function () { activer(attente); } }, "Mettre à jour"));
    m.hidden = false;
  }
  function activer(attente) {
    if (!attente) return;
    rechargementEnCours = true;
    attente.postMessage({ type: "SKIP_WAITING" });
  }
  function enTrainDeSaisir() {
    var a = document.activeElement;
    return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) || !!(document.getElementById("detail") || {}).open;
  }
  function verifierMiseAJour(manuel) {
    if (!enregistrement) { if (manuel) toast("Les mises à jour ne sont pas disponibles ici."); return; }
    enregistrement.update().then(function () {
      if (manuel && !enregistrement.waiting && !enregistrement.installing) toast("L'appli est à jour (version " + VERSION + ").");
    }).catch(function () { if (manuel) toast("Pas de connexion : réessayez plus tard."); });
  }
  function demarrerMisesAJour() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (rechargementEnCours) location.reload();
    });
    navigator.serviceWorker.register("sw.js", { scope: "./" }).then(function (reg) {
      enregistrement = reg;
      // Une version attendait déjà : on est au lancement, personne ne saisit → mise à jour tout de suite.
      if (reg.waiting && navigator.serviceWorker.controller) {
        if (!enTrainDeSaisir()) activer(reg.waiting); else afficherMiseAJour(reg.waiting);
      }
      reg.addEventListener("updatefound", function () {
        var nouveau = reg.installing;
        if (!nouveau) return;
        nouveau.addEventListener("statechange", function () {
          if (nouveau.state === "installed" && navigator.serviceWorker.controller) afficherMiseAJour(nouveau);
        });
      });
      var derniere = Date.now();
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible" && Date.now() - derniere > 30 * 60000) { derniere = Date.now(); verifierMiseAJour(false); }
      });
      setInterval(function () { verifierMiseAJour(false); }, 60 * 60000);
    }).catch(function () {});
  }

  /* ------------------------------------------------------------------ */
  /* Navigation par ÉCRANS séparés + barre d'onglets (5 au plus)        */
  /* ------------------------------------------------------------------ */
  var ecrans = {
    "": ecranAccueil, planning: ecranPlanning, personne: ecranPersonne, equipe: ecranEquipe, plus: ecranPlus,
    reglages: ecranReglages, installer: ecranInstaller, finance: ecranFinance, guides: ecranGuides,
  };
  /* Anciennes adresses (v2) → leur seul endroit en v3. */
  var ALIAS = { aujourdhui: "", gestion: "equipe", monchateau: "dossiers" };
  var ONGLETS = [
    { id: "", nom: "Accueil", icone: "maison", rubriques: ["", "personne"] },
    { id: "planning", nom: "Planning", icone: "agenda", rubriques: ["planning"] },
    { id: "dossiers", nom: "Dossiers", icone: "dossier", rubriques: ["dossiers", "commun", "acces", "restreindre", "journal"] },
    { id: "equipe", nom: "Équipe", icone: "personnes", rubriques: ["equipe", "personnes", "licences-reel", "organisation", "absences", "arrivee", "depart", "roles", "boites", "securite", "historique", "motdepasse"] },
    { id: "plus", nom: "Plus", icone: "points", rubriques: ["plus", "reglages", "verifier", "installer", "finance", "licences", "simulateur", "factures", "paiement"] },
  ];
  function ongletDe(ecran, chemin) {
    if (ecran === "guides") return chemin[1] === "finance" ? "plus" : "equipe";
    for (var i = 0; i < ONGLETS.length; i++) if (ONGLETS[i].rubriques.indexOf(ecran) > -1) return ONGLETS[i].id;
    return "";
  }
  /** Profondeur d'un écran : 0 = écran d'onglet ; sert au sens du glissement. */
  function niveauDe(chemin) {
    var e = chemin[0] || "";
    if (ONGLETS.some(function (o) { return o.id === e; }) && chemin.length < 2) return 0;
    if (e === "finance" || e === "reglages" || e === "verifier" || e === "installer" || e === "personne") return 1;
    return Math.max(1, chemin.filter(Boolean).length);
  }
  var liensOnglets = null;
  /** La barre est construite une seule fois ; ensuite on ne change que l'onglet actif. */
  function rendreOnglets(onglet, masquer) {
    var nav = document.getElementById("onglets");
    nav.hidden = !!masquer;
    document.body.classList.toggle("avec-onglets", !masquer);
    if (masquer) return;
    if (!liensOnglets) {
      liensOnglets = {};
      ONGLETS.forEach(function (o) {
        liensOnglets[o.id] = h("a", { href: "#/" + o.id }, icone(o.icone), h("span", null, o.nom));
        nav.appendChild(liensOnglets[o.id]);
      });
    }
    ONGLETS.forEach(function (o) {
      var a = liensOnglets[o.id], actif = o.id === onglet;
      a.classList.toggle("actif", actif);
      if (actif) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
  }

  var dernierEcran = null, dernierOnglet = null, dernierNiveau = 0;
  function rendre() {
    var app = document.getElementById("app");
    var chemin = (location.hash || "#/").replace(/^#\/?/, "").split("/").map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } });
    if (ALIAS.hasOwnProperty(chemin[0])) {
      chemin = [ALIAS[chemin[0]]].concat(chemin.slice(1));
      history.replaceState(null, "", "#/" + chemin.map(encodeURIComponent).join("/"));
    }
    var ecran = chemin[0] || "";
    var cleEcran = chemin.join("/");
    var memeEcran = cleEcran === dernierEcran, y = window.scrollY;
    var onglet = ongletDe(ecran, chemin), niveau = niveauDe(chemin);
    // Transition : glissement si on descend ou remonte dans un onglet, fondu si on change d'onglet,
    // rien quand c'est le même écran (mise à jour) ou au premier affichage.
    var anim = memeEcran || dernierEcran === null ? "sans-anim"
      : onglet !== dernierOnglet ? "" : niveau > dernierNiveau ? "avant" : niveau < dernierNiveau ? "arriere" : "";
    var vue = h("div", { class: "ecran " + anim });
    if (reglages.calendrierSeul) {
      rendreOnglets("", true);
      app.classList.add("plein-ecran");
      ecranCalendrierSeul(vue);
    } else {
      app.classList.remove("plein-ecran");
      rendreOnglets(onglet, false);
      (ecrans[ecran] || ecranAccueil)(vue, chemin);
    }
    app.textContent = "";
    app.appendChild(vue);
    var t = vue.querySelector("h1");
    document.title = ecran && t ? t.firstChild.textContent + " — Espace Breteuil" : "Espace Breteuil";
    if (memeEcran) window.scrollTo(0, y);
    else {
      window.scrollTo(0, 0);
      // Lecteurs d'écran : annoncer le nouvel écran (titre) sans faire défiler.
      if (t && dernierEcran !== null) { t.setAttribute("tabindex", "-1"); t.focus({ preventScroll: true }); }
    }
    dernierEcran = cleEcran; dernierOnglet = onglet; dernierNiveau = niveau;
  }
  window.addEventListener("hashchange", rendre);

  /* ------------------------------------------------------------------ */
  /* Outils exposés aux autres écrans (connecte.js, demos/…)             */
  /* ------------------------------------------------------------------ */
  window.EB = {
    h: h, icone: icone, emoji: emoji, avatar: avatar, initiales: initiales, barre: barre, pied: pied, action: action,
    tuile: tuile, tuiles: tuiles, squelette: squelette,
    bandeauDemo: bandeauDemo, bandeauSimulation: bandeauSimulation, blocMicrosoft: blocMicrosoft,
    confirmer: confirmer, choisir: choisir, toast: toast, dialogue: dialogue, ouvrirDialogue: ouvrirDialogue, fermerDialogue: fermerDialogue,
    exiger: exiger, estOuvert: estOuvert, rendre: rendre, lire: lire, ecrire: ecrire,
    demo: function () { return demo; }, sauverDemo: sauverDemo, journal: journal, reel: function () { return reel; },
    collaborateurs: collaborateurs, collaborateurParId: collaborateurParId, personnes: function () { return donnees.personnes; },
    jourCourt: jourCourt, versIso: versIso, depuisIso: depuisIso, aujourdhui: aujourdhui, plusJours: plusJours, lundiDe: lundiDe, fmt: fmt, midi: midi, maj: maj,
    ecran: function (nom, fn) { ecrans[nom] = fn; },
    definirReel: function (r) { reel = r; },
    onglet: function (id, nom, ic, rubriques) { ONGLETS.forEach(function (o) { if (o.id === id) { o.rubriques = o.rubriques.concat(rubriques || []); } }); },
    jourLong: jourLong, heure: heure,
  };

  /* ------------------------------------------------------------------ */
  /* Démarrage                                                           */
  /* ------------------------------------------------------------------ */
  function demarrer() {
    appliquerAffichage();
    if ((!location.hash || location.hash === "#/" || location.hash === "#") && reglages.moi && reglages.ouvrirMonEspace && !reglages.calendrierSeul) {
      history.replaceState(null, "", "#/personne/" + encodeURIComponent(reglages.moi));
    }
    var graph = window.EBGraph ? window.EBGraph.init() : Promise.resolve(false);
    Promise.all([
      chargerJson("personnes.json").then(function (j) { donnees.personnes = j.personnes || []; donnees.liens = j.liens || {}; donnees.boites = j.boitesPartagees || {}; }),
      chargerJson("fiches.json").then(function (j) { donnees.fiches = j; }),
    ]).catch(function (e) { console.error("Espace Breteuil :", e); }).then(function () {
      rendre();
      graph.then(function (connecte) { if (connecte) chargerReel(); });
      return chargerPlanning();
    }).then(planningPret); // seules les parties qui affichent le planning sont redessinées
    window.addEventListener("load", demarrerMisesAJour);
  }
  document.addEventListener("DOMContentLoaded", demarrer);
})();
