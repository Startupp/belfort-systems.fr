// Tests du parseur ICS de l'Espace Breteuil : node --test espace-breteuil/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ICS = require("../ics.js");
const texte = readFileSync(new URL("../exemple.ics", import.meta.url), "utf8");
const analyse = ICS.analyser(texte);

/** Heure murale à Paris "AAAA-MM-JJ HH:MM" d'un instant. */
function paris(ms) {
  const p = ICS.partiesDans(ms, "Europe/Paris");
  const z = (n) => String(n).padStart(2, "0");
  return `${p.y}-${z(p.m)}-${z(p.d)} ${z(p.h)}:${z(p.mi)}`;
}
const fenetre = (de, a) => ICS.developper(analyse, Date.parse(de), Date.parse(a));

test("analyse : nom du calendrier, VTIMEZONE et VALARM ignorés", () => {
  assert.equal(analyse.nom, "Planning d'exemple (données fictives)");
  assert.ok(analyse.evenements.length >= 12);
  assert.ok(analyse.evenements.every((e) => e.debut && e.debut.instant > 0));
  const halloween = analyse.evenements.find((e) => e.uid === "exemple-halloween@espace-breteuil");
  assert.equal(halloween.description, "Accueil renforcé. Marketing : photos pour les réseaux.");
});

test("échappements et lignes repliées", () => {
  const a = ICS.analyser("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nSUMMARY:Bonjour\\, le\r\n  monde\\; ici\r\nDESCRIPTION:L1\\nL2\r\nDTSTART:20261012T080000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n");
  assert.equal(a.evenements[0].titre, "Bonjour, le monde; ici");
  assert.equal(a.evenements[0].description, "L1\nL2");
});

test("fuseau Windows d'Outlook (Romance Standard Time) = Europe/Paris, heure d'été et d'hiver", () => {
  assert.equal(ICS.normaliserFuseau("Romance Standard Time"), "Europe/Paris");
  assert.equal(ICS.normaliserFuseau("Fuseau/Inconnu"), "Europe/Paris");
  // 12 octobre (été, UTC+2) et 9 novembre (hiver, UTC+1) : toujours 9 h 30 à Paris.
  const occ = fenetre("2026-10-12T00:00:00Z", "2026-11-10T00:00:00Z").filter((o) => o.uid.startsWith("exemple-reunion"));
  const heures = occ.map((o) => paris(o.debut));
  assert.ok(heures.includes("2026-10-12 09:30"));
  assert.ok(heures.includes("2026-11-09 09:30"));
  const oct12 = occ.find((o) => paris(o.debut) === "2026-10-12 09:30");
  assert.equal(new Date(oct12.debut).toISOString(), "2026-10-12T07:30:00.000Z");
  const nov9 = occ.find((o) => paris(o.debut) === "2026-11-09 09:30");
  assert.equal(new Date(nov9.debut).toISOString(), "2026-11-09T08:30:00.000Z");
});

test("RRULE hebdomadaire : EXDATE retirée, occurrence modifiée (RECURRENCE-ID) remplacée", () => {
  const occ = fenetre("2026-10-12T00:00:00Z", "2026-11-10T00:00:00Z").filter((o) => o.uid.startsWith("exemple-reunion"));
  const heures = occ.map((o) => paris(o.debut));
  assert.ok(!heures.includes("2026-11-02 09:30"), "le 2 novembre est exclu");
  assert.ok(!heures.includes("2026-10-19 09:30"), "le 19 octobre a été déplacé");
  assert.ok(heures.includes("2026-10-19 11:00"));
  assert.equal(occ.find((o) => paris(o.debut) === "2026-10-19 11:00").titre, "Réunion d'équipe (décalée à 11 h)");
  assert.deepEqual(heures, ["2026-10-12 09:30", "2026-10-19 11:00", "2026-10-26 09:30", "2026-11-09 09:30"]);
});

test("RRULE BYDAY=TU,TH avec COUNT=40 : 40 occurrences au total", () => {
  const occ = fenetre("2026-01-01T00:00:00Z", "2028-01-01T00:00:00Z").filter((o) => o.uid === "exemple-tonte@espace-breteuil");
  assert.equal(occ.length, 40);
  assert.equal(paris(occ[0].debut), "2026-09-08 08:00");
  assert.equal(paris(occ[1].debut), "2026-09-10 08:00");
  assert.ok(occ.every((o) => o.fin - o.debut === 4 * 3600000));
});

test("RRULE mensuelle : dernier jour du mois (BYMONTHDAY=-1) et 1er jeudi (BYDAY=1TH)", () => {
  const occ = fenetre("2026-09-01T00:00:00Z", "2027-01-01T00:00:00Z");
  const clotures = occ.filter((o) => o.uid === "exemple-cloture@espace-breteuil").map((o) => paris(o.debut).slice(0, 10));
  assert.deepEqual(clotures, ["2026-09-30", "2026-10-31", "2026-11-30", "2026-12-31"]);
  const lettres = occ.filter((o) => o.uid === "exemple-newsletter@espace-breteuil").map((o) => paris(o.debut));
  assert.deepEqual(lettres, ["2026-10-01 14:00", "2026-11-05 14:00", "2026-12-03 14:00"]);
});

test("journée entière sur plusieurs jours et passage à l'heure d'hiver", () => {
  const vac = fenetre("2026-10-01T00:00:00Z", "2026-11-30T00:00:00Z").find((o) => o.uid === "exemple-vacances@espace-breteuil");
  assert.equal(vac.journee, true);
  assert.equal(paris(vac.debut), "2026-10-17 00:00");
  assert.equal(paris(vac.fin), "2026-11-02 00:00");
});

test("événement UTC (Z) affiché à l'heure de Paris, annulé masqué", () => {
  const occ = fenetre("2026-10-20T00:00:00Z", "2026-10-22T00:00:00Z");
  const visite = occ.find((o) => o.uid === "exemple-visite-scolaire@espace-breteuil");
  assert.equal(paris(visite.debut), "2026-10-20 09:30");
  assert.ok(!occ.some((o) => o.uid === "exemple-annule@espace-breteuil"));
});

test("fenêtre : un événement qui chevauche le début de la fenêtre est gardé", () => {
  const occ = fenetre("2026-10-25T00:00:00Z", "2026-10-26T00:00:00Z");
  assert.ok(occ.some((o) => o.uid === "exemple-mariage@espace-breteuil"));
});

test("durées ISO", () => {
  assert.equal(ICS.lireDuree("PT1H30M"), 5400000);
  assert.equal(ICS.lireDuree("P1D"), 86400000);
  assert.equal(ICS.lireDuree("P1W"), 7 * 86400000);
  assert.equal(ICS.lireDuree("n'importe quoi"), null);
});
