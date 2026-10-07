# Kit d'interface, ajouts v2

À charger après le kit d'origine (`../kit/`), qui n'est pas modifié.

```html
<link rel="stylesheet" href="tinyknight_ui.css">
<link rel="stylesheet" href="tinyknight_ui_v2.css">
<!-- coller aussi le contenu de tinyknight_icones_v2.svg en haut du body -->
```

- **Bulles de HUD** : `<button class="tk-fab"><svg class="tk-ic"><use href="#tk-quetes"/></svg><span class="tk-fab-pastille">3</span><span class="tk-fab-nom">Quêtes</span></button>`.
  Tailles `petit`, normal, `grand`. Variantes `plein`, `rare`, `epique`, `legende`, `verrou`, `alerte`. Recharge : `style="--tk-cd:.65"` (0 = prêt, 1 = vient d'être lancé).
  Groupes : `.tk-flotte` (flottement doux, ajouter `ligne` pour une rangée) et `.tk-eventail` (attaque + 3 satellites en arc).
- **Cadres** : `.tk-cadre` + `canopee`, `mine`, `ruche`, `marais`, `pierre`, `legende`.
- **Ornements** : `<hr class="tk-sep feuille|ambre|cristal|braise|spore|ronce">`, `.tk-titre-orne`, `.tk-ruban` (+ `sombre`), `.tk-medaillon` (+ `rare|epique|legende`), `.tk-coins`.
- **Icônes** (18) : frapper, esquive, potion, bouclier, cible, auto, boussole, discussion, emote, cloche, cadeau, trophee, amis, monture, sort_1 à sort_4.

Fichiers produits par `07_outils/pipeline/kit_v2.py`.
