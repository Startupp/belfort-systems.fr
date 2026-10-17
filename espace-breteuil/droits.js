/*
 * Espace Breteuil — traduction en langage simple des droits SharePoint, des types de
 * personnes et des licences Microsoft. Logique pure (aucun appel réseau), testée.
 *
 * Utilisable dans le navigateur (window.EBDroits) et dans Node (tests).
 */
(function (racine) {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* Niveaux d'accès : 3 niveaux simples                                 */
  /* ------------------------------------------------------------------ */
  // RoleTypeKind SharePoint : 1 Guest (= « Accès limité », technique), 2 Reader, 3 Contributor,
  // 4 WebDesigner, 5 Administrator (Contrôle total), 6 Editor, 7 Reviewer, 8 RestrictedReader…
  var NIVEAUX = {
    voir: { id: "voir", nom: "Peut voir", emoji: "👁️", texte: "Peut ouvrir et lire, sans rien changer." },
    modifier: { id: "modifier", nom: "Peut modifier", emoji: "✏️", texte: "Peut ajouter, modifier, ranger et supprimer." },
    aucun: { id: "aucun", nom: "Pas d'accès", emoji: "🚫", texte: "Ne voit pas ce dossier." },
  };

  /** Niveau simple d'après les rôles d'une attribution ; null si seulement « Accès limité ». */
  function niveauDeRoles(liaisons) {
    var niveau = null, total = false;
    (liaisons || []).forEach(function (r) {
      var k = r.RoleTypeKind;
      var nom = String(r.Name || "");
      if (k === 5 || /contr[ôo]le total|full control/i.test(nom)) { niveau = "modifier"; total = true; }
      else if (k === 3 || k === 4 || k === 6 || /modif|edit|contribu|collabor|design/i.test(nom)) niveau = "modifier";
      else if ((k === 2 || k === 7 || k === 8 || /lecture|read|view|afficher/i.test(nom)) && niveau !== "modifier") niveau = "voir";
    });
    return niveau ? { niveau: niveau, controleTotal: total } : null;
  }

  /* ------------------------------------------------------------------ */
  /* Qui est qui : équipe ou externe (sans adresse @breteuil.fr)         */
  /* ------------------------------------------------------------------ */
  var TYPES = {
    interne: { nom: "Équipe", classe: "interne" },
    externe: { nom: "Externe", classe: "externe", aide: "Toute personne sans adresse @breteuil.fr est considérée comme externe." },
    lien: { nom: "Lien de partage", classe: "lien" },
    groupe: { nom: "Groupe", classe: "groupe" },
  };

  function minuscule(s) { return String(s || "").trim().toLowerCase(); }
  /** Adresse mail tirée d'un identifiant SharePoint (i:0#.f|membership|x@y) ou invité (#ext#). */
  function adresseDe(membre) {
    var e = minuscule(membre.Email || membre.mail || "");
    if (e) return e;
    var l = minuscule(membre.LoginName || membre.userPrincipalName || "");
    var m = /\|([^|]+@[^|]+)$/.exec(l);
    l = m ? m[1] : l;
    var ext = /^(.+)_([^_]+)#ext#@/.exec(l);
    if (ext) return ext[1] + "@" + ext[2];
    return /@/.test(l) ? l : "";
  }
  function domaine(adresse) { var i = adresse.lastIndexOf("@"); return i > -1 ? adresse.slice(i + 1) : ""; }

  /**
   * Type d'une personne / d'un groupe pour l'affichage.
   * membre : objet SharePoint (Member) ou Graph (user). opts : { domainesInternes }.
   * Règle unique : toute personne sans adresse d'un domaine de l'entreprise est « Externe ».
   */
  function typeDe(membre, opts) {
    opts = opts || {};
    var titre = String(membre.Title || membre.displayName || "");
    var login = minuscule(membre.LoginName || membre.userPrincipalName || "");
    if (/^sharinglinks\./i.test(titre) || /^sharinglinks\./i.test(login)) return "lien";
    var pt = membre.PrincipalType;
    if (pt === 4 || pt === 8) return "groupe";
    var adresse = adresseDe(membre);
    if (/#ext#|urn%3aspo%3aguest|urn:spo:guest/.test(login) || membre.userType === "Guest") return "externe";
    var internes = (opts.domainesInternes || []).map(minuscule);
    if (adresse && internes.length && internes.indexOf(domaine(adresse)) === -1) return "externe";
    return "interne";
  }

  /** Garde-fou : ne jamais retirer la personne connectée ni les propriétaires du site. */
  function estProtege(membre, ctx) {
    ctx = ctx || {};
    if (ctx.groupeProprietairesId != null && membre.Id === ctx.groupeProprietairesId) return "Groupe des propriétaires du site";
    var adresse = adresseDe(membre);
    var moi = minuscule(ctx.moi || "");
    if (moi && (adresse === moi || membre.Id === ctx.moiId)) return "C'est vous";
    if ((ctx.proprietaires || []).map(minuscule).indexOf(adresse) > -1 && adresse) return "Propriétaire du site";
    return "";
  }

  /** Nom simple d'un groupe SharePoint (« Propriétaires de … » → « Propriétaires du site »). */
  function nomGroupe(titre) {
    var t = String(titre || "");
    if (/propri[ée]taires|owners/i.test(t)) return "Propriétaires du site";
    if (/visiteurs|visitors/i.test(t)) return "Visiteurs du site";
    if (/membres|members/i.test(t)) return "Membres du site";
    if (/^sharinglinks\./i.test(t)) return /anonymous/i.test(t) ? "Lien ouvert à tous" : /organization/i.test(t) ? "Lien pour l'entreprise" : "Lien pour des personnes précises";
    if (/^tout le monde|everyone/i.test(t)) return "Tout le personnel du Château";
    return t;
  }

  /* ------------------------------------------------------------------ */
  /* Licences : « Ce que je peux utiliser »                              */
  /* ------------------------------------------------------------------ */
  var PROFILS = {
    standard: {
      nom: "Business Standard", court: "Licence complète", emoji: "🟢",
      phrase: "Tous les outils Microsoft, à installer sur ses appareils.",
      outils: [
        ["💻", "Word, Excel, PowerPoint installés sur 5 ordinateurs (PC ou Mac), 5 tablettes et 5 téléphones"],
        ["📧", "Outlook : sa boîte mail et son agenda"],
        ["💬", "Teams : discussions et visios"],
        ["☁️", "OneDrive : 1 To pour ses fichiers"],
        ["🗂️", "Le dossier commun du Château"],
      ],
    },
    basic: {
      nom: "Business Basic", court: "Licence web et mobile", emoji: "🔵",
      phrase: "Les outils Microsoft dans le navigateur et sur téléphone, sans installation sur ordinateur.",
      outils: [
        ["🌐", "Word, Excel, PowerPoint dans le navigateur et sur téléphone (pas d'installation sur ordinateur)"],
        ["📧", "Outlook : sa boîte mail et son agenda"],
        ["💬", "Teams : discussions et visios"],
        ["☁️", "OneDrive : 1 To pour ses fichiers"],
        ["🗂️", "Le dossier commun du Château"],
      ],
    },
    exchange: {
      nom: "Exchange Online", court: "Licence mail", emoji: "🟡",
      phrase: "Sa boîte mail et son agenda, sans les autres outils.",
      outils: [["📧", "Outlook : sa boîte mail et son agenda"], ["🚫", "Pas de Teams, pas de OneDrive, pas d'Office"]],
    },
    boite: {
      nom: "Boîte partagée", court: "Boîte partagée", emoji: "📬",
      phrase: "Une adresse lue à plusieurs. Pas de licence, on ne s'y connecte pas directement.",
      outils: [
        ["📬", "S'ouvre depuis le compte d'une personne autorisée, dans son Outlook"],
        ["🚫", "Pas de connexion propre, pas de OneDrive, pas de Teams"],
      ],
    },
    aucune: {
      nom: "Sans licence", court: "Sans licence", emoji: "⚪",
      phrase: "Ce compte n'a aucun outil Microsoft pour l'instant.",
      outils: [["🚫", "Rien : ni mail, ni Office, ni OneDrive"]],
    },
    externe: {
      nom: "Externe", court: "Externe", emoji: "🟠",
      phrase: "Personne extérieure invitée : elle voit seulement ce qu'on lui a partagé.",
      outils: [["🔗", "Seulement les dossiers ou fichiers partagés avec elle"]],
    },
  };
  /* Références Microsoft (skuPartNumber) → profil. */
  var SKUS = {
    O365_BUSINESS_PREMIUM: "standard", // Microsoft 365 Business Standard
    O365_BUSINESS_ESSENTIALS: "basic", // Microsoft 365 Business Basic
    SPB: "standard",                   // Business Premium (inclut Standard)
    EXCHANGESTANDARD: "exchange", EXCHANGEESSENTIALS: "exchange", EXCHANGEDESKLESS: "exchange",
  };
  var ORDRE = ["standard", "basic", "exchange"];

  /**
   * Profil d'un compte. utilisateur : { userType, accountEnabled, assignedLicenses, mail }.
   * skuNoms : { skuId: skuPartNumber }. boitesPartagees : adresses connues.
   */
  function profilDe(utilisateur, skuNoms, boitesPartagees) {
    if (utilisateur.userType === "Guest" || /#ext#/i.test(utilisateur.userPrincipalName || "")) return "externe";
    var adresse = minuscule(utilisateur.mail || utilisateur.userPrincipalName);
    if ((boitesPartagees || []).map(minuscule).indexOf(adresse) > -1) return "boite";
    var profils = (utilisateur.assignedLicenses || []).map(function (l) { return SKUS[(skuNoms || {})[l.skuId]]; }).filter(Boolean);
    for (var i = 0; i < ORDRE.length; i++) if (profils.indexOf(ORDRE[i]) > -1) return ORDRE[i];
    // Sans licence et sans connexion possible : très probablement une boîte partagée.
    if (!(utilisateur.assignedLicenses || []).length && utilisateur.accountEnabled === false && utilisateur.mail) return "boite";
    return "aucune";
  }

  /** Décompte des licences : [{ profil, nom, achetees, attribuees, libres }]. */
  function compteLicences(skus) {
    var out = {};
    (skus || []).forEach(function (s) {
      var p = SKUS[s.skuPartNumber];
      if (!p) return;
      var o = out[p] || (out[p] = { profil: p, nom: PROFILS[p].nom, achetees: 0, attribuees: 0 });
      o.achetees += (s.prepaidUnits && s.prepaidUnits.enabled) || 0;
      o.attribuees += s.consumedUnits || 0;
    });
    return ORDRE.filter(function (p) { return out[p]; }).map(function (p) { out[p].libres = Math.max(0, out[p].achetees - out[p].attribuees); return out[p]; });
  }

  /** Nom de connexion SharePoint d'un compte de l'entreprise (pour ensureuser). */
  function logonName(upn) { return "i:0#.f|membership|" + minuscule(upn); }

  /** Nom de dossier acceptable par SharePoint (caractères interdits, longueur). */
  function nomDossierValide(nom) {
    var n = String(nom || "").trim();
    if (!n) return "Écrivez un nom.";
    if (n.length > 120) return "Nom trop long (120 caractères au plus).";
    if (/["*:<>?/\\|]/.test(n)) return "Ces signes ne sont pas acceptés : \" * : < > ? / \\ |";
    if (/^[.~]|\.$/.test(n) || /^(con|prn|aux|nul|com\d|lpt\d|_vti_)$/i.test(n)) return "Ce nom n'est pas accepté par Microsoft.";
    return "";
  }

  var api = {
    NIVEAUX: NIVEAUX, TYPES: TYPES, PROFILS: PROFILS, SKUS: SKUS,
    niveauDeRoles: niveauDeRoles, typeDe: typeDe, adresseDe: adresseDe, estProtege: estProtege, nomGroupe: nomGroupe,
    profilDe: profilDe, compteLicences: compteLicences, logonName: logonName, nomDossierValide: nomDossierValide,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.EBDroits = api;
})(typeof self !== "undefined" ? self : this);
