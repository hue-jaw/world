// ============================================================================
// METROPOLIS — player.js
// Personnage 3e personne, caméra contextuelle (à pied / véhicule),
// entrées clavier+souris, interaction générique (entrer/sortir véhicule).
// Équivalent UE5 : ACharacter + Enhanced Input + Camera Boom + Possess.
// ============================================================================
import * as THREE from 'three';
import { Bus, clamp, damp, angleDamp } from './core.js';

// Coin de trottoir a l'intersection (32,32) : garanti sans batiment.
const SPAWN = { x: 42.5, z: 42.5 };
const SPAWN_HEADING = -2.36;   // face a l'intersection / au centre-ville

function buildPlayerMesh() {
  const g = new THREE.Group();
  const jacket = new THREE.MeshStandardMaterial({ color: 0xe67e22, roughness: 0.85 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x22304a, roughness: 0.95 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe8b48c, roughness: 0.8 });
  const mkLeg = (sx) => {
    const p = new THREE.Group(); p.position.set(sx * 0.11, 0.88, 0);
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.86, 0.18), pants);
    l.position.y = -0.43; l.castShadow = true; p.add(l); g.add(p); return p;
  };
  const legL = mkLeg(-1), legR = mkLeg(1);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.6, 0.26), jacket);
  torso.position.y = 1.18; torso.castShadow = true; g.add(torso);
  const mkArm = (sx) => {
    const p = new THREE.Group(); p.position.set(sx * 0.29, 1.43, 0);
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.62, 0.14), jacket);
    a.position.y = -0.29; a.castShadow = true; p.add(a); g.add(p); return p;
  };
  const armL = mkArm(-1), armR = mkArm(1);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), skin);
  head.position.y = 1.66; head.castShadow = true; g.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.09, 10),
    new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.8 }));
  cap.position.y = 1.78; g.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.16), cap.material);
  brim.position.set(0, 1.75, 0.2); g.add(brim);
  return { group: g, legL, legR, armL, armR };
}

export class Player {
  constructor(scene, camera, rendererDom) {
    Object.assign(this, buildPlayerMesh());
    scene.add(this.group);
    this.camera = camera;
    this.pos = this.group.position;
    this.pos.set(SPAWN.x, 0, SPAWN.z);
    this.vel = new THREE.Vector3();
    this.heading = SPAWN_HEADING;
    this.vy = 0; this.grounded = true;
    this.walkPhase = 0;
    this.vehicle = null;                 // véhicule possédé ou null
    this.steerInput = 0;
    // caméra
    this.camYaw = SPAWN_HEADING + Math.PI; this.camPitch = 0.32; this.camDist = 7;
    this.shake = 0;
    this._camPos = new THREE.Vector3(SPAWN.x, 4, SPAWN.z + 8);
    this.keys = new Set();
    this._bindInput(rendererDom);
  }

