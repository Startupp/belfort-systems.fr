# Donne a une creature statique ses poses et ses cinq animations, au format des creatures du pack 3 (m_<nom>.glb).
#   python3 animer.py statique.glb sortie.glb famille [--yaw degres] [--force 1.0] [--jambes 0.38]
# Familles : bipede quadrupede multipattes volant flottant rampant sauteur boule
# Entree : un maillage, une texture (sortie de blocbake.py + opt.mjs), 1450 a 1700 triangles, face vers +Z, pieds au sol.
# Sortie : le meme maillage (plus grand cote = 1, centre en X et Z, base a y = 0) avec 9 poses (morph targets) et les animations
# repos, marche, attaque, touche, mort qui les melangent, la famille dans scene.extras : la structure exacte de m_renard_givre.glb.
# Chaque pose est fonction de la seule position de repos d'un sommet (jamais de sa normale ni de son numero) : deux sommets
# confondus (couture de texture) bougent ensemble, la peau ne se dechire pas. Rotations de 30 degres au plus, echelles positives.
import sys, json, numpy as np
from glb import load, acc, Out

FAM = ('bipede', 'quadrupede', 'multipattes', 'volant', 'flottant', 'rampant', 'sauteur', 'boule')
COMMUNES = ['elan', 'frappe', 'touche', 'vacille', 'aplati']
NOMS = {'bipede': ['souffle', 'pasA', 'haut', 'pasB'] + COMMUNES, 'quadrupede': ['souffle', 'pasA', 'haut', 'pasB'] + COMMUNES,
        'multipattes': ['souffle', 'pasA', 'haut', 'pasB'] + COMMUNES, 'volant': ['haut', 'bas', 'hautV', 'basV'] + COMMUNES,
        'flottant': ['g', 'd', 'gV', 'dV'] + COMMUNES, 'rampant': ['souffle', 'v0', 'v1', 'v2', 'v3'] + COMMUNES,
        'sauteur': ['souffle'] + COMMUNES + ['accroupi', 'saut', 'gonfle'], 'boule': ['souffle', 'gonfle', 'ecrase', 'haut'] + COMMUNES}
# cles des animations (temps, pose ; None = aucune pose) : les memes que le pack 3. Le jeu cale l'elan a 0,22 s et la frappe a 0,34 s.
REPOS = {'volant': [(0, 'haut'), (.22, 'bas'), (.44, 'haut')], 'flottant': [(0, 'g'), (.8, 'd'), (1.6, 'g')],
         'rampant': [(0, None), (1.1, 'souffle'), (2.2, None)], 'sauteur': [(0, None), (.9, 'souffle'), (1.5, 'gonfle'), (2.2, None)],
         'boule': [(0, None), (.9, 'gonfle'), (1.5, 'souffle'), (2.2, None)]}
MARCHE = {'volant': [(0, 'hautV'), (.16, 'basV'), (.32, 'hautV')], 'flottant': [(0, 'gV'), (.35, 'dV'), (.7, 'gV')],
          'rampant': [(0, 'v0'), (.3, 'v1'), (.6, 'v2'), (.9, 'v3'), (1.2, 'v0')], 'sauteur': [(0, 'accroupi'), (.18, 'saut'), (.4, None), (.6, 'accroupi')],
          'boule': [(0, 'ecrase'), (.25, 'haut'), (.5, 'ecrase')]}
PAS = [(0, 'pasA'), (.2, 'haut'), (.4, 'pasB'), (.6, 'haut'), (.8, 'pasA')]
BASE = {'volant': 'haut', 'flottant': 'g'}  # la pose d'ou partent et ou reviennent attaque, touche, mort (sinon : aucune)

def ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def bascule(Q, a, pv):   # autour d'un axe X passant par pv ; a > 0 : le haut part vers +Z (a peut varier par sommet)
    dy, dz = Q[:, 1] - pv[1], Q[:, 2] - pv[2]; c, s = np.cos(a), np.sin(a); R = Q.copy()
    R[:, 1] = pv[1] + dy * c - dz * s; R[:, 2] = pv[2] + dy * s + dz * c; return R
def penche(Q, a, pv):    # autour d'un axe Z passant par pv ; a > 0 : le haut part vers +X
    dx, dy = Q[:, 0] - pv[0], Q[:, 1] - pv[1]; c, s = np.cos(a), np.sin(a); R = Q.copy()
    R[:, 0] = pv[0] + dx * c + dy * s; R[:, 1] = pv[1] - dx * s + dy * c; return R
