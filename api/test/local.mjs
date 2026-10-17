#!/usr/bin/env node
/**
 * Test de bout en bout en local : lance `wrangler dev --local` (D1 et KV locaux),
 * applique schema.sql et seed/seed.sql, puis vérifie les routes avec fetch.
 * Une ligne par vérification, puis un bilan. Code de sortie 1 si un test échoue.
 *
 * Usage : node api/test/local.mjs   (depuis api/ ou la racine du dépôt)
 * Prérequis : npm i (wrangler) ; le fichier .dev.vars est créé s'il manque.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const API = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGINE = "https://belfort-systems.fr";
const MDP = "test-local";
const WRANGLER = join(API, "node_modules", ".bin", "wrangler");

// État local isolé pour ce test (ne touche pas .wrangler/ du développeur).
const ETAT = mkdtempSync(join(tmpdir(), "belfort-api-test-"));
const persist = ["--persist-to", ETAT];

let total = 0, ok = 0;
const echecs = [];
function verif(nom, condition, detail = "") {
  total++;
  if (condition) { ok++; console.log(`  ok   ${nom}`); }
  else { echecs.push(nom); console.log(`  ÉCHEC ${nom}${detail ? " — " + detail : ""}`); }
}

/** Appel HTTP ; renvoie {status, corps, headers}. */
async function appel(methode, chemin, { corps, jeton, origine = ORIGINE, brut = false } = {}) {
  const headers = { Origin: origine };
  if (corps !== undefined) headers["Content-Type"] = "application/json";
  if (jeton) headers.Authorization = "Bearer " + jeton;
  const rep = await fetch(BASE + chemin, { method: methode, headers, body: corps !== undefined ? JSON.stringify(corps) : undefined });
  if (brut) return rep;
  let json = null;
  try { json = await rep.json(); } catch { /* pas de JSON */ }
  return { status: rep.status, corps: json, headers: rep.headers };
}

function wrangler(args, options = {}) {
  const r = spawnSync(WRANGLER, args, { cwd: API, encoding: "utf8", env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" }, ...options });
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr);
    throw new Error("wrangler " + args.join(" ") + " a échoué");
  }
  return r.stdout;
}

