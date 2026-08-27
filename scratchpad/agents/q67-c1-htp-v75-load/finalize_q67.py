#!/usr/bin/env python3
"""PC-only q67 finalization from raw evidence; never runs adb."""

from __future__ import annotations

import csv
import datetime as dt
import json
import math
import re
from pathlib import Path


HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
MANIFEST = HERE / "manifest.json"
RUN_LOG = HERE / "RUN_LOG.md"


def write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="\n")


def run_log_walls() -> dict[str, int]:
    starts: dict[str, dt.datetime] = {}
    walls: dict[str, int] = {}
    pattern = re.compile(r"^(\S+) ARM_(START|END) (\S+)")
    for line in RUN_LOG.read_text(encoding="utf-8", errors="replace").splitlines():
        match = pattern.match(line)
        if not match:
            continue
        stamp, event, tag = match.groups()
        value = dt.datetime.fromisoformat(stamp)
        if event == "START":
            starts[tag] = value
        elif tag in starts:
            walls[tag] = max(0, int((value - starts[tag]).total_seconds()))
    return walls


def guard_max(tag: str) -> int | None:
    path = RAW / f"{tag}.guard.csv"
    if not path.exists():
        return None
    values: list[int] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = re.match(r"^\d+,(-?\d+),", line)
        if match:
            values.append(int(match.group(1)))
    return max(values) if values else None


def guard_text(tag: str) -> str:
    path = RAW / f"{tag}.guard.csv"
    return path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""


def guard_rc(tag: str) -> int | None:
    path = RAW / f"{tag}.guard.rc"
    if not path.exists():
        return None
    value = path.read_text(encoding="utf-8", errors="replace").strip()
    try:
        return int(value)
    except ValueError:
        return None


def json_rows(tag: str) -> list[dict[str, object]]:
    path = RAW / f"{tag}.stdout.log"
    if not path.exists():
        return []
    rows: list[dict[str, object]] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            rows.append(value)
    return rows


def ppl_values(tag: str, row: dict[str, object]) -> dict[int, float]:
    csv_path = RAW / f"{tag}.running_ppl.csv"
    values: dict[int, float] = {}
    if csv_path.exists():
        with csv_path.open(encoding="utf-8", newline="") as handle:
            for item in csv.DictReader(handle):
                try:
                    values[int(item["chunk"])] = float(item["ppl"])
                except (KeyError, TypeError, ValueError):
                    pass
    if values:
        return values
    stored = row.get("running_ppl_values", {})
    if isinstance(stored, dict):
        for key, value in stored.items():
            try:
                values[int(key)] = float(value)
            except (TypeError, ValueError):
                pass
    return values


def update_row(row: dict[str, object], walls: dict[str, int]) -> None:
    tag = str(row.get("tag", ""))
    artifact_tag = tag
    if not (RAW / f"{artifact_tag}.guard.csv").exists() and (RAW / f"{tag}_attempt1_void.guard.csv").exists():
        artifact_tag = f"{tag}_attempt1_void"
    if tag in walls:
        row["wall_s"] = walls[tag]
    row["guard_rc"] = guard_rc(artifact_tag)
    text = guard_text(artifact_tag)
    row["guard_max_temp_tenths"] = guard_max(artifact_tag)
    killed = "KILL_THRESHOLD" in text or "BATTERY_LOW_ABORT" in text or row["guard_rc"] == 2
    row["guard_kill"] = killed
    row["guard_rc_recorded"] = row["guard_rc"] is not None
    row["guard_outcome"] = "thermal-kill" if killed else "normal-observed-no-kill-event"
    if killed:
        row["stop_reason"] = f"STOP_GUARD_KILL {tag} guard_rc={row['guard_rc']}"
    if tag.startswith("b_"):
        rows = json_rows(tag)
        if rows:
            item = rows[-1]
            samples = item.get("samples_ts")
            if isinstance(samples, list) and samples and isinstance(samples[0], (int, float)):
                row["bench_first_sample_ts"] = float(samples[0])
            if isinstance(item.get("avg_ts"), (int, float)):
                row["bench_avg_ts"] = float(item["avg_ts"])
    raw = row.get("raw")
    if not isinstance(raw, dict):
        raw = {}
        row["raw"] = raw
    raw.update(
        {
            "stdout": f"raw/{artifact_tag}.stdout.log",
            "stderr": f"raw/{artifact_tag}.stderr.log",
            "running_ppl": f"raw/{artifact_tag}.running_ppl.log",
            "running_ppl_csv": f"raw/{artifact_tag}.running_ppl.csv",
            "guard": f"raw/{artifact_tag}.guard.csv",
            "guard_rc": f"raw/{artifact_tag}.guard.rc",
            "workload_rc": f"raw/{artifact_tag}.workload.rc",
        }
    )


