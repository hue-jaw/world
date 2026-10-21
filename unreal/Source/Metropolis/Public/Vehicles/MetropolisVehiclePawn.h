#pragma once

#include "CoreMinimal.h"
#include "WheeledVehiclePawn.h"
#include "Interaction/Interactable.h"
#include "MetropolisVehiclePawn.generated.h"

class UInputMappingContext;
class UInputAction;
class UVehicleDataAsset;
class AMetropolisCharacter;
struct FInputActionValue;

/**
 * Vehicule conduisible base sur Chaos Vehicles (brief section 5).
 * - Implemente IInteractable : le personnage "entre" via l'interaction
 *   generique (possession), ressort par l'action Exit.
 * - Conduite : throttle / steering / brake / handbrake via Enhanced Input.
 * - Les degats et l'etat mecanique sont suivis ici (0..1) ; la deformation
 *   visuelle est branchee en Phase 4 (materiaux + morph/decal).
 * Assets requis (cf. unreal/README.md) : roues Chaos derivees de
 * UChaosVehicleWheel, Physics Asset sur le mesh, IA_Drive etc.
 */
UCLASS()
class METROPOLIS_API AMetropolisVehiclePawn : public AWheeledVehiclePawn, public IInteractable
{
	GENERATED_BODY()

public:
	AMetropolisVehiclePawn();

	virtual void Tick(float DeltaSeconds) override;

	// --- IInteractable ---
	virtual FText GetInteractionPrompt_Implementation(APawn* Interactor) const override;
	virtual bool Interact_Implementation(APawn* Interactor) override;
	virtual float GetInteractionRange_Implementation() const override { return 360.f; }

	/** Niveau de degats mecaniques/visuels cumules (0 = neuf, 1 = epave). */
	UPROPERTY(BlueprintReadOnly, Category = "Metropolis|Vehicle")
	float Damage01 = 0.f;

	UFUNCTION(BlueprintCallable, Category = "Metropolis|Vehicle")
	void ApplyDamage(float Amount01);

	/** Phares allumes (pilotage : automatique nuit/pluie + touche joueur). */
	UFUNCTION(BlueprintCallable, Category = "Metropolis|Vehicle")
	void SetHeadlights(bool bOn);

	UPROPERTY(BlueprintReadOnly, Category = "Metropolis|Vehicle")
	bool bHeadlightsOn = false;

protected:
	virtual void BeginPlay() override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Metropolis|Vehicle")
	TObjectPtr<UVehicleDataAsset> VehicleData;

	UPROPERTY(EditAnywhere, Category = "Metropolis|Input")
	TObjectPtr<UInputMappingContext> DrivingMappingContext;

	UPROPERTY(EditAnywhere, Category = "Metropolis|Input")
	TObjectPtr<UInputAction> ThrottleAction;

	UPROPERTY(EditAnywhere, Category = "Metropolis|Input")
	TObjectPtr<UInputAction> SteeringAction;

	UPROPERTY(EditAnywhere, Category = "Metropolis|Input")
	TObjectPtr<UInputAction> BrakeAction;

	UPROPERTY(EditAnywhere, Category = "Metropolis|Input")
	TObjectPtr<UInputAction> HandbrakeAction;

	UPROPERTY(EditAnywhere, Category = "Metropolis|Input")
	TObjectPtr<UInputAction> ExitVehicleAction;

	void OnThrottle(const FInputActionValue& Value);
	void OnSteering(const FInputActionValue& Value);
	void OnBrake(const FInputActionValue& Value);
	void OnHandbrakeStarted();
	void OnHandbrakeCompleted();
	void OnExitVehicle();

private:
	/** Conducteur a re-posseder en sortant. */
	TWeakObjectPtr<AMetropolisCharacter> LastDriver;
};
