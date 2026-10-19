// Apparence (v5.7) sans navigateur : node --test espace-breteuil/tests/apparence.test.mjs
// Couleurs dérivées (OKLCH) toujours lisibles (AA) en clair ET en sombre, ajustement ou refus des couleurs
// choisies au sélecteur, validation du fichier partagé apparence.json, historique (5 versions), logo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { ratio } from "./theme.test.mjs";

const require = createRequire(import.meta.url);
const A = require("../apparence.js");

test("conversions OKLCH : aller-retour fidèle et contraste WCAG exact", () => {
  for (const c of ["#8A4C45", "#1F3A68", "#FFFFFF", "#000000", "#C9A04A", "#3F6B4A"]) {
    const o = A.oklch(c);
    assert.equal(A.depuisOklch(o.l, o.c, o.h), c, c);
  }
  assert.equal(A.contraste("#000000", "#FFFFFF").toFixed(2), "21.00");
  assert.equal(A.contraste("#8A4C45", "#FBF6EE").toFixed(3), ratio("#8A4C45", "#FBF6EE").toFixed(3));
});

test("assurer() atteint le contraste demandé en gardant la teinte", () => {
  const r = A.assurer("#E0B0A0", ["#FFFFFF"], 4.5);
  assert.ok(A.contraste(r, "#FFFFFF") >= 4.5);
  assert.ok(Math.abs(A.oklch(r).h - A.oklch("#E0B0A0").h) < 6, "même teinte");
  assert.equal(A.assurer("#202020", ["#FFFFFF"], 4.5), "#202020", "déjà lisible : inchangé");
  const s = A.assurer("#303A60", ["#101418"], 4.5);
  assert.ok(A.contraste(s, "#101418") >= 4.5 && A.oklch(s).l > A.oklch("#303A60").l, "fond sombre : on éclaircit");
});

test("10 palettes × 3 tons × 3 en-têtes × clair/sombre : toutes les paires AA", () => {
  assert.ok(A.PALETTES.length >= 8 && A.PALETTES.length <= 10);
  assert.deepEqual(A.PALETTES.slice(0, 2).map((p) => [p.id, p.nom]), [["creme", "Crème et praline"], ["bleu", "Bleu élégant"]]);
  for (const p of A.PALETTES) for (const ton of ["chaud", "neutre", "froid"]) for (const entete of ["uni", "degrade", "clair"]) for (const sombre of [false, true]) {
    const v = A.deriver({ primaire: p.primaire, accent: p.accent, ton, entete }, sombre);
    assert.deepEqual(A.controler(v), [], `${p.id} ${ton} ${entete} ${sombre ? "sombre" : "clair"}`);
  }
});

test("couleurs personnalisées au hasard (acceptées par verifierCouleur) : toujours AA", () => {
  let graine = 7;
  const hasard = () => { graine = (graine * 1103515245 + 12345) % 2147483648; return "#" + (graine % 16777216).toString(16).padStart(6, "0"); };
  let essais = 0;
  for (let i = 0; i < 600; i++) {
    const p = A.verifierCouleur(hasard(), "primaire"), a = A.verifierCouleur(hasard(), "accent");
    if (!p.ok || !a.ok) continue;
    essais++;
    for (const sombre of [false, true]) for (const entete of ["uni", "clair"])
      assert.deepEqual(A.controler(A.deriver({ primaire: p.couleur, accent: a.couleur, ton: ["chaud", "neutre", "froid"][i % 3], entete }, sombre)), [], `${p.couleur} ${a.couleur}`);
  }
  assert.ok(essais > 100, "assez de cas testés : " + essais);
});

test("verifierCouleur : ajuste un peu, refuse avec une phrase simple", () => {
  assert.deepEqual(A.verifierCouleur("#1F3A68", "primaire"), { ok: true, couleur: "#1F3A68", ajustee: false, message: "" });
  const peu = A.verifierCouleur("#B07060", "primaire");
  assert.equal(peu.ok, true); assert.equal(peu.ajustee, true); assert.match(peu.message, /lisible/);
  assert.ok(A.contraste(peu.couleur, "#FFFFFF") >= 4.5);
  assert.deepEqual(A.verifierCouleur("#F5E6A0", "primaire").message, "Trop clair : le texte serait illisible. Choisissez une couleur plus foncée.");
  assert.equal(A.verifierCouleur("#F5E6A0", "primaire").ok, false);
  assert.match(A.verifierCouleur("#050505", "primaire").message, /^Trop foncé/);
  assert.match(A.verifierCouleur("#202020", "accent").message, /^Trop foncé/);
  assert.equal(A.verifierCouleur("rouge", "primaire").ok, false);
});

