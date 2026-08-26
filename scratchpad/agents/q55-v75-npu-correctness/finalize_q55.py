import json

from run_q55 import CELL, write_outputs, count_proof


def main() -> None:
    manifest = json.loads((CELL / "manifest.json").read_text(encoding="utf-8"))
    records = list(manifest.get("records", []))
    proof = {
        str(record["tag"]): count_proof(str(record["tag"]))
        for record in records
        if record.get("tag")
    }
    setup = dict(manifest.get("setup", {}))
    write_outputs(records, proof, setup, "STOPPED")


if __name__ == "__main__":
    main()
