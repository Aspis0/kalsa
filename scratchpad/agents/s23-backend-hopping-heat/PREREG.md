# S23 backend hopping heat — pre-registration

Written 2026-09-28 before any device work for this cell. The S23 is currently
charging. No device command or run is authorized until Marco says it is
unplugged. This plan is locked when the first device read begins; changes go in
a dated amendment.

## Questions

1. Across one sustained block of 12 fixed-prompt prefills, does HTP v73 heat
   locally (NSP/CDSP zone) or raise skin temperature enough to lose its thermal
   advantage over OpenCL? When does any skin-temperature crossover occur?
2. Per 256 generated tokens, how do battery and skin heat, peak CPU/GPU/NSP
   zones, and throughput compare for CPU, OpenCL, and HTP decode?
3. Can an ordinary debuggable `com.kalsa.app` process read thermal-zone sysfs?
   Does Android's thermal-headroom API provide a per-unit signal for routing?

This is a diagnostic, unplugged study. It does not use `kalsa.bench.thermo`.

## Fixed inputs and prior inventory

| item | identity |
|---|---|
| device | Galaxy S23 SM-S911U, SM8550, Adreno 740, Hexagon v73 |
| serial | `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` |
| model | `/data/local/tmp/heat3way/ship.gguf`, expected SHA-256 `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03` |
| prompt | `governor-thermal-ladder/raw/protocol-v2/prompt-v2.txt`, expected SHA-256 `f516905dd5a86926279b3bf08999539557aee3af6467c84a9df99a9323d4ba0a`, 962 tokens incl. BOS |
| engine kit | Existing f25f0c1c5 Android kit in `/data/local/tmp/heat3way`; prior run used `bin/llama-completion`, `bin/llama-bench`, and `lib/` |
| runtime | `LD_LIBRARY_PATH=/data/local/tmp/heat3way/lib`, `ADSP_LIBRARY_PATH=/data/local/tmp/heat3way/lib`, `GGML_HEXAGON_NDEV=1` |

The previous S23 sensor inventory (`scratchpad/agents/sensor-inventory/REPORT.md`)
found shell-readable `cpu-*`, `cpuss-0..3`, `gpuss-0..7`, `nspss-0..3`, and a
battery thermal zone. It found type labels but unreadable temperatures for
thermal zones 75–81, 90, and 91. HAL `dumpsys thermalservice` exposed SKIN and
BAT readings. Re-enumerate on the authorized session and record every zone's
index, exact type, and whether `shell` can read both `type` and `temp`; that
prior inventory is not a substitute for this session's raw output. No sysfs
zone named `skin` was seen previously.

The prior three-way S23 run reported median skin-area proxy per 1k prompt
tokens of 10.34 °C·s for HTP, 30.46 °C·s for OpenCL, and 55.25 °C·s for CPU.
These are context only; the present block order and sustained workloads are a
new measurement.

## Gates and shared sampling

- Do not begin until the owner confirms unplugged. Recheck the Android power
  source before every measured or proof run; any plugged sample stops the run.
- Keep the display Awake for the whole authorized session. Set
  `svc power stayon true` only after authorization; never turn the screen off
  or restore stay-on. Before and after every run, save
  `dumpsys power | grep mWakefulness=`; anything other than `Awake` voids that
  run and requires a repeat after gates are restored.
- Force-stop `com.kalsa.app` immediately before each binary run and verify no
  app process remains. Leave app preferences untouched.
- Verify `getprop persist.traced.enable` is `0` before and after each run.
- Before each prefill block and each decode arm, require battery ≤33.0 °C and
  Android thermal status 0. Cool with screen on, polling every 15 s for at most
  10 min. If the gate is not reached, record `VOID hot` and do not run that
  block/arm. Cool only between prefill blocks; do not cool within one.
- Sample once per second from a single sampler throughout runs and cooldowns:
  timestamp, `mWakefulness`, plugged state, battery percentage and temperature,
  Android thermal status, HAL SKIN and BAT temperatures, and every shell-readable
  CPU, GPU, and NSP/CDSP thermal-zone temperature. Record the exact zone list
  and each unreadable zone in raw output. Keep sampler implementation identical
  for all backends.
