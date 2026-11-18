"""The apply guard: only a matching, clean, full-sha review can add a badge."""

from __future__ import annotations

import datetime as dt
import difflib
import json
from pathlib import Path

from .catalog import CATALOG, REVIEWS, load, resolve


def report_for(engine_id: str, commit: str) -> dict:
    path = REVIEWS / f"{engine_id}-{commit}.json"
    if not path.is_file():
        raise ValueError(f"no full-sha report for {engine_id} at {commit}")
    report = json.loads(path.read_text())
    if report.get("inputs", {}).get("commit") != commit:
        raise ValueError(f"report commit does not match {commit}")
    return report


def insert_review(text: str, engine_id: str, commit: str, upstream: str, date: str) -> str:
    lines = text.splitlines(keepends=True)
    start = None
    for index, line in enumerate(lines):
        if line.strip() == "[[engine]]" and f'id = "{engine_id}"' in "".join(lines[index:index + 6]):
            start = index
            break
    if start is None:
        raise ValueError(f"no engine block for {engine_id}")
    end = next((index for index in range(start + 1, len(lines)) if lines[index].strip() == "[[engine]]"), len(lines))
    if "[engine.review]" in "".join(lines[start:end]):
        raise ValueError(f"{engine_id} already has a review")
    block = [
        "\n[engine.review]\n",
        f'commit = "{commit}"\n',
        f'date = "{date}"\n',
        f'upstream = "{upstream}"\n',
    ]
    return "".join(lines[:end] + block + lines[end:])


def apply_review(engine_id: str, catalog_path: Path = CATALOG) -> str:
    engine, reason = resolve(load(catalog_path), engine_id)
    if reason:
        raise ValueError(f"skip {engine_id}: {reason}")
    pinned = engine.get("review", {}).get("commit") or engine.get("commit")
    reports = sorted(REVIEWS.glob(f"{engine_id}-*.json"), key=lambda path: path.name)
    if not reports:
        raise ValueError(f"no review report for {engine_id}")
    report = None
    for path in reports:
        stem = path.stem[len(engine_id) + 1:]
        if len(stem) == 40 and (not pinned or stem == pinned):
            report = report_for(engine_id, stem)
            break
    if report is None:
        raise ValueError(f"no full-sha report matching the catalog pin for {engine_id}")
    if report.get("verdict") != "no findings":
        raise ValueError(f"{engine_id}: latest review is {report.get('verdict')}")
    commit = report["inputs"]["commit"]
    before = catalog_path.read_text()
    after = insert_review(before, engine_id, commit, report["inputs"]["upstream"], dt.date.today().isoformat())
    patch = "".join(difflib.unified_diff(before.splitlines(True), after.splitlines(True), str(catalog_path), str(catalog_path)))
    catalog_path.write_text(after)
    return patch
