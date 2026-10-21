// ============================================================================
// METROPOLIS — tools/render_preview.mjs
// Rastériseur logiciel minimal (sans GPU, sans dépendance) : rend les modèles
// GLB en PNG pour VALIDER VISUELLEMENT les proportions, la circularité des
// roues et les poses d'animation. C'est notre "œil" dans un environnement
// sans navigateur.
//
//   node tools/render_preview.mjs cars       -> previews/cars.png
//   node tools/render_preview.mjs chars      -> previews/chars.png
//   node tools/render_preview.mjs all
// ============================================================================
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

globalThis.self = globalThis;
globalThis.Image = class { constructor() { this.onload = null; this.onerror = null; } set src(_v) { setTimeout(() => this.onerror && this.onerror(new Error('no image')), 0); } };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THREE = await import(pathToFileURL(path.join(ROOT, 'web/node_modules/three/build/three.module.js')).href);
const { GLTFLoader } = await import(pathToFileURL(path.join(ROOT, 'web/node_modules/three/examples/jsm/loaders/GLTFLoader.js')).href);
const { clone: cloneSkinned } = await import(pathToFileURL(path.join(ROOT, 'web/node_modules/three/examples/jsm/utils/SkeletonUtils.js')).href);

// ------------------------------- PNG encode --------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------ Framebuffer --------------------------------
class Canvas {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.color = Buffer.alloc(w * h * 4);
    this.depth = new Float32Array(w * h).fill(Infinity);
    for (let i = 0; i < w * h; i++) {
      // dégradé de fond doux
      const y = Math.floor(i / w) / h;
      this.color[i * 4] = Math.round(24 + 26 * (1 - y));
      this.color[i * 4 + 1] = Math.round(30 + 34 * (1 - y));
      this.color[i * 4 + 2] = Math.round(40 + 48 * (1 - y));
      this.color[i * 4 + 3] = 255;
    }
  }
  put(x, y, z, r, g, b) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    if (z >= this.depth[i]) return;
    this.depth[i] = z;
    this.color[i * 4] = r; this.color[i * 4 + 1] = g; this.color[i * 4 + 2] = b;
  }
  blend(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.color[i] = Math.round(this.color[i] * (1 - a) + r * a);
    this.color[i + 1] = Math.round(this.color[i + 1] * (1 - a) + g * a);
    this.color[i + 2] = Math.round(this.color[i + 2] * (1 - a) + b * a);
  }
  toPNG() { return encodePNG(this.w, this.h, this.color); }
}

// --------------------------- Projection caméra ------------------------------
function makeCamera({ eye, target, up = [0, 1, 0], fov = 32 }) {
  const e = new THREE.Vector3(...eye), t = new THREE.Vector3(...target), u = new THREE.Vector3(...up);
  const f = t.clone().sub(e).normalize();
  const r = new THREE.Vector3().crossVectors(f, u).normalize();
  const realUp = new THREE.Vector3().crossVectors(r, f).normalize();
  return { e, f, r, u: realUp, tanHalf: Math.tan((fov * Math.PI) / 360) };
}
function project(cam, p, W, H) {
  const d = p.clone().sub(cam.e);
  const z = d.dot(cam.f);
  if (z <= 0.01) return null;
  const x = d.dot(cam.r) / z / (cam.tanHalf * (W / H));
  const y = d.dot(cam.u) / z / cam.tanHalf;
  return { sx: (x * 0.5 + 0.5) * W, sy: (1 - (y * 0.5 + 0.5)) * H, z };
}

// ------------------------------- Géométrie ---------------------------------
const LIGHT = new THREE.Vector3(-0.45, 0.8, 0.55).normalize();
const LIGHT2 = new THREE.Vector3(0.6, 0.2, -0.5).normalize();

