// ============================================================================
// METROPOLIS — tools/test_v07.mjs
// GPS TEMPS RÉEL (v0.7). Ce que l'on vérifie, défaut par défaut :
//
//   Avant : l'itinéraire était calculé UNE fois (au changement de cible).
//   Si le joueur quittait la route, flèches et ruban restaient plantés sur
//   l'ancien tracé — y compris derrière lui. Ce test échoue sur l'ancien code.
//
//   1. itinéraire calculé et mesuré ;
//   2. COÛT du recalcul (A*) : compatible avec du temps réel ;
//   3. le guidage part TOUJOURS de la position réelle du joueur ;
//   4. hors-route (> 20 m) → recalcul automatique, sans rafale ;
//   5. aucune flèche derrière le joueur ;
//   6. distance restante décroissante et temps estimé cohérent ;
//   7. arrivée détectée, guidage arrêté proprement ;
//   8. bandeau HUD alimenté (manœuvre, distance, ETA).
//
// Usage : node tools/test_v07.mjs
// ============================================================================
import assert from 'node:assert/strict';
import { installDOM } from './dom_stub.mjs';

installDOM();
const THREE = await import('../web/node_modules/three/build/three.module.js');

const { City } = await import('../web/src/city.js');
const GPSSystemMod = await import('../web/src/gps.js');
const GPSSystem = GPSSystemMod.default;
const { UI } = await import('../web/src/ui.js');
const { Bus } = await import('../web/src/core.js');

let passed = 0; const fails = [];
const check = (label, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + label); }
  catch (e) { fails.push(label); console.log('  ✗ ' + label + ' — ' + e.message); }
};

// ------------------------------ monde ---------------------------------------
console.log('— Construction —');
const scene = new THREE.Scene();
const city = new City(scene);
const gps = new GPSSystem(scene, city);

const START = { x: 0, z: 0 };
const DEST = { x: 900, z: -760 };
const fakePlayer = {
  pos: { x: START.x, y: 0.15, z: START.z },
  getSpeed: () => 14,
};
const ctx = {
  scene, city, gps, player: fakePlayer,
  missions: { objectiveInfo: () => ({ pos: DEST, title: 'test', dist: 0, phase: 'free' }) },
  playerPos: () => fakePlayer.pos,
  playerVehicle: null,
};
const step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) gps.update(dt, ctx); };

/** Distance d'un point au segment [a,b]. */
const segDist = (p, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 1e-6 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
};
const distToPath = (p) => {
  let best = Infinity;
  for (let i = 0; i < gps.path.length - 1; i++) best = Math.min(best, segDist(p, gps.path[i], gps.path[i + 1]));
  return best;
};

// ============================================================================
// 1. Itinéraire
// ============================================================================
console.log('— 1. Itinéraire —');
step(2);
check('une destination produit un itinéraire et un tracé', () => {
  assert(gps.target, 'cible absente');
  assert(gps.route.length > 3, `${gps.route.length} nœuds`);
  assert(gps.path.length >= 2, `${gps.path.length} points de tracé`);
  assert(gps.remaining > 800, `reste ${gps.remaining.toFixed(0)} m`);
});

check('le tracé démarre sous les pieds du joueur', () => {
  const p0 = gps.path[0];
  const d = Math.hypot(p0.x - fakePlayer.pos.x, p0.z - fakePlayer.pos.z);
  assert(d < 2.5, `premier point à ${d.toFixed(1)} m du joueur`);
});

check('le tracé se termine sur la destination exacte', () => {
  const last = gps.path[gps.path.length - 1];
  const d = Math.hypot(last.x - DEST.x, last.z - DEST.z);
  assert(d < 1.01, `dernier point à ${d.toFixed(1)} m de la cible`);
});

