# Xiaomi G2 identity — 2026-09-11

Overnight G2 on the **installed** APK. No sideload of `b85e775`. No S23/Jelly use. No file deletes. MiniCPM5 not loaded.

G2 is **not claimed**. Restore/continuation is blocked on the lockscreen PIN until a human unlocks.

## Device (quoted)

`adb connect 192.168.1.193:5555` was Connection refused (as at dispatch). Xiaomi is on LAN; HyperOS wireless debugging is TLS, not tcp 5555.

```
dns-sd -L adb-625689a2-9xEOfw _adb-tls-connect._tcp local.
→ Android-2.local.:37707  api=36.0 name=23127PN0CG
dns-sd -G v4 Android-2.local. → 192.168.1.193
nc 192.168.1.193:37707 succeeded; :5555 failed
adb connect 192.168.1.193:37707 → connected
adb devices -l → 192.168.1.193:37707 device product:houji_global model:23127PN0CG device:houji
```

```
getprop ro.product.model          23127PN0CG
getprop ro.product.marketname     Xiaomi 14
getprop ro.product.device         houji
getprop ro.product.brand          Xiaomi
getprop ro.build.version.release  16
getprop ro.mi.os.version.name     OS3.0
getprop ro.build.version.incremental  OS3.0.303.0.WNCMIXM
getprop ro.serialno               625689a2
getprop ro.build.fingerprint      Xiaomi/houji_global/houji:16/BP2A.250605.031.A3/OS3.0.303.0.WNCMIXM:user/release-keys
```

S23 `192.168.1.152:5555` and Jelly `JELLYS0000053795` were attached; not used.

## Care (quoted)

Before any Kalsa load (first connect):

```
dumpsys battery
  AC powered: true
  USB powered: false
  Wireless powered: false
  status: 2
  level: 68
  temperature: 319
  Max charging current: 1500000
dumpsys thermalservice
  Thermal Status: 0
  Temperature{mValue=33.7, mType=2, mName=battery, mStatus=0}
  Temperature{mValue=36.136, mType=3, mName=skin, mStatus=0}
```

After lockscreen probe (screen slept again):

```
  AC powered: true
  level: 70
  temperature: 323
  Thermal Status: 0
  Temperature{mValue=32.3, mType=2, mName=battery, mStatus=0}
  Temperature{mValue=34.001, mType=3, mName=skin, mStatus=0}
```

Idle `/proc/meminfo` (Kalsa not running, screen Dozing):

```
MemTotal:       11436476 kB
MemAvailable:    5056248 kB
SwapTotal:      12582908 kB
```

G0 idle MemAvailable was ~3.5 GiB; tonight ~4.8 GiB. Still the HyperOS false-refusal regime (do not treat Swap as RAM).

Battery 31.9–32.3 °C. Gate is ≥40 °C (400). Did **not** start inference. `mStayOn=false` after the lock probe.

`locksettings get-disabled` → `false`. Swipe revealed PIN pad:

```
Enter PIN or use fingerprint to unlock
Tap above to use Face unlock
```

PIN was not typed. Screen returned to Dozing. `locksettings set-disabled` was **not** used (daily driver).

## Installed Kalsa (quoted)

```
pm path com.kalsa.app
package:/data/app/~~DeNYv173bysY7AISoS0ibA==/com.kalsa.app-aJRmtGO9LfjleAWs-NrAYg==/base.apk

dumpsys package com.kalsa.app
  versionName=0.1.0
  versionCode=1 minSdk=33 targetSdk=36
  flags=[ DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ]
  lastUpdateTime=2026-09-09 21:18:01
  firstInstallTime=2026-08-07 12:17:05
  User 0: ... stopped=true notLaunched=false enabled=0

sha256sum base.apk
30253a561638d24a776c09e95887edd3f931ef8cb87add2d9331699725ab7934
size 142912926  date 2026-09-09 21:17
```

That hash is `main@4b29466` (`fix(documents): tell the model to answer in the user's language…`, 2026-09-09). Same bytes as the G1 Jelly pull in `g1-model-select/device/jelly/apk-sha.txt`. **Not** `2619db0`, **not** `1807aad`, **not** `b85e775`. APK `extra` in `assets/app.config` is `{}` (no `engineBuildId`).

pidof empty at connect. Prefer `am start`; nothing to force-stop yet.

