// ============================================================================
// METROPOLIS — MissionSubsystem
// Suivi des missions en cours : étapes, chrono, récompenses.
// Aucune UI ici : le HUD lit l'état.
// ============================================================================
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "MissionDataAsset.h"
#include "MissionSubsystem.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FMissionStageChanged, int32, StageIndex, bool, bCompleted);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FMissionCompleted, int32, RewardCredits);

UCLASS()
class METROPOLIS_API UMissionSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual void Tick(float DeltaSeconds) override;
	virtual TStatId GetStatId() const override;

	UFUNCTION(BlueprintCallable, Category = "Missions")
	bool StartMission(UMissionDataAsset* Mission);

	UFUNCTION(BlueprintCallable, Category = "Missions")
	void AbandonMission();

	UFUNCTION(BlueprintPure, Category = "Missions")
	bool IsMissionActive() const { return ActiveMission != nullptr; }

	UFUNCTION(BlueprintPure, Category = "Missions")
	int32 GetCurrentStageIndex() const { return CurrentStage; }

	UFUNCTION(BlueprintPure, Category = "Missions")
	float GetRemainingSeconds() const { return RemainingSeconds; }

	UPROPERTY(BlueprintAssignable, Category = "Missions")
	FMissionStageChanged OnStageChanged;

	UPROPERTY(BlueprintAssignable, Category = "Missions")
	FMissionCompleted OnMissionCompleted;

private:
	void CompleteStage();

	UPROPERTY()
	TObjectPtr<UMissionDataAsset> ActiveMission;

	int32 CurrentStage = 0;
	float RemainingSeconds = 0.f;
	FVector LastKnownPlayerLocation = FVector::ZeroVector;
};
