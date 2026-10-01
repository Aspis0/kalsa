# S23 governor — first in-app three-engine campaign (NPU / GPU / CPU / AUTO)

Date: 2026-10-01, 15:24–17:25 local (device logclock times quoted below).
Device: Galaxy S23 (SM-S911U, SM8550 / Hexagon v73), serial `R3CW406P8CV`, wireless adb
`192.168.1.152:34673` (mdns transport of the same phone also present; always `-s`).
APK: CI run `36900648095` — app main `07476dae`, binding `6c9b16ed`, engine `61c909481`,
debuggable. `app-release.apk` sha256
`e53ed1f890fec13ee4f15583a679eaeaf8aaf8b99fa8aa6d5d7970e9dfb5f003` (`raw/apk.sha256`).
Model: shipping `LFM2.5-2.6B-QAD-Q4_0` already on the phone (`kalsa.model.id=lfm2.5-2.6b`).
Runner: device-run agent session; no commits, no pushes; APK kept in `/tmp` and hashed.

## Verdict

**The app runs prefill on all three engines on the new chain, and the governor picks NPU by
itself. All four arms PASS their acceptance clauses; no crash, no hang, no silent fallback
anywhere in 37 recorded turns.** Long turns on the hot arms were cut by the thermal watchdog
(≥3 SEVERE), as the protocol requires; those cuts are recorded per arm.

- **NPU (npu_lane=on, route=auto): PASS.** `engine_prefill:"NPU"` on every clean turn,
  `npu_device:"HTP0"`, `npu_fallback:null`. HTP execution is proven at buffer level: the
  prefill context reserves `HTP0 compute buffer 129.00 MiB` + `CPU 11.04 MiB` with
  `backend_ptrs.size()=2` (HTP0+CPU — OpenCL is not in the prefill context at all) and
  `load_tensors` assigns every layer to HTP0 (`raw/nativecheck-full.log`). No SET_ROWS abort
  (the c26ba8bc crash is gone); no hang (no turn hit the 300 s guard); dead-load marker never
  re-armed.
- **GPU (lane off, route=gpu): PASS.** OpenCL prefill, `route_requested/actual=gpu` on every
  chunk with `route_mismatch:false`, `npu_device:null` — the lane-off guarantee holds at the
  governor level. 6/6 short turns, 4/6 long turns (watchdog).
- **CPU (lane off, route=cpu): PASS on the engine clause.** CPU prefill completes
  (route forced cpu, honored) but it is thermally brutal: 21.7 tok/s short-prompt prefill,
  79.8 s TTFT median; the watchdog stopped both passes before the long prompts (fills added
  one CPU long turn: 150.7 s TTFT at 20.9 tok/s). Consistent with the DESIGN heat table
  (CPU 44.6 °C·s per 1k tokens vs NPU 6.45).
- **AUTO (lane on, route=auto): PASS — the governor picks NPU.** 12 of 13 AUTO turns chose
  NPU. The one exception (`auto1-s1`, thermal_state WARM right after the CPU arm) chose GPU —
  the designed WARM hop-out — and it still executed at NPU speed (170.2 tok/s, see
  "label vs device" below). Short and long prompts both resolve to NPU whenever the state is
  FAST or COOLMODE.
- **FastRPC gate:** exactly one `fastrpc_apps_user_init done` per process init with the lane
  on AND with the lane off (registration-level init; the known benign `error 0x14` single-
  session URI fallback in both cases). With the lane off the HTP device never joins a model
  device list (`lane_off_devices` excludes the HTP registry), matching `npu_device:null`.
- **Energy:** `kalsa.bench.energy_trace=1` works — one 1 Hz CSV per turn under
  `files/energy/`, 37 CSVs collected (`raw/*.csv`). Charge-counter slopes (the reliable
  channel; the 1 Hz `current_uA` snapshots are not physical on this device — median 2 mA in
  an active turn): CPU short turns draw ~49 mAh vs 17 mAh for both NPU and GPU short turns.
  NPU-vs-GPU energy needs per-phase separation the turn-window trace cannot provide; treat
  the mAh table as descriptive only.

## Medians by configuration (both ABBA passes pooled)

Prompt set fixed across all arms (sha256 in `raw/prompts.sha256`): short 54 words → 75
tokens + 1,660 system/tools = `prompt_n` 1735; long 1,264 words → ~1,485 tokens →
`prompt_n` 3145. TTFT here = `promptMs` (prefill window, includes the system prompt).
Decode is CPU everywhere (`engine_decode:"CPU"` in all 37 turns).