  _bindInput(dom) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
      if (e.code === 'KeyF' && !e.repeat) this._wantInteract = true;
      if (e.code === 'KeyH' && this.vehicle) this._wantHonk = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    let dragging = false, lx = 0, ly = 0;
    dom.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('pointerup', () => { dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.camYaw -= (e.clientX - lx) * 0.0052;
      this.camPitch = clamp(this.camPitch + (e.clientY - ly) * 0.004, -0.15, 1.15);
      lx = e.clientX; ly = e.clientY;
      this._camFreeT = 2.2;              // la caméra véhicule se recentre après 2,2 s
    });
    dom.addEventListener('wheel', (e) => {
      this.camDist = clamp(this.camDist + Math.sign(e.deltaY) * 1.1, 3.5, 13);
    }, { passive: true });
  }
  key(...codes) { return codes.some((c) => this.keys.has(c)); }

  getPos() { return this.vehicle ? this.vehicle.pos : this.pos; }
  getSpeed() { return this.vehicle ? Math.abs(this.vehicle.vf) : Math.hypot(this.vel.x, this.vel.z); }
  getHeading() { return this.vehicle ? this.vehicle.heading : this.heading; }

  resetToSpawn(ctx) {
    if (this.vehicle) { ctx.traffic.playerLeaveVehicle(this.vehicle); this.vehicle = null; }
    this.group.visible = true;
    this.pos.set(SPAWN.x, 0, SPAWN.z);
    this.vel.set(0, 0, 0); this.heading = SPAWN_HEADING; this.camYaw = SPAWN_HEADING + Math.PI;
    Bus.emit('exitVehicle', {});
  }

  // ------------------------------ Interaction ------------------------------
  _tryInteract(ctx) {
    if (this.vehicle) {
      const v = this.vehicle;
      ctx.traffic.playerLeaveVehicle(v);
      // ressortir côté conducteur (gauche du véhicule)
      const r = { x: Math.cos(v.heading), z: -Math.sin(v.heading) };
      let ex = v.pos.x - r.x * (v.spec.wid / 2 + 0.9);
      let ez = v.pos.z - r.z * (v.spec.wid / 2 + 0.9);
      const c = ctx.city.collide(ex, ez, 0.4);
      this.pos.set(c.x, ctx.city.groundY(c.x, c.z), c.z);
      this.heading = v.heading;
      this.vehicle = null;
      this.group.visible = true;
      ctx.playerVehicle = null;
      Bus.emit('exitVehicle', { vehicle: v });
    } else {
      const v = ctx.traffic.nearestEnterable(this.pos);
      if (!v) return;
      ctx.traffic.playerTakeVehicle(v);
      this.vehicle = v;
      ctx.playerVehicle = v;
      this.group.visible = false;
      this.camYaw = v.heading + Math.PI;   // caméra derrière le véhicule
      Bus.emit('enterVehicle', { vehicle: v });
      Bus.emit('toast', { text: `🚗 ${v.typeName} — Z/S accélérer/freiner · Q/D diriger · F sortir`, kind: '' });
    }
  }

  // -------------------------------- Update ---------------------------------
  update(dt, ctx) {
    if (this._wantInteract) { this._wantInteract = false; this._tryInteract(ctx); }
    if (this._wantHonk) { this._wantHonk = false; ctx.audio?.honk(); }
    this._camFreeT = Math.max(0, (this._camFreeT || 0) - dt);
    if (this.vehicle) this._updateDriving(dt, ctx); else this._updateOnFoot(dt, ctx);
    this._updateCamera(dt, ctx);
    // prompt d'interaction contextuel
    if (!this.vehicle) {
      const v = ctx.traffic.nearestEnterable(this.pos);
      ctx.ui.setPrompt(v ? `Entrer dans le véhicule (${v.typeName})` : null);
    } else ctx.ui.setPrompt(null);
  }

  _updateOnFoot(dt, ctx) {
    const fwd = this.key('KeyW', 'ArrowUp') ? 1 : this.key('KeyS', 'ArrowDown') ? -1 : 0;
    const strafe = this.key('KeyD', 'ArrowRight') ? 1 : this.key('KeyA', 'ArrowLeft') ? -1 : 0;
    const sprint = this.key('ShiftLeft', 'ShiftRight');
    const speed = sprint ? 6.6 : 3.3;
    // directions relatives à la caméra
    const sin = Math.sin(this.camYaw), cos = Math.cos(this.camYaw);
    let mx = (-sin * fwd + cos * strafe);   // la caméra regarde vers -forward(heading=camYaw+PI)
    let mz = (-cos * fwd - sin * strafe);
    const len = Math.hypot(mx, mz);
    if (len > 0.01) {
      mx /= len; mz /= len;
      this.vel.x = damp(this.vel.x, mx * speed, 10, dt);
      this.vel.z = damp(this.vel.z, mz * speed, 10, dt);
      this.heading = angleDamp(this.heading, Math.atan2(mx, mz), 12, dt);
    } else {
      this.vel.x = damp(this.vel.x, 0, 10, dt);
      this.vel.z = damp(this.vel.z, 0, 10, dt);
    }
    // saut + gravité
    const ground = ctx.city.groundY(this.pos.x, this.pos.z);
    if (this.key('Space') && this.grounded) { this.vy = 7.4; this.grounded = false; }
    this.vy -= 22 * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= ground) { this.pos.y = ground; this.vy = 0; this.grounded = true; }
    const c = ctx.city.collide(this.pos.x, this.pos.z, 0.38);
    this.pos.x = c.x; this.pos.z = c.z;
    this.group.rotation.y = this.heading;
    // animation de marche
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.walkPhase += dt * (2 + sp * 2.4);
    const sw = this.grounded ? Math.sin(this.walkPhase) * clamp(sp * 0.14, 0, 0.8) : 0.35;
    this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
    this.armL.rotation.x = -sw * 0.85; this.armR.rotation.x = sw * 0.85;
  }

  _updateDriving(dt, ctx) {
    const v = this.vehicle;
    const up = this.key('KeyW', 'ArrowUp'), down = this.key('KeyS', 'ArrowDown');
    v.inputs.throttle = up ? 1 : down ? -1 : 0;
    const steerTarget = this.key('KeyA', 'ArrowLeft') ? 1 : this.key('KeyD', 'ArrowRight') ? -1 : 0;
    const rate = steerTarget !== 0 ? 3.4 : 5.5;
    this.steerInput = clamp(this.steerInput + clamp(steerTarget - this.steerInput, -rate * dt, rate * dt), -1, 1);
    v.inputs.steer = this.steerInput;
    v.inputs.handbrake = this.key('Space');
    v.inputs.brake = false;
    // le mesh joueur suit discrètement (pour les systèmes qui lisent pos)
    this.pos.copy(v.pos);
    // caméra : se réaligne derrière le véhicule quand la souris est libre
    if (this._camFreeT <= 0) {
      this.camYaw = angleDamp(this.camYaw, v.heading + Math.PI, Math.abs(v.vf) > 3 ? 2.6 : 0.9, dt);
      this.camPitch = damp(this.camPitch, 0.3, 1.2, dt);
    }
    ctx.audio?.setEngine(Math.abs(v.vf) / v.spec.topSpeed, v.inputs.throttle !== 0);
  }

  _updateCamera(dt, ctx) {
    const target = new THREE.Vector3();
    let dist = this.camDist, height = 1.7, fov = 62;
    if (this.vehicle) {
      const v = this.vehicle;
      target.copy(v.pos); target.y += 1.6;
      dist = clamp(6.4 + Math.abs(v.vf) * 0.13, 6.4, 12);
      fov = 62 + clamp(Math.abs(v.vf) / v.spec.topSpeed, 0, 1) * 13;
    } else {
      target.copy(this.pos); target.y += height;
    }
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const desired = new THREE.Vector3(
      target.x + Math.sin(this.camYaw) * cp * dist,
      target.y + sp * dist,
      target.z + Math.cos(this.camYaw) * cp * dist);
    // éviter que la caméra traverse les bâtiments : rapprocher si collision
    let d = dist;
    while (d > 2 && ctx.city.isColliding(desired.x, desired.z, 0.6) && desired.y < 26) {
      d -= 1.2;
      desired.set(target.x + Math.sin(this.camYaw) * cp * d, target.y + sp * d, target.z + Math.cos(this.camYaw) * cp * d);
    }
    const lambda = this.vehicle ? 7 : 11;
    this._camPos.x = damp(this._camPos.x, desired.x, lambda, dt);
    this._camPos.y = damp(this._camPos.y, Math.max(desired.y, 0.7), lambda, dt);
    this._camPos.z = damp(this._camPos.z, desired.z, lambda, dt);
    this.camera.position.copy(this._camPos);
    if (this.shake > 0.003) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.7;
      this.shake = damp(this.shake, 0, 7, dt);
    }
    // léger look-ahead dans la direction de conduite
    if (this.vehicle) {
      const f = this.vehicle.forward();
      target.x += f.x * 3.2; target.z += f.z * 3.2;
    }
    this.camera.lookAt(target);
    if (Math.abs(this.camera.fov - fov) > 0.1) {
      this.camera.fov = damp(this.camera.fov, fov, 4, dt);
      this.camera.updateProjectionMatrix();
    }
  }
}