def run_table_row(row: dict[str, object]) -> str:
    pre = row.get("gate_pre", {})
    post = row.get("state_post", {})
    pre_t = pre.get("temperature_tenths") if isinstance(pre, dict) else None
    post_t = post.get("temperature_tenths") if isinstance(post, dict) else None
    max_t = row.get("guard_max_temp_tenths")
    return "| " + " | ".join(
        [
            str(row.get("tag")),
            str(row.get("status")),
            str(row.get("workload_rc")),
            str(row.get("guard_rc", "NA")) if row.get("guard_rc") is not None else "NA",
            str(row.get("wall_s", "NA")),
            f"{pre_t / 10:.1f}" if isinstance(pre_t, int) else "NA",
            f"{post_t / 10:.1f}" if isinstance(post_t, int) else "NA",
            f"{max_t / 10:.1f}" if isinstance(max_t, int) else "NA",
            str(row.get("cpuset")),
            str(row.get("execute_op_htp0_count")),
            str(row.get("execute_op_attn_count")),
        ]
    ) + " |"


def load_ok(row: dict[str, object] | None) -> bool:
    if not isinstance(row, dict):
        return False
    return (
        row.get("status") in ("DONE", "CAP_DATUM")
        and row.get("workload_rc") == 0
        and int(row.get("execute_op_htp0_count", 0)) > 0
        and int(row.get("execute_op_attn_count", 0)) > 0
        and not row.get("stop_reason")
    )


def derive(a1: dict[str, object] | None, a2: dict[str, object] | None) -> dict[str, object]:
    htp = ppl_values(str(a1.get("tag")) if isinstance(a1, dict) else "", a1 or {})
    cpu = ppl_values(str(a2.get("tag")) if isinstance(a2, dict) else "", a2 or {})
    common = sorted(set(htp) & set(cpu))
    n = common[-1] if common else None
    r: float | None = None
    gate = "VOID"
    if n is not None and n >= 8 and cpu[n] != 0:
        r = htp[n] / cpu[n] - 1.0
        if math.isfinite(r):
            gate = "PASS" if r <= 0.02 else "GREY" if r <= 0.05 else "FAIL"
        else:
            gate = "FAIL"
    if isinstance(a1, dict) and a1.get("stop_reason"):
        verdict = "STOPPED"
    elif gate == "PASS" and load_ok(a1):
        verdict = "HTP-VIABLE"
    elif gate == "GREY" and load_ok(a1):
        verdict = "HTP-GREY"
    elif not load_ok(a1):
        verdict = "FAIL-LOAD"
    else:
        verdict = "FAIL-NUMERICS"
    return {
        "htp": htp,
        "cpu": cpu,
        "common": common,
        "n": n,
        "r": r,
        "gate": gate,
        "verdict": verdict,
    }


