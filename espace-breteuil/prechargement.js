/* Réglages d'affichage appliqués avant le premier rendu (pas de clignotement).
 * Fichier séparé (et non script en ligne) pour respecter la CSP stricte. */
(function () {
  try {
    var r = JSON.parse(localStorage.getItem("eb:reglages") || "{}");
    if (r.theme === "clair" || r.theme === "sombre") document.documentElement.setAttribute("data-theme", r.theme);
    if (r.texte === "petit" || r.texte === "grand" || r.texte === "tres-grand") document.documentElement.setAttribute("data-texte", r.texte);
  } catch (e) {}
})();
