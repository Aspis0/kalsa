#!/usr/bin/env python3
"""Final q67 attempt: one sanctioned reboot, then only A2 CPU."""

from __future__ import annotations

import json
import time
from pathlib import Path

import run_q67 as q67


HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
MANIFEST_PATH = HERE / "manifest.json"
TAG = "a2_cpu_amendment4"


def append_raw(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


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


def wait_reattach() -> tuple[bool, float]:
    started = time.monotonic()
    progress = RAW / f"{TAG}.boot_reattach.log"
    q67.write_text(progress, "")
    while True:
        elapsed = time.monotonic() - started
        if elapsed > 600:
            q67.log_line(f"AMENDMENT4_STOPPED reason=adb_reattach_timeout elapsed_s={int(elapsed)}")
            return False, elapsed
        result = q67.adb_run(["shell", "getprop", "sys.boot_completed"], 15)
        output = result.stdout + result.stderr
        append_raw(progress, f"{q67.now()} elapsed_s={int(elapsed)} rc={result.returncode} output={output!r}\n")
        booted = result.returncode == 0 and any(line.strip() == "1" for line in result.stdout.splitlines())
        if booted:
            q67.log_line(f"AMENDMENT4_ADB_REATTACHED boot_completed=1 elapsed_s={int(elapsed)} serial={q67.SERIAL}")
            return True, elapsed
        time.sleep(10)


def wait_prearm_gate(boot_elapsed: float) -> dict[str, object] | None:
    started = time.monotonic()
    poll = 0
    while True:
        poll += 1
        state = q67.capture_state(f"{TAG}.gate{poll}")
        q67.append_gate(TAG, poll, state)
        level = state.get("level")
        temp = state.get("temperature_tenths")
        mem = state.get("mem_available_kb")
        elapsed = boot_elapsed + (time.monotonic() - started)
        q67.log_line(
            f"PREARM_GATE {TAG} poll={poll} boot_elapsed_s={int(elapsed)} level={level} "
            f"temp_tenths={temp} MemAvailable_kb={mem} plugged={state.get('plugged')}"
        )
        if isinstance(level, int) and level < 40:
            q67.log_line(f"AMENDMENT4_STOPPED reason=battery_below_40 level={level}")
            return None
        if (
            state.get("ac_powered") is False
            and isinstance(level, int)
            and isinstance(temp, int)
            and isinstance(mem, int)
            and level >= 40
            and temp <= 350
            and mem >= 4 * 1024 * 1024
        ):
            q67.log_line(
                f"GATE_PASS {TAG} unplugged=true battery>=40 temp<=35.0 "
                f"MemAvailable>=4GiB cpuset_checked_by_launcher=true boot_elapsed_s={int(elapsed)}"
            )
            return state
        if elapsed >= 900:
            q67.log_line(
                f"AMENDMENT4_STOPPED reason=prearm_gate_timeout boot_elapsed_s={int(elapsed)} "
                f"MemAvailable_kb={mem} temp_tenths={temp} level={level}"
            )
            return None
        q67.log_line(f"PREARM_GATE_WAIT {TAG} next_poll_s=30")
        time.sleep(30)


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise SystemExit("manifest is not an object")
    if q67.remote_exists(f"{q67.REMOTE_DIR}/{TAG}.pid"):
        raise SystemExit(f"remote attempt-4 tag already exists: {TAG}")

    pre_reboot = q67.capture_state(f"{TAG}.pre_reboot")
    q67.log_line(
        f"AMENDMENT4_REBOOT_REQUEST pre_reboot_level={pre_reboot.get('level')} "
        f"pre_reboot_temp_tenths={pre_reboot.get('temperature_tenths')} "
        f"pre_reboot_MemAvailable_kb={pre_reboot.get('mem_available_kb')} "
        f"pre_reboot_AC_powered={pre_reboot.get('ac_powered')}"
    )
    reboot = q67.adb_run(["reboot"], 30)
    q67.write_text(
        RAW / f"{TAG}.reboot.log",
        f"time={q67.now()} command=adb -s {q67.SERIAL} reboot returncode={reboot.returncode}\n"
        + reboot.stdout
        + reboot.stderr,
    )
    q67.log_line(f"AMENDMENT4_REBOOT_ISSUED returncode={reboot.returncode} exactly_one=true")
    if reboot.returncode != 0:
        manifest["status"] = "STOPPED"
        manifest["stop_reason"] = f"adb reboot failed rc={reboot.returncode}"
        q67.write_json(MANIFEST_PATH, manifest)
        q67.log_line("AMENDMENT4_STOPPED reason=reboot_command_failed")
        return 2

    manifest["amendment4"] = {
        "commit": "15dc8556",
        "label": "r characterization under Amendments 2-4 (post-result, CPU-ref only)",
        "status": "BOOT_WAIT",
        "chunks_limit": 20,
        "reboot": {"issued": True, "count": 1, "command": f"adb -s {q67.SERIAL} reboot", "raw": f"raw/{TAG}.reboot.log"},
        "runs": [],
    }
    manifest["status"] = "BOOT_WAIT_AMENDMENT4"
    manifest["stop_reason"] = None
    q67.write_json(MANIFEST_PATH, manifest)
    reattached, boot_elapsed = wait_reattach()
    if not reattached:
        manifest["status"] = "STOPPED"
        manifest["stop_reason"] = "ADB did not reattach within 10 min"
        manifest["amendment4"]["status"] = "STOPPED"
        q67.write_json(MANIFEST_PATH, manifest)
        return 2

    manifest["amendment4"]["status"] = "IDLE_3_MIN"
    manifest["amendment4"]["boot_reattach_elapsed_s"] = int(boot_elapsed)
    q67.write_json(MANIFEST_PATH, manifest)
    q67.log_line("AMENDMENT4_IDLE_START duration_s=180")
    time.sleep(180)
    q67.log_line("AMENDMENT4_IDLE_END duration_s=180")

    try:
        unplugged = verify_unplugged()
    except Exception as exc:
        manifest["status"] = "STOPPED"
        manifest["stop_reason"] = f"unplugged verification failed: {exc}"
        manifest["amendment4"]["status"] = "STOPPED"
        q67.write_json(MANIFEST_PATH, manifest)
        q67.log_line(f"AMENDMENT4_STOPPED reason=unplugged_verification detail={exc}")
        return 2
    manifest["amendment4"]["unplugged_verification"] = unplugged
    manifest["amendment4"]["status"] = "PREARM_GATE"
    q67.write_json(MANIFEST_PATH, manifest)
    gate = wait_prearm_gate(boot_elapsed)
    if gate is None:
        manifest["status"] = "STOPPED"
        manifest["stop_reason"] = "Amendment 4 pre-arm gate timeout/failure"
        manifest["amendment4"]["status"] = "STOPPED"
        q67.write_json(MANIFEST_PATH, manifest)
        return 2

    manifest["amendment4"]["status"] = "RUNNING"
    manifest["amendment4"]["gate_pre"] = gate
    q67.write_json(MANIFEST_PATH, manifest)
    try:
        record = q67.launch_one(TAG, gate)
    except Exception as exc:
        manifest["status"] = "STOPPED"
        manifest["stop_reason"] = f"launcher failure for {TAG}: {exc}"
        manifest["amendment4"]["status"] = "STOPPED"
        q67.write_json(MANIFEST_PATH, manifest)
        q67.log_line(f"AMENDMENT4_STOPPED tag={TAG} reason=launcher_failure detail={exc}")
        raise
    manifest["amendment4"]["runs"] = [record]
    old_runs = manifest.get("runs", [])
    if not isinstance(old_runs, list):
        old_runs = []
    manifest["runs"] = old_runs + [record]
    q67.write_json(MANIFEST_PATH, manifest)
    values = record.get("running_ppl_values", {})
    chunk_count = len(values) if isinstance(values, dict) else 0
    q67.log_line(
        f"AMENDMENT4_CAPTURED tag={TAG} guard_csv=raw/{TAG}.guard.csv guard_rc=raw/{TAG}.guard.rc "
        f"running_ppl_per_chunk=raw/{TAG}.running_ppl.csv chunks={chunk_count}"
    )
    if record.get("stop_reason"):
        manifest["status"] = "STOPPED"
        manifest["stop_reason"] = record["stop_reason"]
        manifest["amendment4"]["status"] = "STOPPED"
        if chunk_count < 8:
            q67.log_line("AMENDMENT4_R_VOID chunks_below_8; no_retry=true; cell_closed=true")
        q67.write_json(MANIFEST_PATH, manifest)
        return 2
    manifest["status"] = "DONE"
    manifest["stop_reason"] = None
    manifest["amendment4"]["status"] = "DONE"
    q67.write_json(MANIFEST_PATH, manifest)
    q67.log_line(f"AMENDMENT4_DONE tag={TAG} chunks={chunk_count} A1_stands=true B_untouched=true")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
