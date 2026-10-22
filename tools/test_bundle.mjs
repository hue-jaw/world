// ============================================================================
// METROPOLIS — tools/test_bundle.mjs
// Vérifie le fichier LIVRÉ (METROPOLIS.html, celui embarqué dans l'EXE) :
// on extrait le script inline, on l'exécute avec un DOM factice et un faux
// contexte WebGL 2, et on laisse tourner la vraie boucle de jeu quelques
// images. C'est le seul test qui reproduit les conditions « double-clic ».
//
// Il attrape exactement la classe de bugs invisible aux tests unitaires :
// erreur au chargement, au premier rendu, ou pendant les premières frames.
//
// Usage : node tools/test_bundle.mjs   (après node tools/build_single_file.mjs)
// ============================================================================
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDOM } from './dom_stub.mjs';
import { makeGL } from './mock_webgl.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'METROPOLIS.html');

let html;
try { html = await fs.readFile(FILE, 'utf8'); }
catch { console.error('❌ METROPOLIS.html absent — lancez node tools/build_single_file.mjs'); process.exit(1); }

// dernier <script> sans attribut src : c'est le bundle
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (!scripts.length) { console.error('❌ aucun script inline dans METROPOLIS.html'); process.exit(1); }
const code = scripts[scripts.length - 1];
console.log(`— bundle : ${(code.length / 1048576).toFixed(2)} Mo de JavaScript —`);

// ------------------------------ environnement ------------------------------
const { byId } = installDOM();
const origCreate = globalThis.document.createElement;
globalThis.document.createElement = (tag) => {
  const el = origCreate(tag);
  if (tag === 'canvas') {
    const gl = makeGL(1280, 720);
    el.getContext = (t) => {
      if (String(t).startsWith('webgl')) return gl;
      if (!el.__ctx2d) {
        const grad = { addColorStop() {} };
        const imgData = (w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
        el.__ctx2d = new Proxy({}, {
          get(_, p) {
            if (p === 'createLinearGradient' || p === 'createRadialGradient' || p === 'createPattern') return () => grad;
            if (p === 'createImageData') return (w, h) => imgData(w, h);
            if (p === 'getImageData') return (x, y, w, h) => imgData(w, h);
            if (p === 'measureText') return () => ({ width: 10 });
            if (p === 'canvas') return el;
            return () => undefined;
          },
          set: () => true,
        });
      }
      return el.__ctx2d;
    };
    el.getBoundingClientRect = () => ({ width: 1280, height: 720, left: 0, top: 0 });
  }
  return el;
};

// requestAnimationFrame piloté : on exécute N images puis on s'arrête.
let rafQueue = [];
let frame = 0;
const MAX_FRAMES = 6;
const errors = [];
globalThis.requestAnimationFrame = (fn) => {
  rafQueue.push(fn);
  return rafQueue.length;
};
globalThis.cancelAnimationFrame = () => {};
globalThis.devicePixelRatio = 1;
const errEl = byId.get('loading') || globalThis.document.getElementById('loading');

const runFrame = () => {
  const queue = rafQueue; rafQueue = [];
  for (const fn of queue) {
    try { fn(performance.now()); }
    catch (e) { errors.push(e); }
  }
  frame += queue.length;
  return queue.length;
};
// Le boot enchaîne des await (chargement des GLB, décode de textures) : on
// laisse tourner de vraies tranches d'événements, pas seulement des microtâches.
const flush = async (ms = 12) => { await new Promise((r) => setTimeout(r, ms)); };

let bootError = null;
try {
  // eslint-disable-next-line no-new-func
  new Function(code)();
} catch (e) {
  bootError = e;
}

await flush(40);
const deadline = Date.now() + 10000;
while (Date.now() < deadline && frame < MAX_FRAMES) {
  runFrame();
  await flush();
  const l = globalThis.document.getElementById('loading');
  if (l.style.display === 'none') break;
}
console.log(`  · ${frame} image(s) de jeu simulée(s)`);

// ------------------------------- verdict -----------------------------------
const loading = globalThis.document.getElementById('loading');
const loadingHidden = loading.style.display === 'none';
// --- Stabilisation (v0.9) ---------------------------------------------------
// Le boot masque l'écran de chargement dès la PREMIÈRE image. Un bug qui
// n'apparaît qu'au 3ᵉ rendu (cible de post-traitement redimensionnée, premier
// changement d'heure, première frame avec ombres) passait donc inaperçu.
// On force 24 images supplémentaires : c'est le chemin « le joueur regarde
// l'intro pendant deux secondes ».
if (loadingHidden) {
  const before = errors.length;
  for (let i = 0; i < 24; i++) {
    runFrame();
    if (i % 6 === 0) await flush(4);
  }
  if (errors.length > before) {
    console.log(`  · ${errors.length - before} erreur(s) apparue(s) après la 1re image`);
  }
}
const shown = String(loading.textContent || '');
let failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { console.log('  ✓ ' + label + (extra ? ` — ${extra}` : '')); }
  else { failed++; console.log('  ✗ ' + label + (extra ? ` — ${extra}` : '')); }
};

console.log('— Chargement du fichier livré —');
ok('le bundle s’exécute sans exception', !bootError, bootError ? bootError.message : '');
ok('aucune erreur pendant les premières images', errors.length === 0,
  errors.length ? errors[0].message : `${frame} images simulées`);
ok('aucune erreur après stabilisation (post-traitement, ciel, ombres)', errors.length === 0,
  errors.length ? errors[0].message : '24 images de plus');
ok('l’écran de chargement a disparu', loadingHidden, loadingHidden ? '' : `texte : ${shown.slice(0, 80)}`);
ok('aucun message d’erreur affiché au joueur', !/Erreur de chargement|Impossible de démarrer/.test(shown), shown.slice(0, 80));

if (bootError) console.log('\n' + (bootError.stack || '').split('\n').slice(0, 6).join('\n'));
if (errors.length) console.log('\n' + (errors[0].stack || '').split('\n').slice(0, 6).join('\n'));

console.log('');
if (failed) { console.log(`❌ BUNDLE : ${failed} échec(s).`); process.exit(1); }
console.log('✅ BUNDLE : le fichier livré démarre et rend ses premières images, 0 échec.');
