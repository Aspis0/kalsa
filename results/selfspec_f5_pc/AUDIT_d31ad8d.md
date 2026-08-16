# Hostile audit round 2 — d31ad8d "fix(engine): close F5 audit findings on frozen drafting"

Audited commit `d31ad8d` on `kalsa/selfspec-f1` (`git show d31ad8d`, diff `c977d58..d31ad8d`).
322 insertions / 9 files. Reading base: `core/src/engine/session.cpp`,
`core/src/engine/memory_attn_rm.*`, `core/src/moe/recurrent_freeze.cpp`,
`core/src/moe/router_hook.h`, `third_party/llama.cpp` (`llama-memory-recurrent.cpp`,
`llama-memory-hybrid.cpp`, `llama-kv-cache.cpp`, `llama-context.cpp`), the F5 REPORT
(`results/selfspec_f5_pc/REPORT.md`, `STATUS.txt`, p1/p2 logs). No source files edited.

Prior audit's six findings: the commit claims to close F1–F6. Verdicts below; four of
six are genuinely closed (F1 with one residual corner, F3, F5, F6), F2 is closed as a
gate but unmeasured on a hybrid, F4 is fixed for the noise at the cost of silencing the
failure the warning revealed. Two new defects found (N1, N2), one of which (N1)
re-opens the original F1 corruption on a concrete double-cancel trigger.

---

## N1 — PLAUSIBLE, HIGH: the rebuild flag is lost on cancel during the rebuild prefill; the original F1 corruption is reachable again

**File/line:** `session.cpp:1326` (`im.dft_need_full_prefill = false;` reset *before* the
prefill loop), `session.cpp:1184-1192` (turn-start skip when flag set), `session.cpp:1212-1222`
(rollback_turn), `session.cpp:474-489` (`rewind_or_rebuild_draft`), `session.cpp:1741-1745`
(trim).

**Mechanism.** The F1 fix's backstop is the `recr >= p0` test in `rewind_or_rebuild_draft`,
which reads `memory_seq_pos_max_recr`. After a wipe, `llama_memory_recurrent::clear(true)`
resets `cell.pos = -1` (`llama-memory-recurrent.cpp:125-137`), and `seq_pos_max` returns -1
for an empty memory (`:380-386`). So the backstop cannot distinguish "empty and needs
rebuild" from "empty and fine" — it only fires when `recr >= p0`, i.e. when *something* was
decoded past the target point.

Concrete trigger chain (freeze + hybrid + chat):

1. Turn A ends cancelled mid-generation → `rollback_turn()` → `rewind_or_rebuild_draft(n_common)`:
   recurrent row at the last emitted position ≥ `n_common` → wipe → `dft_need_full_prefill = true`.
2. Turn B: prefill section computes `dft_from = 0` and clears the flag *before* the loop
   (`session.cpp:1326-1327`). User cancels during the draft-context prefill's first chunk.
   llama.cpp's own abort cleanup then calls `memory->seq_rm(s, pos_min[s], -1)` with
   `pos_min = 0` (`llama-context.cpp:1813-1827`) → recurrent `rm_all` path erases every cell
   and zeroes `rs_idx` (`llama-memory-recurrent.cpp:177-237`, returns true) → `ctx_dft` is
   empty on both halves, `recr = -1`. The engine's cancel branch calls `rollback_turn()`
   (`session.cpp:1334-1337`): attn-only rm on the empty cache returns true, `recr = -1 < n_common`
   → **no wipe**; the flag is already false.
3. Turn C: turn-start rewind runs (`!dft_need_full_prefill`), attn rm returns true,
   `recr = -1` → no wipe. Prefill decodes only `[n_common, n_prompt)` into the *empty*
   `ctx_dft` → attention never sees positions 0..n_common−1 (causal mask spans missing cells),
   the recurrent half reads the zeroed initial state as "state before n_common" — the exact
   silent prefix-less-draft corruption of the original F1 finding. Nothing errors; on the
   recurrent half the resume is even consecutive (empty cache), so no WARN either.

