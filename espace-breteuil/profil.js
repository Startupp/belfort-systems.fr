/*
 * Espace Breteuil — v4 : ce que la personne connectée a le droit de faire, d'après ses
 * DROITS RÉELS chez Microsoft (et non d'après un code ou un réglage).
 *
 * Entrées (lues en arrière-plan par acces.js) :
 *   - roles     : roleTemplateId des rôles d'annuaire (/me/transitiveMemberOf/microsoft.graph.directoryRole) ;
 *   - proprietaire : membre du groupe « Propriétaires » du site SharePoint du Château (ou IsSiteAdmin) ;
 *   - gererDroits  : permission SharePoint ManagePermissions (effectivebasepermissions) ;
 *   - licences  : skuPartNumber de ses licences (/me/licenseDetails) ;
 *   - siteWeb   : membre du groupe nommé dans config.js (siteWeb.groupe), lu dans
 *                 /me/transitiveMemberOf/microsoft.graph.group (voir estMembreDe).
 *
 * Sorties : profil (libellé), sections permises, onglets (4 au plus), routes autorisées,
 * garde-fous de délégation, couleur de la pastille d'état. Logique pure, testée sous Node.
 */
(function (racine) {
  "use strict";

  /* Rôles d'annuaire intégrés (roleTemplateId, identiques dans tous les tenants). */
  var ROLES = {
    admin: { id: "62e90394-69f5-4237-9190-012177145e10", nom: "Administrateur général", court: "Admin. général",
      phrase: "Peut tout régler chez Microsoft : comptes, licences, rôles, sécurité." },
    facturation: { id: "b0f54661-2d74-4c50-afa3-1ec803f12efe", nom: "Administrateur de facturation", court: "Facturation",
      phrase: "Voit les factures, gère les abonnements et le moyen de paiement." },
    utilisateurs: { id: "fe930be7-5e62-47db-91af-98c3a49a38b1", nom: "Administrateur des utilisateurs", court: "Utilisateurs",
      phrase: "Crée ou bloque des comptes, remet des mots de passe à zéro." },
    exchange: { id: "29232cdf-9323-42fd-ade2-1d097af3e4de", nom: "Administrateur Exchange", court: "Exchange",
      phrase: "Gère les boîtes mail, les boîtes partagées et leurs accès." },
  };
  /** Rôles que l'écran « Déléguer » sait donner ou retirer. */
  var ROLES_DELEGABLES = ["admin", "facturation", "utilisateurs", "exchange"];
  /* v5.7 : Administrateur d'applications cloud, Administrateur d'applications (roleTemplateId). */
  var ROLES_APPLIS = ["158c047a-c907-4556-b7ef-446551a6b5f7", "9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3"];
  var PERMISSION_ROLES = "RoleManagement.ReadWrite.Directory";
  // Permission SharePoint « Gérer les autorisations » (PermissionKind.ManagePermissions = 25 → bit 24 de Low).
  var BIT_MANAGE_PERMISSIONS = 24;

  function aLeBit(low, high, bit) {
    var v = bit < 32 ? Number(low) : Number(high);
    var b = bit < 32 ? bit : bit - 32;
    if (isNaN(v)) return false;
    return Math.floor(v / Math.pow(2, b)) % 2 === 1;
  }
  function gererDroitsDe(perm) {
    perm = (perm && (perm.EffectiveBasePermissions || perm)) || {};
    return aLeBit(perm.Low, perm.High, BIT_MANAGE_PERMISSIONS);
  }
  /* v5.5 : « ajouter / modifier des éléments » (AddListItems = 2 → bit 1, EditListItems = 3 → bit 2). */
  var BIT_AJOUTER = 1, BIT_MODIFIER = 2;
  function editerDe(perm) {
    perm = (perm && (perm.EffectiveBasePermissions || perm)) || {};
    return aLeBit(perm.Low, perm.High, BIT_AJOUTER) && aLeBit(perm.Low, perm.High, BIT_MODIFIER);
  }

  /**
   * v5.5 : les 3 niveaux affichés à la personne, TOUJOURS déduits des droits réels (jamais choisis).
   * gestionnaire : peut choisir qui ouvre chaque dossier (ManagePermissions ou propriétaire du site) ;
   * editeur : peut ajouter et modifier des documents du site ; lecteur : le reste (ou droit inconnu).
   */
  var NIVEAUX = {
    lecteur: { id: "lecteur", nom: "Lecteur", emoji: "👀", phrase: "Vous pouvez voir.",
      peut: ["Voir le planning du Château", "Ouvrir les documents de l'équipe", "Ranger vos documents personnels"],
      nePeut: ["Ajouter ou modifier des documents de l'équipe", "Choisir qui peut ouvrir un dossier"] },
    editeur: { id: "editeur", nom: "Éditeur", emoji: "✏️", phrase: "Vous pouvez ajouter et modifier des documents.",
      peut: ["Voir le planning du Château", "Ajouter, ranger et modifier les documents de l'équipe", "Créer des dossiers"],
      nePeut: ["Choisir qui peut ouvrir un dossier"] },
    gestionnaire: { id: "gestionnaire", nom: "Gestionnaire", emoji: "🔐", phrase: "Vous pouvez aussi choisir qui a accès.",
      peut: ["Voir le planning du Château", "Ajouter, ranger et modifier les documents de l'équipe", "Choisir qui peut ouvrir chaque dossier"],
      nePeut: [] },
  };
  function niveauDe(d) {
    if (!d) return "lecteur";
    if (d.gererDroits) return "gestionnaire";
    if (d.editer) return "editeur";
    return "lecteur";
  }
  /** Peut-on montrer les boutons d'ajout (créer, ajouter, renommer, ranger) dans les documents de l'équipe ?
   * Oui pour Éditeur et Gestionnaire ; aussi si le droit n'a pas pu être lu (Microsoft refusera s'il le faut). */
  function peutEditer(r) { return !r || r.niveau !== "lecteur" || r.droits.editer == null; }

  function cleDeRole(templateId) {
    var t = String(templateId || "").toLowerCase();
    for (var k in ROLES) if (ROLES[k].id === t) return k;
    return null;
  }

  /** Nom de groupe comparé sans casse ni espaces autour (« Site Web » = « site web »). */
  function nomNormalise(s) { return String(s || "").trim().replace(/\s+/g, " ").toLowerCase(); }
  /** La personne est-elle membre (directement ou non) du groupe « nom » ? groupes : [{ displayName }]. */
  function estMembreDe(groupes, nom) {
    var n = nomNormalise(nom);
    if (!n) return false;
    return (groupes || []).some(function (g) { return g && nomNormalise(g.displayName) === n; });
  }

  /**
   * Droits réels → profil. e : { roles: [templateId], proprietaire, gererDroits, licences: [sku], siteWeb }.
   * Une information absente (appel en échec) vaut « non » : on n'affiche jamais plus que sûr.
   */
  function deduire(e) {
    e = e || {};
    var cles = (e.roles || []).map(cleDeRole).filter(Boolean);
    var a = function (k) { return cles.indexOf(k) > -1; };
    var d = {
      admin: a("admin"),
      facturation: a("facturation"),
      utilisateurs: a("utilisateurs"),
      exchange: a("exchange"),
      proprietaire: !!e.proprietaire,
      gererDroits: !!e.gererDroits || !!e.proprietaire,
      licences: (e.licences || []).slice(),
      // null = inconnu (lecture des droits en échec) : affiché « Lecteur », boutons d'ajout gardés.
      editer: e.editer == null ? null : !!e.editer || !!e.gererDroits || !!e.proprietaire,
    };
    d.siteWeb = d.admin || !!e.siteWeb;
    // v5.7 : « Qui peut utiliser l'application » — Administrateur général ou d'applications (cloud).
    d.adminApplis = d.admin || (e.roles || []).some(function (t) { return ROLES_APPLIS.indexOf(String(t || "").toLowerCase()) > -1; });
    // Sections au-delà de Planning, Dossiers et Moi.
    var sections = [];
    if (d.admin || d.proprietaire || d.utilisateurs) sections.push("equipe");
    if (d.admin || d.facturation) sections.push("finance");
    if (d.admin) sections.push("deleguer");
    if (d.siteWeb) sections.push("site");
    var profil = d.admin ? "admin" : d.proprietaire ? "proprietaire" : d.facturation ? "facturation" : "collaborateur";
    return { profil: profil, droits: d, sections: sections, onglets: onglets(sections), roles: cles, niveau: niveauDe(d) };
  }

  var LIBELLES = {
    admin: "Administrateur général", proprietaire: "Propriétaire du site", facturation: "Administrateur de facturation", collaborateur: "Collaborateur",
  };

  /** v5.5 : 5 onglets au plus : Accueil, Planning, Documents, [Équipe | Factures | Site | Gérer], Moi. */
  var BASE_ONGLETS = ["accueil", "planning", "fichiers", "moi"];
  function onglets(sections) {
    var l = [{ id: "accueil", nom: "Accueil", icone: "maison" }, { id: "planning", nom: "Planning", icone: "agenda" }, { id: "fichiers", nom: "Documents", icone: "dossier" }];
    if (sections.length === 1 && sections[0] === "equipe") l.push({ id: "equipe", nom: "Équipe", icone: "personnes" });
    else if (sections.length === 1 && sections[0] === "finance") l.push({ id: "finance", nom: "Factures", icone: "euro" });
    else if (sections.length === 1 && sections[0] === "site") l.push({ id: "site", nom: "Site", icone: "globe" });
    else if (sections.length > 1) l.push({ id: "gerer", nom: "Gérer", icone: "etoile" });
    l.push({ id: "moi", nom: "Moi", icone: "personne" });
    return l;
  }
  /** Onglet de gestion (Équipe, Factures, Site ou Gérer), ou null. */
  function ongletGestion(liste) {
    for (var i = 0; i < liste.length; i++) if (BASE_ONGLETS.indexOf(liste[i].id) < 0) return liste[i];
    return null;
  }

  /* Écrans réservés : route → condition. Les autres routes connectées sont ouvertes à tous. */
  var RESERVES = {
    equipe: "equipe", gerer: "plusieurs", finance: "finance", personnes: "equipe", organisation: "equipe",
    "licences-reel": "licences", deleguer: "deleguer", acces: "gererDroits", restreindre: "gererDroits", reserver: "gererDroits",
    site: "site", liens: "site", suivi: "suivi", "acces-appli": "adminApplis",
  };
  /** Vrai si la route (1er segment) est permise pour ce résultat de deduire(). */
  function routePermise(route, r) {
    var c = RESERVES[route];
    if (!c) return true;
    if (!r) return false;
    if (c === "plusieurs") return r.sections.length > 1;
    if (c === "licences") return r.sections.indexOf("finance") > -1 || r.sections.indexOf("equipe") > -1;
    if (c === "gererDroits") return !!r.droits.gererDroits;
    if (c === "adminApplis") return !!r.droits.adminApplis;
    // Suivi informatique (v5.2) : depuis l'onglet de gestion (Gérer, Équipe ou Finance).
    if (c === "suivi") return r.sections.indexOf("equipe") > -1 || r.sections.indexOf("finance") > -1;
    if (c === "equipe" || c === "finance" || c === "site") {
      if (r.sections.indexOf(c) < 0) return false;
      // Une seule section : son onglet porte son nom ; plusieurs : tout passe par « Gérer ».
      return route !== c || r.sections.length === 1;
    }
    return r.sections.indexOf(c) > -1;
  }
  /** Onglet (id) qui contient une route. */
  function ongletDe(route, r) {
    var map = { accueil: "accueil", "comment-faire": "accueil", bienvenue: "accueil", planning: "planning", "": "accueil", fichiers: "fichiers", onedrive: "fichiers", dossiers: "fichiers", commun: "fichiers", acces: "fichiers", restreindre: "fichiers", reserver: "fichiers", journal: "fichiers",
      moi: "moi", reglages: "moi", details: "moi", verifier: "moi", installer: "moi", demos: "moi", aide: "moi", demandes: "moi" };
    if (route === "planning-public") return "planning";
    if (map[route] != null) return map[route];
    var g = ongletGestion(r ? r.onglets : onglets([]));
    return g ? g.id : "moi";
  }

  /* ------------------------------------------------------------------ */
  /* Garde-fous de délégation                                            */
  /* ------------------------------------------------------------------ */
  /**
   * Peut-on retirer le rôle « role » à « cibleId » ? titulaires : ids des personnes qui l'ont.
   * Renvoie null si c'est permis, sinon la raison (phrase simple).
   */
  function refusRetraitRole(role, cibleId, moiId, titulaires) {
    if (role === "admin" && cibleId && cibleId === moiId) return "Vous ne pouvez pas retirer votre propre rôle d'administrateur général.";
    if (role === "admin" && (titulaires || []).filter(Boolean).length <= 1) return "Impossible de retirer le dernier administrateur général : il en faut toujours au moins un.";
    return null;
  }
  /** Peut-on retirer cette personne des propriétaires du site ? */
  function refusRetraitProprietaire(cibleId, moiId, proprietaires) {
    if (cibleId != null && cibleId === moiId) return "Vous ne pouvez pas vous retirer vous-même des propriétaires du site.";
    if ((proprietaires || []).length <= 1) return "Impossible de retirer le dernier propriétaire du site.";
    return null;
  }
  /** La permission demandée figure-t-elle dans le jeton (claim scp) ? */
  function aLaPermission(scopes, permission) {
    var p = String(permission || "").toLowerCase();
    return (scopes || []).some(function (s) { return String(s).toLowerCase() === p; });
  }

  /* ------------------------------------------------------------------ */
  /* Pastille d'état (en-tête)                                           */
  /* ------------------------------------------------------------------ */
  /**
   * sondes : { cle: { etat: "ok" | "erreur" | "attente", critique: bool, message } }.
   * Renvoie { couleur: vert | orange | rouge | gris, texte, problemes: [message] }.
   */
  function pastille(sondes, connecte) {
    if (!connecte) return { couleur: "gris", texte: "Pas connecté", problemes: [] };
    var l = Object.keys(sondes || {}).map(function (k) { return sondes[k]; });
    var erreurs = l.filter(function (s) { return s.etat === "erreur"; });
    var critiques = erreurs.filter(function (s) { return s.critique; });
    var probs = erreurs.map(function (s) { return s.message; }).filter(Boolean);
    if (critiques.length) return { couleur: "rouge", texte: "Problème de connexion : " + (critiques[0].message || "Microsoft ne répond pas."), problemes: probs };
    if (erreurs.length) return { couleur: "orange", texte: "Connecté, mais une partie ne répond pas : " + (erreurs[0].message || "") , problemes: probs };
    if (!l.length || l.some(function (s) { return s.etat === "attente"; })) return { couleur: "gris", texte: "Vérification en cours…", problemes: [] };
    return { couleur: "vert", texte: "Connecté : tout fonctionne.", problemes: [] };
  }

  var api = {
    ROLES: ROLES, ROLES_DELEGABLES: ROLES_DELEGABLES, PERMISSION_ROLES: PERMISSION_ROLES, LIBELLES: LIBELLES,
    NIVEAUX: NIVEAUX, ongletGestion: ongletGestion, niveauDe: niveauDe, editerDe: editerDe, peutEditer: peutEditer,
    aLeBit: aLeBit, gererDroitsDe: gererDroitsDe, cleDeRole: cleDeRole, estMembreDe: estMembreDe, deduire: deduire, onglets: onglets,
    routePermise: routePermise, ongletDe: ongletDe, refusRetraitRole: refusRetraitRole,
    refusRetraitProprietaire: refusRetraitProprietaire, aLaPermission: aLaPermission, pastille: pastille,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.EBProfil = api;
})(typeof self !== "undefined" ? self : this);
