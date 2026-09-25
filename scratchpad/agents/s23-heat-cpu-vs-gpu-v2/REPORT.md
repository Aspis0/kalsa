# S23 CPU/GPU prefill heat protocol — v2

**Dataset flag: DSP-CONTAMINATED.** Owner authorized heat measurements while `adsprpcd`/`cdsprpcd` spin. Record both daemon CPU snapshots before and after every arm; mark a matched pair confounded when daemon load changes materially between its arms.

## Preregistration — Revision 2, before arms

Predictions are copied from `governor-archive-mining/SYNTHESIS.md` §4 Revision 2. GPU prefill will have lower baseline-corrected SoC heat per 1,000 new prompt tokens than CPU on LFM2.5-2.6B QAD-Q4_0; this is a directional hypothesis only, because the prior CPU/GPU heat comparison used another model. GPU may take longer. Battery temperature is expected to rise after compute. No absolute raw end-temperature parity is predicted.

The design is 512 and 1024 new-token prompts × CPU/GPU × 8 matched pairs (32 arms), with pair orders randomized ABBA/BAAB (four pairs per order). Each arm gets a 120-second, 1-Hz pre-arm baseline with model/KV resident; fit `T(t)=a+bt` by OLS. Record through completion plus 60 seconds. Pair start battery temperatures must be within ±2.0 °C; each arm starts at thermal status 0. Use identical fresh-chat prompts if same `nPast=K` cannot be restored; each arm's `nPast` is recorded and must match its frozen value. Prompt token counts must be target ±2. A missed route, join, token, state, unload, or safety condition invalidates that arm and pair; invalid rows remain visible.

### Three-turn smoke gate

Before any arm, in one chat send a short CPU-routed prompt after `/bench route cpu`, then GPU after `/bench route gpu`, then CPU after `/bench route cpu`. Every turn must have a joined `turnId`, `route_push:"applied"`, correct requested and actual route for each chunk, `route_mismatch:false`, `attempt:1`, and no `route_reject` or `KALSA_GOVERNOR_RUNTIME_FALLBACK`. The CPU turn after prewarm must also prove the prefix is present via a commit/catch-up log line or `commit_bytes>0` in `KALSA_GOVERNOR`. Any failure stops the protocol; that turn is invalid and no heat arms follow.

### Heat metrics and analysis

For each sensor/arm compute: (1) `1000 × max(x) / new_prompt_tokens`, °C per 1,000 prompt tokens; (2) `x(turn_end) / prefill_ms × 1000`, °C per second of prefill compute; (3) positive trapezoid AUC of `x(t)` over the fixed 60-second post-completion window, °C·s. Here `x(t)=observed−(a+bt)` from that arm's 120-second baseline. Primary sensors: battery, CPU label-group maxima `cpu-0-*` and `cpu-1-*`, GPU max `gpuss-*`, NSP max `nspss-*`, and HAL `SKIN`; no CPU architecture identity is inferred. Latency remains separate.

Planning MDE uses `2.80×√2×SD/√n`, two-sided α=.05 and 80% power, independent arm errors. Prior idle-window SDs give n=8 rough raw MDEs: battery 0.532 °C (1.04 °C/1k for 512 tokens; 0.52 for 1024), skin 0.514 °C, GPU 0.717 °C, NSP 0.705 °C, CPU group 0 0.917 °C, CPU group 1 2.195 °C. These SDs include the observed +1.14 °C/10-min drift and are planning proxies, not residual SDs. Empirical residual SD and MDE will be computed from tonight's arm baselines. Eight pairs/cell are exploratory; effects below the empirical MDE cannot change routing, and this study is not confirmatory.

This comparison can price only the tested model, device, app build, prompt lengths, and conditions. It does not establish a universal CPU/GPU heat ranking, energy efficiency, or a router policy change.

## Device/APK and start conditions

