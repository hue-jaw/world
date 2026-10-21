// ============================================================================
// METROPOLIS — vehicles.js
// Véhicules : meshes procéduraux data-driven, physique arcade (modèle
// bicyclette + adhérence latérale), IA trafic sur graphe routier, police.
// Équivalent UE5 : Chaos Wheeled Vehicle + Mass Traffic / ZoneGraph.
// ============================================================================
import * as THREE from 'three';
import { CFG, Bus, clamp, lerp, damp, angleDelta, pick, rand, randRange, randInt, VEHICLE_TYPES, randomVehicleType } from './core.js';
import { DIRS, RING } from './city.js';
import Assets from './assets.js';

const V3 = () => new THREE.Vector3();
// Multiplicateur global de reflets (mode RTX / qualité lumière). Les véhicules
// apparaissent en continu : sans ce levier, ceux créés après le réglage
// garderaient l'ancienne valeur — incohérence visible entre deux voitures.
let MAT_BOOST = 1;
export function setVehicleMaterialBoost(v) { MAT_BOOST = Math.max(0.2, v || 1); }
// Matériau partagé : halo de phares au sol (piloté globalement jour/nuit)
export const headlightGlowMat = new THREE.MeshBasicMaterial({
  color: 0xffe9b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });

const glassMat = new THREE.MeshStandardMaterial({ color: 0x16202c, roughness: 0.15, metalness: 0.85 });
const tireMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95 });
const hubMat = new THREE.MeshStandardMaterial({ color: 0xb9c0c9, roughness: 0.35, metalness: 0.7 });


// ---------------------------------------------------------------------------
//                       CONDUCTEUR VISIBLE DANS L'HABITACLE
// ---------------------------------------------------------------------------
/**
 * Un conducteur assis, cloné depuis la bibliothèque de personnages CC0.
 * On ne cherche pas une pose parfaite (aucun rig de conduite fourni) : une
 * silhouette assise, mains vers le volant, tête au niveau du pavillon, suffit
 * à ce que l'habitacle ne soit plus vide — exigence explicite du joueur.
 *
 * Le clone est décoré d'une ceinture sombre pour lire « conducteur attaché »
 * et se distingue du piéton par sa pose figée (aucun cycle de marche).
 */
function buildDriverFigure() {
  // Choix assumé : silhouette PROCÉDURALE fusionnée en une seule géométrie.
  // Un personnage riggé par véhicule coûterait un squelette + plusieurs draw
  // calls × ~25 véhicules ; ici c'est 1 draw call par voiture, posé une fois.
  // À travers des vitres teintées, la lecture « quelqu'un conduit » est
  // immédiate — c'est exactement l'exigence.
  const parts = [];
  const add = (geo, color, x, y, z, rx = 0, rz = 0) => {
    const g2 = geo.clone();
    g2.rotateX(rx); g2.rotateZ(rz); g2.translate(x, y, z);
    const n = g2.attributes.position.count;
    const col = new Float32Array(n * 3);
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g2.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const k of Object.keys(g2.attributes)) if (!['position', 'normal', 'color'].includes(k)) g2.deleteAttribute(k);
    parts.push(g2);
  };
  const SKIN = 0xd9a882, SHIRT = 0x33404f, PANTS = 0x24272e, HAIR = 0x2a2118;
  // buste + épaules
  add(new THREE.BoxGeometry(0.40, 0.50, 0.24), SHIRT, 0, 0.25, 0);
  add(new THREE.CapsuleGeometry(0.10, 0.20, 3, 6), SKIN, 0, 0.60, 0.02);        // cou + tête
  add(new THREE.SphereGeometry(0.105, 8, 6), SKIN, 0, 0.66, 0.02);
  add(new THREE.SphereGeometry(0.108, 8, 5), HAIR, 0, 0.70, 0.00);              // cheveux
  // bras tendus vers le volant
  for (const sx of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.043, 0.05, 0.34, 6), SKIN, sx * 0.19, 0.33, 0.17, 1.15, 0);
    add(new THREE.SphereGeometry(0.045, 6, 5), SKIN, sx * 0.16, 0.34, 0.33);    // mains
  }
  // jambes repliées
  for (const sx of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.062, 0.07, 0.30, 6), PANTS, sx * 0.11, 0.09, 0.13, 1.35, 0);
    add(new THREE.CylinderGeometry(0.055, 0.05, 0.30, 6), PANTS, sx * 0.11, -0.08, 0.30, 0.15, 0);
  }
  // fusion manuelle (pas de dépendance à BufferGeometryUtils)
  let total = 0, totalIdx = 0;
  for (const g2 of parts) { total += g2.attributes.position.count; totalIdx += g2.index ? g2.index.count : g2.attributes.position.count; }
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), colA = new Float32Array(total * 3);
  const index = new Uint32Array(totalIdx);
  let vo = 0, io = 0;
  for (const g2 of parts) {
    const p2 = g2.attributes.position, n2 = g2.attributes.normal, c2 = g2.attributes.color;
    pos.set(p2.array, vo * 3); nor.set(n2.array, vo * 3); colA.set(c2.array, vo * 3);
    const src = g2.index ? g2.index.array : null;
    const cnt = src ? src.length : p2.count;
    for (let i = 0; i < cnt; i++) index[io + i] = (src ? src[i] : i) + vo;
    vo += p2.count; io += cnt;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colA, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.05 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'seated_driver';
  mesh.castShadow = false;   // inutile à l'intérieur de l'habitacle
  return mesh;
}

