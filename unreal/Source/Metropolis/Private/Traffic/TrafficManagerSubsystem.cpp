#include "Traffic/TrafficManagerSubsystem.h"
#include "Engine/World.h"
#include "GameFramework/Pawn.h"
#include "Kismet/GameplayStatics.h"
#include "TimerManager.h"
#include "Vehicles/MetropolisVehiclePawn.h"

void UTrafficManagerSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	// Gestion a 2 Hz : le trafic de fond ne doit jamais peser sur le tick frame.
	GetWorld()->GetTimerManager().SetTimer(ManagementTimer, this,
		&UTrafficManagerSubsystem::ManagementTick, 0.5f, true, 1.0f);
}

void UTrafficManagerSubsystem::Deinitialize()
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(ManagementTimer);
	}
	Super::Deinitialize();
}

int32 UTrafficManagerSubsystem::GetTargetVehicleCount(float HourOfDay) const
{
	// Meme courbe que le prototype web (validee en jeu) :
	// nuit creuse, double pic aux heures de pointe.
	if (HourOfDay < 5.5f)  return 6;
	if (HourOfDay < 7.0f)  return 14;
	if (HourOfDay < 9.5f)  return 42;   // pointe du matin
	if (HourOfDay < 16.5f) return 28;
	if (HourOfDay < 19.5f) return 46;   // pointe du soir
	if (HourOfDay < 22.5f) return 20;
	return 8;
}

FVector UTrafficManagerSubsystem::GetPlayerLocation() const
{
	if (APawn* Pawn = UGameplayStatics::GetPlayerPawn(this, 0))
	{
		return Pawn->GetActorLocation();
	}
	return FVector::ZeroVector;
}

void UTrafficManagerSubsystem::ManagementTick()
{
	const FVector PlayerLoc = GetPlayerLocation();

	// 1) Recycler les vehicules trop lointains (pooling, zero allocation).
	for (int32 i = ActiveVehicles.Num() - 1; i >= 0; --i)
	{
		AMetropolisVehiclePawn* Vehicle = ActiveVehicles[i];
		if (!Vehicle)
		{
			ActiveVehicles.RemoveAtSwap(i);
			continue;
		}
		const float Dist = FVector::Distance(PlayerLoc, Vehicle->GetActorLocation());
		if (Dist > DespawnRadius)
		{
			Vehicle->SetActorHiddenInGame(true);
			Vehicle->SetActorEnableCollision(false);
			Vehicle->SetActorTickEnabled(false);
			PooledVehicles.Add(Vehicle);
			ActiveVehicles.RemoveAtSwap(i);
		}
		else
		{
			// LOD de simulation : au-dela du rayon simplifie, on coupe la
			// physique Chaos (la progression ZoneGraph/Mass prend le relais).
			const bool bFullSim = Dist <= SimplifiedRadius;
			Vehicle->SetActorTickEnabled(bFullSim);
		}
	}

	// 2) Spawner jusqu'a la cible, depuis le pool si possible.
	//    TODO Phase 2 : positions issues des zones ZoneGraph (voies),
	//    a distance > SpawnMinDist du joueur, hors de son champ de vision.
	//    L'algorithme de reference est celui du prototype (vehicles.js :
	//    TrafficSystem::spawnAI) : noeuds de bord de carte + direction entrante.
}
