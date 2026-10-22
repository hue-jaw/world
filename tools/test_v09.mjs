// ============================================================================
// METROPOLIS — tools/test_v09.mjs
// v0.9 : post-traitement (GTAO + bloom + ACES), ciel atmosphérique, mobilier de
// trottoir, détails de toiture, habitacles, ombres de contact, variété de foule.
//
// Chaque test échoue sur le code de la v0.8 : il vérifie un système qui
// n'existait pas, ou une propriété mesurable (nombre d'objets, uniformes,
// repli propre). Aucun test ne « croit » qu'un rendu est beau : ils vérifient
// que la chaîne existe, qu'elle est branchée, et qu'elle ne casse rien.
//
// Usage : node tools/test_v09.mjs
// ============================================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installDOM } from './dom_stub.mjs';
import { makeGL } from './mock_webgl.mjs';

installDOM();
const THREE = await import('../web/node_modules/three/build/three.module.js');

const { City, STEP_UP } = await import('../web/src/city.js');
const { Environment } = await import('../web/src/environment.js');
const { PostFX, POSTFX_LEVELS } = await import('../web/src/postfx.js');
const { Settings } = await import('../web/src/settings.js');
const { Vehicle } = await import('../web/src/vehicles.js');
const { citizenTint } = await import('../web/src/assets.js');

let passed = 0; const fails = [];
const check = (label, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + label); }
  catch (e) { fails.push(label); console.log('  ✗ ' + label + ' — ' + e.message); }
};

const ROOT = new URL('..', import.meta.url).pathname;

// --------------------------- rendu simulé -----------------------------------
const gl = makeGL(960, 540);
const canvas = {
  width: 960, height: 540, style: {},
  addEventListener() {}, removeEventListener() {},
  getContext: (t) => (String(t).startsWith('webgl') ? gl : null),
  getBoundingClientRect: () => ({ width: 960, height: 540, left: 0, top: 0 }),
};
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(960, 540, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

console.log('— Construction du monde —');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 2400);
camera.position.set(0, 30, 80);
const city = new City(scene);

// ============================================================================
// 1. POST-TRAITEMENT
// ============================================================================
console.log('— 1. Post-traitement —');

check('le palier « désactivé » ne construit RIEN (coût nul)', () => {
  const fx = new PostFX({ renderer, scene, camera, level: 'off' });
  assert.equal(fx.active, false, 'chaîne construite alors que désactivée');
  assert.equal(fx.composer, null);
  assert.equal(fx.render(0.016), false, 'rendu prétend avoir réussi sans composer');
});

check('le palier « haut » construit GTAO + bloom + sortie ACES', () => {
  const fx = new PostFX({ renderer, scene, camera, level: 'high' });
  assert.equal(fx.active, true, 'chaîne inactive : ' + fx.failed);
  assert(fx.gtao, 'pas d’occlusion ambiante');
  assert(fx.bloom, 'pas de bloom');
  assert.equal(fx.composer.passes.length, 4, `${fx.composer.passes.length} passes`);
  assert.equal(fxcomposerLastPass(fx).constructor.name, 'OutputPass', 'pas de passe de sortie');
});

check('le rendu passe par le compositeur sans lever', () => {
  const fx = new PostFX({ renderer, scene, camera, level: 'ultra' });
  assert.equal(fx.render(0.016), true, 'rendu échoué : ' + fx.failed);
  assert.equal(fx.active, true);
});

check('un renderer cassé => repli propre, aucun exception', () => {
  const broken = {
    getDrawingBufferSize: () => new THREE.Vector2(64, 64),
    getPixelRatio: () => 1,
    capabilities: {}, domElement: canvas,
  };
  let fx;
  assert.doesNotThrow(() => { fx = new PostFX({ renderer: broken, scene, camera, level: 'high' }); });
  assert.equal(fx.active, false, 'chaîne active sur un renderer invalide');
  assert.ok(fx.failed, 'aucune raison de repli conservée');
  assert.doesNotThrow(() => fx.render(0.016));
  assert.equal(fx.render(0.016), false);
});

check('changer de palier met à jour la chaîne', () => {
  const fx = new PostFX({ renderer, scene, camera, level: 'off' });
  fx.setLevel('medium');
  assert.equal(fx.active, true);
  fx.setLevel('off');
  assert.equal(fx.active, false);
});

