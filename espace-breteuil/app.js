/*
 * Espace Breteuil — application (sans dépendance, sans compte).
 *
 * Écrans (navigation par l'adresse, bouton Retour du téléphone compris) :
 *   #/                      accueil : planning + une tuile par personne
 *   #/planning[/<id>]       planning (Jour / Semaine / Mois / Liste), filtré pour une personne si <id>
 *   #/personne/<id>         « Mon espace » : raccourcis, boîtes partagées, planning de la personne
 *   #/admin, #/finance      panneaux à liens profonds (code d'écran, voir fiches.json)
 *   #/admin/fiche/<id>      fiche « comment faire » (idem pour finance)
 *   #/reglages, #/installer
 *
 * Données : personnes.json, fiches.json (dans ce dossier) ; planning ICS servi par le
 * Worker belfort-api (GET /breteuil/planning.ics), ou exemple.ics s'il n'est pas branché.
 * Tout ce qui vient du calendrier est inséré comme TEXTE (jamais en HTML).
 */
(function () {
  "use strict";

  var ICS = window.BreteuilICS;
  var TZ = "Europe/Paris";
  var JOUR_MS = 86400000;
  var CLE_REGLAGES = "eb:reglages";
  var CACHE_PLANNING = "eb-planning";

  /* ------------------------------------------------------------------ */
  /* Stockage local (toujours protégé : navigation privée, blocages…)    */
  /* ------------------------------------------------------------------ */
  function lire(cle, defaut) {
    try { var v = localStorage.getItem(cle); return v == null ? defaut : JSON.parse(v); } catch (e) { return defaut; }
  }
  function ecrire(cle, valeur) {
    try { if (valeur == null) localStorage.removeItem(cle); else localStorage.setItem(cle, JSON.stringify(valeur)); } catch (e) {}
  }

  var REGLAGES_DEFAUT = { vue: "semaine", texte: "normal", theme: "auto", passes: "afficher", monEspace: "" };
  var reglages = Object.assign({}, REGLAGES_DEFAUT, lire(CLE_REGLAGES, {}));
  function sauverReglages() { ecrire(CLE_REGLAGES, reglages); appliquerAffichage(); }
  function appliquerAffichage() {
    var r = document.documentElement;
    if (reglages.theme === "clair" || reglages.theme === "sombre") r.setAttribute("data-theme", reglages.theme); else r.removeAttribute("data-theme");
    if (reglages.texte === "grand" || reglages.texte === "tres-grand") r.setAttribute("data-texte", reglages.texte); else r.removeAttribute("data-texte");
  }

  /* ------------------------------------------------------------------ */
  /* Icônes (dessins fixes, aucune donnée externe)                       */
  /* ------------------------------------------------------------------ */
  var ICONES = {
    agenda: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
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
    badge: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="2"/><path d="M14 10h4M14 14h4"/>',
    boite: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    facture: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    carte: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
    panier: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
    horloge: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    moins: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>',
    arrivee: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5M15 12H3"/>',
    depart: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    reglages: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    retour: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    gauche: '<path d="m15 18-6-6 6-6"/>',
    droite: '<path d="m9 18 6-6-6-6"/>',
    lieu: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    cadenas: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    installer: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    telephone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    horsligne: '<path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M2 8.82a15 15 0 0 1 4.17-2.65M10.66 5c4.01-.36 8.14.9 11.34 3.76M16.85 11.25a10 10 0 0 1 2.22 1.68M5 13a10 10 0 0 1 5.24-2.76M12 20h.01"/>',
    ouvrir: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    actualiser: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    exemple: '<path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>',
    texte: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
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
  /* Petite fabrique d'éléments : le texte est toujours inséré en texte  */
  /* ------------------------------------------------------------------ */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") el.className = v;
      else if (k.indexOf("on") === 0 && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
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
  function lienExterne(url, attrs) {
    return Object.assign({ href: url, target: "_blank", rel: "noopener noreferrer" }, attrs || {});
  }

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
  var formats = {};
  function fmt(ms, opts) {
    var k = JSON.stringify(opts);
    if (!formats[k]) formats[k] = new Intl.DateTimeFormat("fr-FR", Object.assign({ timeZone: TZ }, opts));
    return formats[k].format(ms);
  }
  function heure(ms) {
    var p = ICS.partiesDans(ms, TZ);
    return p.h + " h" + (p.mi ? " " + String(p.mi).padStart(2, "0") : "");
  }
  function maj(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }
  function jourLong(j) { return fmt(midi(j), { weekday: "long", day: "numeric", month: "long" }); }
  function jourAvecAnnee(j) { return fmt(midi(j), { weekday: "long", day: "numeric", month: "long", year: "numeric" }); }

  /* ------------------------------------------------------------------ */
  /* Données                                                             */
  /* ------------------------------------------------------------------ */
  var donnees = { personnes: [], liens: {}, boites: {}, fiches: null };
  var planning = null; // { analyse, source, quand }
  var vuePlanning = { vue: reglages.vue, jour: aujourdhui() };

  function chargerJson(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(url + " : " + r.status);
      return r.json();
    });
  }

  function personneParId(id) {
    for (var i = 0; i < donnees.personnes.length; i++) if (donnees.personnes[i].id === id) return donnees.personnes[i];
    return null;
  }

  /* Cache du planning sur l'appareil (Cache API, sinon localStorage). */
  function sauverPlanningLocal(texte, quand) {
    var fait = false;
    try {
      if (window.caches) {
        fait = true;
        caches.open(CACHE_PLANNING).then(function (c) {
          return c.put("planning.ics", new Response(texte, { headers: { "Content-Type": "text/calendar", "X-Quand": String(quand) } }));
        }).catch(function () {});
      }
    } catch (e) { fait = false; }
    if (!fait && texte.length < 1500000) ecrire("eb:planning", { texte: texte, quand: quand });
  }
  function lirePlanningLocal() {
    var secours = lire("eb:planning", null);
    try {
      if (!window.caches) return Promise.resolve(secours);
      return caches.open(CACHE_PLANNING).then(function (c) { return c.match("planning.ics"); }).then(function (r) {
        if (!r) return secours;
        return r.text().then(function (t) { return { texte: t, quand: +(r.headers.get("X-Quand") || 0) }; });
      }).catch(function () { return secours; });
    } catch (e) { return Promise.resolve(secours); }
  }

  function chargerPlanning() {
    var api = String(window.BS_API || "").replace(/\/+$/, "");
    var etat = { texte: null, source: null, quand: null };

    function depuisReseau() {
      if (!api) return Promise.resolve();
      var ctrl = window.AbortController ? new AbortController() : null;
      var minuteur = ctrl && setTimeout(function () { ctrl.abort(); }, 12000);
      return fetch(api + "/breteuil/planning.ics", { cache: "no-store", mode: "cors", signal: ctrl && ctrl.signal })
        .then(function (r) {
          if (r.ok) return r.text().then(function (t) {
            if (!/BEGIN:VCALENDAR/i.test(t)) return;
            etat.texte = t;
            etat.quand = Date.parse(r.headers.get("X-Planning-Date") || "") || Date.now();
            etat.source = r.headers.get("X-Planning-Etat") === "ancien" ? "ancien" : "direct";
            sauverPlanningLocal(t, etat.quand);
          });
          if (r.status === 503) return r.json().then(function (j) { if (j && j.code === "non_configure") etat.source = "non-configure"; }, function () {});
        })
        .catch(function () {})
        .then(function () { if (minuteur) clearTimeout(minuteur); });
    }

    return depuisReseau().then(function () {
      if (etat.texte || etat.source === "non-configure") return;
      return lirePlanningLocal().then(function (c) {
        if (c && c.texte) { etat.texte = c.texte; etat.quand = c.quand; etat.source = "hors-ligne"; }
      });
    }).then(function () {
      if (etat.texte) return;
      return fetch("exemple.ics").then(function (r) { return r.text(); }).then(function (t) {
        etat.texte = t;
        etat.source = etat.source === "non-configure" ? "exemple" : "exemple-panne";
      });
    }).then(function () {
      planning = { analyse: ICS.analyser(etat.texte || ""), source: etat.source, quand: etat.quand };
    }).catch(function () {
      planning = { analyse: { evenements: [] }, source: "exemple-panne", quand: null };
    });
  }

  /* Recherche sans accents ni majuscules. */
  function simplifier(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function concerne(o, personne) {
    if (!personne || !personne.motsCles || !personne.motsCles.length) return true;
    var texte = simplifier([o.titre, o.lieu, o.description, o.categories].join(" "));
    return personne.motsCles.some(function (m) { return m && texte.indexOf(simplifier(m)) > -1; });
  }

  /** Occurrences entre deux instants, filtrées (personne, événements passés). */
  function occurrences(deMs, aMs, personne, ignorerPasses) {
    if (!planning) return [];
    var maintenant = Date.now();
    return ICS.developper(planning.analyse, deMs, aMs).filter(function (o) {
      if (!concerne(o, personne)) return false;
      if (!ignorerPasses && reglages.passes === "masquer" && o.fin <= maintenant) return false;
      return true;
    });
  }
  function duJour(liste, j) {
    var a = debutJour(j), b = debutJour(plusJours(j, 1));
    return liste.filter(function (o) { return o.debut < b && (o.fin > a || (o.fin === o.debut && o.debut >= a)); });
  }

  /* ------------------------------------------------------------------ */
  /* Éléments communs                                                    */
  /* ------------------------------------------------------------------ */
  function barre(titre, retour, droite) {
    return h("header", { class: "barre" },
      retour ? h("a", { class: "btn-retour", href: retour.href }, icone("retour"), retour.texte || "Retour") : null,
      h("h1", null, titre),
      droite || null);
  }

  function bandeauPlanning() {
    if (!planning) return null;
    var s = planning.source;
    var date = planning.quand ? jourLong(jourDe(planning.quand)) + " à " + heure(planning.quand) : "";
    if (s === "exemple") return h("div", { class: "bandeau exemple", role: "note" }, icone("exemple"),
      h("div", null, h("strong", null, "EXEMPLE — données fictives"), "Le vrai planning du Château n'est pas encore branché."));
    if (s === "exemple-panne") return h("div", { class: "bandeau exemple", role: "note" }, icone("exemple"),
      h("div", null, h("strong", null, "EXEMPLE — données fictives"), "Le planning du Château ne répond pas et rien n'est encore enregistré sur cet appareil."));
    if (s === "hors-ligne") return h("div", { class: "bandeau info", role: "note" }, icone("horsligne"),
      h("div", null, h("strong", null, "Pas de connexion"), "Voici la dernière version enregistrée" + (date ? " (" + date + ")." : ".")));
    if (s === "ancien") return h("div", { class: "bandeau info", role: "note" }, icone("info"),
      h("div", null, h("strong", null, "Le calendrier du Château ne répond pas"), "Voici la dernière version connue" + (date ? " (" + date + ")." : ".")));
    return null;
  }

  function carteEvenement(o, j) {
    var a = j ? debutJour(j) : null;
    var etiquette = o.journee ? "Journée" : (a != null && o.debut < a ? "Suite" : heure(o.debut));
    var passe = o.fin <= Date.now();
    return h("button", { class: "evt" + (o.journee ? " journee" : "") + (passe ? " passe" : ""), type: "button", onclick: function () { ouvrirDetail(o); } },
      h("span", { class: "heure" }, etiquette),
      h("span", { class: "quoi" }, o.titre),
      o.lieu ? h("span", { class: "ou" }, icone("lieu"), o.lieu) : null);
  }

  function ouvrirDetail(o) {
    var d = document.getElementById("detail");
    d.textContent = "";
    var j1 = jourDe(o.debut);
    var jFin = jourDe(o.journee ? o.fin - 1 : o.fin);
    var quand;
    if (o.journee) {
      quand = cle(j1) === cle(jFin) ? jourAvecAnnee(j1) + " — toute la journée" : "Du " + jourLong(j1) + " au " + jourAvecAnnee(jFin);
    } else if (cle(j1) === cle(jFin)) {
      quand = jourAvecAnnee(j1) + ", de " + heure(o.debut) + " à " + heure(o.fin);
    } else {
      quand = "Du " + jourLong(j1) + " à " + heure(o.debut) + " au " + jourLong(jFin) + " à " + heure(o.fin);
    }
    var fermer = h("button", { class: "btn large", type: "button", onclick: function () { d.close(); } }, "Fermer");
    d.appendChild(h("div", { class: "contenu" },
      h("h2", { id: "detail-titre" }, o.titre),
      h("div", { class: "ligne" }, icone("horloge"), h("span", { style: { textTransform: "none" } }, quand.charAt(0).toUpperCase() + quand.slice(1))),
      o.lieu ? h("div", { class: "ligne" }, icone("lieu"), h("span", null, o.lieu)) : null,
      o.recurrent ? h("div", { class: "ligne" }, icone("actualiser"), h("span", null, "Revient régulièrement")) : null,
      o.description ? h("div", { class: "description" }, o.description) : null,
      fermer));
    if (d.showModal) { d.showModal(); fermer.focus(); } else d.setAttribute("open", "");
  }
  document.addEventListener("click", function (e) {
    var d = document.getElementById("detail");
    if (d && e.target === d) d.close(); // clic sur le fond
  });

  function tuileLien(lien, extra) {
    var mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    var nom = lien.titre;
    return h("div", { class: "tuile" },
      h("span", { class: "pastille" }, icone(lien.icone)),
      h("a", lienExterne(lien.url, { class: "tuile-lien" }), h("b", null, nom)),
      lien.texte ? h("span", { class: "sous" }, lien.texte) : null,
      mobile && lien.appli ? h("a", { class: "tuile-appli", href: lien.appli }, icone("ouvrir"), "Dans l'appli") : null,
      extra || null);
  }

  function pied() {
    return h("footer", { class: "pied" },
      "Besoin d'aide ? Damien, Belfort Systems — ",
      h("a", { href: "tel:+33609897443" }, "06 09 89 74 43"));
  }

  /* ------------------------------------------------------------------ */
  /* Écran : accueil                                                     */
  /* ------------------------------------------------------------------ */
  var invitationInstallation = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); invitationInstallation = e; });
  function estInstallee() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
  }

  function ecranAccueil(app) {
    var auj = aujourdhui();
    var nb = occurrences(debutJour(auj), debutJour(plusJours(auj, 1)), null, true).length;
    var resume = planning ? (nb === 0 ? "Rien de prévu aujourd'hui" : nb === 1 ? "Aujourd'hui : 1 rendez-vous" : "Aujourd'hui : " + nb + " rendez-vous") : "";
    if (planning && /^exemple/.test(planning.source)) resume += " (exemple)";

    app.appendChild(h("div", { class: "entete" },
      h("img", { src: "icones/icon-192.png", alt: "", width: "64", height: "64" }),
      h("div", null, h("h1", null, "Espace Breteuil"), h("p", null, maj(jourLong(auj)))),
      h("a", { class: "btn-rond", href: "#/reglages", "aria-label": "Réglages", title: "Réglages" }, icone("reglages"))));

    app.appendChild(h("a", { class: "tuile-planning", href: "#/planning" },
      h("span", { class: "pastille" }, icone("agenda")),
      h("span", null, h("b", null, "Le planning"), h("span", null, resume)),
      h("span", { class: "fleche", "aria-hidden": "true" }, "›")));

    var tuiles = donnees.personnes.map(function (p) {
      return h("a", { class: "tuile", href: "#/personne/" + encodeURIComponent(p.id) },
        h("span", { class: "pastille ronde", style: { background: p.couleur || "#6B1524" } }, icone(p.icone)),
        h("b", null, p.prenom),
        h("span", { class: "sous" }, p.role));
    });
    tuiles.push(h("a", { class: "tuile", href: "#/planning" },
      h("span", { class: "pastille ronde", style: { background: "#5E4E52" } }, icone("personne")),
      h("b", null, "Visiteur"),
      h("span", { class: "sous" }, "Sans compte : voir le planning")));

    app.appendChild(h("section", { class: "section" },
      h("h2", null, "Qui êtes-vous ?"),
      h("p", { class: "aide" }, "Touchez votre prénom pour retrouver vos raccourcis."),
      h("div", { class: "grille quatre" }, tuiles)));

    var plus = [
      h("a", { class: "tuile discrete", href: "#/admin" }, h("span", { class: "pastille" }, icone("cle")), h("b", null, "Administration")),
      h("a", { class: "tuile discrete", href: "#/finance" }, h("span", { class: "pastille" }, icone("euro")), h("b", null, "Finance")),
      h("a", { class: "tuile discrete", href: "#/reglages" }, h("span", { class: "pastille" }, icone("reglages")), h("b", null, "Réglages")),
    ];
    if (!estInstallee()) plus.push(h("a", { class: "tuile discrete", href: "#/installer" }, h("span", { class: "pastille" }, icone("installer")), h("b", null, "Installer l'appli")));
    app.appendChild(h("section", { class: "section" }, h("h2", null, "Plus"), h("div", { class: "grille quatre plus" }, plus)));
    app.appendChild(pied());
  }

  /* ------------------------------------------------------------------ */
  /* Écran : planning                                                    */
  /* ------------------------------------------------------------------ */
  var VUES = [["jour", "Jour"], ["semaine", "Semaine"], ["mois", "Mois"], ["liste", "Liste"]];

  function ecranPlanning(app, idPersonne) {
    var personne = idPersonne ? personneParId(idPersonne) : null;
    var v = vuePlanning;
    var actualiser = h("button", { class: "btn-rond", type: "button", "aria-label": "Actualiser le planning", title: "Actualiser",
      onclick: function () { this.disabled = true; chargerPlanning().then(rendre); } }, icone("actualiser"));
    app.appendChild(barre(personne ? "Planning de " + personne.prenom : "Le planning",
      { href: personne ? "#/personne/" + encodeURIComponent(personne.id) : "#/", texte: "Retour" }, actualiser));

    var b = bandeauPlanning();
    if (b) app.appendChild(b);

    if (personne) app.appendChild(h("div", { class: "filtre-personne" },
      h("span", null, "Seulement ce qui concerne ", h("b", null, personne.prenom), "."),
      h("a", { class: "btn secondaire", href: "#/planning", style: { minHeight: "46px" } }, "Tout voir")));

    var seg = h("div", { class: "segments", role: "group", "aria-label": "Affichage", style: { "--n": "4" } });
    VUES.forEach(function (x) {
      seg.appendChild(h("button", { type: "button", "aria-pressed": String(v.vue === x[0]), onclick: function () { v.vue = x[0]; rendre(); } }, x[1]));
    });
    app.appendChild(seg);

    // Navigation dans le temps
    var titre, pas;
    var auj = aujourdhui();
    if (v.vue === "jour") { titre = maj(jourAvecAnnee(v.jour)); pas = function (n) { v.jour = plusJours(v.jour, n); }; }
    else if (v.vue === "semaine" || v.vue === "liste") {
      var l = lundiDe(v.jour), d = plusJours(l, 6);
      titre = v.vue === "liste" ? (cle(debutListe(v.jour)) < cle(v.jour) ? "Depuis le " : "À partir du ") + jourLong(debutListe(v.jour)) : "Semaine du " + fmt(midi(l), { day: "numeric", month: "long" }) + " au " + fmt(midi(d), { day: "numeric", month: "long" });
      pas = function (n) { v.jour = plusJours(v.jour, 7 * n); };
    } else { titre = maj(fmt(midi(v.jour), { month: "long", year: "numeric" })); pas = function (n) { v.jour = plusMois(v.jour, n); }; }

    app.appendChild(h("div", { class: "nav-periode" },
      h("button", { class: "btn-rond", type: "button", "aria-label": "Précédent", onclick: function () { pas(-1); rendre(); } }, icone("gauche")),
      h("div", { class: "titre-periode", "aria-live": "polite" }, titre),
      h("button", { class: "btn-rond", type: "button", "aria-label": "Suivant", onclick: function () { pas(1); rendre(); } }, icone("droite"))));
    app.appendChild(h("div", { class: "ligne-aujourdhui" },
      h("button", { class: "btn" + (cle(v.jour) === cle(auj) ? " secondaire" : ""), type: "button", onclick: function () { v.jour = aujourdhui(); rendre(); } }, icone("agenda"), "Aujourd'hui")));

    var zone = h("div", { class: "zone-planning" });
    if (!planning) zone.appendChild(h("p", { class: "chargement" }, "Chargement du planning…"));
    else if (v.vue === "jour") vueJour(zone, v.jour, personne);
    else if (v.vue === "semaine") vueSemaine(zone, v.jour, personne);
    else if (v.vue === "mois") vueMois(zone, v.jour, personne);
    else vueListe(zone, v.jour, personne);
    app.appendChild(zone);

    if (planning && planning.source === "direct" && planning.quand) {
      app.appendChild(h("p", { class: "pied" }, "Planning à jour (" + heure(planning.quand) + ")."));
    }
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
    for (var i = 0; i < 7; i++) {
      (function (jj) {
        var evts = duJour(liste, jj);
        grille.appendChild(h("div", { class: "jour-boite" + (cle(jj) === auj ? " aujourdhui" : "") },
          h("button", { class: "jour-titre", type: "button", onclick: function () { vuePlanning.vue = "jour"; vuePlanning.jour = jj; rendre(); } },
            maj(fmt(midi(jj), { weekday: "long", day: "numeric" }))),
          evts.length ? h("div", { class: "evts" }, evts.map(function (o) { return carteEvenement(o, jj); })) : h("p", { class: "rien" }, "—")));
      })(plusJours(l, i));
    }
    zone.appendChild(grille);
  }

  function vueMois(zone, j, personne) {
    var premier = { y: j.y, m: j.m, d: 1 };
    var depart = lundiDe(premier), auj = cle(aujourdhui());
    var liste = occurrences(debutJour(depart), debutJour(plusJours(depart, 42)), personne);
    var g = h("div", { class: "mois", role: "grid", "aria-label": fmt(midi(premier), { month: "long", year: "numeric" }) });
    ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."].forEach(function (n) { g.appendChild(h("div", { class: "entete-jour", "aria-hidden": "true" }, n)); });
    for (var i = 0; i < 42; i++) {
      (function (jj) {
        var evts = duJour(liste, jj);
        var titres = evts.slice(0, 3).map(function (o) { return h("span", null, (o.journee ? "" : heure(o.debut) + " ") + o.titre); });
        if (evts.length > 3) titres.push(h("span", { class: "plus" }, "+ " + (evts.length - 3) + " autre" + (evts.length > 4 ? "s" : "")));
        g.appendChild(h("button", {
          class: "case" + (jj.m !== j.m ? " dehors" : "") + (cle(jj) === auj ? " aujourdhui" : ""), type: "button",
          "aria-label": jourLong(jj) + (evts.length ? ", " + evts.length + " rendez-vous" : ", rien de prévu"),
          onclick: function () { vuePlanning.vue = "jour"; vuePlanning.jour = jj; rendre(); },
        },
          h("span", { class: "num" }, String(jj.d)),
          h("span", { class: "points", "aria-hidden": "true" }, evts.slice(0, 4).map(function (o) { return h("i", { class: o.journee ? "j" : "" }); })),
          h("span", { class: "titres", "aria-hidden": "true" }, titres)));
      })(plusJours(depart, i));
    }
    zone.appendChild(g);
  }

  /** La liste démarre une semaine plus tôt quand on affiche les événements passés (vue d'aujourd'hui). */
  function debutListe(j) {
    return reglages.passes === "afficher" && cle(j) === cle(aujourdhui()) ? plusJours(j, -7) : j;
  }

  function vueListe(zone, j, personne, nbJours, sansPasses) {
    nbJours = nbJours || 60;
    var debut = sansPasses ? j : debutListe(j);
    var liste = occurrences(debutJour(debut), debutJour(plusJours(j, nbJours)), personne, sansPasses);
    if (sansPasses) { var t = Date.now(); liste = liste.filter(function (o) { return o.fin > t; }); }
    var auj = cle(aujourdhui());
    var jours = 0;
    for (var i = 0; cle(plusJours(debut, i)) < cle(plusJours(j, nbJours)); i++) {
      var jj = plusJours(debut, i);
      var evts = duJour(liste, jj);
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
  function ecranPersonne(app, id) {
    var p = personneParId(id);
    if (!p) { location.hash = "#/"; return; }
    app.appendChild(barre("Mon espace", { href: "#/", texte: "Accueil" }));

    app.appendChild(h("div", { class: "bonjour" },
      h("span", { class: "avatar", style: { background: p.couleur || "#6B1524" } }, icone(p.icone)),
      h("div", null, h("h2", null, "Bonjour " + p.prenom), h("p", null, p.role))));

    var raccourcis = (p.raccourcis || []).map(function (k) { return donnees.liens[k]; }).filter(Boolean);
    if (raccourcis.length) app.appendChild(h("section", { class: "section" },
      h("h2", null, "Mes raccourcis"),
      h("p", { class: "aide" }, "Microsoft vous demandera peut-être de vous connecter : c'est normal."),
      h("div", { class: "grille" }, raccourcis.map(function (l) { return tuileLien(l); }))));

    var boites = (p.boites || []).map(function (k) { return donnees.boites[k]; }).filter(Boolean);
    if (boites.length) app.appendChild(h("section", { class: "section" },
      h("h2", null, "Boîtes partagées"),
      h("div", { class: "grille" }, boites.map(function (b) {
        return tuileLien({ titre: b.nom, texte: b.adresse, icone: "boite", url: "https://outlook.office.com/mail/" + encodeURIComponent(b.adresse) + "/" });
      }))));

    var zone = h("div", null);
    if (planning) vueListe(zone, aujourdhui(), p, 7, true);
    else zone.appendChild(h("p", { class: "chargement" }, "Chargement du planning…"));
    app.appendChild(h("section", { class: "section" },
      h("h2", null, "Mon planning — les 7 prochains jours"),
      bandeauPlanning(),
      zone,
      h("div", { class: "actions" },
        h("a", { class: "btn", href: "#/planning/" + encodeURIComponent(p.id) }, icone("agenda"), "Mon planning complet"),
        h("a", { class: "btn secondaire", href: "#/planning" }, "Tout le planning du Château"))));

    var packs = (p.packs || []).filter(function (k) { return donnees.fiches && donnees.fiches[k]; });
    if (packs.length) app.appendChild(h("section", { class: "section" },
      h("h2", null, "Mes outils"),
      h("div", { class: "grille" }, packs.map(function (k) {
        var f = donnees.fiches[k];
        return h("a", { class: "tuile", href: "#/" + k }, h("span", { class: "pastille" }, icone(f.icone)), h("b", null, f.titre), h("span", { class: "sous" }, f.sousTitre));
      }))));

    var estDefaut = reglages.monEspace === p.id;
    app.appendChild(h("section", { class: "section" }, h("div", { class: "boite" },
      h("h3", null, "Sur cet appareil"),
      h("p", null, estDefaut ? "L'appli s'ouvre directement sur votre espace." : "Voulez-vous que l'appli s'ouvre directement sur votre espace ?"),
      h("button", { class: "btn" + (estDefaut ? " secondaire" : ""), type: "button", onclick: function () {
        reglages.monEspace = estDefaut ? "" : p.id; sauverReglages(); rendre();
      } }, estDefaut ? "Ne plus ouvrir directement" : "Oui, ouvrir mon espace au démarrage"))));
    app.appendChild(pied());
  }

  /* ------------------------------------------------------------------ */
  /* Écrans : Administration / Finance                                   */
  /* ------------------------------------------------------------------ */
  function empreinte(texte) {
    if (!window.crypto || !crypto.subtle || !window.TextEncoder) return Promise.reject(new Error("crypto"));
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    });
  }
  function estOuvert(k, pack) { return !pack.codeEmpreinte || lire("eb:ouvert:" + k, "") === pack.codeEmpreinte; }

  function ecranPack(app, k, idFiche) {
    var pack = donnees.fiches && donnees.fiches[k];
    if (!pack) { location.hash = "#/"; return; }

    if (!estOuvert(k, pack)) {
      app.appendChild(barre(pack.titre, { href: "#/", texte: "Accueil" }));
      var champ = h("input", { class: "champ", type: "password", id: "code", autocomplete: "off", autocapitalize: "none", spellcheck: "false", "aria-describedby": "code-aide" });
      var erreur = h("p", { class: "erreur", role: "alert" });
      app.appendChild(h("div", { class: "verrou boite" },
        h("div", { class: "pastille" }, icone("cadenas")),
        h("h2", null, pack.titre),
        h("p", null, "Cet écran est réservé. Tapez le code donné par Damien."),
        h("form", { onsubmit: function (e) {
          e.preventDefault();
          empreinte("espace-breteuil:" + champ.value.trim()).then(function (x) {
            if (x === pack.codeEmpreinte) { ecrire("eb:ouvert:" + k, x); rendre(); }
            else { erreur.textContent = "Ce n'est pas le bon code."; champ.select(); }
          }, function () { erreur.textContent = "Ce navigateur ne permet pas de vérifier le code."; });
        } },
          h("label", { class: "sr", for: "code" }, "Code"),
          champ, erreur,
          h("button", { class: "btn large", type: "submit" }, icone("cle"), "Ouvrir")),
        h("p", { class: "petit", id: "code-aide" }, "Ce code cache seulement l'écran. La vraie protection, c'est votre connexion Microsoft.")));
      setTimeout(function () { champ.focus(); }, 50);
      return;
    }

    if (idFiche) {
      var f = (pack.fiches || []).filter(function (x) { return x.id === idFiche; })[0];
      if (!f) { location.hash = "#/" + k; return; }
      app.appendChild(barre(f.titre, { href: "#/" + k, texte: "Retour" }));
      app.appendChild(h("ol", { class: "etapes" }, f.etapes.map(function (e) { return h("li", null, h("span", null, e)); })));
      if (f.lien) app.appendChild(h("div", { class: "actions" },
        h("a", lienExterne(f.lien.url, { class: "btn large" }), icone("ouvrir"), f.lien.texte)));
      if (f.note) app.appendChild(h("div", { class: "note" }, icone("info"), h("span", null, f.note)));
      app.appendChild(pied());
      return;
    }

    var verrouiller = h("button", { class: "btn-rond", type: "button", "aria-label": "Verrouiller cet écran", title: "Verrouiller",
      onclick: function () { ecrire("eb:ouvert:" + k, null); location.hash = "#/"; } }, icone("cadenas"));
    app.appendChild(barre(pack.titre, { href: "#/", texte: "Accueil" }, verrouiller));
    if (pack.avertissement) app.appendChild(h("div", { class: "bandeau info" }, icone("info"), h("span", null, pack.avertissement)));
    app.appendChild(h("section", { class: "section", style: { marginTop: "8px" } },
      h("h2", null, pack.sousTitre),
      h("div", { class: "grille" }, (pack.tuiles || []).map(function (t) { return tuileLien(t); }))));
    app.appendChild(h("section", { class: "section" },
      h("h2", null, "Comment faire ?"),
      h("div", { class: "liste-fiches" }, (pack.fiches || []).map(function (f) {
        return h("a", { href: "#/" + k + "/fiche/" + encodeURIComponent(f.id) }, icone(f.icone), h("span", null, f.titre), h("span", { class: "fleche", "aria-hidden": "true" }, "›"));
      }))));
    app.appendChild(pied());
  }

  /* ------------------------------------------------------------------ */
  /* Écran : réglages                                                    */
  /* ------------------------------------------------------------------ */
  function choix(titre, aide, cleR, options) {
    var seg = h("div", { class: "segments", role: "group", "aria-label": titre, style: { "--n": String(options.length) } });
    options.forEach(function (o) {
      seg.appendChild(h("button", { type: "button", "aria-pressed": String(reglages[cleR] === o[0]), style: o[2] ? { fontSize: o[2] } : null,
        onclick: function () { reglages[cleR] = o[0]; if (cleR === "vue") vuePlanning.vue = o[0]; sauverReglages(); rendre(); } }, o[1]));
    });
    return h("div", { class: "boite reglage" }, h("h2", null, titre), aide ? h("p", null, aide) : null, seg);
  }

  function ecranReglages(app) {
    app.appendChild(barre("Réglages", { href: "#/", texte: "Accueil" }));
    app.appendChild(h("p", { class: "aide", style: { color: "var(--doux)", marginTop: "0" } }, "Ces réglages restent sur cet appareil uniquement."));
    app.appendChild(choix("Taille du texte", null, "texte", [["normal", "Normal", "1rem"], ["grand", "Grand", "1.15rem"], ["tres-grand", "Très grand", "1.3rem"]]));
    app.appendChild(choix("Couleurs", null, "theme", [["auto", "Auto"], ["clair", "Clair"], ["sombre", "Sombre"]]));
    app.appendChild(choix("Planning : affichage au départ", null, "vue", VUES));
    app.appendChild(choix("Événements passés", "Les rendez-vous déjà terminés.", "passes", [["afficher", "Afficher"], ["masquer", "Masquer"]]));

    var select = h("select", { class: "champ", id: "mon-espace", onchange: function () { reglages.monEspace = this.value; sauverReglages(); } },
      h("option", { value: "" }, "Non, ouvrir l'accueil"),
      donnees.personnes.map(function (p) { return h("option", { value: p.id, selected: reglages.monEspace === p.id }, p.prenom + " (" + p.role + ")"); }));
    app.appendChild(h("div", { class: "boite reglage" },
      h("h2", null, h("label", { for: "mon-espace" }, "Ouvrir directement un espace")),
      h("p", null, "Pratique si cet appareil n'est utilisé que par une personne."), select));

    app.appendChild(h("div", { class: "actions" },
      h("button", { class: "btn secondaire", type: "button", onclick: function () {
        reglages = Object.assign({}, REGLAGES_DEFAUT); vuePlanning.vue = reglages.vue; sauverReglages(); rendre();
      } }, "Remettre les réglages d'origine")));
    app.appendChild(pied());
  }

  /* ------------------------------------------------------------------ */
  /* Écran : installer                                                   */
  /* ------------------------------------------------------------------ */
  function ecranInstaller(app) {
    app.appendChild(barre("Installer l'appli", { href: "#/", texte: "Accueil" }));
    if (estInstallee()) {
      app.appendChild(h("div", { class: "boite" }, h("p", null, "C'est fait : l'Espace Breteuil est installé sur cet appareil.")));
      return;
    }
    app.appendChild(h("p", { style: { marginTop: 0 } }, "L'Espace Breteuil s'installe comme une appli, sans compte et sans mot de passe. Une icône apparaît sur l'écran d'accueil."));
    if (invitationInstallation) {
      app.appendChild(h("div", { class: "actions" }, h("button", { class: "btn large", type: "button", onclick: function () {
        var inv = invitationInstallation; invitationInstallation = null;
        inv.prompt(); inv.userChoice.then(function () { rendre(); }, function () { rendre(); });
      } }, icone("installer"), "Installer maintenant")));
    }
    app.appendChild(h("div", { class: "boite", style: { marginTop: "20px" } },
      h("h3", null, "Sur iPhone ou iPad (Safari)"),
      h("ol", { class: "etapes" },
        h("li", null, h("span", null, "Touchez le bouton Partager (le carré avec une flèche vers le haut).")),
        h("li", null, h("span", null, "Choisissez « Sur l'écran d'accueil ».")),
        h("li", null, h("span", null, "Touchez « Ajouter ». C'est fini.")))));
    app.appendChild(h("div", { class: "boite" },
      h("h3", null, "Sur Android (Chrome)"),
      h("ol", { class: "etapes" },
        h("li", null, h("span", null, "Touchez les trois petits points en haut à droite.")),
        h("li", null, h("span", null, "Choisissez « Installer l'application » ou « Ajouter à l'écran d'accueil ».")),
        h("li", null, h("span", null, "Confirmez. C'est fini.")))));
    app.appendChild(pied());
  }

  /* ------------------------------------------------------------------ */
  /* Navigation                                                          */
  /* ------------------------------------------------------------------ */
  var dernierEcran = "";
  function rendre() {
    var app = document.getElementById("app");
    var chemin = (location.hash || "#/").replace(/^#\/?/, "").split("/").map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } });
    var ecran = chemin[0] || "";
    var cleEcran = chemin.join("/");
    var garderDefilement = cleEcran === dernierEcran;
    var y = window.scrollY;
    app.textContent = "";
    if (ecran === "planning") ecranPlanning(app, chemin[1]);
    else if (ecran === "personne") ecranPersonne(app, chemin[1]);
    else if (ecran === "admin" || ecran === "finance") ecranPack(app, ecran, chemin[1] === "fiche" ? chemin[2] : null);
    else if (ecran === "reglages") ecranReglages(app);
    else if (ecran === "installer") ecranInstaller(app);
    else ecranAccueil(app);
    document.title = ecran ? (app.querySelector("h1") ? app.querySelector("h1").textContent + " — Espace Breteuil" : "Espace Breteuil") : "Espace Breteuil";
    if (garderDefilement) window.scrollTo(0, y); else window.scrollTo(0, 0);
    dernierEcran = cleEcran;
  }
  window.addEventListener("hashchange", rendre);

  /* ------------------------------------------------------------------ */
  /* Démarrage                                                           */
  /* ------------------------------------------------------------------ */
  function demarrer() {
    appliquerAffichage();
    if ((!location.hash || location.hash === "#/" || location.hash === "#") && reglages.monEspace) {
      history.replaceState(null, "", "#/personne/" + encodeURIComponent(reglages.monEspace));
    }
    Promise.all([
      chargerJson("personnes.json").then(function (j) {
        donnees.personnes = j.personnes || []; donnees.liens = j.liens || {}; donnees.boites = j.boitesPartagees || {};
      }),
      chargerJson("fiches.json").then(function (j) { donnees.fiches = j; }),
    ]).catch(function (e) { console.error("Espace Breteuil :", e); }).then(function () {
      rendre(); // affichage immédiat, le planning arrive ensuite
      return chargerPlanning();
    }).then(rendre);

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(function () {});
      });
    }
  }

  demarrer();
})();
