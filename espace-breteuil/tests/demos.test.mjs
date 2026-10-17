// Tests des écrans de démo (rôles, arrivées, départs, absences, finance, double authentification).
// node --test espace-breteuil/tests/demos.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const D = require("../demos/donnees.js");
const nouvelle = () => D.base("2026-10-17");

test("12 licences : 6 Complète + 6 Express + Teams, coût mensuel cohérent avec les factures", () => {
  const B = nouvelle();
  assert.deepEqual(B.licences, { standard: 6, basic: 6 });
  assert.equal(D.coutMensuel(B.licences), 103.8);
  assert.ok(B.factures.length >= 5);
  assert.ok(B.factures.every((f) => f.ht === 103.8 && f.ttc === 124.56 && f.date <= "2026-10-17"));
  assert.equal(D.euros(1245.6), "1 245,60 €");
});

test("licences utilisées ≤ achetées ; une Express + Teams libre au départ", () => {
  const B = nouvelle();
  const u = D.utilisees(B.personnes);
  assert.deepEqual(u, { standard: 6, basic: 5 });
  assert.equal(D.libres(B, "basic"), 1);
  assert.equal(D.libres(B, "standard"), 0);
});

test("simulateur : impact mensuel et annuel, refus sous le nombre attribué", () => {
  const B = nouvelle();
  const plus = D.simuler(B.licences, B.personnes, "standard", 2);
  assert.equal(plus.difference, 23.4);
  assert.equal(plus.parAn, 280.8);
  assert.equal(plus.annuelApres, D.arrondi((103.8 + 23.4) * 12));
  assert.ok(plus.possible);
  assert.equal(D.simuler(B.licences, B.personnes, "basic", -1).possible, true);
  assert.equal(D.simuler(B.licences, B.personnes, "basic", -2).possible, false);
  assert.equal(D.simuler(B.licences, B.personnes, "standard", -20).licences.standard, 0);
});

test("rôles : au moins un administrateur, avertissement au-delà de deux", () => {
  const B = nouvelle();
  assert.match(D.refusRetrait(B, "admin"), /au moins un/);
  D.donnerRole(B, "admin", null, "pauline");
  assert.equal(D.refusRetrait(B, "admin"), null);
  assert.match(D.avertissementAjout(B, "admin"), /deux au plus/);
  D.retirerRole(B, "admin", null, "francois");
  assert.deepEqual(D.titulaires(B, "admin"), ["pauline"]);
  D.donnerRole(B, "boite", "hfb", "yara");
  assert.ok(D.titulaires(B, "boite", "hfb").includes("yara"));
  D.donnerRole(B, "pole", "Accueil", "valerie-l");
  assert.deepEqual(D.titulaires(B, "pole", "Accueil"), ["fanny", "valerie-l"]);
});

test("arrivée : adresse unique, licence libre utilisée d'abord, puis achat", () => {
  const B = nouvelle();
  assert.equal(D.adresseProposee(B, "Fanny"), "fanny2@breteuil.fr");
  assert.equal(D.adresseProposee(B, "Hélène"), "helene@breteuil.fr");
  assert.equal(D.coutArrivee(B, "basic"), 0);
  const r1 = D.enregistrerArrivee(B, { prenom: "Hélène", pole: "Accueil", licence: "basic", boites: ["contact"] });
  assert.equal(r1.achat, false);
  assert.equal(B.licences.basic, 6);
  assert.equal(D.coutArrivee(B, "basic"), 5.6);
  const r2 = D.enregistrerArrivee(B, { prenom: "Paul", pole: "Jardins", licence: "basic", boites: [] });
  assert.equal(r2.achat, true);
  assert.equal(B.licences.basic, 7);
  assert.equal(D.boite(B, "contact").acces[r1.id], "ouvrir");
  assert.deepEqual(D.accesParPole("Restauration"), { boites: ["restauration"], dossiers: ["Restauration", "Événements"] });
});

test("départ : compte bloqué, boîte transmise, licence libérée ou rendue", () => {
  const B = nouvelle();
  assert.equal(D.responsableDe(B, "Jardins", "marco"), "joao");
  assert.equal(D.responsableDe(B, "Jardins", "joao"), "francois");
  const r = D.enregistrerDepart(B, "marco", { bloquer: true, transmettreA: "joao", libererLicence: true, rendreLicence: true });
  assert.equal(r.economie, 5.6);
  assert.equal(B.licences.basic, 5);
  const m = D.personne(B, "marco");
  assert.ok(m.parti && m.bloque && m.licence === null);
  assert.equal(B.delegations.marco.joao, "ouvrir");
  assert.equal(D.boite(B, "jardins").acces.marco, undefined);
  // Le dernier administrateur n'est jamais retiré automatiquement.
  D.enregistrerDepart(B, "francois", { bloquer: true });
  assert.deepEqual(B.roles.admin, ["francois"]);
});

test("absences : jour couvert, durée, saisie invalide refusée", () => {
  const B = nouvelle();
  const a = D.ajouterAbsence(B, { personne: "erwin", type: "conge", du: "2026-10-20", au: "2026-10-22" });
  assert.equal(D.nbJours(a), 3);
  assert.equal(D.absenceDu(B.absences, "erwin", "2026-10-21").type, "conge");
  assert.equal(D.absenceDu(B.absences, "erwin", "2026-10-23"), null);
  assert.equal(D.ajouterAbsence(B, { personne: "erwin", type: "maladie", du: "2026-10-20" }), null);
  assert.equal(D.ajouterAbsence(B, { personne: "erwin", type: "absence", du: "2026-10-25", au: "2026-10-01" }).au, "2026-10-25");
  assert.deepEqual(D.semaine("2026-10-17"), ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
});

test("double authentification : désactivée par défaut, 4 personnes sur 11 protégées", () => {
  const B = nouvelle();
  assert.equal(B.mfa.activee, false);
  assert.deepEqual(D.statsMfa(B), { protegees: 4, total: 11, pourcent: 36 });
});

test("exemple de facture PDF : en-tête, mention EXEMPLE, table xref valide", () => {
  const B = nouvelle();
  const pdf = D.pdfFacture(B.factures[0], B.licences);
  const txt = Buffer.from(pdf).toString("latin1");
  assert.ok(txt.startsWith("%PDF-1.4"));
  assert.ok(txt.includes("EXEMPLE - DOCUMENT FICTIF"));
  assert.ok(txt.trimEnd().endsWith("%%EOF"));
  const xref = +txt.match(/startxref\n(\d+)/)[1];
  assert.equal(txt.slice(xref, xref + 4), "xref");
  const offsets = [...txt.matchAll(/(\d{10}) 00000 n/g)].map((m) => +m[1]);
  offsets.forEach((o, i) => assert.equal(txt.slice(o, o + String(i + 1).length + 6), `${i + 1} 0 obj`));
});

test("boîtes partagées : les 8 boîtes demandées, toutes avec au moins une personne", () => {
  const B = nouvelle();
  assert.deepEqual(B.boites.map((b) => b.id), ["contact", "finance", "restauration", "marketing", "jardins", "intendance", "hfb", "chanteclerc"]);
  assert.ok(B.boites.every((b) => Object.keys(b.acces).length > 0 && b.photo === null));
});