function collectTriangles(root, { skinned = false } = {}) {
  root.updateMatrixWorld(true);
  // Hors rendu, three.js ne rafraîchit PAS les matrices d'os : sans cet
  // appel, le maillage reste en pose de liaison pendant que le squelette
  // bouge. C'était la cause des "éclats".
  root.traverse((o) => { if (o.isSkinnedMesh && o.skeleton) o.skeleton.update(); });
  const tris = [];
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    let vis = true, n2 = o;
    while (n2) { if (n2.visible === false) { vis = false; break; } n2 = n2.parent; }
    if (!vis) return;
    // halos additifs / matériaux transparents : hors cadre et hors bbox
    if (o.material && o.material.transparent && (o.material.opacity ?? 1) < 0.2) return;
    const geo = o.geometry;
    const pos = geo.attributes.position;
    if (!pos) return;
    const index = geo.index ? geo.index.array : null;
    const triCount = (index ? index.length : pos.count) / 3;
    for (let t = 0; t < triCount; t++) {
      const ia = index ? index[t * 3] : t * 3;
      const ib = index ? index[t * 3 + 1] : t * 3 + 1;
      const ic = index ? index[t * 3 + 2] : t * 3 + 2;
      if (o.isSkinnedMesh && !globalThis.__NO_SKIN__) {
        // three.js : applyBoneTransform attend le vecteur DÉJÀ rempli
        // avec la position de base du sommet.
        tmpA.fromBufferAttribute(pos, ia); o.applyBoneTransform(ia, tmpA); tmpA.applyMatrix4(o.matrixWorld);
        tmpB.fromBufferAttribute(pos, ib); o.applyBoneTransform(ib, tmpB); tmpB.applyMatrix4(o.matrixWorld);
        tmpC.fromBufferAttribute(pos, ic); o.applyBoneTransform(ic, tmpC); tmpC.applyMatrix4(o.matrixWorld);
      } else {
        tmpA.fromBufferAttribute(pos, ia).applyMatrix4(o.matrixWorld);
        tmpB.fromBufferAttribute(pos, ib).applyMatrix4(o.matrixWorld);
        tmpC.fromBufferAttribute(pos, ic).applyMatrix4(o.matrixWorld);
      }
      for (const P of [tmpA, tmpB, tmpC]) {
        if (P.x < mnx) mnx = P.x; if (P.y < mny) mny = P.y; if (P.z < mnz) mnz = P.z;
        if (P.x > mxx) mxx = P.x; if (P.y > mxy) mxy = P.y; if (P.z > mxz) mxz = P.z;
      }
      const n = new THREE.Vector3().subVectors(tmpB, tmpA).cross(new THREE.Vector3().subVectors(tmpC, tmpA));
      if (n.lengthSq() < 1e-12) continue;
      n.normalize();
      const shade = Math.max(0.12, n.dot(LIGHT) * 0.75 + Math.max(0, n.dot(LIGHT2)) * 0.25 + 0.32);
      const col = o.material?.color;
      const cr = col ? col.r : 0.8, cg = col ? col.g : 0.8, cb = col ? col.b : 0.85;
      tris.push({
        a: [tmpA.x, tmpA.y, tmpA.z], b: [tmpB.x, tmpB.y, tmpB.z], c: [tmpC.x, tmpC.y, tmpC.z],
        // ATTENTION : les clés de couleur ne doivent PAS s'appeler r/g/b :
        // `b` écraserait le sommet `b` du triangle (bug historique du rendu).
        cr: Math.min(255, Math.round(255 * Math.pow(cr * shade, 0.85))),
        cg: Math.min(255, Math.round(255 * Math.pow(cg * shade, 0.85))),
        cb: Math.min(255, Math.round(255 * Math.pow(cb * shade, 0.85))),
        n: [n.x, n.y, n.z],
      });
    }
  });
  const bbox = { min: [mnx, mny, mnz], max: [mxx, mxy, mxz] };
  bbox.center = [(mnx + mxx) / 2, (mny + mxy) / 2, (mnz + mxz) / 2];
  bbox.size = [mxx - mnx, mxy - mny, mxz - mnz];
  bbox.radius = Math.hypot(...bbox.size) / 2;
  return { tris, bbox };
}

