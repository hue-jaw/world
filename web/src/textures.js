// ============================================================================
// METROPOLIS — textures.js
// Textures procédurales HAUTE DÉFINITION, générées au chargement sur canvas.
// 100 % hors-ligne : aucun asset externe, aucune requête réseau.
//
//   façades      1024² (512² pour les petits bâtiments)
//                albédo jour + émissive nuit + carte de relief (bump)
//   asphalte     1024²  gravier multi-échelle, fissures, rustines, tampons
//   trottoir      512²  dalles chanfreinées, joints, agrégat, taches
//   herbe         512²  touffes, variation de teinte, plaques de terre
//   sol métro    2048²  tuile de 64 m : chaussée, trottoirs, bordures,
//                       marquages, passages piétons, avaloirs, tampons
//
// Contraintes de conception :
//   • coût payé UNE fois au chargement, jamais par frame ;
//   • PRNG LOCAL (mulberry32) : générer une texture ne doit pas consommer le
//     RNG du jeu, sinon la ville changerait selon l'ordre de chargement ;
//   • dégradation propre hors navigateur (stub de test sans getImageData) ;
//   • textures partagées + cachées par (palette, étage, variante).
// ============================================================================
import * as THREE from 'three';

export const TEX = {
  FACADE: 1024,
  FACADE_SMALL: 512,
  GROUND: 1024,
  SIDEWALK: 512,
  GRASS: 512,
  METRO: 2048,
  NIGHT: 256,
};

const cache = new Map();
export function clearTextureCache() { cache.clear(); }

// ---------------------------------------------------------------------------
//                          PRNG local + bruit de valeur
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rngKit(seed) {
  const r = mulberry32(seed);
  return {
    r,
    range: (a, b) => a + (b - a) * r(),
    int: (a, b) => Math.floor(a + (b - a + 1) * r()),
    pick: (arr) => arr[Math.floor(r() * arr.length) % arr.length],
    chance: (p) => r() < p,
  };
}

