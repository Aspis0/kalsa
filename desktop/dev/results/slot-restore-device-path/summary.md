# Slot restore on the device path, after T1 — the cache comes back warm

Date: 2026-09-21 · Machine: Apple M1 Max, 64 GiB unified · Engine: **the fork's own build**,
`build 11193, commit 833cde99b` (the T1 fix), `--bin build/bin/llama-server` · Model:
`Trinity-Nano-Preview-Q4_K_M.gguf`, 14 full-attention + 42 sliding-window layers · `--ctx-size
16384`, KV q8_0/q8_0, threads 4/4, batch 2048/ubatch 512 · Raw artifact: `results.json` beside this
file. Raw engine logs are **not** committed; no prompt or completion text is in the artifact.

## The question this answers

Does a chat saved to disk come back **warm** on the path a real device takes? The earlier run
(`dev/results/slot-restore-swa/`) said no for its `salted` arm, and that arm was read as the device
path. It was not, and the reason is a defect in the harness, not in the engine.

## Two defects in the harness, both mine to own

1. **The salt never rode the slot actions.** `slot_action()` called `post(...)` without `salt_hex`,
   so `save`, `erase` and `restore` went to the engine with **no** `X-Kalsa-Cache-Salt` header. The
   "salted" arm therefore meant *"completion salted, slot actions unsalted"* — a path no real client
   produces. The restore stamped the empty namespace (T1 stamps exactly what the caller sent), and
   the salted completion that followed wiped it: cold, for a reason that has nothing to do with the
   fix. The door does send the header — `crates/kalsa-door/src/engine.rs:67` calls
   `request::private_headers`, which writes both `X-Kalsa-Slot` and `X-Kalsa-Cache-Salt`
   (`request.rs:72-77`), with the comment that the sealed completion and the door's own engine call
   carry them so *"the engine reads one device either way"*. The harness was the only caller that
   did not.
2. **A stale engine can satisfy the health check.** An early re-run of this measurement was
   contaminated exactly that way, and the evidence is in the engine's own log: the fresh engine
   wrote `couldn't bind HTTP server socket, hostname: 127.0.0.1, port: 19313` and exited, while the
   harness's `wait_health` was answered by an **engine left running by the interrupted previous
   run** — one whose `--slot-save-path` pointed at the *previous* work directory. Every number
   looked plausible and was from the wrong process, in the wrong directory. The run was discarded
   whole. `Server.start` now refuses a port that already answers, and refuses a child that exited
   during boot, so this cannot pass silently again. The guard was then tested against a real
   listener (refused) and across a full run (no false positive) — the first version of the guard
   had one, because a port in `TIME_WAIT` is bindable by the engine and was not by the probe.

## The result

| engine | tokens | salt | `n_restored` | next `cache_n` | re-evaluated | file bytes | warm |
|---|---:|---|---:|---:|---:|---:|---|
| `--swa-full` off | 600 | yes | 607 | **595** | 5 | 32 135 692 | **yes** |
| `--swa-full` off | 600 | no | 607 | 595 | 5 | 32 135 692 | yes |
| `--swa-full` off | 1900 | yes | 1907 | **1895** | 5 | 101 493 292 | **yes** |
| `--swa-full` off | 1900 | no | 1907 | 1895 | 5 | 101 493 292 | yes |
| `--swa-full` on | 600 | yes | 607 | **599** | 1 | 18 510 048 | **yes** |
| `--swa-full` on | 600 | no | 607 | 599 | 1 | 18 510 048 | yes |
| `--swa-full` on | 1900 | yes | 1907 | **1899** | 1 | 58 149 648 | **yes** |
| `--swa-full` on | 1900 | no | 1907 | 1899 | 1 | 58 149 648 | yes |

Control, RAM prompt cache, same two sizes: warm return 595 and 1895, switch-back 595 and 1895.

**All eight rows are warm.** The whole conversation survives the round trip on disk and is reused on
the next request: 1895 of 1900 tokens with a full context. The `salted` rows — the device path, the
ones that read 0 with the whole prompt re-evaluated before — now read 1895 and 1899.

**`--swa-full` changes nothing about warmth.** It moves the file: a save without it carries one
context checkpoint, so 53.2 KB per token against 30.5 KB with it — at the 4 096-token floor, ≈ 218 MB
against ≈ 125 MB per chat. The plan therefore does not render the flag.

The artifact states its verdict as a **derived** field, `cold_arms`, and not as an assertion: it
reads `[]` here. The earlier version of this harness hardcoded a `blocking_mechanism` string that
named the namespace defect, and that string would have been false in exactly this run — an artifact
asserting a defect its own numbers show is gone. A field that can lie is worse than no field.

## What is and is not claimed

- **Claimed**: on this model, this engine build and this argv, a saved chat restores warm through
  the file, with and without a cache salt, and the salt is transparent to the reuse count.
- **Not claimed**: the timings. The machine had an Android emulator at ~3.4 cores throughout, and
  no timing comparison between runs is made here. The counts are what this run is for, and they are
  load-invariant.
- **Not claimed**: anything above ~1900 tokens. The saturating part of the curve, where the
  sliding-window layers stop growing, is above the 2 048-token window and is not measured.
- **Not claimed**: the door end to end. This harness calls the engine directly. The door's own path
  is covered by its tests and by the header plumbing cited above, not by this run.

## Superseded

`dev/results/slot-restore-swa/summary.md` is kept as written, because it records what was measured
with the harness as it then was. Its `salted` rows are **not** the device path and its title's
question is answered here. Its conclusion — that the cache namespace, not `--swa-full`, was the
variable — stands, and is what pointed at T1.
