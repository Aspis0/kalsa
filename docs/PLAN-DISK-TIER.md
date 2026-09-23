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
- **`--swa-full` was the plan's red herring, and two measurements settled it.** The paging
  spike's `cached=0` was never a sliding-window limitation: it is the namespace hole below, read
  through a harness that did not send the salt on the slot actions. With that fixed,
  `dev/results/slot-restore-device-path/summary.md` reuses the conversation in **all eight** arms —
  1895 of 1900 tokens with a full context, with and without a salt, with and without the flag — and
  the flag moves the file size only. **So the tier does not render it**, and the ~1.4 GiB price
  below is moot.
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
- **Landed**: `833cde99b` on the engine's `main`, and **released in `kalsa-server-v1.1.1`**
  (`a7d2cec79`; `git merge-base --is-ancestor` confirms it in the fork, read-only). It was not in
  `kalsa-server-v1.1.0`. Red first, green verified independently, review FIT; the state is in the
  session handoff. **The app now installs v1.1.1** (`e3f47a7` + `d540934`, §5 and §9): the pin was
  the kernel release line's call, it was made, and the warmth is delivered. The remaining debt is the
  MEASUREMENT on the delivered object — the warmth proof ran a fork build — and that is a follow-up,
  not a promise (§5).
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
- `chat/src/App.tsx` is 1181 lines and was 1147 before T3c-fix2 (`acfe4f7` was 1109 before T3c) — pre-existing excess,
  declared here and not refactored. What T3c added is the wire-up to `slotGate`; the ordering logic
  it used to hold was **moved out** into a pure module, not left in place. T3c-fix2 adds the
  standing effect and the gate's own sentence, and keeps every decision in `slotGate.ts`
  (386 lines) and its harness (392).
- `crates/kalsa-door/src/proxy.rs` is 563 lines before T4a-fix (`0cbb719`) and 586 after — also
  pre-existing excess, declared here and not refactored. It is the door's request path, where every
  way out of a request has to be reasoned about, so the growth is the guard that makes the slot's
  mark survive each of them.
- `chat/src/App.tsx` and `src-tauri/src/main.rs` (1371) are the two files this plan keeps adding to.
  When either next needs more than a wire-up, the answer is a module, not a longer file.
- **Declared, and not refactored.** Measured 2026-09-22 at `5f0ef55` and unchanged since:
  `crates/kalsa-door/src/lib.rs` **563**, `src-tauri/src/options.rs` **675**,
  `chat/src/lib/slotGate.ts` at its 400, and `chat/src/App.tsx` **1211**. Re-measured at T6b's
  first commit (pre `2a3fc4e`): `src-tauri/src/tests.rs` **2007** (1939 before T6b),
  `src-tauri/src/main.rs` **1456** (1371 when first declared, 1427 at `5f0ef55`),
  `src-tauri/src/metrics.rs` **440** — over the ceiling for the first time, the tier's DTO being
  what took it there — and `chat/src/surfaces/useBrain.ts` **474** (447 at `5f0ef55`). Three of
  the 2026-09-22 set were over the ceiling and **undeclared** until a reconnaissance found them —
  that is a rule not enforced, not a finding.
  `crates/kalsa-door/src/paging.rs` is **387** because T5b moved `file_name` and `valid_id` into
  `paging/names.rs`: the next change there moves code out, it does not add — which is why T6b's two
  getters live in `paging/census.rs` (**53**) and `paging/disk.rs` (**74**) instead. T6b did not
  touch `chat/src/App.tsx`.

### T2 — app: the launch flag set this tier needs

Landed (`a367bdd`, `3d74cce`, `81fd36b`); the state is in the session handoff, the rules it left
behind are in §7. Three flags, one place (`crates/kalsa-launch/src/argv.rs`):

- `--slot-save-path` → a directory the app creates under its data directory before launch. If it
  cannot be created, the launch refuses rather than starting an engine whose disk tier silently
  answers `not supported`.
- `--ctx-checkpoints 1` → the default is 32 (`common/common.h:630`) and v1 left this out, which
  would let one chat's save file reach the size the handoff records. One is the point, not a
  convenience: the appendix carries the checkpoint blobs, so the flag multiplies the save file, and
  the reader trimming to `n_ctx_checkpoints` (`server-context.cpp:2581-2583`) is a **bound, not a
  licence to ask for more**. The test must pin the exact pair `["--ctx-checkpoints", "1"]`: a
  substring assertion passes for `"12"` and `"16"` as well, and a mutation to `"12"` left all 49
  plus 151 tests green when this was checked.
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

Landed (`7834556`, `ea35829`, `fd919d5`, `5db9ee2`, `569d31e`, `c2ae295`); the state is in the
session handoff. What the code settles, and what is still missing:

- The two routes are served **by the door, on its own port**: `POST /kalsa/chat/activate` and
  `POST /kalsa/chat/erase`, body `{"id": …}`, handled after the credential, under the slot's
  lease and **before any upstream socket**, never forwarded. A phone therefore reaches them over
  the tunnel without the app being in the path, which is why this is a route and not an in-process
  method.
- **The residency map is the door's own**, keyed by slot: the caller never says which chat was
  resident, because whoever says that decides **which file the slot's state is written into**.
- **The staging rename closes the sleeping-engine hole**: the save goes to `<name>.staging`, and the
  real file is replaced **only when the engine reports `n_saved > 0`**; a reply without that field is
  treated as unreachable, never as a success.
- **The door's side of the tier is complete**, including the two lies a review caught (the slot
  called "empty" when the engine had never answered; a `.staging` file surviving an unanswered save)
  and a **third state, `Unknown`**: an unanswered restore is not repaired, a refusal still is, and on
  `Unknown` the next activation **does not save** — it will not write out a slot's content it cannot
  name.
