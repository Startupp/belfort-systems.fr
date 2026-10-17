// Tests de « Aujourd'hui au Château » : node --test espace-breteuil/tests/resume.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const R = require("../resume.js");
const P = [
  { id: "valerie-d", prenom: "Valérie D." }, { id: "valerie-l", prenom: "Valérie L." },
  { id: "yara", prenom: "Yara" }, { id: "marco", prenom: "Marco" }, { id: "fanny", prenom: "Fanny" },
];

test("type d'après le titre, sans accents ni majuscules", () => {
  assert.equal(R.typeDe("Marco ABSENT"), "absent");
  assert.equal(R.typeDe("Yara en congé"), "conge");
  assert.equal(R.typeDe("Valérie D. — Télétravail"), "teletravail");
  assert.equal(R.typeDe("Valérie D. TT"), "teletravail");
  assert.equal(R.typeDe("Fanny : permanence accueil"), "present");
  assert.equal(R.typeDe("Visite de groupe scolaire"), null);
  assert.equal(R.typeDe("Rattrapage"), null, "« tt » seulement comme mot entier");
});

test("personnes citées : prénom + initiale, prénom seul s'il est unique", () => {
  assert.deepEqual(R.personnesCitees("Valérie D. télétravail", P).map((p) => p.id), ["valerie-d"]);
  assert.deepEqual(R.personnesCitees("Valerie L absente", P).map((p) => p.id), ["valerie-l"]);
  assert.deepEqual(R.personnesCitees("Valérie absente", P), [], "ambigu : personne");
  assert.deepEqual(R.personnesCitees("Congé Yara et Marco", P).map((p) => p.id), ["yara", "marco"]);
  assert.deepEqual(R.personnesCitees("Marcotte", P), []);
});

test("résumé du jour : absents, congés, télétravail, rendez-vous, infos", () => {
  const o = (titre, journee, debut = 0) => ({ titre, journee, debut, fin: debut + 1 });
  const r = R.resumer([
    o("Marco absent", true), o("Yara congé", true), o("Valérie D. télétravail", true),
    o("Visite de groupe", false, 14), o("Livraison fleurs", false, 9), o("Vacances scolaires", true),
    o("Marco absent (rappel)", true),
  ], P);
  assert.deepEqual(r.absents.map((x) => x.personne.id), ["marco"]);
  assert.deepEqual(r.conges.map((x) => x.personne.id), ["yara"]);
  assert.deepEqual(r.teletravail.map((x) => x.personne.id), ["valerie-d"]);
  assert.deepEqual(r.rendezVous.map((x) => x.titre), ["Livraison fleurs", "Visite de groupe"]);
  assert.deepEqual(r.infos.map((x) => x.titre), ["Vacances scolaires"]);
});
