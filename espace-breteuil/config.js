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
    { n: 1, nom: "Calendrier du Château", couleur: "#8A4C45", exemple: "exemple.ics" },
    { n: 2, nom: "Équipe du jour (accueil)", couleur: "#2F6B5A", exemple: "exemple-accueil.ics" },
  ],

  /* Connexion Microsoft. clientId VIDE = mode démo (aucune connexion possible).
   * clientId et tenantId ne sont pas des secrets (ils sont visibles dans toute appli SPA). */
  microsoft: {
    /* ================================================================================
     * 👉👉👉  DÉJÀ REMPLI (main) — À VÉRIFIER PAR DAMIEN — LA SEULE LIGNE À CHANGER POUR LE TEST RÉEL  👈👈👈
     *
     *  Où le trouver : entra.microsoft.com → Inscriptions d'applications → « Espace Breteuil »
     *                  → Vue d'ensemble → « ID d'application (client) » → icône Copier.
     *  Quoi coller   : ce code (36 caractères, forme xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
     *                  ENTRE LES GUILLEMETS ci-dessous. Exemple :
     *                      clientId: "1a2b3c4d-1234-5678-9abc-def012345678",
     *  À NE PAS coller : l'« ID d'objet », l'« ID de l'annuaire (locataire) », ni un secret.
     *  Ensuite        : bouton vert « Commit changes… » → « Commit changes ». Pages republie
     *                   en 1 minute environ. Ouvrir l'appli → Réglages → « Vérifier la connexion ».
     * ================================================================================ */
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

  /* Boîtes partagées (v5.5.1) : toujours rangées dans « Les adresses partagées » (écran « Qui fait
   * quoi », « L'équipe »), même si une licence leur est encore attribuée. Adresse complète ou
   * seulement la partie avant @. Ce sont des adresses de service, pas des adresses personnelles. */
  boitesPartagees: [
    "chanteclerc", "chanteclercdeveloppement", "escapegame", "hfb", "intendance", "jardins",
    "jecharrault", "klefur", "marketing", "newsletter", "travaux",
    "fetpdebreteuil@breteuil.fr", // « FetP » : adresse partagée de François et Pauline
  ],

  /* Comptes du prestataire informatique (v5.5.1) : montrés à part, dans « Prestataire informatique »,
   * au lieu de « Sans licence ». Adresse de connexion complète ou partie avant @.
   * 👉 À REMPLIR PAR DAMIEN avec l'adresse de son compte d'administration du Château, par exemple :
   *      prestataires: ["damien@breteuil02.onmicrosoft.com"],  */
  prestataires: [],

  /* Site web du Château (WordPress). La section « Site web » apparaît pour les administrateurs
   * généraux et pour les membres du groupe Microsoft 365 (ou de sécurité) nommé « groupe »
   * (nom affiché, sans tenir compte des majuscules). Aucune adresse personnelle ici. */
  siteWeb: { url: "https://www.breteuil.fr", admin: "https://www.breteuil.fr/wp-admin/", groupe: "Site web",
    /* v5.5.1 : false tant que l'équipe n'a pas de compte WordPress « éditeur » (accord de M. Defecques) :
     * encadré « 🔑 Accès au site à prévoir » en tête de chaque écran, boutons vers WordPress masqués
     * (la vérification des liens et les modes d'emploi restent). Passer à true quand l'accès est prêt. */
    accesPret: false },

  /* « Suivi informatique » (v5.2) : libellés de l'écran et emplacement des données dans le dossier
   * commun. Renommer ici suffit (interface, dossier SharePoint, fichier). « ancien » = emplacement
   * accepté en repli (anciennement « Pilotage/pilotage.json »). Aucune donnée du client ici. */
  suivi: { libelle: "Suivi informatique", tuile: "Ce que Damien a fait pour le Château",
    dossier: "Suivi informatique", fichier: "suivi.json", guides: "Guides", ancien: { dossier: "Pilotage", fichier: "pilotage.json" } },

};
