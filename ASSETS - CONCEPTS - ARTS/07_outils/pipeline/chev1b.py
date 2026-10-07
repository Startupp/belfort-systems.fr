# le GLB squelette issu du modele deja leger : on reprend son maillage tel quel
import sys, io, numpy as np
from PIL import Image
from glb import load, acc
j, B = load(sys.argv[1]); p = j['meshes'][0]['primitives'][0]; A = p['attributes']
P = acc(j, B, A['POSITION']); UV = acc(j, B, A['TEXCOORD_0']); J = acc(j, B, A['JOINTS_0']); W = acc(j, B, A['WEIGHTS_0']); N = acc(j, B, A['NORMAL']); I = acc(j, B, p['indices']).reshape(-1, 3)
ti = j['materials'][p['material']]['pbrMetallicRoughness']['baseColorTexture']['index']; im = j['images'][j['textures'][ti]['source']]; bv = j['bufferViews'][im['bufferView']]
Image.open(io.BytesIO(B[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']])).convert('RGB').save('rb/chev_tex.png')
np.savez('rb/chev_lo.npz', V=P, F=I, UV=UV, N=N, J=J, W=W / W.sum(1, keepdims=True)); print('maillage', len(P), len(I), 'bbox', P.min(0).round(2), P.max(0).round(2), 'J', J.max())
