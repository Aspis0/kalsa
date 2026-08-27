from __future__ import annotations

import json
import math
import re
from pathlib import Path

from q63_common import CORPORA, EXPECTED_CHUNKS, HERE, read_json, write_json

CHUNK_RE = re.compile(r"\[(\d+)\]\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)")
FINAL_RE = re.compile(r"Final\s+estimate:\s*PPL\s*=\s*([-+]?\d+(?:\.\d*)?)\s*\+/-\s*([-+]?\d+(?:\.\d*)?)", re.I)


def load_cell(path: Path, expected: int) -> dict:
    rec = read_json(path)
    if not rec or rec.get("rc") != 0 or not isinstance(rec.get("ppl"), (int, float)) or rec.get("n_chunks") != expected:
        raise RuntimeError(f"incomplete cell: {path}")
    log = Path(rec["log"])
    text = log.read_text(encoding="utf-8", errors="replace")
    matches = list(CHUNK_RE.finditer(text))
    if len(matches) != expected or [int(item.group(1)) for item in matches] != list(range(1, expected + 1)):
        raise RuntimeError(f"chunk log mismatch: {log}")
    final = list(FINAL_RE.finditer(text))
    if len(final) != 1 or abs(float(final[0].group(1)) - float(rec["ppl"])) > 1e-12:
        raise RuntimeError(f"final estimate mismatch: {log}")
    cumulative = [float(item.group(2)) for item in matches]
    logs = [math.log(value) for value in cumulative]
    nll = []
    previous = 0.0
    for index, value in enumerate(logs, 1):
        nll.append(index * value - (index - 1) * previous)
        previous = value
    return {"record": rec, "nll": nll, "cumulative": cumulative}


def compare(control: dict, candidate: dict) -> dict:
    d = [x - y for x, y in zip(candidate["nll"], control["nll"])]
    n = len(d)
    mean = sum(d) / n
    variance = sum((x - mean) ** 2 for x in d) / (n - 1)
    sd = math.sqrt(variance)
    se = sd / math.sqrt(n)
    delta = 100.0 * math.expm1(mean)
    lo = 100.0 * math.expm1(mean - 1.96 * se)
    hi = 100.0 * math.expm1(mean + 1.96 * se)
    worse = sum(x > 0 for x in d)
    better = sum(x < 0 for x in d)
    nonzero = worse + better
    tail = min(worse, nonzero - worse)
    p = 1.0 if nonzero == 0 else min(1.0, 2.0 * sum(math.comb(nonzero, k) for k in range(tail + 1)) / (2.0 ** nonzero))
    return {
        "N": n, "control_ppl": control["record"]["ppl"], "candidate_ppl": candidate["record"]["ppl"],
        "mean_d_nll": mean, "sd_d_nll": sd, "se_d_nll": se, "delta_pct": delta,
        "ci95_delta_pct_low": lo, "ci95_delta_pct_high": hi, "chunks_worse": worse,
        "chunks_better": better, "chunks_tied": n - worse - better, "sign_test_p": p,
    }


def main() -> int:
    manifest = read_json(HERE / "manifest.json") or {}
    selected = manifest.get("control_selection", {})
    controls = {}
    for corpus in CORPORA:
        item = selected.get(corpus)
        if not item:
            raise RuntimeError(f"missing selected control: {corpus}")
        controls[corpus] = load_cell(Path(item["json"]), EXPECTED_CHUNKS[corpus])
    result = {"analysis": "post-hoc, non-gating; adapted from q59 paired_chunks_q59.py", "comparisons": {}, "status": "COMPLETE"}
    markdown = ["# q63 paired analysis — POST-HOC, NON-GATING", "", "| arm | corpus | N | control PPL | candidate PPL | delta % | CI low | CI high | worse/N | sign p |", "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for arm in ("candidate1", "candidate2"):
        result["comparisons"][arm] = {}
        for corpus in CORPORA:
            path = HERE / "ppl" / f"{arm}-{corpus}.json"
            try:
                candidate = load_cell(path, EXPECTED_CHUNKS[corpus])
                item = compare(controls[corpus], candidate)
                result["comparisons"][arm][corpus] = item
                markdown.append(f"| {arm} | {corpus} | {item['N']} | {item['control_ppl']:.4f} | {item['candidate_ppl']:.4f} | {item['delta_pct']:+.4f}% | {item['ci95_delta_pct_low']:+.4f}% | {item['ci95_delta_pct_high']:+.4f}% | {item['chunks_worse']}/{item['N']} | {item['sign_test_p']:.6g} |")
            except Exception as exc:
                result["comparisons"][arm][corpus] = {"status": "SKIPPED", "reason": str(exc)}
                markdown.append(f"| {arm} | {corpus} | — | — | — | — | — | — | — | — |")
    write_json(HERE / "paired_q63.json", result)
    (HERE / "PAIRED_Q63.md").write_text("\n".join(markdown) + "\n", encoding="utf-8")
    print("PAIRED_Q63: COMPLETE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
