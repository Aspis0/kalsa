# CalaQwen quality gate, against a CalaQwen anchor

Anchor measured 2026-08-17: **k=8, drop=0.0, macro bpb = 0.666011384026024** on the
pinned binary and the multi5 corpus. This replaces the Mellum2 anchor that made
every previous `GATE_PASS` on this curve vacuous (see
`results/calaqwen_dropcurve/ERRATUM.md`).

Threshold as used by the curve scripts: MACRO_PASS = 0.04 bpb worse than the anchor.

| drop | macro bpb | vs k8d0 | gate |
|---|---|---|---|
| 0.00 | 0.6780748 | +0.0120634 | PASS |
| 0.30 | 0.6784793 | +0.0124679 | PASS |
| 0.50 | 0.6802864 | +0.0142750 | PASS |
| 0.65 | 0.6842309 | +0.0182196 | PASS |
| 0.80 | 0.6889289 | +0.0229175 | PASS |
| 1.00 | 0.7049320 | +0.0389206 | PASS |

A negative `vs k8d0` means the k=6 arm is BETTER than stock k=8 on this model.
