// Tests des droits réels → profil, onglets, garde-fous, pastille : node --test espace-breteuil/tests/profil.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const P = require("../profil.js");
const R = P.ROLES;
const ids = (r) => r.onglets.map((o) => o.id);

test("administrateur général : tout, 5 onglets dont Gérer (Équipe, Finance, Déléguer, Site web)", () => {
  const r = P.deduire({ roles: [R.admin.id], proprietaire: false, gererDroits: false });
  assert.equal(r.profil, "admin");
  assert.deepEqual(r.sections, ["equipe", "finance", "deleguer", "site"]);
  assert.ok(P.routePermise("liens", r), "vérificateur de liens dans Gérer");
  assert.equal(P.routePermise("site", r), false, "pas de doublon : Site web est dans Gérer");
  assert.deepEqual(ids(r), ["accueil", "planning", "fichiers", "gerer", "moi"]);
  for (const route of ["gerer", "deleguer", "personnes", "organisation", "licences-reel"]) assert.ok(P.routePermise(route, r), route);
  assert.equal(P.routePermise("equipe", r), false, "pas de doublon : Équipe est dans Gérer");
  assert.equal(P.routePermise("finance", r), false, "pas de doublon : Finance est dans Gérer");
});

test("propriétaire du site : Planning, Dossiers (avec droits), Équipe, Moi", () => {
  const r = P.deduire({ roles: [], proprietaire: true, gererDroits: true });
  assert.equal(r.profil, "proprietaire");
  assert.deepEqual(ids(r), ["accueil", "planning", "fichiers", "equipe", "moi"]);
  assert.ok(P.routePermise("acces", r));
  assert.ok(P.routePermise("personnes", r));
  assert.equal(P.routePermise("deleguer", r), false);
  assert.equal(P.routePermise("finance", r), false);
});

test("administrateur de facturation : Finance seulement en plus", () => {
  const r = P.deduire({ roles: [R.facturation.id.toUpperCase()] });
  assert.equal(r.profil, "facturation");
  assert.deepEqual(ids(r), ["accueil", "planning", "fichiers", "finance", "moi"]);
  assert.ok(P.routePermise("finance", r));
  assert.ok(P.routePermise("licences-reel", r));
  assert.equal(P.routePermise("acces", r), false);
  assert.equal(P.routePermise("personnes", r), false);
});

test("simple collaborateur : Planning, Dossiers, Moi", () => {
  const r = P.deduire({ roles: ["autre-role"], licences: ["O365_BUSINESS_ESSENTIALS"] });
  assert.equal(r.profil, "collaborateur");
  assert.deepEqual(ids(r), ["accueil", "planning", "fichiers", "moi"]);
  for (const route of ["equipe", "gerer", "finance", "deleguer", "acces", "restreindre", "reserver", "personnes"]) assert.equal(P.routePermise(route, r), false, route);
  for (const route of ["accueil", "planning", "fichiers", "commun", "moi", "reglages", "journal"]) assert.ok(P.routePermise(route, r), route);
});

test("propriétaire ET facturation : regroupés sous Gérer, jamais plus de 5 onglets", () => {
  const r = P.deduire({ roles: [R.facturation.id], proprietaire: true });
  assert.deepEqual(ids(r), ["accueil", "planning", "fichiers", "gerer", "moi"]);
  assert.ok(ids(r).length <= 5);
  assert.equal(P.ongletDe("personnes", r), "gerer");
  assert.equal(P.ongletDe("commun", r), "fichiers");
  assert.equal(P.ongletDe("reglages", r), "moi");
});

test("information manquante = pas de droit (jamais plus que sûr)", () => {
  const r = P.deduire({});
  assert.equal(r.profil, "collaborateur");
  assert.equal(r.droits.gererDroits, false);
  assert.equal(P.routePermise("deleguer", null), false);
});

test("ManagePermissions lu dans effectivebasepermissions", () => {
  assert.equal(P.gererDroitsDe({ High: "432", Low: String(2 ** 24 + 0xFFFF) }), true);
  assert.equal(P.gererDroitsDe({ EffectiveBasePermissions: { High: "0", Low: "65535" } }), false);
  assert.equal(P.gererDroitsDe(null), false);
});

