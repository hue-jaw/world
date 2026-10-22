// ============================================================================
// METROPOLIS — module principal.
//
// Toutes les dépendances sont des modules MOTEUR : le projet se compile sans
// plugin tiers, sauf DLSS qui reste OPTIONNEL (voir Documentation/03_DLSS.md).
// ============================================================================
using UnrealBuildTool;

public class METROPOLIS : ModuleRules
{
	public METROPOLIS(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",
			"EnhancedInput",
			"PhysicsCore",
			"ChaosVehicles",
			"Niagara",
			"AIModule",
			"NavigationSystem",
			"GameplayTags",
			"UMG",
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"Slate",
			"SlateCore",
			"RenderCore",
			"RHI",
			"Chaos",
			"ChaosCore",
			"ChaosVehiclesCore",
			"ProceduralMeshComponent",
			"DeveloperSettings",
			"Projects",
		});

		// DLSS : jamais supposé présent. Pour l'activer, installer le plugin
		// NVIDIA DLSS (UE5) puis compiler avec -DMETROPOLIS_WITH_DLSS=1.
		// Sans ce drapeau, AUCUNE option DLSS n'est affichée au joueur : c'est
		// la seule façon de ne pas mentir sur une fonctionnalité absente.
		PublicDefinitions.Add("METROPOLIS_WITH_DLSS=0");

		if (Target.Platform == UnrealTargetPlatform.Win64)
		{
			PublicDefinitions.Add("METROPOLIS_WINDOWS=1");
		}
	}
}
