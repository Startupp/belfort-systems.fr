/*
 * Espace Breteuil — v5.3.1 : glisser-déposer des fichiers dans la fenêtre (partie SANS écran,
 * testée sous Node : tests/depot.test.mjs). L'écran (voile, envoi, messages) est dans depot-ecran.js.
 *
 *   cible(chemin, ctx)        route actuelle → dossier où déposer (ou aucun, avec la raison)
 *   nettoyerNom(nom)          caractères interdits par OneDrive (" * : < > ? / \ |) → « - »
 *   nomLibre(nom, existants)  « nom (2).ext », « nom (3).ext »… (choix « Garder les deux »)
 *   conflits(noms, existants) noms déjà présents dans le dossier (sans tenir compte des majuscules)
 *   trier(entrees)            { fichiers, tropGros, dossiers } — 250 Mo par fichier au plus
 *   cheminGraph(drive, segs, nom), messageSucces(n, dossier)
 */
(function (racine) {
  "use strict";
  var MAX = 250 * 1024 * 1024;
  var RACINE = "~racine";

  function dec(x) { try { return decodeURIComponent(x); } catch (e) { return x; } }
  function fil(l) { return l.join(" › "); }

  /**
   * chemin : segments de la route (« #/commun/Commun/Finance » → ["commun", "Commun", "Finance"]).
   * ctx : { nomCommun, suiviPermis (droit d'écrire dans Suivi informatique), suiviDossier, guides }.
   * → { espace: "moi" | "commun", segs, nom, lisible }  ou  { espace: null, proposerMoi: bool }
   */
  function cible(chemin, ctx) {
    ctx = ctx || {};
    var nc = ctx.nomCommun || "Commun";
    var c = (chemin || []).map(dec).filter(function (x) { return x !== ""; });
    var ecran = c[0] || "";
    if (ecran === "onedrive") {
      var s = c.slice(1);
      return { espace: "moi", segs: s, nom: s.length ? s[s.length - 1] : "Mes fichiers", lisible: fil(["Mes fichiers"].concat(s)) };
    }
    if (ecran === "commun") {
      var segs = c.length < 2 ? [nc] : c[1] === RACINE ? [] : c.slice(1);
      return { espace: "commun", segs: segs, nom: segs.length ? (segs.length === 1 && segs[0] === nc ? "Dossier commun" : segs[segs.length - 1]) : "Documents",
        lisible: lisibleCommun(segs, nc) };
    }
    if ((ecran === "suivi" || (ecran === "moi" && c[1] === "guides")) && ctx.suiviPermis) {
      var g = [nc, ctx.suiviDossier || "Suivi informatique", ctx.guides || "Guides"];
      return { espace: "commun", segs: g, nom: g[2], lisible: lisibleCommun(g, nc) };
    }
    return { espace: null, proposerMoi: ecran === "fichiers" };
  }
  function lisibleCommun(segs, nc) {
    if (!segs.length) return "Documents";
    return segs[0] === nc ? fil(["Dossier commun"].concat(segs.slice(1))) : fil(["Documents"].concat(segs));
  }

  /** Noms interdits par OneDrive/SharePoint : remplacés par « - » ; espaces et points de fin retirés. */
  function nettoyerNom(nom) {
    var n = String(nom == null ? "" : nom).replace(/["*:<>?\/\\|]/g, "-").replace(/[\u0000-\u001f]/g, "").trim().replace(/[. ]+$/, "");
    return n || "fichier";
  }
  function bas(x) { return String(x).toLocaleLowerCase("fr"); }
  /** Premier « nom (k).ext » libre, k ≥ 2. */
  function nomLibre(nom, existants) {
    var pris = {};
    (existants || []).forEach(function (x) { pris[bas(x)] = true; });
    if (!pris[bas(nom)]) return nom;
    var i = nom.lastIndexOf("."), base = i > 0 ? nom.slice(0, i) : nom, ext = i > 0 ? nom.slice(i) : "";
    for (var k = 2; ; k++) { var c = base + " (" + k + ")" + ext; if (!pris[bas(c)]) return c; }
  }
  function conflits(noms, existants) {
    var pris = {};
    (existants || []).forEach(function (x) { pris[bas(x)] = true; });
    return noms.filter(function (n) { return pris[bas(n)]; });
  }
  /** entrees : [{ nom, taille, dossier }] → { fichiers, tropGros, dossiers }. */
  function trier(entrees) {
    var r = { fichiers: [], tropGros: [], dossiers: [] };
    (entrees || []).forEach(function (e) {
      if (e.dossier) r.dossiers.push(e);
      else if (e.taille > MAX) r.tropGros.push(e);
      else r.fichiers.push(e);
    });
    return r;
  }
  function cheminGraph(drive, segs, nom) {
    return "/drives/" + drive + "/root:/" + segs.concat([nom]).map(encodeURIComponent).join("/");
  }
  function messageSucces(n, dossier) {
    return n + " fichier" + (n > 1 ? "s envoyés" : " envoyé") + " dans " + dossier;
  }

  var api = { MAX: MAX, cible: cible, nettoyerNom: nettoyerNom, nomLibre: nomLibre, conflits: conflits, trier: trier,
    cheminGraph: cheminGraph, messageSucces: messageSucces };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.EBDepot = api;
})(typeof self !== "undefined" ? self : this);
