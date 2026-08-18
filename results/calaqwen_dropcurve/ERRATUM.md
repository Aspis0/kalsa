# ERRATUM — two of the three verdict columns in this cell are artefacts

Written 2026-08-17, minutes after the curve completed, before anything was built
on it. **The measured `macro_bpb` values are sound. The `gate_vs_k8d0` column and
the `DROPCURVE_FLAT` verdict are not, and must not be quoted.**

## What is wrong

This cell was produced by `scripts/run_mellum2_dropcurve.py`, written for Mellum2.
`launch.ps1` reused it for CalaQwen by passing `--expect-model-sha` for the new
model — but the script's reference anchors are a hardcoded path:

```
run_mellum2_dropcurve.py:31   GATE_DIR = ROOT / "results" / "mellum2_ppl_gate"
```

Everything loaded from there is **Mellum2-12B-A2.5B-Instruct-Q4_K_M**:

| anchor | model | macro bpb |
|---|---|---|
| `k8d0` (the gate anchor) | Mellum2-12B | 1.020819 |
| `k6d065` (continuity) | Mellum2-12B | 1.012213 |
| `k6d10` (continuity) | Mellum2-12B | 1.058632 |

So for a CalaQwen arm:

- **`d_macro_vs_k8d0` = CalaQwen − Mellum2 ≈ −0.34**, against `MACRO_PASS = 0.04`.
  Every arm passes with ~0.38 bpb of margin **because CalaQwen is a stronger model
  than Mellum2**, not because its drop level is acceptable. The gate is true by
  construction and carries no information about the drop.
- **`noise_floor_macro = 0.3537`** is `|d10_rerun − d10_stored|` =
  `|0.7049 − 1.0586|` — the gap between two *models*, not run-to-run noise. With a
  floor that large, `all_within_noise` cannot fail, so `DROPCURVE_FLAT` is
  guaranteed regardless of the data.

## What is sound

`macro_bpb` and `d_macro_vs_k6d0` compare CalaQwen against CalaQwen on the same
pinned binary, same corpus, same flags. Decode PPL is deterministic (run-to-run
noise measured at 1e-6 on the Mellum2 campaign), so these deltas are real:

| drop | macro bpb | vs d=0.0 |
|---|---|---|
| 0.00 | 0.6780748 | — |
| 0.30 | 0.6784793 | +0.06 % |
| 0.50 | 0.6802864 | +0.33 % |
| **0.65** | **0.6842309** | **+0.91 %** (the shipped default) |
| 0.80 | 0.6889289 | +1.60 % |
| 1.00 | 0.7049320 | +3.96 % |

**The curve is monotone increasing.** The quality cost of dropping is small, but it
is neither flat nor free, and the six points are ordered well above the 1e-6 noise.

## What it would take to have a real gate

A **CalaQwen k8 d0** anchor measured on this binary and corpus (~1 PC-day). Until
that exists, the honest statement is: *the quality cost of the drop on CalaQwen is
measured and small; there is no gate that was passed, because the gate was
comparing a different model.*

## Not affected

- The **Mellum2** curve (`results/mellum2_dropcurve`): there the anchor is the same
  model, so its gate and noise floor are genuine. The defect only appears when the
  script is reused across models.
- The **M4 renormalisation ablation** (`results/m4_renorm_ablation`): it compares
  renorm OFF against renorm ON *within* CalaQwen, on the same binary, and never
  touches these anchors.
