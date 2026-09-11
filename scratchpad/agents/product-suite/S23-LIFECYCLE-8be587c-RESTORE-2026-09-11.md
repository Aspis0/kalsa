# S23 HOME reopen restore — APK `8be587c` — 2026-09-11

**Verdict: FAIL** on the restore half. Grace unload remains ~46 s (already PASS). Reopen did **not** load the saved chat KV. User-turn `n_common` was the **static prewarm prefix (1829)**, not the saved chat tokens.

S23 `192.168.1.152:5555`. SHA `52970eba0d5e7d587ddc048878425f97af69ecd0708be09716886cf8f6b5fb6e` hash_match. Started this shot at **37.7 °C**; later cycles hit 40–41.6 °C (waited back to 38 °C before reloads). No Xiaomi/Jelly. No APK. Not committed. Do not claim G2.

---

## What did save

Real chat `.kvs` existed before unload:

```text
09-11 08:57:55.505 KALSA_SESSION {"op":"save","ok":true,"usedTokens":512,"tokens":2091,"stem":"lfm2_002e5-2_002e6b__conv-g1-i14-1789042691__71419929","messageCount":1}
09-11 09:01:53.818 KALSA_SESSION {"op":"mark_prefix","ok":true,"usedTokens":3154,"stem":"…i14…71419929","reason":"last_exchange_prefix"}
09-11 09:02:55.141 'model.unload', '{"reason":"background","graceMs":45000}'
```

HOME immediately after the 2091-token save still logged `kv_not_chat` in the first cycle (extract had already taken the context). Unload at **46 s** on the idle-engine shot; this follow-up unload is the same `graceMs:45000` after screen-off.

## Reopen (required half)

```text
09-11 09:10:00.964 KALSA_SESSION {"op":"load","ms":31,"ok":false,"tokensOnDisk":0,"stem":"lfm2_002e5-2_002e6b__conv-g1-i14-1789042691__71419929","reason":"meta_mismatch:stale_kv_completed_turn"}
09-11 09:10:01.024 W/RNLlama KALSA_KVPREFIX embd=0 text_tokens=1832 n_common=0   // cold prewarm
09-11 09:11:22.483 W/RNLlama KALSA_KVPREFIX embd=1832 text_tokens=2953 n_common=1829  // user turn after prewarm
```

| required | observed |
|---|---|
| save ok:true on HOME of chat KV | mixed: chat save existed; HOME-entry save was `kv_not_chat` when extract had already run |
| unload ~45 s | **46 s** `graceMs:45000` (not immediate) |
| reopen load ok:true | **false** `meta_mismatch:stale_kv_completed_turn` |
| user-turn `n_common` ≈ saved | **1829** (prewarm), not 2091/3154. `prompt_n` not on this send (no `KALSA_TELEMETRY` line before log end) |

Not a harness miss: load ran and **refused** the on-disk stem. Product then cold-prewarmed. That is a reopen cold path on a conversation that had `save ok:true`.

Evidence: sibling `S23-LIFECYCLE-8be587c-RESTORE-2026-09-11/` (`save-before-home.txt`, `logcat-reopen2.txt`, `quoted-kalsa.txt`).