- **T3b pinned the identity from the launch record**: the digest was already in `run`'s hand and
  being discarded (`choose_model`'s `plan.sha256`, `startup.rs:232` = the catalog row's pinned
  digest, `manifest.rs:61` → `choice.rs:284`), so **no model file is ever re-hashed**; and the
  directory is the `--slot-save-path` the engine actually received, not a second resolution. A model
  with no catalog identity leaves the door up without the tier (501, one stderr line); a malformed
  digest builds no door.
- **T3c-fix2: the fifth way, closed.** `acfe4f7` was audited **NON FIT**: the invariant "the
  UI's active chat never diverges from the slot's resident" is absolute only if *this window
  cannot call the door yet* is a different fact from *there is no door*. It was not.
  `Activate | null` read a failed poll — and the window between a running engine and this
  window's credential — as "no door", and a chat minted there is one the door never took: the
  completion builds its state in the slot, and the next switch writes that state into the
  resident chat's file. So: a poll that does not answer keeps what the window knew
  (`lastKnown`, `useBrain.ts`); the door's state is explicit and three-valued (`DoorAccess`:
  `absent | unready | ready`, `slotGate.ts`), with `unready` **holding** the open — pending,
  no request, no mint — instead of opening locally; and a door that becomes callable hands the
  locally minted active chat over through itself. A local mint stays possible for the client
  that has no door at all: a remote server, or the plain browser (`standingOf`). Same commit:
  `sendMessage` refuses an `ActiveChat` the gate has moved past instead of ignoring it, the
  already-open fast path reads the gate (`isSettled`) and not the rendered active id, deleting
  a chat clears the gate's own active chat and refuses a late mint of that id (`clearIf`), and
  the harness asserts the request's method, path, bearer and exact body keys, where a
  `slotRoute` regression used to leave it green.
- **Gap, stated:** in a packaged `.app` stderr is not user-visible, so a client sees the 501 and the
  operator trace goes nowhere. A UI surface is a follow-up, not invented here.

### T4 — app: cadence, so an unload cannot lose a turn

Save-on-switch alone is **lossy**: `--sleep-idle-seconds 300` destroys the slot's state, and the
switch that follows has nothing left to save. The tier therefore saves on two triggers:

- every chat switch, before the restore;
- an idle timer **shorter than the unload clock**, so the file is never more than the timer behind
  when the engine unloads.

The interval is **derived from the clock the engine actually received**, not a constant: the unload
clock is settable from the panel down to 60 s (`MIN_IDLE_UNLOAD_SECONDS`,
`crates/kalsa-launch/src/args.rs:160`) and a fixed interval above the shortest clock reproduces the
loss this task exists to close. The derivation lives with the clock (`idle_save_seconds`,
`args.rs:182`), and the pin holds over the whole legal range, not at two named points.

What the timer clocks is **silence, not the tick**. The engine does not release a slot the user is
talking to, so the state worth saving is the one after the last token: a fixed-period save would
write hundreds of megabytes under every busy minute and still hold the wrong state. A slot is
written out once it is dirty *and* quiet for the interval.

Two things the T4a review settled, and both are part of this task rather than follow-ups:

- **The silence starts when the last token reaches the client, not when the request left.** Marking a
  slot at the top of a turn stamps an instant before the generation exists; the timer then saves a
  prefix, clears the mark, and nothing re-marks that turn. The mark belongs after the response has
  fully relayed, and on the cancellation branch too — an interrupted generation has already written
  into the cache. This is invisible to a fake engine that answers instantly, so the acceptance test
  needs one that answers slowly.
- **The tick is Rust's, not the webview's.** A timer driven by the frontend's poll stops when the
  last listener unsubscribes (`chat/src/surfaces/useBrain.ts:155-157`) and is throttled when the
  window is occluded — and the phone chatting while the desktop window is minimized is this door's
  primary case. The save must not ride a synchronous command either: an engine that accepts and stays
  silent would freeze that command for the patience budget per slot.

A restore after a genuine unload is therefore a **restore plus a model load**, and the UI says so
during the load — the engine's readiness budget is 600 s (`src-tauri/src/startup.rs:42`), so the
sentence is not optional. v1 left this as an undeclared "refused or re-driven"; it is now decided:
**re-driven**, never refused, because the user asked to open a chat and the state exists.

**Acceptance**: a test that the idle interval holds below the unload clock across its whole legal
range; a test that a slow generation is not marked until it finishes; a test that a save the engine
refuses is retried no sooner than the interval; and a switch after an unload restores from disk
instead of returning an empty conversation.

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
- **This task is load-bearing for warmth, not hygiene** (the T3c review's finding, and it is the
  reason T5 comes before T6). `569d31e` made activating the already-resident chat a no-op, which
  removed the self-healing the path used to have: with the engine asleep but the map still reading
  `Resident`, the no-op skips the very restore that would have brought the cache back from the file.
  A stale map therefore does not merely lie in the panel — it costs the warm start the tier exists
  for. The map must be wrong as little as possible, and `Unknown` must be reached whenever the
  engine's state is not known.
- **A rebuilt door must not start at `Empty`.** `stop_door` (`src-tauri/src/main.rs:210-224`) drops
  the map with the door, reachable with the engine still alive (an unreadable pairing store,
  `:363-376`). The rebuilt door has every slot at `Empty`, so the first activate takes
  `previous = None`, saves nothing, and erases/restores over state the engine still holds. The
  honest initial state for a door built against an engine that is already running is `Unknown`,
  which the design already defines as "do not save, and say unknown".
