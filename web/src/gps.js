// ============================================================================
// METROPOLIS — gps.js
// Itinéraire sur le graphe routier (A*) + guidage visuel :
//   - flèches lumineuses posées AU SOL devant le joueur (comme un GPS AR),
//   - ruban bleu continu matérialisant le trajet,
//   - tracé + flèches directionnelles sur la mini-carte (UI),
//   - bandeau « prochaine manœuvre · distance · temps restant » (UI).
//
// v0.7 — GUIDAGE TEMPS RÉEL
// Avant : l'itinéraire était calculé UNE fois, au moment où la cible changeait.
// Si le joueur quittait la route (contournement, demi-tour, mauvaise sortie),
// les flèches restaient plantées sur l'ancien tracé, y compris derrière lui.
// Maintenant :
//   1. la position du joueur est projetée sur l'itinéraire à chaque frame ;
//   2. toute la géométrie (flèches, ruban, mini-carte) part de CETTE position :
//      le guidage colle donc toujours à l'endroit où l'on est ;
//   3. si l'écart dépasse 20 m (ou toutes les 2,5 s de conduite), l'itinéraire
//      est RECALCULÉ depuis le nœud courant — A* coûte ~1 ms pour 3 km.
//
// A* sur 16 641 nœuds : tas binaire, heuristique euclidienne. Budget de nœuds
// borné, donc jamais de blocage du thread de rendu.
// Équivalent UE5 : NavigationQuery + spline de guidage + UMG minimap.
// ============================================================================
import * as THREE from 'three';
import { CFG, clamp } from './core.js';

const P = CFG.city.pitch;
const OFF_ROUTE_M = 20;      // écart toléré avant recalcul
const RECALC_COOLDOWN = 0.35; // s — évite les rafales de recalcul
const HEARTBEAT = 2.5;       // s — recalcul de rafraîchissement en roulant
const HEARTBEAT_MOVE = 25;   // m — seulement si le joueur a bougé
const ARRIVE_M = 14;         // m — seuil « arrivé »

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

