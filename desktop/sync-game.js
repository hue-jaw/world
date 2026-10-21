// Reconstruit METROPOLIS.html a la racine puis le copie ici pour l'empaquetage.
// Lance automatiquement avant "npm start" et "npm run dist:win".
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
execFileSync(process.execPath, [path.join(root, 'tools', 'build_single_file.mjs')], { stdio: 'inherit' });
fs.copyFileSync(path.join(root, 'METROPOLIS.html'), path.join(__dirname, 'index.html'));
console.log('desktop/index.html synchronise depuis METROPOLIS.html');
