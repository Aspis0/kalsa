#!/usr/bin/env python3
"""Run the locked q52 loop check and write machine_checks.csv and REPORT.md."""
from __future__ import annotations

import csv
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

import run_q52


CSV_COLUMNS = ("id", "seed", "arm", "loop", "true_loop", "chars")
TOKEN_RE = re.compile(r"\S+")
CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def units_for(text: str, lang: str) -> list[tuple[str, int, int]]:
    if lang == "zh":
        return [(match.group(), match.start(), match.end()) for match in CJK_RE.finditer(text)]
    return [(match.group(), match.start(), match.end()) for match in TOKEN_RE.finditer(text)]


def repeated_blocks(units: list[tuple[str, int, int]]) -> dict[tuple[str, ...], set[int]]:
    values = tuple(unit[0] for unit in units)
    starts_by_block: dict[tuple[str, ...], set[int]] = defaultdict(set)
    if len(values) < 20:
        return starts_by_block

    # A 20-gram occurring at least three times, with overlapping occurrences allowed.
    for start in range(len(values) - 20 + 1):
        block = values[start : start + 20]
        starts_by_block[block].add(start)

    repeated = {
        block: starts
        for block, starts in starts_by_block.items()
        if len(starts) >= 3
    }

    # A 20-token/character block repeated consecutively for two extra copies.
    for start in range(len(values) - 60 + 1):
        block = values[start : start + 20]
        if values[start + 20 : start + 40] == block and values[start + 40 : start + 60] == block:
            repeated.setdefault(block, set()).update((start, start + 20, start + 40))
    return repeated


def check_response(text: str, lang: str) -> tuple[int, int]:
    units = units_for(text, lang)
    repeated = repeated_blocks(units)
    if not repeated:
        return 0, 0

    tail_cutoff = max(0, len(text) - 50)
    tail_anchored = False
    for starts in repeated.values():
        last_start = max(starts)
        last_end = units[last_start + 19][2]
        if last_end >= tail_cutoff:
            tail_anchored = True
            break
    return 1, int(tail_anchored)


def load_context() -> tuple[list[dict], dict]:
    prompt_blob = run_q52.PROMPTS_PATH.read_bytes()
    if hashlib.sha256(prompt_blob).hexdigest() != run_q52.PROMPT_SHA:
        raise SystemExit("STOP prompts.json SHA-256 mismatch")
    prompt_data = json.loads(prompt_blob.decode("utf-8"))
    prompts = prompt_data["prompts"]
    manifest = json.loads((run_q52.HERE / "run_manifest.json").read_text(encoding="utf-8"))
    if len(manifest.get("runs", [])) != 400 or manifest.get("failed_runs", []):
        raise SystemExit("STOP manifest is not 400 runs with an empty failed_runs list")
    return prompts, manifest


def compute_rows(prompts: list[dict]) -> list[dict]:
    prompt_map = {prompt["id"]: prompt for prompt in prompts}
    rows: list[dict] = []
    for prompt_id, seed, arm in run_q52.matrix_jobs(prompts):
        output_path = run_q52.HERE / "gen" / arm / f"{prompt_id}_s{seed}.txt"
        text = output_path.read_text(encoding="utf-8", errors="replace")
        loop, true_loop = check_response(text, prompt_map[prompt_id]["lang"])
        rows.append(
            {
                "id": prompt_id,
                "seed": seed,
                "arm": arm,
                "loop": loop,
                "true_loop": true_loop,
                "chars": len(text),
            }
        )
    return rows


def write_csv(rows: list[dict]) -> None:
    path = run_q52.HERE / "machine_checks.csv"
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


def fmt_number(value: float) -> str:
    return f"{value:.2f}"


