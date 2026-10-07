# TinKnight · passation des travaux d'assets

Rédigé le 7 octobre 2026 pour Fable, qui reprend la production des assets. Tout ce qui est décrit ici est vérifiable dans ce dépôt ; ce qui n'a pas été testé est signalé comme tel.

## 1. Le projet en trois lignes

- TinKnight : RPG mobile en Three.js r128, petit chevalier low-poly, vue de dessus inclinée. Le jeu est dans `ecorce/` (un seul `index.html`) et il est tenu par une autre session Claude. **Ne pas modifier `ecorce/`** : la production d'assets livre dans `ASSETS - CONCEPTS - ARTS/`, l'autre session pioche dedans.
- Inspiré de Spiral Knights, mais tous les designs doivent rester originaux.
- But esthétique fixé par Damien : un jeu « au plus proche des concepts arts ».

## 2. Consignes de Damien

- Répondre en français, court, en tableaux ou listes. Avancer vite, relire avant de livrer.
- Livrer par lots nommés clairement, 50 à 80 Mo et moins de 90 fichiers par lot.
- Ne jamais écraser l'existant : une nouvelle version se pose à côté avec un suffixe (`_v2`).
- Les détails s'ajustent plus tard ; priorité aux blocs, murs et volumes de niveau.
- En cas de doute sur un rendu : le mettre de côté et lui demander, il valide à la volée.
- Zone « Corail » refusée (sol entièrement en eau). Zones validées en plus des cinq du jeu : Canopée, Mine, Ruche, Marais.
- Crédits Higgsfield à dépenser « à bon escient » : il en reste environ 570.
- Le projet HACCP (`haccp/`) est un autre projet. Une branche `projet-haccp` existe (copie complète de `main`). `haccp/` n'a pas été retiré de `main` car cela couperait l'application en ligne : décision en attente.

## 3. Ce qui est dans le dépôt

Tout est sous `ASSETS - CONCEPTS - ARTS/` ; `INDEX.md` est régénéré à chaque import.

| Dossier | Contenu |
|---|---|
| `01_concepts/` | Planches de concept (séries 1 et 3, décors pack 1, chevalier champignon) |
| `02_modeles_3d/chevaliers/` | Chevaliers animés du pack 3, chevalier champignon |
| `02_modeles_3d/creatures/` | 26 monstres (packs 1 à 3), animés par poses |
| `02_modeles_3d/decors/<zone>/` | Décors par zone ; `decors/coffres/` : 3 coffres avec clip `ouvrir` |
| `02_modeles_3d/blocs/<zone>/` | 36 blocs cubiques (5 zones) et `lod/` : deux niveaux allégés par bloc |
| `03_textures/`, `04_herbes/` | Textures de zone, herbes en plans croisés |
| `05_interface/` | Kit d'interface et `kit_v2/`, menus (`menus/jeu_v2/` = V2 des fonds du jeu), logos, 32 icônes |
| `07_outils/` | `dashboard/`, `attaques_monstres/`, `pipeline/` (scripts de fabrication), `validations/` |
| `_journal/` | Une note par lot : contenu, format, limites |

### Comment un lot entre dans le dépôt

1. Fabriquer les fichiers dans le bac à sable Higgsfield, rangés sous `ASSETS - CONCEPTS - ARTS/...`, et en faire un zip.
2. `media_upload` (nom en `.zip`), `curl -X PUT` du zip depuis le bac à sable, `media_confirm` type `file`.
3. Ajouter la ligne `<adresse du zip> <nom du lot>` à `.github/reorg/lots.txt` sur `main`.
4. L'action `.github/workflows/assets-tinknight.yml` télécharge le zip, copie sans jamais écraser, régénère l'index et pousse. Compter une minute, puis vérifier le commit `github-actions[bot]`.

Pièges rencontrés :
- Le connecteur GitHub ne pousse que du texte et ne peut pas écrire dans `.github/workflows/`.
- Les résultats Higgsfield (`d8j0ntlcm91z4.cloudfront.net`) ne se téléchargent que depuis le bac à sable Higgsfield. Aucun octet ne passe d'un environnement à l'autre : tout binaire doit être produit là-bas.
- Le bac à sable est effacé après environ 15 minutes sans tâche de fond. Le relancer : `curl` des scripts depuis `07_outils/pipeline/` puis `bash installer.sh`. Garder une tâche `sleep 880` en fond.
- `dashboard.json` est maintenant modifié par l'autre session : le lire avant d'y écrire.

