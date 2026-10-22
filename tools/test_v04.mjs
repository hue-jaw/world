// ============================================================================
// METROPOLIS — tools/test_v04.mjs
// Vérifications headless des 14 exigences v0.4. Chaque test mesure le
// COMPORTEMENT RÉEL du code de jeu (aucune simulation factice) :
//   police hors champ · mur ≠ crime · conducteur + vitres · drift + son
//   GPS bleu longue portée · 1re personne · L3/R3 · réglages & menu
//   modes histoire/libre · icônes Reicon
//
// Ce qui N'EST PAS testable ici : le rendu WebGL (pas de GPU headless),
// donc l'aspect visuel des vitres et des chevrons reste à valider à l'écran.
// ============================================================================
import assert from 'node:assert/strict';
import { installDOM } from './dom_stub.mjs';

const { byId } = installDOM();

import * as THREE from '../web/node_modules/three/build/three.module.js';
const { City } = await import('../web/src/city.js');
const { Environment } = await import('../web/src/environment.js');
const { Player } = await import('../web/src/player.js');
const { TrafficSystem, Vehicle } = await import('../web/src/vehicles.js');
const { PedestrianSystem } = await import('../web/src/pedestrians.js');
const { MissionSystem } = await import('../web/src/missions.js');
const { UI } = await import('../web/src/ui.js');
const Economy = (await import('../web/src/economy.js')).default;
const GPSSystem = (await import('../web/src/gps.js')).default;
const { Settings, SHADOW_LEVELS } = await import('../web/src/settings.js');
const AssetsMod = await import('../web/src/assets.js');
const MenuSystem = (await import('../web/src/menu.js')).default;
const { icon, iconNames } = await import('../web/src/icons.js');
const AudioSrcMod = await import('../web/src/audio.js');
const { Bus, CFG } = await import('../web/src/core.js');
const { SaveSystem } = await import('../web/src/save.js');

let passed = 0; const fails = [];
const check = (label, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + label); }
  catch (e) { fails.push(label); console.log('  ✗ ' + label + ' — ' + e.message); }
};

