// ============================================================================
// METROPOLIS — test de fumée headless (Node).
// Fait tourner la VRAIE simulation du prototype (ville, trafic, PNJ, police,
// mission, météo) sans navigateur, avec des stubs DOM/canvas minimaux.
// Usage : node tools/smoke_test.mjs
// ============================================================================
import assert from 'node:assert/strict';

// ---- stubs DOM AVANT tout import du jeu ----
const gradStub = { addColorStop() {} };
const ctx2dStub = new Proxy({}, {
  get: (_, prop) => (prop === 'createLinearGradient' || prop === 'createRadialGradient')
    ? () => gradStub : () => undefined,
  set: () => true,
});
class FakeCanvas {
  constructor() { this.width = 256; this.height = 256; }
  getContext() { return ctx2dStub; }
}
globalThis.self = globalThis;              // GLTFLoader se croit dans un worker
globalThis.Image = class {                 // pas de décodeur d'images sous Node
  constructor() { this.onload = null; this.onerror = null; }
  set src(_v) { setTimeout(() => this.onerror && this.onerror(new Error('no image in node')), 0); }
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.document = {
  createElement: () => new FakeCanvas(),
  getElementById: () => null,
  querySelectorAll: () => [],
};
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

// ---- imports jeu (dynamiques, après stubs) ----
const THREE = await import('../web/node_modules/three/build/three.module.js');
const { City } = await import('../web/src/city.js');
const { TrafficSystem } = await import('../web/src/vehicles.js');
const { PedestrianSystem } = await import('../web/src/pedestrians.js');
const { Player } = await import('../web/src/player.js');
const { Environment } = await import('../web/src/environment.js');
const { MissionSystem } = await import('../web/src/missions.js');
const { SaveSystem } = await import('../web/src/save.js');
const { Bus } = await import('../web/src/core.js');

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name); };

console.log('— Construction du monde —');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1.6, 0.1, 2000);
const city = new City(scene);
check(`ville générée : ${city.buildings.length} bâtiments`, () => assert(city.buildings.length > 60));
check(`graphe routier 8x8`, () => assert.equal(city.nodes.length, 8));
check(`graphe piéton : ${city.pedNodes.length} nœuds`, () => assert(city.pedNodes.length > 120));
check('BFS piéton traverse la ville', () => {
  const p = city.pedPath(city.pedNodes[0], city.pedNodes[city.pedNodes.length - 1]);
  assert(p.length > 3);
});
check('collision : le centre d\'un bâtiment est repoussé', () => {
  const b = city.buildings.find((x) => x.h > 5);
  const c = city.collide(b.x, b.z, 0.5);
  assert(Math.abs(c.x - b.x) > 1 || Math.abs(c.z - b.z) > 1);
});
check('feux : les deux axes ne sont jamais verts ensemble', () => {
  for (let t = 0; t < 15; t += 0.25) {
    city.lightPhase = t;
    assert(!(city.lightState('NS') === 'green' && city.lightState('EW') === 'green'));
  }
});

const env = new Environment(scene, city);
const fakeDom = { addEventListener() {} };
const player = new Player(scene, camera, fakeDom);
const traffic = new TrafficSystem(scene, city);
const peds = new PedestrianSystem(scene, city);
const missions = new MissionSystem(scene, city);
const audioStub = new Proxy({}, { get: () => () => {} });
const ctx = {
  scene, city, env, traffic, peds, player, missions, audio: audioStub,
  ui: { setPrompt() {}, setDebug() {}, showBusted() {} },
  money: 0, playerVehicle: null,
  playerPos: () => player.getPos(), playerSpeed: () => player.getSpeed(),
  shakeCamera() {}, addMoney(n) { ctx.money += n; }, saveNow() {},
};
traffic.init(ctx);

