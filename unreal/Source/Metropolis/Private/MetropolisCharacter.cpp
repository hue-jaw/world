// ============================================================================
// METROPOLIS — MetropolisCharacter.cpp
// ============================================================================
#include "MetropolisCharacter.h"
#include "MetropolisVehicle.h"

#include "Camera/CameraComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/PlayerController.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "InputActionValue.h"
#include "Engine/World.h"
#include "Kismet/KismetSystemLibrary.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "UObject/ConstructorHelpers.h"

AMetropolisCharacter::AMetropolisCharacter()
{
	PrimaryActorTick.bCanEverTick = true;

	// --- Marche -------------------------------------------------------------
	// 36 cm : le trottoir (15 cm) et le terre-plein (16 cm) se montent sans
	// saut, comme en v0.9 (STEP_UP = 0,36).
	if (UCharacterMovementComponent* Movement = GetCharacterMovement())
	{
		Movement->MaxWalkSpeed = WalkSpeed;
		Movement->MaxStepHeight = 36.f;
		Movement->SetWalkableFloorAngle(50.f);
		Movement->JumpZVelocity = 420.f;
		Movement->AirControl = 0.35f;
		Movement->BrakingDecelerationWalking = 1400.f;
		Movement->bOrientRotationToMovement = true;
		Movement->RotationRate = FRotator(0.f, 540.f, 0.f);
	}
	bUseControllerRotationYaw = false;

	// --- Caméra -------------------------------------------------------------
	CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom"));
	CameraBoom->SetupAttachment(GetRootComponent());
	CameraBoom->TargetArmLength = 340.f;
	CameraBoom->SocketOffset = FVector(0.f, 0.f, 70.f);
	CameraBoom->bUsePawnControlRotation = true;
	CameraBoom->bEnableCameraLag = true;
	CameraBoom->CameraLagSpeed = 14.f;

	// Silhouette de secours : cylindre moteur, visible seulement sans mesh.
	FallbackBody = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("FallbackBody"));
	FallbackBody->SetupAttachment(GetCapsuleComponent());
	static ConstructorHelpers::FObjectFinder<UStaticMesh> CylinderFinder(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	if (CylinderFinder.Succeeded())
	{
		FallbackBody->SetStaticMesh(CylinderFinder.Object);
	}
	FallbackBody->SetRelativeScale3D(FVector(0.42f, 0.42f, 0.92f));
	FallbackBody->SetRelativeLocation(FVector(0.f, 0.f, 0.f));
	FallbackBody->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	FallbackBody->SetCastShadow(true);

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(CameraBoom, USpringArmComponent::SocketName);
	Camera->bUsePawnControlRotation = false;
	Camera->FieldOfView = 82.f;
}

void AMetropolisCharacter::BeginPlay()
{
	Super::BeginPlay();

	if (APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		if (UEnhancedInputLocalPlayerSubsystem* InputSubsystem =
			ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PC->GetLocalPlayer()))
		{
			if (DefaultContext)
			{
				InputSubsystem->AddMappingContext(DefaultContext, 0);
			}
		}
	}
	SetSprinting(false);

	// Un vrai mesh (BP_MetropolisCharacter) remplace la silhouette de secours.
	if (FallbackBody)
	{
		const bool bHasRealMesh = GetMesh() && GetMesh()->GetSkeletalMeshAsset() != nullptr;
		FallbackBody->SetVisibility(!bHasRealMesh);
	}
}

void AMetropolisCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	if (UEnhancedInputComponent* Input = Cast<UEnhancedInputComponent>(PlayerInputComponent))
	{
		if (MoveAction)
		{
			Input->BindAction(MoveAction, ETriggerEvent::Triggered, this, &AMetropolisCharacter::OnMove);
			Input->BindAction(MoveAction, ETriggerEvent::Completed, this, &AMetropolisCharacter::OnMove);
		}
		if (LookAction)
		{
			Input->BindAction(LookAction, ETriggerEvent::Triggered, this, &AMetropolisCharacter::OnLook);
		}
		if (JumpAction)
		{
			Input->BindAction(JumpAction, ETriggerEvent::Started, this, &AMetropolisCharacter::OnJumpPressed);
		}
		if (SprintAction)
		{
			Input->BindAction(SprintAction, ETriggerEvent::Started, this, &AMetropolisCharacter::OnSprintStarted);
			Input->BindAction(SprintAction, ETriggerEvent::Completed, this, &AMetropolisCharacter::OnSprintCompleted);
		}
		if (RecenterAction)
		{
			Input->BindAction(RecenterAction, ETriggerEvent::Started, this, &AMetropolisCharacter::OnRecentered);
		}
		if (InteractAction)
		{
			Input->BindAction(InteractAction, ETriggerEvent::Started, this, &AMetropolisCharacter::OnInteractPressed);
		}
		if (ViewAction)
		{
			Input->BindAction(ViewAction, ETriggerEvent::Started, this, &AMetropolisCharacter::OnToggleViewPressed);
		}
	}

	// Repli si les assets Enhanced Input n'existent pas encore : sans lui, un
	// projet fraîchement compilé n'aurait AUCUNE commande (le joueur ne
	// pourrait même pas marcher). Les deux systèmes peuvent coexister.
	if (!MoveAction && !LookAction)
	{
		PlayerInputComponent->BindAxis(TEXT("MoveForward"), this, &AMetropolisCharacter::LegacyMoveForward);
		PlayerInputComponent->BindAxis(TEXT("MoveRight"), this, &AMetropolisCharacter::LegacyMoveRight);
		PlayerInputComponent->BindAxis(TEXT("Turn"), this, &AMetropolisCharacter::LegacyTurn);
		PlayerInputComponent->BindAxis(TEXT("LookUp"), this, &AMetropolisCharacter::LegacyLookUp);
		PlayerInputComponent->BindAction(TEXT("Jump"), IE_Pressed, this, &AMetropolisCharacter::LegacyJumpPressed);
		PlayerInputComponent->BindAction(TEXT("Sprint"), IE_Pressed, this, &AMetropolisCharacter::LegacySprintPressed);
		PlayerInputComponent->BindAction(TEXT("Sprint"), IE_Released, this, &AMetropolisCharacter::LegacySprintReleased);
		PlayerInputComponent->BindAction(TEXT("Interact"), IE_Pressed, this, &AMetropolisCharacter::LegacyInteractPressed);
		PlayerInputComponent->BindAction(TEXT("ToggleView"), IE_Pressed, this, &AMetropolisCharacter::LegacyViewPressed);
	}
}

// ---------------------------------------------------------------------------
//                        REPLI CLAVIER / SOURIS
// ---------------------------------------------------------------------------

void AMetropolisCharacter::LegacyMoveForward(float Value)
{
	if (!FMath::IsNearlyZero(Value))
	{
		ApplyMove(FVector2D(0.f, Value));
	}
}

void AMetropolisCharacter::LegacyMoveRight(float Value)
{
	if (!FMath::IsNearlyZero(Value))
	{
		ApplyMove(FVector2D(Value, 0.f));
	}
}

void AMetropolisCharacter::LegacyTurn(float Value)
{
	ApplyLook(FVector2D(Value, 0.f));
}

void AMetropolisCharacter::LegacyLookUp(float Value)
{
	ApplyLook(FVector2D(0.f, Value));
}

void AMetropolisCharacter::LegacyJumpPressed()    { OnJumpPressed(); }
void AMetropolisCharacter::LegacySprintPressed()  { OnSprintStarted(); }
void AMetropolisCharacter::LegacySprintReleased() { OnSprintCompleted(); }
void AMetropolisCharacter::LegacyInteractPressed(){ OnInteractPressed(); }
void AMetropolisCharacter::LegacyViewPressed()    { OnToggleViewPressed(); }

// ---------------------------------------------------------------------------
//                                ENTREES
// ---------------------------------------------------------------------------

void AMetropolisCharacter::OnMove(const FInputActionValue& Value)
{
	ApplyMove(Value.Get<FVector2D>());
}

