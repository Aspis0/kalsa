# Prompt for Qwen 3.8 Max — five wild ideas, kill the ones that are already published or physically dead

Same project as before (on-device MoE inference, experts streamed from flash).
You have killed two of my proposals already and both times you were right, so
please be hostile again. For each idea below I want three things:

1. **Is it already published?** Name the paper if so. This is the most valuable
   thing you can give me — I would rather lose an idea to a citation now than
   after three weeks of building.
2. **Is it physically dead** given the measurements in §0, the way draft-by-drop
   was dead on arithmetic before any measurement?
3. **Is my proposed cheap test actually decisive**, or is it another asymmetric
   gate (bad result kills, good result proves nothing)?

Rank the five by expected value. If one is obviously the best, say so and say
what you would measure first.

---

## §0 The measurements everything below is built on

All ours, all measured, on Qwen3.6-35B-A3B (256 experts, top-k=6, ~13.4 GB,
2000 MiB expert cache) and Marco-Mini / Mellum2, on Android phones and a PC.

**M1 — routing entropy.** 96 % of the 256 experts are touched within 300 tokens;
the top-16 experts carry only **25 %** of the routing mass; ~**45 expert
re-reads per token**. Consecutive tokens route to **near-disjoint** expert sets.
This one measurement killed every cache-similarity trick we tried and explains
why batched verify does not amortize.

**M2 — the byte invariant.** `bytes/token = [γα + (γ+1)β]/L` with `L ≤ γ+1`. If
β ≥ 1, speculation can at best tie plain decoding. Break-even for our regime:
β < 0.56.

**M3 — cheap certification fails.** Argmax agreement under the top-`j` experts vs
full k=6, 1037 positions: j=2 **0.6905**, j=3 **0.8120**, j=4 **0.8640**,
j=5 0.8685. Per domain at j=3: longfact 0.897, code 0.873, fact 0.714,
creative 0.709.

**M4 — expert skipping is nearly free, and sometimes NEGATIVE cost.**
`--drop-cold-experts f` drops a fraction of the experts that are not cache-
resident. On CalaQwen: d=0.3 costs **+0.06 %** macro bpb, d=0.8 costs **+1.6 %**.
On Mellum the curve has a **minimum below zero**: d=0.5 measured **−0.0150 bpb**
against the k8 anchor — skipping cold experts *improves* multilingual perplexity,
with run-to-run noise at 1e-6. **We cannot explain this.**

**M5 — the drop never skips the matmul.** Verified at source: a dropped slot is
re-pointed at the top expert and recomputed. So `--drop-cold-experts` is an
**I/O-only** lever, never a compute lever. The only compute lever is `k`.

**M6 — we can freeze the recurrent state.** The model is a hybrid (sequential
GDN recurrent layers interleaved with attention). We implemented skip-write of
the recurrent state at compute time and verified bitwise (max |Δlogit| = 0 over
300 positions) that freezing does not contaminate and that catch-up reconstructs
exactly. The recurrent state is **62.81 MiB** and lives in RAM.

**M7 — prefetch reaches 76 % precision and does not pay.** A layer-ahead expert
prefetcher cuts I/O stall from 21.9 % to 13.4 % of wall on every single block,
but raises read bytes +14 % and loses 4.3 % on wall time. A quarter of prefetched
bytes are never used.

**M8 — regimes.** On slow flash we are I/O bound (stall 22 %); on fast flash we
are compute bound (stall 6–9 %). Device variance between consecutive identical
runs is ±50 %, so every speed claim needs ABBA pairs.

---

## Idea 1 — Expert-major decoding: amortise the expert union across a batch

**The observation.** M1 says consecutive tokens route to near-disjoint expert
sets, which is why batching fails *token-major*. But the quantity that actually
determines flash traffic is the **union** of experts needed by a batch, not the
sum. For B tokens the sum is 6B; the union is at most 6B and, against a
256-expert pool with the skew we measured (top-16 = 25 % of mass), should grow
markedly sublinearly.

**The idea.** Reorder the computation **expert-major** instead of token-major:
load expert E from flash once, apply it to every token in the batch that routes
to E, then evict. Bytes/token becomes `|union(B)| / B` instead of 6.

