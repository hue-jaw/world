// ============================================================================
// METROPOLIS — MetropolisVehicle.cpp
// ============================================================================
#include "MetropolisVehicle.h"
#include "Vehicles/VehicleDataAsset.h"
#include "WeatherSubsystem.h"

#include "ChaosWheeledVehicleMovementComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Camera/CameraComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "InputActionValue.h"
#include "Engine/World.h"
#include "PhysicalMaterials/PhysicalMaterial.h"
#include "Engine/EngineTypes.h"

AMetropolisVehicle::AMetropolisVehicle()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickGroup = TG_PrePhysics;

	// --- Caméra de poursuite (vue par défaut, cf. v0.9) ---------------------
	CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom"));
	CameraBoom->SetupAttachment(RootComponent);
	CameraBoom->TargetArmLength = 480.f;
	CameraBoom->SocketOffset = FVector(0.f, 0.f, 90.f);
	CameraBoom->bEnableCameraLag = true;
	CameraBoom->CameraLagSpeed = 8.f;
	CameraBoom->bEnableCameraRotationLag = true;
	CameraBoom->CameraRotationLagSpeed = 12.f;
	CameraBoom->bDoCollisionTest = true;
	CameraBoom->bInheritPitch = false;
	CameraBoom->bInheritRoll = false;

	ChaseCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("ChaseCamera"));
	ChaseCamera->SetupAttachment(CameraBoom, USpringArmComponent::SocketName);
	ChaseCamera->bUsePawnControlRotation = false;
	ChaseCamera->FieldOfView = 78.f;

	// --- Physique -----------------------------------------------------------
	// Les réglages détaillés (masse, centre de gravité, rapport de boîte,
	// courbe de couple, suspension) vivent dans le Blueprint du véhicule,
	// qui hérite de cette classe. On fixe ici des valeurs cohérentes par
	// défaut : le véhicule reste pilotable même sans Blueprint.
	if (USkeletalMeshComponent* Mesh = GetMesh())
	{
		Mesh->SetCollisionProfileName(TEXT("Vehicle"));
		Mesh->SetSimulatePhysics(true);
	}
	BaseWheelFriction = 3.0f;
}

void AMetropolisVehicle::BeginPlay()
{
	Super::BeginPlay();

	// GetVehicleMovementComponent() renvoie un UPawnMovementComponent : le cast
	// est obligatoire (sans lui, la compilation échoue).
	VehicleMovement = Cast<UChaosWheeledVehicleMovementComponent>(GetVehicleMovementComponent());
	if (VehicleMovement)
	{
		VehicleMovement->bReverseAsBrake = true;
		VehicleMovement->SetThrottleInput(0.f);
	}
	else
	{
		UE_LOG(LogTemp, Error, TEXT("[Véhicule] Composant Chaos absent : le véhicule ne roulera pas."));
	}

	// Ajout du contexte de conduite au joueur local.
	if (APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		if (UEnhancedInputLocalPlayerSubsystem* InputSubsystem =
			ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PC->GetLocalPlayer()))
		{
			if (DrivingContext)
			{
				InputSubsystem->AddMappingContext(DrivingContext, 1);
			}
		}
	}
}

void AMetropolisVehicle::PossessedBy(AController* NewController)
{
	Super::PossessedBy(NewController);
	if (APlayerController* PC = Cast<APlayerController>(NewController))
	{
		if (UEnhancedInputLocalPlayerSubsystem* InputSubsystem =
			ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PC->GetLocalPlayer()))
		{
			if (DrivingContext)
			{
				InputSubsystem->AddMappingContext(DrivingContext, 1);
			}
		}
	}
}

void AMetropolisVehicle::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	if (UEnhancedInputComponent* Input = Cast<UEnhancedInputComponent>(PlayerInputComponent))
	{
		if (ThrottleAction)
		{
			Input->BindAction(ThrottleAction, ETriggerEvent::Triggered, this, &AMetropolisVehicle::OnThrottleInput);
			Input->BindAction(ThrottleAction, ETriggerEvent::Completed, this, &AMetropolisVehicle::OnThrottleInput);
		}
		if (SteerAction)
		{
			Input->BindAction(SteerAction, ETriggerEvent::Triggered, this, &AMetropolisVehicle::OnSteerInput);
			Input->BindAction(SteerAction, ETriggerEvent::Completed, this, &AMetropolisVehicle::OnSteerInput);
		}
		if (BrakeAction)
		{
			Input->BindAction(BrakeAction, ETriggerEvent::Triggered, this, &AMetropolisVehicle::OnBrakeInput);
			Input->BindAction(BrakeAction, ETriggerEvent::Completed, this, &AMetropolisVehicle::OnBrakeInput);
		}
		if (HandbrakeAction)
		{
			Input->BindAction(HandbrakeAction, ETriggerEvent::Started, this, &AMetropolisVehicle::OnHandbrakeStarted);
			Input->BindAction(HandbrakeAction, ETriggerEvent::Completed, this, &AMetropolisVehicle::OnHandbrakeCompleted);
		}
		if (CameraAction)
		{
			Input->BindAction(CameraAction, ETriggerEvent::Started, this, &AMetropolisVehicle::OnCameraInput);
		}
		if (ExitAction)
		{
			Input->BindAction(ExitAction, ETriggerEvent::Started, this, &AMetropolisVehicle::OnExitVehicle);
		}
	}
}

