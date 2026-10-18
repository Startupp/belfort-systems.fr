// Tests de « Aide et demandes » (sans navigateur) : node espace-breteuil/tests/aide.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const A = require("../aide.js");
const lire = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

test("types et statuts : 4 types dans l'ordre, libellés français", () => {
  assert.deepEqual(A.TYPES.map((t) => t.libelle), ["Question", "Avis", "Amélioration", "Problème"]);
  assert.deepEqual(A.TYPES.map((t) => t.cle), ["question", "avis", "amelioration", "probleme"]);
  assert.equal(A.libelleStatut("repondue"), "Répondue"); assert.equal(A.libelleStatut("resolue"), "Résolue"); assert.equal(A.libelleStatut("x"), "Nouvelle");
  assert.equal(A.confirmation(12), "Demande n° 12 envoyée à Damien");
});

test("validation du formulaire : type obligatoire, message non vide, 4000 caractères au plus", () => {
  assert.deepEqual(A.valider({}).erreurs, { type: "Choisissez le type de demande.", message: "Écrivez votre message." });
  assert.equal(A.valider({ type: "inconnu", message: "x" }).erreurs.type, "Choisissez le type de demande.");
  assert.equal(A.valider({ type: "avis", message: "  \n " }).ok, false);
  const ok = A.valider({ type: "probleme", message: "  L'imprimante\r\nne marche plus\u0007  " });
  assert.equal(ok.ok, true); assert.deepEqual(ok.donnees, { type: "probleme", message: "L'imprimante\nne marche plus" });
  assert.equal(A.valider({ type: "avis", message: "a".repeat(4000) }).ok, true);
  assert.match(A.valider({ type: "avis", message: "a".repeat(4001) }).erreurs.message, /4001 caractères \(4000 au plus\)/);
  assert.equal(A.validerReponse(" ").ok, false); assert.equal(A.validerReponse(" Merci ").texte, "Merci");
  assert.deepEqual(A.compteur("abc"), { texte: "3 / 4000", trop: false, presque: false });
  assert.equal(A.compteur("a".repeat(3700)).presque, true); assert.equal(A.compteur("a".repeat(4001)).trop, true);
});

test("pastille : réponses non lues (client) ou demandes nouvelles (prestataire)", () => {
  const l = [{ id: 1, statut: "repondue", nonLu: true }, { id: 2, statut: "nouvelle", nonLu: false }, { id: 3, statut: "resolue" }, { id: 4, statut: "nouvelle" }];
  assert.equal(A.nonLues(l, false), 1);
  assert.equal(A.nonLues(l, true), 2);
  assert.equal(A.nonLues([], false), 0); assert.equal(A.nonLues(null, true), 0);
});

test("contexte joint : écran, appareil", () => {
  assert.equal(A.nomEcran("#/planning", "Planning"), "Planning (#/planning)");
  assert.equal(A.nomEcran("", ""), "accueil");
  assert.equal(A.nomEcran("#/moi/guides", "  Guides\n "), "Guides (#/moi/guides)");
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  assert.equal(A.appareil(iphone, { largeur: 390, installee: true }), "iPhone · Safari · appli installée · 390 px");
  assert.equal(A.appareil("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0"), "Ordinateur Windows · Edge");
  assert.equal(A.appareil("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36"), "Téléphone Android · Chrome");
  assert.equal(A.appareil("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", { tactile: true }), "iPad · Safari");
});

test("messages d'erreur : aide non installée → téléphone de Damien", () => {
  assert.equal(A.messageErreur({ code: "aide_non_configuree" }), "L'aide n'est pas encore installée — appelez Damien au 06 09 89 74 43.");
  assert.match(A.messageErreur({ statut: 401 }), /reconnectez-vous/);
  assert.match(A.messageErreur({ code: "trop_de_demandes", statut: 429 }), /plus tard/);
  assert.match(A.messageErreur({ code: "hors_ligne" }), /Pas de connexion/);
  assert.match(A.messageErreur({ statut: 500 }), /06 09 89 74 43/);
});

test("client du Worker : jeton d'identité en Authorization, routes et erreurs", async () => {
  const appels = [];
  const fauxFetch = async (url, init) => {
    appels.push({ url, methode: init.method, auth: init.headers.Authorization, type: init.headers["Content-Type"], corps: init.body && JSON.parse(init.body) });
    if (/\/moi$/.test(url)) return { ok: true, status: 200, json: async () => ({ prestataire: true }) };
    if (/\/999$/.test(url)) return { ok: false, status: 404, json: async () => ({ code: "introuvable", erreur: "Demande introuvable." }) };
    if (init.method === "POST" && /aide$/.test(url)) return { ok: false, status: 503, json: async () => ({ code: "aide_non_configuree" }) };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const C = A.client({ base: "https://api.exemple.dev/", jeton: async () => "id-token", fetch: fauxFetch });
  assert.deepEqual(await C.moi(), { prestataire: true });
  await C.lister({ statut: "nouvelle", type: "", personne: "a@b.fr" });
  await C.repondre(3, "Merci"); await C.statut(3, "resolue");
  assert.deepEqual(appels.map((a) => a.methode + " " + a.url), [
    "GET https://api.exemple.dev/breteuil/aide/moi", "GET https://api.exemple.dev/breteuil/aide?statut=nouvelle&personne=a%40b.fr",
    "POST https://api.exemple.dev/breteuil/aide/3/messages", "PATCH https://api.exemple.dev/breteuil/aide/3"]);
  assert.ok(appels.every((a) => a.auth === "Bearer id-token"));
  assert.deepEqual(appels[3].corps, { statut: "resolue" }); assert.equal(appels[3].type, "application/json");
  await assert.rejects(C.lire(999), (e) => e.statut === 404 && e.code === "introuvable");
  await assert.rejects(C.creer({ type: "avis", message: "x" }), (e) => e.code === "aide_non_configuree");
  const horsLigne = A.client({ base: "https://x", jeton: async () => "t", fetch: async () => { throw new TypeError("Failed to fetch"); } });
  await assert.rejects(horsLigne.moi(), (e) => e.code === "hors_ligne");
});

test("intégration : scripts chargés, coquille hors ligne, version 5.4.0, jamais innerHTML", () => {
  const index = lire("index.html"), sw = lire("sw.js");
  for (const f of ["aide.js", "aide-ecrans.js"]) {
    assert.ok(index.includes(`<script src="${f}"></script>`), f + " dans index.html");
    assert.ok(sw.includes(`"./${f}"`), f + " dans sw.js");
  }
  assert.match(lire("version.js"), /EB_VERSION = "5\.4\.0"/);
  for (const f of ["aide.js", "aide-ecrans.js"]) assert.doesNotMatch(lire(f).replace(/^\s*(\/\/|\*|\/\*).*$/gm, ""), /innerHTML|outerHTML|insertAdjacentHTML/, f);
  assert.match(lire("graph.js"), /jetonIdentite/, "graph.js : jeton d'identité pour le Worker");
});
