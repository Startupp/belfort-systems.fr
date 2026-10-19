/*
 * Espace Breteuil — v5.3.1 : glisser-déposer des fichiers n'importe où dans la fenêtre.
 * Demande du client : « la fenêtre détecte automatiquement "où on est" et passe en mode
 * "téléversement" lorsqu'un fichier est déposé dans la fenêtre directement ».
 *
 *   - Un fichier survole la fenêtre (dragenter, types contenant "Files") → voile plein écran :
 *     « Déposer ici pour envoyer dans : <dossier> » + chemin lisible (Dossier commun › Finance › 2026).
 *     Écran sans dossier (Planning, Moi…) → « Ouvrez d'abord un dossier… » et rien n'est envoyé ;
 *     accueil de Fichiers → proposition d'envoyer dans « Mes documents ».
 *   - Dépôt → envoi dans CE dossier avec graph.js → televerser (≤ 4 Mo : PUT …:/content ; au-delà :
 *     session d'envoi), une barre de progression par fichier, puis liste rafraîchie et message.
 *   - Nom déjà pris → « Garder les deux » (par défaut, « nom (2).ext ») ou « Remplacer ».
 *   - Dossiers refusés (aucun envoi partiel), 250 Mo par fichier, noms nettoyés (depot.js), 403 → message humain.
 *   - Seuls les glisser de FICHIERS sont interceptés (preventDefault) : les épingles (gestes au
 *     pointeur, epingles.js) et les liens glissés ne sont pas touchés. Téléphone : rien ne change.
 */
