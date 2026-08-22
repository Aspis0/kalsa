#!/usr/bin/env python3
"""Rebuild runs.csv from on-device session logs. Does not re-run anything."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
LOGS = OUT / "logs"
CSV = OUT / "runs.csv"

HDR = (
    "ts,cell,rep,n_ctx,ubatch,cold,phase,n_prompt,n_past,tokens,"
    "load_s,prefill_s,prefill_tps,ttft_s,tok_s,wall_s,rc,batt_pct,temp_c,"
    "plugged,memavail_kib,kv_mib,compute_mib,note\n"
)


def kv_compute(text: str) -> tuple[str, str]:
    kv = ""
    comp = ""
    m = re.search(r"CPU KV buffer size =\s+([0-9.]+)\s+MiB", text)
    if m:
        kv = m.group(1)
    m = re.search(r"CPU compute buffer size =\s+([0-9.]+)\s+MiB", text)
    if m:
        comp = m.group(1)
    return kv, comp


def parse_label(name: str) -> tuple[str, str, str] | None:
    # C1_r1_c512 / C2_256_r1_c4096 / C3_r2_c4096
    m = re.match(r"^(C[0-9]+(?:_[0-9]+)?)_r(\d+)_c(\d+)$", name)
    if not m:
        return None
    return m.group(1), m.group(2), m.group(3)


def main() -> None:
    rows: list[str] = []
    dirs = sorted(p for p in LOGS.iterdir() if p.is_dir()) if LOGS.is_dir() else []
    for d in dirs:
        parsed = parse_label(d.name)
        if not parsed:
            continue
        cell, rep, n_ctx = parsed
        stdout = (d / "stdout.txt").read_text(encoding="utf-8", errors="replace") if (d / "stdout.txt").exists() else ""
        combo = (d / "combo.txt").read_text(encoding="utf-8", errors="replace") if (d / "combo.txt").exists() else stdout
        if (d / "stderr.txt").exists():
            combo = stdout + "\n" + (d / "stderr.txt").read_text(encoding="utf-8", errors="replace")
        wall = (d / "wall.txt").read_text(encoding="utf-8").strip() if (d / "wall.txt").exists() else ""
        rc = (d / "rc.txt").read_text(encoding="utf-8").strip() if (d / "rc.txt").exists() else ""
        kv, comp = kv_compute(combo)
        note = "kv_alloc" if cell == "C1" else (
            "history_reprefill" if cell.startswith("C2") else (
                "kv_reuse" if cell == "C3" else (
                    "broken_prefix" if cell == "C4" else ""
                )
            )
        )
        dones: list[dict] = []
        for line in stdout.splitlines():
            if line.startswith("BMOE_DONE "):
                try:
                    dones.append(json.loads(line.split(" ", 1)[1]))
                except Exception:
                    pass
        if not dones:
            rows.append(
                f",{cell},{rep},{n_ctx},512,cold,none,,,,,,,,,,"
                f"{wall},{rc},,,,,,{kv},{comp},NO_BMOE_DONE:{note}\n"
            )
            continue
        for djson in dones:
            did = int(djson.get("id", 1))
            phase = f"t{did}"
            n_prompt = djson.get("n_prompt", "")
            n_past = djson.get("n_past", "")
            tokens = djson.get("tokens", "")
            load_s = djson.get("load_s", "")
            prefill_s = djson.get("prefill_s", "")
            prefill_tps = djson.get("prefill_tps", "")
            tok_s = djson.get("tok_s", "")
            try:
                if did == 1:
                    ttft = float(load_s or 0) + float(prefill_s or 0)
                else:
                    ttft = float(prefill_s or 0)
                ttft_s = f"{ttft:.3f}"
            except Exception:
                ttft_s = ""
            rows.append(
                f",{cell},{rep},{n_ctx},512,cold,{phase},"
                f"{n_prompt},{n_past},{tokens},{load_s},{prefill_s},{prefill_tps},"
                f"{ttft_s},{tok_s},{wall},{rc},,,,,{kv},{comp},{note}\n"
            )
    CSV.write_text(HDR + "".join(rows), encoding="utf-8")
    print(f"wrote {CSV} ({len(rows)} rows)")


if __name__ == "__main__":
    main()
