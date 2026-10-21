#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "MissionDataAsset.generated.h"

/** Types de missions supportes par le gestionnaire (extensible par data). */
UENUM(BlueprintType)
enum class EMissionType : uint8
{
	Delivery   UMETA(DisplayName = "Livraison (recuperer -> livrer)"),
	Taxi       UMETA(DisplayName = "Transport de PNJ"),
	Race       UMETA(DisplayName = "Course contre la montre"),
	Emergency  UMETA(DisplayName = "Intervention d'urgence")
};

/**
 * Definition data-driven d'une mission generique (brief section 15).
 * La vertical slice utilise Delivery : la generation d'instance
 * (points de depart/arrivee, chrono, recompense) est faite par le
 * MissionManager a partir de ces bornes - meme algorithme que le
 * prototype web (missions.js), deja valide en jeu.
 */
UCLASS(BlueprintType)
class METROPOLIS_API UMissionDataAsset : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Mission")
	EMissionType Type = EMissionType::Delivery;

	UPROPERTY(EditAnywhere, Category = "Mission")
	FText DisplayName;

	/** Distance cible entre les deux points (m) - le generateur pioche dans cette plage. */
	UPROPERTY(EditAnywhere, Category = "Mission|Generation", meta = (ClampMin = 50.f))
	FVector2D DistanceRangeMeters = FVector2D(130.f, 430.f);

	/** Recompense = BaseReward + distance * RewardPerMeter (+ bonus rapidite). */
	UPROPERTY(EditAnywhere, Category = "Mission|Reward")
	int32 BaseReward = 55;

	UPROPERTY(EditAnywhere, Category = "Mission|Reward")
	float RewardPerMeter = 0.55f;

	/** Chrono = distance / 11 m/s * SlackFactor + 22 s. Diminue avec la progression. */
	UPROPERTY(EditAnywhere, Category = "Mission|Generation")
	float SlackFactor = 1.95f;

	virtual FPrimaryAssetId GetPrimaryAssetId() const override
	{
		return FPrimaryAssetId(TEXT("MissionData"), GetFName());
	}
};
