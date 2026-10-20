/* Raccourcis de la vue « Outils » du tableau de bord. Liste éditable : ajouter ou retirer une
   entrée ici suffit. Champs : nom, ligne (une phrase), url, lettre (icône texte, 1 à 2 caractères)
   hote (texte sous la ligne, à la place du nom de domaine) ou ico (clé d'une icône SVG définie dans admin.js : indy, cloud, github, actions, loupe, fiche,
   notion, linkedin, canva, malt, urssaf, inpi, kit). Tout s'ouvre dans un nouvel onglet. */
window.BS_OUTILS = [
  { nom: 'Indy', ligne: 'Facturation, URSSAF, comptabilité : tout se passe là-bas.', url: 'https://app.indy.fr', ico: 'indy' },
  { nom: 'Cloudflare', ligne: 'Pages, Workers, DNS, e-mails du domaine.', url: 'https://dash.cloudflare.com', ico: 'cloud' },
  { nom: 'GitHub du site', ligne: 'Dépôt belfort-systems.fr : fichiers, branches, PR.', url: 'https://github.com/Startupp/belfort-systems.fr', ico: 'github' },
  { nom: 'Actions du dépôt', ligne: 'Déploiements des Workers et journal des workflows.', url: 'https://github.com/Startupp/belfort-systems.fr/actions', ico: 'actions' },
  { nom: 'Google Search Console', ligne: 'Indexation et requêtes de recherche du site.', url: 'https://search.google.com/search-console?resource_id=sc-domain:belfort-systems.fr', ico: 'loupe' },
  { nom: 'Fiche Google Business', ligne: 'Fiche d’établissement, avis, horaires.', url: 'https://business.google.com', ico: 'fiche' },
  { nom: 'Notion', ligne: 'Notes, procédures, suivi des clients.', url: 'https://www.notion.so', ico: 'notion' },
  { nom: 'LinkedIn', ligne: 'Profil et publications professionnelles.', url: 'https://www.linkedin.com', ico: 'linkedin' },
  { nom: 'Canva', ligne: 'Visuels, cartes de visite, publications.', url: 'https://www.canva.com', ico: 'canva' },
  { nom: 'Malt', ligne: 'Profil indépendant et missions.', url: 'https://www.malt.fr', ico: 'malt' },
  { nom: 'URSSAF auto-entrepreneur', ligne: 'Déclarations et paiements des cotisations.', url: 'https://autoentrepreneur.urssaf.fr', ico: 'urssaf' },
  { nom: 'INPI', ligne: 'Formalités d’entreprise (guichet unique).', url: 'https://procedures.inpi.fr', ico: 'inpi' },
  { nom: 'Kit visibilité (plan 30 jours)', ligne: 'Le plan d’actions pour se faire connaître localement.', url: 'https://claude.ai/code/artifact/c329aa5d-8747-4950-af98-31cbefdd29f4', hote: 'document en ligne', ico: 'kit' }
];
