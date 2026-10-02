# htp-kv-attention — bare-bench driver

Answers: does in-app NPU prefill run slowly because `no_kv_offload` puts the
KV store in host memory and pins every attention node to the CPU
(src/llama-graph.cpp:2746, the app's q4_0 V cache cannot be written by HTP
SET_ROWS)? Kit: `~/kalsa-qdc/kit-5b596ce43` (see its PROVENANCE.txt).

## Usage (never run while charging; the driver gates enforce it)

    # QDC tunnel (QRD board; heat gates only):
    python3 run_bench.py --adb-port 6037 --dsp-arch v75 --stage all
    # Galaxy S23 (SM8550, Hexagon v73; owner rules: unplugged, awake,
    # traced off, thermal < 3):
    python3 run_bench.py --serial R3CW406P8CV --dsp-arch v73 --stage all

Stages: `stage` (push + on-device sha verify), `run` (the matrix + profiled
repeats), `pull` (remote listing), `cleanup` (rm -rf the device dir).
`--dry-run` prints every adb command and touches no device.
`--deadline-minutes` (default 55) stops the run stage cleanly; the driver
prints its estimated device minutes at start.

## Matrix (llama-bench, -dev HTP0 -ngl 99 -p 128 -n 0 -b 128 -ub 128, -d 0,512,1700,3100, -r 3, -t 5)

| arm | KV k/v | nkvo | meaning |
|---|---|---|---|
| A-nkvo | q8_0/q8_0 | 1 | KV on host -> attention on CPU (suspected app path) |
| B-offload | q8_0/q8_0 | 0 | KV on HTP -> attention on HTP |
| C-app-vq4 | q8_0/q4_0 | 1 | shipping app KV (ModelRegistry kvCache) |

All arms run `-fa auto`: that IS the app's setting (LlamaService.ts:2471
`flash_attn_type: "auto"`; the shipped q4_0 V cache means auto resolves to FA
on), so the conditional extra `-fa 1` arms (app FA off) do not apply.
After the matrix: one profiled repeat of A and B at depth 1700 with
`GGML_HEXAGON_PROFILE=1 GGML_SCHED_DEBUG=2`; the placement summary
(logs/<arm>-profile-placement.txt) counts per-op HTP executions — attention
ops on HTP in B and absent (CPU) in A is the placement proof.

Every run is gated on the route proof (`HTP0 model buffer size` +
`HTP0 execute-op` + the arch's skel loaded, as run_qdc.py checks) and the
device gates in gates.py. Output: `bench.tsv` (pp tok/s + per-chunk ms per
arm x depth) plus raw logs under `logs/`.
