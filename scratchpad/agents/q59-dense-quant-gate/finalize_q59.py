#!/usr/bin/env python3
"""Write q59's numeric PPL gate report and refresh manifest run records."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
HERE = ROOT / "scratchpad" / "agents" / "q59-dense-quant-gate"
GGUF = HERE / "gguf"
PPL = GGUF / "ppl"
MANIFEST = HERE / "manifest.json"
REPORT = HERE / "REPORT.md"
CORPORA = ("wiki", "it", "es", "fr", "zh")
ARMS = ("control", "iq4_nl", "q4_0")


def rec(arm: str, corpus: str) -> dict | None:
    path = PPL / f"ppl-{arm}-{corpus}.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if value.get("rc") == 0 and "ppl" in value and "ppl_err" in value and "n_chunks" in value:
            return value
    except Exception:
        return None
    return None


def pct(candidate: float, control: float) -> float:
    return 100.0 * (candidate / control - 1.0)


def fmt_ppl(value: dict | None) -> str:
    return "—" if value is None else f"{value['ppl']:.4f} ± {value['ppl_err']:.4f}"


def main() -> int:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    rows: list[dict] = []
    for corpus in CORPORA:
        control = rec("control", corpus)
        iq = rec("iq4_nl", corpus)
        q4 = rec("q4_0", corpus)
        if not control or not iq:
            return 1
        iq_delta = pct(iq["ppl"], control["ppl"])
        q4_delta = pct(q4["ppl"], control["ppl"]) if q4 else None
        rows.append({"corpus": corpus, "control": control, "iq4_nl": iq, "q4_0": q4,
                     "iq_delta": iq_delta, "q4_delta": q4_delta})

    iq_pass = all(row["iq_delta"] <= 1.0 for row in rows)
    q4_available = all(row["q4_0"] is not None for row in rows)
    q4_pass = q4_available and all((row["q4_delta"] or 0.0) <= 1.0 for row in rows)
    if iq_pass:
        verdict = "IQ4_NL SHIPS"
    elif q4_pass:
        verdict = "Q4_0 SHIPS"
    else:
        verdict = "OWNER DECISION"

    by_arm = {item["arm"]: item for item in manifest["gguf"]}
    shipped = manifest["app_shipped_quality_bar"]
    lines = [
        "# q59 — Qwen3.5-4B dense quant gate",
        "",
        "## PPL and Δ% vs same-source Q4_K_M",
        "",
        "| corpus | chunks | Q4_K_M PPL ± err | IQ4_NL PPL ± err | IQ4_NL Δ% | Q4_0 PPL ± err | Q4_0 Δ% |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for row in rows:
        q4_delta = "—" if row["q4_delta"] is None else f"{row['q4_delta']:+.4f}%"
        lines.append(
            f"| {row['corpus']} | {row['control']['n_chunks']} | {fmt_ppl(row['control'])} | "
            f"{fmt_ppl(row['iq4_nl'])} | {row['iq_delta']:+.4f}% | {fmt_ppl(row['q4_0'])} | {q4_delta} |"
        )
    lines += [
        "",
        "## Sizes",
        "",
        "| arm | bytes | MiB | Δ vs same-source Q4_K_M | Δ vs shipped Q4_K_M | sha256 |",
        "|---|---:|---:|---:|---:|---|",
    ]
    control_bytes = by_arm["Q4_K_M"]["bytes"]
    for label in ("Q4_K_M", "IQ4_NL", "Q4_0"):
        item = by_arm[label]
        d_control = 100.0 * (item["bytes"] / control_bytes - 1.0)
        d_shipped = 100.0 * (item["bytes"] / shipped["bytes"] - 1.0)
        lines.append(
            f"| {label} | {item['bytes']} | {item['bytes'] / 2**20:.2f} | {d_control:+.4f}% | "
            f"{d_shipped:+.4f}% | `{item['sha256']}` |"
        )
    lines += [
        f"| shipped Q4_K_M | {shipped['bytes']} | {shipped['bytes'] / 2**20:.2f} | — | 0.0000% | `{shipped['sha256']}` |",
        "",
        "## Verdict",
        "",
        f"| IQ4_NL all-corpus gate | {'PASS' if iq_pass else 'FAIL'} |",
        f"| Q4_0 all-corpus gate | {'PASS' if q4_pass else ('FAIL' if q4_available else 'SKIPPED')} |",
        f"| Q8_0 | SKIPPED |",
        f"| decision | **{verdict}** |",
        "",
        "## Provenance",
        "",
        "| item | repo/path | revision/commit | file/bytes/sha256 |",
        "|---|---|---|---|",
        f"| app default | `{manifest['app_shipped_quality_bar']['repo']}` | `{manifest['app_shipped_quality_bar']['revision']}` | `{manifest['app_shipped_quality_bar']['file']}` / {shipped['bytes']} / `{shipped['sha256']}` |",
        f"| common source | `{manifest['source']['repo']}` | `{manifest['source']['revision']}` | BF16 safetensors |",
    ]
    for shard in manifest["source"]["shards"]:
        lines.append(f"| source shard | `{shard['file']}` | — | {shard['bytes']} / `{shard['sha256']}` |")
    lines += [
        f"| quantizer | `build-pc-quantize/bin/llama-quantize.exe` | `{manifest['builds']['quantize']}` | BF16 → Q4_K_M/IQ4_NL/Q4_0; `--allow-requantize` absent |",
        f"| PPL binary | `build-llama-pc/bin/llama-perplexity.exe` | `{manifest['builds']['ppl']}` | `-c 2048 -b 512 -ub 512 -t 8 -ngl 0` |",
        "| protocol caveat | `scratchpad/agents/q37-bprime-from-source/PREP.md` | — | requested file absent; BF16 direct path used |",
        "",
        "## Run records",
        "",
        "| arm | corpus | chunks | wall_s | command |",
        "|---|---|---:|---:|---|",
    ]
    run_records = []
    for row in rows:
        for arm_key in ("control", "iq4_nl", "q4_0"):
            item = row[arm_key]
            if item is None:
                continue
            lines.append(f"| {arm_key} | {row['corpus']} | {item['n_chunks']} | {item['wall_s']:.2f} | `{' '.join(item['cmd'])}` |")
            run_records.append(item)
    if not q4_available:
        lines.append("| q4_0 | all five corpora | — | — | SKIPPED because IQ4_NL passed |")
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    manifest["amendment1"]["status"] = "complete"
    manifest["ppl_runs"] = run_records
    manifest["verdict"] = verdict
    manifest["report_generated_utc"] = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
