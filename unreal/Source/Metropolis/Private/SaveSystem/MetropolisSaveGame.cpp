#include "SaveSystem/MetropolisSaveGame.h"
#include "Kismet/GameplayStatics.h"

bool UMetropolisSaveGame::SaveToSlot(const FString& SlotName)
{
	SaveVersion = CurrentVersion;
	return UGameplayStatics::SaveGameToSlot(this, SlotName, 0);
}

UMetropolisSaveGame* UMetropolisSaveGame::LoadFromSlot(const FString& SlotName)
{
	if (!UGameplayStatics::DoesSaveGameExist(SlotName, 0))
	{
		return nullptr;
	}
	UMetropolisSaveGame* Loaded = Cast<UMetropolisSaveGame>(UGameplayStatics::LoadGameFromSlot(SlotName, 0));
	if (!Loaded)
	{
		return nullptr;
	}
	// Point de migration : switch (Loaded->SaveVersion) { case 0: ... }
	if (Loaded->SaveVersion > CurrentVersion)
	{
		// Sauvegarde plus recente que le binaire : ne pas risquer de la corrompre.
		return nullptr;
	}
	return Loaded;
}
