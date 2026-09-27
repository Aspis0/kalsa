# S23 LFM governor long session — 2026-09-27

## Outcome

The campaign stopped before turn 1 (`EXIT=1`). It did not produce any valid turns or timing results. The app reached the governor load plan and completed model prewarm, but the device-share readiness gate never found `Pronto` or `Ready` within 240 seconds. The native-log setup then failed to deliver its enable command. No campaign code was changed.

The campaign ran from `/Users/marco/Projects/kalsa-wt-iroh` at `2641144cff9ca70d4ddcab981e650b144aac2773`; this is one app-only commit above the coordinator's stated `91b10eda`. That commit changes only `KalsaIrohModule.kt`; the campaign/device-share scripts are unchanged from `91b10eda`.

## Per-turn evidence

| Turn | Route by phase | Prefill ms | Decode tok/s | Governor pauses/kills | Thermal status / skin / battery temp / level | Awake | Answer OK |
|---|---|---:|---:|---|---|---|---|
| None | No turn started | — | — | — | No per-turn sample | — | — |

The model load emitted `KALSA_NATIVE_VARIANT {"androidLib":"rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl","nGpuLayers":{"prefill":99,"decode":0}}`; this describes the configured GPU-prefill/CPU-decode split, but no user turn ran, so it is not evidence of per-turn routing. The load log also emitted `KALSA_GOVERNOR_PLAN {"gpu_fit":"Fit","decode_repack":false,"required_mib_with_repack":4518.12,"required_mib_without_repack":2998.06,"available_mib":4116.83,"bench_norepack_forced":null}` and `KALSA_PREWARM` `op=done`. No answer from this attempt is counted.

Key driver lines:

```text
[ci] never reported Pronto/Ready after 240s
[ci] FATAL: native log setup: could not deliver bench:nativelog on
[ci] native log teardown: restoring previous preference
```

This is a readiness/protocol failure before the turn loop, not a thermal, battery, or charging stop. The APK provenance gate passed. It was the expected debuggable `ae64564d` APK (SHA-256 `cd644477c08d4d3d21cec0f3e756eed3b4a53e0c9814f9347ff0ce0ea7e26ecc`), `run-as` worked, and the governor preference was written before launch. Because the APK is debuggable, any tok/s would be diagnostic only; this attempt recorded none.

## Preflight and cleanup

At campaign start the TLS S23 was unplugged, battery 81%, battery temperature 28.0 °C, thermal status 0, `persist.traced.enable=0`, screen Awake, and Kalsa focused. No llama/bench process was present. The phone remained unplugged throughout the run.

The runner's failure cleanup unexpectedly deleted `screen_off_timeout` and left the display Dozing with the launcher focused. I restored the timeout to `2147483647`, woke/dismissed keyguard, and relaunched Kalsa. Final readback: Awake, Kalsa focused, timeout `2147483647`, unplugged, battery 80%, temperature 29.0 °C, traced 0, no llama/bench process. No app data was cleared. The phone was left with the screen on.

All driver, logcat/fatal snapshots, effective/original configs, self-test logs, APK hash, preflight and cleanup checks are in `raw/s23-20260927/`. The two host suites passed (`harness:campaign` exit 0; standalone defects suite `passed=74 failed=0`).

## Readiness gate diagnosis — 2026-09-27

The gate is an exact XML substring check, not a logcat check or regex: `scripts/device-share-send.sh:37` defines `_SHARE_READY_LABELS=("Ready" "Pronto")`; `scripts/device-env.sh:107-119` runs `uiautomator dump /data/local/tmp/ui.xml` and reads it back; `scripts/device-env.sh:121-127` applies `grep -qF` to the entire XML. `scripts/campaign/conversation.sh:111-125` repeats this every five seconds for 240 seconds. Source excerpts are saved in `raw/s23-readiness-20260927/source-excerpts.txt`.

The status row is only rendered inside `ModelPillSheet`: `ShellStrip.tsx:129-135` sets its `visible` from `sheetVisible`, and `ModelPillSheet.tsx:26-63` places `ModelBar` inside that modal. Thus the ordinary chat screen does not expose the row that can contain Ready/Pronto. Current main-screen XML has no Ready/Pronto in either `text` or `content-desc`. It instead reports `<node text="In attesa: il modello va caricato di nuovo" ... class="android.widget.TextView" ... enabled="true" />`; the composer is `<node resource-id="shell.composer.field" ... class="android.widget.EditText" ... content-desc="Messaggio" ... enabled="true" />`; the empty-composer send control is `<node resource-id="shell.composer.send" ... content-desc="Invia" ... enabled="false" />`. See `ui-after-60.xml`.

