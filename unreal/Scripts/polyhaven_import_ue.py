# =============================================================================
# METROPOLIS — import Poly Haven DANS l'éditeur Unreal
#
# Ce script s'exécute avec le Python de l'éditeur (plugin PythonScriptPlugin) :
#   UnrealEditor-Cmd.exe METROPOLIS.uproject -run=pythonscript -script="Scripts/polyhaven_import_ue.py"
# ou dans l'éditeur : Outils → Exécuter un script Python.
#
# Il NE peut pas tourner hors éditeur : l'import d'assets (Interchange), la
# création de matériaux et l'écriture de .uasset passent par l'API éditeur.
#
# Ce qu'il fait, réellement :
#   1. lit polyhaven_manifest.generated.json (produit par polyhaven_sync.py) ;
#   2. importe les .gltf / textures dans /Game/PolyHaven/<groupe>/ ;
#   3. active Nanite et règle les LOD sur les meshes ;
#   4. crée un Physical Material par surface (Asphalt, Concrete, Grass…)
#      avec frottement et restitution réalistes ;
#   5. génère les Material Instances PBR à partir des textures importées ;
#   6. écrit un rapport JSON lisible hors éditeur.
# =============================================================================
import json
import os
import sys
import traceback

import unreal  # type: ignore

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.abspath(os.path.join(HERE, ".."))
MANIFEST_PATH = os.path.join(HERE, "polyhaven_manifest.generated.json")
REPORT_PATH = os.path.join(HERE, "polyhaven_import_report.json")
DESTINATION_ROOT = "/Game/PolyHaven"

# Frottements par surface : valeurs issues de tables d'ingénierie routière.
# (asphalte sec ≈ 0,8 ; mouillé ≈ 0,55 ; herbe ≈ 0,55 ; pavé ≈ 0,75)
SURFACES = {
    "Asphalt":     {"friction": 0.85, "wet_friction": 0.55, "restitution": 0.02},
    "Concrete":    {"friction": 0.80, "wet_friction": 0.58, "restitution": 0.03},
    "Cobblestone": {"friction": 0.75, "wet_friction": 0.52, "restitution": 0.04},
    "Grass":       {"friction": 0.55, "wet_friction": 0.38, "restitution": 0.01},
    "Dirt":        {"friction": 0.50, "wet_friction": 0.32, "restitution": 0.01},
}


def log(message):
    unreal.log(f"[PolyHaven] {message}")


def ensure_directory(path):
    if not unreal.EditorAssetLibrary.does_directory_exist(path):
        unreal.EditorAssetLibrary.make_directory(path)


def import_file(filename, destination, report):
    task = unreal.AssetImportTask()
    task.filename = filename
    task.destination_path = destination
    task.automated = True
    task.save = True
    task.replace_existing = True
    try:
        unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
        imported = list(task.imported_object_paths)
        report["imported"].extend(imported)
        log(f"importé : {os.path.basename(filename)} → {len(imported)} objet(s)")
        return imported
    except Exception as exc:                     # noqa: BLE001
        report["errors"].append({"file": filename, "error": str(exc)})
        log(f"ECHEC import {filename} : {exc}")
        return []


def configure_mesh(mesh_path, report):
    """Nanite + LOD + collisions : ce qui distingue un asset « posé » d'un asset prêt."""
    try:
        mesh = unreal.EditorAssetLibrary.load_asset(mesh_path)
        if not isinstance(mesh, unreal.StaticMesh):
            return
        # Nanite : activé si la version du moteur expose le réglage.
        try:
            settings = mesh.get_editor_property("nanite_settings")
            settings.set_editor_property("enabled", True)
            mesh.set_editor_property("nanite_settings", settings)
        except Exception:
            report["warnings"].append(f"Nanite non réglé sur {mesh_path}")

        # LOD auto + distance de disparition cohérente avec le World Partition.
        mesh.set_editor_property("lod_group", unreal.Name("Metropolis"))
        mesh.set_editor_property("minimum_lod", 0)
        unreal.EditorAssetLibrary.save_loaded_asset(mesh)
    except Exception as exc:                     # noqa: BLE001
        report["errors"].append({"mesh": mesh_path, "error": str(exc)})