// ---------------------------------------------------------------------------
//                                ENTREES
// ---------------------------------------------------------------------------

void AMetropolisVehicle::OnThrottleInput(const FInputActionValue& Value)
{
	SetThrottle(Value.Get<float>());
}

void AMetropolisVehicle::OnSteerInput(const FInputActionValue& Value)
{
	SetSteering(Value.Get<float>());
}

void AMetropolisVehicle::OnBrakeInput(const FInputActionValue& Value)
{
	SetBrake(Value.Get<float>());
}

void AMetropolisVehicle::OnHandbrakeStarted()
{
	ToggleHandbrake();
}

void AMetropolisVehicle::OnHandbrakeCompleted()
{
	ToggleHandbrake();
}

void AMetropolisVehicle::OnCameraInput()
{
	CycleCamera();
}

void AMetropolisVehicle::OnExitVehicle()
{
	// La sortie réelle (pawn piéton + placement) est gérée par le
	// PlayerController, qui possède le Pawn suivant. Ici on signale l'intention
	// via un Blueprint event : aucun appel à une fonction qui pourrait ne pas
	// exister (FindFunctionChecked planterait le jeu si elle manquait).
	OnExitRequested();
}

void AMetropolisVehicle::SetThrottle(float Value)
{
	if (VehicleMovement)
	{
		VehicleMovement->SetThrottleInput(FMath::Clamp(Value, -1.f, 1.f) * EngineTorqueScale);
	}
}

void AMetropolisVehicle::SetSteering(float Value)
{
	if (VehicleMovement)
	{
		VehicleMovement->SetSteeringInput(FMath::Clamp(Value, -1.f, 1.f));
	}
}

void AMetropolisVehicle::SetBrake(float Value)
{
	if (VehicleMovement)
	{
		VehicleMovement->SetBrakeInput(FMath::Clamp(Value, 0.f, 1.f));
	}
}

void AMetropolisVehicle::ToggleHandbrake()
{
	bHandbrake = !bHandbrake;
	if (VehicleMovement)
	{
		VehicleMovement->SetHandbrakeInput(bHandbrake);
	}
}

// ---------------------------------------------------------------------------
//                                CAMERA
// ---------------------------------------------------------------------------

void AMetropolisVehicle::CycleCamera()
{
	const uint8 Next = (static_cast<uint8>(CameraMode) + 1) % 4;
	SetCameraMode(static_cast<EVehicleCameraMode>(Next));
}

void AMetropolisVehicle::SetCameraMode(EVehicleCameraMode NewMode)
{
	CameraMode = NewMode;
	CameraBlend = 0.f;

	switch (CameraMode)
	{
	case EVehicleCameraMode::Chase:
		CameraBoom->TargetArmLength = 480.f;
		CameraBoom->SocketOffset = FVector(0.f, 0.f, 90.f);
		ChaseCamera->SetRelativeLocation(FVector::ZeroVector);
		ChaseCamera->SetRelativeRotation(FRotator(-12.f, 0.f, 0.f));
		ChaseCamera->FieldOfView = 78.f;
		break;
	case EVehicleCameraMode::Hood:
		CameraBoom->TargetArmLength = 0.f;
		CameraBoom->SocketOffset = FVector(20.f, 0.f, -18.f);
		ChaseCamera->SetRelativeLocation(FVector(150.f, 0.f, 95.f));
		ChaseCamera->SetRelativeRotation(FRotator(-3.f, 0.f, 0.f));
		ChaseCamera->FieldOfView = 82.f;
		break;
	case EVehicleCameraMode::Cockpit:
		CameraBoom->TargetArmLength = 0.f;
		ChaseCamera->SetRelativeLocation(FVector(20.f, -32.f, 105.f));
		ChaseCamera->SetRelativeRotation(FRotator(-2.f, 0.f, 0.f));
		ChaseCamera->FieldOfView = 86.f;
		break;
	case EVehicleCameraMode::Orbit:
		CameraBoom->TargetArmLength = 900.f;
		CameraBoom->SocketOffset = FVector(0.f, 0.f, 200.f);
		ChaseCamera->SetRelativeLocation(FVector::ZeroVector);
		ChaseCamera->SetRelativeRotation(FRotator(-35.f, 0.f, 0.f));
		ChaseCamera->FieldOfView = 70.f;
		break;
	}
}

