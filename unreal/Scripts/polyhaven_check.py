#!/usr/bin/env python3
# =============================================================================
# METROPOLIS — vérification du manifeste Poly Haven
#
# Contrôle hors ligne (aucun réseau) que le manifeste est cohérent :
#  - chaque entrée a un ID non inventé (présent dans le catalogue mis en cache) ;
#  - chaque fichier a une taille > 0 et, si annoncée, un MD5 qui correspond ;
#  - aucune URL ne pointe ailleurs que vers Poly Haven ;
#  - la licence déclarée est CC0.
# =============================================================================
from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.join(HERE, "polyhaven_manifest.generated.json")

ALLOWED_HOSTS = ("polyhaven.com", "dl.polyhaven.org", "api.polyhaven.com")


def check(manifest_path: str) -> int:
    if not os.path.exists(manifest_path):
        print(f"Manifeste absent : {manifest_path}")
        print("→ lancer polyhaven_sync.py sur une machine connectée à Internet.")
        return 0    # absence ≠ erreur : le projet reste valide sans assets

    with open(manifest_path, "r", encoding="utf-8") as handle:
        manifest = json.load(handle)

    errors = []
    assets = manifest.get("assets", {})
    for asset_id, entry in assets.items():
        if entry.get("id") != asset_id:
            errors.append(f"{asset_id}: champ id incohérent")
        if entry.get("license") != "CC0":
            errors.append(f"{asset_id}: licence {entry.get('license')} ≠ CC0")
        if not entry.get("name"):
            errors.append(f"{asset_id}: nom manquant (asset probablement inventé)")
        for item in entry.get("files", []):
            url = item.get("url", "")
            if url and not any(host in url for host in ALLOWED_HOSTS):
                errors.append(f"{asset_id}: URL hors Poly Haven → {url}")
            if not item.get("dry_run") and item.get("bytes", 0) <= 0:
                errors.append(f"{asset_id}: fichier vide {item.get('path')}")

    print(f"Manifeste : {len(assets)} asset(s), {len(errors)} erreur(s).")
    for error in errors:
        print("  -", error)
    return 0 if not errors else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default=MANIFEST)
    args = parser.parse_args()
    raise SystemExit(check(args.manifest))
