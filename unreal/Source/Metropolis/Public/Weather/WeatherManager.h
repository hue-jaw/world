#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "WeatherManager.generated.h"

/** Etats meteo (miroir de WEATHER_STATES du prototype, core.js). */
UENUM(BlueprintType)
enum class EWeatherState : uint8
{
	Clear UMETA(DisplayName = "Degage"),
	Cloudy UMETA(DisplayName = "Nuageux"),
	Rain UMETA(DisplayName = "Pluie"),
	Storm UMETA(DisplayName = "Orage"),
	Fog UMETA(DisplayName = "Brouillard")
};

/** Parametres continus interpoles entre etats (transitions douces). */
USTRUCT(BlueprintType)
struct FWeatherParams
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite) float RainIntensity = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float CloudCover = 0.05f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float FogDensity = 0.0012f;
	/** Multiplicateur d'adherence des vehicules (1 = sec). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float GripFactor = 1.f;
	/** Multiplicateur de vitesse du trafic IA. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float TrafficFactor = 1.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) bool bLightning = false;
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnWeatherChanged, EWeatherState, NewState);

/**
 * Machine a etats meteo + interpolation continue (brief section 10).
 * Les consommateurs lisent GetCurrentParams() chaque frame ou ecoutent
 * OnWeatherChanged : vehicules (grip), trafic (vitesse), PNJ (parapluies,
 * course), rendu (brouillard, nuages, surface mouillee via MPC).
 */
UCLASS()
class METROPOLIS_API UWeatherManager : public UWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	UFUNCTION(BlueprintCallable, Category = "Metropolis|Weather")
	void SetWeather(EWeatherState NewState, bool bInstant = false);

	UFUNCTION(BlueprintCallable, Category = "Metropolis|Weather")
	void CycleWeather();

	UFUNCTION(BlueprintCallable, Category = "Metropolis|Weather")
	EWeatherState GetWeatherState() const { return CurrentState; }

	UFUNCTION(BlueprintCallable, Category = "Metropolis|Weather")
	const FWeatherParams& GetCurrentParams() const { return CurrentParams; }

	/** Parametres cibles d'un etat (table d'equilibrage centrale). */
	static FWeatherParams ParamsForState(EWeatherState State);

	UPROPERTY(BlueprintAssignable, Category = "Metropolis|Weather")
	FOnWeatherChanged OnWeatherChanged;

	/** Meteo automatique (transitions plausibles toutes les 75-140 s). */
	UPROPERTY(EditAnywhere, Category = "Metropolis|Weather")
	bool bAutoWeather = true;

protected:
	void WeatherTick();

private:
	EWeatherState CurrentState = EWeatherState::Clear;
	FWeatherParams CurrentParams;
	FWeatherParams TargetParams;
	FTimerHandle TickTimer;
	FTimerHandle AutoTimer;
};
