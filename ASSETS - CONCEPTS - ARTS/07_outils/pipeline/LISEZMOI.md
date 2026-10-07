# Fabrication des modèles

Scripts utilisés pour passer d'un modèle brut (SAM 3D, Tripo) au format du jeu.

```bash
bash installer.sh                      # une fois : dépendances node et python
bash bloc.sh b_givre_mur_1 500 bloc    # raw/b_givre_mur_1.glb -> out/b_givre_mur_1.glb
bash bloc.sh b_givre_ornement_mur 500 objet
```

- `blocbake.py` : soude le maillage, le réduit au nombre de triangles demandé, refait le dépliage UV et recuit la texture depuis le modèle d'origine. Mode `bloc` : emprise au sol exacte 1×1, faces alignées sur la grille. Mode `objet` : plus grande dimension ramenée à 1. Dernier argument facultatif : rotation en degrés (270 pour les personnages Tripo).
- `opt.mjs` : un maillage, un matériau, une texture JPEG intégrée, normales recalculées, base au sol.
- `bloc.sh` : enchaîne les deux.

Résultat type : 500 triangles, texture 256 px, 22 à 38 ko par bloc.
