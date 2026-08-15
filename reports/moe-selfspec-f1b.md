# Selfspec F1b — E1/E2/E3 teacher-forced diagnostics — 2026-08-14

## Lane call: **LANE_ALIVE — ENGINE_BUG (live state corruption), not model weakness**

Setup: Qwen3.6-35B KEXP, longfact gold stream (300 tokens, F0 reference
where teacher-forced alpha was 0.6991 and live free-running alpha
0.078-0.086, speedup 0.22x). Branch `kalsa/selfspec-f1` @ `2396c56`,
draft_k=2, verify_k=6, diag protocol per owner spec (graph-reuse-safe E2
with pad-token rewind, RAII k-switch, campaign drop forced d0).

## Results vs the pre-registered interpretation table (Qwen Max opinion,
`docs/qwen-max-selfspec-opinion.md`)

| exp | question | result | reading |
|---|---|---|---|
| E1 | clean contexts, each at its own k: how good is the k2 draft really? | draft==verify **0.837**, draft==gold **0.833**, verify==gold **0.937** | k2 draft HEALTHY (above F0's 0.70). "Weak k2" hypothesis (<10% prior) **dead**. But verify==gold should be 1.000 — the 6.3% impurity is a runtime purity defect (see E3). |
| E2 | prefix built at k6, predict at k2 (the "free state-fork" economy) | draft==verify **0.353** | k-mixing inside one context is **toxic** — state built at one k does not transfer. Free state-fork **dead by physics**; any dirty k-switch in the live loop corrupts exactly like this. "State compounding" confirmed as a real mechanism. |
| E3 | batched verify fidelity, gamma=4 vs gamma=1 | argmax_agree **0.983 both**, max\|dlogit\|_top2 3.96 | Batching itself is NOT the disease (gamma-independent) — the 30-35% "batched GDN infidelity" prior is mostly dead. BUT 98.3% != 100% violates Qwen invariant #1 (serial==batched must be exact on forced tokens): a small constant runtime impurity exists, consistent with E1's verify!=gold. |

## Synthesis

Teacher-forced ceilings are healthy (0.83); live alpha is 0.08. The gap
lives in what only the LIVE loop exercises: the accept/reject/rollback
cycle and the per-step k-switch between the two contexts. E2 proves the
corruption mechanism (k-mixed state -> garbage); E1/E3 prove everything
else is clean enough. This matches Qwen's top prior (45%: rollback /
"phantom prefix" corruption) upgraded to near-certainty.

## What died today

- "k2 draft too weak" — dead (E1).
- "Batched verify infidelity scales with gamma" — dead (E3 gamma-flat).
- "Free state-fork" economics (share k6 state, fork to draft) — dead by
  physics (E2). The draft context must keep its ENTIRE history at k2.

## Next steps (order matters)

1. **Qwen invariant #2**: forced-rejection restore test — inject a
   rejection on a known-good stream, assert the draft context state is
   byte-restored. This is the direct hunt for the phantom-prefix bug.
2. Chase the constant 1.7-6.3% purity defect (E3's 5/300 with huge
   dlogit 3.96 — not fp-tie noise; E1's 19/300 verify-vs-gold).
3. Fix, then re-measure LIVE alpha on longfact. Target: alpha ~0.7-0.83
   (the teacher-forced ceiling).
4. Only then redo the economics: the arithmetic bomb stands (iteration
   ~4.94 C6 at gamma=4) — with the free fork dead, the surviving shape
   is full-k2 draft context (every accepted token decoded twice: k6
   verify + k2 catch-up) and the verify batch MUST be sublinear (flash
   amortization) for any gamma to pay. C2~0.52xC8 from the F1c grid
   helps but does not decide it.

## Artifacts

`results/selfspec_f1b/longfact/` (SUMMARY.txt, e1.csv, e2.csv, e3.csv,
run.log), n_prompt=293, n_gold=300. Diag exit 0, ~25 min on freed PC.

---

## ADDENDUM (same night) — phantom prefix REPRODUCED in vitro

G16 forced-rejection restore gate (owner spec, commit `673febe`) +
CLI exposure (`ae63c5d`), run on the real hybrid 35B (longfact inputs):

| arm | restore_pass | first diverge | first \|dlogit\| | argmax | top8 | max \|dlogit\| |
|---|---|---|---|---|---|---|
| tiny transformers (3 fixtures) | **exact** 32/32 | — | 0 | 32/32 | 32/32 | 0 |
| 35B, reject_every=3 | **FAIL** | gold[3] (first seq_rm) | 14.07 | 15/99 | 0/99 | 22.85 |
| 35B, reject_every=0 | **FAIL** | gold[2] | 11.62 | 36/149 | 0/149 | 21.60 |

**Root cause: `llama_memory_seq_rm` rewinds attention KV but the GDN
recurrent R/S state does not rewind to an arbitrary position.** Every
draft rewind-replay cycle — even with ZERO rejections — leaves the
rejected/rewound tokens baked into the recurrent state; the corruption
compounds across cycles, which is exactly the live alpha collapse
(0.70 teacher-forced ceiling vs 0.078-0.086 free-running). The two Qwen
Max priors (45% rollback corruption, 30-35% GDN infidelity) were one
mechanism seen from two sides.

Fix is structural and NOT attempted yet: checkpoint the draft context's
recurrent state before each draft burst and restore it on rewind
(llama.cpp public API `llama_state_seq_*` — third_party stays
unpatched), or equivalent via the n_rs_seq machinery the F1 design
already reserved. Then re-measure live alpha (target: the 0.83 E1
ceiling), THEN the economics (the 4.94-C6 arithmetic bomb still stands).
Artifacts: `results/selfspec_f1b/restore35b/runA.log`, `runB.log`.
