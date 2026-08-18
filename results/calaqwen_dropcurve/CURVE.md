> ⚠️ **READ `ERRATUM.md` IN THIS DIRECTORY FIRST.** The `gate_vs_k8d0` column and
> the `DROPCURVE_FLAT` verdict below are artefacts of a Mellum2 anchor reused for
> CalaQwen. The `macro_bpb` values and the vs-d0 deltas are sound; the verdict is not.

DROPCURVE_FLAT(spread=0.0269, noise=0.3537)

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
| k6d0 | 0 | 5.8943 | 6.6711 | 6.3488 | 7.4225 | 11.5172 | 0.6781 | -0.3427 | +0.0000 | GATE_PASS |
| k6d03 | 0.3 | 5.9169 | 6.6656 | 6.3455 | 7.4472 | 11.5213 | 0.6785 | -0.3423 | +0.0004 | GATE_PASS |
| k6d05 | 0.5 | 5.9751 | 6.6910 | 6.3612 | 7.4766 | 11.6032 | 0.6803 | -0.3405 | +0.0022 | GATE_PASS |
| k6d065 | 0.65 | 6.1115 | 6.7441 | 6.4190 | 7.5426 | 11.7288 | 0.6842 | -0.3366 | +0.0062 | GATE_PASS |
| k6d08 | 0.8 | 6.2408 | 6.8077 | 6.4894 | 7.6452 | 11.9065 | 0.6889 | -0.3319 | +0.0109 | GATE_PASS |
| k6d10 | 1 | 6.8076 | 7.0453 | 6.7052 | 7.9766 | 12.4293 | 0.7049 | -0.3159 | +0.0269 | GATE_PASS |

### Per-language bpb and deltas vs k8d0

| arm | drop | bpb en | bpb es | bpb fr | bpb it | bpb zh | d en | d es | d fr | d it | d zh |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| k6d0 | 0 | 0.5569 | 0.6344 | 0.6593 | 0.7002 | 0.8396 | -0.2214 | -0.3141 | -0.2947 | -0.3665 | -0.5170 |
| k6d03 | 0.3 | 0.5581 | 0.6341 | 0.6591 | 0.7013 | 0.8397 | -0.2203 | -0.3144 | -0.2949 | -0.3653 | -0.5169 |
| k6d05 | 0.5 | 0.5612 | 0.6354 | 0.6600 | 0.7027 | 0.8421 | -0.2172 | -0.3131 | -0.2940 | -0.3639 | -0.5144 |
| k6d065 | 0.65 | 0.5683 | 0.6380 | 0.6633 | 0.7058 | 0.8458 | -0.2101 | -0.3105 | -0.2908 | -0.3609 | -0.5107 |
| k6d08 | 0.8 | 0.5748 | 0.6412 | 0.6671 | 0.7105 | 0.8510 | -0.2035 | -0.3073 | -0.2869 | -0.3562 | -0.5056 |
| k6d10 | 1 | 0.6021 | 0.6526 | 0.6788 | 0.7253 | 0.8658 | -0.1762 | -0.2959 | -0.2752 | -0.3413 | -0.4908 |

## Noise (continuity vs stored gate)

Stored k6d065 macro = 1.012213 (dMacro vs k8d0 = -0.008606).
Stored k6d10  macro = 1.058632 (dMacro vs k8d0 = +0.037813).

- d065 re-run macro = 0.684231; Δ vs stored = -0.327982; dMacro vs k8d0 = -0.336588
  - en: Δbpb=-0.151814 Δppl=-3.4671
  - es: Δbpb=-0.292169 Δppl=-1.7081
  - fr: Δbpb=-0.302854 Δppl=-2.4727
  - it: Δbpb=-0.352061 Δppl=-2.0059
  - zh: Δbpb=-0.541014 Δppl=-0.1909
- d10 re-run macro = 0.704932; Δ vs stored = -0.353700; dMacro vs k8d0 = -0.315887
- noise floor (max |Δ| of continuity arms) = 0.353700

### Is the stored d065 improvement reproduced?

YES within noise: stored dMacro=-0.0086, re-run -0.3366, |Δ|=0.3280.

## Gate cross (+0.04 vs k8d0)

no arm in [0, 1] exceeds +0.04; max dMacro=-0.3159 at d=1

## Verdict rationale

- best arm = k6d0 (d=0.0) macro=0.6780747712888
- k6d0 macro = 0.6780747712888
- gain vs k6d0 = 0.0
- noise floor = 0.3537001903679551
- all within noise of k6d0 = True
- strictly degrading (within noise) = False
- consecutive Δmacro by increasing d:
  - 0 → 0.3: +0.000405
  - 0.3 → 0.5: +0.001807
  - 0.5 → 0.65: +0.003945
  - 0.65 → 0.8: +0.004698
  - 0.8 → 1: +0.016003

## Artifacts

Under `results/mellum2_dropcurve/`: `identity.json`, `shas.txt`, `STATUS.txt`, `summary.json`, `runs_ppl.csv`, `curve.csv`, `curve.svg`, `curve.png` (if matplotlib), per-arm directories (command.txt, `*_multi5.json`, per-lang stdout/csv), `probe_dgt1/`.

Updated: 2026-08-17T02:28:22-0400

