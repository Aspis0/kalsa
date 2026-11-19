"""The apply guard: only a matching, clean, current head can add a badge."""

from __future__ import annotations

import datetime as dt
import difflib
import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path

from . import localdiff
from .catalog import CATALOG, REVIEWS, load, resolve


def current_head(repo: str, branch: str = "") -> str:
    url = f"https://github.com/{repo}.git"
    with tempfile.TemporaryDirectory(prefix="kalsa-apply-") as tmp:
        env = localdiff.git_env(Path(tmp))
        result = subprocess.run(
            ["git", *localdiff.GIT_ARGS, "ls-remote", url, branch or "HEAD"],
            check=True, capture_output=True, text=True, env=env, timeout=60,
        )
    return result.stdout.split()[0]


def reports_dir() -> Path:
    return Path(os.environ.get("REVIEW_REPORTS_DIR", str(REVIEWS)))


def report_for(engine_id: str, commit: str) -> dict:
    path = reports_dir() / f"{engine_id}-{commit}.json"
    if not path.is_file():
        raise ValueError(f"no full-sha report for {engine_id} at {commit}")
    report = json.loads(path.read_text())
    if report.get("inputs", {}).get("commit") != commit:
        raise ValueError(f"report commit does not match {commit}")
    return report


def _block_digest(row: dict) -> dict:
    result = {}
    for key, value in row.items():
        if key in {"text", "context"}:
            result[key] = hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()
        else:
            result[key] = value
    return result