async function attendre(url, essais = 60) {
  for (let i = 0; i < essais; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Le Worker local ne répond pas sur " + url);
}

async function principal() {
  if (!existsSync(WRANGLER)) {
    console.error("wrangler n'est pas installé : lancez `npm i` dans api/ (ou `npm i -D wrangler@4`).");
    process.exit(2);
  }
  const devVars = join(API, ".dev.vars");
  if (!existsSync(devVars)) {
    writeFileSync(devVars, `ADMIN_PASSWORD=${MDP}\n`);
    console.log("→ .dev.vars créé (ADMIN_PASSWORD=test-local)");
  }

  console.log("→ schéma et seed en local");
  wrangler(["d1", "execute", "belfort-systems", "--local", "--file=schema.sql", ...persist]);
  wrangler(["d1", "execute", "belfort-systems", "--local", "--file=seed/seed.sql", ...persist]);

  console.log("→ démarrage de wrangler dev --local");
  const dev = spawn(WRANGLER, ["dev", "--local", "--port", String(PORT), "--ip", "127.0.0.1", "--var", `ADMIN_PASSWORD:${MDP}`, ...persist],
    { cwd: API, env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" }, stdio: ["ignore", "pipe", "pipe"] });
  let sortie = "";
  dev.stdout.on("data", (d) => (sortie += d));
  dev.stderr.on("data", (d) => (sortie += d));
  try {
    await attendre(BASE + "/");
    await tests();
  } catch (e) {
    console.error("Erreur :", e.message);
    console.error(sortie.slice(-3000));
    echecs.push("exécution : " + e.message);
  } finally {
    dev.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    rmSync(ETAT, { recursive: true, force: true });
  }

  console.log(`\nBilan : ${ok}/${total} vérifications réussies${echecs.length ? ", " + echecs.length + " en échec :" : "."}`);
  for (const e of echecs) console.log("  - " + e);
  process.exit(echecs.length ? 1 : 0);
}

async function tests() {
  // --- CORS -----------------------------------------------------------------
  const pre = await appel("OPTIONS", "/contact", { brut: true });
  verif("CORS pré-vol : 204 + Allow-Origin belfort-systems.fr",
    pre.status === 204 && pre.headers.get("Access-Control-Allow-Origin") === ORIGINE);
  const mauvaise = await appel("GET", "/disponibilites", { origine: "https://evil.example" });
  verif("CORS : origine inconnue refusée (403)", mauvaise.status === 403, "reçu " + mauvaise.status);
  const local = await appel("GET", "/", { origine: "http://localhost:5173" });
  verif("CORS : localhost accepté en dev", local.status === 200 && local.headers.get("Access-Control-Allow-Origin") === "http://localhost:5173");
  verif("En-têtes : no-store + nosniff", local.headers.get("Cache-Control") === "no-store" && local.headers.get("X-Content-Type-Options") === "nosniff");

  // --- Connexion admin ----------------------------------------------------------
  const bon = await appel("POST", "/admin/login", { corps: { password: MDP } });
  verif("login bon mot de passe → jeton", bon.status === 200 && bon.corps?.ok && typeof bon.corps.token === "string" && bon.corps.token.length >= 40,
    JSON.stringify(bon.corps));
  const jeton = bon.corps?.token;

  let statuts = [];
  for (let i = 0; i < 6; i++) {
    const r = await appel("POST", "/admin/login", { corps: { password: "faux-" + i } });
    statuts.push(r.status);
  }
  verif("login mauvais mot de passe ×5 → 401, 6e → 429", statuts.slice(0, 5).every((s) => s === 401) && statuts[5] === 429, statuts.join(","));
  const bloque = await appel("POST", "/admin/login", { corps: { password: MDP } });
  verif("login bloqué par IP même avec le bon mot de passe (429)", bloque.status === 429);

  const sansJeton = await appel("GET", "/admin/resume");
  verif("admin sans jeton → 401", sansJeton.status === 401);
  const fauxJeton = await appel("GET", "/admin/resume", { jeton: "x".repeat(43) });
  verif("admin faux jeton → 401", fauxJeton.status === 401);

  // --- Résumé et projets -------------------------------------------------------------
  const resume = await appel("GET", "/admin/resume", { jeton });
  verif("/admin/resume renvoie les compteurs", resume.status === 200 && typeof resume.corps.demandes_a_traiter === "number" && resume.corps.dernier_evenement,
    JSON.stringify(resume.corps));

  const projets = await appel("GET", "/admin/projets", { jeton });
  const pb = projets.corps?.projets?.find((p) => p.id === "tilleuls-migration");
  verif("/admin/projets : projet avec client imbriqué, compteurs et nb_demandes (forme du panneau)",
    pb && pb.client?.nom === "Domaine des Tilleuls" && pb.client.email === "contact@domaine-tilleuls.example" && pb.nb_demandes === 49
    && pb.compteurs?.traite === 16 && pb.compteurs.nouveau === 1 && pb.compteurs.lu === 17 && pb.compteurs.en_cours === 7 && pb.compteurs.partiel === 7 && pb.compteurs.repondu === 1,
    JSON.stringify(pb?.compteurs));

  const projet = await appel("GET", "/admin/projets/tilleuls-migration", { jeton });
  verif("/admin/projets/:id renvoie 49 demandes", projet.corps?.demandes?.length === 49, "reçu " + projet.corps?.demandes?.length);
  verif("/admin/projets/:id : projet.client imbriqué {id,slug,nom,contact,email}",
    projet.corps?.projet?.client?.slug === "tilleuls" && projet.corps.projet.client.contact === "Claire Martin");
  verif("/admin/projets/:id renvoie 36 événements et 5 conversations (Mail, WhatsApp, SMS, Téléphone, Sur place)",
    projet.corps?.evenements?.length === 36 && projet.corps?.conversations?.length === 5
    && ["Mail", "WhatsApp", "SMS", "Téléphone", "Sur place"].every((c) => projet.corps.conversations.some((x) => x.canal === c)));
  const nbMsg = (projet.corps?.conversations || []).reduce((s, c) => s + (c.messages?.length || 0), 0);
  verif("messages imbriqués dans les conversations (90, dont « Document Word » en piece)", nbMsg === 90
    && projet.corps.conversations.find((c) => c.canal === "Mail").messages.some((m) => m.piece === "Document Word"), "reçu " + nbMsg);
  verif("événements « à venir » avec date \"\" (pas null)", projet.corps?.evenements?.some((e) => e.date === "") && !projet.corps.evenements.some((e) => e.date === null));
  verif("demandes avec encore / encore_le / note", projet.corps?.demandes?.every((d) => d.encore === 0 && "encore_le" in d && "note" in d));
  verif("Les demandes « nouveau » sont passées « lu » à la lecture", !projet.corps?.demandes?.some((d) => d.statut === "nouveau"));
  const inconnu = await appel("GET", "/admin/projets/nexiste-pas", { jeton });
  verif("projet inconnu → 404", inconnu.status === 404);

  // --- Actions sur une demande ---------------------------------------------------
  const demande = projet.corps.demandes.find((d) => d.n === 6);
  const traiter = await appel("POST", `/admin/demandes/${demande.id}/traiter`, { jeton, corps: {} });
  verif("traiter → en_cours", traiter.corps?.statut === "en_cours");
  const faitSans = await appel("POST", `/admin/demandes/${demande.id}/fait`, { jeton, corps: {} });
  verif("fait sans solution → 400", faitSans.status === 400 && /solution/i.test(faitSans.corps?.erreur || ""));
  const faitAvec = await appel("POST", `/admin/demandes/${demande.id}/fait`, { jeton, corps: { solution: "MFA activée pour tous le 12/10." } });
  verif("fait avec solution → traite", faitAvec.corps?.statut === "traite");
  const abandonSans = await appel("POST", `/admin/demandes/${demande.id}/abandonner`, { jeton, corps: {} });
  verif("abandonner sans motif → 400", abandonSans.status === 400);
  const rouvrir = await appel("POST", `/admin/demandes/${demande.id}/rouvrir`, { jeton, corps: {} });
  verif("rouvrir → en_cours", rouvrir.corps?.statut === "en_cours");
  const patchAction = await appel("PATCH", `/admin/demandes/${demande.id}`, { jeton, corps: { action: "abandonner", statut: "abandonne", motif: "Reporté par le client." } });
  verif("PATCH {action:abandonner, statut, motif} → abandonne (forme du panneau)", patchAction.corps?.statut === "abandonne");
  const patchRouvrir = await appel("PATCH", `/admin/demandes/${demande.id}`, { jeton, corps: { action: "rouvrir", statut: "en_cours", reste: "Relancer en novembre." } });
  const patchNote = await appel("PATCH", `/admin/demandes/${demande.id}`, { jeton, corps: { note: "11/10/2026 — Vu avec Claire." } });
  const relu = await appel("GET", "/admin/projets/tilleuls-migration", { jeton });
  const d6 = relu.corps?.demandes?.find((d) => d.id === demande.id);
  verif("PATCH {action:rouvrir, reste} puis {note} → en_cours, reste et note enregistrés",
    patchRouvrir.corps?.statut === "en_cours" && patchNote.status === 200 && d6?.reste === "Relancer en novembre." && d6?.note === "11/10/2026 — Vu avec Claire.", JSON.stringify(d6));
  const nouvelle = await appel("POST", "/admin/demandes", { jeton, corps: { projet_id: "tilleuls-migration", titre: "Test de création", tarif: "devis" } });
  verif("POST /admin/demandes crée une demande numérotée 50", nouvelle.corps?.demande?.n === 50, JSON.stringify(nouvelle.corps));

  // --- Factures --------------------------------------------------------------------
  const brouillon = await appel("POST", "/admin/factures", { jeton, corps: {
    client_id: "tilleuls", date: "2026-10-11", echeance: "2026-11-10", objet: "Migration", statut: "brouillon", tva: 0, total_ht: 302.5,
    lignes: [{ ref: "migration", designation: "Migration de la messagerie", quantite: 1, unite: "forfait", prix: 250 }, { ref: "heure", designation: "Heures", quantite: 1.5, unite: "heure", prix: 35 }] } });
  verif("création d'un brouillon de facture (forme du panneau : lignes {ref,designation,quantite,unite,prix}, total 302,50)",
    brouillon.corps?.id && brouillon.corps?.facture?.statut === "brouillon" && brouillon.corps.facture.total_ht === 302.5 && brouillon.corps.facture.lignes[0].prix === 250, JSON.stringify(brouillon.corps));
  verif("facture avec client_nom / client_email joints", brouillon.corps?.facture?.client_nom === "Domaine des Tilleuls" && brouillon.corps.facture.client_email === "contact@domaine-tilleuls.example");
  const f1 = brouillon.corps.facture.id;
  const modif = await appel("PATCH", `/admin/factures/${f1}`, { jeton, corps: { note: "Merci de votre confiance." } });
  verif("brouillon modifiable (PATCH)", modif.status === 200);
  const payeeAvant = await appel("POST", `/admin/factures/${f1}/payee`, { jeton });
  verif("payee sur un brouillon → 409", payeeAvant.status === 409);
  const emise = await appel("POST", `/admin/factures/${f1}/emettre`, { jeton });
  verif("emettre → numéro BS-2026-001, statut envoyee", emise.corps?.facture?.numero === "BS-2026-001" && emise.corps.facture.statut === "envoyee", JSON.stringify(emise.corps));
  verif("emettre : date et échéance du brouillon conservées (+30 jours)",
    emise.corps?.facture?.date === "2026-10-11" && emise.corps.facture.echeance === "2026-11-10");
  const modifApres = await appel("PATCH", `/admin/factures/${f1}`, { jeton, corps: { note: "x" } });
  verif("facture émise non modifiable (409)", modifApres.status === 409);
  const suppr = await appel("DELETE", `/admin/factures/${f1}`, { jeton });
  verif("facture émise non supprimable (409)", suppr.status === 409);
  const b2 = await appel("POST", "/admin/factures", { jeton, corps: { client_id: "tilleuls", lignes: [{ designation: "Atelier OneDrive", quantite: 2, unite: "heure", prix: 35 }] } });
  const e2 = await appel("POST", `/admin/factures/${b2.corps.facture.id}/emettre`, { jeton });
  verif("deuxième émission → BS-2026-002, date = aujourd'hui, échéance = +30 jours", e2.corps?.facture?.numero === "BS-2026-002"
    && e2.corps.facture.date && (Date.parse(e2.corps.facture.echeance) - Date.parse(e2.corps.facture.date)) === 30 * 86400000, JSON.stringify(e2.corps));
  const payee = await appel("POST", `/admin/factures/${f1}/payee`, { jeton, corps: { date_paiement: "2026-10-20" } });
  verif("payee {date_paiement} depuis envoyee → payee, paye_le", payee.corps?.statut === "payee" && payee.corps.paye_le === "2026-10-20");
  const avoir = await appel("POST", `/admin/factures/${b2.corps.facture.id}/avoir`, { jeton, corps: { motif: "Erreur de quantité" } });
  verif("avoir (route /avoir) : brouillon négatif lié, type avoir, reference = numéro d'origine",
    avoir.corps?.facture?.statut === "brouillon" && avoir.corps.facture.total_ht === -70 && avoir.corps.facture.type === "avoir" && avoir.corps.facture.reference === "BS-2026-002", JSON.stringify(avoir.corps));
  const avoirDoublon = await appel("POST", `/admin/factures/${b2.corps.facture.id}/avoir`, { jeton, corps: {} });
  verif("un seul avoir par facture (409)", avoirDoublon.status === 409);
  const avoirEmis = await appel("POST", `/admin/factures/${avoir.corps.facture.id}/emettre`, { jeton });
  const origine = await appel("GET", `/admin/factures/${b2.corps.facture.id}`, { jeton });
  verif("émission de l'avoir → BS-2026-003 et facture d'origine annulee", avoirEmis.corps?.facture?.numero === "BS-2026-003" && origine.corps?.facture?.statut === "annulee");
  // Avoir à la manière du panneau : POST /admin/factures {type:"avoir", reference, lignes négatives}
  const avoirPanneau = await appel("POST", "/admin/factures", { jeton, corps: { client_id: "tilleuls", type: "avoir", reference: "BS-2026-001", date: "2026-10-11", echeance: "2026-10-11",
    lignes: [{ designation: "Migration de la messagerie", quantite: 1, unite: "forfait", prix: -250 }], note: "Avoir sur la facture BS-2026-001 — test", statut: "brouillon" } });
  verif("POST /admin/factures {type:avoir, reference} (forme du panneau) → brouillon lié, total -250",
    avoirPanneau.corps?.facture?.type === "avoir" && avoirPanneau.corps.facture.total_ht === -250 && avoirPanneau.corps.facture.ref === f1, JSON.stringify(avoirPanneau.corps));
  const liste = await appel("GET", "/admin/factures", { jeton });
  verif("/admin/factures liste 4 factures avec client_nom", liste.corps?.factures?.length === 4 && liste.corps.factures.every((f) => f.client_nom === "Domaine des Tilleuls"));

  // --- Contact et disponibilités ---------------------------------------------------
  const avant = await appel("GET", "/admin/contacts", { jeton });
  const nAvant = avant.corps?.contacts?.length ?? -1;
  const robot = await appel("POST", "/contact", { corps: { nom: "Robot", email: "r@r.fr", message: "spam", website: "http://spam", t: Date.now() - 10000 } });
  const apresRobot = await appel("GET", "/admin/contacts", { jeton });
  verif("/contact pot-de-miel rempli → 200 silencieux sans insertion", robot.status === 200 && robot.corps?.ok && apresRobot.corps.contacts.length === nAvant);
  const rapide = await appel("POST", "/contact", { corps: { nom: "Rapide", email: "r@r.fr", message: "trop vite", t: Date.now() } });
  const apresRapide = await appel("GET", "/admin/contacts", { jeton });
  verif("/contact envoyé en moins de 3 s → 200 silencieux sans insertion", rapide.status === 200 && apresRapide.corps.contacts.length === nAvant);
  const invalide = await appel("POST", "/contact", { corps: { nom: "X", email: "pas-un-mail", message: "bonjour", t: Date.now() - 5000 } });
  verif("/contact e-mail invalide → 400", invalide.status === 400);
  const creneau = "2030-01-07T09:00";
  const valide = await appel("POST", "/contact", { corps: { nom: "Jean Test", email: "jean@test.fr", tel: "0600000000", sujet: "Devis", message: "Bonjour, je souhaite un devis.", formule: "forfait", creneau, t: Date.now() - 5000 } });
  const contacts = await appel("GET", "/admin/contacts", { jeton });
  const trouve = contacts.corps?.contacts?.find((c) => c.email === "jean@test.fr");
  verif("/contact valide → présent dans /admin/contacts (statut nouveau)", valide.status === 200 && trouve && trouve.statut === "nouveau" && !("ip_hash" in trouve));
  const rdv = trouve?.rdv;
  verif("/contact avec créneau → contact.rdv joint {id,debut,fin,statut:propose,note}", rdv && rdv.statut === "propose" && rdv.debut === creneau && rdv.fin === "2030-01-07T10:00" && rdv.note, JSON.stringify(rdv));
  verif("contact sans créneau → rdv: null", contacts.corps.contacts.every((c) => c.id === trouve.id || c.rdv === null));
  const resume2 = await appel("GET", "/admin/resume", { jeton });
  verif("/admin/resume : prochain_rdv {debut,fin,avec,statut} et dernier_evenement {date,titre}",
    resume2.corps?.prochain_rdv?.debut === creneau && resume2.corps.prochain_rdv.avec === "Jean Test" && resume2.corps.prochain_rdv.statut === "propose"
    && resume2.corps.dernier_evenement?.date && resume2.corps.dernier_evenement.titre, JSON.stringify(resume2.corps));
  const lu = await appel("PATCH", `/admin/contacts/${trouve?.id}`, { jeton, corps: { statut: "lu" } });
  verif("PATCH /admin/contacts/:id statut lu", lu.status === 200);

  const dispo = await appel("GET", "/disponibilites?semaine=2030-W02");
  verif("/disponibilites renvoie des créneaux (35 sur une semaine libre)", dispo.corps?.creneaux?.length === 35 && dispo.corps.lundi === "2030-01-07", "reçu " + dispo.corps?.creneaux?.length);
  const conf = await appel("PATCH", `/admin/rdv/${rdv?.id}`, { jeton, corps: { statut: "confirme" } });
  verif("PATCH /admin/rdv/:id {statut:confirme}", conf.status === 200);
  const dispo2 = await appel("GET", "/disponibilites?semaine=2030-W02");
  verif("/disponibilites retire le rdv confirmé (34 créneaux)", dispo2.corps?.creneaux?.length === 34 && !dispo2.corps.creneaux.some((c) => c.debut === creneau));
  const dispoPasse = await appel("GET", "/disponibilites?semaine=2020-W10");
  verif("/disponibilites : semaine passée → aucun créneau", dispoPasse.corps?.creneaux?.length === 0);
  const dispoMal = await appel("GET", "/disponibilites?semaine=lundi");
  verif("/disponibilites : paramètre invalide → 400", dispoMal.status === 400);

  // --- Clients et jetons ------------------------------------------------------------
  const client = await appel("POST", "/admin/clients", { jeton, corps: { slug: "test-client", nom: "Client de test", contact: "Jeanne", email: "j@test.fr" } });
  verif("création d'un client → {id, token} en clair", client.status === 200 && client.corps?.id === "test-client" && typeof client.corps?.token === "string" && client.corps.token.length >= 40, JSON.stringify(client.corps));
  const jetonClient = client.corps?.token;
  const doublon = await appel("POST", "/admin/clients", { jeton, corps: { slug: "test-client", nom: "Doublon" } });
  verif("client en doublon → 409", doublon.status === 409);
  const listeClients = await appel("GET", "/admin/clients", { jeton });
  verif("/admin/clients : compteur projets, jamais le jeton ni son hachage", listeClients.corps?.clients?.every((c) => !("token_hash" in c) && !("jeton" in c) && typeof c.projets === "number")
    && listeClients.corps.clients.find((c) => c.slug === "tilleuls")?.a_jeton === false && listeClients.corps.clients.find((c) => c.slug === "tilleuls")?.projets === 1);
  const projetClient = await appel("POST", "/admin/projets", { jeton, corps: { client_id: "test-client", titre: "Projet de test" } });
  verif("POST /admin/projets", projetClient.status === 200 && projetClient.corps?.projet?.id);

  const moi = await appel("GET", "/client/moi", { jeton: jetonClient });
  verif("/client/moi avec ce jeton OK", moi.status === 200 && moi.corps?.client?.slug === "test-client" && moi.corps.projets.length === 1, JSON.stringify(moi.corps));
  const faux = await appel("GET", "/client/moi", { jeton: "f".repeat(43) });
  verif("/client/moi avec un faux jeton → 401", faux.status === 401);
  const adminSurClient = await appel("GET", "/client/moi", { jeton });
  verif("jeton admin refusé sur /client/* (401)", adminSurClient.status === 401);
  const demCli = await appel("POST", "/client/demandes", { jeton: jetonClient, corps: { titre: "L'imprimante ne répond plus", texte: "Depuis ce matin, rien ne sort." } });
  verif("POST /client/demandes → demande nouveau + message", demCli.status === 200 && demCli.corps?.demande?.statut === "nouveau", JSON.stringify(demCli.corps));
  const encore = await appel("POST", `/client/demandes/${demCli.corps?.demande?.id}/encore`, { jeton: jetonClient, corps: {} });
  const projetTest = await appel("GET", `/admin/projets/${projetClient.corps?.projet?.id}`, { jeton });
  const demEncore = projetTest.corps?.demandes?.find((d) => d.id === demCli.corps?.demande?.id);
  verif("POST /client/demandes/:id/encore → nouveau, encore = 1, encore_le = aujourd'hui", encore.corps?.statut === "nouveau" && demEncore?.encore === 1 && /^\d{4}-\d{2}-\d{2}$/.test(demEncore?.encore_le || ""), JSON.stringify(demEncore));
  const demAutre = await appel("POST", `/client/demandes/${demande.id}/messages`, { jeton: jetonClient, corps: { texte: "pirate" } });
  verif("un client ne peut pas écrire sur la demande d'un autre (404)", demAutre.status === 404);
  const regen = await appel("POST", "/admin/clients/test-client/regenerer", { jeton });
  const ancien = await appel("GET", "/client/moi", { jeton: jetonClient });
  const nouveau = await appel("GET", "/client/moi", { jeton: regen.corps?.token });
  verif("régénération : ancien jeton révoqué, nouveau accepté", ancien.status === 401 && nouveau.status === 200);

  // --- Journal et flux SSE --------------------------------------------------------------
  const journal = await appel("GET", "/admin/journal?limit=5", { jeton });
  verif("/admin/journal renvoie des lignes d'audit avec `table`", journal.corps?.journal?.length === 5 && journal.corps.journal[0].quand && journal.corps.journal.every((l) => typeof l.table === "string"));
  const ctrl = new AbortController();
  const flux = await fetch(`${BASE}/admin/flux?t=${jeton}`, { headers: { Origin: ORIGINE }, signal: ctrl.signal });
  verif("/admin/flux?t=<jeton> renvoie text/event-stream", flux.status === 200 && (flux.headers.get("Content-Type") || "").startsWith("text/event-stream"));
  const lecteur = flux.body.getReader();
  const dec = new TextDecoder();
  let recu = "";
  const premier = await lecteur.read();
  recu += dec.decode(premier.value);
  // Une écriture pendant la connexion doit produire un événement « maj ».
  await appel("POST", "/admin/evenements", { jeton, corps: { projet_id: "tilleuls-migration", type: "livrable", titre: "Événement de test", date: "2026-10-11" } });
  const limite = Date.now() + 8000;
  while (!/event: maj/.test(recu) && Date.now() < limite) {
    const { value, done } = await lecteur.read();
    if (done) break;
    recu += dec.decode(value);
  }
  verif("/admin/flux diffuse un événement « maj » après une écriture", /event: bonjour/.test(recu) && /event: maj/.test(recu) && /"table":"evenements"/.test(recu));
  ctrl.abort();
  const fluxSans = await appel("GET", "/admin/flux");
  verif("/admin/flux sans jeton → 401", fluxSans.status === 401);
  const ctrl2 = new AbortController();
  const flux2 = await fetch(`${BASE}/admin/flux?jeton=${jeton}`, { headers: { Origin: ORIGINE }, signal: ctrl2.signal });
  verif("/admin/flux?jeton= accepté aussi", flux2.status === 200);
  ctrl2.abort();

  // --- Déconnexion ----------------------------------------------------------------------
  const logout = await appel("POST", "/admin/logout", { jeton });
  const apres = await appel("GET", "/admin/resume", { jeton });
  verif("logout → session supprimée (401 ensuite)", logout.status === 200 && apres.status === 401);
}

principal();
