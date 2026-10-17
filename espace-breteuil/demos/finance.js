/*
 * Espace Breteuil — démo « Pack Finance » (Valérie D.) : licences et coût mensuel,
 * simulateur « ajouter ou retirer une licence », factures (exemple PDF), moyen de paiement.
 */
(function () {
  "use strict";
  var EB = window.EB, D = window.EBDemos, X = window.EBD;
  if (!EB || !D || !X) return;
  var h = EB.h;
  var PACKS = ["finance", "admin"];
  var retourFinance = { href: "#/finance", texte: "Finance" };

  /* ------------------------------------------------------------------ */
  /* Licences et coût                                                    */
  /* ------------------------------------------------------------------ */
  function ecranLicences(app) {
    if (!X.entete(app, "Licences et coût", PACKS, retourFinance)) return;
    var etat = X.etat(), u = D.utilisees(etat.personnes), m = D.coutMensuel(etat.licences);
    var total = D.ORDRE.reduce(function (s, f) { return s + etat.licences[f]; }, 0);
    var nbU = D.ORDRE.reduce(function (s, f) { return s + u[f]; }, 0);
    app.appendChild(h("div", { class: "carte-total" },
      h("p", null, "Chaque mois, hors taxes"),
      h("span", { class: "montant" }, D.euros(m)),
      h("p", null, "Soit " + D.euros(m * 12) + " HT par an · " + total + " licences : " + nbU + " attribuées, " + (total - nbU) + " libre" + (total - nbU > 1 ? "s" : "") + ".")));
    D.ORDRE.forEach(function (f) {
      var F = D.FORMULES[f], ach = etat.licences[f], ut = u[f];
      var qui = D.actifs(etat.personnes).filter(function (p) { return p.licence === f; });
      app.appendChild(h("section", { class: "carte-formule " + f },
        h("div", { class: "tete" }, EB.emoji(F.emoji), h("div", null, h("b", null, F.nom), h("small", null, F.produit + " — " + D.euros(F.prix) + " HT par personne et par mois"))),
        h("div", { class: "chiffres" }, h("span", null, "🛒 " + ach + " achetée" + (ach > 1 ? "s" : "")), h("span", null, "👤 " + ut + " attribuée" + (ut > 1 ? "s" : "")), h("span", null, "✨ " + Math.max(0, ach - ut) + " libre" + (ach - ut > 1 ? "s" : ""))),
        h("div", { class: "jauge", role: "img", "aria-label": ut + " sur " + ach + " utilisées" }, h("i", { style: { width: (ach ? Math.min(100, ut * 100 / ach) : 0) + "%" } })),
        h("div", { class: "visages petits" }, qui.map(function (p) { return h("span", { class: "visage" }, EB.avatar(p), h("span", null, p.prenom)); })),
        h("p", { class: "petit" }, "Coût : " + D.euros(ach * F.prix) + " HT par mois.")));
    });
    app.appendChild(h("p", { class: "petit" }, "Prix indicatifs, engagement d'un an. Le montant exact figure sur la facture Microsoft."));
    app.appendChild(EB.pied());
  }

  /* ------------------------------------------------------------------ */
  /* Simulateur                                                          */
  /* ------------------------------------------------------------------ */
  var sim = { formule: "standard", delta: 0 };
  function ecranSimulateur(app) {
    if (!X.entete(app, "Ajouter ou retirer", PACKS, retourFinance)) return;
    var etat = X.etat();
    app.appendChild(h("p", { class: "aide-ecran" }, "Touchez + ou − : le nouveau prix s'affiche tout de suite. Rien n'est commandé avant votre confirmation."));
    app.appendChild(h("div", { class: "cartes-choix deux" }, D.ORDRE.map(function (f) {
      var F = D.FORMULES[f];
      return X.carteChoix(F.emoji, F.nom, D.euros(F.prix) + " HT par mois", sim.formule === f, function () { sim.formule = f; sim.delta = 0; EB.rendre(); });
    })));
    var r = D.simuler(etat.licences, etat.personnes, sim.formule, sim.delta), F = D.FORMULES[sim.formule];
    var avant = etat.licences[sim.formule], apres = r.licences[sim.formule];
    app.appendChild(h("div", { class: "compteur" },
      h("button", { class: "btn-rond", type: "button", "aria-label": "Une licence en moins", disabled: apres <= 0, onclick: function () { sim.delta--; EB.rendre(); } }, EB.icone("moins")),
      h("output", { "aria-live": "polite" }, String(apres), h("small", null, "licences (aujourd'hui : " + avant + ")")),
      h("button", { class: "btn-rond", type: "button", "aria-label": "Une licence en plus", onclick: function () { sim.delta++; EB.rendre(); } }, EB.icone("plus"))));
    var cls = r.difference > 0 ? "hausse" : r.difference < 0 ? "baisse" : "";
    var signe = r.difference > 0 ? "+" : "";
    app.appendChild(h("div", { class: "impact" },
      h("div", null, h("span", null, "Par mois"), h("b", null, D.euros(r.avant) + " → " + D.euros(r.apres))),
      h("div", { class: cls }, h("span", null, "Différence par mois"), h("b", null, signe + D.euros(r.difference))),
      h("div", { class: cls }, h("span", null, "Différence par an"), h("b", null, signe + D.euros(r.parAn))),
      h("div", null, h("span", null, "Total par an après"), h("b", null, D.euros(r.annuelApres)))));
    if (!r.possible) app.appendChild(h("div", { class: "bandeau erreur", role: "alert" }, EB.emoji("✋"), h("div", null,
      h("strong", null, "Impossible de descendre sous " + r.utilisees), r.utilisees + " personnes utilisent la " + F.nom + ". Faites d'abord partir quelqu'un, ou changez sa formule.")));
    var valider = h("button", { class: "btn large", type: "button", disabled: !sim.delta || !r.possible, onclick: function () {
      EB.confirmer({ emoji: sim.delta > 0 ? "🛒" : "↩️", titre: (sim.delta > 0 ? "Acheter " + sim.delta : "Retirer " + (-sim.delta)) + " licence" + (Math.abs(sim.delta) > 1 ? "s" : "") + " ?",
        phrase: F.nom + " : " + avant + " → " + apres + ". Nouveau coût : " + D.euros(r.apres) + " HT par mois.",
        consequence: "Différence : " + signe + D.euros(r.difference) + " par mois, " + signe + D.euros(r.parAn) + " par an. En démo, rien n'est commandé chez Microsoft.",
        bouton: "Oui, valider" }).then(function (ok) {
        if (!ok) return;
        etat.licences = r.licences;
        X.sauver("Licences", F.nom + " : " + avant + " → " + apres + " (" + signe + D.euros(r.difference) + " / mois)");
        sim.delta = 0;
        EB.toast("C'est fait : " + apres + " licences " + F.nom + ".");
        EB.rendre();
      });
    } }, EB.icone("coche"), "Valider ce changement");
    app.appendChild(h("div", { class: "actions" }, valider));
    app.appendChild(EB.pied());
  }

  /* ------------------------------------------------------------------ */
  /* Factures                                                            */
  /* ------------------------------------------------------------------ */
  function ecranFactures(app) {
    if (!X.entete(app, "Les factures", PACKS, retourFinance)) return;
    var etat = X.etat();
    app.appendChild(h("p", { class: "aide-ecran" }, "Une facture par mois, envoyée à " + etat.paiement.destinataire + ". Touchez « PDF » pour la voir."));
    app.appendChild(h("div", { class: "liste-factures" }, etat.factures.map(function (f) {
      return h("div", { class: "facture" }, EB.emoji("🧾"),
        h("div", null, h("b", null, EB.maj(D.moisFr(f.date))), h("small", null, "N° " + f.numero + " — " + D.dateFr(f.date))),
        h("span", { class: "montant-ttc" }, D.euros(f.ttc)),
        h("div", { class: "actes" }, h("span", { class: "statut" }, "✓ " + f.statut), h("small", null, D.euros(f.ht) + " HT"),
          h("button", { class: "btn secondaire petit", type: "button", "aria-label": "Voir la facture de " + D.moisFr(f.date) + " en PDF", onclick: function () { voirFacture(f); } }, EB.icone("ouvrir"), "PDF")));
    })));
    app.appendChild(h("div", { class: "note" }, EB.icone("info"), h("span", null, "Exemples fictifs. Une fois l'appli connectée, les vraies factures Microsoft s'afficheront ici.")));
    app.appendChild(EB.pied());
  }

  function voirFacture(f) {
    var etat = X.etat(), d = EB.dialogue();
    var lignes = D.ORDRE.map(function (k) {
      var n = (f.licences || etat.licences)[k], F = D.FORMULES[k];
      return h("tr", null, h("td", null, n + " × " + F.produit), h("td", null, D.euros(n * F.prix)));
    });
    var telecharger = h("button", { class: "btn large", type: "button", onclick: function () {
      var blob = new Blob([D.pdfFacture(f, etat.licences)], { type: "application/pdf" });
      var url = URL.createObjectURL(blob);
      var a = h("a", { href: url, download: "exemple-facture-" + f.date.slice(0, 7) + ".pdf" });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      EB.toast("L'exemple PDF est téléchargé.");
    } }, EB.icone("installer"), "Télécharger l'exemple en PDF");
    d.appendChild(h("div", { class: "contenu" },
      h("h2", { id: "detail-titre" }, "Facture de " + D.moisFr(f.date)),
      h("div", { class: "feuille-facture" },
        h("h3", null, "Microsoft 365 — facture"),
        h("p", null, "N° " + f.numero + " · " + D.dateFr(f.date)),
        h("p", null, "Château de Breteuil (exemple)"),
        h("table", null, h("tbody", null, lignes,
          h("tr", null, h("td", null, "Total HT"), h("td", null, D.euros(f.ht))),
          h("tr", null, h("td", null, "TVA 20 %"), h("td", null, D.euros(f.tva))),
          h("tr", { class: "total" }, h("td", null, "Total TTC"), h("td", null, D.euros(f.ttc))))),
        h("p", null, "Payée par " + (etat.paiement.mode === "carte" ? "carte bancaire" : "prélèvement") + ".")),
      h("p", { class: "petit" }, "Exemple fictif, pour montrer à quoi ressemblera la vraie facture."),
      telecharger,
      h("button", { class: "btn secondaire large", type: "button", onclick: EB.fermerDialogue }, "Fermer")));
    EB.ouvrirDialogue(d, telecharger);
  }

  /* ------------------------------------------------------------------ */
  /* Moyen de paiement                                                   */
  /* ------------------------------------------------------------------ */
  function ecranPaiement(app) {
    if (!X.entete(app, "Moyen de paiement", PACKS, retourFinance)) return;
    var etat = X.etat(), P = etat.paiement;
    app.appendChild(h("p", { class: "aide-ecran" }, "Le moyen utilisé pour payer les prochaines factures Microsoft."));
    var MODES = {
      carte: { emoji: "💳", nom: "Carte bancaire", texte: P.carte },
      prelevement: { emoji: "🏦", nom: "Prélèvement", texte: "Sur le compte " + P.iban },
    };
    app.appendChild(h("div", { class: "cartes-choix" }, Object.keys(MODES).map(function (k) {
      var M = MODES[k];
      return X.carteChoix(M.emoji, M.nom, M.texte, P.mode === k, function () {
        if (P.mode === k) return;
        EB.confirmer({ emoji: M.emoji, titre: "Payer par " + M.nom.toLowerCase() + " ?", phrase: "Les prochaines factures seront payées par " + M.nom.toLowerCase() + " (" + M.texte + ").",
          consequence: "Le changement vaut pour la prochaine facture. En démo, rien ne change chez Microsoft.", bouton: "Oui, changer" }).then(function (ok) {
          if (!ok) return;
          P.mode = k;
          X.sauver("Moyen de paiement", M.nom);
          EB.toast("C'est noté : " + M.nom.toLowerCase() + ".");
          EB.rendre();
        });
      }, P.mode === k ? h("span", { class: "pastille-cout gratuit" }, "Utilisé aujourd'hui") : null);
    })));
    app.appendChild(h("section", { class: "section" }, h("h2", null, EB.emoji("📧"), " Qui reçoit les factures ?"),
      h("div", { class: "boite" }, h("p", null, "Les factures arrivent à ", h("b", null, P.destinataire), "."),
        h("button", { class: "btn secondaire", type: "button", onclick: function () {
          var choix = etat.boites.map(function (b) { return { valeur: b.adresse, titre: b.nom, sous: b.adresse, emoji: b.emoji }; })
            .concat(D.actifs(etat.personnes).map(function (p) { return { valeur: p.adresse, titre: p.prenom, sous: p.adresse, avatar: EB.avatar(p) }; }));
          EB.choisir("Envoyer les factures à…", choix, "Conseil : une boîte partagée, pour ne rien perdre si quelqu'un part.").then(function (adr) {
            if (!adr || adr === P.destinataire) return;
            EB.confirmer({ emoji: "📧", titre: "Envoyer les factures à " + adr + " ?", phrase: "Les prochaines factures arriveront dans cette boîte.",
              consequence: "En démo, rien ne change chez Microsoft.", bouton: "Oui, changer" }).then(function (ok) {
              if (!ok) return;
              P.destinataire = adr; X.sauver("Destinataire des factures", adr); EB.rendre();
            });
          });
        } }, EB.icone("crayon"), "Changer l'adresse"))));
    app.appendChild(h("div", { class: "note" }, EB.icone("info"), h("span", null, "Pour saisir une nouvelle carte, il faudra passer par le site de Microsoft : l'appli ne voit jamais les numéros de carte.")));
    app.appendChild(EB.pied());
  }

  EB.ecran("licences", ecranLicences);
  EB.ecran("simulateur", ecranSimulateur);
  EB.ecran("factures", ecranFactures);
  EB.ecran("paiement", ecranPaiement);
})();
