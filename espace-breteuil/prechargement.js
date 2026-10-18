/* Réglages d'affichage appliqués avant le premier rendu (pas de clignotement).
 * Fichier séparé (et non script en ligne) pour respecter la CSP stricte.
 * Palette (« creme » par défaut, « bleu » = Bleu Breteuil) → data-palette ; clair/sombre → data-theme ;
 * la couleur du navigateur (meta theme-color) suit l'en-tête de la palette (valeurs = --entete d'app.css). */
(function () {
  var ENTETE = { creme: ["#5B3833", "#2E1D19"], bleu: ["#14213D", "#0F1A33"] };
  /** Couleur de l'en-tête pour une palette, en clair (false) ou en sombre (true). */
  function couleurNavigateur(palette, sombre) { return (ENTETE[palette] || ENTETE.creme)[sombre ? 1 : 0]; }
  /** Pose data-palette et met la meta theme-color à jour (appelé aussi par app.js à chaque réglage). */
  function appliquerPalette(r) {
    var d = document.documentElement, palette = r && r.palette === "bleu" ? "bleu" : "creme";
    if (palette === "bleu") d.setAttribute("data-palette", "bleu"); else d.removeAttribute("data-palette");
    var sombre = r && r.theme === "sombre" ? true : r && r.theme === "clair" ? false
      : !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", couleurNavigateur(palette, sombre));
  }
  window.EBCouleurNavigateur = couleurNavigateur;
  window.EBAppliquerPalette = appliquerPalette;
  try {
    var r = JSON.parse(localStorage.getItem("eb:reglages") || "{}");
    if (r.theme === "clair" || r.theme === "sombre") document.documentElement.setAttribute("data-theme", r.theme);
    if (r.texte === "petit" || r.texte === "grand" || r.texte === "tres-grand") document.documentElement.setAttribute("data-texte", r.texte);
    appliquerPalette(r);
  } catch (e) {}
})();
