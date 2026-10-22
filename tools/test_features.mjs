// ============================================================================
// METROPOLIS — tools/test_features.mjs
// Vérifications v0.3 : métropole 8 km streamée, économie, GPS, manette,
// ciclo jour/nuit 20+20 min, santé/blessures, caméra automatique.
// Exécution : node tools/test_features.mjs
// ============================================================================
import assert from 'node:assert/strict';

// ---- stubs navigateur minimalistes (comme le smoke test) ----
const gradStub = { addColorStop() {} };
const ctx2dStub = new Proxy({}, {
  get: (_, p) => (p === 'createLinearGradient' || p === 'createRadialGradient' || p === 'createPattern') ? () => gradStub : () => undefined,
  set: () => true,
});
class FakeCanvas { constructor() { this.width = 256; this.height = 256; } getContext() { return ctx2dStub; } }
globalThis.self = globalThis;
globalThis.Image = class { constructor() { this.onload = null; this.onerror = null; } set src(_v) { setTimeout(() => this.onerror && this.onerror(new Error('no image')), 0); } };
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.devicePixelRatio = 1;
globalThis.document = {
  createElement: () => new FakeCanvas(),
  getElementById: () => null,
  addEventListener() {},
  querySelectorAll: () => [],
  body: { appendChild() {}, requestPointerLock() {} },
};
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

import * as THREE from '../web/node_modules/three/build/three.module.js';
const { City } = await import('../web/src/city.js');
const { CFG, ECONOMY, VEHICLE_TYPES } = await import('../web/src/core.js');
const EconomyMod = await import('../web/src/economy.js');
const GPSSystem = (await import('../web/src/gps.js')).default;
const { GamepadInput } = await import('../web/src/input.js');
const { Environment } = await import('../web/src/environment.js');
const { Player } = await import('../web/src/player.js');
const Assets = (await import('../web/src/assets.js')).default;

let passed = 0; const fails = [];
const check = (label, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + label); }
  catch (e) { fails.push(label); console.log('  ✗ ' + label + ' — ' + e.message); }
};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1.6, 0.1, 3000);
console.log('— Métropole étendue —');
const city = new City(scene);
check('grille routière 129×129 (8,19 km)', () => {
  assert.equal(city.nodes.length, 129);
  const span = city.nodes[128][0].x - city.nodes[0][0].x;
  assert(span > 8000, `portée ${span}`);
});
check('streaming : chunks générés autour du joueur', () => assert(city.chunks.size >= 9, `${city.chunks.size}`));
check('streaming : le contenu suit le joueur à 3 km', () => {
  const before = city.chunks.size;
  city.updateStreaming(3000, 3000);
  assert(city.chunks.size > before, `${before} → ${city.chunks.size}`);
  const built = [...city.chunks.values()].filter(Boolean).length;
  assert(built > 0);
});
check('collision valide à 3 km du centre', () => {
  const c = city.collide(3000, 3000, 0.5);
  assert(Number.isFinite(c.x) && Math.abs(c.x) < 4200);
});
check('limites du monde à ~±4 km (plus de barrière à 250 m)', () => {
  const c = city.collide(4000, 0, 0.5);
  assert(c.x > 3900, `x=${c.x}`);
});

console.log('— Cycle jour/nuit 20 min + 20 min —');
const env = new Environment(scene, city, null);
check('20 min de jour (06:00 → 20:00)', () => {
  env.hour = CFG.time.dayStart; env.timeScale = 1;
  for (let i = 0; i < 600; i++) env.hour = (env.hour + 1 * (14 / CFG.time.daySeconds)) % 24;
  assert(Math.abs(env.hour - 13) < 0.05, `après 10 min : ${env.hour.toFixed(2)} h`);
  for (let i = 0; i < 600; i++) env.hour = (env.hour + 1 * (14 / CFG.time.daySeconds)) % 24;
  assert(Math.abs(env.hour - 20) < 0.1, `après 20 min : ${env.hour.toFixed(2)} h`);
});
check('20 min de nuit (20:00 → 06:00)', () => {
  env.hour = 20;
  for (let i = 0; i < 1200; i++) env.hour = (env.hour + 1 * (10 / CFG.time.nightSeconds)) % 24;
  assert(Math.abs(env.hour - 6) < 0.15 || Math.abs(env.hour - 6 + 24) < 0.15, `après 20 min : ${env.hour.toFixed(2)} h`);
});
check('temps total du cycle = 40 min', () => assert.equal(CFG.time.daySeconds + CFG.time.nightSeconds, 2400));

