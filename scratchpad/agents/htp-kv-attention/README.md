# htp-kv-attention — bare-bench driver

Answers: does in-app NPU prefill run slowly because `no_kv_offload` puts the
KV store in host memory and pins every attention node to the CPU
(src/llama-graph.cpp:2746, the app's q4_0 V cache cannot be written by HTP
SET_ROWS)? Kit: `~/kalsa-qdc/kit-5b596ce43` (see its PROVENANCE.txt).

## Usage (never run while charging; the driver gates enforce it)

    # QDC tunnel (QRD board; heat gates only):
    python3 run_bench.py --adb-port 6037 --dsp-arch v75 --stage all
    # Galaxy S23 (SM8550, Hexagon v73):
    python3 run_bench.py --serial R3CW406P8CV --dsp-arch v73 --stage all
    # owner's Xiaomi 14 (SM8650, v75) — daily driver with a PIN:
    python3 run_bench.py --serial <xiaomi-serial> --dsp-arch v75 \
        --personal-device --stage all

Stages: `stage` (push + on-device sha verify), `run` (the matrix + profiled
repeats), `pull` (remote listing), `cleanup` (rm -rf the device dir), `all`
(the four in one process). On `--personal-device` cleanup also runs in a
finally block at the end of EVERY invocation — failure, Ctrl-C included — so
single-stage runs cannot hand a staged dir to the next process; use `all`.
The guard accepts only read-only probes (dumpsys/getprop/settings get/
printf/grep/df), the wake keyevent 224, and commands whose absolute paths
stay inside the bench dir; it checks >= 5 GB free on /data before staging.

`--dry-run` prints every adb command and the gate list, touches no device.
`--deadline-minutes` (default 55) stops the run stage cleanly; the driver
prints its estimated device minutes at start.

## Per-arm flow: route proof, then clean timing

Each arm runs twice, both times behind the same gates (gates.py: before the
run, live at 10 s samples, and a thermal after-snapshot):

1. `*-route`: short verbose run (depth 0, r 1, `-v` +
   `GGML_HEXAGON_VERBOSE=1`) whose log must show `HTP0 model buffer size`,
   `HTP0 execute-op`, the arch's skel, and the KV buffer on the arm's side
   (`HTP0 KV buffer size` for B-offload, `CPU KV buffer size` for A/C).
2. `*-clean`: the timing run, no `-v`, no verbose env. Only these rows go
   into `bench.tsv` (with device model, soc, battery %/°C and thermal status
   before/after per run); the route log only proves the HTP route.

At least 120 s cool-down between arms. A failed gate pauses and re-checks
every 60 s up to 30 min, then the run stops cleanly — no partial row is
counted. Phone gates before every llama-bench call on a `--serial` target:
on no charger (AC/USB/Wireless all false, parsed from the dumpsys battery
dump), battery >= 25 %, battery temp < 44 °C, Android Thermal Status < 3,
screen awake (woken only with `input keyevent 224`, never POWER/SLEEP, never
lock), and `persist.traced.enable` == 0 on the S23 (SM-S911x) only.

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
ops on HTP in B and absent (CPU) in A is the placement proof. Profile rows
never enter the TSV.

Output: `bench.tsv` plus raw logs under `logs/`.
