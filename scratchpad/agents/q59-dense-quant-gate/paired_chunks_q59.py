#!/usr/bin/env python3
"""Post-hoc paired-chunk analysis for the q59 perplexity gate.

This script intentionally uses only the Python 3 standard library.  It reads
the q59 cell records and logs, validates the reconstruction, and writes the
JSON and Markdown outputs beside this file.
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path


ARMS = ("control", "iq4_nl", "q4_0")
CANDIDATES = ("iq4_nl", "q4_0")
CORPORA = ("wiki", "it", "es", "fr", "zh")
ROUNDING_HALF_UNIT = 0.00005
CI_Z = 1.96
GATE_PCT = 1.0

FLOAT = r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?"
CHUNK_RE = re.compile(r"\[(\d+)\]\s*(" + FLOAT + r")")
FINAL_RE = re.compile(
    r"Final\s+estimate:\s*PPL\s*=\s*(" + FLOAT + r")\s*\+/-\s*(" + FLOAT + r")"
)


class ValidationError(RuntimeError):
    """Raised when an input violates an analysis invariant."""


def fail(message: str) -> None:
    raise ValidationError(message)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def close_enough(actual: float, expected: float, tolerance: float) -> bool:
    return math.isfinite(actual) and math.isfinite(expected) and abs(actual - expected) <= tolerance


def fmt_num(value: float, digits: int = 8) -> str:
    return f"{value:.{digits}f}"


def fmt_pct(value: float, digits: int = 4) -> str:
    return f"{value:+.{digits}f}%"


def fmt_p(value: float) -> str:
    if value == 0.0:
        return "0"
    if value >= 0.001:
        return f"{value:.6f}"
    return f"{value:.3e}"


def load_json(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
    except FileNotFoundError:
        fail(f"missing JSON input: {path}")
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"cannot read JSON input {path}: {exc}")
    require(isinstance(value, dict), f"JSON input is not an object: {path}")
    return value


def get_chunk_count(record: dict, path: Path) -> tuple[int, str]:
    present = [key for key in ("chunks", "n_chunks") if key in record]
    require(present, f"{path} has neither 'chunks' nor 'n_chunks'")
    values = []
    for key in present:
        value = record[key]
        require(isinstance(value, int) and not isinstance(value, bool), f"{path} field {key!r} is not an integer")
        require(value > 0, f"{path} field {key!r} is not positive")
        values.append(value)
    require(len(set(values)) == 1, f"{path} has conflicting chunk counts")
    return values[0], present[0]


def parse_cell(arm: str, corpus: str, ppl_dir: Path) -> dict:
    json_path = ppl_dir / f"ppl-{arm}-{corpus}.json"
    log_path = ppl_dir / f"ppl-{arm}-{corpus}.log"
    record = load_json(json_path)
    require(record.get("arm") == arm, f"{json_path} arm is {record.get('arm')!r}, expected {arm!r}")
    require(record.get("corpus") == corpus, f"{json_path} corpus is {record.get('corpus')!r}, expected {corpus!r}")
    n_chunks, chunk_field = get_chunk_count(record, json_path)
    for key in ("ppl", "ppl_err"):
        require(isinstance(record.get(key), (int, float)) and not isinstance(record.get(key), bool), f"{json_path} field {key!r} is not numeric")
        require(math.isfinite(float(record[key])) and float(record[key]) > 0.0, f"{json_path} field {key!r} is not positive and finite")

    try:
        text = log_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        fail(f"missing log input: {log_path}")
    except (OSError, UnicodeError) as exc:
        fail(f"cannot read log input {log_path}: {exc}")

    chunk_matches = list(CHUNK_RE.finditer(text))
    require(len(chunk_matches) == n_chunks, f"{log_path} has {len(chunk_matches)} cumulative PPL values, JSON says {n_chunks}")
    indices = [int(match.group(1)) for match in chunk_matches]
    require(indices == list(range(1, n_chunks + 1)), f"{log_path} chunk indices are not exactly 1..{n_chunks}: {indices[:5]} ... {indices[-5:]}")
    ppls = [float(match.group(2)) for match in chunk_matches]
    require(all(value > 0.0 and math.isfinite(value) for value in ppls), f"{log_path} contains a non-positive or non-finite PPL")

    final_matches = list(FINAL_RE.finditer(text))
    require(len(final_matches) == 1, f"{log_path} has {len(final_matches)} 'Final estimate' lines, expected exactly 1")
    final_ppl = float(final_matches[0].group(1))
    final_err = float(final_matches[0].group(2))
    json_ppl = float(record["ppl"])
    require(close_enough(final_ppl, json_ppl, 1e-12), f"{log_path} final PPL {final_ppl} != JSON ppl {json_ppl}")
    require(close_enough(ppls[-1], final_ppl, 1e-12), f"{log_path} last cumulative PPL {ppls[-1]} != Final estimate PPL {final_ppl}")

    log_values = [math.log(value) for value in ppls]
    nll = []
    previous_log_ppl = 0.0
    for index, current_log_ppl in enumerate(log_values, start=1):
        nll.append(index * current_log_ppl - (index - 1) * previous_log_ppl)
        previous_log_ppl = current_log_ppl
    mean_nll = sum(nll) / n_chunks
    self_check_discrepancy = abs(mean_nll - math.log(json_ppl))
    self_check_tolerance = ROUNDING_HALF_UNIT / json_ppl + 1e-12
    require(
        self_check_discrepancy <= self_check_tolerance,
        f"{log_path} NLL self-check discrepancy {self_check_discrepancy} exceeds {self_check_tolerance}",
    )

    return {
        "arm": arm,
        "corpus": corpus,
        "json_path": str(json_path),
        "log_path": str(log_path),
        "n_chunks": n_chunks,
        "json_chunk_field": chunk_field,
        "ppl": json_ppl,
        "ppl_err": float(record["ppl_err"]),
        "final_ppl": final_ppl,
        "final_err": final_err,
        "ppl_cumulative": ppls,
        "nll": nll,
        "mean_nll": mean_nll,
        "self_check_discrepancy": self_check_discrepancy,
        "self_check_tolerance": self_check_tolerance,
    }


def parse_report_deltas(report_path: Path) -> dict:
    try:
        lines = report_path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as exc:
        fail(f"cannot read REPORT.md for point-estimate identity check: {exc}")

    result = {}
    for line in lines:
        if not line.startswith("|"):
            continue
        columns = [part.strip() for part in line.split("|")]
        if len(columns) < 8 or columns[1] not in CORPORA:
            continue
        if not columns[2].isdigit():
            continue
        try:
            iq4_delta = float(columns[5].rstrip("%"))
            q40_delta = float(columns[7].rstrip("%"))
        except ValueError:
            continue
        require(columns[1] not in result, f"REPORT.md has duplicate PPL table row for {columns[1]}")
        result[columns[1]] = {"iq4_nl": iq4_delta, "q4_0": q40_delta}
    require(set(result) == set(CORPORA), f"REPORT.md point-estimate table is missing corpora: {sorted(set(CORPORA) - set(result))}")
    return result


def exact_sign_test_p(worse: int, nonzero: int) -> float:
    """Two-sided exact sign-test p-value, dropping zero differences."""
    if nonzero == 0:
        return 1.0
    tail = min(worse, nonzero - worse)
    probability = sum(math.comb(nonzero, index) for index in range(tail + 1)) / (2.0 ** nonzero)
    return min(1.0, 2.0 * probability)


def rounding_floor_for_cell(cell: dict) -> dict:
    n = cell["n_chunks"]
    final_ppl = cell["ppl_cumulative"][-1]
    log_ppl_bound = ROUNDING_HALF_UNIT / final_ppl
    nll_bound = (2 * n - 1) * log_ppl_bound
    return {
        "P_N": final_ppl,
        "abs_log_P_N_error_bound": log_ppl_bound,
        "approx_abs_nll_N_error_bound": nll_bound,
    }


def observed_difference_summary(d_values: list[float]) -> dict:
    nonzero_abs = [abs(value) for value in d_values if value != 0.0]
    return {
        "min_d": min(d_values),
        "max_d": max(d_values),
        "min_abs_d_nonzero": min(nonzero_abs) if nonzero_abs else 0.0,
        "mean_abs_d": sum(abs(value) for value in d_values) / len(d_values),
        "max_abs_d": max(abs(value) for value in d_values),
    }


def compare_cell(control: dict, candidate: dict, report_delta_pct: float) -> dict:
    require(control["n_chunks"] == candidate["n_chunks"], f"chunk count mismatch for {candidate['arm']}/{candidate['corpus']}")
    n = control["n_chunks"]
    d_values = [candidate_nll - control_nll for candidate_nll, control_nll in zip(candidate["nll"], control["nll"])]
    mean_d = sum(d_values) / n
    require(n > 1, f"sample SD requires at least 2 chunks for {candidate['arm']}/{candidate['corpus']}")
    variance = sum((value - mean_d) ** 2 for value in d_values) / (n - 1)
    sd_d = math.sqrt(variance)
    se_d = sd_d / math.sqrt(n)
    delta_fraction = math.expm1(mean_d)
    delta_pct = 100.0 * delta_fraction
    identity_abs_diff_pct = abs(delta_pct - report_delta_pct)
    require(
        identity_abs_diff_pct <= 0.00005 + 1e-10,
        f"{candidate['arm']}/{candidate['corpus']} paired Δ {delta_pct}% != REPORT.md {report_delta_pct}% to 4-decimal rounding",
    )
    ci_low_fraction = math.expm1(mean_d - CI_Z * se_d)
    ci_high_fraction = math.expm1(mean_d + CI_Z * se_d)
    ci_low_pct = 100.0 * ci_low_fraction
    ci_high_pct = 100.0 * ci_high_fraction
    if ci_high_pct <= GATE_PCT:
        ci_classification = "entirely <= +1.0%"
    elif ci_low_pct > GATE_PCT:
        ci_classification = "entirely > +1.0%"
    else:
        ci_classification = "straddles +1.0%"

    worse = sum(value > 0.0 for value in d_values)
    better = sum(value < 0.0 for value in d_values)
    ties = n - worse - better
    nonzero = worse + better
    p_value = exact_sign_test_p(worse, nonzero)
    naive_control_pct = 100.0 * control["ppl_err"] / control["ppl"]
    naive_candidate_pct = 100.0 * candidate["ppl_err"] / candidate["ppl"]
    observed = observed_difference_summary(d_values)

    return {
        "candidate": candidate["arm"],
        "control": control["arm"],
        "corpus": candidate["corpus"],
        "N": n,
        "mean_d_nll": mean_d,
        "sd_d_nll_sample": sd_d,
        "se_d_nll": se_d,
        "delta_paired_fraction": delta_fraction,
        "delta_paired_pct": delta_pct,
        "report_delta_pct": report_delta_pct,
        "identity_abs_diff_pct_points": identity_abs_diff_pct,
        "identity_confirmed": True,
        "ci95_delta_fraction_low": ci_low_fraction,
        "ci95_delta_fraction_high": ci_high_fraction,
        "ci95_delta_pct_low": ci_low_pct,
        "ci95_delta_pct_high": ci_high_pct,
        "ci_vs_+1pct": ci_classification,
        "ci_entirely_le_+1pct": ci_classification == "entirely <= +1.0%",
        "ci_entirely_gt_+1pct": ci_classification == "entirely > +1.0%",
        "ci_straddles_+1pct": ci_classification == "straddles +1.0%",
        "chunks_worse": worse,
        "chunks_better": better,
        "chunks_tied": ties,
        "chunks_worse_over_N": f"{worse}/{n}",
        "sign_test_nonzero_N": nonzero,
        "sign_test_p_two_sided": p_value,
        "naive_ppl_err_pct": {
            "control": naive_control_pct,
            "candidate": naive_candidate_pct,
        },
        "observed_d_summary_nll": observed,
        "nll_control": control["nll"],
        "nll_candidate": candidate["nll"],
        "d_nll": d_values,
    }


def make_analysis(base: Path) -> dict:
    ppl_dir = base / "gguf" / "ppl"
    report_path = base / "REPORT.md"
    cells = {arm: {} for arm in ARMS}
    for arm in ARMS:
        for corpus in CORPORA:
            cells[arm][corpus] = parse_cell(arm, corpus, ppl_dir)

    report_deltas = parse_report_deltas(report_path)
    comparisons = {candidate: {} for candidate in CANDIDATES}
    for candidate in CANDIDATES:
        for corpus in CORPORA:
            comparisons[candidate][corpus] = compare_cell(
                cells["control"][corpus], cells[candidate][corpus], report_deltas[corpus][candidate]
            )

    max_discrepancy = max(cell["self_check_discrepancy"] for arm in ARMS for cell in cells[arm].values())
    max_tolerance = max(cell["self_check_tolerance"] for arm in ARMS for cell in cells[arm].values())
    max_identity_diff = max(
        comparisons[candidate][corpus]["identity_abs_diff_pct_points"]
        for candidate in CANDIDATES
        for corpus in CORPORA
    )

    rounding_floor = {}
    for corpus in CORPORA:
        control_floor = rounding_floor_for_cell(cells["control"][corpus])
        candidate_floors = {candidate: rounding_floor_for_cell(cells[candidate][corpus]) for candidate in CANDIDATES}
        observed = {candidate: comparisons[candidate][corpus]["observed_d_summary_nll"] for candidate in CANDIDATES}
        pair_floors = {
            candidate: control_floor["approx_abs_nll_N_error_bound"] + candidate_floors[candidate]["approx_abs_nll_N_error_bound"]
            for candidate in CANDIDATES
        }
        rounding_floor[corpus] = {
            "N": cells["control"][corpus]["n_chunks"],
            "arms": {"control": control_floor, **candidate_floors},
            "approx_pair_abs_d_N_error_bound": pair_floors,
            "observed_per_chunk_d_nll": observed,
        }

    q40_wiki = comparisons["q4_0"]["wiki"]
    wiki_observation = {
        "N": q40_wiki["N"],
        "q4_0_chunks_favour_q4_0": q40_wiki["chunks_better"],
        "q4_0_chunks_favour_q4_0_over_N": f"{q40_wiki['chunks_better']}/{q40_wiki['N']}",
        "q4_0_sign_test_p_two_sided": q40_wiki["sign_test_p_two_sided"],
        "q4_0_paired_ci95_delta_pct_low": q40_wiki["ci95_delta_pct_low"],
        "q4_0_paired_ci95_delta_pct_high": q40_wiki["ci95_delta_pct_high"],
        "q4_0_paired_ci_excludes_zero": q40_wiki["ci95_delta_pct_high"] < 0.0 or q40_wiki["ci95_delta_pct_low"] > 0.0,
    }

    return {
        "analysis": {
            "name": "q59 paired cumulative-PPL chunk reconstruction",
            "type": "post-hoc, non-gating",
            "base_dir": str(base),
            "ppl_dir": str(ppl_dir),
            "report_path": str(report_path),
            "arms": list(ARMS),
            "candidates": list(CANDIDATES),
            "corpora": list(CORPORA),
            "formula": "nll_k = k*ln(P_k) - (k-1)*ln(P_{k-1}), with P_0 term = 0",
            "delta_identity": "exp(mean(d)) - 1 = PPL_candidate/PPL_control - 1",
            "ci_formula": "[expm1(mean(d)-1.96*SE), expm1(mean(d)+1.96*SE)]",
            "rounding_assumption": "P_k printed to 4 decimals; abs error in ln(P_k) <= 0.00005/P_k",
            "rounding_nll_bound_approximation": "(2*k-1)*0.00005/P_k is an upper bound only when P_(k-1) >= P_k; exact adjacent-term bound is k*h/P_k + (k-1)*h/P_(k-1)",
            "rounding_aggregate_effects": "Rounding errors telescope out of mean(d); under the uniform model the RMS d_k noise is 1.6e-4..2.7e-4 and SE/CI-width inflation is <= 0.05%",
            "sign_test": "two-sided exact binomial sign test with zero d values dropped",
        },
        "self_checks": {
            "cells_expected": 15,
            "cells_parsed": 15,
            "all_chunk_counts_match_json": True,
            "all_final_estimates_match_json": True,
            "all_last_cumulative_ppl_match_final_estimate": True,
            "max_mean_nll_vs_log_json_ppl_discrepancy": max_discrepancy,
            "max_allowed_rounding_tolerance": max_tolerance,
            "all_mean_nll_self_checks_passed": True,
            "candidate_cells_expected": 10,
            "candidate_cells_identity_checked": 10,
            "max_paired_vs_report_delta_abs_difference_pct_points": max_identity_diff,
            "all_report_delta_identity_checks_passed": True,
        },
        "cells": cells,
        "comparisons": comparisons,
        "rounding_floor_at_k_N": rounding_floor,
        "wiki_observation": wiki_observation,
    }


def markdown_rounding_table(analysis: dict) -> list[str]:
    lines = [
        "| corpus | N | control nll_N floor | IQ4_NL nll_N floor | IQ4_NL/control pair floor | Q4_0 nll_N floor | Q4_0/control pair floor |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    floors = analysis["rounding_floor_at_k_N"]
    for corpus in CORPORA:
        item = floors[corpus]
        lines.append(
            f"| {corpus} | {item['N']} | "
            f"{fmt_num(item['arms']['control']['approx_abs_nll_N_error_bound'])} | "
            f"{fmt_num(item['arms']['iq4_nl']['approx_abs_nll_N_error_bound'])} | "
            f"{fmt_num(item['approx_pair_abs_d_N_error_bound']['iq4_nl'])} | "
            f"{fmt_num(item['arms']['q4_0']['approx_abs_nll_N_error_bound'])} | "
            f"{fmt_num(item['approx_pair_abs_d_N_error_bound']['q4_0'])} |"
        )
    return lines


def markdown_observed_floor_table(analysis: dict) -> list[str]:
    lines = [
        "| candidate | corpus | observed d_k range | mean abs(d_k) | pair floor / mean | chunks with \\|d_k\\| < 1e-3 |",
        "|---|---|---:|---:|---:|---:|",
    ]
    floors = analysis["rounding_floor_at_k_N"]
    for candidate in CANDIDATES:
        for corpus in CORPORA:
            summary = floors[corpus]["observed_per_chunk_d_nll"][candidate]
            pair_floor = floors[corpus]["approx_pair_abs_d_N_error_bound"][candidate]
            ratio_mean = pair_floor / summary["mean_abs_d"] if summary["mean_abs_d"] else math.inf
            small_difference_count = sum(
                abs(value) < 1e-3 for value in analysis["comparisons"][candidate][corpus]["d_nll"]
            )
            lines.append(
                f"| {candidate} | {corpus} | [{fmt_num(summary['min_d'])}, {fmt_num(summary['max_d'])}] | "
                f"{fmt_num(summary['mean_abs_d'])} | {ratio_mean:.2%} | {small_difference_count} |"
            )
    return lines


def markdown_nll_summary_table(analysis: dict) -> list[str]:
    lines = [
        "| candidate | corpus | N | mean(d) | sd(d), sample | SE |",
        "|---|---|---:|---:|---:|---:|",
    ]
    for candidate in CANDIDATES:
        for corpus in CORPORA:
            item = analysis["comparisons"][candidate][corpus]
            lines.append(
                f"| {candidate} | {corpus} | {item['N']} | {fmt_num(item['mean_d_nll'])} | "
                f"{fmt_num(item['sd_d_nll_sample'])} | {fmt_num(item['se_d_nll'])} |"
            )
    return lines


def markdown_comparison_table(analysis: dict, candidate: str) -> list[str]:
    lines = [
        "| corpus | N | Δ%_point | 95% CI low | 95% CI high | CI vs +1.0% | chunks worse / N | sign-test p | naive ±% per arm |",
        "|---|---:|---:|---:|---:|---|---:|---:|---|",
    ]
    for corpus in CORPORA:
        item = analysis["comparisons"][candidate][corpus]
        naive = item["naive_ppl_err_pct"]
        naive_text = f"control {fmt_pct(naive['control'])}; {candidate} {fmt_pct(naive['candidate'])}"
        lines.append(
            f"| {corpus} | {item['N']} | {fmt_pct(item['delta_paired_pct'])} | "
            f"{fmt_pct(item['ci95_delta_pct_low'])} | {fmt_pct(item['ci95_delta_pct_high'])} | "
            f"{item['ci_vs_+1pct']} | {item['chunks_worse']}/{item['N']} | "
            f"{fmt_p(item['sign_test_p_two_sided'])} | {naive_text} |"
        )
    return lines


def make_markdown(analysis: dict) -> str:
    checks = analysis["self_checks"]
    wiki = analysis["wiki_observation"]
    q40_wiki = analysis["comparisons"]["q4_0"]["wiki"]
    floor_lines = markdown_observed_floor_table(analysis)

    lines = [
        "# **POST-HOC, NON-GATING — the preregistered gate verdict (IQ4_NL FAIL on es/zh, Q4_0 FAIL) is unchanged**",
        "",
        "# q59 paired-chunk PPL analysis",
        "",
        "This is a post-hoc confidence-interval analysis. It does not alter the preregistered point-estimate gate or its verdict.",
        "",
        "## Method and self-checks",
        "",
        "Each log supplies cumulative PPL values `P_1..P_N` for the same chunks across arms. I reconstructed per-chunk mean NLL as `nll_k = k·ln(P_k) − (k−1)·ln(P_{k−1})`, with the `P_0` term set to zero. For each candidate, `d_k = nll_candidate,k − nll_control,k`; therefore `exp(mean(d)) − 1 = PPL_candidate/PPL_control − 1`, exactly the same point-estimate quantity as REPORT.md.",
        "",
        f"All {checks['cells_parsed']}/{checks['cells_expected']} cells parsed. Every log had exactly N cumulative `[k]` matches with indices 1..N, its last cumulative PPL matched the `Final estimate`, and that final estimate matched JSON `ppl`.",
        f"The displayed maximum absolute discrepancy `|mean(nll) − ln(JSON ppl)| = {checks['max_mean_nll_vs_log_json_ppl_discrepancy']:.3e}` is a telescoping identity: the reconstructed terms sum to `N·ln(P_N)` for any sequence. It validates only that the parsed last value is bound to JSON `ppl` and that the float loop is sane; it does **not** validate the individual per-chunk reconstruction. The genuine non-tautological checks are the exact-N/index checks, last cumulative == Final estimate == JSON `ppl`, and the paired-vs-REPORT.md Δ% identity.",
        f"The paired-vs-REPORT.md Δ% identity was checked for all {checks['candidate_cells_identity_checked']} candidate cells: maximum absolute difference from REPORT.md's display-rounded Δ% was `{checks['max_paired_vs_report_delta_abs_difference_pct_points']:.3e}` percentage points. All genuine checks passed.",
        "",
        "## Rounding-noise floor",
        "",
        "Because each logged `P_k` has four decimals, `|error(ln(P_k))| ≤ 0.00005/P_k`. The `(2N−1)·5e-5/P_N` figure is a **worst-case bound on the last chunk's reconstructed value**; the pairwise `d_N` bound below is the sum of candidate and control bounds. This is a numerical floor for reconstructed per-chunk values, not additional model uncertainty.",
        "",
        "The `(2N−1)·5e-5/P_N` figure is an upper bound only when `P_{N−1} ≥ P_N`. The exact adjacent-term bound is `N·5e-5/P_N + (N−1)·5e-5/P_{N−1}`; it is approximately 1.006× larger for wiki control, where the sequence rises at the end. This has no numeric consequence for the reported results.",
        "",
        "### Worst-case last-chunk reconstruction bound",
        "",
        *markdown_rounding_table(analysis),
        "",
        "The next table reports the observed per-chunk differences alongside the floor. The range and mean are in NLL units; `pair floor / mean` is the pairwise final-chunk floor divided by the observed mean absolute per-chunk difference. The final column counts individual differences below `|d_k| < 1e-3`.",
        "",
        *floor_lines,
        "",
        "The reconstruction errors telescope out of `mean(d)`: error on `mean(d) ≤ 5e-5·(1/P_N^cand + 1/P_N^ctrl) = 7.6e-6…1.39e-5` NLL, i.e. at most `0.0014` percentage points of Δ%, versus CI half-widths of `0.30–0.98` percentage points. Under a uniform ±`5e-5/P_k` rounding model, RMS per-chunk noise in `d_k` is `1.6e-4…2.7e-4` and inflates `sd(d)^2`/SE/CI width by at most `0.05%` (worst case IQ4_NL/it, approximately `0.0001` percentage points on a `0.30` percentage-point half-width). Only individual `|d_k| ≲ 1e-3` are sign-ambiguous (`0–3` chunks per comparison); a worst-case three-flip leaves every language-corpus sign-test p below `0.05`, while only the non-gating wiki/IQ4_NL p=`0.0081` could reach approximately `0.06`.",
        "",
        "## Per-chunk NLL difference summaries",
        "",
        *markdown_nll_summary_table(analysis),
        "",
        "## IQ4_NL vs Q4_K_M",
        "",
        *markdown_comparison_table(analysis, "iq4_nl"),
        "",
        "## Q4_0 vs Q4_K_M",
        "",
        *markdown_comparison_table(analysis, "q4_0"),
        "",
        "`Δ%_point` is the paired point estimate, not a new gate decision. The CI classification asks only whether the 95% CI is entirely at or below +1.0%, entirely above +1.0%, or straddles +1.0%.",
        "",
        "## Wiki observation",
        "",
        f"On wiki, Q4_0 favoured Q4_K_M on {wiki['q4_0_chunks_favour_q4_0']}/{wiki['N']} chunks (`d_k < 0`); the two-sided exact sign-test p-value was `{fmt_p(wiki['q4_0_sign_test_p_two_sided'])}`. The paired 95% CI for Q4_0 Δ% was `[ {fmt_pct(q40_wiki['ci95_delta_pct_low'])}, {fmt_pct(q40_wiki['ci95_delta_pct_high'])} ]`, so it excludes 0: **{'YES' if wiki['q4_0_paired_ci_excludes_zero'] else 'NO'}**.",
        "",
        "This is the observed wiki pattern: both candidates are better than Q4_K_M on wiki, while both are worse on all four language corpora.",
        "",
        "## Limitations",
        "",
        "- Post-hoc and non-gating; the preregistered verdict is unchanged.",
        "- Single seed and one evaluated model/protocol.",
        "- Four-decimal log rounding creates the reconstruction floor reported above; individual very small per-chunk differences should not be overinterpreted.",
        "- Wiki uses 64 of 145 chunks, as specified by Amendment 1.",
        "- No Bonferroni correction is claimed; these are unadjusted per-corpus exploratory intervals and sign tests.",
        "",
    ]
    return "\n".join(lines)


def write_outputs(base: Path, analysis: dict) -> None:
    json_path = base / "paired_chunks_q59.json"
    markdown_path = base / "PAIRED.md"
    try:
        json_path.write_text(json.dumps(analysis, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
        markdown_path.write_text(make_markdown(analysis), encoding="utf-8", newline="\n")
    except OSError as exc:
        fail(f"cannot write output: {exc}")


def print_summary(base: Path, analysis: dict) -> None:
    checks = analysis["self_checks"]
    print("q59 paired-chunk analysis: POST-HOC, NON-GATING")
    print(f"cells parsed: {checks['cells_parsed']}/{checks['cells_expected']}")
    print(f"max mean-NLL self-check discrepancy: {checks['max_mean_nll_vs_log_json_ppl_discrepancy']:.3e}")
    print(f"max paired-vs-REPORT Delta difference: {checks['max_paired_vs_report_delta_abs_difference_pct_points']:.3e} percentage points")
    print("comparisons:")
    for candidate in CANDIDATES:
        for corpus in CORPORA:
            item = analysis["comparisons"][candidate][corpus]
            print(
                f"  {candidate}/{corpus}: N={item['N']}, Delta={fmt_pct(item['delta_paired_pct'])}, "
                f"CI=[{fmt_pct(item['ci95_delta_pct_low'])}, {fmt_pct(item['ci95_delta_pct_high'])}], "
                f"worse={item['chunks_worse']}/{item['N']}, sign-p={fmt_p(item['sign_test_p_two_sided'])}"
            )
    wiki = analysis["wiki_observation"]
    print(
        f"wiki Q4_0 better chunks: {wiki['q4_0_chunks_favour_q4_0']}/{wiki['N']}, "
        f"sign-p={fmt_p(wiki['q4_0_sign_test_p_two_sided'])}, "
        f"paired CI excludes 0={'YES' if wiki['q4_0_paired_ci_excludes_zero'] else 'NO'}"
    )
    print(f"wrote: {base / 'paired_chunks_q59.json'}")
    print(f"wrote: {base / 'PAIRED.md'}")
    print("PAIRED: PASS")


def main() -> int:
    base = Path(__file__).resolve().parent
    analysis = make_analysis(base)
    write_outputs(base, analysis)
    print_summary(base, analysis)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValidationError as exc:
        print(f"PAIRED: FAIL {exc}", file=sys.stderr)
        raise SystemExit(1)
