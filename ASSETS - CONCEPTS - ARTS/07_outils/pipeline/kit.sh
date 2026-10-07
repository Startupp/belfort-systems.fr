# kit.sh liste : chaque ligne "nom url" -> out/nom.glb (1200 triangles, texture 512)
bash dl.sh < $1
while read n u yw; do [ -s out/$n.glb ] && continue; python3 blocbake.py raw/$n.glb rb/$n.glb 1200 512 objet ${yw:-0} | tail -1 && KEEP=1 node opt.mjs rb/$n.glb out/$n.glb 99999 0 512 84 | tail -1; done < $1