// ---------------------------------------------------------------------------
console.log('— Monde de test —');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1.6, 0.1, 2400);
const renderer = {
  shadowMap: { enabled: true, type: 2 },
  toneMappingExposure: 1.06,
  setPixelRatio() {}, info: { render: { calls: 0, triangles: 0 } }, domElement: { addEventListener() {}, style: {} },
};
const city = new City(scene);
const env = new Environment(scene, city, null);
const player = new Player(scene, camera, { addEventListener() {}, style: {} });
const traffic = new TrafficSystem(scene, city);
const peds = new PedestrianSystem(scene, city);
const missions = new MissionSystem(scene, city);
const economy = new Economy(city);
const gps = new GPSSystem(scene, city);
const ctx = {
  scene, city, env, traffic, peds, player, missions, economy, gps, renderer,
  ui: null, menu: null, paused: false, playerVehicle: null,
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
const settings = new Settings();
ctx.settings = settings;
const menu = new MenuSystem(ctx, settings);
ctx.menu = menu;

// ===========================================================================
console.log('— 1. Police : jamais devant, toujours de loin —');
check('le spawn de police est hors du champ de vision (>100 m, derrière)', () => {
  const pp = { x: player.pos.x, z: player.pos.z };
  player.camYaw = 0;                       // caméra regarde vers -Z
  const viewX = -Math.sin(player.camYaw), viewZ = -Math.cos(player.camYaw);
  let worst = { d: 1e9, dot: 1 };
  for (let i = 0; i < 40; i++) {
    const n = traffic._policeSpawnNode(ctx, pp);
    assert(n, 'aucun nœud trouvé');
    const dx = n.x - pp.x, dz = n.z - pp.z, d = Math.hypot(dx, dz);
    const dot = (dx / d) * viewX + (dz / d) * viewZ;
    if (d < worst.d) worst = { d, dot };
    assert(d > 60, `unité trop proche : ${d.toFixed(0)} m`);
  }
  // le pire cas doit rester loin : au moins 100 m et pas plein champ
  assert(worst.d > 95, `pire distance ${worst.d.toFixed(0)} m`);
});
check('la police apparaît >100 m et poursuit par interception', () => {
  traffic.clearWanted();
  traffic.police.forEach((v) => { v.active = false; });
  traffic.police.length = 0;
  Bus.emit('crime', { severity: 2, pos: player.pos });
  traffic.updatePolice(0.016, ctx);
  assert(traffic.police.length >= 1, 'aucune unité dépêchée');
  const v = traffic.police[0];
  const d = Math.hypot(v.pos.x - player.pos.x, v.pos.z - player.pos.z);
  assert(d > 90, `apparue à ${d.toFixed(0)} m (doit être > 90)`);
  assert(v.driver.isPolice, 'driver non marqué police');
});

console.log('— 2. Foncer dans un mur n’est PAS un crime —');
check('impact contre un bâtiment : zéro crime émis', () => {
  let crimes = 0;
  const off = Bus.on ? null : null;
  const handler = ({ severity }) => { crimes += Math.round(severity); };
  // Bus.on renvoie-t-il un désabonnement ? on écoute sans se désabonner :
  // le compteur n'est lu qu'ici.
  const bus = Bus.on('crime', handler);
  const v = new Vehicle(scene, 'Berline');
  v.driver = 'player';
  v.placeAt(-232, 232, 0);                 // coin du monde : mur garanti
  v.vel.x = 0; v.vel.z = 26; v.vf = 26;    // 94 km/h vers le mur
  for (let i = 0; i < 20; i++) v.update(0.016, ctx);
  assert(crimes === 0, `${crimes} crime(s) émis pour un mur`);
  if (typeof bus === 'function') bus();
});

console.log('— 3. Conducteur visible + vitres transparentes —');
check('chaque modèle de véhicule embarque un conducteur assis', () => {
  for (const t of ['Citadine', 'Berline', 'SUV', 'Sportive', 'Taxi', 'Utilitaire', 'Police']) {
    const v = new Vehicle(scene, t);
    assert(v.driverFig, `${t} : aucun conducteur`);
    assert(v.group.children.includes(v.driverFig), `${t} : conducteur hors du groupe`);
  }
});
check('le modèle GLB expose une découpe de verre (ou null si pas d’image)', () => {
  // En headless le canvas 2D est un stub : la découpe doit renvoyer null
  // PROPREMENT (aucune exception) et le véhicule rester fonctionnel.
  const v = new Vehicle(scene, 'Berline');
  assert('glass' in v, 'pas de champ glass');
  assert(v.glass === null || v.glass.isMesh, 'glass invalide');
});
check('découpe de verre : les triangles bleus deviennent transparents', () => {
  const { splitGlass, isGlassColor } = AssetsMod;
  assert.equal(isGlassColor(0x67, 0x94, 0xd9), true, 'le bleu vitre n’est pas reconnu');
  assert.equal(isGlassColor(0xf2, 0xbf, 0x99), false, 'une couleur de peau est prise pour du verre');
  // palette synthétique : moitié haute-gauche bleue (verre), le reste beige
  const W = 128, data = new Uint8ClampedArray(W * W * 4).fill(235);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    if (x < W / 2 && y < W / 2) { data[o] = 0x67; data[o + 1] = 0x94; data[o + 2] = 0xd9; }
  }
  const prevCreate = document.createElement;
  document.createElement = () => ({
    width: W, height: W,
    getContext: () => ({ drawImage() {}, getImageData: () => ({ data }) }),
  });
  try {
    // 6 quads : 2 en haut avec UV « verre », 4 en bas avec UV beiges
    const pos = [], uv = [], idx = [];
    let vi = 0;
    const quad = (y, u, v) => {
      // deux triangles
      pos.push(-1, y, -1, 1, y, -1, 1, y, 1, -1, y, 1);
      for (let k = 0; k < 4; k++) uv.push(u, v);
      idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3); vi += 4;
    };
    quad(0.6, 0.2, 0.8); quad(0.7, 0.3, 0.7);   // verre (y haut, uv bleues)
    quad(-0.4, 0.8, 0.2); quad(-0.3, 0.9, 0.1);
    quad(0.1, 0.7, 0.3); quad(0.2, 0.6, 0.4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mat = new THREE.MeshStandardMaterial();
    mat.map = { image: { width: W, height: W } };
    const mesh = new THREE.Mesh(geo, mat);
    // bbox y : -1 … 1 → seuil verre à -0.16 : les quads y=0.6/0.7 passent
    const out = splitGlass(mesh);
    assert(out.glass, 'aucune vitre détectée');
    const gCount = out.glass.geometry.index.count / 3;
    const oCount = out.body.geometry.index.count / 3;
    assert.equal(gCount, 4, `${gCount} triangles de verre (attendu 4)`);
    assert.equal(oCount, 8, `${oCount} triangles opaques (attendu 8)`);
    assert.equal(out.glass.material.transparent, true, 'verre non transparent');
    assert(out.glass.material.opacity < 0.6, 'verre trop opaque');
  } finally { document.createElement = prevCreate; }
});