test("garde-fous : ni son propre rôle d'administrateur général, ni le dernier", () => {
  assert.equal(P.refusRetraitRole("admin", "moi", "moi", ["moi", "francois"]), null, "v5.7 : se retirer est permis (confirmation renforcée), sauf dernier");
  assert.match(P.refusRetraitRole("admin", "moi", "moi", ["moi"]), /dernier administrateur/);
  assert.equal(P.retraitRenforce("admin"), true); assert.equal(P.retraitRenforce("facturation"), false);
  assert.match(P.refusRetraitRole("admin", "francois", "moi", ["francois"]), /dernier administrateur/);
  assert.equal(P.refusRetraitRole("admin", "francois", "moi", ["moi", "francois"]), null);
  assert.equal(P.refusRetraitRole("facturation", "moi", "moi", ["moi"]), null, "on peut se retirer un autre rôle");
  assert.match(P.refusRetraitProprietaire(7, 7, [7, 8]), /vous-même/);
  assert.match(P.refusRetraitProprietaire(8, 7, [8]), /dernier propriétaire/);
  assert.equal(P.refusRetraitProprietaire(8, 7, [7, 8]), null);
});

test("permission de gestion des rôles lue dans le jeton (sans casse)", () => {
  assert.ok(P.aLaPermission(["User.Read", "rolemanagement.readwrite.directory"], P.PERMISSION_ROLES));
  assert.equal(P.aLaPermission(["User.Read"], P.PERMISSION_ROLES), false);
});

test("pastille : vert, orange (partiel), rouge (problème), gris (en cours / déconnecté)", () => {
  assert.equal(P.pastille({}, false).couleur, "gris");
  assert.equal(P.pastille({ me: { etat: "ok" }, sp: { etat: "ok" } }, true).couleur, "vert");
  assert.equal(P.pastille({ me: { etat: "ok" }, sp: { etat: "attente" } }, true).couleur, "gris");
  const o = P.pastille({ me: { etat: "ok" }, commun: { etat: "erreur", message: "Le dossier commun est introuvable." } }, true);
  assert.equal(o.couleur, "orange"); assert.match(o.texte, /introuvable/);
  assert.equal(P.pastille({ me: { etat: "erreur", critique: true, message: "Session expirée." }, sp: { etat: "ok" } }, true).couleur, "rouge");
});

test("groupe « Site web » : nom comparé sans casse ni espaces, groupes imbriqués compris (transitiveMemberOf)", () => {
  const groupes = [{ displayName: "Accueil" }, { displayName: "  SITE   Web " }];
  assert.ok(P.estMembreDe(groupes, "Site web"));
  assert.equal(P.estMembreDe([{ displayName: "Site web (archives)" }], "Site web"), false, "nom exact, pas « contient »");
  assert.equal(P.estMembreDe(groupes, ""), false, "groupe non configuré = personne");
  assert.equal(P.estMembreDe(null, "Site web"), false);
});

test("membre du groupe Site web sans autre droit : onglet « Site » (5 onglets)", () => {
  const r = P.deduire({ roles: [], licences: ["O365_BUSINESS_ESSENTIALS"], siteWeb: true });
  assert.equal(r.profil, "collaborateur");
  assert.deepEqual(r.sections, ["site"]);
  assert.deepEqual(ids(r), ["accueil", "planning", "fichiers", "site", "moi"]);
  assert.equal(r.onglets[3].nom, "Site");
  for (const route of ["site", "liens"]) assert.ok(P.routePermise(route, r), route);
  for (const route of ["gerer", "equipe", "finance", "deleguer", "personnes", "acces"]) assert.equal(P.routePermise(route, r), false, route);
  assert.equal(P.ongletDe("liens", r), "site");
});

test("Site web + autre section : regroupés sous Gérer, jamais plus de 5 onglets", () => {
  const r = P.deduire({ roles: [], proprietaire: true, siteWeb: true });
  assert.deepEqual(r.sections, ["equipe", "site"]);
  assert.deepEqual(ids(r), ["accueil", "planning", "fichiers", "gerer", "moi"]);
  assert.equal(P.routePermise("site", r), false);
  assert.ok(P.routePermise("liens", r));
  assert.equal(P.ongletDe("liens", r), "gerer");
  const f = P.deduire({ roles: [R.facturation.id], siteWeb: true });
  assert.deepEqual(ids(f), ["accueil", "planning", "fichiers", "gerer", "moi"]);
});

test("pas membre du groupe : ni onglet Site, ni vérificateur", () => {
  const r = P.deduire({ roles: [], siteWeb: false });
  assert.deepEqual(ids(r), ["accueil", "planning", "fichiers", "moi"]);
  assert.equal(P.routePermise("site", r), false);
  assert.equal(P.routePermise("liens", r), false);
  assert.equal(P.routePermise("liens", null), false);
});

test("v5.2 Suivi informatique (#/suivi) : depuis Gérer, Équipe ou Finance ; jamais pour un simple collaborateur", () => {
  const cas = [
    [{ roles: [R.admin.id] }, true, "gerer"],
    [{ roles: [], proprietaire: true }, true, "equipe"],
    [{ roles: [R.facturation.id] }, true, "finance"],
    [{ roles: [], siteWeb: true }, false, null],
    [{ roles: [] }, false, null],
  ];
  for (const [e, permis, onglet] of cas) {
    const r = P.deduire(e);
    assert.equal(P.routePermise("suivi", r), permis, JSON.stringify(e));
    if (onglet) assert.equal(P.ongletDe("suivi", r), onglet);
    assert.ok(r.onglets.length <= 5);
  }
  assert.equal(P.routePermise("suivi", null), false, "droits inconnus : écran en attente");
  assert.equal(P.ongletDe("moi", P.deduire({ roles: [] })), "moi", "Moi → Guides reste sous Moi");
});

