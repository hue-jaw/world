// ============================================================================
// METROPOLIS — cible de jeu (Windows Shipping/Development) — Unreal 5.8+
//
// BuildSettingsVersion.V7 et EngineIncludeOrderVersion.Unreal5_8 sont les
// réglages exigés par UE 5.8 : UBT refuse de compiler un projet resté en V5
// (le moteur 5.8 est lui-même construit en V7).
// ============================================================================
using UnrealBuildTool;
using System.Collections.Generic;

public class MetropolisTarget : TargetRules
{
	public MetropolisTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.V7;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_8;

		ExtraModuleNames.Add("Metropolis");

		// Chaos est le seul moteur physique depuis UE 5.3 : les anciens
		// commutateurs bCompileChaos / bUseChaos n'existent plus en 5.8.
	}
}
