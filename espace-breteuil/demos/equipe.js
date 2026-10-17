/*
 * Espace Breteuil — démo « Quelqu'un arrive », « Quelqu'un part », « Les absences ».
 * Assistants pas à pas (adresse #/arrivee/1…5, #/depart/<id>/1…5), confirmation en 2 étapes.
 */
(function () {
  "use strict";
  var EB = window.EB, D = window.EBDemos, X = window.EBD;
  if (!EB || !D || !X) return;
  var h = EB.h;
  var PACKS = ["admin", "finance"];

  function emojiPole(pole) { var p = D.POLES.filter(function (x) { return x.id === pole; })[0]; return p ? p.emoji : "👤"; }

  /* ================================================================== */
  /* Arrivée                                                             */
  /* ================================================================== */
  var arr = null, dernierArrive = null;
  function nouveauBrouillon() {
    return { prenom: "", nom: "", debut: D.jourIso(), poste: "", pole: "", licence: "", boites: [], dossiers: [], accesTouches: false };
  }
  var TITRES_ARRIVEE = ["Identité", "Poste et pôle", "Licence", "Accès"];

  function ecranArrivee(app, chemin) {
    if (!X.entete(app, "Quelqu'un arrive", PACKS)) return;
    var etat = X.etat(), n = chemin[1];
    if (n === "fait") return arriveeFaite(app);
    n = +n || 1;
    if (!arr || n === 1 && chemin[1] == null) arr = arr || nouveauBrouillon();
    // On ne saute pas d'étape.
    if (n > 1 && !arr.prenom.trim()) n = 1;
    else if (n > 2 && !arr.pole) n = 2;
    else if (n > 3 && !arr.licence) n = 3;
    if (String(n) !== String(chemin[1] || 1) && chemin[1]) { location.replace("#/arrivee/" + n); return; }
    if (n <= 4) app.appendChild(X.progression(n, 4, TITRES_ARRIVEE[n - 1]));
    var erreur = h("p", { class: "erreur-assistant", role: "alert" });

    if (n === 1) {
      var adresse = h("b", null, D.adresseProposee(etat, arr.prenom || "prénom"));
      app.appendChild(h("h2", { class: "question" }, EB.emoji("👋"), " Qui arrive ?"));
      app.appendChild(h("p", { class: "aide-ecran" }, "Son prénom suffit pour commencer."));
      app.appendChild(groupe("prenom", "Prénom", h("input", { class: "champ", id: "prenom", autocomplete: "off", value: arr.prenom,
        oninput: function () { arr.prenom = this.value; adresse.textContent = D.adresseProposee(etat, arr.prenom || "prénom"); erreur.textContent = ""; } })));
      app.appendChild(groupe("nom", "Nom (facultatif)", h("input", { class: "champ", id: "nom", autocomplete: "off", value: arr.nom, oninput: function () { arr.nom = this.value; } })));
      app.appendChild(groupe("debut", "Premier jour", h("input", { class: "champ", id: "debut", type: "date", value: arr.debut, oninput: function () { arr.debut = this.value; } })));
      app.appendChild(h("p", { class: "note" }, EB.icone("mail"), h("span", null, "Son adresse mail sera : ", adresse)));
      app.appendChild(erreur);
      app.appendChild(X.navAssistant(null, function () {
        if (!arr.prenom.trim()) { erreur.textContent = "Écrivez au moins le prénom."; document.getElementById("prenom").focus(); return; }
        location.hash = "#/arrivee/2";
      }));
    }

    if (n === 2) {
      app.appendChild(h("h2", { class: "question" }, EB.emoji("🧭"), " Que fera " + arr.prenom + " ?"));
      app.appendChild(groupe("poste", "Son poste", h("input", { class: "champ", id: "poste", autocomplete: "off", placeholder: "Par exemple : chargée d'accueil", value: arr.poste, oninput: function () { arr.poste = this.value; } })));
      app.appendChild(h("p", { class: "champ-titre" }, h("b", null, "Son pôle")));
      app.appendChild(h("div", { class: "cartes-choix deux" }, D.POLES.map(function (po) {
        var resp = D.responsableDe(etat, po.id);
        return X.carteChoix(po.emoji, po.id, resp ? "Responsable : " + X.prenom(resp) : null, arr.pole === po.id, function () {
          arr.pole = po.id;
          if (!arr.accesTouches) { var a = D.accesParPole(po.id); arr.boites = a.boites.slice(); arr.dossiers = a.dossiers.slice(); }
          EB.rendre();
        });
      })));
      app.appendChild(erreur);
      app.appendChild(X.navAssistant("#/arrivee/1", function () {
        if (!arr.pole) { erreur.textContent = "Touchez le pôle de " + arr.prenom + "."; return; }
        location.hash = "#/arrivee/3";
      }));
    }

    if (n === 3) {
      app.appendChild(h("h2", { class: "question" }, EB.emoji("🎫"), " Quelle licence pour " + arr.prenom + " ?"));
      app.appendChild(h("p", { class: "aide-ecran" }, "La licence donne accès aux applications Microsoft. Prix par mois, hors taxes."));
      app.appendChild(h("div", { class: "cartes-choix" }, D.ORDRE.map(function (f) {
        var F = D.FORMULES[f], cout = D.coutArrivee(etat, f), libre = D.libres(etat, f);
        return X.carteChoix(F.emoji, F.nom, F.texte, arr.licence === f, function () { arr.licence = f; EB.rendre(); }, h("span", null,
          h("span", { class: "prix" }, D.euros(F.prix) + " HT par mois"), " ",
          cout ? h("span", { class: "pastille-cout payant" }, "Aucune libre : +" + D.euros(cout) + " par mois")
            : h("span", { class: "pastille-cout gratuit" }, libre + " libre" + (libre > 1 ? "s" : "") + " : rien de plus à payer")));
      })));
      if (arr.licence) {
        var apres = D.coutMensuel(etat.licences) + D.coutArrivee(etat, arr.licence);
        app.appendChild(h("p", { class: "note" }, EB.icone("info"), h("span", null, "Coût total des licences après l'arrivée : ", h("b", null, D.euros(apres) + " HT par mois"), ".")));
      }
      app.appendChild(erreur);
      app.appendChild(X.navAssistant("#/arrivee/2", function () {
        if (!arr.licence) { erreur.textContent = "Touchez une des deux formules."; return; }
        location.hash = "#/arrivee/4";
      }));
    }

    if (n === 4) {
      app.appendChild(h("h2", { class: "question" }, EB.emoji("🔐"), " À quoi " + arr.prenom + " aura accès ?"));
      app.appendChild(h("p", { class: "aide-ecran" }, "Déjà coché selon son pôle. Touchez pour ajouter ou enlever."));
      app.appendChild(h("h3", { class: "titre-groupe" }, "Boîtes mail partagées"));
      app.appendChild(h("div", { class: "cartes-choix deux" }, etat.boites.map(function (b) {
        var on = arr.boites.indexOf(b.id) > -1;
        return X.carteChoix(b.emoji, b.nom, b.adresse, on, function () { arr.accesTouches = true; basculer(arr.boites, b.id); EB.rendre(); });
      })));
      app.appendChild(h("h3", { class: "titre-groupe" }, "Dossiers du dossier commun"));
      app.appendChild(h("div", { class: "cartes-choix deux" }, D.DOSSIERS.map(function (d) {
        var on = arr.dossiers.indexOf(d.id) > -1;
        return X.carteChoix(d.emoji, d.id, on ? "Peut ouvrir et modifier" : "Pas d'accès", on, function () { arr.accesTouches = true; basculer(arr.dossiers, d.id); EB.rendre(); });
      })));
      app.appendChild(X.navAssistant("#/arrivee/3", "#/arrivee/5", "Voir le récapitulatif"));
    }

    if (n === 5) {
      var F = D.FORMULES[arr.licence], cout = D.coutArrivee(etat, arr.licence);
      app.appendChild(h("h2", { class: "question" }, EB.emoji("📋"), " Récapitulatif"));
      app.appendChild(h("p", { class: "aide-ecran" }, "Vérifiez, puis créez le compte."));
      app.appendChild(h("div", { class: "resume" },
        ligneResume("👤", "Identité", (arr.prenom + " " + arr.nom).trim() + " — " + D.adresseProposee(etat, arr.prenom) + " — arrive le " + X.jourLisible(arr.debut || D.jourIso()), "#/arrivee/1"),
        ligneResume(emojiPole(arr.pole), "Poste et pôle", (arr.poste ? arr.poste + ", " : "") + "pôle " + arr.pole, "#/arrivee/2"),
        ligneResume(F.emoji, "Licence", F.nom + " — " + (cout ? "+" + D.euros(cout) + " HT par mois (une licence à acheter)" : "licence libre, rien de plus à payer"), "#/arrivee/3"),
        ligneResume("📬", "Boîtes partagées", arr.boites.length ? arr.boites.map(function (id) { return D.boite(etat, id).nom; }).join(", ") : "Aucune", "#/arrivee/4"),
        ligneResume("🗂️", "Dossiers", arr.dossiers.length ? arr.dossiers.join(", ") : "Aucun", "#/arrivee/4")));
      app.appendChild(h("div", { class: "nav-assistant" },
        h("a", { class: "btn secondaire", href: "#/arrivee/4" }, EB.icone("gauche"), "Retour"),
        h("button", { class: "btn", type: "button", onclick: creer }, EB.icone("coche"), "Créer le compte")));
    }
    app.appendChild(h("p", { class: "lien-discret" }, h("button", { type: "button", onclick: function () { arr = nouveauBrouillon(); location.hash = X.retourHub().href; } }, "Abandonner cette arrivée")));
  }

  function creer() {
    var etat = X.etat(), F = D.FORMULES[arr.licence], cout = D.coutArrivee(etat, arr.licence);
    EB.confirmer({
      emoji: "👋", titre: "Créer le compte de " + arr.prenom + " ?",
      phrase: "Adresse " + D.adresseProposee(etat, arr.prenom) + ", " + F.nom + ", pôle " + arr.pole + ".",
      consequence: (cout ? "Une licence sera achetée : +" + D.euros(cout) + " HT par mois. " : "") + "En démo, rien n'est créé chez Microsoft.",
      bouton: "Oui, créer le compte",
    }).then(function (ok) {
      if (!ok) return;
      var r = D.enregistrerArrivee(etat, arr);
      X.sauver("Arrivée", arr.prenom + " — " + arr.pole + ", " + F.nom + (r.achat ? " (licence achetée)" : ""));
      dernierArrive = { prenom: arr.prenom, adresse: D.personne(etat, r.id).adresse,
        mdp: window.EBDemo && window.EBDemo.motDePasseProvisoire ? window.EBDemo.motDePasseProvisoire() : "Tilleul-Bassin-Rose-42" };
      arr = null;
      location.hash = "#/arrivee/fait";
    });
  }
  function arriveeFaite(app) {
    if (!dernierArrive) { location.replace("#/arrivee/1"); return; }
    var a = dernierArrive;
    app.appendChild(h("div", { class: "succes-grand" }, EB.emoji("🎉"), h("h2", null, "Le compte de " + a.prenom + " est prêt"), h("p", null, a.adresse)));
    app.appendChild(h("div", { class: "boite" },
      h("h3", null, "Son mot de passe provisoire"),
      h("span", { class: "code-provisoire" }, a.mdp),
      h("p", null, "Donnez-le de vive voix ou par WhatsApp, jamais par mail. " + a.prenom + " le changera à la première connexion."),
      h("p", { class: "petit" }, "Exemple : aucun vrai compte n'a été créé.")));
    app.appendChild(h("div", { class: "actions" },
      h("a", { class: "btn", href: X.retourHub().href }, "Terminé"),
      h("a", { class: "btn secondaire", href: "#/arrivee/1" }, EB.icone("plus"), "Une autre arrivée")));
  }

  function groupe(id, texte, champ) { return h("div", { class: "champ-groupe" }, h("label", { for: id }, texte), champ); }
  function basculer(liste, v) { var i = liste.indexOf(v); if (i > -1) liste.splice(i, 1); else liste.push(v); }
  function ligneResume(emoji, titre, texte, lien) {
    return h("div", { class: "resume-ligne" }, EB.emoji(emoji), h("div", null, h("b", null, titre), h("span", null, texte)),
      lien ? h("a", { href: lien, "aria-label": "Modifier : " + titre }, "Modifier") : null);
  }

  /* ================================================================== */
  /* Départ                                                              */
  /* ================================================================== */
  var dep = null;
  var TITRES_DEPART = ["Bloquer le compte", "Transmettre la boîte", "Fichiers de travail", "Licence"];
  function bandeauPrive() {
    return h("div", { class: "bandeau prive", role: "note" }, EB.emoji("🔒"), h("div", null,
      h("strong", null, "On ne parcourt pas les fichiers personnels."),
      h("span", null, "Seuls les documents de travail sont récupérés. Personne n'ouvre le reste.")));
  }

  function ecranDepart(app, chemin) {
    if (!X.entete(app, "Quelqu'un part", PACKS)) return;
    var etat = X.etat(), id = chemin[1], n = chemin[2];
    if (id === "fait") return departFait(app);
    var p = id && D.personne(etat, id);
    if (!p || p.parti) {
      app.appendChild(h("h2", { class: "question" }, EB.emoji("🚪"), " Qui part ?"));
      app.appendChild(h("p", { class: "aide-ecran" }, "Touchez la personne. Rien ne se passe avant la dernière confirmation."));
      app.appendChild(h("div", { class: "visages grands" }, D.actifs(etat.personnes).map(function (x) {
        return X.visage(x, { onclick: function () {
          dep = { id: x.id, bloquer: "maintenant", date: D.jourIso(), transmettreA: D.responsableDe(etat, x.pole, x.id), fichiers: true, licence: x.licence ? "garder" : null };
          location.hash = "#/depart/" + x.id + "/1";
        } });
      })));
      var partis = etat.personnes.filter(function (x) { return x.parti; });
      if (partis.length) app.appendChild(h("p", { class: "petit" }, "Déjà parti" + (partis.length > 1 ? "s" : "") + " : " + partis.map(function (x) { return x.prenom; }).join(", ") + "."));
      return;
    }
    if (!dep || dep.id !== id) { location.replace("#/depart"); return; }
    n = +n || 1;
    if (n <= 4) app.appendChild(X.progression(n, 4, TITRES_DEPART[n - 1]));
    app.appendChild(h("div", { class: "bonjour depart-qui" }, EB.avatar(p, "grand"), h("div", null, h("h2", null, p.prenom), h("p", null, p.poste + " — " + p.pole))));
    var base = "#/depart/" + id + "/";

    if (n === 1) {
      app.appendChild(h("h2", { class: "question" }, EB.emoji("⛔"), " Bloquer son compte"));
      app.appendChild(h("p", { class: "aide-ecran" }, "Plus personne ne pourra se connecter avec son compte. Ses mails continuent d'arriver."));
      app.appendChild(h("div", { class: "cartes-choix" },
        X.carteChoix("⚡", "Tout de suite", "Pour un départ déjà fait.", dep.bloquer === "maintenant", function () { dep.bloquer = "maintenant"; EB.rendre(); }),
        X.carteChoix("📅", "Le jour du départ", "Le compte marche jusqu'au soir de cette date.", dep.bloquer === "date", function () { dep.bloquer = "date"; EB.rendre(); })));
      if (dep.bloquer === "date") app.appendChild(groupe("date-depart", "Dernier jour", h("input", { class: "champ", id: "date-depart", type: "date", value: dep.date, oninput: function () { dep.date = this.value; } })));
      app.appendChild(X.navAssistant("#/depart", base + "2"));
    }
    if (n === 2) {
      app.appendChild(h("h2", { class: "question" }, EB.emoji("📨"), " Qui lira ses mails ?"));
      app.appendChild(h("p", { class: "aide-ecran" }, "Les mails reçus à " + p.adresse + " seront lus par cette personne. Proposé : son responsable."));
      app.appendChild(h("div", { class: "visages grands" }, D.actifs(etat.personnes).filter(function (x) { return x.id !== id; }).map(function (x) {
        return X.visage(x, { presse: dep.transmettreA === x.id, onclick: function () { dep.transmettreA = x.id; EB.rendre(); } });
      })));
      app.appendChild(h("div", { class: "cartes-choix" }, X.carteChoix("🙅", "Personne", "Les mails restent dans la boîte, sans lecteur.", !dep.transmettreA, function () { dep.transmettreA = null; EB.rendre(); })));
      app.appendChild(X.navAssistant(base + "1", base + "3"));
    }
    if (n === 3) {
      app.appendChild(h("h2", { class: "question" }, EB.emoji("🗂️"), " Récupérer ses fichiers de travail"));
      app.appendChild(bandeauPrive());
      app.appendChild(h("div", { class: "cartes-choix" },
        X.carteChoix("📥", "Oui, les récupérer", "Ses documents de travail sont copiés dans le dossier commun « " + p.pole + " ».", dep.fichiers, function () { dep.fichiers = true; EB.rendre(); }),
        X.carteChoix("🙅", "Non, rien à récupérer", "Tout est déjà dans le dossier commun.", !dep.fichiers, function () { dep.fichiers = false; EB.rendre(); })));
      app.appendChild(X.navAssistant(base + "2", base + "4"));
    }
    if (n === 4) {
      app.appendChild(h("h2", { class: "question" }, EB.emoji("🎫"), " Libérer sa licence"));
      if (!p.licence) {
        app.appendChild(h("p", { class: "vide" }, p.prenom + " n'a pas de licence : rien à faire."));
      } else {
        var F = D.FORMULES[p.licence];
        app.appendChild(h("p", { class: "aide-ecran" }, p.prenom + " a la " + F.nom + " (" + D.euros(F.prix) + " HT par mois). Que faire de cette licence ?"));
        app.appendChild(h("div", { class: "cartes-choix" },
          X.carteChoix("♻️", "La garder pour la prochaine arrivée", "Elle devient libre. Le coût ne change pas.", dep.licence === "garder", function () { dep.licence = "garder"; EB.rendre(); }),
          X.carteChoix("💶", "La rendre à Microsoft", "−" + D.euros(F.prix) + " HT par mois, soit −" + D.euros(F.prix * 12) + " par an.", dep.licence === "rendre", function () { dep.licence = "rendre"; EB.rendre(); })));
      }
      app.appendChild(X.navAssistant(base + "3", base + "5", "Voir le récapitulatif"));
    }
    if (n === 5) {
      app.appendChild(h("h2", { class: "question" }, EB.emoji("📋"), " Récapitulatif"));
      app.appendChild(h("div", { class: "resume" },
        ligneResume("⛔", "Compte bloqué", dep.bloquer === "maintenant" ? "Tout de suite" : "Le soir du " + X.jourLisible(dep.date), base + "1"),
        ligneResume("📨", "Ses mails", dep.transmettreA ? "Lus par " + X.prenom(dep.transmettreA) : "Personne ne les lit", base + "2"),
        ligneResume("🗂️", "Fichiers de travail", dep.fichiers ? "Copiés dans le dossier commun « " + p.pole + " »" : "Rien à récupérer", base + "3"),
        ligneResume("🎫", "Licence", !p.licence ? "Aucune" : dep.licence === "rendre" ? "Rendue : −" + D.euros(D.FORMULES[p.licence].prix) + " HT par mois" : "Gardée pour la prochaine arrivée", base + "4")));
      app.appendChild(bandeauPrive());
      app.appendChild(h("div", { class: "nav-assistant" },
        h("a", { class: "btn secondaire", href: base + "4" }, EB.icone("gauche"), "Retour"),
        h("button", { class: "btn", type: "button", onclick: function () { partir(p); } }, EB.icone("coche"), "Valider le départ")));
    }
    app.appendChild(h("p", { class: "lien-discret" }, h("button", { type: "button", onclick: function () { dep = null; location.hash = X.retourHub().href; } }, "Abandonner")));
  }

  var dernierParti = null;
  function partir(p) {
    var etat = X.etat();
    EB.confirmer({
      emoji: "🚪", titre: "Valider le départ de " + p.prenom + " ?",
      phrase: "Son compte sera bloqué" + (dep.bloquer === "maintenant" ? " tout de suite" : " le soir du " + X.jourLisible(dep.date)) + (dep.transmettreA ? ", ses mails lus par " + X.prenom(dep.transmettreA) : "") + ".",
      consequence: "Ses accès aux boîtes partagées et ses rôles seront retirés. En démo, rien ne change chez Microsoft.", bouton: "Oui, valider le départ",
    }).then(function (ok) {
      if (!ok) return;
      var r = D.enregistrerDepart(etat, p.id, { bloquer: true, transmettreA: dep.transmettreA, libererLicence: !!p.licence, rendreLicence: dep.licence === "rendre" });
      X.sauver("Départ", p.prenom + (dep.transmettreA ? " — mails transmis à " + X.prenom(dep.transmettreA) : "") + (r.economie ? " — licence rendue (−" + D.euros(r.economie) + "/mois)" : ""));
      dernierParti = { prenom: p.prenom, economie: r.economie };
      dep = null;
      location.hash = "#/depart/fait";
    });
  }
  function departFait(app) {
    if (!dernierParti) { location.replace("#/depart"); return; }
    app.appendChild(h("div", { class: "succes-grand" }, EB.emoji("✅"), h("h2", null, "Le départ de " + dernierParti.prenom + " est enregistré"),
      dernierParti.economie ? h("p", null, "Économie : " + D.euros(dernierParti.economie) + " HT par mois.") : null));
    app.appendChild(h("div", { class: "actions" }, h("a", { class: "btn", href: X.retourHub().href }, "Terminé")));
  }

  /* ================================================================== */
  /* Absences                                                            */
  /* ================================================================== */
  var decalage = 0, nouvelle = null;

  function ecranAbsences(app, chemin) {
    if (chemin[1] === "nouvelle") return ecranNouvelleAbsence(app, chemin[2]);
    if (!X.entete(app, "Les absences", PACKS)) return;
    var etat = X.etat(), auj = D.jourIso(), jours = D.semaine(D.ajouterJours(auj, decalage * 7));
    app.appendChild(h("p", { class: "aide-ecran" }, "Congés, absences et télétravail de l'équipe. Jamais de motif : seulement là ou pas là."));
    app.appendChild(h("div", { class: "actions haut" }, h("a", { class: "btn large", href: "#/absences/nouvelle" }, EB.icone("plus"), "Déclarer une absence")));
    app.appendChild(h("div", { class: "nav-periode" },
      h("button", { class: "btn-rond", type: "button", "aria-label": "Semaine précédente", onclick: function () { decalage--; EB.rendre(); } }, EB.icone("gauche")),
      h("div", { class: "titre-periode", "aria-live": "polite" }, "Semaine du " + EB.fmt(EB.midi(EB.depuisIso(jours[0])), { day: "numeric", month: "long" })),
      h("button", { class: "btn-rond", type: "button", "aria-label": "Semaine suivante", onclick: function () { decalage++; EB.rendre(); } }, EB.icone("droite"))));
    if (decalage) app.appendChild(h("div", { class: "ligne-aujourdhui" }, h("button", { class: "btn secondaire", type: "button", onclick: function () { decalage = 0; EB.rendre(); } }, "Cette semaine")));
    app.appendChild(h("div", { class: "legende-absences" }, Object.keys(D.TYPES_ABSENCE).map(function (k) {
      var t = D.TYPES_ABSENCE[k]; return h("span", null, h("i", { style: { background: t.couleur } }), t.emoji + " " + t.nom);
    })));
    var frise = h("div", { class: "frise", role: "table", "aria-label": "Présence de l'équipe sur la semaine" });
    frise.appendChild(h("div", { class: "frise-ligne tete", role: "row" }, h("span", { role: "columnheader" }, ""), jours.map(function (j) {
      var d = EB.depuisIso(j);
      return h("span", { role: "columnheader", class: j === auj ? "auj" : "" }, EB.fmt(EB.midi(d), { weekday: "narrow" }), h("br"), String(d.d));
    })));
    D.actifs(etat.personnes).forEach(function (p) {
      var resume = [];
      var cases = jours.map(function (j, i) {
        var a = D.absenceDu(etat.absences, p.id, j), t = a && D.TYPES_ABSENCE[a.type];
        if (t) resume.push(EB.fmt(EB.midi(EB.depuisIso(j)), { weekday: "long" }) + " " + t.nom.toLowerCase());
        return h("span", { class: "frise-case" + (i > 4 ? " weekend" : "") + (j === auj ? " auj" : ""), style: t ? { background: t.couleur } : null, "aria-hidden": "true" }, t ? t.lettre : "");
      });
      frise.appendChild(h("button", { class: "frise-ligne", type: "button", role: "row",
        "aria-label": p.prenom + " : " + (resume.length ? resume.join(", ") : "présent toute la semaine") + ". Toucher pour déclarer une absence.",
        onclick: function () { location.hash = "#/absences/nouvelle/" + p.id; } },
        h("span", { class: "frise-nom" }, EB.avatar(p), h("span", null, p.prenom)), cases));
    });
    app.appendChild(frise);
    app.appendChild(h("p", { class: "petit" }, "Touchez une ligne pour déclarer une absence pour cette personne. C = congés, A = absence, T = télétravail."));

    var avenir = etat.absences.filter(function (a) { return a.au >= auj && D.personne(etat, a.personne); }).sort(function (a, b) { return a.du < b.du ? -1 : 1; });
    app.appendChild(h("section", { class: "section" }, h("h2", null, EB.emoji("🗓️"), " À venir"),
      avenir.length ? h("div", { class: "liste-absences" }, avenir.map(function (a) {
        var p = D.personne(etat, a.personne), t = D.TYPES_ABSENCE[a.type];
        return h("div", { class: "absence", style: { borderLeftColor: t.couleur } }, EB.avatar(p),
          h("b", null, p.prenom + " — " + t.emoji + " " + t.nom),
          h("span", null, a.du === a.au ? EB.maj(X.jourLisible(a.du)) : "Du " + X.jourLisible(a.du, true) + " au " + X.jourLisible(a.au, true) + " (" + D.nbJours(a) + " jours)"),
          h("button", { class: "btn secondaire petit", type: "button", onclick: function () { retirerAbsence(a); } }, EB.icone("croix"), "Retirer"));
      })) : h("p", { class: "vide" }, "Aucune absence prévue.")));
    app.appendChild(EB.pied());
  }

  function retirerAbsence(a) {
    var etat = X.etat(), p = D.personne(etat, a.personne), t = D.TYPES_ABSENCE[a.type];
    EB.confirmer({ emoji: "🗑️", titre: "Retirer cette absence ?", phrase: p.prenom + " — " + t.nom + " du " + X.jourLisible(a.du) + (a.au !== a.du ? " au " + X.jourLisible(a.au) : "") + ".",
      consequence: "Elle disparaîtra de la frise de l'équipe.", bouton: "Oui, retirer" }).then(function (ok) {
      if (!ok) return;
      etat.absences = etat.absences.filter(function (x) { return x.id !== a.id; });
      X.sauver("Absence retirée", p.prenom + " — " + t.nom);
      EB.rendre();
    });
  }

  function ecranNouvelleAbsence(app, qui) {
    if (!X.entete(app, "Déclarer une absence", PACKS, { href: "#/absences", texte: "Absences" })) return;
    var etat = X.etat();
    if (!nouvelle || (qui && nouvelle.personne !== qui && !nouvelle.touche)) nouvelle = { personne: qui || "", type: "", du: D.jourIso(), au: D.jourIso(), touche: false };
    var erreur = h("p", { class: "erreur-assistant", role: "alert" });
    app.appendChild(h("h2", { class: "question" }, "1. Qui ?"));
    app.appendChild(h("div", { class: "visages grands" }, D.actifs(etat.personnes).map(function (p) {
      return X.visage(p, { presse: nouvelle.personne === p.id, onclick: function () { nouvelle.personne = p.id; nouvelle.touche = true; EB.rendre(); } });
    })));
    app.appendChild(h("h2", { class: "question" }, "2. Quoi ?"));
    app.appendChild(h("div", { class: "cartes-choix trois" }, Object.keys(D.TYPES_ABSENCE).map(function (k) {
      var t = D.TYPES_ABSENCE[k];
      return X.carteChoix(t.emoji, t.nom, { conge: "Vacances, jours de repos.", absence: "Pas là, sans donner de raison.", teletravail: "Travaille depuis chez soi." }[k],
        nouvelle.type === k, function () { nouvelle.type = k; nouvelle.touche = true; EB.rendre(); });
    })));
    app.appendChild(h("h2", { class: "question" }, "3. Quand ?"));
    app.appendChild(h("div", { class: "deux-champs" },
      groupe("du", "Du", h("input", { class: "champ", id: "du", type: "date", value: nouvelle.du, oninput: function () { nouvelle.du = this.value; if (nouvelle.au < this.value) { nouvelle.au = this.value; document.getElementById("au").value = this.value; } } })),
      groupe("au", "Au (inclus)", h("input", { class: "champ", id: "au", type: "date", value: nouvelle.au, oninput: function () { nouvelle.au = this.value; } }))));
    app.appendChild(h("p", { class: "note" }, EB.icone("info"), h("span", null, "Aucun motif n'est demandé, et surtout pas de raison médicale.")));
    app.appendChild(erreur);
    app.appendChild(h("div", { class: "nav-assistant" },
      h("a", { class: "btn secondaire", href: "#/absences" }, "Annuler"),
      h("button", { class: "btn", type: "button", onclick: function () {
        if (!nouvelle.personne) { erreur.textContent = "Touchez la personne."; return; }
        if (!nouvelle.type) { erreur.textContent = "Choisissez congés, absence ou télétravail."; return; }
        if (!nouvelle.du) { erreur.textContent = "Indiquez la date."; return; }
        var p = D.personne(etat, nouvelle.personne), t = D.TYPES_ABSENCE[nouvelle.type];
        var au = nouvelle.au && nouvelle.au >= nouvelle.du ? nouvelle.au : nouvelle.du;
        EB.confirmer({ emoji: t.emoji, titre: "Enregistrer : " + p.prenom + ", " + t.nom.toLowerCase() + " ?",
          phrase: au === nouvelle.du ? EB.maj(X.jourLisible(nouvelle.du)) + "." : "Du " + X.jourLisible(nouvelle.du) + " au " + X.jourLisible(au) + ".",
          consequence: "Toute l'équipe le verra sur la frise. En démo, seulement sur ce téléphone.", bouton: "Oui, enregistrer" }).then(function (ok) {
          if (!ok) return;
          var a = D.ajouterAbsence(etat, nouvelle);
          X.sauver("Absence déclarée", p.prenom + " — " + t.nom + " (" + D.nbJours(a) + " j)");
          nouvelle = null;
          decalage = Math.round((Date.parse(D.lundi(a.du)) - Date.parse(D.lundi(D.jourIso()))) / (7 * 86400000));
          EB.toast("C'est noté.");
          location.hash = "#/absences";
        });
      } }, EB.icone("coche"), "Enregistrer")));
  }

  EB.ecran("arrivee", ecranArrivee);
  EB.ecran("depart", ecranDepart);
  EB.ecran("absences", ecranAbsences);
})();
