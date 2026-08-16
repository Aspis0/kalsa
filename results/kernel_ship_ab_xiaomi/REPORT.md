# Kernel ship A/B — Xiaomi 14 replication

**Verdict:** certified config (arm B) is faster on this device. Wilcoxon
two-sided W=`0`, p=`0.000977`, Hodges–Lehmann B−A = `−0.05625` s/token,
median change **−14.5%**. N=12 complete pairs, no measured-run exclusions —
but **pair 3 is an exact tie** (A = B = 0.2940 s/token at the harness's 4-decimal
resolution), and Wilcoxon drops zero differences, so the test runs on **11
effective pairs**: `p = 2/2¹¹ = 0.000977` is the exact-test floor for N=11, not
the N=12 floor of 0.000488. Stated here because anyone recomputing the floor from
"N=12" will otherwise find a discrepancy. All 11 non-zero differences favour B.
The pre-registered prediction held on magnitude: the effect is much smaller
than the S23's −42.7%. It did **not** go null. The energy axis was **not
replicated** (coulomb-counter quantization; see below).

Analyzer invoked unchanged:
`results/kernel_ship_ab_s23/analyze_ship_ab.py` against this cell's
`runs.csv`. Verbatim output is in `device/ANALYSIS.md` and is copied at the
end of this file.

## What was found at start

Device `adb-625689a2-9xEOfw._adb-tls-connect._tcp` was online, unplugged,
screen Awake. A first launch of `push_and_start_xiaomi.ps1` (pwsh) **had**
started the harness:

- `STATUS=RUNNING`, `bmoe-cli` alive, session start `10:52:25` EDT
- `uptime_s=616` (`fresh_reboot=yes`), battery 84 %, 33.9 °C
- runtime pin 7/7, model sha match, prompt sha match
- `POWER_SOURCE=COULOMB_COUNTER`, screen stay-on engaged
- `runs.csv` still header-only

Warm-up then failed three times with `FAIL[no_decode_s_tok]`,
`STATUS=FAIL_WARMUP`. The CLI **was** producing the metric. `stdout.try1.txt`
contained `decode 0.276 s/token` and `generation: 144 tokens`. The DONE line
dumped the whole parse blob into `mib/tok=3.644|0.274|…` and left
`s/tok=` empty. Cause: the harness is `#!/system/bin/sh` (mksh). mksh
extglob treats `|` as alternation, so `${_pm%%|*}` / `${_pm#*|}` empty every
field. `parse_metrics` itself was fine; the splitter was not.

That first session accepted no measurement (warmup excluded, sequence
stopped before pair 1). Evidence archived under
`fail_warmup_20260816/`.

## Interventions

One harness fix, nothing else:

- Replaced the 14 `${var%%|*}` / `${var#*|}` assignments in
  `run_ship_ab_xiaomi.sh` with `awk -F'|'` field extracts. Arms, flags,
  pairing, confirmatory metric, test, energy estimator, and floors were
  not touched. Line endings stayed LF (push script would have refused CRLF).
- Cleared `STATUS.txt` / `RESUME_AT.txt` so the retry was a **new** session
  (warmup canary re-run), not a resume that would skip warmup.
- Re-ran `push_and_start_xiaomi.ps1` via pwsh. Uptime at restart = 1022 s
  (< 1800 s gate). Battery 83 %, 32.9 °C, UNPLUGGED. Runtime/model/prompt
  shas re-verified. Harness pushed and started `resume=0`.

Warmup then `COMPLETE` on try 1 (`decode_s_tok=0.268`, excluded=1 as
declared). The 12 ABBA pairs ran without a further intervention.