/** Cadre automatiquement : distance telle que la sphère englobante tienne. */
function framedCamera(center, radius, dir, fov = 30, margin = 1.12) {
  const d = radius / Math.sin((fov * Math.PI) / 360) * margin;
  const e = new THREE.Vector3(center[0] + dir[0] * d, center[1] + dir[1] * d, center[2] + dir[2] * d);
  return makeCamera({ eye: e.toArray(), target: center, fov });
}

function drawTriangles(canvas, cam, tris, ox = 0, oy = 0, W = canvas.w, H = canvas.h) {
  const V = (arr) => new THREE.Vector3(arr[0], arr[1], arr[2]);
  for (const t of tris) {
    const pa = project(cam, V(t.a), W, H);
    const pb = project(cam, V(t.b), W, H);
    const pc = project(cam, V(t.c), W, H);
    if (!pa || !pb || !pc) continue;
    const ax = pa.sx + ox, ay = pa.sy + oy, bx = pb.sx + ox, by = pb.sy + oy, cx = pc.sx + ox, cy = pc.sy + oy;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(canvas.w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(canvas.h - 1, Math.ceil(Math.max(ay, by, cy)));
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-9) continue;
    const inv = 1 / area;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        // Poids barycentriques : lc (poids de C), lb (poids de B), la (poids de A).
        // (La version précédente associait pa à lb : z-buffer faux, des
        //  triangles lointains écrasaient les proches.)
        const lc = ((bx - ax) * (py - ay) - (px - ax) * (by - ay)) * inv;
        const lb = ((px - ax) * (cy - ay) - (cx - ax) * (py - ay)) * inv;
        const la = 1 - lb - lc;
        if (la < 0 || lb < 0 || lc < 0) continue;
        const z = pa.z * la + pb.z * lb + pc.z * lc;
        canvas.put(x, y, z, t.cr, t.cg, t.cb);
      }
    }
  }
}

function drawLine(canvas, cam, p1, p2, W, H, ox, oy, rgb = [255, 220, 90], thick = 2) {
  const a = project(cam, new THREE.Vector3(...p1), W, H);
  const b = project(cam, new THREE.Vector3(...p2), W, H);
  if (!a || !b) return;
  const steps = Math.ceil(Math.hypot(b.sx - a.sx, b.sy - a.sy) * 1.5) + 1;
  for (let i = 0; i <= steps; i++) {
    const tt = i / steps;
    const x = Math.round(a.sx + ox + (b.sx - a.sx) * tt);
    const y = Math.round(a.sy + oy + (b.sy - a.sy) * tt);
    for (let dx = -thick; dx <= thick; dx++) for (let dy = -thick; dy <= thick; dy++) {
      if (dx * dx + dy * dy > thick * thick) continue;
      canvas.blend(x + dx, y + dy, rgb[0], rgb[1], rgb[2], 0.95);
    }
  }
}

function drawText(canvas, x, y, text, rgb = [230, 240, 255], scale = 2) {
  // police 5x7 minimale (chiffres + majuscules utiles)
  const FONT = {
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    B: ['11110', '10001', '11110', '10001', '10001', '10001', '11110'],
    C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
    D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    E: ['11111', '10000', '11110', '10000', '10000', '10000', '11111'],
    F: ['11111', '10000', '11110', '10000', '10000', '10000', '10000'],
    G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
    H: ['10001', '10001', '11111', '10001', '10001', '10001', '10001'],
    I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
    K: ['10001', '10010', '11100', '10100', '10010', '10001', '10001'],
    L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    M: ['10001', '11011', '10101', '10001', '10001', '10001', '10001'],
    N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
    X: ['10001', '01010', '00100', '00100', '00100', '01010', '10001'],
    Y: ['10001', '01010', '00100', '00100', '00100', '00100', '00100'],
    Z: ['11111', '00010', '00100', '00100', '01000', '10000', '11111'],
    '0': ['01110', '10011', '10101', '10101', '11001', '10001', '01110'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
    '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
    '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
    ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
    '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
    ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  };
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch] || FONT[' '];
    for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) {
      if (glyph[gy][gx] !== '1') continue;
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        const px = cx + gx * scale + sx, py = y + gy * scale + sy;
        if (px < canvas.w && py < canvas.h) {
          const i = (py * canvas.w + px) * 4;
          canvas.color[i] = rgb[0]; canvas.color[i + 1] = rgb[1]; canvas.color[i + 2] = rgb[2];
        }
      }
    }
    cx += 6 * scale;
  }
}

