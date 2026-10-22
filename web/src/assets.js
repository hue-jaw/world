// ============================================================================
// METROPOLIS — assets.js
// Bibliothèque de modèles 3D (CC0) embarqués dans le bundle.
//
// Rôle : charger les GLB une seule fois, les NORMALISER (échelle au mètre,
// pieds au sol, avant vers +Z), et fournir des clones prêts à jouer :
//   - véhicules : roues indexées (avant/arrière) pour le braquage et le
//     roulement, carrosserie à l'échelle de la physique ;
//   - personnages : clones de squelettes complets + animation procédurale
//     (aucune animation n'est fournie par les packs CC0 utilisés).
//
// Principe de robustesse : si un modèle manque ou échoue, les systèmes
// retombent sur leurs primitives procédurales. Le jeu ne casse jamais.
// ============================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { VEHICLE_TYPES, clamp } from './core.js';
import { upgradeImportedTextures } from './textures.js';
import { MODELS } from './assets.generated.js';

const loader = new GLTFLoader();


// ---------------------------------------------------------------------------
//              VITRES TRANSPARENTES (découpe par couleur de palette)
// ---------------------------------------------------------------------------
/**
 * Les modèles Kenney n'ont qu'UN seul matériau (« colormap ») : la carrosserie
 * et les vitres partagent la même texture, distinguées uniquement par la
 * couleur des texels. Pour rendre les vitres réellement transparentes (et
 * laisser voir le conducteur), il faut donc :
 *   1) lire la couleur de la palette pour chaque triangle ;
 *   2) séparer l'index en deux : opaque / verre ;
 *   3) donner au verre un matériau transparent.
 *
 * La lecture de la texture se fait une seule fois par modèle, via un canvas
 * 2D hors écran. Si l'image n'est pas accessible (test headless, contexte
 * dégradé), on renvoie simplement `null` : la voiture reste opaque, sans
 * erreur ni régression.
 */
