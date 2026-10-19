/*
 * Espace Breteuil — v5.2 : écrans « Suivi informatique » (vraies données, lues dans le dossier commun).
 * Libellés, dossier et fichier : config.js → suivi (un seul endroit pour les renommer).
 *
 *   #/suivi        historique daté (frise), projets à venir (v5.3.3, si « projets » est présent),
 *                  ce qui a été mis en place, tous les documents, contacter
 *                  — depuis l'onglet de gestion (Gérer, Équipe ou Finance) ; #/pilotage y renvoie ;
 *   #/moi/guides   guides PDF « pour: tous » + pas-à-pas selon le profil — pour tout le monde.
 *
 * Sources (Microsoft Graph, droits de la personne connectée, Files.ReadWrite.All déjà accordé) :
 *   <dossier commun>/Suivi informatique/suivi.json   contenu structuré (validé par suivi.js)
 *   <dossier commun>/Suivi informatique/Guides/*.pdf les documents (liens « Ouvrir » = webUrl, nouvel onglet)
 *   En repli : l'ancien emplacement <dossier commun>/Pilotage/pilotage.json (+ Pilotage/Guides).
 * Tout est inséré en TEXTE (fabrique EB.h) : jamais de HTML venu du fichier.
 * Réponses gardées en mémoire 1 minute (cache.js), puis rafraîchies en arrière-plan.
 */
