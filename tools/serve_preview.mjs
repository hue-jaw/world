// ============================================================================
// METROPOLIS — tools/serve_preview.mjs
// Petit serveur pour l'aperçu live (sandbox) : sert UNIQUEMENT le fichier
// livrable `METROPOLIS.html` (et les images de `previews/` si besoin).
// Rien d'autre du dépôt n'est exposé.
//
//   node tools/serve_preview.mjs [port]      (défaut : 8090)
//
// `npm start` reste le serveur de développement (web/, modules séparés).
// ============================================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8090);

const ALLOWED = [
  { re: /^\/$/, file: 'METROPOLIS.html', type: 'text/html; charset=utf-8' },
  { re: /^\/games?\.html$/, file: 'METROPOLIS.html', type: 'text/html; charset=utf-8' },
  { re: /^\/previews\/[\w.-]+\.png$/, file: null, type: 'image/png' },
];

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const rule = ALLOWED.find((r) => r.re.test(url));
  if (!rule) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 — essayez / pour lancer METROPOLIS');
    return;
  }
  const file = path.join(ROOT, rule.file || url.replace(/^\//, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404');
    return;
  }
  res.writeHead(200, {
    'content-type': rule.type,
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`METROPOLIS — aperçu sur http://0.0.0.0:${PORT}/`);
});
