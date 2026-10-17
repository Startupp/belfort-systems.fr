/*
 * Espace Breteuil — cache EN MÉMOIRE des réponses Microsoft pour la session (v4).
 *
 * Principe « dernier état connu, puis mise à jour » (stale-while-revalidate) :
 *   - 1er appel : on attend la réponse (squelette à l'écran) ;
 *   - appels suivants : la valeur gardée est rendue TOUT DE SUITE ; si elle a plus de
 *     « ttl » millisecondes, un rafraîchissement part en arrière-plan et les écouteurs
 *     sont prévenus SEULEMENT si la valeur a changé (pas de re-rendu inutile) ;
 *   - deux demandes simultanées de la même clé partagent le même appel réseau.
 * Rien n'est écrit sur le disque : fermer l'onglet efface tout (comme les jetons).
 * Logique pure, testée sous Node (tests/cache.test.mjs).
 */
(function (racine) {
  "use strict";

  function creer(opts) {
    opts = opts || {};
    var maintenant = opts.horloge || function () { return Date.now(); };
    var entrees = {};   // cle → { valeur, quand, empreinte }
    var enVol = {};     // cle → Promise
    var ecouteurs = {}; // cle → [fn]

    function empreinte(v) { try { return JSON.stringify(v); } catch (e) { return String(Math.random()); } }
    function prevenir(cle, v) { (ecouteurs[cle] || []).slice().forEach(function (fn) { try { fn(v); } catch (e) {} }); }

    function charger(cle, chargeur) {
      if (enVol[cle]) return enVol[cle];
      var p = Promise.resolve().then(chargeur).then(function (v) {
        delete enVol[cle];
        var e = empreinte(v), avant = entrees[cle];
        entrees[cle] = { valeur: v, quand: maintenant(), empreinte: e };
        if (avant && avant.empreinte !== e) prevenir(cle, v);
        return v;
      }, function (err) { delete enVol[cle]; throw err; });
      enVol[cle] = p;
      return p;
    }

    /**
     * Valeur de « cle ». o : { ttl (ms, défaut 60 s), surMaj(v) : appelé si un rafraîchissement
     * en arrière-plan rapporte une valeur différente }.
     */
    function obtenir(cle, chargeur, o) {
      o = o || {};
      var ttl = o.ttl == null ? 60000 : o.ttl;
      var e = entrees[cle];
      if (o.surMaj) ecouter(cle, o.surMaj, true);
      if (!e) return charger(cle, chargeur);
      if (maintenant() - e.quand > ttl) charger(cle, chargeur).catch(function () {}); // arrière-plan
      return Promise.resolve(e.valeur);
    }
    /** Valeur gardée (sans appel réseau), ou undefined. */
    function connu(cle) { return entrees[cle] ? entrees[cle].valeur : undefined; }
    /** Force un nouvel appel et renvoie sa promesse (après une modification). */
    function rafraichir(cle, chargeur) { delete enVol[cle]; return charger(cle, chargeur); }
    /** Oublie une clé, ou toutes celles qui commencent par « prefixe* ». */
    function oublier(cle) {
      if (cle == null) { entrees = {}; enVol = {}; ecouteurs = {}; return; }
      if (/\*$/.test(cle)) {
        var p = cle.slice(0, -1);
        Object.keys(entrees).forEach(function (k) { if (k.indexOf(p) === 0) delete entrees[k]; });
        return;
      }
      delete entrees[cle];
    }
    /** Écoute les changements de valeur d'une clé. unique = remplace les écouteurs « uniques » précédents. */
    function ecouter(cle, fn, unique) {
      var l = ecouteurs[cle] || (ecouteurs[cle] = []);
      if (unique) { for (var i = l.length - 1; i >= 0; i--) if (l[i].unique) l.splice(i, 1); fn.unique = true; }
      l.push(fn);
      return function () { var j = l.indexOf(fn); if (j > -1) l.splice(j, 1); };
    }
    return { obtenir: obtenir, connu: connu, rafraichir: rafraichir, oublier: oublier, ecouter: ecouter };
  }

  var api = { creer: creer };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  racine.EBCache = creer();
  racine.EBCache.creer = creer;
})(typeof self !== "undefined" ? self : this);
