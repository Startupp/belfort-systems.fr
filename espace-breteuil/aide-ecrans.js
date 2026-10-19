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
 *   v5.6 : pièces jointes (« 📎 Joindre un fichier », glisser-déposer, coller une capture) dans « Nouvelle demande »
 *          et « Ajouter un message » ; vignettes et fichiers sous chaque message (lus avec le jeton → blob:).
 *   #/aide/<n°>/pj/<id>  la demande, pièce jointe mise en évidence (lien des mails).
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
    pj: null,                 // v5.6 : pièces jointes installées côté Worker ? (null = inconnu)
    liste: null,              // mes demandes (ou toutes pour le prestataire), dernière lecture
    nonLues: 0,
    nonConfiguree: false,
    brouillon: { type: "", message: "" },
    vue: "nouvelle",          // panneau : nouvelle | mes | fil | envoyee
    fil: null,                // n° ouvert dans le panneau
    envoyee: null,
    derniereLecture: 0,
    filtre: "encours",        // v5.6 : « En cours » par défaut (Mes demandes et Demandes)
  };

  /* ------------------------------------------------------------------ */
  /* Petits éléments                                                     */
  /* ------------------------------------------------------------------ */
  function lienTel(texte) {
    return h("a", { class: "btn secondaire large aide-appel", href: "tel:" + A.TEL }, icone("telephone"), texte || "Appeler Damien · " + A.TEL_AFFICHE.replace(/ /g, "\u00a0"));
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
      if (j.pj != null) etat.pj = !!j.pj;
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
  /* v5.6 : pièces jointes                                               */
  /* ------------------------------------------------------------------ */
  /** Image réduite dans le navigateur (2000 px au plus, JPEG 0,85). Illisible (HEIC hors Safari…) : envoyée telle quelle. */
  function reduireImage(f) {
    if (!A.estImage(f) || typeof createImageBitmap !== "function") return Promise.resolve(f);
    var d;
    return createImageBitmap(f).then(function (bmp) {
      d = A.dimensions(bmp.width, bmp.height);
      var c = document.createElement("canvas"); c.width = d.l; c.height = d.h;
      var ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, d.l, d.h); // transparence (PNG) → blanc
      ctx.drawImage(bmp, 0, 0, d.l, d.h);
      if (bmp.close) bmp.close();
      return new Promise(function (ok) { c.toBlob(ok, "image/jpeg", A.PJ_QUALITE); });
    }).then(function (b) {
      if (!b) return f;
      if (!d.reduit && b.size >= f.size && A.typePj(f) !== "heic") return f; // déjà petite : on garde l'originale
      try { return new File([b], A.nomJpeg(f.name), { type: "image/jpeg" }); } catch (e) { b.name = A.nomJpeg(f.name); return b; }
    }, function () { return f; });
  }

  /**
   * Sélecteur de pièces jointes : bouton, liste de puces (nom, taille, retirer), glisser-déposer et coller sur `cible`.
   * → { el, fichiers() : [{ fichier, nom }], pret() : Promise, vider() }.
   */
  function selecteurPj(cible) {
    var liste = [], enCours = 0, attente = Promise.resolve();
    var input = h("input", { type: "file", multiple: true, accept: A.PJ_ACCEPT, class: "aide-pj-input", tabindex: "-1", "aria-hidden": "true",
      onchange: function () { ajouter(input.files); input.value = ""; } });
    var bouton = h("button", { type: "button", class: "btn secondaire aide-pj-bouton", "data-action": "aide-joindre", onclick: function () { input.click(); } },
      emoji("📎"), "Joindre un fichier");
    var puces = h("ul", { class: "aide-pj-puces", "aria-label": "Fichiers joints", "aria-live": "polite" });
    var err = h("p", { class: "erreur aide-pj-erreur", role: "alert" });
    var el = h("div", { class: "aide-pj" },
      h("div", { class: "aide-pj-ligne" }, bouton, h("small", { class: "aide-pj-aide" }, "Photo, capture d'écran, PDF, Word, Excel… 5\u00a0fichiers, 8\u00a0Mo chacun. Vous pouvez aussi coller une capture ou glisser un fichier ici.")),
      input, puces, err);
    function dessinerPuces() {
      puces.textContent = "";
      liste.forEach(function (x) {
        var nom = x.fichier ? x.nom : (x.brut.name || "capture");
        puces.appendChild(h("li", { class: "aide-pj-puce" + (x.fichier ? "" : " prepa"), "data-pj-nom": nom },
          x.apercu ? h("img", { class: "aide-pj-mini", src: x.apercu, alt: "" }) : emoji(x.fichier && /^image\//.test(x.fichier.type) ? "🖼️" : "📄"),
          h("span", { class: "aide-pj-nom" }, h("b", null, nom), h("small", null, x.fichier ? A.tailleLisible(x.fichier.size) : "Préparation…")),
          h("button", { type: "button", class: "btn-rond aide-pj-retirer", "aria-label": "Retirer " + nom, "data-action": "aide-pj-retirer", onclick: function () {
            liste.splice(liste.indexOf(x), 1); if (x.apercu) URL.revokeObjectURL(x.apercu); dessinerPuces(); bouton.disabled = liste.length >= A.PJ_MAX;
          } }, icone("croix"))));
      });
      bouton.disabled = liste.length >= A.PJ_MAX;
    }
    function ajouter(fichiers) {
      var c = A.controlerAjout(liste, fichiers, false);
      err.textContent = c.erreurs.join(" ");
      c.ajouts.forEach(function (f) {
        var x = { brut: f, fichier: null, nom: "", apercu: null };
        liste.push(x); enCours++;
        var p = reduireImage(f).then(function (r) {
          enCours--;
          if (liste.indexOf(x) < 0) return;
          var apres = A.controlerAjout([], [r], true);
          if (apres.erreurs.length) { liste.splice(liste.indexOf(x), 1); err.textContent = (err.textContent ? err.textContent + " " : "") + apres.erreurs.join(" "); }
          else {
            x.fichier = r; x.nom = r.name || A.nomJpeg(f.name);
            if (/^image\/(jpeg|png|webp)$/.test(r.type)) x.apercu = URL.createObjectURL(r);
          }
          dessinerPuces();
        });
        attente = attente.then(function () { return p; });
      });
      dessinerPuces();
    }
    // Coller (Ctrl+V / appui long → Coller) une capture d'écran ; glisser-déposer des fichiers.
    cible.classList.add("aide-pj-cible");
    cible.addEventListener("paste", function (e) {
      var fs = e.clipboardData && e.clipboardData.files;
      if (fs && fs.length) { e.preventDefault(); ajouter(fs); }
    });
    function avecFichiers(e) { var t = e.dataTransfer && e.dataTransfer.types; return !!t && Array.prototype.indexOf.call(t, "Files") > -1; }
    ["dragenter", "dragover"].forEach(function (k) { cible.addEventListener(k, function (e) {
      if (!avecFichiers(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; cible.classList.add("aide-pj-survol");
    }); });
    cible.addEventListener("dragleave", function (e) { if (!cible.contains(e.relatedTarget)) cible.classList.remove("aide-pj-survol"); });
    cible.addEventListener("drop", function (e) {
      if (!avecFichiers(e)) return; e.preventDefault(); e.stopPropagation(); cible.classList.remove("aide-pj-survol"); ajouter(e.dataTransfer.files);
    });
    return {
      el: el,
      fichiers: function () { return liste.filter(function (x) { return x.fichier; }).map(function (x) { return { fichier: x.fichier, nom: x.nom }; }); },
      pret: function () { return attente.then(function () { return enCours === 0; }); },
      vider: function () { liste.forEach(function (x) { if (x.apercu) URL.revokeObjectURL(x.apercu); }); liste = []; err.textContent = ""; dessinerPuces(); },
    };
  }
  /** Place le sélecteur dans `place` dès que l'on sait que les pièces jointes sont installées (sinon : rien, bouton caché). */
  function brancherPj(form, place) {
    var sel = null;
    function monter() { if (!sel && etat.pj) { sel = selecteurPj(form); place.appendChild(sel.el); } }
    monter();
    if (etat.pj === null && connecte()) C.moi().then(function (j) { etat.pj = !!j.pj; monter(); }, function () {});
    return { sel: function () { return sel; } };
  }

  /* ---------- Pièces jointes d'un message (fil) ---------- */
  var blobs = {}; // "n°/pj" → blob: (gardés pendant la session : pas de nouveau téléchargement à chaque affichage)
  function lirePiece(id, p) {
    var k = id + "/" + p.id;
    if (!blobs[k]) blobs[k] = C.piece(id, p.id).then(function (b) { return URL.createObjectURL(b); }, function (e) { delete blobs[k]; throw e; });
    return blobs[k];
  }
  function telecharger(url, nom) {
    var a = h("a", { href: url, download: nom, hidden: true });
    document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 1000);
  }
  var visionneuse = h("dialog", { class: "detail aide-visionneuse", "aria-label": "Pièce jointe" });
  visionneuse.addEventListener("click", function (e) { if (e.target === visionneuse) visionneuse.close(); });
  function voirImage(url, nom) {
    visionneuse.textContent = "";
    visionneuse.appendChild(h("div", { class: "aide-tete" }, h("h2", { tabindex: "-1" }, nom),
      h("button", { class: "btn-rond aide-fermer", type: "button", "aria-label": "Fermer", onclick: function () { visionneuse.close(); } }, icone("croix"))));
    visionneuse.appendChild(h("div", { class: "contenu aide-vision-corps" }, h("img", { src: url, alt: nom, class: "aide-vision-img" }),
      h("button", { class: "btn secondaire large", type: "button", onclick: function () { telecharger(url, nom); } }, "Télécharger")));
    if (!document.body.contains(visionneuse)) document.body.appendChild(visionneuse);
    if (visionneuse.showModal) visionneuse.showModal(); else visionneuse.setAttribute("open", "");
  }
  function piecesMessage(id, pj, cible) {
    if (!pj || !pj.length) return null;
    var ul = h("ul", { class: "aide-pieces", "aria-label": "Pièces jointes" });
    pj.forEach(function (p) {
      var li = h("li", { class: "aide-piece" + (String(p.id) === String(cible) ? " cible" : ""), "data-pj": String(p.id) });
      if (p.apercu) {
        var img = h("img", { class: "aide-vignette", alt: p.nom, width: "120", height: "90" });
        var b = h("button", { type: "button", class: "aide-vignette-btn", "aria-label": "Voir " + p.nom + " (" + A.tailleLisible(p.taille) + ")", "data-action": "aide-voir-pj",
          onclick: function () { lirePiece(id, p).then(function (u) { voirImage(u, p.nom); }, function (e) { EB.toast(A.messageErreur(e)); }); } }, img);
        li.appendChild(b);
        lirePiece(id, p).then(function (u) { img.src = u; li.classList.add("chargee"); }, function () { li.classList.add("echec"); img.alt = p.nom + " (non disponible)"; });
      } else {
        li.appendChild(h("button", { type: "button", class: "aide-fichier", "data-action": "aide-ouvrir-pj", "aria-label": "Télécharger " + p.nom + " (" + A.tailleLisible(p.taille) + ")",
          onclick: function () { lirePiece(id, p).then(function (u) { telecharger(u, p.nom); }, function (e) { EB.toast(A.messageErreur(e)); }); } },
          emoji(/pdf/.test(p.type) ? "📕" : /word/.test(p.type) ? "📘" : /sheet/.test(p.type) ? "📗" : /presentation/.test(p.type) ? "📙" : /^image/.test(p.type) ? "🖼️" : "📄"),
          h("span", { class: "aide-pj-nom" }, h("b", null, p.nom), h("small", null, A.tailleLisible(p.taille)))));
      }
      ul.appendChild(li);
    });
    return ul;
  }

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
    if (etat.vue === "nouvelle" || etat.vue === "mes") {
      // v5.5 : le tutoriel d'abord — souvent, la réponse y est déjà.
      corps.appendChild(h("a", { class: "action aide-comment", href: "#/comment-faire", "data-action": "comment-faire", onclick: function () { fermer(); } },
        emoji("❓"), h("span", null, h("b", null, "Comment faire ?"), h("small", null, "Les gestes de tous les jours, pas à pas")), h("span", { class: "fleche", "aria-hidden": "true" }, "›")));
    }
    if (etat.vue !== "fil") {
      var seg = h("div", { class: "segments aide-onglets", role: "group", "aria-label": "Aide", style: { "--n": "2" } },
        h("button", { type: "button", "aria-pressed": String(etat.vue === "nouvelle" || etat.vue === "envoyee"), "data-aide-vue": "nouvelle", onclick: function () { etat.vue = "nouvelle"; dessiner(); } }, "Écrire à Damien"),
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
    var placePj = h("div", { class: "aide-champ aide-place-pj" });
    var pj = null;
    var form = h("form", { class: "aide-form", novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      var v = A.valider({ type: b.type, message: zone.value });
      erreurType.textContent = v.erreurs.type || ""; erreurMsg.textContent = v.erreurs.message || "";
      if (!v.ok) { (v.erreurs.type ? puces.querySelector('[tabindex="0"]') : zone).focus(); return; }
      envoyer.disabled = true; envoyer.classList.add("en-cours"); retour.textContent = "";
      var sel = pj && pj.sel();
      Promise.resolve(sel ? sel.pret() : true).then(function () {
        return C.creer({ type: v.donnees.type, message: v.donnees.message, ecran: ctx.ecran, version: ctx.version, appareil: ctx.appareil }, sel ? sel.fichiers() : []);
      }).then(function (j) {
        if (sel) sel.vider();
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
      placePj,
      h("div", { class: "aide-contexte", "aria-label": "Joint automatiquement à votre demande" },
        h("b", null, "Joint automatiquement"),
        h("dl", null,
          h("div", null, h("dt", null, "Écran"), h("dd", { "data-ctx": "ecran" }, ctx.ecran)),
          h("div", null, h("dt", null, "Version"), h("dd", { "data-ctx": "version" }, ctx.version)),
          h("div", null, h("dt", null, "Appareil"), h("dd", { "data-ctx": "appareil" }, ctx.appareil)))),
      retour, envoyer);
    corps.appendChild(form);
    pj = brancherPj(form, placePj);
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
  /** v5.6 : « En cours » (Nouvelle + Répondue) / « Résolues » / « Toutes », avec le nombre sur chaque bouton. */
  function barreFiltres(liste, changer) {
    var c = A.comptesStatut(liste);
    var seg = h("div", { class: "segments aide-filtre-statut", role: "group", "aria-label": "Afficher les demandes", style: { "--n": "3" } });
    A.FILTRES.forEach(function (f) {
      seg.appendChild(h("button", { type: "button", "aria-pressed": String(etat.filtre === f.cle), "data-filtre-statut": f.cle,
        "aria-label": f.libelle + " : " + c[f.cle], onclick: function () { etat.filtre = f.cle; changer(); } },
        f.libelle, h("span", { class: "aide-filtre-n", "aria-hidden": "true" }, String(c[f.cle]))));
    });
    return seg;
  }
  function vueListe(corps, opts) {
    opts = opts || {};
    var zone = h("div", { class: "aide-liste", "aria-busy": "true" }, EB.squelette(3, "liste"));
    corps.appendChild(zone);
    var charge = opts.filtres ? C.lister(opts.filtres).then(function (j) { etat.prestataire = !!j.prestataire; return j.demandes || []; }) : rafraichir(true);
    charge.then(function (liste) {
      zone.removeAttribute("aria-busy");
      if (opts.surListe) opts.surListe(liste);
      function dessinerListe() {
        zone.textContent = "";
        if (!liste.length) { zone.appendChild(h("p", { class: "vide" }, opts.filtres ? "Aucune demande ne correspond." : "Aucune demande pour le moment. Écrivez à Damien avec « Écrire à Damien ».")); return; }
        zone.appendChild(barreFiltres(liste, dessinerListe));
        var visibles = A.filtrerStatut(liste, etat.filtre);
        if (!visibles.length) zone.appendChild(h("p", { class: "vide" }, etat.filtre === "encours" ? "Aucune demande en cours : tout est résolu." : "Aucune demande résolue pour le moment."));
        visibles.forEach(function (d) { zone.appendChild(carte(d, { panneau: opts.panneau, prestataire: etat.prestataire })); });
      }
      dessinerListe();
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
        if (j.pj != null) etat.pj = !!j.pj;
        zone.textContent = ""; zone.removeAttribute("aria-busy");
        afficher(j);
        if (opts.cible) {
          var c = zone.querySelector('[data-pj="' + String(opts.cible).replace(/\D/g, "") + '"]');
          if (c) { c.scrollIntoView({ block: "center" }); var bt = c.querySelector("button"); if (bt) bt.focus({ preventScroll: true }); }
          opts.cible = null;
        }
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
          m.texte ? h("span", { class: "aide-bulle-texte" }, m.texte) : null,
          piecesMessage(d.id, m.pj, opts.cible)));
      });
      zone.appendChild(fil);
      // Répondre
      var champ = h("textarea", { class: "champ aide-message", id: "aide-reponse-" + d.id, rows: "3", maxlength: String(A.MAX), placeholder: presta ? "Votre réponse au client…" : "Ajouter un message pour Damien…" });
      var err = h("p", { class: "erreur", "aria-live": "polite" });
      var envoyer = h("button", { class: "btn large", type: "submit", "data-action": "aide-repondre" }, icone("coche"), presta ? "Envoyer la réponse" : "Envoyer");
      var placePj = h("div", { class: "aide-place-pj" }), pjFil = null;
      var formRep = h("form", { class: "aide-form", novalidate: true, onsubmit: function (e) {
        e.preventDefault();
        var sel = pjFil && pjFil.sel();
        var v = A.validerReponse(champ.value, !!(sel && sel.fichiers().length));
        if (!v.ok) { err.textContent = v.erreur; champ.focus(); return; }
        envoyer.disabled = true; err.textContent = "";
        Promise.resolve(sel ? sel.pret() : true).then(function () { return C.repondre(d.id, v.texte, sel ? sel.fichiers() : []); })
          .then(function () { if (sel) sel.vider(); EB.toast(presta ? "Réponse envoyée." : "Message envoyé à Damien."); zone.textContent = ""; charger(); },
            function (x) { envoyer.disabled = false; err.textContent = A.messageErreur(x); });
      } }, h("label", { for: champ.id }, presta ? "Répondre" : "Ajouter un message"), champ, placePj, err, envoyer);
      zone.appendChild(formRep);
      pjFil = brancherPj(formRep, placePj);
      if (presta) zone.appendChild(blocRequalifier(d, function () { zone.textContent = ""; charger(); }));
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

  /* ---------- v5.6 : requalification (prestataire seulement) ---------- */
  function blocRequalifier(d, apres) {
    var choisi = !!d.facturableChoisi;
    var selType = h("select", { class: "champ", id: "aide-requal-type-" + d.id, "data-requal": "type", onchange: function () {
      if (!choisi) caseFact.checked = A.facturableParDefaut(selType.value); // tant que Damien n'a pas choisi : suit le type
    } }, A.TYPES.map(function (t) { return h("option", { value: t.cle }, t.libelle); }));
    selType.value = d.type;
    var caseFact = h("input", { type: "checkbox", id: "aide-requal-fact-" + d.id, "data-requal": "facturable", onchange: function () { choisi = true; } });
    caseFact.checked = d.facturable != null ? !!d.facturable : A.facturableParDefaut(d.type);
    var champMin = h("input", { class: "champ aide-minutes", id: "aide-requal-min-" + d.id, type: "text", inputmode: "numeric", autocomplete: "off", "data-requal": "minutes",
      "aria-describedby": "aide-requal-lisible-" + d.id, oninput: majLisible });
    champMin.value = String(d.minutes || 0);
    var lisible = h("small", { class: "aide-note", id: "aide-requal-lisible-" + d.id, "aria-live": "polite" });
    function majLisible() { var n = A.lireMinutes(champMin.value); lisible.textContent = n == null ? "Écrivez un nombre de minutes, par exemple 45 ou 1h30." : "Soit " + A.duree(n) + "."; }
    majLisible();
    var rapides = h("div", { class: "aide-rapides", role: "group", "aria-label": "Ajouter du temps" }, A.RAPIDES.map(function (r) {
      return h("button", { type: "button", class: "puce", "data-ajout": String(r.min), onclick: function () { var n = A.lireMinutes(champMin.value) || 0; champMin.value = String(n + r.min); majLisible(); } }, r.libelle);
    }));
    var err = h("p", { class: "erreur", "aria-live": "polite" });
    var bouton = h("button", { class: "btn large", type: "submit", "data-action": "aide-requalifier" }, icone("coche"), "Enregistrer");
    return h("form", { class: "aide-form aide-requal", novalidate: true, "aria-labelledby": "aide-requal-titre-" + d.id, onsubmit: function (e) {
      e.preventDefault();
      var n = A.lireMinutes(champMin.value);
      if (n == null) { err.textContent = "Temps passé : écrivez un nombre de minutes, par exemple 45 ou 1h30."; champMin.focus(); return; }
      var champs = { type: selType.value, minutes: n };
      if (choisi) champs.facturable = caseFact.checked;
      bouton.disabled = true; err.textContent = "";
      C.requalifier(d.id, champs).then(function () { EB.toast("Demande mise à jour."); apres(); }, function (x) { bouton.disabled = false; err.textContent = A.messageErreur(x); });
    } },
      h("h4", { id: "aide-requal-titre-" + d.id }, "Requalifier ", h("small", null, "(visible par vous seul)")),
      h("div", { class: "aide-champ" }, h("label", { for: selType.id }, "Type"), selType),
      h("label", { class: "aide-case", for: caseFact.id }, caseFact, h("span", null, h("b", null, "Facturable"), h("small", null, "Par défaut : oui pour un problème, non sinon."))),
      h("div", { class: "aide-champ" }, h("label", { for: champMin.id }, "Temps passé (minutes)"), h("div", { class: "aide-temps" }, champMin, rapides), lisible),
      err, bouton);
  }

  /* ---------- v5.6 : statistiques (#/demandes/stats[/AAAA-MM]) ---------- */
  function ecranStats(app, mois) {
    app.appendChild(EB.barre("Statistiques", { href: "#/demandes", texte: "Demandes" }, null, "Demandes d'aide, mois par mois"));
    var corps = h("div", { class: "aide-stats", "aria-busy": "true" }, EB.squelette(4, "tuiles"));
    app.appendChild(corps);
    C.stats(/^\d{4}-\d{2}$/.test(mois || "") ? mois : null).then(function (s) { corps.textContent = ""; corps.removeAttribute("aria-busy"); dessinerStats(corps, s); },
      function (e) {
        corps.textContent = ""; corps.removeAttribute("aria-busy");
        if (e && e.statut === 403) { corps.appendChild(h("p", { class: "vide" }, "Cet écran est réservé à Damien (prestataire).")); corps.appendChild(h("a", { class: "btn large", href: "#/aide" }, "Mes demandes")); }
        else corps.appendChild(erreurBloc(e));
      });
  }
  function dessinerStats(corps, s) {
    var t = s.tuiles;
    corps.appendChild(h("nav", { class: "aide-mois", "aria-label": "Choisir le mois" },
      h("a", { class: "btn-rond", href: "#/demandes/stats/" + s.precedent, "aria-label": "Mois précédent : " + A.libelleMois(s.precedent), "data-mois": "precedent" }, icone("gauche")),
      h("h2", { "data-mois-affiche": s.mois }, A.libelleMois(s.mois)),
      s.suivant ? h("a", { class: "btn-rond", href: "#/demandes/stats/" + s.suivant, "aria-label": "Mois suivant : " + A.libelleMois(s.suivant), "data-mois": "suivant" }, icone("droite"))
        : h("span", { class: "btn-rond inactif", "aria-hidden": "true" }, icone("droite"))));
    function tuileStat(cle, valeur, libelle, sous) { return h("div", { class: "aide-stat", "data-stat": cle }, h("b", null, valeur), h("span", null, libelle), sous ? h("small", null, sous) : null); }
    corps.appendChild(h("div", { class: "aide-stat-grille" },
      tuileStat("demandes", String(t.demandes), "Demandes du mois"),
      tuileStat("problemes", String(t.problemes), "Dont problèmes"),
      tuileStat("facturables", String(t.facturables), "Facturables"),
      tuileStat("temps", A.duree(t.minutesFacturables), "Temps facturable", "Temps passé sur les demandes facturables"),
      tuileStat("delai", A.delai(t.delaiMoyenMinutes), "Première réponse", "Délai moyen avant votre 1re réponse"),
      tuileStat("encours", String(t.enCours), "En cours", "Pas encore résolues")));
    // Par type : barres horizontales.
    var maxT = Math.max(1, Math.max.apply(null, s.parType.map(function (x) { return x.demandes; })));
    corps.appendChild(h("section", { class: "section aide-stat-bloc" }, h("h3", null, "Par type"),
      h("ul", { class: "aide-barres" }, s.parType.map(function (x) {
        var ty = A.typeDe(x.type) || { emoji: "💬" };
        return h("li", { "data-type": x.type }, h("span", { class: "aide-barre-lib" }, emoji(ty.emoji), x.libelle),
          h("span", { class: "aide-barre-piste", "aria-hidden": "true" }, h("span", { class: "aide-barre t-" + x.type, style: { width: (x.demandes / maxT * 100) + "%" } })),
          h("b", { class: "aide-barre-n" }, String(x.demandes)));
      }))));
    // Par personne : tableau trié.
    corps.appendChild(h("section", { class: "section aide-stat-bloc" }, h("h3", null, "Par personne"),
      s.parPersonne.length ? h("div", { class: "aide-table-defile" }, h("table", { class: "aide-table" },
        h("thead", null, h("tr", null, h("th", { scope: "col" }, "Personne"), h("th", { scope: "col" }, "Demandes"), h("th", { scope: "col" }, "Facturables"), h("th", { scope: "col" }, "Temps"))),
        h("tbody", null, s.parPersonne.map(function (p) {
          return h("tr", null, h("th", { scope: "row" }, h("span", null, p.nom), h("small", null, p.adresse)), h("td", null, String(p.demandes)), h("td", null, String(p.facturables)), h("td", null, A.duree(p.minutes)));
        })))) : h("p", { class: "vide" }, "Aucune demande ce mois-ci.")));
    // 6 derniers mois : total et problèmes facturables.
    var maxE = Math.max(1, Math.max.apply(null, s.evolution.map(function (x) { return x.total; })));
    corps.appendChild(h("section", { class: "section aide-stat-bloc" }, h("h3", null, "Les 6 derniers mois"),
      h("p", { class: "aide-legende" }, h("span", { class: "pastille-l total" }), "Toutes les demandes", h("span", { class: "pastille-l fact" }), "Problèmes facturables"),
      h("ol", { class: "aide-evolution" }, s.evolution.map(function (x) {
        return h("li", { class: x.mois === s.mois ? "courant" : null, "aria-label": A.libelleMois(x.mois) + " : " + x.total + " demande(s), dont " + x.problemesFacturables + " problème(s) facturable(s)" },
          h("span", { class: "aide-colonnes", "aria-hidden": "true" },
            h("span", { class: "aide-col total", style: { height: (x.total / maxE * 100) + "%" } }, h("i", null, String(x.total))),
            h("span", { class: "aide-col fact", style: { height: (x.problemesFacturables / maxE * 100) + "%" } }, h("i", null, String(x.problemesFacturables)))),
          h("span", { class: "aide-col-mois", "aria-hidden": "true" }, A.libelleMois(x.mois, true)));
      }))));
    corps.appendChild(h("button", { class: "btn large secondaire", type: "button", "data-action": "aide-export-csv", disabled: !s.lignes.length, onclick: function () {
      var url = URL.createObjectURL(new Blob([A.csvMois(s.lignes)], { type: "text/csv;charset=utf-8" }));
      telecharger(url, "demandes-" + s.mois + ".csv");
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    } }, emoji("📥"), "Exporter le mois (CSV)"));
  }

  /* ------------------------------------------------------------------ */
  /* Écrans (#/aide, #/aide/<n°>, #/demandes)                            */
  /* ------------------------------------------------------------------ */
  function ecranAide(app, chemin) {
    var id = chemin && chemin[1] && /^\d+$/.test(chemin[1]) ? Number(chemin[1]) : null;
    if (id) {
      app.appendChild(EB.barre("Demande n° " + id, etat.prestataire ? { href: "#/demandes", texte: "Demandes" } : { href: "#/aide", texte: "Mes demandes" }));
      // v5.6 : #/aide/<n°>/pj/<id> (lien d'une pièce jointe dans le mail) → la pièce est mise en évidence.
      vueFil(app, id, { cible: chemin[2] === "pj" && /^\d+$/.test(chemin[3] || "") ? chemin[3] : null });
      return;
    }
    app.appendChild(EB.barre("Mes demandes", { href: "#/moi", texte: "Moi" }, null, "Envoyées à Damien"));
    app.appendChild(h("div", { class: "actions aide-actions" },
      h("button", { class: "btn large", type: "button", "data-action": "aide-nouvelle", onclick: function () { ouvrir("nouvelle"); } }, icone("plus"), "Écrire à Damien"),
      etat.prestataire ? h("a", { class: "btn secondaire large", href: "#/demandes" }, "Toutes les demandes (prestataire)") : null));
    vueListe(app, {});
  }

  function ecranDemandes(app, chemin) {
    if (chemin && chemin[1] === "stats") return ecranStats(app, chemin[2]);
    app.appendChild(EB.barre("Demandes", { href: "#/moi", texte: "Moi" }, null, "Toutes les demandes des utilisateurs"));
    var corps = h("div", { class: "aide-demandes" });
    app.appendChild(corps);
    var refus = function () { corps.textContent = ""; corps.appendChild(h("p", { class: "vide" }, "Cet écran est réservé à Damien (prestataire). Vos demandes sont dans « Mes demandes ».")); corps.appendChild(h("a", { class: "btn large", href: "#/aide" }, "Mes demandes")); };
    var f = { type: "", personne: "" };
    var personnes = [];
    function dessinerFiltres() {
      corps.textContent = "";
      var selType = h("select", { class: "champ", "aria-label": "Filtrer par type", "data-filtre": "type", onchange: function () { f.type = selType.value; dessinerFiltres(); } },
        h("option", { value: "" }, "Tous les types"), A.TYPES.map(function (t) { return h("option", { value: t.cle }, t.libelle); }));
      selType.value = f.type;
      var selPers = h("select", { class: "champ", "aria-label": "Filtrer par personne", "data-filtre": "personne", onchange: function () { f.personne = selPers.value; dessinerFiltres(); } },
        h("option", { value: "" }, "Toutes les personnes"), personnes.map(function (p) { return h("option", { value: p.adresse }, p.nom); }));
      selPers.value = f.personne;
      corps.appendChild(h("a", { class: "action aide-lien-stats", href: "#/demandes/stats", "data-action": "aide-stats" }, emoji("📊"),
        h("span", null, h("b", null, "Statistiques"), h("small", null, "Le mois en chiffres, temps facturable, export CSV")), h("span", { class: "fleche", "aria-hidden": "true" }, "›")));
      corps.appendChild(h("div", { class: "aide-filtres" }, h("div", { class: "aide-filtres-l2" }, selType, selPers)));
      vueListe(corps, { filtres: { type: f.type, personne: f.personne }, surListe: function () {
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

  /** v5.6 : section « Demandes d'aide » de Gérer, seulement pour le prestataire (décidé par le Worker). */
  function blocGerer(grandesTuiles) {
    var bloc = h("section", { class: "section aide-gerer", hidden: true });
    function remplir() {
      if (!etat.prestataire || bloc.childNodes.length) return;
      bloc.appendChild(h("h2", null, "Demandes d'aide"));
      bloc.appendChild(grandesTuiles([
        { href: "#/demandes", emoji: "🗂️", libelle: "Demandes", sous: "Répondre, requalifier, changer le statut", action: "toutes-demandes-gerer" },
        { href: "#/demandes/stats", emoji: "📊", libelle: "Statistiques", sous: "Le mois en chiffres et l'export CSV", action: "aide-stats-gerer" },
      ]));
      bloc.hidden = false;
    }
    remplir();
    if (etat.prestataire === null && connecte()) rafraichir(true).then(remplir, function () {});
    return bloc;
  }

  /**
   * v5.7 : demande créée par l'appli elle-même (ex. « Nouveau logo à publier »). fichiers : [{ fichier: Blob, nom }].
   * Pièces jointes envoyées si elles sont installées côté Worker ; sinon le message seul (sansPj y est ajouté).
   * Renvoie { id, pj } (pj = vrai si les fichiers sont partis avec la demande).
   */
  function envoyerAuto(d, fichiers) {
    var ctx = contexte();
    return C.moi().catch(function () { return {}; }).then(function (j) {
      if (j && j.pj != null) etat.pj = !!j.pj;
      var f = etat.pj ? (fichiers || []) : [];
      return C.creer({ type: d.type, message: d.message + (f.length ? "" : (d.sansPj || "")), ecran: ctx.ecran, version: ctx.version, appareil: ctx.appareil }, f)
        .then(function (r) { etat.derniereLecture = 0; rafraichirDiscret(); return { id: r && r.id, pj: f.length > 0 }; });
    });
  }
  /** v5.5.1 : ouvre « Écrire à Damien » pré-rempli (ex. encadré du Site web). Garde un brouillon déjà commencé. */
  function ecrire(type, message) {
    var b = etat.brouillon;
    if (!String(b.message || "").trim()) etat.brouillon = { type: type || "", message: message || "" };
    else if (!b.type) b.type = type || "";
    ouvrir("nouvelle");
  }
  window.EBAideEcrans = { ecrire: ecrire, ouvrir: ouvrir, fermer: fermer, rafraichir: rafraichir, lignesMoi: lignesMoi, blocGerer: blocGerer, envoyerAuto: envoyerAuto, etat: function () { return etat; } };

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
