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
import { ECONOMY } from './core.js';
import Assets from './assets.js';
import Economy from './economy.js';
import GPSSystem from './gps.js';
import { Settings } from './settings.js';
import MenuSystem from './menu.js';

window.addEventListener('error', (e) => {
  const el = document.getElementById('loading');
  if (el && el.style.display !== 'none') {
    el.textContent = '⚠ Erreur de chargement : ' + (e.message || 'voir console');
    el.style.display = 'flex';
  }
  console.error(e.error || e.message);
});

async function boot() {

// ------------------------------- Renderer ----------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
// ---------------------------------------------------------------
// Qualité adaptative (brief §21) : on vise 60 fps en ajustant la
// résolution interne, jamais la simulation. Mesure toutes les 2,5 s.
// ---------------------------------------------------------------
const MAX_DPR = Math.min(devicePixelRatio || 1, 1.5);
let renderScale = MAX_DPR;
renderer.setPixelRatio(renderScale);
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
// Modèles 3D (CC0) : chargés AVANT les systèmes pour qu'ils naissent avec
// leur apparence définitive. En cas d'échec, chaque système retombe sur ses
// primitives procédurales (aucun écran noir possible).
const loadEl = document.getElementById('loading');
if (loadEl) loadEl.textContent = 'Chargement des modèles 3D…';
// Jamais bloquant : si un modèle est illisible, on joue avec les primitives.
try {
  await Assets.init();
} catch (err) {
  console.warn('[METROPOLIS] modèles 3D indisponibles, rendu de secours :', err);
}

// Le constructeur de City génère les textures HD (façades, sol, décors).
// C'est un travail SYNCHRONE de quelques centaines de ms : on laisse d'abord
// le navigateur peindre le message de chargement, sinon l'écran reste figé
// sur le texte précédent et le jeu paraît bloqué.
if (loadEl) loadEl.textContent = 'Génération des textures haute définition…';
await new Promise((r) => (typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame(() => requestAnimationFrame(r))
  : setTimeout(r, 0)));
const city = new City(scene);
const env = new Environment(scene, city, renderer);
const audio = new AudioSys();
const player = new Player(scene, camera, renderer.domElement);
const traffic = new TrafficSystem(scene, city);
const peds = new PedestrianSystem(scene, city);
const missions = new MissionSystem(scene, city);
const economy = new Economy(city);
const gps = new GPSSystem(scene, city);

const ctx = {
  // renderer exposé : les réglages graphiques (ombres, exposition) en ont besoin
  scene, city, env, traffic, peds, player, missions, audio, economy, gps, renderer,
  ui: null,
  menu: null,
  paused: false,
  playerVehicle: null,
  playerPos: () => player.getPos(),
  playerSpeed: () => player.getSpeed(),
  shakeCamera: (a) => { player.shake = Math.min(player.shake + a, 0.6); },
  addMoney: (n) => { economy.money += n; },
  saveNow: () => SaveSystem.save({
    v: 2,
    deliveries: missions.deliveries,
    hour: env.hour, weather: env.weatherName,
    x: Math.round(player.pos.x), z: Math.round(player.pos.z),
    health: Math.round(player.health),
    economy: economy.serialize(),
  }),
};
// L'argent est une seule source de vérité : economy.money.
Object.defineProperty(ctx, 'money', {
  get: () => economy.money,
  set: (v) => { economy.money = v; },
  enumerable: true,
});

// restauration de partie (avant création de l'UI : pas de toasts parasites)
if (save) {
  if (save.economy) economy.restore(save.economy);
  else if (Number.isFinite(save.money)) economy.money = save.money;
  player.health = Number.isFinite(save.health) ? save.health : player.maxHealth;
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
  onWeather: (name) => {
    env.autoWeather = false; env.setWeather(name); audio.click();
    // la barre d'outils et le menu Météo restent synchronisés
    settings.set('autoWeather', false); settings.set('weather', name);
  },
  onTimeSkip: () => { env.advanceTime(3); audio.click(); },
  onTimeScale: () => { tsIdx = (tsIdx + 1) % timeScales.length; env.timeScale = timeScales[tsIdx]; return env.timeScale; },
  onSound: () => audio.toggleMute(),
  onShopOpen: (open) => { if (open) audio.click(); },
});
ctx.ui = ui;

// ---------------------------- Réglages + menu --------------------------------
// Les réglages sont appliqués AVANT le premier rendu (ombres, lumière, météo).
const settings = new Settings();
ctx.settings = settings;
const menu = new MenuSystem(ctx, settings);
ctx.menu = menu;
settings.apply(ctx);
settings.applyWorld(ctx);
// le menu pilote aussi le mode Histoire / Libre
menu._applyMode();
if (settings.get('camView') === 'first') player.camMode = 'first';
player.autoCam = settings.get('autoCam') !== false;
player.gamepad.deadzone = settings.get('deadzone') ?? 0.18;
Bus.on('settingsChanged', ({ key }) => {
  if (key === 'mouseSens' || key === 'padSens' || key === '*') {
    player.mouseSens = settings.get('mouseSens') ?? 1;
    player.padSens = settings.get('padSens') ?? 1;
  }
  if (key === 'traffic' || key === 'peds' || key === 'autoWeather' || key === '*') settings.applyWorld(ctx);
  if (key === 'gpsArrows' && ctx.gps) ctx.gps.showArrows = settings.get('gpsArrows') !== false;
});

