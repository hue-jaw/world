// ============================================================================
// METROPOLIS — MetropolisGameMode.cpp
// ============================================================================
#include "MetropolisGameMode.h"
#include "MetropolisCharacter.h"
#include "MetropolisVehicle.h"
#include "MetropolisSaveGame.h"
#include "RoadNetworkSubsystem.h"
#include "WeatherSubsystem.h"
#include "GPSSubsystem.h"

#include "GameFramework/PlayerStart.h"
#include "Kismet/GameplayStatics.h"
#include "EngineUtils.h"
#include "Engine/World.h"
#include "Engine/GameInstance.h"

AMetropolisGameMode::AMetropolisGameMode()
{
	DefaultPawnClass = AMetropolisCharacter::StaticClass();
	// Le PlayerController et le HUD sont fournis par les Blueprints du projet
	// (BP_MetropolisPC / BP_MetropolisHUD) ; les classes C++ servent de repli.
	bStartPlayersAsSpectators = false;
}

void AMetropolisGameMode::BeginPlay()
{
	Super::BeginPlay();
	GenerateDemoDistrict();

	// On démarre au chapitre I, comme la version web.
	if (UWeatherSubsystem* Weather = GetWorld() ? GetWorld()->GetSubsystem<UWeatherSubsystem>() : nullptr)
	{
		Weather->SetHour(8.5f);
		Weather->SetWeather(EWeatherState::Cloudy);
	}
}

void AMetropolisGameMode::GenerateDemoDistrict()
{
	UWorld* World = GetWorld();
	URoadNetworkSubsystem* Network = World ? World->GetSubsystem<URoadNetworkSubsystem>() : nullptr;
	if (!Network)
	{
		return;
	}

	// Quartier de démonstration : grille de 6×6 pâtés de maisons espacés de
	// 64 m (spacing en cm). C'est le périmètre §18 (un quartier représentatif).
	const int32 SizeX = FMath::Clamp(DemoDistrictBlocks.X, 2, 12);
	const int32 SizeY = FMath::Clamp(DemoDistrictBlocks.Y, 2, 12);
	Network->BuildGrid(SizeX, SizeY, BlockSpacing, 1390.f);

	UE_LOG(LogTemp, Log, TEXT("Quartier de démonstration : %d nœuds, %d tronçons."),
		Network->GetNodeCount(), Network->GetEdgeCount());

	PlacePlayerSafely();
}

AActor* AMetropolisGameMode::ChoosePlayerStart_Implementation(AController* Player)
{
	// Règle : jamais de spawn devant le joueur, ni dans un mur. On choisit un
	// PlayerStart dont la vue ne croise pas le joueur actuel, sinon on prend le
	// plus éloigné disponible.
	TArray<APlayerStart*> Starts;
	for (TActorIterator<APlayerStart> It(GetWorld()); It; ++It)
	{
		Starts.Add(*It);
	}
	if (Starts.Num() == 0)
	{
		return Super::ChoosePlayerStart_Implementation(Player);
	}

	const APawn* ExistingPawn = (Player && Player->GetPawn()) ? Player->GetPawn() : nullptr;
	if (!ExistingPawn)
	{
		return Starts[0];
	}

	APlayerStart* Best = Starts[0];
	float BestScore = -1.f;
	for (APlayerStart* Start : Starts)
	{
		const FVector ToStart = Start->GetActorLocation() - ExistingPawn->GetActorLocation();
		const float Distance = static_cast<float>(ToStart.Size2D());
		// Bonus si le départ est derrière le joueur (produit scalaire négatif).
		const float Facing = static_cast<float>(ToStart.GetSafeNormal2D() | ExistingPawn->GetActorForwardVector());
		const float Score = Distance * (Facing < 0.f ? 1.5f : 1.0f);
		if (Score > BestScore)
		{
			BestScore = Score;
			Best = Start;
		}
	}
	return Best;
}

void AMetropolisGameMode::PlacePlayerSafely()
{
	// Le joueur est placé au centre du quartier, sur le trottoir (Z = 15 cm
	// au-dessus de la chaussée), jamais sur la trajectoire d'un véhicule.
	if (APlayerController* PC = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr)
	{
		if (APawn* Pawn = PC->GetPawn())
		{
			const FVector SpawnLocation(BlockSpacing * 1.5f, BlockSpacing * 1.5f, 60.f);
			Pawn->SetActorLocation(SpawnLocation, false, nullptr, ETeleportType::TeleportPhysics);
		}
	}
}

bool AMetropolisGameMode::HasSaveGame(const FString& SlotName) const
{
	return UGameplayStatics::DoesSaveGameExist(SlotName, 0);
}

bool AMetropolisGameMode::SaveGameToSlot(const FString& SlotName)
{
	UMetropolisSaveGame* Save = Cast<UMetropolisSaveGame>(
		UGameplayStatics::CreateSaveGameObject(UMetropolisSaveGame::StaticClass()));
	if (!Save)
	{
		return false;
	}

	Save->SaveVersion = UMetropolisSaveGame::CurrentVersion;
	Save->SavedAt = FDateTime::UtcNow();
	Save->SlotLabel = SlotName;

	if (const UWorld* World = GetWorld())
	{
		if (const APlayerController* PC = World->GetFirstPlayerController())
		{
			if (const APawn* Pawn = PC->GetPawn())
			{
				Save->PlayerLocation = Pawn->GetActorLocation();
				Save->PlayerRotation = Pawn->GetActorRotation();
				Save->bWasInVehicle = Pawn->IsA(AMetropolisVehicle::StaticClass());
			}
		}
		if (const UWeatherSubsystem* Weather = World->GetSubsystem<UWeatherSubsystem>())
		{
			Save->InGameHour = Weather->GetHour();
			Save->Weather = Weather->GetWeather();
		}
	}

	return UGameplayStatics::SaveGameToSlot(Save, SlotName, 0);
}

bool AMetropolisGameMode::LoadGameFromSlot(const FString& SlotName)
{
	if (!HasSaveGame(SlotName))
	{
		return false;
	}
	UMetropolisSaveGame* Save = Cast<UMetropolisSaveGame>(
		UGameplayStatics::LoadGameFromSlot(SlotName, 0));
	if (!Save || !Save->IsCompatible())
	{
		// Sauvegarde d'une version antérieure : on refuse au lieu de charger
		// des données incompatibles (comportement v0.9, conservé).
		UE_LOG(LogTemp, Warning, TEXT("Sauvegarde incompatible ou illisible : nouvelle partie proposée."));
		return false;
	}
	ApplySaveToWorld(Save);
	return true;
}

void AMetropolisGameMode::ApplySaveToWorld(const UMetropolisSaveGame* Save)
{
	if (!Save)
	{
		return;
	}
	if (UWorld* World = GetWorld())
	{
		if (APlayerController* PC = World->GetFirstPlayerController())
		{
			if (APawn* Pawn = PC->GetPawn())
			{
				Pawn->SetActorLocationAndRotation(Save->PlayerLocation, Save->PlayerRotation,
					false, nullptr, ETeleportType::TeleportPhysics);
			}
		}
		if (UWeatherSubsystem* Weather = World->GetSubsystem<UWeatherSubsystem>())
		{
			Weather->SetHour(Save->InGameHour);
			Weather->SetWeather(Save->Weather);
		}
	}
}
