"""S2 review pipeline: git-derived diff, scanner gate, badge apply guard."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import tempfile
from pathlib import Path

from . import catalog, diff, github, localdiff, scanners
from .apply import apply_review
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


def scrub(value):
    home = str(Path.home())
    replacements = [("/private" + home, ""), (home, ""), (str(Path(tempfile.gettempdir())), "")]
    if isinstance(value, str):
        for old, new in replacements:
            value = value.replace(old, new)
        return value
    if isinstance(value, dict):
        return {scrub(key): scrub(item) for key, item in value.items()}
    if isinstance(value, list):
        return [scrub(item) for item in value]
    return value


def write_report(engine_id: str, commit: str, payload: dict) -> Path:
    REVIEWS.mkdir(parents=True, exist_ok=True)
    path = report_path(engine_id, commit)
    path.write_text(json.dumps(scrub(payload), indent=2) + "\n")
    return path


def added_dependencies(fork_text: str, upstream_text: str) -> set[str]:
    def values(text: str) -> dict[str, str]:
        result = {}
        for line in text.splitlines():
            clean = line.strip().lstrip("-+")
            if not clean or clean.startswith("#"):
                continue
            match = re.match(r'["\']?([A-Za-z0-9_.@/-]+)["\']?\s*(?:==|:)\s*["\']?([^"\',;]+)', clean)
            if match:
                result[match.group(1).lower()] = match.group(2).strip().strip("\"'")
        return result
    before, after = values(upstream_text), values(fork_text)
    return {name for name, version in after.items() if before.get(name) != version}


def incomplete_diff(comparison: dict, max_files: int, symlinks: tuple[str, ...] = (), changed: tuple[str, ...] = (), blob_reader=None) -> dict:
    files = comparison.get("files", [])
    missing = []
    for row in files:
        status = row.get("status", "")
        if status == "removed" or row.get("patch") or status.startswith(("R", "C")):
            continue
        path = row.get("filename", "")
        sample = (blob_reader(path) or b"")[:8192] if blob_reader else b""
        if status.startswith("A") and not sample:
            continue
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
            "tool_notes": [
                "guarddog not used: local scan requires network access",
                "no model pass: review is deterministic static analysis",
            ],
        },
        "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def write_too_large(engine_id: str, commit: str, report: dict, reason: str, stats: dict) -> None:
    payload = {**report, "stats": {**stats, "reason": reason}, "signals": [], "findings": [], "verdict": "too large to review"}
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
        )
        if base is None:
            write_too_large(engine_id, fork_sha, report, "merge-base unavailable", {})
            return
        report["inputs"]["base_sha"] = base
        info = localdiff.analyze(bare, base, fork_sha, env, max_files, max_lines)
        if info["oversize"]:
            write_too_large(engine_id, fork_sha, report, "file too large to review", {**info["stats"], "files": info["oversize"]})
            return
        if info["too_large"]:
            write_too_large(engine_id, fork_sha, report, "diff-size-cap", info["stats"])
            return
        gate = incomplete_diff(
            {"files": [{"filename": path, "status": info["statuses"].get(path, "modified"), "patch": info["patches"].get(path)} for path in info["paths"]]},
            max_files, (), tuple(info["paths"]), lambda path: info["blobs"].get(path),
        )
        if gate:
            write_too_large(engine_id, fork_sha, report, gate["reason"], {**info["stats"], **gate})
            return
        allowed = {}
        for manifest in [path for path in info["paths"] if path.lower().endswith(tuple(MANIFESTS))]:
            fork_text = localdiff.file_text(bare, fork_sha, manifest, env)
            source = info["renames"].get(manifest, manifest)
            allowed[manifest] = added_dependencies(fork_text, localdiff.file_text(bare, upstream_sha, source, env))
        findings, signals = run_scanners(
            root, info, fork, upstream, localdiff.domains(bare, upstream_sha, env), allowed,
        )
        if info["symlinks"] or info["submodules"]:
            extra = path_findings(info)
            findings += [row for row in extra if not row.get("signal")]
            signals += [row for row in extra if row.get("signal")]
        checker = localdiff.HistoryChecker(bare, base, upstream_sha, env)
        source_lines = {path: data.decode(errors="ignore").splitlines() for path, data in info["blobs"].items()}
        findings, history_signals = history_filter(findings, checker, info["blocks"], source_lines)
        signals += history_signals

    verdict = "scanner error" if any(row["rule"] == "scanner-error" for row in findings) else (
        "findings: human review needed" if findings else "no findings"
    )
    payload = {
        **report,
        "signals": signals,
        "findings": findings,
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


def run_scanners(root: Path, info: dict, fork: str, upstream: str, upstream_domains: set[str], allowed: dict[str, set[str]]) -> tuple[list[dict], list[dict]]:
    tree = root / "tree"
    paths = []
    for relative, data in info["blobs"].items():
        target = tree / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        paths.append(target)
    manifests = [path for path in paths if str(path.relative_to(tree)) in allowed]
    found = scanners.semgrep_scan(paths, tree, info["added"])
    osv_found = scanners.osv_scan(manifests, tree, allowed)
    plain_found, plain_signals = scanners.plain_scan(paths, list(info["patches"].items()), tree, upstream_domains, fork, upstream)
    return found[0] + osv_found + plain_found, found[1] + plain_signals


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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    scan_cmd = sub.add_parser("scan")
    scan_cmd.add_argument("engine_id")
    scan_cmd.add_argument("--max-files", type=int, default=MAX_FILES)
    scan_cmd.add_argument("--max-lines", type=int, default=MAX_LINES)
    apply_cmd = sub.add_parser("apply")
    apply_cmd.add_argument("engine_id")
    args = parser.parse_args()
    if args.command == "scan":
        scan(args.engine_id, args.max_files, args.max_lines)
    else:
        print(apply_review(args.engine_id))


if __name__ == "__main__":
    main()