/** Champ de bruit 256² réutilisable (bilinéaire + smoothstep, tuilable). */
function noiseField(seed) {
  const N = 256;
  const r = mulberry32(seed);
  const f = new Float32Array(N * N);
  for (let i = 0; i < f.length; i++) f[i] = r();
  return { n: N, f };
}
function sampleNoise(field, x, y) {
  const { n, f } = field;
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const x0 = xi & (n - 1), x1 = (xi + 1) & (n - 1);
  const y0 = yi & (n - 1), y1 = (yi + 1) & (n - 1);
  const a = f[y0 * n + x0], b = f[y0 * n + x1], c = f[y1 * n + x0], d = f[y1 * n + x1];
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const top = a + (b - a) * ux;
  const bot = c + (d - c) * ux;
  return top + (bot - top) * uy;
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

// ---------------------------------------------------------------------------
//                               Outils canvas
// ---------------------------------------------------------------------------
function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
/** Lecture pixels, tolérante aux stubs de test (retourne null). */
function readPixels(ctx, w, h) {
  if (!ctx || typeof ctx.getImageData !== 'function') return null;
  try {
    const img = ctx.getImageData(0, 0, w, h);
    return img && img.data ? img : null;
  } catch { return null; }
}
function writePixels(ctx, img) {
  if (!ctx || typeof ctx.putImageData !== 'function' || !img) return;
  try { ctx.putImageData(img, 0, 0); } catch { /* stub */ }
}

function texture(c, { srgb = true, repeat = 1, aniso = 16, wrapT = THREE.RepeatWrapping } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = wrapT;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Rectangle arrondi (chemin courant). */
function roundRect(g, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/**
 * Carte de relief dérivée de l'albédo : le luminant est converti en hauteur
 * (clair = saillant, sombre = creux), avec contraste et lissage.
 * Coût : une lecture/écriture à taille réduite, quelques ms.
 */
function bumpFrom(ctx, S, outSize = 256, strength = 2.2) {
  const c = makeCanvas(outSize);
  const g = c.getContext('2d');
  const img = readPixels(ctx, S, S);
  if (!img) { // repli : gris neutre
    g.fillStyle = '#808080'; g.fillRect(0, 0, outSize, outSize);
    return texture(c, { srgb: false, aniso: 4 });
  }
  const out = g.createImageData(outSize, outSize);
  const k = S / outSize;
  for (let y = 0; y < outSize; y++) {
    for (let x = 0; x < outSize; x++) {
      // moyenne de 2×2 texels pour éviter l'aliasing
      let lum = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const sx = Math.min(S - 1, (x * k + dx * k * 0.5) | 0);
          const sy = Math.min(S - 1, (y * k + dy * k * 0.5) | 0);
          const i = (sy * S + sx) * 4;
          lum += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
        }
      }
      lum /= 4;
      const v = clamp255(128 + (lum - 128) * strength);
      const o = (y * outSize + x) * 4;
      out.data[o] = v; out.data[o + 1] = v; out.data[o + 2] = v; out.data[o + 3] = 255;
    }
  }
  writePixels(g, out);
  return texture(c, { srgb: false, aniso: 4 });
}

// ---------------------------------------------------------------------------
//                                FAÇADES
// ---------------------------------------------------------------------------
const PALETTES = {
  glass:     { wall: '#38506a', wall2: '#2b3f55', trim: '#8fa3b5', win: '#8fb6d6', frame: '#c4d2de',
               glassy: true, lit: '#ffe0aa', litRate: 0.34, store: true, brick: false },
  office:    { wall: '#78808b', wall2: '#616973', trim: '#9aa2ac', win: '#202a34', frame: '#b9c0c8',
               glassy: false, lit: '#ffe6b8', litRate: 0.30, store: true, brick: false },
  brick:     { wall: '#8a4f3b', wall2: '#713f2f', trim: '#c9b9a4', win: '#1c232a', frame: '#d8d4cb',
               glassy: false, lit: '#ffcf94', litRate: 0.38, store: false, brick: true },
  oldbrick:  { wall: '#62493f', wall2: '#4e3a32', trim: '#a89886', win: '#191f24', frame: '#c2bcb2',
               glassy: false, lit: '#f7c98b', litRate: 0.26, store: true, brick: true },
  plaster:   { wall: '#bfb096', wall2: '#a3947b', trim: '#e2d8c6', win: '#28323c', frame: '#efe9dd',
               glassy: false, lit: '#ffd79c', litRate: 0.40, store: false, brick: false },
  shop:      { wall: '#8d93a0', wall2: '#767c88', trim: '#c8ccd3', win: '#222b34', frame: '#e6e8ec',
               glassy: false, lit: '#fff0c8', litRate: 0.45, store: true, brick: false },
  house:     { wall: '#b0a084', wall2: '#988870', trim: '#e8e0d0', win: '#2c3742', frame: '#f2ece1',
               glassy: false, lit: '#ffd9a0', litRate: 0.5, store: false, brick: false },
  warehouse: { wall: '#7a8089', wall2: '#646a72', trim: '#9aa0a8', win: '#2b333c', frame: '#b4bac1',
               glassy: false, lit: '#ffd08a', litRate: 0.12, store: false, brick: false },
};

const BANDS = {
  low:   { rows: 3,  size: TEX.FACADE_SMALL },
  mid:   { rows: 6,  size: TEX.FACADE },
  high:  { rows: 10, size: TEX.FACADE },
  tower: { rows: 16, size: TEX.FACADE },
};

/**
 * Façade détaillée.
 * @returns {{day: THREE.Texture, night: THREE.Texture, bump: THREE.Texture}}
 */
export function facade(paletteName, band = 'mid', variant = 0) {
  const key = `facade:${paletteName}:${band}:${variant}`;
  if (cache.has(key)) return cache.get(key);

  const pal = PALETTES[paletteName] || PALETTES.plaster;
  const cfg = BANDS[band] || BANDS.mid;
  const S = cfg.size;
  const R = cfg.rows;
  const K = rngKit(0x9e3779b9 ^ (paletteName.length * 7919) ^ (R * 131) ^ (variant * 2654435761));

  const dayC = makeCanvas(S), nightC = makeCanvas(TEX.NIGHT);
  const d = dayC.getContext('2d');
  const nS = TEX.NIGHT;
  const n = nightC.getContext('2d');
  const px = S / TEX.FACADE;              // échelle relative (512 -> 0.5)

  d.fillStyle = '#808080'; d.fillRect(0, 0, S, S);
  n.fillStyle = '#000'; n.fillRect(0, 0, nS, nS);

  // ------------------------------- mur -------------------------------------
  const grad = d.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, pal.wall);
  grad.addColorStop(0.55, pal.wall);
  grad.addColorStop(1, pal.wall2);
  d.fillStyle = grad; d.fillRect(0, 0, S, S);

  if (pal.brick) {
    // assises de briques : joints + teinte par brique
    const bh = Math.round(9 * px), bw = Math.round(24 * px);
    for (let y = 0, row = 0; y < S; y += bh, row++) {
      for (let x = (row % 2) * (bw / 2) - bw; x < S; x += bw) {
        const t = K.range(-16, 16);
        d.fillStyle = `rgba(${150 + t},${84 + t * 0.55},${62 + t * 0.45},0.42)`;
        d.fillRect(x + 1, y + 1, bw - 2 * px, bh - 2 * px);
        // léger relief du joint
        d.fillStyle = 'rgba(0,0,0,0.16)';
        d.fillRect(x, y + bh - px, bw, px);
      }
    }
  } else if (pal.glassy) {
    // mur-rideau : trame de meneaux verticaux réguliers
    d.fillStyle = 'rgba(0,0,0,0.10)';
    for (let x = 0; x < S; x += Math.round(32 * px)) d.fillRect(x, 0, Math.round(2 * px), S);
  } else {
    // béton / crépis : joints de panneaux + taches d'humidité
    for (let y = 0; y < S; y += Math.round(96 * px)) {
      d.fillStyle = 'rgba(0,0,0,0.09)'; d.fillRect(0, y, S, Math.round(2 * px));
      d.fillStyle = 'rgba(255,255,255,0.05)'; d.fillRect(0, y + Math.round(2 * px), S, Math.round(2 * px));
    }
    for (let i = 0; i < 26; i++) {
      d.fillStyle = `rgba(${K.int(20, 70)},${K.int(20, 70)},${K.int(20, 70)},0.05)`;
      d.beginPath();
      d.ellipse(K.r() * S, K.r() * S, K.range(30, 150) * px, K.range(20, 110) * px, K.r() * 3, 0, 6.283);
      d.fill();
    }
  }

  // grain fin (milliers de micro-taches, coût négligeable)
  const grainCount = Math.round(5200 * px * px);
  for (let i = 0; i < grainCount; i++) {
    const a = K.range(0.02, 0.06);
    d.fillStyle = K.r() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    d.fillRect(K.r() * S, K.r() * S, K.range(1, 2.5) * px, K.range(1, 2.5) * px);
  }

  // ------------------------------ fenêtres ---------------------------------
  const cols = pal.glassy ? 5 : S <= TEX.FACADE_SMALL ? 4 : 6;
  const cw = S / cols, ch = S / R;
  const residential = paletteName === 'house' || paletteName === 'brick'
    || paletteName === 'plaster' || paletteName === 'oldbrick';

  for (let r = 0; r < R; r++) {
    const groundFloor = r === R - 1;
    for (let c = 0; c < cols; c++) {
      // marge symétrique -> la texture se répète sans couture horizontalement
      const cellX = c * cw;
      const wRatio = pal.glassy ? 0.80 : K.range(0.42, 0.52);
      const hRatio = pal.glassy ? 0.74 : K.range(0.48, 0.60);
      const ww = cw * wRatio, wh = ch * hRatio;
      const x = cellX + (cw - ww) / 2;
      const y = r * ch + (ch - wh) / 2;

      // ---- rez-de-chaussée : vitrine ou porte cochère
      if (groundFloor && pal.store) {
        drawStorefront(d, n, S, nS, x, y, cw, ch, pal, K, px);
        continue;
      }
      if (groundFloor && residential && c === Math.floor(cols / 2)) {
        drawDoor(d, x, y + wh * 0.06, cw * 0.42, ch * 0.86, pal, K, px);
        continue;
      }
      if (groundFloor && paletteName === 'warehouse') {
        drawShutterDoor(d, x, y, ww, wh, pal, K, px);
        continue;
      }

      drawWindow(d, n, S, nS, x, y, ww, wh, pal, K, px, { residential, row: r });
    }
  }

  // ------------------------- corniche / plinthe ----------------------------
  const corniceH = Math.round(18 * px);
  d.fillStyle = 'rgba(0,0,0,0.32)'; d.fillRect(0, 0, S, corniceH);
  d.fillStyle = 'rgba(255,255,255,0.16)'; d.fillRect(0, corniceH, S, Math.round(3 * px));
  // denticules
  d.fillStyle = 'rgba(0,0,0,0.18)';
  for (let x = 0; x < S; x += Math.round(16 * px)) d.fillRect(x, corniceH, Math.round(7 * px), Math.round(6 * px));
  // plinthe : salissure de pied de mur
  const plinth = d.createLinearGradient(0, S - 70 * px, 0, S);
  plinth.addColorStop(0, 'rgba(0,0,0,0)');
  plinth.addColorStop(1, 'rgba(0,0,0,0.34)');
  d.fillStyle = plinth; d.fillRect(0, S - 70 * px, S, 70 * px);

  // coulures verticales sous les fenêtres
  for (let i = 0; i < Math.round(34 * px); i++) {
    const x = K.r() * S, h = K.range(30, 220) * px, w = K.range(1, 3.4) * px;
    const g2 = d.createLinearGradient(0, 0, 0, h);
    g2.addColorStop(0, 'rgba(0,0,0,0.16)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
    d.fillStyle = g2; d.fillRect(x, K.r() * S * 0.6, w, h);
  }

  // RepeatWrapping vertical : indispensable depuis que les UV des façades sont
  // exprimées en MÈTRES (une tuile = un nombre entier d'étages). Avec
  // ClampToEdge, un immeuble de 40 m n'affichait qu'une fraction de texture :
  // les fenêtres étaient étirées — c'était le « textures tordues » signalé.
  const out = {
    day: texture(dayC, { aniso: 16, wrapT: THREE.RepeatWrapping }),
    night: texture(nightC, { aniso: 4, wrapT: THREE.RepeatWrapping }),
    bump: bumpFrom(d, S, 256, 2.0),
    // une tuile de façade couvre 16 m de large × (rows × 3 m) de haut
    tileMeters: 16,
    tileHeight: cfg.rows * 3,
  };
  cache.set(key, out);
  return out;
}

/**
 * Tuile de façade TUILABLE dans les deux sens (v0.6).
 *
 * Pourquoi une seconde génération : la texture de `facade()` contient une
 * devanture de magasin, une corniche et une plinthe. Avec des UV exprimés en
 * mètres (obligatoire pour que les fenêtres ne soient pas étirées), cette
 * texture se répète verticalement : on voyait donc une vitrine de boutique
 * tous les 18 m au milieu des tours, et une corniche à chaque étage.
 *
 * `facadeTiling()` ne contient QUE des étages réguliers, sans bord haut/bas :
 * la répétition verticale est invisible. Les rez-de-chaussée commerçants sont
 * rendus à part par `shopfront()` sur un podium de 4 m (cf. city.js).
 *
 * @returns {{day: THREE.Texture, night: THREE.Texture, bump: THREE.Texture,
 *            tileMeters: number, tileHeight: number}}
 */
export function facadeTiling(paletteName, band = 'mid', variant = 0) {
  const key = `tile:${paletteName}:${band}:${variant}`;
  if (cache.has(key)) return cache.get(key);

  const pal = PALETTES[paletteName] || PALETTES.plaster;
  const cfg = BANDS[band] || BANDS.mid;
  const S = cfg.size, R = cfg.rows;
  const K = rngKit(0x51ed270b ^ (paletteName.length * 7919) ^ (R * 131) ^ (variant * 2654435761));

  const dayC = makeCanvas(S), nightC = makeCanvas(TEX.NIGHT);
  const d = dayC.getContext('2d'), n = nightC.getContext('2d');
  const nS = TEX.NIGHT, px = S / TEX.FACADE;

  // Mur uni : un dégradé vertical créerait une couture à chaque répétition.
  d.fillStyle = pal.wall; d.fillRect(0, 0, S, S);
  n.fillStyle = '#000'; n.fillRect(0, 0, nS, nS);

  const rows = R, ch = S / rows;
  const cols = pal.glassy ? 5 : 6, cw = S / cols;
  const residential = paletteName === 'house' || paletteName === 'brick'
    || paletteName === 'plaster' || paletteName === 'oldbrick';

  // Trame de panneaux : lignes alignées sur les étages (donc périodiques).
  for (let r = 0; r < rows; r++) {
    const y = r * ch;
    d.fillStyle = 'rgba(0,0,0,0.10)'; d.fillRect(0, y, S, Math.max(1, 2 * px));
    d.fillStyle = 'rgba(255,255,255,0.05)'; d.fillRect(0, y + Math.max(1, 2 * px), S, Math.max(1, 1.5 * px));
    // joints verticaux décalés d'une rangée sur l'autre (appareil de briques)
    const off = (r % 2) * (cw / 2);
    for (let x = off; x < S; x += cw) {
      d.fillStyle = 'rgba(0,0,0,0.07)'; d.fillRect(x, y, Math.max(1, 1.5 * px), ch);
    }
  }
  if (pal.brick) {
    for (let y = 0; y < S; y += Math.max(2, ch / 3)) {
      d.fillStyle = 'rgba(0,0,0,0.07)'; d.fillRect(0, y, S, Math.max(1, 1.2 * px));
    }
  }

  // Grain + taches d'humidité (périodique : aucun bord privilégié).
  for (let i = 0; i < Math.round(3200 * px * px); i++) {
    const a = K.range(0.02, 0.05);
    d.fillStyle = K.r() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    d.fillRect(K.r() * S, K.r() * S, K.range(1, 2.5) * px, K.range(1, 2.5) * px);
  }
  for (let i = 0; i < 18; i++) {
    d.fillStyle = `rgba(${K.int(20, 70)},${K.int(20, 70)},${K.int(20, 70)},0.05)`;
    d.beginPath();
    d.ellipse(K.r() * S, K.r() * S, K.range(30, 130) * px, K.range(20, 90) * px, K.r() * 3, 0, 6.283);
    d.fill();
  }

  // Fenêtres : AUCUN rez-de-chaussée spécial, c'est ce qui rend la tuile
  // uniforme sur toute la hauteur du bâtiment.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellX = c * cw;
      const wRatio = pal.glassy ? 0.86 : K.range(0.44, 0.54);
      const hRatio = pal.glassy ? 0.80 : K.range(0.50, 0.62);
      const ww = cw * wRatio, wh = ch * hRatio;
      const x = cellX + (cw - ww) / 2;
      const y = r * ch + (ch - wh) / 2;
      drawWindow(d, n, S, nS, x, y, ww, wh, pal, K, px, { residential, row: r });
    }
  }

  const out = {
    day: texture(dayC, { aniso: 16, wrapT: THREE.RepeatWrapping }),
    night: texture(nightC, { aniso: 8, wrapT: THREE.RepeatWrapping }),
    bump: bumpFrom(d, S, 256, 1.8),
    tileMeters: 16,
    tileHeight: rows * 3,
  };
  cache.set(key, out);
  return out;
}

