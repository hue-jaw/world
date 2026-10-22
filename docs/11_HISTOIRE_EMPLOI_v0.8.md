# v0.8 — Franchissement, Histoire, Carrosserie, Rendu

> **Version** : 0.8.0 · **Branche** : `arena/ee922d41-world`
> **Format de ce document** : Décision → Raison → Implémentation → Test.

---

## 0. Les quatre plaintes de départ

| # | Plainte (mot pour mot) | Verdict |
|---|---|---|
| 1 | « c'est quoi ces trucs verts sur les routes, on peut pas grimper dessus alors que le trottoir de même hauteur, on peut » | **Corrigé** |
| 2 | « au lancement du jeu en mode histoire […] pk je suis livreur dès le début » | **Corrigé** |
| 3 | « j'aimerais qu'avec de l'argent on puisse ensuite se prendre un job et une maison, mais pas un job direct » | **Corrigé** |
| 4 | « change de moteur 3d […] les voitures elles sont moches […] là le jeu est moche » | **Partiellement** — voir §5, décision assumée |

---

## 1. Le moteur : pourquoi je reste sur three.js / Electron

**Décision.** Je ne bascule pas sur Unreal Engine 5. Je pousse la qualité du moteur existant.

**Raison.** Ce n'est pas une question de goût, c'est une question de ce qui est
livrable :

1. **Aucun éditeur UE5 dans cet environnement.** Pas d'installation possible, pas
   de compilateur MSVC, pas d'accès aux banques d'assets Epic (hôtes bloqués).
   Je ne peux ni construire ni **tester** un build UE — donc je ne peux pas vous
   garantir qu'il démarre.
2. **Le lancement double-clic serait perdu.** Un build UE packagé fait 3 à 8 Go
   et demande DirectX 12 + GPU récent. Le contrat « EXE portable de ~75 Mo,
   double-clic, ça joue » disparaît.
3. **Le problème n'est pas le moteur, c'est le rendu.** Un rendu three.js avec
   IBL, ombres douces, DPR natif et goodies PBR n'a rien à envier à un rendu UE
   mal réglé. J'ai donc attaqué la cause : voir §6.

**Ce qui a changé malgré tout.** Les leviers visuels réels (voir §6) ont été
activés : plafond de résolution ×2, ombres 2048 px, ombre de contact sous chaque
véhicule, vitrage physique, détails de carrosserie.

**Ce qui est explicitement reporté.**

- Pas de *nanite / lumen / ray tracing matériel* : hors de portée d'un WebGL2.
- Pas de modèles 3D téléchargés (Meshy.ai, Sketchfab, Quixel) : ces hôtes sont
  inaccessibles depuis l'environnement de build (egress limité à GitHub + npm).
  Les modèles restent les GLB CC0 déjà embarqués (Kenney / Quaternius) +
  géométrie procédurale. **C'est une limite d'environnement, pas un choix
  esthétique.**

---

## 2. Franchissement des terre-pleins et îlots

**Décision.** Un obstacle de moins de 36 cm se franchit à pied ; un véhicule ne
le franchit jamais.

**Raison.** La collision comparait une hauteur d'obstacle à la hauteur des pieds
*sans tolérance* : tout objet de 0,16 m était traité comme un mur de 8 m. Le
trottoir passait parce que le code de sol le soulevait avant la collision — d'où
l'incohérence signalée : deux objets de même hauteur, un seul franchissable.

**Implémentation** (`web/src/city.js`) :

```js
export const STEP_UP = 0.36;                    // marche maximale (m)

collide(x, z, r, y = 0, step = 0) {
  // un collider plus bas que le pied + la marche est ignoré
  if (c.h <= y + step) continue;
  ...
}

groundY(x, z, y) {
  // on peut se tenir sur tout ce qui est sous y + STEP_UP
  if (c.h <= y + STEP_UP && c.h > best) best = c.h;
}
```

Appelants :

| Fichier | Appel | Effet |
|---|---|---|
| `player.js` | `collide(x, z, 0.38, y, STEP_UP)` | le piéton enjambe |
| `pedestrians.js` | `collide(x, z, 0.32, 0, STEP_UP)` | les PNJ aussi |
| `vehicles.js` | `collide(x, z, …, 0)` → `step = 0` | **la voiture reste bloquée** |

`propHeightAt(x, z)` a été ajouté pour interroger la hauteur d'un objet sans
le traverser (placement, caméra).

**Ce qui reste infranchissable** : troncs, murs, immeubles, mobilier haut — tous
au-delà de 0,36 m. La marche est donc une règle de hauteur, pas une exception
par type d'objet.

**Tests** (`tools/test_v08.mjs`) : 5 vérifications, dont une **marche réelle**
(simulation de 120 frames sur 2 m) qui prouve que le joueur monte à 0,20 m,
traverse, puis redescend — et qu'une voiture, elle, reste bloquée.

---

## 3. Mode Histoire : plus de livreur au démarrage

**Décision.** En mode Histoire, le joueur démarre **sans emploi, sans toit,
avec 35 $**. Aucune course ne se déclenche toute seule.

**Raison.** Le code d'avant lançait `newDelivery()` 1,6 s après le chargement,
sans condition. Le joueur était « livreur » parce qu'une boucle tournait — pas
parce que l'histoire le disait.

**Implémentation.**

- `missions.mode` : `'off'` (aucun emploi) · `'gig'` (annonce unique) ·
  `'job'` (contrat, enchaînement automatique).
- En `'off'` / `'gig'`, `update()` ne crée **jamais** de mission.
- Une annonce terminée repasse le mode à `'off'` : il faut en accepter une autre.
- Panneau **Emploi (J)** : liste les annonces, l'embauche, le logement.
- `ECONOMY.startStoryMoney = 35`.

