# Dashboard Créateur

Page d'administration de TinKnight : modules de création, chantiers en cours, lots d'assets.

- `index.html` : la page. Elle ne contient aucune donnée.
- `dashboard.json` : tout ce qu'elle affiche. Elle le relit chaque minute.

Une fois le site publié, elle s'ouvre à l'adresse `/ASSETS - CONCEPTS - ARTS/07_outils/dashboard/`.

## Brancher un outil

Ajouter une entrée dans `modules` :

```json
{"id":"editeur-niveaux","nom":"Éditeur de niveaux","type":"éditeur","etat":"en ligne","note":"Cartes en tuiles","ordre":15,"url":"/ecorce/editeur.html"}
```

- `type` : éditeur, créateur, jeu, serveur ou lien (choisit l'icône).
- `etat` : en ligne, en chantier, prévu, en panne.
- `url` : adresse en https, ou chemin du site commençant par `/`, `./` ou `../`. Vide = pas de bouton Ouvrir.
- `ordre` : position dans la grille, du plus petit au plus grand.

## Mettre à jour un état

- `jeu` : `version`, `etape`, `serveurs`, `credits`, `dernier_lot`, chacun avec sa note facultative (`version_note`, etc.).
- `chantiers` : `titre`, `detail`, `etat` (à faire, en cours, à valider, validé, fait), `progression` de 0 à 100, `ordre`.
- `lots` : `nom`, `date` (AAAA-MM-JJ), `contenu`, `etat` (à valider, validé, dans le dépôt, refusé), `lien` de téléchargement.
- `mis_a_jour` : date affichée sous les modules.

Le fichier doit rester du JSON valide : une virgule en trop et la page affiche une erreur de lecture.