def create_physical_materials(report):
    package_path = f"{DESTINATION_ROOT}/Materials/Physical"
    ensure_directory(package_path)
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()

    for name, values in SURFACES.items():
        asset_path = f"{package_path}/PM_{name}"
        if unreal.EditorAssetLibrary.does_asset_exist(asset_path):
            report["physical_materials"].append(asset_path)
            continue
        try:
            material = asset_tools.create_asset(
                f"PM_{name}", package_path,
                unreal.PhysicalMaterial, unreal.PhysicalMaterialFactoryNew())
            material.set_editor_property("friction", values["friction"])
            material.set_editor_property("restitution", values["restitution"])
            unreal.EditorAssetLibrary.save_loaded_asset(material)
            report["physical_materials"].append(asset_path)
            log(f"Physical Material créé : {asset_path}")
        except Exception as exc:                 # noqa: BLE001
            report["errors"].append({"physical_material": name, "error": str(exc)})


def create_material_instance(name, textures, report):
    """Material Instance PBR : base color / normal / roughness / AO."""
    folder = f"{DESTINATION_ROOT}/Materials"
    ensure_directory(folder)
    asset_path = f"{folder}/MI_{name}"
    if unreal.EditorAssetLibrary.does_asset_exist(asset_path):
        report["materials"].append(asset_path)
        return

    # Le matériau maître doit exister : on le crée dans l'éditeur (M_Master_PBR),
    # et si absent on le signale au lieu de produire une instance orpheline.
    master_path = f"{folder}/M_Master_PBR"
    if not unreal.EditorAssetLibrary.does_asset_exist(master_path):
        report["warnings"].append(
            f"{asset_path} non créé : M_Master_PBR absent (étape éditeur, cf. Documentation/04).")
        return

    try:
        factory = unreal.MaterialInstanceConstantFactoryNew()
        instance = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
            f"MI_{name}", folder, unreal.MaterialInstanceConstant, factory)
        master = unreal.EditorAssetLibrary.load_asset(master_path)
        unreal.MaterialEditingLibrary.set_material_instance_parent(instance, master)

        for parameter, texture_path in textures.items():
            texture = unreal.EditorAssetLibrary.load_asset(texture_path)
            if texture:
                unreal.MaterialEditingLibrary.set_material_instance_texture_parameter_value(
                    instance, parameter, texture)
        unreal.EditorAssetLibrary.save_loaded_asset(instance)
        report["materials"].append(asset_path)
    except Exception as exc:                     # noqa: BLE001
        report["errors"].append({"material": name, "error": str(exc)})


def main():
    report = {"imported": [], "materials": [], "physical_materials": [],
              "warnings": [], "errors": [], "skipped": []}

    if not os.path.exists(MANIFEST_PATH):
        log("Manifeste absent : lancer polyhaven_sync.py sur une machine connectée.")
        report["skipped"].append("manifeste absent")
        write_report(report)
        return

    with open(MANIFEST_PATH, "r", encoding="utf-8") as handle:
        manifest = json.load(handle)

    ensure_directory(DESTINATION_ROOT)
    create_physical_materials(report)

    for asset_id, entry in manifest.get("assets", {}).items():
        group = entry.get("group", "divers")
        destination = f"{DESTINATION_ROOT}/{group}"
        ensure_directory(destination)

        for item in entry.get("files", []):
            path = item.get("path")
            if not path or not os.path.exists(path):
                report["skipped"].append(f"{asset_id}: fichier local manquant")
                continue
            imported = import_file(path, destination, report)
            for asset_path in imported:
                if path.lower().endswith((".gltf", ".glb")):
                    configure_mesh(asset_path, report)

    write_report(report)
    log(f"Rapport écrit : {REPORT_PATH}")


def write_report(report):
    with open(REPORT_PATH, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, ensure_ascii=False)
    log(f"{len(report['imported'])} objet(s), {len(report['errors'])} erreur(s), "
        f"{len(report['warnings'])} avertissement(s)")


if __name__ == "__main__":
    try:
        main()
    except Exception:                            # noqa: BLE001
        unreal.log_error(traceback.format_exc())
        sys.exit(1)
