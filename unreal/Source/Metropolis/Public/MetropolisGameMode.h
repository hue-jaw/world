// ============================================================================
// METROPOLIS — MetropolisGameMode
// Règles de jeu : mode Histoire, spawn sans jamais apparaître devant le joueur,
// creation des sous-systèmes de niveau, réglages par défaut.
// ============================================================================
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "MetropolisGameMode.generated.h"

class AMetropolisWorldBuilder;

class AMetropolisCharacter;
class AMetropolisVehicle;
class APawn;

UCLASS()
class METROPOLIS_API AMetropolisGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	AMetropolisGameMode();

	virtual void BeginPlay() override;
	virtual AActor* ChoosePlayerStart_Implementation(AController* Player) override;

	/** Construit le réseau routier du quartier de démonstration. */
	UFUNCTION(BlueprintCallable, Category = "Jeu")
	void GenerateDemoDistrict();

	/** Sauvegarde/chargement (slot unique par défaut). */
	UFUNCTION(BlueprintCallable, Category = "Jeu")
	bool SaveGameToSlot(const FString& SlotName = TEXT("METROPOLIS_01"));

	UFUNCTION(BlueprintCallable, Category = "Jeu")
	bool LoadGameFromSlot(const FString& SlotName = TEXT("METROPOLIS_01"));

	UFUNCTION(BlueprintPure, Category = "Jeu")
	bool HasSaveGame(const FString& SlotName = TEXT("METROPOLIS_01")) const;

	UPROPERTY(EditDefaultsOnly, Category = "Jeu")
	TSubclassOf<AMetropolisCharacter> CharacterClass;

	UPROPERTY(EditDefaultsOnly, Category = "Jeu")
	TSubclassOf<AMetropolisVehicle> DefaultVehicleClass;

	/** Taille du quartier de démonstration, en pâtés de maisons. */
	UPROPERTY(EditDefaultsOnly, Category = "Jeu")
	FIntPoint DemoDistrictBlocks = FIntPoint(6, 6);

	UPROPERTY(EditDefaultsOnly, Category = "Jeu")
	float BlockSpacing = 6400.f;

	/**
	 * Construit un quartier jouable sans asset (sol, chaussées, trottoirs
	 * physiques, bâtiments) : le projet est jouable dès l'ouverture, avant
	 * même d'avoir importé le moindre mesh.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Jeu")
	bool bBuildProceduralDistrict = true;

	UPROPERTY(EditDefaultsOnly, Category = "Jeu")
	TSubclassOf<class AMetropolisWorldBuilder> WorldBuilderClass;

private:
	void ApplySaveToWorld(const class UMetropolisSaveGame* Save);
	void PlacePlayerSafely();
};
