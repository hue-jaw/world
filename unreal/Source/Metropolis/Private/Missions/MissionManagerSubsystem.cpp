#include "Missions/MissionManagerSubsystem.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "TimerManager.h"

void UMissionManagerSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	GetWorld()->GetTimerManager().SetTimer(TickTimer, this,
		&UMissionManagerSubsystem::MissionTick, 0.1f, true, 2.0f);
}

void UMissionManagerSubsystem::Deinitialize()
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(TickTimer);
	}
	Super::Deinitialize();
}

void UMissionManagerSubsystem::StartRandomDelivery()
{
	// TODO Phase 1bis : tirer Pickup/Dropoff depuis les points d'interet du
	// niveau (portes de batiments etiquetees via GameplayTags ou acteurs
	// AMissionPoint), avec les memes regles que le prototype :
	// pickup a > 70 m du joueur, trajet 130-430 m, recompense et chrono
	// derives de la distance (MissionDataAsset).
	Phase = EMissionPhase::GoToPickup;
	CurrentTarget = PickupLocation;
	OnMissionUpdated.Broadcast();
}

void UMissionManagerSubsystem::MissionTick()
{
	if (Phase == EMissionPhase::None)
	{
		return;
	}
	APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!Player)
	{
		return;
	}
	const float DistMeters = FVector::Distance(Player->GetActorLocation(), CurrentTarget) / 100.f;

	if (Phase == EMissionPhase::GoToPickup && DistMeters < 5.2f)
	{
		Phase = EMissionPhase::GoToDropoff;
		CurrentTarget = DropoffLocation;
		OnMissionUpdated.Broadcast();
		return;
	}
	if (Phase == EMissionPhase::GoToDropoff)
	{
		TimeLeft -= 0.1f;
		if (DistMeters < 5.2f)
		{
			DeliveriesCompleted++;
			const int32 Total = CurrentReward + FMath::Max(0, FMath::RoundToInt(TimeLeft * 1.5f));
			Phase = EMissionPhase::None;
			OnMissionReward.Broadcast(Total);
			OnMissionUpdated.Broadcast();
			// La mission suivante demarre apres un court delai (timer dedie a brancher).
		}
		else if (TimeLeft <= 0.f)
		{
			Phase = EMissionPhase::None; // echec : le joueur enchaine sur une nouvelle mission
			OnMissionUpdated.Broadcast();
		}
	}
}
