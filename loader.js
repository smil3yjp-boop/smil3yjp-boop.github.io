// Decodes BSS asset packs (base64 gzip binary + data-URI textures) into three.js objects. Works from file://.
'use strict';
const BSSLoader = (() => {
  async function gunzip(b64) {
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const ds = new DecompressionStream('gzip');
    const buf = await new Response(new Blob([bin]).stream().pipeThrough(ds)).arrayBuffer();
    return buf;
  }
  const texCache = new Map();
  function loadTex(uri, opts = {}) {
    if (texCache.has(uri)) return texCache.get(uri);
    const t = new THREE.Texture();
    const img = new Image();
    img.onload = () => { t.image = img; t.needsUpdate = true; };
    img.src = uri;
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    texCache.set(uri, t);
    return t;
  }
  async function load(name) {
    const A = window.BSS_ASSETS[name];
    if (!A) throw new Error('asset pack missing: ' + name);
    if (A.decoded) return A.decoded;
    const buf = await gunzip(A.bin);
    A.bin = null; // free
    const meta = A.meta;
    const geoms = meta.meshes.map(m => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, m.p, m.n * 3), 3));
      if (m.nrm !== undefined) g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(buf, m.nrm, m.n * 3), 3, true));
      if (m.uv !== undefined) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(buf, m.uv, m.n * 2), 2));
      if (m.c !== undefined) g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(buf, m.c, m.n * 4), 4, true));
      if (m.i16 !== undefined) g.setIndex(new THREE.BufferAttribute(new Uint16Array(buf, m.i16, m.ni), 1));
      else g.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, m.i, m.ni), 1));
      if (m.nrm === undefined) g.computeVertexNormals();
      g.computeBoundingSphere();
      return g;
    });
    A.decoded = { meta, geoms, tex: A.tex, buf };
    return A.decoded;
  }
  return { load, loadTex };
})();