def echelle(Q, k, pv):
    return np.asarray(pv) + (Q - np.asarray(pv)) * np.asarray(k)

def poses(P, fam, jambes=None):
    x, y, z = P[:, 0], P[:, 1], P[:, 2]; H = y.max(); X = np.abs(x).max(); z0, z1 = z.min(), z.max(); L = z1 - z0
    sol, mil = np.array([0, 0, 0.]), np.array([0, H / 2, 0.])
    air = fam in ('volant', 'flottant')
    pv_av, pv_ar = (mil, mil) if air else (np.array([0, 0, .5 * z1]), np.array([0, 0, .5 * z0]))   # bascule avant / arriere : a mi-chemin du bord
    hl = (jambes or {'bipede': .42, 'quadrupede': .38, 'multipattes': .32}.get(fam, .3)) * H
    wl = 1 - ss(.15 * hl, hl, y)                       # poids des jambes : 1 au sol, 0 au-dessus de hl
    sx = np.clip(x / (.12 * X + 1e-6), -1, 1)           # cote (gauche +1, droite -1), sans saut au milieu
    sz = np.clip((z - (z0 + z1) / 2) / (.18 * L + 1e-6), -1, 1)
    u = (z - z0) / max(L, 1e-6)                          # 0 a l'arriere, 1 a l'avant
    out = {}
    def souffle(Q=P, k=1.):                              # on expire : le corps se tasse un peu et s'elargit
        return echelle(Q, (1 + .015 * k, 1 - .045 * k, 1 + .015 * k), sol)
    # --- ce que toutes les familles partagent : elan, frappe, touche, vacille, aplati (ampleurs du pack 3) ---
    def commun(Q, k=1.):
        o = {}
        o['elan'] = bascule(echelle(Q, (1.02, 1 - .14 * k, 1), sol), -.24 * k, pv_ar) + [0, 0, -.1 * k]
        o['frappe'] = bascule(echelle(Q, (1, 1.04, 1.08), sol), .26 * k, pv_av) + [0, 0, .32 * k]
        o['touche'] = bascule(echelle(Q, (1.04, 1 - .14 * k, 1), sol), -.28 * k, pv_ar) + [0, 0, -.1 * k]
        o['vacille'] = penche(echelle(Q, (1, 1 - .1 * k, 1), sol), -.36 * k, np.array([-.5 * X, 0, 0]) if not air else mil) + [-.04 * k, 0, 0]
        o['aplati'] = penche(echelle(Q, (1.22, .26, 1.18), sol), -.1, sol) + [-.02, 0, .02]
        return o
    if fam in ('bipede', 'quadrupede', 'multipattes'):
        if fam == 'bipede':
            motif = sx                                     # une jambe en avant, l'autre en arriere
            yb = (y > .3 * H) & (y < .85 * H); rt = np.percentile(np.abs(x[yb]), 55) if yb.any() else .3 * X
            bras = ss(rt, rt + .18, np.abs(x)) * ss(.25 * H, .45 * H, y) * (1 - ss(.85 * H, H, y))
        elif fam == 'quadrupede':
            motif = sx * sz; bras = 0                      # pattes en diagonale
        else:
            motif = sx * np.clip(np.cos(2 * np.pi * (u - .2) / .6), -1, 1); bras = 0   # trois paires : avant et arriere d'un cote, milieu de l'autre
        def pas(sg):
            Q = P.copy(); m = sg * motif
            Q[:, 2] += .14 * wl * m                        # les pattes avancent ou reculent
            Q[:, 1] += .05 * wl * np.clip(m, 0, 1)         # celles qui avancent se levent
            if fam == 'bipede':                            # les bras balancent a contre-temps
                Q = bascule(Q, .35 * sg * np.sign(x) * bras, np.array([0, .72 * H, 0])) if np.ndim(bras) else Q
            Q[:, 0] += -.028 * sg * (1 - wl); Q[:, 1] -= .012  # le corps se porte sur l'appui
            return Q
        out['souffle'] = souffle(); out['pasA'] = pas(1); out['pasB'] = pas(-1)
        Q = P.copy(); Q[:, 1] += .055 * (1 - .7 * wl); out['haut'] = Q
        out.update(commun(P))
        if fam == 'bipede':                                # bras leves a l'elan, abattus a la frappe
            sh = np.array([0, .72 * H, 0])
            out['elan'] = bascule(echelle(bascule(P, .4 * bras, sh), (1.02, .86, 1), sol), -.24, pv_ar) + [0, 0, -.1]
            out['frappe'] = bascule(echelle(bascule(P, -.5 * bras, sh), (1, 1.04, 1.08), sol), .26, pv_av) + [0, 0, .32]
    elif fam == 'volant':
        ax = np.abs(x); bins = np.arange(0, X, .02); ep = []
        for b in bins:
            m = (ax >= b) & (ax < b + .02); ep.append(np.ptp(y[m]) if m.sum() > 2 else 0)
        ep = np.array(ep); t0 = ep[:4].max() if len(ep) else 0; rb = .3 * X
        for i, b in enumerate(bins):
            if b > .04 and ep[i] < .45 * t0: rb = b; break
        rb = float(np.clip(rb, .06, .2)); aile = ss(rb, rb + .15, ax); print('  attache des ailes a x = +-%.2f' % rb)
        yh = np.median(y[aile > .5]) if (aile > .5).any() else H / 2
        def ailes(Q, a):                                 # les ailes tournent autour de leur attache (axe Z en x = +-rb)
            R = Q.copy(); dx = np.abs(Q[:, 0]) - rb; dy = Q[:, 1] - yh; t = a * aile
            nx = rb + dx * np.cos(t) - dy * np.sin(t); ny = yh + dx * np.sin(t) + dy * np.cos(t)
            R[:, 0] = np.where(aile > 0, np.sign(Q[:, 0]) * nx, Q[:, 0]); R[:, 1] = np.where(aile > 0, ny, Q[:, 1]); return R
        out['haut'] = ailes(P, .55) + [0, -.02, 0]; out['bas'] = ailes(P, -.4) + [0, .02, 0]
        out['hautV'] = bascule(ailes(P, .55), .2, mil) + [0, -.03, .08]; out['basV'] = bascule(ailes(P, -.4), .2, mil) + [0, -.01, .08]
        out['elan'] = bascule(ailes(P, .45), -.28, mil) + [0, .14, -.18]
        out['frappe'] = bascule(ailes(P, -.2), .42, mil) + [0, -.24, .34]
        out['touche'] = bascule(ailes(P, .25), -.36, mil) + [0, .02, -.2]
        out['vacille'] = penche(ailes(P, -.1), -.42, mil) + [-.06, -.08, 0]
        out['aplati'] = penche(echelle(ailes(P, -.15), (1.08, .32, 1.08), sol), -.12, sol)
    elif fam == 'flottant':
        traine = 1 - ss(0, .45 * H, y)                    # le bas (traine, tentacules) suit avec du retard
        def balance(sg, v):
            Q = P.copy(); Q[:, 0] += sg * (.035 - .07 * traine); Q[:, 1] += .022 if sg > 0 else -.018
            if v: Q = bascule(Q, .2, mil) + [0, 0, .08]
            return Q
        out['g'] = balance(1, 0); out['d'] = balance(-1, 0); out['gV'] = balance(1, 1); out['dV'] = balance(-1, 1)
        out['elan'] = echelle(P, (1.08, .74, 1.08), sol) + [0, 0, -.02]
        out['frappe'] = bascule(echelle(P, (.94, 1.12, .94), sol), .3, mil) + [0, .14, .27]
        out['touche'] = bascule(echelle(P, (1.04, .9, 1), sol), -.36, mil) + [0, -.06, -.14]
        out['vacille'] = penche(echelle(P, (1, .85, 1), sol), .4, mil) + [.06, -.1, 0]
        out['aplati'] = echelle(P, (1.15, .18, 1.15), sol)
    elif fam == 'rampant':
        out['souffle'] = souffle(k=1.4)
        for k in range(4):                               # une ondulation qui court de l'arriere vers l'avant
            ph = 2 * np.pi * (u - k / 4); h = y / H; Q = P.copy()
            Q[:, 1] += .1 * h * (.5 + .5 * np.sin(ph)); Q[:, 2] += .035 * h * np.cos(ph); out['v%d' % k] = Q
        out.update(commun(P, .75))
    elif fam == 'sauteur':
        out['souffle'] = souffle(k=1.2)
        out['accroupi'] = bascule(echelle(P, (1.06, .84, 1), sol), .08, pv_av)
        Q = echelle(P, (.96, 1.12, 1), sol) + [0, .3, 0]; Q[:, 2] -= .08 * wl; out['saut'] = bascule(Q, -.12, mil + [0, .3, 0])
        bosse = ss(.25 * H, .5 * H, y) * (1 - ss(.5 * H, .8 * H, y)); Q = P.copy(); Q[:, 0] *= 1 + .12 * bosse; Q[:, 2] *= 1 + .12 * bosse; out['gonfle'] = Q
        out.update(commun(P, .6))
    elif fam == 'boule':
        out['souffle'] = echelle(P, (1.02, .96, 1.02), sol); out['gonfle'] = echelle(P, (1.03, 1.05, 1.03), sol)
        out['ecrase'] = echelle(P, (1.1, .84, 1.1), sol); out['haut'] = echelle(P, (.95, 1.08, .95), sol) + [0, .03, 0]
        out['elan'] = bascule(echelle(P, (1.06, .9, .88), np.array([0, 0, z0])), -.2, pv_ar) + [0, 0, -.08]
        out['frappe'] = echelle(P, (.92, .92, 1.16), np.array([0, 0, z0])) + [0, .02, .3]
        out['touche'] = bascule(echelle(P, (1.06, .94, .84), np.array([0, 0, z0])), -.25, pv_ar) + [0, 0, -.12]
        out['vacille'] = penche(echelle(P, (1, .88, 1), sol), -.35, np.array([-X, 0, 0])) + [-.05, 0, 0]
        out['aplati'] = echelle(P, (1.25, .3, 1.25), sol)
    else:
        raise SystemExit('famille inconnue : ' + fam + ' (attendu : ' + ' '.join(FAM) + ')')
    return {n: out[n] - P for n in NOMS[fam]}

