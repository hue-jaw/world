// ============================================================================
// METROPOLIS — pedestrians.js
// PNJ citoyens : identité (nom, métier, domicile, travail), routines
// quotidiennes, navigation sur graphe trottoirs (BFS), réactions au monde.
// Équivalent UE5 : Mass Entity (foule) + StateTree + ZoneGraph piétons.
// Simulation à 3 niveaux selon distance joueur (brief §21).
// ============================================================================
import * as THREE from 'three';
import { CFG, Bus, clamp, damp, angleDamp, pick, rand, randRange, randInt, chance } from './core.js';
import Assets from './assets.js';

const FIRST = ['Léa', 'Hugo', 'Emma', 'Louis', 'Jade', 'Noah', 'Chloé', 'Lucas', 'Mia', 'Adam', 'Sarah', 'Karim', 'Inès', 'Théo', 'Awa', 'Kenji', 'Maria', 'Ivan', 'Zoé', 'Mehdi'];
const LAST = ['Martin', 'Bernard', 'Dubois', 'Moreau', 'Laurent', 'Diallo', 'Garcia', 'Rossi', 'Kowalski', 'Tanaka', 'Haddad', 'Petit', 'Leroy', 'Fontaine'];
const JOBS = ['Infirmière', 'Développeur', 'Boulanger', 'Enseignante', 'Livreur', 'Architecte', 'Policier', 'Étudiante', 'Commerçant', 'Médecin', 'Ouvrier', 'Retraitée'];

const SKIN = [0xf2c9a4, 0xe0ac84, 0xc68863, 0x8d5524, 0x6b3f22, 0xffdcb8];
const CLOTH = [0xc0392b, 0x2471a3, 0x229954, 0xf39c12, 0x8e44ad, 0x566573, 0xd4ac0d, 0xba4a00, 0x148f77, 0x7d3c98, 0x2e4053, 0xca6f1e, 0xecf0f1];
const PANTS = [0x2c3e50, 0x1a1a2e, 0x5d4037, 0x616a6b, 0x283747, 0x4d5656];

function buildPedMesh(variant = 0) {
  const g = new THREE.Group();
  const prim = new THREE.Group(); g.add(prim);   // corps procédural (secours)
  const skin = new THREE.MeshStandardMaterial({ color: pick(SKIN), roughness: 0.8 });
  const cloth = new THREE.MeshStandardMaterial({ color: pick(CLOTH), roughness: 0.9 });
  const pants = new THREE.MeshStandardMaterial({ color: pick(PANTS), roughness: 0.95 });
  const mkLeg = (sx) => {
    const pivot = new THREE.Group(); pivot.position.set(sx * 0.11, 0.86, 0);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.84, 0.17), pants);
    leg.position.y = -0.42; leg.castShadow = true; pivot.add(leg); prim.add(pivot);
    return pivot;
  };
  const legL = mkLeg(-1), legR = mkLeg(1);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.58, 0.24), cloth);
  torso.position.y = 1.15; torso.castShadow = true; prim.add(torso);
  const mkArm = (sx) => {
    const pivot = new THREE.Group(); pivot.position.set(sx * 0.28, 1.4, 0);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.6, 0.13), cloth);
    arm.position.y = -0.28; arm.castShadow = true; pivot.add(arm); prim.add(pivot);
    return pivot;
  };
  const armL = mkArm(-1), armR = mkArm(1);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.145, 10, 9), skin);
  head.position.y = 1.62; head.castShadow = true; prim.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, 1.5),
    new THREE.MeshStandardMaterial({ color: pick([0x2b1d12, 0x4a2f1a, 0x8a6d3b, 0xd9c9a3, 0x111111, 0x777777]), roughness: 1 }));
  hair.position.y = 1.645; prim.add(hair);
  // parapluie (affiché sous la pluie)
  const umbrella = new THREE.Group();
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.72, 0.3, 8),
    new THREE.MeshStandardMaterial({ color: pick(CLOTH), roughness: 0.7 }));
  canopy.position.y = 0.52; umbrella.add(canopy);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.55),
    new THREE.MeshStandardMaterial({ color: 0x333333 }));
  stick.position.y = 0.24; umbrella.add(stick);
  umbrella.position.set(0.24, 1.62, 0.08); umbrella.visible = false; g.add(umbrella);

  // Modèle 3D riggé si disponible : on masque les primitives (jamais détruites,
  // elles resservent si les assets n'ont pas pu être chargés).
  const rig = Assets.makeCitizen(variant);
  if (rig) {
    prim.visible = false;
    g.add(rig.group);
    umbrella.position.y = rig.height * 0.94;
  }
  return { group: g, prim, rig, legL, legR, armL, armR, umbrella };
}

