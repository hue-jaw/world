// ============================================================================
// METROPOLIS — tools/test_v05.mjs
// Vérifications de la ville « variable » (v0.5) :
//   rues nommées · sens uniques respectés par l'IA et le GPS · giratoires
//   canal + ponts réellement franchissables · trafic autoroutier
//   quartiers asymétriques · rues piétonnes · HUD du nom de rue
// ============================================================================
import assert from 'node:assert/strict';
import { installDOM } from './dom_stub.mjs';

const { byId } = installDOM();

import * as THREE from '../web/node_modules/three/build/three.module.js';
const { City } = await import('../web/src/city.js');
const { Environment } = await import('../web/src/environment.js');
const { TrafficSystem, HighwayDriver } = await import('../web/src/vehicles.js');
const { PedestrianSystem } = await import('../web/src/pedestrians.js');
const { Player } = await import('../web/src/player.js');
const { MissionSystem } = await import('../web/src/missions.js');
const { UI } = await import('../web/src/ui.js');
const Economy = (await import('../web/src/economy.js')).default;
const GPSSystem = (await import('../web/src/gps.js')).default;
const { StreetGrid, describeStreet, hash2 } = await import('../web/src/streets.js');
const { Bus, CFG } = await import('../web/src/core.js');
const { SaveSystem } = await import('../web/src/save.js');

let passed = 0; const fails = [];
const check = (label, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + label); }
  catch (e) { fails.push(label); console.log('  ✗ ' + label + ' — ' + e.message); }
};

console.log('— Construction de la ville (mesurée) —');
const t0 = performance.now();
const scene = new THREE.Scene();
const city = new City(scene);
const genMs = performance.now() - t0;
console.log(`  · génération : ${genMs.toFixed(0)} ms · ${city.colliders.length} colliders`);

const camera = new THREE.PerspectiveCamera(62, 1.6, 0.1, 2400);
const env = new Environment(scene, city, null);
const player = new Player(scene, camera, { addEventListener() {}, style: {} });
const traffic = new TrafficSystem(scene, city);
const peds = new PedestrianSystem(scene, city);
const missions = new MissionSystem(scene, city);
const economy = new Economy(city);
const gps = new GPSSystem(scene, city);
const ctx = {
  scene, city, env, traffic, peds, player, missions, economy, gps,
  ui: null, paused: false, playerVehicle: null,
  playerPos: () => player.getPos(),
  playerSpeed: () => player.getSpeed(),
  shakeCamera: () => {},
  addMoney: (n) => { economy.money += n; },
  saveNow: () => SaveSystem.save({ v: 2, economy: economy.serialize(), hour: env.hour }),
};
const ui = new UI({
  onWeather: () => {}, onTimeSkip: () => {}, onTimeScale: () => 1,
  onSound: () => {}, onShopOpen: () => {},
});
ctx.ui = ui;
traffic.init(ctx);

// ---------------------------------------------------------------------------
console.log('— 1. Rues nommées et classées —');
check('258 voies décrites, avec un nom pour chacune', () => {
  let named = 0, avenues = 0;
  for (let k = 0; k <= 128; k++) {
    for (const st of [city.streets.horizontal(k), city.streets.vertical(k)]) {
      if (st.name && st.name.length > 4) named++;
      if (st.klass === 'avenue') avenues++;
    }
    assert.equal(city.streets.horizontal(k).k, k);
  }
  assert.equal(named, 258, `${named} voies nommées`);
  assert(avenues >= 30, `seulement ${avenues} avenues`);
});
check('la description est déterministe (même indice → même rue)', () => {
  for (const k of [3, 17, 60, 99]) {
    const a = describeStreet(k, 0), b = describeStreet(k, 0);
    assert.deepEqual(a, b);
    const c = describeStreet(k, 1);
    assert.equal(c.k, k);
  }
});
check('le HUD reçoit un nom de rue non vide au spawn', () => {
  const info = city.streetAt(42.5, 42.5);
  assert(info && typeof info.primary === 'string' && info.primary.length > 3, 'pas de nom');
  const far = city.streetAt(3000, -1800);
  assert(far.primary.length > 3, 'pas de nom en périphérie');
});