traffic.init(ctx);
syncGarage();

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
  // le joueur encaisse le choc (blessures, brief §23)
  if (vehicle && vehicle.driver === 'player') {
    player.damage(Math.min(38, speed * 1.35), ctx, 'accident');
    player.gamepad.rumble(Math.min(0.9, speed * 0.035), 160);
  }
  const pp = ctx.playerPos();
  const d = Math.hypot(pos.x - pp.x, pos.z - pp.z);
  if (d < 55) audio.crash(clamp(speed / 22, 0.1, 1) * (1 - d / 70));
  if (vehicle && vehicle.driver === 'player') ctx.shakeCamera(clamp(speed * 0.018, 0.04, 0.4));
});
Bus.on('playerDown', ({ reason }) => {
  const cost = Math.min(Math.round(economy.money), ECONOMY.health.hospitalCost);
  economy.money -= cost;
  ui.showDowned(true, reason === 'chute' ? 'Chute grave — transport à l\'hôpital…' : 'Transport à l\'hôpital…');
  audio.fail();
  setTimeout(() => {
    ui.showDowned(false);
    const home = economy.spawnPoint();
    player.health = player.maxHealth;
    player.resetToSpawn(ctx);
    if (home) {
      const c = city.collide(home.x, home.z, 0.5);
      player.pos.set(c.x, city.groundY(c.x, c.z), c.z);
      player._camPos.set(c.x, 3.5, c.z + 7);
    }
    Bus.emit('toast', { text: `🏥 Soins : $${cost}${home ? ' — vous êtes chez vous' : ''}`, kind: 'bad' });
    ctx.saveNow();
  }, 2600);
});

Bus.on('busted', () => {
  const fine = Math.min(Math.round(ctx.money), 150);
  ctx.money -= fine;
  audio.busted(); audio.engineOff(); audio.setSiren(0);
  ui.showBusted(fine);
  setTimeout(() => { player.resetToSpawn(ctx); ctx.saveNow(); }, 1400);
});
Bus.on('exitVehicle', () => {
  audio.engineOff();
  audio.setSkid(0);
  traffic.playerVehicle = null;
});
Bus.on('enterVehicle', ({ vehicle }) => { traffic.playerVehicle = vehicle; });

// --- garage : les véhicules achetés apparaissent réellement devant l'atelier ---
const GARAGE = { x: 39.4, z: -112, heading: 0 };
function syncGarage() {
  traffic.clearOwned();
  const spec = economy.upgrades;
  economy.ownedCars.slice(0, economy.garageSlots).forEach((car, i) => {
    const x = GARAGE.x;
    const z = GARAGE.z + i * 7.5;
    traffic.spawnOwned(car, x, z, GARAGE.heading, {
      // les améliorations portent sur le moteur, les pneus et les freins
      topSpeed: economy.specFor(car.type, car.upgrades).topSpeed,
      grip: economy.specFor(car.type, car.upgrades).grip,
      accel: economy.specFor(car.type, car.upgrades).accel,
    });
  });
}
Bus.on('economyChanged', () => { syncGarage(); ui.shopOpen && ui._refreshShop(ctx); });

// --- accès aux toits des immeubles possédés (E) ---
function toggleRoof() {
  if (player.vehicle) return;
  const h = economy.nearestOwnedRoof(player.pos);
  if (!h) return;
  const b = h.building;
  if (player.pos.y > 1.2) {
    // redescendre : hall d'entrée
    player.pos.set(b.door.x, city.groundY(b.door.x, b.door.z), b.door.z);
    player.vy = 0;
    Bus.emit('toast', { text: '🛗 Rez-de-chaussée', kind: '' });
  } else {
    const r = city.roofPoint(b);
    player.pos.set(r.x, r.y, r.z);
    player.vy = 0; player.grounded = true;
    player._camPos.set(r.x, r.y + 3, r.z + 7);
    Bus.emit('toast', { text: `🏙️ Toit du ${h.label} — ${b.h.toFixed(0)} m d'altitude`, kind: 'good' });
  }
  audio.click();
}
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyE' && !e.repeat) toggleRoof();
});

// --- boutique (B) : une seule fenêtre, ouverte/fermée au clavier ou manette ---
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyB' && !e.repeat) { ui.toggleShop(ctx); }
  if (e.code === 'Escape' && ui.shopOpen) ui.closeShop();
});
document.getElementById('tb-settings')?.addEventListener('click', () => menu.toggle());