The fresh manual launch could not produce a new prewarm: storage still had `kalsa.governor.enabled=1` and `kalsa.load.dead.lfm2.5-2.6b=1`; logcat said `KALSA_PREWARM {"op":"skip","reason":"not_ready"}` and `KALSA_LOAD ... "refusedBy":"marker"`. The safety marker was left untouched. The earlier same-session successful governor-on load is the relevant timing proof: first app log `12:59:42.838` to `KALSA_PREWARM op=done` at `13:00:04.286` = 21.448 s; protocol marker `12:59:42.960` to done = 21.326 s. Prewarm itself was `12:59:49.891` to `13:00:04.286` = 14.395 s. Despite `op=done`, the gate exhausted its 240 s loop without seeing either label. Therefore 240 s is not too short for model loading; the ready UI was never observed by this main-screen matcher. No independent Ready UI moment was captured because the ready text is in the closed model-status sheet.

`bench:nativelog on` delivery uses `ACTION_VIEW` with a URL-encoded `kalsa://share?text=...` deep link (`device-share-send.sh:154-164`), then waits for composer text and taps Send; it does not type with `input text`. The campaign log shows `share preflight ... expected=none current=none`, then `never reported Pronto/Ready after 240s`, followed by `FATAL: native log setup: could not deliver bench:nativelog on`; there are no `share-send attempt` lines. `campaign_ensure_launch_pid` returns on its `campaign_wait_ready` failure before `device_share_intent` is reached. This failure is therefore downstream of the readiness precondition; the deep-link send itself was not independently tested. Logs: `prior-campaign-driver.log`, `prior-campaign-logcat.txt`, and `prior-campaign-timeout-ui.txt`.

Preflight/final checks are saved in this raw directory: phone unplugged, traced 0, display Awake, Kalsa foreground. No harness/app edits, app-data clearing, marker deletion, or `kalsa.bench.thermo` writes were made.

## Governor long-session retry — stopped on readiness matcher defect

Harness was exactly `kalsa-wt-iroh` HEAD `577867c05309972dfa7e29e30447309722acec93`; no harness/app edits. Host checks passed: `npm run harness:campaign` EXIT 0 (`passed=82 failed=0`, `selftest ok`) and standalone `selftest_defects.sh` EXIT 0 (`passed=82 failed=0`). Used the existing installed debuggable APK `ae64564d`, SHA-256 `cd644477c08d4d3d21cec0f3e756eed3b4a53e0c9814f9347ff0ce0ea7e26ecc`; local and installed hashes matched and `run-as` passed. No reinstall.

Preflight: TLS S23 unplugged, battery 57%, 29.6 C, thermal 0, traced 0; no llama/bench processes; display Awake/unlocked. Governor was enabled by the runner. It cleared the dead-load marker loudly (`run-record.json: load_dead_marker_cleared=true`), then loaded with `gpu_fit=Fit`. This launch logged startup protocol at 15:05:25.430 and `KALSA_PREWARM op=done` at 15:05:47.444 (22.014 s from protocol marker).

The readiness gate then did not advance. `scripts/device-share-send.sh` `device_ready_log_seen` searches for literal `KALSA_PREWARM {"op":"done"`, but this build emits `ReactNativeJS: 'KALSA_PREWARM', '{"op":"done"...` (exact line in `raw/s23-governor-long-577867c0/matcher-repro.txt`). The literal grep returns 1, so the `&& device_composer_enabled` short-circuits and the composer check is never reached. I stopped immediately after confirming the source/log mismatch; no turn started, no per-turn results. Driver EXIT=130, not a campaign stop verdict. This is the harness bug for mimo to fix; no retry performed.

| Turn | Route per phase | Prefill ms | Decode tok/s | Pauses/kills | Thermal / skin / battery temp / level | Awake | Answer OK |
|---|---|---:|---:|---|---|---|---|
| None | No turn started | — | — | — | — | Yes at exit | — |

The interrupt teardown completed: screen timeout remains 2147483647, display Awake, keyguard dismissed, Kalsa foreground; unplugged, battery 57% / 30.3 C, traced 0, no llama/bench process. No `kalsa.bench.thermo` write. Full preflight, driver, logcat, test output, gate repro and cleanup evidence are under `raw/s23-governor-long-577867c0/`.

## Manual governor smoke — stopped at thermal status 3 (2026-09-27)

Manual app interaction only; no harness, no timing benchmark, and no write to `kalsa.bench.thermo`. The S23 was unplugged, screen Awake and Kalsa foreground before and after each sent turn. `logcat -b all -v threadtime` ran throughout capture; complete captures are gzip-compressed in `raw/manual-smoke/`. `verbatim-lines.txt` contains 29 unmodified matching lines from the successful model reload through the smoke: 5 `KALSA_GOVERNOR*`, 3 `KALSA_TELEMETRY`, 13 `KALSA_PREWARM`, 0 `KALSA_THERMAL*`, 0 `KALSA_GPU_FALLBACK*`, and 8 `KALSA_NATIVE*`.

The app initially had a dead-load marker (`KALSA_PREWARM op=skip reason=not_ready`). I used the in-app Retry control; it emitted `KALSA_GOVERNOR_PLAN ... gpu_fit=Fit` and `KALSA_PREWARM op=done` before any turn. This was a UI recovery, not an app-data/settings edit.

