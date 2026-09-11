# Jelly KV reuse after restore — APK `8be587c` — 2026-09-11

**Verdict: PASS.** After force-stop of Kalsa only, session load restored 2621 tokens and the next **user** turn reused that prefix. Prefill was **16.3 s / 317 tok**, not a cold history prefill.

Jelly only `JELLYS0000053795` (USB Jelly Star). S23/Xiaomi not used. `adb install -r` only. No phone file deletes. No Mac APK build.

---

## APK

| | |
|---|---|
| commit | `8be587c` `8be587c69e98f32aff0778bddd075a7c616f4cf9` |
| CI | run `34559343621` SUCCESS, artifact id `10184628653` |
| local SHA-256 | `52970eba0d5e7d587ddc048878425f97af69ecd0708be09716886cf8f6b5fb6e` |
| installed `base.apk` | same — **hash_match=true** |
| previous on device | `2619db0` SHA `0c45c496…` (`lastUpdateTime` 2026-09-10 22:23:58) |

Thinking stayed **512** (`KALSA_THINKING budget:512 decodeTokPerSec:null` after restart; EMA < 5 / withheld). Model `lfm2.5-2.6b`. Active chat `conv-g1-m01-1789025137`.

---

## First launch after install (not the measurement)

```text
09-11 07:06:42.285 I/ReactNativeJS: KALSA_SESSION {"op":"load","ms":93,"ok":false,"tokensOnDisk":0,"stem":"lfm2_002e5-2_002e6b__conv-g1-m01-1789025137__71419929","reason":"meta_mismatch:engineBuild"}
09-11 07:06:42.298 I/ReactNativeJS: 'KALSA_PREWARM', '{"op":"start","hash":"3586270056","systemChars":3969,"toolCount":5}'
09-11 07:07:40.333 I/ReactNativeJS: 'KALSA_PREWARM', '{"op":"done","promptMs":58015.031,"promptN":1832,"hash":"3586270056"}'
```

Stem hash still `71419929`; engineBuild meta changed. One short Italian turn on the **active** LFM chat (not Nuova chat): `Dimmi solo la parola: latte.`

```text
09-11 07:08:10.658 I/ReactNativeJS: KALSA_THINKING {"turnId":"1","budget":512,"decodeTokPerSec":null}
09-11 07:09:06.364 I/ReactNativeJS: KALSA_SESSION {"op":"save","ms":215,"ok":true,"estimatedBytes":19336488.9296875,"usedTokens":2621,"stem":"lfm2_002e5-2_002e6b__conv-g1-m01-1789025137__71419929","tokens":2621,"hash":"1331004840","messageCount":6}
```

Then `am force-stop com.kalsa.app` only.

---

## Restore (pid 24559)

```text
09-11 07:09:30.958 W/RNLlama : loadSession:108 KALSA_KVRESUME n_tokens=2621 pos_max=2620 mrope_media=0 is_recurrent=0 is_hybrid=1 n_swa=0 resumable=1
09-11 07:09:30.967 I/ReactNativeJS: KALSA_SESSION {"op":"load","ms":53,"ok":true,"tokensOnDisk":2621,"stem":"lfm2_002e5-2_002e6b__conv-g1-m01-1789025137__71419929","tokens":2621}
09-11 07:09:30.979 I/ReactNativeJS: 'KALSA_PREWARM', '{"op":"skip","reason":"kv_holds_chat"}'
```

## User turn (the measurement)

Continuation: `Dimmi solo: ciao.`

```text
09-11 07:10:10.016 I/ReactNativeJS: KALSA_THINKING {"turnId":"1","budget":512,"decodeTokPerSec":null}
09-11 07:10:10.068 W/RNLlama : loadPrompt:473 KALSA_KVPREFIX embd=2621 text_tokens=2938 n_common=2621 mtp_draft_mem_shared=0 is_enc_dec=0 this=0xb400007d9d29cf70
09-11 07:10:53.513 I/ReactNativeJS: KALSA_TELEMETRY {"turnId":"1",...,"tokensCached":3107,"tokensEvaluated":2938,"tokensPredicted":168,"promptMs":16304.104,"predictedMs":26975.842,"prompt_n":317,...}
```

| metric | 2619db0 (last Jelly PASS) | 8be587c (this shot) |
|---|---|---|
| load tokens | 2301 | 2621 |
| `n_common` (user turn) | 2301 = saved | **2621 = saved** |
| `prompt_n` | (not emitted) | **317** |
| `tokensEvaluated` | 2606 | 2938 |
| `promptMs` | 15034 | **16304** |

`prompt_n` 317 ≪ `tokensEvaluated` 2938. `2938 − 317 = 2621` = restored prefix. Decode ~6.2 tok/s is the 27 s predicted, not the wait. Thinking 512.

## Extract path (`n_common=2`, expected)

No `keep_prefix=0` on restore pid 24559. Recover **succeeded** at 2/211 (not the polluted keep_prefix branch).

```text
09-11 07:10:53.841 W/RNLlama : loadPrompt:473 KALSA_KVPREFIX embd=3107 text_tokens=211 n_common=2 ...
09-11 07:10:53.841 W/RNLlama : loadPrompt:522 KALSA_KVDIVERGE n_common=2 ...
09-11 07:10:53.841 I/RNLlama : loadPrompt:580 restored state checkpoint: reusing 2/211 prompt tokens
```

Different prompt (extract). Wipe/tiny-prefix is expected. User turn is the PASS.

Kalsa force-stopped after the shot. Do not claim G2.

Evidence: sibling `JELLY-KV-REUSE-8be587c-2026-09-11/` (`quoted-rnllama.txt`, `kalsa-load.txt`, `kalsa-telemetry.txt`, `apk-install.txt`).
