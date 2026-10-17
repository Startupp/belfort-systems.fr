/*
 * Espace Breteuil — connexion Microsoft (MSAL.js) et accès à Microsoft Graph et à SharePoint.
 *
 * - Inactif tant que config.js n'a pas de clientId (mode démo).
 * - MSAL 3.30.0 servi depuis vendor/ (pas de CDN : compatible CSP script-src 'self').
 * - Jetons en MÉMOIRE uniquement (cacheLocation "memoryStorage") : rien n'est écrit sur
 *   l'appareil ; il faut se reconnecter à chaque ouverture (un clic si la session
 *   Microsoft du navigateur est encore ouverte).
 * - Permissions DÉLÉGUÉES : l'appli agit uniquement avec les droits de la personne connectée.
 *
 * Mode maquette (tests hors ligne) : ?maquette=1 sur localhost UNIQUEMENT. Aucune
 * connexion : les appels partent vers les vraies adresses, que le test intercepte.
 */
(function () {
  "use strict";

  var GRAPH = "https://graph.microsoft.com/v1.0";
  var MSAL_SRC = "vendor/msal-browser-3.30.0.min.js";
  var etat = { pca: null, compte: null, pret: false, erreur: "", maquette: false };

  function config() { return (self.EB_CONFIG && self.EB_CONFIG.microsoft) || {}; }
  function estMaquette() {
    return /[?&]maquette=1\b/.test(location.search) && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  }
  function estConfigure() { var c = config(); return estMaquette() || !!(c.clientId && c.tenantId); }
  function scopesGraph() { return config().scopes || ["User.Read"]; }
  function scopeSharePoint() { return config().sharepointScope || ""; }
  function origineSharePoint() {
    var s = (self.EB_CONFIG && self.EB_CONFIG.sharepoint && self.EB_CONFIG.sharepoint.site) || "";
    try { return new URL(s).origin; } catch (e) { return ""; }
  }

  function chargerScript(src) {
    return new Promise(function (ok, ko) {
      if (window.msal) return ok();
      var s = document.createElement("script");
      s.src = src; s.onload = function () { ok(); }; s.onerror = function () { ko(new Error("MSAL introuvable")); };
      document.head.appendChild(s);
    });
  }

  function init() {
    if (estMaquette()) {
      etat.maquette = true; etat.pret = true;
      etat.compte = { name: "Pauline (maquette)", username: "pdebreteuil@breteuil.fr", localAccountId: "moi" };
      return Promise.resolve(true);
    }
    if (!estConfigure()) return Promise.resolve(false);
    var c = config();
    var adresse = c.redirectUri || (location.origin + location.pathname);
    return chargerScript(MSAL_SRC).then(function () {
      etat.pca = new window.msal.PublicClientApplication({
        auth: {
          clientId: c.clientId,
          authority: "https://login.microsoftonline.com/" + c.tenantId,
          redirectUri: adresse, postLogoutRedirectUri: adresse, navigateToLoginRequestUrl: false,
        },
        cache: { cacheLocation: "memoryStorage", storeAuthStateInCookie: false },
        system: { allowNativeBroker: false },
      });
      return etat.pca.initialize();
    }).then(function () { return etat.pca.handleRedirectPromise(); }).then(function (r) {
      if (r && r.account) etat.compte = r.account;
      etat.pret = true;
      try {
        var retour = sessionStorage.getItem("eb:retour");
        if (retour) { sessionStorage.removeItem("eb:retour"); if (r) history.replaceState(null, "", retour); }
      } catch (e) {}
      return !!etat.compte;
    }).catch(function (e) {
      etat.erreur = traduireErreur(e);
      etat.pret = true;
      return false;
    });
  }

  function connecter() {
    if (etat.maquette) return Promise.resolve();
    if (!etat.pca) return Promise.reject(new Error("Connexion pas prête"));
    try { sessionStorage.setItem("eb:retour", location.hash || "#/"); } catch (e) {}
    var sp = scopeSharePoint();
    return etat.pca.loginRedirect({ scopes: scopesGraph(), extraScopesToConsent: sp ? [sp] : [], prompt: "select_account" });
  }

  function oublier() {
    etat.compte = null;
    if (etat.pca && etat.pca.clearCache) { try { etat.pca.clearCache(); } catch (e) {} }
  }

  /** Jeton pour Graph (« graph ») ou pour SharePoint (« sp »). */
  function jeton(ressource) {
    if (etat.maquette) return Promise.resolve("maquette");
    if (!etat.pca || !etat.compte) return Promise.reject(erreur(401, "Vous n'êtes pas connecté."));
    var scopes = ressource === "sp" ? [scopeSharePoint()] : scopesGraph();
    return etat.pca.acquireTokenSilent({ scopes: scopes, account: etat.compte }).then(function (r) { return r.accessToken; })
      .catch(function (e) {
        if (window.msal && e instanceof window.msal.InteractionRequiredAuthError) {
          try { sessionStorage.setItem("eb:retour", location.hash || "#/"); } catch (x) {}
          return etat.pca.acquireTokenRedirect({ scopes: scopes, account: etat.compte });
        }
        throw e;
      });
  }

  function erreur(statut, message) { var e = new Error(message); e.statut = statut; return e; }
  function traduireErreur(e) {
    var m = (e && (e.errorMessage || e.message)) || "";
    if (/AADSTS65001|consent/i.test(m)) return "L'appli n'a pas encore été autorisée par l'administrateur du Château.";
    if (/AADSTS50011|redirect/i.test(m)) return "Adresse de l'appli non déclarée dans Microsoft (URI de redirection).";
    if (/user_cancelled|AADSTS50058/i.test(m)) return "Connexion annulée.";
    return m ? "Connexion impossible : " + m.split("\n")[0].slice(0, 160) : "Connexion impossible.";
  }
  /** Message simple selon le code HTTP. */
  function messageHttp(statut, defaut) {
    if (statut === 401) return "Votre connexion a expiré. Reconnectez-vous.";
    if (statut === 403) return "Vous n'avez pas le droit de faire cela (droits Microsoft de votre compte).";
    if (statut === 404) return "Élément introuvable (supprimé ou déplacé ?).";
    if (statut === 409) return "Un élément porte déjà ce nom.";
    if (statut === 429 || statut === 503) return "Microsoft est occupé : réessayez dans une minute.";
    return defaut || "Microsoft a répondu par une erreur (" + statut + ").";
  }

  function appel(ressource, methode, url, corps, entetes) {
    return jeton(ressource).then(function (t) {
      var h = Object.assign({ Authorization: "Bearer " + t }, entetes || {});
      if (ressource === "sp") h.Accept = "application/json;odata=nometadata";
      if (corps !== undefined) h["Content-Type"] = ressource === "sp" ? "application/json;odata=nometadata" : "application/json";
      return fetch(url, { method: methode, headers: h, body: corps === undefined ? undefined : JSON.stringify(corps) });
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          var detail = "";
          try { var j = JSON.parse(t); detail = (j.error && (j.error.message && (j.error.message.value || j.error.message))) || j["odata.error"] && j["odata.error"].message.value || ""; } catch (e) {}
          var e = erreur(r.status, messageHttp(r.status));
          e.detail = typeof detail === "string" ? detail : "";
          throw e;
        });
      }
      if (r.status === 204) return null;
      var type = r.headers.get("Content-Type") || "";
      return /json/.test(type) ? r.json() : r.text().then(function (t) { try { return JSON.parse(t); } catch (e) { return t || null; } });
    });
  }

  /** Graph : GET/POST/PATCH/DELETE. Chemin relatif à /v1.0. */
  function graph(methode, chemin, corps) { return appel("graph", methode, GRAPH + chemin, corps); }
  /** Graph : toutes les pages d'une liste (@odata.nextLink), 5000 éléments au plus. */
  function graphTout(chemin) {
    var resultats = [];
    function page(url) {
      return appel("graph", "GET", url).then(function (j) {
        resultats = resultats.concat((j && j.value) || []);
        return j && j["@odata.nextLink"] && resultats.length < 5000 ? page(j["@odata.nextLink"]) : resultats;
      });
    }
    return page(GRAPH + chemin);
  }
  /** Graph : image (photo de profil) → adresse locale blob:, ou null. */
  function graphPhoto(chemin) {
    return jeton("graph").then(function (t) { return fetch(GRAPH + chemin, { headers: { Authorization: "Bearer " + t } }); })
      .then(function (r) { return r.ok ? r.blob().then(function (b) { return URL.createObjectURL(b); }) : null; })
      .catch(function () { return null; });
  }
  /** SharePoint REST : chemin relatif au site (« /_api/web/… ») ou adresse complète. */
  function sp(methode, chemin, corps, entetes) {
    var site = (self.EB_CONFIG.sharepoint.site || "").replace(/\/+$/, "");
    return appel("sp", methode, /^https:/.test(chemin) ? chemin : site + chemin, corps, entetes);
  }

  window.EBGraph = {
    estConfigure: estConfigure,
    estMaquette: function () { return etat.maquette; },
    init: init,
    connecter: connecter,
    oublier: oublier,
    estConnecte: function () { return !!etat.compte; },
    compte: function () { return etat.compte; },
    erreur: function () { return etat.erreur; },
    graph: graph, graphTout: graphTout, graphPhoto: graphPhoto, sp: sp,
    origineSharePoint: origineSharePoint,
    // Compatibilité avec l'annuaire de démo (app.js) : voir connecte.js.
    chargerAnnuaire: function () { return window.EBConnecte ? window.EBConnecte.annuairePourDemo() : Promise.reject(new Error("indisponible")); },
    chargerPhotos: function (liste, rappel) { return window.EBConnecte ? window.EBConnecte.chargerPhotos(liste, rappel) : Promise.resolve(); },
  };
})();