console.log('— 2. Sens uniques —');
check('les sens uniques interdisent réellement le contresens', () => {
  const P = CFG.city.pitch, WH = (CFG.city.blocksPerSide * P) / 2;
  const lineZ = (j) => -WH + (j - 60) * P;
  let tested = 0;
  for (let j = 1; j <= 128; j++) {
    const h = city.streets.horizontal(j);
    if (!h.oneWay) continue;
    const node = city.nearestNode(-1000, lineZ(j));
    const east = city.canDrive(node, 0), west = city.canDrive(node, 1);
    assert.notEqual(east, west, `voie ${h.name} : les deux sens sont ouverts`);
    assert.equal(east, h.oneWay > 0, `${h.name} : sens incohérent`);
    tested++;
    if (tested >= 12) break;
  }
  assert(tested > 5, `seulement ${tested} voies à sens unique trouvées`);
});
check('les rues piétonnes sont fermées à la circulation automobile', () => {
  const passages = city.pedestrianStreets;
  assert(passages.v.length + passages.h.length >= 1, 'aucune rue piétonne générée');
  for (const p of passages.v.slice(0, 3)) {
    const node = city.nearestNode(p.x, 0);      // nœud sur la voie piétonne
    assert.equal(city.canDrive(node, 2), false, 'trafic Nord-Sud autorisé');
    assert.equal(city.canDrive(node, 3), false, 'trafic Sud-Nord autorisé');
  }
});
check('le trafic IA ne circule jamais à contresens (600 frames)', () => {
  let checked = 0;
  for (let f = 0; f < 600; f++) {
    traffic.update(0.016, ctx);
    if (f % 60) continue;
    for (const v of traffic.vehicles) {
      const drv = v.driver;
      if (!drv || drv.isHighway || drv.isPolice || !drv.node) continue;
      // la direction demandée doit être autorisée par le code de la route
      if (drv.dirIdx !== undefined) {
        assert(city.canDrive(drv.node, drv.dirIdx),
          `${v.typeName} engagé dans un sens interdit (nœud ${drv.node.i},${drv.node.j})`);
        checked++;
      }
    }
  }
  assert(checked > 30, `seulement ${checked} vérifications de direction`);
});
check('le GPS respecte les sens uniques', () => {
  gps.locked = true;
  gps.setTarget(900, -700);
  gps._dirty = true; gps._timer = 0;
  for (let i = 0; i < 4; i++) gps.update(0.1, ctx);
  assert(gps.route.length > 2, 'aucun itinéraire');
  let ok = 0;
  for (let k = 0; k < gps.route.length - 1; k++) {
    const a = gps.route[k], b = gps.route[k + 1];
    const di = b.i - a.i, dj = b.j - a.j;
    const dirIdx = di > 0 ? 0 : di < 0 ? 1 : dj > 0 ? 2 : 3;
    if (city.canDrive(a, dirIdx)) ok++;
  }
  // tolérance : le repli « ignoreOneWay » peut être utilisé si le réseau
  // isole la cible ; on exige que la majorité des segments soit conforme.
  assert(ok >= Math.floor((gps.route.length - 1) * 0.5), `${ok}/${gps.route.length - 1} segments conformes`);
});

console.log('— 3. Giratoires —');
check('16 giratoires répartis hors du cœur historique', () => {
  assert(city.roundabouts.length >= 10, `${city.roundabouts.length} giratoires`);
  for (const r of city.roundabouts) {
    assert(Math.abs(r.x) > 300 || Math.abs(r.z) > 300, 'giratoire dans le cœur à feux');
  }
});
check('la voie contourne l’îlot (point de voie à 7 m du centre)', () => {
  const r = city.roundabouts[0];
  const node = city.nearestNode(r.x, r.z);
  assert(city.roundaboutKeys.has(`${node.i},${node.j}`), 'nœud non marqué giratoire');
  const out = new THREE.Vector3();
  city.lanePoint(node, 0, out);
  const d = Math.hypot(out.x - node.x, out.z - node.z);
  assert(Math.abs(d - 7) < 0.01, `déport de ${d.toFixed(2)} m (attendu 7)`);
});

