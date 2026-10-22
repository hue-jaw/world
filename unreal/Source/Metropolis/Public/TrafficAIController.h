// ============================================================================
// METROPOLIS — TrafficAIController
// Conduite IA sur le graphe routier.
//
// Le véhicule IA n'est PAS téléporté le long d'une spline : il roule avec la
// même physique Chaos que le joueur, et ce contrôleur agit sur les commandes
// (accélérateur, volant, frein). Conséquences réelles : les bouchons se
// forment, une voiture freine trop tard et tape, la pluie allonge les distances.
//
// Comportements : respect des limitations, arrêt au feu rouge, distance de
// sécurité, dépassement si voie libre, 6 profils de conducteurs.
// ============================================================================
#pragma once

#include "CoreMinimal.h"
#include "AIController.h"
#include "MetropolisTypes.h"
#include "TrafficAIController.generated.h"

class AMetropolisVehicle;

UCLASS()
class METROPOLIS_API ATrafficAIController : public AAIController
{
	GENERATED_BODY()

public:
	ATrafficAIController();

	virtual void OnPossess(APawn* InPawn) override;
	virtual void Tick(float DeltaSeconds) override;

	/** Choisit une destination et calcule l'itinéraire. */
	UFUNCTION(BlueprintCallable, Category = "Trafic")
	bool PlanRoute();

	UFUNCTION(BlueprintCallable, Category = "Trafic")
	void SetDriverProfile(EDriverProfile NewProfile);

	UFUNCTION(BlueprintPure, Category = "Trafic")
	EDriverProfile GetDriverProfile() const { return Profile; }

	UFUNCTION(BlueprintPure, Category = "Trafic")
	float GetTargetSpeedCmS() const { return TargetSpeed; }

	/** Distance de sécurité effective (m), dépend de la vitesse et de la pluie. */
	UFUNCTION(BlueprintPure, Category = "Trafic")
	float GetSafeDistance() const;

	UPROPERTY(EditAnywhere, Category = "Trafic")
	float LookAheadDistance = 1200.f;

	UPROPERTY(EditAnywhere, Category = "Trafic")
	float ArrivalRadius = 900.f;

	/** Probabilité de tenter un dépassement quand la voie est libre. */
	UPROPERTY(EditAnywhere, Category = "Trafic")
	float OvertakeChance = 0.15f;

private:
	void FollowRoute(float DeltaSeconds);
	void HandleTrafficLight(float DeltaSeconds);
	bool IsObstacleAhead(float& OutDistance) const;

	UPROPERTY()
	TObjectPtr<AMetropolisVehicle> ControlledVehicle;

	TArray<FVector> Waypoints;
	int32 WaypointIndex = 0;
	EDriverProfile Profile = EDriverProfile::Normal;
	float TargetSpeed = 0.f;
	float CurrentSpeed = 0.f;
	float StopTimer = 0.f;
	int32 CurrentEdge = INDEX_NONE;
	bool bWaitingAtLight = false;

	// Facteur de vitesse par profil (1 = limitation exacte).
	static float ProfileSpeedFactor(EDriverProfile InProfile);
};
