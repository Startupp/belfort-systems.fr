# Reduit un modele a ~N triangles sans etre bloque par les coutures UV, refait le depliage et recuit la texture
# depuis le modele d'origine (nuage de points colores). usage : blocbake.py src.glb dst.glb triangles taille_texture [bloc|objet] [yaw]
import sys, numpy as np, trimesh, fast_simplification
from scipy.spatial import cKDTree
from PIL import Image
src, dst, NT, S = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]); mode = sys.argv[5] if len(sys.argv) > 5 else 'bloc'; yaw0 = float(sys.argv[6]) if len(sys.argv) > 6 else 0.0
m = trimesh.load(src, process=False, force='mesh')
V = np.asarray(m.vertices, np.float64); F = np.asarray(m.faces, np.int64); UV = np.asarray(m.visual.uv, np.float64)
T = np.asarray(m.visual.material.baseColorTexture.convert('RGB')).astype(np.float32); TH, TW = T.shape[:2]
def rot(P, a): c, s = np.cos(a), np.sin(a); return np.stack([P[:, 0] * c + P[:, 2] * s, P[:, 1], -P[:, 0] * s + P[:, 2] * c], 1)
a = np.radians(yaw0)
if mode == 'bloc':   # angle de plus petite emprise au sol : les faces suivent les axes
    best = (1e18, 0.0)
    for d in np.arange(0, 90, 0.5):
        R = rot(V, np.radians(d)); ar = np.ptp(R[:, 0]) * np.ptp(R[:, 2])
        if ar < best[0]: best = (ar, np.radians(d))
    a += best[1]
V = rot(V, a); mn, mx = V.min(0), V.max(0)
if mode == 'bloc': sx, sz = 1 / (mx[0] - mn[0]), 1 / (mx[2] - mn[2]); sc = np.array([sx, (sx + sz) / 2, sz])
else: sc = np.full(3, 1 / (mx - mn).max())
V = (V - [(mn[0] + mx[0]) / 2, mn[1], (mn[2] + mx[2]) / 2]) * sc
# nuage de points colores du modele d'origine
tri = V[F]; area = np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1); NP = 400000
fi = np.random.choice(len(F), NP, p=area / area.sum()); r1 = np.sqrt(np.random.rand(NP)); r2 = np.random.rand(NP); b = np.stack([1 - r1, r1 * (1 - r2), r1 * r2], 1)
pts = (tri[fi] * b[:, :, None]).sum(1); uv = (UV[F[fi]] * b[:, :, None]).sum(1)
col = T[np.clip(((1 - uv[:, 1] % 1.0) * TH).astype(int), 0, TH - 1), np.clip(((uv[:, 0] % 1.0) * TW).astype(int), 0, TW - 1)]
tree = cKDTree(pts)
# soudure par position puis simplification libre
key = np.round(V * 20000).astype(np.int64); _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True); inv = inv.reshape(-1)
Vw = V[first]; Fw = inv[F]; Fw = Fw[(Fw[:, 0] != Fw[:, 1]) & (Fw[:, 1] != Fw[:, 2]) & (Fw[:, 0] != Fw[:, 2])]
if len(Fw) > NT: Vw, Fw = fast_simplification.simplify(Vw.astype(np.float32), Fw.astype(np.int32), target_count=NT, agg=6); Vw = Vw.astype(np.float64); Fw = Fw.astype(np.int64)
if mode == 'bloc':   # la simplification rogne les bords : on recale l'emprise exacte
    mn, mx = Vw.min(0), Vw.max(0); Vw[:, 0] = (Vw[:, 0] - (mn[0] + mx[0]) / 2) / (mx[0] - mn[0]); Vw[:, 2] = (Vw[:, 2] - (mn[2] + mx[2]) / 2) / (mx[2] - mn[2]); Vw[:, 1] -= mn[1]
