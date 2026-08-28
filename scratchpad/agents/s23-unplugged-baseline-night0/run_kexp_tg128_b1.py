#!/usr/bin/env python3
"""Amendment-1: one ABBA block kexp_tg128_b1. Screen ON during cells. Stop after block."""

from __future__ import annotations

import time

import launch_one as L
import run_session as S

ABBA = ("A", "C", "C", "A")
BLK = 1
MODEL_ID = "kexp"
WL = "tg128"
P, N = 0, 128


def wake_screen() -> str:
    state = L.screen_state()
    if state != "Awake":
        L.shell("input keyevent 224", timeout=10)
        time.sleep(0.8)
        state = L.screen_state()
    return state


def maybe_sleep_screen() -> str:
    state = L.screen_state()
    if state == "Awake":
        L.shell("input keyevent 26", timeout=10)
        time.sleep(0.5)
        state = L.screen_state()
    return state


def main() -> int:
    S.RAW.mkdir(parents=True, exist_ok=True)
    rows = S.load_manifest()
    L.ensure_transport()
    L.shell(f"mkdir -p {L.REMOTE_DIR}", timeout=15)
    L.adb(["push", str(S.CELL / "run_guarded.sh"), L.REMOTE_SCRIPT], timeout=30)
    L.shell(f"chmod 755 {L.REMOTE_SCRIPT}", timeout=10)

    snap = L.battery()
    t = snap.get("temperature_tenths")
    level = snap.get("level")
    S.log(
        f"B1 preflight serial={L.SERIAL} level={level} temp={None if t is None else t / 10:.1f}C "
        f"ac={snap.get('ac_powered')} usb={snap.get('usb_powered')} "
        f"screen={L.screen_state()} amendment1_gate_C=36.0"
    )
    if L.plugged(snap):
        S.log("PLUG_FAILURE before b1")
        S.write_manifest(rows)
        return 1
    if t is None or int(t) > 360:
        S.log(f"COOL_START_FAIL amendment1: {t} tenths > 360")
        S.write_manifest(rows)
        return 1
    if level is None or int(level) < 45:
        S.log(f"BATTERY_FLOOR before b1: {level}%")
        S.write_manifest(rows)
        return 1

    block_id = f"{MODEL_ID}_{WL}_b{BLK}"
    block_rows: list = []
    for i, arm in enumerate(ABBA, start=1):
        tag = f"{block_id}_{i}_{arm}"
        pre = L.battery()
        if L.plugged(pre):
            S.log("PLUG_FAILURE before cell; stop")
            S.write_manifest(rows)
            return 1
        if pre.get("level") is not None and int(pre["level"]) < 45:
            S.log(f"BATTERY_FLOOR before {tag}: {pre['level']}%; stop, no new cell")
            S.write_manifest(rows)
            return 0
        screen = wake_screen()
        S.log(f"START {tag} ngl={S.NGL[arm]} {WL} screen={screen}")
        row = L.launch(tag, S.cmd_bench(S.KEXP, S.NGL[arm], P, N), 600)
        stdout = (S.RAW / f"{tag}.out").read_text(encoding="utf-8", errors="replace") if (S.RAW / f"{tag}.out").exists() else ""
        stderr = (S.RAW / f"{tag}.err").read_text(encoding="utf-8", errors="replace") if (S.RAW / f"{tag}.err").exists() else ""
        bench = S.parse_jsonl(stdout)
        avg_ts = None if bench is None else bench.get("avg_ts")
        avg_ns = None if bench is None else bench.get("avg_ns")
        rec = S.stamp(
            row,
            {
                "kind": "speed",
                "model": MODEL_ID,
                "model_path": S.KEXP,
                "workload": WL,
                "arm": arm,
                "block": BLK,
                "n_prompt": P,
                "n_gen": N,
                "ngl": S.NGL[arm],
                "avg_ts": avg_ts,
                "avg_ns": avg_ns,
                "load_time_s": S.load_time_s(stderr, float(row.get("wall_s") or 0), avg_ns),
                "bench": bench,
                "amendment": "AMENDMENT-1 cool-start <=36.0 one block",
                "screen_required": "Awake",
            },
        )
        rows.append(rec)
        block_rows.append(rec)
        S.write_manifest(rows)
        S.log(
            f"END {tag} ts={avg_ts} load={rec['load_time_s']} rc={row.get('workload_rc')} "
            f"abort={row.get('abort')} screen_pre={row.get('screen_pre')} "
            f"screen_post={row.get('screen_post')} batt={row.get('battery_post', {}).get('level')} "
            f"temp={row.get('battery_post', {}).get('temperature_tenths')}"
        )
        if row.get("abort") == "PLUG_FAILURE" or rec.get("plugged_post"):
            S.log("PLUG_FAILURE: running block invalid; stop")
            return 1
        if row.get("cpuset_fail") or row.get("failure_signature") or row.get("launcher_exit") not in (0,):
            S.log(f"STOP on {tag}: exit={row.get('launcher_exit')} sig={row.get('failure_signature')}")
            return 1
        if avg_ts is None:
            S.log(f"STOP on {tag}: no avg_ts")
            return 1
        post = row.get("battery_post") or {}
        if post.get("level") is not None and int(post["level"]) < 45:
            S.log(f"BATTERY_FLOOR after {tag}: {post['level']}%; finished in-flight run, no further cells")
            S.write_manifest(rows)
            return 0
        # Screen off between cells only if we still have another cell and temp is high.
        if i < 4:
            maybe_sleep_screen()
    if len(block_rows) == 4:
        S.log(f"BLOCK_OK {block_id} n={len(block_rows)}")
    S.log("MATRIX_STOP after kexp_tg128_b1 (amendment-1). No further blocks.")
    S.write_manifest(rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
