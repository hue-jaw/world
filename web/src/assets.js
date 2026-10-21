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
import { MODELS } from './assets.generated.js';

const loader = new GLTFLoader();

// --------------------------- Correspondances --------------------------------
const VEHICLE_MODEL = {
  Citadine: 'car_hatchback-sports.glb',
  Berline: 'car_sedan.glb',
  SUV: 'car_suv.glb',
  Sportive: 'car_sedan-sports.glb',
  Taxi: 'car_taxi.glb',
  Utilitaire: 'car_van.glb',
  Police: 'car_police.glb',
};

// Hauteur réelle visée (m) : les modèles Kenney sont trapus, on les étire
// en longueur et on les abaisse pour coller aux proportions de la physique.
const TARGET_HEIGHT = {
  Citadine: 1.44, Berline: 1.46, SUV: 1.74, Sportive: 1.26, Taxi: 1.5, Utilitaire: 2.24, Police: 1.48,
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
  };

  const REST_KEYS = ['upperlegl', 'upperlegr', 'lowerlegl', 'lowerlegr', 'upperarml', 'upperarmr'];
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
      bones: b,
    };
  };

  return { name, src, scale, height: targetHeight, axes, rests, makeRig };
}

// --------------------------------- API --------------------------------------
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

    this.ready = true;
    return this;
  },

  // ------------------------------ Véhicules --------------------------------
  /** @returns {null|{group, wheels, frontWheels, wheelRadius, height, length}} */
  makeVehicle(typeName) {
    const proto = this.vehicleProtos[typeName];
    if (!proto) return null;
    const inner = proto.src.clone(true);
    inner.scale.set(proto.sx, proto.sy, proto.sz);
    inner.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; }
    });

    const group = new THREE.Group();
    group.add(inner);

    // Compensation des roues : le véhicule est étiré de façon anisotrope,
    // les roues sont donc redimensionnées pour rester rondes et au sol.
    const stretch = proto.sz / proto.sy;
    const byName = {};
    inner.traverse((o) => { byName[o.name] = o; });

    const wheels = [];
    const frontWheels = [];
    let wheelRadius = 0.33;
    for (const info of proto.wheelInfo) {
      const node = byName[info.name];
      if (!node) continue;
      node.rotation.order = 'YXZ';
      node.scale.set(node.scale.x, node.scale.y * stretch, node.scale.z);
      node.position.y = info.y * stretch;
      const r = info.radius * proto.sz;
      wheelRadius = Math.max(wheelRadius, r);
      wheels.push(node);
      if (info.front) frontWheels.push(node);
    }

    return { group, wheels, frontWheels, wheelRadius, height: proto.height, length: proto.length };
  },

  // ----------------------------- Personnages -------------------------------
  _cloneCitizen(proto, variant) {
    if (!proto) return null;
    const scene = cloneSkinned(proto.src);
    scene.scale.setScalar(proto.scale);
    scene.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; }
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
   * Cycle de marche : hanches/épaules en opposition de phase, genoux fléchis
   * au retour de jambe. L'amplitude suit la vitesse, la phase vient de
   * l'appelant (déjà utilisée par les primitives → même rythme).
   */
  walkRig(rig, speed, dt, phase) {
    if (!rig) return;
    const amp = clamp(speed / 1.45, 0, 1.25);
    if (amp < 0.02 && rig._idle === true) return;
    rig._idle = amp < 0.02;
    for (let i = 0; i < 2; i++) {
      const s = Math.sin(phase + i * Math.PI);
      const leg = rig.legs[i];
      const knee = rig.knees[i];
      const arm = rig.arms[i];
      if (leg) leg.bone.quaternion.copy(leg.rest).multiply(_q.setFromAxisAngle(leg.axis, s * 0.46 * amp * leg.sign));
      if (knee) knee.bone.quaternion.copy(knee.rest).multiply(_q.setFromAxisAngle(knee.axis, Math.max(0, -s) * 0.9 * amp * knee.sign));
      if (arm) arm.bone.quaternion.copy(arm.rest).multiply(_q.setFromAxisAngle(arm.axis, -s * 0.45 * amp * arm.sign));
    }
  },
};

export default Assets;