def findings_digest(report: dict) -> str:
    from .scanners.common import scrub

    inputs = report.get("inputs", {})
    canonical = {
        "engine": report.get("engine", ""),
        "fork": inputs.get("fork", ""),
        "commit": inputs.get("commit", ""),
        "upstream": inputs.get("upstream", ""),
        "upstream_sha": inputs.get("upstream_sha", ""),
        "base_sha": inputs.get("base_sha", ""),
        "verdict": report.get("verdict", ""),
        "signals": report.get("signals", []),
        "stats": report.get("stats", {}),
        "prompt_version": report.get("prompt_version", ""),
        "reader_model_ids": report.get("reader_model_ids", {}),
        "decisions": report.get("decisions", {}),
        "malware": report.get("malware", {}),
        "reader_verdicts": [
            {
                "id": block.get("id", ""),
                "a": block.get("readers", {}).get("a", {}),
                "b": block.get("readers", {}).get("b", {}),
            }
            for block in report.get("blocks", [])
        ],
        "blocks": [_block_digest(row) for row in report.get("blocks", [])],
        "removed_blocks": [_block_digest(row) for row in report.get("removed_blocks", [])],
        "findings": sorted(
            [
                {
                    "path": row.get("file", row.get("path", "")),
                    "line": int(row.get("line", 0)),
                    "rule": str(row.get("rule", "")),
                    "snippet": str(row.get("snippet", "")),
                }
                for row in report.get("findings", [])
            ],
            key=lambda row: json.dumps(row, sort_keys=True),
        ),
    }
    payload = json.dumps(scrub(canonical), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def insert_review(text: str, engine_id: str, commit: str, upstream: str, date: str, approval: str = "") -> str:
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
    if approval:
        block.append(f'approval = "{approval}"\n')
    return "".join(lines[:end] + block + lines[end:])


def remove_review(text: str, engine_id: str) -> str:
    lines = text.splitlines(keepends=True)
    start = None
    for index, line in enumerate(lines):
        if line.strip() == "[[engine]]" and f'id = "{engine_id}"' in "".join(lines[index:index + 6]):
            start = index
            break
    if start is None:
        return text
    end = next((index for index in range(start + 1, len(lines)) if lines[index].strip() == "[[engine]]"), len(lines))
    review = next((index for index in range(start, end) if lines[index].strip() == "[engine.review]"), None)
    if review is None:
        return text
    stop = next((index for index in range(review + 1, end) if lines[index].strip().startswith("[")), end)
    return "".join(lines[:review] + lines[stop:])


def insert_declined(text: str, engine_id: str, commit: str, date: str, reason: str) -> str:
    lines = text.splitlines(keepends=True)
    start = None
    for index, line in enumerate(lines):
        if line.strip() == "[[engine]]" and f'id = "{engine_id}"' in "".join(lines[index:index + 6]):
            start = index
            break
    if start is None:
        raise ValueError(f"no engine block for {engine_id}")
    end = next((index for index in range(start + 1, len(lines)) if lines[index].strip() == "[[engine]]"), len(lines))
    block = [
        "\n[engine.review_declined]\n",
        f'commit = "{commit}"\n',
        f'date = "{date}"\n',
        f'reason = "{reason}"\n',
    ]
    return "".join(lines[:end] + block + lines[end:])


def collect_reports(engine_id: str) -> list[tuple[str, dict]]:
    reports = []
    for path in reports_dir().glob(f"{engine_id}-*.json"):
        stem = path.stem[len(engine_id) + 1:]
        if len(stem) == 40:
            reports.append((stem, json.loads(path.read_text())))
    if not reports:
        raise ValueError(f"no full-sha report for {engine_id}")
    return reports


def checked_head_report(
    engine_id: str, engine: dict, pinned: str, reports: list[tuple[str, dict]],
) -> tuple[str, dict]:
    head = current_head(engine["repo"])
    report = report_for(engine_id, head)
    if pinned and pinned != head:
        raise ValueError(f"catalog pin {pinned} is not the current head {head}")
    for stem, later in reports:
        if later.get("created_at", "") > report.get("created_at", "") and later.get("verdict") != "no findings":
            raise ValueError(f"{stem} is later than {head} and has findings")
    return head, report


def verify_report(
    engine_id: str, engine: dict, report: dict, human_approved: str, human_declined: str,
) -> None:
    if report.get("inputs", {}).get("fork") != engine["repo"]:
        raise ValueError(f"{engine_id}: report fork does not match the catalog")
    if report.get("inputs", {}).get("upstream") != engine["upstream"]:
        raise ValueError(f"{engine_id}: report upstream does not match the catalog")
    if (
        any(row.get("needs_person") for row in report.get("findings", []))
        and not human_approved
        and not human_declined
    ):
        raise ValueError(f"{engine_id}: report has findings that need a person")
    if report.get("verdict") == "no findings" and report.get("findings"):
        raise ValueError(f"{engine_id}: verdict no findings contradicts its findings")
    if "findings_digest" not in report:
        raise ValueError(f"{engine_id}: report has no findings digest")
    if report["findings_digest"] != findings_digest(report):
        raise ValueError(f"{engine_id}: stored findings digest does not match the report")


def human_resolution(
    engine_id: str, report: dict, human_approved: str, human_declined: str, reason: str,
) -> tuple[str, str]:
    verdict = report.get("verdict")
    needs_human = {"human review needed", "findings: human review needed"}
    if human_declined:
        if verdict not in needs_human:
            raise ValueError(f"{engine_id}: verdict {verdict} does not need a decline")
        if findings_digest(report) != human_declined:
            raise ValueError(f"{engine_id}: findings digest does not match")
        if not reason:
            raise ValueError(f"{engine_id}: a decline needs a reason")
        return "", reason
    if human_approved:
        if verdict not in needs_human:
            raise ValueError(f"{engine_id}: verdict {verdict} does not need human approval")
        if findings_digest(report) != human_approved:
            raise ValueError(f"{engine_id}: findings digest does not match")
        return "approved after human review", ""
    if verdict != "no findings":
        raise ValueError(f"{engine_id}: current review is {verdict}")
    return "", ""


def write_catalog(
    catalog_path: Path, engine_id: str, head: str, report: dict, approval: str, decline: str,
) -> str:
    before = catalog_path.read_text()
    if decline:
        before = remove_review(before, engine_id)
        after = insert_declined(before, engine_id, head, dt.date.today().isoformat(), decline)
    else:
        after = insert_review(
            before, engine_id, head, report["inputs"]["upstream"],
            dt.date.today().isoformat(), approval,
        )
    patch = "".join(difflib.unified_diff(before.splitlines(True), after.splitlines(True), str(catalog_path), str(catalog_path)))
    catalog_path.write_text(after)
    return patch


def apply_review(
    engine_id: str,
    catalog_path: Path = CATALOG,
    human_approved: str = "",
    human_declined: str = "",
    reason: str = "",
) -> str:
    if os.environ.get("KALSA_SHADOW") == "true":
        raise ValueError("shadow mode is enabled; no catalog changes are allowed")
    engine, skip_reason = resolve(load(catalog_path), engine_id)
    if skip_reason:
        raise ValueError(f"skip {engine_id}: {skip_reason}")
    pinned = engine.get("review", {}).get("commit") or engine.get("commit")
    reports = collect_reports(engine_id)
    head, report = checked_head_report(engine_id, engine, pinned, reports)
    verify_report(engine_id, engine, report, human_approved, human_declined)
    approval, decline = human_resolution(engine_id, report, human_approved, human_declined, reason)
    print(f"verified current head {head} for {engine['repo']}")
    if approval:
        print(f"verified findings digest {human_approved}")
    print(f"verified no later report with findings for {engine_id}")
    return write_catalog(catalog_path, engine_id, head, report, approval, decline)
