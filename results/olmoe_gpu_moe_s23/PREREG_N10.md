# Pre-registration — N≥10 GPU vs CPU experts on Adreno 740

**Protocol version:** 1.1 (2026-08-21)

**Status:** PRE-REGISTERED. Not run. Device session scheduled with the owner. Do not start until this doc is the protocol.

**Exploratory predecessor (NOT this cell):** `RESULT.md` 2026-08-21. OLMoE-1B-7B Q4_K_M, ngl=16, ABBA×2, unplugged. Burst tg **2.17×** (A 27.50 vs B 12.69 t/s, A8 tg dropped for Dozing). Sustained tg512 **~1.49×** (A **15.28** vs B 10.26 t/s). Those 15.28 t/s are **OLMoE**, not Mellum2. Mellum2 partial-offload speed is **untested** (the Mellum2 device work in oomwall was a load-wall, not a speed cell). The exploratory cell is the **motivation** for this prereg, not an instance of it.

**Binary / flags (frozen):** noextra `libllama-bench-impl.so` sha `d2030f23db3b4f62f6934c9de831050e71e87c7cfda6e5059d53099ec8b60346` on **both** arms. `libggml-opencl.so` `2ed2e48a…`. `-fa off`. `GGML_OPENCL_LOG_ALLOC` unset. USB unplugged; TLS serial OK. Stock extra_bufts (`bad17952…`) is **forbidden** (oomwall: ARM REPACK of Q4_K is the power-off wall).

### Changelog

- **v1.2 (2026-08-21, owner decision, pre-analysis):** N≥10 → **N≥5 complete ABBA blocks** (20 cells, 10 A + 10 B). Rationale: session budget (battery/time shared with the KEXP cell); decided BEFORE any block result of this session was read — the stopping rule is fixed in advance, not conditional on observed ratios. Everything else (arms, gates, pins, exclusions, metrics, 1.30× floor, temp criterion) unchanged. Blocks already collected in this session under v1.1 count as-is (per-block protocol identical). Claim wording must state N≥5.
- **v1.1 (2026-08-21):** cooldown gate 33.0→35.0 °C; 10 min timeout no longer aborts (warm-start flag + start-temp covariate); sensitivity analysis (primary = all blocks, secondary = cool-start only); battery floor 40% with recorded recharge pause; screen on + fixed brightness + wifi held constant; CPU governor **recorded** per block (no root → not controlled); J/token best-effort secondary, never ship; adjudication notes (within-device paired design; exploratory is motivation not instance).
- **v1.0 (2026-08-21):** initial pre-registration.

---

## Hypothesis (confirmatory)

On Adreno 740, when the model **fits** (noextra mmap + GPU slice + ~377 MiB Adreno scratch inside MemAvailable, no anonymous multi-GB dest), **GPU-placed MoE experts are ≥1.3× faster at sustained decode than CPU-placed experts at the same ngl, at equal-or-lower skin temperature.**

The ≥1.3× floor is below the exploratory 1.49× so a real but smaller effect still ships; it is above 1.0 so “no slower” is not enough.

**Claim scope:** one device (S23 / Adreno 740) and one model (OLMoE-1B-7B Q4_K_M) unless a later prereg says otherwise. Paired A vs B is **within-device**. A multi-device sample is not required for this cell.

## Arms (paired, same ngl)

| arm | llama-bench | experts |
|---|---|---|
| **A** | `-ngl N -fa off -t 4` | GPU (`n_cpu_moe=0`) |
| **B** | `-ngl N -ncmoe 99 -fa off -t 4` | CPU |

`N` is the largest ngl that lived in a **pre-N10 probe** on that model (OLMoE exploratory: N=16). Same N for A and B so attn/dense placement matches; only expert buffers move.

Primary model: **OLMoE-1B-7B-0924-Instruct Q4_K_M** sha `3bd9ec48045f526508956ef663c5c11dbb3ef791a06f4e10a6be88379c40e1fe` (fits; q4_K/q5_K/q6_K MoE kernels from K2 fire: 40/48 expert tensors Q4_K).

## Design

**N≥5 paired ABBA blocks** (v1.2; was N≥10 in v1.0/v1.1). One block = A,B,B,A (4 cells). Five blocks = 20 cells, 10 A and 10 B. Sequence per block is ABBA to cancel linear drift (temp, battery). Extra blocks beyond 5 are welcome if battery allows but not required.

### Cooldown gate (v1.1)

Between blocks (and before block 1): poll `dumpsys battery` `temperature:` every 15 s.