/** Formatage court d'une distance (mètres / kilomètres). */
export function fmtDistance(m) {
  if (!Number.isFinite(m)) return '—';
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

export class GPSSystem {
  constructor(scene, city) {
    this.city = city;
    this.route = [];            // nœuds du parcours (source → destination)
    this.path = [];             // polyligne de guidage, départ SOUS LE JOUEUR
    this.target = null;         // {x,z}
    this._dirty = true;
    this._timer = 0;
    this.showArrows = true;     // réglage Graphismes > Bonus
    this.locked = false;
    this._dirs = [];
    this._buildArrows(scene);

    // --- état du guidage temps réel -------------------------------------
    this._pathVersion = 0;      // incrémenté à chaque reconstruction de path
    this._builtVersion = -1;
    this._t = 0;
    this._lastRecalcAt = -99;
    this._lastRecalcPos = { x: 1e9, z: 1e9 };
    this.recalcCount = 0;       // statistique lisible en debug / tests
    this._routeVersion = 0;     // incrémenté à chaque recalcul d'itinéraire
    this._builtRouteVersion = -1;
    this._pathAt = { x: 1e9, z: 1e9 };
    this._proj = null;          // projection du joueur sur l'itinéraire
    this.remaining = 0;         // m restants jusqu'à la destination
    this.eta = 0;               // s
    this.nextTurn = null;       // { dist, side, name }
    this.arrived = false;
    this._playerPos = { x: 0, z: 0 };
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
    // de N quads (~2,9 m de large) reconstruit seulement quand le joueur a
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

  // ------------------------------------------------------------------ cible
  /** Fixe la destination (ou null). Recalcule au prochain update. */
  setTarget(x, z) {
    if (x == null) {
      if (this.target) { this.target = null; this._dirty = true; }
      return;
    }
    if (!this.target || Math.hypot(this.target.x - x, this.target.z - z) > 6) {
      this.target = { x, z };
      this._dirty = true;
      this._timer = 0;                 // recalcul immédiat, sans attendre
    }
  }

  /** Efface totalement le guidage (mode Libre sans destination). */
  clear() {
    this.target = null;
    this.route = [];
    this.path = [];
    this._proj = null;
    this.remaining = 0; this.eta = 0; this.nextTurn = null; this.arrived = false;
    this._dirty = false;
    this._pathVersion++;
    this.arrows.count = 0;
    this.ribbon.geometry.setDrawRange(0, 0);
    this._builtVersion = -1;
  }

  hasRoute() { return !!(this.target && this.route.length >= 1 && this.path.length >= 2 && !this.arrived); }

  /** A* borné : renvoie le chemin de nœuds (source → destination). */
  _findPath(from, to, maxNodes = 4000, ignoreOneWay = false) {
    if (!from || !to) return [];
    if (from === to) return [from];
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
        // respecte les sens uniques (le joueur, lui, peut les ignorer à la
        // conduite — d'où le repli en 2e passe si aucun chemin n'existe)
        if (!ignoreOneWay && !this.city.canDrive(cur, d)) continue;
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

  // ------------------------------------------------------- RECALCUL TEMPS RÉEL
  /**
   * Recalcule l'itinéraire depuis la position ACTUELLE du joueur.
   * @param {string} reason 'target' | 'offroute' | 'heartbeat' | 'empty'
   */
  _recompute(reason) {
    const pp = this._playerPos;
    this._lastRecalcAt = this._t;
    this._lastRecalcPos.x = pp.x; this._lastRecalcPos.z = pp.z;
    this.recalcCount++;
    this.lastReason = reason;

    if (!this.target) { this.route = []; this.path = []; this._pathVersion++; return; }

    const from = this.city.nearestNode(pp.x, pp.z);
    const to = this.city.nearestNode(this.target.x, this.target.z);
    let route = this._findPath(from, to);
    // filet de sécurité : si le réseau à sens uniques isole la cible, on
    // recalcule en les ignorant plutôt que de laisser le joueur sans
    // itinéraire (mieux vaut un guidage « piéton » qu'aucun guidage).
    if (route.length < 2) {
      const alt = this._findPath(from, to, 6000, true);
      if (alt.length > route.length) route = alt;
    }
    this.route = route;
    this._routeVersion++;
    this._project(pp.x, pp.z);
    this._buildPath();
  }

  /**
   * Projette le joueur sur l'itinéraire (segment le plus proche).
   * @returns {{dist:number,k:number,t:number,x:number,z:number}}
   */
  _project(px, pz) {
    const route = this.route;
    if (route.length === 0) { this._proj = null; return null; }
    if (route.length === 1) {
      const n = route[0];
      this._proj = { dist: Math.hypot(px - n.x, pz - n.z), k: 0, t: 1, x: n.x, z: n.z };
      return this._proj;
    }
    let best = { dist: Infinity, k: 0, t: 0, x: px, z: pz };
    for (let k = 0; k < route.length - 1; k++) {
      const a = route[k], b = route[k + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const l2 = dx * dx + dz * dz;
      const t = l2 > 1e-6 ? clamp(((px - a.x) * dx + (pz - a.z) * dz) / l2, 0, 1) : 0;
      const x = a.x + dx * t, z = a.z + dz * t;
      const d = Math.hypot(px - x, pz - z);
      if (d < best.dist) best = { dist: d, k, t, x, z };
    }
    this._proj = best;
    return best;
  }

  /**
   * Reconstruit la polyligne seulement si nécessaire (route changée ou joueur
   * déplacé de 1,5 m). Sans ce garde-fou, on allouait un tableau et ~40 objets
   * par frame — 2 400 objets/s de déchets pour un résultat identique à l'œil.
   */
  _buildPathIfNeeded(pp) {
    const moved = Math.hypot(pp.x - this._pathAt.x, pp.z - this._pathAt.z);
    if (moved < 1.5 && this._builtRouteVersion === this._routeVersion) return;
    this._buildPath();
  }

  /**
   * Construit la polyligne de guidage :
   *   joueur → (raccord) → nœuds restants → destination exacte.
   * C'est CETTE polyligne qui alimente les flèches, le ruban et la mini-carte.
   * Elle commence donc toujours sous les pieds du joueur : le guidage suit.
   */
  _buildPath() {
    const pp = this._playerPos;
    const route = this.route;
    const pts = [];
    // Déduplication : quand le joueur est PILE sur un nœud, la projection
    // donne t = 1 sur le segment précédent (dist = 0) ; sans ce filtre on
    // poussait deux fois le même point, créant des segments de longueur nulle
    // et une direction NaN dans les flèches.
    const push = (x, z) => {
      const last = pts[pts.length - 1];
      if (last && Math.hypot(last.x - x, last.z - z) < 1) return;
      pts.push({ x, z });
    };
    // Près de la destination, on ne fait plus passer par un nœud : sinon on
    // « repartait » vers l'intersection la plus proche (jusqu'à 45 m en
    // arrière) avant de revenir sur la cible, et l'arrivée n'était jamais
    // détectée alors que le joueur était sur place.
    const direct = this.target ? Math.hypot(pp.x - this.target.x, pp.z - this.target.z) : Infinity;
    if (direct < 80) {
      push(pp.x, pp.z);
      push(this.target.x, this.target.z);
    } else if (route.length >= 2) {
      const pr = this._proj || this._project(pp.x, pp.z);
      push(pp.x, pp.z);
      // raccord vers la route, seulement s'il est significatif
      if (pr && pr.dist > 1.5) push(pr.x, pr.z);
      for (let k = (pr ? pr.k : 0) + 1; k < route.length; k++) {
        push(route[k].x, route[k].z);
      }
    } else if (route.length === 1) {
      push(pp.x, pp.z);
      push(route[0].x, route[0].z);
    } else {
      push(pp.x, pp.z);
    }
    // destination exacte (le nœud est au centre de l'intersection)
    if (this.target && direct >= 80) push(this.target.x, this.target.z);
    this.path = pts;
    this._pathVersion++;
    this._builtRouteVersion = this._routeVersion;
    this._pathAt.x = pp.x; this._pathAt.z = pp.z;

    // longueur restante
    let len = 0;
    for (let i = 0; i < pts.length - 1; i++) len += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
    this.remaining = len;
    this.arrived = len < ARRIVE_M;
    this._computeTurn();
  }

  /** Nom de la rue empruntée après un nœud, dans une direction donnée. */
  _streetName(node, dirIdx) {
    const S = this.city.streets;
    if (!S || !node) return '';
    try {
      if (dirIdx === 0 || dirIdx === 1) return S.horizontal(node.j).name;
      return S.vertical(node.i).name;
    } catch { return ''; }
  }

  /**
   * Prochaine manœuvre : premier nœud (à partir du joueur) où l'on tourne de
   * plus de 25°, avec sa distance et son côté.
   */
  _computeTurn() {
    const route = this.route;
    const pr = this._proj;
    if (!pr || route.length < 2) { this.nextTurn = null; return; }
    const k0 = pr.k;
    // distance depuis la projection jusqu'au nœud k
    const distTo = (k) => {
      let d = 0;
      // reste du segment courant
      d += Math.hypot(route[k0 + 1].x - pr.x, route[k0 + 1].z - pr.z);
      for (let i = k0 + 1; i < k; i++) d += Math.hypot(route[i + 1].x - route[i].x, route[i + 1].z - route[i].z);
      return d;
    };
    for (let k = k0 + 1; k < route.length - 1; k++) {
      const a = route[k], b = route[k + 1], prev = route[k - 1];
      const inX = a.x - prev.x, inZ = a.z - prev.z;
      const outX = b.x - a.x, outZ = b.z - a.z;
      const li = Math.hypot(inX, inZ) || 1, lo = Math.hypot(outX, outZ) || 1;
      const dot = clamp((inX * outX + inZ * outZ) / (li * lo), -1, 1);
      const angle = Math.acos(dot);
      if (angle < 0.44) continue;                    // < 25° : on continue tout droit
      const cross = (inX / li) * (outZ / lo) - (inZ / li) * (outX / lo);
      const side = cross < 0 ? 'right' : 'left';
      const dirIdx = Math.abs(outX) > Math.abs(outZ) ? (outX > 0 ? 0 : 1) : (outZ > 0 ? 2 : 3);
      this.nextTurn = {
        dist: Math.max(0, distTo(k)),
        side,
        uTurn: angle > 2.4,
        name: this._streetName(a, dirIdx),
      };
      return;
    }
    // aucune manœuvre : on va tout droit jusqu'à la destination
    this.nextTurn = { dist: this.remaining, side: 'straight', uTurn: false, name: '' };
  }

  /** Données prêtes pour le HUD (texte, icône, distances, ETA). */
  guidance(ctx) {
    if (!this.target) return null;
    if (this.arrived || this.remaining < ARRIVE_M) {
      return { icon: '📍', text: 'Vous êtes arrivé', dist: 0, remaining: 0, eta: 0, side: 'arrive' };
    }
    const t = this.nextTurn;
    if (!t) return { icon: '⬆', text: 'Suivez l’itinéraire', dist: this.remaining, remaining: this.remaining, eta: this.eta, side: 'straight' };
    const icon = t.side === 'left' ? '⬅' : t.side === 'right' ? '➡' : t.uTurn ? '↩' : '⬆';
    let text;
    if (t.uTurn) text = 'Faites demi-tour';
    else if (t.side === 'left') text = t.name ? `Tournez à gauche · ${t.name}` : 'Tournez à gauche';
    else if (t.side === 'right') text = t.name ? `Tournez à droite · ${t.name}` : 'Tournez à droite';
    else text = this.remaining < 60 ? 'Destination devant vous' : 'Continuez tout droit';
    return {
      icon, text,
      dist: Math.min(t.dist, this.remaining),
      remaining: this.remaining, eta: this.eta, side: t.side,
    };
  }

  update(dt, ctx) {
    this._t += dt;
    this._playerPos = ctx.playerPos();

    // La cible vient de la mission active (ou d'une destination libre)
    const info = ctx.missions?.objectiveInfo?.(ctx);
    if (info?.pos) this.setTarget(info.pos.x, info.pos.z);
    else if (!this.locked) this.setTarget(null);

    this._timer -= dt;

    // --- 1. décision de recalcul ----------------------------------------
    const pp = this._playerPos;
    const cooling = this._t - this._lastRecalcAt < RECALC_COOLDOWN;
    if (this.target) {
      if (this._dirty && this._timer <= 0) {
        this._dirty = false;
        this._timer = 0.35;
        this._recompute('target');
      } else if (this.route.length < 2) {
        if (!cooling) this._recompute('empty');
      } else {
        // La position de référence avance même si l'on n'a pas recalculé :
        // c'est ce qui rend les flèches solidaires du joueur.
        this._project(pp.x, pp.z);
        this._buildPathIfNeeded(pp);
        const off = this._proj?.dist ?? 0;
        // Il faut aussi que le joueur se soit DÉPLACÉ depuis le dernier
        // recalcul : sinon un joueur arrêté à 30 m de la route (dans un parc)
        // déclenchait un recalcul toutes les 0,35 s, à l'infini, pour
        // exactement le même itinéraire.
        const movedSinceRecalc = Math.hypot(pp.x - this._lastRecalcPos.x, pp.z - this._lastRecalcPos.z);
        if (off > OFF_ROUTE_M && !cooling && movedSinceRecalc > 12) {
          this._recompute('offroute');
        } else if (!cooling && this._t - this._lastRecalcAt > HEARTBEAT
          && movedSinceRecalc > HEARTBEAT_MOVE) {
          this._recompute('heartbeat');
        }
      }
    } else if (this.route.length) {
      this.clear();
    }

    // --- 2. temps restant estimé (vitesse réelle, plancher marche) -------
    const spd = Math.max(1.4, ctx.player ? ctx.player.getSpeed() : 0);
    this.eta = this.remaining / spd;

    // --- 3. flèches au sol (repartent TOUJOURS du joueur) ----------------
    this._placeArrows(pp);
    this._updateRibbon();
  }

  /**
   * Chevrons posés le long de la polyligne, à 12 m d'intervalle, dans la
   * limite de 900 m. Ils « coulent » vers la destination : on ajoute un
   * décalage de (t × 9 m) au point de départ, ce qui donne le mouvement.
   */
  _placeArrows(pp) {
    const path = this.path;
    if (!this.showArrows || path.length < 2 || this.arrived) { this.arrows.count = 0; return; }
    const SPACING = 12, FAR = 900, MAX = 96;
    const d = this._dummy;
    let count = 0, travelled = 0;
    let s = 7 + ((this._t * 9) % SPACING);       // première flèche ~7 m devant
    for (let i = 0; i < path.length - 1 && count < MAX; i++) {
      const a = path[i], b = path[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      if (segLen < 0.01) continue;
      const ang = Math.atan2(b.x - a.x, b.z - a.z);
      while (s <= travelled + segLen && count < MAX) {
        const t = (s - travelled) / segLen;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        const dd = Math.hypot(x - pp.x, z - pp.z);
        if (dd <= FAR) {
          // à partir de 90 m on passe au chevron large « vu du ciel »
          const far = clamp((dd - 90) / 500, 0, 1);
          d.position.set(x, 0.16, z);
          d.rotation.set(0, ang, 0);
          d.scale.setScalar(1 + far * 1.9 + Math.sin(this._t * 4 - s * 0.06) * 0.05);
          d.updateMatrix();
          this.arrows.setMatrixAt(count++, d.matrix);
        }
        s += SPACING;
      }
      travelled += segLen;
      if (travelled > FAR) break;
    }
    this.arrows.count = count;
    this.arrows.instanceMatrix.needsUpdate = true;
    this.arrowMat.opacity = 0.62 + Math.sin(this._t * 3) * 0.18;
  }

  /**
   * Construit le ruban bleu au sol qui matérialise l'itinéraire.
   * Reconstruit si le joueur a bougé de plus de 3 m ou si le tracé a changé :
   * le ruban part donc de la position réelle, pas d'un point figé.
   */
  _updateRibbon() {
    const pp = this._playerPos;
    const moved = Math.hypot(pp.x - this._lastRibbonAt.x, pp.z - this._lastRibbonAt.z);
    if (moved < 3 && this._builtVersion === this._pathVersion) return;
    this._lastRibbonAt.x = pp.x; this._lastRibbonAt.z = pp.z;
    this._builtVersion = this._pathVersion;

    const path = this.path;
    if (path.length < 2 || !this.showArrows || this.arrived) {
      this.ribbon.geometry.setDrawRange(0, 0); return;
    }

    // Découpe : on échantillonne tous les ~6 m, en s'arrêtant à 420 m du
    // joueur (au-delà, ça se confond avec la route).
    const pts = [];
    const MAXD = 420, STEP = 6;
    outer: for (let k = 0; k < path.length - 1; k++) {
      const a = path[k], b = path[k + 1];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(1, Math.round(segLen / STEP));
      for (let i = 0; i < n; i++) {
        if (pts.length >= this.MAXRIBBON) break outer;
        const t = i / n;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        if (Math.hypot(x - pp.x, z - pp.z) > MAXD) break outer;
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

  /**
   * Points du tracé pour la mini-carte (coordonnées monde).
   * Le premier point est la position du joueur : la ligne « sort » de lui.
   */
  routePoints() { return this.path.map((n) => ({ x: n.x, z: n.z })); }
}

export default GPSSystem;
