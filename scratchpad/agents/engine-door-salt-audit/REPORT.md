# Engine door / salt audit - hostile cross-check

Verifier: independent re-read of the engine source; read-only (no edits, no commits, no pushes, no tags).
Date of read: this session. Scope: `/Users/marco/Projects/kalsallama`, the six findings, then the addendum A/B/C.

## Basis and line-number discipline

- `main` = `61db879b8` ("governor : clear the plugged idle baseline on unplug (defect 5.2, engine)").
- Annotated tag `kalsa-server-v1.1.0` object = `c105c2182`; peeled commit = `2a290390d`.
- `git diff 2a290390d main -- tools/server` is **empty** (no output). The only files differing between the two commits are `src/llama-ext.h`, `src/llama-governor-policy.cpp`, `src/llama-governor-runtime.cpp`, `tests/test-governor-v0-turns.cpp`, `tests/test-governor-v02-router.cpp` - none of them under `tools/server`.
- Therefore `tools/server` is byte-identical on `main` and on the tag, and every line number below is valid for both. I read from **`main` = `61db879b8`** (the checkout). I say "tag" only where a line is inside the tag line range cited by the finding.
- Every claim below carries the quoted source line it rests on. Where the finding's line number is wrong, I give the right one.

---

## Claim 1 - the context shift silently un-salts a slot

**VERDICT: REAL (a bug). The finding's `slot.prompt.clear()` line is exact; its block range is wrong.**

Evidence (all `tools/server/server-context.cpp`, `main` = `61db879b8`):

- Shift block starts at `:3167` `// Shift context` and runs to `:3203` `slot.truncated = true;` (the finding says `3182-3201`; the block is **3167-3203**).
- `:3184` `slot.mem.seq_rm (slot.id, n_keep            , n_keep + n_discard);`
- `:3185` `slot.mem.seq_add(slot.id, n_keep + n_discard, slot.prompt.tokens.pos_next(), -n_discard);`
- `:3199` `slot.prompt.clear();` (exact, as the finding says)
- `:3200` `slot.prompt.tokens.insert(new_tokens);` - tokens are re-inserted, `cache_salt` is not re-stamped. `grep -n cache_salt server-context.cpp` has no hit between `:1588` and `:3418`, so nothing in the shift block restores the namespace.
- `:580` of `tools/server/server-task.h`: `cache_salt.clear();`, inside `server_prompt::clear()` (`:577-581`). So `:3199` clears the salt.
- Next request from the same device: `:1588-1591` (`if (slot.prompt.cache_salt != task.params.cache_salt) { ... continue; }`) skips the now-empty-salt slot; `:1616` `const float f_keep = (f_sim_best*task.tokens.size()) / ret->prompt.tokens.size();` yields 0; `:1624-1625` `if (f_keep < 0.5f) { update_cache = true; }`; `:1665` `ret->prompt_save(*prompt_cache);` stores the shifted state under the EMPTY salt; then `:3418-3421`:

  ```
  3418    if (slot.prompt.cache_salt != slot.task->params.cache_salt) {
  3419        SLT_TRC(slot, "%s", "different cache namespace - clearing cached prompt\n");
  3420        slot.prompt_clear();
  3421        slot.prompt.cache_salt = slot.task->params.cache_salt;
  ```

**Consequence (one sentence).** After one shift the slot sits in the empty namespace, so the same device's next request is treated as a foreign namespace and the shifted state (including the surviving `n_keep` prefix) is erased at `:3420`, never reusable.

**THE FIX.** Right behaviour is **re-stamp**: a context shift truncates the same conversation, it is not a namespace change. Add after `:3199` the same statement the launch path uses:

```cpp
slot.prompt.cache_salt = slot.task->params.cache_salt;
```

The salt is already in hand there (`slot.task->params.cache_salt`, assigned in the request handler at `:4631`). Treating the shift as a deliberate namespace change is the wrong choice: it would destroy the same device's own prefix on every shift, which is exactly the observed bug.

**THE COST.** One-line change.

---

## Claim 2 - the restore path wipes the salt, and never runs when a slot is named

**VERDICT: REAL for the salt wipe (`:2868`). The sub-claim that the update_cache branch "is false whenever id_slot is given" is NOT REAL.**

Evidence:

(a) The file-restore handler, `tools/server/server-context.cpp`, `case SERVER_TASK_TYPE_SLOT_RESTORE:` at `:2823`:

- `:2868` `slot->prompt.clear();` (exact, as the finding says)
- `:2869` `slot->prompt.tokens = std::move(restored);`
- `:2873` `nread_ckpt = load_slot_checkpoints(filepath, nread, *slot);`
- No `cache_salt` assignment anywhere in the handler (`:2823-2888`). `slot_action` itself has no salt field: `tools/server/server-task.h:168-172` is only `{ int id_slot; std::string filename; std::string filepath; }`.
- So the restored file is un-salted, and the next salted request hits `:3418-3420` and wipes it. This is exactly the killer for the owner's disk design (see A).

(b) Call-site claim: `grep -rn "prompt_load(" tools/server/*.cpp` returns only the definition at `:330-331` and the single call at `:1667`:

```
1667    if (!ret->prompt_load(*prompt_cache, task.tokens, task.params.cache_salt)) {
1668        ret->prompt_clear();
```

So "the only prompt-cache restore call site is `:1667`" is TRUE.

But "inside the update_cache branch (`:1654-1674`), **which is false whenever id_slot is given** (`:1565-1570`)" is **false**. `get_available_slot` sets `update_cache` in the similarity branch as well as the LRU branch:

