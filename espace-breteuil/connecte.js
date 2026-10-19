/*
 * Espace Breteuil — écrans CONNECTÉS (vraies données Microsoft, droits de la personne connectée).
 *
 *   (v4 : l'onglet est « Fichiers », fichiers.js ; #/dossiers y renvoie)
 *   #/commun[/chemin…]        dossier commun : grosses tuiles, fil d'Ariane, créer, renommer, déplacer
 *   #/acces/chemin…           qui a accès (bibliothèque : #/acces/~racine) + gérer les accès
 *   #/restreindre/chemin…     « Retirer certaines personnes… » (cocher qui garde l'accès)
 *   #/reserver/chemin…        « Réserver à certaines personnes » (seules les personnes choisies)
 *   #/personnes[/id]          personnes du Château, « Ce que je peux utiliser »
 *   #/licences-reel           les 2 licences expliquées, combien chacune en a
 *   #/organisation            « Comprendre l'organisation » (réel si connecté, sinon exemple)
 *   #/journal                 ce qui a été fait depuis ce téléphone
 *
 * Écritures possibles (toutes avec récapitulatif + confirmation en 2 étapes) :
 * créer / renommer / déplacer un dossier (Graph), et les droits d'un dossier
 * (REST SharePoint : breakroleinheritance, ensureuser + addroleassignment, retrait,
 * resetroleinheritance ; Graph « invite » pour une adresse extérieure).
 * Garde-fou : jamais de retrait de la personne connectée ni des propriétaires du site.
 *
 * v4 : réponses gardées en mémoire pour la session (cache.js) : chaque écran s'affiche
 * aussitôt avec le dernier état connu puis se met à jour sans redessiner tout l'écran ;
 * appels lancés en parallèle ; « Qui a accès ? » visible seulement avec le droit réel
 * ManagePermissions (acces.js).
 */
