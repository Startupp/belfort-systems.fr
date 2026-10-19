// Tests du glisser-déposer (sans navigateur) : node --test espace-breteuil/tests/depot.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const D = require("../depot.js");
const CTX = { nomCommun: "Commun", suiviPermis: true };

test("dossier cible selon la route", () => {
  assert.deepEqual(D.cible(["onedrive"], CTX), { espace: "moi", segs: [], nom: "Mes documents", lisible: "Mes documents" });
  assert.deepEqual(D.cible(["onedrive", "Notes", "2026"], CTX), { espace: "moi", segs: ["Notes", "2026"], nom: "2026", lisible: "Mes documents › Notes › 2026" });
  assert.deepEqual(D.cible(["commun"], CTX), { espace: "commun", segs: ["Commun"], nom: "Documents de l'équipe", lisible: "Documents de l'équipe" });
  assert.deepEqual(D.cible(["commun", "Commun", "Finance", "2026"], CTX), { espace: "commun", segs: ["Commun", "Finance", "2026"], nom: "2026", lisible: "Documents de l'équipe › Finance › 2026" });
  assert.deepEqual(D.cible(["commun", "Commun%20x", "Re%C3%A7us"], CTX).segs, ["Commun x", "Reçus"], "segments décodés");
  assert.deepEqual(D.cible(["commun", "~racine"], CTX), { espace: "commun", segs: [], nom: "Tout en haut", lisible: "Tout en haut" });
  assert.equal(D.cible(["commun", "Archives"], CTX).lisible, "Tout en haut › Archives");
  assert.deepEqual(D.cible(["suivi"], CTX).segs, ["Commun", "Suivi informatique", "Guides"]);
  assert.equal(D.cible(["moi", "guides"], CTX).lisible, "Documents de l'équipe › Suivi informatique › Guides");
  assert.equal(D.cible(["moi", "guides"], { nomCommun: "Commun", suiviPermis: false }).espace, null, "Guides sans droit d'écrire");
  assert.deepEqual(D.cible(["planning"], CTX), { espace: null, proposerMoi: false });
  assert.deepEqual(D.cible(["moi"], CTX), { espace: null, proposerMoi: false });
  assert.deepEqual(D.cible(["fichiers"], CTX), { espace: null, proposerMoi: true });
  assert.deepEqual(D.cible([], CTX), { espace: null, proposerMoi: false });
});

test("nettoyage des noms interdits par OneDrive", () => {
  assert.equal(D.nettoyerNom('Devis: "été"*2026?.pdf'), "Devis- -été--2026-.pdf");
  assert.equal(D.nettoyerNom("a/b\\c|d<e>f.txt"), "a-b-c-d-e-f.txt");
  assert.equal(D.nettoyerNom("Rapport final. "), "Rapport final");
  assert.equal(D.nettoyerNom("   "), "fichier");
  assert.equal(D.nettoyerNom("Menu de Noël.docx"), "Menu de Noël.docx");
});

test("conflits de noms : détection et « Garder les deux »", () => {
  const ex = ["Facture.pdf", "facture (2).pdf", "Notes"];
  assert.deepEqual(D.conflits(["FACTURE.pdf", "Nouveau.pdf"], ex), ["FACTURE.pdf"], "sans tenir compte des majuscules");
  assert.equal(D.nomLibre("Facture.pdf", ex), "Facture (3).pdf");
  assert.equal(D.nomLibre("Nouveau.pdf", ex), "Nouveau.pdf");
  assert.equal(D.nomLibre("Notes", ex), "Notes (2)");
  assert.equal(D.nomLibre(".env", [".env"]), ".env (2)");
});

test("tri : dossiers refusés, 250 Mo maximum par fichier", () => {
  const r = D.trier([{ nom: "a.pdf", taille: 10 }, { nom: "Photos", dossier: true }, { nom: "film.mp4", taille: 250 * 1024 * 1024 + 1 }, { nom: "pile.zip", taille: 250 * 1024 * 1024 }]);
  assert.deepEqual(r.fichiers.map((x) => x.nom), ["a.pdf", "pile.zip"]);
  assert.deepEqual(r.dossiers.map((x) => x.nom), ["Photos"]);
  assert.deepEqual(r.tropGros.map((x) => x.nom), ["film.mp4"]);
});

test("chemin Graph et message de succès", () => {
  assert.equal(D.cheminGraph("drive1", ["Commun", "Finance"], "Reçu #1.pdf"), "/drives/drive1/root:/Commun/Finance/Re%C3%A7u%20%231.pdf");
  assert.equal(D.messageSucces(3, "Finance"), "3 fichiers envoyés dans Finance");
  assert.equal(D.messageSucces(1, "Finance"), "1 fichier envoyé dans Finance");
});
