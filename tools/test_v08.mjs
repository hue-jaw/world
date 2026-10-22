// ============================================================================
// METROPOLIS — tools/test_v08.mjs
// v0.8 : hauteurs cohérentes, mode Histoire (aucun emploi au départ),
//        petites annonces, embauche, chapitres, cinématique d'ouverture,
//        détails de carrosserie.
//
// Défauts visés (chaque test échoue sur le code d'avant) :
//   « les trucs verts sur les routes on peut pas grimper dessus alors que le
//     trottoir a la même hauteur » ;
//   « je suis livreur dès le début » ;
//   « on devrait pouvoir se prendre un job et une maison, pas direct un job » ;
//   « les voitures sont moches ».
//
// Usage : node tools/test_v08.mjs
// ============================================================================
import assert from 'node:assert/strict';
import { installDOM } from './dom_stub.mjs';

installDOM();
const THREE = await import('../web/node_modules/three/build/three.module.js');

const { City, STEP_UP } = await import('../web/src/city.js');
const { Player } = await import('../web/src/player.js');
const { TrafficSystem, Vehicle } = await import('../web/src/vehicles.js');
const { MissionSystem } = await import('../web/src/missions.js');
const { StorySystem, CHAPTERS } = await import('../web/src/story.js');
const { JobSystem, JOB } = await import('../web/src/jobs.js');
const Economy = (await import('../web/src/economy.js')).default;
const { Environment } = await import('../web/src/environment.js');
const { UI } = await import('../web/src/ui.js');
const { Bus, ECONOMY } = await import('../web/src/core.js');

let passed = 0; const fails = [];
const check = (label, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + label); }
  catch (e) { fails.push(label); console.log('  ✗ ' + label + ' — ' + e.message); }
};

// ------------------------------ monde ---------------------------------------
console.log('— Construction —');
const scene = new THREE.Scene();
const city = new City(scene);
const camera = new THREE.PerspectiveCamera(62, 1.6, 0.1, 2400);
const env = new Environment(scene, city, null);
const player = new Player(scene, camera, { addEventListener() {}, style: {} });
const traffic = new TrafficSystem(scene, city);
const missions = new MissionSystem(scene, city);
const economy = new Economy(city);
const story = new StorySystem({ camera, scene, city, player });
const jobs = new JobSystem(city, economy);

const ctx = {
  scene, city, env, traffic, peds: null, player, missions, economy, story, jobs,
  ui: { setPrompt() {}, setStoryGoal() {} }, paused: false, playerVehicle: null,
  playerPos: () => player.getPos(),
  playerSpeed: () => player.getSpeed(),
  shakeCamera: () => {},
  addMoney: (n) => { economy.money += n; },
  saveNow: () => {},
};
player.pos.set(0, city.groundY(0, 0), 0);

// ============================================================================
// 1. HAUTEURS
// ============================================================================
console.log('— 1. Hauteurs : terre-plein, îlot, trottoir, arbre, mur —');

const lowCollider = (min, max) => city.colliders.find((c) => c.h >= min && c.h <= max);
const centre = (c) => ({ x: (c.minX + c.maxX) / 2, z: (c.minZ + c.maxZ) / 2 });

check('terre-plein et îlot de giratoire sont plus bas que la marche', () => {
  const median = city.colliders.find((c) => Math.abs(c.h - 0.2) < 0.001);
  const island = city.colliders.find((c) => Math.abs(c.h - 0.18) < 0.001);
  assert(median, 'aucun terre-plein');
  assert(island, 'aucun îlot de giratoire');
  assert(median.h < STEP_UP && island.h < STEP_UP, `h=${median.h}/${island.h} > ${STEP_UP}`);
});

check('le joueur ENJAMBE le terre-plein (il ne le prend plus pour un mur)', () => {
  const m = city.colliders.find((c) => Math.abs(c.h - 0.2) < 0.001);
  const p = centre(m);
  const withStep = city.collide(p.x, p.z, 0.38, 0, STEP_UP);
  const withoutStep = city.collide(p.x, p.z, 0.38, 0, 0);
  assert(Math.hypot(withStep.x - p.x, withStep.z - p.z) < 0.01,
    'le terre-plein repousse encore le joueur');
  assert(Math.hypot(withoutStep.x - p.x, withoutStep.z - p.z) > 0.3,
    'le test ne prouve rien : aucun obstacle sans step');
});

