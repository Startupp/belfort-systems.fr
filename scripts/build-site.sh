#!/usr/bin/env bash
# Construit _site/ : le SEUL dossier publié sur belfort-systems.fr.
#
# Utilisé par :
#   - Cloudflare Pages : commande de build « bash scripts/build-site.sh », sortie « _site » ;
#   - le workflow GitHub Pages (.github/workflows/deploy-pages.yml), tant que la bascule n'est pas faite ;
#   - en local : bash scripts/build-site.sh && npx serve _site (ou python3 -m http.server -d _site).
#
# Liste d'AUTORISATION : seul ce qui est copié ici est publié. Tout le reste du dépôt
# (api/, docs/, admin/apercu/, *.md, .github/, tests, scripts, « ASSETS - CONCEPTS - ARTS »…)
# n'est jamais mis en ligne. Ajouter une page publique = l'ajouter à PUBLIC ci-dessous.
#
# Dépendances : bash, coreutils, find, grep. Node.js (préinstallé chez Cloudflare Pages et
# sur les runners GitHub) sert uniquement à générer _site/_headers (CSP avec empreintes).
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RACINE"
SORTIE="${SORTIE:-_site}"

# Annotations lisibles dans GitHub Actions, texte simple ailleurs (Cloudflare, local).
avertir() { if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::warning::$*"; else echo "ATTENTION : $*"; fi; }
erreur()  { if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error::$*";   else echo "ERREUR : $*" >&2; fi; }

rm -rf "$SORTIE" && mkdir "$SORTIE"

# 1. Fichiers racine
RACINE_FICHIERS="index.html 404.html favicon.svg site.webmanifest robots.txt sitemap.xml"
# CNAME et .nojekyll ne servent qu'à GitHub Pages (Cloudflare définit CF_PAGES=1).
if [ -z "${CF_PAGES:-}" ]; then RACINE_FICHIERS="$RACINE_FICHIERS CNAME .nojekyll"; fi
for f in $RACINE_FICHIERS; do
  if [ -e "$f" ]; then cp "$f" "$SORTIE/"; fi
done

# 2. Dossiers publics (copiés sans les fichiers de développement)
PUBLIC="assets qui-suis-je portail clients factures haccp ecorce espace-breteuil"
for d in $PUBLIC; do
  if [ ! -d "$d" ]; then avertir "Dossier $d absent"; continue; fi
  cp -a "$d" "$SORTIE/$d"
done

# 3. Panneau admin : le code seulement (pas admin/apercu/, pas les notes)
mkdir -p "$SORTIE/admin"
cp admin/index.html admin/admin.css admin/admin.js admin/outils.js "$SORTIE/admin/"

# 4. Retrait des fichiers de développement dans les dossiers copiés.
#    Les _headers / _redirects des sous-dossiers sont ignorés par Cloudflare Pages
#    (seuls ceux de la racine comptent) : on les retire pour ne pas les publier.
find "$SORTIE" -depth \( -name tests -o -name test -o -name node_modules \) -type d -exec rm -rf {} +
rm -rf "$SORTIE/assets/marque"   # visuels pour les profils et l'imprimeur : pas publiés
find "$SORTIE" -mindepth 2 -type f \( -name '_headers' -o -name '_redirects' \) -delete
find "$SORTIE" -type f \( -name '*.md' -o -name '*.test.mjs' -o -name '*.test.js' -o -name '*.sh' -o -name '*.py' \
  -o -name 'package.json' -o -name 'package-lock.json' -o -name '.DS_Store' \) -delete

# 5. En-têtes (CSP par section, HSTS…) et redirections, pour Cloudflare Pages.
#    GitHub Pages les ignore (il les servirait comme fichiers : sans danger, rien de secret).
node scripts/generer-headers.mjs "$SORTIE"
cp scripts/site/_redirects "$SORTIE/_redirects"

# 6. Garde-fou : échoue si un chemin interdit s'est glissé dans l'artefact
interdit=$(cd "$SORTIE" && find . \( -path './api*' -o -path './docs*' -o -path './admin/apercu*' -o -path './.github*' \
  -o -path './scripts*' -o -path './ASSETS*' -o -name '*.md' -o -name '*.sql' -o -name '.env*' -o -name 'wrangler.toml' \
  -o -path '*/tests/*' \) -print | head -20)
if [ -n "$interdit" ]; then erreur "Fichiers interdits dans $SORTIE/ :"; echo "$interdit"; exit 1; fi
if grep -rIl --include='*.json' --include='*.html' --include='*.js' '@breteuil\.fr' "$SORTIE/" | grep -v "^$SORTIE/espace-breteuil/"; then
  avertir "Adresse @breteuil.fr trouvée dans un fichier publié (hors espace-breteuil) : vérifier."
fi

# 7. Limites du plan gratuit Cloudflare Pages : 20 000 fichiers, 25 Mio par fichier.
nb=$(find "$SORTIE" -type f | wc -l)
if [ "$nb" -gt 20000 ]; then erreur "$nb fichiers : limite Cloudflare Pages (20 000) dépassée"; exit 1; fi
gros=$(find "$SORTIE" -type f -size +25M -print | head -5)
if [ -n "$gros" ]; then erreur "Fichier(s) de plus de 25 Mio (limite Cloudflare Pages) :"; echo "$gros"; exit 1; fi

echo "$SORTIE/ prêt : $nb fichiers, $(du -sh "$SORTIE" | cut -f1)."
