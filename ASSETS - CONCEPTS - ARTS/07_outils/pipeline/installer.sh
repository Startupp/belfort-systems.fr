# Dépendances de la chaîne de fabrication (node 20, python 3)
set -e
[ -f package.json ] || npm init -y >/dev/null
npm i --silent @gltf-transform/core@4 @gltf-transform/functions@4 meshoptimizer sharp@0.33.5
rm -rf node_modules/ndarray-pixels/node_modules/sharp
python3 -c 'import json;p=json.load(open("package.json"));p["type"]="module";json.dump(p,open("package.json","w"))'
pip install -q trimesh scipy fast-simplification pillow numpy 2>/dev/null || pip install -q --break-system-packages trimesh scipy fast-simplification pillow numpy
mkdir -p raw rb out
echo pret