console.log('— Économie —');
const { Economy } = EconomyMod;
const eco = new Economy(city);
check(`logements générés (${eco.houses.length})`, () => assert(eco.houses.length >= 4));
check('achat refusé sans fonds', () => {
  const h = eco.houses.find((x) => x.price > eco.money);
  if (!h) return;
  const r = eco.buyHouse(h.id);
  assert.equal(r.ok, false);
});
check('achat de logement réussi', () => {
  eco.money = 200000;
  const h = eco.houses[0];
  const r = eco.buyHouse(h.id);
  assert(r.ok); assert(eco.ownedHouses.includes(h.id));
  assert(Math.abs(eco.money - (200000 - h.price)) < 1);
  assert(eco.spawnPoint());
});
check('garage : agrandissement 2 → 4 → 6 places', () => {
  assert.equal(eco.garageSlots, 2);
  assert(eco.upgradeGarage().ok); assert.equal(eco.garageSlots, 4);
  assert(eco.upgradeGarage().ok); assert.equal(eco.garageSlots, 6);
  assert.equal(eco.upgradeGarage().ok, false);
});
check('garage plein : 7e véhicule refusé', () => {
  eco.money = 999999;
  for (let i = 0; i < 6; i++) assert(eco.buyCar('Citadine').ok);
  assert.equal(eco.buyCar('Citadine').ok, false);
});
check('améliorations appliquées à une copie de spec', () => {
  const base = eco.specFor('Sportive');
  const tuned = eco.specFor('Sportive', { moteur: 3, pneus: 0, freins: 0 });
  assert(tuned.topSpeed > base.topSpeed * 1.2);
  assert.equal(base.topSpeed, VEHICLE_TYPES.Sportive.topSpeed);
});
check('sérialisation / restauration', () => {
  const snap = eco.serialize();
  const eco2 = new Economy(city);
  eco2.restore(snap);
  assert.equal(Math.round(eco2.money), Math.round(eco.money));
  assert.equal(eco2.ownedCars.length, eco.ownedCars.length);
  assert.equal(eco2.garageLevel, eco.garageLevel);
});

console.log('— GPS —');
const gps = new GPSSystem(scene, city);
const fakeCtx = { playerPos: () => ({ x: 0, z: 0 }), missions: { objectiveInfo: () => ({ pos: { x: 900, z: 900 }, phase: 'deliver' }) } };
gps.update(0.5, fakeCtx);
check('itinéraire calculé vers une cible à 1,3 km', () => assert(gps.route.length > 4, `${gps.route.length} nœuds`));
check('le tracé reste continu (segments de 64 m)', () => {
  for (let i = 1; i < gps.route.length; i++) {
    const d = Math.hypot(gps.route[i].x - gps.route[i - 1].x, gps.route[i].z - gps.route[i - 1].z);
    assert(d < 65.5, `saut de ${d.toFixed(1)} m`);
  }
});
check('flèches au sol instanciées', () => assert(gps.arrows.count > 0, `${gps.arrows.count} flèches`));
check('GPS sans cible : aucune flèche', () => {
  gps.setTarget(null); gps.update(0.5, { playerPos: () => ({ x: 0, z: 0 }), missions: null });
  assert.equal(gps.arrows.count, 0);
});

console.log('— Manette —');
const pad = new GamepadInput();
const fakePad = {
  index: 0, connected: true, id: 'Xbox Wireless Controller (STANDARD GAMEPAD)',
  axes: [0.6, -0.8, 0, 0],
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
};
fakePad.buttons[0] = { pressed: true, value: 1 };
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [fakePad] }, configurable: true });
pad.poll();
check('connexion détectée', () => assert(pad.connected));
check('axes avec zone morte (0.6 → ~0.51)', () => assert(pad.moveX > 0.4 && pad.moveX < 0.7));
check('stick haut = avancer', () => assert(pad.moveY > 0.4));
check('bouton A détecté', () => assert(pad.down('A')));
check('appui A = front montant unique', () => {
  assert(pad.pressed('A'));
  pad.poll();
  assert.equal(pad.pressed('A'), false);
});
check('libellé de manette', () => assert(pad.label().includes('Xbox'), pad.label()));