/**
 * Bandeau de rez-de-chaussée commerçant (podium 4 m), 512×128.
 * 4 vitrines par tuile, auvents colorés, enseigne, lueur chaude la nuit.
 * Utilisé par l'InstancedMesh `podium` de city.js : un seul draw call pour
 * toutes les boutiques de la ville.
 */
export function shopfront(variant = 0) {
  const key = `shopfront:${variant}`;
  if (cache.has(key)) return cache.get(key);
  const W = 512, H = 128;
  const K = rngKit(0x2545f491 ^ (variant * 2246822519));
  const dayC = makeCanvas(W, H), nightC = makeCanvas(W, H);
  const d = dayC.getContext('2d'), n = nightC.getContext('2d');

  d.fillStyle = '#2a2d33'; d.fillRect(0, 0, W, H);
  n.fillStyle = '#000'; n.fillRect(0, 0, W, H);

  const shops = 4, sw = W / shops;
  const awnings = ['#b8302f', '#1f5f8b', '#2f7d4f', '#c28b1f', '#6b3f8f'];
  for (let i = 0; i < shops; i++) {
    const x = i * sw;
    // encadrement
    d.fillStyle = '#4a4e55'; d.fillRect(x + 2, 8, sw - 4, H - 16);
    // vitrine
    const gx = x + 10, gy = 34, gw = sw - 20, gh = H - 44;
    const g = d.createLinearGradient(gx, gy, gx + gw * 0.4, gy + gh);
    g.addColorStop(0, '#cfe6f5'); g.addColorStop(0.5, '#5d7d94'); g.addColorStop(1, '#1f2a33');
    d.fillStyle = g; d.fillRect(gx, gy, gw, gh);
    // reflet diagonal
    d.save(); d.beginPath(); d.rect(gx, gy, gw, gh); d.clip();
    d.globalAlpha = 0.28; d.fillStyle = '#ffffff';
    d.beginPath(); d.moveTo(gx, gy + gh * 0.9); d.lineTo(gx + gw * 0.55, gy);
    d.lineTo(gx + gw * 0.85, gy); d.lineTo(gx + gw * 0.3, gy + gh); d.closePath(); d.fill();
    d.globalAlpha = 1; d.restore();
    // auvent
    const ac = awnings[(i + variant) % awnings.length];
    d.fillStyle = ac; d.fillRect(x + 6, 18, sw - 12, 16);
    for (let k = 0; k < 8; k++) {
      d.fillStyle = k % 2 ? 'rgba(255,255,255,0.82)' : 'rgba(0,0,0,0.10)';
      d.fillRect(x + 6 + k * ((sw - 12) / 8), 18, (sw - 12) / 16, 16);
    }
    // enseigne au-dessus de la vitrine
    d.fillStyle = '#16181c'; d.fillRect(x + 10, 8, sw - 20, 8);
    // montants
    d.fillStyle = '#2b2f35'; d.fillRect(gx + gw * 0.5 - 2, gy, 4, gh);
    // seuil
    d.fillStyle = '#6b7079'; d.fillRect(x + 6, H - 10, sw - 12, 6);
    // porte (une boutique sur deux)
    if (i % 2 === 0) {
      d.fillStyle = '#1a2028'; d.fillRect(x + sw - 46, gy + gh * 0.35, 26, gh * 0.65);
      d.fillStyle = '#8a939e'; d.fillRect(x + sw - 30, gy + gh * 0.6, 3, 3);
    }
    // lumière de la boutique la nuit
    const warm = K.pick(['#ffd79a', '#ffe9c4', '#ffc36b']);
    n.fillStyle = warm; n.globalAlpha = 0.85; n.fillRect(x + 10, 34, sw - 20, H - 44); n.globalAlpha = 1;
    n.fillStyle = '#000'; n.globalAlpha = 0.35;
    n.fillRect(gx + gw * 0.5 - 2, gy, 4, gh);
    n.globalAlpha = 1;
  }

  const out = {
    day: texture(dayC, { aniso: 8 }),
    night: texture(nightC, { aniso: 4 }),
  };
  cache.set(key, out);
  return out;
}

