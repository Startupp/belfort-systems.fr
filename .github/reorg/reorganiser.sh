#!/usr/bin/env bash
# Range les livrables TinKnight deja presents a la racine du depot dans "ASSETS - CONCEPTS - ARTS".
# Ne touche ni au jeu (ecorce/) ni au site. Deplacements uniquement (git mv), doublons exacts retires.
set -euo pipefail
R="ASSETS - CONCEPTS - ARTS"
deplace() { # deplace <source> <destination sous R> : fichier ou dossier, fusionne si la destination existe
  local src="$1" dst="$R/$2"
  [ -e "$src" ] || { echo "absent : $src"; return 0; }
  if [ -d "$src" ]; then
    git ls-files -z -- "$src" | while IFS= read -r -d '' f; do
      local rel="${f#"$src"/}"; mkdir -p "$dst/$(dirname "$rel")"
      if [ -e "$dst/$rel" ]; then mkdir -p "$R/_alternatives/$(dirname "$2/$rel")"; git mv "$f" "$R/_alternatives/$2/$rel"; else git mv "$f" "$dst/$rel"; fi
    done
  else mkdir -p "$(dirname "$dst")"; git mv "$src" "$dst"; fi
}
# 1. doublons : zones/ a la racine reprend les modeles de TinyKnight_Zones_Promo/zones/
if [ -d zones ] && [ -d TinyKnight_Zones_Promo/zones ]; then
  git ls-files -z -- zones | while IFS= read -r -d '' f; do
    twin="TinyKnight_Zones_Promo/$f"
    if [ -f "$twin" ] && cmp -s "$f" "$twin"; then git rm -q "$f"; echo "doublon retire : $f"; fi
  done
fi
deplace zones "_alternatives/zones_racine"
# 2. decors, monstres de zone, concepts et illustrations du pack Zones
for z in racines mycelium braises givre abimes; do
  d="TinyKnight_Zones_Promo/zones/$z"; [ -d "$d" ] || continue
  for f in "$d"/*_monstre_*.glb; do [ -e "$f" ] && deplace "$f" "02_modeles_3d/creatures/pack1_statiques/$(basename "$f")"; done
  for f in "$d"/illustration_*; do [ -e "$f" ] && deplace "$f" "05_interface/illustrations_zones/$(basename "$f")"; done
  deplace "$d/concepts" "01_concepts/decors_pack1/$z"
  deplace "$d" "02_modeles_3d/decors/$z/pack1"
done
deplace "TinyKnight_Zones_Promo/promo" "06_promo"
deplace "TinyKnight_Zones_Promo" "_journal/pack_zones_promo"
[ -f LISEZMOI.txt ] && deplace "LISEZMOI.txt" "_journal/pack_zones_promo/LISEZMOI_racine.txt"
# 3. personnage, equipements, monstres du premier pack
deplace personnage "02_modeles_3d/chevaliers/pack1_clips_separes"
deplace equipements "02_modeles_3d/equipements"
deplace monstres "02_modeles_3d/creatures/pack1_statiques"
# 4. monstres animes (pack 2)
for f in bipedes quadrupedes volants rampants flottants; do deplace "TinyKnight_Monstres_Animes/$f" "02_modeles_3d/creatures/pack2_animes/$f"; done
deplace "TinyKnight_Monstres_Animes/apercu" "_apercus/pack2_monstres_animes"
deplace "TinyKnight_Monstres_Animes" "07_outils/monstres_animes"
# 5. textures : la v2 devient la reference, la v1 part dans les alternatives
if [ -d "TinyKnight_Textures_Zones/TinKnight Textures zones v2" ]; then deplace "TinyKnight_Textures_Zones/TinKnight Textures zones v2" "03_textures"; fi
for z in racines mycelium braises givre abimes; do deplace "TinyKnight_Textures_Zones/$z" "_alternatives/textures_v1/$z"; done
deplace "TinyKnight_Textures_Zones" "_journal/textures"
# 6. interface
deplace "TinyKnight_UI_Kit/fonds" "05_interface/fonds"
deplace "TinyKnight_UI_Kit/icones_interface" "05_interface/icones_interface"
deplace "TinyKnight_UI_Kit/prototypes_icones_chevalier" "05_interface/icones_chevalier"
deplace "TinyKnight_UI_Kit/prototypes_planches_concepts" "01_concepts/serie_1"
deplace "TinyKnight_UI_Kit" "05_interface/kit"
# 7. concepts serie 3 et icones d'objets
deplace "Concepts Serie 3 et icones/icones_objets" "05_interface/icones_objets"
deplace "Concepts Serie 3 et icones" "01_concepts/serie_3"
# 8. index
{
  echo "# Index"; echo; echo "Genere le $(date -u +%Y-%m-%d) par la reorganisation. Un dossier par ligne."; echo
  echo "| Dossier | Fichiers | Poids |"; echo "|---|---:|---:|"
  find "$R" -type d | sort | while IFS= read -r d; do
    n=$(find "$d" -maxdepth 1 -type f | wc -l); [ "$n" -gt 0 ] || continue
    s=$(find "$d" -maxdepth 1 -type f -printf '%s\n' | awk '{t+=$1} END {printf "%.1f Mo", t/1048576}')
    echo "| \`${d#"$R"/}\` | $n | $s |"
  done
} > "$R/INDEX.md"
git add "$R/INDEX.md"
echo "termine : $(git ls-files -- "$R" | wc -l) fichiers dans $R"