// ------------------------- Construction du mesh ----------------------------
function buildVehicleMesh(typeName) {
  const t = VEHICLE_TYPES[typeName];
  const color = pick(t.colors);
  const g = new THREE.Group();
  // Peinture automobile : clair métallisé + vernis (clearcoat). C'est ce qui
  // distingue une carrosserie « Forza » d'un simple plastique coloré : deux
  // lobes de reflet (base + vernis) au lieu d'un seul.
  const paint = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.30,
    metalness: 0.62,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.25 * MAT_BOOST,
  });

  // Modèle 3D (Kenney, CC0) si la bibliothèque est chargée ; sinon les
  // primitives ci-dessous prennent le relais — le jeu ne casse jamais.
  const model = Assets.makeVehicle(typeName);
  let wheelR = typeName === 'SUV' || typeName === 'Utilitaire' ? 0.38 : 0.33;
  let bodyY = 0.8;
  let roofY = 1.4;
  let wheels = [];
  let frontPivots = [];

  if (model) {
    g.add(model.group);
    wheels = model.wheels;
    frontPivots = model.frontWheels;
    wheelR = model.wheelRadius;
    roofY = model.height;
    bodyY = model.height * 0.42;
  } else {
  const body = new THREE.Mesh(new THREE.BoxGeometry(t.wid, t.bodyH, t.len), paint);
  body.position.y = bodyY; body.castShadow = true; g.add(body);
  // nez légèrement abaissé (capot)
  const hood = new THREE.Mesh(new THREE.BoxGeometry(t.wid * 0.94, t.bodyH * 0.55, t.len * 0.2), paint);
  hood.position.set(0, bodyY + t.bodyH * 0.18, t.len * 0.38); hood.castShadow = true; g.add(hood);

  if (t.cabinH > 0) {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(t.wid * 0.84, t.cabinH, t.len * (t.van ? 0.2 : 0.48)), glassMat);
    cabin.position.set(0, bodyY + t.bodyH / 2 + t.cabinH / 2 - 0.04, t.van ? t.len * 0.32 : -t.len * 0.04);
    cabin.castShadow = true; g.add(cabin);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(t.wid * 0.8, 0.07, t.len * 0.44), paint);
    roof.position.set(0, cabin.position.y + t.cabinH / 2 + 0.03, cabin.position.z); g.add(roof);
    if (t.taxi) {
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.34),
        new THREE.MeshStandardMaterial({ color: 0xffdf6b, emissive: 0xffc21c, emissiveIntensity: 0.55 }));
      sign.position.set(0, roof.position.y + 0.16, cabin.position.z); g.add(sign);
    }
    if (t.police) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(t.wid + 0.04, t.bodyH * 0.42, t.len * 0.96),
        new THREE.MeshStandardMaterial({ color: 0x1663c7, roughness: 0.4 }));
      stripe.position.y = bodyY; g.add(stripe);
    }
  } else { // utilitaire : caisse + pare-brise
    const shield = new THREE.Mesh(new THREE.BoxGeometry(t.wid * 0.86, 0.55, 0.08), glassMat);
    shield.position.set(0, bodyY + t.bodyH * 0.18, t.len / 2 - 0.3); shield.rotation.x = -0.28; g.add(shield);
  }
  bodyY = wheelR + t.bodyH / 2 - 0.06;
  roofY = bodyY + t.bodyH / 2 + t.cabinH;
  }

  // Phares / feux stop (matériaux individuels : intensité par véhicule)
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xffedb5, emissiveIntensity: 0.25 });
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 0.35 });
  const lampGeo = new THREE.BoxGeometry(0.34, 0.14, 0.06);
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(lampGeo, headMat); h.position.set(sx * t.wid * 0.33, bodyY + 0.08, t.len / 2 + 0.01); g.add(h);
    const b = new THREE.Mesh(lampGeo, brakeMat); b.position.set(sx * t.wid * 0.33, bodyY + 0.1, -t.len / 2 - 0.01); g.add(b);
  }
  // Halo de phares projeté au sol (visible la nuit)
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(t.wid * 1.7, 8), headlightGlowMat);
  glow.rotation.x = -Math.PI / 2; glow.position.set(0, 0.06, t.len / 2 + 3.6); g.add(glow);

  // Roues procédurales — uniquement si aucun modèle 3D n'est disponible
  // (les modèles fournissent leurs propres nœuds de roue, déjà indexés)
  if (!model) {
    const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, 0.26, 14);
    const hubGeo = new THREE.CylinderGeometry(wheelR * 0.5, wheelR * 0.5, 0.28, 8);
    const wz = t.len / 2 - 0.95, wx = t.wid / 2 - 0.1;
    for (const [sx, sz, front] of [[-1, 1, 1], [1, 1, 1], [-1, -1, 0], [1, -1, 0]]) {
      const pivot = new THREE.Group(); pivot.position.set(sx * wx, wheelR, sz * wz);
      const wheel = new THREE.Mesh(wheelGeo, tireMat); wheel.rotation.z = Math.PI / 2; wheel.castShadow = true;
      const hub = new THREE.Mesh(hubGeo, hubMat); hub.rotation.z = Math.PI / 2; wheel.add(hub);
      pivot.add(wheel); g.add(pivot);
      wheels.push(wheel); if (front) frontPivots.push(pivot);
    }
  }

  // --- conducteur assis (le trafic n'est plus vide) ---
  let driverFig = null;
  if (!t.moto) {
    driverFig = buildDriverFigure();
    if (driverFig) {
      // Repère véhicule : +Z = avant. En conduite à gauche, le conducteur
      // est décalé à gauche de l'axe (x < 0 quand on regarde vers +Z).
      const seatY = bodyY - t.bodyH * 0.30;
      const seatZ = t.van ? t.len * 0.26 : -t.len * 0.02;
      driverFig.position.set(-t.wid * 0.22, seatY, seatZ);
      driverFig.rotation.y = 0;                    // déjà orienté vers l'avant
      driverFig.scale.setScalar(0.92);
      g.add(driverFig);
    } else {
      // Repli : silhouette simple (toujours mieux qu'un habitacle vide)
      const skin = new THREE.MeshStandardMaterial({ color: 0xd7a37a, roughness: 0.8 });
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), skin);
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.22),
        new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.85 }));
      head.position.set(-t.wid * 0.24, bodyY + 0.30, -t.len * 0.05);
      torso.position.set(-t.wid * 0.24, bodyY + 0.02, -t.len * 0.05);
      g.add(head, torso);
      driverFig = torso;
    }
  }

  // Gyrophares police
  let beacon = null;
  if (t.police) {
    beacon = { mats: [], light: null };
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.09, 0.4), new THREE.MeshStandardMaterial({ color: 0x222 }));
    bar.position.set(0, roofY + 0.10, -t.len * 0.04); g.add(bar);
    for (const [sx, col] of [[-1, 0x2255ff], [1, 0xff2222]]) {
      const m = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.17, 0.34), m);
      b.position.set(sx * 0.29, bar.position.y + 0.13, bar.position.z); g.add(b);
      beacon.mats.push(m);
    }
    beacon.light = new THREE.PointLight(0x4466ff, 0, 26, 1.8);
    beacon.light.position.set(0, bar.position.y + 0.7, 0); g.add(beacon.light);
  }
  return { group: g, wheels, frontPivots, headMat, brakeMat, beacon, wheelR, paint, driverFig, glass: model?.glass || null };
}