- Stop the entire session if battery reaches 30%, battery temperature reaches
  43 °C, thermal status reaches 3, screen leaves Awake, tracing becomes
  nonzero, a device disconnects, or an accelerator crashes. Mark unfinished
  work `VOID stop`; do not resume without a new authorization. Screen remains
  on at the end.

All arm logs, one-second samples, markers, zone inventory, and gate checks go
under `raw/device-out/`; preserve stdout/stderr and exit status separately.

## A. Sustained prefill blocks

Fixed order: **P-CPU ×6 → P-NPU ×12 → P-GPU ×12**. Require battery ≤33.0 °C and
status 0 before each block, and cool only between these blocks. Do not pause or
cool between invocations within a block: launch each next process as soon as
the prior process exits. Check Awake and safety gates before and after each
invocation. One invocation is one prefill unit. If a stop gate trips, stop the
block and mark all remaining units void.

Use the exact 962-token prompt each time, `-n 16`, fixed greedy settings, and
the same common options used in the prior QDC driver:

```sh
COMMON='-m ship.gguf -lm none -f prompt.txt -n 16 --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt'
CPU: ./bin/llama-completion $COMMON -dev none -ngl 0 -lv 4
HTP: ./bin/llama-completion $COMMON -dev HTP0 -ngl 99 -nkvo -lv 4
GPU: ./bin/llama-completion $COMMON -dev GPUOpenCL -ngl 99 -lv 4
```

Run from `/data/local/tmp/heat3way` with the fixed runtime environment above.
Keep `-n 16` for protocol continuity; separately extract prompt-eval time
(`prompt eval time`) so generation is not counted as prefill throughput. These
are separate CLI processes, so thermal exposure includes model-load/startup;
report whole-process wall time and prefill eval time distinctly. The 1 Hz
sampler runs continuously, and there is no per-invocation tail inside a block.

For each unit, record start/end timestamps, exit code, prompt-eval ms, and the
nearest one-second battery, skin, CPU, GPU, and NSP/CDSP readings at start and
end. Report each unit plus block trajectories. At each block's start, use that
block's own starting temperatures as its baseline. Report raw temperatures
alongside within-block rise so different block starts remain visible.

Define the descriptive **skin crossover** as the first matched unit index `k`
where P-NPU's block-relative skin rise at unit end is greater than P-GPU's
block-relative rise at unit end for two consecutive unit indices. Also report
NSP/CDSP absolute and block-relative trajectory; it is a local NPU sensor and
is not directly compared numerically with the GPU zone. If no such `k` exists,
report “no crossover observed through 12 prefills.” This is one block per
backend, so crossover is descriptive, without a repeat-based confidence claim.
Report whether skin or NSP/CDSP rises monotonically, and the largest unit-index
rise. CPU ×6 is a short reference, not part of crossover.

Backend proof is required for every invocation: CPU logs show no accelerator
model buffer, OpenCL logs show an OpenCL model buffer plus the QUALCOMM OpenCL
platform/driver line, and HTP logs show an HTP0 model buffer. A missing proof or
nonzero exit voids that unit.

## B. Decode heat per token

Run 3 reps per backend in this fixed alternating order:
`CPU, GPU, HTP, GPU, HTP, CPU, HTP, CPU, GPU`. Cool to battery ≤33.0 °C and
status 0 before every individual arm; use the same 15 s polling and 10 min cap.
Check Awake, unplugged, app stopped, and tracing 0 before and after each arm.

Measured command shape (one `tg256` repetition per process):

```sh
CPU: ./bin/llama-bench -m ship.gguf -p 0 -n 256 -r 1 -t 5 -ngl 0 -dev none -fa 1 --no-warmup -o md
GPU: ./bin/llama-bench -m ship.gguf -p 0 -n 256 -r 1 -t 5 -ngl 99 -dev GPUOpenCL -fa 1 --no-warmup -o md
HTP: ./bin/llama-bench -m ship.gguf -p 0 -n 256 -r 1 -t 5 -ngl 99 -dev HTP0 -fa 1 --no-warmup -o md
```

Run in the same kit directory and runtime environment. Window for decode heat
is arm start through process exit plus 60 s sampled idle tail. For battery and
skin separately, integrate `max(0, temperature - arm-start temperature)` by
trapezoids over real timestamps, in °C·s; divide by 256 for °C·s/token. Report
per-rep values and medians, `tg256` tok/s, start/peak/end battery and skin,
peak status, and peak of each CPU/GPU/NSP zone family. A missing sensor is
`NA`, not zero.

