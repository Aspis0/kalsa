# REPORT — cell `gemm-f32-ship`

QRD8650 / Adreno 750 / SM8650, QDC session **808521**, unit `36aa3b71`, 2026-09-07.
APK **`6fc14d1`** (app commit `8269aa2` + fork pin `67c73d26c`), model
LFM2.5-2.6B-QAD-Q4_0 sha `a247afd6…`. Driver `qdc-governor-s5b/d_run.sh`,
`ORACLE_MODE=logit`, tools off, greedy, governor forced on arm B.

## Headline

**With the f32 product, the app's GPU prefill stops disagreeing with its CPU prefill.**
On the same board and the same 32-step teacher-forced protocol that produced ALIVE 55,
every pre-registered criterion is met, and the top-1 disagreements that were the whole
problem are **gone**.

| quantity | pre-fix (ALIVE 55) | registered "fix works" | measured | |
|---|---|---|---|---|
| median \|Δp₁\| | 0.0861 | ≤ 0.02 | **0.0014** | 61× better |
| median max\|Δlogp\| | 3.444 nats | ≤ 0.5 | **0.3037** | 11× better |
| steps with \|Δp₁\| > 0.02 | 21/32 | ≤ 8/32 | **8/32** | at the boundary |
| top-1 flips where CPU is confident | 8/32 | ≤ 2/32 | **0** | gone |
| max \|Δp₁\| | 0.7166 | — | **0.0883** | 8.1× |
| max \|Δlogp\| | 8.7216 | — | **0.8627** | 10.1× |

Raw verdict: `oracle=FAIL rule=R2 steps=32 max_dlogp=0.8627 max_dp1=0.0883 divergences=0`.

**The FAIL is not a failure.** PREREG §"Reading 1" registered, before any data, that R2
(|Δp₁| ≤ 0.02 at *every* one of 32 steps) would probably still fail with a correct fix,
because same-top is 94.8 % and not 100 %. It failed exactly there and nowhere else. R2 is
the owner's promotion gate, deliberately strict; the question the cell asked is answered
by the continuous metrics, and they collapsed.

The worst step after the fix (max |Δp₁| = 0.0883) is about as good as the *typical* step
before it (median 0.0861).

## Speed — and the bench cost transfers almost exactly

Same pair, 925-token prefill (`chunks 2+128×7+27`), `engine_prefill=GPU` confirmed in the
route facts, so this is a GPU turn and not a silent CPU fallback.

| | CPU prefill (arm A) | GPU prefill (arm B) | ratio |
|---|---|---|---|
| pre-fix (ALIVE 55) | 7.294 s | 4.105 s | 1.78× |
| **post-fix (this cell)** | **7.599 s** | **6.119 s** | **1.242×** |

Registered point prediction was 1.78 × 0.659 = **1.17×**, registered interval 1.05–1.30.
Measured **1.242×** — inside it.

Sharper still: the bench-level cost predicts the in-app GPU prefill time to within 2 %.
4.105 s / 0.659 = 6.229 s predicted, 6.119 s measured (−1.8 %). The `llama-bench` number
and the in-app number are measuring the same thing.

Decode is unaffected, as expected — it never used this kernel: 21.27 tok/s (A) vs
22.18 tok/s (B).

## What this means for the governor

The GPU prefill advantage on a V75 part is **1.24×, not 1.78×** — and the 1.78× was
bought with a model that answered differently. The PLAN's prediction that the advantage
would fall to near parity is **directionally right but too strong**: 1.24× is a real
advantage, not parity. The GPU keeps a speed case on this tier, a smaller one, plus the
thermal argument (this turn: GPU +4.5 °C vs CPU +10.1 °C on the skin) and the freed CPU.

What it does **not** settle: whether `GPU_PREFILL_CORRECT.V75` may flip to `true`. That is
the owner's call under R6 (no automatic promotion), and R2 still fails. What has changed
is that the reason it fails is now numerical noise an order of magnitude smaller, with
zero token-level disagreements, instead of a model that picks different words.

## Validity and caveats, stated

- n = **1 pair**, one board, one unit. Descriptive, as ALIVE 55 was.
- `oracle` (token-level) reads VOID because arm A's ids were not captured
  (`new_tokens_a=na`); the logit oracle ran teacher-forced (`oracle_mode=TF`) and is the
  measurement. `row_void=0`: the row is valid.
- Arm A started at 36.43 °C and arm B at 36.97 °C — both below the governor's WARM
  threshold, so neither turn was thermally degraded, and the two are comparable to each
  other. They are **warmer** than ALIVE 55's turns; the speed ratio is therefore sound
  (both arms alike) but the absolute seconds are not directly comparable to a cold board.
- Amendment 2 (cooldown wait ceiling 900 → 1500 s) was registered and pushed **before**
  the run that used it. The temperature target stayed 37.0.

## Three runs lost first, and why — all harness, none device

| job | outcome | cause |
|---|---|---|
| `sa812590` | B1 killed mid-typing | my `DEADLINE_MINUTES=40`; a pair needs ~50 min here |
| `sa812590b` | B1 VOID hot, no data | relaunched on a warm device: A1 36.4→47.1, cooldown hit the 900 s ceiling at 37.93 |
| `sa812590c` | B1 VOID hot, no data | cooldown missed the target by **0.22 °C** at the 900 s ceiling |
| **`sa812590d`** | **pair measured** | after Amendment 2: cooldown reached 36.96 °C at **1200 s** |

The device needed 1200 s of cooling and the harness allowed 900. Raising the *target*
instead would have invalidated the experiment: above ~38 °C the governor degrades the
turn to CPU prefill, so arm B would have measured the CPU and could have returned a
meaningless PASS.

## Evidence

`scratchpad/agents/qdc-governor-s5b/raw/sa812590d/` — `results.tsv`,
`8-Gen-3_{A,B}_t1_probs.jsonl` (32 comparable steps), `_status.txt`, cooldown traces.
Kernel presence verified in the shipped binary, not just in the repo: `strings` on
`librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so` gives 32 × `convert_float8(B) * (float)`
and 8 remaining `half8 c0 = 0` in APK `6fc14d1`, versus 0 and 10 in APK `8269aa2`.
