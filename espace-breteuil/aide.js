/*
 * Espace Breteuil — v5.4 : « Aide et demandes » (tickets envoyés à Damien).
 * Partie SANS écran (testée sous Node, tests/aide.test.mjs) : types, statuts, validation du
 * formulaire, contexte joint (écran, version, appareil), pastille « réponse non lue », messages
 * d'erreur en français simple, et petit client du Worker (routes /breteuil/aide…).
 * Les écrans sont dans aide-ecrans.js. Tout est affiché en TEXTE (jamais innerHTML).
 * Aucun secret ici : l'identité est prouvée par le jeton Microsoft (ID token) envoyé au Worker.
 */
(function (racine) {
  "use strict";

  var MAX = 4000;
  var TEL = "0609897443", TEL_AFFICHE = "06 09 89 74 43";
  var TYPES = [
    { cle: "question", libelle: "Question", emoji: "❓", aide: "Comment faire… ?" },
    { cle: "avis", libelle: "Avis", emoji: "💬", aide: "Ce que vous en pensez" },
    { cle: "amelioration", libelle: "Amélioration", emoji: "✨", aide: "Une idée pour faire mieux" },
    { cle: "probleme", libelle: "Problème", emoji: "⚠️", aide: "Quelque chose ne marche pas" },
  ];
  var STATUTS = { nouvelle: "Nouvelle", repondue: "Répondue", resolue: "Résolue" };

  function typeDe(cle) { for (var i = 0; i < TYPES.length; i++) if (TYPES[i].cle === cle) return TYPES[i]; return null; }
  function libelleType(cle) { var t = typeDe(cle); return t ? t.libelle : "Demande"; }
  function libelleStatut(s) { return STATUTS[s] || "Nouvelle"; }
  function nettoyer(t) { return String(t == null ? "" : t).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim(); }

  /** Formulaire « nouvelle demande » → { ok, erreurs: { type?, message? }, donnees }. */
  function valider(f) {
    f = f || {};
    var erreurs = {}, message = nettoyer(f.message);
    if (!typeDe(f.type)) erreurs.type = "Choisissez le type de demande.";
    if (!message) erreurs.message = "Écrivez votre message.";
    else if (message.length > MAX) erreurs.message = "Message trop long : " + message.length + " caractères (" + MAX + " au plus).";
    var ok = !erreurs.type && !erreurs.message;
    return { ok: ok, erreurs: erreurs, donnees: ok ? { type: f.type, message: message } : null };
  }
  /** Réponse dans un fil : texte non vide, 4000 caractères au plus. */
  function validerReponse(t) {
    var m = nettoyer(t);
    if (!m) return { ok: false, erreur: "Écrivez votre réponse." };
    if (m.length > MAX) return { ok: false, erreur: "Réponse trop longue : " + m.length + " caractères (" + MAX + " au plus)." };
    return { ok: true, texte: m };
  }
  function compteur(t) { var n = String(t || "").length; return { texte: n + " / " + MAX, trop: n > MAX, presque: n > MAX * 0.9 }; }

  /** Type d'appareil lisible, d'après le navigateur (aucune donnée personnelle). */
  function appareil(ua, opts) {
    ua = String(ua || ""); opts = opts || {};
    var sys = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || (/Macintosh/.test(ua) && opts.tactile) ? "iPad" : /Android/.test(ua) ? (/Mobile/.test(ua) ? "Téléphone Android" : "Tablette Android")
      : /Windows/.test(ua) ? "Ordinateur Windows" : /Macintosh|Mac OS X/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "Chromebook" : /Linux/.test(ua) ? "Ordinateur Linux" : "Appareil inconnu";
    var nav = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /OPR\//.test(ua) ? "Opera"
      : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
    var x = sys + (nav ? " · " + nav : "") + (opts.installee ? " · appli installée" : "");
    if (opts.largeur) x += " · " + Math.round(opts.largeur) + " px";
    return x.slice(0, 120);
  }
  /** Écran actuel : titre visible + adresse (#/…), ex. « Planning (#/planning) ». */
  function nomEcran(hash, titre) {
    var chemin = String(hash || "").replace(/^#?\/?/, "#/").replace(/[^\w#/\-.%]/g, "").slice(0, 60);
    var t = nettoyer(titre).replace(/\s+/g, " ").slice(0, 50);
    if (chemin === "#/") chemin = "accueil";
    return (t ? t + " (" + chemin + ")" : chemin).slice(0, 120);
  }

  /** Nombre pour la pastille du bouton « ? » : réponses non lues (client) ou demandes nouvelles (prestataire). */
  function nonLues(liste, prestataire) {
    return (liste || []).filter(function (d) { return prestataire ? d.statut === "nouvelle" : !!d.nonLu; }).length;
  }
  function confirmation(id) { return "Demande n° " + id + " envoyée à Damien"; }

  /** Message en français simple pour une erreur du client du Worker. */
  function messageErreur(e) {
    var code = e && e.code, s = e && e.statut;
    if (code === "aide_non_configuree") return "L'aide n'est pas encore installée — appelez Damien au " + TEL_AFFICHE + ".";
    if (code === "trop_de_demandes") return "Vous avez envoyé beaucoup de demandes en une heure. Réessayez plus tard, ou appelez Damien au " + TEL_AFFICHE + ".";
    if (code === "trop_de_messages") return "Beaucoup de messages en une heure : réessayez un peu plus tard.";
    if (code === "message_trop_long") return "Message trop long (" + MAX + " caractères au plus).";
    if (code === "hors_ligne") return "Pas de connexion Internet : votre message n'est pas parti. Réessayez dès que le réseau revient.";
    if (s === 401 || code === "non_connecte") return "Votre connexion a expiré : reconnectez-vous (Moi → Se déconnecter, puis Se connecter), ou appelez Damien au " + TEL_AFFICHE + ".";
    if (s === 404) return "Cette demande est introuvable (ou ne vous appartient pas).";
    return "Le service d'aide ne répond pas pour le moment. Réessayez, ou appelez Damien au " + TEL_AFFICHE + ".";
  }

  /**
   * Client du Worker. opts : { base (URL du Worker), jeton: () => Promise<idToken>, fetch }.
   * Chaque méthode renvoie le JSON ; en cas d'erreur : Error avec .statut et .code.
   */
  function client(opts) {
    var base = String(opts.base || "").replace(/\/+$/, "") + "/breteuil/aide";
    var f = opts.fetch || (typeof fetch !== "undefined" ? fetch.bind(racine) : null);
    function appel(methode, chemin, corps) {
      return Promise.resolve(opts.jeton()).then(function (t) {
        var h = { Authorization: "Bearer " + t };
        if (corps !== undefined) h["Content-Type"] = "application/json";
        return f(base + chemin, { method: methode, headers: h, body: corps === undefined ? undefined : JSON.stringify(corps), cache: "no-store" })
          .catch(function () { var e = new Error("hors ligne"); e.code = "hors_ligne"; throw e; });
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.ok) return j;
          var e = new Error((j && j.erreur) || ("HTTP " + r.status)); e.statut = r.status; e.code = j && j.code; throw e;
        });
      });
    }
    function requete(filtres) {
      var q = [];
      Object.keys(filtres || {}).forEach(function (k) { if (filtres[k]) q.push(encodeURIComponent(k) + "=" + encodeURIComponent(filtres[k])); });
      return q.length ? "?" + q.join("&") : "";
    }
    return {
      moi: function () { return appel("GET", "/moi"); },
      lister: function (filtres) { return appel("GET", requete(filtres)); },
      lire: function (id) { return appel("GET", "/" + encodeURIComponent(id)); },
      creer: function (d) { return appel("POST", "", { type: d.type, message: d.message, ecran: d.ecran, version: d.version, appareil: d.appareil }); },
      repondre: function (id, texte) { return appel("POST", "/" + encodeURIComponent(id) + "/messages", { texte: texte }); },
      statut: function (id, statut) { return appel("PATCH", "/" + encodeURIComponent(id), { statut: statut }); },
    };
  }

  var api = {
    MAX: MAX, TEL: TEL, TEL_AFFICHE: TEL_AFFICHE, TYPES: TYPES, STATUTS: STATUTS,
    typeDe: typeDe, libelleType: libelleType, libelleStatut: libelleStatut,
    valider: valider, validerReponse: validerReponse, compteur: compteur, appareil: appareil, nomEcran: nomEcran,
    nonLues: nonLues, confirmation: confirmation, messageErreur: messageErreur, client: client,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.EBAide = api;
})(typeof self !== "undefined" ? self : this);
