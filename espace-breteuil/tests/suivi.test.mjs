// Tests de « Suivi informatique » (sans navigateur) : node --test espace-breteuil/tests/suivi.test.mjs
// Données FICTIVES uniquement (tests/suivi-exemple.json) : le dépôt est public.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const P = require("../suivi.js");
const lire = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const EXEMPLE = JSON.parse(lire("tests/suivi-exemple.json"));
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
  assert.equal(r.donnees.projets.length, 3);
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

test("filtrage : « tous » pour Moi → Guides, tout (et les PDF non décrits) dans Suivi informatique", () => {
  const d = P.valider(EXEMPLE).donnees;
  const tous = P.guidesPour(d, FICHIERS, "tous");
  assert.deepEqual(tous.map((g) => g.titre), ["Guide de démarrage", "Mémo messagerie (1 page)"]);
  assert.ok(tous.every((g) => g.pour === "tous" && g.url));
  const gestion = P.guidesPour(d, FICHIERS, "gestion");
  assert.deepEqual(gestion.map((g) => [g.titre, !!g.url]), [["Guide de démarrage", true], ["Mémo messagerie (1 page)", true],
    ["Plan de bascule et coûts", true], ["Devis postes et sauvegarde", false], ["Notes internes", true]]);
  assert.equal(gestion[4].pour, "gestion", "non décrit sans numéro → gestion");
});

// Guides numérotés « NN - Titre.pdf » : renommables tant que le numéro reste devant.
const NUM = {
  guides: [
    { fichier: "02 - Premiers pas.pdf", titre: "Premiers pas", pour: "tous" },
    { fichier: "04 - Mes mails sur téléphone (avec Outlook).pdf", titre: "Mes mails sur téléphone", pour: "tous" },
    { fichier: "12 - Sauvegardes.pdf", titre: "Sauvegardes", pour: "gestion" },
  ],
  historique: [{ date: "2026-09-01", titre: "Guides", documents: ["04 - Mes mails sur téléphone (avec Outlook).pdf"] }],
};
const u = (n) => "https://exemple.sharepoint.com/" + n;

test("guides numérotés : un PDF renommé (même numéro) reste relié, titre tiré du nom réel", () => {
  const f = [
    { name: "02 - Premiers pas.pdf", webUrl: u("a"), lastModifiedDateTime: "2026-09-01T00:00:00Z" },
    { name: "04 - Mails sur mon iPhone.pdf", webUrl: u("b"), lastModifiedDateTime: "2026-09-02T00:00:00Z" },
    { name: "12 – sauvegardes NAS.pdf", webUrl: u("c") },
  ];
  assert.equal(P.numero("04 - Mails.pdf"), 4);
  assert.equal(P.numero("  7_Truc.pdf"), 7);
  assert.equal(P.numero("2026 rapport.pdf"), null, "plus de 3 chiffres : pas un numéro");
  assert.equal(P.numero("Notes.pdf"), null);
  assert.equal(P.titreDuNom("04 - Mails sur mon iPhone.pdf"), "Mails sur mon iPhone");
  assert.equal(P.trouverFichier("04 - Mes mails sur téléphone (avec Outlook).pdf", f).webUrl, u("b"));
  const tous = P.guidesPour(NUM, f, "tous");
  assert.deepEqual(tous.map((g) => [g.titre, g.url]), [["Premiers pas", u("a")], ["Mails sur mon iPhone", u("b")]]);
  const gestion = P.guidesPour(NUM, f, "gestion");
  assert.deepEqual(gestion.map((g) => g.titre), ["Premiers pas", "Mails sur mon iPhone", "sauvegardes NAS"], "rien en double");
  const docs = P.documentsDe(NUM.historique[0], NUM, f);
  assert.deepEqual(docs.map((d) => [d.titre, d.url]), [["Mails sur mon iPhone", u("b")]], "« Ouvrir » reste actif dans l'historique");
  const sansRenommage = P.guidesPour(NUM, [{ name: "04 - MES MAILS SUR TELEPHONE (avec Outlook).pdf", webUrl: u("b") }], "tous");
  assert.equal(sansRenommage.find((g) => g.url).titre, "Mes mails sur téléphone", "même nom (casse, accents) : titre du suivi");
});

