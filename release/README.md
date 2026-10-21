# Artefacts prêts à jouer

Ce dossier contient le jeu **déjà construit**, versionné pour être téléchargeable
directement depuis GitHub (les uploads d'assets de release sont bloqués dans
l'environnement de développement, pas sur GitHub Actions).

| Fichier | Usage |
|---|---|
| `METROPOLIS-0.5.1.html` | **Double-clic** → le jeu complet s'ouvre dans le navigateur, hors-ligne, sans installation. `F11` plein écran. |
| `METROPOLIS-0.5.1-win64.exe` | Dans la release GitHub `v0.5.1`, construit par GitHub Actions sur Windows (fenêtre dédiée, `F11` / `F12`). |

## Ce que corrige la 0.5.1

Le jeu ne démarrait pas :

```
⚠ Erreur de chargement : Uncaught TypeError:
   Cannot read properties of undefined (reading 'onBeforeCompile')
```

Cause : nos hooks de matériaux appelaient `material.customProgramCacheKey()`
détachée ; l'implémentation three.js fait `this.onBeforeCompile` et `this` valait
`undefined`. Détail complet : `docs/08_FIX_RENDU_v0.5.1.md`.

## Reconstruire

```bash
cd web && npm ci          # une seule fois
cd .. && npm test         # porte qualité complète (ville, rendu, bundle)
node tools/build_single_file.mjs
# -> METROPOLIS.html à la racine, à copier ici
```

Pour l'EXE sur votre machine :

```bash
cd desktop
npm install
npm run dist:win           # -> desktop/release/METROPOLIS-<version>-win64.exe
```
