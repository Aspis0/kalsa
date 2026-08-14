#!/usr/bin/env python3
"""Kalsa Kernel CI runner — keyed suite over existing assets.

Runs, when the binary is present:

  * test-backend-ops  test -b CPU -o MOE_SWIGLU_ID   (S2 7/7; may be absent
    on a stock submodule pin — probes --list-ops and falls back to
    -o MUL_MAT_ID. A log with 0 tests passed is a hard fail.)
  * test-s3-repack-bench  [-t N] [-n RUNS]           (S3b matrix)

Writes one CSV and one JSON under --out, keyed by
(model, quant, shape, device, temperature, commit). This is packaging, not
new math: the binaries already exist; this script is the keyed envelope.

Usage (from the build tree or with --build):

    python tests/kernel_ci/run.py --build build --out results/kernel_ci
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import platform
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


KEYS = ("model", "quant", "shape", "device", "temperature", "commit")


def git_commit(repo: Path) -> str:
    try:
        out = subprocess.check_output(
            ["git", "-C", str(repo), "rev-parse", "HEAD"],
            stderr=subprocess.DEVNULL,
            text=True,
        )
        return out.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "unknown"


def find_bin(build: Path, name: str) -> Path | None:
    candidates = [
        build / "tests" / name,
        build / "tests" / f"{name}.exe",
        build / "bin" / name,
        build / "bin" / f"{name}.exe",
        build / name,
        build / f"{name}.exe",
    ]
    for c in candidates:
        if c.is_file():
            return c
    # llama.cpp may have been built standalone.
    extra = list(build.rglob(name)) + list(build.rglob(f"{name}.exe"))
    for c in extra:
        if c.is_file() and c.name.startswith(name):
            return c
    return None


def read_temp_c() -> str:
    # Best-effort. Phones: thermal_zone. PC: unknown. Never fail the suite.
    zones = Path("/sys/class/thermal")
    if zones.is_dir():
        for z in sorted(zones.glob("thermal_zone*/temp")):
            try:
                raw = int(z.read_text().strip())
                # millidegree on most kernels
                return f"{raw / 1000.0:.1f}" if raw > 200 else f"{raw:.1f}"
            except (OSError, ValueError):
                continue
    return "unknown"


def device_label() -> str:
    sysname = platform.system().lower()
    machine = platform.machine().lower()
    soc = Path("/sys/devices/soc0/machine")
    if soc.is_file():
        try:
            return soc.read_text().strip() or f"{sysname}-{machine}"
        except OSError:
            pass
    return f"{sysname}-{machine}"


def prepend_dll_path(build: Path, binary: Path | None) -> None:
    """Put the binary's directory and build/bin first on PATH (Windows DLLs)."""
    extras: list[str] = []
    if binary is not None:
        extras.append(str(binary.resolve().parent))
    extras.append(str((build / "bin").resolve()))
    seen: set[str] = set()
    ordered: list[str] = []
    for p in extras:
        key = os.path.normcase(p)
        if key not in seen:
            seen.add(key)
            ordered.append(p)
    cur = os.environ.get("PATH", "")
    os.environ["PATH"] = os.pathsep.join(ordered + ([cur] if cur else []))


def parse_n_tests_passed(log: str) -> int | None:
    """Last 'N tests passed' in the log, or None if the summary is missing."""
    matches = re.findall(r"(\d+)\s+tests passed", log, flags=re.I)
    if not matches:
        return None
    return int(matches[-1])


def probe_list_ops(ops_bin: Path) -> set[str] | None:
    """Return the set of op names if `--list-ops` works; None if the flag is absent."""
    rc, log = run_cmd([str(ops_bin), "--list-ops"], timeout=30)
    if rc != 0:
        return None
    names: set[str] = set()
    for line in log.splitlines():
        s = line.strip()
        if s and " " not in s and s.replace("_", "").isalnum():
            names.add(s)
    return names if names else None


