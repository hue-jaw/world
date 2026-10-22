// ============================================================================
// METROPOLIS — WeatherSubsystem.cpp
// ============================================================================
#include "WeatherSubsystem.h"
#include "Math/UnrealMathUtility.h"

void UWeatherSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	Target = TargetFor(CurrentState);
	Smoothed = Target;
}

TStatId UWeatherSubsystem::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(UWeatherSubsystem, STATGROUP_Tickables);
}

UWeatherSubsystem::FWeatherTarget UWeatherSubsystem::TargetFor(EWeatherState State)
{
	FWeatherTarget T;
	switch (State)
	{
	case EWeatherState::Clear:
		T.Rain = 0.f; T.Cloud = 0.10f; T.Fog = 0.0015f; T.Wind = 0.15f; break;
	case EWeatherState::Cloudy:
		T.Rain = 0.f; T.Cloud = 0.55f; T.Fog = 0.003f; T.Wind = 0.35f; break;
	case EWeatherState::Overcast:
		T.Rain = 0.05f; T.Cloud = 0.85f; T.Fog = 0.005f; T.Wind = 0.45f; break;
	case EWeatherState::LightRain:
		T.Rain = 0.35f; T.Cloud = 0.90f; T.Fog = 0.007f; T.Wind = 0.55f; break;
	case EWeatherState::HeavyRain:
		T.Rain = 0.75f; T.Cloud = 1.00f; T.Fog = 0.010f; T.Wind = 0.75f; break;
	case EWeatherState::Storm:
		T.Rain = 1.00f; T.Cloud = 1.00f; T.Fog = 0.013f; T.Wind = 1.00f; T.Thunder = 1.f; break;
	case EWeatherState::Fog:
		T.Rain = 0.f; T.Cloud = 0.70f; T.Fog = 0.030f; T.Wind = 0.10f; break;
	}
	return T;
}

void UWeatherSubsystem::SetWeather(EWeatherState NewState)
{
	if (NewState == CurrentState)
	{
		return;
	}
	CurrentState = NewState;
	Target = TargetFor(NewState);
	ThunderTimer = NewState == EWeatherState::Storm ? 3.f : 0.f;
	OnWeatherChanged.Broadcast(CurrentState);
}

void UWeatherSubsystem::CycleWeather()
{
	// Transitions plausibles : on ne saute pas du grand soleil à l'orage.
	switch (CurrentState)
	{
	case EWeatherState::Clear:     SetWeather(EWeatherState::Cloudy); break;
	case EWeatherState::Cloudy:    SetWeather(EWeatherState::Overcast); break;
	case EWeatherState::Overcast:  SetWeather(EWeatherState::LightRain); break;
	case EWeatherState::LightRain: SetWeather(EWeatherState::HeavyRain); break;
	case EWeatherState::HeavyRain: SetWeather(EWeatherState::Storm); break;
	case EWeatherState::Storm:     SetWeather(EWeatherState::Overcast); break;
	case EWeatherState::Fog:       SetWeather(EWeatherState::Clear); break;
	default:                       SetWeather(EWeatherState::Clear); break;
	}
}

void UWeatherSubsystem::PickNextAutoWeather()
{
	// 70 % du temps on évolue d'un cran, 30 % on revient au beau temps.
	if (FMath::FRand() < 0.30f)
	{
		SetWeather(EWeatherState::Clear);
	}
	else
	{
		CycleWeather();
	}
}

void UWeatherSubsystem::SetHour(float NewHour)
{
	Hour = FMath::Fmod(FMath::Fmod(NewHour, 24.f) + 24.f, 24.f);
}

void UWeatherSubsystem::AdvanceHours(float HoursToAdd)
{
	SetHour(Hour + HoursToAdd);
}

void UWeatherSubsystem::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);

	// ---------------- horloge ----------------
	if (FullDaySeconds > 1.f)
	{
		Hour = FMath::Fmod(Hour + (DeltaTime * 24.f / FullDaySeconds), 24.f);
	}

	// Position du soleil : lever 6 h, zénith 12 h, coucher 18 h.
	const float SunAngle = ((Hour - 6.f) / 12.f) * PI;
	SunDirection = FVector(
		FMath::Cos(SunAngle) * 0.85f,
		0.35f,
		FMath::Sin(SunAngle)).GetSafeNormal();

	// Nuit : le soleil passe sous l'horizon, la lune prend le relais.
	const float SunHeight = SunDirection.Z;
	NightFactor = FMath::Clamp(1.f - (SunHeight + 0.05f) / 0.35f, 0.f, 1.f);
	if (SunHeight < -0.02f)
	{
		SunDirection = FVector(-SunDirection.X, -SunDirection.Y, -SunDirection.Z).GetSafeNormal();
	}

	// ---------------- météo : lissage ----------------
	// Constante de temps 6 s : une averse met ~20 s à s'installer.
	const float Alpha = 1.f - FMath::Exp(-DeltaTime / 6.f);
	Smoothed.Rain = FMath::Lerp(Smoothed.Rain, Target.Rain, Alpha);
	Smoothed.Cloud = FMath::Lerp(Smoothed.Cloud, Target.Cloud, Alpha);
	Smoothed.Fog = FMath::Lerp(Smoothed.Fog, Target.Fog, Alpha);
	Smoothed.Wind = FMath::Lerp(Smoothed.Wind, Target.Wind, Alpha);

	Rain = Smoothed.Rain;
	Cloud = Smoothed.Cloud;
	FogDensity = Smoothed.Fog;
	Wind = Smoothed.Wind;

	// ---------------- mouillage ----------------
	// Montée : ~8 s pour saturer sous une pluie forte.
	// Séchage : ~90 s après l'accalmie (la route reste humide, elle ne sèche
	// pas instantanément — exigence explicite du cahier des charges).
	if (Rain > 0.02f)
	{
		const float RiseRate = 0.55f * Rain;
		Wetness = FMath::Min(1.f, Wetness + RiseRate * DeltaTime);
	}
	else
	{
		const float DryRate = 0.011f;   // ~90 s de 1 → 0
		Wetness = FMath::Max(0.f, Wetness - DryRate * DeltaTime);
	}

	// Adhérence : 1.0 sec, 0.62 détrempé. La pluie directe ajoute un peu de
	// perte (film d'eau) avant même que la surface soit saturée.
	GripFactor = FMath::Lerp(1.f, 0.62f, Wetness) * (1.f - Rain * 0.08f);
	GripFactor = FMath::Clamp(GripFactor, 0.55f, 1.f);

	// ---------------- orage ----------------
	if (CurrentState == EWeatherState::Storm)
	{
		ThunderTimer -= DeltaTime;
		if (ThunderTimer <= 0.f)
		{
			ThunderTimer = FMath::FRandRange(4.f, 11.f);
			OnThunder.Broadcast();
		}
	}

	// ---------------- météo automatique ----------------
	if (bAutoWeather)
	{
		AutoWeatherTimer -= DeltaTime;
		if (AutoWeatherTimer <= 0.f)
		{
			AutoWeatherTimer = FMath::FRandRange(120.f, 240.f);
			PickNextAutoWeather();
		}
	}
}
