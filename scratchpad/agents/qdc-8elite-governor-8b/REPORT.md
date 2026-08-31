# REPORT — Governor v0 on LFM2.5-8B-A1B (lfm2moe) — Adreno 830 (cell #41 candidate)

Prereg `166f9ccf` (locked before any measurement). Session **793164** (queued
~2h against the pool marked "Unavailable"; ran 30/08 evening — start/end times
and ~49 min used are from the QDC UI, not persisted in raw/; raw artifact
mtimes span 19:26–19:59). Unit serial `b4bd0901` (from `adb devices` over the
session tunnel — the getprop capture omitted the serial, so it is NOT in
raw/provenance_793164.txt; see raw/COMMANDS_793164.md), props
`qti/sun/sun:16/BQ2A.260305.002-...` (raw/provenance_793164.txt), SoC model SM8750, Android 16 — the QDC catalog's
"Snapdragon 8 Elite / QRD8750" device type (catalog name from the QDC UI).
Kit gov-kit-5c3979438 (SHA256SUMS verified on device: 12/12 OK, 0 failures —
terminal capture in raw/kit_sha_verify_793164.txt; independent on-disk anchor:
every turn line prints build_commit=5c3979438).
Model: LFM2.5-8B-A1B-Q4_K_M.gguf as lfm8b.gguf, sha256 `4923ec14...2bb0`
identical local (raw/model_sha_local.txt) and on-device
(raw/model_sha_device_793164.txt).

## Upload gate (prereg §Upload gate)

PASS: 5,155,564,768 bytes in 206.9 s = 24.9 MB/s decimal (adb prints
"23.8 MB/s" but computes MiB/s; raw/model_push_793164.log), ≈3.5 min « 45 min
limit. No fallback needed.

## Runs (order A C C A G G, one governor-bench invocation each, r=3)

Commands exactly as preregistered (`--arm X -m lfm8b.gguf -r 3`; exact
command lines and orchestration scripts archived in raw/COMMANDS_793164.md,
raw/run_gov_793164.sh, raw/drive_one_793164.sh; binary
defaults: 3 turns × 512 prompt + 128 generated, seed 1234, n_ubatch 512,
n_threads=1 as printed by the binary — identical method to cell #38).
LD_LIBRARY_PATH = kit dir only. Every invocation: live-HAL thermal gate before
(all 6 GATE_PASS), snapshot after, exit code preserved (raw/gov_*_793164.exit,
all `0`). The `summary=median` line of each invocation:

| run | arm | ttft_ms | decode_tps | prefill_ms | commit_ms | commit % of prefill |
|-----|-----|---------|------------|------------|-----------|---------------------|
| 1 | A (GPU) | 2517.7 | 28.20 | 2513.9 | — | — |
| 2 | C (CPU) | 25122.6 | 13.95 | 25122.2 | — | — |
| 3 | C (CPU) | 26134.1 | 13.46 | 26133.6 | — | — |
| 4 | A (GPU) | 2518.8 | 28.37 | 2515.0 | — | — |
| 5 | G (gov) | 2495.8 | 13.32 | 2491.9 | 22.15 | 0.89% |
| 6 | G (gov) | 2496.1 | 13.33 | 2492.2 | 20.77 | 0.83% |

Backends as printed per turn: A = GPUOpenCL/GPUOpenCL, C = CPU/CPU,
G = GPUOpenCL prefill / CPU decode. G's commit: commit_bytes=8,454,144
(~8.06 MiB), commit_naive_count=1, commit_staged_count=1 (both invocations,
summary line). Per-turn: the first turn of each rep commits staged-only
6,586,368 B (~6.28 MiB, naive_count=0); later turns 8,454,144 B.

### Thermal record (max HAL °C / Thermal Status, raw/therm_{pre,post}_*)

pre A1 42.0/0 → post 42.0/0; pre C1 42.0/0 → post 48.2/0; pre C2 45.9/0 →
post 52.1/1; pre A2 50.5/1 (PASS: status ≤1) → post 52.9/2; pre G1 46.7/0 →
post 53.2/2; pre G2 46.9/0 → post 52.9/2. After A2 and G1 the gate was
re-probed once per minute and re-passed within 1 min (47.1/0 and 47.5/0 —
raw/therm_reprobe_preG1_793164.txt and _preG2_; the status-2 excursions decay
fast). No cooldown exceeded the
prereg's 15-min limit; nothing was dropped. Post-run status-2 snapshots are
disclosed, not gate violations (the binding gate is pre-invocation).

## Backend evidence (the #40 lesson, applied)

governor-bench swallows the ggml loader banner (its .out files carry only
progress dots + structured lines), so the `selected platform:` header check
cannot be applied to gov_*.out. GPU execution evidence is instead:
1. **Structural fail-fast**: arms A/G abort non-zero if the requested non-CPU
   backend resolves CPU-only (prereg §Method). All exits are 0.
2. **Direct probe on the same unit, same env**: raw/opencl_banner_probe_793164.txt
   — a minimal llama-bench (`-p 16 -n 4 -r 1 -ngl 99`, LD_LIBRARY_PATH=kit dir)
   run in-session prints `ggml_opencl: selected platform: 'QUALCOMM
   Snapdragon(TM)'` / `device: 'QUALCOMM Adreno(TM) 830'`.
3. **The numbers themselves**: A/G prefill 2.49–2.52 s vs C 25.1–26.1 s (10×);
   a silent CPU fallback reproduces C's numbers (that was exactly the #40 VOID
   signature).

