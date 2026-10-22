// ============================================================================
// METROPOLIS — GPSSubsystem.cpp
// ============================================================================
#include "GPSSubsystem.h"
#include "RoadNetworkSubsystem.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/Pawn.h"
#include "Engine/World.h"

void UGPSSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	ClearRoute();
}

TStatId UGPSSubsystem::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(UGPSSubsystem, STATGROUP_Tickables);
}

FVector UGPSSubsystem::GetPlayerLocation() const
{
	if (const UWorld* World = GetWorld())
	{
		if (const APlayerController* PC = World->GetFirstPlayerController())
		{
			if (const APawn* Pawn = PC->GetPawn())
			{
				return Pawn->GetActorLocation();
			}
		}
	}
	return FVector::ZeroVector;
}

void UGPSSubsystem::SetRouteMode(ERouteMode NewMode)
{
	if (Mode != NewMode)
	{
		Mode = NewMode;
		if (bHasRoute)
		{
			Recalculate();
		}
	}
}

bool UGPSSubsystem::SetDestination(const FVector& WorldLocation)
{
	Destination = WorldLocation;
	DestinationNode = INDEX_NONE;

	const URoadNetworkSubsystem* Network = GetWorld() ? GetWorld()->GetSubsystem<URoadNetworkSubsystem>() : nullptr;
	if (!Network || Network->GetNodeCount() == 0)
	{
		return false;
	}

	DestinationNode = Network->FindNearestNode(Destination, 6000.f);
	if (DestinationNode == INDEX_NONE)
	{
		return false;
	}
	return BuildRouteFrom(GetPlayerLocation());
}

void UGPSSubsystem::ClearRoute()
{
	Route = FGPSRoute();
	NextManeuver = FGPSManeuver();
	bHasRoute = false;
	RemainingMeters = 0.f;
	RemainingSeconds = 0.f;
	CurrentDeviation = 0.f;
	DestinationNode = INDEX_NONE;
	TimeSinceRecalc = 0.f;
	LastBroadcastManeuver = EGPSManeuver::None;
	LastBroadcastDistance = -1.f;
	OnRouteChanged.Broadcast(Route);
}

bool UGPSSubsystem::Recalculate()
{
	if (!bHasRoute && DestinationNode == INDEX_NONE)
	{
		return false;
	}
	const FVector From = GetPlayerLocation();
	const bool bOk = BuildRouteFrom(From);
	TimeSinceRecalc = 0.f;
	return bOk;
}

bool UGPSSubsystem::BuildRouteFrom(const FVector& FromLocation)
{
	UWorld* World = GetWorld();
	URoadNetworkSubsystem* Network = World ? World->GetSubsystem<URoadNetworkSubsystem>() : nullptr;
	if (!Network || DestinationNode == INDEX_NONE)
	{
		return false;
	}

	const int32 StartNode = Network->FindNearestNode(FromLocation, 6000.f);
	if (StartNode == INDEX_NONE)
	{
		return false;
	}

	TArray<int32> NodePath;
	if (!Network->FindPath(StartNode, DestinationNode, Mode, NodePath) || NodePath.Num() < 2)
	{
		return false;
	}

	// Polyligne : le point de départ réel du joueur, puis chaque nœud, puis la
	// destination exacte (qui peut être au milieu d'un tronçon).
	TArray<FVector> Points;
	Points.Reserve(NodePath.Num() + 2);
	Points.Add(FVector(FromLocation.X, FromLocation.Y, 0.f));
	for (const int32 NodeIndex : NodePath)
	{
		Points.Add(Network->GetNode(NodeIndex).Location);
	}
	Points.Add(FVector(Destination.X, Destination.Y, 0.f));

	// Longueur et temps : on cumule tronçon par tronçon pour utiliser les
	// limitations réelles plutôt qu'une vitesse moyenne arbitraire.
	double LengthCm = 0.0;
	double Seconds = 0.0;
	for (int32 Index = 1; Index < Points.Num(); ++Index)
	{
		const double Segment = FVector::Dist2D(Points[Index - 1], Points[Index]);
		LengthCm += Segment;
		const double Speed = 1390.0;   // cm/s (50 km/h) — affiné si l'arête est connue
		Seconds += Segment / Speed;
	}

	Route.Points = Points;
	Route.LengthMeters = LengthCm / 100.0;
	Route.ETASeconds = Seconds;
	Route.bValid = true;
	bHasRoute = true;
	RemainingMeters = static_cast<float>(Route.LengthMeters);
	RemainingSeconds = static_cast<float>(Route.ETASeconds);

	OnRouteChanged.Broadcast(Route);
	UpdateManeuver(FromLocation);
	return true;
}

float UGPSSubsystem::ProjectOnRoute(const FVector& Location, float& OutDeviation) const
{
	OutDeviation = TNumericLimits<float>::Max();
	if (Route.Points.Num() < 2)
	{
		return 0.f;
	}

	float BestDistanceAlong = 0.f;
	float Accumulated = 0.f;

	for (int32 Index = 1; Index < Route.Points.Num(); ++Index)
	{
		const FVector& A = Route.Points[Index - 1];
		const FVector& B = Route.Points[Index];
		const FVector AB = B - A;
		const float SegmentLength = static_cast<float>(AB.Size2D());
		if (SegmentLength < KINDA_SMALL_NUMBER)
		{
			continue;
		}
		const FVector AP = Location - A;
		const float T = FMath::Clamp(static_cast<float>(AP.Dot(AB) / (AB.SizeSquared2D())), 0.f, 1.f);
		const FVector Closest = A + AB * T;
		const float Deviation = static_cast<float>(FVector::Dist2D(Closest, Location));
		if (Deviation < OutDeviation)
		{
			OutDeviation = Deviation;
			BestDistanceAlong = Accumulated + SegmentLength * T;
		}
		Accumulated += SegmentLength;
	}
	return BestDistanceAlong / 100.f;   // mètres depuis le début
}

