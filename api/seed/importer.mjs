#!/usr/bin/env node
/**
 * Importeur des données de départ (Node 22, sans dépendance).
 *
 * Lit `api/seed/demandes/*.json` et `api/seed/evenements/*.json` (format de
 * l'artefact de suivi : n, g, t, who, d, s, p, l, r, c[]) et produit
 * `api/seed/seed.sql`, idempotent (INSERT OR IGNORE) :
 *   - client `breteuil` (token_hash NULL : à générer depuis le panneau) ;
 *   - projet `breteuil-migration` ;
 *   - les demandes, les événements ;
 *   - une conversation par canal rattachée au projet, et un message par
 *     entrée `c[]` d'une demande (rattaché à la demande).
 *
 * Usage : node api/seed/importer.mjs   (depuis la racine du dépôt ou depuis api/)
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
const ANNEE = "2026";                     // les dates « jj/mm » des JSON sont en 2026
const CLIENT_ID = "breteuil";
const PROJET_ID = "breteuil-migration";
const QUAND = "2026-10-11T00:00:00.000Z"; // horodatage figé : seed reproductible

// Prénoms du château : un texte « Prénom : … » est une parole du client.
const PRENOMS_CHATEAU = ["Pauline", "François", "Francois", "Fanny", "Guillaumette", "Valérie", "Valerie", "Erwin", "Amélie", "Paula", "Joao", "M. Defecques"];

/** Statut du JSON → statut du contrat. */
function statutDemande(s) {
  switch (String(s || "").toLowerCase().replace(/\s+/g, "")) {
    case "fait": return "traite";
    case "partiel": return "partiel";
    case "encours": return "en_cours";
    case "àfaire": case "afaire": return "nouveau";
    case "abandonné": case "abandonne": return "abandonne";
    default: return "lu";                 // aconfirmer, attente, …
  }
}

/** Tarif du JSON → tarif du contrat (forfait|extra|offert|devis). */
function tarif(p) {
  switch (String(p || "").toLowerCase()) {
    case "forfait": return "forfait";
    case "offert": return "offert";
    case "devis": return "devis";
    case "extra": return "extra";
    case "hors": return "extra";          // « hors forfait »
    default: return "forfait";
  }
}

/** Type d'événement du JSON → type du contrat ; renvoie [type, detail]. */
function typeEvenement(t) {
  switch (String(t || "").toLowerCase()) {
    case "echange": case "livrable": case "site": case "decision": case "facture": return [t, null];
    case "jalon": return ["decision", "Jalon"];
    case "incident": return ["echange", "Incident"];
    case "avenir": return ["decision", "À venir (date à fixer)"];
    default: return ["echange", t || null];
  }
}

/** Canal du JSON → canal normalisé. */
function canal(c) {
  const v = String(c || "").trim();
  if (/^sur (site|place)$/i.test(v)) return "Sur place";
  if (/^t[ée]l/i.test(v)) return "Téléphone";
  if (/^mail$/i.test(v) || /^e-?mail$/i.test(v)) return "Mail";
  if (/^whatsapp$/i.test(v)) return "WhatsApp";
  if (/^sms$/i.test(v)) return "SMS";
  return v || "Mail";
}

