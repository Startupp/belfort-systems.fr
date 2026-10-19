/*
 * Espace Breteuil — v5.1 : écrans de la section « Site web » (www.breteuil.fr, WordPress).
 *   #/site            onglet « Site » (personne dont c'est la seule section de gestion)
 *   (Gérer)           même section, en tuiles, pour l'administrateur et les profils à plusieurs sections
 *   #/liens           vérificateur des liens du bas de page (Worker belfort-api : GET /breteuil/site/liens)
 *   #/guides/site[/<id>]  pas-à-pas en 3 étapes
 * Visible pour les administrateurs généraux et les membres du groupe nommé dans config.js (siteWeb.groupe).
 * WordPress demande son propre identifiant : l'appli n'y écrit rien, elle ouvre seulement les bonnes pages.
 */
(function () {
  "use strict";
  var EB = window.EB, S = window.EBSiteWeb;
  if (!EB || !S) return;
  var h = EB.h, icone = EB.icone;
  var CFG = self.EB_CONFIG || {};

  function lienExterne(url, attrs) { return Object.assign({ href: url, target: "_blank", rel: "noopener noreferrer" }, attrs || {}); }
  function rappelIdentifiant() {
    return h("div", { class: "bandeau info", role: "note" }, icone("cle"), h("div", null,
      h("strong", null, "Le site a son propre identifiant"),
      h("span", null, "Ce n'est pas votre adresse du Château : il faut le compte du site (WordPress).")));
  }

  /**
   * v5.5.1 : encadré « 🔑 Accès au site à prévoir » (ton doux, pas une alerte), en tête de chaque écran de la
   * section tant que config.siteWeb.accesPret n'est pas true. « Écrire à Damien » ouvre le panneau d'aide
   * pré-rempli (Question). Renvoie null quand l'accès est prêt.
   */
  function encadreAcces() {
    if (S.accesPret(CFG)) return null;
    var A = S.ACCES;
    return h("aside", { class: "encadre-acces", role: "note", "aria-labelledby": "t-acces-site", "data-encadre": "acces-site" },
      h("p", { class: "titre", id: "t-acces-site" }, A.titre),
      h("p", { class: "texte" }, A.texte),
      h("button", { class: "btn secondaire", type: "button", "data-action": "ecrire-acces-site", onclick: function () {
        if (window.EBAideEcrans && window.EBAideEcrans.ecrire) window.EBAideEcrans.ecrire(A.type, A.message);
      } }, icone("mail"), A.bouton));
  }

  /** Section « Site web » : rappel + tuiles (3 par ligne). */
  function section() {
    return h("section", { class: "section section-site", "aria-labelledby": "t-site" },
      h("h2", { id: "t-site" }, "Site internet"),
      encadreAcces(),
      rappelIdentifiant(),
      EB.grandesTuiles(S.tuiles(CFG)));
  }

  /** Fiche dépliable (ou ouverte) : prudence, étapes, bouton vers WordPress, note. */
  function contenuGuide(g) {
    var pret = S.accesPret(CFG);
    return [
      g.prudence ? h("div", { class: "bandeau exemple", role: "note" }, icone("exemple"), h("div", null, h("strong", null, "Prudence"), h("span", null, g.prudence))) : null,
      h("ol", { class: "etapes" }, g.etapes.map(function (e) { return h("li", null, h("span", null, e)); })),
      // Accès pas prêt : pas de bouton vers l'administration WordPress (le mode d'emploi reste lisible).
      pret ? h("div", { class: "actions" },
        h("a", lienExterne(g.lien.url, { class: "btn large" }), icone("ouvrir"), g.lien.texte),
        g.lien2 ? h("a", lienExterne(g.lien2.url, { class: "btn secondaire large" }), icone("ouvrir"), g.lien2.texte) : null)
        : h("p", { class: "note acces-attente" }, icone("cle"), h("span", null, "Le bouton « " + g.lien.texte + " » apparaîtra quand l'accès au site sera prêt.")),
      g.note ? h("div", { class: "note" }, icone("info"), h("span", null, g.note)) : null,
    ];
  }
  function fiches(ouverte) {
    return h("div", { class: "fiches-site" }, S.guides(CFG).map(function (g) {
      return h("details", { class: "fiche-site", id: "fiche-" + g.id, open: g.id === ouverte },
        h("summary", null, h("span", { class: "eb-anneau" }, icone(g.icone)), h("span", { class: "titre" }, g.titre), h("span", { class: "fleche", "aria-hidden": "true" }, "›")),
        h("div", { class: "corps" }, contenuGuide(g)));
    }));
  }

  /* Onglet « Site » */
  function ecranSite(app) {
    app.appendChild(EB.barre("Site internet", null, null, "www.breteuil.fr"));
    app.appendChild(section());
    app.appendChild(h("section", { class: "section", "aria-labelledby": "t-pas" }, h("h2", { id: "t-pas" }, "Modes d'emploi"), fiches()));
  }

  /* #/guides/site et #/guides/site/<id> */
  function ecranGuides(app, chemin) {
    var id = chemin[2];
    if (id) {
      var g = S.guide(CFG, id);
      if (!g) { location.hash = "#/guides/site"; return; }
      app.appendChild(EB.barre(g.titre, { href: "#/guides/site", texte: "Modes d'emploi" }));
      var e0 = encadreAcces(); if (e0) app.appendChild(e0);
      contenuGuide(g).forEach(function (x) { if (x) app.appendChild(x); });
      return;
    }
    app.appendChild(EB.barre("Site internet : modes d'emploi", EB.hub()));
    var e1 = encadreAcces(); if (e1) app.appendChild(e1);
    app.appendChild(h("p", { class: "aide-ecran" }, "3 étapes au plus. Après chaque modification, pensez à « Rafraîchir le site »."));
    app.appendChild(rappelIdentifiant());
    app.appendChild(fiches());
  }

  /* ------------------------------------------------------------------ */
  /* #/liens : vérificateur des liens du bas de page                     */
  /* ------------------------------------------------------------------ */
  var gen = 0;
  function charger(forcer) {
    var api = String(CFG.api || "").replace(/\/+$/, "");
    if (!api) return Promise.reject({ reseau: true });
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var minuterie = ctrl ? setTimeout(function () { ctrl.abort(); }, 90000) : null;
    return fetch(api + "/breteuil/site/liens" + (forcer ? "?forcer=1" : ""), { mode: "cors", cache: "no-store", signal: ctrl && ctrl.signal })
      .then(function (r) {
        clearTimeout(minuterie);
        if (!r.ok) throw { statut: r.status };
        return r.json();
      }, function () {
        clearTimeout(minuterie);
        throw { reseau: true, horsLigne: typeof navigator !== "undefined" && navigator.onLine === false };
      })
      .then(function (j) { if (!j || !Array.isArray(j.liens)) throw { statut: 500 }; return j; });
  }
  function quand(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    try { return d.toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }); } catch (e) { return d.toISOString(); }
  }
  function carte(l, genre) {
    var symbole = genre === "casse" ? "croix" : genre === "verifier" ? "exemple" : "coche";
    return h("div", { class: "carte-lien " + genre, "data-lien": l.url },
      h("div", { class: "tete" },
        h("span", { class: "eb-anneau" }, icone(symbole)),
        h("div", { class: "quoi" },
          h("b", null, S.decoder(l.texte) || S.courte(l.url, 40)),
          h("small", { class: "adresse" }, S.courte(l.url)),
          h("small", { class: "pourquoi" }, S.phrase(l)),
          l.redirigeVers ? h("small", { class: "adresse" }, "→ " + S.courte(l.redirigeVers)) : null,
          h("span", { class: "puce-langue" }, l.page === "en" ? "Page anglaise" : "Page française"))),
      h("div", { class: "actes" },
        genre !== "ok" ? h("a", { class: "btn petit", href: "#/guides/site/pied" }, icone("crayon"), "Corriger") : null,
        h("a", lienExterne(l.url, { class: "btn petit secondaire" }), icone("ouvrir"), "Ouvrir")));
  }
  function ecranLiens(app) {
    var g0 = ++gen;
    app.appendChild(EB.barre("Vérifier les liens", EB.hub(), null, "Bas de page du site"));
    var e2 = encadreAcces(); if (e2) app.appendChild(e2);
    app.appendChild(h("p", { class: "aide-ecran" }, "Les liens du bas de page de www.breteuil.fr (en français et en anglais) sont essayés un par un. Le résultat est gardé une heure."));
    var zone = h("div", { class: "zone-liens", "aria-live": "polite" });
    var bouton = h("button", { class: "btn large", type: "button", "data-action": "reverifier", onclick: function () { lancer(true); } }, icone("actualiser"), "Revérifier");
    app.appendChild(zone);
    app.appendChild(h("div", { class: "actions" }, bouton));

    function la() { return g0 === gen && document.body.contains(zone); }
    function attente() {
      zone.textContent = "";
      zone.appendChild(h("p", { class: "petit" }, "Vérification en cours… (jusqu'à une minute)"));
      zone.appendChild(EB.squelette(3));
    }
    function lancer(forcer) {
      bouton.disabled = true; attente();
      charger(forcer).then(function (j) { if (la()) dessiner(j); }, function (e) { if (la()) erreur(e); })
        .then(function () { bouton.disabled = false; });
    }
    function erreur(e) {
      var m = S.messageErreur(e);
      zone.textContent = "";
      zone.appendChild(h("div", { class: "bandeau erreur", role: "alert", "data-etat": "erreur" }, icone("exemple"),
        h("div", null, h("strong", null, m.titre), h("span", null, m.texte))));
    }
    function dessiner(j) {
      var g = S.trier(j.liens);
      zone.textContent = "";
      zone.appendChild(h("div", { class: "bilan-liens" },
        h("span", { class: "puce-bilan casse" }, String(g.casse.length), " ", g.casse.length > 1 ? "cassés" : "cassé"),
        h("span", { class: "puce-bilan verifier" }, String(g.verifier.length), " à vérifier"),
        h("span", { class: "puce-bilan ok" }, String(g.ok.length), " ", g.ok.length > 1 ? "bons" : "bon")));
      if (j.verifieLe) zone.appendChild(h("p", { class: "petit verifie-le" }, "Vérifié le " + quand(j.verifieLe) + (j.ancien ? " (le site ne répond pas : dernière vérification connue)" : "")));
      if (!j.liens.length) zone.appendChild(h("div", { class: "bandeau info" }, icone("info"), h("span", null, "Aucun lien trouvé dans le bas de page.")));
      if (g.casse.length) zone.appendChild(h("section", { class: "section groupe-liens", "aria-labelledby": "t-casse" },
        h("h2", { id: "t-casse" }, "Cassés : à corriger"), g.casse.map(function (l) { return carte(l, "casse"); })));
      if (g.verifier.length) zone.appendChild(h("section", { class: "section groupe-liens", "aria-labelledby": "t-verifier" },
        h("h2", { id: "t-verifier" }, "À vérifier"), g.verifier.map(function (l) { return carte(l, "verifier"); })));
      if (!g.casse.length && !g.verifier.length && g.ok.length) zone.appendChild(h("div", { class: "bandeau info" }, icone("coche"), h("span", null, "Tous les liens marchent.")));
      if (g.ok.length) zone.appendChild(h("details", { class: "fiche-site liens-ok" },
        h("summary", null, h("span", { class: "eb-anneau" }, icone("coche")), h("span", { class: "titre" }, g.ok.length + (g.ok.length > 1 ? " liens marchent" : " lien marche")), h("span", { class: "fleche", "aria-hidden": "true" }, "›")),
        h("div", { class: "corps" }, g.ok.map(function (l) { return carte(l, "ok"); }))));
    }
    lancer(false);
  }

  EB.ecran("site", ecranSite);
  EB.ecran("liens", ecranLiens);
  window.EBSiteEcrans = { section: section, guides: ecranGuides, encadreAcces: encadreAcces };
})();