/* v5.5 : les 3 niveaux affichés (Lecteur, Éditeur, Gestionnaire), déduits des droits RÉELS. */
const LECTURE = { High: "176", Low: "138612833" }; // lecture seule (ni AddListItems, ni EditListItems)
const COLLABORATION = { High: "432", Low: String(0x1FFF) }; // ajouter + modifier, sans ManagePermissions
const CONTROLE = { High: "432", Low: String(2 ** 24 + 0xFFFF) };
test("niveau : AddListItems + EditListItems lus dans effectivebasepermissions", () => {
  assert.equal(P.editerDe(LECTURE), false);
  assert.equal(P.editerDe(COLLABORATION), true);
  assert.equal(P.editerDe({ EffectiveBasePermissions: COLLABORATION }), true);
  assert.equal(P.editerDe({ High: "0", Low: "3" }), false, "ajouter sans modifier : pas éditeur");
  assert.equal(P.editerDe(null), false);
});
test("niveau : Lecteur, Éditeur, Gestionnaire selon les droits réels", () => {
  const de = (perm, extra = {}) => P.deduire({ roles: [], gererDroits: P.gererDroitsDe(perm), editer: P.editerDe(perm), ...extra }).niveau;
  assert.equal(de(LECTURE), "lecteur");
  assert.equal(de(COLLABORATION), "editeur");
  assert.equal(de(CONTROLE), "gestionnaire");
  assert.equal(de(LECTURE, { proprietaire: true }), "gestionnaire", "propriétaire du site = gestionnaire");
  // Un rôle Microsoft (même administrateur général) ne donne PAS à lui seul un niveau sur les documents.
  assert.equal(P.deduire({ roles: [R.admin.id], editer: false }).niveau, "lecteur");
  assert.deepEqual(Object.keys(P.NIVEAUX), ["lecteur", "editeur", "gestionnaire"]);
  assert.deepEqual(Object.values(P.NIVEAUX).map((n) => n.nom), ["Lecteur", "Éditeur", "Gestionnaire"]);
  assert.equal(P.NIVEAUX.gestionnaire.nePeut.length, 0);
});
test("niveau inconnu (lecture des droits en échec) : affiché Lecteur, boutons d'ajout gardés", () => {
  const r = P.deduire({ roles: [] });
  assert.equal(r.niveau, "lecteur");
  assert.equal(r.droits.editer, null);
  assert.equal(P.peutEditer(r), true);
  assert.equal(P.peutEditer(P.deduire({ editer: false })), false, "Lecteur sûr : boutons d'ajout cachés");
  assert.equal(P.peutEditer(P.deduire({ editer: true })), true);
});
test("onglets : Accueil en premier, 5 au plus, onglet de gestion trouvé", () => {
  const r = P.deduire({ roles: [R.facturation.id] });
  assert.deepEqual(ids(r), ["accueil", "planning", "fichiers", "finance", "moi"]);
  assert.equal(r.onglets.find((o) => o.id === "fichiers").nom, "Documents");
  assert.equal(r.onglets.find((o) => o.id === "finance").nom, "Factures");
  assert.equal(P.ongletGestion(r.onglets).id, "finance");
  assert.equal(P.ongletGestion(P.deduire({}).onglets), null);
  assert.equal(P.ongletDe("comment-faire", r), "accueil");
  assert.equal(P.ongletDe("", r), "accueil");
});

test("v5.7 : « Qui peut utiliser l'application » réservé aux administrateurs général et d'applications", () => {
  const P2 = P;
  const ga = P2.deduire({ roles: ["62e90394-69f5-4237-9190-012177145e10"] });
  const cloud = P2.deduire({ roles: ["158c047a-c907-4556-b7ef-446551a6b5f7"] });
  const fact = P2.deduire({ roles: ["b0f54661-2d74-4c50-afa3-1ec803f12efe"] });
  assert.equal(ga.droits.adminApplis, true); assert.equal(cloud.droits.adminApplis, true); assert.equal(fact.droits.adminApplis, false);
  assert.equal(P2.routePermise("acces-appli", ga), true); assert.equal(P2.routePermise("acces-appli", fact), false); assert.equal(P2.routePermise("acces-appli", null), false);
  assert.deepEqual(cloud.sections, [], "aucune section en plus : les onglets ne changent pas");
});