console.log('— Santé et caméra —');
const player = new Player(scene, camera, { addEventListener() {}, style: {} });
check('santé initiale pleine', () => assert.equal(player.health, player.maxHealth));
check('dégâts réduisent la santé', () => { player.damage(35, {}, 'test'); assert.equal(player.health, 65); });
check('santé bornée à 0', () => { player.damage(999, {}, 'test'); assert.equal(player.health, 0); });
check('soins', () => { player.heal(50); assert.equal(player.health, 50); });
check('caméra automatique active par défaut', () => assert.equal(player.autoCam, true));

console.log('— Textures HD et shaders de sol —');
const texMod = await import('../web/src/textures.js');
check('facade 1024² (full HD)', () => {
  const { day } = texMod.facade('brick', 'mid', 0);
  assert.equal(day.image.width, 1024);
});
check('façade : carte de nuit + relief fournis', () => {
  const f = texMod.facade('glass', 'high', 1);
  assert(f.night && f.night.image, 'emissiveMap manquante');
  assert(f.bump && f.bump.image, 'bumpMap manquante');
});
check('sol métropole 2048² (32 px/m)', () => {
  const m = texMod.metroGroundHD();
  assert.equal(m.map.image.width, 2048);
  assert.equal(m.map.image.width / 64, 32);   // 64 m par tuile
});
check('texture de détail en échelle métrique', () => {
  const d = texMod.groundDetailHD('asphalt');
  assert.equal(d.image.width, 512);
  assert.equal(d.userData.tileMeters, 2);
});
check('textures mutualisées (cache) : pas de duplication mémoire', () => {
  const a = texMod.facade('brick', 'mid', 0);
  const b = texMod.facade('brick', 'mid', 0);
  assert(a === b && a.day === b.day, 'la façade est régénérée à chaque appel');
  assert(texMod.metroGroundHD() === texMod.metroGroundHD(), 'le sol est régénéré');
});
check('shaders de sol : déclarations complètes et accolades équilibrées', () => {
  const lib = THREE.ShaderLib.physical;
  let n = 0;
  const seen = new Set();
  const bal = (str) => (str.match(/{/g) || []).length - (str.match(/}/g) || []).length;
  scene.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || seen.has(m.uuid)) continue;
      if (typeof m.onBeforeCompile !== 'function') continue;
      if (!m.userData.detailTex && !m.userData.uvRepeat) continue;
      seen.add(m.uuid);
      const shader = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
      m.onBeforeCompile(shader, null);
      n++;
      if (m.userData.detailTex) {
        assert(shader.fragmentShader.includes('uniform sampler2D uDetail'), 'uDetail non déclaré');
        assert(shader.vertexShader.includes('varying vec3 vWorldPosD'), 'varying manquant');
      }
      if (m.userData.uvRepeat) {
        assert(shader.vertexShader.includes('vMapUv *= uUvRepeat'), 'répétition UV perdue (hook écrasé)');
      }
      assert.equal(bal(shader.vertexShader), 0, 'accolades vertex déséquilibrées');
      assert.equal(bal(shader.fragmentShader), 0, 'accolades fragment déséquilibrées');
    }
  });
  assert(n >= 3, `seulement ${n} matériaux à hook`);
});

console.log('— Locomotion marche / course —');
const locoRig = () => ({
  legs: [{ bone: new THREE.Object3D(), rest: new THREE.Quaternion(), axis: new THREE.Vector3(1, 0, 0), sign: 1 },
         { bone: new THREE.Object3D(), rest: new THREE.Quaternion(), axis: new THREE.Vector3(1, 0, 0), sign: -1 }],
  knees: [{ bone: new THREE.Object3D(), rest: new THREE.Quaternion(), axis: new THREE.Vector3(1, 0, 0), sign: 1 },
          { bone: new THREE.Object3D(), rest: new THREE.Quaternion(), axis: new THREE.Vector3(1, 0, 0), sign: -1 }],
  arms: [{ bone: new THREE.Object3D(), rest: new THREE.Quaternion(), axis: new THREE.Vector3(1, 0, 0), sign: 1 },
         { bone: new THREE.Object3D(), rest: new THREE.Quaternion(), axis: new THREE.Vector3(1, 0, 0), sign: -1 }],
  elbows: [{ bone: new THREE.Object3D(), rest: new THREE.Quaternion(), axis: new THREE.Vector3(1, 0, 0), sign: 1 },
           { bone: new THREE.Object3D(), rest: new THREE.Quaternion(), axis: new THREE.Vector3(1, 0, 0), sign: -1 }],
  spine: { bone: new THREE.Object3D(), rest: new THREE.Quaternion(), axis: new THREE.Vector3(1, 0, 0), sign: 1 },
  hipsBone: { bone: new THREE.Object3D(), rest: new THREE.Quaternion(), axis: new THREE.Vector3(1, 0, 0), sign: 1 },
  bones: {},
});
/** Amplitude d'un os (angle par rapport à sa pose de repos). */
const swingOf = (entry) => 2 * Math.acos(Math.min(1, Math.abs(entry.bone.quaternion.w)));
const amplify = (rig) => Math.max(
  ...rig.legs.map(swingOf), ...rig.arms.map(swingOf), ...rig.knees.map(swingOf));
