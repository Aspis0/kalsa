# PLAN — the disk tier, version 2

Version 1 was hostile-audited by the Reviewer (`zcode-acp/builtin:zai-coding-plan\GLM-5.3-Flash`,
thinking high, 2026-09-21) against the standard "fit to become code". Verdict: **FIT CON
CORREZIONI**. Every correction is applied below and listed in §8, so the round stays auditable.
Two of them change the shape rather than the wording: the price of `--swa-full` (§2), and the
reason the identity cannot ride in the checkpoint appendix (§2), which v1 overclaimed.

The disk tier stops being deferred. Owner decision, 2026-09-21: build it now. This document
replaces §5 of `PLAN-CHAT-ON-DISK.md`, whose precondition list is still the source for what must
be true before the tier ships.

Nothing here goes upstream: no PR, issue, comment, review, patch or discussion.

## 1. What the tier is

**Isolation is per device.** A device holds a slot; a slot holds one chat's KV cache in RAM.
Several chats per device live on disk, each under its own id, and are recalled on demand:
switching chat is a **save** of the current chat out of the device's slot and a **restore** of
the target chat into the same slot. Two chats of one device share a slot and a namespace; they
overwrite each other's prefix in that slot, which is why only one is resident and why the switch
is explicit.

Two mechanisms can make a switch warm, and they are not the same one:

- the **RAM prompt cache** — a global LRU of conversation states, keyed by `cache_salt`
  (`tools/server/server-task.cpp:1811-1813`), which is what made the shape run's switch-back
  cheap;
- the **save/restore file round-trip** — what this tier adds, and what the paging spike measured
  as a no-op without `--swa-full`.

The tier exists for exactly what RAM cannot do: surviving a restart, surviving
`--sleep-idle-seconds` (the app ships **300** today, `crates/kalsa-launch/src/args.rs:70`), and
holding more chats than the RAM prompt cache can.

**It is not** cross-device warming, per-device encryption, or a backup story. §6 says what is
out and why, so nobody re-derives these as one-liners.

## 2. What reconnaissance settled

Engine paths are relative to `/Users/marco/Projects/kalsallama` @ `5c96b18dd`; app paths to
`/Users/marco/Projects/kalsa-brain` @ `295200c`. Every line below was opened, not remembered.

- **The restore drops the namespace.** `slot->prompt.clear()` at `tools/server/server-context.cpp:2879`,
  before `slot->prompt.tokens = std::move(restored)` at `:2880`, with no re-stamp between.
  `server_prompt::clear()` clears `cache_salt` (`tools/server/server-task.h:577-581`). The
  device's next request then mismatches at `:3432` and `slot.prompt_clear()` at `:3434`
  destroys the state just restored. The shift had the same hole and was fixed by `5c96b18dd` at
  `:3214`; the commit body leaves the restore open.
- **A coder must not think an earlier check protects this.** There *is* a namespace check before
  the wipe — at `:1587-1590` — but it *skips* the slot instead of wiping it, and it is bypassed
  from both sides: the door pins the slot (`:4648-4651` sets `task.id_slot`, and the picker
  returns the pinned slot at `:1564-1568`), and the LRU fallback (`:1633-1649`) does not check
  the salt at all. The request reaches `:3432-3434` either way.
- **The salt does not reach the slot routes.** `slot_action` carries `{id_slot, filename, filepath}`
  and nothing else (`tools/server/server-task.h:167-172`). `get_cache_salt` is *defined* at
  `:4517`; its single read is `:4592` inside `handle_completions_impl` (`:4579`), assigned at
  `:4645`. `post_slots` (`:5099-5138`) never reads it.
- **`post_slots` already validates one header against the URL slot** — `get_slot_from_header`
  at `:5118-5123` refuses a mismatch. The salt header follows an existing pattern.
- **The appendix is conditional by construction, and `--swa-full` does not rescue it.**
  `save_slot_checkpoints` returns 0 bytes when the slot has no checkpoints (`:2486-2487`), and
  checkpoints are gated by `n_ctx_checkpoints > 0` (`:3714`), by COMPLETION-only tasks
  (`:3717`), by `pos_min >= 0` (`:3871-3872`) and by `!has_mtmd` (`:3876`); a legacy file has no
  appendix at all (`:2550`). Under `--swa-full`, `n_swa = 0` (`:1209`) drops only the SWA term
  of `do_checkpoint`'s disjunct `(RM_TYPE_FULL || RM_TYPE_RS || n_swa > 0)` (`:3724-3727`) — the
  FULL term is not excluded a priori, and this fork's target model is not named in this document.
  **Therefore: the identity cannot ride in the appendix, because the appendix may not exist —
  not because `--swa-full` guarantees its absence.**
