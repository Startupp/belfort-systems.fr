// Tests de « Pilotage » (sans navigateur) : node --test espace-breteuil/tests/pilotage.test.mjs
// Données FICTIVES uniquement (tests/pilotage-exemple.json) : le dépôt est public.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const P = require("../pilotage.js");
const lire = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const EXEMPLE = JSON.parse(lire("tests/pilotage-exemple.json"));
const FICHIERS = [
  { name: "guide-demarrage.pdf", webUrl: "https://exemple.sharepoint.com/g1.pdf", size: 245760, lastModifiedDateTime: "2026-05-05T09:00:00Z" },
  { name: "Memo Messagerie.pdf", webUrl: "https://exemple.sharepoint.com/g2.pdf", size: 1300000 },
  { name: "Plan de bascule.pdf", webUrl: "https://exemple.sharepoint.com/g3.pdf", size: 52000 },
  { name: "Notes internes.pdf", webUrl: "https://exemple.sharepoint.com/g4.pdf", size: 1000 },
  { name: "Piège.pdf", webUrl: "javascript:alert(1)" },
];

test("validation : schéma attendu, entrées invalides ignorées une à une", () => {
  const r = P.valider(EXEMPLE);
  assert.equal(r.ok, true);
  assert.equal(r.donnees.historique.length, 5, "la date impossible (30 février) est ignorée");
  assert.equal(r.ignores, 1);
  assert.deepEqual(r.donnees.prestataire, { nom: "Jean Exemple — Atelier Fictif", telephone: "01 23 45 67 89", mail: "jean@exemple.test" });
  assert.equal(r.donnees.miseEnPlace.length, 3);
  assert.equal(r.donnees.guides.length, 4);
  assert.equal(r.donnees.misAJour, "2026-10-12");
});

test("validation : types et longueurs maximales", () => {
  assert.equal(P.valider(null).ok, false);
  assert.equal(P.valider([]).ok, false);
  assert.equal(P.valider("{ pas du json").ok, false);
  assert.equal(P.valider("{}").ok, true, "objet vide : écran vide mais pas d'erreur");
  const long = "x".repeat(10000);
  const r = P.valider({
    prestataire: { nom: 42, telephone: "appelez-moi", mail: "pas-une-adresse" },
    historique: [{ date: "2026-01-01", titre: long, resume: long, documents: ["../secret.pdf", "a/b.pdf", 3, "ok.pdf"] }, { date: "2026-01-02" }, "texte"],
    miseEnPlace: [{ titre: "T", points: ["un", "", 5] }, { points: ["sans titre"] }],
    guides: [{ fichier: "a.pdf", pour: "tout le monde" }, { fichier: "A.PDF", pour: "tous" }, { fichier: "" }],
  });
  const d = r.donnees;
  assert.deepEqual(d.prestataire, { nom: "", telephone: "", mail: "" });
  assert.equal(d.historique.length, 1);
  assert.ok(d.historique[0].titre.length <= P.MAX.titre && d.historique[0].resume.length <= P.MAX.resume);
  assert.deepEqual(d.historique[0].documents, ["ok.pdf"], "pas de chemin, pas de « .. »");
  assert.deepEqual(d.miseEnPlace, [{ titre: "T", points: ["un"] }]);
  assert.deepEqual(d.guides, [{ fichier: "a.pdf", titre: "", pour: "gestion" }], "« pour » inconnu → gestion ; doublon (casse) ignoré");
  assert.ok(r.ignores >= 9);
  const trop = P.valider({ historique: Array.from({ length: 600 }, () => ({ date: "2026-01-01", titre: "t" })) });
  assert.equal(trop.donnees.historique.length, P.MAX.historique);
});

test("date en toutes lettres", () => {
  assert.equal(P.dateLongue("2026-09-15"), "15 septembre 2026");
  assert.equal(P.dateLongue("2026-08-01"), "1er août 2026");
  assert.equal(P.dateLongue("2026-02-30"), "");
  assert.equal(P.dateLongue("15/09/2026"), "");
});

test("tri : du plus récent au plus ancien, même jour → le dernier écrit d'abord", () => {
  const h = P.valider(EXEMPLE).donnees.historique;
  assert.deepEqual(h.map((e) => e.date), ["2026-06-01", "2026-05-05", "2026-05-05", "2026-04-20", "2026-03-02"]);
  assert.equal(h[1].titre, "Bascule de la messagerie");
});

test("correspondance document → fichier : sans casse ni accents, https seulement", () => {
  assert.equal(P.trouverFichier("guide-demarrage.PDF", FICHIERS).webUrl, "https://exemple.sharepoint.com/g1.pdf");
  assert.equal(P.trouverFichier("Mémo  Messagerie.pdf", FICHIERS).name, "Memo Messagerie.pdf");
  assert.equal(P.trouverFichier("MEMO MESSAGERIE", FICHIERS).name, "Memo Messagerie.pdf", "sans extension");
  assert.equal(P.trouverFichier("Devis matériel.pdf", FICHIERS), null);
  assert.equal(P.trouverFichier("Piege.pdf", FICHIERS), null, "adresse non https refusée");
  const d = P.valider(EXEMPLE).donnees;
  const docs = P.documentsDe(d.historique.find((e) => e.titre === "Guides de démarrage"), d, FICHIERS);
  assert.deepEqual(docs.map((x) => [x.titre, !!x.url]), [["Guide de démarrage", true], ["Mémo messagerie (1 page)", true]]);
  const devis = P.documentsDe(d.historique[0], d, FICHIERS);
  assert.deepEqual(devis, [{ nom: "Devis matériel.pdf", titre: "Devis postes et sauvegarde", url: "" }], "absent → « document à venir »");
});

test("filtrage : « tous » pour Moi → Guides, tout (et les PDF non décrits) dans Pilotage", () => {
  const d = P.valider(EXEMPLE).donnees;
  const tous = P.guidesPour(d, FICHIERS, "tous");
  assert.deepEqual(tous.map((g) => g.titre), ["Guide de démarrage", "Mémo messagerie (1 page)"]);
  assert.ok(tous.every((g) => g.pour === "tous" && g.url));
  const gestion = P.guidesPour(d, FICHIERS, "gestion");
  assert.deepEqual(gestion.map((g) => [g.titre, !!g.url]), [["Guide de démarrage", true], ["Mémo messagerie (1 page)", true],
    ["Plan de bascule et coûts", true], ["Devis postes et sauvegarde", false], ["Notes internes.pdf", true]]);
});

test("petits outils : taille, lien tel:", () => {
  assert.equal(P.taille(245760), "240 Ko");
  assert.equal(P.taille(1300000), "1,2 Mo");
  assert.equal(P.taille(0), "");
  assert.equal(P.lienTel("01 23 45 67 89"), "tel:+33123456789");
  assert.equal(P.lienTel("+33 1 23 45 67 89"), "tel:+33123456789");
});

test("dépôt public : aucune donnée client dans le code ni dans l'exemple", () => {
  const code = lire("pilotage.js") + lire("pilotage-ecrans.js") + lire("tests/pilotage-exemple.json");
  assert.doesNotMatch(code, /breteuil\.fr|ch[aâ]teau de breteuil|o2switch|D-2026-001|06 09 89 74 43|gmail/i);
  assert.doesNotMatch(lire("pilotage-ecrans.js"), /innerHTML|insertAdjacentHTML|outerHTML/, "tout est inséré en texte");
});
