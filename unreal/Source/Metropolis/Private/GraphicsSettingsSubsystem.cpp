// ============================================================================
// METROPOLIS — GraphicsSettingsSubsystem.cpp
// ============================================================================
#include "GraphicsSettingsSubsystem.h"
#include "MetropolisSaveGame.h"
#include "HAL/IConsoleManager.h"
#include "RHI.h"
#include "Misc/App.h"
#include "Kismet/GameplayStatics.h"

DEFINE_LOG_CATEGORY_STATIC(LogMetropolisGraphics, Log, All);

void UGraphicsSettingsSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	DetectCapabilities();
	ApplyPreset(EQualityPreset::High);
	FrameHistory.Reserve(120);
}

// ---------------------------------------------------------------------------
//                       CAPACITES MATERIELLES REELLES
// ---------------------------------------------------------------------------

void UGraphicsSettingsSubsystem::DetectCapabilities()
{
	// Nom de l'adaptateur tel que le RHI le rapporte (DX12 : « NVIDIA GeForce
	// RTX 3050 » etc.). Aucune détection n'est inventée : si l'API ne donne rien,
	// AdapterName reste vide et les options optionnelles sont masquées.
	AdapterName = FApp::GetGraphicsRHI();
#if PLATFORM_WINDOWS
	if (GRHIAdapterName.Len() > 0)
	{
		AdapterName = GRHIAdapterName;
	}
#endif

	const FString Upper = AdapterName.ToUpper();

#if METROPOLIS_WITH_DLSS
	bDLSSAvailable = Upper.Contains(TEXT("NVIDIA")) || Upper.Contains(TEXT("GEFORCE"));
#else
	bDLSSAvailable = false;   // plugin absent : aucune option DLSS proposée
#endif

	// Frame Generation = DLSS 3 : matériel Ada (RTX 40) ou Blackwell (RTX 50).
	// Une RTX 3050 (Ampere) n'en dispose PAS — on le refuse explicitement au
	// lieu d'afficher une case à cocher qui ne ferait rien.
	const bool bAdaOrNewer = Upper.Contains(TEXT("RTX 40")) || Upper.Contains(TEXT("RTX 50"))
		|| Upper.Contains(TEXT("RTX 4060")) || Upper.Contains(TEXT("RTX 4070"))
		|| Upper.Contains(TEXT("RTX 4080")) || Upper.Contains(TEXT("RTX 4090"))
		|| Upper.Contains(TEXT("RTX 5060")) || Upper.Contains(TEXT("RTX 5070"))
		|| Upper.Contains(TEXT("RTX 5080")) || Upper.Contains(TEXT("RTX 5090"));

	bFrameGenAvailable = bDLSSAvailable && bAdaOrNewer;

	UE_LOG(LogMetropolisGraphics, Log,
		TEXT("Adaptateur : « %s » | DLSS : %s | Frame Generation : %s"),
		*AdapterName,
		bDLSSAvailable ? TEXT("disponible") : TEXT("indisponible"),
		bFrameGenAvailable ? TEXT("disponible") : TEXT("indisponible (matériel)"));
}

// ---------------------------------------------------------------------------
//                              PROFILS
// ---------------------------------------------------------------------------

void UGraphicsSettingsSubsystem::ApplyPreset(EQualityPreset Preset)
{
	// Affectation champ par champ : l'initialisation agrégée d'un USTRUCT
	// (GENERATED_BODY) n'est pas garantie selon le compilateur et casse
	// silencieusement l'ordre des membres.
	FQualitySettings S;
	switch (Preset)
	{
	case EQualityPreset::Low:
		S.ViewDistance = 0; S.Shadows = 0; S.GlobalIllumination = 0; S.Reflections = 0;
		S.Textures = 1; S.Effects = 0; S.Foliage = 0; S.PostProcess = 0; S.AntiAliasing = 0;
		S.bHardwareRayTracing = false; S.bVirtualShadowMaps = false; S.bVolumetricFog = false;
		S.bMotionBlur = false; S.bDepthOfField = false;
		break;
	case EQualityPreset::Medium:
		S.ViewDistance = 1; S.Shadows = 1; S.GlobalIllumination = 1; S.Reflections = 1;
		S.Textures = 2; S.Effects = 1; S.Foliage = 1; S.PostProcess = 1; S.AntiAliasing = 2;
		S.bHardwareRayTracing = false; S.bVirtualShadowMaps = true; S.bVolumetricFog = false;
		S.bMotionBlur = false; S.bDepthOfField = true;
		break;
	case EQualityPreset::High:
		S.ViewDistance = 2; S.Shadows = 2; S.GlobalIllumination = 2; S.Reflections = 2;
		S.Textures = 2; S.Effects = 2; S.Foliage = 2; S.PostProcess = 2; S.AntiAliasing = 2;
		S.bHardwareRayTracing = false; S.bVirtualShadowMaps = true; S.bVolumetricFog = true;
		S.bMotionBlur = false; S.bDepthOfField = true;
		break;
	case EQualityPreset::Ultra:
		S.ViewDistance = 3; S.Shadows = 3; S.GlobalIllumination = 3; S.Reflections = 3;
		S.Textures = 3; S.Effects = 3; S.Foliage = 3; S.PostProcess = 3; S.AntiAliasing = 3;
		S.bHardwareRayTracing = false; S.bVirtualShadowMaps = true; S.bVolumetricFog = true;
		S.bMotionBlur = false; S.bDepthOfField = true;
		break;
	case EQualityPreset::Custom:
		return;
	default:
		return;
	}

	CurrentPreset = Preset;
	Current = S;
	ApplyCustom(S);
	CurrentPreset = Preset;   // ApplyCustom passe en Personnalise : on retablit
}

