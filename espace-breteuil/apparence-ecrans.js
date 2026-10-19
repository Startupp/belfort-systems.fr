/*
 * Espace Breteuil — v5.7 : écran « Apparence » (Gérer › Apparence, #/apparence) et thème partagé.
 *
 * Fichier partagé (SharePoint, droits Microsoft de la personne connectée) :
 *   <dossier commun>/<config.suivi.dossier>/apparence.json   réglages pour TOUT LE MONDE (+ 5 versions précédentes)
 *   <dossier commun>/<config.suivi.dossier>/logo-<n>.png      logo (PNG, JPEG ou WebP ≤ 1 Mo)
 *   <dossier commun>/<config.suivi.dossier>/Icônes/…          icônes 192/512 proposées pour l'installation
 * Lu au démarrage (cache sur l'appareil, 10 min) et appliqué AVANT le premier rendu au lancement suivant
 * (prechargement.js lit le cache). Chacun peut garder sa propre couleur (Moi › Réglages › Couleurs).
 *
 * Qui voit l'écran : les personnes qui peuvent MODIFIER apparence.json (droits SharePoint effectifs sur le fichier ;
 * s'il n'existe pas encore : celles qui peuvent ajouter un fichier dans le dossier). Damien donne ce droit
 * à la personne choisie par le Château (voir docs/ESPACE-BRETEUIL.md, « Apparence »).
 * Tout est inséré en TEXTE (EB.h) ; le logo est ré-encodé par le navigateur (canvas) avant d'être affiché.
 */
