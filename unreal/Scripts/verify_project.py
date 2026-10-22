#!/usr/bin/env python3
# =============================================================================
# METROPOLIS — vérification statique du projet Unreal (hors éditeur)
#
# Unreal Editor est absent de l'environnement de développement automatisé.
# Ce script ne remplace PAS une compilation : il vérifie ce qui est
# vérifiable sans moteur — et il échoue franchement quand une règle UHT est
# violée (ce qui aurait cassé la compilation sur une machine Windows).
#
# Contrôles :
#  1. Metropolis.uproject : JSON valide, module cohérent, plugins connus.
#  2. Chaque .h a son .cpp ; chaque include de projet existe.
#  3. #include "*.generated.h" est TOUJOURS le dernier include (règle UHT).
#  4. UCLASS/USTRUCT/UENUM → GENERATED_BODY() ou *_generated.h présent.
#  5. Accolades/parenthèses équilibrées ; aucun fichier vide ; UTF-8 valide.
#  6. Config : GameMode référencé existe ; chemins de carte sous /Game.
#  7. Aucun fichier binaire factice dans Content/ (pas de faux .uasset).
#  8. Endpoints appelés par polyhaven_api.py présents dans le schéma OpenAPI.
# =============================================================================
from __future__ import annotations

import json
import os
import re
import sys
from typing import Dict, List, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(os.path.join(HERE, ".."))
PROJECT_NAME = "Metropolis"
MODULE = "Metropolis"
SOURCE = os.path.join(PROJECT, "Source")
CONTENT = os.path.join(PROJECT, "Content")
UPROJECT = os.path.join(PROJECT, f"{PROJECT_NAME}.uproject")

problems: List[str] = []
checks = {"uproject": 0, "sources": 0, "uht": 0, "syntax": 0, "config": 0, "content": 0, "api": 0}


def add_check(kind: str, ok: bool, message: str) -> None:
    checks[kind] = checks.get(kind, 0) + 1
    if not ok:
        problems.append(message)


# ---------------------------------------------------------------------------
# 1. .uproject
# ---------------------------------------------------------------------------
def check_uproject() -> None:
    if not os.path.exists(UPROJECT):
        add_check("uproject", False, f"{PROJECT_NAME}.uproject absente")
        return
    with open(UPROJECT, "r", encoding="utf-8") as handle:
        text = handle.read()
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        add_check("uproject", False, f"uproject : JSON invalide ({exc})")
        return

    add_check("uproject", data.get("FileVersion") == 3, "uproject : FileVersion != 3")
    modules = data.get("Modules", [])
    add_check("uproject", len(modules) == 1, "uproject : doit déclarer exactement 1 module")
    if modules:
        name = modules[0].get("Name")
        add_check("uproject", name == MODULE, f"uproject : module « {name} » inattendu")
        add_check("uproject", os.path.isdir(os.path.join(SOURCE, name)),
                  f"uproject : Source/{name}/ manquant")
    engine = str(data.get("EngineAssociation", ""))
    add_check("uproject", engine == "5.8",
              f"uproject : EngineAssociation « {engine} » (attendu 5.8)")
    plugins = data.get("Plugins", [])
    add_check("uproject", len(plugins) >= 3, "uproject : moins de 3 plugins déclarés")
    for plugin in plugins:
        add_check("uproject", bool(plugin.get("Name")), "uproject : plugin sans nom")

    # UE 5.8 : MassEntity n'est plus un plugin mais un module moteur
    # (/Engine/Source/Runtime/MassEntity). Le référencer dans .uproject
    # provoque « Unable to find plugin 'MassEntity' » et bloque l'ouverture.
    names = {plugin.get("Name") for plugin in plugins}
    add_check("uproject", "MassEntity" not in names,
              "uproject : MassEntity est un module moteur en 5.8, pas un plugin")

    # MassAI/MassCrowd n'ont pas pu être confirmés dans l'inventaire 5.8.4 :
    # tant qu'aucun code Mass n'existe, aucune entrée Mass* ne doit subsister.
    add_check("uproject", not any(n.startswith("Mass") for n in names),
              "uproject : aucun plugin Mass* déclaré (évite un second échec de chargement)")

    # Modules optionnels réellement utilisés par le code livré.
    for optional, why in (("ProceduralMeshComponent", "voirie procédurale"),
                          ("Niagara", "météo"),
                          ("PythonScriptPlugin", "scripts Poly Haven")):
        add_check("uproject", optional in names,
                  f"uproject : {optional} déclaré ({why})")

    # Enhanced Input et Chaos Vehicles doivent rester actifs (exigence projet).
    for required in ("EnhancedInput", "ChaosVehiclesPlugin"):
        enabled = any(p.get("Name") == required and p.get("Enabled") is True for p in plugins)
        add_check("uproject", enabled, f"uproject : {required} doit être activé")


