# Jelly d39fa51 — send2 rematch — 2026-09-12

Jelly only `192.168.1.82:5555` Jelly_Star. `adb install -r`. No stayon. Timeout 600000 during shot, restored **null**. Not G2.

## SHA — PASS

```text
local_sha256=1a0fb8f5a00b2d52f80648c41967213b19577bce8f09844ffe44bd112032598c
installed_sha256=1a0fb8f5a00b2d52f80648c41967213b19577bce8f09844ffe44bd112032598c
hash_match=true
```

Chat: `conv-g1-m01-1789025137` (6492-token off chat). Battery 75% 22.0°C → 73% 25.0°C. After: `stay_on=0`, `timeout=null`.

## Send 1

```text
17:28:49 load ok:true tokensOnDisk:6492 tokens:6492
17:29:01 window_align from:6 to:0
17:29:01 KALSA_KVPREFIX embd=6492 text_tokens=6889 n_common=6492
```

No `window_slide`. Telemetry predictedPerSecond=4.55.

## Send 2 (same process) — PASS

```text
17:30:17 window_align from:8 to:0
17:30:17 KALSA_KVPREFIX embd=6999 text_tokens=7330 n_common=6999
```

No `window_slide`. `n_common=6999` / `embd=6999` = 1.0. Not ~1833, not ~2094, not 0.

| check | verdict |
|---|---|
| SHA | **PASS** |
| chat | `conv-g1-m01-1789025137` |
| timeout/stayon after | **null / 0** |
| send2 n_common near embd | **PASS** (`6999` = `6999`) |
