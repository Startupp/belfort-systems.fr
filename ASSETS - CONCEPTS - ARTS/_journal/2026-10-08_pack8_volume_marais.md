# Pack 8 · 8 octobre 2026 : kit de volume complété (14 pièces), textures Marais

Recette et contexte : `PASSATION.md` (§ 5). Ce lot complète le kit de volume des six premiers mondes et ajoute les textures du Marais.

## Kit de volume (14 pièces)
`02_modeles_3d/decors/<zone>/volume/d_<zone>_<pièce>.glb`, même format que les 16 pièces du pack 7 : 1 200 triangles, un maillage, un matériau, texture JPEG 512 intégrée, plus grand côté = 1, base à y = 0, face avant vers +Z.
Chaîne : image `gpt_image_2_5` 1:1 (invites de `invites_pack7.py`, sans changement), Tripo H3.1 (`face_limit` 30000), `kit.sh` rotation 270.

| Pièce | Triangles | Poids | l × h × p |
|---|---:|---:|---|
| d_abimes_massif | 1200 | 84 ko | 0.98 × 0.84 × 0.90 |
| d_abimes_cime | 1200 | 89 ko | 0.98 × 0.43 × 0.71 |
| d_abimes_pied | 1200 | 88 ko | 0.99 × 0.33 × 0.73 |
| d_abimes_butte | 1200 | 80 ko | 1.00 × 0.19 × 0.89 |
| d_abimes_repere | 1199 | 102 ko | 0.89 × 0.99 × 0.45 |
| d_marais_massif | 1200 | 90 ko | 0.98 × 0.86 × 0.92 |
| d_marais_cime | 1200 | 99 ko | 0.98 × 0.63 × 0.67 |
| d_marais_pied | 1200 | 101 ko | 0.99 × 0.45 × 0.69 |
| d_marais_butte | 1200 | 92 ko | 0.97 × 0.21 × 0.94 |
| d_marais_repere | 1200 | 95 ko | 0.93 × 1.00 × 0.86 |
| d_racines_pied | 1200 | 91 ko | 1.00 × 0.39 × 0.97 |
| d_mycelium_pied | 1200 | 82 ko | 1.00 × 0.31 × 0.73 |
| d_braises_butte | 1200 | 68 ko | 1.00 × 0.16 × 0.99 |
| d_givre_butte | 1200 | 62 ko | 1.00 × 0.16 × 0.93 |

Planche : `_apercus/pack8_volume.jpg` (flèche jaune = +Z, vers la caméra du jeu).
Le kit des six premiers mondes est maintenant complet : 5 pièces pour Racines, Mycélium, Braises, Givre, Abîmes et Marais (30 pièces).

### Emprises au format de `volKit()` (src/r_volume.js du jeu)
Mesurées comme le tableau existant : [largeur, hauteur, profondeur, portée tous les 30° depuis le milieu de la boîte], plus grand côté = 1. Contrôle : la même mesure redonne exactement l'entrée `racines.butte` du jeu.
```
racines:  pied:   [1, .39, .97, [.5, .46, .45, .48, .44, .47, .5, .55, .48, .48, .44, .49]]
mycelium: pied:   [1, .31, .73, [.5, .47, .41, .37, .38, .41, .5, .51, .44, .37, .41, .43]]
braises:  butte:  [1, .15, .99, [.5, .51, .51, .49, .5, .49, .5, .47, .49, .49, .5, .53]]
givre:    butte:  [1, .16, .93, [.5, .48, .46, .47, .48, .52, .5, .49, .48, .47, .47, .5]]
abimes:   massif: [1, .85, .92, [.5, .48, .46, .46, .44, .47, .5, .47, .45, .46, .44, .47]]
          cime:   [1, .44, .72, [.5, .55, .48, .36, .46, .48, .5, .56, .49, .36, .44, .48]]
          pied:   [1, .34, .73, [.5, .52, .44, .37, .39, .42, .5, .57, .49, .37, .38, .45]]
          butte:  [1, .19, .89, [.5, .51, .46, .45, .46, .45, .5, .46, .43, .45, .47, .49]]
          repere: [.91, 1, .46, [.45, .4, .33, .23, .33, .43, .45, .39, .34, .23, .37, .45]]
marais:   massif: [1, .87, .93, [.5, .54, .48, .47, .51, .51, .5, .49, .48, .47, .47, .49]]
          cime:   [1, .64, .69, [.5, .5, .44, .34, .47, .54, .5, .51, .46, .34, .49, .54]]
          pied:   [1, .46, .7, [.5, .4, .34, .35, .42, .49, .5, .4, .33, .35, .43, .52]]
          butte:  [1, .22, .97, [.5, .51, .5, .48, .45, .48, .5, .48, .46, .48, .49, .48]]
          repere: [.93, 1, .86, [.46, .41, .46, .43, .41, .44, .46, .44, .45, .43, .42, .47]]
```

