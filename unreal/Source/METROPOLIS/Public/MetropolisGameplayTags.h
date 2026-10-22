// ============================================================================
// METROPOLIS — GameplayTags
// Tags natifs : météo, surfaces, missions, états du joueur.
// ============================================================================
#pragma once

#include "NativeGameplayTags.h"

namespace MetropolisTags
{
	// Météo
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Weather_Clear);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Weather_Rain);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Weather_Storm);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Weather_Fog);

	// Surfaces (miroir des Physical Materials)
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Surface_Asphalt);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Surface_Concrete);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Surface_Cobblestone);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Surface_Grass);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Surface_Dirt);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Surface_Wet);

	// Missions
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Mission_Delivery);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Mission_Race);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Mission_Transport);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Mission_Exploration);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Mission_Rescue);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Mission_Chase);

	// États du joueur
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_Driving);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_OnFoot);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_Wanted);
}
