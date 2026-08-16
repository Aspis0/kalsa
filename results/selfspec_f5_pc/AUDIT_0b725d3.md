# Hostile audit — 0b725d3 "wire stateless drafting into the speculative loop"

Audited commit `0b725d3` on `kalsa/selfspec-f1` (`git show 0b725d3`, `git diff c977d58..0b725d3`).
258 insertions, 13 files. No source files were edited.

Reading base: `core/src/engine/session.cpp`, `core/src/engine/memory_attn_rm.*`,
`core/src/moe/router_hook.h` (FreezeGuard), `core/src/moe/recurrent_freeze.cpp`,
`third_party/llama.cpp` (`llama-memory-recurrent.cpp`, `llama-memory-hybrid.cpp`,
`llama-graph.cpp`, `models/qwen35.cpp`, `models/delta-net-base.cpp`,
`llama-context.cpp`), the F5 spec, the E4 spec, the F1 report.

The known weakness (tiny-moe is not hybrid, the freeze is a no-op, `recr_untouched`
is vacuous) is real and confirmed, but it is the *least* of it. The hybrid path has
a guaranteed failure on chat sessions, and the new gate cannot see it. Everything
below is derived from the code; nothing required a hybrid to observe.

---

## F1. CONFIRMED — on a real hybrid, every turn that ends with an accepted EOG draft full-clears `ctx_dft`; the next turn silently drafts from a context that never saw the conversation