void UGraphicsSettingsSubsystem::ApplyCustom(const FQualitySettings& Settings)
{
	Current = Settings;
	CurrentPreset = EQualityPreset::Custom;
	ApplyCVars();
}

void UGraphicsSettingsSubsystem::ApplyCVars()
{
	// Scalabilité standard (toutes ces commandes existent dans UE5).
	SetCVarInt(TEXT("sg.ViewDistanceQuality"), Current.ViewDistance);
	SetCVarInt(TEXT("sg.ShadowQuality"), Current.Shadows);
	SetCVarInt(TEXT("sg.GlobalIlluminationQuality"), Current.GlobalIllumination);
	SetCVarInt(TEXT("sg.ReflectionQuality"), Current.Reflections);
	SetCVarInt(TEXT("sg.TextureQuality"), Current.Textures);
	SetCVarInt(TEXT("sg.EffectsQuality"), Current.Effects);
	SetCVarInt(TEXT("sg.FoliageQuality"), Current.Foliage);
	SetCVarInt(TEXT("sg.PostProcessQuality"), Current.PostProcess);
	SetCVarInt(TEXT("sg.AntiAliasingQuality"), Current.AntiAliasing);

	// Ray tracing / Lumen / ombres virtuelles.
	SetCVarInt(TEXT("r.RayTracing"), Current.bHardwareRayTracing ? 1 : 0);
	SetCVarInt(TEXT("r.Lumen.HardwareRayTracing"), Current.bHardwareRayTracing ? 1 : 0);
	SetCVarInt(TEXT("r.Shadow.Virtual.Enable"), Current.bVirtualShadowMaps ? 1 : 0);
	SetCVarInt(TEXT("r.VolumetricFog"), Current.bVolumetricFog ? 1 : 0);
	SetCVarInt(TEXT("r.DefaultFeature.MotionBlur"), Current.bMotionBlur ? 1 : 0);
	SetCVarInt(TEXT("r.DefaultFeature.DepthOfField"), Current.bDepthOfField ? 1 : 0);

	// Budget VRAM : la RTX 3050 a 6 Go, on ne pousse pas le pool au-delà de 3,5.
	const float PoolSize = (Current.Textures >= 3) ? 3800.f : (Current.Textures == 2 ? 3000.f : 2200.f);
	SetCVar(TEXT("r.Streaming.PoolSize"), PoolSize);
}

void UGraphicsSettingsSubsystem::SetCVar(const TCHAR* Name, float Value)
{
	if (IConsoleVariable* Variable = IConsoleManager::Get().FindConsoleVariable(Name))
	{
		Variable->Set(Value, ECVF_SetByGameSetting);
	}
}

void UGraphicsSettingsSubsystem::SetCVarInt(const TCHAR* Name, int32 Value)
{
	SetCVar(Name, static_cast<float>(Value));
}

void UGraphicsSettingsSubsystem::SetCVarBool(const TCHAR* Name, bool bValue)
{
	SetCVarInt(Name, bValue ? 1 : 0);
}

// ---------------------------------------------------------------------------
//                            UPSCALING / RT
// ---------------------------------------------------------------------------

