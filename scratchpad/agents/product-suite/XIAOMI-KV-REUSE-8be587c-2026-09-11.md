# Xiaomi KV-reuse `8be587c` — 2026-09-11

One restore check on the daily-driver Xiaomi 14 after `adb install -r`. No S23/Jelly. No MiniCPM5 load. No file deletes. No `locksettings`. G2 is **not claimed**.

## APK

| | |
|---|---|
| CI | `34559343621` SUCCESS, artifact `kalsa-apk-arm64-v8a-debuggable-8be587c69e98f32aff0778bddd075a7c616f4cf9` |
| local SHA-256 | `52970eba0d5e7d587ddc048878425f97af69ecd0708be09716886cf8f6b5fb6e` |
| installed `base.apk` | same — **hash_match=true** |
| `lastUpdateTime` | `2026-09-11 07:05:50` |
| serial | `192.168.1.193:34651` (TLS; `:37707` refused) |

`kalsa.model.id=lfm2.5-2.6b`. First post-install load (expected):

```
KALSA_SESSION {"op":"load","ms":5,"ok":false,"tokensOnDisk":0,"stem":"lfm2_002e5-2_002e6b__conv-g1-c02-1789009104__71419929","reason":"no_meta"}
```

Then LFM chat `Dimmi solo la parola: pane.` wrote `files/sessions/lfm2_002e5-2_002e6b__conv-g1-c02-1789009104__71419929.kvs` at `2026-09-11 07:07` (not deleted G1 stems). Harness miss: share-send/`wait_pronto` wanted the string `Pronto` while the chip said `Tocca per ricaricare`; the turn still saved. Force-stop was **Kalsa only**.

## Restore (quoted)

```
W/RNLlama ( 6066): loadSession:108 KALSA_KVRESUME n_tokens=1956 pos_max=1955 mrope_media=0 is_recurrent=0 is_hybrid=1 n_swa=0 resumable=1
I/ReactNativeJS( 6066): KALSA_SESSION {"op":"load","ms":23,"ok":true,"tokensOnDisk":1956,"stem":"lfm2_002e5-2_002e6b__conv-g1-c02-1789009104__71419929","tokens":1956}
I/ReactNativeJS( 6066): 'KALSA_PREWARM', '{"op":"skip","reason":"kv_holds_chat"}'
```

Italian continuation `Rispondi in italiano con una sola frase breve.` → UI `Il pane è delizioso.`

```
KALSA_THINKING {"turnId":"1","budget":512,"decodeTokPerSec":null}
W/RNLlama ( 6066): loadPrompt:473 KALSA_KVPREFIX embd=1956 text_tokens=1979 n_common=1956 mtp_draft_mem_shared=0 is_enc_dec=0 this=0xb40000736e64e530
KALSA_TELEMETRY {...,"tokensCached":2171,"tokensEvaluated":1979,"tokensPredicted":191,...,"promptMs":356.156,"predictedMs":9403.437,"predictedPerSecond":20.31...,"interrupted":false,"prompt_n":23}
KALSA_SESSION {"op":"save",...,"ok":true,"usedTokens":2171,...,"messageCount":4}
```

`n_common=1956` equals saved tokens. `prompt_n=23` = `1979-1956`. Not ~0. First thinking budget **512** (`decodeTokPerSec:null` EMA withhold).

## Care

Unplugged throughout. Before kill: `level:93 temperature:304` (30.4 °C), `Thermal Status: 0`. After continuation: `level:93 temperature:304`, skin live `33.493` °C. Gate ≥40 not hit. `screen_off_timeout` restored to `120000`.

## Verdict

**PASS** (scoped): `load ok:true` and user-turn `n_common=1956` ≈ saved. Extract `n_common=2` not exercised. Not G2.

Raw: `scratchpad/agents/product-suite/XIAOMI-KV-REUSE-8be587c-2026-09-11/`.
