"""Deterministic weekly batch picker."""

from __future__ import annotations

from .verdict import BUDGET_VERDICT


def latest_report(reports: dict, engine_id: str) -> tuple[str, dict] | None:
    # A budget skip is not a review: ignore it so the fork is retried next week.
    matches = [
        (commit, report) for (identifier, commit), report in reports.items()
        if identifier == engine_id and report.get("verdict") != BUDGET_VERDICT
    ]
    return max(matches, key=lambda item: str(item[1].get("created_at", ""))) if matches else None


def pick(
    engines: list[dict], reports: dict, heads: dict, sizes: dict,
    max_repos: int = 5, ancestry: dict[str, bool] | None = None,
) -> list[dict]:
    moved, unseen = [], []
    for engine in engines:
        if engine.get("kind") != "fork":
            continue
        identifier = engine["id"]
        head = heads.get(identifier, "")
        if not head:
            continue
        found = latest_report(reports, identifier)
        row = {"id": identifier, "fork": engine["repo"], "upstream": engine["upstream"], "head": head}
        if found:
            commit, report = found
            if commit == head:
                continue
            row["base_sha"] = commit if (ancestry or {}).get(identifier, True) else ""
            row["reason"] = "head moved" if row["base_sha"] else "force push; full read"
            moved.append(row)
        else:
            row["base_sha"] = ""
            row["reason"] = "never reviewed"
            unseen.append(row)
    key = lambda row: (sizes.get(row["id"], 0), row["id"])
    return (sorted(moved, key=key) + sorted(unseen, key=key))[:max_repos]
