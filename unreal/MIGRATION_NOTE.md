# Note de fusion — 22/10

Un premier squelette UE5 (module `Metropolis`, 8 classes, UE 5.5) existait à cet
emplacement depuis le début de journée. Il est **remplacé** par l'implémentation
complète du chantier V3, pour éviter deux projets concurrents dans le même
dossier (deux `.uproject`, deux modules, deux `Config/`).

## Conservé du squelette

| Élément | Devenir |
|---|---|
| `IInteractable` (interface d'interaction) | conservé, implémenté par `AMetropolisVehicle` |
| `UVehicleDataAsset` (fiche véhicule data-driven) | conservé, référencé par `AMetropolisVehicle` |
| `FCitizenIdentity` / `ECitizenActivity` (types citoyens) | conservés pour l'extension Mass Entity |
| Intention UE 5.5 + MassEntity/ZoneGraph | reprise : `EngineAssociation 5.5`, plugins Masse déclarés (désactivés tant que non utilisés) |

## Remplacé (fonctionnalité reprise en plus complet)

| Squelette | Remplacé par |
|---|---|
| `MetropolisCharacter` | `AMetropolisCharacter` (pas de 36 cm, vues, véhicule, Enhanced Input) |
| `MetropolisGameMode` | `AMetropolisGameMode` (spawn sûr, génération du quartier, sauvegarde) |
| `MetropolisVehiclePawn` | `AMetropolisVehicle` (Chaos, surfaces, météo, caméras, interaction) |
| `WeatherManager` + `TimeOfDayManager` | `UWeatherSubsystem` + `AWeatherVisualController` |
| `TrafficManagerSubsystem` | `URoadNetworkSubsystem` + `ATrafficAIController` (physique réelle) |
| `MissionManagerSubsystem` + `MissionDataAsset` | `UMissionSubsystem` + `UMissionDataAsset` |
| `MetropolisSaveGame` | `UMetropolisSaveGame` (v3, contrôle de compatibilité) |

Aucun système du squelette n'a été perdu : les trois éléments conservés sont
dans `Source/METROPOLIS/Public/{Interaction,Vehicles,AI}/`.
