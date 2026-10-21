#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "TrafficManagerSubsystem.generated.h"

class AMetropolisVehiclePawn;
class UVehicleDataAsset;

/**
 * Gestionnaire de trafic de fond (brief sections 6 et 21).
 * Responsabilites :
 *  - maintenir une densite de vehicules ciblee selon l'heure (heures de pointe),
 *  - spawner loin du joueur, despawner/recycler au-dela d'une distance
 *    (object pooling : aucune allocation pendant la conduite),
 *  - appliquer le LOD de simulation : complet pres du joueur,
 *    simplifie a mi-distance, statistique au loin.
 *
 * Phase 2 : la progression des vehicules distants bascule sur Mass Traffic
 * (ZoneGraph) ; seuls les vehicules proches deviennent des acteurs Chaos.
 * Cet ecran de gestion (spawn/despawn/budgets) reste identique - c'est
 * exactement le decoupage valide par le prototype web (vehicles.js).
 */
UCLASS()
class METROPOLIS_API UTrafficManagerSubsystem : public UWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	/** Densite cible selon l'heure (miroir de la courbe du prototype). */
	UFUNCTION(BlueprintCallable, Category = "Metropolis|Traffic")
	int32 GetTargetVehicleCount(float HourOfDay) const;

	UFUNCTION(BlueprintCallable, Category = "Metropolis|Traffic")
	int32 GetActiveVehicleCount() const { return ActiveVehicles.Num(); }

	/** Classes de vehicules autorisees au spawn (BP derives + leurs DataAssets). */
	UPROPERTY(EditAnywhere, Category = "Metropolis|Traffic")
	TArray<TSubclassOf<AMetropolisVehiclePawn>> TrafficVehicleClasses;

	/** Distances de LOD de simulation (cm) - brief section 21. */
	UPROPERTY(EditAnywhere, Category = "Metropolis|Traffic|LOD")
	float FullSimulationRadius = 7000.f;

	UPROPERTY(EditAnywhere, Category = "Metropolis|Traffic|LOD")
	float SimplifiedRadius = 17000.f;

	UPROPERTY(EditAnywhere, Category = "Metropolis|Traffic|LOD")
	float DespawnRadius = 34000.f;

protected:
	/** Tick de gestion basse frequence (0.5 s) : equilibre la population. */
	void ManagementTick();

	FVector GetPlayerLocation() const;

private:
	UPROPERTY()
	TArray<TObjectPtr<AMetropolisVehiclePawn>> ActiveVehicles;

	UPROPERTY()
	TArray<TObjectPtr<AMetropolisVehiclePawn>> PooledVehicles;

	FTimerHandle ManagementTimer;
};
