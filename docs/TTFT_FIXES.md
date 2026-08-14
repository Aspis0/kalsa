# TTFT fixes (v2)

Branch: `fix/ttft-v2`. Device numbers stay **UNKNOWN_DEVICE** until Jelly
verify. This file is the honesty log — do not treat `ok:true` as KV reuse.

## Scenario table

| Id | Scenario | What v2 does | Device |
|---|---|---|---|
| 1a | First send, no prior prewarm this process (engine already up, empty KV) | Full system+tools+user prefill | UNKNOWN_DEVICE |
| 1b | First send after eager init + static prefix prewarm | User-line delta only (prefix-match on system+tools) | UNKNOWN_DEVICE |
| 2 | Later send, same process, after a live chat turn | Prefix-match on hot chat KV; `prewarmPrefixHash` marked so `ensure()` cannot overwrite it | UNKNOWN_DEVICE |
| 3 | Swipe-relaunch / process death, then send | Hybrid restore does **not** populate native KV (Q6.c). Prewarm still runs (`prewarmPrefixHash` is null). Then 1b-shaped send | UNKNOWN_DEVICE |

Catalog chat models (`ModelRegistry`) are `hybrid` / `kvUnified`. Gemma is
dense; the skip policy is still hash-only (see prewarm).

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
  token and poison prefix-match).
- **Hash miss falls through.** If `prewarmPrefixHash !== sendHash`, we log
  `KALSA_PREWARM {"match":false,...}` and send anyway (full prefill). No
  retry, no second completion.
- **Hybrid restore still prewarms.** Skip only when
  `prewarmPrefixHash === prefix.hash` (already prewarmed / marked this
  process). Do **not** skip solely because `kvHoldsChatSession`. After
  `tryLoadEngineSession` JS can report `ok:true tokens:1635` while native
  `n_past=0`; that used to set `kvHoldsChatSession` and skip, leaving a
  cold KV (swipe-relaunch still ~53s). After a live chat turn we set
  `prewarmPrefixHash` to the current static prefix hash so a later
  `ensure()` does not wipe hot chat KV with a system-only prefill.

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
