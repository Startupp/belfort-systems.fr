/*
 * Espace Breteuil — v5.2 : écrans « Pilotage » (vraies données, lues dans le dossier commun).
 *
 *   #/pilotage     historique daté (frise), ce qui a été mis en place, tous les documents, contacter
 *                  — depuis l'onglet de gestion (Gérer, Équipe ou Finance) ;
 *   #/moi/guides   guides PDF « pour: tous » + pas-à-pas selon le profil — pour tout le monde.
 *
 * Sources (Microsoft Graph, droits de la personne connectée, Files.ReadWrite.All déjà accordé) :
 *   <dossier commun>/Pilotage/pilotage.json   contenu structuré (validé par pilotage.js)
 *   <dossier commun>/Pilotage/Guides/*.pdf    les documents (liens « Ouvrir » = webUrl, nouvel onglet)
 * Tout est inséré en TEXTE (fabrique EB.h) : jamais de HTML venu du fichier.
 * Réponses gardées en mémoire 1 minute (cache.js), puis rafraîchies en arrière-plan.
 */
(function () {
  "use strict";

  var EB = window.EB, G = window.EBGraph, C = window.EBCache, P = window.EBPilotage;
  var X = function () { return window.EBConnecte; };
  var h = EB.h, icone = EB.icone, emoji = EB.emoji;
  var CLE = "pilotage:contenu";
  var ABSENT = "Le dossier Pilotage n'est pas encore en place — Damien doit le déposer dans le dossier commun.";

  /* ------------------------------------------------------------------ */
  /* Lecture                                                             */
  /* ------------------------------------------------------------------ */
  function introuvable(e) { return e && (e.statut === 404 || e.codeGraph === "itemNotFound"); }
  /** { etat: "ok" | "absent" | "illisible", donnees, ignores, fichiers }. */
  function charger() {
    return X().contexte().then(function (c) {
      if (!c || !c.drive) return { etat: "absent" };
      var base = "/drives/" + c.drive.id + "/root:/" + [X().nomCommun(), "Pilotage"].map(encodeURIComponent).join("/");
      var json = G.graph("GET", base + "/pilotage.json:/content").then(function (v) { return { v: v }; },
        function (e) { if (introuvable(e)) return null; throw e; });
      var fichiers = G.graphTout(base + "/Guides:/children?$select=name,webUrl,size,lastModifiedDateTime,file,folder&$top=500")
        .catch(function (e) { if (introuvable(e)) return []; throw e; });
      return Promise.all([json, fichiers]).then(function (r) {
        if (!r[0]) return { etat: "absent" };
        var v = P.valider(r[0].v);
        if (!v.ok) return { etat: "illisible", raison: v.raison };
        var pdf = (r[1] || []).filter(function (f) { return f && !f.folder; })
          .map(function (f) { return { name: f.name, webUrl: f.webUrl, size: f.size, lastModifiedDateTime: f.lastModifiedDateTime }; });
        return { etat: "ok", donnees: v.donnees, ignores: v.ignores, fichiers: pdf };
      });
    });
  }
  /** Affiche aussitôt le dernier état connu, puis redessine si la valeur change. */
  function avecDonnees(zone, dessiner) {
    zone.appendChild(EB.squelette(4));
    function ok(r) { if (!document.body.contains(zone)) return; zone.textContent = ""; zone.removeAttribute("aria-busy"); dessiner(r); }
    zone.setAttribute("aria-busy", "true");
    C.obtenir(CLE, charger, { ttl: 60000, surMaj: ok }).then(ok, function (e) {
      if (!document.body.contains(zone)) return;
      zone.textContent = ""; zone.removeAttribute("aria-busy");
      zone.appendChild(X().blocErreur(e, function () { C.oublier(CLE); EB.rendre(); }));
    });
  }
  function bandeauEtat(r) {
    if (r.etat === "absent") return h("div", { class: "bandeau info", role: "status", "data-etat": "absent" }, icone("info"), h("span", null, ABSENT));
    if (r.etat === "illisible") return h("div", { class: "bandeau erreur", role: "alert", "data-etat": "illisible" }, icone("exemple"),
      h("span", null, h("strong", null, r.raison || "Le fichier pilotage.json n'est pas lisible."), "Damien doit le corriger dans le dossier commun."));
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Morceaux d'écran                                                    */
  /* ------------------------------------------------------------------ */
  function lienPdf(url, attrs) { return Object.assign({ href: url, target: "_blank", rel: "noopener noreferrer" }, attrs || {}); }

  function frise(d, fichiers) {
    if (!d.historique.length) return h("p", { class: "rien" }, "Rien pour l'instant.");
    return h("ol", { class: "frise" }, d.historique.map(function (e) {
      var docs = P.documentsDe(e, d, fichiers);
      return h("li", { class: "etape-frise" },
        h("span", { class: "point", "aria-hidden": "true" }),
        h("article", { class: "carte-frise" },
          h("time", { datetime: e.date }, P.dateLongue(e.date)),
          h("h3", null, e.titre),
          e.resume ? h("p", null, e.resume) : null,
          docs.length ? h("ul", { class: "docs-frise" }, docs.map(function (x) {
            return h("li", null, h("span", { class: "nom-doc" }, emoji("📄"), h("span", null, x.titre)),
              x.url ? h("a", lienPdf(x.url, { class: "btn petit", "aria-label": "Ouvrir « " + x.titre + " » (nouvel onglet)" }), icone("ouvrir"), "Ouvrir")
                : h("span", { class: "a-venir" }, "document à venir"));
          })) : null));
    }));
  }

  function themes(d) {
    if (!d.miseEnPlace.length) return h("p", { class: "rien" }, "Rien pour l'instant.");
    return h("div", { class: "grille-themes" }, d.miseEnPlace.map(function (t) {
      return h("article", { class: "carte-theme" }, h("h3", null, t.titre),
        t.points.length ? h("ul", null, t.points.map(function (p) { return h("li", null, p); })) : null);
    }));
  }

  function listeDocuments(guides, vide) {
    if (!guides.length) return h("p", { class: "rien" }, vide || "Aucun document pour l'instant.");
    return h("div", { class: "liste-docs" }, guides.map(function (g) {
      var infos = ["PDF", P.taille(g.taille), g.pour === "gestion" ? "réservé à la gestion" : ""].filter(Boolean).join(" · ");
      if (!g.url) return h("div", { class: "doc a-venir", "aria-disabled": "true" }, emoji("📄"),
        h("span", null, h("b", null, g.titre), h("small", null, "document à venir")));
      return h("a", lienPdf(g.url, { class: "doc", "data-doc": g.fichier }), emoji("📄"),
        h("span", null, h("b", null, g.titre), h("small", null, infos)), icone("ouvrir"));
    }));
  }

  function contact(p) {
    if (!p.nom && !p.telephone && !p.mail) return h("p", { class: "rien" }, "Coordonnées à venir.");
    return h("div", { class: "carte-contact" },
      h("span", { class: "eb-anneau rond lent" }, icone("telephone")),
      h("div", null, p.nom ? h("b", null, p.nom) : null,
        h("div", { class: "boutons" },
          p.telephone ? h("a", { class: "btn", href: P.lienTel(p.telephone), "data-action": "appeler" }, icone("telephone"), p.telephone) : null,
          p.mail ? h("a", { class: "btn secondaire", href: "mailto:" + p.mail, "data-action": "ecrire" }, icone("mail"), p.mail) : null)));
  }

  function section(id, titre, contenu) {
    return h("section", { class: "section section-pilotage", id: id, "aria-labelledby": id + "-t" }, h("h2", { id: id + "-t", tabindex: "-1" }, titre), contenu);
  }

  /* ------------------------------------------------------------------ */
  /* #/pilotage                                                          */
  /* ------------------------------------------------------------------ */
  var SECTIONS = [["p-historique", "Historique"], ["p-place", "Mis en place"], ["p-docs", "Documents"], ["p-contact", "Contacter"]];
  function ecranPilotage(app) {
    app.appendChild(EB.barre("Pilotage", EB.hub(), null, "Tout ce qui a été mis en place"));
    var zone = h("div", { class: "zone-pilotage" });
    app.appendChild(zone);
    avecDonnees(zone, function (r) {
      var b = bandeauEtat(r);
      if (b) { zone.appendChild(b); return; }
      var d = r.donnees;
      zone.appendChild(h("p", { class: "aide-ecran" }, "Ce qui a été fait et échangé avec votre prestataire, du plus récent au plus ancien.",
        d.misAJour ? h("small", { class: "maj-pilotage" }, "Mis à jour le " + P.dateLongue(d.misAJour)) : null));
      zone.appendChild(h("nav", { class: "sommaire-pilotage", "aria-label": "Aller à" }, SECTIONS.map(function (s) {
        return h("button", { class: "btn petit secondaire", type: "button", onclick: function () {
          var t = document.getElementById(s[0] + "-t"); if (!t) return;
          t.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); t.focus({ preventScroll: true });
        } }, s[1]);
      })));
      zone.appendChild(section("p-historique", "Historique", frise(d, r.fichiers)));
      zone.appendChild(section("p-place", "Ce qui a été mis en place", themes(d)));
      zone.appendChild(section("p-docs", "Tous les documents", listeDocuments(P.guidesPour(d, r.fichiers, "gestion"))));
      zone.appendChild(section("p-contact", "Contacter", contact(d.prestataire)));
    });
  }

  /* ------------------------------------------------------------------ */
  /* #/moi/guides (tout le monde)                                        */
  /* ------------------------------------------------------------------ */
  function pasAPas() {
    var r = window.EBAcces && window.EBAcces.resultat(), s = (r && r.sections) || [], l = [];
    if (s.indexOf("deleguer") > -1 || s.indexOf("equipe") > -1) l.push(["#/guides/admin", "cle", "Gestes d'administration"]);
    if (s.indexOf("finance") > -1) l.push(["#/guides/finance", "euro", "Gestes de facturation"]);
    if (s.indexOf("site") > -1) l.push(["#/guides/site", "globe", "Site web : pas à pas"]);
    return l;
  }
  function ecranMesGuides(app) {
    app.appendChild(EB.barre("Guides", { href: "#/moi", texte: "Moi" }));
    var zone = h("section", { class: "section section-pilotage", "aria-labelledby": "g-docs" }, h("h2", { id: "g-docs" }, "Documents"));
    app.appendChild(zone);
    var corps = h("div");
    zone.appendChild(corps);
    avecDonnees(corps, function (r) {
      var b = bandeauEtat(r);
      if (b) { corps.appendChild(b); return; }
      corps.appendChild(listeDocuments(P.guidesPour(r.donnees, r.fichiers, "tous"), "Aucun guide pour l'instant."));
    });
    var l = pasAPas();
    if (l.length) app.appendChild(h("section", { class: "section" }, h("h2", null, "Pas à pas"),
      h("div", { class: "liste-fiches" }, l.map(function (x) {
        return h("a", { href: x[0] }, icone(x[1]), h("span", null, x[2]), h("span", { class: "fleche", "aria-hidden": "true" }, "›"));
      }))));
  }

  /** Grande tuile en tête de l'onglet de gestion. */
  function tuileGestion() {
    return h("a", { class: "action carte-pilotage", href: "#/pilotage", "data-action": "pilotage" },
      h("span", { class: "eb-anneau" }, icone("horloge")),
      h("span", null, h("b", null, "Pilotage — tout ce qui a été mis en place"), h("small", null, "Historique daté, guides PDF, ce qui a été réglé, contacter le prestataire")),
      h("span", { class: "fleche", "aria-hidden": "true" }, "›"));
  }

  EB.ecran("pilotage", ecranPilotage);
  window.EBPilotageEcrans = { guides: ecranMesGuides, tuile: tuileGestion, charger: charger };
})();
