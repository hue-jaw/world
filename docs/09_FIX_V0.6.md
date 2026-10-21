# v0.6 — Correctifs du 21/10 : façades, arbres, saut, L3, moto

Cette version ne change pas le périmètre : elle corrige les six défauts signalés,
avec une mesure pour chacun. Règle appliquée : **rien n'est déclaré corrigé sans
un test automatique qui échouerait sur l'ancien code**.

| Défaut signalé | Cause réelle | Correction | Preuve |
|---|---|---|---|
| Textures d'immeubles déformées | UV de boîte 0→1 sur une façade de 40 m : la texture était étirée sur toute la hauteur. La texture contenait en plus une vitrine et une corniche. | UV **en mètres** + texture de **tuile d'étages** sans bord + **podium commerçant** séparé | `test_v06` : span V = h / tileH à 2 % près |
| PNJ dans les arbres | Le piéton visait son waypoint en ligne droite et était seulement repoussé par `collide()` | Sonde à 1,6 m + 6 déviations (±35°…±105°) | `test_v06` : 0 % de PNJ dans un tronc sur 20 s |
| Petits props verts illisibles / bloquants | Arbres = boîtes vertes sans texture ; collider de 0,7 m traité comme un mur | Tronc + houppier texturés (2 draw calls), collider **soft** de 0,5 m | frein à 78 % une seule fois par contact |
| A ne saute pas / L3 inerte | Appui sur une frame où `grounded` est faux (marche, trottoir) → appui perdu | **Buffer 0,16 s + coyote 0,12 s** ; L3 = sprint à pied, regard arrière en voiture | A = Espace = 1,25 m ; sprint 6,56 vs 3,32 m/s |
| Joueur invisible sur la moto | `group.visible = false` à la montée, aucun cavalier construit | `buildMotoMesh` + `buildRiderFigure` (pilote visible) | `driverFig` présent, visible en 3e personne |
| Saccade en montant en moto | Deux `SpotLight` créées à la montée → three.js **recompile tous les shaders** | Projecteurs créés une fois au démarrage, simples déplacements ensuite | 0 lumière créée à la montée |
| Pas de conducteurs de moto IA | Moto sans figure de pilote | Même cavalier pour le joueur et l'IA | `driverFig` sur chaque moto |

---

## 1. Façades — UV métriques et tuile répétable

**Décision.** Une façade se construit en deux parties : les **étages** (tuile
répétable) et le **rez-de-chaussée** (podium de 4 m).

**Raison.** Trois défauts se cumulaient :

1. `BoxGeometry` mappe chaque face sur `u,v ∈ [0,1]`. Sur un immeuble de 40 m,
   six rangées de fenêtres étaient étirées sur 40 m : chaque fenêtre faisait
   6,7 m de haut.
2. Passer en UV métriques (`v = y / tileHeight`) impose `RepeatWrapping`. Or la
   texture de façade contenait **une vitrine de boutique, une corniche et une
   plinthe** : en répétant, on obtenait une boutique tous les 18 m au 3ᵉ étage.
3. Le rez-de-chaussée commerçant ne peut pas être dans une tuile répétable : il
   est unique par immeuble.

**Implémentation.**

- `textures.js` → `facadeTiling(palette, band, variant)` : tuile de 1024² ou
  512², **sans bord haut/bas**, murs unis (un dégradé créerait une couture à
  chaque répétition), grain et taches périodiques, uniquement des étages.
  Expose `tileMeters = 16` et `tileHeight = rows × 3`.
- `city.js` → `metricFacadeUV(geo, tileW, tileH, seed, mode)` :
  - `mode 'tile'` (immeuble ≥ 10 m) : `u` en mètres, `v = (y + h/2) / tileH` ;
  - `mode 'fit'` (maison < 10 m) : la tuile complète est étirée une seule fois
    (corniche + plinthe + porte), ce qui est correct pour 6–7 m de haut.
- `makeFacadeInstancedMaterial` (immeubles lointains, projection triplanaire)
  utilise aussi `facadeTiling` : à 2 km, plus de boutique à chaque étage.
- `textures.js` → `shopfront()` : bandeau de 512×128 (4 vitrines, auvents,
  enseignes, version nuit) posé sur un **podium** de 4 m.
