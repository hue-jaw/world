// ============================================================================
// METROPOLIS — MetropolisPlayerController
// Entrées globales : pause, sauvegarde, chargement, sortie de véhicule,
// recentrage caméra, téléportation de secours, affichage du HUD.
// ============================================================================
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "MetropolisPlayerController.generated.h"

class UInputMappingContext;
class UInputAction;
class AMetropolisVehicle;
struct FInputActionValue;

UCLASS()
class METROPOLIS_API AMetropolisPlayerController : public APlayerController
{
	GENERATED_BODY()

public:
	AMetropolisPlayerController();

	virtual void BeginPlay() override;

	/** Sortie du véhicule : rend le personnage, le place sur le trottoir côté portière. */
	UFUNCTION(BlueprintCallable, Category = "Joueur")
	bool ExitVehicle();

	UFUNCTION(BlueprintCallable, Category = "Joueur")
	bool SaveGame(const FString& SlotName = TEXT("METROPOLIS_01"));

	UFUNCTION(BlueprintCallable, Category = "Joueur")
	bool LoadGame(const FString& SlotName = TEXT("METROPOLIS_01"));

	UFUNCTION(BlueprintCallable, Category = "Joueur")
	void TogglePause();

	UFUNCTION(BlueprintCallable, Category = "Joueur")
	void ToggleHUD();

	/** Touche T : avance l'horloge de 2 h (test météo/éclairage). */
	UFUNCTION(BlueprintCallable, Category = "Joueur")
	void AdvanceTime();

protected:
	void OnSavePressed();
	void OnLoadPressed();
	void OnPausePressed();
	void OnHUDPressed();
	void OnTimePressed();
	void OnExitVehiclePressed();

	UPROPERTY(EditDefaultsOnly, Category = "Entrées")
	TObjectPtr<UInputMappingContext> GlobalContext;

	UPROPERTY(EditDefaultsOnly, Category = "Entrées")
	TObjectPtr<UInputAction> SaveAction;

	UPROPERTY(EditDefaultsOnly, Category = "Entrées")
	TObjectPtr<UInputAction> LoadAction;

	UPROPERTY(EditDefaultsOnly, Category = "Entrées")
	TObjectPtr<UInputAction> PauseAction;

	UPROPERTY(EditDefaultsOnly, Category = "Entrées")
	TObjectPtr<UInputAction> HUDAction;

	UPROPERTY(EditDefaultsOnly, Category = "Entrées")
	TObjectPtr<UInputAction> TimeAction;

	UPROPERTY(EditDefaultsOnly, Category = "Entrées")
	TObjectPtr<UInputAction> ExitVehicleAction;
};
