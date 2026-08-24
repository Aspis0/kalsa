#!/usr/bin/env python3
"""Phase-2 preflight: verify the frozen q52 output matrix before checks."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import run_q52


def main() -> int:
    prompt_data = json.loads(run_q52.PROMPTS_PATH.read_text(encoding="utf-8"))
    prompts = prompt_data["prompts"]
    jobs = run_q52.matrix_jobs(prompts)
    expected = {
        run_q52.HERE / "gen" / arm / f"{prompt_id}_s{seed}.txt"
        for prompt_id, seed, arm in jobs
    }
    missing = sorted(str(path) for path in expected if not path.exists())
    empty = sorted(str(path) for path in expected if path.exists() and path.stat().st_size == 0)

    manifest = json.loads((run_q52.HERE / "run_manifest.json").read_text(encoding="utf-8"))
    records = manifest.get("runs", [])
    record_keys = [(row.get("id"), row.get("seed"), row.get("arm")) for row in records]
    duplicate_records = sorted({key for key in record_keys if record_keys.count(key) > 1})
    failed_runs = manifest.get("failed_runs", [])

    run_log = (run_q52.HERE / "run.log").read_text(encoding="utf-8", errors="replace").splitlines()
    done_lines = sum(1 for line in run_log if "DONE" in line)
    generation_done_lines = sum(1 for line in run_log if " DONE " in line)
    summary_done_lines = done_lines - generation_done_lines

    print(f"expected_files={len(expected)}")
    print(f"missing_files={len(missing)}")
    print(f"empty_files={len(empty)}")
    print(f"manifest_recorded_runs={len(records)}")
    print(f"run_log_DONE_lines_including_summary={done_lines}")
    print(f"run_log_generation_DONE_lines={generation_done_lines}")
    print(f"run_log_summary_DONE_lines={summary_done_lines}")
    print(f"retry_excess={generation_done_lines - len(records)}")
    print(f"duplicate_manifest_records={len(duplicate_records)}")
    print(f"failed_runs={len(failed_runs)}")
    if missing:
        print("MISSING:")
        print("\n".join(missing))
    if empty:
        print("EMPTY:")
        print("\n".join(empty))

    if (
        missing
        or empty
        or len(records) != 400
        or done_lines != 403
        or generation_done_lines != 402
        or summary_done_lines != 1
        or duplicate_records
        or failed_runs
    ):
        print("INTEGRITY=FAIL")
        return 1
    print("INTEGRITY=PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
