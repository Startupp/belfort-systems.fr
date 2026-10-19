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
  assert.equal(D.nomGroupe("Propriétaires de Château de Breteuil"), "Gestionnaires");
  assert.equal(D.nomGroupe("Château de Breteuil Members"), "Toute l'équipe", "pas de jargon « Membres »");
  assert.equal(D.nomGroupe("SharingLinks.x.AnonymousView.y"), "Lien ouvert à tous");
});

test("v5.5.1 : boîtes partagées toujours à part, quelle que soit leur licence ; prestataire ; homonymes", () => {
  const sku = { a: "O365_BUSINESS_PREMIUM", b: "O365_BUSINESS_ESSENTIALS" };
  const LISTE = ["chanteclerc", "chanteclercdeveloppement", "hfb", "Intendance", "fetpdebreteuil@breteuil.fr"];
  const PRESTA = { prestataires: ["damien@breteuil02.onmicrosoft.com"] };
  const boite = (mail, licences, extra) => ({ mail, userPrincipalName: mail, accountEnabled: true, assignedLicenses: licences, ...extra });
  // Boîte partagée qui garde une licence d'essai Business Standard (cas réel) : dans la liste → boîte.
  assert.equal(D.profilDe(boite("chanteclerc@breteuil.fr", [{ skuId: "a" }]), sku, LISTE, PRESTA), "boite");
  assert.equal(D.profilDe(boite("chanteclercdeveloppement@breteuil.fr", [{ skuId: "a" }]), sku, LISTE, PRESTA), "boite");
  // … puis la même, licence retirée, connexion encore possible : toujours une boîte (pas « Sans licence »).
  assert.equal(D.profilDe(boite("chanteclerc@breteuil.fr", []), sku, LISTE, PRESTA), "boite");
  // Partie avant @ sans tenir compte des majuscules ; aussi via le nom de connexion.
  assert.equal(D.profilDe({ mail: "INTENDANCE@breteuil.fr", assignedLicenses: [{ skuId: "a" }] }, sku, LISTE), "boite");
  assert.equal(D.profilDe({ userPrincipalName: "hfb@breteuil02.onmicrosoft.com", assignedLicenses: [] , accountEnabled: true }, sku, LISTE), "boite");
  // Une partie avant @ ne doit pas attraper un nom plus long.
  assert.equal(D.profilDe(boite("hfb2@breteuil.fr", [{ skuId: "b" }]), sku, LISTE), "basic");
  // Réglage Exchange userPurpose = shared : boîte même hors liste et avec licence.
  assert.equal(D.profilDe(boite("travaux@breteuil.fr", [{ skuId: "a" }], { userPurpose: "shared" }), sku, [], PRESTA), "boite");
  assert.equal(D.profilDe(boite("vdurand@breteuil.fr", [{ skuId: "a" }], { userPurpose: "user" }), sku, [], PRESTA), "standard");
  // Indice historique : sans licence + connexion bloquée → boîte, sans liste.
  assert.equal(D.profilDe(boite("klefur@breteuil.fr", [], { accountEnabled: false }), sku, [], PRESTA), "boite");
  // FetP (adresse partagée de François et Pauline, sans licence, avec photo) : adresse complète dans la liste.
  assert.equal(D.profilDe({ displayName: "FetP", mail: "fetpdebreteuil@breteuil.fr", accountEnabled: true, assignedLicenses: [] }, sku, LISTE, PRESTA), "boite");
  assert.equal(D.profilDe({ displayName: "FetP", mail: "fetpdebreteuil@breteuil.fr", accountEnabled: true, assignedLicenses: [] }, sku, [], PRESTA), "aucune", "sans la liste, on ne devine pas");
  // Prestataire (compte d'administration sans licence) : groupe à part, pas « Sans licence ».
  assert.equal(D.profilDe({ displayName: "Damien", userPrincipalName: "Damien@breteuil02.onmicrosoft.com", accountEnabled: true, assignedLicenses: [] }, sku, LISTE, PRESTA), "prestataire");
  assert.equal(D.profilDe({ displayName: "Damien", userPrincipalName: "damien@breteuil02.onmicrosoft.com", accountEnabled: true, assignedLicenses: [] }, sku, LISTE, {}), "aucune", "liste vide : Sans licence");
  assert.ok(D.PROFILS.prestataire.nom && D.PROFILS.prestataire.outils.length);
  // Licence seule, pour signaler les boîtes qui consomment encore une licence.
  assert.equal(D.licenceDe(boite("chanteclerc@breteuil.fr", [{ skuId: "a" }]), sku), "standard");
  assert.equal(D.licenceDe(boite("chanteclerc@breteuil.fr", []), sku), "aucune");
  // Homonymes : deux « Valérie » → partie avant @ sous chacune ; les autres rien.
  assert.deepEqual(D.distinguerHomonymes([
    { id: "1", displayName: "Valérie", mail: "vdurand@breteuil.fr" }, { id: "2", displayName: "valérie ", mail: "vmartin@breteuil.fr" },
    { id: "3", displayName: "Fanny", mail: "fmartin@breteuil.fr" }]), { 1: "vdurand", 2: "vmartin" });
  assert.deepEqual(D.distinguerHomonymes([]), {});
  // Libellé affiché = prénom : « Valérie Durand » et « Valérie Martin » s'affichent tous deux « Valérie ».
  const deux = [{ id: "a", displayName: "Valérie Durand", prenom: "Valérie", mail: "vdurand@breteuil.fr" }, { id: "b", displayName: "Valérie Martin", prenom: "Valérie", userPrincipalName: "vmartin@breteuil.fr" }];
  assert.deepEqual(D.distinguerHomonymes(deux), {});
  assert.deepEqual(D.distinguerHomonymes(deux, (x) => x.prenom), { a: "vdurand", b: "vmartin" });
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

/* ---------- « Réserver à certaines personnes » (données FICTIVES) ---------- */
const CTX_R = { moi: "pdebreteuil@breteuil.fr", moiId: 7, groupeProprietairesId: 3, proprietaires: ["pdebreteuil@breteuil.fr", "fdebreteuil@breteuil.fr", "damien@breteuil02.onmicrosoft.com"] };
const prot = (m) => D.estProtege(m, CTX_R);
const pers = (Id, Title, mail) => ({ Id, Title, Email: mail, LoginName: "i:0#.f|membership|" + mail, PrincipalType: 1 });
const ENTREES = [
  { principalId: 3, membre: { Id: 3, Title: "Propriétaires de Château de Breteuil", PrincipalType: 8 }, niveau: "modifier", total: true },
  { principalId: 4, membre: { Id: 4, Title: "Membres de Château de Breteuil", PrincipalType: 8 }, niveau: "modifier" },
  { principalId: 5, membre: { Id: 5, Title: "SharingLinks.abc.OrganizationView.1", PrincipalType: 8 }, niveau: "voir" },
  { principalId: 9, membre: pers(9, "Valérie Durand", "vdurand@breteuil.fr"), niveau: "modifier" },
  { principalId: 10, membre: pers(10, "Fanny Martin", "fmartin@breteuil.fr"), niveau: "voir" },
  { principalId: 8, membre: pers(8, "François de Breteuil", "fdebreteuil@breteuil.fr"), niveau: "modifier" },
  { principalId: 13, membre: { Id: 13, Title: "Jean Agence", LoginName: "i:0#.f|membership|jean_agence.fr#ext#@breteuil02.onmicrosoft.com", PrincipalType: 1 }, niveau: "voir" },
];

test("réserver : tout ce qui n'est ni choisi ni protégé est retiré (groupes, liens, personnes, externes)", () => {
  const choisis = [{ nom: "Pauline de Breteuil", mail: "pdebreteuil@breteuil.fr" }, { nom: "François de Breteuil", mail: "FDEBRETEUIL@breteuil.fr" }];
  const p = D.planReserve(ENTREES, choisis, "modifier", prot);
  assert.deepEqual(p.retirer.map((e) => e.principalId).sort((a, b) => a - b), [4, 5, 9, 10, 13]);
  assert.deepEqual(p.proteges.map((x) => [x.entree.principalId, x.raison]), [[3, "Groupe des propriétaires du site"], [8, "Propriétaire du site"]]);
  assert.deepEqual(p.ajouter.map((x) => x.nom), ["Pauline de Breteuil"], "Pauline n'a pas d'accès direct : on l'ajoute");
  assert.equal(p.changer.length + p.garder.length, 0, "François est protégé : ni changé ni retiré");
});

test("réserver : une personne choisie déjà présente garde ou change de niveau ; jamais retirée", () => {
  const choisis = [{ nom: "Fanny Martin", upn: "fmartin@breteuil.fr" }, { nom: "Valérie Durand", mail: "vdurand@breteuil.fr" }];
  const voir = D.planReserve(ENTREES, choisis, "voir", prot);
  assert.deepEqual(voir.garder.map((e) => e.principalId), [10]);
  assert.deepEqual(voir.changer.map((e) => e.principalId), [9]);
  assert.equal(voir.ajouter.length, 0);
  assert.ok(!voir.retirer.some((e) => e.principalId === 9 || e.principalId === 10));
  assert.ok(!voir.retirer.some((e) => e.principalId === 3), "le groupe des propriétaires n'est jamais retiré");
});

test("réserver : sans garde-fou fourni, rien n'est protégé ; choix vide = tout retirer ; adresse vide ignorée", () => {
  const p = D.planReserve(ENTREES, [{ nom: "Sans adresse" }], "voir");
  assert.equal(p.retirer.length, ENTREES.length);
  assert.equal(p.ajouter.length, 0);
  assert.deepEqual(D.planReserve([], [], "voir", prot), { retirer: [], changer: [], garder: [], proteges: [], ajouter: [] });
});

test("réserver : phrase de confirmation en clair, obligatoires sans jargon", () => {
  const choisis = [{ nom: "Pauline de Breteuil", mail: "pdebreteuil@breteuil.fr" }, { nom: "François de Breteuil", mail: "fdebreteuil@breteuil.fr" }];
  const p = D.planReserve(ENTREES.concat([{ principalId: 11, membre: pers(11, "Damien Belfort", "damien@breteuil02.onmicrosoft.com"), niveau: "modifier" }]), choisis, "modifier", prot);
  const obl = D.obligatoiresReserve(p.proteges, (m) => m.Title, choisis);
  assert.deepEqual(obl, ["l'administrateur du site (obligatoire)", "Damien Belfort (propriétaire du site, obligatoire)"]);
  assert.equal(D.phraseReserve(["Pauline de Breteuil", "François de Breteuil"], "Contrats.pdf", []),
    "Seuls Pauline de Breteuil et François de Breteuil pourront ouvrir « Contrats.pdf ». Les autres ne le verront plus.");
  assert.equal(D.phraseReserve(["A", "B", "C"], "X", ["l'administrateur du site (obligatoire)"]),
    "Seuls A, B et C pourront ouvrir « X » + l'administrateur du site (obligatoire). Les autres ne le verront plus.");
  assert.match(D.phraseReserve(["Pauline de Breteuil"], "X"), /^Seul\(e\) Pauline de Breteuil pourra ouvrir « X »/);
  const moiSeul = D.obligatoiresReserve([{ entree: { membre: pers(7, "Pauline de Breteuil", "pdebreteuil@breteuil.fr") }, raison: "C'est vous" }], null, []);
  assert.deepEqual(moiSeul, ["vous-même (obligatoire)"]);
  for (const t of obl.concat([D.phraseReserve(["A"], "X", obl)])) assert.doesNotMatch(t, /h[ée]ritage|membres|SharePoint/i);
});