void AMetropolisCharacter::ApplyMove(const FVector2D& Axis)
{
	if (!Controller || Axis.IsNearlyZero())
	{
		return;
	}

	// Déplacement relatif à la caméra : W = là où l'on regarde.
	const FRotator YawRotation(0.f, Controller->GetControlRotation().Yaw, 0.f);
	const FVector Forward = FRotationMatrix(YawRotation).GetUnitAxis(EAxis::X);
	const FVector Right = FRotationMatrix(YawRotation).GetUnitAxis(EAxis::Y);

	AddMovementInput(Forward, Axis.Y);
	AddMovementInput(Right, Axis.X);
}

void AMetropolisCharacter::OnLook(const FInputActionValue& Value)
{
	ApplyLook(Value.Get<FVector2D>());
}

void AMetropolisCharacter::ApplyLook(const FVector2D& Axis)
{
	AddControllerYawInput(Axis.X * LookSensitivity);
	AddControllerPitchInput(Axis.Y * LookSensitivity);
}

void AMetropolisCharacter::OnJumpPressed()
{
	Jump();
}

void AMetropolisCharacter::SetSprinting(bool bNewSprinting)
{
	bSprinting = bNewSprinting;
	if (UCharacterMovementComponent* Movement = GetCharacterMovement())
	{
		Movement->MaxWalkSpeed = bSprinting ? SprintSpeed : WalkSpeed;
	}
}

void AMetropolisCharacter::OnSprintStarted() { SetSprinting(true); }
void AMetropolisCharacter::OnSprintCompleted() { SetSprinting(false); }

void AMetropolisCharacter::OnRecentered()
{
	// R3 : recentre la caméra derrière le personnage (exigence reprise de la v0.9).
	if (AController* OwningController = GetController())
	{
		OwningController->SetControlRotation(FRotator(-10.f, OwningController->GetControlRotation().Yaw, 0.f));
	}
	CameraBoom->TargetArmLength = 340.f;
}

void AMetropolisCharacter::OnInteractPressed()
{
	TryEnterVehicle();
}

void AMetropolisCharacter::OnToggleViewPressed()
{
	ToggleView();
}

// ---------------------------------------------------------------------------
//                              VEHICULE
// ---------------------------------------------------------------------------

bool AMetropolisCharacter::TryEnterVehicle()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return false;
	}

	const FVector Start = GetActorLocation() + FVector(0.f, 0.f, 40.f);
	const FVector End = Start + GetActorForwardVector() * InteractRange;

	FHitResult Hit;
	FCollisionQueryParams Params(SCENE_QUERY_STAT(EnterVehicleTrace), false, this);
	if (World->LineTraceSingleByChannel(Hit, Start, End, ECC_Visibility, Params))
	{
		if (AMetropolisVehicle* Vehicle = Cast<AMetropolisVehicle>(Hit.GetActor()))
		{
			if (APlayerController* PC = Cast<APlayerController>(GetController()))
			{
				// Possession du véhicule : c'est le moteur qui gère la caméra et
				// les entrées du nouveau Pawn. Le personnage est masqué, pas détruit.
				PC->Possess(Vehicle);
				SetActorHiddenInGame(true);
				SetActorEnableCollision(false);
				return true;
			}
		}
	}
	return false;
}

// ---------------------------------------------------------------------------
//                                CAMERA
// ---------------------------------------------------------------------------

void AMetropolisCharacter::ToggleView()
{
	bFirstPerson = !bFirstPerson;
	if (bFirstPerson)
	{
		CameraBoom->TargetArmLength = 0.f;
		CameraBoom->SocketOffset = FVector(0.f, 0.f, 78.f);   // hauteur des yeux
		Camera->FieldOfView = 88.f;
	}
	else
	{
		CameraBoom->TargetArmLength = 340.f;
		CameraBoom->SocketOffset = FVector(0.f, 0.f, 70.f);
		Camera->FieldOfView = 82.f;
	}
}

void AMetropolisCharacter::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	// En vue subjective, on cache la tête pour ne pas voir l'intérieur du crâne.
	if (USkeletalMeshComponent* Mesh = GetMesh())
	{
		static const FName HeadBone(TEXT("head"));
		if (Mesh->GetBoneIndex(HeadBone) != INDEX_NONE)
		{
			Mesh->HideBoneByName(HeadBone, bFirstPerson ? PBO_Term : PBO_None);
		}
	}
}
