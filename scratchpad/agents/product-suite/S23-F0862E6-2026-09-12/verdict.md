# S23 f0862e6 — restore after completed turn — 2026-09-12

S23 only `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` SM-S911U/dm1q. `adb install -r`. No stayon true. No 24h timeout. Timeout 300000 during shot, restored to **null**. Not G2.

## SHA — PASS

```text
local_sha256=ad949dc39fcf1e1730942817c1c04f52cca6a034d8a49d4fc5d4b614a957856e
installed_sha256=ad949dc39fcf1e1730942817c1c04f52cca6a034d8a49d4fc5d4b614a957856e
hash_match=true
```

Battery 100% 28.6°C → 37.3°C, thermal 0. After: `stay_on_while_plugged_in=0`, `screen_off_timeout=null`.

## Save (must complete a turn) — FAIL to land a keepable save

Pre-send (not the turn):

```text
10:40:15 load ok:true tokens:2382
10:40:19 save ok:true usedTokens:2382 tokens:2382 hash:1232353887 messageCount:13
```

That is **not** 512 vs 5632. Then send started (`n_common=0`), force-stop too early.

Completed-turn save after a later send:

```text
10:50:04 save ok:false reason:native_shorter_than_npast usedTokens:8192 tokens:3099
```

`usedTokens:8192` is nCtx, not n_past. Gate refused a 3099-token snapshot. Previous `.kvs` already gone (`window_slide kvCleared` on the empty-KV send).

## Restore — FAIL (`no_file`, not historyHash)

```text
10:40:48 load ok:false tokensOnDisk:0 reason:no_file
10:41:48 load ok:false tokensOnDisk:0 reason:no_file
10:46:07 load ok:false tokensOnDisk:0 reason:no_file
```

No `meta_mismatch:historyHash` on this APK. Hash projector was **not** exercised: there was no successful post-send save to restore.

| check | verdict |
|---|---|
| SHA | **PASS** |
| timeout restored | **null**, stayon **0** |
| post-send save ok | **FAIL** (`native_shorter_than_npast` 3099 vs 8192) |
| restore load ok | **FAIL** `no_file` |
