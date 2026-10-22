// ============================================================================
// METROPOLIS — Pedestrian
// PNJ piéton : marche sur les trottoirs, réagit à la météo (parapluie, abri),
// ne traverse JAMAIS un arbre (les arbres sont des obstacles physiques).
//
// La foule massive (centaines de PNJ) est le point d'extension Mass Entity :
// voir Documentation/06_MASS_ENTITY.md. Ici, la version « Actor » est fournie
// parce qu'elle est immédiatement jouable et vérifiable ; elle est plafonnée
// (MaxActors) et le reste passe par un HISM de silhouettes si besoin.
// ============================================================================
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "MetropolisTypes.h"
#include "Pedestrian.generated.h"

class UStaticMeshComponent;
class UAnimSequence;
class UProceduralMeshComponent;

UENUM(BlueprintType)
enum class EPedestrianState : uint8
{
	Walking,
	Sheltering,
	Fleeing,
	Idle,
};

UCLASS(BlueprintType)
class METROPOLIS_API APedestrian : public ACharacter
{
	GENERATED_BODY()

public:
	APedestrian();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	/** Définit les points de patrouille (typiquement des points de trottoir). */
	UFUNCTION(BlueprintCallable, Category = "PNJ")
	void SetPatrolPoints(const TArray<FVector>& Points);

	/** Réaction météo : parapluie sous la pluie, abri sous l'orage. */
	UFUNCTION(BlueprintCallable, Category = "PNJ")
	void UpdateWeatherReaction(float RainIntensity, float StormIntensity);

	UFUNCTION(BlueprintPure, Category = "PNJ")
	EPedestrianState GetState() const { return State; }

	UFUNCTION(BlueprintPure, Category = "PNJ")
	bool HasUmbrellaOpen() const { return bUmbrellaOpen; }

	/** Distance d'arrêt avant un obstacle (cm). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "PNJ")
	float ObstacleProbeDistance = 140.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "PNJ")
	float WalkSpeed = 145.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "PNJ")
	float RunSpeed = 480.f;

	/** Parapluie (mesh simple, désactivé par défaut). */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "PNJ")
	TObjectPtr<UStaticMeshComponent> UmbrellaMesh;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "PNJ")
	float UmbrellaOpenTime = 0.6f;

private:
	void MoveAlongPatrol();
	void ProbeAndAvoidObstacle();

	EPedestrianState State = EPedestrianState::Walking;
	TArray<FVector> Patrol;
	int32 PatrolIndex = 0;
	bool bUmbrellaOpen = false;
	float UmbrellaAlpha = 0.f;
	float RepathTimer = 0.f;
	float FleeTimer = 0.f;
};
