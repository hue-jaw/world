// ============================================================================
// METROPOLIS — city.js
// Génération procédurale du quartier + RoadNetwork + graphe piéton + feux.
// Équivalent UE5 : World Partition + PCG (Procedural Content Generation)
// + Splines routières exportées en DataAsset de navigation.
// ============================================================================
import * as THREE from 'three';
import { CFG, rand, randRange, randInt, pick, chance, districtForBlock, DISTRICTS, clamp, mulberry32 } from './core.js';
import { StreetGrid, STREET_CLASSES, hash2 } from './streets.js';
import { facade as facadeHD, asphaltHD, sidewalkHD, grassHD, metroGroundHD, groundDetailHD } from './textures.js';

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
export const RING = 2048;   // demi-côté de l'anneau autoroutier
const RING_W = 30, RADIAL_W = 26;
const CIRCUIT = { x: 2400, z: 2400, r: 168, w: 22 };
// Canal : coupure Est-Ouest de la trame, avec un pont à chaque rue transversale.
// Il casse la symétrie de la grille et sert de repère d'orientation.
const CANAL = { x: -1120, w: 44, half: 22, quay: 22.6 };

// Rues piétonnes : liste des lignes « passage » (aucune circulation automobile).
let _passages = null;
function passageLines(streets) {
  if (_passages) return _passages;
  _passages = { h: [], v: [] };
  for (let k = 0; k <= 128; k++) {
    if (streets.horizontal(k).klass === 'passage') _passages.h.push(k);
    if (streets.vertical(k).klass === 'passage') _passages.v.push(k);
  }
  return _passages;
}

// ------------------------- Textures procédurales ----------------------------
// Façades HAUTE DÉFINITION : 1024² (512² pour les petits bâtiments), albédo
// jour + émissive nuit + carte de relief, générées une fois puis partagées.
const windowMaterials = [];   // matériaux dont l'émissif est piloté jour/nuit

/**
 * @param {string} palette  palette de façade (core.js)
 * @param {number} height   hauteur de l'immeuble (m) -> étage/bande
 * @param {number} variant  0..1, DOIT être déterministe (dérivé de x/z) :
 *                          utiliser rand() ici décalerait toute la génération
 *                          de la ville et casserait la reproductibilité de
 *                          la seed. 2 variantes suffisent (budget mémoire).
 */
const facadeMatCache = new Map();
const CHUNK_MATERIALS = new Map();
let roofMatShared = null;
/** Matériau de toiture partagé par tous les bâtiments (1 seul programme). */
function getRoofMaterial() {
  if (!roofMatShared) {
    roofMatShared = new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 1 });
  }
  return roofMatShared;
}
function facadeMaterial(palette, height, variant = 0) {
  // granularité verticale : ~3 m par étage quel que soit l'immeuble
  const band = height < 10 ? 'low' : height < 30 ? 'mid' : height < 55 ? 'high' : 'tower';
  const v = Math.abs(Math.round(variant)) % 2;
  // MUTUALISATION : deux immeubles de même palette/bande/variante partagent
  // le même matériau (donc la même texture, le même programme compilé).
  // Avant : 62 matériaux identiques = 62 textures de 1024² en VRAM + 62
  // compilations de shader. Après : un seul par combinaison.
  const key = `${palette}:${band}:${v}`;
  const hit = facadeMatCache.get(key);
  if (hit) return hit;
  const { day, night, bump } = facadeHD(palette, band, v);
  const m = new THREE.MeshStandardMaterial({
    map: day, emissiveMap: night, bumpMap: bump, bumpScale: 0.18,
    emissive: 0xffffff, emissiveIntensity: 0,
    roughness: 0.80, metalness: 0.05, envMapIntensity: 0.7,
  });
  windowMaterials.push(m);
  facadeMatCache.set(key, m);
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


// ---------------------------------------------------------------------------
//        DÉTAIL DE SOL : multiplicateur à l'échelle métrique (shader)
// ---------------------------------------------------------------------------
/**
 * Ajoute une texture de détail tuilée tous les 4 m, appliquée en
 * MULTIPLICATEUR sur la couleur du sol. C'est ce qui donne du grain à 1 m du
 * sol sans avoir besoin d'une texture de 32 000² pour couvrir 8 km.
 *
 * On ne dépend pas de `vUv` du modèle (chaque mesh a son propre mapping) :
 * les coordonnées sont reconstruites depuis la position MONDE, donc le grain
 * garde exactement la même échelle partout et ne glisse pas d'un mesh à
 * l'autre. Aucun coût CPU : tout est fait sur le GPU.
 */
function addGroundDetail(material, detailTex, { tileMeters = 4, gain = 0.5 } = {}) {
  if (!detailTex) return material;
  const t = detailTex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 1);
  t.needsUpdate = true;
  material.userData.detailTex = t;
  material.userData.detailTile = tileMeters;
  material.userData.detailGain = gain;
  // Sans clé de cache programmatique dédiée, three.js peut réutiliser le
  // programme compilé d'un matériau SANS le hook (même état) : le détail
  // disparaîtrait alors au hasard selon l'ordre de compilation.
  // COMPOSITION DES HOOKS : setTextureRepeat() a pu poser son propre
  // onBeforeCompile et sa clé de cache. Il faut les CHAÎNER, sinon le dernier
  // appelé écrase le précédent et la répétition UV disparaît silencieusement.
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${prevKey ? prevKey() : 'm'}|groundDetail`;
  const prevHook = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prevHook) prevHook(shader, renderer);
    shader.uniforms.uDetail = { value: t };
    shader.uniforms.uDetailTile = { value: tileMeters };
    shader.uniforms.uDetailGain = { value: gain };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPosD;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldPosD = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;\nuniform float uDetailTile;\nuniform float uDetailGain;\nvarying vec3 vWorldPosD;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec2 duv = vWorldPosD.xz / uDetailTile;
          float det = texture2D(uDetail, duv).r;
          diffuseColor.rgb *= 1.0 + (det - 1.0) * uDetailGain;
        }`);
  };
  material.needsUpdate = true;
  return material;
}


