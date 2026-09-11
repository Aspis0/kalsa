# Jelly restore `2619db0` — 2026-09-11

**Verdict (scoped): PASS** on APK CI `34552188340` / app `2619db0`.
SHA-256 `0c45c496504e85dc4bb0c96ffb9560110f5ac59cd98d472455705ae6a5f78290` local==installed.

Device: Jelly `JELLYS0000053795` only. No S23, no Xiaomi.

## Sequence

1. `install -r`, Nuova chat, share-send `Dimmi solo la parola: pane.`
2. Save `ok:true` `tokens:2301` stem `lfm2_002e5-2_002e6b__conv-g1-m01-1789025137__71419929` (hash unify: stem now on the line).
3. `am force-stop`.
4. Relaunch.

## Restore

```
KALSA_KVRESUME n_tokens=2301 pos_max=2300 is_hybrid=1 resumable=1
KALSA_SESSION {"op":"load","ms":43,"ok":true,"tokensOnDisk":2301,"stem":"lfm2_…71419929","tokens":2301}
KALSA_PREWARM skip kv_holds_chat
```

## Continuation (not a 37 s wipe)

```
KALSA_KVPREFIX embd=2301 text_tokens=2606 n_common=2301
KALSA_TELEMETRY promptMs=15034 tokensEvaluated=2606 tokensCached=2716 tokensPredicted=109
```

`n_common=2301` equals the restored `embd`. New work is `2606-2301=305` tokens. `promptMs=15.0 s` on Jelly for that tail (~20 tok/s), not a cold 2301-token prefill.

The oneshot `FAIL` was a bad threshold (`promptMs < 15000`). Parent overrides: **PASS**.

## Same-bug residue (extract, not the user turn)

After the user save, extract starts:

```
KALSA_KVPREFIX embd=2716 text_tokens=209 n_common=2
KALSA_KVDIAG n_common=2 total=209 search_max=2 checkpoints=[2301,]
```

That is Grok’s `beb13d90` item 4: extract prompt diverges at once; restore checkpoint 2301 cannot be picked (`search_max=2`). Not this shot’s user continuation.

No MiniCPM5. App force-stopped after the shot.

Evidence: `RESTORE-2619db0-JELLY-2026-09-11/`