// ---------------------------------------------------------------------------
//                                PHYSIQUE
// ---------------------------------------------------------------------------

void AMetropolisVehicle::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	// Adhérence : météo d'abord, puis surface sous les roues.
	float GripFactor = 1.f;
	if (const UWorld* World = GetWorld())
	{
		if (const UWeatherSubsystem* Weather = World->GetSubsystem<UWeatherSubsystem>())
		{
			GripFactor = Weather->GetGripFactor();
		}
	}

	ProbeSurface();

	// Les surfaces meubles (terre-plein, gravier) réduisent un peu plus le grip
	// que l'asphalte mouillé : c'est CE qui rend le terre-plein « grimpable mais
	// glissant », au lieu d'un mur invisible.
	float SurfaceFactor = 1.f;
	if (DominantSurface == TEXT("Grass") || DominantSurface == TEXT("Dirt"))
	{
		SurfaceFactor = 0.72f;
	}
	else if (DominantSurface == TEXT("Cobblestone"))
	{
		SurfaceFactor = 0.90f;
	}
	else if (DominantSurface == TEXT("Concrete"))
	{
		SurfaceFactor = 0.96f;
	}

	ApplyWetGrip(GripFactor * SurfaceFactor);
}

void AMetropolisVehicle::ApplyWetGrip(float GripFactor)
{
	// Le frottement latéral est une propriété de la courbe de pneu Chaos
	// (asset FChaosTireConfig), pas d'une valeur C++ runtime. On diffuse donc
	// l'état au Blueprint, qui pilote la courbe. Rien n'est falsifié ici.
	OnGripUpdated(FMath::Clamp(GripFactor, 0.4f, 1.f), DominantSurface);
}

void AMetropolisVehicle::ProbeSurface()
{
	// Raycast sous le châssis : détermine la surface dominante.
	const UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	const FVector Origin = GetActorLocation();
	FHitResult Hit;
	FCollisionQueryParams Params(SCENE_QUERY_STAT(VehicleSurfaceProbe), false, this);
	Params.bReturnPhysicalMaterial = true;

	if (World->LineTraceSingleByChannel(Hit, Origin + FVector(0.f, 0.f, 50.f),
		Origin - FVector(0.f, 0.f, 220.f), ECC_Visibility, Params))
	{
		if (const UPhysicalMaterial* Material = Hit.PhysMaterial.Get())
		{
			DominantSurface = Material->GetFName();
		}
	}
}

float AMetropolisVehicle::GetSpeedKph() const
{
	// GetVelocity() est en cm/s, donc × 0.036 pour des km/h.
	return static_cast<float>(GetVelocity().Size()) * 0.036f;
}

float AMetropolisVehicle::GetEngineRPM() const
{
	if (const UChaosWheeledVehicleMovementComponent* Movement =
		Cast<UChaosWheeledVehicleMovementComponent>(GetVehicleMovementComponent()))
	{
		return Movement->GetEngineRotationSpeed();
	}
	return 0.f;
}

int32 AMetropolisVehicle::GetGear() const
{
	if (const UChaosWheeledVehicleMovementComponent* Movement =
		Cast<UChaosWheeledVehicleMovementComponent>(GetVehicleMovementComponent()))
	{
		return Movement->GetCurrentGear();
	}
	return 0;
}

// ---------------------------------------------------------------------------
//                           INTERACTION (IInteractable)
// ---------------------------------------------------------------------------

FText AMetropolisVehicle::GetInteractionPrompt_Implementation(APawn* Interactor) const
{
	return FText::FromString(TEXT("Entrer dans le véhicule"));
}

bool AMetropolisVehicle::Interact_Implementation(APawn* Interactor)
{
	// Le personnage possède déjà la logique de possession : on la déclenche
	// depuis l'interface pour que n'importe quel acteur interactif marche pareil.
	if (APlayerController* PC = Interactor ? Cast<APlayerController>(Interactor->GetController()) : nullptr)
	{
		PC->Possess(this);
		return true;
	}
	return false;
}

float AMetropolisVehicle::GetInteractionRange_Implementation() const
{
	return 350.f;
}

void AMetropolisVehicle::SetDriverVisible(bool bVisible)
{
	if (USkeletalMeshComponent* Mesh = GetMesh())
	{
		static const FName DriverBone(TEXT("Driver"));
		if (Mesh->GetBoneIndex(DriverBone) != INDEX_NONE)
		{
			Mesh->HideBoneByName(DriverBone, bVisible ? PBO_None : PBO_Term);
		}
	}
}
