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

  /* Rôles : une phrase simple pour chacun. « pole » = responsable d'un pôle. */
  var ROLES = [
    { id: "admin", nom: "Administrateur", emoji: "🔑", texte: "Peut tout régler : comptes, accès, rôles. À confier à deux personnes au plus.", microsoft: "Global Administrator" },
    { id: "facturation", nom: "Facturation", emoji: "💶", texte: "Voit les factures Microsoft, change le moyen de paiement, achète ou retire des licences.", microsoft: "Billing Administrator" },
    { id: "utilisateurs", nom: "Gestion des comptes", emoji: "👤", texte: "Crée ou bloque un compte, remet un mot de passe à zéro.", microsoft: "User Administrator" },
    { id: "pole", nom: "Responsable de pôle", emoji: "🧭", texte: "Décide qui accède aux dossiers et à la boîte de son pôle.", microsoft: "(propriétaire du groupe)" },
  ];
  var POLES = ["Direction", "Finance", "Accueil", "Restauration", "Marketing", "Jardins"];

  /* Niveaux d'accès, du plus léger au plus fort. « envoyer » n'existe que pour les boîtes. */
  var NIVEAUX = {
    lire: { nom: "Lire", emoji: "👁️", texte: "Peut regarder, sans rien changer." },
    modifier: { nom: "Modifier", emoji: "✏️", texte: "Peut lire, ajouter, ranger et modifier." },
    envoyer: { nom: "Envoyer au nom de", emoji: "📨", texte: "Peut aussi écrire des mails au nom de cette boîte." },
  };

  var BOITES = [
    { id: "contact", nom: "Contact", adresse: "contact@breteuil.fr", emoji: "🏰", couleur: "#6B1524" },
    { id: "finance", nom: "Finance", adresse: "finance@breteuil.fr", emoji: "💶", couleur: "#1D6B52" },
    { id: "restauration", nom: "Restauration", adresse: "restauration@breteuil.fr", emoji: "🍽️", couleur: "#7A3E8E" },
    { id: "marketing", nom: "Marketing", adresse: "marketing@breteuil.fr", emoji: "📣", couleur: "#8A4B00" },
    { id: "jardins", nom: "Jardins", adresse: "jardins@breteuil.fr", emoji: "🌿", couleur: "#35601A" },
    { id: "escapegame", nom: "Escape game", adresse: "escapegame@breteuil.fr", emoji: "🗝️", couleur: "#2E5A8A" },
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
      { id: "francois", prenom: "François", poste: "Directeur", pole: "Direction", responsable: "", licence: "express-teams", couleur: "#6B1524" },
      { id: "pauline", prenom: "Pauline", poste: "Directrice", pole: "Direction", responsable: "", licence: "express-teams", couleur: "#8A2B3B" },
      { id: "valerie-d", prenom: "Valérie D.", poste: "Responsable administrative et financière", pole: "Finance", responsable: "francois", licence: "complete", couleur: "#1D6B52" },
      { id: "guillaumette", prenom: "Guillaumette", poste: "Chargée de communication", pole: "Marketing", responsable: "pauline", licence: "complete", couleur: "#8A4B00" },
      { id: "fanny", prenom: "Fanny", poste: "Chargée d'accueil", pole: "Accueil", responsable: "pauline", licence: "complete", couleur: "#2E5A8A" },
      { id: "valerie-l", prenom: "Valérie L.", poste: "Chargée d'accueil", pole: "Accueil", responsable: "pauline", licence: "complete", couleur: "#3A6EA5" },
      { id: "yara", prenom: "Yara", poste: "Responsable restauration", pole: "Restauration", responsable: "francois", licence: "complete", couleur: "#7A3E8E" },
      { id: "joao", prenom: "Joao", poste: "Chef jardinier", pole: "Jardins", responsable: "francois", licence: "express", couleur: "#35601A" },
      { id: "marco", prenom: "Marco", poste: "Jardinier (saison)", pole: "Jardins", responsable: "joao", licence: "express", couleur: "#3F6B1F" },
      { id: "erwin", prenom: "Erwin", poste: "Jardinier (saison)", pole: "Jardins", responsable: "joao", licence: "express", couleur: "#4A7A26" },
      { id: "antonio", prenom: "Antonio", poste: "Jardinier (saison)", pole: "Jardins", responsable: "joao", licence: "aucune", couleur: "#55862D" },
    ];
    return {
      version: 2,
      collaborateurs: collaborateurs,
      roles: {
        admin: ["francois"], facturation: ["valerie-d"], utilisateurs: ["francois"],
        "pole:Finance": ["valerie-d"], "pole:Accueil": ["fanny"], "pole:Restauration": ["yara"],
        "pole:Marketing": ["guillaumette"], "pole:Jardins": ["joao"], "pole:Direction": ["francois", "pauline"],
      },
      // Boîtes partagées : photo (en démo, gardée sur l'appareil) et accès par personne.
      boites: BOITES.map(function (b) {
        var m = {
          contact: { fanny: "envoyer", "valerie-l": "envoyer", pauline: "modifier", francois: "lire" },
          finance: { "valerie-d": "envoyer", francois: "lire" },
          restauration: { yara: "envoyer" },
          marketing: { guillaumette: "envoyer", pauline: "lire" },
          jardins: { joao: "envoyer", marco: "lire" },
          escapegame: { fanny: "modifier", "valerie-l": "modifier" },
        }[b.id] || {};
        return { id: b.id, nom: b.nom, adresse: b.adresse, emoji: b.emoji, couleur: b.couleur, photo: null, acces: m };
      }),
      // Boîtes personnelles : délégations accordées à d'autres personnes (le titulaire a toujours tout).
      delegations: { francois: { pauline: "lire" } },
      dossiers: dossiersDeDepart(),
      fichiers: fichiersDeDepart(),
      mfa: {
        obligatoire: false,
        etats: { francois: "appli", pauline: "aucune", "valerie-d": "appli", guillaumette: "sms", fanny: "aucune", "valerie-l": "aucune", yara: "appli", joao: "aucune", marco: "aucune", erwin: "aucune", antonio: "aucune" },
        rappels: {},
      },
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

  /* Arborescence fictive et réaliste du dossier commun. acces = null : suit le dossier parent. */
  function dossiersDeDepart() {
    function d(id, nom, parent, emoji, couleur, acces, favori) {
      return { id: id, nom: nom, parent: parent || null, emoji: emoji || "", couleur: couleur || "", acces: acces || null, favori: !!favori };
    }
    var tous = { francois: "modifier", pauline: "modifier", "valerie-d": "modifier", guillaumette: "modifier", fanny: "modifier", "valerie-l": "modifier", yara: "modifier", joao: "modifier" };
    return [
      d("direction", "Direction", null, "🏰", "#6B1524", { francois: "modifier", pauline: "modifier" }),
      d("dir-ca", "Conseil et associés", "direction", "📁"),
      d("dir-contrats", "Contrats", "direction", "📜"),
      d("finance", "Finance", null, "💶", "#1D6B52", { "valerie-d": "modifier", francois: "modifier", pauline: "lire" }, true),
      d("fin-factures", "Factures fournisseurs", "finance", "🧾"),
      d("fin-2026", "2026", "fin-factures"),
      d("fin-2025", "2025", "fin-factures"),
      d("fin-paie", "Paie", "finance", "🔒", "#8A2B3B", { "valerie-d": "modifier", francois: "lire" }),
      d("fin-banque", "Banque", "finance", "🏦"),
      d("marketing", "Marketing", null, "📣", "#8A4B00", { guillaumette: "modifier", pauline: "modifier", fanny: "lire" }),
      d("mkt-photos", "Photos", "marketing", "📷", "", null, true),
      d("mkt-reseaux", "Réseaux sociaux", "marketing", "💬"),
      d("mkt-presse", "Presse", "marketing", "📰"),
      d("accueil", "Accueil", null, "🛎️", "#2E5A8A", { fanny: "modifier", "valerie-l": "modifier", pauline: "modifier" }),
      d("acc-groupes", "Réservations de groupes", "accueil", "🎟️"),
      d("acc-boutique", "Boutique", "accueil", "🛍️"),
      d("restauration", "Restauration", null, "🍽️", "#7A3E8E", { yara: "modifier", francois: "lire", pauline: "lire" }),
      d("rest-menus", "Menus", "restauration", "📋"),
      d("rest-hygiene", "Hygiène (HACCP)", "restauration", "🧼"),
      d("jardins", "Jardins", null, "🌿", "#35601A", { joao: "modifier", marco: "lire", erwin: "lire", francois: "lire" }),
      d("jar-plans", "Plans des parterres", "jardins", "🗺️"),
      d("evenements", "Événements", null, "🎉", "#B88A2E", tous, true),
      d("evt-mariages", "Mariages", "evenements", "💍"),
      d("evt-noel", "Marché de Noël", "evenements", "🎄"),
      d("evt-patrimoine", "Journées du Patrimoine", "evenements", "🏛️"),
    ];
  }
  function fichiersDeDepart() {
    function f(nom, dossier, type) { return { nom: nom, dossier: dossier, type: type }; }
    return [
      f("Budget 2026.xlsx", "finance", "tableur"), f("Tarifs 2026.pdf", "accueil", "pdf"),
      f("Planning des groupes.xlsx", "acc-groupes", "tableur"), f("Menu automne.docx", "rest-menus", "texte"),
      f("Plan de nettoyage.pdf", "rest-hygiene", "pdf"), f("Façade sud.jpg", "mkt-photos", "image"),
      f("Communiqué Noël.docx", "mkt-presse", "texte"), f("Fournisseur fleurs — octobre.pdf", "fin-2026", "pdf"),
      f("Plan parterre est.pdf", "jar-plans", "pdf"), f("Contrat traiteur.pdf", "dir-contrats", "pdf"),
      f("Déroulé mariage type.docx", "evt-mariages", "texte"),
    ];
  }

  /* ------------------------------------------------------------------ */
  /* Dossier commun : héritage des droits, déplacements                  */
  /* ------------------------------------------------------------------ */
  function dossierParId(etat, id) {
    for (var i = 0; i < etat.dossiers.length; i++) if (etat.dossiers[i].id === id) return etat.dossiers[i];
    return null;
  }
  /** Chemin depuis la racine : [Finance, Factures fournisseurs, 2026]. */
  function cheminDossier(etat, id) {
    var out = [], d = dossierParId(etat, id), garde = 0;
    while (d && garde++ < 50) { out.unshift(d); d = d.parent ? dossierParId(etat, d.parent) : null; }
    return out;
  }
  /** Accès réels d'un dossier : les siens (exception) ou ceux du premier parent qui en a. */
  function accesEffectifs(etat, id) {
    var chemin = cheminDossier(etat, id);
    for (var i = chemin.length - 1; i >= 0; i--) {
      if (chemin[i].acces) return { acces: chemin[i].acces, herite: i !== chemin.length - 1, depuis: chemin[i] };
    }
    return { acces: {}, herite: false, depuis: null };
  }
  function enfants(etat, id) {
    return etat.dossiers.filter(function (d) { return (d.parent || null) === (id || null); })
      .sort(function (a, b) { return a.nom.localeCompare(b.nom, "fr"); });
  }
  /** Peut-on ranger le dossier `id` dans `cible` (null = racine) ? Pas dans lui-même ni ses sous-dossiers. */
  function peutDeplacer(etat, id, cible) {
    if (!cible) return true;
    if (cible === id) return false;
    return !cheminDossier(etat, cible).some(function (d) { return d.id === id; });
  }
  /** Tout ce à quoi une personne a accès : boîtes partagées, boîtes perso déléguées, dossiers. */
  function ressourcesDe(etat, personne) {
    var out = [];
    etat.boites.forEach(function (b) { if (b.acces[personne]) out.push({ type: "boite", id: b.id, nom: b.nom, niveau: b.acces[personne], ressource: b }); });
    Object.keys(etat.delegations || {}).forEach(function (titulaire) {
      var n = etat.delegations[titulaire][personne];
      if (n) out.push({ type: "perso", id: titulaire, nom: titulaire, niveau: n });
    });
    etat.dossiers.forEach(function (d) {
      if (d.acces && d.acces[personne]) out.push({ type: "dossier", id: d.id, nom: d.nom, niveau: d.acces[personne], ressource: d });
    });
    return out;
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
    return e && e.version === 2 && Array.isArray(e.collaborateurs) ? e : base();
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
    FORMULES: FORMULES, ORDRE_FORMULES: ORDRE_FORMULES, ROLES: ROLES, POLES: POLES, NIVEAUX: NIVEAUX, BOITES: BOITES,
    dossierParId: dossierParId, cheminDossier: cheminDossier, accesEffectifs: accesEffectifs, enfants: enfants,
    peutDeplacer: peutDeplacer, ressourcesDe: ressourcesDe,
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
