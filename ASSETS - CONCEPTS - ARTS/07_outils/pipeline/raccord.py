# Rend une image raccordable bord a bord, puis la ramene a la taille voulue (textures de zone, pack 8).
# usage : python3 raccord.py source.png sortie_sans_extension [taille=512] [bande=0.14]  -> sortie.png + sortie.jpg (qualite 90)
# Methode (assemblage par coupe de moindre ecart) : on garde une bande au-dela du bord droit (puis bas) et on la recolle sur le debut de l'image
# le long du chemin ou les deux versions se ressemblent le plus, avec un fondu de quelques pixels. Le bord droit retombe ainsi exactement sur le
# bord gauche. La coupe horizontale est fermee sur elle-meme pour ne pas rouvrir le raccord gauche-droite.
import sys, numpy as np
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]; S = int(sys.argv[3]) if len(sys.argv) > 3 else 512; B = float(sys.argv[4]) if len(sys.argv) > 4 else 0.14
A = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
FE = 5.0  # largeur du fondu, en pixels de l'image source

def coupe(E, ferme):
    """chemin de moindre cout dans E (lignes x positions), un pas de -1/0/+1 par ligne ; ferme : derniere position a 1 de la premiere"""
    n, k = E.shape; mg = max(3, k // 8); E = E.copy(); E[:, :mg] += 1e9; E[:, k - mg:] += 1e9
    if not ferme:
        C = E[0].copy(); P = np.zeros((n, k), np.int8)
        for y in range(1, n):
            g = np.stack([np.r_[np.inf, C[:-1]], C, np.r_[C[1:], np.inf]]); a = g.argmin(0); P[y] = a - 1; C = E[y] + g[a, np.arange(k)]
        j = int(C.argmin()); path = [j]
        for y in range(n - 1, 0, -1): j += P[y, j]; path.append(j)
        return np.array(path[::-1])
    st = np.arange(mg, k - mg); C = np.full((len(st), k), np.inf); C[np.arange(len(st)), st] = E[0, st]; P = np.zeros((n, len(st), k), np.int8)
    for y in range(1, n):
        g = np.stack([np.pad(C[:, :-1], ((0, 0), (1, 0)), constant_values=np.inf), C, np.pad(C[:, 1:], ((0, 0), (0, 1)), constant_values=np.inf)])
        a = g.argmin(0); P[y] = a - 1; C = E[y][None, :] + np.take_along_axis(g, a[None], 0)[0]
    fin = np.full(len(st), np.inf)
    for d in (-1, 0, 1):
        e = np.clip(st + d, 0, k - 1); fin = np.minimum(fin, C[np.arange(len(st)), e])
    s = int(fin.argmin()); cand = [c for c in (st[s] - 1, st[s], st[s] + 1) if 0 <= c < k]; j = min(cand, key=lambda c: C[s, c]); path = [j]
    for y in range(n - 1, 0, -1): j += P[y, s, j]; path.append(j)
    return np.array(path[::-1])

def recolle(A, ferme):
    """raccord gauche-droite : l'image sortie fait m = n - k colonnes ; colonnes 0..k-1 = melange de A[:, x] et A[:, m + x]"""
    n = A.shape[1]; k = int(round(n * B)); m = n - k
    E = ((A[:, :k] - A[:, m:m + k]) ** 2).sum(2)
    E = E + 0.5 * np.pad(E[1:], ((0, 1), (0, 0)), mode='edge') + 0.5 * np.pad(E[:-1], ((1, 0), (0, 0)), mode='edge')
    c = coupe(E, ferme)
    x = np.arange(k)[None, :] + 0.5; t = np.clip((x - c[:, None]) / FE + 0.5, 0, 1); w = (t * t * (3 - 2 * t))[..., None]
    out = A[:, :m].copy(); out[:, :k] = w * A[:, :k] + (1 - w) * A[:, m:m + k]
    return out

A = recolle(A, False)                                  # gauche-droite
A = recolle(A.transpose(1, 0, 2), True).transpose(1, 0, 2)  # haut-bas, coupe fermee (le raccord gauche-droite reste exact)
im = Image.fromarray(A.clip(0, 255).astype(np.uint8)).resize((S, S), Image.LANCZOS)
im.save(dst + '.png', optimize=True); im.save(dst + '.jpg', quality=90)
a = np.asarray(im).astype(np.float32)
print(dst.split('/')[-1], im.size, 'ecart bords lr %.1f hb %.1f (interieur %.1f)' % (np.abs(a[:, 0] - a[:, -1]).mean(), np.abs(a[0] - a[-1]).mean(), np.abs(a[:, 255] - a[:, 256]).mean()))
