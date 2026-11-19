"""Finding post-processing: path findings, per-file grouping and per-tool counts."""

from __future__ import annotations

from . import scanners


def path_findings(info: dict) -> list[dict]:
    out = []
    for path in info["symlinks"]:
        row = scanners.finding("plain", path, 0, "symlink-in-shipped-path", "mode 120000 in the diff")
        if scanners.reaches_users(path):
            out.append(row)
        else:
            out.append({**row, "suppressed_because": "not-reaches-users", "signal": True})
    for path in info["submodules"]:
        out.append(scanners.finding("plain", path, 0, "submodule-in-diff", "mode 160000 or .gitmodules change"))
    return out


def group(findings: list[dict], signals: list[dict]) -> dict:
    by_file: dict[str, list[dict]] = {}
    for row in findings:
        by_file.setdefault(row["file"], []).append(row)
    summary: dict[str, dict] = {}
    for row in signals:
        entry = summary.setdefault(row["rule"], {"count": 0, "examples": []})
        entry["count"] += 1
        if len(entry["examples"]) < 3:
            example = dict(row)
            example["suppressed_because"] = row.get("suppressed_because", "")
            entry["examples"].append(example)
    return {"findings_by_file": by_file, "signal_summary": summary}


def count(findings: list[dict]) -> dict[str, int]:
    result: dict[str, int] = {}
    for row in findings:
        result[row["tool"]] = result.get(row["tool"], 0) + 1
    return result
