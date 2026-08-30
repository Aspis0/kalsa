# REPORT — KEXP speed decision table on Adreno 830 (cell #40 candidate)

Prereg `3af32c18` (locked before any measurement; parent commit 14909190).
Sessions: 792778 (VOID, see below) and **792790** (the cell). Device is the QDC
catalog's "Snapdragon 8 Elite / QRD8750" (that catalog name comes from the QDC UI,
not from device props); the unit's own props report arch `sun`, serial `41c5710f`
(raw/provenance_792790.txt: `qti/sun/sun:16/BQ2A.260305.002-BP2A.250705.008/...`),
Android 16. (The SoC model string SM8750 was read on the VOID unit,
raw/provenance.txt line 2; both units are the same QDC device type.)
Kit bin-gov-5c3979438-stripped (SHA256SUMS verified on the Mac; on-device extract
from the same tarball). Model: Marco-Mini-Instruct-KEXP.gguf, sha256
`2f921958...4777` identical local (raw/model_sha_local.txt) and on-device
(raw/model_sha_device_792790.txt). llama-bench reports it as qwen3moe, 17.25B,
Q4_K Medium, 5.94 GiB.

## Upload gate (prereg §Model)

PASS with wide margin. The interim rate probe (raw/upload_gate.txt: 22 MiB/s at
~355 MiB) is from the FIRST (VOID) session's push and is kept only as the
method check; the CELL's own push is raw/model_push_792790.log: 6385238848 bytes
in 273 s = 22.3 MiB/s, projected ≈5 min « 45 min limit → primary model used, no
fallback. The two pushes ran at ~22.3 and ~23.1 MB/s (VOID); the gate is satisfied by the
cell's own log independently.

## Runs (ABBA: A C C A, one llama-bench invocation each, r=3)

Commands exactly as preregistered, executed by run_cell.sh on device
(`-p 512 -n 128 -r 3`; A = `-ngl 99`, C = `-ngl 0`). Every invocation:
live-HAL thermal gate before (all GATE_PASS, max HAL temp 42 °C, status 0
— raw/therm_pre_*_792790.txt), snapshot after (raw/therm_post_*_792790.txt: max
42/42/42/44 °C, status 0),
exit code preserved as artifact (raw/bench_*_792790.exit, all `0`).

| run | arm | pp512 t/s | tg128 t/s | exit |
|-----|-----|-----------|-----------|------|
| 1 | A (GPU) | 274.24 ± 0.72 | 48.83 ± 0.23 | 0 |
| 2 | C (CPU) | 107.84 ± 0.66 | 61.16 ± 0.45 | 0 |
| 3 | C (CPU) | 107.00 ± 1.12 | 60.26 ± 0.59 | 0 |
| 4 | A (GPU) | 274.83 ± 0.45 | 48.88 ± 0.04 | 0 |

A1's header shows `ggml_opencl: selected platform: 'QUALCOMM Snapdragon(TM)'`
and `device: 'QUALCOMM Adreno(TM) 830 ...'` (raw/bench_A_b1_792790.out) — the GPU
really ran (see the VOID note for why this check is load-bearing). The driver's
Compiler string (E031.47.18.47) was captured in the standalone OpenCL probe,
recorded in raw/opencl_init_failure_792778.txt, not in the bench .out headers.

## Verdict per the pre-written rule (median of block medians, ≥5% wins)

- **Prefill (pp512): A WINS — 274.5 vs 107.4 t/s = 2.56×** (far above the 5%
  threshold). Extends the 750 finding (A = 2.21× prefill) to the 830, slightly
  amplified.
- **Decode (tg128): C WINS — 60.7 vs 48.9 t/s = 1.24×** (above threshold).
  The 750's "A ≈ C decode" resolves clearly in CPU's favor on the 830.

Decision-table row for the 830, KEXP-class MoE: **GPU for prefill (2.56×),
CPU for decode (1.24×)** — the exact split the per-phase governor exploits.
Three generations now measured: 740 C-always → 750 A-prefill/tie-decode →
830 A-prefill/C-decode, each re-measured, none transferred.

## VOID session 792778 (honest note)

The first session's arm-A run is VOID and its unit was likely healthy: our
runner put `/vendor/lib64` in LD_LIBRARY_PATH, which bypasses the sphal linker
namespace, so the Adreno driver's internal dlopen of libCB.so failed
("platform IDs not available") and llama-bench SILENTLY ran on CPU while
printing `backend OpenCL, ngl 99` with exit 0 — its numbers (pp 108.29,
tg 61.14) match arm C of the real cell, confirming the fallback. Full
chronology, logcat root cause, and the correction of my initial wrong
"broken unit image" diagnosis: raw/opencl_init_failure_792778.txt and
raw/bench_A_b1.out (negative exhibit). Session cost ~30 min. Operating rule
for every future OpenCL run: LD_LIBRARY_PATH = kit dir ONLY, and a run whose
header lacks `selected platform: 'QUALCOMM` is not a GPU run regardless of
what the results table claims.

## What this cell cannot say (prereg, binding)

Nothing about the governor arm (cell #38's story), half-offload, the 740/750
(already banked), sustained-load thermals beyond the gate snapshots, or the
shipped app.

Pending: hostile audit before registry/ALIVE entry.
