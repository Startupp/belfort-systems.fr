// Tests de la traduction des droits et licences : node --test espace-breteuil/tests/droits.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const D = require("../droits.js");
const OPTS = { domainesInternes: ["breteuil.fr", "breteuil02.onmicrosoft.com"] };

test("niveaux simples d'après les rôles SharePoint", () => {
  assert.deepEqual(D.niveauDeRoles([{ RoleTypeKind: 2, Name: "Lecture" }]), { niveau: "voir", controleTotal: false });
  assert.equal(D.niveauDeRoles([{ RoleTypeKind: 3, Name: "Collaboration" }]).niveau, "modifier");
  assert.equal(D.niveauDeRoles([{ RoleTypeKind: 6, Name: "Modification" }]).niveau, "modifier");
  assert.deepEqual(D.niveauDeRoles([{ RoleTypeKind: 5, Name: "Contrôle total" }]), { niveau: "modifier", controleTotal: true });
  assert.equal(D.niveauDeRoles([{ RoleTypeKind: 1, Name: "Accès limité" }]), null, "accès limité = masqué");
  assert.equal(D.niveauDeRoles([{ RoleTypeKind: 2 }, { RoleTypeKind: 3 }]).niveau, "modifier");
  assert.equal(D.niveauDeRoles([{ RoleTypeKind: 0, Name: "Restricted View" }]).niveau, "voir");
});

test("types : équipe, externe (#EXT#, autre domaine, adresse perso), lien, groupe", () => {
  assert.equal(D.typeDe({ PrincipalType: 1, LoginName: "i:0#.f|membership|pdebreteuil@breteuil.fr", Email: "pdebreteuil@breteuil.fr" }, OPTS), "interne");
  assert.equal(D.typeDe({ PrincipalType: 1, LoginName: "i:0#.f|membership|jean_agence.fr#ext#@breteuil02.onmicrosoft.com" }, OPTS), "externe");
  assert.equal(D.adresseDe({ LoginName: "i:0#.f|membership|jean_agence.fr#ext#@breteuil02.onmicrosoft.com" }), "jean@agence.fr");
  assert.equal(D.typeDe({ PrincipalType: 1, LoginName: "i:0#.f|membership|amelie.exemple_gmail.com#ext#@breteuil02.onmicrosoft.com" }, OPTS), "externe");
  assert.equal(D.typeDe({ userType: "Member", mail: "Amelie.Exemple@gmail.com" }, OPTS), "externe", "adresse perso = externe");
  assert.equal(D.TYPES.externe.nom, "Externe");
  assert.equal(D.TYPES.externe.aide, "Toute personne sans adresse @breteuil.fr est considérée comme externe.");
  assert.equal(D.typeDe({ userType: "Guest", mail: "x@traiteur.fr" }, OPTS), "externe");
  assert.equal(D.typeDe({ PrincipalType: 1, Email: "x@traiteur.fr", LoginName: "i:0#.f|membership|urn%3aspo%3aguest#x@traiteur.fr" }, OPTS), "externe");
  assert.equal(D.typeDe({ PrincipalType: 8, Title: "SharingLinks.abc.OrganizationEdit.123" }, OPTS), "lien");
  assert.equal(D.typeDe({ PrincipalType: 8, Title: "Membres de Château de Breteuil" }, OPTS), "groupe");
});

test("garde-fous : soi-même, propriétaires, groupe des propriétaires", () => {
  const ctx = { moi: "pdebreteuil@breteuil.fr", groupeProprietairesId: 3, proprietaires: ["fdebreteuil@breteuil.fr"] };
  assert.equal(D.estProtege({ Id: 3, PrincipalType: 8 }, ctx), "Groupe des propriétaires du site");
  assert.equal(D.estProtege({ Id: 11, Email: "PDEBRETEUIL@breteuil.fr" }, ctx), "C'est vous");
  assert.equal(D.estProtege({ Id: 12, LoginName: "i:0#.f|membership|fdebreteuil@breteuil.fr" }, ctx), "Propriétaire du site");
  assert.equal(D.estProtege({ Id: 13, Email: "ysaber@breteuil.fr" }, ctx), "");
});

test("noms de groupes en clair", () => {
  assert.equal(D.nomGroupe("Propriétaires de Château de Breteuil"), "Propriétaires du site");
  assert.equal(D.nomGroupe("Château de Breteuil Members"), "Membres du site");
  assert.equal(D.nomGroupe("SharingLinks.x.AnonymousView.y"), "Lien ouvert à tous");
});