## Textures Marais
`03_textures/marais/marais_<sorte>.png` et `.jpg`, 512 × 512, RGB, raccordables bord à bord : le même jeu de six que Racines (sol_naturel, sol_chemin, sol_dalles, mur, mur_habille, dessus), JPEG qualité 90 comme les autres zones.
Direction : boue sombre et moussue, racines de saule, roseaux et massettes, nénuphars roses, mousse pendante (illustration `i_marais_v2.jpg`).
Fabrication : image `gpt_image_2_5` 1:1 (1024 px), puis `07_outils/pipeline/raccord.py` : la bande au-delà du bord droit (puis bas) est recollée sur le début de l'image le long du chemin où les deux versions se ressemblent le plus (fondu de 5 px), puis réduction à 512 px. Écart mesuré entre bords opposés : du même ordre que entre deux colonnes voisines à l'intérieur.
Planche : `_apercus/pack8_textures_marais.jpg` (chaque texture répétée 2 × 2 : un raccord raté se verrait en croix au milieu).

## Limites (à l'attention de la session du jeu)
- `tools/modeles.mjs --textures` ne lit les textures v2 (`03_textures/<zone>/<zone>_<sorte>.png` -> `t2_<zone>_<sorte>.jpg`) que pour racines, mycelium, braises, givre, abimes (liste écrite dans le code) : les fichiers `marais` sont au bon endroit mais ne seront pas lus tant que la liste n'est pas étendue.
- `--volume` lit tous les dossiers `decors/<zone>/volume/` : les 14 pièces seront prises. En revanche `volKit()` n'a pas encore d'entrée pour elles (emprises ci-dessus), `ZONES` (a_core.js) ne connaît pas `marais` (le Marais emprunte le kit d'un autre monde par `kitOf`), et `tests/volume.py` attend exactement 16 pièces pour les quatre premières zones : il en trouvera 20.
- Pièces et textures non vues dans le jeu (seulement sur les planches).

## Crédits
Solde avant : 575,75. Après : 445,75. Dépensé : 130.
- 16 images à 0,25 (10 pièces, 6 textures) : 4. Aucune image refaite.
- 14 conversions Tripo à 9 : 126. 4 conversions ont échoué au premier essai (braises_butte, givre_butte, abimes_massif, abimes_butte), remboursées par Higgsfield ; la nouvelle tentative a réussi pour les quatre.

## Identifiants (job image -> job Tripo retenu)
| Pièce | Image | Conversion |
|---|---|---|
| d_racines_pied | ed55855a-60e4-4072-815a-c21421972234 (pack 7) | d21f0b58-c82f-43d2-b12d-5eea403df5f2 |
| d_mycelium_pied | 60097c04-20a8-4070-89a1-1240b540f136 (pack 7) | fa0ec1bb-f323-4c1a-b626-424be5b8cd17 |
| d_braises_butte | c1caf0d0-8fa5-485a-83ea-39d62ef455dc (pack 7) | 504752b4-52b8-40e9-9613-2fe8ad2a8724 |
| d_givre_butte | 4e74a214-4b05-4ff8-9f0e-11a7973d134c (pack 7) | dbd500fb-f9aa-4ea1-8a6d-d8ebbbfe0320 |
| d_abimes_massif | 311dd6b4-7232-4136-b260-9b962bad3265 | e1ff4f75-e8f3-48b5-b5d6-d6c719cb2e3e |
| d_abimes_cime | 4147f2e7-e5a6-41f3-b067-89711f1abd49 | ebc49ec1-af3d-433e-b8fc-e8f7083f1b53 |
| d_abimes_pied | 5b11d17f-67af-4c21-ad83-4cef24d5b58c | 149d6f3b-a6c6-49e9-a23f-10f24d533341 |
| d_abimes_butte | d7bc613c-293f-4f71-9f56-e213eee71d69 | 57fe999d-8acf-4aed-8fa2-2d27a2576048 |
| d_abimes_repere | 44254a42-831a-445b-8d33-e086b4267e64 | dfd91a55-491e-474f-8098-96664044f4de |
| d_marais_massif | 0f704249-c7fe-4604-a920-d92c70423f40 | a852dd6e-0585-4691-8d74-b45b9f438838 |
| d_marais_cime | 01819cf0-9230-470f-b9f8-1caf87c7d394 | 2b23640d-4158-4c7b-bf35-7d1c1e5a27aa |
| d_marais_pied | 72122686-8c32-4453-b4cb-d3353c260580 | 5bef752a-ad75-4c83-a295-8e1c16945324 |
| d_marais_butte | 8b6c5311-83f2-4fd9-95c0-1ec3c764d592 | 4f657b4f-acfd-49b3-b1c7-dde2f89f92d4 |
| d_marais_repere | 8aa4ec4f-d1c8-4f85-ba82-a8f3e000517a | 054af9ec-1126-404c-9092-5deb1c20997b |

Textures (job image) : sol_naturel 8210665c-b93f-472c-bac7-329feecf16cf · sol_chemin f33653e2-5e90-4334-843b-7c8040e5d8a5 · sol_dalles df1bb525-b5b2-4867-a309-ddad6036cd50 · mur 470394c1-7391-4317-bc94-e62d8b61402d · mur_habille beb1d13b-196e-450f-92a7-6e5c2e78ba06 · dessus 073a88e7-3018-4f71-baa6-9f98019fccd7.

Invites des textures (format 1:1). Début commun : « Seamless tileable ground texture for a stylized video game, top-down orthographic view, filling the whole square edge to edge: » (murs : « wall texture ... flat front orthographic view of ... »). Fin commune : « Hand-painted stylized texture, chunky shapes, rich colours, flat even lighting, no perspective, no horizon, no border, no text. » Sujets :
- sol_naturel : dark wet mossy mud with irregular patches of bright green moss, short grass, tiny reed shoots, fallen willow leaves, two small dark puddles with tiny lily pads, a few tiny pink flowers
- sol_chemin : a trodden swamp path of packed dark brown wet mud, small pebbles, thin twisted willow roots, small puddles, fallen willow leaves, sparse moss tufts
- sol_dalles : old irregular flat stone slabs half sunk in dark swamp mud, moss in the joints, small puddles, tiny reed shoots
- mur : a vertical swamp earth cliff face, layers of dark peat and wet mud, twisted willow roots, embedded dark stones, thin hanging moss
- mur_habille : a vertical wall of rough dark wet stones stacked like old masonry, curtains of hanging moss, small ferns and tiny pink flowers in the joints, thin willow roots
- dessus : dense swamp vegetation seen from above, thick moss, reed and cattail leaves, lily pads with small pink water lilies in tiny dark pools, willow leaves

## Refaire
- Pièces : `bash installer.sh` (puis `rm -rf node_modules/ndarray-pixels/node_modules/sharp` après tout autre `npm i`, sinon `opt.mjs` échoue), `bash kit.sh liste.txt` (ligne `nom adresse_glb 270`).
- Planche : `python3 -m http.server 8123` (avec `npm i three@0.160.0`), puis `NODE_PATH=$(npm root -g) node shot.cjs sortie.jpg 5 260 30 2.9 out/*.glb`.
- Textures : `python3 raccord.py image_1024.png marais_<sorte> 512 0.14`.