- **`--swa-full` was the plan's red herring, and it is settled by measurement.** The paging
  spike's `cached=0` was never a sliding-window limitation: it is the namespace hole below.
  `dev/results/slot-restore-swa/summary.md` runs the save/restore round-trip with the flag off
  **and** on, at ~600 and ~1900 tokens, salted and unsalted, and the reused-token count is 0 with
  a salt and ~1895 without it **in both settings** — the tokens come back (`n_restored` is the
  whole conversation in all eight rows) and are then destroyed by the next request only when the
  caller carries a salt. The flag moves the file size, not the warmth.
  **So the tier does not render it**, and the ~1.4 GiB price below is moot.
- **The door already strips and injects.** The client's `X-Kalsa-Slot` and `X-Kalsa-Cache-Salt`
  are recognised and discarded (`crates/kalsa-door/src/request.rs:174-185`), and the door writes
  its own into the sealed head, the only path to the wire (`:55-62`). `/slots/*` is refused
  after authentication and **before any lease** (`crates/kalsa-door/src/proxy.rs:119-131`).
- **The salt is a labelled hash of the device credential.** `CACHE_SALT_LABEL` and the one
  labelled hash are at `crates/kalsa-door/src/devices.rs:34`, `:88`, `:191`; the credential is
  persisted in `pairing.json`, so the salt is stable across restarts and changes only when the
  credential does — a re-pair.
- **The door's lease is not an exclusion.** `leases: HashMap<u32, u32>` is a refcount for
  pruning (`crates/kalsa-door/src/slots.rs:56`, `:170-176`); several requests of one device hold
  the same slot at once. The nearest atomic check-then-write is `revocation_gate()`
  (`:108-116`), taken around `{holds; seal; write}` in `proxy.rs:211-226`. The device→slot map is
  `assigned: HashMap<DeviceId, u32>` at `slots.rs:51`.
- **The engine defers one action while the slot is busy** — save at `server-context.cpp:2768-2771`,
  restore at `:2842-2845` — so actions to one slot are serialised in arrival order. It does not
  serialise a *pair*.
- **A failed restore empties the slot.** The catch at `:2884-2889` calls `slot->prompt_clear()`.
  This is why T3 must re-restore the previous chat rather than leave the user with a dead slot.
- **A freed seat is already reusable without a relaunch** (`slots.rs:239-268`, `:308-323`); the
  launched count does not change. This closes the lifecycle question in `PLAN-CHAT-ON-DISK.md` §4.
- **No engine generation and no residents map exist** — checked across every `.rs`. The
  invalidation anchors are `Residency::forget()` (`crates/kalsa-supervisor/src/supervisor.rs:245-252`),
  the release/reload event (`crates/kalsa-supervisor/src/child.rs:379-383`), and — not used by
  v1 — the supervisor's exit detection (`crates/kalsa-supervisor/src/supervisor.rs:299-303`),
  which is the only thing that fires when the engine **crashes** and never announces a release.
  It detects and moves the state to `Failed`; it does not restart.
- **The app renders none of the flags this tier needs.** The whole `argv()` function
  (`crates/kalsa-launch/src/argv.rs`) emits no `--slot-save-path`, no `--swa-full`, no
  `--ctx-checkpoints`. The last one matters: the default is **32** (`common/common.h:630`), and
  the handoff records that default growing one chat's file to roughly 2.7 GB.
- **The panel's live window number is the pool, not the slot.** `chat/src/lib/chat.ts:117-140`
  reads `n_ctx` and never `n_ctx_slot`, so with N > 1 the page shows a number no device has.

## 3. Who owns identity

**The door, by construction; and the engine stamps the namespace.**

- The engine must never accept a device-chosen filename. The door builds it, because the door
  already owns the device→slot map, already strips the client's slot and salt, and already
  refuses `/slots/*` to guests.
- The engine must put the restored slot back into the caller's namespace. Only the engine can,
  and without it the restore is dead on arrival. This is the blocking change and it is small.
