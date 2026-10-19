/*
 * Espace Breteuil — v5.7 : « Apparence » (palettes, couleurs, coins, polices, en-tête, logo).
 *
 * Partie SANS écran (testée sous Node, tests/apparence.test.mjs) et chargée AVANT le premier rendu
 * (prechargement.js) : aucune dépendance, aucun accès réseau.
 *
 *   - calcul des couleurs en OKLCH (teinte et clarté perçues) ; contraste WCAG ;
 *   - assurer() : éclaircit ou fonce une couleur jusqu'au contraste demandé (AA : 4,5:1 texte, 3:1 accents) ;
 *   - deriver() : à partir de 2 couleurs (principale, accent) + un ton de fond (chaud, neutre, froid),
 *     TOUTES les variables de l'appli (texte, traits, survols, pastilles de statut…), en clair et en sombre ;
 *   - PALETTES : 10 palettes choisies (crème & praline et Bleu élégant = les feuilles de style d'origine) ;
 *   - valider() : contrôle du fichier partagé apparence.json (SharePoint), 5 versions gardées pour revenir en arrière ;
 *   - appliquer() : pose les variables sur <html> (CSSOM : compatible avec la CSP stricte, aucun style en ligne écrit
 *     dans le HTML) et la couleur du navigateur (meta theme-color).
 *
 * Clé interne « bleu » = « Bleu élégant » (anciennement « Bleu Breteuil ») : les choix déjà enregistrés restent valables.
 */