**Progression en quatre chapitres** (`web/src/story.js`) :

| Ch. | Titre | Condition d'entrée | Objectif affiché |
|---|---|---|---|
| I | L'arrivée | début de partie | faire une petite annonce (45–75 $) |
| II | Le contrat | 3 annonces **+ 150 $** de caution → embauche | 140 $/jour, courses ×1,6 |
| III | Un toit | achat d'un logement | boutique → Logements |
| IV | L'ascension | moteur, voiture, garage | libre |

Le prix du **premier logement** a été rééquilibré : `basePrice` 5 000 → 1 200 $,
`pricePerMeter` 260 → 95. Le studio le moins cher coûte **2 834 $ ≈ 20 jours de
salaire** — atteignable, pas offert. (Avant : ~14 000 $, soit ~100 jours.)

**Test.** 315 vérifications au total, dont « le mode Histoire démarre sans
aucune mission imposée » (600 frames = 10 s sans qu'une course n'apparaisse).

---

## 4. Cinématique d'ouverture

**Décision.** Une vraie séquence de 5 plans (34 s), skippable, jouée une seule
fois, avant le premier contrôle.

**Raison.** « des cinématiques et pas ces vieilles animations ». Le format vidéo
est impossible hors-ligne sans alourdir le fichier ; une caméra scénarisée +
lettrage cinéma donne le même effet pour 0 Ko.

**Plans** (~34 s au total) : survol de la ville (8,5 s) → la rue (7,5 s) →
le visage (7 s) → le sol (6 s) → fin (6 s). Lettrage 2.39:1, titre, texte
sous-titre, fondu. `Espace` / `Échap` / clic = passer.

**Détail important.** Pendant la cinématique, la boucle principale **n'appelle
plus `player.update()`** : le joueur ne peut pas marcher pendant qu'on lui parle,
et la caméra appartient à l'histoire.

---

## 5. Carrosserie : « les voitures sont moches »

**Décision.** Améliorer la géométrie et les matériaux, sans changer de moteur.

**Ce qui a été fait** (`web/src/vehicles.js`) :

1. **Ombre de contact** dégradée sous chaque véhicule (voiture **et** moto).
   C'est le détail qui « pose » la voiture sur la route : sans elle, elle flotte.
2. **Vitrage physique** : `MeshPhysicalMaterial`, opacité 0,62, rugosité 0,06,
   `envMapIntensity` 2,4. L'ancien vitrage était un métal sombre → aspect
   plastique opaque.
3. **Détails ajoutés par-dessus le modèle** : rétroviseurs (bras + coque
   peinte), plaques avant/arrière, bas de caisse, échappements chromés, becquet
   sur la Sportive, barres de toit sur le SUV/Utilitaire.
4. **Attributs de spec** `sport` / `suv` dans `core.js` : les détails sont
   pilotés par les données, pas par des `if` sur le nom.

**Tests** : 4 vérifications (ombre présente, ≥ 8 pièces de détail, becquet et
barres de toit, vitrage translucide).

---

## 6. Rendu général

| Réglage | Avant | v0.8 | Pourquoi |
|---|---|---|---|
| Plafond de résolution | ×1,5 | **×2** | netteté sur écran HiDPI/1440p |
| Ombres par défaut | Haute 1536 px | **Ultra 2048 px**, PCFSoft, portée 120 m | contours d'ombre lisibles |
| Étalonnage | saturate 1,14 / contraste 1,07 | inchangé (déjà actif) | coût nul |
| Tonemapping | ACES, expo 1,06 | inchangé | déjà correct |

La **résolution adaptative** est conservée : si les fps passent sous 48, l'échelle
interne baisse par paliers (jusqu'à 0,75) — la netteté ne se paie jamais en
saccades. Le plafond ne fait que relever le maximum atteignable.

---

## 7. Sauvegarde

Format **v3** : ajout de `story` (chapitre, intro vue, embauche) et `jobs`
(contrat, annonces faites, dernier jour payé). Une sauvegarde v2 est refusée
proprement — nouvelle partie, pas de corruption.

---

## 8. Porte qualité

```
SMOKE 19 · FEATURES 42 · INTÉGRATION 15 · V0.4 25 · V0.5 20 · V0.6 20
V0.7 19 · V0.8 32 · ASSETS 112 · RENDU 7 · BUNDLE 4
────────────────────────────────────────────────────────────
315 vérifications · 0 échec
```

`test_bundle` exécute le **fichier livré** (`METROPOLIS.html`) avec un faux
contexte WebGL et laisse tourner la vraie boucle : c'est le test qui reproduit
les conditions « double-clic ».

---

## 9. Ce qui est reporté (et pourquoi)

| Report | Raison |
|---|---|
| Unreal Engine | ni compilable ni testable ici (voir §1) |
| Modèles 3D achetés / Meshy.ai | hôtes inaccessibles depuis l'environnement |
| Page `/play/` séparée | elle dupliquerait `main.js` pour un rendu strictement identique ; les gains sont dans le jeu lui-même |
| Ray tracing matériel, nanite, lumen | hors WebGL2 |
| Doublage voix des cinématiques | aucune synthèse vocale hors-ligne embarquée ; le lettrage suffit |

---

## 10. Utilisation

- Lancer : double-clic sur `METROPOLIS.html` (ou l'EXE de la Release).
- **J** : emploi / petites annonces. **B** : boutique / logements.
- **Espace/Échap** : passer la cinématique.
- Mode Libre (menu → mode) : les courses tournent automatiquement, comme en v0.7.
