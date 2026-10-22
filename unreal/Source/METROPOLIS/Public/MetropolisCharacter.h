// ============================================================================
// METROPOLIS — MetropolisCharacter
// Le joueur à pied.
//
// Reprend les réglages validés en v0.9 (hauteur de marche 36 cm, saut A,
// sprint L3, recentrage R3, vue 1re/3e personne) mais avec le CharacterMovement
// du moteur : la montée de trottoir est un vrai pas (MaxStepHeight), pas une
// téléportation ni un mur invisible.
// ============================================================================
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "MetropolisCharacter.generated.h"

class UCameraComponent;
class USpringArmComponent;
class UInputMappingContext;
class UInputAction;
class AMetropolisVehicle;
struct FInputActionValue;

UCLASS(BlueprintType)
class METROPOLIS_API AMetropolisCharacter : public ACharacter
{
	GENERATED_BODY()

public:
	AMetropolisCharacter();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

	/** Entre dans le véhicule visé (raycast devant le joueur). */
	UFUNCTION(BlueprintCallable, Category = "Joueur")
	bool TryEnterVehicle();

	UFUNCTION(BlueprintCallable, Category = "Joueur")
	void ToggleView();

	UFUNCTION(BlueprintPure, Category = "Joueur")
	bool IsSprinting() const { return bSprinting; }

	UFUNCTION(BlueprintCallable, Category = "Joueur")
	void SetSprinting(bool bNewSprinting);

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Joueur")
	TObjectPtr<UCameraComponent> Camera;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Joueur")
	TObjectPtr<USpringArmComponent> CameraBoom;

	/** Vue subjective par défaut quand on est à pied (cf. v0.9). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Joueur")
	bool bFirstPerson = false;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Joueur")
	float WalkSpeed = 320.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Joueur")
	float SprintSpeed = 640.f;

	/** Distance d'interaction avec véhicules et PNJ (cm). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Joueur")
	float InteractRange = 350.f;

	/** Asservissement de la vue souris (unités par valeur d'action). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Joueur")
	float LookSensitivity = 1.0f;

protected:
	void OnMove(const FInputActionValue& Value);
	void OnLook(const FInputActionValue& Value);
	void OnJumpPressed();
	void OnSprintStarted();
	void OnSprintCompleted();
	void OnRecentered();
	void OnInteractPressed();
	void OnToggleViewPressed();

	UPROPERTY(EditDefaultsOnly, Category = "Entrées")
	TObjectPtr<UInputMappingContext> DefaultContext;

	UPROPERTY(EditDefaultsOnly, Category = "Entrées")
	TObjectPtr<UInputAction> MoveAction;

	UPROPERTY(EditDefaultsOnly, Category = "Entrées")
	TObjectPtr<UInputAction> LookAction;

	UPROPERTY(EditDefaultsOnly, Category = "Entrées")
	TObjectPtr<UInputAction> JumpAction;

	UPROPERTY(EditDefaultsOnly, Category = "Entrées")
	TObjectPtr<UInputAction> SprintAction;

	UPROPERTY(EditDefaultsOnly, Category = "Entrées")
	TObjectPtr<UInputAction> InteractAction;

	UPROPERTY(EditDefaultsOnly, Category = "Entrées")
	TObjectPtr<UInputAction> RecenterAction;

	UPROPERTY(EditDefaultsOnly, Category = "Entrées")
	TObjectPtr<UInputAction> ViewAction;

private:
	bool bSprinting = false;
	float CameraBlendAlpha = 0.f;
};