def cooldown_rows() -> list[tuple[str, str, str, str, str, str]]:
    pattern = re.compile(
        r"COOLDOWN a2_cpu_amendment2 poll=(\d+) elapsed_s=(\d+) level=(\S+) "
        r"temp_tenths=(\S+) MemAvailable_kb=(\S+) plugged=(\S+)"
    )
    rows: list[tuple[str, str, str, str, str, str]] = []
    for line in RUN_LOG.read_text(encoding="utf-8", errors="replace").splitlines():
        match = pattern.search(line)
        if match:
            rows.append(match.groups())
    return rows


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    walls = run_log_walls()
    attempt1 = manifest.get("attempt1", {})
    attempt1_runs = attempt1.get("runs", []) if isinstance(attempt1, dict) else []
    attempt2 = manifest.get("attempt2", {})
    attempt2_runs = attempt2.get("runs", []) if isinstance(attempt2, dict) else []
    amendment2 = manifest.get("amendment2", {})
    amendment2_runs = amendment2.get("runs", []) if isinstance(amendment2, dict) else []
    if not isinstance(attempt1_runs, list):
        attempt1_runs = []
    if not isinstance(attempt2_runs, list):
        attempt2_runs = []
    if not isinstance(amendment2_runs, list):
        amendment2_runs = []
    b_runs = [row for row in manifest.get("runs", []) if isinstance(row, dict) and str(row.get("tag", "")).startswith("b_")]
    for row in attempt1_runs + attempt2_runs + amendment2_runs + b_runs:
        if isinstance(row, dict):
            update_row(row, walls)
    a1_old = next((row for row in attempt1_runs if row.get("tag") == "a1_htp"), None)
    a2_old = next((row for row in attempt1_runs if row.get("tag") == "a2_cpu"), None)
    a1_new = next((row for row in attempt2_runs if row.get("tag") == "a1_htp_attempt2"), None)
    a2_new = next((row for row in attempt2_runs if row.get("tag") == "a2_cpu_attempt2"), None)
    a2_post = next((row for row in amendment2_runs if row.get("tag") == "a2_cpu_amendment2"), None)
    new_derivation = derive(a1_new, a2_new)
    post_derivation = derive(a1_new, a2_post)
    manifest["attempt1"]["verdict_letter"] = "VOID"
    manifest["attempt1"]["common_chunks"] = 0
    manifest["attempt1"]["r"] = None
    manifest["attempt2"]["derivation"] = {
        "common_chunks": len(new_derivation["common"]),
        "last_common_n": new_derivation["n"],
        "r": new_derivation["r"],
        "gate": new_derivation["gate"],
        "verdict": new_derivation["verdict"],
    }
    manifest["amendment2"]["label"] = "r20 characterization under Amendment 2 (post-result)"
    manifest["amendment2"]["derivation"] = {
        "common_chunks": len(post_derivation["common"]),
        "last_common_n": post_derivation["n"],
        "r": post_derivation["r"],
        "q55_letter": post_derivation["gate"],
        "a2_chunks_reached": len(post_derivation["cpu"]),
        "verdict": "STOPPED" if isinstance(a2_post, dict) and a2_post.get("stop_reason") else post_derivation["gate"],
    }
    manifest["runs"] = b_runs + attempt2_runs + amendment2_runs
    manifest["numeric_verdict"] = "STOPPED" if isinstance(a2_post, dict) and a2_post.get("stop_reason") else post_derivation["gate"]
    if manifest.get("status") == "DONE":
        manifest["stop_reason"] = None
    manifest["deviations"] = [
        "Attempt 1 A1/A2 omitted -f /data/local/tmp/wiki.test.raw; shipped binary evaluated 0 tokens and produced 0 common PPL chunks. Frozen letter: VOID (common chunks < 8).",
        "Amendment 1 reran A1 with -f /data/local/tmp/wiki.test.raw; A1 hit the NPU guard kill at 41.1 C (guard rc 2), so the frozen stop rule prevented A2. B arms were not rerun and remain the original attempt-1 measurements.",
        "Amendment 2 reopened only A2 post-result with --chunks 20; A2 hit the CPU guard kill at 43.0 C after 4 chunks, so r20 is VOID (n < 8) and no retry was made.",
        "Attempt-2 supervisor emitted guard CSV and guard rc files; cpuset evidence is from binary_pid and is recorded as /.",
    ]
    write(MANIFEST, json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

    lines = [
        "# q67 numbers",
        "",
        "## Attempt 1 A1/A2 (void)",
        "",
        "| arm | status | workload_rc | guard_rc | wall_s | pre_temp_C | post_temp_C | guard_max_C | cpuset | execute_op_HTP0 | execute_op_attn |",
        "|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|",
    ]
    for row in (a1_old, a2_old):
        if isinstance(row, dict):
            lines.append(run_table_row(row))
    lines += [
        "",
        "common chunks = 0; last common n = NA; r = VOID; verdict letter = VOID (common chunks < 8).",
        "",
        "## Attempt 2 corrected A1/A2",
        "",
        "| arm | status | workload_rc | guard_rc | wall_s | pre_temp_C | post_temp_C | guard_max_C | cpuset | execute_op_HTP0 | execute_op_attn |",
        "|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|",
    ]
    for row in (a1_new, a2_new):
        if isinstance(row, dict):
            lines.append(run_table_row(row))
    lines += ["", "| chunk | HTP_PPL | CPU_PPL |", "|---:|---:|---:|"]
    htp = new_derivation["htp"]
    cpu = new_derivation["cpu"]
    common = new_derivation["common"]
    for n in common:
        lines.append(f"| PPL chunk {n} | HTP {htp[n]:.6f} | CPU {cpu[n]:.6f} |")
    n = new_derivation["n"]
    r = new_derivation["r"]
    lines += [
        "",
        f"common chunks = {len(common)}; last common n = {n if n is not None else 'NA'};",
        f"r = {htp[n]:.6f} / {cpu[n]:.6f} - 1 = {r:.6%}" if n is not None and r is not None else "r = VOID (no common chunks; no numeric derivation)",
        f"gate letter = {new_derivation['gate']} (PASS <= 2%; GREY 2-5%; FAIL > 5% or NaN).",
        f"pre-declared verdict = {new_derivation['verdict']}.",
        "",
        "## r20 characterization under Amendment 2 (post-result)",
        "",
        "A1 attempt 2 guard-kill: 41.1 C; wall 486 s; valid PPL chunks 20; guard rc 2; cpuset /.",
        "",
        "| cooldown poll | elapsed_s | battery_% | temp_C | MemAvailable_kB | plugged |",
        "|---:|---:|---:|---:|---:|---|",
    ]
    for poll, elapsed, level, temp, mem, plugged in cooldown_rows():
        lines.append(f"| {poll} | {elapsed} | {level} | {int(temp) / 10:.1f} | {mem} | {plugged} |")
    lines += [
        "",
        "| arm | status | workload_rc | guard_rc | wall_s | pre_temp_C | post_temp_C | guard_max_C | cpuset | chunks |",
        "|---|---|---:|---:|---:|---:|---:|---:|---|---:|",
    ]
    if isinstance(a2_post, dict):
        pre = a2_post.get("gate_pre", {})
        post = a2_post.get("state_post", {})
        pre_t = pre.get("temperature_tenths") if isinstance(pre, dict) else None
        post_t = post.get("temperature_tenths") if isinstance(post, dict) else None
        max_t = a2_post.get("guard_max_temp_tenths")
        lines.append(
            "| " + " | ".join(
                [
                    str(a2_post.get("tag")),
                    str(a2_post.get("status")),
                    str(a2_post.get("workload_rc")),
                    str(a2_post.get("guard_rc")),
                    str(a2_post.get("wall_s", "NA")),
                    f"{pre_t / 10:.1f}" if isinstance(pre_t, int) else "NA",
                    f"{post_t / 10:.1f}" if isinstance(post_t, int) else "NA",
                    f"{max_t / 10:.1f}" if isinstance(max_t, int) else "NA",
                    str(a2_post.get("cpuset")),
                    str(len(post_derivation["cpu"])),
                ]
            ) + " |"
        )
    lines += ["", "| chunk | HTP_PPL | CPU_PPL |", "|---:|---:|---:|"]
    for chunk in post_derivation["common"]:
        lines.append(f"| PPL chunk {chunk} | HTP {post_derivation['htp'][chunk]:.6f} | CPU {post_derivation['cpu'][chunk]:.6f} |")
    post_n = post_derivation["n"]
    post_r = post_derivation["r"]
    lines += [
        "",
        f"n = min(20, A2 chunks reached) = {len(post_derivation['cpu'])}; last common n = {post_n if post_n is not None else 'NA'};",
        f"r20 = {post_derivation['htp'][post_n]:.6f} / {post_derivation['cpu'][post_n]:.6f} - 1 = {post_r:.6%}" if post_n is not None and post_r is not None and post_n >= 8 else "r20 = VOID (A2 guard-killed before chunk 8)",
        f"q55 letter = {post_derivation['gate']} (PASS <= 2%; GREY 2-5%; FAIL > 5% or NaN).",
        "A2 guard-killed before chunk 8; r remains VOID; no retry.",
        "",
        "## B pp512 (attempt 1; stands)",
        "",
        "| arm | status | first_sample_t/s | jsonl_avg_t/s | dT_C | max_C |",
        "|---|---|---:|---:|---:|---:|",
    ]
    for row in b_runs:
        delta = row.get("temperature_delta_tenths")
        maximum = row.get("guard_max_temp_tenths")
        lines.append(
            "| " + " | ".join(
                [
                    str(row.get("tag")),
                    str(row.get("status")),
                    str(row.get("bench_first_sample_ts", "NA")),
                    str(row.get("bench_avg_ts", "NA")),
                    f"{delta / 10:.1f}" if isinstance(delta, int) else "NA",
                    f"{maximum / 10:.1f}" if isinstance(maximum, int) else "NA",
                ]
            ) + " |"
        )
    lines += [
        "",
        "## Frozen protocol record",
        "",
        "Corrected command addition: -f /data/local/tmp/wiki.test.raw; all other A1/A2 flags and environment unchanged.",
        "A1 HTP guard: WARN 40.0 C / KILL 41.0 C; A2 CPU guard: WARN 40.0 C / KILL 43.0 C; poll 10 s; cap 600 s.",
        "Cool-start <= 35.0 C; MemAvailable >= 4194304 kB; cpuset evidence from binary_pid.",
        "STOPPED: A1 NPU guard kill at 41.1 C, guard rc 2; Amendment 2 A2 CPU guard kill at 43.0 C after 4 chunks, guard rc 2; r20 VOID; no retry; B was not rerun.",
    ]
    write(HERE / "REPORT.md", "\n".join(lines) + "\n")
    if manifest.get("status") == "DONE":
        write(HERE / "STATUS.txt", "DONE\n")
    else:
        write(HERE / "STATUS.txt", "STOPPED A2_CPU_GUARD_KILL_43.0C; r20_VOID_n4; NO_RETRY\n")
    with RUN_LOG.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(
            f"{dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec='seconds')} FINALIZE_ATTEMPT2 "
            f"r20_common_chunks={len(post_derivation['common'])} last_common_n={post_n if post_n is not None else 'NA'} "
            f"r20={post_r if post_r is not None else 'VOID'} q55_gate={post_derivation['gate']} verdict={manifest['numeric_verdict']} "
            "attempt1_letter=VOID A1_guard_kill_41.1C_rc2 A2_guard_kill_43.0C_rc2 "
            "A2_chunks=4 no_retry=true B_untouched=true\n"
        )


if __name__ == "__main__":
    main()