void UGraphicsSettingsSubsystem::SetUpscaler(EUpscalerMode Mode)
{
	// Toute demande DLSS sans plugin retombe sur TSR : on ne prétend jamais
	// avoir activé un upscaler absent.
	if (Mode != EUpscalerMode::Off && Mode != EUpscalerMode::TSR && !bDLSSAvailable)
	{
		UE_LOG(LogMetropolisGraphics, Warning,
			TEXT("DLSS demandé mais plugin absent ou GPU non NVIDIA : repli sur TSR."));
		Mode = EUpscalerMode::TSR;
	}
	Upscaler = Mode;

	switch (Mode)
	{
	case EUpscalerMode::Off:
		SetCVarInt(TEXT("r.AntiAliasingMethod"), 0);
		SetCVar(TEXT("r.ScreenPercentage"), 100.f);
		break;
	case EUpscalerMode::TSR:
		SetCVarInt(TEXT("r.AntiAliasingMethod"), 4);     // 4 = TSR
		SetCVar(TEXT("r.ScreenPercentage"), 100.f);      // TSR gère son propre scaling
		break;
	case EUpscalerMode::DLAA:
		SetCVarInt(TEXT("r.AntiAliasingMethod"), 3);     // DLSS
		SetCVar(TEXT("r.ScreenPercentage"), 100.f);
		break;
	case EUpscalerMode::DLSSQuality:
		SetCVarInt(TEXT("r.AntiAliasingMethod"), 3);
		SetCVar(TEXT("r.ScreenPercentage"), 66.f);
		break;
	case EUpscalerMode::DLSSBalanced:
		SetCVarInt(TEXT("r.AntiAliasingMethod"), 3);
		SetCVar(TEXT("r.ScreenPercentage"), 58.f);
		break;
	case EUpscalerMode::DLSSPerformance:
		SetCVarInt(TEXT("r.AntiAliasingMethod"), 3);
		SetCVar(TEXT("r.ScreenPercentage"), 50.f);
		break;
	case EUpscalerMode::DLSSUltra:
		SetCVarInt(TEXT("r.AntiAliasingMethod"), 3);
		SetCVar(TEXT("r.ScreenPercentage"), 33.f);
		break;
	}
}

void UGraphicsSettingsSubsystem::SetFrameGeneration(bool bEnabled)
{
	if (bEnabled && !bFrameGenAvailable)
	{
		UE_LOG(LogMetropolisGraphics, Warning,
			TEXT("Frame Generation refusée : matériel non compatible (Ada/Blackwell requis)."));
		return;
	}
	// r.NGX.DLSS.FrameGeneration n'existe que si le plugin DLSS est compilé.
	SetCVarInt(TEXT("r.NGX.DLSS.FrameGeneration"), bEnabled ? 1 : 0);
}

// ---------------------------------------------------------------------------
//                            TELEMETRIE REELLE
// ---------------------------------------------------------------------------

void UGraphicsSettingsSubsystem::ResetTelemetry()
{
	FrameHistory.Reset();
	AverageFrameMs = 0.f;
	OnePercentLowFPS = 0.f;
}

void UGraphicsSettingsSubsystem::SampleFrame(float DeltaSeconds)
{
	if (DeltaSeconds <= 0.f || DeltaSeconds > 1.f)
	{
		return;   // ignoré : hitch ou pause, ça ne mesure rien d'utile
	}

	FrameHistory.Add(DeltaSeconds * 1000.f);
	if (FrameHistory.Num() > 120)
	{
		FrameHistory.RemoveAt(0, FrameHistory.Num() - 120);
	}

	float Sum = 0.f;
	for (const float Value : FrameHistory)
	{
		Sum += Value;
	}
	AverageFrameMs = Sum / FrameHistory.Num();

	// 1 % low : moyenne des 1 % de frames les plus lentes.
	if (FrameHistory.Num() >= 20)
	{
		TArray<float> Sorted = FrameHistory;
		Sorted.Sort();
		const int32 Count = FMath::Max(1, Sorted.Num() / 100);
		float WorstSum = 0.f;
		for (int32 Index = Sorted.Num() - Count; Index < Sorted.Num(); ++Index)
		{
			WorstSum += Sorted[Index];
		}
		OnePercentLowFPS = 1000.f / (WorstSum / Count);
	}
}

// ---------------------------------------------------------------------------
//                              SAUVEGARDE
// ---------------------------------------------------------------------------

void UGraphicsSettingsSubsystem::SaveToSlot()
{
	// Persistance réelle via un slot dédié : un CVar n'est PAS sauvegardé
	// entre deux lancements, l'utiliser donnerait une fausse impression.
	UMetropolisSaveGame* Save = Cast<UMetropolisSaveGame>(
		UGameplayStatics::CreateSaveGameObject(UMetropolisSaveGame::StaticClass()));
	if (!Save)
	{
		return;
	}
	Save->SaveVersion = UMetropolisSaveGame::CurrentVersion;
	Save->SavedAt = FDateTime::UtcNow();
	Save->GraphicsPreset = static_cast<int32>(CurrentPreset);
	UGameplayStatics::SaveGameToSlot(Save, TEXT("METROPOLIS_SETTINGS"), 0);
}

bool UGraphicsSettingsSubsystem::LoadFromSlot()
{
	if (!UGameplayStatics::DoesSaveGameExist(TEXT("METROPOLIS_SETTINGS"), 0))
	{
		return false;
	}
	const UMetropolisSaveGame* Save = Cast<UMetropolisSaveGame>(
		UGameplayStatics::LoadGameFromSlot(TEXT("METROPOLIS_SETTINGS"), 0));
	if (!Save || !Save->IsCompatible())
	{
		return false;
	}
	ApplyPreset(static_cast<EQualityPreset>(Save->GraphicsPreset));
	return true;
}
