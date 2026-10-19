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
    d.appendChild(h("div", { class: "contenu" }, h("h2", { id: "detail-titre" }, "Lien du document"), h("p", { class: "phrase" }, "Sélectionnez le lien et copiez-le."), champ, ok));
    EB.ouvrirDialogue(d, champ); champ.select();
  }

  /** Menu d'un fichier : Office, web, actions en plus (x.extras), lien interne (et épingler un dossier). */
  function menu(x) {
    var office = !x.dossier && lienOffice(x.nom, x.webUrl);
    var choix = [
      office ? { valeur: "office", emoji: "🖥️", titre: "Ouvrir dans " + NOM_APPLI[office.split(":")[0]], sous: "Avec l'application installée" } : null,
      x.webUrl ? { valeur: "web", emoji: "🌐", titre: "Ouvrir dans le navigateur", sous: "Sans rien installer" } : null,
    ].concat(x.extras || []).concat([
      { valeur: "lien", emoji: "🔗", titre: "Copier un lien", sous: "Pour les personnes du Château" },
      x.dossier && window.EBEpingles ? { valeur: "epingler", emoji: "📌", titre: "Épingler sur l'accueil", sous: "Un raccourci sur l'accueil" } : null,
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
      EB.confirmer({ emoji: "⬆️", titre: "Ajouter " + (l.length > 1 ? l.length + " documents" : "« " + l[0].name + " »") + " ?", deuxEtapes: false,
        phrase: "Dans " + ou + ". Un document du même nom n'est jamais écrasé : le nouveau est renommé.", bouton: "Oui, ajouter" }).then(function (ok) {
        if (!ok) return;
        var suite = Promise.resolve(), n = 0;
        l.forEach(function (f) {
          suite = suite.then(function () {
            return G.televerser(chemin(f.name), f, function (p) { EB.toast("Envoi : « " + f.name + " » " + Math.round(p * 100) + " %"); }).then(function () { n++; });
          });
        });
        return suite.then(function () {
          X().noter("Document ajouté", (l.length > 1 ? l.length + " fichiers" : l[0].name) + " → " + ou);
          C.oublier("fichiers:*");
          EB.toast(n > 1 ? n + " documents ajoutés." : "Document ajouté.");
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
        consequence: "Les mêmes personnes pourront l'ouvrir que pour le dossier où il est rangé.", bouton: "Oui, créer le dossier" }).then(function (ok) {
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
  /* ---------------- #/fichiers (onglet « Documents ») ---------------- */
  function ecranFichiers(app) {
    var g = ++gen;
    app.appendChild(EB.barre("Documents", null));
    var A = window.EBAcces;
    var alerte = h("div", { class: "zone-alerte" });
    app.appendChild(alerte);
    function dessinerAlerte() {
      alerte.textContent = "";
      var site = A && A.sonde("site"), commun = A && A.sonde("commun");
      var pb = site && site.etat === "erreur" ? site : commun && commun.etat === "erreur" ? commun : null;
      if (pb) alerte.appendChild(h("div", { class: "bandeau erreur", role: "alert" }, icone("exemple"), h("div", null,
        h("strong", null, pb === commun ? "Les documents de l'équipe sont introuvables." : pb.message), h("span", null, "Prévenez Damien : il doit vérifier l'emplacement du dossier."))));
    }
    dessinerAlerte();
    if (A) A.surChangement(function () { if (document.body.contains(alerte)) dessinerAlerte(); });

    // 1. Documents de l'équipe : une grande tuile évidente, puis les dossiers.
    var nom = X().nomCommun();
    var com = section(EB.avecTech("Documents de l'équipe", "SharePoint"), "t-commun");
    com.el.insertBefore(EB.grandesTuiles([{ href: "#/commun", emoji: "📁", libelle: "Documents de l'équipe", sous: "Ouvrir le dossier partagé du Château", action: "ouvrir-commun" }]), com.corps);
    app.appendChild(com.el);
    X().contexte().then(function (c) {
      if (!c.commun) { com.corps.textContent = ""; return; }
      remplir(g, com, "enfants:" + nom, function () { return X().chargerEnfants(c, [nom]); }, function (l) {
        var dossiers = trier(l).filter(function (x) { return x.folder; });
        if (dossiers.length) com.corps.appendChild(EB.tuiles(dossiers.slice(0, 8).map(function (d) {
          return { href: X().hashChemin("commun", [nom, d.name]), icone: "dossier", libelle: d.name, aide: "Ouvrir le dossier " + d.name };
        })));
      });
    }).catch(function (e) { if (g === gen) { com.corps.textContent = ""; com.corps.appendChild(X().blocErreur(e)); } });

    // 2. Ouverts récemment
    var rec = section("Ouverts récemment", "t-recents");
    rec.el.setAttribute("data-tuto", "recents");
    app.appendChild(rec.el);
    remplir(g, rec, "fichiers:recents", function () { return G.graph("GET", "/me/drive/recent?$top=12").then(function (j) { return ((j && j.value) || []).filter(function (x) { return !(x.folder || (x.remoteItem && x.remoteItem.folder)); }).slice(0, 8); }); }, function (l) {
      if (!l.length) { rec.corps.appendChild(h("p", { class: "vide-doux" }, "Aucun document ouvert récemment.")); return; }
      rec.corps.appendChild(h("div", { class: "liste-fichiers" }, l.map(function (x) { return ligne(x, { sous: quand(x.lastModifiedDateTime || (x.remoteItem && x.remoteItem.lastModifiedDateTime)) }); })));
    });

    // 3. Mes documents (OneDrive)
    var moi = section(EB.avecTech("Mes documents", "OneDrive"), "t-moi");
    moi.el.insertBefore(EB.boutonsCarres([
      { texte: "Ajouter un document", icone: "installer", action: "televerser-moi", onclick: function () { monDrive().then(function (d) { televerser("« Mes documents »", function (n) { return "/drives/" + d.id + "/root:/" + encodeURIComponent(n); }, EB.rendre); }).catch(X().afficherErreur); } },
      { texte: "Créer un dossier", icone: "plus", action: "dossier-moi", onclick: function () { nouveauDossier("« Mes documents »", "/me/drive/root/children", EB.rendre); } },
    ]), moi.corps);
    app.appendChild(moi.el);
    remplir(g, moi, "fichiers:moi:", function () { return enfantsMoi([]); }, function (l) {
      if (!l.length) { moi.corps.appendChild(h("p", { class: "vide-doux" }, "Vous n'avez encore aucun document personnel.")); return; }
      moi.corps.appendChild(h("div", { class: "liste-fichiers" }, l.slice(0, 6).map(function (x) { return ligne(x, x.folder ? { hash: hashMoi([x.name]) } : null); })));
      moi.corps.appendChild(EB.grandesTuiles([{ href: "#/onedrive", emoji: "👤", libelle: "Voir tous mes documents (" + l.length + ")", sous: "Pour moi seulement", action: "tous-mes-documents" }]));
    }, 60000);

    app.appendChild(h("div", { class: "actions-liste pied-actions" }, EB.action("#/journal", "🕘", "Mes dernières actions", "Ce que j'ai changé depuis cet appareil")));
  }

  /* ---------------- #/onedrive ---------------- */
  function ecranOneDrive(app, chemin) {
    var g = ++gen;
    var segs = chemin.slice(1).filter(Boolean);
    var titre = segs.length ? segs[segs.length - 1] : "Mes documents";
    app.appendChild(EB.barre(titre, segs.length ? { href: hashMoi(segs.slice(0, -1)), texte: "Retour" } : { href: "#/fichiers", texte: "Documents" }, null, segs.length ? null : "Pour moi seulement (OneDrive)"));
    var ou = "« " + titre + " »";
    var enfants = segs.length ? "/me/drive/root:/" + segs.map(encodeURIComponent).join("/") + ":/children" : "/me/drive/root/children";
    app.appendChild(EB.boutonsCarres([
      { texte: "Ajouter un document", icone: "installer", action: "televerser-moi", onclick: function () {
        monDrive().then(function (d) { televerser(ou, function (n) { return "/drives/" + d.id + "/root:/" + segs.concat([n]).map(encodeURIComponent).join("/"); }, EB.rendre); }).catch(X().afficherErreur);
      } },
      { texte: "Créer un dossier", icone: "plus", action: "nouveau-dossier", onclick: function () { nouveauDossier(ou, enfants, EB.rendre); } },
    ]));
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