(function (racine) {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* Couleurs : hexadécimal ↔ sRGB ↔ OKLab / OKLCH                        */
  /* ------------------------------------------------------------------ */
  function estHex(v) { return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v); }
  function versRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!m) return null;
    return [0, 2, 4].map(function (i) { return parseInt(m[1].slice(i, i + 2), 16) / 255; });
  }
  function versHex(rgb) {
    return "#" + rgb.map(function (x) {
      var v = Math.round(Math.max(0, Math.min(1, x)) * 255);
      return (v < 16 ? "0" : "") + v.toString(16);
    }).join("").toUpperCase();
  }
  function lineaire(x) { return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }
  function gamma(x) { return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; }

  function oklab(hex) {
    var c = versRgb(hex).map(lineaire), r = c[0], g = c[1], b = c[2];
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }
  function labVersRgbLineaire(L, a, b) {
    var l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    var m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    var s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  }
  /** Hex → { l (0–1), c (≈ 0–0,37), h (degrés) }. */
  function oklch(hex) {
    var o = oklab(hex), c = Math.sqrt(o[1] * o[1] + o[2] * o[2]);
    var h = Math.atan2(o[2], o[1]) * 180 / Math.PI;
    return { l: o[0], c: c, h: h < 0 ? h + 360 : h };
  }
  function dansGamut(rgb) { return rgb.every(function (x) { return x >= -0.0005 && x <= 1.0005; }); }
  /** OKLCH → hex. Hors du gamut sRGB : la saturation est réduite (teinte et clarté gardées). */
  function depuisOklch(l, c, h) {
    l = Math.max(0, Math.min(1, l)); c = Math.max(0, c || 0);
    var rad = (h || 0) * Math.PI / 180;
    function essai(cc) { return labVersRgbLineaire(l, cc * Math.cos(rad), cc * Math.sin(rad)); }
    var rgb = essai(c);
    if (!dansGamut(rgb)) {
      var bas = 0, haut = c;
      for (var i = 0; i < 24; i++) { var mil = (bas + haut) / 2; if (dansGamut(essai(mil))) bas = mil; else haut = mil; }
      rgb = essai(bas);
    }
    return versHex(rgb.map(function (x) { return gamma(Math.max(0, Math.min(1, x))); }));
  }
  function lch(l, c, h) { return depuisOklch(l, c, h); }

  /* ------------------------------------------------------------------ */
  /* Contraste WCAG 2.x                                                   */
  /* ------------------------------------------------------------------ */
  function luminance(hex) {
    var c = versRgb(hex).map(lineaire);
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contraste(a, b) {
    var x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function contrasteMin(fg, fonds) { return Math.min.apply(null, fonds.map(function (f) { return contraste(fg, f); })); }
  /**
   * Couleur la plus proche de « fg » (même teinte) qui atteint « min » contre TOUS les fonds.
   * Fonds clairs → on fonce ; fonds sombres → on éclaircit. Renvoie fg inchangée si c'est déjà bon.
   */
  function assurer(fg, fonds, min) {
    fonds = [].concat(fonds);
    if (contrasteMin(fg, fonds) >= min) return fg.toUpperCase();
    var o = oklch(fg);
    var lumFond = fonds.reduce(function (s, f) { return s + luminance(f); }, 0) / fonds.length;
    var sens = lumFond > 0.18 ? -1 : 1;
    var meilleur = fg.toUpperCase();
    for (var i = 1; i <= 200; i++) {
      var l = o.l + sens * i * 0.005;
      if (l < 0 || l > 1) break;
      var cand = depuisOklch(l, o.c, o.h);
      meilleur = cand;
      if (contrasteMin(cand, fonds) >= min) return cand;
    }
    // Ultime recours (fonds incompatibles entre eux) : noir ou blanc, le meilleur des deux.
    return contrasteMin("#000000", fonds) >= contrasteMin("#FFFFFF", fonds) ? (contrasteMin(meilleur, fonds) >= min ? meilleur : "#000000") : "#FFFFFF";
  }
  function rgba(hex, a) { var c = versRgb(hex); return "rgba(" + c.map(function (x) { return Math.round(x * 255); }).join(",") + "," + a + ")"; }

  /* ------------------------------------------------------------------ */
  /* Palettes choisies et options                                         */
  /* ------------------------------------------------------------------ */
  /* css = palette dessinée à la main dans app.css (utilisée telle quelle si rien n'est personnalisé). */
  var PALETTES = [
    { id: "creme", nom: "Crème et praline", phrase: "L'original : crème, praline et doré", primaire: "#8A4C45", accent: "#C9A04A", ton: "chaud", css: "creme" },
    { id: "bleu", nom: "Bleu élégant", phrase: "Bleu nuit profond et doré", primaire: "#1F3A68", accent: "#C9A04A", ton: "froid", css: "bleu" },
    { id: "sauge", nom: "Vert sauge", phrase: "Vert doux et lin", primaire: "#3F6B4A", accent: "#B8A060", ton: "chaud" },
    { id: "bordeaux", nom: "Bordeaux", phrase: "Lie-de-vin et vieil or", primaire: "#7A1F35", accent: "#C9A04A", ton: "chaud" },
    { id: "ardoise", nom: "Ardoise", phrase: "Gris bleuté et cuivre", primaire: "#3F4C5A", accent: "#C08552", ton: "neutre" },
    { id: "sable", nom: "Sable et or", phrase: "Brun chaud et or", primaire: "#7A5A2E", accent: "#D4AF37", ton: "chaud" },
    { id: "nuit", nom: "Nuit", phrase: "Presque noir et laiton", primaire: "#232634", accent: "#C9A04A", ton: "neutre" },
    { id: "lavande", nom: "Lavande", phrase: "Violet doux et rose poudré", primaire: "#5E4C80", accent: "#D49BB0", ton: "froid" },
    { id: "terre", nom: "Terre cuite", phrase: "Orangé brique et olive", primaire: "#9A4A2A", accent: "#9A9A50", ton: "chaud" },
    { id: "foret", nom: "Forêt", phrase: "Vert sapin et ambre", primaire: "#1F4D3A", accent: "#D9A441", ton: "neutre" },
  ];
  var TONS = [["chaud", "Chaud", "Fond crème"], ["neutre", "Neutre", "Fond gris très clair"], ["froid", "Froid", "Fond bleuté"]];
  var COINS = [["carre", "Carrés"], ["doux", "Doux"], ["rond", "Ronds"]];
  var POLICES = [["classique", "Classique", "Titres élégants (Spectral), texte Archivo"], ["moderne", "Moderne", "Archivo partout"], ["systeme", "Comme le téléphone", "La police de l'appareil"]];
  var ENTETES = [["uni", "Uni", "Couleur pleine"], ["degrade", "Dégradé", "De la couleur foncée à la principale"], ["clair", "Clair", "En-tête clair, texte foncé"]];
  var RAYONS = { carre: ["6px", "4px"], doux: ["16px", "12px"], rond: ["24px", "18px"] };
  var POLICE_VARS = {
    moderne: { "--serif": "\"Archivo\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif" },
    systeme: { "--sans": "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif",
      "--serif": "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif" },
  };
  function palette(id) { for (var i = 0; i < PALETTES.length; i++) if (PALETTES[i].id === id) return PALETTES[i]; return null; }
  function dans(liste, v) { return liste.some(function (x) { return x[0] === v; }); }

  /* Paires vérifiées (texte ≥ 4,5:1, accents non textuels ≥ 3:1) — les mêmes que tests/theme.test.mjs. */
  var PAIRES = [
    ["--texte", "--fond", 4.5], ["--texte", "--surface", 4.5], ["--texte", "--surface-2", 4.5],
    ["--texte-2", "--fond", 4.5], ["--texte-2", "--surface", 4.5], ["--texte-2", "--surface-2", 4.5],
    ["--texte-3", "--fond", 4.5], ["--texte-3", "--surface", 4.5],
    ["--primaire", "--fond", 4.5], ["--primaire", "--surface", 4.5], ["--sur-primaire", "--primaire", 4.5],
    ["--primaire-fort", "--primaire-pale", 4.5],
    ["--entete-texte", "--entete", 4.5], ["--entete-doux", "--entete", 4.5],
    ["--or-texte", "--fond", 4.5], ["--or-texte", "--surface", 4.5],
    ["--info-texte", "--info-fond", 4.5], ["--exemple-texte", "--exemple-fond", 4.5],
    ["--praline-texte", "--praline-1", 4.5], ["--praline-texte", "--praline-2", 4.5], ["--praline-doux", "--praline-1", 4.5],
    ["--commun-doux", "--commun-1", 4.5], ["--commun-doux", "--commun-2", 4.5],
    ["--c-praline", "--c-praline-f", 4.5],
    ["--focus", "--fond", 3], ["--or", "--entete", 3],
    ["--statut-confirmer-texte", "--statut-confirmer-fond", 4.5], ["--statut-envoyee-texte", "--statut-envoyee-fond", 4.5],
    ["--statut-cours-texte", "--statut-cours-fond", 4.5], ["--statut-termine-texte", "--statut-termine-fond", 4.5],
  ];
  /** Paires en échec (liste de textes) pour un jeu de variables. */
  function controler(v) {
    var echecs = [];
    PAIRES.forEach(function (p) {
      if (!estHex(v[p[0]]) || !estHex(v[p[1]])) { echecs.push(p[0] + " / " + p[1] + " manquant"); return; }
      var r = contraste(v[p[0]], v[p[1]]);
      if (r < p[2]) echecs.push(p[0] + " sur " + p[1] + " : " + r.toFixed(2) + ":1");
    });
    return echecs;
  }

  /* ------------------------------------------------------------------ */
  /* Dérivation : 2 couleurs + un ton → toutes les variables               */
  /* ------------------------------------------------------------------ */
  var BLANC = "#FFFFFF";
  /**
   * base : { primaire, accent, ton, entete ("uni" | "degrade" | "clair") }. sombre : booléen.
   * Renvoie { "--fond": "#…", … } : toutes les couleurs que les palettes d'app.css définissent.
   */
  function deriver(base, sombre) {
    var p = oklch(base.primaire), a = oklch(base.accent), ton = base.ton || "chaud";
    var pc = Math.min(p.c, 0.16);
    var fondH = ton === "chaud" ? 80 : ton === "froid" ? 255 : p.h;
    var fondC = sombre ? (ton === "chaud" ? 0.016 : ton === "froid" ? 0.024 : 0.008) : (ton === "chaud" ? 0.02 : ton === "froid" ? 0.012 : 0.005);
    var v = {}, F = function (l, k) { return lch(l, fondC * (k == null ? 1 : k), fondH); };
    if (!sombre) {
      v["--fond"] = F(0.975); v["--surface"] = F(0.995, 0.4); v["--surface-2"] = F(0.94, 1.3);
      v["--trait"] = F(0.895, 1.5); v["--trait-fort"] = F(0.79, 1.8); v["--appui"] = lch(0.925, Math.min(pc, 0.035), p.h);
      v["--squelette"] = F(0.93, 1.2); v["--squelette-reflet"] = F(0.965);
      var fondsClairs = [v["--fond"], v["--surface"], v["--surface-2"]];
      v["--texte"] = assurer(lch(0.25, Math.min(fondC * 1.6, 0.03), fondH), fondsClairs, 7);
      v["--texte-2"] = assurer(lch(0.43, Math.min(fondC * 1.8, 0.04), fondH), fondsClairs, 4.5);
      v["--texte-3"] = assurer(lch(0.49, Math.min(fondC * 1.8, 0.04), fondH), [v["--fond"], v["--surface"], v["--surface-2"]], 4.5);
      v["--primaire-pale"] = lch(0.935, Math.min(pc, 0.035), p.h);
      v["--primaire"] = assurer(base.primaire, [v["--fond"], v["--surface"], v["--primaire-pale"], BLANC], 4.5);
      var pp = oklch(v["--primaire"]);
      v["--primaire-fort"] = assurer(lch(pp.l - 0.08, pp.c, pp.h), [v["--primaire-pale"], BLANC], 6);
      v["--sur-primaire"] = BLANC;
      v["--entete"] = assurer(lch(Math.min(p.l - 0.06, 0.36), Math.min(pc, 0.11), p.h), [BLANC], 8);
      v["--entete-2"] = v["--primaire"];
      v["--entete-texte"] = BLANC;
      v["--entete-doux"] = assurer(lch(0.9, Math.min(a.c, 0.05), a.h), [v["--entete"], v["--entete-2"]], 4.5);
      v["--or"] = assurer(base.accent, [v["--entete"], v["--entete-2"]], 3);
      v["--or-texte"] = assurer(base.accent, [v["--fond"], v["--surface"], v["--surface-2"]], 4.5);
      v["--focus"] = v["--or-texte"];
      v["--exemple-fond"] = lch(0.95, 0.045, 85); v["--exemple-texte"] = assurer(lch(0.42, 0.1, 70), [v["--exemple-fond"]], 4.5);
      v["--info-fond"] = v["--primaire-pale"]; v["--info-texte"] = assurer(v["--entete"], [v["--info-fond"]], 4.5);
      v["--c-praline-f"] = v["--primaire-pale"]; v["--c-praline"] = assurer(v["--primaire"], [v["--c-praline-f"]], 4.5);
      v["--praline-1"] = v["--primaire"]; v["--praline-2"] = v["--primaire-fort"]; v["--praline-texte"] = BLANC;
      v["--praline-doux"] = assurer(lch(0.93, Math.min(pc, 0.03), p.h), [v["--praline-1"], v["--praline-2"]], 4.5);
      v["--commun-1"] = v["--entete"]; v["--commun-2"] = v["--primaire-fort"];
      v["--commun-doux"] = assurer(v["--praline-doux"], [v["--commun-1"], v["--commun-2"]], 4.5);
      v["--licence-1"] = v["--primaire"]; v["--licence-2"] = v["--entete"];
      v["--an-1"] = v["--trait"]; v["--an-2"] = base.accent.toUpperCase(); v["--an-3"] = lch(0.92, Math.min(a.c, 0.05), a.h);
      v["--an-4"] = v["--primaire"]; v["--an-5"] = lch(0.8, Math.min(pc * 0.7, 0.08), p.h);
      v["--reflet-base"] = v["--texte"]; v["--reflet-or"] = v["--or-texte"];
      v["--filet-or"] = base.accent.toUpperCase(); v["--filet-clair"] = v["--an-3"];
      v["--principal-icone"] = lch(0.97, 0.02, a.h); v["--principal-or"] = lch(0.82, Math.min(a.c, 0.11), a.h); v["--principal-accent"] = v["--an-5"];
      v["--statut-confirmer-fond"] = lch(0.95, 0.045, 85); v["--statut-confirmer-texte"] = assurer(lch(0.42, 0.1, 70), [v["--statut-confirmer-fond"]], 4.5);
      v["--statut-envoyee-fond"] = v["--primaire-pale"]; v["--statut-envoyee-texte"] = assurer(v["--primaire-fort"], [v["--statut-envoyee-fond"]], 4.5);
      v["--statut-cours-fond"] = lch(0.94, 0.04, 150); v["--statut-cours-texte"] = assurer(lch(0.42, 0.09, 150), [v["--statut-cours-fond"]], 4.5);
      v["--statut-termine-fond"] = F(0.93, 1.2); v["--statut-termine-texte"] = assurer(lch(0.46, 0.02, fondH), [v["--statut-termine-fond"]], 4.5);
      var o = v["--entete"];
      v["--ombre"] = "0 1px 2px " + rgba(o, 0.06) + ", 0 4px 14px " + rgba(o, 0.07);
      v["--ombre-forte"] = "0 14px 40px " + rgba(o, 0.2); v["--ombre-entete"] = "0 2px 10px " + rgba(o, 0.22);
      v["--verre"] = rgba(v["--surface"], 0.8); v["--verre-fort"] = rgba(v["--surface"], 0.9); v["--verre-trait"] = rgba(v["--trait-fort"], 0.55);
      v["--ombre-verre"] = "0 1px 2px " + rgba(o, 0.05) + ", 0 10px 30px -12px " + rgba(o, 0.18);
      v["--ombre-verre-forte"] = "0 2px 4px " + rgba(o, 0.06) + ", 0 18px 40px -14px " + rgba(o, 0.28);
      v["--halo-1"] = rgba(base.accent, 0.18); v["--halo-2"] = rgba(v["--primaire"], 0.12); v["--halo-3"] = rgba(v["--an-5"], 0.2);
      v["--onglet-actif"] = "linear-gradient(180deg, " + v["--primaire-pale"] + ", " + v["--appui"] + ")";
      v["--ombre-principal"] = "0 14px 34px -14px " + rgba(o, 0.6); v["--lueur"] = "rgba(255,255,255,.2)";
      v["--ombre-flottante"] = "0 16px 40px -16px " + rgba(o, 0.35); v["--ombre-choisi"] = "0 10px 24px -12px " + rgba(o, 0.6);
      v["--ombre-licence"] = "0 20px 44px -20px " + rgba(o, 0.65); v["--ombre-commun"] = "0 20px 44px -18px " + rgba(o, 0.6);
      v["--onde"] = rgba(v["--primaire"], 0.45); v["--voile"] = rgba(lch(0.15, fondC, fondH), 0.55); v["--ombre-onglets-bas"] = "0 -4px 16px " + rgba(o, 0.08);
    } else {
      v["--fond"] = F(0.17); v["--surface"] = F(0.21); v["--surface-2"] = F(0.245);
      v["--trait"] = F(0.32, 1.2); v["--trait-fort"] = F(0.42, 1.4); v["--appui"] = lch(0.29, Math.min(pc, 0.04), p.h);
      v["--squelette"] = F(0.245); v["--squelette-reflet"] = F(0.28);
      var fondsSombres = [v["--fond"], v["--surface"], v["--surface-2"]];
      v["--texte"] = assurer(lch(0.95, fondC, fondH), fondsSombres, 7);
      v["--texte-2"] = assurer(lch(0.84, fondC * 1.5, fondH), fondsSombres, 4.5);
      v["--texte-3"] = assurer(lch(0.76, fondC * 1.5, fondH), fondsSombres, 4.5);
      v["--primaire-pale"] = lch(0.29, Math.min(pc, 0.05), p.h);
      v["--primaire"] = assurer(lch(0.8, Math.min(pc, 0.1), p.h), [v["--fond"], v["--surface"], v["--primaire-pale"]], 4.5);
      v["--primaire-fort"] = assurer(lch(0.87, Math.min(pc, 0.08), p.h), [v["--primaire-pale"]], 6);
      v["--sur-primaire"] = assurer(lch(0.17, fondC, p.h), [v["--primaire"]], 4.5);
      v["--entete"] = lch(0.23, Math.min(pc, 0.06), p.h);
      v["--entete-2"] = assurer(lch(0.36, Math.min(pc, 0.1), p.h), [BLANC], 4.5);
      v["--entete-texte"] = BLANC;
      v["--entete-doux"] = assurer(lch(0.88, Math.min(a.c, 0.06), a.h), [v["--entete"], v["--entete-2"]], 4.5);
      v["--or"] = assurer(lch(Math.max(a.l, 0.8), a.c, a.h), [v["--entete"], v["--entete-2"]], 3);
      v["--or-texte"] = assurer(v["--or"], fondsSombres, 4.5);
      v["--focus"] = v["--or-texte"];
      v["--exemple-fond"] = lch(0.29, 0.05, 85); v["--exemple-texte"] = assurer(lch(0.9, 0.1, 85), [v["--exemple-fond"]], 4.5);
      v["--info-fond"] = v["--primaire-pale"]; v["--info-texte"] = assurer(lch(0.88, Math.min(pc, 0.04), p.h), [v["--info-fond"]], 4.5);
      v["--c-praline-f"] = lch(0.31, Math.min(pc, 0.05), p.h); v["--c-praline"] = assurer(lch(0.86, Math.min(pc, 0.06), p.h), [v["--c-praline-f"]], 4.5);
      v["--praline-1"] = assurer(lch(0.4, Math.min(pc, 0.1), p.h), [BLANC], 4.5);
      v["--praline-2"] = assurer(lch(0.33, Math.min(pc, 0.09), p.h), [BLANC], 4.5);
      v["--praline-texte"] = BLANC;
      v["--praline-doux"] = assurer(lch(0.92, Math.min(pc, 0.03), p.h), [v["--praline-1"], v["--praline-2"]], 4.5);
      v["--commun-1"] = v["--entete"]; v["--commun-2"] = v["--praline-2"];
      v["--commun-doux"] = assurer(v["--praline-doux"], [v["--commun-1"], v["--commun-2"]], 4.5);
      v["--licence-1"] = v["--praline-1"]; v["--licence-2"] = v["--praline-2"];
      v["--an-1"] = v["--trait"]; v["--an-2"] = v["--or"]; v["--an-3"] = v["--trait-fort"]; v["--an-4"] = v["--primaire"]; v["--an-5"] = v["--praline-1"];
      v["--reflet-base"] = v["--texte"]; v["--reflet-or"] = v["--or-texte"];
      v["--filet-or"] = v["--or"]; v["--filet-clair"] = lch(0.9, Math.min(a.c, 0.05), a.h);
      v["--principal-icone"] = lch(0.96, 0.02, a.h); v["--principal-or"] = v["--or"]; v["--principal-accent"] = v["--primaire"];
      v["--statut-confirmer-fond"] = lch(0.29, 0.05, 85); v["--statut-confirmer-texte"] = assurer(lch(0.9, 0.1, 85), [v["--statut-confirmer-fond"]], 4.5);
      v["--statut-envoyee-fond"] = v["--primaire-pale"]; v["--statut-envoyee-texte"] = assurer(v["--primaire-fort"], [v["--statut-envoyee-fond"]], 4.5);
      v["--statut-cours-fond"] = lch(0.3, 0.05, 150); v["--statut-cours-texte"] = assurer(lch(0.88, 0.08, 150), [v["--statut-cours-fond"]], 4.5);
      v["--statut-termine-fond"] = F(0.27, 1.2); v["--statut-termine-texte"] = assurer(lch(0.84, fondC, fondH), [v["--statut-termine-fond"]], 4.5);
      v["--ombre"] = "0 1px 2px rgba(0,0,0,.35), 0 4px 14px rgba(0,0,0,.25)";
      v["--ombre-forte"] = "0 14px 40px rgba(0,0,0,.45)"; v["--ombre-entete"] = "0 2px 10px rgba(0,0,0,.4)";
      v["--verre"] = rgba(v["--surface"], 0.8); v["--verre-fort"] = rgba(v["--surface"], 0.92); v["--verre-trait"] = rgba(v["--trait-fort"], 0.65);
      v["--ombre-verre"] = "0 1px 2px rgba(0,0,0,.3), 0 10px 30px -12px rgba(0,0,0,.55)";
      v["--ombre-verre-forte"] = "0 2px 4px rgba(0,0,0,.35), 0 18px 40px -14px rgba(0,0,0,.65)";
      v["--halo-1"] = rgba(v["--or"], 0.08); v["--halo-2"] = rgba(v["--primaire"], 0.08); v["--halo-3"] = rgba(v["--praline-1"], 0.2);
      v["--onglet-actif"] = "linear-gradient(180deg, " + v["--appui"] + ", " + v["--primaire-pale"] + ")";
      v["--ombre-principal"] = "0 14px 34px -14px rgba(0,0,0,.7)"; v["--lueur"] = "rgba(255,255,255,.14)";
      v["--ombre-flottante"] = "0 16px 40px -16px rgba(0,0,0,.6)"; v["--ombre-choisi"] = "0 10px 24px -12px rgba(0,0,0,.7)";
      v["--ombre-licence"] = "0 20px 44px -20px rgba(0,0,0,.7)"; v["--ombre-commun"] = "0 20px 44px -18px rgba(0,0,0,.6)";
      v["--onde"] = rgba(v["--primaire"], 0.45); v["--voile"] = "rgba(0,0,0,.6)"; v["--ombre-onglets-bas"] = "0 -4px 16px rgba(0,0,0,.3)";
    }
    // En-tête clair : fond clair, texte foncé (le reste ne change pas).
    if (base.entete === "clair") {
      v["--entete"] = sombre ? v["--surface-2"] : v["--surface"];
      v["--entete-2"] = v["--entete"];
      v["--entete-texte"] = v["--texte"];
      v["--entete-doux"] = assurer(v["--texte-2"], [v["--entete"]], 4.5);
      v["--or"] = assurer(sombre ? v["--or"] : base.accent, [v["--entete"]], 3);
      v["--ombre-entete"] = sombre ? "0 1px 0 " + v["--trait"] : "0 1px 0 " + v["--trait"] + ", 0 2px 10px " + rgba(v["--texte"], 0.06);
    }
    return v;
  }

  /* ------------------------------------------------------------------ */
  /* Couleur choisie au sélecteur : ajustée ou refusée (phrase simple)    */
  /* ------------------------------------------------------------------ */
  /**
   * role : "primaire" | "accent". Renvoie { ok, couleur, ajustee, message }.
   * Petite correction de clarté → acceptée (« ajustée ») ; trop loin du lisible → refusée.
   */
  function verifierCouleur(hex, role) {
    if (!estHex(hex)) return { ok: false, message: "Couleur non reconnue." };
    hex = hex.toUpperCase();
    var o = oklch(hex);
    if (role === "accent") {
      if (o.l < 0.45) return { ok: false, message: "Trop foncé : l'accent ne se verrait pas sur l'en-tête. Choisissez une couleur plus lumineuse." };
      return { ok: true, couleur: hex, ajustee: false, message: "" };
    }
    if (o.l < 0.12) return { ok: false, message: "Trop foncé : presque noir, l'en-tête et les boutons se confondraient. Choisissez une couleur un peu plus claire." };
    var fond = lch(0.975, 0.02, 80), cible = assurer(hex, [fond, BLANC], 4.5), d = o.l - oklch(cible).l;
    if (d > 0.22) return { ok: false, message: "Trop clair : le texte serait illisible. Choisissez une couleur plus foncée." };
    if (cible !== hex) return { ok: true, couleur: cible, ajustee: true, message: "Couleur un peu foncée pour que le texte reste lisible." };
    return { ok: true, couleur: hex, ajustee: false, message: "" };
  }

  /* ------------------------------------------------------------------ */
  /* Fichier partagé apparence.json                                       */
  /* ------------------------------------------------------------------ */
  var MAX_HISTORIQUE = 5;
  function defaut() { return { version: 1, palette: "creme", primaire: null, accent: null, ton: null, coins: "doux", police: "classique", entete: "uni", logo: null, icone: null }; }
  function estObjet(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function texteCourt(v, max) { return typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max) : ""; }
  function nomFichierSur(v) { var t = texteCourt(v, 120); return /^[\w\- .]+\.(png|jpe?g|webp)$/i.test(t) && t.indexOf("..") < 0 ? t : ""; }
  function entier(v) { return typeof v === "number" && isFinite(v) && v >= 0 && v < 1e9 ? Math.floor(v) : 0; }
  /** Réglages visuels seuls (sans historique ni signature), valeurs inconnues → par défaut. */
  function reglagesDe(b) {
    var d = defaut(), ign = 0;
    if (!estObjet(b)) return { r: d, ignores: 1 };
    if (palette(b.palette)) d.palette = b.palette; else if (b.palette != null) ign++;
    ["primaire", "accent"].forEach(function (k) {
      if (b[k] == null) return;
      var c = estHex(b[k]) ? verifierCouleur(b[k], k) : { ok: false };
      if (c.ok) d[k] = c.couleur; else ign++;
    });
    if (dans(TONS, b.ton)) d.ton = b.ton; else if (b.ton != null) ign++;
    if (dans(COINS, b.coins)) d.coins = b.coins; else if (b.coins != null) ign++;
    if (dans(POLICES, b.police)) d.police = b.police; else if (b.police != null) ign++;
    if (dans(ENTETES, b.entete)) d.entete = b.entete; else if (b.entete != null) ign++;
    if (estObjet(b.logo) && nomFichierSur(b.logo.fichier)) d.logo = { fichier: nomFichierSur(b.logo.fichier), version: entier(b.logo.version) || 1 };
    else if (b.logo != null) ign++;
    if (estObjet(b.icone) && entier(b.icone.version)) d.icone = { version: entier(b.icone.version), fichiers: (Array.isArray(b.icone.fichiers) ? b.icone.fichiers : []).map(nomFichierSur).filter(Boolean).slice(0, 4), demande: entier(b.icone.demande) || null };
    else if (b.icone != null) ign++;
    return { r: d, ignores: ign };
  }
  /** apparence.json → { ok, donnees: { …réglages, modifiePar, modifieLe, historique[] }, ignores, raison }. */
  function valider(brut) {
    if (typeof brut === "string") { try { brut = JSON.parse(brut); } catch (e) { return { ok: false, raison: "Le fichier d'apparence n'est pas lisible." }; } }
    if (!estObjet(brut)) return { ok: false, raison: "Le fichier d'apparence est vide ou mal formé." };
    var x = reglagesDe(brut), d = x.r, ign = x.ignores;
    d.modifiePar = texteCourt(brut.modifiePar, 120); d.modifieLe = texteCourt(brut.modifieLe, 40);
    d.historique = [];
    (Array.isArray(brut.historique) ? brut.historique : []).slice(0, MAX_HISTORIQUE).forEach(function (h) {
      if (!estObjet(h)) { ign++; return; }
      var y = reglagesDe(h).r; y.modifiePar = texteCourt(h.modifiePar, 120); y.modifieLe = texteCourt(h.modifieLe, 40);
      d.historique.push(y);
    });
    return { ok: true, donnees: d, ignores: ign };
  }
  function sansMeta(a) { var r = reglagesDe(a).r; return r; }
  /** Nouvelle version à écrire : l'ancienne passe en tête de l'historique (5 au plus). */
  function historiser(ancien, nouveau, qui, quand) {
    var av = ancien ? valider(ancien) : null;
    var n = reglagesDe(nouveau).r;
    n.modifiePar = texteCourt(qui, 120); n.modifieLe = texteCourt(quand, 40);
    var hist = [];
    if (av && av.ok) {
      var prec = sansMeta(av.donnees); prec.modifiePar = av.donnees.modifiePar; prec.modifieLe = av.donnees.modifieLe;
      hist = [prec].concat(av.donnees.historique);
    }
    n.historique = hist.slice(0, MAX_HISTORIQUE);
    return n;
  }
  /** Revenir à la version précédente : la 1re de l'historique devient l'actuelle (l'historique raccourcit). */
  function versionPrecedente(actuel) {
    var v = valider(actuel);
    if (!v.ok || !v.donnees.historique.length) return null;
    var prec = v.donnees.historique[0], r = sansMeta(prec);
    r.modifiePar = prec.modifiePar; r.modifieLe = prec.modifieLe;
    r.historique = v.donnees.historique.slice(1);
    // Le logo et l'icône ne reviennent pas en arrière : ce sont des fichiers déjà publiés.
    r.logo = v.donnees.logo; r.icone = v.donnees.icone;
    return r;
  }
  function memesReglages(a, b) {
    var x = sansMeta(a), y = sansMeta(b);
    return ["palette", "primaire", "accent", "ton", "coins", "police", "entete"].every(function (k) { return x[k] === y[k]; });
  }

  /* ------------------------------------------------------------------ */
  /* Ce qu'il faut poser sur <html>                                        */
  /* ------------------------------------------------------------------ */
  /** Couleurs effectives (palette + personnalisation). */
  function couleursDe(app) {
    var pal = palette(app && app.palette) || PALETTES[0];
    var perso = !!(app && (app.primaire || app.accent || (app.ton && app.ton !== pal.ton) || app.entete === "clair"));
    return { palette: pal, primaire: (app && app.primaire) || pal.primaire, accent: (app && app.accent) || pal.accent, ton: (app && app.ton) || pal.ton,
      entete: (app && app.entete) || "uni", css: perso ? null : pal.css || null };
  }
  /**
   * app : réglages d'apparence (ou null = l'original). Renvoie { vars, attrs, enteteCouleur }.
   * vars : variables à poser (rien pour une palette d'app.css non personnalisée) ;
   * attrs : data-palette, data-coins, data-entete.
   */
  var ENTETE_CSS = { creme: ["#5B3833", "#2E1D19"], bleu: ["#14213D", "#0F1A33"] };
  function jetons(app, sombre) {
    var c = couleursDe(app), vars = {};
    if (!c.css) vars = deriver({ primaire: c.primaire, accent: c.accent, ton: c.ton, entete: c.entete }, !!sombre);
    var coins = (app && app.coins) || "doux";
    if (coins !== "doux") { vars["--rayon"] = RAYONS[coins][0]; vars["--rayon-petit"] = RAYONS[coins][1]; }
    var pol = POLICE_VARS[(app && app.police) || "classique"];
    if (pol) Object.keys(pol).forEach(function (k) { vars[k] = pol[k]; });
    return {
      vars: vars,
      attrs: { "data-palette": c.css === "bleu" ? "bleu" : null, "data-coins": coins !== "doux" ? coins : null, "data-entete": c.entete !== "uni" ? c.entete : null },
      enteteCouleur: c.css ? ENTETE_CSS[c.css][sombre ? 1 : 0] : vars["--entete"],
    };
  }
  /**
   * Choix effectif d'une personne. reglages.palette : "chateau" (défaut : suivre le Château), ou une palette
   * personnelle (seules les couleurs changent ; coins, police et en-tête suivent toujours le Château).
   */
  function effectif(reglages, partage) {
    var choix = reglages && reglages.palette;
    var chateau = partage ? sansMeta(partage) : defaut();
    if (!choix || choix === "chateau" || !palette(choix)) return chateau;
    var r = sansMeta(chateau);
    r.palette = choix; r.primaire = null; r.accent = null; r.ton = null; if (r.entete === "clair") r.entete = "uni";
    return r;
  }

  var posees = [];
  /** Pose le thème sur le document (navigateur uniquement). Renvoie la couleur de l'en-tête. */
  function appliquer(doc, app, sombre) {
    var racineEl = doc.documentElement, j = jetons(app, sombre);
    posees.forEach(function (k) { if (!(k in j.vars)) racineEl.style.removeProperty(k); });
    posees = Object.keys(j.vars);
    posees.forEach(function (k) { racineEl.style.setProperty(k, j.vars[k]); });
    Object.keys(j.attrs).forEach(function (k) { if (j.attrs[k]) racineEl.setAttribute(k, j.attrs[k]); else racineEl.removeAttribute(k); });
    var meta = doc.querySelector && doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", j.enteteCouleur);
    return j.enteteCouleur;
  }

  /* ------------------------------------------------------------------ */
  /* Logo                                                                 */
  /* ------------------------------------------------------------------ */
  var LOGO_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
  var LOGO_MAX = 1024 * 1024;
  /** Fichier choisi → "" si accepté, sinon la phrase à afficher. SVG refusé (peut contenir du code). */
  function verifierLogo(f) {
    if (!f) return "Aucun fichier choisi.";
    if (!LOGO_TYPES[f.type]) return /svg/i.test(f.type || "") || /\.svg$/i.test(f.name || "") ? "Les fichiers SVG ne sont pas acceptés : enregistrez le logo en PNG." : "Ce fichier n'est pas une image PNG, JPEG ou WebP.";
    if (!f.size) return "Ce fichier est vide.";
    if (f.size > LOGO_MAX) return "Logo trop lourd (" + (Math.round(f.size / 1024 / 102.4) / 10).toString().replace(".", ",") + " Mo) : 1 Mo au plus.";
    return "";
  }
  /** Taille d'un logo dans un carré de « cote » px avec une marge (proportion) : { x, y, l, h }. */
  function placerDansCarre(largeur, hauteur, cote, marge) {
    var dispo = cote * (1 - 2 * marge), k = Math.min(dispo / largeur, dispo / hauteur);
    var l = Math.round(largeur * k), h = Math.round(hauteur * k);
    return { x: Math.round((cote - l) / 2), y: Math.round((cote - h) / 2), l: l, h: h };
  }

  var api = {
    estHex: estHex, oklch: oklch, depuisOklch: depuisOklch, contraste: contraste, assurer: assurer, luminance: luminance,
    PALETTES: PALETTES, TONS: TONS, COINS: COINS, POLICES: POLICES, ENTETES: ENTETES, PAIRES: PAIRES, MAX_HISTORIQUE: MAX_HISTORIQUE,
    palette: palette, deriver: deriver, controler: controler, verifierCouleur: verifierCouleur,
    defaut: defaut, valider: valider, historiser: historiser, versionPrecedente: versionPrecedente, memesReglages: memesReglages, reglagesDe: function (b) { return reglagesDe(b).r; },
    couleursDe: couleursDe, jetons: jetons, effectif: effectif, appliquer: appliquer,
    LOGO_TYPES: LOGO_TYPES, LOGO_MAX: LOGO_MAX, verifierLogo: verifierLogo, placerDansCarre: placerDansCarre,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.EBApparence = api;
})(typeof self !== "undefined" ? self : this);
