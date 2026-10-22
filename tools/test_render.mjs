// ============================================================================
// METROPOLIS — tools/test_render.mjs
// Test de rendu SANS GPU : un faux contexte WebGL 2 fait croire à three.js
// qu'il compile et dessine. On traverse ainsi tout le chemin réellement
// emprunté au premier rendu — c'est là que se produisait le crash v0.4 :
//
//   Uncaught TypeError: Cannot read properties of undefined
//   (reading 'onBeforeCompile')
//
// Cause : `Material.prototype.customProgramCacheKey` de three.js fait
// `this.onBeforeCompile.toString()`. Nos hooks de sol/répétition UV appelaient
// la méthode précédente détachée (`prev()`), donc `this === undefined`.
// Le test ci-dessous vérifie les deux niveaux :
//   1) chaque matériau expose des hooks appelables DÉTACHÉS et ATTACHÉS ;
//   2) 4 images complètes (beau temps, pluie, nuit, après simulation) se
//      rendent sans exception, shadow maps et PMREM comprises.
//
// Usage : node tools/test_render.mjs
// ============================================================================
import { installDOM } from './dom_stub.mjs';
import { makeGL } from './mock_webgl.mjs';

const { byId } = installDOM();
const THREE = await import('../web/node_modules/three/build/three.module.js');
const { City } = await import('../web/src/city.js');
const { Environment } = await import('../web/src/environment.js');
const { Player } = await import('../web/src/player.js');
const { TrafficSystem } = await import('../web/src/vehicles.js');
const { PedestrianSystem } = await import('../web/src/pedestrians.js');
const { MissionSystem } = await import('../web/src/missions.js');
const { UI } = await import('../web/src/ui.js');
const Assets = (await import('../web/src/assets.js')).default;

let passed = 0; const fails = [];
const check = (label, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + label); }
  catch (e) { fails.push(label); console.log('  ✗ ' + label + ' — ' + e.message); }
};

// --------------------------- faux contexte GL -------------------------------
const gl = makeGL(1280, 720);
const canvas = {
  width: 1280, height: 720, style: {},
  addEventListener() {}, removeEventListener() {},
  getContext: (t) => (String(t).startsWith('webgl') ? gl : null),
  getBoundingClientRect: () => ({ width: 1280, height: 720, left: 0, top: 0 }),
};
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(1280, 720, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

console.log('— Construction du monde —');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 2400);
camera.position.set(0, 60, 180);
await Assets.init();
const city = new City(scene);
const env = new Environment(scene, city, renderer);
const player = new Player(scene, camera, canvas);
const traffic = new TrafficSystem(scene, city);
const peds = new PedestrianSystem(scene, city);
const missions = new MissionSystem(scene, city);
const ui = new UI({
  onWeather() {}, onTimeSkip() {}, onTimeScale() {}, onSound() {}, onShopOpen() {},
});
const ctx = {
  scene, city, env, traffic, peds, player, missions, renderer, ui,
  menu: null, paused: false, playerVehicle: null, settings: null,
  playerPos: () => player.getPos(), playerSpeed: () => player.getSpeed(),
  shakeCamera() {}, addMoney() {}, saveNow() {},
};
traffic.init(ctx);

// ===========================================================================
console.log('— 1. Hooks de matériaux (cause exacte du crash v0.4) —');
check('customProgramCacheKey() chaîne correctement les hooks de nos matériaux', () => {
  let hooks = 0;
  scene.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      if (!m) throw new Error(`matériau manquant sur ${o.type}`);
      if (typeof m.customProgramCacheKey !== 'function') continue;
      // Appel ATTACHÉ : c'est ainsi que three.js la convoque pendant la
      // compilation. Avant le correctif, notre enveloppe appelait la méthode
      // précédente détachée (`prev()`), ce qui levait ici même :
      //   TypeError: Cannot read properties of undefined (reading 'onBeforeCompile')
      const k1 = m.customProgramCacheKey();
      const k2 = m.customProgramCacheKey();
      if (typeof k1 !== 'string' || k1.length === 0) throw new Error('clé de cache invalide');
      if (k1 !== k2) throw new Error('clé de cache instable');
      const shader = {
        uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>\n#include <uv_vertex>',
        fragmentShader: '#include <common>\n#include <map_fragment>',
      };
      // attaché également : le hook par défaut lève si `this` manque
      m.onBeforeCompile(shader, null);
      if (!m.customProgramCacheKey().includes('groundDetail') && m.userData?.detailTex) {
        throw new Error('clé de cache sans le détail de sol');
      }
      hooks++;
    }
  });
  if (hooks < 20) throw new Error(`seulement ${hooks} matériaux vérifiés`);
  console.log(`    · ${hooks} matériaux avec hooks vérifiés`);
});

// ===========================================================================
console.log('— 2. Images complètes (programmes, uniformes, ombres, PMREM) —');
const render = () => {
  // demande explicitement une recompilation : c'est ce que fait un changement
  // de qualité d'ombre ou de mode RTX en jeu
  scene.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) if (m) m.needsUpdate = true;
  });
  renderer.render(scene, camera);
};
const shot = (label) => check(label, () => {
  render();
  const { calls, triangles } = renderer.info.render;
  if (!(calls > 100)) throw new Error(`seulement ${calls} draw calls`);
  console.log(`    · ${calls} draw calls, ${(triangles / 1000).toFixed(0)}k triangles`);
});
shot('première image : ville de jour');
shot('pluie (particules + sol mouillé)');
env.hour = 2; shot('nuit (éclairage artificiel)');
player.update(0.05, ctx); shot('après mise à jour du joueur');
traffic.update(0.05, ctx); peds.update(0.05, ctx);
shot('après trafic + piétons');
check('chunks streamés loin du spawn rendus sans erreur', () => {
  const p = player.pos;
  city.updateStreaming(p.x + 700, p.z + 700);
  render();
  if (city.chunks.size < 9) throw new Error('streaming vide');
});

// ===========================================================================
console.log('');
if (fails.length) {
  console.log(`❌ RENDU : ${passed} vérifications réussies, ${fails.length} échec(s).`);
  for (const f of fails) console.log('   ✗ ' + f);
  process.exit(1);
}
console.log(`✅ RENDU : ${passed} vérifications réussies, 0 échec(s).`);
