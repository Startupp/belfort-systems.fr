/*
 * Espace Breteuil — v5.4 : « Aide et demandes » (tickets envoyés à Damien) ; v5.6 : pièces jointes.
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
  function validerReponse(t, avecFichiers) {
    var m = nettoyer(t);
    if (!m && avecFichiers) return { ok: true, texte: "" }; // v5.6 : un fichier seul suffit
    if (!m) return { ok: false, erreur: "Écrivez votre réponse." };
    if (m.length > MAX) return { ok: false, erreur: "Réponse trop longue : " + m.length + " caractères (" + MAX + " au plus)." };
    return { ok: true, texte: m };
  }
  /* ---------- v5.6 : pièces jointes ---------- */
  var PJ_MAX = 5, PJ_TAILLE = 8 * 1024 * 1024, PJ_COTE = 2000, PJ_QUALITE = 0.85;
  var PJ_EXT = ["jpg", "jpeg", "png", "webp", "heic", "heif", "pdf", "docx", "xlsx", "pptx", "txt"];
  var PJ_ACCEPT = PJ_EXT.map(function (e) { return "." + e; }).join(",") + ",image/*,application/pdf";
  var PJ_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heic", "application/pdf": "pdf", "text/plain": "txt" };
  function extensionDe(nom) { var m = /\.([a-z0-9]{1,5})$/i.exec(String(nom || "")); return m ? m[1].toLowerCase() : ""; }
  /** Fichier accepté ? (extension, ou type pour une capture collée sans nom utile). → extension ou "". */
  function typePj(f) {
    var e = extensionDe(f && f.name);
    if (PJ_EXT.indexOf(e) > -1) return e === "jpeg" ? "jpg" : e === "heif" ? "heic" : e;
    return (f && PJ_MIME[String(f.type || "").toLowerCase()]) || "";
  }
  /** Image que l'on réduit dans le navigateur (2000 px, JPEG 0,85) avant l'envoi ? (HEIC : seulement si le navigateur sait la lire.) */
  function estImage(f) { return ["jpg", "png", "webp", "heic"].indexOf(typePj(f)) > -1; }
  function tailleLisible(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + " o";
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + " Ko";
    return String(Math.round(n / 1024 / 1024 * 10) / 10).replace(".", ",") + " Mo";
  }
  function nomJpeg(nom) {
    var n = String(nom || "").trim() || "capture";
    if (/^image\.(png|jpe?g)$/i.test(n)) n = "capture-ecran.jpg"; // capture collée : nom générique du navigateur
    return n.replace(/\.[a-z0-9]{1,5}$/i, "") + ".jpg";
  }
  /** Taille réduite (côté le plus long ≤ max), proportions gardées. */
  function dimensions(l, h, max) {
    max = max || PJ_COTE;
    var k = Math.min(1, max / Math.max(l || 1, h || 1));
    return { l: Math.max(1, Math.round(l * k)), h: Math.max(1, Math.round(h * k)), reduit: k < 1 };
  }
  /**
   * Ajout de fichiers à une liste existante → { ajouts, erreurs } (erreurs en français simple).
   * `apresReduction` : la taille est contrôlée après la réduction des images (une photo de 12 Mo devient ~1 Mo).
   */
  function controlerAjout(existants, nouveaux, apresReduction) {
    var ajouts = [], erreurs = [], n = (existants || []).length;
    Array.prototype.forEach.call(nouveaux || [], function (f) {
      var nom = f.name || "capture";
      if (!typePj(f)) { erreurs.push("« " + nom + " » : ce type de fichier n'est pas accepté. Envoyez une photo, un PDF, un fichier Word, Excel, PowerPoint ou texte."); return; }
      if (!f.size) { erreurs.push("« " + nom + " » est vide."); return; }
      if (f.size > PJ_TAILLE && (apresReduction || !estImage(f))) { erreurs.push("« " + nom + " » est trop lourd (" + tailleLisible(f.size) + ") : 8 Mo au plus par fichier."); return; }
      if (n + ajouts.length >= PJ_MAX) { erreurs.push("5 fichiers au plus par message : « " + nom + " » n'a pas été ajouté."); return; }
      ajouts.push(f);
    });
    return { ajouts: ajouts, erreurs: erreurs };
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
    if (e && /^(trop_de_fichiers|fichier_trop_lourd|fichier_vide|type_fichier|quota_pj|trop_de_pj)$/.test(code || "") && e.message && !/^HTTP /.test(e.message)) return e.message;
    if (code === "pj_non_installees") return "Les pièces jointes ne sont pas encore installées : envoyez le message sans fichier, ou appelez Damien au " + TEL_AFFICHE + ".";
    if (s === 413) return "Fichiers trop lourds : 8 Mo au plus par fichier.";
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
    /** fichiers : [{ fichier: Blob, nom }] → multipart/form-data (« donnees » = le JSON, puis « fichier » × n). */
    function appel(methode, chemin, corps, fichiers, brut) {
      return Promise.resolve(opts.jeton()).then(function (t) {
        var h = { Authorization: "Bearer " + t }, body;
        if (fichiers && fichiers.length && typeof FormData !== "undefined") {
          body = new FormData();
          body.append("donnees", JSON.stringify(corps));
          fichiers.forEach(function (x) { body.append("fichier", x.fichier, x.nom); });
        } else if (corps !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(corps); }
        return f(base + chemin, { method: methode, headers: h, body: body, cache: "no-store" })
          .catch(function () { var e = new Error("hors ligne"); e.code = "hors_ligne"; throw e; });
      }).then(function (r) {
        if (brut && r.ok) return r.blob();
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
      creer: function (d, fichiers) { return appel("POST", "", { type: d.type, message: d.message, ecran: d.ecran, version: d.version, appareil: d.appareil }, fichiers); },
      repondre: function (id, texte, fichiers) { return appel("POST", "/" + encodeURIComponent(id) + "/messages", { texte: texte }, fichiers); },
      /** Pièce jointe (Blob), lue avec le jeton : jamais d'adresse publique. */
      piece: function (id, pjId) { return appel("GET", "/" + encodeURIComponent(id) + "/pj/" + encodeURIComponent(pjId), undefined, null, true); },
      statut: function (id, statut) { return appel("PATCH", "/" + encodeURIComponent(id), { statut: statut }); },
    };
  }

  var api = {
    MAX: MAX, TEL: TEL, TEL_AFFICHE: TEL_AFFICHE, TYPES: TYPES, STATUTS: STATUTS,
    typeDe: typeDe, libelleType: libelleType, libelleStatut: libelleStatut,
    valider: valider, validerReponse: validerReponse, compteur: compteur, appareil: appareil, nomEcran: nomEcran,
    nonLues: nonLues, confirmation: confirmation, messageErreur: messageErreur, client: client,
    PJ_MAX: PJ_MAX, PJ_TAILLE: PJ_TAILLE, PJ_COTE: PJ_COTE, PJ_QUALITE: PJ_QUALITE, PJ_ACCEPT: PJ_ACCEPT,
    typePj: typePj, estImage: estImage, tailleLisible: tailleLisible, nomJpeg: nomJpeg, dimensions: dimensions, controlerAjout: controlerAjout,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.EBAide = api;
})(typeof self !== "undefined" ? self : this);
