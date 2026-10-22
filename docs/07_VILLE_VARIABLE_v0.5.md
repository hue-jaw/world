# v0.5 — Ville variable, asymétrique, avec rues nommées, sens uniques, giratoires, canal et autoroute

> Objectif de la version : casser la trame régulière et symétrique de la v0.4, et donner au
> monde les éléments de voirie qui font « vraie ville » : rues nommées, sens uniques,
> rond-points, ponts sur canal, autoroute périphérique.

---

## 1. Ce qui était faux en v0.4

| Problème | Cause réelle | Correction v0.5 |
|---|---|---|
| Carte symétrique, même nombre d'immeubles partout | `genChunk` utilisait un motif déterministe par parité de bloc ; quartiers tirés en anneaux concentriques autour du centre | Hachage par bloc (`hash2(bi,bj,1337)`) + `districtMap` à pôles euclidiens + bruit |
| Rues toutes identiques et anonymes | Aucune donnée de voie : la grille n'était qu'un maillage géométrique | `web/src/streets.js` : `StreetGrid` avec classes, noms, sens uniques |
| Pas de sens uniques | `canDrive` n'existait pas ; l'IA et le GPS ignoraient toute contrainte | `city.canDrive(node, dir)` consulté par `vehicles.js` et `gps.js` |
| Virages uniquement à 90° | Croisements secs | 16 giratoires avec îlot, `lanePoint` déporté à 7 m |
| Aucune coupure urbaine | Pas d'eau | Canal de 44 m à `x = −1120`, 129 ponts |

---

## 2. Architecture

```
web/src/streets.js     ← données pures de voirie (aucune dépendance Three.js)
   hash2(a,b,salt)          bruit déterministe entier
   STREET_CLASSES           avenue / boulevard / rue / passage
   describeStreet(k, salt)  nom + classe + sens unique, déterministes
   StreetGrid               horizontal(k) / vertical(k) / nearest(x,z) / nameAt(x,z) / crossAt(...)

web/src/city.js
   buildStreetGrid()        instancie StreetGrid (+ CORE_I)
   buildStreetFurniture()   flèches de sens unique, médianes, îlots de giratoire, bollards
   buildCanal()             eau + quais + garde-corps + index des ponts
   canDrive(node, dir)      autorité unique sur la circulation
   streetAt(x,z)            nom de rue pour le HUD
   genChunk(bi,bj)          génération hachée, 0 à 4 immeubles

web/src/vehicles.js    ← TrafficSystem et HighwayDriver respectent canDrive
web/src/gps.js         ← `ignoreOneWay` pour les piétons, pas pour le joueur
web/src/ui.js          ← #clock-street : nom de rue + marqueur de sens unique
```

**Décision → raison → implémentation → test**

- **Décision** : sortir toute la voirie dans un module pur `streets.js`.
  **Raison** : testable sans WebGL, réutilisable par le GPS, le HUD et le trafic ; une seule
  source de vérité pour « quelle rue suis-je en train de suivre ? ».
  **Implémentation** : `describeStreet(k, salt)` est une fonction pure de `hash2`.
  **Test** : `test_v05` vérifie que deux appels donnent le même nom (déterminisme) et que les
  258 voies ont un nom.

- **Décision** : `canDrive` comme unique autorité, plutôt que des règles dupliquées.
  **Raison** : une rue à sens unique doit contraindre à la fois le joueur, l'IA, le GPS et les
  flèches au sol ; dupliquer la règle garantit qu'un des quatre dérive.
  **Implémentation** : `this.streets.horizontal(node.j).oneWay` ; `dir 0 = +x`, `1 = −x`,
  `2 = +z`, `3 = −z`. Le canal interdit `dir 2/3` sur la colonne d'eau.
  **Test** : `test_v05` fait rouler 600 frames de trafic et vérifie qu'aucun véhicule n'est en
  contresens ; `gps.js` est testé séparément.

---

## 3. Ville variable et asymétrique

`districtMap` ne dessine plus d'anneaux : chaque bloc reçoit un district par plus proche pôle,
puis 22 % des blocs sont bruités par `hash2(i, j, 101)`.

| Pôle | Position (blocs) |
|---|---|
| downtown | (4.5, 1.5) |
| commercial | (2.0, 2.2) |
| oldtown | (5.2, 5.0) |
| industrial | (1.5, 4.5) |

Répartition mesurée sur le cœur (N = 7 × 7 blocs) :
industrial 9 · suburb 12 · residential 7 · commercial 6 · oldtown 9 · downtown 6.

`genChunk` tire son nombre d'immeubles au hachage, indépendamment du bloc voisin :

| `roll` | immeubles |
|---|---|
| < 0,06 | 0 (dalle vide / chantier) |
| < 0,30 | 1 (immeuble unique sur 92 % du terrain) |
| < 0,62 | 2 |
| < 0,88 | 3 |
| sinon | 4 |

18 % des immeubles sont des tours (`maxH × 0,8…1,25`) ; la hauteur maximale est amplifiée
autour du pôle d'affaires au nord-est ; la zone portuaire plafonne à 2 immeubles.
`h % 100 >= 96` crée une placette : l'effet visuel est une ville qui respire, sans damier.

> ⚠️ Piège corrigé : `h >> n` en JavaScript est un décalage **signé**. Sur un hachage négatif
> il produit un index négatif et `pal[undefined]`. Tous les index de tableau passent par `>>>`.

---

## 4. Rues, noms et sens uniques

- 258 voies décrites (129 Est-Ouest + 129 Nord-Sud), chacune nommée à partir de deux listes
  combinées par le hachage : *Avenue*, *Boulevard*, *Rue*, *Passage*.
