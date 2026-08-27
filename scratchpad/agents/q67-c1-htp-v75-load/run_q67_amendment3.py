#!/usr/bin/env python3
"""Run the single final, unplugged Amendment 3 CPU-reference attempt."""

from __future__ import annotations

import json
import time
from pathlib import Path

import run_q67 as q67


HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
MANIFEST_PATH = HERE / "manifest.json"
TAG = "a2_cpu_amendment3"


def verify_unplugged() -> dict[str, object]:
    text = q67.shell("dumpsys battery", 30)
    q67.write_text(RAW / f"{TAG}.unplugged_battery.txt", text)
    state = q67.battery_values(text)
    q67.log_line(
        f"UNPLUGGED_VERIFY {TAG} AC_powered={state.get('ac_powered')} "
        f"USB_powered={state.get('usb_powered')} Wireless_powered={state.get('wireless_powered')} "
        f"Dock_powered={state.get('dock_powered')} level={state.get('level')} "
        f"temp_tenths={state.get('temperature_tenths')}"
    )
    if state.get("ac_powered") is not False:
        raise RuntimeError(f"AC powered was not false: {state}")
    state["verified_at"] = q67.now()
    state["unplugged_verified"] = True
    return state


def wait_cool_gate() -> dict[str, object] | None:
    started = time.monotonic()
    poll = 0
    while True:
        poll += 1
        state = q67.capture_state(f"{TAG}.cooldown{poll}")
        q67.append_gate(TAG, poll, state)
        level = state.get("level")
        temp = state.get("temperature_tenths")
        mem = state.get("mem_available_kb")
        elapsed = int(time.monotonic() - started)
        q67.log_line(
            f"COOLDOWN {TAG} poll={poll} elapsed_s={elapsed} level={level} temp_tenths={temp} "
            f"MemAvailable_kb={mem} plugged={state.get('plugged')}"
        )
        if isinstance(level, int) and level < 40:
            q67.log_line(f"NOT-RUN {TAG} battery_floor level={level} < 40")
            return None
        if (
            isinstance(level, int)
            and isinstance(temp, int)
            and isinstance(mem, int)
            and level >= 40
            and temp <= 350
            and mem >= 4 * 1024 * 1024
        ):
            q67.log_line(
                f"GATE_PASS {TAG} battery>=40 temp<=35.0 MemAvailable>=4GiB "
                f"plugged={state.get('plugged')} cooldown_elapsed_s={elapsed}"
            )
            return state
        if elapsed >= 40 * 60:
            q67.log_line(f"NOT-RUN {TAG} cool-start wait exceeded 40 min")
            return None
        q67.log_line(f"COOLDOWN_WAIT {TAG} next_poll_s=300 unplugged=true")
        print(
            f"COOLDOWN {TAG}: level={level} temp={temp} tenths MemAvailable={mem}KB; waiting 300s",
            flush=True,
        )
        time.sleep(300)


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise SystemExit("manifest is not an object")
    if q67.remote_exists(f"{q67.REMOTE_DIR}/{TAG}.pid"):
        raise SystemExit(f"remote attempt-3 tag already exists: {TAG}")
    try:
        unplugged = verify_unplugged()
    except Exception as exc:
        manifest["status"] = "STOPPED"
        manifest["stop_reason"] = f"unplugged verification failed: {exc}"
        q67.write_json(MANIFEST_PATH, manifest)
        q67.log_line(f"AMENDMENT3_STOPPED reason=unplugged_verification detail={exc}")
        return 2
    manifest["amendment3"] = {
        "commit": "62e29f09",
        "label": "r characterization under Amendments 2+3 (post-result, CPU-ref only)",
        "status": "COOLDOWN",
        "chunks_limit": 20,
        "unplugged_verification": unplugged,
        "raw_unplugged_battery": f"raw/{TAG}.unplugged_battery.txt",
        "runs": [],
    }
    manifest["status"] = "COOLDOWN_A2_ATTEMPT3"
    manifest["stop_reason"] = None
    q67.write_json(MANIFEST_PATH, manifest)
    q67.log_line(
        "AMENDMENT3_START commit=62e29f09 A2_only=true attempt=3 chunks=20 "
        "addition=-f_/data/local/tmp/wiki.test.raw AC_powered=false A1_stands=true B_untouched=true "
        "cooldown_poll_s=300 cooldown_max_s=2400"
    )
    gate = wait_cool_gate()
    if gate is None:
        manifest["status"] = "STOPPED"
        manifest["stop_reason"] = "A2 attempt 3 cool-start/battery gate not met within 40 min"
        manifest["amendment3"]["status"] = "STOPPED"
        q67.write_json(MANIFEST_PATH, manifest)
        q67.log_line("AMENDMENT3_STOPPED reason=cooldown_or_gate")
        return 2
    manifest["amendment3"]["status"] = "RUNNING"
    manifest["amendment3"]["gate_pre"] = gate
    q67.write_json(MANIFEST_PATH, manifest)
    try:
        record = q67.launch_one(TAG, gate)
    except Exception as exc:
        manifest["status"] = "STOPPED"
        manifest["stop_reason"] = f"launcher failure for {TAG}: {exc}"
        manifest["amendment3"]["status"] = "STOPPED"
        q67.write_json(MANIFEST_PATH, manifest)
        q67.log_line(f"AMENDMENT3_STOPPED tag={TAG} reason=launcher_failure detail={exc}")
        raise
    manifest["amendment3"]["runs"] = [record]
    old_runs = manifest.get("runs", [])
    if not isinstance(old_runs, list):
        old_runs = []
    manifest["runs"] = old_runs + [record]
    q67.write_json(MANIFEST_PATH, manifest)
    values = record.get("running_ppl_values", {})
    chunk_count = len(values) if isinstance(values, dict) else 0
    q67.log_line(
        f"AMENDMENT3_CAPTURED tag={TAG} guard_csv=raw/{TAG}.guard.csv guard_rc=raw/{TAG}.guard.rc "
        f"running_ppl_per_chunk=raw/{TAG}.running_ppl.csv chunks={chunk_count}"
    )
    if record.get("stop_reason"):
        manifest["status"] = "STOPPED"
        manifest["stop_reason"] = record["stop_reason"]
        manifest["amendment3"]["status"] = "STOPPED"
        if chunk_count < 8:
            q67.log_line("AMENDMENT3_R_VOID chunks_below_8; no_retry=true; cell_closed=true")
        q67.write_json(MANIFEST_PATH, manifest)
        return 2
    manifest["status"] = "DONE"
    manifest["stop_reason"] = None
    manifest["amendment3"]["status"] = "DONE"
    q67.write_json(MANIFEST_PATH, manifest)
    q67.log_line(f"AMENDMENT3_DONE tag={TAG} chunks={chunk_count} A1_stands=true B_untouched=true")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
