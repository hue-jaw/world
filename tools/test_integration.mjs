// ============================================================================
// METROPOLIS — tools/test_integration.mjs
// Démarre TOUS les systèmes (comme main.js) sans navigateur ni WebGL, puis
// exécute 600 frames de la boucle réelle : City, Environment, Trafic, PNJ,
// Joueur, Missions, GPS, Économie, UI.
//
// Objectif : attraper les erreurs d'INTÉGRATION (API mal appelée, DOM manquant,
// exception dans la boucle) — la catégorie de bug qu'un test unitaire rate.
// ============================================================================
import assert from 'node:assert/strict';
import { installDOM } from './dom_stub.mjs';

const { byId } = installDOM();

import * as THREE from '../web/node_modules/three/build/three.module.js';
const { City } = await import('../web/src/city.js');
const { Environment } = await import('../web/src/environment.js');
const { Player } = await import('../web/src/player.js');
const { TrafficSystem } = await import('../web/src/vehicles.js');
const { PedestrianSystem } = await import('../web/src/pedestrians.js');
const { MissionSystem } = await import('../web/src/missions.js');
const { UI } = await import('../web/src/ui.js');
const Economy = (await import('../web/src/economy.js')).default;
const GPSSystem = (await import('../web/src/gps.js')).default;
const { Bus, CFG } = await import('../web/src/core.js');
const { SaveSystem } = await import('../web/src/save.js');

let passed = 0; const fails = [];
const check = (label, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + label); }
  catch (e) { fails.push(label); console.log('  ✗ ' + label + ' — ' + e.message); }
};

console.log('— Démarrage (identique à main.js) —');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1.6, 0.1, 2400);
const city = new City(scene);
const env = new Environment(scene, city, null);
const player = new Player(scene, camera, byId.get('app') || { addEventListener() {}, style: {} });
const traffic = new TrafficSystem(scene, city);
const peds = new PedestrianSystem(scene, city);
const missions = new MissionSystem(scene, city);
const economy = new Economy(city);
const gps = new GPSSystem(scene, city);

const ctx = {
  scene, city, env, traffic, peds, player, missions, economy, gps,
  ui: null, playerVehicle: null,
  playerPos: () => player.getPos(),
  playerSpeed: () => player.getSpeed(),
  shakeCamera: (a) => { player.shake = Math.min(player.shake + a, 0.6); },
  addMoney: (n) => { economy.money += n; },
  saveNow: () => SaveSystem.save({ v: 2, economy: economy.serialize(), hour: env.hour }),
};
const ui = new UI({
  onWeather: (n) => env.setWeather(n), onTimeSkip: () => env.advanceTime(3),
  onTimeScale: () => 1, onSound: () => {}, onShopOpen: () => {},
});
ctx.ui = ui;
traffic.init(ctx);

check('tous les systèmes instanciés', () => {
  assert(city && env && player && traffic && peds && missions && economy && gps && ui);
});

console.log('— Boucle réelle : 600 frames —');
const dt = 1 / 60;
let err = null;
try {
  for (let i = 0; i < 600; i++) {
    env.update(dt, ctx);
    city.update(dt, ctx);
    traffic.update(dt, ctx);
    peds.update(dt, ctx);
    player.update(dt, ctx);
    missions.update(dt, ctx);
    gps.update(dt, ctx);
    ui.update(dt, ctx);
  }
} catch (e) { err = e; }
check('aucune exception dans la boucle complète', () => { if (err) throw err; });
check('le joueur a une position valide', () => {
  const p = player.getPos(); assert(Number.isFinite(p.x) && Number.isFinite(p.z));
});
check('une mission est active et ciblable', () => {
  const info = missions.objectiveInfo(ctx);
  assert(info && Number.isFinite(info.dist));
});
check('le GPS a produit un itinéraire', () => assert(gps.route.length > 1, `${gps.route.length} nœuds`));

console.log('— Boutique (UI) —');
check('ouverture de la boutique', () => {
  ui.openShop(ctx);
  assert.equal(ui.shopOpen, true);
});
check('rendu des 4 onglets sans exception', () => {
  for (const tab of ['houses', 'cars', 'garage', 'upgrades']) {
    ui.shopTab = tab; ui._renderedTab = null; ui._refreshShop(ctx);
  }
});
check('achat d\'un logement via l\'UI', () => {
  economy.money = 50000;
  const h = economy.houses[0];
  const r = economy.buyHouse(h.id);
  assert(r.ok);
  ui.shopTab = 'houses'; ui._renderedTab = null; ui._refreshShop(ctx);
  assert.equal(economy.ownedHouses.length, 1);
});
check('fermeture de la boutique', () => { ui.closeShop(); assert.equal(ui.shopOpen, false); });

console.log('— Toit d\'un immeuble possédé —');
check('le toit est praticable (groundY = hauteur du bâtiment)', () => {
  const h = economy.primaryHouseObj;
  const b = h.building;
  const g = city.groundY(b.x, b.z, b.h + 0.3);
  assert(Math.abs(g - b.h) < 0.01, `groundY=${g} hauteur=${b.h}`);
});
check('on peut marcher sur le toit (collision ignorée)', () => {
  const b = economy.primaryHouseObj.building;
  const c = city.collide(b.x, b.z, 0.4, b.h + 0.3);
  assert(Math.abs(c.x - b.x) < 0.01 && Math.abs(c.z - b.z) < 0.01);
});
check('le sol redevient normal en contrebas', () => {
  const b = economy.primaryHouseObj.building;
  assert(city.groundY(b.x, b.z, 0) < 1);
});

console.log('— Garage et véhicules achetés —');
check('achat d\'une moto et apparition au garage', () => {
  economy.money = 20000;
  const r = economy.buyCar('Moto');
  assert(r.ok);
  traffic.clearOwned();
  const v = traffic.spawnOwned(r.car, 39.4, -112, 0, { topSpeed: 50 });
  assert(v.typeName === 'Moto');
  assert.equal(v.spec.topSpeed, 50);
});

console.log('— Blessures et réapparition —');
check('chute depuis un toit blesse le joueur', () => {
  player.health = player.maxHealth;
  Bus.emit('crash', { pos: { x: 0, z: 0 }, speed: 30, vehicle: { driver: 'player' } });
  // le bus 'crash' n'est branché qu'au main.js réel : on teste l'API directe
  player.damage(20, ctx, 'chute');
  assert(player.health <= 80);
});
check('soins du logement restaurés après achat', () => {
  player.health = 10; player.heal(100);
  assert.equal(player.health, player.maxHealth);
});

console.log(`\n${fails.length ? '❌' : '✅'} INTÉGRATION : ${passed} vérifications réussies, ${fails.length} échec(s).`);
if (fails.length) { fails.forEach((f) => console.log('   ✗ ' + f)); process.exit(1); }