(function () {
  "use strict";

  var EB = window.EB, G = window.EBGraph, D = window.EBDroits, C = window.EBCache;
  var CFG = self.EB_CONFIG || {};
  var h = EB.h, icone = EB.icone, emoji = EB.emoji;
  var RACINE = "~racine";

  /* ------------------------------------------------------------------ */
  /* Contexte (chargé une fois par session)                              */
  /* ------------------------------------------------------------------ */
  var ctx = null, promesseCtx = null, generation = 0;
  var cachePhotos = {};

  function siteParts() {
    var u = new URL(CFG.sharepoint.site);
    return { hote: u.hostname, chemin: u.pathname.replace(/\/+$/, "") };
  }
  function nomCommun() { return (CFG.sharepoint && CFG.sharepoint.dossierCommun) || "Commun"; }

  /** Contexte SharePoint : chaîne Graph (site → Documents → liste, Commun) et REST en PARALLÈLE. */
  function contexte() {
    if (ctx) return Promise.resolve(ctx);
    if (promesseCtx) return promesseCtx;
    var s = siteParts(), c = {};
    var chaineGraph = G.graph("GET", "/sites/" + s.hote + ":" + s.chemin + "?$select=id,displayName,webUrl").then(function (site) {
      c.site = site;
      return G.graph("GET", "/sites/" + site.id + "/drive?$select=id,name,webUrl");
    }).then(function (drive) {
      c.drive = drive;
      return Promise.all([
        G.graph("GET", "/drives/" + drive.id + "/list?$select=id"),
        G.graph("GET", "/drives/" + drive.id + "/root:/" + encodeURIComponent(nomCommun()) + "?$select=id,name,webUrl,folder").catch(function () { return null; }),
      ]);
    });
    promesseCtx = Promise.all([
      chaineGraph,
      G.sp("GET", "/_api/web/currentuser?$select=Id,Email,LoginName,Title,IsSiteAdmin").catch(function () { return null; }),
      G.sp("GET", "/_api/web/associatedownergroup?$select=Id,Title").catch(function () { return null; }),
      G.sp("GET", "/_api/web/associatedownergroup/users?$select=Id,Email,LoginName,Title").catch(function () { return { value: [] }; }),
    ]).then(function (r) {
      c.listId = r[0][0].id;
      c.commun = r[0][1];
      c.moiSp = r[1];
      c.groupeProprietaires = r[2];
      c.proprietairesSp = (r[3] && r[3].value) || [];
      c.proprietaires = c.proprietairesSp.map(function (u) { return D.adresseDe(u); }).filter(Boolean);
      var compte = G.compte() || {};
      c.moi = (c.moiSp && D.adresseDe(c.moiSp)) || String(compte.username || "").toLowerCase();
      // Propriétaires réels : on déplie le groupe Microsoft 365 du site (sinon Pauline, propriétaire
      // via ce groupe, ne serait pas reconnue comme propriétaire).
      return deplierGroupe(c.proprietairesSp).catch(function () { return { personnes: [] }; }).then(function (res) {
        res.personnes.forEach(function (p) { var a = String(p.mail || "").toLowerCase(); if (a && c.proprietaires.indexOf(a) === -1) c.proprietaires.push(a); });
        c.proprietairesNoms = res.personnes.map(function (p) { return p.nom; });
        c.proprietairesPersonnes = res.personnes; // [{ nom, mail }] : suggestions de « Réserver à certaines personnes »
        c.estProprietaire = c.proprietaires.indexOf(c.moi) > -1 || (!!c.moiSp && c.proprietairesSp.some(function (u) { return u.Id === c.moiSp.Id; }));
        ctx = c;
        return c;
      });
    });
    promesseCtx.catch(function () { promesseCtx = null; });
    return promesseCtx;
  }
  function oublierContexte() { ctx = null; promesseCtx = null; }
  /** Données d'un écran : dernier état connu tout de suite, puis mise à jour de la zone seule. */
  function avecMaj(cle, chargeur, gen, zone, dessiner, ttl) {
    return C.obtenir(cle, chargeur, { ttl: ttl == null ? 30000 : ttl, surMaj: function (v) { if (toujoursLa(gen, zone)) dessiner(v, true); } })
      .then(function (v) { if (toujoursLa(gen, zone)) dessiner(v, false); return v; });
  }
  /** Droit réel de gérer les accès (ManagePermissions / propriétaire), d'après acces.js. */
  function peutGererDroits() {
    var r = window.EBAcces && window.EBAcces.resultat();
    return !!(r && r.droits.gererDroits);
  }
  /** v5.5 : boutons d'ajout (créer, ajouter, renommer, ranger) : cachés pour un Lecteur sûr. */
  function peutEditer() { return window.EBProfil.peutEditer(window.EBAcces && window.EBAcces.resultat()); }

  function garde(m) {
    return D.estProtege(m, { moi: ctx.moi, moiId: ctx.moiSp && ctx.moiSp.Id, groupeProprietairesId: ctx.groupeProprietaires && ctx.groupeProprietaires.Id, proprietaires: ctx.proprietaires });
  }

  /* Rôles SharePoint : 2 = Lecture (« Peut voir »), 3 = Collaboration (« Peut modifier »). */
  var rolesDef = {};
  function roleDef(niveau) {
    var type = niveau === "modifier" ? 3 : 2;
    if (rolesDef[type]) return Promise.resolve(rolesDef[type]);
    return G.sp("GET", "/_api/web/roledefinitions/getbytype(" + type + ")?$select=Id").then(function (r) { rolesDef[type] = r.Id; return r.Id; });
  }

  /* Utilisateurs du tenant + licences (lecture). */
  function utilisateurs() {
    return C.obtenir("annuaire:utilisateurs", chargerUtilisateurs, { ttl: 5 * 60000 });
  }
  function chargerUtilisateurs() {
    return Promise.all([
      G.graphTout("/users?$select=id,displayName,givenName,mail,userPrincipalName,userType,accountEnabled,assignedLicenses,jobTitle,department&$top=999"),
      G.graphTout("/subscribedSkus?$select=skuId,skuPartNumber,prepaidUnits,consumedUnits"),
    ]).then(function (r) {
      var skuNoms = {};
      r[1].forEach(function (s) { skuNoms[s.skuId] = s.skuPartNumber; });
      return usagesBoites(r[0]).then(function (comptes) {
        var boites = boitesConnues(), opts = { prestataires: CFG.prestataires || [] };
        var liste = comptes.map(function (u) {
          var p = D.profilDe(u, skuNoms, boites, opts);
          return Object.assign({}, u, { profil: p, licence: D.licenceDe(u, skuNoms), type: D.typeDe(u, optsType()), prenom: u.givenName || (u.displayName || "").split(" ")[0] || "?" });
        }).sort(function (a, b) { return String(a.displayName).localeCompare(String(b.displayName), "fr"); });
        return { liste: liste, skus: r[1], skuNoms: skuNoms };
      });
    });
  }
  /** Boîtes partagées connues : liste de config.js (« boitesPartagees ») + adresses de la démo. */
  function boitesConnues() {
    var b = (CFG.boitesPartagees || []).slice();
    try {
      var d = EB.demo().boites || [];
      d.forEach(function (x) { b.push(x.adresse); });
    } catch (e) {}
    return b;
  }
  /**
   * v5.5.1 : réglage Exchange « userPurpose » (shared = boîte partagée) de chaque compte qui a une
   * adresse mail — SEULEMENT si la permission MailboxSettings.Read (ou ReadWrite) figure déjà dans le
   * jeton : l'appli ne la demande pas (voir docs). Au premier refus (403…), on s'arrête : la liste
   * de config.js et l'ancien indice prennent le relais. Ne rejette jamais.
   */
  function usagesBoites(comptes) {
    return Promise.resolve().then(function () { return G.scopesAccordes ? G.scopesAccordes("graph") : null; }).then(function (scp) {
      if (!(scp || []).some(function (s) { return /^mailboxsettings\.read(write)?$/i.test(s); })) return comptes;
      var file = comptes.filter(function (u) { return u.mail && u.userType !== "Guest"; }), arret = false;
      function suivant() {
        var u = file.shift();
        if (!u || arret) return Promise.resolve();
        return G.graph("GET", "/users/" + encodeURIComponent(u.id) + "/mailboxSettings/userPurpose", undefined, { silencieux: true })
          .then(function (r) { if (r && r.value) u.userPurpose = r.value; }, function (e) { if (e && (e.statut === 403 || e.statut === 401)) arret = true; })
          .then(suivant);
      }
      return Promise.all([suivant(), suivant(), suivant(), suivant()]).then(function () { return comptes; });
    }).catch(function () { return comptes; });
  }
  function photo(id) {
    if (cachePhotos[id] !== undefined) return Promise.resolve(cachePhotos[id]);
    cachePhotos[id] = null;
    return G.graphPhoto("/users/" + encodeURIComponent(id) + "/photos/64x64/$value").then(function (u) { cachePhotos[id] = u; return u; });
  }

  /** Règle unique : toute personne sans adresse @breteuil.fr est « Externe ». */
  function optsType() { return { domainesInternes: CFG.domainesInternes || [] }; }

  /** Rôles d'annuaire activés et leurs membres (lecture, Directory.Read.All), gardés 5 min. */
  function rolesAnnuaire() {
    return C.obtenir("annuaire:roles", function () { return G.graphTout("/directoryRoles?$select=id,displayName,roleTemplateId&$expand=members($select=id,displayName,userPrincipalName,mail)"); }, { ttl: 5 * 60000 });
  }

  /* ------------------------------------------------------------------ */
  /* Journal local                                                       */
  /* ------------------------------------------------------------------ */
  function noter(action, cible) {
    // Une modification vient d'être faite : les listes gardées en mémoire sont à relire.
    C.oublier("enfants:*"); C.oublier("droits:*"); C.oublier("fichiers:*");
    var j = EB.lire("eb:journal", []);
    j.unshift({ quand: new Date().toISOString(), qui: (G.compte() || {}).username || "", action: action, cible: cible });
    if (j.length > 300) j.length = 300;
    EB.ecrire("eb:journal", j);
  }

  /* ------------------------------------------------------------------ */
  /* Outils d'affichage                                                  */
  /* ------------------------------------------------------------------ */
  function demarrerEcran() { return ++generation; }
  function toujoursLa(gen, el) { return gen === generation && document.body.contains(el); }
  /** Squelette pendant les appels Microsoft (plutôt qu'un simple « Chargement… »). */
  function chargement(n, forme) { return EB.squelette(n || 4, forme); }
  function blocErreur(e, reessayer) {
    return h("div", { class: "bandeau erreur", role: "alert" }, icone("exemple"), h("div", null,
      h("strong", null, (e && e.message) || "Une erreur est survenue."),
      e && e.action ? h("span", null, e.action) : null,
      e && e.detail ? h("small", { class: "detail-technique" }, e.detail) : null,
      e && (e.statut === 401 || e.cors) ? h("a", { class: "btn petit secondaire", href: "#/details" }, "Détails techniques") : null,
      reessayer ? h("div", { class: "actions" }, h("button", { class: "btn secondaire", type: "button", onclick: reessayer }, icone("actualiser"), "Réessayer")) : null));
  }
  /** Étiquette (« Externe » en gras) ; au toucher ou au survol, une phrase d'explication. */
  function etiquette(type) {
    var t = D.TYPES[type];
    if (!t || type === "interne" || type === "groupe") return null;
    if (!t.aide) return h("span", { class: "etiquette " + t.classe }, t.nom);
    function expliquerType(e) { e.preventDefault(); e.stopPropagation(); EB.toast(t.aide); }
    return h("span", { class: "etiquette " + t.classe, role: "button", tabindex: "0", title: t.aide, "aria-label": t.nom + " : " + t.aide,
      onclick: expliquerType, onkeydown: function (e) { if (e.key === "Enter" || e.key === " ") expliquerType(e); } }, t.nom);
  }
  function pastilleNiveau(n, total) {
    var x = D.NIVEAUX[n];
    return h("span", { class: "niveau " + n }, emoji(x.emoji), total ? "Peut tout gérer" : x.nom);
  }
  function avatarPersonne(u, cls) {
    var el = h("span", { class: "avatar " + (cls || ""), style: { background: couleurDe(u.id || u.Id || u.displayName || u.Title) }, "aria-hidden": "true" },
      EB.initiales(u.prenom || u.givenName || u.displayName || u.Title || "?"));
    var id = u.id;
    if (id) photo(id).then(function (url) { if (url) { el.textContent = ""; el.appendChild(h("img", { src: url, alt: "" })); } });
    return el;
  }
  /** Avatar d'une boîte partagée : sa photo de profil s'il y en a une (ex. « FetP »), sinon l'enveloppe. */
  function avatarBoite(u, cls) {
    var el = h("span", { class: "avatar groupe " + (cls || ""), "aria-hidden": "true" }, emoji("📬"));
    if (u && u.id) photo(u.id).then(function (url) { if (url) { el.textContent = ""; el.classList.remove("groupe"); el.appendChild(h("img", { src: url, alt: "" })); } });
    return el;
  }
  var PALETTE = ["#8A4C45", "#2F6B5A", "#6C3832", "#6E4F86", "#7A5710", "#4F6B3A", "#3F6683", "#8A2B3B"];
  function couleurDe(s) { var n = 0; String(s || "").split("").forEach(function (c) { n = (n * 31 + c.charCodeAt(0)) >>> 0; }); return PALETTE[n % PALETTE.length]; }

  /** Écran réservé : connexion Microsoft nécessaire. Renvoie vrai si connecté. */
  function exigerConnexion(app, titre, retour) {
    if (G.estConnecte()) return true;
    app.appendChild(EB.barre(titre, retour || { href: "#/fichiers", texte: "Documents" }));
    app.appendChild(panneauConnexion());
    return false;
  }
  function panneauConnexion() {
    if (!G.estConfigure()) {
      return h("div", { class: "boite centre" }, emoji("🔌", "grand"),
        h("h2", null, "Connexion pas encore prête"),
        h("p", null, "Damien doit d'abord finir le réglage chez Microsoft (une seule fois)."));
    }
    return h("div", { class: "boite centre microsoft" }, emoji("🔐", "grand"),
      h("h2", null, "Connectez-vous"),
      h("p", null, "Avec votre adresse du Château (par exemple pdebreteuil@breteuil.fr). L'appli agit uniquement avec vos droits Microsoft."),
      G.erreur() ? h("p", { class: "erreur" }, G.erreur()) : null,
      h("button", { class: "btn large", type: "button", onclick: function () { G.connecter(); } }, emoji("🔐"), "Se connecter avec Microsoft"),
      h("p", { class: "petit" }, "Vous restez connecté tant que l'appli (ou l'onglet) reste ouverte. En la fermant, tout est effacé de ce téléphone."));
  }

  function chargerEnfants(c, segs) {
    return G.graphTout(urlItem(c.drive.id, segs, "children") + "?$select=id,name,folder,file,webUrl,size,lastModifiedDateTime&$top=500");
  }
  function oublier() { ctx = null; promesseCtx = null; cachePhotos = {}; C.oublier(); }

  /* ------------------------------------------------------------------ */
  /* #/commun : le dossier commun                                        */
  /* ------------------------------------------------------------------ */
  function segments(chemin) { return chemin.slice(1).filter(function (x) { return x !== ""; }); }
  function hashChemin(prefixe, segs) { return "#/" + prefixe + "/" + (segs.length ? segs.map(encodeURIComponent).join("/") : RACINE); }
  function urlItem(drive, segs, suite) {
    return segs.length ? "/drives/" + drive + "/root:/" + segs.map(encodeURIComponent).join("/") + (suite ? ":/" + suite : "")
      : "/drives/" + drive + "/root" + (suite ? "/" + suite : "");
  }
  function lireSegs(chemin) {
    var s = segments(chemin);
    if (!s.length) return null; // = dossier Commun par défaut
    return s[0] === RACINE ? [] : s;
  }

  /** v5.5 : fil d'Ariane sur UNE ligne discrète (petit texte, segments cliquables sans aspect bouton). */
  function filAriane(segs, prefixe) {
    var f = h("nav", { class: "ariane", "aria-label": "Où suis-je ?" });
    var depuisCommun = segs[0] === nomCommun();
    var parts = depuisCommun ? [{ nom: "Documents de l'équipe", segs: [nomCommun()] }] : [{ nom: "Tout en haut", segs: [] }];
    segs.forEach(function (x, i) { if (!(depuisCommun && i === 0)) parts.push({ nom: x, segs: segs.slice(0, i + 1) }); });
    if (parts.length < 2) return null; // tout en haut : le titre suffit, pas de fil qui le répète
    parts.forEach(function (p, i) {
      if (i) f.appendChild(h("span", { class: "sep", "aria-hidden": "true" }, "›"));
      f.appendChild(i === parts.length - 1 ? h("span", { "aria-current": "page" }, p.nom) : h("a", { href: hashChemin(prefixe, p.segs) }, p.nom));
    });
    return f;
  }

  function ecranCommun(app, chemin) {
    if (!exigerConnexion(app, "Documents de l'équipe")) return;
    var segs = lireSegs(chemin);
    if (segs === null) { segs = [nomCommun()]; history.replaceState(null, "", hashChemin("commun", segs)); }
    var titre = segs.length === 1 && segs[0] === nomCommun() ? "Documents de l'équipe" : segs.length ? segs[segs.length - 1] : "Tout en haut";
    var gen = demarrerEcran();
    app.appendChild(EB.barre(titre, { href: segs.length > 1 ? hashChemin("commun", segs.slice(0, -1)) : "#/fichiers", texte: segs.length > 1 ? "Retour" : "Documents" }));
    var fil = filAriane(segs, "commun"); if (fil) app.appendChild(fil);
    var zone = h("div", null, chargement(4, "tuiles"));
    app.appendChild(zone);

    contexte().then(function (c) {
      return avecMaj("enfants:" + segs.join("/"), function () { return chargerEnfants(c, segs); }, gen, zone, function (enfants) { dessinerCommun({ c: c, enfants: enfants }); });
    }).catch(function (e) {
      if (!toujoursLa(gen, zone)) return;
      zone.textContent = "";
      zone.appendChild(blocErreur(e, EB.rendre));
      if (e.statut === 404 && segs.length === 1 && segs[0] === nomCommun()) {
        if (window.EBAcces) window.EBAcces.signaler("commun", "erreur", "Les documents de l'équipe sont introuvables.");
        zone.appendChild(h("p", { class: "aide-ecran" }, "Le dossier « " + nomCommun() + " » n'a pas été trouvé. Prévenez Damien."));
        zone.appendChild(h("a", { class: "btn", href: hashChemin("commun", []) }, "Voir tout en haut"));
      }
    });
    function dessinerCommun(r) {
      zone.textContent = "";
      var dossiers = r.enfants.filter(function (x) { return x.folder; }).sort(function (a, b) { return a.name.localeCompare(b.name, "fr"); });
      var fichiers = r.enfants.filter(function (x) { return x.file; }).sort(function (a, b) { return a.name.localeCompare(b.name, "fr"); });

      // v5.5 : une rangée de boutons de même taille ; ce que l'on n'a pas le droit de faire n'apparaît pas.
      var edit = peutEditer();
      zone.appendChild(EB.boutonsCarres([
        edit && window.EBFichiers ? { texte: "Ajouter un document", icone: "installer", action: "televerser-commun", onclick: function () {
          window.EBFichiers.televerser("« " + (segs[segs.length - 1] || "Tout en haut") + " »", function (n) { return "/drives/" + r.c.drive.id + "/root:/" + segs.concat([n]).map(encodeURIComponent).join("/"); }, EB.rendre);
        } } : null,
        edit ? { texte: "Créer un dossier", icone: "plus", action: "nouveau-dossier", onclick: function () { nouveauDossier(segs); } } : null,
        peutGererDroits() ? { texte: "Qui peut ouvrir ?", icone: "cadenas", action: "qui-peut-ouvrir", href: hashChemin("acces", segs) } : null,
      ]));
      if (!segs.length) zone.appendChild(h("p", { class: "aide-ecran" }, "Vous êtes tout en haut. Les documents de l'équipe sont dans « " + nomCommun() + " »."));

      if (!dossiers.length && !fichiers.length) zone.appendChild(h("p", { class: "vide" }, "Ce dossier est vide."));
      if (dossiers.length) zone.appendChild(h("div", { class: "grille dossiers" }, dossiers.map(function (d) {
        var segsD = segs.concat([d.name]);
        return h("div", { class: "tuile dossier" + (segsD.join("/") === nomCommun() ? " commun" : "") },
          h("span", { class: "pastille" }, emoji(segsD.join("/") === nomCommun() ? "🏰" : "📁")),
          h("a", { class: "tuile-lien", href: hashChemin("commun", segsD), "data-nom": d.name }, h("b", null, d.name)),
          h("span", { class: "sous" }, (d.folder.childCount || 0) + " élément" + ((d.folder.childCount || 0) > 1 ? "s" : "")),
          h("button", { class: "tuile-menu", type: "button", "aria-label": "Plus d'actions pour " + d.name, onclick: function () { menuDossier(d, segs, segsD); } }, "⋯"));
      })));
      if (fichiers.length) zone.appendChild(h("section", { class: "section" }, h("h2", null, "Documents"),
        h("div", { class: "liste-fichiers" }, fichiers.map(function (f) {
          return window.EBFichiers ? window.EBFichiers.ligne(Object.assign({ parentReference: { driveId: r.c.drive.id } }, f), { extras: actionsFichier(f, segs) })
            : h("a", EBlien(f.webUrl), emoji(emojiFichier(f.name)), h("span", null, f.name), icone("ouvrir"));
        }))));
      if (peutGererDroits()) marquerReserves(r.c, segs, zone);
    }
  }
  function EBlien(url) { return { href: url, target: "_blank", rel: "noopener noreferrer", class: "fichier" }; }
  function emojiFichier(nom) {
    var x = String(nom).split(".").pop().toLowerCase();
    return { pdf: "📕", doc: "📝", docx: "📝", xls: "📊", xlsx: "📊", csv: "📊", ppt: "📽️", pptx: "📽️", jpg: "🖼️", jpeg: "🖼️", png: "🖼️", heic: "🖼️", mp4: "🎬", zip: "🗜️" }[x] || "📄";
  }

  /**
   * Noms des dossiers et fichiers « réservés » (accès choisis à part) d'un dossier : UNE requête
   * SharePoint pour tout le dossier (pas une par élément). Au mieux : en cas d'échec, aucun badge.
   */
  function reservesDuDossier(c, segs) {
    return C.obtenir("enfants:reserve:" + segs.join("/"), function () {
      var racine = decodeURIComponent(new URL(c.drive.webUrl).pathname).replace(/\/+$/, "");
      var chemin = racine + (segs.length ? "/" + segs.join("/") : "");
      return G.sp("GET", "/_api/web/GetFolderByServerRelativePath(decodedurl='" + encodeURIComponent(chemin.replace(/'/g, "''")) + "')" +
        "?$select=Folders/Name,Folders/ListItemAllFields/HasUniqueRoleAssignments,Files/Name,Files/ListItemAllFields/HasUniqueRoleAssignments" +
        "&$expand=Folders/ListItemAllFields,Files/ListItemAllFields").then(function (r) {
        var noms = [];
        ((r && r.Folders) || []).concat((r && r.Files) || []).forEach(function (x) { if (x.ListItemAllFields && x.ListItemAllFields.HasUniqueRoleAssignments) noms.push(x.Name); });
        return noms;
      });
    }, { ttl: 60000 });
  }
  function badgeReserve() { return h("span", { class: "etiquette reserve", title: "Seules certaines personnes peuvent l'ouvrir" }, "🔒 Privé"); }
  function marquerReserves(c, segs, zone) {
    if (!c.drive || !c.drive.webUrl) return;
    reservesDuDossier(c, segs).then(function (noms) {
      if (!document.body.contains(zone)) return;
      noms.forEach(function (n) {
        zone.querySelectorAll(".tuile-lien[data-nom], .fichier[data-fichier]").forEach(function (el) {
          if ((el.getAttribute("data-nom") || el.getAttribute("data-fichier")) !== n || el.querySelector(".etiquette.reserve")) return;
          (el.classList.contains("fichier") ? el.querySelector("span:not(.emoji)") || el : el).appendChild(badgeReserve());
        });
      });
    }).catch(function () {});
  }
  /** Réservé d'après ce qui est DÉJÀ chargé (aucune requête) : vrai, faux, ou undefined si inconnu. */
  function reserveConnu(segsParent, nom) {
    var l = C.connu("enfants:reserve:" + segsParent.join("/"));
    return l ? l.indexOf(nom) > -1 : undefined;
  }

  /** Actions en plus pour un fichier du dossier commun (menu « ⋯ »). */
  function actionsFichier(f, segs) {
    return [
      peutGererDroits() ? { valeur: "acces", emoji: "🔐", titre: "Choisir qui peut l'ouvrir", sous: "Toute l'équipe ou certaines personnes", action: function () { location.hash = hashChemin("acces", segs.concat([f.name])); } } : null,
      peutEditer() ? { valeur: "deplacer", emoji: "📦", titre: "Ranger ailleurs", sous: "Dans un autre dossier", action: function () { deplacer(f, segs); } } : null,
    ].filter(Boolean);
  }

  /** Demande un nom dans une fenêtre simple. */
  function demanderNom(titre, phrase, valeur, bouton) {
    return new Promise(function (fin) {
      var d = EB.dialogue(), fini = false;
      function terminer(v) { if (fini) return; fini = true; EB.fermerDialogue(); fin(v); }
      d.oncancel = function () { terminer(null); };
      var champ = h("input", { class: "champ", type: "text", id: "nom", value: valeur || "", autocomplete: "off", maxlength: "120" });
      var err = h("p", { class: "erreur", role: "alert" });
      d.appendChild(h("form", { class: "contenu", onsubmit: function (e) {
        e.preventDefault();
        var m = D.nomDossierValide(champ.value);
        if (m) { err.textContent = m; return; }
        terminer(champ.value.trim());
      } },
        h("h2", { id: "detail-titre" }, titre), phrase ? h("p", { class: "phrase" }, phrase) : null,
        h("label", { for: "nom" }, "Nom du dossier"), champ, err,
        h("button", { class: "btn large", type: "submit" }, bouton || "Continuer"),
        h("button", { class: "btn secondaire large", type: "button", onclick: function () { terminer(null); } }, "Annuler")));
      EB.ouvrirDialogue(d, champ);
    });
  }

  function nouveauDossier(segs) {
    var ici = segs.length ? "« " + segs[segs.length - 1] + " »" : "tout en haut";
    var choixLieu = segs.length === 1 && segs[0] === nomCommun()
      ? EB.choisir("Où créer le dossier ?", [
        { valeur: "ici", emoji: "🏰", titre: "Dans « " + nomCommun() + " »", sous: "Avec les autres dossiers de l'équipe" },
        { valeur: "dessus", emoji: "⬆️", titre: "Tout en haut", sous: "À côté de « " + nomCommun() + " »" },
      ]) : Promise.resolve("ici");
    choixLieu.then(function (lieu) {
      if (!lieu) return;
      var cible = lieu === "dessus" ? [] : segs;
      var ou = lieu === "dessus" ? "tout en haut" : ici;
      return demanderNom("Nouveau dossier", "Il sera créé " + (lieu === "dessus" ? ou : "dans " + ou) + ".", "", "Continuer").then(function (nom) {
        if (!nom) return;
        return EB.confirmer({ emoji: "📁", titre: "Créer « " + nom + " » ?", phrase: "Un nouveau dossier « " + nom + " » sera créé " + (lieu === "dessus" ? ou : "dans " + ou) + ".",
          consequence: "Toutes les personnes qui peuvent ouvrir " + (lieu === "dessus" ? "le dossier tout en haut" : ou) + " le verront.", bouton: "Oui, créer le dossier" })
          .then(function (ok) {
            if (!ok) return;
            return contexte().then(function (c) {
              return G.graph("POST", urlItem(c.drive.id, cible, "children"), { name: nom, folder: {}, "@microsoft.graph.conflictBehavior": "fail" });
            }).then(function () {
              noter("Dossier créé", cible.concat([nom]).join(" / ") || nom);
              EB.toast("Dossier « " + nom + " » créé.");
              location.hash = hashChemin("commun", cible);
              EB.rendre();
            });
          });
      });
    }).catch(afficherErreur);
  }

  function menuDossier(d, segsParent, segsD) {
    var edit = peutEditer();
    EB.choisir("« " + d.name + " »", [
      { valeur: "ouvrir", emoji: "📂", titre: "Ouvrir" },
      peutGererDroits() ? { valeur: "acces", emoji: "🔐", titre: "Choisir qui peut l'ouvrir", sous: "Toute l'équipe ou certaines personnes" } : null,
      edit ? { valeur: "renommer", emoji: "✏️", titre: "Changer le nom" } : null,
      edit ? { valeur: "deplacer", emoji: "📦", titre: "Ranger ailleurs", sous: "Dans un autre dossier" } : null,
      { valeur: "lien", emoji: "🔗", titre: "Copier un lien", sous: "Pour les personnes du Château" },
      window.EBEpingles ? { valeur: "epingler", emoji: "📌", titre: "Épingler sur l'accueil", sous: "Un raccourci sur l'accueil" } : null,
    ].filter(Boolean)).then(function (v) {
      if (v === "ouvrir") location.hash = hashChemin("commun", segsD);
      else if (v === "acces") location.hash = hashChemin("acces", segsD);
      else if (v === "renommer") renommer(d, segsParent);
      else if (v === "deplacer") deplacer(d, segsParent);
      else if (v === "lien") contexte().then(function (c) { window.EBFichiers.copierLien({ driveId: c.drive.id, id: d.id, nom: d.name }); });
      else if (v === "epingler") window.EBEpingles.ajouter({ type: "dossier", titre: d.name, url: hashChemin("commun", segsD) });
    });
  }

  function renommer(d, segsParent) {
    if (segsParent.length === 0 && d.name === nomCommun()) { EB.toast("Le dossier « " + nomCommun() + " » ne se renomme pas depuis l'appli."); return; }
    demanderNom("Changer le nom de « " + d.name + " »", null, d.name, "Continuer").then(function (nom) {
      if (!nom || nom === d.name) return;
      return EB.confirmer({ emoji: "✏️", titre: "Changer le nom ?", phrase: "« " + d.name + " » s'appellera « " + nom + " ».",
        consequence: "Les liens déjà envoyés vers ce dossier peuvent ne plus marcher.", bouton: "Oui, changer le nom" }).then(function (ok) {
        if (!ok) return;
        return contexte().then(function (c) { return G.graph("PATCH", "/drives/" + c.drive.id + "/items/" + d.id, { name: nom }); })
          .then(function () { noter("Dossier renommé", d.name + " → " + nom); EB.toast("C'est renommé."); EB.rendre(); });
      });
    }).catch(afficherErreur);
  }

  /** Choisir un dossier de destination en naviguant (grosses lignes). */
  function choisirDestination(depart, exclu) {
    return new Promise(function (fin) {
      var d = EB.dialogue(), fini = false, courant = depart.slice();
      function terminer(v) { if (fini) return; fini = true; EB.fermerDialogue(); fin(v); }
      d.oncancel = function () { terminer(null); };
      function afficher() {
        d.textContent = "";
        var liste = h("div", { class: "choix-liste" }, chargement());
        d.appendChild(h("div", { class: "contenu" },
          h("h2", { id: "detail-titre" }, "Ranger où ?"),
          h("p", { class: "phrase" }, "Dossier ouvert : " + (courant.length ? courant.join(" › ") : "Tout en haut")),
          courant.length ? h("button", { class: "choix", type: "button", onclick: function () { courant.pop(); afficher(); } }, emoji("⬆️"), h("span", null, h("b", null, "Revenir au dossier du dessus"))) : null,
          liste,
          h("button", { class: "btn large", type: "button", onclick: function () { terminer(courant.slice()); } }, icone("coche"), "Ranger ici"),
          h("button", { class: "btn secondaire large", type: "button", onclick: function () { terminer(null); } }, "Annuler")));
        EB.ouvrirDialogue(d);
        contexte().then(function (c) { return G.graphTout(urlItem(c.drive.id, courant, "children") + "?$select=id,name,folder&$top=500"); }).then(function (enf) {
          liste.textContent = "";
          enf.filter(function (x) { return x.folder && x.id !== exclu; }).sort(function (a, b) { return a.name.localeCompare(b.name, "fr"); }).forEach(function (x) {
            var reserve = reserveConnu(courant, x.name) === true;
            liste.appendChild(h("button", { class: "choix", type: "button", "data-nom": x.name, onclick: function () { courant.push(x.name); afficher(); } }, emoji(reserve ? "🔒" : "📁"),
              h("span", null, h("b", null, x.name), reserve ? h("small", null, "🔒 Privé") : null)));
          });
          if (!liste.childNodes.length) liste.appendChild(h("p", { class: "vide-doux" }, "Pas de sous-dossier ici."));
        }).catch(function (e) { liste.textContent = ""; liste.appendChild(blocErreur(e)); });
      }
      afficher();
    });
  }

  /** Déplacer un dossier ou un fichier (d : élément Graph, avec .file pour un fichier). */
  function deplacer(d, segsParent) {
    var estFichier = !!d.file;
    if (!estFichier && segsParent.length === 0 && d.name === nomCommun()) { EB.toast("Le dossier « " + nomCommun() + " » reste à sa place."); return; }
    choisirDestination(segsParent, d.id).then(function (cible) {
      if (!cible) return;
      if (cible.join("/") === segsParent.join("/")) { EB.toast("Il est déjà rangé ici."); return; }
      var ou = cible.length ? "« " + cible[cible.length - 1] + " »" : "tout en haut";
      var reserve = cible.length ? reserveConnu(cible.slice(0, -1), cible[cible.length - 1]) === true : false;
      var csq = reserve ? "Seules les personnes qui peuvent ouvrir ce dossier le verront."
        : "Il pourra être ouvert par les mêmes personnes que " + ou + " (sauf s'il est privé).";
      return EB.confirmer({ emoji: reserve ? "🔒" : "📦", titre: "Ranger « " + d.name + " » ailleurs ?",
        phrase: (estFichier ? "Le document ira dans " : "Le dossier et tout son contenu iront dans ") + ou + "." + (reserve ? " " + ou + " est privé." : ""),
        consequence: csq, bouton: "Oui, ranger ici" }).then(function (ok) {
        if (!ok) return;
        return contexte().then(function (c) {
          return G.graph("GET", urlItem(c.drive.id, cible) + "?$select=id").then(function (t) {
            return G.graph("PATCH", "/drives/" + c.drive.id + "/items/" + d.id, { parentReference: { id: t.id } });
          });
        }).then(function () { noter(estFichier ? "Document rangé ailleurs" : "Dossier rangé ailleurs", d.name + " → " + (cible.join(" / ") || "Tout en haut")); EB.toast("C'est rangé."); EB.rendre(); });
      });
    }).catch(afficherErreur);
  }

  function afficherErreur(e) {
    if (!e) return;
    var d = EB.dialogue();
    var ok = h("button", { class: "btn large", type: "button", onclick: function () { EB.fermerDialogue(); EB.rendre(); } }, "Compris");
    d.appendChild(h("div", { class: "contenu centre" }, emoji("⚠️", "grand"), h("h2", { id: "detail-titre" }, "Ça n'a pas marché"),
      h("p", { class: "phrase" }, e.message || "Erreur inconnue."), e.action ? h("p", { class: "phrase" }, e.action) : null,
      e.detail ? h("p", { class: "detail-technique" }, e.detail) : null, ok));
    EB.ouvrirDialogue(d, ok);
  }

  /* ------------------------------------------------------------------ */
  /* #/acces : qui a accès                                               */
  /* ------------------------------------------------------------------ */
  /** Adresse REST de l'objet sécurisable (bibliothèque ou élément du dossier). */
  function baseRest(segs) {
    return contexte().then(function (c) {
      var liste = "/_api/web/lists(guid'" + c.listId + "')";
      if (!segs.length) return { base: liste, itemId: null, nom: c.drive.name || "Documents", c: c };
      return G.graph("GET", urlItem(c.drive.id, segs) + "?$select=id,name,file&$expand=listItem($select=id)").then(function (it) {
        return { base: liste + "/items(" + it.listItem.id + ")", itemId: it.id, nom: it.name, fichier: !!it.file, c: c };
      });
    });
  }
  function lireDroits(segs) {
    return baseRest(segs).then(function (o) {
      return Promise.all([
        G.sp("GET", o.base + "?$select=HasUniqueRoleAssignments"),
        G.sp("GET", o.base + "/roleassignments?$expand=Member,RoleDefinitionBindings"),
      ]).then(function (r) {
        var entrees = ((r[1] && r[1].value) || []).map(function (ra) {
          var n = D.niveauDeRoles(ra.RoleDefinitionBindings || []);
          return n ? { principalId: ra.PrincipalId, membre: ra.Member || {}, niveau: n.niveau, total: n.controleTotal } : null;
        }).filter(Boolean);
        entrees.sort(function (a, b) {
          var ga = a.membre.PrincipalType === 8 || a.membre.PrincipalType === 4 ? 0 : 1, gb = b.membre.PrincipalType === 8 || b.membre.PrincipalType === 4 ? 0 : 1;
          return ga - gb || String(a.membre.Title).localeCompare(String(b.membre.Title), "fr");
        });
        return { o: o, unique: !!r[0].HasUniqueRoleAssignments, entrees: entrees };
      });
    });
  }
  function nomMembre(m) { return m.PrincipalType === 8 || m.PrincipalType === 4 ? D.nomGroupe(m.Title) : (m.Title || D.adresseDe(m) || "?"); }

  function carteAcces(e, actions) {
    var m = e.membre, type = D.typeDe(m, optsType()), protege = garde(m);
    var groupe = m.PrincipalType === 8 || m.PrincipalType === 4;
    return h("div", { class: "carte-acces " + (D.TYPES[type] ? D.TYPES[type].classe : "") },
      groupe ? h("span", { class: "avatar groupe" }, emoji(type === "lien" ? "🔗" : "👥")) : avatarPersonne({ Title: m.Title, displayName: m.Title }),
      h("span", { class: "qui" }, h("b", null, nomMembre(m)),
        !groupe && D.adresseDe(m) ? h("small", null, D.adresseDe(m)) : null,
        h("span", { class: "etiquettes" }, etiquette(type), protege ? h("span", { class: "etiquette protege" }, "🔒 " + protege) : null)),
      pastilleNiveau(e.niveau, e.total),
      actions || null);
  }

  /** « dossier » ou « fichier », pour des phrases justes. */
  function quoi(o) { return o && o.fichier ? "fichier" : "dossier"; }

  function ecranAcces(app, chemin) {
    var segs = lireSegs(chemin); if (segs === null) segs = [nomCommun()];
    if (!exigerConnexion(app, "Qui peut l'ouvrir ?")) return;
    var gen = demarrerEcran();
    var nom = segs.length ? segs[segs.length - 1] : "Tout en haut";
    var barre = EB.barre("Qui peut l'ouvrir ?", { href: hashChemin("commun", segs), texte: "Retour" });
    app.appendChild(barre);
    var filA = filAriane(segs, "acces"); if (filA) app.appendChild(filA);
    var zone = h("div", null, chargement());
    app.appendChild(zone);
    avecMaj("droits:" + segs.join("/"), function () { return lireDroits(segs); }, gen, zone, function (r) {
      zone.textContent = "";
      var fichier = r.o.fichier;
      // Un fichier ne s'ouvre pas comme un dossier : le retour mène au dossier qui le contient.
      var retour = barre.querySelector(".btn-retour");
      if (fichier && retour) retour.setAttribute("href", hashChemin("commun", segs.slice(0, -1)));
      var parent = segs.length > 1 ? "« " + segs[segs.length - 2] + " »" : segs.length === 1 ? "le dossier tout en haut" : "le site du Château";
      zone.appendChild(h("h2", { class: "titre-objet" }, emoji(fichier ? emojiFichier(nom) : segs.length ? "📁" : "📚"), " ", nom));
      zone.appendChild(r.unique
        ? h("div", { class: "heritage perso", "data-etat": "reserve" }, emoji("🔒"), h("div", null, h("b", null, "Privé"), h("span", null, "Seules les personnes ci-dessous peuvent ouvrir ce " + quoi(r.o) + ".")))
        : h("div", { class: "heritage herite", "data-etat": "visible" }, emoji("👥"), h("div", null, h("b", null, "Visible par toute l'équipe"), h("span", null, "Les mêmes personnes que pour " + parent + " peuvent l'ouvrir."))));

      // Les deux actions que l'on cherche le plus : réserver, ou rendre visible à nouveau.
      if (segs.length) {
        zone.appendChild(h("div", { class: "actions-acces" },
          h("a", { class: "carte-action principale", href: hashChemin("reserver", segs), "data-action": "reserver" },
            emoji("🔒"), h("span", null, h("b", null, "Choisir les personnes"), h("small", null, "Les autres ne pourront plus l'ouvrir"))),
          r.unique ? h("button", { class: "carte-action", type: "button", "data-action": "rendre-visible", onclick: function () { retablir(segs, r, parent); } },
            emoji("🔓"), h("span", null, h("b", null, "Ouvrir à toute l'équipe"), h("small", null, "Comme " + parent))) : null));
      }

      var boutons = h("div", { class: "actions" });
      boutons.appendChild(h("button", { class: "btn secondaire", type: "button", onclick: function () { ajouterPersonne(segs, r); } }, icone("plus"), "Ajouter une personne"));
      if (!r.unique) boutons.appendChild(h("a", { class: "btn secondaire", href: hashChemin("restreindre", segs) }, emoji("✋"), "Enlever des personnes"));
      zone.appendChild(boutons);

      zone.appendChild(h("h3", { class: "sous-titre-acces" }, "Personnes qui peuvent l'ouvrir"));
      zone.appendChild(h("div", { class: "liste-acces" }, r.entrees.map(function (e) {
        var groupe = e.membre.PrincipalType === 8 || e.membre.PrincipalType === 4;
        var acts = h("span", { class: "acts" });
        if (groupe) acts.appendChild(h("button", { class: "btn petit secondaire", type: "button", onclick: function () { voirGroupe(e.membre); } }, "Voir les noms"));
        if (r.unique && !garde(e.membre)) acts.appendChild(h("button", { class: "btn petit secondaire", type: "button", onclick: function () { changerAcces(segs, r, e); } }, "Changer"));
        return carteAcces(e, acts);
      })));
      zone.appendChild(h("div", { class: "note" }, emoji("🚫"), h("span", null, "Toute personne absente de cette liste ne peut pas l'ouvrir.")));
      if (!r.unique) zone.appendChild(h("p", { class: "aide-ecran" }, "Pour changer une personne en particulier, touchez d'abord « Choisir les personnes » ou « Enlever des personnes »."));
    }).catch(function (e) {
      if (!toujoursLa(gen, zone)) return;
      zone.textContent = "";
      zone.appendChild(blocErreur(e, EB.rendre));
      if (e.statut === 403) zone.appendChild(h("p", { class: "aide-ecran" }, "Pour choisir qui peut ouvrir un dossier, il faut être Gestionnaire. Demandez à Damien."));
    });
  }

  function voirGroupe(m) {
    var d = EB.dialogue();
    var liste = h("div", { class: "liste-acces" }, chargement());
    var ok = h("button", { class: "btn large", type: "button", onclick: EB.fermerDialogue }, "Fermer");
    d.appendChild(h("div", { class: "contenu" }, h("h2", { id: "detail-titre" }, nomMembre(m)), liste, ok));
    EB.ouvrirDialogue(d, ok);
    if (D.typeDe(m, optsType()) === "lien") { liste.textContent = ""; liste.appendChild(h("p", null, "Un lien de partage : toute personne qui a reçu ce lien (et qui y a droit) peut ouvrir le dossier.")); return; }
    // Groupe SharePoint (8) : on lit ses membres ; groupe de l'annuaire ou « Tout le monde » (4) : on le déplie directement.
    (m.PrincipalType === 8
      ? G.sp("GET", "/_api/web/sitegroups/getbyid(" + m.Id + ")/users?$select=Id,Title,Email,LoginName,PrincipalType").then(function (r) { return (r && r.value) || []; })
      : Promise.resolve([m])
    ).then(deplierGroupe).then(function (res) {
      liste.textContent = "";
      if (!res.personnes.length && !res.tous.length) liste.appendChild(h("p", { class: "vide-doux" }, "Personne pour l'instant."));
      res.tous.forEach(function (t) {
        liste.appendChild(h("div", { class: "carte-acces" }, h("span", { class: "avatar", style: { background: "#6E5A8C" } }, "🏰"),
          h("span", { class: "qui" }, h("b", null, t.titre), h("small", null, t.sous))));
      });
      res.personnes.forEach(function (x) {
        liste.appendChild(h("div", { class: "carte-acces" }, avatarPersonne({ Title: x.nom, displayName: x.nom }),
          h("span", { class: "qui" }, h("b", null, x.nom), h("small", null, x.mail), h("span", { class: "etiquettes" }, etiquette(D.typeDe(x.brut, optsType()))))));
      });
    }).catch(function (e) { liste.textContent = ""; liste.appendChild(blocErreur(e)); });
  }

  /**
   * Remplace les entrées techniques d'un groupe SharePoint par de vraies personnes :
   * - « Compte système » : masqué (compte interne de SharePoint) ;
   * - groupe Microsoft 365 du site (…federateddirectoryclaimprovider|<id>, « _o » = propriétaires) : ses personnes ;
   * - groupe de sécurité (c:0t.c|tenant|<id>) : ses membres ;
   * - « Tout le monde (sauf les externes) » : une ligne claire, sans adresse.
   */
  function deplierGroupe(entrees) {
    var personnes = [], tous = [], vus = {};
    function ajouter(nom, mail, brut) {
      var cle = String(mail || nom || "").toLowerCase();
      if (!cle || vus[cle]) return;
      vus[cle] = 1;
      personnes.push({ nom: nom || mail, mail: mail || "", brut: brut });
    }
    var attentes = entrees.map(function (x) {
      var login = String(x.LoginName || "").toLowerCase();
      if (/sharepoint\\system|^app@sharepoint/.test(login) || /^(compte syst[eè]me|system account)$/i.test(x.Title || "")) return null;
      if (/spo-grid-all-users/.test(login)) { tous.push({ titre: "Tout le personnel du Château", sous: "Chaque personne qui a un compte du Château (pas les personnes extérieures)." }); return null; }
      if (/^c:0\(\.s\|true/.test(login) || /^tout le monde$|^everyone$/i.test(x.Title || "")) { tous.push({ titre: "Tout le personnel du Château", sous: "Chaque personne qui a un compte du Château." }); return null; }
      var m365 = /federateddirectoryclaimprovider\|([0-9a-f-]{36})(_o)?/.exec(login);
      var secu = /^c:0t\.c\|tenant\|([0-9a-f-]{36})/.exec(login);
      var id = m365 ? m365[1] : secu ? secu[1] : null;
      if (id) {
        var quoi = m365 && m365[2] ? "owners" : "members";
        return G.graphTout("/groups/" + id + "/" + quoi + "?$select=id,displayName,mail,userPrincipalName,userType").then(function (l) {
          l.forEach(function (u) { if (u["@odata.type"] && !/user$/i.test(u["@odata.type"])) return; ajouter(u.displayName, u.mail || u.userPrincipalName, u); });
        }).catch(function () { tous.push({ titre: "Groupe de l'équipe du site", sous: "Impossible d'afficher son contenu pour l'instant." }); });
      }
      ajouter(x.Title, D.adresseDe(x), x);
      return null;
    });
    return Promise.all(attentes).then(function () {
      personnes.sort(function (a, b) { return a.nom.localeCompare(b.nom, "fr"); });
      var t = {}; tous = tous.filter(function (x) { if (t[x.titre]) return false; t[x.titre] = 1; return true; });
      return { personnes: personnes, tous: tous };
    });
  }

  /* --- Choisir une personne (équipe ou adresse extérieure) --- */
  function choisirPersonne(titre) {
    return Promise.all([utilisateurs().catch(function () { return { liste: [] }; })]).then(function (r) {
      return new Promise(function (fin) {
        var d = EB.dialogue(), fini = false;
        function terminer(v) { if (fini) return; fini = true; EB.fermerDialogue(); fin(v); }
        d.oncancel = function () { terminer(null); };
        var personnes = r[0].liste.filter(function (u) { return u.profil !== "boite" && u.accountEnabled !== false; });
        var recherche = h("input", { class: "champ", type: "search", placeholder: "Chercher un prénom…", "aria-label": "Chercher une personne", oninput: function () { remplir(); } });
        var liste = h("div", { class: "choix-liste" });
        var adresse = h("input", { class: "champ", type: "email", id: "adresse-ext", placeholder: "prenom@exemple.fr", autocomplete: "off" });
        var err = h("p", { class: "erreur", role: "alert" });
        function remplir() {
          var q = String(recherche.value || "").toLowerCase();
          liste.textContent = "";
          var items = personnes.map(function (u) { return { valeur: { type: u.type === "externe" ? "externe" : "interne", upn: u.userPrincipalName, mail: u.mail, nom: u.displayName, typeAff: u.type }, titre: u.displayName, sous: u.mail || u.userPrincipalName, u: u }; });
          items.filter(function (x) { return !q || (x.titre + " " + x.sous).toLowerCase().indexOf(q) > -1; }).slice(0, 60).forEach(function (x) {
            liste.appendChild(h("button", { class: "choix", type: "button", onclick: function () { terminer(x.valeur); } },
              x.u ? avatarPersonne(x.u) : h("span", { class: "avatar", style: { background: "#6C3832" } }, EB.initiales(x.titre)),
              h("span", null, h("b", null, x.titre), h("small", null, x.sous), etiquette(x.valeur.typeAff))));
          });
          if (!liste.childNodes.length) liste.appendChild(h("p", { class: "vide-doux" }, "Personne ne correspond."));
        }
        remplir();
        d.appendChild(h("div", { class: "contenu" },
          h("h2", { id: "detail-titre" }, titre || "Avec qui ?"), recherche, liste,
          h("form", { class: "boite ext", onsubmit: function (e) {
            e.preventDefault();
            var a = String(adresse.value || "").trim().toLowerCase();
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a)) { err.textContent = "Adresse mail incomplète."; return; }
            var interne = (CFG.domainesInternes || []).indexOf(a.split("@")[1]) > -1;
            terminer({ type: interne ? "interne" : "externe", upn: interne ? a : null, mail: a, nom: a, typeAff: interne ? "interne" : "externe" });
          } },
            h("label", { for: "adresse-ext" }, "Ou l'adresse mail d'une personne extérieure"), adresse, err,
            h("button", { class: "btn secondaire large", type: "submit" }, "Utiliser cette adresse")),
          h("button", { class: "btn secondaire large", type: "button", onclick: function () { terminer(null); } }, "Annuler")));
        EB.ouvrirDialogue(d, recherche);
      });
    });
  }
  function choisirNiveau(nom) {
    return EB.choisir("Que peut faire " + nom + " ?", [
      { valeur: "voir", emoji: "👁️", titre: "Peut voir", sous: D.NIVEAUX.voir.texte },
      { valeur: "modifier", emoji: "✏️", titre: "Peut modifier", sous: D.NIVEAUX.modifier.texte },
    ]);
  }

  /* --- Actions sur les droits (REST SharePoint) --- */
  function casserHeritage(base) { return G.sp("POST", base + "/breakroleinheritance(copyRoleAssignments=true,clearSubscopes=true)"); }
  function retirerPrincipal(base, id) { return G.sp("POST", base + "/roleassignments/getbyprincipalid(" + id + ")", undefined, { "X-HTTP-Method": "DELETE", "IF-MATCH": "*" }); }
  function ajouterPrincipal(base, principalId, niveau) {
    return roleDef(niveau).then(function (rid) { return G.sp("POST", base + "/roleassignments/addroleassignment(principalid=" + principalId + ",roledefid=" + rid + ")"); });
  }
  /** Donne un accès : compte de l'entreprise → ensureuser + addroleassignment ; extérieur → invitation Graph. */
  function donnerAcces(o, p, niveau) {
    if (p.type === "interne") {
      return G.sp("POST", "/_api/web/ensureuser", { logonName: D.logonName(p.upn || p.mail) }).then(function (u) { return ajouterPrincipal(o.base, u.Id, niveau); });
    }
    if (!o.itemId) return Promise.reject(Object.assign(new Error("Une personne extérieure se partage dossier par dossier, pas tout en haut."), { statut: 400 }));
    return G.graph("POST", "/drives/" + o.c.drive.id + "/items/" + o.itemId + "/invite", {
      recipients: [{ email: p.mail }], roles: [niveau === "modifier" ? "write" : "read"],
      requireSignIn: true, sendInvitation: true, message: "Le Château de Breteuil partage un dossier avec vous.",
    });
  }

  function ajouterPersonne(segs, r) {
    var p, niveau;
    choisirPersonne("Ajouter qui ?").then(function (x) {
      if (!x) return null;
      p = x;
      return choisirNiveau(p.nom);
    }).then(function (n) {
      if (!n) return null;
      niveau = n;
      var nomObj = r.o.nom;
      var phrase = p.nom + " pourra « " + D.NIVEAUX[niveau].nom.toLowerCase() + " » le " + quoi(r.o) + " « " + nomObj + " »" + (r.unique ? "." : ". Ce dossier aura alors sa propre liste de personnes.");
      var csq = p.type === "interne" ? (r.o.fichier ? "Cela ne concerne que ce fichier." : "Ce qui est rangé dedans suit ce choix, sauf exception.") :
        p.nom + " recevra un mail d'invitation de Microsoft. Sans adresse @breteuil.fr, cette personne est « Externe ».";
      return EB.confirmer({ emoji: "➕", titre: "Donner l'accès ?", phrase: phrase, consequence: csq, bouton: "Oui, donner l'accès" });
    }).then(function (ok) {
      if (!ok) return;
      EB.toast("Un instant…");
      var etape = r.unique || p.type !== "interne" ? Promise.resolve() : casserHeritage(r.o.base);
      return etape.then(function () { return donnerAcces(r.o, p, niveau); }).then(function () {
        noter("Accès donné (" + D.NIVEAUX[niveau].nom + ")", p.nom + " → " + r.o.nom);
        EB.toast("Accès donné à " + p.nom + ".");
        EB.rendre();
      });
    }).catch(afficherErreur);
  }

  function changerAcces(segs, r, e) {
    var nom = nomMembre(e.membre);
    EB.choisir(nom, [
      { valeur: "voir", emoji: "👁️", titre: "Peut voir", sous: e.niveau === "voir" ? "C'est le niveau actuel" : D.NIVEAUX.voir.texte },
      { valeur: "modifier", emoji: "✏️", titre: "Peut modifier", sous: e.niveau === "modifier" ? "C'est le niveau actuel" : D.NIVEAUX.modifier.texte },
      { valeur: "aucun", emoji: "🚫", titre: "Pas d'accès", sous: "Ne pourra plus l'ouvrir" },
    ]).then(function (v) {
      if (!v || v === e.niveau) return null;
      if (garde(e.membre)) { EB.toast("Impossible : " + garde(e.membre) + "."); return null; }
      var phrase = v === "aucun" ? nom + " n'aura plus accès à « " + r.o.nom + " »." : nom + " passera à « " + D.NIVEAUX[v].nom + " » sur « " + r.o.nom + " ».";
      return EB.confirmer({ emoji: v === "aucun" ? "🚫" : "✏️", titre: v === "aucun" ? "Retirer l'accès ?" : "Changer le niveau ?", phrase: phrase,
        consequence: r.o.fichier ? "Cela ne concerne que ce fichier." : v === "aucun" ? "Ce qui est rangé dans ce dossier sera aussi fermé pour " + nom + "." : "Cela vaut aussi pour ce qui est rangé dans ce dossier.",
        bouton: v === "aucun" ? "Oui, retirer l'accès" : "Oui, changer" }).then(function (ok) {
        if (!ok) return;
        return retirerPrincipal(r.o.base, e.principalId).then(function () {
          return v === "aucun" ? null : ajouterPrincipal(r.o.base, e.principalId, v);
        }).then(function () {
          noter(v === "aucun" ? "Accès retiré" : "Niveau changé (" + D.NIVEAUX[v].nom + ")", nom + " → " + r.o.nom);
          EB.toast("C'est fait.");
          EB.rendre();
        });
      });
    }).catch(afficherErreur);
  }

  function retablir(segs, r, parent) {
    EB.confirmer({ emoji: "🔓", titre: "Ouvrir « " + r.o.nom + " » à toute l'équipe ?", deuxEtapes: false,
      phrase: "Toute l'équipe qui ouvre " + parent + " pourra ouvrir « " + r.o.nom + " ».",
      consequence: "La liste de personnes choisie pour ce " + quoi(r.o) + " sera effacée.", bouton: "Oui, ouvrir à toute l'équipe" }).then(function (ok) {
      if (!ok) return;
      EB.toast("Un instant…");
      return G.sp("POST", r.o.base + "/resetroleinheritance").then(function () {
        noter("Ouvert à toute l'équipe", r.o.nom);
        EB.toast("C'est fait : « " + r.o.nom + " » est ouvert à toute l'équipe.");
        EB.rendre();
      });
    }).catch(afficherErreur);
  }

  /* ------------------------------------------------------------------ */
  /* #/restreindre : « Retirer certaines personnes… »                    */
  /* ------------------------------------------------------------------ */
  var brouillon = null; // { cle, garder: {principalId: bool}, ajouts: [{p, niveau}] }

  function ecranRestreindre(app, chemin) {
    var segs = lireSegs(chemin); if (segs === null) segs = [nomCommun()];
    if (!exigerConnexion(app, "Enlever des personnes")) return;
    var gen = demarrerEcran(), cleB = segs.join("/");
    if (!brouillon || brouillon.cle !== cleB) brouillon = { cle: cleB, garder: {}, ajouts: [] };
    app.appendChild(EB.barre("Enlever des personnes", { href: hashChemin("acces", segs), texte: "Annuler" }));
    var zone = h("div", null, chargement());
    app.appendChild(zone);
    C.obtenir("droits:" + segs.join("/"), function () { return lireDroits(segs); }, { ttl: 30000 }).then(function (r) {
      if (!toujoursLa(gen, zone)) return;
      zone.textContent = "";
      zone.appendChild(h("h2", { class: "titre-objet" }, emoji("✋"), " Qui garde l'accès à « " + r.o.nom + " » ?"));
      zone.appendChild(h("p", { class: "aide-ecran" }, "Touchez pour choisir. Ceux marqués 🔒 gardent toujours l'accès."));
      zone.appendChild(h("div", { class: "liste-acces" }, r.entrees.map(function (e) {
        var protege = garde(e.membre);
        if (brouillon.garder[e.principalId] === undefined) brouillon.garder[e.principalId] = true;
        var garde_ = protege ? true : brouillon.garder[e.principalId];
        var bouton = h("button", { class: "bascule " + (garde_ ? "oui" : "non"), type: "button", disabled: !!protege, "aria-pressed": String(garde_),
          onclick: function () { brouillon.garder[e.principalId] = !brouillon.garder[e.principalId]; EB.rendre(); } },
          garde_ ? "✓ Garde l'accès" : "✗ Perd l'accès");
        return carteAcces(e, h("span", { class: "acts" }, bouton));
      })));
      zone.appendChild(h("section", { class: "section" }, h("h2", null, "Ajouter aussi"),
        brouillon.ajouts.length ? h("div", { class: "liste-acces" }, brouillon.ajouts.map(function (a, i) {
          return h("div", { class: "carte-acces" }, h("span", { class: "avatar", style: { background: "#6C3832" } }, EB.initiales(a.p.nom)),
            h("span", { class: "qui" }, h("b", null, a.p.nom), h("span", { class: "etiquettes" }, etiquette(a.p.typeAff))), pastilleNiveau(a.niveau),
            h("span", { class: "acts" }, h("button", { class: "btn petit secondaire", type: "button", onclick: function () { brouillon.ajouts.splice(i, 1); EB.rendre(); } }, "Enlever")));
        })) : null,
        h("button", { class: "btn secondaire", type: "button", onclick: function () {
          var p;
          choisirPersonne("Ajouter qui ?").then(function (x) { if (!x) return null; p = x; return choisirNiveau(p.nom); })
            .then(function (n) { if (n) { brouillon.ajouts.push({ p: p, niveau: n }); EB.rendre(); } });
        } }, icone("plus"), "Ajouter une personne")));

      var gardes = r.entrees.filter(function (e) { return garde(e.membre) || brouillon.garder[e.principalId]; });
      var perdus = r.entrees.filter(function (e) { return !garde(e.membre) && !brouillon.garder[e.principalId]; });
      zone.appendChild(h("div", { class: "actions" }, h("button", { class: "btn large", type: "button", onclick: function () {
        executerRestriction(segs, r, gardes, perdus);
      } }, "Continuer")));
    }).catch(function (e) { if (toujoursLa(gen, zone)) { zone.textContent = ""; zone.appendChild(blocErreur(e, EB.rendre)); } });
  }

  function executerRestriction(segs, r, gardes, perdus) {
    var noms = function (l) { return l.map(function (e) { return nomMembre(e.membre); }).join(", ") || "personne"; };
    var ajouts = brouillon.ajouts.slice();
    var phrase = "« " + r.o.nom + " » deviendra privé. Garderont l'accès : " + noms(gardes) + "." +
      (perdus.length ? " Perdront l'accès : " + noms(perdus) + "." : "") +
      (ajouts.length ? " Recevront l'accès : " + ajouts.map(function (a) { return a.p.nom + " (" + D.NIVEAUX[a.niveau].nom + ")"; }).join(", ") + "." : "");
    EB.confirmer({ emoji: "✋", titre: "Vérifions", phrase: phrase,
      consequence: (r.o.fichier ? "" : "Ce qui est rangé dans « " + r.o.nom + " » suivra ce choix.") + (perdus.length ? " " + noms(perdus) + " ne pourront plus l'ouvrir." : ""),
      bouton: "Oui, appliquer" }).then(function (ok) {
      if (!ok) return;
      EB.toast("Un instant…");
      var suite = casserHeritage(r.o.base);
      perdus.forEach(function (e) { suite = suite.then(function () { return retirerPrincipal(r.o.base, e.principalId); }); });
      ajouts.forEach(function (a) { suite = suite.then(function () { return donnerAcces(r.o, a.p, a.niveau); }); });
      return suite.then(function () {
        noter("Accès retirés à certaines personnes", r.o.nom + " — retirés : " + noms(perdus) + (ajouts.length ? " ; ajoutés : " + ajouts.map(function (a) { return a.p.nom; }).join(", ") : ""));
        brouillon = null;
        EB.toast("C'est fait : « " + r.o.nom + " » est privé.");
        location.hash = hashChemin("acces", segs);
      });
    }).catch(function (e) { afficherErreur(e); });
  }

  /* ------------------------------------------------------------------ */
  /* #/reserver : « Réserver à certaines personnes »                     */
  /* ------------------------------------------------------------------ */
  // Choix en cours : { cle, choisis: { adresse: { nom, mail, upn, type } }, niveau }.
  var reserve = null;
  function personneDe(nom, adresse, type) { return { nom: nom || adresse, mail: adresse, upn: adresse, type: type || "interne" }; }

  /** Suggestions : moi, puis les propriétaires du site (direction), sans doublon. */
  function suggestionsReserve(c) {
    var vus = {}, l = [];
    function ajouter(nom, adresse) {
      var a = String(adresse || "").toLowerCase();
      if (!a || vus[a]) return;
      vus[a] = 1; l.push(personneDe(nom, a));
    }
    ajouter((c.moiSp && c.moiSp.Title) || (G.compte() || {}).name, c.moi);
    (c.proprietairesSp || []).forEach(function (u) { if (u.PrincipalType !== 8 && u.PrincipalType !== 4) ajouter(u.Title, D.adresseDe(u)); });
    (c.proprietairesPersonnes || []).forEach(function (p) { ajouter(p.nom, p.mail); });
    return l;
  }

  function ecranReserver(app, chemin) {
    var segs = lireSegs(chemin); if (segs === null) segs = [nomCommun()];
    if (!exigerConnexion(app, "Choisir les personnes")) return;
    var gen = demarrerEcran(), cle = segs.join("/");
    app.appendChild(EB.barre("Choisir les personnes", { href: hashChemin("acces", segs), texte: "Annuler" }));
    var zone = h("div", null, chargement());
    app.appendChild(zone);
    Promise.all([
      C.obtenir("droits:" + cle, function () { return lireDroits(segs); }, { ttl: 30000 }),
      utilisateurs().catch(function () { return { liste: [] }; }),
    ]).then(function (res) {
      if (!toujoursLa(gen, zone)) return;
      var r = res[0], c = r.o.c, suggestions = suggestionsReserve(c);
      if (!reserve || reserve.cle !== cle) {
        reserve = { cle: cle, choisis: {}, niveau: "modifier" };
        if (c.moi) reserve.choisis[c.moi] = suggestions[0]; // vous-même, coché d'office
      }
      var dejaSuggere = {}; suggestions.forEach(function (p) { dejaSuggere[p.mail] = 1; });
      var equipe = res[1].liste.filter(function (u) { return u.profil !== "boite" && u.accountEnabled !== false; }).map(function (u) {
        return personneDe(u.displayName, String(u.mail || u.userPrincipalName || "").toLowerCase(), u.type === "externe" ? "externe" : "interne");
      }).filter(function (p) { return p.mail && !dejaSuggere[p.mail]; });

      zone.textContent = "";
      zone.appendChild(h("h2", { class: "titre-objet" }, emoji("🔒"), " Qui pourra ouvrir « " + r.o.nom + " » ?"));
      zone.appendChild(h("p", { class: "aide-ecran" }, "Cochez les personnes. Toutes les autres ne pourront plus l'ouvrir."));
      var resume = h("p", { class: "resume-choix", role: "status" });
      function majResume() {
        var n = Object.keys(reserve.choisis).length;
        resume.textContent = n ? n + " personne" + (n > 1 ? "s" : "") + " choisie" + (n > 1 ? "s" : "") + " : " + D.listeNoms(Object.keys(reserve.choisis).map(function (a) { return reserve.choisis[a].nom; })) : "Personne n'est choisi pour l'instant.";
        continuer.disabled = !n;
      }
      function ligneChoix(p) {
        var id = "choix-" + p.mail.replace(/[^a-z0-9]/g, "-");
        var case_ = h("input", { type: "checkbox", id: id, "data-adresse": p.mail, onchange: function () {
          if (case_.checked) reserve.choisis[p.mail] = p; else delete reserve.choisis[p.mail];
          // Même personne affichée deux fois (suggestion et recherche) : cases synchronisées.
          zone.querySelectorAll('input[data-adresse="' + p.mail + '"]').forEach(function (x) { x.checked = case_.checked; });
          majResume();
        } });
        case_.checked = !!reserve.choisis[p.mail];
        return h("label", { class: "ligne-choix", for: id }, case_, avatarPersonne({ displayName: p.nom }),
          h("span", { class: "qui" }, h("b", null, p.nom + (p.mail === c.moi ? " (vous)" : "")), h("small", null, p.mail), etiquette(p.type)));
      }
      zone.appendChild(h("section", { class: "section" }, h("h3", null, "Direction (gestionnaires)"),
        h("div", { class: "liste-choix", "data-liste": "suggestions" }, suggestions.map(ligneChoix))));
      var recherche = h("input", { class: "champ recherche", type: "search", placeholder: "Chercher un prénom…", "aria-label": "Chercher une personne de l'équipe", oninput: remplir });
      var listeEquipe = h("div", { class: "liste-choix", "data-liste": "equipe" });
      function remplir() {
        var q = String(recherche.value || "").trim().toLowerCase();
        listeEquipe.textContent = "";
        var l = equipe.filter(function (p) { return !q || (p.nom + " " + p.mail).toLowerCase().indexOf(q) > -1; });
        l.slice(0, 40).forEach(function (p) { listeEquipe.appendChild(ligneChoix(p)); });
        if (!l.length) listeEquipe.appendChild(h("p", { class: "vide-doux" }, equipe.length ? "Personne ne correspond." : "La liste de l'équipe n'a pas pu être chargée."));
        else if (l.length > 40) listeEquipe.appendChild(h("p", { class: "vide-doux" }, "Écrivez un prénom pour voir les autres."));
      }
      zone.appendChild(h("section", { class: "section" }, h("h3", null, "Autres personnes de l'équipe"), recherche, listeEquipe));

      function choixNiveau(n) {
        var x = D.NIVEAUX[n];
        var radio = h("input", { type: "radio", name: "niveau-reserve", id: "niveau-" + n, value: n, onchange: function () { reserve.niveau = n; } });
        radio.checked = reserve.niveau === n;
        return h("label", { class: "ligne-choix niveau-choix", for: "niveau-" + n }, radio, emoji(x.emoji), h("span", { class: "qui" }, h("b", null, x.nom), h("small", null, x.texte)));
      }
      zone.appendChild(h("section", { class: "section" }, h("h3", null, "Que pourront-elles faire ?"),
        h("div", { class: "liste-choix", role: "radiogroup", "aria-label": "Que pourront-elles faire ?" }, choixNiveau("modifier"), choixNiveau("voir"))));

      var continuer = h("button", { class: "btn large", type: "button", "data-action": "continuer-reserve", onclick: function () { confirmerReserve(segs, r); } }, emoji("🔒"), "Continuer");
      zone.appendChild(resume);
      zone.appendChild(h("div", { class: "actions" }, continuer));
      remplir(); majResume();
    }).catch(function (e) {
      if (!toujoursLa(gen, zone)) return;
      zone.textContent = "";
      zone.appendChild(blocErreur(e, EB.rendre));
      if (e.statut === 403) zone.appendChild(h("p", { class: "aide-ecran" }, "Pour choisir qui peut ouvrir un dossier, il faut être Gestionnaire. Demandez à Damien."));
    });
  }

  function confirmerReserve(segs, r) {
    var choisis = Object.keys(reserve.choisis).map(function (a) { return reserve.choisis[a]; });
    if (!choisis.length) { EB.toast("Choisissez au moins une personne."); return; }
    var niveau = reserve.niveau, base = r.o.base;
    var plan = D.planReserve(r.entrees, choisis, niveau, garde);
    var obligatoires = D.obligatoiresReserve(plan.proteges, nomMembre, choisis);
    var noms = choisis.map(function (p) { return p.nom; });
    var retires = plan.retirer.map(function (e) { return nomMembre(e.membre); });
    EB.confirmer({ emoji: "🔒", titre: "Rendre « " + r.o.nom + " » privé ?", deuxEtapes: false,
      phrase: D.phraseReserve(noms, r.o.nom, obligatoires),
      consequence: (niveau === "voir" ? "Elles pourront l'ouvrir et le lire, sans rien changer." : "Elles pourront l'ouvrir et le modifier.") +
        (retires.length ? " Ne pourront plus l'ouvrir : " + D.listeNoms(retires) + "." : "") +
        (r.o.fichier ? "" : " Ce qui est rangé dedans suivra ce choix."),
      bouton: "Oui, rendre privé" }).then(function (ok) {
      if (!ok) return;
      var etapes = [];
      if (!r.unique) etapes.push(function () { return casserHeritage(base); });
      plan.changer.forEach(function (e) { etapes.push(function () { return retirerPrincipal(base, e.principalId).then(function () { return ajouterPrincipal(base, e.principalId, niveau); }); }); });
      plan.ajouter.forEach(function (p) { etapes.push(function () { return donnerAcces(r.o, p, niveau); }); });
      plan.retirer.forEach(function (e) { etapes.push(function () { return retirerPrincipal(base, e.principalId); }); });
      var fait = 0, suite = Promise.resolve();
      EB.toast("Un instant… (0 sur " + etapes.length + ")");
      etapes.forEach(function (f) { suite = suite.then(f).then(function () { fait++; EB.toast("Un instant… (" + fait + " sur " + etapes.length + ")"); }); });
      return suite.then(function () {
        noter("Rendu privé (" + D.NIVEAUX[niveau].nom + ")", r.o.nom + " — " + D.listeNoms(noms) + (retires.length ? " ; retirés : " + retires.join(", ") : ""));
        reserve = null;
        EB.toast("C'est fait : seuls " + D.listeNoms(noms) + " (et les gestionnaires) peuvent ouvrir « " + r.o.nom + " ».");
        location.hash = hashChemin("acces", segs);
      });
    }).catch(afficherErreur);
  }

  /* ------------------------------------------------------------------ */
  /* #/personnes                                                         */
  /* ------------------------------------------------------------------ */
  var filtrePersonnes = "tous";
  function ecranPersonnes(app, chemin) {
    if (chemin[1]) return fichePersonne(app, chemin[1]);
    if (!exigerConnexion(app, "L'équipe", EB.hub())) return;
    var gen = demarrerEcran();
    app.appendChild(EB.barre("L'équipe", EB.hub()));
    var zone = h("div", null, chargement());
    app.appendChild(zone);
    utilisateurs().then(function (u) {
      if (!toujoursLa(gen, zone)) return;
      zone.textContent = "";
      var FILTRES = [["tous", "Tous"], ["equipe", "L'équipe"], ["boite", "Adresses partagées"], ["externe", "Externes"]];
      var seg = h("div", { class: "segments", role: "group", "aria-label": "Afficher", style: { "--n": "4" } });
      // Filtre : seule la liste est redessinée (pas l'écran, pas de nouvel appel Microsoft).
      FILTRES.forEach(function (f) { seg.appendChild(h("button", { type: "button", "aria-pressed": String(filtrePersonnes === f[0]), onclick: function () {
        filtrePersonnes = f[0];
        Array.prototype.forEach.call(seg.children, function (b, i) { b.setAttribute("aria-pressed", String(FILTRES[i][0] === f[0])); });
        remplir();
      } }, f[1])); });
      zone.appendChild(seg);
      var recherche = h("input", { class: "champ recherche", type: "search", placeholder: "Chercher…", "aria-label": "Chercher une personne" });
      zone.appendChild(recherche);
      var liste = h("div", { class: "liste-personnes" });
      function remplir() {
        var q = String(recherche.value || "").toLowerCase();
        liste.textContent = "";
        u.liste.filter(function (x) {
          var t = x.type;
          if (filtrePersonnes === "equipe" && (x.profil === "boite" || t === "externe")) return false;
          if (filtrePersonnes === "boite" && x.profil !== "boite") return false;
          if (filtrePersonnes === "externe" && t !== "externe") return false;
          return !q || (x.displayName + " " + (x.mail || "")).toLowerCase().indexOf(q) > -1;
        }).forEach(function (x) {
          var P = D.PROFILS[x.profil];
          liste.appendChild(h("a", { class: "carte-personne", href: "#/personnes/" + encodeURIComponent(x.id) },
            x.profil === "boite" ? avatarBoite(x) : avatarPersonne(x),
            h("span", { class: "qui" }, h("b", null, x.displayName), h("small", null, x.mail || x.userPrincipalName),
              h("span", { class: "etiquettes" }, h("span", { class: "etiquette profil " + x.profil }, P.emoji + " " + P.court), etiquette(x.type))),
            h("span", { class: "fleche", "aria-hidden": "true" }, "›")));
        });
        if (!liste.childNodes.length) liste.appendChild(h("p", { class: "vide" }, "Personne ne correspond."));
      }
      recherche.addEventListener("input", remplir);
      remplir();
      zone.appendChild(liste);
    }).catch(function (e) { if (toujoursLa(gen, zone)) { zone.textContent = ""; zone.appendChild(blocErreur(e, EB.rendre)); } });
  }

  /**
   * « Tous les outils inclus » : plans de service Microsoft traduits en français (liste propre, sans code),
   * puis, tout en bas et replié, « Détail pour le support (codes Microsoft) » : codes non reconnus et plans
   * désactivés. charger() → réponse Graph /licenseDetails. opts : { titre, silencieux } (silencieux : en cas
   * d'erreur, la section disparaît au lieu d'afficher un message).
   */
  function outilsInclus(charger, opts) {
    opts = opts || {};
    var attente = chargement(2);
    var sect = h("section", { class: "section outils-inclus", "aria-busy": "true" }, h("h2", null, opts.titre || "Tous les outils inclus"), attente);
    function fin() { sect.setAttribute("aria-busy", "false"); attente.remove(); }
    Promise.resolve().then(charger).then(function (r) {
      fin();
      var res = D.outilsDesPlans((r && r.value) || []);
      if (res.outils.length) sect.appendChild(h("ul", { class: "outils liste-inclus" }, res.outils.map(function (o) { return h("li", null, emoji(o.emoji), h("span", null, o.nom)); })));
      else sect.appendChild(h("p", { class: "vide" }, "Aucun outil trouvé dans ces licences."));
      if (res.support.length) sect.appendChild(h("details", { class: "support-codes" },
        h("summary", null, "Pour Damien (codes techniques)"),
        h("p", null, "Codes que l'appli ne traduit pas, et options désactivées. Utile seulement si Damien vous les demande."),
        h("ul", { class: "codes" }, res.support.map(function (s) {
          return h("li", null, h("code", null, s.code), h("span", null, " · " + s.licence + (s.desactive ? " · désactivé" : "")));
        }))));
    }).catch(function (e) {
      fin();
      if (opts.silencieux) sect.remove(); else sect.appendChild(blocErreur(e));
    });
    return sect;
  }

  function fichePersonne(app, id) {
    if (!exigerConnexion(app, "Fiche", EB.hub())) return;
    var gen = demarrerEcran();
    app.appendChild(EB.barre("Ce que cette personne peut utiliser", { href: "#/personnes", texte: "Retour" }));
    var zone = h("div", null, chargement());
    app.appendChild(zone);
    utilisateurs().then(function (u) {
      if (!toujoursLa(gen, zone)) return;
      var x = u.liste.filter(function (y) { return y.id === id; })[0];
      zone.textContent = "";
      if (!x) { zone.appendChild(h("p", { class: "vide" }, "Personne introuvable.")); return; }
      var P = D.PROFILS[x.profil];
      zone.appendChild(h("div", { class: "bonjour" }, x.profil === "boite" ? avatarBoite(x, "grand") : avatarPersonne(x, "grand"),
        h("div", null, h("h2", null, x.displayName), h("p", null, [x.jobTitle, x.department].filter(Boolean).join(" · ") || x.mail || ""),
          h("span", { class: "etiquettes" }, etiquette(x.type)))));
      zone.appendChild(h("div", { class: "carte-profil " + x.profil },
        h("div", { class: "tete" }, emoji(P.emoji, "grand"), h("div", null, h("b", null, P.nom), h("span", null, P.phrase))),
        h("ul", { class: "outils" }, P.outils.map(function (o) { return h("li", null, emoji(o[0]), h("span", null, o[1])); }))));
      if (x.mail) zone.appendChild(h("p", { class: "aide-ecran" }, "Adresse : " + x.mail));
      if ((x.assignedLicenses || []).length) {
        zone.appendChild(outilsInclus(function () {
          return G.graph("GET", "/users/" + encodeURIComponent(x.id) + "/licenseDetails?$select=skuPartNumber,servicePlans");
        }, { titre: "Tous les outils inclus" }));
      }
    }).catch(function (e) { if (toujoursLa(gen, zone)) { zone.textContent = ""; zone.appendChild(blocErreur(e, EB.rendre)); } });
  }

  /* ------------------------------------------------------------------ */
  /* #/licences-reel                                                     */
  /* ------------------------------------------------------------------ */
  function ecranLicences(app) {
    if (!exigerConnexion(app, "Abonnements de l'équipe", EB.hub())) return;
    var gen = demarrerEcran();
    app.appendChild(EB.barre("Abonnements de l'équipe", EB.hub()));
    var zone = h("div", null, chargement());
    app.appendChild(zone);
    utilisateurs().then(function (u) {
      if (!toujoursLa(gen, zone)) return;
      zone.textContent = "";
      var comptes = D.compteLicences(u.skus);
      ["standard", "basic"].concat(comptes.some(function (c) { return c.profil === "exchange"; }) ? ["exchange"] : []).forEach(function (p) {
        var P = D.PROFILS[p], c = comptes.filter(function (x) { return x.profil === p; })[0] || { achetees: 0, attribuees: 0, libres: 0 };
        var qui = u.liste.filter(function (x) { return x.profil === p; });
        var boitesLic = u.liste.filter(function (x) { return x.profil === "boite" && x.licence === p; });
        zone.appendChild(h("div", { class: "carte-profil " + p },
          h("div", { class: "tete" }, emoji(P.emoji, "grand"), h("div", null, h("b", null, P.nom), h("span", null, P.phrase))),
          h("div", { class: "compteurs" },
            h("span", null, h("b", null, String(c.achetees)), "achetées"),
            h("span", null, h("b", null, String(c.attribuees)), "utilisées"),
            h("span", { class: c.libres ? "libre" : "" }, h("b", null, String(c.libres)), "libres")),
          h("ul", { class: "outils" }, P.outils.map(function (o) { return h("li", null, emoji(o[0]), h("span", null, o[1])); })),
          qui.length ? h("div", { class: "visages petits" }, qui.map(function (x) {
            return h("a", { class: "visage", href: "#/personnes/" + encodeURIComponent(x.id), title: x.displayName, "aria-label": x.displayName }, avatarPersonne(x), h("span", { class: "nom-visage" }, x.prenom));
          })) : null,
          // v5.5.1 : boîtes partagées qui gardent une licence (souvent d'essai) — comptées par Microsoft dans « utilisées ».
          boitesLic.length ? h("p", { class: "aide-ecran boites-licence" }, "📬 Dont " + boitesLic.length + (boitesLic.length > 1 ? " adresses partagées qui utilisent" : " adresse partagée qui utilise") +
            " encore cette licence : " + D.listeNoms(boitesLic.map(function (x) { return x.displayName; })) + ".") : null));
      });
      zone.appendChild(h("div", { class: "carte-profil boite" },
        h("div", { class: "tete" }, emoji("📬", "grand"), h("div", null, h("b", null, "Adresse partagée"), h("span", null, D.PROFILS.boite.phrase))),
        h("ul", { class: "outils" }, D.PROFILS.boite.outils.map(function (o) { return h("li", null, emoji(o[0]), h("span", null, o[1])); }))));
      zone.appendChild(h("p", { class: "aide-ecran" }, "Pour en acheter ou en retirer : tuile « Moyen de paiement », ou demandez à Damien."));
    }).catch(function (e) { if (toujoursLa(gen, zone)) { zone.textContent = ""; zone.appendChild(blocErreur(e, EB.rendre)); } });
  }

  /* ------------------------------------------------------------------ */
  /* #/organisation : comprendre l'organisation                          */
  /* ------------------------------------------------------------------ */
  function donneesOrganisation() {
    if (!G.estConnecte()) {
      var d = EB.demo();
      var map = { "complete": "standard", "express-teams": "basic", "express": "exchange", "aucune": "aucune" };
      return Promise.resolve({
        exemple: true,
        personnes: d.collaborateurs.map(function (c) { return { id: c.id, displayName: c.prenom, prenom: c.prenom, profil: map[c.licence] || "aucune", couleur: c.couleur, type: "interne" }; })
          .concat([{ id: "agence", displayName: "Agence photo", prenom: "Agence", profil: "externe", type: "externe" }]),
        boites: d.boites.map(function (b) { return { nom: b.nom, adresse: b.adresse, emoji: b.emoji, qui: Object.keys(b.acces).map(function (k) { var c = d.collaborateurs.filter(function (x) { return x.id === k; })[0]; return c ? { nom: c.prenom, couleur: c.couleur } : { nom: k }; }) }; }),
        site: "Château de Breteuil", proprietaires: ["François", "Pauline"],
        roles: [{ nom: "Administrateur", qui: ["François", "Damien"] }, { nom: "Facturation", qui: ["Valérie D."] }],
      });
    }
    return Promise.all([utilisateurs(), contexte(),
      rolesAnnuaire().catch(function () { return []; }),
      ]).then(function (r) {
      var u = r[0].liste;
      var noms = { "62e90394-69f5-4237-9190-012177145e10": "Administrateur", "b0f54661-2d74-4c50-afa3-1ec803f12efe": "Facturation", "fe930be7-5e62-47db-91af-98c3a49a38b1": "Gestion des comptes" };
      return {
        exemple: false,
        personnes: u.filter(function (x) { return x.profil !== "boite"; }),
        boites: u.filter(function (x) { return x.profil === "boite"; }).map(function (x) { return { id: x.id, nom: x.displayName, adresse: x.mail || x.userPrincipalName, emoji: "📬", qui: null, photo: function () { return photo(x.id); } }; }),
        site: r[1].site.displayName, proprietaires: r[1].proprietairesNoms || [],
        roles: r[2].filter(function (x) { return noms[x.roleTemplateId]; }).map(function (x) { return { nom: noms[x.roleTemplateId], qui: (x.members || []).map(function (m) { return m.displayName; }) }; }),
      };
    });
  }

  function expliquer(emojiTitre, titre, lignes, lien) {
    var d = EB.dialogue();
    var ok = h("button", { class: "btn large", type: "button", onclick: EB.fermerDialogue }, "Compris");
    d.appendChild(h("div", { class: "contenu" }, h("h2", { id: "detail-titre" }, emoji(emojiTitre), " ", titre),
      lignes.map(function (l) { return typeof l === "string" ? h("p", { class: "phrase" }, l) : l; }),
      lien ? h("a", { class: "btn secondaire large", href: lien.href, onclick: EB.fermerDialogue }, lien.texte) : null, ok));
    EB.ouvrirDialogue(d, ok);
  }

  function ecranOrganisation(app) {
    var gen = demarrerEcran();
    app.appendChild(EB.barre("Qui fait quoi", EB.hub()));
    var zone = h("div", null, chargement());
    app.appendChild(zone);
    donneesOrganisation().then(function (o) {
      if (!toujoursLa(gen, zone)) return;
      zone.textContent = "";
      zone.appendChild(o.exemple ? EB.bandeauDemo("Exemple — données fictives (connectez-vous pour voir le vrai)") : h("p", { class: "pastille-demo reel" }, icone("coche"), "Vraies données Microsoft"));
      zone.appendChild(h("p", { class: "aide-ecran" }, "Touchez chaque élément pour comprendre à quoi il sert."));
      var schema = h("div", { class: "schema" });

      // 1. Les personnes, rangées par licence
      // v5.5.1 : boîtes partagées jamais ici (même avec licence) ; le prestataire dans un petit groupe à part ;
      // noms affichés en double (deux « Valérie ») : partie avant @ sous chacun.
      var homonymes = D.distinguerHomonymes(o.personnes, function (x) { return x.prenom || x.displayName; });
      var groupes = ["standard", "basic", "exchange", "aucune", "externe", "prestataire"].map(function (p) {
        var l = o.personnes.filter(function (x) { return x.profil === p; });
        if (!l.length) return null;
        var P = D.PROFILS[p];
        return h("div", { class: "groupe-schema " + p, "data-groupe": p },
          h("button", { class: "titre-groupe-schema", type: "button", onclick: function () {
            expliquer(P.emoji, P.nom, [P.phrase, h("ul", { class: "outils" }, P.outils.map(function (x) { return h("li", null, emoji(x[0]), h("span", null, x[1])); }))], G.estConnecte() ? { href: "#/licences-reel", texte: "Voir les abonnements" } : null);
          } }, P.emoji + " " + P.nom, h("span", { class: "compte" }, String(l.length))),
          h("div", { class: "visages petits" }, l.map(function (x) {
            return h("button", { class: "visage", type: "button", onclick: function () {
              expliquer(P.emoji, x.displayName, [P.phrase, x.type === "externe" ? D.TYPES.externe.aide : ""].filter(Boolean),
                G.estConnecte() && x.id ? { href: "#/personnes/" + encodeURIComponent(x.id), texte: "Ce qu'il ou elle peut utiliser" } : null);
            }, title: x.displayName + (homonymes[x.id] ? " (" + homonymes[x.id] + ")" : ""), "aria-label": x.displayName + (homonymes[x.id] ? ", " + homonymes[x.id] : "") },
            x.couleur ? h("span", { class: "avatar", style: { background: x.couleur } }, EB.initiales(x.prenom)) : avatarPersonne(x),
            h("span", { class: "nom-visage" }, x.prenom), homonymes[x.id] ? h("small", { class: "adresse-visage" }, homonymes[x.id]) : null);
          })));
      }).filter(Boolean);
      schema.appendChild(h("section", { class: "zone-schema personnes" }, h("h2", null, emoji("👥"), " Les personnes"), groupes));

      // 2. Les boîtes partagées : une ligne par boîte (nom, adresse, qui y a accès, Ouvrir, Épingler).
      schema.appendChild(h("section", { class: "zone-schema boites", "aria-labelledby": "t-boites" }, h("h2", { id: "t-boites" }, emoji("📬"), " Les adresses partagées"),
        h("p", { class: "phrase" }, "Des adresses mail lues à plusieurs (boîtes partagées). « Ouvrir » l'affiche dans Outlook."),
        window.EBListeBoites ? window.EBListeBoites.liste(o.boites, { epingler: !o.exemple }) : null));

      // 3. Le dossier commun
      schema.appendChild(h("section", { class: "zone-schema dossier" }, h("h2", null, emoji("🗂️"), " Les documents de l'équipe"),
        h("div", { class: "arbre-schema" },
          h("button", { class: "noeud", type: "button", onclick: function () { expliquer("🏰", "Le site « " + o.site + " »", ["C'est l'espace de partage du Château chez Microsoft (SharePoint). Ses propriétaires décident qui y entre : " + (o.proprietaires.join(", ") || "—") + "."]); } }, emoji("🏰"), "Site « " + o.site + " »"),
          h("span", { class: "lien-noeud", "aria-hidden": "true" }, "↓"),
          h("button", { class: "noeud", type: "button", onclick: function () { expliquer("📚", "Le classeur « Documents »", ["Le grand classeur du site (bibliothèque SharePoint). Ce qui est rangé dedans s'ouvre pour les mêmes personnes, sauf ce qui est privé."], G.estConnecte() ? { href: "#/commun/" + RACINE, texte: "Ouvrir" } : null); } }, emoji("📚"), "Classeur « Documents »"),
          h("span", { class: "lien-noeud", "aria-hidden": "true" }, "↓"),
          h("button", { class: "noeud principal", type: "button", onclick: function () { expliquer("🏰", "Le dossier « " + nomCommun() + " »", ["Le dossier de toute l'équipe. Les dossiers rangés dedans s'ouvrent pour les mêmes personnes, sauf ceux qui sont 🔒 privés."], G.estConnecte() ? { href: "#/commun", texte: "Ouvrir les documents de l'équipe" } : null); } }, emoji("📁"), "Dossier « " + nomCommun() + " »"),
          h("p", { class: "phrase" }, "🔗 Un dossier rangé dans un autre s'ouvre pour les mêmes personnes, sauf s'il est 🔒 privé."))));

      // 4. Qui gère quoi
      schema.appendChild(h("section", { class: "zone-schema gestion" }, h("h2", null, emoji("🎖️"), " Qui gère quoi"),
        h("div", { class: "puces" },
          o.roles.map(function (r) {
            return h("button", { class: "puce", type: "button", onclick: function () {
              var texte = { Administrateur: "Peut tout régler dans Microsoft : comptes, licences, rôles.", Facturation: "Voit les factures, change le moyen de paiement, achète des licences.", "Gestion des comptes": "Crée ou bloque des comptes, remet des mots de passe à zéro." }[r.nom] || "";
              expliquer("🎖️", r.nom, [texte, "Aujourd'hui : " + (r.qui.join(", ") || "personne") + "."]);
            } }, emoji(r.nom === "Facturation" ? "💶" : "🔑"), r.nom + " : " + (r.qui.join(", ") || "—"));
          }),
          h("button", { class: "puce", type: "button", onclick: function () { expliquer("🏰", "Gestionnaires", ["Ils choisissent qui peut ouvrir chaque dossier (propriétaires du site SharePoint).", "Aujourd'hui : " + (o.proprietaires.join(", ") || "—") + "."]); } },
            emoji("🏰"), "Gestionnaires : " + (o.proprietaires.join(", ") || "—")))));
      zone.appendChild(schema);
    }).catch(function (e) { if (toujoursLa(gen, zone)) { zone.textContent = ""; zone.appendChild(blocErreur(e, EB.rendre)); } });
  }

  /* ------------------------------------------------------------------ */
  /* #/journal                                                           */
  /* ------------------------------------------------------------------ */
  function ecranJournal(app) {
    app.appendChild(EB.barre("Mes dernières actions", { href: "#/fichiers", texte: "Documents" }));
    app.appendChild(h("p", { class: "aide-ecran" }, "Les changements faits depuis ce téléphone (gardés sur ce téléphone)."));
    var j = EB.lire("eb:journal", []);
    if (!j.length) { app.appendChild(h("p", { class: "vide" }, "Rien pour l'instant.")); return; }
    app.appendChild(h("div", { class: "journal" }, j.map(function (e) {
      var t = Date.parse(e.quand);
      return h("div", { class: "ligne-journal" },
        h("span", { class: "quand" }, isNaN(t) ? e.quand : EB.fmt(t, { day: "numeric", month: "short" }) + " · " + EB.heure(t)),
        h("b", null, e.action), h("span", null, e.cible), e.qui ? h("small", null, e.qui) : null);
    })));
  }

  /* ------------------------------------------------------------------ */
  /* Enregistrement des écrans                                           */
  /* ------------------------------------------------------------------ */
  EB.ecran("commun", ecranCommun);
  EB.ecran("acces", ecranAcces);
  EB.ecran("restreindre", ecranRestreindre);
  EB.ecran("reserver", ecranReserver);
  EB.ecran("personnes", ecranPersonnes);
  EB.ecran("licences-reel", ecranLicences);
  EB.ecran("organisation", ecranOrganisation);
  EB.ecran("journal", ecranJournal);

  window.EBConnecte = {
    /** Après une connexion : droits réels en arrière-plan, puis l'appli (onglet Planning). */
    apresConnexion: function () {
      if (window.EBAcces) window.EBAcces.charger();
      var hash = location.hash || "#/";
      if (hash === "#/" || hash === "#") {
        // v5.5.1 : écran demandé avant la connexion (lien profond) d'abord ; sinon le 1er choix de « Ce que j'utilise ».
        var cible = null;
        try { cible = sessionStorage.getItem("eb:retour"); sessionStorage.removeItem("eb:retour"); } catch (e) {}
        location.hash = cible && cible !== "#/" && cible !== "#" ? cible : EB.depart();
      } else EB.rendre();
    },
    oublier: oublier,
    oublierContexte: oublierContexte,
    contexte: contexte,
    chargerEnfants: chargerEnfants,
    nomCommun: nomCommun,
    hashChemin: hashChemin,
    demanderNom: demanderNom,
    peutGererDroits: peutGererDroits,
    utilisateurs: utilisateurs,
    rolesAnnuaire: rolesAnnuaire,
    choisirPersonne: choisirPersonne,
    avatarPersonne: avatarPersonne,
    blocErreur: blocErreur,
    outilsInclus: outilsInclus,
    afficherErreur: afficherErreur,
    noter: noter,
    annuairePourDemo: function () { return Promise.reject(new Error("non utilisé")); },
    chargerPhotos: function () { return Promise.resolve(); },
  };
})();
