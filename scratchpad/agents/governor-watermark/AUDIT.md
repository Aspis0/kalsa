# AUDIT — governor watermark fix (engine `290f57773`, binding `fd36f610` + `b395de13`)

**Verdict: NO.**

The fix reproduces and repairs the watermark failure only on the class of model the host test uses:
a pure-attention one. On the **ship model LFM2.5-2.6B (hybrid: attention + short-conv recurrent)**
the rewind it performs cannot work: `llama_memory_hybrid::seq_rm` refuses a suffix removal when the
recurrent tail sits beyond `p` and `n_rs_seq == 0` (the ship configuration), so the **prefill** side
keeps both its attention cells and its recurrent state, `trim_sequence` returns false — and the
"kept" watermark is then silently overwritten by the very next `commit_side`. The predicted
mechanism ("the handoff rejects again") is wrong: the handoff **passes**, skips the KV copy, sets
both watermarks to `p`, and the prefill then decodes the new turn on top of the un-rewound
recurrent state. That is a loud, recoverable rejection turned into a silent, unverified hybrid-state
error, on the one model we ship. The tests cannot see it: the fixture is attention-only and the
hybrid governor target that exists (`test-governor-v0-hybrid`, `KALSA_HYBRID_GGUF`) is one of the
two **77 = SKIP** results the report presents in its green line. The engine/vendor plumbing itself is
clean (§4). This is a redesign, not a patch.

Commands run (already-built host binaries only):
`./build/bin/test-governor-v02-router > /tmp/r3-router.log 2>&1` → **EXIT=0**;
`./build/bin/test-governor-v0-turns -m /Users/marco/Projects/kalsallama/build/tinyllamas/stories15M-q4_0.gguf > /tmp/r3-turns2.log 2>&1` → **EXIT=0**;
`./build/bin/test-governor-v0-hybrid > /tmp/r3-hybrid.log 2>&1` → **EXIT=77**;
`./build/bin/test-governor-v0-devices > ...` → **EXIT=77**;
`./build/bin/test-governor-v0-mtp-hybrid -m <fixture> > ...` → **EXIT=77**.

---

## 1. The ship model: does `trim_sequence` fix it? — NO (CONFIRMED), the predicted mechanism is REFUTED

