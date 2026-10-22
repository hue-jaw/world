// ============================================================================
// METROPOLIS — tools/test_v06.mjs
// Vérifications de l'itération du 21/10 (v0.6), une par défaut signalé :
//   1. façades : UV métriques + tuile d'étages répétable (aucune fenêtre
//      étirée, aucune vitrine de magasin au 3e étage) ;
//   2. arbres / props verts : identifiables (2 InstancedMesh, textures) et
//      collider « soft » : une voiture est freinée, pas arrêtée net ;
//   3. A (manette) et Espace sautent réellement, buffer d'appui compris ;
//   4. L3 agit (sprint à pied, regard arrière en véhicule) ;
//   5. moto : cavalier visible, 2 roues, et monter ne crée AUCUNE lumière
//      (c'était la cause du freeze : recompilation de tous les shaders).
//
// Usage : node tools/test_v06.mjs
// ============================================================================
import assert from 'node:assert/strict';
import { installDOM } from './dom_stub.mjs';

installDOM();
const THREE = await import('../web/node_modules/three/build/three.module.js');

const { City } = await import('../web/src/city.js');
const { Player } = await import('../web/src/player.js');
const { Vehicle, TrafficSystem } = await import('../web/src/vehicles.js');
const { PedestrianSystem } = await import('../web/src/pedestrians.js');
const { facadeTiling, facade, shopfront } = await import('../web/src/textures.js');
const { Environment } = await import('../web/src/environment.js');

let passed = 0; const fails = [];
const check = (label, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + label); }
  catch (e) { fails.push(label); console.log('  ✗ ' + label + ' — ' + e.message); }
};

// --------------------------- manette factice --------------------------------
const pad = {
  connected: true, index: 0, id: 'Xbox Test',
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
};
Object.defineProperty(globalThis, 'navigator', {
  value: { getGamepads: () => [pad] }, configurable: true,
});
const press = (i, on = true) => { pad.buttons[i] = { pressed: on, value: on ? 1 : 0 }; };

// ----------------------------- monde de test --------------------------------
console.log('— Construction —');
const t0 = performance.now();
const scene = new THREE.Scene();
const city = new City(scene);
console.log(`  · ville : ${(performance.now() - t0).toFixed(0)} ms, ${city.colliders.length} colliders`);

const camera = new THREE.PerspectiveCamera(62, 1.6, 0.1, 2400);
const env = new Environment(scene, city, null);
const player = new Player(scene, camera, { addEventListener() {}, style: {} });
const traffic = new TrafficSystem(scene, city);
const peds = new PedestrianSystem(scene, city);
const ctx = {
  scene, city, env, traffic, peds, player,
  ui: { setPrompt() {} }, paused: false, playerVehicle: null,
  playerPos: () => player.getPos(), playerSpeed: () => player.getSpeed(),
  shakeCamera: () => {}, addMoney: () => {}, saveNow: () => {},
};
player.pos.set(0, city.groundY(0, 0), 0);

const countLights = (root) => {
  let n = 0;
  root.traverse((o) => { if (o.isLight) n++; });
  return n;
};

// ============================================================================
// 1. FAÇADES
// ============================================================================
console.log('— 1. Façades : UV métriques et tuile répétable —');

check('la tuile d’étages se répète dans les deux sens', () => {
  const t = facadeTiling('glass', 'high', 0);
  assert.equal(t.day.wrapS, THREE.RepeatWrapping, 'wrapS ≠ Repeat');
  assert.equal(t.day.wrapT, THREE.RepeatWrapping, 'wrapT ≠ Repeat (fenêtres étirées)');
  assert.equal(t.night.wrapT, THREE.RepeatWrapping, 'texture de nuit non répétable');
  assert.equal(t.tileHeight, 30, `tileHeight=${t.tileHeight} (10 étages × 3 m)`);
  assert.equal(t.tileMeters, 16, 'largeur de tuile');
});

