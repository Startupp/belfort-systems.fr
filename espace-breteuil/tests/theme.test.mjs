// Palettes de couleurs (sans navigateur) : node --test espace-breteuil/tests/theme.test.mjs
// Calcule les contrastes WCAG des paires principales dans les 2 palettes (crème, Bleu Breteuil)
// × clair / sombre, directement depuis les variables d'app.css.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const lire = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const CSS = lire("app.css").replace(/\/\*[\s\S]*?\*\//g, "");

/** Variables des règles dont le sélecteur est exactement `sel` (toutes occurrences, dans l'ordre). */
function variables(sel) {
  const v = {};
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].trim() !== sel) continue;
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) v[d[1]] = d[2].trim();
  }
  return v;
}
const SOMBRE_AUTO = ':root:not([data-theme="clair"])', SOMBRE = ':root[data-theme="sombre"]';
const B = ':root[data-palette="bleu"]', B_SOMBRE_AUTO = ':root[data-palette="bleu"]:not([data-theme="clair"])', B_SOMBRE = ':root[data-palette="bleu"][data-theme="sombre"]';
const PALETTES = {
  "crème clair": { ...variables(":root") },
  "crème sombre": { ...variables(":root"), ...variables(SOMBRE) },
  "bleu clair": { ...variables(":root"), ...variables(B) },
  "bleu sombre": { ...variables(":root"), ...variables(B), ...variables(B_SOMBRE) },
};

function lum(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex); assert.ok(m, "couleur hexadécimale attendue : " + hex);
  const c = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function ratio(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }

// [texte, fond, minimum] — texte ≥ 4,5:1 ; accents non textuels (doré, focus) ≥ 3:1.
const PAIRES = [
  ["--texte", "--fond", 4.5], ["--texte", "--surface", 4.5], ["--texte", "--surface-2", 4.5],
  ["--texte-2", "--fond", 4.5], ["--texte-2", "--surface", 4.5], ["--texte-2", "--surface-2", 4.5],
  ["--texte-3", "--fond", 4.5], ["--texte-3", "--surface", 4.5],
  ["--primaire", "--fond", 4.5], ["--primaire", "--surface", 4.5], ["--sur-primaire", "--primaire", 4.5],
  ["--primaire-fort", "--primaire-pale", 4.5],
  ["--entete-texte", "--entete", 4.5], ["--entete-doux", "--entete", 4.5],
  ["--or-texte", "--fond", 4.5], ["--or-texte", "--surface", 4.5],
  ["--info-texte", "--info-fond", 4.5], ["--exemple-texte", "--exemple-fond", 4.5],
  ["--praline-texte", "--praline-1", 4.5], ["--praline-texte", "--praline-2", 4.5], ["--praline-doux", "--praline-1", 4.5],
  ["--commun-doux", "--commun-1", 4.5], ["--commun-doux", "--commun-2", 4.5],
  ["--c-praline", "--c-praline-f", 4.5],
  ["--focus", "--fond", 3], ["--or", "--entete", 3],
];

for (const [nom, v] of Object.entries(PALETTES)) {
  test(`contrastes AA : ${nom}`, () => {
    const echecs = [];
    for (const [t, f, min] of PAIRES) {
      assert.ok(v[t] && v[f], `${nom} : ${t} ou ${f} manquant`);
      const r = ratio(v[t], v[f]);
      if (r < min) echecs.push(`${t} sur ${f} : ${r.toFixed(2)}:1 (< ${min})`);
    }
    assert.deepEqual(echecs, [], nom);
  });
}

test("sombre automatique = sombre choisi (crème et bleu)", () => {
  assert.deepEqual(variables(SOMBRE_AUTO), variables(SOMBRE));
  assert.deepEqual(variables(B_SOMBRE_AUTO), variables(B_SOMBRE));
});

test("la palette bleue redéfinit toutes les couleurs propres à la palette crème", () => {
  const propres = ["--entete", "--primaire", "--fond", "--surface", "--or", "--verre", "--an-4", "--praline-1", "--filet-clair",
    "--licence-1", "--commun-1", "--ombre-flottante", "--onglet-actif", "--onde", "--c-praline"];
  for (const k of propres) {
    assert.ok(variables(B)[k], "bleu clair : " + k);
    assert.ok(variables(B_SOMBRE)[k], "bleu sombre : " + k);
  }
  assert.equal(variables(B)["--entete"], "#14213D");
  assert.equal(variables(B)["--primaire"], "#1F3A68");
});

test("couleur du navigateur (theme-color) = en-tête de chaque palette", () => {
  const ctx = { window: {}, document: { documentElement: { setAttribute() {}, removeAttribute() {} }, querySelector: () => null }, localStorage: { getItem: () => null } };
  vm.runInNewContext(lire("prechargement.js"), ctx);
  const c = ctx.window.EBCouleurNavigateur;
  assert.equal(c("creme", false), PALETTES["crème clair"]["--entete"]);
  assert.equal(c("creme", true), PALETTES["crème sombre"]["--entete"]);
  assert.equal(c("bleu", false), PALETTES["bleu clair"]["--entete"]);
  assert.equal(c("bleu", true), PALETTES["bleu sombre"]["--entete"]);
});
