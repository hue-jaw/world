// ============================================================================
// METROPOLIS — tools/canvas2d.mjs
// Backend Canvas2D logiciel minimal, pour exécuter les générateurs de textures
// procédurales (web/src/textures.js) HORS navigateur et les prévisualiser.
//
// Ce n'est pas un émulateur complet : il couvre exactement les primitives
// utilisées par textures.js — fillRect, strokeRect, chemins polygonaux
// (moveTo/lineTo/arc/ellipse/arcTo/rect/closePath), fill, stroke, dégradés
// linéaires, globalAlpha, save/restore/translate/rotate, clip.
//
// Rendu : rastérisation scanline « non-zero winding », sans antialiasing
// (la prévisualisation est ensuite réduite par 2, ce qui lisse les bords).
// ============================================================================

const TAU = Math.PI * 2;

// ------------------------------- couleurs ---------------------------------
/** '#rrggbb' | '#rgb' | 'rgba(r,g,b,a)' | 'rgb(r,g,b)' -> [r,g,b,a] (0-255, a 0-1) */
export function parseColor(str) {
  if (Array.isArray(str)) return str;
  const s = String(str).trim();
  if (s[0] === '#') {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const n = parseInt(hex.slice(0, 6), 16);
    const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x));
    return [p[0] | 0, p[1] | 0, p[2] | 0, p.length > 3 ? p[3] : 1];
  }
  if (s === 'transparent') return [0, 0, 0, 0];
  if (s === 'white') return [255, 255, 255, 1];
  if (s === 'black') return [0, 0, 0, 1];
  return [128, 128, 128, 1];
}

// ------------------------------- dégradés ---------------------------------
class LinearGradient {
  constructor(x0, y0, x1, y1) {
    this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1;
    this.stops = [];
  }
  addColorStop(pos, color) {
    this.stops.push([Math.max(0, Math.min(1, pos)), parseColor(color)]);
    this.stops.sort((a, b) => a[0] - b[0]);
  }
  /** Couleur au paramètre t (0..1). */
  colorAt(t) {
    const st = this.stops;
    if (!st.length) return [128, 128, 128, 1];
    if (t <= st[0][0]) return st[0][1];
    if (t >= st[st.length - 1][0]) return st[st.length - 1][1];
    for (let i = 1; i < st.length; i++) {
      if (t <= st[i][0]) {
        const a = st[i - 1], b = st[i];
        const k = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
        return [
          a[1][0] + (b[1][0] - a[1][0]) * k,
          a[1][1] + (b[1][1] - a[1][1]) * k,
          a[1][2] + (b[1][2] - a[1][2]) * k,
          a[1][3] + (b[1][3] - a[1][3]) * k,
        ];
      }
    }
    return st[st.length - 1][1];
  }
}

class RadialGradient {
  constructor(x0, y0, r0, x1, y1, r1) {
    this.x0 = x0; this.y0 = y0; this.r0 = r0;
    this.x1 = x1; this.y1 = y1; this.r1 = r1;
    this.stops = [];
  }
  addColorStop(pos, color) {
    this.stops.push([Math.max(0, Math.min(1, pos)), parseColor(color)]);
    this.stops.sort((a, b) => a[0] - b[0]);
  }
  colorAtPoint(x, y) {
    const d = Math.hypot(x - this.x1, y - this.y1);
    const t = (d - this.r0) / Math.max(1e-6, this.r1 - this.r0);
    return this.colorAt(Math.max(0, Math.min(1, t)));
  }
  colorAt(t) { return LinearGradient.prototype.colorAt.call(this, t); }
}

// --------------------------------- Canvas ----------------------------------
export class Canvas2D {
  constructor(w, h) {
    this.width = w; this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4); // RGBA prémultiplié ? non, direct
    this.ctx = new Context2D(this);
  }
  getContext() { return this.ctx; }
  /** Accès direct aux pixels (RGBA non prémultipliés). */
  pixels() { return this.data; }
}

