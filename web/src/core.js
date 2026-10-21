// ============================================================================
// METROPOLIS — core.js
// Noyau partagé : configuration data-driven, bus d'événements, RNG, maths.
// Équivalent UE5 : Data Assets + GameplayMessageSubsystem + bibliothèques.
// Aucun système ne référence un autre système en dur : tout passe par le
// contexte injecté (ctx) et le bus d'événements.
// ============================================================================

// ----------------------------- Event Bus -----------------------------------
// Découplage inter-systèmes (équivalent : délégués / Gameplay Tags UE5).
class EventBus {
  constructor() { this.map = new Map(); }
  on(evt, fn) {
    if (!this.map.has(evt)) this.map.set(evt, new Set());
    this.map.get(evt).add(fn);
    return () => this.off(evt, fn);
  }
  off(evt, fn) { this.map.get(evt)?.delete(fn); }
  emit(evt, payload) {
    const set = this.map.get(evt);
    if (set) for (const fn of [...set]) { try { fn(payload); } catch (e) { console.error(`[Bus] ${evt}`, e); } }
  }
}
export const Bus = new EventBus();

// Événements officiels (contrat entre systèmes — ne pas renommer sans grep) :
//  'crime'          {severity:1..3, pos}      -> police/wanted
//  'crash'          {pos, speed}             -> témoins PNJ, audio
//  'toast'          {text, kind}             -> UI
//  'missionUpdate'  {}                       -> UI objectif
//  'busted'         {}                       -> game over doux
//  'enterVehicle' / 'exitVehicle' {vehicle}  -> caméra, audio, speedo

// --------------------------- RNG reproductible ------------------------------
// La ville est identique à chaque lancement (seed fixe) : indispensable
// pour tester et déboguer un monde procédural.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rand = mulberry32(20261021);
export const randRange = (min, max) => min + rand() * (max - min);
export const randInt = (min, max) => Math.floor(randRange(min, max + 1));
export const pick = (arr) => arr[Math.floor(rand() * arr.length)];
export const chance = (p) => rand() < p;

// -------------------------------- Maths ------------------------------------
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
// Lissage exponentiel indépendant du framerate (caméras, directions...)
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
export function angleDamp(a, b, lambda, dt) { return angleLerp(a, b, 1 - Math.exp(-lambda * dt)); }
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export const dist2D = (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az);

// --------------------------- Configuration monde ----------------------------
// 1 unité = 1 mètre. Ville en grille : blocs + routes (voir city.js).
export const CFG = {
  city: {
    blocksPerSide: 7,        // cœur détaillé (7x7 blocs = 448 m)
    pitch: 64,               // distance centre-à-centre entre blocs (m)
    platformSize: 46,        // plateau du bloc (trottoirs inclus)
    buildZone: 38,           // zone constructible au centre du bloc
    get roadWidth() { return this.pitch - this.platformSize; }, // 18 m
    laneOffset: 3.4,         // décalage de voie (conduite à droite)
    seed: 20261021,
    // ---- métropole étendue (streamée) ----
    metroBlocks: 128,        // 128 × 64 m = 8,19 km de côté
    chunkBlocks: 4,          // 4 × 4 blocs par chunk de streaming (256 m)
    viewChunks: 2,           // rayon de chunks matérialisés (~640 m)
    get metroHalf() { return (this.metroBlocks * this.pitch) / 2; },
  },
  time: {
    // Cycle réaliste : 20 min de jour (06:00→20:00) + 20 min de nuit.
    daySeconds: 1200,
    nightSeconds: 1200,
    startHour: 9.0,
    dayStart: 6.0, dayEnd: 20.0,
    get dayLengthSec() { return this.daySeconds + this.nightSeconds; },
  },
  traffic: {
    speedLimitMs: 11.5,      // ~41 km/h en ville
    despawnDist: 340,
    spawnMinDist: 130,
  },
  pedestrians: {
    poolSize: 44,            // > 50 PNJ simulés avec le trafic (brief: 20-50)
    walkSpeed: 1.45,
    runSpeed: 3.1,
  },
  perf: {                    // LOD de simulation (brief §21)
    lodNear: 70,             // < 70 m : tick complet chaque frame
    lodMid: 170,             // < 170 m : tick 1 frame / 5
    lodFarTick: 24,          // au-delà : tick 1 frame / 24 (statistique)
  },
};

