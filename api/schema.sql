-- Schéma de la base D1 « belfort-systems » (contrat : docs/TABLEAU-DE-BORD.md, §3).
-- Idempotent : peut être rejoué sans risque (CREATE ... IF NOT EXISTS).

-- Clients : un jeton par client, stocké haché (SHA-256), jamais en clair.
CREATE TABLE IF NOT EXISTS clients (
  id         TEXT PRIMARY KEY,
  slug       TEXT UNIQUE NOT NULL,
  nom        TEXT NOT NULL,
  contact    TEXT,
  email      TEXT,
  token_hash TEXT,
  cree       TEXT NOT NULL
);

-- Projets (chantiers) d'un client.
CREATE TABLE IF NOT EXISTS projets (
  id        TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  titre     TEXT NOT NULL,
  statut    TEXT NOT NULL DEFAULT 'en_cours',
  resume    TEXT,
  cree      TEXT NOT NULL,
  maj       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projets_client ON projets(client_id);

-- Demandes du client dans un projet.
-- statut ∈ nouveau|lu|en_cours|repondu|traite|abandonne|partiel
-- tarif  ∈ forfait|extra|offert|devis
CREATE TABLE IF NOT EXISTS demandes (
  id        TEXT PRIMARY KEY,
  projet_id TEXT NOT NULL,
  n         INTEGER,
  groupe    TEXT,
  titre     TEXT NOT NULL,
  qui       TEXT,
  date_txt  TEXT,
  statut    TEXT NOT NULL DEFAULT 'nouveau',
  tarif     TEXT NOT NULL DEFAULT 'forfait',
  livre     TEXT,
  reste     TEXT,
  solution  TEXT,
  motif     TEXT,
  note      TEXT,                          -- notes libres de l'admin (cumulées)
  encore    INTEGER NOT NULL DEFAULT 0,    -- nombre de « ça ne marche toujours pas »
  encore_le TEXT,                          -- date du dernier signalement
  cree      TEXT NOT NULL,
  maj       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_demandes_projet ON demandes(projet_id);
CREATE INDEX IF NOT EXISTS idx_demandes_statut ON demandes(statut);
CREATE INDEX IF NOT EXISTS idx_demandes_cree   ON demandes(cree);

-- Événements (frise chronologique d'un projet).
-- type ∈ echange|livrable|site|decision|facture
CREATE TABLE IF NOT EXISTS evenements (
  id        TEXT PRIMARY KEY,
  projet_id TEXT NOT NULL,
  date      TEXT,
  type      TEXT NOT NULL DEFAULT 'echange',
  titre     TEXT NOT NULL,
  detail    TEXT
);
CREATE INDEX IF NOT EXISTS idx_evenements_projet ON evenements(projet_id);
CREATE INDEX IF NOT EXISTS idx_evenements_date   ON evenements(date);

-- Conversations (une par canal et par projet : Mail, WhatsApp, SMS, Téléphone, Sur place…).
CREATE TABLE IF NOT EXISTS conversations (
  id           TEXT PRIMARY KEY,
  projet_id    TEXT NOT NULL,
  canal        TEXT NOT NULL,
  titre        TEXT,
  participants TEXT,
  maj          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_projet ON conversations(projet_id);

-- Messages d'une conversation, rattachés facultativement à une demande.
CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  demande_id      TEXT,
  de              TEXT NOT NULL,
  date            TEXT NOT NULL,
  texte           TEXT NOT NULL,
  piece           TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_demande      ON messages(demande_id);

-- Fichiers : métadonnées seulement (le contenu reste sur Cloudflare Pages / OneDrive / lien).
CREATE TABLE IF NOT EXISTS fichiers (
  id        TEXT PRIMARY KEY,
  projet_id TEXT NOT NULL,
  nom       TEXT NOT NULL,
  type      TEXT,
  taille    INTEGER,
  url       TEXT,
  note      TEXT,
  cree      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fichiers_projet ON fichiers(projet_id);

-- Formulaire de contact public. statut ∈ nouveau|lu|repondu|archive
CREATE TABLE IF NOT EXISTS contacts (
  id      TEXT PRIMARY KEY,
  nom     TEXT NOT NULL,
  email   TEXT NOT NULL,
  tel     TEXT,
  sujet   TEXT,
  message TEXT NOT NULL,
  formule TEXT,
  creneau TEXT,
  statut  TEXT NOT NULL DEFAULT 'nouveau',
  ip_hash TEXT,
  cree    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contacts_statut ON contacts(statut);
CREATE INDEX IF NOT EXISTS idx_contacts_cree   ON contacts(cree);

-- Rendez-vous : créneaux proposés / confirmés. statut ∈ propose|confirme|annule
CREATE TABLE IF NOT EXISTS rdv (
  id         TEXT PRIMARY KEY,
  contact_id TEXT,
  debut      TEXT NOT NULL,
  fin        TEXT NOT NULL,
  statut     TEXT NOT NULL DEFAULT 'propose',
  note       TEXT
);
CREATE INDEX IF NOT EXISTS idx_rdv_debut  ON rdv(debut);
CREATE INDEX IF NOT EXISTS idx_rdv_statut ON rdv(statut);

-- Factures. statut ∈ brouillon|envoyee|payee|annulee
-- Numérotation continue BS-AAAA-NNN attribuée à l'émission, jamais réutilisée.
-- Extensions du contrat (nullables) : `type` ∈ facture|avoir ; pour un avoir, `ref` = identifiant
-- et `reference` = numéro de la facture d'origine ; `objet` = objet libre ; `paye_le` = date de paiement.
-- lignes : JSON [{ref, designation, quantite, unite, prix, total}]
CREATE TABLE IF NOT EXISTS factures (
  id        TEXT PRIMARY KEY,
  numero    TEXT UNIQUE,
  client_id TEXT NOT NULL,
  date      TEXT,
  echeance  TEXT,
  lignes    TEXT NOT NULL DEFAULT '[]',
  total_ht  REAL NOT NULL DEFAULT 0,
  tva       INTEGER NOT NULL DEFAULT 0,
  statut    TEXT NOT NULL DEFAULT 'brouillon',
  note      TEXT,
  type      TEXT NOT NULL DEFAULT 'facture',
  ref       TEXT,
  reference TEXT,
  objet     TEXT,
  paye_le   TEXT,
  cree      TEXT NOT NULL,
  maj       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_factures_client ON factures(client_id);
CREATE INDEX IF NOT EXISTS idx_factures_statut ON factures(statut);
CREATE INDEX IF NOT EXISTS idx_factures_cree   ON factures(cree);

-- Compteurs (numéros de facture par année : cle = 'facture:2026').
CREATE TABLE IF NOT EXISTS compteurs (
  cle    TEXT PRIMARY KEY,
  valeur INTEGER NOT NULL DEFAULT 0
);

-- Piste d'audit : une ligne par écriture. cible = 'table:id'.
CREATE TABLE IF NOT EXISTS journal (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  quand  TEXT NOT NULL,
  qui    TEXT NOT NULL,
  action TEXT NOT NULL,
  cible  TEXT
);
CREATE INDEX IF NOT EXISTS idx_journal_quand ON journal(quand);
