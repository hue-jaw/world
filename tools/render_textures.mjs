// ============================================================================
// METROPOLIS — tools/render_textures.mjs
// Génère les textures procédurales de web/src/textures.js HORS navigateur
// (backend Canvas2D logiciel) et produit une planche de contrôle :
//
//   node tools/render_textures.mjs        -> previews/textures.png
//                                            previews/texture_*.png (1024²)
// ============================================================================
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeCanvas } from './canvas2d.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------- PNG ---------------------------------------
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
export function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------- installation du DOM -----------------------------
globalThis.self = globalThis;
function installDOM() {
  const created = [];
  globalThis.document = {
    createElement(tag) {
      if (tag === 'canvas') return makeCanvas(256, 256);
      return { style: {}, appendChild() {}, addEventListener() {} };
    },
    createElementNS() { return makeCanvas(256, 256); },
    addEventListener() {}, removeEventListener() {},
    body: { appendChild() {}, style: {} },
    getElementById() { return null; },
    querySelector() { return null; },
  };
  globalThis.window = globalThis;
  globalThis.Image = class { constructor() { this.onload = null; this.onerror = null; } set src(v) { setTimeout(() => this.onerror && this.onerror(new Error('x')), 0); } };
  return created;
}

/** Réduction par 2 (box filter) — antialiasing des bords. */
function downscale(src, w, h) {
  const out = new Uint8ClampedArray((w / 2) * (h / 2) * 4);
  for (let y = 0; y < h / 2; y++) {
    for (let x = 0; x < w / 2; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const i = ((y * 2 + dy) * w + (x * 2 + dx)) * 4;
        r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3];
      }
      const o = (y * (w / 2) + x) * 4;
      out[o] = r / 4; out[o + 1] = g / 4; out[o + 2] = b / 4; out[o + 3] = a / 4;
    }
  }
  return out;
}

async function main() {
  installDOM();
  const tex = await import(pathToFileURL(path.join(ROOT, 'web/src/textures.js')).href);

  const unwrap = (v) => (v && v.map ? v.map : v && v.day ? v.day : v);
  const jobs = [
    { name: 'facade_brick',   fn: () => tex.facade('brick', 'mid', 0).day },
    { name: 'facade_oldbrick',fn: () => tex.facade('oldbrick', 'low', 1).day },
    { name: 'facade_glass',   fn: () => tex.facade('glass', 'high', 0).day },
    { name: 'facade_office',  fn: () => tex.facade('office', 'mid', 2).day },
    { name: 'facade_house',   fn: () => tex.facade('house', 'low', 0).day },
    { name: 'facade_plaster', fn: () => tex.facade('plaster', 'mid', 1).day },
    { name: 'face_night',     fn: () => tex.facade('brick', 'mid', 0).night },
    // v0.6 : tuile d'étages répétable (utilisée par les immeubles >= 10 m)
    { name: 'facade_tile_glass',  fn: () => tex.facadeTiling('glass', 'high', 0).day },
    { name: 'facade_tile_office', fn: () => tex.facadeTiling('office', 'mid', 1).day },
    { name: 'facade_tile_brick',  fn: () => tex.facadeTiling('brick', 'mid', 0).day },
    { name: 'shopfront',          fn: () => tex.shopfront(0).day },
    { name: 'asphalt',        fn: () => unwrap(tex.asphaltHD()) },
    { name: 'sidewalk',       fn: () => unwrap(tex.sidewalkHD()) },
    { name: 'grass',          fn: () => unwrap(tex.grassHD()) },
    { name: 'metro',          fn: () => unwrap(tex.metroGroundHD()) },
    { name: 'bump_asphalt',   fn: () => tex.asphaltHD().bump },
  ];

  const t0 = Date.now();
  const results = [];
  for (const job of jobs) {
    const t = Date.now();
    const texture = job.fn();
    const c = texture.image;
    const ms = Date.now() - t;
    const src = c.getContext('2d').pixels || c.data;
    results.push({ ...job, w: c.width, h: c.height, src, ms });
    console.error(`  ${job.name.padEnd(16)} ${c.width}²  ${ms} ms`);
  }
  console.error(`total génération : ${Date.now() - t0} ms`);

  // sauvegarde des textures individuellement (utile pour inspection)
  for (const r of results) {
    const png = encodePNG(r.w, r.h, r.src);
    await fs.mkdir(path.join(ROOT, 'previews'), { recursive: true });
    await fs.writeFile(path.join(ROOT, `previews/texture_${r.name}.png`), png);
  }

  // -------------------------- planche de contrôle -------------------------
  const COLS = 4, CELL = 320, PAD = 8, LABEL = 18;
  const rows = Math.ceil(results.length / COLS);
  const W = COLS * (CELL + PAD) + PAD;
  const H = rows * (CELL + PAD + LABEL) + PAD;
  const board = makeCanvas(W, H);
  const bctx = board.getContext('2d');
  bctx.fillStyle = '#14171c'; bctx.fillRect(0, 0, W, H);

  results.forEach((r, i) => {
    const cx = PAD + (i % COLS) * (CELL + PAD);
    const cy = PAD + Math.floor(i / COLS) * (CELL + PAD + LABEL) + LABEL;
    // la façade est un 1024² : on la réduit en 512 puis on la met à 320
    const small = downscale(r.src, r.w, r.h);
    const sw = r.w / 2, sh = r.h / 2;
    // redimensionnement bilinéaire simple vers CELL
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const sxp = (x / CELL) * sw, syp = (y / CELL) * sh;
        const x0 = Math.floor(sxp), y0 = Math.floor(syp);
        const fx = sxp - x0, fy = syp - y0;
        const idx = (yy, xx) => (Math.min(sh - 1, yy) * sw + Math.min(sw - 1, xx)) * 4;
        const p00 = idx(y0, x0), p10 = idx(y0, x0 + 1), p01 = idx(y0 + 1, x0), p11 = idx(y0 + 1, x0 + 1);
        const o = ((cy + y) * W + (cx + x)) * 4;
        for (let k = 0; k < 3; k++) {
          const top = small[p00 + k] * (1 - fx) + small[p10 + k] * fx;
          const bot = small[p01 + k] * (1 - fx) + small[p11 + k] * fx;
          board.data[o + k] = top * (1 - fy) + bot * fy;
        }
        board.data[o + 3] = 255;
      }
    }
  });

  await fs.writeFile(path.join(ROOT, 'previews/textures.png'), encodePNG(W, H, board.data));
  console.log('previews/textures.png');
  console.log('previews/texture_*.png');
}

await main();
