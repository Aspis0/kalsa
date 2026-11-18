"""Catalog lookup and the skip rules for non-forks."""

from __future__ import annotations

import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "catalog" / "engines.toml"
REVIEWS = ROOT / "reviews"


def load(path: Path = CATALOG) -> dict:
    with path.open("rb") as handle:
        return tomllib.load(handle)


def resolve(catalog: dict, engine_id: str) -> tuple[dict | None, str | None]:
    engine = next((row for row in catalog["engine"] if row["id"] == engine_id), None)
    if engine is None:
        return None, f"{engine_id} is not in the catalog"
    if engine["kind"] == "reference":
        return None, f"{engine_id} is a reference project, not diff-reviewed"
    if engine["kind"] != "fork":
        return None, f"{engine_id} is a standalone engine; whole-repo review is later"
    if not engine.get("upstream"):
        return None, f"{engine_id} has no declared upstream"
    return engine, None