If `|union(B)|/B < 6`, then **β < 1** — and the entire speculative case, which
M2/M3 closed, reopens on a different mechanism. It would also make ordinary
multi-sample or multi-request decoding cheaper per token, independent of
speculation.

Where the batch comes from on a single-user phone: speculative candidates,
multi-sample generation, beam-like exploration, or genuinely concurrent chats.

**Cheapest decisive test.** We already have route traces. Compute
`|union of experts over B consecutive tokens| / (6B)` for B = 2,4,8,16,32,
per layer and pooled. **Zero device time, zero new measurement.** If the ratio
stays near 1.0 the idea is dead on our own data before anything is built.

**What would kill it:** the union ratio staying flat (routing too entropic to
overlap even in a batch); or the fact that expert-major execution requires
holding B hidden states and reordering the graph, which may cost more in RAM and
scheduling than it saves in flash.

**What I want from you:** is expert-major / expert-centric scheduling already the
standard trick in server MoE inference (DeepSpeed-MoE style expert parallelism),
and if so, is the *on-device flash-streaming single-user* framing actually new,
or am I re-deriving a known scheduling pattern with a new bottleneck attached?

---

## Idea 2 — Router-confidence adaptive k, decided BEFORE any expert is read

**The observation.** M3 says agreement with fewer experts is highly domain
dependent (0.90 on longfact, 0.71 on creative). That is a *pooled* view of what
is really a per-token property: some tokens are decided by the top expert, others
need all six. M5 says `k` is our only compute lever.

**The idea.** Choose `k` **per token**, gated on a signal that is free: the
**router's own gate distribution**. The router runs on the dense part of the
model, which is already resident in RAM — so its output is available *before* a
single expert byte is read. If the top-1 gate weight dominates (low entropy /
large top1–top2 gap), use k=2; if the gate distribution is flat, use k=6.

The budget becomes adaptive per token instead of a global constant, and unlike
M4's drop, cutting `k` cuts **both** bytes and compute.

**Cheapest decisive test.** Offline, from data we already have: bin positions by
router gate entropy (or top1−top2 gate gap), and within each bin measure the
argmax agreement of k=2 and k=3 against full k=6. If the high-confidence bins
show agreement ≫ 0.95 and contain a large fraction of tokens, we can compute the
implied average `k` under a calibrated policy directly and compare against 6.

**What would kill it:** if agreement is roughly flat across confidence bins —
i.e. the router's confidence does not predict whether the missing experts matter.
That is entirely possible and would be a clean, cheap kill.

**What I want from you:** AdapMoE and friends do adaptive expert gating. Is
*router-entropy-calibrated per-token k, on the inference path, with the decision
taken before any expert I/O*, already published? And is router confidence
theoretically expected to predict argmax stability, or is that naive — since the
gate weights measure routing preference, not output decisiveness?

---

## Idea 3 — A learned route predictor driven by the frozen recurrent state

**The observation.** M7 says our prefetcher gets 76 % precision and that is not
enough to pay. M6 says we hold a 62.81 MiB recurrent state in RAM that is a
compressed summary of the entire sequence, updated cheaply, and that we can read
and freeze bitwise.

**The idea.** Do not predict the next *token* — predict the next **expert set**.
Train a tiny probe (a linear or 2-layer map) from the GDN recurrent state at
layer L to a 256-way expert score for layers L+1…N at token t+1. Route prediction
is a far easier target than token prediction: we need the top-6 **set**, not the
argmax token, and we do not need to be right about which of the six comes first.

Cost at inference: a few microseconds of dense math on a state already in RAM.
**Zero flash bytes.** That directly attacks M7's failure mode — our prefetcher
reads more bytes to hide stall; a predictor that reads nothing new can only help.

**Cheapest decisive test.** Fully offline: dump (recurrent state, true expert
route) pairs from existing traces, train the probe, and measure **top-6 recall at
one token of lead**. Compare against two baselines: (a) the 76 % precision of the
current layer-ahead prefetcher, and (b) the trivial predictor "the experts used
at token t".

**What would kill it:** if baseline (b) — just reusing the previous token's route
— already matches the probe, the probe adds nothing. Given M1 (near-disjoint
consecutive routes) baseline (b) should be weak, which is exactly why this might
work. It also dies if the recurrent state simply does not carry routing
information, which is an empirical question.

