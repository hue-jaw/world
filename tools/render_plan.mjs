// ============================================================================
// METROPOLIS — tools/render_plan.mjs
// Plan de ville vu du dessus, rendu en logiciel (aucun GPU requis) :
//   node tools/render_plan.mjs   -> previews/city_plan_v0.5.png
//
// Panneau gauche  : métropole entière (8,2 km), classes de voies, sens uniques,
//                   anneau autoroutier, canal.
// Panneau droit   : zoom 2 km sur le cœur et le canal — quartiers (districtMap),
//                   empreintes réelles des bâtiments générés, giratoires, ponts.
//
// Ce n'est PAS un rendu 3D : c'est une vue de dessus des DONNÉES du jeu
// (mêmes objets que ceux consommés par le moteur). Elle prouve la structure de
// la ville, pas son aspect final.
// ============================================================================
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDOM } from './dom_stub.mjs';
import { Canvas2D } from './canvas2d.mjs';
import { encodePNG } from './png.mjs';

installDOM();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await import('../web/node_modules/three/build/three.module.js');
const THREE = await import('../web/node_modules/three/build/three.module.js');
const { City, WORLD_HALF, RING } = await import('../web/src/city.js');
const { describeStreet } = await import('../web/src/streets.js');

const W = 2400, H = 1200, PANEL = 1200;
const canvas = new Canvas2D(W, H);
const ctx = canvas.getContext();

const scene = new THREE.Scene();
const t0 = performance.now();
const city = new City(scene);
console.log(`ville générée en ${(performance.now() - t0).toFixed(0)} ms`);

const P = 64, MN = 128, CORE_I = 60;
const nodeX = (k) => -WORLD_HALF + (k - CORE_I) * P;