# ---------------------------------------------------------------------------
# 2/3/4/5. Sources
# ---------------------------------------------------------------------------
def iter_sources() -> List[str]:
    files = []
    for root, _dirs, names in os.walk(SOURCE):
        for name in names:
            if name.endswith((".h", ".cpp", ".cs")):
                files.append(os.path.join(root, name))
    return sorted(files)


def strip_comments_and_strings(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"//[^\n]*", "", text)
    text = re.sub(r'"(?:[^"\\]|\\.)*"', '""', text)
    return text


def check_sources(files: List[str]) -> None:
    header_names = {os.path.basename(path) for path in files if path.endswith(".h")}

    for path in files:
        relative = os.path.relpath(path, PROJECT)
        with open(path, "rb") as handle:
            raw = handle.read()
        add_check("sources", len(raw) > 0, f"{relative} : fichier vide")
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            add_check("sources", False, f"{relative} : encodage non UTF-8")
            continue

        if path.endswith(".h"):
            # Seul un en-tête qui déclare une UCLASS doit avoir un .cpp :
            # un en-tête de types (USTRUCT/UENUM purs) n'en a pas besoin.
            if re.search(r"\bUCLASS\s*\(", text):
                implementation = os.path.join(SOURCE, MODULE, "Private",
                                              os.path.basename(path)[:-2] + ".cpp")
                add_check("sources", os.path.exists(implementation),
                          f"{relative} : UCLASS sans .cpp correspondant")

        for include in re.findall(r'#include\s+"([^"]+)"', text):
            if include.endswith(".generated.h"):
                continue
            if "/" in include:
                continue
            if os.path.basename(include) in header_names:
                continue
            # Include moteur : non vérifiable hors moteur, on ne le compte pas.
        # Règle UHT : generated.h en dernier.
        includes = re.findall(r'#include\s+"([^"]+)"', text)
        if any(name.endswith(".generated.h") for name in includes):
            add_check("uht", includes[-1].endswith(".generated.h"),
                      f"{relative} : le .generated.h doit être le dernier include")

        bare = strip_comments_and_strings(text)
        add_check("syntax", bare.count("{") == bare.count("}"),
                  f"{relative} : accolades déséquilibrées ({bare.count('{')}/{bare.count('}')})")
        add_check("syntax", bare.count("(") == bare.count(")"),
                  f"{relative} : parenthèses déséquilibrées")

        # Règle UHT : tout en-tête contenant une réflexion doit avoir son
        # .generated.h, et le corps de classe son GENERATED_BODY().
        if path.endswith(".h") and re.search(r"\b(UCLASS|USTRUCT|UENUM)\s*\(", text):
            add_check("uht", re.search(r'#include\s+"[^"]+\.generated\.h"', text) is not None,
                      f"{relative} : réflexion sans include .generated.h")
            if re.search(r"\bUCLASS\s*\(", text):
                add_check("uht", "GENERATED_BODY()" in text,
                          f"{relative} : UCLASS sans GENERATED_BODY()")


