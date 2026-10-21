#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "MetropolisGameMode.generated.h"

/**
 * GameMode par defaut de METROPOLIS.
 * Role volontairement mince : il designe les classes par defaut.
 * La logique de simulation vit dans les World Subsystems
 * (Traffic, Weather, Missions...) - jamais ici (architecture docs/01).
 */
UCLASS()
class METROPOLIS_API AMetropolisGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	AMetropolisGameMode();
};
