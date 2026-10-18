/*
 * Espace Breteuil — v4 : détection EN ARRIÈRE-PLAN de ce que la personne connectée peut faire,
 * et pastille d'état de l'en-tête.
 *
 * Après la connexion, en parallèle (aucun écran d'attente) :
 *   - Graph  /me                                                      → qui je suis (critique)
 *   - Graph  /me/transitiveMemberOf/microsoft.graph.directoryRole     → mes rôles d'annuaire
 *            (repli : /me/memberOf filtré sur directoryRole)
 *   - Graph  /me/licenseDetails                                       → mes licences
 *   - Graph  /me/transitiveMemberOf/microsoft.graph.group             → mes groupes (section « Site web »)
 *            (repli : /me/transitiveMemberOf filtré sur les groupes ; échec = pas de section, sans alerte)
 *   - contexte SharePoint (connecte.js) : site, Documents, Commun, currentuser, propriétaires
 *   - REST   /_api/web/effectivebasepermissions                       → ManagePermissions
 * Le résultat (profil.js) décide des onglets. Le dernier état connu est gardé pour la
 * session de l'onglet (sessionStorage, uniquement des rôles : ni jeton ni donnée sensible)
 * et affiché tout de suite à la réouverture d'un écran, puis mis à jour.
 *
 * Chaque appel réel (graph.js → surResultat) alimente aussi la pastille : vert = connecté,
 * orange = partiel, rouge = problème.
 */
