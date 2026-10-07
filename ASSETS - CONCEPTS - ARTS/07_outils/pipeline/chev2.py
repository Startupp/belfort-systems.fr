# etape 2 : assemble le chevalier leger (peau + squelette) et ses clips ; les clips d'autres squelettes sont reportes os par os
import sys, json, numpy as np, io
from scipy.spatial.transform import Rotation as R, Slerp
from PIL import Image
from glb import load, acc, Out
RIG, DST = sys.argv[1], sys.argv[2]; YAW_SRC = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
CLIPS = json.loads(open(sys.argv[4]).read()) if len(sys.argv) > 4 else []
def skel(f):
    j, B = load(f); nm = [n.get('name') for n in j['nodes']]; sk = j['skins'][0]; jn = [nm[i] for i in sk['joints']]
    IBM = acc(j, B, sk['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1).astype(np.float64); BW = {b: np.linalg.inv(IBM[k]) for k, b in enumerate(jn)}
    par = {}
    for i, n in enumerate(j['nodes']):
        for c in n.get('children', []): par[nm[c]] = nm[i]
    def depth(b): return 0 if par.get(b) not in BW else 1 + depth(par[b])
    order = sorted(jn, key=depth)
    def rot(M): M = M[:3, :3] / np.linalg.norm(M[:3, :3], axis=0); return R.from_matrix(M)
    RW = {b: rot(BW[b]) for b in jn}; L = {}
    for b in jn:
        p = par.get(b); Lm = (np.linalg.inv(BW[p]) if p in BW else np.diag([100, 100, 100, 1.0])) @ BW[b]; L[b] = (Lm[:3, 3].copy(), rot(Lm))
    return dict(j=j, B=B, nm=nm, jn=jn, par=par, order=order, RW=RW, L=L, IBM=IBM, BW=BW)
T = skel(RIG)
def clip(f, idx, yaw):
    S = skel(f) if f != RIG else T; j, B = S['j'], S['B']; a = j['animations'][idx]; ch = {}
    for c in a['channels']:
        s = a['samplers'][c['sampler']]; ch[(S['nm'][c['target']['node']], c['target']['path'])] = (acc(j, B, s['input'])[:, 0].astype(np.float64), acc(j, B, s['output']).astype(np.float64))
    tt = ch[('Hips', 'rotation')][0]; Y = R.from_euler('y', yaw, degrees=True); W = {}; out = {}
    for b in S['order']:
        if (b, 'rotation') in ch:
            t, q = ch[(b, 'rotation')]; q = R.from_quat(q)
            if len(t) != len(tt) or np.abs(t - tt).max() > 1e-4: q = Slerp(t, q)(np.clip(tt, t[0], t[-1])) if len(t) > 1 else R.from_quat(np.repeat(q.as_quat(), len(tt), 0))
        else: q = R.from_quat(np.repeat(S['L'][b][1].as_quat()[None], len(tt), 0))
        p = S['par'].get(b); W[b] = (W[p] * q) if p in W else q
    TW = {}
    for b in T['order']:
        if b not in W: continue
        TW[b] = Y * (W[b] * S['RW'][b].inv()) * Y.inv() * T['RW'][b]; p = T['par'].get(b)
        out[b] = (TW[p].inv() * TW[b]) if p in TW else TW[b]
    ht = None
    if ('Hips', 'translation') in ch:
        t, v = ch[('Hips', 'translation')]; v = np.stack([np.interp(tt, t, v[:, k]) for k in range(3)], 1)
        ls, lt = np.array(S['j']['nodes'][S['nm'].index('Hips')].get('translation', S['L']['Hips'][0]), float), T['L']['Hips'][0]
        if f == RIG: ls = lt; ht = lt + Y.apply((v - ls) * (lt[1] / ls[1]))
    return tt, out, ht
d = np.load('rb/chev_lo.npz'); O = Out(); j = T['j']
prim = {'attributes': {'POSITION': O.add(d['V'], 'VEC3', target=34962, mm=True), 'NORMAL': O.add(d['N'], 'VEC3', target=34962), 'TEXCOORD_0': O.add(d['UV'], 'VEC2', target=34962),
        'JOINTS_0': O.add(d['J'], 'VEC4', 5121, 34962), 'WEIGHTS_0': O.add(d['W'], 'VEC4', target=34962)}, 'indices': O.add(d['F'].reshape(-1, 1), 'SCALAR', 5123 if len(d['V']) < 65536 else 5125, 34963), 'material': 0}
nodes = []
for i, n in enumerate(j['nodes']):
    m = {'name': n.get('name')}
    if 'children' in n: m['children'] = n['children']
    if n.get('name') in T['L']: t, r = T['L'][n['name']]; m['translation'] = t.tolist(); m['rotation'] = r.as_quat().tolist()
    elif 'scale' in n: m['scale'] = n['scale']
    if 'mesh' in n: m['mesh'] = 0; m['skin'] = 0
    nodes.append(m)
ibm = O.add(T['IBM'].transpose(0, 2, 1).reshape(-1, 16), 'MAT4')
o = io.BytesIO(); Image.open('rb/chev_tex.png').save(o, 'JPEG', quality=86); img = O.raw(o.getvalue())
anims = []
for name, f, idx, yaw, *opt in CLIPS:
    tt, rot, ht = clip(f, idx, yaw)
    if opt and opt[0] and ht is not None: ht[:, 0] = T['L']['Hips'][0][0]; ht[:, 2] = T['L']['Hips'][0][2]   # sur place
    st = 1 if len(tt) < 40 else 3; ks = sorted(set(list(range(0, len(tt), st)) + [len(tt) - 1])); ti = O.add((tt[ks] - tt[0]).reshape(-1, 1), 'SCALAR', mm=True); S = []; C = []
    for b, q in rot.items():
        qq = q.as_quat()[ks]
        for k in range(1, len(qq)):
            if np.dot(qq[k], qq[k - 1]) < 0: qq[k] = -qq[k]
        S.append({'input': ti, 'output': O.add(qq, 'VEC4'), 'interpolation': 'LINEAR'}); C.append({'sampler': len(S) - 1, 'target': {'node': T['nm'].index(b), 'path': 'rotation'}})
    if ht is not None: S.append({'input': ti, 'output': O.add(ht[ks], 'VEC3'), 'interpolation': 'LINEAR'}); C.append({'sampler': len(S) - 1, 'target': {'node': T['nm'].index('Hips'), 'path': 'translation'}})
    anims.append({'name': name, 'samplers': S, 'channels': C}); print(' clip', name, len(ks), 'cles', round(float(tt[-1] - tt[0]), 2), 's')
G = {'asset': {'version': '2.0', 'generator': 'TinKnight chev2.py'}, 'scene': 0, 'scenes': [{'name': 'scene', 'nodes': j['scenes'][j.get('scene', 0)]['nodes']}], 'nodes': nodes,
     'meshes': [{'name': 'chevalier', 'primitives': [prim]}], 'skins': [{'joints': j['skins'][0]['joints'], 'inverseBindMatrices': ibm, **({'skeleton': j['skins'][0]['skeleton']} if 'skeleton' in j['skins'][0] else {})}],
     'materials': [{'name': 'chevalier', 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0, 'roughnessFactor': 1}}], 'textures': [{'source': 0}], 'images': [{'bufferView': img, 'mimeType': 'image/jpeg'}]}
if anims: G['animations'] = anims
O.write(G, DST); import os; print(DST, len(d['F']), 'triangles', os.path.getsize(DST) // 1024, 'ko')