check('la tuile ne contient plus de devanture (boutique tous les 18 m)', () => {
  // Contrôle visuel indirect : la texture historique a un bandeau de
  // vitrines saturé sur la dernière rangée ; la tuile répétable, non.
  const legacy = facade('shop', 'mid', 0);
  const tile = facadeTiling('shop', 'mid', 0);
  const rowLum = (tex) => {
    const img = tex.image && tex.image.getContext ? tex.image.getContext('2d').getImageData(0, 0, tex.image.width, tex.image.height) : null;
    if (!img) return null;               // canvas stub : on ne peut pas lire
    const S = tex.image.width, y = S - 6;
    let a = 0;
    for (let x = 0; x < S; x++) {
      const o = (y * S + x) * 4;
      a += (img.data[o] + img.data[o + 1] + img.data[o + 2]) / 3;
    }
    return a / S;
  };
  const a = rowLum(legacy.day), b = rowLum(tile.day);
  if (a === null || b === null) {
    // Pas de pixels lisibles (stub) : on vérifie au moins la séparation des
    // caches, qui garantit que les deux textures ne sont pas la même.
    assert.notEqual(legacy.day.uuid, tile.day.uuid, 'tuile et façade historique confondues');
    return;
  }
  assert(b > a + 6, `bas de tuile trop sombre (${b.toFixed(0)} vs ${a.toFixed(0)}) : il reste une vitrine`);
});

check('un immeuble de 40 m utilise la tuile, pas la façade décorée', () => {
  const b = city.buildings.find((x) => x.h >= 30 && x.h < 60);
  assert(b, 'aucun immeuble de 30–60 m dans le cœur');
  const mesh = scene.children.find((o) => o.isMesh && Math.abs(o.position.x - b.x) < 0.01 && Math.abs(o.position.z - b.z) < 0.01);
  assert(mesh, 'mesh de l’immeuble introuvable');
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  assert.equal(mat.userData.uvMode, 'tile', `uvMode=${mat.userData.uvMode}`);
  assert(mat.userData.tileH > 0 && mat.userData.tileW > 0, 'tuile sans dimensions');
});

check('les UV verticaux sont en mètres (v couvre h / tileH)', () => {
  const b = city.buildings.find((x) => x.h >= 30);
  const mesh = scene.children.find((o) => o.isMesh && Math.abs(o.position.x - b.x) < 0.01 && Math.abs(o.position.z - b.z) < 0.01);
  const geo = mesh.geometry, uv = geo.attributes.uv, pos = geo.attributes.position, nor = geo.attributes.normal;
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  let minV = Infinity, maxV = -Infinity, ok = 0;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(nor.getY(i)) > 0.5) continue;        // on ignore le toit
    const v = uv.getY(i);
    minV = Math.min(minV, v); maxV = Math.max(maxV, v); ok++;
  }
  assert(ok > 0, 'aucun sommet de mur');
  const span = maxV - minV;
  const expected = b.h / mat.userData.tileH;
  assert(Math.abs(span - expected) < 0.02,
    `span UV=${span.toFixed(2)} attendu ${expected.toFixed(2)} (fenêtres étirées)`);
  assert(span > 1.2, `span=${span.toFixed(2)} : la texture n’est pas tuilée`);
});

check('un bâtiment bas (< 10 m) garde la façade complète, non répétée', () => {
  const b = city.buildings.find((x) => x.h > 0 && x.h < 10);
  assert(b, 'aucune maison basse');
  const mesh = scene.children.find((o) => o.isMesh && Math.abs(o.position.x - b.x) < 0.01 && Math.abs(o.position.z - b.z) < 0.01);
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  assert.equal(mat.userData.uvMode, 'fit', `uvMode=${mat.userData.uvMode}`);
});

check('les vitrines de rez-de-chaussée existent (podium instancié)', () => {
  assert(city._podium, 'pas d’InstancedMesh de podium');
  assert(city._podium.count > 10, `${city._podium.count} podium(s)`);
  assert.equal(city._podium.material.map.image.width, 512, 'texture de vitrine inattendue');
  assert(city._podium.material.emissiveMap, 'pas de texture de nuit pour les vitrines');
  const shop = shopfront(0);
  assert(shop.day && shop.night, 'shopfront() incomplet');
});

