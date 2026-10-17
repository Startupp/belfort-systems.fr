/*
 * Espace Breteuil — données de DÉMONSTRATION (fictives) et logique pure.
 *
 * Tout ce qui est ici est inventé pour montrer ce que l'appli fera : postes,
 * licences, factures, moyens de paiement, absences. Prénoms seulement.
 * Les modifications faites en démo restent sur l'appareil (localStorage « eb:demo »)
 * et ne touchent jamais Microsoft 365.
 *
 * Utilisable dans le navigateur (window.EBDemo) et dans Node (tests).
 */
(function (racine) {
  "use strict";

  /* Formules Microsoft 365 (vocabulaire retenu avec le Château). Prix indicatifs HT
   * par personne et par mois, engagement annuel — à vérifier sur la facture réelle. */
  var FORMULES = {
    "complete": { nom: "Complète", produit: "Microsoft 365 Business Standard", prix: 11.7,
      applis: ["Outlook", "Teams", "Word", "Excel", "PowerPoint", "OneDrive"] },
    "express-teams": { nom: "Express + Teams", produit: "Microsoft 365 Business Basic", prix: 5.6,
      applis: ["Outlook", "Teams", "OneDrive", "Word et Excel en ligne"] },
    "express": { nom: "Express", produit: "Exchange Online (Plan 1)", prix: 4.0,
      applis: ["Outlook"] },
    "aucune": { nom: "Aucune", produit: "Pas de licence", prix: 0, applis: [] },
  };
  var ORDRE_FORMULES = ["complete", "express-teams", "express"];

  var ROLES = [
    { id: "admin", nom: "Administrateur général", texte: "Peut tout gérer : comptes, licences, rôles. À réserver à 2 personnes.", microsoft: "Global Administrator" },
    { id: "facturation", nom: "Gestion de la facturation", texte: "Factures, moyens de paiement, achat et retrait de licences.", microsoft: "Billing Administrator" },
    { id: "utilisateurs", nom: "Gestion des comptes", texte: "Créer ou bloquer un compte, changer un mot de passe.", microsoft: "User Administrator" },
  ];

  var BOITES = [
    { id: "contact", nom: "Contact", adresse: "contact@breteuil.fr" },
    { id: "finance", nom: "Finance", adresse: "finance@breteuil.fr" },
    { id: "restauration", nom: "Restauration", adresse: "restauration@breteuil.fr" },
    { id: "marketing", nom: "Marketing", adresse: "marketing@breteuil.fr" },
    { id: "jardins", nom: "Jardins", adresse: "jardins@breteuil.fr" },
    { id: "escapegame", nom: "Escape game", adresse: "escapegame@breteuil.fr" },
  ];

  var TYPES_ABSENCE = {
    conge: { nom: "Congé", couleur: "#2E5A8A" },
    absent: { nom: "Absent", couleur: "#8C7E81" },
    teletravail: { nom: "Télétravail", couleur: "#1D6B52" },
  };

  /* ------------------------------------------------------------------ */
  /* Dates simples (AAAA-MM-JJ, calendrier civil)                        */
  /* ------------------------------------------------------------------ */
  function iso(d) { return d.toISOString().slice(0, 10); }
  function jourIso(date) {
    // Date du jour à Paris, sans dépendre du fuseau de l'appareil.
    var p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(date || new Date());
    return p; // en-CA → AAAA-MM-JJ
  }
  function ajouterJours(isoJour, n) {
    var t = new Date(isoJour + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return iso(t);
  }
  function lundi(isoJour) {
    var t = new Date(isoJour + "T12:00:00Z"); var r = (t.getUTCDay() + 6) % 7; return ajouterJours(isoJour, -r);
  }

  /* ------------------------------------------------------------------ */
  /* Données de départ (fictives)                                        */
  /* ------------------------------------------------------------------ */
  function base(aujourdhui) {
    var auj = aujourdhui || jourIso();
    var l = lundi(auj);
    var collaborateurs = [
      { id: "francois", prenom: "François", poste: "Directeur", pole: "Direction", responsable: "", licence: "express-teams", boites: ["contact"], couleur: "#6B1524" },
      { id: "pauline", prenom: "Pauline", poste: "Directrice", pole: "Direction", responsable: "", licence: "express-teams", boites: ["contact"], couleur: "#8A2B3B" },
      { id: "valerie-d", prenom: "Valérie D.", poste: "Responsable administrative et financière", pole: "Finance", responsable: "francois", licence: "complete", boites: ["finance"], couleur: "#1D6B52" },
      { id: "guillaumette", prenom: "Guillaumette", poste: "Chargée de communication", pole: "Marketing", responsable: "pauline", licence: "complete", boites: ["marketing"], couleur: "#8A4B00" },
      { id: "fanny", prenom: "Fanny", poste: "Chargée d'accueil", pole: "Accueil", responsable: "pauline", licence: "complete", boites: ["contact", "escapegame"], couleur: "#2E5A8A" },
      { id: "valerie-l", prenom: "Valérie L.", poste: "Chargée d'accueil", pole: "Accueil", responsable: "pauline", licence: "complete", boites: ["contact", "escapegame"], couleur: "#3A6EA5" },
      { id: "yara", prenom: "Yara", poste: "Responsable restauration", pole: "Restauration", responsable: "francois", licence: "complete", boites: ["restauration"], couleur: "#7A3E8E" },
      { id: "joao", prenom: "Joao", poste: "Chef jardinier", pole: "Jardins", responsable: "francois", licence: "express", boites: ["jardins"], couleur: "#35601A" },
      { id: "marco", prenom: "Marco", poste: "Jardinier (saison)", pole: "Jardins", responsable: "joao", licence: "express", boites: [], couleur: "#3F6B1F" },
      { id: "erwin", prenom: "Erwin", poste: "Jardinier (saison)", pole: "Jardins", responsable: "joao", licence: "express", boites: [], couleur: "#4A7A26" },
      { id: "antonio", prenom: "Antonio", poste: "Jardinier (saison)", pole: "Jardins", responsable: "joao", licence: "aucune", boites: [], couleur: "#55862D" },
    ];
    return {
      version: 1,
      collaborateurs: collaborateurs,
      roles: { admin: ["francois"], facturation: ["valerie-d"], utilisateurs: ["francois"] },
      dossiers: [
        { id: "direction", nom: "Commun — Direction", membres: { francois: "modif", pauline: "modif" } },
        { id: "finance", nom: "Commun — Finance", membres: { "valerie-d": "modif", francois: "lecture" } },
        { id: "accueil", nom: "Commun — Accueil", membres: { fanny: "modif", "valerie-l": "modif", pauline: "lecture" } },
        { id: "restauration", nom: "Commun — Restauration", membres: { yara: "modif", francois: "lecture" } },
        { id: "marketing", nom: "Commun — Marketing", membres: { guillaumette: "modif", pauline: "modif" } },
        { id: "jardins", nom: "Commun — Jardins", membres: { joao: "modif", marco: "lecture", erwin: "lecture" } },
      ],
      achetees: { "complete": 6, "express-teams": 2, "express": 4 },
      paiements: [
        { id: "carte", type: "carte", libelle: "Carte bancaire •••• 4242", detail: "Expire 09/2028 (exemple)", parDefaut: true },
        { id: "sepa", type: "prelevement", libelle: "Prélèvement SEPA •••• 0189", detail: "Compte du Château (exemple)", parDefaut: false },
      ],
      factures: [2, 1, 0].map(function (recul, i) {
        var t = new Date(Date.UTC(+auj.slice(0, 4), +auj.slice(5, 7) - 1 - recul, 5));
        var date = iso(t);
        return { numero: "G07123456" + String(i + 1).padStart(2, "0"), date: date, montant: 97.4, statut: date <= auj ? "Payée" : "À venir" };
      }).reverse(),
      absences: [
        { id: "a1", personne: "guillaumette", type: "conge", du: ajouterJours(l, 7), au: ajouterJours(l, 11) },
        { id: "a2", personne: "valerie-d", type: "teletravail", du: ajouterJours(l, 4), au: ajouterJours(l, 4) },
        { id: "a3", personne: "valerie-d", type: "teletravail", du: ajouterJours(l, 11), au: ajouterJours(l, 11) },
        { id: "a4", personne: "marco", type: "absent", du: ajouterJours(l, 1), au: ajouterJours(l, 2) },
        { id: "a5", personne: "yara", type: "conge", du: ajouterJours(l, 14), au: ajouterJours(l, 18) },
      ],
      historique: [
        { quand: ajouterJours(auj, -3) + "T09:12", qui: "François", action: "Accès donné", detail: "Fanny → boîte partagée Escape game" },
        { quand: ajouterJours(auj, -8) + "T16:40", qui: "Valérie D.", action: "Licences", detail: "Express : 3 → 4 (+4,00 € HT / mois)" },
      ],
    };
  }

  /* ------------------------------------------------------------------ */
  /* Calculs (purs, testés)                                              */
  /* ------------------------------------------------------------------ */
  function arrondi(x) { return Math.round(x * 100) / 100; }
  function euros(x) {
    return arrondi(x).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " €";
  }

  /** Nombre de licences attribuées par formule. */
  function attribuees(collaborateurs) {
    var n = { "complete": 0, "express-teams": 0, "express": 0 };
    (collaborateurs || []).forEach(function (c) { if (n[c.licence] != null && !c.bloque) n[c.licence]++; });
    return n;
  }

  /** Coût mensuel HT des licences achetées. */
  function coutMensuel(achetees) {
    return arrondi(ORDRE_FORMULES.reduce(function (s, f) { return s + (achetees[f] || 0) * FORMULES[f].prix; }, 0));
  }

  /** Simulation d'achat (delta > 0) ou de retrait (delta < 0) de licences. */
  function simuler(achetees, collaborateurs, formule, delta) {
    var avant = coutMensuel(achetees);
    var nouv = Object.assign({}, achetees);
    nouv[formule] = Math.max(0, (nouv[formule] || 0) + delta);
    var apres = coutMensuel(nouv);
    var utilisees = attribuees(collaborateurs)[formule] || 0;
    return {
      achetees: nouv,
      avant: avant,
      apres: apres,
      difference: arrondi(apres - avant),
      parAn: arrondi((apres - avant) * 12),
      // On ne peut pas descendre sous le nombre de licences attribuées.
      possible: nouv[formule] >= utilisees,
      utilisees: utilisees,
    };
  }

  /** Changer de responsable sans créer de boucle (A responsable de B responsable de A). */
  function peutEtreResponsable(collaborateurs, id, nouveauResponsable) {
    if (!nouveauResponsable) return true;
    if (nouveauResponsable === id) return false;
    var parId = {};
    collaborateurs.forEach(function (c) { parId[c.id] = c; });
    var cur = parId[nouveauResponsable], garde = 0;
    while (cur && garde++ < 100) {
      if (cur.responsable === id) return false;
      cur = parId[cur.responsable];
    }
    return true;
  }

  /** Arbre de l'organigramme : [{ c, enfants: [...] }] (racines = sans responsable connu). */
  function arbre(collaborateurs) {
    var parId = {}, noeuds = {};
    collaborateurs.forEach(function (c) { parId[c.id] = c; noeuds[c.id] = { c: c, enfants: [] }; });
    var racines = [];
    collaborateurs.forEach(function (c) {
      var r = c.responsable && parId[c.responsable] && c.responsable !== c.id ? noeuds[c.responsable] : null;
      (r ? r.enfants : racines).push(noeuds[c.id]);
    });
    return racines;
  }

  /** Personne absente un jour donné ? Renvoie l'absence ou null. */
  function absenceDu(absences, personne, isoJour) {
    for (var i = 0; i < (absences || []).length; i++) {
      var a = absences[i];
      if (a.personne === personne && a.du <= isoJour && isoJour <= a.au) return a;
    }
    return null;
  }

  /** Mot de passe provisoire lisible (démo) : 3 mots + 2 chiffres. */
  function motDePasseProvisoire(alea) {
    var mots = ["Chateau", "Parc", "Rose", "Allee", "Tilleul", "Bassin", "Orangerie", "Verger", "Lierre", "Cedre"];
    var r = alea || Math.random;
    function un(t) { return t[Math.floor(r() * t.length)]; }
    return un(mots) + "-" + un(mots) + "-" + un(mots) + "-" + String(10 + Math.floor(r() * 90));
  }

  /* ------------------------------------------------------------------ */
  /* Stockage local de la démo                                           */
  /* ------------------------------------------------------------------ */
  var CLE = "eb:demo";
  function lireLocal(cle) { try { var v = localStorage.getItem(cle); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function ecrireLocal(cle, v) { try { localStorage.setItem(cle, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function effacerLocal(cle) { try { localStorage.removeItem(cle); } catch (e) {} }

  function charger() {
    var e = lireLocal(CLE);
    return e && e.version === 1 && Array.isArray(e.collaborateurs) ? e : base();
  }
  function sauver(etat) { return ecrireLocal(CLE, etat); }
  function reinitialiser() { effacerLocal(CLE); return base(); }

  function journal(etat, qui, action, detail) {
    var maintenant = new Date();
    var quand = jourIso(maintenant) + "T" + new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).format(maintenant);
    etat.historique.unshift({ quand: quand, qui: qui || "Démo", action: action, detail: detail });
    if (etat.historique.length > 200) etat.historique.length = 200;
  }

  var api = {
    FORMULES: FORMULES, ORDRE_FORMULES: ORDRE_FORMULES, ROLES: ROLES, BOITES: BOITES,
    TYPES_ABSENCE: TYPES_ABSENCE,
    base: base, charger: charger, sauver: sauver, reinitialiser: reinitialiser, journal: journal,
    attribuees: attribuees, coutMensuel: coutMensuel, simuler: simuler, euros: euros,
    peutEtreResponsable: peutEtreResponsable, arbre: arbre, absenceDu: absenceDu,
    motDePasseProvisoire: motDePasseProvisoire,
    jourIso: jourIso, ajouterJours: ajouterJours, lundi: lundi,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.EBDemo = api;
})(typeof self !== "undefined" ? self : this);
