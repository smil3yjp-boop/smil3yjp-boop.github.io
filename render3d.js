/* three.js renderer for Bloonstone Survivors: real Soulstone arena geometry + BTD6 3D models.
   Game logic works in 2D arena units (x,y); this maps them onto the 3D scene. */
'use strict';
const R3 = (() => {
  let renderer, scene, camera, hemi, sun, glCanvas;
  let nav = null, Y0 = 0, arenaGroup = null, arenaId = null;
  const tmpC2 = new THREE.Color();
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpC = new THREE.Color();
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  let BTD = null;           // decoded btd model pack
  const texReady = new Map();

  // ------------------------------------------------------------ utils
  function w(x, y, h = 0) { return tmpV.set(nav.x0 + x, Y0 + h, y - nav.z1); }
  function toWorld(x, y, h = 0, out = new THREE.Vector3()) { return out.set(nav.x0 + x, Y0 + h, y - nav.z1); }
  function loadImage(uri) {
    if (texReady.has(uri)) return texReady.get(uri);
    const p = new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = uri; });
    texReady.set(uri, p); return p;
  }
  async function makeTex(uri, { repeat = null, srgb = true } = {}) {
    const im = await loadImage(uri);
    if (!im) return null;
    const t = new THREE.Texture(im);
    t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    if (repeat) t.repeat.set(repeat[0], repeat[1]);
    t.needsUpdate = true;
    return t;
  }
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('missing ' + src)); document.head.appendChild(s); });
  }

  // ------------------------------------------------------------ init
  // ------------------------------------------------------------ quality / dynamic resolution
  let quality = 'Auto';
  try { quality = localStorage.getItem('bss_gfx') || 'Auto'; } catch (e) { }
  const PRESET = {
    High: { scale: 1.0, shadows: true, soft: true, map: 2048, foliage: true },
    Medium: { scale: 0.8, shadows: true, soft: false, map: 1024, foliage: true },
    Low: { scale: 0.6, shadows: false, soft: false, map: 512, foliage: false },
    Auto: { scale: 1.0, shadows: true, soft: false, map: 1024, foliage: true },
  };
  let scale = 1, fps = 60, fpsAcc = 0, fpsN = 0, lastT = performance.now(), tuneT = 0;
  function baseDPR() { return Math.min(window.devicePixelRatio || 1, 1.25); }
  function applyQuality() {
    const p = PRESET[quality];
    scale = quality === 'Auto' ? Math.min(scale, 1) || 1 : p.scale;
    if (renderer) {
      renderer.setPixelRatio(baseDPR() * scale);
      renderer.shadowMap.enabled = p.shadows;
      renderer.shadowMap.type = p.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      if (sun) { sun.castShadow = p.shadows; if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } sun.shadow.mapSize.set(p.map, p.map); }
      if (arenaGroup) arenaGroup.traverse(o => { if (o.userData.foliage) o.visible = p.foliage; });
      scene && scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
      resize();
    }
  }
  function setQuality(q) { quality = q; scale = PRESET[q].scale; try { localStorage.setItem('bss_gfx', q); } catch (e) { } applyQuality(); }
  function getQuality() { return quality; }
  function tick() {
    const now = performance.now(), ms = now - lastT; lastT = now;
    fpsAcc += ms; fpsN++;
    if (fpsAcc > 500) { fps = Math.round(1000 * fpsN / fpsAcc); fpsAcc = 0; fpsN = 0;
      if (quality === 'Auto' && (tuneT += 0.5) > 1.5) {
        if (fps < 50 && scale > 0.5) { scale = Math.max(0.5, scale - 0.1); renderer.setPixelRatio(baseDPR() * scale); resize(); tuneT = 0; }
        else if (fps > 58 && scale < 1) { scale = Math.min(1, scale + 0.05); renderer.setPixelRatio(baseDPR() * scale); resize(); tuneT = 0; }
        if (fps < 30 && scale <= 0.55 && renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; sun.castShadow = false; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); }
      }
    }
  }
  function stats() { return { fps, quality, scale }; }
  function init() {
    glCanvas = document.getElementById('gl');
    renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: quality === 'High', powerPreference: 'high-performance' });
    renderer.setPixelRatio(baseDPR() * PRESET[quality].scale); scale = PRESET[quality].scale;
    renderer.shadowMap.enabled = PRESET[quality].shadows; renderer.shadowMap.type = PRESET[quality].soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(42, 1, 1, 95);
    hemi = new THREE.HemisphereLight(0xdfe8ff, 0x3a3020, 1.35); scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    sun.castShadow = PRESET[quality].shadows; sun.shadow.mapSize.set(PRESET[quality].map, PRESET[quality].map);
    const sc = sun.shadow.camera; sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 120;
    sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.04;
    scene.add(sun); scene.add(sun.target);
    resize();
    addEventListener('resize', resize);
    buildPools();
  }
  function resize() {
    if (!renderer) return;
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ arena
  function patchTriplanar(mat, top, sides, tiling, sideScale) {
    mat.onBeforeCompile = sh => {
      sh.uniforms.tTop = { value: top }; sh.uniforms.tSide = { value: sides || top };
      sh.uniforms.uTil = { value: tiling }; sh.uniforms.uSideS = { value: sideScale };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed,1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tTop; uniform sampler2D tSide; uniform float uTil; uniform float uSideS; varying vec3 vWP; varying vec3 vWN;')
        .replace('#include <map_fragment>', `
          vec3 bw = pow(abs(vWN), vec3(4.0)); bw /= (bw.x + bw.y + bw.z + 1e-4);
          vec4 cy = texture2D(tTop, vWP.xz * uTil);
          vec4 cx = texture2D(tSide, vWP.zy * uTil * uSideS);
          vec4 cz = texture2D(tSide, vWP.xy * uTil * uSideS);
          diffuseColor *= cx * bw.x + cy * bw.y + cz * bw.z;`);
    };
  }
  function patchVCBlend(mat, base, red, green, tl) {
    mat.onBeforeCompile = sh => {
      sh.uniforms.tBase = { value: base }; sh.uniforms.tRed = { value: red || base }; sh.uniforms.tGreen = { value: green || base };
      sh.uniforms.uTil = { value: new THREE.Vector3(tl[0], tl[1], tl[2]) };
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tBase; uniform sampler2D tRed; uniform sampler2D tGreen; uniform vec3 uTil;')
        .replace('#include <map_fragment>', `
          vec4 cb = texture2D(tBase, vMapUv * uTil.x);
          vec4 cr = texture2D(tRed, vMapUv * uTil.y);
          vec4 cg = texture2D(tGreen, vMapUv * uTil.z);
          vec4 blended = mix(mix(cb, cr, clamp(vColor.r,0.0,1.0)), cg, clamp(vColor.g,0.0,1.0));
          diffuseColor.rgb *= blended.rgb;`)
        .replace('#include <color_fragment>', '');
    };
  }
  async function buildArena(id, onProgress) {
    if (arenaId === id) return;
    if (arenaGroup) { scene.remove(arenaGroup); arenaGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    const key = 'arena' + id;
    if (!window.BSS_ASSETS || !window.BSS_ASSETS[key]) { onProgress && onProgress('Loading arena geometry…'); await loadScript('assets/arena_' + id + '.js'); }
    onProgress && onProgress('Unpacking arena…');
    const D = await BSSLoader.load(key);
    nav = D.meta.nav; Y0 = (nav.ymin || 0);
    arenaGroup = new THREE.Group();
    const texCache = {};
    const getTex = async (k, rep) => {
      const ck = k + '|' + (rep ? rep.join(',') : '');
      if (!texCache[ck]) texCache[ck] = makeTex(D.tex[k], { repeat: rep });
      return texCache[ck];
    };
    const mats = {};
    let i = 0;
    for (const [mk, m] of Object.entries(D.meta.materials)) {
      if (i++ % 8 === 0) { onProgress && onProgress(`Building materials ${i}/${Object.keys(D.meta.materials).length}`); await new Promise(r => setTimeout(r, 0)); }
      const col = m.color ? new THREE.Color(m.color[0], m.color[1], m.color[2]) : new THREE.Color(1, 1, 1);
      let mat;
      const T = m.tex;
      if (m.kind === 'water') {
        mat = new THREE.MeshLambertMaterial({ color: col, transparent: true, opacity: 0.82, depthWrite: false });
      } else if (m.kind === 'triplanar' && T._Top) {
        const top = await getTex(T._Top.t), sides = T._Sides ? await getTex(T._Sides.t) : null;
        mat = new THREE.MeshLambertMaterial({ color: col, flatShading: true });
        const til = (m.f && m.f._Tiling) || 0.25;
        patchTriplanar(mat, top, sides, til, T._Sides ? (T._Sides.s[0] || 1) / Math.max(1, T._Top.s[0] || 1) : 1);
      } else if (m.kind === 'vcblend') {
        const baseK = T._MainTex || T.MainTex, redK = T._RedDiffuse, greenK = T._GreenDiffuse;
        const base = baseK ? await getTex(baseK.t) : null, red = redK ? await getTex(redK.t) : null, green = greenK ? await getTex(greenK.t) : null;
        const f = m.f || {};
        mat = new THREE.MeshLambertMaterial({ color: col, map: base || red, vertexColors: true });
        patchVCBlend(mat, base || red || green, red, green, [f._Tiling || 10, f._RedTiling || 15, f._GreenTiling || 15]);
      } else {
        const slot = T.MainTex || T._MainTex || T._BaseMap || T.Main_Texture || T._LeafTex || T._TunkTex || T._Top || T._RedDiffuse || T._Sides;
        const map = slot ? await getTex(slot.t, (slot.s[0] !== 1 || slot.s[1] !== 1) ? slot.s : null) : null;
        const leaf = m.kind === 'leaf' || /leaf|leaves|grass|fern|foliage|bush|plant/i.test(m.name);
        mat = new THREE.MeshLambertMaterial({
          color: col, map, flatShading: !leaf,
          vertexColors: !map && D.meta.meshes.some(ms => ms.mat === mk && ms.c !== undefined),
          alphaTest: leaf || m.cutoff ? 0.45 : 0, side: THREE.DoubleSide,
        });
      }
      mats[mk] = mat;
    }
    onProgress && onProgress('Splitting arena into chunks…'); await new Promise(r => setTimeout(r, 0));
    const TILE = 20;
    D.geoms.forEach((g, gi) => {
      const ms = D.meta.meshes[gi];
      const m = D.meta.materials[ms.mat];
      if (m.fade) return;
      const foliage = m.kind === 'leaf' || /leaf|leaves|grass|fern|foliage|bush|plant|flower/i.test(m.name);
      const pos = g.attributes.position.array, idx = g.index.array, nt = idx.length / 3;
      // some source meshes (Deep Cavern's snow floor) have vertex normals pointing into the ground → render black.
      // Flip any vertex normal that faces away from its triangle.
      const nrm = g.attributes.normal;
      if (nrm && !g.userData.nfix) {
        g.userData.nfix = 1; const na = nrm.array, sc = na instanceof Int8Array ? 1 : 0, acc = new Float32Array(nrm.count * 3);
        for (let t = 0; t < nt; t++) {
          let ia = idx[t * 3], ib = idx[t * 3 + 1], ic = idx[t * 3 + 2]; const a = ia * 3, b = ib * 3, c = ic * 3;
          const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
          let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
          // a mostly-flat triangle wound upside-down: fix its winding so it faces up
          if (fy < 0 && fy * fy > 0.5 * (fx * fx + fy * fy + fz * fz)) { idx[t * 3 + 1] = ic; idx[t * 3 + 2] = ib; fx = -fx; fy = -fy; fz = -fz; }
          for (const v of [ia, ib, ic]) { acc[v * 3] += fx; acc[v * 3 + 1] += fy; acc[v * 3 + 2] += fz; }
        }
        for (let v = 0; v < nrm.count; v++) if (na[v * 3] * acc[v * 3] + na[v * 3 + 1] * acc[v * 3 + 1] + na[v * 3 + 2] * acc[v * 3 + 2] < 0)
          for (let k = 0; k < 3; k++) na[v * 3 + k] = sc ? Math.max(-127, -na[v * 3 + k]) : -na[v * 3 + k];
        nrm.needsUpdate = true; g.index.needsUpdate = true;
      }
      const tiles = new Map();
      for (let t = 0; t < nt; t++) {
        const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
        const cx = (pos[a] + pos[b] + pos[c]) / 3, cz = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
        const k = Math.floor(cx / TILE) * 100000 + Math.floor(cz / TILE);
        let arr = tiles.get(k); if (!arr) tiles.set(k, arr = []); arr.push(t);
      }
      const big = idx.BYTES_PER_ELEMENT === 4;
      for (const tris of tiles.values()) {
        const ti = big ? new Uint32Array(tris.length * 3) : new Uint16Array(tris.length * 3);
        let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
        for (let j = 0; j < tris.length; j++) for (let k = 0; k < 3; k++) {
          const v = idx[tris[j] * 3 + k]; ti[j * 3 + k] = v;
          const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
          if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; if (z < mnz) mnz = z; if (z > mxz) mxz = z;
        }
        const tg = new THREE.BufferGeometry();
        for (const [an, at] of Object.entries(g.attributes)) tg.setAttribute(an, at);   // shared GPU buffers
        tg.setIndex(new THREE.BufferAttribute(ti, 1));
        tg.boundingBox = new THREE.Box3(new THREE.Vector3(mnx, mny, mnz), new THREE.Vector3(mxx, mxy, mxz));
        tg.boundingSphere = tg.boundingBox.getBoundingSphere(new THREE.Sphere());
        const mesh = new THREE.Mesh(tg, mats[ms.mat]);
        mesh.receiveShadow = !foliage; mesh.castShadow = false;
        mesh.matrixAutoUpdate = false; mesh.userData.foliage = foliage;
        mesh.visible = !foliage || PRESET[quality].foliage;
        arenaGroup.add(mesh);
      }
    });
    scene.add(arenaGroup);
    arenaId = id;
    const fogc = new THREE.Color(window.MAPS.find(mm => mm.id === id)?.tint || '#101018');
    scene.background = fogc.clone().multiplyScalar(0.6);
    scene.fog = new THREE.Fog(scene.background, 40, 92);
  }

  // ------------------------------------------------------------ BTD models
  const modelProto = {};
  async function loadModels() {
    await loadRigs();
    await loadRigs('fort');
    BTD = await BSSLoader.load('btd');
    const mats = {};
    for (const [mk, m] of Object.entries(BTD.meta.materials)) {
      const map = m.tex ? await makeTex(BTD.tex[m.tex]) : null;
      mats[mk] = new THREE.MeshLambertMaterial({ map, color: new THREE.Color(m.color[0], m.color[1], m.color[2]) });
    }
    for (const [name, info] of Object.entries(BTD.meta.models)) {
      const g = new THREE.Group();
      for (const mi of info.meshes) {
        const mesh = new THREE.Mesh(BTD.geoms[mi], mats[BTD.meta.meshes[mi].mat]);
        mesh.castShadow = true;
        g.add(mesh);
      }
      // normalise: centre on x/z, feet on y=0
      const cx = (info.min[0] + info.max[0]) / 2, cz = (info.min[2] + info.max[2]) / 2;
      g.children.forEach(c => c.position.set(-cx, -info.min[1], -cz));
      const holder = new THREE.Group(); holder.add(g);
      holder.userData.size = [info.max[0] - info.min[0], info.max[1] - info.min[1], info.max[2] - info.min[2]];
      modelProto[name] = holder;
    }
  }
  function model(name, size, by = 'max') {
    const p = modelProto[name];
    if (!p) return null;
    const m = p.clone(true);
    const s = p.userData.size;
    const ref = by === 'height' ? s[1] : by === 'len' ? s[2] : Math.max(s[0], s[1], s[2]);
    m.scale.setScalar(size / ref);
    m.userData.baseScale = size / ref;
    return m;
  }
  // ------------------------------------------------------------ animated rigs (heroes, towers, blimps, bosses)
  const RIGS = {}, rigInfo = {}, rigClips = {};
  const EYEPUSH = {};
  const RIGYAW = { w_heli_4: Math.PI / 2 };   // IFR heli is authored facing sideways
  // parts to leave off: Brickell skins come sitting in their ship, Red Sauda's shelf blades don't line up with her hands
  const RIGHIDE = {
    s_DreadPirateBrickell: /^(BodyLVL10|FlagPoleLV1|MineDispenser.*|FlagLVL1|PoleLVL1|.*Ship.*)$/i,
    s_LifeguardBrickell: /^(BoatLVL1|DispenserLVL1|OarLVL1|TowerLVL1|FlagLVL1|PoleLVL1|.*Ship.*)$/i,
    s_RedSauda: /^(BladeLVL1|SwordHandles)$/,
    h_Silas: /^ScarfEnd_LVL1$/,
  };
  // load an animated-rig pack (main 'rigs' pack or a lazily loaded skin pack) and register its rigs
  async function loadRigs(key = 'rigs') {
    if (!window.BSS_ASSETS || !window.BSS_ASSETS[key]) return;
    const P = await BSSLoader.load(key);
    if (P.mats) return;
    P.mats = {};
    for (const [mk, m] of Object.entries(P.meta.materials)) {
      const map = m.tex ? await makeTex(P.tex[m.tex]) : null;
      const c = m.color || [1, 1, 1, 1];
      P.mats[mk] = new THREE.MeshLambertMaterial({ map, color: new THREE.Color(c[0], c[1], c[2]), alphaTest: map && P.tex[m.tex].startsWith('data:image/png') ? 0.4 : 0 });
    }
    const buf = P.buf;
    P.meta.meshes.forEach((m, i) => {
      if (m.si === undefined) return;
      const g = P.geoms[i];
      g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(buf, m.si, m.n * 4), 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(buf, m.sw, m.n * 4), 4));
    });
    for (const [name, r] of Object.entries(P.meta.rigs)) {
      const clips = {};
      for (const [ck, c] of Object.entries(r.clips)) {
        const times = new Float32Array(c.nf); for (let i = 0; i < c.nf; i++) times[i] = c.nf > 1 ? i * c.dur / (c.nf - 1) : 0;
        const tracks = [];
        for (const t of c.tracks) {
          const nm = 'n' + t.node + '.' + t.prop;
          const T = t.prop === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
          if (t.c) tracks.push(new T(nm, [0], t.c));
          else tracks.push(new T(nm, times, new Float32Array(buf, t.v, t.n)));
        }
        clips[ck] = new THREE.AnimationClip(ck, c.dur, tracks);
      }
      rigClips[name] = clips;
      RIGS[name] = { r, P };
    }
  }
  async function loadSkin(key) {
    if (RIGS[key]) return true;
    try { if (!window.BSS_ASSETS || !window.BSS_ASSETS[key]) await loadScript('assets/skins/' + key + '.js'); await loadRigs(key); } catch (e) { console.warn('skin', key, e); }
    return !!RIGS[key];
  }
  function hasRig(name) { return !!RIGS[name]; }
  let rabbitP = null; function rabbitLoad() { if (!rabbitP) rabbitP = loadSkin('x_rabbit'); }
  // tower upgrade tiers: one lazily loaded pack per tower skill (assets/towers/tw_<id>.js), rigs named w_<id>_<level>
  const TW = {};
  async function loadTower(sid) {
    if (sid in TW) return; TW[sid] = null;
    try { if (!window.BSS_ASSETS || !window.BSS_ASSETS['tw_' + sid]) await loadScript('assets/towers/tw_' + sid + '.js'); await loadRigs('tw_' + sid); } catch (e) { console.warn('tower', sid, e); return; }
    if (sid === 'sentry') await loadSkin('x_sentries');   // sentry turrets with their tripod legs switched on
    TW[sid] = Object.keys(RIGS).filter(k => k.startsWith('w_' + sid + '_')).map(k => +k.split('_').pop()).filter(n => n > 0).sort((a, b) => a - b);
  }
  const BADRIG = { w_heli_M4: 'w_heli_M3', w_heli_M5: 'w_heli_M3' }; // untextured exports fall back to the tier-3 model
  function towerKey(sid, lv, sk) {
    const ls = TW[sid]; if (!ls) return null;
    // a chosen path (levels 3-7) shows that path's BTD6 model: tier 3 at lv3-4, tier 4 at lv5-6, tier 5 at lv7
    if (sk && lv < 8) { const L = lv >= 5 && sk.path5 ? sk.path5 : lv >= 3 && sk.path3 ? sk.path3 : ''; if (L) { let k = 'w_' + sid + '_' + L + (lv >= 7 ? 5 : lv >= 5 ? 4 : 3); if (BADRIG[k]) k = BADRIG[k]; if (RIGS[k]) return k; } }
    let b = null; for (const L of ls) if (L <= lv) b = L; return b ? 'w_' + sid + '_' + b : null;
  }
  // build a fresh instance (geometry/materials shared). returns holder Group with userData.rig = { mixer, actions, play(tag) }
  function rig(name, size, by = 'height', opts = {}) {
    if (!hasRig(name)) return null;
    const { r, P } = RIGS[name];
    const nodes = r.nodes.map((n, i) => { const o = new THREE.Object3D(); o.name = 'n' + i; o.position.fromArray(n.p); o.quaternion.fromArray(n.q); o.scale.fromArray(n.s); const lv = i > 0 && /(?:lvl|level)\s?0*(\d+)$/i.exec(n.n); o.visible = (n.act !== false || i === 0) && !(opts.hide && opts.hide.test(n.n)) && !(RIGHIDE[name] && i > 0 && RIGHIDE[name].test(n.n)) && !(lv && +lv[1] > 1); return o; });
    r.nodes.forEach((n, i) => { if (n.parent >= 0) nodes[n.parent].add(nodes[i]); });
    const root = nodes[0];
    const inner = new THREE.Group();
    if (RIGYAW[name]) { const yg = new THREE.Group(); yg.rotation.y = RIGYAW[name]; yg.add(root); inner.add(yg); } else inner.add(root);
    const holder = new THREE.Group(); holder.add(inner);
    const skinned = [], rigidParts = [];
    for (const pt of r.parts) {
      // the blink eyelid mesh is only meant to be visible mid-blink; it floats when shown statically
      if (/blink|eyelid/i.test(r.nodes[pt.node].n) || /blink|eyelid/i.test(P.meta.meshes[pt.mesh].name)) continue;
      if (RIGHIDE[name]) { let hid = false; for (let q = pt.node; q > 0; q = r.nodes[q].parent) if (RIGHIDE[name].test(r.nodes[q].n)) { hid = true; break; } if (hid) continue; }
      const ms = P.meta.meshes[pt.mesh], mat = P.mats[ms.mat] || new THREE.MeshLambertMaterial();
      if (pt.bones) {
        const sm = new THREE.SkinnedMesh(P.geoms[pt.mesh], mat);
        const bones = pt.bones.map(b => nodes[b]);
        const inv = pt.inv.map(a => new THREE.Matrix4().fromArray(a));
        sm.frustumCulled = false; sm.castShadow = true;
        root.add(sm); skinned.push([sm, new THREE.Skeleton(bones, inv), ms.name]);
      } else {
        const m = new THREE.Mesh(P.geoms[pt.mesh], mat); m.castShadow = true;
        nodes[pt.node].add(m);
        const pn = r.nodes[pt.node].parent >= 0 ? r.nodes[r.nodes[pt.node].parent].n : '';
        rigidParts.push([m, /^LOD_?\d|^group\d/i.test(r.nodes[pt.node].n) ? pn : r.nodes[pt.node].n]);   // generic mesh names: use the parent's (e.g. 'PropellorApache')
      }
    }
    holder.updateMatrixWorld(true);
    for (const [sm, sk] of skinned) sm.bind(sk, new THREE.Matrix4());
    const mixer = new THREE.AnimationMixer(root);
    const clips = rigClips[name], actions = {};
    for (const [k, c] of Object.entries(clips)) actions[k] = mixer.clipAction(c);
    // measure in idle pose
    let idle = actions.idle || actions.place || actions.fly || actions.spin || actions.loop || actions.move;
    if (!idle && clips.attack) { // no idle clip: hold the first frame of the attack as a pose
      const c = clips.attack, f0 = c.tracks.map(t => { const n = t.getValueSize(); return new t.constructor(t.name, [0], Array.from(t.values.slice(0, n))); });
      idle = actions.idle = mixer.clipAction(new THREE.AnimationClip('idle0', 1, f0));
    }
    if (idle) { idle.play(); mixer.update(0); }
    holder.updateMatrixWorld(true);
    const ikey = name + (opts.hide ? String(opts.hide) : '');
    let info = rigInfo[ikey];
    if (!info) {
      const box = new THREE.Box3(), v = new THREE.Vector3();
      root.traverse(o => {
        if (!o.isMesh) return;
        for (let q = o; q; q = q.parent) if (!q.visible) return;
        const pa = o.geometry.attributes.position, step = Math.max(1, Math.floor(pa.count / 1500));
        for (let i = 0; i < pa.count; i += step) {
          v.fromBufferAttribute(pa, i);
          if (o.isSkinnedMesh) o.applyBoneTransform(i, v);
          v.applyMatrix4(o.matrixWorld); box.expandByPoint(v);
        }
      });
      if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
      info = rigInfo[ikey] = { min: box.min.clone(), max: box.max.clone() };
    }
    const s = [info.max.x - info.min.x, info.max.y - info.min.y, info.max.z - info.min.z];
    const ref = by === 'height' ? s[1] : by === 'len' ? s[2] : Math.max(...s);
    const sc = size / (ref || 1);
    inner.scale.setScalar(sc);
    inner.position.set(-(info.min.x + info.max.x) / 2 * sc, -info.min.y * sc, -(info.min.z + info.max.z) / 2 * sc);
    holder.userData.baseScale = sc;
    // some faces (Brickell) rely on an in-game eye shader that draws the eyes over the face; nudge those eyes out in front instead
    const ep = EYEPUSH[name];
    if (ep) {
      holder.updateMatrixWorld(true);
      const dist = ep * (info.max.y - info.min.y) * sc, fw = new THREE.Vector3(0, 0, -1);
      for (const [sm, sk, mn] of skinned) {
        if (!/^eyes/i.test(mn || '') || sm.geometry.userData.pushed) continue;
        sm.geometry.userData.pushed = 1;
        const M = new THREE.Matrix4().multiplyMatrices(sk.bones[0].matrixWorld, sk.boneInverses[0]), I = M.clone().invert();
        const o = new THREE.Vector3(0, 1, 0).applyMatrix4(M), d = o.clone().addScaledVector(fw, dist).applyMatrix4(I).sub(new THREE.Vector3(0, 1, 0));
        const pa = sm.geometry.attributes.position;
        for (let i = 0; i < pa.count; i++) pa.setXYZ(i, pa.getX(i) + d.x, pa.getY(i) + d.y, pa.getZ(i) + d.z);
        pa.needsUpdate = true; sm.geometry.computeBoundingSphere();
      }
    }
    // propellers / rotors without clips spin procedurally
    // propellers/rotors: spin each rigid blade mesh about its own centre, along its thinnest axis
    const spinners = [];
    for (const [m, nm] of rigidParts) {
      if (!/^prop$|^prop\d|propel|turbine/i.test(nm)) continue;
      const g = m.geometry; if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox, sz = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
      { const d = [sz.x, sz.y, sz.z].sort((a, b) => a - b); if (d[0] / d[2] > 0.3) continue; }   // only flat blades spin, not whole engine pods/housings
      const ax = sz.x <= sz.y && sz.x <= sz.z ? new THREE.Vector3(1, 0, 0) : sz.y <= sz.z ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
      const pivot = new THREE.Object3D(); pivot.position.copy(c); m.parent.add(pivot); pivot.add(m); m.position.sub(c);
      spinners.push({ o: pivot, ax, sp: /turbine/i.test(nm) ? 4 : 22 });
    }
    let cur = idle || null, busyT = 0;
    const R = {
      mixer, actions, spinners, name,
      play(tag, { speed = 1 } = {}) {
        const a = actions[tag] || (tag === 'attack' ? Object.values(actions).find(x => /attack|throw|shoot|fire|cast/i.test(x.getClip().name)) : null);
        if (!a || !idle) return false;
        if (a === idle) return true;
        a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; a.timeScale = speed;
        a.setEffectiveWeight(1); a.play(); if (cur && cur !== a) a.crossFadeFrom(cur, 0.08, false);
        cur = a; busyT = a.getClip().duration / speed;
        return true;
      },
      busy() { return busyT > 0; },
      update(dt) {
        mixer.update(dt);
        if (busyT > 0) { busyT -= dt; if (busyT <= 0.12 && cur !== idle) { idle.reset(); idle.setEffectiveWeight(1); idle.play(); idle.crossFadeFrom(cur, 0.15, false); cur = idle; } }
        for (const s of spinners) s.o.rotateOnAxis(s.ax, dt * s.sp);
      },
    };
    holder.userData.rig = R;
    return holder;
  }

  // ------------------------------------------------------------ menu hero preview (own renderer on the menu canvas)
  let PV = null;
  function previewInit(canvas) {
    if (PV) return;
    const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.1;
    r.shadowMap.enabled = true;
    const sc = new THREE.Scene();
    sc.add(new THREE.HemisphereLight(0xfff4e6, 0x3a2a40, 1.6));
    const key = new THREE.DirectionalLight(0xfff0dd, 2.4); key.position.set(3, 7, 5); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 20 }); sc.add(key);
    const rim = new THREE.DirectionalLight(0x9fb8ff, 1.6); rim.position.set(-4, 3, -5); sc.add(rim);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.5, 0.3, 48), new THREE.MeshLambertMaterial({ color: 0x3a2a33 }));
    ped.position.y = 0.15; ped.receiveShadow = true; sc.add(ped);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.36, 1.5, 64), new THREE.MeshBasicMaterial({ color: 0xffc35a, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.305; sc.add(ring);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(2.4, 48), new THREE.MeshBasicMaterial({ map: radialTexture(), color: 0xffb040, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.01; sc.add(glow);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
    PV = { r, sc, cam, canvas, model: null, rotY: 0.5, drag: null, t: 0, animT: 3, key: null, w: 0, h: 0 };
    canvas.addEventListener('pointerdown', e => { PV.drag = e.clientX; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; });
    canvas.addEventListener('pointermove', e => { if (PV.drag !== null) { PV.rotY += (e.clientX - PV.drag) * 0.012; PV.drag = e.clientX; } });
    canvas.addEventListener('pointerup', () => { PV.drag = null; canvas.style.cursor = 'grab'; });
  }
  async function setPreview(key) {
    if (!PV) return;
    PV.key = key;
    if (key.startsWith('s_')) await loadSkin(key);
    if (PV.key !== key) return;
    if (PV.model) PV.sc.remove(PV.model);
    const m = actor(key, 2.1, 'height');
    if (!m) return;
    m.position.y = 0.3; m.traverse(o => { if (o.isMesh) o.castShadow = true; });
    PV.sc.add(m); PV.model = m; PV.animT = 3.5;
    if (m.userData.rig) m.userData.rig.play('place');
  }
  function renderPreview(dt) {
    if (!PV) return;
    const c = PV.canvas, w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (w !== PV.w || h !== PV.h) { PV.w = w; PV.h = h; PV.r.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); PV.r.setSize(w, h, false); PV.cam.aspect = w / h; PV.cam.updateProjectionMatrix(); }
    const wide = w / h > 1.2;
    PV.cam.position.set(wide ? -1.6 : 0, 2.2, 8.6); PV.cam.lookAt(wide ? -1.6 : 0, 1.2, 0);
    PV.sc.position.x = 0;
    if (PV.drag === null) PV.rotY += dt * 0.35;
    if (PV.model) {
      PV.model.rotation.y = PV.rotY;
      const rg = PV.model.userData.rig;
      if (rg) {
        rg.update(dt);
        PV.animT -= dt;
        if (PV.animT <= 0 && !rg.busy()) { PV.animT = 4 + Math.random() * 2; rg.play(Math.random() < 0.6 ? 'attack' : 'upgrade'); }
      }
    }
    PV.r.render(PV.sc, PV.cam);
  }
  // model or rig, whichever exists (rig preferred)
  function actor(name, size, by, opts) { return rig(name, size, by, opts) || model(name.replace(/^h_|^t_/, 'm_'), size, by); }
  function faceAngle(a) { return Math.atan2(-Math.cos(a), -Math.sin(a)); }

  // ------------------------------------------------------------ pools (instanced)
  const pools = {};
  function instPool(name, geom, mat, cap) {
    const m = new THREE.InstancedMesh(geom, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; m.count = 0;
    pools[name] = { mesh: m, n: 0, cap };
    return pools[name];
  }
  // Effects slider: the player's skill visuals go into twin pools whose opacity follows SETTINGS.fx
  let DIM = false, fxA = 1;
  function twin(name) {
    const k = name + '~'; if (pools[k]) return k;
    const src = pools[name]; if (!src) return name;
    const mat = src.mesh.material.clone(); mat.transparent = true; mat.depthWrite = false;
    const p = instPool(k, src.mesh.geometry, mat, src.cap); p.baseOp = src.mesh.material.opacity ?? 1; p.aspect = src.aspect;
    p.mesh.castShadow = false; scene.add(p.mesh);
    return k;
  }
  function push(name, pos, quat, scale, color) {
    if (DIM && fxA < 0.999) { if (fxA <= 0.01) return; name = twin(name); }
    const p = pools[name]; if (!p || p.n >= p.cap) return;
    tmpM.compose(pos, quat, scale);
    p.mesh.setMatrixAt(p.n, tmpM);
    if (color && p.mesh.instanceColor !== undefined) p.mesh.setColorAt(p.n, color);
    p.n++;
  }
  const ENEMY_HZ = /^(slime|magma|bossSlam|chargeLine|cyclone)$/;
  const IDQ = new THREE.Quaternion();
  const FLATQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  let bloonMats = {};
  function buildPools() {
    // bloon billboards: one instanced mesh per sprite
    const plane = new THREE.PlaneGeometry(1, 1);
    for (const [n, s] of Object.entries(window.BLOON_SPRITES || {})) {
      const t = new THREE.Texture(); t.colorSpace = THREE.SRGBColorSpace;
      const im = new Image(); im.onload = () => { t.image = im; t.needsUpdate = true; }; im.src = s.uri;
      const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.35, depthWrite: true, toneMapped: false });
      bloonMats[n] = mat;
      const p = instPool('spr_' + n, plane, mat, n.startsWith('Fire') || n.startsWith('Pop') ? 300 : 700);
      p.aspect = s.aspect;
      p.mesh.setColorAt(0, new THREE.Color(1, 1, 1)); // allocate instanceColor
    }
    // blob shadows
    const sh = new THREE.CircleGeometry(0.5, 16);
    instPool('shadow', sh, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }), 1500);
    // souls
    const oct = new THREE.OctahedronGeometry(0.22);
    const sp = instPool('soul', oct, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 1500);
    sp.mesh.setColorAt(0, new THREE.Color());
    const glow = new THREE.PlaneGeometry(1, 1);
    const glowTex = radialTexture();
    const gp = instPool('glow', glow, new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 3000);
    gp.mesh.setColorAt(0, new THREE.Color());
    const gfl = instPool('glowFlat', glow, new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 600);
    gfl.mesh.setColorAt(0, new THREE.Color());
    // explosion flashes: drawn on top (no depth test, no fog) so the quad never clips into the ground as a hard-edged square
    const bp = instPool('burst', glow, new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false, toneMapped: false }), 800);
    bp.mesh.setColorAt(0, new THREE.Color()); bp.mesh.renderOrder = 5;
    // rings (telegraphs, novas)
    const ring = new THREE.RingGeometry(0.92, 1, 48);
    const rp = instPool('ring', ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }), 400);
    rp.mesh.setColorAt(0, new THREE.Color());
    const disc = new THREE.CircleGeometry(1, 40);
    const dp = instPool('disc', disc, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }), 300);
    dp.mesh.setColorAt(0, new THREE.Color());
    const da = instPool('discAdd', disc, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 300);
    da.mesh.setColorAt(0, new THREE.Color());
    // projectiles
    const dart = new THREE.ConeGeometry(0.07, 0.75, 6); dart.rotateX(Math.PI / 2);
    instPool('dart', dart, new THREE.MeshLambertMaterial({ color: 0x5a3c22 }), 600);
    const tack = new THREE.ConeGeometry(0.06, 0.45, 5); tack.rotateX(Math.PI / 2);
    instPool('tack', tack, new THREE.MeshLambertMaterial({ color: 0xd8dde4 }), 600);
    const glaive = new THREE.TorusGeometry(0.32, 0.09, 6, 12); glaive.rotateX(Math.PI / 2);
    instPool('glaive', glaive, new THREE.MeshLambertMaterial({ color: 0xcfe0f0, emissive: 0x223344 }), 200);
    const star = starGeometry(0.34, 0.1, 4);
    instPool('shuriken', star, new THREE.MeshLambertMaterial({ color: 0xc0c6d0, side: THREE.DoubleSide }), 400);
    const bomb = new THREE.SphereGeometry(0.3, 12, 8);
    instPool('bomb', bomb, new THREE.MeshLambertMaterial({ color: 0x1d1d22 }), 200);
    const torp = new THREE.CapsuleGeometry(0.12, 0.6, 4, 8); torp.rotateX(Math.PI / 2);
    instPool('torpedo', torp, new THREE.MeshLambertMaterial({ color: 0x9fb3c8 }), 200);
    const bullet = new THREE.BoxGeometry(0.07, 0.07, 0.4);
    instPool('bullet', bullet, new THREE.MeshBasicMaterial({ color: 0xffe28a, toneMapped: false }), 600);
    for (const p of ['dart', 'tack', 'glaive', 'shuriken', 'bomb', 'torpedo']) pools[p].mesh.castShadow = true;
    // BTD6 projectile sprites, laid flat and pointed along the flight direction (image top = forward)
    const pplane = new THREE.PlaneGeometry(1, 1); pplane.rotateX(-Math.PI / 2); pplane.rotateY(Math.PI);
    for (const [n, s] of Object.entries(window.BTD_PROJ || {})) {
      const t = new THREE.Texture(); t.colorSpace = THREE.SRGBColorSpace;
      const im = new Image(); im.onload = () => { t.image = im; t.needsUpdate = true; }; im.src = s.uri;
      const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.2, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
      const p = instPool('ps_' + n, pplane, mat, 400); p.aspect = s.w / s.h;
    }
    // lines (lightning, beams)
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6000 * 3), 3));
    lg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(6000 * 3), 3));
    lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, toneMapped: false }));
    lines.frustumCulled = false;
  }
  let lines, lineN = 0;
  function addLine(a, b, col) {
    if (lineN >= 5998) return;
    const P = lines.geometry.attributes.position.array, C = lines.geometry.attributes.color.array;
    P.set([a.x, a.y, a.z, b.x, b.y, b.z], lineN * 3);
    const f = DIM ? fxA : 1; if (f <= 0.01) return;
    C.set([col.r * f, col.g * f, col.b * f, col.r * f, col.g * f, col.b * f], lineN * 3);
    lineN += 2;
  }
  function starGeometry(R, r, n) {
    const s = new THREE.Shape();
    for (let i = 0; i < n * 2; i++) { const a = i * Math.PI / n, rr = i % 2 ? r : R; i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(rr, 0); }
    const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); return g;
  }
  function radialTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); return t;
  }

  // ------------------------------------------------------------ dynamic actors
  let player = null, playerKey = null;
  const big = new Map();       // bloon/boss -> model
  const summonModels = new Map(), compModels = new Map();
  // projectile sprite sizes (world units along the longest side), which ones spin, and which glow
  const PSIZE = { Dart: 0.75, PowerfulDart: 0.8, Arrow: 0.9, MasterArrow: 1.1, ArrowExplosive: 1.1, Boomerang: 0.8, KylieBoomerang: 1.0, Glaive: 0.85, HotGlaive: 0.9, GoldenGlaive: 0.95, GlaiveLordGlaive: 1.1,
    Bomb: 0.6, BigBomb: 0.75, ReallyBigBomb: 0.95, Tack: 0.45, Blade: 0.6, ParagonBlade: 0.75, Shuriken: 0.55, SharpShuriken: 0.6, SeekingShuriken: 0.6, SharpSeekingShuriken: 0.65,
    FireBallStill: 1.0, PlasmaBlast: 0.8, LaserBlast: 0.7, BlastSunAvatar: 0.9, SunTempleBlast: 1.2, BallofLightAA: 1.1, Bullet: 0.4, BuccaneerDart: 0.7, CannonBall: 0.6, GrapeShot: 0.35,
    SubDart: 0.7, BallisticMissile: 1.3, PreemptiveStrikeMissile: 1.5, Javelin: 1.5, IceShard: 0.75, RocketStormRocket: 1.1, HydraRocketPod: 0.9, ApacheMissile: 1.0, ComancheBomb: 0.9,
    LaserCannon: 0.9, SpectreDart: 0.8, TankShell: 0.8, SpiritSpear: 2.0, PlasmaBullet: 0.7, LaserBolt: 0.7, FirstStrikeMissile: 1.6, ETNDartSprite: 0.8, DartSprite: 0.75, BallLightning: 0.8,
    Snowball: 0.5, RejuvPotion: 0.6, MoabBarrageBomb: 0.8, UCAVMissileSprite: 0.9 };
  const PSPIN = /Glaive|Boomerang|Blade|Shuriken|Bomb$|CannonBall|Snowball|Potion/;
  const PGLOW = { FireBallStill: '#ff7a20', PlasmaBlast: '#e040ff', LaserBlast: '#ff3030', BlastSunAvatar: '#ffd040', SunTempleBlast: '#ffe070', BallofLightAA: '#fff2a0', BallLightning: '#c0a0ff', LaserBolt: '#ff4060', PlasmaBullet: '#c060ff' };
  const COMP_SKIP = { heli: 1, ace: 1, village: 1, farm: 1 };
  const BEASTM = { raptor1: ['t_Raptor1', 1.5, 'max'], raptor2: ['t_Raptor2', 1.7, 'max'], raptor3: ['t_Raptor3', 1.9, 'max'], trex2: ['t_TRex2', 2.5, 'max'], trex3: ['t_TRex3', 2.7, 'max'], giga3: ['t_Giga3', 3.0, 'max'],
    eagle1: ['x_eagle1', 1.8, 'max'], eagle2: ['x_eagle2', 2.1, 'max'], condor2: ['x_condor2', 2.6, 'max'], pouakai2: ['x_pouakai2', 3.0, 'max'], pouakai3: ['x_pouakai3', 3.4, 'max'] };
  const pickupModels = new Map(), peerModels = new Map();
  function setPlayerModel(key) {
    if (player) scene.remove(player);
    player = actor(key, 1.9, 'height') || new THREE.Mesh(new THREE.SphereGeometry(0.6), new THREE.MeshLambertMaterial({ color: 0x8b5a2b }));
    playerKey = key;
    scene.add(player);
    playerAnim('place');
  }
  function playerAnim(tag, speed) { const r = player && player.userData.rig; return r ? r.play(tag, { speed }) : false; }
  function playerBusy() { const r = player && player.userData.rig; return r ? r.busy() : false; }
  function resetRun() {
    for (const m of big.values()) scene.remove(m); big.clear();
    for (const m of summonModels.values()) scene.remove(m); summonModels.clear(); for (const c of compModels.values()) scene.remove(c.m); compModels.clear();
    for (const m of pickupModels.values()) scene.remove(m); pickupModels.clear();
    for (const m of peerModels.values()) scene.remove(m); peerModels.clear();
    for (const p of Object.values(pools)) if (!p.mesh.parent) scene.add(p.mesh);
    if (!lines.parent) scene.add(lines);
  }
  const MOAB_MODEL = { moab: ['moab', 'moab_ds1', 'moab_ds2', 'moab_ds3', 'moab_ds4'], bfb: ['bfb', 'bfb_ds2', 'bfb_ds4'], zomg: ['zomg', 'zomg_ds2', 'zomg_ds4'], ddt: ['ddt', 'ddt_ds2', 'ddt_ds4'], bad: ['bad', 'bad_ds2', 'bad_ds4'] };
  function bigModelFor(b) {
    let list, len;
    if (b.isBoss) { list = [b.def.model]; len = b.r * 2.6; }
    else if (b.def.rig) { list = [b.def.rig]; len = b.r * 2.6; }
    else { list = (b.fort && hasRig(b.type + 'F') ? MOAB_MODEL[b.type].map(k => k.replace(/^([a-z]+)/, '$1F')) : MOAB_MODEL[b.type]) || ['moab']; len = b.r * 2.4; }
    const f = 1 - b.hp / b.maxhp;
    const k = Math.min(list.length - 1, Math.floor(f * list.length));
    return { key: list[k], len };
  }

  // a tower standing beside a hero (mine or a teammate's), wearing its current upgrade tier
  const cseen = new Set();
  function drawComp(sk, pos, G, dt, P) {
    const key = towerKey(sk.id, sk.lv, sk); if (!key) return;
    cseen.add(sk);
    let c = compModels.get(sk);
    if (c && c.key !== key) { scene.remove(c.m); compModels.delete(sk); c = null; G.effects.push({ kind: 'ring', x: P.x, y: P.y, r: 2.2, t: 0, life: 0.5, color: '#ffe39a' }); }
    if (!c) {
      const big = /spike|mortar|dartling|sub|buccaneer|farm|tack|bomb/.test(sk.id) || (sk.id === 'plasma' && sk.lv >= 7);
      const m = actor(key, big ? 1.5 : 1.25, big ? 'max' : 'height'); if (!m) return;
      c = { m, key, x: P.x, y: P.y, fired: sk.fired || 0, face: 0 }; compModels.set(sk, c); scene.add(m);
      if (m.userData.rig) m.userData.rig.play('upgrade') || m.userData.rig.play('place');
    }
    c.x = pos.x; c.y = pos.y;   // position is owned by the game (projectiles launch from here)
    let best = null, bd = 196;
    for (const b of G.bloons) { const dx = b.x - c.x, dy = b.y - c.y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = b; } }
    if (best) c.face = Math.atan2(best.y - c.y, best.x - c.x);
    c.m.position.copy(w(c.x, c.y, 0));
    let d = faceAngle(c.face) - c.m.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); c.m.rotation.y += d * Math.min(1, dt * 10);
    const rg = c.m.userData.rig;
    if (rg) { if ((sk.fired || 0) !== c.fired) { c.fired = sk.fired || 0; if (!rg.busy()) rg.play('attack', { speed: 1.4 }); } rg.update(dt); }
    push('shadow', w(c.x, c.y, 0.04), FLATQ, tmpS.set(1.3, 1.3, 1));
  }
  const white = new THREE.Color(1, 1, 1), frozenC = new THREE.Color(0.6, 0.9, 1.3), slowC = new THREE.Color(0.8, 1.1, 0.6);
  function frame(G, dt) {
    if (!nav) return;
    for (const p of Object.values(pools)) p.n = 0;
    lineN = 0;
    const camQ = camera.quaternion;
    // camera follow (Soulstone-style high angle)
    const P = G.player;
    const target = toWorld(P.x, P.y, 0, new THREE.Vector3());
    const shake = G.cam.shake * 0.35;
    camLook.lerp(target, 1 - Math.pow(0.0001, dt));
    if (camLook.lengthSq() === 0 || camLook.distanceTo(target) > 30) camLook.copy(target);
    camPos.set(camLook.x, camLook.y + 21, camLook.z + 15);
    camera.position.copy(camPos).add(new THREE.Vector3((Math.random() - .5) * shake, (Math.random() - .5) * shake, 0));
    camera.lookAt(camLook);
    sun.position.set(camLook.x + 14, camLook.y + 32, camLook.z + 10); sun.target.position.copy(camLook);

    // player
    if (player) {
      const moving = Math.hypot(P.vx, P.vy) > 0.5;
      const bob = moving ? Math.abs(Math.sin(G.t * 12)) * 0.15 : Math.sin(G.t * 3) * 0.03;
      player.position.copy(target).y += bob + (P.dashT > 0 ? 0.3 : 0);
      const ang = moving ? Math.atan2(P.vy, P.vx) : (P.faceA ?? Math.PI / 2);
      if (moving) P.faceA = ang;
      const want = faceAngle(ang);
      let d = want - player.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
      player.rotation.y += d * Math.min(1, dt * 14);
      player.rotation.z = moving ? Math.sin(G.t * 12) * 0.06 : 0;
      if (player.userData.rig) player.userData.rig.update(dt);
      player.visible = !P.hidden && !(P.inv > 0 && Math.floor(G.t * 20) % 2 && P.hurtT > -0.3);
      push('shadow', w(P.x, P.y, 0.04), FLATQ, tmpS.set(1.2, 1.2, 1));
      if (P.buffT > 0) push('glow', w(P.x, P.y, 0.9), camQ, tmpS.set(3, 3, 1), tmpC.set(1, 0.3, 0.85));
    }
    // co-op teammates
    const peerSeen = new Set();
    for (const pe of G.peers || []) {
      if (!hasRig(pe.key)) continue;   // model not loaded yet
      peerSeen.add(pe.id);
      let pm = peerModels.get(pe.id);
      if (pm && pm.userData.pkey !== pe.key) { scene.remove(pm); peerModels.delete(pe.id); pm = null; }
      if (!pm) { pm = actor(pe.key, 1.9, 'height') || new THREE.Mesh(new THREE.SphereGeometry(0.6), new THREE.MeshLambertMaterial({ color: 0x8b5a2b })); pm.userData.pkey = pe.key; peerModels.set(pe.id, pm); scene.add(pm); if (pm.userData.rig) pm.userData.rig.play('place'); }
      const Q = pe.player, moving = !Q.down && Math.hypot(Q.vx, Q.vy) > 0.5;
      pm.position.copy(w(Q.x, Q.y, Q.down ? 0.25 : (moving ? Math.abs(Math.sin(G.t * 12)) * 0.15 : Math.sin(G.t * 3) * 0.03) + (Q.dashT > 0 ? 0.3 : 0)));
      let d = faceAngle(Q.faceA ?? Math.PI / 2) - pm.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); pm.rotation.y += d * Math.min(1, dt * 14);
      pm.rotation.z = Q.down ? 1.35 : moving ? Math.sin(G.t * 12) * 0.06 : 0;
      if (pm.userData.rig) pm.userData.rig.update(dt);
      pm.visible = !(Q.inv > 0 && Math.floor(G.t * 20) % 2 && Q.hurtT > -0.3);
      push('shadow', w(Q.x, Q.y, 0.04), FLATQ, tmpS.set(1.2, 1.2, 1));
      if (Q.down) push('glow', w(Q.x, Q.y, 0.3), camQ, tmpS.set(3.4, 3.4, 1), tmpC.setRGB(1, 0.25, 0.25));
      if (Q.buffT > 0) push('glow', w(Q.x, Q.y, 0.9), camQ, tmpS.set(3, 3, 1), tmpC.set(1, 0.3, 0.85));
      for (const c of pe.comps.values()) drawComp(c.sk, c, G, dt, Q);
    }
    for (const [id, m] of peerModels) if (!peerSeen.has(id)) { scene.remove(m); peerModels.delete(id); }
    if (player) {   // my own downed pose
      if (P.down) { player.rotation.z = 1.35; player.position.y -= 0; push('glow', w(P.x, P.y, 0.3), camQ, tmpS.set(3.4, 3.4, 1), tmpC.setRGB(1, 0.25, 0.25)); }
    }
    // bloons
    const seen = new Set();
    for (const b of G.bloons) {
      if (b.dead) continue;
      if (b.bornT > 0) b.bornT -= dt;
      const s = b.r * 2.3 * (b.bornT > 0 ? 1 - 0.8 * b.bornT / 0.35 : 1);   // new bloons grow in instead of appearing at full size
      if (b.def.moab) {
        seen.add(b); drawBig(b, G, dt); continue;
      }
      let key = b.def.spr;
      // BTD6 variant art: <Type>[Regrow][Fortified][Camo][DamageN]
      const vk = b.def.spr + (b.regrow ? 'Regrow' : '') + (b.fort ? 'Fortified' : '') + (b.camo ? 'Camo' : '');
      if (vk !== key && pools['spr_' + vk]) key = vk;
      if (b.type === 'ceramic') { const f = b.hp / b.maxhp; if (f <= 0.8) { const dk = key + 'Damage' + Math.min(4, 1 + Math.floor((0.8 - f) / 0.2)); if (pools['spr_' + dk]) key = dk; } }
      else if (b.def.ds) { const f = b.hp / b.maxhp; if (f < 0.75) key = b.def.ds + Math.min(3, 1 + Math.floor((0.75 - f) / 0.25)); }
      const pool = pools['spr_' + key]; if (!pool) continue;
      const bob = Math.sin(b.wob) * 0.07 + (b.hop > 0 ? Math.sin(b.hop * Math.PI) * 1.2 : 0);
      const pos = w(b.x, b.y, s * 0.5 + 0.15 + bob);
      const hs = b.hitT > 0 ? 1.12 : 1;
      if (b.def.golden && pools.spr_GoldenBloonGlow) push('spr_GoldenBloonGlow', pos, camQ, tmpS.set(s * 1.25 * pool.aspect, s * 1.25, 1), white);
      if (b.slime) push('glow', pos, camQ, tmpS.setScalar(s * 1.5), tmpC.setRGB(0.25, 0.9, 0.2));
      if (b.wind) push('glow', pos, camQ, tmpS.setScalar(s * 1.5), tmpC.setRGB(0.45, 0.75, 1));
      let tint = b.frozenT > 0 ? frozenC : b.slowT > 0 && G.skills.some(k => k.id === 'glue') ? slowC : white;
      if (b.phase) { tint = b.phased ? tmpC2.setRGB(0.35, 0.2, 0.6) : tmpC2.setRGB(0.85, 0.7, 1.1); push('glow', pos, camQ, tmpS.setScalar(s * (b.phased ? 1.8 : 1.3)), tmpC.setRGB(0.5, 0.2, 0.9)); }
      push('spr_' + key, pos, camQ, tmpS.set(s * pool.aspect * hs, s * hs, 1), tint);
      push('shadow', w(b.x, b.y, 0.04), FLATQ, tmpS.set(b.r * 1.6, b.r * 1.6, 1));
      if (b.burnT > 0) { const fk = 'Fire00' + (1 + Math.floor((G.t * 12 + b.wob) % 4)); if (pools['spr_' + fk]) push('spr_' + fk, w(b.x, b.y, s * 0.6), camQ, tmpS.set(s * 0.7, s * 0.7, 1), white); }
    }
    if (G.boss && !G.boss.dead) { seen.add(G.boss); drawBig(G.boss, G, dt); }
    for (const [b, m] of big) if (!seen.has(b)) { scene.remove(m); big.delete(b); }

    // bloon spawn portals: same look as the Continue portal, purple with small cyan sparks (the middle MOAB/boss one is bigger)
    for (const sp of G.spawnPortals || []) {
      const k = sp.kind === 'moab' ? 1.45 : 1, t = sp.t || 0, c = tmpC2.setRGB(0.68, 0.28, 1);
      push('discAdd', w(sp.x, sp.y, 0.06), FLATQ, tmpS.set(1.6 * k, 1.6 * k, 1), tmpC.copy(c).multiplyScalar(0.45 + 0.08 * Math.sin(t * 3)));
      push('ring', w(sp.x, sp.y, 0.08), FLATQ, tmpS.set(1.7 * k, 1.7 * k, 1), c);
      push('glow', w(sp.x, sp.y, 1.6 * k), camQ, tmpS.set(2.6 * k, 3.8 * k, 1), tmpC.copy(c).multiplyScalar(0.9));
      push('glow', w(sp.x, sp.y, 1.6 * k), camQ, tmpS.set(1.1 * k, 2.4 * k, 1), tmpC.setRGB(0.95, 0.85, 1));
      for (let i = 0; i < 6; i++) { const a = t * 3 + i * 1.047, h = 0.4 + ((t * 1.5 + i / 6) % 1) * 2.6 * k; push('glow', w(sp.x + Math.cos(a) * 1.1 * k, sp.y + Math.sin(a) * 1.1 * k, h), camQ, tmpS.setScalar(0.45), c); }
      // small cyan sparks drifting up through the middle
      for (let i = 0; i < 5; i++) { const f = (t * 0.9 + i / 5) % 1, a = -t * 2 + i * 2.4, rr = 0.35 * k + 0.25 * Math.sin(i * 3.1); push('glow', w(sp.x + Math.cos(a) * rr, sp.y + Math.sin(a) * rr, 0.3 + f * 3.2 * k), camQ, tmpS.setScalar(0.34 * (1 - f * 0.5)), tmpC.setRGB(0.2, 1, 1).multiplyScalar(1.4 - f * 0.6)); }
    }
    // Soulstone-style portals after a boss kill
    if (G.portals) for (const pt of G.portals) {
      const c = pt.kind === 'continue' ? tmpC2.setRGB(0.3, 0.75, 1) : tmpC2.setRGB(1, 0.35, 0.25), gk = Math.min(1, pt.t * 2);
      push('discAdd', w(pt.x, pt.y, 0.06), FLATQ, tmpS.set(1.6 * gk, 1.6 * gk, 1), tmpC.copy(c).multiplyScalar(0.45));
      push('ring', w(pt.x, pt.y, 0.08), FLATQ, tmpS.set(1.7 * gk, 1.7 * gk, 1), c);
      push('glow', w(pt.x, pt.y, 1.6), camQ, tmpS.set(2.6 * gk, 3.8 * gk, 1), tmpC.copy(c).multiplyScalar(0.9));
      push('glow', w(pt.x, pt.y, 1.6), camQ, tmpS.set(1.1 * gk, 2.4 * gk, 1), tmpC.setRGB(1, 1, 1));
      for (let i = 0; i < 6; i++) { const a = pt.t * 3 + i * 1.047, h = 0.4 + ((pt.t * 1.5 + i / 6) % 1) * 2.6; push('glow', w(pt.x + Math.cos(a) * 1.1, pt.y + Math.sin(a) * 1.1, h), camQ, tmpS.setScalar(0.45), c); }
    }
    // pickups
    const pseen = new Set();
    for (const pk of G.pickups) {
      if (pk.kind === 'soul') {
        const c = pk.v >= 5 ? tmpC.setRGB(1, 0.45, 1) : pk.v >= 2 ? tmpC.setRGB(0.45, 0.8, 1) : tmpC.setRGB(0.45, 1, 0.8);
        const pos = w(pk.x, pk.y, 0.45 + Math.sin(pk.t * 5) * 0.1);
        const sz = 1 + Math.min(1.2, Math.sqrt(pk.v) * 0.25);
        if (pools.spr_XPStar) { const sp = 0.28 * sz * (1 + Math.sin(pk.t * 6) * 0.06); push('spr_XPStar', w(pk.x, pk.y, 0.35 + Math.sin(pk.t * 5) * 0.05), camQ, tmpS.set(sp, sp, 1), white); push('glow', w(pk.x, pk.y, 0.35), camQ, tmpS.set(sz * 0.7, sz * 0.7, 1), c); }
        else { tmpQ.setFromEuler(new THREE.Euler(0, pk.t * 2, 0)); push('soul', pos, tmpQ, tmpS.set(sz, sz, sz), c); push('glow', pos, camQ, tmpS.set(sz * 1.6, sz * 1.6, 1), c); }
      } else if (pk.kind === 'coin') {
        push('spr_CoinSpr', w(pk.x, pk.y, 0.45 + Math.abs(Math.sin(pk.t * 5)) * 0.2), camQ, tmpS.set(0.55, 0.55, 1), white);
      } else if (pk.kind === 'relic') {   // relic: its BTD6 artifact icon floating in a golden glow
        const key = 'relic_' + pk.id;
        if (!pools[key] && window.relicById) { const r = relicById(pk.id); if (r) { const t = new THREE.Texture(); t.colorSpace = THREE.SRGBColorSpace; const im = new Image(); im.onload = () => { t.image = im; t.needsUpdate = true; }; im.src = (window.RELIC_TEX && RELIC_TEX[r.icon]) || ''; const pl = instPool(key, new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.1, depthWrite: false, toneMapped: false }), 20); scene.add(pl.mesh); } }
        const h = 0.9 + Math.sin(pk.t * 3) * 0.15;
        push('glow', w(pk.x, pk.y, h), camQ, tmpS.set(2.6, 2.6, 1), tmpC.setRGB(1, 0.75 + Math.sin(pk.t * 5) * 0.15, 0.3));
        if (pools[key]) push(key, w(pk.x, pk.y, h), camQ, tmpS.set(1.1, 1.1, 1));
        push('ring', w(pk.x, pk.y, 0.08), FLATQ, tmpS.set(1 + Math.sin(pk.t * 4) * 0.1, 1 + Math.sin(pk.t * 4) * 0.1, 1), tmpC.setRGB(1, 0.8, 0.3));
      } else if (pk.kind === 'banana') {
        push('spr_Banana', w(pk.x, pk.y, 0.5), camQ, tmpS.set(0.9, 0.9, 1), white);
      } else {
        pseen.add(pk);
        let m = pickupModels.get(pk);
        if (!m) { m = model(pk.kind === 'chest' ? 'i_CrateCoins' : 'i_CrateLives', pk.kind === 'chest' ? 1.4 : 0.9) || new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xc8902c })); pickupModels.set(pk, m); scene.add(m); }
        m.position.copy(w(pk.x, pk.y, 0.1 + Math.abs(Math.sin(pk.t * 3)) * 0.3)); m.rotation.y = pk.t * 1.5;
        if (pk.kind === 'chest') push('glow', w(pk.x, pk.y, 0.8), camQ, tmpS.set(4, 4, 1), pk.afford ? tmpC.setRGB(1, 0.8, 0.3) : tmpC.setRGB(0.5, 0.35, 0.2));
      }
    }
    for (const [pk, m] of pickupModels) if (!pseen.has(pk)) { scene.remove(m); pickupModels.delete(pk); }

    // summons
    const sseen = new Set();
    for (const sm of G.summons) {
      sseen.add(sm);
      let m = summonModels.get(sm);
      if (sm.kind === 'rabbit' && !hasRig('x_wererabbit')) { rabbitLoad(); continue; }
      const lvl = sm.sk ? sm.sk.lv : 1;
      const SUM = {
        heli: [towerKey('heli', lvl, sm.sk) || 't_HeliPilot', 1.6, 'max', { hide: /^(Helipad|Lights|HeliPad.*)$/i }],
        sentry: [lvl >= 7 ? 't_SentryChamp' : lvl >= 5 ? 't_SentryBoom' : lvl >= 3 ? 't_SentryEnergy' : 't_Sentry', 1.3, 'height'],
        ace: lvl >= 8 && towerKey('ace', 8) ? [towerKey('ace', 8), 3.6, 'max'] : sm.sk && sm.sk.path3 && towerKey('ace', lvl, sm.sk) !== towerKey('ace', lvl) ? [towerKey('ace', lvl, sm.sk), 2.3, 'max'] : lvl >= 7 ? ['t_Ace204', 2.2, 'max'] : lvl >= 5 ? ['t_Ace104', 2.0, 'max'] : ['t_MonkeyAce', 1.9, 'max', { hide: /^MonkeyAceBase$/ }],
        beast: BEASTM[sm.sp] && hasRig(BEASTM[sm.sp][0]) ? BEASTM[sm.sp] : ['t_Raptor1', 1.5, 'max'],
        drone: ['x_drone', 0.9, 'max'],
        rabbit: ['x_wererabbit', 1.05, 'max'],
        village: towerKey('village', lvl, sm.sk) ? [towerKey('village', lvl, sm.sk), 2.6, 'max'] : ['m_MonkeyVillage', 2.6, 'max'], farm: [towerKey('farm', lvl, sm.sk) || 't_BananaFarm', 2.0, 'max'],
      }[sm.kind] || ['t_EngineerMonkey', 1.1, 'height'];
      if (m && m.userData.skey !== SUM[0]) { scene.remove(m); summonModels.delete(sm); m = null; G.effects.push({ kind: 'ring', x: sm.x, y: sm.y, r: 2, t: 0, life: 0.5, color: '#ffe39a' }); }
      if (!m) {
        m = actor(SUM[0], SUM[1], SUM[2], SUM[3]) || actor(sm.kind === 'beast' ? 't_BeastHandler' : sm.kind === 'sentry' ? 't_EngineerMonkey' : 't_MonkeyAce', 1.3, 'max') || new THREE.Object3D(); m.userData.skey = SUM[0]; summonModels.set(sm, m); scene.add(m); m.rotation.order = 'YXZ'; sm.a0 = Math.random() * 7;
        if (m.userData.rig) m.userData.rig.play('place');
      }
      const fly = sm.kind === 'rabbit' ? (sm.moving ? Math.abs(Math.sin(G.t * 11 + (sm.a0 || 0))) * 0.35 : 0) : sm.kind === 'drone' ? 1.9 + Math.sin(G.t * 4 + (sm.a0 || 0)) * 0.12 : sm.kind === 'heli' ? 2.2 + Math.sin(G.t * 3 + (sm.a || 0)) * 0.15 : sm.kind === 'ace' ? 3.2 : sm.bird ? 2.8 - (sm.dive || 0) * 1.9 + Math.sin(G.t * 2.4 + (sm.a0 || 0)) * 0.2 : 0;
      m.position.copy(w(sm.x, sm.y, fly));
      if (sm.face !== undefined) { let d = faceAngle(sm.face) - m.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); m.rotation.y += d * Math.min(1, dt * 12); }
      if (sm.kind === 'ace') { // banking turn + an occasional barrel roll
        const ph = (G.t + (sm.a0 || 0)) % 7; m.rotation.z = -0.35 - (ph < 0.9 ? (ph / 0.9) * Math.PI * 2 : 0); m.rotation.x = Math.sin(G.t * 2.1) * 0.06;
      } else if (sm.kind === 'heli') { m.rotation.x = 0.18; m.rotation.z = Math.sin(G.t * 1.7 + (sm.a || 0)) * 0.08; }
      const rg = m.userData.rig;
      if (rg) { if (sm.anim) { rg.play(sm.anim); sm.anim = null; } rg.update(dt); }
      if (sm.kind === 'ace') push('shadow', w(sm.x, sm.y, 0.04), FLATQ, tmpS.set(1.6, 1.6, 1));
      if (sm.kind === 'sentry') m.visible = (sm.life - sm.t) > 1 || Math.floor(G.t * 10) % 2;
      if (sm.kind === 'heli' || sm.kind === 'drone') push('shadow', w(sm.x, sm.y, 0.04), FLATQ, tmpS.set(sm.kind === 'drone' ? 0.8 : 1.4, sm.kind === 'drone' ? 0.8 : 1.4, 1));
      if (sm.bird) { push('shadow', w(sm.x, sm.y, 0.04), FLATQ, tmpS.set(1.5, 1.5, 1)); }
    }
    for (const [sm, m] of summonModels) if (!sseen.has(sm)) { scene.remove(m); summonModels.delete(sm); }
    // tower companions: every tower skill without its own summon stands beside the hero, wearing its current upgrade tier
    const comps = G.skills.filter(sk => TW[sk.id] && G.towerPos && G.towerPos[sk.id]);
    comps.forEach(sk => drawComp(sk, G.towerPos[sk.id], G, dt, P));
    for (const [sk, c] of compModels) if (!cseen.has(sk)) { scene.remove(c.m); compModels.delete(sk); }
    cseen.clear();
    const fs = G.skills.find(s => s.id === 'fire');
    if (fs && fs.state.phoenix && fs.state.phoenix.x !== undefined) push('glow', w(fs.state.phoenix.x, fs.state.phoenix.y, 1.8), camQ, tmpS.set(3, 3, 1), tmpC.setRGB(1, 0.5, 0.15));
    const bs = G.skills.find(s => s.id === 'boomer');
    if (bs && bs.lv >= 7) for (let i = 0; i < 2; i++) { const a = (bs.state.oa || 0) + i * Math.PI; tmpQ.setFromEuler(new THREE.Euler(0, a * 3, 0)); if (pools.ps_GlaiveLordGlaive) push('ps_GlaiveLordGlaive', w(P.x + Math.cos(a) * 2.6, P.y + Math.sin(a) * 2.6, 0.9), tmpQ, tmpS.set(1.5, 1, 1.5)); else push('glaive', w(P.x + Math.cos(a) * 2.6, P.y + Math.sin(a) * 2.6, 0.9), tmpQ, tmpS.set(1.6, 1.6, 1.6)); }

    // projectiles (all of them are the players' skills)
    fxA = Math.max(0, Math.min(1, typeof SETTINGS !== 'undefined' && SETTINGS.fx !== undefined ? SETTINGS.fx : 1));
    DIM = true;
    for (const pr of G.projs) {
      const pos = w(pr.x, pr.y, 0.9);
      const a = pr.rot || 0;
      if (pr.spr && pools['ps_' + pr.spr]) { // real BTD6 projectile art
        const pool = pools['ps_' + pr.spr], L = 1.35 * (PSIZE[pr.spr] || PSIZE[pr.spr.replace(/\d+$/, '')] || 0.8), spin = PSPIN.test(pr.spr);
        tmpQ.setFromEuler(new THREE.Euler(0, spin ? (pr.t || 0) * 14 : faceAngle(a), 0));
        const len = pool.aspect >= 1 ? L / pool.aspect : L, wid = pool.aspect >= 1 ? L : L * pool.aspect;
        push('ps_' + pr.spr, w(pr.x, pr.y, 0.9), tmpQ, tmpS.set(wid, 1, len));
        if (PGLOW[pr.spr]) push('glow', w(pr.x, pr.y, 0.95), camQ, tmpS.set(L * 1.4, L * 1.4, 1), tmpC.set(PGLOW[pr.spr]));
        continue;
      }
      tmpQ.setFromEuler(new THREE.Euler(0, faceAngle(a), 0));
      switch (pr.kind) {
        case 'dart': push('dart', pos, tmpQ, tmpS.set(1, 1, 1)); break;
        case 'bolt': push('dart', pos, tmpQ, tmpS.set(1.4, 1.4, 1.4)); push('glow', pos, camQ, tmpS.set(0.8, 0.8, 1), tmpC.setRGB(1, 0.9, 0.5)); break;
        case 'tack': push('tack', pos, tmpQ, tmpS.set(1, 1, 1)); break;
        case 'glaive': tmpQ.setFromEuler(new THREE.Euler(0, a * 3, 0)); push('glaive', pos, tmpQ, tmpS.setScalar(pr.r / 0.35)); break;
        case 'shuriken': tmpQ.setFromEuler(new THREE.Euler(0, pr.t * 20, 0)); push('shuriken', pos, tmpQ, tmpS.set(1, 1, 1)); break;
        case 'bomb': push('bomb', pos, IDQ, tmpS.set(1, 1, 1)); push('glow', w(pr.x, pr.y, 1.2), camQ, tmpS.set(0.5, 0.5, 1), tmpC.setRGB(1, 0.6, 0.15)); break;
        case 'torpedo': push('torpedo', pos, tmpQ, tmpS.set(1, 1, 1)); push('glow', pos, camQ, tmpS.set(0.9, 0.9, 1), tmpC.setRGB(0.5, 0.9, 1)); break;
        case 'plasma': push('glow', pos, camQ, tmpS.set(1.1, 1.1, 1), tmpC.setRGB(0.45, 0.65, 1)); push('glow', pos, camQ, tmpS.set(0.4, 0.4, 1), tmpC.setRGB(1, 1, 1)); break;
        case 'sun': push('glow', pos, camQ, tmpS.set(1.5, 1.5, 1), tmpC.setRGB(1, 0.85, 0.35)); push('glow', pos, camQ, tmpS.set(0.5, 0.5, 1), tmpC.setRGB(1, 1, 1)); break;
        case 'bullet': push('bullet', pos, tmpQ, tmpS.set(1, 1, 1)); break;
        case 'orb': { const c = tmpC2.set(pr.color || '#ffffff'); push('glow', pos, camQ, tmpS.set(1.1, 1.1, 1), c); push('glow', pos, camQ, tmpS.set(0.4, 0.4, 1), tmpC.setRGB(1, 1, 1)); break; }
        case 'wave': { const r = pr.r || 0.7; push('glow', pos, camQ, tmpS.set(r * 3, r * 3, 1), tmpC.setRGB(0.25, 0.75, 1)); push('glow', pos, camQ, tmpS.set(r * 1.3, r * 1.3, 1), tmpC.setRGB(0.8, 0.95, 1)); push('ring', w(pr.x, pr.y, 0.15), FLATQ, tmpS.set(r * 1.2, r * 1.2, 1), tmpC.setRGB(0.3, 0.8, 1)); break; }
      }
    }
    DIM = false;
    // enemy shots (the pink orbs) always show at full strength, whatever the Skill Effects slider says
    for (const e of G.eproj) { const pos = w(e.x, e.y, 0.9); push('glow', pos, camQ, tmpS.setScalar(e.r * 3.5), tmpC.setRGB(1, 0.2, 0.35)); push('glow', pos, camQ, tmpS.setScalar(e.r * 1.2), white); }

    // hazards (players' traps dim; boss slime/magma/slams/charges always show)
    for (const h of G.hazards.concat(G.netHaz || [])) {
      const k = h.t / h.life;
      DIM = !ENEMY_HZ.test(h.kind);
      if (h.kind === 'slime') { push('disc', w(h.x, h.y, 0.06), FLATQ, tmpS.set(h.r, h.r * 0.9, 1), tmpC.setRGB(0.3, 0.85, 0.15)); }
      else if (h.kind === 'magma') { push('discAdd', w(h.x, h.y, 0.07), FLATQ, tmpS.set(h.r, h.r, 1), tmpC.setRGB(0.9 * (1 - k * 0.6), 0.3 * (1 - k), 0.05)); }
      else if (h.kind === 'glue') { push('disc', w(h.x, h.y, 0.06), FLATQ, tmpS.set(h.r, h.r * 0.85, 1), h.fire ? tmpC.setRGB(1, 0.42, 0.1) : tmpC.setRGB(0.66, 0.9, 0.24)); if (h.fire && Math.random() < 0.3) push('glow', w(h.x + (Math.random() - .5) * h.r * 1.4, h.y + (Math.random() - .5) * h.r * 1.4, 0.5), camQ, tmpS.set(1.2, 1.2, 1), tmpC2.setRGB(1, 0.5, 0.1)); }
      else if (h.kind === 'spikes') { for (let i = 0; i < 6; i++) { const aa = i * 2.4 + h.x, d = (i % 3) * 0.3 * h.r; tmpQ.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)); push('tack', w(h.x + Math.cos(aa) * d, h.y + Math.sin(aa) * d, 0.2), tmpQ, tmpS.set(1.2, 1.2, 1.2)); } }
      else if (h.kind === 'bossSlam' || h.kind === 'delayed') {
        const c = h.kind === 'bossSlam' ? tmpC.setRGB(1, 0.15, 0.15) : tmpC.setRGB(1, 0.65, 0.2);
        push('ring', w(h.x, h.y, 0.08), FLATQ, tmpS.set(h.r, h.r, 1), c);
        push('discAdd', w(h.x, h.y, 0.07), FLATQ, tmpS.set(h.r * k, h.r * k, 1), tmpC.copy(c).multiplyScalar(0.35));
      } else if (h.kind === 'cyclone') {   // Vortex's enraged pull: spinning rings closing in
        for (let i = 0; i < 3; i++) { const f = 1 - ((h.t * 0.9 + i / 3) % 1); push('ring', w(h.x, h.y, 0.09 + i * 0.01), FLATQ, tmpS.set(h.r * f, h.r * f, 1), tmpC.setRGB(0.35, 0.8, 1).multiplyScalar(0.4 + 0.6 * (1 - f))); }
        for (let i = 0; i < 8; i++) { const a = -h.t * 4 + i * 0.785, rr = h.r * (0.25 + 0.7 * ((i * 0.37 + h.t) % 1)); push('glow', w(h.x + Math.cos(a) * rr, h.y + Math.sin(a) * rr, 0.5 + (i % 3) * 0.5), camQ, tmpS.setScalar(0.6), tmpC.setRGB(0.5, 0.9, 1)); }
      } else if (h.kind === 'chargeLine') {
        const steps = 12;
        for (let i = 0; i <= steps; i++) { const d = h.len * i / steps; push('discAdd', w(h.x + Math.cos(h.a) * d, h.y + Math.sin(h.a) * d, 0.07), FLATQ, tmpS.set(h.w / 2, h.w / 2, 1), tmpC.setRGB(0.25 + 0.3 * k, 0.03, 0.03)); }
      }
    }
    // effects (skill effects dim; bloon pops and anything the boss/enemies made always show)
    for (const e of G.effects) {
      const k = e.t / e.life, fade = 1 - k;
      DIM = !e.enemy && e.kind !== 'pop' && e.kind !== 'coinpop' && e.kind !== 'ghost';
      switch (e.kind) {
        case 'pop': { // simple balloon burst: quick flash + coloured shreds flying out
          const hgt = e.r * 1.15 + 0.15, c = tmpC.set(e.color || '#ffffff');
          if (k < 0.5) push('glow', w(e.x, e.y, hgt), camQ, tmpS.setScalar(e.r * 2.2 * (1 - k)), tmpC2.setRGB(fade, fade, fade));
          for (let i = 0; i < 5; i++) { const a = i * 1.2566 + e.x * 3.1, d = e.r * (0.4 + k * 1.3); push('glow', w(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, hgt - k * 0.4), camQ, tmpS.setScalar(e.r * 0.45 * fade + 0.05), tmpC2.copy(c).multiplyScalar(fade * 1.2)); }
          break; }
        case 'boom': push('burst', w(e.x, e.y, 0.6), camQ, tmpS.setScalar(e.r * 2.4 * (0.6 + k * 0.6)), tmpC.set(e.color || '#ffb347').multiplyScalar(Math.max(0, fade) * 1.4));
          push('discAdd', w(e.x, e.y, 0.06), FLATQ, tmpS.set(e.r * (0.5 + k * 0.6), e.r * (0.5 + k * 0.6), 1), tmpC.set(e.color || '#ffb347').multiplyScalar(fade * 0.6)); break;
        case 'ring': push('ring', w(e.x, e.y, 0.1), FLATQ, tmpS.set(e.r * k + 0.01, e.r * k + 0.01, 1), tmpC.set(e.color).multiplyScalar(fade)); break;
        case 'frost': push('ring', w(e.x, e.y, 0.1), FLATQ, tmpS.setScalar(e.r * (0.3 + 0.7 * k)), tmpC.setRGB(0.6 * fade, 0.85 * fade, 1 * fade));
          push('discAdd', w(e.x, e.y, 0.08), FLATQ, tmpS.set(e.r * (0.3 + 0.7 * k), e.r * (0.3 + 0.7 * k), 1), tmpC.setRGB(0.15 * fade, 0.25 * fade, 0.35 * fade)); break;
        case 'flame': { const d = e.sp * e.t; push('burst', w(e.x + Math.cos(e.a) * d, e.y + Math.sin(e.a) * d, 0.8), camQ, tmpS.setScalar((0.5 + k * 1.6) * e.s), k < 0.4 ? tmpC.setRGB(1, 0.8, 0.3) : tmpC.setRGB(1 * fade, 0.35 * fade, 0.1 * fade)); break; }
        case 'target': push('ring', w(e.x, e.y, 0.09), FLATQ, tmpS.set(e.r, e.r, 1), tmpC.setRGB(1, 0.75, 0.25)); break;
        case 'bolt': {
          const a = toWorld(e.x, e.y, 1), b2 = toWorld(e.x2, e.y2, 0.9), n = 6; let prev = a;
          const c = new THREE.Color(0.75 * fade, 0.9 * fade, 1 * fade);
          for (let i = 1; i <= n; i++) { const t = i / n; const p = i === n ? b2 : new THREE.Vector3().lerpVectors(a, b2, t).add(new THREE.Vector3((Math.random() - .5) * 0.7, (Math.random() - .5) * 0.4, (Math.random() - .5) * 0.7)); addLine(prev, p, c); prev = p; }
          push('glow', b2, camQ, tmpS.setScalar(1.2), c); break; }
        case 'line': { const a = toWorld(e.x, e.y, 1), b2 = toWorld(e.x2, e.y2, 0.9); addLine(a, b2, tmpC.set(e.color).multiplyScalar(fade)); break; }
        case 'slash': { const n = 7; for (let i = 0; i < n; i++) { const a = e.a - e.arc / 2 + e.arc * i / (n - 1), rr = e.r * (0.55 + 0.45 * k); push('glow', w(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr, 0.9), camQ, tmpS.setScalar(0.9 * fade + 0.2), tmpC.setRGB(fade, fade * 0.95, fade * 0.8)); } break; }
        case 'ghost': push('glow', w(e.x, e.y, 0.8), camQ, tmpS.setScalar(1.6 * fade), tmpC.setRGB(0.4 * fade, 0.7 * fade, 1 * fade)); break;
        case 'expl': { // blimp / big blast: white-hot core, fireballs rolling outward, ground shockwave
          const f = Math.max(0, fade), h = 0.6 + e.r * 0.35;
          push('burst', w(e.x, e.y, h), camQ, tmpS.setScalar(e.r * 2.6 * (0.45 + k * 0.8)), tmpC.setRGB(1.5 * f, 1.15 * f, 0.7 * f));
          for (let i = 0; i < 8; i++) { const a = i * 0.785 + e.x * 1.7, d = e.r * (0.25 + k * 0.9); push('burst', w(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, h + Math.sin(i * 2.1) * 0.4 * e.r * k), camQ, tmpS.setScalar(e.r * (0.9 - k * 0.4)), k < 0.35 ? tmpC.setRGB(1.3, 0.75, 0.25) : tmpC.setRGB(1.1 * f, 0.38 * f, 0.08 * f)); }
          push('ring', w(e.x, e.y, 0.1), FLATQ, tmpS.set(e.r * 1.6 * k + 0.01, e.r * 1.6 * k + 0.01, 1), tmpC.setRGB(1 * f, 0.6 * f, 0.25 * f)); break; }
        case 'spark': push('glow', w(e.x, e.y, e.h || 1), camQ, tmpS.setScalar((e.r || 0.8) * (1 + k)), tmpC.set(e.color || '#ffe9a0').multiplyScalar(fade * 1.3)); break;
        case 'coinpop': push('spr_CoinSpr', w(e.x, e.y, 1 + k * 1.6), camQ, tmpS.setScalar(0.5 * fade + 0.2), white); break;
      }
    }
    DIM = false;
    // commit pools
    for (const p of Object.values(pools)) {
      if (p.baseOp !== undefined) p.mesh.material.opacity = p.baseOp * fxA;
      p.mesh.count = p.n; p.mesh.visible = p.n > 0;
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
    }
    lines.geometry.setDrawRange(0, lineN);
    lines.geometry.attributes.position.needsUpdate = true; lines.geometry.attributes.color.needsUpdate = true;
    renderer.render(scene, camera);
    tick();
  }
  function drawBig(b, G, dt) {
    const { key, len } = bigModelFor(b);
    let m = big.get(b);
    if (!m || m.userData.key !== key) {
      if (m) scene.remove(m);
      const rk = b.isBoss ? 'b_' + key : key;
      m = rig(rk, len, 'len') || model(key, len, 'len') || model('moab', len, 'len');
      if (!m) return;
      m.userData.key = key; big.set(b, m); scene.add(m);
      m.traverse(o => { if (o.material) { o.material = o.material.clone(); } });
      if (m.userData.rig && b.isBoss && !b.placed) { b.placed = true; m.userData.rig.play('place'); }
    }
    const rg = m.userData.rig;
    if (rg) { if (b.anim) { rg.play(b.anim); b.anim = null; } rg.update(dt); }
    const hover = b.isBoss ? 0.4 : 0.8;
    m.position.copy(w(b.x, b.y, hover + Math.sin(b.wob) * 0.12));
    const a = Math.atan2(G.player.y - b.y, G.player.x - b.x);
    const want = faceAngle(a);
    let d = want - m.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
    m.rotation.y += d * Math.min(1, dt * 3);
    const flash = b.hitT > 0 && (performance.now() / 70 | 0) % 2 ? 0.14 : 0;
    const fk = flash + (b.enraged ? 1 : 0);
    if (m.userData.flash !== fk) { m.userData.flash = fk; m.traverse(o => { if (o.material && o.material.emissive) { if (b.enraged) o.material.emissive.setRGB(0.22 + flash, 0.05 + flash, 0.34 + flash); else o.material.emissive.setScalar(flash); } }); }
    // ENRAGED boss: the purple phasing glow on the boss itself (no circle on the ground), pulsing, with sparks rising off it
    if (b.enraged) {
      const t = performance.now() / 1000, pu = 1 + 0.08 * Math.sin(t * 4);
      push('glow', w(b.x, b.y, len * 0.4), camera.quaternion, tmpS.set(len * 1.35 * pu, len * 1.1 * pu, 1), tmpC.setRGB(0.22, 0.07, 0.42));
      for (let i = 0; i < 7; i++) { const f = (t * 0.7 + i / 7) % 1, a = t * 1.5 + i * 0.9, rr = len * (0.35 + 0.1 * Math.sin(i * 2.3)); push('glow', w(b.x + Math.cos(a) * rr, b.y + Math.sin(a) * rr, 0.4 + f * len * 0.9), camera.quaternion, tmpS.setScalar(0.45 * (1 - f * 0.5)), tmpC.setRGB(0.7, 0.3, 1).multiplyScalar(1.1 - f * 0.8)); }
    }
    if (b.frozenT > 0 || b.stunT > 0) push('glow', w(b.x, b.y, 1), camera.quaternion, tmpS.setScalar(len), tmpC.setRGB(0.3, 0.5, 0.8));
    push('shadow', w(b.x, b.y, 0.04), FLATQ, tmpS.set(len * 0.7, len * 0.7, 1));
  }
  // project a game-space point to screen pixels (HUD canvas space)
  const pv = new THREE.Vector3();
  function project(x, y, h, W, H) {
    if (!nav) return null;
    toWorld(x, y, h, pv).project(camera);
    if (pv.z > 1) return null;
    return [(pv.x * 0.5 + 0.5) * W, (-pv.y * 0.5 + 0.5) * H];
  }
  // mouse (css px) -> game-space ground point
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function screenToGame(mx, my) {
    if (!nav) return null;
    ndc.set(mx / innerWidth * 2 - 1, -(my / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    groundPlane.constant = -Y0;
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(groundPlane, hit)) return null;
    return [hit.x - nav.x0, hit.z + nav.z1];
  }
  function viewRadius() { return 22; }
  function renderIdle() { if (renderer && scene) renderer.render(scene, camera); }
  return { get renderer() { return renderer; }, setQuality, getQuality, stats, init, buildArena, loadModels, setPlayerModel, resetRun, frame, project, screenToGame, viewRadius, renderIdle, model, rig, actor, hasRig, loadRigs, loadSkin, loadTower, previewInit, setPreview, renderPreview, playerAnim, playerBusy, get camera() { return camera; }, get scene() { return scene; }, get nav() { return nav; } };
})();
