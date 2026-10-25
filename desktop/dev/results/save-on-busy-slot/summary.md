# A save that arrives mid-turn, and what a chat's file weighs

Two engines (fork build, `833cde99b`), same model
(`Trinity-Nano-Preview-Q4_K_M.gguf`, sha in `results.json`), `--ctx-checkpoints 1`,
`--cache-ram 0`, no `--swa-full`, one context at 8 192 and one at 16 384.
The script is `dev/measure-save-on-busy-slot.py`; every number below is a field in
`results.json`, and the verdicts are derived from the recorded clocks rather than
asserted.

## 1. A save into a live turn is deferred, and it outlasts the door

| context | turn lasted | save answered after | status | `n_saved` | saved the whole turn |
|---|---|---|---|---|---|
| 8 192 | 34.5 s | 34.2 s | 200 | 2 529 | yes |
| 16 384 | 34.2 s | 33.9 s | 200 | 2 523 | yes |

The save was issued 3 s into the turn and answered when the turn ended: the engine
**defers** a slot action while the slot is generating, then writes the state the
turn left behind. Nothing of the turn is lost by the save itself.

That is not the good news it looks like, because of one number:

**The door's patience is 10 s (`PATIENCE`, `crates/kalsa-door/src/lib.rs`), and a
deferred save takes as long as the turn.** Every save the door issues into a busy
slot therefore reads, at the door, as a failure — while the engine is in fact
writing the file. `door_would_have_given_up` is true in both arms.

Consequences for T4, both of which the review had only argued:

- The mark belongs after the turn, not before it (C1 of the review): marking at the
  top makes the door fire the save into the very turn it is trying to record, and
  the request that persists the state is not that one — it is the **retry**.
- The retry is therefore load-bearing, which is what makes a tick that stops with
  the webview (C2) the defect that actually costs a turn. A Rust-side timer is not
  tidier; it is the thing that makes the file happen.

## 2. The file's weight per token is not a constant

Same engine, same run, two saves:

| saved tokens | file | per token |
|---|---|---|
| 603 | 32 013 724 B | **51.85 KB** |
| 2 529 | 79 745 656 B | **30.79 KB** |

The weight **falls** as the chat grows, so the file carries a large fixed part. The
two points give `≈ 16.3 MB + ≈ 24.2 KB/token` — which predicts 30.8 MB at 603
tokens (observed 32.0 MB) and 77.5 MB at 2 529 (observed 79.7 MB).

The plan's `≈ 53 KB per token, ≈ 218 MB per chat` is a **ratio read at ~600–1900
tokens**, not a rate, and it must not become a panel constant. T6's disk line has
to be built the same way the window line is: from a figure the engine's own
configuration produces, not from a number carried in the source.

The same 603 tokens measured at both contexts came out identical (32 013 724 B
both), so the context does not enter at this size.

## Unresolved, and not smoothed over

`dev/results/slot-restore-device-path/` (ctx 16 384, `--ctx-checkpoints 1`, no
`--swa-full`) records 1 907 tokens → **101 493 292 B**, which is 53.2 KB/token and
far off the line above (it predicts ≈ 62 MB). Two things differ between that run
and this one — the context (16 384 there against 8 192 here) and the sequence (a
save immediately after a cold turn, against a save after a turn that followed
another turn) — and **this run did not isolate which**. The checkpoint the save
carries depends on where the slot's state is when it is taken, and that is the
likely variable. Until it is measured, no panel line may be drawn through the
100 MB point: the honest reading is that a chat's file is tens of megabytes, that
it grows sub-linearly, and that the exact curve needs its own measurement with the
checkpoint state held fixed.
