/*
 * Espace Breteuil — démo « Double authentification ».
 * Désactivée par défaut ; l'administrateur l'active dans cet écran (onglet Équipe › Double auth.).
 * #/securite : suivi pour François (qui l'a activée, « Envoyer un rappel »).
 * #/securite/guide/1…4 et /sms : guide pas à pas pour chaque collaborateur (libre d'accès).
 */
(function () {
  "use strict";
  var EB = window.EB, D = window.EBDemos, X = window.EBD;
  if (!EB || !D || !X) return;
  var h = EB.h;

  /* Le lien « Sécuriser mon compte » de « Mon espace » suit ce réglage. */
  function synchroniser() {
    try { var old = EB.demo(); if (old && old.mfa) { old.mfa.obligatoire = !!X.etat().mfa.activee; EB.sauverDemo(); } } catch (e) {}
  }
  synchroniser();

  function ecranSecurite(app, chemin) {
    if (chemin[1] === "guide") return ecranGuide(app, chemin[2]);
    if (!X.entete(app, "Double authentification", ["admin"])) return;
    var etat = X.etat(), m = etat.mfa;
    if (!m.activee) {
      app.appendChild(h("div", { class: "etape-guide" }, EB.emoji("🛡️"),
        h("h2", null, "Pas encore activée"),
        h("p", null, "Elle protège chaque compte avec le téléphone : même avec le mot de passe, personne ne peut entrer sans le téléphone de la personne."),
        blocActivation()));
      app.appendChild(h("div", { class: "actions-liste section" },
        EB.action("#/securite/guide/1", "📖", "Voir le guide pour l'équipe", "Ce que chacun fera, pas à pas.")));
      app.appendChild(EB.pied());
      return;
    }
    var s = D.statsMfa(etat), auj = D.jourIso();
    app.appendChild(blocActivation());
    app.appendChild(h("div", { class: "anneau", style: { "--p": String(s.pourcent) }, role: "img", "aria-label": s.protegees + " comptes protégés sur " + s.total },
      h("span", null, s.protegees + " / " + s.total, h("small", null, "protégés"))));
    app.appendChild(h("p", { class: "centre phrase-jour" }, s.protegees === s.total ? "Bravo : toute l'équipe est protégée." : (s.total - s.protegees) + " personne" + (s.total - s.protegees > 1 ? "s ne l'ont" : " ne l'a") + " pas encore activée."));
    var manquants = D.actifs(etat.personnes).filter(function (p) { var e = m.etats[p.id]; return e !== "appli" && e !== "sms"; });
    if (manquants.length > 1) app.appendChild(h("div", { class: "actions" }, h("button", { class: "btn large", type: "button", onclick: function () {
      EB.confirmer({ emoji: "🔔", titre: "Envoyer un rappel à " + manquants.length + " personnes ?", phrase: manquants.map(function (p) { return p.prenom; }).join(", ") + " recevront un mail avec le lien du guide.",
        consequence: "En démo, aucun message ne part.", bouton: "Oui, envoyer" }).then(function (ok) {
        if (!ok) return;
        manquants.forEach(function (p) { m.rappels[p.id] = auj; });
        X.sauver("Rappel double authentification", manquants.length + " personnes");
        EB.toast("Rappels envoyés (démo).");
        EB.rendre();
      });
    } }, "🔔 Relancer tous ceux qui ne l'ont pas")));
    app.appendChild(h("section", { class: "section" }, h("h2", null, "Qui l'a activée ?"),
      h("div", { class: "liste-personnes" }, D.actifs(etat.personnes).map(function (p) {
        var e = m.etats[p.id] || "aucune", E = D.ETATS_MFA[e], ok = e !== "aucune", r = m.rappels[p.id];
        return h("div", { class: "ligne-mfa" }, EB.avatar(p),
          h("div", { class: "qui" }, h("b", null, p.prenom), h("span", { class: "etat " + (ok ? "ok" : "non") }, E.emoji + " " + E.court)),
          ok ? null : h("div", { class: "acte" },
            h("button", { class: "btn secondaire petit", type: "button", onclick: function () {
              EB.confirmer({ emoji: "🔔", titre: "Envoyer un rappel à " + p.prenom + " ?", phrase: p.prenom + " recevra un mail avec le lien du guide pas à pas.",
                consequence: "En démo, aucun message ne part.", bouton: "Oui, envoyer" }).then(function (oui) {
                if (!oui) return;
                m.rappels[p.id] = auj; X.sauver("Rappel double authentification", p.prenom);
                EB.toast("Rappel envoyé à " + p.prenom + " (démo)."); EB.rendre();
              });
            } }, "🔔 Envoyer un rappel"),
            r ? h("small", null, "Dernier rappel : " + X.jourLisible(r)) : null));
      }))));
    app.appendChild(h("div", { class: "actions-liste section" },
      EB.action("#/securite/guide/1", "📖", "Le guide pour l'équipe", "À montrer, ou à envoyer avec le rappel.")));
    app.appendChild(EB.pied());
  }

  /* ------------------------------------------------------------------ */
  /* Guide pas à pas                                                     */
  /* ------------------------------------------------------------------ */
  var QR = '<rect x="2" y="2" width="7" height="7" rx="1"/><rect x="15" y="2" width="7" height="7" rx="1"/><rect x="2" y="15" width="7" height="7" rx="1"/>' +
    '<path d="M15 15h3v3M22 15v.01M15 22h.01M18 22h4v-4M12 2v4M12 9v3H9M2 12h4M12 15v7"/>';
  function pictoQr() {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "ic pictogramme-qr"); s.setAttribute("aria-hidden", "true");
    s.innerHTML = QR; return s;
  }
  function lien(url, texte) { return h("a", { class: "btn secondaire", href: url, target: "_blank", rel: "noopener noreferrer" }, EB.icone("ouvrir"), texte); }

  var ETAPES = [
    { emoji: "📲", titre: "Installer l'appli", corps: function () { return [
      h("p", null, "Sur votre téléphone, installez l'appli gratuite ", h("b", null, "Microsoft Authenticator"), "."),
      h("div", { class: "actions" }, lien("https://apps.apple.com/fr/app/microsoft-authenticator/id983156458", "iPhone (App Store)"),
        lien("https://play.google.com/store/apps/details?id=com.azure.authenticator", "Android (Google Play)")),
      h("p", { class: "petit" }, "Ouvrez-la une fois, puis acceptez les notifications.")]; } },
    { emoji: "🔳", titre: "Scanner le QR code", corps: function () { return [
      pictoQr(),
      h("ol", null,
        h("li", null, "Sur l'ordinateur, ouvrez la page « Mes informations de sécurité » de Microsoft (bouton ci-dessous) avec votre compte du Château."),
        h("li", null, "Choisissez « Ajouter une méthode », puis « Application d'authentification ». Un carré noir et blanc s'affiche : c'est le QR code."),
        h("li", null, "Dans l'appli du téléphone : touchez ＋, puis « Compte professionnel », puis « Scanner un code QR ». Visez le carré.")),
      h("div", { class: "actions" }, lien("https://mysignins.microsoft.com/security-info", "Mes informations de sécurité"))]; } },
    { emoji: "✅", titre: "Tester", corps: function () { return [
      h("p", null, "L'ordinateur affiche un nombre à deux chiffres."),
      h("p", null, "Le téléphone affiche une notification : tapez ce nombre, puis touchez ", h("b", null, "Oui"), "."),
      h("p", { class: "petit" }, "Si rien n'arrive, vérifiez que le téléphone a du réseau, puis recommencez.")]; } },
    { emoji: "🎉", titre: "C'est fait !", corps: function () { return [
      h("p", null, "Votre compte est protégé. À chaque nouvelle connexion, le téléphone vous demandera simplement de confirmer."),
      h("p", { class: "petit" }, "Nouveau téléphone ? Prévenez Damien avant de changer : il vous aidera à tout remettre.")]; } },
  ];

  function ecranGuide(app, n) {
    app.appendChild(EB.barre("Sécuriser mon compte", { href: "#/", texte: "Accueil" }));
    app.appendChild(EB.bandeauDemo("Démo — données fictives"));
    if (n === "sms") return guideSms(app);
    n = Math.min(Math.max(+n || 1, 1), ETAPES.length);
    var e = ETAPES[n - 1];
    app.appendChild(X.progression(n, ETAPES.length, e.titre));
    app.appendChild(h("div", { class: "etape-guide" }, EB.emoji(e.emoji), h("h2", null, e.titre), e.corps()));
    app.appendChild(X.navAssistant(n > 1 ? "#/securite/guide/" + (n - 1) : null, n < ETAPES.length ? "#/securite/guide/" + (n + 1) : "#/", n < ETAPES.length ? "Étape suivante" : "Terminer"));
    if (n < 4) app.appendChild(h("div", { class: "actions-liste section" },
      EB.action("#/securite/guide/sms", "💬", "Pas de smartphone ?", "Recevoir un code par SMS à la place.")));
  }

  function guideSms(app) {
    app.appendChild(h("div", { class: "etape-guide" }, EB.emoji("💬"), h("h2", null, "Avec un code par SMS"),
      h("p", null, "Moins pratique que l'appli, mais marche avec tous les téléphones."),
      h("ol", null,
        h("li", null, "Sur l'ordinateur, ouvrez « Mes informations de sécurité »."),
        h("li", null, "Choisissez « Ajouter une méthode », puis « Téléphone »."),
        h("li", null, "Tapez votre numéro de portable et choisissez « M'envoyer un code par SMS »."),
        h("li", null, "Recopiez le code à 6 chiffres reçu par SMS. C'est fait.")),
      h("div", { class: "actions" }, lien("https://mysignins.microsoft.com/security-info", "Mes informations de sécurité"))));
    app.appendChild(h("div", { class: "actions" }, h("a", { class: "btn secondaire", href: "#/securite/guide/1" }, EB.icone("gauche"), "Revenir au guide avec l'appli")));
  }

  /* ------------------------------------------------------------------ */
  /* Réglages : activer / désactiver (réservé à l'administrateur)       */
  /* ------------------------------------------------------------------ */
  /* Activer / désactiver : dans cet écran (réservé à l'administrateur), et nulle part ailleurs. */
  function blocActivation() {
    var m = X.etat().mfa;
    var seg = h("div", { class: "segments", role: "group", "aria-label": "Double authentification", style: { "--n": "2" } });
    [[true, "Activée"], [false, "Désactivée"]].forEach(function (o) {
      seg.appendChild(h("button", { type: "button", "aria-pressed": String(m.activee === o[0]), onclick: function () {
        if (m.activee === o[0]) return;
        EB.confirmer(o[0] ? { emoji: "🛡️", titre: "Activer la double authentification ?", phrase: "Chacun devra installer l'appli sur son téléphone. Le guide pas à pas est prêt.",
          consequence: "Vous pourrez suivre qui l'a fait et envoyer des rappels. En démo, rien ne change chez Microsoft.", bouton: "Oui, activer" }
          : { emoji: "⚠️", titre: "Désactiver la double authentification ?", phrase: "Les comptes ne seront plus protégés par le téléphone.",
            consequence: "C'est déconseillé. En démo, rien ne change chez Microsoft.", bouton: "Oui, désactiver" }).then(function (ok) {
          if (!ok) return;
          m.activee = o[0];
          X.sauver("Double authentification", o[0] ? "Activée" : "Désactivée");
          synchroniser();
          EB.toast(o[0] ? "Activée : le suivi est ci-dessous." : "Désactivée.");
          EB.rendre();
        });
      } }, o[1]));
    });
    return h("div", { class: "boite reglage" }, h("h2", null, "Pour toute l'équipe"), seg);
  }

  EB.ecran("securite", ecranSecurite);
})();
