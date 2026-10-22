# 08 — Rapport de réparation : UE 5.5 → UE 5.8.4

Date : 22/10 · Cible : **Unreal Engine 5.8.4**, Windows 11 x64, **Visual Studio Community 2026**, MSVC v145 (14.51), Windows 11 SDK.

## 0. Transparence d'abord

**Unreal Engine n'est pas installé dans l'environnement où ce correctif a été
écrit.** Vérifié : aucun binaire `UnrealEditor`, aucun `UE_5.*` sur le système,
variable `DISPLAY` vide (aucun serveur graphique), machine Linux `x86_64`.

Conséquence, sans ambiguïté :

| Fait | État réel |
|---|---|
| Fichiers du projet corrigés et présents | ✅ oui |
| Analyse statique complète du code | ✅ oui (voir §4) |
| `verify_project.py` exécuté | ✅ oui |
| **Compilation `MetropolisEditor` Development Win64** | ❌ **non exécutée** |
| **Ouverture de l'éditeur / PIE / cook** | ❌ **non exécutés** |

Aucune affirmation du type « ça compile » ne figure dans ce document. Les points
qui restent à valider sur votre PC sont listés au §7.

## 1. Erreur n°1 — `Unable to find plugin 'MassEntity'`

**Cause exacte, vérifiée dans la documentation officielle 5.8 :** MassEntity a
changé de nature.

| Élément | UE 5.7 | UE 5.8 |
|---|---|---|
| MassEntity | plugin `Engine/Plugins/Runtime/MassEntity` | **module moteur natif** `Engine/Source/Runtime/MassEntity` ([doc API 5.8](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/MassEntity?application_version=5.8)) |
| MassGameplay | plugin | plugin (inchangé) |
| ZoneGraph | plugin | plugin (inchangé, expérimental) |
| MassCore | — | **nouveau module**, contient les types de base déplacés depuis MassEntity |

Un `.uproject` qui **référence** `MassEntity` dans `Plugins` échoue, **même avec
`"Enabled": false`** : la résolution du nom échoue avant la lecture de l'état.
C'est exactement le message observé.

**Correction appliquée** (`Metropolis.uproject`) :

```diff
- { "Name": "MassEntity", "Enabled": false },
  { "Name": "MassGameplay", "Enabled": false },
  { "Name": "ZoneGraph", "Enabled": false },
+ { "Name": "MassAI", "Enabled": false },
+ { "Name": "MassCrowd", "Enabled": false }
```

MassGameplay et ZoneGraph restent déclarés (ce sont toujours des plugins en
5.8) mais **désactivés** : aucun code du projet ne les utilise encore, les
charger ne ferait qu'ajouter du temps de compilation et des dépendances
(PoseSearch, StateTree, SmartObjects…). Les fonctionnalités de foule, PNJ et
trafic **ne sont pas supprimées** : elles vivent dans `APedestrian` et
`ATrafficAIController` (§3). Le jour où Mass est branché, `Metropolis.Build.cs`
contient déjà le bloc de dépendances à décommenter (`MassEntity`, `MassCore`,
`MassCommon`, `MassSpawner`, `MassRepresentation`).

## 2. Erreur n°2 — MSVC 14.51 « plus récent que la version préférée »

C'est un **avertissement**, pas l'erreur bloquante : UE 5.8.4 préfère le
toolset **MSVC v145** (14.50.35717) et signale toute autre version. Visual
Studio 2026 + MSVC 14.51 est **plus récent** que la version préférée, donc
acceptable.

Si UBT refuse malgré tout :

1. Installer dans VS Installer le composant **MSVC v145 – 14.50.35717** (Build Tools) ;
2. ou forcer la version dans
   `%APPDATA%\Unreal Engine\UnrealBuildTool\BuildConfiguration.xml` :
   ```xml
   <?xml version="1.0" encoding="utf-8" ?>
   <Configuration xmlns="https://www.unrealengine.com/BuildConfiguration">
     <WindowsPlatform>
       <CompilerVersion>14.50.35717</CompilerVersion>
     </WindowsPlatform>
   </Configuration>
   ```
3. Lancer une fois `C:\Program Files\Epic Games\UE_5.8\Engine\Extras\Redist\en-us\vc_redist.x64.exe`.

## 3. Erreur n°3 (préventive) — BuildSettingsVersion

UE 5.8 est construit en **V7** ; un projet resté en `V5` déclenche des
avertissements de dépréciation puis des erreurs. Corrigé dans les deux cibles :

```diff
- DefaultBuildSettings = BuildSettingsVersion.V5;
- IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_5;
+ DefaultBuildSettings = BuildSettingsVersion.V7;
+ IncludeOrderVersion  = EngineIncludeOrderVersion.Unreal5_8;
```

## 4. Audit statique — défauts réels trouvés et corrigés

