// ============================================================================
// METROPOLIS — tools/check_assets.mjs
// Valide les modèles 3D SANS navigateur : dimensions, roues, squelette,
// et surtout le CYCLE DE MARCHE (les pieds doivent alterner d'avant en
// arrière, les bras doivent être le long du corps). C'est notre seule
// "paire d'yeux" sur les assets dans un environnement sans écran.
//
//   node tools/check_assets.mjs
// ============================================================================
globalThis.self = globalThis; // three.js GLTFLoader attend `self`
// Node n'a ni DOM ni décodeur d'images : on simule un Image qui échoue
// proprement. Le loader continue alors sans textures (squelette + géométrie
// restent parfaitement exploitables pour valider les dimensions).
globalThis.Image = class {
  constructor() { this.onload = null; this.onerror = null; }
  set src(_v) { setTimeout(() => this.onerror && this.onerror(new Error('no image decoder in node')), 0); }
};
// stubs DOM minimalistes : Player/PedestrianSystem s'enregistrent sur window
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.document = { addEventListener() {}, body: { requestPointerLock() {} }, pointerLockElement: null };

import * as THREE from '../web/node_modules/three/build/three.module.js';
import Assets from '../web/src/assets.js';
import { VEHICLE_TYPES } from '../web/src/core.js';
import { MODELS } from '../web/src/assets.generated.js';