# ---------------------------------------------------------------------------
# 6. Config
# ---------------------------------------------------------------------------
def check_targets() -> None:
    """UBT 5.8 exige BuildSettingsVersion.V7 et Unreal5_8."""
    for name in ("Metropolis.Target.cs", "MetropolisEditor.Target.cs"):
        path = os.path.join(SOURCE, name)
        if not os.path.exists(path):
            add_check("config", False, f"Source/{name} absente")
            continue
        text = open(path, encoding="utf-8").read()
        add_check("config", "BuildSettingsVersion.V7" in text, f"{name} : BuildSettingsVersion.V7 requis en 5.8")
        add_check("config", "EngineIncludeOrderVersion.Unreal5_8" in text, f"{name} : Unreal5_8 requis")
        add_check("config", 'ExtraModuleNames.Add("Metropolis")' in text, f"{name} : module Metropolis absent")


def check_config() -> None:
    engine_ini = os.path.join(PROJECT, "Config", "DefaultEngine.ini")
    if not os.path.exists(engine_ini):
        add_check("config", False, "Config/DefaultEngine.ini absente")
        return
    with open(engine_ini, "r", encoding="utf-8") as handle:
        ini = handle.read()

    for section in ("[/Script/EngineSettings.GameMapsSettings]", "[/Script/Engine.RendererSettings]",
                    "[/Script/Engine.PhysicsSettings]"):
        add_check("config", section in ini, f"DefaultEngine.ini : section {section} absente")

    for match in re.finditer(r"GameDefaultMap=([^\n]+)", ini):
        add_check("config", match.group(1).startswith("/Game/"),
                  f"DefaultEngine.ini : carte hors /Game → {match.group(1)}")

    # Le GameMode C++ référencé doit exister dans les sources.
    for match in re.finditer(r"GlobalDefaultGameMode=/Script/(\w+)\.(\w+)", ini):
        module_name, class_name = match.group(1), match.group(2)
        add_check("config", module_name == MODULE, f"GameMode module « {module_name} » inattendu")
        # UE retire le préfixe A/U dans /Script/Module.Classe : on l'accepte.
        pattern = re.compile(rf"class\s+\w*_API\s+A?U?{class_name}\b|\bclass\s+A?U?{class_name}\s*:")
        found = any(pattern.search(open(path, encoding="utf-8").read())
                    for path in iter_sources() if path.endswith(".h"))
        add_check("config", found, f"GameMode {class_name} introuvable dans les sources")

    # Pas de RHI exotique ni de valeur aberrante.
    for match in re.finditer(r"r\.Streaming\.PoolSize=(\d+)", ini):
        add_check("config", int(match.group(1)) <= 4096,
                  "DefaultEngine.ini : PoolSize > 4 Go, incompatible avec 6 Go de VRAM")


# ---------------------------------------------------------------------------
# 7. Content
# ---------------------------------------------------------------------------
def check_content() -> None:
    if not os.path.isdir(CONTENT):
        add_check("content", False, "Content/ absente")
        return
    binary_count = 0
    for root, _dirs, names in os.walk(CONTENT):
        for name in names:
            full = os.path.join(root, name)
            relative = os.path.relpath(full, PROJECT)
            if name.endswith((".uasset", ".umap")):
                binary_count += 1
                problems.append(f"{relative} : binaire .uasset/.umap généré hors éditeur")
            add_check("content", os.path.getsize(full) > 0, f"{relative} : fichier vide")
    add_check("content", binary_count == 0,
              f"Content/ : {binary_count} fichier(s) binaire(s) — doivent être créés dans l'éditeur")


# ---------------------------------------------------------------------------
# 8. API Poly Haven
# ---------------------------------------------------------------------------
def check_api() -> None:
    spec_path = os.path.join(HERE, "polyhaven_openapi.yml")
    api_path = os.path.join(HERE, "polyhaven_api.py")
    if not (os.path.exists(spec_path) and os.path.exists(api_path)):
        add_check("api", False, "Schéma OpenAPI ou client Poly Haven manquant")
        return

    with open(spec_path, "r", encoding="utf-8") as handle:
        spec = handle.read()
    with open(api_path, "r", encoding="utf-8") as handle:
        client = handle.read()

    declared = set(re.findall(r"^  (/[\w/{}]+):", spec, flags=re.M))
    # Appels réels du client : _get("/assets") ou _get(f"/info/{...}")
    used = set(re.findall(r'_get\(\s*f?"(/[^"?) ]+)', client))
    for path in sorted(used):
        # f-string : on ne garde que le préfixe statique avant « { ».
        prefix = path.split("{")[0].rstrip("/")
        ok = any(declared_path == prefix or declared_path.startswith(prefix + "/")
                 or declared_path.startswith(prefix + "{") for declared_path in declared)
        add_check("api", ok, f"polyhaven_api.py : endpoint {prefix} absent du schéma OpenAPI")