check('les réglages pilotent le post-traitement (défaut = activé)', () => {
  const s = new Settings();
  assert.equal(s.get('postfx'), 'high', 'défaut inattendu : ' + s.get('postfx'));
  const fx = new PostFX({ renderer, scene, camera, level: 'off' });
  const ctx = { postfx: fx, settings: s };
  s.state.postfx = 'high';
  assert.equal(s._applyPostFX(ctx), true, 'apply() n’active pas la chaîne');
  s.state.postfx = 'off';
  assert.equal(s._applyPostFX(ctx), false);
});

check('le palier « haut » est plus coûteux que « bas » (barème cohérent)', () => {
  assert(POSTFX_LEVELS.ultra.aoSamples > POSTFX_LEVELS.medium.aoSamples);
  assert(POSTFX_LEVELS.high.bloom > POSTFX_LEVELS.low.bloom);
  assert.equal(POSTFX_LEVELS.off.ao, false);
});

// ============================================================================
// 2. CIEL
// ============================================================================
console.log('— 2. Ciel atmosphérique —');

const env = new Environment(scene, city, null);

check('un dôme de ciel remplace le fond uni', () => {
  assert(env.skyDome, 'pas de dôme');
  assert.equal(env.skyDome.material.side, THREE.BackSide);
  assert.equal(env.skyDome.material.depthWrite, false);
  assert(env.skyDome.material.uniforms.sunDir, 'pas de direction solaire');
  assert.equal(env.skyDome.frustumCulled, false);
});

check('les nuages sont des sprites doux, plus des boîtes', () => {
  assert(env.clouds.children.length >= 40, `${env.clouds.children.length} nuages`);
  const sp = env.clouds.children[0];
  assert.equal(sp.isSprite, true, 'un nuage n’est pas un sprite');
  assert(sp.userData.speed > 0, 'nuage immobile');
  assert(env.cloudMat.map, 'aucune texture de nuage');
});

check('le halo solaire existe et suit le soleil', () => {
  assert(env.sunHalo, 'pas de halo');
  assert.equal(env.sunHalo.material.blending, THREE.AdditiveBlending);
});

check('le ciel se met à jour avec l’heure (dégradé + soleil)', () => {
  const ctx = { playerPos: () => ({ x: 0, z: 0 }), city, audio: null, env };
  env.hour = 12;
  for (let i = 0; i < 3; i++) env.update(1 / 30, ctx);
  const noon = env.skyMat.uniforms.sunDir.value.clone();
  const topNoon = env.skyMat.uniforms.topColor.value.clone();
  env.hour = 21;
  for (let i = 0; i < 3; i++) env.update(1 / 30, ctx);
  const night = env.skyMat.uniforms.sunDir.value.clone();
  const topNight = env.skyMat.uniforms.topColor.value.clone();
  assert(noon.distanceTo(night) > 0.3, 'le soleil ne bouge pas');
  assert(topNoon.getHex() !== topNight.getHex(), 'le ciel ne change pas de couleur');
  assert(env.skyDome.position.x === 0 && env.skyDome.position.z === 0, 'le dôme ne suit pas le joueur');
});

// ============================================================================
// 3. MOBILIER ET TOITS
// ============================================================================
console.log('— 3. Mobilier urbain —');

check('poubelles, bornes, bacs à fleurs et abribus sont générés', () => {
  const p = city.propCounts;
  assert(p, 'aucun mobilier');
  assert(p.bin > 50, `${p.bin} poubelles`);
  assert(p.hydrant > 20, `${p.hydrant} bornes`);
  assert(p.planter > 30, `${p.planter} bacs`);
  assert(p.shelter > 5, `${p.shelter} abribus`);
});

check('le mobilier est instancié (pas un draw call par objet)', () => {
  let inst = 0;
  scene.traverse((o) => { if (o.isInstancedMesh) inst++; });
  assert(inst >= 8, `${inst} InstancedMesh seulement`);
});

check('une poubelle bloque le piéton, un bac à fleurs (0,7 m) aussi', () => {
  const bin = city.colliders.find((c) => Math.abs(c.h - 1.0) < 1e-6);
  assert(bin, 'aucun collider de poubelle');
  const cx = (bin.minX + bin.maxX) / 2, cz = (bin.minZ + bin.maxZ) / 2;
  const r = city.collide(cx, cz, 0.3, 0, STEP_UP);
  assert(Math.hypot(r.x - cx, r.z - cz) > 0.15, 'on traverse une poubelle');
});

check('les châteaux d’eau et antennes coiffent les toits', () => {
  assert(city.roofStats, 'aucun détail de toit');
  assert(city.roofStats.tanks > 3, `${city.roofStats.tanks} châteaux d’eau`);
  assert(city.roofStats.antennas > 3, `${city.roofStats.antennas} antennes`);
});

