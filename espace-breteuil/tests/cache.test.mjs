// Tests du cache de session (dernier état connu puis mise à jour) : node --test espace-breteuil/tests/cache.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { creer } = require("../cache.js");

test("1er appel attendu, ensuite valeur immédiate sans réseau", async () => {
  let n = 0;
  const c = creer();
  assert.equal(await c.obtenir("k", () => ++n), 1);
  assert.equal(await c.obtenir("k", () => ++n), 1);
  assert.equal(n, 1);
  assert.equal(c.connu("k"), 1);
});

test("deux demandes simultanées = un seul appel", async () => {
  let n = 0;
  const c = creer();
  const lent = () => new Promise((ok) => setTimeout(() => ok(++n), 10));
  const [a, b] = await Promise.all([c.obtenir("k", lent), c.obtenir("k", lent)]);
  assert.equal(a, 1); assert.equal(b, 1); assert.equal(n, 1);
});

test("valeur périmée : rendue tout de suite, rafraîchie en arrière-plan, écouteur prévenu si elle change", async () => {
  let t = 0, v = "a";
  const c = creer({ horloge: () => t });
  await c.obtenir("k", () => v, { ttl: 100 });
  const vus = [];
  v = "b"; t = 500;
  const immediat = await c.obtenir("k", () => v, { ttl: 100, surMaj: (x) => vus.push(x) });
  assert.equal(immediat, "a", "dernier état connu d'abord");
  await new Promise((ok) => setTimeout(ok, 5));
  assert.deepEqual(vus, ["b"]);
  assert.equal(c.connu("k"), "b");
});

test("pas d'écouteur prévenu si la valeur n'a pas changé (pas de re-rendu)", async () => {
  let t = 0;
  const c = creer({ horloge: () => t });
  await c.obtenir("k", () => ({ x: 1 }));
  const vus = [];
  t = 10 ** 6;
  await c.obtenir("k", () => ({ x: 1 }), { surMaj: (x) => vus.push(x) });
  await new Promise((ok) => setTimeout(ok, 5));
  assert.equal(vus.length, 0);
});

test("erreur : rien n'est gardé, l'appel suivant réessaie", async () => {
  const c = creer();
  await assert.rejects(c.obtenir("k", () => { throw new Error("panne"); }));
  assert.equal(await c.obtenir("k", () => 2), 2);
});

test("oublier une clé, un préfixe ou tout", async () => {
  const c = creer();
  await c.obtenir("dossier:a", () => 1); await c.obtenir("dossier:b", () => 2); await c.obtenir("autre", () => 3);
  c.oublier("dossier:*");
  assert.equal(c.connu("dossier:a"), undefined); assert.equal(c.connu("autre"), 3);
  c.oublier();
  assert.equal(c.connu("autre"), undefined);
  assert.equal(await c.rafraichir("autre", () => 4), 4);
});