- `:1562` `bool update_cache = false;`
- by-id branch `:1565-1570` does not set it;
- similarity branch `:1573-1625`, and `:1616` + `:1624-1625` set `update_cache = true` when `f_keep < 0.5f`, even when `ret` came from the by-id branch (`:1615` `if (ret != nullptr)` is true because `ret` is already set). A salt-mismatched by-id slot is skipped by `:1588-1591`, leaving `f_sim_best = 0`, so `f_keep = 0 < 0.5` and `update_cache` becomes true.
- With the engine default `slot_prompt_similarity = 0.1f` (`common/common.h:696`) and the app passing no `--slot-prompt-similarity`, this branch runs. The LRU branch at `:1631-1652` is indeed skipped for a by-id request (`:1631` `if (ret == nullptr)`), but it is not the only thing that sets the flag.

**Consequence (one sentence).** Disk persistence is indeed unusable for salted traffic, but because the restore clears the salt at `:2868`, not because the cache branch is skipped; the RAM save/restore at `:1665-1667` does run for named slots.

**THE FIX.** Fix (a) only: stamp the namespace after `:2868` from the caller's salt (see addendum A, option ii). Do not "fix" (b); instead make the save/load intent explicit rather than dependent on the `:1616-1625` coincidence (see claim 6).

**THE COST.** (a) small function (thread the salt from the `/slots` route into `slot_action` and stamp it). (b) none.

---

## Claim 3 - a mismatched `prompt_load` returns true without loading

**VERDICT: REAL as a code fact. The mismatch branch is deliberate, but the boolean's contract is ambiguous, and the caller's belief is wrong. Today it is benign by accident.**

Evidence (`tools/server/server-task.cpp`, `main` = `61db879b8`):

- `:1798` `bool server_prompt_cache::load(server_prompt & prompt, const server_tokens & tokens_new, llama_context * ctx_tgt, llama_context * ctx_dft, int32_t id_slot, const std::string & cache_salt) {`
- `:1802` `const bool cache_salt_match = prompt.cache_salt == cache_salt;`
- `:1804-1805` on mismatch `f_keep_best = -1.0f`, `f_sim_best = 0.0f` (the comment at `:1801` says "a prompt from another cache namespace is not reusable, treat it like an empty slot").
- `:1813-1816` states with another salt are skipped, so `it_best` stays `states.end()`.
- `:1838` `if (it_best != states.end()) {` (exact, as the finding says) guards the whole load/restore block.
- `:1880` `return true;` (exact) runs unconditionally, so a mismatched load reports success and touches nothing.
- Caller `tools/server/server-context.cpp:1667-1669`: `if (!ret->prompt_load(*prompt_cache, task.tokens, task.params.cache_salt)) { ret->prompt_clear(); }`.

**What the caller then believes.** That the slot's `prompt` is valid for `task.params.cache_salt`. That belief is wrong: the load did nothing, so the slot still holds its old prompt with its old salt and tokens.

**Does it matter.** Not today. The very next step for a launched completion is `tools/server/server-context.cpp:3418-3421`, which re-checks the salt and either clears the stale prompt (namespace differs) or keeps it because the namespace matches - and in the matching case keeping the resident prompt is the desired behaviour, not a leak. So the wrong belief is masked by a second check. It becomes a real bug only if anyone relaxes `:3418-3421`, and it makes the branch at `:1667-1668` dead code in the mismatch case it was written for.

**THE FIX.** Make the contract honest: either have `load()` clear `prompt` on a namespace mismatch so "true means prompt is valid for `cache_salt`", or return a tri-state (loaded / no-op / failed) and let `:1667` decide. Alternatively drop the fallback at `:1668` and rely on `:3418-3421`, documenting that the RAM cache is a lookup, not an erase.

**THE COST.** Small function (a tri-state or an explicit clear). No urgency on its own; ride it along with claim 6.

---

## Claim 4 - eviction is FIFO across salts

**VERDICT: REAL.**

Evidence (`tools/server/server-task.cpp`, `main` = `61db879b8`):

- `:1744-1752` is the only salt-scoped removal, and it only drops entries already contained in the same namespace:

```
1745        if (it->prompt.cache_salt == prompt.cache_salt && len == (int) it->prompt.tokens.size()) {
1746            SRV_TRC(" - removing obsolete cached prompt with length %d\n", len);
1747
1748            it = states.erase(it);
```

- The make-room loop is salt-blind. The finding cites `1756-1761`; the actual loop is `1755-1760`:

```
1755        // make room before allocating the new vectors to avoid breaching the limit
1756        while (!states.empty() && size() + state_size_new > limit_size) {
1757            SRV_WRN(" - making room for prompt cache entry, removing oldest entry (size = %.3f MiB)\n",
1758                    states.front().size() / (1024.0 * 1024.0));
1759
1760            states.pop_front();
1761        }
```

- `server_prompt_cache::update()` is also salt-blind, and the finding's range `:1885-1904` matches: `:1885-1889` pops the oldest entry on the byte limit and `:1896-1903` pops it on the token limit.

**Consequence (one sentence).** A busy device's saves can evict a sleeping device's only recoverable RAM copy of its conversation, because the front of the list is popped regardless of whose namespace it belongs to.

**Is a salt-scoped reservation warranted.** For the current shared-slot regime, yes: with two salts on one slot, RAM is the only cross-namespace copy, so losing it loses the conversation (the claim is right for that regime). For the owner's chosen design, no: the disk file is the store of record, so a RAM eviction costs one re-restore, not the conversation. The app already knows the roof is the constraint - `kalsa-brain/crates/kalsa-launch/src/args.rs:112` says "The prompt-cache roof is sized for one warm conversation ... with N slots the roof must hold N histories or the warm-start promise stops holding" - and it sizes `--cache-ram` out of the budget (`argv.rs:92-95`).

**THE FIX.** For the target design: none required. If a guarantee is wanted anyway, make the budget per namespace (or pin the most recent entry per salt) so one device cannot evict another's last copy.

**THE COST.** Needs a design decision; a per-namespace budget is a small function.

---

## Claim 5 - `get_slot_by_id` wraps out of range

