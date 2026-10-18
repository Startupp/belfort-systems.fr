// Tests de la section « Site web » (sans navigateur) : node --test espace-breteuil/tests/siteweb.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const S = require("../siteweb.js");
const lire = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const ctx = { self: {} }; vm.runInNewContext(lire("config.js"), ctx);
const CFG = ctx.self.EB_CONFIG;

test("config : site, WordPress et groupe, sans adresse personnelle", () => {
  assert.deepEqual({ ...CFG.siteWeb }, { url: "https://www.breteuil.fr", admin: "https://www.breteuil.fr/wp-admin/", groupe: "Site web" });
  assert.doesNotMatch(lire("siteweb.js") + lire("siteweb-ecrans.js"), /[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}/i, "aucune adresse mail dans le code");
});

test("adresses : uniquement celles prévues (aucune inventée)", () => {
  const u = S.adresses(CFG);
  assert.deepEqual(u, {
    site: "https://www.breteuil.fr/", admin: "https://www.breteuil.fr/wp-admin/",
    medias: "https://www.breteuil.fr/wp-admin/upload.php",
    piedDePage: "https://www.breteuil.fr/wp-admin/edit.php?post_type=elementor_library&tabs_group=theme",
    menus: "https://www.breteuil.fr/wp-admin/nav-menus.php",
    pages: "https://www.breteuil.fr/wp-admin/edit.php?post_type=page",
  });
  const permises = new Set(Object.values(u));
  for (const t of S.tuiles(CFG)) assert.ok(t.externe ? permises.has(t.href) : t.href.startsWith("#/"), t.id);
  for (const g of S.guides(CFG)) for (const l of [g.lien, g.lien2].filter(Boolean)) assert.ok(permises.has(l.url), g.id);
});

test("tuiles externes : nouvel onglet ; pas-à-pas de 3 étapes au plus", () => {
  const t = S.tuiles(CFG);
  assert.deepEqual(t.map((x) => x.libelle), ["Vérifier les liens", "Remplacer une image", "Liens du bas de page", "Couleurs du site", "Modifier une page", "Vider le cache", "Voir le site", "Pas à pas"]);
  for (const g of S.guides(CFG)) { assert.ok(g.etapes.length >= 2 && g.etapes.length <= 3, g.id); assert.ok(g.lien, g.id); }
  assert.match(S.guide(CFG, "pied").etapes.join(" "), /anglaise.*WPML/);
  assert.match(S.guide(CFG, "cache").etapes.join(" "), /WP Rocket/);
  assert.match(S.guide(CFG, "couleurs").prudence, /site de test/);
  assert.match(S.guide(CFG, "image").note, /Smush/);
  assert.equal(S.guide(CFG, "inconnu"), null);
});

test("liens vérifiés : cassés (GET 404/410 seulement), à vérifier (redirigés, robots refusés, muets), bons", () => {
  const l = [
    { texte: "Escape Game", url: "https://www.breteuil.fr/escape/", statut: 404, ok: false, redirigeVers: null, methode: "GET" },
    { texte: "Presse", url: "https://www.breteuil.fr/presse/", statut: 200, ok: true, redirigeVers: "https://www.breteuil.fr/espace-presse/" },
    { texte: "Instagram", url: "https://www.instagram.com/x/", statut: 429, ok: false, redirigeVers: null },
    { texte: "Contact", url: "https://www.breteuil.fr/contact/", statut: 200, ok: true, redirigeVers: null },
    { texte: "Mentions légales", url: "https://www.breteuil.fr/mentions/", statut: null, ok: false, redirigeVers: null },
  ];
  const g = S.trier(l);
  assert.deepEqual(g.casse.map((x) => x.texte), ["Escape Game"]);
  assert.deepEqual(g.verifier.map((x) => x.texte), ["Presse", "Instagram", "Mentions légales"]);
  // 404 vu seulement par un HEAD (budget épuisé) ou ancienne réponse sans « methode » : pas « cassé ».
  assert.equal(S.classer({ url: "x", statut: 404, ok: false, methode: "HEAD" }), "verifier");
  assert.equal(S.classer({ url: "x", statut: 404, ok: false }), "verifier");
  assert.equal(S.classer({ url: "x", statut: 410, ok: false, methode: "GET" }), "casse");
  assert.equal(S.classer({ url: "x", statut: 503, ok: false, methode: "GET" }), "verifier");
  assert.match(S.phrase({ statut: 404, ok: false, methode: "HEAD" }), /non confirmée.*vérifier vous-même/);
  assert.deepEqual(g.ok.map((x) => x.texte), ["Contact"]);
  assert.match(S.phrase(l[0]), /introuvable/);
  assert.match(S.phrase(l[1]), /ailleurs/);
  assert.match(S.phrase(l[2]), /vérifier vous-même/);
  assert.match(S.phrase(l[4]), /Ne répond pas/);
  assert.match(S.phrase({ statut: 503, ok: false }), /panne/);
  assert.equal(S.courte("https://www.breteuil.fr/contact/"), "breteuil.fr/contact");
  assert.equal(S.courte("https://x.fr/" + "a".repeat(100), 20).length, 20);
});

test("entités HTML décodées en texte (cache du Worker encore ancien)", () => {
  assert.equal(S.decoder("Groupes d&rsquo;enfants"), "Groupes d\u2019enfants");
  assert.equal(S.decoder("Breteuil dans l&rsquo;Histoire"), "Breteuil dans l\u2019Histoire");
  assert.equal(S.decoder("&laquo;&nbsp;&Eacute;t&eacute;&nbsp;&raquo; &ndash; &OElig;uvre &euro; &#8217;&#x2019;"), "\u00ab\u00a0Été\u00a0\u00bb \u2013 Œuvre € \u2019\u2019");
  assert.equal(S.decoder("&lt;img src=x onerror=alert(1)&gt;"), "<img src=x onerror=alert(1)>", "texte brut : posé avec textContent, jamais interprété");
  assert.equal(S.decoder("&inconnu; &constructor; &toString;"), "&inconnu; &constructor; &toString;", "inconnues (et noms de propriétés JS) laissées telles quelles");
  assert.equal(S.decoder(null), "");
});

test("erreurs : vérificateur pas installé, site muet, hors ligne", () => {
  assert.match(S.messageErreur({ statut: 404 }).titre, /pas encore installé/);
  assert.match(S.messageErreur({ statut: 404 }).texte, /Damien doit mettre à jour le service/);
  assert.match(S.messageErreur({ reseau: true }).titre, /pas encore installé/);
  assert.match(S.messageErreur({ statut: 502 }).titre, /ne répond pas/);
  assert.match(S.messageErreur({ horsLigne: true }).titre, /Pas de connexion/);
  assert.match(S.messageErreur({ statut: 500 }).texte, /code 500/);
});
