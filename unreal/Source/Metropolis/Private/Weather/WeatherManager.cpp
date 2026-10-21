#include "Weather/WeatherManager.h"
#include "Engine/World.h"
#include "TimerManager.h"

FWeatherParams UWeatherManager::ParamsForState(EWeatherState State)
{
	// Valeurs portees du prototype (equilibrees en jeu) - voir core.js.
	FWeatherParams P;
	switch (State)
	{
	case EWeatherState::Clear:  P.RainIntensity = 0.f;  P.CloudCover = 0.05f; P.FogDensity = 0.0012f; P.GripFactor = 1.f;   P.TrafficFactor = 1.f;   break;
	case EWeatherState::Cloudy: P.RainIntensity = 0.f;  P.CloudCover = 0.75f; P.FogDensity = 0.0022f; P.GripFactor = 1.f;   P.TrafficFactor = 0.95f; break;
	case EWeatherState::Rain:   P.RainIntensity = 0.7f; P.CloudCover = 0.9f;  P.FogDensity = 0.0032f; P.GripFactor = 0.74f; P.TrafficFactor = 0.72f; break;
	case EWeatherState::Storm:  P.RainIntensity = 1.f;  P.CloudCover = 1.f;   P.FogDensity = 0.0042f; P.GripFactor = 0.66f; P.TrafficFactor = 0.6f;  P.bLightning = true; break;
	case EWeatherState::Fog:    P.RainIntensity = 0.f;  P.CloudCover = 0.5f;  P.FogDensity = 0.013f;  P.GripFactor = 0.92f; P.TrafficFactor = 0.65f; break;
	}
	return P;
}

void UWeatherManager::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	CurrentParams = TargetParams = ParamsForState(CurrentState);
	GetWorld()->GetTimerManager().SetTimer(TickTimer, this, &UWeatherManager::WeatherTick, 0.1f, true);
}

void UWeatherManager::Deinitialize()
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(TickTimer);
		World->GetTimerManager().ClearTimer(AutoTimer);
	}
	Super::Deinitialize();
}

void UWeatherManager::SetWeather(EWeatherState NewState, bool bInstant)
{
	CurrentState = NewState;
	TargetParams = ParamsForState(NewState);
	if (bInstant)
	{
		CurrentParams = TargetParams;
	}
	OnWeatherChanged.Broadcast(NewState);
	// TODO rendu : pousser RainIntensity/FogDensity vers le Material Parameter
	// Collection global (routes mouillees, flaques) et le brouillard du niveau.
}

void UWeatherManager::CycleWeather()
{
	const int32 Next = (static_cast<int32>(CurrentState) + 1) % 5;
	SetWeather(static_cast<EWeatherState>(Next));
}

void UWeatherManager::WeatherTick()
{
	// Interpolation exponentielle vers la cible (transition douce ~4 s).
	const float K = 1.f - FMath::Exp(-0.1f * 0.25f);
	CurrentParams.RainIntensity = FMath::Lerp(CurrentParams.RainIntensity, TargetParams.RainIntensity, K);
	CurrentParams.CloudCover = FMath::Lerp(CurrentParams.CloudCover, TargetParams.CloudCover, K);
	CurrentParams.FogDensity = FMath::Lerp(CurrentParams.FogDensity, TargetParams.FogDensity, K);
	CurrentParams.GripFactor = FMath::Lerp(CurrentParams.GripFactor, TargetParams.GripFactor, K);
	CurrentParams.TrafficFactor = FMath::Lerp(CurrentParams.TrafficFactor, TargetParams.TrafficFactor, K);
	CurrentParams.bLightning = TargetParams.bLightning && CurrentParams.RainIntensity > 0.6f;
}