const _colorCache = new WeakMap();
function paletteSampler(mesh) {
  const tex = mesh?.material?.map;
  const img = tex?.image;
  if (!img || !img.width) return null;
  if (_colorCache.has(tex)) return _colorCache.get(tex);
  let sampler = null;
  try {
    const S = 128;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    if (!g || typeof g.getImageData !== 'function') return null;
    g.drawImage(img, 0, 0, S, S);
    const data = g.getImageData(0, 0, S, S).data;
    sampler = (u, v) => {
      const x = Math.min(S - 1, Math.max(0, Math.floor(u * S)));
      const y = Math.min(S - 1, Math.max(0, Math.floor((1 - v) * S)));
      const i = (y * S + x) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
  } catch { sampler = null; }
  _colorCache.set(tex, sampler);
  return sampler;
}

/** Un texel est-il du verre teinté (bleu/gris froid) ? */
export function isGlassColor(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  // bleu dominant, pas trop sombre, pas blanc pur (carrosserie claire)
  return b > r + 18 && b >= g - 6 && lum > 55 && lum < 232 && (max - min) > 16;
}

/**
 * Sépare la carrosserie (mesh unique) en un mesh opaque + un mesh de verre.
 * @returns {{body: THREE.Mesh, glass: THREE.Mesh|null}}
 */
export function splitGlass(bodyMesh) {
  const sample = paletteSampler(bodyMesh);
  if (!sample) return { body: bodyMesh, glass: null };
  const geo = bodyMesh.geometry;
  const uv = geo.attributes.uv;
  if (!uv) return { body: bodyMesh, glass: null };
  const idx = geo.index;
  const triCount = (idx ? idx.count : geo.attributes.position.count) / 3;

  // bbox pour n'accepter que la partie haute (une vitre est au-dessus du
  // bas de caisse ; cela évite de classer un pare-chocs bleu par erreur)
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const height = bb.max.y - bb.min.y;
  const yGlassMin = bb.min.y + height * 0.42;

  const opaque = [], glassTri = [];
  const get = (i) => (idx ? idx.getX(i) : i);
  for (let t = 0; t < triCount; t++) {
    const a = get(t * 3), b = get(t * 3 + 1), c = get(t * 3 + 2);
    const u = (uv.getX(a) + uv.getX(b) + uv.getX(c)) / 3;
    const v = (uv.getY(a) + uv.getY(b) + uv.getY(c)) / 3;
    const col = sample(u, v);
    const y = (geo.attributes.position.getY(a) + geo.attributes.position.getY(b) + geo.attributes.position.getY(c)) / 3;
    if (col && y >= yGlassMin && isGlassColor(col[0], col[1], col[2])) {
      glassTri.push(a, b, c);
    } else {
      opaque.push(a, b, c);
    }
  }
  // garde-fou : si la détection attrape trop ou trop peu, on ne casse rien
  const ratio = glassTri.length / 3 / Math.max(1, triCount);
  if (ratio < 0.01 || ratio > 0.45) return { body: bodyMesh, glass: null };

  const opaqueGeo = geo.clone();
  opaqueGeo.setIndex(opaque);
  const glassGeo = geo.clone();
  glassGeo.setIndex(glassTri);

  const body = new THREE.Mesh(opaqueGeo, bodyMesh.material);
  body.name = bodyMesh.name + '_opaque';
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9fc4dd,
    metalness: 0.15,
    roughness: 0.06,
    transparent: true,
    opacity: 0.34,
    envMapIntensity: 1.6,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.name = bodyMesh.name + '_glass';
  glass.renderOrder = 2;
  return { body, glass };
}

// --------------------------- Correspondances --------------------------------
const VEHICLE_MODEL = {
  Citadine: 'car_hatchback-sports.glb',
  Berline: 'car_sedan.glb',
  SUV: 'car_suv.glb',
  Sportive: 'car_sedan-sports.glb',
  Taxi: 'car_taxi.glb',
  Utilitaire: 'car_van.glb',
  Police: 'car_police.glb',
  Moto: 'car_moto.glb',
};

// Hauteur réelle visée (m) : les modèles Kenney sont trapus, on les étire
// en longueur et on les abaisse pour coller aux proportions de la physique.
const TARGET_HEIGHT = {
  Citadine: 1.44, Berline: 1.46, SUV: 1.74, Sportive: 1.26, Taxi: 1.5, Utilitaire: 2.24, Police: 1.48, Moto: 1.25,
};

const CITIZEN_MODELS = ['char_Casual.glb', 'char_Casual2.glb', 'char_Suit.glb', 'char_Worker.glb', 'char_Punk.glb'];
const PLAYER_MODEL = 'char_Worker.glb';
const PLAYER_HEIGHT = 1.8;

const AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// ------------------------------ Utilitaires ---------------------------------
function decodeBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function parseGLB(b64) {
  return new Promise((resolve, reject) => loader.parse(decodeBase64(b64), '', resolve, reject));
}

const boneKey = (name) => name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

function collectBones(root) {
  const map = {};
  root.traverse((o) => { if (o.isBone) map[boneKey(o.name)] = o; });
  return map;
}

/** Cherche l'axe/le signe de rotation locale qui déplace `tip` le plus loin vers +Z. */
function detectSwing(bone, tip, root) {
  if (!bone || !tip) return null;
  const rest = bone.quaternion.clone();
  root.updateMatrixWorld(true);
  const base = tip.getWorldPosition(new THREE.Vector3());
  let best = null;
  for (const axis of ['x', 'y', 'z']) {
    for (const sign of [1, -1]) {
      bone.quaternion.copy(rest).multiply(_q.setFromAxisAngle(AXES[axis], 0.5 * sign));
      root.updateMatrixWorld(true);
      const d = tip.getWorldPosition(_v).sub(base);
      const score = Math.abs(d.z) - Math.abs(d.x) * 1.5 - Math.abs(d.y) * 0.6;
      if (!best || score > best.score) best = { axis, sign, score, dz: d.z };
    }
  }
  bone.quaternion.copy(rest);
  root.updateMatrixWorld(true);
  if (!best || Math.abs(best.dz) < 0.01) return null;
  return { axis: best.axis, sign: best.dz > 0 ? best.sign : -best.sign };
}

/** Cherche l'axe qui plie le genou vers l'arrière (angle positif = flexion). */
function detectKnee(lowerLeg, foot, root) {
  if (!lowerLeg || !foot) return null;
  const rest = lowerLeg.quaternion.clone();
  root.updateMatrixWorld(true);
  const base = foot.getWorldPosition(new THREE.Vector3());
  let best = null;
  for (const axis of ['x', 'y', 'z']) {
    for (const sign of [1, -1]) {
      lowerLeg.quaternion.copy(rest).multiply(_q.setFromAxisAngle(AXES[axis], 0.6 * sign));
      root.updateMatrixWorld(true);
      const d = foot.getWorldPosition(_v).sub(base);
      // genou : le pied recule et monte
      const score = -d.z + d.y * 0.8 - Math.abs(d.x) * 1.5;
      if (!best || score > best.score) best = { axis, sign, score, dz: d.z };
    }
  }
  lowerLeg.quaternion.copy(rest);
  root.updateMatrixWorld(true);
  if (!best || best.score <= 0) return null;
  return { axis: best.axis, sign: best.sign };
}

const angleFromDown = (v) => Math.acos(clamp(-v.normalize().y, -1, 1));

/**
 * Beaucoup de modèles sont exportés en T-pose (bras horizontaux) : on abaisse
 * les bras pour obtenir une pose de repos naturelle, en mesurant l'angle
 * réellement obtenu (aucune supposition sur l'orientation des os).
 */
function lowerArmsIfNeeded(bones, root) {
  const result = [];
  for (const [side, armKey, handKey] of [['L', 'upperarml', 'handl'], ['R', 'upperarmr', 'handr']]) {
    const arm = bones[armKey];
    const hand = bones[handKey];
    const chest = bones.chest || bones.torso;
    if (!arm || !hand || !chest) continue;
    root.updateMatrixWorld(true);
    const shoulderPos = chest.getWorldPosition(new THREE.Vector3());
    const handPos = hand.getWorldPosition(_v2);
    const current = angleFromDown(handPos.clone().sub(shoulderPos));
    if (current < 0.55) { result.push({ side, axis: null }); continue; } // déjà le long du corps

    // meilleur axe pour faire descendre la main
    const rest = arm.quaternion.clone();
    let best = null;
    for (const axis of ['x', 'y', 'z']) {
      for (const sign of [1, -1]) {
        arm.quaternion.copy(rest).multiply(_q.setFromAxisAngle(AXES[axis], 0.7 * sign));
        root.updateMatrixWorld(true);
        const d = hand.getWorldPosition(_v).sub(handPos);
        if (!best || d.y < best.dy) best = { axis, sign, dy: d.y };
      }
    }
    arm.quaternion.copy(rest);
    if (!best) continue;

    // dichotomie : amener la main à ~28° de la verticale basse
    let lo = 0, hi = 2.1;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      arm.quaternion.copy(rest).multiply(_q.setFromAxisAngle(AXES[best.axis], mid * best.sign));
      root.updateMatrixWorld(true);
      const dir = hand.getWorldPosition(_v).sub(shoulderPos);
      if (angleFromDown(dir) > 0.35) lo = mid; else hi = mid;
    }
    arm.quaternion.copy(rest).multiply(_q.setFromAxisAngle(AXES[best.axis], hi * best.sign));
    root.updateMatrixWorld(true);
    result.push({ side, axis: best.axis, sign: best.sign, angle: hi, lowered: true });
  }
  return result;
}