function drawWindow(d, n, S, nS, x, y, w, h, pal, K, px, opt = {}) {
  const k = nS / S; // facteur d'échelle vers la texture de nuit

  // 1) feuillure : ombre portée dans l'ouverture
  d.fillStyle = 'rgba(0,0,0,0.45)';
  d.fillRect(x - 3 * px, y - 3 * px, w + 6 * px, h + 6 * px);

  // 2) vitrage : dégradé ciel -> intérieur
  const wg = d.createLinearGradient(x, y, x + w * 0.35, y + h);
  wg.addColorStop(0, pal.win);
  if (pal.glassy) {
    wg.addColorStop(0.45, '#7ea8c9');
    wg.addColorStop(1, '#3d5a72');
  } else {
    wg.addColorStop(0.55, '#1d2933');
    wg.addColorStop(1, '#0d1318');
  }
  d.fillStyle = wg; d.fillRect(x, y, w, h);

  // 3) reflet du ciel (bande diagonale)
  d.save();
  d.beginPath(); d.rect(x, y, w, h); d.clip();
  d.globalAlpha = pal.glassy ? 0.34 : 0.22;
  d.fillStyle = '#d7e9f7';
  d.beginPath();
  d.moveTo(x, y + h * 0.82); d.lineTo(x + w * 0.62, y);
  d.lineTo(x + w, y); d.lineTo(x + w, y + h * 0.18); d.lineTo(x + w * 0.18, y + h);
  d.lineTo(x, y + h); d.closePath(); d.fill();
  d.globalAlpha = 1;

  // 4) rideau / store selon la palette
  if (opt.residential && K.chance(0.40)) {
    const ch2 = h * K.range(0.16, 0.46);
    d.fillStyle = K.pick(['#d9c9a8', '#b9c6cf', '#dad0bd', '#8f9aa6', '#c9b7a4']);
    d.globalAlpha = 0.94; d.fillRect(x, y, w, ch2); d.globalAlpha = 1;
    d.fillStyle = 'rgba(0,0,0,0.10)';
    for (let i = 0; i < 4; i++) d.fillRect(x, y + ch2 * (i / 4), w, 1 * px);
  } else if (K.chance(0.14)) {
    // volet roulant à demi baissé
    const sh = h * K.range(0.25, 0.7);
    d.fillStyle = pal.trim; d.fillRect(x, y, w, sh);
    d.fillStyle = 'rgba(0,0,0,0.14)';
    for (let yy = y; yy < y + sh; yy += Math.max(2, 3 * px)) d.fillRect(x, yy, w, 1 * px);
  }
  d.restore();

  // 5) menuiserie : cadre + meneau + traverse
  d.strokeStyle = pal.frame;
  d.lineWidth = Math.max(1.4, 3.2 * px);
  d.strokeRect(x, y, w, h);
  d.fillStyle = pal.frame;
  const mull = Math.max(1.2, 2.6 * px);
  d.fillRect(x + w / 2 - mull / 2, y, mull, h);           // meneau
  if (h > 60 * px) d.fillRect(x, y + h * 0.40, w, mull);  // traverse
  // petit reflet sur le cadre
  d.fillStyle = 'rgba(255,255,255,0.35)';
  d.fillRect(x, y, w, Math.max(1, 1.5 * px));

  // 6) appui de fenêtre + ombre portée
  const sillH = Math.max(3, 8 * px);
  d.fillStyle = pal.trim;
  d.fillRect(x - 6 * px, y + h + 2 * px, w + 12 * px, sillH);
  d.fillStyle = 'rgba(0,0,0,0.42)';
  d.fillRect(x - 6 * px, y + h + 2 * px + sillH, w + 12 * px, Math.max(2, 5 * px));
  // linteau
  d.fillStyle = 'rgba(255,255,255,0.14)';
  d.fillRect(x - 4 * px, y - 7 * px, w + 8 * px, 4 * px);

  // 7) climatiseur / jardinière
  if (!opt.residential && K.chance(0.05)) {
    const aw = w * 0.42, ah = Math.max(6, 16 * px);
    const ax = x + w * 0.52, ay = y + h + sillH + 6 * px;
    d.fillStyle = '#b9c0c7'; d.fillRect(ax, ay, aw, ah);
    d.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < 3; i++) d.fillRect(ax + 2 * px, ay + ah * 0.2 + i * ah * 0.22, aw - 4 * px, 1.2 * px);
    d.fillStyle = 'rgba(0,0,0,0.30)'; d.fillRect(ax, ay + ah, aw, 3 * px);
  } else if (opt.residential && K.chance(0.10)) {
    const bw = w * 0.9, bh = Math.max(4, 9 * px);
    d.fillStyle = '#5d4a3a'; d.fillRect(x + w * 0.05, y + h + sillH + 2 * px, bw, bh);
    d.fillStyle = K.pick(['#4f7a3a', '#5f8f42', '#7a5f38']);
    for (let i = 0; i < 6; i++) {
      d.beginPath();
      d.arc(x + w * 0.12 + i * (bw * 0.15), y + h + sillH, K.range(3, 6) * px, 0, 6.283);
      d.fill();
    }
  }

  // 8) balcon
  if (opt.residential && opt.row > 0 && h > 44 * px && K.chance(0.26)) {
    const by = y + h + sillH + 8 * px;
    const bw = w * 1.5, bx = x - w * 0.25;
    const slab = Math.max(4, 9 * px);
    d.fillStyle = 'rgba(0,0,0,0.30)'; d.fillRect(bx, by + slab, bw, 6 * px);
    d.fillStyle = '#8d8a84'; d.fillRect(bx, by, bw, slab);
    d.fillStyle = 'rgba(255,255,255,0.22)'; d.fillRect(bx, by, bw, 1.6 * px);
    d.strokeStyle = 'rgba(40,44,50,0.85)'; d.lineWidth = Math.max(1, 1.6 * px);
    const railH = 26 * px;
    for (let bx2 = bx + 3 * px; bx2 < bx + bw; bx2 += Math.max(4, 7 * px)) {
      d.beginPath(); d.moveTo(bx2, by - railH); d.lineTo(bx2, by); d.stroke();
    }
    d.lineWidth = Math.max(1.4, 2.4 * px);
    d.beginPath(); d.moveTo(bx, by - railH); d.lineTo(bx + bw, by - railH); d.stroke();
  }

  // 9) version nuit : fenêtre allumée
  if (K.r() < pal.litRate) {
    const nx = x * k, ny = y * k, nw = w * k, nh = h * k;
    const warm = K.chance(0.82);
    const base = warm ? pal.lit : '#cfe3ff';
    // halo diffus autour de la fenêtre
    const hg = n.createRadialGradient(nx + nw / 2, ny + nh / 2, 0, nx + nw / 2, ny + nh / 2, Math.max(nw, nh) * 1.5);
    hg.addColorStop(0, warm ? 'rgba(255,214,150,0.55)' : 'rgba(190,220,255,0.45)');
    hg.addColorStop(1, 'rgba(0,0,0,0)');
    n.fillStyle = hg;
    n.fillRect(nx - nw, ny - nh, nw * 3, nh * 3);
    // vitrage lumineux
    const g3 = n.createLinearGradient(nx, ny, nx, ny + nh);
    g3.addColorStop(0, base); g3.addColorStop(1, warm ? '#c98f4a' : '#8fb6d8');
    n.fillStyle = g3;
    n.globalAlpha = K.range(0.55, 1);
    n.fillRect(nx, ny, nw, nh);
    n.globalAlpha = 1;
    // silhouette intérieure (rideau, meuble, personne)
    if (K.chance(0.45)) {
      n.fillStyle = 'rgba(0,0,0,0.55)';
      n.fillRect(nx + nw * K.range(0, 0.5), ny + nh * K.range(0.25, 0.55), nw * K.range(0.12, 0.34), nh * 0.55);
    }
    // meneau sombre par-dessus
    n.fillStyle = 'rgba(0,0,0,0.65)';
    n.fillRect(nx + nw / 2 - (nw * 0.015), ny, nw * 0.03, nh);
  }
}

function drawStorefront(d, n, S, nS, x, y, cw, ch, pal, K, px) {
  const k = nS / S;
  const sw = cw * 0.86, sh = ch * 0.66;
  const sx = x + cw * 0.02, sy = y + ch * 0.20;

  // encadrement
  d.fillStyle = 'rgba(0,0,0,0.55)'; d.fillRect(sx - 4 * px, sy - 4 * px, sw + 8 * px, sh + 8 * px);
  // vitrine
  const gl = d.createLinearGradient(sx, sy, sx + sw, sy + sh);
  gl.addColorStop(0, '#22303c');
  gl.addColorStop(0.5, '#3b5265');
  gl.addColorStop(1, '#16202a');
  d.fillStyle = gl; d.fillRect(sx, sy, sw, sh);
  // reflet
  d.globalAlpha = 0.28; d.fillStyle = '#cfe6f7';
  d.beginPath();
  d.moveTo(sx, sy + sh * 0.9); d.lineTo(sx + sw * 0.5, sy); d.lineTo(sx + sw * 0.82, sy);
  d.lineTo(sx + sw * 0.22, sy + sh); d.lineTo(sx, sy + sh); d.closePath(); d.fill();
  d.globalAlpha = 1;

  // étagère / marchandise derrière la vitre
  d.fillStyle = 'rgba(230,210,170,0.20)';
  for (let i = 0; i < 3; i++) d.fillRect(sx + sw * 0.1, sy + sh * (0.3 + i * 0.18), sw * 0.8, 3 * px);

  // montants
  d.fillStyle = '#20272e';
  d.fillRect(sx + sw / 2 - 2 * px, sy, 4 * px, sh);
  d.fillRect(sx, sy, sw, 5 * px);
  d.fillRect(sx, sy + sh - 5 * px, sw, 5 * px);

  // enseigne au-dessus
  const signH = ch * 0.13;
  const sc = K.pick(['#e0453f', '#e8a33d', '#3d9ad1', '#4fae63', '#c94c8a']);
  d.fillStyle = sc;
  d.fillRect(sx, sy - signH - 6 * px, sw, signH);
  d.fillStyle = 'rgba(0,0,0,0.25)';
  d.fillRect(sx, sy - 6 * px, sw, 3 * px);
  // pseudo-texte
  d.fillStyle = 'rgba(255,255,255,0.88)';
  let tx = sx + sw * 0.08;
  while (tx < sx + sw * 0.9) {
    const tw = K.range(6, 18) * px;
    d.fillRect(tx, sy - signH * 0.66, tw, signH * 0.34);
    tx += tw + K.range(4, 10) * px;
  }

  // auvent rayé
  if (K.chance(0.55)) {
    const awnH = ch * 0.10;
    const ay = sy - signH - 8 * px - awnH;
    for (let i = 0; i < 8; i++) {
      d.fillStyle = i % 2 ? '#e9e6df' : sc;
      d.fillRect(sx + (sw / 8) * i, ay, sw / 8 + 0.5, awnH);
    }
    d.fillStyle = 'rgba(0,0,0,0.30)';
    d.fillRect(sx, ay + awnH, sw, 4 * px);
  }

  // nuit : vitrine allumée + enseigne lumineuse
  const nx = sx * k, ny = sy * k, nw = sw * k, nh = sh * k;
  n.fillStyle = '#ffe8b8';
  n.globalAlpha = 0.9;
  n.fillRect(nx, ny, nw, nh);
  n.globalAlpha = 1;
  n.fillStyle = '#000';
  n.fillRect(nx + nw / 2 - nw * 0.008, ny, nw * 0.016, nh);
  n.fillStyle = sc;
  n.fillRect(nx, (sy - signH - 6 * px) * k, nw, signH * k);
  // halo de vitrine sur le trottoir
  n.fillStyle = 'rgba(255,220,160,0.35)';
  n.fillRect(nx - nw * 0.05, ny + nh, nw * 1.1, nh * 0.12);
}