check('course : amplitude nettement supérieure à la marche', () => {
  const walk = locoRig(); Assets.animateRig(walk, 1.4, 1 / 60, Math.PI / 2, 1 / 60);
  const run = locoRig(); Assets.animateRig(run, 6.0, 1 / 60, Math.PI / 2, 1 / 60);
  const aw = amplify(walk), ar = amplify(run);
  assert(ar > aw * 1.4, `amplitude marche ${aw.toFixed(3)} vs course ${ar.toFixed(3)}`);
});
check('course : coudes pliés, marche : coudes quasi tendus', () => {
  const walk = locoRig(); Assets.animateRig(walk, 1.4, 1 / 60, 0, 1 / 60);
  const run = locoRig(); Assets.animateRig(run, 6.0, 1 / 60, 0, 1 / 60);
  const ew = swingOf(walk.elbows[0]), er = swingOf(run.elbows[0]);
  assert(er > 0.9 && ew < 0.35, `coude marche ${ew.toFixed(2)} / course ${er.toFixed(2)}`);
});
check('transition continue marche <-> course (pas de saut)', () => {
  const amp = (v) => { const r = locoRig(); Assets.animateRig(r, v, 1 / 60, 0.7, 1 / 60); return amplify(r); };
  const a = amp(3.2), b = amp(3.3);
  assert(Math.abs(a - b) < 0.05, `saut de ${Math.abs(a - b).toFixed(3)} rad`);
});
check('cadence indépendante du framerate (pas de glissement de pieds)', () => {
  // parcourir la même distance doit produire la même phase, que le pas de
  // temps soit gros ou petit : sinon la cadence dépend des FPS.
  const big = Assets.advancePhase(0, 4, 0.5);
  let small = 0;
  for (let i = 0; i < 500; i++) small = Assets.advancePhase(small, 4, 0.001);
  const d = Math.abs(big - small);
  assert(d < 1e-9, `écart ${d.toExponential(2)} rad`);
});
check('cadence : une foulée parcourt bien strideLength mètres', () => {
  // 1 cycle = 2π ; on vérifie la distance parcourue par cycle.
  const v = 3.5, dt = 0.5;                            // < 1 cycle : pas de repli modulo
  const phase = Assets.advancePhase(0, v, dt);
  const cycles = phase / (2 * Math.PI);
  const metresPerCycle = (v * dt) / cycles;
  const expected = Assets.strideLength(v);
  assert(Math.abs(metresPerCycle - expected) < 1e-6,
    `${metresPerCycle.toFixed(3)} m vs ${expected.toFixed(3)} m attendus`);
});
check('rebond : haut jambes jointes, bas jambes écartées, jamais négatif', () => {
  const r1 = locoRig(); const b1 = Assets.animateRig(r1, 5, 1 / 60, 0, 1 / 60);
  const r2 = locoRig(); const b2 = Assets.animateRig(r2, 5, 1 / 60, Math.PI / 2, 1 / 60);
  assert(b1 > b2, `rebond jambes jointes ${b1.toFixed(3)} vs écartées ${b2.toFixed(3)}`);
  assert(Math.abs(b2) < 1e-9, `rebond non nul jambes écartées : ${b2}`);
  assert(b1 > 0, 'rebond nul jambes jointes');
});

console.log(`\n${fails.length ? '❌' : '✅'} FEATURES : ${passed} vérifications réussies, ${fails.length} échec(s).`);
if (fails.length) { fails.forEach((f) => console.log('   ✗ ' + f)); process.exit(1); }
