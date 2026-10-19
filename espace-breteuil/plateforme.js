/*
 * Espace Breteuil — v5.7 : « Installer / Gérer l'application » (partie SANS écran, tests/plateforme.test.mjs).
 *
 *   detecter(ua, opts)     → appareil + navigateur + mode d'affichage (installée ou dans le navigateur)
 *   guide(p)               → comment installer sur CET appareil (étapes courtes, emoji, aucune fausse capture)
 *   desinstaller(p)        → le geste exact pour supprimer l'appli (une appli web ne peut pas se désinstaller seule)
 *   iconeAChange(…)        → bandeau iPhone/iPad « Le logo a changé » (une seule fois par version)
 *
 * opts : { standalone (display-mode standalone ou navigator.standalone), tactile (maxTouchPoints > 1),
 *          invitation (événement beforeinstallprompt reçu), brave (navigator.brave présent) }.
 */
(function (racine) {
  "use strict";

  function detecter(ua, opts) {
    ua = String(ua || ""); opts = opts || {};
    var ipadBureau = /Macintosh/.test(ua) && !!opts.tactile; // iPadOS se présente comme un Mac
    var ios = /iPhone|iPad|iPod/.test(ua) || ipadBureau;
    var android = !ios && /Android/.test(ua);
    var appareil = /iPad/.test(ua) || ipadBureau ? "ipad" : ios ? "iphone" : android ? "android" : "ordinateur";
    var navigateur;
    if (ios) navigateur = /CriOS/.test(ua) ? "chrome" : /FxiOS/.test(ua) ? "firefox" : /EdgiOS/.test(ua) ? "edge" : /OPiOS|GSA\/|FBAN|FBAV|Instagram/.test(ua) ? "autre" : /Safari\//.test(ua) ? "safari" : "autre";
    else navigateur = /SamsungBrowser/.test(ua) ? "samsung" : /Edg\//.test(ua) ? "edge" : /Firefox\//.test(ua) ? "firefox" : /OPR\//.test(ua) ? "autre"
      : opts.brave ? "brave" : /Chrome\//.test(ua) ? "chrome" : /Safari\//.test(ua) ? "safari" : "autre";
    var cas;
    if (ios) cas = navigateur === "safari" ? "ios-safari" : "ios-autre";
    else if (android) cas = navigateur === "firefox" ? "android-firefox" : "android";
    else cas = navigateur === "firefox" ? "bureau-firefox" : navigateur === "safari" ? "bureau-safari" : navigateur === "autre" ? "bureau-autre" : "bureau-chrome";
    return { appareil: appareil, ios: ios, android: android, navigateur: navigateur, cas: cas, installee: !!opts.standalone, invitation: !!opts.invitation };
  }

  var NOM_APPAREIL = { iphone: "iPhone", ipad: "iPad", android: "téléphone Android", ordinateur: "ordinateur" };
  var NOM_NAV = { safari: "Safari", chrome: "Chrome", edge: "Edge", brave: "Brave", samsung: "Samsung Internet", firefox: "Firefox", autre: "ce navigateur" };

  /**
   * Guide d'installation : { titre, etapes: [{ emoji, texte }], note, bouton } ;
   * bouton = "invitation" (fenêtre Microsoft/Google en un geste) quand le navigateur la propose.
   */
  function guide(p) {
    var app = NOM_APPAREIL[p.appareil], nav = NOM_NAV[p.navigateur];
    if (p.invitation && !p.ios) return { titre: "Installer en un geste", bouton: "invitation", etapes: [
      { emoji: "👆", texte: "Touchez « Installer l'application » ci-dessous." },
      { emoji: "✅", texte: "Confirmez « Installer » dans la petite fenêtre." }], note: "L'icône apparaît sur l'écran d'accueil (ou le bureau)." };
    switch (p.cas) {
      case "ios-safari": return { titre: "Sur votre " + app + ", en 2 gestes", etapes: [
        { emoji: "⬆️", texte: p.appareil === "ipad" ? "Touchez Partager ⬆️ (en haut à droite)." : "Touchez Partager ⬆️ (en bas de l'écran ; touchez d'abord ⋯ si vous ne le voyez pas)." },
        { emoji: "➕", texte: "Choisissez « Sur l'écran d'accueil », puis « Ajouter »." }], note: "Apple ne permet pas d'installer d'un seul bouton : ces 2 gestes sont la seule façon." };
      case "ios-autre": return { titre: "Ouvrez cette page dans Safari", etapes: [
        { emoji: "🧭", texte: "Sur iPhone et iPad, seule l'appli Safari sait installer : copiez l'adresse et ouvrez-la dans Safari." },
        { emoji: "⬆️", texte: "Puis touchez Partager ⬆️ › « Sur l'écran d'accueil »." }], note: "Vous êtes dans " + nav + "." , copier: true };
      case "android": return { titre: "Sur votre téléphone Android", etapes: [
        { emoji: "⋮", texte: "Touchez le menu ⋮ (en haut à droite)." },
        { emoji: "📲", texte: "Choisissez « Installer l'application » (ou « Ajouter à l'écran d'accueil »)." }], note: "" };
      case "android-firefox": return { titre: "Sur votre téléphone Android (Firefox)", etapes: [
        { emoji: "⋮", texte: "Touchez le menu ⋮." },
        { emoji: "📲", texte: "Choisissez « Ajouter à l'écran d'accueil »." }], note: "Avec Chrome, l'installation est plus simple." };
      case "bureau-chrome": return { titre: "Sur cet ordinateur (" + nav + ")", etapes: [
        { emoji: "🖥️", texte: "Cliquez sur l'icône d'installation à droite de la barre d'adresse (un écran avec une flèche)." },
        { emoji: "✅", texte: "Ou menu ⋮ › « Installer Espace Breteuil… » (Edge : ⋯ › Applications)." }], note: "" };
      case "bureau-safari": return { titre: "Sur ce Mac (Safari)", etapes: [
        { emoji: "📁", texte: "Menu Fichier › « Ajouter au Dock »." },
        { emoji: "✅", texte: "Cliquez sur « Ajouter »." }], note: "Nécessite macOS Sonoma (2023) ou plus récent ; sinon, utilisez Chrome ou Edge." };
      case "bureau-firefox": return { titre: "Firefox ne sait pas installer d'applis web", etapes: [
        { emoji: "🌐", texte: "Ouvrez cette adresse dans Chrome ou Edge, puis installez depuis la barre d'adresse." }], note: "Vous pouvez aussi garder Firefox et ajouter la page à vos favoris.", copier: true };
      default: return { titre: "Installer l'appli", etapes: [
        { emoji: "🌐", texte: "Ouvrez cette adresse dans Chrome, Edge ou Safari pour l'installer." }], note: "", copier: true };
    }
  }

  /** Geste exact pour désinstaller (toujours fait par la personne : une appli web ne peut pas se supprimer elle-même). */
  function desinstaller(p) {
    if (p.ios) return { etapes: [
      { emoji: "👆", texte: "Sur l'écran d'accueil, appui long sur l'icône Breteuil." },
      { emoji: "🗑️", texte: "Touchez « Supprimer l'app », puis confirmez." }] };
    if (p.android) return { etapes: [
      { emoji: "👆", texte: "Appui long sur l'icône Breteuil." },
      { emoji: "🗑️", texte: "Touchez « Désinstaller » (ou glissez l'icône vers « Désinstaller »)." }] };
    if (p.navigateur === "safari") return { etapes: [
      { emoji: "📁", texte: "Ouvrez le Finder › Applications (dossier de votre compte)." },
      { emoji: "🗑️", texte: "Glissez « Espace Breteuil » dans la corbeille." }] };
    return { etapes: [
      { emoji: "⋮", texte: "Dans la fenêtre de l'appli, ouvrez le menu ⋮ (ou ⋯) en haut à droite." },
      { emoji: "🗑️", texte: "Choisissez « Désinstaller Espace Breteuil »." }] };
  }

  /**
   * Bandeau « Le logo a changé » (iPhone/iPad installé seulement : Android met l'icône à jour tout seul).
   * installee : version de l'icône au moment de l'installation (gardée sur l'appareil) ; publiee : version
   * actuellement publiée ; dejaVu : dernière version pour laquelle le bandeau a été montré.
   */
  function iconeAChange(p, installee, publiee, dejaVu) {
    if (!p || !p.ios || !p.installee) return false;
    installee = Number(installee) || 0; publiee = Number(publiee) || 0;
    return !!installee && publiee > installee && Number(dejaVu || 0) < publiee;
  }

  var api = { detecter: detecter, guide: guide, desinstaller: desinstaller, iconeAChange: iconeAChange, NOM_APPAREIL: NOM_APPAREIL, NOM_NAV: NOM_NAV };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.EBPlateforme = api;
})(typeof self !== "undefined" ? self : this);