/** « jj/mm » → « 2026-mm-jj » ; sinon la chaîne telle quelle. */
function dateIso(d) {
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(String(d || "").trim());
  if (!m) return String(d || "");
  return `${ANNEE}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/**
 * Auteur probable d'un message : « Damien » si le texte commence par « Ta », « Ton »,
 * « Tu » (ou « Ta réponse »…) ; « Château » si un prénom du château précède « : » ;
 * sinon « Château » (dans le doute, ce n'est qu'un repère).
 */
function auteur(texte) {
  const t = String(texte || "").trim();
  if (/^(Ta|Ton|Tes|Tu)\b/.test(t)) return "Damien";
  for (const p of PRENOMS_CHATEAU) {
    if (new RegExp(`^${p.replace(".", "\\.")}[^:]{0,40}:`).test(t)) return "Château";
  }
  if (/^(Envoi|Réponse|Explication|Procédure|Lien|Carte|Invitation|Planning|Correction|Analyse|Vérification|Présentation|Grille|Quatre documents|Mini-guide|Exporter|Annexe|Réglage fait|Liste des accès|Accès reçus)/.test(t)) return "Damien";
  return "Château";
}

/** Échappe une valeur SQL (NULL, nombre ou texte entre apostrophes). */
function sql(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

/** Lit tous les JSON d'un dossier, triés par nom. */
async function lireDossier(nom) {
  const dossier = join(ICI, nom);
  const fichiers = (await readdir(dossier)).filter((f) => f.endsWith(".json")).sort();
  const out = [];
  for (const f of fichiers) out.push({ fichier: f, ...JSON.parse(await readFile(join(dossier, f), "utf8")) });
  return out;
}

async function principal() {
  const demandes = await lireDossier("demandes");
  const evenements = await lireDossier("evenements");
  const lignes = [];
  const ins = (table, cols, vals) => lignes.push(`INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES (${vals.map(sql).join(", ")});`);

  lignes.push("-- Données de départ générées par api/seed/importer.mjs — ne pas modifier à la main.");
  lignes.push(`-- ${demandes.length} demandes, ${evenements.length} événements. Idempotent (INSERT OR IGNORE).`);
  lignes.push("");

  // Client et projet
  ins("clients", ["id", "slug", "nom", "contact", "email", "token_hash", "cree"],
    [CLIENT_ID, "breteuil", "Château de Breteuil", "Pauline de Breteuil", "finance@breteuil.fr", null, QUAND]);
  ins("projets", ["id", "client_id", "titre", "statut", "resume", "cree", "maj"],
    [PROJET_ID, CLIENT_ID, "Migration de la messagerie et prise en main", "en_cours",
      "Migration des 17 boîtes O2Switch vers Microsoft 365, OneDrive/SharePoint, calendriers, passation ; chantiers suivants (site, postes).",
      QUAND, QUAND]);
  lignes.push("");

  // Conversations : une par canal rencontré (identifiant stable « conv-<canal> »).
  const conversations = new Map();
  const convId = (c) => {
    const slug = c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return `conv-${slug}`;
  };
  for (const d of demandes) for (const m of d.c || []) {
    const c = canal(m.c);
    if (!conversations.has(c)) conversations.set(c, convId(c));
  }
  for (const [c, id] of conversations) {
    ins("conversations", ["id", "projet_id", "canal", "titre", "participants", "maj"],
      [id, PROJET_ID, c, `${c} — Château de Breteuil`, "Damien ; Pauline et François de Breteuil ; équipe du Château", QUAND]);
  }
  lignes.push("");

  // Demandes et messages
  let nbMessages = 0;
  for (const d of demandes) {
    const id = `dem-${String(d.n).padStart(2, "0")}`;
    const statut = statutDemande(d.s);
    const solution = statut === "traite" && d.l ? d.l : null;
    ins("demandes", ["id", "projet_id", "n", "groupe", "titre", "qui", "date_txt", "statut", "tarif", "livre", "reste", "solution", "motif", "cree", "maj"],
      [id, PROJET_ID, d.n, d.g || null, d.t, d.who || null, d.d || null, statut, tarif(d.p), d.l || null, d.r || null, solution, null, QUAND, QUAND]);
    (d.c || []).forEach((m, i) => {
      nbMessages++;
      ins("messages", ["id", "conversation_id", "demande_id", "de", "date", "texte", "piece"],
        [`msg-${String(d.n).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`, conversations.get(canal(m.c)), id,
          auteur(m.t), dateIso(m.d), m.t, m.k || null]);
    });
  }
  lignes.push("");

  // Événements (tous rattachés au projet de migration ; chantier d'origine en détail)
  evenements.forEach((e, i) => {
    const [type, detailType] = typeEvenement(e.type);
    const details = [detailType, e.projet && e.projet !== "migration" ? `Chantier : ${e.projet}` : null].filter(Boolean);
    ins("evenements", ["id", "projet_id", "date", "type", "titre", "detail"],
      [`evt-${String(i + 1).padStart(2, "0")}`, PROJET_ID, e.date || null, type, e.titre, details.length ? details.join(" — ") : null]);
  });
  lignes.push("");
  lignes.push("INSERT OR IGNORE INTO journal (quand, qui, action, cible) VALUES (" +
    [QUAND, "seed", "importer", `projets:${PROJET_ID}`].map(sql).join(", ") + ");");
  lignes.push("");

  const sortie = join(ICI, "seed.sql");
  await writeFile(sortie, lignes.join("\n"), "utf8");
  console.log(`seed.sql écrit : ${demandes.length} demandes, ${evenements.length} événements, ${conversations.size} conversations, ${nbMessages} messages.`);
}

principal().catch((e) => { console.error("Échec de l'import :", e.message); process.exit(1); });
