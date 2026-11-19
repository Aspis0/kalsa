"""S2 review pipeline: git-derived diff, scanner gate, badge apply guard."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import tempfile
from pathlib import Path

from . import catalog, dependencies, diff, fetch, github, localdiff, scanners
from .findings import count, group, path_findings
from .verdict import BUDGET_VERDICT, assert_not_hollow, reader_pass, verdict_for
from . import apply as review_apply
from .tools import OSV_VERSION, SEMGREP_VERSION
ROOT = Path(__file__).resolve().parents[2]; REVIEWS = catalog.REVIEWS
MAX_FILES, MAX_LINES = 2000, 200_000
MANIFESTS = {
    "requirements.txt", "pyproject.toml", "package-lock.json", "cargo.lock",
    "poetry.lock", "uv.lock", "go.sum", "go.mod", "environment.yml",
    "vcpkg.json", "conanfile.txt",
}


def report_path(engine_id: str, commit: str) -> Path:
    return REVIEWS / f"{engine_id}-{commit}.json"


scrub = scanners.common.scrub


def write_report(engine_id: str, commit: str, payload: dict) -> Path:
    assert_not_hollow(payload)
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
        kind = "lfs-pointer" if diff.is_lfs_pointer(data) else "binary" if binary else "submodule" if gitlink else "text"
        for block in blocks:
            usable = [line for line in block if 0 < line <= len(lines)]
            # A gitlink has no blob, so keep one entry carrying the submodule shas.
            chunks = diff.chunk_block(usable, lines) or [block]
            for index, chunk in enumerate(chunks, 1):
                start, end = chunk[0], chunk[-1]
                text = "\n".join(lines[number - 1] for number in chunk if 0 < number <= len(lines))
                if gitlink and not text:
                    text = f"submodule {gitlink[0]} -> {gitlink[1]}"
                row = {
                    "id": hashlib.sha256((path + str(start) + text).encode()).hexdigest(),
                    "path": path, "start": start, "end": end, "kind": kind,
                    "text": text, "context": context_lines(lines, start, end),
                    "ships": ships, "part": index, "parts": len(chunks),
                }
                if binary:
                    row.update(binary)
                out.append(row)
    return out


def reader_blocks(blocks: list[dict], findings: list[dict], signals: list[dict]) -> list[dict]:
    """Pixels and binary bytes are not reviewable text; both are already owner decisions."""
    images = {row["file"] for row in signals if row.get("suppressed_because") == "plain-image"}
    binaries = {row["file"] for row in findings if row.get("rule") == "binary-or-nul-content"}
    return [row for row in blocks if row["path"] not in images | binaries]


def gated_payload(
    report: dict, reason: str, stats: dict, gated_files, blocks: list[dict],
    verdict: str = "too large to review",
) -> dict:
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
        "verdict": verdict,
    }


def write_gated(
    engine_id: str, commit: str, report: dict, reason: str,
    stats: dict, gated_files="*", blocks: list[dict] | None = None,
    verdict: str = "too large to review",
) -> None:
    payload = gated_payload(report, reason, stats, gated_files, blocks or [], verdict)
    path = write_report(engine_id, commit, payload)
    print(f"{engine_id}: {verdict} ({reason}) -> {path}")


def scan_inputs(engine: dict, engine_id: str, head_override: str) -> tuple[dict, str, str]:
    gh_token = github.token()
    fork, upstream = engine["repo"], engine["upstream"]
    fork_sha, fork_branch = github.fork_head(fork, gh_token)
    fork_sha = head_override or fork_sha
    upstream_branch = github.default_branch(upstream, gh_token)
    upstream_sha, _ = github.fork_head(upstream, gh_token)
    report = base_report(engine, engine_id, fork_sha, upstream_branch, fork_branch, upstream_sha, "")
    return report, fork_sha, upstream_sha


def diff_gate(info: dict, max_files: int) -> tuple[str, dict, object] | None:
    """Per-fork caps and diff integrity; None means the diff is reviewable."""
    if info["oversize"]:
        return "file too large to review", {**info["stats"], "files": info["oversize"]}, info["oversize"]
    if info["too_large"]:
        return "diff-size-cap", info["stats"], "*"
    gate = incomplete_diff(
        {"files": [{"filename": path, "status": info["statuses"].get(path, "modified"), "patch": info["patches"].get(path)} for path in info["paths"]]},
        max_files, tuple(info["paths"]), lambda path: info["blobs"].get(path),
    )
    if gate:
        gated = {path: gate["reason"] for path in gate.get("files_without_patch", gate.get("case_collisions", []))}
        return gate["reason"], {**info["stats"], **gate}, gated or "*"
    return None


def manifest_allowances(bare: Path, info: dict, fork_sha: str, upstream_sha: str, env: dict) -> dict:
    allowed = {}
    for manifest in [path for path in info["paths"] if path.lower().endswith(tuple(MANIFESTS))]:
        source = info["renames"].get(manifest, manifest)
        allowed[manifest] = changed_dependencies(
            manifest, localdiff.file_text(bare, fork_sha, manifest, env),
            localdiff.file_text(bare, upstream_sha, source, env),
        )
    return allowed


def malware_pass(root: Path, info: dict) -> tuple[dict, list[dict]]:
    if os.environ.get("REVIEW_MALWARE") == "0":
        return {"status": "not-run", "hits": []}, [{
            "tool": "malware", "file": "", "line": 0, "rule": "malware-not-run",
            "snippet": "scanning disabled", "needs_person": True,
        }]
    from . import malware
    result = malware.scan_tree([root / "tree" / path for path in info["blobs"]])
    extra = []
    if result["hits"]:
        extra.append({
            "tool": "malware", "file": "", "line": 0, "rule": "malware-hit",
            "snippet": ", ".join(str(row.get("tool", "")) for row in result["hits"]),
            "needs_person": True,
        })
    return result, extra


def history_pass(info: dict, findings: list[dict], signals: list[dict], checker) -> tuple[list[dict], list[dict]]:
    if info["symlinks"] or info["submodules"]:
        extra = path_findings(info)
        findings += [row for row in extra if not row.get("signal")]
        signals += [row for row in extra if row.get("signal")]
    source_lines = {path: diff.split_nl(diff.decode(data)) for path, data in info["blobs"].items()}
    findings, history_signals = history_filter(findings, checker, info["blocks"], source_lines)
    return findings, signals + history_signals


def final_payload(
    report: dict, verdict: str, info: dict, blocks: list[dict], findings: list[dict],
    signals: list[dict], removed_blocks: list[dict], malware_result: dict, checker,
) -> dict:
    return {
        **report,
        "signals": signals,
        "findings": findings,
        "blocks": blocks,
        "reader_model_ids": report["reader_model_ids"],
        "prompt_version": report["prompt_version"],
        "malware": malware_result,
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


def scan(engine_id: str, max_files: int, max_lines: int, base_override: str = "",
         head_override: str = "", budget=None) -> None:
    engine, reason = catalog.resolve(catalog.load(), engine_id)
    if reason:
        print(f"skip {engine_id}: {reason}")
        return
    fork, upstream = engine["repo"], engine["upstream"]
    report, fork_sha, upstream_sha = scan_inputs(engine, engine_id, head_override)
    with tempfile.TemporaryDirectory(prefix="kalsa-review-") as tmp:
        root = Path(tmp)
        bare = root / "repo.git"
        env = localdiff.git_env(root / "home")
        localdiff.init(bare)
        base = fetch.resolve_base(bare, upstream_sha, fork_sha, base_override, upstream, fork, env)
        if base is None:
            write_gated(engine_id, fork_sha, report, "merge-base unavailable", {}, "*", [])
            return
        report["inputs"]["base_sha"] = base
        try:
            info = localdiff.analyze(bare, base, fork_sha, env, max_files, max_lines)
        except RuntimeError:
            write_gated(engine_id, fork_sha, report, "scanner error", {}, "*", [])
            return
        blocks = export_blocks(info)
        gate = diff_gate(info, max_files)
        if gate:
            write_gated(engine_id, fork_sha, report, gate[0], gate[1], gate[2], blocks)
            return
        allowed = manifest_allowances(bare, info, fork_sha, upstream_sha, env)
        findings, signals, removed_blocks = run_scanners(root, info, fork, upstream, allowed, fork, fork_sha)
        blocks = reader_blocks(blocks, findings, signals)
        try:
            malware_result, malware_findings = malware_pass(root, info)
        except RuntimeError:
            write_gated(engine_id, fork_sha, report, "scanner error", info["stats"], "*", blocks)
            return
        findings += malware_findings
        checker = localdiff.HistoryChecker(bare, base, upstream_sha, env)
        findings, signals = history_pass(info, findings, signals, checker)
    report, verdict = reader_pass(blocks, findings, signals, malware_result, report, budget)
    if verdict == BUDGET_VERDICT:
        write_gated(engine_id, fork_sha, report, "budget exhausted", info["stats"], "*", blocks, BUDGET_VERDICT)
        return
    payload = final_payload(
        report, verdict, info, blocks, findings, signals, removed_blocks, malware_result, checker,
    )
    path = write_report(engine_id, fork_sha, payload)
    print(f"{engine_id}: {verdict} ({len(findings)} findings, {len(signals)} signals) -> {path}")
    print(f"{engine_id}: findings digest {json.loads(path.read_text())['findings_digest']}")


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
