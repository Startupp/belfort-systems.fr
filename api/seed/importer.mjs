#!/usr/bin/env node
/**
 * Importeur des données de départ (Node 22, sans dépendance).
 *
 * Lit `api/seed/demandes/*.json` et `api/seed/evenements/*.json` (format de
 * l'artefact de suivi : n, g, t, who, d, s, p, l, r, c[]) et produit
 * `api/seed/seed.sql`, idempotent (INSERT OR IGNORE) :
 *   - client de démonstration `tilleuls` (FICTIF ; token_hash NULL : à générer depuis le panneau) ;
 *   - projet `tilleuls-migration` ;
 *   - les demandes, les événements ;
 *   - une conversation par canal rattachée au projet, et un message par
 *     entrée `c[]` d'une demande (rattaché à la demande).
 *
 * Les données commitées sont FICTIVES (dépôt public). Pour de vraies données client,
 * les garder hors dépôt dans `api/seed/prive/` (ignoré par git) :
 *   api/seed/prive/demandes/*.json, api/seed/prive/evenements/*.json,
 *   api/seed/prive/client.json  { client:{id,slug,nom,contact,email}, projet:{id,titre,resume},
 *                                 participants, prenoms:[…] }   (facultatif)
 * puis : node api/seed/importer.mjs --source api/seed/prive   → écrit api/seed/prive/seed.sql
 *
 * Usage : node api/seed/importer.mjs [--source <dossier>]   (depuis la racine du dépôt ou depuis api/)
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
const iSource = process.argv.indexOf("--source");
const SOURCE = iSource > 0 && process.argv[iSource + 1] ? resolve(process.argv[iSource + 1]) : ICI;
const ANNEE = "2026";                     // les dates « jj/mm » des JSON sont en 2026
const QUAND = "2026-10-11T00:00:00.000Z"; // horodatage figé : seed reproductible

// Client et projet de démonstration (FICTIFS). Remplaçables par SOURCE/client.json (hors dépôt).
const CONFIG = {
  client: { id: "tilleuls", slug: "tilleuls", nom: "Domaine des Tilleuls", contact: "Claire Martin", email: "contact@domaine-tilleuls.example" },
  projet: { id: "tilleuls-migration", titre: "Migration de la messagerie et prise en main",
    resume: "Données de démonstration fictives : migration de 12 boîtes vers Microsoft 365, OneDrive, agendas, passation ; chantiers suivants (site, postes)." },
  participants: "Damien, Claire Martin, Hugo Lambert",
  // Prénoms côté client : un texte « Prénom : … » est une parole du client.
  prenoms: ["Claire", "Hugo", "Inès", "Nadia", "Paul"],
};
if (existsSync(join(SOURCE, "client.json"))) {
  const perso = JSON.parse(await readFile(join(SOURCE, "client.json"), "utf8"));
  Object.assign(CONFIG, perso, { client: { ...CONFIG.client, ...perso.client }, projet: { ...CONFIG.projet, ...perso.projet } });
}
const CLIENT_ID = CONFIG.client.id;
const PROJET_ID = CONFIG.projet.id;
const PRENOMS_CLIENT = CONFIG.prenoms;

/**
 * Statut du JSON → statut du contrat (même table que l'aperçu du panneau, admin/NOTES.md) :
 * fait→traite, afaire→lu (sauf les demandes venues du Word du 06/10 → nouveau),
 * aconfirmer→en_cours, partiel→partiel, attente→repondu, en cours→en_cours, abandonné→abandonne.
 */
