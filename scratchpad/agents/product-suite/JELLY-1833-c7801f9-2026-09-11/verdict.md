# Jelly 1833 reopen — APK `c7801f9` — 2026-09-11

**Verdict: PASS.** Compaction-off clamp fired (`window_align from:5 to:0`), `contextMode:"off"`, first send `n_common=6492` = `embd`. File kept.

Jelly only `JELLYS0000053795`. Chat `conv-g1-m01-1789025137`. `adb install -r -d`. No phone file deletes. G2 not claimed.

## SHA

```text
local_sha256=4da49ee0bda8e32c838166147d379c23e673a462feb5fc5159b102aac7b2a975
installed_sha256=4da49ee0bda8e32c838166147d379c23e673a462feb5fc5159b102aac7b2a975
hash_match=true
install_rc=0
```

## Load

```text
09-11 17:53:34.063 W/RNLlama : loadSession:108 KALSA_KVRESUME n_tokens=6492 pos_max=6491 is_hybrid=1 resumable=1
09-11 17:53:34.074 I/ReactNativeJS: KALSA_SESSION {"op":"load","ms":110,"ok":true,"tokensOnDisk":6492,"stem":"lfm2_002e5-2_002e6b__conv-g1-m01-1789025137__71419929","tokens":6492}
09-11 17:53:34.087 I/ReactNativeJS: 'KALSA_PREWARM', '{"op":"skip","reason":"kv_holds_chat"}'
```

Not `tokens_loaded:0`. `.kvs` 43675852 B still present after send + force-stop.

## First send (pid 28230)

```text
09-11 17:54:00.846 I/ReactNativeJS: KALSA_SESSION {"op":"window_align","from":5,"to":0}
09-11 17:54:00.854 I/ReactNativeJS: KALSA_THINKING {"turnId":"1","budget":512,"decodeTokPerSec":null,"forceShort":false,"contextMode":"off"}
09-11 17:54:00.935 W/RNLlama : loadPrompt:473 KALSA_KVPREFIX embd=6492 text_tokens=6881 n_common=6492
```

| gate | measured |
|---|---|
| `contextMode:"off"` | **yes** |
| `window_align from>0 to 0` | **from:5 to:0** |
| `n_common` ≈ `embd` | **6492 = 6492** (not ~1830) |
| file kept | **yes** |

`6881 − 6492 = 389` new tokens. Interrompi after the quote (do not leave unbounded). Kalsa `am force-stop`.
