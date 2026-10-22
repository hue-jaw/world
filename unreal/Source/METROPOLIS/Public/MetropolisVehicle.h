// ============================================================================
// METROPOLIS — MetropolisVehicle
// Véhicule jouable : Chaos Vehicles (suspensions, masse, couple, boîte).
//
// Reprend les réglages validés en v0.6/v0.9 (rayon de roue, empattement,
// garde au sol, vitesse max) et les transplante sur le vrai modèle physique
// du moteur : ici, c'est le moteur qui simule — pas un déplacement cinématique.
//
// Le véhicule lit la météo (adhérence) et la surface sous ses roues
// (asphalte / pavé / terre-plein) pour moduler son comportement.
// ============================================================================
#pragma once

#include "CoreMinimal.h"
#include "WheeledVehiclePawn.h"
#include "Interaction/Interactable.h"
#include "MetropolisVehicle.generated.h"

class UChaosWheeledVehicleMovementComponent;
class UVehicleDataAsset;
class UInputMappingContext;
class UInputAction;
class UCameraComponent;
class USpringArmComponent;
struct FInputActionValue;

UENUM(BlueprintType)
enum class EVehicleCameraMode : uint8
{
	Chase,
	Hood,
	Cockpit,
	Orbit,
};

UCLASS(BlueprintType)
class METROPOLIS_API AMetropolisVehicle : public AWheeledVehiclePawn, public IInteractable
{
	GENERATED_BODY()

public:
	AMetropolisVehicle();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;
	virtual void PossessedBy(AController* NewController) override;

	// --- Conduite -----------------------------------------------------------
	UFUNCTION(BlueprintCallable, Category = "Véhicule")
	void SetThrottle(float Value);

	UFUNCTION(BlueprintCallable, Category = "Véhicule")
	void SetSteering(float Value);

	UFUNCTION(BlueprintCallable, Category = "Véhicule")
	void SetBrake(float Value);

	UFUNCTION(BlueprintCallable, Category = "Véhicule")
	void ToggleHandbrake();

	/** Cyclique : Chase → Hood → Cockpit → Orbit. */
	UFUNCTION(BlueprintCallable, Category = "Véhicule")
	void CycleCamera();

	UFUNCTION(BlueprintCallable, Category = "Véhicule")
	void SetCameraMode(EVehicleCameraMode NewMode);

	UFUNCTION(BlueprintPure, Category = "Véhicule")
	float GetSpeedKph() const;

	UFUNCTION(BlueprintPure, Category = "Véhicule")
	float GetEngineRPM() const;

	UFUNCTION(BlueprintPure, Category = "Véhicule")
	int32 GetGear() const;

	/** Surface dominante sous les roues (nom de Physical Material). */
	UFUNCTION(BlueprintPure, Category = "Véhicule")
	FName GetDominantSurface() const { return DominantSurface; }

	/** Fiche data-driven du modèle (nom, performances, poids dans le trafic). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Véhicule")
	TObjectPtr<UVehicleDataAsset> VehicleData;

	// --- IInteractable ------------------------------------------------------
	virtual FText GetInteractionPrompt_Implementation(APawn* Interactor) const override;
	virtual bool Interact_Implementation(APawn* Interactor) override;
	virtual float GetInteractionRange_Implementation() const override;

	UFUNCTION(BlueprintCallable, Category = "Véhicule")
	void SetDriverVisible(bool bVisible);

	/** Demande de sortie : implémentée par le PlayerController via ce Blueprint event. */
	UFUNCTION(BlueprintImplementableEvent, Category = "Véhicule")
	void OnExitRequested();

	// --- Réglages exposés en Blueprint -------------------------------------
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Véhicule")
	float MaxSpeedKph = 190.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Véhicule")
	float EngineTorqueScale = 1.0f;

	/**
	 * Adhérence courante (1 = sec, ~0,6 = détrempé), diffusée chaque image.
	 *
	 * IMPORTANT — ce que le code peut et ne peut pas faire :
	 * Chaos Vehicles calcule le frottement latéral depuis la COURBE DE PNEU
	 * (FChaosTireConfig, un asset édité dans le Blueprint du véhicule), pas
	 * depuis une simple valeur runtime. On expose donc la donnée, et c'est le
	 * Blueprint du pneu qui la consomme (SetFrictionCurve / Multiplier).
	 * Aucun effet n'est simulé ici pour « faire semblant » : sans Blueprint
	 * configuré, le grip reste celui du pneu sec.
	 */
	UFUNCTION(BlueprintImplementableEvent, Category = "Véhicule")
	void OnGripUpdated(float GripFactor, FName SurfaceName);

	/** Hauteur de l'essieu par rapport au châssis (cm). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Véhicule")
	float SpringHeight = 22.f;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Véhicule")
	TObjectPtr<USpringArmComponent> CameraBoom;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Véhicule")
	TObjectPtr<UCameraComponent> ChaseCamera;

	UPROPERTY(BlueprintReadOnly, Category = "Véhicule")
	EVehicleCameraMode CameraMode = EVehicleCameraMode::Chase;

protected:
	virtual void OnThrottleInput(const FInputActionValue& Value);
	virtual void OnSteerInput(const FInputActionValue& Value);
	virtual void OnBrakeInput(const FInputActionValue& Value);
	virtual void OnHandbrakeStarted();
	virtual void OnHandbrakeCompleted();
	virtual void OnCameraInput();
	virtual void OnExitVehicle();

	void ApplyWetGrip(float GripFactor);
	void ProbeSurface();

	UPROPERTY(EditDefaultsOnly, Category = "Entrées")
	TObjectPtr<UInputMappingContext> DrivingContext;

	UPROPERTY(EditDefaultsOnly, Category = "Entrées")
	TObjectPtr<UInputAction> ThrottleAction;

	UPROPERTY(EditDefaultsOnly, Category = "Entrées")
	TObjectPtr<UInputAction> SteerAction;

	UPROPERTY(EditDefaultsOnly, Category = "Entrées")
	TObjectPtr<UInputAction> BrakeAction;

	UPROPERTY(EditDefaultsOnly, Category = "Entrées")
	TObjectPtr<UInputAction> HandbrakeAction;

	UPROPERTY(EditDefaultsOnly, Category = "Entrées")
	TObjectPtr<UInputAction> CameraAction;

	UPROPERTY(EditDefaultsOnly, Category = "Entrées")
	TObjectPtr<UInputAction> ExitAction;

private:
	UPROPERTY()
	TObjectPtr<UChaosWheeledVehicleMovementComponent> VehicleMovement;

	FName DominantSurface = TEXT("Asphalt");
	float BaseWheelFriction = 3.0f;
	bool bHandbrake = false;
	float CameraBlend = 0.f;
};