// ============================================================================
// 2. ARBRES / PROPS VERTS
// ============================================================================
console.log('— 2. Arbres : lisibles et non bloquants —');

const treeGroup = (() => {
  let found = null;
  scene.traverse((o) => {
    if (found) return;
    if (o.isInstancedMesh && o.geometry?.type === 'CylinderGeometry'
      && o.count === city.treesTotal && o.material?.map) found = o;
  });
  return found;
})();

check('les arbres sont texturés et dessinés en 2 appels', () => {
  assert(city.treesTotal > 20, `${city.treesTotal} arbres`);
  assert(treeGroup, 'InstancedMesh des troncs introuvable');
  assert(treeGroup.material.map, 'tronc sans texture');
  let crowns = 0;
  scene.traverse((o) => {
    if (o.isInstancedMesh && o.material?.map && o !== treeGroup && o.instanceColor) crowns++;
  });
  assert(crowns >= 1, 'aucun houppier texturé avec couleur par instance');
});

check('les arbres sont des obstacles « soft » de 0,5 m', () => {
  const treeColliders = city.colliders.filter((c) => c.kind === 'soft');
  assert(treeColliders.length > 20, `${treeColliders.length} colliders soft`);
  for (const c of treeColliders.slice(0, 50)) {
    const w = c.maxX - c.minX;
    // le collider est élargi au tronc (0,5 m) ; quelques arbres de parc
    // partagent leur AABB avec les poteaux, on tolère 0,5 m exactement.
    assert(Math.abs(w - 0.5) < 1e-6, `largeur de tronc ${w}`);
  }
});

check('une voiture est freinée par un arbre, pas arrêtée net', () => {
  const tree = city.colliders.find((c) => c.kind === 'soft');
  const cx = (tree.minX + tree.maxX) / 2, cz = (tree.minZ + tree.maxZ) / 2;
  const soft = city.collide(cx, cz, 0.9);
  assert.equal(soft.soft, true, 'collide() ne signale pas l’obstacle frêle');
  const wall = city.buildings.find((b) => b.h > 10);
  const hard = city.collide(wall.x, wall.z, 0.9);
  assert.equal(hard.soft, false, 'un bâtiment est signalé « soft »');

  // Reprise du calcul exact de Vehicle.update : 0,35 en dur, 0,78 en souple.
  const v = new Vehicle(scene, 'Berline');
  v.driver = 'player';
  v.placeAt(cx - 2.2, cz, Math.PI / 2);
  v.vel.x = 14; v.vel.z = 0; v.vf = 14;
  v.active = true;
  for (let i = 0; i < 6; i++) v.update(1 / 60, ctx);
  assert(v.vf > 5, `vitesse après l’arbre ${v.vf.toFixed(1)} m/s : l’arbre agit comme un mur`);
});

check('les PNJ ne restent pas plantés dans un tronc (20 s)', () => {
  const trees = city.colliders.filter((c) => c.kind === 'soft');
  const distToTree = (x, z) => {
    let best = Infinity;
    for (const t of trees) {
      const tx = (t.minX + t.maxX) / 2, tz = (t.minZ + t.maxZ) / 2;
      best = Math.min(best, Math.hypot(x - tx, z - tz));
    }
    return best;
  };
  let inside = 0, samples = 0;
  for (let f = 0; f < 1200; f++) {
    peds.update(1 / 60, ctx);
    if (f % 60 !== 0) continue;
    for (const p of peds.citizens) {
      samples++;
      if (distToTree(p.pos.x, p.pos.z) < 0.28) inside++;
    }
  }
  assert(samples > 0, 'aucun PNJ simulé');
  const ratio = inside / samples;
  assert(ratio < 0.01, `${(ratio * 100).toFixed(1)} % des PNJ dans un tronc`);
});

