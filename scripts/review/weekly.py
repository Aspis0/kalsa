"""Weekly runner: real scan path; dry run is explicit and isolated."""

from __future__ import annotations

import datetime as dt
import json
import tempfile
from pathlib import Path

from . import batch, catalog, github, review
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
    for row in rows:
        review.scan(
            row["id"], review.MAX_FILES, review.MAX_LINES,
            row.get("base_sha", ""), row["head"], budget=budget,
        )
    print(f"tokens used: {budget.tokens()} / {budget.limit // client.CHARS_PER_TOKEN}")


if __name__ == "__main__":
    main()
