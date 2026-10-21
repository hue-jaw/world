#include "Vehicles/MetropolisVehiclePawn.h"
#include "ChaosWheeledVehicleMovementComponent.h"
#include "Characters/MetropolisCharacter.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "Vehicles/VehicleDataAsset.h"

AMetropolisVehiclePawn::AMetropolisVehiclePawn()
{
	PrimaryActorTick.bCanEverTick = true;
	// Le mesh et les roues sont definis dans le BP derive (cf. README).
}

void AMetropolisVehiclePawn::BeginPlay()
{
	Super::BeginPlay();

	if (VehicleData && GetVehicleMovementComponent())
	{
		UChaosWheeledVehicleMovementComponent* Movement =
			Cast<UChaosWheeledVehicleMovementComponent>(GetVehicleMovementComponent());
		if (Movement)
		{
			Movement->EngineSetup.MaxTorque = VehicleData->MaxEngineTorque;
			Movement->SetRequiresControllerForInputs(false);
		}
	}
}

void AMetropolisVehiclePawn::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	// Phase 4 : effets de degats (fumee au-dela de 0.6, perte de puissance).
	// La logique lourde (IA trafic) ne vit PAS ici mais dans Mass Traffic /
	// le TrafficManagerSubsystem pour les vehicules de fond.
}

FText AMetropolisVehiclePawn::GetInteractionPrompt_Implementation(APawn* Interactor) const
{
	const FString Name = VehicleData ? VehicleData->DisplayName.ToString() : TEXT("Vehicule");
	return FText::FromString(FString::Printf(TEXT("Entrer dans le vehicule (%s)"), *Name));
}

bool AMetropolisVehiclePawn::Interact_Implementation(APawn* Interactor)
{
	AMetropolisCharacter* Driver = Cast<AMetropolisCharacter>(Interactor);
	if (!Driver || !Driver->GetController())
	{
		return false;
	}
	// Transition personnage -> vehicule : on cache le personnage et on possede le vehicule.
	LastDriver = Driver;
	Driver->SetActorHiddenInGame(true);
	Driver->SetActorEnableCollision(false);
	Driver->GetController()->Possess(this);

	if (APlayerController* PC = Cast<APlayerController>(Driver->GetController()))
	{
		if (UEnhancedInputLocalPlayerSubsystem* Subsystem =
			ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PC->GetLocalPlayer()))
		{
			Subsystem->AddMappingContext(DrivingMappingContext, 1);
		}
	}
	return true;
}

void AMetropolisVehiclePawn::OnExitVehicle()
{
	AMetropolisCharacter* Driver = LastDriver.Get();
	if (!Driver || !GetController())
	{
		return;
	}
	// Ressortir cote conducteur (gauche), comme dans le prototype.
	const FVector ExitLocation = GetActorLocation() - GetActorRightVector() * 220.f + FVector::UpVector * 60.f;
	Driver->SetActorLocation(ExitLocation);
	Driver->SetActorHiddenInGame(false);
	Driver->SetActorEnableCollision(true);
	GetController()->Possess(Driver);
	LastDriver = nullptr;
}

void AMetropolisVehiclePawn::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	if (UEnhancedInputComponent* EIC = CastChecked<UEnhancedInputComponent>(PlayerInputComponent))
	{
		EIC->BindAction(ThrottleAction, ETriggerEvent::Triggered, this, &AMetropolisVehiclePawn::OnThrottle);
		EIC->BindAction(SteeringAction, ETriggerEvent::Triggered, this, &AMetropolisVehiclePawn::OnSteering);
		EIC->BindAction(BrakeAction, ETriggerEvent::Triggered, this, &AMetropolisVehiclePawn::OnBrake);
		EIC->BindAction(HandbrakeAction, ETriggerEvent::Started, this, &AMetropolisVehiclePawn::OnHandbrakeStarted);
		EIC->BindAction(HandbrakeAction, ETriggerEvent::Completed, this, &AMetropolisVehiclePawn::OnHandbrakeCompleted);
		EIC->BindAction(ExitVehicleAction, ETriggerEvent::Started, this, &AMetropolisVehiclePawn::OnExitVehicle);
	}
}

void AMetropolisVehiclePawn::OnThrottle(const FInputActionValue& Value)
{
	GetVehicleMovementComponent()->SetThrottleInput(Value.Get<float>());
}

void AMetropolisVehiclePawn::OnSteering(const FInputActionValue& Value)
{
	GetVehicleMovementComponent()->SetSteeringInput(Value.Get<float>());
}

void AMetropolisVehiclePawn::OnBrake(const FInputActionValue& Value)
{
	GetVehicleMovementComponent()->SetBrakeInput(Value.Get<float>());
}

void AMetropolisVehiclePawn::OnHandbrakeStarted() { GetVehicleMovementComponent()->SetHandbrakeInput(true); }
void AMetropolisVehiclePawn::OnHandbrakeCompleted() { GetVehicleMovementComponent()->SetHandbrakeInput(false); }

void AMetropolisVehiclePawn::ApplyDamage(float Amount01)
{
	Damage01 = FMath::Clamp(Damage01 + Amount01, 0.f, 1.f);
	// Phase 4 : notifier le BP (deformation/materiaux) via un delegue.
}

void AMetropolisVehiclePawn::SetHeadlights(bool bOn)
{
	bHeadlightsOn = bOn;
	// Phase 4 : basculer les SpotLights + emissifs du BP derive ici.
}
