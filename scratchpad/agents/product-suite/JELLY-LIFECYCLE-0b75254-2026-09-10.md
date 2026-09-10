# Jelly lifecycle verification — APK 0b75254 (2026-09-10)
Phone: Jelly Star / MediaTek G99 / Android 13 / USB `JELLYS0000053795`; APK SHA-256 `ccf25b782c6461bf6532e57d3e391fe1c634b3229b4dfc68260b476b8ea5b705`; model `lfm2.5-2.6b` (`LFM2.5 2.6B · QAD-Q4_0`); charge 100%.
Harness: `ANDROID_SERIAL=JELLYS0000053795`, PATH wrapper `adb-jelly-wrapper`, keep-awake from `scripts/device-env.sh`; no other serials touched. Evidence: `JELLY-LIFECYCLE-0b75254-2026-09-10/`.

| Cycle | Expected | Observed | Verdict |
|---|---|---|---|
| 1 baseline | Cold reply; prompt/tok/s; no stall; cold fit reads memory | 100%, 28→30°C; `promptMs=17264.055`, `6.6869 tok/s`, `tokensCached=2292`, no stall; fit `availableMb=3829` (resident) | PASS |
| 2 brief | 15s HOME/reopen keeps engine; no unload/init/prewarm; next send cached | 100%, 31→32°C; 2nd `promptMs=4651.039`, cached 2346; 3rd `promptMs=1954.204`, cached 2421; prewarm skip, no unload/init | PASS |
| 3 long | 70s HOME unloads at ~45s; reopen loads `.kvs`, no full prewarm | 100%, 32°C; no unload by 70s; reopen stayed resident; turn `promptMs=1892.223`, cached 2508 | FAIL |
| 4 kill | HOME 5s/force-stop preserves history and records load | 100%, 32°C; history 5→6; `load ok:true tokens=2508`; turn `promptMs=2143.931`, cached 2599 | PASS |
| 5 back/reopen | Short closure path behaves like brief grace | 100%, 32°C; same PID, grace cancelled, no unload/init; `promptMs=2000.522`, cached 2676 | PASS |
| 6 stop | Stop keeps partial; next send works; no stall | 100%, 32°C; node `Interrompi generazione` tapped; history after stop=9; next turn `promptMs=12195.256`, cached 3342; no stall | PASS |
| 7 regenerate | Run only with discoverable UI node | 100%, 32°C; dump exposed only `Altro`, no `Rigenera/Regenerate` node | SKIP (manual, owner) |
| 8 edit | Run only with discoverable UI node | 100%, 32°C; dump exposed only `Altro`, no `Modifica/Edit` node | SKIP (manual, owner) |
| 2 repeat | Same brief-grace result | 100%, 34°C; 2nd `promptMs=2325.467`, cached 3412; 3rd `promptMs=2303.728`, cached 3482; prewarm skip, no unload/init | PASS |
| 3 repeat | Same 45s unload and warm reopen | 100%, 34°C; no unload by 70s; reopen stayed resident; turn `promptMs=2294.345`, cached 3552 | FAIL |

FAIL exact lines (cycle 3): `09-10 08:07:46.893  6905  6929 I ReactNativeJS: KALSA_SESSION {"op":"save","ms":14,"ok":true,"estimatedBytes":17006948.12109375,"usedTokens":2421,"reason":"unchanged"}`; `09-10 08:08:57.108  6905  6929 I ReactNativeJS: 'background.grace', '{"cancelled":true}'`; no `model.unload` line.
FAIL exact lines (cycle 3 repeat): `09-10 08:22:41.079  8283  8308 I ReactNativeJS: KALSA_SESSION {"op":"save","ms":19,"ok":true,"estimatedBytes":24460220.3046875,"usedTokens":3482,"reason":"unchanged"}`; `09-10 08:24:22.401  8283  8308 I ReactNativeJS: 'background.grace', '{"cancelled":true}'`; no `model.unload` line.
