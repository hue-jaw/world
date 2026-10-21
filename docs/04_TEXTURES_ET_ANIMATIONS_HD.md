# METROPOLIS — Textures HD & animations de locomotion (v0.3.1)

Ce document répond à la demande : « améliore les textures, fais-les en full HD ;
les pneus ne sont pas circulaires ; améliore les animations, fais-en une pour la
marche et une autre pour la course ».

Chaque point suit le format **Décision → raison → implémentation → test**.

---

## 1. Textures « full HD »

### Décision
Passer d'un sol généré en 256² (4 px/m) et de façades en 256² à un jeu de
textures procédurales haute définition, **sans asset externe** et **sans coût
par frame** : façades 1024² (512² pour les petits bâtiments), asphalte 1024²,
trottoir et herbe 512², et surtout une tuile de sol métropole de **2048²**
couvrant un bloc de 64 m (32 px/m), complétée par une texture de détail
métrique de 512² (256 px/m).

### Raison
La laideur venait de deux causes mesurables :
1. **Densité de texels insuffisante.** Le sol métro était une tuile de 256²
   pour 64 m = 4 px/m : à 2 m du sol, un mètre fait 4 pixels. Aucun réglage
   de filtrage ne peut compenser ça.
2. **Absence de relief et de variation.** Des aplats de couleur unie, sans
   grain, sans joint, sans salissure, lisent immédiatement comme « provisoire ».

Une texture unique ne peut pas être nette à la fois à 1 m et à 300 m sans coûter
des gigaoctets. D'où la séparation **grande tuile (structure) + détail métrique
(grain)**, combinés en multiplicateur.

### Implémentation
- `web/src/textures.js` (réécrit) :
  - `facade(palette, band, variant)` → `{ day, night, bump }` : briques avec
    assises, encadrements, meneaux, traverses, appuis, linteaux, rideaux,
    volets, balcons avec garde-corps, vitrines, enseignes, auvents,
    climatiseurs, jardinières, coulures, corniche, plinthe. La carte de nuit
    ne contient que les fenêtres allumées (+ halo) pour servir d'`emissiveMap`.
  - `asphaltHD()`, `sidewalkHD()`, `grassHD()`, `metroGroundHD()` → `{ map, bump }`.
  - `groundDetailHD('asphalt'|'walk'|'grass')` : texture de détail 512² = 2 m.
  - PRNG **local** (mulberry32) : générer une texture ne consomme plus le RNG
    du jeu, donc la ville reste identique d'une session à l'autre (risque R10).
- `web/src/city.js` :
  - `addGroundDetail(matériau, texture, { gain })` : injecte le multiplicateur
    via `onBeforeCompile`, avec `customProgramCacheKey` dédié (sinon three.js
    peut réutiliser un programme compilé sans le hook). Les UV sont
    reconstruites depuis la position monde.
  - **UV par face des bâtiments** : une tuile de façade ≈ 16 m de large. Sans
    cela, la même texture est étirée sur un immeuble de 6 m comme sur un de
    38 m et les fenêtres deviennent énormes.
  - `buildMetroGround()` remplacé : tuile 2048² (32 px/m) + détail.
  - Variante de façade **déterministe** dérivée de `x`/`z`.
- `web/src/main.js` : message « Génération des textures haute définition… »
  affiché avant le travail synchrone (sinon écran figé ≈ plantage perçu).

### Test
- `node tools/render_textures.mjs` → `previews/textures.png` +
  `previews/texture_*.png` (chaque texture en pleine résolution).
- `node tools/render_ground.mjs` → `previews/ground_eye.png` : rendu en
  perspective à 1,70 m avec pyramide de mips, pour juger l'échelle réelle.
- Budget mesuré et documenté : **52,6 Mo CPU / ≈ 70 Mo GPU, 2,4 s** au
  démarrage (voir `docs/03` §1 bis).

### Limite assumée
Les modèles importés (véhicules, personnages CC0) gardent leurs textures
d'origine en 512². On ne peut pas inventer du détail absent : le travail se
limite à l'anisotropie maximale et au filtrage mipmap
(`upgradeImportedTextures`). Le « full HD » porte donc sur l'environnement,
qui occupe l'essentiel de l'écran.

---

## 2. Pneus circulaires

