// ============================================================================
// METROPOLIS — tools/render_ground.mjs
// Rendu en PERSPECTIVE de la tuile de sol métro, à hauteur d'œil, pour juger
// ce que le joueur voit réellement : échelle (px/m), raccords entre tuiles,
// lisibilité des marquages, répétition du motif.
//
//   node tools/render_ground.mjs            -> previews/ground_eye.png
//   node tools/render_ground.mjs aerial     -> previews/ground_aerial.png
// ============================================================================
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeCanvas } from './canvas2d.mjs';
import { encodePNG } from './render_textures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// DOM minimal pour textures.js
globalThis.self = globalThis;
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? makeCanvas(256, 256) : { style: {} }),
  createElementNS: () => makeCanvas(256, 256),
  addEventListener() {}, body: { appendChild() {}, style: {} },
};
globalThis.window = globalThis;
globalThis.Image = class { constructor() { this.onload = null; this.onerror = null; } set src(v) { setTimeout(() => this.onerror && this.onerror(new Error('x')), 0); } };

const tex = await import(pathToFileURL(path.join(ROOT, 'web/src/textures.js')).href);
const tile = tex.metroGroundHD().map.image;
const W = tile.width, H = tile.height;
const src = tile.getContext('2d').pixels || tile.data;

// texture de détail : tuile de 4 m, combinée en MULTIPLICATEUR
const DETAIL_M = 4;
const detailImg = tex.groundDetailHD('asphalt').image;
const DW = detailImg.width, DH = detailImg.height;
const detailSrc = detailImg.getContext('2d').pixels || detailImg.data;
const DETAIL_GAIN = 0.55;

const mode = process.argv[2] || 'eye';
const OW = mode === 'aerial' ? 900 : 1280;
const OH = mode === 'aerial' ? 900 : 720;
const out = new Uint8ClampedArray(OW * OH * 4);

// --- caméra : hauteur d'œil 1,7 m, regard vers l'horizon (léger piqué) -----
const TILE_M = 64;                       // une tuile = 64 m
const eyeH = mode === 'aerial' ? 120 : 1.7;
const pitch = mode === 'aerial' ? -0.95 : -0.055;   // radians (négatif = vers le sol)
const fov = mode === 'aerial' ? 50 : 62;
const camZ = 8;                          // position dans la tuile (m)
const camX = 20;

const tanHalf = Math.tan((fov * Math.PI) / 360);
const aspect = OW / OH;

// ------------------- pyramide de mips (simule le filtrage GPU) -------------
function buildMips(srcPx, w, h, levels = 6) {
  const mips = [{ data: srcPx, w, h }];
  for (let l = 1; l < levels; l++) {
    const pw = mips[l - 1].w, ph = mips[l - 1].h, prev = mips[l - 1].data;
    const nw = Math.max(1, pw >> 1), nh = Math.max(1, ph >> 1);
    const d = new Uint8ClampedArray(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let r = 0, g = 0, b = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const i = ((Math.min(ph - 1, y * 2 + dy)) * pw + Math.min(pw - 1, x * 2 + dx)) * 4;
          r += prev[i]; g += prev[i + 1]; b += prev[i + 2];
        }
        const o = (y * nw + x) * 4;
        d[o] = r / 4; d[o + 1] = g / 4; d[o + 2] = b / 4; d[o + 3] = 255;
      }
    }
    mips.push({ data: d, w: nw, h: nh });
  }
  return mips;
}
const mipTile = buildMips(src, W, H);
const mipDetail = buildMips(detailSrc, DW, DH);

/** Échantillonne une pyramide pour un texel couvrant `footprint` texels. */
function sampleMip(mips, u, v, footprint) {
  const lvl = Math.max(0, Math.min(mips.length - 1, Math.floor(Math.log2(Math.max(1, footprint)))));
  const m = mips[lvl];
  const px = Math.floor(((u % 1) + 1) % 1 * m.w);
  const py = Math.floor(((v % 1) + 1) % 1 * m.h);
  const i = (Math.min(m.h - 1, py) * m.w + Math.min(m.w - 1, px)) * 4;
  return [m.data[i], m.data[i + 1], m.data[i + 2]];
}

// mètres par texel de chaque texture
const TILE_TEXEL_M = TILE_M / W;      // tuile de 64 m
const DET_TEXEL_M = 4 / DW;           // détail de 4 m

function shadeAt(worldX, worldZ, pixM) {
  const u = worldX / TILE_M, v = worldZ / TILE_M;
  const base = sampleMip(mipTile, u, v, pixM / TILE_TEXEL_M);
  const du = worldX / 4, dv = worldZ / 4;
  const det = sampleMip(mipDetail, du, dv, pixM / DET_TEXEL_M);
  const m = 1 + (det[0] / 255 - 1) * DETAIL_GAIN;
  return [base[0] * m, base[1] * m, base[2] * m];
}

// éclairage simple : soleil haut, légère atténuation avec la distance (brume)
const SUN = 1.02;
for (let y = 0; y < OH; y++) {
  // angle vertical du rayon pour cette ligne
  const ndcY = 1 - (2 * (y + 0.5)) / OH;
  const dirY = ndcY * tanHalf;
  const dirZ = -1;                    // regard vers -Z
  // rotation du pitch
  const cy = Math.cos(pitch), sy = Math.sin(pitch);
  const ry = dirY * cy - dirZ * sy;
  const rz = dirY * sy + dirZ * cy;
  for (let x = 0; x < OW; x++) {
    const ndcX = (2 * (x + 0.5)) / OW - 1;
    const dirX = ndcX * tanHalf * aspect;
    // intersection avec le plan y = 0 depuis la caméra (camX, eyeH, camZ)
    let t;
    if (ry < -1e-5) t = -eyeH / ry;
    else t = -1;
    let col;
    if (t <= 0 || t > 900) {
      // ciel
      const k = Math.max(0, Math.min(1, (y / OH)));
      col = [110 + 60 * (1 - k), 150 + 50 * (1 - k), 200 + 35 * (1 - k)];
    } else {
      const wx = camX + dirX * t;
      const wz = camZ + rz * t;
      // taille d'un pixel au sol à cette distance (approximation)
      const pixM = Math.max(0.001, (t * 2 * tanHalf * aspect) / OW);
      col = shadeAt(wx, wz, pixM);
      // atténuation atmosphérique
      const fog = Math.min(0.62, Math.pow(t / 900, 0.85));
      col = [
        col[0] * (1 - fog) + 175 * fog,
        col[1] * (1 - fog) + 190 * fog,
        col[2] * (1 - fog) + 210 * fog,
      ];
      // assombrissement directionnel très léger
      col = col.map((c) => c * SUN);
    }
    const o = (y * OW + x) * 4;
    out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]; out[o + 3] = 255;
  }
}

// --- quadrillage métrique de contrôle (tous les 10 m) + axes -----------------
const f = path.join(ROOT, 'previews', mode === 'aerial' ? 'ground_aerial.png' : 'ground_eye.png');
await fs.mkdir(path.join(ROOT, 'previews'), { recursive: true });
await fs.writeFile(f, encodePNG(OW, OH, out));
console.log('previews/' + path.basename(f));
