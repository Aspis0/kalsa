# PLAN — one chat resident per device, the rest on disk

Written to be attacked. Every number here was measured on this machine against the
published engine (`kalsa-server-v1.1.0`, `2a290390d`), not read off a document.
Nothing in this plan is sent upstream; see the last section.

## 1. What we now know, measured

| question | answer | evidence |
|---|---|---|
| One chat on disk, at 16k, q8_0 | **407 MB** with one checkpoint; 473 MB with the default two; **319 MB** with none | `appended 1 context checkpoint(s) (84.024 MiB)` |
| Save / restore | **0.55 s / 0.08 s** for 16k; 0.10 s / 0.013 s for a 485-token chat | `save_ms`, `restore_ms` |
| Is the restore warm? | **Yes.** A save taken after a turn's prefill carries a checkpoint at 16 117; restoring reuses **16 117 tokens and re-evaluates 10** (0.21 s) | `cache_n 14106`, `restored context checkpoint` |
| Does it survive an engine restart? | **Yes.** SIGTERM, fresh process, restore into it, continuation 15 tokens | `n_restored 2042`, `restore_ms 57.9` |
| With **0** checkpoints | **Not a restore**: the SWA/recurrent memory cannot be rewound, `cache_n 0`, full 16 122-token re-prefill (10.5 s) | `forcing full prompt re-processing due to lack of cache data` |
| **BLOCKER** — what happens after a restore | The restore **wipes the cache salt**, so the device's own next request is read as another namespace and **deletes the restored KV**: `cache_n 0`, `memory_seq_rm [0, end)`. The rescued copy in the RAM cache is quarantined under the empty namespace and unreachable. **Nothing on disk is usable until this is fixed.** | `different cache namespace - clearing cached prompt` |
| Two devices talking at once | No turns, and no free lunch: both decode in **one batched step**, in lockstep, and **each stream runs at 39 % of its solo speed** (58.7 → 22.7 tok/s); together 77 % of one | four `ptimings` lines |
| Idle devices | **They hold their full KV.** Allocated at load for every slot (`2/2 seqs`, `3/3 seqs`), never freed: **+56/+60 MiB per idle slot**, RSS +58 MiB each | `llama_kv_cache: size = …` at load |
| Different context window per slot | **Impossible in one process.** `n_ctx_seq = n_ctx / n_seq_max`, uniform: 16384/8192/5632 at `-np 1/2/3`. No header, request field or route changes it | `src/llama-context.cpp:292-294` |
| A save during generation | Legal but **deferred**: the call blocks until the answer finishes (3.6 s measured), and the file is the state *after* the turn | `if (slot->is_processing()) queue_tasks.defer(...)` |
| The save file's identity | **None.** Magic, version, token count, tokens, KV bytes, optional checkpoint appendix. No device, no salt, no model hash. A dimension-compatible foreign file restores **silently** | `state_seq_save_file`, `src/llama-context.cpp:3300-3315` |
| What the loader validates | `--parallel` (`n_stream`), layer count, fit in the cache, K/V types and row sizes — all **loud errors**. It does **not** validate the model | `n_stream mismatch` |

## 2. The shape

**One slot holds one chat. A device's other chats live on disk and are swapped into
that slot when the device asks.** This is forced by the measurements above: per-slot
windows do not exist, and N resident slots each cost their full KV and slow every
stream to 39 % when they run together. One resident slot is the only arrangement in
which **every device can use the whole context window** — one at a time.

So the two numbers the owner asked to see in the UI are the two axes of the same
trade, and both are computed by the launcher's own arithmetic, not estimated:

- **how many chats stay resident** (`--parallel`, default **1**),
- **the context window each resident chat gets** (`n_ctx / residents`),
- and, on the disk side, **what a chat costs to keep**: context × the catalog's own
  per-token KV figure + one checkpoint (~84 MiB at 16k).

With one resident: each device gets up to the whole pool, and a switch costs
**0.1–0.35 s** (save + restore) against a **10–32 s** full re-prefill. With two
resident: two devices answer at once, each with half the window and 39 % of its solo
speed. The app picks the default; the owner changes it in Advanced.

**A device's chat is identified by a client-supplied id** (the desktop's chat id, the
phone's conversation id). Without it, two chats of one device would overwrite each
other in the same slot — which is what happens today and is why the id is not optional.

## 3. The work, in order

### Phase 1 — the engine fix, in the fork (blocks everything)

Everything above is worthless until a restored slot keeps its namespace.

1. **The salt survives a restore.** Preferred form: **carry it in the file** —
   bump the appendix to version 2 and always write a header record containing the
   salt and a device label, read back on restore and re-stamped after
   `server-context.cpp:2868`'s `slot->prompt.clear()`. This is the only form that also
   gives the door the **attribution** the security rule needs: a file that names its
   owner can be refused when it is not the owner's. The cheap alternative (the restore
   takes the salt from the caller's header) fixes the switch but leaves the file
   unattributable; take it only if the first is refused.
   The appendix is currently skipped entirely when a slot holds no checkpoint
   (`save_slot_checkpoints` returns 0 early), so the record must be written
   unconditionally.
