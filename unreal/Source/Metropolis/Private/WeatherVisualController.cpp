// ============================================================================
// METROPOLIS — WeatherVisualController.cpp
// ============================================================================
#include "WeatherVisualController.h"
#include "WeatherSubsystem.h"

#include "Components/DirectionalLightComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "NiagaraComponent.h"
#include "Materials/MaterialParameterCollection.h"
#include "Materials/MaterialParameterCollectionInstance.h"
#include "Kismet/GameplayStatics.h"
#include "Engine/World.h"

AWeatherVisualController::AWeatherVisualController()
{
	PrimaryActorTick.bCanEverTick = true;

	SunLight = CreateDefaultSubobject<UDirectionalLightComponent>(TEXT("SunLight"));
	RootComponent = SunLight;
	SunLight->SetMobility(EComponentMobility::Movable);
	// Réglages volontairement limités à l'API stable : intensité, couleur,
	// rotation et ombres. Les paramètres avancés (Sky Atmosphere, distance
	// d'ombre, capture temps réel) se règlent dans le Blueprint BP_WeatherRig,
	// pas en C++ : moins de surface d'API, donc moins de risque de casse
	// entre versions du moteur.
	SunLight->SetIntensity(10.f);               // lux (unités UE5 par défaut)
	SunLight->SetCastShadows(true);
	SunLight->SetLightColor(FLinearColor(1.0f, 0.96f, 0.90f));

	SkyLight = CreateDefaultSubobject<USkyLightComponent>(TEXT("SkyLight"));
	SkyLight->SetupAttachment(RootComponent);
	SkyLight->SetMobility(EComponentMobility::Movable);
	SkyLight->SetIntensity(1.0f);

	Fog = CreateDefaultSubobject<UExponentialHeightFogComponent>(TEXT("HeightFog"));
	Fog->SetupAttachment(RootComponent);
	Fog->SetFogDensity(0.02f);
	Fog->SetVolumetricFog(true);

	// Niagara : aucun asset n'est créé ici. Les composants sont inactifs tant
	// qu'un Blueprint ne leur a pas assigné de système (ce qui est honnête :
	// mieux vaut pas de pluie qu'une pluie factice en texture).
	RainEffect = CreateDefaultSubobject<UNiagaraComponent>(TEXT("RainEffect"));
	RainEffect->SetupAttachment(RootComponent);
	RainEffect->SetAutoActivate(false);

	SplashEffect = CreateDefaultSubobject<UNiagaraComponent>(TEXT("SplashEffect"));
	SplashEffect->SetupAttachment(RootComponent);
	SplashEffect->SetAutoActivate(false);
}

void AWeatherVisualController::BeginPlay()
{
	Super::BeginPlay();
	if (UWorld* World = GetWorld())
	{
		CachedWeather = World->GetSubsystem<UWeatherSubsystem>();
	}
	if (!RainEffect->GetAsset())
	{
		UE_LOG(LogTemp, Warning, TEXT("[Météo] Aucun système Niagara de pluie assigné : "
			"la pluie ne sera pas dessinée (assigner BP_NiagaraRain, cf. Documentation/02)."));
		bWarnedMissingRain = true;
	}
}

