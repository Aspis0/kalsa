# FINAL audit A — cross-commit interaction on the whole F5 diff

Audited the cumulative diff `git diff c977d58..8ed1f0d` (0b725d3 → d31ad8d → 2a7f365 →
8ed1f0d) on `kalsa/selfspec-f1`, branch tip `8ed1f0d`. Angle: state machines two commits
each half-changed — the rebuild flag, the wipe decision, the canary, the snap, the
attention-only rm, the catch-up replay count — and the ordering between cancel, abort
cleanup, trim, rollback_turn, prefix-reuse, prefill-from-0, and the next turn's first
draft. Reading base: `core/src/engine/session.cpp` (tip), `memory_attn_rm.*`,
`router_hook.h`, `recurrent_freeze.*`, the llama.cpp submodule (`ggml-backend.cpp`,
`llama-context.cpp`, `llama-memory-recurrent.cpp`, `llama-memory-hybrid.cpp`,
`llama-kv-cache.cpp`, `llama-graph.cpp`, `delta-net-base.cpp`), the three prior audit
reports, and the F5 REPORT/p1/p2 logs. No source files edited.

Two previous audits each found real defects; a third found three. This one found that the
**central premise of the third audit is wrong** (R1's mechanism is refuted by the llama.cpp
code), and that the wipe-decision rewrite the third audit examined silently **re-opened
the original F1 corruption class on two concrete, ungated triggers** that the second
audit had verified as fixed. Ranked findings below; then per-state-machine lifecycles;
then what is clean.

---

## F1 — CONFIRMED (severity 1): freeze + cancel mid-cycle (draft / verify / catch-up) leaves the draft context's recurrent row ahead of the rolled-back prefix; no code wipes it, and the next turn drafts from a state that contains the cancelled turn's tokens

**The lifecycle across the four commits.** 0b725d3's trim ran the *full hybrid* `seq_rm`
on `ctx_dft`; with `n_rs_seq = 0` any partial rewind returns false and the fallback
cleared — but the re-prefill started at `n_common`, not 0 (the original F1 finding).
d31ad8d fixed this with the freeze-specific decision: attn-only rm, then
`recr >= p0 → clear_draft_rebuild` (`memory_seq_pos_max_recr` read at
`d31ad8d:session.cpp:491-493`). That predicate caught **every** cancel path: after any
aborted cycle the draft decodes (or the catch-up replay) had advanced the recurrent
*metadata* to `≥ n_past`, and the trim (`p0 = emitted_end`) and/or `rollback_turn`
(`p0 = n_common`) wiped. Round-2's audit verified this explicitly: "Cancel in draft loop /
verify / catch-up: metadata is ahead of the data → recr >= p0 fires at the trim and/or
rollback → wipe → correct."
2a7f365 **dropped the `recr >= p0` check** (its N1 fix — an empty cache after a wipe reads
`recr = -1`, indistinguishable from "fine"): `rewind_or_rebuild_draft` now decides on
`draft_covers_prefix` alone, attention-only (session.cpp:491-498, 502-515).
8ed1f0d kept that decision (it only relaxed `amin == 0` → `amax >= p0-1` and added
`prepare_from0_draft_prefill`), so the freeze path has **no recurrent-row check anywhere
in the live loop**. The wipe now fires only when (a) the attn-only rm fails (cannot on a
GDN attention half), (b) attention does not reach `p0-1`, or (c) the canary fires.

