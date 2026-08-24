#!/usr/bin/env python3
"""Run the locked machine check on the 20-run q52 escalation set."""
from __future__ import annotations

import csv
import json
from pathlib import Path

import machine_check_q52 as base_check
import run_q52


def row_with_detail(prompt: dict, seed: int, arm: str) -> tuple[dict, dict | None]:
    path = run_q52.HERE / "gen" / arm / f"{prompt['id']}_s{seed}.txt"
    text = path.read_text(encoding="utf-8", errors="replace")
    units = base_check.units_for(text, prompt["lang"])
    repeated = base_check.repeated_blocks(units)
    loop, true_loop = base_check.check_response(text, prompt["lang"])
    row = {
        "id": prompt["id"],
        "seed": seed,
        "arm": arm,
        "loop": loop,
        "true_loop": true_loop,
        "chars": len(text),
    }
    if not true_loop:
        return row, None
    block, starts = min(repeated.items(), key=lambda item: min(item[1]))
    last_start = max(starts)
    last_end = units[last_start + 19][2]
    first_start = min(starts)
    first_end = units[first_start + 19][2]
    excerpt_start = max(0, last_end - 80)
    excerpt_end = min(len(text), last_end + 40)
    excerpt = text[excerpt_start:excerpt_end].replace("\r", " ").replace("\n", " ")
    block_text = "".join(block) if prompt["lang"] == "zh" else " ".join(block)
    detail = {
        "id": prompt["id"],
        "seed": seed,
        "arm": arm,
        "first_repeated_block": block_text,
        "first_block_start_char": first_start,
        "first_block_end_char": first_end,
        "last_block_end_char": last_end,
        "excerpt": excerpt,
    }
    return row, detail


def update_report(rows: list[dict], details: list[dict], manifest: dict) -> str:
    control_true = sum(row["true_loop"] for row in rows if row["arm"] == "control")
    bprime_true = sum(row["true_loop"] for row in rows if row["arm"] == "q8_0")
    verdict = "PASS" if bprime_true <= control_true else "FAIL"
    total_wall = sum(float(record["wall_seconds"]) for record in manifest["runs"])
    mean_wall = total_wall / len(manifest["runs"])

    report_path = run_q52.HERE / "REPORT.md"
    report = report_path.read_text(encoding="utf-8")
    marker = "\n## Escalation results\n"
    report = report.split(marker, 1)[0].rstrip() + "\n"
    report = report.replace("- Final verdict: pending.", f"- Final verdict: {verdict}.")
    lines = [
        "",
        "## Escalation results",
        "",
        "- Set: `long_it_04` only × seeds `301..310` × both arms = `20` generations.",
        "- `code_en_05` escalation generations: `0`.",
        "- Machine-check file: `machine_checks_esc.csv` (20 rows; same columns as `machine_checks.csv`).",
        f"- Escalation L_B (q8_0 true_loop=1): {bprime_true}",
        f"- Escalation L_C (control true_loop=1): {control_true}",
        f"- Escalation verdict: {verdict}",
        f"- Final cell verdict: {verdict}",
        "",
        "| id | seed | arm | loop | true_loop | chars |",
        "|---|---:|---|---:|---:|---:|",
    ]
    for row in rows:
        lines.append(
            f"| {row['id']} | {row['seed']} | {row['arm']} | {row['loop']} | {row['true_loop']} | {row['chars']} |"
        )
    lines.extend(
        [
            "",
            "### Escalation true_loop details",
            "",
            "| id | seed | arm | first repeated block | excerpt |",
            "|---|---:|---|---|---|",
        ]
    )
    for detail in details:
        lines.append(
            f"| {detail['id']} | {detail['seed']} | {detail['arm']} | "
            f"`{detail['first_repeated_block']}` | {detail['excerpt']} |"
        )
    if not details:
        lines.append("| none |  |  |  |  |")
    lines.extend(
        [
            "",
            f"- Escalation total_wall_seconds: {total_wall:.2f}",
            f"- Escalation mean_wall_seconds_per_run: {mean_wall:.2f}",
            "- Arbitration: code_en_05 B′=1/control=1 tied and excluded; long_it_04 B′=1/control=0 supplied the excess and was the only escalation prompt.",
            "- Escalation seeds `301..310` were run only for long_it_04; no code_en_05 escalation data were generated.",
            "",
        ]
    )
    report_path.write_text(report + "\n".join(lines), encoding="utf-8")
    return verdict


def main() -> None:
    manifest = json.loads((run_q52.HERE / "escalation_manifest.json").read_text(encoding="utf-8"))
    if len(manifest.get("runs", [])) != 20 or manifest.get("failed_runs"):
        raise SystemExit("STOP escalation manifest is incomplete")
    prompt_data = json.loads(run_q52.PROMPTS_PATH.read_text(encoding="utf-8"))
    prompt = next(item for item in prompt_data["prompts"] if item["id"] == run_q52.ESCALATION_ID)
    rows: list[dict] = []
    details: list[dict] = []
    for seed in run_q52.ESCALATION_SEEDS:
        for arm in run_q52.ARMS:
            row, detail = row_with_detail(prompt, seed, arm)
            rows.append(row)
            if detail is not None:
                details.append(detail)

    path = run_q52.HERE / "machine_checks_esc.csv"
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=base_check.CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    verdict = update_report(rows, details, manifest)
    print(f"escalation_rows={len(rows)}")
    print(f"escalation_L_B={sum(row['true_loop'] for row in rows if row['arm'] == 'q8_0')}")
    print(f"escalation_L_C={sum(row['true_loop'] for row in rows if row['arm'] == 'control')}")
    print(f"final_verdict={verdict}")
    for detail in details:
        print(json.dumps(detail, ensure_ascii=False))


if __name__ == "__main__":
    main()
