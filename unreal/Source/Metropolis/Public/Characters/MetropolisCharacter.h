#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "InputActionValue.h"
#include "MetropolisCharacter.generated.h"

class USpringArmComponent;
class UCameraComponent;
class UInputMappingContext;
class UInputAction;

/**
 * Personnage joueur troisieme personne (brief section 13).
 * - Locomotion : marche / sprint / saut (CharacterMovement natif).
 * - Camera : SpringArm (boom) oriente par la souris.
 * - Interaction generique : detecte l'IInteractable le plus proche
 *   (vehicules, portes, objets) et declenche son Interact().
 * Les Input Actions / Mapping Contexts sont des assets editeur
 * (IA_Move, IA_Look, IA_Jump, IA_Sprint, IA_Interact, IMC_Player)
 * a creer selon unreal/README.md.
 */
UCLASS()
class METROPOLIS_API AMetropolisCharacter : public ACharacter
{
	GENERATED_BODY()

public:
	AMetropolisCharacter();

	virtual void Tick(float DeltaSeconds) override;

protected:
	virtual void BeginPlay() override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

	// --- Camera ---
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Metropolis|Camera")
	TObjectPtr<USpringArmComponent> CameraBoom;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Metropolis|Camera")
	TObjectPtr<UCameraComponent> FollowCamera;

	// --- Enhanced Input (assets a assigner dans le BP derive ou les defaults) ---
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Metropolis|Input")
	TObjectPtr<UInputMappingContext> DefaultMappingContext;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Metropolis|Input")
	TObjectPtr<UInputAction> MoveAction;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Metropolis|Input")
	TObjectPtr<UInputAction> LookAction;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Metropolis|Input")
	TObjectPtr<UInputAction> JumpAction;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Metropolis|Input")
	TObjectPtr<UInputAction> SprintAction;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Metropolis|Input")
	TObjectPtr<UInputAction> InteractAction;

	// --- Interaction ---
	/** Portee de detection des interactables (cm). */
	UPROPERTY(EditAnywhere, Category = "Metropolis|Interaction")
	float InteractionRadius = 350.f;

	/** Acteur interactif courant (pour le prompt UI). */
	UPROPERTY(BlueprintReadOnly, Category = "Metropolis|Interaction")
	TObjectPtr<AActor> CurrentInteractable;

	UFUNCTION(BlueprintCallable, Category = "Metropolis|Interaction")
	void RefreshInteractable();

	void Move(const FInputActionValue& Value);
	void Look(const FInputActionValue& Value);
	void StartSprint();
	void StopSprint();
	void DoInteract();

private:
	float WalkSpeed = 330.f;
	float SprintSpeed = 660.f;
	float InteractScanTimer = 0.f;
};