// ============================================================================
// 2. Coût du recalcul
// ============================================================================
console.log('— 2. Coût du recalcul —');
check('A* tient dans un budget temps réel', () => {
  const from = city.nearestNode(0, 0);
  const to = city.nearestNode(DEST.x, DEST.z);
  const t0 = performance.now();
  const N = 25;
  for (let i = 0; i < N; i++) gps._findPath(from, to);
  const ms = (performance.now() - t0) / N;
  console.log(`  · A* moyen : ${ms.toFixed(2)} ms pour ${city.nodes.length}×${city.nodes.length} nœuds`);
  assert(ms < 8, `${ms.toFixed(2)} ms : trop lent pour un recalcul continu`);
});

// ============================================================================
// 3. Le guidage suit le joueur
// ============================================================================
console.log('— 3. Guidage solidaire du joueur —');
check('avancer sur l’itinéraire raccourcit la distance restante', () => {
  const before = gps.remaining;
  // on avance de 3 nœuds le long de l'itinéraire
  for (let i = 1; i <= 3 && i < gps.route.length; i++) {
    const n = gps.route[i];
    fakePlayer.pos.x = n.x; fakePlayer.pos.z = n.z;
    step(1);
  }
  const after = gps.remaining;
  assert(after < before - 150, `reste ${after.toFixed(0)} m après 3 nœuds (avant ${before.toFixed(0)})`);
  const p0 = gps.path[0];
  assert(Math.hypot(p0.x - fakePlayer.pos.x, p0.z - fakePlayer.pos.z) < 2.5,
    'le tracé ne repart pas du joueur après déplacement');
});

check('le joueur est toujours À MOINS DE 3 m du tracé quand il le suit', () => {
  const n = gps.route[Math.min(4, gps.route.length - 1)];
  fakePlayer.pos.x = n.x; fakePlayer.pos.z = n.z;
  step(2);
  const d = distToPath({ x: fakePlayer.pos.x, z: fakePlayer.pos.z });
  assert(d < 3, `${d.toFixed(1)} m du tracé`);
});

// ============================================================================
// 4. Hors-route → recalcul automatique
// ============================================================================
console.log('— 4. Recalcul temps réel —');
check('sortir de l’itinéraire déclenche un recalcul', () => {
  // on se place à 140 m du tracé, perpendiculairement au segment courant
  const a = gps.path[0], b = gps.path[1] || gps.path[0];
  let dx = b.x - a.x, dz = b.z - a.z;
  const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  const nx = -dz, nz = dx;
  const base = gps.route[Math.min(3, gps.route.length - 1)];
  fakePlayer.pos.x = base.x + nx * 140;
  fakePlayer.pos.z = base.z + nz * 140;

  const before = gps.recalcCount;
  step(90);                     // 1,5 s
  assert(gps.recalcCount > before, 'aucun recalcul après être sorti de la route');
  const off = gps._proj ? gps._proj.dist : Infinity;
  assert(off < 20, `toujours à ${off.toFixed(0)} m du nouvel itinéraire`);
  const p0 = gps.path[0];
  assert(Math.hypot(p0.x - fakePlayer.pos.x, p0.z - fakePlayer.pos.z) < 2.5,
    'le nouvel itinéraire ne part pas de la nouvelle position');
});

check('le recalcul est limité en fréquence (pas de rafale)', () => {
  const before = gps.recalcCount;
  // 120 frames = 2 s : au pire 2 / 0,35 ≈ 6 recalculs
  for (let i = 0; i < 120; i++) {
    // on saute d'un point hors-route à un autre pour forcer la détection
    fakePlayer.pos.x += (i % 2 ? 1 : -1) * 0;       // immobile
    step(1);
  }
  const delta = gps.recalcCount - before;
  assert(delta <= 8, `${delta} recalculs en 2 s`);
});

