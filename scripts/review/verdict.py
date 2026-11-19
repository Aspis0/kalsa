"""Report verdict and per-block hit maps."""

from __future__ import annotations


def hit_maps(blocks: list[dict], findings: list[dict], signals: list[dict]) -> tuple[dict, dict]:
    hints: dict[str, list[str]] = {}
    hard: dict[str, list[str]] = {}
    for row in findings + signals:
        for block in blocks:
            if row.get("file", row.get("path", "")) != block.get("path", ""):
                continue
            line = int(row.get("line", 0))
            if line and line not in range(block.get("start", 0), block.get("end", 0) + 1):
                continue
            key = block.get("id", "")
            if "suppressed_because" in row:
                hints.setdefault(key, []).append(str(row.get("rule", "")))
            else:
                hard.setdefault(key, []).append(str(row.get("rule", "")))
    return hints, hard


def verdict_for(
    findings: list[dict],
    signals: list[dict],
    decisions: dict | None = None,
    report: dict | None = None,
) -> str:
    if any(row.get("needs_person") for row in findings):
        return "human review needed"
    if any(row["rule"] == "scanner-error" for row in findings):
        return "scanner error"
    decisions = decisions or {}
    needs = [identifier for identifier, value in decisions.items() if value == "needs person"]
    if needs:
        return "human review needed: " + ", ".join(sorted(needs))
    if findings:
        return "findings: human review needed"
    blocks = (report or {}).get("blocks", [])
    if not decisions or any(decisions.get(block.get("id", "")) != "auto-clean" for block in blocks):
        return "human review needed"
    return "no findings"