test("guides numérotés : deux fichiers avec le même numéro → le plus récent, signalé en console seulement", () => {
  const f = [
    { name: "04 - Ancien.pdf", webUrl: u("old"), lastModifiedDateTime: "2026-01-01T00:00:00Z" },
    { name: "04 - Nouveau.pdf", webUrl: u("new"), lastModifiedDateTime: "2026-09-01T00:00:00Z" },
  ];
  const avertissements = [], avant = console.warn;
  console.warn = (m) => avertissements.push(String(m));
  try {
    assert.equal(P.trouverFichier("04 - Mes mails sur téléphone (avec Outlook).pdf", f).webUrl, u("new"));
    const gestion = P.guidesPour(NUM, f, "gestion");
    assert.deepEqual(gestion.filter((g) => g.url).map((g) => [g.titre, g.url]), [["Nouveau", u("new")]], "l'ancien n'apparaît pas en plus");
    const nonDecrits = P.guidesPour({ guides: [] }, f, "gestion");
    assert.deepEqual(nonDecrits.map((g) => g.url), [u("new")], "doublon non décrit : le plus récent seulement");
  } finally { console.warn = avant; }
  assert.ok(avertissements.some((m) => /numéro 4/.test(m) && /04 - Ancien\.pdf/.test(m)), "signalé dans la console");
});

test("PDF non décrits : 01–09 → pour tous, 10 et plus ou sans numéro → gestion ; tri par numéro puis nom", () => {
  const f = [
    { name: "Zébus.pdf", webUrl: u("z") },
    { name: "15 - Procédure interne.pdf", webUrl: u("p") },
    { name: "08 - Imprimer depuis son poste.pdf", webUrl: u("i") },
    { name: "03 - B.pdf", webUrl: u("b3") },
    { name: "Archives.pdf", webUrl: u("ar") },
  ];
  const vide = { guides: [] };
  const tous = P.guidesPour(vide, f, "tous");
  assert.deepEqual(tous.map((g) => [g.titre, g.pour]), [["B", "tous"], ["Imprimer depuis son poste", "tous"]], "le nouveau 08 est visible pour tous");
  const gestion = P.guidesPour(vide, f, "gestion");
  assert.deepEqual(gestion.map((g) => [g.titre, g.pour]), [["B", "tous"], ["Imprimer depuis son poste", "tous"],
    ["Procédure interne", "gestion"], ["Archives", "gestion"], ["Zébus", "gestion"]]);
  assert.equal(P.pourDuNumero("09 - x.pdf"), "tous");
  assert.equal(P.pourDuNumero("10 - x.pdf"), "gestion");
  assert.equal(P.pourDuNumero("00 - x.pdf"), "gestion");
  assert.equal(P.pourDuNumero("x.pdf"), "gestion");
});

test("projets à venir : validation, longueurs, statut inconnu → « À confirmer »", () => {
  const d = P.valider(EXEMPLE).donnees;
  assert.equal(d.projets.length, 3);
  assert.equal(P.valider({}).donnees.projets, null, "clé absente → null (section masquée)");
  assert.deepEqual(P.valider({ projets: [] }).donnees.projets, [], "liste vide → section affichée, vide");
  const pasTableau = P.valider({ projets: "texte" });
  assert.equal(pasTableau.donnees.projets, null);
  assert.equal(pasTableau.ignores, 1);
  const long = "x".repeat(10000);
  const r = P.valider({ projets: [
    { titre: long, statut: "Proposition envoyée", resume: long, prochaineEtape: long, documents: ["../secret.pdf", "a/b.pdf", 3, "ok.pdf"] },
    { titre: "", statut: "En cours" }, "texte", { resume: "sans titre" },
    { titre: "Statut absent" }, { titre: "Statut inconnu", statut: "Bientôt" }, { titre: "Pas une chaîne", statut: 42 },
    { titre: "Casse et accents", statut: "en COURS" }, { titre: "Sans accent", statut: "Termine" }, { titre: "Envoyée", statut: "proposition envoyee" },
  ] });
  const l = r.donnees.projets;
  assert.equal(l.length, 7);
  assert.ok(l[0].titre.length <= P.MAX.titre && l[0].resume.length <= P.MAX.resume && l[0].prochaineEtape.length <= P.MAX.point);
  assert.deepEqual(l[0].documents, ["ok.pdf"], "pas de chemin, pas de « .. »");
  assert.ok(r.ignores >= 6, "3 projets + 3 documents ignorés");
  const statuts = Object.fromEntries(l.map((p) => [p.titre, p.statut]));
  assert.equal(statuts["Statut absent"], "À confirmer");
  assert.equal(statuts["Statut inconnu"], "À confirmer");
  assert.equal(statuts["Pas une chaîne"], "À confirmer");
  assert.equal(statuts["Casse et accents"], "En cours");
  assert.equal(statuts["Sans accent"], "Terminé");
  assert.equal(statuts["Envoyée"], "Proposition envoyée");
  assert.equal(l.find((p) => p.titre === "Statut absent").prochaineEtape, "", "prochaine étape facultative");
  assert.deepEqual(l.find((p) => p.titre === "Statut absent").documents, [], "documents facultatifs");
  assert.equal(P.statut("<b>En cours</b>"), "À confirmer");
  const trop = P.valider({ projets: Array.from({ length: 80 }, (_, i) => ({ titre: "p" + i })) });
  assert.equal(trop.donnees.projets.length, P.MAX.projets);
});