console.log('— Simulation 30 s (900 frames) —');
const startPos = traffic.vehicles.filter((v) => v.active && v.driver).map((v) => ({ v, x: v.pos.x, z: v.pos.z }));
check(`trafic initial : ${startPos.length} véhicules IA`, () => assert(startPos.length >= 10));
const dt = 1 / 30;
for (let f = 0; f < 900; f++) {
  env.update(dt, ctx);
  city.update(dt);
  traffic.update(dt, ctx);
  peds.update(dt, ctx);
  missions.update(dt, ctx);
}
check('aucune position NaN (véhicules + PNJ)', () => {
  for (const v of traffic.vehicles) assert(Number.isFinite(v.pos.x + v.pos.z + v.vf), 'véhicule NaN');
  for (const c of peds.citizens) assert(Number.isFinite(c.pos.x + c.pos.z), 'PNJ NaN');
});
check('les voitures IA roulent réellement (>10 m parcourus)', () => {
  const moved = startPos.filter((s) => Math.hypot(s.v.pos.x - s.x, s.v.pos.z - s.z) > 10).length;
  assert(moved >= 6, `seulement ${moved} véhicules ont bougé`);
});
check('des PNJ sont visibles et marchent à 9h30', () => {
  const st = peds.stats();
  assert(st.visible >= 5, `visibles=${st.visible}`);
});
check('une mission de livraison est active', () => assert.notEqual(missions.phase, 'none'));

console.log('— Mission de bout en bout —');
check('pickup -> deliver -> paiement', () => {
  const before = ctx.money;
  player.pos.set(missions.target.x, 0, missions.target.z);
  missions.update(dt, ctx);
  assert.equal(missions.phase, 'deliver');
  player.pos.set(missions.target.x, 0, missions.target.z);
  missions.update(dt, ctx);
  assert.equal(missions.phase, 'none');
  assert(ctx.money > before, 'le joueur doit être payé');
});

console.log('— Conduite joueur —');
check('entrer dans la sportive et accélérer à >25 km/h', () => {
  const gift = traffic.giftCar;
  player.pos.set(gift.pos.x + 2, 0, gift.pos.z);
  const near = traffic.nearestEnterable(player.pos, 6);
  assert(near === gift, 'la sportive doit être le véhicule le plus proche');
  traffic.playerTakeVehicle(gift);
  gift.inputs.throttle = 1;
  for (let f = 0; f < 90; f++) gift.update(dt, ctx);
  assert(gift.speedKmh() > 25, `vitesse=${gift.speedKmh().toFixed(0)} km/h`);
  traffic.playerLeaveVehicle(gift);
});

console.log('— Police —');
check('crimes répétés -> étoiles + poursuite spawnée', () => {
  for (let i = 0; i < 4; i++) Bus.emit('crime', { severity: 3, pos: player.pos });
  for (let f = 0; f < 60; f++) traffic.update(dt, ctx);
  assert(traffic.wanted >= 2, `wanted=${traffic.wanted}`);
  assert(traffic.police.length >= 1, 'au moins une voiture de police');
  traffic.clearWanted();
  assert.equal(traffic.wanted, 0);
});

console.log('— Météo —');
check('pluie : intensité monte et adhérence baisse', () => {
  env.setWeather('Rain');
  for (let f = 0; f < 600; f++) env.update(dt, ctx);
  assert(env.rainIntensity > 0.4, `rain=${env.rainIntensity}`);
  assert(env.gripFactor < 0.85, `grip=${env.gripFactor}`);
});
check('cycle jour/nuit : nuit profonde à 0h, jour à 12h', () => {
  env.hour = 0; env.update(dt, ctx);
  const night = env.nightFactor;
  env.hour = 12; env.update(dt, ctx);
  assert(night > 0.95 && env.nightFactor < 0.05, `nuit=${night} jour=${env.nightFactor}`);
});

console.log('— Sauvegarde —');
check('roundtrip sauvegarde versionnée', () => {
  SaveSystem.save({ money: 432, deliveries: 3, hour: 15.5, weather: 'Fog', x: 10, z: -20 });
  const d = SaveSystem.load();
  assert.equal(d.money, 432); assert.equal(d.v, 1);
  SaveSystem.clear();
  assert.equal(SaveSystem.load(), null);
});

console.log(`\n✅ SMOKE TEST : ${passed} vérifications réussies, 0 échec.`);
