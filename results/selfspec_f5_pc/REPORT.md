# F5 arms P1/P2 — first exercise of the freeze on a real hybrid (PC)

2026-08-16 07:00-07:03. Binary `build-f5/cli/bmoe-cli.exe` sha `0bc29020…`,
rev `0b725d3`. Model CalaQwen `Qwen3.6-35B-A3B-KEXP.gguf`. Raw `--prompt-file`
p_longfact, `-n 256`, `-t 4`, campaign flags, no drop.

## Why these arms exist

The commit's three host gates run on tiny-moe, which is **`qwen3moe`, not
hybrid** — there the freeze is a no-op, `n_rs_seq` is already 0 by clamp and the
"recurrent untouched" assertion is vacuous. So before these runs the feature had
never executed on a model that actually has recurrent state.

## Result 1 — the RAM claim, from the engine's own allocator

| arm | draft ctx `n_rs_seq` | CPU RS buffer | peak RSS |
|---|---|---|---|
| p0 plain (no selfspec) | — (single ctx, 0) | 62.81 MiB | 5525.3 MiB |
| p1 selfspec, freeze OFF | 4 | **314.06 MiB** | 6176.4 MiB |
| p2 selfspec, freeze ON | **0** | **62.81 MiB** | 5916.0 MiB |

`RS buffer = (n_rs_seq + 1) × 62.81 MiB` on this model. The freeze removes the
snapshot planes entirely: **251.25 MiB saved at γ=4**, and it would be 502.5 MiB
at γ=8. Peak RSS corroborates independently (−260.4 MiB).

**Reproduced on the audit-fix binary (`d31ad8d`, 07:21)** — the RS buffers and
peak RSS are bit-stable across a 322-line diff: 314.06 / 62.81 MiB identical,
peak RSS 6176.3 / 5915.9 MiB (0.1 MiB from the first run). This result does not
depend on how many tokens were generated: it is an allocation decided at context
construction, which is why it survives the retraction below.

**Correction to earlier text:** the figure carried forward from F1 was "314 MiB
saved". That was wrong — 314.06 MiB is the *total* buffer at γ=4; `n_rs_seq = 0`
still allocates the one live row (62.81 MiB). The saving is 251.25 MiB. Every
document that said 314 has been corrected.

## Result 2 — the freeze nearly TRIPLES loop alpha (the first loop-level evidence)

256 tokens, `--chatml --no-think`, draft k=2 / verify k=6, γ=4. Same binary, same
prompt, same config in both selfspec arms — **only the flag differs**.

| arm | decode s/tok | **loop alpha** | tokens/verify | effective tok/s |
|---|---|---|---|---|
| p0 plain | 0.167 | — | — | **5.99** |
| p1 freeze OFF | 0.397 | 51/594 = **8.6 %** | 1.25 | 1.33 |
| p2 freeze ON | 0.291 | 126/512 = **24.6 %** | **1.97** | 1.82 |

Freeze-OFF reproduces F1's published loop alpha (0.117 pooled window on the same
prompt family), so the baseline is the known one and the comparison is clean.
**Freeze-ON is 2.9× that**, and tokens per verify go 1.25 → 1.97 (+58 %).

**Reproduced on three binaries spanning the whole fix history** — `d31ad8d`
(`08d16910…`), `2a7f365` (`524973b8…`), `8ed1f0d`: acceptance counts
**bit-identical every time** (51/594 and 126/512). Greedy decoding is
deterministic, so identical counts are the expected signature of a stable
measurement, and they double as a regression check that three rounds of audit
fixes did not perturb the loop. Wall-clock is noisier: plain decode ranged
0.166-0.182 s/tok across runs (~10 %), so **the counts are the evidence and the
timings are not**.

The canary added in `2a7f365` (`nop'd 0 store nodes`, fires if skip-write fails
to engage on a draft decode) stayed **silent in every run** — which is the
positive evidence that the freeze applied to drafts 2..γ, not only to the first
of each group.

**Why the freeze buys acceptance** (mechanism, consistent with E4's R1-F1): with
the freeze off, every rejection rewinds the draft context's recurrent state
through the snapshot planes, and that restore is what E4 showed to be
wrong — the draft then conditions on a state that is not s_{t0}. With the freeze
on there is no rewind at all: the live row *is* s_{t0} by construction. The alpha
gain is not a bonus, it is the removal of a silent state defect.

**What this does not say:** self-speculation still loses badly to plain decoding
on this host (5.99 vs 1.82 effective tok/s). The technique's speed case lives or
dies on flash, where the draft's smaller expert footprint can pay — arm D1.

## Result 3 — RETRACTED: the first speed table measured prefill, not decode

**The first version of this report presented a speed comparison (30.2 / 46.4 /
45.3 s "for 256 tokens") and read it as "speculation loses 0.67×". That was
wrong and is withdrawn.** All three arms emitted **one token**: with a raw
`--prompt-file` and no chat wrapper this model hits EOG immediately, and the
runner had no validity gate, so wall time was almost entirely model load +
prefill. The audit of the fix commit surfaced the tell ("alpha 0 % on both
arms"); checking the stdout confirmed `generation: 1 tokens`.

What those runs *do* legitimately show, from the same logs:

| arm | model load | prefill (293 tok) | tokens generated | drafts accepted |
|---|---|---|---|---|
| p0 plain | 6.2 s | **19.1 s** | 1 | — |
| p1 freeze OFF | 6.7 s | **37.0 s** | 1 | 0/4 |
| p2 freeze ON | 6.1 s | **37.1 s** | 1 | 0/3 |

**Prefill nearly doubles (+94 %) when self-speculation is on**, because the draft
context prefills the same 293 tokens a second time. That cost is real, it is
paid before the first token, and on a streamed device it is flash reads
(p0 read 188.8 MiB for its single step, p1 420.3 MiB). It is independent of the
freeze (both selfspec arms pay it) and it is a genuine argument against the
technique on short answers, where it can never be amortised.

The acceptance figures (0/4, 0/3) come from a single cycle each and say nothing
about alpha. **No loop-alpha and no speed claim exists yet on this host.**

Runner now gates on `generation: N tokens` and marks any arm with fewer than 200
as `INVALID_TOO_FEW_TOKENS`; re-run with `--chatml --no-think` is in flight.

## What these arms could NOT catch — stated plainly

Both selfspec arms ran a **single raw prompt**, not a chat session. A hostile
audit of the same commit (report archived with the fix round) found a CONFIRMED
severe defect that lives exactly where these arms do not go: on a hybrid in
**chat mode**, the end-of-turn trim still uses the full hybrid `seq_rm` on the
draft context, which cannot rewind with `n_rs_seq = 0`, falls back to a full
`llama_memory_clear`, and the next turn re-prefills the draft context from
`n_common` instead of 0 — so from turn 2 the drafts are conditioned on a context
that never saw the conversation. The emitted text stays correct (the target
governs); acceptance silently collapses while the cost stays.

So: the RAM result above is real and measured, and the feature is **not yet
correct on its intended target**. Fix round in flight.