function drawDoor(d, x, y, w, h, pal, K, px) {
  d.fillStyle = 'rgba(0,0,0,0.50)'; d.fillRect(x - 4 * px, y - 4 * px, w + 8 * px, h + 8 * px);
  const g = d.createLinearGradient(x, y, x + w, y);
  g.addColorStop(0, '#3a2c22'); g.addColorStop(0.5, '#5b4433'); g.addColorStop(1, '#3a2c22');
  d.fillStyle = g; d.fillRect(x, y, w, h);
  // panneaux
  d.strokeStyle = 'rgba(0,0,0,0.45)'; d.lineWidth = Math.max(1, 2 * px);
  d.strokeRect(x + w * 0.16, y + h * 0.10, w * 0.68, h * 0.34);
  d.strokeRect(x + w * 0.16, y + h * 0.52, w * 0.68, h * 0.36);
  // poignée
  d.fillStyle = '#c9a227';
  d.beginPath(); d.arc(x + w * 0.82, y + h * 0.52, 3.4 * px, 0, 6.283); d.fill();
  // imposte vitrée
  d.fillStyle = '#1b2630'; d.fillRect(x + w * 0.16, y + h * 0.05, w * 0.68, h * 0.06);
  // marches
  d.fillStyle = '#9a978f'; d.fillRect(x - 6 * px, y + h, w + 12 * px, 5 * px);
  d.fillStyle = 'rgba(0,0,0,0.30)'; d.fillRect(x - 6 * px, y + h + 5 * px, w + 12 * px, 4 * px);
}

function drawShutterDoor(d, x, y, w, h, pal, K, px) {
  d.fillStyle = '#5a6169'; d.fillRect(x, y, w, h);
  d.fillStyle = 'rgba(255,255,255,0.16)';
  for (let yy = y; yy < y + h; yy += Math.max(3, 5 * px)) d.fillRect(x, yy, w, 1.4 * px);
  d.strokeStyle = 'rgba(0,0,0,0.45)'; d.lineWidth = Math.max(1.5, 3 * px);
  d.strokeRect(x, y, w, h);
  d.fillStyle = 'rgba(0,0,0,0.35)'; d.fillRect(x, y + h, w, 5 * px);
}


// ---------------------------------------------------------------------------
//                    DÉTAIL DE SOL (échelle métrique)
// ---------------------------------------------------------------------------
/**
 * Une seule tuile de sol ne peut pas être nette à la fois à 300 m et sous les
 * pieds. On ajoute donc une texture de DÉTAIL en échelle métrique, combinée en
 * MULTIPLICATEUR (tileable 4 m, très peu contrastée) : elle apporte le grain
 * d'asphalte et les micro-fissures que le joueur voit de près, sans doubler le
 * coût mémoire de la grande tuile.
 *
 * @param {'asphalt'|'walk'|'grass'} kind
 */
export function groundDetailHD(kind = 'asphalt', seed = 9001) {
  const key = `detail:${kind}:${seed}`;
  if (cache.has(key)) return cache.get(key);

  const S = 512;                  // 2 m -> 256 px/m (budget mémoire divisé par 4)
  const c = makeCanvas(S), g = c.getContext('2d');
  const K = rngKit(seed + kind.length * 977);
  const f1 = noiseField(seed + 11), f2 = noiseField(seed + 12), f3 = noiseField(seed + 13);

  const tileMeters = 2;
  const base = kind === 'walk' ? 200 : kind === 'grass' ? 190 : 205;
  g.fillStyle = `rgb(${base},${base},${base})`;
  g.fillRect(0, 0, S, S);

  const img = readPixels(g, S, S);
  if (img) {
    const data = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        // bruit fin : c'est lui qui « accroche » l'œil à 1 m du sol
        const n1 = sampleNoise(f1, (x / S) * 96, (y / S) * 96) - 0.5;
        const n2 = sampleNoise(f2, (x / S) * 320, (y / S) * 320) - 0.5;
        const n3 = sampleNoise(f3, (x / S) * 900, (y / S) * 900) - 0.5;
        const amp = kind === 'grass' ? 34 : 26;
        const v = base + (n1 * amp * 0.5 + n2 * amp * 0.32 + n3 * amp * 0.18);
        const i = (y * S + x) * 4;
        data[i] = clamp255(v); data[i + 1] = clamp255(v); data[i + 2] = clamp255(v); data[i + 3] = 255;
      }
    }
    writePixels(g, img);
  }

  if (kind === 'asphalt') {
    // gravier : grains clairs et sombres, échelle centimétrique
    for (let i = 0; i < 26000; i++) {
      const v = K.int(-46, 44);
      const g2 = 214 + v;
      g.fillStyle = `rgba(${g2},${g2},${g2},${K.range(0.25, 0.85)})`;
      g.fillRect(K.r() * S, K.r() * S, K.range(1, 3.2), K.range(1, 3.2));
    }
    // micro-fissures
    for (let i = 0; i < 40; i++) {
      let x = K.r() * S, y = K.r() * S, a = K.r() * 6.283;
      g.strokeStyle = `rgba(150,150,150,${K.range(0.5, 0.95)})`;
      g.lineWidth = K.range(0.8, 2.2);
      g.beginPath(); g.moveTo(x, y);
      for (let s2 = 0; s2 < K.int(4, 12); s2++) {
        a += K.range(-0.8, 0.8);
        x += Math.cos(a) * K.range(6, 22); y += Math.sin(a) * K.range(6, 22);
        g.lineTo(x, y);
      }
      g.stroke();
    }
  } else if (kind === 'walk') {
    // agrégat lavé + éclats
    for (let i = 0; i < 18000; i++) {
      const v = K.int(-40, 34);
      const g2 = 210 + v;
      g.fillStyle = `rgba(${g2},${g2},${g2},${K.range(0.2, 0.7)})`;
      g.fillRect(K.r() * S, K.r() * S, K.range(1, 3), K.range(1, 3));
    }
    for (let i = 0; i < 90; i++) {
      const v = K.int(-30, 30);
      g.fillStyle = `rgba(${215 + v},${215 + v},${215 + v},0.55)`;
      g.beginPath();
      g.ellipse(K.r() * S, K.r() * S, K.range(3, 12), K.range(2, 9), K.r() * 3, 0, 6.283);
      g.fill();
    }
  } else {
    // brins d'herbe courts
    for (let i = 0; i < 16000; i++) {
      const v = K.int(-60, 56);
      const g2 = 196 + v;
      g.fillStyle = `rgba(${g2},${g2},${g2},${K.range(0.2, 0.6)})`;
      g.fillRect(K.r() * S, K.r() * S, K.range(1, 2.4), K.range(1, 2.4));
    }
  }

  const out = texture(c, { srgb: false, aniso: 16, repeat: 1 });
  out.userData = { tileMeters };
  cache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