- Target only Galaxy S23 serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`; do not command the Xiaomi.
- APK `/Users/marco/kalsa-apks/aceee960/app-release.apk`; expected SHA-256 `633887432181f0ae7d0e3a525b346320dd5cdc022282ec28c950ede8b12e1bea`.
- Claimed provenance: CI 36100777937, app `aceee960`, engine `kalsa-phone-v1-1-7` / `47f18811c`, binding `c502a603`. Install only with `adb -s <S23> install -r`; signature failure stops.
- Screen timeout was originally unset. Investigate the device's timeout/stay values, use a finite screen timeout if needed, verify Awake at both sides of every turn, and restore by deleting the override at the end.
- Start only unplugged, Awake/Kalsa foreground, thermal status 0, and battery >25%; hard stops are thermal status ≥3, battery temperature ≥44.0 °C, battery ≤25%, charging, Dozing/background during a turn, or DSP daemons spinning. After 20 minutes cumulative inference load, cool for 20 minutes with screen on and app foreground. Wait on the Mac.

## Preflight, timeout diagnosis, and stop decision

The new APK SHA-256 matched the preregistered value. The APK was installed with `adb -s <S23> install -r`; output was `Success` with exit 0. The installed package is debuggable (`versionName=0.1.0`, `versionCode=1`, `lastUpdateTime=2026-09-25 02:59:41`).

At preflight 2026-09-25 06:56:41 UTC, the S23 was unplugged, 77%, 26.7 °C, thermal status 0, Dozing, with Kalsa resumed. `adsprpcd` was actively running at 31.0% of one core (`top`, process state R; accumulated utime 92453 ticks); `cdsprpcd` was 0.0%. This is a DSP spin, so the measurement gate closed before smoke. No CPU/GPU/CPU smoke turn or heat arm was sent. The APK install and timeout diagnostic do not produce heat measurements. The Xiaomi received no command.

The Dozing cause is the effective timeout after restoring the originally unset key: `settings get system screen_off_timeout` was `null`, while `dumpsys power` reported `mScreenOffTimeoutSetting=15000`, `Screen off timeout: 15000 ms`, and `mLastSleepReason=timeout`. `stay_on_while_plugged_in=0` and `mStayOn=false`; that option cannot keep this unplugged phone awake. No device-admin maximum was enforced. I set a finite `screen_off_timeout=1800000` ms and sent the allowed `KEYCODE_WAKEUP`; the 30-second follow-up remained Awake with Kalsa foreground, unplugged, 77%, 27.5 °C, thermal status 0. This confirms the finite timeout worked for that check; it does not establish long-duration behavior. At session end I restored the original unset state (`settings delete system screen_off_timeout`, exit 0; subsequent read `null`).

## Smoke result

Not run: the initial DSP preflight found `adsprpcd` spinning at 31.0% of a core. Per the hard gate, the required three-turn CPU/GPU/CPU smoke was not attempted. There are no smoke turns to mark invalid.

## Heat arms

The earlier “not run” decision was based on the DSP gate and is superseded by the coordinator's exception recorded below. The three-turn correctness smoke above passed. Planned sequence remains 512 and 1024 new-token prompts × CPU/GPU × 8 matched pairs, stopping at the first safety boundary.

### Coordinator exception and arm log

2026-09-25 09:20 UTC: coordinator authorized heat arms with DSP activity present. Each arm records `adsprpcd`/`cdsprpcd` CPU immediately before and after; large between-arm changes confound that matched pair. The dataset remains DSP-contaminated. No Xiaomi commands were sent.

| Prompt length | Pair | Arm order | Backend | Metrics 1 / 2 / 3 | nPast; prompt tokens | Battery °C start/end; thermal start/end | low_power; Awake/foreground | DSP CPU before → after | Status / evidence |
|---:|---:|---|---|---|---|---|---|---|---|

### Setup attempt and stop

No measured arm started. Session preflight was 61% battery, 32.0 °C, thermal status 0, unplugged, Awake with Kalsa resumed, `low_power=0`, and `screen_off_timeout=1800000`; `adsprpcd` was 103% of one core. Start bracket: `raw/arm-session-start.txt`.

The model had idle-unloaded. The visible model-bar reload label did not load it when tapped. Under amendment A, a setup send was then used to trigger loading; the intended one-token throwaway instead ran with the app's normal generation settings: turn 5 generated 398 tokens (`prompt_n=11`) and took 48.7 s. It is excluded from heat data and is a protocol deviation. `KALSA_PREWARM` finished at 05:32:15 with `promptN=1812`; snapshot save returned `save_error`. The attempt also logged `KALSA_GOVERNOR_PLAN` available 3738.33 MiB versus 2998.06 MiB required without repack, two tensor-offload messages (31/31 then 0/31 GPU layers), and failed `mlock` warnings. The engine later idle-unloaded at 05:35:55. Raw evidence: `raw/arm-stream-logcat.txt`, `raw/prewarm-throwaway-pre.txt`, `raw/prewarm-throwaway-post.txt`.

No post-load bracket observed the required status-0 arm start gate: checks remained at status 1, with battery temperatures around 36.3–36.9 °C. The last bracket was 54%, 36.3 °C, thermal status 1, unplugged, Awake/Kalsa foreground, `low_power=0`, with timeout still 1800000. No baseline was taken. The 512-token prompt was not sent: its first entry attempt found the composer unfocused and empty, and this was caught before any send. The model was unloaded by the time of the final gate check. The app was briefly sent to the launcher during setup, then returned with `am start`; no arm or turn ran outside Kalsa. No hard stop (status ≥3, 44 °C, or battery ≤25%) was reached. At stop, I restored the original unset timeout (`settings get system screen_off_timeout` returned `null`) and sent `KEYCODE_WAKEUP`; the final state remained Awake with Kalsa resumed.

All 32 planned arms are **unrun** (zero valid and zero invalid arms); the first planned cell was 512/pair 1/control CPU. No sensor baseline, heat metric, residual SD, or empirical MDE exists for this session. The whole planned dataset remains DSP-contaminated by coordinator decision, but no heat conclusion or route-policy change is licensed.

Raw stop evidence: `raw/heat-arms/512-p1-cpu/setup-bracket.txt`, `raw/arm-512p1-route-composer.xml`, `raw/arm-512p1-prompt-composer.xml`, `raw/final-stop-bracket.txt`, and `raw/timeout-restored-after-stop.txt`. `raw/heat-arms/stop-evidence-inventory.txt` records `ls -la` and `wc -l` for the report and cited evidence.

## Raw evidence inventory

Raw evidence includes `apk-verification.txt`, `preflight.txt`, `timeout-test-start.txt`, `timeout-test-30s.txt`, `install.log`, `post-install-state.txt`, and `timeout-restored.txt`. `evidence-inventory.txt` records `ls -la` and `wc -l` for the files and report. There are no smoke, prompt, sensor-series, or heat-arm files because the preflight stopped measurement.


## Smoke (correctness only)

Coordinator clarification allowed correctness checks despite the DSP spin; it did not authorize heat or speed measurements. The smoke was attempted on 2026-09-25 with the 30-minute screen timeout, screen Awake, Kalsa resumed, unplugged, thermal status 0, and low-power mode off. Battery level was 76%; only the safety predicate `battery_temp_below_44C=true` was retained, with no temperature value or heat/speed metrics recorded. Start bracket: `raw/smoke-correctness.txt`.

Daemon CPU snapshots: before, `adsprpcd` 50.0% of one core and `cdsprpcd` 0.0%; after, `adsprpcd` 71.4% and `cdsprpcd` 0.0%. These are top snapshots, not heat measurements; see `raw/smoke-daemon-before-and-preflight.txt` and `raw/smoke-daemon-after-and-final-state.txt`.

The first UI entry accidentally used literal `%20` separators, so `/bench%20route%20cpu` was sent as ordinary chat text and received an unforced assistant reply; it is excluded from the smoke. The attempted slash-form adb entry was actually `/bench troute cpu` because the input string contained an extra `t`; the exact app reply was `bench: unknown subcommand "troute".` Smoke stopped at that setup gate. The corrected slash-free entry and successful retry are recorded below; see `raw/smoke-route-outcome.txt`.

Restored the original unset `screen_off_timeout` (`settings get` returned `null`); the default timeout put the display into Dozing, so the allowed `KEYCODE_WAKEUP` was sent afterward. Final check: Awake, Kalsa foreground, timeout still unset; see `raw/smoke-timeout-restored.txt`. No reboot was issued. The stop statement above describes the first attempt only; the corrected-entry retry and its result follow.

### Successful corrected-entry smoke retry

The route command was re-entered using `bench:route`, KEYCODE_SPACE, then the selector. This retry passed the correctness smoke gate. Heat arms remain unrun because DSP activity still blocks measurements. Before sending, uiautomator proved the composer contained exactly `bench:route cpu`; the app acknowledged `bench: route=cpu (next turn, no reload)`. The same procedure applied `gpu` and then `cpu`, each with the expected acknowledgement. The smoke used one chat and the identical prompt `Reply with exactly READY.` for all three turns. Every answer was `READY`. No heat or speed numbers were recorded.

| Turn | Joined turnId | Answer | nPast / KV held | Route evidence | Prefix commit |
|---|---:|---|---|---|---:|
| CPU | 2 | `READY` | 2660 / true | attempt 1; push applied; requested/mode `cpu`; mismatch false; all chunks actual `cpu`, forced true | 14,005,248 bytes |
| GPU | 3 | `READY` | 2964 / true | attempt 1; push applied; requested/mode `gpu`; mismatch false; chunk actual `gpu`, forced true | 21,109,248 bytes |
| CPU | 4 | `READY` | 3053 / true | attempt 1; push applied; requested/mode `cpu`; mismatch false; chunk actual `cpu`, forced true | 21,109,248 bytes |

Each turn's telemetry joined on its `turnId`, with attempt 1 and neither interruption nor truncation. The governor records show no failure/fallback reason; no route reject/runtime-fallback marker was associated with these three turns. The first CPU turn after prewarm had positive `commit_bytes`, proving prefix catch-up. Before and after each turn the phone was Awake with Kalsa resumed, unplugged, thermal status 0, and low_power=0; brackets and per-turn allowlisted marker evidence are under `raw/smoke-*-pre.txt`, `raw/smoke-*-post.txt`, and `raw/smoke-*-result.txt`.

During the retry, `adsprpcd` was 100% of one core before the route-control sequence and 103% afterward; `cdsprpcd` was 0.0% in the after snapshot. The correctness smoke was allowed under the coordinator correction; DSP activity still blocks heat measurements. The original unset timeout was restored (`null`), followed by `KEYCODE_WAKEUP`; final state is Awake with Kalsa resumed and the timeout unset. No reboot was issued. Raw daemon and final-state evidence: `raw/smoke-retry-route-control.txt`, `raw/smoke-daemon-retry-after.txt`, `raw/smoke-final-state.txt`.

### Owner stop — revised 1024-token plan

Owner stopped heat arms before any timed CPU/GPU arm was sent. Valid heat arms: **n=0**. The prior throwaway turns and pre-arm attempts are setup only; they are not included in the heat dataset. Last confirmed phone bracket before stop: unplugged, 28% battery, 39.2 °C, thermal status 2, Awake with Kalsa resumed, `low_power=0`; the owner reported the battery nearly empty and was rebooting/charging the phone. No device command was issued after that instruction.

The 1024-token CPU setup did not produce a valid baseline: the first capture was model-nonresident and its Mac-paced adb sampler took roughly 4–6 seconds per sample. A persistent-shell 1-Hz attempt was then interrupted; its observed sample intervals were still about 4.6 seconds. The 1024-token composer entry was also truncated (the UI held 1,219 of 3,735 expected characters), so no arm prompt was sent. The setup throwaway on turn 9 displayed `X` but telemetry recorded 40 predicted tokens; it is not a one-token warmup. Earlier turn 8 recorded 755 predicted tokens. These are protocol deviations, not experimental arms.

| Pair | Order | Backend | Metric 1 °C/1k | Metric 2 °C/s | Metric 3 °C·s | Prefill tok/s | Decode tok/s | n | Status |
|---:|---|---|---:|---:|---:|---:|---:|---:|---|
| 1 | CPU → GPU | CPU | — | — | — | — | — | 0 | Unrun; invalid baseline/setup |
| 1 | CPU → GPU | GPU | — | — | — | — | — | 0 | Unrun; owner stopped |
| 2 | GPU → CPU | GPU | — | — | — | — | — | 0 | Unrun; owner stopped |
| 2 | GPU → CPU | CPU | — | — | — | — | — | 0 | Unrun; owner stopped |
| 3 | GPU → CPU | GPU | — | — | — | — | — | 0 | Unrun; owner stopped |
| 3 | GPU → CPU | CPU | — | — | — | — | — | 0 | Unrun; owner stopped |
| 4 | CPU → GPU | CPU | — | — | — | — | — | 0 | Unrun; owner stopped |
| 4 | CPU → GPU | GPU | — | — | — | — | — | 0 | Unrun; owner stopped |

The additional 512-token block was not started. No paired comparison, residual SD, or MDE can be computed. The requested 1024-token ABBA block and the 512-token add-on remain unrun; this session licenses no heat or routing conclusion. The DSP-contaminated dataset flag remains in effect. Raw evidence inventory: `raw/heat-arms/owner-stop-inventory.txt`.

### Prediction — restarted four-pair 1024-token block (written before device access)

For each sensor, define ΔT as the arm's maximum baseline-corrected excess over its 120-s pre-arm OLS line through the 60-s post-arm tail. The predicted contrast is CPU minus GPU, per 1024 new prompt tokens. Prediction: battery **+0.3 °C** and the hottest readable SoC zone **+0.8 °C** (CPU route warmer); these are directional point estimates with low confidence, and a result near zero is plausible given the sensor resolution and only four pairs. Do not interpret an effect below the observed paired uncertainty/MDE as evidence for a route choice. Planned pair order is CPU→GPU, GPU→CPU, CPU→GPU, GPU→CPU. No S23 command has been issued for this restarted attempt as of this preregistration.

### Restart attempt — UI verification blocked before first arm

The prediction above was saved before the first device command. The S23 preflight at 14:35:43 UTC showed unplugged (AC/USB/wireless false), 100%, 29.8 °C, thermal status 0, Awake, timeout 1,800,000 ms, and low-power 0. The app initially was not foreground; I launched only `com.kalsa.app` and confirmed `com.kalsa.app/.MainActivity` resumed. Package version was 0.1.0/versionCode 1, last update 2026-09-25 02:59:41; no APK install or data change was made. Prewarm completed at device time 10:37:07 with promptN 1812; snapshot restore reported `no_file` and snapshot save reported `save_error`.

No bench command or timed arm was sent. `uiautomator dump` and `screencap` both terminated with `Signal 36`, so I could not verify the exact composer contents before sending the required `bench:route` command. I did not bypass that check. At the final bracket (14:42:32 UTC), the S23 was unplugged, 99%, 30.6 °C, thermal status 0, Awake with Kalsa foreground, low-power 0, and timeout 1,800,000 ms (already set at session start); both DSP daemons were at 0.0%. **New valid arms n=0; no clean or contaminated arms, pair deltas, SD, or MDE are available.** The prior 512-token block was not started. The app's idle unload could have elapsed after prewarm; residency at the final bracket is unknown.

Raw evidence: `raw/heat-arms/restart-20260925/preflight.txt`, `app-launch.txt`, `startup-logcat.txt`, `startup-logcat-current.txt`, `ui-initial.xml`, `ui-retry.txt`, `ui-diagnostics.txt`, `activity-top.txt`, and `last-state.txt`; see `evidence-inventory.txt` for `ls -la` and `wc -l`. Line counts: preflight 45, app-launch 31, startup-logcat 151,663, startup-logcat-current 154,588, ui-initial 3, ui-retry 3, ui-diagnostics 36, activity-top 633, last-state 22, evidence-inventory 26. `ui-current.png` is an 11-byte `Signal 36` error, not an image.

### Resume attempt — no valid heat arms (2026-09-25)

DSP-contaminated dataset flag retained. No measured arm was sent; valid heat arms `n=0`.

The preregistered prediction for CPU minus GPU, per 1k prompt tokens, remains battery `+0.3 °C` and hottest readable SoC zone `+0.8 °C`. Result: not estimated. No pair deltas, empirical residual SD, or MDE can be computed. Clean measured arms: none. DSP-contaminated measured arms: none (the planned per-arm before/after daemon brackets were never taken).

| Pair | Order | Backend | Prediction | Metrics 1 / 2 / 3 | Prefill tok/s | Daemon before → after | n | Status |
|---:|---|---|---|---|---|---|---:|---|
| 1 | CPU → GPU | CPU | CPU−GPU battery +0.3 °C/1k; SoC +0.8 °C/1k | — | — | — | 0 | Unrun |
| 1 | CPU → GPU | GPU | Same pair prediction | — | — | — | 0 | Unrun |
| 2 | GPU → CPU | GPU | Same contrast | — | — | — | 0 | Unrun |
| 2 | GPU → CPU | CPU | Same contrast | — | — | — | 0 | Unrun |
| 3 | CPU → GPU | CPU | Same contrast | — | — | — | 0 | Unrun |
| 3 | CPU → GPU | GPU | Same contrast | — | — | — | 0 | Unrun |
| 4 | GPU → CPU | GPU | Same contrast | — | — | — | 0 | Unrun |
| 4 | GPU → CPU | CPU | Same contrast | — | — | — | 0 | Unrun |

The required setup reloads were not measurement arms. Turns 3 and 4 were throwaways (CPU route applied, `prompt_n=10`, 555 and 469 output tokens); they completed but raised thermal status to 2 at 40.1 °C, then cooled to status 1 and status 0 respectively. The full brackets and joined markers are in `raw/heat-arms/restart-20260925/arm1-reload-postbracket.txt`, `throwaway2-post.txt`, `throwaway2-done-log.txt`, and `cooldown-poll-1.txt`. Battery remained unplugged and low-power stayed 0; both throwaway turns were Awake with Kalsa resumed.

Harness attempts did not produce a valid 1024-token send. The original filler and numeric drafts were truncated; the archived compact alphanumeric body was entered completely (1,680 characters, SHA-256 `517ede969b0cf2b0089ccb8c1c6db3c299745d7c022b1e53ba92fdabdcd3922a`) but never sent, so its prompt-token count is unknown. After the throwaway, the UI capture showed a blank white Kalsa surface; the accessibility tree still listed the chat, but repeated menu/new-chat taps did not open the drawer. `am start -n com.kalsa.app/.MainActivity` reported the running top-most activity and did not restore the UI. No 120-s baseline or timed arm began. This is an app/UI blocker; stop here rather than count an unmatched chat or unverified prompt.

Four CPU/GPU pairs remain unrun; the optional 512-token block was not started. No clean or contaminated route comparison is licensed. Final bracket before timeout restore: unplugged, 84%, 34.3 °C, thermal status 0, Awake/Kalsa foreground, `low_power=0`. The screen timeout was restored to unset (`settings get system screen_off_timeout` → `null`); no install, uninstall, or data clear occurred.

Raw evidence is under `raw/heat-arms/restart-20260925/`. See `raw/heat-arms/restart-20260925/evidence-inventory.txt` for directory `ls -la` and cited-file line counts.

### Resume attempt — sampler repaired; arm gate stayed closed (2026-09-25)

DSP-contaminated dataset flag retained. The prewritten CPU-minus-GPU prediction remains battery **+0.3 °C** and hottest SoC zone **+0.8 °C per 1k prompt tokens**. Result is unavailable: no heat arm started, so no per-arm temperature metric, prefill/decode rate, paired delta, residual SD, or MDE exists. Clean arms: 0; DSP-contaminated measured arms: 0 (no arm brackets were taken).

The sampler harness was corrected after profiling-signal delivery interrupted device-side `sleep`; the diagnosis is in `raw/heat-arms/restart-20260925/sleep-diagnostic.txt`. The archived sampler script, `device-heat-sampler.sh`, was validated at 18 samples / 17 intervals, median 1.06 s (min 1.05, max 1.08), meeting the ≤1.2 s cadence check. This is a harness test, not an arm measurement. After model idle-unload, a setup throwaway was used to reload/prewarm; its prompt/load and COOLMODE progression are in `throwaway-coolmode-progress-logcat.txt`. The model sheet later showed the idle-unloaded reload label (`model-status-ui.xml`).

The required start gate was not available after setup: thermal status remained **2** (HAL SKIN 39.4 °C, status 2), despite unplugged power, Awake/Kalsa foreground, and `low_power=0`. Final pre-restore bracket: battery **67%**, **39.9 °C**, status **2**, AC/USB/wireless false, Awake with `com.kalsa.app/.MainActivity` resumed; `adsprpcd` and `cdsprpcd` each about **85.7% of one core**. The timeout was restored to unset (`settings get system screen_off_timeout` returned `null`) and the display was awakened; final bracket confirms unplugged, 67%, status 2, Awake/Kalsa foreground, low_power 0, and default 15,000 ms timeout. See `session-end-pre-restore.txt` and `timeout-restored-stop-final.txt`.

| Pair | Order | Backend | Prediction (CPU−GPU, per 1k) | Battery ΔT | SoC ΔT | Prefill / decode tok/s | n | Status |
|---:|---|---|---|---:|---:|---|---:|---|
| 1 | CPU → GPU | CPU | +0.3 / +0.8 °C | — | — | — | 0 | Unrun; start status 2 > 1 |
| 1 | CPU → GPU | GPU | Same pair contrast | — | — | — | 0 | Unrun; start status 2 > 1 |
| 2 | GPU → CPU | GPU | Same pair contrast | — | — | — | 0 | Unrun; start status 2 > 1 |
| 2 | GPU → CPU | CPU | Same pair contrast | — | — | — | 0 | Unrun; start status 2 > 1 |
| 3 | CPU → GPU | CPU | Same pair contrast | — | — | — | 0 | Unrun; start status 2 > 1 |
| 3 | CPU → GPU | GPU | Same pair contrast | — | — | — | 0 | Unrun; start status 2 > 1 |
| 4 | GPU → CPU | GPU | Same pair contrast | — | — | — | 0 | Unrun; start status 2 > 1 |
| 4 | GPU → CPU | CPU | Same pair contrast | — | — | — | 0 | Unrun; start status 2 > 1 |

No pair deltas or route conclusion are licensed; the optional 512-token block was also not run. The setup throwaway is excluded. Raw evidence and line counts for the cited sampler, gate, and final-state files are recorded in `raw/heat-arms/restart-20260925/resume-20260925-stop-inventory.txt`.

## New APK run — 2026-09-25 (stopped on app bug)

DSP-CONTAMINATED. Coordinator removed the thermal-status start gate for this run; every arm still had to remain unplugged, Awake with Kalsa foreground, and below the hard stops. The APK hash verified as `855c89de6496b00d0721f981d551842abfd544a26c62d4c3a816028c4b5c91e7`; `adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp install -r` succeeded (exit 0). Installed package: versionName `0.1.0`, versionCode `1`, lastUpdateTime `2026-09-25 15:03:17`. No uninstall or data clear.

Prediction carried forward from Revision 2: CPU−GPU battery **+0.3 °C/1k** and hottest SoC **+0.8 °C/1k** (CPU warmer); this was directional. Result: **no valid arm or paired contrast**.

One CPU attempt began at battery 51%, 37.3 °C, thermal status 1; HAL SKIN 37.7 °C; unplugged, low_power 0, Awake/Kalsa foreground. DSP before: adsprpcd 112%, cdsprpcd 112% of one core (utime 527290 / 526972). After: 81.8% each (utime 556565 / 556192). During the attempt the thermal status reached 2, battery peaked at 39.9 °C and HAL SKIN at 40.3 °C; final bracket was battery 47%, status 2, Awake/Kalsa foreground, unplugged, low_power 0. No hard safety stop was reached. Sampler cadence was median 1.060 s (467 intervals; min 0.150, max 1.110 s).

The entered dense-numeric prompt produced `prompt_n=1479` on round 0, outside the 1024 ±5% band (972.8–1075.2); round 0 reported `promptMs=110290.482`, `predictedPerSecond=4.723`, and 136 generated tokens. More critically, the turn unexpectedly invoked `write_note`: `KALSA_TOOLCALL` says `executed=1`. A second tool round followed. This is an app bug and unintended app-data side effect; I did not try to remove or alter the resulting note. The required post-hoc `KALSA_GOVERNOR` record for turn 1 is absent, so `route_requested`, `route_push`, and `route_mismatch` cannot be validated despite the composer screenshot and app acknowledgement for `bench:route cpu`. Turn 1 is **INVALID** (token count and route evidence), and I stopped rather than send more prompts into the tool-enabled chat.

| Pair | CGGC order | Backend | Start battery / SKIN °C; thermal; level | Prompt tokens | Prefill ms / decode t/s | Metrics 1 / 2 / 3 | DSP CPU before → after | n / disposition |
|---:|---|---|---|---:|---|---|---|---|
| 1 | CPU → GPU | CPU | 37.3 / 37.7; status 1; 51% | 1479 | 110290; 4.723 (diagnostic) | — / — / — | 112/112% → 81.8/81.8% | 0; INVALID, app tool call and missing governor proof |
| 1 | CPU → GPU | GPU | — | — | — | — | — | 0; unrun after app bug |
| 2 | GPU → CPU | GPU | — | — | — | — | — | 0; unrun after app bug |
| 2 | GPU → CPU | CPU | — | — | — | — | — | 0; unrun after app bug |
| 3 | CPU → GPU | CPU | — | — | — | — | — | 0; unrun after app bug |
| 3 | CPU → GPU | GPU | — | — | — | — | — | 0; unrun after app bug |
| 4 | GPU → CPU | GPU | — | — | — | — | — | 0; unrun after app bug |
| 4 | GPU → CPU | CPU | — | — | — | — | — | 0; unrun after app bug |

Pair deltas: **none; n=0**. The optional 512-token block was not run. The prediction cannot be compared to a heat result. End-of-session timeout was restored to its original unset value (`null`); S23 ended unplugged at 46%, 39.8 °C, thermal status 2, Awake/Kalsa foreground, low_power 0. The sampler and temporary files created for this run were removed from `/data/local/tmp` after pulling the CSV.

Raw evidence: `raw/heat-arms/newapk-20260925/apk-verification.txt`, `apk-install.log`, `apk-postinstall.txt`, `newapk-start-bracket.txt`, `screen-route-ack/screen-1.png`, `screen-arm1-draft/screen-2.png`, `arm1-pre-send.txt`, `arm1-markers.txt`, `arm1-specific-markers.txt`, `arm1-sensors.csv`, `arm1-sampler-summary.txt`, `arm1-post-stop-bracket.txt`, and `final-timeout-restored.txt`; `newapk-evidence-inventory.txt` records `ls -la` and `wc -l`.

### Coordinator correction — tool flags are a harness prerequisite

Superseding the prior attempt's “app bug” disposition: the `write_note` tool round (`executed=1`) occurred because the measurement harness had not disabled the app's default-on tools. That was a harness configuration gap, not evidence of an app bug. The original arm values and INVALID status above remain visible. This resumed run will store literal `0` for `kalsa.web.enabled`, `kalsa.tools.device`, and `kalsa.tools.calendar`, plus `kalsa.bench.toolchoice=none`, through the campaign AsyncStorage/RKStorage path; it will verify those stored values and require a no-tool probe before calibration or heat arms. New-token count means total evaluated prompt tokens minus the cached prefix/system tokens reported for the turn. Calibration is a throwaway; all arms use the same frozen prompt in fresh chats. Battery budget is based on the live 45% S23 read at 19:32:42Z, with the 25% stop floor.

#### Tools-off probe and one-shot prompt calibration (2026-09-25)

After the harness correction, host and device RKStorage readback both showed `kalsa.web.enabled=0`, `kalsa.tools.device=0`, `kalsa.tools.calendar=0`, `kalsa.bench.toolchoice=none`. `KALSA_PREWARM` changed from the previous tools-on `systemChars=3886, toolCount=5, promptN=1812` to `systemChars=2398, toolCount=0, promptN=688`. The calibration turn joined on `turnId=1`, had `prompt_n=1116`, `tokensEvaluated=1804`, cached/system prefix 688 (`1804−688=1116` new tokens), `KALSA_TOOLCALL` toolChoice `none`, `structuredCalls=0`, `fallbackCalls=0`, `executed=0`, and `toolNames=[]`; `KALSA_GOVERNOR` requested/applied CPU with no mismatch. This verifies the no-tool prompt path and rules out the prior tool round for this probe.

The throwaway calibration body was 1,450 characters and measured 1,116 new tokens. Scaling its repeated numeric data while keeping the exact same instruction/header yields a frozen arm prompt of 1,330 characters (estimated 1,024 new tokens; ±5% acceptance is 973–1,075). This is a one-shot calibration; the exact frozen text is `raw/heat-arms/resume-tools-off-20260925/frozen-prompt-1024.txt`. Calibration answer completed without interruption or tool call. It is not an arm. Its CPU prefill took 68,297.59 ms, it predicted 149 tokens, and it raised thermal status to 2; this is setup evidence, not heat data. Post-turn bracket: unplugged, battery 41%, 39.5 °C, thermal status 2, Awake/Kalsa foreground, low_power 0. Subsequent `KALSA_SESSION` reported idle unload after 281,337 ms; reload is required before the next arm baseline.

### Resumed tools-off attempt — safety stop before heat arms (2026-09-25)

The DSP-contaminated flag remains. Prediction carried forward for CPU−GPU per 1k new prompt tokens: battery **+0.3 °C** and hottest SoC **+0.8 °C** (CPU warmer). Result: **not estimated**; no heat arm was sent, so there are no valid arms, paired deltas, residual SD, MDE, or route conclusion (`n=0`). The first arm was planned CPU and the next GPU; both remain unrun.

Tools were verified off in host and device database readbacks: three tool flags=`0`, `kalsa.bench.toolchoice=none`. Tools-on startup was `toolCount=5`, `systemChars=3886`, `promptN=1812`; tools-off was `toolCount=0`, `systemChars=2398`, `promptN=688`. The one-shot calibration measured 1,116 new tokens (`tokensEvaluated=1804 − prefix=688`), with no tool round (`toolChoice=none`, zero structured/fallback/executed calls, no tool names). The fixed prompt was scaled once to 1,330 characters, estimated 1,024 tokens; it was not sent as a heat arm. Calibration was CPU-routed/applied and `route_mismatch=false`.

Two pre-arm baselines were invalidated before any timed turn. Attempt 1 recorded one sensor row then the sampler's unreadable sysfs battery level was interpreted as zero, falsely tripping its guard and force-stopping Kalsa; at that checkpoint battery was 36%, 38.6 °C, status 2, Awake but Launcher resumed. Attempt 1b kept Kalsa foreground but its 167-row sampler interval median was **1.220 s**, over the 1.2-s limit; it is invalid. Its start bracket was unplugged, 33%, 39.7 °C, status 2, Awake/Kalsa foreground, `low_power=0`; daemon before was adsprpcd 103% / cdsprpcd 100% of one core (utime 743479 / 743071). Neither baseline was used for a number.

During the subsequent required model reload, automatic prewarm reached **thermal status 3** at battery 29%, 42.3 °C, while Awake/Kalsa foreground; this triggered the hard stop before an arm prompt. The app was force-stopped for the safety stop (exit 0). End bracket after restoring settings: unplugged, battery **28%**, 40.8 °C, status 3, `mWakefulness=Dozing`, `low_power=0`; screen timeout restored to its original unset state (`settings get system screen_off_timeout` → `null`). Final DSP read remained contaminated (adsprpcd 100%, cdsprpcd 103%; utime 805604 / 805136). No install, uninstall, or data clear occurred. Raw evidence is in `raw/heat-arms/resume-tools-off-20260925/`; the evidence inventory lists directory contents and line counts.

| Pair / attempt | Route | Prediction (CPU−GPU, per 1k) | Observed heat metrics | Prompt / prefill | DSP before → final after | Disposition |
|---:|---|---|---|---|---|---|
| 1 / baseline attempt 1 | CPU planned | Battery +0.3 °C; SoC +0.8 °C | — | No prompt sent | 100/100% → 100/103% | VOID before arm: false sampler guard; foreground lost |
| 1 / baseline attempt 1b | CPU planned | Same contrast | — | No prompt sent | 103/100% → 100/103% | VOID before arm: sampler median 1.220 s |
| 1 | GPU | Same contrast | — | Unrun | — | Safety stop at thermal status 3 before arm |

The optional second pair and 512-token block were not started. The raw scripts and evidence inventory are `raw/heat-arms/resume-tools-off-20260925/` and `raw/heat-arms/resume-tools-off-20260925/resume-evidence-inventory.txt`.
