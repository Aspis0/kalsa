# S23 f25-v75 kit control — 2026-09-29

Device: Galaxy S23 (`adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`). Kit engine `f25f0c1c5` (coordinator-specified); the static binaries were installed only in `/data/local/tmp/f25kit/`, using the v73 skel. OpenCL resolved to the system Qualcomm library. Model was read from `/data/local/tmp/heat3way/ship.gguf`.

## Kit and dispatch verification

- Model SHA256: `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03` (matches requested model).
- `llama-bench` SHA256: `69bfd8b5bf404b915168eaea06e3378c4bc3a9edda6f401c70dd121bc9814a45`.
- `llama-completion` SHA256: `00231d789329514d97b8742aac8cc1ae20e5481ad52bde4b506336cea7661d49`.
- v73 skel SHA256: `dbea4e6a5f3639703eb19b6e3e737a0e28685e44c7863ce06ae7efc3012cece5`.
- Both `--list-devices` outputs list `GPUOpenCL` and `HTP0`; they do not list CPU. The CPU runs use the built-in default (`-dev none -ngl 0`), confirmed by the `none` backend rows below. Bench device listing reports `Hexagon Arch version v73`.
- HTP dispatch proof, `arms/B-htp-dispatch-proof.log:10`: `ggml-hex: Hexagon Arch version v73`. Line 279: `ggml-hex: HTP0 new session : session-id 0 domain-id 3 uri file:///libggml-htp-v73.so?htp_iface_skel_handle_invoke&_modver=1.0&_dom=cdsp&_session=0 handle 0xb4000076139b1e20`.
- Same proof, line 16459: `ggml-hex: HTP0 execute-op MUL_MAT|blk.0.shortconv.in_proj.weight x model.layers.{}.operator_norm-0 (reshaped) -> model.layers.{}.conv.in_proj-0|2048:6144 x 2048:1 -> 6144:1|q4_0 x f32 -> f32|18:1152 x 4:8192 -> 4:24576|HTP0 x HTP0 -> HTP0|hvx-tiled vtcm 2727936|flags 0x0`.
- GPU/HTP buffer proofs: `BPROOF-gpu-1.log:131`: `0.01.206.310 I load_tensors:       OpenCL model buffer size =  1307.20 MiB`; `BPROOF-npu-1.log:132`: `0.00.761.471 I load_tensors:         HTP0 model buffer size =  1525.87 MiB`.

## A — three-way prefill + 126-token decode

Order `CPU,GPU,HTP,HTP,GPU,CPU`; prompt 1010 tokens, 126 decode runs, `-t 5`, two reps per backend. Old-kit values below are the coordinator-supplied S23 references. Each new result is quoted from its completion log; all six measured tool exits were 0 (`arms/results.tsv`).

**CPU — old prefill 10,389 ms (warm).**

`A-cpu-1790659110.log`

> `0.29.134.582 I common_perf_print: prompt eval time =   19710.51 ms /  1010 tokens (   19.52 ms per token,    51.24 tokens per second)`
>
> `0.29.134.584 I common_perf_print:        eval time =    6032.95 ms /   126 runs   (   47.88 ms per token,    20.89 tokens per second)`

`A-cpu-1790659559.log`

> `0.19.419.467 I common_perf_print: prompt eval time =   10640.55 ms /  1010 tokens (   10.54 ms per token,    94.92 tokens per second)`
>
> `0.19.419.468 I common_perf_print:        eval time =    6171.14 ms /   126 runs   (   48.98 ms per token,    20.42 tokens per second)`

**GPU — old prefill 7,326 ms.**

`A-gpu-1790659209.log`

> `0.23.571.945 I common_perf_print: prompt eval time =    7318.56 ms /  1010 tokens (    7.25 ms per token,   138.01 tokens per second)`
>
> `0.23.571.949 I common_perf_print:        eval time =    9845.14 ms /   126 runs   (   78.14 ms per token,    12.80 tokens per second)`

`A-gpu-1790659468.log`

> `0.24.151.914 I common_perf_print: prompt eval time =    7318.10 ms /  1010 tokens (    7.25 ms per token,   138.01 tokens per second)`
>
> `0.24.151.924 I common_perf_print:        eval time =   10139.76 ms /   126 runs   (   80.47 ms per token,    12.43 tokens per second)`

**HTP/NPU — old prefill 1,558 ms.**

`A-npu-1790659301.log`

> `0.14.053.784 I common_perf_print: prompt eval time =    1532.70 ms /  1010 tokens (    1.52 ms per token,   658.97 tokens per second)`
>
> `0.14.053.790 I common_perf_print:        eval time =    8380.23 ms /   126 runs   (   66.51 ms per token,    15.04 tokens per second)`

`A-npu-1790659383.log`

> `0.14.112.459 I common_perf_print: prompt eval time =    1568.71 ms /  1010 tokens (    1.55 ms per token,   643.84 tokens per second)`
>
> `0.14.112.466 I common_perf_print:        eval time =    8309.86 ms /   126 runs   (   65.95 ms per token,    15.16 tokens per second)`

