# S23 layers_device proof — per-turn device attribution for in-app prefill

Date: 2026-10-02 00:34–01:00 EDT (device logclock). Device: Galaxy S23 (SM-S911U,
SM8550 / Adreno 740 / Hexagon v73), serial `R3CW406P8CV`, wireless adb
`192.168.1.152:34673` (`raw/env.sh`). Chain: app main `101c2bdd`
(`raw/ci-run.txt`, CI run `36951238850` "APK (device build)", success, headSha
`101c2bddf9bfa1389bb200eca2d43d3be59e3fdb`) = binding `kalsa.rn@7c12bdc6` =
engine `5b596ce43` (pinned by the app repo's `build(deps)` commit; the skel
manifest pin is `ENGINE_COMMIT=5b596ce432ee08acdc6559ed656292038ce75f24`,
`raw/skel-v73-check.txt`).

APK: `gh run download 36951238850 -R Aspis0/kalsa`, artifact
`kalsa-apk-arm64-v8a-debuggable-101c2bdd…/app-release.apk`, sha256
`3e80de8c2badd3e0027524d8dddb1343946e530e4901c3cf08111330f9bb9a52`
(`raw/apk.sha256`). `unzip -l` lists all four skels
(`raw/apk-htp-listing.txt`); the extracted `assets/ggml-hexagon/libggml-htp-v73.so`
hashes to `7c693a43…9adfa`, byte-identical to the v73 line of
`llama.rn-kalsa-gov-platform/bin/arm64-v8a/HTP_SKELS` (`raw/skel-v73-check.txt`).
Install: `adb install -r`, `Success` (`raw/install.log`); no uninstall, no data clear.

## Verdict

**PASS — the per-chunk `layers_device` field in `KALSA_GOVERNOR` proves per turn
which device runs in-app prefill. All 67 route chunks of the 8 turns name a
device: 46/46 lane-on chunks say `HTP0` (NPU), 21/21 lane-off GPU chunks say
`GPUOpenCL` (OpenCL), 0 chunks unnamed. On lane-on turns the chunk label
`actual:"gpu"` (67/67 chunks) does not describe the executing device;
`layers_device` does. The forced turn shows it directly: `route=gpu` honored
(`route_mismatch:false`, every chunk `requested:"gpu"`, `actual:"gpu"`,
`forced:true`) while all 6 chunks executed on `HTP0` at NPU speed (167.5 tok/s
vs 101.9–112.2 on true GPU turns).** Every turn: `n_common=0` (no prefix reuse),
`failed:false`, `route_chunks_dropped:0`, exactly one `KALSA_GOVERNOR` line,
`dead_marker=none`, longest turn 117 s against the 300 s guard (session console;
`raw/proof-*-sendtime.txt` + `-kalsa.txt` are the per-turn anchors).

## Per-turn table

Arm keys per turn in `raw/arm-*.keys.txt` (written with the app force-stopped,
verified read-back). `state` = governor `thermal_state`; `plat` = `platform_thermal_status`.
Prefill tok/s = `prompt_n / (promptMs/1000)`. Battery level is turn start
(`-battery-pre.txt`); battery went 84 → 68 over the whole session including
debugging and idle time.

