#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "VehicleDataAsset.generated.h"

class USkeletalMesh;
class UChaosVehicleWheel;

/**
 * Definition data-driven d'un vehicule (miroir de VEHICLE_TYPES du
 * prototype web, web/src/core.js). Ajouter un vehicule au jeu =
 * creer un asset de ce type + un BP derive d'AMetropolisVehiclePawn,
 * sans toucher au C++.
 */
UCLASS(BlueprintType)
class METROPOLIS_API UVehicleDataAsset : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Vehicle")
	FText DisplayName;

	UPROPERTY(EditAnywhere, Category = "Vehicle")
	TObjectPtr<USkeletalMesh> BodyMesh;

	/** Vitesse maxi indicative (km/h) - affichage + equilibrage trafic. */
	UPROPERTY(EditAnywhere, Category = "Vehicle|Performance", meta = (ClampMin = 10, ClampMax = 400))
	float TopSpeedKmh = 140.f;

	UPROPERTY(EditAnywhere, Category = "Vehicle|Performance", meta = (ClampMin = 1000))
	float MaxEngineTorque = 4500.f;

	/** Poids relatif dans la table de spawn du trafic (0 = jamais par hasard). */
	UPROPERTY(EditAnywhere, Category = "Vehicle|Traffic", meta = (ClampMin = 0))
	int32 TrafficWeight = 10;

	UPROPERTY(EditAnywhere, Category = "Vehicle|Traffic")
	bool bIsEmergencyVehicle = false;

	UPROPERTY(EditAnywhere, Category = "Vehicle|Traffic")
	TArray<FLinearColor> PaintColors;

	virtual FPrimaryAssetId GetPrimaryAssetId() const override
	{
		return FPrimaryAssetId(TEXT("VehicleData"), GetFName());
	}
};
