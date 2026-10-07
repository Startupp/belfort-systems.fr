// Charge un monstre animé et pilote ses clips : repos, marche, attaque, touche, mort.
//   const m = await chargerMonstre(THREE, new GLTFLoader(), 'bipedes/monstre_champignon_grognon.glb');
//   scene.add(m.objet);  m.jouer('marche');  m.jouer('attaque');   // attaque et touche reviennent seules au repos
//   m.maj(dt);           // à chaque image, dt en secondes
export async function chargerMonstre(THREE, loader, url) {
  const gltf = await loader.loadAsync(url), objet = gltf.scene, mixer = new THREE.AnimationMixer(objet), actions = {};
  for (const clip of gltf.animations) {
    const a = mixer.clipAction(clip);
    if (clip.name === 'attaque' || clip.name === 'touche' || clip.name === 'mort') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = clip.name === 'mort'; }
    actions[clip.name] = a;
  }
  let courant = null, fond = 'repos';
  function jouer(nom, fondu = 0.12) {
    const a = actions[nom]; if (!a) return;
    if (nom === 'repos' || nom === 'marche') { fond = nom; if (a === courant) return; }
    a.reset().setEffectiveWeight(1).fadeIn(fondu).play();
    if (courant && courant !== a) courant.fadeOut(fondu);
    courant = a;
  }
  mixer.addEventListener('finished', e => { const n = e.action.getClip().name; if (n === 'attaque' || n === 'touche') jouer(fond); });
  jouer('repos', 0);
  return { objet, mixer, actions, jouer, maj: dt => mixer.update(dt), famille: (objet.userData || {}).famille, get clip() { return courant ? courant.getClip().name : null; } };
}
