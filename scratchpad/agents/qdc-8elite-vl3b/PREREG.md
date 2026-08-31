# PREREG — LFM2.5-VL-3B on Adreno 830: first VLM cell (per-phase decision table)

Written BEFORE any measurement. The commit hash of this file is the lock id.
No number below has been measured at lock time.

## The question

The shipping model's own vision variant (LFM2.5-VL-3B = LFM2.5-2.6B backbone +
SigLIP2 NaFlex 400M encoder, released 2026-08-12) has NEVER been run by this
project — it is one of the four parked worries. Two questions:

1. **Does it run at all on the 830 with OUR engine** (kalsallama @ 5c3979438,
   which contains the LFM2 projector and the upstream tiling fix 262364e31)?
2. **The per-phase decision table, extended to a third phase.** A VLM turn has
   THREE phases: image encode (vision tower via mmproj), prefill, decode.
   Where does each belong on the 830? This feeds the governor design directly
   (#38/#40/#41 proved routing is per-device AND per-model; a VLM adds
   per-PHASE-KIND).

## Materials (fixed)

- Tool: `llama-mtmd-cli` built from kalsallama `kalsa/governor-v0` @ 5c3979438
  (same commit as the #38/#41 kit; BUILD_NOTE flags identical, GGML_OPENCL=ON,
  Adreno kernels ON), llvm-strip'd, + libomp.so. LD_LIBRARY_PATH = kit dir
  ONLY (never /vendor/lib64 — the #40 trap).
- Model: `LiquidAI/LFM2.5-VL-3B-GGUF` official files:
  - `LFM2.5-VL-3B-Q4_K_M.gguf`, published sha256
    `83c18dfba02c75769cdd63f73e37c343400e82d434ff1b14bcc1cb02fcf2f5f2`
  - `mmproj-LFM2.5-VL-3B-Q8_0.gguf`, published sha256
    `8ba27050dc88737db66b856d3b74e0e6cf54bee35fa4d9d9808f69ee556bbd43`
  Gate: local sha == published sha, device sha == local sha, else VOID.
  License: LFM Open License v1.0 (fine for us).
- Image: `test_image.jpg`, deterministic synthetic 768x512 (gradient + red
  circle + blue square + dark bars), sha256
  `55e455a2dd398de36564527368eb4a7f8e3f27d6b50d0d00e42c83baa6cf4c04`.
  Archived in raw/ before the session.
- Prompt: `Describe the image in one sentence.` Generation: `-n 128 --temp 0
  --seed 42 --simple-io`. Threads: `-t 8` (CPU's best case per #37; if CPU
  loses at -t 8 it really loses). Everything else binary defaults.

## Arms (each invocation = one llama-mtmd-cli run, `> file 2>&1; echo $? > .exit`)

- **C (all-CPU)**: `-ngl 0 --no-mmproj-offload`
- **A (all-GPU)**: `-ngl 99` (mmproj offload left at its default = offloaded)
- **M (mixed)**: `-ngl 99 --no-mmproj-offload` (text tower GPU, vision CPU)

Order: **C A M / M A C / A M C** (3 invocations per arm, every arm appears
once per block, position-balanced). Thermal gate per AMENDMENT-1 (#38),
BINDING, before EACH invocation: live `Current temperatures from HAL:` +
`Thermal Status`, proceed only if max <= 60.0 C and status <= 1, else cooldown;
not cleared within 15 min -> remaining invocations NOT RUN (never dropped
silently). Snapshot after each invocation.

## Metrics (parsed from each run's stderr, quoted verbatim in REPORT)

1. **encode_ms** — the mtmd "image ... encoded in ... ms" line (vision tower).
2. **prefill** — `prompt eval time` line (ms and t/s; NOTE: includes image
   embedding tokens + text prompt, declared as such).
3. **decode** — `eval time` line (t/s over the 128 generated tokens).
4. **load time** and peak-visible memory lines: REPORTED, not gated.
5. **Determinism probe**: sha256 of the generated text per run. Same-arm runs
   SHOULD match exactly (temp 0, fixed seed); cross-arm divergence is REPORTED
   as a finding, never averaged away. This is a smoke correctness probe, not a
   quality claim.

## GPU evidence (binding, the #40 lesson)

For A and M: the run header MUST contain `selected platform: 'QUALCOMM` (
mtmd-cli prints the ggml_opencl banner). A run without it is NOT a GPU run
regardless of flags. For A additionally: the log must show the mmproj/clip
placed on the GPU backend; if mmproj offload silently falls back to CPU, A is
re-labeled "A-degraded" and the fact is a REPORTED finding (mtmd GPU clip
support on Adreno is exactly what this cell probes).

## Decision rule (written before the numbers)

Per arm and phase: **median of the 3 invocations**. A phase has a winner iff
the best arm beats the runner-up by **>= 5%** on that phase's metric (encode:
lower ms; prefill: higher t/s; decode: higher t/s). Output: one decision-table
row per phase for "VL-3B on 830". Additionally REPORT (no pass/fail): the
hypothetical best per-phase composition vs the best single arm end-to-end
(sum of phase medians), as governor-design input.

Any invocation with non-zero exit banks that arm's invocation as FAILED with
the log tail; the cell banks whatever completed. If BOTH A invocations of a
phase fail on GPU init, the cell still banks C (question 1 answered "runs on
CPU"). If the model fails to load anywhere -> honest VOID with logs.

## Upload gate

~2.26 GB total (model+mmproj+kit) at the ~22 MiB/s measured twice -> ~2 min.
If a live probe projects the push > 45 min, VOID-before-start.

## What this cell cannot say (binding)

Nothing about the app (it has no vision path yet); nothing about answer
QUALITY (one image, one prompt, a determinism probe only); nothing about other
GPU generations (830 only, per the never-transfer rule); nothing about
sustained thermals beyond the gate snapshots; nothing about the NPU; nothing
about long-context multimodal chats (single image, single turn).
