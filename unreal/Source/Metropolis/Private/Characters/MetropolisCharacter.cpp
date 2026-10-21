#include "Characters/MetropolisCharacter.h"
#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/Controller.h"
#include "GameFramework/SpringArmComponent.h"
#include "Interaction/Interactable.h"
#include "Kismet/KismetSystemLibrary.h"

AMetropolisCharacter::AMetropolisCharacter()
{
	PrimaryActorTick.bCanEverTick = true;

	GetCapsuleComponent()->InitCapsuleSize(42.f, 96.f);

	// Le personnage s'oriente vers son mouvement ; la camera reste libre.
	bUseControllerRotationYaw = false;
	GetCharacterMovement()->bOrientRotationToMovement = true;
	GetCharacterMovement()->RotationRate = FRotator(0.f, 540.f, 0.f);
	GetCharacterMovement()->MaxWalkSpeed = WalkSpeed;
	GetCharacterMovement()->JumpZVelocity = 620.f;
	GetCharacterMovement()->AirControl = 0.35f;

	CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom"));
	CameraBoom->SetupAttachment(RootComponent);
	CameraBoom->TargetArmLength = 550.f;
	CameraBoom->bUsePawnControlRotation = true; // le boom suit le regard

	FollowCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("FollowCamera"));
	FollowCamera->SetupAttachment(CameraBoom, USpringArmComponent::SocketName);
	FollowCamera->bUsePawnControlRotation = false;
}

void AMetropolisCharacter::BeginPlay()
{
	Super::BeginPlay();

	if (APlayerController* PC = Cast<APlayerController>(Controller))
	{
		if (UEnhancedInputLocalPlayerSubsystem* Subsystem =
			ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PC->GetLocalPlayer()))
		{
			Subsystem->AddMappingContext(DefaultMappingContext, 0);
		}
	}
}

void AMetropolisCharacter::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	// Scan d'interaction a basse frequence (10 Hz) : amplitude constante,
	// independante du framerate - meme principe que le LOD du prototype.
	InteractScanTimer -= DeltaSeconds;
	if (InteractScanTimer <= 0.f)
	{
		InteractScanTimer = 0.1f;
		RefreshInteractable();
	}
}

void AMetropolisCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	if (UEnhancedInputComponent* EIC = CastChecked<UEnhancedInputComponent>(PlayerInputComponent))
	{
		EIC->BindAction(MoveAction, ETriggerEvent::Triggered, this, &AMetropolisCharacter::Move);
		EIC->BindAction(LookAction, ETriggerEvent::Triggered, this, &AMetropolisCharacter::Look);
		EIC->BindAction(JumpAction, ETriggerEvent::Started, this, &ACharacter::Jump);
		EIC->BindAction(JumpAction, ETriggerEvent::Completed, this, &ACharacter::StopJumping);
		EIC->BindAction(SprintAction, ETriggerEvent::Started, this, &AMetropolisCharacter::StartSprint);
		EIC->BindAction(SprintAction, ETriggerEvent::Completed, this, &AMetropolisCharacter::StopSprint);
		EIC->BindAction(InteractAction, ETriggerEvent::Started, this, &AMetropolisCharacter::DoInteract);
	}
}

void AMetropolisCharacter::Move(const FInputActionValue& Value)
{
	const FVector2D Axis = Value.Get<FVector2D>();
	if (!Controller) return;

	const FRotator YawRotation(0.f, Controller->GetControlRotation().Yaw, 0.f);
	const FVector Forward = FRotationMatrix(YawRotation).GetUnitAxis(EAxis::X);
	const FVector Right = FRotationMatrix(YawRotation).GetUnitAxis(EAxis::Y);
	AddMovementInput(Forward, Axis.Y);
	AddMovementInput(Right, Axis.X);
}

void AMetropolisCharacter::Look(const FInputActionValue& Value)
{
	const FVector2D Axis = Value.Get<FVector2D>();
	AddControllerYawInput(Axis.X);
	AddControllerPitchInput(Axis.Y);
}

void AMetropolisCharacter::StartSprint() { GetCharacterMovement()->MaxWalkSpeed = SprintSpeed; }
void AMetropolisCharacter::StopSprint() { GetCharacterMovement()->MaxWalkSpeed = WalkSpeed; }

void AMetropolisCharacter::RefreshInteractable()
{
	CurrentInteractable = nullptr;
	TArray<AActor*> Overlapped;
	const TArray<TEnumAsByte<EObjectTypeQuery>> ObjectTypes = {
		UEngineTypes::ConvertToObjectType(ECC_Pawn),
		UEngineTypes::ConvertToObjectType(ECC_WorldDynamic)
	};
	UKismetSystemLibrary::SphereOverlapActors(this, GetActorLocation(), InteractionRadius,
		ObjectTypes, nullptr, { this }, Overlapped);

	float BestDistSq = TNumericLimits<float>::Max();
	for (AActor* Candidate : Overlapped)
	{
		if (Candidate && Candidate->GetClass()->ImplementsInterface(UInteractable::StaticClass()))
		{
			const float DistSq = FVector::DistSquared(GetActorLocation(), Candidate->GetActorLocation());
			const float Range = IInteractable::Execute_GetInteractionRange(Candidate);
			if (DistSq < BestDistSq && DistSq <= Range * Range)
			{
				BestDistSq = DistSq;
				CurrentInteractable = Candidate;
			}
		}
	}
	// TODO Phase UI : emettre vers l'HUD (prompt) via un delegue/GameplayMessage.
}

void AMetropolisCharacter::DoInteract()
{
	if (CurrentInteractable)
	{
		IInteractable::Execute_Interact(CurrentInteractable, this);
	}
}
