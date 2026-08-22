# Pre-registration — N≥5 KEXP-on-GPU vs CPU experts vs no-offload baseline on Adreno 740

**Protocol version:** 1.1 (2026-08-21)

**Status:** PRE-REGISTERED. Not run. Do not start until this doc is the protocol.

**Lock:** v1.1 must be **committed to the outer repo (Aspis0) before the session**. The session log cites that commit hash. Any later edit is visible in git history. Do not invent the hash in this file before the commit exists; the session MANIFEST records it at session start.

**Queue:** #18. Confirmatory ship cell. The 2026-08-21 KEXP exploratory (`results/kexp_speed_s23/`, 2 ABBA blocks, unplugged, ngl=99) is the **motivation**, not an instance. It cannot ship: N=2, no arm C, no 10 min cell cap, pause records lived under the OLMoE tree, screen timeout was the OLMoE 30 min pin rather than sized to this cell.

**Exploratory predecessor (NOT this cell):** 2026-08-21 S23, LFM2.5-8B-A1B-KEXP Q5_K/Q6_K trunk + Q2_K/Q3_K experts, ngl=99, ABBA×2, unplugged, noextra impl, opencl `b9d99fa8…`. Sustained tg512 **1.812×** (median A **13.740** vs B **7.582** t/s, N=4+4). Per-block mean(A)/mean(B) **1.862** then **1.785**. First-A **15.96 / 15.20** vs second-A **12.28 / 11.57** (~24% intra-block decay); B flat (**7.31–7.68**). ngl=99 experts-GPU **lived** (no oomwall). Arm C (`-ngl 0`) was **not run**. Mellum2 on the same session is a different model and is not this cell.