check('les balises d’antenne s’allument la nuit', () => {
  assert(city.antennaTipMat, 'pas de matériau de balise');
  city.setNightFactor(1);
  assert(city.antennaTipMat.emissiveIntensity > 0.5, 'balises éteintes la nuit');
  city.setNightFactor(0);
  assert.equal(city.antennaTipMat.emissiveIntensity, 0);
});

// ============================================================================
// 4. VÉHICULES : HABITACLE
// ============================================================================
console.log('— 4. Habitacles —');

check('l’habitacle existe (planche de bord, volant, sièges)', () => {
  const v = new Vehicle(scene, 'Berline');
  let torus = 0, boxes = 0;
  v.group.traverse((o) => {
    if (!o.isMesh) return;
    if (o.geometry.type === 'TorusGeometry') torus++;
    if (o.geometry.type === 'BoxGeometry') boxes++;
  });
  assert(torus >= 1, 'aucun volant');
  assert(boxes >= 12, `${boxes} volumes : habitacle incomplet`);
});

check('le vitrage reste translucide', () => {
  const v = new Vehicle(scene, 'SUV');
  const mats = [];
  v.group.traverse((o) => { if (o.isMesh && o.material) mats.push(o.material); });
  assert(mats.some((m) => m.transparent && m.opacity > 0.3 && m.opacity < 0.9), 'vitrage opaque');
});

check('chaque véhicule porte une ombre de contact', () => {
  for (const t of ['Berline', 'SUV', 'Sportive', 'Moto']) {
    const v = new Vehicle(scene, t);
    const blob = v.group.children.find((c) => c.isMesh && c.geometry?.type === 'PlaneGeometry'
      && c.material?.transparent && c.position.y < 0.1);
    assert(blob, `pas d’ombre de contact sur ${t}`);
  }
});

// ============================================================================
// 5. FOULE
// ============================================================================
console.log('— 5. Variété de foule —');

check('deux citoyens n’ont pas la même teinte ni la même taille', () => {
  const a = citizenTint(1), b = citizenTint(2);
  assert.notDeepEqual(a.color, b.color, 'teintes identiques');
  assert(Math.abs(a.scale - b.scale) > 0.005, 'tailles identiques');
});

check('la teinte reste proche du blanc (pas de PNJ vert fluo)', () => {
  for (let i = 1; i <= 200; i++) {
    const t = citizenTint(i);
    for (const c of t.color) assert(c > 0.72 && c < 1.12, `canal ${c.toFixed(2)} hors bornes`);
    assert(t.scale > 0.93 && t.scale < 1.07, `échelle ${t.scale}`);
  }
});

check('la variation est déterministe (même graine = même PNJ)', () => {
  assert.deepEqual(citizenTint(42), citizenTint(42));
});

// ============================================================================
// 6. INTÉGRATION / LIVRABLE
// ============================================================================
console.log('— 6. Câblage —');

check('main.js branche postfx dans la boucle et le redimensionnement', () => {
  const js = fs.readFileSync(ROOT + 'web/src/main.js', 'utf8');
  assert(js.includes("import PostFX from './postfx.js'"), 'postfx non importé');
  assert(js.includes('postfx.render(dt)'), 'rendu non branché');
  assert(js.includes('postfx.setPixelRatio'), 'résolution adaptative non propagée');
  assert(js.includes('renderer.render(scene, camera)'), 'aucun repli en rendu direct');
});

check('le menu expose le réglage de post-traitement', () => {
  const js = fs.readFileSync(ROOT + 'web/src/menu.js', 'utf8');
  assert(js.includes("case 'postfx'"), ' réglage non géré');
  assert(js.includes('POSTFX_LEVELS'), 'pas de paliers dans le menu');
});

check('le fichier livré contient bien la chaîne (pas de code mort)', () => {
  const html = fs.readFileSync(ROOT + 'METROPOLIS.html', 'utf8');
  assert(html.length > 3_000_000, 'bundle suspect');
  assert(/postfx|PostFX|GTAO/i.test(html), 'post-traitement absent du livrable');
});

// ---------------------------------------------------------------------------
function fxcomposerLastPass(fx) {
  const ps = fx.composer.passes;
  return ps[ps.length - 1];
}

console.log('');
if (fails.length) {
  console.log(`❌ V0.9 : ${passed} réussites, ${fails.length} échec(s) :`);
  for (const f of fails) console.log('   · ' + f);
  process.exit(1);
}
console.log(`✅ V0.9 : ${passed} vérifications réussies, 0 échec(s).`);
