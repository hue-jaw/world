# 01 — Installation Windows (UE 5.5)

## Prérequis matériels

| Élément | Minimum | Recommandé |
|---|---|---|
| GPU | RTX 3050 6 Go (cible du projet) | RTX 4070+ pour le RT complet |
| RAM | 16 Go | 32 Go |
| Disque | 40 Go libres (UE + projet) | SSD NVMe |
| OS | Windows 10 22H2 / 11 | Windows 11 |

La cible de référence du cahier des charges est **RTX 3050 6 Go, 1920×1080**.
Le projet est réglé pour que ce soit la configuration « Élevé + DLSS Qualité »,
pas « Ultra + RT ». Voir `04_PERFORMANCE.md`.

## Logiciels

1. **Unreal Engine 5.5** via l'Epic Games Launcher (pas 5.3 : le code utilise
   `BuildSettingsVersion.V5` et `EngineIncludeOrderVersion.Unreal5_5`).
2. **Visual Studio 2022** avec la charge de travail *Développement de jeux en
   C++* (MSVC v143, Windows SDK 10.0.22621+).
3. **.NET 6 SDK** (génération des *Unreal Build Tool* si nécessaire).

## Compilation

```bat
:: Depuis la racine du projet
"C:\Program Files\Epic Games\UE_5.5\Engine\Build\BatchFiles\Build.bat" ^
   METROPOLISEditor Win64 Development ^
   -project="%CD%\METROPOLIS.uproject" -waitmutex
```

Ou, plus simplement :

1. clic droit sur `METROPOLIS.uproject` → **Generate Visual Studio project files** ;
2. ouvrir `METROPOLIS.sln`, configuration **Development Editor / Win64** ;
3. `Ctrl+Shift+B`.

## Première ouverture

L'éditeur affichera une erreur de carte manquante (`L_DemoDistrict` n'existe
pas encore : c'est normal, aucun `.umap` n'est versionné). Suivre
`02_EDITOR_STEPS.md`, étape 1.

## Packaging

```bat
"C:\Program Files\Epic Games\UE_5.5\Engine\Build\BatchFiles\RunUAT.bat" ^
   BuildCookRun -project="%CD%\METROPOLIS.uproject" -noP4 -platform=Win64 ^
   -clientconfig=Shipping -cook -allmaps -build -stage -pak -archive ^
   -archivedirectory="%CD%\Build"
```

La configuration de packaging est déjà dans `Config/DefaultGame.ini`
(`UsePakFile`, `bUseIoStore`, `bCompressed`, cook de `/Game/Maps` et
`/Game/PolyHaven`).

## Vérification avant de lancer l'éditeur

```bash
python3 Scripts/verify_project.py
```

Doit afficher `VERIFICATION UNREAL : N ✓ / 0 échec`.
