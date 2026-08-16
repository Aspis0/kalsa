DROPCURVE_OPTIMUM(dstar=0.5, dMacro=-0.0150)

# Mellum2 drop-curve (k=6, multi5 PPL, PC)

Protocol = mellum2 PPL gate verbatim: campaign multi5 `--ppl-decode` `--moe-stream cache=2000 anon io=4 overlap -t 16 --stock-kernel`.

- binary `bmoe-cli.exe` sha `7722cb23729d367a274fb682cadd28ef5d456f50fc9b5c064e4923ed04d75d52` (verified)
- model Mellum2 F1 Q4 sha `b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7` (verified)
- k8d0 anchor REUSED from `results/mellum2_ppl_gate/k8d0/` (macro=1.020819); not re-run
- arms interleaved: d0, d0.8, d0.3, d1.0, d0.5, d0.65 so drift cannot fake a trend
- d>1.0: CLI **rejects** (`drop_cold_frac` must be in [0, 1]); stopped at 1.0
- progress: 6/6 curve arms complete

## Probe d > 1.0

CLI rejects above 1.0: **True**.
Source: `kalsa-engine/core/src/config.cpp` — 1.0 is the uniform share `1/n_expert_used` and the useful maximum. Above 1.0 the threshold can exceed the largest weight in a routing and discard every expert of a layer.
No multi5 was run at d=1.2 or d=1.5.

- d=1.2: rc=1 rejected=True `config error: moe.drop_cold_frac must be in [0, 1] (0 = off). Above 1.0 the threshold can exceed the largest weight in a routing, which would discard every expert of a layer; 1.0 is the uniform share 1/n_expert_used and the useful maximum.`
- d=1.5: rc=1 rejected=True `config error: moe.drop_cold_frac must be in [0, 1] (0 = off). Above 1.0 the threshold can exceed the largest weight in a routing, which would discard every expert of a layer; 1.0 is the uniform share 1/n_expert_used and the useful maximum.`

## Table (arm × language)

dMacro_k8 = macro − stored k8d0. dMacro_k6 = macro − this-run k6d0.

| arm | drop | en ppl | es ppl | fr ppl | it ppl | zh ppl | macro bpb | dMacro vs k8d0 | dMacro vs k6d0 | gate |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| k8d0 (stored) | 0.0 | 11.5005 | 8.8144 | 8.6524 | 9.7297 | 11.2918 | 1.0208 | +0.0000 | — | ANCHOR |
| k6d0 | 0 | 9.6687 | 8.4270 | 8.8617 | 9.3296 | 11.6317 | 1.0073 | -0.0135 | +0.0000 | GATE_PASS |
| k6d03 | 0.3 | 9.6032 | 8.4840 | 8.8085 | 9.4104 | 11.7159 | 1.0086 | -0.0122 | +0.0012 | GATE_PASS |
| k6d05 | 0.5 | 9.5249 | 8.4067 | 8.7467 | 9.2829 | 11.7627 | 1.0058 | -0.0150 | -0.0015 | GATE_PASS |
| k6d065 | 0.65 | 9.5786 | 8.4522 | 8.8917 | 9.5486 | 11.9197 | 1.0122 | -0.0086 | +0.0049 | GATE_PASS |
| k6d08 | 0.8 | 9.6842 | 8.6723 | 9.3079 | 9.9359 | 12.2007 | 1.0255 | +0.0047 | +0.0182 | GATE_PASS |
| k6d10 | 1 | 10.4696 | 9.1226 | 10.5508 | 11.1374 | 12.4126 | 1.0586 | +0.0378 | +0.0513 | GATE_PASS |

### Per-language bpb and deltas vs k8d0

| arm | drop | bpb en | bpb es | bpb fr | bpb it | bpb zh | d en | d es | d fr | d it | d zh |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| k6d0 | 0 | 0.7231 | 0.9289 | 0.9646 | 1.0470 | 1.3732 | -0.0553 | -0.0196 | +0.0106 | -0.0197 | +0.0166 |
| k6d03 | 0.3 | 0.7209 | 0.9318 | 0.9620 | 1.0510 | 1.3772 | -0.0575 | -0.0167 | +0.0079 | -0.0156 | +0.0206 |
| k6d05 | 0.5 | 0.7183 | 0.9279 | 0.9588 | 1.0446 | 1.3794 | -0.0601 | -0.0206 | +0.0048 | -0.0220 | +0.0229 |
| k6d065 | 0.65 | 0.7201 | 0.9302 | 0.9661 | 1.0578 | 1.3868 | -0.0583 | -0.0183 | +0.0121 | -0.0088 | +0.0303 |
| k6d08 | 0.8 | 0.7236 | 0.9414 | 0.9863 | 1.0765 | 1.3999 | -0.0548 | -0.0071 | +0.0323 | +0.0098 | +0.0433 |
| k6d10 | 1 | 0.7484 | 0.9635 | 1.0418 | 1.1300 | 1.4095 | -0.0299 | +0.0150 | +0.0877 | +0.0634 | +0.0530 |

## Noise (continuity vs stored gate)

Stored k6d065 macro = 1.012213 (dMacro vs k8d0 = -0.008606).
Stored k6d10  macro = 1.058632 (dMacro vs k8d0 = +0.037813).

- d065 re-run macro = 1.012213; Δ vs stored = +0.000000; dMacro vs k8d0 = -0.008606
  - en: Δbpb=+0.000000 Δppl=+0.0000
  - es: Δbpb=+0.000000 Δppl=+0.0000
  - fr: Δbpb=+0.000000 Δppl=+0.0000
  - it: Δbpb=+0.000000 Δppl=+0.0000
  - zh: Δbpb=+0.000000 Δppl=+0.0000
- d10 re-run macro = 1.058632; Δ vs stored = +0.000000; dMacro vs k8d0 = +0.037813
- noise floor (max |Δ| of continuity arms) = 0.000001

### Is the stored d065 improvement reproduced?

YES within noise: stored dMacro=-0.0086, re-run -0.0086, |Δ|=0.0000.

## Gate cross (+0.04 vs k8d0)

no arm in [0, 1] exceeds +0.04; max dMacro=+0.0378 at d=1

## Verdict rationale

- best arm = k6d05 (d=0.5) macro=1.0058019169662855
- k6d0 macro = 1.0073389694195183
- gain vs k6d0 = 0.0015370524532327678
- noise floor = 1e-06
- all within noise of k6d0 = False
- strictly degrading (within noise) = False
- consecutive Δmacro by increasing d:
  - 0 → 0.3: +0.001237
  - 0.3 → 0.5: -0.002774
  - 0.5 → 0.65: +0.006411
  - 0.65 → 0.8: +0.013321
  - 0.8 → 1: +0.033098

## Artifacts

Under `results/mellum2_dropcurve/`: `identity.json`, `shas.txt`, `STATUS.txt`, `summary.json`, `runs_ppl.csv`, `curve.csv`, `curve.svg`, `curve.png` (if matplotlib), per-arm directories (command.txt, `*_multi5.json`, per-lang stdout/csv), `probe_dgt1/`.

Updated: 2026-08-15T23:25:36-0400