## Model on disk vs selected

LFM present and hash-matches G1:

```
files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf
size 1593894944
sha256 a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03
```

MiniCPM5 **files** are still on device (`MiniCPM5-2B-Q4_K_M.gguf`, 2026-09-09 21:19). Not loaded. Not deleted.

RKStorage **before** operator write:

```
kalsa.model.id          = dev-minicpm5-2b
kalsa.bench.thinking    = budget256
kalsa.locale            = it
kalsa.web.enabled       = 0
kalsa.tts.enabled       = 0
kalsa.conversations.v1  activeId=conv-g1-c02-1789009104 (empty leftover)
```

`dev-minicpm5-2b` is the cancelled G1 MiniCPM5 arm leftover. MiniCPM5 is forbidden until 12/10. App was STOPPED. Operator `sql_write` (ci-lib, verified read-back):

```
kalsa.model.id = lfm2.5-2.6b
kalsa.bench.thinking unchanged = budget256
```

G1 `.kvs` files remain under `files/sessions/` (18 LFM stems, 2026-09-09 21:29–22:25). Not deleted.

## Thinking budget on this APK (not 1024)

`4b29466` `ModelRegistry` LFM `thinking: { short: 256, extended: 512 }`. Stored mode `budget256` → `thinking_budget_tokens = short = 256`. There is no EMA ≥5 tok/s → 1024 path in this APK (that is post-G1). Expect **256**, not 1024, until a newer APK is installed (parent decision; not tonight).

`4b29466` **does** emit `KALSA_SESSION` save/load, `KALSA_TELEMETRY` (`promptMs`, `tokensEvaluated`, not JS `prompt_n`), and native `KALSA_KVPREFIX n_common=` (llama.rn patch). There is **no** `KALSA_THINKING` tag in this APK. Capture RNLlama, not only ReactNativeJS.

Load hash at `AppShell.tsx` (4b29466 ~3600) already passes `hasTools=true` into `computePromptEnvHash`. Save uses `hasTools && toolCallingEnabled` (`LlamaService.ts` ~2932). Same class as Jelly `c906727` `no_file` after process kill.

G1 on this same APK already showed **same-process** restore working, e.g. `ev-lfm/case-M01.turn1.ev`:

```
KALSA_SESSION {"op":"load","ms":30,"ok":true,"tokens":2083}
KALSA_PREWARM ... kv_holds_chat
KALSA_TELEMETRY ... tokensEvaluated:2103 ... promptMs:391.722 ... predictedPerSecond:18.56
```

Decode 13–20 tok/s on G1 LFM (would be EMA ≥5 → 1024 on a later APK). G2 still needs **force-stop** restore, not same-process init. G1 `.ev` files did not capture `KALSA_KVPREFIX`.

`4b29466` **immediately disposes on AppState background** (no 45 s grace). Share-send will unload; that is APK-scoped, not a new bug.

Session load/save prompt-env hash unify (`2619db0`) is **not** in this APK. Restore may be `no_file` for the same hasTools mismatch as Jelly `c906727`. That is a measurement, not a silent reinstall.

## G2 gap vs Jelly / S23 (this phone)

| Item | Jelly | S23 | Xiaomi 14 (this unit) |
|---|---|---|---|
| G1 LFM quality | 24×2 scored | 24 ok | **24/24** (G1) |
| Installed APK | `2619db0` / `c906727` shots | `1807aad` | **`4b29466` 9/09 21:18** |
| Restore `load ok:true` + `n_common` | PASS scoped `2619db0` | load ok then 37 s cold prefill | **unrun** (PIN) |
| Stop / edit / regen / copy / EMA | PASS scoped | extract-cancel only | **missing** |
| Extract-cancel | memory PASS scoped | Nuova + HOME PASS | **missing** |
| Thinking 1024 if decode ≥5 | 512 (Jelly slow) | 1024 path in later APK | **256 stored on 4b29466** |
| HyperOS false-refusal | n/a | n/a | **unrun** |
| Functional 20–30 turn suite | not G2-complete | not G2-complete | **unrun** |

## Next

Oneshot (not executed while PIN is up): `xiaomi-g2-restore-oneshot.sh`. After human unlock: care check → one save → force-stop Kalsa only → relaunch → `KALSA_SESSION load` + `KALSA_KVPREFIX` + `KALSA_TELEMETRY` → one Italian continuation. Stop if battery ≥40 °C.

