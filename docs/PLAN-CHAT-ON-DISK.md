# PLAN — one slot per device, full window each; disk later and only for survival

**Version 2. Version 1 of this file proposed one resident slot plus a disk swap, and a
hostile audit refuted it from this repo's own committed measurements.** The correction is
in §1; the shape that survives is §2. Nothing here is sent upstream.

## 1. Why version 1 was wrong

- **One resident slot is not forced.** `MULTI-DEVICE-SHAPE.md` §8.1 measured the two
  shapes with the committed scripts: with `--parallel N` and one slot per device, at two
  people wall 4.9 s against 7.0 s, TTFT 0.93 s against 1.67 s, cache reuse 0.98 against
  0.49; at four people 9.7 s against 17.8 s and reuse 0.97 against 0.00. Serialising every
  device through one slot is the *losing* design, and version 1 proposed exactly that and
  called it forced.
- **The per-device cost of the winning shape is small.** The sliding-window layers
  replicate per stream: **+167 MiB for four slots** (`MULTI-DEVICE-SHAPE.md` §7, the
  pinned row), about **42 MiB per extra device**. Version 1 spent an engine format change,
  a door rewrite, a filename scheme and a disk budget to buy that back.
- **Per-slot windows are expressible.** `src/llama-context.cpp:291` —
  `if (cparams.kv_unified) { cparams.n_ctx_seq = cparams.n_ctx; }` — under unified KV every
  slot's window *is* the pool, and this fork added **`--kv-unified-per-slot`**
  (`common/arg.cpp:1647-1651`, enforced at `server-context.cpp:1220-1235`) precisely to cap
  a slot's window over a shared pool. Version 1 quoted the line *below* that one to claim
  the opposite.
- **`--swa-full` was missing, and without it the whole disk idea is a no-op.** Our own
  `dev/results/kv-paging-spike/summary.md` E3: with the default (`--swa-full` off) a
  restore reports `n_restored=613` and the next request still has `cached=0` —
  *"RESTORE IS A NO-OP FOR CACHING"*; with `--swa-full` it is `cached=605`, `prompt_ms=13.7`.
  On a sliding-window model the restored window cells are unusable without it.
- **The engine already swaps conversations in RAM** — but not for us. The prompt cache
  behind `--cache-ram` is a size-capped LRU of whole conversation states keyed by
  `{tokens, checkpoints, cache_salt}` (`server-task.cpp:1698-1830`, the salt check at
  `:1802-1813`) — the triple version 1 wanted to invent for a file. Its cross-slot load
  runs only when the engine itself chose the slot by similarity; the door names the slot
  on every request, so that path is not exercised under our shape and the funded 6 GiB is
  mostly idle. Which means a device's **other** chats are not warm today either: they are
  lost when another chat takes the slot. That is the disk tier's real value, and it is
  worth stating plainly rather than selling the prompt cache as a substitute.

Version 1's Phase 1 (the salt fix) survives this correction and is still worth landing:
the checkpoint appendix and the prompt cache's own salt handling show the engine's intended
pattern is *the state travels with its namespace*.

## 2. The shape

**One slot per device, each with the full context window, all resident.** The door's
shipped model — a stable slot per device under a per-device cache salt — stays exactly as
it is, because it is the component the household isolation property rests on and the shape
the measurements recommend. Nothing about the request path changes.

Two ways to fund a full window per slot; the second is cheaper and is the reason to prefer
it:

- **Non-unified**, pool `= N × window`: simple, no engine change, and the sliding-window
  layers replicate per stream (+167 MiB at four slots on the pinned row).
- **Unified** with `--kv-unified --kv-unified-per-slot <window>`: one pool, every slot
  capped at the full window. **Verify before choosing it**: unified save/restore and the
  pool-ceiling behaviour were measured before this cap existed, so the combination is
  untested. That verification is the first task.

What this retires from version 1: no swap, no chat-id on the wire, no filenames, no salt
fix on the primary path, no per-model disk table, and no door rewrite.

**The window per device** is the launcher's own arithmetic (the same `plan` that launches),
so the panel shows a number that is true: with N residents each gets `pool / N` under the
non-unified form, or the cap under the unified form.

## 3. The tasks, in order

1. **Verify the unified per-slot cap end to end** on the pinned model: `--kv-unified
   --kv-unified-per-slot <window>` with `-np N`, checking that each slot really holds a
   full window, that the pool ceiling behaves when every slot fills, and that a device's
   second message is warm. If it does not hold, take the non-unified form and pay the
   replication. This decides which launch shape the app ships, so it comes first.
2. **Close the launch gates** in `crates/kalsa-launch/src/args.rs` (the five preconditions
   already written there) with the per-slot KV term and the honest per-slot window, then
   raise the number to the enrolled device count, capped by what the machine funds. The
   clamp for an engine with no inlet already exists and stays.
3. **Make the panel say the truth**: how many slots are resident, the window each gets,
   and — from the measured numbers, not intuition — what concurrency costs. Two devices
   decoding together each run at **39 % of their solo speed** (58.7 → 22.7 tokens/s on the
   pinned model, measured), together 77 % of one, and they finish in lockstep. One device
   alone keeps its full speed.
4. **The isolation test the household rules already mandate**, under this shape: device A
   sends a prompt carrying a unique marker, device B sends a prompt sharing a long
   identical preamble; assert that B's answer never contains A's marker and that B's reused
   tokens never exceed the true shared prefix. Version 1 proposed only warmth tests.

## 4. The disk tier, later and much smaller

Only for what RAM genuinely cannot do: **surviving a restart and the idle unload**, and
holding more than the funded prompt cache can. As a separate plan, with these as
preconditions rather than details:

- `--swa-full` (or a guaranteed checkpoint per save) is a **tested precondition** of
  warmth; without it the restore is a measured no-op.
- The save/restore pair runs under the door's **slot-exclusive lease**, so two devices'
  requests cannot interleave a save and a restore — the corruption mode is real: with two
  handlers racing, one device's save writes the *resident* chat into the other's file.
- The resident map must know when the engine's generation changed. `--sleep-idle-seconds
  (300 today)` destroys the contexts, so every idle timeout empties the slots while the map
  still believes otherwise. The supervisor already learns of sleeps
  (`kalsa-supervisor/src/child.rs`), so the map can be invalidated rather than guessed.
- The salt travels **both** in the file (audit) and on the restore call (enforcement); the
  file-borne stamp alone enforces nothing, because nobody reads it. A version bump
  invalidates every earlier save, and a missing stamp needs defined behaviour, not just a
  wrong one.
- A revoked device's files need an explicit sweep: re-pairing mints a new id, so the old
  files become unreachable garbage.
- The files are the owner's conversations on disk: per-device encryption was already built
  and verified in the paging spike, and backup exclusion has to be decided.
- The disk figure comes from the catalog's per-model geometry — the full-attention layers
  are linear in context and the sliding-window layers **saturate** — never from one
  number measured on one model.

## 5. Rules this plan obeys

- **Nothing goes upstream.** No PRs, issues, comments, reviews, patches or discussion.
  Upstream is read, never written.
- The checkpoint appendix that follows someone else's design stays credited in the code.
- No secret value in code, tests, logs or error strings.