//                                ASPHALTE
// ---------------------------------------------------------------------------
export function asphaltHD(seed = 1337) {
  const key = `asphalt:${seed}`;
  if (cache.has(key)) return cache.get(key);

  const S = TEX.GROUND;
  const c = makeCanvas(S), g = c.getContext('2d');
  const K = rngKit(seed);
  const f1 = noiseField(seed + 1), f2 = noiseField(seed + 2), f3 = noiseField(seed + 3);

  // --- base + bruit multi-échelle (le vrai grain de l'asphalte) -------------
  g.fillStyle = '#4a4d52'; g.fillRect(0, 0, S, S);
  const img = readPixels(g, S, S);
  if (img) {
    const data = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n1 = sampleNoise(f1, (x / S) * 24, (y / S) * 24) - 0.5;   // plaques
        const n2 = sampleNoise(f2, (x / S) * 96, (y / S) * 96) - 0.5;   // agrégat moyen
        const n3 = sampleNoise(f3, (x / S) * 512, (y / S) * 512) - 0.5; // grain fin
        const v = n1 * 26 + n2 * 16 + n3 * 20;
        // très légère dérive chromatique (bitume chaud/froid)
        const warm = n1 * 10;
        const i = (y * S + x) * 4;
        data[i] = clamp255(74 + v + warm);
        data[i + 1] = clamp255(77 + v + warm * 0.6);
        data[i + 2] = clamp255(82 + v - warm * 0.4);
        data[i + 3] = 255;
      }
    }
    writePixels(g, img);
  }

  // --- gravier apparent (points durs brillants) ----------------------------
  for (let i = 0; i < 24000; i++) {
    const v = K.int(-26, 34);
    const a = K.range(0.12, 0.5);
    g.fillStyle = `rgba(${96 + v},${99 + v},${104 + v},${a})`;
    g.fillRect(K.r() * S, K.r() * S, K.range(0.7, 2.2), K.range(0.7, 2.2));
  }

  // --- traces de pneus (assombrissement doux, pas de motif répétitif) ------
  for (let i = 0; i < 26; i++) {
    const y = K.r() * S, h = K.range(24, 110);
    const gg = g.createLinearGradient(0, y, 0, y + h);
    gg.addColorStop(0, 'rgba(20,22,25,0)');
    gg.addColorStop(0.5, 'rgba(20,22,25,0.13)');
    gg.addColorStop(1, 'rgba(20,22,25,0)');
    g.fillStyle = gg; g.fillRect(0, y, S, h);
  }

  // --- fissures ramifiées ---------------------------------------------------
  for (let i = 0; i < 26; i++) {
    let x = K.r() * S, y = K.r() * S, a = K.r() * 6.283;
    // liseré clair (agrégat arraché) puis trait sombre
    g.strokeStyle = 'rgba(150,152,156,0.35)';
    g.lineWidth = K.range(2.5, 4.5);
    g.beginPath(); g.moveTo(x, y);
    const pts = [[x, y]];
    for (let s = 0; s < K.int(5, 18); s++) {
      a += K.range(-0.8, 0.8);
      x += Math.cos(a) * K.range(8, 26); y += Math.sin(a) * K.range(8, 26);
      g.lineTo(x, y); pts.push([x, y]);
    }
    g.stroke();
    g.strokeStyle = `rgba(14,16,19,${K.range(0.5, 0.9)})`;
    g.lineWidth = K.range(0.9, 2.2);
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let s = 1; s < pts.length; s++) g.lineTo(pts[s][0], pts[s][1]);
    g.stroke();
    // ramifications
    if (K.chance(0.6)) {
      const [bx, by] = pts[Math.floor(pts.length / 2)];
      g.lineWidth = K.range(0.6, 1.4);
      g.beginPath(); g.moveTo(bx, by);
      g.lineTo(bx + K.range(-40, 40), by + K.range(-40, 40));
      g.stroke();
    }
  }

  // --- rustines de réparation ----------------------------------------------
  for (let i = 0; i < 12; i++) {
    const w = K.range(60, 200), h = K.range(40, 130);
    const x = K.r() * (S - w), y = K.r() * (S - h);
    g.fillStyle = `rgba(${K.int(52, 66)},${K.int(54, 68)},${K.int(58, 72)},0.85)`;
    roundRect(g, x, y, w, h, 10); g.fill();
    // joint de bitume noirci + reflet gras
    g.strokeStyle = 'rgba(18,20,23,0.75)'; g.lineWidth = 3.5; g.stroke();
    g.strokeStyle = 'rgba(140,142,148,0.20)'; g.lineWidth = 1.2;
    roundRect(g, x + 3, y + 3, w - 6, h - 6, 8); g.stroke();
  }

  // --- nids-de-poule --------------------------------------------------------
  for (let i = 0; i < 7; i++) {
    const x = K.r() * S, y = K.r() * S, r = K.range(8, 26);
    g.fillStyle = 'rgba(12,14,17,0.85)';
    g.beginPath(); g.ellipse(x, y, r, r * K.range(0.6, 1), K.r() * 3, 0, 6.283); g.fill();
    g.strokeStyle = 'rgba(150,150,154,0.35)'; g.lineWidth = 2;
    g.beginPath(); g.ellipse(x, y, r + 2, r * 0.9 + 2, 0, 0, 6.283); g.stroke();
  }

  // --- tampons / avaloirs ---------------------------------------------------
  for (let i = 0; i < 3; i++) {
    const x = K.range(80, S - 80), y = K.range(80, S - 80), r = K.range(22, 30);
    g.fillStyle = '#2b2f34'; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
    g.strokeStyle = 'rgba(168,174,182,0.55)'; g.lineWidth = 3; g.stroke();
    g.strokeStyle = 'rgba(150,158,166,0.40)'; g.lineWidth = 2;
    for (let k = -3; k <= 3; k++) {
      g.beginPath(); g.moveTo(x - r * 0.72, y + k * 7); g.lineTo(x + r * 0.72, y + k * 7); g.stroke();
    }
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(x, y, r + 3, 0, 6.283); g.stroke();
  }

  const out = {
    map: texture(c, { aniso: 16 }),
    bump: bumpFrom(g, S, 256, 2.6),
  };
  cache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
//                                 TROTTOIR
// ---------------------------------------------------------------------------
export function sidewalkHD(seed = 4242) {
  const key = `sidewalk:${seed}`;
  if (cache.has(key)) return cache.get(key);

  const S = TEX.SIDEWALK;
  const c = makeCanvas(S), g = c.getContext('2d');
  const K = rngKit(seed);
  const f = noiseField(seed + 5);

  g.fillStyle = '#9b9da2'; g.fillRect(0, 0, S, S);
  const img = readPixels(g, S, S);
  if (img) {
    const data = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n1 = sampleNoise(f, (x / S) * 64, (y / S) * 64) - 0.5;
        const v = n1 * 16;
        const i = (y * S + x) * 4;
        data[i] = clamp255(155 + v); data[i + 1] = clamp255(157 + v); data[i + 2] = clamp255(162 + v);
        data[i + 3] = 255;
      }
    }
    writePixels(g, img);
  }

  // dalles 2×2 (2 m par dalle) avec chanfrein et joint
  const n = 2, cell = S / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = i * cell, y = j * cell;
      const t = K.int(-8, 8);
      g.fillStyle = `rgb(${150 + t},${152 + t},${157 + t})`;
      g.fillRect(x + 3, y + 3, cell - 6, cell - 6);
      // agrégat lavé
      for (let k = 0; k < 900; k++) {
        const v = K.int(-30, 22);
        g.fillStyle = `rgba(${150 + v},${152 + v},${158 + v},${K.range(0.15, 0.5)})`;
        g.fillRect(x + 4 + K.r() * (cell - 8), y + 4 + K.r() * (cell - 8), K.range(0.7, 2), K.range(0.7, 2));
      }
      // chanfrein : lumière en haut/gauche, ombre en bas/droite
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(x + 3, y + 3, cell - 6, 2.5);
      g.fillRect(x + 3, y + 3, 2.5, cell - 6);
      g.fillStyle = 'rgba(0,0,0,0.30)';
      g.fillRect(x + 3, y + cell - 5, cell - 6, 2.5);
      g.fillRect(x + cell - 5, y + 3, 2.5, cell - 6);
    }
  }
  // joints (sable + saleté)
  g.fillStyle = 'rgba(52,54,58,0.55)';
  for (let i = 0; i <= n; i++) {
    g.fillRect(i * cell - 1.5, 0, 3, S);
    g.fillRect(0, i * cell - 1.5, S, 3);
  }
  g.fillStyle = 'rgba(120,116,100,0.35)';
  for (let i = 0; i <= n; i++) {
    for (let k = 0; k < 60; k++) {
      g.fillRect(i * cell - 2 + K.r() * 4, K.r() * S, 1.6, K.range(1, 5));
      g.fillRect(K.r() * S, i * cell - 2 + K.r() * 4, K.range(1, 5), 1.6);
    }
  }

  // taches (huile, chewing-gum, humidité)
  for (let i = 0; i < 26; i++) {
    g.fillStyle = K.chance(0.3)
      ? `rgba(30,30,34,${K.range(0.15, 0.4)})`
      : `rgba(90,88,80,${K.range(0.08, 0.22)})`;
    g.beginPath();
    g.ellipse(K.r() * S, K.r() * S, K.range(4, 30), K.range(3, 22), K.r() * 3, 0, 6.283);
    g.fill();
  }
  // fissure occasionnelle
  if (K.chance(0.7)) {
    let x = K.r() * S, y = K.r() * S;
    g.strokeStyle = 'rgba(40,42,46,0.55)'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 12; s++) { x += K.range(-26, 26); y += K.range(-26, 26); g.lineTo(x, y); }
    g.stroke();
  }

  const out = {
    map: texture(c, { aniso: 16 }),
    bump: bumpFrom(g, S, 128, 2.4),
  };
  cache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
