/*
 * Espace Breteuil — cœur de l'application (sans dépendance, sans compte).
 *
 * Ce fichier : outils communs (window.EB), planning (plusieurs calendriers),
 * « Aujourd'hui au Château », premier écran, Moi, Gérer, réglages, mode « calendrier seul »,
 * mises à jour, barre d'onglets.
 *
 * v4 :
 *   - pas connecté : premier écran à 2 boutons (« Voir le calendrier », « Se connecter »),
 *     ou le calendrier seul si ce mode a été choisi sur l'appareil ;
 *   - connecté : onglets selon les DROITS RÉELS (profil.js, acces.js) — 4 au plus :
 *     Planning, Dossiers, [Équipe | Finance | Gérer], Moi ;
 *   - écrans de démo cachés derrière Réglages → « Afficher les démos ».
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

  var REGLAGES_DEFAUT = { vue: "semaine", texte: "normal", theme: "auto", passes: "afficher", mode: "", demos: false };
  var reglages = Object.assign({}, REGLAGES_DEFAUT, lire("eb:reglages", {}));
  if (reglages.calendrierSeul) reglages.mode = "calendrier"; // reprise v3
  ["calendrierSeul", "monEspace", "moi", "ouvrirMonEspace"].forEach(function (k) { delete reglages[k]; });
  function sauverReglages() { ecrire("eb:reglages", reglages); appliquerAffichage(); }
  function appliquerAffichage() {
    var r = document.documentElement;
    if (reglages.theme === "clair" || reglages.theme === "sombre") r.setAttribute("data-theme", reglages.theme); else r.removeAttribute("data-theme");
    if (reglages.texte === "petit" || reglages.texte === "grand" || reglages.texte === "tres-grand") r.setAttribute("data-texte", reglages.texte); else r.removeAttribute("data-texte");
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
    var c = window.EBGraph && window.EBGraph.compte();
    return c && c.name ? String(c.name).split(" ")[0] : "Démo";
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
      : [{ n: 1, nom: "Calendrier du Château", couleur: "#8A4C45", exemple: "exemple.ics" }];
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
      droite || null,
      window.EBAcces ? window.EBAcces.pastille() : null); // état de la connexion, en direct
  }

  /**
   * Tuile compacte (4 par ligne sur téléphone) : icône + libellé court.
   * t : { href | onclick, icone, libelle, aide (phrase lue par les lecteurs d'écran), demo, bientot, couleur, avatar }.
   */
  /* Une couleur douce par service (thème crème, praline et doré). */
  var TEINTES = {
    agenda: "praline", mail: "ciel", boite: "ciel", dossier: "dore", nuage: "ciel", bulles: "lavande", grille: "sauge",
    personnes: "sauge", personne: "sauge", reseau: "lavande", badge: "dore", euro: "dore", facture: "dore", carte: "dore", calcul: "dore",
    etoile: "praline", cle: "praline", livre: "lavande", ouvrir: "praline", cadenas: "corail", horloge: "lavande", bouclier: "corail",
    arrivee: "sauge", depart: "corail", palmier: "sauge", telephone: "sauge", reglages: "lavande", installer: "ciel",
  };
  function tuile(t) {
    var teinte = TEINTES[t.icone] || "praline";
    var ico = t.avatar ? t.avatar : h("span", { class: "ico" + (t.couleur ? " ronde" : " c-" + teinte), style: t.couleur ? { background: t.couleur } : null }, icone(t.icone));
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
    var el = h("span", { class: "avatar" + (taille ? " " + taille : ""), style: { background: (c && c.couleur) || "#8A4C45" }, "aria-hidden": "true" });
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

  /* v4 : l'ancien code d'écran (fiches.json → codeEmpreinte) n'est plus utilisé. Ce que l'on voit
   * dépend des droits réels Microsoft ; les démos dépendent du réglage « Afficher les démos ». */
  function exiger() { return true; }
  function estOuvert() { return true; }

  var invitationInstallation = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); invitationInstallation = e; });
  function estInstallee() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
  }
  function G() { return window.EBGraph; }
  function connecte() { return !!(G() && G().estConnecte()); }
  function resultat() { return window.EBAcces ? window.EBAcces.resultat() : null; }

  /* ------------------------------------------------------------------ */
  /* Premier écran (pas connecté) : 2 gros boutons, rien d'autre         */
  /* ------------------------------------------------------------------ */
  function ecranPremier(app) {
    var g = G(), configure = g && g.estConfigure();
    app.appendChild(h("div", { class: "premier" },
      h("div", { class: "premier-tete" },
        h("img", { class: "premier-logo", src: "icones/icon.svg", alt: "", width: "64", height: "64" }),
        h("h1", null, "Espace Breteuil"),
        h("p", null, "Château de Breteuil")),
      h("div", { class: "premier-boutons" },
        h("button", { class: "gros-bouton", type: "button", "data-action": "calendrier", onclick: function () {
          reglages.mode = "calendrier"; sauverReglages(); rendre();
        } }, icone("agenda"), h("span", null, h("b", null, "Voir le calendrier"), h("small", null, "Sans compte, sur cet appareil"))),
        h("button", { class: "gros-bouton principal", type: "button", "data-action": "connexion", disabled: !configure, onclick: function () {
          this.disabled = true; this.classList.add("en-cours");
          var b = this;
          Promise.resolve(g.connecter()).catch(function () {}).then(function () { b.disabled = false; b.classList.remove("en-cours"); });
        } }, icone("cle"), h("span", null, h("b", null, "Se connecter"), h("small", null, configure ? "Avec votre compte Microsoft du Château" : "Connexion pas encore activée")))),
      g && g.erreur() ? h("p", { class: "erreur premier-erreur", role: "alert" }, g.erreur()) : null));
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

  /** Onglet Planning : épingles (connecté), puis le planning, en lecture seule. */
  function ecranPlanning(app) {
    var actualiser = h("button", { class: "btn-rond", type: "button", "aria-label": "Actualiser le planning", title: "Actualiser", onclick: actualiserPlanning }, icone("actualiser"));
    app.appendChild(barre("Planning", null, actualiser, maj(jourLong(aujourdhui()))));
    blocPlanning(app, null); // v4 : plus de bandeau d'absences ni de pointage (planning en lecture seule)
  }

  /* Mode « calendrier seul » (choisi sur le premier écran, mémorisé sur l'appareil). */
  function ecranCalendrierSeul(app) {
    app.appendChild(barre("Planning du Château", null, h("button", { class: "btn-rond", type: "button", "aria-label": "Actualiser le planning", onclick: actualiserPlanning }, icone("actualiser"))));
    blocPlanning(app, null);
    app.appendChild(h("p", { class: "lien-discret" }, h("button", { type: "button", "data-action": "accueil", onclick: function () {
      reglages.mode = ""; sauverReglages(); rendre();
    } }, "Revenir à l'accueil")));
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
  /* Onglet Moi : qui je suis, mes droits, ce que je peux utiliser       */
  /* ------------------------------------------------------------------ */
  var DROITS_TEXTE = {
    proprietaire: ["🏰", "Propriétaire du site", "Décide qui a accès au dossier commun et à chaque dossier."],
    collaborateur: ["👤", "Collaborateur", "Planning, dossier commun (selon vos accès) et vos outils Microsoft."],
  };
  function puceDroit(emo, titre, phrase) {
    return h("li", { class: "droit" }, emoji(emo), h("span", null, h("b", null, titre), h("small", null, phrase)));
  }
  function ecranMoi(app) {
    var g = G(), c = (g && g.compte()) || {}, A = window.EBAcces, r = resultat();
    var me = A && A.me();
    app.appendChild(barre("Moi", null));
    var nom = (me && me.displayName) || c.name || "";
    app.appendChild(h("div", { class: "bonjour" }, avatar({ prenom: nom || "?", couleur: "#8A4C45" }, "grand"),
      h("div", null, h("h2", null, nom || "Mon compte"), h("p", null, (me && (me.mail || me.userPrincipalName)) || c.username || ""))));

    var P = window.EBProfil, D = window.EBDroits;
    var zone = h("section", { class: "section", "aria-busy": r ? "false" : "true" }, h("h2", null, "Mes droits"));
    app.appendChild(zone);
    if (!r) zone.appendChild(squelette(2));
    else {
      var l = h("ul", { class: "droits" });
      r.roles.forEach(function (k) { var x = P.ROLES[k]; l.appendChild(puceDroit(k === "facturation" ? "💶" : "🔑", x.nom, x.phrase)); });
      if (r.droits.proprietaire) l.appendChild(puceDroit.apply(null, DROITS_TEXTE.proprietaire));
      if (!r.roles.length && !r.droits.proprietaire) l.appendChild(puceDroit.apply(null, DROITS_TEXTE.collaborateur));
      zone.appendChild(l);
      // Ce que je peux utiliser (licence)
      var profils = r.droits.licences.map(function (sku) { return D.SKUS[sku]; }).filter(Boolean);
      var ordre = ["standard", "basic", "exchange"], pr = ordre.filter(function (x) { return profils.indexOf(x) > -1; })[0];
      var PR = D.PROFILS[pr || "aucune"];
      if (PR) app.appendChild(h("section", { class: "section" }, h("h2", null, "Ce que je peux utiliser"),
        h("div", { class: "carte-profil " + (pr || "aucune") },
          h("div", { class: "tete" }, emoji(PR.emoji, "grand"), h("div", null, h("b", null, PR.nom), h("span", null, PR.phrase))),
          h("ul", { class: "outils" }, (PR.outils || []).map(function (o) { return h("li", null, emoji(o[0]), h("span", null, o[1])); })))));
    }
    var liens = ["mail", "agenda", "onedrive", "teams"].map(function (k) { return donnees.liens[k]; }).filter(Boolean);
    if (liens.length) app.appendChild(h("section", { class: "section" }, h("h2", null, "Mes outils Microsoft"),
      tuiles(liens.map(function (l) { return { href: l.url, externe: true, icone: l.icone, libelle: l.titre, aide: l.texte }; }))));
    app.appendChild(h("div", { class: "actions-liste" },
      action("#/reglages", "⚙️", "Réglages", "Texte, couleurs, planning, démos, détails techniques"),
      reglages.demos ? action("#/demos", "🧪", "Démos", "Écrans d'essai, données fictives") : null,
      estInstallee() ? null : action("#/installer", "📲", "Installer l'appli", "Une icône sur l'écran d'accueil"),
      h("a", { class: "action", href: "tel:+33609897443" }, emoji("📞"), h("span", null, h("b", null, "Appeler Damien"), h("small", null, "Belfort Systems · 06 09 89 74 43")), h("span", { class: "fleche", "aria-hidden": "true" }, "›")),
      h("button", { class: "action", type: "button", "data-action": "deconnexion", onclick: deconnecter }, emoji("🚪"), h("span", null, h("b", null, "Se déconnecter"), h("small", null, "Efface la session de cet appareil")), h("span", { class: "fleche", "aria-hidden": "true" }, "›"))));
    app.appendChild(h("p", { class: "pied" }, "Espace Breteuil · version " + VERSION + " · Belfort Systems"));
  }
  function deconnecter() {
    if (window.EBAcces) window.EBAcces.oublier();
    if (G()) G().oublier();
    if (window.EBConnecte && window.EBConnecte.oublier) window.EBConnecte.oublier();
    reglages.mode = ""; sauverReglages();
    liensOnglets = null; signatureOnglets = "";
    history.replaceState(null, "", "#/");
    rendre();
  }

  /* ------------------------------------------------------------------ */
  /* Onglet Équipe / Finance / Gérer : uniquement les sections permises  */
  /* ------------------------------------------------------------------ */
  function ongletGestion() {
    var r = resultat(), o = r ? r.onglets : [];
    return o.length === 4 ? o[2] : null;
  }
  /** Retour vers l'onglet de gestion (Équipe, Finance ou Gérer selon le profil). */
  function hub() { var o = ongletGestion(); return o ? { href: "#/" + o.id, texte: o.nom } : { href: "#/moi", texte: "Moi" }; }
  function ecranGerer(app) {
    var r = resultat(), o = ongletGestion();
    app.appendChild(barre(o ? o.nom : "Gérer", null));
    if (!r) { app.appendChild(squelette(4, "tuiles")); return; }
    var sec = r.sections, fiches = donnees.fiches || {};
    var lienFin = function (titre) { var t = ((fiches.finance || {}).tuiles || []).filter(function (x) { return x.titre === titre; })[0]; return t && t.url; };
    if (sec.indexOf("deleguer") > -1) app.appendChild(h("section", { class: "section" }, h("h2", null, "Administration"),
      tuiles([
        { href: "#/deleguer", icone: "etoile", libelle: "Déléguer", aide: "Donner ou retirer un rôle : propriétaire du site, facturation, utilisateurs, Exchange" },
        { href: "#/guides/admin", icone: "livre", libelle: "Guides", aide: "Les gestes d'administration, pas à pas, sur le site de Microsoft" },
        { href: "https://admin.microsoft.com/", externe: true, icone: "ouvrir", libelle: "Centre d'admin", aide: "Ouvrir le centre d'administration Microsoft 365" },
      ])));
    if (sec.indexOf("equipe") > -1) app.appendChild(h("section", { class: "section" }, h("h2", null, "Équipe"),
      tuiles([
        { href: "#/personnes", icone: "personnes", libelle: "Personnes", aide: "L'équipe, les boîtes partagées et les externes (étiquette EXTERNE)" },
        { href: "#/organisation", icone: "reseau", libelle: "Qui a quoi", aide: "Organisation : qui a quoi, en un schéma à toucher" },
        sec.indexOf("finance") < 0 ? { href: "#/licences-reel", icone: "badge", libelle: "Licences", aide: "Qui a quelle licence Microsoft, combien il en reste" } : null,
      ])));
    if (sec.indexOf("finance") > -1) app.appendChild(h("section", { class: "section" }, h("h2", null, "Finance"),
      tuiles([
        { href: "#/licences-reel", icone: "badge", libelle: "Licences", aide: "Licences achetées, utilisées et libres (données réelles)" },
        { href: lienFin("Les factures") || "https://admin.microsoft.com/Adminportal/Home#/billoverview", externe: true, icone: "facture", libelle: "Factures", aide: "Les factures Microsoft, dans le centre d'administration" },
        { href: lienFin("Abonnements") || "https://admin.microsoft.com/Adminportal/Home#/subscriptions", externe: true, icone: "carte", libelle: "Abonnements", aide: "Abonnements et moyen de paiement, dans le centre d'administration" },
        { href: "#/guides/finance", icone: "livre", libelle: "Guides", aide: "Les gestes de facturation, pas à pas" },
      ])));
  }

  /* ------------------------------------------------------------------ */
  /* Démos (Réglages → « Afficher les démos ») : données fictives        */
  /* ------------------------------------------------------------------ */
  var ABSENCES_RETIREES = ["absences"]; // v4 : aucune fonction d'absence ni de pointage visible
  var ECRANS_DEMO = ["demos", "arrivee", "depart", "roles", "boites", "securite", "historique", "licences", "simulateur", "factures", "paiement"];
  function ecranDemos(app) {
    app.appendChild(barre("Démos", { href: "#/moi", texte: "Moi" }));
    app.appendChild(bandeauDemo("Démo — données fictives, rien n'est modifié chez Microsoft"));
    app.appendChild(tuiles([
      { href: "#/arrivee/1", icone: "arrivee", libelle: "Arrivée", aide: "Quelqu'un arrive : créer son compte en 4 étapes" },
      { href: "#/depart", icone: "depart", libelle: "Départ", aide: "Quelqu'un part : bloquer son compte et transmettre son travail" },
      { href: "#/roles", icone: "etoile", libelle: "Rôles", aide: "Rôles et délégations (démo)" },
      { href: "#/boites", icone: "mail", libelle: "Boîtes mail", aide: "Boîtes partagées, photo et accès (démo)" },
      { href: "#/securite", icone: "bouclier", libelle: "Double auth.", aide: "Double authentification : activer, suivre, relancer" },
      { href: "#/historique", icone: "horloge", libelle: "Historique", aide: "Qui a fait quoi (démo)" },
      { href: "#/licences", icone: "euro", libelle: "Coût", aide: "Licences et coût par mois (démo)" },
      { href: "#/simulateur", icone: "calcul", libelle: "Simulateur", aide: "Acheter ou retirer des licences (démo)" },
      { href: "#/factures", icone: "facture", libelle: "Factures", aide: "Factures fictives et exemple PDF" },
      { href: "#/paiement", icone: "carte", libelle: "Paiement", aide: "Moyen de paiement (démo)" },
    ]));
  }
  function ecranGuides(app, chemin) {
    var k = chemin[1] === "finance" ? "finance" : "admin";
    var retourHub = hub();
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
    app.appendChild(barre("Réglages", { href: "#/moi", texte: "Moi" }, null, "Gardés sur cet appareil uniquement"));
    app.appendChild(h("h2", { class: "titre-groupe" }, "Affichage"));
    app.appendChild(h("div", { class: "grille-reglages" },
      choix("Taille de l'interface", "Texte, boutons et tuiles, ensemble.", "texte", [["petit", "Petit"], ["normal", "Normal"], ["grand", "Grand"], ["tres-grand", "Très grand"]]),
      choix("Couleurs", null, "theme", [["auto", "Auto"], ["clair", "Clair"], ["sombre", "Sombre"]])));

    app.appendChild(h("h2", { class: "titre-groupe" }, "Planning"));
    app.appendChild(h("div", { class: "grille-reglages" },
      choix("Affichage au départ", null, "vue", VUES),
      choix("Rendez-vous passés", null, "passes", [["afficher", "Afficher"], ["masquer", "Masquer"]])));

    app.appendChild(h("h2", { class: "titre-groupe" }, "Démos et version"));
    app.appendChild(h("div", { class: "grille-reglages" },
      choix("Afficher les démos", "Écrans d'essai avec des données fictives (rien n'est modifié chez Microsoft). Ils apparaissent dans Moi → Démos.",
        "demos", [[false, "Non"], [true, "Oui"]], null, { structure: true }),
      reglages.demos ? h("div", { class: "boite reglage" },
        h("p", null, "Les essais faits dans la démo restent sur cet appareil."),
        h("button", { class: "btn secondaire", type: "button", onclick: function () {
          confirmer({ emoji: "🧹", titre: "Effacer les essais de la démo ?", phrase: "La démo revient comme au premier jour. Les vrais comptes Microsoft ne sont pas concernés.", bouton: "Oui, tout remettre", deuxEtapes: false })
            .then(function (ok) { if (ok) { demo = window.EBDemo.reinitialiser(); toast("La démo est remise à zéro."); rendre(); } });
        } }, "Remettre la démo à zéro")) : null,
      h("div", { class: "boite reglage version" },
        h("h2", null, "Version " + VERSION),
        h("p", null, "L'appli se met à jour toute seule."),
        h("button", { class: "btn secondaire", type: "button", onclick: function () { verifierMiseAJour(true); } }, icone("actualiser"), "Rechercher une mise à jour"))));

    app.appendChild(h("h2", { class: "titre-groupe" }, "Pour Damien"));
    app.appendChild(h("div", { class: "actions-liste" },
      action("#/details", "🩺", "Détails techniques", "Diagnostic complet de la connexion, rapport à copier")));
    app.appendChild(h("div", { class: "actions" },
      h("button", { class: "btn secondaire", type: "button", onclick: function () {
        var mode = reglages.mode;
        reglages = Object.assign({}, REGLAGES_DEFAUT, { mode: mode }); vuePlanning.vue = reglages.vue; sauverReglages(); rendre();
      } }, "Remettre les réglages d'origine")));
  }

  /* ------------------------------------------------------------------ */
  /* Écran : installer                                                   */
  /* ------------------------------------------------------------------ */
  function ecranInstaller(app) {
    app.appendChild(barre("Installer l'appli", { href: "#/moi", texte: "Moi" }));
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
  /* Navigation par ÉCRANS séparés + onglets selon les droits réels       */
  /* ------------------------------------------------------------------ */
  function ecranDetails(app) {
    if (window.EBDiagnostic) window.EBDiagnostic.ecran(app);
    else app.appendChild(barre("Détails techniques", { href: "#/reglages", texte: "Réglages" }));
  }
  var ecrans = {
    planning: ecranPlanning, moi: ecranMoi, equipe: ecranGerer, finance: ecranGerer, gerer: ecranGerer, demos: ecranDemos,
    reglages: ecranReglages, installer: ecranInstaller, guides: ecranGuides, details: ecranDetails,
  };
  /* Anciennes adresses (v2, v3) → leur seul endroit en v4. */
  var ALIAS = { "": "planning", accueil: "planning", aujourdhui: "planning", personne: "planning", gestion: "gerer", monchateau: "dossiers", plus: "moi", verifier: "details" };
  function ongletsActuels() { var r = resultat(); return r ? r.onglets : window.EBProfil.onglets([]); }
  function ongletDe(ecran) {
    if (ECRANS_DEMO.indexOf(ecran) > -1) return "moi";
    if (ecran === "guides") { var o = ongletGestion(); return o ? o.id : "moi"; }
    return window.EBProfil.ongletDe(ecran, resultat());
  }
  /** Profondeur d'un écran : 0 = écran d'onglet ; sert au sens du glissement. */
  function niveauDe(chemin) {
    var e = chemin[0] || "";
    if (ongletsActuels().some(function (o) { return o.id === e; }) && chemin.length < 2) return 0;
    if (e === "demos" || e === "reglages" || e === "installer" || e === "deleguer" || e === "personnes" && chemin.length < 2) return 1;
    if (e === "details") return 2;
    return Math.max(1, chemin.filter(Boolean).length);
  }
  var liensOnglets = null, signatureOnglets = "";
  /** La barre n'est reconstruite que si la LISTE des onglets change ; sinon seul l'onglet actif change. */
  function rendreOnglets(onglet, masquer) {
    var nav = document.getElementById("onglets");
    nav.hidden = !!masquer;
    document.body.classList.toggle("avec-onglets", !masquer);
    if (masquer) return;
    var liste = ongletsActuels(), sig = liste.map(function (o) { return o.id; }).join(",");
    if (!liensOnglets || sig !== signatureOnglets) {
      liensOnglets = {}; signatureOnglets = sig; nav.textContent = "";
      nav.style.setProperty("--n", String(liste.length));
      liste.forEach(function (o) {
        liensOnglets[o.id] = h("a", { href: "#/" + o.id, "data-onglet": o.id }, icone(o.icone), h("span", null, o.nom));
        nav.appendChild(liensOnglets[o.id]);
      });
    }
    liste.forEach(function (o) {
      var a = liensOnglets[o.id], actif = o.id === onglet;
      a.classList.toggle("actif", actif);
      if (actif) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
  }

  /** Écran réservé dont on ne connaît pas encore les droits : squelette, puis l'écran. */
  function ecranAttente(app) {
    app.appendChild(barre("Un instant…", null));
    app.appendChild(squelette(4, "tuiles"));
  }

  var dernierEcran = null, dernierOnglet = null, dernierNiveau = 0, enAttenteDroits = false;
  function cheminActuel() {
    return (location.hash || "#/").replace(/^#\/?/, "").split("/").map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } });
  }
  function rendre() {
    var app = document.getElementById("app");
    var chemin = cheminActuel();
    var vue, ecran, onglet = "", niveau = 0, cleEcran;
    enAttenteDroits = false;
    if (!connecte()) {
      // Pas connecté : 2 boutons, ou le calendrier seul. Rien d'autre (ni onglets, ni démo).
      cleEcran = reglages.mode === "calendrier" ? "~calendrier" : "~premier";
      vue = h("div", { class: "ecran " + (cleEcran === dernierEcran || dernierEcran === null ? "sans-anim" : "") });
      rendreOnglets("", true);
      app.classList.add("plein-ecran");
      if (reglages.mode === "calendrier") ecranCalendrierSeul(vue); else ecranPremier(vue);
      if (chemin.join("/") !== "") history.replaceState(null, "", location.pathname + location.search);
      ecran = "";
    } else {
      if (ALIAS.hasOwnProperty(chemin[0])) {
        chemin = [ALIAS[chemin[0]]].concat(chemin.slice(1));
        history.replaceState(null, "", "#/" + chemin.map(encodeURIComponent).join("/"));
      }
      ecran = chemin[0];
      var r = resultat(), P = window.EBProfil;
      var demoInterdite = (ECRANS_DEMO.indexOf(ecran) > -1 && !reglages.demos) || ABSENCES_RETIREES.indexOf(ecran) > -1;
      var reserve = !P.routePermise(ecran, null) || ecran === "guides";
      if (demoInterdite || (reserve && r && !(ecran === "guides" ? r.sections.length : P.routePermise(ecran, r)))) {
        history.replaceState(null, "", "#/planning");
        chemin = ["planning"]; ecran = "planning";
      }
      cleEcran = chemin.join("/");
      onglet = ongletDe(ecran); niveau = niveauDe(chemin);
      var memeEcran = cleEcran === dernierEcran;
      var anim = memeEcran || dernierEcran === null ? "sans-anim"
        : onglet !== dernierOnglet ? "" : niveau > dernierNiveau ? "avant" : niveau < dernierNiveau ? "arriere" : "";
      vue = h("div", { class: "ecran " + anim });
      app.classList.remove("plein-ecran");
      rendreOnglets(onglet, false);
      if (reserve && !r) { enAttenteDroits = true; ecranAttente(vue); }
      else (ecrans[ecran] || ecranPlanning)(vue, chemin);
    }
    var y = window.scrollY, memeE = cleEcran === dernierEcran;
    app.textContent = "";
    app.appendChild(vue);
    var t = vue.querySelector("h1");
    document.title = ecran && t ? t.firstChild.textContent + " — Espace Breteuil" : "Espace Breteuil";
    if (memeE) window.scrollTo(0, y);
    else {
      window.scrollTo(0, 0);
      if (t && dernierEcran !== null) { t.setAttribute("tabindex", "-1"); t.focus({ preventScroll: true }); }
    }
    dernierEcran = cleEcran; dernierOnglet = onglet; dernierNiveau = niveau;
  }
  window.addEventListener("hashchange", rendre);

  /** Les droits réels viennent d'arriver (ou ont changé) : onglets mis à jour, et l'écran
   * courant redessiné SEULEMENT s'il en dépend. */
  function droitsChanges() {
    if (!connecte()) return;
    var e = cheminActuel()[0] || "";
    var dependants = ["moi", "gerer", "equipe", "finance", "dossiers", "commun", "deleguer", "guides", "personnes", "organisation", "licences-reel", "acces", "restreindre"];
    if (enAttenteDroits || dependants.indexOf(e) > -1) rendre();
    else rendreOnglets(ongletDe(e), false);
  }

  /* ------------------------------------------------------------------ */
  /* Outils exposés aux autres écrans (connecte.js, demos/…)             */
  /* ------------------------------------------------------------------ */
  window.EB = {
    h: h, icone: icone, emoji: emoji, avatar: avatar, initiales: initiales, barre: barre, pied: pied, action: action,
    tuile: tuile, tuiles: tuiles, squelette: squelette,
    bandeauDemo: bandeauDemo, bandeauSimulation: bandeauSimulation,
    confirmer: confirmer, choisir: choisir, toast: toast, dialogue: dialogue, ouvrirDialogue: ouvrirDialogue, fermerDialogue: fermerDialogue,
    exiger: exiger, estOuvert: estOuvert, rendre: rendre, lire: lire, ecrire: ecrire,
    demo: function () { return demo; }, sauverDemo: sauverDemo, journal: journal, reel: function () { return reel; },
    collaborateurs: collaborateurs, collaborateurParId: collaborateurParId, personnes: function () { return donnees.personnes; },
    jourCourt: jourCourt, versIso: versIso, depuisIso: depuisIso, aujourdhui: aujourdhui, plusJours: plusJours, lundiDe: lundiDe, fmt: fmt, midi: midi, maj: maj,
    ecran: function (nom, fn) { ecrans[nom] = fn; },
    definirReel: function (r) { reel = r; },
    onglet: function () {},
    jourLong: jourLong, heure: heure, hub: hub, reglages: function () { return reglages; },
  };

  /* ------------------------------------------------------------------ */
  /* Démarrage                                                           */
  /* ------------------------------------------------------------------ */
  function demarrer() {
    appliquerAffichage();
    var graph = window.EBGraph ? window.EBGraph.init() : Promise.resolve(false);
    if (window.EBAcces) window.EBAcces.surChangement(droitsChanges);
    var json = Promise.all([
      chargerJson("personnes.json").then(function (j) { donnees.personnes = j.personnes || []; donnees.liens = j.liens || {}; donnees.boites = j.boitesPartagees || {}; }),
      chargerJson("fiches.json").then(function (j) { donnees.fiches = j; }),
    ]).catch(function (e) { console.error("Espace Breteuil :", e); });
    var planningPromis = chargerPlanning(); // en parallèle de la connexion
    // Calendrier seul : pas besoin d'attendre Microsoft.
    if (reglages.mode === "calendrier") json.then(function () { if (dernierEcran === null) rendre(); });
    Promise.all([json, graph.catch(function () { return false; })]).then(function (r) {
      var estCo = r[1];
      if (estCo && window.EBAcces) window.EBAcces.charger(); // droits réels, en arrière-plan
      if (estCo && (!location.hash || location.hash === "#/" || location.hash === "#")) history.replaceState(null, "", "#/planning");
      if (estCo || dernierEcran === null) rendre(); // calendrier seul déjà affiché : rien à refaire
      return planningPromis;
    }).then(planningPret); // seules les parties qui affichent le planning sont redessinées
    window.addEventListener("load", demarrerMisesAJour);
  }
  document.addEventListener("DOMContentLoaded", demarrer);
})();
