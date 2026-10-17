// Tests de la logique de démonstration : node --test espace-breteuil/tests/demo.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const D = require("../demo.js");
const B = D.base("2026-10-17");

test("coût mensuel des licences de départ = facture fictive (97,40 € HT)", () => {
  assert.equal(D.coutMensuel(B.achetees), 97.4);
  assert.ok(B.factures.every((f) => f.montant === 97.4));
  assert.deepEqual(B.factures.map((f) => f.date), ["2026-10-05", "2026-09-05", "2026-08-05"]);
  assert.equal(D.euros(1234.5), "1 234,50 €");
});

test("licences attribuées ≤ achetées dans la démo", () => {
  const n = D.attribuees(B.collaborateurs);
  for (const f of D.ORDRE_FORMULES) assert.ok(n[f] <= B.achetees[f], f);
});

test("simulateur : achat et retrait, refus sous le nombre attribué", () => {
  const plus = D.simuler(B.achetees, B.collaborateurs, "complete", 2);
  assert.equal(plus.difference, 23.4);
  assert.equal(plus.parAn, 280.8);
  assert.ok(plus.possible);
  const moins = D.simuler(B.achetees, B.collaborateurs, "complete", -3);
  assert.equal(moins.possible, false); // 6 Complète attribuées
  assert.equal(D.simuler(B.achetees, B.collaborateurs, "express", -10).achetees.express, 0);
});

test("organigramme : arbre et refus des boucles", () => {
  const racines = D.arbre(B.collaborateurs).map((n) => n.c.id);
  assert.deepEqual(racines, ["francois", "pauline"]);
  assert.equal(D.peutEtreResponsable(B.collaborateurs, "joao", "marco"), false); // Marco dépend de Joao
  assert.equal(D.peutEtreResponsable(B.collaborateurs, "francois", "joao"), false);
  assert.equal(D.peutEtreResponsable(B.collaborateurs, "marco", "yara"), true);
  assert.equal(D.peutEtreResponsable(B.collaborateurs, "marco", "marco"), false);
});

test("absences : qui est absent tel jour", () => {
  assert.equal(D.absenceDu(B.absences, "guillaumette", "2026-10-20").type, "conge");
  assert.equal(D.absenceDu(B.absences, "guillaumette", "2026-10-17"), null);
});

test("mot de passe provisoire : forme lisible", () => {
  let i = 0;
  const pw = D.motDePasseProvisoire(() => [0.1, 0.5, 0.9, 0.3][i++ % 4]);
  assert.match(pw, /^[A-Z][a-z]+-[A-Z][a-z]+-[A-Z][a-z]+-\d{2}$/);
});