def run_cmd(cmd: list[str], timeout: int) -> tuple[int, str]:
    try:
        p = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=timeout,
        )
        return p.returncode, p.stdout
    except subprocess.TimeoutExpired as e:
        out = e.stdout if isinstance(e.stdout, str) else ""
        return 124, out + "\nTIMEOUT\n"
    except FileNotFoundError:
        return 127, "binary not found\n"


def parse_s3_rows(log: str, meta: dict) -> list[dict]:
    rows = []
    for line in log.splitlines():
        # "  Q4_K gemv 896x2304        t=2   host   116.62 us  ..."
        s = line.strip()
        if " us" not in s or "t=" not in s:
            continue
        if s.startswith("S3") or s.startswith("===") or s.startswith("neon"):
            continue
        parts = s.split()
        if len(parts) < 4:
            continue
        # shape is everything before t=
        try:
            t_idx = next(i for i, p in enumerate(parts) if p.startswith("t="))
        except StopIteration:
            continue
        shape = " ".join(parts[:t_idx])
        row = dict(meta)
        row["model"] = "microbench"
        row["quant"] = shape.split()[0] if shape else "unknown"
        row["shape"] = shape
        row["case"] = shape
        row["raw"] = s
        rows.append(row)
    if not rows:
        row = dict(meta)
        row["model"] = "microbench"
        row["quant"] = "n/a"
        row["shape"] = "s3-repack-matrix"
        row["raw"] = "(no parseable rows; see log)"
        rows.append(row)
    return rows


