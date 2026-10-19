/*
 * Espace Breteuil — v5.7 : écrans de l'application elle-même.
 *
 *   #/installer     « Installer l'application » (dans le navigateur) ou « Gérer l'application » (lancée installée) :
 *                   UN bouton ; invitation du navigateur quand elle existe ; sinon le geste exact pour CET appareil
 *                   (plateforme.js) ; version, « Rechercher une mise à jour », « Désinstaller » (geste expliqué : une
 *                   appli web ne peut pas se supprimer elle-même).
 *   #/acces-appli   « Qui peut utiliser l'application » : VRAI contrôle Microsoft (Affectation requise + affectations
 *                   de l'application d'entreprise), réservé aux administrateurs (acces-appli.js).
 *   Bientôt         cartes « bientôt disponible » (config.bientot) sur l'Accueil (gestion) et dans Gérer.
 *   Planning        carte « Partager le planning avec l'équipe » (lien public, sans connexion : #/planning).
 *   Refus Microsoft carte « L'application n'est pas ouverte pour vous » (AADSTS50105) sur le premier écran.
 */
(function () {
  "use strict";

  var EB = window.EB, PL = window.EBPlateforme, XA = window.EBAccesAppli;
  if (!EB) return;
  var h = EB.h, icone = EB.icone, emoji = EB.emoji;
  var G = function () { return window.EBGraph; }, X = function () { return window.EBConnecte; };
  var CFG = self.EB_CONFIG || {};
  var VERSION = self.EB_VERSION || "?";

  function plateforme() {
    var p = window.EBApparenceEcrans ? window.EBApparenceEcrans.plateforme() : PL.detecter(navigator.userAgent, {});
    p.invitation = !!(EB.invitation && EB.invitation());
    return p;
  }
  function etapes(liste) {
    return h("ol", { class: "inst-etapes" }, liste.map(function (e, i) {
      return h("li", null, h("span", { class: "inst-num", "aria-hidden": "true" }, String(i + 1)), h("span", { class: "inst-picto", "aria-hidden": "true" }, e.emoji), h("span", { class: "inst-texte" }, EB.insecable(e.texte)));
    }));
  }
  function adresse() { return location.origin + location.pathname; }
  /*
   * Encadré rassurant sous chaque bouton d'installation. Mesuré (v5.7, Chromium) : fichiers de l'appli gardés par le
   * service worker ≈ 1,4 Mo (58 fichiers, MSAL compris), place comptée par le navigateur ≈ 2,4 Mo ; réglages ≈ 10 Ko.
   * Données gardées sur l'appareil : le planning (hors connexion), les réglages, les épingles (noms et liens choisis),
   * le logo réduit. JAMAIS le contenu des documents : les listes de fichiers et photos restent en mémoire (cache.js).
   */
  var RASSURANT = "📱 Ne prend quasiment pas de place (moins de 3 Mo) : c'est un raccourci vers l'application en ligne. Vos documents OneDrive et SharePoint ne sont jamais téléchargés sur le téléphone. Seul le planning est gardé, pour s'afficher même sans réseau.";
  function rassurer() { return h("p", { class: "inst-rassurant", "data-etat": "rassurant" }, RASSURANT); }
  function copier(texte, quoi) {
    function secours() {
      var d = EB.dialogue(), champ = h("input", { class: "champ", type: "text", value: texte, readonly: true, "aria-label": "Adresse à copier" });
      var ok = h("button", { class: "btn large", type: "button", onclick: EB.fermerDialogue }, "Fermer");
      d.appendChild(h("div", { class: "contenu" }, h("h2", { id: "detail-titre" }, "Copiez l'adresse"), h("p", { class: "phrase" }, "Appui long sur l'adresse, puis « Copier »."), champ, ok));
      EB.ouvrirDialogue(d, champ); setTimeout(function () { champ.select(); }, 60);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(texte).then(function () { EB.toast((quoi || "Lien") + " copié."); }, secours);
    } catch (e) {}
    secours();
    return Promise.resolve();
  }

  /* ------------------------------------------------------------------ */
  /* Installer / Gérer l'application                                     */
  /* ------------------------------------------------------------------ */
  function ecranInstaller(app) {
    var p = plateforme();
    if (p.installee) return gerer(app, p);
    app.appendChild(EB.barre("Installer l'application", EB.connecte() ? { href: "#/moi", texte: "Moi" } : { href: "#/planning", texte: "Planning" }));
    var g = PL.guide(p);
    app.appendChild(h("div", { class: "inst-carte" },
      h("span", { class: "inst-icone" }, window.EBApparenceEcrans ? window.EBApparenceEcrans.imgLogo("inst-logo") : h("img", { src: "icones/icon.svg", alt: "" })),
      h("div", null, h("h2", null, "Espace Breteuil"), h("p", null, "Une icône sur votre " + PL.NOM_APPAREIL[p.appareil] + ", comme une vraie appli. Sans compte en plus."))));
    var guide = h("div", { class: "inst-guide", hidden: true, "data-guide": p.cas });
    guide.appendChild(h("h3", null, g.titre));
    guide.appendChild(etapes(g.etapes));
    if (g.note) guide.appendChild(h("p", { class: "petit" }, g.note));
    if (g.copier) guide.appendChild(h("button", { class: "btn secondaire", type: "button", "data-action": "copier-adresse", onclick: function () { copier(adresse(), "Adresse"); } }, icone("lien"), "Copier l'adresse"));
    var bouton = h("button", { class: "btn large", type: "button", "data-action": "installer", onclick: function () {
      var inv = EB.invitation && EB.invitation();
      if (inv && !p.ios) {
        EB.utiliserInvitation();
        inv.prompt();
        inv.userChoice.then(function (c) { if (c && c.outcome === "accepted") EB.toast("C'est installé : l'icône est sur votre écran d'accueil."); EB.rendre(); }, EB.rendre);
        return;
      }
      guide.hidden = false; bouton.hidden = true;
      var t = guide.querySelector("h3"); t.setAttribute("tabindex", "-1"); t.focus();
    } }, icone("installer"), "Installer l'application");
    app.appendChild(h("div", { class: "actions pile" }, bouton, rassurer()));
    app.appendChild(guide);
    if (p.cas === "bureau-firefox" || p.cas === "ios-autre") { guide.hidden = false; bouton.hidden = true; } // rien à toucher : on explique tout de suite
  }

  function gerer(app, p) {
    app.appendChild(EB.barre("Gérer l'application", EB.connecte() ? { href: "#/moi", texte: "Moi" } : { href: "#/planning", texte: "Planning" }));
    var etatMaj = h("p", { class: "petit", role: "status", "data-etat": "maj" }, "L'appli se met à jour toute seule, au lancement suivant.");
    app.appendChild(h("div", { class: "inst-carte" },
      h("span", { class: "inst-icone" }, window.EBApparenceEcrans ? window.EBApparenceEcrans.imgLogo("inst-logo") : h("img", { src: "icones/icon.svg", alt: "" })),
      h("div", null, h("h2", null, "Espace Breteuil"), h("p", null, "Installée sur ce " + PL.NOM_APPAREIL[p.appareil] + " · version " + VERSION))));
    var publiee = Number((CFG.icone || {}).version || 1), installee = EB.lire("eb:icone-installee", null);
    if (p.ios && installee != null && publiee > Number(installee)) app.appendChild(h("div", { class: "bandeau info", role: "note", "data-etat": "icone-ancienne" }, emoji("🖼️"),
      h("span", null, h("strong", null, "Le logo a changé."), "Pour voir le nouveau sur l'écran d'accueil : supprimez l'appli (ci-dessous) puis rajoutez-la depuis Safari. 30 secondes, rien n'est perdu.")));
    app.appendChild(h("div", { class: "actions pile" },
      h("button", { class: "btn large", type: "button", "data-action": "rechercher-maj", onclick: function () {
        var b = this; b.disabled = true; b.classList.add("en-cours"); etatMaj.textContent = "Recherche…";
        EB.verifierMiseAJour(true).then(function (r) {
          b.disabled = false; b.classList.remove("en-cours");
          etatMaj.textContent = r === "nouvelle" ? "Nouvelle version trouvée : l'appli redémarre…" : r === "a-jour" ? "L'appli est à jour (version " + VERSION + ")." : "Pas de connexion : réessayez plus tard.";
        });
      } }, icone("actualiser"), "Rechercher une mise à jour"),
      etatMaj,
      h("button", { class: "btn secondaire large", type: "button", "data-action": "desinstaller", onclick: function () { desinstaller(p); } }, "Désinstaller"),
      rassurer()));
  }
  function desinstaller(p) {
    var d = EB.dialogue(), ok = h("button", { class: "btn large", type: "button", onclick: EB.fermerDialogue }, "Compris");
    d.appendChild(h("div", { class: "contenu", "data-feuille": "desinstaller" },
      h("h2", { id: "detail-titre" }, "Désinstaller l'appli"),
      h("p", { class: "phrase" }, "Une appli web ne peut pas se supprimer elle-même : voici le geste sur votre " + PL.NOM_APPAREIL[p.appareil] + "."),
      etapes(PL.desinstaller(p).etapes),
      h("p", { class: "petit" }, "Vos documents et votre compte ne sont pas touchés. Pour la remettre : Moi › Installer l'application."), ok));
    EB.ouvrirDialogue(d, ok);
  }

  /* ------------------------------------------------------------------ */
  /* Qui peut utiliser l'application (Microsoft Entra)                   */
  /* ------------------------------------------------------------------ */
  var ENTRA = [
    "Ouvrir entra.microsoft.com avec un compte administrateur.",
    "Applications d'entreprise › « Espace Breteuil ».",
    "Utilisateurs et groupes › « Ajouter un utilisateur/groupe » : cocher les personnes autorisées (vous compris).",
    "Propriétés › « Affectation requise ? » : Oui (seules les personnes ajoutées) ou Non (tout le monde) › Enregistrer.",
  ];
  function blocEntra(ouvert) {
    return h("details", { class: "boite acces-entra", open: ouvert || null }, h("summary", null, "Faire à la main dans le portail Microsoft Entra"),
      h("ol", { class: "etapes" }, ENTRA.map(function (t) { return h("li", null, h("span", null, t)); })),
      h("a", { class: "btn secondaire", href: "https://entra.microsoft.com/#view/Microsoft_AAD_IAM/StartboardApplicationsMenuBlade/~/AppAppsPreview", target: "_blank", rel: "noopener noreferrer" }, icone("ouvrir"), "Ouvrir Entra"));
  }
  function aLesDroitsEcriture() {
    return Promise.all(XA.SCOPES_ECRIRE.map(function (s) { return G().aLaPermission(s); })).then(function (l) { return l.every(Boolean); });
  }
  function chargerAcces() {
    var cid = (CFG.microsoft || {}).clientId || "";
    return G().graph("GET", "/servicePrincipals(appId='" + encodeURIComponent(cid) + "')?$select=id,appId,displayName,appRoleAssignmentRequired").then(function (sp) {
      return Promise.all([
        sp, G().graphTout("/servicePrincipals/" + sp.id + "/appRoleAssignedTo?$select=id,principalId,principalType,principalDisplayName,appRoleId&$top=999"),
        X().utilisateurs().then(function (u) { return u.liste; }),
        X().rolesAnnuaire().catch(function () { return []; }),
      ]);
    }).then(function (r) {
      var admins = [];
      (r[3] || []).forEach(function (role) { if (String(role.roleTemplateId).toLowerCase() === XA.GA) (role.members || []).forEach(function (m) { admins.push(m.id); }); });
      var me = window.EBAcces && window.EBAcces.me();
      return { sp: r[0], etat: XA.etat(r[0], r[1], r[2], admins, me && me.id, CFG.prestataires || []) };
    });
  }
  function ecranAcces(app) {
    app.appendChild(EB.barre("Qui peut utiliser l'application", EB.hub()));
    var zone = h("div", { class: "acces-appli" }, EB.squelette(5));
    app.appendChild(zone);
    var refus = G().consentementRefuse && G().consentementRefuse();
    Promise.all([chargerAcces(), aLesDroitsEcriture()]).then(function (r) {
      if (!document.body.contains(zone)) return;
      dessinerAcces(zone, r[0], r[1], refus);
    }, function (e) {
      if (!document.body.contains(zone)) return;
      zone.textContent = "";
      zone.appendChild(X().blocErreur(e, EB.rendre));
      zone.appendChild(blocEntra(true));
    });
  }
  var choixPresta = { sansPrestataire: false }; // retrait du prestataire décidé sur cet écran (mode « tout le monde »)
  function dessinerAcces(zone, d, ecrire, refus) {
    zone.textContent = "";
    var e = d.etat;
    zone.appendChild(h("p", { class: "aide-ecran" }, "Ce réglage est fait chez Microsoft : une personne non cochée ne peut pas se connecter à l'application (Microsoft refuse la connexion)."));
    if (!ecrire) {
      zone.appendChild(h("div", { class: "boite acces-consentement", "data-etat": "consentement" },
        h("h2", null, emoji("🔐"), " Une autorisation Microsoft d'abord"),
        h("p", null, "Microsoft va vous demander d'autoriser l'Espace Breteuil à gérer qui peut l'ouvrir, en votre nom (cette autorisation n'est demandée qu'aux administrateurs, sur cet écran)."),
        refus ? h("p", { class: "erreur", role: "alert", "data-etat": "refuse" }, "L'autorisation a été refusée ou n'a pas pu être donnée. Vous pouvez faire le réglage à la main dans Entra (ci-dessous).") : null,
        h("button", { class: "btn large", type: "button", "data-action": "autoriser", onclick: function () {
          Promise.resolve(G().demanderPermission(XA.SCOPES_ECRIRE)).then(function () { EB.rendre(); });
        } }, icone("cle"), "Autoriser")));
    }
    var mode = h("div", { class: "acces-mode", role: "radiogroup", "aria-label": "Qui peut utiliser l'application" });
    [["tous", "🌍", "Tout le monde peut utiliser l'application", "Toute personne du Château qui a un compte Microsoft."],
      ["choisis", "✅", "Seulement les personnes cochées", "Les autres verront « L'application n'est pas ouverte pour vous »."]].forEach(function (o) {
      var actif = (o[0] === "choisis") === e.restreint;
      mode.appendChild(h("button", { type: "button", role: "radio", class: "choix acces-option", "aria-checked": String(actif), "data-mode": o[0], disabled: !ecrire && !actif ? true : null,
        onclick: function () { if (!actif) changerMode(o[0] === "choisis", d, zone); } },
        emoji(o[1]), h("span", null, h("b", null, o[2]), h("small", null, o[3]))));
    });
    zone.appendChild(mode);
    zone.appendChild(h("p", { class: "acces-resume", role: "status" }, XA.resume(e)));
    var liste = h("ul", { class: "acces-liste", "aria-label": "Personnes" });
    e.lignes.forEach(function (l) {
      var id = "acc-" + l.id;
      var c = h("input", { type: "checkbox", id: id, checked: XA.afficheeCochee(e, l, choixPresta) ? true : null, disabled: l.verrouille || !ecrire ? true : null, "data-personne": l.id });
      c.addEventListener("change", function () { if (l.prestataire) basculerPresta(l, c.checked, d, c); else basculer(l, c.checked, d, zone, c); });
      if (l.prestataire) {
        liste.appendChild(h("li", { class: "acces-ligne prestataire", "data-ligne": "prestataire" }, c,
          h("label", { for: id }, h("b", null, emoji("🛠️"), " Prestataire informatique — accès de maintenance"),
            h("small", null, l.nom + " · " + l.mail), h("small", { class: "acces-explication" }, "Permet à Damien de tester et de dépanner l'application."))));
        return;
      }
      liste.appendChild(h("li", { class: "acces-ligne" + (l.verrouille ? " verrouille" : "") }, c,
        h("label", { for: id }, h("b", null, l.nom), h("small", null, l.verrouille ? (l.raison === "Vous" ? "Vous · toujours autorisé" : "Administrateur général · toujours autorisé") : l.mail))));
    });
    e.groupes.forEach(function (g) {
      liste.appendChild(h("li", { class: "acces-ligne groupe" }, emoji("👥"), h("span", null, h("b", null, g.nom), h("small", null, "Groupe : tous ses membres (à changer dans Entra)"))));
    });
    zone.appendChild(liste);
    zone.appendChild(h("div", { class: "note" }, icone("info"), h("span", null,
      "Ceci règle qui peut se connecter à l'application, pas les documents : chaque document reste protégé par ses propres droits Microsoft. Le planning reste visible sans connexion par son lien (écran Planning).")));
    zone.appendChild(blocEntra(!!refus));
  }
  function echec(e) { if (X().afficherErreur) X().afficherErreur(e); else EB.toast("Ça n'a pas marché."); }
  function basculer(l, on, d, zone, c) {
    if (!on && XA.refusDecocher(l)) { c.checked = true; EB.toast(XA.refusDecocher(l)); return; }
    c.disabled = true;
    var sp = d.sp.id, p = on ? G().graph("POST", "/servicePrincipals/" + sp + "/appRoleAssignedTo", XA.corpsAffectation(sp, l.id))
      : l.affectationId ? G().graph("DELETE", "/servicePrincipals/" + sp + "/appRoleAssignedTo/" + l.affectationId) : Promise.resolve();
    p.then(function () { EB.toast(on ? l.nom + " peut utiliser l'application." : l.nom + " n'est plus coché."); EB.rendre(); }, function (e) { c.checked = !on; c.disabled = false; echec(e); });
  }
  /** Prestataire : le retirer demande une confirmation explicite ; le remettre, non. */
  function basculerPresta(l, on, d, c) {
    if (on) { choixPresta.sansPrestataire = false; if (d.etat.restreint && !l.coche) basculer(l, true, d, null, c); else EB.rendre(); return; }
    c.checked = true;
    EB.confirmer({ emoji: "🛠️", titre: "Mettre fin à l'accès du prestataire ?", phrase: "Damien ne pourra plus se connecter à l'application pour la tester ni la dépanner.",
      consequence: "Vous pourrez le recocher à tout moment.", bouton: "Mettre fin à l'accès du prestataire" }).then(function (ok) {
      if (!ok) return;
      choixPresta.sansPrestataire = true;
      if (l.affectationId) basculer(l, false, d, null, c); else { EB.toast("Le prestataire ne sera pas ajouté."); EB.rendre(); }
    });
  }
  function changerMode(restreindre, d, zone) {
    var e = d.etat, sp = d.sp.id;
    var opts = restreindre
      ? { emoji: "✅", titre: "Seulement les personnes cochées ?", phrase: "Les personnes non cochées ne pourront plus se connecter à l'application.",
        consequence: "Vous et les administrateurs généraux restez toujours autorisés (cochés automatiquement)" + (e.lignes.some(function (l) { return l.prestataire; }) && !choixPresta.sansPrestataire ? ", ainsi que le prestataire informatique (accès de maintenance)" : "") + ". Les autres verront « L'application n'est pas ouverte pour vous ».", bouton: "Oui, seulement les personnes cochées" }
      : { emoji: "🌍", titre: "Ouvrir à tout le monde ?", phrase: "Toute personne du Château pourra se connecter à l'application.", bouton: "Oui, tout le monde", deuxEtapes: false };
    EB.confirmer(opts).then(function (ok) {
      if (!ok) return;
      var avant = restreindre ? XA.aAffecterAvantRestriction(e, choixPresta) : [];
      // Garde-fou : d'abord affecter vous + les administrateurs généraux, ENSUITE seulement restreindre.
      avant.reduce(function (pr, id) { return pr.then(function () { return G().graph("POST", "/servicePrincipals/" + sp + "/appRoleAssignedTo", XA.corpsAffectation(sp, id)); }); }, Promise.resolve())
        .then(function () { return G().graph("PATCH", "/servicePrincipals/" + sp, { appRoleAssignmentRequired: !!restreindre }); })
        .then(function () { EB.toast(restreindre ? "C'est fait : seules les personnes cochées peuvent se connecter." : "C'est fait : tout le monde peut se connecter."); EB.rendre(); }, echec);
    });
  }

  /** Premier écran : Microsoft a refusé la connexion (AADSTS50105). */
  function carteRefus(voirPlanning, autreCompte) {
    return h("div", { class: "carte-refus", role: "alert", "data-etat": "non-ouverte" },
      emoji("🔒", "grand"),
      h("h2", null, "L'application n'est pas ouverte pour vous"),
      h("p", null, "Demandez à François : il peut vous ajouter en quelques secondes."),
      h("button", { class: "btn large", type: "button", "data-action": "refus-planning", onclick: voirPlanning }, icone("agenda"), "Voir le planning"),
      h("button", { class: "btn secondaire large", type: "button", "data-action": "refus-autre-compte", onclick: autreCompte }, "Se connecter avec un autre compte"));
  }

  /* ------------------------------------------------------------------ */
  /* Bientôt                                                             */
  /* ------------------------------------------------------------------ */
  function listeBientot() {
    return (Array.isArray(CFG.bientot) ? CFG.bientot : []).filter(function (b) { return b && typeof b.titre === "string" && b.titre; }).slice(0, 6);
  }
  function feuilleBientot(b) {
    var d = EB.dialogue(), ok = h("button", { class: "btn large", type: "button", onclick: EB.fermerDialogue }, "Compris");
    d.appendChild(h("div", { class: "contenu centre", "data-feuille": "bientot" }, emoji(b.emoji || "✨", "grand"), h("h2", { id: "detail-titre" }, EB.insecable(b.titre)),
      h("p", { class: "etiquette bientot-badge" }, "En préparation"), h("p", { class: "phrase" }, b.texte || "Cette partie arrive bientôt dans l'appli."), ok));
    EB.ouvrirDialogue(d, ok);
  }
  function bientot(titreSection) {
    var l = listeBientot();
    if (!l.length) return null;
    return h("section", { class: "section", "data-section": "bientot" }, h("h2", null, titreSection || "Bientôt"),
      h("div", { class: "bientot-liste" }, l.map(function (b) {
        return h("button", { type: "button", class: "bientot-carte", "data-bientot": b.titre, onclick: function () { feuilleBientot(b); } },
          h("span", { class: "bientot-emoji", "aria-hidden": "true" }, b.emoji || "✨"),
          h("span", { class: "bientot-textes" }, h("b", null, EB.insecable(b.titre + " — bientôt disponible")), h("small", null, "En préparation")),
          h("span", { class: "etiquette bientot-badge", "aria-hidden": "true" }, "Bientôt"));
      })));
  }

  /* ------------------------------------------------------------------ */
  /* Planning : partager le lien public                                  */
  /* ------------------------------------------------------------------ */
  function lienPlanning() { return adresse() + "#/planning"; }
  function partagePlanning() {
    var lien = lienPlanning();
    return h("section", { class: "partage-planning", "aria-labelledby": "t-partage" },
      h("h2", { id: "t-partage" }, emoji("👥"), " Partager le planning avec l'équipe"),
      h("p", null, "Les employés sans compte Microsoft peuvent voir ce planning avec ce lien, sans connexion. Ce n'est pas une obligation : Outlook ou leur agenda personnel restent possibles."),
      h("p", { class: "partage-lien", "data-lien": lien }, lien),
      h("div", { class: "partage-boutons" },
        h("button", { class: "btn", type: "button", "data-action": "copier-lien-planning", onclick: function () { copier(lien, "Lien"); } }, icone("lien"), "Copier le lien"),
        navigator.share ? h("button", { class: "btn secondaire", type: "button", "data-action": "partager-planning", onclick: function () {
          navigator.share({ title: "Planning du Château de Breteuil", text: "Le planning du Château, sans connexion :", url: lien }).catch(function () {});
        } }, "Partager…") : null));
  }

  EB.ecran("installer", ecranInstaller);
  EB.ecran("acces-appli", ecranAcces);
  window.EBAppliEcrans = { rassurer: rassurer, RASSURANT: RASSURANT, bientot: bientot, partagePlanning: partagePlanning, lienPlanning: lienPlanning, carteRefus: carteRefus, plateforme: plateforme };
})();
