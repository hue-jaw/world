# METROPOLIS — projet Unreal Engine 5.8.4

Projet **Unreal Engine 5.8.4** (Windows 11 x64, VS Community 2026) issu de la migration du prototype WebGL v0.9.0,
gelé à la racine du dépôt comme référence fonctionnelle.

```bash
python3 Scripts/verify_project.py    # 269 contrôles statiques, 0 échec
node ../tools/test_unreal_project.mjs # 55 contrôles d'intégration, 0 échec
```

## Contenu réel

| Élément | Détail |
|---|---|
| `Metropolis.uproject` | UE **5.8**, module `Metropolis`, plugins Chaos / Enhanced Input / Niagara / ProceduralMesh / Python |
| `Source/Metropolis/` | **19 classes** exportées (18 `UCLASS` + 1 interface), tableau ci-dessous |
| `Config/` | `DefaultEngine.ini` (Lumen, Nanite, VSM, VRAM 6 Go), `DefaultGame.ini`, `DefaultInput.ini` |
| `Scripts/` | client Poly Haven, synchronisation, import éditeur, **vérificateur** |
| `Documentation/` | 8 documents : installation, étapes éditeur, DLSS, perf, Poly Haven, tests, migration |
| `Content/` | **vide de binaires** — tout asset se crée dans l'éditeur (voir `Content/README.md`) |

## Les classes

| Classe | Rôle |
|---|---|
| `URoadNetworkSubsystem` | graphe routier, A*, sens uniques, feux, congestion |
| `UGPSSubsystem` | itinéraire, manœuvres, recalcul avec anti-rebond |
| `UWeatherSubsystem` | météo, mouillage/séchage, cycle jour-nuit, adhérence |
| `UGraphicsSettingsSubsystem` | 4 profils + personnalisé, DLSS/TSR, télémétrie mesurée |
| `AMetropolisVehicle` | véhicule Chaos, caméras, surfaces, `IInteractable` |
| `AMetropolisCharacter` | joueur, pas de 36 cm, sprint, entrée véhicule |
| `AStreetSurfaceActor` | trottoirs/terre-pleins **physiques** chanfreinés |
| `ATrafficAIController` | trafic sur graphe, feux, 6 profils de conducteurs |
| `APedestrian` | PNJ piétons, parapluie, contournement des arbres |
| `AWeatherVisualController` | soleil/lune, brouillard, pluie Niagara, MPC |
| `UMissionSubsystem` | étapes, chrono, récompenses |
| `UMetropolisSaveGame` | sauvegarde v3 avec refus des versions incompatibles |
| `AMetropolisHUD` | HUD Canvas sans asset (vitesse, GPS, météo, FPS mesurés) |
| `AMetropolisPlayerController` | sauvegarde, pause, sortie de véhicule, HUD |
| `AMetropolisGameMode` | spawn sûr, génération du quartier, sauvegarde |
| `AMetropolisWorldBuilder` | quartier greybox jouable généré à l'exécution (aucun asset requis) |
| `IInteractable` / `UVehicleDataAsset` / `FCitizenIdentity` | interaction, véhicules et citoyens data-driven |

## Ce qui exige l'éditeur

Carte, Blueprints, matériaux, Niagara, Enhanced Input assets, cook :
`Documentation/02_EDITOR_STEPS.md`, dans l'ordre.

## Compatibilité UE 5.8.4 — ce qui a été réparé

- `MassEntity` retiré des plugins : c'est un **module moteur natif** depuis 5.8
  (`Engine/Source/Runtime/MassEntity`). C'était la cause exacte de
  « Unable to find plugin 'MassEntity' ».
- Cibles passées en `BuildSettingsVersion.V7` + `EngineIncludeOrderVersion.Unreal5_8`.
- Projet renommé `Metropolis` (fichier, module, cibles) pour correspondre au nom
  attendu par Unreal et par votre installation.
- Deux `UFUNCTION` renvoyant des références, un `GetGameInstance()` invalide sur
  `AHUD`, une initialisation agrégée de `USTRUCT`, des profils de collision en
  doublon : corrigés (détail et tableau complet dans
  `Documentation/08_RAPPORT_UE58.md`).

## Avertissement

Le code C++ **n'a pas été compilé** dans l'environnement de développement
automatisé (Unreal Editor absent, aucun GPU) : **Unreal Engine 5.8.4 n'y est pas
installé**. Il est vérifié statiquement (règles UHT, includes, équilibrage des
blocs, cohérence des cibles et des configs). Les points restant à valider sur
votre PC sont listés au §7 de `Documentation/08_RAPPORT_UE58.md` ; les 10 tests
moteur sont **non déclarés réussis** (`Documentation/06_TESTS.md`).