### Décision
Mesurer le rayon **réel** des roues sur un prototype non étiré, puis appliquer
aux pivots une échelle **uniforme**, au lieu de l'étirement anisotrope du
véhicule.

### Raison
Les modèles Kenney sont mis à l'échelle par type de véhicule (`sx, sy, sz`).
Appliquer cet étirement à une roue qui tourne transforme un cercle en ellipse
et l'ellipse « ondule » à chaque rotation. C'était la cause exacte du défaut,
pas la géométrie du modèle.

### Implémentation
`makeVehicle()` dans `web/src/assets.js` : clone de mesure non étiré →
`realWheels` + rayon → corps étiré → un **pivot à échelle uniforme** par roue,
positionné à `(x·sx, r, z·sz)` avec `r = rModel·(sy+sz)/2`. La roue de secours
du SUV n'est pas comptée et est masquée.

### Test
`node tools/render_preview.mjs cars` → `previews/cars.png` : cercle théorique
en vert par roue. Les 8 véhicules (dont la moto, 2 roues) restent dans le
cercle au repos **et** sous rotation (`y/z = 1,000` mesuré).

---

## 3. Marche et course : deux animations distinctes

### Décision
Un seul cycle paramétré par la vitesse, mais avec **deux jeux de paramètres
nettement différents** (marche / course) et une transition douce entre les
deux, plutôt que deux clips figés qui « claquent » au passage.

### Raison
Le joueur change de vitesse en continu. Deux clips indépendants produisent une
cassure visible au moment du sprint. En revanche, un cycle unique mal réglé
donne la même démarche dans les deux cas — ce que le rapport initial décrivait
comme « moche ». La solution est un cycle unique dont **toutes** les amplitudes
interpolent entre un profil marche et un profil course.

### Implémentation
`Assets.animateRig()` (`web/src/assets.js`), blend `run = clamp((v − 2,4)/3,2)` :

| Paramètre | Marche (1,4 m/s) | Course (6 m/s) |
|---|---|---|
| Amplitude de hanche | 0,44 rad | 0,80 rad |
| Flexion de genou | 0,55 rad | 1,15 rad |
| Amplitude de bras | 0,34 rad | 0,78 rad |
| Flexion de coude | 0,10 rad | 1,15 rad |
| Inclinaison du buste | 0,03 rad | 0,20 rad |
| Rebond vertical | 1,8 cm | 7,0 cm |

Deux corrections de fond ont été apportées en plus du réglage :

- **Rebond inversé.** Le bassin était soulevé jambes écartées : le personnage
  semblait flotter à chaque appui. Le rebond est désormais maximal jambes
  jointes (`bob = −(1 − |sin φ|)·amplitude`).
- **Cadence liée à la distance.** `advancePhase()` calcule la phase depuis la
  vitesse réelle et une longueur de foulée (`strideLength`), au lieu d'une
  constante arbitraire : c'est ce qui supprime le **glissement de pieds**.

### Test
`node tools/render_preview.mjs chars` → `previews/chars.png` : 6 phases pour
la marche et 6 pour la course, avec le squelette superposé.
`node tools/render_preview.mjs char1 run 0.9 side` → une pose en grand.

### Limite assumée
Les clips sont **procéduraux**. Ils n'ont ni déformation de peau avancée, ni
compensation de masse, ni synchronisation de pas sur un sol irrégulier. Le
passage à de vraies animations (motion matching) est prévu côté UE5 et reste
hors du périmètre de cette itération.

---

## 4. Outillage de contrôle ajouté

| Outil | Rôle |
|---|---|
| `tools/canvas2d.mjs` | Backend Canvas2D logiciel (chemins, dégradés linéaires/radiaux, clip) pour exécuter les générateurs de textures hors navigateur. |
| `tools/render_textures.mjs` | Génère toutes les textures + planche de contrôle `previews/textures.png`. |
| `tools/render_ground.mjs` | Rendu en perspective du sol avec mips (`ground_eye.png`). |
| `tools/render_preview.mjs` | Rastériseur des véhicules/personnages (corrigé : z-buffer et skinning). |

Deux bugs de l'outillage ont été trouvés et corrigés au passage, et méritent
d'être notés car ils ont failli faire condamner à tort le modèle 3D :
la clé couleur `b` écrasait le sommet `b` du triangle dans le rastériseur, et
`applyBoneTransform` était appelée sans remplir le vecteur au préalable.
