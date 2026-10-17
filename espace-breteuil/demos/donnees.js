/*
 * Espace Breteuil — écrans de démo : données FICTIVES et calculs purs.
 *
 * Rôles et délégations, arrivées / départs / absences, boîtes mail, pack Finance,
 * double authentification. Tout est inventé (prénoms seulement) et reste sur
 * l'appareil (localStorage « eb:demos ») : rien ne part chez Microsoft.
 *
 * Utilisable dans le navigateur (window.EBDemos) et dans Node (tests).
 */
(function (racine) {
  "use strict";

  /* Prix indicatifs HT par personne et par mois, engagement annuel — à vérifier sur la vraie facture. */
  var FORMULES = {
    standard: { nom: "Formule Complète", produit: "Microsoft 365 Business Standard", prix: 11.7, emoji: "💼",
      texte: "Outlook, Teams, Word, Excel et PowerPoint sur l'ordinateur, et le stockage en ligne." },
    basic: { nom: "Formule Express + Teams", produit: "Microsoft 365 Business Basic", prix: 5.6, emoji: "✉️",
      texte: "Outlook, Teams et le stockage en ligne. Word et Excel dans le navigateur seulement." },
  };
  var ORDRE = ["standard", "basic"];

  var POLES = [
    { id: "Direction", emoji: "🏰" }, { id: "Finance", emoji: "💶" }, { id: "Accueil", emoji: "🛎️" },
    { id: "Restauration", emoji: "🍽️" }, { id: "Marketing", emoji: "📣" }, { id: "Jardins", emoji: "🌿" },
  ];

  /* Rôles : une phrase chacun. */
  var ROLES = [
    { id: "admin", nom: "Administrateur principal", emoji: "🔑",
      texte: "Peut tout régler : comptes, accès et rôles. Deux personnes au plus.", microsoft: "Administrateur général" },
    { id: "facturation", nom: "Facturation", emoji: "💶",
      texte: "Voit les factures, change le moyen de paiement et le nombre de licences.", microsoft: "Administrateur de facturation" },
    { id: "pole", nom: "Responsable de pôle", emoji: "🧭",
      texte: "Décide qui entre dans la boîte mail et le dossier de son pôle.", microsoft: "Propriétaire du groupe du pôle" },
    { id: "boite", nom: "Accès à une boîte partagée", emoji: "📬",
      texte: "Peut lire une boîte commune, comme contact@, depuis son propre Outlook.", microsoft: "Accès complet à la boîte" },
  ];

  var BOITES = [
    { id: "contact", nom: "Contact", adresse: "contact@breteuil.fr", emoji: "🏰", couleur: "#6B1524" },
    { id: "finance", nom: "Finance", adresse: "finance@breteuil.fr", emoji: "💶", couleur: "#1D6B52" },
    { id: "restauration", nom: "Restauration", adresse: "restauration@breteuil.fr", emoji: "🍽️", couleur: "#7A3E8E" },
    { id: "marketing", nom: "Marketing", adresse: "marketing@breteuil.fr", emoji: "📣", couleur: "#8A4B00" },
    { id: "jardins", nom: "Jardins", adresse: "jardins@breteuil.fr", emoji: "🌿", couleur: "#35601A" },
    { id: "intendance", nom: "Intendance", adresse: "intendance@breteuil.fr", emoji: "🧰", couleur: "#5E4E52" },
    { id: "hfb", nom: "HFB", adresse: "hfb@breteuil.fr", emoji: "🏛️", couleur: "#2E5A8A" },
    { id: "chanteclerc", nom: "Chanteclerc", adresse: "chanteclerc@breteuil.fr", emoji: "🐓", couleur: "#B5541B" },
  ];

  /* Dossiers du dossier commun proposés à l'arrivée (un par pôle + Événements). */
  var DOSSIERS = [
    { id: "Direction", emoji: "🏰" }, { id: "Finance", emoji: "💶" }, { id: "Accueil", emoji: "🛎️" },
    { id: "Restauration", emoji: "🍽️" }, { id: "Marketing", emoji: "📣" }, { id: "Jardins", emoji: "🌿" },
    { id: "Événements", emoji: "🎉" },
  ];

  var TYPES_ABSENCE = {
    conge: { nom: "Congés", emoji: "🌴", couleur: "#2E5A8A", lettre: "C" },
    absence: { nom: "Absence", emoji: "🚫", couleur: "#8C7E81", lettre: "A" },
    teletravail: { nom: "Télétravail", emoji: "🏠", couleur: "#1D6B52", lettre: "T" },
  };

  var ETATS_MFA = {
    appli: { nom: "Appli Authenticator", emoji: "✅", court: "Activée (appli)" },
    sms: { nom: "SMS", emoji: "📱", court: "Activée (SMS)" },
    aucune: { nom: "Pas encore", emoji: "⏳", court: "Pas encore" },
  };

  /* ------------------------------------------------------------------ */
  /* Dates (AAAA-MM-JJ, heure de Paris)                                  */
  /* ------------------------------------------------------------------ */
  function iso(d) { return d.toISOString().slice(0, 10); }
  function jourIso(date) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(date || new Date());
  }
  function ajouterJours(j, n) { var t = new Date(j + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return iso(t); }
  function lundi(j) { var t = new Date(j + "T12:00:00Z"); return ajouterJours(j, -((t.getUTCDay() + 6) % 7)); }
  function semaine(j) { var l = lundi(j), out = []; for (var i = 0; i < 7; i++) out.push(ajouterJours(l, i)); return out; }

  /* ------------------------------------------------------------------ */
  /* Données de départ                                                   */
  /* ------------------------------------------------------------------ */
  function base(aujourdhui) {
    var auj = aujourdhui || jourIso();
    var l = lundi(auj);
    function p(id, prenom, pole, poste, licence, couleur) {
      return { id: id, prenom: prenom, pole: pole, poste: poste, licence: licence, couleur: couleur,
        adresse: id.replace("-", ".") + "@breteuil.fr", parti: false };
    }
    var personnes = [
      p("francois", "François", "Direction", "Directeur", "basic", "#6B1524"),
      p("pauline", "Pauline", "Direction", "Directrice", "basic", "#8A2B3B"),
      p("valerie-d", "Valérie D.", "Finance", "Responsable administrative et financière", "standard", "#1D6B52"),
      p("guillaumette", "Guillaumette", "Marketing", "Chargée de communication", "standard", "#8A4B00"),
      p("fanny", "Fanny", "Accueil", "Chargée d'accueil", "standard", "#2E5A8A"),
      p("valerie-l", "Valérie L.", "Accueil", "Chargée d'accueil", "standard", "#3A6EA5"),
      p("yara", "Yara", "Restauration", "Responsable restauration", "standard", "#7A3E8E"),
      p("joao", "Joao", "Jardins", "Chef jardinier", "standard", "#35601A"),
      p("marco", "Marco", "Jardins", "Jardinier", "basic", "#3F6B1F"),
      p("erwin", "Erwin", "Jardins", "Jardinier", "basic", "#4A7A26"),
      p("antonio", "Antonio", "Jardins", "Jardinier", "basic", "#55862D"),
    ];
    var acces = {
      contact: { fanny: "envoyer", "valerie-l": "envoyer", pauline: "ouvrir", francois: "ouvrir" },
      finance: { "valerie-d": "envoyer", francois: "ouvrir" },
      restauration: { yara: "envoyer" },
      marketing: { guillaumette: "envoyer", pauline: "ouvrir" },
      jardins: { joao: "envoyer", marco: "ouvrir" },
      intendance: { pauline: "envoyer", joao: "ouvrir" },
      hfb: { pauline: "envoyer", francois: "envoyer" },
      chanteclerc: { francois: "envoyer", "valerie-d": "ouvrir" },
    };
    var montant = coutMensuel({ standard: 6, basic: 6 });
    var factures = [];
    for (var i = 0; i < 6; i++) {
      var t = new Date(Date.UTC(+auj.slice(0, 4), +auj.slice(5, 7) - 1 - i, 5));
      var date = iso(t);
      if (date > auj) continue;
      factures.push({ numero: "E0" + (2614 - i) + "7Q" + String(40 + i), date: date, ht: montant, tva: arrondi(montant * 0.2), ttc: arrondi(montant * 1.2), statut: "Payée" });
    }
    return {
      version: 1,
      personnes: personnes,
      licences: { standard: 6, basic: 6 },
      roles: {
        admin: ["francois"],
        facturation: ["valerie-d"],
        poles: { Direction: ["francois", "pauline"], Finance: ["valerie-d"], Accueil: ["fanny"], Restauration: ["yara"], Marketing: ["guillaumette"], Jardins: ["joao"] },
      },
      boites: BOITES.map(function (b) { return { id: b.id, nom: b.nom, adresse: b.adresse, emoji: b.emoji, couleur: b.couleur, photo: null, acces: acces[b.id] || {} }; }),
      delegations: { francois: { pauline: "ouvrir" } },
      absences: [
        { id: "a1", personne: "guillaumette", type: "conge", du: ajouterJours(l, 7), au: ajouterJours(l, 11) },
        { id: "a2", personne: "valerie-d", type: "teletravail", du: ajouterJours(l, 4), au: ajouterJours(l, 4) },
        { id: "a3", personne: "marco", type: "absence", du: ajouterJours(l, 1), au: ajouterJours(l, 2) },
        { id: "a4", personne: "yara", type: "conge", du: ajouterJours(l, 14), au: ajouterJours(l, 18) },
        { id: "a5", personne: "fanny", type: "teletravail", du: ajouterJours(l, 2), au: ajouterJours(l, 2) },
      ],
      mfa: {
        activee: false,
        etats: { francois: "appli", pauline: "aucune", "valerie-d": "appli", guillaumette: "sms", fanny: "aucune", "valerie-l": "aucune", yara: "appli", joao: "aucune", marco: "aucune", erwin: "aucune", antonio: "aucune" },
        rappels: {},
      },
      factures: factures,
      paiement: { mode: "carte", carte: "Carte Visa •••• 4242 — expire 09/2028", iban: "FR76 •••• •••• •••• 0189", destinataire: "finance@breteuil.fr" },
      historique: [
        { quand: ajouterJours(auj, -2) + "T10:05", qui: "François", action: "Rôle donné", detail: "Facturation → Valérie D." },
        { quand: ajouterJours(auj, -5) + "T16:40", qui: "Pauline", action: "Accès donné", detail: "Marco → boîte Jardins (lire)" },
        { quand: ajouterJours(auj, -9) + "T09:12", qui: "Valérie D.", action: "Licences", detail: "Formule Express + Teams : 5 → 6" },
      ],
    };
  }

  /* ------------------------------------------------------------------ */
  /* Calculs purs (testés)                                               */
  /* ------------------------------------------------------------------ */
  function arrondi(x) { return Math.round(x * 100) / 100; }
  function euros(x) {
    var s = arrondi(x).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return s + " €";
  }
  function coutMensuel(licences) {
    return arrondi(ORDRE.reduce(function (s, f) { return s + (licences[f] || 0) * FORMULES[f].prix; }, 0));
  }
  function actifs(personnes) { return (personnes || []).filter(function (p) { return !p.parti; }); }
  function utilisees(personnes) {
    var n = { standard: 0, basic: 0 };
    actifs(personnes).forEach(function (p) { if (n[p.licence] != null) n[p.licence]++; });
    return n;
  }
  function libres(etat, f) { return Math.max(0, (etat.licences[f] || 0) - utilisees(etat.personnes)[f]); }

  /** Ajouter (delta > 0) ou retirer (delta < 0) des licences : impact mois et an. */
  function simuler(licences, personnes, f, delta) {
    var nouv = Object.assign({}, licences);
    nouv[f] = Math.max(0, (nouv[f] || 0) + delta);
    var avant = coutMensuel(licences), apres = coutMensuel(nouv), u = utilisees(personnes)[f] || 0;
    return { licences: nouv, avant: avant, apres: apres, difference: arrondi(apres - avant),
      parAn: arrondi((apres - avant) * 12), annuelApres: arrondi(apres * 12), possible: nouv[f] >= u, utilisees: u };
  }

  function personne(etat, id) {
    for (var i = 0; i < etat.personnes.length; i++) if (etat.personnes[i].id === id) return etat.personnes[i];
    return null;
  }
  function boite(etat, id) {
    for (var i = 0; i < etat.boites.length; i++) if (etat.boites[i].id === id) return etat.boites[i];
    return null;
  }

  /** Titulaires d'un rôle. cible : nom de pôle ou id de boîte pour « pole » et « boite ». */
  function titulaires(etat, role, cible) {
    if (role === "pole") return (etat.roles.poles[cible] || []).slice();
    if (role === "boite") { var b = boite(etat, cible); return b ? Object.keys(b.acces) : []; }
    return (etat.roles[role] || []).slice();
  }
  /** Peut-on retirer ce rôle ? Renvoie null si oui, sinon la raison en clair. */
  function refusRetrait(etat, role, cible) {
    if (role === "admin" && titulaires(etat, "admin").length <= 1) return "Il faut toujours au moins un administrateur principal.";
    return null;
  }
  /** Avertissement avant de donner un rôle (null si rien à signaler). */
  function avertissementAjout(etat, role) {
    if (role === "admin" && titulaires(etat, "admin").length >= 2) return "Il y aura plus de deux administrateurs : Microsoft conseille d'en garder deux au plus.";
    return null;
  }
  function donnerRole(etat, role, cible, id) {
    if (role === "pole") { var l = etat.roles.poles[cible] = etat.roles.poles[cible] || []; if (l.indexOf(id) < 0) l.push(id); return; }
    if (role === "boite") { var b = boite(etat, cible); if (b && !b.acces[id]) b.acces[id] = "ouvrir"; return; }
    var r = etat.roles[role] = etat.roles[role] || []; if (r.indexOf(id) < 0) r.push(id);
  }
  function retirerRole(etat, role, cible, id) {
    if (role === "pole") { etat.roles.poles[cible] = (etat.roles.poles[cible] || []).filter(function (x) { return x !== id; }); return; }
    if (role === "boite") { var b = boite(etat, cible); if (b) delete b.acces[id]; return; }
    etat.roles[role] = (etat.roles[role] || []).filter(function (x) { return x !== id; });
  }

  /** Responsable d'un pôle (premier titulaire), sinon un administrateur. */
  function responsableDe(etat, pole, sauf) {
    var l = (etat.roles.poles[pole] || []).filter(function (x) { return x !== sauf; });
    if (l.length) return l[0];
    var a = (etat.roles.admin || []).filter(function (x) { return x !== sauf; });
    return a[0] || null;
  }

  /** Adresse proposée pour une arrivée : prénom sans accent, unique. */
  function adresseProposee(etat, prenom) {
    var b = String(prenom || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "") || "nouveau";
    var adr = b + "@breteuil.fr", n = 2;
    var prises = etat.personnes.map(function (p) { return p.adresse; }).concat(etat.boites.map(function (x) { return x.adresse; }));
    while (prises.indexOf(adr) > -1) adr = b + n++ + "@breteuil.fr";
    return adr;
  }
  /** Accès proposés à l'arrivée selon le pôle. */
  function accesParPole(pole) {
    var m = { Direction: ["contact", "hfb", "chanteclerc"], Finance: ["finance"], Accueil: ["contact"], Restauration: ["restauration"], Marketing: ["marketing"], Jardins: ["jardins"] };
    return { boites: m[pole] || [], dossiers: pole ? [pole, "Événements"] : ["Événements"] };
  }
  /** Coût d'une arrivée : 0 s'il reste une licence libre, sinon le prix d'une licence en plus. */
  function coutArrivee(etat, f) { return libres(etat, f) > 0 ? 0 : FORMULES[f].prix; }

  function enregistrerArrivee(etat, b) {
    var id = "n-" + adresseProposee(etat, b.prenom).split("@")[0];
    var achat = coutArrivee(etat, b.licence) > 0;
    if (achat) etat.licences[b.licence] = (etat.licences[b.licence] || 0) + 1;
    etat.personnes.push({ id: id, prenom: b.prenom, pole: b.pole, poste: b.poste || "", licence: b.licence, couleur: "#5E4E52", adresse: adresseProposee(etat, b.prenom), parti: false, nouveau: true });
    (b.boites || []).forEach(function (x) { var bo = boite(etat, x); if (bo) bo.acces[id] = "ouvrir"; });
    etat.mfa.etats[id] = "aucune";
    return { id: id, achat: achat };
  }

  /** Départ : bloque, transmet la boîte, libère la licence (selon les choix). */
  function enregistrerDepart(etat, id, choix) {
    var p = personne(etat, id); if (!p) return null;
    var economie = 0;
    p.parti = true;
    p.bloque = !!choix.bloquer;
    if (choix.transmettreA) { etat.delegations[id] = {}; etat.delegations[id][choix.transmettreA] = "ouvrir"; }
    etat.boites.forEach(function (b) { delete b.acces[id]; });
    etat.roles.facturation = etat.roles.facturation.filter(function (x) { return x !== id; });
    // Le dernier administrateur principal n'est jamais retiré automatiquement.
    if (etat.roles.admin.length > 1) etat.roles.admin = etat.roles.admin.filter(function (x) { return x !== id; });
    Object.keys(etat.roles.poles).forEach(function (k) { etat.roles.poles[k] = etat.roles.poles[k].filter(function (x) { return x !== id; }); });
    if (choix.libererLicence && p.licence) { economie = choix.rendreLicence ? FORMULES[p.licence].prix : 0; if (choix.rendreLicence) etat.licences[p.licence] = Math.max(0, etat.licences[p.licence] - 1); p.licenceAvant = p.licence; p.licence = null; }
    return { economie: economie };
  }

  /* Absences */
  function absenceDu(absences, id, j) {
    for (var i = 0; i < (absences || []).length; i++) { var a = absences[i]; if (a.personne === id && a.du <= j && j <= a.au) return a; }
    return null;
  }
  function ajouterAbsence(etat, a) {
    if (!a.personne || !TYPES_ABSENCE[a.type] || !a.du) return null;
    var au = a.au && a.au >= a.du ? a.au : a.du;
    var n = { id: "a" + Date.now().toString(36) + Math.floor(Math.random() * 1000), personne: a.personne, type: a.type, du: a.du, au: au };
    etat.absences.push(n);
    return n;
  }
  function nbJours(a) { return Math.round((Date.parse(a.au + "T12:00:00Z") - Date.parse(a.du + "T12:00:00Z")) / 86400000) + 1; }

  /* Double authentification */
  function statsMfa(etat) {
    var l = actifs(etat.personnes), ok = 0;
    l.forEach(function (p) { var e = etat.mfa.etats[p.id]; if (e === "appli" || e === "sms") ok++; });
    return { protegees: ok, total: l.length, pourcent: l.length ? Math.round(ok * 100 / l.length) : 0 };
  }

  /* ------------------------------------------------------------------ */
  /* Exemple de facture en PDF (texte simple, généré sur l'appareil)     */
  /* ------------------------------------------------------------------ */
  var CP1252 = { "€": 0x80, "’": 0x92, "–": 0x96, "—": 0x97, "•": 0x95, " ": 0x20, " ": 0x20 };
  function octets(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i), k = s.charCodeAt(i);
      if (CP1252[c] != null) out.push(CP1252[c]); else if (k < 256) out.push(k); else out.push(63);
    }
    return out;
  }
  function echapper(s) { return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"); }
  function moisFr(date) {
    return ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"][+date.slice(5, 7) - 1] + " " + date.slice(0, 4);
  }
  function dateFr(date) { return date.slice(8, 10) + "/" + date.slice(5, 7) + "/" + date.slice(0, 4); }
  function lignesFacture(f, licences) {
    var L = [
      [20, 760, "EXEMPLE - DOCUMENT FICTIF (démo Espace Breteuil)"],
      [16, 720, "Facture Microsoft 365 - " + moisFr(f.date)],
      [11, 696, "Numéro : " + f.numero + "     Date : " + dateFr(f.date)],
      [11, 680, "Client : Château de Breteuil (exemple)"],
      [11, 640, "Détail"],
    ];
    var y = 620;
    ORDRE.forEach(function (k) {
      var n = (licences && licences[k]) || 0;
      L.push([11, y, n + " x " + FORMULES[k].produit + " à " + euros(FORMULES[k].prix) + " = " + euros(n * FORMULES[k].prix) + " HT"]);
      y -= 18;
    });
    L.push([11, y - 10, "Total HT : " + euros(f.ht)]);
    L.push([11, y - 28, "TVA 20 % : " + euros(f.tva)]);
    L.push([13, y - 50, "Total TTC : " + euros(f.ttc) + "   (" + f.statut + ")"]);
    L.push([9, 90, "Ceci n'est pas une vraie facture. Les vraies factures sont dans le centre d'administration Microsoft."]);
    return L;
  }
  /** Renvoie un Uint8Array contenant un PDF d'une page. */
  function pdfFacture(f, licences) {
    var flux = "BT\n" + lignesFacture(f, licences).map(function (l) {
      return "/F1 " + l[0] + " Tf 1 0 0 1 56 " + l[1] + " Tm (" + echapper(l[2]) + ") Tj";
    }).join("\n") + "\nET";
    var corps = octets(flux);
    var objets = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      null,
    ];
    var sortie = octets("%PDF-1.4\n"), positions = [];
    objets.forEach(function (o, i) {
      positions.push(sortie.length);
      if (o) sortie = sortie.concat(octets((i + 1) + " 0 obj\n" + o + "\nendobj\n"));
      else sortie = sortie.concat(octets((i + 1) + " 0 obj\n<< /Length " + corps.length + " >>\nstream\n"), corps, octets("\nendstream\nendobj\n"));
    });
    var xref = sortie.length;
    var table = "xref\n0 " + (objets.length + 1) + "\n0000000000 65535 f \n" +
      positions.map(function (p) { return String(p).padStart(10, "0") + " 00000 n \n"; }).join("") +
      "trailer\n<< /Size " + (objets.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
    sortie = sortie.concat(octets(table));
    return new Uint8Array(sortie);
  }

  /* ------------------------------------------------------------------ */
  /* Stockage local                                                      */
  /* ------------------------------------------------------------------ */
  var CLE = "eb:demos";
  function charger() {
    try { var e = JSON.parse(localStorage.getItem(CLE) || "null"); if (e && e.version === 1 && Array.isArray(e.personnes)) return e; } catch (x) {}
    return base();
  }
  function sauver(etat) { try { localStorage.setItem(CLE, JSON.stringify(etat)); return true; } catch (x) { return false; } }
  function effacer() { try { localStorage.removeItem(CLE); } catch (x) {} }
  function journal(etat, qui, action, detail) {
    var m = new Date();
    var quand = jourIso(m) + "T" + new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).format(m);
    etat.historique.unshift({ quand: quand, qui: qui || "Démo", action: action, detail: detail || "" });
    if (etat.historique.length > 200) etat.historique.length = 200;
  }

  var api = {
    FORMULES: FORMULES, ORDRE: ORDRE, POLES: POLES, ROLES: ROLES, BOITES: BOITES, DOSSIERS: DOSSIERS,
    TYPES_ABSENCE: TYPES_ABSENCE, ETATS_MFA: ETATS_MFA,
    base: base, charger: charger, sauver: sauver, effacer: effacer, journal: journal,
    arrondi: arrondi, euros: euros, coutMensuel: coutMensuel, utilisees: utilisees, libres: libres, simuler: simuler, actifs: actifs,
    personne: personne, boite: boite, titulaires: titulaires, refusRetrait: refusRetrait, avertissementAjout: avertissementAjout,
    donnerRole: donnerRole, retirerRole: retirerRole, responsableDe: responsableDe,
    adresseProposee: adresseProposee, accesParPole: accesParPole, coutArrivee: coutArrivee, enregistrerArrivee: enregistrerArrivee,
    enregistrerDepart: enregistrerDepart, absenceDu: absenceDu, ajouterAbsence: ajouterAbsence, nbJours: nbJours, statsMfa: statsMfa,
    pdfFacture: pdfFacture, moisFr: moisFr, dateFr: dateFr,
    jourIso: jourIso, ajouterJours: ajouterJours, lundi: lundi, semaine: semaine,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.EBDemos = api;
})(typeof self !== "undefined" ? self : this);
