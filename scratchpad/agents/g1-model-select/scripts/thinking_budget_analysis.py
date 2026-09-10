#!/usr/bin/env python3
"""Analyze effective v2 rows and later MiniCPM5 budget cells."""

import json
import statistics
from collections import defaultdict
from pathlib import Path

from model_tokenizer import count_tokens
from v2_analysis_data import direct_judges, effective_v2_judges, load_effective_v2, load_later


ROOT = Path(__file__).resolve().parents[1]
MODELS = ("LFM", "MiniCPM5")
RUNS = ("v2@256", "v2@512", "v2-wild", "v2c-1024", "v2c-nobudget", "v2d")


def percentile(values, fraction):
    position = (len(values) - 1) * fraction
    low = int(position)
    high = min(low + 1, len(values) - 1)
    return values[low] + (values[high] - values[low]) * (position - low)


def fmt(value):
    if value is None:
        return "—"
    return str(int(value)) if float(value).is_integer() else f"{value:.1f}"


def enrich(rows):
    for row in rows:
        text = row.get("reasoning_content")
        if text is None:
            text = row.get("reasoning_text", "")
        row["_reasoning_tokens"] = count_tokens(row["_model"], text if isinstance(text, str) else "")
        row["_field_tokens"] = row.get("reasoning_tokens")
        row["_category"] = row.get("_category") or "unknown"
    return rows


def category_names():
    path = Path("/Users/marco/Projects/kalsa/scripts/quality/questions.json")
    return {row["id"]: row["kind"] for row in json.loads(path.read_text())["questions"]}


def load_rows():
    rows = load_effective_v2(ROOT) + load_later(ROOT)
    kinds = category_names()
    for row in rows:
        row["_category"] = row.get("category") or kinds.get(row.get("qid"), "unknown")
    return enrich(rows)


