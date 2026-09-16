# S23 202e364 — G1 restore after completed turn — 2026-09-12

S23 only `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` SM-S911U. `adb install -r`. No stayon. Timeout 300000 during shot, restored **null**. Not G2.

## SHA — PASS

```text
local_sha256=47f67dff3092b4f9fd5765eb071e120890f8e5cae09cbf35b1c4a7220f0585c1
installed_sha256=47f67dff3092b4f9fd5765eb071e120890f8e5cae09cbf35b1c4a7220f0585c1
hash_match=true
```

Battery 100% 28.0°C → 36.9°C. After: `stay_on_while_plugged_in=0`, `screen_off_timeout=null`.

## Save after send — PASS

```text
12:45:41 KALSA_SESSION {"op":"save","ok":true,"usedTokens":8192,"tokens":4454,"hash":"3438398506","messageCount":21}
```

(`usedTokens:8192` is still the disk estimate / nCtx in the log; native `tokens:4454`. Not `native_shorter_than_npast`.)

First load was `no_file` leftover (expected).

## Restore — FAIL

```text
12:46:09 KALSA_SESSION {"op":"load","ok":false,"tokensOnDisk":0,"reason":"meta_mismatch:history_not_reproducible"}
```

Still `history_not_reproducible`. Not `historyHash`. Not a successful G1 restore.

| check | verdict |
|---|---|
| SHA | **PASS** |
| timeout/stayon after | **null / 0** |
| post-send save | **PASS** (`tokens:4454`) |
| restore load | **FAIL** `history_not_reproducible` |
