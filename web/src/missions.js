// ============================================================================
// METROPOLIS — missions.js
// Système de missions data-driven. Type livré dans la vertical slice :
// "delivery" (récupérer -> livrer sous chrono -> récompense), difficulté
// progressive. Structure extensible : ajouter un type = ajouter un générateur.
// Équivalent UE5 : MissionDataAsset + Quest Manager + marqueurs UMG/monde.
// ============================================================================
import * as THREE from 'three';
import { Bus, pick, rand, randRange } from './core.js';

export class MissionSystem {
  constructor(scene, city) {
    this.city = city;
    this.phase = 'none';           // none | pickup | deliver
    this.pickupB = null; this.dropB = null;
    this.reward = 0; this.timeLeft = 0; this.timeTotal = 0;
    this.deliveries = 0;
    this._nextT = 1.2;
    // Mode Histoire : missions enchaînées. Mode Libre : aucune mission imposée
    // (le joueur peut toujours explorer, la boutique et le garage restent actifs).
    this.enabled = true;
    // 'job' = contrat (missions enchaînées), 'gig' = petite annonce unique,
    // 'off' = aucun emploi : le joueur doit accepter une annonce (v0.8).
    this.mode = 'job';
    this.freeRoam = null;      // en mode libre : destination choisie librement

    // marqueur monde : colonne de lumière + anneau + colis flottant
    this.marker = new THREE.Group();
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xffd75e, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 46, 18, 1, true), this.beamMat);
    beam.position.y = 23; this.marker.add(beam);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffd75e, transparent: true, opacity: 0.85 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.4, 4.1, 36), this.ringMat);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12; this.marker.add(ring);
    this.boxMat = new THREE.MeshStandardMaterial({ color: 0xc98d4b, roughness: 0.85, emissive: 0x694208, emissiveIntensity: 0.7 });
    this.box = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.85), this.boxMat);
    this.box.position.y = 1.5; this.box.castShadow = true; this.marker.add(this.box);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.2, 0.88),
      new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9 }));
    this.box.add(tape);
    this.marker.visible = false;
    scene.add(this.marker);
    this.target = new THREE.Vector3();
  }

  _placeMarker(building, colorHex) {
    // devant la porte, poussé vers l'extérieur pour être atteignable en voiture
    const d = building.door;
    const dirx = d.x - building.x, dirz = d.z - building.z;
    const l = Math.hypot(dirx, dirz) || 1;
    this.target.set(d.x + (dirx / l) * 3.2, 0, d.z + (dirz / l) * 3.2);
    this.marker.position.copy(this.target);
    this.beamMat.color.setHex(colorHex);
    this.ringMat.color.setHex(colorHex);
    this.marker.visible = true;
  }

  newDelivery(ctx) {
    const gig = this.mode === 'gig';
    const pp = ctx.playerPos();
    const usable = this.city.buildings.filter((b) => b.kind !== 'leisure');
    let pickup = pick(usable);
    for (let i = 0; i < 20 && Math.hypot(pickup.door.x - pp.x, pickup.door.z - pp.z) < 70; i++) pickup = pick(usable);
    let drop = pick(usable), dist = 0;
    for (let i = 0; i < 30; i++) {
      drop = pick(usable);
      dist = Math.hypot(drop.door.x - pickup.door.x, drop.door.z - pickup.door.z);
      if (dist > 130 && dist < 430) break;
    }
    this.pickupB = pickup; this.dropB = drop;
    // Petite annonce : payée à la tâche (45–75 $), large sur le chrono.
    // Contrat : tarif plein + prime de régularité côté jobs.js.
    // Le multiplicateur vient de jobs.js (contrat = +60 %), jamais de l'UI.
    this.payMult = gig ? 1 : (ctx.jobs?.payMult ?? 1);
    this.reward = gig
      ? Math.round(Math.min(75, Math.max(45, 42 + dist * 0.09)))
      : Math.round((90 + dist * 0.8) * this.payMult);
    const slack = Math.max(1.12, 1.95 - this.deliveries * 0.07);   // difficulté progressive
    this.timeTotal = this.timeLeft = Math.round((dist / 11) * (gig ? 1.7 : slack) + (gig ? 40 : 22));
    this.phase = 'pickup';
    this._placeMarker(pickup, 0xffd75e);
    this.box.visible = true;
    Bus.emit('toast', {
      text: gig ? `📄 Petite annonce — ${this.reward} $ à la livraison` : `📦 Nouvelle livraison — récompense $${this.reward}`,
      kind: '',
    });
    Bus.emit('missionUpdate', {});
  }

  /** Mode Libre : le joueur pose un marqueur libre, sans chrono ni récompense. */
  setFreeTarget(x, z) {
    this.freeRoam = { x, z };
    this.target.set(x, 0, z);
    this.marker.position.set(x, 0, z);
    this.beamMat.color.setHex(0x5ee1ff);
    this.ringMat.color.setHex(0x5ee1ff);
    this.marker.visible = true;
  }

  clearFreeTarget() { this.freeRoam = null; this.marker.visible = false; }

  objectiveInfo(ctx) {
    if (!this.enabled) {
      if (!this.freeRoam) return null;
      const pp0 = ctx.playerPos();
      return {
        title: '🗺️ Destination libre', dist: Math.hypot(this.freeRoam.x - pp0.x, this.freeRoam.z - pp0.z),
        timeLeft: null, urgent: false, pos: this.target, phase: 'free',
      };
    }
    if (this.phase === 'none') return null;
    const pp = ctx.playerPos();
    const dist = Math.hypot(this.target.x - pp.x, this.target.z - pp.z);
    return {
      title: this.phase === 'pickup' ? '📦 Récupérez le colis' : `🚚 Livrez le colis — $${this.reward}`,
      dist, timeLeft: this.phase === 'deliver' ? this.timeLeft : null,
      urgent: this.phase === 'deliver' && this.timeLeft < 15,
      pos: this.target, phase: this.phase,
    };
  }

  update(dt, ctx) {
    if (!this.enabled) {
      // mode libre : la balise libre pulse, aucune contrainte de temps
      if (this.freeRoam) {
        this._t = (this._t || 0) + dt;
        this.beamMat.opacity = 0.13 + Math.sin(this._t * 3) * 0.045;
        this.box.visible = false;
      }
      return;
    }
    if (this.mode === 'off' || this.mode === 'gig') {
      // Aucun contrat : rien ne se déclenche tout seul. Une petite annonce
      // commence uniquement quand le joueur l'accepte (panneau Emploi, J).
      if (this.phase === 'none') { this.marker.visible = false; return; }
    } else if (this.phase === 'none') {
      this._nextT -= dt;
      if (this._nextT <= 0) this.newDelivery(ctx);
      return;
    }
    // animation du marqueur
    this._t = (this._t || 0) + dt;
    this.box.rotation.y += dt * 1.6;
    this.box.position.y = 1.5 + Math.sin(this._t * 2.2) * 0.22;
    this.beamMat.opacity = 0.13 + Math.sin(this._t * 3) * 0.045;

    const pp = ctx.playerPos();
    const dist = Math.hypot(this.target.x - pp.x, this.target.z - pp.z);

    if (this.phase === 'pickup' && dist < 5.2) {
      this.phase = 'deliver';
      this._placeMarker(this.dropB, 0x5ee1ff);
      this.box.visible = false;
      ctx.audio?.pickup();
      Bus.emit('toast', { text: `✅ Colis récupéré ! Livrez-le en moins de ${Math.round(this.timeLeft)} s`, kind: 'good' });
      Bus.emit('missionUpdate', {});
      return;
    }
    if (this.phase === 'deliver') {
      this.timeLeft -= dt;
      if (dist < 5.2) {
        const bonus = Math.round(this.timeLeft * 1.5);
        const total = this.reward + Math.max(bonus, 0);
        this.deliveries++;
        ctx.addMoney(total);
        ctx.audio?.cash();
        Bus.emit('toast', { text: `💰 Livraison réussie ! +$${total}${bonus > 0 ? ` (bonus vitesse +$${bonus})` : ''}`, kind: 'good' });
        this.phase = 'none'; this.marker.visible = false; this._nextT = 1.6;
        ctx.jobs?.onRunDone?.(ctx, this.mode, true);
        // une petite annonce est unique : il faut en accepter une autre
        if (this.mode === 'gig') this.mode = 'off';
        Bus.emit('missionUpdate', {});
        ctx.saveNow?.();
        return;
      }
      if (this.timeLeft <= 0) {
        ctx.audio?.fail();
        Bus.emit('toast', { text: '⏰ Temps écoulé — livraison annulée.', kind: 'bad' });
        this.phase = 'none'; this.marker.visible = false; this._nextT = 1.6;
        ctx.jobs?.onRunDone?.(ctx, this.mode, false);
        if (this.mode === 'gig') this.mode = 'off';
        Bus.emit('missionUpdate', {});
      }
    }
  }
}