(function () {
  "use strict";
  var EB = window.EB, G = window.EBGraph, C = window.EBCache, D = window.EBDepot;
  var X = function () { return window.EBConnecte; };
  if (!EB || !G || !D) return;
  var h = EB.h, icone = EB.icone;

  function cheminActuel() {
    return (location.hash || "#/").replace(/^#\/?/, "").split("/");
  }
  function contexteCible() {
    var A = window.EBAcces, P = window.EBProfil, S = window.EBSuiviEcrans;
    var r = A && A.resultat ? A.resultat() : null;
    var R = S ? S.reglage() : {};
    return { nomCommun: X() ? X().nomCommun() : "Commun", suiviPermis: !!(r && P && P.routePermise("suivi", r)), suiviDossier: R.dossier, guides: R.guides };
  }
  function cibleActuelle() {
    if (!G.estConnecte()) return { espace: null, proposerMoi: false };
    return D.cible(cheminActuel(), contexteCible());
  }
  function aDesFichiers(e) {
    var t = e.dataTransfer && e.dataTransfer.types;
    // v5.6 : un formulaire « Aide » avec pièces jointes est affiché → c'est lui qui reçoit les fichiers.
    var aide = document.querySelector(".aide-pj-cible");
    if (aide && aide.getClientRects().length) return false;
    return !!t && Array.prototype.indexOf.call(t, "Files") > -1;
  }

  /* ---------------- Voile ---------------- */
  var voile = null, titre = null, sous = null, profondeur = 0, minuteur = null;
  function creerVoile() {
    if (voile) return;
    titre = h("p", { class: "voile-titre", id: "voile-depot-titre" });
    sous = h("p", { class: "voile-chemin" });
    voile = h("div", { class: "voile-depot", role: "dialog", "aria-modal": "false", "aria-labelledby": "voile-depot-titre", "aria-live": "assertive", hidden: "hidden" },
      h("div", { class: "voile-carte" }, h("span", { class: "voile-icone" }, icone("installer")), titre, sous));
    document.body.appendChild(voile);
  }
  function montrer() {
    creerVoile();
    var c = cibleActuelle();
    titre.textContent = ""; sous.textContent = "";
    voile.classList.toggle("sans-cible", !c.espace && !c.proposerMoi);
    if (c.espace) {
      titre.appendChild(document.createTextNode("Déposer ici pour envoyer dans : "));
      titre.appendChild(h("b", null, c.nom));
      sous.textContent = c.lisible;
    } else {
      titre.textContent = "Ouvrez d'abord un dossier pour y déposer vos fichiers";
      sous.textContent = c.proposerMoi ? "Ou déposez-les ici : ils iront dans « Mes documents »." : "Documents › Mes documents ou Documents de l'équipe.";
    }
    voile.hidden = false;
    document.body.classList.add("depot-actif");
  }
  function cacher() {
    profondeur = 0; clearTimeout(minuteur);
    if (voile) voile.hidden = true;
    document.body.classList.remove("depot-actif");
  }

  document.addEventListener("dragenter", function (e) {
    if (!aDesFichiers(e)) return;
    e.preventDefault();
    if (profondeur++ === 0) montrer();
  });
  document.addEventListener("dragover", function (e) {
    if (!aDesFichiers(e)) return;
    e.preventDefault(); // sinon le navigateur ouvrirait le fichier
    e.dataTransfer.dropEffect = "copy";
    if (!voile || voile.hidden) montrer();
    // Glisser annulé (Échap, retour au bureau) sans dragleave : le voile part tout seul.
    clearTimeout(minuteur); minuteur = setTimeout(cacher, 700);
  });
  document.addEventListener("dragleave", function (e) {
    if (!aDesFichiers(e)) return;
    if (--profondeur <= 0) cacher();
  });
  document.addEventListener("drop", function (e) {
    if (!aDesFichiers(e)) return;
    e.preventDefault();
    cacher();
    // À lire TOUT DE SUITE : le DataTransfer est vidé après l'évènement.
    var entrees = [], items = e.dataTransfer.items;
    if (items && items.length) {
      Array.prototype.forEach.call(items, function (it) {
        if (it.kind !== "file") return;
        var ent = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null, f = it.getAsFile();
        if (ent && ent.isDirectory) entrees.push({ nom: ent.name, dossier: true });
        else if (f) entrees.push({ nom: f.name, taille: f.size, fichier: f });
      });
    } else {
      Array.prototype.forEach.call(e.dataTransfer.files || [], function (f) { entrees.push({ nom: f.name, taille: f.size, fichier: f }); });
    }
    if (entrees.length) deposer(entrees);
  });
  window.addEventListener("blur", function () { if (voile && !voile.hidden) cacher(); });

  /* ---------------- Envoi ---------------- */
  function avertir(emojiTxt, titreTxt, phrase) {
    return new Promise(function (fin) {
      var d = EB.dialogue(), fini = false;
      function terminer() { if (fini) return; fini = true; EB.fermerDialogue(); fin(); }
      d.oncancel = terminer;
      var ok = h("button", { class: "btn large", type: "button", onclick: terminer }, "J'ai compris");
      d.appendChild(h("div", { class: "contenu centre", "data-avertissement": "depot" }, EB.emoji(emojiTxt, "grand"),
        h("h2", { id: "detail-titre" }, titreTxt), phrase ? h("p", { class: "phrase" }, phrase) : null, ok));
      EB.ouvrirDialogue(d, ok);
    });
  }
  function liste(l) { return l.map(function (x) { return "« " + x.nom + " »"; }).join(", "); }

  function deposer(entrees) {
    var c = cibleActuelle();
    if (!G.estConnecte()) return avertir("🔑", "Connectez-vous d'abord", "Le dépôt de fichiers demande d'être connecté à Microsoft 365.");
    var t = D.trier(entrees);
    if (t.dossiers.length) {
      return avertir("📁", "Les dossiers ne peuvent pas être déposés, déposez les fichiers",
        "Ouvrez le dossier " + liste(t.dossiers) + " sur votre ordinateur, sélectionnez les fichiers qu'il contient et glissez-les ici. Rien n'a été envoyé.");
    }
    var debut = function () { return c; };
    if (!c.espace) {
      if (!c.proposerMoi) return EB.toast("Ouvrez d'abord un dossier pour y déposer vos fichiers.");
      // Ouverte seulement APRÈS l'éventuel message « trop lourd » (une seule fenêtre à la fois).
      debut = function () { return EB.confirmer({ emoji: "⬆️", titre: "Envoyer dans « Mes documents » ?", deuxEtapes: false,
        phrase: "Aucun dossier n'est ouvert. " + (t.fichiers.length > 1 ? "Les " + t.fichiers.length + " fichiers iront" : "Le fichier ira") + " dans « Mes documents » (votre OneDrive).",
        bouton: "Oui, envoyer dans Mes documents" }).then(function (ok) { return ok ? D.cible(["onedrive"], {}) : null; }); };
    }
    var avant = t.tropGros.length ? avertir("📦", "Fichier trop lourd (250 Mo au plus)",
      liste(t.tropGros) + (t.tropGros.length > 1 ? " ne seront pas envoyés." : " ne sera pas envoyé.") + " Déposez-le directement dans OneDrive ou SharePoint, ou demandez à Damien."
      + (t.fichiers.length ? " Les autres fichiers sont envoyés." : "")) : Promise.resolve();
    avant.then(function () { return t.fichiers.length ? debut() : null; }).then(function (cible) {
      if (!cible) return;
      return envoyer(cible, t.fichiers);
    }).catch(function (e) { X().afficherErreur(e); });
  }

  function driveDe(cible) {
    if (cible.espace === "moi") return C.obtenir("fichiers:drive", function () { return G.graph("GET", "/me/drive?$select=id,webUrl"); }, { ttl: 3600000 }).then(function (d) { return d.id; });
    return X().contexte().then(function (c) { if (!c || !c.drive) throw new Error("Les documents de l'équipe sont introuvables."); return c.drive.id; });
  }
  function nomsExistants(drive, segs) {
    var chemin = segs.length ? "/drives/" + drive + "/root:/" + segs.map(encodeURIComponent).join("/") + ":/children" : "/drives/" + drive + "/root/children";
    return G.graphTout(chemin + "?$select=name&$top=999").then(function (l) { return (l || []).map(function (x) { return x.name; }); },
      function (e) { if (e && (e.statut === 404 || e.codeGraph === "itemNotFound")) return []; throw e; });
  }

  function envoyer(cible, fichiers) {
    fichiers.forEach(function (f) { f.nomPropre = D.nettoyerNom(f.nom); });
    var drive;
    return driveDe(cible).then(function (d) { drive = d; return nomsExistants(d, cible.segs); }).then(function (existants) {
      var doublons = D.conflits(fichiers.map(function (f) { return f.nomPropre; }), existants);
      var choix = doublons.length ? EB.choisir(doublons.length > 1 ? doublons.length + " fichiers portent déjà ce nom" : "« " + doublons[0] + " » existe déjà",
        [{ valeur: "deux", emoji: "📑", titre: "Garder les deux", sous: "Le nouveau devient « " + D.nomLibre(doublons[0], existants) + " »" },
          { valeur: "remplacer", emoji: "♻️", titre: "Remplacer", sous: "Le fichier déjà présent est remplacé par le nouveau" }],
        "Dans « " + cible.nom + " ». Rien n'est écrasé sans votre accord.") : Promise.resolve("deux");
      return choix.then(function (mode) {
        if (!mode) { EB.toast("Envoi annulé : rien n'a été envoyé."); return; }
        var pris = existants.slice();
        fichiers.forEach(function (f) {
          f.nomFinal = mode === "remplacer" ? f.nomPropre : D.nomLibre(f.nomPropre, pris);
          pris.push(f.nomFinal);
        });
        return televerserTous(cible, drive, fichiers, mode === "remplacer" ? "replace" : "rename");
      });
    });
  }

  function panneau(cible, fichiers) {
    var lignes = fichiers.map(function (f) {
      var barre = h("progress", { max: "1", value: "0", "aria-label": "Envoi de " + f.nomFinal });
      f.barre = barre;
      return h("li", null, h("span", { class: "nom" }, f.nomFinal), barre);
    });
    var el = h("div", { class: "envoi-depot", role: "status", "aria-live": "polite" },
      h("p", null, icone("installer"), h("b", null, "Envoi dans « " + cible.nom + " »")), h("ul", null, lignes));
    document.body.appendChild(el);
    return el;
  }

  function televerserTous(cible, drive, fichiers, comportement) {
    var el = panneau(cible, fichiers), n = 0, suite = Promise.resolve();
    fichiers.forEach(function (f) {
      suite = suite.then(function () {
        return G.televerser(D.cheminGraph(drive, cible.segs, f.nomFinal), f.fichier, function (p) { f.barre.value = p; }, comportement).then(function () { f.barre.value = 1; n++; });
      });
    });
    return suite.then(function () {
      el.remove();
      fini(cible, n);
    }, function (e) {
      el.remove();
      if (n) fini(cible, n, true);
      if (e && e.statut === 403) return avertir("🔒", "Vous n'avez pas le droit d'ajouter des fichiers dans ce dossier",
        "Demandez à un responsable du Château de vous en donner l'accès, ou choisissez un autre dossier." + (n ? " " + D.messageSucces(n, cible.nom) + " avant l'arrêt." : ""));
      throw e;
    });
  }
  function fini(cible, n, partiel) {
    if (X()) X().noter("Fichier déposé", n + " fichier" + (n > 1 ? "s" : "") + " → " + cible.lisible);
    C.oublier("fichiers:*"); C.oublier("enfants:*"); C.oublier("suivi:*");
    if (!partiel) EB.toast(D.messageSucces(n, cible.nom) + ".");
    EB.rendre();
  }

  window.EBDepotEcran = { montrer: montrer, cacher: cacher, cible: cibleActuelle };
})();