def distribution(rows):
    groups = defaultdict(list)
    for row in rows:
        groups[(row["_model"], row["_run"], row["_category"], row.get("lang", "?"))].append(row)
    print("## Budget mechanism")
    print("- The v2 clients send `thinking_budget_tokens` per completion: `run_bakeoff_v2.py:37`; wild uses the sampler unchanged in `run_corpus_v2.py:27-31`. There is no client-side truncation.")
    print("- The tool loop may issue three completions (`v2_tools.py:191-216`) and concatenates their reasoning, so a row total can exceed the request budget.")
    print("- The fork reads the field at `tools/server/server-common.cpp:1119`, but installs the sampler only when `thinking_end_tag` is non-empty (`:1124-1129`); `common/sampling.cpp:298-305` makes that budget the maximum reasoning-block count and forces the end tag when exhausted.")
    print("- Both models returned `reasoning_content`/`reasoning_text` in every effective v2 row; the server logs contain timings and slot releases but no request-body or budget-state trace. Per-round outputs therefore show the channel was parsed; the stored row totals are not hard caps.")
    print("- Tokenizing each raw v2 round showed per-request maxima of 257/513 for LFM @256/@512 and 255/511 for MiniCPM5 @256/@512: the sampler is active per request. Row totals exceed those values only because tool rounds are summed; v2@512 has no direct judge rows (the v2 pack judged @256 plus wild).")
    print("- `results/run-v2-lfm.log:4-5` and `results/run-v2-minicpm.log:4-5` show both 44-row cells completed with zero errors; `results/server-lfm.log` has no budget-state/request-body trace.")
    print("- For the later Mini cell, raw-round maxima were 1023/request and 3745/row at v2c @1024, versus stored-row max 3748: that apparent cap is a three-round total, not a 1024-token row cap.")
    print("\n## Per-model/cell distributions (model-tokenized reasoning)")
    print("| model | cell | n | median | p75 | p90 | p95 | max | >=256 | >=512 | >=1024 |")
    print("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for model in MODELS:
        for run in RUNS:
            values = sorted(row["_reasoning_tokens"] for row in rows if row["_model"] == model and row["_run"] == run)
            if not values:
                continue
            stats = [statistics.median(values), percentile(values, .75), percentile(values, .90), percentile(values, .95), max(values)]
            cuts = [f"{sum(value >= limit for value in values) / len(values):.0%}" for limit in (256, 512, 1024)]
            print(f"| {model} | {run} | {len(values)} | " + " | ".join(fmt(x) for x in stats) + " | " + " | ".join(cuts) + " |")
    print("\nCut shares use total stored reasoning tokens; `>=` is the threshold.")
    print("\n## Category/language distributions")
    print("| model | cell | category | lang | n | median | p75 | p90 | p95 | max | >=256 | >=512 | >=1024 |")
    print("|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for key in sorted(groups):
        model, run, category, lang = key
        values = sorted(row["_reasoning_tokens"] for row in groups[key])
        stats = [statistics.median(values), percentile(values, .75), percentile(values, .90), percentile(values, .95), max(values)]
        cuts = [f"{sum(value >= limit for value in values) / len(values):.0%}" for limit in (256, 512, 1024)]
        print(f"| {model} | {run} | {category} | {lang} | {len(values)} | " + " | ".join(fmt(x) for x in stats) + " | " + " | ".join(cuts) + " |")


def crosscheck(rows):
    print("\n## Tokenizer versus reasoning_tokens field")
    print("| model | cell | rows | field_n | exact | median delta | max abs delta |")
    print("|---|---|---:|---:|---:|---:|---:|")
    for model in MODELS:
        for run in RUNS:
            selected = [r for r in rows if r["_model"] == model and r["_run"] == run]
            values = [r for r in selected if isinstance(r.get("_field_tokens"), (int, float))]
            deltas = [r["_reasoning_tokens"] - r["_field_tokens"] for r in values]
            print(f"| {model} | {run} | {len(selected)} | {len(values)} | {sum(x == 0 for x in deltas)} | {fmt(statistics.median(deltas) if deltas else None)} | {fmt(max((abs(x) for x in deltas), default=None))} |")


def model_for(value):
    return "LFM" if str(value).lower().startswith("lfm") else "MiniCPM5"


def judge_rows(root):
    rows = []
    for case_id, verdict, mapping in effective_v2_judges(root):
        rows.append(("v2-wild" if case_id.startswith("W") else "v2@256", case_id, verdict, mapping))
    for spec, run in (("v2c-1024", "v2c-1024"), ("v2c-nobudget", "v2c-nobudget"), ("v2d-q8", "v2d")):
        rows.extend((run, case_id, verdict, mapping) for case_id, verdict, mapping in direct_judges(root, spec))
    return rows


def print_judges(rows):
    lookup = {(row["_model"], row["_run"], row["_id"]): row for row in rows}
    counts = defaultdict(lambda: [0, 0, 0])
    for run, case_id, verdict, mapping in judge_rows(ROOT):
        for model in MODELS:
            row = lookup.get((model, run, case_id))
            if not row:
                continue
            winner = verdict.get("winner", "tie")
            outcome = 2 if winner == "tie" else (0 if model_for(mapping[winner]) == model else 1)
            for limit in (256, 512, 1024):
                bucket = "above" if row["_reasoning_tokens"] >= limit else "below"
                counts[(model, run, limit, bucket)][outcome] += 1
    print("\n## Judged loss rate by threshold bucket (n is judge verdicts)")
    print("| model | cell | threshold | above n/loss | below n/loss |")
    print("|---|---|---:|---:|---:|")
    for model in MODELS:
        for run in RUNS:
            for limit in (256, 512, 1024):
                cells = []
                for bucket in ("above", "below"):
                    hit = counts[(model, run, limit, bucket)]
                    decisive = hit[0] + hit[1]
                    cells.append(f"{sum(hit)}/" + (f"{hit[1] / decisive:.0%}" if decisive else "—"))
                if any(cell.split("/")[0] != "0" for cell in cells):
                    print(f"| {model} | {run} | {limit} | {cells[0]} | {cells[1]} |")


def main():
    rows = load_rows()
    distribution(rows)
    crosscheck(rows)
    print_judges(rows)


if __name__ == "__main__":
    main()