| Turn | Prompt | Route (prefill / decode) | Prefill ms | Decode tok/s (diagnostic; debuggable APK) | Android thermal status; battery temp; skin; battery | Answer |
|---|---|---|---:|---:|---|---|
| 1 | Short arithmetic | GPU / CPU | 4,177.624 | 10.43 | 0; 30.3→30.1 °C; 30.9→32.4 °C; 56→55% | Yes: 17×6=102 with a short calculation. |
| 2 | Medium, 45-minute preparation schedule | GPU / CPU | 948.156 | 12.38 | 0; 32.6→31.6 °C; 32.8→34.5 °C; 55→54% | Partly: totalled 45 minutes, but allocated the final 15 minutes to joining the meeting, leaving little preparation time. |
| 3 | Long event-planning prompt, 587 words; `prompt_n=981` | GPU / CPU | 10,358.639 | 9.98 | 0→3; 33.6→41.6 °C; 34.7→41.1 °C; 54→51% | Mostly: coherent plan honoring the stated family/accessibility constraints, though overlong. |

All three governor records show `route_push=applied`, `route_mismatch=null`, `engine_prefill=GPU`, `engine_decode=CPU`, `fit=Fit`, `failed=false`, and GPU actual route chunks. Turn 3's telemetry completed at 15:25:33; the subsequent sensor sample showed Android `Thermal Status: 3` and skin sensor status 3. I stopped there: only 3 of 5 turns were sent, despite battery remaining above the 45% floor. No fourth or fifth turn was attempted. The Governor's logged state remained `FAST`; Android thermal status is reported separately. No thermal-performance conclusion is drawn from this diagnostic smoke. Raw prompts, UI snapshots, power/thermal state, telemetry and verbatim fixtures are in `raw/manual-smoke/`.

## Battery-only governor baseline before platform-status response — 2026-09-27

The requested preflight passed: unplugged, battery 46%, battery 28.0 °C, Android thermal status 0, traced 0, screen Awake/unlocked, Kalsa foreground, and no llama/bench process. The installed APK was `ae64564d` with SHA-256 `cd644477c08d4d3d21cec0f3e756eed3b4a53e0c9814f9347ff0ce0ea7e26ecc`; provenance gate passed. Both host suites passed (`harness:campaign` EXIT 0, `passed=83 failed=0`; standalone defects EXIT 0, `passed=83 failed=0`). No app or harness files were edited.

The app worktree advanced from the coordinator's `e2c92faf` to `373dbbfa` while preparing. I checked the diff: `scripts/campaign` and `campaigns/t20c.json` are unchanged from `e2c92faf`. The intervening platform-SEVERE app change (`19368426`) was not in the installed `ae64564d` APK, so the device run remained the requested pre-change build. The TLS endpoint and effective config are saved under `raw/baseline-before-thermal-20260927/`.

**Outcome:** one user-prompt row was collected; Android thermal status reached 3 (SEVERE) at the turn-2 send gate, before turn 2 was sent or prefetched. The exact stop was `thermal hard abort turn 2: unplugged thermal status 3 >= 3` (`runner.log`, EXIT=1). Battery remained above both the 40% start floor and 25% stop floor; no charging or 44 °C battery stop fired.

| Turn / phase | Route; prompt_n; prefill ms; decode tok/s | Governor state | Android status / battery temp / level |
|---|---|---|---|
| 1, first completion round | Route not present in the round-0 log; prompt_n=1943, 17,038.508 ms, 11.58 tok/s | Not present in the round-0 record | Collected env: status 0, battery 35.8 °C, 44% |
| 1, delayed tool continuation (`write_note`) | Actual GPU prefill / CPU decode; prompt_n=186, 2,332.741 ms, 10.54 tok/s | `FAST`, `thermo_source=battery`, Fit | Governor line arrived at 16:44:33; the next send was then stopped by Android status 3 |
| 2, send gate | No prompt delivered; no prefill | — | Status 3; hard-abort stop |

`KALSA_GOVERNOR` for turn 1 confirms actual GPU chunks `2+128+56`, CPU decode, `thermal_state:"FAST"`, and no failure. However, it arrived after the campaign had written the turn-1 JSONL row and advanced: that row has `assistant:"#"`, only telemetry round 0, and `KALSA_GOVERNOR:[]`. The raw logcat later contains telemetry round 1 and the governor line. Thus the runtime reached the thermal stop after one submitted prompt, but the turn JSONL is incomplete and the assistant answer is not a verified completed answer; treat the exact turn-count result as a diagnostic baseline with this harness bookkeeping defect noted.

Battery temperature rose from 28.0 °C at preflight to 31.0 °C after model load, 35.8 °C at the collected turn-1 row, then through 37.5, 38.8, 39.9 and 40.9 °C (last BatteryDump sample at 16:44:29). The status-3 abort occurred after that sample; the post-stop read, after cooling, was battery 36.4 °C, Android status 1, level 42%. Full samples, runner output, JSONL, filtered battery curve, pre/post state and test logs are in `raw/baseline-before-thermal-20260927/`. Screen finalization confirmed Awake, Kalsa foreground, timeout `2147483647`; traced remained 0.
