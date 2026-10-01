# S23 governor — first in-app three-engine campaign (NPU / GPU / CPU / AUTO)

Date: 2026-10-01. Probes 15:14–15:20, ABBA campaign 15:23:59–16:44:45, fills 16:46–17:15,
CPU-long run 17:18–17:23, final state 17:25 (device logclock).
Device: Galaxy S23 (SM-S911U, SM8550 / Hexagon v73), serial `R3CW406P8CV`, wireless adb
`192.168.1.152:34673` (`raw/env.sh`).
APK: CI run `36900648095` (`raw/watch.log`), app main `07476dae`, debuggable.
`app-release.apk` sha256
`e53ed1f890fec13ee4f15583a679eaeaf8aaf8b99fa8aa6d5d7970e9dfb5f003` (`raw/apk.sha256`);
install Success (`raw/install.log`). The CI job asserted that the installed HTP skels match
the manifest and the engine pin (`raw/watch.log:14`); no per-`.so` hash is committed.
Model: shipping `LFM2.5-2.6B-QAD-Q4_0` already on the phone (`raw/nativecheck-full.log`).
Runner: device-run agent session; no commits, no pushes; APK kept in `/tmp` and hashed.
Recorded evidence: **35 rows** in `raw/all-rows.tsv`, **34** turns with committed extracts
(34 `*-kalsa.txt`, 34 `*.csv`, 34 `-hexlog`, 34 `-state-post`). `cpu1-l1` is the weak row: only
`-battery-pre`/`-state-pre` plus `raw/cpulong.log`, and it ran under `thermal_state:LOWBAT`.

## Verdict

**The prefill ordering NPU > GPU > CPU holds in-app on the new chain: NPU is 1.49× / 1.17×
GPU and 7.9× / 5.8× CPU (short / long). All four arms ran their route and lane configuration
as ordered; no turn failed, no turn hung (longest turn 239 s against the 300 s guard), no
dead-load marker was ever set.** Long turns on the hot arms were cut by the thermal
watchdog (≥3 SEVERE), as the protocol requires; the cuts are recorded per arm. `raw/arm.sh`
grades only preflight, dead marker and rc — there is no per-arm acceptance clause in the
harness — so the clauses below are applied by this report after the fact.

- **NPU (npu_lane=on, route=auto): passes the engine and lane clauses.** `engine_prefill:"NPU"`
  on 10 of 11 NPU-arm turns, `npu_device:"HTP0"` on all 21 lane-on rows,
  `npu_fallback:null`, `failed:false`, `failure_reason:""`, `route_chunks_dropped:0` on every
  row. Buffer-level HTP evidence exists for **one pre-campaign probe only**
  (`raw/nativecheck-full.log`, short prompt 1735, 15:18 — five minutes before the first arm):
  its first `llama_context` assigns all 31 layers to HTP0 and reserves `HTP0 compute buffer
  129.00 MiB` + `CPU 11.04 MiB` (`backend_ptrs.size() = 2`). The same process then builds a
  **second** context which registers OpenCL, assigns all 31 layers to CPU and reserves only a
  `CPU compute buffer 129.00 MiB`. No per-dispatch or graph-compute HTP line appears anywhere
  in `raw/`, so HTP execution on the campaign turns is inferred from labels and speed, not
  measured. Every turn ended with `dead_marker=none`.
- **GPU (lane off, route=gpu): passes the lane clause.** `npu_device:null` on all 14 lane-off
  rows, route forced to gpu, `actual:"gpu"` on all 75 GPU-arm chunks, and
  `route_mismatch:false` on all 13 lane-off extract rows (`route_mismatch` is `null` on all 21
  lane-on rows).
  6 short and 4 long GPU turns completed; `gpu1-l3` and `gpu2-l2` were refused by the
  watchdog.
