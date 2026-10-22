// ============================================================================
// METROPOLIS — MetropolisHUD.cpp
// ============================================================================
#include "MetropolisHUD.h"
#include "MetropolisVehicle.h"
#include "GPSSubsystem.h"
#include "WeatherSubsystem.h"
#include "GraphicsSettingsSubsystem.h"
#include "MetropolisTypes.h"

#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"
#include "Engine/World.h"

namespace
{
	const FLinearColor Ink(0.94f, 0.96f, 1.0f, 0.95f);
	const FLinearColor Accent(0.20f, 0.72f, 1.0f, 1.0f);
	const FLinearColor Warn(1.0f, 0.62f, 0.18f, 1.0f);
	const FLinearColor Panel(0.02f, 0.04f, 0.07f, 0.55f);

	FString ManeuverLabel(EGPSManeuver Type)
	{
		switch (Type)
		{
		case EGPSManeuver::Straight:     return TEXT("TOUT DROIT");
		case EGPSManeuver::TurnLeft:     return TEXT("A GAUCHE");
		case EGPSManeuver::TurnRight:    return TEXT("A DROITE");
		case EGPSManeuver::SlightLeft:   return TEXT("LEGEREMENT A GAUCHE");
		case EGPSManeuver::SlightRight:  return TEXT("LEGEREMENT A DROITE");
		case EGPSManeuver::UTurn:        return TEXT("DEMI-TOUR");
		case EGPSManeuver::Roundabout:   return TEXT("ROND-POINT");
		case EGPSManeuver::Arrive:       return TEXT("ARRIVEE");
		default:                         return TEXT("—");
		}
	}

	FString WeatherLabel(EWeatherState State)
	{
		switch (State)
		{
		case EWeatherState::Clear:     return TEXT("DEGAGE");
		case EWeatherState::Cloudy:    return TEXT("NUAGEUX");
		case EWeatherState::Overcast:  return TEXT("COUVERT");
		case EWeatherState::LightRain: return TEXT("PLUIE FAIBLE");
		case EWeatherState::HeavyRain: return TEXT("FORTE PLUIE");
		case EWeatherState::Storm:     return TEXT("ORAGE");
		case EWeatherState::Fog:       return TEXT("BROUILLARD");
		}
		return TEXT("—");
	}
}

void AMetropolisHUD::DrawHUD()
{
	Super::DrawHUD();
	if (!bDrawHUD || !Canvas)
	{
		return;
	}

	const UWorld* World = GetWorld();
	const APlayerController* PC = World ? World->GetFirstPlayerController() : nullptr;
	if (!PC)
	{
		return;
	}

	if (const AMetropolisVehicle* Vehicle = Cast<AMetropolisVehicle>(PC->GetPawn()))
	{
		DrawSpeedometer(FString::Printf(TEXT("%d"), FMath::RoundToInt(Vehicle->GetSpeedKph())),
			FString::Printf(TEXT("%d"), Vehicle->GetGear()));
	}
	else
	{
		DrawSpeedometer(TEXT("—"), TEXT("P"));
	}

	DrawCompass();
	DrawGPSPanel();
	DrawWeatherPanel();
	DrawPerformancePanel();
}

void AMetropolisHUD::DrawSpeedometer(const FString& Speed, const FString& Gear)
{
	// Panneau bas-droit, typographie monospace pour que ça reste lisible à
	// n'importe quelle résolution (le HUD est en unités de canvas).
	const float X = Canvas->ClipX - 250.f;
	const float Y = Canvas->ClipY - 150.f;

	DrawRect(Panel, X - 16.f, Y - 16.f, 234.f, 128.f);
	DrawText(Speed, Accent, X, Y, GEngine->GetLargeFont(), 3.0f);
	DrawText(TEXT("km/h"), Ink, X + 150.f, Y + 44.f, GEngine->GetSmallFont(), 1.3f);
	DrawText(FString::Printf(TEXT("Rapport %s"), *Gear), Ink, X, Y + 78.f, GEngine->GetSmallFont(), 1.1f);
}

