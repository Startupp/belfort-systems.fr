# Pack 9 · 8 octobre 2026 : 9 créatures animées et l'outil d'animation refait

Même chaîne que le pack 8 (`PASSATION.md` § 5) : image `gpt_image_2_5` 1:1, Tripo H3.1 (`face_limit` 30000), `blocbake.py` (1600 triangles, texture 512, rotation 270), `opt.mjs` (KEEP=1), puis **`07_outils/pipeline/animer.py`** pour les poses (mode d'emploi : `LISEZMOI_animer.md`, enchaînement : `creature.sh`).

## Créatures
`02_modeles_3d/creatures/m_<nom>.glb`, au format des 10 créatures du pack 3 : un maillage, texture JPEG 512 intégrée, 9 poses (morph targets), 5 animations `repos`, `marche`, `attaque`, `touche`, `mort`, famille dans `scene.extras`, plus grand côté = 1, base à y = 0, face vers +Z.

| Fichier | Monde | Rôle | Famille | Triangles | Poids | l × h × p |
|---|---|---|---|---:|---:|---|
| m_boule_magma | Braises | roule sur le joueur | boule | 1600 | 266 ko | 0.95 × 1.00 × 0.98 |
| m_phalene_cendre | Braises | vole | volant | 1600 | 260 ko | 1.00 × 0.65 × 0.38 |
| m_tortue_basalte | Braises | gardien | quadrupede | 1599 | 247 ko | 1.00 × 0.72 × 0.97 |
| m_yeti_neige | Givre | marcheur | bipede | 1599 | 268 ko | 1.00 × 0.92 × 0.60 |
| m_esprit_flocon | Givre | vole | flottant | 1600 | 266 ko | 0.92 × 1.00 × 0.45 |
| m_scarabee_glace | Givre | gardien | multipattes | 1600 | 267 ko | 1.00 × 0.68 × 0.95 |
| m_ronce_roulante | Abîme | roule sur le joueur | boule | 1599 | 259 ko | 1.00 × 0.94 × 1.00 |
| m_gardien_runique | Abîme | gardien | bipede | 1600 | 267 ko | 1.00 × 0.81 × 0.41 |
| m_libellule_marais | Marais | vole | volant | 1600 | 249 ko | 1.00 × 0.43 × 0.68 |

Planches : `_apercus/pack9_creatures.jpg` (les 9 au repos, dans l'ordre du tableau ; flèche jaune = +Z) et `_apercus/pack9_poses.jpg` (une ligne par créature : repos ×2, marche ×3, attaque élan puis frappe, touche, mort).

## L'outil d'animation
Le script qui fabriquait les poses des packs 2 et 3 n'était pas dans le dépôt : `animer.py` le remplace. Relevé fait sur les 10 créatures du pack 3 (structure, noms des poses, clés et durées des clips, ampleur des déplacements), puis l'outil a été rejoué sur leurs maillages pour caler ses ampleurs sur les leurs. Validé d'abord sur m_gardien_runique (planche des poses regardée), puis lancé sur les 8 autres. Contrôle imprimé à chaque pose : aucune déchirure, moins de 1 % de triangles retournés (sauf phalène, ci-dessous).

## Pour la session du jeu
- `node tools/modeles.mjs <dépôt> --creatures m_boule_magma,m_phalene_cendre,m_tortue_basalte,m_yeti_neige,m_esprit_flocon,m_scarabee_glace,m_ronce_roulante,m_gardien_runique,m_libellule_marais` (aucune n'est encore dans liste.json).
- Elles ne se montrent que si `MON` ou `MON_OWN` (src/e2_modeles.js) les nomment. Places proposées : roule (sorte 1) boule_magma, ronce_roulante ; vole (sorte 3) phalene_cendre, esprit_flocon, libellule_marais ; gardien (sorte 4) tortue_basalte, scarabee_glace, gardien_runique ; marcheur (sorte 0) yeti_neige.
- `boule` est une famille nouvelle : le jeu ne la prend ni pour un volant ni pour un multipattes, ce qui convient à une créature qui roule.
- Non vues dans le jeu, seulement sur les planches.

## Limites
- m_phalene_cendre : 1,1 % des triangles se replient près de l'attache des ailes dans les poses `bas` et `basV` (ailes relevées en V ; invisible sur la planche).
- m_esprit_flocon : la traîne de givre de l'image n'est presque pas passée dans le modèle.
- m_tortue_basalte : pattes courtes ; le bas de la carapace suit un peu les pattes à la marche.
- Volants et flottant : leur frappe descend (comme l'abeille du pack 3) ; le jeu les pose en hauteur.

## Crédits
Solde avant : 445,75. Après : 362,50. Dépensé : 83,25 (plafond du lot : 100).
- 9 images à 0,25 : 2,25. Aucune refaite. 5 envois refusés une première fois (limite de débit, 4 images à la fois au plus), non facturés, renvoyés.
- 9 conversions Tripo à 9 : 81. Aucune ratée, aucun remboursement, aucune reprise.

## Identifiants (job image -> job Tripo)
| Créature | Image | Conversion |
|---|---|---|
| m_boule_magma | dea005c3-9c13-4231-8088-d3e3df9cd373 | 988a0b23-f6c0-4165-86f0-180456e65cbf |
| m_phalene_cendre | 751e930f-a12f-4f9a-a330-96f17a6348fd | 72c84f9b-bc48-4064-9456-cb81448c8a39 |
| m_tortue_basalte | e6ee65f4-0bf4-4d50-9b1e-3d01af154ce3 | 5b956e93-f0b5-41d0-94ee-3804b39d917a |
| m_yeti_neige | 0d8e8967-d6c4-46f8-be26-5f8d74c92063 | 6083931e-3e3d-4a78-a4af-62b00b6ffcf6 |
| m_esprit_flocon | 182910b0-668d-4f28-b549-16b988404d9c | 8c6f02f5-7b58-47bf-928b-2d974e5b4eb8 |
| m_scarabee_glace | 36736a5f-b2bb-407f-bb4f-2c0c4361e952 | 306007a0-5ead-4c06-b15b-8d25ea36158e |
| m_ronce_roulante | 3f940acc-d13b-4498-80a2-a8a4868d7fbb | e9bb0f79-3659-4e90-9671-48cea78f50cd |
| m_gardien_runique | 7780354e-89df-48e7-bef2-19d8b8d0807b | cd8e3de1-3680-493b-8e5e-b960c70e4e9d |
| m_libellule_marais | b08290f3-9be5-4479-925f-56956ce627ce | 7343795d-307d-437c-9c5d-abf87cff95d7 |

Invites (1:1) : « Game creature model, a single small monster for a stylized mobile action RPG: <sujet>. <pose>. Three-quarter front view from slightly above, the whole creature centred with margin, facing the viewer. Stylized low-poly hand-painted 3D model look, chunky stocky proportions, saturated colours, original design. Plain flat light grey background, even light, no cast shadow, no text, only one creature. »
- Poses : bipède « Standing upright on two short sturdy legs set apart, both arms held out away from the body, clear gaps between the arms, the legs and the body » ; volant « Hovering in flight with its four wings spread wide open and flat to the sides, the wings clearly separated from the body, nothing below it » ; quadrupède « Standing on four short thick legs, all four legs clearly visible and apart » ; multipattes « Standing on six short legs clearly visible and spread out from under the shell, head forward » ; flottant « Floating in the air, no legs » ; boule « A nearly spherical ball shape, no arms and no legs ».
- Sujets : basalt boulder cracked with glowing orange lava, small grumpy face ; ash moth, plump fuzzy body, feathery antennae, wings edged with glowing embers ; stocky turtle, domed shell of basalt plates with glowing lava cracks ; round chubby snowball yeti, white shaggy fur, pale icy blue horns ; six-branched chunky ice snowflake with a small face and a wispy frost trail ; beetle with a carapace of faceted pale blue ice crystals ; ball of tangled purple thorny brambles with a glowing magenta heart ; stocky indigo stone sentinel with glowing violet runes ; moss-green swamp dragonfly, big amber eyes, pale milky veined wings.

## Refaire
`bash installer.sh`, puis `npm i three@0.160.0` et `rm -rf node_modules/ndarray-pixels/node_modules/sharp` (planches), puis `bash creature.sh m_<nom> <adresse_glb_tripo> <famille>`.
