# fabrique nv/<zone>.json : meme salle pour chaque zone, avec le kit de volume de la zone (les pieces absentes sont sautees)
import json, os, sys
Z = {'racines': ('#120b05', '#aaa69c', '#d6b47c', '#2b1d10', '#ffdca6', 'commun'), 'mycelium': ('#03121a', '#b4cbcc', '#86dcd4', '#101a30', '#a6ecff', 'rare'),
     'braises': ('#1a0703', '#c4aaa0', '#ff9d66', '#2a0d06', '#ffb47e', 'legendaire'), 'givre': ('#1f3043', '#a9b8c6', '#e2f3ff', '#4a6178', '#eef8ff', 'rare'), 'abimes': ('#120826', '#c0b4d6', '#b896ff', '#1a0c2a', '#cdb0ff', 'legendaire')}
MAP = ["################", "################", "##............##", "##............##", "##............##", "##....##......##", "##............##", "##............##", "####........####", "################"]
for z in sys.argv[1:]:
    fog, tint, sky, gnd, sun, cof = Z[z]; k = lambda p: f'out/d_{z}_{p}.glb'
    P = [dict(f=k('massif'), x=3.2, z=2.35, s=1.6), dict(f=k('massif'), x=12.9, z=2.3, s=1.45, rot=.5), dict(f=k('massif'), x=2.4, z=6.4, s=1.2, rot=1.2),
         dict(f=k('cime'), wall=[5, 1], s=1.5), dict(f=k('cime'), wall=[9, 1], s=1.3, rot=.3), dict(f=k('cime'), wall=[11, 1], s=1.5, rot=-.2), dict(f=k('cime'), wall=[7, 1], s=1.2, rot=-.3),
         dict(f=k('pied'), x=6.2, z=2.45, s=1.5), dict(f=k('pied'), x=10.2, z=2.4, s=1.2, rot=3.1),
         dict(f=k('butte'), x=9.6, z=6.6, s=1.8), dict(f=k('butte'), x=4.6, z=3.6, s=1.3, rot=2),
         dict(f=k('repere'), x=10.8, z=3.7, s=2.0), dict(f=f'dep2/b_{z}_pilier.glb', x=6.5, z=5.5, s=1.5),
         dict(f=f'dep2/d_coffre_{cof}.glb', raw=1, x=12.3, z=6.7, s=.7, rot=-.5), dict(f='out/chevalier_champignon.glb', raw=1, x=8, z=5.4, s=.95, clip='epee_taille', t=1.4)]
    P = [p for p in P if os.path.exists(p['f'])]
    json.dump(dict(map=MAP, focus=[8, 4.6], halfW=6.6, seed=11, hemi=.95, fogNear=7.5, fogFar=15, fog=fog, tint=tint, sky=sky, gnd=gnd, sun=sun,
                   tex=dict(sol=f'g/t2_{z}_sol_naturel.jpg', mur=f'g/t2_{z}_mur.jpg', dessus=f'g/t2_{z}_dessus.jpg'), props=P), open(f'nv/{z}.json', 'w')); print(z, len(P), 'objets')
