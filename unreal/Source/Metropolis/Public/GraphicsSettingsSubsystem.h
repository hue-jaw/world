// ============================================================================
// METROPOLIS — GraphicsSettingsSubsystem
// Profils graphiques, upscaling et télémétrie de performance.
//
// Règles de vérité appliquées ici (aucune promesse marketing) :
//   • 4 profils + Personnalisé, chaque curseur indépendant ;
//   • DLSS / Reflex / Frame Generation ne sont proposés QUE si le plugin DLSS
//     est compilé (METROPOLIS_WITH_DLSS) et si le matériel le permet ;
//   • Frame Generation est REFUSÉ sur RTX 30 (dont 3050) : la fonction
//     n'existe pas sur cette génération, on ne l'affiche pas « active » ;
//   • le repli est TSR, toujours disponible, sans plugin.
//   • les FPS affichés sont MESURÉS (moyenne mobile du temps de frame),
//     jamais inventés.
// ============================================================================
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "GraphicsSettingsSubsystem.generated.h"

UENUM(BlueprintType)
enum class EQualityPreset : uint8
{
	Low         UMETA(DisplayName = "Bas"),
	Medium      UMETA(DisplayName = "Moyen"),
	High        UMETA(DisplayName = "Élevé"),
	Ultra       UMETA(DisplayName = "Ultra"),
	Custom      UMETA(DisplayName = "Personnalisé"),
};

UENUM(BlueprintType)
enum class EUpscalerMode : uint8
{
	Off             UMETA(DisplayName = "Désactivé (natif)"),
	TSR             UMETA(DisplayName = "TSR (repli)"),
	DLSSQuality     UMETA(DisplayName = "DLSS Qualité"),
	DLSSBalanced    UMETA(DisplayName = "DLSS Équilibré"),
	DLSSPerformance UMETA(DisplayName = "DLSS Performance"),
	DLSSUltra       UMETA(DisplayName = "DLSS Ultra Performance"),
	DLAA            UMETA(DisplayName = "DLAA"),
};

/** Un cran de qualité : chaque valeur est un CVar appliqué réellement. */
USTRUCT(BlueprintType)
struct FQualitySettings
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadWrite) int32 ViewDistance = 2;
	UPROPERTY(BlueprintReadWrite) int32 Shadows = 2;
	UPROPERTY(BlueprintReadWrite) int32 GlobalIllumination = 2;
	UPROPERTY(BlueprintReadWrite) int32 Reflections = 2;
	UPROPERTY(BlueprintReadWrite) int32 Textures = 2;
	UPROPERTY(BlueprintReadWrite) int32 Effects = 2;
	UPROPERTY(BlueprintReadWrite) int32 Foliage = 2;
	UPROPERTY(BlueprintReadWrite) int32 PostProcess = 2;
	UPROPERTY(BlueprintReadWrite) int32 AntiAliasing = 2;
	UPROPERTY(BlueprintReadWrite) bool bHardwareRayTracing = false;
	UPROPERTY(BlueprintReadWrite) bool bVirtualShadowMaps = true;
	UPROPERTY(BlueprintReadWrite) bool bVolumetricFog = true;
	UPROPERTY(BlueprintReadWrite) bool bMotionBlur = false;
	UPROPERTY(BlueprintReadWrite) bool bDepthOfField = true;
};

UCLASS()
class METROPOLIS_API UGraphicsSettingsSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;

	UFUNCTION(BlueprintCallable, Category = "Graphismes")
	void ApplyPreset(EQualityPreset Preset);

	/** Applique un réglage personnalisé (passe en mode Personnalisé). */
	UFUNCTION(BlueprintCallable, Category = "Graphismes")
	void ApplyCustom(const FQualitySettings& Settings);

	UFUNCTION(BlueprintCallable, Category = "Graphismes")
	void SetUpscaler(EUpscalerMode Mode);

	UFUNCTION(BlueprintCallable, Category = "Graphismes")
	void SetFrameGeneration(bool bEnabled);

	UFUNCTION(BlueprintPure, Category = "Graphismes")
	EQualityPreset GetPreset() const { return CurrentPreset; }

	/** Retour par valeur : UHT refuse une référence en retour de UFUNCTION. */
	UFUNCTION(BlueprintPure, Category = "Graphismes")
	FQualitySettings GetSettings() const { return Current; }

	UFUNCTION(BlueprintPure, Category = "Graphismes")
	EUpscalerMode GetUpscaler() const { return Upscaler; }

	// --- Capacités matérielles (mesurées, pas supposées) --------------------
	UFUNCTION(BlueprintPure, Category = "Graphismes")
	bool IsDLSSAvailable() const { return bDLSSAvailable; }

	UFUNCTION(BlueprintPure, Category = "Graphismes")
	bool IsFrameGenerationAvailable() const { return bFrameGenAvailable; }

	/** DLAA exige une résolution native 1080p+ : on le dit au menu. */
	UFUNCTION(BlueprintPure, Category = "Graphismes")
	bool IsReflexAvailable() const { return bDLSSAvailable; }

	UFUNCTION(BlueprintPure, Category = "Graphismes")
	FString GetAdapterName() const { return AdapterName; }

	// --- Télémétrie réelle --------------------------------------------------
	UFUNCTION(BlueprintPure, Category = "Graphismes")
	float GetAverageFrameMs() const { return AverageFrameMs; }

	UFUNCTION(BlueprintPure, Category = "Graphismes")
	float GetAverageFPS() const { return AverageFrameMs > 0.f ? 1000.f / AverageFrameMs : 0.f; }

	UFUNCTION(BlueprintPure, Category = "Graphismes")
	float GetOnePercentLowFPS() const { return OnePercentLowFPS; }

	UFUNCTION(BlueprintCallable, Category = "Graphismes")
	void ResetTelemetry();

	/** À appeler chaque frame par le HUD (échantillonne le temps réel). */
	UFUNCTION(BlueprintCallable, Category = "Graphismes")
	void SampleFrame(float DeltaSeconds);

	UFUNCTION(BlueprintCallable, Category = "Graphismes")
	void SaveToSlot();

	UFUNCTION(BlueprintCallable, Category = "Graphismes")
	bool LoadFromSlot();

private:
	void DetectCapabilities();
	void ApplyCVars();
	static void SetCVar(const TCHAR* Name, float Value);
	static void SetCVarInt(const TCHAR* Name, int32 Value);
	static void SetCVarBool(const TCHAR* Name, bool bValue);

	EQualityPreset CurrentPreset = EQualityPreset::High;
	FQualitySettings Current;
	EUpscalerMode Upscaler = EUpscalerMode::TSR;

	bool bDLSSAvailable = false;
	bool bFrameGenAvailable = false;
	FString AdapterName;

	// 120 dernières frames : assez pour une moyenne stable et un 1 % low.
	TArray<float> FrameHistory;
	float AverageFrameMs = 0.f;
	float OnePercentLowFPS = 0.f;
};
