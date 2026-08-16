# F5 arms P1/P2 — first exercise of the freeze on a real hybrid (PC)

2026-08-16, five runs across four revisions (`0b725d3` → `8ed1f0d`), binary
`build-f5/cli/bmoe-cli.exe`. Model CalaQwen `Qwen3.6-35B-A3B-KEXP.gguf`,
p_longfact, `-n 256`, `-t 4`, campaign flags, no drop. Runs 1-2 were invalid
(1 token, see Result 3); runs 3-5 used `--chatml --no-think` and generated 256.
**Surviving artifacts: `run1/` (rev 0b725d3, 1-token) and `run3_8ed1f0d/` (the
last run). Everything quoted as measured below comes from those**, except where
explicitly marked as coming from an overwritten log.

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

**Every number below is from the surviving logs of the last run**
(`run3_8ed1f0d/`, rev `8ed1f0d`). An earlier version of this report quoted
timings from runs whose logs had been overwritten by the next run — a claims
audit caught it (`AUDIT_claims_final.md`, C1/C4/C5). The runner now archives each
run into its own directory.

| arm | decode s/tok | **loop alpha** | tokens/verify | effective tok/s | read |
|---|---|---|---|---|---|
| p0 plain | 0.170 | — | — | **5.89** | 12 734 MiB |
| p1 freeze OFF | 0.397 | 51/594 = **8.6 %** | 1.25 | 1.33 | 51 776 MiB |
| p2 freeze ON | 0.292 | 126/512 = **24.6 %** | **1.97** | 1.81 | 32 834 MiB |

**Freeze-ON is 2.9× the acceptance of freeze-OFF**, and tokens per verify go
1.25 → 1.97 (+58 %). It also reads **37 % fewer bytes** than freeze-OFF
(32.8 vs 51.8 GiB) while producing the same 256 tokens.

Freeze-OFF's 8.6 % sits in the same low band as F1's published 0.117 pooled
window alpha. That is a **qualitative consistency check, not a reproduction** —
different binary, different session, 27 % apart in relative terms.

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

**The rival explanation, tested and rejected.** A claims audit proposed that the
gain is not the freeze at all but a side effect: with `n_rs_seq = 0` the stock
`seq_rm` would fail on every rejection, trigger a full `llama_memory_clear`, and
the draft context would be rebuilt from scratch each cycle. Two independent
measurements kill it:

- **Wall clock.** One prefill of this prompt costs 39 s (measured). p2 ran 130
  verify cycles; rebuilding on even half of them would cost tens of minutes. The
  entire p2 run took **187 s**.
- **Bytes.** A rebuild-per-rejection path would read far *more* than the
  snapshot path. p2 read **32.8 GiB vs p1's 51.8 GiB** — a third less.

Its supporting premise (that graph reuse defeats the freeze on drafts 2..γ) was
separately refuted in code: skip-write lives in the **compute-time eval-callback
ask**, not in graph build, so a reused graph is still frozen
(`ggml-backend.cpp:1677-1688`, `router_hook.cpp:1183`). The canary that would fire
if that ever stopped being true stayed silent in all three runs.

**The dependency that follows, stated because it is load-bearing:** the freeze
works because `cb_eval` is installed and ggml asks about every node at compute
time. Remove the callback, or take ggml's non-callback path, and skip-write
silently stops applying. The canary is the sensor for exactly that.

**What this does not say:** self-speculation still loses badly to plain decoding
on this host (5.89 vs 1.81 effective tok/s). The technique's speed case lives or
dies on flash, where the draft's smaller expert footprint can pay — arm D1.

## Result 3 — multi-turn chat on the real hybrid: without the freeze, acceptance decays across the conversation

The host gates cannot reach this: tiny-moe is `qwen3moe`, not hybrid, so the
freeze branch is dead code there. This probe drives the real model through
`bmoe-cli --session` (JSON requests on stdin), three turns, turns 2-3 with
`clear_kv:false` — the prefix-reuse path where the F1/F2 defects live.
Driver: `chat_multiturn.py`; logs `chat_freeze_{on,off}.log`,
pre-fix copies in `chat_prefix_2a7f365/`.

The observable is **acceptance per turn, not the text**: if the draft context is
poisoned, the target context still governs and the answer stays correct — only
the work saved collapses. Both arms emitted identical token counts per turn
(82 / 94 / 96), confirming that.

| turn | freeze OFF | freeze ON (pre-fix `2a7f365`) | freeze ON (post-fix `b3eb60c`) |
|---|---|---|---|
| 1 | 12/103 = 0.117 | 35/191 = 0.183 | 35/191 = 0.183 |
| 2 | 11/110 = 0.100 | 50/174 = 0.287 | 49/178 = 0.275 |
| 3 | 3/101 = **0.030** | 32/250 = 0.128 | 33/240 = **0.138** |

**Without the freeze, acceptance decays 3.9× along the conversation** (0.117 →
0.030). **With it, there is no decay** and turn 3 is **4.6× better**. The
flag-off arm is *bit-identical* before and after the audit fixes — the feature
does not touch code paths that do not use it.

Freeze activity is verified per run from the allocator, not assumed: the
freeze-ON draft context reports `n_rs_seq = 0` and a 62.81 MiB RS buffer, which
only happens when the freeze engages on a hybrid; the freeze-OFF arm shows
314.06 MiB on both contexts.

### Three rival explanations, all tested and rejected

The final audit round put three alternative readings on the table. Each is
answered from artifacts, not argument:

1. *"Graph reuse defeats the freeze; drafts 2..γ run unfrozen"* (round-3 R1).
   **Refuted** three ways: 512 drafts over 130 cycles ≈ γ=4 (not 1/cycle); the
   canary string never appears; and the mechanism is wrong — skip-write lives in
   the compute-time eval-callback ask, so a reused graph is still frozen.
2. *"The alpha gain comes from `n_rs_seq=0` forcing a full clear+rebuild each
   rejection, not from the freeze"* (claims audit C3). **Refuted** by arithmetic:
   one prefill costs 39 s and p2 ran 130 cycles in 187 s total; and p2 read
   32.8 GiB against p1's 51.8 GiB — a third *less*, where rebuilding would read
   far more.
3. *"The chat model is `qwen35moe`, non-hybrid, so the flag is ignored and both
   chat arms are the same path"* (final audit B1). **Refuted** by the same logs
   the claim cites: the freeze-ON draft context allocates `n_rs_seq = 0` /
   62.81 MiB and no "not hybrid" warning is emitted. The architecture string was
   read without checking the allocator underneath it.

## Result 4 — RETRACTED: the first speed table measured prefill, not decode

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

*(Those 1-token logs were overwritten by later runs; the prefill-doubling they
showed is reproduced in the surviving 256-token logs: 20.2 s plain vs 39.2 /
39.0 s selfspec, +94 %. The per-step MiB figures quoted below are from the
overwritten logs and are not independently verifiable — flagged by the claims
audit, C5.)*

**Prefill nearly doubles (+94 %) when self-speculation is on**, because the draft
context prefills the same 293 tokens a second time. That cost is real, it is
paid before the first token, and on a streamed device it is flash reads
It is independent of the freeze (both selfspec arms pay it) and it is a genuine argument against the
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