- **The name does not carry the salt, and must not.** The salt is a function of the credential;
  a re-pair changes it, and a name carrying it would turn a re-pair into silent data loss. The
  name carries the device id, which is what the app's pairing store treats as stable, and T1
  re-labels whatever it restores. A re-paired device therefore keeps its own chats: they are its
  own text under a new label, which is correct. If the owner prefers a re-pair to orphan them,
  that is the sweep's job (T5), and it is a decision, not a side effect.
- **Salt and model hash inside the file** remain defense in depth, not the boundary, and stay
  deferred (§6) with the reason now correct: the appendix may not exist (§2).

Filenames are **flat**: the engine validates with `fs_validate_filename`, which rejects path
separators, so the scheme is one name —
`d<device_id>-m<8 hex of the model's pinned sha256>-c<conversation id>.bin`.

All three components already exist, and none of them costs work at save time:

- the **device id** is the door's own (`crates/kalsa-door/src/slots.rs:51`);
- the **model identity is the catalog row's pinned sha256** (`crates/kalsa-catalog/src/manifest.rs:51`,
  carried into `RunnableRow` at `choice.rs:284`, `:570`, `:752`) — the digest the download already
  verified. **Do not re-hash the model file**: `manifest.rs:56-59` records that the identity was
  verified once by hand for exactly that reason, and a pass over a 22 GB file at every launch is not
  a plan;
- the **conversation id** is the webview store's `uid()` (`chat/src/lib/store.ts:38-43`) —
  `crypto.randomUUID()`, with a base36 fallback. Conversations live **only** in that store, in
  `localStorage` (`store.ts:104`, `:280-336`), which declares itself the only module that knows where
  they live and a seam a future backend replaces (`store.ts:5-11`). The door therefore cannot
  enumerate them: the client names the conversation, and **the door validates the shape and builds
  the name itself** — never a filename, never a path, from the client.

## 4. The tasks, in order

### T1 — engine: carry the salt to the slot actions and stamp it on restore (blocking)

- `slot_action` gains a `std::string cache_salt` (`tools/server/server-task.h:167-172`).
- `post_slots` reads `X-Kalsa-Cache-Salt` beside `get_slot_from_header` (`:5118-5123`) and sets
  it on the task.
- The restore stamps it **from the action's own task** — `task` is in scope in that case (used at
  `:2845`, `:2857`, `:2870-2873`) — and **not** from `slot->task`, which at `:2879-2880` is the
  slot's launch task, not this action (`:3432` reads `slot.task`). Always stamp what the caller
  sent, so an unsalted caller keeps today's behaviour and the dev harnesses keep working.
- **Acceptance**: a new test in `tools/server/tests/unit/test_cache_salt.py`, shaped like
  `test_cache_salt_survives_context_shift` (`:54`) but on the restore path — save under salt A,
  restore under salt A, then one request: `cache_n > 0` and no `different cache namespace` line;
  and the negative: a restore under salt B leaves the state in B, so B is warm and a request
  under A is not handed B's state. **Red first.** Command from `tools/server/tests`:
  `./tests.sh unit/test_cache_salt.py`.
- **Landed**: `833cde99b` on the local branch `disk-tier-salt-restore`, off `main` = `5c96b18dd`.
  Red first (`2 failed, 10 passed`, `assert 0 > 0`), green verified independently (`12 passed`),
  review FIT on a different model. Not pushed.
- **Two traps the review found, both environmental and both real.** (a) **Do not run this suite in
  parallel while Kalsa Brain is running.** `conftest.py:7-13` sets each xdist worker's port to
  `8080 + worker*10`, so worker 5 wants **8130** — the port the app's own engine holds (verified
  live: `kalsa-ser` PID 86320 in LISTEN). The suite then reports a red that has nothing to do with
  the code. Run it with `PYTEST_WORKERS=1`, or with the app closed. (b) The asserted string
  `different cache namespace` **also appears in the picker's skip line** (`server-context.cpp:1589`,
  reachable because `slot_prompt_similarity` defaults to 0.1, `common/common.h:696`), so an edit that
  adds a differently-salted completion to the same log breaks the assertion without a real defect.
  Assert on the reuse count, not only on the absence of that line.