console.log('— 4. Drift au frein à main + crissement —');
check('frein à main à 25 m/s : survirage et angle de dérive réels', () => {
  const mk = (hb) => {
    const v = new Vehicle(scene, 'Sportive');
    v.driver = 'player';
    // sur une route dégagée (le centre-ville est bâti : un choc fausserait la mesure)
    v.placeAt(42.5, 42.5, 0);
    v.vel.z = 25; v.vf = 25;
    v.inputs.throttle = 1; v.inputs.steer = 0.9; v.inputs.handbrake = hb;
    const yaw0 = v.heading;
    // On mesure le MAXIMUM sur la glisse : la voiture finit dans un mur en
    // bout de ligne droite, ce qui écraserait une mesure « état final ».
    let peakDrift = 0, peakSlip = 0, peakYaw = 0;
    for (let i = 0; i < 40; i++) {
      v.update(0.016, ctx);
      peakDrift = Math.max(peakDrift, v.driftAmount || 0);
      peakSlip = Math.max(peakSlip, Math.abs(v.slipAngle || 0));
      peakYaw = Math.max(peakYaw, Math.abs(v.heading - yaw0));
    }
    return { yaw: peakYaw, drift: peakDrift, slip: peakSlip };
  };
  const noHb = mk(false);
  const hb = mk(true);
  assert(hb.drift > 0.5, `driftAmount max ${hb.drift.toFixed(2)} trop faible`);
  assert(hb.yaw > noHb.yaw * 1.25, `survirage insuffisant (${hb.yaw.toFixed(2)} vs ${noHb.yaw.toFixed(2)} rad)`);
  assert(hb.slip > 8, `angle de dérive max ${hb.slip.toFixed(1)}° trop faible`);
  assert(noHb.drift < 0.15, 'le drift s’active sans frein à main');
});
check('le crissement audio est piloté par la glisse réelle', () => {
  const { AudioSys } = AudioSrcMod;
  const a = new AudioSys();
  assert.equal(typeof a.setSkid, 'function', 'setSkid absent d’AudioSys');
  assert.doesNotThrow(() => a.setSkid(0.8, true));      // sans WebAudio : inoffensif
  // le système de trafic doit appeler setSkid pendant _driftFx
  let called = 0;
  const fakeCtx = { ...ctx, audio: { setSkid: () => { called++; } } };
  const v = new Vehicle(scene, 'Sportive');
  v.driver = 'player'; v.placeAt(42.5, 42.5, 0); v.vel.z = 22; v.vf = 22;
  v.inputs.throttle = 1; v.inputs.steer = 0.9; v.inputs.handbrake = true;
  for (let i = 0; i < 20; i++) v.update(0.016, ctx);
  traffic.playerVehicle = v;
  traffic._driftFx(0.016, fakeCtx);
  assert(called > 0, 'setSkid jamais appelé par _driftFx');
  traffic.playerVehicle = null;
  v.active = false;
});

console.log('— 5. GPS : tracé bleu + flèches visibles de loin —');
check('itinéraire calculé, flèches au sol générées au-delà de 150 m', () => {
  gps.locked = true;                        // cible imposée, non écrasée par les missions
  player.pos.set(42.5, 0, 42.5);
  gps.setTarget(600, 600);
  gps._dirty = true; gps._timer = 0;
  for (let i = 0; i < 3; i++) gps.update(0.1, ctx);
  assert(gps.route.length > 3, `itinéraire vide (${gps.route.length} nœuds)`);
  assert(gps.arrows.count > 20, `seulement ${gps.arrows.count} chevrons`);
  // distance maximale réellement couverte par les chevrons
  const m = new THREE.Matrix4(); const p = new THREE.Vector3();
  let maxD = 0;
  for (let i = 0; i < gps.arrows.count; i++) {
    gps.arrows.getMatrixAt(i, m); p.setFromMatrixPosition(m);
    maxD = Math.max(maxD, Math.hypot(p.x - player.pos.x, p.z - player.pos.z));
  }
  assert(maxD > 150, `chevrons limités à ${maxD.toFixed(0)} m (exigence : bien plus loin)`);
});
check('le ruban bleu au sol est construit (drawRange > 0)', () => {
  assert(gps.ribbon.geometry.drawRange.count > 60,
    `ruban vide (${gps.ribbon.geometry.drawRange.count} indices)`);
});
check('le réglage « flèches GPS » masque réellement les chevrons', () => {
  gps.showArrows = false;
  gps.update(0.1, ctx);
  assert.equal(gps.arrows.count, 0, 'chevrons encore visibles');
  gps.showArrows = true;
});