def unwrap(P, Fc, S, pad=3):
    fn = np.cross(P[Fc[:, 1]] - P[Fc[:, 0]], P[Fc[:, 2]] - P[Fc[:, 0]]); l = np.linalg.norm(fn, axis=1); fn[l < 1e-12] = [0, 1, 0]; fn /= np.maximum(l, 1e-12)[:, None]
    D = np.array([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], float); sc = fn @ D.T
    em = {}
    for f, (a, b, c) in enumerate(Fc):
        for e in ((a, b), (b, c), (c, a)): em.setdefault((min(e), max(e)), []).append(f)
    nb = [[] for _ in Fc]
    for fs in em.values():
        for x in fs:
            for y in fs:
                if x != y: nb[x].append(y)
    fs2 = fn.copy()
    for _ in range(6):
        acc = fn * 0.5
        for x in range(len(Fc)):
            if nb[x]: acc[x] = acc[x] + fs2[nb[x]].mean(0)
        fs2 = acc / np.maximum(np.linalg.norm(acc, axis=1), 1e-9)[:, None]
    lab = (fs2 @ D.T).argmax(1); bad = sc[np.arange(len(Fc)), lab] < 0.2; lab[bad] = sc[bad].argmax(1)
    def comps():
        par = np.arange(len(Fc))
        def find(x):
            while par[x] != x: par[x] = par[par[x]]; x = par[x]
            return x
        for x in range(len(Fc)):
            for y in nb[x]:
                if lab[x] == lab[y]: par[find(x)] = find(y)
        return np.array([find(x) for x in range(len(Fc))])
    for _ in range(4):
        cp = comps(); ids, cnt = np.unique(cp, return_counts=True); size = dict(zip(ids, cnt))
        for x in range(len(Fc)):
            if size[cp[x]] < 6:
                bestn = None
                for y in nb[x]:
                    if cp[y] != cp[x] and sc[x, lab[y]] > 0.12 and (bestn is None or size[cp[y]] > size[cp[bestn]]): bestn = y
                if bestn is not None: lab[x] = lab[bestn]
    cp = comps(); ids = np.unique(cp); ax = {0: (2, 1), 1: (2, 1), 2: (0, 2), 3: (0, 2), 4: (0, 1), 5: (0, 1)}; charts = []
    for cid in ids:
        fi = np.where(cp == cid)[0]; a, b = ax[lab[fi[0]]]; vi = np.unique(Fc[fi]); uv = P[vi][:, [a, b]]; mn = uv.min(0); charts.append((fi, vi, uv - mn, (uv - mn).max(0)))
    order = sorted(range(len(charts)), key=lambda k: -charts[k][3][1])
    def pack(s):
        x = y = rowh = 0.0; pos = {}
        for k in order:
            w, h = charts[k][3] * s + pad
            if w > S: return None
            if x + w > S: x = 0.0; y += rowh; rowh = 0.0
            if y + h > S: return None
            pos[k] = (x, y); x += w; rowh = max(rowh, h)
        return pos
    lo, hi = 1.0, S * 50.0
    for _ in range(40):
        mid = (lo + hi) / 2
        if pack(mid) is None: hi = mid
        else: lo = mid
    pos = pack(lo); nv = sum(len(c[1]) for c in charts); vmap = np.zeros(nv, np.int64); nuv = np.zeros((nv, 2)); ind = np.zeros_like(Fc); o = 0
    for k, (fi, vi, uv, sz) in enumerate(charts):
        n = len(vi); vmap[o:o + n] = vi; nuv[o:o + n] = (uv * lo + np.array(pos[k]) + pad / 2) / S; loc = {v: o + t for t, v in enumerate(vi)}
        ind[fi] = [[loc[v] for v in f] for f in Fc[fi]]; o += n
    return vmap, ind, nuv, len(charts)
vmap, ind, nuv, nch = unwrap(Vw, Fw, S); NV = Vw[vmap]
B = S * 2; out = np.zeros((B, B, 3), np.float32); cov = np.zeros((B, B), bool)
for grow in (0, 3):
    for f in range(len(ind)):
        pa, pb, pc = (nuv[ind[f]] * B).copy(); pa[1] = B - pa[1]; pb[1] = B - pb[1]; pc[1] = B - pc[1]; qa, qb, qc = NV[ind[f]]
        x0 = int(max(0, np.floor(min(pa[0], pb[0], pc[0]) - grow))); x1 = int(min(B - 1, np.ceil(max(pa[0], pb[0], pc[0]) + grow)))
        y0 = int(max(0, np.floor(min(pa[1], pb[1], pc[1]) - grow))); y1 = int(min(B - 1, np.ceil(max(pa[1], pb[1], pc[1]) + grow)))
        if x1 < x0 or y1 < y0: continue
        d = (pb[1] - pc[1]) * (pa[0] - pc[0]) + (pc[0] - pb[0]) * (pa[1] - pc[1])
        if abs(d) < 1e-9: continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        w0 = ((pb[1] - pc[1]) * (xs - pc[0]) + (pc[0] - pb[0]) * (ys - pc[1])) / d; w1 = ((pc[1] - pa[1]) * (xs - pc[0]) + (pa[0] - pc[0]) * (ys - pc[1])) / d; w2 = 1 - w0 - w1
        e = grow / max(1.0, np.sqrt(abs(d))) if grow else 0.0; msk = (w0 >= -e) & (w1 >= -e) & (w2 >= -e)
        if grow: msk &= ~cov[y0:y1 + 1, x0:x1 + 1]
        if not msk.any(): continue
        w0c, w1c, w2c = np.clip(w0[msk], 0, 1), np.clip(w1[msk], 0, 1), np.clip(w2[msk], 0, 1); sm = (w0c + w1c + w2c)[:, None]
        P3 = (w0c[:, None] * qa + w1c[:, None] * qb + w2c[:, None] * qc) / sm; _, ii = tree.query(P3, k=3)
        reg = out[y0:y1 + 1, x0:x1 + 1]; reg[msk] = col[ii].mean(1); cov[y0:y1 + 1, x0:x1 + 1] |= msk
for _ in range(10):
    if cov.all(): break
    acc = np.zeros_like(out); n = np.zeros(cov.shape, np.float32)
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)): acc += np.roll(out * cov[..., None], (dy, dx), (0, 1)); n += np.roll(cov, (dy, dx), (0, 1))
    new = (~cov) & (n > 0); out[new] = acc[new] / n[new][:, None]; cov |= new
tex = Image.fromarray(out.clip(0, 255).astype(np.uint8)).resize((S, S), Image.LANCZOS)
mat = trimesh.visual.material.PBRMaterial(baseColorTexture=tex, metallicFactor=0.0, roughnessFactor=1.0)
trimesh.Trimesh(vertices=NV, faces=ind.astype(np.int64), visual=trimesh.visual.TextureVisuals(uv=nuv, material=mat), process=False).export(dst)
print(src.split('/')[-1], 'triangles', len(F), '->', len(ind), 'sommets', len(NV), 'ilots', nch, 'dim', 'x'.join('%.2f' % x for x in np.ptp(NV, axis=0)))