- **CPU (lane off, route=cpu): passes the engine clause, is thermally brutal.** Route forced
  to cpu and honored (`actual:"cpu"` on every CPU chunk — 27 in the extracts plus 11 in
  `raw/cpulong.log`), short-prompt prefill 21.7 tok/s,
  79.8 s TTFT median (n=3). One long turn exists: 150.7 s TTFT at 20.9 tok/s — and it is weak
  evidence: `cpu1-l1` has no `-kalsa.txt` and no CSV (numbers live only in `raw/cpulong.log`),
  ran outside the ABBA schedule at battery 24 % with `thermal_state:"LOWBAT"`. Direction is
  consistent with the DESIGN heat table (`governor-npu-prefill/DESIGN.md`: CPU 44.59 °C·s per
  1k tokens vs NPU 6.45).
- **AUTO (lane on, route=auto): passes the pick clause — 9 of 10, not 12 of 13.** Nine of the
  ten AUTO turns carry `engine_prefill:"NPU"`; the exception `auto1-s1` (`thermal_state:WARM`
  right after the CPU arm) carries `GPU`, the designed WARM hop-out, and it ran at 170.2
  tok/s, i.e. at the NPU short median (170.9), not the GPU one (115.1). Counting the NPU arm
  as well, 19 of 21 lane-on turns are labelled NPU. Every FAST or COOLMODE turn was labelled
  NPU — with zero counter-examples, so the rule is consistent with the data but cannot be
  falsified by it.
- **FastRPC gate:** exactly one `fastrpc_apps_user_init done` in each of the 12 non-empty
  `-fastrpc.txt` extracts (6 lane-on, 6 lane-off), with the known benign `error 0x14`
  single-session URI fallback in both cases; the same `error 0x14` shows up on lane-off loads
  (`raw/gpu1-s1-hexlog.txt:2`). `KALSA_GOVERNOR_FALLBACK` appears nowhere in `raw/`, so the
  harness's fallback counter (`raw/parse.sh:12`) is vacuous — the "no fallback" statement rests
  on `npu_fallback:null` and empty failure fields only.