- `city.js` → `addPodium()` : **une seule `InstancedMesh`** pour tous les
  podiums du cœur (39 aujourd'hui, capacité 512) → 1 draw call, 1 matériau,
  poussé dans `windowMaterials` : les vitrines s'allument la nuit avec le reste.

**Mesures** (`node tools/test_v06.mjs`) :

```
✓ la tuile d'étages se répète dans les deux sens        (tileHeight = 30 m)
✓ la tuile ne contient plus de devanture
✓ un immeuble de 40 m utilise la tuile, pas la façade décorée
✓ les UV verticaux sont en mètres (v couvre h / tileH)
✓ un bâtiment bas (< 10 m) garde la façade complète     (mode 'fit')
✓ les vitrines de rez-de-chaussée existent              (39 podiums, 1 draw call)
```

---

## 2. Arbres — identifiables, et non bloquants

**Décision.** Les arbres sont des objets **frêles** : ils freinent une voiture,
ils ne l'arrêtent pas comme un mur.

**Raison.** Deux plaintes distinctes : « les petits trucs verts ne sont pas
reconnaissables » et « ils bloquent les voitures absurdement ». Le collider de
0,7 m appliquait la même réponse qu'un immeuble : −65 % de vitesse **à chaque
frame de chevauchement**, soit un arrêt complet.

**Implémentation.**

- Tronc : `CylinderGeometry(0.17, 0.30, 2.9, 8)` avec texture d'écorce.
  Houppier : 4 lobes fusionnés, UV sphériques, texture de feuillage, teinte HSL
  par instance. **2 `InstancedMesh`** pour toute la ville, 465 arbres.
- `city.addCollider(x, z, w, d, h, kind)` accepte `'soft'`. `collide()` renvoie
  désormais `{ x, z, soft }`.
- `Vehicle.update` : obstacle dur → ×0,35 (comportement inchangé) ; obstacle
  frêle → ×0,78 **une seule fois par contact** (délai de 0,30 s), puis la
  voiture est simplement déviée. Aucun dégât, aucun crime (`Bus.emit('bush')`).
- Piétons : sonde de collision à 1,6 m devant, essai de six déviations
  (±35°, ±70°, ±105°) ; la première libre est prise, le waypoint n'est pas
  abandonné.

**Mesures.**

```
✓ les arbres sont texturés et dessinés en 2 appels
✓ les arbres sont des obstacles « soft » de 0,5 m      (155 colliders souples)
✓ une voiture est freinée par un arbre, pas arrêtée net
✓ les PNJ ne restent pas plantés dans un tronc (20 s)  (0 % des échantillons)
```

---

## 3. Saut (A et Espace) et L3

**Décision.** L'appui est mémorisé, le sol est « tolérant ».

**Raison.** Le saut n'était autorisé que si `grounded` était vrai **au début de
la frame**. En montant un trottoir, ou une frame après l'avoir quitté, l'appui
était ignoré — d'où « A ne répond pas » de façon intermittente. Le clavier
passait par le même test, mais tombait moins souvent sur la mauvaise frame.

**Implémentation** (`player.js`) :

```js
this._jumpBufferT = 0.16 si (Space || A) ;   // intention conservée 160 ms
this._coyoteT     = 0.12 si grounded ;       // 120 ms pour sauter après le sol
if (buffer > 0 && coyote > 0) { vy = 7.6 ; grounded = false ; }
```

L3 : à pied, bascule du sprint (déjà correcte) ; **en véhicule**, L3 devient un
regard arrière maintenu (`_lookBack`), avec un toast explicite au premier appui.

**Mesures.**

```
✓ bouton A (manette) : saut mesuré                   1,25 m
✓ touche Espace : même saut                          1,25 m
✓ appui juste avant l'atterrissage : conservé        saut ≤ 3 frames après le contact
✓ L3 : sprint nettement plus rapide que la marche    6,56 vs 3,32 m/s
✓ L3 : appui réel via la manette bascule le sprint
✓ L3 en véhicule : regard arrière, pas de sprint
```

---

## 4. Moto — cavalier visible, zéro saccade

**Décision.** Aucun objet (mesh, **ni lumière**) n'est créé au moment de monter.

**Raison.** Le pic de lenteur n'était pas dû à la géométrie : `attachPlayerLights()`
créait **deux `SpotLight`** à la montée. three.js compte les lumières dans la clé
de programme : ajouter une lumière invalide **tous** les matériaux de la scène,
qui sont recompilés (freeze d'environ une seconde, invisible en test unitaire).
Par ailleurs, le joueur était masqué (`group.visible = false`) sans qu'aucun
corps ne prenne sa place → « joueur invisible ».

**Implémentation.**

- `vehicles.js` → `buildMotoMesh()` : peinture `MeshPhysicalMaterial`, cadre,
  moteur chromé, réservoir, selle, fourche, guidon, échappement, deux roues de
  0,32 m, feux avant/arrière émissifs, halo de phare.
- `buildRiderFigure()` : silhouette fusionnée (veste, pantalon, peau, casque,
  visière), mains au guidon, jambes repliées, buste incliné à −0,55 rad.
  Retournée comme `driverFig` : elle est **masquée en vue intérieure**, visible
  en 3ᵉ personne. Le même modèle habille les motos du trafic.
- `TrafficSystem` crée **une fois** `headRig` (2 projecteurs) au démarrage ;
  `_updateHeadRig()` ne fait que positionner/intenser chaque frame.
- Le gyrophare de police n'ajoute plus de `PointLight` (même cause de
  recompilation) : bandeau émissif + halo suffisent.

**Mesures.**

```
✓ la moto a un cavalier visible et deux roues
✓ monter en moto ne crée aucune lumière (pas de recompilation)
✓ en 3e personne le cavalier est visible ; en 1re il est masqué
✓ les motos de trafic ont aussi un conducteur
```

---

## 5. Porte qualité — 264 vérifications

```
SMOKE 19 · FEATURES 42 · INTÉGRATION 15 · V0.4 25 · V0.5 20 · V0.6 20
ASSETS 112 · RENDU 7 · BUNDLE 4                                   → 0 échec
```

Le nouveau `tools/test_v06.mjs` (20 contrôles) est ajouté à `npm test` **et** à la
porte qualité du workflow : il tourne avant la fabrication de l'EXE.

```bash
cd web && npm ci && cd ..
npm test                  # 264 vérifications
node tools/build_single_file.mjs   # METROPOLIS.html
```

## 6. Ce qui reste ouvert (dit franchement)

- **Rendu 3D réel non vérifiable ici** : aucun GPU dans l'environnement. Les
  captures ci-jointes sont des textures et des plans de données, pas des images
  du jeu. Les tests de rendu prouvent l'absence d'exception et la géométrie des
  UV, pas la beauté de l'image. C'est une limite de la sandbox, pas du jeu.
- **Refonte graphique « GTA 5 »** : les lots prévus (ombres en cascade,
  occlusion ambiante, reflection probes, matériaux PBR, végétation, densité)
  restent à faire ; cette version ne fait que corriger ce qui était cassé.
- **Podiums** : 39 dans le cœur. Les immeubles de la métropole étendue n'en ont
  pas (invisible à leur distance de rendu).