| label | arm | prompt | state/plat | lvl | chunks | actual | layers_device | prefill tok/s | prompt_n | n_common | decode tok/s | npu_device |
|---|---|---|---|---:|---:|---|---|---:|---:|---:|---:|---|
| proof-npu-s1 | lane on, auto | short | FAST/0 | 80 | 6 | gpu×6 | **HTP0×6** | 178.2 | 1735 | 0 | 11.3 | HTP0 |
| proof-npu-s2 | lane on, auto | short | FAST/0 | 79 | 6 | gpu×6 | **HTP0×6** | 177.5 | 1735 | 0 | 11.1 | HTP0 |
| proof-npu-s3 | lane on, auto | short | FAST/0 | 77 | 6 | gpu×6 | **HTP0×6** | 173.9 | 1735 | 0 | 10.2 | HTP0 |
| proof-npu-l1 | lane on, auto | long | WARM/1 | 76 | 11 | gpu×11 | **HTP0×11** | 120.8 | 3145 | 0 | 8.9 | HTP0 |
| proof-npu-l2 | lane on, auto | long | COOLMODE/2 | 75 | 11 | gpu×11 | **HTP0×11** | 119.6 | 3145 | 0 | 8.4 | HTP0 |
| proof-gpu-s1 | lane off, gpu | short | FAST/1 | 72 | 6 | gpu×6 | **GPUOpenCL×6** | 112.2 | 1735 | 0 | 10.7 | null |
| proof-gpu-s2 | lane off, gpu | short | COOLMODE/2 | 71 | 15 | gpu×15 | **GPUOpenCL×15** | 101.9 | 1735 | 0 | 9.7 | null |
| proof-forcegpu-s1 | lane on, forced gpu | short | WARM/1 | 70 | 6 | gpu×6 | **HTP0×6** | 167.5 | 1735 | 0 | 9.8 | HTP0 |

Machine-checked totals: 46 `"layers_device":"HTP0"` + 21
`"layers_device":"GPUOpenCL"` = 67 chunks; 67 `"actual":"gpu"`; 0
`n_common=[1-9]`; 0 `"failed":true`; 0 `route_chunks_dropped≠0` (grep counts over
the 8 `raw/proof-*-kalsa.txt`). All three PASS clauses of the assignment hold:

1. **Lane-on (npu arm + forced, 6 turns):** every chunk `layers_device:"HTP0"`.
2. **Lane-off GPU (2 turns):** every chunk names the OpenCL device — the engine
   calls it `GPUOpenCL` (`raw/proof-gpu-s1-kalsa.txt`).
3. **Lane-on forced `route=gpu` (`proof-forcegpu-s1`):** `actual:"gpu"` on all
   chunks **and** `layers_device:"HTP0"` on all chunks, at NPU speed. This is
   the "label != device" case, measured per chunk instead of inferred from
   `npu_device` + tok/s (how the previous campaign had to argue it).

Note `proof-npu-l1`: `engine_prefill:"GPU"` at `thermal_state:"WARM"` (the
designed WARM hop-out label) while all 11 chunks still ran `HTP0` at 120.8 tok/s
— the label/device divergence exists inside the NPU arm too, and `layers_device`
resolves it per turn.

Speeds are consistent with the previous campaign's medians (s23-governor-npu-gpu-cpu:
NPU short 170.9 / long 120.9, GPU short 115.1) — turns here are all cold loads
(force-stop each turn), so no warm/cold mix. Thermal states spanned
FAST/COOLMODE/WARM with start Thermal Status 0–2 (owner-rule gate; the harness
waits in 120 s steps if status ≥ 3, never triggered: max start status seen 0).

## Protocol

Reuse of `s23-governor-npu-gpu-cpu/raw/{env,turn,arm,parse}.sh`, adapted
(`raw/turn.sh`, `raw/env.sh`, `raw/sqlq.sh`, `raw/sqlw.sh`, `raw/extract.sh`):
per turn — preflight (unplugged via `dumpsys battery` field parse, level ≥ 20,
wake 224 + MENU-82 keyguard dismissal + `showing=false` gate, Thermal Status
0–2, `persist.traced.enable=0`), force-stop + cold launch + 30 s settle,
dead-marker recovery loop, fresh chat, compose clear, share deep link
(`'`→`%27` quoting kept; `raw/enc-*.txt`), staged-fragment + `Invia`-enabled
gate, `topResumedActivity` = `MainActivity` gate at send, Samsung
background-apps dialog guard, 300 s telemetry hang guard, per-turn collection
(`-kalsa.txt`, `-hexlog.txt`, `-fastrpc.txt`, `-state-pre/-post.txt`,
`-battery-pre.txt`, `-ui*.xml`, `-sendtime.txt`, `-stage-count.txt`,
`-amstart.txt`). Prompts are the previous run's files, sha256-verified
(`raw/prompts.sha256`). UI dumps are committed this time (the r1 audit found
them missing); presend screenshots stayed in /tmp (`raw/` is text-only).
Bench keys found before any write and restored after (`raw/keys-found.txt`,
`raw/keys-restored.txt`): `route=gpu`, `npu_lane=off`, `energy_trace=1`,
`kvtranscript=1`, `nativelog=off`.

