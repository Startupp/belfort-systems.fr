/*
 * Espace Breteuil — « Aujourd'hui au Château » : lecture des titres saisis par l'accueil.
 *
 * L'accueil tient déjà un calendrier d'équipe (« Marco absent », « Valérie D. télétravail »,
 * « Yara congé », « Visite de groupe 14 h »…). Rien de plus à saisir : ce module classe
 * simplement chaque événement du jour d'après les mots de son titre.
 *
 * Utilisable dans le navigateur (window.EBResume) et dans Node (tests).
 */
(function (racine) {
  "use strict";

  /* Mots-clés (sans accents, en minuscules). L'ordre compte : congé avant absent. */
  var REGLES = [
    { type: "conge", mots: ["conge", "conges", "vacances", "cp", "rtt", "ferie"] },
    { type: "teletravail", mots: ["teletravail", "tele-travail", "tt", "a distance", "a la maison", "domicile"] },
    { type: "absent", mots: ["absent", "absente", "absence", "malade", "maladie", "arret", "repos", "recup", "recuperation", "indisponible", "pas la", "off"] },
    { type: "present", mots: ["present", "presente", "permanence", "de garde", "sur place"] },
  ];

  function simplifier(s) {
    return " " + String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9.\- ]+/g, " ").replace(/\s+/g, " ").trim() + " ";
  }
  function contientMot(texte, mot) {
    return texte.indexOf(" " + mot + " ") > -1 || texte.indexOf(" " + mot + ".") > -1;
  }

  /** Type d'un titre : conge | teletravail | absent | present | null (rendez-vous / info). */
  function typeDe(titre) {
    var t = simplifier(titre);
    for (var i = 0; i < REGLES.length; i++) {
      for (var j = 0; j < REGLES[i].mots.length; j++) if (contientMot(t, REGLES[i].mots[j])) return REGLES[i].type;
    }
    return null;
  }

  /**
   * Personnes citées dans un titre. Le prénom complet d'abord (« Valérie D. »), puis le
   * prénom seul s'il n'y a pas d'ambiguïté (« Yara »). Deux « Valérie » sans initiale :
   * personne n'est reconnu, plutôt que de se tromper.
   */
  function personnesCitees(titre, personnes) {
    var t = simplifier(titre).replace(/\./g, " . ");
    var trouves = [];
    var premiers = {};
    personnes.forEach(function (p) { var m = simplifier(p.prenom).trim().split(" ")[0]; premiers[m] = (premiers[m] || 0) + 1; });
    personnes.forEach(function (p) {
      var complet = simplifier(p.prenom).replace(/\./g, " . ").trim();
      var premier = complet.split(" ")[0];
      var initiale = complet.split(" ")[1];
      var ok = t.indexOf(" " + complet + " ") > -1 ||
        (initiale && t.indexOf(" " + premier + " " + initiale + " ") > -1) ||
        (premiers[premier] === 1 && contientMot(t, premier));
      if (ok) trouves.push(p);
    });
    return trouves;
  }

  /**
   * Résumé d'une journée à partir des occurrences (déjà développées par ics.js).
   * Renvoie { absents, conges, teletravail, presents, rendezVous, infos } :
   * - les 4 premiers : [{ personne, evenement }] ;
   * - rendezVous : événements à heure fixe (triés) ; infos : journées sans personne reconnue.
   */
  function resumer(occurrences, personnes) {
    var r = { absents: [], conges: [], teletravail: [], presents: [], rendezVous: [], infos: [] };
    var deja = {};
    occurrences.forEach(function (o) {
      var type = typeDe(o.titre);
      var qui = type ? personnesCitees(o.titre, personnes) : [];
      if (type && qui.length) {
        var liste = type === "absent" ? r.absents : type === "conge" ? r.conges : type === "teletravail" ? r.teletravail : r.presents;
        qui.forEach(function (p) {
          if (deja[p.id + type]) return;
          deja[p.id + type] = 1;
          liste.push({ personne: p, evenement: o });
        });
      } else if (o.journee) {
        r.infos.push(o);
      } else {
        r.rendezVous.push(o);
      }
    });
    r.rendezVous.sort(function (a, b) { return a.debut - b.debut; });
    return r;
  }

  var api = { typeDe: typeDe, personnesCitees: personnesCitees, resumer: resumer, simplifier: simplifier };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.EBResume = api;
})(typeof self !== "undefined" ? self : this);
