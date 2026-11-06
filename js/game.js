/* ============================================================================
   POOLCORE FLIGHT  ·  池核飞行
   A vast, infinitely-generated poolcore / liminal space you fly a block
   starship across. Built on vendored Three.js (offline, no CDN).

   Combine of two source games:
     · "Poolrooms"        – bright sterile tiled pools, water, haze, columns
     · "VOXEL ODYSSEY"    – procedural block ship builder + chunked infinite
                            terrain (worldgen / streaming / world height function)

   Controls:
     W/S            throttle up / down
     Mouse          steer (pitch + yaw)
     A/D  (or ←/→)  roll / bank
     Shift          afterburner boost
     C              chase ↔ cockpit camera
     R              reset / respawn above water
     P              pause (pointer lock released)
     F              toggle flight aid (soft auto-level)
   ============================================================================ */
'use strict';
(function () {
  const T = window.THREE;

  /* ------------------------------------------------------------------ *
   *  Small deterministic math helpers (ported feel of 00-util.js)       *
   * ------------------------------------------------------------------ */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // deterministic 2D hash -> [0,1)
  function hash2(x, y) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  // value noise in [0,1]
  function vnoise(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const a = hash2(x0, y0), b = hash2(x0 + 1, y0);
    const c = hash2(x0, y0 + 1), d = hash2(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  // fractal brownian motion, returns roughly [-1,1]
  function fbm(x, y, oct) {
    let amp = 0.5, sum = 0, norm = 0;
    let fx = x, fy = y;
    for (let i = 0; i < (oct || 4); i++) {
      sum += vnoise(fx, fy) * amp;
      norm += amp; amp *= 0.5;
      fx *= 2.03; fy *= 1.97;
    }
    return (sum / norm) * 2 - 1;
  }
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;

  /* ------------------------------------------------------------------ *
   *  World (poolcore terrain) height function + prop placement          *
   * ------------------------------------------------------------------ */
  const WORLD = {
    chunk: 48,           // world units per chunk
    res: 22,             // grid resolution (verts per chunk edge)
    waterY: 0.0,         // sea / pool water level
    floorY: -6.0,        // global pool floor baseline
  };

  // Sky-pool archipelago: big flat white plateaus rising from a turquoise sea.
  // Terraced, voxel-stepped. Returns terrain surface height at (x,z).
  function terrainHeight(x, z) {
    // continental field, steep via ridged fbm
    const ridge = Math.pow(Math.abs(fbm(x * 0.0045 + 7.3, z * 0.0045 - 3.1, 4)), 1.4);
    let n = fbm(x * 0.006, z * 0.006, 4) * 0.5 + 0.5;
    n = n * 0.6 + ridge * 0.7;
    // scale to height in world units
    let h = (n - 0.46) * 42;              // ~ -19 .. +23, positive = plateau
    // coarse terracing -> big flat decks with steep cliff steps
    const step = 5.0;
    h = Math.floor(h / step) * step + step * 0.5;
    // micro relief on decks + waves at shore
    h += fbm(x * 0.06 + 5.0, z * 0.06 - 5.0, 2) * 0.7;
    // occasionally carve a sunken pool into a high plateau top for that poolcore look
    const poolMask = fbm(x * 0.02 + 40.0, z * 0.02 + 40.0, 3);
    if (h > 8 && poolMask > 0.35) {
      const carve = (poolMask - 0.35) * 26;
      h -= carve;
    }
    return h;
  }

  function terrainColorAt(x, z, h, out) {
    // pool-tile palette: bright decks, turquoise submerged floor
    const above = h > WORLD.waterY;
    // subtle checker of two pale tones
    const cx = Math.floor(x / 6), cz = Math.floor(z / 6);
    const chk = ((cx + cz) & 1) === 0;
    if (above) {
      // pale deck tiles (cool white), deeper -> slightly warmer accent near cliffs
      const t = clamp((h - WORLD.waterY) / 16, 0, 1);
      const warm = fbm(x * 0.05 + 3, z * 0.05 - 8, 2) * 0.5 + 0.5;
      out[0] = lerp(0.86, 0.72, t) * (chk ? 1.0 : 0.90) + warm * 0.02;
      out[1] = lerp(0.98, 0.90, t) * (chk ? 1.0 : 0.90);
      out[2] = lerp(0.99, 0.92, t) * (chk ? 1.0 : 0.90);
    } else {
      // submerged turquoise pool floor, deeper -> deeper blue
      const d = clamp((WORLD.waterY - h) / 7, 0, 1);
      out[0] = lerp(0.14, 0.02, d) * (chk ? 1.0 : 0.82);
      out[1] = lerp(0.74, 0.34, d) * (chk ? 1.0 : 0.82);
      out[2] = lerp(0.88, 0.62, d) * (chk ? 1.0 : 0.82);
    }
    out[3] = 1;
  }

  // Deterministic liminal-prop placement inside a chunk (columns, walls, arches).
  // Returns array of {type, x, z, y, c} in world coords.
  function chunkProps(cx, cz) {
    const props = [];
    const rng = mulberry32((Math.imul(cx, 0x9E3779B1) ^ Math.imul(cz, 0x85EBCA6B)) >>> 0);
    const ox = cx * WORLD.chunk, oz = cz * WORLD.chunk;
    const count = 2 + Math.floor(rng() * 4);
    for (let i = 0; i < count; i++) {
      const x = ox + rng() * WORLD.chunk;
      const z = oz + rng() * WORLD.chunk;
      const h = terrainHeight(x, z);
      if (h < WORLD.waterY + 2.5) continue;       // only on raised decks
      const t = rng();
      let type = 'column';
      if (t > 0.9) type = 'arch';
      else if (t > 0.72) type = 'wall';
      else if (t > 0.55) type = 'slab';
      props.push({ type, x, z, y: h, c: rng() });
    }
    return props;
  }

  /* ------------------------------------------------------------------ *
   *  Tile texture (canvas) — pool tiles with grout                    *
   * ------------------------------------------------------------------ */
  function makeTileTexture() {
    const s = 256, c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const grid = 6, cell = s / grid;
    for (let y = 0; y < grid; y++) {
      for (let x = 0; x < grid; x++) {
        const n = hash2(x + 17, y + 91);
        const base = 224 + Math.floor(n * 26);
        g.fillStyle = `rgb(${base},${Math.min(255, base + 6)},${Math.min(255, base + 12)})`;
        g.fillRect(x * cell, y * cell, cell, cell);
        // subtle sheen
        if ((x + y) % 2 === 0) {
          g.fillStyle = 'rgba(255,255,255,0.10)';
          g.fillRect(x * cell, y * cell, cell, cell * 0.5);
        }
      }
    }
    // grout lines
    g.strokeStyle = 'rgba(120,150,158,0.75)';
    g.lineWidth = 2.5;
    for (let i = 0; i <= grid; i++) {
      g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, s); g.stroke();
      g.beginPath(); g.moveTo(0, i * cell); g.lineTo(s, i * cell); g.stroke();
    }
    const tex = new T.CanvasTexture(c);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.anisotropy = 4;
    tex.colorSpace = T.SRGBColorSpace;
    return tex;
  }

  /* ------------------------------------------------------------------ *
   *  Ship builder (ported from Voxel Odyssey buildShip, THREE boxes)     *
   * ------------------------------------------------------------------ */
  function buildShip(seed) {
    const rng = mulberry32(seed >>> 0);
    const palettes = [
      { name: 'pool', hull: '#eef6f8', trim: '#7fd7e8', dark: '#173a44', glow: '#8ff4ff' },
      { name: 'reef', hull: '#f2fbf4', trim: '#7fe0b8', dark: '#174233', glow: '#9dffe0' },
      { name: 'pearl', hull: '#fbf6f0', trim: '#e7c19a', dark: '#3a2d20', glow: '#ffd9a8' },
      { name: 'glacier', hull: '#eef6fb', trim: '#9ec7f0', dark: '#1d2f44', glow: '#bfe4ff' },
    ];
    const P = palettes[Math.floor(rng() * palettes.length)];
    const B = [];
    const hull = P.hull, trim = P.trim, dark = P.dark, glow = P.glow;
    const len = 6.5 + rng() * 2.0, wide = 1.9 + rng() * 0.7;
    const nose = -len * 0.5;

    function box(p, s, c, o) {
      o = o || {};
      B.push({ p, s, c, rot: o.rot, glow: o.glow, bone: o.bone });
    }

    // hull
    box([0, 0, 0], [wide, 1.5, len], hull);
    box([0, 0.95, -0.3], [wide * 0.72, 0.5, len * 0.62], hull);
    box([0, -0.55, 0.4], [wide * 0.8, 0.6, len * 0.7], dark);
    // nose
    box([0, 0.05, nose - 1.1], [wide * 0.7, 1.05, 2.4], hull);
    box([0, -0.05, nose - 2.4], [wide * 0.42, 0.62, 1.4], dark);
    box([0, 0.12, nose - 3.1], [0.28, 0.28, 0.9], trim, { glow: 0.3 });
    // canopy
    box([0, 1.28, -len * 0.16], [wide * 0.62, 0.72, 2.5], '#10222c', { glow: 0.12 });
    box([0, 1.62, -len * 0.16], [wide * 0.5, 0.18, 2.1], glow, { glow: 0.55 });
    // wings
    const wingY = -0.25 + rng() * 0.55, sweep = 0.1 + rng() * 0.24, span = 3.2 + rng() * 1.2;
    for (const sx of [-1, 1]) {
      box([sx * (wide * 0.5 + span * 0.5), wingY, 0.6], [span, 0.42, 3.4], hull, { rot: [0, sx * -sweep * 0.3, sx * -sweep] });
      box([sx * (wide * 0.5 + span + 0.9), wingY + 0.78, 0.9], [1.5, 0.38, 2.5], trim, { rot: [0, sx * -sweep * 0.5, sx * -0.55] });
      box([sx * (wide * 0.5 + span * 0.5), wingY + 0.24, 0.1], [span * 0.82, 0.1, 0.55], trim, { rot: [0, sx * -sweep * 0.3, sx * -sweep], glow: 0.12 });
      // engine nacelle
      box([sx * (wide * 0.5 + 1.0), -0.1, len * 0.32], [1.05, 1.05, 2.7], dark);
      box([sx * (wide * 0.5 + 1.0), -0.1, len * 0.32 + 1.5], [0.86, 0.86, 0.4], glow, { glow: 1 });
      box([sx * (wide * 0.5 + 1.0), 0.62, len * 0.32 - 0.3], [0.5, 0.2, 1.6], trim, { glow: 0.2 });
      box([sx * (wide * 0.5 + 0.45), -0.05, len * 0.3], [0.5, 0.5, 1.2], hull);
    }
    // main thrusters
    box([0, 0.1, len * 0.5 + 0.7], [wide * 0.78, 1.1, 1.5], dark);
    box([0, 0.1, len * 0.5 + 1.5], [wide * 0.6, 0.86, 0.34], glow, { glow: 1 });
    // tail fins
    for (const sx of [-1, 1]) {
      box([sx * wide * 0.34, 1.15, len * 0.42], [0.24, 1.7, 1.5], hull, { rot: [0, 0, sx * 0.22] });
      box([sx * wide * 0.34, 1.95, len * 0.42], [0.22, 0.3, 1.1], trim, { glow: 0.2 });
    }
    // stripe lights
    box([0, 1.9, len * 0.1], [0.12, 0.8, 0.12], trim);
    box([wide * 0.3, -0.9, -len * 0.1], [0.7, 0.4, 1.6], dark);
    box([-wide * 0.3, -0.9, -len * 0.1], [0.7, 0.4, 1.6], dark);
    for (let i = 0; i < 3; i++)
      box([0, -0.62, len * 0.1 + i * 0.7], [wide * 0.84, 0.12, 0.22], glow, { glow: 0.5 });

    // build THREE meshes
    const group = new T.Group();
    const matCache = new Map();
    const world = new T.Object3D();
    const tmp = new T.Object3D();
    const tmp2 = new T.Object3D();
    for (const b of B) {
      const key = b.c + '|' + (b.glow || 0);
      let mat = matCache.get(key);
      if (!mat) {
        const isGlow = b.glow;
        const emissive = isGlow ? new T.Color(b.c).lerp(new T.Color('#ffffff'), 0.5) : new T.Color('#000000');
        mat = new T.MeshStandardMaterial({
          color: new T.Color(b.c),
          roughness: isGlow ? 0.18 : 0.55,
          metalness: isGlow ? 0.0 : 0.30,
          emissive: emissive,
          emissiveIntensity: isGlow ? (b.glow === true ? 2.2 : 1.2 + b.glow * 1.6) : 0,
          flatShading: false,
        });
        matCache.set(key, mat);
      }
      const mesh = new T.Mesh(new T.BoxGeometry(b.s[0], b.s[1], b.s[2]), mat);
      mesh.position.set(b.p[0], b.p[1], b.p[2]);
      if (b.rot) {
        // apply scaled rotation like the original (approx)
        const r = b.rot;
        mesh.rotation.z = r[2] || 0;
        mesh.rotation.y = r[1] || 0;
        mesh.rotation.x = r[0] || 0;
      }
      group.add(mesh);
    }
    group.position.set(0, 0, 0);
    // engine glow point lights
    const engineLight = new T.PointLight(new T.Color(P.glow), 4, 30, 2);
    engineLight.position.set(0, 0.1, len * 0.5 + 2.2);
    const engineLight2 = new T.PointLight(new T.Color(P.glow), 3, 20, 2);
    engineLight2.position.set(wide * 0.5 + 1.0, -0.1, len * 0.32 + 1.8);
    group.add(engineLight);
    group.add(engineLight2);

    group.userData = { palette: P, len, thrusters: [[0, 0.1, len * 0.5 + 1.8], [wide * 0.5 + 1.0, -0.1, len * 0.32 + 1.8], [-(wide * 0.5 + 1.0), -0.1, len * 0.32 + 1.8]] };
    return group;
  }

  /* ------------------------------------------------------------------ *
   *  Water shader (poolcore turquoise with moving ripples)              *
   * ------------------------------------------------------------------ */
  function makeWaterMat() {
    const mat = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, { uTime: { value: 0 }, uColor: { value: new T.Color('#35a7c2') }, uDeep: { value: new T.Color('#0b5f78') } }]),
      vertexShader: `
        varying vec3 vWorld;
        #include <fog_pars_vertex>
        void main(){
          vec4 w = modelMatrix * vec4(position,1.0);
          vWorld = w.xyz;
          vec4 mvPosition = viewMatrix * w;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        uniform vec3 uDeep;
        varying vec3 vWorld;
        #include <fog_pars_fragment>
        void main(){
          vec2 p = vWorld.xz;
          float r = sin(p.x*0.12 + uTime*0.8) * sin(p.y*0.11 - uTime*0.62);
          r += 0.5*sin((p.x+p.y)*0.06 + uTime*0.35);
          r += 0.5*sin(length(p)*0.05 - uTime*0.5);
          float w = r*0.5+0.5;
          vec3 col = mix(uDeep, uColor, 0.5 + w*0.4);
          // fake crest sparkle
          float spark = smoothstep(0.78, 0.98, sin(p.x*0.5+uTime)*sin(p.y*0.45-uTime));
          col += vec3(0.9,1.0,1.0)*spark*0.12;
          gl_FragColor = vec4(col, 0.72);
          #include <fog_fragment>
        }
      `,
    });
    return mat;
  }

  /* ------------------------------------------------------------------ *
   *  Sky dome (bright poolcore haze gradient)                           *
   * ------------------------------------------------------------------ */
  function makeSky() {
    const skyMat = new T.ShaderMaterial({
      side: T.BackSide,
      uniforms: { uHorizon: { value: new T.Color('#a8dde6') }, uZenith: { value: new T.Color('#5fc2db') }, uTime: { value: 0 } },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `
        uniform vec3 uHorizon; uniform vec3 uZenith; uniform float uTime;
        varying vec3 vP;
        void main(){
          float h = normalize(vP).y;
          vec3 col = mix(uHorizon, uZenith, smoothstep(-0.05, 0.6, h));
          // soft sun glow
          float sun = pow(max(0.0, dot(normalize(vP), normalize(vec3(0.35,0.55,-0.6)))), 20.0);
          col += vec3(1.0,0.96,0.8)*sun*0.55;
          // drifting haze bands
          col += vec3(0.95,1.0,1.0)*0.05*sin(uTime*0.1+vP.x*0.01+vP.y*0.02);
          gl_FragColor = vec4(col,1.0);
        }
      `,
    });
    const sky = new T.Mesh(new T.SphereGeometry(1500, 32, 16), skyMat);
    sky.frustumCulled = false;
    return sky;
  }

  /* ------------------------------------------------------------------ *
   *  Game                                                                *
   * ------------------------------------------------------------------ */
  const canvas = document.getElementById('gl');
  let renderer, scene, camera, shipGroup, water, waterMat, skyMat, engineTrail;
  let hudSpeed, hudAlt, hudThrottle, hudPos, hudFps, hudMode;
  let clock = new T.Clock();
  let fpsCount = 0, fpsTime = 0, fpsVal = 0;

  // flight state
  const fly = {
    throttle: 0.45,
    pitch: 0, yaw: 0, roll: 0,
    quat: new T.Quaternion(),
    speed: 0,
    boost: false,
    mouseX: 0, mouseY: 0,
    aid: true,
    camMode: 'chase',
    pos: new T.Vector3(0, 30, 0),
  };
  let shotMode = /\bshot\b/.test(location.search);

  // terrain chunks
  const chunks = new Map();
  let chunkMat, waterGeo;

  const INPUT = { up: 0, down: 0, rollL: 0, rollR: 0, boost: 0, reset: 0, cam: 0, aid: 0 };

  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function keydown(e) {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': INPUT.up = 1; break;
      case 'KeyS': case 'ArrowDown': INPUT.down = 1; break;
      case 'KeyA': case 'ArrowLeft': INPUT.rollL = 1; break;
      case 'KeyD': case 'ArrowRight': INPUT.rollR = 1; break;
      case 'ShiftLeft': case 'ShiftRight': INPUT.boost = 1; break;
      case 'KeyR': INPUT.reset = 1; break;
      case 'KeyC': INPUT.cam = 1; break;
      case 'KeyF': INPUT.aid = 1; break;
      case 'KeyP': document.exitPointerLock && document.exitPointerLock(); break;
      default: break;
    }
  }
  function keyup(e) {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': INPUT.up = 0; break;
      case 'KeyS': case 'ArrowDown': INPUT.down = 0; break;
      case 'KeyA': case 'ArrowLeft': INPUT.rollL = 0; break;
      case 'KeyD': case 'ArrowRight': INPUT.rollR = 0; break;
      case 'ShiftLeft': case 'ShiftRight': INPUT.boost = 0; break;
      default: break;
    }
  }
  function onPointerMove(e) {
    if (document.pointerLockElement !== canvas) return;
    fly.mouseX += e.movementX || 0;
    fly.mouseY += e.movementY || 0;
    fly.mouseX = clamp(fly.mouseX, -3.2, 3.2);
    fly.mouseY = clamp(fly.mouseY, -3.2, 3.2);
  }

  /* ------- chunk streaming ------- */
  function makeChunkMesh(cx, cz) {
    const res = WORLD.res, size = WORLD.chunk, step = size / res;
    const ox = cx * size, oz = cz * size;
    const verts = (res + 1) * (res + 1);
    const pos = new Float32Array(verts * 3);
    const uv = new Float32Array(verts * 2);
    const col = new Float32Array(verts * 4);
    const idx = new Uint32Array(res * res * 6);
    const c = [0, 0, 0, 1];
    let vi = 0;
    for (let z = 0; z <= res; z++) {
      for (let x = 0; x <= res; x++) {
        const wx = ox + x * step, wz = oz + z * step;
        const h = terrainHeight(wx, wz);
        pos[vi * 3] = wx; pos[vi * 3 + 1] = h; pos[vi * 3 + 2] = wz;
        uv[vi * 2] = wx / 5; uv[vi * 2 + 1] = wz / 5;
        terrainColorAt(wx, wz, h, c);
        col[vi * 4] = c[0]; col[vi * 4 + 1] = c[1]; col[vi * 4 + 2] = c[2]; col[vi * 4 + 3] = c[3];
        vi++;
      }
    }
    let ii = 0;
    for (let z = 0; z < res; z++) {
      for (let x = 0; x < res; x++) {
        const a = z * (res + 1) + x;
        const b = a + 1;
        const dd = a + (res + 1);
        const e = dd + 1;
        idx[ii++] = a; idx[ii++] = dd; idx[ii++] = b;
        idx[ii++] = b; idx[ii++] = dd; idx[ii++] = e;
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    g.setAttribute('color', new T.BufferAttribute(col, 4));
    g.setIndex(new T.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const mesh = new T.Mesh(g, chunkMat);
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  function ensureChunks() {
    const rch = Math.ceil(WORLD.chunk * 0.5);
    const cx = Math.floor(fly.pos.x / WORLD.chunk);
    const cz = Math.floor(fly.pos.z / WORLD.chunk);
    const R = 5; // chunks radius (in each dir)
    let dirty = false;
    const need = new Set();
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        need.add((cx + dx) + ',' + (cz + dz));
      }
    }
    // remove out-of-range
    for (const [k, mesh] of chunks) {
      if (!need.has(k)) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        chunks.delete(k);
        dirty = true;
      }
    }
    // add missing (sorted by distance so near chunks build first)
    const missing = [];
    for (const k of need) {
      if (!chunks.has(k)) {
        const [a, b] = k.split(',').map(Number);
        const dx = a - cx, dz = b - cz;
        missing.push([k, dx * dx + dz * dz]);
      }
    }
    missing.sort((p, q) => p[1] - q[1]);
    let budget = 4;
    for (const [k] of missing) {
      if (budget-- <= 0) break;
      const [a, b] = k.split(',').map(Number);
      const mesh = makeChunkMesh(a, b);
      scene.add(mesh);
      chunks.set(k, mesh);
      dirty = true;
    }
    return dirty;
  }

  // update props (columns/walls/arches) around player — re-parented per chunk
  const propsGroup = new T.Group();
  const propMesh = new Map();
  function ensureProps() {
    const cx = Math.floor(fly.pos.x / WORLD.chunk);
    const cz = Math.floor(fly.pos.z / WORLD.chunk);
    const R = 3;
    // dispose far
    for (const [k, list] of propMesh) {
      const [a, b] = k.split(',').map(Number);
      if (Math.abs(a - cx) > R + 1 || Math.abs(b - cz) > R + 1) {
        for (const m of list) propsGroup.remove(m);
        list.forEach(m => m.traverse && m.traverse(c => { if (c.isMesh) c.geometry.dispose(); }));
        propMesh.delete(k);
      }
    }
    const need = new Set();
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) need.add((cx + dx) + ',' + (cz + dz));
    let made = 0;
    for (const k of need) {
      if (propMesh.has(k)) continue;
      if (made >= 3) break;
      const [a, b] = k.split(',').map(Number);
      const props = chunkProps(a, b);
      const list = [];
      for (const pr of props) {
        const mesh = makePropMesh(pr);
        if (mesh) { propsGroup.add(mesh); list.push(mesh); }
      }
      propMesh.set(k, list);
      made++;
    }
  }

  // Pool-tile material shared by all props (a few tint variants)
  const propMats = {};
  function propMaterial(tint) {
    const key = tint < 0.5 ? 0 : 1;
    if (!propMats[key]) {
      const base = key === 0 ? '#e7f5f7' : '#d7f0f2';
      propMats[key] = new T.MeshStandardMaterial({ color: new T.Color(base), roughness: 0.45, metalness: 0.05 });
    }
    return propMats[key];
  }
  const boxGeoCache = {};
  function boxGeo(sx, sy, sz) {
    const k = sx + '_' + sy + '_' + sz;
    if (!boxGeoCache[k]) boxGeoCache[k] = new T.BoxGeometry(sx, sy, sz);
    return boxGeoCache[k];
  }

  // Build a prop as a group of boxes (so column = shaft + capital + plinth etc).
  function makePropMesh(pr) {
    const g = new T.Group();
    const mat = propMaterial(pr.c);
    const h = terrainHeight(pr.x, pr.z);   // ground height at prop
    const at = pr.y;                        // ground top

    function add(sx, sy, sz, x, y, z, ry) {
      const m = new T.Mesh(boxGeo(sx, sy, sz), mat);
      m.position.set(x, y, z);
      if (ry) m.rotation.y = ry;
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
      return m;
    }

    if (pr.type === 'column') {
      const H = 14 + Math.floor(pr.c * 3) * 4;
      add(3.0, H, 3.0, 0, H / 2, 0);                       // shaft
      add(4.0, 1.0, 4.0, 0, H + 0.5, 0);                    // capital
      add(4.4, 0.8, 4.4, 0, 0.4, 0);                        // plinth
      add(4.0, 1.0, 4.0, 0, H - 0.5, 0);                    // neck
    } else if (pr.type === 'wall') {
      const W = 12 + Math.floor(pr.c * 2) * 3;
      add(W, 3.2, 1.6, 0, 1.6, 0, pr.c * 0.4);              // wall body
      add(W + 0.6, 0.5, 2.0, 0, 3.4, 0, pr.c * 0.4);        // coping
    } else if (pr.type === 'arch') {
      const W = 13;
      add(1.8, 7, 2.0, -W / 2 + 0.9, 3.5, 0);               // left pillar
      add(1.8, 7, 2.0, W / 2 - 0.9, 3.5, 0);                // right pillar
      add(W, 2.0, 2.0, 0, 8.0, 0);                          // beam
      add(W + 0.5, 0.5, 2.4, 0, 9.2, 0);                    // lintel
    } else if (pr.type === 'slab') {
      add(7, 1.4, 7, 0, 0.7, 0, pr.c * 0.7);
      add(5, 0.8, 5, 0, 1.6, 0, pr.c * 0.7);
    }

    g.position.set(pr.x, at, pr.z);
    return g;
  }

  /* ------- init ------- */
  function init() {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;

    scene = new T.Scene();
    scene.fog = new T.Fog(new T.Color('#a8dce4'), 70, 300);
    camera = new T.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2400);

    // lighting
    const hemi = new T.HemisphereLight(new T.Color('#eafcff'), new T.Color('#8fb9c2'), 1.0);
    scene.add(hemi);
    const sun = new T.DirectionalLight(new T.Color('#fff4e6'), 1.7);
    sun.position.set(90, 130, -60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 400;
    sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
    sun.shadow.bias = -0.0005;
    scene.add(sun);
    scene.add(sun.target);

    // sky
    const sky = makeSky();
    skyMat = sky.material;
    scene.add(sky);

    // water
    waterMat = makeWaterMat();
    waterGeo = new T.PlaneGeometry(WORLD.chunk, WORLD.chunk);
    // big water surface, recentered on player
    water = new T.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = WORLD.waterY;
    scene.add(water);

    // terrain material
    const tileTex = makeTileTexture();
    chunkMat = new T.MeshStandardMaterial({
      map: tileTex, vertexColors: true, roughness: 0.82, metalness: 0.12,
    });
    scene.add(propsGroup);

    // ship
    shipGroup = buildShip(1337);
    shipGroup.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    scene.add(shipGroup);

    // engine trail (simple additive sprite cones)
    const trailMat = new T.MeshBasicMaterial({
      color: new T.Color('#9ff6ff'), transparent: true, opacity: 0.85,
      blending: T.AdditiveBlending, depthWrite: false,
    });
    engineTrail = new T.Group();
    for (const tp of shipGroup.userData.thrusters) {
      const cone = new T.Mesh(new T.ConeGeometry(0.35, 3.2, 8, 1, true), trailMat);
      cone.rotation.x = -Math.PI / 2;
      cone.position.set(tp[0], tp[1], tp[2]);
      engineTrail.add(cone);
    }
    shipGroup.add(engineTrail);

    // HUD refs
    hudSpeed = document.getElementById('spd');
    hudAlt = document.getElementById('alt');
    hudThrottle = document.getElementById('thr');
    hudPos = document.getElementById('pos');
    hudFps = document.getElementById('fps');
    hudMode = document.getElementById('mode');

    // events
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    document.addEventListener('mousemove', onPointerMove);

    // screenshot mode (headless verification): hide overlay, no pointer lock gate
    const isShot = /\bshot\b/.test(location.search);
    if (isShot) {
      overlay.classList.add('hidden');
    } else {
      overlay.addEventListener('click', () => {
        overlay.classList.add('hidden');
        canvas.requestPointerLock && canvas.requestPointerLock();
      });
      document.addEventListener('pointerlockchange', () => {
        const locked = document.pointerLockElement === canvas;
        overlay.classList.toggle('hidden', locked);
      });
    }

    // warm-up chunk gen
    buildCompass();
    ensureChunks();

    renderer.setAnimationLoop(loop);
  }

  /* ------- flight physics ------- */
  const fwd = new T.Vector3();
  const up = new T.Vector3(0, 1, 0);
  const right = new T.Vector3();
  const qTmp = new T.Quaternion();
  const euler = new T.Euler();

  function updateFly(dt) {
    // throttle
    if (INPUT.up) fly.throttle = clamp(fly.throttle + dt * 0.55, 0, 1);
    if (INPUT.down) fly.throttle = clamp(fly.throttle - dt * 0.8, 0, 1);
    fly.boost = INPUT.boost;

    // steer: mouse -> pitch/yaw desire, keys -> roll
    const pitchIn = fly.mouseY, yawIn = fly.mouseX;
    const rollIn = (INPUT.rollR ? 1 : 0) - (INPUT.rollL ? 1 : 0);

    // target speed
    const maxSpeed = fly.boost ? 130 : 64;
    const target = fly.throttle * maxSpeed;
    fly.speed = lerp(fly.speed, target, 1 - Math.exp(-dt * (fly.boost ? 1.6 : 0.9)));

    // rotate craft
    const rotX = -pitchIn * 0.9 * dt;
    const rotY = yawIn * 0.9 * dt;
    const rotZ = rollIn * 1.5 * dt;

    // apply local pitch, world yaw, local roll
    euler.set(rotX, 0, 0);
    qTmp.setFromEuler(euler);
    fly.quat.multiply(qTmp);                     // local pitch
    euler.set(0, rotY, 0);
    qTmp.setFromEuler(euler);
    qTmp.premultiply(new T.Quaternion().setFromEuler(euler));
    fly.quat.premultiply(qTmp);                  // world yaw
    euler.set(0, 0, rotZ);
    qTmp.setFromEuler(euler);
    fly.quat.multiply(qTmp);                     // local roll
    fly.roll = clamp(fly.roll * Math.exp(-dt * 3) + rollIn * (1 - Math.exp(-dt * 3)), -1, 1);

    // soft auto-level (flight aid)
    if (fly.aid) {
      fwd.set(0, 0, -1).applyQuaternion(fly.quat);
      const flatYaw = Math.atan2(fwd.x, fwd.z);
      const targetQ = new T.Quaternion().setFromEuler(new T.Euler(0, flatYaw, 0, 'YXZ'));
      fly.quat.slerp(targetQ, 1 - Math.exp(-dt * 0.9));
    }

    // move
    fwd.set(0, 0, -1).applyQuaternion(fly.quat);
    fly.pos.addScaledVector(fwd, fly.speed * dt);

    // terrain collision: keep craft above terrain + water
    const th = terrainHeight(fly.pos.x, fly.pos.z);
    const minY = Math.max(th + 2.4, WORLD.waterY + 2.4);
    if (fly.pos.y < minY) {
      fly.pos.y = minY;
      fly.speed *= 0.999;
    }

    // reset (respawn well above)
    if (INPUT.reset && INPUT.reset > 0) {
      fly.pos.set(0, 60, 0);
      fly.quat.identity();
      fly.throttle = 0.4;
      INPUT.reset = 0;
    }

    // apply to ship
    shipGroup.position.copy(fly.pos);
    shipGroup.quaternion.copy(fly.quat);

    // engine trail flicker by throttle
    engineTrail.visible = fly.throttle > 0.02;
    const flick = 0.6 + Math.abs(Math.sin(performance.now() * 0.02)) * 0.4;
    engineTrail.scale.z = fly.throttle * (fly.boost ? 2.4 : 1.3) * flick;
    engineTrail.scale.x = engineTrail.scale.y = (fly.boost ? 1.2 : 0.8);
  }

  /* ------- cameras ------- */
  const camTarget = new T.Vector3();
  const camPos = new T.Vector3();
  const shotAngle = new T.Vector3();
  function updateCam(dt) {
    const t = clock.elapsedTime;
    if (shotMode) {
      const close = /close/.test(location.search);
      // cinematic angled orbit shot that frames ship + world
      const r = close ? 12 : 26, ang = t * 0.32;
      shotAngle.set(Math.cos(ang) * r, (close ? 4 : 6.5) + Math.sin(t * 0.2) * 2.2, Math.sin(ang) * r);
      camera.position.copy(fly.pos).add(shotAngle);
      camTarget.copy(fly.pos).add(new T.Vector3(0, 1, 0));
      camera.lookAt(camTarget);
      return;
    }
    fwd.set(0, 0, -1).applyQuaternion(fly.quat);
    if (fly.camMode === 'chase') {
      const back = fwd.clone().multiplyScalar(-13);
      camPos.copy(fly.pos).add(back).add(new T.Vector3(0, 5.0, 0));
      camera.position.lerp(camPos, 1 - Math.exp(-dt * 4.5));
      camTarget.copy(fly.pos).addScaledVector(fwd, 12); camTarget.y += 1.0;
      camera.lookAt(camTarget);
    } else {
      camPos.copy(fly.pos).addScaledVector(fwd, 1.6).add(new T.Vector3(0, 1.35, 0));
      camera.position.copy(camPos);
      camera.quaternion.copy(fly.quat);
    }
    // roll chase camera a bit with ship roll for immersion
    if (fly.camMode === 'chase') {
      const rollQ = new T.Quaternion().setFromEuler(new T.Euler(0, 0, clamp(fly.roll, -0.5, 0.5) * -0.6));
      camera.quaternion.multiply(rollQ);
    }
  }

  /* ------- compass strip ------- */
  const compassStrip = document.getElementById('compassStrip');
  const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  let compassTicks = null;
  function buildCompass() {
    if (!compassStrip) return;
    let html = '';
    for (let deg = 0; deg < 360; deg += 15) {
      const dir = DIRS[(Math.round(deg / 45) % 8)];
      const isMajor = dir && deg % 45 === 0;
      html += `<span class="${isMajor ? 'major' : ''}">${isMajor ? dir : deg}</span>`;
    }
    // enough repeats for smooth scroolling
    compassStrip.innerHTML = html + html + html;
    compassTicks = Array.from(compassStrip.children);
  }
  function updateCompass(heading) {
    if (!compassTicks) return;
    // shift strip so current heading is centered
    const step = 15;              // degrees per tick
    const px = 34;                // px per tick from CSS gap
    const n = compassTicks.length;
    const center = n / 2;
    const centerDeg = heading;
    // find tick whose value == center
    // compute offset in ticks
    const offsetTicks = (centerDeg / step);
    const pxOffset = offsetTicks * px;
    compassStrip.style.transform = `translateX(${-pxOffset + 0}px)`;
  }

  /* ------- main loop ------- */
  function loop() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    // update anytime-key one-shots
    if (INPUT.cam) { fly.camMode = fly.camMode === 'chase' ? 'cockpit' : 'chase'; INPUT.cam = 0; }
    if (INPUT.aid) { fly.aid = !fly.aid; INPUT.aid = 0; }

    updateFly(dt);
    ensureChunks();
    ensureProps();
    updateCam(dt);

    // water recenter (snap to chunk grid so it tiles)
    const wx = Math.floor(fly.pos.x / WORLD.chunk) * WORLD.chunk;
    const wz = Math.floor(fly.pos.z / WORLD.chunk) * WORLD.chunk;
    water.position.set(wx, WORLD.waterY + Math.sin(t * 0.5) * 0.05, wz);
    waterMat.uniforms.uTime.value = t;
    skyMat.uniforms.uTime.value = t;

    // shadow cam follows player
    const sun = scene.children.find(o => o.isDirectionalLight);
    if (sun) { sun.position.set(fly.pos.x + 90, fly.pos.y + 130, fly.pos.z - 60); sun.target.position.copy(fly.pos); }

    renderer.render(scene, camera);

    // fps
    fpsCount++; fpsTime += dt;
    if (fpsTime >= 0.5) { fpsVal = Math.round(fpsCount / fpsTime); fpsCount = 0; fpsTime = 0; }

    // HUD
    const alt = Math.max(0, fly.pos.y - WORLD.waterY);
    hudSpeed.textContent = Math.round(fly.speed) + ' u/s';
    hudAlt.textContent = Math.round(alt) + ' m';
    hudThrottle.style.width = (fly.throttle * 100).toFixed(0) + '%';
    hudPos.textContent = 'X ' + Math.round(fly.pos.x) + '  Z ' + Math.round(fly.pos.z);
    hudFps.textContent = fpsVal;
    hudMode.textContent = fly.camMode === 'chase' ? 'CHASE CAM' : 'COCKPIT' + (fly.boost ? ' · BOOST' : '');

    // compass heading from forward vector
    fwd.set(0, 0, -1).applyQuaternion(fly.quat);
    const heading = (Math.atan2(fwd.x, fwd.z) * 180 / Math.PI + 180) % 360;
    const hEl = document.getElementById('heading');
    if (hEl) hEl.textContent = Math.round(heading) + '°' + (fly.aid ? '' : ' · FREE FAT');
    updateCompass(heading);
  }

  window.__PCF_READY = false;
  init();
  window.__PCF_READY = true;
  window.__PCF = { fly, terrainHeight, WORLD, get renderer() { return renderer; } };
})();
