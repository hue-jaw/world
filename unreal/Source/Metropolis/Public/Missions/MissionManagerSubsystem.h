#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "MissionManagerSubsystem.generated.h"

class UMissionDataAsset;

UENUM(BlueprintType)
enum class EMissionPhase : uint8
{
	None,
	GoToPickup,
	GoToDropoff
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnMissionUpdated);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnMissionReward, int32, Amount);

/**
 * Gestionnaire de missions dynamiques (livraison en v1).
 * Flux : genere une mission -> marqueur monde -> pickup (rayon) ->
 * chrono -> dropoff -> recompense (+ bonus) -> mission suivante,
 * difficulte progressive. Portage direct de missions.js (valide).
 */
UCLASS()
class METROPOLIS_API UMissionManagerSubsystem : public UWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	UFUNCTION(BlueprintCallable, Category = "Metropolis|Missions")
	void StartRandomDelivery();

	UFUNCTION(BlueprintCallable, Category = "Metropolis|Missions")
	EMissionPhase GetPhase() const { return Phase; }

	UFUNCTION(BlueprintCallable, Category = "Metropolis|Missions")
	FVector GetCurrentTarget() const { return CurrentTarget; }

	UFUNCTION(BlueprintCallable, Category = "Metropolis|Missions")
	float GetTimeLeft() const { return TimeLeft; }

	UPROPERTY(BlueprintReadOnly, Category = "Metropolis|Missions")
	int32 DeliveriesCompleted = 0;

	UPROPERTY(BlueprintAssignable, Category = "Metropolis|Missions")
	FOnMissionUpdated OnMissionUpdated;

	UPROPERTY(BlueprintAssignable, Category = "Metropolis|Missions")
	FOnMissionReward OnMissionReward;

	/** Definitions utilisables par le generateur (assets MissionData). */
	UPROPERTY(EditAnywhere, Category = "Metropolis|Missions")
	TArray<TObjectPtr<UMissionDataAsset>> MissionDefinitions;

protected:
	void MissionTick();

private:
	EMissionPhase Phase = EMissionPhase::None;
	FVector PickupLocation = FVector::ZeroVector;
	FVector DropoffLocation = FVector::ZeroVector;
	FVector CurrentTarget = FVector::ZeroVector;
	int32 CurrentReward = 0;
	float TimeLeft = 0.f;
	FTimerHandle TickTimer;
};
