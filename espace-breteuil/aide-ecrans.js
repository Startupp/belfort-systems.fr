/*
 * Espace Breteuil — v5.4 : écrans « Aide et demandes ».
 *
 *   Bouton « ? » flottant (tous les écrans, coin bas droit, au-dessus de la barre d'onglets) :
 *     ouvre le panneau : Nouvelle demande (Question, Avis, Amélioration, Problème) + Mes demandes
 *     (fil de discussion, répondre, marquer « Résolue »). Pastille quand Damien a répondu (non lu).
 *   #/aide          Mes demandes (aussi depuis Moi)
 *   #/aide/<n°>     une demande (lien envoyé dans le mail à Damien)
 *   #/demandes      toutes les demandes, filtrables — réservé au prestataire (le Worker le décide :
 *                   GET /breteuil/aide/moi → { prestataire } ; liste d'adresses dans le Worker, jamais ici).
 * Logique testable : aide.js. Texte uniquement (fabrique EB.h) : jamais de HTML venu du Worker.
 */
(function () {
  "use strict";

  var EB = window.EB, A = window.EBAide;
  if (!EB || !A) return;
  var h = EB.h, icone = EB.icone, emoji = EB.emoji;
  function G() { return window.EBGraph; }
  function connecte() { return !!(G() && G().estConnecte()); }
  function base() { return (self.EB_CONFIG && self.EB_CONFIG.api) || ""; }
  var C = A.client({ base: base(), jeton: function () { return G().jetonIdentite(); }, fetch: function (u, i) { return fetch(u, i); } });

  var etat = {
    prestataire: null,        // null = inconnu
    liste: null,              // mes demandes (ou toutes pour le prestataire), dernière lecture
    nonLues: 0,
    nonConfiguree: false,
    brouillon: { type: "", message: "" },
    vue: "nouvelle",          // panneau : nouvelle | mes | fil | envoyee
    fil: null,                // n° ouvert dans le panneau
    envoyee: null,
    derniereLecture: 0,
  };

  /* ------------------------------------------------------------------ */
  /* Petits éléments                                                     */
  /* ------------------------------------------------------------------ */
  function lienTel(texte) {
    return h("a", { class: "btn secondaire large aide-appel", href: "tel:" + A.TEL }, icone("telephone"), texte || "Appeler Damien — " + A.TEL_AFFICHE);
  }
  function badgeStatut(s) { return h("span", { class: "aide-statut " + (s || "nouvelle") }, A.libelleStatut(s)); }
  function quand(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return "";
    return EB.fmt(t, { day: "numeric", month: "short" }) + " à " + EB.heure(t);
  }
  function erreurBloc(e) {
    var msg = A.messageErreur(e);
    return h("div", { class: "aide-erreur", role: "alert" }, h("p", null, msg),
      e && (e.code === "aide_non_configuree" || !e.statut || e.statut >= 500 || e.statut === 401) ? lienTel() : null);
  }
  function contexte() {
    var app = document.getElementById("app"), t = app && app.querySelector("h1");
    var titre = t && t.firstChild ? t.firstChild.textContent : "";
    var installee = false;
    try { installee = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches; } catch (e) {}
    return {
      ecran: A.nomEcran(location.hash, titre),
      version: self.EB_VERSION || "",
      appareil: A.appareil(navigator.userAgent, { tactile: navigator.maxTouchPoints > 1, largeur: window.innerWidth, installee: installee }),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Bouton « ? » flottant et pastille                                   */
  /* ------------------------------------------------------------------ */
  var bouton = h("button", { class: "aide-fab", type: "button", "aria-label": "Aide et demandes", "aria-haspopup": "dialog", onclick: function () { ouvrir(); } },
    h("span", { class: "aide-fab-signe", "aria-hidden": "true" }, "?"),
    h("span", { class: "aide-pastille", hidden: true, "aria-hidden": "true" }));
  var panneau = h("dialog", { class: "detail aide-panneau", id: "aide-panneau", "aria-labelledby": "aide-titre" });
  panneau.addEventListener("click", function (e) { if (e.target === panneau) panneau.close(); });
  panneau.addEventListener("close", function () { if (etat.vue === "envoyee") etat.vue = "nouvelle"; });

  function majPastille() {
    var p = bouton.querySelector(".aide-pastille"), n = etat.nonLues;
    p.hidden = !n;
    p.textContent = n > 9 ? "9+" : String(n || "");
    bouton.setAttribute("aria-label", n ? "Aide et demandes — " + n + (etat.prestataire ? " demande(s) nouvelle(s)" : " réponse(s) non lue(s)") : "Aide et demandes");
    document.querySelectorAll("[data-aide-compte]").forEach(function (el) { el.hidden = !n; el.textContent = n ? String(n) : ""; });
  }
  /** Relit la liste (au plus toutes les 60 s, sauf forcer) : pastille + prestataire. */
  function rafraichir(forcer) {
    if (!connecte()) { etat.liste = null; etat.nonLues = 0; majPastille(); return Promise.resolve(null); }
    if (!forcer && Date.now() - etat.derniereLecture < 60000) return Promise.resolve(etat.liste);
    etat.derniereLecture = Date.now();
    return C.lister().then(function (j) {
      etat.nonConfiguree = false;
      etat.prestataire = !!j.prestataire;
      etat.liste = j.demandes || [];
      etat.nonLues = A.nonLues(etat.liste, etat.prestataire);
      majPastille();
      return etat.liste;
    }, function (e) {
      if (e && e.code === "aide_non_configuree") etat.nonConfiguree = true;
      throw e;
    });
  }
  function rafraichirDiscret() { rafraichir(false).catch(function () {}); }

  /* ------------------------------------------------------------------ */
  /* Panneau                                                             */
  /* ------------------------------------------------------------------ */
  function ouvrir(vue, id) {
    if (vue) etat.vue = vue;
    if (id) etat.fil = id;
    dessiner();
    if (!panneau.open) { if (panneau.showModal) panneau.showModal(); else panneau.setAttribute("open", ""); }
    var f = panneau.querySelector("[data-focus]") || panneau.querySelector("h2");
    if (f) setTimeout(function () { f.focus({ preventScroll: true }); }, 30);
  }
  function fermer() { if (panneau.open) panneau.close(); }

  function dessiner() {
    panneau.textContent = "";
    var tete = h("div", { class: "aide-tete" },
      h("h2", { id: "aide-titre", tabindex: "-1" }, emoji("💬"), "Aide et demandes"),
      h("button", { class: "btn-rond aide-fermer", type: "button", "aria-label": "Fermer", onclick: fermer }, icone("croix")));
    var corps = h("div", { class: "contenu aide-corps" });
    panneau.appendChild(tete); panneau.appendChild(corps);
    if (!connecte()) { vueDeconnecte(corps); return; }
    if (etat.vue !== "fil") {
      var seg = h("div", { class: "segments aide-onglets", role: "group", "aria-label": "Aide", style: { "--n": "2" } },
        h("button", { type: "button", "aria-pressed": String(etat.vue === "nouvelle" || etat.vue === "envoyee"), "data-aide-vue": "nouvelle", onclick: function () { etat.vue = "nouvelle"; dessiner(); } }, "Nouvelle demande"),
        h("button", { type: "button", "aria-pressed": String(etat.vue === "mes"), "data-aide-vue": "mes", onclick: function () { etat.vue = "mes"; dessiner(); } },
          etat.prestataire ? "Demandes" : "Mes demandes", h("span", { class: "aide-compte", "data-aide-compte": "", hidden: !etat.nonLues }, etat.nonLues ? String(etat.nonLues) : "")));
      corps.appendChild(seg);
    }
    if (etat.vue === "mes") vueListe(corps, { panneau: true });
    else if (etat.vue === "fil") vueFil(corps, etat.fil, { panneau: true });
    else if (etat.vue === "envoyee") vueEnvoyee(corps);
    else vueNouvelle(corps);
  }

  function vueDeconnecte(corps) {
    var g = G(), configure = g && g.estConfigure();
    corps.appendChild(h("p", { class: "phrase" }, "Pour envoyer une question, un avis ou signaler un problème à Damien, connectez-vous d'abord avec votre compte du Château."));
    corps.appendChild(h("p", { class: "aide-note" }, "Vous pouvez aussi l'appeler directement."));
    if (configure) corps.appendChild(h("button", { class: "btn large", type: "button", "data-focus": "", onclick: function () { fermer(); Promise.resolve(g.connecter()).catch(function () {}); } }, icone("cle"), "Se connecter"));
    corps.appendChild(lienTel());
  }

  function vueNouvelle(corps) {
    var b = etat.brouillon;
    var erreurType = h("p", { class: "erreur", id: "aide-err-type", "aria-live": "polite" });
    var puces = h("div", { class: "puces aide-types", role: "radiogroup", "aria-label": "Type de demande", "aria-describedby": "aide-err-type" });
    A.TYPES.forEach(function (t, i) {
      var actif = b.type === t.cle;
      puces.appendChild(h("button", { class: "puce aide-type", type: "button", role: "radio", "aria-checked": String(actif), "data-type": t.cle,
        tabindex: actif || (!b.type && i === 0) ? "0" : "-1", "data-focus": i === 0 && !b.type ? "" : null,
        onclick: function () { b.type = t.cle; Array.prototype.forEach.call(puces.children, function (x) { var a = x.dataset.type === t.cle; x.setAttribute("aria-checked", String(a)); x.tabIndex = a ? 0 : -1; }); erreurType.textContent = ""; },
        onkeydown: function (e) {
          var k = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
          if (!k) return;
          e.preventDefault();
          var l = puces.children, j = (i + k + l.length) % l.length; l[j].focus(); l[j].click();
        } }, emoji(t.emoji), t.libelle));
    });
    var zone = h("textarea", { class: "champ aide-message", id: "aide-message", rows: "6", maxlength: String(A.MAX), "aria-describedby": "aide-compteur aide-err-msg",
      placeholder: "Expliquez simplement : ce que vous faisiez, ce qui se passe, ce que vous attendiez.", oninput: function () { b.message = zone.value; majCompteur(); erreurMsg.textContent = ""; } });
    zone.value = b.message;
    var cpt = h("small", { class: "aide-compteur", id: "aide-compteur", "aria-live": "off" });
    var erreurMsg = h("p", { class: "erreur", id: "aide-err-msg", "aria-live": "polite" });
    function majCompteur() { var c = A.compteur(zone.value); cpt.textContent = c.texte + " caractères"; cpt.classList.toggle("presque", c.presque); }
    majCompteur();
    var ctx = contexte();
    var envoyer = h("button", { class: "btn large", type: "submit", "data-action": "aide-envoyer" }, icone("coche"), "Envoyer à Damien");
    var retour = h("div", { "aria-live": "polite" });
    var form = h("form", { class: "aide-form", novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      var v = A.valider({ type: b.type, message: zone.value });
      erreurType.textContent = v.erreurs.type || ""; erreurMsg.textContent = v.erreurs.message || "";
      if (!v.ok) { (v.erreurs.type ? puces.querySelector('[tabindex="0"]') : zone).focus(); return; }
      envoyer.disabled = true; envoyer.classList.add("en-cours"); retour.textContent = "";
      C.creer({ type: v.donnees.type, message: v.donnees.message, ecran: ctx.ecran, version: ctx.version, appareil: ctx.appareil }).then(function (j) {
        etat.brouillon = { type: "", message: "" };
        etat.envoyee = j.id; etat.vue = "envoyee";
        etat.derniereLecture = 0; rafraichirDiscret();
        dessiner();
      }, function (err) {
        envoyer.disabled = false; envoyer.classList.remove("en-cours");
        if (err && err.code === "aide_non_configuree") etat.nonConfiguree = true;
        retour.appendChild(erreurBloc(err));
      });
    } },
      h("fieldset", { class: "aide-champ" }, h("legend", null, "Type de demande"), puces, erreurType),
      h("div", { class: "aide-champ" }, h("label", { for: "aide-message" }, "Votre message"), zone, cpt, erreurMsg),
      h("div", { class: "aide-contexte", "aria-label": "Joint automatiquement à votre demande" },
        h("b", null, "Joint automatiquement"),
        h("dl", null,
          h("div", null, h("dt", null, "Écran"), h("dd", { "data-ctx": "ecran" }, ctx.ecran)),
          h("div", null, h("dt", null, "Version"), h("dd", { "data-ctx": "version" }, ctx.version)),
          h("div", null, h("dt", null, "Appareil"), h("dd", { "data-ctx": "appareil" }, ctx.appareil)))),
      retour, envoyer);
    corps.appendChild(form);
    if (etat.nonConfiguree) retour.appendChild(erreurBloc({ code: "aide_non_configuree" }));
  }

  function vueEnvoyee(corps) {
    corps.classList.add("centre");
    corps.appendChild(h("div", { class: "aide-ok" }, icone("coche")));
    corps.appendChild(h("p", { class: "phrase aide-confirmation", role: "status", tabindex: "-1", "data-focus": "" }, h("b", null, A.confirmation(etat.envoyee))));
    corps.appendChild(h("p", { class: "aide-note" }, "Il vous répond ici, dans « Mes demandes ». Une pastille apparaît sur le bouton « ? » dès qu'il a répondu."));
    corps.appendChild(h("button", { class: "btn large", type: "button", onclick: function () { etat.vue = "mes"; dessiner(); } }, "Voir mes demandes"));
    corps.appendChild(h("button", { class: "btn secondaire large", type: "button", onclick: fermer }, "Fermer"));
  }

  /* ---------- Liste ---------- */
  function carte(d, opts) {
    var t = A.typeDe(d.type) || { emoji: "💬", libelle: "Demande" };
    var contenu = [
      h("span", { class: "aide-carte-tete" }, emoji(t.emoji), h("b", null, "n° " + d.id + " · " + t.libelle), badgeStatut(d.statut)),
      opts.prestataire ? h("span", { class: "aide-carte-qui" }, d.nom + " · " + d.adresse) : null,
      d.extrait ? h("span", { class: "aide-carte-extrait" }, d.extrait) : null,
      h("span", { class: "aide-carte-pied" }, h("small", null, "Dernier message : " + quand(d.dernier)),
        d.nonLu ? h("span", { class: "aide-nonlu" }, "Nouvelle réponse") : null),
    ];
    if (opts.panneau) return h("button", { class: "aide-carte" + (d.nonLu ? " nonlu" : ""), type: "button", "data-demande": String(d.id), onclick: function () { etat.vue = "fil"; etat.fil = d.id; dessiner(); } }, contenu);
    return h("a", { class: "aide-carte" + (d.nonLu ? " nonlu" : ""), href: "#/aide/" + d.id, "data-demande": String(d.id) }, contenu);
  }
  function vueListe(corps, opts) {
    opts = opts || {};
    var zone = h("div", { class: "aide-liste", "aria-busy": "true" }, EB.squelette(3, "liste"));
    corps.appendChild(zone);
    var charge = opts.filtres ? C.lister(opts.filtres).then(function (j) { etat.prestataire = !!j.prestataire; return j.demandes || []; }) : rafraichir(true);
    charge.then(function (liste) {
      zone.textContent = ""; zone.removeAttribute("aria-busy");
      if (opts.surListe) opts.surListe(liste);
      if (!liste.length) { zone.appendChild(h("p", { class: "vide" }, opts.filtres ? "Aucune demande ne correspond." : "Aucune demande pour le moment. Écrivez à Damien avec « Nouvelle demande ».")); return; }
      liste.forEach(function (d) { zone.appendChild(carte(d, { panneau: opts.panneau, prestataire: etat.prestataire })); });
    }, function (e) { zone.textContent = ""; zone.removeAttribute("aria-busy"); zone.appendChild(erreurBloc(e)); });
  }

  /* ---------- Fil d'une demande ---------- */
  function vueFil(corps, id, opts) {
    opts = opts || {};
    if (opts.panneau) corps.appendChild(h("button", { class: "btn secondaire aide-retour", type: "button", onclick: function () { etat.vue = "mes"; dessiner(); } }, icone("gauche"), etat.prestataire ? "Demandes" : "Mes demandes"));
    var zone = h("div", { class: "aide-fil", "aria-busy": "true" }, EB.squelette(2, "liste"));
    corps.appendChild(zone);
    function charger() {
      return C.lire(id).then(function (j) {
        etat.prestataire = !!j.prestataire;
        zone.textContent = ""; zone.removeAttribute("aria-busy");
        afficher(j);
        etat.derniereLecture = 0; rafraichirDiscret(); // la pastille baisse : la réponse est lue
      }, function (e) { zone.textContent = ""; zone.removeAttribute("aria-busy"); zone.appendChild(erreurBloc(e)); });
    }
    function afficher(j) {
      var d = j.demande, t = A.typeDe(d.type) || { emoji: "💬", libelle: "Demande" }, presta = j.prestataire;
      zone.appendChild(h("div", { class: "aide-fil-tete" },
        h("h3", { "data-focus": "", tabindex: "-1" }, emoji(t.emoji), "Demande n° " + d.id + " — " + t.libelle), badgeStatut(d.statut)));
      zone.appendChild(h("p", { class: "aide-note" }, (presta ? d.nom + " · " + d.adresse + " · " : "") + "Envoyée le " + quand(d.cree) + " · " + (d.ecran || "") + " · v" + (d.version || "?") + " · " + (d.appareil || "")));
      var fil = h("ol", { class: "aide-messages" });
      j.messages.forEach(function (m) {
        var deDamien = m.auteur === "prestataire";
        var qui = deDamien ? "Damien" : presta ? d.nom : "Vous";
        fil.appendChild(h("li", { class: "aide-bulle " + (deDamien ? "damien" : "client") },
          h("span", { class: "aide-bulle-qui" }, h("b", null, qui), " · " + quand(m.cree) + (m.origine === "mail" ? " · par mail" : "")),
          h("span", { class: "aide-bulle-texte" }, m.texte)));
      });
      zone.appendChild(fil);
      // Répondre
      var champ = h("textarea", { class: "champ aide-message", id: "aide-reponse-" + d.id, rows: "3", maxlength: String(A.MAX), placeholder: presta ? "Votre réponse au client…" : "Ajouter un message pour Damien…" });
      var err = h("p", { class: "erreur", "aria-live": "polite" });
      var envoyer = h("button", { class: "btn large", type: "submit", "data-action": "aide-repondre" }, icone("coche"), presta ? "Envoyer la réponse" : "Envoyer");
      zone.appendChild(h("form", { class: "aide-form", novalidate: true, onsubmit: function (e) {
        e.preventDefault();
        var v = A.validerReponse(champ.value);
        if (!v.ok) { err.textContent = v.erreur; champ.focus(); return; }
        envoyer.disabled = true; err.textContent = "";
        C.repondre(d.id, v.texte).then(function () { EB.toast(presta ? "Réponse envoyée." : "Message envoyé à Damien."); zone.textContent = ""; charger(); },
          function (x) { envoyer.disabled = false; err.textContent = A.messageErreur(x); });
      } }, h("label", { for: champ.id }, presta ? "Répondre" : "Ajouter un message"), champ, err, envoyer));
      // Statut
      if (presta) {
        var seg = h("div", { class: "segments aide-statuts", role: "group", "aria-label": "Statut de la demande", style: { "--n": "3" } });
        Object.keys(A.STATUTS).forEach(function (s) {
          seg.appendChild(h("button", { type: "button", "aria-pressed": String(d.statut === s), "data-statut": s, onclick: function () {
            C.statut(d.id, s).then(function () { EB.toast("Statut : " + A.libelleStatut(s)); zone.textContent = ""; charger(); }, function (x) { EB.toast(A.messageErreur(x)); });
          } }, A.STATUTS[s]));
        });
        zone.appendChild(h("div", { class: "aide-champ" }, h("b", null, "Statut"), seg));
      } else if (d.statut !== "resolue") {
        zone.appendChild(h("button", { class: "btn secondaire large", type: "button", "data-action": "aide-resolue", onclick: function () {
          C.statut(d.id, "resolue").then(function () { EB.toast("Demande marquée « Résolue ». Merci !"); zone.textContent = ""; charger(); }, function (x) { EB.toast(A.messageErreur(x)); });
        } }, icone("coche"), "Marquer « Résolue »"));
      }
    }
    charger();
  }

  /* ------------------------------------------------------------------ */
  /* Écrans (#/aide, #/aide/<n°>, #/demandes)                            */
  /* ------------------------------------------------------------------ */
  function ecranAide(app, chemin) {
    var id = chemin && chemin[1] && /^\d+$/.test(chemin[1]) ? Number(chemin[1]) : null;
    if (id) {
      app.appendChild(EB.barre("Demande n° " + id, etat.prestataire ? { href: "#/demandes", texte: "Demandes" } : { href: "#/aide", texte: "Mes demandes" }));
      vueFil(app, id, {});
      return;
    }
    app.appendChild(EB.barre("Mes demandes", { href: "#/moi", texte: "Moi" }, null, "Questions, avis et problèmes envoyés à Damien"));
    app.appendChild(h("div", { class: "actions aide-actions" },
      h("button", { class: "btn large", type: "button", "data-action": "aide-nouvelle", onclick: function () { ouvrir("nouvelle"); } }, icone("plus"), "Nouvelle demande"),
      etat.prestataire ? h("a", { class: "btn secondaire large", href: "#/demandes" }, "Toutes les demandes (prestataire)") : null));
    vueListe(app, {});
  }

  function ecranDemandes(app) {
    app.appendChild(EB.barre("Demandes", { href: "#/moi", texte: "Moi" }, null, "Toutes les demandes des utilisateurs"));
    var corps = h("div", { class: "aide-demandes" });
    app.appendChild(corps);
    var refus = function () { corps.textContent = ""; corps.appendChild(h("p", { class: "vide" }, "Cet écran est réservé à Damien (prestataire). Vos demandes sont dans « Mes demandes ».")); corps.appendChild(h("a", { class: "btn large", href: "#/aide" }, "Mes demandes")); };
    var f = { statut: EB.lire("eb:aide-filtre-statut", "nouvelle") || "", type: "", personne: "" };
    var personnes = [];
    function dessinerFiltres() {
      corps.textContent = "";
      var segS = h("div", { class: "segments", role: "group", "aria-label": "Filtrer par statut", style: { "--n": "4" } });
      [["", "Toutes"], ["nouvelle", "Nouvelles"], ["repondue", "Répondues"], ["resolue", "Résolues"]].forEach(function (x) {
        segS.appendChild(h("button", { type: "button", "aria-pressed": String(f.statut === x[0]), "data-filtre-statut": x[0], onclick: function () { f.statut = x[0]; EB.ecrire("eb:aide-filtre-statut", f.statut); dessinerFiltres(); } }, x[1]));
      });
      var selType = h("select", { class: "champ", "aria-label": "Filtrer par type", "data-filtre": "type", onchange: function () { f.type = selType.value; dessinerFiltres(); } },
        h("option", { value: "" }, "Tous les types"), A.TYPES.map(function (t) { return h("option", { value: t.cle }, t.libelle); }));
      selType.value = f.type;
      var selPers = h("select", { class: "champ", "aria-label": "Filtrer par personne", "data-filtre": "personne", onchange: function () { f.personne = selPers.value; dessinerFiltres(); } },
        h("option", { value: "" }, "Toutes les personnes"), personnes.map(function (p) { return h("option", { value: p.adresse }, p.nom); }));
      selPers.value = f.personne;
      corps.appendChild(h("div", { class: "aide-filtres" }, segS, h("div", { class: "aide-filtres-l2" }, selType, selPers)));
      vueListe(corps, { filtres: { statut: f.statut, type: f.type, personne: f.personne }, surListe: function () {
        if (!etat.prestataire) refus();
      } });
    }
    // Personnes connues (toutes les demandes), puis la liste filtrée.
    corps.appendChild(EB.squelette(3, "liste"));
    C.lister().then(function (j) {
      etat.prestataire = !!j.prestataire;
      if (!j.prestataire) { refus(); return; }
      var vus = {};
      (j.demandes || []).forEach(function (d) { if (!vus[d.adresse]) { vus[d.adresse] = 1; personnes.push({ adresse: d.adresse, nom: d.nom }); } });
      personnes.sort(function (a, b) { return a.nom.localeCompare(b.nom, "fr"); });
      dessinerFiltres();
    }, function (e) { corps.textContent = ""; corps.appendChild(erreurBloc(e)); });
  }

  EB.ecran("aide", ecranAide);
  EB.ecran("demandes", ecranDemandes);

  /** Ligne(s) pour l'écran Moi : « Mes demandes » (+ « Demandes » pour le prestataire). */
  function lignesMoi() {
    var bloc = h("div", { class: "aide-lignes-moi" },
      h("a", { class: "action", href: "#/aide", "data-action": "mes-demandes" }, emoji("💬"),
        h("span", null, h("b", null, "Mes demandes ", h("span", { class: "aide-compte", "data-aide-compte": "", hidden: !etat.nonLues || etat.prestataire }, etat.nonLues && !etat.prestataire ? String(etat.nonLues) : "")),
          h("small", null, "Questions, avis, problèmes envoyés à Damien")), h("span", { class: "fleche", "aria-hidden": "true" }, "›")));
    function ajouterPresta() {
      if (!etat.prestataire || bloc.querySelector("[data-action=toutes-demandes]")) return;
      bloc.appendChild(h("a", { class: "action", href: "#/demandes", "data-action": "toutes-demandes" }, emoji("🗂️"),
        h("span", null, h("b", null, "Demandes (toutes)"), h("small", null, "Réservé au prestataire : répondre, changer le statut")), h("span", { class: "fleche", "aria-hidden": "true" }, "›")));
    }
    ajouterPresta();
    if (etat.prestataire === null && connecte()) rafraichir(true).then(ajouterPresta, function () {});
    return bloc;
  }

  window.EBAideEcrans = { ouvrir: ouvrir, fermer: fermer, rafraichir: rafraichir, lignesMoi: lignesMoi, etat: function () { return etat; } };

  /* ------------------------------------------------------------------ */
  /* Démarrage : bouton sur tous les écrans, pastille tenue à jour       */
  /* ------------------------------------------------------------------ */
  function installer() {
    if (!document.body.contains(bouton)) { document.body.appendChild(bouton); document.body.appendChild(panneau); }
    // La connexion Microsoft se termine après le chargement : on attend qu'elle soit là (30 s au plus).
    var essais = 0;
    (function attendre() { if (connecte()) rafraichirDiscret(); else if (essais++ < 30) setTimeout(attendre, 1000); })();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installer); else installer();
  window.addEventListener("hashchange", function () { setTimeout(rafraichirDiscret, 300); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) rafraichirDiscret(); });
  setInterval(function () { if (!document.hidden) rafraichirDiscret(); }, 5 * 60000);
})();