## Verdict per the pre-written decision rule

- **Prefill**: ttft(G) = 2495.8 / 2496.1 ms. Bar 1: ≤ 1.15 × ttft(A)
  (= 2895.4 / 2896.6) ✓. Bar 2: ≤ 0.5 × ttft(C) (= 12561.3 / 13067.0) ✓.
  G is in fact marginally FASTER than A. → **keeps the GPU prefill**.
- **Decode**: decode_tps(G) = 13.32 / 13.33. Bar: ≥ 0.95 × decode_tps(C);
  tightest pairing G1-vs-C1: 13.318 ≥ 13.249 ✓ (0.955 × C); all other
  pairings pass with more margin. → **keeps the CPU decode**.
- **Commit (characterization)**: 0.89% / 0.83% of prefill → band "≤3%: scales
  cleanly". BETTER than the #38 reference (~1.9% on the 2.6B): the KV commit
  does NOT grow faster than prefill at 3× model size — on this hybrid family
  it shrinks relative to prefill (only 6 of 24 blocks are attention; commit
  ~8.06 MiB). Both KV paths exercised (naive 1 / staged 1 per summary).
- **Overall: G = WIN** per the prereg rule (both conditions hold in every
  block pairing).

## The honest co-headline (do not quote the WIN without this)

On this model/unit at the fixed workload, **arm A is the best single arm
overall**: ttft within 1% of G (G marginally faster: 2495.8–2496.1 vs
2517.7–2518.8 ms) and 2.0–2.1× the decode (2.02–2.11 per pairing; A 28.2–28.4
vs G/C 13.3–13.9 tps). The prereg conditions test whether
G *keeps* GPU-class prefill and CPU-class decode — they do not test "beats A",
and here it does not: on lfm2moe-8B/830 the best single arm is all-GPU. Read
with #38 (2.6B: G beats BOTH arms) and #40 (KEXP: CPU wins decode), this is
evidence FOR per-device, per-model routing — the phase split that wins on the
2.6B is not the right routing for the 8B on this GPU — and evidence AGAINST a
hardcoded GPU-prefill/CPU-decode policy. A governor whose router can choose
GPU for both phases would pick A here; v0's mechanism (cross-backend commit at
0.83–0.89%) is cheap enough to permit either choice.

Caveat bound to the method: C (and G's decode) ran at the binary's default
n_threads=1, same as #38. This cell cannot say what multi-threaded CPU decode
would do; "A beats C decode 2.0–2.1×" holds for THIS fixed workload only.

## What this cell cannot say (prereg, binding)

Nothing about the 2.6B ship model beyond citing #38; nothing about KEXP/
qwen3moe (#40); nothing about the 740/750; nothing about sustained-load
thermals beyond the gate snapshots; nothing about accuracy/quality.

Pending: hostile audit before registry/ALIVE entry.