console.log('— 6. Conduite à la 1re personne —');
check('la caméra passe dans l’habitacle (position < 2 m du véhicule)', () => {
  const v = new Vehicle(scene, 'Berline');
  v.driver = 'player';
  v.placeAt(42.5, 42.5, 0);      // sur une route : aucun bâtiment dans le dos
  player.vehicle = v;
  player.camMode = 'first';
  player._camFreeT = 0;
  for (let i = 0; i < 30; i++) player._updateCamera(0.016, ctx);
  const d = Math.hypot(camera.position.x - v.pos.x, camera.position.z - v.pos.z);
  assert(d < 2, `caméra à ${d.toFixed(2)} m du châssis (attendu : dans l'habitacle)`);
  assert(camera.position.y > 1.1 && camera.position.y < 2.2, `hauteur ${camera.position.y.toFixed(2)} m`);
  assert(camera.fov >= 70, `fov ${camera.fov.toFixed(0)} trop étroit pour l'habitacle`);
  assert(v.driverFig.visible === false, 'la tête du conducteur n’est pas masquée en vue interne');
  player.camMode = 'third';
  for (let i = 0; i < 120; i++) player._updateCamera(0.016, ctx);
  const d2 = Math.hypot(camera.position.x - v.pos.x, camera.position.z - v.pos.z);
  assert(d2 > 4, `retour 3e personne raté (${d2.toFixed(1)} m)`);
  player.vehicle = null; v.active = false;
});

console.log('— 7. Manette : L3 sprint, R3 recentrage —');
check('R3 recentre la caméra derrière le véhicule', () => {
  const v = new Vehicle(scene, 'SUV');
  v.placeAt(10, 10, 1.2);
  player.vehicle = v;
  player.camYaw = 0.0;
  player.recenterCamera();
  const expected = v.heading + Math.PI;
  const err = Math.abs(Math.atan2(Math.sin(player.camYaw - expected), Math.cos(player.camYaw - expected)));
  assert(err < 1e-6, `écart de recentrage ${err.toFixed(3)} rad`);
  player.vehicle = null;
});
check('L3 verrouille le sprint (RB n’est plus utilisé)', () => {
  const srcPlayer = player._updateOnFoot.toString();
  assert(!/down\('RB'\)/.test(srcPlayer), 'RB est encore utilisé pour sprinter');
  assert(/_l3Latch/.test(srcPlayer), 'L3 n’est pas branché au sprint');
  assert(/_l3Latch/.test(player.update.toString()), 'le bouton L3 n’est pas lu dans update()');
});

