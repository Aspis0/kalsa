# F5 — stateless drafting in the REAL speculative loop

**Status:** SPEC (2026-08-16, written while E4 arm a1_g4 runs). Not implemented.
**Depends on:** E4 verdict (a1_g4 headline, a3_k2_g4 product). Branch
`kalsa/selfspec-f1` @ `c977d58`.
**Predecessors:** `docs/e4-stateless-draft-spec.md` (diagnostic walk, as-built),
`reports/moe-selfspec-f1.md` (the production loop this spec modifies).

---

## 0. What E4 proved, and what it did NOT

E4 is a teacher-forced walk, not a loop. Its blocks are anchored on gold; only
positions 2..γ inside a block are conditioned on the draft's own prefix. So:

- **Proved (a2_g8, k6/k6, bitwise-gated):** freezing the recurrent state is
  faithful. α_s0 = 0.974, α_s1 = 1.000, decaying to 0.378 by s7; macro 0.643,
  E[L] = 3.556 at G=8. All four sanity gates 0.0 max|dlogit| — the freeze does
  not contaminate and the catch-up reconstructs exactly.
- **NOT proved:** loop alpha. F0's teacher-forced 0.6991 became 0.117 in F1's
  real loop. E4's macro 0.643 is in the F0 class and must NOT be quoted as a
  loop number. F5 exists precisely to produce the loop number.

## 1. The prize is RAM first, speed second

F1 shipped the loop with the stock hybrid catch-up: rewind the cycle on
`ctx_dft` and replay. To make `llama_memory_recurrent::seq_rm` able to restore
R/S at all, the draft context must ask for `n_rs_seq = draft_max` snapshots —
**314 MiB of recurrent snapshots at γ=4 on this 35B hybrid**
(`reports/moe-selfspec-f1.md`, "What the S23 cell needs").

With the E4 mechanism the draft context never writes recurrent state and the
catch-up rewinds attention only. Therefore:

- `ctx_dft` needs **`n_rs_seq = 0`** → the 314 MiB is not allocated at all.
- Snapshot cost no longer scales with γ, so γ becomes a free knob memory-wise.

On an 8 GB phone running a 35B model from flash that saving is a product fact on
its own, independent of tok/s. **It must be measured (peak RSS, both arms), not
asserted.**

## 2. Scope of the change

One flag, off by default:

    --selfspec-freeze-recurrent    draft with the recurrent state frozen at the
                                   last verified position; rollback is
                                   attention-only. Hybrid models only.

Wiring (all three pieces already exist and are gated by E4):

1. **Draft steps** on `ctx_dft` run under the `FreezeGuard` RAII
   (`core/src/moe/recurrent_freeze.*`): the store node is noped before compute,
   whitelist CPY/DUP only. Never snapshot/restore.
2. **Rollback** uses `memory_seq_rm_attn` (`core/src/engine/memory_attn_rm.*`)
   instead of `llama_memory_seq_rm`. The recurrent live row IS s_{t0} by
   construction, so there is nothing to rewind.
3. **Catch-up** replays `tok` + accepted prefix on `ctx_dft` **unfrozen**, so the
   recurrent state advances exactly once over accepted tokens. This is the path
   E4 gate S3 certifies bitwise (37/37, max|dlogit| = 0).

Context construction: when the flag is on, `ctx_dft` is created with
`n_rs_seq = 0`. If the model is not hybrid, the flag is a no-op with a warning
(no recurrent state to freeze — the loop already behaves).

Not in scope: temperature > 0 (the loop is greedy-argmax accept, unchanged),
draft-side drop policy (stays d0, F1 §Drop), MTP/ngram sources (untouched).

## 3. Correctness gates (host, `ctest`)

- **G-F5a tiny-moe identity:** `draft_k == verify_k`, freeze ON, γ=2. The
  emitted token stream must equal plain greedy decoding bitwise. With equal k the
  only difference is the frozen state; any divergence is a real bug, not the
  documented near-tie.
- **G-F5b n_rs_seq = 0:** with the flag on, assert the draft context allocated
  zero recurrent snapshots (guards silent regression of the RAM prize).
- **G-F5c rollback hygiene:** after a forced rejection
  (`--selfspec-reject-every`), the draft context's attention length equals the
  accepted position and the recurrent row is untouched (E4 S3 shape, run inside
  the loop instead of the walk).
