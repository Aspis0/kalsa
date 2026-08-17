# Prompt for Qwen 3.8 Max — attack this speculative-decoding proposal

Context: on-device MoE LLM inference, experts streamed from flash. Model:
Qwen3.6-35B-A3B (256 experts, top-k=6, ~13.4 GB on disk, 2000 MiB expert cache).
Also a hybrid: sequential GDN recurrent layers interleaved with attention.
Devices: Android phones (4-12 GB RAM) and a Windows PC.

I want you to attack the proposal in section 5. Last time you corrected a real
error in my reasoning and it changed what we built, so please be hostile rather
than encouraging. If the idea is unsound, say so and say exactly where.

---

## 1. What we built and measured (all numbers below are measured, not estimated)

**Frozen-state self-speculative decoding.** The draft is the same model with a
cheaper expert budget; crucially the GDN recurrent state is FROZEN during
drafting (skip-write: the state-store node is turned into a no-op at compute
time), so speculative tokens cannot poison the recurrent state. Rollback is
attention-KV only. Four bitwise gates verify that freezing does not contaminate
and that catch-up reconstructs the state exactly (max |delta_logit| = 0 across
300 positions).

Measured, teacher-forced, gamma=4:
- alpha_step1 = 0.987, macro acceptance 0.823, E[L] = 2.995 accepted draft tokens
- alpha_alltok = 0.413 (the all-token metric comparable to published work)
- Real decode loop: acceptance 8.6% -> 24.6% with the freeze on
- RAM: 251.25 MiB saved (the recurrent-state buffer scales as
  (n_rs_seq + 1) x 62.81 MiB, and the draft context needs no extra row)

For comparison, the closest published work (Component-Aware SSD, arXiv:2605.01106)
tried the OPPOSITE polarity (SSM-only draft) on sequential hybrids and reported
alpha = 0.038 all-token at k=2. Our 0.413 is an order of magnitude above.

**But it is slower than plain decoding everywhere we measured: 0.31x on PC,
0.44x on phone.** It reads MORE bytes from flash than it saves: 32.8 GiB vs
12.7 GiB for 256 tokens.

## 2. The invariant that explains the failure

With alpha = draft byte cost per draft token (relative to one full k=6 token),
beta = verify byte cost per verified token, L = emitted tokens per cycle:

    batch verify:      bytes/token = [gamma*alpha + (gamma+1)*beta] / L,  L <= gamma+1
    sequential verify: bytes/token ~= beta + gamma*alpha/L

Since L <= gamma+1, **if beta >= 1 then bytes/token >= 1 even with free drafts
(alpha = 0)**: speculation can at best tie plain decoding. The only escape is
beta < 1. For our regime (gamma=4, alpha=1/3, L~3) break-even is beta < 0.56,
i.e. fewer than ~3.3 experts on average during verification.

Why beta < 1 is conceivable at all: to GENERATE you need the argmax over the
whole vocabulary, hence all 6 experts. To CERTIFY a proposed token you only need
to show its logit beats every other token, which might be decidable after 2-3
experts plus a bound on what the missing ones could contribute.

## 3. We measured that, and it failed

Argmax agreement under top-j experts vs full k=6, teacher-forced, 1037 positions
across 4 prompt sets (fact, creative, longfact, code):

| j | agreement | implied avg experts | beta |
|---|---|---|---|
| 2 | 0.6905 | 3.24 | 0.540 |
| 3 | 0.8120 | 3.56 | 0.594 |
| 4 | 0.8640 | 4.27 | 0.712 |
| 5 | 0.8685 | 5.13 | 0.855 |

