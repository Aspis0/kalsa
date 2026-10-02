# S23 functional check — debuggable APK 0b7c5e71 (NPU-lane KV on HTP0, DEBUG log filter, Expo 57 / Node 22)

Date: 2026-10-02, 11:49–12:55 EDT (Mac clock). Device: Galaxy S23 (SM-S911U, SM8550 /
Hexagon v73), serial `R3CW406P8CV`, wireless adb `192.168.1.152:35017`. ON CHARGER the
whole session (owner-allowed for this session); this is a FUNCTIONAL check, no benchmark.
Model: `LFM2.5 2.6B` (`kalsa.model.id=lfm2.5-2.6b`, chip confirmed in the UI).

**APK:** CI run `37028997487` (Aspis0/kalsa, "APK (device build)"), success; artifact
`kalsa-apk-arm64-v8a-debuggable-0b7c5e71d6d8c55e5e0dbb848dff1d3c3e3fc089/app-release.apk`,
190,540,698 B, sha256
`29b2ee997fe180aea227426f1a4fff72e08b7f215b7a5a95ff9311f0b92c4dd9` (`raw/apk.sha256`).
`unzip -l` lists `librnllama…hexagon_opencl.so` + `librnllama_jni…hexagon_opencl.so` and
FOUR HTP skels `assets/ggml-hexagon/libggml-htp-v73/v75/v79/v81.so`. `adb install -r`
Success (`raw/install.log`); no uninstall, no data clear.

**Preflight:** `persist.traced.enable=0` before start and at end; battery temperature
29.8 °C at start → 36.1 °C at end (peak during turns 38.8 °C, watchdog limit 44.0 °C never
reached); Thermal Status 0 at start, 1 at end; screen Awake + Kalsa MainActivity
topResumed verified at every send and post-turn state read.

**Bench keys, step 0 (run-as, debuggable build), found before any write** (`raw/keys-before.txt`):
`route=auto, npu_lane=on, devmodels=1, nativelog=off, energy_trace=1, kvtranscript=1` —
the values the previous (expo57-smoke) session left armed; `devmodels` provenance: absent
before that smoke (`s23-expo57-smoke/raw/keys-before.txt` has no devmodels row).
Armed for this check: `npu_lane=on, route=auto` (kept) + `nativelog` enabled.

## Verdict table

| # | check | verdict | key evidence (quoted) |
|---|---|---|---|
| 1 | load: plan HTP0 + KV override, no abort, no tombstone | **PASS** | `KALSA_GOVERNOR_PLAN {…"npu_device":"HTP0","npu_fallback":null,"npu_lane":"on"}`; `RNLlama : load_governor_models:183 KALSA_KV_TYPE_OVERRIDE {requested_k:"q8_0", requested_v:"q4_0", effective_k:"q8_0", effective_v:"q8_0", reason:"htp-prefill-kv"}` (at boot 12:32:58 and again at first-turn load 12:36:33); 0 abort/fatal/SIGSEGV lines in the process; tombstones unchanged (`tombstone_05` newest before and after); `MemAvailable` after load 2,160,192 kB |
| 2 | short turn "17 per 23" → 391, HTP0 chunks, KV fields | **PASS** | UI `text="391"`; `KALSA_GOVERNOR {"engine_prefill":"NPU",…,"npu_device":"HTP0",…,"cache_type_k":"q8_0","cache_type_v":"q8_0","prefill_kv":"device",…,"route_chunks":[{"index":0,…,"tokens":26,"prefill_ms":139,…,"layers_device":"HTP0"}],"route_chunks_dropped":0,…,"failed":false}` |
| 3 | long turn needle ZAFFIRO-42, all chunks HTP0, no hang | **PASS** | prompt 3,084 tokens total (`KALSA_KVPREFIX embd=1814 text_tokens=3084 n_common=1814`), 1,270 fresh tokens prefilled in 4 chunks, ALL `layers_device":"HTP0"` (512+512+128+118); `KALSA_TELEMETRY {…"promptMs":1873.545,…,"prompt_n":1270,…}`; turn finished in 16 s, 300 s no-new-line guard never tripped; UI `text="ZAFFIRO-42"` |
| 4 | follow-up in SAME chat (KV handoff NPU→CPU decode) | **PASS** | `KALSA_KVPREFIX embd=3192 text_tokens=3215 n_common=3192` — the whole 3,192-token KV handed over, 23 fresh tokens prefilled, `engine_decode":"CPU"`; UI `text="391"` (correct recall of turn 1) |
| 5 | privacy: "awaiting trigger" = 0, KALSA_NATIVE info > 0 | **PASS** | `awaiting trigger`: 0 in live `logcat -d` (mid-session and at end) and 0 in the whole-session capture; `KALSA_NATIVE info`: 1,285 lines in the session capture, 498 in the mirror-on process alone (boot + 1 short turn). See disclosure below |
| 6 | lane OFF: Australia turn works, no KV override | **PASS** | UI `text="Canberra"`; lane-off boot `KALSA_GOVERNOR_PLAN {…"npu_device":null,…,"npu_lane":"off"}`; `KALSA_KV_TYPE_OVERRIDE` count in the whole lane-off process: 0. Observation: attempt 1 aborted via the designed admission gate — `KALSA_NATIVE error fail: prefill admission aborted` → `KALSA_GOVERNOR_FALLBACK {stage:"decode",…,reason:"prefill admission aborted"}` → `KALSA_GOVERNOR_RUNTIME_FALLBACK {…,"attempt":2}` — attempt 2 completed (`failed:false`, `thermal_state:"Unknown"` on that line) |
| 7 | keys restored + read back | **PASS** | `raw/keys-restored.txt`: `route=gpu, npu_lane=off, devmodels=<absent>, nativelog=off, energy_trace=1, kvtranscript=1`; final boot with restored keys logs `KALSA_GOVERNOR_PLAN {…"npu_device":null,…,"npu_lane":"off"}` and no override |