class Citizen {
  constructor(scene, city, id) {
    this.id = id;
    this.city = city;
    this.name = pick(FIRST) + ' ' + pick(LAST);
    this.job = pick(JOBS);
    this.nightShift = chance(0.14);
    this.wanderer = chance(0.22);
    this.home = city.randomBuilding('home');
    this.work = city.randomBuilding('work');
    this.hasUmbrella = chance(0.6);
    Object.assign(this, buildPedMesh(id));
    scene.add(this.group);
    this.pos = this.group.position;
    this.heading = rand() * Math.PI * 2;
    this.speed = 0; this.walkPhase = rand() * 6;
    this.state = 'walk';
    this.path = []; this.pathIdx = 0;
    this.stateT = 0; this.activity = '';
    this.visible = true;
    // départ : nœud piéton aléatoire
    const n = pick(city.pedNodes);
    this.pos.set(n.x, 0.15, n.z);
    this.planActivity(9, true);
  }

  // ------- routines (brief §7) : activité selon l'heure -------
  activityFor(hour) {
    if (this.wanderer) return (hour > 6.5 && hour < 23) ? 'wander' : 'home';
    let h = this.nightShift ? (hour + 12) % 24 : hour;
    if (h < 6.5) return 'home';
    if (h < 8.5) return 'work';          // trajet du matin
    if (h < 12) return 'work';
    if (h < 13.5) return 'leisure';      // déjeuner
    if (h < 17.5) return 'work';
    if (h < 19.5) return chance(0.4) ? 'shop' : 'home';
    if (h < 22) return chance(0.3) ? 'leisure' : 'home';
    return 'home';
  }
  destFor(activity) {
    if (activity === 'home') return this.home;
    if (activity === 'work') return this.work;
    if (activity === 'shop') return this.city.randomBuilding('shop');
    if (activity === 'leisure') return chance(0.6) ? this.city.randomBuilding('leisure') : this.city.randomBuilding('shop');
    return this.city.randomBuilding();  // wander
  }
  planActivity(hour, force = false) {
    const act = this.activityFor(hour);
    if (!force && act === this.activity && this.state !== 'inside') return;
    this.activity = act;
    const dest = this.destFor(act);
    this.destBuilding = dest;
    this.setPathTo(dest.door.x, dest.door.z);
    this.state = 'walk';
    this.setVisible(true);
  }
  setPathTo(x, z) {
    const from = this.city.nearestPedNode(this.pos.x, this.pos.z);
    const to = this.city.nearestPedNode(x, z);
    const nodes = this.city.pedPath(from, to);
    this.path = nodes.map((n) => ({ x: n.x + randRange(-0.7, 0.7), z: n.z + randRange(-0.7, 0.7) }));
    this.path.push({ x, z });
    this.pathIdx = 0;
  }
  setVisible(v) { this.visible = v; this.group.visible = v; }