**Binary / flags (frozen, v1.2):** the deployed head-build set (engine `7686ca6fc`, device-verified same-day: MUL_MAT_ID 407/407, MUL_MAT 925/925, on-device sha chain in `results/q17_verify_s23/`): `libllama-bench-impl.so` `8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807` with **`-nr` (`--no-repack`) MANDATORY on all three ship arms** (the productized, device-smoked equivalent of the retired noextra hack; the `no_repack` field in every cell's jsonl is the per-cell evidence). `libggml-opencl.so` `f432548328af0429fd0f885ccde70cae69f40666118836c713491602dedd6d6d` (kalsakernel-v4 + #26476 + barrier-safe port + #17 host fixes; q2_K/q3_K MoE + q6_K dense). `llama-bench` stub `b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c` (unchanged from v1.1). Same `.so` on A, B, and C. `-fa off`. `GGML_OPENCL_LOG_ALLOC` unset — **evidenced**: archive `printenv` / adb `env | grep GGML_OPENCL` (or equivalent) under `results/kexp_speed_s23/probes/` at session start; empty/absent is the pass. USB unplugged; TLS serial. Stock extra_bufts (`bad17952…`) is **forbidden on A/B/C**. Optional arm D (after the bag) is the only permitted use of that binary.

### Changelog

- **v1.2 (2026-08-22, pre-run, before any block):** binary re-pin, forced by
  artifact loss: the v1.1-pinned `libggml-opencl.so` `b9d99fa8…` no longer
  exists anywhere (PC build tree and device dir were both rebuilt/overwritten
  by later banked chapters; verified by disk+device sha sweep). Re-pinned to
  the **deployed head-build set** (engine `7686ca6fc`) which has stronger
  provenance than any reconstruction: same-day on-device verification
  (407/407 MoE incl. the new m=96 discriminators, 925/925 dense, sha chain in
  `results/q17_verify_s23/`). The retired noextra impl hack (`d2030f23…`,
  still archived in `results/oomwall_s23/staging/noextra/`) is replaced by
  the **`-nr` flag on all ship arms** — semantically identical
  (`use_extra_bufts=false`), device-smoked, and self-documenting via the
  per-cell `no_repack` jsonl field. Stub pin unchanged (`b2ae0fa6…`).
  Arm D stock pin unchanged (`bad17952…`, archived in
  `results/oomwall_s23/staging/stock/`). Nothing else changes. Note: the
  exploratory predecessor ran on the v1.1 build — already motivation, not an
  instance; the cross-build comparability caveat is hereby explicit.

- **v1.1 (2026-08-21, owner arbitration of hostile audit F2–F9):** B-range 7.31–7.68 (F2). Palindrome cancels first-order drift only; quadratic loads on A, conservative vs both floors (F3). C renamed **product default / no-offload baseline**; repack-coverage paragraph; optional post-bag arm-D stock probe, never ship (F4). Cap: ≥2 over-cap C cells → stop+amend; rule 3 > rule 6; 15-min STOP is terminal without a written amendment; `wake_post ≠ Awake` excludes (F5). A/B floor stays 1.50 with 1.40–1.50 + cool-start≥1.50 (≥3 cool) → report, re-run cooldown (F6). Lock = Aspis0 commit before session (F7). LOG_ALLOC unset evidenced in `probes/`; medians full precision, report 3 decimals, no rounding before floor compare (F8). Criterion 5 = unplug per block + Awake per cell; brightness readback must be 128 (F9).
- **v1.0 (2026-08-21):** initial pre-registration. Modeled on OLMoE `PREREG_N10.md` v1.2.

---

## Hypothesis (confirmatory)

On Adreno 740, when LFM2.5-8B-A1B-KEXP **fits** (noextra mmap + GPU slice inside MemAvailable, no anonymous multi-GB dest), **GPU-placed MoE experts are ≥1.5× faster at sustained decode than CPU-placed experts at the same ngl, at equal-or-lower skin temperature.**

The ≥1.5× A/B floor is below the exploratory 1.81× so a real but smaller effect still ships; it is above the OLMoE 1.3× floor because this model’s exploratory point is higher and because A/B here isolates expert placement on a trunk that is already Q5_K/Q6_K-on-GPU. It is above 1.0 so “no slower” is not enough.

**Descriptive-primary (dossier headline, also gated):** GPU-placed experts (A) are ≥1.20× faster than the **product default / no-offload baseline** C (`-ngl 0`, pure CPU, same frozen noextra binary). **C has no exploratory number.** The 1.20 floor is a **guess locked before the run**, not a measurement. If C ≈ B (experts dominate decode), A/C will land near 1.8 and 1.20 is slack. If C is faster than B, 1.20 still requires A beat C. If A/C lands 1.0–1.20: report the dossier sentence, do not ship it. If A ≤ C: **refute** the user-facing claim.

**Claim scope:** one device (S23 / Adreno 740) and one model (LFM2.5-8B-A1B-KEXP) unless a later prereg says otherwise. Paired A vs B vs C is **within-device**.

## Arms (three ship arms, same binary)

| arm | llama-bench | what it isolates |
|---|---|---|
| **A** | `-ngl 99 -fa off -t 4` | experts GPU, trunk GPU (`n_cpu_moe=0`) |
| **B** | `-ngl 99 -ncmoe 99 -fa off -t 4` | experts CPU, trunk GPU — **same ngl as A**; only expert buffers move |
| **C** | `-ngl 0 -fa off -t 4` | pure CPU — **product default / no-offload baseline** (same noextra impl) |

ngl=99 lived in the exploratory (full offload). Do not drop ngl without a new prereg.

Primary model: **LFM2.5-8B-A1B-KEXP.gguf** sha `b07c80870f8a864549f4a419ccbfb4d4282ba2d55a2e8d808b7c377d3fc6c3f4` (on-device path in exploratory: `/data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf`). Verify sha on-device before block 1.

### Repack coverage (why C is not “upstream default”)

Stock upstream llama.cpp has CPU weight-repack **ON** (`use_extra_bufts=true`). This cell’s ship arms run with `-nr` (v1.2; `use_extra_bufts=false`, formerly the noextra impl `d2030f23…`) — the **product** default (production is structurally `use_extra_bufts=false`; that is also the oomwall dodge). On this GGUF: **experts = Q2_K + Q3_K**, **trunk = Q5_K + Q6_K**. On ARM, Q2_K repack is AVX512/RVV-only (no NEON path) and Q3_K has **no** repack traits at all — experts are **repack-invariant**, so A vs B is untouched by the extra_bufts flag. The Q5_K/Q6_K trunk **would** be repacked by stock upstream at `-ngl 0`. Therefore noextra-C **understates** genuine upstream CPU, and measured A/C **overstates** that gap. Hence the rename. A/C ships the product/no-offload sentence, not an upstream-llama.cpp sentence.

### Optional arm D (after the bag, NEVER ship)

**Only after** N≥5 complete blocks are on disk (same after-the-bag rule as Mellum2 on the OLMoE prereg). 1–2 cells, `-ngl 0 -fa off -t 4`, **STOCK** `libllama-bench-impl.so` sha `bad179520546f8d5316cd98124e948d025e8acb2999bf92b94977879ce72c171` (otherwise forbidden on A/B/C). OpenCL pin unchanged. Descriptive-only. **Never** enters any median or ship sentence. Purpose: quantify the true upstream-default CPU gap (trunk Q5_K/Q6_K repack) for the dossier.

Hard **MemAvailable abort** (drop ≥ 2.0 GB in the cell = oomwall-class). A wall event in D **cannot touch** the completed N≥5 dataset: stop D immediately, leave A/B/C files alone. If D power-offs or adb-255s, same: stop D, N≥5 untouchable.

## Design

**N≥5 complete palindromic blocks.** One block = **A, B, C, C, B, A** (6 cells). Five blocks = 30 cells, 10 A + 10 B + 10 C.

**Why ABC-CBA, not ABBA and not ABC×2.** It is a palindrome: mean sequence position of A, B, and C is **3.5** in every block, so **first-order** linear drift (temp, SOC) cancels for all three arms. ABCABC does not cancel. A Latin square across blocks is extra and not required.

**First-order only (F3).** Positions A{1,6}, B{2,5}, C{3,4}. For a quadratic f(t)=ct² the mean penalty is A **18.5c**, B **14.5c**, C **12.5c** (Σt² A>B>C). The documented ~24% A-decay is convex; the second A now follows four cells (B,C,C,B). The palindrome does **not** cancel that component — it loads more on A, which **depresses** measured A and therefore **both** A/B and A/C. Bias is conservative against both floors (a real effect is more likely to fail a floor than to fake a pass). Per-block mean(A)/mean(B) remains the robustness check for thermal collapse.

Extra blocks beyond 5 are welcome if battery allows but not required.

### Intra-block A-decay (pre-declared, from exploratory)

Exploratory ABBA showed a large **first-A vs second-A** drop and a **flat B**:

| block | A1 | A2 | decay | B1 | B2 | mean(A)/mean(B) |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 15.963 | 12.278 | 23.1% | 7.595 | 7.569 | **1.862** |
| 2 | 15.202 | 11.568 | 23.9% | 7.683 | 7.314 | **1.785** |

~24% A decay; B essentially flat (**7.31–7.68**). The two A’s still sit at the cool start and the hot end. The all-cells median is the ship statistic. **Robustness check (pre-declared, not a ship gate):** per-block `mean(tg512_A)/mean(tg512_B)` on complete blocks. Exploratory points were 1.862 and 1.785; a collapse of that per-block ratio toward 1.0 while the all-cells median stays ≥1.50 would be reported as a thermal-pathology caveat, not a silent pass.

In this three-arm block the second A is after **B,C,C,B** rather than after **B,B**. Decay may be **larger** than 24%. That is allowed; first-order cancellation plus conservative quadratic bias is the control, not “balanced second-order.”

### Cooldown gate (same as OLMoE v1.1)

Between blocks (and before block 1): poll `dumpsys battery` `temperature:` every 15 s.

- **Pass:** temperature ≤ **35.0 °C** (raw ≤ 350) → start the block, flag `cool-start`.
- **Hard timeout:** 10 min. If still > 35.0 °C, the block **RUNS anyway**. Flag `warm-start`. Record `temp_c_block_start` as a covariate. Warm-start is **pre-declared, not excluded**.

### Sensitivity analysis (pre-declared)

- **Primary verdict:** all complete blocks (cool-start **and** warm-start), N≥5. This is the ship analysis for **both** A/B and A/C.
- **Secondary:** the same medians restricted to **cool-start** blocks only. Descriptive. If cool-start count is 0, secondary is `not estimable`. Secondary does **not** gate the ship claim and does **not** require ≥5 cool-start blocks.
- **Robustness:** per-block mean(A)/mean(B) as above.
- **Interpretive rule (A/B floor, F6):** if the all-blocks primary A/B lands in **1.40–1.50** (below 1.50, still A>B) **and** the cool-start-only secondary is ≥ **1.50** with **≥3 cool-start** complete blocks, the verdict is **report, re-run with cooldown emphasis** — not ship, not refute. All-warm thermal compression of A is the documented risk. If cool-start count is <3, this clause does not fire (fall through to ordinary report-not-ship / refute rules).

### Battery floor (same as OLMoE v1.1)

No block **starts** below **40%**. Check at block start, after the unplug gate.

If `level < 40` at block start: **pause** for recharge (USB/AC plugged **only** during this pause). Record `pause_t_start`, `pause_t_end`, `level_at_pause`, `level_at_resume`, block index. Files live under **`results/kexp_speed_s23/pauses/`** (not the OLMoE n10 tree). Recommended charge ≥60%; the resume **gate** is still 40%. After charging: **fresh unplug gate**, then continue. A pause is not an exclusion and not an abort.

If level crosses 40% **during** a block: finish that 6-cell block, then pause before the next start.

### Pinning

Set once at session start; do not change mid-session except the documented recharge pause.

| pin | action | control vs record |
|---|---|---|
| Screen | `mWakefulness=Awake` before every llama-bench. `settings put system screen_off_timeout 900000` (**15 min**). Sized to the **cell wall-clock cap** (10 min), not to the 56–88 s exploratory happy path — a cap-length cell must not Doze. Then `settings get` and store. | **control** |
| Brightness | `settings put system screen_brightness 128`. Then `settings get`. **Readback must be 128.** If it is not, record the value and **fix or justify at session start, before block 1**. Do not treat a non-128 readback as the pin. | **control** (must read back 128) |
| Wi‑Fi | Record `settings get global wifi_on` at session start. Do not toggle (including recharge pause). | **hold constant**; record |
| CPU governor | `cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor` **per block**. | **record only** |

### Unplug / wakefulness

**Unplug gate every block** (header lines only): `USB powered: false` and `AC powered: false`. Fail → stop — except during a **declared battery-floor pause**.

**Wakefulness at launch:** `mWakefulness=Awake` immediately before each llama-bench. If `Dozing`/`Asleep`, `input keyevent KEYCODE_WAKEUP` and re-check. If still not Awake, skip the cell and mark it excluded.

**Wakefulness at return (F5):** if `wake_post` ≠ Awake, the cell is **EXCLUDED** (pre-declared; Mellum2 mid-cell Doze). Incomplete block.

### Metrics

**Median comparison rule (F8):** compute medians at **full precision** from raw `avg_ts` / temp values. **Report to 3 decimals.** Do **not** round before comparing to a floor or to the 0.5 °C margin (38.95 is not 39.0).

**Primary metric (A/B, ship):** per-arm **median** of sustained **tg512** (`-p 0 -n 512 -r 1`) across the ≥10 A and ≥10 B cells that survive exclusion, all complete blocks. Test: median(A)/median(B) ≥ **1.50** **and** median peak temp(A) ≤ median peak temp(B) + 0.5 °C.

**Descriptive-primary metric (A/C, dossier headline, also gated):** the same median tg512 on the ≥10 C cells. Test: median(A)/median(C) ≥ **1.20**. Peak-temp A vs C is **reported**, not a second ship gate (C is expected hotter; that is part of the dossier, not a kill).

**Secondary:** temp_c_pre / temp_c_post every cell; temp_c_block_start + warm_start every block; cool-start-only medians; per-block mean(A)/mean(B). Burst pp128/tg128 is **not** mixed into the primary. Cells are **tg512 only**.

**J/token (best-effort, never ship):** record `level_pre`/`level_post` and `Charge counter:` delta if stable. 1% `level` steps may be **not extractable at 1% resolution**. Do not invent mA from `current now`.

### Cell wall-clock cap (hygiene, binding)

Exploratory KEXP cell wall times were **56–88 s** (A ~56–72 s, B ~81–88 s). Cap: **10 min** wall clock from llama-bench launch to jsonl return (~7–10× the longest exploratory cell). C is unmeasured; if C is in the B class it will land well under the cap.

Enforcement — **exclude, do not SIGTERM:**

1. If the cell **returns** with rc=0 and wall ≥ 10 min → **exclude** that cell (incomplete block). Keep the jsonl in the raw archive; do not put it in the median.
2. If the cell is **still running** at 10 min: **do not `killall` / SIGTERM**. Wait for natural exit. When it returns, apply (1) if rc=0; if rc≠0 see precedence below.
3. If still running at **15 min**: **session STOP** (stall). Leave the process. Do not start the next cell. Archive whatever stdout/stderr exists. **The session is OVER.** Resumption requires a **written protocol amendment**, not an operator judgment call. Not an oomwall unless MemAvailable / adb 255 / power-off also fire.

A 10 min cap does **not** license killing a cell to “save the session.”

**Precedence (F5):** exclusion rule 3 (**rc ≠ 0**, adb 255, power-off, MemAvailable cliff) **aborts the whole N≥5 regardless of wall-clock**. Rule 3 **>** rule 6. An over-cap cell that returns rc≠0 is a wall abort, not a quiet exclude.

**“C regularly exceeds the cap” (F5):** **2 or more C cells** with wall ≥ 10 min in the session → **stop and amend**. Do **not** drop C and ship A/B only — both floors are required.

### Raw probe archive (hygiene, binding)

Do not hand-transcribe `dumpsys` / `ps` / kgsl into the report as the only record.

Every cell (and any stall/health probe) archives **raw** pulls under `results/kexp_speed_s23/probes/` (sha the files). Minimum per cell: llama-bench stdout jsonl, stderr, on-device sha block of impl+opencl, battery header grep, `mWakefulness=` grep, MemAvailable. Session start: **LOG_ALLOC-unset env dump**. Stall/health probes add: `ps` of llama-bench, kgsl gpubusy if sampled. The report cites those files.

## Exclusion rules (apply before the median)

1. `mWakefulness` ≠ Awake at launch → exclude.
2. Unplug gate fail **on a block** → session abort. (Declared recharge pause is not a fail.)
3. llama-bench rc ≠ 0, adb 255, power-off, or MemAvailable drop ≥ **2.0 GB** in one cell → **abort the whole N≥5 (arms A/B/C)**, **regardless of wall-clock** (the post-bag arm D probe is governed by its own section and cannot touch a completed N≥5). Do not complete a ship dataset after a wall event. SIGTERM from the harness is rc=143 and is a **protocol violation**, not a wall and not a usable cell.
4. Cooldown 10 min timeout → **do not exclude, do not abort.** Flag `warm-start`.
5. Battery-floor pause → **do not exclude, do not abort.** Record under `results/kexp_speed_s23/pauses/` and resume.
6. Wall-clock ≥ 10 min **and rc=0** → **exclude** that cell (see cap). Incomplete block. (If rc≠0, rule 3 wins.)
7. `wake_post` ≠ Awake → **exclude** (mid-cell Doze). Incomplete block.
8. Excluded cells are not replaced inside the same block; the block is incomplete. Drop incomplete blocks; collect extra ABC-CBA blocks until **≥5 complete blocks** remain.

## Expected outcomes (from exploratory, not the claim)

| metric | exploratory point | this cell expects |
|---|---|---|
| tg512 A/B | 1.81× all-cells; 1.862 / 1.785 per-block | ≥1.50 on all-blocks primary |
| tg512 A/C | **unmeasured** | ≥1.20; if C ≈ B, near 1.8 |
| A intra-block decay | ~24% (second A after BB) | likely ≥24% (second A after BCCB); first-order palindrome + conservative quadratic bias |
| temp | A not hotter than B (peaks 32–39 vs 36–39 °C) | A ≤ B + 0.5 °C on median peak |
| wall | none at ngl=99 noextra | none; abort if cliff |
| C duration | unmeasured | probably B-class (~80 s); if ≥2 C cells over 10 min, amend |

## Ship-claim criterion (all must hold)

1. ≥5 complete ABC-CBA blocks after exclusions (warm-start blocks **count**).
2. median(tg512_A) / median(tg512_B) ≥ **1.50** on the all-blocks primary set (full precision; report 3 decimals).
3. median(temp_peak_A) ≤ median(temp_peak_B) + 0.5 °C on the same set (no rounding before the compare).
4. median(tg512_A) / median(tg512_C) ≥ **1.20** on the same set.
5. Unplug gate held **per counted block**; Awake held **per counted cell** at launch **and** `wake_post` (recharge pauses recorded, not counted as cells).
6. No oomwall-class event.
7. Same binary pins as above, same `.so` on A/B/C, sha on-device before every cell. LOG_ALLOC-unset env dump archived.
8. Pinning applied at session start: screen timeout put 900000 and recorded; **brightness `settings get` = 128** (else justified or fixed before block 1); wifi unchanged. Governor vectors recorded per block.
9. Pause records under `results/kexp_speed_s23/pauses/`. Raw cell/probe files under `results/kexp_speed_s23/` (stdout + `probes/`), not transcription-only.
10. No harness SIGTERM of a live llama-bench (cap is exclude/wait/stop, not kill).
11. Session log cites the Aspis0 commit hash of this locked v1.1.

**Not ship criteria:** J/token; cool-start-only secondary (except the F6 1.40–1.50 interpretive clause); per-block A/B robustness ratios; A vs C peak temp; burst pass; arm D.

If (2) fails with A/B in **1.40–1.50** and cool-start secondary ≥1.50 on ≥3 cool blocks: **report, re-run with cooldown emphasis**. If (2) fails otherwise but A is still faster than B (1.0–1.50×): **report, do not ship** the expert-placement sentence. If (4) fails but A is still faster than C (1.0–1.20×): **report, do not ship** the dossier “vs product default / no-offload” sentence. If A is slower than B, slower than C, or hotter than B beyond +0.5 °C: **refute**.

## Harness notes

New scripts under `results/kexp_speed_s23/`, reusing OLMoE n10 gates: cooldown 35.0 °C / 10 min / warm-start, unplug header-only grep (`^  (USB|AC) powered:`), `dumpsys power | grep mWakefulness=` **pre and post**, wake keyevent, MemAvailable abort 2 GB, TLS serial, battery-floor pause **written to `results/kexp_speed_s23/pauses/`**, brightness readback 128 / wifi / `screen_off_timeout 900000`, per-block governor cat, on-device sha of impl+opencl **before every cell**, LOG_ALLOC env dump at session start. Cell command: `llama-bench -m <KEXP> -fa off -t 4 -o jsonl -p 0 -n 512 -r 1` plus the arm flags. PC-side `adb shell`, not Termux. Do not dump full `dumpsys power` into the log.

Wall-clock: record launch and return timestamps; apply the 10 min cap as specified. Archive jsonl even for excluded over-cap cells.

## Adjudication notes (v1.1)

Hostile audit of v1.0: AMEND (F2–F9). Owner arbitration, **binding**, applied in this v1.1. Still binding from v1.0:

- **Exploratory is motivation, not instance.** The 2026-08-21 2-block cell does not satisfy N≥5 / arm C / cap / pause path.
- **A/C floor is a locked guess.** C was not measured. Changing 1.20 after seeing C is a protocol violation.
- **A-decay is pre-declared.** Using only first-A cells, or dropping second-A as “thermal outliers,” is a protocol violation.
- **SIGTERM is not a measurement.** A killed cell has no tg512.

---
