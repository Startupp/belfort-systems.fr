# Invites des images du kit de volume (pack 7). Une image par piece, modele gpt_image_2_5, format 1:1, 4 a la fois au plus.
Z = {'racines': 'thick twisting giant tree roots and bark, green moss, small ferns, a few glowing amber sap crystals',
     'mycelium': 'dark blue-violet rock covered with teal and violet bioluminescent mushrooms with glowing cyan spots, hanging mycelium threads',
     'braises': 'black basalt rock with glowing orange lava cracks, charred wood, small embers',
     'givre': 'blue-grey stone under thick snow, faceted pale blue ice crystals, small icicles',
     'abimes': 'dark indigo ancient stone with faint glowing violet runes, purple thorny brambles, a few glowing magenta flowers',
     'canopee': 'living warm wood and bark, big bright green leaves, rope bindings, small wooden planks',
     'mine': 'brown layered rock with wooden support beams, pale blue crystals and gold ore veins',
     'ruche': 'golden hexagonal honeycomb wax with dripping amber honey, a few white flowers',
     'marais': 'dark mossy mud and twisted willow roots, cattails, pink water lilies, hanging moss'}
REPERE = {'racines': 'an old gnarled tree stump taller than wide with roots spreading at its base, a hanging lantern and amber sap crystals',
     'mycelium': 'a cluster of three giant bioluminescent mushrooms of different heights on a dark rock, deep teal caps with glowing cyan spots, violet gills',
     'braises': 'a ruined stone forge chimney with glowing lava inside, basalt blocks and charred beams around its base',
     'givre': 'a tall spire of faceted pale blue ice crystals rising from a snowy rock',
     'abimes': 'a broken ancient stone arch fragment with glowing violet runes, wrapped in purple thorny brambles',
     'canopee': 'a thick living tree trunk post with a small round wooden platform, rope railing, big leaves and a hanging lantern',
     'mine': 'a wooden mine support frame (two posts and a beam) with a hanging oil lamp, blue crystals and ore rocks at its base',
     'ruche': 'a small tower of stacked golden honeycomb cells with dripping honey and a honey pot at its base',
     'marais': 'a twisted willow stump with hanging moss, cattails and a glowing green wisp lantern on a small mud island'}
PIECE = {'massif': 'Game terrain prop, single object: a chunky irregular wall mass, roughly as tall as wide, rounded organic bumpy silhouette (clearly not a cube, no flat box sides), made of {m}. Rich detail on the front and top.',
     'pied': 'Game terrain prop, single object: a low wide pile sitting on the ground at the foot of a wall, about three times wider than tall, irregular organic outline, made of {m}.',
     'cime': 'Game terrain prop, single object: a wide low clump that sits on top of a wall and spills over its front edge, about twice as wide as tall, irregular organic outline, made of {m}.',
     'butte': 'Game terrain prop, single object: a very low wide mound of ground, about five times wider than tall, soft irregular rounded outline (not square), nearly flat on top, made of {m}.',
     'repere': 'Game landmark prop, single object: {r}.'}
FIN = ' Three-quarter view from slightly above, whole object centred with margin. Stylized low-poly hand-painted, chunky, saturated colours. Plain flat light grey background, even light, no cast shadow, no text.'
if __name__ == '__main__':
    for z in Z:
        for p in PIECE: print(f'd_{z}_{p}\t' + PIECE[p].format(m=Z[z], r=REPERE[z]) + FIN)
