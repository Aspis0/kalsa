"""S2 review pipeline: git-derived diff, scanner gate, badge apply guard."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import tempfile
from pathlib import Path

from . import catalog, dependencies, diff, github, localdiff, scanners
from . import apply as review_apply
from .tools import OSV_VERSION, SEMGREP_VERSION

ROOT = Path(__file__).resolve().parents[2]
REVIEWS = catalog.REVIEWS
MAX_FILES = 2000
MAX_LINES = 200_000
MANIFESTS = {
    "requirements.txt", "pyproject.toml", "package-lock.json", "cargo.lock",
    "poetry.lock", "uv.lock", "go.sum", "go.mod", "environment.yml",
    "vcpkg.json", "conanfile.txt",
}


def report_path(engine_id: str, commit: str) -> Path:
    return REVIEWS / f"{engine_id}-{commit}.json"


scrub = scanners.common.scrub


def write_report(engine_id: str, commit: str, payload: dict) -> Path:
    REVIEWS.mkdir(parents=True, exist_ok=True)
    path = report_path(engine_id, commit)
    clean = scrub(payload)
    clean["findings_digest"] = review_apply.findings_digest(clean)
    path.write_text(json.dumps(clean, indent=2) + "\n")
    return path


added_dependencies = dependencies.added_dependencies
changed_dependencies = dependencies.changed_dependencies


def incomplete_diff(comparison: dict, max_files: int, changed: tuple[str, ...] = (), blob_reader=None) -> dict:
    files = comparison.get("files", [])
    missing = []
    for row in files:
        try:
            row.get("filename", "").encode("utf-8")
        except UnicodeEncodeError:
            return {"reason": "unreviewable-paths", "files_without_patch": [row.get("filename", "")]}
        status = row.get("status", "")
        if status == "removed" or row.get("patch") or status.startswith(("R", "C")):
            continue
        path = row.get("filename", "")
        raw = blob_reader(path) if blob_reader else b""
        if status.startswith("A") and raw is not None and len(raw) == 0:
            continue
        sample = (raw or b"")[:8192]
        if not (diff.binary_path(path) or diff.is_binary_sample(sample)):
            missing.append(path)
    lower = [path.lower() for path in changed]
    collisions = sorted({path for path in lower if lower.count(path) > 1})
    if len(files) >= max_files:
        return {"reason": "diff-cap", "files_without_patch": missing}
    if comparison.get("truncated") or missing:
        return {"reason": "files-without-patch", "files_without_patch": missing}
    if collisions:
        return {"reason": "unreviewable-paths", "case_collisions": collisions}
    return {}


def base_report(engine: dict, engine_id: str, fork_sha: str, upstream_branch: str, fork_branch: str, upstream_sha: str, base_sha: str) -> dict:
    fork, upstream = engine["repo"], engine["upstream"]
    return {
        "engine": engine_id,
        "inputs": {
            "fork": fork, "fork_branch": fork_branch, "commit": fork_sha,
            "upstream": upstream, "upstream_branch": upstream_branch,
            "upstream_sha": upstream_sha, "base_sha": base_sha,
            "compare_url": github.compare_url(upstream, upstream_branch, fork, fork_sha),
            "tool_versions": {"semgrep": SEMGREP_VERSION, "osv-scanner": OSV_VERSION},
            "rule_sources": {
                "semgrep_configs": ["p/secrets", "p/supply-chain", "rules.yml"],
                "rules_sha256": hashlib.sha256(
                    scanners.semgrep.RULES.read_bytes()
                ).hexdigest(),
                "note": "registry packs are named by alias; local rules are hashed",
            },
            "tool_notes": [
                "guarddog not used: local scan requires network access",
                "no model pass: review is deterministic static analysis",
            ],
        },
        "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


MAX_BLOCK_LINES = diff.MAX_BLOCK_LINES
MAX_BLOCK_BYTES = diff.MAX_BLOCK_BYTES


def block_is_truncated(block: dict) -> bool:
    return bool(block.get("truncated"))


def context_lines(lines: list[str], start: int, end: int) -> list[dict]:
    result = []
    for number in list(range(max(1, start - 2), start)) + list(range(end + 1, min(len(lines), end + 2) + 1)):
        result.append({"line": number, "text": lines[number - 1][:200]})
    return result


def export_blocks(info: dict) -> list[dict]:
    out = []
    for path, blocks in info.get("blocks", {}).items():
        ships = scanners.reaches_users(path)
        data = info.get("blobs", {}).get(path, b"")
        lines = diff.split_nl(diff.decode(data))
        binary = info.get("binary_info", {}).get(path, {})
        gitlink = info.get("submodule_shas", {}).get(path)
        for block in blocks:
            start, end = block[0], block[-1]
            used = [line for line in block if 0 < line <= len(lines)][:MAX_BLOCK_LINES]
            text, capped = diff.cap_text("\n".join(lines[number - 1] for number in used))
            if gitlink and not text:
                text = f"submodule {gitlink[0]} -> {gitlink[1]}"
            kind = "lfs-pointer" if diff.is_lfs_pointer(data) else "binary" if binary else "submodule" if gitlink else "text"
            row = {
                "id": hashlib.sha256((path + str(start) + text).encode()).hexdigest(),
                "path": path, "start": start, "end": end, "kind": kind,
                "text": text, "context": context_lines(lines, start, end),
                "ships": ships, "truncated": capped or len(block) > MAX_BLOCK_LINES or len(text.encode()) > MAX_BLOCK_BYTES,
            }
            if binary:
                row.update(binary)
            out.append(row)
    return out


def gated_payload(report: dict, reason: str, stats: dict, gated_files, blocks: list[dict]) -> dict:
    if isinstance(gated_files, str):
        gated = {gated_files: reason}
    elif isinstance(gated_files, list):
        gated = {path: reason for path in gated_files}
    else:
        gated = dict(gated_files)
    return {
        **report,
        "stats": {**stats, "reason": reason},
        "signals": [],
        "findings": [],
        "blocks": blocks,
        "removed_blocks": [],
        "gated_files": gated,
        "verdict": "too large to review",
    }


def write_too_large(
    engine_id: str, commit: str, report: dict, reason: str,
    stats: dict, gated_files="*", blocks: list[dict] | None = None,
) -> None:
    payload = gated_payload(report, reason, stats, gated_files, blocks or [])
    path = write_report(engine_id, commit, payload)
    print(f"{engine_id}: too large to review ({reason}) -> {path}")


def scan(engine_id: str, max_files: int, max_lines: int) -> None:
    engine, reason = catalog.resolve(catalog.load(), engine_id)
    if reason:
        print(f"skip {engine_id}: {reason}")
        return
    gh_token = github.token()
    fork, upstream = engine["repo"], engine["upstream"]
    fork_sha, fork_branch = github.fork_head(fork, gh_token)
    upstream_branch = github.default_branch(upstream, gh_token)
    upstream_sha, _ = github.fork_head(upstream, gh_token)
    report = base_report(engine, engine_id, fork_sha, upstream_branch, fork_branch, upstream_sha, "")
    with tempfile.TemporaryDirectory(prefix="kalsa-review-") as tmp:
        root = Path(tmp)
        bare = root / "repo.git"
        env = localdiff.git_env(root / "home")
        localdiff.init(bare)
        base = localdiff.find_base(
            bare, upstream_sha, fork_sha,
            f"https://github.com/{upstream}.git", f"https://github.com/{fork}.git", env,
            upstream, fork,
        )
        if base is None:
            write_too_large(engine_id, fork_sha, report, "merge-base unavailable", {}, "*", [])
            return
        report["inputs"]["base_sha"] = base
        info = localdiff.analyze(bare, base, fork_sha, env, max_files, max_lines)
        blocks = export_blocks(info)
        truncated = [row["path"] for row in blocks if block_is_truncated(row)]
        if truncated:
            write_too_large(engine_id, fork_sha, report, "block truncated", info["stats"], truncated, blocks)
            return
        if info["oversize"]:
            write_too_large(engine_id, fork_sha, report, "file too large to review", {**info["stats"], "files": info["oversize"]}, info["oversize"], blocks)
            return
        if info["too_large"]:
            write_too_large(engine_id, fork_sha, report, "diff-size-cap", info["stats"], "*", blocks)
            return
        gate = incomplete_diff(
            {"files": [{"filename": path, "status": info["statuses"].get(path, "modified"), "patch": info["patches"].get(path)} for path in info["paths"]]},
            max_files, tuple(info["paths"]), lambda path: info["blobs"].get(path),
        )
        if gate:
            gated = {path: gate["reason"] for path in gate.get("files_without_patch", gate.get("case_collisions", []))}
            write_too_large(engine_id, fork_sha, report, gate["reason"], {**info["stats"], **gate}, gated or "*", blocks)
            return
        allowed = {}
        for manifest in [path for path in info["paths"] if path.lower().endswith(tuple(MANIFESTS))]:
            fork_text = localdiff.file_text(bare, fork_sha, manifest, env)
            source = info["renames"].get(manifest, manifest)
            allowed[manifest] = changed_dependencies(
                manifest, fork_text, localdiff.file_text(bare, upstream_sha, source, env)
            )
        findings, signals, removed_blocks = run_scanners(root, info, fork, upstream, allowed, fork, fork_sha)
        truncated_files = [row["path"] for row in blocks + removed_blocks if block_is_truncated(row)]
        if truncated_files:
            write_too_large(engine_id, fork_sha, report, "block truncated", info["stats"], truncated_files, blocks)
            return
        if info["symlinks"] or info["submodules"]:
            extra = path_findings(info)
            findings += [row for row in extra if not row.get("signal")]
            signals += [row for row in extra if row.get("signal")]
        checker = localdiff.HistoryChecker(bare, base, upstream_sha, env)
        source_lines = {path: diff.split_nl(diff.decode(data)) for path, data in info["blobs"].items()}
        findings, history_signals = history_filter(findings, checker, info["blocks"], source_lines)
        signals += history_signals

    verdict = verdict_for(findings, signals)
    payload = {
        **report,
        "signals": signals,
        "findings": findings,
        "blocks": blocks,
        "removed_blocks": removed_blocks,
        **group(findings, signals),
        "stats": {
            **info["stats"],
            "findings_by_tool": count(findings),
            "signals_by_tool": count(signals),
            "files_without_patch": [],
            "history_cap_hit": checker.cap_hit,
            "history_lookups": checker.used,
        },
        "verdict": verdict,
    }
    path = write_report(engine_id, fork_sha, payload)
    print(f"{engine_id}: {verdict} ({len(findings)} findings, {len(signals)} signals) -> {path}")
    print(f"{engine_id}: findings digest {json.loads(path.read_text())['findings_digest']}")


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


def run_scanners(
    root: Path, info: dict, fork: str, upstream: str,
    allowed: dict[str, set[str]],
    reviewed_repo: str = "", reviewed_sha: str = "",
) -> tuple[list[dict], list[dict], list[dict]]:
    tree = root / "tree"
    paths = []
    for relative, data in info["blobs"].items():
        target = tree / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        paths.append(target)
    manifests = [path for path in paths if str(path.relative_to(tree)) in allowed]
    found = scanners.semgrep_scan(paths, tree, info["added"])
    osv_found, osv_signals = scanners.osv_scan(manifests, tree, allowed)
    plain_found, plain_signals, removed_blocks = scanners.plain_scan(
        paths, list(info["patches"].items()), tree, fork, upstream,
        reviewed_repo, reviewed_sha,
    )
    return (
        found[0] + osv_found + plain_found,
        found[1] + osv_signals + plain_signals,
        removed_blocks,
    )


def history_filter(findings: list[dict], checker: localdiff.HistoryChecker, blocks: dict[str, list[list[int]]], source_lines: dict[str, list[str]]) -> tuple[list[dict], list[dict]]:
    kept, signals = [], []
    for row in findings:
        block = next((item for item in blocks.get(row["file"], []) if row["line"] in item), None)
        if row["tool"] not in {"semgrep", "plain"} or block is None:
            kept.append(row)
            continue
        lines = source_lines.get(row["file"], [])
        wanted = tuple(lines[number - 1].strip() for number in block if 0 < number <= len(lines))
        proof = checker.lookup(row["file"], wanted)
        if proof:
            signals.append({**row, "suppressed_because": "present-in-upstream-history", **proof})
        else:
            kept.append(row)
    return kept, signals


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


def verdict_for(findings: list[dict], signals: list[dict]) -> str:
    if any(row.get("needs_person") for row in findings):
        return "human review needed"
    if any(row["rule"] == "scanner-error" for row in findings):
        return "scanner error"
    return "findings: human review needed" if findings else "no findings"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    scan_cmd = sub.add_parser("scan")
    scan_cmd.add_argument("engine_id")
    scan_cmd.add_argument("--max-files", type=int, default=MAX_FILES)
    scan_cmd.add_argument("--max-lines", type=int, default=MAX_LINES)
    apply_cmd = sub.add_parser("apply")
    apply_cmd.add_argument("engine_id")
    apply_cmd.add_argument("--human-approved", default="", help="SHA-256 findings digest approved by a human")
    apply_cmd.add_argument("--human-declined", default="", help="SHA-256 findings digest declined by the owner")
    apply_cmd.add_argument("--reason", default="", help="reason recorded with a declined review")
    args = parser.parse_args()
    if args.command == "scan":
        scan(args.engine_id, args.max_files, args.max_lines)
    else:
        print(review_apply.apply_review(
            args.engine_id,
            human_approved=args.human_approved,
            human_declined=args.human_declined,
            reason=args.reason,
        ))


if __name__ == "__main__":
    main()