Reconnect: mDNS `adb-625689a2-9xEOfw` `_adb-tls-connect._tcp` (port is not 5555). Backoff 30 s → 2 min. Do not spam pairing.

## Heartbeats (locked — no inference)

UTC | batt_deci | skin_C | level | AC | thermal | keyguard | adb
---|---|---|---|---|---|---|---
2026-09-11T04:02:00Z | 304 | 31.428 | 72 | true | 0 | blocked:keyguard mDreamingLockscreen=true | 192.168.1.193:37707 device
2026-09-11T04:02:05Z | 303 | 3 | 73 | true | 0 | FALSE-UNLOCK (empty dumpsys fail-open) — still mDreamingLockscreen=true, oneshot NOT run | 192.168.1.193:37707
2026-09-11T04:03:21Z | 307 | 32.053 | 73 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:03:51Z | 306 | 31.973 | 74 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:04:52Z | 306 | 31.819 | 74 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:05:59Z | 305 | 31.625 | 74 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:07:30Z | 305 | 31.565 | 75 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:09:01Z | 307 | 32.075 | 75 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:10:31Z | 305 | 31.696 | 76 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:12:02Z | 304 | 31.56 | 76 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:13:33Z | 304 | 31.428 | 77 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:15:03Z | 302 | 31.201 | 77 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:16:34Z | 299 | 30.82 | 78 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:18:05Z | 297 | 30.529 | 78 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:19:36Z | 296 | 30.213 | 79 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:21:07Z | 293 | 29.993 | 79 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:22:38Z | 292 | 30.12 | 80 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:24:08Z | 292 | 30.136 | 80 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:25:39Z | 292 | 30.147 | 81 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:27:10Z | 292 | 30.153 | 81 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:28:40Z | 292 | 30.268 | 82 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:30:11Z | 300 | 32.679 | 82 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:31:41Z | 311 | 35.348 | 82 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:33:12Z | 334 | 37.248 | 82 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:34:43Z | 340 | 37.418 | 82 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:36:14Z | 336 | 35.125 | 83 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:37:44Z | 333 | 34.412 | 83 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:39:15Z | 325 | 33.437 | 84 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:40:46Z | 319 | 32.69 | 84 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:42:17Z | 315 | 32.098 | 84 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:43:47Z | 309 | 31.521 | 85 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:45:18Z | 305 | 31.123 | 85 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:46:49Z | 303 | 30.989 | 86 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:48:19Z | 300 | 30.927 | 86 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:49:50Z | 299 | 30.888 | 87 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:51:20Z | 298 | 30.713 | 87 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:52:51Z | 297 | 30.758 | 88 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:54:22Z | 297 | 30.551 | 88 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:55:53Z | 296 | 30.54 | 88 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:57:24Z | 296 | 30.519 | 89 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T04:58:54Z | 295 | 30.497 | 89 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:00:24Z | 295 | 30.535 | 90 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:01:55Z | 294 | 30.388 | 90 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:03:25Z | 294 | 30.18 | 90 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:04:56Z | 291 | 29.926 | 91 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:06:27Z | 289 | 29.67 | 91 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:07:58Z | 287 | 29.499 | 92 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:09:28Z | 286 | 29.44 | 92 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:10:59Z | 286 | 29.601 | 92 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:12:29Z | 287 | 29.686 | 93 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:14:00Z | 287 | 29.753 | 93 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:15:31Z | 287 | 29.753 | 94 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:17:01Z | 288 | 29.82 | 94 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:18:32Z | 288 | 29.831 | 94 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:20:03Z | 288 | 29.843 | 95 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:21:34Z | 288 | 29.617 | 95 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:23:04Z | 287 | 29.494 | 95 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:24:35Z | 286 | 29.332 | 96 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:26:06Z | 284 | 29.094 | 96 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:27:37Z | 283 | 28.897 | 96 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:29:08Z | 281 | 28.753 | 97 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:30:38Z | 279 | 28.57 | 97 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:32:09Z | 277 | 28.463 | 97 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:33:40Z | 277 | 28.516 | 98 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:35:11Z | 277 | 28.638 | 98 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:36:42Z | 277 | 28.469 | 98 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:38:12Z | 276 | 28.389 | 99 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:39:43Z | 276 | 28.319 | 99 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:41:14Z | 275 | 28.357 | 99 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:42:44Z | 276 | 28.217 | 99 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:44:15Z | 276 | 28.458 | 99 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:45:45Z | 275 | 28.399 | 99 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:47:16Z | 275 | 28.474 | 99 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:48:47Z | 276 | 28.415 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:50:18Z | 275 | 28.228 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:51:48Z | 274 | 27.99 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:53:19Z | 273 | 27.996 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:54:50Z | 272 | 27.843 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:56:20Z | 271 | 27.822 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:57:51Z | 271 | 27.832 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T05:59:22Z | 271 | 27.947 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:00:53Z | 272 | 28.12 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:02:23Z | 272 | 28.088 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:03:54Z | 272 | 27.947 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:05:25Z | 272 | 27.865 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:06:56Z | 270 | 27.695 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:08:27Z | 269 | 27.573 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:09:57Z | 268 | 27.499 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:11:28Z | 268 | 27.557 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:12:58Z | 269 | 27.728 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:14:29Z | 269 | 27.822 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:15:59Z | 270 | 27.909 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:17:30Z | 271 | 27.92 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:19:01Z | 270 | 27.756 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:20:31Z | 269 | 27.657 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:22:02Z | 269 | 27.504 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:23:33Z | 268 | 27.42 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:25:04Z | 267 | 27.346 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:26:35Z | 266 | 27.425 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:28:06Z | 267 | 27.547 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:29:36Z | 267 | 27.625 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:31:07Z | 268 | 27.695 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:32:38Z | 269 | 27.761 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:34:09Z | 269 | 27.723 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:35:40Z | 269 | 27.594 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:37:11Z | 268 | 27.462 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:38:41Z | 267 | 27.383 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:40:12Z | 266 | 27.415 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:41:43Z | 267 | 27.431 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:43:14Z | 267 | 27.541 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:44:44Z | 267 | 27.604 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:46:15Z | 268 | 27.685 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:47:46Z | 268 | 27.772 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:49:17Z | 269 | 27.69 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:50:47Z | 268 | 27.515 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:52:18Z | 267 | 27.436 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:53:49Z | 267 | 27.383 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:55:20Z | 266 | 27.304 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:56:50Z | 265 | 27.245 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:58:21Z | 265 | 27.346 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T06:59:52Z | 266 | 27.457 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:01:22Z | 266 | 27.552 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:02:53Z | 276 | 29.516 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:04:23Z | 282 | 30.882 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:05:54Z | 292 | 31.24 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:07:24Z | 295 | 31.609 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:08:54Z | 300 | 31.984 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:10:25Z | 302 | 32.25 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:11:55Z | 306 | 32.513 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:13:25Z | 307 | 32.646 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:14:56Z | 311 | 33.249 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:16:26Z | 314 | 33.679 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:17:56Z | 318 | 34.066 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:19:27Z | 321 | 34.378 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:20:57Z | 324 | 34.493 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:22:28Z | 326 | 34.613 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:23:58Z | 326 | 34.234 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:25:29Z | 319 | 32.745 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:27:00Z | 309 | 31.68 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:28:31Z | 306 | 30.899 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:30:02Z | 298 | 30.426 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:31:32Z | 296 | 30.268 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:33:03Z | 293 | 30.136 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:34:33Z | 292 | 29.948 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:36:04Z | 290 | 29.831 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:37:35Z | 289 | 29.66 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:39:06Z | 286 | 29.306 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:40:37Z | 285 | 29.001 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:42:07Z | 281 | 28.698 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:43:38Z | 279 | 28.469 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:45:09Z | 277 | 28.303 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:46:40Z | 276 | 28.228 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:48:11Z | 275 | 28.453 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:49:42Z | 276 | 28.437 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:51:12Z | 276 | 28.431 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:52:43Z | 276 | 28.554 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:54:14Z | 276 | 28.522 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:55:45Z | 276 | 28.437 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:57:15Z | 275 | 28.207 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T07:58:46Z | 274 | 28.034 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:00:17Z | 273 | 27.871 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:01:48Z | 272 | 27.734 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:03:19Z | 270 | 27.778 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:04:49Z | 270 | 27.811 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:06:20Z | 271 | 27.903 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:07:51Z | 272 | 28.239 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:09:22Z | 272 | 28.196 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:10:53Z | 273 | 28.147 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:12:24Z | 273 | 28.147 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:13:55Z | 272 | 27.98 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:15:26Z | 272 | 27.871 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:16:56Z | 271 | 27.69 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:18:27Z | 269 | 27.583 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:19:58Z | 268 | 27.515 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:21:29Z | 268 | 27.583 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:22:59Z | 268 | 27.673 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:24:30Z | 269 | 27.811 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:26:00Z | 270 | 27.871 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:27:31Z | 270 | 27.903 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:29:02Z | 271 | 27.952 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:30:33Z | 271 | 27.996 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:32:04Z | 271 | 27.778 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:33:35Z | 269 | 27.663 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:35:06Z | 268 | 27.52 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:36:36Z | 268 | 27.367 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:38:07Z | 266 | 27.309 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:39:38Z | 266 | 27.452 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:41:08Z | 267 | 27.499 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:42:39Z | 267 | 27.673 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:44:10Z | 268 | 27.706 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:45:41Z | 268 | 27.783 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:47:11Z | 269 | 27.832 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:48:42Z | 270 | 27.816 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:50:13Z | 271 | 28.072 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:51:43Z | 271 | 27.734 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:53:14Z | 269 | 27.52 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:54:45Z | 268 | 27.446 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:56:16Z | 267 | 27.351 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:57:47Z | 266 | 27.483 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T08:59:17Z | 267 | 27.562 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T09:00:48Z | 267 | 27.646 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T09:02:19Z | 268 | 27.679 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T09:03:50Z | 269 | 27.86 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T09:05:21Z | 270 | 27.865 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T09:06:51Z | 270 | 27.849 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T09:08:22Z | 269 | 27.712 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T09:09:53Z | 269 | 27.625 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T09:11:24Z | 268 | 27.431 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T09:12:54Z | 267 | 27.372 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T09:14:25Z | 266 | 27.298 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T09:15:56Z | 266 | 27.404 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T09:17:26Z | 267 | 27.515 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T09:18:57Z | 267 | 27.594 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T09:20:28Z | 268 | 27.641 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T09:21:59Z | 268 | 27.723 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T09:23:30Z | 269 | 27.778 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T09:25:01Z | 269 | 27.651 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T09:26:31Z | 268 | 27.578 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T09:28:02Z | 267 | 27.431 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T09:29:33Z | 266 | 27.298 | 100 | true | 0 | blocked:keyguard | 192.168.1.193:37707
2026-09-11T09:31:03Z | - | - | - | - | - | blocked:keyguard | 192.168.1.193:37707
2026-09-11T09:32:33Z | - | - | - | - | - | blocked:keyguard | 192.168.1.193:37707
2026-09-11T09:34:06Z | - | - | - | - | - | blocked:adb | missing
2026-09-11T09:34:38Z | - | - | - | - | - | blocked:adb | missing
2026-09-11T09:35:40Z | - | - | - | - | - | blocked:adb | missing
2026-09-11T09:37:42Z | - | - | - | - | - | blocked:adb | missing
2026-09-11T09:39:45Z | - | - | - | - | - | blocked:adb | missing
2026-09-11T09:41:47Z | - | - | - | - | - | blocked:adb | missing
2026-09-11T09:43:49Z | - | - | - | - | - | blocked:adb | missing
2026-09-11T09:45:52Z | - | - | - | - | - | blocked:adb | missing
2026-09-11T09:47:54Z | - | - | - | - | - | blocked:adb | missing
2026-09-11T09:49:56Z | - | - | - | - | - | blocked:adb | missing
2026-09-11T09:51:58Z | - | - | - | - | - | blocked:adb | missing
2026-09-11T09:54:01Z | - | - | - | - | - | blocked:adb | missing
2026-09-11T09:56:03Z | - | - | - | - | - | blocked:adb | missing
2026-09-11T09:58:05Z | - | - | - | - | - | blocked:adb | missing
2026-09-11T10:00:08Z | - | - | - | - | - | blocked:adb | missing
2026-09-11T10:02:10Z | - | - | - | - | - | blocked:adb | missing
2026-09-11T10:04:12Z | - | - | - | - | - | blocked:adb | missing
2026-09-11T10:06:12Z | - | - | - | - | - | blocked:keyguard 6h-cap | 192.168.1.193:37707
