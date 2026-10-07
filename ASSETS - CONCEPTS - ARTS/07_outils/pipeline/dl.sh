while read n u yw; do [ -s raw/$n.glb ] || curl -sf -o raw/$n.glb "$u" || echo FAIL $n; done
