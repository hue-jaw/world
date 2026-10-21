#pragma once

#include "CoreMinimal.h"
#include "GameFramework/SaveGame.h"
#include "MetropolisSaveGame.generated.h"

/**
 * Sauvegarde versionnee (brief section 24).
 * Le champ SaveVersion permet de migrer les anciennes sauvegardes
 * a chaque evolution du format. La ville procedurale n'est PAS stockee
 * (generation deterministe par seed) : seuls l'etat du joueur et les
 * deltas persistants du monde sont serialises.
 */
UCLASS()
class METROPOLIS_API UMetropolisSaveGame : public USaveGame
{
	GENERATED_BODY()

public:
	static constexpr int32 CurrentVersion = 1;

	UPROPERTY(VisibleAnywhere, Category = "Save")
	int32 SaveVersion = CurrentVersion;

	// --- Joueur ---
	UPROPERTY(EditAnywhere, Category = "Save|Player")
	int32 Money = 0;

	UPROPERTY(EditAnywhere, Category = "Save|Player")
	int32 DeliveriesCompleted = 0;

	UPROPERTY(EditAnywhere, Category = "Save|Player")
	FVector PlayerLocation = FVector::ZeroVector;

	UPROPERTY(EditAnywhere, Category = "Save|Player")
	FRotator PlayerRotation = FRotator::ZeroRotator;

	// --- Monde ---
	UPROPERTY(EditAnywhere, Category = "Save|World")
	float TimeOfDayHours = 9.0f;

	UPROPERTY(EditAnywhere, Category = "Save|World")
	FName WeatherState = FName(TEXT("Clear"));

	/** Serialise vers le slot par defaut. A appeler depuis un subsystem dedie a terme. */
	bool SaveToSlot(const FString& SlotName = TEXT("Metropolis_Main"));

	/** Charge le slot ; renvoie nullptr si absent ou version incompatible non migrable. */
	static UMetropolisSaveGame* LoadFromSlot(const FString& SlotName = TEXT("Metropolis_Main"));
};