2. **The salt survives a context shift.** Same hole, same two lines
   (`server-context.cpp:3199`): re-stamp from `slot.task->params.cache_salt` after the
   insert. One line, and it is the difference between losing the prefix and poisoning
   what lands on disk.

Fork only. No upstream interaction of any kind.

### Phase 2 — the app drives the swap

3. **Launch flags**: `--slot-save-path <dir>` (today never passed, so the engine
   answers `not supported`) and **`--ctx-checkpoints 1`** — the default is **32**, which
   would grow one chat's file to ~2.7 GB. Note the flag's spelling: `--ctx-checkpoints`
   or `-ctxcp`; the single-dash `-ctx-checkpoints` is **rejected** by the engine. The
   save directory is the app's own, under the runtime store it already owns.
4. **The door owns the swap.** It must not forward a guest to `/slots/*` — it refuses
   those today, correctly, because they let a caller name another slot. Instead the door
   performs save/restore **itself** on its own connection, driven by what only it knows:
   which device a request belongs to, which chat the slot currently holds, and which
   chat the request asks for. Before forwarding a completion, if the resident chat is
   not the requested one, the door **saves the resident chat and restores the requested
   one**, then forwards with the device's salt. The engine's admin route stays closed to
   guests, and the door remains the only client that names a file.
5. **Filenames are the door's, not the client's.** The door mints
   `d<device>-<hash>.slot` from the parts that must match or the restore is invalid or
   silently wrong: the device, the chat id, the **KV cache type**, the **context size**,
   and a **model fingerprint**. The file itself carries none of that, and a
   dimension-compatible foreign model restores silently wrong, so the name is the only
   place that check can live without an engine format change.
6. **A switch happens only when the slot is idle.** A save during generation blocks
   until the turn finishes; the app must not swap under a live answer.
7. **Two requests at once serialise on one resident slot.** The door queues the second
   until the first releases; the honest limit of one resident chat is that two devices
   take turns, and the UI must say so rather than let a request hang.

### Phase 3 — the UI says the truth

8. **Seats, window and disk together.** Show the resident count, the window per
   resident, and the per-chat disk cost — all from the launcher's arithmetic. The
   disk figure is the same per-token number the RAM figure already uses, plus one
   checkpoint.
9. **The honest cost sentence**, from the measurements, not from intuition:
   - one resident: *"when you switch chat, the first answer takes a moment — the
     conversation is reloaded, then it is as fast as before"* (0.1–0.35 s);
   - two or more resident, two devices talking at once: *"each device's words per
     second drop to about four in ten while both are answering"* (39 % measured);
   - and the one that is already true today and must not be blamed on this feature:
     the engine unloads after the idle timeout, and the next message pays a model load.
10. **A disk budget.** A cap, and eviction of the least recently used chat files, with
    the count and the total size visible. Nothing here is optional: 407 MB per 16k chat
    means a household with a few chats per device is into the gigabytes.

## 4. What proves it

- Phase 1: the existing slot-save harness, extended — a restore followed by the **same
  device's** next request keeps `cache_n > 0` and re-evaluates only the tail. Today that
  test would fail at the `different cache namespace` line.
- Phase 2: `crates/kalsa-door/tests/real_engine.rs`, extended to three exchanges —
  device A's chat, device B's chat, then device A again **with the same chat id** —
  asserting A is warm on return (a small `prompt_n` on its second turn) and that no
  exchange re-evaluated the other's prompt. This is the real-engine test that exists and
  runs on this machine; it is the one that must grow.
- Phase 3: the UI numbers come from the launcher, so they are pinned by the launcher's
  own tests plus a contract check that the panel renders what the DTO carries.

## 5. Risks, and what would make this wrong

- **Attribution**: with the cheap engine fix the file stays unattributable, and a
  locally planted file with a correct-looking name restores another chat. Only the
  file-borne stamp closes that; the filename rule closes the accidental half.
- **The engine's own defaults are hostile to this design** (`--ctx-checkpoints 32`,
  `--slot-save-path` off). Both must be set explicitly, and the app must own them, or a
  future default change silently changes the disk cost.
- **Model swap**: nothing in the file identifies the model. If the app changes model
  while chats are on disk, the only safe move is to invalidate them, and the filename
  must make that automatic.
- **`get_slot_by_id` wraps** (`id_slot % slots.size()`): deliberate upstream, unreachable
  from the door because the door always names ids it minted. Do not rely on the engine
  to refuse a wrong id; scope it in the door.
- **Not in this plan**: per-device *different* window sizes in one process (impossible
  without an engine change), more than one chat resident without paying the measured
  39 % per stream, and any upstream contribution.

## 6. Standing rules this plan obeys

- **Nothing goes upstream.** No PRs, issues, comments, reviews, patches or discussion.
  Upstream is read, never written.
- The engine change is ours, in the fork, and the checkpoint appendix that came from
  someone else's design stays credited in the code.
- No secret value in code, tests, logs or error strings.
