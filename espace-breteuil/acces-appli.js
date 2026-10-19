/*
 * Espace Breteuil — v5.7 : « Qui peut utiliser l'application » (partie SANS écran, tests/acces-appli.test.mjs).
 *
 * VRAI contrôle Microsoft (pas de liste maison) : l'application d'entreprise « Espace Breteuil »
 * (servicePrincipal de config.microsoft.clientId) porte la propriété « Affectation requise »
 * (appRoleAssignmentRequired). Si elle est vraie, Microsoft REFUSE la connexion (AADSTS50105) à toute
 * personne qui n'a pas d'affectation (appRoleAssignment, rôle par défaut 0000…).
 *
 * Écran réservé aux rôles Entra : Administrateur général, Administrateur d'applications (cloud).
 * Permissions déléguées en plus, demandées SEULEMENT à l'ouverture de cet écran (consentement incrémental) :
 *   AppRoleAssignment.ReadWrite.All  → cocher / décocher une personne
 *   Application.ReadWrite.All        → basculer « Affectation requise » (aucune permission plus petite ne le permet)
 * La LECTURE (servicePrincipal, affectations) passe par Directory.Read.All, déjà accordée à l'appli.
 */
(function (racine) {
  "use strict";

  var ROLE_DEFAUT = "00000000-0000-0000-0000-000000000000";
  var ROLES_ADMIN = {
    "62e90394-69f5-4237-9190-012177145e10": "Administrateur général",
    "158c047a-c907-4556-b7ef-446551a6b5f7": "Administrateur d'applications cloud",
    "9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3": "Administrateur d'applications",
  };
  var GA = "62e90394-69f5-4237-9190-012177145e10";
  var SCOPES_ECRIRE = ["AppRoleAssignment.ReadWrite.All", "Application.ReadWrite.All"];

  /** Rôles d'annuaire (roleTemplateId) → la personne peut-elle ouvrir l'écran ? */
  function peutGerer(roles) {
    return (roles || []).some(function (r) { return Object.prototype.hasOwnProperty.call(ROLES_ADMIN, String(r || "").toLowerCase()); });
  }
  /** Même chose depuis le claim « wids » d'un jeton d'identité (repli). */
  function peutGererWids(wids) { return peutGerer(wids); }

  function min(s) { return String(s || "").trim().toLowerCase(); }
  function estMembre(u) { return !!u && u.userType !== "Guest" && u.accountEnabled !== false; }

  /**
   * Construit l'état de l'écran.
   *   sp          : { id, appRoleAssignmentRequired }
   *   affectations: [{ id, principalId, principalType ("User" | "Group" | "ServicePrincipal"), principalDisplayName, appRoleId }]
   *   utilisateurs: [{ id, displayName, mail, userPrincipalName, userType, accountEnabled }]
   *   admins      : ids des administrateurs généraux ; moiId : la personne connectée.
   * Renvoie { restreint, lignes, groupes, nbCoches }. Les lignes « verrouillées » ne peuvent pas être décochées
   * (vous-même et les administrateurs généraux) : sinon personne ne pourrait plus rouvrir l'accès.
   */
  function etat(sp, affectations, utilisateurs, admins, moiId, prestataires) {
    var parId = {}, presta = (prestataires || []).map(min);
    (affectations || []).forEach(function (a) { if (a && a.principalType === "User") parId[a.principalId] = a; });
    admins = (admins || []).map(String);
    var lignes = (utilisateurs || []).filter(estMembre).map(function (u) {
      var a = parId[u.id], moi = u.id === moiId, admin = admins.indexOf(u.id) > -1;
      // Prestataire informatique (config.prestataires) : affiché EN CLAIR, coché par défaut, retirable (avec confirmation).
      var estPresta = !moi && !admin && (presta.indexOf(min(u.mail)) > -1 || presta.indexOf(min(u.userPrincipalName)) > -1);
      return { id: u.id, nom: u.displayName || u.mail || u.userPrincipalName || "?", mail: min(u.mail || u.userPrincipalName),
        coche: !!a, affectationId: a ? a.id : null, verrouille: moi || admin, prestataire: estPresta,
        raison: moi ? "Vous" : admin ? "Administrateur général" : estPresta ? "Prestataire informatique" : "" };
    }).sort(function (x, y) { return (y.verrouille - x.verrouille) || (y.prestataire - x.prestataire) || x.nom.localeCompare(y.nom, "fr"); });
    var groupes = (affectations || []).filter(function (a) { return a && a.principalType === "Group"; })
      .map(function (a) { return { id: a.principalId, nom: a.principalDisplayName || "Groupe", affectationId: a.id }; });
    return { restreint: !!(sp && sp.appRoleAssignmentRequired), lignes: lignes, groupes: groupes,
      nbCoches: lignes.filter(function (l) { return l.coche; }).length };
  }

  /** Personnes à affecter AVANT de restreindre (vous + administrateurs généraux pas encore cochés). */
  function aAffecterAvantRestriction(e, opts) {
    var sansPresta = !!(opts && opts.sansPrestataire);
    return e.lignes.filter(function (l) { return !l.coche && (l.verrouille || (l.prestataire && !sansPresta)); }).map(function (l) { return l.id; });
  }
  /** Case affichée cochée ? Le prestataire l'est par défaut tant que l'accès n'est pas restreint (il sera affecté au passage). */
  function afficheeCochee(e, l, opts) {
    if (l.coche || l.verrouille) return true;
    return !!(l.prestataire && !e.restreint && !(opts && opts.sansPrestataire));
  }
  /** Peut-on décocher cette ligne ? → "" ou la raison (phrase simple). */
  function refusDecocher(l) {
    if (!l || !l.verrouille) return "";
    return l.raison === "Vous" ? "Vous ne pouvez pas vous retirer vous-même : vous perdriez l'accès." : "Les administrateurs généraux restent toujours autorisés.";
  }
  /** Corps de l'affectation Graph (POST /servicePrincipals/{sp}/appRoleAssignedTo). */
  function corpsAffectation(spId, principalId) { return { principalId: principalId, resourceId: spId, appRoleId: ROLE_DEFAUT }; }

  /** Phrase de résumé pour l'écran. */
  function resume(e) {
    if (!e.restreint) return "Tout le monde dans le Château peut se connecter à l'application.";
    var n = e.nbCoches + e.groupes.length;
    return "Seules les personnes cochées peuvent se connecter (" + e.nbCoches + " personne" + (e.nbCoches > 1 ? "s" : "") +
      (e.groupes.length ? ", " + e.groupes.length + " groupe" + (e.groupes.length > 1 ? "s" : "") : "") + ")." + (n ? "" : " Personne n'est coché !");
  }

  var api = { ROLE_DEFAUT: ROLE_DEFAUT, ROLES_ADMIN: ROLES_ADMIN, GA: GA, SCOPES_ECRIRE: SCOPES_ECRIRE, peutGerer: peutGerer, peutGererWids: peutGererWids,
    etat: etat, aAffecterAvantRestriction: aAffecterAvantRestriction, afficheeCochee: afficheeCochee, refusDecocher: refusDecocher, corpsAffectation: corpsAffectation, resume: resume };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.EBAccesAppli = api;
})(typeof self !== "undefined" ? self : this);
