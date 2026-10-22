// ============================================================================
// METROPOLIS — GPSSubsystem
// Navigation routière façon GPS automobile.
//
// Reprend le comportement de la v0.7 WebGL, réimplémenté :
//   • itinéraire calculé sur le GRAPHE routier (jamais à travers les murs) ;
//   • recalcul automatique quand le joueur s'écarte (seuil + anti-rebond) ;
//   • prochaine manœuvre, distance restante, temps estimé ;
//   • deux modes : le plus rapide / le plus court.
// ============================================================================
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "MetropolisTypes.h"
#include "GPSSubsystem.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FGPSRouteChanged, const FGPSRoute&, Route);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FGPSManeuverChanged, EGPSManeuver, Type, float, DistanceMeters);

UCLASS(BlueprintType)
class METROPOLIS_API UGPSSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override;

	/** Fixe la destination et calcule l'itinéraire depuis la position du joueur. */
	UFUNCTION(BlueprintCallable, Category = "GPS")
	bool SetDestination(const FVector& WorldLocation);

	UFUNCTION(BlueprintCallable, Category = "GPS")
	void ClearRoute();

	/** Recalcule depuis la position actuelle (appelé automatiquement si on s'écarte). */
	UFUNCTION(BlueprintCallable, Category = "GPS")
	bool Recalculate();

	UFUNCTION(BlueprintCallable, Category = "GPS")
	void SetRouteMode(ERouteMode NewMode);

	UFUNCTION(BlueprintPure, Category = "GPS")
	bool HasRoute() const { return bHasRoute; }

	/** Retour par valeur : UHT refuse une référence en retour de UFUNCTION. */
	UFUNCTION(BlueprintPure, Category = "GPS")
	FGPSRoute GetRoute() const { return Route; }

	UFUNCTION(BlueprintPure, Category = "GPS")
	FGPSManeuver GetNextManeuver() const { return NextManeuver; }

	UFUNCTION(BlueprintPure, Category = "GPS")
	float GetRemainingMeters() const { return RemainingMeters; }

	UFUNCTION(BlueprintPure, Category = "GPS")
	float GetRemainingSeconds() const { return RemainingSeconds; }

	/** Écart actuel à l'itinéraire, en mètres (pour le HUD debug). */
	UFUNCTION(BlueprintPure, Category = "GPS")
	float GetDeviationMeters() const { return CurrentDeviation; }

	UPROPERTY(BlueprintAssignable, Category = "GPS")
	FGPSRouteChanged OnRouteChanged;

	UPROPERTY(BlueprintAssignable, Category = "GPS")
	FGPSManeuverChanged OnManeuverChanged;

	/** Seuil de recalcul (m). En dessous, on ne recalcule pas : anti-rebond. */
	UPROPERTY(EditAnywhere, Category = "GPS")
	float DeviationThreshold = 2500.f;

	/** Intervalle minimal entre deux recalculs automatiques (s). */
	UPROPERTY(EditAnywhere, Category = "GPS")
	float RecalcCooldown = 2.0f;

private:
	bool BuildRouteFrom(const FVector& FromLocation);

	/** Projette une position sur la polyligne : renvoie la distance le long du tracé. */
	float ProjectOnRoute(const FVector& Location, float& OutDeviation) const;

	void UpdateManeuver(const FVector& PlayerLocation);
	FVector GetPlayerLocation() const;

	FGPSRoute Route;
	FGPSManeuver NextManeuver;
	FVector Destination = FVector::ZeroVector;
	int32 DestinationNode = INDEX_NONE;

	ERouteMode Mode = ERouteMode::Fastest;
	bool bHasRoute = false;
	float RemainingMeters = 0.f;
	float RemainingSeconds = 0.f;
	float CurrentDeviation = 0.f;
	float TimeSinceRecalc = 0.f;

	// Cache pour ne pas rediffuser le HUD à chaque image.
	EGPSManeuver LastBroadcastManeuver = EGPSManeuver::None;
	float LastBroadcastDistance = -1.f;
};
