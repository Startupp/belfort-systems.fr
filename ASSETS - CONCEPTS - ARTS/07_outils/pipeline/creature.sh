# creature.sh nom adresse_glb_tripo famille [rotation=270] [triangles=1600] : raw/ -> rb/ (reduit, retexture 512) -> st/ (statique) -> out/m_<nom>.glb (poses)
n=$1; u=$2; fam=$3; yw=${4:-270}; tr=${5:-1600}; mkdir -p raw rb st out
[ -s raw/$n.glb ] || curl -sf -o raw/$n.glb "$u" || { echo "FAIL telechargement $n"; exit 1; }
python3 blocbake.py raw/$n.glb rb/$n.glb $tr 512 objet $yw | tail -1 && KEEP=1 node opt.mjs rb/$n.glb st/$n.glb 99999 0 512 84 | tail -1 && python3 animer.py st/$n.glb out/$n.glb $fam ${@:6}
