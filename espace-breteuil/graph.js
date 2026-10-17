/*
 * Espace Breteuil — connexion Microsoft (LECTURE SEULE) via MSAL.js et Microsoft Graph.
 *
 * Inactif tant que config.js n'a pas de clientId ET de tenantId (mode démo).
 * - MSAL 3.30.0 est servi depuis vendor/ (pas de CDN : compatible CSP script-src 'self').
 * - Jetons en MÉMOIRE uniquement (cacheLocation "memoryStorage") : rien n'est écrit
 *   sur l'appareil ; à chaque ouverture de l'appli il faut se reconnecter (ou la
 *   session Microsoft du navigateur le fait en un clic).
 * - Uniquement des requêtes GET. Aucune écriture vers Microsoft 365 n'existe dans ce code.
 */
(function () {
  "use strict";

  var GRAPH = "https://graph.microsoft.com/v1.0";
  var MSAL_SRC = "vendor/msal-browser-3.30.0.min.js";

  /* Rôles d'annuaire Microsoft (identifiants de modèle fixes) → rôles de l'appli. */
  var ROLES_MICROSOFT = {
    "62e90394-69f5-4237-9190-012177145e10": "admin",        // Global Administrator
    "b0f54661-2d74-4c50-afa3-1ec803f12efe": "facturation",  // Billing Administrator
    "fe930be7-5e62-47db-91af-98c3a49a38b1": "utilisateurs", // User Administrator
  };
  /* Références de licences Microsoft → formules du Château. */
  var SKUS = {
    "O365_BUSINESS_PREMIUM": "complete",      // Microsoft 365 Business Standard
    "O365_BUSINESS_ESSENTIALS": "express-teams", // Microsoft 365 Business Basic
    "EXCHANGESTANDARD": "express",            // Exchange Online (Plan 1)
  };

  var etat = { pca: null, compte: null, pret: false, erreur: "" };

  function config() { return (self.EB_CONFIG && self.EB_CONFIG.microsoft) || {}; }
  function estConfigure() { var c = config(); return !!(c.clientId && c.tenantId); }
  function scopes() { return config().scopes || ["User.Read"]; }

  function chargerScript(src) {
    return new Promise(function (ok, ko) {
      if (window.msal) return ok();
      var s = document.createElement("script");
      s.src = src; s.onload = function () { ok(); }; s.onerror = function () { ko(new Error("MSAL introuvable")); };
      document.head.appendChild(s);
    });
  }

  /** Prépare MSAL et récupère la réponse d'une connexion par redirection. */
  function init() {
    if (!estConfigure()) return Promise.resolve(false);
    var c = config();
    return chargerScript(MSAL_SRC).then(function () {
      etat.pca = new window.msal.PublicClientApplication({
        auth: {
          clientId: c.clientId,
          authority: "https://login.microsoftonline.com/" + c.tenantId,
          redirectUri: c.redirectUri || (location.origin + location.pathname),
          postLogoutRedirectUri: c.redirectUri || (location.origin + location.pathname),
          navigateToLoginRequestUrl: false,
        },
        cache: { cacheLocation: "memoryStorage", storeAuthStateInCookie: false },
        system: { allowNativeBroker: false },
      });
      return etat.pca.initialize();
    }).then(function () {
      return etat.pca.handleRedirectPromise();
    }).then(function (r) {
      if (r && r.account) etat.compte = r.account;
      etat.pret = true;
      // Retour à l'écran d'où l'on est parti avant la redirection.
      try {
        var retour = sessionStorage.getItem("eb:retour");
        if (retour) { sessionStorage.removeItem("eb:retour"); if (r) history.replaceState(null, "", retour); }
      } catch (e) {}
      return !!etat.compte;
    }).catch(function (e) {
      etat.erreur = (e && (e.errorMessage || e.message)) || "Connexion impossible";
      etat.pret = true;
      return false;
    });
  }

  function connecter() {
    if (!etat.pca) return Promise.reject(new Error("MSAL non prêt"));
    try { sessionStorage.setItem("eb:retour", location.hash || "#/"); } catch (e) {}
    return etat.pca.loginRedirect({ scopes: scopes(), prompt: "select_account" });
  }

  /** Oublie la session dans l'appli (jetons en mémoire) sans déconnecter tout Microsoft. */
  function oublier() {
    etat.compte = null;
    if (etat.pca && etat.pca.clearCache) { try { etat.pca.clearCache(); } catch (e) {} }
  }

  function jeton() {
    if (!etat.pca || !etat.compte) return Promise.reject(new Error("Non connecté"));
    return etat.pca.acquireTokenSilent({ scopes: scopes(), account: etat.compte }).then(function (r) { return r.accessToken; })
      .catch(function (e) {
        if (window.msal && e instanceof window.msal.InteractionRequiredAuthError) {
          return etat.pca.acquireTokenRedirect({ scopes: scopes(), account: etat.compte });
        }
        throw e;
      });
  }

  /** GET Graph (lecture seule). `toutes` suit la pagination @odata.nextLink. */
  function lire(chemin, toutes) {
    return jeton().then(function (t) {
      var resultats = [];
      function page(url) {
        return fetch(url, { headers: { Authorization: "Bearer " + t } }).then(function (r) {
          if (!r.ok) throw new Error("Graph " + r.status + " sur " + chemin.split("?")[0]);
          return r.json();
        }).then(function (j) {
          if (!toutes) return j;
          resultats = resultats.concat(j.value || []);
          return j["@odata.nextLink"] && resultats.length < 5000 ? page(j["@odata.nextLink"]) : resultats;
        });
      }
      return page(GRAPH + chemin);
    });
  }

  function photo(id) {
    return jeton().then(function (t) {
      return fetch(GRAPH + "/users/" + encodeURIComponent(id) + "/photos/64x64/$value", { headers: { Authorization: "Bearer " + t } });
    }).then(function (r) { return r.ok ? r.blob().then(function (b) { return URL.createObjectURL(b); }) : null; })
      .catch(function () { return null; });
  }

  /**
   * Annuaire réel : collaborateurs (poste, service, responsable, licence, compte bloqué),
   * rôles d'administration, groupes (équipes / sites) et licences achetées / attribuées.
   * Même forme que les données de démo, pour que les écrans n'aient pas à changer.
   */
  function chargerAnnuaire() {
    var utilisateurs, skus, roles, groupes;
    return Promise.all([
      lire("/users?$select=id,displayName,givenName,jobTitle,department,userType,accountEnabled,assignedLicenses&$expand=manager($select=id)&$top=999", true).then(function (v) { utilisateurs = v; }),
      lire("/subscribedSkus", true).then(function (v) { skus = v; }),
      lire("/directoryRoles?$expand=members($select=id)", true).then(function (v) { roles = v; }),
      lire("/groups?$select=id,displayName,groupTypes,mailEnabled,securityEnabled&$expand=members($select=id)&$top=999", true)
        .then(function (v) { groupes = v; }, function () { groupes = []; }),
    ]).then(function () {
      var formuleDeSku = {}, nomDeSku = {};
      var achetees = { "complete": 0, "express-teams": 0, "express": 0 };
      skus.forEach(function (s) {
        var f = SKUS[s.skuPartNumber];
        formuleDeSku[s.skuId] = f || null;
        nomDeSku[s.skuId] = s.skuPartNumber;
        if (f) achetees[f] += (s.prepaidUnits && s.prepaidUnits.enabled) || 0;
      });
      var couleurs = ["#6B1524", "#1D6B52", "#2E5A8A", "#7A3E8E", "#8A4B00", "#35601A", "#3A6EA5", "#8A2B3B"];
      var collaborateurs = utilisateurs.filter(function (u) { return u.userType !== "Guest"; }).map(function (u, i) {
        var lic = (u.assignedLicenses || []).map(function (l) { return formuleDeSku[l.skuId]; }).filter(Boolean);
        return {
          id: u.id,
          prenom: u.givenName || u.displayName || "(sans nom)",
          nomAffiche: u.displayName || "",
          poste: u.jobTitle || "",
          pole: u.department || "",
          responsable: (u.manager && u.manager.id) || "",
          licence: lic[0] || "aucune",
          licencesBrutes: (u.assignedLicenses || []).map(function (l) { return nomDeSku[l.skuId] || l.skuId; }),
          boites: null, // non lisible via Graph (droits Exchange) : phase 3
          bloque: u.accountEnabled === false,
          couleur: couleurs[i % couleurs.length],
          photo: null,
        };
      }).sort(function (a, b) { return a.prenom.localeCompare(b.prenom, "fr"); });

      var r = { admin: [], facturation: [], utilisateurs: [] };
      roles.forEach(function (role) {
        var cle = ROLES_MICROSOFT[role.roleTemplateId];
        if (cle) r[cle] = (role.members || []).map(function (m) { return m.id; });
      });
      var g = groupes.map(function (gr) {
        var m = {};
        (gr.members || []).forEach(function (x) { m[x.id] = "membre"; });
        return { id: gr.id, nom: gr.displayName, membres: m, microsoft365: (gr.groupTypes || []).indexOf("Unified") > -1 };
      }).sort(function (a, b) { return a.nom.localeCompare(b.nom, "fr"); });

      return { collaborateurs: collaborateurs, roles: r, dossiers: g, achetees: achetees };
    });
  }

  /** Photos chargées petit à petit (4 à la fois) ; `rappel` est appelé à chaque photo. */
  function chargerPhotos(collaborateurs, rappel) {
    var file = collaborateurs.slice(), actifs = 0;
    return new Promise(function (fini) {
      function suite() {
        if (!file.length && !actifs) return fini();
        while (actifs < 4 && file.length) {
          var c = file.shift(); actifs++;
          photo(c.id).then(function (c) { return function (url) { if (url) { c.photo = url; rappel && rappel(c); } }; }(c))
            .then(function () { actifs--; suite(); });
        }
      }
      suite();
    });
  }

  window.EBGraph = {
    estConfigure: estConfigure,
    init: init,
    connecter: connecter,
    oublier: oublier,
    estConnecte: function () { return !!etat.compte; },
    compte: function () { return etat.compte; },
    erreur: function () { return etat.erreur; },
    chargerAnnuaire: chargerAnnuaire,
    chargerPhotos: chargerPhotos,
    _SKUS: SKUS, _ROLES: ROLES_MICROSOFT,
  };
})();
