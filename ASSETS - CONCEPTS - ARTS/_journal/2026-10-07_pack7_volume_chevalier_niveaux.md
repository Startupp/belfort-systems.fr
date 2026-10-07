# Pack 7 · 7 octobre 2026 : kit de volume, chevalier champignon animé, mini-niveaux

Contexte et mode d'emploi complets : `PASSATION.md` à la racine du dossier d'assets.

## Kit de volume (17 pièces, 4 zones)
`02_modeles_3d/decors/<zone>/volume/d_<zone>_<massif|cime|pied|butte|repere>.glb`, 1200 triangles, texture 512, 55 à 105 ko, face avant vers +Z.
Pièces manquantes, images déjà faites (identifiant du job image Higgsfield à convertir avec Tripo, rôle `image_references`) :
- d_racines_pied : ed55855a-60e4-4072-815a-c21421972234
- d_mycelium_pied : 60097c04-20a8-4070-89a1-1240b540f136
- d_braises_butte : c1caf0d0-8fa5-485a-83ea-39d62ef455dc
- d_givre_butte : 4e74a214-4b05-4ff8-9f0e-11a7973d134c
Zones non commencées : abimes, canopee, mine, ruche, marais (invites dans `07_outils/pipeline/invites_pack7.py`).

## Chevalier champignon
`02_modeles_3d/chevaliers/champignon/chevalier_champignon.glb` : 8000 triangles, 884 ko, 24 os, 14 clips (les 9 du jeu reportés depuis chevalier.glb + epee_triple, epee_double, epee_taille, jumelles_vrille, epee_lourde, sur place). Non testé dans le jeu.
Modèle de base face à +Z envoyé au squelettage : https://d2ol7oe51mr4n9.cloudfront.net/user_3F863pGpFwsL8Fl2ADzY5BHokwT/8b57738b-b422-4633-ba2d-ba650ed5257e.glb
Refaire : `python3 chev1b.py rig/n_triple.glb` puis `python3 chev2.py rig/n_triple.glb sortie.glb 0 clips.json`.

## Mini-niveaux
`_apercus/pack7_niveau_<zone>.jpg` : simulation du rendu du jeu (éclairage du camp), salle décrite dans `07_outils/pipeline/niveaux/<zone>.json`.
Refaire : serveur `python3 -m http.server 8123` dans le dossier de travail, puis `node shotn.cjs nv/<zone>.json sortie.jpg`.

## Scripts ajoutés dans 07_outils/pipeline
glb.py (lecture/écriture GLB), chev1b.py, chev2.py (assemblage et report d'animations), kit.sh, dl.sh, view.html + shot.cjs (planches), niveau.html + shotn.cjs + mkniv.py (mini-niveaux), invites_pack7.py.
