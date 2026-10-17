/* Espace Breteuil — configuration publique (AUCUN secret ici).
 *
 * Le dépôt est public : ne jamais écrire ici de mot de passe, d'adresse ICS secrète
 * ni d'adresse mail personnelle. Voir docs/ESPACE-BRETEUIL-CONNEXION.md.
 */
self.EB_CONFIG = {
  /* Worker belfort-api : relais des calendriers (adresses ICS = secrets du Worker). */
  api: "https://belfort-api.damien-belfort.workers.dev",

  /* Calendriers affichés, chacun avec sa couleur. n = numéro de la source côté Worker
   * (1 → secret BRETEUIL_ICS_URL, 2 → BRETEUIL_ICS_URL_2…). exemple = données fictives
   * montrées tant que la source n'est pas branchée. */
  calendriers: [
    { n: 1, nom: "Calendrier du Château", couleur: "#6B1524", exemple: "exemple.ics" },
    { n: 2, nom: "Équipe du jour (accueil)", couleur: "#2E5A8A", exemple: "exemple-accueil.ics" },
  ],

  /* Connexion Microsoft. clientId VIDE = mode démo (aucune connexion possible).
   * clientId et tenantId ne sont pas des secrets (ils sont visibles dans toute appli SPA). */
  microsoft: {
    clientId: "a60beae2-3bae-4f85-b729-8275b500ebae",
    tenantId: "breteuil02.onmicrosoft.com",
    // Vide = l'adresse de l'appli elle-même (à déclarer dans Entra, plateforme « SPA »).
    redirectUri: "",
    // Microsoft Graph (délégué) : l'appli agit uniquement avec les droits de la personne connectée.
    scopes: ["User.Read", "User.ReadBasic.All", "User.Read.All", "Directory.Read.All", "Files.ReadWrite.All", "Sites.ReadWrite.All"],
    // SharePoint (délégué) : nécessaire pour lire et changer les droits d'un dossier.
    sharepointScope: "https://breteuil02.sharepoint.com/AllSites.FullControl",
  },

  /* Le dossier commun : site SharePoint du Château, bibliothèque « Documents », dossier « Commun ». */
  sharepoint: {
    site: "https://breteuil02.sharepoint.com/sites/ChateaudeBreteuil",
    dossierCommun: "Commun",
  },

  /* Domaines de l'entreprise : toute personne sans adresse de ces domaines est « Externe ». */
  domainesInternes: ["breteuil.fr", "breteuil02.onmicrosoft.com"],

};