`adb shell` for the nohup start stayed attached for the whole session (same
as the user's first launch). It did not kill the harness. Not edited.

## Session integrity

| check | result |
|---|---|
| ELF | `0ac612def6b82586d695bfb11acf42cce23bd99fc4ccd3aeddb51a0cd15cf93c` before and after |
| model | `b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7` |
| prompt | `b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd` |
| fresh reboot | yes, `uptime_s=1022` at session start (`SESSION_START.txt`) |
| MemAvailable / SwapFree at start | 6 794 408 / 9 703 420 KiB (SwapTotal 12 582 908) |
| screen | `Awake` on every row |
| plugged | `UNPLUGGED` on every row |
| thermal abort (43 °C) | never hit; session max 40.1 °C |
| battery floor (45 %) | never hit; 83 % → 72 % |
| voids | `void_scan=` empty; 12/12 `PAIR_OK` |
| STATUS | `DONE` at 11:28:58 EDT |

Arm flags (logged at start, unchanged from PREREG):

- A: `-t 4 --n-expert-used 8`
- B: `-t 2 --n-expert-used 6 --drop-cold-experts 1.0`
- common: `--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 -c 4096 --temp 0 --chatml --no-think -n 200`

## Confirmatory — metric 1 (decode wall s/token)

N=12 paired medians, Wilcoxon signed-rank two-sided, alpha 0.05.

| | |
|---|---|
| Median A | 0.368000 s/token |
| Median B | 0.314500 s/token |
| Hodges–Lehmann (B−A) | −0.056250 s/token |
| % change (median B vs A) | **−14.538%** |
| Wilcoxon | W=`0` p=`0.000977` (scipy) |
| Decision | **significant**, B faster |

Every non-zero pair difference has B faster. Pair 3 is an exact tie
(0.294 = 0.294) and is dropped by the signed-rank (zeros). 11 negative
diffs → W=0, two-sided p = 2/2¹¹ = 0.000976562.

B always stopped at 144 tokens (EOS). A always ran to `-n 200`. The
confirmatory metric is per-token, so the length difference is not a
confound. It is logged, not subsetted away.

## Supporting axes

**2. Sustained late-rep (last 4 complete pairs).** Median A `0.389`,
median B `0.321`, HL(B−A) `−0.0715`. The late-session gap is slightly
*larger* than the full-session HL: A slowed (0.29 → 0.42) as the phone
warmed; B stayed flat around 0.31–0.33.

**4. Max battery temperature.** Median A `39.0` °C, median B `38.85` °C,
HL ≈ 0. No thermal separation.

**5. TTFT proxy (first measured run of each arm).** A `p01_A` 7.207 s;
B `p01_B` 7.769 s. Prefill+load, not confirmatory.

**6. Page-cache churn (device-added, not confirmatory).** Every measured
A run is `183.14` MiB/token; every B run (and warmup) is `39.20`
MiB/token. Same I/O-footprint ratio the prediction was built on.

## Metric 3 — J/token, raw and screen-corrected

Instrument: coulomb counter, two `dumpsys battery` reads bracketing the
**full CLI invocation** (`j_window=full_invocation`). Absolute J/token is
not comparable to the S23 (different instrument, window, battery, screen,
silicon). Only a within-cell A-vs-B ratio was ever in scope.

**The estimator is unusable for a paired ratio on this session.** The
counter updates in ~20–40 kµAh lumps. A ~50 s B run usually does not move
it (`dQ=0`). Per amendment 2 those values are dropped, not used:

| | energy present | energy dropped (`dQ < 2000 µAh`) |
|---|---|---|
| arm A (12 runs) | 10 | p09_A, p10_A |
| arm B (12 runs) | 3 | p02_B, p03_B, p04_B, p05_B, p06_B, p07_B, p08_B, p10_B, p11_B |
| both arms of a pair | **pairs 1 and 12 only** | 10 pairs |

When a B run *does* register, the lump is the size of several previous
B runs that the counter never attributed. Pair-level J/token is therefore
mostly “who was running when the counter ticked”, not energy per answer.

Analyzer raw (pairs 1 and 12 only):

- N=2  median A=`0.990544`  median B=`2.94921`  HL(B−A)=`1.95867`

Amendment 3 correction, analysis-time only, P₀ = 0.503 W from
`BASELINE_screen_on.md`. `J_corr = J_raw − P₀ × wall_s` (wall from the
harness `COMPLETE` line, the same window as the two coulomb reads).
Harness not changed.

| run | wall s | J raw | J/tok raw | P₀·t (J) | J corr | J/tok corr |
|---|---:|---:|---:|---:|---:|---:|
| p01_A | 76 | 192.980 | 0.964899 | 38.228 | 154.752 | 0.773759 |
| p01_B | 46 | 296.496 | 2.059000 | 23.138 | 273.358 | 1.898319 |
| p12_A | 89 | 203.238 | 1.016190 | 44.767 | 158.471 | 0.792355 |
| p12_B | 54 | 552.877 | 3.839425 | 27.162 | 525.715 | 3.650800 |

Corrected pair summary (N=2): median A=`0.783057`, median B=`2.774560`,
HL(B−A)=`1.991503`, median-B-vs-A `+254.3%`. Raw and corrected **agree
in sign** (B more J/token). That sign is not evidence: N=2 on a
quantized counter that dumps deferred charge onto whichever B run is
unlucky. It is reported because amendment 3 requires both figures, not
because it is a ratio this cell can defend.

**Verdict on metric 3:** the energy axis was **not replicated**. The cell
stands on metric 1.

## Exclusions

| row | reason |
|---|---|
| warmup (pair 0, arm B) | declared excluded warm-up; completed on the successful session |
| first-session warmup ×3 | harness parser bug (`no_decode_s_tok` from mksh `|*` split). Sequence aborted (`FAIL_WARMUP`). **No row from that session is in `runs.csv`.** |
| measured pairs 1–12 | none. All 24 runs `excluded=0`, all 12 pairs `PAIR_OK`. |

No thermal-wait mid-run, no plugged state, no harness error on a measured
run. Empty J/token cells are amendment-2 energy drops, not exclusions.

## Comparison to the S23 cell (descriptive only)

| | S23 (`device/ANALYSIS.md`) | Xiaomi 14 (this cell) |
|---|---|---|
| confirmatory | W=0, p=0.000488, **−42.7%** | W=0, p=0.000977, **−14.5%** |
| median A / B s/tok | 0.2585 / 0.1480 | 0.3680 / 0.3145 |
| late-rep HL | −0.1025 | −0.0715 |
| J/token (within-cell) | N=12, B **+11.8%** vs A (RED) | **not replicated** (N=2 usable pairs, quantized) |
| temp | ~39.3 / 39.5 °C | 39.0 / 38.85 °C |
| TTFT first A/B | 10.90 / 10.78 s | 7.21 / 7.77 s |
| MiB/token A / B | (same certified recipe) | 183.14 / 39.20 |
| screen | logged, not forced on | forced on; P₀=0.503 W declared |
| binary | campaign ELF `0ac612de…` | **same ELF**, 7/7 runtime pin |

Pre-registered prediction: *the effect is expected to be smaller than
−42.7%, and may be null*, because this phone has more RAM and faster flash,
so arm A's I/O tax is smaller. That is what happened: **smaller, not
null**. Metric 6 matches the mechanism (A still streams 183 MiB/token; B
39). The phone just absorbs that I/O better than the S23, so the wall-time
win shrinks from 43% to 15% and stays significant.

No re-tune of `-t`, no subset of pairs, no one-sided re-read. A loss or a
null would have been reported as a scope finding; this is a smaller win
on the same test.

## Analyzer verbatim

```
# Kernel ship A/B — analysis (PREREG)

Complete pairs (both arms excluded=0): **12**

## Metric 1 — decode wall s/token (confirmatory)

- Pairs used: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
- Median A: `0.368000` s/token
- Median B: `0.314500` s/token
- Hodges–Lehmann shift (B−A): `-0.056250` s/token
- % change (median B vs median A): `-14.538%`
- Wilcoxon signed-rank two-sided: W=`0` p=`0.000976562` (scipy)
- alpha=0.05; lower s/token is faster; negative HL means B faster.
- Decision: **significant** at alpha 0.05 (two-sided).

| pair | A s/tok | B s/tok | B−A |
| ---: | ---: | ---: | ---: |
| 1 | 0.336000 | 0.261000 | -0.075000 |
| 2 | 0.295000 | 0.279000 | -0.016000 |
| 3 | 0.294000 | 0.294000 | +0.000000 |
| 4 | 0.368000 | 0.295000 | -0.073000 |
| 5 | 0.382000 | 0.325000 | -0.057000 |
| 6 | 0.368000 | 0.317000 | -0.051000 |
| 7 | 0.367000 | 0.313000 | -0.054000 |
| 8 | 0.368000 | 0.321000 | -0.047000 |
| 9 | 0.374000 | 0.315000 | -0.059000 |
| 10 | 0.382000 | 0.327000 | -0.055000 |
| 11 | 0.419000 | 0.329000 | -0.090000 |
| 12 | 0.396000 | 0.314000 | -0.082000 |

## Supporting metrics 2–5

### 2. Sustained late-rep (last 4 complete pairs)
- N=4  median A=`0.389000`  median B=`0.321000`  HL(B−A)=`-0.071500`

### 3. J/token
- N=2 pairs [1, 12]  median A=`0.990544`  median B=`2.94921`  HL(B−A)=`1.95867`

### 4. Max battery temperature
- N=12 pairs [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]  median A=`39`  median B=`38.85`  HL(B−A)=`0`

### 5. TTFT proxy (first measured run of each arm)
- first A `p01_A` ttft_s=`7.207`
- first B `p01_B` ttft_s=`7.769`
```
