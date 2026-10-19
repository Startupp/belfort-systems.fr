/*
 * Espace Breteuil — v4 : « Mes épingles » en haut du Planning (accueil connecté).
 *
 * Chacun épingle ses raccourcis : une boîte partagée (liste : boites-partagees.json), l'agenda
 * Outlook, le dossier commun, « Mes fichiers », ou n'importe quel dossier (menu ⋯ d'un dossier).
 * Mémorisé SUR L'APPAREIL (localStorage « eb:epingles »). Glisser pour réordonner, appui long
 * (ou touche Suppr) pour retirer ; Alt + flèches pour déplacer au clavier.
 *
 * Une boîte partagée épinglée est un RACCOURCI, pas un client mail : aucune permission de
 * lecture ni d'envoi de mails. Web : https://outlook.office.com/mail/<adresse>/ ; téléphone :
 * l'appli Outlook si elle s'ouvre (ms-outlook://), sinon la même adresse web.
 */
(function () {
  "use strict";
  var EB = window.EB;
  if (!EB) return;
  var h = EB.h, icone = EB.icone;
  var CLE = "eb:epingles", boites = null;

  function lire() { var l = EB.lire(CLE, []); return Array.isArray(l) ? l.filter(function (e) { return e && e.url && e.titre; }) : []; }
  function ecrire(l) { EB.ecrire(CLE, l); }
  function chargerBoites() {
    if (boites) return Promise.resolve(boites);
    return fetch("boites-partagees.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : { boites: [] }; })
      .then(function (j) { boites = (j.boites || []).filter(function (b) { return /^[^@\s]+@[^@\s]+$/.test(b.adresse || ""); }); return boites; })
      .catch(function () { return []; });
  }
  function urlBoite(adresse) { return "https://outlook.office.com/mail/" + encodeURIComponent(adresse) + "/"; }
  var MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  function ajouter(e) {
    var l = lire();
    if (l.some(function (x) { return x.url === e.url; })) { EB.toast("« " + e.titre + " » est déjà épinglé."); return; }
    l.push(e); ecrire(l);
    EB.toast("« " + e.titre + " » est épinglé sur l'accueil.");
    redessiner();
  }
  function retirer(i) {
    var l = lire(), e = l[i]; if (!e) return;
    EB.confirmer({ emoji: "📌", titre: "Retirer « " + e.titre + " » ?", phrase: "Seul le raccourci est retiré de cet appareil. Rien d'autre ne change.", bouton: "Oui, retirer", deuxEtapes: false })
      .then(function (ok) { if (!ok) return; l.splice(i, 1); ecrire(l); EB.toast("Épingle retirée."); redessiner(); });
  }
  function deplacer(de, vers) {
    var l = lire(); if (vers < 0 || vers >= l.length || de === vers) return;
    var e = l.splice(de, 1)[0]; l.splice(vers, 0, e); ecrire(l); redessiner(vers);
  }

  /** Ouvre un raccourci. Boîte sur téléphone : appli Outlook, sinon le web. */
  function ouvrir(e) {
    if (e.type === "boite" && MOBILE) {
      var parti = false;
      function cache() { parti = true; }
      document.addEventListener("visibilitychange", cache, { once: true });
      window.addEventListener("pagehide", cache, { once: true });
      location.href = "ms-outlook://emails";
      setTimeout(function () { if (!parti && document.visibilityState === "visible") window.open(e.url, "_blank", "noopener"); }, 1500);
      EB.toast("Dans Outlook, choisissez la boîte « " + (e.adresse || e.titre) + " ».");
      return;
    }
    if (/^#\//.test(e.url)) { location.hash = e.url; return; }
    window.open(e.url, "_blank", "noopener");
  }

  var ICONES = { boite: ["mail", "ciel"], agenda: ["agenda", "praline"], dossier: ["dossier", "dore"], fichiers: ["nuage", "ciel"] };
  var zoneCourante = null;
  function redessiner(focus) { if (zoneCourante && document.body.contains(zoneCourante)) dessiner(zoneCourante, focus); }

  function dessiner(zone, focus) {
    zone.textContent = "";
    var l = lire();
    zone.appendChild(h("div", { class: "entete-section" }, h("h2", { id: "t-epingles" }, "Mes épingles"),
      h("button", { class: "btn petit secondaire", type: "button", "data-action": "epingler", onclick: proposer }, icone("plus"), "Épingler un raccourci")));
    if (!l.length) {
      zone.appendChild(h("p", { class: "vide-doux" }, "Épinglez une adresse partagée (contact@, finance@…), l'agenda ou un dossier pour l'avoir ici, à portée de main."));
      return;
    }
    var grille = h("div", { class: "epingles", role: "list", "aria-describedby": "aide-epingles" });
    l.forEach(function (e, i) {
      var ic = ICONES[e.type] || ["ouvrir", "praline"];
      var b = h("button", { class: "epingle", type: "button", role: "listitem", "data-epingle": e.url, "aria-label": e.titre + (e.adresse ? " (" + e.adresse + ")" : "") + " — appui long pour retirer" },
        h("span", { class: "ico c-" + ic[1] }, icone(ic[0])), h("span", { class: "lib" }, e.titre), e.adresse ? h("small", null, e.adresse) : null);
      gestes(b, i, e, grille);
      grille.appendChild(b);
    });
    zone.appendChild(grille);
    zone.appendChild(h("p", { class: "petit", id: "aide-epingles" }, "Glisser pour réordonner · appui long pour retirer."));
    if (focus != null && grille.children[focus]) grille.children[focus].focus();
  }

  /** Toucher = ouvrir ; glisser = réordonner ; appui long = retirer ; clavier : Suppr, Alt+flèches. */
  function gestes(b, i, e, grille) {
    var depart = null, minuteur = null, glisse = false, long = false;
    b.addEventListener("pointerdown", function (ev) {
      if (ev.button !== 0) return;
      depart = { x: ev.clientX, y: ev.clientY }; glisse = false; long = false;
      minuteur = setTimeout(function () { if (!glisse) { long = true; if (navigator.vibrate) navigator.vibrate(20); retirer(i); } }, 650);
    });
    b.addEventListener("pointermove", function (ev) {
      if (!depart) return;
      if (!glisse && Math.hypot(ev.clientX - depart.x, ev.clientY - depart.y) > 10) {
        glisse = true; clearTimeout(minuteur); b.classList.add("glisse");
        try { b.setPointerCapture(ev.pointerId); } catch (x) {}
      }
      if (glisse) {
        b.style.transform = "translate(" + (ev.clientX - depart.x) + "px," + (ev.clientY - depart.y) + "px)";
        Array.prototype.forEach.call(grille.children, function (c) { c.classList.toggle("cible", c !== b && dedans(c, ev)); });
      }
    });
    function fin(ev) {
      clearTimeout(minuteur);
      if (glisse) {
        var cibles = Array.prototype.slice.call(grille.children), j = -1;
        cibles.forEach(function (c, k) { if (c !== b && dedans(c, ev)) j = k; });
        b.classList.remove("glisse"); b.style.transform = "";
        if (j > -1) deplacer(i, j); else redessiner();
      }
      depart = null;
    }
    b.addEventListener("pointerup", fin);
    b.addEventListener("pointercancel", function () { clearTimeout(minuteur); depart = null; glisse = false; b.classList.remove("glisse"); b.style.transform = ""; });
    b.addEventListener("click", function (ev) { if (glisse || long) { ev.preventDefault(); glisse = false; long = false; return; } ouvrir(e); });
    b.addEventListener("contextmenu", function (ev) { ev.preventDefault(); });
    b.addEventListener("keydown", function (ev) {
      if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); retirer(i); }
      else if (ev.altKey && (ev.key === "ArrowLeft" || ev.key === "ArrowUp")) { ev.preventDefault(); deplacer(i, i - 1); }
      else if (ev.altKey && (ev.key === "ArrowRight" || ev.key === "ArrowDown")) { ev.preventDefault(); deplacer(i, i + 1); }
    });
  }
  function dedans(c, ev) { var r = c.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom; }

  function proposer() {
    chargerBoites().then(function (bs) {
      var deja = lire().map(function (x) { return x.url; });
      var choix = [
        { valeur: { type: "agenda", titre: "Agenda Outlook", url: "https://outlook.office.com/calendar/" }, emoji: "📅", titre: "Agenda Outlook", sous: "Mon agenda, dans Outlook" },
        { valeur: { type: "dossier", titre: "Documents de l'équipe", url: "#/commun" }, emoji: "📁", titre: "Documents de l'équipe", sous: "Le dossier partagé du Château" },
        { valeur: { type: "fichiers", titre: "Mes documents", url: "#/onedrive" }, emoji: "👤", titre: "Mes documents", sous: "Pour moi seulement (OneDrive)" },
      ].concat(bs.map(function (b) {
        return { valeur: { type: "boite", titre: b.nom, adresse: b.adresse, url: urlBoite(b.adresse) }, emoji: "📬", titre: "Adresse « " + b.nom + " »", sous: b.adresse };
      })).filter(function (c) { return deja.indexOf(c.valeur.url) < 0; });
      if (!choix.length) { EB.toast("Tout est déjà épinglé. Pour un dossier : menu ⋯ du dossier."); return; }
      return EB.choisir("Épingler un raccourci", choix, "Pour un dossier précis : menu ⋯ du dossier → « Épingler sur l'accueil ».").then(function (v) { if (v) ajouter(v); });
    });
  }

  /** Section « Mes épingles » (Planning, connecté). */
  function section() {
    var zone = h("section", { class: "section zone-epingles", "aria-labelledby": "t-epingles" });
    zoneCourante = zone;
    dessiner(zone);
    return zone;
  }

  window.EBEpingles = { section: section, ajouter: ajouter, lire: lire, urlBoite: urlBoite, chargerBoites: chargerBoites, ouvrir: ouvrir };
})();