(implied avg experts assumes the policy "certify at j, else fall back to full 6
reusing the j already loaded": avg = rate*j + (1-rate)*6, beta = avg/6.)

Harness correctness check: j=2 landed on 0.6905, matching an independent earlier
measurement of the same quantity to four decimals.

Verdict: DEAD. Only j <= 3 could ever pass (j>=4 fails on the structural floor
4/6 = 0.667 > 0.56 even with perfect agreement). j=3 misses by 6%. j=2 nominally
clears by 3.6%, but argmax agreement is an UPPER BOUND on certifiability -- real
certification must PROVE the winner with a bound on unloaded experts, which is
strictly stricter than "the argmax happened to coincide". So that 3.6% is the
error bar, not a result.

## 4. Meanwhile, a separate result moved the baseline

Independently we have a flag `--drop-cold-experts f` that drops a fraction f of
the experts that are NOT resident in the expert cache (dropped by cache
residency, NOT by router rank -- this is a different operation from the top-j
truncation in section 3).

Measured on the same 35B model, 5 languages, ~59k tokens per arm:

| arm | throughput | macro bpb |
|---|---|---|
| drop 0.0 | 5.807 tok/s | 0.6781 |
| drop 0.8 | 6.401 tok/s (+10.2%) | 0.6889 (+1.6%) |

Caveat that makes +10.2% conservative: the drop-0.8 arm ran under CPU contention
from another job for 100% of its wall time, the drop-0.0 arm for only 8%. The
faster arm was also the more disturbed one.

Caveat on the other side: we did NOT instrument read bytes in that cell, so the
byte saving of drop-0.8 is the flag's design intent but is UNMEASURED. Only the
throughput and the bpb are measured.

So: dropping 80% of cold experts costs 1.6% bpb and buys at least 10% throughput.

## 5. The proposal I want you to attack

Use the lossy-fast config as the DRAFT and the full config as the VERIFY:

- draft = same model, `--drop-cold-experts 0.8` (cheap, occasionally wrong)
- verify = same model, full k=6, no drop (exact)
- accept/reject as usual, so the output is bitwise identical to the full model
- the frozen GDN state is the plumbing that makes this legal on a hybrid

The appeal: we previously killed a dense-model speculation idea because we needed
a draft 5-10x cheaper than the target and the available pair (Qwen3.5 2B vs 4B)
had a cost ratio of 0.755, far too close. A drop-based draft is the SAME
checkpoint -- no second model, no extra RAM, no extra weights to ship.

My own regime analysis, which may be wrong:

- **I/O-bound regime** (35B on a phone, streaming from flash): verify must be
  exact so beta = 1, hence bytes/token >= 1 and speculation still cannot win.
  Better to ship drop-0.8 alone and accept the 1.6% bpb.
- **Compute-bound regime** (model fits in RAM; we measured prefill/decode = 2.33x
  on the small dense models, so batching does amortize there): verifying gamma+1
  tokens in one batched pass amortizes compute. Rough arithmetic with draft cost
  0.2, gamma=4, alpha=0.9: E[L] ~ 3.1, L ~ 4.1, passes/token = (4*0.2 + 1)/4.1 =
  0.44, i.e. ~2.3x.

## 6. What I specifically want you to attack

1. **Is bpb a valid proxy for acceptance rate?** My worry: bpb measures
   log-likelihood of gold tokens over the full distribution, while acceptance
   depends on top-1 argmax agreement. A config could have nearly identical bpb
   yet frequently flip the argmax when top-1 and top-2 are close. If so, the
   +1.6% bpb tells us almost nothing about alpha, and the whole proposal rests on
   a non-sequitur. How would you bound alpha from bpb, if at all?

2. **The cache-coupling hazard.** The draft drops experts because they are cold.
   But the verify loads all 6 experts, warming them. So the verify's cache side
   effects change what the next draft considers cold: draft cost and alpha are
   non-stationary and coupled to the verify. Does this break the scheme, merely
   complicate it, or does the huge working set save us? (Measured routing
   entropy: 96% of the 256 experts are touched within 300 tokens, top-16 experts
   carry only 25% of the mass, ~45 expert re-reads per token. Cache is 2000 MiB
   against 13.4 GB of weights.)

3. **Is the disagreement concentrated where it hurts?** Experts are dropped for
   being cold, and cold plausibly correlates with rare/specialized. If so the
   draft fails precisely on rare, informative tokens, and the average bpb hides a
   concentrated failure mode that would wreck acceptance in exactly the passages
   users care about. Is there a principled way to test this cheaply?

4. **Is my regime split right?** Specifically, is there a way to get beta < 1
   that I have not considered, given that verification must be exact? Or a
   formulation where the batched verify amortizes BYTES and not just compute, on
   a MoE where consecutive tokens route to nearly disjoint expert sets?

5. **Anything else that is simply wrong** in sections 1-5.

The next measurement I plan is cheap: reuse the section-3 harness, replace
`--n-expert-used j` with `--drop-cold-experts 0.8`, and measure argmax agreement
against drop-0. That directly gives alpha for a drop-based draft. Before I spend
the machine time: is that the right number to measure, or is there a cheaper or
more decisive one?