let pass = 0;
const fails = [];
const ok = (cond, label, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`); }
  else { fails.push(label); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
};
const f2 = (n) => n.toFixed(2);
const worldPos = (obj) => obj.getWorldPosition(new THREE.Vector3());

console.log('— Chargement des modèles embarqués —');
console.log(`  ${Object.keys(MODELS).length} fichiers, ${(Object.values(MODELS).reduce((a, b) => a + b.length, 0) / 1048576).toFixed(2)} Mo de base64`);

await Assets.init();
ok(Assets.ready, 'bibliothèque prête');
ok(Object.keys(Assets.vehicleProtos).length === 7, '7 types de véhicules chargés',
  Object.keys(Assets.vehicleProtos).join(', '));
ok(Object.keys(Assets.citizenProtos).length === 5, '5 variantes de citoyens chargées');
ok(!!Assets.playerProto, 'modèle du joueur chargé');

console.log('\n— Véhicules —');
for (const [type, spec] of Object.entries(VEHICLE_TYPES)) {
  const v = Assets.makeVehicle(type);
  ok(!!v, `${type} : modèle disponible`);
  if (!v) continue;
  v.group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(v.group);
  const size = box.getSize(new THREE.Vector3());
  const dLen = Math.abs(size.z - spec.len) / spec.len;
  const dWid = Math.abs(size.x - spec.wid) / spec.wid;
  ok(dLen < 0.06, `${type} : longueur conforme à la physique`, `${f2(size.z)} m vs ${spec.len} m`);
  ok(dWid < 0.35, `${type} : largeur plausible`, `${f2(size.x)} m vs ${spec.wid} m`);
  ok(v.wheels.length === 4, `${type} : 4 roues détectées`, `${v.wheels.length}`);
  ok(v.frontWheels.length === 2, `${type} : 2 roues avant`, `${v.frontWheels.length}`);
  ok(v.wheelRadius > 0.15 && v.wheelRadius < 0.8, `${type} : rayon de roue plausible`, `${f2(v.wheelRadius)} m`);
  const ground = Math.abs(box.min.y);
  ok(ground < 0.08, `${type} : posé au sol`, `bas à ${f2(box.min.y)} m`);
}

console.log('\n— Citoyens : squelette et cycle de marche —');
for (let i = 0; i < 5; i++) {
  const rig = Assets.makeCitizen(i);
  ok(!!rig, `variante ${i} instanciée`);
  if (!rig) continue;
  rig.group.updateMatrixWorld(true);

  const { upperarml, handl, chest, upperlegl, upperlegr, footl, footr } = rig.bones;
  ok(!!(upperlegl && upperlegr && footl && footr && upperarml && handl && chest),
    `variante ${i} : os essentiels présents`);

  // bras le long du corps (pas de T-pose) : on mesure l'ANGLE du bras,
  // plus fiable que la distance (les modèles sont stylisés, bras courts)
  const shoulderJoint = worldPos(rig.bones.upperarml);
  const hand = worldPos(handl);
  const armVec = hand.clone().sub(shoulderJoint).normalize();
  const armAngle = Math.acos(Math.max(-1, Math.min(1, -armVec.y)));
  ok(armAngle < 0.6, `variante ${i} : bras le long du corps (pas de T-pose)`,
    `angle ${(armAngle * 57.3).toFixed(0)}° de la verticale`);

  // cycle : à phase +90°, le pied gauche est devant le droit
  Assets.walkRig(rig, 1.4, 0.016, Math.PI / 2);
  rig.group.updateMatrixWorld(true);
  const aL = worldPos(footl).z, aR = worldPos(footr).z;
  ok(aL - aR > 0.08, `variante ${i} : pied gauche en avant à phase +90°`, `Δz = ${f2(aL - aR)} m`);

  Assets.walkRig(rig, 1.4, 0.016, -Math.PI / 2);
  rig.group.updateMatrixWorld(true);
  const bL = worldPos(footl).z, bR = worldPos(footr).z;
  ok(bR - bL > 0.08, `variante ${i} : pied droit en avant à phase −90°`, `Δz = ${f2(bR - bL)} m`);

  // retour au repos
  Assets.walkRig(rig, 0, 0.016, 0);
  rig.group.updateMatrixWorld(true);
  const restL = worldPos(footl);
  ok(Math.abs(restL.y) < rig.height * 0.12, `variante ${i} : pied au sol au repos`, `y = ${f2(restL.y)} m`);
}

console.log('\n— Intégration gameplay (modèles réellement câblés) —');
{
  const { Vehicle } = await import('../web/src/vehicles.js');
  const fakeScene = { add() {} };
  for (const type of Object.keys(VEHICLE_TYPES)) {
    const v = new Vehicle(fakeScene, type);
    ok(v.wheels.length === 4 && v.frontPivots.length === 2,
      `Vehicle(${type}) : roues du modèle pilotées`, `${v.wheels.length} roues / ${v.frontPivots.length} avant`);
    ok(v.wheelR > 0.15, `Vehicle(${type}) : rayon de roue transmis`, `${f2(v.wheelR)} m`);
  }

  const { Player } = await import('../web/src/player.js');
  const cam = new THREE.PerspectiveCamera();
  const dom = { addEventListener() {}, style: {}, requestPointerLock() {} };
  const player = new Player(fakeScene, cam, dom);
  ok(!!player.rig, 'Player : avatar 3D instancié');
  ok(player.prim.visible === false, 'Player : primitives masquées quand le modèle existe');
  Player.prototype.placeAt?.call?.(player, 0, 0, 0);

  const { PedestrianSystem } = await import('../web/src/pedestrians.js');
  const cityStub = {
    randomBuilding: () => ({ door: { x: 0, z: 0 } }),
    groundY: () => 0,
    collide: (x, z) => ({ x, z }),
    pedNodes: [{ x: 0, z: 0 }, { x: 12, z: 8 }, { x: -20, z: 4 }],
    pedPath: () => [],
    nearestPedNode: () => ({ x: 0, z: 0 }),
  };
  const t0 = performance.now();
  const peds = new PedestrianSystem(fakeScene, cityStub);
  const dtPop = performance.now() - t0;
  const withRig = peds.citizens.filter((c) => c.rig).length;
  ok(withRig === peds.citizens.length && withRig > 0,
    'Population entière instanciée avec modèles 3D', `${withRig}/${peds.citizens.length} en ${dtPop.toFixed(0)} ms`);
  ok(peds.citizens.every((c) => c.prim.visible === false), 'Primitives masquées pour toute la population');
  // coût du cycle de marche sur toute la foule (1 frame)
  const t1 = performance.now();
  for (const c of peds.citizens) Assets.walkRig(c.rig, 1.4, 0.016, 1.2);
  const dtAnim = performance.now() - t1;
  ok(dtAnim < 8, 'Animation de la foule peu coûteuse', `${dtAnim.toFixed(2)} ms pour ${withRig} personnages`);
}

console.log('\n— Budget —');
const total = Object.values(MODELS).reduce((a, b) => a + b.length, 0);
ok(total < 4.5 * 1048576, 'taille embarquée sous contrôle', `${(total / 1048576).toFixed(2)} Mo de base64`);

console.log(`\n${fails.length === 0 ? '✅' : '❌'} CHECK ASSETS : ${pass} vérifications réussies, ${fails.length} échec(s).`);
if (fails.length) { for (const f of fails) console.log('   ✗', f); process.exit(1); }
