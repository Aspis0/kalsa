# S23 backend-hopping heat study — coordinator handoff

**Device:** Galaxy S23 only (`adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`). No Jelly or Xiaomi commands were issued. No file in the lab repository was edited or committed.

**Execution accounting:** [execution-accounting.tsv](</tmp/s23-heat-abc/execution-accounting.tsv>). **All amendments and evidence:** [dated amendments](</tmp/s23-heat-abc/amendment-2026-09-28.txt>), [quoted run evidence](</tmp/s23-heat-abc/quoted-evidence.md>), [raw file manifest](</tmp/s23-heat-abc/raw-file-manifest.txt>). Host timestamps are UTC on 2026-09-29; the local experiment date is 2026-09-28.

## Execution and protocol status

- The existing primary prefill archive contains CPU ×6 and GPU ×12, but its original HTP ×12 was marked `VOID_HOT` after the 610 s gate wait reached battery `332 dC` (33.2°C) without status leaving 0. A separate original HTP decode-proof attempt was also voided at battery `338 dC` after its wait cap. Those archived CPU/GPU and supplemental HTP measurements were collected under the original `COOL_OK` block gates, before the no-cool-start amendment. They are identified as archival below, not represented as fresh no-cool arms.
- I ran a fresh HTP ×12 recovery block at the current phone temperature, with no cooling threshold or wait, after the decode repeat. It began at battery 29.5°C / skin 30.2°C and ended at 34.2°C / 35.7°C. All twelve arms exited 0 and passed the preregistered HTP0 buffer check. This is a separate post-decode block, so it does not recreate the preregistered CPU→HTP→GPU matched order.
- The nine-arm fast-sampled decode repeat ran in the required order `CPU, GPU, HTP, GPU, HTP, CPU, HTP, CPU, GPU`, with no cooldown waits. It has 700 samples, 1.1 s median cadence, and 1.4 s maximum interval. The HTP recovery has 84 samples, 1.1 s median and maximum interval. A successful current-session HTP decode dispatch proof reported Hexagon v73 and `HTP0 execute-op MUL_MAT`.
- One initial HTP recovery attempt exited 0 with an HTP0 model buffer but stopped after unit 1 because the temporary checker also demanded a v73 banner in each prefill log. The preregistration asks for the HTP0 buffer per prefill; the separate decode dispatch proof contains the v73 evidence. This attempt is preserved and separately reported, but excluded from the clean 12-unit block. The checker correction and reason are recorded in the dated amendments.
- The completion prefill records `962` prompt tokens and `15` generated eval runs per process (`-n 16` maximum); each exact prompt-eval duration and generation line is quoted per run in the evidence appendix. Decode arms use `-p 0 -n 256`, so they report 0 prompt tokens / 256 generated tokens and `tg256` throughput. The model SHA-256 is `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`; the fixed prompt SHA-256 is `f516905dd5a86926279b3bf08999539557aee3af6467c84a9df99a9323d4ba0a`. The engine is the proven f25f0c1c5 build.

## Question 1 — HTP local heat and skin crossover

The primary HTP block in the archive was void, so there is no same-session registered crossover result. In the fresh no-cool HTP recovery, the maximum NSP/CDSP zone reached **93.5°C** (units 7 and 11); the HTP-block endpoint maximum NSP sensor rose from **35.8°C** to **63.3°C** (**+27.5°C**). That endpoint series was not monotonic; its largest one-unit rise was **+6.4°C** at unit 12. Skin endpoints were nondecreasing: block-relative rises were **+0.2, +0.9, +0.9, +1.8, +2.4, +2.9, +3.9, +3.9, +4.3, +4.7, +5.5, +5.5°C**. The largest adjacent unit rise was **+1.0°C** at unit 7.

For the archival GPU block, skin started at 33.1°C and ended at 39.6°C (**+6.5°C**); its 12 endpoint rises were **+0.2, +1.6, +3.0, +3.0, +3.9, +4.4, +4.8, +5.2, +5.6, +5.9, +6.2, +6.5°C**. No aligned HTP endpoint exceeded GPU at two consecutive unit indices; therefore **no crossover was observed through 12** in this descriptive cross-block comparison. HTP and GPU were collected in different blocks with different starts/order, so this does not establish a matched within-session crossover. The archived supplemental HTP block also rose monotonically in skin (+0.0°C to +5.1°C) and had a local NSP peak of 95.9°C at unit 10, but is likewise a separate block.

Block-relative trajectories and monotonicity/crossover calculations are in [prefill-block-summary.tsv](</tmp/s23-heat-abc/prefill-block-summary.tsv>). Per-unit prompt timing, actual generated runs, route/proof, whole-process marker time, battery/skin start/end and deltas, CPU/GPU/NSP start/end maxima and peaks, and raw sampler line references are in [prefill-run-summary.tsv](</tmp/s23-heat-abc/prefill-run-summary.tsv>). The raw sensor readings selected for those results are in [prefill-temperature-evidence.tsv](</tmp/s23-heat-abc/prefill-temperature-evidence.tsv>). The primary void marker is quoted in the evidence appendix.

## Question 2 — decode heat and throughput