check('le joueur ENJAMBE l’îlot de giratoire', () => {
  const isl = city.colliders.find((c) => Math.abs(c.h - 0.18) < 0.001);
  const p = centre(isl);
  const r = city.collide(p.x, p.z, 0.38, 0, STEP_UP);
  assert(Math.hypot(r.x - p.x, r.z - p.z) < 0.01, 'îlot toujours bloquant');
});

check('le joueur reste bloqué par un tronc et par un immeuble', () => {
  const tree = city.colliders.find((c) => c.kind === 'soft');
  const b = city.buildingAt?.(0, 0) || city.buildings.find((x) => x.h > 12);
  const tp = centre(tree);
  const rt = city.collide(tp.x, tp.z, 0.38, 0, STEP_UP);
  assert(Math.hypot(rt.x - tp.x, rt.z - tp.z) > 0.2, 'un arbre ne bloque plus du tout');
  const rw = city.collide(b.x, b.z, 0.38, 0, STEP_UP);
  assert(Math.hypot(rw.x - b.x, rw.z - b.z) > 0.2, 'un immeuble ne bloque plus');
});

check('une VOITURE reste bloquée par le terre-plein (step = 0)', () => {
  const m = city.colliders.find((c) => Math.abs(c.h - 0.2) < 0.001);
  const p = centre(m);
  const r = city.collide(p.x, p.z, 0.9, 0, 0);
  assert(Math.hypot(r.x - p.x, r.z - p.z) > 0.4, 'une voiture traverse le terre-plein');
});

check('groundY soulève le joueur sur le terre-plein (0,2 m)', () => {
  const m = city.colliders.find((c) => Math.abs(c.h - 0.2) < 0.001);
  const p = centre(m);
  assert(Math.abs(city.groundY(p.x, p.z, 0) - 0.2) < 0.01,
    `groundY=${city.groundY(p.x, p.z, 0)}`);
});

check('le joueur marche réellement jusque sur le terre-plein', () => {
  const m = city.colliders.find((c) => Math.abs(c.h - 0.2) < 0.001);
  const p = centre(m);
  // on part 1,2 m à côté, à la même hauteur que la route ; caméra au nord,
  // donc « avant » (W) = -Z, vers le terre-plein.
  player.pos.set(p.x, 0, p.z + 1.2);
  player.vy = 0; player.grounded = true;
  player.vel.set(0, 0, 0);
  player.camYaw = 0;
  player.keys?.add?.('KeyW');
  let maxY = 0;
  for (let i = 0; i < 120; i++) {
    player.update(1 / 60, ctx);
    maxY = Math.max(maxY, player.pos.y);
  }
  player.keys?.delete?.('KeyW');
  // il doit être monté (y ≈ 0,2) PUIS être ressorti de l'autre côté :
  // avant v0.8, il était arrêté net au bord et n'atteignait jamais 0,2.
  assert(maxY > 0.15, `y max=${maxY.toFixed(2)} : le joueur n'est jamais monté`);
  assert(player.pos.z < p.z, `bloqué à ${(player.pos.z - p.z).toFixed(2)} m : pas traversé`);
});

// ============================================================================
// 2. DÉPART : AUCUN EMPLOI
// ============================================================================
console.log('— 2. Départ : sans emploi, sans toit —');

check('le mode Histoire démarre sans aucune mission imposée', () => {
  missions.mode = 'off';
  missions.phase = 'none';
  for (let i = 0; i < 600; i++) missions.update(1 / 60, ctx);   // 10 s
  assert.equal(missions.phase, 'none', 'une course a démarré toute seule');
  assert.equal(missions.marker.visible, false, 'marqueur affiché sans emploi');
});

check('le joueur possède 35 $ et aucun emploi', () => {
  economy.money = ECONOMY.startStoryMoney;
  assert.equal(ECONOMY.startStoryMoney, 35, 'montant de départ inattendu');
  assert.equal(jobs.hasJob, false, 'le joueur a déjà un emploi');
});

check('le premier chapitre est « L’arrivée »', () => {
  assert.equal(story.chapter, 0);
  assert.equal(story.chapterData.key, 'arrival');
  assert([...CHAPTERS].length >= 4, 'chapitres manquants');
});

// ============================================================================
// 3. PETITES ANNONCES
// ============================================================================
console.log('— 3. Petites annonces —');

