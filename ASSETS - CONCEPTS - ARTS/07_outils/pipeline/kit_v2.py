# Kit d'interface TinKnight, ajouts v2 : icones de HUD, bulles flottantes, cadres des nouvelles zones, ornements.
# usage : python3 kit_v2.py  -> tinyknight_ui_v2.css (a charger apres tinyknight_ui.css) et tinyknight_icones_v2.svg
import math, urllib.parse
def leaf(L, w):
    return f"M0 0C{w:.1f} {-L/3:.1f} {w:.1f} {-2*L/3:.1f} 0 {-L:.1f}C{-w:.1f} {-2*L/3:.1f} {-w:.1f} {-L/3:.1f} 0 0Z"
def cadre_svg(a, b, corner):
    g = ''.join(f'<g transform="rotate({r} 48 48)">{corner}</g>' for r in (0, 90, 180, 270))
    s = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect x="3" y="3" width="90" height="90" rx="16" fill="none" stroke="{a}" stroke-width="3"/>'
         f'<rect x="8.5" y="8.5" width="79" height="79" rx="11" fill="none" stroke="{b}" stroke-width="1.2" opacity=".8"/>{g}</svg>')
    return 'url("data:image/svg+xml,' + urllib.parse.quote(s, safe="/:=' ") + '")'
LF = lambda x, y, r, c, L=12, w=4: f'<path transform="translate({x} {y}) rotate({r})" d="{leaf(L, w)}" fill="{c}"/>'

HUD_ICONS = {
 "frapper": '<path d="M5 19L16 8"/><path d="M14 4l6 6-3 1-4-4z"/><path d="M4 15l5 5"/><path d="M19 15c-1 3-4 5-7 5"/>',
 "esquive": '<path d="M4 12h9"/><path d="M10 8l4 4-4 4"/><path d="M16 6l5 6-5 6"/><path d="M3 7h3M3 17h3"/>',
 "potion": '<path d="M10 3h4M11 3v5l-5 8a3 3 0 0 0 2.6 4.500h6.800A3 3 0 0 0 18 16l-5-8V3"/><path d="M8 14h8"/>',
 "bouclier": '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M12 7v9M8.500 11h7"/>',
 "cible": '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.500"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
 "auto": '<path d="M5 12a7 7 0 0 1 12-5l2 2"/><path d="M19 5v4h-4"/><path d="M19 12a7 7 0 0 1-12 5l-2-2"/><path d="M5 19v-4h4"/>',
 "boussole": '<circle cx="12" cy="12" r="9"/><path d="M15.500 8.500l-2 5-5 2 2-5z"/>',
 "discussion": '<path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M8 10h8M8 13h5"/>',
 "emote": '<circle cx="12" cy="12" r="9"/><path d="M8.500 14.500a4 4 0 0 0 7 0"/><path d="M9 9.500v.5M15 9.500v.5"/>',
 "cloche": '<path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
 "cadeau": '<rect x="4" y="10" width="16" height="10" rx="1.500"/><path d="M3 7h18v3H3zM12 7v13"/><path d="M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0"/>',
 "trophee": '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5c0 3 1 4 3 4.500M16 6h3c0 3-1 4-3 4.500"/><path d="M12 13v4M8 20h8M9.500 17h5"/>',
 "amis": '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M2.500 19a5.500 5.500 0 0 1 11 0M12.500 15.200A5.500 5.500 0 0 1 21.500 19"/>',
 "monture": '<path d="M5 19v-5c0-3 2-5 5-5h3l2-4 2 1-1 3 3 3-1 3-3-1v6"/><path d="M9 19v-4"/><path d="M15.500 9.500h.01"/>',
 "sort_1": '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 .5 2 1.500 2.500 2 2 .5-3-.5-5 1-8z"/>',
 "sort_2": '<path d="M12 3v18M4.200 7.500l15.600 9M19.800 7.500l-15.600 9"/><circle cx="12" cy="12" r="2.500"/>',
 "sort_3": '<path d="M13 3L5 13h5l-1 8 8-11h-5z"/>',
 "sort_4": '<path d="M12 21c-5-2-8-6-8-11 3 0 6 1 8 4 2-3 5-4 8-4 0 5-3 9-8 11z"/><path d="M12 14v7"/>',
}

