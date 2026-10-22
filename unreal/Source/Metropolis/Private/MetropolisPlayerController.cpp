// ============================================================================
// METROPOLIS — MetropolisPlayerController.cpp
// ============================================================================
#include "MetropolisPlayerController.h"
#include "MetropolisVehicle.h"
#include "MetropolisCharacter.h"
#include "MetropolisHUD.h"
#include "MetropolisGameMode.h"
#include "WeatherSubsystem.h"

#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "InputActionValue.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "EngineUtils.h"

AMetropolisPlayerController::AMetropolisPlayerController()
{
	bShowMouseCursor = false;
	PrimaryActorTick.bCanEverTick = false;
}

void AMetropolisPlayerController::BeginPlay()
{
	Super::BeginPlay();

	if (UEnhancedInputLocalPlayerSubsystem* InputSubsystem = ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(GetLocalPlayer()))
	{
		if (GlobalContext)
		{
			InputSubsystem->AddMappingContext(GlobalContext, 10);   // priorité haute
		}
	}

	if (UEnhancedInputComponent* Input = Cast<UEnhancedInputComponent>(InputComponent))
	{
		if (SaveAction)     { Input->BindAction(SaveAction, ETriggerEvent::Started, this, &AMetropolisPlayerController::OnSavePressed); }
		if (LoadAction)     { Input->BindAction(LoadAction, ETriggerEvent::Started, this, &AMetropolisPlayerController::OnLoadPressed); }
		if (PauseAction)    { Input->BindAction(PauseAction, ETriggerEvent::Started, this, &AMetropolisPlayerController::OnPausePressed); }
		if (HUDAction)      { Input->BindAction(HUDAction, ETriggerEvent::Started, this, &AMetropolisPlayerController::OnHUDPressed); }
		if (TimeAction)     { Input->BindAction(TimeAction, ETriggerEvent::Started, this, &AMetropolisPlayerController::OnTimePressed); }
		if (ExitVehicleAction) { Input->BindAction(ExitVehicleAction, ETriggerEvent::Started, this, &AMetropolisPlayerController::OnExitVehiclePressed); }
	}

	// Repli : sans assets Enhanced Input, ces commandes globales seraient
	// inaccessibles (pas de sauvegarde, pas de pause, pas de HUD).
	if (!SaveAction && InputComponent)
	{
		InputComponent->BindAction(TEXT("Save"), IE_Pressed, this, &AMetropolisPlayerController::OnSavePressed);
		InputComponent->BindAction(TEXT("Load"), IE_Pressed, this, &AMetropolisPlayerController::OnLoadPressed);
		InputComponent->BindAction(TEXT("Pause"), IE_Pressed, this, &AMetropolisPlayerController::OnPausePressed);
		InputComponent->BindAction(TEXT("HUD"), IE_Pressed, this, &AMetropolisPlayerController::OnHUDPressed);
		InputComponent->BindAction(TEXT("Time"), IE_Pressed, this, &AMetropolisPlayerController::OnTimePressed);
		InputComponent->BindAction(TEXT("ExitVehicle"), IE_Pressed, this, &AMetropolisPlayerController::OnExitVehiclePressed);
	}
}

void AMetropolisPlayerController::OnSavePressed() { SaveGame(); }
void AMetropolisPlayerController::OnLoadPressed() { LoadGame(); }
void AMetropolisPlayerController::OnHUDPressed()  { ToggleHUD(); }
void AMetropolisPlayerController::OnExitVehiclePressed() { ExitVehicle(); }

void AMetropolisPlayerController::OnPausePressed()
{
	TogglePause();
}

void AMetropolisPlayerController::OnTimePressed()
{
	AdvanceTime();
}

bool AMetropolisPlayerController::ExitVehicle()
{
	AMetropolisVehicle* Vehicle = Cast<AMetropolisVehicle>(GetPawn());
	if (!Vehicle)
	{
		return false;
	}

	// Le personnage existe toujours : on le récupère dans le niveau.
	AMetropolisCharacter* Character = nullptr;
	for (TActorIterator<AMetropolisCharacter> It(GetWorld()); It; ++It)
	{
		Character = *It;
		break;
	}
	if (!Character)
	{
		return false;
	}

	// Placement côté conducteur (à droite du véhicule en repère UE), à 1,2 m,
	// juste au-dessus du sol : le CharacterMovement gère la descente.
	const FVector ExitLocation = Vehicle->GetActorLocation()
		+ Vehicle->GetActorRightVector() * 120.f
		+ Vehicle->GetActorUpVector() * 40.f;

	Character->SetActorLocation(ExitLocation, false, nullptr, ETeleportType::TeleportPhysics);
	Character->SetActorHiddenInGame(false);
	Character->SetActorEnableCollision(true);

	Possess(Character);
	return true;
}

bool AMetropolisPlayerController::SaveGame(const FString& SlotName)
{
	if (AMetropolisGameMode* GameMode = GetWorld() ? GetWorld()->GetAuthGameMode<AMetropolisGameMode>() : nullptr)
	{
		const bool bOk = GameMode->SaveGameToSlot(SlotName);
		UE_LOG(LogTemp, Log, TEXT("Sauvegarde %s : %s"), *SlotName, bOk ? TEXT("OK") : TEXT("ECHEC"));
		return bOk;
	}
	return false;
}

bool AMetropolisPlayerController::LoadGame(const FString& SlotName)
{
	if (AMetropolisGameMode* GameMode = GetWorld() ? GetWorld()->GetAuthGameMode<AMetropolisGameMode>() : nullptr)
	{
		return GameMode->LoadGameFromSlot(SlotName);
	}
	return false;
}

void AMetropolisPlayerController::TogglePause()
{
	const bool bPaused = IsPaused();
	// SetPause suspend les Tick des acteurs ; les sous-systèmes de temps
	// (UTickableWorldSubsystem) reçoivent leur Tick via le monde et s'arrêtent
	// donc aussi. Aucun appel à une API non vérifiée n'est nécessaire ici.
	SetPause(!bPaused);
}

void AMetropolisPlayerController::ToggleHUD()
{
	if (AMetropolisHUD* MetropolisHUD = Cast<AMetropolisHUD>(GetHUD()))
	{
		MetropolisHUD->ToggleHUD();
	}
}

void AMetropolisPlayerController::AdvanceTime()
{
	if (UWeatherSubsystem* Weather = GetWorld() ? GetWorld()->GetSubsystem<UWeatherSubsystem>() : nullptr)
	{
		Weather->AdvanceHours(2.f);
	}
}