void AWeatherVisualController::UpdateSun(const UWeatherSubsystem* Weather)
{
	if (!Weather || !SunLight)
	{
		return;
	}

	const float Night = Weather->GetNightFactor();
	const FVector Direction = Weather->GetSunDirection();

	// Rotation : axe X vers la direction du soleil.
	const FRotator SunRotation = FRotationMatrix::MakeFromX(-Direction).Rotator();
	SunLight->SetWorldRotation(SunRotation);

	// Hauteur du soleil → couleur et intensité.
	const float Height = FMath::Clamp(static_cast<float>(Direction.Z), 0.f, 1.f);
	const FLinearColor Color = FMath::Lerp(SunHorizonColor, SunNoonColor, FMath::Clamp(Height * 3.f, 0.f, 1.f));
	SunLight->SetLightColor(Color);

	const float SunIntensity = FMath::Lerp(SunMaxIntensity, 0.f, Night) * FMath::Clamp(Height * 2.5f, 0.05f, 1.f);
	const float MoonIntensity = MoonMaxIntensity * Night;
	SunLight->SetIntensity(SunIntensity + MoonIntensity);

	// Ciel : plus sombre la nuit, plus gris sous la pluie.
	if (SkyLight)
	{
		const float Cloud = Weather->GetWeather() == EWeatherState::Clear ? 0.15f : 0.85f;
		const float SkyIntensity = FMath::Lerp(1.0f, 0.12f, Night) * FMath::Lerp(1.0f, 0.55f, Cloud);
		SkyLight->SetIntensity(SkyIntensity);
	}
}

void AWeatherVisualController::UpdateFog(const UWeatherSubsystem* Weather)
{
	if (!Weather || !Fog)
	{
		return;
	}
	// Fog volumétrique : la densité suit la météo (brouillard = 10× la normale).
	const float Density = FMath::Clamp(Weather->GetFogDensity() * 60.f, 0.005f, 0.9f);
	Fog->SetFogDensity(Density);
	Fog->SetVolumetricFog(Weather->GetFogDensity() > 0.008f);
}

void AWeatherVisualController::UpdateRain(const UWeatherSubsystem* Weather)
{
	if (!Weather)
	{
		return;
	}
	const float Rain = Weather->GetRainIntensity();

	if (Rain > 0.02f)
	{
		if (!RainEffect->IsActive())
		{
			RainEffect->Activate(true);
		}
		// Intensité transmise au Niagara : le système peut moduler son débit.
		RainEffect->SetFloatParameter(TEXT("RainIntensity"), Rain);
		RainEffect->SetFloatParameter(TEXT("WindStrength"), Weather->GetWindStrength());

		// Éclaboussures seulement quand le sol est assez mouillé.
		if (Weather->GetWetness() > 0.25f)
		{
			if (!SplashEffect->IsActive())
			{
				SplashEffect->Activate(true);
			}
			SplashEffect->SetFloatParameter(TEXT("SplashIntensity"), Weather->GetWetness());
		}
		else if (SplashEffect->IsActive())
		{
			SplashEffect->Deactivate();
		}
	}
	else
	{
		if (RainEffect->IsActive())
		{
			RainEffect->Deactivate();
		}
		// Les éclaboussures s'arrêtent avec la pluie, mais le mouillage persiste :
		// c'est le matériau qui garde la mémoire de l'eau (Wetness).
		if (SplashEffect->IsActive() && Weather->GetWetness() < 0.1f)
		{
			SplashEffect->Deactivate();
		}
	}
}

void AWeatherVisualController::PushMaterialParameters(const UWeatherSubsystem* Weather)
{
	if (!Weather || !WeatherParameters)
	{
		return;
	}
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	UMaterialParameterCollectionInstance* Instance = World->GetParameterCollectionInstance(WeatherParameters);
	if (!Instance)
	{
		return;
	}
	// Ces paramètres sont lus par M_Master_PBR (rugosité, reflets, flaques).
	Instance->SetScalarParameterValue(TEXT("Wetness"), Weather->GetWetness());
	Instance->SetScalarParameterValue(TEXT("RainIntensity"), Weather->GetRainIntensity());
	Instance->SetScalarParameterValue(TEXT("NightFactor"), Weather->GetNightFactor());
	Instance->SetScalarParameterValue(TEXT("WindStrength"), Weather->GetWindStrength());
}

void AWeatherVisualController::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	if (!CachedWeather)
	{
		UWorld* World = GetWorld();
		CachedWeather = World ? World->GetSubsystem<UWeatherSubsystem>() : nullptr;
		return;
	}

	UpdateSun(CachedWeather);
	UpdateFog(CachedWeather);
	UpdateRain(CachedWeather);
	PushMaterialParameters(CachedWeather);
}
