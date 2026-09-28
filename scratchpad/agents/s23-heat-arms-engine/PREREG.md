# S23 engine heat and energy arms — pre-registration

Written 2026-09-27 before any device command for this cell. Locked when the
session starts; corrections go in a dated amendment with the old text retained.

## Question

On the Galaxy S23 (SM8550, Adreno 740, Hexagon v73), compare battery energy and
thermal response for a 962-token prompt on CPU, OpenCL GPU, and HTP NPU, then
compare CPU `tg256` decoding at 5, 3, and 2 threads. These are engine-level
results for the ship model and this prompt, not app/UI measurements.

## Fixed inputs

| Input | Identity |
|---|---|
| Engine | Kalsa engine kit from f25f0c1c5, Snapdragon Android arm64 build with OpenCL and Hexagon v73 |
| Device | `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`; S23, unplugged |
| Model | `/data/local/tmp/heat3way/ship.gguf`; expected SHA-256 `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03` |
| Prompt | `governor-thermal-ladder/raw/protocol-v2/prompt-v2.txt`; SHA-256 `f516905dd5a86926279b3bf08999539557aee3af6467c84a9df99a9323d4ba0a`; 962 tokens including BOS |
| Runtime libraries | `/data/local/tmp/heat3way/lib`; set both `LD_LIBRARY_PATH` and `ADSP_LIBRARY_PATH` there, plus `GGML_HEXAGON_NDEV=1` |

The prompt file will be copied to `/data/local/tmp/heat3way/prompt-engine.txt`.
The device model hash and runtime binary/library identity are recorded before
the baseline. No app preferences or benchmark UI are touched.

## Arms and order

All prefill arms use `llama-completion`, the fixed prompt, `-n 16`, greedy
decoding, context/batch 2048 and microbatch 1024. P-CPU uses `-dev none -ngl
0`; P-GPU uses `-dev GPUOpenCL -ngl 99`; P-NPU uses `-dev HTP0 -ngl 99 -nkvo`.
Three repetitions per backend are interleaved:

1. P-CPU-1, P-GPU-1, P-NPU-1
2. P-CPU-2, P-GPU-2, P-NPU-2
3. P-CPU-3, P-GPU-3, P-NPU-3

Then CPU-only `llama-bench -p 0 -n 256 -r 1 -ngl 0 -dev none -fa 1
--no-warmup -o md` at `-t 5`, `-t 3`, `-t 2`, twice each, ordered 5/3/2 then
5/3/2. GPU and NPU backend proof uses a separate short, unmeasured run: the
OpenCL driver/platform line must identify QUALCOMM; the HTP verbose log must
contain at least one `HTP0 execute-op MUL_MAT` line and v73 skel reference.
Measured runs also need the corresponding OpenCL or HTP model-buffer line.

## Gates and arm validity

- Keep the display awake for the whole session (`svc power stayon true`); do
  not switch it off or restore stayon. Read `dumpsys power | grep
  mWakefulness=` immediately before and after every measured arm; it must say
  `Awake` both times. A non-Awake arm is VOID and must be rerun after fixing
  wakefulness.
- Confirm unplugged, `persist.traced.enable=0`, Kalsa app force-stopped, and
  battery at least 30% before and during the session. Stop all work at 30%.
- Before every measured arm, require battery temperature ≤33.0 °C and Android
  thermal status 0. Keep the screen on and poll every 15 s, with a 600 s cap.
  If either condition is not reached within 10 min, record the arm VOID `hot`
  and continue only if remaining time and battery permit.
- Sample once per second through the session: battery temperature, current
  Android thermal status, skin sensor from the HAL section of
  `dumpsys thermalservice` when present, and battery `current_now` and
  `voltage_now`. Record missing/unreadable fields as missing, never as zero.
- No `kalsa.bench.thermo`; no app UI measurements.

## Energy and heat metrics

At the start, with Kalsa force-stopped and screen awake, sample for 60 s to
measure mean idle battery power. Interpret the absolute current magnitude and
voltage sysfs values in µA and µV: `mW = abs(current_now * voltage_now) / 1e9`.
Integrate the per-second samples by trapezoid using elapsed timestamps; convert
to mWh by dividing mW·s by 3600. For each arm, net energy is its integrated
energy from process launch to process exit minus the idle mean power multiplied
by arm duration. Report raw and net energy. P-arm normalized energy is
`net_mWh * 1000 / prompt_tokens`; D-arm energy is net mWh per 256 generated
tokens. A negative baseline-subtracted result remains negative and is reported
as measured; no clipping.

For each valid arm report duration, energy, Δ battery temperature from the
pre-arm sample to the maximum through a 60 s post-run tail, peak thermal status,
and speed. For prefill, duration/speed use `prompt eval time` and prompt token
count from the completion log; also retain total process duration for energy
integration. For decode, duration/speed use the `tg256` row. Report each rep
and the median of valid reps; do not omit VOID records.

The prefill verdict names the lowest median net mWh per 1k prompt tokens and
lowest median battery-temperature rise, with relative differences to the next
backend. The decode verdict compares net mWh per 256 tokens at 2/3/5 threads;
fewer threads cut energy per token only if their measured median is lower.

## Evidence and stop rules

Keep the local command transcript and raw per-second samples, baseline samples,
per-arm stdout/stderr, proof logs, markers, hashes, and parser output under this
directory's `raw/`. Any nonzero command, timeout, thermal gate miss, backend
proof miss, wakefulness failure, or battery stop is reported with its log line
and arm validity. Do not replace missing evidence with inference.

Stop immediately at 30% battery, thermal status ≥3, battery temperature ≥43 °C,
tracing enabled, unplugged gate failure, app not force-stopped, or a process
crash. Preserve screen Awake and `stayon` through cleanup.