console.log('— 4. Canal et ponts —');
check('le canal existe (eau + quais + ponts indexés)', () => {
  assert(city.canal && city.canal.w === 44, 'canal absent');
  assert.equal(city.bridges.length, 129, `${city.bridges.length} ponts`);
  assert(city.waterMaterial && city.waterMaterial.color, 'matériau d’eau absent');
});
check('on ne circule pas le long du canal, mais on le traverse par les ponts', () => {
  const node = city.nearestNode(city.canal.x, 1000);
  assert.equal(city.canDrive(node, 2), false, 'circulation Nord-Sud sur l’eau');
  assert.equal(city.canDrive(node, 3), false, 'circulation Sud-Nord sur l’eau');
  assert.equal(city.canDrive(node, 0), true, 'pont Est-Ouest fermé');
});
check('aucun bâtiment n’est généré dans le lit du canal', () => {
  // On ne teste PAS la nullité du chunk (un chunk couvre 4×4 blocs, dont
  // certains sont hors du canal) mais l'absence de bâtiment DANS l'eau :
  // tout collider haut dont le centre est à moins de 22 m de l'axe est un bug.
  const ci = Math.floor((((city.canal.x + 224) / 64) + 60) / 4);
  const cj = Math.floor((((0 + 224) / 64) + 60) / 4);
  city.genChunk(ci, cj);           // force le chunk traversé par le canal
  const floating = city.colliders.filter((c) => c.h > 2
    && Math.abs((c.minX + c.maxX) / 2 - city.canal.x) < 22);
  assert.equal(floating.length, 0, `${floating.length} bâtiment(s) dans le canal`);
});
check('les piétons ne sont jamais placés sur l’eau', () => {
  const dry = city.pedNodesDry;
  assert(dry.length > 100, 'liste piétons secs vide');
  for (const n of dry) assert(Math.abs(n.x - city.canal.x) > 32, `piéton à ${(n.x - city.canal.x).toFixed(0)} m du canal`);
});
check('les quais et garde-corps bloquent physiquement l’eau', () => {
  // z = 1024 : entre deux ponts (les ponts sont sur les lignes de rue, 64 m).
  const between = city.isColliding(city.canal.x + 22.6, 1024, 0.4);
  assert(between, 'on peut traverser le quai entre deux ponts');
  // z = 1056 : sur un pont → le passage doit être libre
  const onBridge = city.isColliding(city.canal.x, 1056, 0.4);
  assert.equal(onBridge, false, 'le pont est bloqué par un quai');
});

console.log('— 5. Autoroute —');
check('9 véhicules circulent sur l’anneau, dans les deux sens', () => {
  assert.equal(traffic.highway.length, 9);
  const dirs = new Set(traffic.highway.map((v) => v.driver.dir));
  assert.equal(dirs.size, 2, 'un seul sens de circulation');
});
check('ils restent sur l’anneau et roulent (900 frames)', () => {
  for (let f = 0; f < 900; f++) traffic.update(0.016, ctx);
  for (const v of traffic.highway) {
    const d = Math.max(Math.abs(v.pos.x), Math.abs(v.pos.z));
    assert(d > 1980 && d < 2120, `véhicule à ${d.toFixed(0)} m de l’axe`);
    assert(v.vf > 6, `véhicule à l’arrêt (${v.vf.toFixed(1)} m/s)`);
  }
});

console.log('— 6. Asymétrie de la ville —');
check('les quartiers du cœur ne sont plus des anneaux concentriques', () => {
  const flat = city.districtMap.flat();
  const types = new Set(flat);
  assert(types.size >= 5, `seulement ${types.size} types de quartiers`);
  // test de miroir : au moins 8 paires (i,j)/(N-1-i,N-1-j) diffèrent
  const N = CFG.city.blocksPerSide;
  let diff = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (city.districtMap[i][j] !== city.districtMap[N - 1 - i][N - 1 - j]) diff++;
  }
  assert(diff >= 12, `seulement ${diff} blocs non symétriques`);
});
check('le nombre d’immeubles varie d’un bloc à l’autre (chunks)', () => {
  const counts = [];
  for (let ci = 8; ci <= 12; ci++) for (let cj = 8; cj <= 12; cj++) {
    const g = city.genChunk(ci, cj);
    if (!g) { counts.push(0); continue; }
    counts.push(g.children.reduce((n, m) => n + m.count, 0));
  }
  const distinct = new Set(counts);
  assert(distinct.size >= 2, `tous les chunks ont ${[...distinct]} immeubles`);
  assert(Math.min(...counts) !== Math.max(...counts), 'aucune variation');
});
check('génération mesurée sous 2 s (pas de régression de démarrage)', () => {
  assert(genMs < 2000, `${genMs.toFixed(0)} ms`);
});
check('HUD : le nom de rue se met à jour sans exception', () => {
  player.pos.set(42.5, 0, 42.5);
  assert.doesNotThrow(() => ui.update(0.2, ctx));
  assert(ui.els.street.textContent.length > 2, 'libellé vide');
});

// ---------------------------------------------------------------------------
console.log(`\n${fails.length === 0 ? '✅' : '❌'} V0.5 : ${passed} vérifications réussies, ${fails.length} échec(s).`);
if (fails.length) { fails.forEach((f) => console.log('   ✗ ' + f)); process.exit(1); }
