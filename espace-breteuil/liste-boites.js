/*
 * Espace Breteuil — liste des boîtes partagées (écran « Qui a quoi », section « Les boîtes partagées »).
 *
 * Une ligne par boîte, triée par nom : enveloppe dans un anneau, nom lisible + adresse en petit ;
 * à droite, qui y a accès (pastilles d'initiales, 4 au plus puis « +n », ou « Personne ») ;
 * « Ouvrir » (Outlook web, ou l'appli Outlook sur téléphone — comme les épingles) et « Épingler »
 * (connecté seulement : les épingles s'affichent en haut du Planning). Champ de recherche au-delà de 8 boîtes.
 * Aussi dans la démo « Boîtes mail » (données fictives), avec un bouton « Régler » (photo, accès).
 * Sur téléphone, la ligne passe sur deux niveaux (requête de conteneur) ; jamais de défilement de côté.
 *
 * boites : [{ nom, adresse, qui }] — qui : [{ nom, couleur }] ; [] = personne ; null = inconnu
 * (vraies données : Microsoft Graph ne donne pas les accès aux boîtes, ils se règlent dans Exchange).
 */
(function () {
  "use strict";
  var EB = window.EB;
  if (!EB) return;
  var h = EB.h, icone = EB.icone;
  var MAX_PASTILLES = 4, SEUIL_RECHERCHE = 8;
  var COULEURS = ["#1F3A68", "#8A4C45", "#2F6B5A", "#6E4F86", "#7A5710", "#3F6683", "#8A2B3B", "#4F6B3A"];

  function urlBoite(adresse) {
    return window.EBEpingles ? window.EBEpingles.urlBoite(adresse) : "https://outlook.office.com/mail/" + encodeURIComponent(adresse) + "/";
  }
  function couleurDe(nom) { var s = 0; for (var i = 0; i < nom.length; i++) s = (s * 31 + nom.charCodeAt(i)) >>> 0; return COULEURS[s % COULEURS.length]; }
  function trier(l) { return l.slice().sort(function (a, b) { return String(a.nom).localeCompare(String(b.nom), "fr", { sensitivity: "base" }); }); }

  /** Pastilles d'initiales (4 au plus, puis « +n »), « Personne », ou « Accès : voir Exchange ». */
  function pastilles(qui) {
    if (qui == null) return h("span", { class: "qui-boite inconnu", title: "Les accès aux boîtes partagées se règlent dans Exchange ; Microsoft ne les montre pas à l'appli." }, "Accès : réglés chez Microsoft");
    if (!qui.length) return h("span", { class: "qui-boite personne" }, "Personne");
    var noms = qui.map(function (p) { return p.nom; });
    var visibles = qui.slice(0, qui.length > MAX_PASTILLES ? MAX_PASTILLES - 1 : MAX_PASTILLES), reste = qui.length - visibles.length;
    return h("span", { class: "qui-boite", role: "img", "aria-label": "Accès : " + noms.join(", "), title: noms.join(", ") },
      visibles.map(function (p) { return h("span", { class: "pastille-initiales", style: { background: p.couleur || couleurDe(p.nom) }, "aria-hidden": "true" }, EB.initiales(p.nom)); }),
      reste > 0 ? h("span", { class: "pastille-initiales plus", "aria-hidden": "true" }, "+" + reste) : null);
  }

  function boutonEpingler(b) {
    var E = window.EBEpingles, url = urlBoite(b.adresse);
    function deja() { return E.lire().some(function (x) { return x.url === url; }); }
    var bt = h("button", { class: "btn petit secondaire", type: "button", "data-epingler": b.adresse, "aria-label": "Épingler la boîte " + b.nom + " sur l'accueil" });
    function etat() {
      var oui = deja();
      bt.textContent = "";
      bt.appendChild(icone(oui ? "coche" : "plus")); bt.appendChild(document.createTextNode(oui ? "Épinglée" : "Épingler"));
      bt.disabled = oui;
    }
    bt.addEventListener("click", function () { E.ajouter({ type: "boite", titre: b.nom, adresse: b.adresse, url: url }); etat(); });
    etat();
    return bt;
  }

  function ligne(b, i, epingler, regler) {
    var url = urlBoite(b.adresse);
    var ouvrir = h("a", { class: "btn petit", href: url, target: "_blank", rel: "noopener", "aria-label": "Ouvrir la boîte " + b.nom + " dans Outlook" }, icone("ouvrir"), "Ouvrir");
    ouvrir.addEventListener("click", function (ev) {
      if (window.EBEpingles && window.EBEpingles.ouvrir) { ev.preventDefault(); window.EBEpingles.ouvrir({ type: "boite", titre: b.nom, adresse: b.adresse, url: url }); }
    });
    return h("li", { class: "ligne-boite", "data-boite": b.adresse },
      h("span", { class: "eb-anneau rond d" + (i % 5 + 1), "aria-hidden": "true" }, icone("mail")),
      h("span", { class: "quoi" }, h("b", null, b.nom), h("small", null, b.adresse)),
      pastilles(b.qui),
      h("span", { class: "actes" }, ouvrir, epingler ? boutonEpingler(b) : null,
        regler ? h("a", { class: "btn petit secondaire", href: regler(b), "aria-label": "Régler la boîte " + b.nom + " (photo, accès)" }, "Régler") : null));
  }

  /** Liste complète (recherche si plus de 8 boîtes). opts.epingler : proposer « Épingler » ;
   *  opts.regler(b) → lien de l'écran de réglage de la boîte (démo « Boîtes mail »). */
  function liste(boites, opts) {
    opts = opts || {};
    var tri = trier((boites || []).filter(function (b) { return b && b.adresse; }));
    var epingler = !!(opts.epingler && window.EBEpingles);
    var zone = h("div", { class: "zone-liste-boites" });
    if (!tri.length) { zone.appendChild(h("p", { class: "vide" }, "Aucune adresse partagée.")); return zone; }
    var ul = h("ul", { class: "liste-boites", "aria-label": "Boîtes partagées (" + tri.length + ")" });
    var vide = h("p", { class: "vide", hidden: true }, "Aucune boîte ne correspond.");
    function remplir(q) {
      ul.textContent = "";
      q = String(q || "").trim().toLowerCase();
      var l = tri.filter(function (b) { return !q || (b.nom + " " + b.adresse).toLowerCase().indexOf(q) > -1; });
      l.forEach(function (b, i) { ul.appendChild(ligne(b, i, epingler, opts.regler)); });
      vide.hidden = l.length > 0;
    }
    if (tri.length > SEUIL_RECHERCHE) {
      var champ = h("input", { class: "champ recherche", type: "search", placeholder: "Chercher une boîte…", "aria-label": "Chercher une boîte partagée" });
      champ.addEventListener("input", function () { remplir(champ.value); });
      zone.appendChild(champ);
    }
    remplir("");
    zone.appendChild(ul);
    zone.appendChild(vide);
    return zone;
  }

  window.EBListeBoites = { liste: liste, trier: trier };
})();
