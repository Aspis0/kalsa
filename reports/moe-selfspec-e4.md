# E4 — stateless drafting on a sequential hybrid: the frozen recurrent state is faithful

**Verdict: `E4_GO(alpha1=0.987, EL=2.995)`** — headline arm a1, γ=4, 2026-08-16.
**Host:** PC only. **Model:** `Qwen3.6-35B-A3B-KEXP.gguf` (CalaQwen), sha
`ac44e20c…`. **Binary:** `BigMoeOnEdge-selfspec-f1` @ `c977d58`, sha `6ae38f4b…`.
**Data:** `results/selfspec_e4/{a1_g4,a2_g8}/` (SUMMARY.txt, e4.csv, diag.log).
**Spec:** `docs/e4-stateless-draft-spec.md` (as-built annotated).

## The claim

On a sequential hybrid (attention + gated delta-net), you can self-draft with the
**recurrent state frozen at the last verified position** and the drafts stay
faithful: 0.987 agreement at draft step 1, 0.823 macro over 300 gold positions,
**E[L] = 2.995 tokens per verify** at γ=4. Freezing is *skip-write*, never
snapshot/restore, and rollback touches attention KV only — so the phantom prefix
that poisons naive hybrid speculation is impossible by construction, not by
cleanup.

The mirror paper (Component-Aware SSD, arXiv:2605.01106) tried the **opposite
polarity** — draft with the SSM half only — and reports **α = 0.038 all-token**
on sequential hybrids. Our comparable number is **alpha_alltok(G=4) = 0.413**,
about 11× above it. Their own ablation predicted our polarity would be the
better one; nobody had run it.

## What was measured — and what was NOT

E4 is a **teacher-forced walk**, not a generation loop. Blocks are anchored on
gold; only positions 2..γ inside a block are conditioned on the draft's own
prefix. This matters, and we have the receipts for why:

> F0's teacher-forced alpha was 0.6991. The same technique in F1's **real loop**
> delivered 0.117.

So **0.823 is not a loop number** and must never be quoted as one. E4 answers
"does freezing the recurrent state cost accuracy?" (no). It does not answer
"does the loop go faster?" — that is F5 (`docs/f5-stateless-loop-spec.md`).

## Instrument validity — the part that took three review rounds

Every arm runs four gates before any science number is emitted. All four are
**bitwise** (max |Δlogit| = 0.0), against **shape-mirrored** references — the
reference decode has the same context, ubatch and prefill shape as the device
under test, because on this engine batch-vs-serial numerics exceed 1e-3 at 100%
of 600 rows (E3, min 1.6e-3, p50 0.18, max 3.96). A loose tolerance here would
have hidden exactly the leak the gates exist to catch, so loose tolerances were
refused.

| gate | what it proves | a1 (γ=4) | a2 (γ=8) |
|---|---|---|---|
| S1 flag-off identity | the instrument does not perturb the engine when off | 300/300, 0.0 | 300/300, 0.0 |
| S2 σ=0 leftover | the freeze leaves no residue in the state | 75/75, 0.0 | 38/38, 0.0 |
| S2 freeze-read (true state) | the frozen draft reads s_{t0}, not a stale copy | 75/75, 0.0 | 38/38, 0.0 |
| S3 post-catch-up | after rollback + replay the state is exactly right | 74/74, 0.0 | 37/37, 0.0 |

Two of these gates exist because reviews found real bugs, not hypotheticals:

- **R1-F1:** the stock hybrid `llama_memory_seq_rm` rewinds recurrent state from
  per-token snapshot planes that frozen 1-token drafts never write — the
  catch-up would have restarted from stale/zero state. Fixed with an
  attention-only `memory_seq_rm_attn`; the recurrent live row *is* s_{t0} by
  construction, so there is nothing to rewind.
- **First real 35B run aborted itself:** `E4_SANITY_FAIL(S1=FAIL)`, argmax 292/300,
  max|Δlogit| 7.40 — the k-parity path reused the verify-context reference while
  the S1 walk ran on the draft context (different ubatch width). The run refused
  to report science with a red gate. Fixed at `c977d58`; the alphas came back
  bit-identical, only the first line changed.

## Numbers

**a1 — γ=4, draft k=6, verify k=6 (headline)**

| | s0 | s1 | s2 | s3 |
|---|---|---|---|---|
| agreement | 71/75 = 0.947 | 74/75 = **0.987** | 55/75 = 0.733 | 47/75 = 0.627 |
| max\|Δlogit\| p50 | 1.184 | 1.218 | 10.91 | 13.34 |

macro 247/300 = **0.823** · **E[L] = 2.995** · **alpha_alltok = 0.413** ·
noped 240 · wall 6303 s

**a2 — γ=8, draft k=6, verify k=6**

| | s0 | s1 | s2 | s3 | s4 | s5 | s6 | s7 |
|---|---|---|---|---|---|---|---|---|
| agreement | 0.974 | **1.000** | 0.789 | 0.579 | 0.486 | 0.541 | 0.378 | 0.378 |

macro 193/300 = 0.643 · **E[L] = 3.556** · alpha_alltok = 0.000 · noped 360 ·
wall 4073 s

Reading: the frozen state costs essentially nothing for the first two drafted
tokens (0.95-1.00) and degrades as it goes stale — the decay *is* the price of
freezing, and it is affordable out to γ=8 (E[L] still rises, 2.995 → 3.556).
`alpha_alltok(G=8) = 0.000` is expected, not a failure: it demands 8 correct
tokens in a row. γ=8 is more tokens per verify; γ=4 is a higher hit rate per
block. Which one wins in wall-clock is an F5 question.

## The RAM prize (found while writing the F5 spec)

F1's shipped loop needs `n_rs_seq = draft_max` recurrent snapshots on the draft
context — **314 MiB at γ=4 on this 35B**, and it scales linearly with γ (≈628 MiB
at γ=8, which is simply not affordable on an 8 GB phone). With the freeze the
draft context never writes recurrent state and rollback is attention-only, so
**`n_rs_seq = 0`**: the allocation disappears and γ stops costing memory. That is
what makes the γ=8 regime — the one with the best E[L] — reachable on a phone at
all.

Whether the freed RAM converts into tok/s (spend it as `--cache-mb`, or bank it
as headroom against the zram cliff that collapses stock 60-100×) is arm D3 of
F5. Not assumed here.

## Status of the third arm

`a3_k2_g4` (draft k=2, verify k=6) started 03:39. It is the **product** arm: a
draft is only worth running if it is cheaper than the target, and top-k is the
only cheapening lever left (layer-skip on sequential hybrids gives α = 0.000 —
never skip the recurrent layers, only freeze their writes). It is also the
apples-to-apples comparison with the mirror paper's k=2 setting. **Section to be
completed when it lands.**

## Provenance

Every arm pins git rev, binary sha and model sha into `STATUS.txt` before
running, aborts the remaining arms on a red gate, and writes its verdict as the
first line of `SUMMARY.txt`. Command line identical across arms except
`--selfspec-draft-k` / `--selfspec-gamma`:

```
bmoe-cli.exe -m Qwen3.6-35B-A3B-KEXP.gguf -t 4 -c 2048 --ubatch 512 -n 256
  --temp 0 --moe-stream --cache-mb 2000 --dense-weights anon --overlap
  --io-threads 4 --n-expert-used 6 --selfspec-draft-k K --selfspec-gamma G
  --prompt-file p_longfact.txt --selfspec-gold longfact_target.txt
  --selfspec-diag e4 --selfspec-diag-out <dir>
```
