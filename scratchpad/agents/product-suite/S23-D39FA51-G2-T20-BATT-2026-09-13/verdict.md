# S23 d39fa51 — G2 leftovers — 2026-09-13

S23 only. No reinstall (hash match). No stayon. Not G2. `oneshot` see run.log.

## SHA — PASS

```text
sha256=1a0fb8f5a00b2d52f80648c41967213b19577bce8f09844ffe44bd112032598c
hash_match=true
```

[s23] battery_before=  status: 3   level: 53   temperature: 349 
(no battery_after)
After: stay_on=?, timeout=?.

## 1) Tools — SKIP (parent-verified PASS, not re-run)

```text
(empty)
```

```text
(empty)
```

numeric in UI: **False**. tool line present: **False**.

```text
(empty)
```

## 2) Documents — SKIP/HARNESS_MISS

library n=0. keys:
```text
(empty)
```

```text
(empty)
```

```text
(empty)
```

## 3) 20 turns — FAIL

completed **6/20**. abort=`complete_fail=6`. stuck_1833_or_0_after_t5=**False**. restore load ok=**False**.

turn 1:
```text
09-13 12:28:55.722  9572  9662 W RNLlama : loadPrompt:473 KALSA_KVPREFIX embd=1832 text_tokens=2153 n_common=1829 mtp_draft_mem_shared=0 is_enc_dec=0 this=0xb400007a40e57900
```

turn 5:
```text
09-13 12:37:19.246  9572  9657 W RNLlama : loadPrompt:473 KALSA_KVPREFIX embd=2153 text_tokens=2153 n_common=2153 mtp_draft_mem_shared=0 is_enc_dec=0 this=0xb400007a40e57900
```

last 3 KVPREFIX:
```text
09-13 12:33:46.483  9572  9659 W RNLlama : loadPrompt:473 KALSA_KVPREFIX embd=0 text_tokens=1832 n_common=0 mtp_draft_mem_shared=0 is_enc_dec=0 this=0xb400007a40e57900
09-13 12:37:19.246  9572  9657 W RNLlama : loadPrompt:473 KALSA_KVPREFIX embd=2153 text_tokens=2153 n_common=2153 mtp_draft_mem_shared=0 is_enc_dec=0 this=0xb400007a40e57900
09-13 12:41:16.443  9572  9661 W RNLlama : loadPrompt:473 KALSA_KVPREFIX embd=2153 text_tokens=1832 n_common=1093 mtp_draft_mem_shared=0 is_enc_dec=0 this=0xb400007a40e57900
```

restore:
```text
(empty)
```

| check | verdict |
|---|---|
| SHA | **PASS** |
| tools | **SKIP (parent-verified PASS, not re-run)** |
| documents | **SKIP/HARNESS_MISS** |
| 20-turn | **FAIL** (6/20) |
| timeout/stayon after | **? / ?** |
| G2 | **not claimed** |