## B — nine-arm `llama-bench -p 0 -n 256` decode repeat

Order `CPU,GPU,HTP,GPU,HTP,CPU,HTP,CPU,GPU`. Coordinator-supplied old-kit references: CPU ~22.3, GPU ~13.9, HTP ~22.1 tok/s. New-kit results, with each measured row quoted verbatim from its arm log (`± 0.00` as printed):

- CPU: `B-cpu-1.log` — `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |   0 |       5 |   1 | none         |           tg256 |         14.89 ± 0.00 |`
- GPU: `B-gpu-1.log` — `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |  99 |       5 |   1 | GPUOpenCL    |           tg256 |         13.41 ± 0.00 |`
- HTP: `B-npu-1.log` — `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |  99 |       5 |   1 | HTP0         |           tg256 |         21.96 ± 0.00 |`
- GPU: `B-gpu-2.log` — `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |  99 |       5 |   1 | GPUOpenCL    |           tg256 |         13.79 ± 0.00 |`
- HTP: `B-npu-2.log` — `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |  99 |       5 |   1 | HTP0         |           tg256 |         22.33 ± 0.00 |`
- CPU: `B-cpu-2.log` — `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |   0 |       5 |   1 | none         |           tg256 |         10.95 ± 0.00 |`
- HTP: `B-npu-3.log` — `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |  99 |       5 |   1 | HTP0         |           tg256 |         22.12 ± 0.00 |`
- CPU: `B-cpu-3.log` — `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |   0 |       5 |   1 | none         |           tg256 |         21.28 ± 0.00 |`
- GPU: `B-gpu-3.log` — `| lfm2 2.6B Q4_0                 |   1.48 GiB |     2.70 B | OpenCL,HTP |  99 |       5 |   1 | GPUOpenCL    |           tg256 |         12.12 ± 0.00 |`

Derived medians/ranges are in `analysis/metrics.log` and per-arm details in `analysis/decode-arm-summary.tsv`. The exact summary lines are:

> `B_GROUP cpu rate median=14.8900 min=10.9500 max=21.2800`
>
> `B_GROUP gpu rate median=13.4100 min=12.1200 max=13.7900`
>
> `B_GROUP npu rate median=22.1200 min=21.9600 max=22.3300`

CPU varied substantially across its three positions. Temperature area/token (same trapezoid method as the archived report), battery then skin; per-arm ranges and sample-line provenance are in `analysis/decode-temperature-evidence.tsv`:

> `B_GROUP cpu battery_cs_per_token median=0.2103 min=0.2046 max=0.2774`
>
> `B_GROUP cpu skin_cs_per_token median=0.3134 min=0.2315 max=0.3302`
>
> `B_GROUP gpu battery_cs_per_token median=0.4288 min=0.3918 max=0.4394`
>
> `B_GROUP gpu skin_cs_per_token median=0.4223 min=0.3959 max=0.4475`
>
> `B_GROUP npu battery_cs_per_token median=0.1342 min=0.0474 max=0.1530`
>
> `B_GROUP npu skin_cs_per_token median=0.1186 min=0.0898 max=0.1412`

## Gates, temperature, and artifacts

- All 28 final proof/measured invocations have actual `adb_exit=0`, `tool_exit=0`, `proof=PASS` in `arms/results.tsv`. The 56 pre-arm snapshots and 28 post-arm snapshots all pass in `device-out/gates.tsv`. AC, USB, and wireless remained false; screen stayed ON and awake; `persist.traced.enable` was 0; the app was force-stopped before each arm. `-lm none` was used for completion.
- Sampling (`analysis/metrics.log`):

> `SAMPLES count=993 cadence_median_s=1.416 cadence_max_s=1.747 cadence_p95_s=1.511`
>
> `B_WINDOW samples=552 cadence_median_s=1.432 cadence_max_s=1.747 cadence_p95_s=1.517`

This is the measured cadence; the sampler was slower than the nominal fast cadence.
- Sample TSV fields start `epoch_ns, battery_dC, level, status, skin_C, hal_bat_C`. Peak battery was 38.8 C (line 954: `1790660361247465060  388  74  1 ...`); peak skin was 38.6 C (line 957: `1790660365693247558  388  74  1  38.6 ...`); max thermal status was 1 (line 950: `1790660355565442250  366  74  1 ...`). The final gate was unplugged, level 74, battery 37.3 C, thermal status 1, awake, display ON, traced 0, and app PID empty (`host/final_gate.log`). Neither stop threshold was reached.
- Setup-only aborts/proof retries are retained in `attempts/`; they produced no timed measurements. An initial preflight stopped when CPU was absent from the device listing; CPU was then verified as the built-in default. One proof invocation initially used the wrong working directory and exited 127; a later proof-only parser check exited 0 but its host parser did not recognize an exit field. These were corrected before the successful measured run; no timed result was dropped or substituted.
- Raw logs, gate records, sampler output, hashes, and controller scripts are all under `/tmp/s23-f25kit/`. No lab repository files were edited or committed.
