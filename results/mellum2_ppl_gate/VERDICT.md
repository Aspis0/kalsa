# Mellum2 PPL gate summary

Baseline = k8d0. Gates: dMacro<=+0.04 and worst-lang<=+0.1 → GATE_PASS;
dMacro<=+0.06 and worst-lang<=+0.15 → GATE_MARGINAL; else GATE_FAIL.
Precedent: Marco A2 dMacro=+0.0182 GATE_PASS.

| arm | k | drop | macro | dMacro | worst | dWorst | verdict |
|---|---:|---:|---:|---:|---|---:|---|
| k8d0 | 8 | 0.0 | 1.0208 | 0.0000 | — | 0.0000 | ANCHOR |
| k6d10 | 6 | 1.0 | 1.0586 | +0.0378 | fr | +0.0877 | GATE_PASS |
| k6d065 | 6 | 0.65 | — | — | — | — | INCOMPLETE |
| k4d0 | 4 | 0.0 | — | — | — | — | INCOMPLETE |
