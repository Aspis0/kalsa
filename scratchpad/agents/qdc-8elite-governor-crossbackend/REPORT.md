# REPORT — governor v0 cross-backend on Snapdragon 8 Elite (QDC)

Prereg: `PREREG.md` (locked ddddf077) + `AMENDMENT-1.md` (locked 28a6c934, written before
run 2). Run 1 is VOID for timing (wrong thermal sensor group); **this report is run 2.**

- Session `governor-crossbackend-cell1` (id 788862), QRD8750 = Snapdragon 8 Elite (SM8750),
  Adreno 830, Android 16, device `b4bd0901`. Engine `kalsa/governor-v0` @ **5c3979438**,
  kit `~/kalsa-qdc/bin-gov-5c3979438-stripped` (SHA256SUMS in `raw/provenance.txt`).
- Model: LFM2.5-2.6B **QAD-Q4_0** (the shipping model), 1593894944 B.
- Workload per the prereg: 3 turns × (512-token prompt + 128 generated), greedy, seed 1234,
  `-t 8`, `n_ubatch 512`, r=3, medians of 9 turn-measurements per arm.
- Thermal gate (AMENDMENT-1): every run preceded by cool-down to live CPU0 ≤ 60 °C AND
  `Thermal Status` ≤ 1, read from `Current temperatures from HAL:` only.

## Results (medians)

| block | arm | TTFT ms | decode t/s | prefill ms | commit ms | pre-run CPU0 | post CPU0 / status |
|---|---|---:|---:|---:|---:|---:|---|
| 1 | A (GPU) | 1396.5 | 23.72 | 1392.6 | — | 51.3 | 64.1 / 3 |
| 1 | C (CPU) | 16476.2 | 21.59 | 16474.9 | — | 50.2 | 92.6 / 3 |
| 1 | **G (governor)** | **1434.3** | **25.28** | 1430.5 | 25.76 | 42.4 | — |
| 2 | C (CPU) | 14412.2 | 23.25 | 14411.5 | — | 44.0 | 89.9 / 3 |
| 2 | **G (governor)** | **1469.8** | **24.22** | 1465.6 | 29.07 | 50.5 | 86.1 / 3 |
| 2 | A (GPU) | 1394.3 | 23.85 | 1390.4 | — | 50.2 | 63.3 / 3 |

Commit volume identical in both blocks: `commit_bytes=11206656`, `naive=1 staged=1`.

## Decision rule (written before the numbers) — evaluated on both blocks

| condition | block 1 | block 2 | verdict |
|---|---|---|---|
| `TTFT(G) ≤ TTFT(C) × 0.5` | 1434.3 ≤ 8238.1 ✅ (11.5× better) | 1469.8 ≤ 7206.1 ✅ (9.8×) | **PASS** |
| `decode(G) ≥ decode(C) × 0.95` | 25.28 ≥ 20.51 ✅ (G beats C outright) | 24.22 ≥ 22.09 ✅ (G beats C) | **PASS** |
| `commit_ms / prefill_ms < 2%` | 25.76/1430.5 = **1.80%** ✅ | 29.07/1465.6 = **1.98%** ✅ | **PASS (barely)** |

**G WINS on both blocks.** Per-phase routing beats both single-backend arms on the
shipping model: the GPU's prefill advantage survives the handoff essentially intact
(G's TTFT is within 2.7–5.4% of pure-GPU arm A), and decode stays CPU-grade — in fact
G's decode was *higher* than arm C's in both blocks.

## Honest reading, including what favours G unfairly

1. **The third condition passed by 0.02 points in block 2** (1.98% vs the 2% gate). The
   commit cost is ~26–29 ms against a ~1.4 s prefill. If prefill were faster (shorter
   prompt, or a future faster GPU path), this gate would fail: the cost is nearly fixed
   (11.2 MB per turn-boundary) while prefill scales with prompt length. **The 2% claim
   is prompt-length-dependent and must not be quoted as unconditional.**
2. **Why G's decode beat C's**: arm C runs its own prefill on the CPU, which drives the
   chip to 89.9–92.6 °C and `Thermal Status 3` *within its own run*; G's prefill runs on
   the GPU (post-run 63–64 °C on arm A). So part of G's decode advantage is that it
   arrives at decode with a cooler chip. That is a **real systemic effect of the design**,
   not an artefact — but it is a thermal effect, not a kernel-speed effect, and on a
   phone chassis (worse dissipation than a rack QRD) it would likely be *larger*, not
   smaller. Still: G's decode superiority is not evidence that CPU decode is faster in G
   than in C at equal temperature.
3. **Block 1's G started cooler than its C** (42.4 vs 50.2 °C pre-run). Block 2 inverts
   this (G 50.5, C 44.0) and G still wins, which is the point of the reversed order.
4. r=3, one session, one device sample. No claim about device-to-device variance.

## What this cell does NOT say

- Nothing about Adreno 740 / the S23 (standing rule: GPU findings do not generalise
  across Adreno generations).
- Nothing about KEXP-class 8B models: not measured here, and the fit-gate question
  (two residencies on 8 GB) is untouched.
- Nothing about the app: this is engine-level. The app's own KV pool, session
  persistence and RN bridge are not in the loop.
- Nothing about battery: the rack's battery service is frozen (erratum from bank #37).

## Instrumentation erratum (extends bank #37's frozen-battery finding)

`dumpsys thermalservice` on this rack prints **two** sensor groups: `Cached temperatures:`
is stale (returned identical values for >30 min under sustained load) and
`Current temperatures from HAL:` is live. Run 1 gated on the cached group and was
therefore ungated; the resulting drift hit the control arm hardest (arm A decode
23.80 → 16.22 t/s between blocks). **Any future QDC cell must parse strictly after the
`Current temperatures from HAL:` line and record `Thermal Status`.**
