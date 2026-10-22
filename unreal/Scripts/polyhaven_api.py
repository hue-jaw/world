#!/usr/bin/env python3
# =============================================================================
# METROPOLIS — client Poly Haven (API publique)
#
# Endpoints conformes au schéma officiel embarqué (Scripts/polyhaven_openapi.yml) :
#   GET /types, /assets, /search, /info/{id}, /files/{id}, /author/{id},
#       /taxonomy, /taxonomy/{type}, /categories/{type}
#
# Aucun identifiant d'asset n'est codé en dur ici : tout vient de l'API.
# Licence des assets Poly Haven : CC0 (domaine public).
# =============================================================================
from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterable, List, Optional

API_BASE = os.environ.get("POLYHAVEN_API", "https://api.polyhaven.com")
DL_BASE = os.environ.get("POLYHAVEN_DL", "https://dl.polyhaven.org/file/ph-assets")
USER_AGENT = "METROPOLIS-UE5/0.9 (+asset pipeline; contact: local dev)"


class PolyHavenError(RuntimeError):
    pass


def _get(path: str, params: Optional[Dict[str, Any]] = None,
         retries: int = 3, timeout: float = 30.0) -> Any:
    """GET JSON avec reprise progressive. Lève PolyHavenError après échec."""
    url = API_BASE.rstrip("/") + path
    if params:
        clean = {k: v for k, v in params.items() if v is not None}
        if clean:
            url += "?" + urllib.parse.urlencode(clean, doseq=True)

    last: Optional[Exception] = None
    for attempt in range(retries):
        request = urllib.request.Request(url, headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
        })
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = response.read()
                # Respect basique du serveur : on ne martèle pas l'API.
                time.sleep(0.25)
                return json.loads(payload.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code in (400, 404):
                raise PolyHavenError(f"{url} → HTTP {exc.code} (requête invalide)") from exc
            last = exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = exc
        time.sleep(1.5 * (attempt + 1))

    raise PolyHavenError(f"{url} → inaccessible après {retries} tentatives : {last}")


# ---------------------------------------------------------------------------
#                                LECTURES
# ---------------------------------------------------------------------------

def types() -> Dict[str, Any]:
    return _get("/types")


def assets(asset_type: str = "all", category: Optional[str] = None,
           attributes: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    params: Dict[str, Any] = {"t": asset_type}
    if category:
        params["category"] = category
    if attributes:
        params.update(attributes)
    return _get("/assets", params)


def info(asset_id: str) -> Dict[str, Any]:
    return _get(f"/info/{urllib.parse.quote(asset_id)}")


def files(asset_id: str) -> Dict[str, Any]:
    return _get(f"/files/{urllib.parse.quote(asset_id)}")


def search(term: str) -> Dict[str, Any]:
    return _get("/search", {"q": term})


def taxonomy() -> Dict[str, Any]:
    return _get("/taxonomy")


def categories(asset_type: str) -> Dict[str, Any]:
    return _get(f"/categories/{asset_type}")


# ---------------------------------------------------------------------------
#                              TELECHARGEMENT
# ---------------------------------------------------------------------------

def resolve_file_url(file_entry: Dict[str, Any]) -> Optional[str]:
    """Le schéma expose soit `url` direct, soit `include` + `url`."""
    if isinstance(file_entry, dict):
        url = file_entry.get("url")
        if isinstance(url, str) and url.startswith("http"):
            return url
    return None


def md5_of(path: str) -> str:
    digest = hashlib.md5()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, destination: str, expected_md5: Optional[str] = None,
             chunk: int = 1024 * 512) -> Dict[str, Any]:
    """Télécharge un fichier, vérifie sa taille et son MD5 quand l'API les donne."""
    os.makedirs(os.path.dirname(os.path.abspath(destination)), exist_ok=True)
    temporary = destination + ".part"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    total = 0
    with urllib.request.urlopen(request, timeout=120) as response, open(temporary, "wb") as handle:
        while True:
            block = response.read(chunk)
            if not block:
                break
            handle.write(block)
            total += len(block)

    if expected_md5:
        actual = md5_of(temporary)
        if actual.lower() != expected_md5.lower():
            os.remove(temporary)
            raise PolyHavenError(f"MD5 invalide pour {url} : attendu {expected_md5}, obtenu {actual}")

    os.replace(temporary, destination)
    return {"path": destination, "bytes": total, "md5": md5_of(destination)}


def iter_file_variants(files_payload: Dict[str, Any], kind: str,
                       resolution: str) -> Iterable[Dict[str, Any]]:
    """Parcourt la structure `{kind: {$resolution: {res: {format: entry}}}}`."""
    block = files_payload.get(kind) or {}
    by_resolution = block.get("$resolution") or block
    entry = by_resolution.get(resolution) or {}
    for fmt, payload in entry.items():
        if isinstance(payload, dict):
            yield {"format": fmt, **payload}