**VERDICT: REAL as code; not reachable through the door. Refuse, do not wrap.**

Evidence (`tools/server/server-context.cpp`, `main` = `61db879b8`):

- `:1532-1543` is the function (exact range, as the finding says):

```
1532    server_slot * get_slot_by_id(int id_slot) {
1533        // note: allow id_slot to be out of bounds (wrap around)
1534        id_slot = id_slot % slots.size();
```

The modulo is at `:1534` and the comment at `:1533` states the intent. `id_slot` is `int`, so a negative value would wrap to a negative or odd index by C++ remainder rules; the header parser already rejects negative and overflowing values (`get_slot_from_header`, `:4534-4560`: `if (parsed.ec != std::errc() || parsed.ptr != last || slot < 0) return -1;`), and a body `id_slot` is parsed by `json_value(data, "id_slot", -1)` at `:4632`.

**Reachability - it is not reachable through the door.**

- The door seals the slot itself and strips any client-supplied header: `kalsa-brain/crates/kalsa-door/src/request.rs:223` refuses a forwarded header whose lowercase name is `x-kalsa-cache-salt` (and the test at `:447` asserts neither `x-kalsa-slot` nor `x-kalsa-cache-salt` survives from the client). The value is written by `SealedHead::seal(slot, salt)` at `request.rs:55-59`, i.e. the door's own table decides it (`slots.rs:185` `cache_salt(device)`).
- The door refuses capacity beyond the engine's slot count rather than let the engine wrap: `kalsa-brain/crates/kalsa-launch/src/args.rs:326-328` documents `parallel` as "the door's capacity: a device beyond this many has no engine slot, and the door refuses it rather than let the engine wrap `id_slot` onto somebody else's cache".
- The door refuses `/slots/*` to guests: `kalsa-brain/crates/kalsa-door/src/slot_routes.rs:38` (`if path == b"/slots" || path.starts_with(b"/slots/")`).
- The app also runs with one slot today: `kalsa-brain/crates/kalsa-launch/src/args.rs:127` `pub const DEFAULT_PARALLEL: u32 = 1;`, rendered as `--parallel` at `argv.rs:86`. With `slots.size() == 1`, `id_slot % 1 == 0` for every input, so even a bad id cannot land on "another device's slot" - there is only one.

So the finding's consequence ("a wrapped id would land a request on ANOTHER device's slot, where the salt check then erases that device's conversation") needs `slots.size() >= 2` **and** a caller able to set `id_slot` to `>= slots.size()`. A guest cannot set it; the door does not; the engine's own completion handler clamps through the header/body path. It is a defence-in-depth gap, not a live door path.

**Consequence (one sentence).** If any other caller (a future engine-side path, a multi-slot build with `parallel > 1`, or a direct loopback client) ever passes an out-of-range id, the modulo silently lands it on a different slot's cache, and the salt check at `:3418-3420` then erases that slot's incumbent conversation instead of the request erroring.

**THE FIX (refuse, not wrap).** Replace the modulo in `get_slot_by_id` with a bounds check:

```cpp
if (id_slot < 0 || id_slot >= (int) slots.size()) {
    return nullptr;
}
```

Every caller already handles `nullptr`: the `/slots` save/restore/erase handlers answer `"Invalid slot ID"` (`:2769-2771`, `:2843-2845`, `:2908-2910`), and the completion path treats it as no slot and defers (`process_tasks`, `:2606-2610`). Refusing is also the door's own posture (`args.rs:326-328`), so the engine should not be more permissive than the door that fronts it. The engine's own comments call the salt a namespace selector, not authentication (`:4503-4505`, `:4529-4531`), so the engine cannot rely on the salt check to convert a misroute into an error - there is no error, only a wipe.

**THE COST.** One-line change (plus a note that the wrap was deliberate, so the removal is a decision, not a slip).

---

## Claim 6 - the measured case: two salts on one slot

**VERDICT: PARTLY REAL. The observed facts are real; the stated mechanism ("`update_cache = false` for a by-id request, so the incumbent is never copied to the RAM prompt cache") is NOT REAL under the engine defaults or the app's launch.**

Evidence (`tools/server/server-context.cpp`, `main` = `61db879b8`, plus `server-task.cpp`):

Real parts:

- Cross-reading is impossible: the similarity loop skips a slot with another namespace, `:1588-1591` (`if (slot.prompt.cache_salt != task.params.cache_salt) { ... continue; }`), and `prompt_load` skips other-salt states (`server-task.cpp:1813-1816`). The second device prefills from zero, so its `timings.cache_n == 0`. REAL.
- The incumbent's resident KV is destroyed: `launch_slot_with_task` runs

```
3418    if (slot.prompt.cache_salt != slot.task->params.cache_salt) {
3419        SLT_TRC(slot, "%s", "different cache namespace - clearing cached prompt\n");
3420        slot.prompt_clear();
3421        slot.prompt.cache_salt = slot.task->params.cache_salt;
```

  so `:3420` removes the incumbent's sequence from the slot. REAL.
- "the LRU save at `:1631-1652` never runs": TRUE, because the LRU branch is guarded by `:1631` `if (ret == nullptr) {` and `ret` is already set by the by-id branch `:1565-1570`. Correct but irrelevant (see below).
- "the idle-save loop at `:2640-2656` skips a busy slot": the range is exact, and the loop guards on `:2642` `if (!slot.is_processing()) {`, so the pass that launches the newcomer skips the now-busy incumbent slot. TRUE for that pass; the incumbent was already saved earlier (below).

NOT REAL - the mechanism:

- `update_cache` is **not** false for a by-id request. The similarity branch runs whenever `slot_prompt_similarity != 0.0f` (`:1573`), and its default is `0.1f` (`common/common.h:696` `float slot_prompt_similarity = 0.1f;`); the app renders no `--slot-prompt-similarity` (`kalsa-brain/crates/kalsa-launch/src/argv.rs` has no such flag), so the default applies.
- In the cross-salt case the loop skips the by-id slot at `:1588-1591`, leaving `f_sim_best = 0` (`:1574`), but `:1615` `if (ret != nullptr) {` is true because `ret` came from by-id, so `:1616` `const float f_keep = (f_sim_best*task.tokens.size()) / ret->prompt.tokens.size();` = `0 / N` = 0, and `:1624-1625` `if (f_keep < 0.5f) { update_cache = true; }` fires.
- Then `:1655-1665` runs: `update_cache = update_cache && prompt_cache;` (prompt cache is non-null by default, `common/common.h:633` `int32_t cache_ram_mib = 8192;`, and the app renders a non-zero `--cache-ram`, `argv.rs:92-95`), `update_cache = update_cache && task.type == SERVER_TASK_TYPE_COMPLETION;` (`:1658`), and `:1665` `ret->prompt_save(*prompt_cache);` copies the incumbent (tokens, checkpoints, KV data, and its `cache_salt`, `server-task.cpp:1785-1789`) into the RAM cache **before** `:3420` clears the slot.
- So "never copied to the RAM prompt cache" is false unless `--slot-prompt-similarity 0` or `--cache-ram 0` is passed. Neither is passed by the app.
- `:1667` `prompt_load` for the *newcomer's* salt then returns true without loading (see claim 3); the slot keeps the incumbent's state until `:3420` wipes it.

**Consequence (one sentence).** A cross-salt request on a shared slot destroys the incumbent's resident KV, but under the app's actual flags it is saved to the RAM cache first (via a side effect of the `f_keep < 0.5` check), so on return the incumbent can be restored; the finding's "never copied" would aim the fix at the wrong place and would miss that the current rescue depends on an accident.

**The test reading.** `tools/server/tests/unit/test_cache_salt.py:153-162` is exactly as the finding describes: it drives `SALT_A` to slot 0 (`,:153-154`), `SALT_A` to slot 1 so slot 0 is idle and saved (`,:156-158`), then `SALT_B` to slot 0 and asserts only `res.body["timings"]["cache_n"] == 0` (`,:161-162`). Nothing asserts that the first device's state survives. The test is right to assert the isolation; it is incomplete about the survivor.

**THE FIX.**

1. Make the save explicit instead of a by-product. Either set `update_cache = true` on the by-id path whenever `slot.prompt.cache_salt != task.params.cache_salt` (and the slot has tokens), or drop the `f_keep < 0.5` accident and state the rule: a namespace switch always saves the incumbent first. The same applies to the disk design: a chat switch must save before the restore.
2. Add the assertion that catches the incumbent's loss to `test_cache_salt.py` after `:162`:

```python
res = _complete(server, SALT_A, prompt=PROMPT, id_slot=0)
assert res.body["timings"]["cache_n"] > 0
```

The incumbent must be able to come back. Under today's code this passes (the idle-save at `:2645` and the `:1625` save both feed it), which is the point: the assertion is the one that detects the loss, and it would fail the moment the save path regresses or someone disables `slot_prompt_similarity`/`cache_ram`. A test that only asserts the newcomer's `cache_n == 0` cannot see a lost incumbent.

**THE COST.** One test assertion plus a small function to make the save path explicit (or drop the `f_keep` accident); no redesign.

---

# Addendum A - which salt fix is correct, and is it one fix or two

**VERDICT: choose (ii) at the restore, and the same rule (stamp the namespace from the caller) at the shift. They are TWO different changes, because the two sites get the salt from different places.**

## The decision, site by site

**Restore (`server-context.cpp:2868`): choose (ii), the caller supplies the expected salt.**

The restore has no salt in hand today, which is why it cannot simply re-stamp itself. `slot_action` carries only the slot and the file:

```
168        struct slot_action {
169            int id_slot;
170            std::string filename;
171            std::string filepath;
172        };
```

The `/slots` route (`post_slots`, `:5086-5115`) reads the slot header but never reads the salt header: `:5105` `const int32_t id_slot_header = get_slot_from_header(req);`, and the salt reader `get_cache_salt` (`:4503-4522`) is only called for completion tasks (`:4578` `const std::string cache_salt = get_cache_salt(req);`). So the clean fix is to call `get_cache_salt(req)` in `post_slots`, carry it in `slot_action` (a new `std::string cache_salt;` field), and after `:2868` set `slot->prompt.cache_salt = task.slot_action.cache_salt;` - the same statement shape as `:3421`.

Why (ii) and not (i) or (iii):

- The door already owns the value and already sends it. `kalsa-brain/crates/kalsa-door/src/request.rs:55-59` seals the request with `x-kalsa-cache-salt` from the door's own table (`slots.rs:185` `cache_salt(device)`), and the client cannot supply one (`request.rs:223`). So the caller-provided salt is exactly the device identity the owner wants the restored file to carry, with no new authority.
- (i) writing the salt into the file is worse on three counts: it puts a namespace selector on disk, against the hygiene the fork tests assert (`test_cache_salt.py:169-171` `assert SALT_A not in log` / `assert SALT_B not in log`); it does not help the shift, which has no file; and it is not always even possible, because the server-owned appendix is written only when the slot has checkpoints - `server-context.cpp:2475-2477` `if (slot.prompt.checkpoints.empty()) { return 0; }` - so a checkpoint-less save is pure upstream payload with no server field to extend.
- (iii) treating a restore as a deliberate namespace change is the bug, not a fix: the restored file is the same device's other chat, so it belongs to that device's namespace. Making the caller re-salt would mean the caller must then never send the device salt, which contradicts the door's one-salt-per-device design.

**Context shift (`:3199`): choose the same rule, but the salt is already in hand.**

```
3199                    slot.prompt.clear();
3200                    slot.prompt.tokens.insert(new_tokens);
```

