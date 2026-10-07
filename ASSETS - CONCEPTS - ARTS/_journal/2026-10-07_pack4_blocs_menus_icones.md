# Pack 4 · 7 octobre 2026

## Blocs 3D (21 pièces, 3 zones)
`02_modeles_3d/blocs/<zone>/b_<zone>_<pièce>.glb` : sol_1, sol_2, mur_1, mur_2, mur_3, pilier, ornement_mur.
Emprise au sol 1×1, origine au centre du sol, environ 500 triangles, une texture 256 px intégrée, 22 à 38 ko pièce.
Les murs font environ 1 de haut, les sols 0,3 à 0,45, les piliers 1,5 à 2. Les ornements se posent contre un mur.
Mycélium : `b_mycelium_deco_champignon` remplace sol_1 (la conversion a donné un champignon, gardé comme décor).
Fabrication : image de concept, conversion 3D (SAM 3D, Tripo pour les ratés), réduction à 500 triangles, texture recuite depuis le modèle d'origine.

## Chevalier champignon
`01_concepts/chevaliers/` et `02_modeles_3d/chevaliers/champignon/` : modèle statique 6000 triangles pour juger l'allure. Squelette et animations dans le lot suivant.

## Artworks de menu (10)
`05_interface/menus/menu_<zone>.jpg`, 2688×1520, une zone calme laissée pour les boutons. menu_camp_titre a le ciel libre pour le titre.

## Logos
`05_interface/logos/` : logo avec le nom, emblème sans texte, icône d'application en 1024, 512 et 192.

## Icônes de jeu (32)
`05_interface/icones_jeu/k_<nom>.png`, 256 px, fond transparent. Planches d'origine dans `_planches/`.