- **Not covered, and owned by later tasks**: restore through the router (it forwards the header, but
  requires a `model` field in the body first — `tools/server/server-models.cpp:1965-1969`, and
  nothing tests that), the salt in the failed-restore path (the catch at `:2886-2889` clears it
  again, which is why T3 re-restores), and the fact that **T1 alone changes nothing for the user**:
  the door still refuses every `/slots` (`crates/kalsa-door/src/proxy.rs:119-131`). T1 unblocks T3;
  it does not ship.
- The engine tree is **dirty with unrelated work in progress** (`ggml/src/ggml-opencl/*`,
  `src/llama-governor-policy.cpp`, `tests/*`, 465 insertions) that belongs to nobody in this plan.
  `git add -A` in that repo would commit it. Stage files by name.
- Touches `server-context.cpp` (5895 lines) and `server-task.h` (652) — both pre-existing
  excess, declared and not refactored.

### T2 — app: the launch flag set this tier needs

Three flags, one place (`crates/kalsa-launch/src/argv.rs`):

- `--slot-save-path` → a directory the app creates under its data directory before launch. If it
  cannot be created, the launch refuses rather than starting an engine whose disk tier silently
  answers `not supported`.
- `--ctx-checkpoints 1` → the default is 32 (`common/common.h:630`) and v1 left this out, which
  would let one chat's save file reach the size the handoff records. One record is enough:
  the reader trims to `n_ctx_checkpoints` anyway (`server-context.cpp:2581-2583`).
- `--swa-full` → **not rendered.** The measurement in §5 settles it: the flag changes the save
  file's size, not whether a restore comes back warm. Were it ever adopted it would also take the
  SWA cache from `min(size_base, n_swa + n_ubatch)` to `size_base`
  (`src/llama-kv-cache-iswa.cpp:84`, `:91`), which at a single 64k slot is 25.6× the SWA KV —
  measured on this engine as 2560 → 16384 cells in the run log. Recorded so the reasoning is not
  re-derived from scratch.

**Acceptance**: committed tests pin each rendered flag in the same manner as the existing test
that pins `--sleep-idle-seconds 300` (`crates/kalsa-launch/src/policy.rs:1062`), plus a test that
a launch fails when the save directory cannot be created, plus a test that `--swa-full` is **not**
rendered. The measured disk footprint that T6 needs — ≈ 53 KB per token on the measured model,
≈ 218 MB per chat at the 4 096 floor — is committed in the same artifact as the warmth result.

### T3 — app: the save/restore client in the door

- A door-internal action, **not** a passthrough: the chat UI asks the app, the app asks the door,
  the door resolves device→slot (`slots.rs:51`), builds the filename per §3, holds exclusivity,
  and calls the engine **on the `upstream_port` the door was constructed with**
  (`src-tauri/src/main.rs:383-388`) — today 8123 (`crates/kalsa-launch/src/policy.rs:590`), not
  the door's own listener on 8130 (`src-tauri/src/startup.rs:38-41`). Hard-coding 8130 would
  make the door call itself. The port is read from the same record the door already holds, never
  from a constant at the call site.
- **The client supplies a conversation id, never a name.** Validate it against a conservative
  shape — lowercase letters, digits and dashes, 8 to 64 characters, no dot, no separator, no
  leading dash — which is what both `uid()` branches produce, and then build
  `d<device>-m<hash8>-c<id>.bin` in the door. A `.` or a `/` in an id is a refusal, not a
  sanitisation: sanitising accepts malicious input and makes it work.
- **Exclusivity over the pair, not the call.** The engine serialises actions to one slot but not
  a sequence, so two overlapping switches of one device's chats can invert (save A → save B →
  restore B → restore A ends with A in the slot). A per-slot gate in the door serialises the
  sequence, built on the `revocation_gate` shape (`slots.rs:108-116`). **`erase` is part of the
  sequence**, not an outside action: a chat deleted while a switch is in flight must not be
  restored by that switch.
- **Failure the user can see.** A failed restore leaves the slot *empty* (`server-context.cpp:2884-2889`),
  so the door must then re-restore the previous chat's file — saved moments earlier by the same
  switch — and leave the active chat unchanged in the UI. If that also fails, the slot stays
  empty and the UI says the chat could not be opened; it never shows an empty conversation as if
  the chat had no history.
- **Acceptance**, both red first: (a) a restore whose file name does not carry the caller's
  device is refused; (b) file names sent in the client payload are ignored; (c) a restore that
  fails leaves the previous chat's state in the slot and the UI's active chat unchanged.

### T4 — app: cadence, so an unload cannot lose a turn

