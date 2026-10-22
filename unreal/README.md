# METROPOLIS — projet Unreal Engine 5.5

Projet **UE5.5** (Windows x64) issu de la migration du prototype WebGL v0.9.0,
gelé à la racine du dépôt comme référence fonctionnelle.

```bash
python3 Scripts/verify_project.py    # 251 contrôles statiques, 0 échec
node ../tools/test_unreal_project.mjs # 51 contrôles d'intégration, 0 échec
```

## Contenu réel

| Élément | Détail |
|---|---|
| `METROPOLIS.uproject` | UE 5.5, module `METROPOLIS`, plugins Chaos/Enhanced Input/Niagara/Python |
| `Source/METROPOLIS/` | 18 classes C++ (17 UCLASS + 1 interface), tableau ci-dessous |
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
| `IInteractable` / `UVehicleDataAsset` / `FCitizenIdentity` | interaction, véhicules et citoyens data-driven |

## Ce qui exige l'éditeur

Carte, Blueprints, matériaux, Niagara, Enhanced Input assets, cook :
`Documentation/02_EDITOR_STEPS.md`, dans l'ordre.

## Avertissement

Le code C++ **n'a pas été compilé** dans l'environnement de développement
automatisé (Unreal Editor absent, aucun GPU). Il est vérifié statiquement
(règles UHT, includes, équilibrage des blocs, cohérence des configs). Les 10
tests moteur du cahier des charges sont listés et **non déclarés réussis** :
`Documentation/06_TESTS.md`.
