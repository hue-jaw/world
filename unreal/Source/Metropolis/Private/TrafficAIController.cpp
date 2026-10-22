// ============================================================================
// METROPOLIS — TrafficAIController.cpp
// ============================================================================
#include "TrafficAIController.h"
#include "MetropolisVehicle.h"
#include "RoadNetworkSubsystem.h"
#include "WeatherSubsystem.h"

#include "Engine/World.h"
#include "GameFramework/Pawn.h"
#include "Kismet/KismetMathLibrary.h"

ATrafficAIController::ATrafficAIController()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickInterval = 0.05f;   // 20 Hz : suffisant pour l'IA, économe en CPU
}

void ATrafficAIController::OnPossess(APawn* InPawn)
{
	Super::OnPossess(InPawn);
	ControlledVehicle = Cast<AMetropolisVehicle>(InPawn);
	PlanRoute();
}

float ATrafficAIController::ProfileSpeedFactor(EDriverProfile InProfile)
{
	switch (InProfile)
	{
	case EDriverProfile::Cautious:   return 0.82f;
	case EDriverProfile::Normal:     return 1.00f;
	case EDriverProfile::Aggressive: return 1.18f;
	case EDriverProfile::Sporty:     return 1.30f;
	case EDriverProfile::Truck:      return 0.78f;
	case EDriverProfile::Emergency:  return 1.45f;
	}
	return 1.f;
}

void ATrafficAIController::SetDriverProfile(EDriverProfile NewProfile)
{
	Profile = NewProfile;
	OvertakeChance = (Profile == EDriverProfile::Aggressive || Profile == EDriverProfile::Sporty) ? 0.45f : 0.10f;
}

bool ATrafficAIController::PlanRoute()
{
	UWorld* World = GetWorld();
	URoadNetworkSubsystem* Network = World ? World->GetSubsystem<URoadNetworkSubsystem>() : nullptr;
	if (!Network || !ControlledVehicle || Network->GetNodeCount() < 3)
	{
		return false;
	}

	const int32 Start = Network->FindNearestNode(ControlledVehicle->GetActorLocation(), 4000.f);
	if (Start == INDEX_NONE)
	{
		return false;
	}

	// Destination aléatoire à l'autre bout du quartier.
	int32 Goal = Start;
	for (int32 Attempt = 0; Attempt < 8 && Goal == Start; ++Attempt)
	{
		Goal = FMath::RandRange(0, Network->GetNodeCount() - 1);
	}

	TArray<int32> NodePath;
	if (!Network->FindPath(Start, Goal, ERouteMode::Fastest, NodePath) || NodePath.Num() < 2)
	{
		return false;
	}

	Waypoints.Reset();
	Waypoints.Reserve(NodePath.Num());
	for (const int32 NodeIndex : NodePath)
	{
		Waypoints.Add(Network->GetNode(NodeIndex).Location);
	}
	WaypointIndex = 1;   // le nœud 0 est derrière nous
	CurrentEdge = INDEX_NONE;
	return true;
}

float ATrafficAIController::GetSafeDistance() const
{
	// Formule adaptée de la règle des 2 secondes, corrigée par la météo.
	float Factor = 2.0f;
	if (const UWorld* World = GetWorld())
	{
		if (const UWeatherSubsystem* Weather = World->GetSubsystem<UWeatherSubsystem>())
		{
			Factor *= FMath::Lerp(1.0f, 1.9f, Weather->GetWetness());   // mouillé : on double
			Factor *= FMath::Lerp(1.0f, 1.35f, Weather->GetRainIntensity());
		}
	}
	const float SpeedMS = CurrentSpeed / 100.f;
	// Marche de sécurité incompressible + distance de réaction.
	return FMath::Max(600.f, SpeedMS * Factor * 100.f + 300.f);   // en cm
}

bool ATrafficAIController::IsObstacleAhead(float& OutDistance) const
{
	OutDistance = TNumericLimits<float>::Max();
	if (!ControlledVehicle)
	{
		return false;
	}
	UWorld* World = GetWorld();
	if (!World)
	{
		return false;
	}

	const FVector Start = ControlledVehicle->GetActorLocation() + FVector(0.f, 0.f, 60.f);
	const FVector End = Start + ControlledVehicle->GetActorForwardVector() * GetSafeDistance();

	FHitResult Hit;
	FCollisionQueryParams Params(SCENE_QUERY_STAT(TrafficAheadProbe), false, ControlledVehicle);
	if (World->LineTraceSingleByChannel(Hit, Start, End, ECC_Visibility, Params))
	{
		if (Hit.GetActor() != nullptr && Hit.GetActor() != ControlledVehicle)
		{
			OutDistance = static_cast<float>(Hit.Distance);
			return true;
		}
	}
	return false;
}

