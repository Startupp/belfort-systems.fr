/*
 * Espace Breteuil — v5.2 : « Suivi informatique » (tout ce qui a été fait et échangé avec le prestataire).
 * Libellés, dossier et fichier : config.js → suivi (renommables en une ligne).
 * Partie SANS écran (testée sous Node, tests/suivi.test.mjs) : validation du fichier
 * de suivi (suivi.json), tri de l'historique, filtrage des guides (tous / gestion), correspondance
 * « document cité » → fichier PDF déposé : d'abord par le numéro en tête (« 04 - … », le fichier
 * peut donc être renommé), puis par le nom (sans tenir compte des majuscules ni des accents).
 *
 * AUCUNE donnée du client ici : le dépôt est public. Les données vivent dans le SharePoint
 * du client : <dossier commun>/Suivi informatique/suivi.json et …/Guides/*.pdf
 * (voir docs/ESPACE-BRETEUIL.md, section « Suivi informatique »).
 */
(function (racine) {
  "use strict";

  /* Longueurs maximales (au-delà : texte coupé ; entrée invalide : ignorée). */
  var MAX = {
    historique: 500, miseEnPlace: 60, points: 40, guides: 300, documents: 30,
    titre: 200, resume: 3000, point: 600, fichier: 200, nom: 160, telephone: 40, mail: 200,
  };
  var MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

  function estObjet(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  /** Texte propre : chaîne, sans caractères de contrôle, espaces resserrés, coupée à max. Vide → "". */
  function texte(v, max) {
    if (typeof v !== "string") return "";
    var t = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/[ \t]+/g, " ").trim();
    return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
  }
  /** Date AAAA-MM-JJ réelle (pas de 31 février). */
  function dateValide(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
    if (!m) return false;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  /** « 2026-09-15 » → « 15 septembre 2026 » (« 1er » le premier du mois). */
  function dateLongue(s) {
    if (!dateValide(s)) return "";
    var j = +s.slice(8, 10);
    return (j === 1 ? "1er" : String(j)) + " " + MOIS[+s.slice(5, 7) - 1] + " " + s.slice(0, 4);
  }
  /** Nom de fichier simple : pas de dossier, pas de « .. ». */
  function nomFichier(v) {
    var t = texte(v, MAX.fichier + 1);
    if (!t || t.length > MAX.fichier || /[\/\\]/.test(t) || t.indexOf("..") > -1) return "";
    return t;
  }
  function telephoneValide(v) {
    var t = texte(v, MAX.telephone + 1);
    return t && t.length <= MAX.telephone && /^\+?[0-9 .()-]{6,}$/.test(t) && t.replace(/\D/g, "").length >= 6 ? t : "";
  }
  function mailValide(v) {
    var t = texte(v, MAX.mail + 1);
    return t && t.length <= MAX.mail && /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(t) ? t : "";
  }

  /**
   * Valide le contenu du fichier de suivi (suivi.json). Renvoie { ok, donnees, ignores, raison }.
   * ok = faux seulement si ce n'est pas un objet JSON exploitable. Les entrées invalides sont
   * ignorées une à une (compte dans « ignores ») : un oubli ne bloque pas tout l'écran.
   */
  function valider(brut) {
    if (typeof brut === "string") { try { brut = JSON.parse(brut); } catch (e) { return { ok: false, raison: "Le fichier de suivi n'est pas lisible (JSON invalide)." }; } }
    if (!estObjet(brut)) return { ok: false, raison: "Le fichier de suivi est vide ou mal formé." };
    var ignores = 0;
    var tableau = function (v, max) { if (!Array.isArray(v)) { if (v != null) ignores++; return []; } if (v.length > max) ignores += v.length - max; return v.slice(0, max); };

    var p = estObjet(brut.prestataire) ? brut.prestataire : {};
    var prestataire = { nom: texte(p.nom, MAX.nom), telephone: telephoneValide(p.telephone), mail: mailValide(p.mail) };
    if (p.telephone && !prestataire.telephone) ignores++;
    if (p.mail && !prestataire.mail) ignores++;

    var historique = [];
    tableau(brut.historique, MAX.historique).forEach(function (e, i) {
      if (!estObjet(e) || !dateValide(e.date) || !texte(e.titre, MAX.titre)) { ignores++; return; }
      var docs = [];
      tableau(e.documents, MAX.documents).forEach(function (d) { var n = nomFichier(d); if (n) docs.push(n); else ignores++; });
      historique.push({ date: e.date, titre: texte(e.titre, MAX.titre), resume: texte(e.resume, MAX.resume), documents: docs, rang: i });
    });

    var miseEnPlace = [];
    tableau(brut.miseEnPlace, MAX.miseEnPlace).forEach(function (t) {
      if (!estObjet(t) || !texte(t.titre, MAX.titre)) { ignores++; return; }
      var points = [];
      tableau(t.points, MAX.points).forEach(function (x) { var s = texte(x, MAX.point); if (s) points.push(s); else ignores++; });
      miseEnPlace.push({ titre: texte(t.titre, MAX.titre), points: points });
    });

    var guides = [], vus = {};
    tableau(brut.guides, MAX.guides).forEach(function (g) {
      var f = estObjet(g) ? nomFichier(g.fichier) : "";
      if (!f || vus[cle(f)]) { ignores++; return; }
      vus[cle(f)] = 1;
      // Prudence : sans « pour » valide, le guide reste réservé à la gestion.
      guides.push({ fichier: f, titre: texte(g.titre, MAX.titre), pour: g.pour === "tous" ? "tous" : "gestion" });
    });

    return {
      ok: true, ignores: ignores,
      donnees: {
        version: typeof brut.version === "number" && isFinite(brut.version) ? brut.version : 1,
        misAJour: dateValide(brut.misAJour) ? brut.misAJour : "",
        prestataire: prestataire,
        historique: trierHistorique(historique),
        miseEnPlace: miseEnPlace,
        guides: guides,
      },
    };
  }

  /** Du plus récent au plus ancien ; même jour : le dernier écrit d'abord. */
  function trierHistorique(l) {
    return (l || []).slice().sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.rang || 0) - (a.rang || 0);
    });
  }

  /** Clé de comparaison d'un nom de fichier : sans accents, sans casse, espaces resserrés. */
  function cle(nom) {
    return String(nom || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  }
  function sansExtension(k) { return k.replace(/\.[a-z0-9]{1,5}$/, ""); }
  /** Adresse web sûre (https uniquement). */
  function urlSure(u) { return typeof u === "string" && /^https:\/\/[^\s]+$/i.test(u) ? u : ""; }

  /**
   * Numéro en tête d'un nom de fichier « NN - Titre.pdf » (1 à 3 chiffres suivis d'un séparateur),
   * ou null s'il n'y en a pas. « 04 - Mails.pdf » → 4 ; « Notes.pdf » → null.
   */
  function numero(nom) {
    var m = /^\s*(\d{1,3})\s*[-–—._ ]/.exec(String(nom || ""));
    return m ? +m[1] : null;
  }
  /** Titre tiré d'un nom de fichier : sans le numéro de tête ni l'extension. */
  function titreDuNom(nom) {
    var t = String(nom || "").replace(/\.[a-z0-9]{1,5}$/i, "");
    var m = /^\s*\d{1,3}\s*[-–—._ ]+\s*/.exec(t);
    if (m && m[0].length < t.length) t = t.slice(m[0].length);
    return texte(t, MAX.titre) || String(nom || "");
  }
  function dateModif(f) { var t = Date.parse(f && f.lastModifiedDateTime || ""); return isNaN(t) ? 0 : t; }
  var signales = {};
  function signaler(n, l) {
    var k = n + ":" + l.map(function (f) { return f.name; }).sort().join("|");
    if (signales[k]) return;
    signales[k] = 1;
    if (typeof console !== "undefined" && console.warn) console.warn("[Suivi] Plusieurs guides portent le numéro " + n + " : " + l.map(function (f) { return f.name; }).join(", ") + " — le plus récent est utilisé.");
  }
  function fichiersSurs(fichiers) {
    return (fichiers || []).filter(function (f) { return f && typeof f.name === "string" && urlSure(f.webUrl) && !f.folder; });
  }

  /**
   * Fichier déposé correspondant au nom cité (ou null). fichiers : [{ name, webUrl, size, lastModifiedDateTime }].
   * 1. Par le NUMÉRO en tête (« 04 - … ») : le fichier peut être renommé tant qu'il garde son numéro ;
   *    plusieurs fichiers avec le même numéro → le plus récemment modifié (signalé dans la console).
   * 2. À défaut, par le nom : sans casse ni accents, puis sans l'extension (« Devis.pdf » ↔ « devis »).
   */
  function trouverFichier(nom, fichiers) {
    var k = cle(nom), l = fichiersSurs(fichiers), n = numero(nom);
    if (n !== null) {
      var memes = l.filter(function (x) { return numero(x.name) === n; });
      if (memes.length > 1) {
        memes = memes.slice().sort(function (a, b) { return dateModif(b) - dateModif(a); });
        signaler(n, memes);
      }
      if (memes.length) return memes[0];
    }
    var f = l.filter(function (x) { return cle(x.name) === k; })[0];
    if (!f) f = l.filter(function (x) { return sansExtension(cle(x.name)) === sansExtension(k); })[0];
    return f || null;
  }
  /** Vrai si le fichier réel porte un autre nom que celui du suivi (renommé dans SharePoint). */
  function renomme(nom, f) { return !!f && sansExtension(cle(f.name)) !== sansExtension(cle(nom)); }

  /** Guide décrit correspondant à un nom cité : même nom, sinon même numéro en tête. */
  function guideDe(nom, donnees) {
    var l = (donnees && donnees.guides) || [], k = cle(nom), n = numero(nom);
    return l.filter(function (x) { return cle(x.fichier) === k; })[0]
      || (n !== null ? l.filter(function (x) { return numero(x.fichier) === n; })[0] : null) || null;
  }

  /**
   * Titre lisible d'un fichier cité. Si le PDF a été renommé dans SharePoint : titre tiré du nom réel
   * (c'est la volonté de l'utilisateur) ; sinon celui de « guides », sinon le nom cité.
   */
  function titreDe(nom, donnees, fichiers) {
    var f = fichiers ? trouverFichier(nom, fichiers) : null;
    if (renomme(nom, f)) return titreDuNom(f.name);
    var g = guideDe(nom, donnees);
    return (g && g.titre) || nom;
  }

  /** Documents cités dans une étape : [{ nom, titre, url (ou "") }]. */
  function documentsDe(etape, donnees, fichiers) {
    return (etape.documents || []).map(function (n) {
      var f = trouverFichier(n, fichiers);
      return { nom: n, titre: titreDe(n, donnees, fichiers), url: f ? f.webUrl : "" };
    });
  }

  /** « pour » d'un PDF déposé mais non décrit : 01–09 → tous ; 10 et plus, ou sans numéro → gestion. */
  function pourDuNumero(nom) { var n = numero(nom); return n !== null && n >= 1 && n <= 9 ? "tous" : "gestion"; }

  /**
   * Guides à afficher. portee « tous » : ceux marqués « pour: tous » (Moi → Guides) ;
   * « gestion » : tous les guides décrits. Les PDF déposés mais pas encore décrits s'ajoutent
   * (titre = nom sans numéro ni extension ; « pour » déduit du numéro, voir pourDuNumero).
   * Renvoie [{ fichier, titre, pour, url, taille, modifie }], trié par numéro (les décrits dans
   * l'ordre du fichier de suivi, puis les non décrits par nom), les fichiers sans numéro à la fin.
   */
  function guidesPour(donnees, fichiers, portee) {
    var tous = (donnees && donnees.guides) || [], l = [], connus = [];
    tous.forEach(function (g, i) {
      var f = trouverFichier(g.fichier, fichiers);
      if (f) connus.push(f);
      if (portee !== "gestion" && g.pour !== "tous") return;
      var titre = renomme(g.fichier, f) ? titreDuNom(f.name) : (g.titre || g.fichier);
      l.push({ fichier: g.fichier, titre: titre, pour: g.pour, url: f ? f.webUrl : "", taille: f && f.size || 0, modifie: f && f.lastModifiedDateTime || "",
        _n: numero(f ? f.name : g.fichier), _r: 0, _i: i });
    });
    // Non décrits ; un numéro déjà pris (doublon) n'affiche que le fichier le plus récent.
    var pris = {};
    connus.forEach(function (f) { var n = numero(f.name); if (n !== null) pris[n] = 1; });
    fichiersSurs(fichiers).filter(function (f) { return connus.indexOf(f) < 0; })
      .filter(function (f, _, reste) {
        var n = numero(f.name);
        if (n === null) return true;
        if (pris[n]) return false;
        return trouverFichier(f.name, reste) === f;
      }).forEach(function (f, i) {
      var pour = pourDuNumero(f.name);
      if (portee !== "gestion" && pour !== "tous") return;
      l.push({ fichier: f.name, titre: titreDuNom(f.name), pour: pour, url: f.webUrl, taille: f.size || 0, modifie: f.lastModifiedDateTime || "",
        _n: numero(f.name), _r: 1, _i: i });
    });
    l.sort(function (a, b) {
      var na = a._n === null ? Infinity : a._n, nb = b._n === null ? Infinity : b._n;
      if (na !== nb) return na - nb;
      if (a._r !== b._r) return a._r - b._r;
      return a._r ? a.titre.localeCompare(b.titre, "fr") || a._i - b._i : a._i - b._i;
    });
    return l.map(function (g) { return { fichier: g.fichier, titre: g.titre, pour: g.pour, url: g.url, taille: g.taille, modifie: g.modifie }; });
  }

  /** Taille lisible : « 240 Ko », « 1,2 Mo ». */
  function taille(o) {
    o = Number(o) || 0;
    if (o <= 0) return "";
    if (o < 1024 * 1024) return Math.max(1, Math.round(o / 1024)) + " Ko";
    return (Math.round(o / 1024 / 1024 * 10) / 10).toString().replace(".", ",") + " Mo";
  }
  /** Lien tel: (chiffres et + seulement). */
  function lienTel(t) { var c = String(t || "").replace(/[^\d+]/g, ""); if (/^0\d{9}$/.test(c)) c = "+33" + c.slice(1); return c ? "tel:" + c : ""; }

  var api = {
    MAX: MAX, valider: valider, dateValide: dateValide, dateLongue: dateLongue, trierHistorique: trierHistorique,
    cle: cle, numero: numero, titreDuNom: titreDuNom, pourDuNumero: pourDuNumero, trouverFichier: trouverFichier, titreDe: titreDe, documentsDe: documentsDe, guidesPour: guidesPour,
    taille: taille, lienTel: lienTel, urlSure: urlSure,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.EBSuivi = api;
})(typeof self !== "undefined" ? self : this);
