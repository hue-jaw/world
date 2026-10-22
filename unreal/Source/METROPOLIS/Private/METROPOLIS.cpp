// ============================================================================
// METROPOLIS — module principal
// ============================================================================
#include "METROPOLIS.h"

DEFINE_LOG_CATEGORY(LogMetropolis);

void FMETROPOLISModule::StartupModule()
{
	UE_LOG(LogMetropolis, Log, TEXT("METROPOLIS (UE5) — module chargé."));
}

void FMETROPOLISModule::ShutdownModule()
{
	UE_LOG(LogMetropolis, Log, TEXT("METROPOLIS (UE5) — module déchargé."));
}

IMPLEMENT_PRIMARY_GAME_MODULE(FMETROPOLISModule, METROPOLIS, "METROPOLIS");