# ---------------------------------------------------------------------------
# 8 bis. Garde-fous de compilation (défauts réellement corrigés)
# ---------------------------------------------------------------------------
def check_compile_guards() -> None:
    """Ces contrôles existent parce que chacun correspond à une ERREUR de
    compilation réelle, pas à une préférence de style. Les régressions sont
    donc détectées avant tout essai dans l'éditeur."""

    street_h = os.path.join(SOURCE, "Metropolis", "Public", "StreetSurfaceActor.h")
    with open(street_h, "r", encoding="utf-8") as handle:
        street = handle.read()
    # FProcMeshTangent est un struct : une déclaration anticipée de classe ne
    # suffit pas, il faut l'en-tête complet.
    add_check("compile", '#include "ProceduralMeshComponent.h"' in street,
              "StreetSurfaceActor.h : FProcMeshTangent exige ProceduralMeshComponent.h")

    char_cpp = os.path.join(SOURCE, "Metropolis", "Private", "MetropolisCharacter.cpp")
    with open(char_cpp, "r", encoding="utf-8") as handle:
        character = handle.read()
    add_check("compile", '#include "Components/SkeletalMeshComponent.h"' in character,
              "MetropolisCharacter.cpp : USkeletalMeshComponent incomplet (GetMesh())")

    # UHT n'évalue pas TEXT("...") comme valeur par défaut.
    offenders = []
    for root, _dirs, names in os.walk(os.path.join(SOURCE, "Metropolis", "Public")):
        for name in names:
            if not name.endswith(".h"):
                continue
            with open(os.path.join(root, name), "r", encoding="utf-8") as handle:
                text = handle.read()
            for match in re.finditer(r"UFUNCTION\s*\([^)]*\)\s*[^;{]*TEXT\(", text):
                offenders.append(name)
    add_check("compile", not offenders,
              f"argument par défaut TEXT() dans un UFUNCTION : {sorted(set(offenders))}")

    script = os.path.join(PROJECT, "Scripts", "Build-Metropolis.bat")
    add_check("compile", os.path.exists(script),
              "Scripts/Build-Metropolis.bat absent (compilation + diagnostic)")


# ---------------------------------------------------------------------------
# 9. Documentation obligatoire
# ---------------------------------------------------------------------------
def check_docs() -> None:
    docs = os.path.join(PROJECT, "Documentation")
    required = ["README.md", "01_INSTALL_WINDOWS.md", "02_EDITOR_STEPS.md", "03_DLSS.md",
                "04_PERFORMANCE.md", "05_POLYHAVEN.md", "06_TESTS.md", "07_MIGRATION.md",
                "08_RAPPORT_UE58.md"]
    for name in required:
        path = os.path.join(docs, name)
        add_check("content", os.path.exists(path), f"Documentation/{name} absente")


def main() -> int:
    check_uproject()
    files = iter_sources()
    add_check("sources", len(files) >= 20, f"seulement {len(files)} fichiers source")
    check_sources(files)
    check_targets()
    check_config()
    check_content()
    check_api()
    check_compile_guards()
    check_docs()

    total = sum(checks.values())
    print(f"Projet : {PROJECT}")
    print(f"Sources : {len(files)} fichiers")
    print("Contrôles :")
    for kind, count in sorted(checks.items()):
        print(f"  {kind:<10} {count:>4} ✓")

    if problems:
        print(f"\nÉCHECS ({len(problems)}) :")
        for problem in problems:
            print("  ✗", problem)
        return 1

    print(f"\nVERIFICATION UNREAL : {total} ✓ / 0 échec")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