// ------------------------------ Prototypes ----------------------------------
function prepareVehicle(gltf, typeName) {
  const spec = VEHICLE_TYPES[typeName];
  const src = gltf.scene || gltf.scenes[0];
  src.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(src);
  const size = box.getSize(new THREE.Vector3());
  if (size.x <= 0.01 || size.y <= 0.01 || size.z <= 0.01) throw new Error('bbox dégénérée');

  const sx = spec.wid / size.x;
  const sy = (TARGET_HEIGHT[typeName] ?? 1.45) / size.y;
  const sz = spec.len / size.z;

  // Roues repérées par leur nom (Kenney : wheel-front-*, wheel-back-*),
  // ce qui garantit l'orientation même si le modèle change.
  const wheels = [];
  src.traverse((o) => {
    if (!/wheel/i.test(o.name)) return;
    const wb = new THREE.Box3().setFromObject(o);
    const ws = wb.getSize(new THREE.Vector3());
    // Ne garder que les roues EN CONTACT avec le sol : le SUV embarque une
    // roue de secours sur le hayon, qui ne doit ni rouler ni braquer.
    if (wb.min.y > 0.08) return;
    wheels.push({
      name: o.name,
      front: /front/i.test(o.name),
      radius: Math.max(ws.y, ws.z) * 0.5,   // en unités modèle
      y: o.position.y,
    });
  });

  return {
    type: typeName, src, sx, sy, sz,
    wheelInfo: wheels,
    height: TARGET_HEIGHT[typeName] ?? 1.45,
    length: spec.len,
    width: spec.wid,
  };
}

