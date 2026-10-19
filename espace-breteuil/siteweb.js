/*
 * Espace Breteuil — v5.1 : section « Site web » (www.breteuil.fr, WordPress).
 * Partie SANS écran (testée sous Node) : adresses WordPress, pas-à-pas, tri des liens vérifiés.
 *
 * Faits vérifiés sur le site (via /wp-json/ public) : WordPress, thème Astra, Elementor + Elementor Pro
 * (bas de page = modèle « Pied de page » du Theme Builder), WPML (français / anglais), WP Rocket (cache),
 * Smush (images), Rank Math (référencement).
 * Aucune adresse inventée : seules celles de config.js (siteWeb.url, siteWeb.admin) et les pages
 * d'administration WordPress listées ci-dessous.
 */
(function (racine) {
  "use strict";

  function config(cfg) {
    var s = (cfg && cfg.siteWeb) || {};
    var site = String(s.url || "https://www.breteuil.fr").replace(/\/+$/, "");
    var admin = String(s.admin || site + "/wp-admin/").replace(/\/*$/, "/");
    return { site: site, admin: admin, groupe: s.groupe || "" };
  }

  /** Adresses utiles (toutes dans l'administration WordPress du site). */
  function adresses(cfg) {
    var c = config(cfg), a = c.admin;
    return {
      site: c.site + "/",
      admin: a,
      medias: a + "upload.php",
      piedDePage: a + "edit.php?post_type=elementor_library&tabs_group=theme",
      menus: a + "nav-menus.php",
      pages: a + "edit.php?post_type=page",
    };
  }

  /** Typographie : espace insécable dans les guillemets (« Pied de page » ne se coupe pas à la ligne). */
  function insecable(t) { return String(t).replace(/« /g, "«\u00a0").replace(/ »/g, "\u00a0»"); }
  /** Pas-à-pas (3 étapes au plus), dans l'ordre des tuiles. */
  function guides(cfg) {
    return brutes(cfg).map(function (g) {
      g.etapes = g.etapes.map(insecable);
      if (g.note) g.note = insecable(g.note);
      return g;
    });
  }
  function brutes(cfg) {
    var u = adresses(cfg);
    return [
      { id: "image", titre: "Remplacer une image", icone: "photo",
        etapes: [
          "Ouvrez la Médiathèque avec le bouton ci-dessous, puis connectez-vous à WordPress.",
          "« Ajouter un fichier média » : choisissez la nouvelle image, au même format que l'ancienne (en largeur ou en hauteur), avec un nom clair, par exemple « facade-chateau-ete.jpg ».",
          "Ouvrez la page avec Elementor, cliquez sur l'ancienne image puis sur « Choisir une image », prenez la nouvelle et cliquez sur « Mettre à jour ». Videz ensuite le cache.",
        ],
        note: "Inutile d'alléger les photos avant : Smush les optimise tout seul à l'envoi.",
        lien: { url: u.medias, texte: "Ouvrir la Médiathèque" } },
      { id: "pied", titre: "Liens du bas de page", icone: "lien",
        etapes: [
          "Ouvrez les modèles du Theme Builder avec le bouton ci-dessous et repérez celui de type « Pied de page ».",
          "Survolez-le, cliquez sur « Modifier avec Elementor », cliquez sur le lien à corriger et changez son adresse dans le panneau de gauche. Cliquez sur « Mettre à jour ».",
          "Refaites-le pour la version anglaise : sélecteur de langue WPML (drapeau en haut de l'écran) → « English ». Puis videz le cache.",
        ],
        note: "Si ce lien fait partie d'un menu (la même liste de liens à plusieurs endroits), il se change dans Apparence → Menus.",
        lien: { url: u.piedDePage, texte: "Ouvrir les modèles" },
        lien2: { url: u.menus, texte: "Ouvrir les menus" } },
      { id: "couleurs", titre: "Couleurs du site", icone: "palette",
        prudence: "À faire de préférence sur le site de test : une couleur change partout d'un coup.",
        etapes: [
          "Ouvrez une page avec Elementor : liste des pages (bouton ci-dessous) → survolez une page → « Modifier avec Elementor ».",
          "Menu ☰ en haut à gauche → « Paramètres du site » → « Couleurs globales ». Changez seulement les couleurs de la palette, rien d'autre.",
          "Cliquez sur « Mettre à jour », puis videz le cache. En cas de doute, l'Historique d'Elementor (icône d'horloge) remet la version d'avant.",
        ],
        lien: { url: u.pages, texte: "Ouvrir la liste des pages" } },
      { id: "page", titre: "Modifier une page", icone: "page",
        etapes: [
          "Ouvrez la liste des pages avec le bouton ci-dessous et cherchez la page avec la case « Rechercher ».",
          "Survolez son nom et cliquez sur « Modifier avec Elementor ». Cliquez sur un texte ou une image pour le changer.",
          "Cliquez sur « Mettre à jour ». Pensez à la version anglaise (sélecteur de langue WPML), puis videz le cache.",
        ],
        lien: { url: u.pages, texte: "Ouvrir la liste des pages" } },
      { id: "cache", titre: "Rafraîchir le site (vider le cache)", icone: "actualiser",
        etapes: [
          "Ouvrez WordPress avec le bouton ci-dessous et connectez-vous.",
          "Dans la barre noire tout en haut de l'écran, survolez « WP Rocket ».",
          "Cliquez sur « Vider le cache ». Rechargez le site : la modification apparaît.",
        ],
        note: "À faire après CHAQUE modification : sinon le site continue d'afficher l'ancienne version.",
        lien: { url: u.admin, texte: "Ouvrir WordPress" } },
    ];
  }
  function guide(cfg, id) { return guides(cfg).filter(function (g) { return g.id === id; })[0] || null; }

  /** Tuiles de la section (externe = nouvel onglet WordPress ; sinon écran de l'appli). */
  function tuiles(cfg) {
    var u = adresses(cfg);
    return [
      { id: "liens", libelle: "Vérifier les liens", icone: "loupe", href: "#/liens", sous: "Les liens du bas de page marchent-ils ?", aide: "Vérifier que les liens du bas de page du site marchent" },
      { id: "image", libelle: "Remplacer une image", icone: "photo", href: u.medias, externe: true, sous: "Dans les images du site", aide: "Médiathèque de WordPress (nouvel onglet)" },
      { id: "pied", libelle: "Liens du bas de page", icone: "lien", href: u.piedDePage, externe: true, sous: "Changer un lien en bas des pages", aide: "Modèle « Pied de page » d'Elementor (nouvel onglet)" },
      { id: "couleurs", libelle: "Couleurs du site", icone: "palette", href: "#/guides/site/couleurs", sous: "Mode d'emploi en 3 étapes", aide: "Pas à pas : couleurs globales d'Elementor" },
      { id: "page", libelle: "Modifier une page", icone: "page", href: u.pages, externe: true, sous: "Changer un texte ou une photo", aide: "Liste des pages de WordPress (nouvel onglet)" },
      { id: "cache", libelle: "Rafraîchir le site", icone: "actualiser", href: "#/guides/site/cache", sous: "Après une modification (vider le cache)", aide: "Pas à pas : vider le cache de WP Rocket après une modification" },
      { id: "voir", libelle: "Voir le site", icone: "globe", href: u.site, externe: true, sous: "www.breteuil.fr", aide: "Ouvrir www.breteuil.fr (nouvel onglet)" },
      { id: "guides", libelle: "Modes d'emploi", icone: "livre", href: "#/guides/site", sous: "Tous les gestes, pas à pas", aide: "Tous les modes d'emploi, en 3 étapes" },
    ];
  }

  /* ------------------------------------------------------------------ */
  /* Vérificateur de liens : tri et phrases simples                      */
  /* ------------------------------------------------------------------ */
  var BLOQUES = [401, 403, 429, 999]; // sites qui refusent les robots (réseaux sociaux…) : rien ne prouve que le lien est cassé

  /** Introuvable confirmé par un vrai GET (le Worker refait en GET les HEAD douteux). */
  function introuvableConfirme(l) { return (l.statut === 404 || l.statut === 410) && l.methode === "GET"; }
  /** « casse » (rouge, seulement si un GET a répondu 404/410), « verifier » (orange : redirigé, robot refusé,
   *  ne répond pas, panne, 404 non confirmé) ou « ok ». */
  function classer(l) {
    if (l && l.ok) return l.redirigeVers ? "verifier" : "ok";
    if (l && introuvableConfirme(l)) return "casse";
    return "verifier";
  }
  function trier(liens) {
    var g = { casse: [], verifier: [], ok: [] };
    (liens || []).forEach(function (l) { if (l && l.url) g[classer(l)].push(l); });
    return g;
  }
  function phrase(l) {
    var s = l.statut;
    if (l.ok && l.redirigeVers) return "Marche, mais mène maintenant ailleurs. À mettre à jour si possible.";
    if (l.ok) return "Marche.";
    if (s == null) return "Ne répond pas (site trop lent ou adresse inconnue) : ouvrez le lien pour vérifier vous-même.";
    if (introuvableConfirme(l)) return "Page introuvable (erreur " + s + ").";
    if (s === 404 || s === 410) return "Semble introuvable (erreur " + s + ", non confirmée) : ouvrez le lien pour vérifier vous-même.";
    if (BLOQUES.indexOf(s) > -1) return "Ce site refuse les vérifications automatiques (code " + s + ") : ouvrez le lien pour vérifier vous-même.";
    if (s >= 500) return "Le site en face est peut-être en panne (erreur " + s + ") : ouvrez le lien pour vérifier vous-même.";
    return "Réponse inattendue (code " + s + ") : ouvrez le lien pour vérifier vous-même.";
  }

  /* ------------------------------------------------------------------ */
  /* Entités HTML (&rsquo; &eacute;…) : décodées en TEXTE, jamais en HTML  */
  /* ------------------------------------------------------------------ */
  var ENTITES = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", thinsp: "\u2009", ensp: "\u2002", emsp: "\u2003", shy: "",
    rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201d", ldquo: "\u201c", sbquo: "\u201a", bdquo: "\u201e", laquo: "\u00ab", raquo: "\u00bb",
    lsaquo: "\u2039", rsaquo: "\u203a", hellip: "\u2026", ndash: "\u2013", mdash: "\u2014", bull: "\u2022", middot: "\u00b7", prime: "\u2032",
    agrave: "à", aacute: "á", acirc: "â", atilde: "ã", auml: "ä", aring: "å", aelig: "æ", ccedil: "ç",
    egrave: "è", eacute: "é", ecirc: "ê", euml: "ë", igrave: "ì", iacute: "í", icirc: "î", iuml: "ï",
    ntilde: "ñ", ograve: "ò", oacute: "ó", ocirc: "ô", otilde: "õ", ouml: "ö", oslash: "ø", oelig: "œ",
    ugrave: "ù", uacute: "ú", ucirc: "û", uuml: "ü", yacute: "ý", yuml: "ÿ", szlig: "ß",
    Agrave: "À", Aacute: "Á", Acirc: "Â", Atilde: "Ã", Auml: "Ä", Aring: "Å", AElig: "Æ", Ccedil: "Ç",
    Egrave: "È", Eacute: "É", Ecirc: "Ê", Euml: "Ë", Igrave: "Ì", Iacute: "Í", Icirc: "Î", Iuml: "Ï",
    Ntilde: "Ñ", Ograve: "Ò", Oacute: "Ó", Ocirc: "Ô", Otilde: "Õ", Ouml: "Ö", Oslash: "Ø", OElig: "Œ",
    Ugrave: "Ù", Uacute: "Ú", Ucirc: "Û", Uuml: "Ü", Yacute: "Ý", Yuml: "Ÿ",
    euro: "€", pound: "£", cent: "¢", yen: "¥", deg: "°", copy: "©", reg: "®", trade: "™", sect: "§", para: "¶",
    times: "×", divide: "÷", plusmn: "±", frac12: "½", frac14: "¼", frac34: "¾", sup2: "²", sup3: "³", ordf: "ª", ordm: "º",
    iexcl: "¡", iquest: "¿", dagger: "†", larr: "←", rarr: "→", uarr: "↑", darr: "↓", hearts: "♥", check: "✓",
  };
  /** « Groupes d&rsquo;enfants » → « Groupes d’enfants ». Sortie = texte brut (à poser avec textContent). */
  function decoder(t) {
    return String(t == null ? "" : t).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, function (m, e) {
      if (e.charAt(0) === "#") {
        var n = e.charAt(1) === "x" || e.charAt(1) === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
      }
      var v = Object.prototype.hasOwnProperty.call(ENTITES, e) ? ENTITES[e] : ENTITES[e.toLowerCase()];
      return typeof v === "string" ? v : m;
    });
  }
  /** Adresse lisible : sans https://, sans www., coupée si trop longue. */
  function courte(url, max) {
    var t = String(url || "").replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
    max = max || 60;
    return t.length > max ? t.slice(0, max - 1) + "…" : t;
  }
  /** Message d'erreur quand le vérificateur ne répond pas. e : { statut, reseau, horsLigne }. */
  function messageErreur(e) {
    e = e || {};
    if (e.horsLigne) return { titre: "Pas de connexion internet", texte: "Réessayez quand le téléphone est connecté." };
    if (e.reseau || e.statut === 404 || e.statut === 405) return { titre: "Le vérificateur n'est pas encore installé", texte: "Damien doit mettre à jour le service. Rien n'est cassé de votre côté." };
    if (e.statut === 502 || e.statut === 504) return { titre: "Le site www.breteuil.fr ne répond pas", texte: "Réessayez dans quelques minutes. S'il ne s'ouvre pas non plus dans le navigateur, prévenez Damien." };
    return { titre: "La vérification n'a pas abouti", texte: "Réessayez dans une minute. Si cela recommence, prévenez Damien." + (e.statut ? " (code " + e.statut + ")" : "") };
  }

  var api = { config: config, adresses: adresses, guides: guides, guide: guide, tuiles: tuiles, classer: classer, decoder: decoder, trier: trier, phrase: phrase, courte: courte, messageErreur: messageErreur };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.EBSiteWeb = api;
})(typeof self !== "undefined" ? self : this);
