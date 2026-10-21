// ============================================================================
// METROPOLIS — city.js
// Génération procédurale du quartier + RoadNetwork + graphe piéton + feux.
// Équivalent UE5 : World Partition + PCG (Procedural Content Generation)
// + Splines routières exportées en DataAsset de navigation.
// ============================================================================
import * as THREE from 'three';
import { CFG, rand, randRange, randInt, pick, chance, districtForBlock, DISTRICTS, clamp } from './core.js';

const { blocksPerSide: N, pitch: P, platformSize: PLAT, buildZone: BZ, laneOffset } = CFG.city;
export const WORLD_HALF = (N * P) / 2;                 // 224 m
export const ROAD_COORDS = Array.from({ length: N + 1 }, (_, k) => -WORLD_HALF + k * P);
export const DIRS = [ { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 } ]; // E,O,S,N
export const rightOf = (d) => ({ x: -d.z, z: d.x });     // perpendiculaire (voie de droite)

const blockCenter = (i) => (i - (N - 1) / 2) * P;

// ---- Métropole étendue (8,19 km) ----
// La grille du cœur (routes tous les 64 m, à partir de -224) est prolongée
// mathématiquement sur 128 blocs par axe. Seuls les blocs proches du joueur
// sont matérialisés (streaming), le reste vit sous forme de données.
const MN = CFG.city.metroBlocks;              // 128 blocs par axe
const CHUNK = CFG.city.chunkBlocks;           // 4 blocs par chunk
const CORE_I = 60;                            // indice métro de la 1re route du cœur
const METRO_MIN = -WORLD_HALF - CORE_I * P;   // -4064 m
const METRO_MAX = -WORLD_HALF + (MN - CORE_I) * P; // 4128 m
const blockX = (k) => -WORLD_HALF + k * P;    // route k (cœur : 0..7)
const metroX = (i) => -WORLD_HALF + (i - CORE_I) * P;
const nodeIndex = (x) => clamp(Math.round((x + WORLD_HALF) / P) + CORE_I, 0, MN);
// Autoroute en anneau + avenues radiales + circuit privé
const RING = 2048, RING_W = 30, RADIAL_W = 26;
const CIRCUIT = { x: 2400, z: 2400, r: 168, w: 22 };

// ------------------------- Textures procédurales ----------------------------
// Façades dessinées sur canvas : map jour + emissiveMap nuit alignées.
// Zéro asset externe, faible coût mémoire, fenêtres allumées la nuit.
const facadeCache = new Map();
const windowMaterials = [];   // matériaux dont l'émissif est piloté jour/nuit