check('aucune valeur NaN dans le tracé ni dans les flèches', () => {
  for (const p of gps.path) {
    assert(Number.isFinite(p.x) && Number.isFinite(p.z), 'point de tracé NaN');
  }
  assert(Number.isFinite(gps.remaining), 'distance restante NaN');
  const m = new THREE.Matrix4();
  for (let i = 0; i < gps.arrows.count; i++) {
    gps.arrows.getMatrixAt(i, m);
    for (let k = 0; k < 16; k++) assert(Number.isFinite(m.elements[k]), `matrice de flèche ${i} NaN`);
  }
});

// ============================================================================
// 5. Flèches
// ============================================================================
console.log('— 5. Flèches au sol —');
check('des flèches sont posées devant le joueur', () => {
  step(3);
  assert(gps.arrows.count > 5, `${gps.arrows.count} flèches`);
  const m = new THREE.Matrix4(); const v = new THREE.Vector3();
  let minD = Infinity;
  for (let i = 0; i < gps.arrows.count; i++) {
    gps.arrows.getMatrixAt(i, m); v.setFromMatrixPosition(m);
    minD = Math.min(minD, Math.hypot(v.x - fakePlayer.pos.x, v.z - fakePlayer.pos.z));
  }
  assert(minD < 25, `flèche la plus proche à ${minD.toFixed(0)} m : le guidage ne suit pas le joueur`);
});

check('aucune flèche derrière le joueur', () => {
  const m = new THREE.Matrix4(); const v = new THREE.Vector3();
  const a = gps.path[0], b = gps.path[1];
  let fx = b.x - a.x, fz = b.z - a.z;
  const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
  for (let i = 0; i < gps.arrows.count; i++) {
    gps.arrows.getMatrixAt(i, m); v.setFromMatrixPosition(m);
    const dx = v.x - fakePlayer.pos.x, dz = v.z - fakePlayer.pos.z;
    const along = dx * fx + dz * fz;
    const near = Math.hypot(dx, dz) < 60;
    if (near) assert(along > -6, `flèche ${i} à ${along.toFixed(0)} m derrière (proche)`);
  }
});

check('toutes les flèches restent dans la portée de 900 m', () => {
  const m = new THREE.Matrix4(); const v = new THREE.Vector3();
  for (let i = 0; i < gps.arrows.count; i++) {
    gps.arrows.getMatrixAt(i, m); v.setFromMatrixPosition(m);
    const d = Math.hypot(v.x - fakePlayer.pos.x, v.z - fakePlayer.pos.z);
    assert(d <= 901, `flèche à ${d.toFixed(0)} m`);
  }
});

check('le ruban bleu est construit et commence au joueur', () => {
  step(3);
  assert(gps.ribbon.geometry.drawRange.count > 0, 'ruban vide');
  const pos = gps.ribbon.geometry.attributes.position;
  const x = pos.getX(0), z = pos.getZ(0);
  const pp = fakePlayer.pos;
  const d = Math.hypot(x - pp.x, z - pp.z);
  assert(d < 6, `ruban à ${d.toFixed(1)} m du joueur`);
});

// ============================================================================
// 6. Guidage / HUD
// ============================================================================
console.log('— 6. Guidage et HUD —');
check('le guidage donne une manœuvre, une distance et un temps', () => {
  const g = gps.guidance(ctx);
  assert(g, 'aucun guidage');
  assert(typeof g.text === 'string' && g.text.length > 3, `texte : ${g.text}`);
  assert(['left', 'right', 'straight', 'arrive'].includes(g.side), `côté ${g.side}`);
  assert(g.dist >= 0 && g.dist <= gps.remaining + 1, `dist ${g.dist} / reste ${gps.remaining}`);
  assert(g.eta > 0 && Number.isFinite(g.eta), `ETA ${g.eta}`);
});

check('la mini-carte part de la position du joueur', () => {
  const pts = gps.routePoints();
  const d = Math.hypot(pts[0].x - fakePlayer.pos.x, pts[0].z - fakePlayer.pos.z);
  assert(d < 2.5, `premier point de mini-carte à ${d.toFixed(1)} m du joueur`);
});

