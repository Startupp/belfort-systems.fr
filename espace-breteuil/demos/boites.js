/*
 * Espace Breteuil — démo « Les boîtes mail ».
 * Boîtes personnelles et partagées avec leur photo ; changer la photo d'une boîte partagée
 * (appareil photo ou galerie, recadrage carré, aperçu — la photo reste sur l'appareil) ;
 * qui peut ouvrir la boîte et qui peut envoyer en son nom.
 */
(function () {
  "use strict";
  var EB = window.EB, D = window.EBDemos, X = window.EBD;
  if (!EB || !D || !X) return;
  var h = EB.h;
  var onglet = "partagees";

  function nbAcces(acces) { var n = Object.keys(acces || {}).length; return n ? n + " personne" + (n > 1 ? "s" : "") : "Personne"; }

  function ecranBoites(app, chemin) {
    if (chemin[1] === "perso" && chemin[2]) return ecranBoitePerso(app, chemin[2]);
    if (chemin[1]) return ecranBoite(app, chemin[1]);
    if (!X.entete(app, "Les boîtes mail", ["admin"])) return;
    var etat = X.etat();
    app.appendChild(h("p", { class: "aide-ecran" }, "📬 Une boîte partagée, c'est une adresse lue par plusieurs personnes, comme contact@. Touchez une boîte pour la régler."));
    var seg = h("div", { class: "segments", role: "group", "aria-label": "Type de boîte", style: { "--n": "2" } });
    [["partagees", "Partagées (" + etat.boites.length + ")"], ["perso", "Personnelles (" + D.actifs(etat.personnes).length + ")"]].forEach(function (o) {
      seg.appendChild(h("button", { type: "button", "aria-pressed": String(onglet === o[0]), onclick: function () { onglet = o[0]; EB.rendre(); } }, o[1]));
    });
    app.appendChild(seg);
    var grille = h("div", { class: "grille-boites section-proche" });
    if (onglet === "partagees") etat.boites.forEach(function (b) {
      grille.appendChild(h("a", { class: "tuile-boite", href: "#/boites/" + encodeURIComponent(b.id) },
        X.vignetteBoite(b), h("b", null, b.nom), h("small", null, b.adresse), h("small", null, "👥 " + nbAcces(b.acces))));
    });
    else D.actifs(etat.personnes).forEach(function (p) {
      var dl = etat.delegations[p.id] || {}, autres = Object.keys(dl);
      grille.appendChild(h("a", { class: "tuile-boite", href: "#/boites/perso/" + encodeURIComponent(p.id) },
        EB.avatar(p), h("b", null, p.prenom), h("small", null, p.adresse),
        h("small", null, autres.length ? "👥 + " + autres.map(X.prenom).join(", ") : "🔒 Personne d'autre")));
    });
    app.appendChild(grille);
    app.appendChild(EB.pied());
  }

  /* Interrupteur accessible (role="switch"). */
  function interrupteur(texte, actif, onclick) {
    return h("button", { class: "interrupteur", type: "button", role: "switch", "aria-checked": String(!!actif), onclick: onclick },
      h("span", { class: "texte" }, texte), h("span", { class: "rail", "aria-hidden": "true" }));
  }

  /** Liste « qui peut ouvrir / envoyer en son nom ». acces : objet { id: "ouvrir" | "envoyer" }. */
  function listeAcces(acces, nomBoite, adresse, apres, exclure) {
    var etat = X.etat();
    var ids = Object.keys(acces).filter(function (id) { return D.personne(etat, id); });
    function changer(id, niveau, titre, phrase, bouton, action) {
      EB.confirmer({ emoji: niveau ? "📨" : "➖", titre: titre, phrase: phrase,
        consequence: "Le changement sera immédiat. En démo, il reste seulement sur ce téléphone.", bouton: bouton }).then(function (ok) {
        if (!ok) return;
        if (niveau) acces[id] = niveau; else delete acces[id];
        X.sauver(action, X.prenom(id) + " → " + nomBoite + (niveau === "envoyer" ? " (envoyer en son nom)" : niveau === "ouvrir" ? " (ouvrir)" : ""));
        if (apres) apres();
        EB.rendre();
      });
    }
    var zone = h("div", { class: "liste-acces" }, ids.length ? ids.map(function (id) {
      var p = D.personne(etat, id), n = acces[id];
      return h("div", { class: "ligne-acces" }, EB.avatar(p),
        h("div", { class: "qui" }, h("b", null, p.prenom), h("small", null, p.poste)),
        h("div", { class: "interrupteurs" },
          interrupteur("📖 Ouvrir la boîte", true, function () {
            changer(id, null, "Retirer l'accès de " + p.prenom + " ?", p.prenom + " ne verra plus la boîte " + adresse + " dans son Outlook.", "Oui, retirer", "Accès retiré");
          }),
          interrupteur("📨 Envoyer en son nom", n === "envoyer", function () {
            if (n === "envoyer") changer(id, "ouvrir", "Ne plus envoyer au nom de " + nomBoite + " ?", p.prenom + " pourra encore lire la boîte, mais plus écrire en son nom.", "Oui, retirer l'envoi", "Envoi retiré");
            else changer(id, "envoyer", "Laisser " + p.prenom + " écrire au nom de " + nomBoite + " ?", "Ses mails partiront avec l'adresse " + adresse + ".", "Oui, autoriser", "Envoi autorisé");
          })));
    }) : h("p", { class: "vide" }, "Personne d'autre ne peut l'ouvrir."));
    var candidats = D.actifs(etat.personnes).filter(function (p) { return !acces[p.id] && p.id !== exclure; });
    var ajouter = h("button", { class: "btn secondaire", type: "button", onclick: function () {
      EB.choisir("Qui pourra ouvrir " + nomBoite + " ?", candidats.map(function (p) { return { valeur: p.id, titre: p.prenom, sous: p.poste, avatar: EB.avatar(p) }; }), "Touchez la personne.")
        .then(function (id) {
          if (!id) return;
          changer(id, "ouvrir", "Donner accès à " + X.prenom(id) + " ?", X.prenom(id) + " verra la boîte " + adresse + " dans son propre Outlook.", "Oui, donner l'accès", "Accès donné");
        });
    } }, EB.icone("plus"), "Ajouter une personne");
    return h("div", null, zone, candidats.length ? h("div", { class: "actions" }, ajouter) : null);
  }

  function ecranBoite(app, id) {
    var etat = X.etat(), b = D.boite(etat, id);
    if (!b) { location.replace("#/boites"); return; }
    if (!X.entete(app, "Boîte " + b.nom, ["admin"], { href: "#/boites", texte: "Boîtes" })) return;
    app.appendChild(h("div", { class: "fiche-boite" }, X.vignetteBoite(b, "grande"), h("h2", null, b.nom), h("p", null, b.adresse),
      h("div", { class: "actions" },
        h("button", { class: "btn", type: "button", onclick: function () { choisirPhoto(b); } }, EB.icone("photo"), b.photo ? "Changer la photo" : "Ajouter une photo"),
        b.photo ? h("button", { class: "btn secondaire", type: "button", onclick: function () {
          EB.confirmer({ emoji: "🗑️", titre: "Retirer la photo de " + b.nom + " ?", phrase: "Le pictogramme " + b.emoji + " reviendra à la place.", consequence: "La photo sera effacée de ce téléphone.", bouton: "Oui, retirer" })
            .then(function (ok) { if (!ok) return; b.photo = null; X.sauver("Photo retirée", "Boîte " + b.nom); EB.rendre(); });
        } }, "Retirer la photo") : null),
      h("p", { class: "petit" }, "La photo s'affiche à côté des mails envoyés depuis cette boîte. En démo, elle reste sur ce téléphone.")));
    app.appendChild(h("section", { class: "section" }, h("h2", null, EB.emoji("👥"), " Qui peut l'ouvrir ?"),
      h("p", { class: "aide" }, "« Ouvrir » : lire et ranger les mails. « Envoyer en son nom » : écrire avec l'adresse " + b.adresse + "."),
      listeAcces(b.acces, b.nom, b.adresse)));
    app.appendChild(EB.pied());
  }

  function ecranBoitePerso(app, id) {
    var etat = X.etat(), p = D.personne(etat, id);
    if (!p) { location.replace("#/boites"); return; }
    if (!X.entete(app, "Boîte de " + p.prenom, ["admin"], { href: "#/boites", texte: "Boîtes" })) return;
    etat.delegations[id] = etat.delegations[id] || {};
    app.appendChild(h("div", { class: "fiche-boite" }, EB.avatar(p, "grand"), h("h2", null, p.prenom), h("p", null, p.adresse),
      h("p", { class: "petit" }, "La photo d'une boîte personnelle est celle de la personne : elle la change elle-même.")));
    app.appendChild(h("section", { class: "section" }, h("h2", null, EB.emoji("🤝"), " Qui d'autre peut l'ouvrir ?"),
      h("p", { class: "aide" }, p.prenom + " a toujours accès à sa boîte. Ajoutez quelqu'un seulement si " + p.prenom + " est d'accord (absence longue, départ)."),
      listeAcces(etat.delegations[id], "la boîte de " + p.prenom, p.adresse, null, id)));
    app.appendChild(EB.pied());
  }

  /* ------------------------------------------------------------------ */
  /* Photo : appareil photo ou galerie, puis recadrage carré             */
  /* ------------------------------------------------------------------ */
  function choisirPhoto(b) {
    var d = EB.dialogue();
    function entree(capture) {
      var inp = h("input", { type: "file", accept: "image/*", "aria-label": capture ? "Prendre une photo" : "Choisir une image" });
      if (capture) inp.setAttribute("capture", "environment");
      inp.addEventListener("change", function () { if (inp.files && inp.files[0]) recadrer(b, inp.files[0]); });
      return inp;
    }
    var appareil = h("label", { class: "carte-choix bouton-fichier" }, h("span", { class: "emoji carte-choix-emoji", "aria-hidden": "true" }, "📷"),
      h("span", { class: "carte-choix-texte" }, h("b", null, "Prendre une photo"), h("small", null, "Avec l'appareil photo du téléphone.")), entree(true));
    var galerie = h("label", { class: "carte-choix bouton-fichier" }, h("span", { class: "emoji carte-choix-emoji", "aria-hidden": "true" }, "🖼️"),
      h("span", { class: "carte-choix-texte" }, h("b", null, "Choisir dans la galerie"), h("small", null, "Une photo déjà enregistrée.")), entree(false));
    d.appendChild(h("div", { class: "contenu" }, h("h2", { id: "detail-titre" }, "Nouvelle photo pour " + b.nom),
      h("div", { class: "cartes-choix" }, appareil, galerie),
      h("button", { class: "btn secondaire large", type: "button", onclick: EB.fermerDialogue }, "Annuler")));
    EB.ouvrirDialogue(d, appareil.querySelector("input"));
  }

  function recadrer(b, fichier) {
    var url = URL.createObjectURL(fichier), img = new Image();
    img.onerror = function () { URL.revokeObjectURL(url); X.info("🤔", "Image illisible", "Ce fichier ne peut pas être ouvert. Essayez une photo JPEG ou PNG."); };
    img.onload = function () { ouvrirRecadrage(b, img, url); };
    img.src = url;
  }

  function ouvrirRecadrage(b, img, url) {
    var TAILLE = 560, zoom = 1, cx = img.naturalWidth / 2, cy = img.naturalHeight / 2;
    var cote0 = Math.min(img.naturalWidth, img.naturalHeight);
    var toile = h("canvas", { width: String(TAILLE), height: String(TAILLE), "aria-label": "Aperçu du recadrage" });
    var ctx = toile.getContext("2d");
    var apercu = h("img", { alt: "" });
    function cote() { return cote0 / zoom; }
    function borner() {
      var c = cote() / 2;
      cx = Math.min(Math.max(cx, c), img.naturalWidth - c);
      cy = Math.min(Math.max(cy, c), img.naturalHeight - c);
    }
    var attente = null;
    function dessiner() {
      borner();
      var c = cote();
      ctx.drawImage(img, cx - c / 2, cy - c / 2, c, c, 0, 0, TAILLE, TAILLE);
      clearTimeout(attente);
      attente = setTimeout(function () { apercu.src = exporter(96); }, 120);
    }
    function exporter(t) {
      var c = document.createElement("canvas"); c.width = t; c.height = t;
      var k = cote();
      c.getContext("2d").drawImage(img, cx - k / 2, cy - k / 2, k, k, 0, 0, t, t);
      return c.toDataURL("image/jpeg", 0.85);
    }
    // Glisser pour déplacer
    var depart = null;
    var zone = h("div", { class: "recadrage-zone" }, toile);
    zone.addEventListener("pointerdown", function (e) { depart = { x: e.clientX, y: e.clientY, cx: cx, cy: cy }; zone.setPointerCapture(e.pointerId); });
    zone.addEventListener("pointermove", function (e) {
      if (!depart) return;
      var echelle = cote() / zone.getBoundingClientRect().width;
      cx = depart.cx - (e.clientX - depart.x) * echelle; cy = depart.cy - (e.clientY - depart.y) * echelle; dessiner();
    });
    zone.addEventListener("pointerup", function () { depart = null; });
    zone.addEventListener("pointercancel", function () { depart = null; });
    var curseur = h("input", { type: "range", min: "1", max: "4", step: "0.05", value: "1", "aria-label": "Agrandir",
      oninput: function () { zoom = +this.value; dessiner(); } });
    function pas(v) { zoom = Math.min(4, Math.max(1, zoom + v)); curseur.value = String(zoom); dessiner(); }

    var d = EB.dialogue();
    var ok = h("button", { class: "btn large", type: "button", onclick: function () {
      var photo = exporter(256);
      URL.revokeObjectURL(url);
      EB.fermerDialogue();
      EB.confirmer({ emoji: "🖼️", titre: "Utiliser cette photo pour " + b.nom + " ?", phrase: "Elle s'affichera à côté des mails de " + b.adresse + ".",
        consequence: "En démo, la photo reste sur ce téléphone : Microsoft n'est pas modifié.", bouton: "Oui, utiliser cette photo" }).then(function (oui) {
        if (!oui) return;
        b.photo = photo;
        if (!X.sauver("Photo changée", "Boîte " + b.nom)) {}
        EB.toast("La nouvelle photo de " + b.nom + " est en place.");
        EB.rendre();
      });
    } }, EB.icone("coche"), "Utiliser cette photo");
    d.appendChild(h("div", { class: "contenu centre" }, h("h2", { id: "detail-titre" }, "Recadrer la photo"),
      h("p", { class: "phrase" }, "Glissez avec le doigt pour placer l'image. Le rond montre ce qui sera visible."),
      h("div", { class: "recadrage" }, zone,
        h("div", { class: "recadrage-zoom" },
          h("button", { class: "btn-rond petit", type: "button", "aria-label": "Réduire", onclick: function () { pas(-0.25); } }, EB.icone("moins")),
          curseur,
          h("button", { class: "btn-rond petit", type: "button", "aria-label": "Agrandir", onclick: function () { pas(0.25); } }, EB.icone("plus"))),
        h("div", { class: "apercu-photo" }, apercu, h("span", null, h("b", null, b.nom), h("br"), h("small", null, "Aperçu dans la liste des mails")))),
      ok,
      h("button", { class: "btn secondaire large", type: "button", onclick: function () { URL.revokeObjectURL(url); EB.fermerDialogue(); } }, "Annuler")));
    EB.ouvrirDialogue(d, ok);
    dessiner();
  }

  EB.ecran("boites", ecranBoites);
})();
