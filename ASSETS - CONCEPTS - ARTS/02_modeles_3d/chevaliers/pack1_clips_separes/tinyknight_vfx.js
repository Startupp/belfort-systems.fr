/* TinyKnight VFX — effets de sorts en particules pour Three.js (aucune texture, aucun fichier externe).
 * Usage :
 *   const vfx = createVFX(THREE, scene);
 *   vfx.setViewport(renderer.domElement.height, camera.fov);   // à refaire à chaque resize
 *   vfx.play('explosion', new THREE.Vector3(0, 0, 0));          // options : { color, scale, to, colors, height }
 *   vfx.update(dt);                                             // à chaque image, dt en secondes
 * Liste des effets : vfx.names
 */
export function createVFX(THREE, scene) {
  const actors = [], timers = [];
  const uScale = { value: 600 };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[(Math.random() * a.length) | 0];
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = t => 1 - (1 - t) * (1 - t);
  const C = {
    white: 0xffffff, amber: 0xffb52e, ember: 0xffe08a, fire: 0xff5a1a, smoke: 0x3a2a22,
    moss: 0x7ee05a, water: 0x4fb8ff, ice: 0xbfeaff, bramble: 0xa24bff, pink: 0xff7ad9,
    poison: 0x9be000, gold: 0xffd75a, wood: 0x6b4423, dust: 0xcbb994
  };
  const sphereDir = () => { const u = rand(-1, 1), t = rand(0, 6.2832), s = Math.sqrt(1 - u * u); return V(s * Math.cos(t), u, s * Math.sin(t)); };
  const discOffset = r => { const a = rand(0, 6.2832), d = Math.sqrt(Math.random()) * r; return V(Math.cos(a) * d, 0, Math.sin(a) * d); };

  // --- matériau de particules : forme dessinée dans le shader (0 halo, 1 losange, 2 étoile, 3 croix) ---
  const VS = 'attribute vec3 aColor;attribute float aSize;attribute float aAlpha;varying vec3 vColor;varying float vAlpha;uniform float uScale;' +
    'void main(){vColor=aColor;vAlpha=aAlpha;vec4 mv=modelViewMatrix*vec4(position,1.0);gl_PointSize=aSize*uScale/max(0.1,-mv.z);gl_Position=projectionMatrix*mv;}';
  const FS = 'varying vec3 vColor;varying float vAlpha;uniform float uShape;' +
    'void main(){vec2 p=gl_PointCoord-0.5;float a;' +
    'if(uShape<0.5){a=smoothstep(0.5,0.0,length(p));a*=a;}' +
    'else if(uShape<1.5){a=step(abs(p.x)+abs(p.y),0.5);}' +
    'else if(uShape<2.5){a=smoothstep(0.02,0.0,abs(p.x)*abs(p.y))*smoothstep(0.5,0.25,length(p));}' +
    'else{a=max(step(abs(p.x),0.11)*step(abs(p.y),0.38),step(abs(p.y),0.11)*step(abs(p.x),0.38));}' +
    'if(a*vAlpha<0.01)discard;gl_FragColor=vec4(vColor,a*vAlpha);}';
  const mats = {};
  const mat = (shape, blend) => {
    const k = shape + blend;
    return mats[k] || (mats[k] = new THREE.ShaderMaterial({
      uniforms: { uScale, uShape: { value: shape } }, vertexShader: VS, fragmentShader: FS,
      transparent: true, depthWrite: false, blending: blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending
    }));
  };

  // --- gerbe de particules ---
  // o : { pos, count, shape, blend, gravity, drag, floor, alpha, init(i) -> { v, life, size, sizeEnd, color, colorEnd, delay, offset, twinkle, orbit } }
  function burst(o) {
    const n = o.count, P = new Float32Array(n * 3), Cc = new Float32Array(n * 3), S = new Float32Array(n), A = new Float32Array(n);
    const parts = [], c0 = new THREE.Color(), c1 = new THREE.Color(), baseA = o.alpha == null ? 1 : o.alpha;
    for (let i = 0; i < n; i++) {
      const p = o.init(i); p.age = -(p.delay || 0); p.v = p.v || V(0, 0, 0);
      const f = p.offset || V(0, 0, 0); p.x = o.pos.x + f.x; p.y = o.pos.y + f.y; p.z = o.pos.z + f.z;
      if (p.sizeEnd == null) p.sizeEnd = 0; if (p.colorEnd == null) p.colorEnd = p.color;
      parts.push(p);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('aColor', new THREE.BufferAttribute(Cc, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(S, 1)); geo.setAttribute('aAlpha', new THREE.BufferAttribute(A, 1));
    const pts = new THREE.Points(geo, mat(o.shape || 0, o.blend || 'add')); pts.frustumCulled = false; scene.add(pts);
    const g = o.gravity || 0, drag = o.drag || 0;
    actors.push({
      update(dt) {
        let alive = 0;
        for (let i = 0; i < n; i++) {
          const p = parts[i]; p.age += dt;
          if (p.age < 0) { A[i] = 0; alive++; continue; }
          const t = p.age / p.life; if (t >= 1) { A[i] = 0; continue; }
          alive++;
          if (p.orbit) {
            const q = p.orbit; q.ang += q.w * dt; q.r = Math.max(0, q.r + (q.dr || 0) * dt);
            p.x = o.pos.x + Math.cos(q.ang) * q.r; p.z = o.pos.z + Math.sin(q.ang) * q.r; p.y += (q.vy || 0) * dt;
          } else {
            p.v.y -= g * dt; if (drag) p.v.multiplyScalar(Math.max(0, 1 - drag * dt));
            p.x += p.v.x * dt; p.y += p.v.y * dt; p.z += p.v.z * dt;
            if (o.floor != null && p.y < o.floor) { p.y = o.floor; p.v.y *= -0.3; p.v.x *= 0.5; p.v.z *= 0.5; }
          }
          P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z;
          S[i] = lerp(p.size, p.sizeEnd, t);
          let a = t < 0.12 ? t / 0.12 : 1 - Math.pow((t - 0.12) / 0.88, 1.6);
          if (p.twinkle) a *= 0.55 + 0.45 * Math.sin(p.age * 34 + i * 1.7);
          A[i] = a * baseA;
          c0.setHex(p.color); if (p.colorEnd !== p.color) c0.lerp(c1.setHex(p.colorEnd), t);
          Cc[i * 3] = c0.r; Cc[i * 3 + 1] = c0.g; Cc[i * 3 + 2] = c0.b;
        }
        for (const k in geo.attributes) geo.attributes[k].needsUpdate = true;
        return alive > 0;
      },
      dispose() { scene.remove(pts); geo.dispose(); }
    });
  }
  const flash = (pos, color, size, life) => burst({ pos, count: 1, init: () => ({ life: life || 0.14, size, sizeEnd: size * 1.6, color }) });

  // --- anneau au sol ---
  const ringGeo = {};
  function ring(pos, o) {
    const w = o.width || 0.14, geo = ringGeo[w] || (ringGeo[w] = new THREE.RingGeometry(1 - w, 1, 40));
    const m = new THREE.MeshBasicMaterial({ color: o.color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(geo, m); mesh.rotation.x = -Math.PI / 2; mesh.position.set(pos.x, pos.y + 0.03, pos.z); mesh.visible = false; scene.add(mesh);
    let age = -(o.delay || 0); const life = o.life || 0.5, r0 = o.r0 == null ? 0.1 : o.r0, r1 = o.r1 || 2, op = o.opacity || 0.9;
    actors.push({
      update(dt) { age += dt; if (age < 0) return true; const t = age / life; if (t >= 1) return false; mesh.visible = true; const s = lerp(r0, r1, easeOut(t)); mesh.scale.set(s, s, s); m.opacity = op * (1 - t); return true; },
      dispose() { scene.remove(mesh); m.dispose(); }
    });
  }

  // --- éclats low-poly (petits tétraèdres) ---
  const shardGeo = new THREE.TetrahedronGeometry(1);
  function shards(pos, o) {
    const m = new THREE.MeshBasicMaterial({ color: o.color, transparent: true }), list = [], life = o.life || 0.9, g = o.gravity == null ? 9 : o.gravity;
    for (let i = 0; i < o.count; i++) {
      const mesh = new THREE.Mesh(shardGeo, m), d = sphereDir(); d.y = Math.abs(d.y) * (o.up || 1.4) + 0.2;
      mesh.position.copy(pos); mesh.scale.setScalar(rand(0.5, 1) * (o.size || 0.12)); mesh.rotation.set(rand(0, 6), rand(0, 6), 0);
      mesh.userData = { v: d.multiplyScalar(rand(0.6, 1) * (o.speed || 4)), s: V(rand(-9, 9), rand(-9, 9), rand(-9, 9)), k: mesh.scale.x };
      scene.add(mesh); list.push(mesh);
    }
    let age = 0;
    actors.push({
      update(dt) {
        age += dt; const t = age / life; if (t >= 1) return false;
        for (const me of list) {
          const u = me.userData; u.v.y -= g * dt; me.position.addScaledVector(u.v, dt);
          if (me.position.y < pos.y) { me.position.y = pos.y; u.v.y *= -0.35; u.v.x *= 0.6; u.v.z *= 0.6; }
          me.rotation.x += u.s.x * dt; me.rotation.y += u.s.y * dt; me.scale.setScalar(u.k * (1 - t * t));
        }
        m.opacity = 1 - t * t * t; return true;
      },
      dispose() { for (const me of list) scene.remove(me); m.dispose(); }
    });
  }
  const after = (t, fn) => timers.push({ t, fn });

  // ------------------------------------------------------------------ effets
  const fx = {
    impact(pos, o) {
      const k = o.scale || 1, c = o.color || C.amber;
      flash(pos, C.white, 1.3 * k, 0.1);
      burst({ pos, count: 14, shape: 1, gravity: 5, init: () => ({ v: sphereDir().multiplyScalar(rand(2, 5) * k), life: rand(0.22, 0.42), size: 0.24 * k, color: C.white, colorEnd: c }) });
      ring(pos, { color: c, r1: 0.9 * k, life: 0.25 });
    },
    explosion(pos, o) {
      const k = o.scale || 1, c = o.color || C.fire, p = pos.clone(); p.y += 0.3 * k;
      flash(p, C.ember, 4.5 * k, 0.16);
      burst({ pos: p, count: 44, drag: 2.2, init: () => ({ v: sphereDir().multiplyScalar(rand(1.5, 5.5) * k), life: rand(0.4, 0.85), size: rand(0.7, 1.1) * k, sizeEnd: 0.15, color: C.ember, colorEnd: c }) });
      burst({ pos: p, count: 14, blend: 'normal', alpha: 0.55, drag: 1.5, init: () => ({ v: V(rand(-1, 1), rand(0.8, 2.2), rand(-1, 1)).multiplyScalar(k), life: rand(0.9, 1.5), size: 0.7 * k, sizeEnd: 2 * k, color: C.smoke, delay: rand(0.05, 0.2) }) });
      burst({ pos: p, count: 22, shape: 1, gravity: 7, floor: pos.y, init: () => ({ v: sphereDir().multiplyScalar(rand(3, 7) * k), life: rand(0.6, 1), size: 0.2 * k, color: C.ember, colorEnd: c }) });
      shards(pos, { count: 10, color: o.debris || C.wood, speed: 5 * k, size: 0.13 * k });
      ring(pos, { color: c, r1: 3.2 * k, life: 0.45 });
    },
    splash(pos, o) {
      const k = o.scale || 1, c = o.color || C.water;
      burst({ pos, count: 38, shape: 0, gravity: 13, floor: pos.y, init: () => { const d = discOffset(1); return { v: V(d.x * rand(1.2, 2.6) * k, rand(2.6, 5.2) * k, d.z * rand(1.2, 2.6) * k), life: rand(0.55, 0.9), size: rand(0.25, 0.4) * k, sizeEnd: 0.1, color: C.white, colorEnd: c }; } });
      burst({ pos, count: 12, shape: 1, gravity: 13, init: () => ({ v: V(rand(-0.6, 0.6), rand(4, 6.5) * k, rand(-0.6, 0.6)), life: rand(0.5, 0.8), size: 0.2 * k, color: c }) });
      ring(pos, { color: c, r1: 1.7 * k, life: 0.5 }); ring(pos, { color: C.white, r1: 1.1 * k, life: 0.45, delay: 0.12, width: 0.08 });
    },
    feu_artifice(pos, o) {
      const k = o.scale || 1, h = o.height || 4.5, dur = 0.55, cols = o.colors || pick([[C.gold, C.fire], [C.pink, C.bramble], [C.water, C.ice], [C.moss, C.gold]]);
      const n = 26;
      burst({ pos, count: n, init: i => ({ offset: V(0, h * easeOut(i / n), 0), v: V(rand(-0.2, 0.2), -0.6, rand(-0.2, 0.2)), delay: i / n * dur, life: 0.32, size: 0.28 * k, color: C.ember, colorEnd: C.fire }) });
      after(dur, () => {
        const top = pos.clone(); top.y += h;
        flash(top, C.white, 3.5 * k, 0.12);
        burst({ pos: top, count: 96, shape: 2, drag: 2.4, gravity: 1.8, init: i => ({ v: sphereDir().multiplyScalar((i % 3 ? 4.6 : 2.6) * k), life: rand(1, 1.5), size: 0.42 * k, sizeEnd: 0.1, color: cols[i % 2], colorEnd: cols[(i + 1) % 2], twinkle: true }) });
        burst({ pos: top, count: 24, drag: 2.4, gravity: 2.5, init: () => ({ v: sphereDir().multiplyScalar(3.4 * k), life: rand(1.2, 1.7), size: 0.2 * k, color: C.white, twinkle: true }) });
      });
    },
    soin(pos, o) {
      const k = o.scale || 1, c = o.color || C.moss;
      burst({ pos, count: 20, shape: 3, init: () => ({ offset: discOffset(0.7 * k), v: V(0, rand(0.9, 1.8), 0), delay: rand(0, 0.5), life: rand(0.8, 1.2), size: rand(0.28, 0.42) * k, sizeEnd: 0.12, color: C.white, colorEnd: c }) });
      burst({ pos, count: 14, alpha: 0.5, init: () => ({ offset: discOffset(0.5 * k), v: V(0, rand(0.6, 1.4), 0), delay: rand(0, 0.4), life: rand(0.9, 1.3), size: 0.9 * k, sizeEnd: 0.3, color: c }) });
      ring(pos, { color: c, r0: 0.2, r1: 1.3 * k, life: 0.7 }); ring(pos, { color: C.white, r0: 0.2, r1: 0.9 * k, life: 0.6, delay: 0.25, width: 0.07 });
    },
    bouclier(pos, o) {
      const k = o.scale || 1, c = o.color || C.water, n = 54;
      burst({ pos, count: n, shape: 1, init: i => ({ offset: V(0, 0.25 + (i % 3) * 0.5, 0), orbit: { ang: i / n * 6.2832 * 3, r: 0.85 * k, w: i % 2 ? 4.5 : -4.5 }, delay: (i % 18) * 0.012, life: 1.7, size: 0.2 * k, sizeEnd: 0.08, color: C.white, colorEnd: c }) });
      burst({ pos, count: 1, alpha: 0.35, init: () => ({ offset: V(0, 0.8, 0), life: 1.6, size: 3.2 * k, sizeEnd: 3.6 * k, color: c }) });
      ring(pos, { color: c, r0: 0.3, r1: 1 * k, life: 0.5 }); ring(pos, { color: c, r0: 0.9 * k, r1: 1 * k, life: 1.6, opacity: 0.6, width: 0.06 });
    },
    eclair(pos, o) {
      const k = o.scale || 1, c = o.color || 0x9fd4ff, h = o.height || 5.5;
      const strike = () => {
        const pts = [], seg = 11; let x = 0, z = 0;
        for (let i = 0; i <= seg; i++) { pts.push(V(x, h * (1 - i / seg), z)); x = i >= seg - 1 ? 0 : x + rand(-0.38, 0.38); z = i >= seg - 1 ? 0 : z + rand(-0.38, 0.38); }
        burst({ pos, count: seg * 5, init: i => { const a = pts[(i / 5) | 0], b = pts[Math.min(seg, ((i / 5) | 0) + 1)], f = (i % 5) / 5; return { offset: a.clone().lerp(b, f), life: 0.2, size: 0.55 * k, sizeEnd: 0.2, color: C.white, colorEnd: c }; } });
      };
      strike(); after(0.07, strike); after(0.16, strike);
      flash(pos, c, 4 * k, 0.22);
      burst({ pos, count: 18, shape: 1, gravity: 8, init: () => { const d = sphereDir(); d.y = Math.abs(d.y); return { v: d.multiplyScalar(rand(2, 6) * k), life: rand(0.3, 0.6), size: 0.2 * k, color: C.white, colorEnd: c }; } });
      ring(pos, { color: c, r1: 1.8 * k, life: 0.35 });
    },
    glace(pos, o) {
      const k = o.scale || 1, c = o.color || C.ice;
      flash(pos, C.white, 2.2 * k, 0.12);
      shards(pos, { count: 14, color: c, speed: 4.5 * k, size: 0.18 * k, up: 1.8, life: 1 });
      burst({ pos, count: 30, shape: 1, gravity: 5, drag: 1, init: () => { const d = sphereDir(); d.y = Math.abs(d.y); return { v: d.multiplyScalar(rand(1.5, 4.5) * k), life: rand(0.5, 0.95), size: 0.22 * k, color: C.white, colorEnd: C.water, twinkle: true }; } });
      burst({ pos, count: 10, alpha: 0.3, drag: 2, init: () => ({ offset: discOffset(0.6 * k), v: V(rand(-1, 1), 0.3, rand(-1, 1)), life: rand(0.8, 1.2), size: 1.2 * k, sizeEnd: 2 * k, color: c }) });
      ring(pos, { color: c, r1: 2.3 * k, life: 0.6 });
    },
    poison(pos, o) {
      const k = o.scale || 1, cols = o.colors || [C.poison, C.bramble];
      burst({ pos, count: 26, blend: 'normal', alpha: 0.45, drag: 0.8, init: i => ({ offset: discOffset(0.4 * k), v: V(rand(-0.9, 0.9), rand(0.2, 0.7), rand(-0.9, 0.9)).multiplyScalar(k), delay: rand(0, 0.3), life: rand(1.4, 2.2), size: 0.6 * k, sizeEnd: 1.7 * k, color: cols[i % 2] }) });
      burst({ pos, count: 16, shape: 1, init: () => ({ offset: discOffset(0.8 * k), v: V(rand(-0.3, 0.3), rand(0.4, 1.1), rand(-0.3, 0.3)), delay: rand(0, 0.8), life: rand(0.9, 1.5), size: 0.16 * k, color: cols[0], twinkle: true }) });
      ring(pos, { color: cols[0], r1: 1.6 * k, life: 0.8, opacity: 0.6 });
    },
    projectile(pos, o) {
      const k = o.scale || 1, c = o.color || C.amber, to = o.to || pos.clone().add(V(5, 0, 0)), d = to.clone().sub(pos), dur = d.length() / (o.speed || 11), n = 44;
      burst({ pos, count: n, init: i => ({ offset: d.clone().multiplyScalar(i / n).add(V(rand(-0.06, 0.06), rand(-0.06, 0.06), rand(-0.06, 0.06))), delay: i / n * dur, life: 0.3, size: 0.4 * k, color: C.white, colorEnd: c }) });
      burst({ pos, count: 1, init: () => ({ v: d.clone().multiplyScalar(1 / dur), life: dur, size: 0.9 * k, sizeEnd: 0.9 * k, color: c }) });
      after(dur, () => (o.onHit ? o.onHit(to) : fx.impact(to, { color: c, scale: 1.4 * k })));
    },
    onde_de_choc(pos, o) {
      const k = o.scale || 1, c = o.color || C.ember;
      ring(pos, { color: c, r1: 3.4 * k, life: 0.5, width: 0.2 }); ring(pos, { color: C.white, r1: 2.6 * k, life: 0.45, delay: 0.08, width: 0.08 }); ring(pos, { color: c, r1: 2 * k, life: 0.45, delay: 0.16 });
      burst({ pos, count: 28, blend: 'normal', alpha: 0.5, drag: 3, init: i => { const a = i / 28 * 6.2832; return { v: V(Math.cos(a) * rand(4, 6) * k, rand(0.3, 1), Math.sin(a) * rand(4, 6) * k), life: rand(0.5, 0.85), size: 0.5 * k, sizeEnd: 1.3 * k, color: C.dust }; } });
      shards(pos, { count: 8, color: C.wood, speed: 3 * k, size: 0.1 * k });
    },
    niveau_sup(pos, o) {
      const k = o.scale || 1, c = o.color || C.gold;
      burst({ pos, count: 64, shape: 2, init: i => ({ orbit: { ang: i * 0.7, r: 0.75 * k, w: 5.5, vy: rand(1.4, 2.4) }, delay: i * 0.011, life: rand(1, 1.4), size: 0.36 * k, sizeEnd: 0.08, color: C.white, colorEnd: c, twinkle: true }) });
      burst({ pos, count: 12, alpha: 0.4, init: () => ({ offset: discOffset(0.3 * k), v: V(0, rand(1.5, 2.6), 0), delay: rand(0, 0.5), life: 1.1, size: 1.4 * k, sizeEnd: 0.5, color: c }) });
      ring(pos, { color: c, r0: 0.2, r1: 1.5 * k, life: 0.6 }); ring(pos, { color: C.white, r0: 0.2, r1: 1.1 * k, life: 0.6, delay: 0.3, width: 0.07 });
      after(1, () => { const top = pos.clone(); top.y += 2.2 * k; flash(top, C.white, 2.5 * k, 0.12); burst({ pos: top, count: 30, shape: 2, drag: 2.5, gravity: 2, init: () => ({ v: sphereDir().multiplyScalar(3 * k), life: rand(0.6, 1), size: 0.4 * k, color: C.white, colorEnd: c, twinkle: true }) }); });
    },
    butin(pos, o) {
      const k = o.scale || 1, c = o.color || C.gold;
      burst({ pos, count: 12, shape: 2, init: () => ({ offset: sphereDir().multiplyScalar(rand(0.1, 0.6) * k).add(V(0, 0.5, 0)), v: V(0, rand(0.1, 0.5), 0), delay: rand(0, 0.7), life: rand(0.5, 0.9), size: rand(0.35, 0.6) * k, color: C.white, colorEnd: c, twinkle: true }) });
    },
    portail(pos, o) {
      const k = o.scale || 1, cols = o.colors || [C.bramble, C.pink];
      burst({ pos, count: 72, shape: 1, init: i => ({ offset: V(0, rand(0.05, 1.3), 0), orbit: { ang: rand(0, 6.2832), r: rand(1.2, 1.9) * k, w: 6, dr: -1.7 * k }, delay: rand(0, 0.5), life: rand(0.7, 1), size: 0.22 * k, sizeEnd: 0.06, color: cols[i % 2], colorEnd: C.white }) });
      ring(pos, { color: cols[0], r0: 1.9 * k, r1: 0.2, life: 0.9, opacity: 0.8 });
      after(0.95, () => { const p = pos.clone(); p.y += 0.6; flash(p, cols[1], 3 * k, 0.18); burst({ pos: p, count: 26, shape: 2, drag: 2, init: () => ({ v: sphereDir().multiplyScalar(rand(1.5, 4) * k), life: rand(0.4, 0.8), size: 0.34 * k, color: C.white, colorEnd: cols[0] }) }); ring(pos, { color: cols[1], r1: 2 * k, life: 0.4 }); });
    }
  };

  return {
    names: Object.keys(fx),
    colors: C,
    play(name, pos, opts) { if (fx[name]) fx[name](pos.clone ? pos.clone() : V(pos.x, pos.y, pos.z), opts || {}); },
    setViewport(heightPx, fovDeg) { uScale.value = heightPx / (2 * Math.tan((fovDeg || 50) * Math.PI / 360)); },
    update(dt) {
      dt = Math.min(dt, 0.05);
      for (let i = timers.length - 1; i >= 0; i--) { const t = timers[i]; t.t -= dt; if (t.t <= 0) { timers.splice(i, 1); t.fn(); } }
      for (let i = actors.length - 1; i >= 0; i--) if (!actors[i].update(dt)) { actors[i].dispose(); actors.splice(i, 1); }
    },
    get activeCount() { return actors.length; },
    clear() { for (const a of actors) a.dispose(); actors.length = 0; timers.length = 0; }
  };
}
