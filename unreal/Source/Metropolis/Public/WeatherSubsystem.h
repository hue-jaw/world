// ============================================================================
// METROPOLIS — WeatherSubsystem
// Météo dynamique + cycle jour/nuit.
//
// Ce sous-système ne dessine RIEN : il produit un état (pluie, mouillage,
// brouillard, vent, heure, nuit, adhérence) que consomment le ciel, les
// matériaux, les véhicules et le trafic. C'est la même séparation que la
// v0.7 WebGL (Environment ≠ rendu), transposée côté moteur.
//
// Le mouillage est un état à mémoire : il MONTE avec la pluie et DESCEND
// lentement après l'accalmie (constante de temps ~2 min). C'est ce qui évite
// la route « sèche instantanément » au moment où la pluie s'arrête.
// ============================================================================
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "MetropolisTypes.h"
#include "WeatherSubsystem.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FWeatherChanged, EWeatherState, NewState);
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FThunderStrike);

UCLASS(BlueprintType)
class METROPOLIS_API UWeatherSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override;

	/** Change la météo avec une transition progressive. */
	UFUNCTION(BlueprintCallable, Category = "Météo")
	void SetWeather(EWeatherState NewState);

	/** Météo aléatoire cohérente (pas de neige en plein été, pas d'orage après le soleil). */
	UFUNCTION(BlueprintCallable, Category = "Météo")
	void CycleWeather();

	// --- Lectures -----------------------------------------------------------
	UFUNCTION(BlueprintPure, Category = "Météo")
	EWeatherState GetWeather() const { return CurrentState; }

	/** Intensité de pluie [0..1]. */
	UFUNCTION(BlueprintPure, Category = "Météo")
	float GetRainIntensity() const { return Rain; }

	/** Mouillage des surfaces [0..1] (montée rapide, séchage lent). */
	UFUNCTION(BlueprintPure, Category = "Météo")
	float GetWetness() const { return Wetness; }

	/** Multiplicateur d'adhérence [0.6..1] appliqué par les véhicules. */
	UFUNCTION(BlueprintPure, Category = "Météo")
	float GetGripFactor() const { return GripFactor; }

	UFUNCTION(BlueprintPure, Category = "Météo")
	float GetFogDensity() const { return FogDensity; }

	UFUNCTION(BlueprintPure, Category = "Météo")
	float GetWindStrength() const { return Wind; }

	UFUNCTION(BlueprintPure, Category = "Météo")
	float GetHour() const { return Hour; }

	/** 0 = jour, 1 = nuit profonde. */
	UFUNCTION(BlueprintPure, Category = "Météo")
	float GetNightFactor() const { return NightFactor; }

	/** Direction NORMALISÉE du soleil (ou de la lune la nuit). */
	UFUNCTION(BlueprintPure, Category = "Météo")
	FVector GetSunDirection() const { return SunDirection; }

	UFUNCTION(BlueprintCallable, Category = "Météo")
	void SetHour(float NewHour);

	/** Avance l'horloge (touche T du jeu). */
	UFUNCTION(BlueprintCallable, Category = "Météo")
	void AdvanceHours(float HoursToAdd);

	UPROPERTY(BlueprintAssignable, Category = "Météo")
	FWeatherChanged OnWeatherChanged;

	UPROPERTY(BlueprintAssignable, Category = "Météo")
	FThunderStrike OnThunder;

	/** Durée d'un cycle complet jour+nuit, en secondes réelles. */
	UPROPERTY(EditAnywhere, Category = "Météo")
	float FullDaySeconds = 2400.f;

	/** Active les transitions automatiques. */
	UPROPERTY(EditAnywhere, Category = "Météo")
	bool bAutoWeather = true;

private:
	struct FWeatherTarget
	{
		float Rain = 0.f;
		float Cloud = 0.f;
		float Fog = 0.002f;
		float Wind = 0.2f;
		float Thunder = 0.f;
	};

	static FWeatherTarget TargetFor(EWeatherState State);

	void PickNextAutoWeather();

	EWeatherState CurrentState = EWeatherState::Clear;
	FWeatherTarget Target;
	FWeatherTarget Smoothed;

	float Rain = 0.f;
	float Cloud = 0.f;
	float FogDensity = 0.002f;
	float Wind = 0.2f;
	float Wetness = 0.f;
	float GripFactor = 1.f;
	float Hour = 8.f;
	float NightFactor = 0.f;
	FVector SunDirection = FVector(0.3f, 0.2f, 0.9f);

	float AutoWeatherTimer = 90.f;
	float ThunderTimer = 0.f;
};
