/* Réglages d'affichage appliqués avant le premier rendu (pas de clignotement).
 * Fichier séparé (et non script en ligne) pour respecter la CSP stricte.
 * clair/sombre → data-theme ; taille → data-texte ; couleurs (v5.7) → apparence.js :
 *   palette « chateau » (défaut) = l'apparence choisie pour tout le Château (cache « eb:apparence » sur l'appareil),
 *   sinon la palette personnelle (« creme », « bleu » = Bleu élégant, ou une autre) ;
 * la couleur du navigateur (meta theme-color) suit l'en-tête. Sans apparence.js : ancien comportement. */
(function () {
  var ENTETE = { creme: ["#5B3833", "#2E1D19"], bleu: ["#14213D", "#0F1A33"] };
  /** Couleur de l'en-tête pour une palette d'origine, en clair (false) ou en sombre (true). */
  function couleurNavigateur(palette, sombre) { return (ENTETE[palette] || ENTETE.creme)[sombre ? 1 : 0]; }
  function estSombre(r) {
    return r && r.theme === "sombre" ? true : r && r.theme === "clair" ? false
      : !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
  function apparencePartagee() { try { var c = JSON.parse(localStorage.getItem("eb:apparence") || "null"); return c && c.donnees ? c.donnees : null; } catch (e) { return null; } }
  /** v5.7 : avant, « creme » était enregistré par défaut pour tout le monde → devient « suivre le Château ». « bleu » reste. */
  function migrer(r) {
    r = r || {};
    if (r.paletteV !== 2) { if (!r.palette || r.palette === "creme") r.palette = "chateau"; r.paletteV = 2; }
    return r;
  }
  /** Pose les couleurs et met la meta theme-color à jour (appelé aussi par app.js à chaque réglage). */
  function appliquerPalette(r) {
    var A = window.EBApparence, d = document.documentElement, sombre = estSombre(r);
    if (A && d.style) { A.appliquer(document, A.effectif(r, apparencePartagee()), sombre); return; }
    var palette = r && r.palette === "bleu" ? "bleu" : "creme";
    if (palette === "bleu") d.setAttribute("data-palette", "bleu"); else d.removeAttribute("data-palette");
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", couleurNavigateur(palette, sombre));
  }
  window.EBCouleurNavigateur = couleurNavigateur;
  window.EBAppliquerPalette = appliquerPalette;
  window.EBMigrerReglages = migrer;
  try {
    var r = migrer(JSON.parse(localStorage.getItem("eb:reglages") || "{}"));
    if (r.theme === "clair" || r.theme === "sombre") document.documentElement.setAttribute("data-theme", r.theme);
    if (r.texte === "petit" || r.texte === "grand" || r.texte === "tres-grand") document.documentElement.setAttribute("data-texte", r.texte);
    appliquerPalette(r);
  } catch (e) {}
})();
