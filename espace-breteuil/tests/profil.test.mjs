// Tests des droits réels → profil, onglets, garde-fous, pastille : node --test espace-breteuil/tests/profil.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const P = require("../profil.js");
const R = P.ROLES;
const ids = (r) => r.onglets.map((o) => o.id);

test("administrateur général : tout, 4 onglets dont Gérer (Équipe, Finance, Déléguer, Site web)", () => {
  const r = P.deduire({ roles: [R.admin.id], proprietaire: false, gererDroits: false });
  assert.equal(r.profil, "admin");
  assert.deepEqual(r.sections, ["equipe", "finance", "deleguer", "site"]);
  assert.ok(P.routePermise("liens", r), "vérificateur de liens dans Gérer");
  assert.equal(P.routePermise("site", r), false, "pas de doublon : Site web est dans Gérer");
  assert.deepEqual(ids(r), ["planning", "fichiers", "gerer", "moi"]);
  for (const route of ["gerer", "deleguer", "personnes", "organisation", "licences-reel"]) assert.ok(P.routePermise(route, r), route);
  assert.equal(P.routePermise("equipe", r), false, "pas de doublon : Équipe est dans Gérer");
  assert.equal(P.routePermise("finance", r), false, "pas de doublon : Finance est dans Gérer");
});

test("propriétaire du site : Planning, Dossiers (avec droits), Équipe, Moi", () => {
  const r = P.deduire({ roles: [], proprietaire: true, gererDroits: true });
  assert.equal(r.profil, "proprietaire");
  assert.deepEqual(ids(r), ["planning", "fichiers", "equipe", "moi"]);
  assert.ok(P.routePermise("acces", r));
  assert.ok(P.routePermise("personnes", r));
  assert.equal(P.routePermise("deleguer", r), false);
  assert.equal(P.routePermise("finance", r), false);
});

test("administrateur de facturation : Finance seulement en plus", () => {
  const r = P.deduire({ roles: [R.facturation.id.toUpperCase()] });
  assert.equal(r.profil, "facturation");
  assert.deepEqual(ids(r), ["planning", "fichiers", "finance", "moi"]);
  assert.ok(P.routePermise("finance", r));
  assert.ok(P.routePermise("licences-reel", r));
  assert.equal(P.routePermise("acces", r), false);
  assert.equal(P.routePermise("personnes", r), false);
});

test("simple collaborateur : Planning, Dossiers, Moi", () => {
  const r = P.deduire({ roles: ["autre-role"], licences: ["O365_BUSINESS_ESSENTIALS"] });
  assert.equal(r.profil, "collaborateur");
  assert.deepEqual(ids(r), ["planning", "fichiers", "moi"]);
  for (const route of ["equipe", "gerer", "finance", "deleguer", "acces", "restreindre", "personnes"]) assert.equal(P.routePermise(route, r), false, route);
  for (const route of ["planning", "fichiers", "commun", "moi", "reglages", "journal"]) assert.ok(P.routePermise(route, r), route);
});

test("propriétaire ET facturation : regroupés sous Gérer, jamais plus de 4 onglets", () => {
  const r = P.deduire({ roles: [R.facturation.id], proprietaire: true });
  assert.deepEqual(ids(r), ["planning", "fichiers", "gerer", "moi"]);
  assert.ok(ids(r).length <= 4);
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
  assert.match(P.refusRetraitRole("admin", "moi", "moi", ["moi", "francois"]), /propre rôle/);
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

test("membre du groupe Site web sans autre droit : onglet « Site » (4 onglets)", () => {
  const r = P.deduire({ roles: [], licences: ["O365_BUSINESS_ESSENTIALS"], siteWeb: true });
  assert.equal(r.profil, "collaborateur");
  assert.deepEqual(r.sections, ["site"]);
  assert.deepEqual(ids(r), ["planning", "fichiers", "site", "moi"]);
  assert.equal(r.onglets[2].nom, "Site");
  for (const route of ["site", "liens"]) assert.ok(P.routePermise(route, r), route);
  for (const route of ["gerer", "equipe", "finance", "deleguer", "personnes", "acces"]) assert.equal(P.routePermise(route, r), false, route);
  assert.equal(P.ongletDe("liens", r), "site");
});

test("Site web + autre section : regroupés sous Gérer, jamais plus de 4 onglets", () => {
  const r = P.deduire({ roles: [], proprietaire: true, siteWeb: true });
  assert.deepEqual(r.sections, ["equipe", "site"]);
  assert.deepEqual(ids(r), ["planning", "fichiers", "gerer", "moi"]);
  assert.equal(P.routePermise("site", r), false);
  assert.ok(P.routePermise("liens", r));
  assert.equal(P.ongletDe("liens", r), "gerer");
  const f = P.deduire({ roles: [R.facturation.id], siteWeb: true });
  assert.deepEqual(ids(f), ["planning", "fichiers", "gerer", "moi"]);
});

test("pas membre du groupe : ni onglet Site, ni vérificateur", () => {
  const r = P.deduire({ roles: [], siteWeb: false });
  assert.deepEqual(ids(r), ["planning", "fichiers", "moi"]);
  assert.equal(P.routePermise("site", r), false);
  assert.equal(P.routePermise("liens", r), false);
  assert.equal(P.routePermise("liens", null), false);
});