# Cadres des nouvelles zones et cadres neutres : même mécanique que les sept premiers
HEX = lambda x, y, r, f, s: '<path d="' + ' '.join(('M' if i == 0 else 'L') + f'{x + r * math.cos(math.radians(60 * i + 30)):.1f} {y + r * math.sin(math.radians(60 * i + 30)):.1f}' for i in range(6)) + f'Z" fill="{f}" stroke="{s}" stroke-width="1.2"/>'
CADRES2 = {
 'canopee': ('#7da33a', '#e6f27a', LF(11, 11, 135, '#c8e85a', 15, 5) + LF(11, 11, 100, '#8fbf3f', 12, 4) + LF(11, 11, 170, '#8fbf3f', 12, 4) + '<circle cx="11" cy="11" r="2.4" fill="#5fb7ff"/>'),
 'mine': ('#8a7a5a', '#e0b25a', '<circle cx="12" cy="12" r="7" fill="#5c4a2c" stroke="#e0b25a" stroke-width="1.5"/>' + ''.join(f'<rect x="10.600" y="2.500" width="2.800" height="4" fill="#e0b25a" transform="rotate({a} 12 12)"/>' for a in range(0, 360, 60)) + '<circle cx="12" cy="12" r="2.600" fill="#8fd6ff"/>'),
 'ruche': ('#c98a1f', '#ffd65a', HEX(12, 12, 8, '#ffcf3f', '#6b4406') + HEX(12, 12, 3.600, '#fff1b8', '#6b4406')),
 'marais': ('#4f7a62', '#a9e0b6', '<circle cx="12" cy="12" r="7.500" fill="#5f9b74" stroke="#1c3a2a" stroke-width="1.2"/><path d="M12 12L19 8" stroke="#1c3a2a" stroke-width="1.4"/><circle cx="10.500" cy="13" r="2.400" fill="#ffb3d1"/>'),
 'pierre': ('#7d7a74', '#c9c5bb', '<rect x="5" y="5" width="14" height="14" rx="3" fill="#57544f" stroke="#c9c5bb" stroke-width="1.5"/><circle cx="12" cy="12" r="2.200" fill="#c9c5bb"/>'),
 'legende': ('#d9a63a', '#fff2c0', '<path d="M12 2l2.600 6.400L21 9l-5 4.400L17.500 20 12 16.500 6.500 20 8 13.400 3 9l6.400-.6z" fill="#ffd65a" stroke="#6b4406" stroke-width="1.1"/>'),
}
CADRES2_CSS = ''.join(f'.tk-cadre.{n} {{ border-image-source: {cadre_svg(a, b, c)}; }}\n' for n, (a, b, c) in CADRES2.items())

