/*
 * Espace Breteuil — connexion Microsoft (MSAL.js) et accès à Microsoft Graph et à SharePoint.
 *
 * - Inactif tant que config.js n'a pas de clientId (mode démo).
 * - MSAL 3.30.0 servi depuis vendor/ (pas de CDN : compatible CSP script-src 'self').
 * - Session gardée TANT QUE L'ONGLET (ou l'appli installée) RESTE OUVERT :
 *   cacheLocation "sessionStorage". Fermer l'onglet ou l'appli efface tout ; jamais de
 *   localStorage pour les jetons. Compromis documenté dans docs/ESPACE-BRETEUIL-CONNEXION.md.
 * - Connexion : fenêtre (popup) d'abord, puis redirection si la fenêtre est bloquée.
 *   Appli installée sur iPhone/iPad (écran d'accueil) : redirection directement, car une
 *   fenêtre s'ouvrirait dans Safari, hors de l'appli.
 * - Permissions DÉLÉGUÉES : l'appli agit uniquement avec les droits de la personne connectée.
 * - Erreurs traduites par erreurs.js ; 429/503 réessayés automatiquement (3 fois au plus).
 *
 * Mode maquette (tests hors ligne) : ?maquette=1 sur localhost UNIQUEMENT. Aucune
 * connexion : les appels partent vers les vraies adresses, que le test intercepte.
 */