| config | prompt | n | prefill tok/s | decode tok/s | TTFT (prefill) |
|---|---|---|---:|---:|---:|
| **NPU** (lane on, auto) | short | 6 | **170.9** | 10.91 | **10.2 s** |
| **NPU** | long | 5 | **120.9** | 9.02 | **26.0 s** |
| AUTO (lane on, auto) | short | 6 | 170.0 | 10.47 | 10.2 s |
| AUTO | long | 4 | 116.0 | 8.89 | 27.1 s |
| **GPU** (lane off) | short | 6 | 115.0 | 10.88 | 15.1 s |
| **GPU** | long | 4 | 101.2 | 10.26 | 30.3 s |
| **CPU** (lane off) | short | 3 | 21.7 | 9.75 | 79.8 s |
| **CPU** | long | 1 | 20.9 | 8.43 | 150.7 s |

Headline ratios (short / long): NPU prefill is **1.49× / 1.20× GPU** and **7.9× / 5.8× CPU**;
NPU TTFT is −32 % / −14 % vs GPU and −87 % / −83 % vs CPU. In-app the NPU advantage over GPU
is much smaller than the bare-bench 4.7× (`governor-npu-prefill/DESIGN.md`) — the governor's
chunk/ubatch pattern is not the bench's, so the bench ratio does not transfer.

AUTO vs NPU rows agree within noise — expected: they are the same configuration (route auto +
lane on), run as separate arms per the ABBA design; the split exists to catch order effects.

## What the governor picked by itself (AUTO arm, per turn)

| turn | state | pick | prefill tok/s |
|---|---|---|---:|
| auto1-s1 | WARM | **GPU** (hop-out) | 170.2 † |
| auto1-s2/s3, auto2-s1/s2/s3 | FAST/COOLMODE | NPU | 152.6–170.3 |
| auto1-l1, auto2-l1/l2/l3 | COOLMODE/FAST | NPU | 110.7–120.2 |

† Label-vs-device divergence, one of the campaign's two real findings: with the lane on, the
execution device is decided at LOAD (`devices={HTP0}`), while `engine_prefill` is the
per-turn policy choice. A "GPU" turn on a lane-on load still runs the HTP context — its
170 tok/s matches NPU, not the true GPU turns (115). `npu2-l1` shows the same (WARM → GPU
label, 121 tok/s = NPU long speed). Harmless for latency (HTP is the better device anyway)
but the label must not be read as the executing backend on lane-on loads.

## Thermal watchdog record (no cool-down gate, per protocol)

| arm | turns done | stop evidence |
|---|---|---|
| npu1 | 6/6 (complete) | — |
| gpu1 | 4/6 (s1–s3, l1) | turn l2 preflight: Thermal Status 3, SKIN 42.2 °C (`raw/arm-gpu1-preflight.txt`) |
| cpu1 | 2/6 (s1, s2) | turn s3 preflight ≥3 after two 67–80 s CPU prefills |
| auto1 | 4/6 | l2 preflight ≥3 |
| auto2 | 4/6 | l2 preflight ≥3 |
| cpu2 | 1/6 | s2 preflight ≥3 |
| gpu2 | 2/6 | s3 preflight ≥3 |
| npu2 | 3/6 | l1 preflight ≥3 |

After the ABBA sequence, missing turns were filled with real cool-downs (thermal status ≤1
AND skin < 38 °C before each group; every turn still gated and recorded): npu2-l1/l2,
gpu1-l2, gpu2-s3/l1/l2/l3, auto2-l2/l3, cpu1-l1. Remaining holes: cpu longs n=1,
cpu shorts n=3 (not 6), gpu1-l3, npu2-l3, auto1-l2/l3 — the battery floor (20 %, phone
unplugged, nobody home) stopped the session at 17:25 with the phone AT 20 %.

Start temperatures were recorded per arm (`raw/arm-*-preflight.txt`) and per turn
(`raw/*-state-pre.txt`): the ABBA sequence ran 25→42 °C skin across npu1; later arms started
as hot as 42 °C — the medians above therefore mix FAST/WARM/COOLMODE turns. Per-turn thermal
state is in the detail table (`raw/detail.md`), so any thermal-sensitive comparison can be
re-cut.

## Operational findings for the next session

1. **Share-in deep link quoting:** `encodeURIComponent` leaves `'` bare; inside the
   single-quoted `-d` argument of `adb shell am start` a raw apostrophe breaks device-shell
   quoting and the staged prompt silently truncates. Fix applied: `'` → `%27` after encoding
   (`raw/turn.sh`, generator one-liner in the session log). Symptom was "STAGE NEVER LANDED" —
   the compose box stays empty because the intent payload is mangled, not lost.
