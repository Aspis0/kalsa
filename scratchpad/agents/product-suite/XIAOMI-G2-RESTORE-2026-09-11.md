# Xiaomi G2 restore — 2026-09-11

Force-stop restore on the **installed** APK (`main@4b29466`). No sideload of `b85e775`. MiniCPM5 not loaded. S23/Jelly not used. G2 is **not claimed**.

Oneshot exit **0**. Verdict file: `PASS`.

## Device / APK

- Serial: `192.168.1.193:34651` (TLS; `:37707` was Connection refused; mDNS `adb-625689a2-9xEOfw` → `:34651`)
- Xiaomi 14 `23127PN0CG` / houji / HyperOS OS3.0
- Package `com.kalsa.app`, SHA-256 `30253a56…7934` = `4b29466`, `lastUpdateTime=2026-09-09 21:18:01`
- Pref: `kalsa.model.id=lfm2.5-2.6b` (unchanged). Thinking stored `budget256` (this APK has no `KALSA_THINKING` EMA).
- Screen kept awake with `settings put system screen_off_timeout 86400000` (saved 120000, **restored** after the shot). Not `locksettings set-disabled`.

## Care

Before (oneshot start 10:20:50Z):

```
AC powered: false
level: 99
temperature: 333
Thermal Status: 0
```

After (10:22:53Z oneshot / host recheck):

```
AC powered: false
level: 99
temperature: 372
Thermal Status: 0
```

Battery 33.3 → 37.2 °C. Gate ≥40 °C not hit. Unplugged.

## Protocol

1. `Nuova chat` + share-send `Dimmi solo la parola: pane.`
2. Wait `KALSA_SESSION save ok:true`
3. `am force-stop com.kalsa.app` only
4. `am start` + Pronto
5. Italian continuation `Rispondi in italiano con una sola frase breve.`

Harness notes: uiautomator still lists the PIN pad on HyperOS while dumpsys is unlocked — do not use PIN text. `pipefail` + `grep -q` on a 90 kB dumpsys was a false lock; grep the file. `4b29466` disposes immediately on AppState background, so share-send re-inits; the force-stop load is the 06:22:04 line.

## Quoted lines

Turn 1 save (pid 28263):

```
KALSA_SESSION {"op":"save","ms":69,"ok":true,"estimatedBytes":13242075.61151079,"usedTokens":1931,"tokens":1931,"hash":"3556097458","messageCount":2}
KALSA_TELEMETRY {"turnId":"1","round":0,"tokensCached":1931,"tokensEvaluated":1846,"tokensPredicted":84,...,"promptMs":320.955,"predictedMs":4271.98...,"predictedPerSecond":19.66...,"interrupted":false}
```

After force-stop, new pid 2193:

```
W/RNLlama ( 2193): loadSession:108 KALSA_KVRESUME n_tokens=1931 pos_max=1930 mrope_media=0 is_recurrent=0 is_hybrid=1 n_swa=0 resumable=1
I/ReactNativeJS( 2193): KALSA_SESSION {"op":"load","ms":20,"ok":true,"tokens":1931}
I/ReactNativeJS( 2193): 'KALSA_KVDIAG', '{"n_past":1931,"tokens_on_disk":1931,"ok":true}'
I/ReactNativeJS( 2193): 'KALSA_PREWARM', '{"op":"skip","reason":"kv_holds_chat"}'
```

Italian continuation (after share-send re-init on this APK):

```
W/RNLlama ( 2193): loadSession:108 KALSA_KVRESUME n_tokens=1931 ... resumable=1
I/ReactNativeJS( 2193): KALSA_SESSION {"op":"load","ms":24,"ok":true,"tokens":1931}
W/RNLlama ( 2193): loadPrompt:471 KALSA_KVPREFIX embd=1931 text_tokens=1954 n_common=1931 mtp_draft_mem_shared=0 is_enc_dec=0 this=0xb40000736e64e530
I/ReactNativeJS( 2193): KALSA_TELEMETRY {"turnId":"1","round":0,"tokensCached":2216,"tokensEvaluated":1954,"tokensPredicted":261,"draftTokens":0,"draftAccepted":0,"promptMs":377.159,"predictedMs":14225.648,"predictedPerSecond":18.347143131898104,"contextFull":false,"interrupted":false}
```

Native decode tokens (Italian): `Il` ` p` `ane` ` è` ` un` ` al` `imento` ` comune` `.`

`n_common=1931` of `embd=1931` / `text_tokens=1954` (23 new). `promptMs=377` ms. Not the S23 37 s full prefill (`tokensEvaluated≈1890`, `promptMs≈37724`).

`KALSA_MEMORY` `memoryEnabled:0`. No MiniCPM5 in the load path (LFM `files/models/lfm2.5-2.6b/...` from G1).

## Limits

- APK is `4b29466`, not hash-unify `2619db0` and not KV-reuse `b85e775`.
- Share-send on this APK re-disposes; reuse is still observed (`n_common=1931`).
- Thinking 256, not 1024.
- One device, one force-stop cycle. Not blanket G2.

Raw: `scratchpad/agents/product-suite/XIAOMI-G2-RESTORE-2026-09-11/`.
