# REVIEW_MATH — q41 PPL gate

Inputs: `logs/ppl-*-wiki.json` / `ppl-*-it.json` (`ppl`, `ppl_err`, `n_chunks`). Script `_math_check.py`.

| claim | computed | verdict |
|---|---|---|
| wiki d_IQ4 = 100×(10.0013−9.5915)/9.5915 | 4.272533 % → report **+4.273 %** | **CONFIRMED** (rounded 3 dp) |
| wiki d_Q40 = 100×(10.3646−9.5915)/9.5915 | 8.060262 % → report **+8.060 %** | **CONFIRMED** |
| PASS bar 9.5915×1.005 | 9.639457 | **CONFIRMED** (report 9.6395) |
| GREY bar 9.5915×1.010 | 9.687415 | **CONFIRMED** (report 9.6874) |
| IQ4 − PASS | 10.0013−9.639457 = 0.361843 | **CONFIRMED** (report 0.362) |
| d_IQ4 > 1.0 % → FAIL | True | **CONFIRMED** |
| wiki n_chunks 584 all three | JSON n_chunks=584 | **CONFIRMED** |
| IT d_IQ4 3.419 % | 100×(6.4725−6.2585)/6.2585 = 3.419350 | **CONFIRMED** |
| IT d_Q40 7.006 % | 100×(6.697−6.2585)/6.2585 = 7.006471 | **CONFIRMED** |
| control wiki wall 3014.1 s | 3014.114… | **CONFIRMED** |
| IQ4 wiki wall 2241.4 s | 2241.408… | **CONFIRMED** |
| Q4 wiki wall 2266.8 s | 2266.808… | **CONFIRMED** |
| size deltas −0.649 % | from verify_arms (same as q37) | **CONFIRMED** vs q37 REPORT |

**0 REFUTED.**

Note: llama.cpp `+/-` is the published stderr of the PPL estimate, **not** a CI for d. Even IQ4 lower-bound 10.0013−0.07556 = 9.9257 vs control upper 9.5915+0.07116 = 9.6627 still implies d ≳ 2.7 % — still FAIL. Not used as the gate (gate is the point estimate, as pre-registered).
