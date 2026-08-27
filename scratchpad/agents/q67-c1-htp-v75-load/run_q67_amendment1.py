#!/usr/bin/env python3
"""Run only the Amendment 1 corrected A1/A2 q67 arms."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import run_q67 as q67


HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
MANIFEST_PATH = HERE / "manifest.json"


def rename_attempt1_raw() -> list[tuple[str, str]]:
    renamed: list[tuple[str, str]] = []
    for prefix in ("a1_htp", "a2_cpu"):
        for source in sorted(RAW.glob(prefix + ".*")):
            suffix = source.name[len(prefix):]
            target = source.with_name(prefix + "_attempt1_void" + suffix)
            if target.exists():
                raise RuntimeError(f"refusing to overwrite existing attempt-1 artifact: {target.name}")
            source.rename(target)
            renamed.append((source.name, target.name))
    return renamed


def rewrite_raw_paths(value: object) -> object:
    if isinstance(value, str):
        return (
            value.replace("raw/a1_htp.", "raw/a1_htp_attempt1_void.")
            .replace("raw/a2_cpu.", "raw/a2_cpu_attempt1_void.")
        )
    if isinstance(value, list):
        return [rewrite_raw_paths(item) for item in value]
    if isinstance(value, dict):
        return {key: rewrite_raw_paths(item) for key, item in value.items()}
    return value


def save_manifest(manifest: dict[str, object]) -> None:
    q67.write_json(MANIFEST_PATH, manifest)


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise SystemExit("manifest is not an object")
    old_runs = manifest.get("runs", [])
    if not isinstance(old_runs, list):
        raise SystemExit("manifest runs is not a list")
    old_runs = rewrite_raw_paths(old_runs)
    renamed = rename_attempt1_raw()
    manifest["attempt1"] = {
        "status": "VOID",
        "reason": "Amendment 1: corrected command adds -f; attempt 1 omitted corpus and produced 0 evaluated tokens",
        "verdict_letter": "VOID",
        "common_chunks": 0,
        "runs": [row for row in old_runs if isinstance(row, dict) and row.get("tag") in ("a1_htp", "a2_cpu")],
        "raw_renamed": [f"raw/{new}" for _, new in renamed],
    }
    manifest["attempt1_runs"] = old_runs
    manifest["runs"] = [row for row in old_runs if isinstance(row, dict) and str(row.get("tag", "")).startswith("b_")]
    manifest["attempt2"] = {"status": "RUNNING", "runs": [], "amendment": "d451a1ee", "corpus_argument": "/data/local/tmp/wiki.test.raw"}
    manifest["status"] = "RUNNING_ATTEMPT2_A1_A2"
    manifest["stop_reason"] = None
    save_manifest(manifest)
    q67.log_line(
        "AMENDMENT1_START commit=d451a1ee corrected_A1_A2_only=true "
        "addition=-f_/data/local/tmp/wiki.test.raw B_untouched=true "
        f"attempt1_raw_renamed={len(renamed)} supervisor_guard_rc=true"
    )

    records: list[dict[str, object]] = []
    for tag in ("a1_htp_attempt2", "a2_cpu_attempt2"):
        gate = q67.wait_gate(tag)
        if gate is None:
            manifest["status"] = "STOPPED"
            manifest["stop_reason"] = f"gate failed for {tag}"
            manifest["attempt2"]["status"] = "STOPPED"  # type: ignore[index]
            manifest["attempt2"]["runs"] = records  # type: ignore[index]
            save_manifest(manifest)
            q67.log_line(f"AMENDMENT1_STOPPED tag={tag} reason=gate_failed")
            return 2
        try:
            record = q67.launch_one(tag, gate)
        except Exception as exc:
            manifest["status"] = "STOPPED"
            manifest["stop_reason"] = f"launcher failure for {tag}: {exc}"
            manifest["attempt2"]["status"] = "STOPPED"  # type: ignore[index]
            manifest["attempt2"]["runs"] = records  # type: ignore[index]
            save_manifest(manifest)
            q67.log_line(f"AMENDMENT1_STOPPED tag={tag} reason=launcher_failure detail={exc}")
            raise
        records.append(record)
        manifest["attempt2"]["runs"] = records  # type: ignore[index]
        manifest["runs"] = [row for row in old_runs if isinstance(row, dict) and str(row.get("tag", "")).startswith("b_")] + records
        save_manifest(manifest)
        q67.log_line(
            f"AMENDMENT1_CAPTURED tag={tag} guard_csv=raw/{tag}.guard.csv "
            f"guard_rc=raw/{tag}.guard.rc running_ppl_per_chunk=raw/{tag}.running_ppl.csv"
        )
        if record.get("stop_reason"):
            manifest["status"] = "STOPPED"
            manifest["stop_reason"] = record["stop_reason"]
            manifest["attempt2"]["status"] = "STOPPED"  # type: ignore[index]
            save_manifest(manifest)
            q67.log_line(f"AMENDMENT1_STOPPED tag={tag} reason={record['stop_reason']}")
            return 2
        if tag == "a1_htp_attempt2" and (
            record.get("workload_rc") != 0
            or int(record.get("execute_op_htp0_count", 0)) <= 0
            or int(record.get("execute_op_attn_count", 0)) <= 0
        ):
            manifest["status"] = "STOPPED"
            manifest["stop_reason"] = "FAIL-LOAD A1 HTP proof/load gate"
            manifest["attempt2"]["status"] = "STOPPED"  # type: ignore[index]
            save_manifest(manifest)
            q67.log_line("AMENDMENT1_STOPPED reason=FAIL-LOAD_A1_HTP_proof_load_gate")
            return 2

    manifest["attempt2"]["status"] = "DONE"  # type: ignore[index]
    manifest["status"] = "DONE"
    manifest["stop_reason"] = None
    save_manifest(manifest)
    q67.log_line("AMENDMENT1_DONE corrected A1/A2 complete; B untouched")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
