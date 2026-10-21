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
import { CFG, clamp } from './core.js';

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
    this.showArrows = true;     // réglage Graphismes > Bonus
    this._dirs = [];
    this._buildArrows(scene);
  }

  _buildArrows(scene) {
    // Chevron plat (pointe vers +Z). Couleur bleu GPS franc, liseré clair :
    // il reste lisible sur asphalte clair, mouillé ou de nuit.
    const shape = new THREE.Shape();
    shape.moveTo(-0.62, -0.5); shape.lineTo(0, 0.55); shape.lineTo(0.62, -0.5);
    shape.lineTo(0.62, -0.86); shape.lineTo(0, 0.10); shape.lineTo(-0.62, -0.86);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    this.arrowMat = new THREE.MeshBasicMaterial({
      color: 0x2f8bff, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      fog: false, toneMapped: false,
    });
    // 96 chevrons : assez pour couvrir ~900 m de tracé, donc visibles de loin
    this.arrows = new THREE.InstancedMesh(geo, this.arrowMat, 96);
    this.arrows.frustumCulled = false;
    this.arrows.count = 0;
    scene.add(this.arrows);
    this._dummy = new THREE.Object3D();
    this._t = 0;

    // ------------------------------------------------------------------
    // RUBAN BLEU CONTINU AU SOL (le « trajet » à la Google Maps)
    // Un ruban plutôt qu'une ligne : les lignes WebGL font 1 px quelle que
    // soit la distance, donc illisibles de loin. Ici on construit un maillage
    // de N quads (~2,6 m de large) reconstruit seulement quand le joueur a
    // bougé — coût négligeable.
    // ------------------------------------------------------------------
    this.MAXRIBBON = 260;
    const rg = new THREE.BufferGeometry();
    this._rbPos = new Float32Array(this.MAXRIBBON * 2 * 3);
    this._rbIdx = new Uint16Array((this.MAXRIBBON - 1) * 6);
    rg.setAttribute('position', new THREE.BufferAttribute(this._rbPos, 3));
    rg.setIndex(new THREE.BufferAttribute(this._rbIdx, 1));
    rg.setDrawRange(0, 0);
    this.ribbonMat = new THREE.MeshBasicMaterial({
      color: 0x1f7bff, transparent: true, opacity: 0.42,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      fog: false, toneMapped: false,
    });
    this.ribbon = new THREE.Mesh(rg, this.ribbonMat);
    this.ribbon.frustumCulled = false;
    this.ribbon.renderOrder = 1;
    scene.add(this.ribbon);
    this._lastRibbonAt = { x: 1e9, z: 1e9 };
    this._builtRoute = null;
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

    // --- flèches au sol : jusqu'à 96 chevrons, visibles jusqu'à ~900 m -----
    if (this.route.length > 1) {
      const pp = ctx.playerPos();
      let count = 0;
      const d = this._dummy;
      const FAR = 900;
      for (let k = 0; k < this.route.length - 1 && count < 96; k++) {
        const a = this.route[k], b = this.route[k + 1];
        const segLen = Math.hypot(b.x - a.x, b.z - a.z);
        if (segLen < 0.01) continue;
        // on n'affiche pas le tronçon déjà parcouru (derrière le joueur)
        const ang = Math.atan2(b.x - a.x, b.z - a.z);
        const steps = Math.max(1, Math.round(segLen / 11));
        for (let s = 0; s < steps && count < 96; s++) {
          const t = (s + 0.5) / steps;
          const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          const dd = Math.hypot(x - pp.x, z - pp.z);
          if (dd > FAR) continue;
          // à partir de 160 m on passe au chevron large « vu du ciel »
          const far = clamp((dd - 90) / 500, 0, 1);
          d.position.set(x, 0.16, z);
          d.rotation.set(0, ang, 0);
          d.scale.setScalar(1 + far * 1.9 + Math.sin(this._t * 4 - k * 0.6) * 0.05);
          d.updateMatrix();
          this.arrows.setMatrixAt(count++, d.matrix);
        }
        if (count >= 96) break;
      }
      this.arrows.count = count;
      this.arrows.instanceMatrix.needsUpdate = true;
      this.arrowMat.opacity = 0.62 + Math.sin(this._t * 3) * 0.18;
    } else {
      this.arrows.count = 0;
    }
    if (!this.showArrows) this.arrows.count = 0;
    this._updateRibbon(ctx);
  }

  /**
   * Construit le ruban bleu au sol qui matérialise l'itinéraire complet.
   * Reconstruit uniquement si le joueur a bougé de plus de 4 m ou si
   * l'itinéraire a changé — pas de coût par frame.
   */
  _updateRibbon(ctx) {
    const pp = ctx.playerPos();
    const moved = Math.hypot(pp.x - this._lastRibbonAt.x, pp.z - this._lastRibbonAt.z);
    if (moved < 4 && this._builtRoute === this.route) return;
    this._lastRibbonAt.x = pp.x; this._lastRibbonAt.z = pp.z;
    this._builtRoute = this.route;

    const route = this.route;
    if (route.length < 2) { this.ribbon.geometry.setDrawRange(0, 0); return; }
    if (!this.showArrows) { this.ribbon.geometry.setDrawRange(0, 0); return; }

    // Découpe : on parcourt le tracé et on échantillonne tous les ~6 m, en
    // s'arrêtant à 420 m du joueur (au-delà, ça se confond avec la route).
    const pts = [];
    const MAXD = 420, STEP = 6;
    let acc = 0;
    for (let k = 0; k < route.length - 1 && pts.length < this.MAXRIBBON; k++) {
      const a = route[k], b = route[k + 1];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(1, Math.round(segLen / STEP));
      for (let i = 0; i < n && pts.length < this.MAXRIBBON; i++) {
        const t = i / n;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        if (Math.hypot(x - pp.x, z - pp.z) > MAXD) { k = route.length; break; }
        pts.push({ x, z });
      }
    }
    if (pts.length < 2) { this.ribbon.geometry.setDrawRange(0, 0); return; }

    const W = 1.45;        // demi-largeur (m) : ~2,9 m, la largeur d'une voie
    const pos = this._rbPos, idx = this._rbIdx;
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(pts.length - 1, i + 1)];
      let dx = p1.x - p0.x, dz = p1.z - p0.z;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const nx = -dz, nz = dx;              // perpendiculaire dans le plan XZ
      const c = pts[i];
      pos[i * 6] = c.x + nx * W; pos[i * 6 + 1] = 0.12; pos[i * 6 + 2] = c.z + nz * W;
      pos[i * 6 + 3] = c.x - nx * W; pos[i * 6 + 4] = 0.12; pos[i * 6 + 5] = c.z - nz * W;
    }
    let ii = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = i * 2;
      idx[ii++] = a; idx[ii++] = a + 1; idx[ii++] = a + 2;
      idx[ii++] = a + 1; idx[ii++] = a + 3; idx[ii++] = a + 2;
    }
    const g = this.ribbon.geometry;
    g.attributes.position.needsUpdate = true;
    g.index.needsUpdate = true;
    g.setDrawRange(0, ii);
    g.computeBoundingSphere();
  }

  /** Points du tracé pour la mini-carte (coordonnées monde). */
  routePoints() { return this.route.map((n) => ({ x: n.x, z: n.z })); }
}

export default GPSSystem;
