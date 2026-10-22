# Artefacts prêts à jouer

Ce dossier contient le jeu **déjà construit**, versionné pour être téléchargeable
directement depuis GitHub (les uploads d'assets de release sont bloqués dans
l'environnement de développement, pas sur GitHub Actions).

| Fichier | Usage |
|---|---|
| `METROPOLIS-0.7.0.html` | **Double-clic** → le jeu complet s'ouvre dans le navigateur, hors-ligne, sans installation. `F11` plein écran. |
| `METROPOLIS-0.7.0-win64.exe` | Dans la release GitHub `v0.7.0`, construit par GitHub Actions sur Windows (fenêtre dédiée, `F11` / `F12`). |
| `METROPOLIS-0.6.0.html` | Version précédente (correctifs façades/arbres/saut/moto), conservée pour la release `v0.6.0`. |
| `METROPOLIS-0.5.1.html` | Version précédente (correctif de chargement), conservée pour les liens de la release `v0.5.1`. |

## Ce que corrige la 0.7.0

- **GPS temps réel** : les flèches au sol, le ruban bleu et la mini-carte
  repartent de la position réelle du joueur (avant, ils étaient figés sur
  l'itinéraire calculé au moment où la destination avait été posée).
- **Recalcul automatique** dès que l'on quitte la route (> 20 m), et toutes les
  2,5 s de conduite. A* : 0,6 ms pour 2,3 km, donc sans saccade.
- **Prochaine manœuvre** : « Tournez à gauche · Rue des Tanneurs — 180 m ·
  4 min · 1,9 km restants », dans un bandeau dédié.
- **Arrivée** détectée (< 14 m) : flèches et ruban s'éteignent, le bandeau
  affiche « Vous êtes arrivé ».

Détail et mesures : `docs/10_GPS_TEMPS_REEL_v0.7.md`.

## Ce que corrige la 0.6.0

- Façades : UV en mètres + tuile d'étages répétable → plus de fenêtres étirées,
  plus de vitrine au 3ᵉ étage ; rez-de-chaussée commerçant sur podium instancié.
- Arbres : tronc/houppier texturés, collider « soft » de 0,5 m → la voiture est
  freinée, pas stoppée net.
- Saut : buffer d'appui 0,16 s + coyote 0,12 s → **A** (manette) et **Espace**
  sautent réellement (1,25 m).
- **L3** : sprint à pied, regard arrière en véhicule.
- Moto : cavalier visible (joueur **et** IA), et **zéro création de lumière** à
  la montée — c'était la cause du freeze (recompilation de tous les shaders).

Détail et mesures : `docs/09_FIX_V0.6.md`.

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
