# usage : bloc.sh nom triangles mode(bloc|objet) [yaw] [taille_texture]
T=${5:-256}
python3 blocbake.py raw/$1.glb rb/$1.glb $2 $T $3 ${4:-0} && KEEP=1 node opt.mjs rb/$1.glb out/$1.glb 99999 0 $T 84 | tail -1
