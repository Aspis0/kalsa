# PREREG — governor v0 cross-backend on Snapdragon 8 Elite (QDC)

Written BEFORE any measurement of this cell, as required. Locked at moe-experiments
commit: **ff2cb3b7**. Engine commit to be pinned at run time (must contain the
device-per-context flag; ≥ 1bfd144a2 on `kalsa/governor-v0`) and recorded in the report
with its sha and the kit SHA256SUMS.

## The question

Does per-phase backend routing — prefill on the GPU (OpenCL/Adreno 830), decode on the
CPU, one process, KV owned above the backends — beat both single-backend arms on a
Snapdragon 8 Elite, for the shipping model LFM2.5-2.6B QAD-Q4_0?

The smoke of 2026-08-29 (`../governor-v0/step8-qdc/SMOKE.md`, NOT a cell) measured the
two arms separately: prefill 383.3 t/s GPU vs 42.9 CPU; decode 28.09 CPU vs 26.25 GPU.
This cell measures the THIRD thing, which no arm has ever measured: the governor itself,
paying real commit costs across a backend boundary.

## Arms (fixed here, no additions after the fact)

- **A — GPU only**: one context, ngl=99, OpenCL. prefill + decode.
- **C — CPU only**: one context, ngl=0, repack. prefill + decode. (Arm names kept
  consistent with the campaign: A=GPU, B=half-offload BANNED, C=CPU.)
- **G — governor**: ctx_prefill ngl=99/OpenCL + ctx_decode ngl=0/CPU, commits both
  directions, staged-V on the GPU→host path.

Order: A, C, G, then C, G, A (reversed) — ABBA-style against drift. Two blocks.

## Metrics and the decision rule (written before the numbers)

Primary, per turn of a 3-turn conversation (prompt 512 tokens, generate 128):
1. **TTFT** = time to first sampled token.
2. **decode t/s** = tokens 2..128 wall rate.
3. **commit_ms** and **commit_bytes** from `llama_governor_stats` (G only).

G WINS iff, on the medians of both blocks:
- `TTFT(G) ≤ TTFT(C) × 0.5` (the GPU prefill advantage must survive the handoff), AND
- `decode_t/s(G) ≥ decode_t/s(C) × 0.95` (decode must stay CPU-grade), AND
- `commit_ms / prefill_ms < 2%` (plan §5 gate).

G LOSES if any of the three fails. A partial result is reported as such — no
re-definition of the rule after seeing numbers. If G fails only the third condition,
that is a "works but pays too much" verdict, reported with the measured ratio.

## Controls and abort conditions

- Screen state, wifi/BT: rack defaults, recorded from `dumpsys`.
- **Thermal**: read from `thermalservice` ONLY (the rack's battery service is frozen —
  erratum from bank #37). Record CPU/GPU temps before and after every run. ABORT the
  block if the pre-run temperature of any run exceeds the first run's by >8 °C.
- `r=3` per measurement, medians reported, all raw values kept.
- Same GGUF file (sha recorded), same prompts, greedy, n_threads fixed and recorded.
- Session minutes: cap 60, recorded start/end; if the session dies mid-block the block
  is VOID and re-run whole — no stitching across sessions.

## What this cell cannot say

- Nothing about Adreno 740 / the S23 (different GPU generation — standing rule).
- Nothing about thermals in a phone chassis: this is a rack QRD.
- Nothing about the app: this is llama.cpp-level, no React Native, no app KV pool.
- Nothing about KEXP-class 8B models unless a separate arm is added with its own prereg.
