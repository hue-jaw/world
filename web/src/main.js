// ============================================================================
// METROPOLIS — main.js
// Assemblage des systèmes + boucle de jeu. Aucun système ne se connaît
// directement : ils communiquent via ctx (services) et Bus (événements).
// Équivalent UE5 : GameMode + World Subsystems + GameInstance.
// ============================================================================
import * as THREE from 'three';
import { CFG, Bus, clamp } from './core.js';
import { City } from './city.js';
import { TrafficSystem } from './vehicles.js';
import { PedestrianSystem } from './pedestrians.js';
import { Player } from './player.js';
import { Environment } from './environment.js';
import { MissionSystem } from './missions.js';
import { AudioSys } from './audio.js';
import { UI } from './ui.js';
import { SaveSystem } from './save.js';

window.addEventListener('error', (e) => {
  const el = document.getElementById('loading');
  if (el && el.style.display !== 'none') {
    el.textContent = '⚠ Erreur de chargement : ' + (e.message || 'voir console');
    el.style.display = 'flex';
  }
  console.error(e.error || e.message);
});

// ------------------------------- Renderer ----------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 2400);
camera.position.set(0, 60, 180);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ------------------------------- Sauvegarde --------------------------------
const save = SaveSystem.load();

// -------------------------------- Systèmes ---------------------------------
const city = new City(scene);
const env = new Environment(scene, city);
const audio = new AudioSys();
const player = new Player(scene, camera, renderer.domElement);
const traffic = new TrafficSystem(scene, city);
const peds = new PedestrianSystem(scene, city);
const missions = new MissionSystem(scene, city);

const ctx = {
  scene, city, env, traffic, peds, player, missions, audio,
  ui: null,
  money: 0,
  playerVehicle: null,
  playerPos: () => player.getPos(),
  playerSpeed: () => player.getSpeed(),
  shakeCamera: (a) => { player.shake = Math.min(player.shake + a, 0.6); },
  addMoney: (n) => { ctx.money += n; },
  saveNow: () => SaveSystem.save({
    money: Math.round(ctx.money), deliveries: missions.deliveries,
    hour: env.hour, weather: env.weatherName,
    x: Math.round(player.pos.x), z: Math.round(player.pos.z),
  }),
};

// restauration de partie (avant création de l'UI : pas de toasts parasites)
if (save) {
  ctx.money = save.money || 0;
  missions.deliveries = save.deliveries || 0;
  env.hour = typeof save.hour === 'number' ? save.hour : CFG.time.startHour;
  if (save.weather) env.setWeather(save.weather, true);
  if (typeof save.x === 'number') {
    const c = city.collide(save.x, save.z, 0.4);
    player.pos.set(c.x, city.groundY(c.x, c.z), c.z);
  }
}

let timeScales = [1, 4, 16], tsIdx = 0;
const ui = new UI({
  onWeather: (name) => { env.autoWeather = false; env.setWeather(name); audio.click(); },
  onTimeSkip: () => { env.advanceTime(3); audio.click(); },
  onTimeScale: () => { tsIdx = (tsIdx + 1) % timeScales.length; env.timeScale = timeScales[tsIdx]; return env.timeScale; },
  onSound: () => audio.toggleMute(),
});
ctx.ui = ui;

traffic.init(ctx);

// note de l'écran titre
if (save) {
  document.getElementById('save-note').innerHTML =
    `💾 Sauvegarde retrouvée : $${ctx.money} · ${missions.deliveries} livraisons · reprise automatique — ` +
    `<a href="#" id="save-reset" style="color:#8fc3ff">réinitialiser</a>`;
  document.getElementById('save-reset').addEventListener('click', (e) => {
    e.preventDefault(); SaveSystem.clear(); location.reload();
  });
}

// ----------------------------- Événements jeu -------------------------------
Bus.on('crash', ({ pos, speed, vehicle }) => {
  const pp = ctx.playerPos();
  const d = Math.hypot(pos.x - pp.x, pos.z - pp.z);
  if (d < 55) audio.crash(clamp(speed / 22, 0.1, 1) * (1 - d / 70));
  if (vehicle && vehicle.driver === 'player') ctx.shakeCamera(clamp(speed * 0.018, 0.04, 0.4));
});
Bus.on('busted', () => {
  const fine = Math.min(Math.round(ctx.money), 150);
  ctx.money -= fine;
  audio.busted(); audio.engineOff(); audio.setSiren(0);
  ui.showBusted(fine);
  setTimeout(() => { player.resetToSpawn(ctx); ctx.saveNow(); }, 1400);
});
Bus.on('exitVehicle', () => audio.engineOff());