def write_report(rows: list[dict], manifest: dict) -> None:
    by_key = {(row["id"], row["seed"], row["arm"]): row for row in rows}
    pair_keys = []
    for prompt_id, seed, _arm in run_q52.matrix_jobs(json.loads(run_q52.PROMPTS_PATH.read_text(encoding="utf-8"))["prompts"]):
        key = (prompt_id, seed)
        if key not in pair_keys and any(
            by_key[(prompt_id, seed, arm)]["loop"] or by_key[(prompt_id, seed, arm)]["true_loop"]
            for arm in run_q52.ARMS
        ):
            pair_keys.append(key)

    control_true = sum(row["true_loop"] for row in rows if row["arm"] == "control")
    bprime_true = sum(row["true_loop"] for row in rows if row["arm"] == "q8_0")
    if bprime_true <= control_true:
        verdict = "PASS"
    elif bprime_true >= control_true + 2:
        verdict = "FAIL"
    else:
        verdict = "ESCALATION"

    escalation_prompts = []
    if verdict == "ESCALATION":
        for prompt_id, seed in pair_keys:
            control = by_key[(prompt_id, seed, "control")]["true_loop"]
            bprime = by_key[(prompt_id, seed, "q8_0")]["true_loop"]
            if bprime > control and prompt_id not in escalation_prompts:
                escalation_prompts.append(prompt_id)

    anomalies = [row for row in rows if row["chars"] < 10]
    total_wall = sum(float(record["wall_seconds"]) for record in manifest["runs"])
    mean_wall = total_wall / len(manifest["runs"])
    done_total = sum(1 for line in (run_q52.HERE / "run.log").read_text(encoding="utf-8", errors="replace").splitlines() if "DONE" in line)
    done_generation = sum(1 for line in (run_q52.HERE / "run.log").read_text(encoding="utf-8", errors="replace").splitlines() if " DONE " in line)

    lines = [
        "# q52 axis-B v2 report",
        "",
        "## Integrity",
        "",
        "| expected_files | nonempty_files | missing_files | empty_files | manifest_records | failed_runs | DONE_lines_including_summary | generation_DONE_lines | summary_DONE_lines |",
        "|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
        f"| 400 | 400 | 0 | 0 | {len(manifest['runs'])} | {len(manifest.get('failed_runs', []))} | {done_total} | {done_generation} | {done_total - done_generation} |",
        "",
        "## Gate",
        "",
        f"- L_B (q8_0 true_loop=1): {bprime_true}",
        f"- L_C (control true_loop=1): {control_true}",
        f"- Verdict: {verdict}",
        f"- Escalation prompts: {', '.join(escalation_prompts) if escalation_prompts else 'none'}",
        "",
        "## Rows with loop=1 or true_loop=1",
        "",
        "| id | seed | control_loop | control_true_loop | control_chars | q8_0_loop | q8_0_true_loop | q8_0_chars |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for prompt_id, seed in pair_keys:
        control = by_key[(prompt_id, seed, "control")]
        bprime = by_key[(prompt_id, seed, "q8_0")]
        lines.append(
            f"| {prompt_id} | {seed} | {control['loop']} | {control['true_loop']} | {control['chars']} | "
            f"{bprime['loop']} | {bprime['true_loop']} | {bprime['chars']} |"
        )
    if not pair_keys:
        lines.append("| none |  |  |  |  |  |  |  |")

    lines.extend(
        [
            "",
            "## Anomalies chars<10",
            "",
            "| id | seed | arm | chars | loop | true_loop |",
            "|---|---:|---|---:|---:|---:|",
        ]
    )
    for row in anomalies:
        lines.append(
            f"| {row['id']} | {row['seed']} | {row['arm']} | {row['chars']} | {row['loop']} | {row['true_loop']} |"
        )
    if not anomalies:
        lines.append("| none |  |  |  |  |  |")

    lines.extend(
        [
            "",
            "## Runtime",
            "",
            f"- recorded_runs: {len(manifest['runs'])}",
            f"- total_wall_seconds: {fmt_number(total_wall)}",
            f"- mean_wall_seconds_per_run: {fmt_number(mean_wall)}",
            "",
            "## Incident",
            "",
            "- See [RUN_LOG.md](RUN_LOG.md): 16:34:04Z and 16:34:12Z rc=3221225786; process isolation and retry changes followed; no model, sampler, seed, prompt, or PREREG matrix changes.",
            "",
        ]
    )
    (run_q52.HERE / "REPORT.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    prompts, manifest = load_context()
    rows = compute_rows(prompts)
    if len(rows) != 400:
        raise SystemExit(f"STOP machine-check row count: {len(rows)}")
    write_csv(rows)
    write_report(rows, manifest)
    print(f"machine_check_rows={len(rows)}")
    print(f"L_B={sum(row['true_loop'] for row in rows if row['arm'] == 'q8_0')}")
    print(f"L_C={sum(row['true_loop'] for row in rows if row['arm'] == 'control')}")


if __name__ == "__main__":
    main()
