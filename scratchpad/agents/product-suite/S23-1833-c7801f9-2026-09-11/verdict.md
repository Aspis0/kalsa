# S23 1833 smoke — APK `c7801f9` — 2026-09-11

S23 only `192.168.1.152:5555` SM-S911U. `adb install -r -d`. force-stop only. No file deletes. Not G2.

## SHA — PASS

```text
local_sha256=4da49ee0bda8e32c838166147d379c23e673a462feb5fc5159b102aac7b2a975
installed_sha256=4da49ee0bda8e32c838166147d379c23e673a462feb5fc5159b102aac7b2a975
hash_match=true
```

Start 28.9 °C / thermal 0; end 32.4 °C. Battery 13→12%.

## Load — ok

```text
17:53:40.913 KALSA_KVRESUME n_tokens=2357 pos_max=2356 is_hybrid=1 resumable=1
17:53:40.922 KALSA_SESSION {"op":"load","ok":true,"tokensOnDisk":2357,"tokens":2357,"stem":"lfm2_002e5-2_002e6b__conv-g1-i14-1789042691__71419929"}
```

`window_align` / `window_slide`: **none**.

## Send — n_common not ~embd — FAIL

```text
17:53:50.596 KALSA_THINKING {"turnId":"1","budget":512,"decodeTokPerSec":null,"forceShort":false,"contextMode":"ciswire"}
17:53:50.662 KALSA_KVPREFIX embd=2357 text_tokens=2661 n_common=1941
17:53:50.662 KALSA_KVDIVERGE n_common=1941 shared_lo=1933 embd_hi=1953 text_hi=1953
  shared_ids=[43 24637 9 124900 207 124899 5922 207 ]
  embd_ids=[24693 647 4105 ... 124899 63514 207 ]
  text_ids=[49 115086 291 ... ]
```

`n_common=1941` vs `embd=2357` (gap 416). Not ~system (~1832) and **not ~embd**. Same first-user/facts diverge class (5922 then body differs). S23 this chat is **ciswire**, not `off`.

| slice | quote | verdict |
|---|---|---|
| SHA | hash_match | **PASS** |
| load | ok:true tokens **2357** | **PASS** |
| window_align | none | — |
| contextMode | `ciswire` | logged |
| n_common vs embd | 1941 vs 2357 | **FAIL** |

Evidence sibling: `apk-install.txt`, `run.log`, `load.txt`, `after-send.txt`, `logcat-full.txt`.