2. **Samsung background-apps dialog steals taps:** a "These apps and services are active
   while running in the background" (Termux) system dialog popped mid-campaign and swallowed
   drawer/send taps. `turn.sh` now detects it and taps "Done" before staging, and aborts the
   turn if it is up at send time.
3. **Cold-load caveat:** only each arm's first turn is a cold load; subsequent turns run in
   the warm app (the force-stop line of the prior-art turn.sh was lost in the rewrite). The
   required "fresh chat per turn" still holds — every turn prefills the full 1735/3145 tokens
   (`prefill_chunks` identical every turn; no KV reuse) — and all arms share the protocol, so
   cross-arm comparisons stand. FastRPC counts are per cold load (each arm's first turn).
4. **NPU prefill in-app is ~171 tok/s (short) / ~121 tok/s (long), not the bare-bench
   ~530** — same-direction as the bench (fastest engine) but far from its ratio. The gap is
   the governor context (chunks of 512/128, per-chunk overhead, KV commit through host
   memory with `no_kv_offload`), not a skel mismatch (the APK v73 skel is byte-identical to
   the validated one, see below).

## Evidence chain

- **APK:** `gh run download 36900648095` → sha256 above; `unzip -l` lists
  `assets/ggml-hexagon/libggml-htp-{v73,v75,v79,v81}.so`; `strings` of
  `librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so` contains 153 `ggml-hex` hits; the APK's
  `libggml-htp-v73.so` sha256 `ddfec439…fce6` equals the node_modules/llama.rn HTP_SKELS
  manifest pin for engine `61c90948` (verified pre-install; `raw/apk.sha256`). Install:
  `adb install -r` Success, exit 0 (`raw/install.log`).
- **Preflight every turn** (`raw/*-battery-pre.txt`, `raw/*-state-pre.txt`): AC/USB/Wireless
  powered false (stored dump, not a match count); battery ≥ 20 % gate; `keyevent 224` +
  `mWakefulness=Awake`; Thermal Status < 3 gate; `persist.traced.enable=0`; Kalsa foreground
  at send (topResumedActivity gate); staged text + enabled Invia verified in the UI dump
  before every send (`raw/*-ui.xml`).
- **Crash sweep:** `dumpsys dropbox` native-crash/tombstone entries after the campaign are
  byte-identical to the pre-campaign baseline — zero new crashes across 37 turns
  (`raw/dropbox-baseline.txt`, `raw/dropbox-final.txt`). No `kalsa.load.dead.*` marker was
  ever set (checked every turn; final check empty).
- **HTP execution proof:** `raw/nativecheck-full.log` (one lane-on turn with
  `kalsa.bench.nativelog=1`, restored to off after): `ggml-hex: device 0: HTP0
  (phys=0, virt=0, domain=cdsp:3)`, `load_tensors: layer N assigned to device HTP0` (all 31),
  `sched_reserve: HTP0 compute buffer size = 129.00 MiB` + `CPU 11.04 MiB`,
  `llama_context: backend_ptrs.size() = 2`.
- **Per-turn raw:** `raw/<label>-kalsa.txt` (KALSA_GOVERNOR/KALSA_TELEMETRY extracts),
  `-hexlog.txt` (ggml/HTP lines), `-fastrpc.txt` (device-wide FastRPC),
  `-state-pre/-post.txt`, `-battery-pre.txt`, `<label>.csv` (1 Hz energy trace),
  `-presend.png` NOT stored (kept in /tmp only); rows table `raw/all-rows.tsv`;
  markdown detail `raw/detail.md`; harness `raw/{env,sqlq,sqlw,turn,arm,campaign*,fills,
  cpulong,parse,summarize}.sh`; campaign logs `raw/campaign*.log`, `raw/fills.log`,
  `raw/cpulong.log`.

## End state (as instructed)

Phone unplugged (all powered=false), screen on/Awake, Kalsa foreground with the model loaded,
level **20 %** (floor reached; everything stopped), thermal status recovering from the last
CPU turn, `persist.traced.enable=0`, no dead markers, no new dropbox entries. Bench keys
restored to the found values (`raw/final-state.txt`): `kalsa.bench.route=gpu`,
`kalsa.bench.npu_lane=off`, `kalsa.bench.energy_trace=1`, `kalsa.bench.nativelog=off`.
Nothing committed or pushed; APK and all binaries remain in `/tmp` (hashes in `raw/`).
