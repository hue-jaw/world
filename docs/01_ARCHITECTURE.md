# METROPOLIS — Architecture technique

> Principes (brief §22) : composants, interfaces, événements, **data-driven**, systèmes testables isolément. Interdits : scripts géants, dépendances circulaires, références en dur entre systèmes.

---

## 1. Vue d'ensemble

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              PRÉSENTATION                                │
│        HUD / Minimap / Boussole / Debug overlay  (lit l'état, n'écrit    │
│        que via des commandes)                    UE5 : UMG + CommonUI    │
├──────────────────────────────────────────────────────────────────────────┤
│                               GAMEPLAY                                   │
│  Joueur (TPS) ──possède──▶ Véhicule        Missions (data-driven)        │
│  Interaction générique (interface)         Services d'urgence (dispatch) │
├──────────────────────────────────────────────────────────────────────────┤
│                              SIMULATION                                  │
│  Trafic (graph de routes)   Citoyens (routines)   Événements dynamiques  │
│  Temps & Météo (machine à états) ──paramètres──▶ grip, vitesses, densité │
├──────────────────────────────────────────────────────────────────────────┤
│                                 MONDE                                    │
│  Génération ville / quartiers / bâtiments / colliders / graphes de nav   │
│  Streaming & LOD (UE5: World Partition ; proto: spawn/despawn + pooling) │
├──────────────────────────────────────────────────────────────────────────┤
│                                 NOYAU                                    │
│  Bus d'événements · Données (Data Assets) · Sauvegarde versionnée · RNG  │
│  seedé · Maths · Audio procédural · Debug/stats                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Règle de dépendance** : une couche ne connaît que celles du dessous, et les systèmes d'une même couche communiquent par **événements** (`crime`, `crash`, `busted`, `toast`, `enterVehicle`…) ou par les **services du contexte** injecté — jamais par référence directe. C'est ce qui rend chaque système testable seul (démontré par `tools/smoke_test.mjs` qui monte la simulation sans UI ni rendu).

## 2. Les systèmes et leurs contrats

| Système | Responsabilité | Entrées | Sorties (événements) | Fichier proto | Équivalent UE5 |
|---|---|---|---|---|---|
| **City** | Génère quartiers, bâtiments, routes, feux, graphes (routier + piéton), colliders | Config data-driven + seed | — (requêtes synchrones : `collide`, `pedPath`, `lightState`) | `city.js` | World Partition + PCG + ZoneGraph baked |
| **Environment** | Horloge 24 h, soleil/lune, météo à états, facteurs gameplay (grip, trafic) | `setWeather`, `advanceTime` | lit par les autres via `ctx.env` | `environment.js` | `UWeatherManager` + `UTimeOfDayManager` (subsystems) |
| **Vehicles/Traffic** | Physique véhicule, IA trafic (voies, feux, suivi), pooling, police+poursuites, wanted | inputs conducteur, `crime` | `crash`, `crime`, `busted` | `vehicles.js` | Chaos Vehicles + Mass Traffic |
| **Citizens** | Identité, routines horaires, navigation trottoirs, réactions (pluie, accidents, esquive) | horloge, météo, `crash` | `crime` (via renversement), `toast` | `pedestrians.js` | Mass Entity + StateTree |
| **Player** | Locomotion TPS, caméra contextuelle, possession véhicule, interaction | clavier/souris | `enterVehicle`, `exitVehicle` | `player.js` | `AMetropolisCharacter` + Enhanced Input |
| **Missions** | Génération data-driven (livraison), marqueurs, chrono, récompenses, difficulté | distance joueur | `toast`, `missionUpdate` | `missions.js` | Mission DataAssets + manager |
| **Audio** | Synthèse procédurale (moteur, pluie, sirène, ville, UI) | RPM, intensités météo/police | — | `audio.js` | MetaSounds |
| **UI** | HUD, minimap, boussole, objectifs, debug | état des systèmes (lecture seule) | commandes joueur (météo, temps…) | `ui.js` | UMG |
| **Save** | Persistance versionnée | état de partie | — | `save.js` | `UMetropolisSaveGame` |

## 3. Simulation à plusieurs niveaux (brief §21) — déjà en vigueur

