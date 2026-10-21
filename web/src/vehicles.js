// ============================================================================
// METROPOLIS — vehicles.js
// Véhicules : meshes procéduraux data-driven, physique arcade (modèle
// bicyclette + adhérence latérale), IA trafic sur graphe routier, police.
// Équivalent UE5 : Chaos Wheeled Vehicle + Mass Traffic / ZoneGraph.
// ============================================================================
import * as THREE from 'three';
import { CFG, Bus, clamp, lerp, damp, angleDelta, pick, rand, randRange, randInt, VEHICLE_TYPES, randomVehicleType } from './core.js';
import { DIRS } from './city.js';
import Assets from './assets.js';

const V3 = () => new THREE.Vector3();
// Matériau partagé : halo de phares au sol (piloté globalement jour/nuit)
export const headlightGlowMat = new THREE.MeshBasicMaterial({
  color: 0xffe9b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });

const glassMat = new THREE.MeshStandardMaterial({ color: 0x16202c, roughness: 0.15, metalness: 0.85 });
const tireMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95 });
const hubMat = new THREE.MeshStandardMaterial({ color: 0xb9c0c9, roughness: 0.35, metalness: 0.7 });

// ------------------------- Construction du mesh ----------------------------
function buildVehicleMesh(typeName) {
  const t = VEHICLE_TYPES[typeName];
  const color = pick(t.colors);
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.55 });

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
  return { group: g, wheels, frontPivots, headMat, brakeMat, beacon, wheelR, paint };
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
    if (inp.handbrake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 7 * dt);
    vf -= vf * 0.35 * dt + Math.sign(vf) * 0.4 * dt;  // traînée + roulement
    if (Math.abs(vf) < 0.05 && inp.throttle === 0) vf = 0;
    vf = clamp(vf, -9, spec.topSpeed);

    // Direction (modèle bicyclette) — braquage réduit à haute vitesse
    const maxSteer = 0.58 / (1 + Math.abs(vf) * 0.05);
    const steerAngle = inp.steer * maxSteer;
    if (Math.abs(vf) > 0.1) this.heading += (vf / (spec.len * 0.62)) * Math.tan(steerAngle) * dt;
    this.steerVisual = damp(this.steerVisual, steerAngle, 10, dt);

    // Adhérence latérale (grip) — réduite par la pluie et le frein à main
    const grip = spec.grip * ctx.env.gripFactor * (inp.handbrake ? 0.22 : 1);
    vr *= Math.exp(-grip * dt);

    const nf = this.forward(); const nr = { x: nf.z, z: -nf.x };
    this.vel.x = nf.x * vf + nr.x * vr;
    this.vel.z = nf.z * vf + nr.z * vr;
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
        if (this.driver === 'player' && impact > 9) Bus.emit('crime', { severity: 1, pos: this.pos });
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
    this.node = node; this.dirIdx = dirIdx;
    this.destNode = this.city.randomNode();
    this.city.lanePoint(node, dirIdx, this.waypoint);
    const d = DIRS[dirIdx];
    this.v.placeAt(this.waypoint.x, this.waypoint.z, Math.atan2(d.x, d.z));
    this.advance();
  }
  advance() {
    const next = this.city.nextNode(this.node, this.dirIdx);
    if (!next) { this.dirIdx ^= 1; this.advance(); return; }
    this.targetNode = next;
    this.city.lanePoint(next, this.dirIdx, this.waypoint);
    this.engaged = false;
  }
  chooseDirection() {
    // arrivé au nœud cible : choisir la direction suivante (greedy vers destination + bruit)
    this.node = this.targetNode;
    if (!this.isPolice && this.node === this.destNode) this.destNode = this.city.randomNode();
    let best = null, bestScore = 1e18;
    for (let d = 0; d < 4; d++) {
      if (d === (this.dirIdx ^ 1)) continue;               // pas de demi-tour
      const n = this.city.nextNode(this.node, d);
      if (!n) continue;
      const dist = Math.hypot(n.x - this.destNode.x, n.z - this.destNode.z);
      const score = dist + rand() * (this.isPolice ? 6 : 55) + (d === this.dirIdx ? -12 : 0);
      if (score < bestScore) { bestScore = score; best = d; }
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

    // Police : foncer vers sa cible directe quand elle est proche et visible
    if (this.isPolice && this.directTarget) {
      const tp = this.directTarget;
      const ddx = tp.x - v.pos.x, ddz = tp.z - v.pos.z;
      const dd = Math.hypot(ddx, ddz);
      if (dd < 46) {
        const des = Math.atan2(ddx, ddz);
        v.inputs.steer = clamp(angleDelta(v.heading, des) * 1.8, -1, 1);
        target = dd > 10 ? 22 : 4;
      }
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

// ============================ Système trafic ================================
export class TrafficSystem {
  constructor(scene, city) {
    this.scene = scene; this.city = city;
    this.vehicles = [];          // tous les véhicules du monde
    this.aiPool = [];             // véhicules IA recyclables (object pooling)
    this.police = [];
    this.wanted = 0; this.heat = 0; this.bustTimer = 0;
    this._spawnT = 0; this._frame = 0;
    Bus.on('crime', ({ severity }) => this.addHeat(severity));
  }

  init(ctx) {
    // Voitures garées le long des rues (prenables par le joueur)
    for (let i = 0; i < 26; i++) {
      const node = this.city.randomNode();
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
      const node = anywhere && tries > 6 ? this.city.randomNode() : this.city.randomEdgeNode();
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
  updatePolice(dt, ctx) {
    this.wanted = this.heat >= 2.6 ? 3 : this.heat >= 1.5 ? 2 : this.heat >= 0.5 ? 1 : 0;
    const wantCount = this.wanted === 0 ? 0 : this.wanted === 1 ? 1 : 2;
    const playerPos = ctx.playerPos();

    // spawn
    while (this.police.length < wantCount) {
      const v = new Vehicle(this.scene, 'Police');
      const drv = new TrafficDriver(v, this.city);
      drv.isPolice = true; drv.aggressiveness = 1.25;
      v.driver = drv;
      const node = this.city.nearestNode(playerPos.x + randRange(-90, 90), playerPos.z + randRange(-90, 90));
      drv.startAt(node, randInt(0, 3));
      v.beaconOn = true;
      this.police.push(v); this.vehicles.push(v);
    }
    // despawn / conduite
    let nearestCopDist = 999;
    for (let i = this.police.length - 1; i >= 0; i--) {
      const v = this.police[i];
      const d = Math.hypot(v.pos.x - playerPos.x, v.pos.z - playerPos.z);
      nearestCopDist = Math.min(nearestCopDist, d);
      if (this.wanted === 0 && d > 60) { // le joueur a semé la police
        v.active = false; v.group.visible = false;
        this.police.splice(i, 1);
        this.vehicles.splice(this.vehicles.indexOf(v), 1);
        continue;
      }
      const drv = v.driver;
      drv.destNode = this.city.nearestNode(playerPos.x, playerPos.z);
      drv.directTarget = playerPos;
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
  }

  stats() {
    const ai = this.vehicles.filter((v) => v.active && v.driver instanceof TrafficDriver).length;
    return { total: this.vehicles.filter((v) => v.active).length, ai, police: this.police.length, wanted: this.wanted };
  }
}
function chance2(p) { return rand() < p; }