void AMetropolisHUD::DrawCompass()
{
	// Bandeau de cap en haut au centre : N / E / S / O avec les degrés.
	const APlayerController* PC = GetOwningPlayerController();
	if (!PC)
	{
		return;
	}
	const float Yaw = PC->GetControlRotation().Yaw;
	const float CenterX = Canvas->ClipX * 0.5f;

	DrawRect(Panel, CenterX - 150.f, 14.f, 300.f, 34.f);

	const FString Cardinal =
		(Yaw > -45.f && Yaw <= 45.f) ? TEXT("EST") :
		(Yaw > 45.f && Yaw <= 135.f) ? TEXT("NORD") :
		(Yaw > 135.f || Yaw <= -135.f) ? TEXT("OUEST") : TEXT("SUD");

	const FString Label = FString::Printf(TEXT("%s   %03d°"), *Cardinal, FMath::RoundToInt(FMath::Fmod(Yaw + 360.f, 360.f)));
	DrawText(Label, Ink, CenterX - 84.f, 20.f, GEngine->GetSmallFont(), 1.4f);
}

void AMetropolisHUD::DrawGPSPanel()
{
	UGPSSubsystem* GPS = GetWorld() ? GetWorld()->GetSubsystem<UGPSSubsystem>() : nullptr;
	if (!GPS || !GPS->HasRoute())
	{
		return;
	}

	const FGPSManeuver Maneuver = GPS->GetNextManeuver();
	const float X = 24.f;
	const float Y = Canvas->ClipY - 176.f;

	DrawRect(Panel, X - 12.f, Y - 12.f, 460.f, 116.f);
	DrawText(ManeuverLabel(Maneuver.Type), Accent, X, Y + 8.f, GEngine->GetMediumFont(), 1.5f);
	DrawText(FString::Printf(TEXT("dans %d m"), FMath::RoundToInt(Maneuver.DistanceMeters)),
		Ink, X, Y + 42.f, GEngine->GetSmallFont(), 1.3f);

	// Distance totale et heure d'arrivée estimée.
	const int32 TotalMeters = FMath::RoundToInt(GPS->GetRemainingMeters());
	const int32 EtaSeconds = FMath::RoundToInt(GPS->GetRemainingSeconds());
	DrawText(FString::Printf(TEXT("%d m  •  %d min %02d s"), TotalMeters, EtaSeconds / 60, EtaSeconds % 60),
		Ink, X, Y + 72.f, GEngine->GetSmallFont(), 1.1f);
}

void AMetropolisHUD::DrawWeatherPanel()
{
	const UWeatherSubsystem* Weather = GetWorld() ? GetWorld()->GetSubsystem<UWeatherSubsystem>() : nullptr;
	if (!Weather)
	{
		return;
	}

	const float X = 24.f;
	const float Y = 24.f;
	DrawRect(Panel, X - 12.f, Y - 12.f, 330.f, 92.f);

	const int32 Hours = FMath::FloorToInt(Weather->GetHour());
	const int32 Minutes = FMath::FloorToInt(FMath::Frac(Weather->GetHour()) * 60.f);
	DrawText(FString::Printf(TEXT("%02d:%02d   %s"), Hours, Minutes, *WeatherLabel(Weather->GetWeather())),
		Ink, X, Y, GEngine->GetSmallFont(), 1.3f);

	// Mouillage : la donnée qui change le comportement du véhicule.
	const FString WetnessLabel = FString::Printf(TEXT("Surfaces mouillees : %d %%"),
		FMath::RoundToInt(Weather->GetWetness() * 100.f));
	DrawText(WetnessLabel, Weather->GetWetness() > 0.5f ? Warn : Ink,
		X, Y + 30.f, GEngine->GetSmallFont(), 1.0f);
	DrawText(FString::Printf(TEXT("Adherence : %d %%"), FMath::RoundToInt(Weather->GetGripFactor() * 100.f)),
		Ink, X, Y + 54.f, GEngine->GetSmallFont(), 1.0f);
}

void AMetropolisHUD::DrawPerformancePanel()
{
	const UGraphicsSettingsSubsystem* Graphics =
		GetGameInstance() ? GetGameInstance()->GetSubsystem<UGraphicsSettingsSubsystem>() : nullptr;
	if (!Graphics)
	{
		return;
	}

	// FPS mesurés (moyenne 120 frames) + 1 % low : jamais une valeur inventée.
	const FString Text = FString::Printf(TEXT("%.0f FPS  •  1%% low %.0f  •  %.1f ms"),
		Graphics->GetAverageFPS(), Graphics->GetOnePercentLowFPS(), Graphics->GetAverageFrameMs());

	DrawRect(Panel, Canvas->ClipX - 330.f, 24.f, 306.f, 34.f);
	DrawText(Text, Ink, Canvas->ClipX - 320.f, 32.f, GEngine->GetSmallFont(), 1.1f);
}
