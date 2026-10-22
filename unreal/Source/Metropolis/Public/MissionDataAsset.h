// ============================================================================
// METROPOLIS — MissionDataAsset
// Missions modulaires en Data Asset : livraison, course, transport,
// exploration, sauvetage, poursuite. Le contenu se crée dans l'éditeur,
// la STRUCTURE vit ici (versionnée, relue en revue de code).
// ============================================================================
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "GameplayTagContainer.h"
#include "MetropolisTypes.h"
#include "MissionDataAsset.generated.h"

UENUM(BlueprintType)
enum class EMissionObjective : uint8
{
	ReachLocation   UMETA(DisplayName = "Atteindre un lieu"),
	DeliverPackage  UMETA(DisplayName = "Livrer un colis"),
	TransportNPC    UMETA(DisplayName = "Transporter un passager"),
	BeatTime        UMETA(DisplayName = "Battre un temps"),
	Escort          UMETA(DisplayName = "Protéger un véhicule"),
	Explore         UMETA(DisplayName = "Explorer une zone"),
	Escape          UMETA(DisplayName = "Échapper à la police"),
	Survive         UMETA(DisplayName = "Survivre"),
};

USTRUCT(BlueprintType)
struct FMissionStage
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mission") FText Description;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mission") EMissionObjective Objective = EMissionObjective::ReachLocation;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mission") FVector TargetLocation = FVector::ZeroVector;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mission") float Radius = 600.f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mission") float TimeLimitSeconds = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mission") int32 RewardCredits = 0;
};

UCLASS(BlueprintType)
class METROPOLIS_API UMissionDataAsset : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mission")
	FText Title;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mission")
	FText Briefing;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mission")
	FGameplayTag MissionType;

	/** Chapitre minimal pour débloquer la mission. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mission")
	EStoryChapter RequiredChapter = EStoryChapter::Arrival;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mission")
	TArray<FMissionStage> Stages;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mission")
	bool bRepeatable = false;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mission")
	int32 RewardCredits = 0;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mission")
	float RewardReputation = 0.f;
};