function prepareCitizen(gltf, name, targetHeight) {
  const src = gltf.scene || gltf.scenes[0];
  src.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(src);
  const height = box.getSize(new THREE.Vector3()).y || 1.9;
  const scale = targetHeight / height;

  const bones = collectBones(src);
  lowerArmsIfNeeded(bones, src);

  // Les axes sont mesurés UNE SEULE FOIS sur le prototype : les clones
  // héritent de la même pose de repos, donc des mêmes axes locaux.
  const axes = {
    legL: detectSwing(bones.upperlegl, bones.footl, src),
    legR: detectSwing(bones.upperlegr, bones.footr, src),
    kneeL: detectKnee(bones.lowerlegl, bones.footl, src),
    kneeR: detectKnee(bones.lowerlegr, bones.footr, src),
    armL: detectSwing(bones.upperarml, bones.handl, src),
    armR: detectSwing(bones.upperarmr, bones.handr, src),
    // coudes : même principe que les genoux, mesuré sur la main
    elbowL: detectSwing(bones.lowerarml, bones.handl, src),
    elbowR: detectSwing(bones.lowerarmr, bones.handr, src),
    // buste : axe de flexion avant (mesuré sur la tête)
    spine: detectSwing(bones.abdomen || bones.torso || bones.chest, bones.head, src),
    hips: detectSwing(bones.hips, bones.head, src),
  };

  const REST_KEYS = ['upperlegl', 'upperlegr', 'lowerlegl', 'lowerlegr',
    'upperarml', 'upperarmr', 'lowerarml', 'lowerarmr', 'abdomen', 'torso', 'chest', 'hips'];
  const rests = {};
  for (const key of REST_KEYS) if (bones[key]) rests[key] = bones[key].quaternion.clone();

  const makeRig = (root) => {
    const b = collectBones(root);
    const entry = (key, axis) => {
      const bone = b[key];
      if (!bone || !axes[axis]) return null;
      return { bone, rest: rests[key] || bone.quaternion.clone(), axis: AXES[axes[axis].axis], sign: axes[axis].sign };
    };
    return {
      group: root,
      height: targetHeight,
      legs: [entry('upperlegl', 'legL'), entry('upperlegr', 'legR')],
      knees: [entry('lowerlegl', 'kneeL'), entry('lowerlegr', 'kneeR')],
      arms: [entry('upperarml', 'armL'), entry('upperarmr', 'armR')],
      elbows: [entry('lowerarml', 'elbowL'), entry('lowerarmr', 'elbowR')],
      spine: entry(b.abdomen ? 'abdomen' : (b.torso ? 'torso' : 'chest'), 'spine'),
      hipsBone: entry('hips', 'hips'),
      bones: b,
    };
  };

  return { name, src, scale, height: targetHeight, axes, rests, makeRig };
}

