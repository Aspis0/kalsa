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
            record["abort_reason"] = arm.get("abort_reason")
    setup = dict(manifest.get("setup", {}))
    write_outputs(records, proof, setup, "STOPPED")


if __name__ == "__main__":
    main()
