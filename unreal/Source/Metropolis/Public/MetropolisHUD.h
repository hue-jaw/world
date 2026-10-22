// ============================================================================
// METROPOLIS — MetropolisHUD
// HUD dessiné en Canvas : aucun asset requis, donc visible dès la première
// compilation. Il affiche des données RÉELLES (vitesse du véhicule, rapport,
// manœuvre GPS, météo, FPS mesurés).
//
// Le HUD final (UGM UMG) est un Blueprint ; celui-ci reste le repli
// fonctionnel et sert aux captures de vérification.
// ============================================================================
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "MetropolisHUD.generated.h"

UCLASS()
class METROPOLIS_API AMetropolisHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void DrawHUD() override;

	UFUNCTION(BlueprintCallable, Category = "HUD")
	void SetHUDVisible(bool bVisible) { bDrawHUD = bVisible; }

	UFUNCTION(BlueprintPure, Category = "HUD")
	bool IsHUDVisible() const { return bDrawHUD; }

	UFUNCTION(BlueprintCallable, Category = "HUD")
	void ToggleHUD() { bDrawHUD = !bDrawHUD; }

private:
	void DrawSpeedometer(const FString& Speed, const FString& Gear);
	void DrawCompass();
	void DrawGPSPanel();
	void DrawWeatherPanel();
	void DrawPerformancePanel();

	bool bDrawHUD = true;
};
