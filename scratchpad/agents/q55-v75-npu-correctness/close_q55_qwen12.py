import json

from run_q55 import (
    CELL,
    MODEL_QWEN,
    RAW,
    append_log,
    count_proof,
    now,
    run_arm,
    state_check,
    write_outputs,
)


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    state_check()
    manifest = json.loads((CELL / "manifest.json").read_text(encoding="utf-8"))
    records = list(manifest.get("records", []))
    proof = dict(manifest.get("execute_op_proof", {}))
    setup = dict(manifest.get("setup", {}))
    append_log(
        f"QWEN_CPU_12CHAR_UTC={now()}; exact CPU-ref flags mirror HTP including -nkvo; "
        "-ngl 0; --chunks 12; KILL=430; Qwen Part B skipped"
    )
    record = run_arm(
        "partA_qwen_cpu_12char",
        "Qwen3.5-4B-Q4_0",
        MODEL_QWEN,
        "ppl",
        False,
        chunks=12,
    )
    records.append(record)
    proof[record["tag"]] = count_proof(record["tag"])
    write_outputs(records, proof, setup, "STOPPED")
    append_log(
        f"partA_qwen_cpu_12char launcher_rc={record.get('launcher_rc')} guard_rc={record.get('guard_rc')} "
        f"workload_rc={record.get('workload_rc')} max_C="
        f"{None if record.get('max_temperature_tenths') is None else int(record['max_temperature_tenths'])/10:.1f} "
        f"signature={record.get('failure_signature','')!r} stop={int(bool(record.get('stop')))}"
    )
    append_log("q55 closing item complete; Qwen Part B remains skipped")
    return 2 if record.get("stop") else 0


if __name__ == "__main__":
    raise SystemExit(main())
