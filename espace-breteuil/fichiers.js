/*
 * Espace Breteuil — v4 : onglet « Fichiers » tout-en-un, avec les permissions DÉJÀ en place
 * (Files.ReadWrite.All, Sites.ReadWrite.All). Aucune permission nouvelle.
 *
 *   #/fichiers               un seul écran, 3 sections : Récents, Mes fichiers (OneDrive),
 *                            Dossier commun (SharePoint, avec les droits déjà en place)
 *   #/onedrive[/chemin…]     parcourir « Mes fichiers »
 *   (#/commun reste l'écran détaillé du dossier commun, connecte.js)
 *
 * Fonctions : ouvrir dans Office (ms-word:, ms-excel:, ms-powerpoint:) ou sur le web, créer un
 * dossier, téléverser un fichier (graph.js → televerser), copier un lien de partage INTERNE
 * (createLink, type « view », portée « organization » : seules les personnes du Château l'ouvrent).
 *
 *   GET  /me/drive/recent                          Récents
 *   GET  /me/drive  ·  /me/drive/root[:/chemin:]/children
 *   POST /drives/<d>/items/<id>/createLink { type: "view", scope: "organization" }
 */
(function () {
  "use strict";
  var EB = window.EB, G = window.EBGraph, C = window.EBCache, X = function () { return window.EBConnecte; };
  if (!EB || !G) return;
  var h = EB.h, icone = EB.icone, emoji = EB.emoji;
  var gen = 0;

  var OFFICE = { doc: "ms-word", docx: "ms-word", dotx: "ms-word", rtf: "ms-word", xls: "ms-excel", xlsx: "ms-excel", xlsm: "ms-excel", csv: "ms-excel",
    ppt: "ms-powerpoint", pptx: "ms-powerpoint" };
  var NOM_APPLI = { "ms-word": "Word", "ms-excel": "Excel", "ms-powerpoint": "PowerPoint" };
  function extension(nom) { return String(nom || "").split(".").pop().toLowerCase(); }
  function emojiFichier(nom) {
    return { pdf: "📕", doc: "📝", docx: "📝", xls: "📊", xlsx: "📊", csv: "📊", ppt: "📽️", pptx: "📽️", jpg: "🖼️", jpeg: "🖼️", png: "🖼️", heic: "🖼️", mp4: "🎬", zip: "🗜️" }[extension(nom)] || "📄";
  }
  /** Adresse « ouvrir dans l'appli Office » (schéma officiel ofe|u|), ou null. */
  function lienOffice(nom, webUrl) { var s = OFFICE[extension(nom)]; return s && webUrl ? s + ":ofe|u|" + webUrl : null; }

  /** Référence { driveId, id, nom, webUrl, dossier } pour un élément Graph (y compris « récents »). */
  function ref(item) {
    var r = item.remoteItem || {};
    return { driveId: (r.parentReference && r.parentReference.driveId) || (item.parentReference && item.parentReference.driveId),
      id: r.id || item.id, nom: item.name || r.name, webUrl: item.webUrl || r.webUrl, dossier: !!(item.folder || r.folder) };
  }

  function copierLien(x) {
    EB.toast("Création du lien…");
    return G.graph("POST", "/drives/" + encodeURIComponent(x.driveId) + "/items/" + encodeURIComponent(x.id) + "/createLink", { type: "view", scope: "organization" }).then(function (r) {
      var url = r && r.link && r.link.webUrl;
      if (!url) throw new Error("Microsoft n'a pas renvoyé de lien.");
      function ok() { EB.toast("Lien copié : seules les personnes du Château pourront l'ouvrir."); }
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(url).then(ok, function () { montrerLien(url); });
      montrerLien(url);
    }).catch(X().afficherErreur);
  }
  function montrerLien(url) {
    var d = EB.dialogue();
    var champ = h("input", { class: "champ", type: "text", readonly: "readonly", value: url, "aria-label": "Lien de partage" });
    var ok = h("button", { class: "btn large", type: "button", onclick: EB.fermerDialogue }, "Fermer");
    d.appendChild(h("div", { class: "contenu" }, h("h2", { id: "detail-titre" }, "Lien de partage"), h("p", { class: "phrase" }, "Sélectionnez le lien et copiez-le."), champ, ok));
    EB.ouvrirDialogue(d, champ); champ.select();
  }

  /** Menu d'un fichier : Office, web, actions en plus (x.extras), lien interne (et épingler un dossier). */
  function menu(x) {
    var office = !x.dossier && lienOffice(x.nom, x.webUrl);
    var choix = [
      office ? { valeur: "office", emoji: "🖥️", titre: "Ouvrir dans " + NOM_APPLI[office.split(":")[0]], sous: "Avec l'appli Office de cet appareil" } : null,
      x.webUrl ? { valeur: "web", emoji: "🌐", titre: "Ouvrir sur le web", sous: "Dans le navigateur (Office en ligne)" } : null,
    ].concat(x.extras || []).concat([
      { valeur: "lien", emoji: "🔗", titre: "Copier un lien de partage", sous: "Interne : seules les personnes du Château l'ouvrent" },
      x.dossier && window.EBEpingles ? { valeur: "epingler", emoji: "📌", titre: "Épingler sur l'accueil", sous: "Un raccourci en haut du Planning" } : null,
    ]).filter(Boolean);
    EB.choisir("« " + x.nom + " »", choix).then(function (v) {
      var extra = (x.extras || []).filter(function (e) { return e.valeur === v; })[0];
      if (extra) return extra.action();
      if (v === "office") location.href = office;
      else if (v === "web") window.open(x.webUrl, "_blank", "noopener");
      else if (v === "lien") copierLien(x);
      else if (v === "epingler") window.EBEpingles.ajouter({ type: "dossier", titre: x.nom, url: x.hash || x.webUrl });
    });
  }
  /** Ligne d'un fichier (ou dossier) : toucher = menu d'actions. */
  function ligne(item, opts) {
    var x = ref(item); opts = opts || {};
    if (opts.hash) x.hash = opts.hash;
    if (opts.extras) x.extras = opts.extras; // actions en plus (dossier commun : Qui a accès ?, Déplacer vers…)
    return h("button", { class: "fichier", type: "button", "data-fichier": x.nom, onclick: function () { if (x.dossier && opts.hash) location.hash = opts.hash; else menu(x); } },
      emoji(x.dossier ? "📁" : emojiFichier(x.nom)), h("span", null, x.nom, opts.sous ? h("small", null, opts.sous) : null),
      h("span", { class: "fleche", "aria-hidden": "true" }, x.dossier && opts.hash ? "›" : "⋯"));
  }

  /* ---------------- Téléverser et créer ---------------- */
  /** chemin(nom) → « /drives/<d>/root:/a/b/nom ». apres() une fois fini. */
  function televerser(ou, chemin, apres) {
    var input = h("input", { type: "file", multiple: true, class: "sr", "aria-hidden": "true", tabindex: "-1" });
    document.body.appendChild(input);
    input.addEventListener("change", function () {
      var l = Array.prototype.slice.call(input.files || []);
      input.remove();
      if (!l.length) return;
      EB.confirmer({ emoji: "⬆️", titre: "Téléverser " + (l.length > 1 ? l.length + " fichiers" : "« " + l[0].name + " »") + " ?", deuxEtapes: false,
        phrase: "Dans " + ou + ". Un fichier du même nom n'est jamais écrasé : le nouveau est renommé.", bouton: "Oui, téléverser" }).then(function (ok) {
        if (!ok) return;
        var suite = Promise.resolve(), n = 0;
        l.forEach(function (f) {
          suite = suite.then(function () {
            return G.televerser(chemin(f.name), f, function (p) { EB.toast("Téléversement : « " + f.name + " » " + Math.round(p * 100) + " %"); }).then(function () { n++; });
          });
        });
        return suite.then(function () {
          X().noter("Fichier téléversé", (l.length > 1 ? l.length + " fichiers" : l[0].name) + " → " + ou);
          C.oublier("fichiers:*");
          EB.toast(n > 1 ? n + " fichiers téléversés." : "Fichier téléversé.");
          if (apres) apres();
        });
      }).catch(X().afficherErreur);
    });
    input.click();
  }
  function nouveauDossier(ou, cheminEnfants, apres) {
    X().demanderNom("Nouveau dossier", "Il sera créé dans " + ou + ".", "", "Continuer").then(function (nom) {
      if (!nom) return;
      return EB.confirmer({ emoji: "📁", titre: "Créer « " + nom + " » ?", phrase: "Un nouveau dossier « " + nom + " » sera créé dans " + ou + ".",
        consequence: "Il aura les mêmes accès que le dossier où il est rangé.", bouton: "Oui, créer le dossier" }).then(function (ok) {
        if (!ok) return;
        return G.graph("POST", cheminEnfants, { name: nom, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }).then(function () {
          X().noter("Dossier créé", nom + " → " + ou);
          C.oublier("fichiers:*");
          EB.toast("Dossier « " + nom + " » créé.");
          if (apres) apres();
        });
      });
    }).catch(X().afficherErreur);
  }

  /* ---------------- Données ---------------- */
  function monDrive() { return C.obtenir("fichiers:drive", function () { return G.graph("GET", "/me/drive?$select=id,webUrl"); }, { ttl: 3600000 }); }
  function enfantsMoi(segs) {
    var chemin = segs.length ? "/me/drive/root:/" + segs.map(encodeURIComponent).join("/") + ":/children" : "/me/drive/root/children";
    return G.graphTout(chemin + "?$select=id,name,folder,file,webUrl,parentReference,lastModifiedDateTime&$top=200").then(trier);
  }
  function trier(l) {
    return l.slice().sort(function (a, b) { return (b.folder ? 1 : 0) - (a.folder ? 1 : 0) || String(a.name).localeCompare(String(b.name), "fr"); });
  }
  function hashMoi(segs) { return "#/onedrive" + (segs.length ? "/" + segs.map(encodeURIComponent).join("/") : ""); }
  function quand(iso) { var t = Date.parse(iso); return isNaN(t) ? "" : EB.fmt(t, { day: "numeric", month: "short" }); }

  /** Section qui s'affiche avec le dernier état connu puis se met à jour toute seule. */
  function section(titre, id, actions) {
    var corps = h("div", null, EB.squelette(3));
    var el = h("section", { class: "section section-fichiers", "aria-labelledby": id }, h("div", { class: "entete-section" }, h("h2", { id: id }, titre), actions || null), corps);
    return { el: el, corps: corps };
  }
  function remplir(g, s, cle, chargeur, dessiner, ttl) {
    function d(v) { if (g === gen && document.body.contains(s.corps)) { s.corps.textContent = ""; dessiner(v); } }
    C.obtenir(cle, chargeur, { ttl: ttl || 30000, surMaj: d }).then(d, function (e) {
      if (g !== gen || !document.body.contains(s.corps)) return;
      s.corps.textContent = ""; s.corps.appendChild(X().blocErreur(e));
    });
  }
  function petitBouton(texte, ic, action, fn) { return h("button", { class: "btn petit secondaire", type: "button", "data-action": action, onclick: fn }, icone(ic), texte); }

  /* ---------------- #/fichiers ---------------- */
  function ecranFichiers(app) {
    var g = ++gen;
    app.appendChild(EB.barre("Fichiers", null));
    var A = window.EBAcces;
    var alerte = h("div", { class: "zone-alerte" });
    app.appendChild(alerte);
    function dessinerAlerte() {
      alerte.textContent = "";
      var site = A && A.sonde("site"), commun = A && A.sonde("commun");
      var pb = site && site.etat === "erreur" ? site : commun && commun.etat === "erreur" ? commun : null;
      if (pb) alerte.appendChild(h("div", { class: "bandeau erreur", role: "alert" }, icone("exemple"), h("div", null, h("strong", null, pb.message),
        h("span", null, pb === commun ? "Vérifiez qu'il est bien à la racine de la bibliothèque Documents (ou corrigez « dossierCommun » dans config.js)." : "Prévenez Damien : l'adresse du site est peut-être à corriger."))));
    }
    dessinerAlerte();
    if (A) A.surChangement(function () { if (document.body.contains(alerte)) dessinerAlerte(); });

    // 1. Récents
    var rec = section("Récents", "t-recents");
    app.appendChild(rec.el);
    remplir(g, rec, "fichiers:recents", function () { return G.graph("GET", "/me/drive/recent?$top=12").then(function (j) { return ((j && j.value) || []).filter(function (x) { return !(x.folder || (x.remoteItem && x.remoteItem.folder)); }).slice(0, 8); }); }, function (l) {
      if (!l.length) { rec.corps.appendChild(h("p", { class: "vide-doux" }, "Aucun fichier ouvert récemment.")); return; }
      rec.corps.appendChild(h("div", { class: "liste-fichiers" }, l.map(function (x) { return ligne(x, { sous: quand(x.lastModifiedDateTime || (x.remoteItem && x.remoteItem.lastModifiedDateTime)) }); })));
    });

    // 2. Mes fichiers (OneDrive)
    var moi = section("Mes fichiers", "t-moi", h("span", { class: "acts-section" },
      petitBouton("Dossier", "plus", "dossier-moi", function () { nouveauDossier("« Mes fichiers »", "/me/drive/root/children", EB.rendre); }),
      petitBouton("Téléverser", "installer", "televerser-moi", function () { monDrive().then(function (d) { televerser("« Mes fichiers »", function (n) { return "/drives/" + d.id + "/root:/" + encodeURIComponent(n); }, EB.rendre); }).catch(X().afficherErreur); })));
    app.appendChild(moi.el);
    remplir(g, moi, "fichiers:moi:", function () { return enfantsMoi([]); }, function (l) {
      if (!l.length) { moi.corps.appendChild(h("p", { class: "vide-doux" }, "Votre OneDrive est vide.")); return; }
      moi.corps.appendChild(h("div", { class: "liste-fichiers" }, l.slice(0, 6).map(function (x) { return ligne(x, x.folder ? { hash: hashMoi([x.name]) } : null); })));
      moi.corps.appendChild(h("a", { class: "lien-plus", href: "#/onedrive" }, "Tous mes fichiers (" + l.length + ") ›"));
    }, 60000);

    // 3. Dossier commun (SharePoint)
    var nom = X().nomCommun();
    var droits = X().peutGererDroits();
    var com = section("Dossier commun", "t-commun", h("span", { class: "acts-section" },
      droits ? h("a", { class: "btn petit secondaire", href: "#/acces/" + encodeURIComponent(nom) }, icone("cadenas"), "Qui a accès") : null));
    app.appendChild(com.el);
    X().contexte().then(function (c) {
      if (!c.commun) { com.corps.textContent = ""; com.corps.appendChild(h("p", { class: "vide-doux" }, "Le dossier commun est introuvable.")); return; }
      remplir(g, com, "enfants:" + nom, function () { return X().chargerEnfants(c, [nom]); }, function (l) {
        var dossiers = trier(l).filter(function (x) { return x.folder; });
        com.corps.appendChild(dossiers.length ? EB.tuiles(dossiers.slice(0, 8).map(function (d) {
          return { href: X().hashChemin("commun", [nom, d.name]), icone: "dossier", libelle: d.name, aide: "Ouvrir le dossier " + d.name };
        })) : h("p", { class: "vide-doux" }, "Ce dossier est vide."));
        com.corps.appendChild(h("a", { class: "lien-plus", href: "#/commun" }, "Ouvrir le dossier commun (créer, téléverser, ranger) ›"));
      });
    }).catch(function (e) { if (g === gen) { com.corps.textContent = ""; com.corps.appendChild(X().blocErreur(e)); } });
    app.appendChild(h("p", { class: "lien-discret" }, h("a", { href: "#/journal" }, "Ce que j'ai fait depuis cet appareil")));
  }

  /* ---------------- #/onedrive ---------------- */
  function ecranOneDrive(app, chemin) {
    var g = ++gen;
    var segs = chemin.slice(1).filter(Boolean);
    var titre = segs.length ? segs[segs.length - 1] : "Mes fichiers";
    app.appendChild(EB.barre(titre, segs.length ? { href: hashMoi(segs.slice(0, -1)), texte: "Retour" } : { href: "#/fichiers", texte: "Fichiers" }));
    var ou = "« " + titre + " »";
    var enfants = segs.length ? "/me/drive/root:/" + segs.map(encodeURIComponent).join("/") + ":/children" : "/me/drive/root/children";
    app.appendChild(h("div", { class: "actions" },
      h("button", { class: "btn", type: "button", onclick: function () { nouveauDossier(ou, enfants, EB.rendre); } }, icone("plus"), "Nouveau dossier"),
      h("button", { class: "btn secondaire", type: "button", onclick: function () {
        monDrive().then(function (d) { televerser(ou, function (n) { return "/drives/" + d.id + "/root:/" + segs.concat([n]).map(encodeURIComponent).join("/"); }, EB.rendre); }).catch(X().afficherErreur);
      } }, icone("installer"), "Téléverser")));
    var s = { corps: h("div", null, EB.squelette(4)) };
    app.appendChild(s.corps);
    remplir(g, s, "fichiers:moi:" + segs.join("/"), function () { return enfantsMoi(segs); }, function (l) {
      if (!l.length) { s.corps.appendChild(h("p", { class: "vide" }, "Ce dossier est vide.")); return; }
      s.corps.appendChild(h("div", { class: "liste-fichiers" }, l.map(function (x) { return ligne(x, x.folder ? { hash: hashMoi(segs.concat([x.name])) } : null); })));
    });
  }

  EB.ecran("fichiers", ecranFichiers);
  EB.ecran("onedrive", ecranOneDrive);
  window.EBFichiers = { ligne: ligne, menu: menu, televerser: televerser, copierLien: copierLien, ref: ref, lienOffice: lienOffice };
})();