// ------------------------- Données : véhicules ------------------------------
// Data-driven : ajouter un véhicule = ajouter une ligne ici (UE5: DataAsset).
export const VEHICLE_TYPES = {
  Citadine:  { len: 3.9, wid: 1.75, bodyH: 0.62, cabinH: 0.5,  topSpeed: 33, accel: 7.5,  grip: 9,  colors: [0xc0c6cf, 0x8a94a6, 0x5b7fb9, 0xb94a48, 0x3f4756], weight: 30 },
  Berline:   { len: 4.7, wid: 1.85, bodyH: 0.6,  cabinH: 0.5,  topSpeed: 40, accel: 9,    grip: 10, colors: [0x2b2f36, 0xd8dce2, 0x35507a, 0x6e1423, 0x1f3d2b], weight: 26 },
  SUV:       { len: 4.6, wid: 1.95, bodyH: 0.85, cabinH: 0.65, topSpeed: 36, accel: 8,    grip: 9,  colors: [0x22262c, 0xe8e8e8, 0x7a4a21, 0x2e4a6b, 0x555f6e], weight: 20 },
  Sportive:  { len: 4.4, wid: 1.9,  bodyH: 0.48, cabinH: 0.38, topSpeed: 58, accel: 14,   grip: 12, colors: [0xd7263d, 0xf5d90a, 0xff6b1a, 0x14161a, 0x0a84ff], weight: 7 },
  Taxi:      { len: 4.6, wid: 1.85, bodyH: 0.62, cabinH: 0.52, topSpeed: 38, accel: 8.5,  grip: 10, colors: [0xf7b500], weight: 9, taxi: true },
  Utilitaire:{ len: 5.4, wid: 2.0,  bodyH: 1.5,  cabinH: 0.0,  topSpeed: 30, accel: 6,    grip: 8,  colors: [0xe8e8e8, 0xb9c0c9, 0x8a5a2b], weight: 8, van: true },
  Police:    { len: 4.8, wid: 1.9,  bodyH: 0.62, cabinH: 0.52, topSpeed: 52, accel: 12.5, grip: 11, colors: [0xf2f4f7], weight: 0, police: true },
};
// ---- Moto (2 roues) : ajoutée à la flotte v0.3 ----
VEHICLE_TYPES.Moto = {
  len: 2.15, wid: 0.78, bodyH: 0.5, cabinH: 0, topSpeed: 46, accel: 13.5, grip: 11,
  colors: [0xd7263d, 0x14161a, 0x0a84ff, 0xf5d90a], weight: 10, moto: true,
};

// ------------------------- Économie (brief §12) -----------------------------
// Tout est data-driven : prix dans une table, aucune valeur en dur dans l'UI.
export const ECONOMY = {
  startMoney: 600,
  missionRewardBase: 55,
  // Garage : point fixe du quartier, agrandissable (emplacements + équipements)
  garage: {
    x: 32, z: -150,              // sur la rue, à côté du centre
    levels: [
      { slots: 2, cost: 0,     label: 'Garage 2 places' },
      { slots: 4, cost: 6000,  label: 'Garage 4 places' },
      { slots: 6, cost: 15000, label: 'Atelier 6 places' },
    ],
  },
  // Véhicules achetables (prix en crédits)
  cars: [
    { type: 'Moto',       price: 3200,  label: 'Moto urbaine' },
    { type: 'Citadine',   price: 4500,  label: 'Citadine' },
    { type: 'Berline',    price: 7800,  label: 'Berline' },
    { type: 'Taxi',       price: 9000,  label: 'Taxi' },
    { type: 'SUV',        price: 11500, label: 'SUV' },
    { type: 'Utilitaire', price: 9800,  label: 'Utilitaire' },
    { type: 'Sportive',   price: 24000, label: 'Sportive' },
  ],
  upgrades: {
    moteur: { label: 'Moteur',  stat: 'topSpeed', costs: [1800, 4200, 9000],  perLevel: 0.10, unit: 'km/h' },
    pneus:  { label: 'Pneus',   stat: 'grip',     costs: [1200, 3000, 6800],  perLevel: 0.09 },
    freins: { label: 'Freins',  stat: 'accel',    costs: [1000, 2600, 6000],  perLevel: 0.10 },
  },
  housing: {
    count: 8,                 // logements achetables générés dans le cœur
    basePrice: 5000,
    pricePerMeter: 260,       // prix ≈ base + hauteur × ce facteur
    maxPrice: 42000,
  },
  health: { max: 100, fallSafe: 9.5, fallDamage: 7, regenPerSec: 1.6, hospitalCost: 250 },
};

