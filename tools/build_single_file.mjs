// ============================================================================
// METROPOLIS — tools/build_single_file.mjs
// Empaquette toute la vertical slice (HTML + CSS + 11 modules + Three.js)
// dans UN SEUL fichier METROPOLIS.html, ouvrable par double-clic (file://).
//
//   node tools/build_single_file.mjs
//
// Pourquoi un fichier unique : un jeu en modules ES ne peut pas être ouvert
// par double-clic (le navigateur bloque les modules sur file://). En inlinant
// un bundle IIFE, le jeu démarre sans serveur, sans installation, sans réseau.
// Le même fichier est réutilisé par l'app desktop Electron (desktop/).
// ============================================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');
const OUT = path.join(ROOT, 'METROPOLIS.html');

// esbuild est installé dans web/ (devDependency du prototype) : on le charge
// explicitement par chemin pour que ce script fonctionne depuis la racine.
const esbuildUrl = pathToFileURL(path.join(WEB, 'node_modules/esbuild/lib/main.js')).href;
let esbuild;
try {
  esbuild = await import(esbuildUrl);
} catch {
  console.error('❌ esbuild introuvable. Lancez d’abord :  cd web && npm install');
  process.exit(1);
}
const build = esbuild.build ?? esbuild.default?.build;

// --- 0. Embarquement des modèles 3D (base64) — toujours à jour ---
execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build_assets.mjs')], { stdio: 'inherit' });

// --- 1. Bundle IIFE : tout le graphe d'imports (dont Three.js) en un script ---
const result = await build({
  entryPoints: [path.join(WEB, 'src/main.js')],
  bundle: true,
  format: 'iife',            // exécutable en <script> classique
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  write: false,
  logLevel: 'warning',
  absWorkingDir: WEB,        // résout 'three' depuis web/node_modules
});

const rawJs = result.outputFiles[0].text;

// Sécurité : une chaîne littérale "</script" fermerait la balise prématurément.
if (/<\/script/i.test(rawJs)) {
  throw new Error('Le bundle contient "</script" : échappement requis.');
}

// --- 2. Assemblage du HTML autonome ---
let html = await fs.readFile(path.join(WEB, 'index.html'), 'utf8');
const css = await fs.readFile(path.join(WEB, 'style.css'), 'utf8');

const before = html.length;
html = html
  .replace(/<link rel="stylesheet" href="style\.css">/, () => `<style>\n${css}\n</style>`)
  .replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '')
  .replace(/<script type="module" src="\.\/src\/main\.js"><\/script>/, () => `<script>\n${rawJs}\n</script>`);

// Contrôles de non-régression : les remplacements doivent avoir eu lieu.
const problems = [];
if (html.includes('style.css')) problems.push('CSS non inlinée');
if (html.includes('importmap')) problems.push('importmap encore présente');
if (html.includes('src="./src/main.js"')) problems.push('module externe encore référencé');
if (before === html.length) problems.push('aucun remplacement effectué');
if (!html.includes('<style>')) problems.push('balise <style> absente');
if (!html.includes('WebGLRenderer')) problems.push('Three.js non inclus dans le bundle');
if (!html.includes('glTF')) problems.push('modèles 3D absents du bundle');
if (html.length < 2.5 * 1048576) problems.push('bundle suspicieusement petit (assets manquants ?)');
// Seules les URI de namespace XML (w3.org) sont tolérées : aucune ressource
// distante ne doit être chargée par le fichier final.
const noNamespaces = html.replace(/https?:\/\/www\.w3\.org\/[^'"\s]*/g, '');
if (/<script[^>]+\ssrc=|<link[^>]+\shref=|import\s*\(\s*['"]https?:/i.test(noNamespaces)) {
  problems.push('ressource externe détectée (le jeu doit être 100 % hors-ligne)');
}
if (problems.length) {
  throw new Error('Échec du build :\n - ' + problems.join('\n - '));
}

await fs.writeFile(OUT, html, 'utf8');
const ko = (html.length / 1024).toFixed(0);
console.log(`✅ ${path.relative(ROOT, OUT)} généré — ${ko} Ko, 0 dépendance externe, ouvrable par double-clic.`);