// ---------------------------------------------------------------------------
//                    FUMÉE DE PNEUS (patinage / drift)
// ---------------------------------------------------------------------------
/**
 * Nuage de particules en `THREE.Points`, pool fixe de 96 puffs : aucune
 * allocation pendant le jeu, un seul draw call, aucun shader custom.
 * Émis depuis les roues arrière quand `driftAmount` dépasse un seuil — c'est
 * le « patinage » visible qui accompagne le crissement.
 */
class TireSmoke {
  constructor(scene) {
    this.max = 96;
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.max * 3);
    this.sizes = new Float32Array(this.max);
    this.alpha = new Float32Array(this.max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    // texture ronde procédurale (32²), générée une fois
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    if (g) {
      const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grd.addColorStop(0, 'rgba(255,255,255,0.9)');
      grd.addColorStop(0.5, 'rgba(235,235,240,0.35)');
      grd.addColorStop(1, 'rgba(220,220,230,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
    }
    const tex = new THREE.CanvasTexture(c);
    this.mat = new THREE.PointsMaterial({
      size: 1.6, map: tex, transparent: true, depthWrite: false,
      opacity: 0.5, blending: THREE.NormalBlending, sizeAttenuation: true,
      color: 0xd8dbe0,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
    this.life = new Float32Array(this.max);
    this.vel = new Float32Array(this.max * 3);
    this.next = 0;
    this._emitT = 0;
    // on masque les particules inactives loin sous le sol
    for (let i = 0; i < this.max; i++) this.positions[i * 3 + 1] = -999;
  }
  emit(x, y, z, vx, vz, count = 2) {
    for (let k = 0; k < count; k++) {
      const i = this.next; this.next = (this.next + 1) % this.max;
      this.positions[i * 3] = x + randRange(-0.35, 0.35);
      this.positions[i * 3 + 1] = y;
      this.positions[i * 3 + 2] = z + randRange(-0.35, 0.35);
      this.vel[i * 3] = vx * 0.25 + randRange(-1.1, 1.1);
      this.vel[i * 3 + 1] = randRange(0.5, 1.5);
      this.vel[i * 3 + 2] = vz * 0.25 + randRange(-1.1, 1.1);
      this.life[i] = randRange(0.75, 1.45);
      this.sizes[i] = randRange(0.9, 1.9);
    }
  }
  update(dt) {
    const pos = this.positions;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      pos[i * 3] += this.vel[i * 3] * dt;
      pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3] *= 0.94; this.vel[i * 3 + 2] *= 0.94;
      this.vel[i * 3 + 1] *= 0.96;
      this.sizes[i] += dt * 2.1;
      this.alpha[i] = clamp(this.life[i] * 0.7, 0, 1);
      if (this.life[i] <= 0) pos[i * 3 + 1] = -999;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aSize.needsUpdate = true;
  }
}

// ================================ Véhicule =================================
let VEH_ID = 1;
export class Vehicle {
  constructor(scene, typeName) {
    this.id = VEH_ID++;
    this.typeName = typeName;
    this.spec = VEHICLE_TYPES[typeName];
    const built = buildVehicleMesh(typeName);
    Object.assign(this, built);
    scene.add(this.group);
    this.pos = this.group.position;
    this.heading = 0;
    this.vel = { x: 0, z: 0 };
    this.vf = 0;                       // vitesse longitudinale (m/s)
    this.steerVisual = 0;
    this.inputs = { throttle: 0, steer: 0, brake: false, handbrake: false };
    this.driver = null;                // null | 'player' | TrafficDriver
    this.parked = false;
    this.damage = 0;
    this.active = true;
    this._crashCd = 0;
    this.radius = this.spec.len * 0.42;
    this.beaconOn = false; this._beaconT = rand() * 10;
    this.spotLights = null;
  }
  forward() { return { x: Math.sin(this.heading), z: Math.cos(this.heading) }; }
  speedKmh() { return Math.abs(this.vf) * 3.6; }
  placeAt(x, z, heading) {
    this.pos.set(x, 0, z); this.heading = heading;
    this.vel.x = this.vel.z = 0; this.vf = 0;
    this.group.rotation.y = heading;
  }
  attachPlayerLights() {
    if (this.spotLights) return;
    this.spotLights = [];
    for (const sx of [-1, 1]) {
      const sp = new THREE.SpotLight(0xffeec2, 0, 55, 0.5, 0.45, 1.2);
      sp.position.set(sx * this.spec.wid * 0.33, 0.85, this.spec.len / 2);
      sp.target.position.set(sx * this.spec.wid * 0.4, 0, this.spec.len / 2 + 18);
      this.group.add(sp, sp.target); this.spotLights.push(sp);
    }
  }
  setHeadlights(on, braking) {
    this.headMat.emissiveIntensity = on ? 3.2 : 0.25;
    this.brakeMat.emissiveIntensity = braking ? 3.4 : (on ? 1.0 : 0.35);
    if (this.spotLights) for (const s of this.spotLights) s.intensity = on ? 60 : 0;
  }

  update(dt, ctx) {
    if (!this.active) return;
    this._crashCd -= dt;
    if (this.parked || !this.driver) { this.brakeMat.emissiveIntensity = 0.15; return; }
    const spec = this.spec, inp = this.inputs;
    const f = this.forward();
    const r = { x: f.z, z: -f.x };                    // vecteur droite
    let vf = this.vel.x * f.x + this.vel.z * f.z;
    let vr = this.vel.x * r.x + this.vel.z * r.z;

    // Moteur / freins
    const dmgFactor = 1 - this.damage * 0.35;
    if (inp.throttle > 0) vf += inp.throttle * spec.accel * dmgFactor * dt * (1 - clamp(vf / spec.topSpeed, 0, 1) * 0.82);
    else if (inp.throttle < 0) {
      if (vf > 0.6) vf -= 16 * dt;                    // freinage
      else vf += inp.throttle * spec.accel * 0.55 * dt; // marche arrière
    }
    if (inp.brake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 20 * dt);
    // frein à main : il bloque les roues ARRIÈRE, pas les quatre. On garde de
    // l'élan (4 m/s²) pour que la glisse dure — c'est ce qui rend le drift
    // contrôlable au lieu d'être un simple tête-à-queue.
    if (inp.handbrake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 4 * dt);
    vf -= vf * 0.35 * dt + Math.sign(vf) * 0.4 * dt;  // traînée + roulement
    if (Math.abs(vf) < 0.05 && inp.throttle === 0) vf = 0;
    vf = clamp(vf, -9, spec.topSpeed);

    // ------------------------------------------------------------------
    // DIRECTION + DÉRIVE (v0.4)
    // Modèle bicyclette, enrichi d'un couple de lacet de survirage quand le
    // frein à main est tiré : la voiture pivote PLUS que ce que le braquage
    // commande, l'arrière décroche, et l'adhérence latérale chute vraiment.
    // C'est ce qui distingue un drift d'un simple freinage.
    // ------------------------------------------------------------------
    const speedAbs = Math.abs(vf);
    const maxSteer = 0.58 / (1 + speedAbs * 0.05);
    const steerAngle = inp.steer * maxSteer;
    const yawFromSteer = (vf / (spec.len * 0.62)) * Math.tan(steerAngle);

    // survirage : n'existe qu'avec du vitesse + du braquage + frein à main
    this.driftAmount = this.driftAmount || 0;
    const handbrakeOn = !!inp.handbrake;
    const driftGate = clamp((speedAbs - 3) / 7, 0, 1) * clamp(Math.abs(inp.steer), 0, 1) * (handbrakeOn ? 1 : 0);
    // inertie : le drift s'installe et se referme progressivement
    this.driftAmount = damp(this.driftAmount, driftGate, handbrakeOn ? 6 : 3.2, dt);
    const oversteer = this.driftAmount * 1.55 * Math.sign(inp.steer) * Math.sign(vf || 1);
    if (speedAbs > 0.1) this.heading += (yawFromSteer + oversteer) * dt;
    this.steerVisual = damp(this.steerVisual, steerAngle, 10, dt);

    // Adhérence latérale : pluie + frein à main. Au frein à main la glisse
    // est RÉELLE (grip 0,10 au lieu de 0,22) et elle est entretenue par le
    // lacet ci-dessus au lieu d'être seulement amortie.
    const gripBase = spec.grip * ctx.env.gripFactor;
    const grip = gripBase * (handbrakeOn ? 0.10 : 1);
    vr *= Math.exp(-grip * dt);
    // le pneu arrière pousse latéralement : on injecte la vitesse de lacet
    if (this.driftAmount > 0.02) {
      const lateralKick = oversteer * spec.len * 0.34;
      vr = clamp(vr + lateralKick * dt * 6, -14, 14);
    }

    const nf = this.forward(); const nr = { x: nf.z, z: -nf.x };
    this.vel.x = nf.x * vf + nr.x * vr;
    this.vel.z = nf.z * vf + nr.z * vr;
    // angle de dérive (degrés) lu par l'audio et les effets
    this.slipAngle = Math.atan2(vr, Math.max(0.6, Math.abs(vf))) * 180 / Math.PI;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.vf = vf;

    // Collisions bâtiments : 2 cercles (avant / arrière)
    const cr = spec.wid * 0.52, off = spec.len * 0.3;
    let pushed = 0;
    for (const s of [1, -1]) {
      const cxp = this.pos.x + nf.x * off * s, czp = this.pos.z + nf.z * off * s;
      const c = ctx.city.collide(cxp, czp, cr);
      const dx = c.x - cxp, dz = c.z - czp;
      if (dx || dz) { this.pos.x += dx; this.pos.z += dz; pushed = Math.max(pushed, Math.hypot(dx, dz)); }
    }
    if (pushed > 0.02) {
      const impact = Math.abs(this.vf);
      this.vel.x *= 0.35; this.vel.z *= 0.35; this.vf *= 0.35;
      if (impact > 5 && this._crashCd <= 0) {
        this._crashCd = 0.8;
        this.damage = clamp(this.damage + impact * 0.012, 0, 1);
        Bus.emit('crash', { pos: { x: this.pos.x, z: this.pos.z }, speed: impact, vehicle: this });
        // Heurter un MUR, un lampadaire ou une bordure n'est pas un délit.
        // Aucun crime n'est émis ici : seuls les délits réels comptent
        // (vol de véhicule, piéton renversé, collision avec un autre véhicule
        // occupé — cf. resolveVehicleCollisions, et refus d'obtempérer).
      }
    }

    // Pose + roues + carrosserie (léger roulis/tangage = vie)
    this.group.rotation.y = this.heading;
    this.group.rotation.z = damp(this.group.rotation.z, clamp(-this.steerVisual * vf * 0.004, -0.05, 0.05), 6, dt);
    this.group.rotation.x = damp(this.group.rotation.x, clamp((inp.throttle > 0 ? -0.012 : inp.throttle < 0 ? 0.014 : 0), -0.03, 0.03), 5, dt);
    for (const w of this.wheels) w.rotation.x += (vf * dt) / this.wheelR;
    for (const p of this.frontPivots) p.rotation.y = this.steerVisual;

    const braking = inp.brake || (inp.throttle < 0 && vf > 0.6) || inp.handbrake;
    this.setHeadlights(ctx.env.headlightsOn, braking);

    // Gyrophares
    if (this.beacon) {
      this._beaconT += dt * 7;
      const ph = Math.sin(this._beaconT) > 0;
      const on = this.beaconOn;
      this.beacon.mats[0].emissiveIntensity = on && ph ? 4 : 0;
      this.beacon.mats[1].emissiveIntensity = on && !ph ? 4 : 0;
      this.beacon.light.intensity = on ? 14 : 0;
      this.beacon.light.color.setHex(ph ? 0x3355ff : 0xff3333);
    }
  }
}

// ============================ Conducteur IA =================================
class TrafficDriver {
  constructor(vehicle, city) {
    this.v = vehicle; this.city = city;
    this.node = null; this.dirIdx = 0; this.destNode = null;
    this.waypoint = V3(); this.engaged = false;
    this.aggressiveness = randRange(0.85, 1.15);
    this.isPolice = false;
  }
  startAt(node, dirIdx) {
    // ne jamais placer une voiture à contresens d'un sens unique
    if (!this.city.canDrive(node, dirIdx)) {
      for (let k = 0; k < 4; k++) if (this.city.canDrive(node, (dirIdx + k) % 4)) { dirIdx = (dirIdx + k) % 4; break; }
    }
    this.node = node; this.dirIdx = dirIdx;
    this.destNode = this.city.randomNode();
    this.city.lanePoint(node, dirIdx, this.waypoint);
    const d = DIRS[dirIdx];
    this.v.placeAt(this.waypoint.x, this.waypoint.z, Math.atan2(d.x, d.z));
    this.advance();
  }
  advance() {
    const next = this.city.nextNode(this.node, this.dirIdx);
    if (!next || !this.city.canDrive(this.node, this.dirIdx)) { this.dirIdx ^= 1; this.advance(); return; }
    this.targetNode = next;
    this.city.lanePoint(next, this.dirIdx, this.waypoint);
    this.engaged = false;
  }
  chooseDirection() {
    // arrivé au nœud cible : choisir la direction suivante (greedy vers destination + bruit)
    this.node = this.targetNode;
    if (!this.isPolice && this.node === this.destNode) this.destNode = this.city.randomNode();
    let best = null, bestScore = 1e18;
    const allowUTurn = { v: false };
    for (let pass = 0; pass < 2 && best === null; pass++) {
      // 1er passage : règles de circulation. 2e : demi-tour de secours si
      // l'intersection est entièrement à sens unique (impasse réglementaire).
      if (pass === 1) allowUTurn.v = true;
      for (let d = 0; d < 4; d++) {
        if (!allowUTurn.v && d === (this.dirIdx ^ 1)) continue;   // pas de demi-tour
        if (!allowUTurn.v && !this.city.canDrive(this.node, d)) continue; // sens interdit
        if (allowUTurn.v && Math.abs(this.node.x - (this.city.canalX ?? -1e9)) < 1 && (d === 2 || d === 3)) continue;
        const n = this.city.nextNode(this.node, d);
        if (!n) continue;
        const dist = Math.hypot(n.x - this.destNode.x, n.z - this.destNode.z);
        const score = dist + rand() * (this.isPolice ? 6 : 55) + (d === this.dirIdx ? -12 : 0);
        if (score < bestScore) { bestScore = score; best = d; }
      }
    }
    if (best === null) best = this.dirIdx ^ 1;             // cul-de-sac au bord
    this.dirIdx = best;
    this.advance();
  }
  update(dt, ctx) {
    const v = this.v, city = this.city;
    const wp = this.waypoint;
    const dx = wp.x - v.pos.x, dz = wp.z - v.pos.z;
    const distWp = Math.hypot(dx, dz);
    if (distWp < 5) this.chooseDirection();

    // Direction visée
    const desired = Math.atan2(dx, dz);
    const err = angleDelta(v.heading, desired);
    v.inputs.steer = clamp(err * 1.7, -1, 1);

    // Vitesse cible
    let target = CFG.traffic.speedLimitMs * this.aggressiveness * ctx.env.trafficFactor;
    if (this.isPolice) target = 21;
    target *= 1 / (1 + Math.abs(err) * 1.5);               // ralentir en virage

    // Feu rouge : s'arrêter à la ligne (11.5 m avant le centre de l'intersection)
    if (!this.isPolice && this.targetNode) {
      const d = DIRS[this.dirIdx];
      const toCenter = (this.targetNode.x - v.pos.x) * d.x + (this.targetNode.z - v.pos.z) * d.z;
      if (toCenter < 9) this.engaged = true;
      if (!this.engaged && toCenter > 0) {
        const axis = d.x !== 0 ? 'EW' : 'NS';
        const st = city.lightState(axis);
        if (st === 'red' || (st === 'amber' && toCenter > 16)) {
          target = Math.min(target, clamp((toCenter - 12.5) * 0.45, 0, target));
        }
      }
    }
    // Véhicule devant / piéton devant
    const ahead = ctx.traffic.vehicleAhead(v, 10.5);
    if (ahead) {
      const gap = ahead.gap;
      target = Math.min(target, gap < 4.6 ? 0 : ahead.vehicle.vf + (gap - 5) * 0.35);
    }
    if (!this.isPolice && ctx.peds?.anyPedAhead(v, 8)) target = 0;

    // --- POURSUITE ---------------------------------------------------------
    // À courte portée : viser le joueur directement, avec un point
    // d'interception (position future estimée) pour ne pas « suivre à la
    // traîne ». À moyenne portée : rouler vite vers son nœud sans respecter
    // les feux. Au-delà : navigation normale (elle doit emprunter les rues).
    if (this.isPolice && this.directTarget) {
      const tp = this.directTarget;
      const ddx = tp.x - v.pos.x, ddz = tp.z - v.pos.z;
      const dd = Math.hypot(ddx, ddz);
      if (dd < 70) {
        // interception : on vise là où le joueur SERA dans ~0,8 s
        const lead = this.targetVel
          ? { x: tp.x + this.targetVel.x * 0.8, z: tp.z + this.targetVel.z * 0.8 }
          : tp;
        const des = Math.atan2(lead.x - v.pos.x, lead.z - v.pos.z);
        v.inputs.steer = clamp(angleDelta(v.heading, des) * 2.1, -1, 1);
        // freiner pour ne pas traverser le joueur, sinon le percuter franchement
        target = dd > 9 ? 26 : (dd > 5.5 ? 8 : 0);
        if (dd < 5.5) v.inputs.handbrake = true;
      } else if (dd < 150) {
        target = 24;   // fonce vers la zone
      }
      // gyrophares + sirène dès qu'une unité est en chasse
      v.beaconOn = true;
    }

    // Traduction vitesse -> pédales
    const vf = v.vf;
    if (vf < target - 0.4) { v.inputs.throttle = 0.9; v.inputs.brake = false; }
    else if (vf > target + 1.2) { v.inputs.throttle = 0; v.inputs.brake = true; }
    else { v.inputs.throttle = target > 0.5 ? 0.25 : 0; v.inputs.brake = target <= 0.05 && vf > 0.3; }
    if (target <= 0.05 && vf <= 0.3) { v.inputs.throttle = 0; v.inputs.brake = true; }
    v.inputs.handbrake = false;
  }
}

// ======================== Conducteur d'autoroute ============================
/**
 * Fait circuler un véhicule sur l'anneau autoroutier (2×2 km), en respectant
 * un couloir. L'anneau est un rectangle : on paramètre la position par une
 * abscisse curviligne `s` et on vise un point situé 22 m devant.
 *
 * Pourquoi un conducteur dédié plutôt que le graphe : le ring traverse la
 * grille tous les 64 m ; y router du trafic par nœuds produirait des
 * demi-tours aux carrefours. Ici, la trajectoire est une simple boucle.
 */
export class HighwayDriver {
  constructor(v, opts = {}) {
    this.v = v;
    this.isHighway = true;
    this.dir = opts.dir ?? 1;              // 1 = sens horaire
    this.lane = opts.lane ?? 7;            // décalage depuis l'axe de l'anneau
    this.speed = opts.speed ?? 26;
    const per = 8 * RING;                  // périmètre
    this.perimeter = per;
    this.s = ((opts.s ?? 0) % per + per) % per;
    this._p = { x: 0, z: 0 };
    this._t = { x: 0, z: 0 };
  }

  /**
   * Point du couloir à l'abscisse curviligne s.
   * On reste TOUJOURS à droite de l'axe de l'anneau (conduite à droite) :
   * le signe du décalage dépend donc du sens de circulation.
   */
  _pointAt(s) {
    const R = RING, side = 2 * R, per = 4 * side;
    let d = ((s % per) + per) % per;
    const lane = this.lane;
    let x = 0, z = 0;
    if (this.dir > 0) {
      // sens 1 : bas (+x) → droite (+z) → haut (-x) → gauche (-z)
      if (d < side) { x = -R + d; z = -R + lane; }
      else if (d < 2 * side) { x = R - lane; z = -R + (d - side); }
      else if (d < 3 * side) { x = R - (d - 2 * side); z = R - lane; }
      else { x = -R + lane; z = R - (d - 3 * side); }
    } else {
      // sens inverse : gauche (+z) → haut (+x) → droite (-z) → bas (-x)
      if (d < side) { x = -R - lane; z = -R + d; }
      else if (d < 2 * side) { x = -R + (d - side); z = R + lane; }
      else if (d < 3 * side) { x = R + lane; z = R - (d - 2 * side); }
      else { x = R - (d - 3 * side); z = -R - lane; }
    }
    this._p.x = x; this._p.z = z;
    return this._p;
  }

  update(dt, ctx) {
    const v = this.v;
    this.s += this.dir * v.vf * dt;
    const target = this._pointAt(this.s + this.dir * 22);
    const dx = target.x - v.pos.x, dz = target.z - v.pos.z;
    const desired = Math.atan2(dx, dz);
    v.inputs.steer = clamp(angleDelta(v.heading, desired) * 2.2, -1, 1);
    if (v.vf < this.speed) v.inputs.throttle = 0.85;
    else if (v.vf > this.speed + 2) { v.inputs.throttle = 0; v.inputs.brake = true; }
    else { v.inputs.throttle = 0.2; v.inputs.brake = false; }
    v.inputs.handbrake = false;
    // recyclage : une voiture qui s'égare est replacée sur le couloir
    if (!Number.isFinite(v.pos.x) || Math.hypot(v.pos.x, v.pos.z) > RING * 2.4) {
      const p = this._pointAt(this.s);
      v.placeAt(p.x, 0, p.z, Math.atan2(1, 0));
    }
  }
}

// ============================ Système trafic ================================
export class TrafficSystem {
  constructor(scene, city) {
    this.scene = scene; this.city = city;
    this.vehicles = [];          // tous les véhicules du monde
    this.aiPool = [];             // véhicules IA recyclables (object pooling)
    this.police = [];
    this.wanted = 0; this.heat = 0; this.bustTimer = 0;
    this._spawnT = 0; this._frame = 0;
    this.smoke = new TireSmoke(scene);
    this.playerVehicle = null;    // renseigné par main.js pour les effets
    this.highway = [];            // trafic de l'anneau autoroutier
    Bus.on('crime', ({ severity }) => this.addHeat(severity));
  }

  init(ctx) {
    // Voitures garées le long des rues (prenables par le joueur)
    for (let i = 0; i < 26; i++) {
      let node = this.city.randomNode();
      // pas de voiture garée dans le lit du canal
      const cx = this.city.canalX ?? -1120;
      for (let t = 0; t < 8 && Math.abs(node.x - cx) < 40; t++) node = this.city.randomNode();
      if (Math.abs(node.x - cx) < 40) continue;
      const dirIdx = randInt(0, 3);
      const d = DIRS[dirIdx], r = { x: -d.z, z: d.x };
      const along = randRange(16, 46);
      const x = node.x + d.x * along + r.x * 7.4;
      const z = node.z + d.z * along + r.z * 7.4;
      if (Math.abs(x) > 235 || Math.abs(z) > 235) continue;
      const v = new Vehicle(this.scene, randomVehicleType());
      v.placeAt(x, z, Math.atan2(d.x, d.z) + (chance2(0.5) ? Math.PI : 0));
      v.parked = true;
      this.vehicles.push(v);
    }
    // Pool IA initial
    for (let i = 0; i < 16; i++) this.spawnAI(ctx, true);
    // Trafic autoroutier : 9 véhicules répartis sur l'anneau, deux sens
    for (let i = 0; i < 9; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const v = new Vehicle(this.scene, randomVehicleType());
      const drv = new HighwayDriver(v, {
        dir, lane: 5.5 + (i % 3) * 2.2,
        s: (i / 9) * 8 * RING, speed: 24 + (i % 3) * 3,
      });
      const p = drv._pointAt(drv.s);
      v.placeAt(p.x, p.z, Math.atan2(dir, 0));
      v.driver = drv;
      v.vel.x = 0; v.vel.z = 0; v.vf = drv.speed * 0.5;
      this.highway.push(v); this.vehicles.push(v);
    }
    // Une sportive offerte près du spawn joueur pour tester tout de suite
    // (garée le long de la route verticale x=32, à ~4 m du trottoir du spawn)
    const gift = new Vehicle(this.scene, 'Sportive');
    gift.placeAt(39.4, 40, 0);
    gift.parked = true;
    this.vehicles.push(gift);
    this.giftCar = gift;
  }

  /** Véhicule possédé (acheté au garage) : garé, conductible, spec améliorée. */
  spawnOwned(car, x, z, heading, spec) {
    const v = new Vehicle(this.scene, car.type);
    if (spec) v.spec = { ...v.spec, ...spec };
    v.placeAt(x, z, heading);
    v.parked = true; v.owned = true; v.carId = car.id;
    this.vehicles.push(v);
    return v;
  }
  clearOwned() {
    for (const v of this.vehicles) {
      if (!v.owned) continue;
      this.scene.remove(v.group);
      v.active = false;
      if (v.spotLights) for (const l of v.spotLights) this.scene.remove(l);
    }
    this.vehicles = this.vehicles.filter((v) => !v.owned);
  }

  trafficTarget(hour) {
    if (hour < 5.5) return 5;
    if (hour < 7) return 10;
    if (hour < 9.5) return 24;            // heure de pointe matin
    if (hour < 16.5) return 16;
    if (hour < 19.5) return 24;           // heure de pointe soir
    if (hour < 22.5) return 12;
    return 6;
  }

  spawnAI(ctx, anywhere = false) {
    let v = this.aiPool.pop();
    if (!v) {
      v = new Vehicle(this.scene, randomVehicleType());
      v.driver = new TrafficDriver(v, this.city);
      this.vehicles.push(v);
    }
    const playerPos = ctx.playerPos();
    for (let tries = 0; tries < 12; tries++) {
      let node = anywhere && tries > 6 ? this.city.randomNode() : this.city.randomEdgeNode();
      if (Math.abs(node.x - (this.city.canalX ?? -1120)) < 40) node = this.city.randomNode();
      const dirIdx = randInt(0, 3);
      if (!this.city.nextNode(node, dirIdx)) continue;
      const distP = Math.hypot(node.x - playerPos.x, node.z - playerPos.z);
      if (!anywhere && distP < CFG.traffic.spawnMinDist) continue;
      if (anywhere && distP < 25) continue;
      v.active = true; v.group.visible = true; v.parked = false; v.damage = 0;
      v.driver.startAt(node, dirIdx);
      return v;
    }
    this.aiPool.push(v);
    return null;
  }
  despawnAI(v) {
    v.active = false; v.group.visible = false;
    v.inputs.throttle = 0;
    this.aiPool.push(v);
  }

  // Véhicule (ou joueur) situé devant `v` dans son couloir
  vehicleAhead(v, maxDist) {
    const f = v.forward();
    let best = null, bestGap = maxDist;
    for (const o of this.vehicles) {
      if (o === v || !o.active) continue;
      const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
      const along = dx * f.x + dz * f.z;
      if (along < 1 || along > maxDist + o.radius) continue;
      const lat = Math.abs(dx * f.z - dz * f.x);
      if (lat > 1.9) continue;
      const gap = along - o.radius - v.radius * 0.5;
      if (gap < bestGap) { bestGap = gap; best = { vehicle: o, gap }; }
    }
    return best;
  }

  nearestEnterable(pos, maxDist = 3.6) {
    let best = null, bd = maxDist;
    for (const v of this.vehicles) {
      if (!v.active || v.driver === 'player') continue;
      if (v.spec.police && v.driver) continue;
      const d = Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z) - v.radius * 0.6;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  playerTakeVehicle(v) {
    const wasDriven = v.driver instanceof TrafficDriver && !v.parked;
    v.parked = false;
    v.driver = 'player';
    v.inputs.throttle = 0; v.inputs.steer = 0;
    v.attachPlayerLights();
    if (wasDriven) Bus.emit('crime', { severity: 2, pos: v.pos }); // vol de véhicule
  }
  playerLeaveVehicle(v) {
    v.driver = null; v.parked = true;
    v.inputs.throttle = 0; v.inputs.steer = 0; v.inputs.brake = true;
    v.vel.x = v.vel.z = 0; v.vf = 0;
    if (v.spotLights) for (const s of v.spotLights) s.intensity = 0;
  }

  // ------------------------------- Police ----------------------------------
  addHeat(sev) { this.heat = clamp(this.heat + sev * 0.55, 0, 3.4); }
  clearWanted() { this.heat = 0; this.wanted = 0; this.bustTimer = 0; }
  /**
   * Cherche un nœud routier où faire apparaître une unité SANS qu'elle sorte
   * de nulle part à l'écran : on privilégie la zone dans le dos de la caméra,
   * entre 110 et 190 m. Si aucun nœud ne convient, on prend le plus lointain
   * disponible — jamais devant le joueur à courte distance.
   */
  _policeSpawnNode(ctx, playerPos) {
    const camYaw = ctx.player?.camYaw ?? 0;
    // direction REGARDÉE par la caméra sur le plan du sol
    const viewX = -Math.sin(camYaw), viewZ = -Math.cos(camYaw);
    const candidates = [];
    for (let k = 0; k < 26; k++) {
      const a = rand() * Math.PI * 2;
      const r = randRange(115, 190);
      const node = this.city.nearestNode(playerPos.x + Math.cos(a) * r, playerPos.z + Math.sin(a) * r);
      if (!node) continue;
      const dx = node.x - playerPos.x, dz = node.z - playerPos.z;
      const d = Math.hypot(dx, dz);
      if (d < 100 || d > 240) continue;
      const inFront = (dx / d) * viewX + (dz / d) * viewZ;   // 1 = pile devant
      candidates.push({ node, d, inFront });
    }
    if (!candidates.length) {
      return this.city.nearestNode(playerPos.x + randRange(-150, 150), playerPos.z + randRange(-150, 150));
    }
    // on privilégie ce qui est DERRIÈRE (inFront < 0) et pas trop loin
    candidates.sort((a, b) => (a.inFront - b.inFront) * 120 + (a.d - b.d) * 0.25);
    return candidates[0].node;
  }

  updatePolice(dt, ctx) {
    this.wanted = this.heat >= 2.6 ? 3 : this.heat >= 1.5 ? 2 : this.heat >= 0.5 ? 1 : 0;
    const wantCount = this.wanted === 0 ? 0 : this.wanted === 1 ? 1 : 2;
    const playerPos = ctx.playerPos();

    // --- réquisition : réutiliser une unité DÉJÀ en patrouille si possible ---
    while (this.police.length < wantCount) {
      const node = this._policeSpawnNode(ctx, playerPos);
      if (!node) break;
      const v = new Vehicle(this.scene, 'Police');
      const drv = new TrafficDriver(v, this.city);
      drv.isPolice = true; drv.aggressiveness = 1.3;
      v.driver = drv;
      drv.startAt(node, randInt(0, 3));
      v.beaconOn = true;
      // elle arrive en sirène : petite accélération de rattrapage
      v.vf = 12;
      this.police.push(v); this.vehicles.push(v);
      // la 1re fois de la session, on prévient le joueur (pas de pop surprise)
      if (!this._spawnNotified) {
        this._spawnNotified = true;
        Bus.emit('toast', { text: '🚨 Une unité converge vers vous — elle arrive par la route', kind: 'bad' });
      }
    }
    // despawn / conduite
    let nearestCopDist = 999;
    for (let i = this.police.length - 1; i >= 0; i--) {
      const v = this.police[i];
      const d = Math.hypot(v.pos.x - playerPos.x, v.pos.z - playerPos.z);
      nearestCopDist = Math.min(nearestCopDist, d);
      if (this.wanted === 0 && d > 60) { // le joueur a semé la police
        this._spawnNotified = false;
        v.active = false; v.group.visible = false;
        this.police.splice(i, 1);
        this.vehicles.splice(this.vehicles.indexOf(v), 1);
        continue;
      }
      const drv = v.driver;
      drv.destNode = this.city.nearestNode(playerPos.x, playerPos.z);
      drv.directTarget = playerPos;
      // vitesse du joueur (pour l'interception) : dérivée de sa position
      if (!this._lastPlayerPos) this._lastPlayerPos = { x: playerPos.x, z: playerPos.z };
      const dtSafe = Math.max(1e-3, dt);
      drv.targetVel = {
        x: (playerPos.x - this._lastPlayerPos.x) / dtSafe,
        z: (playerPos.z - this._lastPlayerPos.z) / dtSafe,
      };
      this._lastPlayerPos.x = playerPos.x; this._lastPlayerPos.z = playerPos.z;
      drv.update(dt, ctx);
    }
    ctx.audio?.setSiren(this.wanted > 0 ? clamp(1 - nearestCopDist / 130, 0, 1) : 0);

    // refroidissement + interpellation
    if (this.wanted > 0) {
      if (nearestCopDist > 95) this.heat = Math.max(0, this.heat - dt * 0.1);
      const playerSpeed = ctx.playerSpeed();
      if (nearestCopDist < 8.5 && playerSpeed < 1.6) {
        this.bustTimer += dt;
        if (this.bustTimer > 0.4 && !this._bustWarned) {
          this._bustWarned = true;
          Bus.emit('toast', { text: '🚓 La police vous interpelle — FUYEZ !', kind: 'bad' });
        }
        if (this.bustTimer > 2.2) { this.clearWanted(); this._bustWarned = false; Bus.emit('busted', {}); }
      } else { this.bustTimer = Math.max(0, this.bustTimer - dt * 2); if (this.bustTimer === 0) this._bustWarned = false; }
    }
  }

  // ------------------------------ Collisions paires ------------------------
  resolveVehicleCollisions(ctx) {
    const list = this.vehicles;
    for (let i = 0; i < list.length; i++) {
      const a = list[i]; if (!a.active) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]; if (!b.active) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const rr = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 > rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, overlap = rr - d;
        const aStatic = a.parked && a.driver !== 'player';
        const bStatic = b.parked && b.driver !== 'player';
        if (!aStatic) { a.pos.x -= nx * overlap * (bStatic ? 1 : 0.5); a.pos.z -= nz * overlap * (bStatic ? 1 : 0.5); }
        if (!bStatic) { b.pos.x += nx * overlap * (aStatic ? 1 : 0.5); b.pos.z += nz * overlap * (aStatic ? 1 : 0.5); }
        const relV = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
        if (relV < 0) {
          const imp = -relV * 0.55;
          if (!aStatic) { a.vel.x -= nx * imp; a.vel.z -= nz * imp; }
          if (!bStatic) { b.vel.x += nx * imp; b.vel.z += nz * imp; }
          if (-relV > 4.5) {
            a.damage = clamp(a.damage + (-relV) * 0.01, 0, 1);
            b.damage = clamp(b.damage + (-relV) * 0.01, 0, 1);
            Bus.emit('crash', { pos: { x: (a.pos.x + b.pos.x) / 2, z: (a.pos.z + b.pos.z) / 2 }, speed: -relV, vehicle: a.driver === 'player' ? a : b });
            if (a.driver === 'player' || b.driver === 'player') {
              ctx.shakeCamera?.(clamp(-relV * 0.02, 0.05, 0.35));
              Bus.emit('crime', { severity: -relV > 9 ? 2 : 1, pos: a.pos });
            }
            // délit de fuite : le conducteur IA panique brièvement
            for (const o of [a, b]) if (o.driver instanceof TrafficDriver) o.driver.aggressiveness = clamp(o.driver.aggressiveness + 0.15, 0.8, 1.4);
          }
        }
      }
    }
  }

  // --------------------------------- Update --------------------------------
  update(dt, ctx) {
    this._frame++;
    const playerPos = ctx.playerPos();
    // densité de trafic selon l'heure (brief §11)
    this._spawnT -= dt;
    const aiCount = this.vehicles.filter((v) => v.active && v.driver instanceof TrafficDriver && !v.driver.isPolice).length;
    if (this._spawnT <= 0) {
      this._spawnT = 0.7;
      if (aiCount < this.trafficTarget(ctx.env.hour)) this.spawnAI(ctx);
    }
    // IA + physique, avec LOD de simulation selon distance joueur
    for (const v of this.vehicles) {
      if (!v.active) continue;
      const drv = v.driver;
      if (drv?.isHighway) drv.update(dt, ctx);
      if (drv instanceof TrafficDriver && !drv.isPolice) {
        const d = Math.hypot(v.pos.x - playerPos.x, v.pos.z - playerPos.z);
        if (d > CFG.traffic.despawnDist) { this.despawnAI(v); continue; }
        const tickEvery = d < CFG.perf.lodNear ? 1 : d < CFG.perf.lodMid ? 3 : 10;
        if ((this._frame + v.id) % tickEvery === 0) drv.update(dt * tickEvery, ctx);
      }
      v.update(dt, ctx);
    }
    this.resolveVehicleCollisions(ctx);
    this.updatePolice(dt, ctx);
    this._driftFx(dt, ctx);
  }

  /**
   * Effets de drift : fumée aux roues arrière du véhicule du joueur et
   * crissement audio proportionnel à la glisse réelle. On ne triche pas :
   * `driftAmount` vient de la physique, donc pas de crissement en ligne
   * droite ni à l'arrêt.
   */
  _driftFx(dt, ctx) {
    this.smoke.update(dt);
    const v = this.playerVehicle;
    if (!v) { ctx.audio?.setSkid?.(0); return; }
    const drift = v.driftAmount || 0;
    const wheelspin = v.inputs.throttle > 0.6 && Math.abs(v.vf) < 6 && v.driver === 'player';
    const amount = clamp(drift * 1.15 + (wheelspin ? 0.35 : 0), 0, 1);
    ctx.audio?.setSkid?.(amount, !!v.inputs.handbrake);
    if (amount > 0.22 && v.driftAmount > 0.18) {
      this.smoke._emitT = (this.smoke._emitT || 0) + dt;
      const period = 0.045;
      while (this.smoke._emitT > period) {
        this.smoke._emitT -= period;
        const f = v.forward();
        for (const sx of [-1, 1]) {
          const rx = f.z * sx * v.spec.wid * 0.36, rz = -f.x * sx * v.spec.wid * 0.36;
          this.smoke.emit(
            v.pos.x - f.x * v.spec.len * 0.33 + rx, 0.28,
            v.pos.z - f.z * v.spec.len * 0.33 + rz,
            -v.vel.x, -v.vel.z, 1);
        }
      }
    }
  }

  stats() {
    const ai = this.vehicles.filter((v) => v.active && v.driver instanceof TrafficDriver).length;
    return { total: this.vehicles.filter((v) => v.active).length, ai, police: this.police.length, wanted: this.wanted };
  }
}
function chance2(p) { return rand() < p; }
