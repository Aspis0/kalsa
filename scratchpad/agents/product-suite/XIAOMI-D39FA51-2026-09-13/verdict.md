# Xiaomi 14 d39fa51 — A+B — 2026-09-13

Xiaomi only `192.168.1.193:38413` houji / 23127PN0CG. No reinstall. No stayon. Timeout 300000 during shot, restored **120000**. `oneshot_exit=0`. Not G2.

## SHA — PASS

```text
local_sha256=1a0fb8f5a00b2d52f80648c41967213b19577bce8f09844ffe44bd112032598c
installed_sha256=1a0fb8f5a00b2d52f80648c41967213b19577bce8f09844ffe44bd112032598c
hash_match=true
lastUpdateTime=2026-09-13 01:01:27
```

Chat `conv-g1-c02-1789009104`. Battery 98% 36.0°C → 97% 37.2°C unplugged. After (adb): `stay_on_while_plugged_in=0`, `screen_off_timeout=120000`. `window_slide` absent in `logcat.txt` and `logcat-b.txt`.

## A — two sends, same pid 27865 — PASS

```text
09-13 08:29:04.849 27865 10684 I ReactNativeJS: KALSA_SESSION {"op":"load","ms":47,"ok":true,"tokensOnDisk":2361,"stem":"lfm2_002e5-2_002e6b__conv-g1-c02-1789009104__71419929","tokens":2361}
09-13 08:29:17.167 27865 10744 W RNLlama : loadPrompt:473 KALSA_KVPREFIX embd=2361 text_tokens=2375 n_common=2361 mtp_draft_mem_shared=0 is_enc_dec=0 this=0xb40000743092c3f0
09-13 08:29:27.013 27865 10740 W RNLlama : loadPrompt:473 KALSA_KVPREFIX embd=2436 text_tokens=2449 n_common=2374 mtp_draft_mem_shared=0 is_enc_dec=0 this=0xb40000743092c3f0
09-13 08:29:27.013 27865 10740 W RNLlama : loadPrompt:522 KALSA_KVDIVERGE n_common=2374 shared_lo=2366 embd_hi=2386 text_hi=2386 shared_ids=[43 24637 22 124900 207 124899 63514 207 ] embd_ids=[124901 597 4695 355 13564 622 310 2491 496 43 24637 10 ] text_ids=[597 4695 355 13564 622 310 2491 496 43 24637 10 1529 ]
```

send2: no `window_slide`. `n_common/embd` **2374/2436 = 0.975** (≥ 0.8).

## B — kill-recovery pid 30434 — PASS

```text
09-13 08:29:37.123 30434 13051 W RNLlama : loadSession:108 KALSA_KVRESUME n_tokens=2486 pos_max=2485 mrope_media=0 is_recurrent=0 is_hybrid=1 n_swa=0 resumable=1
09-13 08:29:37.138 30434 13051 I ReactNativeJS: KALSA_SESSION {"op":"load","ms":33,"ok":true,"tokensOnDisk":2486,"stem":"lfm2_002e5-2_002e6b__conv-g1-c02-1789009104__71419929","tokens":2486}
09-13 08:29:48.687 30434 13142 W RNLlama : loadPrompt:473 KALSA_KVPREFIX embd=2486 text_tokens=2500 n_common=2486 mtp_draft_mem_shared=0 is_enc_dec=0 this=0xb4000074309482d0
```

load `ok:true` `tokens:2486` (>0). send3: no `window_slide`. `n_common/embd` **2486/2486 = 1.000** (≥ 0.8).

| check | verdict |
|---|---|
| SHA | **PASS** |
| chat | `conv-g1-c02-1789009104` |
| timeout/stayon after | **120000 / 0** |
| A two-send | **PASS** (`2374/2436`) |
| B kill-recovery | **PASS** (`2486/2486`) |
| G2 | **not claimed** |
