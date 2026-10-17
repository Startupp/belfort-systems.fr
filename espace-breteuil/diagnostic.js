/*
 * Espace Breteuil — écran « Vérifier la connexion » (#/verifier).
 *
 * Teste un à un tout ce qui doit marcher pour le premier essai réel sur le tenant du
 * Château, et dit en français simple ce qui coince et qui peut le régler :
 *   configuration → connexion → permissions accordées → Graph (/me, /users,
 *   /subscribedSkus, /directoryRoles) → site SharePoint → Documents → Commun →
 *   jeton SharePoint → REST currentuser (CORS) → propriétaire du site → ManagePermissions.
 *
 * Chaque étape : pastille verte (OK), orange (à regarder, l'appli marche en partie),
 * rouge (bloquant) ou grise (pas testé, une étape précédente bloque).
 * « Copier le rapport » : texte sans jeton ni adresse complète, à envoyer à Damien.
 *
 * Logique pure (executer, rapport) testée sous Node ; l'écran utilise window.EB.
 */
(function (racine) {
  "use strict";

  var E = (typeof module !== "undefined" && module.exports) ? require("./erreurs.js") : racine.EBErreurs;

  var STATUTS = {
    vert: { nom: "OK", symbole: "✅" },
    orange: { nom: "À regarder", symbole: "🟠" },
    rouge: { nom: "Bloquant", symbole: "❌" },
    gris: { nom: "Pas testé", symbole: "⚪" },
    encours: { nom: "En cours…", symbole: "⏳" },
  };
  // Permission SharePoint « Gérer les autorisations » (PermissionKind.ManagePermissions = 25 → bit 24 de Low).
  var BIT_MANAGE_PERMISSIONS = 24;

  var ETAPES = [
    { id: "config", titre: "Configuration de l'appli" },
    { id: "connexion", titre: "Connexion Microsoft" },
    { id: "scopes", titre: "Permissions accordées à l'appli" },
    { id: "me", titre: "Votre profil (Graph /me)" },
    { id: "users", titre: "Liste des personnes (Graph /users)" },
    { id: "skus", titre: "Licences du Château (Graph /subscribedSkus)" },
    { id: "roles", titre: "Rôles d'administration (Graph /directoryRoles)" },
    { id: "site", titre: "Site SharePoint du Château" },
    { id: "documents", titre: "Bibliothèque « Documents »" },
    { id: "commun", titre: "Dossier commun" },
    { id: "jetonsp", titre: "Autorisation SharePoint (jeton)" },
    { id: "rest", titre: "Dialogue direct avec SharePoint (REST, CORS)" },
    { id: "proprietaire", titre: "Vous êtes propriétaire du site" },
    { id: "gerer", titre: "Droit de gérer les accès des dossiers" },
  ];

  var GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function aLeBit(low, high, bit) {
    var v = bit < 32 ? Number(low) : Number(high);
    var b = bit < 32 ? bit : bit - 32;
    if (isNaN(v)) return false;
    return Math.floor(v / Math.pow(2, b)) % 2 === 1;
  }

  /** Les permissions demandées absentes du jeton (comparaison sans casse). */
  function manquantes(demandees, accordees) {
    var a = (accordees || []).map(function (x) { return String(x).toLowerCase(); });
    return (demandees || []).map(function (x) { return String(x).split("/").pop(); })
      .filter(function (x) { return a.indexOf(x.toLowerCase()) < 0; });
  }

  /** Détail technique : code (« HTTP 403 », « AADSTS65001 »…) + message, sans répétition. */
  function detailDe(x, e) {
    var d = (e && e.detail) || x.detail || "";
    var code = String(x.code || "");
    var http = /^HTTP \d+/.exec(code);
    if (http) return [http[0], d].filter(Boolean).join(" — ");
    return d.indexOf(code) > -1 ? d : [code, d].filter(Boolean).join(" — ");
  }

  /**
   * Lance toutes les vérifications, une par une.
   * G : window.EBGraph (ou une imitation dans les tests) ; CFG : self.EB_CONFIG.
   * rappel(resultats) est appelé après chaque étape (affichage en direct).
   */
  function executer(G, CFG, rappel, env) {
    env = env || {};
    var res = ETAPES.map(function (e) { return { id: e.id, titre: e.titre, statut: "gris", texte: "", action: "", detail: "", code: "" }; });
    var memo = {};
    function r(id) { return res.filter(function (x) { return x.id === id; })[0]; }
    function poser(id, statut, texte, action, detail, code) {
      var x = r(id); x.statut = statut; x.texte = texte || ""; x.action = action || ""; x.detail = E.nettoyer(detail || ""); x.code = code || "";
      if (rappel) rappel(res);
    }
    function depuisErreur(id, e, gravite, contexte, texteSimple) {
      var x = e && e.explication && !contexte ? e.explication : E.expliquer(e, Object.assign({ horsLigne: env.horsLigne }, contexte || {}));
      poser(id, gravite || "rouge", texteSimple ? texteSimple + " " + x.titre : x.titre, x.action + (x.qui && x.qui !== "vous" ? " (à faire par : " + x.qui + ")" : ""),
        detailDe(x, e), x.code);
    }
    function sauter(ids, pourquoi) { ids.forEach(function (id) { var x = r(id); x.statut = "gris"; x.texte = pourquoi; }); if (rappel) rappel(res); }
    function encours(id) { r(id).statut = "encours"; if (rappel) rappel(res); }

    var ms = (CFG && CFG.microsoft) || {}, spc = (CFG && CFG.sharepoint) || {};
    var siteUrl = null;
    try { siteUrl = new URL(spc.site); } catch (e) { siteUrl = null; }
    var GRAPH_ETAPES = ["scopes", "me", "users", "skus", "roles", "site", "documents", "commun", "jetonsp", "rest", "proprietaire", "gerer"];

    return Promise.resolve().then(function () {
      // 1. Configuration
      encours("config");
      var pb = [];
      if (!G.estMaquette || !G.estMaquette()) {
        if (!ms.clientId) pb.push("« clientId » est vide");
        else if (!GUID.test(ms.clientId)) pb.push("« clientId » n'a pas la bonne forme (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)");
      }
      if (!ms.tenantId) pb.push("« tenantId » est vide");
      if (!siteUrl || !/\.sharepoint\.com$/i.test(siteUrl.hostname)) pb.push("l'adresse du site SharePoint est invalide");
      if (!ms.sharepointScope) pb.push("« sharepointScope » est vide");
      if (pb.length) {
        poser("config", "rouge", "La configuration est incomplète : " + pb.join(", ") + ".",
          "Ouvrir espace-breteuil/config.js sur GitHub (crayon), coller l'« ID d'application (client) » copié dans Entra entre les guillemets de clientId, puis « Commit changes ». Attendre 1 minute et recharger.", pb.join(" ; "), "config");
        sauter(["connexion"].concat(GRAPH_ETAPES), "Pas testé : la configuration doit d'abord être complète.");
        throw { arret: true };
      }
      poser("config", "vert", "Identifiant de l'appli, tenant et site sont renseignés.", "",
        "clientId …" + String(ms.clientId || "maquette").slice(-4) + " · tenant " + ms.tenantId + " · site " + siteUrl.hostname + siteUrl.pathname);

      // 2. Connexion
      encours("connexion");
      if (G.erreurDetail && G.erreurDetail() && !G.estConnecte()) {
        var x = G.erreurDetail();
        poser("connexion", "rouge", x.titre, x.action + (x.qui && x.qui !== "vous" ? " (à faire par : " + x.qui + ")" : ""), [x.code, x.detail].join(" — "), x.code);
        sauter(GRAPH_ETAPES, "Pas testé : il faut d'abord être connecté.");
        throw { arret: true };
      }
      if (!G.estConnecte()) {
        poser("connexion", "orange", "Vous n'êtes pas encore connecté.", "Toucher « Se connecter avec Microsoft » ci-dessous, puis relancer la vérification.", "", "non_connecte");
        sauter(GRAPH_ETAPES, "Pas testé : il faut d'abord être connecté.");
        throw { arret: true };
      }
      var compte = G.compte() || {};
      memo.adresse = String(compte.username || "").toLowerCase();
      var domaine = memo.adresse.split("@")[1] || "";
      var internes = (CFG.domainesInternes || []).map(function (d) { return d.toLowerCase(); });
      if (domaine && internes.length && internes.indexOf(domaine) < 0) {
        poser("connexion", "orange", "Connecté, mais avec une adresse qui n'est pas du Château (" + E.masquerAdresse(memo.adresse) + ").", "Se déconnecter et se reconnecter avec l'adresse …@breteuil.fr.", "", "domaine");
      } else {
        poser("connexion", "vert", "Connecté : " + E.masquerAdresse(memo.adresse) + ".", "", "compte " + E.masquerAdresse(memo.adresse));
      }

      // 3. Permissions accordées (lues dans le jeton Graph)
      encours("scopes");
      return G.scopesAccordes("graph").then(function (acc) {
        if (!acc) { poser("scopes", "gris", "Impossible de lire la liste des permissions dans le jeton. Les étapes suivantes testent chaque permission une par une."); return; }
        var m = manquantes(ms.scopes || [], acc);
        if (!m.length) poser("scopes", "vert", "Toutes les permissions Microsoft Graph demandées sont accordées.", "", "accordées : " + acc.join(" "));
        else poser("scopes", m.indexOf("User.Read") > -1 ? "rouge" : "orange", "Permissions non accordées : " + m.join(", ") + ".",
          "Dans Entra → Espace Breteuil → API autorisées : ajouter ces permissions (déléguées) puis « Accorder un consentement d'administrateur » (François). Se déconnecter et se reconnecter ensuite.",
          "accordées : " + acc.join(" ") + " ; manquantes : " + m.join(" "), "scopes");
      }, function (e) { depuisErreur("scopes", e, "rouge"); });
    }).then(function () {
      // 4 à 7. Graph
      var opts = { silencieux: true };
      encours("me");
      return G.graph("GET", "/me?$select=id,displayName,userPrincipalName", undefined, opts).then(function (me) {
        poser("me", "vert", "Microsoft vous reconnaît" + (me && me.displayName ? " : " + String(me.displayName).split(" ")[0] : "") + ".", "", "User.Read OK");
      }, function (e) { depuisErreur("me", e, "rouge"); }).then(function () {
        encours("users");
        return G.graph("GET", "/users?$select=id&$top=1", undefined, opts).then(function () {
          poser("users", "vert", "L'appli peut lister les personnes du Château.", "", "User.Read.All OK");
        }, function (e) { depuisErreur("users", e, "rouge", null, "L'écran « Les personnes » ne marchera pas."); });
      }).then(function () {
        encours("skus");
        return G.graph("GET", "/subscribedSkus?$select=skuId,skuPartNumber", undefined, opts).then(function (j) {
          poser("skus", "vert", "Les licences du Château sont lisibles" + (j && j.value ? " (" + j.value.length + " type" + (j.value.length > 1 ? "s" : "") + ")" : "") + ".", "", "Directory.Read.All OK");
        }, function (e) { depuisErreur("skus", e, "orange", null, "L'écran « Les licences » ne marchera pas."); });
      }).then(function () {
        encours("roles");
        return G.graph("GET", "/directoryRoles?$select=id,displayName", undefined, opts).then(function () {
          poser("roles", "vert", "« Qui gère quoi » est lisible.", "", "Directory.Read.All OK");
        }, function (e) { depuisErreur("roles", e, "orange", null, "« Qui gère quoi » restera vide."); });
      });
    }).then(function () {
      // 8 à 10. Site, Documents, Commun
      var opts = { silencieux: true, contexte: { site: true } };
      encours("site");
      var chemin = siteUrl.pathname.replace(/\/+$/, "");
      return G.graph("GET", "/sites/" + siteUrl.hostname + ":" + chemin + "?$select=id,displayName,webUrl", undefined, opts).then(function (site) {
        memo.site = site;
        poser("site", "vert", "Site « " + (site.displayName || chemin) + " » trouvé.", "", "sites/" + siteUrl.hostname + ":" + chemin);
        encours("documents");
        return G.graph("GET", "/sites/" + site.id + "/drive?$select=id,name,webUrl", undefined, { silencieux: true }).then(function (d) {
          memo.drive = d;
          poser("documents", "vert", "Bibliothèque « " + (d.name || "Documents") + " » trouvée.", "", "drive OK");
          encours("commun");
          var nom = spc.dossierCommun || "Commun";
          return G.graph("GET", "/drives/" + d.id + "/root:/" + encodeURIComponent(nom) + "?$select=id,name,folder", undefined, { silencieux: true, contexte: { dossier: true } }).then(function (c) {
            poser("commun", "vert", "Dossier « " + nom + " » trouvé" + (c && c.folder ? " (" + (c.folder.childCount || 0) + " élément" + ((c.folder.childCount || 0) > 1 ? "s" : "") + ")" : "") + ".", "", "root:/" + nom);
          }, function (e) { depuisErreur("commun", e, "orange", e && e.statut === 404 ? { dossier: true } : null, "Le dossier « " + nom + " » n'est pas accessible."); });
        }, function (e) {
          depuisErreur("documents", e, "rouge");
          sauter(["commun"], "Pas testé : la bibliothèque n'est pas accessible.");
        });
      }, function (e) {
        depuisErreur("site", e, "rouge", e && e.statut === 404 ? { site: true } : null);
        sauter(["documents", "commun"], "Pas testé : le site n'a pas été trouvé.");
      });
    }).then(function () {
      // 11. Jeton SharePoint
      encours("jetonsp");
      return G.jeton("sp").then(function () {
        return G.scopesAccordes("sp").then(function (acc) {
          var voulu = String(ms.sharepointScope || "").split("/").pop();
          if (acc && voulu && manquantes([voulu], acc).length) {
            poser("jetonsp", "orange", "Jeton SharePoint obtenu, mais sans « " + voulu + " ».", "Dans Entra → API autorisées → SharePoint : ajouter « " + voulu + " » (déléguée) et accorder le consentement administrateur (François).", "accordées : " + acc.join(" "), "scope_sp");
          } else {
            poser("jetonsp", "vert", "L'appli a le droit de parler à SharePoint en votre nom.", "", acc ? "accordées : " + acc.join(" ") : "");
          }
          return true;
        }, function () { poser("jetonsp", "vert", "L'appli a le droit de parler à SharePoint en votre nom."); return true; });
      }, function (e) {
        depuisErreur("jetonsp", e, "rouge");
        sauter(["rest", "proprietaire", "gerer"], "Pas testé : pas d'autorisation SharePoint.");
        return false;
      });
    }).then(function (okSp) {
      if (!okSp) return;
      // 12. REST currentuser (vérifie le CORS)
      encours("rest");
      return G.sp("GET", "/_api/web/currentuser?$select=Id,Title,Email,LoginName,IsSiteAdmin", undefined, null, { silencieux: true }).then(function (u) {
        memo.moiSp = u || {};
        poser("rest", "vert", "SharePoint répond directement à l'appli (pas de blocage CORS).", "", "_api/web/currentuser OK");
        return true;
      }, function (e) {
        depuisErreur("rest", e, "rouge");
        sauter(["proprietaire", "gerer"], "Pas testé : SharePoint ne répond pas à l'appli.");
        return false;
      });
    }).then(function (okRest) {
      if (!okRest) return;
      // 13. Propriétaire du site
      encours("proprietaire");
      var adminCollection = memo.moiSp.IsSiteAdmin === true;
      return G.sp("GET", "/_api/web/associatedownergroup/users?$select=Id,Email,LoginName", undefined, null, { silencieux: true }).then(function (j) {
        var moi = String(memo.moiSp.Email || memo.adresse || "").toLowerCase();
        var ids = ((j && j.value) || []).map(function (x) { return x.Id; });
        var adresses = ((j && j.value) || []).map(function (x) { return String(x.Email || "").toLowerCase(); });
        var dansGroupe = ids.indexOf(memo.moiSp.Id) > -1 || (moi && adresses.indexOf(moi) > -1);
        if (dansGroupe || adminCollection) {
          poser("proprietaire", "vert", dansGroupe ? "Vous êtes dans le groupe « Propriétaires » du site." : "Vous êtes administrateur du site (sans être dans le groupe Propriétaires).", "",
            "IsSiteAdmin=" + adminCollection + " · groupe propriétaires=" + dansGroupe);
        } else {
          poser("proprietaire", "orange", "Vous n'êtes pas propriétaire du site : vous pourrez voir et créer des dossiers, mais pas changer qui y a accès.",
            "Damien ou François : site du Château → roue dentée → Autorisations du site → ajouter ce compte aux « Propriétaires ».", "IsSiteAdmin=false · groupe propriétaires=false", "non_proprietaire");
        }
      }, function (e) {
        if (adminCollection) poser("proprietaire", "vert", "Vous êtes administrateur du site.", "", "IsSiteAdmin=true (groupe propriétaires illisible)");
        else depuisErreur("proprietaire", e, "orange", null, "Impossible de lire le groupe des propriétaires.");
      }).then(function () {
        // 14. ManagePermissions
        encours("gerer");
        return G.sp("GET", "/_api/web/effectivebasepermissions", undefined, null, { silencieux: true }).then(function (p) {
          p = (p && (p.EffectiveBasePermissions || p)) || {};
          if (aLeBit(p.Low, p.High, BIT_MANAGE_PERMISSIONS)) poser("gerer", "vert", "Vous pouvez changer les accès des dossiers (« Qui a accès ? »).", "", "ManagePermissions=oui");
          else poser("gerer", "orange", "Vous ne pouvez pas changer les accès : l'écran « Qui a accès ? » sera en lecture seule.",
            "Devenir « Propriétaire » du site (voir l'étape précédente), puis relancer la vérification.", "ManagePermissions=non (Low=" + p.Low + ")", "ManagePermissions");
        }, function (e) { depuisErreur("gerer", e, "orange"); });
      });
    }).catch(function (e) { if (!e || !e.arret) throw e; }).then(function () { if (rappel) rappel(res); return res; });
  }

  /** Bilan global : le pire statut (rouge > orange > vert). */
  function bilan(res) {
    var rouges = res.filter(function (x) { return x.statut === "rouge"; });
    var oranges = res.filter(function (x) { return x.statut === "orange"; });
    if (rouges.length) return { statut: "rouge", titre: "Ça bloque à l'étape « " + rouges[0].titre + " »", texte: rouges[0].action || rouges[0].texte };
    if (oranges.length) return { statut: "orange", titre: oranges.length === 1 ? "Presque prêt : 1 point à regarder" : "Presque prêt : " + oranges.length + " points à regarder", texte: oranges[0].titre + " — " + (oranges[0].action || oranges[0].texte) };
    if (res.some(function (x) { return x.statut === "gris"; })) return { statut: "gris", titre: "Vérification incomplète", texte: "Certaines étapes n'ont pas pu être testées." };
    return { statut: "vert", titre: "Tout est prêt", texte: "La connexion fonctionne : vous pouvez utiliser le dossier commun et « Qui a accès ? »." };
  }

  /** Rapport texte à coller dans un message à Damien (aucun jeton, adresses masquées). */
  function rapport(res, infos) {
    infos = infos || {};
    var b = bilan(res);
    var l = ["Espace Breteuil — vérification de la connexion",
      "Date : " + (infos.date || new Date().toISOString().slice(0, 16).replace("T", " ")),
      "Version : " + (infos.version || "?") + " · Adresse : " + (infos.adresse || "?"),
      "Appareil : " + (infos.appareil || "?"),
      "Bilan : " + STATUTS[b.statut].symbole + " " + b.titre, ""];
    res.forEach(function (x, i) {
      l.push(STATUTS[x.statut === "encours" ? "gris" : x.statut].symbole + " " + (i + 1) + ". " + x.titre + " : " + (x.texte || STATUTS[x.statut].nom));
      if (x.statut !== "vert" && x.action) l.push("   → " + x.action);
      if (x.statut !== "vert" && x.detail) l.push("   [" + x.detail + "]");
    });
    // Dernière barrière : aucun jeton, même s'il s'était glissé dans un détail.
    return l.map(function (s) { return s.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g, "[jeton masqué]"); }).join("\n");
  }

  /** Description courte de l'appareil (sans identifiant). */
  function appareil(ua, installe) {
    ua = String(ua || "");
    var os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : "autre";
    var nav = /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "navigateur";
    return os + " · " + nav + (installe ? " · appli installée" : " · navigateur");
  }

  var api = { ETAPES: ETAPES, STATUTS: STATUTS, executer: executer, bilan: bilan, rapport: rapport, appareil: appareil, aLeBit: aLeBit, manquantes: manquantes };

  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }

  /* ------------------------------------------------------------------ */
  /* Écran (navigateur)                                                  */
  /* ------------------------------------------------------------------ */
  (function chargerStyle() {
    if (document.querySelector('link[href="diagnostic.css"]')) return;
    var l = document.createElement("link"); l.rel = "stylesheet"; l.href = "diagnostic.css"; document.head.appendChild(l);
  })();

  var dernierRapport = "";
  var generation = 0;

  function ecran(app) {
    var EB = window.EB, G = window.EBGraph, h = EB.h, emoji = EB.emoji, icone = EB.icone;
    var CFG = self.EB_CONFIG || {};
    var gen = ++generation;
    try { localStorage.setItem("eb:diagnostic-vu", "1"); } catch (e) {} // simple drapeau, pas un jeton
    app.appendChild(EB.barre("Vérifier la connexion", { href: "#/reglages", texte: "Réglages" }));
    app.appendChild(h("p", { class: "aide-ecran" }, "L'appli teste une à une les étapes de la connexion au Château. Si quelque chose coince, elle dit quoi faire et qui peut le régler."));
    var entete = h("div", { class: "diag-bilan gris", role: "status" }, h("span", { class: "diag-pastille gris", "aria-hidden": "true" }), h("div", null, h("b", null, "Vérification en cours…")));
    var liste = h("ol", { class: "diag-liste" });
    var boutons = h("div", { class: "actions diag-actions" });
    app.appendChild(entete);
    app.appendChild(boutons);
    app.appendChild(liste);
    app.appendChild(h("p", { class: "petit diag-note" }, "Le rapport copié ne contient ni mot de passe, ni jeton de connexion, ni adresse mail complète."));

    function infos() {
      var installe = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
      return { version: self.EB_VERSION, adresse: location.origin + location.pathname, appareil: appareil(navigator.userAgent, installe), date: new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) };
    }
    function afficher(res) {
      if (gen !== generation || !document.body.contains(liste)) return;
      liste.textContent = "";
      res.forEach(function (x) {
        var S = STATUTS[x.statut];
        liste.appendChild(h("li", { class: "diag-etape " + x.statut, "data-etape": x.id },
          h("span", { class: "diag-pastille " + x.statut, role: "img", "aria-label": S.nom }),
          h("div", { class: "diag-corps" },
            h("div", { class: "diag-titre" }, h("b", null, x.titre), h("span", { class: "diag-etat " + x.statut }, S.nom)),
            x.texte ? h("p", { class: "diag-texte" }, x.texte) : null,
            x.action && x.statut !== "vert" ? h("p", { class: "diag-action" }, emoji("👉"), " ", x.action) : null,
            x.detail ? h("details", { class: "diag-detail" }, h("summary", null, "Détail technique"), h("code", null, x.detail)) : null)));
      });
      dernierRapport = rapport(res, infos());
    }
    function afficherBilan(res) {
      if (gen !== generation) return;
      var b = bilan(res);
      entete.className = "diag-bilan " + b.statut;
      entete.textContent = "";
      entete.appendChild(h("span", { class: "diag-pastille " + b.statut, "aria-hidden": "true" }));
      entete.appendChild(h("div", null, h("b", null, b.titre), h("span", null, b.texte)));
      boutons.textContent = "";
      if (!G.estConnecte() && G.estConfigure()) boutons.appendChild(h("button", { class: "btn large", type: "button", onclick: function () { G.connecter(); } }, emoji("🔐"), "Se connecter avec Microsoft"));
      boutons.appendChild(h("button", { class: "btn" + (G.estConnecte() ? "" : " secondaire"), type: "button", onclick: copier }, icone("coche"), "Copier le rapport"));
      boutons.appendChild(h("button", { class: "btn secondaire", type: "button", onclick: function () { EB.rendre(); } }, icone("actualiser"), "Relancer la vérification"));
      if (b.statut === "vert") boutons.appendChild(h("a", { class: "btn secondaire", href: "#/monchateau" }, emoji("🏰"), "Aller au Château"));
    }
    function copier() {
      var texte = dernierRapport;
      function ok() { EB.toast("Rapport copié : collez-le dans un message à Damien."); }
      function secours() {
        var zone = h("textarea", { class: "champ diag-rapport", readonly: "readonly", "aria-label": "Rapport à copier" });
        zone.value = texte;
        boutons.parentNode.insertBefore(zone, boutons.nextSibling);
        zone.focus(); zone.select();
        var r = false; try { r = document.execCommand("copy"); } catch (e) {}
        if (r) ok(); else EB.toast("Sélectionnez le texte affiché et copiez-le.");
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texte).then(ok, secours);
      else secours();
    }
    executer(G, CFG, afficher, { horsLigne: navigator.onLine === false }).then(function (res) { afficher(res); afficherBilan(res); }, function (e) {
      entete.className = "diag-bilan rouge";
      entete.textContent = "Erreur inattendue pendant la vérification : " + E.nettoyer(e && e.message);
    });
  }

  racine.EBDiagnostic = api;
  api.ecran = ecran;
  api.rapportCourant = function () { return dernierRapport; };
})(typeof self !== "undefined" ? self : this);
