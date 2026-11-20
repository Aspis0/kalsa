"""Report verdict and per-block hit maps."""

from __future__ import annotations

BUDGET_VERDICT = "not reviewed this week (budget)"
TIME_VERDICT = "not reviewed this week (time)"
SKIP_REASONS = {BUDGET_VERDICT: "budget exhausted", TIME_VERDICT: "time exhausted"}


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




def assert_not_hollow(payload: dict) -> None:
    inputs = payload.get("inputs", {})
    if (
        payload.get("verdict") not in {"dry-run", "too large to review", *SKIP_REASONS}
        and inputs.get("commit") != inputs.get("base_sha")
        and not payload.get("blocks")
        and not payload.get("stats", {}).get("files")
    ):
        raise ValueError("hollow report refused")


def reader_pass(
    blocks: list[dict], findings: list[dict], signals: list[dict],
    malware_result: dict, report: dict, budget=None, deadline=None,
) -> tuple[dict, str]:
    """Per-chunk hints, both readers, annotation and the verdict for one scan."""
    from .reader import report as reader_report
    from .reader import runner as reader_runner

    hints_by_block, hard_by_block = hit_maps(blocks, findings, signals)
    malware_by_file: dict[str, list[str]] = {}
    for row in malware_result.get("hits", []):
        malware_by_file.setdefault(row.get("path", ""), []).append(row.get("tool", ""))
    reader_a, reader_b, decisions = reader_runner.run(
        blocks, hints_by_block, hard_by_block, malware_by_file, budget=budget, deadline=deadline,
    )
    for reason, verdict in (("budget reached", BUDGET_VERDICT), ("time budget reached", TIME_VERDICT)):
        if any(row.get("reason") == reason for row in reader_a + reader_b):
            return report, verdict
    # annotate and verdict_for both read report["blocks"]; without it no reader
    # verdict is attached and the per-chunk coverage check silently passes.
    report = reader_report.annotate({**report, "blocks": blocks}, reader_a, reader_b, decisions)
    return report, verdict_for(findings, signals, decisions, report)