Save-on-switch alone is **lossy**: `--sleep-idle-seconds 300` destroys the slot's state, and the
switch that follows has nothing left to save. The tier therefore saves on two triggers:

- every chat switch, before the restore;
- an idle timer **shorter than the unload clock** (the unload clock is 300 s, so the timer is a
  stated constant, 120 s, pinned by a test), so the file is never more than the timer behind when
  the engine unloads.

A restore after a genuine unload is therefore a **restore plus a model load**, and the UI says so
during the load — the engine's readiness budget is 600 s (`src-tauri/src/startup.rs:42`), so the
sentence is not optional. v1 left this as an undeclared "refused or re-driven"; it is now decided:
**re-driven**, never refused, because the user asked to open a chat and the state exists.

**Acceptance**: a test that the idle timer fires before the unload clock and that a switch after
an unload restores from disk instead of returning an empty conversation.

### T5 — app: resident map, sweep, crash invalidation

- **The resident map is new and lives in the door**, keyed by slot, because the door owns the
  slot and is the only component that knows which chat is in it. Its consumer is the door itself:
  a restore of a chat already resident is a no-op, and a save of a chat that is not resident must
  not overwrite that chat's file with another chat's state.
- **Invalidation**: `Residency::forget()` (`supervisor.rs:245-252`), the release/reload event
  (`child.rs:379-383`), and — the case v1 missed — **a crash, which announces nothing** and would
  otherwise leave residency reading `in_memory` while the engine holds no state. The supervisor's
  exit detection (`supervisor.rs:299-303`, `ServerState::Failed`) is the hook; it detects, it does
  not restart. A server adopted from a previous run has no pipe and stays `unknown`
  forever (`child.rs:50-57`); `unknown` is treated as *not resident*, and the restore is driven.
- **Sweep**: a revoked device's files, when the store polls and the door prunes
  (`src-tauri/src/main.rs:346`, `:364`; the slot side is `slots.rs:239-268`). A **deleted chat's**
  file is removed with the chat, not left orphaned — the sweep covers devices, this covers chats.
- **Acceptance**: a test that a crash does not leave the map claiming residency; a test that a
  revoked device's files are gone; a test that deleting a chat removes its file.

### T6 — the panel

Resident count, window per device, **55.78 MiB** per extra resident, and the concurrency figure
**only once its measurement is committed**. Two corrections the tier owes:

- The live window number must come from the engine's per-slot value, not `n_ctx`
  (`chat/src/lib/chat.ts:117-140`).
- The live window number must come from the engine's per-slot value, not `n_ctx`
  (`chat/src/lib/chat.ts:117-140`).
- The disk line comes from the measured footprint in §5 — ≈ 53 KB per token on the measured model,
  ≈ 218 MB per chat at the 4 096-token floor — and is linear there; the saturating part of the
  curve is not measured and the panel must not extend the line past it.

## 5. The measurement that decided the tier's shape — done

**Does the save/restore file round-trip come back warm without `--swa-full`? Yes, and `--swa-full`
was never the variable.** Run 2026-09-21, committed as `dev/results/slot-restore-swa/`
(`results.json` + `summary.md`): three engines, `--cache-ram 0` on the two that exercise the file
so the RAM cache cannot answer for it, ~600 and ~1900 tokens, salted and unsalted, flag off and on.
The tokens are restored in all eight rows; the next request reuses **0** of them when the caller
carries a salt and ~1895 when it does not — in **both** flag settings. The mechanism is named in
the artifact: the restore wipes `slot.prompt.cache_salt`, and `server-context.cpp:3432-3434`
then clears what was restored. That is exactly T1's fix, now measured rather than argued.

Consequences, all of them recorded above:

- `--swa-full` is **not** a launch flag of this tier, and the ~1.4 GiB it would have cost is not
  paid (§2, T2).
- The disk footprint is measured and linear at these sizes: ≈ 31 KB/token with the flag, ≈ 53 KB
  without it — so the tier's normal path, without the flag, writes the larger file, because the
  save carries one context checkpoint the flag's absence requires.
- T1 is the only blocking task, and its acceptance test is the mirror of this run.

**Still open**: the two-device concurrency figure is a **rate** and still needs an idle machine,
and it gates only T6's number, not any task. Nothing above ~1900 tokens is measured, so the
saturating part of the disk curve is not a number this plan may carry.

## 6. Out of scope, with the reason written down

