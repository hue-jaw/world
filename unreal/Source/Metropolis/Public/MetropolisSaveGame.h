// ============================================================================
// METROPOLIS — MetropolisSaveGame
// Sauvegarde : progression, argent, position, véhicule, météo, réglages.
// Version 3 (comme la v0.9) : une sauvegarde plus ancienne est refusée
// proprement et propose une nouvelle partie, sans plantage.
// ============================================================================
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/SaveGame.h"
#include "MetropolisTypes.h"
#include "MetropolisSaveGame.generated.h"

UCLASS()
class METROPOLIS_API UMetropolisSaveGame : public USaveGame
{
	GENERATED_BODY()

public:
	static constexpr int32 CurrentVersion = 3;

	UPROPERTY(BlueprintReadWrite, Category = "Sauvegarde")
	int32 SaveVersion = CurrentVersion;

	UPROPERTY(BlueprintReadWrite, Category = "Sauvegarde")
	FString SlotLabel;

	UPROPERTY(BlueprintReadWrite, Category = "Sauvegarde")
	FDateTime SavedAt;

	/** Position du joueur, en monde. */
	UPROPERTY(BlueprintReadWrite, Category = "Sauvegarde")
	FVector PlayerLocation = FVector(0.f, 0.f, 120.f);

	UPROPERTY(BlueprintReadWrite, Category = "Sauvegarde")
	FRotator PlayerRotation = FRotator::ZeroRotator;

	UPROPERTY(BlueprintReadWrite, Category = "Sauvegarde")
	bool bWasInVehicle = false;

	UPROPERTY(BlueprintReadWrite, Category = "Sauvegarde")
	float Money = 35.f;

	UPROPERTY(BlueprintReadWrite, Category = "Sauvegarde")
	EStoryChapter Chapter = EStoryChapter::Arrival;

	UPROPERTY(BlueprintReadWrite, Category = "Sauvegarde")
	float InGameHour = 8.f;

	UPROPERTY(BlueprintReadWrite, Category = "Sauvegarde")
	EWeatherState Weather = EWeatherState::Clear;

	UPROPERTY(BlueprintReadWrite, Category = "Sauvegarde")
	int32 GraphicsPreset = 2;

	UPROPERTY(BlueprintReadWrite, Category = "Sauvegarde")
	TArray<FString> CompletedMissions;

	UPROPERTY(BlueprintReadWrite, Category = "Sauvegarde")
	TMap<FString, int32> Statistics;

	UFUNCTION(BlueprintPure, Category = "Sauvegarde")
	bool IsCompatible() const { return SaveVersion == CurrentVersion; }
};
