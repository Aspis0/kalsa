# S23 d39fa51 — G2 leftovers — 2026-09-13

S23 only. No reinstall (hash match). No stayon. Not G2. `oneshot` see run.log.

## SHA — PASS

```text
sha256=1a0fb8f5a00b2d52f80648c41967213b19577bce8f09844ffe44bd112032598c
hash_match=true
```

[s23] battery_before=  status: 3   level: 100   temperature: 345 
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

completed **2/20**. abort=`complete_fail=2`. stuck_1833_or_0_after_t5=**False**. restore load ok=**False**.

turn 1:
```text
09-13 09:53:11.642 22268 22357 W RNLlama : loadPrompt:473 KALSA_KVPREFIX embd=1832 text_tokens=2153 n_common=1829 mtp_draft_mem_shared=0 is_enc_dec=0 this=0xb4000079c0177100
```

turn 5:
```text
(no t5 KVPREFIX)
```

last 3 KVPREFIX:
```text
09-13 09:53:11.642 22268 22357 W RNLlama : loadPrompt:473 KALSA_KVPREFIX embd=1832 text_tokens=2153 n_common=1829 mtp_draft_mem_shared=0 is_enc_dec=0 this=0xb4000079c0177100
09-13 09:54:34.731 22268 22358 W RNLlama : loadPrompt:473 KALSA_KVPREFIX embd=2667 text_tokens=3003 n_common=2667 mtp_draft_mem_shared=0 is_enc_dec=0 this=0xb4000079c0177100
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
| 20-turn | **FAIL** (2/20) |
| timeout/stayon after | **? / ?** |
| G2 | **not claimed** |