function drawGroundGrid(canvas, cam, ox, oy, W, H, size = 3) {
  const y = 0.001;
  for (let i = -size; i <= size; i++) {
    drawLine(canvas, cam, [-8, y, i], [8, y, i], W, H, ox, oy, [70, 82, 96], 0);
    drawLine(canvas, cam, [i, y, -8], [i, y, 8], W, H, ox, oy, [70, 82, 96], 0);
  }
}

// ------------------------------- Chargement --------------------------------
const loader = new GLTFLoader();
const MODELS_DIR = path.join(ROOT, 'web/assets/models');
const loadCache = new Map();
async function loadModel(file) {
  if (loadCache.has(file)) return loadCache.get(file);
  const buf = await fs.readFile(path.join(MODELS_DIR, file));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej));
  loadCache.set(file, gltf);
  return gltf;
}

// ------------------------------ Vues / rendu -------------------------------
function viewSide(target, dist, height) { return makeCamera({ eye: [dist, height, 0.001], target, fov: 30 }); }
function viewFront(target, dist, height) { return makeCamera({ eye: [0.001, height, dist], target, fov: 30 }); }
function viewQuarter(target, dist, height) { return makeCamera({ eye: [dist * 0.8, height, dist * 0.8], target, fov: 32 }); }
function viewTop(target, dist) { return makeCamera({ eye: [0.001, dist, 0.001], target, up: [0, 0, 1], fov: 30 }); }

/** Trace le cercle théorique de chaque roue : si la roue déborde, elle est ovale. */
function drawWheelCheck(canvas, cam, built, ox, oy, W, H) {
  const radius = built.wheelRadius;
  for (const w of built.wheels) {
    const world = new THREE.Vector3();
    w.getWorldPosition(world);
    // axe de rotation = axe local le plus fin de la géométrie de la roue
    const bbox = new THREE.Box3().setFromObject(w);
    const size = bbox.getSize(new THREE.Vector3());
    const thin = size.x <= size.y && size.x <= size.z ? 0 : (size.y <= size.z ? 1 : 2);
    const axis = new THREE.Vector3(thin === 0 ? 1 : 0, thin === 1 ? 1 : 0, thin === 2 ? 1 : 0);
    const u = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 0, 1)).normalize();
    if (u.lengthSq() < 0.1) u.set(0, 1, 0);
    const v = new THREE.Vector3().crossVectors(axis, u).normalize();
    let prev = null;
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const p = world.clone().addScaledVector(u, Math.cos(a) * radius).addScaledVector(v, Math.sin(a) * radius);
      if (prev) drawLine(canvas, cam, prev.toArray(), p.toArray(), W, H, ox, oy, [80, 255, 140], 0);
      prev = p;
    }
  }
}