| Niveau | Distance joueur | Véhicules IA | PNJ | Proto | UE5 cible |
|---|---|---|---|---|---|
| **Complet** | < 70 m | tick chaque frame | tick + animation chaque frame | ✅ | Actors Chaos + Mass « high » |
| **Simplifié** | 70–170 m | IA 1 frame/3 | IA 1 frame/4, pas d'anim des membres | ✅ | Mass « medium », pas de physique roues |
| **Statistique** | > 170 m | IA 1 frame/10, despawn > 340 m (pooling) | IA 1 frame/24 (avance par segments) | ✅ | Mass « low » / représentations fantômes, ZoneGraph seul |

Conséquence mesurable : le coût CPU de la simulation est **borné par le voisinage du joueur**, pas par la taille de la ville — la condition n°1 pour grandir.

## 4. Data-driven (brief §22)

Tout ce qui doit être équilibrable sans toucher au code vit dans `core.js` (proto) / Data Assets (UE5) :
- `VEHICLE_TYPES` : 7 véhicules (dimensions, perf, couleurs, poids de spawn).
- `WEATHER_STATES` : 5 météos (pluie, brouillard, grip, facteur trafic, éclairs).
- `DISTRICTS` : 6 quartiers (hauteurs, densité, palettes architecturales).
- `CFG` : taille de ville, durées, densités, seuils LOD.

Ajouter un véhicule ou un quartier = ajouter une entrée de données. C'est le contrat que devra respecter le contenu UE5 (un `UVehicleDataAsset` par véhicule).

## 5. Navigation

- **Routière** : graphe d'intersections 8×8 ; voies décalées conduite à droite ; choix de direction *greedy* vers une destination + bruit (organique, sans A* coûteux) ; feux synchronisés par axe (NS/EW) avec ligne d'arrêt ; suivi de véhicule et arrêt piéton. → UE5 : ZoneGraph (même modèle de voies, à l'échelle).
- **Piétonne** : graphe des coins de trottoirs + traversées ; plus court chemin BFS porte-à-porte ; destinations issues des **routines** (domicile/travail/loisirs par tranche horaire, travailleurs de nuit inclus). → UE5 : ZoneGraph piéton + Mass.

## 6. Gestion d'état & sauvegarde

- État de partie centralisé et sérialisable (argent, livraisons, heure, météo, position), format **versionné** (`v:1`) avec migration future par numéro. Autosave 12 s + à chaque livraison/arrestation.
- Le monde procédural est **déterministe** (RNG seedé) : une sauvegarde n'a pas à stocker la ville, seulement l'état du joueur et les deltas persistants futurs.

## 7. Structure des dossiers du dépôt

```
/web                 Vertical slice jouable (Three.js) — validation des systèmes
  /src                 core, city, vehicles, pedestrians, player,
                       environment, missions, ui, audio, save, main
/unreal              Projet Unreal Engine 5.5 (produit AAA)
  /Source/Metropolis   Public/{Core,Characters,Vehicles,Traffic,AI,
                       Weather,Missions,SaveSystem,Interaction} + Private/…
  /Config              DefaultEngine / DefaultGame / DefaultInput
/docs                Décisions, architecture, plan, risques/perf
/tools               smoke_test.mjs (tests automatisés headless)
```

Conventions de nommage : systèmes nommés par domaine (pas par techno), événements au présent nom commun (`crime`, `crash`), UE5 : préfixes Epic (`A`, `U`, `F`, `E`).

---

## Couche Assets (v0.2)

Rôle : fournir des visuels 3D réels sans jamais bloquer le jeu.

| Élément | Responsabilité |
|---|---|
| `web/assets/models/*.glb` | sources CC0 (Kenney Car Kit, Quaternius Modular Men) |
| `tools/build_assets.mjs` | encode les GLB en base64 → `web/src/assets.generated.js` (fichier unique hors-ligne) |
| `web/src/assets.js` | parsing, normalisation au mètre, indexation des roues, détection des os, animation procédurale |
| `tools/check_assets.mjs` | 103 vérifications headless : dimensions, roues, squelette, cycle de marche, intégration |

**Contrat de robustesse** : `Assets.makeVehicle()` / `makeCitizen()` renvoient `null` si le modèle
n'est pas disponible ; chaque système garde alors ses primitives. Un asset corrompu dégrade le
rendu, jamais la jouabilité. Les axes d'animation sont **mesurés** (et non supposés) en testant
la rotation de chaque os : le système fonctionne avec n'importe quel rig humanoïde.