// ------------------------------- Raccourcis ---------------------------------
addEventListener('keydown', (e) => {
  if (!started) return;
  if (e.code === 'KeyT') env.advanceTime(3);
  else if (e.code === 'KeyG') { env.autoWeather = false; env.cycleWeather(); }
  else if (e.code === 'KeyL') {
    env.headlightOverride = env.headlightOverride === null ? true : env.headlightOverride === true ? false : null;
    Bus.emit('toast', { text: env.headlightOverride === null ? '💡 Phares : automatiques' : env.headlightOverride ? '💡 Phares : allumés' : '💡 Phares : éteints', kind: '' });
  }
  else if (e.code === 'KeyM') {
    const m = audio.toggleMute();
    document.getElementById('tb-sound').textContent = m ? '🔇' : '🔊';
  }
  else if (e.code === 'F1' || e.code === 'Backquote') { e.preventDefault(); ui.toggleDebug(); }
});

// ------------------------------- Démarrage ----------------------------------
let started = false;
document.getElementById('btn-play').addEventListener('click', () => {
  audio.init();
  audio.ctx?.resume();
  document.getElementById('title-screen').style.display = 'none';
  document.getElementById('hud').classList.remove('hidden');
  started = true;
  // snap caméra derrière le joueur (pas de travelling parasite depuis le titre)
  const p = player.pos;
  player._camPos.set(p.x + Math.sin(player.camYaw) * 7, 3.4, p.z + Math.cos(player.camYaw) * 7);
  Bus.emit('toast', { text: save ? '👋 Bon retour à Metropolis !' : '👋 Bienvenue à Metropolis ! Une sportive vous attend juste à côté (F pour entrer).', kind: 'good' });
});

// caméra cinématique de l'écran titre (survol de la ville vivante)
function titleCamera(t) {
  const r = 165, a = t * 0.045;
  camera.position.set(Math.sin(a) * r, 52 + Math.sin(t * 0.13) * 10, Math.cos(a) * r);
  camera.lookAt(0, 8, 0);
}

// --------------------------------- Boucle -----------------------------------
const clock = new THREE.Clock();
let autosaveT = 12, debugT = 0, fpsAvg = 60, firstFrame = true;

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  if (dt > 0) fpsAvg = fpsAvg * 0.95 + (1 / dt) * 0.05;

  env.update(dt, ctx);
  city.update(dt);
  traffic.update(dt, ctx);
  peds.update(dt, ctx);

  if (started) {
    player.update(dt, ctx);
    missions.update(dt, ctx);
    ui.update(dt, ctx);
    autosaveT -= dt;
    if (autosaveT <= 0) { autosaveT = 12; ctx.saveNow(); }
    debugT -= dt;
    if (debugT <= 0 && ui.debugVisible) {
      debugT = 0.25;
      const ts = traffic.stats(), ps = peds.stats(), pp = ctx.playerPos();
      const pv = ctx.playerVehicle;
      ui.setDebug(
        `METROPOLIS DEBUG (F1)\n` +
        `FPS ${fpsAvg.toFixed(0)} · draw calls ${renderer.info.render.calls} · tris ${(renderer.info.render.triangles / 1000).toFixed(0)}k\n` +
        `Heure ${env.formatHour()} · ${env.weatherName} (pluie ${env.rainIntensity.toFixed(2)})\n` +
        `Gameplay : grip ×${env.gripFactor.toFixed(2)} · trafic ×${env.trafficFactor.toFixed(2)}\n` +
        `Trafic : ${ts.total} véhicules (${ts.ai} IA, ${ts.police} police) · cible ${traffic.trafficTarget(env.hour)}\n` +
        `PNJ : ${ps.visible}/${ps.total} visibles (${ps.walking} en marche)\n` +
        `Wanted : ${ts.wanted}★ (heat ${traffic.heat.toFixed(2)})\n` +
        `Joueur : (${pp.x.toFixed(0)}, ${pp.z.toFixed(0)}) ${pv ? `· ${pv.typeName} ${Math.round(pv.speedKmh())} km/h · dégâts ${Math.round(pv.damage * 100)}%` : '· à pied'}\n` +
        `LOD sim : <70m plein · <170m /4 · au-delà /24`);
    }
  } else {
    titleCamera(t);
  }

  renderer.render(scene, camera);
  if (firstFrame) {
    firstFrame = false;
    document.getElementById('loading').style.display = 'none';
  }
}
loop();
