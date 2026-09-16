# S23 d39fa51 — send2 rematch (2094 vs 4893) — 2026-09-12

S23 only `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` SM-S911U. `adb install -r`. No stayon. Timeout 300000 during shot, restored **null**. Not G2.

## SHA — PASS

```text
local_sha256=1a0fb8f5a00b2d52f80648c41967213b19577bce8f09844ffe44bd112032598c
installed_sha256=1a0fb8f5a00b2d52f80648c41967213b19577bce8f09844ffe44bd112032598c
hash_match=true
```

Battery 28.7°C → 32.0°C. After: `stay_on=0`, `timeout=null`.

## Send 1

```text
15:36:46 load ok:true tokensOnDisk:4893 tokens:4893
15:36:54 window_align from:21 to:0
15:36:54 KALSA_KVPREFIX embd=4893 text_tokens=5199 n_common=4893
```

No `window_slide`. Full prefix reuse of the 4893 KV.

## Send 2 (same process) — PASS

```text
15:37:05 KALSA_KVPREFIX embd=5199 text_tokens=5499 n_common=5196
15:37:05 KALSA_KVDIVERGE n_common=5196 ... (tail of previous turn vs new last-user 5922)
```

No `window_slide`. `n_common=5196` / `embd=5199` = 0.999 (≥ 0.8). Not ~2094, not 0, not ~1829.

| check | verdict |
|---|---|
| SHA | **PASS** |
| timeout/stayon after | **null / 0** |
| send2 n_common near embd | **PASS** (`5196` ≈ `5199`) |