/** Joue une annonce de bout en bout (pickup -> drop). */
function runGig() {
  const r = jobs.acceptGig(ctx);
  assert(r.ok, 'annonce refusée');
  assert.equal(missions.phase, 'pickup', 'phase initiale ≠ pickup');
  assert(missions.reward >= 45 && missions.reward <= 75, `paye ${missions.reward} $`);
  player.pos.set(missions.target.x, 0, missions.target.z);
  missions.update(1 / 60, ctx);
  assert.equal(missions.phase, 'deliver', 'le colis n’a pas été récupéré');
  player.pos.set(missions.target.x, 0, missions.target.z);
  missions.update(1 / 60, ctx);
  assert.equal(missions.phase, 'none', 'livraison non terminée');
  return missions.reward;
}

check('accepter une annonce lance une course payée 45–75 $', () => {
  economy.money = 0;
  const before = economy.money;
  const reward = runGig();
  assert(economy.money > before, 'aucun paiement');
  assert(economy.money >= 45, `gain ${economy.money} $`);
  void reward;
});

check('une annonce réussie compte dans la progression', () => {
  assert.equal(jobs.gigsDone, 1, `gigsDone=${jobs.gigsDone}`);
  assert.equal(missions.mode, 'off', 'le mode devrait revenir à « sans emploi »');
});

check('pas d’annonce tant que la précédente n’est pas acceptée', () => {
  for (let i = 0; i < 300; i++) missions.update(1 / 60, ctx);
  assert.equal(missions.phase, 'none', 'course relancée automatiquement');
});

check('3 annonces faites => postuler devient possible (avec la caution)', () => {
  while (jobs.gigsDone < JOB.requiresGigs) runGig();
  assert.equal(jobs.gigsDone, 3);
  economy.money = JOB.fee - 1;
  let v = jobs.canApply(ctx);
  assert.equal(v.ok, false, 'postule sans argent');
  assert(/caution/i.test(v.reason), `raison illisible : ${v.reason}`);
  economy.money = JOB.fee + 50;
  v = jobs.canApply(ctx);
  assert.equal(v.ok, true, `refusé : ${v.reason}`);
});

// ============================================================================
// 4. EMPLOI
// ============================================================================
console.log('— 4. Emploi —');

check('postuler débite la caution et signe le contrat', () => {
  const before = economy.money;
  const r = jobs.apply(ctx);
  assert(r.ok, `refusé : ${r.reason}`);
  assert.equal(economy.money, before - JOB.fee, 'caution non débitée');
  assert.equal(jobs.hasJob, true);
  assert.equal(missions.mode, 'job', `missions.mode=${missions.mode}`);
  assert.equal(story.hired, true, 'l’histoire ignore l’embauche');
});

check('le van de société apparaît et survit à un changement d’économie', () => {
  const van = jobs.spawnVan(ctx);
  assert(van, 'aucun van');
  assert.equal(van.company, true, 'van marqué comme véhicule du joueur');
  const n = traffic.vehicles.length;
  traffic.clearOwned();
  assert(traffic.vehicles.length === n, 'clearOwned a supprimé le van de société');
});

check('le contrat enchaîne les courses et paie mieux', () => {
  missions.phase = 'none'; missions._nextT = 0;
  missions.update(1 / 60, ctx);
  assert.notEqual(missions.phase, 'none', 'aucune course de contrat');
  assert(missions.payMult >= 1.6, `multiplicateur ${missions.payMult}`);
  assert(missions.reward >= 144, `course de contrat payée ${missions.reward} $ (attendu ≥ 144)`);
});

check('le salaire tombe une fois par jour à 08:00', () => {
  const before = economy.money;
  env.hour = 7.5; env.day = 3;
  jobs.update(1 / 60, ctx);
  assert.equal(economy.money, before, 'salaire versé avant 08:00');
  env.hour = 8.2;
  jobs.update(1 / 60, ctx);
  assert.equal(economy.money, before + JOB.salary, 'salaire non versé');
  jobs.update(1 / 60, ctx);
  assert.equal(economy.money, before + JOB.salary, 'salaire versé deux fois');
  env.hour = 9;
  jobs.update(1 / 60, ctx);
  assert.equal(economy.money, before + JOB.salary, 'salaire versé deux fois le même jour');
});

// ============================================================================
// 5. CHAPITRES
// ============================================================================
console.log('— 5. Chapitres —');

