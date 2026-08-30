# PREREG — KEXP speed decision table on Adreno 830 (QDC 8 Elite)

Written BEFORE any measurement. Parent commit at lock: **14909190** (the commit hash of
this file is the lock id). Runs only in a future QDC session (owner 2FA required);
nothing in this cell has been measured at lock time.

## The question

On **Adreno 830**, for the KEXP-class MoE recipe (q2_K/q3_K experts, our 8x4 OpenCL
kernels), which arm wins per phase — **A** (GPU full offload) or **C** (pure CPU,
repack)? This extends the decision table across the third GPU/compiler generation:

- 740 (S23, bank #23-series): **C wins always**; GPU is cool-mode only for KEXP.
- 750 (bank #16, 22/08): **A ≈ C decode, A = 2.21× prefill** — the "C always" verdict
  was 740-only.
- 830: unknown. Per the standing rule nothing transfers; this cell measures it.

Precondition: cell E031/830 correctness PASS (925/925 + 407/407, commit 0f35d4f5) must
survive its hostile audit before this cell runs — speed numbers on kernels not yet
certified correct are worthless.

## Model

- **Primary**: `Marco-Mini-Instruct-KEXP.gguf` (6,385,238,848 B, arch qwen3moe — the
  KEXP recipe artifact used in the 740/750 comparators).
- **Upload gate**: measure throughput on the first ~500 MB of the push through the QDC
  tunnel; if the projected total upload exceeds **45 min**, declare the primary
  VOID-before-start (no numbers taken) and fall back to `q63_c1_preserved.gguf`
  (3,098,664,160 B, arch qwen35) under an AMENDMENT written before any measurement.
  The fallback answers the same A-vs-C question for a different MoE arch and is
  labeled as such — it is NOT a KEXP datapoint.

## Method (fixed)

- Kit: `~/kalsa-qdc/bin-gov-5c3979438-stripped` (`llama-bench`, libomp.so pushed,
  SHA256SUMS verified on device before running). adb via SSH tunnel local port 6037
  ONLY (`ANDROID_ADB_SERVER_PORT=6037`, never 5037).
- Arms, exact commands (recorded verbatim in the report):
  - A: `llama-bench -m <model> -ngl 99 -p 512 -n 128 -r 3`
  - C: `llama-bench -m <model> -ngl 0  -p 512 -n 128 -r 3`
- Block order **ABBA**: A C C A. One block = one full llama-bench invocation per arm.
- Thermal gate per AMENDMENT-1 of cell #38 (BINDING): before each arm invocation, read
  `Current temperatures from HAL:` + `Thermal Status:` (never the frozen
  `Cached temperatures:` group); proceed only with skin/SoC ≤ 60 °C and status ≤ 1,
  else cooldown. Snapshots saved before/after every invocation.
- Real exit codes: every run `> file 2>&1; echo $?` — never trust a pipe's status.
- Long runs detached on-device via `nohup sh -c ... &` (adb shell children die with the
  parent's timeout).

## Decision rule (written before the numbers)

- Per phase (pp512 = prefill, tg128 = decode), compare the **median of the medians of
  the two blocks** per arm.
- An arm **wins a phase** if its median is ≥ **5%** above the other arm's; below 5%
  the phase is a **TIE**. No composite score; the two phases are reported separately.
- A crash/abort in any invocation banks that arm's block as FAILED with the log tail;
  the cell still banks whatever completed, honestly labeled.
- Thermal-gate violations that cannot be cleared within 15 min of cooldown → the
  remaining blocks are declared NOT RUN (never silently dropped).

## What this cell cannot say

- Nothing about the governor (arm G) — that is cell #38's story; a governor-on-MoE
  cell needs its own prereg.
- Nothing about half-offload (banked MAI on 740/750; not re-litigated here).
- Nothing about the 740/750 (already banked, different compilers).
- Nothing about thermals under sustained load beyond what the gate snapshots record —
  the QDC rack's cooling is not a phone in a hand.
- Nothing about the shipped app (these are bare llama-bench numbers).
