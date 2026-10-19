/*
 * Espace Breteuil — v4 : écran « Déléguer » (#/deleguer), réservé à l'administrateur général.
 * Les changements sont RÉELS (droits délégués de la personne connectée).
 *
 * 1. Propriétaires du site SharePoint du Château (REST SharePoint, permissions actuelles :
 *    AllSites.FullControl) :
 *      lire     GET  /_api/web/sitegroups/getbyid(<groupe>)/users
 *      ajouter  POST /_api/web/ensureuser  puis  POST /_api/web/sitegroups/getbyid(<groupe>)/users { LoginName }
 *      retirer  POST /_api/web/sitegroups/getbyid(<groupe>)/users/removebyid(<id>)
 * 2. Rôles d'annuaire (Administrateur général, de facturation, des utilisateurs, Exchange),
 *    Graph roleManagement/directory/roleAssignments. Demande la permission déléguée
 *    RoleManagement.ReadWrite.Directory, PAS à la connexion : seulement ici (consentement
 *    incrémental, bouton « Autoriser la gestion des rôles »).
 *      lire     GET    /directoryRoles?$expand=members           (Directory.Read.All, déjà accordée)
 *      donner   POST   /roleManagement/directory/roleAssignments { roleDefinitionId, principalId, directoryScopeId: "/" }
 *      retirer  GET    /roleManagement/directory/roleAssignments?$filter=principalId eq … and roleDefinitionId eq …
 *               DELETE /roleManagement/directory/roleAssignments/<id>
 * Garde-fous (profil.js, testés) : jamais son propre rôle d'administrateur général, jamais le
 * dernier administrateur général, jamais le dernier propriétaire ni soi-même ; confirmation
 * en 2 étapes ; chaque action notée dans le journal (« Journal des délégations »).
 */
