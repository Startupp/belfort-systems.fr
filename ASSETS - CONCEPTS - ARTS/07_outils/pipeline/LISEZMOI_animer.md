# animer.py · poses et animations des créatures

Refait le 8 octobre 2026 (pack 9) : le script des packs 2 et 3 n'avait pas été rangé. Celui-ci écrit des fichiers de la même structure que les créatures du pack 3 (`m_renard_givre.glb`, `m_meduse_abime.glb`, `m_grenouille.glb`…), que `tools/modeles.mjs --creatures` lit sans changement.

## Usage
```bash
bash installer.sh            # une fois ; glb.py, blocbake.py et opt.mjs sont à côté
bash creature.sh m_<nom> <adresse_glb_tripo> <famille> [rotation=270] [triangles=1600] [options d'animer.py]
#   raw/ -> rb/ (blocbake : triangles, texture 512, rotation) -> st/ (opt.mjs : un maillage, JPEG) -> out/m_<nom>.glb (poses)
python3 animer.py st/m_<nom>.glb out/m_<nom>.glb <famille> [--yaw 0] [--force 1.0] [--jambes 0.38]   # les poses seules
```
- Familles : `bipede`, `quadrupede`, `multipattes`, `volant`, `flottant`, `rampant`, `sauteur`, `boule`.
- `--yaw` : tourne encore la créature (degrés) si la planche montre qu'elle ne regarde pas +Z.
- `--force` : multiplie toutes les poses (0,8 = plus sage).
- `--jambes` : hauteur des jambes, en part de la hauteur (0,42 bipède, 0,38 quadrupède, 0,32 multipattes par défaut).
- Pour chaque pose le script imprime : déplacement max et moyen, part de triangles retournés, étirement max, déchirure (écart entre sommets confondus : toujours 0). Il prévient au-delà de 1 % de triangles retournés.

## Le fichier produit (relevé sur les 10 créatures du pack 3)
| Élément | Valeur |
|---|---|
| Nœud, maillage | un nœud `monstre`, un maillage `geometry_0`, une primitive : POSITION, TEXCOORD_0, NORMAL, indices ; une texture JPEG 512 |
| Taille | plus grand côté = 1, centré en X et Z, base à y = 0, face vers +Z |
| Poses | 9 morph targets (POSITION seule), noms dans `mesh.extras.targetNames`, poids par défaut 0 |
| Famille | `scene.extras.famille` (le jeu : `volant`/`flottant` = vole, `multipattes` = charge sur ses pattes) |
| Animations | `repos`, `marche`, `attaque`, `touche`, `mort` : une piste `weights` sur le nœud 0, interpolation linéaire |
| Poids | 240 à 300 ko pour 1 450 à 1 700 triangles |

Clés communes (R = pose de base : aucune, `haut` pour volant, `g` pour flottant) :
| Clip | Durée | Clés |
|---|---|---|
| attaque | 0,70 s | R, `elan` à 0,22, `frappe` à 0,34 et 0,46, R à 0,70 (le jeu cale l'élan à 0,22 s, la frappe à 0,34 s) |
| touche | 0,30 s | R, `touche` à 0,08, R à 0,30 |
| mort | 0,80 s | R, `vacille` à 0,30, `aplati` à 0,80 (finit à plat) |

| Famille | Poses propres | repos | marche |
|---|---|---|---|
| bipede, quadrupede, multipattes | souffle, pasA, haut, pasB | 2 s : 0, souffle, 0 | 0,8 s : pasA, haut, pasB, haut, pasA |
| volant | haut, bas, hautV, basV | 0,44 s : haut, bas, haut (vol sur place) | 0,32 s : hautV, basV, hautV (penché vers l'avant) |
| flottant | g, d, gV, dV | 1,6 s : g, d, g | 0,7 s : gV, dV, gV |
| rampant | souffle, v0 à v3 (10 poses) | 2,2 s : 0, souffle, 0 | 1,2 s : v0, v1, v2, v3, v0 |
| sauteur | souffle, accroupi, saut, gonfle | 2,2 s : 0, souffle, gonfle, 0 | 0,6 s : accroupi, saut, 0, accroupi |
| boule (nouvelle) | souffle, gonfle, ecrase, haut | 2,2 s : 0, gonfle, souffle, 0 | 0,5 s : ecrase, haut, ecrase (le jeu fait rouler le corps) |

Ampleurs (plus grand côté = 1), calées sur le pack 3 en rejouant l'outil sur ses maillages : souffle 0,03 à 0,05 ; pas 0,12 à 0,15 ; élan 0,2 en moyenne (recul, tassé) ; frappe 0,4 à 0,45 (bond vers +Z) ; touche 0,2 (recul) ; vacille 0,2 (penche sur le côté) ; aplati 0,3 (écrasé au sol).

## Comment les poses sont faites
- Chaque pose ne dépend que de la position de repos du sommet (jamais de sa normale ni de son numéro) : les sommets confondus d'une couture bougent ensemble, la peau ne se déchire pas.
- Pattes : la bande basse (sous `--jambes`), côtés et avant/arrière lissés ; diagonale (quadrupède), trépied (multipattes), une jambe sur deux et bras à contre-temps (bipède).
- Ailes (volant) : attache là où l'épaisseur du corps chute (entre 0,06 et 0,2 du milieu), rotation autour de l'attache.
- Poses communes : bascules de 15 à 25°, échelles positives ; aucune ne retourne la créature.

## Limites
- Pas de squelette : une patte n'est reconnue que par sa hauteur ; le bas d'une carapace basse suit un peu les pattes.
- Ailes relevées en V (phalène) : environ 1 % des triangles se replient près de l'attache dans `bas`/`basV` (invisible sur la planche).
- Volant et flottant n'ont pas d'altitude : le jeu les pose en hauteur ; leur frappe descend comme celle de l'abeille du pack 3.

## Planches
```bash
npm i three@0.160.0 && rm -rf node_modules/ndarray-pixels/node_modules/sharp
python3 -m http.server 8123 &
M=out/m_<nom>.glb; NODE_PATH=$(npm root -g) node shot.cjs planche.jpg 9 160 30 2.9 $M@repos@0 $M@repos@1 $M@marche@0 $M@marche@0.2 $M@marche@0.4 $M@attaque@0.22 $M@attaque@0.34 $M@touche@0.08 $M@mort@0.8
```
`fichier@clip@temps` fige le clip à cet instant ; azimut 1 = vue de face ; flèche jaune = +Z.
