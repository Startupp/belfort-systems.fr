// Qui peut utiliser l'application (v5.7, contrôle Microsoft) : node --test espace-breteuil/tests/acces-appli.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const X = createRequire(import.meta.url)("../acces-appli.js");

const U = (id, nom, extra) => Object.assign({ id, displayName: nom, mail: id + "@chateau-exemple.fr", userType: "Member", accountEnabled: true }, extra || {});
const UTIL = [U("u1", "Pauline"), U("u2", "François"), U("u3", "Zoé"), U("u4", "Fanny"), U("inv", "Invité", { userType: "Guest" }), U("off", "Ancien", { accountEnabled: false })];

test("écran réservé : administrateur général ou d'applications", () => {
  assert.equal(X.peutGerer(["62e90394-69f5-4237-9190-012177145e10"]), true);
  assert.equal(X.peutGerer(["158C047A-C907-4556-B7EF-446551A6B5F7"]), true, "casse ignorée");
  assert.equal(X.peutGerer(["9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3"]), true);
  assert.equal(X.peutGerer(["b0f54661-2d74-4c50-afa3-1ec803f12efe"]), false, "facturation : non");
  assert.equal(X.peutGerer([]), false);
  assert.deepEqual(X.SCOPES_ECRIRE, ["AppRoleAssignment.ReadWrite.All", "Application.ReadWrite.All"]);
});

test("état : cases cochées = affectations, vous et les admins généraux verrouillés et en tête", () => {
  const aff = [{ id: "a3", principalId: "u3", principalType: "User", appRoleId: X.ROLE_DEFAUT }, { id: "g1", principalId: "grp", principalType: "Group", principalDisplayName: "Accueil" }];
  const e = X.etat({ id: "sp1", appRoleAssignmentRequired: false }, aff, UTIL, ["u2"], "u1");
  assert.equal(e.restreint, false);
  assert.deepEqual(e.lignes.map((l) => l.id), ["u2", "u1", "u4", "u3"], "invités et comptes bloqués exclus ; verrouillés d'abord");
  assert.deepEqual(e.lignes.map((l) => [l.coche, l.verrouille]), [[false, true], [false, true], [false, false], [true, false]]);
  assert.equal(e.lignes.find((l) => l.id === "u3").affectationId, "a3");
  assert.deepEqual(e.groupes, [{ id: "grp", nom: "Accueil", affectationId: "g1" }]);
  assert.deepEqual(X.aAffecterAvantRestriction(e), ["u2", "u1"], "garde-fou : vous + admins affectés avant de restreindre");
  assert.match(X.resume(e), /Tout le monde/);
});

test("garde-fous et corps Graph", () => {
  const e = X.etat({ id: "sp1", appRoleAssignmentRequired: true }, [{ id: "a1", principalId: "u1", principalType: "User" }], UTIL, ["u2"], "u1");
  assert.match(X.refusDecocher(e.lignes.find((l) => l.id === "u1")), /vous-même/);
  assert.match(X.refusDecocher(e.lignes.find((l) => l.id === "u2")), /administrateurs généraux/);
  assert.equal(X.refusDecocher(e.lignes.find((l) => l.id === "u4")), "");
  assert.deepEqual(X.corpsAffectation("sp1", "u4"), { principalId: "u4", resourceId: "sp1", appRoleId: "00000000-0000-0000-0000-000000000000" });
  assert.equal(X.resume(e), "Seules les personnes cochées peuvent se connecter (1 personne).");
});

