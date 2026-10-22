// ============================================================================
// METROPOLIS — MissionSubsystem.cpp
// ============================================================================
#include "MissionSubsystem.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/Pawn.h"
#include "Engine/World.h"

TStatId UMissionSubsystem::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(UMissionSubsystem, STATGROUP_Tickables);
}

bool UMissionSubsystem::StartMission(UMissionDataAsset* Mission)
{
	if (!Mission || Mission->Stages.Num() == 0)
	{
		return false;
	}
	ActiveMission = Mission;
	CurrentStage = 0;
	RemainingSeconds = Mission->Stages[0].TimeLimitSeconds;
	OnStageChanged.Broadcast(0, false);
	return true;
}

void UMissionSubsystem::AbandonMission()
{
	ActiveMission = nullptr;
	CurrentStage = 0;
	RemainingSeconds = 0.f;
}

void UMissionSubsystem::CompleteStage()
{
	if (!ActiveMission)
	{
		return;
	}
	OnStageChanged.Broadcast(CurrentStage, true);

	++CurrentStage;
	if (!ActiveMission->Stages.IsValidIndex(CurrentStage))
	{
		const int32 Reward = ActiveMission->RewardCredits;
		ActiveMission = nullptr;
		OnMissionCompleted.Broadcast(Reward);
		return;
	}
	RemainingSeconds = ActiveMission->Stages[CurrentStage].TimeLimitSeconds;
	OnStageChanged.Broadcast(CurrentStage, false);
}

void UMissionSubsystem::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!ActiveMission || !ActiveMission->Stages.IsValidIndex(CurrentStage))
	{
		return;
	}

	// Le joueur n'existe pas forcément (menu, transition) : on ne force pas.
	const APlayerController* PC = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr;
	const APawn* Pawn = PC ? PC->GetPawn() : nullptr;
	if (!Pawn)
	{
		return;
	}
	LastKnownPlayerLocation = Pawn->GetActorLocation();

	const FMissionStage& Stage = ActiveMission->Stages[CurrentStage];

	if (Stage.TimeLimitSeconds > 0.f)
	{
		RemainingSeconds -= DeltaSeconds;
		if (RemainingSeconds <= 0.f)
		{
			// Échec par temps écoulé : la mission s'arrête proprement.
			AbandonMission();
			return;
		}
	}

	// Objectif de position : atteindre le rayon autour de la cible.
	if (Stage.Objective == EMissionObjective::ReachLocation ||
		Stage.Objective == EMissionObjective::DeliverPackage ||
		Stage.Objective == EMissionObjective::Explore)
	{
		if (FVector::Dist2D(LastKnownPlayerLocation, Stage.TargetLocation) <= Stage.Radius)
		{
			CompleteStage();
		}
	}
}
