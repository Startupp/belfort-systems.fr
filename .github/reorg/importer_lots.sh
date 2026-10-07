#!/usr/bin/env bash
# Telecharge les lots listes dans lots.txt (une ligne : <adresse du zip> <nom du lot>) et les range dans le depot.
# Chaque zip contient deja le dossier "ASSETS - CONCEPTS - ARTS" trie. Un lot deja importe (lots_faits.txt) est ignore.
# Un fichier deja present n'est jamais ecrase : la nouvelle version va dans _alternatives/<nom du lot>/.
set -euo pipefail
R="ASSETS - CONCEPTS - ARTS"; ICI=".github/reorg"; touch "$ICI/lots_faits.txt"
[ -f "$ICI/lots.txt" ] || { echo "pas de lots.txt"; exit 0; }
while read -r url nom _; do
  case "$url" in ''|\#*) continue;; esac
  grep -qxF "$url" "$ICI/lots_faits.txt" && continue
  tmp=$(mktemp -d); echo "lot $nom"
  curl -fsSL --retry 3 -o "$tmp/lot.zip" "$url"; unzip -q "$tmp/lot.zip" -d "$tmp/x"
  if [ -d "$tmp/x/$R" ]; then
    (cd "$tmp/x/$R" && find . -type f -print0) | while IFS= read -r -d '' f; do
      f="${f#./}"; dst="$R/$f"
      [ "$f" = "LISEZMOI.md" ] && [ -e "$dst" ] && continue
      if [ -e "$dst" ]; then cmp -s "$tmp/x/$R/$f" "$dst" && continue; dst="$R/_alternatives/$nom/$f"; fi
      mkdir -p "$(dirname "$dst")"; cp "$tmp/x/$R/$f" "$dst"
    done
  fi
  for f in "$tmp/x"/*.html; do [ -e "$f" ] && { mkdir -p "$R/07_outils/validations"; [ -e "$R/07_outils/validations/$(basename "$f")" ] || cp "$f" "$R/07_outils/validations/"; }; done
  echo "$url" >> "$ICI/lots_faits.txt"; rm -rf "$tmp"
done < "$ICI/lots.txt"
echo "import termine"
