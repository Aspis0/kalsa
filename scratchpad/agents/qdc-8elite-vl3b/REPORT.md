# REPORT — LFM2.5-VL-3B on Adreno 830: three-phase decision table (cell #42 candidate)

Prereg `6642824d` + pre-measurement AMENDMENT-1 `20f2a259` (both locked before
any device number). Session **793229** (created 22:46, Running ~22:58, ended
~23:12 local 30/08 — times from the QDC UI, not persisted; raw artifact mtimes
span the same window). Unit serial `eb49fb9d` — THIS time in
raw/provenance_793229.txt (ro.serialno; the #41 audit lesson), props
`qti/sun/sun:16/BQ2A.260305.002-...`, SoC SM8750, Android 16 (the QDC
catalog's Snapdragon 8 Elite / QRD8750 type). Kit vl-kit-556118a08
(llama-mtmd-cli from kalsallama kalsa/governor-v0 @ 556118a08, SHA256SUMS
3/3 OK on device). Models: LiquidAI official GGUF, sha256 device == local ==
published for both files (raw/model_sha_device_793229.txt vs
raw/model_sha_local.txt; text 83c18dfb…, mmproj 8ba27050…).

## Upload gate

PASS: 1,674,454,240 B in 85.6 s + 583,109,120 B in 29.7 s (both 18.7 MiB/s as
printed by adb; raw/model_push_793229.log) ≈ 2 min « 45 min.

## Runs (order C A M / M A C / A M C, 9/9 exit 0)

Fixed workload per prereg: test_image.jpg (sha 55e455a2…, on device via kit),
prompt "Describe the image in one sentence.", `-n 128 --temp 0 --seed 42
--ignore-eos -t 8`. Thermal gate live-HAL before EACH invocation: 18/18
snapshots (9 pre + 9 post) all GATE_PASS, max 46.5 °C, status 0 throughout —
no cooldowns needed; the VLM single-turn workload is thermally mild.

| run | encode_ms | eval_message_ms | prefill_ms (derived) | decode_ms | decode t/s | text sha (12) |
|-----|-----------|-----------------|----------------------|-----------|------------|----------------|
| C1 | 3856 | 9449.4 | 5593.4 | 4260.4 | 30.04 | 7ef972e97333 |
| A1 | 6558 | 7999.6 | 1441.6 | 5653.3 | 22.64 | 97022c5b3bc9 |
| M1 | 3923 | 5360.3 | 1437.3 | 5659.6 | 22.62 | 97022c5b3bc9 |
| M2 | 3927 | 5363.2 | 1436.2 | 5640.9 | 22.69 | 97022c5b3bc9 |
| A2 | 6547 | 7992.6 | 1445.6 | 5653.4 | 22.64 | 97022c5b3bc9 |
| C2 | 3915 | 9667.8 | 5752.8 | 4403.5 | 29.07 | 7ef972e97333 |
| A3 | 6549 | 7996.3 | 1447.3 | 5641.3 | 22.69 | 97022c5b3bc9 |
| M3 | 4007 | 5442.7 | 1435.7 | 5644.9 | 22.68 | 97022c5b3bc9 |
| C3 | 3960 | 9766.7 | 5806.7 | 4545.5 | 28.16 | 7ef972e97333 |

Medians per arm: **C** enc 3915 / prefill 5752.8 / 29.07 t/s; **A** enc 6549 /
prefill 1445.6 / 22.64 t/s; **M** enc 3927 / prefill 1436.2 / 22.68 t/s.

## Determinism probe (prereg)

Same-arm outputs are byte-identical in all 3×3 runs (one text hash per arm
group). A and M share the hash (same GPU text tower); C's text differs from
the GPU arms' (both descriptions are correct for the synthetic image; the
divergence is numeric-backend-dependent sampling at temp 0, REPORTED as
expected, no quality claim).

## Verdict per the pre-written rule (median of 3, ≥5% margin per phase)

- **Image encode (lower ms)**: best C 3915 vs runner-up M 3927 = 0.31% <5% →
  **tie C/M** (both run vision on CPU — the honest reading: CPU vision).
  A (GPU vision) = 6549 ms, **1.67× SLOWER than CPU**. GPU encode LOSES.
- **Prefill (lower ms, derived)**: best M 1436.2 vs runner-up A 1445.6 =
  0.65% <5% → **tie M/A** (both GPU text). C = 5752.8 → **GPU wins prefill
  4.0×**.
- **Decode (higher t/s)**: C 29.07 vs M 22.68 = **CPU wins decode 1.28×**
  (margin 28% ≥ 5%).

**Decision-table row (VL-3B, 830): vision encode → CPU; prefill → GPU (4.0×);
decode → CPU (1.28×).**

End-to-end sums of phase medians (REPORT-only, per prereg): C 14071 ms,
A 13648 ms, **M 11008 ms (best single arm)**; the hypothetical per-phase
composition (CPU encode + GPU prefill + CPU decode) = **9755 ms — 1.13× faster
than the best static arm**, 1.40× vs all-GPU, 1.44× vs all-CPU. No static arm
can reach it: M is forced to decode on GPU. This is the governor thesis
extended to a third phase — and the third model/workload where the optimal
routing differs (#38 2.6B: G wins; #41 8B: all-GPU; #42 VL-3B: three-way
split).

## Why GPU vision loses: the CLIP graph finding

A's warmup prints (vl_A_*.out, quoted):
`WARNING: the CLIP graph uses unsupported operators by the backend` with
`list of unsupported ops (backend=OpenCL):` — UPSCALE, SOFT_MAX (f32
[1024,1024,16]), CONT, PERMUTE, RESHAPE, and f32 MUL_MAT shapes from the
SigLIP2 tower, plus `flash attention not supported by OpenCL`. The vision
graph splits across CPU/GPU and the ping-pong makes GPU encode 1.67× slower
than pure CPU. This is a kernel-coverage gap of the OpenCL backend for CLIP
ops (f32, odd shapes) — a concrete, listed target if GPU vision ever matters.

## GPU evidence (deviation from the prereg clause, declared)

The prereg required `selected platform: 'QUALCOMM` in the run header. The
fork's mtmd-cli logger FILTERS the ggml_opencl banner (same mechanism as
governor-bench in cell #41 — zero perf/banner lines at any verbosity), so NO
vl_*.out contains it. Replacement evidence, all on disk:
1. A/M warmup lines naming `backend=OpenCL` and the OpenCL flash-attention
   warning — those prints exist only when the OpenCL backend is live (a
   /vendor/lib64-style init failure prints `platform IDs not available` and
   no such warnings; C runs contain none of these lines).
2. In-session probe raw/opencl_banner_probe_793229.txt: llama-bench (from the
   #41 kit) on the SAME unit with the SAME kit-only LD_LIBRARY_PATH prints
   `ggml_opencl: selected platform: 'QUALCOMM Snapdragon(TM)'` / Adreno 830.
3. The numbers: A/M prefill 1436–1447 ms vs C 5593–5807 ms (4×); a silent CPU
   fallback reproduces C (the #40 signature). Arm coherence is exact: M's
   encode matches C (CPU vision) while M's prefill/decode match A (GPU text).

## What this cell cannot say (prereg, binding)

Nothing about the app (no vision path); nothing about answer QUALITY beyond
the determinism probe (one image, one prompt); nothing about other GPU
generations; nothing about sustained thermals; nothing about the NPU; nothing
about multi-image/long multimodal chats.

Pending: hostile audit before registry/ALIVE entry.