### 1.1 What `trim_sequence` actually does

    src/llama-governor.cpp:151  bool llama_governor::trim_sequence(llama_pos p) {
    src/llama-governor.cpp:152      bool ok = true;
    src/llama-governor.cpp:153      for (auto side : { std::make_pair(ctx_prefill, &prefill_state),
    src/llama-governor.cpp:154                         std::make_pair(ctx_decode,  &decode_state) }) {
    src/llama-governor.cpp:155          llama_memory_t mem = llama_get_memory(side.first);
    src/llama-governor.cpp:156          llama_memory_seq_rm(mem, 0, p, -1);
    src/llama-governor.cpp:157          const llama_pos pos_max = llama_memory_seq_pos_max(mem, 0);
    src/llama-governor.cpp:158          if (pos_max != -1 && pos_max >= p) {
    src/llama-governor.cpp:159              ok = false;
    src/llama-governor.cpp:160          } else {
    src/llama-governor.cpp:161              side.second->watermark = std::min(side.second->watermark, p);

### 1.2 On hybrid memory, the prefill side cannot be trimmed

LFM2 is a hybrid arch (`src/llama-arch.cpp:1081 case LLM_ARCH_LFM2:`; `llm_arch_is_hybrid` is what
selects `llama_memory_hybrid` at `src/llama-model.cpp:2670`). Hybrid `seq_rm` tries the recurrent
child first and refuses to touch the attention child if it fails:

    src/llama-memory-hybrid.cpp:186      // Try removing from the recurrent cache first since it may fail. If it does
    src/llama-memory-hybrid.cpp:188      if (!mem_recr->seq_rm(seq_id, p0, p1)) {
    src/llama-memory-hybrid.cpp:189          return false;
    src/llama-memory-hybrid.cpp:191      return mem_attn->seq_rm(seq_id, p0, p1);

The recurrent child's suffix removal is bounded by `n_rs_seq`:

    src/llama-memory-recurrent.cpp:177  const bool rm_all = p0 == 0 && p1 == std::numeric_limits<llama_pos>::max();
    src/llama-memory-recurrent.cpp:194      if (0 < p0 && p0 <= cell.pos && p1 > cell.pos) {
    src/llama-memory-recurrent.cpp:195          const llama_pos rollback = cell.pos - (p0 - 1);
    src/llama-memory-recurrent.cpp:198          if (!pending && rollback >= 1 && rollback <= (llama_pos) n_rs_seq) {
    src/llama-memory-recurrent.cpp:203          return false;

For the production call: the previous turn's prefill left the prefill cell at `cell.pos = 1890`
(prompt 1891, from the live log), the rewind target is `p = 1826`, so `rollback = 65` and
`n_rs_seq = 0` on the ship config — the app never sets it (`src/llama-context.cpp:3675
/*.n_rs_seq =*/ 0,` is the default; the binding sets `0` only for the MTP draft context,
`cpp/rn-llama.cpp:935 cparams.n_rs_seq = 0;`; no app assignment exists). `194` is entered,
`198` fails, `203` returns false, and `llama-memory-hybrid.cpp:189` returns **before the attention
trim** — so on the prefill side neither the recurrent state nor the attention cells beyond `p` are
removed. `seq_pos_max` then reports the min of the two children, i.e. `1890`, so line 158 sets
`ok = false` and the prefill watermark is kept.

**CONFIRMED: the prefill side of `trim_sequence` cannot rewind a hybrid sequence on the ship model.**

### 1.3 But the next handoff does NOT reject again — REFUTED (this is the worse part)

The rejection check reads the **source** watermark, and in the decode→prefill direction the source is
the **decode** context, which the checkpoint restore already placed at `p`:

    src/llama-governor.cpp:92   if (!sequence_end(src_ctx, 0, end) || end < src.watermark) {
    src/llama-governor.cpp:93       LLAMA_LOG_ERROR("%s: %s watermark is invalid\n", __func__, direction);

    cpp/rn-completion.cpp:643   if (recoverStateCheckpoint(text_tokens, n_common, num_prompt_tokens, n_past)) {
    cpp/rn-completion.cpp:650       "KALSA_KVREUSE checkpoint n_past=%d prompt=%zu n_common=%zu",
    (B2-logcat-live.txt:17053  KALSA_KVREUSE checkpoint n_past=1826 prompt=1891 n_common=1838)

After the state restore the decode memory ends at `p-1`, so `seq_rm(mem, 0, p, -1)` removes nothing,
returns true, and the decode watermark is lowered to `p` (line 161). The decode→prefill handoff then
sees `end = 1826`, `src.watermark = 1826`, so `1826 < 1826` is false: **the handoff passes**.
Because `end > src.watermark` is false, the KV commit is skipped entirely, and then:

    src/llama-governor.cpp:120      src.watermark = end;
    src/llama-governor.cpp:121      dst.watermark = end;

line 121 overwrites the prefill's "kept" watermark (`1891`) with `1826`. The protection the fix
declares ("that side's watermark is then kept", `src/llama-governor.h:19-26`) survives only inside
`trim_sequence`; the next handoff — the very event that motivated the fix — discards it.

The consequence is a stale hybrid destination used as if it were rewound. The prefill then decodes
the new prompt from position 1826 while its recurrent state is the one from position 1890, and the
recurrent `find_slot` explicitly tolerates the backtrack:

    src/llama-memory-recurrent.cpp:659  if (cell.pos >= 0 && last_pos != cell.pos + (llama_pos) n_seq_tokens) {
    src/llama-memory-recurrent.cpp:660      // What should happen when the pos backtracks or skips a value?
    src/llama-memory-recurrent.cpp:661      // Clearing the state mid-batch would require special-casing which isn't done.
    src/llama-memory-recurrent.cpp:662      LLAMA_LOG_WARN("%s: non-consecutive token position %d after %d for sequence %d with %u new tokens\n", ...);
    src/llama-memory-recurrent.cpp:665      cell.pos = last_pos;

So the ship model gets a warning and keeps the old conv/recurrent state (`r_l`/`s_l` are never
reset). Whether the wrong state is numerically material depends on the short-conv window; it cannot
be certified correct, and the `cell.pos` metadata now claims the state is current. On the raw
`seq_rm` path (`cpp/rn-completion.cpp:633`, no successful checkpoint) the decode side itself cannot
be trimmed either, so the handoff still rejects exactly as today — on hybrid, the fix's only
effective sub-case is the one it gets wrong.

**CONFIRMED: the fix does not fix the ship model.** The predicted second rejection is **REFUTED**;
it is replaced by a silent stale-state turn (KALSA_KVTRIM warning + `non-consecutive token position`
warning) that the host test cannot detect. The declared invariant "the handoff then rejects loudly
instead of committing stale cells" is false (`src/llama-governor.h:19-26`, `cpp/rn-completion.cpp:675-677`).

---

## 2. `commit_side` and the recurrent state — it is copied wholesale already; the fix suppresses the copy

`llama_kv_commit_with_stats` routes hybrid contexts into `llama_hybrid_commit`
(`src/llama-kv-commit.cpp:367-369`), which mirrors the attention range **and copies the entire
recurrent state**:

    src/llama-hybrid-commit.cpp:63   for (size_t i = 0; i < src.r_l.size(); ++i) {
    src/llama-hybrid-commit.cpp:64       if (!copy_tensor(src.r_l[i], dst.r_l[i], scratch, copied_bytes) ||
    src/llama-hybrid-commit.cpp:65           !copy_tensor(src.s_l[i], dst.s_l[i], scratch, copied_bytes)) {
    src/llama-hybrid-commit.cpp:69   dst.cells = src.cells;
    src/llama-hybrid-commit.cpp:70   dst.head = src.head;
    src/llama-hybrid-commit.cpp:71   dst.used = src.used;
    src/llama-hybrid-commit.cpp:72   dst.rs_idx = src.rs_idx;

Because `copy_recurrent` is a whole-state adoption, the right primitive for a rewound source is
already present: after the checkpoint restore the decode context is authoritative at `p`, so the
handoff should **adopt** it into the prefill (clear/prepare the destination and commit
`[0, p)` + the recurrent state), not lower the source watermark so that `end > watermark` becomes
false and the copy is skipped. Lowering the source watermark is what makes this fix self-defeating:
the governor's incremental-commit check (`src/llama-governor.cpp:96 if (end > src.watermark)`) reads
"nothing new to copy" and leaves the destination stale by construction. Q2's alternative is not just
plausible, it is the machinery that already exists; the fix is what prevents it from running.
**CONFIRMED (the trim is the wrong primitive for hybrid; a state adoption is the applicable one).**

---

## 3. Which model the host test loads — attention-only, so it cannot show the ship case — CONFIRMED

    tests/test-governor-v0-turns.cpp:792  if (!common_params_parse(argc, argv, params, LLAMA_EXAMPLE_COMMON) || params.model.path.empty()) { return 1; }

Run here with `-m .../stories15M-q4_0.gguf`: `EXIT=0`, and the new scenarios pass —

    /tmp/r3-turns2.log:14  governor_raw_trim_breaks_handoff=PASS (bypass pinned)
    /tmp/r3-turns2.log:15  governor_trim_keeps_handoff=PASS

`stories15M` is TinyLlama, a dense attention-only Llama: `llama_memory_recurrent::seq_rm` is never
reached, so both new scenarios exercise the one memory class that can be trimmed. The suite already
has the right vehicle, and it is skipped:

    tests/test-governor-v0-hybrid.cpp:233  const char * path = std::getenv("KALSA_HYBRID_GGUF");
    tests/test-governor-v0-hybrid.cpp:235  std::fprintf(stderr, "governor-hybrid: SKIP KALSA_HYBRID_GGUF is unset (exit 77)\n");

`./build/bin/test-governor-v0-hybrid` → **EXIT=77**. The report's "seven standing targets
0 0 77 77 0 0 0" includes that 77 (the other is `test-governor-v0-devices`, also 77 here): two of
the seven are **skips**, and the skipped one is exactly the hybrid governor+commit path this fix
touches. Worse, had it run on a hybrid model, both new scenarios would go **red**: `run_governor_trim_keeps_handoff`
asserts the call that hybrid refuses (`tests/test-governor-v0-turns.cpp:584 if (!llama_governor_trim_sequence(gov.get(), 8))` → "trim_sequence reported failure" → false), and `run_raw_trim_breaks_handoff`'s
raw `seq_rm` would return false without changing the sequence, so its expected handoff rejection
would not appear. The tests encode attention-only behavior as if it were the general contract.
**CONFIRMED: the green evidence cannot speak to the ship model, and the ship-shaped target was
available and skipped.**

---

## 4. Placement, CPU route, first turn, OpenCL cost

- **Placement — CONFIRMED adequate for the text path.** The call at
  `cpp/rn-completion.cpp:674 if (parent_ctx->governor && !parent_ctx->governor->trim_sequence(n_past))`
  runs after the whole KV block (`:631` mtp window clear, `:633` raw seq_rm, `:643` checkpoint
  restore, `:665-666` clear + `n_past = 0`), so all three text-path rewinds reach it. Other
  `seq_rm`/`clear` sites are elsewhere: `:2105` (embedding), `:2170`/`:2194` (rerank), `:2311`-`:2384`
  (bench), `:2430` (`processMedia`), `rn-slot-manager.cpp:680/:798/:935/:1372/:1385` (non-zero slot
  sequences), `bmoe_stream.cpp:229/:310` (separate CPU lane, no governor). The multimodal branch is
  genuinely gated off under a governor: `kalsa/src/engine/LlamaService.ts:2324 !options.mmprojPath,`
  inside the `governorLoad` conjunction. **CONFIRMED.**
- **CPU route — harmless but noisy.** `cpu_route_handoff` skips the handoff entirely
  (`src/llama-governor.cpp:218-220`), so the trim is irrelevant there; on a hybrid CPU route it still
  fails and logs `KALSA_KVTRIM` for a condition nobody needs to act on. PLAUSIBLE (noise only).
- **First turn — no watermark.** With a cold/empty memory the recurrent tail is `-1`, `seq_rm`
  returns true without touching cells, `pos_max == -1` is excluded by line 158, and
  `min(watermark, p)` starts from 0. No new failure mode found. **REFUTED as a risk.**
- **OpenCL cost/failure — none found.** The hybrid path never reaches the attention `seq_rm`, and
  `llama_kv_cache::seq_rm` is CPU cell bookkeeping (no kernels, no `v_trans` work on this path); the
  governor contexts are independent (the constructor throws on `ctx_other`, so no `shared_fence`
  refusal). The trim does not synchronize, but it runs between turns with no in-flight work on the
  prefill ctx, and the subsequent commit synchronizes both sides (`src/llama-kv-commit.cpp:361-362`).
  PLAUSIBLE-low only.

---

## 5. Vendor and clean code

- **Vendor byte-identity — CONFIRMED.** sha256(engine 290f57773:file) == sha256(vendor/llama.cpp:file)
  for all four (`llama-ext.h`, `llama-governor-runtime.cpp`, `llama-governor.cpp`,
  `llama-governor.h`); `vendor/VERSIONS:9 LLAMA_CPP_COMMIT=290f577738daa8811f51d6deaab142323bc9bbba`;
  `src/version.ts:1 BUILD_NUMBER = '11215'`, `:2 BUILD_COMMIT = '290f577'`. The engine delta
  `56f79e6cb..290f57773` is exactly those four files plus two engine test files (111 + 10 lines,
  outside the export), and the binding's vendor numstat matches (13/4/16/9). Nothing else under
  `vendor/` changed. The engine tip is 290f57773, equal to the pin. **CONFIRMED.**
- **Clean-code — two false comments and a mismatched test contract.** The engine contract
  (`src/llama-governor.h:19-26`) and the binding comment
  (`cpp/rn-completion.cpp:675-677 "its watermark is kept; the governor rejects the handoff loudly
  rather than commit stale cells"`) both state a protection that `src/llama-governor.cpp:120-121`
  destroys on the next handoff. The project rule "if a comment declares an invariant, that invariant
  must be true" is violated. Otherwise the shape is right: one public API with one caller, no new
  file, no God file, comment states WHY, no secrets.
- **Delivery chain unchanged** (app pin untouched, commit unpushed) — as reported.

---

## What I could not verify

- No hybrid GGUF exists on this Mac (`find ... -iname "*lfm*.gguf"` → empty; the worktree's
  `build/tinyllamas/` is empty and the fixture used is the other checkout's stories15M). The
  hybrid-specific conclusions are code reads of deterministic branches, not a run: they would be
  settled by `KALSA_HYBRID_GGUF=<shipped LFM2.5 GGUF> ./build/bin/test-governor-v0-hybrid` plus a
  turns scenario asserting the trim on a hybrid model.
- The numeric materiality of the stale recurrent state (short-conv window length vs the 65-token
  gap) is not measurable here; either way the state is not the state the rewind claims.
- No device run: the next S23 session should grep for `KALSA_KVTRIM` and
  `non-consecutive token position` — the first is emitted by the fix and the second is the signature
  of the stale-state decode this audit predicts.
- The report's production log line was read from `governor-nofit/raw/B2-logcat-live.txt:17053-17056`
  and matches the described failure; the in-RAM checkpoint history that produced `n_past=1826` was
  not re-derived beyond that.

---

# Round 2 — hybrid redesign (`33cc1d246`; binding `a26317e5` + `a006e773`)

**Verdict: SHIP-WITH-FIXES.**

The Round-1 NO is closed. On the ship-shaped hybrid model (LFM2.5-2.6B, Q4_0) the new
`run_rewind` scenario is green with a fresh-context logit oracle, at p=12 and p=1800, and I
reproduced both on the already-built binary (EXIT=0, `max_abs_diff=0.000e+00`, the 2.6B full
recommit `29851648` bytes / `3742` us at p=1800). The engine now clears an untrimmable side and
zeroes both watermarks so the next handoff adopts the rewound side's whole state, and `commit_side`
rejects a destination that still holds cells past the source end. Every other governor host test
passes with `KALSA_HYBRID_GGUF` set except two standing SKIPs and one stale scenario in the turns
test, which is **red (EXIT=1) on the ship GGUF**. The remaining fixes: (a) make
`run_raw_trim_breaks_handoff` hybrid-aware so the standing suite is not red on the model we ship,
(b) decide whether an OpenCL recommit OOM should latch `failed` instead of throwing and retrying,
(c) the stale round-1 comment at `tests/test-governor-v0-turns.cpp:556-559`.

## R2.1 Q1 — the oracle is sound and the scenario is faithful — CONFIRMED

    tests/test-governor-v0-hybrid.cpp:320  auto reference = context_ptr(llama_init_from_model(model, cparams));
    tests/test-governor-v0-hybrid.cpp:322  if (!decode_ctx(reference.get(), prompt_a, 0, false) ||
    tests/test-governor-v0-hybrid.cpp:323      !decode_ctx(reference.get(), tail_c, p, true)) { return false; }

A **fresh** context fed `prompt_a` then `tail_c` — not a restored one. The scenario mirrors the
binding exactly: the checkpoint is captured with `PARTIAL_ONLY` (`:280-285`), the rewind restores it
into the *decode* context (`llama_governor_get_decode_context`, `:294-296`) — which is
`active_ctx()` after a generation turn (`src/llama-governor-runtime.cpp:221 llama_context *
llama_governor::context() const { return last_ctx; }`, `src/llama-governor.cpp:283 last_ctx =
target;`, and `cpp/rn-llama.cpp:658 governor->active_ctx()`) — then trims through the governor
(`:297`), and turn C is a prefill after a decode, i.e. the **decode-to-prefill** direction the S23
hit (`:320` reads the prefill's logits). The binding's real path is the same pair
(`cpp/rn-completion.cpp:364 seq_rm` / `:389 llama_state_seq_set_data_ext(active_ctx(), ..., PARTIAL_ONLY)`
/ `:674 trim_sequence(n_past)`). Reproduced here:

    KALSA_HYBRID_GGUF=<2.6B> ./build/bin/test-governor-v0-hybrid          -> EXIT=0
    governor_hybrid_rewind p=12 trim_ok=1 max_abs_diff=0.000e+00 commit_bytes=557056 commit_us=163
    KALSA_HYBRID_REWIND_TOKENS=1800 ...                                   -> EXIT=0
    governor_hybrid_rewind p=1800 trim_ok=1 max_abs_diff=0.000e+00 commit_bytes=29851648 commit_us=3742

Bitwise equality cannot happen if any turn-B (tail_b) state leaks: the prefill is cleared at turn
C's start and refilled by the handoff, and the oracle recomputes the same tokens. **CONFIRMED.**
One cosmetic weakness: `rewind_to` calls `trim_sequence` and discards the result (`:297`), then turn
C asserts a *third, idempotent* call (`:309 const bool trim_ok = llama_governor_trim_sequence(...)`) —
so `trim_ok=1` is not the result of the binding-shaped call, though it would go false if the clear
kept failing.

## R2.2 Q2 — can stale cells or a stale recurrent state still be consumed? — mostly REFUTED, two gaps

- **A rewind while `last_phase` is Prefill — REFUTED as a bug, and for the reason one would not
guess:** the active side is `last_ctx`, which after a prefill-phase turn *is* the prefill context,
so the checkpoint restore lands on the context the next same-phase turn will use
(`src/llama-governor.cpp:255 if (last_phase != phase::None && last_phase != next_phase && ...)`, the
handoff is skipped when the phase repeats). The trim clears the *decode* side (the untrimmable one)
and the prefill keeps the restored `[0, p)` — correct.
- **Prefill route = CPU — REFUTED (the route and the active side move together).** A first draft of
  this audit predicted a corner where the handoff suppression (`src/llama-governor.cpp:254-255`,
  `cpu_route_handoff`) leaves the cleared side in use. It cannot happen: `prefill_route_` is sticky
  inside a prefill phase (reset only when `last_phase != Prefill`, `:229`) and the last-used context
  follows the same flag (`:207 llama_context * target = cpu_prefill ? ctx_decode : ...`, then
  `:283 last_ctx = target;`). So within a run of prefill phases the rewind's active side is exactly
  the context the next prefill will target (CPU route -> decode both times, GPU route -> prefill both
  times), and when the route changes the phase has also changed (a Decode turn precedes it), so a
  handoff occurs and re-commits into whichever side was cleared. The CPU route is only exercised by
  `run_low_battery_prefill` without a rewind, so it is untested, but no broken combination was found.
- **Two rewinds in a row — REFUTED (safe).** After the first, the untrimmable side is empty and both
  watermarks 0; the second `seq_rm(0,p2,-1)` sees `pos_max < p2` on both sides -> the exact path ->
  `min(0, p2) = 0`, and the next handoff re-commits `[0, end)` from the rewound side.
- **Rewind to p=0 — REFUTED (safe).** `seq_rm(0,0,-1)` is the `rm_all` branch
  (`src/llama-memory-recurrent.cpp:177-180`), both sides clear, `pos_max == -1` is excluded from the
  untrimmable test (`src/llama-governor.cpp:170`), both watermarks become 0, the next decode starts
  from 0 on empty caches.
- **Chunked prefill — REFUTED (no interaction).** The chunk loop recurses into `decode_impl`
  (`src/llama-governor-runtime.cpp:106 const int32_t rc = decode_impl(chunk, false);`), so the phase
  handoff still happens once per turn, on the first chunk; the trim runs before the turn.
- **MTP-hybrid — SKIPPED, not verified.** `KALSA_HYBRID_GGUF=<2.6B> ./build/bin/test-governor-v0-mtp-hybrid -m <2.6B>`
  -> **EXIT=77**, `mtp_hybrid=SKIPPED model has no MTP layers, pass a Qwen3.5-class GGUF`. The ship
  LFM2 has no MTP layers, so this path is not used by the ship model; the MTP+hybrid+trim
  combination remains untested (no Qwen3.5-class GGUF on this host).
- **The turns test is RED on the ship model — CONFIRMED (test defect, measured).**
  `KALSA_HYBRID_GGUF=<2.6B> ./build/bin/test-governor-v0-turns -m <2.6B>` -> **EXIT=1**;
  `-m stories15M` -> EXIT=0. The failing scenario is the Round-1 attention-only pin:
  `tests/test-governor-v0-turns.cpp:540 llama_memory_seq_rm(mem, 0, 8, -1);` fails on hybrid (no
  mutation), so the handoff no longer rejects; the scenario then feeds a batch at position 0
  (`:542 auto second = make_batch(prompt, 0);`) into a context whose last position is 18, and the
  assertion at `:546-547` wants a "route Reject during phase handoff" but gets
  `expected handoff failure, rc=-1 reason=llama_decode failed with rc=-1`. The report's table lists
  only "stories15M turns -> 0"; anyone running the standing suite with `KALSA_HYBRID_GGUF` set — the
  model we ship — gets a red suite. Also stale: the comment at `:556-559` ("lowers both watermarks,
  so the next handoff commits nothing stale") still describes the round-1 semantics.

## R2.3 Q3 — the new `commit_side` destination guard — REFUTED as a false-positive risk

    src/llama-governor.cpp:96   llama_pos dst_end = 0;
    src/llama-governor.cpp:97   if (sequence_end(dst_ctx, 0, dst_end) && dst_end > end) {
    src/llama-governor.cpp:101      LLAMA_LOG_ERROR("%s: %s destination holds cells beyond the source end (%d > %d)\n", ...);

The normal flow cannot trip it: every handoff is preceded by the destination being behind or equal
(the decode advances, the prefill does not; the next handoff copies the delta), the attention-only
cheap trim ends both sides at `p-1`, the reset path leaves the untrimmable side empty, `p=0` clears
both, `llama_governor::clear_cache` empties both contexts and resets `last_ctx`/`last_phase`
(`src/llama-governor-runtime.cpp:149-159`), and SWA/attention-only `seq_rm` removes cells without
window restrictions. Callers that rewind outside `trim_sequence` (embedding/rerank/bench clear the
active ctx at `cpp/rn-completion.cpp:2105/2170/2194/2311`; not governor paths in production) now get
a loud reject instead of a silent stale commit — intended. `sequence_end` returning false skips the
check (short-circuit), so the INT64_MAX sentinel is not a new reject either. **CONFIRMED safe.**

## R2.4 Q4 — GPU/OpenCL cost and failure mode — PLAUSIBLE

The full recommit is `copy_tensor` over the recurrent tensors plus the attention mirror:

    src/llama-hybrid-commit.cpp:49   ggml_backend_tensor_get(src, scratch.data(), 0, size);
    src/llama-hybrid-commit.cpp:50   ggml_backend_tensor_set(dst, scratch.data(), 0, size);

On the phone, `dst` is an OpenCL compute buffer, so the set side is
`ggml_backend_opencl_buffer_set_tensor` — the function `86f602f8a` armed with
`throw_set_tensor_upload_error` (a `std::runtime_error`, not a return code). A device-OOM during a
recommit therefore throws across the C `llama_governor_decode` boundary instead of setting
`failed`/`-2`; `createPromiseTask` catches it and rejects the JS promise
(`cpp/jsi/JSIUtils.cpp:81-107`, `reject->call(rt, createJsiError(rt, e.what()))`), so the outcome is
a visible error, not a crash — but because the throw happens before `src.watermark = end`, both
watermarks stay 0 and the governor is *not* marked failed, so the next call retries the same full
copy (a retry loop on persistent OOM, no sticky latch). Cost: 28.5 MiB / ~3.7 ms on the host at
p=1800 (my run; the writer measured 3421 us), all CPU-side copies plus the mirror; the phone's
Adreno/UFS number, whether the OpenCL context takes the `Staged` V path
(`src/llama-governor.cpp:100-101`), and the OOM probability are all unverified. PLAUSIBLE.

## R2.5 Q5 — vendor byte-identity and comments

- **Byte-identity — CONFIRMED.** sha256(engine `33cc1d246`:file) == sha256(`vendor/llama.cpp`:file)
  for all four (`llama-ext.h`, `llama-governor-runtime.cpp`, `llama-governor.cpp`,
  `llama-governor.h`); `vendor/VERSIONS:9 LLAMA_CPP_COMMIT=33cc1d246...`; `src/version.ts:1
  BUILD_NUMBER = '11216'`, `:2 BUILD_COMMIT = '33cc1d2'`. Engine delta `290f57773..33cc1d246` =
  `llama-governor.cpp` 51, `llama-governor.h` 17, and the hybrid test 126 (outside the export); the
  binding's bump touches the same two vendored files (51/17) plus the version files. Nothing else.
- **Comments — the two Round-1 false ones are gone** (`cpp/rn-completion.cpp:670-680` now says "the
  governor then clears that side and re-commits [0, end) from the rewound side on the next handoff",
  and `KALSA_KVTRIM` is now only for a failed clear; `cpp/rn-governor.h:35-37` matches). The engine
  contract (`src/llama-governor.h:19-30`) is true *when a handoff occurs*; it does not mention that
  the CPU route suppresses the handoff. R2.2 shows that suppression is benign (the route and the
  active side move together), so this is wording only. PLAUSIBLE-minor (doc completeness).

## Runs (all already-built host binaries, hybrid GGUF = `LFM2.5-2.6B-QAD-Q4_0.gguf`)

| run | exit |
|---|---|
| `test-governor-v0-hybrid` (2.6B, p=12) | **0** |
| `test-governor-v0-hybrid` (2.6B, `REWIND_TOKENS=1800`) | **0** |
| `test-governor-v0 -m HYBRID` | **0** |
| `test-governor-v0-commit -m HYBRID` | **0** |
| `test-governor-v0-shared-cells -m HYBRID` | **0** |
| `test-governor-v02-router -m HYBRID` | **0** |
| `test-governor-v0-devices -m HYBRID` | **77** (standing no-GPU skip) |
| `test-governor-v0-mtp-hybrid -m HYBRID` | **77** (no MTP layers) |
| `test-governor-v0-turns -m stories15M` | **0** |
| `test-governor-v0-turns -m HYBRID` | **1** (stale attention-only scenario, R2.2) |

## What I could not verify

- The Round-1 red on `290f57773` (`turn C decode failed (trim_ok=0)`) is the writer's run; the
  worktree is at the fix and I did not revert it.
- The phone: the full-recommit wall time and OpenCL behaviour, the recompute-then-forget behaviour of
  a set_tensor throw at decode time, and whether any app path rewinds the active context without
  `trim_sequence` (now a loud reject instead of a silent stale commit — intended). The next device
  session should grep for `KALSA_KVTRIM` (now only on clear failure) and
  `non-consecutive token position` (must be absent).
- The 1.2B model the report also used is not in `/Users/marco/kalsa-models/mac/` (only the 2.6B);
  the 1.2B green is taken from the report.
- MTP-hybrid with a Qwen3.5-class GGUF: not on this host.

---

# Round 3 — commit latch + model-aware pins (`7af73d881`; binding `4f456234`)

**Verdict: SHIP-WITH-FIXES** (one guard line; the round-2 items are closed).

All Round-2 findings are addressed and I reproduced the key runs: hybrid `EXIT=0`
(`governor_hybrid_rewind p=12 trim_ok=1 max_abs_diff=0.000e+00`, `commit_us=155`),
`test-governor-v0-turns -m <2.6B>` `EXIT=0` with `governor_raw_trim_breaks_handoff=PASS (hybrid bypass
pinned)` and `governor_trim_keeps_handoff=PASS`, router `EXIT=0` (the writer's stale-binary SIGABRT is
not present in the rebuilt tree).

## R3.1 The `commit_side` try/catch — CONFIRMED correct, one inert-state caveat

    src/llama-governor.cpp:114   try {
    src/llama-governor.cpp:115       ok = llama_kv_commit_with_stats(dst_ctx, src_ctx, 0, src.watermark, end, &copied_bytes, mode, &commit_stats);
    src/llama-governor.cpp:117   } catch (const std::exception & e) {
    src/llama-governor.cpp:122       snprintf(decode_failure_reason_, sizeof(decode_failure_reason_), "KV commit failed: %.80s", e.what());
    src/llama-governor.cpp:124       fail(decode_failure_reason_);
    src/llama-governor.cpp:125       return false;
    src/llama-governor.cpp:127   stats_.commit_us += ggml_time_us() - t0;
    src/llama-governor.cpp:141   src.watermark = end;
    src/llama-governor.cpp:142   dst.watermark = end;

The catch scope is right: the only realistic thrower here is the OpenCL set_tensor guard
(`std::runtime_error`, 86f602f8a) and `copy_tensor`'s `std::vector` (`std::bad_alloc`, also
`std::exception`); nothing in the commit path throws a non-`std::exception` type, and kernel-side
`CL_CHECK` aborts rather than throws. Return happens before lines 120-121, so **both watermarks keep
their pre-commit values** (the assignments are at `:141-142`) and the partial `copied_bytes`/`commit_us` are not counted. `fail()` latches
`failed` with the specific reason, `decode_impl` returns via `src/llama-governor.cpp:275 return failed
? -1 : fail("route Reject during phase handoff");`, and every later call short-circuits at `:226 if
(failed) { return fail("governor is failed"); }` — so no later governor path consumes the half-copied
destination. The destination IS half-copied (the attention mirror updates it before the recurrent
copy, whose metadata assignment is last, `src/llama-hybrid-commit.cpp:69-74`), and it is inert **only
while callers honor `failed`**. **Caveat (PLAUSIBLE-minor, the one fix):** `trim_sequence`
(`src/llama-governor.cpp:172`) has no `failed` guard, and the binding calls it from `loadPrompt`
(`cpp/rn-completion.cpp:674`) *before* any `governorFailed()` check, so a second completion on a
failed governor would `seq_rm`/clear the half-copied hybrid memory. Add `if (failed) return false;` at
the top of `trim_sequence` (and/or state in the catch comment that the half-copied side must not be
touched).

**Reason text and bounds — CONFIRMED.** Exactly two writers exist, both `sizeof`-bounded (`:122`,
`:286`); no `strncpy`/`strcpy` anywhere (`grep decode_failure_reason_` = those two calls plus the
`:124`/`:288` assignments and the declaration). `e.what()` can carry the model **tensor name**
(`throw_set_tensor_upload_error` builds `set_tensor: ... for tensor '<name>'`) — model metadata, no
prompt/user text; `%.80s` truncates safely (possibly mid-name, cosmetic).

## R3.2 `decode_impl` keeping the latched reason — CONFIRMED, no empty reason

The ternary at `:275` is exactly "the catch latched": `failed` can only have been set by
`commit_side` at that point (`:226` already returned if it was set on entry, and no other setter runs
before the handoff). A false from `commit_side` without the catch still yields the generic
`fail("route Reject during phase handoff")`. No path sets `failed` with a null/empty reason: `fail()`
always stores a literal and both `snprintf` writers produce non-empty text. One carried-over
semantic (not a regression, no app impact): the *next* engine call still overwrites the reason with
`"governor is failed"` at `:226-227`; the binding never makes that call (it short-circuits at
`cpp/rn-governor.cpp:45` once `failed_` is set) and caches the specific first reason at `:56`, which
is what the JSI error and `governor_failure_reason` surface.

## R3.3 Model-aware turn scenarios — both assert something real — CONFIRMED

`run_raw_trim_breaks_handoff` picks the expectation per class (`tests/test-governor-v0-turns.cpp:553`
`const char * expected = hybrid ? "llama_decode failed with rc=-1" : "route Reject during phase
handoff";`) and asserts `rc != -1 || !is_failed() || reason` — on hybrid the raw trim refuses, the
handoff passes and the turn dies at `llama_decode` with the E1 reason; if a future engine made the
hybrid partial trim succeed, the expected reason would flip and the pin goes red. Not green-only.
`run_governor_trim_keeps_handoff` on hybrid restores a consistent `[0,8)` state from a sibling
context first (`:598-615`), then trims and requires a consecutive decode — a real check (an empty or
stale-side memory would fail the position rule), but **rc-only: no logits**, so a numerically wrong
but consecutive state would pass; the strong oracle remains `run_rewind` in the hybrid test (re-ran
green). `run_rewind`'s `rewind_to` now returns the binding-shaped trim result and the idempotent
third call is gone (`tests/test-governor-v0-hybrid.cpp:295-299`, `:313`) — the Round-2 nit is
closed.

## R3.4 Vendor at `7af73d881` — CONFIRMED

sha256(engine `7af73d881`:file) == sha256(`vendor/llama.cpp`:file) for both
`llama-governor.cpp` and `llama-governor.h`; `vendor/VERSIONS:9
LLAMA_CPP_COMMIT=7af73d881dabb7769684381c0ab1ecdb699f2622`; `src/version.ts:1 BUILD_NUMBER = '11217'`,
`:2 BUILD_COMMIT = '7af73d8'`; the bump touches only those two vendored engine files plus the
version/identity files (`git show --stat 4f456234`).

## What I could not verify (Round 3)

- The commit-throw path at runtime: no host backend throws there (the writer states this too); my
  read confirms the catch, the watermark ordering and the latch, but a device-OOM recommit is
  untested. The phone session should grep the JSI error for `KV commit failed:` and verify the
  governor reloads rather than retrying.
- The half-copied destination after a throw (no fixture can produce it); the recommendation is the
  `trim_sequence` guard.
- The 2.6B hybrid reruns here are the only device-shaped evidence; the S23 number for the full
  recommit is still unmeasured.
