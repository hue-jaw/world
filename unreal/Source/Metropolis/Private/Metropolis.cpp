// ============================================================================
// METROPOLIS — module principal
// ============================================================================
#include "Metropolis.h"

DEFINE_LOG_CATEGORY(LogMetropolis);

void FMetropolisModule::StartupModule()
{
	UE_LOG(LogMetropolis, Log, TEXT("METROPOLIS (UE5) — module chargé."));
}

void FMetropolisModule::ShutdownModule()
{
	UE_LOG(LogMetropolis, Log, TEXT("METROPOLIS (UE5) — module déchargé."));
}

IMPLEMENT_PRIMARY_GAME_MODULE(FMetropolisModule, Metropolis, "Metropolis");