**The concrete trigger chain** (freeze + hybrid + chat, the feature's target config):

1. Turn A emits ≥ 1 token, then the user cancels. The abort callback fires between
   compute nodes (ggml-cpu.c:3093-3096 — checked after *every* node, so any decode can
   abort); `llama_decode(ctx_dft, …)` returns 2 and the abort cleanup runs
   (llama-context.cpp:1811-1832): `pos_min > 0` → recurrent partial rewind needs
   `rollback ≤ n_rs_seq = 0` (llama-memory-recurrent.cpp:177-187) → false → the hybrid
   `seq_rm` short-circuits and removes **nothing** (llama-memory-hybrid.cpp:143-150).
   The engine's cancel branch breaks (session.cpp:1501-1503 / 1673-1674).
2. End-of-turn trim (session.cpp:1791-1795, `p0 = emitted_end`): attn-only rm removes
   `[emitted_end, ∞)` — attention is `[0, emitted_end)`, `amax = emitted_end-1 ≥ p0-1`
   → `draft_covers_prefix` true → **no wipe**. The recurrent row is untouched: data at
   `s_{n_past-1}` (frozen drafts nop'd the stores), metadata at `n_past + i - 1` (find_slot
   ran per draft; llama-memory-recurrent.cpp:636-644).
3. `rollback_turn` (session.cpp:1228-1230, `p0 = n_common`): same — attention
   `[0, n_common)` covers → **no wipe**. Flag stays false.
4. Turn B: turn-start rewind (session.cpp:1206-1208): same → no wipe. Draft prefill
   (session.cpp:1349-1351, flag false → `dft_from = n_common`, no wipe): the first chunk
   decodes `[n_common, n_prompt)` against the tail **data `s_{n_past-1}`** — which was
   computed over the cancelled turn's emitted tokens `[n_common, n_past)`, tokens that
   `rollback_turn` removed from the conversation, `kv_tokens`, and the target. One
   non-consecutive WARN (llama-memory-recurrent.cpp:638), then every draft of turn B is
   conditioned on a conversation that no longer exists; the divergence is permanent (each
   turn's prefill advances the poisoned base and nothing ever wipes — the flag is never
   set on this chain).

Sub-triggers, all the same root: cancel during the verify decode (draft metadata ahead),
cancel during the catch-up replay (snap ran, then find_slot advanced the metadata; the
aborted store may or may not have landed — either way the row is at/after `n_past` while
attention is rewound to `n_common`), and the non-chat variant (`rollback_turn` keep = 0:
the attn-only rm with `p0 = 0` empties attention but the recurrent row survives; the next
`generate()` prefills `[0, n_prompt)` over an occupied recurrent row — halves diverge).

**Why the fix in 8ed1f0d does not cover it.** `prepare_from0_draft_prefill` wipes only
when the *flag* is set; the flag is set only by `clear_draft_rebuild` call sites
(session.cpp:507/511/514, the canary at 1521). On the freeze path the attn-only rm cannot
fail and coverage passes, so the flag is never set by this chain. 8ed1f0d's own comment
(1346-1348) names only the abort-cleanup-fail (R3) and the canary (R4) as reasons to wipe
before from-0 — both are flag-set scenarios.

**The evidence that this is a regression, not a pre-existing gap:** d31ad8d wiped every
one of these triggers (verified above and by round-2's audit), and the code that survived
the rewrite still *claims* the check: the trim comment (session.cpp:1789-1792: "if GDN
still sits at/past emitted_end (cannot rewind with n_rs_seq=0) we rebuild from 0 next
turn") and `docs/selfspec.md:121-124` ("if the live recurrent row still sits in the
dropped range … the draft context is cleared") describe the d31ad8d behavior, not the
code. `memory_seq_pos_max_recr` is now dead in the live loop (only
`tests/recurrent_freeze_test.cpp:128-129` nullptr checks use it).

**Gates cannot see it:** G-F5d/G-F5f/G-F5h are explicit SKIPs; G-F5e drives
`rewind_or_rebuild_draft` with the *flag-off* branch (tiny-moe: `im.freeze_recurrent` is
false) after simulating the abort cleanup as *succeeding* (`llama_memory_clear`,
session.cpp:3092) — the freeze branch (`freeze == true`) of the decision function is
executed by **no gate on any model**, and the abort cleanup in reality *fails*. G-F5g's
precondition is "flag already true" — the exact thing this chain never sets. The canary
(the only freeze-path wipe witness) is unreachable on the live loop (F3).

**Verdict: CONFIRMED.** Impact: silent, persistent draft-quality collapse after the first
mid-turn cancel (acceptance → 0, γ draft decodes still billed), one WARN per turn, no
self-repair. The emitted stream stays correct (the target governs), so no byte-identity
gate can trip.

---

## F2 — CONFIRMED (severity 1): freeze + chat prefix divergence (`n_common < emitted_end`) also misses the wipe; the next turn's drafts condition on a state that already consumed the previous answer

Same root as F1, different trigger, and the case round-2 explicitly verified as fixed
under d31ad8d: "Partial chat prefix reuse (`n_common < emitted_end`): wipe + one
conversation-length draft re-prefill — correct and unavoidable (no snapshots)".

**Trigger.** End of turn A (freeze, chat, no cancel): EOG-accepted drafts or an
`n_predict` cut leave attention `[0, emitted_end)` and the recurrent row at
`s_{emitted_end-1}` (catch-up replays only what will be emitted; round-2's arithmetic
re-verified, no budget-cut divergence since `n_draft ≤ room`). Trim at `emitted_end`:
covers → no wipe — correct *if* turn B reuses the whole prefix. But when the new prompt's
shared prefix is shorter — history re-render changes (think-mode toggle between turns,
which changes `enable_thinking` and the rendered template; message edit; truncation) —
turn B computes `n_common < emitted_end` and the turn-start rewind
(session.cpp:1206-1208, `p0 = n_common`) runs the attn-only rm to `[0, n_common)`:
`amax = n_common - 1 ≥ p0 - 1` → covers → no wipe. The draft prefill decodes
`[n_common, n_prompt)` against tail `s_{emitted_end-1}` — the state *after the assistant
answer* — read as the state *before* `n_common` (WARN, wrong base, persistent). The
target self-heals on the same divergence (snapshot rewind at session.cpp:1195-1199, with
a full-clear fallback), so the halves permanently disagree and every draft of the turn is
wrongly conditioned.

**Verdict: CONFIRMED.** Under d31ad8d the turn-start rewind wiped (`recr = emitted_end-1
≥ n_common`); 2a7f365's coverage-only decision dropped it; 8ed1f0d's `amax >= p0-1`
relaxation keeps it dropped. No gate exercises a freeze-path chat turn at all.

---

## F3 — CONFIRMED (severity 2): round-3's R1 is REFUTED — reused graphs stay frozen; the canary is silent-by-design; the R1/R4 "poisoned row from cycle 1" chain is unreachable, and 8ed1f0d's "investigated, not patched" is correct

Round-3's R1 claimed draft 2 of every group reuses the just-restored graph and computes
the store CPYs unfrozen (`noped == 0` → canary fires every cycle). The llama.cpp code says
otherwise, in three links:

1. `ggml_backend_sched_graph_compute_async` → `ggml_backend_sched_compute_splits`
   (ggml-backend.cpp:1560-1610 area) walks **every node of every split with
   `sched->callback_eval(t, true, …)` at compute time** (ggml-backend.cpp:1677-1712) and
   computes ranges only after the ask pass — the freeze's `on_ask` (router_hook.cpp:1183)
   nops the store tensors *during compute*, before that node's group runs.
2. The reuse path does not skip the walk: the callback is installed at every graph build
   (llama-context.cpp:1300) and persists across reuse — `ggml_backend_sched_reset`
   (ggml-backend.cpp:1821-1831) clears allocation state, not the callback.
3. The tensors the split walks are the same `ggml_tensor *` objects the FreezeGuard
   restore() mutates (restore runs at guard exit, the next guard re-nops at ask time), so
   consecutive 1-token drafts stay frozen whether the graph rebuilds (k-switch,
   256-cell KQ-mask bucket crossing) or reuses (`can_reuse` passes on geometry — n_kv
   padded to ≥ 256, llama-kv-cache.cpp:1227-1240; head/rs_z stable for a single
   sequence). `llm_graph_input_mem_hybrid::can_reuse` (llama-graph.cpp:984-1000) compares
   geometry/head/rs_z, never ops — the mutation at compute time is what makes reuse
   harmless.

Consequence: `noped == 0` cannot legitimately occur while the freeze works, the canary's
message "nop'd 0 store nodes" never appears (matches the ground truth), and round-3's
conclusion — "the freeze mechanism only engages on graph-rebuilding decodes … drafts 2..γ
run unfrozen" — is wrong. The 35B p2 result (0% acceptance at draft k=2 vs verify k=6,
zero WARNs) is model behavior, not freeze breakage. The FreezeGuard comment added in
8ed1f0d (router_hook.h:488-496) documents exactly the mechanism I verified.

**Residual (keeps the canary honest):** the claim in the 8ed1f0d comment rests on the ask
walk running per compute; if a future llama.cpp version skips the callback walk on reuse,
drafts 2..γ would run unfrozen and the canary would fire — and now that the canary wipes
+ flags (8ed1f0d), the repair (next-turn from-0) works. The current canary path is
self-healing at turn granularity: wipe → current turn drafts garbage-conditioned (target
still governs output) → flag → next turn full rebuild. That is the best the design can
do; the previous "flag without wipe" (2a7f365, R4) is genuinely fixed.

**Verdict: CONFIRMED (refutation of round-3 R1/R4's premise; 8ed1f0d's R1 disposition
upheld).** Not a defect of the current code — a correction to the audit record, and it
matters because it redirects attention to F1/F2 as the *actual* live-loop poison paths.

---

## F4 — CONFIRMED (severity 2): the trim comment and docs still promise the recurrent-row wipe that no code implements; `memory_seq_pos_max_recr` is live-dead

- `session.cpp:1789-1792`: "Freeze: attn-only rm; if GDN still sits at/past emitted_end
  (cannot rewind with n_rs_seq=0) we rebuild from 0 next turn". No such check exists:
  `rewind_or_rebuild_draft` (502-515) reads only attention.
- `docs/selfspec.md:121-124` (rewritten *in* 8ed1f0d): "if the live recurrent row still
  sits in the dropped range, or the attention cache does not reach p0 − 1 … the draft
  context is cleared". Same.
- `memory_seq_pos_max_recr` (memory_attn_rm.cpp:59-66): zero callers outside a nullptr
  unit test — it was the d31ad8d wipe predicate.

The docs were edited in the very commit that removed the check (8ed1f0d kept the sentence
while deleting the code path). This is the smoking gun that the wipe weakening was
unintentional, and it is exactly what makes F1/F2 silent: the maintainers believe the
recurrent-row condition still wipes.

**Verdict: CONFIRMED** (doc/comment honesty; compounds F1/F2's silent-ness).

---

## F5 — CONFIRMED (severity 3): the G-F5 gates cannot observe the freeze-path wipe decision; the freeze branch of `rewind_or_rebuild_draft` is executed by no gate

- G-F5e (tests/moe_gates.cpp:903-915): on tiny-moe, `im.freeze_recurrent == false`
  (session.cpp:624 — flag ∧ selfspec ∧ hybrid), so `rewind_or_rebuild_draft` runs the
  *stock-rm* branch, and the test simulates the abort cleanup as *succeeding*
  (`llama_memory_clear`, session.cpp:3092) — the real freeze-path cleanup *fails* and
  removes nothing (F1 step 1). G-F5e would pass unchanged even if the freeze branch were
  deleted.
- G-F5g (tests/moe_gates.cpp:889-902): preconditions `dft_need_full_prefill = true`
  (session.cpp:3117-3123); it gates `prepare_from0_draft_prefill`'s wipe — i.e. the
  fallback helper, not the decision that sets the flag. The F1/F2 chains never set the
  flag, so G-F5g's pass says nothing about them.
- G-F5f and G-F5h are SKIPs (hybrid-only). G-F5d (hybrid EOG trim) is a SKIP.
- The only freeze-branch execution in the whole gate suite is the restore walk's own
  copy of the logic (`test_selfspec_restore`, session.cpp:2860-3010), which exercises
  neither the trim, nor rollback_turn, nor the turn-start rewind at their real call sites.

**Verdict: CONFIRMED** (gate-coverage gap; the honest accounting matches round-2's N4/N5:
no hybrid run has ever exercised the wipe branch, the EOG trim, or the chat path).

---

## State-machine lifecycles across the four commits (brief item)

**Rebuild flag (`dft_need_full_prefill`).** Introduced d31ad8d (set-only-with-wipe,
cleared only after the prefill loop completes); 2a7f365 preserved it on cancel (N1 fix);
8ed1f0d added the wipe-before-from-0 (`prepare_from0_draft_prefill`, session.cpp:478-480,
called at 1349). The flag's own lifecycle is now sound on every path I can construct:
set ⇒ cache empty; preserved across cancel and `return fail`; cleared only after a
completed from-0 prefill; a stale-true flag + `clear_kv` is harmless (idempotent wipe);
two consecutive rebuilds work. **The defect is not the flag — it is that nothing sets it
on the F1/F2 chains.**

**Wipe decision.** 0b725d3: full hybrid rm + clear fallback (broken: F1-audit). d31ad8d:
attn-only rm + `recr >= p0` (fixed cancel + divergence; missed empty-cache-after-wipe:
N1). 2a7f365: coverage-only, `amin == 0 && amax >= p0-1` (fixed N1; silently dropped the
cancel/divergence wipes: F1/F2 here; introduced the canary flag-without-wipe: R4).
8ed1f0d: coverage reads the attention min regardless of the flag (R2 fix — correct), only
`amax >= p0-1` required (R5 fix — correct), wipe-before-from-0 and canary-wipes (R3/R4
fixes — correct). **The two commits disagree exactly where the two prior audits each
focused: the d31ad8d predicate is blind to the empty cache (N1); the 2a7f365/8ed1f0d
predicate is blind to the recurrent row being ahead of the attention prefix (F1/F2).**
The correct predicate is the conjunction: "attention covers `[0, p0)` AND the recurrent
row is not at/past `p0`" (with empty-cache handled — e.g. wipe iff
`attn_covers && (recr >= 0)` after the rm), or a recurrent-data-position check instead of
the metadata that the snap already manages.

**Canary.** 2a7f365: introduced, `noped == 0` ⇒ flag-only (R4 defect). 8ed1f0d:
`clear_draft_rebuild` (wipes + flags — R4 fixed) and the hidden-dependency note. The
canary is unreachable on the live loop while the freeze works (F3) — its reachable states
are: never fires (correct freeze), or fires every cycle (broken freeze ⇒ loud once, then
1-token drafts + per-turn rebuild — degraded but correct output, self-healing).

**Snap (`memory_recr_set_pos`).** d31ad8d: introduced (F4 fix) at the catch-up;
2a7f365: gated on `freeze_engaged` (skip after a canary — correct, since the data then
sits at the last draft); 8ed1f0d: unchanged. Value `n_past - 1` is right whenever the
freeze engaged; the dead `n_past > 0 ? n_past - 1 : 0` guard is harmless (n_prompt ≥ 1).
**Clean.**

**Attention-only rm (`draft_seq_rm` / `memory_seq_rm_attn`).** 0b725d3: introduced for
the catch-up; d31ad8d: applied to trim/rewind/rollback; 2a7f365/8ed1f0d: unchanged. The
rm itself is correct and cannot fail on a GDN attention half — which is precisely why it
provides no backstop for the recurrent half. **Clean as a mechanism; its completeness is
the F1/F2 gap.**

**Catch-up replay count (`n_replay`).** 0b725d3: `1 + n_acc` including the EOG (the
original F1 trigger). d31ad8d: freeze ⇒ `min(confirmed.size(), n_predict - n_gen)`
(EOG excluded); 2a7f365/8ed1f0d: unchanged. Re-verified on every path: replay count ==
emitted count (both are the same min over the same `n_gen`; `n_draft ≤ room` so the
budget never cuts an accepted group; the EOG is excluded from `confirmed` by
construction). **Clean.**

**Ordering (cancel → abort cleanup → trim → rollback_turn → prefix-reuse →
prefill-from-0 → next turn's first draft).** The flag-carrying paths are ordered
correctly (abort cleanup runs inside `llama_decode` before the engine's branch; the
flag survives the rollback; prepare wipes before the from-0 prefill; the turn-start
rewind is skipped when the flag is set). The F1/F2 chains are the ordering failure: the
abort cleanup's *silent no-op* (n_rs_seq = 0, pos_min > 0) leaves the recurrent row
ahead, and no later stage (trim, rollback, prefix-reuse, prefill) has a predicate that
can see it.

---

## Out-of-scope observations (pre-existing, not introduced by these commits)

- Cancel-during-target-prefill with `n_gen > n_rs_seq` can clear the target while
  `kv_tokens.resize(n_common)` (session.cpp:1215-1217) asserts a resident prefix that is
  gone; the next turn then prefix-reuses into an empty target (wrong output, not just
  drafts). Identical code in c977d58 (F1-era rollback_turn) — pre-existing.
- Non-chat `clear_kv=false` continuation double-books both contexts by design (F1-era).
- e4-then-generate (diagnose before a live turn) leaves ctx_dft at the walk's positions
  with the flag untouched — the next turn's coverage check passes and the recurrent row
  may be ahead (debug-only flow, same family as F1/F2).

---

## What is clean

- Freeze mechanics (R1 refuted): consecutive drafts stay frozen on reused graphs; the
  canary is silent-by-design; the whitelist covers both `n_rs_seq == 0` store shapes
  (single conv CPY, delta-net-base.cpp:484-498, and the ssm CPY, :546-563).
- Flag lifecycle, snap, replay count, attention-only rm — as above.
- Flag-off invariance on the gate model: byte-identical; R2/R5 fixes verified against
  the stock `seq_pos_min` / SWA-eviction math; the stock-rm failure remains the honest
  flag-off backstop.
- 8ed1f0d's R3/R4 fixes do what they claim (G-F5g's simulation is faithful *for its
  modeled precondition*; the canary now wipes).

## Severity order

1. **F1** — cancel mid-cycle on the frozen hybrid: recurrent row ahead of the rolled-back
   prefix, no wipe, next turn drafts from a state containing the cancelled turn's tokens.
   Reopened by 2a7f365, kept open by 8ed1f0d; ungated (G-F5e runs the flag-off branch
   against a simulated-success cleanup).
2. **F2** — chat prefix divergence on the frozen hybrid: same missed wipe; the case
   round-2 verified as fixed under d31ad8d.
3. **F3** — round-3's R1 refuted (ask walk runs at compute); the canary and its repair
   are sound; 8ed1f0d's investigation upheld.
4. **F4** — trim comment and docs still promise the recurrent-row wipe; the predicate is
   gone and `memory_seq_pos_max_recr` is live-dead.
5. **F5** — gate-coverage: the freeze branch of the wipe decision is executed by no gate.

The net statement: the freeze, the canary, the snap, the replay count, and the flag are
sound; the wipe decision is the cross-commit fault line — d31ad8d's recurrent-metadata
check (correct for the cancel/divergence states) was replaced by 2a7f365/8ed1f0d's
attention-coverage check (correct for the empty-cache state), and no commit combined
them. The fix direction: make the freeze-path wipe also fire when the recurrent row is
at/past `p0` after the attn-only rm (the d31ad8d predicate, kept alongside the coverage
check, with the `recr == -1` empty-cache case excluded), and add a gate that drives the
freeze branch with the abort cleanup *failing* (the real behavior) instead of clearing.

DONE