## Operational findings (all fixed in `raw/turn.sh`, evidence in `raw/`)

1. **Lockscreen re-doze:** after `install -r` the phone was `mWakefulness=Dozing`
   with the keyguard up; `keyevent 224` alone re-dozes in ~5 s
   (`mUserActivityTimeoutOverrideFromWindowManager=5000` while showing). The
   harness now wakes, sends MENU (82) to dismiss the non-secure keyguard (swipe
   fallback), and gates on `showing=false` in every `-state-pre.txt`. The first
   two staging attempts failed on this (`raw/baseline-state.txt`).
2. **The share deep link handler is stateful in a warm process:** with the app
   warm, a fire after a *successful* stage is silently ignored
   ("delivered to top-most instance", nothing staged), while the fire after a
   *failed* fire succeeds — the runs alternated fail/success perfectly (8
   consecutive observations). The prior-art `turn.sh` force-stop line (lost in
   that rewrite, flagged by AUDIT-r1) is restored: `am force-stop` before every
   turn makes staging deterministic — all 8 turns staged on the first fire
   (`-stage-count.txt` all `1`). Evidence: `raw/debug-warm-relaunch3-*.xml`
   (fire on a warm process that had just staged → compose empty) vs
   `raw/debug-warm-relaunch-after-failed-fire.xml` (same warm flow after a
   failed fire → staged), produced by `raw/bisect.sh`.
3. **Compose draft carry-over + append semantics:** this build carries the
   compose draft across "Nuova chat" and the deep link APPENDS to existing
   compose text (verified interactively: 1× → fire → 2×). The harness clears
   the compose (tap, CTRL+A, DEL, BACK) between the fresh chat and the link.
   With force-stop + clear, single staging is proven by `prompt_n` 1735/3145 on
   every turn and `-stage-count.txt` = 1.

Six early staging attempts (before the force-stop fix) never reached send; they
left no measurements and their artifacts were removed — nothing is excluded
from the record.

## Evidence map

- Per turn `raw/proof-<label>-*`: `-kalsa.txt` (KALSA_GOVERNOR/KALSA_TELEMETRY/
  KALSA_KVPREFIX extracts; the governor line carries `route_chunks[].actual`
  and `.layers_device`), `-hexlog.txt`, `-fastrpc.txt`, `-battery-pre.txt`,
  `-state-pre.txt` (wakefulness + keyguard + thermal + traced), `-state-post.txt`,
  `-ui-load/-dlg/-ui/-ui-presend/-ui-prelink/-ui-postlink.xml` (staged-text and
  dialog verification, committed per the r1 audit), `-presend` screenshot in
  /tmp only (text-only raw), `-sendtime.txt`, `-stage-count.txt`, `-amstart.txt`.
- Cross-turn: `raw/all-rows.tsv` (8 rows, machine-generated by
  `raw/extract.sh`), `raw/arm-{npu,gpu,forcegpu}-keys.txt`,
  `raw/keys-found.txt`, `raw/keys-restored.txt`, `raw/baseline-state.txt`,
  `raw/final-state.txt`.
- APK chain: `raw/ci-run.txt`, `raw/apk.sha256`, `raw/apk-htp-listing.txt`,
  `raw/skel-v73-check.txt`, `raw/install.log`.

## End state (as instructed)

`raw/final-state.txt`: unplugged (AC/USB/Wireless powered false), level 68,
`mWakefulness=Awake`, keyguard `showing=false`, Thermal Status 2,
`persist.traced.enable=0`, **`topResumedActivity=… com.kalsa.app/.MainActivity`**
(Kalsa foreground, not the launcher — the r1 audit's finding not repeated), and
the bench keys restored to the found values. No dead markers were set at any
point (`dead_marker=none` on all 8 turns; no `kalsa.load.dead%` keys in the
extracts). Nothing but this campaign's own text files is committed.
