// Tests unitaires du code pur du Worker (sans D1 ni KV) : node --test api/test/unitaires.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { _interne as W } from "../src/index.js";

const { champ, validerLignes, resoudre, pbkdf2, egalConstant, sha256, origineAutorisee, enTetesCors,
  lundiDeSemaine, finDeCreneau, ajouterJours, ErreurHttp, jetonDe } = W;

test("champ : texte requis, rognage, longueur", () => {
  assert.equal(champ({ a: "  bonjour " }, "a", { requis: true }), "bonjour");
  assert.throws(() => champ({}, "a", { requis: true }), (e) => e instanceof ErreurHttp && e.code === 400);
  assert.throws(() => champ({ a: "x".repeat(11) }, "a", { max: 10 }), /dépasse 10/);
  assert.equal(champ({}, "a", { defaut: "d" }), "d");
});

test("champ : email, date, dateheure, id, enum, entier, nombre", () => {
  assert.equal(champ({ e: "a@b.fr" }, "e", { type: "email" }), "a@b.fr");
  assert.throws(() => champ({ e: "pas-un-mail" }, "e", { type: "email" }), /e-mail/);
  assert.equal(champ({ d: "2026-10-11" }, "d", { type: "date" }), "2026-10-11");
  assert.throws(() => champ({ d: "11/10/2026" }, "d", { type: "date" }), /AAAA-MM-JJ/);
  assert.equal(champ({ d: "2026-10-12T09:00" }, "d", { type: "dateheure" }), "2026-10-12T09:00");
  assert.throws(() => champ({ i: "a b" }, "i", { type: "id" }), /identifiant/);
  assert.throws(() => champ({ s: "zzz" }, "s", { enum: ["a", "b"] }), /l'une des valeurs/);
  assert.equal(champ({ n: "12" }, "n", { type: "entier" }), 12);
  assert.throws(() => champ({ n: 1.5 }, "n", { type: "entier" }), /entier/);
  assert.equal(champ({ n: "3,5" }, "n", { type: "nombre" }), 3.5);
});

test("validerLignes : totaux arrondis au centime", () => {
  const { lignes, total_ht } = validerLignes([
    { ref: "migration", designation: "Migration", quantite: 1, unite: "forfait", prix: 250 },
    { designation: "Heures", quantite: 1.5, prix_unitaire: 35 },
  ]);
  assert.equal(lignes.length, 2);
  assert.equal(lignes[1].total, 52.5);
  assert.equal(total_ht, 302.5);
  assert.throws(() => validerLignes([{ quantite: 1 }]), /designation/);
  assert.throws(() => validerLignes("x"), /liste/);
});

test("routeur : correspondance méthode + motif, paramètres, 405", () => {
  const r = resoudre("POST", "/admin/demandes/abc-123/fait");
  assert.ok(r.route);
  assert.deepEqual(r.params, { id: "abc-123", action: "fait" });
  const p = resoudre("PATCH", "/admin/demandes/abc-123");
  assert.ok(p.route);
  assert.equal(p.params.id, "abc-123");
  const m = resoudre("DELETE", "/admin/login");
  assert.equal(m.route, null);
  assert.equal(m.cheminConnu, true);
  const inconnu = resoudre("GET", "/nulle-part");
  assert.equal(inconnu.route, null);
  assert.equal(inconnu.cheminConnu, false);
  assert.ok(resoudre("GET", "/admin/factures/x1/").route, "barre finale tolérée");
  assert.ok(resoudre("POST", "/admin/factures/x1/emettre").route);
  assert.ok(resoudre("POST", "/admin/factures/x1/avoir").route);
  assert.ok(resoudre("GET", "/client/moi").route);
  assert.equal(resoudre("GET", "/client/moi").route.acces, "client");
  assert.equal(resoudre("GET", "/admin/flux").route.acces, "admin");
});

test("PBKDF2 : déterministe, 32 octets, sensible au sel et au mot de passe", async () => {
  const a = await pbkdf2("secret", "sel", 1000);
  const b = await pbkdf2("secret", "sel", 1000);
  const c = await pbkdf2("secret", "autre", 1000);
  const d = await pbkdf2("Secret", "sel", 1000);
  assert.equal(a.length, 32);
  assert.ok(egalConstant(a, b));
  assert.ok(!egalConstant(a, c));
  assert.ok(!egalConstant(a, d));
  assert.ok(!egalConstant(a, new Uint8Array(31)));
});

test("SHA-256 hexadécimal", async () => {
  assert.equal(await sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("CORS : origine stricte + localhost", () => {
  const env = { ORIGINES: "https://belfort-systems.fr" };
  assert.ok(origineAutorisee("https://belfort-systems.fr", env));
  assert.ok(origineAutorisee("http://localhost:8788", env));
  assert.ok(origineAutorisee("http://127.0.0.1:3000", env));
  assert.ok(!origineAutorisee("https://evil.example", env));
  assert.ok(!origineAutorisee("https://belfort-systems.fr.evil.example", env));
  assert.ok(!origineAutorisee(null, env));
  const h = enTetesCors(new Request("https://x/", { headers: { Origin: "https://belfort-systems.fr" } }), env);
  assert.equal(h["Access-Control-Allow-Origin"], "https://belfort-systems.fr");
  assert.deepEqual(enTetesCors(new Request("https://x/", { headers: { Origin: "https://evil.example" } }), env), {});
});

test("jeton Bearer et paramètre ?jeton=", () => {
  const j = "a".repeat(43);
  assert.equal(jetonDe(new Request("https://x/", { headers: { Authorization: "Bearer " + j } })), j);
  assert.equal(jetonDe(new Request("https://x/"), new URL("https://x/admin/flux?jeton=" + j)), j);
  assert.equal(jetonDe(new Request("https://x/", { headers: { Authorization: "Basic abc" } }), new URL("https://x/")), null);
});

test("dates : semaine ISO, créneaux, ajout de jours", () => {
  assert.equal(lundiDeSemaine(2026, 1), "2025-12-29");
  assert.equal(lundiDeSemaine(2026, 42), "2026-10-12");
  assert.equal(finDeCreneau("2026-10-12T09:00"), "2026-10-12T10:00");
  assert.equal(finDeCreneau("2026-10-12T17:00"), "2026-10-12T18:00");
  assert.equal(ajouterJours("2026-12-15", 30), "2027-01-14");
});