**7 of 7 PASS.** The three headline behaviors of the build all work: the lane loads with
KV on HTP0 (q8_0/q8_0, override logged, no abort), four consecutive turns ran with every
prefill chunk on HTP0 and correct long-context recall through the NPU-prefilled KV into
CPU decode, and no DEBUG native line reaches logcat while INFO does when mirrored.

## Disclosures

1. **nativelog arming slip (fixed mid-session).** I first wrote `kalsa.bench.nativelog=on`,
   but the mirror gate accepts strictly `"1"` (`getBenchNativeLogMirror() === "1"`), so the
   main sequence (checks 1–4, one process) ran with the mirror OFF: only 8 `KALSA_NATIVE warn`
   lines and 0 info lines. I rewrote it to `1`, force-stopped, relaunched, and ran one more
   short lane-on turn (pid 5302, `raw/c5-mirroron-kalsa.txt`): 498 `KALSA_NATIVE info` lines
   with `awaiting trigger` still 0 — the discriminating evidence for check 5, since a
   silent mirror would also show 0. Check-5 counts are quoted from both windows in
   `raw/counts.txt`. Turn-level checks are mirror-independent.
2. **Check 6 internal retry.** The lane-off turn needed the governor's designed
   abort-and-retry (attempt 1 "prefill admission aborted" with `thermal_state:"Unknown"`,
   attempt 2 completed and answered). Check criteria (answer correct, no KV override) hold;
   quoted lines in the table.
3. **Observation, not a check:** every boot logs
   `KALSA_PREWARM {"op":"snapshot_save","ok":false,"reason":"save_error",…}` (both lane on
   and lane off, kvtranscript=1). The prewarm itself succeeds (`op":"done","promptN":1660`);
   only the snapshot save fails, so each boot re-prefills the system prefix. Worth an
   owner look.
4. Per-chunk `actual` reads `"gpu"` on lane-on chunks while `layers_device` reads `"HTP0"` —
   the same label-vs-device quirk the governor campaign documented (device readout is
   `npu_device`/`layers_device`, both HTP0 here; NPU-speed prefill corroborates).

## End state (12:55 EDT)

Kalsa in FOREGROUND (`com.kalsa.app/.MainActivity` topResumed), screen Awake
(`mWakefulness=Awake`, keyevent 224 only), ON CHARGER, battery 100 % / 36.1 °C, Thermal
Status 1, `persist.traced.enable=0`, debuggable `0b7c5e71` installed (lastUpdateTime
2026-10-02 12:31:39). Bench keys restored to the owner's values and read back via run-as
(`raw/keys-restored.txt`); tombstones unchanged from baseline. No `/data/local/tmp` files
of mine left behind (the sqlw helper files self-clean; pre-existing files untouched).

## Evidence

`raw/` holds ONLY filtered lines / counts / small state files — no full logcat (the full
session capture stayed in `/tmp/s23-func/session.logcat` and is NOT committed):
`apk.sha256`, `install.log`, `ci-watch-tail.txt`, `keys-before.txt`, `keys-restored.txt`,
`tombstones-before.txt`, `tombstones-after-load.txt` (includes the post-load
`MemAvailable`), `c1-boot-kalsa.txt`, `c2-kalsa.txt`, `c3-kalsa.txt`, `c4-kalsa.txt`
(KALSA_*/RNLlama lines per turn), `c5-mirroron-kalsa.txt` (mirror-on boot + short turn),
`c6-kalsa.txt` (lane-off process), `answers.txt` (grep'd UI answer nodes), `counts.txt`,
`turns.tsv`, `final-boot-line.txt`, `final-state.txt`, `state-c*-*.txt` (wakefulness /
battery at send and post-turn).

Turn durations: short 19 s, long 16 s (1,270-token prefill 1.87 s on HTP0 + 107-token
decode), follow-up 21 s, mirror-on short 21 s, lane-off Australia 105 s (includes the
attempt-1 abort + attempt-2 retry).