- **Sweep**: a revoked device's files, when the store polls and the door prunes
  (`src-tauri/src/main.rs:346`, `:364`; the slot side is `slots.rs:239-268`). A **deleted chat's**
  file is removed with the chat, not left orphaned — the sweep covers devices, this covers chats.
  An `erase` the door *refuses* leaves an orphan file and the UI offers only Dismiss today; decide
  whether the user gets a retry or the next activation repairs it.
- **Declared loss, not fixed**: a slot stolen from a device that has left the set clears its
  residency and its `dirty_at` without a save (`paging.rs:221-222`, and the same shape in `erase` at
  `:295-296`), reachable because `DeviceSet::swap` frees a removed device's slot without touching the
  map (`slots.rs:239-262`). The bound is real — only a departed holder, only the last interval of
  its state, and the tick would skip a salt-less device anyway — so it is written down rather than
  given a mechanism.
- **Declared loss, not fixed**: the adopted server's invisible release. A server reused from an
  earlier run has no pipe of ours, so `model_asleep()` stays `None` for it (`child.rs:53-57`) and
  the tick's invalidation (`engine_lost_its_state`, `src-tauri/src/main.rs`) never fires for it:
  after the release the map still reads `Resident` for every slot the app named afterwards, and
  mounting the chat already in such a slot is the no-op that skips the restore — it returns COLD,
  the warmth this task exists to protect for piped servers. Only the first activate is covered (the
  door born against an adopted server starts `Unknown`, so that one restore is driven — the last
  sentence of the invalidation bullet above). Not fixed because there is no observable signal:
  no pipe, no stderr line, no crash. The other half of that stale map — `save_idle` writing the
  post-release slot over the chat's file — is CLOSED rather than declared: the first attempt
  answers `n_saved` 0 (an emptied slot renames nothing), and the `Nothing` arm then relaxes the
  map to `Unknown` and drops the mark (`dbe23b3`), so no second attempt is made. The ordinary
  post-release slot has no mark left to attempt with at all (the pre-release save cleared it),
  which is why the cold mount above is the half that survives.
- **Declared loss, not fixed**: a failure that REACHED the engine and persists holds the engine
  awake without end, so slot and model stay in RAM while the condition lasts. The engine posts the
  save task before any outcome and that post stamps `time_last_task` (every non-METRICS task,
  `defer` included); the failure does not unstamp it — the stamp is at the post and the error only
  arrives after — and the interval is a third of the unload clock by construction
  (`idle_save_seconds`, `IDLE_SAVE_DIVISOR`), so Q < 3Q and the sleep threshold is never reached.
  The designed exit is invalidation, and it waits for the sleep's stderr lines
  (`MODEL_RELEASED_LINE`, `crates/kalsa-supervisor/src/child.rs`) that the retry itself prevents;
  the `Err` arm touches no residency (`crates/kalsa-door/src/paging/cadence.rs`), so the slot stays
  `Resident` and the cycle restarts. The species that produce it: a persistent `Refused` (a full
  disk), a persistent `Files` (each interval the engine rewrites the whole state and the door's
  rename fails again), and a request delivered but never answered past `PATIENCE` (10 s). The
  species that never reach the engine — connect refused, a deadline spent before the dial — post
  nothing, so the engine's own clock runs, the sleep arrives and the map is relaxed: they go out by
  themselves, and that split is what makes the sentence above bounded rather than absolute (the
  door cannot tell the two apart, `Call::Unreachable` carries both, and the arm drops the
  discriminant). Whether the retry is capped is the owner's call, three roads and a price each:
  **(a)** a real ceiling, which **loses the turn** — the state is in RAM and the release destroys
  it, so T4's promise (an unload cannot lose a turn) is what a ceiling spends; **(b)** no ceiling,
  which is what ships, and the price is the RAM above while the condition persists; **(c)** having
  the engine stamp `time_last_task` only on an outcome it liked, which is engine-side.
- **Declared behaviour, not fixed**: a live door can stand beside `Stopped`. Both senders lower the
  door *before* they send (`brain_stop` before `supervisor.stop`, the app-exit handler before
  `supervisor.shutdown`), but `Supervisor::stop` returns at once — the state follows on the next
  read — and the worker spends the teardown walking the stop grace out — stdin EOF → grace →
  SIGTERM → grace → SIGKILL, each wait bounded by `stop_grace` (2.5 s as `startup.rs` configures
  it), so the window is up to **two** graces plus the reap — before it writes `Stopped`. A
  `brain_state` poll landing in that window still reads `Running`, enters the Running arm and
  re-raises the door the stop had lowered: **the poll is the reconciler**, and that is the whole
  mechanism. So a door that is up can coexist with `Stopped` for up to one poll interval
  (`POLL_MS`, 1 s) — after the grace window, in which the state still reads `Running`. This is an
  availability blip behind full authentication, not an exposure: the listener answers 401 without
  the bearer. Whether a request that slips into the blip is **served** depends on which stop this
  is, and these cases are not all the same (the two below are not an exhaustive split: an adopted
  engine whose pid **is** recorded, and whose SIGKILL grace expires without the process leaving, is
  a third, degenerate one). For a **spawned** engine the child is walked to its reap
  before `Stopped` is written, so the engine is gone and the request gets an error. For an engine
  **adopted blind** — `Started::Adopted { pid: None }`, reachable when the previous writer died
  between its announce and its describe — there is no pid and no handle to walk, so the stop takes
  that arm and writes `Stopped` **at once**, leaving the engine **alive and listening**: the code's
  own words are that it is left running by necessity and leaks until reboot
  (`crates/kalsa-supervisor/src/supervisor.rs`). In that window a request with a valid bearer is
  **served**, not errored. It is the same adopted server whose invisible release the residency map
  cannot hear — the declared loss above, on this same task: no pipe, so the map never learns, and
  no child, so `Stopped` need not mean the engine is gone. The alternative — the Running arm not
  re-raising while a stop is in flight — is an owner decision, and it has not been taken.