**The chain (all three links are in the commit's own reachable paths):**

1. **The end-of-turn trim still uses the full hybrid `seq_rm` on the draft context.**
   `session.cpp:1695` — unchanged by this commit:
   ```cpp
   if (im.ctx_dft && !llama_memory_seq_rm(llama_get_memory(im.ctx_dft.get()), 0, emitted_end, -1))
       llama_memory_clear(llama_get_memory(im.ctx_dft.get()), true);
   ```
   With the freeze on, `ctx_dft` was created with `n_rs_seq = 0` (`session.cpp:644`).
   `llama_memory_hybrid::seq_rm` runs the recurrent half first and short-circuits
   (`llama-memory-hybrid.cpp:143-150`), and `llama_memory_recurrent::seq_rm`'s
   snapshot-rewind path requires `rollback <= n_rs_seq` — with `n_rs_seq = 0` any
   partial rewind returns false (`llama-memory-recurrent.cpp:178-187`).
   **Trigger:** the normal greedy termination. When the model's EOG token is
   accepted as a *draft* (`eog_hit`), the catch-up replay advanced the recurrent
   tail to `emitted_end` (the EOG position: the catch-up replays `1 + n_acc` tokens
   including the EOG — `session.cpp:1570-1579`; `find_slot` sets `cell.pos =
   last_pos`, `llama-memory-recurrent.cpp:636-644`). The trim calls
   `seq_rm(0, emitted_end, -1)` with `p0 == cell.pos` → rewind path → rollback = 1
   → `1 <= 0` false → **false** → `llama_memory_clear(ctx_dft, true)`. Full clear,
   every EOG-accepted turn. Cancels hit the same path via `rollback_turn`
   (`session.cpp:1166`, chat branch: `keep = n_common > 0` → same false → clear).
   The `tok`-is-EOG-at-loop-top termination happens to avoid it (tail = emitted_end
   − 1, no rewind needed) — but that is luck, not design.

2. **The clear fallback is broken for the draft context.** The target's fallback
   resets `n_common = 0` (`session.cpp:1135-1137`) so the next turn re-prefills
   from 0. The draft context's fallback at `session.cpp:1145` clears without
   touching `n_common`, and the draft-context prefill loop starts at `n_common`,
   not at 0 (`session.cpp:1264-1272`):
   ```cpp
   for (int i = (int) n_common; i < n_prompt; i += im.cfg.n_batch) { ... llama_decode(im.ctx_dft.get(), ...) }
   ```
   After the clear, `ctx_dft` holds *nothing*, but the loop decodes the suffix
   tokens at positions `n_common..n_prompt-1` into it. The attention half never
   sees positions 0..n_common−1 (KQ mask spans the missing cells), and the
   recurrent half reads the zeroed initial state as "state before n_common".
   Nothing errors: the prefix-reuse rewind at `session.cpp:1144` succeeds trivially
   on an empty cache (no cells → no rewind needed), so no `n_common` reset, no
   warning. The engine's own F1 comment states the invariant that is now broken:
   *"not cleared, or a continued chat turn would feed it only the new suffix and
   draft from a state that never saw the conversation"* (`session.cpp:1691-1694`).

3. **Consequence: silent, persistent draft-quality collapse, not a crash.** The
   emitted stream stays correct — the target context is intact and the verify
   decode governs (`session.cpp:1500-1511`; the target's own trim works, it has
   `n_rs_seq = draft_max`, `session.cpp:617`). But every draft from turn 2 onward
   is conditioned on a prefix-less context, so acceptance collapses toward the
   no-speculation floor while the engine still pays for γ draft decodes *and* a
   full re-prefill of the whole conversation through `ctx_dft` every turn. On a
   streamed device that re-prefill is expert re-reads from flash — the feature
   silently becomes pure overhead plus RAM saving.

**Verdict: CONFIRMED.** Trigger: `--selfspec-freeze-recurrent` on any hybrid
(qwen35moe / qwen3next-class), chat mode, turn ends with an accepted EOG draft —
the common greedy termination. Nothing in the commit's three gates exercises any
link of this chain (tiny-moe is non-hybrid, so `llama_memory_seq_rm` on `ctx_dft`
never fails and the fallback never fires).

---

## F2. CONFIRMED — G-F5c's `recr_untouched` cannot detect a broken freeze, even on a real hybrid

`session.cpp:2841-2845`:
```cpp
const llama_pos recr_before = memory_seq_pos_max_recr(dft_mem, dft_hybrid, 0);
if (!draft_seq_rm(ctx_dft, n_past, im.freeze_recurrent)) ...
const llama_pos recr_after = memory_seq_pos_max_recr(dft_mem, dft_hybrid, 0);
if (im.freeze_recurrent && dft_hybrid && recr_before != recr_after) out.recr_untouched = false;
```
Two independent reasons this measures nothing:

- **By construction:** with the freeze on, `draft_seq_rm` is the *attention-only*
  rm (`session.cpp:74` → `memory_seq_rm_attn`). The recurrent half is untouched by
  the rm by definition, so `recr_before == recr_after` always. The check verifies
  the rm code, not the freeze.
- **By mechanism, the recurrent position metadata is not the state.** During the
  frozen drafts, `find_slot` advances `cell.pos` to `n_past + n_draft − 1` on every
  draft decode (`llama-memory-recurrent.cpp:636-644`) even though the store CPYs
  are nop'd — the *data* stays s_{t0}, the *metadata* runs ahead by up to γ−1.
  `seq_pos_max_recr` reads the metadata. So even the value the check compares
  against is not "where the recurrent state actually is". If the freeze silently
  broke (store not nop'd), the drafts would write the tail, `recr_before` would
  still equal `recr_after` (the rm never touches recr), and the gate passes with a
  fully poisoned state. The e4 walk's own comments acknowledge the metadata/data
  divergence (`session.cpp:2320-2326`: "Recurrent cell.pos still names the last
  draft (attn-only rm)") — the walk authors knew, and the gate reads exactly that
  misleading number.

**Verdict: CONFIRMED.** The only regression the check can catch is `draft_seq_rm`
reverting to the full hybrid rm (which would then fail loudly with `n_rs_seq=0`).
A freeze regression — the thing the gate is named for — is invisible.

---

## F3. CONFIRMED — `test_selfspec_restore`'s probe decodes from a recurrent state shifted by one token on the frozen hybrid path

`session.cpp:2868-2881` (force arm): the probe rewinds with `draft_seq_rm(ctx_dft,
probe_pos, freeze)` — attention-only — then decodes `probe_tok` at `probe_pos`
**unfrozen** (no FreezeGuard). With `probe_pos == n_past`, the catch-up replay just
advanced the recurrent tail to s_{n_past} (`session.cpp:1576-1579`). The probe
decode at position `n_past` reads the tail as "state before n_past" — it contains
s_{n_past} — the state *after* the probed token. The probe logits are computed from
a state that has already consumed `tok`, i.e. a double application, and are
compared against the serial reference at `pred_idx` (`compare_at`, `session.cpp:
2883`). On the F1 path this worked because the *full* rm rewound the recurrent
half via the snapshot planes before the probe. On the frozen path no rewind is
possible (`n_rs_seq = 0`) and the probe is unfrozen, so it cannot be correct.
The purity arm (probe at `n_past+1` after a 2-token catch-up) has the same shift.

Impact: the walk is the diagnostic the feature is supposed to be verified with,
and on the device it targets its core measurement (n_exact / n_argmax_match /
first_diverge) is corrupted. G-F5c does not check those fields (`moe_gates.cpp:
808-814` checks only `n_rejects`, `draft_attn_pos_max == accepted_pos`,
`recr_untouched`), so the gate still passes on a hybrid with a broken probe — the
compare results are printed by `cli/main.cpp:970-971` as if they were meaningful.

**Verdict: CONFIRMED** (diagnostic-quality defect; the live loop itself does not
have a probe, so the emitted stream is unaffected).

---

## F4. CONFIRMED — every rejected cycle on a frozen hybrid fires the recurrent "non-consecutive token position" WARN

After γ frozen drafts, the recurrent `cell.pos` metadata sits at
`n_past + n_draft − 1`. The catch-up replay batch of `1 + n_acc` tokens triggers
`find_slot`'s consecutiveness check: `last_pos != cell.pos + n_seq_tokens`
whenever `n_acc < n_draft − 1` — i.e. every rejection, and with `n_acc = 0`
always (`llama-memory-recurrent.cpp:638-642`). The engine's own invariant checker
flags the frozen pattern on every rejected cycle as suspicious ("What should
happen when the pos backtracks or skips a value?" — the code proceeds). Benign in
isolation, but it is the same metadata divergence that makes G-F5c's recr reading
meaningless, and a user on a hybrid will see this WARN in a tight loop.

**Verdict: CONFIRMED** (noise / observability; confirms the divergence in F2 is
not hypothetical).

---

## F5. CONFIRMED (minor) — `--selfspec-freeze-recurrent --selfspec-diag e4` with MoE off reports a false E4_BLOCKED(engine)

The callback-install condition now includes `im.freeze_recurrent`
(`session.cpp:610`), but the e4 guard still requires
`cfg.spec.recurrent_freeze_hook || moe.enabled` (`session.cpp:2163-2166`). With
the freeze flag on and `--moe-stream` off, the callback is installed, skip-write
would engage, and e4 still refuses with "recurrent_freeze_hook was not armed at
context init" — now false. The check should also accept `freeze_recurrent`.

**Verdict: CONFIRMED** (misleading error, no functional harm).

---

## F6. CONFIRMED (validation gap, not a code bug) — the F5 hybrid path runs a graph branch E4 never measured

E4 ran on the 35B with `ctx_dft` at `n_rs_seq = draft_max` (the F1 default): the
freeze nop'd the K-split conv stores and the ssm store of the *snapshot* branch,
and `noped_seen >= 1` proved skip-write engaged on that branch
(`session.cpp:2407-2412`). The F5 commit switches `ctx_dft` to `n_rs_seq = 0`,
which selects the *other* branch of `build_conv_state` — a single store into the
head row instead of K snapshot copies (`delta-net-base.cpp:469-498`, the
`cparams.n_rs_seq == 0` arm). That branch is stock llama.cpp (pre-rollback hybrid
mode), but skip-write on it — the specific combination of the nop'd single conv
store plus the read-before-write tail semantics — is validated only by reasoning
here, never measured. The new gates cannot substitute: on tiny-moe the freeze is a
no-op, and on a hybrid G-F5a would only run if someone builds the test model. The
live loop also has no `noped_seen`-style witness — a whitelist miss on the
`n_rs_seq == 0` store shapes (e.g. a future fused write) would be silent.

Also on the honesty ledger: the CHANGELOG and `docs/selfspec.md` state the 314 MiB
figure as fact ("the 314 MiB of recurrent snapshots at γ=4 is dead weight") while
the F5 spec explicitly says "re-measure, do not copy it forward"
(`docs/f5-stateless-loop-spec.md` §6, §1). The commit says "the 314 MiB" in the
context-construction comment (`session.cpp:635`) too. The figure is F1's
measurement on this model at γ=4; restating it as settled is the exact
documented error the spec forbids.

**Verdict: CONFIRMED as gap + doc claim.**

---

## Refuted / clean categories (checked, nothing found)

- **Ordering (Q1).** The `FreezeGuard` is scoped to one draft iteration
  (`session.cpp:1423`); its destructor runs on every exit — normal, `break` on
  EOG, cancel `break`, decode failure `return fail`, e4, and the restore walk
  (`session.cpp:2181`, `2775`) — and calls `set_recurrent_no_update(false)`
  unconditionally (`router_hook.h:483-497`). Verify, prefill, catch-up, cancel and
  the MTP/n-gram paths never run with the freeze set. `saved_` is restored and
  emptied at guard exit; no accumulation across graph rebuilds (k-switch rebuilds
  create fresh store tensors, the next guard nops them). The freeze is per-graph
  and the decode is single-threaded, so the shared hook is not a race. No draft
  path escapes the guard; no non-draft path is guarded.
- **Catch-up advances recurrent state exactly once per accepted token (Q4).**
  Proven from the code: the frozen drafts nop the store CPYs (`recurrent_freeze.cpp`
  whitelist CPY/DUP, roots `cache_r_l*`/`cache_s_l*`; the GDN ssm store and conv
  store are both such CPYs — `delta-net-base.cpp:530+`, `:469-498`), and the
  recurrent memory reuses one cell per sequence, so every frozen draft reads the
  same tail content s_{t0} and writes nothing; the unfrozen catch-up replay
  `[n_past, n_past+n_acc]` is the only writer and advances the state data exactly
  once per replayed token; the next cycle's drafts read the advanced tail. Zero
  or double advancement would require a store escaping the whitelist — the E4
  `noped_seen` witness and σ>0 rows covered the *snapshot* branch on the 35B (see
  F6 for the branch gap).
- **Mid-loop rollback correctness (Q2, live path).** The catch-up rm
  (`session.cpp:1570`) is converted to attention-only; the target's rejected-tail
  rollback (`session.cpp:1596`) correctly stays full (target has snapshots). The
  chat/cancel full-rm sites are the failure, but not for the reason stated in the
  commit message — see F1: the reasoning "clear + re-prefill is the fallback" is
  only sound if the re-prefill starts at 0; for `ctx_dft` it starts at `n_common`.
  So: the *rationale* is unsound, the *mechanism* of the failure is the clear
  fallback, not the rm choice per se.
- **Flag-off invariance (Q5).** With the flag off, `draft_seq_rm` calls
  `llama_memory_seq_rm` (same call as F1), the guard calls `set_recurrent_no_
  update(false)` on an empty `saved_` list (no-op), the cb_eval install condition
  is unchanged, and `dparams.n_rs_seq` reproduces F1 (`session.cpp:644`).
  Byte-identical path confirmed. `draft_n_rs_seq()` is a new read-only accessor.
- **Null/empty edges, off-by-one, equality, RAII under early return.** `memory_seq_
  pos_max_*` null/hybrid-guarded (`memory_attn_rm.cpp:37-53`); `draft_seq_rm` only
  reachable with `ctx_dft` live; accepted-prefix arithmetic (`keep = n_past+1+n_acc`,
  replay `[n_past, n_past+n_acc]`) is consistent with F1 and with the EOG case;
  G-F5c's attn measurement is placed after catch-up and before the probe
  (`session.cpp:2850-2852`) — correct placement; the attn check itself
  (`draft_attn_pos_max == accepted_pos`) is a genuine rm-hygiene assertion (it
  would catch an rm leak). Config validation for the flag (`config.cpp:115-122`)
  is correct and tested.
- **Dead code:** none that matters; `memory_seq_pos_max_recr` is used exactly once
  and is the wrong measurement (F2), not dead weight.

---

## Severity order

1. **F1** — silent draft-quality collapse + per-turn full re-prefill on the
   feature's intended target (hybrid + chat), from the very first conversation
   turn that ends with an accepted EOG. High severity; not caught by any gate.
2. **F2** — the feature's own "rollback hygiene" gate cannot detect the freeze
   failing; combined with F1 it gives false confidence on the hybrid path.
3. **F3** — the restore walk's probe measurement is corrupted on the frozen
   hybrid path (state shifted by one token), and the gate ignores the corrupted
   fields.
4. **F4** — per-rejection WARN noise on hybrid, exposing the metadata divergence.
5. **F6** — unmeasured graph branch + a re-quoted 314 MiB figure the spec says to
   re-measure.
6. **F5** — false E4_BLOCKED for a legal flag combination.

The core loop mechanics (guard scope, attention-only catch-up rm, one-shot
catch-up advance) are sound. The defect is concentrated in the *other* rm sites —
the end-of-turn trim, the chat rewind, `rollback_turn` — which the commit left on
the stock hybrid rm, plus the gate and probe instrumentation that cannot see the
damage.

DONE