//                                   HERBE
// ---------------------------------------------------------------------------
export function grassHD(seed = 777) {
  const key = `grass:${seed}`;
  if (cache.has(key)) return cache.get(key);

  const S = TEX.GRASS;
  const c = makeCanvas(S), g = c.getContext('2d');
  const K = rngKit(seed);
  const f1 = noiseField(seed + 1), f2 = noiseField(seed + 2);

  g.fillStyle = '#4a6534'; g.fillRect(0, 0, S, S);
  const img = readPixels(g, S, S);
  if (img) {
    const data = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n1 = sampleNoise(f1, (x / S) * 20, (y / S) * 20) - 0.5;
        const n2 = sampleNoise(f2, (x / S) * 140, (y / S) * 140) - 0.5;
        const v = n1 * 34 + n2 * 18;
        const i = (y * S + x) * 4;
        data[i] = clamp255(72 + v * 1.15);
        data[i + 1] = clamp255(101 + v * 1.35);
        data[i + 2] = clamp255(52 + v * 0.8);
        data[i + 3] = 255;
      }
    }
    writePixels(g, img);
  }

  // plaques de terre / mousse
  for (let i = 0; i < 30; i++) {
    g.fillStyle = K.chance(0.35)
      ? `rgba(86,72,48,${K.range(0.12, 0.30)})`
      : `rgba(58,84,40,${K.range(0.12, 0.28)})`;
    g.beginPath();
    g.ellipse(K.r() * S, K.r() * S, K.range(14, 60), K.range(10, 44), K.r() * 3, 0, 6.283);
    g.fill();
  }

  // brins d'herbe (traits courts, teinte variée)
  for (let i = 0; i < 9000; i++) {
    const v = K.int(-30, 34);
    g.strokeStyle = `rgba(${74 + v},${108 + v},${52 + v * 0.7},${K.range(0.35, 0.9)})`;
    g.lineWidth = K.range(0.7, 1.5);
    const x = K.r() * S, y = K.r() * S, len = K.range(3, 9);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + K.range(-2.4, 2.4), y - len);
    g.stroke();
  }

  const out = {
    map: texture(c, { aniso: 8, repeat: 30 }),
    bump: bumpFrom(g, S, 128, 2.0),
  };
  cache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
//                        SOL DE LA MÉTROPOLE (tuile de 64 m)
// ---------------------------------------------------------------------------
/**
 * Une tuile = un bloc de 64 m (pitch) : chaussée de 18 m centrée sur les bords
 * de la tuile, trottoir + plateau de 46 m au centre. 2048² => 32 px/m.
 *
 * Le motif est conçu pour se raccorder exactement d'une tuile à l'autre :
 * la chaussée est coupée en deux moitiés égales de part et d'autre des bords.
 */