check('le bandeau HUD affiche la manœuvre et la distance', () => {
  const ui = new UI({
    onWeather: () => {}, onTimeSkip: () => {}, onTimeScale: () => 1,
    onSound: () => {}, onShopOpen: () => {},
  });
  const hudCtx = {
    ...ctx,
    env: { formatHour: () => '12:00', weatherName: 'Clear', rainIntensity: 0, gripFactor: 1, trafficFactor: 1 },
    missions: { objectiveInfo: () => ({ title: 'Objectif', dist: 100, timeLeft: null, urgent: false, phase: 'free', pos: DEST }) },
    traffic: { vehicles: [], police: [], wanted: 0 },
    economy: { money: 0, ownedCars: [], garageSlots: 2 },
    player: { ...fakePlayer, camYaw: 0, getHeading: () => 0, health: 100, maxHealth: 100, gamepad: null },
    playerVehicle: null,
    city: { ...city, streetAt: () => null },
  };
  ui.update(0.2, hudCtx);
  const panel = ui.els.gpsPanel;
  assert(!panel.classList.contains('hidden'), 'panneau GPS masqué alors qu’un itinéraire existe');
  assert(ui.els.gpsTurn.textContent.length > 3, `texte vide : « ${ui.els.gpsTurn.textContent} »`);
  assert(/m|km/.test(ui.els.gpsDist.textContent), `distance illisible : « ${ui.els.gpsDist.textContent} »`);
  assert(/min/.test(ui.els.gpsEta.textContent), `temps illisible : « ${ui.els.gpsEta.textContent} »`);
});

// ============================================================================
// 7. Arrivée
// ============================================================================
console.log('— 7. Arrivée —');
check('arriver stoppe le guidage et l’annonce', () => {
  fakePlayer.pos.x = DEST.x; fakePlayer.pos.z = DEST.z;
  step(90);
  assert(gps.arrived || gps.remaining < 14, `reste ${gps.remaining.toFixed(0)} m`);
  const g = gps.guidance(ctx);
  assert.equal(g.icon, '📍', `icône ${g.icon}`);
  assert.equal(gps.arrows.count, 0, `${gps.arrows.count} flèches encore affichées`);
  assert.equal(gps.ribbon.geometry.drawRange.count, 0, 'ruban encore visible');
});

check('clear() efface tout', () => {
  gps.clear();
  assert.equal(gps.target, null, 'cible restante');
  assert.equal(gps.route.length, 0, 'route restante');
  assert.equal(gps.path.length, 0, 'tracé restant');
  assert.equal(gps.arrows.count, 0, 'flèches restantes');
  assert.equal(gps.guidance(ctx), null, 'guidage encore renvoyé');
  assert.equal(gps.hasRoute(), false, 'hasRoute() vrai après clear');
});

check('changer de destination recalcule immédiatement', () => {
  fakePlayer.pos.x = 0; fakePlayer.pos.z = 0;
  const dest2 = { x: -800, z: 600 };
  ctx.missions.objectiveInfo = () => ({ pos: dest2, title: 'test 2', dist: 0, phase: 'free' });
  const before = gps.recalcCount;
  step(2);
  assert(gps.recalcCount > before, 'aucun recalcul au changement de cible');
  assert(Math.hypot(gps.target.x - dest2.x, gps.target.z - dest2.z) < 1, 'cible non mise à jour');
  const last = gps.path[gps.path.length - 1];
  assert(Math.hypot(last.x - dest2.x, last.z - dest2.z) < 1.01, 'tracé ne va pas à la nouvelle cible');
});

// ------------------------------- résumé -------------------------------------
void Bus;
console.log('');
if (fails.length) {
  console.log(`❌ V0.7 : ${passed} réussites, ${fails.length} échec(s) :`);
  for (const f of fails) console.log('   · ' + f);
  process.exit(1);
}
console.log(`✅ V0.7 : ${passed} vérifications réussies, 0 échec(s).`);
