# S23 NPU lane c26ba8bc — device run report

Date: 2026-09-30 (device logclock times quoted; host stamps in `raw/idle-final-dumpsys.txt` are host UTC).
Device: Galaxy S23 (SM-S911U, SM8550, Hexagon v73), serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`, always `-s`.
APK: `/tmp/apk-c26ba8bc/.../app-release.apk`, sha256 `f1de5ced2be0026c5184da61eaf4b06b6a35b5e2733496ead9ac7b4e44ce01ea` (verified before install, `shasum -a 256` exit 0). App main `c26ba8bc`, binding `b4a13d9a`, first APK with the Hexagon host backend.
Runner: device-run agent, coordinator session dispatch. No commits, no pushes.

## Verdict

**Part A: FAIL. Part B: NOT RUN (blocked by A, and independently by a missing idle-current source).**

- **A1 FAIL (lane on):** the lane resolves exactly as specified — `KALSA_GOVERNOR_PLAN {..., "npu_device":"HTP0","npu_fallback":null}` — but the model load aborts 3 s later in governor context construction: `pre-allocated tensor (cache_v_l2 (view)) in a buffer (HTP0) that cannot run the operation (SET_ROWS)` → native crash, process dead. Prefill never ran on HTP; no turn, no KALSA_GOVERNOR turn line, no telemetry ever existed for lane-on.
- **A2 FAIL (lane off):** "nothing may be placed on HTP" is violated at the scheduler level: a lane-OFF, route-gpu load crashed with the identical `cache_v_l2` in `HTP0` abort (dropbox 16:51:03), while an earlier load of the same config succeeded (16:50:18) — HTP buffer placement is real and nondeterministic. The perf-within-noise check could only be run on the CPU route (one turn, below); the GPU route has no completable turn, so the acceptance cannot be met.
- **A3 partial:** cold-start times show no regression (lane-off medians 533 ms vs old 548 ms; lane-on activity launch also normal — its crash is a later, separate event). Exactly one FastRPC session opens per process init. But the lane-on cold start deterministically ends in the native abort above, so "startup with lane on" is not shippable behavior.
- **Part B not run**, per the gate "only if Part A passed". Two additional blockers recorded for the retry: (1) this crash must be fixed first; (2) the ≥60 s 1 Hz idle window has **no shell-accessible current source on this device** (`/sys/class/power_supply/battery/*` permission-denied to shell, `dumpsys batteryproperties` absent, in-app 1 Hz sampler runs only during a turn). Idle power was only measurable at ~0.008 Hz granularity (fuel-gauge `current_avg` snapshots + charge-counter slope, which agreed: ~224–227 mA ≈ 840 mW).

## Root cause (crash, both lane states)

Identical abort in three crashes of this session (dropbox `data_app_native_crash` + `SYSTEM_TOMBSTONE`, pids 18376, 20065, 26560; `raw/tombstones.txt`, `raw/crash-173044.txt`):

```
ggml-backend.cpp:941: pre-allocated tensor (cache_v_l2 (view)) in a buffer (HTP0)
that cannot run the operation (SET_ROWS)
```

Backtrace (17:03:44 crash): `ggml_abort` ← `ggml_backend_sched_split_graph` ← `llama_context::graph_reserve` ← `resolve_fused_ops` ← `sched_reserve` ← `llama_context ctor` ← `llama_init_from_model` ← `llama_governor ctor` ← `llama_governor_init_with_params_internal` ← `rn_governor` ← `loadModel`. The scheduler assigns a KV-cache V-view tensor to the HTP0 buffer during governor context reserve; HTP0 cannot run SET_ROWS; ggml aborts the process. This is a device-side characterization; the fix belongs to the binding (b4a13d9a device-list/sched wiring) — the recon AUDIT's F6/F7/F10 concerns are consistent with this signature.

## The dead-load marker story (operational, important for reruns)

`kalsa.load.dead.lfm2.5-2.6b = 1` was already in AsyncStorage when this session started (present 25 s into the first post-install launch, before any of my interactions; no kalsa crash entry in dropbox today predates it — cause of the original unsettled load unknown, predates the APK swap). Consequences observed:

- With the marker set, every cold launch refuses at the load gate (`KALSA_LOAD {"phase":"fitGate","refusedBy":"marker"}`) and the chat sits at "In attesa: il modello va caricato di nuovo" forever.
- The app's own recovery (model sheet → "Caricamento non riuscito — tocca per riprovare" → tap `shell.modelBar.retry` at [42,2052][1038,2196]) clears it and loads; loads that settle clear the marker (verified in the DB after the CPU-route load).
- Every native crash re-arms it (process died mid-guardedLoad), so the crash above reliably produces a refusal on the next launch.

## Part A evidence

### A1 — lane on (route gpu, `kalsa.bench.npu_lane=on`)

Lane-on cold launch, pid 26560, 17:22:53 (`raw/laneon-cold1-evidence.txt`, logcat filtered):

```
09-30 17:22:53.795 26560 26585 I ReactNativeJS: KALSA_GOVERNOR_PLAN {"gpu_fit":"Fit","decode_repack":false,"required_mib_with_repack":4518.12,"required_mib_without_repack":2998.06,"available_mib":4629.64,"bench_norepack_forced":null,"npu_device":"HTP0","npu_fallback":null}
09-30 17:22:53.829 26560 26586 I com.kalsa.app: vendor/qcom/proprietary/adsprpc/src/fastrpc_apps_user.c:3803: fastrpc_apps_user_init done  with default domain:3 and &fastrpc_trace:0x7d83d6fffc
09-30 17:22:53.899 26560 26585 I ReactNativeJS: KALSA_NATIVE warn ggml-hex: forcing ndev to 1 for SoCs archs lower than v75.
09-30 17:22:53.900 26560 26585 I ReactNativeJS: KALSA_NATIVE warn ggml-hex: HTP0 failed to get URI (physical 0, virtual 0) : error 0x14. Falling back to single session URI: file:///libggml-htp-v73.so?htp_iface_skel_handle_invoke&_modver=1.0&_dom=cdsp&_session=0
09-30 17:22:56.716 26560 26636 E RNLlama : ggml_abort:0 .../ggml-backend.cpp:941: pre-allocated tensor (cache_v_l2 (view)) in a buffer (HTP0) that cannot run the operation (SET_ROWS)
```

Backend/device evidence of HTP at load: `npu_device:"HTP0"`, `fastrpc_apps_user_init done with default domain:3`, the `libggml-htp-v73.so` session URI, and `RNLlama: Extracted HTP library: libggml-htp-v73.so` (plus v75/v79/v81) (`raw/cpu-diag-pid.log:RNLlama lines` — same init ran in every load; HTP skel extraction to `/data/user/0/com.kalsa.app/app_rnllama-htp`). `npu_fallback` was null at plan level — the acceptance's fallback check passes; the failure is the abort, not a fallback. No `KALSA_GOVERNOR` turn line or telemetry exists for lane-on (load never completed), so "prefill actually on HTP" is untestable: FAIL on that clause.

Also observed at 17:09:37 (CPU-route load, lane off): the same `HTP0 failed to get URI ... error 0x14` single-session fallback — the error-0x14 URI path is taken on every load; the driver still registers HTP0 and opens one FastRPC session.

### A2 — lane off

- HTP exclusion violated at sched level: crash of pid 18376 at 16:51:03 was a route-gpu, lane-OFF load (`raw/tombstones.txt` first tombstone). A route-gpu lane-off load had succeeded at 16:50:18 (`KALSA_NATIVE_VARIANT` logged, model ready) — so lane-off GPU routing sometimes completes, sometimes aborts on HTP buffer placement. Nondeterministic; unacceptable for benching.
- HTP device/session initialized even with lane off and route cpu (17:09:37 quotes above; `raw/cpu-diag-pid.log`).
- CPU-route perf check (the only completable arm), one turn, `cpu-c1`, preconditions in `raw/cpu-c1-battery-pre.txt`/`-state-pre.txt` (unplugged, Awake, foreground, traced 0, thermal 0):

| metric | cpu-c1 (this APK) | previous APK (governor-m1 REPORT, cpu-t1..t3) |
|---|---|---|
| prompt | 4746 tokens (same `enc.txt` via `kalsa://share?text=`) | same |
| prefill tok/s (4746/promptMs) | 22.8 (promptMs 208002.6) | 20.6 / 16.4 / 16.5 |
| decode tok/s (KALSA_TELEMETRY predictedPerSecond) | 8.45 | 8.30 / 6.94 / 7.11 |
| route (`KALSA_GOVERNOR`) | `engine_prefill CPU, engine_decode CPU`, `npu_device:null`, chunks `cpu:512+...` | same shape |
| J/1k prefill tokens (raw) | 256 | 223 / 227 / 222 |
| J/1k prefill (incremental, idle 839 mW subtracted) | 221 | not measured (no idle window in M1) |
| J/decode token raw / incremental | 0.73 / 0.63 | not measured |

Single turn, thermal_state FAST (battery 41.0 °C end), so no strict within-noise claim is possible; it is ballpark-consistent with the previous APK (prefill ~10 % above the best M1 CPU turn, decode at the top of the M1 range) — the CPU compute path of the new APK works and produces correct-looking telemetry (`tokensEvaluated 4746`, `interrupted:false`). Source: `raw/cpu-c1.csv`, `raw/cpu-c1-kalsa.txt`, stats command in the session log; mA interpretation cross-checked by the in-trace charge-counter slope (1887 mA) vs trace mean (1645 mA), ~15 % apart, same order as the M1 audit's 6 % finding — keeps the mA assumption, not a calibration.

### A3 — cold starts (`am start -W -n com.kalsa.app/.MainActivity`, force-stop before each, COLD)

| config | TotalTime ms (3 runs) | median |
|---|---|---|
| old APK (d33190d0 build, installed 12:00:32, versionName 0.1.0) | 749 / 548 / 491 (`raw/old-cold-*.log`) | 548 |
| new APK, lane off | 533 / 527 / 811 (`raw/new-cold-off-*.log`) | 533 |
| new APK, lane on | 757 / 559 / 484 (`raw/new-cold-on-*.log`; run 1's load aborts ~4 s after plan — activity-launch time unaffected; runs 2–3 refuse at the marker) | 559 |

No regression > 10 % (medians: −3 % lane-off, +2 % lane-on vs old median). FastRPC session count: per process init exactly one `fastrpc_apps_user_init done` (default domain 3) and one single-session URI fallback, with `ndev` forced to 1 (`ggml-hex: forcing ndev to 1 for SoCs archs lower than v75`) — one session, as required (logcat-rotation caveat: per-launch counts taken from fresh `-c` buffers, quoted above; `raw/npu-a1-fastrpc.txt`).

## Part B — not run

Gate: "only if Part A passed" — it did not. State for the coordinator's retry, in priority order:

1. The crash must be fixed first (HTP0 in the sched buffer set during governor context reserve).
2. The idle-window protocol as specified is **unimplementable on this device today**: no shell-readable 1 Hz current (`/sys/class/power_supply/battery/current_now` permission-denied; `dumpsys batteryproperties` does not exist; the app's 1 Hz sampler only runs inside a turn). Options: ship a bench key that runs the in-app sampler without a turn, or accept the ~0.008 Hz fuel-gauge snapshots + charge-counter slope I used (idle 224–227 mA / ~840 mW, screen on, model resident; `raw/idle-final-dumpsys.txt`).
3. Harness adaptation is ready and PROVEN end to end on one CPU turn: `/tmp/npu-b/turn.sh` (copy of `/tmp/m1/turn.sh`, originals untouched; adds stored plug evidence, pre/post state+thermal capture, pre-send foreground gate, ready-wait, pid-scoped KALSA + ggml-hex + device-wide fastrpc extracts; copies in `raw/turn.sh`, `raw/idle.sh`, `raw/sqlq.sh`). Its one full run exited 0 with telemetry and a valid 307-row CSV (`raw/cpu-c1.csv`, `raw/run-cpu-c1.log`).

## Preconditions log

Before first measurement and before every arm/turn (all PASS each time; values in `raw/*-battery-pre.txt`, `raw/*-state-pre.txt`, `raw/cpu-c1-state-post.txt`): AC/USB/Wireless powered false; `persist.traced.enable=0`; `cdsprpcd`/`adsprpcd` idle (0.0 % CPU, `top`); `mWakefulness=Awake` + display suspend blocker held; `topResumedActivity com.kalsa.app/.MainActivity`; `Thermal Status` 0–2 (never ≥ 3). Battery: 39 % at first preflight → 25 % at end; battery temperature 26.8 → 41.0 °C peak during the CPU turn → 35.1 °C at end.

Screenshots taken before each Send verified the staged UI (menu button [48,93][192,237], send [873,2010][1017,2130] — taps at (117,164), (944,2071)); PNGs not stored in raw/ (no binaries).

## What could not be verified

- NPU prefill throughput/energy: no lane-on load ever completed (crash). `npu_device:"HTP0", npu_fallback:null` at plan level is verified; actual HTP execution is not.
- GPU-route lane-off perf vs previous APK: no lane-off GPU turn could be attempted safely — the same config crashed once (16:51:03) and loaded once (16:50:18, no turn sent); nondeterministic placement makes any number meaningless until fixed.
- The one-session FastRPC count under repeated load/unload: logcat rotation; evidence is per-launch from fresh buffers.
- Idle 1 Hz baseline: unobtainable (see Part B item 2); 3-minute aggregate only.
- Original dead-load marker origin (predates session, old APK era 12:58–16:27, no dropbox crash entry).
- decode-side backend separation: decode is CPU in every configuration that runs.

## End state (as instructed)

Phone left unplugged, screen on and Awake, Kalsa foreground with model loaded and ready ("Pronto · locale", MainActivity, pid 27310), route cpu / npu_lane off / energy_trace on / nativelog off, level 25 %, thermal status 0, `persist.traced.enable=0`. Bench keys on the phone (read via `sqlq.sh`): `kalsa.bench.energy_trace=1`, `kalsa.bench.kvtranscript=1`, `kalsa.bench.nativelog=off`, `kalsa.bench.route=cpu`, `kalsa.bench.npu_lane=off`; `kalsa.load.dead.lfm2.5-2.6b` absent (last load settled). Nothing committed or pushed.

## raw/ inventory

| file | what |
|---|---|
| `install.log` | `adb install -r` output (Success), exit 0 |
| `old-cold-{1,2,3}.log` | old APK cold starts (pre-install baseline) |
| `new-cold-off-{1..3}.log`, `new-cold-on-{1..3}.log` | new APK cold starts lane off/on |
| `npu-a1-full-pid.log`, `npu-a1-state-pre.txt`, `npu-a1-battery-pre.txt`, `npu-a1-hexlog.txt`, `npu-a1-kalsa.txt`, `npu-a1-fastrpc.txt`, `run-npu-a1.log` | first lane-on attempt (marker refusal, no turn) |
| `laneoff-diag-pid.log` | lane-off diagnostic launch (fitGate refusal, pre-recovery) |
| `cpu-diag-pid.log` | route-cpu lane-off load: HTP init + single-session quotes, KALSA_NATIVE_VARIANT |
| `laneon-cold1-evidence.txt` | THE A1 quote set: GOVERNOR_PLAN HTP0, fastrpc init, ndev 1, single session, abort |
| `crash-173044.txt`, `tombstones.txt` | dropbox native-crash record + both tombstones (abort messages, backtrace) |
| `cpu-c1.csv`, `cpu-c1-kalsa.txt`, `cpu-c1-{hexlog,fastrpc,battery-pre,state-pre,state-post}.txt`, `run-cpu-c1.log` | the completed CPU-route turn |
| `idle-final-dumpsys.txt` | 3-min idle evidence: charge counter, current_avg, battery broadcasts |
| `turn.sh`, `idle.sh`, `sqlq.sh` | harness adaptation (originals in /tmp/m1 untouched) |
| `final-state.txt` | end-of-session device state snapshot |
