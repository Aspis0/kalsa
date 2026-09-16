# Jelly d39fa51 — kill-recovery load 6999 + send reuse — 2026-09-12

Jelly only `192.168.1.82:5555` Jelly_Star. Same APK, no reinstall. No stayon. Timeout 600000 during shot, restored **null**. Not G2.

## kvs

```text
-rw------- ... 47058556 2026-09-12 17:30 lfm2_002e5-2_002e6b__conv-g1-m01-1789025137__71419929.kvs
```

Battery 68% 22.0°C. After: `stay_on=0`, `timeout=null`.

## Load — PASS

```text
20:42:55 KALSA_KVRESUME n_tokens=6999 pos_max=6998 is_hybrid=1 resumable=1
20:42:55 KALSA_SESSION {"op":"load","ok":true,"tokensOnDisk":6999,"tokens":6999,"stem":"...conv-g1-m01-1789025137..."}
```

Not `no_file` / `historyHash` / `history_not_reproducible`.

## Send — PASS

```text
20:43:05 window_align from:8 to:0
20:43:05 KALSA_KVPREFIX embd=6999 text_tokens=7330 n_common=6999
```

No `window_slide`. `n_common=6999` / `embd=6999` = 1.0.

| check | verdict |
|---|---|
| kvs present | **PASS** (47 058 556 B) |
| load | **PASS** (`tokens:6999`) |
| send n_common/embd | **PASS** (`6999/6999`) |
| timeout/stayon after | **null / 0** |
