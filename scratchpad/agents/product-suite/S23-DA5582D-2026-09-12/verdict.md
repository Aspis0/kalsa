# S23 da5582d — restore after completed turn — 2026-09-12

S23 only `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` SM-S911U. `adb install -r`. No stayon. Timeout 300000 during shot, restored **null**. Not G2.

## SHA — PASS

```text
local_sha256=88b30f9c7d1320bc65724dd0c3692a66a0f0a9cb21f1a1935c91b63f41f0ce6d
installed_sha256=88b30f9c7d1320bc65724dd0c3692a66a0f0a9cb21f1a1935c91b63f41f0ce6d
hash_match=true
```

Battery 100% 29.2°C → 38.3°C. After: `stay_on_while_plugged_in=0`, `screen_off_timeout=null`.

## Save after send — PASS

Not `native_shorter_than_npast`. Native tokens = usedTokens (4134), not 512 vs thousands, not 8192 refuse.

```text
11:40:46 KALSA_SESSION {"op":"save","ok":true,"usedTokens":4134,"tokens":4134,"hash":"337352400","messageCount":17}
```

(Cold start `n_common=1829` vs `embd=1832` on this send is expected: first load was `no_file` leftover.)

## Restore — FAIL

```text
11:41:12 KALSA_SESSION {"op":"load","ok":false,"tokensOnDisk":0,"reason":"meta_mismatch:history_not_reproducible"}
```

Not `historyHash`. The file was rejected by `historyWindowReproducesKv` and deleted (`tokensOnDisk:0`). Hash projector not the fail this shot.

| check | verdict |
|---|---|
| SHA | **PASS** |
| timeout/stayon after | **null / 0** |
| post-send save | **PASS** (`4134`/`4134`) |
| restore load | **FAIL** `history_not_reproducible` |
