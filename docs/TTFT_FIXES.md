# TTFT fixes (v2)

Branch: `fix/ttft-v2` @ `203bd2f`. Jelly PLUGGED then unplugged mid-S3.
This file is the honesty log — do not treat `ok:true` as KV reuse.

## Jelly measured (2026-08-13, Qwen 3.5 2B Q4_K_M, PLUGGED unless noted)

| Mandate | Result | Notes |
|---|---|---|
| 1a wait 90s → send | **1.40 s** TTFT | `engine.eagerInit` in logcat; prewarm `done` 40.1 s; `reusing 1276/1293` |
| 1b send immediately | **39.5 s** TTFT | Join: mark during prewarm, `done` then `reusing 1276/1293`, send `promptMs` 3.1 s. < 53 s |
| 2 25-msg window | **PARTIAL** | In-process measure lost (process died, unplugged 72%). Recovery send reused 1276/1456, not a full 1.4k re-prefill |
| 3 swipe → wait 90s → send | **2.48 s** TTFT | KVDIAG `n_past:0` (expected); prewarm 40.2 s then `reusing 1276/1313` |

## Scenario table

| Id | Scenario | What v2 does | Device |
|---|---|---|---|
| 1a | First send, no prior prewarm this process (engine already up, empty KV) | Full system+tools+user prefill | UNKNOWN_DEVICE |
| 1b | First send after eager init + static prefix prewarm | User-line delta only (prefix-match on system+tools) | UNKNOWN_DEVICE |
| 2 | Later send, same process, after a live chat turn | Prefix-match on hot chat KV; `prewarmPrefixHash` marked so `ensure()` cannot overwrite it | UNKNOWN_DEVICE |
| 3 | Swipe-relaunch / process death, then send | Hybrid restore does **not** populate native KV (Q6.c). Prewarm still runs (`prewarmPrefixHash` is null). Then 1b-shaped send | UNKNOWN_DEVICE |

Catalog chat models (`ModelRegistry`) are `hybrid` / `kvUnified`. Gemma is
dense: a successful restore populates real KV, so prewarm is skipped
(`kvHoldsChatSession && !hybrid`). Hybrid restores still prewarm (`n_past=0`).

## Keepalive (P0-1) — not shipped

We did **not** land keepalive. Do **not** add an AppState dispose-skip flag
on this branch.

An in-memory “skip dispose on background” bit cannot survive OEM process
kill. On Jelly the process is gone in under five minutes; the next launch
is a new JS isolate with a cold native context. Skipping dispose only
helps the rare case where the process is still alive when the user returns.

A real keepalive is a **foreground service** (notification, OEM battery
exceptions, product copy). That is a product decision, not this branch.

Background still: abort in-flight turn → save if KV-reproducible →
`disposeEngine`. Foreground does not auto-reload.

## Prewarm design (V2-2)

- **FIFO join.** `queueStaticPrefixPrewarm` and `streamAssistantTurn` both
  go through `withEngineJob`. A send that lands during prewarm waits; it
  never starts a second `completion()`. llama.rn prefix-match then reuses
  the hot system+tools KV.
- **`n_predict: 0`.** Eval prompt only. If the binding rejects that, the
  prewarm fails — we never fall back to `n_predict: 1` (that would emit a
  token and poison prefix-match). Rejection also emits
  `KALSA_SESSION {"op":"prewarm","ok":false,"reason":"n_predict_rejected"}`
  so the existing session grep sees it.
- **Hash is identity-only.** `computePrewarmPrefixHash` covers
  `{locale, systemText, tools:{name,schema}}`. It is **not** a byte-proof
  of the rendered jinja prompt (`now()`, template drift, binding changes
  can miss while `match:true` logs). Native `KALSA_KVDIAG0` / `reusing n/m`
  remain the byte-level signal.
- **Foreground only.** `queueStaticPrefixPrewarm` no-ops unless
  `AppState.currentState === "active"` so an OEM background relaunch does
  not burn a 40 s prefill. AppShell re-kicks on foreground.
- **Hybrid restore still prewarms.** Hash-skip only when
  `prewarmPrefixHash === prefix.hash` (already prewarmed / marked this
  process). Do **not** skip solely because `kvHoldsChatSession`. After
  `tryLoadEngineSession` JS can report `ok:true tokens:1635` while native
  `n_past=0`; that used to set `kvHoldsChatSession` and skip, leaving a
  cold KV (swipe-relaunch still ~53s). After a live chat turn we set
  `prewarmPrefixHash` to the current static prefix hash so a later
  `ensure()` does not wipe hot chat KV with a system-only prefill.
- **Dense restore skips prewarm.** `shouldSkipPrewarmAfterRestore`:
  `kvHoldsChatSession && !isHybridOrKvUnifiedModel`. Gemma `loadSession`
  is real KV; a system+`.` prewarm would `seq_rm` the restored tail and
  the first send would re-prefill the whole history. Hybrid behavior
  unchanged. Post-turn hash-marking unchanged.

## KVDIAG honesty (V2-4)

After every `tryLoadEngineSession` (success **and** fail):

```text
KALSA_KVDIAG {"n_past":0,"tokens_on_disk":1635,"ok":true}
```

| Field | Meaning |
|---|---|
| `tokens_on_disk` | `tokens_loaded` from `loadSession` when it is a finite number, else `0` |
| `n_past` | `0` for hybrid/kvUnified (native wipes; do not repeat the JS lie). For non-hybrid, `tokens_loaded` |
| `ok` | `true` only when meta matched and `sessionLoadHasTokens` passed |

`ok:true` is **not** reuse. On catalog hybrids the honest line is
`n_past: 0` even when `tokens_on_disk > 0`.

## Bake rematch key (review 5.4)

`commitBakedLastUser` and `applyBakedUserTails` share `bakeRematchKey`
(trim + 4000-char slice). `lastUserBare` is the same string that lands in
engine history: `applyPersonaTail(text, persona)`. Previous assembled
users get the same persona frame so rematch is not a silent no-op.

## Compaction default (V2-3)

`kalsa.context.compaction` stays the value (`"1"` / `"0"`).
`kalsa.context.compaction.choice` is `"1"` only after the user toggles
Settings. Without that marker, leftover `"0"` from the old default is
treated as ON (`parseCompactionEnabled`). Settings first-read does not
write. AppShell send uses the shared parse.

## Explicitly not in this branch

- **P1-3 / P1-4** — skipped. Cherry-pick conflicted with `cc8ed55`
  (in-flight turn vs `clearCache` / dispose). Do not re-litigate here.
- **Q6.c** (native hybrid `loadSession` actually restoring KV) — out of
  scope. We prewarm after restore and we log honest `KALSA_KVDIAG`.
- **V2-0.4 staged progress labels** — optional, skipped.
- **Keepalive / AppState dispose-skip / foreground service** — see above.

## Flags

`src/engine/ttftFlags.ts`: `EAGER_ENGINE_INIT`, `EAGER_PREFIX_PREWARM`,
`COMPACTION_ENABLED_DEFAULT` (all `true`). Revert a flag to restore the
old policy without deleting the code.