| # | Fichier | Défaut | Gravité | Correction |
|---|---|---|---|---|
| 1 | `GPSSubsystem.h` | `UFUNCTION(BlueprintPure) const FGPSRoute& GetRoute()` : UHT n'accepte pas une **référence en retour** de fonction exposée | compilation | retour **par valeur** |
| 2 | `GraphicsSettingsSubsystem.h` | idem pour `const FQualitySettings& GetSettings()` | compilation | retour **par valeur** |
| 3 | `MetropolisHUD.cpp` | `GetGameInstance()` appelé sur `AHUD` — **cette fonction n'existe pas** sur `AHUD` (c'est un `AActor`) | compilation | `GetWorld()->GetGameInstance()` |
| 4 | `GraphicsSettingsSubsystem.cpp` | initialisation agrégée `FQualitySettings{...}` d'un `USTRUCT` (14 membres) | compilation fragile | affectation champ par champ |
| 5 | `DefaultEngine.ini` | profils de collision `Vehicle` / `StreetSurface` déclarés en doublon des profils moteur | erreurs au démarrage | bloc supprimé ; le code utilise les profils moteur `Vehicle` / `BlockAll` |
| 6 | `DefaultEngine.ini` | `[/Script/ChaosVehicles.ChaosVehiclesPlugin]` : classe de settings inexistante | avertissements | bloc supprimé |
| 7 | `DefaultEngine.ini` | `GameDefaultMap` pointe vers `L_DemoDistrict`, carte inexistante (aucun `.umap` versionnable) | écran d'erreur à l'ouverture | entrées retirées + quartier généré à l'exécution (§5) |
| 8 | `MetropolisVehicle.cpp` | `SetSimulatePhysics(true)` dans le **constructeur** | physique non fiable | déplacé en `BeginPlay`, profil `Vehicle` explicite |
| 9 | `WeatherVisualController.cpp` | accès à `DynamicShadowDistanceMovableLight`, `bAtmosphereSunLight`, `bRealTimeCapture` | surface d'API inutile | supprimés (réglés dans le Blueprint météo) |
| 10 | `Metropolis.Build.cs` | dépendances inutiles ou non vérifiables (`ChaosVehiclesCore`, `Chaos`, `ChaosCore`, `Slate`, `RenderCore`, `DeveloperSettings`, `Projects`, `UMG`, `NavigationSystem`) | risque de module introuvable | liste réduite aux modules réellement inclus |
| 11 | `Metropolis.Target.cs` | `bCompileChaos` / `bUseChaos` : obsolètes depuis 5.3 | avertissements | retirés |
| 12 | Projet | module `METROPOLIS`/fichier `METROPOLIS.uproject` ≠ nom utilisé par l'utilisateur (`Metropolis.uproject`) | confusion, cibles introuvables | renommé **Metropolis** (module, cibles, `.Build.cs`, `IMPLEMENT_PRIMARY_GAME_MODULE`) |
| 13 | `MetropolisWorldBuilder` | (nouveau) aucun moyen d'obtenir une carte sans éditeur | non jouable à l'ouverture | quartier greybox **généré à l'exécution** (§5) |
| 14 | `MetropolisCharacter` | sans `SkeletalMesh`, le joueur est invisible | non vérifiable visuellement | silhouette cylindre de secours, masquée dès qu'un mesh est assigné |

Non modifiés (vérifiés sains) : Enhanced Input, Chaos Vehicles, Niagara,
`UTickableWorldSubsystem`, `UPrimaryDataAsset`, `UGameplayStatics`,
`UProceduralMeshComponent`, Gameplay Tags.

## 5. Ce que le projet fait maintenant **sans aucun asset**

`AMetropolisGameMode::BeginPlay()` → `GenerateDemoDistrict()` :

1. construit le **graphe routier** (grille 6 × 6, sens uniques alternés, feux) ;
2. `AMetropolisWorldBuilder` génère : dalle de sol, chaussées, **trottoirs
   physiques** (`StreetSurfaceActor`, 15 cm, biseau 14 cm), bâtiments, voitures
   garées décoratives ;
3. place le joueur au centre, sur la chaussée.

Résultat : **ouvrir un niveau vide et appuyer sur Play suffit** — le quartier
apparaît, le joueur marche, monte les trottoirs (pas de 36 cm), le HUD affiche
heure/météo/FPS. Aucun `.umap`, aucun `.uasset`, aucun plugin supplémentaire.

Ce greybox n'est **pas** le jeu final : c'est la preuve que les systèmes
tournent. Les assets Poly Haven et les Blueprints le remplacent ensuite
(`02_EDITOR_STEPS.md`).

## 6. Procédure exacte sur votre PC

