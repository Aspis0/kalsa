# S23 88152e1 — send2 must keep KV — 2026-09-12

S23 only `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` SM-S911U. `adb install -r`. No stayon. Timeout 300000 during shot, restored **null**. Not G2.

## SHA — PASS

```text
local_sha256=376bc11b1c31951fa384b057339610d00578e98b6622150695c3f85c19bd8ddc
installed_sha256=376bc11b1c31951fa384b057339610d00578e98b6622150695c3f85c19bd8ddc
hash_match=true
```

Battery 28.9°C → 37.2°C. After: `stay_on=0`, `timeout=null`. First load `no_file` (expected).

## Send 1

```text
14:42:50 KALSA_KVPREFIX embd=1832 text_tokens=4649 n_common=1829
14:42:50 KALSA_KVDIVERGE n_common=1829 ... 5922 ...
14:45:59 save ok:true tokens:4893 usedTokens:4893
```

No `window_slide` on send 1.

## Send 2 (same process) — PASS (no slide, n_common≠0)

```text
14:46:06 KALSA_KVPREFIX embd=4893 text_tokens=5199 n_common=2094
14:46:06 KALSA_KVDIVERGE n_common=2094 ... 5922 ...
```

**No `window_slide`.** `n_common=2094` is not 0 and not stuck at ~1829. KV 4893 kept. Prefix match is partial (2094 vs 4893, still a facts-header diverge).

| check | verdict |
|---|---|
| SHA | **PASS** |
| timeout/stayon after | **null / 0** |
| send2 no window_slide | **PASS** |
| send2 n_common not 0 | **PASS** (`2094` vs embd `4893`) |
