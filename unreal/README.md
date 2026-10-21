# METROPOLIS — Projet Unreal Engine 5.5

> ⚠️ **Statut honnête (brief §29)** : ce projet a été structuré dans un environnement **sans Unreal Engine**. Le code C++ suit les API stables d'UE 5.5 et l'architecture validée par le prototype web (`../web`), mais il **n'a pas encore été compilé**. La première tâche sur un poste UE5 est le jalon « compilation propre » de la checklist ci-dessous — des ajustements mineurs d'API (includes, signatures) y sont possibles et normaux.

## Prérequis

- **Unreal Engine 5.5** (Epic Games Launcher ou build source)
- Windows : Visual Studio 2022 (workload « Développement de jeux avec C++ ») · macOS : Xcode récent
- ~10 Go libres pour le projet + DerivedDataCache

## Mise en route

1. Clic droit sur `Metropolis.uproject` → **Generate Visual Studio project files** (ou `UnrealBuildTool -projectfiles`).
2. Ouvrir `Metropolis.sln`, configuration **Development Editor**, compiler.
3. Ouvrir `Metropolis.uproject` dans l'éditeur. Au premier lancement, l'éditeur créera `Content/`, `Intermediate/`, `Saved/` (déjà ignorés par le `.gitignore` racine).

## Assets à créer dans l'éditeur (ils sont binaires, non générables en texte)

Dans l'ordre, pour rejouer la vertical slice :

### 1. Niveau de test `L_TestBlock`
- Nouveau niveau vide ; **World Settings → Enable World Partition** (convertir si proposé).
- Placer depuis l'onglet *Lights/Visual Effects* : **Directional Light** (cocher *Atmosphere Sun Light*), **Sky Atmosphere**, **Sky Light** (*Real Time Capture*), **Volumetric Cloud**, **Exponential Height Fog**.
- Placer un `ATimeOfDayManager` (il trouvera le Directional Light tout seul).
- Sol : un grand plane + 9 blocs de cubes (3×3) pour figurer les bâtiments, espacés de rues de 18 m (pitch 64 m — mêmes chiffres que le prototype).

### 2. Entrées (dossier `/Game/Input`)
Créer les Input Actions et les 2 Mapping Contexts listés dans `Config/DefaultInput.ini`, avec ces mappings :
`IA_Move` (WASD via modifiers Swizzle/Negate), `IA_Look` (souris), `IA_Jump` (Espace), `IA_Sprint` (Maj), `IA_Interact` (F), `IA_Throttle` (W=+1/S=−1), `IA_Steering` (A=−1/D=+1), `IA_Brake` (S), `IA_Handbrake` (Espace), `IA_ExitVehicle` (F).

### 3. `BP_PlayerCharacter` (dérivé de `AMetropolisCharacter`)
- Assigner `IMC_Player` + les 5 Input Actions dans les champs *Metropolis|Input*.
- Mesh temporaire : le Manny du template TPS ou une capsule — l'animation complète est une affaire de Phase 5.
- L'assigner dans *Project Settings → Maps & Modes* si vous préférez un BP au `DefaultPawnClass` déjà réglé en C++.

### 4. `BP_Vehicle_Sedan` (dérivé de `AMetropolisVehiclePawn`)
- Skeletal Mesh simple (le SUV du template *Vehicle* d'UE convient) + Physics Asset.
- 4 roues : classes dérivées de `UChaosVehicleWheel` (avant : *Affected by Steering* + *Drive*; arrière : *Drive*).
- Assigner un `UVehicleDataAsset` créé dans `/Game/Data/Vehicles` (valeurs de départ : celles de « Berline » dans `web/src/core.js`).
- Assigner `IMC_Driving` + les Input Actions de conduite.

### 5. Manager d'essai
- Placer le véhicule dans `L_TestBlock`, PIE : marcher jusqu'à lui, **F** pour entrer, conduire, **F** pour sortir.
- Régler `ATimeOfDayManager.TimeScale = 60` pour vérifier le cycle jour/nuit en accéléré.

## Correspondance avec le prototype web

| Web (`web/src/`) | UE5 (ici) | Notes de portage |
|---|---|---|
| `core.js` (données) | `VehicleDataAsset`, `MissionDataAsset`, tables dans les managers | mêmes valeurs d'équilibrage |
| `city.js` | World Partition + PCG + ZoneGraph (Phase 2) | le graph de routes devient des splines ZoneGraph |
| `vehicles.js` (physique) | Chaos Vehicles | la physique maison sert de référence de *feeling* |
| `vehicles.js` (trafic) | `UTrafficManagerSubsystem` → Mass Traffic (Phase 2) | mêmes règles spawn/despawn/LOD |
| `pedestrians.js` | `CitizenTypes` → Mass + StateTree (Phase 3) | routines identiques |
| `environment.js` | `ATimeOfDayManager` + `UWeatherManager` | mêmes courbes et états |
| `missions.js` | `UMissionManagerSubsystem` | même algorithme de génération |
| `save.js` | `UMetropolisSaveGame` | même format versionné |
| `ui.js` / `audio.js` | UMG / MetaSounds (Phase 4-5) | — |

## Checklist de validation (jalon « Phase 1 bis »)

- [ ] Les fichiers projet se génèrent sans erreur
- [ ] Build **Development Editor** propre (corriger ici les écarts d'API et les committer)
- [ ] L'éditeur ouvre le projet sans asset manquant bloquant
- [ ] `L_TestBlock` créé, PIE fonctionne, cycle jour/nuit visible
- [ ] Boucle complète : marcher → **F** → conduire un tour de bloc → **F** → descendre
- [ ] Reporter les FPS (stat unit) dans `docs/03_RISQUES_ET_PERFORMANCE.md`
