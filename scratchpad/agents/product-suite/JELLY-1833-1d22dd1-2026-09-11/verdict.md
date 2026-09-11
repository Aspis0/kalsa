# Jelly 1833 reopen — APK `1d22dd1` — 2026-09-11

**Verdict: FAIL.** After load `ok:true tokens:6492` the next send still reused only the system prefix (`n_common=1827` / `1837`), not `embd`. No `window_align` line. File kept.

Jelly only `JELLYS0000053795`. No S23/Xiaomi. `adb install -r -d`. No phone file deletes. Calc skipped. G2 not claimed.

## SHA

```text
local_sha256=572154719efb8ff5dcf1b131172dfd68b943dd9c15606acdb8be26de10ac339c
installed_sha256=572154719efb8ff5dcf1b131172dfd68b943dd9c15606acdb8be26de10ac339c
hash_match=true
install_rc=0
```

Existing LFM chat `conv-g1-m01-1789025137` (the c498639 6492-token `.kvs`, 43675852 B).

## 1. First send after install (pid 24182)

```text
KALSA_KVRESUME n_tokens=6492 pos_max=6491 resumable=1
KALSA_SESSION {"op":"load","ms":115,"ok":true,"tokensOnDisk":6492,"stem":"lfm2_…71419929","tokens":6492}
KALSA_PREWARM skip kv_holds_chat
KALSA_THINKING {"turnId":"1","budget":512,"decodeTokPerSec":null,"forceShort":false}
KALSA_KVPREFIX embd=6492 text_tokens=6655 n_common=1827
```

`window_align`: **none**. `n_common=1827` ≈ system 1832, not ≈ `embd=6492`. Interrompi (do not leave unbounded).

## 2. Interrompi + force-stop + reopen (pid 24720)

`.kvs` still present (43675852 B). Not `tokens_loaded:0`.

```text
KALSA_KVRESUME n_tokens=6492 pos_max=6491 resumable=1
KALSA_SESSION {"op":"load","ms":85,"ok":true,"tokensOnDisk":6492,"tokens":6492}
KALSA_PREWARM skip kv_holds_chat
KALSA_THINKING {"turnId":"1","budget":512,"decodeTokPerSec":null,"forceShort":false}
KALSA_KVPREFIX embd=6492 text_tokens=6551 n_common=1837
```

Again `n_common=1837` ≈ system, not reuse. `window_align`: **none**. Interrompi + `am force-stop`. File still there.

## Optional calc

Skipped (first two sends already FAIL; would prefill thousands of tokens).

Kalsa stopped.
