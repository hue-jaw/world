// METROPOLIS - module principal (gameplay + systemes ville)
// Note : Mass/ZoneGraph seront ajoutes aux dependances en Phase 2,
// apres validation sur poste UE5.5 (voir docs/02_PLAN_DE_PRODUCTION.md).
using UnrealBuildTool;

public class Metropolis : ModuleRules
{
	public Metropolis(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core", "CoreUObject", "Engine", "InputCore",
			"EnhancedInput", "ChaosVehicles", "PhysicsCore"
		});

		PrivateDependencyModuleNames.AddRange(new string[] { "UMG", "Slate", "SlateCore" });
	}
}