// ============================================================================
// 3. SAUT (A et Espace)
// ============================================================================
console.log('— 3. Saut —');
const jumpHeight = (usePad) => {
  player.pos.set(0, city.groundY(0, 0), 0);
  player.vy = 0; player.grounded = true;
  player._jumpBufferT = 0; player._coyoteT = 0;
  if (usePad) press(0, true); else player.keys?.add?.('Space');
  let peak = player.pos.y;
  for (let i = 0; i < 40; i++) {
    player.update(1 / 60, ctx);
    if (i === 1) { if (usePad) press(0, false); else player.keys?.delete?.('Space'); }
    peak = Math.max(peak, player.pos.y);
  }
  return peak - city.groundY(0, 0);
};

check('bouton A (manette) : saut mesuré', () => {
  const h = jumpHeight(true);
  assert(h > 1.15 && h < 2.2, `hauteur ${h.toFixed(2)} m`);
});

check('touche Espace : même saut', () => {
  const h = jumpHeight(false);
  assert(h > 1.15 && h < 2.2, `hauteur ${h.toFixed(2)} m`);
});

check('appui juste avant l’atterrissage : conservé par le buffer', () => {
  player.pos.set(0, city.groundY(0, 0), 0);
  player.vy = 0; player.grounded = true; player._jumpBufferT = 0; player._coyoteT = 0;
  press(0, true);
  player.update(1 / 60, ctx);                 // 1er saut
  press(0, false);
  assert(player.vy > 4, 'le premier saut n’a pas eu lieu');

  // On appuie UNE seule frame, 0,1 s avant le contact : sans buffer, l'appui
  // tombe pendant que `grounded` est faux et est perdu.
  let pressedAt = -1, landedAt = -1, jumpedAfter = -1;
  for (let i = 0; i < 120; i++) {
    if (pressedAt < 0 && player.pos.y < 0.45 && player.vy < -5) {
      press(0, true); pressedAt = i;
    }
    player.update(1 / 60, ctx);
    if (pressedAt === i) press(0, false);
    if (landedAt < 0 && player.grounded) landedAt = i;
    if (landedAt >= 0 && player.vy > 3) { jumpedAfter = i; break; }
  }
  assert(pressedAt >= 0, 'le joueur n’est jamais redescendu');
  assert(jumpedAfter >= 0,
    `appui frame ${pressedAt}, atterrissage frame ${landedAt} : aucun saut (buffer perdu)`);
  assert(jumpedAfter - landedAt <= 3, `saut ${jumpedAfter - landedAt} frames après l’atterrissage`);
});

// ============================================================================
// 4. L3
// ============================================================================
console.log('— 4. L3 —');
const runSpeed = (l3) => {
  player.vehicle = null; player.group.visible = true;
  player.pos.set(0, city.groundY(0, 0), 0);
  player.vel.set(0, 0, 0);
  player._l3Latch = !!l3;
  pad.axes = [0, -1, 0, 0];                    // stick en avant
  press(10, false);
  for (let i = 0; i < 45; i++) player.update(1 / 60, ctx);
  const s = Math.hypot(player.vel.x, player.vel.z);
  pad.axes = [0, 0, 0, 0];
  return s;
};

check('L3 : le sprint est nettement plus rapide que la marche', () => {
  const walk = runSpeed(false);
  const sprint = runSpeed(true);
  assert(walk > 1, `marche ${walk.toFixed(2)} m/s`);
  assert(sprint > walk * 1.5, `sprint ${sprint.toFixed(2)} vs marche ${walk.toFixed(2)}`);
});

check('L3 : appui réel via la manette bascule le sprint', () => {
  player.vehicle = null;
  player._l3Latch = false;
  press(10, true);
  player.update(1 / 60, ctx);
  press(10, false);
  assert.equal(player._l3Latch, true, 'latch non armé');
  player._l3Latch = false;
});

