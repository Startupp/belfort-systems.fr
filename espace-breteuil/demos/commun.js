/*
 * Espace Breteuil — écrans de démo : outils communs (window.EBD).
 * S'appuie sur window.EB (app.js) et window.EBDemos (demos/donnees.js).
 * Données fictives, gardées sur l'appareil uniquement.
 */
(function () {
  "use strict";
  var EB = window.EB, D = window.EBDemos;
  if (!EB || !D) return;
  var h = EB.h;

  var etat = D.charger();

  /* « Remettre la démo à zéro » (Réglages) efface aussi ces écrans. */
  if (window.EBDemo && window.EBDemo.reinitialiser) {
    var avant = window.EBDemo.reinitialiser;
    window.EBDemo.reinitialiser = function () { D.effacer(); etat = D.base(); return avant.apply(this, arguments); };
  }

  /* Retour vers le bon panneau : Gestion du Château ou Finance. */
  var hub = "#/gestion";
  function suivreHub() {
    if (/^#\/finance/.test(location.hash)) hub = "#/finance";
    else if (/^#\/gestion/.test(location.hash)) hub = "#/gestion";
  }
  window.addEventListener("hashchange", suivreHub);
  suivreHub();
  function retourHub() { return { href: hub, texte: hub === "#/finance" ? "Finance" : "Gestion" }; }

  function quiAgit() {
    var r = EB.lire("eb:reglages", {}) || {};
    var p = r.moi && (EB.personnes() || []).filter(function (x) { return x.id === r.moi; })[0];
    return p ? p.prenom : "Vous";
  }
  function sauver(action, detail) {
    if (action) D.journal(etat, quiAgit(), action, detail);
    D.sauver(etat);
  }

  /**
   * En-tête commun : verrou (code du panneau), barre, bandeau « Démo — données fictives ».
   * packs : liste des panneaux qui ouvrent l'écran (null = libre). Renvoie faux si verrouillé.
   */
  function entete(app, titre, packs, retour) {
    if (packs && !EB.exiger(app, packs, retour || retourHub())) return false;
    app.appendChild(EB.barre(titre, retour || retourHub()));
    app.appendChild(EB.bandeauDemo("Démo — données fictives"));
    return true;
  }

  function personne(id) { return D.personne(etat, id); }
  function prenom(id) { var p = personne(id); return p ? p.prenom : id; }

  /** Visage touchable : photo ou initiales, prénom dessous. */
  function visage(p, opts) {
    opts = opts || {};
    return h("button", { class: "visage" + (opts.classe ? " " + opts.classe : ""), type: "button",
      "aria-label": opts.label || p.prenom, "aria-pressed": opts.presse == null ? null : String(!!opts.presse), onclick: opts.onclick },
      h("span", { class: "visage-cadre" }, EB.avatar(p), opts.badge ? h("span", { class: "visage-badge", "aria-hidden": "true" }, opts.badge) : null),
      h("span", null, p.prenom));
  }

  /** Message d'information simple (un seul bouton). */
  function info(emoji, titre, phrase) {
    var d = EB.dialogue();
    var ok = h("button", { class: "btn large", type: "button", onclick: EB.fermerDialogue }, "J'ai compris");
    d.appendChild(h("div", { class: "contenu centre" }, EB.emoji(emoji, "grand"), h("h2", { id: "detail-titre" }, titre), h("p", { class: "phrase" }, phrase), ok));
    EB.ouvrirDialogue(d, ok);
  }

  /** Grosse carte à choisir (bouton pressé / non pressé). */
  function carteChoix(emoji, titre, phrase, presse, onclick, extra) {
    return h("button", { class: "carte-choix", type: "button", "aria-pressed": String(!!presse), onclick: onclick },
      h("span", { class: "emoji carte-choix-emoji", "aria-hidden": "true" }, emoji),
      h("span", { class: "carte-choix-texte" }, h("b", null, titre), phrase ? h("small", null, phrase) : null, extra || null),
      h("span", { class: "carte-choix-coche", "aria-hidden": "true" }, EB.icone("coche")));
  }

  /** Progression d'un assistant : « Étape 2 sur 4 » et une barre. */
  function progression(n, total, titre) {
    var barres = [];
    for (var i = 1; i <= total; i++) barres.push(h("i", { class: i <= n ? "fait" : "" }));
    return h("div", { class: "progression" },
      h("p", { class: "progression-texte" }, "Étape " + n + " sur " + total + (titre ? " — " + titre : "")),
      h("div", { class: "progression-barre", "aria-hidden": "true" }, barres));
  }

  /** Boutons du bas d'un assistant. */
  function navAssistant(precedent, suivant, texteSuivant) {
    return h("div", { class: "nav-assistant" },
      precedent ? h("a", { class: "btn secondaire", href: precedent }, EB.icone("gauche"), "Retour") : h("span"),
      typeof suivant === "string" ? h("a", { class: "btn", href: suivant }, texteSuivant || "Continuer", EB.icone("droite"))
        : h("button", { class: "btn", type: "button", onclick: suivant }, texteSuivant || "Continuer", EB.icone("droite")));
  }

  /** Date lisible : « lundi 20 octobre ». */
  function jourLisible(iso, court) {
    return EB.fmt(EB.midi(EB.depuisIso(iso)), court ? { weekday: "short", day: "numeric", month: "short" } : { weekday: "long", day: "numeric", month: "long" });
  }

  /** Vignette d'une boîte partagée : sa photo, sinon son pictogramme sur sa couleur. */
  function vignetteBoite(b, taille) {
    var el = h("span", { class: "vignette-boite" + (taille ? " " + taille : ""), style: { background: b.couleur }, "aria-hidden": "true" });
    if (b.photo) el.appendChild(h("img", { src: b.photo, alt: "" }));
    else el.appendChild(h("span", { class: "emoji" }, b.emoji));
    return el;
  }

  /** Ligne d'historique. */
  function ligneHistorique(x) {
    var heure = x.quand.slice(11, 16).replace(":", " h ");
    return h("li", { class: "histo" },
      h("span", { class: "histo-qui" }, EB.avatar({ prenom: x.qui, couleur: "#5E4E52" })),
      h("span", { class: "histo-quoi" }, h("b", null, x.action), h("span", null, x.detail),
        h("small", null, EB.maj(jourLisible(x.quand.slice(0, 10))) + " à " + heure + " — par " + x.qui)));
  }

  window.EBD = {
    etat: function () { return etat; }, sauver: sauver, entete: entete, retourHub: retourHub, quiAgit: quiAgit,
    personne: personne, prenom: prenom, visage: visage, info: info, carteChoix: carteChoix, progression: progression,
    navAssistant: navAssistant, jourLisible: jourLisible, vignetteBoite: vignetteBoite, ligneHistorique: ligneHistorique,
  };
})();
