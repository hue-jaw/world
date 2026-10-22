#include "MetropolisGameplayTags.h"

namespace MetropolisTags
{
	UE_DEFINE_GAMEPLAY_TAG(Weather_Clear,      "Metropolis.Weather.Clear");
	UE_DEFINE_GAMEPLAY_TAG(Weather_Rain,       "Metropolis.Weather.Rain");
	UE_DEFINE_GAMEPLAY_TAG(Weather_Storm,      "Metropolis.Weather.Storm");
	UE_DEFINE_GAMEPLAY_TAG(Weather_Fog,        "Metropolis.Weather.Fog");

	UE_DEFINE_GAMEPLAY_TAG(Surface_Asphalt,    "Metropolis.Surface.Asphalt");
	UE_DEFINE_GAMEPLAY_TAG(Surface_Concrete,   "Metropolis.Surface.Concrete");
	UE_DEFINE_GAMEPLAY_TAG(Surface_Cobblestone,"Metropolis.Surface.Cobblestone");
	UE_DEFINE_GAMEPLAY_TAG(Surface_Grass,      "Metropolis.Surface.Grass");
	UE_DEFINE_GAMEPLAY_TAG(Surface_Dirt,       "Metropolis.Surface.Dirt");
	UE_DEFINE_GAMEPLAY_TAG(Surface_Wet,        "Metropolis.Surface.Wet");

	UE_DEFINE_GAMEPLAY_TAG(Mission_Delivery,   "Metropolis.Mission.Delivery");
	UE_DEFINE_GAMEPLAY_TAG(Mission_Race,       "Metropolis.Mission.Race");
	UE_DEFINE_GAMEPLAY_TAG(Mission_Transport,  "Metropolis.Mission.Transport");
	UE_DEFINE_GAMEPLAY_TAG(Mission_Exploration,"Metropolis.Mission.Exploration");
	UE_DEFINE_GAMEPLAY_TAG(Mission_Rescue,     "Metropolis.Mission.Rescue");
	UE_DEFINE_GAMEPLAY_TAG(Mission_Chase,      "Metropolis.Mission.Chase");

	UE_DEFINE_GAMEPLAY_TAG(State_Driving,      "Metropolis.State.Driving");
	UE_DEFINE_GAMEPLAY_TAG(State_OnFoot,       "Metropolis.State.OnFoot");
	UE_DEFINE_GAMEPLAY_TAG(State_Wanted,       "Metropolis.State.Wanted");
}