## 4. Limites du moteur (lues dans `ecorce/index.html`)

C'est le point qui explique le retour de Damien sur les blocs « trop cubiques qui ne s'emboîtent pas ».

- La carte est une grille binaire sol / roche. **Les sols et les murs sont dessinés par le moteur** (quads texturés, fusionnés par blocs de 24 cases). Il n'existe aucun système de blocs 3D.
- Hauteurs de mur : 0,34 (murs au sud d'un sol), 1,3 à 2,05 en automatique, ou 0,34 / 1,3 / 2,2 / 3,2 dans l'éditeur.
- Les GLB ne servent que de décors : au sol (`DECOR[zone]`, rotation libre, collision en cercle) ou posés sur le dessus des murs du fond (`PROPS[zone]`, 3 modèles par zone).
- Un décor est recentré et **ramené à 1 dans sa plus grande dimension**, puis multiplié par sa taille en cases. Seul le premier maillage et sa texture de couleur sont lus ; transformations de nœuds, second matériau et animations sont ignorés (un coffre articulé demande donc du code).
- Nommage obligatoire `d_<zone>_<nom>` et présence dans `ecorce/modeles/liste.json`. Le préfixe `b_` n'est pas reconnu.
- Caméra fixe : inclinaison 56°, distance 20, jamais de rotation en jeu. On ne voit que les dessus et les faces sud. Brouillard au-delà de 10 cases autour du joueur.
- Matériau toon à 4 paliers ; les modèles reçoivent 30 % d'éclairage + 50 % de leur texture brute.
- Un décor = un appel de dessin, sans fusion : rester raisonnable sur le nombre par salle.
- Pas de réglage de niveau de détail géométrique (les `lod/` attendent du code côté jeu).

Conséquence : pour donner du volume, il ne faut pas remplacer les sols et murs par des cubes mais **habiller** ceux du moteur avec des pièces organiques. C'est l'objet du pack 7.

## 5. Pack 7 (en cours au moment de la passation)

Kit de volume par zone, cinq pièces nommées `d_<zone>_<pièce>` :

| Pièce | Rôle | Pose conseillée |
|---|---|---|
| `massif` | Masse de mur irrégulière | Dans les angles et devant les murs du fond, taille 1,2 à 1,6 |
| `cime` | Touffe qui déborde du haut d'un mur | Sur le dessus des murs du fond, taille 1,2 à 1,5 |
| `pied` | Tas bas au pied d'un mur | Contre la face sud d'un mur, taille 1,2 à 1,5 |
| `butte` | Relief bas et large | Au sol, taille 1,3 à 1,8 |
| `repere` | Pièce maîtresse de la zone | Une par salle, taille 2 |

16 pièces livrées. Format : 1200 triangles, texture 512, 55 à 105 ko, face avant vers +Z.

| Zone | massif | cime | pied | butte | repere |
|---|---|---|---|---|---|
| Racines | fait | fait | échec ×2 | fait | fait |
| Mycélium | fait | fait | échec ×2 | fait | fait |
| Braises | fait | fait | fait | échec | fait |
| Givre | fait | fait | fait | échec | fait |
| Abîmes, Canopée, Mine, Ruche, Marais | à faire | à faire | à faire | à faire | à faire |

Les images des pièces en échec existent déjà (identifiants dans le journal du pack 7) : il reste à les convertir avec Tripo.

### Recette qui marche

- Image : `gpt_image_2_5`, 1:1, un seul objet sur fond gris uni, vue trois-quarts. 4 images à la fois au maximum (0,25 crédit pièce). Les invites sont dans `07_outils/pipeline/invites_pack7.py`.
- Conversion : **Tripo** (`tripo_h3_1_image_to_3d`, `face_limit` 30000, 9 crédits) pour toute pièce composée. SAM 3D (1 crédit) n'isole qu'un sous-objet (un cristal, une lanterne) sur ces images ; il ne convient qu'aux formes simples (`butte` avec l'invite `mound`, seuil 0,2) et échoue une fois sur deux.
- Mise au format : `bash kit.sh liste.txt`, une ligne `nom adresse [rotation]`. Les sorties Tripo demandent une rotation de 270.
- Contrôle : `shot.cjs` (planche de vignettes) et `shotn.cjs` (mini-niveau, voir plus bas).

