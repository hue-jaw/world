// ============================================================================
// METROPOLIS — cible éditeur (ouverture du projet dans Unreal Editor).
// ============================================================================
using UnrealBuildTool;
using System.Collections.Generic;

public class METROPOLISEditorTarget : TargetRules
{
	public METROPOLISEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_5;

		ExtraModuleNames.Add("METROPOLIS");
	}
}
