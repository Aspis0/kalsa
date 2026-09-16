# S23 d39fa51 — kill-recovery load i14 + send reuse — 2026-09-12

S23 only `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` SM-S911U. Same APK, no reinstall. No stayon. Timeout 300000 during shot, restored **null**. Not G2.

## kvs

```text
-rw------- ... 35048956 2026-09-12 15:37 lfm2_002e5-2_002e6b__conv-g1-i14-1789042691__71419929.kvs
```

Battery 100% 27.6°C → 29.5°C. After: `stay_on=0`, `timeout=null`.

## Load — PASS

```text
20:47:26 KALSA_KVRESUME n_tokens=5199 pos_max=5198 is_hybrid=1 resumable=1
20:47:26 KALSA_SESSION {"op":"load","ok":true,"tokensOnDisk":5199,"tokens":5199,"stem":"...conv-g1-i14..."}
```

Not `no_file` / `historyHash` / `history_not_reproducible`. tokens>4000.

## Send — PASS

```text
20:47:33 KALSA_KVPREFIX embd=5199 text_tokens=5499 n_common=5196
```

No `window_slide`. `n_common=5196` / `embd=5199` = 0.999.

| check | verdict |
|---|---|
| kvs present | **PASS** (35 048 956 B) |
| load | **PASS** (`tokens:5199`) |
| send n_common/embd | **PASS** (`5196/5199`) |
| timeout/stayon after | **null / 0** |
