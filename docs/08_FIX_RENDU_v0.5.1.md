# v0.5.1 — Correctif du crash au chargement (`reading 'onBeforeCompile'`) + livraison complète

## 1. Le symptôme

Au lancement (fichier HTML **et** EXE), l'écran restait sur :

```
⚠ Erreur de chargement : Uncaught TypeError:
   Cannot read properties of undefined (reading 'onBeforeCompile')
```

Le jeu ne démarrait donc pas du tout, alors que les 20 contrôles v0.5 passaient.

## 2. La cause exacte (et pourquoi les tests ne la voyaient pas)

Nos deux hooks de matériaux (`addGroundDetail` et `setTextureRepeat` dans
`web/src/city.js`) enveloppent la méthode `customProgramCacheKey` de three.js pour
que le programme compilé ne soit pas réutilisé par erreur :

```js
const prev = material.customProgramCacheKey;
material.customProgramCacheKey = () => `${prev ? prev() : 'm'}|groundDetail`;
```

Problème : `prev()` est un appel **détaché**. L'implémentation par défaut de
three.js est :

```js
customProgramCacheKey() { return this.onBeforeCompile.toString(); }
```

Appelée sans receveur, `this` vaut `undefined` → `undefined.onBeforeCompile`.
L'erreur ne survient que lorsque three **compile réellement un programme**, donc
au premier rendu dans un navigateur/Electron — jamais dans les tests Node, qui
appelaient `onBeforeCompile()` à la main mais jamais `customProgramCacheKey()`
ni `renderer.render()`.

C'est un trou de couverture, pas une fatalité : il est comblé depuis (§5).

## 3. Le correctif

Les deux enveloppes rappellent désormais la méthode précédente **avec le
matériau comme receveur**, et chaînent de la même façon le hook :

```js
material.customProgramCacheKey = function cacheKeyWithDetail() {
  return `${prevKey ? prevKey.call(this) : 'm'}|groundDetail`;
};
material.onBeforeCompile = function hookGroundDetail(shader, renderer) {
  if (prevHook) prevHook.call(this, shader, renderer);
  /* … */
};
```

Aucune autre ligne de gameplay n'est modifiée : les 20 contrôles v0.5, les 25 de
v0.4 et les 112 de check_assets restent verts.

## 4. Preuve de non-régression

Le correctif a été retiré volontairement pour vérifier que les nouveaux tests
attrapent bien la panne — puis remis :

| Build | `test_render` | `test_bundle` |
|---|---|---|
| sans correctif | ✗ `Cannot read properties of undefined (reading 'onBeforeCompile')` | ✗ même message, écran bloqué sur « Impossible de démarrer » |
| avec correctif | ✅ 7/7, 1 389 draw calls, 402 k triangles | ✅ 4/4, le fichier livré démarre et rend ses premières images |

## 5. Deux nouveaux tests, sans GPU

### `tools/mock_webgl.mjs`

Faux contexte WebGL 2 (constantes, paramètres, shaders, programmes, uniformes,
framebuffers). Il ne dessine rien, mais il fait parcourir à three.js **tout le
chemin réel de compilation et de rendu**.

### `tools/test_render.mjs` — 7 contrôles

- 2 965 matériaux : `customProgramCacheKey()` attaché doit renvoyer une clé
  stable, et `onBeforeCompile()` doit s'exécuter ;
- 6 images complètes : jour, pluie, nuit, après mise à jour joueur, après trafic
  et piétons, puis chunks streamés à 1 km. Chaque image doit produire plus de
  100 draw calls sans exception (shadow maps et PMREM compris).

### `tools/test_bundle.mjs` — 4 contrôles

Il lit **le fichier réellement livré** (`METROPOLIS.html`, celui embarqué dans
l'EXE), extrait le script inline, l'exécute avec un DOM factice et le faux
contexte GL, puis laisse tourner la boucle :

- le bundle s'exécute sans exception ;
- aucune erreur pendant les premières images ;
- l'écran de chargement disparaît ;
- aucun message d'erreur n'est affiché au joueur.

### Intégration à la porte qualité

```bash
npm test
# smoke 19 · features 42 · intégration 15 · v0.4 25 · v0.5 20 ·
# assets 112 · rendu 7 · build · bundle 4
```

## 6. Livraison

| Artefact | Où |
|---|---|
| `METROPOLIS-0.5.1.html` | `release/` du dépôt (double-clic, hors-ligne) |
| `METROPOLIS-0.5.1-win64.exe` | release GitHub `v0.5.1`, construit par GitHub Actions (Windows), pas par la sandbox |
| Source | `arena/ee922d41-world`, tag `v0.5.1` |

**Pourquoi l'EXE n'est pas construit dans la sandbox** : l'egress n'autorise que
`github.com`, `registry.npmjs.org`, `pypi.org` et quelques hôtes. Electron et
electron-builder téléchargent leurs binaires depuis
`objects.githubusercontent.com` (bloqué), et l'empaquetage Windows exige en plus
Wine, absent ici. L'upload d'assets de release (`uploads.github.com`) est
également bloqué.

La chaîne existante fait donc le travail à notre place : le workflow
`.github/workflows/build-windows-exe.yml` s'exécute sur `windows-latest` et
dépose l'EXE dans la release. Il a été corrigé en v0.5.1 : le tag de release est
désormais **dérivé de la version** (`desktop/package.json`) au lieu d'être codé
en dur sur `v0.3.0` — d'où l'ancien `METROPOLIS-0.4.0-win64.exe` qui traînait
dans la release v0.3.0.

## 7. Ce qui reste non vérifiable ici

Aucun GPU : le rendu visuel (couleurs, ombres, reflets) n'est **pas** observé.
Les tests prouvent que les shaders se compilent, que les matériaux sont valides
et que la boucle tourne — pas que l'image est belle.