void ATrafficAIController::HandleTrafficLight(float DeltaSeconds)
{
	bWaitingAtLight = false;
	if (WaypointIndex <= 0 || WaypointIndex >= Waypoints.Num() || !ControlledVehicle)
	{
		return;
	}

	const URoadNetworkSubsystem* Network = GetWorld() ? GetWorld()->GetSubsystem<URoadNetworkSubsystem>() : nullptr;
	if (!Network)
	{
		return;
	}

	const int32 NodeIndex = Network->FindNearestNode(Waypoints[WaypointIndex], 500.f);
	if (NodeIndex == INDEX_NONE)
	{
		return;
	}
	const FRoadNode& Node = Network->GetNode(NodeIndex);
	if (!Node.bHasTrafficLight)
	{
		return;
	}

	const float DistanceToNode = static_cast<float>(
		FVector::Dist2D(ControlledVehicle->GetActorLocation(), Waypoints[WaypointIndex]));

	// Rouge : arrêt avant la ligne (feux à 12 s, cf. WeatherSubsystem/Tick réseau).
	if (Node.SignalPhase == 0 && DistanceToNode < 1800.f && DistanceToNode > 350.f)
	{
		bWaitingAtLight = true;
		if (CurrentSpeed < 60.f)
		{
			StopTimer += DeltaSeconds;
		}
	}
}

void ATrafficAIController::FollowRoute(float DeltaSeconds)
{
	if (!ControlledVehicle || Waypoints.Num() == 0)
	{
		return;
	}

	const FVector VehicleLocation = ControlledVehicle->GetActorLocation();

	// Avance dans la liste de points dès qu'on est assez proche.
	while (WaypointIndex < Waypoints.Num() &&
		FVector::Dist2D(VehicleLocation, Waypoints[WaypointIndex]) < ArrivalRadius)
	{
		++WaypointIndex;
	}

	if (WaypointIndex >= Waypoints.Num())
	{
		// Destination atteinte : nouvelle mission de trafic.
		if (!PlanRoute())
		{
			ControlledVehicle->SetThrottle(0.f);
			ControlledVehicle->SetBrake(1.f);
		}
		return;
	}

	// Vitesse cible : limitation de l'arête la plus proche, modulée par le
	// profil, la météo et l'angle du virage à venir.
	const URoadNetworkSubsystem* Network = GetWorld() ? GetWorld()->GetSubsystem<URoadNetworkSubsystem>() : nullptr;
	float SpeedLimit = 1390.f;
	if (Network && CurrentEdge != INDEX_NONE && Network->GetEdgeCount() > CurrentEdge)
	{
		SpeedLimit = Network->GetEdge(CurrentEdge).SpeedLimit;
	}

	float WeatherFactor = 1.f;
	if (const UWeatherSubsystem* Weather = GetWorld()->GetSubsystem<UWeatherSubsystem>())
	{
		WeatherFactor = FMath::Lerp(1.f, 0.65f, Weather->GetWetness());
	}

	TargetSpeed = SpeedLimit * ProfileSpeedFactor(Profile) * WeatherFactor;

	// Freinage avant un virage serré : on ralentit proportionnellement à l'angle.
	if (WaypointIndex + 1 < Waypoints.Num())
	{
		const FVector& A = Waypoints[WaypointIndex - 1];
		const FVector& B = Waypoints[WaypointIndex];
		const FVector& C = Waypoints[WaypointIndex + 1];
		const FVector In = (B - A).GetSafeNormal2D();
		const FVector Out = (C - B).GetSafeNormal2D();
		const float Dot = static_cast<float>(In | Out);
		const float TurnSeverity = FMath::Clamp((1.f - Dot) * 0.5f, 0.f, 1.f);   // 0 = tout droit
		TargetSpeed *= FMath::Lerp(1.f, 0.42f, TurnSeverity);
	}

	// Obstacle / feu : freinage.
	float ObstacleDistance = 0.f;
	if (IsObstacleAhead(ObstacleDistance))
	{
		const float Ratio = FMath::Clamp(ObstacleDistance / FMath::Max(GetSafeDistance(), 1.f), 0.f, 1.f);
		TargetSpeed = FMath::Min(TargetSpeed, FMath::Lerp(0.f, TargetSpeed, Ratio));
	}

	HandleTrafficLight(DeltaSeconds);
	if (bWaitingAtLight)
	{
		TargetSpeed = 0.f;
	}

	// Direction : on vise le point de passage, avec une anticipation.
	const FVector ToTarget = Waypoints[WaypointIndex] - VehicleLocation;
	const float TargetYaw = ToTarget.Rotation().Yaw;
	const float CurrentYaw = ControlledVehicle->GetActorRotation().Yaw;
	const float YawError = FMath::FindDeltaAngleDegrees(CurrentYaw, TargetYaw);

	// Gain proportionnel + dérivée : évite les oscillations du volant.
	const float Steering = FMath::Clamp(YawError / 45.f, -1.f, 1.f);
	ControlledVehicle->SetSteering(Steering);

	// Accélérateur/frein : asservissement de vitesse simple et stable.
	if (CurrentSpeed < TargetSpeed)
	{
		ControlledVehicle->SetThrottle(FMath::Clamp((TargetSpeed - CurrentSpeed) / 400.f, 0.05f, 1.f));
		ControlledVehicle->SetBrake(0.f);
	}
	else
	{
		ControlledVehicle->SetThrottle(0.f);
		ControlledVehicle->SetBrake(FMath::Clamp((CurrentSpeed - TargetSpeed) / 600.f, 0.f, 1.f));
	}
}

void ATrafficAIController::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	if (!ControlledVehicle)
	{
		return;
	}
	// Km/h → cm/s : ×1000/36. On lit la vitesse réelle du véhicule physique.
	CurrentSpeed = ControlledVehicle->GetSpeedKph() * 27.7778f;

	FollowRoute(DeltaSeconds);
}
