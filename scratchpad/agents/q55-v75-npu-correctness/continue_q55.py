import json
import sys

from run_q55 import (
    CELL,
    MODEL_OLMOE,
    MODEL_QWEN,
    RAW,
    SERIAL,
    battery_text,
    count_proof,
    now,
    run_arm,
    append_log,
    state_check,
    write_outputs,
)


def load_state() -> tuple[list[dict[str, object]], dict[str, dict[str, int]], dict[str, object]]:
    manifest = json.loads((CELL / "manifest.json").read_text(encoding="utf-8"))
    records = list(manifest.get("records", []))
    proof = dict(manifest.get("execute_op_proof", {}))
    setup = dict(manifest.get("setup", {}))
    for record in records:
        if record.get("tag") == "partB_olmoe_npu_1":
            record["failure_signature"] = ""
            record["false_stop_correction"] = "Normal session-open CDSP text; not a true crash signature under the corrected case-sensitive rule."
            record["stop"] = False
            record["guard_kill"] = False
            record["non_guard_workload_rc_ge_128"] = False
    return records, proof, setup


def eligibility(tag: str) -> bool:
    _, record = battery_text(tag)
    level = record.get("level")
    temp = record.get("temperature_tenths")
    plugged = record.get("plugged")
    eligible = (
        isinstance(level, int)
        and level >= 50
        and isinstance(temp, int)
        and temp <= 320
        and plugged is False
    )
    append_log(
        f"{tag} eligibility level={level} temp_C={None if temp is None else int(temp)/10:.1f} "
        f"plugged={plugged} eligible={int(eligible)}"
    )
    return eligible


def run_one(
    records: list[dict[str, object]],
    proof: dict[str, dict[str, int]],
    setup: dict[str, object],
    tag: str,
    model_name: str,
    model: str,
    kind: str,
    npu: bool,
) -> bool:
    record = run_arm(tag, model_name, model, kind, npu)
    records.append(record)
    proof[tag] = count_proof(tag)
    write_outputs(records, proof, setup, "RUNNING")
    append_log(
        f"{tag} launcher_rc={record.get('launcher_rc')} guard_rc={record.get('guard_rc')} "
        f"workload_rc={record.get('workload_rc')} max_C="
        f"{None if record.get('max_temperature_tenths') is None else int(record['max_temperature_tenths'])/10:.1f} "
        f"signature={record.get('failure_signature','')!r} stop={int(bool(record.get('stop')))}"
    )
    return bool(record.get("stop"))


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    records, proof, setup = load_state()
    state_check()
    append_log(
        f"FALSE_STOP_CORRECTION_UTC={now()}; normal session-open messages containing cdsp are not stops; "
        "correct case-sensitive stop substrings="
        "CDSP0 CRASHED|dspqueue_read failed|dspqueue_write failed|INTERNAL-ERROR|ggml_abort|GGML_ASSERT|Aborted|Segmentation; "
        "workload rc >=128 only when not caused by guard"
    )
    append_log("partB_olmoe_npu_1 reused as B-arm-1; OLMoE Part A not rerun")
    write_outputs(records, proof, setup, "RUNNING")

    for tag, model_name, model, kind, npu in (
        ("partB_olmoe_cpu_1", "OLMoE", MODEL_OLMOE, "bench", False),
        ("partB_olmoe_cpu_2", "OLMoE", MODEL_OLMOE, "bench", False),
        ("partB_olmoe_npu_2", "OLMoE", MODEL_OLMOE, "bench", True),
    ):
        if run_one(records, proof, setup, tag, model_name, model, kind, npu):
            append_log(f"STOP q55 true stop tag={tag}; no retry; signature={records[-1].get('failure_signature','')!r}")
            write_outputs(records, proof, setup, "STOPPED")
            return 2

    if eligibility("qwen_partA_eligibility"):
        for tag, kind, npu in (
            ("partA_qwen_htp", "ppl", True),
            ("partA_qwen_cpu", "ppl", False),
        ):
            if run_one(records, proof, setup, tag, "Qwen3.5-4B-Q4_0", MODEL_QWEN, kind, npu):
                append_log(f"STOP q55 true stop tag={tag}; no retry; signature={records[-1].get('failure_signature','')!r}")
                write_outputs(records, proof, setup, "STOPPED")
                return 2

        if eligibility("qwen_partB_eligibility"):
            for tag, npu in (
                ("partB_qwen_npu_1", True),
                ("partB_qwen_cpu_1", False),
                ("partB_qwen_cpu_2", False),
                ("partB_qwen_npu_2", True),
            ):
                if run_one(records, proof, setup, tag, "Qwen3.5-4B-Q4_0", MODEL_QWEN, "bench", npu):
                    append_log(f"STOP q55 true stop tag={tag}; no retry; signature={records[-1].get('failure_signature','')!r}")
                    write_outputs(records, proof, setup, "STOPPED")
                    return 2
        else:
            append_log("Qwen Part B skipped: battery/temperature eligibility not met after Qwen Part A")
    else:
        append_log("Qwen Part A and Part B skipped: battery/temperature eligibility not met after OLMoE Part B")

    append_log("q55 complete under corrected stop rule; no TRUE crash signature, guard kill, or transport loss")
    write_outputs(records, proof, setup, "COMPLETE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
