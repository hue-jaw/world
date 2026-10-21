#include "Weather/TimeOfDayManager.h"
#include "Components/DirectionalLightComponent.h"
#include "Engine/DirectionalLight.h"
#include "EngineUtils.h"

ATimeOfDayManager::ATimeOfDayManager()
{
	PrimaryActorTick.bCanEverTick = true;
}

void ATimeOfDayManager::BeginPlay()
{
	Super::BeginPlay();
	if (!SunLight)
	{
		for (TActorIterator<ADirectionalLight> It(GetWorld()); It; ++It)
		{
			SunLight = *It;
			break;
		}
	}
	ApplySun();
}

void ATimeOfDayManager::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	TimeHours = FMath::Fmod(TimeHours + DeltaSeconds * TimeScale * 24.f / DayLengthSeconds, 24.f);
	ApplySun();
}

float ATimeOfDayManager::GetNightFactor() const
{
	// Elevation solaire : -1 a minuit, +1 a midi (formule validee dans le prototype).
	const float Elev = FMath::Sin((TimeHours - 6.f) / 12.f * PI);
	return FMath::Clamp(1.f - (Elev + 0.05f) / 0.35f, 0.f, 1.f);
}

void ATimeOfDayManager::ApplySun()
{
	if (!SunLight) return;

	// Le soleil decrit un arc est->ouest ; pitch negatif = au-dessus de l'horizon.
	const float DayProgress = FMath::Clamp((TimeHours - 6.f) / 12.f, 0.f, 1.f);
	const float SunPitch = -FMath::Sin(DayProgress * PI) * 65.f;
	const float SunYaw = FMath::Lerp(-90.f, 270.f, DayProgress);
	SunLight->SetActorRotation(FRotator(SunPitch, SunYaw, 0.f));

	if (UDirectionalLightComponent* LightComp = Cast<UDirectionalLightComponent>(SunLight->GetLightComponent()))
	{
		const bool bIsDay = TimeHours > 5.4f && TimeHours < 20.2f;
		// La nuit, la meme source joue la lune (bleue, faible) - les vraies
		// keyframes de couleur/intensite sont dans environment.js (SKY_KEYS)
		// et seront portees ici sous forme de courbe (UCurveLinearColor).
		LightComp->SetIntensity(bIsDay ? 3.f : 0.25f);
		LightComp->SetLightColor(bIsDay ? FLinearColor(1.f, 0.95f, 0.88f) : FLinearColor(0.55f, 0.68f, 1.f));
	}
}