- **Inherited, never binding**: a slot handed to another holder inherits `retry_after`.
  `activate` and `erase` clear the mark (`dirty_at`) and leave the backoff standing
  (`crates/kalsa-door/src/paging.rs`, `paging/cadence.rs`), but no reachable interleaving lets that
  bound decide the new holder's first save: the stamp's `T` is the tick's own `now`, read before
  the attempt read the residency the handover then rewrote under the same slot lock, so every
  inherited `T` precedes the handover `H` (even a stamp whose write lands after it carries the
  pre-read instant); `H` drops the mark, so the new holder's first mark `M` follows `H` —
  `T < H < M`, and the quiet gate `M + Q` matures strictly after the inherited `T + Q` has already
  expired. Under one interval of the bound is still standing at the handover at worst (`< Q`,
  `Q = idle_save`, a third of the unload clock — under ~20 min at the panel's maximum), and it
  runs out inside the wait the new holder owes for its own mark anyway.
- **Acceptance**: a test that a crash does not leave the map claiming residency; a test that a
  rebuilt door does not report `Empty` for a slot it has never looked at; a test that a revoked
  device's files are gone; a test that deleting a chat removes its file.

### T6 — the panel

Resident count, window per device, **55.78 MiB** per extra resident, and the concurrency figure
**only once its measurement is committed** — it is (`5b9b98f`; re-measured `fe14e78` and again
`34de14f`, §5), and the row names the artifact it was measured on (`1f22bb7` + `35458f1`, §9). Two
corrections the tier owes:

- The live window number must come from the engine's per-slot value, not `n_ctx`
  (`chat/src/lib/chat.ts:117-140`).
- The disk line comes from the measured footprint in §5 — ≈ 53 KB per token on the measured model,
  ≈ 218 MB per chat at the 4 096-token floor — and is linear there; the saturating part of the
  curve is not measured and the panel must not extend the line past it.

## 5. The measurement that decided the tier's shape — done, twice

**Does a chat saved to disk come back warm on the device's path? Yes, and `--swa-full` was never
the variable.** The result that counts is `dev/results/slot-restore-device-path/` (`b3ded12`): all
**eight** arms reuse the conversation — 1895 of 1900 tokens with a full context, with and without a
salt, with and without the flag — and its own derived verdict field reads `cold_arms: []`.

Before that fix, the same harness read 0 for its `salted` arms, and the reason was the harness: it
sent the salt on the completion but **not** on `save`/`erase`/`restore`, so the "salted" arm was
"completion salted, slot actions unsalted", a path no client produces, and the restore stamped the
empty namespace. The door does send it (`engine.rs:67` → `private_headers`). The earlier artifact
(`dev/results/slot-restore-swa/`) is kept as written, with its `salted` rows labelled for what they
were; its conclusion — the namespace, not the flag — is what pointed at T1.

**The disk curve, measured where the plan derived it.** The plan carried the per-chat footprint at
4 096 tokens as a **derivation** (~53 KB/token measured at 600/1900, hence ~218 MB per chat). Measured
(`dev/results/unload-restore-disk-curve/`, on the release, the no-file control **cold in every arm**):

| tokens | file | bytes/token | control `cache_n` |
|---|---|---|---|
| 600 | 32 379 628 | 53 966 | 0 |
| 1900 | 101 737 228 | 53 546 | 0 |
| 4096 | **125 012 200** | **30 521** | 0 |
| 8192 | 156 272 872 | **19 076** | 0 |

**The curve has a knee, and the knee is the model's own window showing up inside the file.** Below the
window the slope is **53 312 B/token** (measured 53 352); above it the slope is **flat at 7 632
B/token** — the same marginal at 4096→8192 and at 32768→65536 — which is the KV of the **14 full
layers** alone (14 x 2 x 2 x 128 x 34/32 = 7 616, +0.21 %). Below the window the file carries **two**
copies of the **42 windowed layers** (22 848 B/token each): the live window **plus the context
checkpoint** — and the second copy is **measured, not inferred**: the line `restored context checkpoint
(... size = 44.649 MiB)` is in the artifact and equals 42 x **2048** x 544 (+0.06 %), so it is capped at
the **window**, not at the live cache's 2 560 cells. The compact form, which cancels scale errors:
`slope below - slope above = 53 352 - 7 632 = 45 720` against `2 x 22 848 = 45 696` (**+0.053 %**). The
law is therefore

    bytes ~ tokens x 7 616  +  2 x 22 848 x min(tokens, 2048)

**The knee lies between 1900 and 4096 tokens**, and it is the only place the slope changes: beyond it
the slope is *constant* (7 632 B/token at 4096→8192 **and** at 32768→65536), so a sentence placing a
"bend" in the later segments is wrong even when the bytes are right. The second review found exactly
that in the generator's knee rule — it compared a marginal against the *previous average*, which still
carries the amortised window term, and read two identical 7 632 marginals as two bends. The rule now
compares marginal against marginal and declares the post-window slope flat; the two artifacts whose
conclusions were wrong were **regenerated**, and the bytes came back **identical** (125 012 200 /
156 272 872 / 343 836 904 / 593 922 280). Two caveats: above the window the agreement is within 0.2 %,
**below it is not uniform** (+0.44 % at 1900, +1.2 % at 600 — an unmodelled constant term), and the
14/42 split comes from the engine's boot lines recorded in the artifact, **not** from the GGUF header
(which declares 56 blocks, 2 kv heads, 128+128 and the 2048 window).

**Consequence: the plan's 4096 figure is corrected by 93 MB.** At 4 096 tokens the measured footprint is
**125.0 MB**, not 218 MB (-42.7 %); and because the cost per token *falls* past the window, the linear
derivation was wrong in the direction that decides worse: at long contexts the disk costs much less than
the plan said. (The `--swa-full` flag this tier does not use would pay 22 848 B/token **forever more** —
both windowed copies stay full — so the longer the chat, the worse it gets: the plan said the flag was
not worth it without the reason, and now the reason has a number.)

**The warmth, measured on the delivered object.** `dev/results/unload-restore-release/` runs on the
**release** (`release.status = matched`, commit `a7d2cec79`), its identity anchored to the **dylib**
(`libllama-server-impl.dylib`, `714e8ba1...`) because the launcher is **byte-identical** between v1.1.0
and v1.1.1 and separates nothing: 595/600 and 1895/1900 tokens restored, the no-file control **0**. And
the proof the pin was needed: the same harness with the **v1.1.0 tree inside a folder named
`kalsa-server-v1.1.1`** -> the launcher check says `matched`, the **commit** check says `not-the-release /
engine-commit-mismatch`, and the warmth is **false** (`cache_n 0/600`). v1.1.0 comes back cold, v1.1.1
warm: measured, not argued.

**Where these numbers came from, and the trap they were nearly lost to.** The dev build
(`/Users/marco/Projects/kalsallama/build/bin/llama-server`) is **CPU-only** (`GGML_METAL:BOOL=OFF`, no
Metal in its dylib, its own log says `no usable GPU found`), so its prefill runs at 7.85 ms/token and
gets worse under load (14.55), while the release runs at 0.49 and does not move (0.504 at load 11.4,
0.501 at 39.7). The decisive control was **one flag on the same binary** — the release with
`--n-gpu-layers 0` answers 9.86 ms/token — not the A/B between two builds: **when two artifacts differ,
the decisive control is a flag on the same artifact, because it is the only one with no second variable
to hide.** Any prefill figure measured on the dev build is a **CPU** figure: label it or retract it. An
explanatory detour through the thermal governor was refuted by two independent reviews (the governor is
not in `llama-server`'s path at all: `git grep -c governor a7d2cec79 -- tools/server/` answers 0 files)
and is kept here only so nobody rebuilds it.

- T1 is closed and **`kalsa-server-v1.1.1` carries it** (commit `a7d2cec79`; verified in the fork,
  read-only, with `git merge-base --is-ancestor 833cde99b a7d2cec79`). The app's engine asset used
  to pin `kalsa-server-v1.1.0`, which does **not** contain it (the same command against `2a290390d`
  answers NOT an ancestor) — so for a day the warmth this tier exists for was released and not
  delivered. **That half-move is closed**: the pin moved to v1.1.1 in `e3f47a7` + `d540934` (§9), and
  the delivered object is now the one the panel's number was measured on. What is still owed is the
  measurement on THAT object: the warmth proof below (`dev/results/unload-restore/`) ran a **fork
  build** (build 11193, `833cde99b`), and the release is build 11195, `a7d2cec79`. A measurement that
  makes «delivered» and «measured» the same object is the follow-up, not a promise.

**The two-device concurrency figure, measured three times; the third run is the one the panel
carries.** `dev/results/concurrency-two-devices/` answers it on the **release artifact**: one device
keeps **0.7336** of its solo decode rate while a second device decodes (both slots agree to four
decimals), and the engine's total is **1.4672×** one device, with `A2/A = 1.0037` inside the 3 %
drift bracket. **The spread across the three runs is the honest part:** `5b9b98f` answered 0.7546 /
1.5093 at a load floor of ~4–6, `fe14e78` 0.7302 / 1.4604 at ~2, `34de14f` 0.7336 / 1.4672 at
4.08 — three runs, three floors, and the answer moves by 3 % in the per-device term while every
run's own `A2/A` bracket stays inside ±1 %. **The panel cites the third**, because that is the
artifact produced by the script in the tree and whose provenance is a field rather than prose (§9);
the first two are history, kept in their own commits. The floor is declared and not denied: the
machine was not empty, which moves the absolute rate and cancels in the comparison.

**The saturating part of the disk curve is now a number, and it saturates in the direction nobody
feared.** It is measured to **65 536 tokens** — the app's own default per device
(`crates/kalsa-launch/src/args.rs:146`) — in `dev/results/unload-restore-app-context/`: **593,9 MB per
saved chat** (593 922 280 B), with the cold control at 0 and the release identity `matched`. The
generator's own knee detector was wrong until the second review: the knee is **the window crossing,
bracketed between 1900 and 4096 tokens**, and **beyond it the marginal is flat** — 7 632 B/token at
4096→8192 *and* the same 7 632 B/token at 32768→65536. So the cost per token **falls** with length
while the benefit **grows** (at 65 536: 71,0 s of cold pre-fill avoided against 87,6 ms of warm
restore): **the longer the chat, the better this tier pays**, which is the opposite of the fear the
derivation encoded. What remains open is narrow and named: sizes **between 8192 and 32768 are not
measured** (the knee is bracketed, not localised), the app-context run used `--ctx-size 131072`
because 65 552 does not fit a 65 536 slot ctx (the `headroom` gate refuses instead of truncating, and
the per-token independence from ctx is carried by the two committed artifacts at ctx 8192/16384), and
the `ms` columns of everything but the last two runs are **contention-dependent**, labelled as such
in the artifacts.

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

- **Name the repository, always — path, branch and HEAD.** Kalsa is five repositories plus their
  worktrees, and two of them share one remote URL, so neither the name nor the remote identifies a
  tree. Every report, every delegation and every commit message says which one:

  | repository | path | branch |
  |---|---|---|
  | the app, ours | `/Users/marco/Projects/kalsa-brain` | `brain` |
  | the phone app | `/Users/marco/Projects/kalsa` | `main` (worktrees: `kalsa-ux`) |
  | the engine | `/Users/marco/Projects/kalsallama` | `main` (worktrees: `-wt-1068`, `-wt-opencl-degrade`, `-wt-q6k`) |
  | the React Native binding | `/Users/marco/Projects/llama.rn-kalsa` | `main` |
  | the MoE experiments | `/Users/marco/Projects/kalsa-moe-experiments` | `main` |

  `kalsa-brain` and `kalsa` both point at `Aspis0/kalsa.git`. The engine's own worktrees sit at
  different commits, two of them detached, and its main worktree can carry another branch's file
  content uncommitted — so "the engine" is not one tree, it is four.

- **Nothing goes upstream.** No PRs, issues, comments, reviews, patches or discussion. Upstream is
  read, never written. The appendix keeps its attribution to upstream PR #26004; any fork
  divergence is stated in the code comment, not filed anywhere.
- **No push, tag or release without the owner's explicit OK.**
- **No number reaches the user interface before it is committed in a stripped artifact.** The
  ~1.4 GiB in §2 is derived from committed cell counts and is labelled as derived, not measured.
- Coders and reviewers on different models; an errored review is a lead, never a pass.
- **A pin asserts the exact pair, and exactly once.** `contains("--ctx-checkpoints 1")` is true of
  `--ctx-checkpoints 12`, and a helper that reads the first occurrence lets a duplicated flag
  through. Measured both ways: a mutation to `"12"` left 49 plus 151 tests green before, and the
  converted pair turns red on it; the same for `HOST` → `127.0.0.10`.
- **A neutral failure sentence must be *declared*, not omitted.** `every_failure_says_what_the_user_can_do`
  (`src-tauri/src/failure.rs:347-360`) requires an action word in every sentence; a cause the user
  cannot act on joins the named `unrecoverable()` list, and the same test asserts an exemption does
  **not** also give advice, so the list cannot become a drawer. Leaving the variant out of
  `every_failure()` instead is what made the invariant accidental.
- **One branch per repo, and it is the working branch: the app on `brain`, the engine on `main`.**
  Do not create another one. **A branch is not an artifact — delegate and review by commit hash.**
  The app's trap, stated exactly, because it is the one that eats work: its remote is
  `github.com/Aspis0/kalsa.git`, the **phone** app's remote, and that remote holds two lineages —
  `origin/brain`, ours, which `brain` tracks, and `origin/main`, which is **not ours**: the phone
  app. They are not close. Measured today: `brain` is 257 commits ahead of the merge base and
  `origin/main` is 911, and `origin/main`'s most recent commits are `scripts/ci-e2e.sh` and
  `scripts/test_sideload_guards.sh`. **There is no local `main`**, so the only way to reach that
  lineage is to name it on purpose: never check it out, never fetch into it, never make it a push
  target, never `checkout -b main`. The three other local branches (`catalog-downloadable`,
  `iroh-door`, `resumable-answers`) are pre-existing and are left alone: this rule forbids **new**
  branches, not other people's.
- **Say which branch you are on before every commit.** `git branch --show-current` must print
  `brain` in the app and `main` in the engine. A commit is cheap to lose and expensive to find when
  it sat on a branch nobody named.
- **Stage by name: `git add <file>`, never `-A` and never `.`** The engine tree carries 465 lines of
  unrelated work in progress and the app tree carries three untracked measurement scripts; a blanket
  add commits both. A delegate commits only the files it touched, and says which ones.
- **Shared working tree is fine; switching its branch is not.** Delegates and the orchestrator may
  work in the same checkout — that is how the plan commits and the code commits stay one history —
  but nobody but the orchestrator changes the branch, and the orchestrator does not change it while a
  delegate is working.
- **Never create a God file.** A file holds one responsibility, and the test is that you can name it
  in one phrase. Line count is a smell, not the rule: ~250 is indicative, **~350 is fine**, and a
  change that only moves lines to make a number work should stop and leave the file where it is.
  **No new file beyond ~350**, and no file — new or existing — that mixes responsibilities until it
  stops being readable. Test files follow the same logic: if a test file becomes an indistinguishable
  list of cases, split it by **topic**, not by line count. Pre-existing excess is **declared, not
  refactored** (those declarations sit with the tasks above; the live list with its counts is the
  "Declared, and not refactored" bullet under T1, re-measured whenever a task adds to one of those
  files). Comments only for WHY or a trap, and if
  a comment declares an invariant that invariant must be true. No secret **values** anywhere — names
  are fine. **These ceilings govern the delivery's code.** A measurement tool under `dev/` is a
  development instrument, not the delivery: it is not reshaped to make a count work, and its
  duplication is not chased for its own sake.
- **A green built from the answer is the most expensive kind of green.** A test or a fixture must be
  able to go **red for the reason it declares**, and the only proof that it can is a mutation that
  kills it. Four instances, one night: a fixture whose bytes were computed **backwards** from the
  string its test wanted (`106_444_800`, recorded in no artifact); a pin that stayed **green with
  the residency gate switched off**, because the instant it captured made the quiet gate
  short-circuit first; a test named "two consecutive failures are the ceiling" that **never produced
  a second failure**, so no assertion could observe a ceiling; and the same defect found from the
  other side by the engine coordinator's mutation test on the provenance gate. A green with no
  mutation that kills it is not evidence — it is an insurance policy that covers nothing.
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

## 9. Decisions taken elsewhere, and what they bind here

The engine and the binding are **one fork and one binding**, so every question that touches them was
put to the kernel coordinator — the session at `/Users/marco/Projects/kalsa`. Its answers are
recorded here with **its** authority, and anything nobody has built yet is labelled **decided and
not implemented**, so a decision is never read as a delivery.

- **The retry ceiling — decided: the engine stamps only on a successful outcome.** A task that
  failed stops counting as use, so the model becomes releasable, and the app's retry loop stays as
  it is. The price is accepted and real: with a persistent refusal (a full disk) the model can be
  released between attempts, so the retry costs a reload. The turn survives — reload plus retry —
  without pinning RAM. **Not implemented**: it lands in the engine, with a test for each half.
- **The governor — one owner, the engine.** A latched plugged idle baseline now has exactly one
  implementation: the engine's condition survives, the phone app's copy is deleted. The desktop
  never had one and adds none. 
- **Any threshold this plan restates must cite the engine's constant rather than repeat its value**,
  or there is a fourth divergence in six months.
- **The panel's number is attributed to the release artifact**, not to a build of the fork:
  `kalsa-server-v1.1.1`, by artifact **name** (a name cannot drift the way a hand-typed tag can),
  its sha256, the commit and the workflow run. A number taken before the release exists carries the
  label `fork build, not the release` and is re-measured; a pre-release number never shares a column
  with a release one. It is valid only on its recorded `platform` and `backend` — this one is
  `macos-arm64` / `metal`.
- **The engine the app installs — decided by the kernel's release line, delivered in `e3f47a7` +
  `d540934`** (review FIT). The app pinned `kalsa-server-v1.1.0`, which does **not** contain T1
  (`833cde99b`): the warmth this tier exists for was released and not delivered — the door sends the
  salt, the engine loses it, `slot.prompt_clear()`, and a restore after an unload comes back cold.
  The row now pins v1.1.1, and the pin and the measured artifact are the same object again, which is
  the only reason the panel's number means what it says. Two facts the delivery rests on, both
  verified: the archive set in `marker.rs` is what tells versions apart, so a machine that already
  has v1.1.0 re-acquires (the identical `exe_sha256` cannot vouch for a version); and the inlet's
  probe reads the **dylib**, not the launcher, so the launcher-identity argument does not cover it —
  the dylib's bytes were checked directly (`x-kalsa-slot` once, `X-kalsa-Slot` never). The pin is
  **And it moves the machine's verdict, by design**: `verdict.rs`'s fingerprint is built from the
  digests of the exact archives that passed the probe (`verdict.rs:26-45`), not from the release tag,
  so a machine that ran v1.1.0 — this one has `fingerprint=9ee5d9f5…|macos|Metal|os` in its
  `verdict.txt` — will re-probe the backend on its first start after the update, because those bytes
  have never been proven there. That is the same rule that made this pin worth moving: the identity of
  what was measured lives in digests, and the app refuses to inherit a proof for bytes it has not run.
  The pin is
  kept honest by `dev/test-engine-pin.py`, which states the release **itself** and compares the row
  to the published manifest field by field: the anchor may not come from the value it verifies, or a
  wrong `home` is caught only by accident of chasing itself (the first version did exactly that, and
  a mutation on a silent field is what found it). The occurrences of `v1.1.0` that record
  measurements — `inlet.rs:24`, `manifest.rs:830`, `real_engine.rs:21`, `slots.rs:26`,
  `slot_cache.rs:158`, `solve.rs:24`, `menu.rs:132` — are **history and stay**: rewriting them would
  be a new lie about what was measured.
- **`Stopping` — decided; implemented in `6efec90`, corrections in `5ffcb11`**, reviewed hostile
  (FIT CON CORREZIONI). A stop
  in flight is an explicit state that suppresses the door's re-raise, makes `brain_state` report the
  draining state instead of `Running`, and is the only state in which the worker may write `Stopped`.
  It is a state and not a flag because the outcome used to depend on two actors writing the same
  field: a race by construction, which narrowing the window does not close. `brain_stop` stays
  non-blocking, and the drain is declared **by its caller, before the command is queued** — that
  ordering is the window, closed from its first instant. The rule that keeps it true lives in
  `crates/kalsa-supervisor/src/drain.rs`: while the state reads `Stopping`, the only write that
  lands is the drain's own end. Three corrections came back from the review and are carried, not
  dropped: the `Models` page had its **own** copy of the state type, so the real DTO fell into a
  blind `default` and told the owner it could not tell what the computer was running, for as long as
  the teardown took — the duplicate type is gone and the union is now exhaustive at compile time;
  the desk's square was written but never pinned, so deleting it left every suite green; and the
  panic path — a worker that dies mid-drain leaves `Stopping` standing, since the guard refuses
  every later write — is **declared** in `drain.rs` rather than left tacit (it wedged as `Running`
  before this state, so it is not a regression, and nothing reachable panics there today).
- **The `Stopped` invariant — decided; implemented in `f1df191`, `ae78761`, `f9d8861`; closed in
  `f7ac758`.** `Stopped`
  means the door does not answer **and** the process is not there; when either half is unknowable,
  the state says so. The witnesses are not interchangeable, and that distinction is the whole
  design (`crates/kalsa-supervisor/src/presence.rs`): a **reaped child** is the kernel's own proof
  about OUR process, so the port is **not a veto** — if something answers it afterwards, `Stopped`
  is still true of our engine and what answers is a **suspicion to record**; a **known pid** alive
  after both signals is a survivor whatever the port says; a known pid now dead is corroborated by
  the port (§9's "pid AND port" — a held port does not prove it is not our engine); and an
  **adopted-blind** engine gets `Stopped` only after the probe FAILS, plus the suspicion record,
  because the port is then the only witness there is. Nothing else closes a drain: the alternative
  end is `StopUnconfirmed` with the measures of what could not be proved (pid, port, what was
  tried, what the port answered), and the drain's write policy admits exactly those two ends —
  neither of which is a lie about a process that may still hold the port. The old swallow is gone:
  `child::Termination` reports whether the walk needed a grace, needed SIGKILL, or never saw the
  process leave, and a kill that fails is a datum rather than a `let _ =`. **Escalation is not
  failure** — a wedged child killed after its grace ends correctly — and the grace expiry is
  logged, not punished.
  **Declared, not hidden**, and each is a price not an oversight: the `Survived` arm of
  `terminate_pid` needs a process our SIGKILL does not take (EPERM — somebody else's), so it is
  unreachable in a test and the reachable survivor is the adopted-pid case; `Watch::state` has no
  worker handle and can therefore still read a stale `Stopping`; and the integration test of the
  record's recovery still binds a real socket (a port this test never drops, so no race) while the
  RULE is asserted against a scripted probe — scripting that last one needs the seam exported at
  the worker level, which is the declared next step.
  **One flake, chased down rather than declared away** (`f7ac758`): a src-tauri test failed once in
  a combined verification of twenty-one runs and the `awk`-summed pipe ate its name. The reviewer
  reproduced the class — a suite that fails 5 times in 16 under load — and named it: a test that
  does `bind → drop(listener) → connect` and **demands REFUSED** is a test whose fixture lies. At
  rest the kernel refuses every time (2000 of 2000 in the reviewer's probe); under socket churn the
  window opens and the connect lands on a dying or reassigned state, so the probe answers
  `There{Silent}` and the test sees a ghost. It was never a production defect — when the port
  really answers, refusing `Stopped` is exactly right — and it is closed by making the probe an
  **argument**: `stop()` and the next start's recovery take a `presence::Probe`, production passes
  the real one, the policy tests pass a scripted one, and the refusal's classification is tested as
  a pure function of an `io::Error`. Twelve suite runs under the same eight-thread churn that broke
  it before are green, and so are sixteen more run by the orchestrator on the same harness. **A
  test that fails once in twenty-two is a test we cannot read until someone makes it fail on
  purpose.**
- **The measurement's floor is declared, not denied.** The concurrency run was taken on a machine
  with the agent harness on it (`loadavg` ~4–6), because nobody runs two devices on an idle Mac. A
  constant floor weighs on every arm and cancels in the comparison — the bracket is what proves it
  did not drift — and what it moves is the absolute rate, not the comparison. The artifact states
  both.
- **Debt, paid (`fe14e78`, closed in `34de14f`):** `--max-load`, `platform`, `backend` and the
  harness's own `attempts_max` are fields of `dev/results/concurrency-two-devices/results.json`, and
  the artifact was regenerated by the
  harness rather than enriched by hand, because the previous run's raw evidence was gone
  (`raw_log_committed: false`) and a hand-entered `backend` would be an assertion in a field's
  clothing. `platform` and `backend` are **derived**, not stated: the executed binary's sha256 is
  matched against `artifacts[].exe_sha256` of the published manifest (v1.1.1; the manifest's own
  sha256 and fetch instant are recorded too), and the derivation has three states that are never
  conflated — `matched`; `not-the-release`, which carries the label `fork build, not the release`
  with `platform` from the host and `backend: null`; and `unverified`, which a network failure
  produces and `not-the-release` never is. **The review found the taxonomy's real hole, and the
  closure is the interesting half:** a manifest that had been READ but published no usable
  `exe_sha256` — missing, empty, `null`, an integer, or even uppercase hex — was accused of being a
  fork build. "The release does not publish the hash" is not "this build is not the release"; weak
  evidence was being read as a verdict, which is the one class the original mutation could not
  catch, because that mutation tested a match that was too WIDE. `not-the-release` now requires at
  least one well-formed 64-hex hash published and no row matching it; degenerate manifests, a
  missing binary hash, and two rows carrying the same executed hash are all `unverified`, each with
  a machine-readable `reason_code`. The check that keeps this honest is
  `dev/test-release-provenance.py`, and it can go red for the reason it declares — the always-true
  match leaves case (a) red, and the count in `fe14e78`'s message said 8 where the code killed 5
  (8 was the number of checks that PASSED); `34de14f` carries the correction. **A field that lives
  in prose is a field the next reader has to trust** — that sentence stands, and now there is no
  such field in this artifact. **One more blindness, found next door and closed (`17e016b`):** the
  panel's own check compared the constant to the artifact at the precision it DISPLAYS (two
  decimals), so any drift under 0.005 on any of the three ratios stayed green — the historical red
  arrived only because the aggregate happened to move 0.0068. The comparison is now exact at the
  constant's four decimals, with the displayed rounding as a separate check. Declared rather than
  fixed: a manifest digest padded with whitespace is accepted after `strip()` while a `0x`-prefixed
  one is not — an inconsistency that can only push toward `unverified`, never toward the fork
  accusation, and changing it would drift the artifact's `script_sha256` and buy a fourth
  measurement for nothing.