export function metroGroundHD(seed = 2026) {
  const key = `metro:${seed}`;
  if (cache.has(key)) return cache.get(key);

  const S = TEX.METRO;
  const P = 64;                    // pitch en mètres
  const roadW = 18;                // largeur de voirie
  const mToPx = S / P;             // 32 px/m
  const roadPx = roadW * mToPx;    // 576 px
  const half = roadPx / 2;         // 288 px

  const c = makeCanvas(S), g = c.getContext('2d');
  const K = rngKit(seed);
  const f1 = noiseField(seed + 1), f2 = noiseField(seed + 2), f3 = noiseField(seed + 3);

  // ---- base : chaussée bitume ---------------------------------------------
  g.fillStyle = '#4a4d52'; g.fillRect(0, 0, S, S);
  const img = readPixels(g, S, S);
  if (img) {
    const data = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n1 = sampleNoise(f1, (x / S) * 40, (y / S) * 40) - 0.5;
        const n2 = sampleNoise(f2, (x / S) * 180, (y / S) * 180) - 0.5;
        const n3 = sampleNoise(f3, (x / S) * 720, (y / S) * 720) - 0.5;
        const v = n1 * 24 + n2 * 15 + n3 * 17;
        const i = (y * S + x) * 4;
        data[i] = clamp255(75 + v);
        data[i + 1] = clamp255(78 + v);
        data[i + 2] = clamp255(83 + v);
        data[i + 3] = 255;
      }
    }
    writePixels(g, img);
  }
  // gravier
  for (let i = 0; i < 60000; i++) {
    const v = K.int(-24, 30);
    g.fillStyle = `rgba(${98 + v},${101 + v},${106 + v},${K.range(0.1, 0.42)})`;
    g.fillRect(K.r() * S, K.r() * S, K.range(0.8, 2), K.range(0.8, 2));
  }

  // ---- trottoir central (plateau) -----------------------------------------
  const walkX0 = half, walkX1 = S - half;
  g.fillStyle = '#8f8d88';
  g.fillRect(walkX0, walkX0, walkX1 - walkX0, walkX1 - walkX0);
  // grain du trottoir
  for (let i = 0; i < 26000; i++) {
    const v = K.int(-26, 20);
    const x = walkX0 + K.r() * (walkX1 - walkX0);
    const y = walkX0 + K.r() * (walkX1 - walkX0);
    g.fillStyle = `rgba(${146 + v},${144 + v},${138 + v},${K.range(0.1, 0.4)})`;
    g.fillRect(x, y, K.range(0.8, 2), K.range(0.8, 2));
  }

  // Dalles de trottoir de 2,4 m : teinte légèrement variable + chanfrein
  // discret. Les joints restent fins et peu contrastés, sinon vu de loin le
  // trottoir ressemble à du papier millimétré.
  const slab = 2.4 * mToPx;
  for (let x = walkX0; x < walkX1; x += slab) {
    for (let y = walkX0; y < walkX1; y += slab) {
      const t = K.int(-9, 9);
      const w2 = Math.min(slab, walkX1 - x), h2 = Math.min(slab, walkX1 - y);
      g.fillStyle = `rgba(${136 + t},${134 + t},${128 + t},0.75)`;
      g.fillRect(x + 1, y + 1, w2 - 2, h2 - 2);
      // chanfrein : lumière en haut-gauche, ombre en bas-droite
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(x + 1, y + 1, w2 - 2, 1.2);
      g.fillRect(x + 1, y + 1, 1.2, h2 - 2);
      g.fillStyle = 'rgba(0,0,0,0.13)';
      g.fillRect(x + 1, y + h2 - 2.2, w2 - 2, 1.2);
      g.fillRect(x + w2 - 2.2, y + 1, 1.2, h2 - 2);
    }
  }
  // joints (fine ligne de sable dans l'ombre)
  g.fillStyle = 'rgba(58,56,52,0.30)';
  for (let x = walkX0; x <= walkX1 + 1; x += slab) g.fillRect(x - 0.8, walkX0, 1.6, walkX1 - walkX0);
  for (let y = walkX0; y <= walkX1 + 1; y += slab) g.fillRect(walkX0, y - 0.8, walkX1 - walkX0, 1.6);

  // ---- bordures (curb) -----------------------------------------------------
  const curbW = 0.45 * mToPx;      // 14 px
  const drawCurb = (x, y, w, h, horizontal) => {
    const cg = horizontal
      ? g.createLinearGradient(0, y, 0, y + h)
      : g.createLinearGradient(x, 0, x + w, 0);
    cg.addColorStop(0, '#c8c8c4');
    cg.addColorStop(0.55, '#a8a8a4');
    cg.addColorStop(1, '#71736f');
    g.fillStyle = cg; g.fillRect(x, y, w, h);
    // joints des pierres de bordure
    g.strokeStyle = 'rgba(50,52,54,0.35)'; g.lineWidth = 1.2;
    if (horizontal) {
      for (let k = x; k < x + w; k += 1.2 * mToPx) {
        g.beginPath(); g.moveTo(k, y); g.lineTo(k, y + h); g.stroke();
      }
    } else {
      for (let k = y; k < y + h; k += 1.2 * mToPx) {
        g.beginPath(); g.moveTo(x, k); g.lineTo(x + w, k); g.stroke();
      }
    }
  };
  drawCurb(walkX0, walkX0, walkX1 - walkX0, curbW, true);
  drawCurb(walkX0, walkX1 - curbW, walkX1 - walkX0, curbW, true);
  drawCurb(walkX0, walkX0, curbW, walkX1 - walkX0, false);
  drawCurb(walkX1 - curbW, walkX0, curbW, walkX1 - walkX0, false);
  // ombre de la bordure sur la chaussée
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(walkX0, walkX0 - 3, walkX1 - walkX0, 3);
  g.fillRect(walkX0, walkX1, walkX1 - walkX0, 3);
  g.fillRect(walkX0 - 3, walkX0, 3, walkX1 - walkX0);
  g.fillRect(walkX1, walkX0, 3, walkX1 - walkX0);

  // ---- marquages routiers --------------------------------------------------
  // GÉOMÉTRIE DE LA TUILE (à retenir une fois pour toutes) :
  //   • chaussée de 18 m = deux demi-chaussées de 9 m, une sur chaque bord
  //     de tuile  ->  dans CETTE tuile, la route occupe [0, half] ;
  //   • le plateau (trottoir) occupe le carré central [half, S-half] = 46 m.
  // Tous les marquages doivent donc rester dans [0, half] ou [S-half, S].
  const ROAD = half;                          // 9 m = 288 px (demi-chaussée)
  const yellow = 'rgba(236,198,80,0.92)';
  const white = 'rgba(238,240,242,0.94)';
  const markT = 0.14 * mToPx;                 // 14 cm de peinture
  const kerbGap = 0.9 * mToPx;                // retrait depuis la bordure
  const crossW = 3.0 * mToPx;                 // largeur d'un passage piéton
  const period = 1.0 * mToPx;                 // motif de bandes : 1 m
  const bandW = 0.5 * mToPx, bandGap = 0.5 * mToPx;
  const roadUse = ROAD - 2 * kerbGap;         // largeur utile côté tuile
  const nBands = Math.floor(roadUse / period);

  // 1) axes médians discontinus, entre les carrefours seulement
  const dash = 3 * mToPx, gap = 6 * mToPx;
  const runA = ROAD + kerbGap + crossW;       // début : après le passage
  const runB = S - ROAD - kerbGap - crossW;   // fin : avant le suivant
  g.fillStyle = yellow;
  for (let t = runA; t < runB; t += dash + gap) {
    g.fillRect(t, 0, dash, markT * 2);              // route nord (axe y = 0)
    g.fillRect(t, S - markT * 2, dash, markT * 2);  // route sud
    g.fillRect(0, t, markT * 2, dash);              // route ouest
    g.fillRect(S - markT * 2, t, markT * 2, dash);  // route est
  }

  // 2) lignes de rive, interrompues aux carrefours
  g.fillStyle = white;
  const dashLen = 1.0 * mToPx;
  for (let x = runA; x < runB; x += dashLen) {
    g.fillRect(x, ROAD - kerbGap, dashLen, markT);          // route nord
    g.fillRect(x, S - ROAD + kerbGap - markT, dashLen, markT); // route sud
  }
  for (let y = runA; y < runB; y += dashLen) {
    g.fillRect(ROAD - kerbGap, y, markT, dashLen);          // route ouest
    g.fillRect(S - ROAD + kerbGap - markT, y, markT, dashLen); // route est
  }

  // 3) passages piétons : bandes PARALLÈLES au sens de circulation.
  //    Chaque demi-chaussée reçoit les mêmes bandes (symétrie de raccord).
  g.fillStyle = white;
  for (let k = 0; k < nBands; k++) {
    const y = kerbGap + k * period;
    // traversée de la route nord (bandes longues en X, répétées en Y)
    g.fillRect(ROAD + kerbGap, y, crossW, bandW);
    // traversée de la route sud (autre moitié de tuile)
    g.fillRect(S - ROAD - kerbGap - crossW, S - kerbGap - bandW - k * period, crossW, bandW);
  }
  for (let k = 0; k < nBands; k++) {
    const x = kerbGap + k * period;
    g.fillRect(x, ROAD + kerbGap, bandW, crossW);              // route ouest
    g.fillRect(S - kerbGap - bandW - k * period, S - ROAD - kerbGap - crossW, bandW, crossW); // route est
  }

  // 4) lignes d'arrêt (perpendiculaires à la circulation, avant le passage)
  const stopT = 0.35 * mToPx;
  g.fillStyle = white;
  g.fillRect(ROAD + kerbGap - stopT - 0.35 * mToPx, kerbGap, stopT, ROAD - 2 * kerbGap);       // nord
  g.fillRect(S - ROAD - kerbGap + 0.35 * mToPx, S - ROAD + kerbGap, stopT, ROAD - 2 * kerbGap); // sud
  g.fillRect(kerbGap, ROAD + kerbGap - stopT - 0.35 * mToPx, ROAD - 2 * kerbGap, stopT);       // ouest
  g.fillRect(S - ROAD + kerbGap, S - ROAD - kerbGap + 0.35 * mToPx, ROAD - 2 * kerbGap, stopT); // est

  // 5) usure : la peinture n'est jamais nette
  for (let i = 0; i < 3600; i++) {
    const x = K.r() * S, y = K.r() * S;
    g.fillStyle = `rgba(74,77,82,${K.range(0.2, 0.6)})`;
    g.fillRect(x, y, K.range(1, 3.5), K.range(1, 3.5));
  }

  // ---- avaloirs le long des bordures --------------------------------------
  for (let i = 0; i < 8; i++) {
    const along = K.range(2, 60) * mToPx;
    const grate = (x, y, w, h) => {
      g.fillStyle = '#2f3338'; g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(150,156,164,0.5)'; g.lineWidth = 1.5;
      g.strokeRect(x, y, w, h);
      g.fillStyle = 'rgba(120,126,134,0.35)';
      const n = 6;
      for (let k = 1; k < n; k++) {
        if (w > h) g.fillRect(x + (w / n) * k, y + 1, 1.4, h - 2);
        else g.fillRect(x + 1, y + (h / n) * k, w - 2, 1.4);
      }
    };
    const side = i % 4;
    const gw = 1.1 * mToPx, gh = 0.5 * mToPx;
    if (side === 0) grate(along, half - gh - 3, gw, gh);
    else if (side === 1) grate(along, S - half + 3, gw, gh);
    else if (side === 2) grate(half - gh - 3, along, gh, gw);
    else grate(S - half + 3, along, gh, gw);
  }

  // ---- tampons d'égout -----------------------------------------------------
  for (let i = 0; i < 4; i++) {
    const x = K.range(2, 12) * mToPx + (i % 2 ? S - half : 0);
    const y = K.range(2, 60) * mToPx;
    const r = 0.4 * mToPx;
    g.fillStyle = '#2b2f34'; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
    g.strokeStyle = 'rgba(160,166,174,0.5)'; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, r, 0, 6.283); g.stroke();
    g.strokeStyle = 'rgba(140,148,156,0.35)'; g.lineWidth = 1.4;
    for (let k = -2; k <= 2; k++) {
      g.beginPath(); g.moveTo(x - r * 0.7, y + k * r * 0.32); g.lineTo(x + r * 0.7, y + k * r * 0.32); g.stroke();
    }
  }

  // ---- fissures / rustines sur la chaussée --------------------------------
  for (let i = 0; i < 34; i++) {
    let x = K.r() * S, y = K.r() * S;
    // ne pas fissurer le trottoir central
    if (x > walkX0 && x < walkX1 && y > walkX0 && y < walkX1) continue;
    if (x > walkX0 - 40 && x < walkX1 + 40 && y > walkX0 - 40 && y < walkX1 + 40) continue;
    g.strokeStyle = `rgba(16,18,21,${K.range(0.4, 0.8)})`;
    g.lineWidth = K.range(0.8, 2);
    g.beginPath(); g.moveTo(x, y);
    let a = K.r() * 6.283;
    for (let s = 0; s < K.int(4, 14); s++) {
      a += K.range(-0.7, 0.7);
      x += Math.cos(a) * K.range(10, 34); y += Math.sin(a) * K.range(10, 34);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  for (let i = 0; i < 14; i++) {
    const w = K.range(45, 130), h = K.range(38, 100);
    const x = K.r() * (S - w), y = K.r() * (S - h);
    const overlap = x < walkX1 && x + w > walkX0 && y < walkX1 && y + h > walkX0;
    if (overlap) continue;
    g.fillStyle = `rgba(${K.int(58, 70)},${K.int(60, 72)},${K.int(64, 76)},0.55)`;
    roundRect(g, x, y, w, h, 18); g.fill();
    g.strokeStyle = 'rgba(24,26,29,0.55)'; g.lineWidth = 2.2; g.stroke();
  }

  // ---- salissures douces sur le trottoir -----------------------------------
  for (let i = 0; i < 40; i++) {
    const x = walkX0 + K.r() * (walkX1 - walkX0);
    const y = walkX0 + K.r() * (walkX1 - walkX0);
    g.fillStyle = K.chance(0.35)
      ? `rgba(40,40,44,${K.range(0.04, 0.14)})`
      : `rgba(120,112,96,${K.range(0.03, 0.12)})`;
    g.beginPath();
    g.ellipse(x, y, K.range(10, 70), K.range(8, 50), K.r() * 3, 0, 6.283);
    g.fill();
  }

  const out = {
    map: texture(c, { aniso: 16 }),
    bump: bumpFrom(g, S, 256, 2.2),
  };
  cache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
//                       Amélioration des textures importées
// ---------------------------------------------------------------------------
/**
 * Les colormaps GLB (Kenney) sont en 512². On ne peut pas inventer du détail,
 * mais on peut : activer l'anisotropie maximale (routes obliques nettes),
 * conserver les mipmaps et forcer le filtrage linéaire.
 */
export function upgradeImportedTextures(root, maxAniso = 16) {
  if (!root || !root.traverse) return 0;
  let count = 0;
  const seen = new Set();
  root.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const slot of ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
        const t = m[slot];
        if (!t || seen.has(t)) continue;
        seen.add(t);
        t.anisotropy = Math.min(maxAniso, 16);
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.generateMipmaps = true;
        t.needsUpdate = true;
        count++;
      }
      // les matériaux importés sont souvent trop brillants : on garde la
      // couleur mais on borne la rugosité pour éviter l'aspect plastique.
      if (typeof m.roughness === 'number' && m.roughness < 0.45) m.roughness = 0.55;
      if (m.envMapIntensity !== undefined) m.envMapIntensity = 0.6;
    }
  });
  return count;
}