(function () {
  "use strict";

  var EB = window.EB, A = window.EBApparence, G = window.EBGraph, C = window.EBCache, PL = window.EBPlateforme;
  if (!EB || !A) return;
  var h = EB.h, icone = EB.icone, emoji = EB.emoji;
  var X = function () { return window.EBConnecte; };
  var CFG = self.EB_CONFIG || {};
  var CLE = "eb:apparence", CLE_LOGO = "eb:apparence:logo", TTL = 10 * 60000;

  function reglage() {
    var s = CFG.suivi || {}, a = CFG.apparence || {};
    return { dossier: s.dossier || "Suivi informatique", fichier: a.fichier || "apparence.json", icones: a.icones || "Icônes" };
  }
  function connecte() { return !!(G && G.estConnecte()); }
  function sombreActuel() {
    var t = EB.reglages().theme;
    if (t === "sombre") return true; if (t === "clair") return false;
    try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) { return false; }
  }
  function introuvable(e) { return e && (e.statut === 404 || e.codeGraph === "itemNotFound"); }

  /* ------------------------------------------------------------------ */
  /* Lecture / écriture du fichier partagé                               */
  /* ------------------------------------------------------------------ */
  function cache() { var c = EB.lire(CLE, null); return c && typeof c === "object" ? c : null; }
  function partage() { var c = cache(); return c && c.donnees ? c.donnees : null; }
  function base(c) { return "/drives/" + c.drive.id + "/root:/" + [X().nomCommun(), reglage().dossier].map(encodeURIComponent).join("/"); }
  function cheminServeur(c, nom) {
    var racine = decodeURIComponent(new URL(c.drive.webUrl).pathname).replace(/\/+$/, "");
    return racine + "/" + X().nomCommun() + "/" + reglage().dossier + (nom ? "/" + nom : "");
  }
  function reappliquer() { if (window.EBAppliquerPalette) window.EBAppliquerPalette(EB.reglages()); }

  /** Lit apparence.json (null s'il n'existe pas encore). */
  function lireFichier(c) {
    return G.graph("GET", base(c) + "/" + encodeURIComponent(reglage().fichier) + ":/content").then(function (j) {
      var v = A.valider(j);
      return v.ok ? v.donnees : null;
    }, function (e) { if (introuvable(e)) return null; throw e; });
  }
  var enCours = null;
  /** Charge le thème du Château (cache 10 min), le réapplique s'il a changé, met le logo à jour. */
  function charger(force) {
    if (!connecte() || !X()) return Promise.resolve(partage());
    var c0 = cache();
    if (!force && c0 && Date.now() - (c0.quand || 0) < TTL) return Promise.resolve(c0.donnees || null);
    if (enCours) return enCours;
    enCours = X().contexte().then(function (c) {
      if (!c || !c.drive) return partage();
      return lireFichier(c).then(function (d) {
        var avant = JSON.stringify((c0 && c0.donnees) || null);
        EB.ecrire(CLE, { donnees: d, quand: Date.now() });
        if (JSON.stringify(d) !== avant) reappliquer();
        return chargerLogo(c, d).then(function () { return d; });
      });
    }).catch(function () { return partage(); }).then(function (d) { enCours = null; return d; });
    return enCours;
  }

  /* ------------------------------------------------------------------ */
  /* Logo : téléchargé avec le jeton, réduit (canvas), gardé sur l'appareil */
  /* ------------------------------------------------------------------ */
  function logo() { var l = EB.lire(CLE_LOGO, null); var d = partage(); return l && l.data && d && d.logo && l.version === d.logo.version ? l.data : null; }
  function image(src) {
    return new Promise(function (ok, ko) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = function () { ko(new Error("image illisible")); }; i.src = src; });
  }
  /** Image → PNG réduit (côté le plus long ≤ max), en data: (gardé sur l'appareil, affichable avant la connexion). */
  function reduire(img, max) {
    var k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    var cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/png");
  }
  function majLogos() {
    var src = logo();
    document.querySelectorAll("img[data-logo-chateau]").forEach(function (el) { if (src) { el.src = src; el.hidden = false; } else if (el.hasAttribute("data-logo-optionnel")) el.hidden = true; });
  }
  function chargerLogo(c, d) {
    if (!d || !d.logo) { EB.ecrire(CLE_LOGO, null); majLogos(); return Promise.resolve(); }
    var l = EB.lire(CLE_LOGO, null);
    if (l && l.version === d.logo.version && l.data) return Promise.resolve();
    return G.graphPhoto(base(c) + "/" + encodeURIComponent(d.logo.fichier) + ":/content").then(function (url) {
      if (!url) return;
      return image(url).then(function (img) { EB.ecrire(CLE_LOGO, { version: d.logo.version, data: reduire(img, 256) }); URL.revokeObjectURL(url); majLogos(); });
    }).catch(function () {});
  }
  /** Petit logo pour l'en-tête et le premier écran (rien s'il n'y en a pas). */
  function imgLogo(cls, optionnel) {
    var src = logo();
    return h("img", { class: cls, src: src || "icones/icon.svg", alt: "", "data-logo-chateau": "", "data-logo-optionnel": optionnel ? "" : null, hidden: optionnel && !src });
  }

  /* ------------------------------------------------------------------ */
  /* Droit de modifier (droits SharePoint effectifs)                     */
  /* ------------------------------------------------------------------ */
  function droitsDe(chemin, type) {
    return G.sp("GET", "/_api/web/Get" + type + "ByServerRelativePath(decodedurl='" + encodeURIComponent(chemin.replace(/'/g, "''")) + "')/ListItemAllFields/EffectiveBasePermissions");
  }
  /** Vrai si la personne peut modifier apparence.json (ou en créer un dans le dossier). */
  function peutModifier() {
    if (!connecte() || !X()) return Promise.resolve(false);
    return C.obtenir("apparence:droit", function () {
      return X().contexte().then(function (c) {
        var P = window.EBProfil;
        return droitsDe(cheminServeur(c, reglage().fichier), "File").then(function (p) { return P.aLeBit(p.Low, p.High, 2); }, function (e) {
          if (!introuvable(e)) throw e;
          return droitsDe(cheminServeur(c), "Folder").then(function (p) { return P.aLeBit(p.Low, p.High, 1); });
        });
      }).catch(function () { return false; });
    }, { ttl: 5 * 60000 });
  }

  function qui() { var me = window.EBAcces && window.EBAcces.me(), c = (G && G.compte()) || {}; return (me && me.displayName) || c.name || "?"; }
  /** Écrit la nouvelle version (l'ancienne passe dans l'historique) et l'applique tout de suite. */
  function ecrire(nouveau) {
    return X().contexte().then(function (c) {
      return lireFichier(c).then(function (actuel) {
        var n = A.historiser(actuel, nouveau, qui(), new Date().toISOString());
        var blob = new Blob([JSON.stringify(n, null, 2)], { type: "application/json" });
        return G.televerser(base(c) + "/" + encodeURIComponent(reglage().fichier), blob, null, "replace").then(function () {
          var v = A.valider(n).donnees;
          EB.ecrire(CLE, { donnees: v, quand: Date.now() });
          reappliquer();
          return chargerLogo(c, v).then(function () { return v; });
        });
      });
    });
  }
  function ecrireTel(d) { // version précédente déjà construite (historique raccourci) : écrite telle quelle
    return X().contexte().then(function (c) {
      var blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
      return G.televerser(base(c) + "/" + encodeURIComponent(reglage().fichier), blob, null, "replace").then(function () {
        var v = A.valider(d).donnees; EB.ecrire(CLE, { donnees: v, quand: Date.now() }); reappliquer(); return v;
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Icônes d'installation (192 / 512 / masquable), dessinées en canvas  */
  /* ------------------------------------------------------------------ */
  function icone_(img, cote, marge, fond) {
    var cv = document.createElement("canvas"); cv.width = cv.height = cote;
    var x = cv.getContext("2d"); x.fillStyle = fond; x.fillRect(0, 0, cote, cote);
    var p = A.placerDansCarre(img.naturalWidth, img.naturalHeight, cote, marge);
    x.imageSmoothingQuality = "high"; x.drawImage(img, p.x, p.y, p.l, p.h);
    return cv;
  }
  function versBlob(cv) { return new Promise(function (ok) { cv.toBlob(ok, "image/png"); }); }

  /* ------------------------------------------------------------------ */
  /* Écran                                                               */
  /* ------------------------------------------------------------------ */
  function segments(titre, options, valeur, choisir, attrs) {
    var seg = h("div", { class: "segments", role: "group", "aria-label": titre, style: { "--n": String(options.length) } });
    function maj(v) { Array.prototype.forEach.call(seg.children, function (b, i) { b.setAttribute("aria-pressed", String(options[i][0] === v)); }); }
    options.forEach(function (o) { seg.appendChild(h("button", { type: "button", "data-valeur": o[0], title: o[2] || null, onclick: function () { choisir(o[0]); maj(o[0]); } }, o[1])); });
    maj(valeur);
    return h("div", Object.assign({ class: "ap-reglage" }, attrs || {}), h("h3", null, titre), seg);
  }
  function quand(iso) {
    var t = Date.parse(iso || ""); if (isNaN(t)) return "";
    return EB.fmt(t, { day: "numeric", month: "long", year: "numeric" }) + " à " + EB.heure(t);
  }

  function apercu(app, sombre, logoSrc) {
    var v = A.apercu(app, sombre);
    var el = h("div", { class: "ap-apercu", "data-apercu": sombre ? "sombre" : "clair", role: "img", "aria-label": "Aperçu de l'application avec ces réglages (" + (sombre ? "sombre" : "clair") + ")" },
      h("div", { class: "ap-tete" }, logoSrc ? h("img", { class: "ap-logo", src: logoSrc, alt: "" }) : null,
        h("div", null, h("b", null, "Accueil"), h("small", null, "Mardi 14 octobre"))),
      h("div", { class: "ap-corps" },
        h("div", { class: "ap-tuile" }, h("span", { class: "ap-ico" }, icone("agenda")), h("span", null, h("b", null, "Planning"), h("small", null, "Les rendez-vous du Château"))),
        h("div", { class: "ap-carte" }, h("b", null, "Réunion d'équipe"), h("small", null, "10 h · Salon des tapisseries")),
        h("div", { class: "ap-pastilles" }, ["confirmer", "envoyee", "cours", "termine"].map(function (k, i) {
          return h("span", { class: "ap-pastille " + k }, ["À confirmer", "Proposition envoyée", "En cours", "Terminé"][i]);
        })),
        h("div", { class: "ap-boutons" }, h("span", { class: "ap-btn" }, "Bouton"), h("span", { class: "ap-btn secondaire" }, "Secondaire"))));
    Object.keys(v).forEach(function (k) { el.style.setProperty(k, v[k]); });
    return el;
  }

  var etat = { brouillon: null, logo: null, fondIcone: "clair", apercuSombre: null };

  function ecran(app) {
    app.appendChild(EB.barre("Apparence", EB.hub(), null, "Pour tout le monde"));
    var zone = h("div", { class: "ap-zone" }, EB.squelette(4));
    app.appendChild(zone);
    Promise.all([peutModifier(), charger(true)]).then(function (r) {
      if (!document.body.contains(zone)) return;
      zone.textContent = "";
      if (!r[0]) {
        zone.appendChild(h("div", { class: "bandeau info", role: "note", "data-etat": "reserve" }, icone("cadenas"),
          h("span", null, h("strong", null, "Réservé à la personne qui choisit l'apparence du Château."),
            "Il faut pouvoir modifier le fichier « apparence.json » des documents de l'équipe. Demandez à Damien.")));
        zone.appendChild(h("div", { class: "actions-liste" }, EB.action("#/reglages", "🎨", "Ma couleur à moi", "Moi › Réglages › Couleurs (seulement sur cet appareil)")));
        return;
      }
      editeur(zone, r[1]);
    });
  }

  function editeur(zone, sauve) {
    var origine = A.reglagesDe(sauve || A.defaut());
    if (!etat.brouillon) etat.brouillon = A.reglagesDe(origine);
    if (etat.apercuSombre == null) etat.apercuSombre = sombreActuel();
    var b = etat.brouillon;
    var racineEl = h("div", { class: "ap-grille" });
    var colonne = h("div", { class: "ap-reglages" }), cote = h("div", { class: "ap-cote" });
    var placeApercu = h("div", { class: "ap-place-apercu" });
    var msgP = h("p", { class: "ap-msg", role: "status", "data-msg": "primaire" }), msgA = h("p", { class: "ap-msg", role: "status", "data-msg": "accent" });
    var couleurP = h("input", { type: "color", id: "ap-primaire", "data-couleur": "primaire" }), couleurA = h("input", { type: "color", id: "ap-accent", "data-couleur": "accent" });
    var palettes = h("div", { class: "ap-palettes", role: "group", "aria-label": "Palettes" });

    function modifie() { return !A.memesReglages(b, origine); }
    function majTout() {
      var c = A.couleursDe(b);
      couleurP.value = c.primaire.toLowerCase(); couleurA.value = c.accent.toLowerCase();
      Array.prototype.forEach.call(palettes.children, function (x) { x.setAttribute("aria-pressed", String(x.getAttribute("data-palette") === b.palette)); });
      placeApercu.textContent = "";
      placeApercu.appendChild(apercu(b, etat.apercuSombre, etat.logo ? etat.logo.apercu : logo()));
      racineEl.setAttribute("data-modifie", modifie() ? "oui" : "non");
      boutons.appliquer.disabled = !modifie();
      boutons.annuler.hidden = !modifie();
    }

    A.PALETTES.forEach(function (p) {
      var v = A.apercu({ palette: p.id }, false);
      palettes.appendChild(h("button", { type: "button", class: "ap-pal", "data-palette": p.id, "aria-pressed": "false", onclick: function () {
        b.palette = p.id; b.primaire = null; b.accent = null; b.ton = null; msgP.textContent = ""; msgA.textContent = ""; majTout();
      } }, h("span", { class: "ap-nuancier", "aria-hidden": "true" }, [v["--entete"], v["--primaire"], v["--or"], v["--fond"]].map(function (x) { var i = h("i"); i.style.background = x; return i; })),
        h("span", { class: "ap-pal-nom" }, h("b", null, p.nom), h("small", null, p.phrase))));
    });
    function surCouleur(input, role, msg) {
      input.addEventListener("change", function () {
        var r = A.verifierCouleur(input.value, role);
        msg.className = "ap-msg" + (r.ok ? (r.ajustee ? " ajustee" : "") : " erreur");
        msg.textContent = r.ok ? (r.ajustee ? r.message : "") : r.message;
        if (r.ok) b[role] = r.couleur;
        majTout();
      });
    }
    surCouleur(couleurP, "primaire", msgP); surCouleur(couleurA, "accent", msgA);

    colonne.appendChild(h("section", { class: "section" }, h("h2", null, "1. Une palette"), palettes));
    colonne.appendChild(h("section", { class: "section" }, h("h2", null, "2. Ajuster (facultatif)"),
      h("div", { class: "ap-couleurs" },
        h("div", { class: "ap-couleur" }, h("label", { for: "ap-primaire" }, h("b", null, "Couleur principale"), h("small", null, "En-tête, boutons, liens")), couleurP, msgP),
        h("div", { class: "ap-couleur" }, h("label", { for: "ap-accent" }, h("b", null, "Couleur d'accent"), h("small", null, "Filets, points, soulignés")), couleurA, msgA)),
      h("p", { class: "aide-ecran" }, "L'appli vérifie chaque couleur : si le texte devenait difficile à lire, elle l'ajuste un peu ou la refuse."),
      h("button", { type: "button", class: "btn secondaire", "data-action": "ap-couleurs-palette", onclick: function () { b.primaire = null; b.accent = null; msgP.textContent = ""; msgA.textContent = ""; majTout(); } }, "Reprendre les couleurs de la palette"),
      h("div", { class: "ap-segments" },
        segments("Ton du fond", A.TONS, b.ton || (A.palette(b.palette) || {}).ton, function (v) { b.ton = v; majTout(); }, { "data-reglage": "ton" }),
        segments("Coins", A.COINS, b.coins, function (v) { b.coins = v; majTout(); }, { "data-reglage": "coins" }),
        segments("Police", A.POLICES, b.police, function (v) { b.police = v; majTout(); }, { "data-reglage": "police" }),
        segments("En-tête", A.ENTETES, b.entete, function (v) { b.entete = v; majTout(); }, { "data-reglage": "entete" }))));

    var boutons = {
      appliquer: h("button", { type: "button", class: "btn large", "data-action": "ap-appliquer", onclick: appliquer }, icone("coche"), "Appliquer pour tout le monde"),
      annuler: h("button", { type: "button", class: "btn secondaire large", "data-action": "ap-annuler", onclick: function () { etat.brouillon = null; EB.rendre(); } }, "Annuler mes changements"),
    };
    function appliquer() {
      EB.confirmer({ emoji: "🎨", titre: "Appliquer pour tout le monde ?", phrase: "Toute l'équipe verra ces couleurs dès sa prochaine ouverture de l'appli.",
        consequence: "Vous pourrez revenir en arrière (les 5 dernières versions sont gardées).", bouton: "Oui, appliquer" }).then(function (ok) {
        if (!ok) return;
        boutons.appliquer.disabled = true; boutons.appliquer.classList.add("en-cours");
        var n = A.reglagesDe(b); n.logo = sauve ? sauve.logo : null; n.icone = sauve ? sauve.icone : null;
        ecrire(n).then(function () { etat.brouillon = null; EB.toast("C'est appliqué pour tout le monde."); EB.rendre(); }, erreur);
      });
    }
    function erreur(e) { boutons.appliquer.classList.remove("en-cours"); boutons.appliquer.disabled = false; X().afficherErreur ? X().afficherErreur(e) : EB.toast((e && e.message) || "Erreur"); }

    var precedent = sauve && sauve.historique && sauve.historique[0];
    var actions = h("div", { class: "actions pile ap-actions" }, boutons.appliquer, boutons.annuler,
      precedent ? h("button", { type: "button", class: "btn secondaire large", "data-action": "ap-precedente", onclick: function () {
        EB.confirmer({ emoji: "↩️", titre: "Revenir à la version précédente ?", phrase: "Celle du " + quand(precedent.modifieLe) + (precedent.modifiePar ? " (" + precedent.modifiePar + ")" : "") + ".",
          bouton: "Oui, revenir", deuxEtapes: false }).then(function (ok) {
          if (ok) ecrireTel(A.versionPrecedente(sauve)).then(function () { etat.brouillon = null; EB.toast("Version précédente remise."); EB.rendre(); }, erreur);
        });
      } }, "↩️ Revenir à la version précédente") : null,
      h("button", { type: "button", class: "btn secondaire large", "data-action": "ap-original", onclick: function () {
        EB.confirmer({ emoji: "🏰", titre: "Revenir à l'original ?", phrase: "Crème et praline, coins doux, police classique. Le logo reste.", consequence: "Toute l'équipe retrouvera les couleurs d'origine.", bouton: "Oui, l'original" }).then(function (ok) {
          if (!ok) return;
          var n = A.defaut(); n.logo = sauve ? sauve.logo : null; n.icone = sauve ? sauve.icone : null;
          ecrire(n).then(function () { etat.brouillon = null; EB.toast("Les couleurs d'origine sont revenues."); EB.rendre(); }, erreur);
        });
      } }, "Revenir à l'original"));

    var bascule = segments("Aperçu", [["clair", "Clair"], ["sombre", "Sombre"]], etat.apercuSombre ? "sombre" : "clair", function (v) { etat.apercuSombre = v === "sombre"; majTout(); }, { "data-reglage": "apercu" });
    cote.appendChild(h("div", { class: "ap-collant" }, bascule, placeApercu, actions));
    racineEl.appendChild(colonne); racineEl.appendChild(cote);
    zone.appendChild(racineEl);
    if (sauve && sauve.modifieLe) zone.appendChild(h("p", { class: "ap-signature" }, "Dernière modification : " + quand(sauve.modifieLe) + (sauve.modifiePar ? " par " + sauve.modifiePar : "") + "."));
    zone.appendChild(sectionLogo(sauve));
    if (sauve && sauve.historique && sauve.historique.length) zone.appendChild(h("section", { class: "section" }, h("h2", null, "Versions précédentes (" + sauve.historique.length + ")"),
      h("ul", { class: "ap-historique" }, sauve.historique.map(function (v, i) {
        var p = A.palette(v.palette);
        return h("li", null, h("span", null, h("b", null, (p ? p.nom : v.palette) + (v.primaire || v.accent ? " (personnalisée)" : "")), h("small", null, quand(v.modifieLe) + (v.modifiePar ? " · " + v.modifiePar : ""))),
          h("button", { type: "button", class: "btn secondaire petit", "data-action": "ap-reprendre-" + i, onclick: function () {
            etat.brouillon = A.reglagesDe(v); EB.rendre(); EB.toast("Version reprise dans l'aperçu : touchez « Appliquer » pour la remettre.");
          } }, "Voir"));
      }))));
    zone.appendChild(h("div", { class: "note" }, icone("info"), h("span", null, "Chacun peut garder sa propre couleur sur son appareil : Moi › Réglages › Couleurs. Par défaut, tout le monde suit l'apparence du Château.")));
    majTout();
  }

  /* ---------- Logo ---------- */
  function sectionLogo(sauve) {
    var sec = h("section", { class: "section ap-logo-section", "data-section": "logo" }, h("h2", null, "3. Le logo"));
    var msg = h("p", { class: "ap-msg", role: "status", "data-msg": "logo" });
    var entree = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", class: "ap-fichier", id: "ap-logo-fichier", "data-action": "ap-logo-fichier" });
    var actuel = logo();
    sec.appendChild(h("div", { class: "ap-logo-ligne" },
      h("span", { class: "ap-logo-cadre" }, actuel ? h("img", { src: actuel, alt: "Logo actuel" }) : h("span", { class: "ap-sans-logo" }, "Pas de logo")),
      h("div", null, h("label", { for: "ap-logo-fichier", class: "btn secondaire" }, icone("photo"), sauve && sauve.logo ? "Changer le logo" : "Choisir un logo"),
        h("small", { class: "ap-aide" }, "PNG, JPEG ou WebP, 1 Mo au plus. Idéal : carré, fond uni, 512 px."), entree, msg)));
    var place = h("div", { class: "ap-logo-propose" });
    sec.appendChild(place);
    entree.addEventListener("change", function () {
      var f = entree.files && entree.files[0]; place.textContent = ""; msg.className = "ap-msg";
      var refus = A.verifierLogo(f);
      if (refus) { msg.className = "ap-msg erreur"; msg.textContent = refus; return; }
      var url = URL.createObjectURL(f);
      image(url).then(function (img) {
        etat.logo = { fichier: f, img: img, apercu: reduire(img, 256) };
        msg.textContent = "Logo prêt : regardez l'aperçu, puis publiez-le.";
        proposer(place, sauve);
        var ap = document.querySelector(".ap-place-apercu .ap-tete");
        if (ap) { var vieux = ap.querySelector(".ap-logo"); if (vieux) vieux.remove(); ap.insertBefore(h("img", { class: "ap-logo", src: etat.logo.apercu, alt: "" }), ap.firstChild); }
      }, function () { msg.className = "ap-msg erreur"; msg.textContent = "Cette image ne s'ouvre pas : essayez un autre fichier."; });
    });
    if (sauve && sauve.logo) sec.appendChild(h("button", { type: "button", class: "btn secondaire", "data-action": "ap-retirer-logo", onclick: function () {
      EB.confirmer({ emoji: "🗑️", titre: "Retirer le logo ?", phrase: "L'en-tête et l'écran de connexion reprennent le dessin d'origine.", bouton: "Oui, retirer", deuxEtapes: false }).then(function (ok) {
        if (!ok) return;
        var n = A.reglagesDe(sauve); n.logo = null; n.icone = sauve.icone;
        ecrire(n).then(function () { EB.toast("Logo retiré."); EB.rendre(); });
      });
    } }, "Retirer le logo") : null);
    if (sauve && sauve.icone) sec.appendChild(h("p", { class: "aide-ecran", "data-etat": "icone" }, "Icône d'installation n° " + sauve.icone.version + " proposée" +
      (sauve.icone.demande ? " (demande n° " + sauve.icone.demande + " envoyée à Damien)" : "") + ". " + (Number((CFG.icone || {}).version || 1) >= sauve.icone.version ? "Elle est publiée." : "Damien doit encore la publier.")));
    return sec;
  }
  function proposer(place, sauve) {
    var L = etat.logo, v = A.apercu(A.reglagesDe(sauve || A.defaut()), false);
    function fond() { return etat.fondIcone === "couleur" ? v["--entete"] : etat.fondIcone === "blanc" ? "#FFFFFF" : v["--fond"]; }
    var vignettes = h("div", { class: "ap-icones" });
    function dessiner() {
      vignettes.textContent = "";
      [["Écran d'accueil", 0.12], ["Android (forme libre)", 0.2]].forEach(function (x) {
        var cv = icone_(L.img, 192, x[1], fond());
        vignettes.appendChild(h("figure", null, h("img", { src: cv.toDataURL("image/png"), alt: "Icône proposée : " + x[0], width: "96", height: "96", class: x[1] > 0.15 ? "rond" : "" }), h("figcaption", null, x[0])));
      });
    }
    place.appendChild(h("div", { class: "boite" }, h("h3", null, "Icône d'installation (proposée)"),
      segments("Fond de l'icône", [["clair", "Clair"], ["blanc", "Blanc"], ["couleur", "Couleur"]], etat.fondIcone, function (x) { etat.fondIcone = x; dessiner(); }, { "data-reglage": "fond-icone" }),
      vignettes,
      h("p", { class: "petit" }, "Le logo apparaît tout de suite pour tout le monde dans l'appli. L'icône de l'écran d'accueil, elle, doit être publiée par Damien : une demande lui est envoyée automatiquement avec les fichiers."),
      h("button", { type: "button", class: "btn large", "data-action": "ap-publier-logo", onclick: function () { publierLogo(this, sauve, fond()); } }, icone("coche"), "Publier ce logo pour tout le monde")));
    dessiner();
  }
  function publierLogo(bouton, sauve, fond) {
    var L = etat.logo;
    EB.confirmer({ emoji: "🖼️", titre: "Publier ce logo ?", phrase: "Il remplacera l'actuel dans l'appli de toute l'équipe.", bouton: "Oui, publier", deuxEtapes: false }).then(function (ok) {
      if (!ok) return;
      bouton.disabled = true; bouton.classList.add("en-cours");
      var R = reglage(), ext = A.LOGO_TYPES[L.fichier.type], version = ((sauve && sauve.logo && sauve.logo.version) || 0) + 1;
      var iv = Math.max(((sauve && sauve.icone && sauve.icone.version) || 0), Number((CFG.icone || {}).version || 1)) + 1;
      var nom = "logo-" + version + "." + ext;
      var noms = ["icone-" + iv + "-192.png", "icone-" + iv + "-512.png", "icone-" + iv + "-masquable-512.png"];
      X().contexte().then(function (c) {
        var b = base(c);
        return G.televerser(b + "/" + encodeURIComponent(nom), L.fichier, null, "replace").then(function () {
          return Promise.all([versBlob(icone_(L.img, 192, 0.12, fond)), versBlob(icone_(L.img, 512, 0.12, fond)), versBlob(icone_(L.img, 512, 0.2, fond))]);
        }).then(function (blobs) {
          return Promise.all(blobs.map(function (bl, i) { return G.televerser(b + "/" + encodeURIComponent(R.icones) + "/" + encodeURIComponent(noms[i]), bl, null, "replace"); })).then(function () { return blobs; });
        }).then(function (blobs) {
          var chemin = X().nomCommun() + " › " + R.dossier + " › " + R.icones;
          var demande = window.EBAideEcrans && window.EBAideEcrans.envoyerAuto ? window.EBAideEcrans.envoyerAuto({ type: "amelioration",
            message: "Nouveau logo à publier pour l'icône d'installation (n° " + iv + ").\nFichiers : " + noms.join(", ") + "\nDans les documents de l'équipe : " + chemin + ".\nÀ copier dans espace-breteuil/icones/ puis config.js → icone.version = " + iv + " (voir docs, « Publier l'icône »).",
            sansPj: "\n(Pièces jointes indisponibles : les fichiers sont dans le dossier ci-dessus.)" }, blobs.map(function (bl, i) { return { fichier: bl, nom: noms[i] }; })).catch(function () { return null; }) : Promise.resolve(null);
          return demande.then(function (d) {
            var n = A.reglagesDe(sauve || A.defaut());
            n.logo = { fichier: nom, version: version }; n.icone = { version: iv, fichiers: noms, demande: d && d.id ? d.id : null };
            EB.ecrire(CLE_LOGO, { version: version, data: L.apercu });
            return ecrire(n).then(function () { return d; });
          });
        });
      }).then(function (d) {
        etat.logo = null; majLogos();
        EB.toast(d && d.id ? "Logo publié. Demande n° " + d.id + " envoyée à Damien pour l'icône." : "Logo publié. Prévenez Damien pour l'icône d'installation.");
        EB.rendre();
      }, function (e) { bouton.disabled = false; bouton.classList.remove("en-cours"); if (X().afficherErreur) X().afficherErreur(e); else EB.toast("Le logo n'a pas pu être publié."); });
    });
  }

  /* ------------------------------------------------------------------ */
  /* iPhone / iPad installé : « Le logo a changé » (une fois par version) */
  /* ------------------------------------------------------------------ */
  function plateforme() {
    var standalone = false;
    try { standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true; } catch (e) {}
    return PL.detecter(navigator.userAgent, { standalone: standalone, tactile: navigator.maxTouchPoints > 1, brave: !!navigator.brave });
  }
  function verifierIcone() {
    if (!PL) return;
    var p = plateforme(), publiee = Number((CFG.icone || {}).version || 1);
    if (!p.installee) return;
    var installee = EB.lire("eb:icone-installee", null);
    if (installee == null) { EB.ecrire("eb:icone-installee", publiee); return; } // 1er lancement de l'appli installée
    if (!PL.iconeAChange(p, installee, publiee, EB.lire("eb:icone-banniere", 0))) return;
    EB.ecrire("eb:icone-banniere", publiee);
    var m = document.getElementById("maj"); if (!m) return;
    m.textContent = "";
    m.setAttribute("data-banniere", "icone");
    m.appendChild(h("span", null, emoji("🖼️"), " Le logo a changé : pour le voir sur votre écran d'accueil, supprimez puis rajoutez l'appli (30 s)"));
    m.appendChild(h("span", { class: "maj-boutons" },
      h("a", { class: "btn", href: "#/installer", "data-action": "icone-comment", onclick: function () { m.hidden = true; } }, "Comment faire"),
      h("button", { class: "btn-rond", type: "button", "aria-label": "Fermer", onclick: function () { m.hidden = true; } }, icone("croix"))));
    m.hidden = false;
  }

  /** Tuile pour Gérer (si la personne peut modifier l'apparence ; vérifié en arrière-plan). */
  function tuile(grandesTuiles) {
    var sec = h("section", { class: "section", hidden: true, "data-section": "apparence" });
    peutModifier().then(function (ok) {
      if (!ok || sec.childNodes.length) return;
      sec.appendChild(h("h2", null, "Apparence"));
      sec.appendChild(grandesTuiles([{ href: "#/apparence", emoji: "🎨", teinte: "lavande", libelle: "Apparence", sous: "Couleurs, logo et style de l'appli, pour tout le monde", action: "apparence" }]));
      sec.hidden = false;
    });
    return sec;
  }
  /** Ligne pour Moi (même condition). */
  function ligneMoi() {
    var el = h("div", { class: "ap-ligne-moi", hidden: true });
    peutModifier().then(function (ok) { if (ok) { el.appendChild(EB.action("#/apparence", "🎨", "Apparence de l'appli", "Couleurs et logo pour tout le monde")); el.hidden = false; } });
    return el;
  }

  EB.ecran("apparence", ecran);
  window.EBApparenceEcrans = { charger: charger, partage: partage, logo: logo, imgLogo: imgLogo, majLogos: majLogos, peutModifier: peutModifier, tuile: tuile, ligneMoi: ligneMoi,
    verifierIcone: verifierIcone, plateforme: plateforme, oublierBrouillon: function () { etat.brouillon = null; etat.logo = null; } };
})();
