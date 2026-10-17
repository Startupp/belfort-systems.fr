/* Espace Breteuil — configuration publique (aucun secret ici).
 *
 * api : adresse du Worker belfort-api (planning ICS).
 * microsoft : laisser clientId et tenantId VIDES = mode démo (aucune connexion).
 *   Une fois l'application inscrite dans Entra ID (voir docs/ESPACE-BRETEUIL.md),
 *   renseigner l'ID d'application (client) et l'ID de locataire (tenant) :
 *   ce ne sont pas des secrets. L'appli passe alors en LECTURE SEULE réelle. */
self.EB_CONFIG = {
  api: "https://belfort-api.damien-belfort.workers.dev",
  microsoft: {
    clientId: "",
    tenantId: "",
    // Vide = l'adresse de l'appli elle-même (doit être déclarée dans Entra, type SPA).
    redirectUri: "",
    scopes: ["User.Read", "User.ReadBasic.All", "User.Read.All", "Directory.Read.All", "GroupMember.Read.All"],
  },
};
