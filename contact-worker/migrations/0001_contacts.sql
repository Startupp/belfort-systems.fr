-- Base D1 « belfort_contact » : une ligne par demande reçue depuis le formulaire du site.
-- Appliquer avec : npx wrangler d1 migrations apply belfort_contact --remote
CREATE TABLE IF NOT EXISTS contacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  recu_le     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  nom         TEXT    NOT NULL,
  email       TEXT    NOT NULL,
  tel         TEXT,
  sujet       TEXT,
  formule     TEXT,
  message     TEXT    NOT NULL,
  creneau     TEXT,
  origine     TEXT,            -- en-tête Origin de la requête (site ou aperçu Pages)
  ip          TEXT,
  user_agent  TEXT,
  traite_le   TEXT              -- à remplir à la main quand la demande est traitée
);
CREATE INDEX IF NOT EXISTS contacts_recu_le ON contacts (recu_le DESC);
