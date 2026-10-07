# Pack 5 · 7 octobre 2026

## Blocs 3D Givre et Abîmes (14 pièces)
`02_modeles_3d/blocs/<zone>/b_<zone>_<pièce>.glb` : sol_1, sol_2, mur_1, mur_2, mur_3, pilier, ornement_mur.
Même format que le Pack 4 : emprise 1×1, origine au centre du sol, environ 500 triangles, texture 256 px intégrée, 22 à 37 ko.
Les piliers ont une base 1×1 et sont hauts (Givre 2,7 ; Abîmes 3,25) : à réduire dans le jeu si besoin.

## Coffres (3)
`02_modeles_3d/decors/coffres/d_coffre_<commun|rare|legendaire>.glb`, environ 1000 triangles, 135 à 157 ko, texture 512.
Deux nœuds : `coffre` (la caisse) et son enfant `couvercle`, dont l'origine est sur la charnière. Face avant vers +Z.
Clip `ouvrir` (0,62 s) : le couvercle bascule vers l'arrière avec un petit rebond. Sans le clip, il suffit de tourner `couvercle` autour de X jusqu'à -112°.
Un second matériau `tresor` (doré, sans texture) ferme l'intérieur de la caisse.

Aperçus dans `_apercus/pack5_*.jpg`.