  update(dt, ctx, lodTick) {
    const env = ctx.env;
    this.stateT -= dt;
    // replanification aux changements de tranche (vérifié à basse fréquence)
    if (lodTick) {
      const act = this.activityFor(env.hour);
      if (act !== this.activity) this.planActivity(env.hour);
      if (this.state === 'inside' && act !== this.stayActivity) this.planActivity(env.hour, true);
    }
    if (!this.visible) return;

    let moveX = 0, moveZ = 0, targetSpeed = 0;
    const raining = env.rainIntensity > 0.25;
    this.umbrella.visible = raining && this.hasUmbrella;

    if (this.state === 'down') {          // renversé (sans gravité, se relève)
      this.group.rotation.x = -Math.PI / 2;
      if (this.stateT <= 0) { this.state = 'walk'; this.group.rotation.x = 0; }
      return;
    }
    if (this.state === 'witness') {       // regarde un accident
      const t = this.witnessTarget;
      if (t) this.heading = angleDamp(this.heading, Math.atan2(t.x - this.pos.x, t.z - this.pos.z), 6, dt);
      if (this.stateT <= 0) this.state = 'walk';
    } else if (this.state === 'flee') {   // esquive latérale
      moveX = this.fleeDir.x; moveZ = this.fleeDir.z;
      targetSpeed = CFG.pedestrians.runSpeed * 1.25;
      if (this.stateT <= 0) this.state = 'walk';
    } else if (this.state === 'walk') {
      const wp = this.path[this.pathIdx];
      if (!wp) { this.arrive(ctx); return; }
      const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.9) { this.pathIdx++; }
      else {
        moveX = dx / d; moveZ = dz / d;
        targetSpeed = (raining ? CFG.pedestrians.runSpeed * 0.8 : CFG.pedestrians.walkSpeed) * this.paceFactor();
        this.heading = angleDamp(this.heading, Math.atan2(dx, dz), 8, dt);
      }
    }

    this.speed = damp(this.speed, targetSpeed, 6, dt);
    // séparation douce entre piétons
    const sep = ctx.peds.separationFor(this);
    this.pos.x += (moveX * this.speed + sep.x) * dt;
    this.pos.z += (moveZ * this.speed + sep.z) * dt;
    const c = this.city.collide(this.pos.x, this.pos.z, 0.32);
    this.pos.x = c.x; this.pos.z = c.z;
    this.pos.y = damp(this.pos.y, this.city.groundY(this.pos.x, this.pos.z), 14, dt);
    this.group.rotation.y = this.heading;

    // animation procédurale de marche (seulement si proche : LOD)
    const dp = Math.abs(this.pos.x - ctx.playerPos().x) + Math.abs(this.pos.z - ctx.playerPos().z);
    if (dp < 130) {
      this.walkPhase = Assets.advancePhase(this.walkPhase, this.speed, dt);
      if (this.rig) {
        // modèle squeletté : cycle de marche/course calculé sur les os
        const bob = Assets.walkRig(this.rig, this.speed, dt, this.walkPhase);
        this.group.position.y = this.pos.y + bob;
      } else {
        const sw = Math.sin(this.walkPhase) * clamp(this.speed * 0.32, 0, 0.75);
        this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
        this.armL.rotation.x = -sw * 0.8; this.armR.rotation.x = sw * 0.8;
        this.group.position.y = this.pos.y + Math.abs(Math.sin(this.walkPhase)) * 0.035 * clamp(this.speed, 0, 1.6);
      }
    }
    // LOD de rendu : au-delà de 180 m, plus de dessin (mais la simulation continue)
    this.group.visible = this.visible && dp < 130;
  }
  paceFactor() { return this._pace ??= randRange(0.85, 1.2); }
  arrive(ctx) {
    // arrivé à destination : entre dans le bâtiment (sauf parc = reste flâner)
    if (this.destBuilding?.kind === 'leisure' && chance(0.7)) {
      this.state = 'idle'; this.stateT = randRange(6, 16);
      this.activity = 'leisure-stay';
      // petite promenade dans le parc
      this.setPathTo(this.destBuilding.x + randRange(-14, 14), this.destBuilding.z + randRange(-14, 14));
      this.state = 'walk';
      return;
    }
    this.state = 'inside';
    this.stayActivity = this.activity;
    this.setVisible(false);
  }
  onCrashNear(pos) {
    if (!this.visible || this.state === 'down') return;
    const d = Math.hypot(pos.x - this.pos.x, pos.z - this.pos.z);
    if (d < 16) { this.state = 'witness'; this.witnessTarget = pos; this.stateT = randRange(2.2, 4); this.speed = 0; }
  }
}

