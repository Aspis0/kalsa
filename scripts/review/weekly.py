"""Weekly runner: real scan path; dry run is explicit and isolated."""

from __future__ import annotations

import datetime as dt
import json
import tempfile
import time
from pathlib import Path

from . import batch, catalog, github, progress, results, review
from .reader import client

SHADOW = True
DEFAULT_MAX_REPOS = 5


def _reports() -> dict:
    data = {}
    for path in Path("reviews").glob("*.json"):
        try:
            report = json.loads(path.read_text())
        except json.JSONDecodeError:
            continue
        stem = path.stem.rsplit("-", 1)
        if len(stem) == 2 and len(stem[1]) == 40:
            data[(stem[0], stem[1])] = report
    return data


def _batch(max_repos: int) -> list[dict]:
    token = github.token()
    engines = catalog.load()["engine"]
    heads = {}
    for engine in engines:
        if engine.get("kind") == "fork":
            heads[engine["id"]] = github.fork_head(engine["repo"], token)[0]
    reports = _reports()
    ancestry = {}
    for engine in engines:
        if engine.get("kind") != "fork" or engine["id"] not in heads:
            continue
        found = batch.latest_report(reports, engine["id"])
        if not found:
            continue
        previous = found[0]
        comparison = github.api_get(
            f"/repos/{engine['repo']}/compare/{previous}...{heads[engine['id']]}", token,
        )
        ancestry[engine["id"]] = comparison.get("status") != "diverged"
    return batch.pick(engines, reports, heads, {}, max_repos, ancestry=ancestry)


def dry_run(max_repos: int = DEFAULT_MAX_REPOS) -> list[Path]:
    out = Path(tempfile.mkdtemp(prefix="kalsa-dry-"))
    paths = []
    for row in _batch(max_repos):
        report = {
            "engine": row["id"],
            "inputs": {"fork": row["fork"], "upstream": row["upstream"], "commit": "0" * 40},
            "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "shadow": True,
            "verdict": "dry-run",
            "blocks": [], "findings": [],
        }
        path = out / f"{row['id']}-{'0' * 40}.json"
        path.write_text(json.dumps(report, indent=2) + "\n")
        paths.append(path)
    return paths


def _fork_record(row: dict, report: dict) -> dict:
    blocks = report.get("blocks", [])
    rows_a = [block.get("readers", {}).get("a", {}) for block in blocks]
    rows_b = [block.get("readers", {}).get("b", {}) for block in blocks]
    counts = client.tally(rows_a + rows_b)
    return {
        "id": row["id"], "head": row["head"],
        "verdict": report.get("verdict", "unknown"),
        "files": report.get("stats", {}).get("files", 0),
        "blocks": len(blocks),
        "reader_a": [item.get("verdict", "") for item in rows_a],
        "reader_b": [item.get("verdict", "") for item in rows_b],
        "timeouts": counts["timeouts"], "errors": counts["errors"], "unsure": counts["unsure"],
        "error_classes": counts["error_classes"],
    }


def _totals(records: list[dict], budget: client.TokenBudget) -> dict:
    classes: dict[str, int] = {}
    for row in records:
        for reason, count in row["error_classes"].items():
            classes[reason] = classes.get(reason, 0) + count
    return {
        "forks": len(records),
        "timeouts": sum(row["timeouts"] for row in records),
        "errors": sum(row["errors"] for row in records),
        "unsure": sum(row["unsure"] for row in records),
        "error_classes": classes,
        "tokens": budget.tokens(),
        "token_limit": budget.limit // client.CHARS_PER_TOKEN,
    }


def _summary_text(records: list[dict], totals: dict) -> str:
    lines = ["# Weekly review results", ""]
    for row in records:
        lines.append(
            f"- {row['id']}: {row['verdict']} (files {row['files']}, blocks {row['blocks']}) "
            f"timeouts={row['timeouts']} errors={row['errors']}"
        )
    classes = ", ".join(f"{name}={count}" for name, count in sorted(totals["error_classes"].items())) or "none"
    lines += [
        "",
        f"tokens used: {totals['tokens']} / {totals['token_limit']}",
        f"reader timeouts: {totals['timeouts']}, errors: {totals['errors']}, model unsure: {totals['unsure']}",
        f"error classes: {classes}",
    ]
    return "\n".join(lines) + "\n"


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--max-repos", type=int, default=DEFAULT_MAX_REPOS)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.dry_run:
        paths = dry_run(args.max_repos)
        for path in paths:
            print(path)
        return
    rows = _batch(args.max_repos)
    if not rows:
        print("no fork changed since its last review")
        return
    budget = client.budget_from_env()
    records = []
    for row in rows:
        started = time.monotonic()
        review.scan(
            row["id"], review.MAX_FILES, review.MAX_LINES,
            row.get("base_sha", ""), row["head"], budget=budget,
        )
        report = json.loads(review.report_path(row["id"], row["head"]).read_text())
        record = _fork_record(row, report)
        records.append(record)
        progress.emit(row["id"], record["reader_a"], record["reader_b"], time.monotonic() - started, budget.tokens())
    totals = _totals(records, budget)
    text = _summary_text(records, totals)
    print(text, end="")
    results.write("weekly", text, records, totals)


if __name__ == "__main__":
    main()
