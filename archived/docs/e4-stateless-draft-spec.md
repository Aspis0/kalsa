# E4 — Stateless-draft diagnostic (frozen-GDN teacher-forced alpha)

Status: IMPLEMENTED @ `dc944f5` (2026-08-15). 11 commits over 4 rounds; audited by
3 hostile review rounds + a 3-auditor final pass (line-by-line / path-tracing /
science-fidelity) + a confirmation round — all reports in the session scratchpad
(`agents/e4-review/report.md`, `agents/e4-final-{a,b,c}/report.md`). This spec is
amended below to record the as-built contract where engine reality forced changes.
Branch: `kalsa/selfspec-f1` in `C:\Users\gualt\Desktop\Kalsa\moe-experiments\BigMoeOnEdge-selfspec-f1` (base ae63c5d).
Model: `C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\Qwen3.6-35B-A3B-KEXP.gguf` (arch `qwen35moe`, 40 layers, hybrid attention + GDN).

## Question

Can an **attention-only draft** — GDN recurrent layers frozen at the last verified
position — predict the full model's next-token argmax well enough to make
self-speculative decoding viable on sequential hybrids?

Published baseline to beat: **α = 0.038** (Component-Aware SSD, arXiv:2605.01106,
May 2026) — they tried the OPPOSITE polarity (SSM advances, attention approximated).
Their own ablation (PPL ×82 without attention) predicts our polarity wins. Nobody has
published ours.

## Why this design cannot phantom-prefix (context)

The 35B restore test (`results/selfspec_f1b/restore35b/`) proved:
`llama_memory_seq_rm` rewinds attention KV but **GDN recurrent state cannot rewind**;
every rewind-replay cycle poisons R/S (first_max_abs_dlogit 11.6–14.1, alpha
0.70 → 0.08). Stateless drafting inverts the problem: the draft **never writes** GDN
state, so there is nothing to rewind. Rollback = `seq_rm` on attention KV only, which
is exactly the part that works. The catch-up replay after verification starts from the
true state at the block start — untouched by construction.

## Mechanism to implement (freeze = skip-write, NOT snapshot/restore)

Add `e4` to `--selfspec-diag`. Requirement on the graph: a per-forward flag
**`recurrent_no_update`** — GDN layers READ the stored state normally but SKIP the
state write. Do NOT implement the freeze as byte snapshot/restore of state buffers:
the restore path is exactly what the 35B test proved untrustworthy, and skip-write
needs no restore at all. If the graph builder cannot support skip-write, stop and
report `E4_BLOCKED(engine)` — that is itself a finding.

Indexing convention: processing token `x_p` reads state `s_{p-1}`, writes `s_p`, and
produces logits for position `p+1`.

Teacher-forced walk over gold (same longfact prompt + gold as E1–E3,
`--selfspec-gold`, n=300), blocked with gamma `G`:

1. **Reference pass** (reuse E1 machinery): normal full-state forward over gold;
   record argmax + logits per position.
2. **E4 pass**: at each block start `t0` (every G tokens), state `s_{t0}` is true
   (advanced by step 3 of the previous block). For depths `d = 1..G`: forward gold
   token `x_{t0+d}` with `recurrent_no_update` ON (GDN reads `s_{t0}` for every
   depth; attention KV accumulates normally). Staleness at depth d is `σ = d−1`.
3. **Catch-up** (mirrors the real verify): remove the block's draft KV, replay the
   block's gold tokens with updates ON.

   **AS-BUILT CORRECTION (review round 1, F1):** the original premise "no rewind of
   GDN ever happens" was false for the stock hybrid `seq_rm` on this engine — a
   partial-range `llama_memory_seq_rm` on hybrid memory rewinds the recurrent state
   through per-token snapshot planes that frozen 1-token drafts never write (stale
   or zero state from block 1 on). The implemented fix is an **attention-only
   seq_rm** (`memory_seq_rm_attn`, e4-walk-only, unreachable from production):
   the recurrent side is never touched, its live row IS s_{t0} by construction of
   skip-write, and the catch-up replay advances it truly. The resulting
   recurrent/attention position-metadata divergence was traced benign (hybrid
   `seq_pos_max` = min of the halves; a WARN per catch-up is expected noise).

## Sanity gates (run first, in order; any failure = stop and report)

**AS-BUILT (review round 2, R2-F1):** the original gates compared batch logits
against a serial reference at 1e-3 — impossible on this engine (E3 measured
batch-vs-serial |dlogit| above 1e-3 at 100% of 600 positions, p50 0.18). The
implemented gates therefore compare **same-shape** computations (bitwise by
construction, tolerance a formality):

- **S1 scaffolding identity**: freeze-off 1-token serial walk vs the serial
  reference — bitwise (maxd == 0). Validates the walk scaffolding, not the
  catch-up (a freeze-off walk has no catch-up: its drafts already advanced state).
