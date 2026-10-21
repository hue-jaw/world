#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "TimeOfDayManager.generated.h"

class ADirectionalLight;

/**
 * Cycle jour/nuit (brief section 11). Acteur a placer dans le niveau :
 * il pilote la rotation et l'intensite du soleil (DirectionalLight),
 * que SkyAtmosphere suit automatiquement. Lumen recalcule l'eclairage
 * global en continu : aucun baking requis.
 */
UCLASS()
class METROPOLIS_API ATimeOfDayManager : public AActor
{
	GENERATED_BODY()

public:
	ATimeOfDayManager();

	virtual void Tick(float DeltaSeconds) override;

	/** Heure courante [0..24). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Metropolis|Time", meta = (ClampMin = 0.f, ClampMax = 24.f))
	float TimeHours = 9.f;

	/** Duree d'un jour complet en secondes reelles (240 s = valeur du prototype). */
	UPROPERTY(EditAnywhere, Category = "Metropolis|Time", meta = (ClampMin = 30.f))
	float DayLengthSeconds = 240.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Metropolis|Time")
	float TimeScale = 1.f;

	/** DirectionalLight a piloter (soleil). Cherche automatiquement si non assigne. */
	UPROPERTY(EditAnywhere, Category = "Metropolis|Time")
	TObjectPtr<ADirectionalLight> SunLight;

	/** 0 = plein jour, 1 = nuit profonde (pilotage lampadaires, fenetres, phares...). */
	UFUNCTION(BlueprintCallable, Category = "Metropolis|Time")
	float GetNightFactor() const;

	UFUNCTION(BlueprintCallable, Category = "Metropolis|Time")
	void AdvanceTime(float Hours) { TimeHours = FMath::Fmod(TimeHours + Hours + 24.f, 24.f); }

protected:
	virtual void BeginPlay() override;
	void ApplySun();
};