// ------------------------------- légende -----------------------------------
// Police 5×7 minimale : évite toute dépendance à fillText.
const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['111', '010', '010', '010', '010', '010', '111'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  0: ['01110', '10011', '10101', '10101', '10101', '11001', '01110'],
  1: ['001', '011', '101', '001', '001', '001', '111'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ' ': ['000', '000', '000', '000', '000', '000', '000'],
  '.': ['00', '00', '00', '00', '00', '00', '11'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  ':': ['00', '11', '11', '00', '00', '11', '11'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
};
function text(str, x, y, scale = 2, color = '#c9d1d9') {
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of str.toUpperCase()) {
    const g = FONT[ch] || FONT[' '];
    for (let r = 0; r < g.length; r++) {
      for (let c = 0; c < g[r].length; c++) {
        if (g[r][c] === '1') ctx.fillRect(cx + c * scale, y + r * scale, scale, scale);
      }
    }
    cx += (g[0].length + 1) * scale;
  }
}

// --------------------------- utilitaires de tracé ---------------------------
const makeView = (ox, oy, size, worldSpan) => {
  const s = size / worldSpan;                    // px / m
  return {
    s, ox, oy,
    px: (x) => ox + size / 2 + x * s,
    py: (z) => oy + size / 2 + z * s,
    len: (m) => Math.max(0.6, m * s),
  };
};
const line = (v, x1, z1, x2, z2, color, widthM) => {
  ctx.strokeStyle = color;
  ctx.lineWidth = v.len(widthM);
  ctx.beginPath();
  ctx.moveTo(v.px(x1), v.py(z1));
  ctx.lineTo(v.px(x2), v.py(z2));
  ctx.stroke();
};
const rect = (v, x0, z0, x1, z1, color) => {
  ctx.fillStyle = color;
  const a = v.px(Math.min(x0, x1)), b = v.py(Math.min(z0, z1));
  ctx.fillRect(a, b, Math.max(1, v.len(Math.abs(x1 - x0))), Math.max(1, v.len(Math.abs(z1 - z0))));
};
const disc = (v, x, z, rM, color) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(v.px(x), v.py(z), Math.max(1.2, v.len(rM)), 0, Math.PI * 2);
  ctx.fill();
};

// ============================ PANNEAU GAUCHE ================================
// Métropole entière : -4128 … +4128 m.
const vA = makeView(0, 0, PANEL, 8400);
ctx.fillStyle = '#0d1014';
ctx.fillRect(0, 0, PANEL, PANEL);

// quartiers du cœur (visibles seulement en zoom, mais on garde la trame neutre)
for (let k = 0; k <= MN; k++) {
  const h = describeStreet(k, 0), v = describeStreet(k, 1);
  const c = nodeX(k);
  const ext = 4150;
  const color = h.klass === 'avenue' ? '#59616d' : h.klass === 'boulevard' ? '#464e59' : '#333a44';
  line(vA, -ext, c, ext, c, color, h.klass === 'avenue' ? 13 : h.klass === 'boulevard' ? 10 : 7);
  const color2 = v.klass === 'avenue' ? '#59616d' : v.klass === 'boulevard' ? '#464e59' : '#333a44';
  line(vA, c, -ext, c, ext, color2, v.klass === 'avenue' ? 13 : v.klass === 'boulevard' ? 10 : 7);
}
// sens uniques
for (let k = 0; k <= MN; k++) {
  const h = describeStreet(k, 0), v = describeStreet(k, 1);
  const c = nodeX(k), ext = 4150;
  if (h.oneWay) line(vA, -ext, c, ext, c, '#b9813f', 2.6);
  if (v.oneWay) line(vA, c, -ext, c, ext, '#b9813f', 2.6);
}
// canal
{
  const cx = city.canal.x, half = city.canal.w / 2;
  rect(vA, cx - half, -4128, cx + half, 4128, '#26567d');
  line(vA, cx - half - 3, -4128, cx - half - 3, 4128, '#6f7a86', 3);
  line(vA, cx + half + 3, -4128, cx + half + 3, 4128, '#6f7a86', 3);
}
// anneau autoroutier
ctx.strokeStyle = '#4d5560';
ctx.lineWidth = vA.len(30);
ctx.strokeRect(vA.px(-RING), vA.py(-RING), vA.len(2 * RING), vA.len(2 * RING));
// contour
ctx.strokeStyle = '#1e242c';
ctx.lineWidth = 2;
ctx.strokeRect(0.5, 0.5, PANEL - 1, PANEL - 1);

// ============================ PANNEAU DROIT =================================
// Zoom 2 km centré sur x = −560 : canal (−1 120), cœur historique (0) et
// quartiers du districtMap (448 m) tiennent dans le cadre.
const ZB = { cx: -560, cz: 0, span: 2000 };
const BS = PANEL / ZB.span;                       // px / m
const vB = {
  s: BS, ox: PANEL, oy: 0,
  px: (x) => PANEL + PANEL / 2 + (x - ZB.cx) * BS,
  py: (z) => PANEL / 2 + (z - ZB.cz) * BS,
  len: (m) => Math.max(0.6, m * BS),
};
const BX0 = ZB.cx - ZB.span / 2, BX1 = ZB.cx + ZB.span / 2;
const BZ0 = ZB.cz - ZB.span / 2, BZ1 = ZB.cz + ZB.span / 2;

ctx.fillStyle = '#0b0e12';
ctx.fillRect(PANEL, 0, PANEL, PANEL);

// ---- 1. quartiers du cœur (districtMap) : 7×7 blocs de 64 m ----------------
const DISTRICT_COLORS = {
  downtown: '#2b3b4e', commercial: '#3b3350', oldtown: '#4a4032',
  residential: '#253a2f', industrial: '#40352d', suburb: '#2b2f35',
  microPark: '#20402e',
};
for (let i = 0; i < city.districtMap.length; i++) {
  for (let j = 0; j < city.districtMap[i].length; j++) {
    const x0 = -WORLD_HALF + i * P, z0 = -WORLD_HALF + j * P;
    rect(vB, x0, z0, x0 + P, z0 + P, DISTRICT_COLORS[city.districtMap[i][j]] || '#23272d');
  }
}

// ---- 2. réseau viaire (avant les bâtiments : ceux-ci passent au-dessus) ----
const styleOf = (st) => (st.klass === 'avenue' ? ['#737e8d', 20]
  : st.klass === 'boulevard' ? ['#5f6a79', 17]
  : st.klass === 'passage' ? ['#8b7a58', 8] : ['#4d5665', 13]);
for (let k = 0; k <= MN; k++) {
  const c = nodeX(k);
  if (c < BZ0 || c > BZ1) continue;
  const [hc, hw] = styleOf(describeStreet(k, 0));
  line(vB, BX0, c, BX1, c, hc, hw);
  const [vc, vw] = styleOf(describeStreet(k, 1));
  if (c < BX0 || c > BX1) continue;
  line(vB, c, BZ0, c, BZ1, vc, vw);
}

// ---- 2b. voile de district au-dessus de la chaussée (lisibilité) ---------
// Les 7×7 blocs du cœur sont colorés par district : c'est la preuve visuelle
// que la ville n'est plus composée d'anneaux concentriques.
ctx.globalAlpha = 0.5;
for (let i = 0; i < city.districtMap.length; i++) {
  for (let j = 0; j < city.districtMap[i].length; j++) {
    const x0 = -WORLD_HALF + i * P, z0 = -WORLD_HALF + j * P;
    rect(vB, x0, z0, x0 + P, z0 + P, DISTRICT_COLORS[city.districtMap[i][j]] || '#23272d');
  }
}
ctx.globalAlpha = 1;

// ---- 3. empreintes réelles des bâtiments générés (colliders hauts) --------
let drawn = 0;
for (const c of city.colliders) {
  if (c.h < 3) continue;
  const w = c.maxX - c.minX, d = c.maxZ - c.minZ;
  if (w < 6 || d < 6) continue;               // ignore bollards / lampadaires
  if (c.maxX < BX0 || c.minX > BX1 || c.maxZ < BZ0 || c.minZ > BZ1) continue;
  const h = c.h;
  ctx.fillStyle = h > 60 ? '#a9b6c6' : h > 25 ? '#8593a3' : '#68757f';
  ctx.fillRect(vB.px(c.minX), vB.py(c.minZ), Math.max(1, w * BS), Math.max(1, d * BS));
  drawn++;
}

// ---- 4. sens uniques par-dessus la chaussée -------------------------------
for (let k = 0; k <= MN; k++) {
  const c = nodeX(k);
  if (c < BZ0 || c > BZ1) continue;
  if (describeStreet(k, 0).oneWay) line(vB, BX0, c, BX1, c, '#d9a24f', 3);
  if (c >= BX0 && c <= BX1 && describeStreet(k, 1).oneWay) line(vB, c, BZ0, c, BZ1, '#d9a24f', 3);
}

// ---- 5. canal, quais et ponts ---------------------------------------------
{
  const cx = city.canal.x, halfW = city.canal.w / 2;
  rect(vB, cx - halfW, BZ0, cx + halfW, BZ1, '#2f6b99');
  rect(vB, cx - halfW - 5, BZ0, cx - halfW, BZ1, '#8a939e');
  rect(vB, cx + halfW, BZ0, cx + halfW + 5, BZ1, '#8a939e');
  // onde légère : deux lignes claires dans l'eau (repère visuel, pas du rendu)
  rect(vB, cx - halfW + 6, BZ0, cx - halfW + 8, BZ1, '#3b7db0');
  rect(vB, cx + halfW - 8, BZ0, cx + halfW - 6, BZ1, '#3b7db0');
  for (const b of city.bridges) {
    if (b.z < BZ0 || b.z > BZ1) continue;
    rect(vB, cx - halfW - 5, b.z - 7, cx + halfW + 5, b.z + 7, '#9aa4b0');
  }
}

// ---- 6. giratoires (îlot végétalisé de 4 m) -------------------------------
for (const r of city.roundabouts) {
  if (r.x < BX0 || r.x > BX1 || r.z < BZ0 || r.z > BZ1) continue;
  disc(vB, r.x, r.z, 8, '#818d9c');
  disc(vB, r.x, r.z, 4, '#235f3d');
}

// ---- 6b. repères de lecture ----------------------------------------------
text('CENTRE', vB.px(-30), vB.py(-290), 2, '#c9d1d9');
text('CANAL', vB.px(city.canal.x - 30), vB.py(300), 2, '#9ecbf0');
// flèche nord (haut de l'image = +z côté écran inversé : on indique le nord réel)
ctx.fillStyle = '#c9d1d9';
ctx.beginPath();
ctx.moveTo(PANEL + PANEL - 40, 96);
ctx.lineTo(PANEL + PANEL - 24, 124);
ctx.lineTo(PANEL + PANEL - 56, 124);
ctx.closePath();
ctx.fill();
text('N', PANEL + PANEL - 44, 130, 2, '#c9d1d9');

// ---- 7. en-têtes opaques (lisibilité) ------------------------------------
ctx.fillStyle = '#080a0d';
ctx.fillRect(0, 0, PANEL, 78);
ctx.fillRect(PANEL, 0, PANEL, 78);
ctx.fillStyle = '#1b2129';
ctx.fillRect(0, 78, W, 2);
text('METROPOLIS V0.5 - PLAN DES DONNEES', 24, 20, 3, '#e6edf3');
text('METROPOLE 8.2 KM - 258 VOIES NOMMEES - ANNEAU 2.0 KM', 24, 52, 2, '#8b96a3');
text('ZOOM 2 KM - QUARTIERS - BATIMENTS GENERES', PANEL + 24, 20, 2, '#e6edf3');
text('AUCUN RENDU 3D : VUE DE DESSUS DES DONNEES DU JEU', PANEL + 24, 44, 2, '#8b96a3');

ctx.strokeStyle = '#1e242c';
ctx.lineWidth = 2;
ctx.strokeRect(0.5, 0.5, PANEL - 1, PANEL - 1);
ctx.strokeRect(PANEL + 0.5, 0.5, PANEL - 1, PANEL - 1);

// ---- 8. légende (fond opaque, coin bas-droit du panneau B) ----------------
const LEGEND = [
  ['#737e8d', 'AVENUE 20 M'],
  ['#5f6a79', 'BOULEVARD 17 M'],
  ['#4d5665', 'RUE 13 M'],
  ['#8b7a58', 'PASSAGE PIETON'],
  ['#d9a24f', 'SENS UNIQUE'],
  ['#2f6b99', 'CANAL'],
  ['#9aa4b0', 'PONT'],
  ['#235f3d', 'GIRATOIRE'],
  ['#a9b6c6', 'TOUR > 60 M'],
];
const lbW = 340, lbH = LEGEND.length * 26 + 60;
const lbX = W - lbW - 20, lbY = H - lbH - 20;
ctx.fillStyle = 'rgba(8,10,13,0.92)';
ctx.fillRect(lbX, lbY, lbW, lbH);
ctx.strokeStyle = '#2a323c';
ctx.lineWidth = 2;
ctx.strokeRect(lbX + 0.5, lbY + 0.5, lbW - 1, lbH - 1);
text('LEGENDE', lbX + 16, lbY + 16, 2, '#e6edf3');
LEGEND.forEach(([col, label], n) => {
  const y = lbY + 46 + n * 26;
  ctx.fillStyle = col;
  ctx.fillRect(lbX + 16, y, 30, 12);
  text(label, lbX + 58, y + 2, 2, '#9aa4b0');
});

await fs.mkdir(path.join(ROOT, 'previews'), { recursive: true });
const out = path.join(ROOT, 'previews/city_plan_v0.5.png');
await fs.writeFile(out, encodePNG(W, H, canvas.pixels()));
console.log(`previews/city_plan_v0.5.png — ${drawn} bâtiments dessinés, ${city.bridges.length} ponts, ${city.roundabouts.length} giratoires`);