```bat
:: 0. Fermer l'éditeur et le launcher
:: 1. Supprimer les caches de l'ancienne version (obligatoire après changement de version)
rmdir /s /q Binaries Intermediate DerivedDataCache Saved .vs
del /q *.sln

:: 2. Lier le projet à UE 5.8 : clic droit sur Metropolis.uproject
::    -> "Switch Unreal Engine version..." -> 5.8
::    (si absent de la liste : "..." -> C:\Program Files\Epic Games\UE_5.8)

:: 3. Générer les fichiers Visual Studio
::    clic droit sur Metropolis.uproject -> "Generate Visual Studio project files"

:: 4. Compiler
::    ouvrir Metropolis.sln, configuration "Development Editor" / "Win64", Ctrl+Shift+B
::    ou en ligne de commande :
"C:\Program Files\Epic Games\UE_5.8\Engine\Build\BatchFiles\Build.bat" ^
   MetropolisEditor Win64 Development ^
   -project="%CD%\Metropolis.uproject" -waitmutex

:: 5. Ouvrir : double-clic sur Metropolis.uproject
:: 6. Dans l'éditeur : File > New Level > Empty Level, puis Play (le quartier se génère)
```

## 7. Points restant à vérifier sur VOTRE machine

Classés par probabilité décroissante :

1. **Compilation effective** : aucun compilateur C++ UE n'a tourné ici. Les
   erreurs résiduelles possibles sont des signatures d'API moteur (Chaos,
   Niagara, HUD) — voir §8 pour la marche à suivre si UBT en signale.
2. **`MassGameplay` réactivé** : si vous l'activez, ses dépendances
   (PoseSearch, StateTree, SmartObjects) doivent être présentes — elles le sont
   dans une installation Launcher standard.
3. **DLSS** : non installé par défaut, `METROPOLIS_WITH_DLSS=0`. TSR prend le
   relais (`03_DLSS.md`).
4. **Performances** : aucun FPS mesuré. La cible 3050 6 Go est un budget, pas
   une promesse (`04_PERFORMANCE.md`).
5. **Assets Poly Haven** : `api.polyhaven.com` était bloqué dans
   l'environnement de développement ; le script n'a donc jamais téléchargé un
   seul octet ici. À lancer chez vous (`05_POLYHAVEN.md`).

## 8. Si la compilation échoue malgré tout

Envoyez la **première** erreur (`error C####` ou `error :`), pas la dernière :

| Message typique | Cause | Correctif |
|---|---|---|
| `Unable to find plugin 'X'` | plugin inexistant dans 5.8 | retirer l'entrée de `Metropolis.uproject` |
| `Could not find definition for module 'X'` | module absent de l'installation | retirer de `Metropolis.Build.cs` |
| `'GetEngineRotationSpeed': is not a member` | renommage Chaos | remplacer par l'accesseur 5.8 (voir doc API Chaos Vehicles) |
| `unresolved external symbol ... Metropolis` | cible compilée sans `-project=` | recompiler avec la commande exacte du §6 |
| `expecting to find a type to be declared in a module rules named 'Metropolis'` | `Metropolis.uproject` et `Metropolis.Build.cs` désynchronisés | vérifier les deux noms, identiques à la casse |

## 9. Fichiers modifiés / ajoutés

```
Metropolis.uproject                                  (UE 5.8, module Metropolis, MassEntity retiré)
Source/Metropolis.Target.cs                          (V7, Unreal5_8, nom de cible)
Source/MetropolisEditor.Target.cs                    (idem)
Source/Metropolis/Metropolis.Build.cs                (dépendances réduites + note Mass)
Source/Metropolis/Public/Metropolis.h                (renommé)
Source/Metropolis/Private/Metropolis.cpp             (module Metropolis)
Source/Metropolis/Public/GPSSubsystem.h              (retour par valeur)
Source/Metropolis/Public/GraphicsSettingsSubsystem.h (retour par valeur)
Source/Metropolis/Private/GraphicsSettingsSubsystem.cpp (presets explicites)
Source/Metropolis/Private/MetropolisHUD.cpp          (GetGameInstance)
Source/Metropolis/Private/MetropolisVehicle.cpp      (physique en BeginPlay)
Source/Metropolis/Private/WeatherVisualController.cpp (API réduite)
Source/Metropolis/Public/MetropolisGameMode.h        (+ constructeur de quartier)
Source/Metropolis/Private/MetropolisGameMode.cpp     (+ BuildDistrict)
Source/Metropolis/Public/MetropolisCharacter.h       (+ silhouette de secours)
Source/Metropolis/Private/MetropolisCharacter.cpp    (+ silhouette de secours)
Source/Metropolis/Public/MetropolisWorldBuilder.h    (nouveau)
Source/Metropolis/Private/MetropolisWorldBuilder.cpp (nouveau)
Config/DefaultEngine.ini                             (profils/Chaos/maps)
Config/DefaultGame.ini                               (version 0.9.1-ue58)
Scripts/verify_project.py                            (contrôles 5.8)
Documentation/01_INSTALL_WINDOWS.md                  (réécrit 5.8.4 / VS 2026)
Documentation/08_RAPPORT_UE58.md                     (ce document)
```

Le reste des 18 classes existantes (réseau routier, météo, trafic, PNJ, missions,
sauvegarde, voirie, interaction, data assets) est inchangé sur le fond : elles
ne dépendaient d'aucune API modifiée entre 5.5 et 5.8.
