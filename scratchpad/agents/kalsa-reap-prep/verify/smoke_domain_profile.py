#!/usr/bin/env python3
"""Smoke the patched moep profiler on the synthetic checkpoint (CPU).

Builds a doll-house moep-style checkpoint (make_synth_checkpoint.py), writes
seven tiny domain jsonl files, then runs the real CLI once:
  python -m moep.cli profile --calib x7 --domain x7 --device cpu
Asserts, per the phase-0 gate: EXIT=0, seven profile_<domain>.stats.pt written,
every summary fully finite, the new norm_max accumulator > 0, and the merged
profile.stats.pt equals (sum of additive stats, element-wise max of norm_max,
sum of token counts).

Usage: smoke_domain_profile.py <patched-moep-root> [workdir=/tmp/moep-domain-smoke]
"""

import json
import pathlib
import subprocess
import sys

MOEP_ROOT = pathlib.Path(sys.argv[1]).resolve()
WORK = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/moep-domain-smoke")
SYNTH = WORK / "synth"
RUN = WORK / "runs"
DOMAINS = ("it", "fr", "es", "en", "zh", "code", "math")
ADDITIVE = ("counts", "gate_sum", "prob_mass", "norm_sum", "norm_sq_sum", "reap_sum")

REPEAT = ("La qualità della vita dipende anche da quello che noi ne facciamo ogni giorno. ") * 12
SNIPPETS = {
    "it": REPEAT,
    "fr": ("Les décisions que nous prenons aujourd'hui façonnent les choix de demain. ") * 12,
    "es": ("Las decisiones que tomamos hoy determinan las posibilidades de mañana. ") * 12,
    "en": ("The choices we make today shape the options we will have tomorrow. ") * 12,
    "zh": "我们在今天做出的每一个决定，都会影响明天可以拥有的选择，所以要认真对待。" * 12,
    "code": ("def pipeline(rows, limit=64):\n    out = []\n    for r in rows:\n"
             "        v = sum(x * x for x in r) / max(len(r), 1)\n"
             "        if v >= limit:\n            out.append((r[0], v))\n"
             "    return sorted(out, key=lambda p: -p[1])\n") * 12,
    "math": ("Nadia bought 4 movie tickets for $12 each and 3 snacks for $5 each. "
             "How much did she spend in total? Show every step of the arithmetic. ") * 10,
}


def load_run_stats(dom):
    """Import from the patched tree, then read a stats file + its summary."""
    sys.path.insert(0, str(MOEP_ROOT / "src"))
    from moep.profiler import load_stats
    name = "profile" if dom is None else f"profile_{dom}"
    d, meta = load_stats(RUN / f"{name}.stats.pt")
    s = json.loads((RUN / f"{name}.stats.pt.summary.json").read_text())
    return d, meta, s


def main() -> int:
    import torch

    WORK.mkdir(parents=True, exist_ok=True)
    here = pathlib.Path(__file__).resolve().parent
    py = sys.executable

    r = subprocess.run([str(py), str(here / "make_synth_checkpoint.py"), str(SYNTH)],
                       capture_output=True, text=True)
    if r.returncode:
        print(r.stdout + r.stderr, file=sys.stderr)
        sys.exit("synth checkpoint failed")
    for dom, text in SNIPPETS.items():
        with open(WORK / f"{dom}.jsonl", "w", encoding="utf-8") as f:
            for k in range(2):
                row = {"messages": [{"role": "user", "content": text + f" [{k}]"}]}
                f.write(json.dumps(row) + "\n")

    cmd = [str(py), "-m", "moep.cli", "profile", "--run", str(RUN), "--model", str(SYNTH)]
    for dom in DOMAINS:
        cmd += ["--calib", str(WORK / f"{dom}.jsonl"), "--domain", dom]
    cmd += ["--seq-len", "128", "--batch-size", "2", "--max-seqs", "2", "--device", "cpu"]
    env = {"PYTHONPATH": str(MOEP_ROOT / "src"), "PATH": "/usr/bin:/bin",
           "HOME": str(pathlib.Path.home()), "HF_HUB_OFFLINE": "1"}
    r = subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=str(WORK))
    (WORK / "smoke_cli.log").write_text(r.stdout + "\n--- stderr ---\n" + r.stderr)
    print(f"cli exit={r.returncode}  (log: {WORK / 'smoke_cli.log'})")
    if r.returncode:
        print(r.stdout[-2000:] + "\n" + r.stderr[-2000:], file=sys.stderr)
        return 1

    fails = []
    merged, merged_meta, m_sum = load_run_stats(None)
    sum_total = 0
    for dom in DOMAINS:
        d, meta, s = load_run_stats(dom)
        sum_total += int(d["total_tokens"])
        if not all(s["stats_finite"].values()):
            fails.append(f"{dom}: non-finite accumulators {s['stats_finite']}")
        if s["max_norm_max"] <= 0:
            fails.append(f"{dom}: norm_max accumulator is 0")
        if s["total_tokens"] <= 0:
            fails.append(f"{dom}: no tokens profiled")
        # NOTE: min_layer_expert_coverage == 1.0 is the REAL-model pod gate
        # (20_observe.sh); a random router on 2x128-token synth batches only
        # touches ~35% of the 128 experts per layer, so it is not asserted here.
        if meta.get("domain") != dom:
            fails.append(f"{dom}: meta domain={meta.get('domain')!r}")
    if int(merged["total_tokens"]) != sum_total:
        fails.append(f"merged total_tokens {int(merged['total_tokens'])} != sum {sum_total}")
    if merged_meta.get("domains") != list(DOMAINS):
        fails.append(f"merged meta domains={merged_meta.get('domains')!r}")
    for k in ADDITIVE:
        acc = None
        for dom in DOMAINS:
            d, _, _ = load_run_stats(dom)
            acc = d[k].clone() if acc is None else acc + d[k]
        if bool((merged[k] - acc).abs().max() >= 1e-3):
            fails.append(f"merged {k} != sum over domains")
    mx = None
    for dom in DOMAINS:
        d, _, _ = load_run_stats(dom)
        mx = d["norm_max"].clone() if mx is None else torch.maximum(mx, d["norm_max"])
    if not bool((merged["norm_max"] == mx).all()):
        fails.append("merged norm_max != element-wise max over domains")
    if m_sum["max_norm_max"] <= 0:
        fails.append("merged: norm_max accumulator is 0")

    if fails:
        for f in fails:
            print("FAIL " + f, file=sys.stderr)
        return 1
    print(f"SMOKE OK: 7 domain stats + merged profile.stats.pt; all accumulators finite; "
          f"norm_max>0 (max {m_sum['max_norm_max']:.3f}); merged sums/max consistent; "
          f"{sum_total} tokens")
    return 0


if __name__ == "__main__":
    sys.exit(main())
