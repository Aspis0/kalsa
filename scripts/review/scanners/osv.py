"""OSV-Scanner: exit 0 clean, 1 vulnerabilities, anything else scanner error."""

from __future__ import annotations

import json
import re
from pathlib import Path

from .common import finding, run_tool, safe_path, scanner_error
from ..tools import osv_binary


def normalise(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def scan(manifests: list[Path], root: Path, allowed: dict[str, set[str]] | None = None) -> tuple[list[dict], list[dict]]:
    out, signals = [], []
    allowed = allowed or {}
    for path in manifests:
        if not path.is_file():
            continue
        relative = str(path.relative_to(root))
        result = run_tool(
            [str(osv_binary()), "scan", f"--lockfile={safe_path(relative)}", "--format=json"],
            cwd=root,
        )
        if result.error or result.code not in (0, 1):
            out.append({**scanner_error("osv-scanner", result.error or result.stderr), "file": relative})
            continue
        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError:
            out.append({**scanner_error("osv-scanner", "OSV did not produce JSON"), "file": relative})
            continue
        if not data.get("results") and result.code == 1:
            out.append({**scanner_error("osv-scanner", result.stderr or "OSV reported an error"), "file": relative})
            continue
        for row in data.get("results", []):
            for package in row.get("packages", []):
                name = package.get("package", {}).get("name", "")
                unchanged = False
                if relative in allowed and allowed[relative] is not None:
                    permitted = {normalise(item) for item in allowed[relative]}
                    unchanged = bool(name) and normalise(name) not in permitted
                for vulnerability in package.get("vulnerabilities", []):
                    item = finding(
                        "osv-scanner", relative, 0, vulnerability.get("id", ""),
                        vulnerability.get("summary", ""),
                    )
                    item["package"] = name
                    if unchanged:
                        item["suppressed_because"] = "unchanged-dependency"
                        signals.append(item)
                    else:
                        out.append(item)
    return out, signals