The shift runs inside the request that is already being served, and that request's salt is on the task: `:4631` `task.params.cache_salt = cache_salt;` (and its slot counterpart is used at `:3421`). So the fix is a one-liner after `:3199`: `slot.prompt.cache_salt = slot.task->params.cache_salt;`. (iii) is wrong here for the same reason as at the restore: a shift truncates the same conversation, it does not change whose it is.

## Does one fix cover both?

**No - two mechanisms, two changes.** The rule is one rule (the namespace comes from the caller, never from empty and never from the file), but the value arrives by different routes:

- At `:3199` the serving task already holds the salt (`slot.task->params.cache_salt`, set at `:4631`), so the change is one assignment next to `:3199`.
- At `:2868` the slot action holds no salt (`server-task.h:168-172`) and the route does not read the header (`:5105` reads only `get_slot_from_header`), so the change is plumbing: read `get_cache_salt(req)` in `post_slots`, add a field to `slot_action`, set the field in `handle_slots_restore` (`:5649-5683`), and stamp it after `:2868`.

They are independent: fixing only the shift leaves the restore feature dead; fixing only the restore leaves long conversations losing their prefix on every shift.

**Consequence (one sentence).** Without the restore stamp the owner's whole disk-switch design is dead on arrival (the first salted request after a restore wipes the just-restored state at `:3418-3420`), and without the shift stamp any conversation that reaches a context shift silently loses namespace and prefix on its next request.

**THE FIX.** (ii): thread the salt from the `/slots` request header into `slot_action` and stamp `slot->prompt.cache_salt` after `:2868`; and re-stamp `slot.prompt.cache_salt = slot.task->params.cache_salt;` after `:3199`. Optionally make the namespace source explicit in one place (a helper) so the two sites cannot drift.

**THE COST.** Two changes: the shift is a one-line change; the restore is a small function (a header read, one struct field, one assignment). Together: a small function, no redesign.

---

# Addendum B - can a save file be attributed to its device

**VERDICT: NO. The file carries no device id, no salt, no checksum and no server schema stamp. A mis-scoped restore cannot be detected today if the file is well formed and the model matches; it loads silently into the wrong namespace. Corruption is caught, foreignness is not.**

## What the file actually carries

The file is two layers, and neither layer names an owner.

Layer 1, the upstream sequence-state payload (`src/llama-context.cpp`, `main` = `61db879b8`), written by `state_seq_save_file` at `:3297-3313`:

```
3299        file.write_u32(LLAMA_STATE_SEQ_MAGIC);
3300        file.write_u32(LLAMA_STATE_SEQ_VERSION);
3301
3302        // save the prompt
3303        file.write_u32((uint32_t) n_token_count);
3304        file.write_raw(tokens, sizeof(llama_token) * n_token_count);
3305
3306        // save the context state using stream saving
3307        llama_io_write_file io(&file);
3308        state_seq_write_data(io, seq_id, 0);
```

That is: magic, version, token count, tokens, then the memory module's own bytes (`state_seq_write_data` at `:3339-3345` just calls `memory->state_write(io, seq_id, 0)`). Notably the sequence path writes **no** model identity either - the arch string is written only by the non-sequence `state_write_data` (`:3315-3337`), which this path does not use. There is no CRC, no length-based checksum, no server field.

Layer 2, the server appendix, written only when the slot has checkpoints (`tools/server/server-context.cpp`), `save_slot_checkpoints` at `:2474-2507`:

```
2394    static constexpr uint32_t SLOT_CKPT_MAGIC   = 0x504b4353; // "SCKP"
2395    static constexpr uint32_t SLOT_CKPT_VERSION = 1;
2397    static constexpr uint32_t SLOT_CKPT_MAX_RECORDS = 1024;
```

and the records it writes are `n_tokens`, `pos_min`, `pos_max`, `data_tgt`, `data_dft`, `data_spec` (`:2494-2504`). No salt, no device id, no owner, no chat id.

Crucially the appendix is optional: `:2475-2477` `if (slot.prompt.checkpoints.empty()) { return 0; }`, and on load `:2538-2540` `if (remaining == 0) { return 0; // the state payload ends the file: a genuine legacy save }`. So a save with no checkpoints is pure layer 1 - there is not even a server-owned field to extend in that case.

## Can a mis-scoped restore be detected today

No. The checks on the restore path (`:2841-2858`) are all format or size checks, none is an identity check:

- `:2846-2850` `nread = llama_state_seq_load_file(ctx_tgt, filepath.c_str(), slot->id, nullptr, 0, &n_packed); ... if (nread == 0) { throw std::runtime_error("No available space in KV cache or invalid slot save file"); }` - this fires on a bad magic/version, a truncated payload, or a payload whose size does not fit the KV. It does not know whose file it is.
- `:2854-2856` `if (restored.size() > (size_t) slot->n_ctx) { throw std::runtime_error("Restored prompt does not fit in the slot context"); }` - a size check.
- `:2858` `if (!restored.validate(ctx_tgt)) { throw std::runtime_error("Invalid tokens in slot save file"); }` - `server_tokens::validate` (`tools/server/server-common.cpp:755-789`) only checks each token id is in `[0, n_vocab)` and that media placeholders are consistent. Tokens from another device on the same model pass.
- The appendix loader `:2541-2545` checks `SCKP` magic/version/count and `:2569-2571` rejects trailing bytes - again format, not identity.

So the two outcomes are:

- **Corrupted or truncated file:** usually FAILS, and fails cleanly. A wrong `LLAMA_STATE_SEQ_MAGIC`/`VERSION` or an unreadable payload makes `llama_state_seq_load_file` return 0 and the handler throws the "invalid slot save file" error; a corrupted appendix after a good payload throws `malformed slot save file: unknown data after the state payload` (`,:2541-2543`); a well-formed but wrong-size payload is caught by the state reader. The slot is then cleared on the error path (`:2875` `slot->prompt_clear();`) and an error is returned.
- **Foreign but well formed file (same model, another device):** SILENTLY LOADS. Nothing on the path compares the file to who is asking. `slot->prompt.tokens = std::move(restored)` (`:2869`) and the KV is read straight into `slot->id` (`:2844`), so the restoring device's slot adopts the foreign conversation, and the salt is then set to the request's own (or empty) namespace - the exact leak the design exists to prevent. Different model or different KV geometry would be caught incidentally by the size/geometry checks, but that is a side effect, not attribution.

## The cheapest addition that makes it detectable

Add one server-owned record that is **always** written (unlike `SCKP`, which is skipped without checkpoints), and check it on restore. Two viable shapes:

- A small header before the upstream payload, or a trailer after it: magic + version + `device_id` (or a hash of the door's device id) + a hash of the salt (e.g. SHA-256), plus the existing `SCKP` appendix for checkpoints. On restore, recompute the requester's salt hash and refuse on mismatch. Storing the **hash**, not the raw salt, keeps the namespace off disk and keeps the "salt never appears" property.
- If the door is the only writer and may be trusted, binding filename to device in the door is already done (`kalsa-brain/crates/kalsa-door/src/slot_routes.rs:38` refuses `/slots/*` to guests), but that is app-side: it leaves the engine unable to detect a mis-scoped restore, which is the owner's absolute requirement. So the engine-side stamp is the cheapest thing that actually makes the file checkable.

This changes the file format, so it needs a version and a decision on legacy files: a file with no stamp should be treated as untrusted for a salted slot (refuse), or accepted only for the un-salted namespace.

**Consequence (one sentence).** Today a same-model foreign save file restores silently into the requesting device's slot, because the only checks are format and size and none of them asks whom the file belongs to.

**THE FIX.** Always write a server-owned stamp (magic, version, owner + salt hash) with the save, and compare it on restore, refusing on mismatch; extend the `SCKP` appendix rather than rely on it, since it is absent for checkpoint-less saves (`:2475-2477`).

**THE COST.** Small function (write the stamp, compare on restore) plus a format-version decision for legacy files - needs a design decision on backward compatibility.

---

# Addendum C - what the file contains, and is a save legal mid-generation

**VERDICT: the file holds the sequence tokens, the full memory/KV payload, and (only if present) the server's checkpoint appendix. It carries no namespace, no owner, no checksum and no model identity. A save is LEGAL at any time but NEVER runs mid-generation: the route defers the task until the slot is idle, so the generation is untouched and the snapshot is the later, post-idle state.**

## Part 1 - what the save file holds today

Written by the save handler (`tools/server/server-context.cpp`, `main` = `61db879b8`), `case SERVER_TASK_TYPE_SLOT_SAVE:` at `:2749`, into a fresh exclusive temp file (`create_slot_save_temp`, `:2440-2456`), then renamed over the target (`:2798-2802`).

Layer 1, the upstream sequence state, written by `llama_state_seq_save_file` (`:2787-2790`), implemented in `src/llama-context.cpp:3297-3313`:

- `LLAMA_STATE_SEQ_MAGIC` (u32)
- `LLAMA_STATE_SEQ_VERSION` (u32)
- `n_token_count` (u32)
- the tokens: the server serialises `slot->prompt.tokens` first (`:2774` `packed = slot->prompt.tokens.serialize();`) and writes that array
- the memory payload: `state_seq_write_data(io, seq_id, 0)` (`:3339-3345`), which is `memory->state_write(io, seq_id, 0)` - the KV (or recurrent) bytes for that sequence, in the memory module's own format.

No checksum, no CRC, no length hash, and - on this sequence path - no model identity: the arch string is written only by the non-sequence `state_write_data` (`:3315-3337`), which `state_seq_save_file` does not call.

Layer 2, the server's checkpoint appendix, appended by `save_slot_checkpoints` (`:2474-2507`), and only when the slot has checkpoints (`:2475-2477` returns 0 else):

- `SLOT_CKPT_MAGIC` = `0x504b4353` ("SCKP"), `SLOT_CKPT_VERSION` = 1, `count` (max `SLOT_CKPT_MAX_RECORDS` = 1024) (`:2394-2397`)
- per checkpoint: `n_tokens`, `pos_min`, `pos_max`, then `data_tgt`, `data_dft`, `data_spec` (`:2494-2504`).

So the file is: tokens + KV payload + optional checkpoint blobs. That is a complete conversation state - it is enough to resume the chat - but it is anonymous.

**What is MISSING for the owner's design:**

1. The namespace (the salt). This is the blocker; section A fixes it by stamping at restore time.
2. An owner/device identity. Section B fixes it with an always-written server stamp.
3. A server-owned schema/version stamp of its own (the `SCKP` version covers the appendix only, and the appendix is absent without checkpoints).
4. A checksum over the payload, so a partially corrupted state file can be told from a valid one before it reaches the reader.
5. Model identity on the sequence path (the arch string the non-sequence path writes), so a same-size wrong model is caught by name rather than only by geometry.

Not missing, despite first appearances: the sampling and generation parameters (temperature, samplers, `n_predict`) are per request and are re-sent with each chat turn, so a conversation file does not need them; and the chat identity is the file name, which the door owns.

## Part 2 - is a save legal mid-generation

**The decision lives in the slot-save task handler, and it is a defer, not a refusal and not a lock.**

The route `post_slots` (`:5086-5115`) validates the filename (`fs_validate_filename`, `:5617`) and posts a `SERVER_TASK_TYPE_SLOT_SAVE` task (`:5629-5636`), then blocks the HTTP response on `rd.next(req.should_stop)` (`:5640`). The task reaches the handler:

```
2749            case SERVER_TASK_TYPE_SLOT_SAVE:
...
2757                    if (slot->is_processing()) {
2758                        // if requested slot is unavailable, we defer this task for processing later
2759                        SRV_DBG("requested slot is unavailable, defer task, id_task = %d\n", task.id);
2760                        queue_tasks.defer(std::move(task));
2761                        break;
2762                    }
```

`is_processing()` is `state != SLOT_STATE_IDLE` (`:471-473`). `defer` parks the task in `queue_tasks_deferred` (`tools/server/server-queue.cpp:76-82`), and `pop_deferred_task` (`:90-110`) moves it back to the front of the live queue when the slot frees. Restore (`:2831-2834`) and erase (`:2901-2904`) use the same guard.

What happens to the generation: nothing. The request that is generating is not interrupted, not cancelled and not copied; the save waits. What gets written is the state at the moment the slot becomes idle and the deferred task runs - which may be after the generation completed, and after any tokens generated in between. So a "save while generating" is legal and lossless for the generation, but it is **not** a mid-generation snapshot: if the caller wants the mid-generation state, this route cannot give it. The HTTP caller blocks until the save runs (or aborts by disconnecting, which `req.should_stop` detects).

**One code-level caveat that the empirical run should look at.** The *other* save path, the RAM-cache save inside `get_available_slot`, has no such guard on the by-id path: `:1565-1570` selects the slot by id without checking `is_processing()`, and `:1660-1665` then calls `ret->prompt_save(*prompt_cache);`. The busy check happens only afterwards, in the task loop (`:2611-2616` defers the task). So a by-id completion request aimed at a busy slot can run `prompt_save` on a slot whose sequence is mid-generation, and `prompt_load` right after it (`,:1667`) could feed that partial state back into the same sequence. That is the one place where a "save" runs while a slot is busy, and it is a different path from `/slots?action=save`; the two should not be conflated when the measurement is read.

**Consequence (one sentence).** A client can ask for a save at any moment without disturbing generation, but the file it gets is the last idle state, not a snapshot taken while the model was producing.

**THE FIX.** Nothing to fix for the route's legality; if the owner needs a mid-generation snapshot, that is a new primitive (the by-id RAM save at `:1565-1665` is the only code that saves a busy slot, and it does so incidentally, not as an API). For the design, add the salt stamp at restore (section A) and the owner stamp at save (section B).

**THE COST.** No change for the legality question; the salt fix is section A's small function, the owner stamp is section B's small function plus a format decision.

---

# The branch question (required section, also verified)

**VERDICT: fully explained by the stale local ref. Nothing else is off. `origin/b11010-merge` carries the inlet.**

Evidence I obtained myself:

- `git diff 2a290390d main -- tools/server` is empty (see Basis).
- `git rev-parse`: `main` = `61db879b8`; `kalsa-server-v1.1.0` = tag object `c105c2182`; `git rev-parse kalsa-server-v1.1.0^{commit}` = `2a290390d`; `b11010-merge` (local, now) = `2a290390d`; `origin/b11010-merge` = `2a290390d`; `8537d097c` still exists as a commit.
- `git merge-base --is-ancestor 8537d097c 2a290390d` exits 0 (YES): the old local ref was an ancestor, not a divergent branch, so the fast-forward is legitimate.
- `git grep -l -E "x-kalsa-slot|cache_salt" <ref> -- tools/server`: 0 files at `8537d097c`; 5 files at `b11010-merge`, `origin/b11010-merge` and `2a290390d`. The five are `server-context.cpp`, `server-task.cpp`, `server-task.h`, `tests/unit/test_cache_salt.py`, `tests/unit/test_slot_header.py`.
- `git show <ref>:tools/server/server-context.cpp | wc -l`: 5558 at `8537d097c`, 5881 at `b11010-merge`, `origin/b11010-merge`, `2a290390d` and `main` - the requester's 5881-vs-5558 figure is exact.
- The desktop row names the tag: `kalsa-brain/crates/kalsa-runtime/src/assets.rs:218` `file: "kalsa-server-v1.1.0-bin-macos-arm64.tar.gz"`. That tag peels to `2a290390d`, which is the same commit as `origin/b11010-merge`, so the row does not point at an inlet-free engine.

So: the branch IS meant to carry the inlet, and it does at `origin/b11010-merge`; only the local ref was stale. A build from `origin/b11010-merge` ships the inlet; only a build from the old SHA `8537d097c` (or another pre-inlet commit) would ship an engine with no inlet at all. The only thing I cannot check from here is the provenance of the uploaded archive itself (see not-verified).

---

# Ranked order

1. **Restore stamps the namespace (addendum A, option ii) - `server-context.cpp:2868`.** First because the owner's design turns on the disk switch: the app side is trivial to switch on (`--slot-save-path` plus a filename) and worthless until this lands. Today the first salted request after a restore hits `:3418-3420` and wipes the just-restored state, so every chat switch loses the chat it just restored. Nothing in the design works before this.
2. **Context shift re-stamps the salt - `server-context.cpp:3199`.** One line. A shifted slot sits in the empty namespace, so the same device's next request is treated as foreign and its surviving `n_keep` prefix is erased. It also poisons the disk path: a shifted slot saved to disk is un-salted, so the restore's stamp (item 1) is what saves it, and without item 2 the running conversation still loses its prefix every time the context fills.
3. **Always-written owner / salt-hash stamp on the save file, checked on restore (addendum B) - `server-context.cpp:2474-2507`.** Third, not first, because it is the only item that can *leak* a foreign conversation rather than lose one, which is the worse failure and is the owner's absolute requirement; but it sits after the two salt stamps because those two decide whether the feature works at all, while the door already binds filenames and refuses `/slots/*` to guests (`kalsa-brain/crates/kalsa-door/src/slot_routes.rs:38`), so today the leak needs the door to misroute first. It is also the only item here that is a format decision, so it costs the most.
4. **Make the incumbent's save explicit, and add the survival assertion - claim 6.** The incumbent is rescued today only because `slot_prompt_similarity` defaults to 0.1 (`common/common.h:696`) and the `f_keep < 0.5` check at `server-context.cpp:1624-1625` happens to fire for a salt-mismatched by-id slot. That is an accident, not a contract; the disk design must not depend on it. Cheap: one explicit condition plus the test assertion at `test_cache_salt.py:162`.
5. **Salt-scoped RAM budget - claim 4 (`server-task.cpp:1755-1760`, `:1885-1903`).** Low priority for the target design, because disk is the store of record and a RAM eviction costs one re-restore. It matters only for the current shared-slot regime where RAM is the only cross-namespace copy.
6. **Refuse instead of wrap in `get_slot_by_id` - claim 5 (`server-context.cpp:1534`).** One line, defence in depth; not reachable through the door, and harmless at `--parallel 1`.
7. **Tri-state / honest contract for `prompt_load` - claim 3 (`server-task.cpp:1880`, `server-context.cpp:1667-1669`).** Cosmetic today because `:3418-3421` re-checks the salt; rides along with item 4.

---

# Is "a device's conversation survives the engine going idle or being restarted" achievable with this fork

Yes, it is achievable, and mostly with code this fork already has. The save file is a complete conversation state - the token list, the full memory/KV payload and the context checkpoints (`src/llama-context.cpp:3297-3313`, `server-context.cpp:2474-2507`) - a save is legal at any moment (deferred, not refused, `server-context.cpp:2757-2762`), and a restore is mechanically complete (`:2841-2864`). Idle slots are not involuntarily emptied under the app's flags: `kv_unified` is false by default (`common/common.h:573`), so `try_clear_idle_slots` returns early (`server-context.cpp:1688-1690`) and the idle-slot clear is gated on `kv_unified` (`:2650-2653`). The MINIMUM set of changes is: (1) stamp the namespace on restore from the caller's salt (addendum A(ii); the plumbing is `server-task.h:168-172` plus reading `get_cache_salt` in `post_slots`, `server-context.cpp:5086-5115`, then one assignment after `:2868`); (2) re-stamp the namespace after the context shift from `slot.task->params.cache_salt` (`server-context.cpp:3199`); and (3) keep the door's save-before-switch order, which is app-side (`kalsa-brain`), not engine code - the engine executes whatever pair of `/slots/:id?action=save|restore` calls it is given. Two honest caveats are design decisions rather than code changes: first, whether the engine must *itself* be able to detect a mis-scoped restore (addendum B) - that requires a new always-written file field and a legacy-file policy, and it is the owner's absolute requirement, so if "absolute" is literal it is part of the minimum and needs a format decision; second, the RAM prompt cache lives in the server context (`server-context.cpp:920`, created at `:1364`) and I did not verify its fate across a model unload/sleep, so if the idle path unloads the model and frees that cache, disk is the only store of record - which is exactly what the owner's disk design assumes, but it means the door must save (or the engine must keep the model resident) before an idle unload, and that ordering is a policy decision, not a code fact I can settle from the engine alone.

---

# What I could NOT verify, and what would settle it

1. **No empirical run.** Every conclusion above is from reading source; I did not build or run the engine, the door or the test suite, and I did not reproduce the claim-6 "measured case". The correction of claim 6's mechanism (the save does run, via `:1616-1625`) is therefore a code reading, not a measurement. Settle it by running `tools/server/tests/unit/test_cache_salt.py` with the added survivor assertion, and by a two-salt, one-slot run with logging at trace level.
2. **The app's real launch flags.** I read the builder in `kalsa-brain/crates/kalsa-launch/src/argv.rs` and found no `--slot-prompt-similarity` and no `--kv-unified`, with a non-zero `--cache-ram` and `--parallel` from `DEFAULT_PARALLEL = 1` (`args.rs:127`). If a shipped wrapper or a release script adds any of those, the default-dependent parts of claim 6 change. Settle it by reading the argv the shipped app actually execs (or its launch log).
3. **The provenance of the published archive.** The assets row names tag `kalsa-server-v1.1.0` (`kalsa-brain/crates/kalsa-runtime/src/assets.rs:218`), whose commit is `2a290390d`; but I cannot see whether the uploaded `kalsa-server-v1.1.0-bin-macos-arm64.tar.gz` was built from that commit. Settle it from the release pipeline metadata or by checking the archive's contents for `x-kalsa-slot`.
4. **The fate of the RAM prompt cache across sleep/unload.** I verified where it is created (`server-context.cpp:1364`) and that it is a context member (`:920`), but not whether a `sleep`/idle unload frees it. Settle it by tracing the sleep path in `server-context.cpp` and the app's `idle_unload_seconds` handling.
5. **The mid-generation RAM save.** I found that the by-id path calls `prompt_save` without an `is_processing` guard (`server-context.cpp:1565-1570`, `:1660-1665`) and that the busy check happens later (`:2611-2616`). Whether reading a generating sequence's KV there can corrupt the in-flight generation, or feed a partial state back through `prompt_load` at `:1667`, is a runtime question. Settle it with the separate empirical run, tracing `prompt_save`/`prompt_load` while a slot is mid-generation.
6. **A full caller audit for out-of-range `id_slot`.** I showed the door cannot send one and that `get_slot_by_id` is the only wrap site, but I did not enumerate every engine caller for a hypothetical `parallel > 1` build. Settle it by grepping every `get_slot_by_id`/`id_slot` producer and listing which can be out of range.
7. **The finding's severity claim in claim 6 for the door's actual usage.** I showed the incumbent is saved under the default flags, but I did not confirm against the app's real request shapes (streaming vs non-streaming, task type COMPLETION exclusively) that `:1658` always passes. Settle it by checking the door's request type and the engine's mapping for `/v1/chat/completions`.

