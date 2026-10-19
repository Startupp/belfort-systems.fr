// v5.5 « Ce que j'utilise » (questionnaire) et « Comment faire ? » : node --test espace-breteuil/tests/usages.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const P = require("../profil.js");
const U = require("../usages.js");
const R = P.ROLES;
const ids = (l) => l.map((u) => u.id);
const lecteur = P.deduire({ roles: [], editer: false });
const gestionnaire = P.deduire({ roles: [], proprietaire: true, gererDroits: true, editer: true });
const facturation = P.deduire({ roles: [R.facturation.id], editer: true });
const siteweb = P.deduire({ roles: [], siteWeb: true, editer: true });
const admin = P.deduire({ roles: [R.admin.id], gererDroits: true, editer: true });

test("questionnaire : seulement ce à quoi la personne a accès", () => {
  assert.deepEqual(ids(U.possibles(lecteur)), ["planning", "equipe", "perso"]);
  assert.deepEqual(ids(U.possibles(lecteur, { onedrive: false })), ["planning", "equipe"], "sans OneDrive : pas de documents personnels");
  assert.deepEqual(ids(U.possibles(gestionnaire)), ["planning", "equipe", "perso", "acces", "suivi"]);
  assert.deepEqual(ids(U.possibles(facturation)), ["planning", "equipe", "perso", "factures", "suivi"]);
  assert.deepEqual(ids(U.possibles(siteweb)), ["planning", "equipe", "perso", "site"], "groupe Site web : pas de suivi informatique");
  assert.deepEqual(ids(U.possibles(admin)), ["planning", "equipe", "perso", "acces", "site", "factures", "suivi"]);
  assert.deepEqual(ids(U.possibles(null)), ["planning", "equipe", "perso"], "droits pas encore connus : rien de réservé");
  assert.deepEqual(ids(U.possibles(gestionnaire, { commun: false })), ["planning", "perso", "suivi"], "dossier commun introuvable");
});

test("questionnaire : ordre de l'accueil = ordre des choix, puis le reste", () => {
  const l = U.possibles(gestionnaire);
  const o = U.ordonner(["acces", "planning"], l);
  assert.deepEqual(ids(o.choisis), ["acces", "planning"]);
  assert.deepEqual(ids(o.autres), ["equipe", "perso", "suivi"]);
  // Choix devenu interdit (droit retiré), doublon, valeur inconnue : ignorés.
  const o2 = U.ordonner(["factures", "perso", "perso", "xxx"], l);
  assert.deepEqual(ids(o2.choisis), ["perso"]);
  assert.equal(o2.autres.length, 4);
  assert.deepEqual(ids(U.ordonner(null, l).choisis), [], "jamais répondu");
});

test("onglet ouvert après la connexion : le 1er choix permis", () => {
  assert.equal(U.depart(["equipe", "planning"], lecteur), "#/commun");
  assert.equal(U.depart(["acces"], gestionnaire, {}, "Commun"), "#/acces/Commun");
  assert.equal(U.depart(["acces", "planning"], lecteur), "#/planning", "choix interdit sauté");
  assert.equal(U.depart([], lecteur), "#/accueil");
  assert.equal(U.depart(["factures"], facturation), "#/finance");
  assert.equal(U.depart(["factures"], admin), "#/gerer");
  assert.equal(U.depart(["site"], siteweb), "#/site");
  assert.equal(U.depart(["suivi"], gestionnaire), "#/suivi");
});

test("stockage : clé par compte, valeur lue prudemment", () => {
  assert.equal(U.cle({ homeAccountId: "abc", username: "x@y" }), "eb:usages:abc");
  assert.equal(U.cle({ username: "x@y" }), "eb:usages:x@y");
  assert.equal(U.cle(null), "eb:usages:?");
  assert.equal(U.lireChoix(null), null);
  assert.equal(U.lireChoix({ choix: "planning" }), null);
  assert.deepEqual(U.lireChoix({ choix: ["planning", 3, "equipe"] }), ["planning", "equipe"]);
  assert.deepEqual(U.lireChoix({ choix: [] }), [], "« aucun » est une réponse");
});

test("Comment faire ? : tâches filtrées selon le niveau", () => {
  const t = (r, ctx) => ids(U.taches(r, ctx));
  assert.ok(!t(lecteur, { editer: false }).includes("ranger"), "lecteur : pas de « Ranger un document de l'équipe »");
  assert.ok(!t(lecteur, { editer: false }).includes("prive"));
  assert.ok(t(lecteur, { editer: false }).includes("aide") && t(lecteur, { editer: false }).includes("retrouver"));
  assert.ok(t(gestionnaire).includes("prive") && t(gestionnaire).includes("ranger") && t(gestionnaire).includes("suivi"));
  assert.ok(t(siteweb).includes("site") && !t(siteweb).includes("suivi"));
  for (const x of U.TACHES) {
    assert.ok(x.phrase.split(/[.!?](\s|$)/).filter((s) => s && s.trim()).length <= 2, x.id + " : 2 phrases au plus");
    assert.ok(x.cible, x.id + " : un bouton à montrer");
  }
  assert.equal(U.routeTache(U.TACHES.find((x) => x.id === "suivi"), facturation), "#/finance");
});