- **Pass:** temperature ≤ **35.0 °C** (raw ≤ 350) → start the block, flag `cool-start`.
- **Hard timeout:** 10 min. If still > 35.0 °C, the block **RUNS anyway**. Flag `warm-start`. Record `temp_c_block_start` as a **covariate**. Warm-start is **pre-declared, not excluded**.

v1.0 (≤33.0 °C, abort on 10 min timeout) is **withdrawn**. Exploratory ABBA on this S23 went 32.5 → 38.1 → 40.2 °C with no return to 33 °C; a 33 °C abort-on-timeout gate would stall at block 2 and make N≥10 unachievable in one session.

### Sensitivity analysis (pre-declared)

- **Primary verdict:** all complete blocks (cool-start **and** warm-start), N≥10. This is the ship analysis.
- **Secondary:** the same medians restricted to **cool-start** blocks only. Descriptive. If cool-start count is 0, secondary is `not estimable`. Secondary **does not** gate the ship claim and **does not** require ≥10 cool-start blocks.

### Battery floor (v1.1)

No block **starts** below **40%** (`dumpsys battery` `level:`). Check at block start, after the unplug gate.

If `level < 40` at block start: **pause the session** for recharge (USB/AC plugged is allowed **only** during this pause). Record `pause_t_start`, `pause_t_end`, `level_at_pause`, `level_at_resume`, block index where the pause occurred. Recommended charge target ≥60% so the next pause is unlikely; the resume **gate** is still the 40% floor (do not invent a second SOC threshold as a hard rule). After charging: **fresh unplug gate**, then continue the next block. A pause is not an exclusion and not an abort.

If level crosses 40% **during** a block: finish that ABBA block, then pause before the next start.

### Pinning (v1.1)

Set once at session start; do not change mid-session except the documented recharge pause.

| pin | action | control vs record |
|---|---|---|
| Screen | `mWakefulness=Awake` before every llama-bench (existing wake keyevent). `settings put system screen_off_timeout 1800000` (30 min) so the panel does not Doze mid-cell (A8 exploratory: Dozing, tg 15.65 vs 27.5). | **control** |
| Brightness | `settings put system screen_brightness 128` (0–255). Then `settings get system screen_brightness` and store the value. Do not change it. | **control** (value recorded) |
| Wi‑Fi | Record `settings get global wifi_on` at session start. Do not toggle Wi‑Fi for the rest of the session (including the recharge pause). Constant, not a prescribed on/off. | **hold constant**; record the held state |
| CPU governor | `cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor` **per block** (block start). | **record only**. We cannot set governor without root. Do not pretend to control it. Treat the vector as a covariate. |

### Unplug / wakefulness (unchanged)

**Unplug gate every block** (header lines only, not the event log): `USB powered: false` and `AC powered: false`. Fail → stop — except during a **declared battery-floor pause**, which is plugged by design and is not a block.

**Wakefulness:** `mWakefulness=Awake` immediately before each llama-bench. If `Dozing`/`Asleep`, `input keyevent KEYCODE_WAKEUP` and re-check. If still not Awake, skip the cell and mark it excluded.

### Metrics

**Primary metric:** per-arm **median** of sustained **tg512** (`-p 0 -n 512 -r 1`) across the ≥10 A and ≥10 B cells (v1.2) that survive exclusion, **all complete blocks** (primary set). Hypothesis test: median(A)/median(B) ≥ 1.3 **and** median peak temp(A) ≤ median peak temp(B) + 0.5 °C (equal-or-lower; 0.5 °C is thermometer granularity).

**Secondary (speed / thermal):**
- Burst pp128 (`-p 128 -n 0`) and tg128 (`-p 0 -n 128`) medians. **Default for this pre-reg:** each ABBA cell is **tg512 only** (primary). Burst pp128+tg128 is an optional second N≥10 pass, not mixed into the primary median.
- Temp curve: `temp_c_pre` / `temp_c_post` every cell; `temp_c_block_start` + `warm_start` bool every block.
- Cool-start-only medians (sensitivity; see above).

**J/token (best-effort secondary, never ship):** battery `level` delta over a fixed token count. Each tg512 cell emits 512 tokens. Record `level_pre`, `level_post`. Sum Δlevel over A cells vs B cells for the same 10×512 tokens (v1.2). **Pre-declared caveat:** 1% `level` steps may make the proxy **non-extractable** at this resolution; if so, report `not extractable at 1% resolution` rather than inventing mA from `current now` (sign/units are vendor-specific). Optional: `charge counter` µAh if `dumpsys battery` exposes it stably (`Charge counter:` on S23 exploratory was 3750000 at full — use **delta** only). **J/token is not a ship criterion** and a missing/non-extractable J/token does not fail the cell.

