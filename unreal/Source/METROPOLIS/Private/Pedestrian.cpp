// ============================================================================
// METROPOLIS — Pedestrian.cpp
// ============================================================================
#include "Pedestrian.h"
#include "WeatherSubsystem.h"

#include "Components/StaticMeshComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Engine/World.h"
#include "CollisionQueryParams.h"

APedestrian::APedestrian()
{
	PrimaryActorTick.bCanEverTick = true;

	if (UCharacterMovementComponent* Movement = GetCharacterMovement())
	{
		Movement->MaxWalkSpeed = WalkSpeed;
		Movement->MaxStepHeight = 36.f;      // monte le trottoir
		Movement->SetWalkableFloorAngle(50.f);
		Movement->bOrientRotationToMovement = true;
		Movement->RotationRate = FRotator(0.f, 360.f, 0.f);
	}
	bUseControllerRotationYaw = false;

	// Parapluie : mesh attaché à la main, masqué au départ.
	UmbrellaMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Umbrella"));
	UmbrellaMesh->SetupAttachment(GetMesh(), TEXT("hand_r"));
	UmbrellaMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	UmbrellaMesh->SetVisibility(false);
	UmbrellaMesh->SetRelativeScale3D(FVector(0.01f));
}

void APedestrian::BeginPlay()
{
	Super::BeginPlay();

	// Collision PNJ : bloque le joueur et les véhicules, mais pas les autres
	// PNJ entre eux (sinon la foule se fige dans les couloirs).
	GetCapsuleComponent()->SetCollisionResponseToChannel(ECC_Pawn, ECR_Block);
	GetCapsuleComponent()->SetGenerateOverlapEvents(false);

	// Chaque PNJ a une silhouette et une démarche légèrement différentes :
	// sans ça, une foule « copier-coller » se voit immédiatement.
	const float Scale = FMath::FRandRange(0.94f, 1.06f);
	SetActorScale3D(FVector(Scale, Scale, FMath::FRandRange(0.97f, 1.04f)));
}

void APedestrian::SetPatrolPoints(const TArray<FVector>& Points)
{
	Patrol = Points;
	PatrolIndex = Patrol.Num() > 1 ? 1 : 0;
}

void APedestrian::UpdateWeatherReaction(float RainIntensity, float StormIntensity)
{
	const bool bShouldOpen = RainIntensity > 0.15f || StormIntensity > 0.2f;

	// Orage : les PNJ cherchent un abri (comportement différent de la pluie).
	if (StormIntensity > 0.65f && State != EPedestrianState::Sheltering)
	{
		State = EPedestrianState::Sheltering;
		if (UCharacterMovementComponent* Movement = GetCharacterMovement())
		{
			Movement->MaxWalkSpeed = RunSpeed;
		}
	}
	else if (StormIntensity <= 0.2f && State == EPedestrianState::Sheltering)
	{
		State = EPedestrianState::Walking;
		if (UCharacterMovementComponent* Movement = GetCharacterMovement())
		{
			Movement->MaxWalkSpeed = WalkSpeed;
		}
	}

	bUmbrellaOpen = bShouldOpen;
	UmbrellaMesh->SetVisibility(bShouldOpen || UmbrellaAlpha > 0.f);
}

void APedestrian::ProbeAndAvoidObstacle()
{
	// Les arbres, lampadaires et murs sont des obstacles RÉELS : on ne les
	// traverse pas. Le PNJ s'arrête et choisit un autre point.
	const UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	FHitResult Hit;
	const FVector Start = GetActorLocation();
	const FVector End = Start + GetActorForwardVector() * ObstacleProbeDistance;
	FCollisionQueryParams Params(SCENE_QUERY_STAT(PedestrianProbe), false, this);

	if (World->LineTraceSingleByChannel(Hit, Start, End, ECC_Visibility, Params))
	{
		// Contournement simple : on vire de 60° et on continue.
		const float Side = FMath::RandBool() ? 1.f : -1.f;
		SetActorRotation(GetActorRotation() + FRotator(0.f, 60.f * Side, 0.f));
		RepathTimer = 0.8f;
	}
}

void APedestrian::MoveAlongPatrol()
{
	if (Patrol.Num() == 0)
	{
		return;
	}
	const FVector Target = Patrol[PatrolIndex % Patrol.Num()];
	const FVector ToTarget = (Target - GetActorLocation()).GetSafeNormal2D();
	AddMovementInput(ToTarget, 1.f);

	if (FVector::Dist2D(GetActorLocation(), Target) < 80.f)
	{
		PatrolIndex = (PatrolIndex + 1) % Patrol.Num();
	}
}

void APedestrian::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	// Météo : le parapluie s'ouvre en douceur (0,6 s), pas instantanément.
	if (UWorld* World = GetWorld())
	{
		if (const UWeatherSubsystem* Weather = World->GetSubsystem<UWeatherSubsystem>())
		{
			const float Storm = Weather->GetWeather() == EWeatherState::Storm ? Weather->GetRainIntensity() : 0.f;
			UpdateWeatherReaction(Weather->GetRainIntensity(), Storm);
		}
	}

	const float TargetAlpha = bUmbrellaOpen ? 1.f : 0.f;
	const float Speed = UmbrellaOpenTime > 0.01f ? DeltaSeconds / UmbrellaOpenTime : 1.f;
	UmbrellaAlpha = FMath::FInterpTo(UmbrellaAlpha, TargetAlpha, DeltaSeconds, 1.f / FMath::Max(UmbrellaOpenTime, 0.01f));
	if (UmbrellaAlpha > 0.02f)
	{
		UmbrellaMesh->SetVisibility(true);
		// Échelle animée : le parapluie « pousse » au lieu de pop.
		UmbrellaMesh->SetRelativeScale3D(FVector(FMath::Lerp(0.01f, 1.f, UmbrellaAlpha)));
	}
	(void)Speed;

	RepathTimer = FMath::Max(0.f, RepathTimer - DeltaSeconds);
	if (RepathTimer <= 0.f)
	{
		ProbeAndAvoidObstacle();
		RepathTimer = 0.5f;
	}

	if (State == EPedestrianState::Sheltering)
	{
		FleeTimer = FMath::Max(0.f, FleeTimer - DeltaSeconds);
		return;   // à l'abri : immobile sous l'auvent
	}

	MoveAlongPatrol();
}