function statutDemande(d) {
  const s = String(d.s || "").toLowerCase().replace(/\s+/g, "");
  const duWord = (d.c || []).some((m) => /^word$/i.test(String(m.c || "")));
  switch (s) {
    case "fait": return "traite";
    case "partiel": return "partiel";
    case "encours": return "en_cours";
    case "aconfirmer": case "àconfirmer": return "en_cours";
    case "attente": return "repondu";
    case "àfaire": case "afaire": return duWord ? "nouveau" : "lu";
    case "abandonné": case "abandonne": return "abandonne";
    default: return "lu";
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

/** Type d'événement du JSON → type du contrat ; renvoie [type, detail] (même table que le panneau). */
function typeEvenement(t) {
  switch (String(t || "").toLowerCase()) {
    case "echange": case "livrable": case "site": case "decision": case "facture": return [t, ""];
    case "jalon": return ["decision", ""];
    case "incident": return ["echange", "Incident"];
    case "avenir": return ["decision", "À venir."];   // date vide = affiché « À venir »
    default: return ["echange", t || ""];
  }
}

/**
 * Canal du JSON → [canal normalisé, piece] (même table que le panneau) :
 * Sur site→Sur place, Teams→Téléphone, Word→Mail (piece « Document Word »), Guide→Mail (piece « Guide PDF »).
 */
function canal(c) {
  const v = String(c || "").trim();
  if (/^sur (site|place)$/i.test(v)) return ["Sur place", null];
  if (/^(t[ée]l|teams)/i.test(v)) return ["Téléphone", null];
  if (/^word$/i.test(v)) return ["Mail", "Document Word"];
  if (/^guide$/i.test(v)) return ["Mail", "Guide PDF"];
  if (/^mail$/i.test(v) || /^e-?mail$/i.test(v)) return ["Mail", null];
  if (/^whatsapp$/i.test(v)) return ["WhatsApp", null];
  if (/^sms$/i.test(v)) return ["SMS", null];
  return [v || "Mail", null];
}

/** « jj/mm » → « 2026-mm-jj » ; sinon la chaîne telle quelle. */
function dateIso(d) {
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(String(d || "").trim());
  if (!m) return String(d || "");
  return `${ANNEE}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/**
 * Auteur probable d'un message : « Damien » si le texte commence par « Ta », « Ton »,
 * « Tu » (ou « Ta réponse »…) ; « Client » si un prénom du client précède « : » ;
 * sinon « Client » (dans le doute, ce n'est qu'un repère).
 */
function auteur(texte) {
  const t = String(texte || "").trim();
  if (/^(Ta|Ton|Tes|Tu)\b/.test(t)) return "Damien";
  for (const p of PRENOMS_CLIENT) {
    if (new RegExp(`^${p.replace(".", "\\.")}[^:]{0,40}:`).test(t)) return "Client";
  }
  if (/^(Envoi|Réponse|Explication|Procédure|Lien|Carte|Invitation|Planning|Correction|Analyse|Vérification|Présentation|Grille|Quatre documents|Mini-guide|Exporter|Annexe|Réglage fait|Liste des accès|Accès reçus)/.test(t)) return "Damien";
  return "Client";
}

/** Échappe une valeur SQL (NULL, nombre ou texte entre apostrophes). */
function sql(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

/** Lit tous les JSON d'un dossier, triés par nom. */
async function lireDossier(nom) {
  const dossier = join(SOURCE, nom);
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
  if (SOURCE === ICI) lignes.push("-- Données FICTIVES de démonstration (dépôt public) : aucun vrai client. Vraies données : voir api/seed/prive/ (hors dépôt).");
  lignes.push(`-- ${demandes.length} demandes, ${evenements.length} événements. Idempotent (INSERT OR IGNORE).`);
  lignes.push("");

  // Client et projet
  ins("clients", ["id", "slug", "nom", "contact", "email", "token_hash", "cree"],
    [CLIENT_ID, CONFIG.client.slug, CONFIG.client.nom, CONFIG.client.contact, CONFIG.client.email, null, QUAND]);
  ins("projets", ["id", "client_id", "titre", "statut", "resume", "cree", "maj"],
    [PROJET_ID, CLIENT_ID, CONFIG.projet.titre, "en_cours", CONFIG.projet.resume, QUAND, QUAND]);
  lignes.push("");

  // Conversations : une par canal rencontré (identifiant stable « conv-<canal> »).
  const conversations = new Map();
  const convId = (c) => {
    const slug = c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return `conv-${slug}`;
  };
  for (const d of demandes) for (const m of d.c || []) {
    const [c] = canal(m.c);
    if (!conversations.has(c)) conversations.set(c, convId(c));
  }
  for (const [c, id] of conversations) {
    ins("conversations", ["id", "projet_id", "canal", "titre", "participants", "maj"],
      [id, PROJET_ID, c, c, CONFIG.participants, QUAND]);
  }
  lignes.push("");

  // Demandes et messages
  let nbMessages = 0;
  for (const d of demandes) {
    const id = `dem-${String(d.n).padStart(2, "0")}`;
    const statut = statutDemande(d);
    const solution = statut === "traite" && d.l ? d.l : "";
    ins("demandes", ["id", "projet_id", "n", "groupe", "titre", "qui", "date_txt", "statut", "tarif", "livre", "reste", "solution", "motif", "note", "encore", "encore_le", "cree", "maj"],
      [id, PROJET_ID, d.n, d.g || "", d.t, d.who || "", d.d || "", statut, tarif(d.p), d.l || "", d.r || "", solution, "", null, 0, null, QUAND, QUAND]);
    (d.c || []).forEach((m, i) => {
      nbMessages++;
      const [c, piece] = canal(m.c);
      ins("messages", ["id", "conversation_id", "demande_id", "de", "date", "texte", "piece"],
        [`msg-${String(d.n).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`, conversations.get(c), id,
          auteur(m.t), dateIso(m.d), m.t, piece]);
    });
  }
  lignes.push("");

  // Événements (tous rattachés au projet de migration ; chantier d'origine en détail)
  evenements.forEach((e, i) => {
    const [type, detailType] = typeEvenement(e.type);
    const details = [detailType, e.projet && e.projet !== "migration" ? `Chantier : ${e.projet}` : ""].filter(Boolean);
    ins("evenements", ["id", "projet_id", "date", "type", "titre", "detail"],
      [`evt-${String(i + 1).padStart(2, "0")}`, PROJET_ID, e.date || "", type, e.titre, details.join(" — ")]);
  });
  lignes.push("");
  lignes.push("INSERT OR IGNORE INTO journal (quand, qui, action, cible) VALUES (" +
    [QUAND, "seed", "importer", `projets:${PROJET_ID}`].map(sql).join(", ") + ");");
  lignes.push("");

  const sortie = join(SOURCE, "seed.sql");
  await writeFile(sortie, lignes.join("\n"), "utf8");
  console.log(`seed.sql écrit : ${demandes.length} demandes, ${evenements.length} événements, ${conversations.size} conversations, ${nbMessages} messages.`);
}

principal().catch((e) => { console.error("Échec de l'import :", e.message); process.exit(1); });