## Exclusion rules (apply before the median)

1. `mWakefulness` ≠ Awake at launch → exclude (A8 exploratory: Dozing, tg 15.65 vs 27.5).
2. Unplug gate fail **on a block** → session abort, not a silent exclude. (Declared recharge pause is not an unplug-gate failure.)
3. llama-bench rc ≠ 0, adb 255, power-off, or MemAvailable drop ≥ **2.0 GB** in one cell (oomwall-class anonymous cliff) → **abort the whole N≥10**. Do not complete a ship dataset after a wall event.
4. Cooldown 10 min timeout → **do not exclude, do not abort.** Flag `warm-start` (v1.1).
5. Battery-floor pause → **do not exclude, do not abort.** Record and resume (v1.1).
6. Excluded cells are not replaced inside the same block; the block is incomplete. Pre-registered: incomplete blocks are dropped; collect extra ABBA blocks until **≥10 complete blocks** remain.

## Expected outcomes (from exploratory, not the claim)

| metric | exploratory point | this cell expects |
|---|---|---|
| tg512 A/B | 1.49× (OLMoE ngl=16, N=4+4, already hot) | ≥1.3× on the **all-blocks** primary; warm-start blocks are allowed |
| tg128 A/B | 2.17× (N=3 A after drop) | ≥1.5× if a burst pass is run |
| temp | A plateau 38–39 °C, B ended 40.2 °C; never returned to 33 °C | A ≤ B on median peak; many blocks may be `warm-start` |
| wall | none at ngl=16 noextra | none; abort if cliff |

## Ship-claim criterion (all must hold)

1. ≥5 complete ABBA blocks after exclusions (v1.2; warm-start blocks **count**).
2. median(tg512_A) / median(tg512_B) ≥ **1.30** on the **all-blocks** primary set.
3. median(temp_peak_A) ≤ median(temp_peak_B) + 0.5 °C on the same primary set.
4. Unplug and Awake gates held on every counted cell (recharge pauses recorded, not counted as cells).
5. No oomwall-class event.
6. Same binary pins as above.
7. Pinning applied at session start (screen on, brightness 128 or the recorded `settings get` value, wifi state unchanged). Governor vectors recorded per block.

**Not ship criteria:** J/token; cool-start-only secondary; burst pass; Mellum2 block.

If (2) fails but A is still faster (1.0–1.3×): **report, do not ship** the thermal-valve as a product sentence. If A is slower or hotter: **refute**.

## Exploratory Mellum2 block (AFTER N≥10 is in the bag)

Mellum2-12B-A2.5B Q4_K_M sha `b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7`. **Partial offload only:** `-ngl 2` then `-ngl 4`, `-fa off`, noextra impl (W4c proved load lives at ngl=2 ncmoe 99; experts-GPU at ngl=2 without `-ncmoe` is still a crash-risk relative to the wall chapter — start with **`-ncmoe 99` dense-GPU / experts-CPU** as a load sanity, then one **experts-GPU** cell at ngl=2 if that lived). Not part of the 1.3× median. Purpose: first speed number on Mellum2 GPU MoE, which **does not exist yet**. If it power-offs, stop Mellum2, do not touch the OLMoE N≥10 dataset.

## Harness notes

Reuse `results/olmoe_gpu_moe_s23/` scripts with: cooldown loop (35.0 °C / 10 min / warm-start flag), unplug header-only grep (`^  (USB|AC) powered:`), `dumpsys power \| grep mWakefulness=`, wake keyevent, MemAvailable abort threshold 2 GB, TLS serial fallback, battery-floor check + pause record, `settings put/get system screen_brightness`, `settings get global wifi_on`, `screen_off_timeout`, per-block `scaling_governor` cat. Do not dump full `dumpsys power` into the log (exploratory A/B did; it hid sensors).

## Adjudication notes (v1.1, binding)

Free-coder audit of v1.0 produced an incoherent overall verdict but contained real findings (cooldown stall, missing battery floor, missing pins, J/token over-claim). Owner arbitration, **binding**:

- **Applied:** cooldown realism (this v1.1); battery floor 40%; screen/wifi/governor pinning as specified; J/token downgraded to best-effort non-ship.
- **REFUTED — “multiple devices required”:** the design is paired A vs B **within one device**. The claim is already scoped to S23 + OLMoE. A multi-device sample is a different prereg.
- **REFUTED — “exploratory data violates protocol”:** the 2026-08-21 cell is the **motivation** for this prereg, not an instance of it. It does not have to satisfy N≥10 / cooldown / pins. That is why it cannot ship and why this document exists.

---