test("validation d'apparence.json : valeurs inconnues ignorées, jamais d'échec bloquant", () => {
  assert.equal(A.valider("{pas du json").ok, false);
  assert.equal(A.valider([]).ok, false);
  const v = A.valider({ palette: "inconnue", primaire: "#F5E6A0", accent: "#C9A04A", ton: "tiède", coins: "rond", police: "systeme", entete: "clair",
    logo: { fichier: "../secret.png", version: 2 }, icone: { version: 3, fichiers: ["icone-192.png", "<x>.png"] } });
  assert.equal(v.ok, true);
  assert.equal(v.donnees.palette, "creme"); assert.equal(v.donnees.primaire, null, "couleur illisible refusée");
  assert.equal(v.donnees.accent, "#C9A04A"); assert.equal(v.donnees.ton, null); assert.equal(v.donnees.coins, "rond");
  assert.equal(v.donnees.police, "systeme"); assert.equal(v.donnees.entete, "clair"); assert.equal(v.donnees.logo, null, "nom de fichier dangereux refusé");
  assert.deepEqual(v.donnees.icone, { version: 3, fichiers: ["icone-192.png"], demande: null });
  assert.equal(v.ignores, 4);
  assert.equal(A.valider({ palette: "bleu" }).donnees.palette, "bleu", "ancienne clé « bleu » toujours reconnue");
});

test("historique : 5 versions gardées, revenir en arrière, logo jamais perdu", () => {
  let fichier = null;
  for (let i = 0; i < 8; i++) fichier = A.historiser(fichier, { palette: A.PALETTES[i].id }, "Guillaumette", "2026-10-1" + i);
  assert.equal(fichier.palette, A.PALETTES[7].id);
  assert.equal(fichier.historique.length, 5);
  assert.deepEqual(fichier.historique.map((h) => h.palette), [6, 5, 4, 3, 2].map((i) => A.PALETTES[i].id));
  assert.equal(fichier.historique[0].modifiePar, "Guillaumette");
  fichier.logo = { fichier: "logo.png", version: 4 };
  const prec = A.versionPrecedente(fichier);
  assert.equal(prec.palette, A.PALETTES[6].id); assert.equal(prec.historique.length, 4);
  assert.deepEqual(prec.logo, { fichier: "logo.png", version: 4 });
  assert.equal(A.versionPrecedente({ palette: "creme" }), null, "rien avant : null");
  assert.ok(A.memesReglages({ palette: "sauge" }, { palette: "sauge", modifiePar: "x" }));
});

test("jetons : palettes d'origine sans variables ; personnalisation, coins et polices posés", () => {
  assert.deepEqual(A.jetons(null, false).vars, {});
  assert.equal(A.jetons(null, false).enteteCouleur, "#5B3833");
  const b = A.jetons({ palette: "bleu" }, true);
  assert.deepEqual(b.vars, {}); assert.equal(b.attrs["data-palette"], "bleu"); assert.equal(b.enteteCouleur, "#0F1A33");
  const d = A.jetons({ palette: "bleu", entete: "degrade" }, false);
  assert.deepEqual(d.vars, {}, "le dégradé utilise --entete-2 d'app.css"); assert.equal(d.attrs["data-entete"], "degrade");
  const s = A.jetons({ palette: "sauge", coins: "carre", police: "moderne" }, false);
  assert.equal(s.vars["--rayon"], "6px"); assert.match(s.vars["--serif"], /Archivo/); assert.equal(s.attrs["data-coins"], "carre");
  assert.equal(s.enteteCouleur, s.vars["--entete"]);
  assert.equal(A.jetons({ palette: "creme", accent: "#B8A060" }, false).attrs["data-palette"], null, "crème personnalisée : dérivée");
});

test("choix personnel : « Suivre le Château » par défaut, palette perso = couleurs seulement", () => {
  const chateau = { palette: "sauge", coins: "rond", police: "moderne", entete: "clair", primaire: "#2F5A3A" };
  assert.equal(A.effectif({ palette: "chateau" }, chateau).palette, "sauge");
  assert.equal(A.effectif({}, chateau).primaire, "#2F5A3A");
  const perso = A.effectif({ palette: "bleu" }, chateau);
  assert.deepEqual([perso.palette, perso.primaire, perso.coins, perso.police, perso.entete], ["bleu", null, "rond", "moderne", "uni"]);
  assert.equal(A.effectif({ palette: "chateau" }, null).palette, "creme", "rien de partagé : l'original");
});

test("logo : PNG/JPEG/WebP ≤ 1 Mo, SVG refusé ; placement dans un carré avec marge", () => {
  assert.equal(A.verifierLogo({ type: "image/png", size: 200000, name: "logo.png" }), "");
  assert.match(A.verifierLogo({ type: "image/svg+xml", size: 2000, name: "logo.svg" }), /SVG/);
  assert.match(A.verifierLogo({ type: "image/gif", size: 2000, name: "logo.gif" }), /PNG, JPEG ou WebP/);
  assert.equal(A.verifierLogo({ type: "image/png", size: 1572864, name: "l.png" }), "Logo trop lourd (1,5 Mo) : 1 Mo au plus.");
  assert.deepEqual(A.placerDansCarre(400, 200, 512, 0.125), { x: 64, y: 160, l: 384, h: 192 });
});
