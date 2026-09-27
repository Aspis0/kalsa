# S23 governor thermal ladder — partial attempt

Status: the requested comparison is incomplete. Only the first GPU-requested, 5-thread arm was started. It was manually stopped when Android thermal status reached 3; later arms were withheld at 31% battery because the fixed stop floor is 30% and the first arm had already consumed at least five displayed percentage points. No comparative cooling or thread-count verdict is supported.

## Setup and controls

- Device: Galaxy S23 / SM8550, TLS adb endpoint `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`. The installed debuggable `ae64564d` APK and LFM2.5-2.6B were used; no install, uninstall, data clear, or `kalsa.bench.thermo` write occurred.
- Preflight: unplugged (AC/USB/wireless all false), 40%, battery 30.7 °C, Android thermal status 0, `persist.traced.enable=0`; no `llama|bench` process. Screen was Awake and Kalsa foreground throughout each sampler row. `/sys/class/power_supply/battery/{current_now,voltage_now}` returned Permission denied, so energy used `dumpsys battery` current-now (mA) and voltage (mV), integrated trapezoidally from 2 s samples.
- Governor load evidence: `KALSA_GOVERNOR_PLAN {"gpu_fit":"Fit",...}`; `KALSA_NATIVE_VARIANT {"androidLib":"rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl","nGpuLayers":{"prefill":99,"decode":0}}`; `KALSA_PREWARM ... {"op":"done","promptMs":14237.494,"promptN":1660,...}`. The Governor UI state was not changed.
- Route knob exists at `src/bench/benchConfig.ts:38`: `kalsa.bench.route: "cpu" | "gpu" (next-turn prefill-route request; absent/"auto" → engine decides)`. Runtime source says this is a request and engine safety gates remain authoritative (`src/engine/benchRoute.ts`). `bench:route gpu` was acknowledged. The corresponding per-turn `KALSA_GOVERNOR` line is absent, so actual prefill placement for this arm is UNKNOWN; the load-time GPU variant alone is not execution proof. The initial `bench:show`, route-set acknowledgement, and reset acknowledgement are in [configuration-acks.txt](raw/s23-20260927/configuration-acks.txt).
- Thread knob exists at `src/bench/benchConfig.ts:33, 714-779` as `kalsa.bench.engine` / `bench:engine threads=N`; it applies at engine init and requires force-stop + relaunch. `src/engine/threadProfile.ts:9-12` documents the S23 default of 5 threads. `bench:show` reported `engine=default`, `threads_src=capacity`. No `n_predict` / decode-length bench pref exists in `benchConfig.ts`; the fixed prompt requested exactly 256 words, and actual generated tokens are recorded below.
- Prompt bytes: [prompt.txt](raw/s23-20260927/prompt.txt), 4,638 characters / 765 whitespace-separated words; SHA-256 in [prompt.sha256](raw/s23-20260927/prompt.sha256). Newlines were flattened by the app composer, so the saved canonical prompt is the exact composer text; it was staged byte-for-byte before the arm.

## Arm

| Arm | Request / threads | Outcome | Duration | Energy | Prompt / prefill | Decode telemetry | Thermal end / peak |
|---|---|---|---:|---:|---|---|---|
| G5-r1 | GPU / default 5 | STOPPED at Android status 3; actual route unverified | ~279 s from `KALSA_THINKING` to stop tap | ≥344 mWh sampled; final ~130 s unmetered | `prompt_n=2584`; `promptMs=23199.374` ms (intermediate completion) | 780 tokens at 10.108 tok/s (intermediate segment; answer still streaming) | start 30.7 °C/status 0; reached 39.8 °C/status 2 in sampled segment; stop reading 42.9 °C battery / 44.1 °C skin, status 3; battery 40%→35% |

The key lines are in [G5-r1-kalsa.log](raw/s23-20260927/G5-r1-kalsa.log), [G5-r1-post-status3.log](raw/s23-20260927/G5-r1-post-status3.log), and [G5-r1-timeseries.csv](raw/s23-20260927/G5-r1-timeseries.csv). `KALSA_TELEMETRY` reported `tokensPredicted=780`, `predictedPerSecond=10.108...`, `prompt_n=2584`; it was not the completed answer: the UI still showed `I have 204 words, need 256...` and `transcript.stop... Fermato da te` when stopped at status 3. The sampled 344 mWh ends before that stop; total turn energy is unknown.

## Stop and cleanup

Cooldown log is [cooldown-wait.log](raw/s23-20260927/cooldown-wait.log). At 31% the phone cooled below the start limit; final check was 31%, battery 31.6 °C, status 0, unplugged, screen Awake, Kalsa foreground, traced 0, and no llama/bench process ([final-phone-state.txt](raw/s23-20260927/final-phone-state.txt)). The remaining battery margin was insufficient for another ~5-point arm. GPU route was reset and acknowledged with `bench:route auto`; no thread override was written. No CPU-prefill, 3-thread, or 2-thread arm was run. CPU-vs-GPU heat, speed cost, and thread-count heat effect remain unknown.