### Chevalier champignon

`02_modeles_3d/chevaliers/champignon/chevalier_champignon.glb` : 8000 triangles, 884 ko, texture 1024, squelette de 24 os aux mêmes noms que `chevalier.glb`, 14 clips.

- Les 9 clips du jeu (`repos marche course epee jumelles dague arbalete touche mort`) sont reportés depuis `chevalier.glb` os par os.
- 5 attaques nouvelles, sur place : `epee_triple`, `epee_double`, `epee_taille`, `jumelles_vrille`, `epee_lourde`.
- **Non testé dans le jeu.** Différences connues avec `chevalier.glb` : positions en flottants (pas de quantification), 8000 triangles au lieu de 6273. Les 5 attaques demandent du code côté jeu pour être jouées.
- Erreur à ne pas refaire : un premier squelette avait été demandé sur le modèle Tripo brut, qui est de profil. Le squelette était faux (40 crédits perdus). Toujours tourner le modèle face à +Z et le vérifier avant `3d_rigging` (8 crédits par clip).
- Le report d'animations (`chev2.py`) permet de donner ces 5 attaques aux autres chevaliers sans rien racheter : pas encore fait.

### Mini-niveaux

`_apercus/pack7_niveau_<zone>.jpg` : une salle par zone avec le kit posé, rendue par `niveau.html`, qui reproduit le dessin des sols et murs, le matériau toon, la caméra et le brouillard du jeu. C'est une **simulation**, en éclairage du camp (plus clair que les niveaux). Elle n'a pas été comparée à une capture du vrai jeu : le premier contrôle à faire est de demander une capture à Damien et de recaler la simulation.

## 6. Reste à faire, par priorité

1. Finir le kit de volume : pièces en échec des 4 premières zones, puis Abîmes et les 4 nouvelles zones (compter environ 30 crédits par zone).
2. Faire valider par Damien les mini-niveaux et le chevalier champignon dans le vrai jeu.
3. Fournir à l'autre session les entrées `DECOR` / `PROPS` et `liste.json` pour le kit (noms, tailles, rayons de collision).
4. Reporter les 5 attaques sur les trois autres chevaliers.
5. Textures de sol et de mur pour Canopée, Mine, Ruche, Marais (le moteur leur prête aujourd'hui celles d'autres zones).
6. Attaques des monstres : la bibliothèque est écrite (`07_outils/attaques_monstres/`), rien n'est codé.
7. Demandes anciennes non commencées : créateurs (personnage, armes, textures, monstres), éditeur d'animation par os, effets propres à chaque monstre.
8. Mettre à jour la liste `lots` de `07_outils/dashboard/dashboard.json` : les packs 4 à 7 y sont absents ou encore notés « à valider », alors qu'ils sont dans le dépôt.

## 7. Repères utiles

- Formats attendus par le jeu : chevalier < 1 Mo et 24 os ; créatures `m_<nom>` < 300 ko, texture 512, 5 clips par poses ; décors `d_<zone>_<nom>` < 200 ko et ≤ 4000 triangles ; noms en minuscules sans accent.
- Pages publiées : Dashboard Créateur (artifact `RDuib9rwA7HYBLZnE2qCqU`), Kit d'interface (`32Hr6YhR88AFGKLStNG43t`), Ambiances (`BoRzLWScCFm6d48zfKJEa5`), Sorts (`Cu3nkNbVkeaq1YTyti4wik`).
- La feuille de route et la fiche des formats du jeu sont dans un autre dépôt, `Startupp/tinknight` (branche `main-fuebt2`, fichiers `ROADMAP.md` et `FORMATS.md`), auquel la session d'assets n'avait pas accès.
- Les blocs cubiques des packs 4 à 6 restent dans le dépôt. Ils servent encore de piliers ou d'ornements, pas de sols ni de murs.