async function renderSingleWheel() {
  const { default: Assets } = await import(pathToFileURL(path.join(ROOT, 'web/src/assets.js')).href);
  await Assets.init();
  const built = Assets.makeVehicle('Berline');
  let wheel = null;
  built.group.traverse((o) => { if (o.isMesh && /wheel-front-right/.test(o.name)) wheel = o; });
  const canvas = new Canvas(900, 900);
  // on isole la roue : nouveau groupe à l'origine
  const holder = new THREE.Group();
  const w2 = wheel.clone(true);
  wheel.parent.add(new THREE.Object3D()); // no-op
  const wm = new THREE.Matrix4();
  wheel.updateMatrixWorld(true);
  w2.matrix.copy(wheel.matrixWorld); w2.matrix.decompose(w2.position, w2.quaternion, w2.scale);
  holder.add(w2);
  holder.updateMatrixWorld(true);
  const { tris, bbox } = collectTriangles(holder);
  console.log('roue seule :', tris.length, 'triangles, bbox', bbox.size.map(v => v.toFixed(3)).join(' x '));
  const cam = framedCamera(bbox.center, bbox.radius, [1, 0.001, 0.02], 30, 1.05);
  drawGroundGrid(canvas, cam, 0, 0, 900, 900, 3);
  drawTriangles(canvas, cam, tris, 0, 0, 900, 900);
  // cercle de référence du rayon mesuré
  const r = built.wheelRadius;
  const c = bbox.center;
  let prev = null;
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const p2 = [c[0], c[1] + Math.cos(a) * r, c[2] + Math.sin(a) * r];
    if (prev) drawLine(canvas, cam, prev, p2, 900, 900, 0, 0, [80, 255, 140], 1);
    prev = p2;
  }
  drawText(canvas, 14, 14, `R MESURE ${r.toFixed(2)}`, [150, 255, 170], 3);
  await fs.mkdir(path.join(ROOT, 'previews'), { recursive: true });
  await fs.writeFile(path.join(ROOT, 'previews/debug_single_wheel.png'), canvas.toPNG());
  console.log('previews/debug_single_wheel.png');
}

async function renderDebug() {
  const { default: Assets } = await import(pathToFileURL(path.join(ROOT, 'web/src/assets.js')).href);
  await Assets.init();
  const built = Assets.makeVehicle('Berline');
  const only = process.argv[3] || 'all';
  const canvas = new Canvas(1200, 500);
  const g = new THREE.Group(); g.add(built.group);
  const keep = [];
  g.traverse((o) => { if (o.isMesh) keep.push(o); });
  if (only === 'body') keep.forEach((o) => { o.visible = !/wheel/i.test(o.name); });
  if (only === 'wheel') keep.forEach((o) => { o.visible = /wheel/i.test(o.name); });
  const { tris, bbox } = collectTriangles(g);
  const cam = framedCamera(bbox.center, bbox.radius, [1, 0.16, 0.02], 30);
  drawGroundGrid(canvas, cam, 0, 0, 1200, 500, 3);
  drawTriangles(canvas, cam, tris, 0, 0, 1200, 500);
  await fs.mkdir(path.join(ROOT, 'previews'), { recursive: true });
  await fs.writeFile(path.join(ROOT, `previews/debug_${only}.png`), canvas.toPNG());
  console.log(`previews/debug_${only}.png — ${tris.length} triangles`);
}

