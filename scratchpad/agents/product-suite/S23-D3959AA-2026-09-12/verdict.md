# S23 d3959aa — load-only of existing 4454-token .kvs — 2026-09-12

S23 only `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` SM-S911U. `adb install -r` (no uninstall). No stayon. Timeout 300000 during shot, restored **null**. Not G2.

## SHA — PASS

```text
local_sha256=785be3083dedef4cc85a3e38905b9bc53ffe3f00c5f74bd9259017af0ab6a1e2
installed_sha256=785be3083dedef4cc85a3e38905b9bc53ffe3f00c5f74bd9259017af0ab6a1e2
hash_match=true
```

kvs after install (still 12:45, 30078316 B):

```text
-rw------- ... 30078316 2026-09-12 12:45 files/sessions/lfm2_002e5-2_002e6b__conv-g1-i14-1789042691__71419929.kvs
```

Battery 100% 27.9°C → 29.1°C. After: `stay_on_while_plugged_in=0`, `screen_off_timeout=null`.

## Load — PASS

```text
13:36:23 KALSA_KVRESUME n_tokens=4454 pos_max=4453 is_hybrid=1 resumable=1
13:36:23 KALSA_SESSION {"op":"load","ok":true,"tokensOnDisk":4454,"tokens":4454,"stem":"...conv-g1-i14..."}
```

Not `history_not_reproducible`. Not `no_file`. Not `historyHash`.

## Optional continuation (after PASS load)

```text
window_align from:15 to:0
window_slide kvCleared:true
KALSA_KVPREFIX embd=0 text_tokens=4758 n_common=0
```

`window_slide` cleared the restored KV on the next send. That is not the load-fail class (~1829 vs large embd). Load proof stands.

| check | verdict |
|---|---|
| SHA | **PASS** |
| kvs after install | **PASS** (30 078 316 B) |
| timeout/stayon after | **null / 0** |
| load | **PASS** (`tokens:4454`) |