test("profils de licence et boîtes partagées", () => {
  const sku = { a: "O365_BUSINESS_PREMIUM", b: "O365_BUSINESS_ESSENTIALS", c: "FLOW_FREE" };
  assert.equal(D.profilDe({ assignedLicenses: [{ skuId: "c" }, { skuId: "a" }] }, sku), "standard");
  assert.equal(D.profilDe({ assignedLicenses: [{ skuId: "b" }] }, sku), "basic");
  assert.equal(D.profilDe({ assignedLicenses: [], accountEnabled: true, mail: "x@breteuil.fr" }, sku), "aucune");
  assert.equal(D.profilDe({ assignedLicenses: [], accountEnabled: false, mail: "jardins@breteuil.fr" }, sku), "boite");
  assert.equal(D.profilDe({ assignedLicenses: [{ skuId: "b" }], mail: "contact@breteuil.fr" }, sku, ["contact@breteuil.fr"]), "boite");
  assert.equal(D.profilDe({ userType: "Guest", assignedLicenses: [] }, sku), "externe");
  const n = D.compteLicences([
    { skuPartNumber: "O365_BUSINESS_PREMIUM", prepaidUnits: { enabled: 6 }, consumedUnits: 5 },
    { skuPartNumber: "O365_BUSINESS_ESSENTIALS", prepaidUnits: { enabled: 6 }, consumedUnits: 6 },
    { skuPartNumber: "FLOW_FREE", prepaidUnits: { enabled: 10000 }, consumedUnits: 3 },
  ]);
  assert.deepEqual(n.map((x) => [x.profil, x.achetees, x.attribuees, x.libres]), [["standard", 6, 5, 1], ["basic", 6, 6, 0]]);
});

test("noms de dossier et identifiant de connexion", () => {
  assert.equal(D.nomDossierValide("Mariages 2027"), "");
  assert.notEqual(D.nomDossierValide("a/b"), "");
  assert.notEqual(D.nomDossierValide("  "), "");
  assert.equal(D.logonName("YSaber@Breteuil.fr"), "i:0#.f|membership|ysaber@breteuil.fr");
});

test("plans de service Microsoft : outils en français, dédoublonnés, triés ; le reste pour le support", () => {
  const actif = (n) => ({ servicePlanName: n, provisioningStatus: "Success" });
  const r = D.outilsDesPlans([
    { skuPartNumber: "O365_BUSINESS_PREMIUM", servicePlans: ["MDOLITE_ENTERPRISE", "EXCHANGE_STORAGE_50GB", "INSIGHTS_BY_MYANALYTICS", "TEAMS1", "SHAREPOINTSTANDARD",
      "EXCHANGE_S_STANDARD", "SHAREPOINTWAC", "MCOSTANDARD", "OFFICESUBSCRIPTION", "FORMS_PLAN_E1", "FLOW_O365_P1", "POWERAPPS_O365_P1", "BPOS_S_TODO_1",
      "MICROSOFTBOOKINGS", "SWAY", "STREAM_O365_SMB", "WHITEBOARD_PLAN1", "PROJECTWORKMANAGEMENT", "INTUNE_O365", "VIVAENGAGE_CORE", "YAMMER_ENTERPRISE",
      "Bing_Chat_Enterprise", "MICROSOFT_SEARCH", "OFFICEMOBILE_SUBSCRIPTION", "MYANALYTICS_P2"].map(actif)
      .concat([{ servicePlanName: "KAIZALA_O365_P2", provisioningStatus: "Disabled" }, { servicePlanName: "SWAY", provisioningStatus: "Disabled" }]) },
    { skuPartNumber: "EXCHANGESTANDARD", servicePlans: [actif("EXCHANGE_S_STANDARD"), actif("TEAMS1")] },
  ]);
  const noms = r.outils.map((o) => o.nom);
  assert.equal(new Set(noms).size, noms.length, "dédoublonné (Teams, mail, Viva Engage, Insights)");
  assert.deepEqual(noms, [...noms].sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" })), "trié");
  for (const n of ["Boîte mail Outlook (50 Go)", "Teams", "Dossiers partagés (SharePoint)", "Word, Excel, PowerPoint en ligne", "Word, Excel, PowerPoint à installer",
    "Forms (questionnaires)", "Power Automate (automatisations)", "Power Apps", "To Do (listes de tâches)", "Bookings (prise de rendez-vous)", "Stream (vidéos)",
    "Whiteboard (tableau blanc)", "Planner (projets)", "Gestion des téléphones (Intune)", "Viva Engage", "Copilot (assistant gratuit)", "Recherche Microsoft",
    "Office sur téléphone", "Sway (présentations)"]) assert.ok(noms.includes(n), n);
  assert.ok(r.outils.every((o) => o.emoji && !/^[A-Z0-9_]+$/.test(o.nom)), "aucun code brut dans la liste");
  assert.equal(noms.filter((n) => n === "Viva Engage").length, 1);
  assert.deepEqual(r.support.map((s) => s.code + (s.desactive ? " (désactivé)" : "")),
    ["EXCHANGE_STORAGE_50GB", "MDOLITE_ENTERPRISE", "KAIZALA_O365_P2 (désactivé)", "SWAY (désactivé)"], "non reconnus puis désactivés");
  assert.equal(r.support[0].licence, "Business Standard");
  assert.deepEqual(D.outilsDesPlans(null), { outils: [], support: [] });
  assert.deepEqual(D.outilsDesPlans([{ skuPartNumber: "X", servicePlans: [actif("constructor")] }]).outils, [], "nom de propriété JS : pas un outil");
});
