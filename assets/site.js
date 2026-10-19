/* Belfort Systems — site public : prix depuis le catalogue, simulateur, contact, calendrier.
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

  function prixDepuisCatalogue(cle) {
    if (!catalogue) return null;
    var m;
    if (cle === "heure_supplementaire") return catalogue.heure_supplementaire;
    if (cle === "site") return catalogue.site_web && catalogue.site_web.prix;
    if ((m = /^forfait\.(.+)$/.exec(cle))) {
      var f = (catalogue.forfaits_mensuels || []).filter(function (x) { return x.id === m[1]; })[0];
      return f ? f.prix : null;
    }
    if ((m = /^(.+)\.supplement$/.exec(cle))) {
      var p = (catalogue.prestations || []).filter(function (x) { return x.id === m[1]; })[0];
      return p && p.supplement ? p.supplement.prix : null;
    }
    var q = (catalogue.prestations || []).filter(function (x) { return x.id === cle; })[0];
    return q ? q.prix : null;
  }

  function appliquerPrix() {
    $$("[data-prix]").forEach(function (node) {
      var v = prixDepuisCatalogue(node.getAttribute("data-prix"));
      if (typeof v === "number") node.textContent = nombre(v);
    });
    // Libellés des boutons « Choisir » : on reflète le prix du catalogue
    $$("[data-choisir]").forEach(function (a) {
      var plan = a.closest("[data-forfait]");
      if (!plan) return;
      var id = plan.getAttribute("data-forfait");
      var prix = id === "site" ? prixDepuisCatalogue("site") : prixDepuisCatalogue("forfait." + id);
      var nom = $("h3", plan) ? $("h3", plan).textContent.trim() : id;
      if (typeof prix === "number") a.setAttribute("data-choisir", (id === "site" ? "Option site WordPress (+" : nom + " (") + prix + " € HT / mois)");
    });
  }

  function catalogueDeSecours() {
    // Si le JSON ne se charge pas, on reconstruit le minimum depuis les valeurs déjà présentes dans la page.
    var lire = function (cle, defaut) { var n = $('[data-prix="' + cle + '"]'); var v = n ? parseFloat(n.textContent) : NaN; return isNaN(v) ? defaut : v; };
    return {
      taux_horaire: lire("heure", 45),
      heure_supplementaire: lire("heure_supplementaire", 40),
      prestations: [
        { id: "heure", nom: "Intervention", unite: "heure", prix: lire("heure", 45) },
        { id: "tranche", nom: "Demi-heure supplémentaire", unite: "demi-heure", prix: 22.5 },
        { id: "migration", nom: "Migration Microsoft 365", unite: "forfait", prix: lire("migration", 590), inclus: "jusqu'à 5 boîtes", supplement: { nom: "boîte supplémentaire", prix: lire("migration.supplement", 70) } },
        { id: "audit", nom: "Audit informatique", unite: "forfait", prix: lire("audit", 390) },
        { id: "audit_abonnements", nom: "Audit des abonnements et contrats", unite: "forfait", prix: lire("audit_abonnements", 290) }
      ],
      forfaits_mensuels: [
        { id: "essentiel", nom: "Suivi Essentiel", prix: lire("forfait.essentiel", 149), heures: 2, assistance: "2 h d'assistance par mois", delai: "réponse le jour ouvré suivant" },
        { id: "serenite", nom: "Suivi Sérénité", prix: lire("forfait.serenite", 249), heures: 5, assistance: "5 h d'assistance par mois", delai: "réponse dans la journée" }
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
     2. Simulateur de formule
     ------------------------------------------------------------------ */
  function forfait(id) { return (catalogue.forfaits_mensuels || []).filter(function (f) { return f.id === id; })[0]; }
  function prestation(id) { return (catalogue.prestations || []).filter(function (p) { return p.id === id; })[0]; }

  function recommander(r) {
    // r = {postes, messagerie, site, frequence}
    var reco = { type: "forfait", forfait: null, mensuel: 0, ponctuel: 0, lignes: [], texte: "", titre: "", formule: "" };
    var ess = forfait("essentiel"), seren = forfait("serenite");
    var heure = prestation("heure"), migration = prestation("migration"), siteWeb = catalogue.site_web;

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
      reco.lignes.push("Intervention : " + nombre(heure.prix) + " € HT de l'heure, première heure due puis par demi-heure (" + nombre(prestation("tranche").prix) + " €), déplacement inclus à moins de 30 km");
      reco.texte = "Vous avez rarement besoin d'aide : pas de formule mensuelle, vous m'appelez quand il le faut et vous payez l'intervention. ";
      reco.formule = "Interventions à la demande (" + nombre(heure.prix) + " € HT / heure)";
      if (r.site === "vivre") {
        reco.mensuel += siteWeb.prix;
        reco.lignes.push("Option site WordPress : " + siteWeb.prix + " € HT par mois");
        reco.texte += "Votre site, lui, a besoin d'un suivi régulier (mises à jour, sauvegardes) : je propose l'option site WordPress. ";
        reco.formule += " + option site WordPress (" + siteWeb.prix + " € HT / mois)";
      }
    } else {
      var f = reco.forfait;
      reco.titre = f.nom;
      reco.mensuel = f.prix;
      reco.lignes.push((f.assistance || (f.heures + " h d'assistance par mois")) + ", " + f.delai);
      reco.formule = f.nom + " (" + f.prix + " € HT / mois)";
      if (f.id === "essentiel") reco.texte = "Le Suivi Essentiel prend en charge votre Microsoft 365 (arrivées et départs, licences, droits, boîtes partagées) et vérifie chaque mois la sécurité, la sauvegarde et les licences, avec un compte rendu. ";
      if (f.id === "serenite") reco.texte = "Avec cette taille d'équipe et ce rythme, le Suivi Sérénité ajoute le suivi des postes, l'application Espace Client, une revue des licences tous les 6 mois et une réponse dans la journée. ";
      if (r.site === "vivre") {
        reco.mensuel += siteWeb.prix;
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
      if (reco.type === "ponctuel") reco.texte += "Après la migration, le Suivi Essentiel (" + ess.prix + " € HT par mois) est une bonne suite si vous voulez rester accompagné. ";
    } else if (r.messagerie === "m365") {
      reco.texte += "Votre messagerie est déjà sur Microsoft 365 : je peux en reprendre la gestion (comptes, licences, partages) dans la formule. ";
    } else {
      reco.texte += "Votre messagerie actuelle vous convient : je la garde telle quelle. ";
    }
    return reco;
  }

  function afficherReco(reco) {
    var box = $("#sim-result");
    if (!box) return;
    while (box.firstChild) box.removeChild(box.firstChild);
    box.appendChild(el("span", { class: "kicker", text: "Ma recommandation" }));
    box.appendChild(el("h3", { text: reco.titre }));
    var amount = el("div", { class: "amount" });
    if (reco.mensuel > 0) {
      amount.appendChild(document.createTextNode(euro(reco.mensuel) + " HT "));
      amount.appendChild(el("small", { text: "/ mois" }));
      if (reco.ponctuel > 0) {
        amount.appendChild(el("br"));
        amount.appendChild(el("small", { text: "+ " + euro(reco.ponctuel) + " HT une fois (migration)" }));
      }
    } else if (reco.ponctuel > 0) {
      amount.appendChild(document.createTextNode("à partir de " + euro(reco.ponctuel) + " HT "));
      amount.appendChild(el("small", { text: "une fois, puis à l'heure" }));
    } else {
      amount.appendChild(document.createTextNode(nombre(prestation("heure").prix) + " € HT "));
      amount.appendChild(el("small", { text: "/ heure d'intervention" }));
    }
    box.appendChild(amount);
    box.appendChild(el("p", { text: reco.texte.trim() }));
    box.appendChild(el("ul", null, reco.lignes.map(function (l) { return el("li", { text: l }); })));
    var btn = el("button", { type: "button", class: "btn light", text: "Recevoir cette estimation par e-mail" });
    btn.addEventListener("click", function () { preRemplirContact(reco); });
    box.appendChild(btn);
    box.appendChild(el("p", { class: "legal", text: "Estimation, hors taxes, prix à confirmer sur devis." }));
  }

  function preRemplirContact(reco) {
    var formule = $("#c-formule"), sujet = $("#c-sujet"), message = $("#c-message");
    if (formule) formule.value = reco.formule;
    if (sujet) sujet.value = reco.type === "ponctuel" ? "Dépannage ou assistance" : "Formule mensuelle";
    if (message && !message.value.trim()) {
      message.value = "Bonjour,\nle simulateur me propose : " + reco.formule + ".\nPouvez-vous me confirmer cette estimation ?\n\nMa structure : ";
    }
    var contact = $("#contact");
    if (contact) contact.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(function () { var n = $("#c-nom"); if (n) n.focus({ preventScroll: true }); }, 500);
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
        var formule = $("#c-formule"), sujet = $("#c-sujet");
        if (formule) formule.value = a.getAttribute("data-choisir");
        if (sujet) sujet.value = /site WordPress/i.test(a.getAttribute("data-choisir")) ? "Site web" : "Formule mensuelle";
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
    var montrer = function (classe, lignes, bouton) {
      vider();
      var box = el("div", { class: "msg " + classe });
      lignes.forEach(function (l) { box.appendChild(el("p", { text: l })); });
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
            montrer("ok", ["Merci " + d.nom + ", votre demande est bien envoyée. Je vous réponds sous 24 h ouvrées" + (d.creneau ? " et je vous confirme le créneau du " + d.creneau : "") + "."]);
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
    initContact();
    initCalendrier();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", demarrer);
  else demarrer();
})();