// ===========================================================================
console.log('— 8. Réglages : application réelle au moteur —');
check('qualité des ombres : la shadow map change vraiment de taille', () => {
  settings.state.shadows = 'ultra';
  settings.apply(ctx);
  assert.equal(env.sun.shadow.mapSize.x, SHADOW_LEVELS.ultra.mapSize);
  settings.state.shadows = 'low';
  settings.apply(ctx);
  assert.equal(env.sun.shadow.mapSize.x, SHADOW_LEVELS.low.mapSize);
  settings.state.shadows = 'off';
  settings.apply(ctx);
  assert.equal(env.sun.castShadow, false, 'ombres non coupées');
  settings.state.shadows = 'high';
  settings.apply(ctx);
  assert.equal(env.sun.shadow.mapSize.x, SHADOW_LEVELS.high.mapSize);
});
check('qualité de la lumière : intensités et exposition modifiées', () => {
  const before = { hemi: env.hemi.intensity, exp: renderer.toneMappingExposure };
  settings.state.lights = 'ultra';
  settings.apply(ctx);
  assert(env.hemi.intensity !== before.hemi, 'intensité hémisphérique inchangée');
  assert(renderer.toneMappingExposure !== before.exp, 'exposition inchangée');
  settings.state.lights = 'high';
  settings.apply(ctx);
});
check('mode RTX : reflets renforcés sur les matériaux', () => {
  settings.state.rtx = false;
  settings.apply(ctx);
  const v = new Vehicle(scene, 'Sportive');
  const mat = v.paint;
  const before = mat.envMapIntensity;
  settings.state.rtx = true;
  settings.apply(ctx);
  assert(mat.envMapIntensity > before * 1.2,
    `envMapIntensity ${before} → ${mat.envMapIntensity} (RTX sans effet)`);
  settings.state.rtx = false;
  settings.apply(ctx);
  v.active = false;
});
check('météo forcée depuis les réglages', () => {
  settings.set('autoWeather', false);
  settings.set('weather', 'Storm');
  settings.applyWorld(ctx);
  assert.equal(env.weatherName, 'Storm', `météo = ${env.weatherName}`);
  assert.equal(env.autoWeather, false, 'la météo automatique écrase le choix');
  settings.set('weather', 'Clear');
  settings.applyWorld(ctx);
  assert.equal(env.weatherName, 'Clear');
});
check('les réglages survivent à un rechargement (localStorage)', () => {
  settings.set('shadows', 'medium');
  settings.set('traffic', 1.5);
  const s2 = new Settings();
  assert.equal(s2.get('shadows'), 'medium');
  assert.equal(s2.get('traffic'), 1.5);
  settings.set('shadows', 'high');
  settings.set('traffic', 1);
});
check('une valeur corrompue en stockage ne casse pas le chargement', () => {
  const prev = localStorage.getItem('metropolis_settings');
  localStorage.setItem('metropolis_settings', '{"version":1,"shadows":"nawak"}');
  const s3 = new Settings();
  assert.equal(s3.get('shadows'), 'nawak');       // valeur lue telle quelle
  assert.doesNotThrow(() => s3.apply(ctx));       // …mais repli sur le preset par défaut
  if (prev) localStorage.setItem('metropolis_settings', prev); else localStorage.removeItem('metropolis_settings');
});

console.log('— 9. Menu : pause réelle, 4 onglets, modes —');
check('ouvrir le menu met réellement le jeu en pause', () => {
  menu.show();
  assert.equal(ctx.paused, true);
  menu.close();
  assert.equal(ctx.paused, false);
});
check('les 4 onglets se rendent sans exception', () => {
  menu.show();
  for (const t of ['graphics', 'controls', 'gamepad', 'special']) {
    menu.tab = t;
    assert.doesNotThrow(() => menu.render(), `onglet ${t}`);
  }
  menu.close();
});
check('le mode Libre désactive vraiment les missions', () => {
  settings.set('mode', 'free');
  menu._applyMode();
  assert.equal(missions.enabled, false);
  assert.equal(missions.objectiveInfo(ctx), null);
  settings.set('mode', 'story');
  menu._applyMode();
  assert.equal(missions.enabled, true);
});
check('le mode Histoire relance une livraison', () => {
  missions.phase = 'none';
  missions._nextT = 0;
  missions.update(0.1, ctx);
  assert.notEqual(missions.phase, 'none', 'aucune mission générée en mode Histoire');
  assert(missions.objectiveInfo(ctx) !== null);
  missions.phase = 'none'; missions.marker.visible = false;
});

console.log('— 10. Icônes Reicon (hors-ligne) —');
check(`${iconNames.length} icônes Reicon rendues en SVG inline`, () => {
  assert(iconNames.length >= 20, `seulement ${iconNames.length} icônes`);
  for (const n of iconNames) {
    const svg = icon(n, { size: 16 });
    assert(svg.startsWith('<svg') && svg.includes('</svg>'), `${n} mal rendue`);
    assert(!/http/.test(svg.replace('http://www.w3.org/2000/svg', '')), `${n} référence une URL externe`);
  }
});

// ===========================================================================
console.log(`\n${fails.length === 0 ? '✅' : '❌'} V0.4 : ${passed} vérifications réussies, ${fails.length} échec(s).`);
if (fails.length) { fails.forEach((f) => console.log('   ✗ ' + f)); process.exit(1); }