// ------------------------------- Raccourcis ---------------------------------
addEventListener('keydown', (e) => {
  if (!started) return;
  if (ctx.paused) return;                  // menu ouvert : le jeu est figé
  if (e.code === 'KeyR' && !e.repeat) player.recenterCamera();
  else if (e.code === 'KeyT') env.advanceTime(3);
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
let autosaveT = 12, debugT = 0, fpsAvg = 60, firstFrame = true, qualT = 3;

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  if (dt > 0) fpsAvg = fpsAvg * 0.95 + (1 / dt) * 0.05;
  // qualité adaptative : la résolution suit la charge GPU réelle
  qualT -= dt;
  if (qualT <= 0) {
    qualT = 2.5;
    if (fpsAvg < 48 && renderScale > 0.75) {
      renderScale = Math.max(0.75, renderScale - 0.15);
      renderer.setPixelRatio(renderScale);
    } else if (fpsAvg > 58 && renderScale < MAX_DPR) {
      renderScale = Math.min(MAX_DPR, renderScale + 0.1);
      renderer.setPixelRatio(renderScale);
    }
  }

  // Le menu est toujours mis à jour (il doit pouvoir s'ouvrir), mais le monde
  // est FIGÉ quand il est ouvert : c'est une vraie pause, pas un overlay.
  menu.update(dt, ctx);
  const simDt = ctx.paused ? 0 : dt;
  env.update(simDt, ctx);
  city.update(simDt, ctx);
  if (!ctx.paused) {
    traffic.update(dt, ctx);
    peds.update(dt, ctx);
  }

  if (started && !ctx.paused) {
    player.update(dt, ctx);
    // accès toit : prioritaire quand on est devant un immeuble possédé
    if (!player.vehicle) {
      const h = economy.nearestOwnedRoof(player.pos);
      if (h) ui.setPrompt(player.pos.y > 1.2 ? `Descendre — ${h.label} (E)` : `Monter au toit — ${h.label} (E)`);
    }
    missions.update(dt, ctx);
    gps.update(dt, ctx);
    ui.update(dt, ctx);
    autosaveT -= dt;
    if (autosaveT <= 0) { autosaveT = 12; ctx.saveNow(); }
    debugT -= dt;
    if (debugT <= 0 && ui.debugVisible) {
      debugT = 0.25;
      const ts = traffic.stats(), ps = peds.stats(), pp = ctx.playerPos(), as = Assets.stats();
      const pv = ctx.playerVehicle;
      ui.setDebug(
        `METROPOLIS DEBUG (F1)\n` +
        `FPS ${fpsAvg.toFixed(0)} · draw ${renderer.info.render.calls} · tris ${(renderer.info.render.triangles / 1000).toFixed(0)}k · res ×${renderScale.toFixed(2)}\n` +
        `Heure ${env.formatHour()} · ${env.weatherName} (pluie ${env.rainIntensity.toFixed(2)})\n` +
        `Gameplay : grip ×${env.gripFactor.toFixed(2)} · trafic ×${env.trafficFactor.toFixed(2)}\n` +
        `Trafic : ${ts.total} véhicules (${ts.ai} IA, ${ts.police} police) · cible ${traffic.trafficTarget(env.hour)}\n` +
        `PNJ : ${ps.visible}/${ps.total} visibles (${ps.walking} en marche)\n` +
        `Assets 3D : ${as.vehicles} véhicules, ${as.citizens} citoyens${as.ready ? '' : ' (repli primitives)'}\n` +
        `Wanted : ${ts.wanted}★ (heat ${traffic.heat.toFixed(2)})\n` +
        `Joueur : (${pp.x.toFixed(0)}, ${pp.z.toFixed(0)}) ${pv ? `· ${pv.typeName} ${Math.round(pv.speedKmh())} km/h · dégâts ${Math.round(pv.damage * 100)}%` : '· à pied'}\n` +
        `Métropole : ${city.chunks.size} chunks · ${(city.nodes.length - 1) * CFG.city.pitch / 1000} km de côté\n` +
        `GPS : ${gps.route.length} nœuds · ${gps.arrows.count} flèches\n` +
        `Économie : $${Math.round(economy.money)} · ${economy.ownedCars.length}/${economy.garageSlots} véhicules · ${economy.ownedHouses.length} logement(s)\n` +
        `LOD sim : <70m plein · <170m /4 · au-delà /24`);
    }
    if (ctx.gps) ctx.gps.hintT = (ctx.gps.hintT || 0) + dt;
  } else if (!started) {
    titleCamera(t);
  }

  renderer.render(scene, camera);
  if (firstFrame) {
    firstFrame = false;
    document.getElementById('loading').style.display = 'none';
  }
}
loop();
}

// Démarrage : le chargement des assets est asynchrone (parsing GLB), tout le
// reste de l'initialisation se fait ensuite, de façon séquentielle.
boot().catch((err) => {
  console.error('[METROPOLIS] démarrage :', err);
  const el = document.getElementById('loading');
  if (el) {
    el.textContent = '⚠ Impossible de démarrer : ' + (err?.message ?? err);
    el.style.display = 'flex';
  }
});