Wider variant: cancel during rebuild-prefill chunk *k* with `k*n_batch − 1 < n_common`
(history longer than k batches): the abort cleanup's rewind fails (`rollback = n_batch >
n_rs_seq = 0` → hybrid `seq_rm` short-circuits false, cleanup skipped), `recr` stays at
`k*n_batch − 1 < n_common` → no wipe → next turn's prefill from `n_common` lands behind a
gap; attention silently missing `[k*n_batch, n_common)`, recurrent data at
`s_{k*n_batch−1}` treated as state-before-n_common. This variant at least fires the
recurrent non-consecutive WARN (visible, non-fatal).

**Why the existing gates cannot see it.** G-F5d' (`test_draft_rebuild_after_rm_fail`,
`session.cpp:2968-3000`) calls `clear_draft_rebuild` *directly* — it tests the fallback
helpers, not `rewind_or_rebuild_draft`, not the `recr >= p0` decision, not the
flag-reset-before-loop, not any cancel path. It passes even if `rewind_or_rebuild_draft`
never wipes. The gate's "fails before / passes after" reduces to "didn't compile before".
On tiny-moe (non-hybrid) the freeze path is dead code anyway.

**Fix direction (for the record):** reset `dft_need_full_prefill` only after the prefill
loop completes, or make the rollback/turn-start wipe test `attn_pos_min != 0` (or
`recr >= 0`) instead of `recr >= p0` on the freeze path — the wipe decision should key on
"does the cache cover the prefix", not on the recurrent metadata.

---

## N2 — PLAUSIBLE: F4's snap silences the freeze-failure WARN *and* disables the F1 rebuild backstop for a broken freeze

**File/line:** `memory_attn_rm.cpp:84-100` (`memory_recr_set_pos`), call sites
`session.cpp:1619-1621` (live), `session.cpp:2902-2904` (walk).

The snap value (`n_past − 1`) is correct exactly when the freeze is intact: the frozen
drafts wrote nothing, so the data is at `s_{n_past−1}` and the metadata lies ahead at
`n_past + n_draft − 1`. I verified the arithmetic on every path (first cycle after normal
prefill, after rebuild prefill, after partial prefill, consecutive rejected cycles) — the
value is right whenever the whitelist nop'd the stores.

But the fix has the property the brief asked about: **a freeze regression becomes silent,
and worse than silent**. If a whitelist miss or a future graph change lets the frozen
drafts write (e.g. a fused non-CPY store that `is_store_op` deliberately does not nop —
`recurrent_freeze.cpp:32-36`), the row data sits at `s_{n_past+n_draft−1}`, the snap sets
metadata to `n_past−1`, the unfrozen catch-up then *reads the poisoned row as its initial
state* and bakes the corruption into every subsequent draft's conditioning — and the
end-of-turn trim's `recr >= p0` test now sees `recr = emitted_end − 1 < emitted_end`
(metadata, snapped then advanced by the replay) → **no rebuild**. Under F1, the same
breakage (a) WARN'd on every rejected cycle and (b) left metadata at the last draft
position ≥ `emitted_end`, so the trim wiped and the next turn self-repaired. The snap
removes both the warning and the repair. The only remaining witnesses — G-F5c's data hash
and e4's `noped_seen` — run in the diagnostic walk only, never on the device.

The live evidence that the snap does its intended job: `p2_freeze_on.err.log` (35B hybrid,
freeze on, **0/3 drafts accepted — 100% rejection**) contains zero "non-consecutive" WARNs
across 256 tokens; under F1 that run would have emitted ~256 of them. So the trade is
real: noise removed in the benign case, canary removed in the failure case.

Verdict on the audit question: the value is always right *when the freeze works*, and the
snap's silence is exactly the failure the old warning would have revealed. This is the
six findings' closest to "papered over".

---

## F1 (original finding) — CONFIRMED-closed on the normal paths; one residual corner (N1)

I re-derived the live-path arithmetic for every exit the trim/rewind sites can see:

- **EOG accepted as draft i** (i ≥ 0): catch-up now replays `n_replay = min(confirmed.size(),
  n_predict − n_gen)` (`session.cpp:1614-1615`) where `confirmed` excludes the EOG by
  construction (`session.cpp:1560-1568`) and the emit loop emits exactly `min(confirmed.size(),
  budget)` (`:1670`) — replay count == emitted count on every path, including the budget cut
  (both expressions are the same `min` over the same `n_gen`). Recurrent row ends at
  `emitted_end − 1`; trim (`rewind_or_rebuild_draft(emitted_end)`) rm's attention
  `[emitted_end, ∞)` (no-op) and the `recr >= p0` test sees `emitted_end − 1 < emitted_end`
  → no wipe. Turn 2's chat rewind at `n_common = emitted_end`: recr `= n_common − 1` → no
  wipe; prefill resumes consecutively on both halves.
- **Full rejection (n_acc = 0)**: replay `[tok]`, recr `= n_past = emitted_end − 1` → no wipe.
- **n_predict cut mid-group**: replay truncated to the budget, recr `= emitted_end − 1` → no wipe.
- **Loop-top EOG**: no catch-up that cycle; recr from the previous replay `= emitted_end − 1`.
- **Cancel in draft loop / verify / catch-up**: metadata is ahead of the data (find_slot ran
  or drafts advanced pos) → `recr >= p0` fires at the trim and/or rollback → wipe → correct
  (the recurrent row genuinely cannot rewind; the wipe is the honest fallback).
- **Partial chat prefix reuse (n_common < emitted_end)**: wipe + one conversation-length
  draft re-prefill — correct and unavoidable (no snapshots), and the docs state the cost.

So there is no silent per-turn full re-prefill on the normal paths, and no missed wipe
either — except N1. Bonus repair found: the flag-off rm-failure branch now rebuilds from 0
instead of F1's clear-then-prefill-from-`n_common` bug (`session.cpp:486-487`), fixing the
same corruption class for SWA-class models with the flag off.

**Verdict: genuinely closed for the normal flow; N1 re-opens the corruption on the
cancel-during-rebuild-prefill corner.**

## F2 (original finding) — CONFIRMED-closed as a gate

`memory_recr_data_hash` (`memory_attn_rm.cpp:56-80`) hashes the actual R/S bytes of all
layers (`r_l`, `s_l`, full `ggml_nbytes`, `ggml_backend_tensor_get`), bracketing only the
frozen draft decodes (`session.cpp:2823-2836`; hash_before before the draft loop, hash_after
after; the previous cycle's unfrozen catch-up wrote before hash_before, so the pair isolates
the drafts). Because it reads bytes, it would also catch a *fused* non-CPY write that the
whitelist cannot nop — the old metadata comparison caught nothing. Correct placement,
hybrid-gated, and the gate explicitly reports `recr_data_checked=false` on tiny-moe instead
of claiming coverage (`tests/moe_gates.cpp:856-860`). It is not vacuous.

Residual: it runs only in `test_selfspec_restore`, which has never been run on a hybrid
(see N4), and the walk computes both hashes on every cycle even flag-off (2×62.81 MiB per
cycle of copy+FNV on a 35B flag-off walk — perf nit, walk-only).

## F3 (original finding) — CONFIRMED-closed

The freeze-arm probe is now the catch-up leftover (`session.cpp:2905-2928`): the catch-up
decode asks for logits (`catchup_logits = freeze && (force || purity)`, `:2905`) and the
probe reads `llama_get_logits_ith(ctx_dft, -1)` instead of re-decoding. Verified the
quantities are the same as the old probe's intent: force arm replays `[tok]` at `n_past` →
leftover = prediction after tok ↔ `pred_idx = t+1` ✓; purity arm replays `[tok, gold[t+1]]`
→ leftover = prediction after gold[t+1] ↔ `pred_idx = t+2` ✓. The double-application
(s_after_tok read as state-before-tok) is gone because the leftover is produced by the same
unfrozen replay that legitimately advanced the row. Flag-off keeps the old rewind+redecode
probe, where the snapshot-plane rewind makes it correct.

Residual (minor, debug-only): the freeze-arm leftover is conditioned at `dft_prefix_k`
while the flag-off probe decodes at `draft_k` and the serial reference is at `draft_k` —
with `--selfspec-draft-prefill-k` set (a DEBUG knob), the freeze probe compares a
mixed-k prediction against the reference. Production (`knob = 0`) is identical k. The
output field names (`n_exact`, `first_diverge`, …) are unchanged, so the semantics shift
under the knob is invisible in the CSV.

## F4 (original finding) — fixed for the noise; the silence trade is real (N2)

On the evidence the fix works as advertised when the freeze is intact: the 35B p2 run with
100% rejection shows zero non-consecutive WARNs (under F1: one per rejected cycle). The
WARN was benign noise for a correct freeze, so removing it is the stated goal. The cost is
N2: the same metadata is what the F1 trim backstop reads, so a broken freeze now evades
both the warning and the end-of-turn rebuild, with only walk-only witnesses left.

## F5 (original finding) — CONFIRMED-closed

`session.cpp:2212-2216`: the e4 guard now accepts `im.freeze_recurrent`; the callback-install
condition includes it (`session.cpp:614`); `im.freeze_recurrent` is flag ∧ is_selfspec ∧
hybrid (`session.cpp:602-605`), so non-hybrid+flag still lands on the earlier
`E4_BLOCKED(no-recurrent-state)` guard with the correct message; config validation already
rejects the flag for MTP/ngram/no-source (`config.cpp:118-121`). Clean.

## F6 (original finding) — CONFIRMED-closed

The 314 MiB figure was re-measured on the real hybrid, not re-quoted: `REPORT.md` documents
p1/p2 (`RS buffer = (n_rs_seq+1) × 62.81 MiB`; 314.06 → 62.81; saving 251.25 MiB at γ=4,
502.5 at γ=8), a correction note explaining the earlier error, and a bit-stable reproduction
on the fix binary (STATUS.txt run at 07:19, git_rev=d31ad8d: 5525.1 / 6176.3 / 5915.9 MiB,
wall 27/46.4/45.5 s). CHANGELOG and `docs/selfspec.md` carry 251.25 everywhere, with the
`p1/p2` attribution, and the docs say what was measured. The original finding's *branch*
half (skip-write on the `n_rs_seq == 0` single-store branch) is now exercised live: p2 ran
the freeze on the real model for 256 tokens at 100% rejection with zero WARNs and no crash
— but see N5 for what that run does *not* cover.

---

## Regression sweep (brief item 6)

- **Flag-off byte-identity:** preserved. `draft_seq_rm` flag-off calls `llama_memory_seq_rm`
  (same as F1); `rewind_or_rebuild_draft` flag-off is the F1 rm+clear with the same calls on
  the success path; `n_replay`/snap/hash/guard are all gated on `im.freeze_recurrent`;
  `dparams.n_rs_seq` flag-off = draft_max; cb_eval condition unchanged flag-off. The only
  flag-off behavior change is the rm-failure rebuild-from-0 (an F1-bug repair, see F1).
- **RAII/guard scope:** `FreezeGuard` is per-draft-iteration at all three sites
  (`session.cpp:1468`, `:2232`, `:2829`); destructs on `break`, cancel, and `return fail`
  paths (stack unwinding). No guard is active during prefill, verify, catch-up, or the
  trims; the e4 catch-up replay and the shape-reference walks are unguarded.
- **Off-by-one:** snap value `n_past−1` equals `batch_start − n_seq_tokens` for the replay
  (`find_slot`'s consecutiveness test, `llama-memory-recurrent.cpp:638`); `emitted_end`
  boundaries verified; walk's `accepted_pos = n_past + n_acc` == attn max after the replay.
  The `n_past > 0 ? n_past − 1 : 0` guard is dead code (n_prompt ≥ 1 enforced at
  `session.cpp:1123`), harmless.
- **Null/empty edges:** all four new helpers null-guarded; `memory_recr_set_pos`
  bounds-checks seq_id and tail; `draft_seq_rm` only reached with live `ctx_dft`;
  `rewind_or_rebuild_draft` guards null.
- **New path with freeze active during verify/prefill:** none found.
- **The e4 walk** still uses its own attn-only rm + replay and comments the WARN as
  "expected" (`session.cpp:2415-2419`) — e4 does not use the snap; fine (diagnostic).

---

## What the hybrid evidence actually covers (N4/N5, honest accounting)

- p2 (freeze on, 35B): RAM claim real (62.81 MiB draft RS buffer), live mechanics of the
  rejection path (attn-only catch-up rm, snap, replay) ran 256 tokens, zero WARNs, no crash,
  RSS −260 MiB corroborated. **But alpha is 0% on BOTH p1 and p2** (draft k=2 vs verify k=6
  on this prompt), so the hybrid runs witnessed only full-rejection cycles: the
  EOG-accepted-draft trim path (the heart of F1), the wipe branch (`recr >= p0` firing),
  the chat multi-turn path, and the restore-walk probes have **never executed on a hybrid**
  in any recorded run. The walk itself (`test_selfspec_restore`) has never run on the 35B,
  so F2's hash and F3's leftover probe are host-gate-only (tiny-moe: freeze is a no-op).
  The docs are honest about this; the commit message's "G-F5d' fails before / passes after"
  is the weakest of the claims (it means "did not compile").

## Severity order

1. **N1** — the F1 corruption re-opens on cancel-during-rebuild-prefill (double-cancel
   trigger); silent, ungated, on the feature's intended target.
2. **N2** — F4 snap converts freeze failure from "WARN + self-repair next turn" into
   "silent, persistent poison"; compensation is diagnostic-walk-only.
3. **N3** — freeze probe k-mix under the debug prefix-k knob (walk-only, debug-only).
4. **N5** — hybrid evidence covers only the rejection path; EOG-accepted trim and wipe
   branch unmeasured on a hybrid.
5. **N4** — F2 hash real but unmeasured on a hybrid; per-cycle cost on flag-off walks.

## Which of the six original findings are genuinely closed

- **F1**: closed on all normal paths (verified exhaustively); one residual corner (N1).
- **F2**: closed as a gate design; unmeasured on a hybrid (N4).
- **F3**: closed; debug-knob k-mix residual (N3).
- **F4**: noise fixed, demonstrated live; failure-witness removed (N2) — the closest to
  papered over.
- **F5**: closed, clean.
- **F6**: closed; re-measured, corrected, reproduced, docs aligned.

DONE