- **S2 leftover**: each block's σ=0 leftover (output of the G-token catch-up
  batch) vs `shape_left` — a freeze-off walk made of the SAME G-token batches at
  the same positions/k. Bitwise. Proves catch-up truth.
- **S2 freeze-read**: the first frozen 1-token decode of each block vs `shape_fr`
  — a freeze-off walk probing the same position with the same 1-token shape.
  Bitwise. Defense-in-depth (at σ=0 the GDN read is true regardless of skip-write;
  the independent freeze witnesses are `noped_seen` and the σ>0 science rows).
- **S3 rm hygiene**: S2-leftover applied to blocks ≥ 1 (post-catch-up) — proves
  the draft KV was fully removed (the G16 lesson applied here).

Alpha (`agree`) is still measured against the **serial verify-k reference** — the
scientific comparison; E3's ~1.7% batch-vs-serial argmax flips (agree 0.983,
`results/selfspec_f1b/longfact/e3.csv`) are disclosed measurement noise,
irrelevant at the 0.038-vs-0.60 decision scale.

## Arms and metrics

Arms (all on the 35B, PC, `--moe-stream` config copied verbatim from the
restore35b command lines):

| arm | draft k | verify k | gamma | purpose |
|---|---|---|---|---|
| A1 (headline) | 6 | 6 | 4 | frozen-GDN effect ALONE, k parity |
| A2 | 6 | 6 | 8 | staleness depth curve |
| A3 (product) | 2 | 6 | 4 | combined with E2's known k-mixing toxicity (0.353) |

Metrics, per arm:
- **alpha_σ** for σ = 0..G−1: argmax agreement frozen-vs-reference at each staleness
  (σ=0 is a sanity, not a result; report anyway).
- **macro alpha** (all depths pooled) — the apples-to-apples number vs 0.038.
- **E[accepted length]** per verify under the standard prefix-acceptance model:
  `E[L] = Σ_{j=1..G} Π_{d=1..j} alpha_{d−1}`.
- **max|dlogit| p50 / p95 per σ** — degradation magnitude, directly comparable to the
  restore35b poisoning numbers (11.6–14.1).

CSV per arm to `--selfspec-diag-out` (one row per position: block, σ, agree,
max_dlogit), summary in `SUMMARY.txt` next to them, artifacts under
`results/selfspec_e4/`.

## Pre-registered verdict gates (first line of report)

- `E4_GO(alpha1=…, EL=…)` — alpha_{σ=1} ≥ 0.60 AND E[L] at G=4 ≥ 1.5. Build the real
  drafting loop next (F5).
- `E4_MARGINAL(…)` — alpha_{σ=1} in [0.30, 0.60). Owner decides with the depth curve
  + dlogit magnitudes in hand.
- `E4_DEAD(…)` — alpha_{σ=1} < 0.30. Attention-only polarity does not rescue
  sequential hybrids; bank the negative vs the published 0.038 (both polarities dead
  is still a publishable footnote).
- `E4_BLOCKED(engine)` — graph cannot skip-write. Engine work needed first.

AS-BUILT verdict-label additions: `E4_GO_PENDING_G4(...)` when alpha passes on a
non-G4 arm (E[L] gate is defined at G=4); `E4_PRODUCT(...)` for any cross-k arm
(A3) so the product arm never prints a science verdict (its alpha_0 < 1 by design
— k-mixing); `E4_SANITY_FAIL(...)` as SUMMARY first line when gates fail (the CSV
and summary are still written). `E4_BLOCKED(no-attention)` refuses pure-recurrent
models (without attention layers there is no attention-only draft to measure);
`E4_BLOCKED(no-recurrent-state)` refuses pure transformers. The verdict is
computed by the code and is the first line of SUMMARY.txt.

## Sequencing / resources

- AS-BUILT runtime correction: the shape-mirrored references cost O(B²/G) replay
  batches (`shape_fr`): ~703 for G=8, ~2,775 for G=4 at n=300 — hours, not
  minutes, on the 35B. **Run order: A2 (G=8) first, then A1 (G=4), then A3.**
- Runner: `results/selfspec_e4/run_e4_arms.py` (detached, PID in
  `runner.pid.txt`) waits for the dropcurve job to free the PC, pins git rev +
  binary/model sha, runs the arms in that order, and aborts the remaining arms on
  `E4_SANITY_FAIL`/`E4_BLOCKED`. Verdicts land as the first line of each arm's
  `SUMMARY.txt` under `results/selfspec_e4/<arm>/`.
- No phones involved. `models/` read-only. New commits on `kalsa/selfspec-f1` only;
  ctest coverage for S1/S2 required.
