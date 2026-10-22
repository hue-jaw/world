// ============================================================================
// METROPOLIS — cible de compilation du jeu (Windows Shipping/Development).
// ============================================================================
using UnrealBuildTool;
using System.Collections.Generic;

public class METROPOLISTarget : TargetRules
{
	public METROPOLISTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_5;

		ExtraModuleNames.Add("METROPOLIS");

		// Le jeu est distribué en Windows x64 uniquement (cible : RTX 3050 6 Go,
		// 1920x1080). Pas de build serveur, pas de mobile.
		if (Target.Platform == UnrealTargetPlatform.Win64)
		{
			bCompileChaos = true;
			bUseChaos = true;
		}
	}
}