export function randomVehicleType() {
  const entries = Object.entries(VEHICLE_TYPES).filter(([, v]) => v.weight > 0);
  const total = entries.reduce((s, [, v]) => s + v.weight, 0);
  let r = rand() * total;
  for (const [name, v] of entries) { r -= v.weight; if (r <= 0) return name; }
  return 'Berline';
}

// -------------------------- Données : météo ---------------------------------
export const WEATHER_STATES = {
  Clear:  { label: '☀️ Dégagé',    rain: 0,   cloud: 0.05, fogDensity: 0.0012, gripFactor: 1.0,  trafficFactor: 1.0,  lightning: false },
  Cloudy: { label: '⛅ Nuageux',   rain: 0,   cloud: 0.75, fogDensity: 0.0022, gripFactor: 1.0,  trafficFactor: 0.95, lightning: false },
  Rain:   { label: '🌧️ Pluie',     rain: 0.7, cloud: 0.9,  fogDensity: 0.0032, gripFactor: 0.74, trafficFactor: 0.72, lightning: false },
  Storm:  { label: '⛈️ Orage',     rain: 1.0, cloud: 1.0,  fogDensity: 0.0042, gripFactor: 0.66, trafficFactor: 0.6,  lightning: true },
  Fog:    { label: '🌫️ Brouillard', rain: 0,  cloud: 0.5,  fogDensity: 0.013,  gripFactor: 0.92, trafficFactor: 0.65, lightning: false },
};

// ------------------------- Données : quartiers ------------------------------
// Chaque bloc reçoit un type de quartier -> architecture/densité différentes
// (brief §4). distanceToCenter décide : centre dense, périphérie basse.
export function districtForBlock(bi, bj, n) {
  const c = (n - 1) / 2;
  const d = Math.max(Math.abs(bi - c), Math.abs(bj - c)); // anneau 0,1,2,3
  if (d === 0) return 'downtown';
  if (d === 1) return chance(0.6) ? 'commercial' : 'downtown';
  if (d === 2) return pick(['residential', 'residential', 'commercial', 'oldtown']);
  return pick(['residential', 'suburb', 'industrial', 'suburb']);
}
export const DISTRICTS = {
  downtown:    { minH: 28, maxH: 62, buildings: [1, 2], palettes: ['glass', 'glass', 'office'] },
  commercial:  { minH: 10, maxH: 26, buildings: [2, 3], palettes: ['office', 'shop', 'glass'] },
  residential: { minH: 8,  maxH: 18, buildings: [2, 4], palettes: ['brick', 'plaster', 'plaster'] },
  oldtown:     { minH: 6,  maxH: 12, buildings: [3, 4], palettes: ['brick', 'oldbrick'] },
  suburb:      { minH: 4,  maxH: 7,  buildings: [3, 4], palettes: ['house', 'house', 'plaster'] },
  industrial:  { minH: 6,  maxH: 11, buildings: [1, 2], palettes: ['warehouse', 'warehouse', 'office'] },
};
