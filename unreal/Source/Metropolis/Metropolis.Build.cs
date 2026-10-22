// ============================================================================
// METROPOLIS — module principal (UE 5.8.4)
//
// Principe : ne déclarer QUE les modules réellement inclus par le code.
// Chaque module absent d'une installation Launcher casse la compilation ;
// une liste courte est donc une garantie de portabilité.
//
// Changement UE 5.8 : MassEntity n'est plus un plugin mais un module moteur
// natif (/Engine/Source/Runtime/MassEntity). Quand le système de foule Mass
// sera branché, ajouter ici :
//     "MassEntity",   // module moteur (ex-plugin supprimé en 5.8)
//     "MassCore",     // nouveaux types de base (5.8)
//     "MassCommon", "MassSpawner", "MassRepresentation" // plugin MassGameplay
// et activer le plugin MassGameplay dans Metropolis.uproject.
// ============================================================================
using UnrealBuildTool;

public class Metropolis : ModuleRules
{
	public Metropolis(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",
			"EnhancedInput",            // plugin EnhancedInput (actif en 5.8)
			"ChaosVehicles",            // plugin ChaosVehiclesPlugin (actif en 5.8)
			"PhysicsCore",              // UPhysicalMaterial
			"ProceduralMeshComponent",  // plugin éponyme (actif en 5.8)
			"Niagara",                  // météo (module moteur, pas un plugin)
			"AIModule",                 // AAIController (trafic)
			"GameplayTags",             // tags natifs
			"RHI",                      // GRHIAdapterName (détection GPU)
		});

		// DLSS reste OPTIONNEL : sans plugin NVIDIA, le projet compile et
		// tourne en TSR. Voir Documentation/03_DLSS.md.
		PublicDefinitions.Add("METROPOLIS_WITH_DLSS=0");

		if (Target.Platform == UnrealTargetPlatform.Win64)
		{
			PublicDefinitions.Add("METROPOLIS_WINDOWS=1");
		}
	}
}
