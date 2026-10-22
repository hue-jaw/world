// ============================================================================
// METROPOLIS — player.js
// Personnage 3e personne, caméra contextuelle (à pied / véhicule),
// entrées clavier+souris, interaction générique (entrer/sortir véhicule).
// Équivalent UE5 : ACharacter + Enhanced Input + Camera Boom + Possess.
// ============================================================================
import * as THREE from 'three';
import Assets from './assets.js';
import GamepadInput from './input.js';
import { ECONOMY } from './core.js';
import { STEP_UP } from './city.js';
import { contactShadow } from './contact.js';
import { Bus, clamp, damp, angleDamp } from './core.js';

// Coin de trottoir a l'intersection (32,32) : garanti sans batiment.
const SPAWN = { x: 42.5, z: 42.5 };
const SPAWN_HEADING = -2.36;   // face a l'intersection / au centre-ville

function buildPlayerMesh() {
  const g = new THREE.Group();
  const prim = new THREE.Group(); g.add(prim);   // avatar procédural (secours)
  const jacket = new THREE.MeshStandardMaterial({ color: 0xe67e22, roughness: 0.85 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x22304a, roughness: 0.95 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe8b48c, roughness: 0.8 });
  const mkLeg = (sx) => {
    const p = new THREE.Group(); p.position.set(sx * 0.11, 0.88, 0);
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.86, 0.18), pants);
    l.position.y = -0.43; l.castShadow = true; p.add(l); prim.add(p); return p;
  };
  const legL = mkLeg(-1), legR = mkLeg(1);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.6, 0.26), jacket);
  torso.position.y = 1.18; torso.castShadow = true; prim.add(torso);
  const mkArm = (sx) => {
    const p = new THREE.Group(); p.position.set(sx * 0.29, 1.43, 0);
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.62, 0.14), jacket);
    a.position.y = -0.29; a.castShadow = true; p.add(a); prim.add(p); return p;
  };
  const armL = mkArm(-1), armR = mkArm(1);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), skin);
  head.position.y = 1.66; head.castShadow = true; prim.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.09, 10),
    new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.8 }));
  cap.position.y = 1.78; prim.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.16), cap.material);
  brim.position.set(0, 1.75, 0.2); prim.add(brim);
  // avatar 3D réel (riggé) si disponible
  const rig = Assets.makePlayer();
  if (rig) { prim.visible = false; g.add(rig.group); }
  // ombre de contact : le joueur aussi doit « poser » au sol
  const blob = contactShadow(0.8, 0.8);
  if (blob) g.add(blob);
  return { group: g, prim, rig, legL, legR, armL, armR, blob };
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
    // --- v0.3 : manette, caméra automatique, santé ---
    this.gamepad = new GamepadInput();
    this.autoCam = true;                 // la caméra suit la direction (touche C)
    this.camMode = 'third';              // 'third' | 'first'  (touche V / BACK)
    this._fpBlend = 0;                   // 0 = 3e personne, 1 = 1re personne
    this.health = ECONOMY.health.max;
    this.maxHealth = ECONOMY.health.max;
    this._hurtT = 0;
    this._bindInput(rendererDom);
  }

  _bindInput(dom) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
      if (e.code === 'KeyF' && !e.repeat) this._wantInteract = true;
      if (e.code === 'KeyH' && this.vehicle) this._wantHonk = true;
      if (e.code === 'KeyC' && !e.repeat) this.autoCam = !this.autoCam;
      if (e.code === 'KeyV' && !e.repeat) this.cycleCamera();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    let dragging = false, lx = 0, ly = 0;
    dom.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('pointerup', () => { dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const sens = this.mouseSens ?? 1;
      this.camYaw -= (e.clientX - lx) * 0.0052 * sens;
      this.camPitch = clamp(this.camPitch + (e.clientY - ly) * 0.004 * sens * (this.invertY ? -1 : 1), -0.15, 1.15);
      lx = e.clientX; ly = e.clientY;
      this._camFreeT = 2.2;              // la caméra véhicule se recentre après 2,2 s
    });
    dom.addEventListener('wheel', (e) => {
      this.camDist = clamp(this.camDist + Math.sign(e.deltaY) * 1.1, 3.5, 13);
    }, { passive: true });
  }
  key(...codes) { return codes.some((c) => this.keys.has(c)); }

  /**
   * Bascule 3e personne ↔ 1re personne (habitacle).
   * Appelé par la touche V, le bouton BACK de la manette et le menu Contrôles.
   */
  cycleCamera() {
    this.camMode = this.camMode === 'third' ? 'first' : 'third';
    this._camFreeT = 0;
    Bus.emit('toast', {
      text: this.camMode === 'first' ? '🎥 Vue habitacle (V pour changer)' : '🎥 Vue 3e personne',
      kind: '',
    });
    return this.camMode;
  }

  /** Recentrage caméra (bouton R3 / touche R) : derrière le véhicule. */
  recenterCamera() {
    if (this.vehicle) {
      this.camYaw = this.vehicle.heading + Math.PI;
      this.camPitch = 0.3;
    } else {
      this.camYaw = this.heading + Math.PI;
      this.camPitch = 0.28;
    }
    this._camFreeT = 0;
  }

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
      const c = ctx.city.collide(ex, ez, 0.4, 0, STEP_UP);
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
    // --- saut : buffer d'appui + coyote time -------------------------------
    // Un appui de 16 ms peut tomber une frame où `grounded` est faux (marche
    // d'escalier, trottoir). On garde donc l'intention 0,16 s et on autorise
    // le saut 0,12 s après avoir quitté le sol : plus aucune pression perdue.
    if (this._jumpBufferT === undefined) { this._jumpBufferT = 0; this._coyoteT = 0; }
    this._jumpBufferT = Math.max(0, this._jumpBufferT - dt);
    this._coyoteT = this.grounded ? 0.12 : Math.max(0, this._coyoteT - dt);

    // --- entrées manette (hot-plug, axes analogiques, boutons) ---
    const pad = this.gamepad;
    pad.poll();
    if (pad.connected) {
      if (pad.pressed('X')) this._wantInteract = true;
      if (pad.pressed('Y') && this.vehicle) this._wantHonk = true;
      // START est traité par MenuSystem.update (le joueur est figé en pause)
      if (pad.pressed('R3')) this.recenterCamera();
      if (pad.pressed('BACK')) this.cycleCamera();
      // L3 = verrou de sprint (appuyer une fois court, appuyer à nouveau
      // arrête). Sur un clic de stick, le maintien est trop pénible.
      if (pad.pressed('L3')) {
        if (this.vehicle) {
          // En véhicule, le sprint n'a pas de sens : L3 sert de regard arrière
          // (maintenu) et le signale dans le HUD.
          Bus.emit('toast', { text: '👀 Regard arrière (maintenir L3)', kind: '' });
        } else {
          this._l3Latch = !this._l3Latch;
          Bus.emit('toast', { text: this._l3Latch ? '🏃 Sprint activé (L3)' : '🚶 Sprint désactivé', kind: '' });
        }
      }
      this._lookBack = !!this.vehicle && pad.down('L3');
      if (Math.abs(pad.lookX) > 0 || Math.abs(pad.lookY) > 0) {
        const ps = this.padSens ?? 1;
        this.camYaw -= pad.lookX * 2.6 * dt * ps;
        this.camPitch = clamp(this.camPitch - pad.lookY * 1.7 * dt * ps * (this.invertY ? -1 : 1), -0.15, 1.15);
        this._camFreeT = 2.2;
      }
    }
    // --- santé : régénération hors danger ---
    this._hurtT = Math.max(0, this._hurtT - dt);
    if (this._hurtT <= 0 && this.health < this.maxHealth && this.health > 0) {
      this.health = Math.min(this.maxHealth, this.health + ECONOMY.health.regenPerSec * dt);
    }
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
    let fwd = this.key('KeyW', 'ArrowUp') ? 1 : this.key('KeyS', 'ArrowDown') ? -1 : 0;
    let strafe = this.key('KeyD', 'ArrowRight') ? 1 : this.key('KeyA', 'ArrowLeft') ? -1 : 0;
    // manette : stick gauche analogique (prioritaire dès qu'il bouge)
    if (this.gamepad.connected) {
      if (Math.abs(this.gamepad.moveY) > 0 || Math.abs(this.gamepad.moveX) > 0) {
        fwd = this.gamepad.moveY; strafe = this.gamepad.moveX;
      }
    }
    // Sprint : Maj clavier, ou L3 (clic du stick gauche) — plus RB (v0.4).
    // Le latch permet de relâcher le stick sans perdre la course.
    const sprint = this.key('ShiftLeft', 'ShiftRight') || this._l3Latch;
    const speed = sprint ? 6.6 : 3.3;
    // directions relatives à la caméra
    const sin = Math.sin(this.camYaw), cos = Math.cos(this.camYaw);
    let mx = (-sin * fwd + cos * strafe);   // la caméra regarde vers -forward(heading=camYaw+PI)
    let mz = (-cos * fwd - sin * strafe);
    const len = Math.hypot(mx, mz);
    if (len > 0.01) {
      const intensity = Math.min(1, len);
      mx /= len; mz /= len;
      this.vel.x = damp(this.vel.x, mx * speed * intensity, 10, dt);
      this.vel.z = damp(this.vel.z, mz * speed * intensity, 10, dt);
      this.heading = angleDamp(this.heading, Math.atan2(mx, mz), 12, dt);
    } else {
      this.vel.x = damp(this.vel.x, 0, 10, dt);
      this.vel.z = damp(this.vel.z, 0, 10, dt);
    }
    // saut + gravité (buffer 0,16 s : l'appui n'est jamais perdu)
    if (this.key('Space') || this.gamepad.pressed('A')) this._jumpBufferT = 0.16;
    const ground = ctx.city.groundY(this.pos.x, this.pos.z, this.pos.y);
    if (this._jumpBufferT > 0 && this._coyoteT > 0) {
      this.vy = 7.6;
      this.grounded = false;
      this._jumpBufferT = 0;
      this._coyoteT = 0;
      this._jumpFx = 0.18;              // petite impulsion visuelle (caméra)
    }
    this.vy -= 22 * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= ground) {
      // --- blessure à l'atterrissage (brief §23) ---
      const impact = -this.vy;
      if (!this.grounded && impact > ECONOMY.health.fallSafe) {
        const dmg = Math.min(65, (impact - ECONOMY.health.fallSafe) * ECONOMY.health.fallDamage);
        this.damage(dmg, ctx, 'chute');
      }
      this.pos.y = ground; this.vy = 0; this.grounded = true;
    }
    // STEP_UP : le joueur enjambe trottoirs, terre-pleins, îlots et bordures.
    const c = ctx.city.collide(this.pos.x, this.pos.z, 0.38, this.pos.y, STEP_UP);
    this.pos.x = c.x; this.pos.z = c.z;
    this.group.rotation.y = this.heading;
    // animation de marche
    const sp = Math.hypot(this.vel.x, this.vel.z);
    // cadence = distance parcourue / longueur de foulée (pas de glissement)
    this.walkPhase = Assets.advancePhase(this.walkPhase, this.grounded ? sp : 0, dt);
    if (this.rig) {
      const bob = Assets.walkRig(this.rig, this.grounded ? sp : 0, dt, this.walkPhase);
      this.group.position.y = this.pos.y + bob;
      if (this.blob) this.blob.position.y = 0.035 - bob;
    } else {
      const sw = this.grounded ? Math.sin(this.walkPhase) * clamp(sp * 0.14, 0, 0.8) : 0.35;
      this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
      this.armL.rotation.x = -sw * 0.85; this.armR.rotation.x = sw * 0.85;
    }
  }

  _updateDriving(dt, ctx) {
    const v = this.vehicle;
    let throttle = this.key('KeyW', 'ArrowUp') ? 1 : this.key('KeyS', 'ArrowDown') ? -1 : 0;
    let steerTarget = this.key('KeyA', 'ArrowLeft') ? 1 : this.key('KeyD', 'ArrowRight') ? -1 : 0;
    if (this.gamepad.connected) {
      const rt = this.gamepad.value('RT'), lt = this.gamepad.value('LT');
      if (rt > 0.05 || lt > 0.05) throttle = rt - lt;
      else if (Math.abs(this.gamepad.moveY) > 0) throttle = this.gamepad.moveY;
      if (Math.abs(this.gamepad.moveX) > 0) steerTarget = -this.gamepad.moveX;
    }
    v.inputs.throttle = clamp(throttle, -1, 1);
    v.inputs.stickAnalog = this.gamepad.connected && Math.abs(this.gamepad.moveX) > 0;
    const rate = steerTarget !== 0 ? 3.4 : 5.5;
    this.steerInput = clamp(this.steerInput + clamp(steerTarget - this.steerInput, -rate * dt, rate * dt), -1, 1);
    v.inputs.steer = this.steerInput;
    v.inputs.handbrake = this.key('Space') || this.gamepad.down('A');
    v.inputs.brake = false;
    // le mesh joueur suit discrètement (pour les systèmes qui lisent pos)
    this.pos.copy(v.pos);
    // caméra : se réaligne derrière le véhicule quand le joueur ne regarde pas
    if (this._camFreeT <= 0 && this.autoCam) {
      this.camYaw = angleDamp(this.camYaw, v.heading + Math.PI, Math.abs(v.vf) > 3 ? 2.6 : 0.9, dt);
      this.camPitch = damp(this.camPitch, 0.3, 1.2, dt);
    }
    ctx.audio?.setEngine(Math.abs(v.vf) / v.spec.topSpeed, v.inputs.throttle !== 0);
  }

  /** Applique des dégâts et prévient les systèmes (UI, audio, respawn). */
  damage(amount, ctx, reason = '') {
    if (amount <= 0 || this.health <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this._hurtT = 4.5;
    this.shake = Math.min(0.9, this.shake + amount * 0.012);
    Bus.emit('playerDamage', { amount, health: this.health, reason });
    if (this.health <= 0) Bus.emit('playerDown', { reason });
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  _updateCamera(dt, ctx) {
    // --- caméra automatique à pied : elle suit la direction de déplacement ---
    if (!this.vehicle && this.autoCam && this._camFreeT <= 0) {
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > 0.6) this.camYaw = angleDamp(this.camYaw, this.heading + Math.PI, 2.4, dt);
    }
    const target = new THREE.Vector3();
    let dist = this.camDist, height = 1.7, fov = 62;

    // ------------------------------------------------------------------
    // 1re PERSONNE EN VOITURE (v0.4)
    // Le point de vue est placé à la position réelle du conducteur dans
    // l'habitacle (à gauche du volant), pas au centre du toit : on voit donc
    // le capot, les montants et les rétroviseurs. Le corps du joueur est déjà
    // masqué (group.visible=false) ; on masque en plus la carrosserie autour
    // de la caméra en rapprochant le plan near.
    // ------------------------------------------------------------------
    const wantFP = this.camMode === 'first' && !!this.vehicle;
    this._fpBlend = damp(this._fpBlend, wantFP ? 1 : 0, 9, dt);
    const fp = this._fpBlend;

    if (this.vehicle) {
      const v = this.vehicle;
      target.copy(v.pos); target.y += 1.6;
      dist = clamp(6.4 + Math.abs(v.vf) * 0.13, 6.4, 12);
      fov = 62 + clamp(Math.abs(v.vf) / v.spec.topSpeed, 0, 1) * 13;
      if (fp > 0.001) {
        // Repère du véhicule : avant = (sin h, cos h), droite = (cos h, -sin h).
        // Conduite à gauche : l'œil est décalé de 22 % de la largeur à gauche.
        const h = v.heading;
        const fx = Math.sin(h), fz = Math.cos(h);
        const rx = Math.cos(h), rz = -Math.sin(h);
        const eyeX = v.pos.x - rx * v.spec.wid * 0.22;
        const eyeZ = v.pos.z - rz * v.spec.wid * 0.22;
        // hauteur d'œil : proportionnelle au gabarit du véhicule
        const specH = v.spec.height || (v.spec.bodyH ? v.spec.bodyH + (v.spec.cabinH || 0) : 1.46);
        const eyeY = 1.02 + specH * 0.42;
        this.camera.position.set(eyeX, eyeY, eyeZ);
        // le regard tourne avec la caméra libre (souris / stick droit) ;
        // vue par défaut = vers l'avant du véhicule
        const viewX = -Math.sin(this.camYaw), viewZ = -Math.cos(this.camYaw);
        const pitchA = -this.camPitch + 0.30;
        this.camera.lookAt(
          eyeX + viewX * Math.cos(pitchA) * 10,
          eyeY + Math.sin(pitchA) * 10,
          eyeZ + viewZ * Math.cos(pitchA) * 10);
        this.camera.rotateZ(-this.steerVisual * 0.035 - (v.driftAmount || 0) * 0.05);
        this.camera.fov = 74 + clamp(Math.abs(v.vf) / v.spec.topSpeed, 0, 1) * 8;
        this.camera.updateProjectionMatrix();
        this._camPos.copy(this.camera.position);
        // tête du conducteur masquée : on est dedans
        if (v.driverFig) v.driverFig.visible = false;
        if (this.shake > 0.003) {
          this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.5;
          this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.4;
          this.shake = damp(this.shake, 0, 7, dt);
        }
        return;
      }
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
    if (this.vehicle?.driverFig) this.vehicle.driverFig.visible = true;
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
    if (this._lookBack) {
      // vue arrière : la caméra se place devant le véhicule et regarde derrière
      const v = this.vehicle;
      const f = v.forward();
      this.camera.position.set(v.pos.x + f.x * 9, 2.4, v.pos.z + f.z * 9);
      this.camera.lookAt(v.pos.x - f.x * 10, 1.4, v.pos.z - f.z * 10);
    } else {
      this.camera.lookAt(target);
    }
    if (Math.abs(this.camera.fov - fov) > 0.1) {
      this.camera.fov = damp(this.camera.fov, fov, 4, dt);
      this.camera.updateProjectionMatrix();
    }
  }
}
