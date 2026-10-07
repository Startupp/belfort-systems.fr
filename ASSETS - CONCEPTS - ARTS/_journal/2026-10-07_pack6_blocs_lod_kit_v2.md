# Pack 6 · 7 octobre 2026 : niveaux de détail des blocs, kit d'interface v2

## Blocs : deux versions allégées de chacune des 36 pièces
`02_modeles_3d/blocs/<zone>/lod/<nom>_lod1.glb` et `<nom>_lod2.glb`. Même emprise, même origine, même orientation que l'original : le jeu peut échanger les modèles sans rien déplacer.

| Niveau | Fichier | Triangles | Texture | Poids |
|---|---|---|---|---|
| Élevé | `<nom>.glb` (dossier parent) | ~500 | 256 px | 22 à 38 ko |
| Moyen | `<nom>_lod1.glb` | ~150 | 128 px | ~10 ko |
| Bas | `<nom>_lod2.glb` | 12 pour sols et murs (une boîte), ~60 pour piliers, ornements et décors | 128 px | ~6 ko |

En niveau bas, le relief des sols et des murs est entièrement peint dans la texture.
Refaire ou compléter : `07_outils/pipeline/` (voir `faire_lod.sh` dans ce journal si besoin : blocbake avec 150 puis 12 triangles).

## Kit d'interface v2
`05_interface/kit_v2/` : voir son LISEZMOI.
