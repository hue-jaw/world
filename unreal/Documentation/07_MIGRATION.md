# 07 — Migration WebGL → Unreal Engine 5

La version web v0.9.0 est **gelée comme référence fonctionnelle**. Chaque
système est repris, pas réinventé ; ce tableau garantit qu'aucune fonction
livrée n'est perdue.

| Système web | Fichier source | Équivalent UE5 | État |
|---|---|---|---|
| Déplacement joueur (A saute, L3 sprinte, R3 recentre) | `player.js` | `AMetropolisCharacter` + Enhanced Input | **écrit** |
| Vue 1re / 3e personne | `player.js` | `AMetropolisCharacter::ToggleView` | **écrit** |
| Véhicules (masse, suspension, boîte) | `vehicles.js` | `AMetropolisVehicle` + Chaos | **écrit** |
| Dérapage / crissement | `vehicles.js` | `OnGripUpdated` (courbe de pneu) | **écrit** (asset dans l'éditeur) |
| Trottoirs 15 cm, terre-pleins 16/18 cm, STEP_UP 36 | `contact.js` | `AStreetSurfaceActor` + `MaxStepHeight=36` | **écrit** |
| PNJ qui contournent les arbres | `pedestrians.js` | `APedestrian::ProbeAndAvoidObstacle` | **écrit** |
| Trafic (voies, feux, limitations) | `pedestrians.js` | `ATrafficAIController` + `URoadNetworkSubsystem` | **écrit** |
| GPS (graphe, A*, recalcul, manœuvres) | `gps.js` | `UGPSSubsystem` | **écrit** |
| Météo (pluie, mouillage, séchage) | `environment.js` | `UWeatherSubsystem` + `AWeatherVisualController` | **écrit** |
| Cycle jour/nuit | `environment.js` | `UWeatherSubsystem::Tick` (soleil/lune) | **écrit** |
| Réglages graphiques | `settings.js`, `postfx.js` | `UGraphicsSettingsSubsystem` | **écrit** |
| Sauvegarde v3 | `save.js` | `UMetropolisSaveGame` | **écrit** |
| Histoire / jobs | `story.js`, `jobs.js` | `UMissionSubsystem` + `UMissionDataAsset` | **écrit** |
| HUD / menus | `menu.js`, `main.js` | `AMetropolisHUD` (Canvas) + UMG (éditeur) | **partiel** |
| Textures CC0 embarquées | `assets.generated.js` | Poly Haven (CC0) + `M_Master_PBR` | **pipeline écrit** |

## Ce qui change de nature (et pourquoi c'est mieux)

| Web | UE5 |
|---|---|
| Collisions analytiques maison | Chaos : vraie physique, suspension, transfert de masse |
| Rendu par shaders réécrits à la main | Lumen + Nanite + VSM : GI et géométrie virtuelle |
| Monde unique chargé d'un coup | World Partition : streaming par cellule |
| Foule = instances de meshes | Mass Entity (extension prévue) |
| Build HTML monofichier | Cook + pak Windows |

## Ce qui est délibérément abandonné

- Le rendu `postfx.js` (GTAO/bloom maison) : remplacé par le post-process du
  moteur, supérieur et mieux profilé.
- Le serveur de preview web : sans objet.
- Les textures procédurales canvas : remplacées par les textures Poly Haven PBR.

## Compatibilité des sauvegardes

Format v3 comme en v0.9 : une sauvegarde d'une autre version est refusée
proprement (`IsCompatible()`), avec proposition de nouvelle partie.