def clips(fam):
    noms = NOMS[fam]; b = BASE.get(fam)
    rep = REPOS.get(fam, [(0, None), (1, 'souffle'), (2, None)]); mar = MARCHE.get(fam, PAS)
    att = [(0, b), (.22, 'elan'), (.34, 'frappe'), (.46, 'frappe'), (.7, b)]
    return {'repos': rep, 'marche': mar, 'attaque': att, 'touche': [(0, b), (.08, 'touche'), (.3, b)], 'mort': [(0, b), (.3, 'vacille'), (.8, 'aplati')]}

def controle(P, F, D):
    # retournement : part des triangles dont la normale s'inverse ; dechirure : ecart entre sommets confondus
    n0 = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]]); a0 = np.linalg.norm(n0, axis=1); ok = a0 > 1e-9
    key = np.round(P * 1e5).astype(np.int64); _, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.reshape(-1)
    lignes = []
    for n, d in D.items():
        Q = P + d; n1 = np.cross(Q[F[:, 1]] - Q[F[:, 0]], Q[F[:, 2]] - Q[F[:, 0]])
        inv_pct = 100 * ((np.sum(n0 * n1, 1) <= 0) & ok).sum() / ok.sum()
        e0 = np.linalg.norm(P[F] - P[np.roll(F, 1, 1)], axis=2); e1 = np.linalg.norm(Q[F] - Q[np.roll(F, 1, 1)], axis=2)
        etire = (e1[e0 > 1e-6] / e0[e0 > 1e-6]).max()
        dech = 0.
        if len(inv) != len(np.unique(inv)):
            ref = np.zeros((inv.max() + 1, 3)); ref[inv] = d; dech = np.abs(d - ref[inv]).max()
        m = np.linalg.norm(d, axis=1)
        lignes.append((n, m.max(), m.mean(), d.mean(0), inv_pct, etire, dech))
    return lignes

