/*
 * Espace Breteuil — parseur ICS léger (sans dépendance).
 *
 * Utilisable dans le navigateur (window.BreteuilICS) et dans Node (require).
 *
 * Gère :
 *  - lignes repliées, échappements (\n \, \; \\), paramètres (TZID, VALUE=DATE) ;
 *  - heures UTC (…Z), heures « flottantes » (prises en Europe/Paris), TZID IANA
 *    ou Windows (« Romance Standard Time » d'Outlook → Europe/Paris) ;
 *  - événements sur la journée (VALUE=DATE), DTEND ou DURATION ;
 *  - récurrences simples RRULE : FREQ=DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL,
 *    COUNT, UNTIL, BYDAY (hebdo ; mensuel du type 1MO, -1FR), BYMONTHDAY ;
 *  - EXDATE, occurrences modifiées (RECURRENCE-ID), STATUS:CANCELLED.
 *
 * Limites (documentées dans docs/ESPACE-BRETEUIL.md) : BYSETPOS, BYWEEKNO,
 * BYYEARDAY, BYHOUR… et RDATE sont ignorés ; un fuseau inconnu est traité
 * comme Europe/Paris.
 */
(function (racine) {
  "use strict";

  var FUSEAU_DEFAUT = "Europe/Paris";

  /* Noms de fuseaux Windows (utilisés par Outlook / Exchange) → IANA. */
  var WINDOWS = {
    "romance standard time": "Europe/Paris",
    "w. europe standard time": "Europe/Berlin",
    "central europe standard time": "Europe/Budapest",
    "central european standard time": "Europe/Warsaw",
    "gmt standard time": "Europe/London",
    "greenwich standard time": "Atlantic/Reykjavik",
    "utc": "UTC",
    "coordinated universal time": "UTC",
    "eastern standard time": "America/New_York",
    "pacific standard time": "America/Los_Angeles",
    "arabian standard time": "Asia/Dubai",
  };

  var JOURS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  var JOUR_MS = 86400000;

  /* ------------------------------------------------------------------ */
  /* Fuseaux horaires                                                    */
  /* ------------------------------------------------------------------ */

  var formateurs = {};
  function formateur(tz) {
    if (!formateurs[tz]) {
      formateurs[tz] = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      });
    }
    return formateurs[tz];
  }

  /** Nom de fuseau utilisable par Intl (IANA), ou Europe/Paris par défaut. */
  function normaliserFuseau(tzid) {
    if (!tzid) return FUSEAU_DEFAUT;
    var t = String(tzid).replace(/^"|"$/g, "").replace(/^\/+/, "").trim();
    var w = WINDOWS[t.toLowerCase()];
    if (w) return w;
    try { formateur(t); return t; } catch (e) { return FUSEAU_DEFAUT; }
  }

  /** Composantes « murales » {y,m,d,h,mi,s} d'un instant dans un fuseau. */
  function partiesDans(ms, tz) {
    var p = {};
    formateur(tz).formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
  }

  /** Décalage (ms) du fuseau à l'instant donné. */
  function decalage(ms, tz) {
    var p = partiesDans(ms, tz);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
  }

  /** Heure murale (dans le fuseau tz) → instant UTC en ms. */
  function versInstant(p, tz) {
    var naif = Date.UTC(p.y, p.m - 1, p.d, p.h || 0, p.mi || 0, p.s || 0);
    if (tz === "UTC") return naif;
    var t = naif - decalage(naif, tz);
    var d2 = decalage(t, tz);
    if (naif - d2 !== t) t = naif - d2;
    return t;
  }

  /* ------------------------------------------------------------------ */
  /* Lecture du texte                                                    */
  /* ------------------------------------------------------------------ */

  function deplier(texte) {
    return String(texte || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  }

  function desechapper(v) {
    return String(v || "").replace(/\\([\\;,nN])/g, function (_, c) { return c === "n" || c === "N" ? "\n" : c; });
  }

  /** "DTSTART;TZID=Europe/Paris:20261012T090000" → {nom, params, valeur}. */
  function lireLigne(ligne) {
    // Les « : » entre guillemets dans les paramètres ne séparent pas la valeur.
    var i = 0, guillemets = false;
    for (; i < ligne.length; i++) {
      var c = ligne[i];
      if (c === '"') guillemets = !guillemets;
      else if (c === ":" && !guillemets) break;
    }
    var tete = ligne.slice(0, i), valeur = ligne.slice(i + 1);
    var morceaux = tete.split(";");
    var params = {};
    for (var k = 1; k < morceaux.length; k++) {
      var eg = morceaux[k].indexOf("=");
      if (eg > 0) params[morceaux[k].slice(0, eg).toUpperCase()] = morceaux[k].slice(eg + 1).replace(/^"|"$/g, "");
    }
    return { nom: morceaux[0].toUpperCase(), params: params, valeur: valeur };
  }

  /** Valeur de date ICS → {journee, parties, tz, instant}. */
  function lireDate(valeur, params) {
    var v = String(valeur || "").trim();
    var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
    if (!m) return null;
    var p = { y: +m[1], m: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) };
    var journee = !m[4] || (params && params.VALUE === "DATE");
    if (journee) {
      p.h = 0; p.mi = 0; p.s = 0;
      return { journee: true, parties: p, tz: FUSEAU_DEFAUT, instant: versInstant(p, FUSEAU_DEFAUT) };
    }
    var tz = m[7] ? "UTC" : normaliserFuseau(params && params.TZID);
    return { journee: false, parties: p, tz: tz, instant: versInstant(p, tz) };
  }

  /** "PT1H30M", "P1D", "-PT15M" → ms. */
  function lireDuree(v) {
    var m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v || "").trim());
    if (!m) return null;
    var ms = (((+(m[2] || 0) * 7 + +(m[3] || 0)) * 24 + +(m[4] || 0)) * 60 + +(m[5] || 0)) * 60000 + +(m[6] || 0) * 1000;
    return m[1] === "-" ? -ms : ms;
  }

  function lireRegle(v) {
    var r = {};
    String(v || "").split(";").forEach(function (kv) {
      var eg = kv.indexOf("=");
      if (eg > 0) r[kv.slice(0, eg).toUpperCase()] = kv.slice(eg + 1).toUpperCase();
    });
    if (!r.FREQ) return null;
    return {
      freq: r.FREQ,
      intervalle: Math.max(1, parseInt(r.INTERVAL || "1", 10) || 1),
      nombre: r.COUNT ? parseInt(r.COUNT, 10) : null,
      jusqua: r.UNTIL ? lireDate(r.UNTIL, {}) : null,
      parJour: r.BYDAY ? r.BYDAY.split(",").map(function (j) {
        var mm = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(j.trim());
        return mm ? { n: mm[1] ? parseInt(mm[1], 10) : 0, jour: JOURS[mm[2]] } : null;
      }).filter(Boolean) : null,
      parJourDuMois: r.BYMONTHDAY ? r.BYMONTHDAY.split(",").map(function (x) { return parseInt(x, 10); }).filter(function (x) { return !isNaN(x); }) : null,
      parMois: r.BYMONTH ? r.BYMONTH.split(",").map(function (x) { return parseInt(x, 10); }) : null,
      nonGere: ["BYSETPOS", "BYWEEKNO", "BYYEARDAY", "BYHOUR", "BYMINUTE"].filter(function (k) { return k in r; }),
    };
  }

  /**
   * Analyse un texte ICS. Renvoie { evenements: [...], nom } où chaque événement
   * « maître » garde sa règle de récurrence (à développer avec developper()).
   */
  function analyser(texte) {
    var lignes = deplier(texte);
    var evenements = [], courant = null, profondeur = 0, nom = "";
    for (var i = 0; i < lignes.length; i++) {
      var brut = lignes[i];
      if (!brut) continue;
      var l = lireLigne(brut);
      if (l.nom === "BEGIN") {
        if (l.valeur.toUpperCase() === "VEVENT" && !courant) { courant = { exdates: [] }; profondeur = 0; }
        else if (courant) profondeur++;
        continue;
      }
      if (l.nom === "END") {
        if (courant && profondeur > 0) { profondeur--; continue; }
        if (courant && l.valeur.toUpperCase() === "VEVENT") { evenements.push(courant); courant = null; }
        continue;
      }
      if (!courant) { if (l.nom === "X-WR-CALNAME") nom = desechapper(l.valeur); continue; }
      if (profondeur > 0) continue; // VALARM et autres sous-composants ignorés
      switch (l.nom) {
        case "UID": courant.uid = l.valeur; break;
        case "SUMMARY": courant.titre = desechapper(l.valeur); break;
        case "LOCATION": courant.lieu = desechapper(l.valeur); break;
        case "DESCRIPTION": courant.description = desechapper(l.valeur); break;
        case "CATEGORIES": courant.categories = desechapper(l.valeur); break;
        case "STATUS": courant.statut = l.valeur.toUpperCase(); break;
        case "DTSTART": courant.debut = lireDate(l.valeur, l.params); break;
        case "DTEND": courant.fin = lireDate(l.valeur, l.params); break;
        case "DURATION": courant.duree = lireDuree(l.valeur); break;
        case "RRULE": courant.regle = lireRegle(l.valeur); break;
        case "RECURRENCE-ID": courant.recurrenceId = lireDate(l.valeur, l.params); break;
        case "EXDATE":
          l.valeur.split(",").forEach(function (v) {
            var d = lireDate(v, l.params);
            if (d) courant.exdates.push(d);
          });
          break;
      }
    }
    evenements = evenements.filter(function (e) { return e.debut; });
    return { nom: nom, evenements: evenements };
  }

  /* ------------------------------------------------------------------ */
  /* Développement des récurrences                                       */
  /* ------------------------------------------------------------------ */

  function jourSemaine(p) { return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); }
  function plusJours(p, n) {
    var t = new Date(Date.UTC(p.y, p.m - 1, p.d) + n * JOUR_MS);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: p.h, mi: p.mi, s: p.s };
  }
  function joursDansMois(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function cleJour(p) { return p.y * 10000 + p.m * 100 + p.d; }

  /** Durée d'un événement en ms (ou en jours pour une journée entière). */
  function dureeDe(e) {
    if (e.fin) return Math.max(0, e.fin.instant - e.debut.instant);
    if (e.duree != null) return Math.max(0, e.duree);
    return e.debut.journee ? JOUR_MS : 0;
  }

  /** Dates murales candidates d'une période (selon FREQ / BY…). */
  function candidats(regle, base, periode) {
    var out = [];
    if (regle.freq === "DAILY") {
      out.push(plusJours(base, periode * regle.intervalle));
    } else if (regle.freq === "WEEKLY") {
      // Semaine commençant le lundi qui contient base, décalée de periode*intervalle.
      var lundi = plusJours(base, -((jourSemaine(base) + 6) % 7) + periode * regle.intervalle * 7);
      var jours = regle.parJour && regle.parJour.length ? regle.parJour.map(function (x) { return x.jour; }) : [jourSemaine(base)];
      jours.slice().sort(function (a, b) { return ((a + 6) % 7) - ((b + 6) % 7); }).forEach(function (j) {
        out.push(plusJours(lundi, (j + 6) % 7));
      });
    } else if (regle.freq === "MONTHLY" || regle.freq === "YEARLY") {
      var pas = regle.freq === "MONTHLY" ? regle.intervalle : regle.intervalle * 12;
      var mois = base.m - 1 + periode * pas;
      var y = base.y + Math.floor(mois / 12), m = ((mois % 12) + 12) % 12 + 1;
      if (regle.freq === "YEARLY" && regle.parMois && regle.parMois.length) {
        // Rare dans un agenda de bureau : on ne retient que le mois de départ.
      }
      var nb = joursDansMois(y, m);
      if (regle.parJour && regle.parJour.length) {
        regle.parJour.forEach(function (bj) {
          var liste = [];
          for (var d = 1; d <= nb; d++) {
            var pp = { y: y, m: m, d: d, h: base.h, mi: base.mi, s: base.s };
            if (jourSemaine(pp) === bj.jour) liste.push(pp);
          }
          if (bj.n > 0 && liste[bj.n - 1]) out.push(liste[bj.n - 1]);
          else if (bj.n < 0 && liste[liste.length + bj.n]) out.push(liste[liste.length + bj.n]);
          else if (bj.n === 0) out = out.concat(liste);
        });
      } else {
        var jdm = regle.parJourDuMois && regle.parJourDuMois.length ? regle.parJourDuMois : [base.d];
        jdm.forEach(function (d) {
          var jour = d < 0 ? nb + d + 1 : d;
          if (jour >= 1 && jour <= nb) out.push({ y: y, m: m, d: jour, h: base.h, mi: base.mi, s: base.s });
        });
      }
      out.sort(function (a, b) { return cleJour(a) - cleJour(b); });
    }
    return out;
  }

  function occurrence(e, debutMs, duree, recurrent) {
    var finMs = debutMs + duree;
    if (e.debut.journee) {
      // Journées entières : fin calculée en jours calendaires (insensible au changement d'heure).
      var nbJours = Math.max(1, Math.round(duree / JOUR_MS));
      finMs = versInstant(plusJours(partiesDans(debutMs, FUSEAU_DEFAUT), nbJours), FUSEAU_DEFAUT);
    }
    return {
      uid: e.uid || "",
      titre: e.titre || "(sans titre)",
      lieu: e.lieu || "",
      description: e.description || "",
      categories: e.categories || "",
      journee: !!e.debut.journee,
      debut: debutMs,
      fin: finMs,
      recurrent: !!recurrent,
    };
  }

  /**
   * Développe les événements sur la fenêtre [deMs, aMs[ et renvoie une liste
   * triée d'occurrences { titre, lieu, description, debut, fin, journee, recurrent }.
   */
  function developper(analyse, deMs, aMs) {
    var liste = analyse.evenements || [];
    var modifiees = {}; // uid → { instant → événement modifié }
    liste.forEach(function (e) {
      if (e.recurrenceId && e.uid) {
        (modifiees[e.uid] = modifiees[e.uid] || {})[e.recurrenceId.instant] = e;
      }
    });
    var out = [];
    function garder(o) { if (o.fin > deMs && o.debut < aMs || (o.fin === o.debut && o.debut >= deMs && o.debut < aMs)) out.push(o); }

    liste.forEach(function (e) {
      if (e.recurrenceId) return; // traité via son maître (ou ci-dessous s'il est orphelin)
      if (e.statut === "CANCELLED") return;
      var duree = dureeDe(e);
      if (!e.regle) { garder(occurrence(e, e.debut.instant, duree, false)); return; }

      var regle = e.regle, base = e.debut.parties, tz = e.debut.tz;
      var exclues = {};
      e.exdates.forEach(function (x) { exclues[x.instant] = 1; if (x.journee) exclues["j" + cleJour(x.parties)] = 1; });
      var mod = (e.uid && modifiees[e.uid]) || {};
      var vues = 0, garde = 0;
      var limite = regle.jusqua ? regle.jusqua.instant + (regle.jusqua.journee ? JOUR_MS - 1 : 0) : Infinity;
      for (var periode = 0; periode < 5000 && garde < 2000; periode++) {
        var cands = candidats(regle, base, periode);
        var fini = false;
        for (var c = 0; c < cands.length; c++) {
          var p = cands[c];
          if (cleJour(p) < cleJour(base)) continue; // avant le DTSTART
          var t = versInstant(p, e.debut.journee ? FUSEAU_DEFAUT : tz);
          if (t > limite) { fini = true; break; }
          vues++;
          if (regle.nombre != null && vues > regle.nombre) { fini = true; break; }
          if (t >= aMs) { fini = true; break; }
          if (exclues[t] || exclues["j" + cleJour(p)]) continue;
          var remplace = mod[t];
          if (remplace) {
            if (remplace.statut !== "CANCELLED") garder(occurrence(remplace, remplace.debut.instant, dureeDe(remplace), true));
          } else {
            garder(occurrence(e, t, duree, true));
          }
          garde++;
        }
        if (fini) break;
      }
    });

    // Occurrences modifiées dont le maître est absent : affichées telles quelles.
    liste.forEach(function (e) {
      if (!e.recurrenceId || e.statut === "CANCELLED") return;
      var maitre = liste.some(function (m) { return m !== e && m.uid === e.uid && !m.recurrenceId; });
      if (!maitre) garder(occurrence(e, e.debut.instant, dureeDe(e), true));
    });

    out.sort(function (a, b) { return a.debut - b.debut || (b.journee - a.journee) || (a.titre < b.titre ? -1 : 1); });
    return out;
  }

  var api = {
    analyser: analyser,
    developper: developper,
    partiesDans: partiesDans,
    versInstant: versInstant,
    normaliserFuseau: normaliserFuseau,
    lireDuree: lireDuree,
    FUSEAU: FUSEAU_DEFAUT,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.BreteuilICS = api;
})(typeof self !== "undefined" ? self : this);