function facadeTextures(palette, band) {
  const key = palette + ':' + band;
  if (facadeCache.has(key)) return facadeCache.get(key);
  const W = 256, H = 256;
  const day = document.createElement('canvas'); day.width = W; day.height = H;
  const night = document.createElement('canvas'); night.width = W; night.height = H;
  const d = day.getContext('2d'), n = night.getContext('2d');
  const pal = {
    glass:     { wall: '#3d546e', win: '#a8c6dd', litRate: 0.42 },
    office:    { wall: '#6b7280', win: '#2c3846', litRate: 0.30 },
    brick:     { wall: '#7a4636', win: '#2a3238', litRate: 0.38 },
    oldbrick:  { wall: '#5d4a41', win: '#232a2e', litRate: 0.26 },
    plaster:   { wall: '#b8a98e', win: '#33404c', litRate: 0.40 },
    shop:      { wall: '#8b93a1', win: '#2c3846', litRate: 0.45 },
    house:     { wall: '#a89a84', win: '#33404c', litRate: 0.5 },
    warehouse: { wall: '#767c85', win: '#39424c', litRate: 0.12 },
  }[palette] || { wall: '#777', win: '#333', litRate: 0.3 };

  d.fillStyle = pal.wall; d.fillRect(0, 0, W, H);
  // salissures / variation verticale
  for (let i = 0; i < 260; i++) {
    d.fillStyle = `rgba(${randInt(0, 40)},${randInt(0, 40)},${randInt(0, 40)},${randRange(0.03, 0.1)})`;
    d.fillRect(rand() * W, rand() * H, randRange(4, 26), randRange(3, 16));
  }
  n.fillStyle = '#000'; n.fillRect(0, 0, W, H);

  const rows = band === 'low' ? 3 : band === 'mid' ? 8 : 18;
  const cols = palette === 'warehouse' ? 4 : band === 'low' ? 4 : 8;
  const cw = W / cols, ch = H / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (palette === 'shop' && r === rows - 1) continue; // vitrine RDC traitée après
    const x = c * cw + cw * 0.22, y = r * ch + ch * 0.22, w = cw * 0.56, h = ch * 0.56;
    const shade = randRange(-14, 14);
    d.fillStyle = pal.win; d.globalAlpha = 0.92; d.fillRect(x, y, w, h); d.globalAlpha = 1;
    d.fillStyle = `rgba(255,255,255,${randRange(0.04, 0.16)})`; d.fillRect(x, y, w, h * 0.4);
    if (rand() < pal.litRate) {
      const warm = chance(0.78);
      n.fillStyle = warm ? `rgb(255,${195 + randInt(0, 40)},${110 + randInt(0, 40)})` : 'rgb(190,215,255)';
      n.globalAlpha = randRange(0.75, 1); n.fillRect(x, y, w, h); n.globalAlpha = 1;
    }
    void shade;
  }
  if (palette === 'shop') { // grande vitrine + enseigne au RDC
    const y = H - ch;
    d.fillStyle = '#1d2733'; d.fillRect(cw * 0.3, y + ch * 0.25, W - cw * 0.6, ch * 0.7);
    d.fillStyle = pick(['#e63946', '#f4a261', '#2a9d8f', '#e9c46a', '#4361ee']); d.fillRect(0, y - 7, W, 9);
    n.fillStyle = 'rgb(255,220,150)'; n.globalAlpha = 0.95; n.fillRect(cw * 0.3, y + ch * 0.25, W - cw * 0.6, ch * 0.7); n.globalAlpha = 1;
  }
  const mk = (cv) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const out = { map: mk(day), emissiveMap: mk(night) };
  facadeCache.set(key, out);
  return out;
}
function facadeMaterial(palette, height) {
  const band = height < 10 ? 'low' : height < 26 ? 'mid' : 'high';
  const { map, emissiveMap } = facadeTextures(palette, band);
  const m = new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.88, metalness: 0.04 });
  windowMaterials.push(m);
  return m;
}
function noiseTexture(base, spread = 14) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2600; i++) {
    const v = randInt(-spread, spread);
    g.fillStyle = `rgba(${128 + v},${128 + v},${128 + v},0.16)`;
    g.fillRect(rand() * 128, rand() * 128, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ================================ CITY ======================================
export class City {
  constructor(scene) {
    this.scene = scene;
    this.buildings = [];        // {x,z,w,d,h,district,kind,door:{x,z}}
    this.colliders = [];        // AABB {minX,maxX,minZ,maxZ}
    this.colliderGrid = new Map();
    this.nodes = [];            // road graph [i][j]
    this.pedNodes = [];         // {id,x,z,neighbors:[]}
    this.lampHeadMat = null; this.lampGlowMat = null;
    this.trafficLamps = { NS: [], EW: [] };
    this.lightPhase = 0;        // temps dans le cycle des feux
    this.parkAreas = [];
    this.build();
  }

  // ------------------------------ Construction -----------------------------
  build() {
    const s = this.scene;
    // --- sol / routes ---
    const asphaltTex = noiseTexture('#33373d'); asphaltTex.repeat.set(90, 90);
    this.groundMat = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.96, metalness: 0.02 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), this.groundMat);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; s.add(ground);
    // herbe lointaine autour de la ville
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshStandardMaterial({ color: 0x3d5c33, roughness: 1 }));
    grass.rotation.x = -Math.PI / 2; grass.position.y = -0.08; s.add(grass);

    // --- plateformes de blocs (trottoirs) instanciées ---
    const walkTex = noiseTexture('#8d9299', 10); walkTex.repeat.set(6, 6);
    const platGeo = new THREE.BoxGeometry(PLAT, 0.3, PLAT);
    const platMat = new THREE.MeshStandardMaterial({ map: walkTex, roughness: 0.95 });
    const plats = new THREE.InstancedMesh(platGeo, platMat, N * N);
    plats.receiveShadow = true;
    const dummy = new THREE.Object3D();
    let pi = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      dummy.position.set(blockCenter(i), 0, blockCenter(j)); dummy.updateMatrix();
      plats.setMatrixAt(pi++, dummy.matrix);
    }
    s.add(plats);

    // --- quartiers + blocs spéciaux ---
    const special = new Map([['2,4', 'park'], ['4,1', 'gas'], ['5,5', 'park']]);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const type = special.get(i + ',' + j) || districtForBlock(i, j, N);
      if (type === 'park') this.buildPark(blockCenter(i), blockCenter(j));
      else if (type === 'gas') this.buildGasStation(blockCenter(i), blockCenter(j));
      else this.buildBlock(blockCenter(i), blockCenter(j), type);
    }

    this.finalizeTrees();
    this.buildRoadMarkings();
    this.buildStreetLights();
    this.buildTrafficLights();
    this.buildRoadGraph();
    this.buildPedGraph();
    this.indexColliders();
    this.buildMetroGround();
    this.buildHighways();
    this.buildCircuit();
    this.chunks = new Map();
    this.focus = { x: 0, z: 0 };
    this._streamT = 0;
    this.updateStreaming(0, 0);
  }

  // ======================= MÉTROPOLE ÉTENDUE (streaming) ====================
  /** Sol de la métropole : une seule tuile de 64 m répétée (routes + trottoirs). */
  buildMetroGround() {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    const road = Math.round((18 / P) * 256);        // 18 m de voirie
    g.fillStyle = '#7f858c'; g.fillRect(0, 0, 256, 256);      // trottoirs/blocs
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2;
    for (let k = 32; k < 256; k += 32) { g.beginPath(); g.moveTo(0, k); g.lineTo(256, k); g.stroke(); g.beginPath(); g.moveTo(k, 0); g.lineTo(k, 256); g.stroke(); }
    g.fillStyle = '#34383e';
    g.fillRect(0, 0, 256, road / 2); g.fillRect(0, 256 - road / 2, 256, road / 2);
    g.fillRect(0, 0, road / 2, 256); g.fillRect(256 - road / 2, 0, road / 2, 256);
    // marquage central
    g.fillStyle = 'rgba(240,220,140,0.55)';
    for (let k = 8; k < 256; k += 34) { g.fillRect(128 - 1, k, 2, 14); g.fillRect(k, 128 - 1, 14, 2); }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
    const size = 8600, rep = size / P;
    tex.repeat.set(rep, rep);
    // aligner les routes sur la grille du cœur (routes à -224 + k·64)
    const off = ((size / 2 - 224) / P) - Math.round((size / 2 - 224) / P);
    tex.offset.set(-off, -off);
    this.metroGroundMat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.92, metalness: 0.02, color: 0xdedede,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.metroGroundMat);
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03;
    ground.receiveShadow = true; ground.matrixAutoUpdate = false; ground.updateMatrix();
    this.scene.add(ground);
    // herbe au-delà de la métropole
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000),
      new THREE.MeshStandardMaterial({ color: 0x3f5b35, roughness: 1 }));
    grass.rotation.x = -Math.PI / 2; grass.position.y = -0.12;
    grass.matrixAutoUpdate = false; grass.updateMatrix(); this.scene.add(grass);
  }

  /** Autoroute en anneau (2×2 km) + 4 avenues radiales + glissières + lampadaires. */
  buildHighways() {
    const group = new THREE.Group();
    const asphalt = new THREE.MeshStandardMaterial({ color: 0x26292e, roughness: 0.72, metalness: 0.05 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, roughness: 0.45, metalness: 0.7 });
    const laneMat = new THREE.MeshStandardMaterial({ color: 0xe8e2c0, roughness: 0.8, emissive: 0x222018, emissiveIntensity: 0.15 });
    const span = RING * 2;
    for (const [sx, sz, len, rot] of [[0, -RING, span, 0], [0, RING, span, 0], [-RING, 0, span, Math.PI / 2], [RING, 0, span, Math.PI / 2]]) {
      const road = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, RING_W), asphalt);
      road.position.set(sx, 0.03, sz); road.rotation.y = rot; group.add(road);
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.85, 0.22), railMat);
        rail.position.set(sx + Math.cos(rot) * side * (RING_W / 2 + 0.3), 0.5, sz - Math.sin(rot) * side * (RING_W / 2 + 0.3));
        rail.rotation.y = rot; group.add(rail);
      }
      const dash = new THREE.Mesh(new THREE.BoxGeometry(len, 0.02, 0.32), laneMat);
      dash.position.set(sx, 0.10, sz); dash.rotation.y = rot; group.add(dash);
    }
    // avenues radiales (du cœur vers l'anneau)
    for (const [ax, az, rot] of [[0, 1, 0], [0, -1, 0], [1, 0, Math.PI / 2], [-1, 0, Math.PI / 2]]) {
      const len = RING - WORLD_HALF;
      const road = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, RADIAL_W), asphalt);
      road.position.set(ax * (WORLD_HALF + len / 2), 0.032, az * (WORLD_HALF + len / 2));
      road.rotation.y = rot; group.add(road);
    }
    // lampadaires d'autoroute (instanciés, éteints le jour)
    const lampCount = Math.floor((span * 4) / 46);
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.14, 9, 6);
    const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.6, roughness: 0.5 }), lampCount);
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshStandardMaterial({ color: 0x556, emissive: 0xffc27a, emissiveIntensity: 0 }), lampCount);
    const d = new THREE.Object3D();
    let n = 0;
    for (let k = 0; k < 4 && n < lampCount; k++) {
      const side = k < 2 ? 1 : -1, axis = k % 2;
      for (let a = -RING; a <= RING && n < lampCount; a += 46) {
        const x = axis === 0 ? a : side * (RING + 2);
        const z = axis === 0 ? side * (RING + 2) : a;
        d.position.set(x, 4.5, z); d.updateMatrix(); poles.setMatrixAt(n, d.matrix);
        d.position.y = 9.1; d.updateMatrix(); heads.setMatrixAt(n, d.matrix);
        n++;
      }
    }
    poles.count = heads.count = n;
    this.highwayLampMat = heads.material;
    this.highwayLamps = heads;
    group.add(poles, heads);
    group.traverse((o) => { o.matrixAutoUpdate = false; if (o.isMesh || o.isInstancedMesh) { o.updateMatrix(); } });
    this.scene.add(group);
  }

  /** Circuit privé : anneau asphalté + glissières + arche de départ. */
  buildCircuit() {
    const group = new THREE.Group();
    const asphalt = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.65, metalness: 0.08 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(CIRCUIT.r - CIRCUIT.w / 2, CIRCUIT.r + CIRCUIT.w / 2, 96, 1), asphalt);
    ring.rotation.x = -Math.PI / 2; ring.position.set(CIRCUIT.x, 0.04, CIRCUIT.z); ring.receiveShadow = true;
    group.add(ring);
    const curb = new THREE.Mesh(new THREE.RingGeometry(CIRCUIT.r + CIRCUIT.w / 2, CIRCUIT.r + CIRCUIT.w / 2 + 1.2, 96, 1),
      new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.8 }));
    curb.rotation.x = -Math.PI / 2; curb.position.set(CIRCUIT.x, 0.06, CIRCUIT.z); group.add(curb);
    const barrier = new THREE.Mesh(new THREE.TorusGeometry(CIRCUIT.r + CIRCUIT.w / 2 + 2.2, 0.5, 6, 96),
      new THREE.MeshStandardMaterial({ color: 0xc23b32, roughness: 0.6 }));
    barrier.rotation.x = Math.PI / 2; barrier.position.set(CIRCUIT.x, 0.55, CIRCUIT.z); group.add(barrier);
    const arch = new THREE.Mesh(new THREE.BoxGeometry(28, 1.2, 1), new THREE.MeshStandardMaterial({ color: 0xf0c419, emissive: 0x3a2c00, emissiveIntensity: 0.3 }));
    arch.position.set(CIRCUIT.x, 6.5, CIRCUIT.z + CIRCUIT.r); group.add(arch);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 6.5, 0.9), new THREE.MeshStandardMaterial({ color: 0x333 }));
      leg.position.set(CIRCUIT.x + s * 13, 3.2, CIRCUIT.z + CIRCUIT.r); group.add(leg);
    }
    group.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
    this.scene.add(group);
  }

  /** Génère (une fois) le contenu d'un chunk de métropole, sans le cœur détaillé. */
  genChunk(ci, cj) {
    const items = [];
    const palettes = [0x8d99a6, 0xa8917c, 0x7d8a94, 0x9aa3ad, 0x85796d, 0xb0b6bd];
    for (let bi = ci * CHUNK; bi < (ci + 1) * CHUNK; bi++) {
      for (let bj = cj * CHUNK; bj < (cj + 1) * CHUNK; bj++) {
        if (bi < 0 || bj < 0 || bi >= MN || bj >= MN) continue;
        if (bi >= CORE_I && bi <= CORE_I + N - 1 && bj >= CORE_I && bj <= CORE_I + N - 1) continue; // cœur
        const cx = metroX(bi + 0.5), cz = metroX(bj + 0.5);
        // couloirs réservés (radiales, anneau, circuit)
        if (Math.abs(cx) < RADIAL_W / 2 + 10 || Math.abs(cz) < RADIAL_W / 2 + 10) continue;
        if (Math.abs(Math.abs(cx) - RING) < RING_W / 2 + 12 || Math.abs(Math.abs(cz) - RING) < RING_W / 2 + 12) continue;
        if (Math.hypot(cx - CIRCUIT.x, cz - CIRCUIT.z) < CIRCUIT.r + 40) continue;
        const dist = Math.hypot(cx, cz);
        const maxH = dist < 1200 ? 36 : dist < 2400 ? 24 : dist < 3400 ? 15 : 10;
        const count = 2 + (rand() < 0.5 ? 1 : 0);
        const slots = [[-0.26, 0, 0.46, 0.9], [0.26, 0, 0.46, 0.9], [-0.26, 0.27, 0.44, 0.42], [0.26, 0.27, 0.44, 0.42]];
        for (let k = 0; k < count; k++) {
          const [ox, oz, fw, fd] = slots[k];
          const w = BZ * fw * randRange(0.8, 1), d = BZ * fd * randRange(0.8, 1);
          const h = randRange(maxH * 0.35, maxH);
          const x = cx + ox * BZ, z = cz + oz * BZ;
          items.push({ x, z, w, d, h, color: palettes[Math.floor(rand() * palettes.length)] });
          this.addColliderLive(x, z, w, d, h);
        }
      }
    }
    if (!items.length) return null;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.05 });
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    const d = new THREE.Object3D(); const col = new THREE.Color();
    items.forEach((it, i) => {
      d.position.set(it.x, it.h / 2, it.z); d.scale.set(it.w, it.h, it.d); d.rotation.set(0, 0, 0);
      d.updateMatrix(); mesh.setMatrixAt(i, d.matrix);
      mesh.setColorAt(i, col.setHex(it.color));
    });
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false; mesh.receiveShadow = false;
    this.scene.add(mesh);
    return mesh;
  }

  /** Ajoute un collider APRÈS l'indexation initiale (chunks streamés). */
  addColliderLive(x, z, w, d, h = 0) {
    const c = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h };
    this.colliders.push(c);
    const x0 = Math.floor(c.minX / P), x1 = Math.floor(c.maxX / P);
    const z0 = Math.floor(c.minZ / P), z1 = Math.floor(c.maxZ / P);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const k = gx + ',' + gz;
      if (!this.colliderGrid.has(k)) this.colliderGrid.set(k, []);
      this.colliderGrid.get(k).push(c);
    }
  }

  /** Matérialise les chunks autour du joueur, cache les lointains. */
  updateStreaming(px, pz) {
    this.focus.x = px; this.focus.z = pz;
    const bi = Math.floor((px + WORLD_HALF) / P) + CORE_I;
    const bj = Math.floor((pz + WORLD_HALF) / P) + CORE_I;
    const ci = Math.floor(bi / CHUNK), cj = Math.floor(bj / CHUNK);
    const R = CFG.city.viewChunks;
    for (let i = ci - R; i <= ci + R; i++) for (let j = cj - R; j <= cj + R; j++) {
      if (i < 0 || j < 0 || i * CHUNK >= MN || j * CHUNK >= MN) continue;
      const key = i + ',' + j;
      if (!this.chunks.has(key)) this.chunks.set(key, this.genChunk(i, j));
    }
    for (const [key, mesh] of this.chunks) {
      if (!mesh) continue;
      const [i, j] = key.split(',').map(Number);
      mesh.visible = Math.abs(i - ci) <= R + 1 && Math.abs(j - cj) <= R + 1;
    }
  }

  addCollider(x, z, w, d, h = 0) {
    this.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });
  }
  indexColliders() {
    for (const c of this.colliders) {
      const x0 = Math.floor(c.minX / P), x1 = Math.floor(c.maxX / P);
      const z0 = Math.floor(c.minZ / P), z1 = Math.floor(c.maxZ / P);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const k = x + ',' + z;
        if (!this.colliderGrid.has(k)) this.colliderGrid.set(k, []);
        this.colliderGrid.get(k).push(c);
      }
    }
  }
  // Repousse un cercle (x,z,r) hors des AABB. Retourne la position corrigée.
  collide(x, z, r, y = 0) {
    const list = this.colliderGrid.get(Math.floor(x / P) + ',' + Math.floor(z / P));
    if (list) for (const c of list) {
      if (c.h && y > 0.6 && c.h <= y + 0.6) continue;   // on marche sur le toit
      const nx = clamp(x, c.minX, c.maxX), nz = clamp(z, c.minZ, c.maxZ);
      let dx = x - nx, dz = z - nz; const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 < 1e-6) { // centre dedans : sortir par le plus petit axe
          const l = x - c.minX, rgt = c.maxX - x, t = z - c.minZ, b = c.maxZ - z;
          const m = Math.min(l, rgt, t, b);
          if (m === l) x = c.minX - r; else if (m === rgt) x = c.maxX + r;
          else if (m === t) z = c.minZ - r; else z = c.maxZ + r;
        } else { const d = Math.sqrt(d2); x = nx + (dx / d) * r; z = nz + (dz / d) * r; }
      }
    }
    const lim = METRO_MAX - 40;   // limites de la métropole
    return { x: clamp(x, METRO_MIN + 40, lim), z: clamp(z, METRO_MIN + 40, lim) };
  }
  isColliding(x, z, r) {
    const o = this.collide(x, z, r);
    return Math.abs(o.x - x) > 0.001 || Math.abs(o.z - z) > 0.001;
  }
  groundY(x, z, y = 0) { // hauteur trottoir, puis éventuel toit sous les pieds
    const lx = ((x % P) + P) % P, lz = ((z % P) + P) % P;
    const inX = lx > (P - PLAT) / 2 && lx < (P + PLAT) / 2;
    const inZ = lz > (P - PLAT) / 2 && lz < (P + PLAT) / 2;
    let ground = (inX && inZ && Math.abs(x) < WORLD_HALF + 4 && Math.abs(z) < WORLD_HALF + 4) ? 0.15 : 0;
    if (y > 0.6) {
      // Toits : on peut se déplacer au sommet d'un bâtiment (brief : monter
      // en haut des immeubles, surtout ceux achetés).
      const list = this.colliderGrid.get(Math.floor(x / P) + ',' + Math.floor(z / P));
      if (list) for (const c of list) {
        if (!c.h || c.h > y + 1.2) continue;
        if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
        if (c.h > ground) ground = c.h;
      }
    }
    return ground;
  }

  /** Point au sommet d'un bâtiment (accès toit / héliport). */
  roofPoint(b) { return { x: b.x, y: (b.h ?? 10) + 0.25, z: b.z }; }

  // ------------------------------ Bâtiments --------------------------------
  buildBlock(cx, cz, district) {
    const spec = DISTRICTS[district];
    const count = randInt(spec.buildings[0], spec.buildings[1]);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 1 });
    const slots = count === 1 ? [[0, 0, 1, 1]]
      : count === 2 ? [[-0.26, 0, 0.46, 0.9], [0.26, 0, 0.46, 0.9]]
      : [[-0.26, -0.26, 0.44, 0.44], [0.26, -0.26, 0.44, 0.44], [-0.26, 0.26, 0.44, 0.44], [0.26, 0.26, 0.44, 0.44]].slice(0, count);
    for (const [ox, oz, fw, fd] of slots) {
      const w = BZ * fw * randRange(0.82, 1), d = BZ * fd * randRange(0.82, 1);
      const h = randRange(spec.minH, spec.maxH);
      const x = cx + ox * BZ, z = cz + oz * BZ;
      const palette = pick(spec.palettes);
      const side = facadeMaterial(palette, h);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, roofMat, roofMat, side, side]);
      mesh.position.set(x, h / 2 + 0.15, z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      // statique : aucune mise à jour de matrice par frame (gain CPU)
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      this.scene.add(mesh);
      this.addCollider(x, z, w, d, h);
      // porte : face la plus proche d'une route
      const door = this.doorFor(x, z, w, d);
      const kind = district === 'downtown' || palette === 'office' || palette === 'glass' ? 'work'
        : palette === 'shop' ? 'shop' : 'home';
      this.buildings.push({ x, z, w, d, h, district, kind, door });
      // clim / détails toit sur les gros bâtiments
      if (h > 16 && chance(0.7)) {
        const ac = new THREE.Mesh(new THREE.BoxGeometry(w * 0.3, 1.2, d * 0.3),
          new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.9 }));
        ac.position.set(x + randRange(-w / 5, w / 5), h + 0.75, z + randRange(-d / 5, d / 5));
        ac.castShadow = true; ac.matrixAutoUpdate = false; ac.updateMatrix(); this.scene.add(ac);
      }
    }
    // arbres de trottoir du bloc
    this.plantTreesAround(cx, cz, district === 'suburb' || district === 'residential' ? 5 : 2);
  }
  doorFor(x, z, w, d) {
    // choisit le côté du bâtiment le plus proche du bord de plateforme
    const bx = blockCenter(Math.round(x / P + (N - 1) / 2));
    const bz = blockCenter(Math.round(z / P + (N - 1) / 2));
    const dx = x - bx, dz = z - bz;
    if (Math.abs(dx) > Math.abs(dz)) return { x: x + Math.sign(dx || 1) * (w / 2 + 1.2), z };
    return { x, z: z + Math.sign(dz || 1) * (d / 2 + 1.2) };
  }

  buildPark(cx, cz) {
    const lawn = new THREE.Mesh(new THREE.BoxGeometry(BZ + 4, 0.34, BZ + 4),
      new THREE.MeshStandardMaterial({ color: 0x4c7a3d, roughness: 1 }));
    lawn.position.set(cx, 0.02, cz); lawn.receiveShadow = true; this.scene.add(lawn);
    this.parkAreas.push({ x: cx, z: cz });
    this.buildings.push({ x: cx, z: cz, w: 4, d: 4, h: 0, district: 'park', kind: 'leisure', door: { x: cx, z: cz + PLAT / 2 - 2 } });
    for (let i = 0; i < 16; i++) this.plantTree(cx + randRange(-BZ / 2, BZ / 2), cz + randRange(-BZ / 2, BZ / 2), randRange(1.1, 1.8));
    // bancs
    const benchMat = new THREE.MeshStandardMaterial({ color: 0x6e4f2a, roughness: 0.9 });
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.6), benchMat);
      b.position.set(cx + randRange(-14, 14), 0.45, cz + randRange(-14, 14));
      b.rotation.y = rand() * Math.PI; b.castShadow = true; this.scene.add(b);
    }
  }

  buildGasStation(cx, cz) {
    const s = this.scene;
    const white = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.7 });
    const red = new THREE.MeshStandardMaterial({ color: 0xc22f2f, roughness: 0.6 });
    // auvent
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(22, 0.8, 14), white);
    canopy.position.set(cx, 5.2, cz - 4); canopy.castShadow = true; s.add(canopy);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(22.2, 0.5, 14.2), red);
    stripe.position.set(cx, 4.75, cz - 4); s.add(stripe);
    for (const [px, pz] of [[-9, -9], [9, -9], [-9, 1], [9, 1]]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.7, 5, 0.7), white);
      pil.position.set(cx + px, 2.6, cz + pz); pil.castShadow = true; s.add(pil);
      this.addCollider(cx + px, cz + pz, 0.9, 0.9);
    }
    // pompes
    for (const px of [-5, 0, 5]) {
      const pump = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.4, 0.6), red);
      pump.position.set(cx + px, 0.85, cz - 4); pump.castShadow = true; s.add(pump);
      this.addCollider(cx + px, cz - 4, 1, 0.9);
    }
    // boutique
    const shopH = 4.5;
    const side = facadeMaterial('shop', shopH);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 1 });
    const shop = new THREE.Mesh(new THREE.BoxGeometry(16, shopH, 8), [side, side, roofMat, roofMat, side, side]);
    shop.position.set(cx, shopH / 2 + 0.15, cz + 12); shop.castShadow = true; shop.receiveShadow = true; s.add(shop);
    this.addCollider(cx, cz + 12, 16, 8);
    this.buildings.push({ x: cx, z: cz + 12, w: 16, d: 8, h: shopH, district: 'commercial', kind: 'shop', door: { x: cx, z: cz + 6.5 } });
  }

  // ------------------------------- Végétation ------------------------------
  // Instancing : 2 draw calls pour tous les arbres (brief §21).
  plantTreesAround(cx, cz, count) {
    for (let i = 0; i < count; i++) {
      const side = randInt(0, 3), t = randRange(-0.85, 0.85), e = PLAT / 2 - 2.2;
      const x = cx + (side === 0 ? t * e : side === 1 ? t * e : side === 2 ? -e : e);
      const z = cz + (side === 0 ? -e : side === 1 ? e : t * e);
      this.plantTree(x, z, randRange(0.8, 1.3));
    }
  }
  plantTree(x, z, scale) { (this._trees ??= []).push({ x, z, scale }); }
  finalizeTrees() {
    const trees = this._trees || [];
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 2.2, 6);
    const leafGeo = new THREE.IcosahedronGeometry(1.7, 1);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5a4230, roughness: 1 }), trees.length);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ color: 0x3f7031, roughness: 1, flatShading: true }), trees.length);
    trunks.castShadow = leaves.castShadow = true;
    const dummy = new THREE.Object3D();
    trees.forEach((t, i) => {
      dummy.rotation.set(0, rand() * 6.28, 0);
      dummy.position.set(t.x, 1.1 * t.scale + 0.15, t.z); dummy.scale.setScalar(t.scale); dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.y = (2.2 + 1.4) * t.scale + 0.15; dummy.updateMatrix();
      leaves.setMatrixAt(i, dummy.matrix);
      this.addCollider(t.x, t.z, 0.7, 0.7);
    });
    this.scene.add(trunks, leaves);
    this._trees = [];
  }

  // --------------------------- Marquages routiers --------------------------
  buildRoadMarkings() {
    const dashGeo = new THREE.PlaneGeometry(2.6, 0.22);
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xd8d8d2 });
    const positions = [];
    for (const rc of ROAD_COORDS) {
      for (let a = -WORLD_HALF + 6; a < WORLD_HALF; a += 6.5) {
        // ne pas peindre dans les intersections
        if (ROAD_COORDS.some((c) => Math.abs(a - c) < 10)) continue;
        positions.push({ x: rc, z: a, rot: Math.PI / 2 });
        positions.push({ x: a, z: rc, rot: 0 });
      }
    }
    const dashes = new THREE.InstancedMesh(dashGeo, dashMat, positions.length);
    const dummy = new THREE.Object3D();
    positions.forEach((p, i) => {
      dummy.position.set(p.x, 0.03, p.z); dummy.rotation.set(-Math.PI / 2, 0, p.rot); dummy.updateMatrix();
      dashes.setMatrixAt(i, dummy.matrix);
    });
    this.scene.add(dashes);
    // passages piétons
    const zebraGeo = new THREE.PlaneGeometry(0.7, 2.6);
    const zebraMat = new THREE.MeshBasicMaterial({ color: 0xe8e8e4 });
    const zs = [];
    for (const ix of ROAD_COORDS) for (const iz of ROAD_COORDS) {
      for (const d of DIRS) {
        const cxp = ix + d.x * 11.5, czp = iz + d.z * 11.5;
        const r = rightOf(d);
        for (let k = -2; k <= 2; k++) zs.push({ x: cxp + r.x * k * 1.7, z: czp + r.z * k * 1.7, rot: d.x !== 0 ? 0 : Math.PI / 2 });
      }
    }
    const zebras = new THREE.InstancedMesh(zebraGeo, zebraMat, zs.length);
    zs.forEach((p, i) => {
      dummy.position.set(p.x, 0.035, p.z); dummy.rotation.set(-Math.PI / 2, 0, p.rot); dummy.updateMatrix();
      zebras.setMatrixAt(i, dummy.matrix);
    });
    this.scene.add(zebras);
  }

  // ----------------------------- Lampadaires -------------------------------
  buildStreetLights() {
    const spots = [];
    for (const rc of ROAD_COORDS) for (let a = -WORLD_HALF + 16; a <= WORLD_HALF - 8; a += 32) {
      spots.push({ x: rc + 10.4, z: a }); spots.push({ x: a + 16, z: rc - 10.4 });
    }
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 5.4, 6);
    const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x2e343c, roughness: 0.6, metalness: 0.5 }), spots.length);
    this.lampHeadMat = new THREE.MeshStandardMaterial({ color: 0x444a52, emissive: 0xffb45e, emissiveIntensity: 0 });
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 10, 8), this.lampHeadMat, spots.length);
    this.lampGlowMat = new THREE.MeshBasicMaterial({ color: 0xffa64d, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const glows = new THREE.InstancedMesh(new THREE.SphereGeometry(1.15, 10, 8), this.lampGlowMat, spots.length);
    const dummy = new THREE.Object3D();
    spots.forEach((p, i) => {
      dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1);
      dummy.position.set(p.x, 2.7, p.z); dummy.updateMatrix(); poles.setMatrixAt(i, dummy.matrix);
      dummy.position.y = 5.5; dummy.updateMatrix(); heads.setMatrixAt(i, dummy.matrix); glows.setMatrixAt(i, dummy.matrix);
    });
    poles.castShadow = true;
    this.scene.add(poles, heads, glows);
  }

  // --------------------------- Feux de circulation -------------------------
  buildTrafficLights() {
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x1d2126, roughness: 0.7 });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2e343c, roughness: 0.6, metalness: 0.5 });
    this.lampMats = {
      redOn: new THREE.MeshBasicMaterial({ color: 0xff2d2d }), redOff: new THREE.MeshBasicMaterial({ color: 0x4a1515 }),
      amberOn: new THREE.MeshBasicMaterial({ color: 0xffa726 }), amberOff: new THREE.MeshBasicMaterial({ color: 0x4a3410 }),
      greenOn: new THREE.MeshBasicMaterial({ color: 0x2dff6b }), greenOff: new THREE.MeshBasicMaterial({ color: 0x12451f }),
    };
    const lampGeo = new THREE.SphereGeometry(0.14, 8, 8);
    for (const ix of ROAD_COORDS) for (const iz of ROAD_COORDS) {
      for (const [axis, dx, dz] of [['NS', 10.6, 10.6], ['EW', -10.6, 10.6]]) {
        const g = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.4, 6), poleMat);
        pole.position.y = 1.7; g.add(pole);
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.05, 0.3), boxMat);
        box.position.y = 3.6; g.add(box);
        const lamps = {};
        [['red', 0.34], ['amber', 0], ['green', -0.34]].forEach(([name, oy]) => {
          const l = new THREE.Mesh(lampGeo, this.lampMats[name + 'Off']);
          l.position.set(0, 3.6 + oy, 0.17); g.add(l); lamps[name] = l;
        });
        g.position.set(ix + dx, 0.15, iz + dz);
        g.lookAt(ix, 0.15, iz);
        this.scene.add(g);
        this.trafficLamps[axis].push(lamps);
      }
    }
    this.setLightVisuals();
  }
  // Cycle : 15 s — NS vert 6s, orange 1.5s, EW vert 6s, orange 1.5s
  lightState(axis) {
    const t = this.lightPhase % 15;
    if (axis === 'NS') return t < 6 ? 'green' : t < 7.5 ? 'amber' : 'red';
    return t < 7.5 ? 'red' : t < 13.5 ? 'green' : 'amber';
  }
  setLightVisuals() {
    for (const axis of ['NS', 'EW']) {
      const st = this.lightState(axis);
      for (const l of this.trafficLamps[axis]) {
        l.red.material = this.lampMats[st === 'red' ? 'redOn' : 'redOff'];
        l.amber.material = this.lampMats[st === 'amber' ? 'amberOn' : 'amberOff'];
        l.green.material = this.lampMats[st === 'green' ? 'greenOn' : 'greenOff'];
      }
    }
  }
  update(dt, ctx) {
    this._streamT += dt;
    if (this._streamT > 0.4 && ctx?.playerPos) {
      this._streamT = 0;
      const p = ctx.playerPos();
      this.updateStreaming(p.x, p.z);
    }
    const before = Math.floor(this.lightPhase / 1.5);
    this.lightPhase += dt;
    if (Math.floor(this.lightPhase / 1.5) !== before) this.setLightVisuals();
  }

  // ------------------------------ Road graph -------------------------------
  // Graphe routier sur TOUTE la métropole (129 × 129 nœuds, 8,2 km).
  // Le cœur reste aux mêmes coordonnées : aucune régression de gameplay.
  buildRoadGraph() {
    for (let i = 0; i <= MN; i++) {
      this.nodes[i] = [];
      for (let j = 0; j <= MN; j++) this.nodes[i][j] = { i, j, x: metroX(i), z: metroX(j) };
    }
  }
  nodeAt(i, j) { return (i >= 0 && i <= MN && j >= 0 && j <= MN) ? this.nodes[i][j] : null; }
  nextNode(node, dirIdx) {
    const d = DIRS[dirIdx];
    return this.nodeAt(node.i + d.x, node.j + d.z);
  }
  lanePoint(node, dirIdx, out) {
    const r = rightOf(DIRS[dirIdx]);
    out.set(node.x + r.x * laneOffset, 0, node.z + r.z * laneOffset);
    return out;
  }
  randomNode() {
    // Trafic et missions : rester autour du joueur, jamais à 4 km.
    const f = this.focus || { x: 0, z: 0 };
    const i = clamp(nodeIndex(f.x) + randInt(-7, 7), 0, MN);
    const j = clamp(nodeIndex(f.z) + randInt(-7, 7), 0, MN);
    return this.nodes[i][j];
  }
  randomEdgeNode() {
    const f = this.focus || { x: 0, z: 0 };
    const a = rand() * Math.PI * 2, r = randRange(180, 320);
    const n = this.nearestNode(f.x + Math.sin(a) * r, f.z + Math.cos(a) * r);
    return n || this.nodes[CORE_I][CORE_I];
  }
  nearestNode(x, z) {
    return this.nodes[nodeIndex(x)][nodeIndex(z)];
  }

  // ------------------------------ Graphe piéton ---------------------------
  buildPedGraph() {
    const byKey = new Map();
    const add = (x, z) => {
      const k = x.toFixed(1) + ',' + z.toFixed(1);
      if (!byKey.has(k)) { const node = { id: this.pedNodes.length, x, z, neighbors: [] }; byKey.set(k, node); this.pedNodes.push(node); }
      return byKey.get(k);
    };
    const e = PLAT / 2 - 1.6;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const cx = blockCenter(i), cz = blockCenter(j);
      const corners = [add(cx - e, cz - e), add(cx + e, cz - e), add(cx + e, cz + e), add(cx - e, cz + e)];
      for (let c = 0; c < 4; c++) this.linkPed(corners[c], corners[(c + 1) % 4]);
    }
    // traversées : coins face à face à travers la route (~20 m, alignés)
    for (const a of this.pedNodes) for (const b of this.pedNodes) {
      if (a.id >= b.id) continue;
      const dx = Math.abs(a.x - b.x), dz = Math.abs(a.z - b.z);
      if ((dx < 0.2 && dz > 15 && dz < 27) || (dz < 0.2 && dx > 15 && dx < 27)) this.linkPed(a, b);
    }
  }
  linkPed(a, b) { if (!a.neighbors.includes(b.id)) { a.neighbors.push(b.id); b.neighbors.push(a.id); } }
  nearestPedNode(x, z) {
    let best = null, bd = 1e9;
    for (const nd of this.pedNodes) { const d = (nd.x - x) ** 2 + (nd.z - z) ** 2; if (d < bd) { bd = d; best = nd; } }
    return best;
  }
  pedPath(from, to) { // BFS — graphe petit (~200 nœuds)
    if (from === to) return [to];
    const prev = new Map([[from.id, null]]), queue = [from];
    while (queue.length) {
      const cur = queue.shift();
      for (const nid of cur.neighbors) if (!prev.has(nid)) {
        prev.set(nid, cur.id);
        if (nid === to.id) {
          const path = []; let c = to;
          while (c) { path.unshift(c); const p = prev.get(c.id); c = p === null ? null : this.pedNodes[p]; }
          return path;
        }
        queue.push(this.pedNodes[nid]);
      }
    }
    return [to];
  }

  // --------------------------- Pilotage jour/nuit -------------------------
  setNightFactor(f) { // 0 = jour, 1 = nuit
    for (const m of windowMaterials) m.emissiveIntensity = f * 1.15;
    if (this.lampHeadMat) this.lampHeadMat.emissiveIntensity = f * 2.4;
    if (this.lampGlowMat) this.lampGlowMat.opacity = f * 0.16;
    if (this.highwayLampMat) this.highwayLampMat.emissiveIntensity = f * 2.6;
  }

  randomBuilding(kind) {
    const list = kind ? this.buildings.filter((b) => b.kind === kind) : this.buildings;
    return list.length ? pick(list) : pick(this.buildings);
  }
}