async function renderCars() {
  const { default: Assets } = await import(pathToFileURL(path.join(ROOT, 'web/src/assets.js')).href);
  await Assets.init();
  const types = ['Citadine', 'Berline', 'SUV', 'Sportive', 'Taxi', 'Utilitaire', 'Police', 'Moto'];
  const CW = 340, CH = 250, cols = 4, rows = Math.ceil(types.length / cols) * 2;
  const canvas = new Canvas(CW * cols, CH * rows);
  let idx = 0;
  for (const type of types) {
    const col = idx % cols, row = Math.floor(idx / cols);
    const ox = col * CW, oy = row * CH * 2;
    const built = Assets.makeVehicle(type);
    if (!built) { idx++; continue; }
    const g = new THREE.Group();
    g.add(built.group);
    const { tris, bbox } = collectTriangles(g);
    // profil (on juge la circularité des roues ici)
    const camSide = framedCamera(bbox.center, bbox.radius, [1, 0.16, 0.02], 30);
    drawGroundGrid(canvas, camSide, ox, oy, CW, CH, 3);
    drawTriangles(canvas, camSide, tris, ox, oy, CW, CH);
    drawWheelCheck(canvas, camSide, built, ox, oy, CW, CH);
    const wr = built.wheelRadius;
    drawText(canvas, ox + 8, oy + 8, `${type} R${wr.toFixed(2)}M`, [255, 255, 255], 2);
    // face
    const camFront = framedCamera(bbox.center, bbox.radius, [0.02, 0.22, 1], 30);
    drawGroundGrid(canvas, camFront, ox, oy + CH, CW, CH, 2);
    drawTriangles(canvas, camFront, tris, ox, oy + CH, CW, CH);
    drawText(canvas, ox + 8, oy + CH + 8, `${type} FACE`, [255, 255, 255], 2);
    idx++;
  }
  await fs.mkdir(path.join(ROOT, 'previews'), { recursive: true });
  await fs.writeFile(path.join(ROOT, 'previews/cars.png'), canvas.toPNG());
  console.log('previews/cars.png');
}

async function renderChars() {
  const { default: Assets } = await import(pathToFileURL(path.join(ROOT, 'web/src/assets.js')).href);
  await Assets.init();
  const CW = 240, CH = 320;
  const phases = [0, Math.PI / 3, (2 * Math.PI) / 3, Math.PI, (4 * Math.PI) / 3, (5 * Math.PI) / 3];
  const rows = [
    { label: 'WALK 1.4', speed: 1.4 },
    { label: 'RUN 6.0', speed: 6.0 },
  ];
  const canvas = new Canvas(CW * phases.length, CH * rows.length);
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < phases.length; c++) {
      const rig = Assets.makeCitizen(0);
      const ox = c * CW, oy = r * CH;
      const root = new THREE.Group();
      root.add(rig.group);
      root.updateMatrixWorld(true);
      rig.group.position.y = Assets.animateRig(rig, rows[r].speed, 1 / 60, phases[c], 1 / 60);
      root.updateMatrixWorld(true);
      const { tris } = collectTriangles(root);
      const camera = makeCamera({ eye: [4.2, 1.05, 0.35], target: [0, 0.95, 0], fov: 30 });
      drawGroundGrid(canvas, camera, ox, oy, CW, CH, 2);
      drawTriangles(canvas, camera, tris, ox, oy, CW, CH);
      // squelette par-dessus (jambes/bras) pour juger la pose
      const wp = (b) => { const v = new THREE.Vector3(); b.getWorldPosition(v); return [v.x, v.y, v.z]; };
      const bones = rig.bones || {};
      const limbs = [
        ['hips', 'upperlegl'], ['upperlegl', 'lowerlegl'], ['lowerlegl', 'footl'],
        ['hips', 'upperlegr'], ['upperlegr', 'lowerlegr'], ['lowerlegr', 'footr'],
        ['chest', 'upperarml'], ['upperarml', 'lowerarml'], ['lowerarml', 'handl'],
        ['chest', 'upperarmr'], ['upperarmr', 'lowerarmr'], ['lowerarmr', 'handr'],
        ['hips', 'chest'], ['chest', 'neck'], ['neck', 'head'],
      ];
      for (const [a, b] of limbs) {
        if (!bones[a] || !bones[b]) continue;
        drawLine(canvas, camera, wp(bones[a]), wp(bones[b]), CW, CH, ox, oy, [255, 200, 80], 1);
      }
      drawText(canvas, ox + 6, oy + 6, rows[r].label, [150, 240, 255], 2);
      if (r === 0) drawText(canvas, ox + 6, oy + 22, `PH ${(phases[c] / Math.PI).toFixed(1)}`, [180, 190, 210], 1);
    }
  }
  await fs.mkdir(path.join(ROOT, 'previews'), { recursive: true });
  await fs.writeFile(path.join(ROOT, 'previews/chars.png'), canvas.toPNG());
  console.log('previews/chars.png');
}