class Context2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.W = canvas.width; this.H = canvas.height;
    this.pixels = canvas.data;
    this.stack = [];
    this.state = {
      fillStyle: [128, 128, 128, 1],
      strokeStyle: [0, 0, 0, 1],
      lineWidth: 1,
      globalAlpha: 1,
      tx: 0, ty: 0, rot: 0,
      clip: null, // Uint8Array (1 = dessinable)
    };
    this.paths = [];   // liste de sous-chemins (tableaux de points)
    this.current = null;
  }

  // ------------------------------ état ------------------------------------
  save() { this.stack.push({ ...this.state, clip: this.state.clip }); }
  restore() { const s = this.stack.pop(); if (s) this.state = s; }
  translate(x, y) { this.state.tx += x; this.state.ty += y; }
  rotate(a) { this.state.rot += a; }
  scale() { /* non utilisé par textures.js */ }
  set globalAlpha(v) { this.state.globalAlpha = v; }
  get globalAlpha() { return this.state.globalAlpha; }
  set fillStyle(v) { this.state.fillStyle = (v instanceof LinearGradient || v instanceof RadialGradient) ? v : parseColor(v); }
  get fillStyle() { return this.state.fillStyle; }
  set strokeStyle(v) { this.state.strokeStyle = (v instanceof LinearGradient || v instanceof RadialGradient) ? v : parseColor(v); }
  get strokeStyle() { return this.state.strokeStyle; }
  set lineWidth(v) { this.state.lineWidth = v; }
  get lineWidth() { return this.state.lineWidth; }

  _transform(x, y) {
    const { tx, ty, rot } = this.state;
    if (!rot) return [x + tx, y + ty];
    const c = Math.cos(rot), s = Math.sin(rot);
    return [x * c - y * s + tx, x * s + y * c + ty];
  }

  createLinearGradient(x0, y0, x1, y1) { return new LinearGradient(x0, y0, x1, y1); }
  createRadialGradient(x0, y0, r0, x1, y1, r1) { return new RadialGradient(x0, y0, r0, x1, y1, r1); }
  createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }

  // ------------------------------ chemins ---------------------------------
  beginPath() { this.paths = []; this.current = null; }
  moveTo(x, y) { this.current = [this._transform(x, y)]; this.paths.push(this.current); }
  lineTo(x, y) {
    if (!this.current) { this.moveTo(x, y); return; }
    this.current.push(this._transform(x, y));
  }
  closePath() {
    if (!this.current || this.current.length < 2) return;
    const first = this.current[0], last = this.current[this.current.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) this.current.push([first[0], first[1]]);
  }
  rect(x, y, w, h) {
    this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath();
  }
  arc(cx, cy, r, a0 = 0, a1 = TAU, ccw = false) {
    const steps = Math.max(8, Math.ceil(Math.abs(a1 - a0) / 0.15));
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps * (ccw ? -1 : 1);
      // ccw géré naïvement : on inverse le sens
      const ang = ccw ? a0 - Math.abs(a1 - a0) * (i / steps) : a0 + (a1 - a0) * (i / steps);
      const px = cx + Math.cos(ang) * r, py = cy + Math.sin(ang) * r;
      if (i === 0 && !this.current) this.moveTo(px, py); else this.lineTo(px, py);
      if (steps !== 0 && i === steps && !ccw) break;
    }
  }
  ellipse(cx, cy, rx, ry, rot = 0, a0 = 0, a1 = TAU) {
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (a1 - a0) * (i / steps);
      const px = cx + Math.cos(a) * rx * Math.cos(rot) - Math.sin(a) * ry * Math.sin(rot);
      const py = cy + Math.cos(a) * rx * Math.sin(rot) + Math.sin(a) * ry * Math.cos(rot);
      if (i === 0 && !this.current) this.moveTo(px, py); else this.lineTo(px, py);
    }
  }
  arcTo(x1, y1, x2, y2, r) {
    // simplification : ligne vers le point de contrôle (suffisant pour les
    // rectangles arrondis de textures.js à petit rayon)
    this.lineTo(x1, y1);
    this.lineTo(x2, y2);
  }

  // --------------------------- rastérisation ------------------------------
  /** Balaye un polygone (tableau de points) et renvoie les intervalles par ligne. */
  _scan(points, minY, maxY, W) {
    const edges = [];
    for (let i = 0; i < points.length - 1; i++) {
      const [x0, y0] = points[i], [x1, y1] = points[i + 1];
      if (y0 === y1) continue;
      edges.push([x0, y0, x1, y1]);
    }
    for (let y = minY; y <= maxY; y++) {
      const sy = y + 0.5;
      const xs = [];
      for (const [x0, y0, x1, y1] of edges) {
        const yMin = Math.min(y0, y1), yMax = Math.max(y0, y1);
        if (sy < yMin || sy >= yMax) continue;
        const t = (sy - y0) / (y1 - y0);
        xs.push([x0 + (x1 - x0) * t, y1 > y0 ? 1 : -1]);
      }
      if (!xs.length) continue;
      xs.sort((a, b) => a[0] - b[0]);
      let wind = 0, start = null;
      for (const [x, w] of xs) {
        const prev = wind;
        wind += w;
        if (prev === 0 && wind !== 0) start = x;
        else if (prev !== 0 && wind === 0 && start !== null) {
          this._span(y, start, x, W);
          start = null;
        }
      }
    }
  }

  _span(y, xa, xb, W) {
    let x0 = Math.max(0, Math.round(Math.min(xa, xb)));
    let x1 = Math.min(this.W - 1, Math.round(Math.max(xa, xb)) - 1);
    if (x1 < x0) return;
    const st = this.state;
    const clip = st.clip;
    const grad = (st.fillStyle instanceof LinearGradient || st.fillStyle instanceof RadialGradient)
      ? st.fillStyle : null;
    const col = grad ? null : st.fillStyle;
    for (let x = x0; x <= x1; x++) {
      const idx = y * this.W + x;
      if (clip && !clip[idx]) continue;
      let c = col;
      if (grad) {
        if (grad instanceof RadialGradient) {
          c = grad.colorAtPoint(x, y);
        } else {
          // projection du pixel sur l'axe du dégradé
          const dx = grad.x1 - grad.x0, dy = grad.y1 - grad.y0;
          const len2 = dx * dx + dy * dy || 1;
          const t = ((x - grad.x0) * dx + (y - grad.y0) * dy) / len2;
          c = grad.colorAt(Math.max(0, Math.min(1, t)));
        }
      }
      this._blend(idx, c[0], c[1], c[2], c[3] * st.globalAlpha);
    }
  }

  _blend(idx, r, g, b, a) {
    if (a <= 0) return;
    const p = this.pixels, o = idx * 4;
    if (a >= 1) { p[o] = r; p[o + 1] = g; p[o + 2] = b; p[o + 3] = 255; return; }
    p[o] = p[o] * (1 - a) + r * a;
    p[o + 1] = p[o + 1] * (1 - a) + g * a;
    p[o + 2] = p[o + 2] * (1 - a) + b * a;
    p[o + 3] = Math.max(p[o + 3], Math.round(255 * a));
  }

  fill() {
    for (const path of this.paths) {
      if (path.length < 3) continue;
      const pts = path.slice();
      const ys = pts.map((p) => p[1]);
      const minY = Math.max(0, Math.floor(Math.min(...ys)));
      const maxY = Math.min(this.H - 1, Math.ceil(Math.max(...ys)));
      if (maxY < minY) continue;
      if (!(this.state.fillStyle instanceof LinearGradient) && !(this.state.fillStyle instanceof RadialGradient)
        && this.state.fillStyle[3] === 0) continue;
      this._scan(pts, minY, maxY, this.W);
    }
  }

  stroke() {
    const lw = Math.max(0.5, this.state.lineWidth);
    const saved = this.state.fillStyle;
    this.state.fillStyle = this.state.strokeStyle;
    for (const path of this.paths) {
      if (path.length < 2) continue;
      // segments épaissis en quads + petits cercles aux jonctions
      for (let i = 0; i < path.length - 1; i++) {
        const [x0, y0] = path[i], [x1, y1] = path[i + 1];
        const dx = x1 - x0, dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * (lw / 2), ny = (dx / len) * (lw / 2);
        const quad = [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny], [x0 + nx, y0 + ny]];
        const ys = quad.map((p) => p[1]);
        this._scan(quad, Math.max(0, Math.floor(Math.min(...ys))), Math.min(this.H - 1, Math.ceil(Math.max(...ys))), this.W);
      }
    }
    this.state.fillStyle = saved;
  }

  fillRect(x, y, w, h) {
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    this.beginPath(); this.rect(x, y, w, h); this.fill(); this.paths = []; this.current = null;
  }
  strokeRect(x, y, w, h) {
    this.beginPath(); this.rect(x, y, w, h); this.stroke(); this.paths = []; this.current = null;
  }
  clip() {
    // rasterise le chemin courant dans un masque, intersecté avec le masque actif
    const mask = new Uint8Array(this.W * this.H);
    const prevFill = this.state.fillStyle;
    this.state.fillStyle = [255, 255, 255, 1];
    const savedPixels = this.pixels;
    // on dessine le masque dans un tableau temporaire en réutilisant _span
    const orig = this._span.bind(this);
    this._span = (y, xa, xb) => {
      const x0 = Math.max(0, Math.round(Math.min(xa, xb)));
      const x1 = Math.min(this.W - 1, Math.round(Math.max(xa, xb)) - 1);
      for (let x = x0; x <= x1; x++) mask[y * this.W + x] = 1;
    };
    for (const path of this.paths) {
      if (path.length < 3) continue;
      const ys = path.map((p) => p[1]);
      this._scan(path, Math.max(0, Math.floor(Math.min(...ys))), Math.min(this.H - 1, Math.ceil(Math.max(...ys))), this.W);
    }
    this._span = orig;
    this.state.fillStyle = prevFill;
    this.pixels = savedPixels;
    const prev = this.state.clip;
    if (prev) for (let i = 0; i < mask.length; i++) mask[i] &= prev[i];
    this.state.clip = mask;
    return mask;
  }
  set filter(v) { this._filter = v; }
  get filter() { return this._filter; }

  // ------------------------------ lecture ---------------------------------
  getImageData(x, y, w, h) {
    if (x === 0 && y === 0 && w === this.W && h === this.H) {
      return { width: w, height: h, data: this.pixels };
    }
    const out = new Uint8ClampedArray(w * h * 4);
    for (let j = 0; j < h; j++) {
      const src = ((y + j) * this.W + x) * 4;
      out.set(this.pixels.subarray(src, src + w * 4), j * w * 4);
    }
    return { width: w, height: h, data: out };
  }
  putImageData(img, x, y) {
    for (let j = 0; j < img.height; j++) {
      const src = j * img.width * 4;
      const dst = ((y + j) * this.W + x) * 4;
      this.pixels.set(img.data.subarray(src, src + img.width * 4), dst);
    }
  }
  drawImage(srcCanvas, sx, sy, sw, sh, dx = 0, dy = 0, dw, dh) {
    const sctx = srcCanvas.getContext('2d');
    const s = sctx ? sctx.pixels : srcCanvas.data;
    if (sw === undefined) { sw = srcCanvas.width; sh = srcCanvas.height; }
    dw = dw ?? sw; dh = dh ?? sh;
    for (let j = 0; j < dh; j++) {
      const syy = Math.floor(sy + (j * sh) / dh);
      for (let i = 0; i < dw; i++) {
        const sxx = Math.floor(sx + (i * sw) / dw);
        const si = (syy * srcCanvas.width + sxx) * 4;
        const di = ((dy + j) * this.W + (dx + i)) * 4;
        if (di < 0 || di >= this.pixels.length) continue;
        const a = s[si + 3] / 255;
        if (a <= 0) continue;
        this.pixels[di] = this.pixels[di] * (1 - a) + s[si] * a;
        this.pixels[di + 1] = this.pixels[di + 1] * (1 - a) + s[si + 1] * a;
        this.pixels[di + 2] = this.pixels[di + 2] * (1 - a) + s[si + 2] * a;
        this.pixels[di + 3] = 255;
      }
    }
  }
}

/** Fabrique un objet mimant `document.createElement('canvas')`. */
export function makeCanvas(w = 256, h = 256) {
  const c = new Canvas2D(w, h);
  // certains code utilisent canvas.width = ... après création
  Object.defineProperty(c, 'width', {
    get() { return this._w; },
    set(v) {
      this._w = v;
      if (this._h) this.data = new Uint8ClampedArray(this._w * this._h * 4);
      if (this.ctx) { this.ctx.W = this._w; this.ctx.pixels = this.data; }
    },
  });
  Object.defineProperty(c, 'height', {
    get() { return this._h; },
    set(v) {
      this._h = v;
      if (this._w) this.data = new Uint8ClampedArray(this._w * this._h * 4);
      if (this.ctx) { this.ctx.H = this._h; this.ctx.pixels = this.data; }
    },
  });
  c._w = w; c._h = h;
  c.data = new Uint8ClampedArray(w * h * 4);
  c.ctx = new Context2D(c);
  return c;
}