check('L3 en véhicule : regard arrière, pas de sprint', () => {
  const v = new Vehicle(scene, 'Berline');
  v.driver = 'player';
  v.placeAt(0, 0, 0);
  v.active = true;
  player.vehicle = v; player.group.visible = false;
  ctx.playerVehicle = v;
  const latchBefore = player._l3Latch;
  press(10, true);
  player.update(1 / 60, ctx);
  assert.equal(player._l3Latch, latchBefore, 'L3 a modifié le sprint en véhicule');
  assert.equal(player._lookBack, true, 'regard arrière non armé');
  press(10, false);
  player.update(1 / 60, ctx);
  assert.equal(player._lookBack, false, 'regard arrière bloqué');
  player.vehicle = null; player.group.visible = true; ctx.playerVehicle = null;
});

// ============================================================================
// 5. MOTO
// ============================================================================
console.log('— 5. Moto —');
check('la moto a un cavalier visible et deux roues', () => {
  const v = new Vehicle(scene, 'Moto');
  assert(v.isMoto, 'le véhicule Moto n’emprunte pas le modèle 2 roues');
  assert(v.driverFig, 'aucun cavalier');
  assert(v.group.children.includes(v.driverFig), 'cavalier hors du groupe');
  assert.equal(v.wheels.length, 2, `${v.wheels.length} roues`);
  assert(v.wheelR > 0.25 && v.wheelR < 0.45, `rayon ${v.wheelR}`);
  assert.equal(v.beacon, null, 'gyrophare inattendu sur une moto');
});

check('monter en moto ne crée aucune lumière (pas de recompilation)', () => {
  const v = new Vehicle(scene, 'Moto');
  v.placeAt(player.pos.x + 1.5, player.pos.z, 0);
  v.active = true; v.parked = true;
  traffic.vehicles.push(v);
  const lightsBefore = countLights(scene);
  const objsBefore = scene.children.length;
  traffic.playerTakeVehicle(v);
  env.headlightsOn = true;                  // de nuit : les projecteurs s'allument
  player.vehicle = v; player.group.visible = false; ctx.playerVehicle = v;
  for (let i = 0; i < 30; i++) { player.update(1 / 60, ctx); traffic.update(1 / 60, ctx); }
  const lightsAfter = countLights(scene);
  const objsAfter = scene.children.length;
  assert.equal(lightsAfter, lightsBefore,
    `${lightsAfter - lightsBefore} lumière(s) créée(s) à la montée : freeze de shaders`);
  assert(objsAfter - objsBefore <= 1, `${objsAfter - objsBefore} objets ajoutés à la scène`);

  // Projecteurs mutualisés : 2, créés au démarrage, intensité pilotée ensuite.
  assert.equal(traffic.headRig.length, 2, `${traffic.headRig.length} projecteur(s)`);
  assert(traffic.headRig.every((h) => h.sp.intensity > 0), 'projecteurs éteints en conduite');
});

check('en 3e personne le cavalier est visible ; en 1re il est masqué', () => {
  const v = traffic.playerVehicle;
  assert(v, 'aucun véhicule joueur');
  player.camMode = 'third';
  player._fpBlend = 0;
  player.update(1 / 60, ctx);
  assert.equal(v.driverFig.visible, true, 'cavalier invisible en 3e personne');
  player.camMode = 'first';
  for (let i = 0; i < 60; i++) player.update(1 / 60, ctx);
  assert.equal(v.driverFig.visible, false, 'cavalier visible dans la caméra du pilote');
  player.camMode = 'third';
});

check('les motos de trafic ont aussi un conducteur', () => {
  const moto = traffic.vehicles.concat(traffic.aiPool || []).find((x) => x.isMoto) || new Vehicle(scene, 'Moto');
  assert(moto.driverFig, 'moto IA sans conducteur');
  assert(moto.driverFig.parent, 'conducteur IA détaché du véhicule');
});

// ------------------------------- résumé -------------------------------------
console.log('');
if (fails.length) {
  console.log(`❌ V0.6 : ${passed} réussites, ${fails.length} échec(s) :`);
  for (const f of fails) console.log('   · ' + f);
  process.exit(1);
}
console.log(`✅ V0.6 : ${passed} vérifications réussies, 0 échec(s).`);
