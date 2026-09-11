# Xiaomi HOME / 45s native lifecycle `8be587c` — 2026-09-11

One check on the daily-driver Xiaomi 14. No sideload. No S23/Jelly. No file deletes. No `locksettings`. G2 is **not claimed**.

## Device / APK

- Serial `192.168.1.193:34651`. SHA-256 installed `52970eba0d5e7d587ddc048878425f97af69ecd0708be09716886cf8f6b5fb6e` (`lastUpdateTime=2026-09-11 07:05:50`). Pref `lfm2.5-2.6b`.
- Unplugged. Care around HOME: `level:89 temperature:320` (32.0 °C), skin live `34.607` then `33.826`, `Thermal Status: 0`. After send: `level:88 temperature:320`. Gate ≥40 not hit.
- `screen_off_timeout` saved 120000, stretched for the shot, **restored 120000**.
- Same process `pid 6066` throughout (not a cold icon kill).

## Engine before HOME

Tap `Tocca per ricaricare` → Pronto. KV resident:

```
KALSA_KVRESUME n_tokens=2171 ... resumable=1
KALSA_SESSION {"op":"load","ms":39,"ok":true,"tokensOnDisk":2171,...,"tokens":2171}
KALSA_PREWARM skip reason=kv_holds_chat
KALSA_KVDIAG n_past=2171
```

## HOME (not swipe-away)

`KEYCODE_HOME` at `2026-09-11T12:12:06Z`. Focus `com.miui.home/.launcher.Launcher`. Immediate save, **no** immediate `model.unload`:

```
08:12:07.251 KALSA_SESSION {"op":"save","ms":80,"ok":true,...,"usedTokens":2171,...,"reason":"unchanged"}
```

Native heap still ~752 MiB at ~71 s. Unload line:

```
08:13:18.898 'model.unload', '{"reason":"background","graceMs":45000}'
```

Δ save→unload **≈ 71.6 s** (payload says `graceMs:45000`). Not the `4b29466` immediate dispose. Recents at ~119 s showed Native Heap ~47 MiB (engine gone). Did **not** swipe Kalsa away.

`background.grace {"cancelled":true}` on later foreground (timer was pending). Process-start `{"timer":"native"}` is not in this logcat window (pid lived since 07:26).

## Reopen from recents

`KEYCODE_APP_SWITCH`, tap Kalsa card (not app-info). Header `Tocca per ricaricare` (not still-warm). Reload:

```
KALSA_KVRESUME n_tokens=2171 ... resumable=1
KALSA_SESSION {"op":"load","ms":43,"ok":true,"tokensOnDisk":2171,...,"tokens":2171}
KALSA_PREWARM skip kv_holds_chat
```

Italian `Dimmi solo: ok.` (temp OK):

```
KALSA_KVPREFIX embd=2171 text_tokens=2189 n_common=2171
KALSA_TELEMETRY {...,"promptMs":288.674,"prompt_n":18,"predictedPerSecond":19.69...,"interrupted":false}
```

Not a 37 s wipe.

## Verdict

**PASS scoped** vs `4b29466` immediate HOME dispose: **HOME dispose immediately = no**. Unload observed at **~72 s** with `graceMs:45000` (late vs 45 s on this HyperOS run). Reopen: **load ok from .kvs** (43 ms), `n_common=2171`. Not blanket G2.

Raw: `scratchpad/agents/product-suite/XIAOMI-LIFECYCLE-8be587c-2026-09-11/`.
