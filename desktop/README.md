# METROPOLIS — version desktop (Windows / macOS / Linux)

## Juste jouer, sans rien compiler

- **Le plus simple, aucun outil** : double-cliquez sur **`METROPOLIS.html`** à la racine du dépôt. Il s'ouvre dans votre navigateur (Chrome, Edge, Firefox, Safari), plein écran avec `F11`, et se sauvegarde automatiquement. C'est le jeu complet.
- **Avec une fenêtre de jeu dédiée (.exe)** : voir ci-dessous.

## Obtenir `METROPOLIS.exe`

### Option A — télécharger le .exe construit automatiquement (recommandé)

**[⬇ github.com/hue-jaw/world/releases/latest](https://github.com/hue-jaw/world/releases/latest)** → `METROPOLIS-0.1.0-win64.exe`

L'exécutable **portable** (un seul fichier, aucune installation, aucun droit administrateur) est reconstruit par GitHub Actions à chaque mise à jour du jeu. Le workflow le publie aussi en artefact de build : onglet *Actions* → *Build Windows EXE* → *Artifacts* → `METROPOLIS-windows-x64`.

### Option B — le construire soi-même (≈ 3 minutes)

Sur une machine Windows avec [Node.js 20+](https://nodejs.org) :

```bash
cd desktop
npm install          # télécharge Electron (dev uniquement)
npm run dist:win     # produit release/METROPOLIS-0.1.0-win64.exe
```

Sur macOS/Linux, remplacez par `npm run dist` pour un paquet de votre système.

### Option C — lancer sans empaqueter

```bash
cd desktop
npm install
npm start            # ouvre la fenêtre du jeu
```

## Notes techniques

- Le jeu est injecté dans Electron sous forme de **fichier unique** (`index.html`, généré par `tools/build_single_file.mjs`) : le binaire fonctionne **hors-ligne**, sans serveur local.
- `F11` plein écran · `F12` outils de développement.
- La sauvegarde utilise le `localStorage` d'Electron (persisté dans le profil utilisateur) ; en cas de refus du stockage, le jeu fonctionne mais ne conserve pas la partie.
- ⚠️ Ce binaire exécute le **prototype web**. Le jeu UE5.5 cible (`../unreal`) restera un projet éditeur séparé, compilable en exécutable de production une fois la Phase 1 bis validée.