/**
 * Applique une répétition UV à un matériau SANS cloner sa texture.
 *
 * Cloner une 1024² coûte 5 Mo de RAM par clone : sur 138 bâtiments, cela fait
 * 130 Mo de textures pour... une seule image. On change donc l'offset UV dans
 * le shader (uniforme par matériau), la texture restant partagée.
 * NB : les UV des faces sont déjà mis à l'échelle dans la géométrie ; ce
 * facteur ne fait que régler le raccord sur les faces non ajustées.
 */
function setTextureRepeat(material, repeat) {
  material.userData.uvRepeat = repeat;
  const prev = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${prev ? prev() : 'm'}|rep${repeat}`;
  const prevHook = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prevHook) prevHook(shader, renderer);
    shader.uniforms.uUvRepeat = { value: repeat };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uUvRepeat;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv *= uUvRepeat;\n#endif');
  };
  material.needsUpdate = true;
  return material;
}


/**
 * Façade triplanaire pour les bâtiments INSTANCIÉS des chunks lointains.
 *
 * Problème corrigé : les chunks de la métropole étaient rendus en
 * `MeshStandardMaterial({ color: 0xffffff })` — de simples boîtes blanches.
 * En s'éloignant du spawn, le joueur ne voyait donc plus aucune façade, ce qui
 * se lit comme « les textures ne se chargent pas ».
 *
 * Pourquoi un mapping triplanaire : un InstancedMesh ne peut pas porter des UV
 * différentes par instance. On projette donc la texture depuis la position
 * MONDE, en choisissant le plan (XY / ZY / XZ) selon la normale. Les fenêtres
 * gardent ainsi exactement la même échelle sur tous les bâtiments, quelle que
 * soit leur taille — ce qui est aussi le comportement correct.
 *
 * Coût : quelques instructions par fragment, une seule texture par matériau.
 */
function makeFacadeInstancedMaterial(palette, band, opts = {}) {
  const { day, bump } = facadeHD(palette, band, opts.variant || 0);
  const mat = new THREE.MeshStandardMaterial({
    map: day,
    bumpMap: bump,
    bumpScale: 0.12,
    roughness: 0.85,
    metalness: 0.04,
    envMapIntensity: 0.55,
  });
  // Échelle : une tuile de façade ≈ 16 m de large et R étages de ~3 m
  const TILE_W = opts.tileMeters || 16;
  const TILE_H = opts.tileHeight || 19.2;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTileW = { value: TILE_W };
    shader.uniforms.uTileH = { value: TILE_H };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTriPos;
        varying vec3 vTriNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          // position MONDE de l'instance (instancing supporté)
          #ifdef USE_INSTANCING
            vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
            vec3 wn = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          #else
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vec3 wn = normalize(mat3(modelMatrix) * normal);
          #endif
          vTriPos = wp.xyz;
          vTriNormal = wn;
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTileW;
        uniform float uTileH;
        varying vec3 vTriPos;
        varying vec3 vTriNormal;
        // projection triplanaire simple (une seule texture)
        vec2 triplanarUV(vec3 p, vec3 n) {
          vec3 an = abs(n);
          if (an.y >= an.x && an.y >= an.z) return vec2(p.x, p.z);
          if (an.x >= an.z) return vec2(p.z, p.y);
          return vec2(p.x, p.y);
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec2 tuv = triplanarUV(vTriPos, vTriNormal);
          tuv = vec2(tuv.x / uTileW, tuv.y / uTileH);
          vec4 texel = texture2D(map, tuv);
          // les toits (normale verticale) restent sombres : pas de fenêtres
          float isRoof = smoothstep(0.55, 0.85, abs(vTriNormal.y));
          vec3 wallCol = texel.rgb;
          diffuseColor.rgb = mix(wallCol, vec3(0.24, 0.255, 0.275), isRoof);
        }`);
  };
  mat.customProgramCacheKey = () => `facadeTri:${palette}:${band}:${opts.variant || 0}`;
  return mat;
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
    const asphalt = asphaltHD();
    asphalt.map.repeat.set(34, 34); asphalt.bump.repeat.set(34, 34);
    // partagé avec les autoroutes et le circuit (clones + repeat différent)
    this.asphaltTex = asphalt;
    this.groundMat = addGroundDetail(new THREE.MeshStandardMaterial({
      map: asphalt.map, bumpMap: asphalt.bump, bumpScale: 0.12, roughness: 0.94, metalness: 0.02,
    }), groundDetailHD('asphalt'), { gain: 0.55 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), this.groundMat);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; s.add(ground);
    // herbe lointaine autour de la ville
    const grassTex = grassHD();
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000),
      addGroundDetail(new THREE.MeshStandardMaterial({
        map: grassTex.map, bumpMap: grassTex.bump, bumpScale: 0.25, roughness: 1,
      }), groundDetailHD('grass'), { gain: 0.35 }));
    grass.rotation.x = -Math.PI / 2; grass.position.y = -0.08; s.add(grass);

    // --- plateformes de blocs (trottoirs) instanciées ---
    const walk = sidewalkHD();
    const platGeo = new THREE.BoxGeometry(PLAT, 0.3, PLAT);
    const platMat = addGroundDetail(setTextureRepeat(new THREE.MeshStandardMaterial({
      map: walk.map, bumpMap: walk.bump, bumpScale: 0.10, roughness: 0.88, metalness: 0.03,
    }), 22), groundDetailHD('walk'), { gain: 0.42 });
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
    // Quartiers SECONDARIES fixes : ils cassent les anneaux concentriques.
    // Un quartier d'affaires décentré, un quartier industriel au bord du canal
    // (à l'ouest), une vieille ville au sud-est, un quartier étudiant au nord.
    const poles = [
      { i: 4.5, j: 1.5, r: 1.2, type: 'downtown' },
      { i: 1.5, j: 4.5, r: 1.15, type: 'industrial' },
      { i: 5.2, j: 5.0, r: 1.05, type: 'oldtown' },
      { i: 2.0, j: 2.2, r: 1.1, type: 'commercial' },
    ];
    this.districtMap = [];
    for (let i = 0; i < N; i++) {
      this.districtMap[i] = [];
      for (let j = 0; j < N; j++) {
        let type = special.get(i + ',' + j) || districtForBlock(i, j, N);
        // bruit déterministe : 22 % des blocs changent de nature
        const h = hash2(i, j, 101);
        if (!special.has(i + ',' + j)) {
          if (h % 100 < 22) type = ['residential', 'commercial', 'oldtown', 'industrial', 'suburb'][(h >>> 7) % 5];
          else if (h % 100 >= 96) type = 'microPark';     // placette de quartier
        }
        // aimantation aux pôles secondaires (distance euclidienne, pas un anneau)
        for (const pole of poles) {
          const d = Math.hypot(i - pole.i, j - pole.j);
          if (d < pole.r) { type = pole.type; break; }
        }
        this.districtMap[i][j] = type;
        const cx = blockCenter(i), cz = blockCenter(j);
        if (type === 'park' || type === 'microPark') this.buildPark(cx, cz);
        else if (type === 'gas') this.buildGasStation(cx, cz);
        else this.buildBlock(cx, cz, DISTRICTS[type] ? type : 'residential');
      }
    }

    // la grille viaire doit exister AVANT le mobilier (nom + sens uniques)
    this.buildStreetGrid();
    this.buildStreetFurniture();
    this.finalizeTrees();
    this.buildRoadMarkings();
    this.buildStreetLights();
    this.buildTrafficLights();
    this.buildRoadGraph();
    this.buildPedGraph();
    // les trottoirs du canal sont sous l'eau : on les retire des destinations
    this.pedNodesDry = this.pedNodes.filter((n) => Math.abs(n.x - CANAL.x) > 32);
    this.buildCanal();
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
    // Tuile HAUTE DÉFINITION de 64 m (un bloc) : 2048², soit 32 px/m.
    // L'ancienne version était en 256² (4 px/m) — c'était la principale
    // cause de l'aspect "flou/moche" des sols vus de près.
    const tex = metroGroundHD().map;
    const size = 8600, rep = size / P;
    tex.repeat.set(rep, rep);
    // aligner les routes sur la grille du cœur (routes à -224 + k·64)
    const off = ((size / 2 - 224) / P) - Math.round((size / 2 - 224) / P);
    tex.offset.set(-off, -off);
    this.metroGroundMat = addGroundDetail(new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.92, metalness: 0.02, color: 0xffffff,
    }), groundDetailHD('asphalt'), { gain: 0.6 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.metroGroundMat);
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03;
    ground.receiveShadow = true; ground.matrixAutoUpdate = false; ground.updateMatrix();
    this.scene.add(ground);
    // herbe au-delà de la métropole
    const gTex = grassHD();
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000),
      addGroundDetail(new THREE.MeshStandardMaterial({
        map: gTex.map, bumpMap: gTex.bump, bumpScale: 0.25, roughness: 1,
      }), groundDetailHD('grass'), { gain: 0.35 }));
    grass.rotation.x = -Math.PI / 2; grass.position.y = -0.12;
    grass.matrixAutoUpdate = false; grass.updateMatrix(); this.scene.add(grass);
  }

  // ======================= MOBILIER VIAIRE (v0.5) ==========================
  /**
   * Marque au sol un sens unique : flèche blanche peinte dans la voie.
   * Une seule texture, un seul InstancedMesh pour toutes les flèches.
   */
  _oneWayArrowTexture() {
    if (this._arrowTex) return this._arrowTex;
    const c = document.createElement('canvas'); c.width = 128; c.height = 256;
    const g = c.getContext('2d');
    if (g) {
      g.clearRect(0, 0, 128, 256);
      g.fillStyle = 'rgba(232,232,225,0.92)';
      // hampe
      g.fillRect(52, 96, 24, 130);
      // pointe
      g.beginPath(); g.moveTo(64, 24); g.lineTo(112, 104); g.lineTo(16, 104); g.closePath(); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    this._arrowTex = t;
    return t;
  }

  /**
   * Mobilier de voirie : flèches de sens unique, terre-pleins des avenues,
   * mini-giratoires, bollards des rues piétonnes. Tout est instancié.
   */
  buildStreetFurniture() {
    const S = this.streets;
    if (!S) return;
    const rng = mulberry32(0x5EED1);   // RNG local : le mobilier ne décale pas le monde
    const group = new THREE.Group();
    const dummy = new THREE.Object3D();

    // ---------- 1. flèches de sens unique (marquage au sol) ----------------
    const arrowMat = new THREE.MeshBasicMaterial({
      map: this._oneWayArrowTexture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, toneMapped: false,
      side: THREE.DoubleSide, opacity: 0.95,
    });
    const arrowGeo = new THREE.PlaneGeometry(3.2, 6.4);
    arrowGeo.rotateX(-Math.PI / 2);
    const arrows = [];
    const SPACING = 96;
    for (let k = 0; k <= 128; k++) {
      const h = S.horizontal(k), v = S.vertical(k);
      const z = -WORLD_HALF + (k - CORE_I) * P;
      const x = -WORLD_HALF + (k - CORE_I) * P;
      if (h.oneWay) {
        for (let a = -3200; a <= 3200; a += SPACING) {
          if (h.oneWay > 0) arrows.push({ x: a, z: z + 3.4, rot: -Math.PI / 2 });
          else arrows.push({ x: a, z: z - 3.4, rot: Math.PI / 2 });
        }
      }
      if (v.oneWay) {
        for (let a = -3200; a <= 3200; a += SPACING) {
          if (v.oneWay > 0) arrows.push({ x: x - 3.4, z: a, rot: Math.PI });
          else arrows.push({ x: x + 3.4, z: a, rot: 0 });
        }
      }
    }
    const arrowMesh = new THREE.InstancedMesh(arrowGeo, arrowMat, Math.min(arrows.length, 900));
    let n = 0;
    for (const a of arrows) {
      if (n >= 900) break;
      dummy.position.set(a.x, 0.16, a.z);
      dummy.rotation.set(0, a.rot, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      arrowMesh.setMatrixAt(n++, dummy.matrix);
    }
    arrowMesh.count = n;
    arrowMesh.instanceMatrix.needsUpdate = true;
    arrowMesh.frustumCulled = false;
    group.add(arrowMesh);

    // ---------- 2. terre-pleins des avenues / boulevards -------------------
    const medianMat = new THREE.MeshStandardMaterial({ color: 0x6f7a63, roughness: 0.95 });
    const medianGeo = new THREE.BoxGeometry(46, 0.16, 1.15);
    const medians = [];
    const NEAR = 1400;
    for (let k = 0; k <= 128; k++) {
      const coords = -WORLD_HALF + (k - CORE_I) * P;
      if (Math.abs(coords) > NEAR) continue;
      const h = S.horizontal(k), v = S.vertical(k);
      for (let q = 0; q <= 128; q++) {
        const c2 = -WORLD_HALF + (q - CORE_I) * P;
        if (Math.abs(c2) > NEAR) continue;
        // le terre-plein occupe l'intervalle ENTRE deux carrefours
        if (h.klass === 'avenue' || h.klass === 'boulevard') medians.push({ x: c2 + P / 2, z: coords, rot: 0 });
        if (v.klass === 'avenue' || v.klass === 'boulevard') medians.push({ x: coords, z: c2 + P / 2, rot: Math.PI / 2 });
      }
    }
    const medianMesh = new THREE.InstancedMesh(medianGeo, medianMat, medians.length);
    medians.forEach((m, i) => {
      dummy.position.set(m.x, 0.09, m.z);
      dummy.rotation.set(0, m.rot, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      medianMesh.setMatrixAt(i, dummy.matrix);
      this.addCollider(m.x, m.z, m.rot ? 1.15 : 46, m.rot ? 46 : 1.15, 0.2);
    });
    medianMesh.instanceMatrix.needsUpdate = true;
    medianMesh.receiveShadow = true;
    group.add(medianMesh);
    this.medianCount = medians.length;

    // arbres d'alignement sur les avenues (demandés avant finalizeTrees)
    for (let k = 0; k <= 128; k++) {
      const coords = -WORLD_HALF + (k - CORE_I) * P;
      if (Math.abs(coords) > NEAR) continue;
      const h = S.horizontal(k), v = S.vertical(k);
      const onCrossing = (a) => {
        const f = ((a + WORLD_HALF) % P + P) % P;
        return f < 13 || f > P - 13;
      };
      if (h.klass === 'avenue') {
        for (let a = -900; a <= 900; a += 34) {
          if (onCrossing(a)) continue;
          this.plantTree(a, coords, 0.85 + rng() * 0.35, false);
        }
      }
      if (v.klass === 'avenue') {
        for (let a = -900; a <= 900; a += 34) {
          if (onCrossing(a)) continue;
          this.plantTree(coords, a, 0.85 + rng() * 0.35, false);
        }
      }
    }

    // ---------- 3. mini-giratoires (peints, sans feu) ----------------------
    const islandGeo = new THREE.CylinderGeometry(2.2, 2.4, 0.18, 20);
    const islandMat = new THREE.MeshStandardMaterial({ color: 0x4d6b45, roughness: 0.95 });
    const ringGeo = new THREE.RingGeometry(6.2, 6.8, 28);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xe6e6de, transparent: true, opacity: 0.85, depthWrite: false });
    const spots = [];
    for (let i = 0; i <= 128; i += 18) {
      for (let j = 0; j <= 128; j += 18) {
        const x = -WORLD_HALF + (i - CORE_I) * P;
        const z = -WORLD_HALF + (j - CORE_I) * P;
        if (Math.abs(x) < 340 && Math.abs(z) < 340) continue;   // pas dans le cœur (feux)
        if (Math.abs(x) > 2800 || Math.abs(z) > 2800) continue;
        if (Math.abs(x - CANAL.x) < 60) continue;
        spots.push({ x, z });
      }
    }
    const islands = new THREE.InstancedMesh(islandGeo, islandMat, spots.length);
    const rings = new THREE.InstancedMesh(ringGeo, ringMat, spots.length);
    spots.forEach((sp, i) => {
      dummy.position.set(sp.x, 0.16, sp.z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1);
      dummy.updateMatrix(); islands.setMatrixAt(i, dummy.matrix);
      dummy.position.y = 0.155; dummy.updateMatrix(); rings.setMatrixAt(i, dummy.matrix);
      this.addCollider(sp.x, sp.z, 4.0, 4.0, 0.18);
    });
    islands.instanceMatrix.needsUpdate = true; rings.instanceMatrix.needsUpdate = true;
    group.add(islands, rings);
    this.roundabouts = spots;
    this.roundaboutKeys = new Set(spots.map((sp) => `${Math.round((sp.x + WORLD_HALF) / P) + CORE_I},${Math.round((sp.z + WORLD_HALF) / P) + CORE_I}`));

    // ---------- 4. rues piétonnes : bollards -------------------------------
    const bollardGeo = new THREE.CylinderGeometry(0.16, 0.2, 1.0, 8);
    const bollardMat = new THREE.MeshStandardMaterial({ color: 0x2f343b, metalness: 0.5, roughness: 0.5 });
    const bol = [];
    const pl = passageLines(S);
    for (const k of pl.v) {
      const x = -WORLD_HALF + (k - CORE_I) * P;
      for (let z = -1500; z <= 1500; z += 64) {
        for (const off of [-5.2, 5.2]) bol.push({ x: x + off, z });
      }
    }
    for (const k of pl.h) {
      const z = -WORLD_HALF + (k - CORE_I) * P;
      for (let x = -1500; x <= 1500; x += 64) {
        for (const off of [-5.2, 5.2]) bol.push({ x, z: z + off });
      }
    }
    if (bol.length) {
      const bm = new THREE.InstancedMesh(bollardGeo, bollardMat, bol.length);
      bol.forEach((b, i) => {
        dummy.position.set(b.x, 0.5, b.z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1);
        dummy.updateMatrix(); bm.setMatrixAt(i, dummy.matrix);
      });
      bm.instanceMatrix.needsUpdate = true;
      group.add(bm);
    }
    this.pedestrianStreets = { v: pl.v.map((k) => ({ k, x: -WORLD_HALF + (k - CORE_I) * P })), h: pl.h.map((k) => ({ k, z: -WORLD_HALF + (k - CORE_I) * P })) };

    group.traverse((o) => { if (o.isMesh || o.isInstancedMesh) { o.matrixAutoUpdate = false; o.updateMatrix(); } });
    this.scene.add(group);
  }

  // ============================== CANAL ====================================
  /**
   * Canal Nord-Sud + un pont par rue transversale.
   *
   * Pourquoi un canal : c'est le seul accident géographique qui casse
   * réellement la lecture « grille parfaite » d'une métropole procédurale.
   * Il donne un repère d'orientation (« je suis rive gauche ») et des points
   * de passage obligés.
   *
   * L'eau est posée juste au-dessus du sol de la métropole (y = 0,012) afin
   * de ne pas avoir à découper le plan de sol : les routes qui la traversent
   * disparaissent visuellement sous l'eau, et les ponts les remplacent.
   */
  buildCanal() {
    const group = new THREE.Group();
    const LEN = 8600;
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x14384d, roughness: 0.09, metalness: 0.55,
      envMapIntensity: 1.8, transparent: false,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(CANAL.w, LEN), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(CANAL.x, 0.02, 0);
    water.receiveShadow = false;
    group.add(water);
    this.waterMaterial = waterMat;

    // quais (pierre) : segments entre les ponts
    const quayMat = new THREE.MeshStandardMaterial({ color: 0x8c8f92, roughness: 0.85, metalness: 0.04 });
    const quayGeo = new THREE.BoxGeometry(1.2, 0.55, P - 18);
    const quays = [];
    for (let k = 0; k <= 128; k++) {
      const z = -WORLD_HALF + (k - CORE_I) * P;
      // le quai occupe le milieu de l'intervalle entre deux ponts
      for (const side of [-1, 1]) quays.push({ x: CANAL.x + side * CANAL.quay, z: z + P / 2 });
    }
    const quayMesh = new THREE.InstancedMesh(quayGeo, quayMat, quays.length);
    const dummy = new THREE.Object3D();
    quays.forEach((q, i) => {
      dummy.position.set(q.x, 0.26, q.z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1);
      dummy.updateMatrix(); quayMesh.setMatrixAt(i, dummy.matrix);
      this.addCollider(q.x, q.z, 1.2, P - 18, 0.55);
    });
    quayMesh.instanceMatrix.needsUpdate = true;
    quayMesh.castShadow = true; quayMesh.receiveShadow = true;
    group.add(quayMesh);

    // ponts : un par rue Est-Ouest
    const deckMat = new THREE.MeshStandardMaterial({
      map: this.asphaltTex?.map || null, color: 0x9aa0a8, roughness: 0.82, metalness: 0.06,
    });
    const deckGeo = new THREE.BoxGeometry(52, 0.16, 18);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x8e959c, metalness: 0.7, roughness: 0.45 });
    const railGeo = new THREE.BoxGeometry(52, 0.8, 0.2);
    const decks = [];
    for (let k = 0; k <= 128; k++) decks.push(-WORLD_HALF + (k - CORE_I) * P);
    const deckMesh = new THREE.InstancedMesh(deckGeo, deckMat, decks.length);
    const railMesh = new THREE.InstancedMesh(railGeo, railMat, decks.length * 2);
    let rn = 0;
    decks.forEach((z, i) => {
      dummy.position.set(CANAL.x, 0.10, z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1);
      dummy.updateMatrix(); deckMesh.setMatrixAt(i, dummy.matrix);
      for (const side of [-1, 1]) {
        dummy.position.set(CANAL.x, 0.52, z + side * 8.9);
        dummy.updateMatrix(); railMesh.setMatrixAt(rn++, dummy.matrix);
        this.addCollider(CANAL.x, z + side * 8.9, 52, 0.4, 0.9);
      }
    });
    deckMesh.instanceMatrix.needsUpdate = true;
    railMesh.instanceMatrix.needsUpdate = true;
    deckMesh.receiveShadow = true; railMesh.castShadow = true;
    group.add(deckMesh, railMesh);
    this.bridges = decks.map((z) => ({ x: CANAL.x, z }));
    this.canal = { ...CANAL, length: LEN };
    this.canalX = CANAL.x;
    group.traverse((o) => { if (o.isMesh || o.isInstancedMesh) { o.updateMatrix(); } });
    this.scene.add(group);
  }

  /** Autoroute en anneau (2×2 km) + 4 avenues radiales + glissières + lampadaires. */
  buildHighways() {
    const group = new THREE.Group();
    // MÊME tuile d'asphalte que la ville (repeat ajusté par matériau via
    // clone) : une seule génération, une seule texture en mémoire.
    const asphalt = addGroundDetail(setTextureRepeat(new THREE.MeshStandardMaterial({
      map: this.asphaltTex.map, bumpMap: this.asphaltTex.bump,
      bumpScale: 0.12, color: 0x9aa0a8, roughness: 0.85, metalness: 0.05,
    }), 120), groundDetailHD('asphalt'), { gain: 0.55 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, roughness: 0.45, metalness: 0.7 });
    const laneMat = new THREE.MeshStandardMaterial({ color: 0xe8e2c0, roughness: 0.8, emissive: 0x222018, emissiveIntensity: 0.15 });
    const span = RING * 2;
    for (const [sx, sz, len, rot] of [[0, -RING, span, 0], [0, RING, span, 0], [-RING, 0, span, Math.PI / 2], [RING, 0, span, Math.PI / 2]]) {
      const road = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, RING_W), asphalt);
      road.position.set(sx, 0.03, sz); road.rotation.y = rot; group.add(road);
      const dash = new THREE.Mesh(new THREE.BoxGeometry(len, 0.02, 0.32), laneMat);
      dash.position.set(sx, 0.10, sz); dash.rotation.y = rot; group.add(dash);
    }
    // Glissières SEGMENTÉES : une ouverture à chaque rue transversale, sinon
    // l'anneau serait une autoroute clôturée sans entrée ni sortie.
    const segLen = P - 18;
    const rails = [];
    for (const [sx, sz, rot] of [[0, -RING, 0], [0, RING, 0], [-RING, 0, 1], [RING, 0, 1]]) {
      for (let a = -RING; a <= RING; a += P) {
        const c = a + P / 2;
        if (Math.abs(c) > RING - 8) continue;
        for (const side of [-1, 1]) {
          if (rot === 0) rails.push({ x: c, z: sz + side * (RING_W / 2 + 0.3), rot: 0 });
          else rails.push({ x: sx + side * (RING_W / 2 + 0.3), z: c, rot: Math.PI / 2 });
        }
      }
    }
    const railGeo = new THREE.BoxGeometry(segLen, 0.85, 0.22);
    const railMesh = new THREE.InstancedMesh(railGeo, railMat, rails.length);
    const rd = new THREE.Object3D();
    rails.forEach((r, i) => {
      rd.position.set(r.x, 0.5, r.z); rd.rotation.set(0, r.rot, 0);
      rd.updateMatrix(); railMesh.setMatrixAt(i, rd.matrix);
    });
    railMesh.instanceMatrix.needsUpdate = true;
    railMesh.castShadow = true;
    group.add(railMesh);
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
    const asphalt = addGroundDetail(setTextureRepeat(new THREE.MeshStandardMaterial({
      map: this.asphaltTex.map, bumpMap: this.asphaltTex.bump,
      bumpScale: 0.12, color: 0x9aa0a8, roughness: 0.8, metalness: 0.08,
    }), 90), groundDetailHD('asphalt'), { gain: 0.55 });
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
    // palettes de façade nommées (textures réelles, plus de boîtes blanches)
    const palettes = ['office', 'plaster', 'brick', 'shop', 'oldbrick', 'warehouse'];
    for (let bi = ci * CHUNK; bi < (ci + 1) * CHUNK; bi++) {
      for (let bj = cj * CHUNK; bj < (cj + 1) * CHUNK; bj++) {
        if (bi < 0 || bj < 0 || bi >= MN || bj >= MN) continue;
        if (bi >= CORE_I && bi <= CORE_I + N - 1 && bj >= CORE_I && bj <= CORE_I + N - 1) continue; // cœur
        const cx = metroX(bi + 0.5), cz = metroX(bj + 0.5);
        // couloirs réservés (radiales, anneau, circuit)
        if (Math.abs(cx) < RADIAL_W / 2 + 10 || Math.abs(cz) < RADIAL_W / 2 + 10) continue;
        if (Math.abs(Math.abs(cx) - RING) < RING_W / 2 + 12 || Math.abs(Math.abs(cz) - RING) < RING_W / 2 + 12) continue;
        if (Math.hypot(cx - CIRCUIT.x, cz - CIRCUIT.z) < CIRCUIT.r + 40) continue;
        if (Math.abs(cx - CANAL.x) < CANAL.half + 14) continue;   // canal + quais
        // ------------------------------------------------------------------
        // ASYMÉTRIE : chaque bloc tire son propre profil à partir d'un hachage
        // de ses coordonnées. Pas de tirage global : deux blocs voisins ne se
        // ressemblent plus, et l'ordre de génération ne change rien.
        // ------------------------------------------------------------------
        const h = hash2(bi, bj, 1337);
        const roll = (h % 1000) / 1000;
        // 6 % de terrains vagues, puis 1 à 4 bâtiments selon le tirage
        let count = roll < 0.06 ? 0 : roll < 0.30 ? 1 : roll < 0.62 ? 2 : roll < 0.88 ? 3 : 4;

        // densité : pôles secondaires (affaires au nord, industries au canal)
        const poleA = Math.exp(-(((cx - 1400) ** 2) + ((cz + 900) ** 2)) / (2 * 900 * 900));
        const poleB = Math.exp(-(((cx - CANAL.x) ** 2) + ((cz - 600) ** 2)) / (2 * 700 * 700));
        const dist = Math.hypot(cx, cz);
        let maxH = dist < 1200 ? 36 : dist < 2400 ? 24 : dist < 3400 ? 15 : 10;
        maxH *= 1 + poleA * 1.6;                       // quartier d'affaires
        if (poleB > 0.55 && roll < 0.5) count = Math.min(count, 2);   // zone portuaire basse

        const slots = [[-0.26, 0, 0.46, 0.9], [0.26, 0, 0.46, 0.9], [-0.26, 0.27, 0.44, 0.42], [0.26, 0.27, 0.44, 0.42]];
        // l'emplacement change aussi : parfois un seul gros volume au centre
        const solo = count === 1 && (h >>> 5) % 2 === 0;
        for (let k = 0; k < count; k++) {
          const [ox, oz, fw, fd] = solo ? [0, 0, 0.92, 0.92] : slots[k];
          const w = BZ * fw * randRange(0.72, 1), d = BZ * fd * randRange(0.72, 1);
          const tall = (h >>> (k * 3)) % 100 < 18;      // 18 % de tours isolées
          let hh = tall ? randRange(maxH * 0.8, maxH * 1.25) : randRange(maxH * 0.28, maxH * 0.8);
          const x = cx + ox * BZ, z = cz + oz * BZ;
          items.push({ x, z, w, d, h: hh, pal: palettes[(h >>> (k * 2 + 3)) % palettes.length] });
          this.addColliderLive(x, z, w, d, hh);
        }
      }
    }
    if (!items.length) return null;
    // --- un InstancedMesh PAR PALETTE, avec la vraie texture de façade -----
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const groups = new Map();
    for (const it of items) {
      if (!groups.has(it.pal)) groups.set(it.pal, []);
      groups.get(it.pal).push(it);
    }
    const out = new THREE.Group();
    const d = new THREE.Object3D(); const col = new THREE.Color();
    for (const [pal, list] of groups) {
      const mat = CHUNK_MATERIALS.get(pal) || (() => {
        const m = makeFacadeInstancedMaterial(pal, 'mid', { variant: pal.length % 2 });
        CHUNK_MATERIALS.set(pal, m);
        return m;
      })();
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => {
        d.position.set(it.x, it.h / 2, it.z); d.scale.set(it.w, it.h, it.d); d.rotation.set(0, 0, 0);
        d.updateMatrix(); mesh.setMatrixAt(i, d.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      // ombres : inutiles pour la silhouette lointaine, coût GPU évité
      mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.frustumCulled = true;
      out.add(mesh);
    }
    this.scene.add(out);
    return out;
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
    const roofMat = getRoofMaterial();
    const slots = count === 1 ? [[0, 0, 1, 1]]
      : count === 2 ? [[-0.26, 0, 0.46, 0.9], [0.26, 0, 0.46, 0.9]]
      : [[-0.26, -0.26, 0.44, 0.44], [0.26, -0.26, 0.44, 0.44], [-0.26, 0.26, 0.44, 0.44], [0.26, 0.26, 0.44, 0.44]].slice(0, count);
    for (const [ox, oz, fw, fd] of slots) {
      const w = BZ * fw * randRange(0.82, 1), d = BZ * fd * randRange(0.82, 1);
      const h = randRange(spec.minH, spec.maxH);
      const x = cx + ox * BZ, z = cz + oz * BZ;
      const palette = pick(spec.palettes);
      // variante déterministe : même bâtiment = même façade à chaque chargement
      const variant = (Math.abs(Math.round(x * 3 + z * 7)) >> 3);
      const side = facadeMaterial(palette, h, variant);
      const geo = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
      // UV adaptés à la façade : 1 tuile ≈ 16 m de large. Sans cela, une
      // texture unique est étirée sur tous les bâtiments et les fenêtres
      // deviennent larges et floues sur les immeubles larges.
      const TILE_W = 16;
      const uv = geo.attributes.uv;
      for (const grp of geo.groups) {
        // 0/1 = faces X (largeur = d), 4/5 = faces Z (largeur = w)
        const faceW = (grp.materialIndex === 0 || grp.materialIndex === 1) ? d : w;
        const scaleU = faceW / TILE_W;
        if (Math.abs(scaleU - 1) < 0.02) continue;
        for (let k = grp.start; k < grp.start + grp.count; k++) {
          const vi = geo.index.getX(k);
          uv.setX(vi, uv.getX(vi) * scaleU);
        }
      }
      uv.needsUpdate = true;
      const mesh = new THREE.Mesh(geo, [side, side, roofMat, roofMat, side, side]);
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
    const roofMat = getRoofMaterial();
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
  plantTree(x, z, scale, collide = true) { (this._trees ??= []).push({ x, z, scale, collide }); }
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
      if (t.collide !== false) this.addCollider(t.x, t.z, 0.7, 0.7);
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

  // --------------------------- Réseau viaire nommé -------------------------
  /**
   * Grille des rues : noms, classes et sens uniques. Construite après le
   * graphe routier car elle ne dépend que des indices de lignes.
   */
  buildStreetGrid() {
    this.streets = new StreetGrid(MN, WORLD_HALF, P);
  }

  /** Nom de rue le plus proche (HUD, missions, dialogues). */
  streetAt(x, z) { return this.streets ? this.streets.crossAt(x, z) : null; }

  /**
   * Peut-on circuler depuis ce nœud dans cette direction ?
   * @param {object} node nœud du graphe
   * @param {number} dirIdx 0=E, 1=O, 2=S, 3=N
   * @returns {boolean}
   */
  canDrive(node, dirIdx) {
    if (!node || !this.streets) return true;
    // le lit du canal a remplacé la rue : on ne roule pas sur l'eau
    if ((dirIdx === 2 || dirIdx === 3) && Math.abs(node.x - CANAL.x) < 1) return false;
    // d = 0 (+x) / 1 (-x) : on emprunte la voie Est-Ouest d'indice j
    if (dirIdx === 0 || dirIdx === 1) {
      const st = this.streets.horizontal(node.j);
      if (st.klass === 'passage') return false;
      if (st.oneWay === 0) return true;
      return dirIdx === 0 ? st.oneWay > 0 : st.oneWay < 0;
    }
    const st = this.streets.vertical(node.i);
    if (st.klass === 'passage') return false;
    if (st.oneWay === 0) return true;
    return dirIdx === 2 ? st.oneWay > 0 : st.oneWay < 0;
  }

  /** Renseigne la classe de la voie empruntée par un déplacement. */
  streetClassAt(x, z) {
    if (!this.streets) return 'rue';
    return this.streets.nearest(x, z).street.klass;
  }

  nextNode(node, dirIdx) {
    const d = DIRS[dirIdx];
    return this.nodeAt(node.i + d.x, node.j + d.z);
  }
  lanePoint(node, dirIdx, out) {
    const r = rightOf(DIRS[dirIdx]);
    // Sur un giratoire, la voie passe à 7 m du centre : la corde entre deux
    // points de ce cercle ne s'approche jamais à moins de ~4,9 m, donc les
    // voitures ne coupent pas l'îlot central.
    const isRb = this.roundaboutKeys?.has(`${node.i},${node.j}`);
    const off = isRb ? 7 : laneOffset;
    out.set(node.x + r.x * off, 0, node.z + r.z * off);
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
