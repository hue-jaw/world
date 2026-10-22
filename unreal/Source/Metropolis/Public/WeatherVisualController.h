// ============================================================================
// METROPOLIS — WeatherVisualController
// Traduit l'ÉTAT météo (WeatherSubsystem) en rendu : soleil/lune, ciel, fog,
// pluie Niagara, éclaboussures, mouillage des matériaux.
//
// Ce fichier ne crée aucun asset : il pilote des composants placés dans le
// niveau par le Blueprint BP_WeatherRig (Directional Light, Sky Light,
// Exponential Height Fog, Niagara). Les références sont des chemins souples :
// si un asset n'existe pas encore, le contrôleur le signale et continue —
// il ne plante pas, il ne prétend pas non plus que la pluie tombe.
// ============================================================================
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "MetropolisTypes.h"
#include "WeatherVisualController.generated.h"

class UDirectionalLightComponent;
class USkyLightComponent;
class UExponentialHeightFogComponent;
class UNiagaraComponent;
class UMaterialParameterCollection;
class UWeatherSubsystem;

UCLASS()
class METROPOLIS_API AWeatherVisualController : public AActor
{
	GENERATED_BODY()

public:
	AWeatherVisualController();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	/** Intensité maximale du soleil (lux), ciel clair. */
	UPROPERTY(EditAnywhere, Category = "Rendu météo")
	float SunMaxIntensity = 120000.f;

	UPROPERTY(EditAnywhere, Category = "Rendu météo")
	float MoonMaxIntensity = 900.f;

	/** Couleur chaude au lever/coucher, blanche au zénith. */
	UPROPERTY(EditAnywhere, Category = "Rendu météo")
	FLinearColor SunHorizonColor = FLinearColor(1.0f, 0.55f, 0.28f);

	UPROPERTY(EditAnywhere, Category = "Rendu météo")
	FLinearColor SunNoonColor = FLinearColor(1.0f, 0.96f, 0.90f);

	/** Collection de paramètres matériaux : Wetness, RainIntensity, PuddleMask. */
	UPROPERTY(EditAnywhere, Category = "Rendu météo")
	TObjectPtr<UMaterialParameterCollection> WeatherParameters;

	UPROPERTY(VisibleAnywhere, Category = "Rendu météo")
	TObjectPtr<UDirectionalLightComponent> SunLight;

	UPROPERTY(VisibleAnywhere, Category = "Rendu météo")
	TObjectPtr<USkyLightComponent> SkyLight;

	UPROPERTY(VisibleAnywhere, Category = "Rendu météo")
	TObjectPtr<UExponentialHeightFogComponent> Fog;

	/** Pluie Niagara (BP_NiagaraRain). Absent = aucune pluie dessinée, signalé. */
	UPROPERTY(VisibleAnywhere, Category = "Rendu météo")
	TObjectPtr<UNiagaraComponent> RainEffect;

	/** Éclaboussures au sol (BP_NiagaraSplashes). */
	UPROPERTY(VisibleAnywhere, Category = "Rendu météo")
	TObjectPtr<UNiagaraComponent> SplashEffect;

private:
	void UpdateSun(const UWeatherSubsystem* Weather);
	void UpdateFog(const UWeatherSubsystem* Weather);
	void UpdateRain(const UWeatherSubsystem* Weather);
	void PushMaterialParameters(const UWeatherSubsystem* Weather);

	UPROPERTY()
	TObjectPtr<UWeatherSubsystem> CachedWeather;

	bool bWarnedMissingRain = false;
};
