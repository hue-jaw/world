// ============================================================================
// METROPOLIS — tools/build_assets.mjs
// Encode les modèles GLB (web/assets/models) en base64 dans un module JS.
//
//   node tools/build_assets.mjs
//
// Pourquoi base64 : le jeu doit rester un FICHIER UNIQUE ouvrable par
// double-clic (file://), où tout chargement réseau est bloqué. Les modèles
// voyagent donc dans le bundle. Coût : +33 % de taille, compensé par la
// compression glTF (quantification + textures WebP).
// ============================================================================
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODELS_DIR = path.join(ROOT, 'web', 'assets', 'models');
const OUT = path.join(ROOT, 'web', 'src', 'assets.generated.js');

let files;
try {
  files = (await fs.readdir(MODELS_DIR)).filter((f) => f.endsWith('.glb')).sort();
} catch {
  console.error(`❌ Dossier de modèles introuvable : ${MODELS_DIR}`);
  process.exit(1);
}
if (files.length === 0) {
  console.error('❌ Aucun modèle .glb trouvé.');
  process.exit(1);
}

let total = 0;
const entries = [];
for (const file of files) {
  const buf = await fs.readFile(path.join(MODELS_DIR, file));
  total += buf.length;
  if (buf.subarray(0, 4).toString('ascii') !== 'glTF') {
    console.error(`❌ ${file} n'est pas un GLB valide (magic bytes incorrects).`);
    process.exit(1);
  }
  entries.push(`  ${JSON.stringify(file)}: "${buf.toString('base64')}",`);
}

const content = `// ============================================================================
// GÉNÉRÉ AUTOMATIQUEMENT par tools/build_assets.mjs — NE PAS ÉDITER À LA MAIN.
// ${files.length} modèles GLB CC0 encodés en base64 (${(total / 1048576).toFixed(2)} Mo).
// Licences et attributions : web/assets/LICENSES.md
// ============================================================================
export const MODELS = {
${entries.join('\n')}
};
`;

await fs.writeFile(OUT, content, 'utf8');
console.log(`✅ ${files.length} modèles embarqués — ${(total / 1048576).toFixed(2)} Mo bruts, module de ${(content.length / 1048576).toFixed(2)} Mo.`);
