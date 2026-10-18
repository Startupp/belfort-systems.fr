/*
 * Espace Breteuil — v5.2 : « Pilotage » (tout ce qui a été fait et échangé avec le prestataire).
 * Partie SANS écran (testée sous Node, tests/pilotage.test.mjs) : validation du fichier
 * pilotage.json, tri de l'historique, filtrage des guides (tous / gestion), correspondance
 * « document cité » → fichier PDF déposé (sans tenir compte des majuscules ni des accents).
 *
 * AUCUNE donnée du client ici : le dépôt est public. Les données vivent dans le SharePoint
 * du client : <dossier commun>/Pilotage/pilotage.json et <dossier commun>/Pilotage/Guides/*.pdf
 * (voir docs/ESPACE-BRETEUIL.md, section « Pilotage »).
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
   * Valide le contenu de pilotage.json. Renvoie { ok, donnees, ignores, raison }.
   * ok = faux seulement si ce n'est pas un objet JSON exploitable. Les entrées invalides sont
   * ignorées une à une (compte dans « ignores ») : un oubli ne bloque pas tout l'écran.
   */
  function valider(brut) {
    if (typeof brut === "string") { try { brut = JSON.parse(brut); } catch (e) { return { ok: false, raison: "Le fichier pilotage.json n'est pas lisible (JSON invalide)." }; } }
    if (!estObjet(brut)) return { ok: false, raison: "Le fichier pilotage.json est vide ou mal formé." };
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
   * Fichier déposé correspondant au nom cité (ou null). fichiers : [{ name, webUrl, size, lastModifiedDateTime }].
   * Comparaison sans casse ni accents ; à défaut, sans l'extension (« Devis.pdf » ↔ « devis »).
   */
  function trouverFichier(nom, fichiers) {
    var k = cle(nom), l = (fichiers || []).filter(function (f) { return f && typeof f.name === "string" && urlSure(f.webUrl); });
    var f = l.filter(function (x) { return cle(x.name) === k; })[0];
    if (!f) f = l.filter(function (x) { return sansExtension(cle(x.name)) === sansExtension(k); })[0];
    return f || null;
  }

  /** Titre lisible d'un fichier cité : celui de « guides », sinon le nom de fichier. */
  function titreDe(nom, donnees) {
    var k = cle(nom), g = ((donnees && donnees.guides) || []).filter(function (x) { return cle(x.fichier) === k; })[0];
    return (g && g.titre) || nom;
  }

  /** Documents cités dans une étape : [{ nom, titre, url (ou "") }]. */
  function documentsDe(etape, donnees, fichiers) {
    return (etape.documents || []).map(function (n) {
      var f = trouverFichier(n, fichiers);
      return { nom: n, titre: titreDe(n, donnees), url: f ? f.webUrl : "" };
    });
  }

  /**
   * Guides à afficher. portee « tous » : seulement ceux marqués « pour: tous » (Moi → Guides) ;
   * « gestion » : tous les guides décrits, plus les PDF déposés mais pas encore décrits (nom de fichier).
   * Renvoie [{ fichier, titre, pour, url, taille, modifie }], dans l'ordre de pilotage.json.
   */
  function guidesPour(donnees, fichiers, portee) {
    var decrits = ((donnees && donnees.guides) || []).filter(function (g) { return portee === "gestion" || g.pour === "tous"; });
    var l = decrits.map(function (g) {
      var f = trouverFichier(g.fichier, fichiers);
      return { fichier: g.fichier, titre: g.titre || g.fichier, pour: g.pour, url: f ? f.webUrl : "", taille: f && f.size || 0, modifie: f && f.lastModifiedDateTime || "" };
    });
    if (portee === "gestion") {
      var connus = ((donnees && donnees.guides) || []).map(function (g) { return trouverFichier(g.fichier, fichiers); }).filter(Boolean);
      (fichiers || []).filter(function (f) { return f && typeof f.name === "string" && urlSure(f.webUrl) && connus.indexOf(f) < 0 && !f.folder; })
        .sort(function (a, b) { return a.name.localeCompare(b.name, "fr"); })
        .forEach(function (f) { l.push({ fichier: f.name, titre: f.name, pour: "gestion", url: f.webUrl, taille: f.size || 0, modifie: f.lastModifiedDateTime || "" }); });
    }
    return l;
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
    cle: cle, trouverFichier: trouverFichier, titreDe: titreDe, documentsDe: documentsDe, guidesPour: guidesPour,
    taille: taille, lienTel: lienTel, urlSure: urlSure,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.EBPilotage = api;
})(typeof self !== "undefined" ? self : this);
