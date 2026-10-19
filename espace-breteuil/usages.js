/*
 * Espace Breteuil — v5.5 : « Ce que j'utilise » (questionnaire du premier lancement) et
 * « Comment faire ? » (tutoriel). Logique pure, testée sous Node (tests/usages.test.mjs).
 *
 * Les choix possibles dépendent des DROITS RÉELS (profil.js → deduire) : on ne propose jamais
 * ce à quoi la personne n'a pas accès. Le choix est gardé sur l'appareil, par compte
 * (« eb:usages:<id du compte> ») ; il ne donne aucun droit, il ne change que l'ordre de l'accueil
 * et l'onglet ouvert après la connexion.
 */
(function (racine) {
  "use strict";

  var USAGES = [
    { id: "planning", emoji: "📅", titre: "Voir le planning du Château", court: "Planning", sous: "Visites, événements, qui travaille" },
    { id: "equipe", emoji: "📁", titre: "Ranger et retrouver les documents de l'équipe", court: "Documents de l'équipe", sous: "Le dossier partagé du Château" },
    { id: "perso", emoji: "👤", titre: "Ranger mes documents personnels", court: "Mes documents", sous: "Pour moi seulement (OneDrive)" },
    { id: "acces", emoji: "🔐", titre: "Choisir qui a accès aux dossiers", court: "Qui peut ouvrir ?", sous: "Rendre un dossier privé ou l'ouvrir" },
    { id: "site", emoji: "🌐", titre: "Modifier le site internet", court: "Site internet", sous: "www.breteuil.fr" },
    { id: "factures", emoji: "💶", titre: "Suivre les factures", court: "Factures", sous: "Factures et abonnements Microsoft" },
    { id: "suivi", emoji: "🛠️", titre: "Suivre l'informatique du Château", court: "Suivi informatique", sous: "Ce que Damien a fait pour le Château" },
  ];

  function a(r, section) { return !!(r && r.sections && r.sections.indexOf(section) > -1); }
  /** Usage permis ? r : résultat de deduire() (ou null) ; ctx : { commun, onedrive } (vrai par défaut). */
  function permis(id, r, ctx) {
    ctx = ctx || {};
    if (id === "planning") return true;
    if (id === "equipe") return ctx.commun !== false;
    if (id === "perso") return ctx.onedrive !== false;
    if (id === "acces") return !!(r && r.niveau === "gestionnaire") && ctx.commun !== false;
    if (id === "site") return a(r, "site");
    if (id === "factures") return a(r, "finance");
    if (id === "suivi") return a(r, "equipe") || a(r, "finance");
    return false;
  }
  /** Les usages proposés, dans l'ordre par défaut. */
  function possibles(r, ctx) { return USAGES.filter(function (u) { return permis(u.id, r, ctx); }); }

  /** Choisis d'abord (dans l'ordre du choix), puis les autres possibles. Les choix devenus interdits disparaissent. */
  function ordonner(choix, liste) {
    var parId = {}; liste.forEach(function (u) { parId[u.id] = u; });
    var vus = {}, choisis = [];
    (Array.isArray(choix) ? choix : []).forEach(function (id) { if (parId[id] && !vus[id]) { vus[id] = 1; choisis.push(parId[id]); } });
    return { choisis: choisis, autres: liste.filter(function (u) { return !vus[u.id]; }) };
  }

  /** Onglet de gestion (Gérer, Équipe, Factures ou Site) d'après le résultat, ou null. */
  function hub(r) {
    var l = (r && r.onglets) || [];
    for (var i = 0; i < l.length; i++) if (["accueil", "planning", "fichiers", "moi"].indexOf(l[i].id) < 0) return l[i].id;
    return null;
  }
  /** Adresse de l'écran d'un usage. */
  function routeDe(id, r, nomCommun) {
    if (id === "planning") return "#/planning";
    if (id === "equipe") return "#/commun";
    if (id === "perso") return "#/onedrive";
    if (id === "acces") return "#/acces/" + encodeURIComponent(nomCommun || "Commun");
    if (id === "suivi") return "#/suivi";
    if (id === "site" || id === "factures") return "#/" + (hub(r) || "accueil");
    return "#/accueil";
  }
  /** Écran ouvert après la connexion : le 1er choix (s'il est encore permis), sinon l'accueil. */
  function depart(choix, r, ctx, nomCommun) {
    var o = ordonner(choix, possibles(r, ctx));
    return o.choisis.length ? routeDe(o.choisis[0].id, r, nomCommun) : "#/accueil";
  }
  /** Clé de stockage, par compte Microsoft. */
  function cle(compte) {
    var c = compte || {};
    return "eb:usages:" + (c.homeAccountId || c.localAccountId || c.username || "?");
  }
  /** Valeur stockée valide → liste d'ids, sinon null (jamais répondu). */
  function lireChoix(v) {
    if (!v || !Array.isArray(v.choix)) return null;
    return v.choix.filter(function (x) { return typeof x === "string"; });
  }

  /* ------------------------------------------------------------------ */
  /* « Comment faire ? » : tâches dites comme on les pense               */
  /* ------------------------------------------------------------------ */
  // route : adresse, ou "hub" (onglet de gestion), ou "" (rester sur l'écran) ; cible : bouton à entourer.
  var TACHES = [
    { id: "aujourdhui", titre: "Voir qui travaille aujourd'hui", phrase: "Dans le Planning, touchez « Jour » : vous voyez la journée en entier.", route: "#/planning", cible: '[data-vue="jour"]' },
    { id: "retrouver", titre: "Retrouver un document", phrase: "Les derniers documents ouverts sont en haut de l'onglet Documents.", route: "#/fichiers", cible: '[data-tuto="recents"]' },
    { id: "ranger", titre: "Ranger un document de l'équipe", phrase: "Ouvrez le bon dossier, puis touchez « Ajouter un document ».", route: "#/commun", cible: '[data-action="televerser-commun"]', si: "editeur" },
    { id: "dossier", titre: "Créer un dossier", phrase: "Dans les documents de l'équipe, touchez « Créer un dossier » et donnez-lui un nom.", route: "#/commun", cible: '[data-action="nouveau-dossier"]', si: "editeur" },
    { id: "perso", titre: "Ranger un document personnel", phrase: "Dans « Mes documents », touchez « Ajouter ». Vous seul pourrez l'ouvrir.", route: "#/fichiers", cible: '[data-action="televerser-moi"]', si: "onedrive" },
    { id: "lien", titre: "Envoyer un lien vers un document", phrase: "Touchez le document, puis « Copier un lien ». Collez-le dans un mail ou un message.", route: "#/fichiers", cible: ".section-fichiers .fichier" },
    { id: "prive", titre: "Rendre un dossier privé", phrase: "Touchez « ⋯ » sur le dossier, puis « Choisir qui peut l'ouvrir ».", route: "#/commun", cible: ".tuile-menu", si: "gestionnaire" },
    { id: "epingler", titre: "Épingler un raccourci sur l'accueil", phrase: "Une adresse partagée, l'agenda ou un dossier : toujours à portée de main.", route: "#/accueil", cible: '[data-action="epingler"]' },
    { id: "texte", titre: "Agrandir le texte", phrase: "Dans Réglages, choisissez « Grand » ou « Très grand ».", route: "#/reglages", cible: '[data-reglage="texte"]' },
    { id: "suivi", titre: "Suivre l'informatique du Château", phrase: "Tout ce que Damien a fait, les projets à venir et les documents.", route: "hub", cible: '[data-action="suivi"]', si: "suivi" },
    { id: "site", titre: "Modifier le site internet", phrase: "Choisissez ce que vous voulez changer ; WordPress s'ouvre au bon endroit.", route: "hub", cible: ".section-site .t", si: "site" },
    { id: "aide", titre: "Demander de l'aide à Damien", phrase: "Touchez « ? » en bas à droite, choisissez le type de demande et écrivez.", route: "", cible: ".aide-fab" },
  ];
  function tachePermise(t, r, ctx) {
    ctx = ctx || {};
    if (!t.si) return true;
    if (t.si === "editeur") return ctx.editer !== false;
    if (t.si === "gestionnaire") return !!(r && r.niveau === "gestionnaire");
    if (t.si === "onedrive") return ctx.onedrive !== false;
    if (t.si === "suivi") return a(r, "equipe") || a(r, "finance");
    if (t.si === "site") return a(r, "site");
    return false;
  }
  function taches(r, ctx) { return TACHES.filter(function (t) { return tachePermise(t, r, ctx); }); }
  function routeTache(t, r) { return t.route === "hub" ? "#/" + (hub(r) || "accueil") : t.route; }

  var api = { USAGES: USAGES, TACHES: TACHES, permis: permis, possibles: possibles, ordonner: ordonner, routeDe: routeDe,
    depart: depart, cle: cle, lireChoix: lireChoix, taches: taches, routeTache: routeTache, hub: hub };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.EBUsages = api;
})(typeof self !== "undefined" ? self : this);