- Existing G13/G15a/G15b must stay green with the flag off.

## 4. Measurement arms

Effective tok/s means *including* draft cost, as in F1's table. Every arm reports
decode tok/s, draft s/tok, effective tok/s, real tokens/verify, peak RSS, and the
first-drift position of the text.

| arm | host | config | question |
|---|---|---|---|
| P1 | PC | plain k6 vs selfspec k6/k2 γ=4 freeze OFF | reproduce F1's 0.37x baseline on this rev |
| P2 | PC | same, freeze ON | loop alpha + RAM delta, DRAM-bound |
| D1 | S23 (or Xiaomi) | plain k6 d065 vs selfspec freeze ON, γ=4 | **the real question: does verify-batch flash amortisation pay?** |
| D2 | device | freeze ON, k2/k6, **γ ∈ {2, 3, 4}** | tests the registered prediction that γ=3 is optimal and γ=4 overshoots |
| D3 | device | freeze ON, `--cache-mb` raised by the freed amount | does spending the 314 MiB as expert cache buy tok/s? |

**D3 is the arm that turns the RAM saving into a speed claim, and it is not
automatic.** Freed RAM does nothing by itself — it must be handed back
explicitly. Two channels, both measurable, both plausibly small:

- *Cache channel:* `--cache-mb 2000 → ~2314` (+15% cache). Whether that buys hit
  rate is doubtful a priori: routing entropy on this model is high (96% of
  experts touched in 300 tokens, top-16 = 25% of mass, ~45 re-reads/token), so
  the marginal hit-rate curve may be flat. Measure it; do not assume it.
- *Pressure channel:* 314 MiB not allocated is 314 MiB of headroom against the
  memory cliff. We have measured that cliff: stock collapses 60-100x under dirty
  zram (reproduced 2x), and K-F burst showed majflt 9.2 vs 13.5. Report peak RSS,
  majflt and p99 latency, not just the mean.

If D3 shows no tok/s gain, the RAM result stays a RAM result. Say so.

PC arms are sanity + RAM only. F1 already showed a DRAM-bound host cannot pay for
an autoregressive draft (0.37x); the prize, if any, is on flash. D1 is the arm
that decides the technique's fate as a product.

Device cells are **pre-registered** (PREREG.md committed before the run, ABBA
pairs, Wilcoxon exact, unplugged, declared-clean phone) — same protocol as
`results/kf_ship_jelly/` and the S23 ship cell. No exceptions.

## 5. Go / no-go before implementing

**RESOLVED 2026-08-16 04:24: `E4_PRODUCT(alpha1=0.867, EL=2.029)` at k2/k6 γ=4 —
above the 1.5 bar, so build F5 as specified.** Carry in the marginal rule from
`reports/moe-selfspec-e4.md`: extend γ only while the prefix acceptance product
exceeds k_d/k_v, which predicts **γ=3 optimal at k=2** and disqualifies every
slot at equal k. Original decision table kept for the record:

- **E4_PRODUCT / GO with E[L] ≥ 1.5 at k2/k6:** build F5 as specified.
- **E[L] < 1.5 at k2/k6 but ≥ 1.5 at k6/k6:** the cheap-k lever is dead; the
  draft is not cheaper than the target and there is no speedup to chase. Build
  F5 anyway **for the RAM claim only** (n_rs_seq = 0 at equal k), and say so in
  the report — do not dress a memory result as a speed result.
- **E4_DEAD at both:** do not build. Publish the a2/a1 mechanism result and stop.

## 6. Honesty ledger (carry into the report)

- E4 alphas are teacher-forced; F5's loop alpha will be lower. Quote both.
- The 314 MiB figure is F1's measurement at γ=4 on this model; re-measure, do not
  copy it forward.
- Batched-verify near-tie drift is inherited, not introduced (F1 documented it at
  pos 225 / 47 / 203). The freeze must not make it worse; if it does, that is a
  finding, not a footnote.
- Mirror paper (Component-Aware SSD, arXiv:2605.01106) reports α = 0.038
  **all-token at k=2**. The comparable F5 number is loop all-token alpha at
  k2/k6, not E4's macro.
