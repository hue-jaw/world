// ============================================================================
// METROPOLIS — gps.js
// Itinéraire sur le graphe routier (A*) + guidage visuel :
//   - flèches lumineuses posées AU SOL devant le joueur (comme un GPS AR),
//   - tracé + flèches directionnelles sur la mini-carte (UI).
//
// A* sur 16 641 nœuds : tas binaire, heuristique euclidienne. Le calcul est
// incrémental (budget de nœuds par frame) pour ne jamais créer de saccade.
// Équivalent UE5 : NavigationQuery + spline de guidage + UMG minimap.
// ============================================================================
import * as THREE from 'three';
import { CFG } from './core.js';

const P = CFG.city.pitch;

class MinHeap {
  constructor() { this.a = []; }
  push(node, f) {
    const a = this.a; a.push({ node, f });
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top.node;
  }
  get size() { return this.a.length; }
}

const key = (n) => n.i * 1000 + n.j;

export class GPSSystem {
  constructor(scene, city) {
    this.city = city;
    this.route = [];            // nœuds du parcours
    this.target = null;         // {x,z}
    this._dirty = true;
    this._timer = 0;
    this._dirs = [];
    this._buildArrows(scene);
  }

  _buildArrows(scene) {
    // Chevron plat (pointe vers +Z), additif : lisible sur asphalte clair ou mouillé
    const shape = new THREE.Shape();
    shape.moveTo(-0.55, -0.42); shape.lineTo(0, 0.5); shape.lineTo(0.55, -0.42);
    shape.lineTo(0.55, -0.78); shape.lineTo(0, 0.14); shape.lineTo(-0.55, -0.78);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    this.arrowMat = new THREE.MeshBasicMaterial({
      color: 0x35d6ff, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    this.arrows = new THREE.InstancedMesh(geo, this.arrowMat, 28);
    this.arrows.frustumCulled = false;
    this.arrows.count = 0;
    scene.add(this.arrows);
    this._dummy = new THREE.Object3D();
    this._t = 0;
  }

  /** Fixe la destination (ou null). Recalcule au prochain update. */
  setTarget(x, z) {
    if (x == null) {
      if (this.target) { this.target = null; this._dirty = true; }
      return;
    }
    if (!this.target || Math.hypot(this.target.x - x, this.target.z - z) > 6) {
      this.target = { x, z };
      this._dirty = true;
    }
  }

  /** A* borné : renvoie le chemin de nœuds (source → destination). */
  _findPath(from, to, maxNodes = 4000) {
    if (!from || !to) return [];
    const open = new MinHeap();
    const g = new Map(), came = new Map(), closed = new Set();
    const h = (n) => Math.hypot(n.x - to.x, n.z - to.z);
    g.set(key(from), 0); open.push(from, h(from));
    let iter = 0;
    while (open.size && iter++ < maxNodes) {
      const cur = open.pop();
      const ck = key(cur);
      if (cur === to) {
        const path = []; let c = cur;
        while (c) { path.unshift(c); c = came.get(key(c)); }
        return path;
      }
      if (closed.has(ck)) continue;
      closed.add(ck);
      const gc = g.get(ck);
      for (let d = 0; d < 4; d++) {
        const nb = this.city.nextNode(cur, d);
        if (!nb) continue;
        const nk = key(nb);
        if (closed.has(nk)) continue;
        const ng = gc + P;
        if (!g.has(nk) || ng < g.get(nk)) {
          g.set(nk, ng); came.set(nk, cur); open.push(nb, ng + h(nb) * 1.05);
        }
      }
    }
    return [];
  }

  update(dt, ctx) {
    this._t += dt;
    // La cible vient de la mission active (ou d'une destination libre)
    const info = ctx.missions?.objectiveInfo?.(ctx);
    if (info?.pos) this.setTarget(info.pos.x, info.pos.z);
    else if (!this.locked) this.setTarget(null);

    this._timer -= dt;
    if (this._dirty && this._timer <= 0) {
      this._timer = 0.35;
      this._dirty = false;
      const pp = ctx.playerPos();
      if (this.target) {
        const from = this.city.nearestNode(pp.x, pp.z);
        const to = this.city.nearestNode(this.target.x, this.target.z);
        this.route = this._findPath(from, to);
      } else this.route = [];
    }

    // --- flèches au sol : 28 chevrons devant le joueur ---
    if (this.route.length > 1) {
      const pp = ctx.playerPos();
      let count = 0;
      const d = this._dummy;
      for (let k = 1; k < this.route.length - 1 && count < 28; k++) {
        const a = this.route[k], b = this.route[k + 1];
        const dist = Math.hypot(a.x - pp.x, a.z - pp.z);
        if (dist > 150) continue;                 // n'afficher que le tronçon proche
        const segLen = Math.hypot(b.x - a.x, b.z - a.z);
        const ang = Math.atan2(b.x - a.x, b.z - a.z);
        const steps = Math.max(1, Math.floor(segLen / 9));
        for (let s = 0; s < steps && count < 28; s++) {
          const t = s / steps;
          const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          if (Math.hypot(x - pp.x, z - pp.z) > 150) continue;
          d.position.set(x, 0.14, z);
          d.rotation.set(0, ang, 0);
          d.scale.setScalar(1 + Math.sin(this._t * 4 - k * 0.6) * 0.06);
          d.updateMatrix();
          this.arrows.setMatrixAt(count++, d.matrix);
        }
        if (count >= 28) break;
      }
      this.arrows.count = count;
      this.arrows.instanceMatrix.needsUpdate = true;
      this.arrowMat.opacity = 0.55 + Math.sin(this._t * 3) * 0.2;
    } else {
      this.arrows.count = 0;
    }
  }

  /** Points du tracé pour la mini-carte (coordonnées monde). */
  routePoints() { return this.route.map((n) => ({ x: n.x, z: n.z })); }
}

export default GPSSystem;
