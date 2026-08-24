#!/usr/bin/env python3
"""q46: q8_0 vs control — trunk Q8_0, experts Q2_K/Q3_K byte-identical."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "q37-bprime-from-source"))
from verify_variants import EXPECT_TRUNK, KQUANT, gguf_for, load  # noqa: E402

HERE = Path(__file__).resolve().parent


def main() -> int:
    control_path = gguf_for("lfm", "control")
    q8_path = gguf_for("lfm", "q8_0")
    expect = EXPECT_TRUNK["q8_0"]
    if not control_path.exists():
        print("MISSING control", control_path, file=sys.stderr)
        return 2
    if not q8_path.exists():
        print("MISSING q8_0", q8_path, file=sys.stderr)
        return 2

    base = load(control_path)
    v = load(q8_path)
    base_by = {t["name"]: t for t in base["tensors"]}
    v_by = {t["name"]: t for t in v["tensors"]}

    missing = sorted(set(base_by) - set(v_by))
    extra = sorted(set(v_by) - set(base_by))
    expert_type_mismatch = []
    expert_byte_mismatch = []
    expert_not_k = []
    trunk_bad = []
    leftover_k = []
    for name, bt in base_by.items():
        vt = v_by.get(name)
        if vt is None:
            continue
        if bt["role"] == "expert":
            if vt["type"] != bt["type"]:
                expert_type_mismatch.append((name, bt["type"], vt["type"]))
            if vt["nbytes"] != bt["nbytes"]:
                expert_byte_mismatch.append((name, bt["nbytes"], vt["nbytes"]))
            if vt["type"] not in {"Q2_K", "Q3_K"}:
                expert_not_k.append((name, vt["type"]))
        if bt["role"] == "trunk":
            if vt["type"] != expect:
                trunk_bad.append((name, vt["type"], expect))
            if vt["type"] in KQUANT:
                leftover_k.append((name, vt["type"]))

    expert_sha_match = v["expert_sha256"] == base["expert_sha256"]
    ok = (
        not missing
        and not extra
        and not expert_type_mismatch
        and not expert_byte_mismatch
        and not expert_not_k
        and expert_sha_match
        and not trunk_bad
        and not leftover_k
    )
    report = {
        "ok": ok,
        "control": {
            "path": str(control_path),
            "bytes_on_disk": base["bytes_on_disk"],
            "types": base["types"],
            "trunk_bytes": base["trunk_bytes"],
            "expert_bytes": base["expert_bytes"],
            "expert_sha256": base["expert_sha256"],
        },
        "q8_0": {
            "path": str(q8_path),
            "bytes_on_disk": v["bytes_on_disk"],
            "types": v["types"],
            "trunk_bytes": v["trunk_bytes"],
            "expert_bytes": v["expert_bytes"],
            "expert_sha256": v["expert_sha256"],
        },
        "expert_sha_match": expert_sha_match,
        "missing": missing,
        "extra": extra,
        "expert_type_mismatch": expert_type_mismatch,
        "expert_nbytes_mismatch": expert_byte_mismatch,
        "expert_not_q2k_q3k": expert_not_k,
        "trunk_type_bad": trunk_bad,
        "leftover_kquant_on_trunk": leftover_k,
    }
    (HERE / "verify_q8_vs_control.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    lines = [
        f"ok={ok}",
        f"control bytes={base['bytes_on_disk']} types={base['types']}",
        f"control expert_sha256={base['expert_sha256']}",
        f"q8_0 bytes={v['bytes_on_disk']} types={v['types']}",
        f"q8_0 expert_sha256={v['expert_sha256']}",
        f"expert_sha_match={expert_sha_match}",
        f"trunk_type_bad={len(trunk_bad)} leftover_k={len(leftover_k)}",
        f"expert_type_mismatch={len(expert_type_mismatch)} expert_nbytes_mismatch={len(expert_byte_mismatch)}",
        f"expert_not_q2k_q3k={len(expert_not_k)} missing={len(missing)} extra={len(extra)}",
    ]
    text = "\n".join(lines) + "\n"
    (HERE / "verify_q8_vs_control.txt").write_text(text, encoding="utf-8")
    print(text, end="")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