// ============================== Système PNJ =================================
export class PedestrianSystem {
  constructor(scene, city) {
    this.city = city;
    this.citizens = [];
    this._frame = 0;
    for (let i = 0; i < CFG.pedestrians.poolSize; i++) this.citizens.push(new Citizen(scene, city, i));
    Bus.on('crash', ({ pos }) => { for (const c of this.citizens) c.onCrashNear(pos); });
  }
  separationFor(me) {
    let x = 0, z = 0;
    for (const o of this.citizens) {
      if (o === me || !o.visible) continue;
      const dx = me.pos.x - o.pos.x, dz = me.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.64 && d2 > 1e-5) { const d = Math.sqrt(d2); x += (dx / d) * (0.8 - d); z += (dz / d) * (0.8 - d); }
    }
    return { x: x * 1.6, z: z * 1.6 };
  }
  anyPedAhead(vehicle, dist) {
    const f = vehicle.forward();
    for (const c of this.citizens) {
      if (!c.visible) continue;
      const dx = c.pos.x - vehicle.pos.x, dz = c.pos.z - vehicle.pos.z;
      const along = dx * f.x + dz * f.z;
      if (along < 0.5 || along > dist) continue;
      if (Math.abs(dx * f.z - dz * f.x) < 1.3) return true;
    }
    return false;
  }
  update(dt, ctx) {
    this._frame++;
    const pp = ctx.playerPos();
    const pv = ctx.playerVehicle;
    for (const c of this.citizens) {
      const d = Math.hypot(c.pos.x - pp.x, c.pos.z - pp.z);
      const lod = d < CFG.perf.lodNear ? 1 : d < CFG.perf.lodMid ? 4 : CFG.perf.lodFarTick;
      const isTick = (this._frame + c.id) % lod === 0;
      if (isTick) c.update(dt * lod, ctx, lod > 1 || this._frame % 50 === c.id % 50);

      // Réactions au véhicule du joueur (toujours, c'est du gameplay)
      if (c.visible && pv && d < 14) {
        const speed = Math.abs(pv.vf);
        const f = pv.forward();
        const dx = c.pos.x - pv.pos.x, dz = c.pos.z - pv.pos.z;
        const along = dx * f.x + dz * f.z, lat = dx * f.z - dz * f.x;
        if (speed > 4 && along > 0 && along < 9 && Math.abs(lat) < 1.6 && c.state !== 'flee' && c.state !== 'down') {
          c.state = 'flee'; c.stateT = 0.7;
          const s = lat >= 0 ? 1 : -1;
          c.fleeDir = { x: f.z * s, z: -f.x * s };
          c.heading = Math.atan2(c.fleeDir.x, c.fleeDir.z);
        }
        if (speed > 2.5 && d < 1.35 && c.state !== 'down' && Math.abs(pv.pos.y - c.pos.y) < 2) {
          c.state = 'down'; c.stateT = 2.4;
          Bus.emit('toast', { text: `⚠️ Vous avez renversé ${c.name} !`, kind: 'bad' });
          Bus.emit('crime', { severity: 2, pos: c.pos });
          Bus.emit('crash', { pos: { x: c.pos.x, z: c.pos.z }, speed: 3, vehicle: pv });
          pv.vel.x *= 0.55; pv.vel.z *= 0.55;
        }
      }
    }
  }
  stats() {
    let vis = 0, walk = 0;
    for (const c of this.citizens) { if (c.visible) { vis++; if (c.state === 'walk') walk++; } }
    return { total: this.citizens.length, visible: vis, walking: walk };
  }
}