/** Une seule pose en grand (profil), pour juger la silhouette. */
async function renderCharSolo() {
  const { default: Assets } = await import(pathToFileURL(path.join(ROOT, 'web/src/assets.js')).href);
  await Assets.init();
  const mode = process.argv[3] || 'run';
  const view = process.argv[5] || 'side';
  const phase = parseFloat(process.argv[4] || '0.9');
  const speed = mode === 'run' ? 6 : mode === 'walk' ? 1.4 : 0;
  let rig;
  if (process.env.RAW_GLB) {
    // diagnostic : rendu du GLB tel quel, sans clonage ni animation
    const { GLTFLoader } = await import(pathToFileURL(path.join(ROOT, 'web/node_modules/three/examples/jsm/loaders/GLTFLoader.js')).href);
    const fsNode = await import('node:fs');
    const buf = fsNode.readFileSync(path.join(ROOT, 'web/assets/models/char_Casual.glb'));
    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
    rig = { group: gltf.scene, bones: {} };
  } else {
    rig = Assets.makeCitizen(0);
  }
  const root = new THREE.Group(); root.add(rig.group);
  if (view === 'side') rig.group.rotation.y = Math.PI / 2;
  root.updateMatrixWorld(true);
  if (!process.env.RAW_GLB) rig.group.position.y = Assets.animateRig(rig, speed, 1 / 60, phase, 1 / 60);
  root.updateMatrixWorld(true);
  const { tris, bbox } = collectTriangles(root);
  console.log('bbox', bbox.min.map((v) => v.toFixed(2)).join(','), bbox.max.map((v) => v.toFixed(2)).join(','), 'tris', tris.length);
  const W = 460, H = 720;
  const canvas = new Canvas(W, H);
  const camera = makeCamera({ eye: [0, 0.95, 4.2], target: [0, 0.95, 0], fov: 30 });
  drawGroundGrid(canvas, camera, 0, 0, W, H, 2);
  drawTriangles(canvas, camera, tris, 0, 0, W, H);
  const wp = (b) => { const v = new THREE.Vector3(); b.getWorldPosition(v); return [v.x, v.y, v.z]; };
  const bones = rig.bones || {};
  for (const [a, b] of [['hips','upperlegl'],['upperlegl','lowerlegl'],['lowerlegl','footl'],
    ['hips','upperlegr'],['upperlegr','lowerlegr'],['lowerlegr','footr'],
    ['chest','upperarml'],['upperarml','lowerarml'],['lowerarml','handl'],
    ['chest','upperarmr'],['upperarmr','lowerarmr'],['lowerarmr','handr'],['hips','chest'],['neck','head']]) {
    if (!bones[a] || !bones[b]) continue;
    drawLine(canvas, camera, wp(bones[a]), wp(bones[b]), 0, 0, W, H, [255, 200, 80], 1);
  }
  drawText(canvas, 8, 8, `${mode.toUpperCase()} v=${speed}`, [150, 240, 255], 2);
  await fs.mkdir(path.join(ROOT, 'previews'), { recursive: true });
  const out = path.join(ROOT, `previews/char_${mode}.png`);
  await fs.writeFile(out, canvas.toPNG());
  console.log('previews/' + path.basename(out));
}

export { collectTriangles, makeCamera, drawTriangles, Canvas };

if (process.env.PREVIEW_IMPORT_ONLY) { /* pas d'exécution */ }
else {
const what = process.argv[2] || 'all';
if (what === 'char1') await renderCharSolo();
if (what === 'wheel1') await renderSingleWheel();
if (what === 'debug') await renderDebug();
if (what === 'cars' || what === 'all') await renderCars();
if (what === 'chars' || what === 'all') await renderChars();
}