test("projets à venir : ordre du fichier, « Terminé » en bas", () => {
  assert.deepEqual(P.valider(EXEMPLE).donnees.projets.map((p) => [p.titre, p.statut]), [
    ["Renouvellement d'un poste", "Proposition envoyée"], ["Sauvegarde sur place", "À confirmer"], ["Archivage des anciens messages", "Terminé"]]);
  const l = P.valider({ projets: [{ titre: "T1", statut: "Terminé" }, { titre: "A", statut: "En cours" }, { titre: "T2", statut: "Terminé" },
    { titre: "B", statut: "À confirmer" }, { titre: "C", statut: "Proposition envoyée" }] }).donnees.projets;
  assert.deepEqual(l.map((p) => p.titre), ["A", "B", "C", "T1", "T2"], "tri stable : les terminés gardent leur ordre");
});

test("projets à venir : documents reliés comme l'historique (numéro en tête, puis nom normalisé)", () => {
  const d = P.valider(EXEMPLE).donnees;
  const docs = P.documentsDe(d.projets[0], d, FICHIERS);
  assert.deepEqual(docs, [{ nom: "Plan de bascule.pdf", titre: "Plan de bascule et coûts", url: "https://exemple.sharepoint.com/g3.pdf" },
    { nom: "Devis matériel.pdf", titre: "Devis postes et sauvegarde", url: "" }], "nom normalisé ; absent → « document à venir »");
  const fichiers = [{ name: "21 - Proposition renommée.pdf", webUrl: "https://exemple.sharepoint.com/p21.pdf" },
    { name: "Mémo Réseau.PDF", webUrl: "https://exemple.sharepoint.com/memo.pdf" }];
  const v = P.valider({ projets: [{ titre: "P", statut: "Proposition envoyée", documents: ["21 - Proposition postes (exemple).pdf", "memo reseau.pdf", "Absent.pdf"] }] }).donnees;
  const r = P.documentsDe(v.projets[0], v, fichiers);
  assert.deepEqual(r.map((x) => x.url), ["https://exemple.sharepoint.com/p21.pdf", "https://exemple.sharepoint.com/memo.pdf", ""], "numéro en tête, puis sans casse ni accents");
  assert.equal(r[0].titre, "Proposition renommée", "PDF renommé : titre tiré du nom réel");
  assert.deepEqual(P.documentsDe(v.projets[0], v, [{ name: "21 - x.pdf", webUrl: "javascript:alert(1)" }]).map((x) => x.url), ["", "", ""], "https seulement");
});

test("petits outils : taille, lien tel:", () => {
  assert.equal(P.taille(245760), "240 Ko");
  assert.equal(P.taille(1300000), "1,2 Mo");
  assert.equal(P.taille(0), "");
  assert.equal(P.lienTel("01 23 45 67 89"), "tel:+33123456789");
  assert.equal(P.lienTel("+33 1 23 45 67 89"), "tel:+33123456789");
});

test("dépôt public : aucune donnée client dans le code ni dans l'exemple", () => {
  const code = lire("suivi.js") + lire("suivi-ecrans.js") + lire("tests/suivi-exemple.json");
  assert.doesNotMatch(code, /breteuil\.fr|ch[aâ]teau de breteuil|o2switch|D-2026-001|06 09 89 74 43|gmail/i);
  assert.doesNotMatch(lire("suivi-ecrans.js"), /innerHTML|insertAdjacentHTML|outerHTML/, "tout est inséré en texte");
});

test("config.js : libellés, dossier et fichier du Suivi informatique en UNE constante", async () => {
  const vm = await import("node:vm");
  const ctx = { self: {} }; vm.runInNewContext(lire("config.js"), ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.self.EB_CONFIG.suivi)), { libelle: "Suivi informatique", tuile: "Ce que Damien a fait pour le Château",
    dossier: "Suivi informatique", fichier: "suivi.json", guides: "Guides", ancien: { dossier: "Pilotage", fichier: "pilotage.json" } });
  const ecrans = lire("suivi-ecrans.js");
  assert.match(ecrans, /EB_CONFIG\.suivi/);
  assert.doesNotMatch(ecrans.replace(/function reglage\(\)[\s\S]*?\n  }\n/, ""), /"Suivi informatique|"suivi\.json"|"Pilotage"|"pilotage\.json"/, "aucun nom codé en dur hors des valeurs par défaut");
});