// --------------------------------- API --------------------------------------
/**
 * Teinte de foule déterministe (v0.9).
 *
 * Les modèles CC0 partagent une palette unique : sans retouche, les 44 PNJ
 * sont des clones exacts — le défaut le plus visible d'une foule. Cette
 * fonction pure renvoie, pour un numéro de séquence, une teinte proche du
 * blanc (décalage chromatique doux) et une échelle de ±5 %.
 *
 * Exportée pour être testable sans GPU ni GLB.
 *
 * @param {number} seq numéro de citoyen (entier ≥ 1)
 * @returns {{color:[number,number,number], scale:number, hue:number}}
 */
export function citizenTint(seq) {
  const h = (n) => ((Math.sin(seq * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  const hue = h(1);
  const t = new THREE.Color(1, 1, 1).lerp(new THREE.Color().setHSL(hue, 0.55, 0.5), 0.10 + h(2) * 0.08);
  const bright = 0.94 + h(4) * 0.12;
  return {
    color: [t.r * bright, t.g * bright, t.b * bright],
    scale: 0.95 + h(6) * 0.10,
    hue,
  };
}

export const Assets = {
  ready: false,
  error: null,
  vehicleProtos: {},
  citizenProtos: {},
  playerProto: null,
  citizenModels: CITIZEN_MODELS.slice(),
  /** compteurs pour le panneau debug */
  stats() {
    return {
      ready: this.ready,
      vehicles: Object.keys(this.vehicleProtos).length,
      citizens: Object.keys(this.citizenProtos).length,
      player: !!this.playerProto,
    };
  },

  async init() {
    if (this.ready) return this;
    const names = Object.keys(MODELS);
    const parsed = new Map();
    await Promise.all(names.map(async (name) => {
      try {
        parsed.set(name, await parseGLB(MODELS[name]));
      } catch (e) {
        console.warn(`[assets] ${name} illisible :`, e?.message ?? e);
      }
    }));

    for (const [type, file] of Object.entries(VEHICLE_MODEL)) {
      const gltf = parsed.get(file);
      if (!gltf) continue;
      try { this.vehicleProtos[type] = prepareVehicle(gltf, type); }
      catch (e) { console.warn(`[assets] véhicule ${type} :`, e?.message ?? e); }
    }

    for (const file of CITIZEN_MODELS) {
      const gltf = parsed.get(file);
      if (!gltf) continue;
      try { this.citizenProtos[file] = prepareCitizen(gltf, file, 1.78); }
      catch (e) { console.warn(`[assets] personnage ${file} :`, e?.message ?? e); }
    }

    const playerGltf = parsed.get(PLAYER_MODEL);
    if (playerGltf) {
      try { this.playerProto = prepareCitizen(playerGltf, PLAYER_MODEL, PLAYER_HEIGHT); }
      catch (e) { console.warn('[assets] joueur :', e?.message ?? e); }
    }

    // textures importées : anisotropie maximale + filtrage de qualité
    for (const proto of Object.values(this.vehicleProtos)) upgradeImportedTextures(proto.src, 16);
    for (const proto of Object.values(this.citizenProtos)) upgradeImportedTextures(proto.src, 16);
    if (this.playerProto) upgradeImportedTextures(this.playerProto.src, 16);

    this.ready = true;
    return this;
  },

  // ------------------------------ Véhicules --------------------------------
  /** @returns {null|{group, wheels, frontWheels, wheelRadius, height, length}} */
  makeVehicle(typeName) {
    const proto = this.vehicleProtos[typeName];
    if (!proto) return null;

    // ------------------------------------------------------------------
    // Le modèle est étiré de façon ANISOTROPE (largeur, hauteur, longueur)
    // pour coller à la physique. Or une échelle non uniforme appliquée à
    // une roue qui tourne la déforme en ovale. On sépare donc :
    //   - CARROSSERIE : étirée, sans les roues ;
    //   - ROUES : pivots à échelle UNIFORME (donc parfaitement rondes).
    // ------------------------------------------------------------------
    // 1) Mesures dans le repère NON étiré (positions + rayons des roues)
    const probe = proto.src.clone(true);
    probe.updateMatrixWorld(true);
    const measured = new Map();
    const realWheels = new Set(proto.wheelInfo.map((w) => w.name));  // exclut la roue de secours
    probe.traverse((o) => {
      if (!realWheels.has(o.name)) return;
      const bbox = new THREE.Box3().setFromObject(o);
      const size = bbox.getSize(new THREE.Vector3());
      const rModel = Math.max(size.y, size.z) / 2;
      const wp = new THREE.Vector3();
      o.getWorldPosition(wp);
      measured.set(o.name, { x: wp.x, y: wp.y, z: wp.z, rModel, uniform: Math.abs(o.scale.x - o.scale.y) < 1e-3 });
    });

    // 2) Carrosserie étirée, roues détachées
    const body = proto.src.clone(true);
    const group = new THREE.Group();
    group.add(body);
    body.scale.set(proto.sx, proto.sy, proto.sz);
    body.updateMatrixWorld(true);
    body.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = false;
      // La texture « colormap » des modèles CC0 encode la couleur ET les
      // détails. On relève le caractère peint : légèrement métallique, plutôt
      // lisse, et réfléchissant le ciel (le vernis est simulé par le clearcoat
      // des matériaux créés dans vehicles.js pour les carrosseries procédurales).
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (!m || /wheel/i.test(o.name)) continue;
        if ('roughness' in m) m.roughness = Math.min(m.roughness, 0.42);
        if ('metalness' in m) m.metalness = Math.max(m.metalness, 0.22);
        m.envMapIntensity = 1.15;
      }
    });

    // --- vitres transparentes : on découpe le mesh de carrosserie principal ---
    let glassMesh = null;
    const mainBody = (() => {
      let best = null, bestCount = -1;
      body.traverse((o) => {
        if (!o.isMesh || /wheel/i.test(o.name)) return;
        const n = o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count;
        if (n > bestCount) { bestCount = n; best = o; }
      });
      return best;
    })();
    if (mainBody) {
      const split = splitGlass(mainBody);
      if (split.glass) {
        const parent = mainBody.parent;
        parent.remove(mainBody);
        // la carrosserie opaque conserve l'ombre ; le verre n'en projette pas
        split.body.castShadow = true;
        split.body.receiveShadow = false;
        parent.add(split.body);
        split.glass.castShadow = false;
        parent.add(split.glass);
        glassMesh = split.glass;
      }
    }

    const wheels = [];
    const frontWheels = [];
    let wheelRadius = 0.33;

    for (const [name, m] of measured) {
      let node = null;
      body.traverse((o) => { if (o.name === name && !node) node = o; });
      if (!node || m.rModel <= 0.01) continue;

      // rayon réel = rayon du modèle × étirement moyen vertical/longitudinal
      const rWorld = m.rModel * (proto.sy + proto.sz) / 2;
      const f = rWorld / m.rModel;               // facteur strictement uniforme

      const pivot = new THREE.Group();
      pivot.position.set(m.x * proto.sx, rWorld, m.z * proto.sz);

      node.parent.remove(node);
      node.position.set(0, 0, 0);
      node.rotation.set(0, 0, 0);
      node.rotation.order = 'YXZ';
      if (m.uniform) node.scale.setScalar(node.scale.y * f);
      else node.scale.multiplyScalar(f);         // roue déjà déformée à la source
      pivot.add(node);
      group.add(pivot);

      wheelRadius = Math.max(wheelRadius, rWorld);
      wheels.push(node);
      if (proto.wheelInfo.find((w) => w.name === name)?.front) frontWheels.push(pivot);
    }

    // Éléments décoratifs restés sur la carrosserie : la roue de secours du
    // SUV serait écrasée par l'étirement anisotrope, on la retire.
    body.traverse((o) => {
      if (/wheel/i.test(o.name) && !realWheels.has(o.name)) o.visible = false;
    });

    return {
      group, wheels, frontWheels,
      glass: glassMesh,
      wheelRadius: wheelRadius === 0.33 ? 0.33 : wheelRadius,
      height: proto.height, length: proto.length,
    };
  },

  // ----------------------------- Personnages -------------------------------
  _cloneCitizen(proto, variant) {
    if (!proto) return null;
    const scene = cloneSkinned(proto.src);
    // ------------------------------------------------------------------------
    // VARIÉTÉ DE FOULE (v0.9)
    // Les modèles CC0 partagent une palette unique : sans retouche, les 44 PNJ
    // sont des clones exacts — le défaut le plus visible d'une foule. On teinte
    // donc chaque copie (matériaux clonés, jamais partagés) d'un écart de
    // teinte/luminosité de quelques pourcents et d'une échelle de ±5 %.
    // Assez pour casser la répétition, assez peu pour rester crédible.
    // ------------------------------------------------------------------------
    const seq = (this._citizenSeq = (this._citizenSeq || 0) + 1);
    const tv = citizenTint(seq);
    const tint = new THREE.Color(tv.color[0], tv.color[1], tv.color[2]);
    scene.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      o.material = Array.isArray(o.material) ? mats.map(tintMat) : tintMat(mats[0]);
      function tintMat(m) {
        if (!m) return m;
        const c = m.clone();
        // la palette est blanche + couleurs de sommets : multiplier la couleur
        // décale l'ensemble (vêtements ET peau) de façon cohérente.
        const base = c.color ? c.color.clone() : new THREE.Color(1, 1, 1);
        c.color = base.multiply(tint);
        if (c.roughness !== undefined) c.roughness = Math.min(1, (c.roughness ?? 0.8) + 0.05);
        return c;
      }
    });
    scene.scale.setScalar(proto.scale * tv.scale);
    scene.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; }
      // ------------------------------------------------------------------
      // CORRECTIF CRITIQUE : après clonage, SkeletonUtils recopie le
      // bindMatrix mais laisse un bindMatrixInverse incohérent (il contient
      // l'inverse de l'échelle centimétrique du modèle, ×0,01). Appliqué aux
      // sommets, il les écrase vers l'origine : le personnage apparaît
      // déformé/méconnaissable. La géométrie et les boneInverses étant dans
      // le même repère, la liaison correcte est l'identité.
      // ------------------------------------------------------------------
      // NB : on NE touche PAS bindMatrix / bindMatrixInverse. Le clonage
      // SkeletonUtils les recopie correctement (vérifié : l'étendue skinée
      // reste identique à l'original). Les forcer à l'identité effondre le
      // maillage sur l'origine.
    });
    const rig = proto.makeRig(scene);
    rig.variant = variant;
    return rig;
  },

  /** @returns {null|{group, legs, knees, arms, bones, height}} */
  makeCitizen(variant = 0) {
    const models = this.citizenModels;
    if (!models.length) return null;
    const file = models[variant % models.length];
    return this._cloneCitizen(this.citizenProtos[file], variant);
  },

  makePlayer() {
    return this._cloneCitizen(this.playerProto, 'player');
  },

  // -------------------------- Animation procédurale ------------------------
  /**
   * Cycle de locomotion unifié : MARCHE continue jusqu'à ~2,4 m/s, COURSE
   * au-delà, avec interpolation douce entre les deux (important : la
   * transition ne doit pas "claquer" quand le joueur sprinte).
   *
   *   marche : foulée 0,44 rad · genoux 0,55 · bras 0,34 · rebond 2 cm
   *   course : foulée 0,80 rad · genoux 1,15 · bras 0,78 · coudes pliés 1,15 rad
   *            · buste incliné 0,20 rad · rebond 7 cm
   *
   * @param rig     squelette (Assets.makeCitizen / makePlayer)
   * @param speed   vitesse horizontale en m/s
   * @param dt      delta temps
   * @param phase   phase de cycle (accumulée par l'appelant)
   * @returns {number} amplitude du rebond vertical, à appliquer par l'appelant
   */
  animateRig(rig, speed, dt, phase) {
    if (!rig) return 0;
    const run = clamp((speed - 2.4) / 3.2, 0, 1);      // 0 = marche, 1 = course
    const moving = clamp(speed / 0.9, 0, 1);           // 0 = immobile

    // paramètres interpolés marche <-> course
    const stride = (0.44 + 0.36 * run) * moving;
    const kneeAmp = (0.55 + 0.60 * run) * moving;
    const kneeBase = 0.10 + 0.35 * run;
    const armAmp = (0.34 + 0.44 * run) * moving;
    const elbowBend = (0.10 + 1.05 * run) * moving;
    const lean = (0.03 + 0.17 * run) * moving;
    const bobAmp = (0.018 + 0.052 * run) * moving;
    const hipYaw = (0.05 + 0.10 * run) * moving;

    const setRot = (e, angle) => {
      if (!e) return;
      e.bone.quaternion.copy(e.rest).multiply(_q.setFromAxisAngle(e.axis, angle * e.sign));
    };
    const addRot = (e, angle) => {
      if (!e) return;
      e.bone.quaternion.copy(e.rest)
        .multiply(_q.setFromAxisAngle(e.axis, angle * e.sign));
    };

    // --- jambes : hanches + genoux + chevilles ---
    for (let i = 0; i < 2; i++) {
      const ph = phase + i * Math.PI;
      const s = Math.sin(ph);
      const leg = rig.legs[i];
      const knee = rig.knees[i];
      // la jambe oscille d'avant en arrière
      setRot(leg, s * stride);
      // le genou ne se plie que pendant le retour (jambe en arrière)
      const flex = Math.max(0, -Math.cos(ph) * 0.5 + 0.5) * kneeAmp + kneeBase * (0.35 + 0.65 * Math.max(0, -s));
      setRot(knee, flex);
    }

    // --- bras : opposition de phase, coudes pliés en course ---
    for (let i = 0; i < 2; i++) {
      const ph = phase + i * Math.PI;
      const s = Math.sin(ph);
      setRot(rig.arms[i], -s * armAmp);
      // coude : plié en permanence en course, légèrement en marche
      setRot(rig.elbows?.[i], elbowBend + Math.max(0, s) * 0.30 * armAmp);
    }

    // --- buste : inclinaison avant + oscillations ---
    if (rig.spine) {
      const sway = Math.sin(phase * 2) * 0.015 * moving;
      setRot(rig.spine, lean);
      rig.spine.bone.quaternion.multiply(_q.setFromAxisAngle(_v.set(0, 0, 1).normalize(), sway));
    }
    if (rig.hipsBone) {
      setRot(rig.hipsBone, Math.sin(phase * 2) * 0.02 * moving);
    }

    // Rebond vertical : le centre de masse est au plus HAUT à la position de
    // passage (jambes jointes, |sin| = 0) et au plus BAS à l'appui double
    // (jambes écartées, |sin| = 1) — c'est la mécanique de la marche réelle.
    // Le rebond ne descend jamais sous 0 : sinon les pieds traversent le sol.
    const bob = (1 - Math.abs(Math.sin(phase))) * bobAmp;
    rig.bob = bob;
    rig.runBlend = run;
    return bob;
  },

  /**
   * Longueur de foulée en mètres pour une vitesse donnée.
   * Marche ~0,65 m par pas, course ~1,5 m par pas.
   */
  strideLength(speed) {
    const sp = Math.abs(speed);
    return clamp(1.25 + 0.34 * sp, 1.25, 3.4);
  },

  /**
   * Avance la phase du cycle en fonction de la DISTANCE parcourue.
   * C'est ce qui supprime le glissement de pieds : la cadence n'est plus
   * arbitraire, elle découle de la vitesse réelle.
   * @returns {number} nouvelle phase (radians)
   */
  advancePhase(phase, speed, dt) {
    const sp = Math.abs(speed);
    if (sp < 0.05) return phase;
    const cyclesPerSecond = sp / this.strideLength(sp);
    return (phase + dt * cyclesPerSecond * Math.PI * 2) % (Math.PI * 2);
  },

  /** Compatibilité : ancien nom utilisé par les tests et les PNJ. */
  walkRig(rig, speed, dt, phase) {
    return this.animateRig(rig, speed, dt, phase);
  },
};

export default Assets;