- **Energy:** `kalsa.bench.energy_trace=1` works — one 1 Hz CSV per turn, **34 CSVs**
  (`cpu1-l1`'s CSV is referenced by `raw/energy-per-turn.txt` but not committed). Charge-counter
  deltas over the whole turn: CPU short median 48.75 mAh (n=3) vs 16.9 mAh for both NPU (n=6)
  and GPU (n=6) shorts. The counter quantises in 3.75 mAh steps, and the window contains the
  identical CPU decode plus prompt handling, so treat the table as descriptive only. The 1 Hz
  `current_uA` snapshots are not physical on this device (median 1.9 mA in active turns).

**UNPROVEN after AUDIT-r1:**

- **Per-turn HTP execution.** One pre-campaign short-prompt probe shows HTP0 owning all 31
  layers with a reserved buffer, and it also built a second, CPU/OpenCL context. The per-turn
  `-hexlog.txt` extracts carry only startup lines — 12 of 34 (the cold loads) contain any
  `ggml-hex` line, and none contains `load_tensors`, `sched_reserve` or a dispatch counter.
  Beyond that probe, HTP execution is an inference from `npu_device:"HTP0"`, the label and the
  speed.
- **The AUTO pick rule.** The count does reproduce (9 of 10, or 19 of 21 including the NPU arm
  — the earlier "12 of 13" exists under no row selection), but the rule "NPU whenever the state
  is FAST or COOLMODE" has no counter-example in 19 turns, so it is consistent with the data,
  not demonstrated.
- **Crash-sweep strength.** The final dropbox dump is a *subset* of the baseline (5 lines vs 8;
  `diff` = `1,3d0`), so three pre-campaign tombstones rotated out: no new tombstone entry is
  visible, but the check is weaker than a byte-identical comparison would be, and only the
  npu1 arm sweep was committed. What supports "no crash" is the newest tombstone being dated
  `2026-09-30 23:53` (`raw/arm-npu1-tombstones.txt`), `dead_marker=none` on every turn, and
  `failed:false` on every governor line.

## Medians by configuration (both ABBA passes pooled)

Prompt set fixed across all arms (sha256 in `raw/prompts.sha256`): short 54 words → 75
tokens + 1,660 system/tools = `prompt_n` 1735; long 1,264 words → ~1,485 tokens →
`prompt_n` 3145. TTFT here = `promptMs` (prefill window, includes the system prompt).
Decode is CPU everywhere (`engine_decode:"CPU"` in all 35 rows).
`gpu2-l3` is excluded (prefix reuse, see below), so GPU long has n=3.

| config | prompt | n | prefill tok/s | decode tok/s | TTFT (prefill) |
|---|---|---:|---:|---:|---:|
| **NPU** (lane on, auto) | short | 6 | **170.9** | 10.91 | **10.2 s** |
| **NPU** | long | 5 | **120.9** | 9.02 | **26.0 s** |
| AUTO (lane on, auto) | short | 6 | 170.0 | 10.47 | 10.2 s |
| AUTO | long | 4 | 116.0 | 8.89 | 27.1 s |
| **GPU** (lane off) | short | 6 | 115.1 | 10.88 | 15.1 s |
| **GPU** | long | 3 | 103.3 | 10.29 | 30.4 s |
| **CPU** (lane off) | short | 3 | 21.7 | 9.75 | 79.8 s |
| **CPU** | long | 1 | 20.9 | 8.43 | 150.7 s |

Headline ratios (short / long): NPU prefill is **1.49× / 1.17× GPU** and **7.9× / 5.8× CPU**
(the long CPU figure is the single weak `cpu1-l1` turn); NPU TTFT is −33 % / −15 % vs GPU and
−87 % / −83 % vs CPU. The long GPU ratio was 1.20× only while `gpu2-l3` sat in the set:
`raw/gpu2-l3-kalsa.txt:17` reads `KALSA_KVPREFIX embd=1660 text_tokens=3145 n_common=1660`,
i.e. 1,660 of 3,145 tokens came from a cached prefix, so its 87.6 tok/s row measured different
work from the other GPU longs. It is the only turn in the campaign with `n_common>0`.
In-app the NPU advantage over GPU is much smaller than the bare-bench 4.7×
(`governor-npu-prefill/DESIGN.md`) — the governor's chunk/ubatch pattern is not the bench's,
so the bench ratio does not transfer.

Two caveats the pooled medians hide:

- **Thermal and chunk mix.** Over the 34 extracts: COOLMODE 16, FAST 14, WARM 4; `cpu1-l1`
  adds one LOWBAT. Start skin temperature across all `-state-pre.txt` spans 31.4–42.6 °C
  (npu1 itself 31.4 → 41.3). Chunking is not constant: all 34 extracts have a distinct
  `prefill_chunks` string, and 6 of 34 turns ran the all-128 regime — `auto1-l1`, `auto2-l1`,
  `auto2-s2`, `auto2-s3`, `cpu2-s1`, `npu2-s3`, all of them in COOLMODE, so regime and thermal
  state are confounded (`auto1-s2` 169.8 vs `auto2-s2` 152.6 tok/s, same prompt, both COOLMODE).
- **Pass order.** Pass 2 vs pass 1 (median prefill tok/s): npu short −3.1 % (3 vs 3), gpu
  short −3.0 % (3 vs 3), auto short −10.0 % (3 vs 3), cpu short −9.4 % (2 vs 1), npu long
  −0.8 % (3 vs 2). The two remaining cells are thin and point the other way: gpu long +1.8 %
  (2 vs 1) and auto long +4.9 % (1 vs 3).
  AUTO and NPU pooled medians differ −0.5 % (short) and −4.1 % (long); the split exists to
  catch exactly this, so the earlier "within noise" wording was wrong.

## What the governor picked by itself (AUTO arm, per turn)

| turn | state | pick | prefill tok/s |
|---|---|---|---:|
| auto1-s1 | WARM | **GPU** (hop-out) | 170.2 † |
| auto1-s2/s3, auto2-s1/s2/s3 | COOLMODE/FAST | NPU | 152.6–170.3 |
| auto1-l1, auto2-l1/l2/l3 | COOLMODE/FAST | NPU | 110.7–120.2 |

† **Label vs device, rewritten.** The per-chunk field does not identify a backend: across the
34 extracts there are 303 `"actual":"gpu"`, 27 `"actual":"cpu"` and **0** `"actual":"npu"`.
All 228 chunks of the 21 lane-on turns say `gpu`, including the 19 turns whose
`engine_prefill` says `NPU`. On lane-off turns `actual` simply mirrors the forced route and
`route_mismatch:false`; on lane-on rows `route_mismatch` is `null`. So the divergence the
first version of this report described as a two-turn finding is present on **every lane-on
turn**. On lane-on loads the executing device is decided at load time, while
`engine_prefill` is the per-turn policy choice; the only per-turn device readout is
`npu_device` (HTP0 on all 21 lane-on rows, null on all 14 lane-off rows). A "GPU"-labelled
turn on a lane-on load still shows `npu_device:"HTP0"` and runs at NPU speed — `auto1-s1`
170.2 tok/s vs the NPU short median 170.9 (true GPU short: 115.1), `npu2-l1` 121.0 tok/s vs
the NPU long median 120.9 (true GPU long: 103.3). That is an indirect inference from speed,
not a device trace, and it is harmless for latency only because HTP is the better device.

## Thermal watchdog record (no cool-down gate, per protocol)

Turn counts are for the ABBA pass; fills are listed below the table.

| arm | ABBA turns | stop evidence |
|---|---|---|
| npu1 | 6/6 (complete) | — (`raw/campaign.log:36`, rc=0) |
| gpu1 | 4/6 (s1–s3, l1) | first attempt refused at arm preflight, Thermal Status 3 (`raw/campaign.log:39-41`); second run stopped at l2 (`raw/campaign2.log:28-29`) |
| cpu1 | 2/6 (s1, s2) | s3 stop (`raw/campaign3.log:20-21`) after two 67–80 s CPU prefills |
| auto1 | 4/6 | l2 stop (`raw/campaign3.log:50-51`) |
| auto2 | 4/6 | l2 stop (`raw/campaign3.log:80-81`) |
| cpu2 | 1/6 | s2 stop (`raw/campaign3.log:98-99`) |
| gpu2 | 2/6 | s3 stop (`raw/campaign3.log:120-121`) |
| npu2 | 3/6 | l1 stop (`raw/campaign3.log:146-147`) |

Fills (with real cool-downs: thermal status ≤1 and skin < 38 °C before each group; every turn
still gated and recorded): `npu2-l1`, `npu2-l2`, `gpu1-l2`, `gpu2-s3`, `gpu2-l1`, `gpu2-l3`,
`auto2-l2`, `auto2-l3`, and `cpu1-l1` (bespoke `raw/cpulong.sh`). Refused by the watchdog
during fills: `npu2-l3`, `gpu1-l3`, `gpu2-l2` (`raw/fills.log:12,21,34`). `cpu2-l1` never ran:
the guard in `raw/cpulong.sh` failed on battery, reported as `rc=1` in `raw/cpulong.log`.
After the fills the totals are npu1 6, npu2 5, gpu1 5, gpu2 5, auto1 4, auto2 6, cpu1 3,
cpu2 1 = **35 rows**.

Remaining holes (13 of 48 planned turns): `gpu1-l3`, `gpu2-l2`, `npu2-l3`, `auto1-l2`,
`auto1-l3`, `cpu1-s3`, `cpu1-l2`, `cpu1-l3`, `cpu2-s2`, `cpu2-s3`, `cpu2-l1`, `cpu2-l2`,
`cpu2-l3` — i.e. cpu longs n=1, cpu shorts n=3 of 12, plus the thermal refusals above. The
battery never went below 24 % during turns; it reached the 20 % floor at 17:22, after which
no turn could pass the `≥20 %` gate (`raw/turn.sh:17`), and the session ended at 17:25 with
the phone AT 20 % (`raw/final-state.txt`).

Start temperatures were recorded per arm (`raw/arm-*-preflight.txt`) and per turn
(`raw/*-state-pre.txt`): the ABBA sequence ran 31.4→41.3 °C skin across npu1; later arms
started as hot as 42.6 °C — the medians above therefore mix FAST/WARM/COOLMODE turns, and the
COOLMODE turns are also the all-128-chunk turns. Per-turn thermal state is in
`raw/detail.md` (34 rows; it does not contain `cpu1-l1`), so any thermal-sensitive comparison
can be re-cut.

## Operational findings for the next session

1. **Share-in deep link quoting:** `encodeURIComponent` leaves `'` bare; inside the
   single-quoted `-d` argument of `adb shell am start` a raw apostrophe breaks device-shell
   quoting and the staged prompt silently truncates. Fix applied: `'` → `%27` after encoding
   (`raw/turn.sh:46`, `raw/enc-short.txt` already contains `battery%27percentage`). Symptom was
   "STAGE NEVER LANDED" — the compose box stays empty because the intent payload is mangled,
   not lost. The payload is still interpolated inside the device-shell single-quoted string, so
   any other shell metacharacter (`$`, `` ` ``, `!`, newline) would truncate it the same way.
2. **Samsung background-apps dialog steals taps:** a "These apps and services are active while
   running in the background" (Termux) system dialog popped mid-campaign and swallowed
   drawer/send taps. `raw/turn.sh` now detects it before the send and taps "Done" if it is up
   (`raw/turn.sh:39,67`), and aborts the turn at send time.
3. **Cold-load caveat:** 13 turns carried a `KALSA_GOVERNOR_PLAN` line — a fresh process, not
   just a fresh chat; the rest ran in the warm app (the force-stop line of the prior-art
   `turn.sh` was lost in the rewrite). Fresh chat per turn does hold: every turn prefills the
   full 1735/3145 tokens. What does *not* hold is "identical chunking, no KV reuse": all 34
   extracts have distinct `prefill_chunks`, and `gpu2-l3` reused a 1,660-token prefix. Those 13
   cold loads also paid a `KALSA_PREWARM` of the 1,660-token system prefix that is in neither
   the TTFT nor the energy table: 9.6–15.4 s on the NPU/GPU/AUTO arms, 57.9–60.3 s on the two
   CPU-arm cold loads (`promptN:1660`). FastRPC counts are per process init, i.e. per cold load.
   Cross-arm comparisons share the protocol, but chunk regime is confounded with COOLMODE.
4. **NPU prefill in-app is ~171 tok/s (short) / ~121 tok/s (long),** far below the bench ratio
   of 4.7× over GPU (`governor-npu-prefill/DESIGN.md`) — same direction as the bench (fastest
   engine) but much smaller. The gap is the governor context (chunks of 512/128, per-chunk
   overhead, KV commit through host memory with `no_kv_offload`), not a skel mismatch: the CI
   job asserted the installed skels match the manifest and the engine pin before install
   (`raw/watch.log:14`).

## Evidence chain

- **APK:** `gh run download 36900648095` → sha256 above (`raw/apk.sha256`; the file path in it
  names app commit `07476daef029d39dc85e6b4451d54ff8af1d4d46` and the `…-debuggable-…` artifact);
  CI asserted engine pin and HTP skel/manifest match (`raw/watch.log:14`); install
  `adb install -r` Success, exit 0 (`raw/install.log`). Not committed: `unzip -l` of the APK,
  `strings` output, and any `libggml-htp-v73.so` hash — those claims are not reproducible from
  `raw/`.
- **Preflight:** 41 `raw/*-battery-pre.txt` (AC/USB/Wireless powered false in all 41; lowest
  level 24; battery `≥20 %` gate in `raw/turn.sh:17`) and 41 `raw/*-state-pre.txt`
  (`mWakefulness=Awake` in all 41; Thermal Status 0–2 on every completed start, Status 3 on the
  6 refused turns; last line `0` = `getprop persist.traced.enable`). Eight
  `raw/arm-*-preflight.txt` gate the arms. Send-time checks live in `raw/turn.sh`, not in
  preflight: staged fragment + `Invia` enabled (`:58`), `MainActivity` as topResumedActivity
  (`:62`), background dialog absent (`:67`). The UI dumps those checks read
  (`$LABEL-ui*.xml`) were written to `/tmp/s23-gov` and are **not in `raw/`** — zero `*.xml`
  files are committed, so staged-text verification cannot be re-checked from the directory.
- **Crash sweep:** `dumpsys dropbox` before/after the campaign — baseline 8 lines, final 5,
  `diff` = `1,3d0`: no new entry visible, but three baseline tombstones rotated out, so the
  comparison cannot prove "zero new crashes". Both dumps came from the lossy filter
  `grep -E "^\d|data_app_native_crash|SYSTEM_TOMBSTONE" | tail -40` (`raw/arm.sh:28`) and carry
  no crash text at all. Only the npu1 arm sweep was committed
  (`raw/arm-npu1-tombstones.txt`, `raw/arm-npu1-dropbox.txt`); the newest tombstone is
  `2026-09-30 23:53`. No `kalsa.load.dead.*` marker was ever set (36 `dead_marker=none` lines
  across the campaign, fills and CPU-long logs; final check empty).
- **HTP probe (one turn, pre-campaign):** `raw/nativecheck-full.log`
  (`kalsa.bench.nativelog=1`, restored to off after): `ggml-hex: device 0: HTP0 (phys=0,
  virt=0, domain=cdsp:3)`, `load_tensors … assigned to device HTP0` for all 31 layers,
  `sched_reserve: HTP0 compute buffer size = 129.00 MiB` + `CPU 11.04 MiB`,
  `llama_context: backend_ptrs.size() = 2`. The second context in the same log assigns all 31
  layers to CPU, registers `ggml_opencl` (Adreno 740) and reserves `CPU compute buffer
  129.00 MiB` (`:3316`). Per-turn `-hexlog.txt` extracts are startup-only (12 of 34 have any
  `ggml-hex` line — the cold loads, which also show `Extracted HTP library: libggml-htp-v73.so`
  and a plan-time `npu_device:"HTP0"`). The probe is a short-prompt turn at 15:18:23, five minutes before
  `raw/campaign.log:1`; it is not one of the 35 rows. `raw/npucheck-full.log` is the matching
  15:14 probe and is otherwise unreferenced.
- **Per-turn raw:** `raw/<label>-kalsa.txt` (KALSA_GOVERNOR/KALSA_TELEMETRY extracts, 34),
  `-hexlog.txt` (ggml/HTP lines, 34), `-fastrpc.txt`, `-state-pre.txt` (41),
  `-state-post.txt` (34), `-battery-pre.txt` (41), `<label>.csv` (34), `-presend.png` NOT
  stored and `-ui.xml` NOT stored (both only in `/tmp`); rows table `raw/all-rows.tsv` (35);
  markdown detail `raw/detail.md` (34, no `cpu1-l1`); harness `raw/{env,sqlq,sqlw,turn,arm,
  campaign*,fills,cpulong,parse,summarize}.sh`; logs `raw/campaign*.log`, `raw/fills.log`,
  `raw/cpulong.log`. Derived energy files `raw/energy-per-turn.txt` and `raw/energy-cc.txt`
  both contain a `cpu1-l1` row whose CSV was not committed.

## End state (as instructed)

Phone unplugged (AC/USB/Wireless powered false), screen on/`mWakefulness=Awake`, **Samsung
launcher in the foreground** — `raw/final-state.txt:31` is
`topResumedActivity=… com.sec.android.app.launcher/com.android.quickstep.RecentsActivity`,
not Kalsa — level **20 %** (floor reached; the `≥20 %` gate stops any further turn), thermal
status 1 (recovering from the last CPU turn), `persist.traced.enable` off, no dead markers.
Bench keys restored to the found values (`raw/final-state.txt:33-37`):
`kalsa.bench.route=gpu`, `kalsa.bench.npu_lane=off`, `kalsa.bench.energy_trace=1`,
`kalsa.bench.nativelog=off`, `kalsa.bench.kvtranscript=1`. Nothing committed or pushed; APK
and all binaries remain in `/tmp` (hashes in `raw/`).

## Corrections (2026-10-01, from AUDIT-r1)

1. **Turn counts** now 35 recorded rows / 34 turns with extracts / 34 CSVs / 34 `-kalsa.txt`
   (was "37" everywhere); `cpu1-l1` flagged as weak (no extract, no CSV, LOWBAT, outside ABBA).
2. **`gpu2-l3` excluded** from the GPU-long median (reused 1,660-token prefix): GPU long n=3,
   103.3 tok/s, and the NPU/GPU long ratio restated as **1.17×** (was 1.20×); GPU short
   restated 115.1 (was 115.0); TTFT ratios recomputed (−33 % / −15 % vs GPU).
3. **AUTO pick count** restated as **9 of 10** (19 of 21 including the NPU arm); "12 of 13"
   does not reproduce under any row selection.
4. **Label-vs-device** rewritten: `"actual"` is `gpu` on every lane-on chunk (303 gpu / 27 cpu /
   0 npu overall), so the divergence is present on all 21 lane-on turns, not two.
5. **Crash sweep** restated: dropbox final is a subset of baseline (8 → 5 lines, `1,3d0`), not
   byte-identical; "no new tombstone entries visible; baseline entries rotated, so the check is
   weaker than claimed". The `c26ba8bc`/SET_ROWS claim removed (the string is nowhere in `raw/`).
6. **End state** corrected to the Samsung launcher `RecentsActivity`, not Kalsa.
7. **`raw/*-ui.xml` claims removed** (zero `*.xml` files exist); the send-time checks are
   attributed to `raw/turn.sh` instead. Related: the gpu1 watchdog citation to
   `raw/arm-gpu1-preflight.txt` (which ends `Thermal Status: 0`) replaced by the campaign logs.
8. **HTP "proven at buffer level"** downgraded to one pre-campaign short-prompt probe; the
   second (OpenCL/CPU) `llama_context` in that log is now disclosed; per-turn HTP execution
   listed as UNPROVEN.
9. **"Fresh chat, identical chunks, no KV reuse"** corrected: 34 distinct `prefill_chunks`
   strings, one prefix-reuse turn, all-128 regime confounded with COOLMODE (6 turns); thermal
   mix now includes the LOWBAT row; skin range corrected to 31.4–42.6 °C (was "25→42").
10. **Pass order** reported with numbers (pass 2 slower in 4 of 6 cells, −3 % to −10 %) instead
    of "AUTO vs NPU within noise".
11. **Watchdog table** fixed: stop evidence points at the campaign logs; fills list corrected
    (`gpu2-l2` never ran, `cpu2-l1` skipped by a battery guard); holes list complete (13).
12. **Energy** restated from the 34 CSVs (CPU 48.75, NPU 16.9, GPU 16.9 mAh short medians,
    3.75 mAh quantisation, whole-turn window) and the CSV count corrected to 34; the AUDIT's
    "GPU short = 15.0 mAh" does not reproduce — the six deltas are 11.25, 15.0, 15.0, 18.75,
    26.25, 30.0, median 16.9.
13. **Skel/hash, `unzip -l`, `strings` hits, `lane_off_devices`, `~530 tok/s`** removed: none
    of them is in `raw/`; the CI assertion in `raw/watch.log:14` is kept instead.
14. **Harness weaknesses noted in the audit** (vacuous fallback grep, `tail -40` crash filter,
    `tail -1` on multi-round turns, energy CSV collection order-dependent, `cpu2-l1` guard
    reported as `rc=1`) are now stated where they touch a claim.