def parse_ops_rows(log: str, meta: dict, op: str) -> list[dict]:
    rows = []
    for line in log.splitlines():
        if "OK" not in line and "FAIL" not in line and "passed" not in line.lower():
            continue
        if "tests passed" in line.lower() or "backend" in line.lower():
            row = dict(meta)
            row["model"] = "test-backend-ops"
            row["quant"] = "mixed"
            row["shape"] = op
            row["raw"] = line.strip()
            rows.append(row)
            continue
        # per-case lines from test-backend-ops
        if op.replace("_", "").lower() in line.lower().replace("_", "") or "mul_mat" in line.lower():
            row = dict(meta)
            row["model"] = "test-backend-ops"
            row["quant"] = "see-log"
            row["shape"] = line.strip()[:120]
            row["raw"] = line.strip()
            rows.append(row)
    if not rows:
        row = dict(meta)
        row["model"] = "test-backend-ops"
        row["quant"] = "n/a"
        row["shape"] = op
        row["raw"] = "(no parseable rows; see log)"
        rows.append(row)
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--build", type=Path, default=Path("build"), help="build directory")
    ap.add_argument("--out", type=Path, default=Path("results/kernel_ci"), help="output directory")
    ap.add_argument("--repo", type=Path, default=None, help="git repo root (default: two levels up from this file)")
    ap.add_argument("--threads", type=int, default=0, help="pass -t N to the S3b bench (0 = bench default 1,2,8)")
    ap.add_argument("--runs", type=int, default=0, help="pass -n RUNS to the S3b bench (0 = auto)")
    ap.add_argument("--skip-ops", action="store_true")
    ap.add_argument("--skip-s3", action="store_true")
    args = ap.parse_args()

    here = Path(__file__).resolve().parent
    repo = args.repo if args.repo else here.parents[1]
    build = args.build.resolve()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)

    meta = {
        "device": device_label(),
        "temperature": read_temp_c(),
        "commit": git_commit(repo),
        "captured_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platform": platform.platform(),
    }

    records: list[dict] = []
    rc_all = 0

    # Always put build/bin on PATH first so Windows can find ggml.dll / llama.dll.
    prepend_dll_path(build, None)

    if not args.skip_ops:
        ops = find_bin(build, "test-backend-ops")
        if ops is None:
            print("kernel-ci: test-backend-ops not built (optional; stock pin has no MOE_SWIGLU_ID)")
            print("           build llama.cpp tests, or rely on the S3b matrix + dispatch unit test")
        else:
            prepend_dll_path(build, ops)
            listed = probe_list_ops(ops)
            if listed is not None:
                print("kernel-ci: --list-ops:", ", ".join(sorted(listed)))
            candidates = ("MOE_SWIGLU_ID", "MUL_MAT_ID")
            ran_any = False
            for i, op in enumerate(candidates):
                last = i == len(candidates) - 1
                if listed is not None and op not in listed:
                    print(f"kernel-ci: {op} not in --list-ops; skipping")
                    continue
                cmd = [str(ops), "test", "-b", "CPU", "-o", op]
                print("kernel-ci: RUN", " ".join(cmd))
                t0 = time.time()
                rc, log = run_cmd(cmd, timeout=600)
                (out / f"ops_{op}.log").write_text(log, encoding="utf-8", errors="replace")
                n_passed = parse_n_tests_passed(log)
                print(f"kernel-ci: {op} rc={rc} n_passed={n_passed} {time.time() - t0:.1f}s")
                if n_passed is None or n_passed <= 0:
                    print("kernel-ci: 0 tests ran — refusing to record green")
                    if last:
                        rc_all = rc_all or (rc if rc != 0 else 1)
                    elif op == "MOE_SWIGLU_ID":
                        print("kernel-ci: MOE_SWIGLU_ID ran nothing; trying MUL_MAT_ID")
                    continue
                recs = parse_ops_rows(log, meta, op)
                for r in recs:
                    r["suite"] = "test-backend-ops"
                    r["op"] = op
                    r["rc"] = rc
                records.extend(recs)
                ran_any = True
                if rc == 0:
                    break
                rc_all = rc
                break
            if not ran_any and ops is not None:
                print("kernel-ci: ops leg ran 0 tests — refusing to record green")
                rc_all = rc_all or 1

    if not args.skip_s3:
        bench = find_bin(build, "test-s3-repack-bench")
        if bench is None:
            print("kernel-ci: test-s3-repack-bench not found under", build)
            rc_all = rc_all or 1
        else:
            prepend_dll_path(build, bench)
            cmd = [str(bench)]
            if args.threads > 0:
                cmd += ["-t", str(args.threads)]
            if args.runs > 0:
                cmd += ["-n", str(args.runs)]
            print("kernel-ci: RUN", " ".join(cmd))
            t0 = time.time()
            rc, log = run_cmd(cmd, timeout=900)
            (out / "s3_repack_bench.log").write_text(log, encoding="utf-8", errors="replace")
            print(f"kernel-ci: s3-repack-bench rc={rc} {time.time() - t0:.1f}s")
            recs = parse_s3_rows(log, meta)
            no_parse = all(str(r.get("raw", "")).startswith("(no parseable") for r in recs)
            if rc != 0 and no_parse:
                print(
                    f"kernel-ci: s3-repack-bench rc={rc} and no parseable rows — "
                    "refusing to record green (on Windows, is build/bin on PATH?)"
                )
                rc_all = rc if rc != 0 else 1
            for r in recs:
                r["suite"] = "s3-repack-bench"
                r["rc"] = rc
            records.extend(recs)
            if rc != 0:
                rc_all = rc if rc != 0 else rc_all or 1

    csv_path = out / "kernel_ci.csv"
    json_path = out / "kernel_ci.json"
    fieldnames = list(KEYS) + ["suite", "op", "case", "rc", "raw", "captured_utc", "platform"]
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for r in records:
            w.writerow(r)
    payload = {
        "schema": "kalsa-kernel-ci/v1",
        "keys": list(KEYS),
        "meta": meta,
        "n_records": len(records),
        "records": records,
    }
    json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"kernel-ci: wrote {csv_path} and {json_path} ({len(records)} records)")
    return rc_all


if __name__ == "__main__":
    sys.exit(main())