Backend proof: GPU measured logs must include the QUALCOMM OpenCL platform or
driver line and OpenCL model buffer. HTP measured logs must include an HTP0
model buffer. Additionally run a separate, decode-only HTP dispatch proof
before the measured HTP arms, using `GGML_HEXAGON_VERBOSE=1` and
`llama-bench -p 0 -n 4 -r 1 -t 5 -ngl 99 -dev HTP0`; it passes only with at
least one `HTP0 execute-op MUL_MAT` line and a v73 skel reference. This proof
is not included in throughput/heat summaries. CPU measured logs must use
`-dev none -ngl 0` and contain a `tg256` row.

## C. App visibility and Android headroom

After the zone inventory, check SELinux mode and app UID/context, then test a
representative readable CPU, GPU, and NSP zone and the previously denied
`thermal_zone0` from the debuggable app UID:

```sh
adb shell getenforce
adb shell run-as com.kalsa.app id
adb shell run-as com.kalsa.app id -Z
adb shell run-as com.kalsa.app cat /sys/class/thermal/thermal_zone0/temp
adb shell run-as com.kalsa.app sh -c 'for z in /sys/class/thermal/thermal_zone*; do t=$(cat "$z/type" 2>/dev/null) || continue; case "$t" in cpu*|cpuss*|gpuss*|nsp*) printf "%s %s " "$z" "$t"; cat "$z/temp" 2>&1;; esac; done'
```

Capture command output and any AVC denial; do not change SELinux policy or app
permissions. Record which exact zones are readable as `shell` versus
`untrusted_app`.

`PowerManager.getThermalHeadroom(int)` is an Android API available since API
30. The official API describes a scalar estimate of headroom before severe
throttling, tracking slow-moving sensors such as skin; it is not a per-unit
CPU/GPU/NSP temperature. Polling more often than about once per second has no
benefit and may return `NaN`; forecasting needs several initial samples. Thus
it may guide global thermal fallback, but it cannot alone identify which
accelerator is hot. Record the S23 API level and whether the API is available
in the firmware/app target; no app preference or policy change is part of this
test. Reference: [Android `PowerManager.getThermalHeadroom`](https://developer.android.com/reference/android/os/PowerManager#getThermalHeadroom(int)).

## Analysis and reporting

Report every run, failures and exact log lines, gate traces, prompt/model hashes,
zone inventory/readability, and raw artifact paths. For A report per-unit
temperature trajectories and the defined crossover/no-crossover result. For B
report per-rep and median °C·s/token, tok/s, and peak unit-zone temperatures.
Do not infer a win from a single peak; show the trajectories and spread. Energy
is outside this cell. Preserve command exit codes as `EXIT=<real status>` and
do not infer success from a pipeline's last process.

## Amendment 2026-09-28 — recover the skipped HTP prefill block

During the registered order, P-NPU ×12 did not start: after P-CPU ×6, the
10-minute cooldown ended at 33.2 °C (status 0), so the block was `VOID hot`.
After all registered arms and the decode proof, the phone was cool again
(battery 30.5 °C, status 0, Awake, unplugged, tracing 0). To finish the HTP
trajectory requested in A, run a supplemental P-NPU ×12 block now, with the
same prompt, binary flags, no cooldown inside, and all per-run gates. Keep it
separate from the fixed-order primary result: report its own block-relative
temperature trajectory and label cross-block comparisons descriptive because
the supplemental block follows GPU and decode work.

The first session sampler achieved median 2 s, maximum 3 s intervals, rather
than the planned 1 s. The supplemental block will use a lighter collector;
report its measured interval distribution and do not merge its samples with
the first session.

## Amendment 2026-09-28 — repeat decode with near-1 Hz sampling

The registered decode arms were completed, but their sampler also achieved a
2 s median interval (3 s maximum). After the separate decode-only HTP proof
passed with the `llama-bench -v` debug switch, repeat the same nine decode arms
in the same alternating order, with the same 60 s tails, cooldowns, and gates,
using the fast collector. The fast collector measured 1.091 s median and
1.140 s maximum during an idle check. Keep the original decode data raw but
supersede it with the repeated set in the final B results.
