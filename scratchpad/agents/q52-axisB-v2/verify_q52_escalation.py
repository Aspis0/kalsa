#!/usr/bin/env python3
"""Verify the completed long_it_04 escalation matrix."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import run_q52


def main() -> int:
    manifest = json.loads((run_q52.HERE / "escalation_manifest.json").read_text(encoding="utf-8"))
    jobs = [(run_q52.ESCALATION_ID, seed, arm) for seed in run_q52.ESCALATION_SEEDS for arm in run_q52.ARMS]
    expected = {
        run_q52.HERE / "gen" / arm / f"{prompt_id}_s{seed}.txt"
        for prompt_id, seed, arm in jobs
    }
    missing = [path for path in expected if not path.exists()]
    empty = [path for path in expected if path.exists() and path.stat().st_size == 0]
    keys = {(row.get("id"), row.get("seed"), row.get("arm")) for row in manifest.get("runs", [])}
    expected_keys = set(jobs)
    print(f"expected_files={len(expected)}")
    print(f"nonempty_files={len(expected) - len(missing) - len(empty)}")
    print(f"missing_files={len(missing)}")
    print(f"empty_files={len(empty)}")
    print(f"manifest_recorded_runs={len(manifest.get('runs', []))}")
    print(f"failed_runs={len(manifest.get('failed_runs', []))}")
    print(f"manifest_key_mismatch={len(expected_keys ^ keys)}")
    if missing or empty or len(manifest.get("runs", [])) != 20 or manifest.get("failed_runs") or keys != expected_keys:
        print("ESC_INTEGRITY=FAIL")
        return 1
    print("ESC_INTEGRITY=PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