(function () {
  "use strict";

  var EB = window.EB, G = window.EBGraph, C = window.EBCache, P = window.EBSuivi;
  var X = function () { return window.EBConnecte; };
  var h = EB.h, icone = EB.icone, emoji = EB.emoji;
  var CLE = "suivi:contenu";
  /** Réglages (config.js → suivi), avec valeurs par défaut. */
  function reglage() {
    var s = (self.EB_CONFIG && self.EB_CONFIG.suivi) || {};
    return { libelle: s.libelle || "Suivi informatique", tuile: s.tuile || "Ce que Damien a fait pour le Château",
      dossier: s.dossier || "Suivi informatique", fichier: s.fichier || "suivi.json", guides: s.guides || "Guides",
      ancien: s.ancien && s.ancien.dossier && s.ancien.fichier ? s.ancien : null };
  }
  function messageAbsent() { return "Le dossier " + reglage().dossier + " n'est pas encore en place — Damien doit le déposer dans les documents de l'équipe."; }

  /* ------------------------------------------------------------------ */
  /* Lecture                                                             */
  /* ------------------------------------------------------------------ */
  function introuvable(e) { return e && (e.statut === 404 || e.codeGraph === "itemNotFound"); }
  /** Lit <Commun>/<dossier>/<fichier> → { v, base } ; null si introuvable. */
  function lireJson(driveId, dossier, fichier) {
    var base = "/drives/" + driveId + "/root:/" + [X().nomCommun(), dossier].map(encodeURIComponent).join("/");
    return G.graph("GET", base + "/" + encodeURIComponent(fichier) + ":/content").then(function (v) { return { v: v, base: base }; },
      function (e) { if (introuvable(e)) return null; throw e; });
  }
  /** { etat: "ok" | "absent" | "illisible", donnees, ignores, fichiers }. Nouvel emplacement, puis l'ancien en repli. */
  function charger() {
    var R = reglage();
    return X().contexte().then(function (c) {
      if (!c || !c.drive) return { etat: "absent" };
      return lireJson(c.drive.id, R.dossier, R.fichier).then(function (j) {
        return j || (R.ancien ? lireJson(c.drive.id, R.ancien.dossier, R.ancien.fichier) : null);
      }).then(function (j) {
        if (!j) return [null, []];
        var fichiers = G.graphTout(j.base + "/" + encodeURIComponent(R.guides) + ":/children?$select=name,webUrl,size,lastModifiedDateTime,file,folder&$top=500")
          .catch(function (e) { if (introuvable(e)) return []; throw e; });
        return Promise.all([j, fichiers]);
      }).then(function (r) {
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
    if (r.etat === "absent") return h("div", { class: "bandeau info", role: "status", "data-etat": "absent" }, icone("info"), h("span", null, messageAbsent()));
    if (r.etat === "illisible") return h("div", { class: "bandeau erreur", role: "alert", "data-etat": "illisible" }, icone("exemple"),
      h("span", null, h("strong", null, r.raison || "Le fichier de suivi n'est pas lisible."), "Damien doit le corriger dans les documents de l'équipe."));
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Morceaux d'écran                                                    */
  /* ------------------------------------------------------------------ */
  function lienPdf(url, attrs) { return Object.assign({ href: url, target: "_blank", rel: "noopener noreferrer" }, attrs || {}); }

  function frise(d, fichiers) {
    if (!d.historique.length) return h("p", { class: "rien" }, "Rien pour l'instant.");
    return h("ol", { class: "frise-suivi" }, d.historique.map(function (e) {
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

  /** Classe CSS d'un statut (couleurs : app.css → --statut-*). */
  var CLASSE_STATUT = { "À confirmer": "confirmer", "Proposition envoyée": "envoyee", "En cours": "cours", "Terminé": "termine" };
  /** v5.3.3 « Projets à venir » : une carte par projet (statut, résumé, prochaine étape, documents). */
  function projets(d, fichiers) {
    if (!d.projets.length) return h("p", { class: "rien" }, "Aucun projet en vue pour l'instant.");
    return h("div", { class: "grille-projets" }, d.projets.map(function (p) {
      var c = CLASSE_STATUT[p.statut] || "confirmer", docs = P.documentsDe(p, d, fichiers);
      return h("article", { class: "carte-projet " + c, "data-statut": p.statut },
        h("div", { class: "tete-projet" }, h("h3", null, p.titre), h("span", { class: "pastille-statut " + c }, p.statut)),
        p.resume ? h("p", null, p.resume) : null,
        p.prochaineEtape ? h("p", { class: "prochaine-etape" }, h("b", null, "Prochaine étape : "), p.prochaineEtape) : null,
        docs.length ? h("ul", { class: "docs-projet" }, docs.map(function (x) {
          return h("li", null, h("span", { class: "nom-doc" }, emoji("📄"), h("span", null, x.titre)),
            x.url ? h("a", lienPdf(x.url, { class: "btn petit", "aria-label": "Ouvrir « " + x.titre + " » (nouvel onglet)" }), icone("ouvrir"), "Ouvrir")
              : h("span", { class: "a-venir" }, "document à venir"));
        })) : null);
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
    return h("section", { class: "section section-suivi", id: id, "aria-labelledby": id + "-t" }, h("h2", { id: id + "-t", tabindex: "-1" }, titre), contenu);
  }

  /* ------------------------------------------------------------------ */
  /* #/suivi (#/pilotage y renvoie)                                     */
  /* ------------------------------------------------------------------ */
  var SECTIONS = [["p-historique", "Historique"], ["p-projets", "Projets à venir"], ["p-place", "Mis en place"], ["p-docs", "Documents"], ["p-contact", "Contacter"]];
  function ecranSuivi(app) {
    app.appendChild(EB.barre(reglage().libelle, EB.hub(), null, "Tout ce qui a été fait pour vous"));
    var zone = h("div", { class: "zone-suivi" });
    app.appendChild(zone);
    avecDonnees(zone, function (r) {
      var b = bandeauEtat(r);
      if (b) { zone.appendChild(b); return; }
      var d = r.donnees;
      zone.appendChild(h("p", { class: "aide-ecran" }, "Ce qui a été fait et échangé avec votre prestataire, du plus récent au plus ancien.",
        d.misAJour ? h("small", { class: "maj-suivi" }, "Mis à jour le " + P.dateLongue(d.misAJour)) : null));
      // « Projets à venir » : seulement si le fichier de suivi a une clé « projets ».
      var ancres = SECTIONS.filter(function (s) { return s[0] !== "p-projets" || d.projets; });
      zone.appendChild(h("nav", { class: "sommaire-suivi", "aria-label": "Aller à" }, ancres.map(function (s) {
        return h("button", { class: "btn petit secondaire", type: "button", onclick: function () {
          var t = document.getElementById(s[0] + "-t"); if (!t) return;
          t.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); t.focus({ preventScroll: true });
        } }, s[1]);
      })));
      zone.appendChild(section("p-historique", "Historique", frise(d, r.fichiers)));
      if (d.projets) zone.appendChild(section("p-projets", "Projets à venir", projets(d, r.fichiers)));
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
    app.appendChild(EB.barre("Modes d'emploi", { href: "#/moi", texte: "Moi" }));
    var zone = h("section", { class: "section section-suivi", "aria-labelledby": "g-docs" }, h("h2", { id: "g-docs" }, "Documents"));
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

  /** v5.5 : tuile « 🛠️ Suivi informatique » de l'écran Gérer (grande tuile, EB.grandesTuiles). */
  function tuileGestion() {
    return { href: "#/suivi", emoji: "🛠️", libelle: reglage().libelle, sous: reglage().tuile, action: "suivi" };
  }

  EB.ecran("suivi", ecranSuivi);
  window.EBSuiviEcrans = { guides: ecranMesGuides, tuile: tuileGestion, charger: charger, reglage: reglage };
})();
