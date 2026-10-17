/*
 * Espace Breteuil — démo « Rôles et délégations » et « Historique ».
 * Une carte par rôle, expliquée en une phrase. Toucher une personne : retirer le rôle.
 * « Donner ce rôle » : choisir une personne. Toujours 2 étapes de confirmation.
 */
(function () {
  "use strict";
  var EB = window.EB, D = window.EBDemos, X = window.EBD;
  if (!EB || !D || !X) return;
  var h = EB.h;

  var boiteChoisie = "contact";

  var CONSEQUENCE = {
    admin: function () { return "pourra tout régler : comptes, accès et rôles."; },
    facturation: function () { return "pourra voir les factures et changer le moyen de paiement."; },
    pole: function (c) { return "décidera qui entre dans la boîte mail et le dossier du pôle " + c + "."; },
    boite: function (c) { var b = D.boite(X.etat(), c); return "pourra lire la boîte " + (b ? b.adresse : c) + " depuis son propre Outlook."; },
  };
  function nomRole(role, cible) {
    var r = D.ROLES.filter(function (x) { return x.id === role; })[0];
    if (role === "pole") return "Responsable du pôle " + cible;
    if (role === "boite") { var b = D.boite(X.etat(), cible); return "Accès à la boîte " + (b ? b.nom : cible); }
    return r.nom;
  }

  function retirer(role, cible, id) {
    var etat = X.etat(), p = X.personne(id);
    var refus = D.refusRetrait(etat, role, cible);
    if (refus) { X.info("✋", "Impossible pour l'instant", refus + " Donnez d'abord ce rôle à quelqu'un d'autre."); return; }
    EB.confirmer({
      emoji: "➖", titre: "Retirer « " + nomRole(role, cible) + " » à " + p.prenom + " ?",
      phrase: p.prenom + " ne " + CONSEQUENCE[role](cible).replace(/^pourra/, "pourra plus").replace(/^décidera/, "décidera plus"),
      consequence: "Le changement sera immédiat. En démo, il reste seulement sur ce téléphone.", bouton: "Oui, retirer",
    }).then(function (ok) {
      if (!ok) return;
      D.retirerRole(etat, role, cible, id);
      X.sauver("Rôle retiré", nomRole(role, cible) + " → " + p.prenom);
      EB.toast("C'est fait : " + p.prenom + " n'a plus ce rôle.");
      EB.rendre();
    });
  }

  function donner(role, cible) {
    var etat = X.etat(), deja = D.titulaires(etat, role, cible);
    var candidats = D.actifs(etat.personnes).filter(function (p) { return deja.indexOf(p.id) < 0; });
    if (!candidats.length) { X.info("👌", "Tout le monde l'a déjà", "Toute l'équipe a déjà ce rôle."); return; }
    EB.choisir("Donner « " + nomRole(role, cible) + " » à…", candidats.map(function (p) {
      return { valeur: p.id, titre: p.prenom, sous: p.poste + " — " + p.pole, avatar: EB.avatar(p) };
    }), "Touchez la personne.").then(function (id) {
      if (!id) return;
      var p = X.personne(id), alerte = D.avertissementAjout(etat, role);
      EB.confirmer({
        emoji: "➕", titre: "Donner « " + nomRole(role, cible) + " » à " + p.prenom + " ?",
        phrase: p.prenom + " " + CONSEQUENCE[role](cible),
        consequence: (alerte ? alerte + " " : "") + "Le changement sera immédiat. En démo, il reste seulement sur ce téléphone.", bouton: "Oui, donner ce rôle",
      }).then(function (ok) {
        if (!ok) return;
        D.donnerRole(etat, role, cible, id);
        X.sauver(role === "boite" ? "Accès donné" : "Rôle donné", nomRole(role, cible) + " → " + p.prenom);
        EB.toast("C'est fait : " + p.prenom + " a maintenant ce rôle.");
        EB.rendre();
      });
    });
  }

  function visages(role, cible) {
    var ids = D.titulaires(X.etat(), role, cible);
    var l = ids.map(function (id) {
      var p = X.personne(id); if (!p) return null;
      return X.visage(p, { badge: "✕", label: p.prenom + " — toucher pour retirer ce rôle", onclick: function () { retirer(role, cible, id); } });
    });
    if (!ids.length) l = [h("p", { class: "vide-doux" }, "Personne pour l'instant.")];
    return h("div", { class: "visages" }, l);
  }
  function boutonDonner(role, cible, texte) {
    return h("button", { class: "btn secondaire petit", type: "button", onclick: function () { donner(role, cible); } }, EB.icone("plus"), texte || "Donner ce rôle");
  }

  function carteRole(r, corps) {
    return h("section", { class: "carte-role" },
      h("div", { class: "carte-role-tete" }, EB.emoji(r.emoji), h("div", null, h("h2", null, r.nom), h("p", null, r.texte))),
      corps);
  }

  function ecranRoles(app) {
    if (!X.entete(app, "Rôles et délégations", ["admin"])) return;
    var etat = X.etat();
    app.appendChild(h("p", { class: "aide-ecran" }, "Touchez une personne pour lui retirer un rôle. « Donner ce rôle » pour l'ajouter à quelqu'un."));
    var R = {}; D.ROLES.forEach(function (r) { R[r.id] = r; });

    app.appendChild(carteRole(R.admin, [visages("admin"), boutonDonner("admin")]));
    app.appendChild(carteRole(R.facturation, [visages("facturation"), boutonDonner("facturation")]));
    app.appendChild(carteRole(R.pole, h("div", { class: "lignes-pole" }, D.POLES.map(function (po) {
      return h("div", { class: "ligne-pole" },
        h("p", { class: "ligne-pole-nom" }, EB.emoji(po.emoji), " ", po.id),
        visages("pole", po.id),
        h("button", { class: "btn-rond petit", type: "button", "aria-label": "Ajouter un responsable pour " + po.id, onclick: function () { donner("pole", po.id); } }, EB.icone("plus")));
    }))));
    var puces = h("div", { class: "puces", role: "group", "aria-label": "Choisir la boîte partagée" }, etat.boites.map(function (b) {
      return h("button", { class: "puce", type: "button", "aria-pressed": String(boiteChoisie === b.id), onclick: function () { boiteChoisie = b.id; EB.rendre(); } },
        X.vignetteBoite(b, "mini"), b.nom);
    }));
    var bo = D.boite(etat, boiteChoisie);
    app.appendChild(carteRole(R.boite, [puces,
      h("p", { class: "petit" }, "Qui peut ouvrir ", h("b", null, bo.adresse), " :"),
      visages("boite", boiteChoisie), boutonDonner("boite", boiteChoisie, "Donner l'accès"),
      h("a", { class: "lien-action", href: "#/boites/" + encodeURIComponent(bo.id) }, "Régler aussi « envoyer au nom de » et la photo ›")]));

    app.appendChild(h("section", { class: "section" },
      h("h2", null, EB.emoji("🕘"), " Qui a fait quoi"),
      h("ul", { class: "liste-histo" }, etat.historique.slice(0, 5).map(X.ligneHistorique)),
      h("div", { class: "actions" }, h("a", { class: "btn secondaire", href: "#/historique" }, "Tout l'historique"))));
    app.appendChild(EB.pied());
  }

  function ecranHistorique(app) {
    if (!X.entete(app, "Historique", ["admin", "finance"])) return;
    var l = X.etat().historique;
    app.appendChild(h("p", { class: "aide-ecran" }, "Chaque changement fait dans l'appli est noté ici : qui, quoi, quand."));
    app.appendChild(l.length ? h("ul", { class: "liste-histo" }, l.map(X.ligneHistorique)) : h("p", { class: "vide" }, "Rien pour l'instant."));
    app.appendChild(EB.pied());
  }

  EB.ecran("roles", ecranRoles);
  EB.ecran("historique", ecranHistorique);
})();
