# FINAL audit B — removed behaviour and flag-off regression on the whole F5 diff

Audited cumulative diff `git diff c977d58..8ed1f0d` (4 commits: `0b725d3`, `d31ad8d`,
`2a7f365`, `8ed1f0d`) on `kalsa/selfspec-f1`. Angle: **what these commits took away or
silently changed for code paths that do NOT set `--selfspec-freeze-recurrent`**, and the
specific `8ed1f0d` change that dropped the `amin == 0` requirement from the wipe decision.
Reading base: `core/src/engine/session.cpp`, `core/src/engine/memory_attn_rm.{h,cpp}`,
`core/src/moe/router_hook.{h,cpp}`, `core/src/moe/recurrent_freeze.cpp`,
`tests/moe_gates.cpp`, the F5/REPORT evidence
(`results/selfspec_f5_pc/`), and the three prior audits. No source files edited.

## Headline

At HEAD the flag-off path is **correct** — byte-equivalent to F1 except for one additive,
no-op `draft_covers_prefix` call. But the four commits did **silently regress and then
silently repair** the flag-off *hybrid* across the span: `2a7f365` replaced the F1/d31ad8d
wipe decision with a coverage check that, because it was handed the *freeze flag* instead of
the *model-hybrid* flag, wiped the flag-off hybrid draft context on **every turn**
(review3 R2 — a hidden per-turn full conversation re-prefill from flash, invisible because
acceptance is unchanged). `8ed1f0d` repaired it by passing `im.model_hybrid` and dropping
`amin == 0`. The repair is **code-only**: no gate and no run exercises `draft_covers_prefix`
with `hybrid == true`, and the only hybrid runs (p1/p2) are single-turn, while the
multi-turn chat logs are on `qwen35moe` (non-hybrid) where the freeze is a no-op. So the
flag-off hybrid multi-turn path — the exact home of R2 — is **unmeasured and ungated** at
HEAD. R1 (review3's "canary fires every cycle, freeze defeated by graph reuse") is
**REFUTED** by the ground truth and by the code: the feature works on its own target.

## Findings (ranked by severity)

### B1 — CONFIRMED (severity 1): `8ed1f0d`'s R2 fix is executed by no gate and no run on the flag-off hybrid multi-turn path

`session.cpp:1210,1232,1797` (turn-start rewind, `rollback_turn`, end-of-turn trim) all call
`rewind_or_rebuild_draft(im.ctx_dft.get(), im.freeze_recurrent, im.model_hybrid, …)`. The
coverage decision is `draft_covers_prefix(mem, hybrid, p0)` (`session.cpp:491-501`):

```cpp
const llama_pos amin = memory_seq_pos_min_attn(mem, hybrid, /*seq*/ 0);   // hybrid==true ⇒ attention half only
const llama_pos amax = memory_seq_pos_max_attn(mem, hybrid, /*seq*/ 0);
if (amin < 0 || amax < 0) return false;
return amax >= p0 - 1;                                                    // 8ed1f0d: dropped `amin == 0`
```

For a flag-off hybrid (`freeze_recurrent == false`, `model_hybrid == true`) this reads the
*attention* half (full-attn ⇒ `amin == 0`, `amax == p0-1`) → covers → **no wipe**. Correct.

But `draft_covers_prefix` is **never reached with `hybrid == true` in any evidence**:
- `tests/moe_gates.cpp:857-859` (G-F5f) is explicitly `[SKIP]`: *"no hybrid fixture
  (tiny-moe is not hybrid). Unverified: stock `llama_memory_hybrid::seq_pos_min =
  max(attn_min, recr_min)` would wipe every turn."* G-F5e/G-F5g (`:878`,`:903`) run on
  tiny-moe, where `is_hybrid()` is false and the attention min is always 0.
- The only hybrid runs, p1 (freeze OFF) and p2 (freeze ON), are **single-turn raw prompts**
  (REPORT.md Result 3: *"Both selfspec arms ran a single raw prompt, not a chat session"*;
  and *"What these arms could NOT catch"*). R2 is a **multi-turn** defect, so p1 cannot
  exercise it.
- The multi-turn chat logs `chat_freeze_off.log:3` / `chat_freeze_on.log:3` load
  `general.architecture = qwen35moe` — non-hybrid. There `im.freeze_recurrent` is false and
  `--selfspec-freeze-recurrent` is warned-and-ignored, so the freeze branch (and the
  `draft_covers_prefix(mem, model_hybrid, p0)` hybrid read) is **dead code**. The "freeze
  ON" arm is therefore running the *same flag-off path* as "freeze OFF"; its higher alpha
  (35/50/32 vs 12/11/3 accepted) reflects run-to-run draft dynamics and the `n_rs_seq=0` RS
  buffer, not the freeze.

Trigger for the underlying class: flag-off hybrid, chat, turn ≥ 2 (prefix reuse). The fix
that should make this safe (`hybrid == model_hybrid`) has **zero execution evidence on a
hybrid**. VERDICT: CONFIRMED measurement/validation gap; the code change is correct, but it
is exactly the kind of fix the prior audits said was "the weakest of the claims" when it
rests only on compilation.

### B2 — CONFIRMED (severity 1, historical): the four-commit net on the flag-off hybrid was a silent per-turn full re-prefill (2a7f365) that was invisible to every gate and log, then removed (8ed1f0d)

Timeline (all read from git, not re-derived):
- `d31ad8d` `rewind_or_rebuild_draft` flag-off branch (`git show d31ad8d:session.cpp`):
  `if (!llama_memory_seq_rm(mem, 0, p0, -1)) clear_draft_rebuild(...)`. **No coverage check.**
  Identical to F1 — correct on flag-off hybrid (snapshots present, `seq_rm` succeeds).
- `2a7f365` added `draft_covers_prefix(mem, freeze, p0)` (called with `im.freeze_recurrent`,
  i.e. `false` on flag-off) requiring `amin == 0 && amax >= p0-1`. With `freeze == false`,
  `memory_seq_pos_min_attn(mem, false, 0)` dispatches to the **stock** `llama_memory_seq_pos_min`,
  which on a hybrid returns `max(attn_min, recr_min)` = the recurrent single-cell position
  `p0-1`. So `amin == p0-1 != 0` → `amin == 0` false → **wipe + from-0 re-prefill every turn**
  (review3 R2). On the F1/p1 baseline this silently re-reads the whole conversation from flash
  each turn. Acceptance is identical (draft predictions are deterministic from a from-0
  re-prefill), so **no gate and no log would have caught it** — the p1 read volume (51.8 GiB)
  is a single prefill + 256 decode drafts, not multi-turn re-prefills, because p1 is one
  turn.
- `8ed1f0d` changed the call to `im.model_hybrid` and dropped `amin == 0` → correct.

This is the concrete "taken away / silently changed for flag-off" the brief asks for: `2a7f365`
*removed* correct flag-off-hybrid behaviour (replaced `recr >= p0` / plain `seq_rm` with a
coverage check that wiped every turn); `8ed1f0d` *restored* it. The regression lived for one
commit span and was invisible; at HEAD it is correct but **unmeasured** (see B1).

### B3 — CONFIRMED (severity 2, positive): R1 (review3, "canary fires every cycle, freeze defeated by graph reuse") is REFUTED — the feature works on its target

The 8ed1f0d `FreezeGuard` comment and `REPORT.md` Result 2 both state the mechanism:
skip-write lives in the **compute-time eval-callback ask pass**, not only graph build.
Verified in code: `RouterHook::c_eval` (`router_hook.cpp:1118`) calls `freeze_.on_ask(t)` on
the ASK pass (`:1183`); `RecurrentFreeze::on_ask` (`recurrent_freeze.cpp`) nops the store
`CPY/DUP` nodes for every tensor the callback visits, and the callback walks every node of the
graph being *computed* — reused or rebuilt. So consecutive 1-token drafts stay frozen and the
canary (`"nop'd 0 store nodes"`) measures `saved_.size()` per decode.

Ground truth confirms it:
- The canary string appears in **no run** (REPORT Result 2) → `noped >= 1` on every draft
  decode, including drafts 2..γ. R1 predicted `noped == 0` on every draft ≥ 2.
- Freeze-ON alpha **24.6% (126/512)**, **1.97 tokens/verify**; freeze-OFF **8.6% (51/594)**,
  1.25 tokens/verify (REPORT Result 2). If R1 held (freeze caps at 1 tok/cycle, recurrent row
  poisoned from cycle 1), freeze-ON would sit at or below freeze-OFF — instead it is **2.9×**.
- Acceptance counts are bit-identical across `d31ad8d`/`2a7f365`/`8ed1f0d` (51/594, 126/512),
  i.e. three rounds of audit fixes did not perturb the loop and the freeze is stable.

VERDICT: R1 REFUTED. The freeze mechanism is sound; the canary's silence is the intended
invariant witness (its dependency — `cb_eval` installed, ggml's callback ask path — is
load-bearing and documented in REPORT Result 2).

### B4 — CONFIRMED (severity 2): the multi-turn chat evidence covers NEITHER flag state on a hybrid

`chat_multiturn.py` is explicitly written to close *"the verification gap the host gates
cannot: tiny-moe is qwen3moe (not hybrid), so the freeze branch … is unverifiable there"* and
drives the **real hybrid CalaQwen**. But the executed logs (`chat_freeze_off.log`,
`chat_freeze_on.log`) load `qwen35moe` (`architecture` line 3 of each), i.e. the script's
intended hybrid run was not the one shipped as evidence. Consequences:
- The flag-off hybrid multi-turn path (R2's home, B1) is unmeasured.
- The flag-on hybrid multi-turn path (F1's chat-trim defect class, the original audit's
  highest-severity finding) is also unmeasured — p1/p2 are single-turn, and the only
  multi-turn logs are non-hybrid.

So the claim *"alpha survives past turn 1 on a hybrid"* — the very thing the probe was built
to prove — has **no supporting run**. VERDICT: CONFIRMED gap; the chat logs are valid only as
flag-off *non-hybrid* multi-turn evidence (and there alpha is stable: 12/11/3 over three turns,
all ≥ 40 tokens — no collapse, consistent with F1). The freeze-path multi-turn story rests
entirely on code reading.

### B5 — PLAUSIBLE (severity 3): G-F5g unit-tests the wipe-before-from-0 helper, not R3's real hybrid trigger

`test_r3_failed_abort_cleanup` (`session.cpp:3114-`, gated at `tests/moe_gates.cpp:903-915`)
pre-sets `im.dft_need_full_prefill = true`, leaves `cells [0, n_prompt)` in place, then calls
`rewind_or_rebuild_draft` and asserts the cache is empty after `prepare_from0_draft_prefill`.
It confirms the *fix* (wipe before from-0) but does **not** reproduce review3 R3's actual
trigger: the llama.cpp abort cleanup (`llama-context.cpp:1811-1830`) failing to `seq_rm` when
`n_rs_seq == 0` and `pos_min > 0`, which only happens on a **hybrid** — and tiny-moe's
`seq_rm` always succeeds. G-F5e (`:878`) has the same shape: it simulates the abort cleanup
as `llama_memory_clear` (empty), i.e. the *first-ubatch* `rm_all` success case already closed
by d31ad8d, not the `pos_min > 0` failure case. G-F5d' (`:862`) calls `clear_draft_rebuild`
directly. So all three "rebuild" gates exercise the **fallback helpers**, never the
`recr >= p0` / coverage **decision function** under the real abort path. The R3 fix is
therefore gated at helper level only; the trigger→fix chain on the target is unverified. Not
a code bug — a validation gap, consistent with B1.

### B6 — CLEAN / the brief's specific `amin == 0` question (answered)

**What `8ed1f0d` permitted that `amin == 0 && amax >= p0-1` forbade.**

The old test required the draft cache to *begin at position 0* (`amin == 0`) **and** reach
`p0-1` (`amax >= p0-1`). Dropping `amin == 0` keeps only the endpoint test `amax >= p0-1`, so
a cache whose attention half does **not start at 0** is now accepted as prefix-covering,
provided it reaches `p0-1`.

- **What it permits legitimately:** a **windowed/SWA** draft cache after attention eviction
  (review3 R5). Old positions are dropped and the model only needs the window, so drafting
  from the tail is correct. This is exactly R5, and `8ed1f0d` fixes it.
- **Where it is inert:** on **full-attention** models (tiny-moe, the F1 target, and the GDN
  freeze hybrids) the attention half is always contiguous from 0, so `amin == 0` was already
  true and the removal changes nothing. The flag-off path is therefore unchanged on every
  full-attn configuration.
- **It does NOT re-open R2.** R2 was caused by handing `draft_covers_prefix` the *freeze flag*
  (`false`) instead of *model_hybrid* — routing to the stock hybrid min (recr cell at `p0-1`).
  `8ed1f0d` fixed **that** (passes `im.model_hybrid`) *and* dropped `amin == 0`. With
  `hybrid == true` the attention half reads `amin == 0` regardless, so even the old `amin == 0`
  would pass; the drop only matters for SWA.
- **Design cost (inherited, not new):** `amax >= p0-1` is a pure *endpoint* test. It cannot
  detect a hole in the **middle** of the prefix (review3 R3's "garbage in the middle" case).
  But `amax >= p0-1` was already the endpoint test in `2a7f365`; `amin == 0` only guarded the
  *start*. So R3's middle-hole blindness is **unchanged** by `8ed1f0d`, not introduced.

VERDICT: the `amin == 0` removal is a **correct, minimal** fix (R5), inert on the freeze
targets and tiny-moe, and does not reintroduce R2. CLEAN for the angle. The only residual is
the inherited endpoint-only blindness, already present in `2a7f365`.

## Angles checked and found CLEAN (explicit)

- **`--mtp`, `--ngram`, plain generation.** `rewind_or_rebuild_draft` is reached for any
  `ctx_dft` (MTP/ngram set one up), but always with `freeze_recurrent == false`; the flag-off
  branch is plain `llama_memory_seq_rm` + the additive coverage check, identical to F1. MTP's
  `n_rs_seq == 0` and the `cb_eval` condition's `im.freeze_recurrent` addition are both inert
  for MTP (freeze requires `is_selfspec()`). Plain generation has `ctx_dft == nullptr` → all
  guards short-circuit. No change.
- **Flag-off rm-failure / `dft_need_full_prefill` lifecycle.** On full-attn the
  rm-failure branch (`rewind_or_rebuild_draft` else-if, `session.cpp:508-511`) is dead
  (snapshots present / non-hybrid always succeeds), so the flag never sets and
  `prepare_from0_draft_prefill` (`session.cpp:478`) is a no-op; prefill resumes at `n_common`
  (F1). The flag is reset only after a completed prefill (`session.cpp:1365`) and preserved on
  cancel (correct — empty cache next turn). No stuck-flag regress. (Note: this also *repairs*
  an F1 bug where the flag-off rm-failure path cleared then prefilled from `n_common` — now it
  rebuilds from 0. Improvement, moot because the branch is dead for flag-off.)
- **`--e4` diagnostic walk (flag-off).** The local `FreezeGuard` became the shared one
  (`router_hook.h`); with `freeze == false` it is `set_recurrent_no_update(false)` — no-op. The
  e4 guard now also accepts `im.freeze_recurrent` (`session.cpp:2262-ish`), but flag-off leaves
  the original `!recurrent_freeze_hook && !moe.enabled` path. Unchanged.
- **`test_selfspec_restore` walk (flag-off).** Hash is computed every cycle
  (`memory_recr_data_hash`, `session.cpp:2871`) even when `freeze_recurrent && dft_hybrid` is
  false, so on a flag-off *hybrid* (p1) it pays 2×62.81 MiB copy+FNV per cycle for a result that
  is then discarded (`out.recr_data_checked` stays false). Already noted by review2 as a
  walk-only perf nit; correctness unaffected.
- **Streaming / drop paths (flag-off).** `set_drop_policy(0.0f, …)` and the `im.source.fatal()`
  decode-failure checks are unchanged from F1. No flag-off interaction.
- **R1 canary (flag-off).** Block is `if (im.freeze_recurrent && noped == 0)` — dead when the
  flag is off. No flag-off effect.

## Severity order

1. **B1** — R2 fix (pass `model_hybrid`) is ungated and unmeasured on the flag-off hybrid
   multi-turn path, the only place R2 lives.
2. **B2** — the 4-commit net on flag-off hybrid was a silent per-turn re-prefill (2a7f365)
   invisible to all gates/logs, repaired (8ed1f0d) but still unmeasured.
3. **B4** — multi-turn chat evidence is non-hybrid; neither flag state is verified across turns
   on a hybrid.
4. **B3** — R1 REFUTED (feature works); listed as the positive confirmation the angle needed.
5. **B5** — G-F5g/G-F5e/G-F5d' exercise fallback helpers, not the decision function under the
   real abort path; R3 trigger→fix unverified.
6. **B6/B8** — `amin == 0` removal is the correct R5 fix; inert on full-attn; does not reopen
   R2; endpoint-only blindness inherited from 2a7f365.

## Bottom line for the brief

The feature is **off by default and invisible when off** at HEAD: every flag-off consumer
(MTP, ngram, plain, chat prefix-reuse, cancel, e4, restore, streaming) runs F1-equivalent
code. The one thing the four commits *did* to flag-off was a `2a7f365` regression (per-turn
wipe of the flag-off hybrid via the wrong flag handed to `draft_covers_prefix`) that `8ed1f0d`
repaired — but the repair is **code-only**: no gate reaches `draft_covers_prefix` with
`hybrid == true`, the hybrid runs are single-turn, and the multi-turn logs are non-hybrid. So
the flag-off hybrid multi-turn path is **correct by construction and unverified by execution**,
and `8ed1f0d`'s `amin == 0` removal is a safe, necessary R5 fix that changes nothing on the
models the feature targets. R1 is dead.

DONE
