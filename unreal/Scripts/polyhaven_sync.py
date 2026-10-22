#!/usr/bin/env python3
# =============================================================================
# METROPOLIS — synchronisation des assets Poly Haven
#
# Ce script NE CONTIENT AUCUN identifiant d'asset. Il interroge l'API, filtre
# par catégorie réelle renvoyée par /assets, puis télécharge et vérifie.
#
# Usage :
#   python3 polyhaven_sync.py --dry-run          # liste seulement (aucun octet)
#   python3 polyhaven_sync.py --resolution 1k    # télécharge pour de vrai
#   python3 polyhaven_sync.py --only asphalt_02  # un seul asset (debug)
#
# Sortie : ../Content/PolyHaven/raw/  +  polyhaven_manifest.generated.json
# Le manifeste contient l'ID réel, le nom, l'auteur, la licence, la taille et
# le MD5 de CHAQUE fichier : c'est la preuve qu'un asset n'a pas été inventé.
# =============================================================================
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, List, Optional

import polyhaven_api as ph

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(os.path.join(HERE, ".."))
RAW_DIR = os.path.join(PROJECT, "Content", "PolyHaven", "raw")
MANIFEST_PATH = os.path.join(HERE, "polyhaven_manifest.generated.json")

# Priorités du cahier des charges §13. Les valeurs sont des EXPRESSIONS de
# recherche, pas des IDs : on cherche « tree », « asphalt », etc. dans les
# métadonnées renvoyées par l'API. Un ID n'est retenu que s'il existe.
PRIORITIES: List[Dict[str, Any]] = [
    {"key": "trees",        "type": "models",   "terms": ["tree"],                  "max": 8,  "resolution": "2k"},
    {"key": "vegetation",   "type": "models",   "terms": ["plant", "bush", "fern", "grass"], "max": 8, "resolution": "2k"},
    {"key": "rocks",        "type": "models",   "terms": ["rock", "stone", "boulder"], "max": 6, "resolution": "2k"},
    {"key": "asphalt",      "type": "textures", "terms": ["asphalt", "road"],        "max": 4,  "resolution": "2k"},
    {"key": "concrete",     "type": "textures", "terms": ["concrete", "cement"],     "max": 6,  "resolution": "2k"},
    {"key": "brick",        "type": "textures", "terms": ["brick", "facade"],        "max": 6,  "resolution": "2k"},
    {"key": "hdri",         "type": "hdris",    "terms": ["city", "urban", "sky"],   "max": 4,  "resolution": "2k"},
    {"key": "props",        "type": "models",   "terms": ["bench", "lamp", "hydrant", "sign"], "max": 8, "resolution": "1k"},
]


def load_existing() -> Dict[str, Any]:
    if os.path.exists(MANIFEST_PATH):
        with open(MANIFEST_PATH, "r", encoding="utf-8") as handle:
            return json.load(handle)
    return {"generated_at": None, "api": ph.API_BASE, "assets": {}, "missing": []}


def match(asset_meta: Dict[str, Any], terms: List[str]) -> bool:
    haystack = " ".join([
        str(asset_meta.get("name", "")),
        str(asset_meta.get("id", "")),
        " ".join(str(tag) for tag in asset_meta.get("tags", []) or []),
        " ".join(str(cat) for cat in asset_meta.get("categories", []) or []),
    ]).lower()
    return any(term in haystack for term in terms)


def select_assets(group: Dict[str, Any], catalogue: Dict[str, Any]) -> List[str]:
    chosen = []
    for asset_id, meta in catalogue.items():
        if match(meta, group["terms"]):
            chosen.append(asset_id)
        if len(chosen) >= group["max"]:
            break
    return chosen


def process(only: Optional[str], resolution: str, dry_run: bool, limit: int) -> int:
    manifest = load_existing()
    manifest["api"] = ph.API_BASE
    downloaded = 0
    failures: List[str] = []

    for group in PRIORITIES:
        if only and only not in group["terms"]:
            continue
        try:
            catalogue = ph.assets(group["type"])
        except ph.PolyHavenError as exc:
            failures.append(f"{group['key']}: {exc}")
            print(f"  ! {group['key']} : {exc}")
            continue

        ids = [only] if only else select_assets(group, catalogue)
        print(f"[{group['key']}] {len(ids)} asset(s) sur {len(catalogue)} dans « {group['type']} »")

        for asset_id in ids[:limit]:
            entry: Dict[str, Any] = manifest["assets"].get(asset_id, {"id": asset_id, "group": group["key"]})
            try:
                meta = ph.info(asset_id)
                file_list = ph.files(asset_id)
            except ph.PolyHavenError as exc:
                failures.append(f"{asset_id}: {exc}")
                continue

            entry.update({
                "name": meta.get("name"),
                "type": meta.get("type"),
                "authors": meta.get("authors"),
                "license": "CC0",
                "categories": meta.get("categories"),
                "tags": meta.get("tags"),
                "download_count": meta.get("download_count"),
            })

            variants = list(ph.iter_file_variants(file_list, "gltf" if group["type"] == "models" else group["type"],
                                                  group.get("resolution", resolution)))
            files_downloaded = []
            for variant in variants:
                url = ph.resolve_file_url(variant)
                if not url:
                    continue
                local = os.path.join(RAW_DIR, asset_id, os.path.basename(url))
                if os.path.exists(local):
                    files_downloaded.append({"path": local, "bytes": os.path.getsize(local), "cached": True})
                    continue
                if dry_run:
                    files_downloaded.append({"url": url, "dry_run": True})
                    continue
                try:
                    result = ph.download(url, local, expected_md5=variant.get("md5"))
                    result["url"] = url
                    files_downloaded.append(result)
                    downloaded += 1
                except Exception as exc:   # réseau, MD5, disque
                    failures.append(f"{asset_id}: {exc}")

            entry["files"] = files_downloaded
            manifest["assets"][asset_id] = entry
            print(f"   • {asset_id} — {meta.get('name')} — {len(files_downloaded)} fichier(s)")

    manifest["missing"] = failures
    if not dry_run:
        import datetime
        manifest["generated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        os.makedirs(os.path.dirname(MANIFEST_PATH), exist_ok=True)
        with open(MANIFEST_PATH, "w", encoding="utf-8") as handle:
            json.dump(manifest, handle, indent=2, ensure_ascii=False)

    print(f"\nTéléchargés : {downloaded} fichier(s). Échecs : {len(failures)}.")
    if failures:
        for failure in failures[:10]:
            print("  -", failure)
        return 2
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Synchronisation Poly Haven pour METROPOLIS")
    parser.add_argument("--dry-run", action="store_true", help="liste sans télécharger")
    parser.add_argument("--resolution", default="2k", help="1k / 2k / 4k / 8k selon l'asset")
    parser.add_argument("--only", default=None, help="ID exact d'un asset (doit exister)")
    parser.add_argument("--limit", type=int, default=50, help="nombre max par catégorie")
    args = parser.parse_args()

    try:
        return process(args.only, args.resolution, args.dry_run, args.limit)
    except ph.PolyHavenError as exc:
        print(f"API Poly Haven inaccessible : {exc}", file=sys.stderr)
        print("Réseau bloqué ? Relancer depuis une machine connectée.", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