def _url(svg): return 'url("data:image/svg+xml,' + urllib.parse.quote(svg, safe="/:=' ") + '")'
def _sep(motif, c1):
    return _url(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 24"><path d="M4 12h86M150 12h86" stroke="{c1}" stroke-width="1.5" stroke-linecap="round" opacity=".7"/><circle cx="96" cy="12" r="2" fill="{c1}"/><circle cx="144" cy="12" r="2" fill="{c1}"/><g transform="translate(108 0)">{motif}</g></svg>')
SEPS = {
 'feuille': _sep(LF(12, 12, 90, '#a6d85a', 11, 4) + LF(12, 12, 270, '#7fb347', 11, 4) + '<circle cx="12" cy="12" r="2.200" fill="#ffc247"/>', '#a6d85a'),
 'ambre': _sep('<path d="M12 3l7 9-7 9-7-9z" fill="#ffc247" stroke="#7a4d08" stroke-width="1.2"/>', '#ffc247'),
 'cristal': _sep('<path d="M12 2l4 8-4 12-4-12z" fill="#8fd6ff" stroke="#17405c" stroke-width="1.2"/><path d="M5 9l4 3-2 6z" fill="#bfeaff"/><path d="M19 9l-4 3 2 6z" fill="#bfeaff"/>', '#8fd6ff'),
 'braise': _sep('<path d="M12 21c-4 0-6-3-6-6 0-3 2-4 3-7 1 1.500 2 2 2.500 1.500.5-2-.5-4 .5-6.500 4 3 6 7 6 12 0 3-2 6-6 6z" fill="#ff7a2e" stroke="#4a1505" stroke-width="1.1"/>', '#ff7a2e'),
 'spore': _sep('<path d="M4 14a8 7 0 0 1 16 0z" fill="#5fe3d0" stroke="#0e3b3a" stroke-width="1.2"/><path d="M10.500 14v5a1.500 1.500 0 0 0 3 0v-5" fill="#e6f6f3" stroke="#0e3b3a" stroke-width="1"/>', '#5fe3d0'),
 'ronce': _sep('<path d="M12 3l3 7 7 2-7 2-3 7-3-7-7-2 7-2z" fill="#c77dff" stroke="#2a1040" stroke-width="1.1"/>', '#c77dff'),
}

ORNEMENTS_CSS = '''
/* ---------- bulles flottantes du HUD ---------- */
.tk-fab { --tk-fab: 52px; --tk-cd: 0; position: relative; width: var(--tk-fab); height: var(--tk-fab); flex: none; border-radius: 50%; border: 2px solid var(--tk-accent); color: var(--tk-text); display: grid; place-items: center; cursor: pointer; padding: 0;
  background: radial-gradient(circle at 32% 26%, color-mix(in srgb, var(--tk-accent) 34%, var(--tk-panel-2)) 0, var(--tk-panel) 62%, var(--tk-well) 100%);
  box-shadow: 0 6px 14px rgba(0,0,0,.45), inset 0 2px 0 rgba(255,255,255,.18), inset 0 -6px 10px rgba(0,0,0,.35); }
.tk-fab .tk-ic { width: 46%; height: 46%; }
.tk-fab::before { content: ""; position: absolute; left: 20%; top: 11%; width: 34%; height: 20%; border-radius: 50%; background: rgba(255,255,255,.22); filter: blur(1px); pointer-events: none; }
.tk-fab::after { content: ""; position: absolute; inset: -2px; border-radius: 50%; pointer-events: none; background: conic-gradient(rgba(0,0,0,.62) calc(var(--tk-cd) * 360deg), transparent 0); }
.tk-fab.petit { --tk-fab: 40px; } .tk-fab.grand { --tk-fab: 68px; border-width: 3px; }
.tk-fab.plein { background: radial-gradient(circle at 32% 26%, color-mix(in srgb, var(--tk-accent) 70%, #fff) 0, var(--tk-accent) 55%, color-mix(in srgb, var(--tk-accent) 62%, #000) 100%); color: var(--tk-accent-ink); }
.tk-fab.rare { border-color: var(--tk-rare); } .tk-fab.epique { border-color: var(--tk-epic); } .tk-fab.legende { border-color: var(--tk-legend); box-shadow: 0 0 0 3px color-mix(in srgb, var(--tk-legend) 28%, transparent), 0 6px 14px rgba(0,0,0,.45), inset 0 2px 0 rgba(255,255,255,.18); }
.tk-fab.verrou { border-color: var(--tk-line); color: var(--tk-muted); filter: saturate(.3); cursor: default; }
.tk-fab.alerte { animation: tk-pouls 1.4s ease-in-out infinite; }
.tk-fab:focus-visible { outline: 3px solid var(--tk-text); outline-offset: 3px; }
.tk-fab:active:not(.verrou) { transform: scale(.94); }
.tk-fab-pastille { position: absolute; right: -4px; top: -4px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; background: var(--tk-bad); color: #fff; font: 700 11px/20px var(--tk-font-body); text-align: center; border: 2px solid var(--tk-bg); z-index: 1; font-variant-numeric: tabular-nums; }
.tk-fab-pastille.bon { background: var(--tk-good); color: #10240f; }
.tk-fab-nom { position: absolute; left: 50%; top: calc(100% + 4px); transform: translateX(-50%); font: 700 10.5px var(--tk-font-body); color: var(--tk-text); white-space: nowrap; text-shadow: 0 1px 2px #000, 0 0 6px rgba(0,0,0,.8); pointer-events: none; }
.tk-flotte { display: flex; flex-direction: column; gap: 12px; align-items: center; }
.tk-flotte.ligne { flex-direction: row; }
.tk-flotte > .tk-fab { animation: tk-flotte 3.6s ease-in-out infinite; }
.tk-flotte > .tk-fab:nth-child(2n) { animation-delay: -1.2s; } .tk-flotte > .tk-fab:nth-child(3n) { animation-delay: -2.3s; }
.tk-flotte > .tk-fab.alerte { animation: tk-flotte 3.6s ease-in-out infinite, tk-pouls 1.4s ease-in-out infinite; }
/* éventail : le gros bouton d'action et ses satellites en arc, à ancrer en bas à droite */
.tk-eventail { position: relative; width: 150px; height: 150px; }
.tk-eventail > .tk-fab { position: absolute; }
.tk-eventail > .tk-fab:nth-child(1) { right: 0; bottom: 0; }
.tk-eventail > .tk-fab:nth-child(2) { right: 80px; bottom: 2px; }
.tk-eventail > .tk-fab:nth-child(3) { right: 62px; bottom: 62px; }
.tk-eventail > .tk-fab:nth-child(4) { right: 2px; bottom: 82px; }
@keyframes tk-flotte { 0%, 100% { translate: 0 0; } 50% { translate: 0 -4px; } }
@keyframes tk-pouls { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--tk-bad) 70%, transparent), 0 6px 14px rgba(0,0,0,.45); } 50% { box-shadow: 0 0 0 9px transparent, 0 6px 14px rgba(0,0,0,.45); } }
@media (prefers-reduced-motion: reduce) { .tk-flotte > .tk-fab, .tk-fab.alerte { animation: none; } }

/* ---------- ornements : séparateurs, titres ornés, rubans, médaillons, coins ---------- */
.tk-sep { height: 24px; border: 0; margin: 8px 0; background: center / 240px 24px no-repeat; }
''' + ''.join(f'.tk-sep.{n} {{ background-image: {u}; }}\n' for n, u in SEPS.items()) + '''
.tk-titre-orne { display: flex; align-items: center; gap: 10px; font: 700 22px/1.1 var(--tk-font-display); color: var(--tk-accent); margin: 0; }
.tk-titre-orne::before, .tk-titre-orne::after { content: ""; flex: 1; height: 2px; min-width: 16px; border-radius: 2px; background: linear-gradient(90deg, transparent, var(--tk-accent)); }
.tk-titre-orne::after { background: linear-gradient(270deg, transparent, var(--tk-accent)); }
.tk-ruban { position: relative; display: inline-block; padding: 7px 26px; font: 700 17px/1.1 var(--tk-font-display); color: var(--tk-accent-ink); background: var(--tk-accent); text-align: center;
  clip-path: polygon(0 0, 100% 0, calc(100% - 12px) 50%, 100% 100%, 0 100%, 12px 50%); box-shadow: inset 0 -3px 0 rgba(0,0,0,.18), inset 0 2px 0 rgba(255,255,255,.3); }
.tk-ruban.sombre { background: var(--tk-panel-2); color: var(--tk-accent); }
.tk-medaillon { --tk-med: 64px; width: var(--tk-med); height: var(--tk-med); flex: none; border-radius: 50%; display: grid; place-items: center; color: var(--tk-accent); position: relative;
  background: radial-gradient(circle at 35% 30%, var(--tk-panel-2), var(--tk-well)); border: 3px solid var(--tk-accent); box-shadow: 0 0 0 2px var(--tk-bg), 0 0 0 4px color-mix(in srgb, var(--tk-accent) 55%, transparent); }
.tk-medaillon img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
.tk-medaillon .tk-ic { width: 50%; height: 50%; }
.tk-medaillon.rare { border-color: var(--tk-rare); box-shadow: 0 0 0 2px var(--tk-bg), 0 0 0 4px color-mix(in srgb, var(--tk-rare) 55%, transparent); color: var(--tk-rare); }
.tk-medaillon.epique { border-color: var(--tk-epic); box-shadow: 0 0 0 2px var(--tk-bg), 0 0 0 4px color-mix(in srgb, var(--tk-epic) 55%, transparent); color: var(--tk-epic); }
.tk-medaillon.legende { border-color: var(--tk-legend); box-shadow: 0 0 0 2px var(--tk-bg), 0 0 0 4px color-mix(in srgb, var(--tk-legend) 60%, transparent), 0 0 18px color-mix(in srgb, var(--tk-legend) 55%, transparent); color: var(--tk-legend); }
.tk-medaillon > b { position: absolute; bottom: -8px; left: 50%; transform: translateX(-50%); background: var(--tk-accent); color: var(--tk-accent-ink); font: 700 11px/1 var(--tk-font-body); padding: 3px 7px; border-radius: 999px; white-space: nowrap; }
/* coins : quatre équerres dessinées en fond, pour encadrer légèrement n'importe quel bloc */
.tk-coins { --c: var(--tk-accent); padding: 12px; background:
  linear-gradient(var(--c), var(--c)) left top / 16px 2px no-repeat, linear-gradient(var(--c), var(--c)) left top / 2px 16px no-repeat,
  linear-gradient(var(--c), var(--c)) right top / 16px 2px no-repeat, linear-gradient(var(--c), var(--c)) right top / 2px 16px no-repeat,
  linear-gradient(var(--c), var(--c)) left bottom / 16px 2px no-repeat, linear-gradient(var(--c), var(--c)) left bottom / 2px 16px no-repeat,
  linear-gradient(var(--c), var(--c)) right bottom / 16px 2px no-repeat, linear-gradient(var(--c), var(--c)) right bottom / 2px 16px no-repeat, var(--tk-panel); }
'''

if __name__ == '__main__':
    open('tinyknight_ui_v2.css', 'w').write("/* TinKnight - kit d'interface, ajouts v2 : a charger apres tinyknight_ui.css */\n" + CADRES2_CSS + ORNEMENTS_CSS)
    open('tinyknight_icones_v2.svg', 'w').write('<svg xmlns="http://www.w3.org/2000/svg" style="display:none">' + ''.join(f'<symbol id="tk-{n}" viewBox="0 0 24 24">{b}</symbol>' for n, b in HUD_ICONS.items()) + '</svg>\n')
    print(len(HUD_ICONS), 'icones', len(CADRES2), 'cadres', len(SEPS), 'separateurs')