An earlier archived nine-arm decode set is retained at `/tmp/s23-heat-abc/prior/raw/device-out/decode-results.tsv`; it passed exits but its sampler cadence was 2.0 s median / 3.0 s maximum, so the amended fast repeat supplies the reported B values. Its per-run rates were CPU 19.68 / 21.59 / 16.61, OpenCL 14.20 / 14.11 / 14.11, HTP 22.78 / 22.75 / 22.52 tok/s. The complete per-arm table for the fast repeat includes actual route, prompt/generated tokens, `tg256`, battery and skin start/peak/end and peak deltas, per-token heat-area values, peak status, peak CPU/GPU/NSP zones, exit code, and gate/marker/log references: [decode-arm-summary.tsv](</tmp/s23-heat-abc/decode-arm-summary.tsv>). Peak raw sample references are in [decode-temperature-evidence.tsv](</tmp/s23-heat-abc/decode-temperature-evidence.tsv>).

| Backend | Rep 1 / 2 / 3 `tg256` tok/s | Median battery °C·s/token (range) | Median skin °C·s/token (range) |
|---|---:|---:|---:|
| CPU | 22.89 / 22.13 / 22.02 | 0.2018 (0.1278–0.2905) | 0.2474 (0.2413–0.3785) |
| OpenCL | 14.15 / 14.03 / 13.53 | 0.4298 (0.3526–0.4579) | 0.5253 (0.4358–0.5293) |
| HTP | 22.25 / 22.03 / 22.09 | 0.1404 (0.1265–0.1659) | 0.1708 (0.1135–0.1885) |

All nine measured decode arms had exit 0 and peak Android thermal status 0. CPU used `-dev none -ngl 0`; OpenCL used `GPUOpenCL -ngl 99` with QUALCOMM OpenCL identity and matching OpenCL model-buffer sidecars; HTP used `HTP0 -ngl 99` with matching HTP0 model-buffer sidecars. The HTP dispatch proof showed v73 and `HTP0 execute-op MUL_MAT`. The numbers describe this nine-arm run, not a general performance guarantee; per-rep spread and temperature trajectories are retained in the table and source samples.

## Question 3 — app visibility and thermal headroom

The shell inventory found **95** zones and readable type labels for all **95**; temperatures were readable for **86**, with **9** unreadable: zones 75–81, 90, and 91. The debuggable package is UID 10347, target SDK 36, SELinux is Enforcing. `run-as` read `thermal_zone0/temp` and all **30** listed CPU/CPUSS, GPU, and NSP zones; the AVC filter found no matching denial. Its reported domain is `u:r:runas_app`, not `untrusted_app`, so this probe does not prove the access a normally launched app process in the `untrusted_app` domain would have.

The S23 is API 36 and the app target is API 36, so `PowerManager.getThermalHeadroom(int)` is available. Android defines it as one scalar estimate tracking slow-moving sensors such as skin. By inference from that scalar contract, it cannot identify which CPU/GPU/NSP accelerator is hot, though it can inform a global thermal fallback. [Official Android API reference](https://developer.android.com/reference/android/os/PowerManager#getThermalHeadroom(int)). No app preference, app permission, or SELinux policy was changed.

## Safety gates and watchdog

Before every measured/proof arm in the new decode repeat and HTP recovery, gate logs recorded AC, USB, and wireless power false; `mWakefulness=Awake`; screen `ON`; `persist.traced.enable=0`; and thermal status below 3. `com.kalsa.app` was force-stopped before every arm and its PID check was empty. Tools were off (`-lm none` where applicable). No `kalsa.bench.thermo` write occurred.

The continuous device sampler and host disconnect watchdog did not stop either completed block: no thermal/battery/screen/trace/accelerator fatal, and no disconnect. Final HTP gate: `battery_dC=342`, level 92, status 0, Awake, screen ON, tracing 0; final decode gate: `battery_dC=355`, level 94, status 0, Awake, screen ON, tracing 0. The initial HTP checker abort was a proof-validator abort, not a thermal watchdog stop. No benchmark ran while charging.

Legacy main-block wall times in the per-arm TSV come from whole-second markers; supplemental and new HTP marker times retain subsecond precision. `svc power stayon true` was set for screen availability; the observed screen-off timeout was 2147483647 ms. Every arm's recorded display/power gates confirm ON/Awake. The original primary prefill results and the earlier slow-sampled decode results remain in the archive and are clearly separated from the fast no-cool repeat; original B per-run rows have `exit0=True` in `prior/raw/device-out/decode-results.tsv`.

## Raw artifact paths

Every file created or captured for this run is listed in [raw-file-manifest.txt](</tmp/s23-heat-abc/raw-file-manifest.txt>). Main raw directories:

- `/tmp/s23-heat-abc/preflight/` — battery/thermal/screen/trace gates, app visibility, SELinux, API/zone inventory.
- `/tmp/s23-heat-abc/prior/raw/device-out/` — read-only copy of the pre-existing primary prefill archive, void markers, supplemental HTP block, and original decode records.
- `/tmp/s23-heat-abc/repeat/device-raw/final/` — current fast-sampled nine-arm decode repeat, all sidecars, per-arm gates, logs, markers, and samples.
- `/tmp/s23-heat-abc/npu-rerun/device-raw/` — preserved initial checker-aborted attempt and pull logs.
- `/tmp/s23-heat-abc/npu-rerun-validated/device-raw/final/` — current clean no-cool-start HTP prefill recovery, gates, logs, markers, and samples.
- `/data/local/tmp/heat3way/hopping/repeat/`, `/data/local/tmp/heat3way/hopping/npu-rerun-20260928/`, and `/data/local/tmp/heat3way/hopping/npu-rerun-20260928-valid/` — corresponding device-side raw directories.