**What I want from you:** is learned route prediction from an internal hidden
state published (I believe something exists in the ExpertFlow / SP-MoE family)?
And specifically: is anyone using a **recurrent/SSM state** as the predictor
input, rather than the previous layer's activations? That combination — hybrid
model + flash streaming — is where I think we may be alone.

---

## Idea 4 — Per-language expert masks, computed offline, shipped as metadata

**The observation.** M4 is our strangest fact: on Mellum, skipping cold experts
at 0.5 **improves** multilingual perplexity by a margin 4 orders of magnitude
above run-to-run noise. The natural hypothesis is that rarely-activated experts
are, for the current domain, **under-trained noise** added to a good signal.

**The idea.** If that hypothesis is right, the improvement should be *sharper*
when the mask is chosen per language rather than by runtime cache residency,
which is a proxy that has nothing to do with linguistics. So: compute a
per-language expert usage histogram offline, derive a static mask per language,
ship the masks as GGUF metadata. At inference, detect the language from the first
tokens (cheap, already done for other reasons) and apply the mask.

That gives fewer expert bytes, *better* quality if the noise hypothesis holds,
and zero runtime decision cost. It also converts our weirdest measurement into a
product feature rather than a footnote.

**Cheapest decisive test.** We already have multi5 corpora in 5 languages and a
PPL harness. Per language: histogram expert usage, mask the bottom X %, measure
PPL with the language's own mask vs the global drop-cold at the same byte budget.
The comparison must be **at equal bytes**, otherwise it is not a fair fight.

**What would kill it:** per-language masks performing no better than
cache-residency drop at equal bytes — which would mean the M4 improvement is not
about language-specialisation at all, and would make the mystery deeper rather
than solved. Also: if expert usage histograms turn out nearly identical across
languages, there is no mask to build.

**What I want from you:** first, do you have an explanation for M4 that does not
involve the noise hypothesis? A PPL *improvement* from removing computation is
the kind of result that usually means a measurement artifact, and I would rather
you attack it than have me build on it. Second, is per-domain expert masking at
inference time published (as distinct from permanent pruning like REAP)?

---

## Idea 5 — Quantisation by temperature: precision keyed to measured access frequency

**The observation.** M4 says cold experts contribute so little that removing them
entirely costs +1.6 % bpb — and at d=0.3 essentially nothing. Removing an expert
is the extreme case of quantising it to zero bits. The continuous version should
strictly dominate the binary one.

**The idea.** Quantise **per expert**, keyed to measured runtime access frequency
on a real corpus: the hot ~16 experts at Q5/Q6, the warm band at Q4, the long
cold tail at Q2. One GGUF, mixed precision at expert granularity, no runtime
decision. Because we stream from flash, fewer bytes is directly fewer
milliseconds — unlike in a resident setting where mixed precision mostly buys
memory.

This is the only idea here that reduces bytes per token with **no quality cliff
and no policy** — it is a file-format change, not an inference-time gamble.

**Cheapest decisive test.** We already have the requantisation pipeline (KEXP)
and the PPL harness. Build one mixed-precision GGUF from an access histogram,
measure macro bpb against the uniform-quantisation baseline **at equal file
bytes**, and measure decode on one device.

**What would kill it:** M8's lesson, which we have already been burned by twice.
On weak silicon fewer bytes did **not** mean more decode: KEXP on G99 was
dequant-bound on 2×A76 (8.83 t/s against a 14.7 projection) because sub-4-bit
dequantisation costs more CPU than the saved bandwidth. So this idea can win the
byte argument and still lose the wall-clock one — the test must measure decode,
not bytes, and must run on the weak device, not the strong one.

**What I want from you:** expert-wise mixed-precision quantisation exists in the
literature (MoQE and others). Is anyone keying it to **measured runtime access
frequency** rather than to weight statistics or gradient sensitivity? And is the
dequant-cost trap I describe going to eat the entire gain on ARM little cores?

---

## What I am NOT asking

Do not try to rescue self-speculative decoding for byte throughput. M2 and M3
closed it and I have accepted that. If one of the five above happens to reopen it
as a side effect (Idea 1 is the only candidate), say so — but do not go looking.
