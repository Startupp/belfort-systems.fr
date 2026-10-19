// Installer / Gérer l'application (v5.7) : node --test espace-breteuil/tests/plateforme.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const P = createRequire(import.meta.url)("../plateforme.js");

const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1",
  iphoneFirefox: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
  ipadOs: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0",
  winChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  winEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  winFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
};

test("matrice de détection : appareil, navigateur, cas", () => {
  const cas = (ua, o) => { const p = P.detecter(UA[ua], o); return [p.appareil, p.navigateur, p.cas]; };
  assert.deepEqual(cas("iphoneSafari"), ["iphone", "safari", "ios-safari"]);
  assert.deepEqual(cas("iphoneChrome"), ["iphone", "chrome", "ios-autre"]);
  assert.deepEqual(cas("iphoneFirefox"), ["iphone", "firefox", "ios-autre"]);
  assert.deepEqual(cas("ipadOs", { tactile: true }), ["ipad", "safari", "ios-safari"], "iPadOS se présente comme un Mac");
  assert.deepEqual(cas("macSafari"), ["ordinateur", "safari", "bureau-safari"]);
  assert.deepEqual(cas("androidChrome"), ["android", "chrome", "android"]);
  assert.deepEqual(cas("androidChrome", { brave: true }), ["android", "brave", "android"]);
  assert.deepEqual(cas("samsung"), ["android", "samsung", "android"]);
  assert.deepEqual(cas("androidFirefox"), ["android", "firefox", "android-firefox"]);
  assert.deepEqual(cas("winChrome"), ["ordinateur", "chrome", "bureau-chrome"]);
  assert.deepEqual(cas("winEdge"), ["ordinateur", "edge", "bureau-chrome"]);
  assert.deepEqual(cas("winFirefox"), ["ordinateur", "firefox", "bureau-firefox"]);
  assert.equal(P.detecter(UA.iphoneSafari, { standalone: true }).installee, true);
});

test("guides : un seul bouton là où le navigateur le permet ; iPhone en 2 gestes ; Firefox ordinateur : honnête", () => {
  assert.equal(P.guide(P.detecter(UA.androidChrome, { invitation: true })).bouton, "invitation");
  assert.equal(P.guide(P.detecter(UA.winEdge, { invitation: true })).bouton, "invitation");
  const ios = P.guide(P.detecter(UA.iphoneSafari, { invitation: true }));
  assert.equal(ios.bouton, undefined, "iOS : aucune API d'installation");
  assert.equal(ios.etapes.length, 2);
  assert.match(ios.etapes[0].texte, /Partager ⬆️/); assert.match(ios.etapes[1].texte, /Sur l'écran d'accueil/);
  assert.match(P.guide(P.detecter(UA.iphoneChrome)).titre, /Safari/);
  assert.match(P.guide(P.detecter(UA.winFirefox)).titre, /Firefox ne sait pas/);
  assert.match(P.guide(P.detecter(UA.winFirefox)).etapes[0].texte, /Chrome ou Edge/);
  assert.match(P.guide(P.detecter(UA.macSafari)).etapes[0].texte, /Ajouter au Dock/);
});

test("désinstaller : le geste exact par appareil", () => {
  assert.match(P.desinstaller(P.detecter(UA.iphoneSafari)).etapes.map((e) => e.texte).join(" "), /appui long.*Supprimer l'app/);
  assert.match(P.desinstaller(P.detecter(UA.androidChrome)).etapes.map((e) => e.texte).join(" "), /Appui long.*Désinstaller/);
  assert.match(P.desinstaller(P.detecter(UA.winEdge)).etapes.map((e) => e.texte).join(" "), /menu ⋮.*Désinstaller/);
});

test("icône : bandeau seulement sur iPhone/iPad installé, une fois par version", () => {
  const ios = P.detecter(UA.iphoneSafari, { standalone: true });
  assert.equal(P.iconeAChange(ios, 1, 2, 0), true);
  assert.equal(P.iconeAChange(ios, 1, 2, 2), false, "déjà montré pour cette version");
  assert.equal(P.iconeAChange(ios, 2, 2, 0), false, "à jour");
  assert.equal(P.iconeAChange(ios, 0, 2, 0), false, "version d'installation inconnue : rien");
  assert.equal(P.iconeAChange(P.detecter(UA.iphoneSafari), 1, 2, 0), false, "dans Safari : rien");
  assert.equal(P.iconeAChange(P.detecter(UA.androidChrome, { standalone: true }), 1, 2, 0), false, "Android met l'icône à jour seul");
});