- Les `passage` sont piétonniers : `canDrive` renvoie `false` dans les deux sens, et des
  bollards sont instanciés à l'entrée.
- 58 voies sont à sens unique (38 % des `rue`), signalées par :
  - une flèche au sol tous les 96 m, dans le bon sens (le tip du plan pointe vers −Z après
    `rotateX(-π/2)`, donc `rot = −π/2` pointe vers +X) ;
  - le HUD `#clock-street`, qui affiche le nom + « ⇢ » ;
  - `gps.js`, qui n'emprunte jamais le contresens.

---

## 5. Giratoires

16 carrefours hors du cœur historique deviennent des giratoires :

- îlot central de 4,0 m de rayon (collider) ;
- `lanePoint(node, dir)` déporte le point de voie de 7 m au lieu de la demi-largeur, ce qui
  force la trajectoire à contourner l'îlot ;
- `roundaboutKeys` stocke des **indices de nœud** (`offset + CORE_I`), pas des offsets.

> ⚠️ Piège corrigé : `Math.round((x + WORLD_HALF) / P)` donne un offset 0…128 ; l'ajouter
> tel quel dans un `Set` de nœuds ne correspond à rien. Il faut `+ CORE_I`.

---

## 6. Canal et ponts

- `CANAL = { x: -1120, w: 44, half: 22, quay: 22.6 }` : lit de 44 m, quai maçonné.
- `canDrive` interdit les déplacements Nord-Sud sur la colonne d'eau : on ne longe pas le canal,
  on le **traverse** par les ponts.
- 129 ponts, un par ligne de rue Est-Ouest franchissant le canal ; la circulation Est-Ouest
  reste autorisée dessus.
- `genChunk` saute la bande du canal ; `pedNodesDry` exclut `|x + 1120| ≤ 32` pour que les
  piétons ne flottent pas sur l'eau.
- Les garde-corps sont des colliders continus : le quai bloque physiquement le piéton.

> ⚠️ Piège corrigé (test) : un chunk mesure 256 m et le canal 44 m — on ne peut **pas** tester
> la garde en demandant à `genChunk` de renvoyer `null`. Le test parcourt `city.colliders` et
> vérifie qu'aucune empreinte de bâtiment ne tombe dans la bande du canal.

---

## 7. Autoroute périphérique

- `RING = 2048` exporté par `city.js` : anneau de 4,1 km de côté.
- `HighwayDriver` (dans `vehicles.js`) fait rouler 9 véhicules (5 dans le sens +, 4 dans le
  sens −) à 24–30 m/s, dans un couloir situé **à droite** de l'axe (5,5 à 9,9 m).
- `_pointAt(s)` travaille en abscisse curviligne sur les quatre tronçons : les véhicules ne
  peuvent pas couper les virages.
- Recyclage dès que `|pos| > 1,2 · RING` : pas de fuite mémoire, pas de véhicule perdu.
- Les glissières de l'anneau sont des tronçons de `P − 18` m, avec une **ouverture à chaque rue
  transversale** : on peut sortir de l'autoroute.

> ⚠️ Piège corrigé : la première version de `_pointAt` inversait la rotation et plaçait le
> couloir à gauche, donc les deux sens se croisaient. Réécrite pour que le couloir soit
> toujours du côté droit du sens de circulation.

---

## 8. Mesures v0.5

| Indicateur | Valeur |
|---|---|
| Génération de la ville | **375–409 ms** |
| Colliders | **2 700 – 2 888** |
| Giratoires | **16** |
| Ponts | **129** |
| Terre-pleins (médianes) | **1 188** |
| Voies nommées | **258** (dont **58** sens uniques) |
| Bâtiments du cœur | **135** |
| Véhicules d'autoroute | **9** |

---

## 8 bis. Plan de contrôle (rendu logiciel, sans GPU)

```
node tools/render_plan.mjs   -> previews/city_plan_v0.5.png
```

Vue de dessus des **données** du jeu (pas un rendu 3D) : à gauche la métropole de 8,2 km
(réseau, classes de voies, sens uniques, anneau, canal), à droite un zoom de 2 km sur le canal
et le cœur — quartiers de `districtMap`, empreintes réelles des bâtiments streamés, ponts et
giratoires. 771 empreintes de bâtiments, 129 ponts, 16 giratoires.
C'est la preuve visuelle la plus directe de l'asymétrie qu'on puisse produire sans GPU.

## 9. Tests

```
node tools/test_v05.mjs   → 20 / 20
node tools/test_v04.mjs   → 25 / 25
npm test                  → 19 / 42 / 15 / 25 / 112
```

Les 20 contrôles v0.5 couvrent : noms de rues (déterminisme, HUD), sens uniques (joueur, IA sur
600 frames, GPS), giratoires (comptage, rayon 7 m), canal (existence, circulation, bâtiments,
piétons, garde-corps), autoroute (9 véhicules, 900 frames sur l'anneau), asymétrie (quartiers,
variation du nombre d'immeubles, temps de génération, HUD).

---

## 10. Limites assumées (règle §29)

- **Aucun rendu GPU n'est vérifiable dans cet environnement headless.** Les tests valident la
  géométrie, les colliders, les données de voirie et la logique ; l'aspect visuel (flèches au
  sol, eau, îlots de giratoire) est raisonné mathématiquement, pas observé.
- Les ponts sont des tabliers plats : pas encore d'arches ni de piles visibles.
- Les giratoires n'ont pas encore de signalisation (cédez-le-passage) ni de marquage annulaire.
- L'autoroute n'a ni bretelles d'accès ni panneaux de direction ; les 9 véhicules sont
  décoratifs et n'interagissent pas avec le joueur.
