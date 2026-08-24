#!/usr/bin/env python3
"""Parse bprime charge dumps, jsonl, INTERNAL-ERROR counts."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(r"results/htp_probe/s23_v73_olmoe_q40")
B = ROOT / "bprime"
A_ERR = ROOT / "device" / "kalsa_q48" / "a_stderr.txt"
OUT = Path(r"scratchpad/agents/q48-olmoe-q40-npu/bprime_analysis.txt")


def parse_charge(p: Path) -> dict:
    t = p.read_text(encoding="utf-8", errors="replace")

    def g(pat, cast=int):
        m = re.search(pat, t, re.M)
        return cast(m.group(1)) if m else None

    sysfs = None
    m = re.search(r"sysfs_charge_counter=(.*)", t)
    if m:
        sysfs = m.group(1).strip()
    return {
        "file": p.name,
        "sysfs": sysfs,
        "charge_counter_uAh": g(r"Charge counter:\s*(\d+)"),
        "level": g(r"^\s*level:\s*(\d+)"),
        "temperature_tenth_C": g(r"^\s*temperature:\s*(\d+)"),
        "voltage_mV": g(r"^\s*voltage:\s*(\d+)"),
        "ac": g(r"AC powered:\s*(true|false)", str),
    }


def energy(pre: dict, post: dict, tokens: int, label: str) -> dict:
    dq = pre["charge_counter_uAh"] - post["charge_counter_uAh"]
    v = 0.5 * (pre["voltage_mV"] + post["voltage_mV"]) / 1000.0
    E = (dq / 1e6) * v * 3600.0
    jpt = E / tokens if tokens else None
    dT = (post["temperature_tenth_C"] - pre["temperature_tenth_C"]) / 10.0
    rec = {
        "label": label,
        "dQ_uAh": dq,
        "Vmean": round(v, 4),
        "E_J": round(E, 2),
        "tokens": tokens,
        "J_per_token": round(jpt, 6) if jpt is not None else None,
        "dT_C": dT,
        "T_pre": pre["temperature_tenth_C"] / 10.0,
        "T_post": post["temperature_tenth_C"] / 10.0,
        "level_pre": pre["level"],
        "level_post": post["level"],
        "sysfs_pre": pre["sysfs"],
        "sysfs_post": post["sysfs"],
    }
    return rec


def jsonl_rows(p: Path) -> list[dict]:
    if not p.exists() or p.stat().st_size == 0:
        return []
    out = []
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def count_pat(p: Path, pat: str) -> int:
    if not p.exists():
        return -1
    n = 0
    rx = re.compile(pat, re.I)
    with p.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            if rx.search(line):
                n += 1
    return n


def main() -> None:
    lines: list[str] = []
    pairs = [
        ("htp_r1", 512, "HTP r1 (n_gen=1 after -n 0 abort; INCLUDES load; abort so tokens may be 0)"),
        ("htp_r2", 512, "HTP r2 n_gen=1 INCLUDES load; abort"),
        ("cpu_r1", 512, "CPU r1 n_gen=1 INCLUDES load+pp512+tg1"),
        ("cpu_r2", 512, "CPU r2 n_gen=1 INCLUDES load+pp512+tg1"),
    ]
    recs = []
    for tag, tok, note in pairs:
        pre = parse_charge(B / f"charge_{tag}_pre.txt")
        post = parse_charge(B / f"charge_{tag}_post.txt")
        rec = energy(pre, post, tok, note)
        recs.append(rec)
        lines.append(
            f"{tag}: dQ={rec['dQ_uAh']} uAh E={rec['E_J']} J  J/tok={rec['J_per_token']} "
            f"(tok={tok} load-included) V={rec['Vmean']} "
            f"T {rec['T_pre']:.1f}->{rec['T_post']:.1f} dT={rec['dT_C']:.1f} "
            f"lvl {rec['level_pre']}->{rec['level_post']} sysfs={rec['sysfs_pre']}"
        )
        rows = jsonl_rows(B / f"{tag}_stdout.jsonl")
        for r in rows:
            lines.append(
                f"  jsonl n_prompt={r.get('n_prompt')} n_gen={r.get('n_gen')} "
                f"avg_ts={r.get('avg_ts')} n_gpu_layers={r.get('n_gpu_layers')}"
            )
        if not rows:
            lines.append("  jsonl EMPTY")

    lines.append("")
    lines.append("INTERNAL-ERROR / hmx-error counts:")
    files = [
        A_ERR,
        B / "htp_r1_stderr.txt",
        B / "htp_r2_stderr.txt",
        B / "cpu_r1_stderr.txt",
        B / "cpu_r2_stderr.txt",
    ]
    pats = [
        r"INTERNAL-ERROR",
        r"INTERNAL_ERROR",
        r"hmx error",
        r"HMX error",
        r"hmx-error",
        r"dspqueue_read failed",
    ]
    for p in files:
        lines.append(f"  {p.as_posix()}:")
        for pat in pats:
            n = count_pat(p, pat)
            lines.append(f"    {pat!r}: {n}")

    text = "\n".join(lines) + "\n"
    OUT.write_text(text, encoding="utf-8")
    (ROOT / "bprime_analysis.txt").write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