void UGPSSubsystem::UpdateManeuver(const FVector& PlayerLocation)
{
	if (!bHasRoute || Route.Points.Num() < 3)
	{
		NextManeuver = FGPSManeuver();
		return;
	}

	// Point de manœuvre : le premier nœud situé à plus de 12 m devant le joueur.
	int32 ManeuverIndex = INDEX_NONE;
	float DistanceToManeuver = 0.f;
	float Accumulated = 0.f;
	for (int32 Index = 1; Index < Route.Points.Num(); ++Index)
	{
		Accumulated += static_cast<float>(FVector::Dist2D(Route.Points[Index - 1], Route.Points[Index]));
		if (Accumulated > 1200.f)   // 12 m
		{
			ManeuverIndex = Index;
			DistanceToManeuver = Accumulated;
			break;
		}
	}

	FGPSManeuver Maneuver;
	Maneuver.DistanceMeters = DistanceToManeuver / 100.f;

	if (ManeuverIndex == INDEX_NONE || ManeuverIndex >= Route.Points.Num() - 1)
	{
		Maneuver.Type = EGPSManeuver::Arrive;
		Maneuver.DistanceMeters = RemainingMeters;
	}
	else
	{
		const FVector& Prev = Route.Points[ManeuverIndex - 1];
		const FVector& Current = Route.Points[ManeuverIndex];
		const FVector& Next = Route.Points[ManeuverIndex + 1];

		const FVector2D In(Current.X - Prev.X, Current.Y - Prev.Y);
		const FVector2D Out(Next.X - Current.X, Next.Y - Current.Y);
		const float InBearing = FMath::RadiansToDegrees(FMath::Atan2(In.Y, In.X));
		const float OutBearing = FMath::RadiansToDegrees(FMath::Atan2(Out.Y, Out.X));
		const float Delta = FMath::FindDeltaAngleDegrees(InBearing, OutBearing);

		if (FMath::Abs(Delta) < 25.f)
		{
			Maneuver.Type = EGPSManeuver::Straight;
		}
		else if (Delta >= 25.f && Delta < 110.f)
		{
			Maneuver.Type = EGPSManeuver::TurnLeft;
		}
		else if (Delta <= -25.f && Delta > -110.f)
		{
			Maneuver.Type = EGPSManeuver::TurnRight;
		}
		else if (Delta >= 110.f)
		{
			Maneuver.Type = EGPSManeuver::UTurn;
		}
		else
		{
			Maneuver.Type = EGPSManeuver::UTurn;
		}

		// Virages légers : entre 25 et 45°, on annonce un « léger ».
		if (Maneuver.Type == EGPSManeuver::TurnLeft && FMath::Abs(Delta) < 45.f)
		{
			Maneuver.Type = EGPSManeuver::SlightLeft;
		}
		else if (Maneuver.Type == EGPSManeuver::TurnRight && FMath::Abs(Delta) < 45.f)
		{
			Maneuver.Type = EGPSManeuver::SlightRight;
		}
		Maneuver.BearingAfter = FMath::Fmod(OutBearing + 360.f, 360.f);
	}

	NextManeuver = Maneuver;

	// Ne rediffuse que si le type change, ou si la distance bouge de 10 m.
	if (Maneuver.Type != LastBroadcastManeuver ||
		FMath::Abs(Maneuver.DistanceMeters - LastBroadcastDistance) > 10.f)
	{
		LastBroadcastManeuver = Maneuver.Type;
		LastBroadcastDistance = Maneuver.DistanceMeters;
		OnManeuverChanged.Broadcast(Maneuver.Type, Maneuver.DistanceMeters);
	}
}

void UGPSSubsystem::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);
	if (!bHasRoute)
	{
		return;
	}

	TimeSinceRecalc += DeltaTime;

	const FVector PlayerLocation = GetPlayerLocation();
	float Deviation = 0.f;
	const float Along = ProjectOnRoute(PlayerLocation, Deviation);
	CurrentDeviation = Deviation;

	// Distance restante = longueur totale - ce qui a déjà été parcouru.
	RemainingMeters = FMath::Max(0.f, static_cast<float>(Route.LengthMeters) - Along);
	const float Fraction = Route.LengthMeters > 0.0 ? static_cast<float>(Along / Route.LengthMeters) : 1.f;
	RemainingSeconds = FMath::Max(0.f, static_cast<float>(Route.ETASeconds) * (1.f - FMath::Clamp(Fraction, 0.f, 1.f)));

	UpdateManeuver(PlayerLocation);

	// Recalcul : écart franc ET cooldown respecté (pas de recalcul en boucle).
	if (Deviation > DeviationThreshold && TimeSinceRecalc > RecalcCooldown)
	{
		Recalculate();
	}

	if (RemainingMeters < 1400.f)   // 14 m de l'arrivée
	{
		ClearRoute();
	}
}
