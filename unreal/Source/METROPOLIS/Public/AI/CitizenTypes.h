#pragma once

#include "CoreMinimal.h"
#include "CitizenTypes.generated.h"

/**
 * Types citoyens (brief sections 7 et 8).
 * Phase 1bis/2 : ces structures alimentent Mass Entity -
 * FCitizenIdentity devient un Mass Fragment, les routines tournent en
 * StateTree (miroir direct du systeme valide dans pedestrians.js :
 * activite par tranche horaire, navigation porte-a-porte, reactions).
 */

UENUM(BlueprintType)
enum class ECitizenActivity : uint8
{
	Home,
	Work,
	LunchBreak,
	Shopping,
	Leisure,
	Wandering
};

USTRUCT(BlueprintType)
struct FCitizenIdentity
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString FirstName;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString LastName;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FName Job;

	/** Travail de nuit : la routine est decalee de 12 h. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) bool bNightShift = false;

	/** Flaneur : destinations libres plutot qu'une routine fixe. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) bool bWanderer = false;

	/** Rythme de marche individuel (0.85 - 1.2). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float PaceFactor = 1.f;
};

/** Une ligne d'emploi du temps : activite valable a partir de StartHour. */
USTRUCT(BlueprintType)
struct FCitizenScheduleRow
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, meta = (ClampMin = 0.f, ClampMax = 24.f))
	float StartHour = 8.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	ECitizenActivity Activity = ECitizenActivity::Work;
};