(function () {
  "use strict";

  var GRAPH = "https://graph.microsoft.com/v1.0";
  var MSAL_SRC = "vendor/msal-browser-3.30.0.min.js";
  var etat = { pca: null, compte: null, pret: false, erreur: "", erreurDetail: null, maquette: false, vientDeSeConnecter: false };
  var E = self.EBErreurs;
  var REESSAIS = 3;

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

  /** Cette page est-elle la fenêtre de connexion ouverte par l'appli (popup MSAL) ? */
  function estFenetreConnexion() {
    try { return !!window.opener && window.opener !== window && /^msal\./.test(window.name || ""); } catch (e) { return false; }
  }
  /** Appli installée sur l'écran d'accueil d'un iPhone/iPad : pas de popup possible. */
  function estIosInstalle() {
    var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    var installe = window.navigator.standalone === true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    return ios && installe;
  }
  function choisirCompte() {
    if (etat.compte || !etat.pca) return;
    var actif = etat.pca.getActiveAccount && etat.pca.getActiveAccount();
    var tous = etat.pca.getAllAccounts ? etat.pca.getAllAccounts() : [];
    etat.compte = actif || (tous.length ? tous[0] : null);
    if (etat.compte && etat.pca.setActiveAccount) etat.pca.setActiveAccount(etat.compte);
  }
  function retenirErreur(e) { etat.erreurDetail = E.expliquer(e); etat.erreur = etat.erreurDetail.titre + " " + etat.erreurDetail.action; }

  function init() {
    if (estFenetreConnexion()) {
      // Fenêtre de connexion : la page mère lit la réponse et ferme la fenêtre. Ne rien démarrer ici.
      etat.pret = true;
      return new Promise(function () {});
    }
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
        // sessionStorage : la session tient tant que l'onglet ou l'appli reste ouvert (jamais localStorage).
        cache: { cacheLocation: "sessionStorage", storeAuthStateInCookie: false },
        system: { allowNativeBroker: false },
      });
      return etat.pca.initialize();
    }).then(function () { return etat.pca.handleRedirectPromise(); }).then(function (r) {
      if (r && r.account) { etat.compte = r.account; etat.vientDeSeConnecter = true; if (etat.pca.setActiveAccount) etat.pca.setActiveAccount(r.account); }
      choisirCompte();
      etat.pret = true;
      try {
        var retour = sessionStorage.getItem("eb:retour");
        if (retour) { sessionStorage.removeItem("eb:retour"); if (r) history.replaceState(null, "", retour); }
      } catch (e) {}
      return !!etat.compte;
    }).catch(function (e) {
      retenirErreur(e);
      try { choisirCompte(); } catch (x) {}
      etat.pret = true;
      return !!etat.compte;
    });
  }

  /** Connexion : popup d'abord, redirection en repli (ou directement sur iPhone installé). */
  function connecter(mode) {
    if (etat.maquette) return Promise.resolve();
    if (!etat.pca) return Promise.reject(new Error("Connexion pas prête"));
    etat.erreur = ""; etat.erreurDetail = null;
    var sp = scopeSharePoint();
    var demande = { scopes: scopesGraph(), extraScopesToConsent: sp ? [sp] : [], prompt: "select_account" };
    function parRedirection() {
      try { sessionStorage.setItem("eb:retour", location.hash || "#/"); } catch (e) {}
      return etat.pca.loginRedirect(demande);
    }
    // Connexion TOUJOURS par redirection pleine page : la fenêtre (popup) se perdait sur certains
    // navigateurs (l'appli se rouvrait dans la fenêtre de connexion → « Connexion annulée »).
    if (mode !== "popup") return parRedirection();
    return etat.pca.loginPopup(demande).then(function (r) {
      etat.compte = r.account; etat.vientDeSeConnecter = true;
      if (etat.pca.setActiveAccount) etat.pca.setActiveAccount(r.account);
      if (window.EBConnecte) window.EBConnecte.apresConnexion(); else if (window.EB) window.EB.rendre();
    }).catch(function (e) {
      var code = String((e && (e.errorCode || e.message)) || "");
      if (/popup_window_error|empty_window_error|monitor_window_timeout|block_nested_popups/i.test(code)) return parRedirection();
      retenirErreur(e);
      if (window.EB) window.EB.rendre();
    });
  }

  function oublier() {
    etat.compte = null; etat.vientDeSeConnecter = false;
    if (etat.pca && etat.pca.clearCache) { try { etat.pca.clearCache(); } catch (e) {} }
  }

  /** Mode maquette : erreur de jeton simulée par un test (localhost uniquement). */
  function erreurMaquette(ressource) {
    var m = self.EB_MAQUETTE && self.EB_MAQUETTE.erreurJeton && self.EB_MAQUETTE.erreurJeton[ressource];
    if (!m) return null;
    var e = new Error(m); e.errorCode = "invalid_grant"; e.errorMessage = m; e.ressource = "msal";
    return e;
  }
  /**
   * Jeton pour Graph (« graph ») ou pour SharePoint (« sp »).
   * opts.silencieux : ne jamais rediriger (écran de diagnostic) ; l'erreur est renvoyée.
   */
  function jeton(ressource, opts) {
    if (etat.maquette) { var em = erreurMaquette(ressource); return em ? Promise.reject(em) : Promise.resolve("maquette"); }
    if (!etat.pca || !etat.compte) return Promise.reject(erreur(401, "Vous n'êtes pas connecté."));
    var scopes = ressource === "sp" ? [scopeSharePoint()] : scopesGraph();
    return etat.pca.acquireTokenSilent({ scopes: scopes, account: etat.compte }).then(function (r) { return r.accessToken; })
      .catch(function (e) {
        e.ressource = "msal";
        if (opts && opts.silencieux) throw e;
        if (window.msal && e instanceof window.msal.InteractionRequiredAuthError) {
          try { sessionStorage.setItem("eb:retour", location.hash || "#/"); } catch (x) {}
          return etat.pca.acquireTokenRedirect({ scopes: scopes, account: etat.compte });
        }
        throw e;
      });
  }

  /** Permissions réellement accordées dans le jeton (claim « scp »), sans jamais exposer le jeton. */
  function scopesAccordes(ressource) {
    if (etat.maquette) {
      var m = self.EB_MAQUETTE && self.EB_MAQUETTE.scopes && self.EB_MAQUETTE.scopes[ressource];
      if (m) return Promise.resolve(m.slice());
      return Promise.resolve(ressource === "sp" ? [String(scopeSharePoint()).split("/").pop()] : scopesGraph().slice());
    }
    return jeton(ressource, { silencieux: true }).then(function (t) {
      try {
        var p = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        while (p.length % 4) p += "=";
        var json = JSON.parse(decodeURIComponent(Array.prototype.map.call(atob(p), function (c) { return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2); }).join("")));
        return String(json.scp || "").split(" ").filter(Boolean);
      } catch (e) { return null; } // jeton illisible (normal pour certains services) : on ne conclut pas
    });
  }

  function erreur(statut, message) { var e = new Error(message); e.statut = statut; return e; }
  /** Erreur HTTP enrichie : message simple + action (erreurs.js), détail nettoyé. */
  function erreurHttp(statut, ressource, codeG, detail, contexte) {
    var x = E.expliquer({ statut: statut, ressource: ressource, codeGraph: codeG, detail: detail }, contexte);
    var simple = statut === 404 || statut === 409 ? messageHttp(statut) : x.titre;
    var e = erreur(statut, simple);
    e.ressource = ressource; e.codeGraph = codeG || ""; e.action = statut === 404 || statut === 409 ? "" : x.action;
    e.detail = E.nettoyer((codeG ? codeG + " : " : "") + (detail || ""));
    e.explication = x;
    return e;
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

  function attendre(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  /** Appel HTTP authentifié. opts : { silencieux, contexte } (contexte : { site, dossier } pour les 404). */
  function appel(ressource, methode, url, corps, entetes, opts) {
    opts = opts || {};
    var tentative = 0;
    function envoyer(t) {
      var h = Object.assign({ Authorization: "Bearer " + t }, entetes || {});
      if (ressource === "sp") h.Accept = "application/json;odata=nometadata";
      if (corps !== undefined) h["Content-Type"] = ressource === "sp" ? "application/json;odata=nometadata" : "application/json";
      return fetch(url, { method: methode, headers: h, body: corps === undefined ? undefined : JSON.stringify(corps) }).catch(function (x) {
        // Aucune réponse : réseau coupé, ou blocage CORS (le navigateur ne dit pas lequel).
        var hors = typeof navigator !== "undefined" && navigator.onLine === false;
        var ex = E.expliquer({ cors: true, ressource: ressource, message: String(x && x.message || x) }, { horsLigne: hors });
        var e = erreur(0, ex.titre); e.cors = true; e.ressource = ressource; e.action = ex.action; e.explication = ex;
        e.detail = E.nettoyer((hors ? "Hors ligne. " : "Requête bloquée avant réponse (CORS ou réseau) : ") + methode + " " + url.split("?")[0] + " — " + (x && x.message || x));
        throw e;
      }).then(function (r) {
        if ((r.status === 429 || r.status === 503) && tentative < REESSAIS) {
          var ms = E.delaiReessai(r.headers.get("Retry-After"), tentative++);
          return attendre(ms).then(function () { return envoyer(t); });
        }
        return r;
      });
    }
    return jeton(ressource, opts).then(envoyer).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          var detail = "", codeG = "";
          try {
            var j = JSON.parse(t);
            if (j.error) { codeG = j.error.code || ""; detail = j.error.message && (j.error.message.value || j.error.message); }
            if (j["odata.error"]) { codeG = j["odata.error"].code || codeG; detail = j["odata.error"].message && j["odata.error"].message.value; }
            if (!detail && j["error_description"]) detail = j["error_description"];
          } catch (e) { detail = t ? String(t).slice(0, 200) : ""; }
          var diag = r.headers.get("x-ms-diagnostics") || "";
          throw erreurHttp(r.status, ressource, typeof codeG === "string" ? codeG : "", (typeof detail === "string" ? detail : "") + (diag ? " [" + diag + "]" : ""), opts.contexte);
        });
      }
      if (r.status === 204) return null;
      var type = r.headers.get("Content-Type") || "";
      return /json/.test(type) ? r.json() : r.text().then(function (t) { try { return JSON.parse(t); } catch (e) { return t || null; } });
    });
  }

  /** Graph : GET/POST/PATCH/DELETE. Chemin relatif à /v1.0. */
  function graph(methode, chemin, corps, opts) { return appel("graph", methode, GRAPH + chemin, corps, null, opts); }
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
  function sp(methode, chemin, corps, entetes, opts) {
    var site = (self.EB_CONFIG.sharepoint.site || "").replace(/\/+$/, "");
    return appel("sp", methode, /^https:/.test(chemin) ? chemin : site + chemin, corps, entetes, opts);
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
    erreurDetail: function () { return etat.erreurDetail; },
    /** Vrai une seule fois juste après une connexion interactive (pour proposer le diagnostic). */
    vientDeSeConnecter: function () { var v = etat.vientDeSeConnecter; etat.vientDeSeConnecter = false; return v; },
    estIosInstalle: estIosInstalle,
    jeton: function (ressource) { return jeton(ressource, { silencieux: true }).then(function () { return true; }); },
    scopesAccordes: scopesAccordes,
    config: config,
    graph: graph, graphTout: graphTout, graphPhoto: graphPhoto, sp: sp,
    origineSharePoint: origineSharePoint,
    // Compatibilité avec l'annuaire de démo (app.js) : voir connecte.js.
    chargerAnnuaire: function () { return window.EBConnecte ? window.EBConnecte.annuairePourDemo() : Promise.reject(new Error("indisponible")); },
    chargerPhotos: function (liste, rappel) { return window.EBConnecte ? window.EBConnecte.chargerPhotos(liste, rappel) : Promise.resolve(); },
  };
})();