def main():
    a = sys.argv[1:]
    if len(a) < 3: raise SystemExit(__doc__ if __doc__ else 'usage : python3 animer.py statique.glb sortie.glb famille [--yaw deg] [--force 1] [--jambes 0.38]')
    src, dst, fam = a[0], a[1], a[2]
    opt = {a[i][2:]: float(a[i + 1]) for i in range(3, len(a) - 1) if a[i].startswith('--')}
    j, B = load(src)
    prims = [p for m in j['meshes'] for p in m['primitives']]
    if len(prims) != 1: raise SystemExit('un seul maillage attendu, %d trouves' % len(prims))
    pr = prims[0]; at = pr['attributes']
    P = acc(j, B, at['POSITION']).astype(np.float64); UV = acc(j, B, at['TEXCOORD_0']).astype(np.float32)
    N = acc(j, B, at['NORMAL']).astype(np.float64) if 'NORMAL' in at else None
    F = acc(j, B, pr['indices']).reshape(-1, 3).astype(np.int64)
    yaw = np.radians(opt.get('yaw', 0)); c, s = np.cos(yaw), np.sin(yaw)
    rot = lambda V: np.stack([V[:, 0] * c + V[:, 2] * s, V[:, 1], -V[:, 0] * s + V[:, 2] * c], 1)
    P = rot(P); N = rot(N) if N is not None else None
    mn, mx = P.min(0), P.max(0); k = 1 / (mx - mn).max()
    P = (P - [(mn[0] + mx[0]) / 2, mn[1], (mn[2] + mx[2]) / 2]) * k   # plus grand cote = 1, centre en X et Z, base a y = 0
    if N is None:
        N = np.zeros_like(P); fn = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
        for i in range(3): np.add.at(N, F[:, i], fn)
    N /= np.maximum(np.linalg.norm(N, axis=1), 1e-12)[:, None]
    D = poses(P, fam, opt.get('jambes'))
    f = opt.get('force', 1.0); D = {n: d * f for n, d in D.items()}
    # l'image (texture JPEG) telle quelle
    img = j['images'][0]; bv = j['bufferViews'][img['bufferView']]; o = bv.get('byteOffset', 0); jpg = B[o:o + bv['byteLength']]
    noms = NOMS[fam]; O = Out()
    ii = O.add(F.reshape(-1), 'SCALAR', 5123 if len(P) < 65536 else 5125, 34963)
    ip = O.add(P.astype(np.float32), 'VEC3', 5126, 34962, mm=True); it = O.add(UV, 'VEC2', 5126, 34962); inn = O.add(N.astype(np.float32), 'VEC3', 5126, 34962)
    tg = [{'POSITION': O.add(D[n].astype(np.float32), 'VEC3', 5126, 34962, mm=True)} for n in noms]
    vimg = O.raw(bytes(jpg))
    anims = []
    for nom, cles in clips(fam).items():
        T = np.array([t for t, _ in cles], np.float32); W = np.zeros((len(cles), len(noms)), np.float32)
        for i, (_, p) in enumerate(cles):
            if p: W[i, noms.index(p)] = 1
        si = O.add(T, 'SCALAR', 5126, mm=True); so = O.add(W.reshape(-1), 'SCALAR', 5126)
        anims.append({'name': nom, 'samplers': [{'input': si, 'output': so, 'interpolation': 'LINEAR'}], 'channels': [{'sampler': 0, 'target': {'node': 0, 'path': 'weights'}}]})
    G = {'asset': {'generator': 'TinKnight animer.py', 'version': '2.0'}, 'scene': 0,
         'scenes': [{'name': 'scene', 'extras': {'famille': fam}, 'nodes': [0]}], 'nodes': [{'name': 'monstre', 'mesh': 0}],
         'meshes': [{'name': 'geometry_0', 'extras': {'targetNames': noms}, 'weights': [0] * len(noms),
                     'primitives': [{'attributes': {'POSITION': ip, 'TEXCOORD_0': it, 'NORMAL': inn}, 'indices': ii, 'mode': 4, 'material': 0, 'targets': tg}]}],
         'materials': [{'pbrMetallicRoughness': {'metallicFactor': 0, 'baseColorTexture': {'index': 0}}}],
         'textures': [{'source': 0, 'sampler': 0}], 'images': [{'mimeType': img.get('mimeType', 'image/jpeg'), 'bufferView': vimg}],
         'samplers': [{'wrapS': 10497, 'wrapT': 10497}], 'animations': anims}
    O.write(G, dst)
    import os
    print('%s  famille %s  %d triangles  %d sommets  %d poses  %d ko  dim %s' % (dst.split('/')[-1], fam, len(F), len(P), len(noms), round(os.path.getsize(dst) / 1024),
          'x'.join('%.2f' % v for v in np.ptp(P, axis=0))))
    pire = 0
    for n, mmax, mmoy, dm, invp, et, dech in controle(P, F, D):
        print('  %-8s depl. max %.3f moyen %.3f  moyen xyz %s  triangles retournes %.2f %%  etirement max x%.2f  dechirure %.1e' % (n, mmax, mmoy, np.round(dm, 3), invp, et, dech))
        pire = max(pire, invp)
    if pire > 1: print('  ATTENTION : une pose retourne plus de 1 % des triangles')

if __name__ == '__main__':
    main()
