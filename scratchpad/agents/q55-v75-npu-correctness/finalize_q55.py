import json

from run_q55 import CELL, RAW, write_outputs, count_proof


def main() -> None:
    manifest = json.loads((CELL / "manifest.json").read_text(encoding="utf-8"))
    records = list(manifest.get("records", []))
    proof = {
        str(record["tag"]): count_proof(str(record["tag"]))
        for record in records
        if record.get("tag")
    }
    for record in records:
        tag = str(record.get("tag", ""))
        raw_manifest = RAW / f"{tag}.manifest.json"
        if raw_manifest.exists():
            arm = json.loads(raw_manifest.read_text(encoding="utf-8"))
            record["timed_out"] = arm.get("timed_out")
            guard_log_path = RAW / f"{tag}.guard.log"
            guard_log = guard_log_path.read_text(encoding="utf-8", errors="replace") if guard_log_path.exists() else ""
            battery_floor = bool(arm.get("battery_floor_triggered")) or "BATTERY_LOW_ABORT" in guard_log
            record["abort_reason"] = arm.get("abort_reason") or ("battery_below_45_percent_guard" if battery_floor else "")
            record["battery_floor_triggered"] = battery_floor
            record["battery_floor_chunk"] = arm.get("battery_floor_chunk")
            if record["battery_floor_chunk"] is None:
                values = arm.get("running_ppl_values") or {}
                if battery_floor and values:
                    record["battery_floor_chunk"] = max(int(k) for k in values)
            record["guard_kill"] = arm.get("guard_exit_code") == 2
            try:
                workload_rc = int(arm.get("workload_rc"))
            except (TypeError, ValueError):
                workload_rc = None
            record["non_guard_workload_rc_ge_128"] = bool(workload_rc is not None and workload_rc >= 128 and arm.get("guard_exit_code") not in (2, 3) and not arm.get("timed_out") and not battery_floor)
            record["stop"] = bool(record.get("failure_signature") or record["guard_kill"] or record["non_guard_workload_rc_ge_128"])
    setup = dict(manifest.get("setup", {}))
    write_outputs(records, proof, setup, "STOPPED")


if __name__ == "__main__":
    main()