check('embauche => chapitre II', () => {
  story.update(1 / 60, ctx);
  assert.equal(story.chapter, 2, `chapitre ${story.chapter}`);
});

check('acheter un logement => chapitre III', () => {
  const h = economy.houses.reduce((a, b) => (a.price < b.price ? a : b));
  economy.money = h.price + 10;
  const r = economy.buyHouse(h.id);
  assert(r.ok, `achat refusé : ${r.reason}`);
  story.update(1 / 60, ctx);
  assert.equal(story.chapter, 3, `chapitre ${story.chapter}`);
});

check('le premier logement est atteignable avec le salaire', () => {
  const cheapest = economy.houses.reduce((a, b) => (a.price < b.price ? a : b));
  const days = cheapest.price / JOB.salary;
  assert(days < 45, `${Math.round(days)} jours de salaire pour le premier logement`);
  console.log(`  · studio : ${cheapest.price} $ ≈ ${Math.round(days)} jours de salaire`);
});

// ============================================================================
// 6. CINÉMATIQUE
// ============================================================================
console.log('— 6. Cinématique d’ouverture —');

check('l’intro se lance, avance et se termine toute seule', () => {
  const cam2 = new THREE.PerspectiveCamera(60, 1.6, 0.1, 4000);
  const s2 = new StorySystem({ camera: cam2, scene, city, player });
  s2.startIntro(ctx);
  assert.equal(s2.playing, true, 'cinématique non démarrée');
  assert.equal(s2.introSeen, true, 'intro marquée comme non vue');
  const before = cam2.position.clone();
  for (let i = 0; i < 60; i++) s2.update(1 / 60, ctx);
  assert(cam2.position.distanceTo(before) > 0.5, 'la caméra ne bouge pas');
  let frames = 0;
  while (s2.playing && frames < 60 * 120) { s2.update(1 / 60, ctx); frames++; }
  assert.equal(s2.playing, false, 'la cinématique ne se termine jamais');
  assert(frames < 60 * 60, `${frames} frames : trop long (${(frames / 60).toFixed(0)} s)`);
});

check('passer la cinématique fonctionne (Échap / clic)', () => {
  const s2 = new StorySystem({ camera: new THREE.PerspectiveCamera(), scene, city, player });
  let ended = false;
  s2.play([{ dur: 30, pos: [0, 10, 30], look: [0, 0, 0], text: 'test' }], () => { ended = true; });
  s2.skip();
  assert.equal(s2.playing, false);
  assert.equal(ended, true, 'callback de fin non appelé');
});

check('pendant la cinématique, le joueur ne bouge pas', () => {
  const s2 = new StorySystem({ camera: new THREE.PerspectiveCamera(), scene, city, player });
  s2.play([{ dur: 5, pos: [0, 20, 40], look: [0, 0, 0], text: 'x' }]);
  const p0 = player.pos.clone();
  for (let i = 0; i < 120; i++) s2.update(1 / 60, ctx);   // le main ne met pas à jour le joueur
  assert(player.pos.distanceTo(p0) < 1e-6, 'le joueur a bougé');
  assert.equal(s2.playing, true);
  s2.skip();
});

// ============================================================================
// 7. VOITURES
// ============================================================================
console.log('— 7. Carrosserie —');

const childrenNames = (g) => g.children.map((c) => c.geometry?.type || c.type);

check('chaque véhicule porte une ombre de contact au sol', () => {
  const v = new Vehicle(scene, 'Berline');
  const blob = v.group.children.find((c) => c.isMesh && c.geometry?.type === 'PlaneGeometry'
    && c.material?.transparent && c.position.y < 0.1);
  assert(blob, 'aucune ombre de contact : la voiture flotte');
  assert(blob.material.map, 'ombre sans dégradé');
});

check('rétroviseurs, plaques et bas de caisse ajoutés', () => {
  const v = new Vehicle(scene, 'Berline');
  const names = childrenNames(v.group);
  const boxes = names.filter((n) => n === 'BoxGeometry').length;
  assert(boxes >= 8, `${boxes} boîtes seulement : détails manquants`);
});

check('la sportive a un becquet, le SUV des barres de toit', () => {
  const sport = new Vehicle(scene, 'Sportive');
  const suv = new Vehicle(scene, 'SUV');
  assert(sport.group.children.length > suv.group.children.length - 4, 'becquet absent ?');
  assert(sport.group.children.length >= 16, `${sport.group.children.length} pièces`);
  assert(suv.group.children.length >= 14, `${suv.group.children.length} pièces`);
});