- **Salt and model hash inside the file.** Defense in depth, not the boundary (§3), and the
  appendix cannot carry them reliably (§2). A trailer with its own magic, written
  unconditionally and walked before the optional checkpoint appendix, is its own change with its
  own version handling. This is the sentence that was wrong in `MULTI-DEVICE-SHAPE.md` §9 ("one
  fix may cover both").
- **Per-device encryption.** Not a task and not a question to ask now: the tier does not run yet.
  What v1 does is what an app does — the files live inside the user's data directory with
  restrictive permissions, on a disk the user already encrypts. Per-device keys would travel on
  the save/restore call and be applied by the engine, which writes the file; that is a change to
  T1 and it waits until a restore round-trips at all. Recorded here so it is not rediscovered as
  an oversight, and not before.
- **Backup.** A decision, not code.
- **A device's other chats being warm without a restore.** Corrected from v1: the prompt cache is
  global (`server-task.cpp:1798-1866`) and its `load()` filters on `cache_salt` (`:1811-1813`),
  with `id_slot` only the destination (`:1845`, `:1863`). So the load path *does* run under pinned
  slots; what the salt prevents is loading another device's state. Warmth without a restore stays
  confined to entries the same slot itself saved — a different and sufficient reason to leave it out.
- **The 4 096 per-device floor** and the refusal of a device beyond the launched count stay where
  they are (`PLAN-CHAT-ON-DISK.md`, `MULTI-DEVICE-SHAPE.md` §4). This tier does not change the
  window per device.

## 7. Rules this plan obeys

- **Nothing goes upstream.** No PRs, issues, comments, reviews, patches or discussion. Upstream is
  read, never written. The appendix keeps its attribution to upstream PR #26004; any fork
  divergence is stated in the code comment, not filed anywhere.
- **No push, tag or release without the owner's explicit OK.**
- **No number reaches the user interface before it is committed in a stripped artifact.** The
  ~1.4 GiB in §2 is derived from committed cell counts and is labelled as derived, not measured.
- Coders and reviewers on different models; an errored review is a lead, never a pass.
- Files under ~400 lines; pre-existing excess declared, not refactored. Comments only for WHY or a
  trap. No secret **values** anywhere — names are fine.
- On the released engine commit `2a290390d` — tagged **`kalsa-server-v1.1.0`** — the same lines
  are `:2868`, `:3199`, `:3418-3421`, and the older documents cite that numbering.

## 8. What version 1 got wrong

Kept because the audit round is part of the artifact, and because the same mistakes will be made
again by the next author who reasons from lines they did not open.

1. **The deferral citations** (`:2761-2765`, `:2836-2840`) pointed at the case entry and the
   "Invalid slot ID" error. The deferral is `:2768-2771` and `:2842-2845`.
2. **The engine's port in T3 was 8130 — the door's own listener.** A door-internal action calling
   it would call itself. The engine is the `upstream_port` the door was built with, today 8123.
3. **`slots.rs:53`** pointed at a comment about `leases`; the device→slot map is `:51`.
4. **The tag was named `v1.1.0`.** It is `kalsa-server-v1.1.0` — the bare name matches no tag,
   which is what the auditor found when it searched for one.
5. **The `--swa-full` claim was overclaimed.** It drops one term of a three-term disjunct, not the
   whole condition; the appendix is conditional for the reasons in §2, not because the flag
   guarantees its absence. **And the flag was never the tier's question at all.** v1 inherited
   that framing from `MULTI-DEVICE-SHAPE.md` §9 and `PLAN-CHAT-ON-DISK.md` §5, both of which make
   `--swa-full` a tested precondition on the strength of the paging spike's `cached=0`. The run
   in §5 shows the spike measured the namespace hole, not the flag, and that the two documents'
   framing is superseded. They are not rewritten: they record what was believed, and this plan
   records what was measured. **The general lesson, worth more than the correction: a negative
   result that is never varied one variable at a time is an attribution, not a finding.**
6. **The cross-slot prompt-cache sentence was wrong**, and is corrected in §6.
7. **Gaps the coder would have had to invent**: the failure UX of a restore, the filename scheme's
   authorship, chat deletion, the sleep case, salt rotation across a re-pair, the resident map's
   interface, crash invalidation, who renders `--swa-full`, and whether the tier passes
   `--ctx-checkpoints`. Each is now decided in T1–T6 or declared in §6.
