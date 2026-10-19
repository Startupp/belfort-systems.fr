/*
 * Espace Breteuil — traduction des erreurs Microsoft (MSAL, Graph, SharePoint) en
 * français simple, avec l'action à faire. Logique pure (aucun appel réseau), testée.
 *
 * expliquer(erreur) → { titre, action, qui, code, detail, reessayer }
 *   titre     : la phrase simple affichée en gros ;
 *   action    : ce qu'il faut faire, concrètement ;
 *   qui       : « vous », « Damien » ou « François » (qui peut régler le problème) ;
 *   code      : code court (AADSTS…, HTTP 403…) pour le rapport ;
 *   detail    : détail technique, nettoyé (ni jeton ni adresse mail complète) ;
 *   reessayer : vrai si réessayer plus tard a un sens.
 *
 * Utilisable dans le navigateur (window.EBErreurs) et dans Node (tests).
 */
(function (racine) {
  "use strict";

  /** Retire tout ce qui ressemble à un jeton et masque les adresses mail. */
  function nettoyer(texte) {
    return String(texte == null ? "" : texte)
      .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g, "[jeton masqué]")
      .replace(/(Bearer\s+)[^\s"']+/gi, "$1[masqué]")
      .replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, function (m, a, d) { return a + "•••@" + d; })
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 400);
  }
  /** Adresse masquée pour le rapport : p•••@breteuil.fr */
  function masquerAdresse(a) {
    a = String(a || "");
    var i = a.indexOf("@");
    return i > 0 ? a.charAt(0) + "•••" + a.slice(i) : (a ? a.charAt(0) + "•••" : "");
  }

  /* Codes AADSTS (connexion Microsoft) les plus probables au premier essai. */
  var AADSTS = [
    { re: /AADSTS65001|AADSTS65004|consent_required/i, code: "AADSTS65001", qui: "François",
      titre: "L'appli n'a pas encore été autorisée pour le Château.",
      action: "Dans Entra → Inscriptions d'applications → Espace Breteuil → API autorisées : cliquer « Accorder un consentement d'administrateur pour Château de Breteuil » (avec l'accord de François). Toutes les lignes doivent être vertes." },
    { re: /AADSTS50011/i, code: "AADSTS50011", qui: "Damien",
      titre: "L'adresse de l'appli n'est pas déclarée chez Microsoft.",
      action: "Dans Entra → Espace Breteuil → Authentification → plateforme « Application monopage (SPA) » : ajouter exactement l'adresse affichée dans le navigateur, barre oblique finale comprise (ex. https://espace-breteuil.pages.dev/)." },
    { re: /AADSTS9002326|AADSTS9002327|AADSTS7000218|AADSTS700025/i, code: "AADSTS9002326", qui: "Damien",
      titre: "L'adresse de l'appli est déclarée avec le mauvais type de plateforme.",
      action: "Dans Entra → Espace Breteuil → Authentification : supprimer l'adresse de la plateforme « Web » et l'ajouter dans « Application monopage (SPA) »." },
    { re: /AADSTS50105/i, code: "AADSTS50105", qui: "François",
      titre: "L'application n'est pas ouverte pour vous.",
      action: "Demandez à François : il peut vous cocher dans Gérer › « Qui peut utiliser l'application » (ou dans Entra → Applications d'entreprise → Espace Breteuil → Utilisateurs et groupes)." },
    { re: /AADSTS700016/i, code: "AADSTS700016", qui: "Damien",
      titre: "Microsoft ne trouve pas l'appli dans le Château.",
      action: "Vérifier le « clientId » dans config.js : il doit être l'« ID d'application (client) » copié depuis Entra (pas l'ID d'objet), et l'appli doit être inscrite dans le tenant du Château." },
    { re: /AADSTS90002|AADSTS90013|AADSTS900023/i, code: "AADSTS90002", qui: "Damien",
      titre: "Le tenant indiqué dans la configuration est introuvable.",
      action: "Vérifier « tenantId » dans config.js (breteuil02.onmicrosoft.com ou l'ID du tenant)." },
    { re: /AADSTS50020|AADSTS500200|AADSTS50034/i, code: "AADSTS50020", qui: "vous",
      titre: "Ce compte n'appartient pas au Château.",
      action: "Se reconnecter avec l'adresse du Château (…@breteuil.fr), pas une adresse personnelle." },
    { re: /AADSTS53003|AADSTS53000|AADSTS530003|AADSTS53001/i, code: "AADSTS53003", qui: "Damien",
      titre: "Une règle de sécurité du Château bloque la connexion depuis cet appareil.",
      action: "Damien doit regarder l'accès conditionnel dans Entra (journal des connexions de ce compte)." },
    { re: /AADSTS50076|AADSTS50079|AADSTS50074/i, code: "AADSTS50076", qui: "vous",
      titre: "Microsoft demande la double authentification.",
      action: "Recommencer la connexion et valider le code ou la notification Authenticator." },
    { re: /AADSTS50126|AADSTS50055|AADSTS50053|AADSTS50057/i, code: "AADSTS50126", qui: "vous",
      titre: "Mot de passe incorrect, expiré ou compte bloqué.",
      action: "Vérifier le mot de passe sur office.com. Si le compte est bloqué, demander à Damien." },
    { re: /AADSTS50058|AADSTS50059/i, code: "AADSTS50058", qui: "vous",
      titre: "Microsoft ne sait pas qui est connecté sur ce navigateur.",
      action: "Toucher « Se connecter avec Microsoft »." },
  ];

  /* Erreurs propres à MSAL (dans le navigateur). */
  var MSAL = [
    { re: /user_cancelled|user_canceled/i, code: "user_cancelled", qui: "vous",
      titre: "Connexion annulée.", action: "Toucher de nouveau « Se connecter avec Microsoft » et aller jusqu'au bout." },
    { re: /popup_window_error|empty_window_error|popup.*block/i, code: "popup_window_error", qui: "vous",
      titre: "Le navigateur a bloqué la fenêtre de connexion.",
      action: "Autoriser les fenêtres pour ce site, ou simplement réessayer : l'appli passera par une redirection." },
    { re: /interaction_in_progress/i, code: "interaction_in_progress", qui: "vous",
      titre: "Une connexion est déjà en cours.",
      action: "Fermer les autres onglets ou fenêtres de connexion Microsoft, puis recharger la page." },
    { re: /no_network_connectivity|endpoints_resolution_error|network_error|Failed to fetch|NetworkError|Load failed/i, code: "reseau", qui: "vous", reessayer: true,
      titre: "Impossible de joindre Microsoft.",
      action: "Vérifier la connexion internet (Wi-Fi ou 4G) puis réessayer." },
    { re: /hash_empty_error|no_state_in_hash|state_mismatch|state_not_found|nonce_mismatch/i, code: "retour_redirection", qui: "vous",
      titre: "Le retour de la connexion Microsoft s'est perdu.",
      action: "Recommencer la connexion dans le même onglet (ne pas changer d'appli pendant la connexion)." },
    { re: /block_iframe_reload|monitor_window_timeout|timed_out|token_renewal_error/i, code: "delai", qui: "vous", reessayer: true,
      titre: "La connexion a pris trop de temps.",
      action: "Réessayer. Si cela se répète, se déconnecter puis se reconnecter." },
    { re: /interaction_required|login_required|InteractionRequired/i, code: "interaction_required", qui: "vous",
      titre: "Microsoft demande de se reconnecter.",
      action: "Toucher « Se connecter avec Microsoft »." },
  ];

  /* Codes d'erreur Graph (champ error.code). */
  function codeGraph(e) { return String((e && (e.codeGraph || e.errorCode)) || ""); }

  /**
   * Traduit une erreur quelconque.
   * Champs reconnus : statut (HTTP), detail, codeGraph, ressource ("graph"|"sp"|"msal"), cors (vrai si fetch a échoué),
   * errorCode / errorMessage (MSAL), message.
   */
  function expliquer(e, contexte) {
    e = e || {};
    contexte = contexte || {};
    var morceaux = [];
    [e.errorCode, e.errorMessage, e.subError, e.message, e.detail, e.codeGraph].forEach(function (m) {
      m = m == null ? "" : String(m);
      if (m && !morceaux.some(function (x) { return x.indexOf(m) > -1; })) morceaux.push(m);
    });
    var brut = morceaux.join(" | ");
    var detail = nettoyer(brut);
    var res = null;
    var i;

    // 1. Connexion Microsoft (codes AADSTS)
    for (i = 0; i < AADSTS.length && !res; i++) if (AADSTS[i].re.test(brut)) res = AADSTS[i];

    // 2. Réseau / CORS (fetch refusé avant toute réponse)
    if (!res && (e.cors || (!e.statut && /Failed to fetch|NetworkError|Load failed|TypeError/i.test(brut) && e.ressource))) {
      if (contexte.horsLigne) {
        res = { code: "hors_ligne", qui: "vous", reessayer: true, titre: "Pas de connexion internet.", action: "Se connecter au Wi-Fi ou à la 4G, puis réessayer." };
      } else if (e.ressource === "sp") {
        res = { code: "CORS", qui: "Damien",
          titre: "SharePoint refuse de répondre à l'appli (blocage du navigateur, « CORS »).",
          action: "Vérifier que l'appli est ouverte depuis son adresse officielle (https://espace-breteuil.pages.dev/), que la CSP autorise *.sharepoint.com et que l'autorisation SharePoint (AllSites…) est bien accordée. Envoyer ce rapport à Damien." };
      } else {
        res = { code: "reseau", qui: "vous", reessayer: true, titre: "Impossible de joindre Microsoft.", action: "Vérifier la connexion internet puis réessayer. Si cela continue, envoyer ce rapport à Damien." };
      }
    }

    // 3. Erreurs MSAL
    if (!res && !e.statut) for (i = 0; i < MSAL.length && !res; i++) if (MSAL[i].re.test(brut)) res = MSAL[i];

    // 4. Erreurs HTTP Graph / SharePoint
    if (!res && e.statut) {
      var s = e.statut, cg = codeGraph(e), sp = e.ressource === "sp";
      if (s === 429 || s === 503 || s === 509) {
        res = { code: "HTTP " + s, qui: "vous", reessayer: true, titre: "Microsoft est très sollicité en ce moment.", action: "Patienter une minute puis réessayer (l'appli a déjà réessayé toute seule)." };
      } else if (s === 401) {
        res = sp
          ? { code: "HTTP 401", qui: "François", titre: "SharePoint n'accepte pas la connexion de l'appli.", action: "Vérifier dans Entra que l'autorisation « SharePoint → AllSites.FullControl » (déléguée) est ajoutée ET accordée par l'administrateur, puis se déconnecter et se reconnecter." }
          : { code: "HTTP 401", qui: "vous", titre: "Votre connexion a expiré.", action: "Se déconnecter de l'appli puis se reconnecter." };
      } else if (s === 403) {
        if (/Authorization_RequestDenied|insufficient privileges|InsufficientPrivileges|scp|scope/i.test(cg + " " + brut) && !sp) {
          res = { code: "HTTP 403 " + (cg || ""), qui: "François", titre: "Une permission n'a pas été accordée à l'appli.", action: "Dans Entra → Espace Breteuil → API autorisées : vérifier que la permission est présente et « Accordée pour Château de Breteuil » (consentement administrateur)." };
        } else {
          res = { code: "HTTP 403", qui: "Damien", titre: sp ? "SharePoint refuse : votre compte n'a pas ce droit sur le site." : "Vous n'avez pas le droit de faire cela.", action: sp ? "Pour gérer les accès, il faut être « Propriétaire » du site du Château. Damien ou François peut vous ajouter (Paramètres du site → Autorisations)." : "C'est une limite de votre compte Microsoft. Demander à Damien." };
        }
      } else if (s === 404) {
        res = contexte.site
          ? { code: "HTTP 404", qui: "Damien", titre: "Le site SharePoint du Château est introuvable.", action: "Vérifier l'adresse « site » dans config.js (https://breteuil02.sharepoint.com/sites/ChateaudeBreteuil) et que votre compte peut l'ouvrir dans le navigateur." }
          : contexte.dossier
            ? { code: "HTTP 404", qui: "Damien", titre: "Le dossier est introuvable à l'endroit prévu.", action: "Vérifier que le dossier existe à la racine de la bibliothèque « Documents », sinon corriger « dossierCommun » dans config.js." }
            : { code: "HTTP 404", qui: "vous", titre: "Élément introuvable (supprimé ou déplacé ?).", action: "Revenir en arrière et actualiser." };
      } else if (s === 409) {
        res = { code: "HTTP 409", qui: "vous", titre: "Un élément porte déjà ce nom.", action: "Choisir un autre nom." };
      } else if (s === 400) {
        res = { code: "HTTP 400 " + (cg || ""), qui: "Damien", titre: "Microsoft n'a pas compris la demande.", action: "Envoyer ce rapport à Damien." };
      } else if (s >= 500) {
        res = { code: "HTTP " + s, qui: "vous", reessayer: true, titre: "Microsoft a un souci de son côté.", action: "Réessayer dans quelques minutes." };
      } else {
        res = { code: "HTTP " + s, qui: "Damien", titre: "Microsoft a répondu par une erreur (" + s + ").", action: "Envoyer ce rapport à Damien." };
      }
    }

    // 5. Par défaut
    if (!res) {
      var m = /AADSTS\d+/.exec(brut);
      res = { code: m ? m[0] : "inconnu", qui: "Damien", titre: "Une erreur inattendue est survenue.", action: "Envoyer ce rapport à Damien." };
    }
    return { titre: res.titre, action: res.action, qui: res.qui, code: String(res.code || "").trim(), detail: detail, reessayer: !!res.reessayer };
  }

  /** Message court (une ligne) pour les écrans existants. */
  function messageCourt(e, contexte) {
    var x = expliquer(e, contexte);
    return x.titre + " " + x.action;
  }

  /** Délai d'attente avant de réessayer (en-tête Retry-After, en secondes ou date), borné. */
  function delaiReessai(retryAfter, tentative, maxMs) {
    maxMs = maxMs || 10000;
    var ms = NaN;
    if (retryAfter != null && retryAfter !== "") {
      var n = Number(retryAfter);
      if (!isNaN(n)) ms = n * 1000;
      else { var t = Date.parse(retryAfter); if (!isNaN(t)) ms = t - Date.now(); }
    }
    if (isNaN(ms) || ms < 0) ms = 1000 * Math.pow(2, tentative || 0);
    return Math.min(ms, maxMs);
  }

  var api = { expliquer: expliquer, messageCourt: messageCourt, nettoyer: nettoyer, masquerAdresse: masquerAdresse, delaiReessai: delaiReessai };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.EBErreurs = api;
})(typeof self !== "undefined" ? self : this);