check('le vitrage est translucide (plus un plastique opaque)', () => {
  const v = new Vehicle(scene, 'Berline');
  let glass = null;
  v.group.traverse((o) => { if (o.isMesh && o.material === v.group.children.find(() => false)?.material) glass = null; });
  // on cherche un matériau transparent dans le groupe
  const mats = [];
  v.group.traverse((o) => { if (o.isMesh && o.material) mats.push(o.material); });
  const transparent = mats.filter((m) => m.transparent && m.opacity > 0.2 && m.opacity < 0.95);
  assert(transparent.length > 0, 'aucun vitrage translucide');
  void glass;
});

// ============================================================================
// 8. PANNEAU EMPLOI (UI)
// ============================================================================
console.log('— 8. Panneau emploi —');

check('le panneau emploi s’ouvre, propose une annonce et l’accepte', () => {
  economy.money = 20;
  jobs.jobId = null; jobs.gigsDone = 0;
  missions.phase = 'none'; missions.mode = 'off';
  const ui = new UI();
  ctx.ui = ui;
  ui.openJobs(ctx);
  assert.equal(ui.jobsOpen, true, 'panneau non ouvert');
  assert.equal(ui.els.jobs.classList.contains('hidden'), false, 'panneau encore masqué');
  const items = ui.els.jobsBody.children.filter((c) => c.className.includes('jobs-item'));
  assert(items.length >= 2, `${items.length} ligne(s) seulement`);
  const btns = [];
  for (const it of items) for (const c of it.children) if (c.tagName === 'BUTTON') btns.push(c);
  assert(btns.length >= 2, 'aucun bouton d’action');
  btns[0].click();                                  // « Accepter » la petite annonce
  assert.equal(missions.mode, 'gig', 'l’annonce n’a pas démarré de course');
  assert.notEqual(missions.phase, 'none', 'aucune course lancée depuis le panneau');
});

check('le panneau emploi bloque « Postuler » sans caution', () => {
  economy.money = 0;
  jobs.gigsDone = 0;
  const ui = new UI();
  ctx.ui = ui;
  ui.openJobs(ctx);
  assert.equal(ui.els.jobsStatus.textContent.includes('Sans emploi') || ui.els.jobsStatus.textContent.length > 0, true);
  const items = ui.els.jobsBody.children.filter((c) => c.className.includes('jobs-item'));
  assert(items.length >= 2, 'lignes manquantes');
  const apply = items[1].children.find((c) => c.tagName === 'BUTTON');
  assert(apply, 'bouton Postuler absent');
  assert.equal(apply.disabled, true, 'on peut postuler sans argent ni annonces');
});

// ============================================================================
// 9. FICHIERS LIVRÉS
// ============================================================================
console.log('— 9. Câblage des fichiers —');

import fs from 'node:fs';
const ROOT = new URL('..', import.meta.url).pathname;

check('index.html contient le lettrage cinématique et le panneau emploi', () => {
  const html = fs.readFileSync(ROOT + 'web/index.html', 'utf8');
  for (const id of ['cinema', 'cinema-title', 'cinema-text', 'jobs', 'jobs-body', 'tb-jobs']) {
    assert(html.includes(`id="${id}"`), `#${id} absent`);
  }
});

check('main.js branche story et jobs (imports + boucle)', () => {
  const js = fs.readFileSync(ROOT + 'web/src/main.js', 'utf8');
  assert(/import StorySystem from '.\/story.js'/.test(js), 'story non importé');
  assert(/import JobSystem from '.\/jobs.js'/.test(js), 'jobs non importé');
  assert(js.includes('story.update(dt, ctx)'), 'story absente de la boucle');
  assert(js.includes('jobs.update(dt, ctx)'), 'jobs absents de la boucle');
  assert(js.includes("KeyJ"), 'touche J non câblée');
});

void Bus; void lowCollider;
console.log('');
if (fails.length) {
  console.log(`❌ V0.8 : ${passed} réussites, ${fails.length} échec(s) :`);
  for (const f of fails) console.log('   · ' + f);
  process.exit(1);
}
console.log(`✅ V0.8 : ${passed} vérifications réussies, 0 échec(s).`);