(function () {
  "use strict";
  var EB = window.EB, G = window.EBGraph, P = window.EBProfil, C = window.EBCache, D = window.EBDroits;
  if (!EB || !G || !P) return;
  var h = EB.h, icone = EB.icone, emoji = EB.emoji;
  var X = function () { return window.EBConnecte; };
  var PERM = P.PERMISSION_ROLES;

  function moiId() { var m = window.EBAcces && window.EBAcces.me(); return m && m.id; }
  function journal() {
    return (EB.lire("eb:journal", []) || []).filter(function (e) { return /^(Rôle|Propriétaire)/.test(e.action || ""); }).slice(0, 12);
  }
  function messagePermission(refus) {
    return h("div", { class: "bandeau " + (refus ? "erreur" : "info"), role: refus ? "alert" : "note", "data-permission": "manquante" }, icone(refus ? "exemple" : "cle"),
      h("div", null,
        h("strong", null, refus ? "La gestion des rôles n'a pas été autorisée." : "Une autorisation en plus est nécessaire pour gérer les rôles."),
        h("span", null, "Damien doit ajouter la permission " + PERM + " dans Entra (Espace Breteuil → API autorisées → Microsoft Graph → déléguée), puis accorder le consentement administrateur."),
        refus && refus.code ? h("small", { class: "detail-technique" }, refus.code) : null));
  }

  function ecran(app) {
    var gen = {};
    ecran.gen = gen;
    function la(el) { return ecran.gen === gen && document.body.contains(el); }
    app.appendChild(EB.barre("Donner un rôle", EB.hub()));
    app.appendChild(h("div", { class: "bandeau info", role: "note" }, icone("info"), h("div", null,
      h("strong", null, "Changements réels"), h("span", null, "Ils s'appliquent tout de suite chez Microsoft. Chaque action demande 2 confirmations et est notée dans le journal."))));

    /* ---------------- 1. Propriétaires du site ---------------- */
    var zoneProp = h("section", { class: "section", "aria-labelledby": "t-prop" }, h("h2", { id: "t-prop" }, "Gestionnaires (propriétaires du site)"), EB.squelette(2));
    app.appendChild(zoneProp);
    function chargerProp(force) {
      return X().contexte().then(function (c) {
        if (!c.groupeProprietaires) throw Object.assign(new Error("Le groupe des propriétaires du site est introuvable (SharePoint ne répond pas ?)."), { statut: 0 });
        var cle = "deleguer:proprietaires", charge = function () { return G.sp("GET", "/_api/web/sitegroups/getbyid(" + c.groupeProprietaires.Id + ")/users?$select=Id,Title,Email,LoginName,PrincipalType"); };
        return (force ? C.rafraichir(cle, charge) : C.obtenir(cle, charge, { ttl: 30000, surMaj: function (v) { if (la(zoneProp)) dessinerProp(c, v); } }))
          .then(function (v) { if (la(zoneProp)) dessinerProp(c, v); });
      }).catch(function (e) { if (!la(zoneProp)) return; vider(zoneProp, "Gestionnaires (propriétaires du site)"); zoneProp.appendChild(X().blocErreur(e)); });
    }
    function vider(zone, titre) { zone.textContent = ""; zone.appendChild(h("h2", null, titre)); }
    function dessinerProp(c, v) {
      var l = ((v && v.value) || []).filter(function (u) { return (u.PrincipalType == null || u.PrincipalType === 1) && !/sharepoint\\system|^app@sharepoint/i.test(u.LoginName || "") && !/^(compte syst[eè]me|system account)$/i.test(u.Title || ""); });
      var ids = l.map(function (u) { return u.Id; }), moi = c.moiSp && c.moiSp.Id;
      vider(zoneProp, "Gestionnaires (propriétaires du site)");
      zoneProp.appendChild(h("p", { class: "aide-ecran" }, "Ils choisissent qui peut ouvrir chaque dossier des documents de l'équipe."));
      zoneProp.appendChild(h("div", { class: "liste-acces" }, l.map(function (u) {
        var refus = P.refusRetraitProprietaire(u.Id, moi, ids);
        return h("div", { class: "carte-acces", "data-proprietaire": D.adresseDe(u) },
          X().avatarPersonne({ Title: u.Title, displayName: u.Title }),
          h("span", { class: "qui" }, h("b", null, u.Title), h("small", null, D.adresseDe(u)), refus ? h("span", { class: "etiquettes" }, h("span", { class: "etiquette protege", title: refus }, "🔒 " + (u.Id === moi ? "Vous" : "Dernier"))) : null),
          h("span", { class: "acts" }, h("button", { class: "btn petit secondaire", type: "button", disabled: !!refus, title: refus || null,
            onclick: function () { retirerProprietaire(c, u, ids); } }, "Retirer")));
      })));
      if (!l.length) zoneProp.appendChild(h("p", { class: "vide-doux" }, "Aucun propriétaire lisible."));
      zoneProp.appendChild(h("div", { class: "actions" }, h("button", { class: "btn", type: "button", "data-action": "ajouter-proprietaire", onclick: function () { ajouterProprietaire(c, l); } }, icone("plus"), "Rendre gestionnaire…")));
    }
    function ajouterProprietaire(c, actuels) {
      var p;
      X().choisirPersonne("Rendre gestionnaire").then(function (x) {
        if (!x) return null;
        if (x.type !== "interne") { EB.toast("Seule une personne du Château (@breteuil.fr) peut être gestionnaire."); return null; }
        p = x;
        if (actuels.some(function (u) { return D.adresseDe(u) === String(p.upn || p.mail).toLowerCase(); })) { EB.toast(p.nom + " est déjà gestionnaire."); return null; }
        return EB.confirmer({ emoji: "🏰", titre: "Rendre " + p.nom + " gestionnaire ?", phrase: p.nom + " pourra choisir qui peut ouvrir chaque dossier des documents de l'équipe.",
          consequence: "Cela vaut pour tout le site, tout de suite.", bouton: "Oui, rendre gestionnaire" });
      }).then(function (ok) {
        if (!ok) return;
        EB.toast("Un instant…");
        return G.sp("POST", "/_api/web/ensureuser", { logonName: D.logonName(p.upn || p.mail) }).then(function (u) {
          return G.sp("POST", "/_api/web/sitegroups/getbyid(" + c.groupeProprietaires.Id + ")/users", { LoginName: u.LoginName || D.logonName(p.upn || p.mail) });
        }).then(function () {
          X().noter("Propriétaire du site ajouté", p.nom);
          EB.toast(p.nom + " est maintenant gestionnaire.");
          return Promise.all([chargerProp(true), apresChangement()]);
        });
      }).catch(X().afficherErreur);
    }
    function retirerProprietaire(c, u, ids) {
      var refus = P.refusRetraitProprietaire(u.Id, c.moiSp && c.moiSp.Id, ids);
      if (refus) { EB.toast(refus); return; }
      EB.confirmer({ emoji: "🏰", titre: "Retirer " + u.Title + " des gestionnaires ?", phrase: u.Title + " ne pourra plus changer qui a accès aux dossiers.",
        consequence: "Ses autres accès (voir, modifier) ne changent pas.", bouton: "Oui, retirer" }).then(function (ok) {
        if (!ok) return;
        return G.sp("POST", "/_api/web/sitegroups/getbyid(" + c.groupeProprietaires.Id + ")/users/removebyid(" + u.Id + ")").then(function () {
          X().noter("Propriétaire du site retiré", u.Title);
          EB.toast(u.Title + " n'est plus gestionnaire.");
          return Promise.all([chargerProp(true), apresChangement()]);
        });
      }).catch(X().afficherErreur);
    }

    /* ---------------- 2. Rôles d'annuaire ---------------- */
    var zoneRoles = h("section", { class: "section", "aria-labelledby": "t-roles" }, h("h2", { id: "t-roles" }, "Rôles d'administration Microsoft"), EB.squelette(3));
    app.appendChild(zoneRoles);
    var permission = null;
    function chargerRoles(force) {
      if (force) C.oublier("annuaire:roles");
      return Promise.all([X().rolesAnnuaire(), permission === null ? G.aLaPermission(PERM) : Promise.resolve(permission)]).then(function (r) {
        permission = r[1];
        if (la(zoneRoles)) dessinerRoles(r[0]);
      }).catch(function (e) { if (!la(zoneRoles)) return; vider(zoneRoles, "Rôles d'administration Microsoft"); zoneRoles.appendChild(X().blocErreur(e)); });
    }
    function titulaires(roles, cle) {
      var rr = roles.filter(function (x) { return P.cleDeRole(x.roleTemplateId) === cle; })[0];
      return ((rr && rr.members) || []).filter(function (m) { return !m["@odata.type"] || m["@odata.type"] === "#microsoft.graph.user"; });
    }
    function dessinerRoles(roles) {
      vider(zoneRoles, "Rôles d'administration Microsoft");
      if (!permission) {
        zoneRoles.appendChild(messagePermission(G.consentementRefuse()));
        zoneRoles.appendChild(h("div", { class: "actions" }, h("button", { class: "btn", type: "button", "data-action": "autoriser-roles", onclick: function () {
          G.demanderPermission(PERM).then(function (ok) { if (ok) { permission = null; chargerRoles(); EB.toast("Gestion des rôles autorisée."); } else chargerRoles(); });
        } }, icone("cle"), "Autoriser la gestion des rôles")));
      }
      var adminIds = titulaires(roles, "admin").map(function (m) { return m.id; });
      P.ROLES_DELEGABLES.forEach(function (cle) {
        var R = P.ROLES[cle], l = titulaires(roles, cle);
        zoneRoles.appendChild(h("div", { class: "carte-role", "data-role": cle },
          h("div", { class: "tete" }, emoji(cle === "facturation" ? "💶" : cle === "exchange" ? "📬" : cle === "utilisateurs" ? "👥" : "🔑"),
            h("div", null, h("b", null, R.nom), h("span", null, R.phrase))),
          h("div", { class: "liste-acces" }, l.length ? l.map(function (m) {
            var refus = P.refusRetraitRole(cle, m.id, moiId(), adminIds);
            return h("div", { class: "carte-acces", "data-titulaire": m.id },
              X().avatarPersonne({ id: m.id, displayName: m.displayName }),
              h("span", { class: "qui" }, h("b", null, m.displayName), h("small", null, m.mail || m.userPrincipalName || ""),
                refus ? h("span", { class: "etiquettes" }, h("span", { class: "etiquette protege", title: refus }, "🔒 " + (m.id === moiId() ? "Vous" : "Dernier"))) : null),
              h("span", { class: "acts" }, h("button", { class: "btn petit secondaire", type: "button", disabled: !permission || !!refus, title: refus || (!permission ? "Autorisation nécessaire" : null),
                onclick: function () { retirerRole(cle, m, adminIds); } }, "Retirer")));
          }) : h("p", { class: "vide-doux" }, "Personne pour l'instant.")),
          h("div", { class: "actions" }, h("button", { class: "btn secondaire", type: "button", disabled: !permission, "data-action": "donner-" + cle,
            onclick: function () { donnerRole(cle, l); } }, icone("plus"), "Donner ce rôle…"))));
      });
    }
    function donnerRole(cle, actuels) {
      var R = P.ROLES[cle], p, id;
      X().choisirPersonne("Donner le rôle « " + R.nom + " »").then(function (x) {
        if (!x) return null;
        if (x.type !== "interne") { EB.toast("Un rôle d'administration ne se donne qu'à un compte du Château."); return null; }
        p = x;
        return G.graph("GET", "/users/" + encodeURIComponent(p.upn || p.mail) + "?$select=id,displayName").then(function (u) {
          id = u.id;
          if (actuels.some(function (m) { return m.id === id; })) { EB.toast(p.nom + " a déjà ce rôle."); return null; }
          return EB.confirmer({ emoji: "🔑", titre: "Donner le rôle à " + p.nom + " ?", phrase: p.nom + " deviendra « " + R.nom + " ». " + R.phrase,
            consequence: cle === "admin" ? "Attention : un administrateur général peut TOUT faire, y compris retirer vos propres droits." : "Cela prend effet tout de suite chez Microsoft.",
            bouton: "Oui, donner le rôle" });
        });
      }).then(function (ok) {
        if (!ok) return;
        EB.toast("Un instant…");
        return G.graph("POST", "/roleManagement/directory/roleAssignments", {
          "@odata.type": "#microsoft.graph.unifiedRoleAssignment", roleDefinitionId: R.id, principalId: id, directoryScopeId: "/",
        }, { scopes: [PERM] }).then(function () {
          X().noter("Rôle donné : " + R.nom, p.nom);
          EB.toast(p.nom + " est maintenant « " + R.nom + " ».");
          return chargerRoles(true);
        });
      }).catch(erreurRole);
    }
    function retirerRole(cle, m, adminIds) {
      var R = P.ROLES[cle];
      var refus = P.refusRetraitRole(cle, m.id, moiId(), adminIds);
      if (refus) { EB.toast(refus); return; }
      EB.confirmer({ emoji: "🔑", titre: "Retirer le rôle à " + m.displayName + " ?", phrase: m.displayName + " ne sera plus « " + R.nom + " ».",
        consequence: "Son compte, ses mails et ses fichiers ne changent pas : seul ce rôle est retiré.", bouton: "Oui, retirer le rôle" }).then(function (ok) {
        if (!ok) return;
        var filtre = "principalId eq '" + m.id + "' and roleDefinitionId eq '" + R.id + "'";
        return G.graph("GET", "/roleManagement/directory/roleAssignments?$filter=" + encodeURIComponent(filtre), undefined, { scopes: [PERM] }).then(function (j) {
          var l = (j && j.value) || [];
          if (!l.length) throw Object.assign(new Error("Ce rôle n'est pas attribué directement (groupe ou attribution « éligible ») : à retirer dans Entra."), { statut: 409 });
          return Promise.all(l.map(function (a) { return G.graph("DELETE", "/roleManagement/directory/roleAssignments/" + encodeURIComponent(a.id), undefined, { scopes: [PERM] }); }));
        }).then(function () {
          X().noter("Rôle retiré : " + R.nom, m.displayName);
          EB.toast(m.displayName + " n'est plus « " + R.nom + " ».");
          return chargerRoles(true);
        });
      }).catch(erreurRole);
    }
    function erreurRole(e) {
      if (e && (e.errorCode === "consent_required" || /consent|AADSTS65001|interaction_required/i.test(String(e.errorCode || e.message)))) {
        permission = false; chargerRoles();
        X().afficherErreur(Object.assign(new Error("Autorisation manquante : " + PERM + "."), { action: "Damien doit ajouter la permission " + PERM + " dans Entra, puis accorder le consentement administrateur." }));
        return;
      }
      X().afficherErreur(e);
    }

    /* ---------------- 3. Journal ---------------- */
    var zoneJournal = h("section", { class: "section" });
    app.appendChild(zoneJournal);
    function dessinerJournal() {
      vider(zoneJournal, "Journal des délégations");
      var j = journal();
      if (!j.length) zoneJournal.appendChild(h("p", { class: "vide-doux" }, "Aucune délégation faite depuis cet appareil."));
      else zoneJournal.appendChild(h("div", { class: "journal" }, j.map(function (e) {
        var t = Date.parse(e.quand);
        return h("div", { class: "ligne-journal" }, h("span", { class: "quand" }, isNaN(t) ? e.quand : EB.fmt(t, { day: "numeric", month: "short" }) + " · " + EB.heure(t)),
          h("b", null, e.action), h("span", null, e.cible), e.qui ? h("small", null, e.qui) : null);
      })));
      zoneJournal.appendChild(h("p", { class: "petit" }, "Le journal d'audit de Microsoft (Entra → Journaux d'audit) garde aussi la trace officielle de chaque changement."));
    }
    function apresChangement() {
      dessinerJournal();
      if (window.EBConnecte) window.EBConnecte.oublierContexte();
      if (window.EBAcces) return window.EBAcces.charger(true);
    }
    dessinerJournal();
    // Le journal se redessine après chaque rôle donné ou retiré.
    var chargerRolesAvant = chargerRoles;
    chargerRoles = function (f) { return chargerRolesAvant(f).then(function () { if (la(zoneJournal)) dessinerJournal(); }); };

    chargerProp(false);
    chargerRoles(false);
  }

  EB.ecran("deleguer", ecran);
})();
