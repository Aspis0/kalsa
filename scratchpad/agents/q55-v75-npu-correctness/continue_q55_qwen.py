import json
import time

from run_q55 import (
    CELL,
    MODEL_QWEN,
    RAW,
    append_log,
    battery_text,
    count_proof,
    now,
    state_check,
    write_outputs,
)
from continue_q55 import run_one


def load_state() -> tuple[list[dict[str, object]], dict[str, dict[str, int]], dict[str, object]]:
    manifest = json.loads((CELL / "manifest.json").read_text(encoding="utf-8"))
    return (
        list(manifest.get("records", [])),
        dict(manifest.get("execute_op_proof", {})),
        dict(manifest.get("setup", {})),
    )


def wait_qwen_part_a() -> bool:
    samples = 0
    while True:
        _, record = battery_text(f"qwen_partA_wait.{samples:03d}")
        level = record.get("level")
        temp = record.get("temperature_tenths")
        plugged = record.get("plugged")
        append_log(
            f"qwen_partA_wait sample={samples} level={level} temp_C="
            f"{None if temp is None else int(temp)/10:.1f} plugged={plugged}"
        )
        if not isinstance(level, int) or level < 50 or plugged is not False:
            append_log("Qwen Part A skipped: battery <50% or charging state changed")
            return False
        if isinstance(temp, int) and temp <= 320:
            return True
        samples += 1
        time.sleep(60.0)


def battery_allows_qwen_part_b() -> bool:
    _, record = battery_text("qwen_partB_battery_gate")
    level = record.get("level")
    plugged = record.get("plugged")
    allowed = isinstance(level, int) and level >= 50 and plugged is False
    append_log(f"qwen_partB_battery_gate level={level} plugged={plugged} allowed={int(allowed)}")
    return allowed


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    records, proof, setup = load_state()
    state_check()
    append_log(f"QWEN_RESUME_UTC={now()}; transient 32.1C gate was waited out; OLMoE Part A not rerun")
    write_outputs(records, proof, setup, "RUNNING")

    if not wait_qwen_part_a():
        append_log("q55 complete under corrected stop rule; Qwen not eligible")
        write_outputs(records, proof, setup, "COMPLETE")
        return 0

    for tag, npu in (
        ("partA_qwen_htp", True),
        ("partA_qwen_cpu", False),
    ):
        if run_one(records, proof, setup, tag, "Qwen3.5-4B-Q4_0", MODEL_QWEN, "ppl", npu):
            append_log(f"STOP q55 true stop tag={tag}; no retry; signature={records[-1].get('failure_signature','')!r}")
            write_outputs(records, proof, setup, "STOPPED")
            return 2

    if battery_allows_qwen_part_b():
        for tag, npu in (
            ("partB_qwen_npu_1", True),
            ("partB_qwen_cpu_1", False),
            ("partB_qwen_cpu_2", False),
            ("partB_qwen_npu_2", True),
        ):
            if not battery_allows_qwen_part_b():
                append_log(f"Qwen Part B stopped before {tag}: battery below 50% or charging state changed")
                break
            if run_one(records, proof, setup, tag, "Qwen3.5-4B-Q4_0", MODEL_QWEN, "bench", npu):
                append_log(f"STOP q55 true stop tag={tag}; no retry; signature={records[-1].get('failure_signature','')!r}")
                write_outputs(records, proof, setup, "STOPPED")
                return 2
    else:
        append_log("Qwen Part B skipped: battery below 50% or charging state changed")

    append_log("q55 complete under corrected stop rule; no TRUE crash signature, guard kill, or transport loss")
    write_outputs(records, proof, setup, "COMPLETE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