(function () {
  "use strict";

  var G = window.EBGraph, P = window.EBProfil, C = window.EBCache, EB = window.EB;
  var etat = { resultat: null, entrees: null, sondes: {}, me: null, enCours: null };
  var ecouteurs = [], pastilles = [];
  var TTL = 5 * 60000;

  function cleSession() { var c = (G && G.compte()) || {}; return "eb:profil:" + (c.homeAccountId || c.localAccountId || c.username || "?"); }
  function restaurer() {
    if (etat.resultat || !G.estConnecte()) return;
    try {
      var v = JSON.parse(sessionStorage.getItem(cleSession()) || "null");
      if (v && v.entrees) { etat.entrees = v.entrees; etat.resultat = P.deduire(v.entrees); etat.me = v.me || null; }
    } catch (e) {}
  }
  function sauver() { try { sessionStorage.setItem(cleSession(), JSON.stringify({ entrees: etat.entrees, me: etat.me })); } catch (e) {} }

  /* ------------------------------------------------------------------ */
  /* Sondes et pastille                                                  */
  /* ------------------------------------------------------------------ */
  function sonde(cle, e, message, critique) {
    if (e == null) delete etat.sondes[cle];
    else etat.sondes[cle] = { etat: e, message: message || "", critique: !!critique };
    majPastilles();
  }
  function bilan() { return P.pastille(etat.sondes, G.estConnecte()); }
  function majPastilles() {
    var b = bilan();
    pastilles = pastilles.filter(function (el) { return document.body.contains(el); });
    pastilles.forEach(function (el) { peindre(el, b); });
  }
  function peindre(el, b) {
    el.className = "pastille-etat " + b.couleur;
    el.setAttribute("aria-label", "État de la connexion : " + b.texte);
    el.title = b.texte;
  }
  /** Pastille pour l'en-tête (rien si pas connecté). */
  function pastille() {
    if (!G || !G.estConnecte()) return null;
    var el = EB.h("button", { type: "button", class: "pastille-etat", onclick: function () { expliquer(); } }, EB.h("i", { "aria-hidden": "true" }));
    peindre(el, bilan());
    pastilles.push(el);
    return el;
  }
  function expliquer() {
    var b = bilan(), h = EB.h;
    if (b.couleur === "vert" || b.couleur === "gris") { EB.toast(b.texte); return; }
    var d = EB.dialogue();
    var ok = h("button", { class: "btn large", type: "button", onclick: EB.fermerDialogue }, "Fermer");
    d.appendChild(h("div", { class: "contenu" },
      h("h2", { id: "detail-titre" }, b.couleur === "rouge" ? "Problème de connexion" : "Une partie ne répond pas"),
      h("ul", { class: "liste-problemes" }, b.problemes.map(function (p) { return h("li", null, p); })),
      h("button", { class: "btn secondaire large", type: "button", onclick: function () { EB.fermerDialogue(); charger(true); EB.toast("Nouvelle vérification…"); } }, EB.icone("actualiser"), "Réessayer"),
      h("a", { class: "btn secondaire large", href: "#/details", onclick: EB.fermerDialogue }, "Détails techniques"),
      ok));
    EB.ouvrirDialogue(d, ok);
  }

  /* Appels réels : la pastille suit en direct (session expirée, Microsoft injoignable…). */
  if (G && G.surResultat) G.surResultat(function (r) {
    var cle = "direct-" + r.ressource;
    if (r.ok) { if (etat.sondes[cle]) sonde(cle, null); return; }
    if (r.statut === 401) sonde(cle, "erreur", "Votre connexion a expiré : reconnectez-vous.", true);
    else if (r.statut === 0) sonde(cle, "erreur", r.ressource === "sp" ? "SharePoint ne répond pas à l'appli." : "Microsoft ne répond pas (réseau ?).", r.ressource !== "sp");
    else if (r.statut >= 500) sonde(cle, "erreur", "Microsoft répond par une erreur (" + r.statut + "). Réessayez dans une minute.", false);
  });

  /* ------------------------------------------------------------------ */
  /* Détection des droits                                                */
  /* ------------------------------------------------------------------ */
  function regle(p) { return p.then(function (v) { return { ok: true, v: v }; }, function (e) { return { ok: false, e: e }; }); }
  function mesRoles() {
    return G.graphTout("/me/transitiveMemberOf/microsoft.graph.directoryRole?$select=id,displayName,roleTemplateId").catch(function () {
      return G.graphTout("/me/memberOf?$select=id,displayName,roleTemplateId").then(function (l) {
        return l.filter(function (x) { return x["@odata.type"] === "#microsoft.graph.directoryRole" || x.roleTemplateId; });
      });
    });
  }
  /** Groupes (Microsoft 365 et sécurité, y compris imbriqués) : seulement leur nom affiché. */
  function mesGroupes() {
    return G.graphTout("/me/transitiveMemberOf/microsoft.graph.group?$select=id,displayName").catch(function () {
      return G.graphTout("/me/transitiveMemberOf?$select=id,displayName").then(function (l) {
        return l.filter(function (x) { return x["@odata.type"] === "#microsoft.graph.group"; });
      });
    });
  }
  function nomGroupeSite() { var s = (self.EB_CONFIG || {}).siteWeb; return (s && s.groupe) || ""; }
  function charger(force) {
    if (!G.estConnecte()) return Promise.resolve(null);
    restaurer();
    if (etat.enCours && !force) return etat.enCours;
    if (force) { ["acces:me", "acces:roles", "acces:licences", "acces:perm", "acces:groupes"].forEach(function (k) { C.oublier(k); }); if (window.EBConnecte) window.EBConnecte.oublierContexte(); }
    ["me", "roles", "licences", "site", "sp"].forEach(function (k) { if (!etat.sondes[k]) sonde(k, "attente"); });
    var ctx = window.EBConnecte ? window.EBConnecte.contexte() : Promise.reject(new Error("indisponible"));
    etat.enCours = Promise.all([
      regle(C.obtenir("acces:me", function () { return G.graph("GET", "/me?$select=id,displayName,givenName,userPrincipalName,mail,jobTitle"); }, { ttl: TTL })),
      regle(C.obtenir("acces:roles", mesRoles, { ttl: TTL })),
      regle(C.obtenir("acces:licences", function () { return G.graphTout("/me/licenseDetails?$select=skuPartNumber"); }, { ttl: TTL })),
      regle(ctx),
      regle(C.obtenir("acces:perm", function () { return G.sp("GET", "/_api/web/effectivebasepermissions"); }, { ttl: TTL })),
      nomGroupeSite() ? regle(C.obtenir("acces:groupes", mesGroupes, { ttl: TTL })) : Promise.resolve({ ok: true, v: [] }),
    ]).then(function (r) {
      var me = r[0], roles = r[1], lic = r[2], c = r[3], perm = r[4], groupes = r[5];
      if (me.ok) { etat.me = me.v; sonde("me", "ok"); } else sonde("me", "erreur", (me.e && me.e.message) || "Microsoft ne vous reconnaît pas.", true);
      if (roles.ok) sonde("roles", "ok"); else sonde("roles", "erreur", "Vos rôles d'administration n'ont pas pu être lus (permission Directory.Read.All ?).");
      if (lic.ok) sonde("licences", "ok"); else sonde("licences", "erreur", "Vos licences n'ont pas pu être lues.");
      if (c.ok) {
        sonde("site", "ok");
        if (c.v.commun) sonde("commun", null); else sonde("commun", "erreur", "Le dossier commun est introuvable.");
        if (c.v.moiSp) sonde("sp", "ok"); else sonde("sp", "erreur", "SharePoint ne répond pas à l'appli : les droits des dossiers ne sont pas lisibles.");
      } else {
        sonde("site", "erreur", c.e && c.e.statut === 404 ? "Le site SharePoint du Château est introuvable." : ((c.e && c.e.message) || "Le site du Château ne répond pas."));
        sonde("sp", null);
      }
      var proprietaire = c.ok && (c.v.estProprietaire || !!(c.v.moiSp && c.v.moiSp.IsSiteAdmin));
      var entrees = {
        roles: roles.ok ? roles.v.map(function (x) { return x.roleTemplateId; }) : (etat.entrees ? etat.entrees.roles : []),
        proprietaire: !!proprietaire,
        gererDroits: perm.ok ? P.gererDroitsDe(perm.v) : false,
        licences: lic.ok ? lic.v.map(function (x) { return x.skuPartNumber; }) : [],
        siteWeb: groupes.ok ? P.estMembreDe(groupes.v, nomGroupeSite()) : !!(etat.entrees && etat.entrees.siteWeb),
      };
      var avant = etat.resultat ? JSON.stringify(etat.entrees) : null;
      etat.entrees = entrees;
      etat.resultat = P.deduire(entrees);
      sauver();
      etat.enCours = null;
      if (avant !== JSON.stringify(entrees)) prevenir();
      return etat.resultat;
    });
    return etat.enCours;
  }
  function prevenir() { ecouteurs.forEach(function (fn) { try { fn(etat.resultat); } catch (e) { console.error(e); } }); }

  window.EBAcces = {
    charger: charger,
    /** Dernier résultat connu (null tant que rien n'est connu). */
    resultat: function () { restaurer(); return etat.resultat; },
    me: function () { return etat.me; },
    sonde: function (k) { return etat.sondes[k] || null; },
    signaler: sonde,
    bilan: bilan,
    pastille: pastille,
    surChangement: function (fn) { ecouteurs.push(fn); },
    oublier: function () {
      try { sessionStorage.removeItem(cleSession()); } catch (e) {}
      etat.resultat = null; etat.entrees = null; etat.me = null; etat.sondes = {}; etat.enCours = null;
      C.oublier();
    },
  };
})();
