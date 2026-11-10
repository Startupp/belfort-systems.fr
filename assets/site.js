/* Damien Belfort — site public : prix depuis le catalogue, simulateur, contact, calendrier.
   Sans dépendance. Lit window.BS_API et window.BS_CONTACT_API (assets/config.js). Jamais d'innerHTML avec une donnée externe. */
(function () {
  "use strict";

  var API = (typeof window.BS_API === "string" && window.BS_API) ? window.BS_API.replace(/\/+$/, "") : "";
  // Formulaire de contact : Worker séparé (assets/config.js, BS_CONTACT_API). Sans valeur : repli mailto.
  var CONTACT_API = (typeof window.BS_CONTACT_API === "string" && window.BS_CONTACT_API) ? window.BS_CONTACT_API.replace(/\/+$/, "") : "";
  var MAIL = "damien@belfort-systems.fr";
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var el = function (tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "class") n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  };
  // 45 -> « 45 », 22.5 -> « 22,50 » (virgule française, deux décimales seulement si nécessaire)
  var nombre = function (n) { return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(".", ","); };
  var euro = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " €"; };

  /* ------------------------------------------------------------------
     1. Catalogue : seule source des prix
     ------------------------------------------------------------------ */
  var catalogue = null; // rempli depuis assets/catalogue.json

  function forfait(id) { return ((catalogue && catalogue.forfaits_mensuels) || []).filter(function (f) { return f.id === id; })[0]; }
  // Toutes les prestations, toutes sections confondues : entreprises, particuliers, renfort IT.
  function toutesPrestations() {
    if (!catalogue) return [];
    return (catalogue.prestations || [])
      .concat((catalogue.particuliers && catalogue.particuliers.prestations) || [])
      .concat((catalogue.renfort_it && catalogue.renfort_it.prestations) || []);
  }
  function prestation(id) { return toutesPrestations().filter(function (p) { return p.id === id; })[0]; }

  /* Clés data-prix : <id> (prix d'une prestation, quelle que soit la section), <id>.supplement,
     <id>.mensuel | .au_lieu_de | .puis_demi_heure, forfait.<id>, forfait.<id>.par_utilisateur,
     forfait.<id>.utilisateurs_inclus, heure_supplementaire, site. */
  function prixDepuisCatalogue(cle) {
    if (!catalogue) return null;
    var m;
    if (cle === "heure_supplementaire") return catalogue.heure_supplementaire;
    if (cle === "site") return catalogue.site_web && catalogue.site_web.prix;
    if ((m = /^forfait\.([^.]+)(?:\.([a-z_]+))?$/.exec(cle))) {
      var f = forfait(m[1]);
      return f ? (m[2] ? f[m[2]] : f.prix) : null;
    }
    if ((m = /^(.+)\.supplement$/.exec(cle))) {
      var p = prestation(m[1]);
      return p && p.supplement ? p.supplement.prix : null;
    }
    if ((m = /^(.+)\.(mensuel|au_lieu_de|puis_demi_heure)$/.exec(cle))) {
      var r = prestation(m[1]);
      return r ? r[m[2]] : null;
    }
    var q = prestation(cle);
    return q ? q.prix : null;
  }

  // Prix d'un suivi mensuel pour n utilisateurs : prix de base jusqu'à utilisateurs_inclus, puis par utilisateur.
  function prixSuivi(f, n) {
    var inclus = f.utilisateurs_inclus || 0, par = f.par_utilisateur || 0;
    return f.prix + (inclus && par ? Math.max(0, n - inclus) * par : 0);
  }
  function libelleSuivi(f) {
    return f.nom + " (" + f.prix + " € HT / mois" +
      (f.utilisateurs_inclus && f.par_utilisateur ? " jusqu'à " + f.utilisateurs_inclus + " utilisateurs, puis " + f.par_utilisateur + " € par utilisateur" : "") + ")";
  }

  function appliquerPrix() {
    $$("[data-prix]").forEach(function (node) {
      var v = prixDepuisCatalogue(node.getAttribute("data-prix"));
      if (typeof v === "number") node.textContent = nombre(v);
    });
    // Boutons « Choisir » des suivis : le libellé envoyé reprend le prix du catalogue
    $$("[data-choisir]").forEach(function (a) {
      var plan = a.closest("[data-forfait]");
      if (!plan) return;
      var id = plan.getAttribute("data-forfait");
      if (id === "site") {
        var ps = prixDepuisCatalogue("site");
        if (typeof ps === "number") a.setAttribute("data-choisir", "Option site WordPress (+" + ps + " € HT / mois)");
        return;
      }
      var f = forfait(id);
      if (f) a.setAttribute("data-choisir", libelleSuivi(f));
    });
  }

  function catalogueDeSecours() {
    // Si le JSON ne se charge pas, on reconstruit le minimum depuis les valeurs déjà présentes dans la page.
    var lire = function (cle, defaut) { var n = $('[data-prix="' + cle + '"]'); var v = n ? parseFloat(n.textContent.replace(",", ".")) : NaN; return isNaN(v) ? defaut : v; };
    return {
      taux_horaire: 50,
      heure_supplementaire: lire("heure_supplementaire", 45),
      prestations: [
        { id: "distance", nom: "Dépannage à distance", unite: "demi-heure", prix: lire("distance", 25) },
        { id: "heure", nom: "Intervention sur place (première heure)", unite: "heure", prix: lire("heure", 60) },
        { id: "tranche", nom: "Demi-heure supplémentaire", unite: "demi-heure", prix: lire("tranche", 25) },
        { id: "migration", nom: "Migration Microsoft 365", unite: "forfait", prix: lire("migration", 590), inclus: "jusqu'à 5 boîtes", supplement: { nom: "boîte supplémentaire", prix: lire("migration.supplement", 70) } },
        { id: "audit", nom: "Audit informatique", unite: "forfait", prix: lire("audit", 390) },
        { id: "audit_abonnements", nom: "Audit des abonnements et contrats", unite: "forfait", prix: lire("audit_abonnements", 290) }
      ],
      forfaits_mensuels: [
        { id: "essentiel", nom: "Suivi Essentiel", prix: lire("forfait.essentiel", 149), utilisateurs_inclus: 5, par_utilisateur: lire("forfait.essentiel.par_utilisateur", 15), heures: 2, assistance: "2 h d'assistance par mois", delai: "réponse le jour ouvré suivant" },
        { id: "serenite", nom: "Suivi Sérénité", prix: lire("forfait.serenite", 249), utilisateurs_inclus: 5, par_utilisateur: lire("forfait.serenite.par_utilisateur", 25), heures: 5, assistance: "5 h d'assistance par mois", delai: "réponse dans la journée" }
      ],
      site_web: { id: "site", nom: "Option site WordPress", prix: lire("site", 120), unite: "mois" }
    };
  }

  function chargerCatalogue() {
    return fetch("/assets/catalogue.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("catalogue " + r.status); return r.json(); })
      .then(function (json) { catalogue = json; appliquerPrix(); })
      .catch(function () { catalogue = catalogueDeSecours(); });
  }

  /* ------------------------------------------------------------------
     2. Simulateur de formule (page Entreprises)
     ------------------------------------------------------------------ */
  var POSTES = { "1-3": [1, 3], "4-10": [4, 10], "11-30": [11, 30] }; // nombre de postes ≈ nombre d'utilisateurs

  function recommander(r) {
    // r = {postes, messagerie, site, frequence}
    var reco = { type: "forfait", forfait: null, mensuelMin: 0, mensuelMax: 0, ponctuel: 0, parUtilisateur: null, lignes: [], texte: "", titre: "", formule: "" };
    var ess = forfait("essentiel"), seren = forfait("serenite");
    var distance = prestation("distance"), heure = prestation("heure"), tranche = prestation("tranche");
    var migration = prestation("migration"), siteWeb = catalogue.site_web;
    var bornes = POSTES[r.postes] || POSTES["1-3"];

    // Deux formules : Essentiel (gestion Microsoft 365, assistance à distance) ou Sérénité (suivi des postes, présence sur site)
    if (r.frequence === "rarement") {
      reco.type = "ponctuel";
    } else if (r.frequence === "mois") {
      reco.forfait = r.postes === "11-30" ? seren : ess;
    } else { // chaque semaine
      reco.forfait = r.postes === "1-3" ? ess : seren;
    }

    if (reco.type === "ponctuel") {
      reco.titre = "Des interventions à la demande";
      reco.lignes.push("À distance : " + nombre(distance.prix) + " € HT la demi-heure, 30 minutes minimum");
      reco.lignes.push("Sur place : " + nombre(heure.prix) + " € HT la première heure, déplacement compris jusqu'à 30 km, puis " + nombre(tranche.prix) + " € HT la demi-heure");
      reco.texte = "Vous avez rarement besoin d'aide : pas de formule mensuelle, vous m'appelez quand il le faut et vous payez l'intervention. ";
      reco.formule = "Interventions à la demande (" + nombre(distance.prix) + " € HT la demi-heure à distance, " + nombre(heure.prix) + " € HT la première heure sur place)";
      if (r.site === "vivre") {
        reco.mensuelMin += siteWeb.prix; reco.mensuelMax += siteWeb.prix;
        reco.lignes.push("Option site WordPress : " + siteWeb.prix + " € HT par mois");
        reco.texte += "Votre site, lui, a besoin d'un suivi régulier (mises à jour, sauvegardes) : je propose l'option site WordPress. ";
        reco.formule += " + option site WordPress (" + siteWeb.prix + " € HT / mois)";
      }
    } else {
      var f = reco.forfait;
      var min = prixSuivi(f, bornes[0]), max = prixSuivi(f, bornes[1]);
      reco.titre = f.nom;
      reco.mensuelMin = min; reco.mensuelMax = max;
      reco.lignes.push(f.prix + " € HT par mois jusqu'à " + f.utilisateurs_inclus + " utilisateurs, puis " + f.par_utilisateur + " € HT par utilisateur");
      if (max > min) reco.lignes.push("De " + bornes[0] + " à " + bornes[1] + " utilisateurs : " + euro(min).replace(" €", "") + " à " + euro(max) + " HT par mois");
      if (r.postes === "11-30") reco.parUtilisateur = [Math.round(max / bornes[1]), Math.round(min / bornes[0])];
      reco.lignes.push((f.assistance || (f.heures + " h d'assistance par mois")) + ", " + f.delai);
      reco.formule = libelleSuivi(f) + ", " + bornes[0] + " à " + bornes[1] + " postes";
      if (f.id === "essentiel") reco.texte = "Le Suivi Essentiel prend en charge votre Microsoft 365 (arrivées et départs, licences, droits, boîtes partagées) et vérifie chaque mois la sécurité, la sauvegarde et les licences, avec un compte rendu. ";
      if (f.id === "serenite") reco.texte = "Avec cette taille d'équipe et ce rythme, le Suivi Sérénité ajoute le suivi des postes, l'application Espace Client, une revue des licences tous les 6 mois et une réponse dans la journée. ";
      reco.texte += "Le prix suit le nombre d'utilisateurs. ";
      if (r.site === "vivre") {
        reco.mensuelMin += siteWeb.prix; reco.mensuelMax += siteWeb.prix;
        reco.lignes.push("Option site WordPress : " + siteWeb.prix + " € HT par mois");
        reco.texte += "J'ajoute l'option site WordPress (mises à jour, sauvegardes, petites modifications). ";
        reco.formule += " + option site WordPress (" + siteWeb.prix + " € HT / mois)";
      }
      reco.texte += "Au-delà des heures incluses, l'heure supplémentaire est à " + catalogue.heure_supplementaire + " € HT ; les heures non utilisées ne sont pas reportées. ";
    }

    // Messagerie
    if (r.messagerie === "migrer") {
      var boites = r.postes === "11-30" ? 15 : r.postes === "4-10" ? 7 : 2;
      var sup = migration.supplement ? migration.supplement.prix : 0;
      var inclusBoites = parseInt((migration.inclus || "").replace(/\D/g, ""), 10) || 5;
      var prixMig = migration.prix + Math.max(0, boites - inclusBoites) * sup;
      reco.ponctuel += prixMig;
      reco.lignes.push("Migration Microsoft 365, une fois : " + (boites > inclusBoites ? "à partir de " : "") + euro(prixMig) + " HT (" + migration.inclus + (boites > inclusBoites ? ", puis " + sup + " € HT la boîte" : "") + ")");
      reco.texte += "Pour commencer, je migre votre messagerie vers Microsoft 365 sans coupure : inventaire, plan de bascule, vérification avec chaque personne. ";
      reco.formule += " + migration Microsoft 365 (" + euro(prixMig) + " HT, une fois)";
      if (reco.type === "ponctuel") reco.texte += "Après la migration, le Suivi Essentiel (" + ess.prix + " € HT par mois jusqu'à " + ess.utilisateurs_inclus + " utilisateurs) est une bonne suite si vous voulez rester accompagné. ";
    } else if (r.messagerie === "m365") {
      reco.texte += "Votre messagerie est déjà sur Microsoft 365 : je peux en reprendre la gestion (comptes, licences, partages) dans la formule. ";
    } else {
      reco.texte += "Votre messagerie actuelle vous convient : je la garde telle quelle. ";
    }
    reco.lignes.push("Pour commencer : un Bilan express gratuit de 30 minutes, sur place ou en visio");
    return reco;
  }

  function afficherReco(reco) {
    var box = $("#sim-result");
    if (!box) return;
    while (box.firstChild) box.removeChild(box.firstChild);
    box.appendChild(el("span", { class: "kicker", text: "Ma recommandation" }));
    box.appendChild(el("h3", { text: reco.titre }));
    var amount = el("div", { class: "amount" });
    if (reco.mensuelMax > 0) {
      var txt = reco.mensuelMin === reco.mensuelMax ? euro(reco.mensuelMin) : euro(reco.mensuelMin).replace(" €", "") + " à " + euro(reco.mensuelMax);
      amount.appendChild(document.createTextNode(txt + " HT "));
      amount.appendChild(el("small", { text: "/ mois" }));
      if (reco.parUtilisateur) {
        amount.appendChild(el("br"));
        amount.appendChild(el("small", { text: "soit environ " + reco.parUtilisateur[0] + " à " + reco.parUtilisateur[1] + " € HT par utilisateur et par mois" }));
      }
      if (reco.ponctuel > 0) {
        amount.appendChild(el("br"));
        amount.appendChild(el("small", { text: "+ " + euro(reco.ponctuel) + " HT une fois (migration)" }));
      }
    } else if (reco.ponctuel > 0) {
      amount.appendChild(document.createTextNode("à partir de " + euro(reco.ponctuel) + " HT "));
      amount.appendChild(el("small", { text: "une fois, puis à la demande" }));
    } else {
      amount.appendChild(document.createTextNode(nombre(prestation("distance").prix) + " € HT "));
      amount.appendChild(el("small", { text: "la demi-heure à distance" }));
    }
    box.appendChild(amount);
    box.appendChild(el("p", { text: reco.texte.trim() }));
    box.appendChild(el("ul", null, reco.lignes.map(function (l) { return el("li", { text: l }); })));
    var btn = el("button", { type: "button", class: "btn light", text: "Recevoir cette estimation par e-mail" });
    btn.addEventListener("click", function () { preRemplirContact(reco); });
    box.appendChild(btn);
    box.appendChild(el("p", { class: "legal", text: "Estimation, hors taxes, prix à confirmer sur devis." }));
  }

  // Ne choisit le sujet que s'il existe dans la liste de la page (chaque parcours a ses propres sujets).
  function choisirSujet(valeur) {
    var select = $("#c-sujet");
    if (!select || !valeur) return;
    var existe = Array.prototype.some.call(select.options, function (o) { return o.value === valeur; });
    if (existe) select.value = valeur;
  }

  function preRemplirContact(reco) {
    var formule = $("#c-formule"), message = $("#c-message");
    if (formule) formule.value = reco.formule;
    choisirSujet(reco.type === "ponctuel" ? "Entreprise — dépannage ou assistance" : "Entreprise — suivi mensuel");
    if (message && (!message.value.trim() || estUnModele(message.value))) {
      message.value = "Bonjour,\nle simulateur me propose : " + reco.formule + ".\nPouvez-vous me confirmer cette estimation ?\n\nMa structure : ";
    }
    var contact = $("#contact");
    if (contact) contact.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(function () { var n = $("#c-nom"); if (n) n.focus({ preventScroll: true }); }, 500);
  }

  /* Liens directs vers une offre (fiche Google, carte de visite, mails) : /offre/<id> (scripts/site/_redirects)
     mène à <page>?offre=<id>#contact, qui pré-remplit le formulaire. Les boutons [data-offre] font de même
     sans recharger la page. page = parcours où vit l'offre ; sujet = une valeur de la liste de cette page
     (le profil y figure : Entreprise, Particulier, Équipe IT). */
  var OFFRES = {
    // Entreprises
    "bilan": { page: "/", sujet: "Entreprise — Bilan express gratuit", formule: "Bilan express (gratuit, 30 minutes, compte rendu d'une page)", calendrier: true,
      message: "Bonjour,\nje souhaite un Bilan express gratuit de 30 minutes, sur place ou en visio.\n\nMa structure, le nombre de postes et la commune : " },
    "audit-informatique": { page: "/", sujet: "Entreprise — audit", formule: "Audit informatique (390 € HT, déduit si une migration ou un suivi est signé dans les 3 mois)",
      message: "Bonjour,\nje souhaite un audit informatique de ma structure (parc, accès, licences, sauvegardes).\n\nMa structure et le nombre de postes : " },
    "audit-abonnements": { page: "/", sujet: "Entreprise — audit", formule: "Audit des abonnements et contrats (290 € HT, remboursé si moins de 290 € d'économies par an)",
      message: "Bonjour,\nje souhaite un audit de mes abonnements informatiques (internet, téléphonie, logiciels, licences) pour repérer les doublons.\n\nMa structure : " },
    "preparation-poste": { page: "/", sujet: "Entreprise — nouveau poste ou matériel", formule: "Préparation d'un poste (175 € HT par poste)",
      message: "Bonjour,\nj'ai un ou plusieurs postes à préparer (installation, comptes, Office, transfert des données).\n\nNombre de postes et date souhaitée : " },
    "migration-365": { page: "/", sujet: "Entreprise — migration Microsoft 365", formule: "Migration Microsoft 365 (590 € HT jusqu'à 5 boîtes, puis 70 € par boîte)",
      message: "Bonjour,\nje souhaite migrer ma messagerie vers Microsoft 365 sans coupure.\n\nNombre de boîtes et messagerie actuelle : " },
    "suivi": { page: "/", sujet: "Entreprise — suivi mensuel", formule: "Suivi mensuel (Essentiel 149 € ou Sérénité 249 € HT / mois jusqu'à 5 utilisateurs, puis 15 € ou 25 € par utilisateur)",
      message: "Bonjour,\nje cherche un suivi informatique mensuel pour ma structure.\n\nNombre d'utilisateurs et besoins : " },
    "rendez-vous": { page: "/", sujet: "Entreprise — dépannage ou assistance", formule: "Premier échange ou intervention à distance (créneau à choisir)", calendrier: true,
      message: "Bonjour,\nje souhaite réserver un créneau pour un premier échange ou une intervention à distance.\n\nLe sujet : " },
    // Particuliers
    "distance": { page: "/particuliers/", sujet: "Particulier — aide à distance", formule: "Aide à distance (25 € la demi-heure, résolu ou gratuit)",
      message: "Bonjour,\nj'ai besoin d'une aide à distance.\n\nCe qui ne marche pas, et depuis quand : " },
    "domicile": { page: "/particuliers/", sujet: "Particulier — intervention à domicile", formule: "Intervention à domicile (60 € la première heure, déplacement compris, puis 25 € la demi-heure)",
      message: "Bonjour,\nj'aimerais que vous passiez chez moi.\n\nCe qui ne marche pas, et ma commune : " },
    "ordinateur": { page: "/particuliers/", sujet: "Particulier — nouvel ordinateur", formule: "Nouvel ordinateur prêt à l'emploi (119 €)",
      message: "Bonjour,\nj'ai un nouvel ordinateur à mettre en route.\n\nL'ancien ordinateur (s'il y en a un) et ma commune : " },
    "wifi": { page: "/particuliers/", sujet: "Particulier — Wi-Fi, box ou imprimante", formule: "Wi-Fi, box et imprimante (89 €)",
      message: "Bonjour,\nj'ai un souci de Wi-Fi, de box ou d'imprimante.\n\nCe qui ne marche pas, et ma commune : " },
    "securite": { page: "/particuliers/", sujet: "Particulier — bilan sécurité du foyer", formule: "Bilan sécurité du foyer (89 €, 1 h 30)",
      message: "Bonjour,\nje souhaite un bilan sécurité pour mon foyer (mots de passe, sauvegarde des photos, arnaques).\n\nMa commune : " },
    "carte": { page: "/particuliers/", sujet: "Particulier — carte 5 aides", formule: "Carte 5 aides à distance (99 €, valable 12 mois)",
      message: "Bonjour,\nje souhaite une carte 5 aides à distance.\n\nPour moi ou à offrir (à qui) : " },
    // Renfort IT
    "renfort": { page: "/renfort-it/", sujet: "Équipe IT — renfort à distance", formule: "Renfort à distance N1/N2 (300 € HT la journée, 160 € HT la demi-journée)",
      message: "Bonjour,\nnous cherchons un renfort N1/N2 à distance.\n\nSociété :\nBesoin :\nVolume (tickets par jour ou jours par mois) :\nDate de début :\nOutil de tickets : " },
    "mission": { page: "/renfort-it/", sujet: "Équipe IT — mission à livrable", formule: "Mission à livrable (prix fixe, à partir de 600 € HT, cadrage gratuit de 30 minutes)",
      message: "Bonjour,\nnous avons une tâche précise à confier.\n\nSociété :\nLa tâche :\nÉchéance souhaitée :\nOutils concernés : " },
    "dossier": { page: "/renfort-it/", sujet: "Équipe IT — dossier fournisseur", formule: "Dossier fournisseur (gratuit, sous 24 h)",
      message: "Bonjour,\npouvez-vous m'envoyer votre dossier fournisseur ?\n\nSociété et service acheteur : " }
  };

  // Un message pré-rempli par une offre (ou par le simulateur) peut être remplacé ; un message tapé, jamais.
  function estUnModele(texte) {
    var t = String(texte || "").trim();
    if (/^Bonjour,\nle simulateur me propose : /.test(t)) return true;
    return Object.keys(OFFRES).some(function (k) { return OFFRES[k].message.trim() === t; });
  }

  function appliquerOffre(id) {
    var o = id && OFFRES[id];
    if (!o) return null;
    var formule = $("#c-formule"), message = $("#c-message");
    if (formule) formule.value = o.formule;
    choisirSujet(o.sujet);
    if (message && (!message.value.trim() || estUnModele(message.value))) message.value = o.message;
    if (o.calendrier) { var ouvrir = $("#cal-open"); if (ouvrir) setTimeout(function () { ouvrir.click(); }, 400); }
    return o;
  }

  function initLienOffre() {
    var id;
    try { id = new URLSearchParams(window.location.search).get("offre"); } catch (e) { return; }
    var o = id && OFFRES[id];
    if (!o) return;
    // Offre d'un autre parcours (ex. /?offre=domicile) : on va sur la bonne page.
    var ici = window.location.pathname.replace(/index\.html$/, "");
    if (o.page && ici !== o.page) { window.location.replace(o.page + window.location.search + (window.location.hash || "#contact")); return; }
    appliquerOffre(id);
    var cible = (o.calendrier && $("#calendrier")) || $("#contact");
    if (cible) setTimeout(function () { cible.scrollIntoView({ behavior: "smooth", block: "start" }); }, 150);
  }

  /* Boutons [data-offre] (« Bilan gratuit », « Demander une disponibilité »…) : pré-remplissent le formulaire,
     puis le lien mène au formulaire comme d'habitude. */
  function initBoutonsOffre() {
    $$("[data-offre]").forEach(function (a) {
      a.addEventListener("click", function () { appliquerOffre(a.getAttribute("data-offre")); });
    });
  }

  function initSimulateur() {
    var form = $("#sim");
    if (!form) return;
    var lire = function () {
      var r = {};
      ["postes", "messagerie", "site", "frequence"].forEach(function (k) {
        var c = form.querySelector('input[name="' + k + '"]:checked');
        r[k] = c ? c.value : null;
      });
      return r;
    };
    form.addEventListener("change", function () {
      var r = lire();
      if (!catalogue) return;
      if (r.postes && r.messagerie && r.site && r.frequence) afficherReco(recommander(r));
    });
    form.addEventListener("submit", function (e) { e.preventDefault(); });
  }

  /* Boutons « Choisir » des formules */
  function initChoisir() {
    $$("[data-choisir]").forEach(function (a) {
      a.addEventListener("click", function () {
        var formule = $("#c-formule");
        if (formule) formule.value = a.getAttribute("data-choisir");
        choisirSujet(/site WordPress/i.test(a.getAttribute("data-choisir")) ? "Entreprise — site web" : "Entreprise — suivi mensuel");
      });
    });
  }

  /* ------------------------------------------------------------------
     3. Formulaire de contact : POST BS_CONTACT_API/contact, repli mailto
     ------------------------------------------------------------------ */
  function initContact() {
    var form = $("#contact-form");
    if (!form) return;
    var status = $("#c-status"), submit = $("#c-submit"), t = $("#c-t");
    if (t) t.value = String(Date.now());

    var vider = function () { while (status.firstChild) status.removeChild(status.firstChild); };
    var montrer = function (classe, lignes, bouton, mascotte) {
      vider();
      var box = el("div", { class: "msg " + classe });
      if (mascotte) {
        box.appendChild(el("div", { class: "mascotte", "aria-hidden": "true" }, [
          el("img", { src: "/assets/mascotte/mascotte-" + mascotte + ".webp", width: "512", height: "512", alt: "", decoding: "async" })
        ]));
      }
      var texte = el("div");
      lignes.forEach(function (l) { texte.appendChild(el("p", { text: l })); });
      box.appendChild(texte);
      if (bouton) box.appendChild(bouton);
      status.appendChild(box);
    };

    var donnees = function () {
      var d = {};
      ["nom", "email", "tel", "sujet", "formule", "message", "website", "t", "creneau"].forEach(function (k) {
        var f = form.elements[k];
        d[k] = f ? String(f.value || "").trim() : "";
      });
      return d;
    };

    var lienMailto = function (d) {
      var sujet = "Demande — " + (d.sujet || "contact") + (d.formule ? " — " + d.formule : "");
      var corps = "Nom : " + d.nom + "\nE-mail : " + d.email + (d.tel ? "\nTéléphone : " + d.tel : "") +
        (d.formule ? "\nFormule envisagée : " + d.formule : "") + (d.creneau ? "\nCréneau souhaité : " + d.creneau : "") +
        "\n\n" + d.message;
      return "mailto:" + MAIL + "?subject=" + encodeURIComponent(sujet) + "&body=" + encodeURIComponent(corps);
    };

    var valider = function (d) {
      var erreurs = [];
      if (!d.nom) erreurs.push("votre nom");
      if (!d.email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) erreurs.push("une adresse e-mail valide");
      if (!d.sujet) erreurs.push("le sujet");
      if (!d.message || d.message.length < 10) erreurs.push("un message d'au moins quelques mots");
      return erreurs;
    };

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var d = donnees();
      var erreurs = valider(d);
      if (erreurs.length) {
        montrer("err", ["Il manque " + erreurs.join(", ") + "."]);
        var premier = !d.nom ? "c-nom" : (!d.email || erreurs[0] === "une adresse e-mail valide") ? "c-email" : !d.sujet ? "c-sujet" : "c-message";
        var champ = document.getElementById(premier); if (champ) champ.focus();
        return;
      }
      if (d.website) { montrer("ok", ["Merci, votre message est bien parti."]); form.reset(); return; } // robot : on ne dit rien
      submit.disabled = true;
      montrer("warn", ["Envoi en cours…"]);

      var repli = function () {
        var a = el("a", { class: "btn primary", href: lienMailto(d), text: "Envoyer par e-mail à la place" });
        montrer("warn", ["Le service est momentanément indisponible.", "Votre message n'est pas perdu : le bouton ci-dessous ouvre votre messagerie avec tout ce que vous avez saisi. Vous pouvez aussi m'écrire sur WhatsApp depuis le bouton « M'écrire directement »."], a);
        submit.disabled = false;
      };

      if (!CONTACT_API || !window.fetch) { repli(); return; }
      var ctrl = typeof AbortController === "function" ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 10000) : null;
      fetch(CONTACT_API + "/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(d),
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (json) {
          if (r.ok && json && json.ok) {
            montrer("ok", ["Merci " + d.nom + ", votre demande est bien envoyée. Je vous réponds sous 24 h ouvrées" + (d.creneau ? " et je vous confirme le créneau du " + d.creneau : "") + "."], null, "pouce");
            form.reset();
            if (t) t.value = String(Date.now());
            var cc = $("#c-creneau"); if (cc) cc.value = "";
            $$(".slot[aria-pressed='true']").forEach(function (s) { s.setAttribute("aria-pressed", "false"); });
            var cf = $("#cal-choix"); if (cf) cf.textContent = "";
            submit.disabled = false;
          } else if (r.status === 400 || r.status === 422 || r.status === 429) {
            montrer("err", [(json && (json.error || json.erreur)) || "Le message n'a pas pu être pris en compte. Vérifiez les champs et réessayez dans un instant."]);
            submit.disabled = false;
          } else {
            repli();
          }
        });
      }).catch(repli).then(function () { if (timer) clearTimeout(timer); });
    });
  }

  /* ------------------------------------------------------------------
     4. Calendrier : BS_API/disponibilites?semaine=AAAA-WW
     ------------------------------------------------------------------ */
  var JOURS = ["lun.", "mar.", "mer.", "jeu.", "ven."];
  var MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  var HEURES = [9, 10, 11, 14, 15, 16, 17];

  function lundiDe(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var j = (d.getDay() + 6) % 7; // 0 = lundi
    d.setDate(d.getDate() - j);
    return d;
  }
  function semaineISO(lundi) {
    var d = new Date(Date.UTC(lundi.getFullYear(), lundi.getMonth(), lundi.getDate()));
    var jour = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - jour);
    var debut = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var n = Math.ceil(((d - debut) / 86400000 + 1) / 7);
    return d.getUTCFullYear() + "-" + (n < 10 ? "0" : "") + n;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function cleISO(d, h) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(h) + ":00"; }
  function libelle(d, h) { return JOURS[(d.getDay() + 6) % 7] + " " + d.getDate() + " " + MOIS[d.getMonth()] + " " + d.getFullYear() + " à " + h + " h"; }

  /* Accepte plusieurs formes de réponse : {creneaux:[{debut}]} | {creneaux:["2026-10-13T09:00"]} | {jours:[{date, creneaux:["09:00"]}]} | [..] */
  function extraireLibres(json) {
    var libres = {};
    var ajouter = function (s) { if (typeof s === "string" && s.length >= 16) libres[s.slice(0, 16)] = true; };
    var liste = Array.isArray(json) ? json : (json && (json.creneaux || json.disponibilites || json.libres)) || null;
    if (Array.isArray(liste)) {
      liste.forEach(function (c) { ajouter(typeof c === "string" ? c : c && (c.debut || c.start || c.date)); });
    } else if (json && Array.isArray(json.jours)) {
      json.jours.forEach(function (j) {
        (j.creneaux || j.heures || []).forEach(function (h) { ajouter(typeof h === "string" && h.length <= 5 ? j.date + "T" + h : h); });
      });
    }
    return libres;
  }

  function initCalendrier() {
    var zone = $("#cal-body"), ouvrir = $("#cal-open"), champ = $("#c-creneau"), message = $("#c-message");
    if (!zone || !ouvrir) return;
    var lundi = lundiDe(new Date());
    var aujourdhui = new Date();
    var choix = champ ? champ.value : "";
    var cache = {};

    var vider = function () { while (zone.firstChild) zone.removeChild(zone.firstChild); };

    var repli = function () {
      vider();
      zone.appendChild(el("div", { class: "cal-fallback", text: "Le calendrier n'est pas disponible pour le moment. Proposez vos disponibilités dans le message : je vous confirme un créneau par retour." }));
      if (message && !/disponibilit/i.test(message.value)) {
        message.value = (message.value ? message.value.replace(/\s+$/, "") + "\n\n" : "") + "Mes disponibilités : ";
      }
    };

    var rendre = function (libres, injoignable) {
      vider();
      var head = el("div", { class: "cal-head" });
      var fin = new Date(lundi); fin.setDate(fin.getDate() + 4);
      head.appendChild(el("span", { class: "title", text: "Semaine du " + lundi.getDate() + " " + (lundi.getMonth() === fin.getMonth() ? "" : MOIS[lundi.getMonth()] + " ") + "au " + fin.getDate() + " " + MOIS[fin.getMonth()] + " " + fin.getFullYear() }));
      var nav = el("div", { class: "cal-nav" });
      var prev = el("button", { type: "button", "aria-label": "Semaine précédente", text: "‹" });
      var next = el("button", { type: "button", "aria-label": "Semaine suivante", text: "›" });
      prev.disabled = lundi <= lundiDe(aujourdhui);
      prev.addEventListener("click", function () { lundi.setDate(lundi.getDate() - 7); charger(); });
      next.addEventListener("click", function () { lundi.setDate(lundi.getDate() + 7); charger(); });
      nav.appendChild(prev); nav.appendChild(next);
      head.appendChild(nav);
      zone.appendChild(head);

      var grille = el("div", { class: "cal-grid", role: "group", "aria-label": "Créneaux disponibles" });
      for (var i = 0; i < 5; i++) {
        var jour = new Date(lundi); jour.setDate(jour.getDate() + i);
        var col = el("div", { class: "cal-day" });
        var titre = el("div", { class: "d", text: JOURS[i] + " " });
        titre.appendChild(el("b", { text: String(jour.getDate()) }));
        col.appendChild(titre);
        var slots = el("div", { class: "slots" });
        HEURES.forEach(function (h, idx) {
          if (idx === 3) slots.appendChild(el("div", { class: "slot-gap", "aria-hidden": "true" }));
          var cle = cleISO(jour, h);
          var passe = new Date(jour.getFullYear(), jour.getMonth(), jour.getDate(), h) <= aujourdhui;
          var dispo = !passe && (injoignable ? true : !!libres[cle]);
          var b = el("button", { type: "button", class: "slot", text: h + " h", "aria-pressed": choix === libelle(jour, h) ? "true" : "false", "aria-label": libelle(jour, h) });
          b.disabled = !dispo;
          b.addEventListener("click", (function (jour, h) {
            return function () {
              var lib = libelle(jour, h);
              var deja = choix === lib;
              $$(".slot", grille).forEach(function (s) { s.setAttribute("aria-pressed", "false"); });
              choix = deja ? "" : lib;
              if (!deja) this.setAttribute("aria-pressed", "true");
              if (champ) champ.value = choix;
              var cf = $("#cal-choix"); if (cf) cf.textContent = choix ? "Créneau choisi : " + choix + ". Il sera ajouté à votre message." : "";
              if (message) {
                var sans = message.value.replace(/\n?Créneau souhaité : [^\n]*\n?/g, "").replace(/\s+$/, "");
                message.value = choix ? (sans ? sans + "\n\n" : "") + "Créneau souhaité : " + choix : sans;
              }
            };
          })(jour, h));
          slots.appendChild(b);
        });
        col.appendChild(slots);
        grille.appendChild(col);
      }
      zone.appendChild(grille);
      var foot = el("p", { class: "cal-foot", id: "cal-choix", text: choix ? "Créneau choisi : " + choix + ". Il sera ajouté à votre message." : "" });
      zone.appendChild(foot);
      zone.appendChild(el("p", { class: "note", text: "Le créneau est confirmé par e-mail ou par téléphone après réception de votre message." }));
    };

    var charger = function () {
      var sem = semaineISO(lundi);
      if (cache[sem]) { rendre(cache[sem], false); return; }
      vider();
      zone.appendChild(el("p", { class: "note", text: "Chargement des disponibilités…" }));
      if (!API || !window.fetch) { repli(); return; }
      var ctrl = typeof AbortController === "function" ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 8000) : null;
      fetch(API + "/disponibilites?semaine=" + encodeURIComponent(sem), { headers: { "Accept": "application/json" }, signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { if (!r.ok) throw new Error("disponibilites " + r.status); return r.json(); })
        .then(function (json) {
          if (json && json.ok === false) throw new Error(json.erreur || "erreur");
          cache[sem] = extraireLibres(json);
          rendre(cache[sem], false);
        })
        .catch(repli)
        .then(function () { if (timer) clearTimeout(timer); });
    };

    ouvrir.addEventListener("click", function () { charger(); });
  }

  /* ------------------------------------------------------------------
     Démarrage
     ------------------------------------------------------------------ */
  function demarrer() {
    chargerCatalogue().then(function () { initSimulateur(); });
    initChoisir();
    initBoutonsOffre();
    initContact();
    initCalendrier();
    initLienOffre();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", demarrer);
  else demarrer();
})();
