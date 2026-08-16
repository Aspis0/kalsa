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

**Reproduced on the audit-fix binary (`d31ad8d`, 07:21)** — the whole table is
bit-stable across a 322-line diff: RS buffers identical (314.06 / 62.81), peak
RSS 6176.3 / 5915.9 MiB (0.1 MiB from the first run), wall 46.4 / 45.5 s. The
freeze arm is ~1-2 % faster than freeze-OFF in both runs; two runs is not a
claim, and it is not the claim being made here.

**Correction to earlier text:** the figure carried forward from F1 was "314 MiB
saved". That was wrong — 314.06 MiB is the *total* buffer at γ=4; `n_rs_seq = 0`
still allocates the one live row (62.81 MiB). The saving is 251.25 MiB. Every
document that said 314 has been corrected.

## Result 2 — speed, on a host that cannot pay for a draft

Single run each, warm page cache, idle machine — indicative, not a claim:

| arm | wall (256 tok) |
|---|---|
| p0 plain | 30.2 s |
| p1 freeze OFF | 46.4 s |
| p2 freeze ON | 45.3 s |

Speculation **loses** here (0.67× vs plain), consistent with F1's 0.37× on the
same host class: a DRAM-bound PC gets no I/O amortisation from a batched verify,
and our routing entropy says the batch discount is small on this model anyway.
The freeze's 2.4 % edge over freeze-OFF is within single-run noise and is not
claimed. **The prize is on flash; this host cannot answer it.** That is arm D1.

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
