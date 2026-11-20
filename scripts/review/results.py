"""Run results: a markdown summary plus a machine-readable JSON record."""

from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path


def results_dir() -> Path:
    return Path(os.environ.get("REVIEW_RESULTS_DIR", "review-results"))


SECRET_ENV = ("GITHUB_TOKEN", "GH_TOKEN", "REVIEW_A_KEY", "REVIEW_B_KEY")


def redact(text: str) -> str:
    """Strip every secret this process holds before text reaches a log or a file."""
    for name in SECRET_ENV:
        value = os.environ.get(name, "")
        if value:
            text = text.replace(value, "[redacted]")
    return text


def frames(error: BaseException) -> list[str]:
    """Location only: file:line in function. No locals, no source line, no message."""
    return [
        f"{frame.filename}:{frame.lineno} in {frame.name}"
        for frame in traceback.extract_tb(error.__traceback__)
    ]


def write_failure(mode: str, error: BaseException) -> None:
    """A run that died early still leaves an artifact saying why and where, no secrets."""
    detail = redact(str(error))
    location = [redact(frame) for frame in frames(error)]
    record = {"error": type(error).__name__, "detail": detail, "frames": location}
    write(mode, f"# {mode} run failed\n\n{record['error']}: {detail}\n", [record], {"failed": 1})
    for frame in location:
        print(frame, file=sys.stderr)


def _atomic(path: Path, text: str) -> None:
    """A cancelled run must never leave a half-written artifact behind."""
    staging = path.with_name(path.name + ".tmp")
    staging.write_text(text)
    os.replace(staging, path)


def write(mode: str, summary: str, records: list[dict], totals: dict) -> tuple[Path, Path]:
    out = results_dir()
    out.mkdir(parents=True, exist_ok=True)
    markdown = out / f"{mode}-summary.md"
    payload = out / f"{mode}-results.json"
    _atomic(markdown, summary)
    _atomic(payload, json.dumps({"mode": mode, "totals": totals, "records": records}, indent=2) + "\n")
    return markdown, payload
