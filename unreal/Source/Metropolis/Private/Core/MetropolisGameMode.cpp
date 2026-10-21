#include "Core/MetropolisGameMode.h"
#include "Characters/MetropolisCharacter.h"
#include "UObject/ConstructorHelpers.h"

AMetropolisGameMode::AMetropolisGameMode()
{
	// Le personnage TPS est le pawn par defaut ; il possede les vehicules a la demande.
	DefaultPawnClass = AMetropolisCharacter::StaticClass();
}