test("prestataire informatique : affiché en clair, coché par défaut, retirable", () => {
  const util = UTIL.concat([U("dam", "Damien Belfort", { mail: null, userPrincipalName: "damien@breteuil02.onmicrosoft.com" })]);
  const e = X.etat({ id: "sp1", appRoleAssignmentRequired: false }, [], util, ["u2"], "u1", ["DAMIEN@breteuil02.onmicrosoft.com"]);
  const d = e.lignes.find((l) => l.id === "dam");
  assert.deepEqual([d.prestataire, d.verrouille, d.raison], [true, false, "Prestataire informatique"]);
  assert.deepEqual(e.lignes.slice(0, 3).map((l) => l.id), ["u2", "u1", "dam"], "juste après les verrouillés");
  assert.equal(X.afficheeCochee(e, d), true, "coché par défaut");
  assert.deepEqual(X.aAffecterAvantRestriction(e), ["u2", "u1", "dam"]);
  assert.deepEqual(X.aAffecterAvantRestriction(e, { sansPrestataire: true }), ["u2", "u1"], "retiré : pas réaffecté");
  assert.equal(X.afficheeCochee(e, d, { sansPrestataire: true }), false);
  assert.equal(X.refusDecocher(d), "", "François peut le retirer (avec confirmation à l'écran)");
  const r = X.etat({ id: "sp1", appRoleAssignmentRequired: true }, [], util, ["u2"], "u1", ["damien@breteuil02.onmicrosoft.com"]);
  assert.equal(X.afficheeCochee(r, r.lignes.find((l) => l.id === "dam")), false, "restreint et pas affecté : décoché (vrai état)");
});

test("prestataire aussi administrateur général : toujours affiché comme prestataire, retirable", () => {
  const util = UTIL.concat([U("dam", "Damien", { mail: "damien@exemple.onmicrosoft.com" })]);
  const e = X.etat({ id: "sp1", appRoleAssignmentRequired: false }, [], util, ["u2", "dam"], "u1", ["damien@exemple.onmicrosoft.com"]);
  const d = e.lignes.find((l) => l.id === "dam");
  assert.deepEqual([d.prestataire, d.verrouille], [true, false]);
});

test("invitation : mail HTML échappé aux couleurs du Château, texte de secours, repli mailto", () => {
  const m = X.invitation({ destinataire: { nom: "Zoé <b>Test</b>", mail: "zoe@chateau-exemple.fr" }, expediteur: { nom: "François Exemple" },
    adresse: "https://espace-breteuil.pages.dev/#/acces-appli", rassurant: "📱 Ne prend quasiment pas de place.", couleurs: { entete: "#1C4829", primaire: "#3F6B4A", surPrimaire: "#FFFFFF", fond: "#FEF6E8", texte: "javascript:alert(1)" } });
  assert.equal(m.sujet, "François vous a ouvert l'accès à l'Espace Breteuil");
  assert.match(m.html, /Bonjour Zoé,/); assert.doesNotMatch(m.html, /<b>Test/);
  assert.match(m.html, /background:#1C4829/); assert.match(m.html, /background:#3F6B4A;color:#FFFFFF/);
  assert.doesNotMatch(m.html, /javascript:/, "couleur invalide remplacée");
  assert.match(m.html, /href="https:\/\/espace-breteuil\.pages\.dev\/"/); assert.match(m.html, /href="https:\/\/espace-breteuil\.pages\.dev\/#\/installer"/);
  assert.match(m.html, /Connectez-vous avec votre adresse du Château/); assert.match(m.html, /Ne prend quasiment pas de place/);
  assert.match(m.texte, /^Bonjour Zoé,\n\nFrançois vous a ouvert l'accès à l'Espace Breteuil\.\n\nOuvrir l'application : https:\/\/espace-breteuil\.pages\.dev\/\nL'installer sur mon téléphone ou ordinateur : https:\/\/espace-breteuil\.pages\.dev\/#\/installer/);
  assert.ok(m.mailto.startsWith("mailto:zoe%40chateau-exemple.fr?subject=Fran%C3%A7ois%20vous"));
  assert.match(decodeURIComponent(m.mailto.split("&body=")[1]), /Connectez-vous avec votre adresse du Château/);
  assert.deepEqual(m.corpsGraph.message.toRecipients, [{ emailAddress: { address: "zoe@chateau-exemple.fr", name: "Zoé <b>Test</b>" } }]);
  assert.equal(m.corpsGraph.message.body.contentType, "HTML");
  assert.equal(X.invitation({ destinataire: { mail: "a@b.fr" }, adresse: "http://evil" }).liens.ouvrir, "https://espace-breteuil.pages.dev/", "adresse non https : celle par défaut");
});
