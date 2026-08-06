# ROUND 1 — Adversarial attack dossier

**Role:** second speaker, four-round roundtable on running Qwen3.6-35B-A3B (UD-IQ2_M, 11.52 GiB) on an
S23 (8 GB, UFS 3.1) by streaming experts from flash.
**Target:** `r0-dossier.md` (Round 0), checked against BRIEF.md (ground truth, wins), PLAN.md §3/§7/§9 +
Registro, `reports/moe-f4.md`, `reports/moe-f3.md`.
**Method:** every number re-derived independently; every empirical claim carries a source or
`[speculation]`. MiB = 2²⁰ bytes, MB = 10⁶ bytes. BRIEF mixes both; I follow the runtime's MiB
convention and convert explicitly where it matters.

**Headline of this round.** Round 0's *strategic* conclusion — "more I/O workers is dead; fewer
bytes, more contiguity, better hit rate are the live levers" — survives. But its *central factual
claim* — "the runtime is at the storage ceiling, 425–450 MiB/s delivered, ~0% headroom at the
current layout" — does **not** survive independent re-derivation. The two headline cache numbers
from the same log line are mutually inconsistent under any simple counting model, and a number
Round 0 barely mentions — **4,848 re-reads over 64 tokens, i.e. ~55% of all cache misses are
re-loads of experts LRU evicted moments earlier** — changes the diagnosis from *saturation* to
*self-inflicted churn*. The most valuable single measurement in the whole project has never been
taken (the `/proc/<pid>/io` read_bytes window). Also: Round 0's H4 (prefetch) is dead by
arithmetic it itself mis-models, and its H5/H1 tables contain errors its own formulas contradict.

---

# Part A — Independently re-derive the physics

## A.0 The two log lines that started the dispute

From the F4.2/F4.3-bis logs [M]:

```
decode 0.201 s/tok = compute 0.116 + cache_mgmt 0.012 + flash_io 0.319 (overlap); 266 MiB/s
read 84.73 MiB/token, hit 56.9%, cache 2000 MiB, 8843 evictions, 4848 re-reads (75.8/token)
```

Sanity: 84.73 MiB/tok × 5.02 tok/s = **425.3 MiB/s** [D]. 84.73/(1−0.709) = 291.2 MiB ≈ the
weighted naive 291.1 MiB [D] — so the *byte* number is byte-hit-consistent. Note the last item in
the log: **4,848 re-reads / 64 tokens = 75.8/token; evictions 8,843/64 = 138.2/token = 320×0.431**,
i.e. evictions ≈ misses (cache always full), and **54.8% of all misses are re-reads of experts
evicted earlier in the same run** [D]. I will come back to this; it is the most important number
in either round and neither BRIEF nor Round 0 built on it.

## A.1 The bandwidth question — "settled" is overclaimed; the truth is a measurement away

Round 0's chain: (i) `t_flash_io` cannot be exclusive wall I/O because 0.201 < 0.319, so it must
be thread-seconds; (ii) therefore 266 MiB/s is an artefact; (iii) wall-clock delivery is
84.73×5.02 = 425 MiB/s ≥ fio's 413; (iv) therefore we are at the ceiling and "make I/O faster"
is dead.

I agree with (i) in its negative form and with the *conclusion* (iv); I reject the positive
derivation (ii)+(iii) as the only consistent reading, for three reasons.

**Reason 1 — conservation does not fix the flash rate; it fixes only the *counted* rate.**
In steady state the app consumes 84.73 MiB of *counted* bytes per token. The flash interface must
deliver whatever fraction of those bytes is not already in the kernel page cache. The counted
rate (425 MiB/s) exceeds the qd1 fio ceiling (413) — which is only possible if (a) the device
delivers more than the qd1 median under the app's pattern (QD4, ~1 MiB, some contiguity), or (b)
some counted bytes never touch flash. Option (b) is not exotic: the fork reads via buffered
`pread` (O_DIRECT was never implemented on this path — PLAN §3.3, kimi-k3 lesson, still "da
valutare"), so every read passes through the page cache. 75.8 of the 138.2 misses/token are
*re-reads* of bytes read seconds earlier; those pages are precisely the ones most likely still
resident in the kernel cache (which holds ~1–2 GB here). Round 0's Reading 2 requires option (b)
to be ~zero; the re-read structure of the workload makes that the least plausible value, not the
most.

**Reason 2 — the runtime's own 266 MiB/s is exactly what the device should give for the app's
actual read sizes.** F0.6 [V] established that one expert is **three non-contiguous tensor
slices**: gate 270,336 B (264 KiB), up 270,336 B, down 401,408 B (392 KiB; 544 KiB in layers
34/38/39). If the fork reads per-slice — and the non-contiguity forces per-slice reads unless the
loader is doing something it has no reason to do — the read pattern is 264–544 KiB random, not
1 MiB random. fio on this device: 256k = **214 MiB/s**, 1M = **413 MiB/s** (qd1 medians) [M, F2.1].
The runtime's 266 MiB/s sits exactly in the 256k-class band. That is a *device-rate* signature,
not a thread-accounting artefact: **the runtime's own number is self-consistent as the true disk
rate for a 264–392 KiB pattern** (agreeing with it does not require t_flash_io to be exclusive
wall time; it only requires the pipeline to run one token ahead, which "overlap + 4 io threads"
is designed to do).

**Reason 3 — the page-cache-served fraction reconciles every number simultaneously.** Take
B_disk ≈ 266–300 MiB/s (per-slice pattern), counted rate 425 MiB/s ⇒ ~30–40% of counted bytes
served from the kernel page cache (the re-read stream, 68 MiB/tok ≈ 80% of traffic, is the
natural candidate); per-token disk service ≈ 84.73×(0.6–0.7)/280 ≈ 0.18–0.21 s ≈ decode 0.201 ✓;
io-threads 5 doesn't help because the device is at its *pattern* ceiling (QD≈3–4 for 264 KiB
random), not because of a universal 413 MiB/s wall ✓; wall-clock 425 > fio 413 is no longer a
contradiction because the counter is not a disk counter ✓. Every number in the log is coherent
under this reading. Round 0's reading is *also* coherent but requires the page cache to serve
≈0% of the re-read stream — an assumption it never states and never checks.

**Verdict.** The conclusion both rounds need — "adding I/O workers is dead" — is robust (the
io-threads-5 cell is direct evidence regardless of accounting [M]). But "the runtime is AT the
storage ceiling, headroom ≈ 0 at the current layout" is **unproven and probably wrong in detail**:
the binding constraint is most likely the *read pattern* (264–392 KiB slices ⇒ 214–280 MiB/s
class) plus *self-inflicted churn* (55% of misses are re-reads), not a hard 413 MiB/s wall.
That changes priorities: per-expert read fusion (my D4) and churn removal (my D2, Round 0's H2)
look *larger* relative to co-activation packing (Round 0's H3) than Round 0 ranks them.

**The measurement that settles it** (Round 0 proposed it; I second it, with the addition that it
must run in the *valid* top-app regime): `/proc/<pid>/io` `read_bytes` over a fixed 64-token
window, cold page cache, plus a competing background fio 1 MiB job.
- If `read_bytes/tok` ≈ 84.7 MiB ⇒ counted = disk, Round 0 right, flash rate ≈ 425.
- If `read_bytes/tok` ∈ [50, 70] MiB ⇒ page cache serves the re-reads, Round 0's Fact 3 is
  wrong, and the "ceiling" is a pattern artefact.
- If `read_bytes/tok` > 84.7 MiB ⇒ the kernel is re-faulting *more* than the app counts (the
  33.09 GB / 64-token figure seen in the 3-core regime hints at this class) and both rounds are
  missing a whole layer of traffic.

**A warning from the archive:** the only `read_bytes` data point that exists (F4.2-era, 3-core
regime: 33.09 GB over 64 tokens ≈ 313 MiB/tok after subtracting the 11.52 GiB load [M, PLAN
Registro 2026-08-06]) is 3.7× the counted bytes. It was taken in an invalid regime and must not
be used — but it is the only direct evidence we have about what the flash interface actually
sees, and it does not support "425 = flash rate". Do not cite it either way until re-measured.

## A.2 The roofline, from first principles

Symbols: A = active FLOPs per token ≈ 2×3.145e9 = **6.29 GFLOP** [D] (2 flops/MAC, 8 routed +
1 shared = 9 experts × 3.146M params × 40 layers ≈ 1.13B expert params + ~1.6B attention/embed/
output — the ~3B "active" [D, my count: 2.7–2.9B, see A.4]); Π = sustained CPU throughput;
B_naive = 291.1 MiB/tok (weighted); h = byte-hit; B_dev = effective device bandwidth;
t_cache = 0.012 s (serial, measured).

Model (overlap, one-token pipeline, steady state):

```
t_token = t_cache + max( A/Π , (1−h)·B_naive/B_dev )            (Eq. 1)
```

The max() is the empirical structure of the fork (`--overlap`); t_cache is the only serial term.

Current operating point [M,D]: A/Π = 0.116 ⇒ Π ≈ 54 GFLOPS; (1−0.709)·291.1/425 = 0.199 s
(Round 0 reading) or /280 ≈ 0.30 s (my reading, if the 425 is inflated). Under the Round 0
reading the I/O term beats compute by **1.72×**; even under the most favourable legitimate
reading it is the pacemaker. 1/(0.012+0.199) = 4.74 and 1/(0.012+0.189) = 4.97 bracket the
measured 5.02 — the model is calibrated.

Ridge points (where the regime flips), each a single equation:

- **Compute crossover:** A/Π = B_miss/B_dev ⇒ Π* = A·B_dev/B_miss = 6.29e9×446/88.8e6
  ≈ **32 GFLOPS** ⇒ at the *current* traffic, compute would have to drop below 32 GFLOPS for
  compute to bind. It is at 54. The system is I/O-bound by a factor of only **1.7**.
- **Bandwidth crossover:** B_dev* = B_miss·Π/A = 84.73×54.2/6.29 ≈ **730 MiB/s** — 1.7–2.7× the
  current effective rate, i.e. achievable by per-expert read fusion alone (D4) on the 413-class
  pattern, without any co-activation packing.
- **Hit-rate crossover:** h* = 1 − Π·B_naive/(A·B_dev) ≈ 1 − 0.116×446/291.1... in MiB:
  1 − (0.116/0.189)×0.291 = 1 − 0.1787 ≈ **0.82 byte-hit** makes the system compute-bound at
  current bandwidth. We are at 0.709. **Twelve byte-hit points saturate the benefit of all
  further I/O work** — an important boundary for H2/H1/D1: the prize for hit-rate work is finite
  and ends at 7.8 tok/s.

Max achievable with perfect overlap at this compute: 1/(0.012+0.116) = **7.8 tok/s** — the
architecture ceiling. Every hypothesis below is a bid on how to get from 5.02 to 7.8, or on
moving 7.8 itself.

**Where is the current configuration on this surface?** At ~93–96% of the I/O roofline *given
the observed bytes and hit rate* (Round 0 reading), or ~60–75% of the pattern-limited roofline
(my reading). Both readings agree the *residual* is not "queue depth" — it is bytes, contiguity,
and hit rate. That part of Round 0 is right and survives.

## A.3 Arithmetic intensity — and why the answer changes inside the decode loop

Compute-path (RAM) intensity: 6.29 GFLOP against ~1.4 GB of resident active weights touched per
token (1.13B expert params at 0.30 B/param + ~1.6B non-expert at ~0.55 B/param) ≈ **4.5 FLOP/B**.
The CPU delivers ~54 GFLOPS ⇒ the compute path is *not* RAM-bound (12 GB/s « LPDDR5X). It is
**kernel/overhead-bound**: 54 GFLOPS is 5–10% of 8 Gen 2's int8-class capability, and the
per-layer work is tiny (a 2048×512 expert GEMM is 4.2 MFLOP). [speculation on the split: a
meaningful share of the 0.116 s is dispatch/barrier overhead, not dot-product — this is
consistent with F4.2-era observations of many small matmuls, but was never profiled in the valid
regime.]

Flash-path intensity: 6.29 GFLOP / 88.8 MB = **70.8 FLOP/B** — 16× the RAM-path intensity, and
I/O-bound because the device delivers only ~5 FLOP/s per B/s of flash (446 MB/s → 54 GFLOPS needs
a device at 6.29e9/54 ≈ 116 MB/s... equivalently: t_io/t_compute = 1.7 as computed).

**Is the answer the same at every point in the decode loop? No.** Decompose per layer-block:
expert sublayers read ~7.5 MiB (8 experts × 0.942 MB) and compute ~2.9 ms ⇒ I/O:compute ≈
7.5/280–0.45 ≈ 17 ms : 3 ms ⇒ **I/O-bound ~6:1 at the expert sublayer**. Attention sublayers
(full-attn and DeltaNet) read no flash for weights, compute ~2–3 ms each, are pure
compute/latency-bound on 2048-wide GEMMs. The aggregate is I/O-bound only because expert
sublayers dominate the timeline. Two consequences: (i) any per-layer prefetch scheme has ~2–3 ms
of genuine compute it could hide behind *within* each block — but see H4 for why that is worth
nothing in steady state; (ii) the attention layers are where *latency* lives (small GEMMs,
batch 1), and a latency budget of ~25–35 ms/token is hiding inside the 0.116 s — invisible to
tok/s, relevant to TTFT and to any future batching.

## A.4 Architecture audit — Round 0's corrections are correct; two residual errors

Checked against BRIEF §3 and F0.6/PLAN §3.1 [V]:

| item | value | verdict |
|---|---|---|
| layers | 40 | ✓ (R0's kill of the stale "45" is right) |
| routed experts / active | 256 / 8 | ✓ |
| shared expert | 1, always-on, resident | ✓ |
| hidden / expert FF dim | 2048 / 512 | ✓ |
| full_attention_interval | 4 → 10×(3 GDN → 1 GA) | ✓; 30 GDN + 10 GA = 40 ✓ |
| KV | 2 heads × 256, 10 layers → ~10 KB/tok, ~40 MB @4k | ✓ |
| expert size | 942,080 B (37 L) / 1,097,728 B (34/38/39) | ✓ |
| naive traffic | 8×(37×942080+3×1097728) = 305,201,152 B = 291.1 MiB | ✓ re-derived |
| byte-hit | 1 − 84.73/291.1 = 70.9% | ✓ |

Round 0's three loud disagreements with BRIEF/PLAN (266-vs-413, 343 MB/45 layers, 74% vs 70.9%)
are **correct**. I add:

1. **The 343 MB double-count is still alive in PLAN.md.** The Registro "Coda dei lavori"
   (2026-08-06) entry still computes "senza cache il traffico sarebbe ~343 MB/token (37 layer ×
   9 × 0.942 + 3 × 9 × 1.098)" — the ×9 counts the shared expert against flash traffic, the same
   error BRIEF §3 documents. Anything derived from that entry (the "74% byte-hit" expectation for
   cache-3000, the "10–15% gain" estimate) carries the stale baseline. PLAN.md's own §9/§5 are
   clean; the Registro is not.
2. **BRIEF §5.1 internally contradicts BRIEF §3:** §5.1 says "h ≈ 74% [D]" while §3 derives
   70.9%. The 74% is the stale-baseline number. Round 0 flagged the 74% elsewhere but not here.
3. **R0's "shared expert ≈ 2.30 MB/layer ≈ 92 MB" is unverified.** At the routed-expert quant
   (2.4 bpw) a shared expert is ~0.94 MB/layer ⇒ 38 MB; 2.30 MB/layer implies ~5.8 bpw (plausible
   if Unsloth keeps shexp at a higher quant, but the GGUF dump line was not cited). Both are
   small next to 2 GB of cache; flagging for completeness, not because it matters.
4. **"~3B active params" is the upper edge.** My independent count: 1.13B expert + ~0.9–1.0B
   attention (10 GA ≈ 21M/layer, 30 GDN ≈ 25M/layer) + ~0.6B embed/output ≈ **2.7–2.9B**. Fine as
   an order of magnitude; not a number to divide anything by.
5. **The two headline cache numbers cannot both mean what both rounds assume.** From one log
   line: hit 56.9%, 84.73 MiB/tok. Per-load hit consistent with the byte number is
   1 − 84.73/(320×0.942) = 0.719. If hit were per-expert-load at 0.569, miss bytes would be
   320×0.431×0.942 = 130 MiB ≠ 84.73. If per-slice (960 slices/token), 0.569 gives 0.31×413 = 128
   MiB. If per-*layer-batch* (8 experts), P(no miss) = 0.719⁸ ≈ 0.08 ≠ 0.569. **No simple counting
   model reproduces both numbers simultaneously.** Either `cache_hit_pct` counts something exotic
   (e.g. "expert fully resident at request time" where a request spans a prefetch batch), or one
   of the two numbers measures a different thing than the rounds believe. This matters: the F4.5
   "content dependence" result (56.9% → 71–77%) is expressed in the same suspicious metric. Both
   rounds treat it as per-request hit. **Resolve in the fork's source before building anything
   on it** (Part E, Q2).

---

# Part B — Attack every hypothesis in Round 0

## Attack on H1 — Pool-halving via domain-calibrated REAP pruning

**Verdict: WOUNDED**

**The strongest objection.** The model table does not follow from the model formula. R0's own
equation, T' = T·(1−c/(1−p))/(1−c) with c = 0.207, gives at p = 0.50: (1−0.207/0.5)/0.793 =
0.739 ⇒ **T' = 65.6 MB/tok**, i.e. ~5.9 tok/s at 425 MiB/s — not the "45–55 MB/tok, 6.5–7.5
tok/s" in the table. The table's numbers require byte-hit to rise from 0.709 to ~0.85 on a
coverage increase of 0.207→0.414, i.e. near-perfect transfer of coverage into hit — which holds
only if the pruned experts were exactly the never-used ones *and* misses are compulsory
(pool-limited) rather than policy-limited. That premise directly contradicts H2's own premise
(policy misses are material — LRU precision 29%, SpecMD collision misses
[arXiv:2602.03921](https://arxiv.org/abs/2602.03921)). **H1 and H2 cannot both be the main
story.** The re-read datum (55% of misses are LRU-churn re-reads of *resident-pool* experts)
says a large share of misses are *not* compulsory — so a pool cut attacks at most the
non-churn fraction. WOUNDED, not FATAL, because pruning also cuts TTFT load time (11.5 → ~6 GB)
and improves *relative* coverage even under churn — but the quantitative case as written is
inflated ~30–40%.

**Hidden assumptions not stated.** (1) Working set shrinks with pool (the REAP-pruned survivors
cover the same tasks). Untested, and the pruned models that exist are coding-calibrated — the
worst-locality domain in F4.5 (67%). (2) A usable Italian PPL instrument exists. It does not —
F4.5 is 5 human-read prompts; BRIEF §5.4 says so in words. (3) The quality claim "~97% retained"
transfers from English coding benchmarks to Italian chat morphology at 2.4 bpw. (4) Pruning
doesn't change the *routing* (REAP keeps router weights; but with 128 experts gone the router
scores renormalize — gate distributions shift, which is exactly where the last 3% of quality
lives). (5) The 21% coverage number is computed against the *whole pool*; the churn analysis
suggests the effective working set per run is ~40% of the pool (≈4,000 unique experts/run from
the miss count) — pruning 50% of *cold* experts is therefore mostly pruning things that were
never going to be read, which moves hit-rate less than the coverage math promises.

**Arithmetic check.** Redone above. R0's formula is a defensible linear model; its table is not
its formula. Which is right? The formula, as a bound; the truth needs h(C) for the pruned model,
which does not exist (BRIEF §5.1: one point on the curve, unpruned).

**Prior art check.** REAP [arXiv:2510.13999](https://arxiv.org/abs/2510.13999), code public,
extends to Qwen3.5-class, up to 50% experts at ~97% claimed — that claim is from the paper's own
benchmarks; R0 represents it fairly. What R0 does not represent fairly is the *transfer*: REAP's
quality numbers are on coding/generative English benchmarks. [Verified: no Italian or
Romance-morphology REAP result in the sweep.] HOBBIT (see H5) is the precision-side cousin and is
measured on Jetson, not phones.

**If WOUNDED: what would have to change.** (i) Fix the arithmetic (65.6 MB/tok, ~5.5–6.0 tok/s
at p=0.5 — still the biggest single lever among the lossy ones); (ii) build the Italian PPL
instrument first (R0 agrees; PLAN Registro agrees — "misurare prima, pruning dopo"); (iii) test
the premise conflict with H2 by measuring *what fraction of misses are churn vs compulsory*
from route traces before spending the irreversible prune; (iv) prune in 25% steps with a PPL
gate at each step (R0 already proposes this). In mutated form — *after* the policy/budget work
(D2, H2) has removed churn — H1 survives as the lever that reduces load/TTFT and raises
coverage simultaneously.

## Attack on H2 — Replace LRU with W-TinyLFU / Least-Stale admission

**Verdict: SURVIVES — as a diagnostic; the expected-value table is unjustified**

**The strongest objection.** The expected gain (+5–12 byte points) is taken from results on
other hardware/regimes: SpecMD's Least-Stale "up to 85× fewer collision misses" is measured on
OLMoE with a **0.6 GB VRAM cache** [arXiv:2602.03921](https://arxiv.org/abs/2602.03921) — a
different model family, a different cache:pool ratio (~5%), and VRAM. The offline SCH curves
(81–97% LRU window hits) that make 85–90% "expected" at 21% coverage are *future-aware* windows
from [arXiv:2505.16056](https://arxiv.org/abs/2505.16056), not online LRU. Our one measured
point: 56.9% request-hit / 70.9% byte-hit at 21% coverage. The gap between "expected ≥85%" and
measured 71% byte-hit has three candidate causes (working set too large / policy too weak /
benchmark content pathological — F4.5's 71–77% on Italian supports the third) and **nothing
discriminates among them yet**. If content skew is the main cause, the policy win on real
traffic is bounded by 71→~85 ≈ 14 points *at most*, and the *real* number could be <3.

**Hidden assumptions.** (1) That a big share of our 29% byte-miss is policy-avoidable. The
re-read datum cuts both ways: 55% of misses are re-reads (LRU churn — *policy-shaped*, in
principle fixable by admission control *or by a bigger cache*), but the other 45% are
first-time-in-run misses (compulsory at this budget — only budget or pool size fixes those).
(2) That the fork's hit accounting (unresolved, A.4.5) doesn't corrupt the comparison. (3) That
the eviction policy is plain LRU — F0.4's audit of BigMoeOnEdge's eviction was summarized as
"LRU" but the fork also has `--drop-cold-experts`, `--predict-prefetch`, `--route-ahead`; the
policy baseline must be pinned in source before any bake-off. (4) On OUR device, the added
per-access cost of a frequency sketch at 320 lookups/token is negligible (true: ~µs), so that
assumption is fine.

**Arithmetic check.** The Δh table is internally consistent (Δh=+0.05 → 73 MB → ~5.7 tok/s at
425 MiB/s ✓). The problem is the *domain* of Δh, not the arithmetic. One correction: at
Δh = +0.12 the system hits the h* = 0.82 crossover and stops being I/O-bound; the table's Δh =
+0.15 row (7.0 tok/s) understates the ceiling — at h ≥ 0.82 the answer is 7.8 tok/s regardless.
Minor.

**Prior art check.** Correctly cited: LRU precision 29.1% / recall 58.2% for Mixtral
([arXiv:2511.05814](https://arxiv.org/abs/2511.05814) — cited as-is), SpecMD Least-Stale
([arXiv:2602.03921](https://arxiv.org/abs/2602.03921) — 85× collision-miss reduction, 88% hit,
TTFT −34.7% [verified via search]), ARC/LIRS/TinyLFU ([FAST'03](https://www.usenix.org/event/fast03/tech/full_papers/megiddo/megiddo.pdf), [TinyLFU](https://arxiv.org/abs/1512.00727)). No misrepresentation found. The transfer problem is real, as stated.

**If WOUNDED/SURVIVES: what would have to change.** Reframe H2 as what it actually is: **the
cheapest discriminator between the three competing explanations of the hit gap.** Run the
offline replay (R0's own falsification: kill if best-policy − LRU < 3 points) — but interpret
the outcome: if the win is large → policy was the problem (and H1's compulsory-miss premise is
weakened); if small and the *re-read* share is still ~55% → the problem is budget (D2); if small
and re-reads are low → content skew (then the 56.9% benchmark number is a floor and the product
is already at 71–77%). All three outcomes are worth more than the policy win itself.

## Attack on H3 — Co-activation packing (GGUF rewrite)

**Verdict: SURVIVES — top lever, with one unmodeled tension and one sequencing error**

**The strongest objection.** The γ table assumes every span byte is useful. A packed span read
is a *span* — it pulls in all experts in the span, including ones already resident in the app
cache. Those duplicates waste flash bandwidth at exactly the rate the project is short of it.
The severity scales with hit rate: the hotter the expert, the more likely it is *already in the
2 GB cache* when its cluster is read — so the most co-activated (hottest) clusters are exactly
the ones whose span reads waste the most. R0's model (84.73/413·γ) implicitly sets this waste to
zero. A correct first-order model: wasted = Σ_spans (cached-fraction of span), and the win is
γ_eff = (1+waste)·... A partial mitigation exists (pack *cold* co-activated clusters, or accept
waste when it buys a read-size jump from 264 KiB to 1+ MiB — which per A.1 is worth ~2× on its
own, see D4), but the mitigation is design work R0 did not price.

**Hidden assumptions.** (1) Co-activation structure is stable across content — the only traces
that exist today are the benchmark prompt; F4.5 shows hit-rate moves 20 points across content,
so cluster structure probably does too. Packing built on EN-bench traces would serve a product
that is 71–77% Italian. (2) UFS rewards 2–4 MB spans: fio says 1M = 413, 256k = 214 — the 4M
point is *unmeasured*; extrapolating the curve suggests ~600–900 MiB/s, **not** the 1.6 GB/s
sequential class (that's AndroBench bulk sequential on a different path — see Part C, claim 6).
So γ ∈ [1.3, 2.2] realistic, not [1, 4]. (3) The GGUF rewrite is compatible with the fork's
per-slice loader — it isn't automatically; the loader must learn the packed layout. (4) A
repacked 11.5 GB file must be rebuilt/redownloaded — disk is fine (40 GB free), but the *trace
→ pack → load* loop is weeks, and it is versioned model files (breaks stock-GGUF tooling).

**Arithmetic check.** Table re-derived: at γ = 1.5 (620 MiB/s), t_io = 84.73/620 = 0.137 →
1/(0.012+0.137) = 6.7 tok/s (I/O-bound still); at γ = 2, t_io = 0.103 < 0.116 → compute-bound
7.8. R0's table says 6.0–6.5 / 7.0–7.5 — close enough, the difference is the 425-vs-446 baseline.
The span-waste correction is the real error, not the arithmetic.

**Prior art check.** LLM-in-a-Flash bundling ([arXiv:2312.11514](https://arxiv.org/abs/2312.11514))
is neuron-granularity for dense FFNs — R0 states the mismatch correctly. Doubleword's −21.3%
unique-load oracle is on the same model family [blog, as cited in PLAN §3.3] — a *loads* bound,
not a *bytes* bound, and oracle (not achievable). No published expert-packed GGUF on a phone
UFS — the gap claim (G3) stands.

**If WOUNDED: what would have to change.** Split H3 into two sequenced pieces: (i) **D4** —
intra-expert fusion (3 slices → 1 blob), no traces, no clustering, ~1 day, captures the 214→413
MiB/s class jump; (ii) H3 proper — cross-expert co-activation clustering, which requires traces
on product traffic first and must be modeled with span-waste. Doing (i) first also *measures*
the true pattern ceiling (A.1) at near-zero cost, which de-risks the γ used for (ii).

## Attack on H4 — Cross-layer gate prefetch (Fate/SpecPrefetch class)

**Verdict: FATAL as stated — the model double-counts; only the cache-admission residue survives**

**The strongest objection.** On a device whose I/O path is rate-limited (A.1/A.2 — both readings
agree the I/O term is the pacemaker at 1.63–1.72×), prefetch cannot create bandwidth; it can
only change *when* bytes arrive. Round 0's β model, t' = 0.012 + 0.116 + (1−β)·0.073, assumes
the exposed stall (0.073 s) is a *scheduling* artifact that overlap can absorb. It is not: it is
the rate deficit. Per token, the device must move 84.73 MiB; compute offers 0.116 s of hideable
time; the device needs 0.189 s at 446 MiB/s. No schedule compresses device time. With prefetch
issuing w wasted bytes per token:

```
t_io' = (84.73 + w)/B_dev  ≥  0.189       (Eq. 2)
t'    = 0.012 + max(0.116, t_io')         (Eq. 3)
```

Every wrong byte is paid in the same currency (bandwidth) as the stall it was supposed to save,
at a 1:1 exchange rate, and the stall cannot go below zero. At SpecPrefetch's Recall@8
85.6–89.4% ([arXiv:2607.24787](https://arxiv.org/abs/2607.24787)) — i.e. ~1.1–1.4 of 8
predictions wrong per layer-token — wasted bytes ≈ 1.2×0.942×40 ≈ **45 MiB/tok**, t_io' = 0.29 s,
decode ≈ 0.30 s ⇒ **4.4% slower than baseline, not faster**. Even perfect recall (w = 0) leaves
t' = 0.201 unchanged in steady state — prefetching earlier does not make the device faster; the
pipeline already runs one token ahead (that is what the 4 io-threads and the wall rate ≈ ceiling
mean). The β = 0.9 → 7.4 tok/s row is therefore not optimistic — it is *impossible* at any
recall, on this device, at this traffic.

**Hidden assumptions.** (1) That the I/O system is latency-bound with idle capacity. The
io-threads-5 cell (−3.7%) and the wall-rate-vs-fio band both say it is not. (2) That wrong
prefetches are free. They are not — they consume the saturated resource. (3) That cross-layer
gate correlation survives the 3:1 GDN/full-attn hybrid — Fate's 97% accuracy
([arXiv:2502.12224](https://arxiv.org/abs/2502.12224)) is on homogeneous-stack models with
different layer structure; R0 flags this correctly. (4) Even if recall were 100%, the win is
bounded by the *prefill/TTFT* path (cold cache, no compute to hide under) — worth a look *there*,
not in decode.

**Arithmetic check.** R0's β table re-derived: their own numbers are internally consistent
(0.012+0.116+0.073·0.1 = 0.135 ✓) — the error is structural: the stall is not reducible by
scheduling on a rate-bound path. My Eq. 2–3 replace it.

**Prior art check.** Fate ([arXiv:2502.12224](https://arxiv.org/abs/2502.12224)) and SpecPrefetch
([arXiv:2607.24787](https://arxiv.org/abs/2607.24787)) are real and correctly described; R0
does not misrepresent them. The transfer failure is R0's own: SpecPrefetch's +20% "on slow
storage" was measured on a **Snapdragon 8 Elite** whose storage path is not bandwidth-saturated
at this workload — the paper's regime and ours differ in exactly the variable (saturation) that
the β model ignores. MoESD's non-monotonicity warning ([arXiv:2505.19645](https://arxiv.org/abs/2505.19645))
was cited correctly and should have been applied harder.

**If FATAL: what survives.** Prefetch as *admission*: bytes fetched early that stay in the 2 GB
cache and serve future tokens are not waste — they are H2 with a predictor attached. Under
saturation, H4's entire value reduces to H2's value (hit-rate), which the offline replay can
measure without any runtime. And on the *prefill* path (cold cache, 10 s, no overlap
opportunities), prediction is the one place latency hiding still has room. Reframe H4 as
"prefill prefetch" + "admission", kill the decode-overlap framing.

## Attack on H5 — Per-miss precision ladder (HOBBIT-style)

**Verdict: WOUNDED — the table is wrong by construction; real gain ≈ 0.3–0.5 tok/s**

**The strongest objection.** The table applies the precision ratio to *all* traffic: T' = 88.8·ρ
with ρ = 0.6 → 53 MB/tok. But the ladder only affects *miss* bytes — hit bytes are already in
the cache at full precision and are not re-read. Correct:

```
T' = h·T + ρ·(1−h)·T = T·(1 − (1−ρ)(1−h)) = 88.8·(1 − 0.4×0.291) = 78.5 MB/tok   (Eq. 4)
```

→ t_io = 0.176 s → ~5.3 tok/s at 425 MiB/s, **not 6.3**. At ρ = 0.5: 76.6 MB → ~5.4. The
mechanism is real (HOBBIT's own 9.93× is against *other offload systems*, on Jetson, starting
from a much worse baseline — [arXiv:2411.01433](https://arxiv.org/abs/2411.01433) [verified:
9.93× on Jetson AGX Orin vs SOTA MoE offloading]) but at our 2.4 bpw floor the headroom below
is ~1 bit, and the quality risk is concentrated on exactly the rare experts (Italian morphology)
that the F4.5 instrument cannot resolve.

**Hidden assumptions.** (1) That further quantization below 2.4 bpw is usable on *cold* experts
— the current model already emits ~2 malformed words/1k [M]; a cold-expert IQ1 path adds errors
on rare-word experts, i.e. precisely where the 2/1k live. (2) That a dual-store or on-the-fly
requant exists: on-the-fly requant of a 0.9 MB expert costs ~2–5 ms of compute per miss — the
same order as the flash read it is supposed to accelerate, and it steals from the 0.116 s compute
budget; a dual file doubles disk (fine) but doubles every tool's I/O surface. (3) That "cold" is
stable — LRU-cold today is hot tomorrow; a precision ladder that degrades an expert the model
suddenly needs mid-response is a *quality cliff*, not a smooth knob.

**Arithmetic check.** Eq. 4 replaces R0's table. Note also R0's own "T' = T_m·ρ" line (miss
traffic only) contradicts its table (all traffic) — the table is the error.

**Prior art check.** HOBBIT and EdgeMoE correctly summarized; the missing context is the
baseline gap: HOBBIT's speedups are vs mmap-thrash-class baselines, and it keeps *hot* experts
at full precision with a *large* headroom (their models run at 4-bit-ish hot / lower cold). We
have no headroom. Also relevant: `kimi-k3-in-c`'s byte-identical output requirement (PLAN §3.3)
— an engineering standard our product doesn't share, but a useful statement of what lossy
weight paths cost in trust.

**If WOUNDED: what would have to change.** Restrict the ladder to *promotion*: read cold at
low precision, promote to IQ2_M on second use (the re-read storm gives the promotion signal
for free). Then the byte cost is paid once per expert lifetime, quality degrades only on
single-use experts, and the arithmetic is the Eq. 4 bound *plus* the churn savings. Requires
the dual-store and the PPL gate. Until the gate exists, this stays ranked last (R0's ranking
is right for the wrong reason).

## Attack on H6 — Userspace compressed expert slab (novel claim)

**Verdict: WOUNDED — the novel branch is near-empty, the useful branch is H5 moved to RAM**

**The strongest objection.** Compression of *already-quantized* weights: IQ2_XXS data is
entropy-coded index+scale material; residual redundancy is small. R0's own [speculation]
q ∈ [0.85, 1.0] concedes this — and at q = 0.9, effective slots rise 2 GB→2.22 GB-equivalent,
+11% entities, worth ~+1–3 byte-hit points ≈ +0.1–0.3 tok/s, for a decompression path on the
critical path. LZ4 at 1 GB/s/core would decompress a hit's 0.9 MB in ~1 ms — that is *fine*
until you realize the compressed tier only pays when it holds experts the 2 GB cache cannot —
but the 2 GB budget is a *choice*, not a law: steady-state RSS is 4.6 GB against an ~5.6 GB
lmkd line (A.1, D2) — the marginal byte is worth more as a *full-precision* cache slot than as
a compressed one. The dual-precision variant (cold half at IQ1 in RAM) is HOBBIT with the tiers
renamed — same quality tax on every hit of a degraded slot, same missing quality gate — and the
"novel" claim is overstated: compressed weights in RAM is Deep Compression-class territory
(Han et al., 2016, Huffman-coded weights), zram/zswap is OS-level; the *combination* (userspace,
per-expert, streaming) is a defensible niche but the round should not call the mechanism new.

**Hidden assumptions.** (1) q ≪ 1 (compression pays) — the cheap microbench (R0's own kill
switch) is right and should be the *entire* pure-compression branch's budget. (2) Decompress
cost < flash miss cost — true on paper, but the comparison is wrong: the compressed tier
replaces *cache slots*, not flash misses; its competitor is a bigger full-precision cache. (3)
That the ~1 GB of RSS headroom to lmkd (4.6 → 5.6) is unusable — D2 argues it is usable, which
caps H6's addressable space.

**Arithmetic check.** R0's own scenarios are internally consistent; the flaw is comparative
(bigger plain cache dominates both branches at current headroom) — see D2's arithmetic.

**Prior art check.** As above. The claim "not found in the MoE offload literature as a
first-class design" is true in the narrow sense (I did not find it either in the cited sweep or
in my own check) — but novelty of *combination* is not novelty of *mechanism*, and the mechanism
is the weak part.

**If WOUNDED: what would have to change.** Re-cast as a *third tier under a hard budget*: only
after cache-mb is pinned at its lmkd-limited maximum (D2), the residual question "more entities
at lower precision vs fewer at full" becomes real, and then H6's dual-precision branch is the
right experiment — with the PPL gate. Until then, the pure-compression branch is a one-hour
microbench that will almost certainly print q ≈ 0.90–0.97 and die.

## Attack on H7 — Thermal-die-gated pacing / energy

**Verdict: SURVIVES as instrumentation; FATAL as a speed claim; the energy estimate is bad**

**The strongest objection.** The premise (a thermal cliff exists in the valid regime) is
unmeasured: BRIEF §5.7 — Thermal Status 0 throughout, die touched 47.1 °C inside a decode, no
throttling observed; battery-flat 4.84/4.98/4.84/4.92 from 32%→24%. The "half-speed after 10
minutes" datum is explicitly untrusted (invalid 3-core regime). H7 as written predicts
"sustained +20–50% vs unmanaged cliff" — there is no evidence a cliff exists to manage. The
*instrumentation* part is correct and urgent: the cooldown gate measures the battery (a damped
mass), the die swings 16 °C inside one run — the Registro already fixed this (max(cpu-*) gate);
R0 should have led with that instead of burying it in a hypothesis.

**Second objection — the energy number.** PLAN's Registro carries "35B streaming ≈ 6 J/token"
[speculation]. At 5.02 tok/s that is **30 W sustained** — impossible on a phone (battery
~15.8 Wh would die in ~30 min; the die would not stay at 47 °C). Even 8–12 W sustained burst is
high. A sanity estimate: 8–10 W × 0.201 s ≈ **1.6–2.0 J/token** [speculation] — the 6 J figure
is off by ~3× and would misrank every energy-tagged decision (H6's decompression, D1's extra
compute, GPU offload). Energy per token has never been measured (BRIEF §5.6: battery flat; the
J/token column doesn't exist in runs.csv).

**Prior art check.** Fair — no literature on expert-streaming J/token on UFS that I can find;
the OS thermal framework references are fine. The defect is internal to the project, not the
literature.

**If WOUNDED: what would have to change.** Ship the die-gated cooldown and the
power_w_mean/j_per_token columns (BRIEF already mandates; the Registro directive is the fix);
delete the 6 J/token claim until measured; re-file H7 as "measure the sustained curve and the
energy curve", not as a tok/s lever.

---

# Part C — Attack the received wisdom

## C.1 Seven claims asserted rather than measured in this setting

For each: the claim, the actual evidence, the hardware it was obtained on, and what it takes to
check it here.

**1. "fio 413 MiB/s is the storage ceiling; we are at it."** Evidence: fio qd1 median on a
2 GB file in Termux home [M]. Obtained on: *this* device — but at qd1, 1 MiB granularity,
DirectIO-ish fio pattern. The app reads 264–392 KiB through the page cache with QD≈4 — a
different operating point (A.1). Check: /proc/pid/io read_bytes window + competing fio (both
rounds agree; nobody ran it).

**2. "LRU expert caching should hit 80–90% at ~2× working set / 21% coverage."** Evidence:
offline, future-aware window analyses on Mixtral/Qwen3-class [arXiv:2505.16056](https://arxiv.org/abs/2505.16056);
"2× active experts ≈ optimal" is a *simulation* result. Hardware: servers/desktops. Our device
says 70.9% byte-hit. Check: route traces + replay (F7.2) — planned, not done.

**3. "Compute (0.116 s/tok) is not the problem."** Evidence: it is 1.7× cheaper than the I/O
term *in the current configuration* [M,D]. It is true today and false at the first successful
I/O reduction: the ridge is 32 GFLOPS / 730 MiB/s / 82% byte-hit (A.2), and 54 GFLOPS is 5–10%
of the silicon. Check: profile the 0.116 s (dispatch vs dot-product) — nobody has, in the valid
regime. The received-wisdom version — "compute work is wasted work" — licenses ignoring the
cheapest durable lever (better kernels, Q4_0-class paths on resident tensors) that *sets the
floor every other lever collides with at 7.8 tok/s*.

**4. "Quality is usable; ~2 malformed words/1k."** Evidence: 5 human-read prompts, one session
[M, F4.5]. Weak by BRIEF's own admission (§5.4). The decisions this instrument is asked to
license (H1 prune 50%, H5 cold at IQ1, H6 dual-precision) are all sub-5%-degradation decisions —
precisely what 5 prompts cannot resolve. Check: llama.cpp perplexity on an Italian corpus
(PLAN Registro already names this the "prerequisito non negoziabile" — it is still not built).

**5. "Speculative decoding / MTP won't pay (0/19 on RTX3090)."** Evidence: one independent
anecdote on an Ampere GPU for this model; llama.cpp's +2× on DGX. Hardware: GPUs, both. On a
CPU+flash device, MTP's mechanism (amortize bytes over N tokens per forward pass) targets *the*
constraint (bytes/token), not compute. The "0/19" is cited as a reason to downgrade; it is
evidence about GPU decode only. Check: F6 as planned (it's in the roadmap — the received wisdom
is why it keeps getting deprioritized in the Registro).

**6. "Expert packing approaches the 1.6 GB/s sequential class."** Evidence: AndroBench seq
read ~1.686 GB/s on the retail device [V, PLAN §3.2]. That number is bulk sequential on a
different path; our spans would be 1–4 MB with a 264–544 KiB read history; fio's own curve
(256k=214, 1M=413) implies 2–4 MB lands ~600–900 MiB/s, and that curve itself is qd1. Check:
fio at 2M/4M/8M qd1-4 — a 10-minute measurement that should precede any packing design.

**7. "Hit-rate is content-dependent, Italian > English, real traffic is better than the
benchmark."** Evidence: 6 prompts, one session, one metric of unresolved definition (A.4.5)
[M, F4.5]. The ranking is probably right (code worst is mechanistically plausible); the *levels*
(71–77% vs 56.9%) inherit the metric ambiguity. Check: metric definition in source + traces on
product traffic.

## C.2 Two contrarian cases, argued seriously

**Contrarian case A — "The runtime is NOT at the ceiling; there is substantial headroom at the
current layout."** Argue it to win: the wall-clock 425 MiB/s exceeds the qd1 fio ceiling, which
is *impossible* if the counter measures disk bytes — therefore either the ceiling is pattern/QD-
dependent (the app's real ceiling is ~266–300 MiB/s for 264–392 KiB reads, i.e. *below* fio-1M)
or the counter is inflated by page-cache service (same conclusion: the disk is not at 413). Under
either branch, the honest statement "at the ceiling, 0% headroom" is false: the *pattern* ceiling
leaves 30–55% headroom over what the app currently extracts, movable by read fusion (D4) without
any clustering. What does not survive the contrarian case: the F4 report's "266 vs 413 ⇒ 35%
headroom ⇒ add workers" — the io-threads-5 cell kills the workers part directly [M], and 266 is
not a fair measurement of the 413-class pattern either. **Honest verdict: the contrarian case
does not fully win (the workers lever is genuinely dead), but it defeats the "settled" claim:
the ceiling is a pattern property, not a device law, and the headroom question reopens as a
*pattern* question — which is exactly D4's experiment.** Both rounds' strategic conclusions
survive; Round 0's specific "425 MiB/s at 413, done" does not.

**Contrarian case B — "The hit-rate gap is mostly content and working-set, not policy; H2's
expected value is near zero; budget and layout are the real levers."** Argue it to win: F4.5's
Italian traffic already hits 71–77% (the benchmark's 56.9% is a pathological floor); the
offline-SCH upper bound at 21% coverage is ~85–90% — so even a *perfect, future-aware* policy
buys ≤ 14 points on real traffic, and the churn analysis (55% of misses are re-reads) says a
meaningful share of the *current* miss stream is fixable by *budget* (D2: 2 GB → 2.5–2.8 GB,
deferred allocation) with zero policy complexity. If budget explains the churn, LRU is
approximately fine and W-TinyLFU is a rounding error. **Honest verdict: this case wins the
sequencing argument** — the offline bake-off should run in parallel with the 2500/2800 cache
cells, and D2's h(C) points must be measured before the policy result is interpreted — **but it
loses the "policy is worthless" extreme**: the re-read structure is *prima facie* policy-shaped
(LRU admits one-shot experts that immediately evict reusable ones; SpecMD's collision-miss
mechanism is exactly this), so policy *and* budget are both live, and the bake-off is the
cheapest way to split them. The lesson is not "H2 or D2" — it is "measure both, they are
confounded, and the h(C) curve is the missing covariate".

## C.3 Where the project's own framing constrains the answer

The frame — "stream experts from flash into a DRAM cache" — presumes the object to be optimized
is the *weight transport*. A researcher who had never heard of expert caching, handed our
measured numbers, would ask different questions first:

1. **"Why does loading take 19 s for 1.75 GiB of resident weights?"** The dense+shared trunk is
   ~1.75 GiB (11.52 − 9.77 expert pool). At the sequential-class bandwidth that's ~3–4 s, not
   19 s. The measured 19 s implies the loader touches ~11.5 GiB — i.e. it is reading expert
   tensors it will never keep. If true, TTFT — the product's #1 problem — has a software fix
   (~27.5 s → ~15–16 s) that no streaming/caching hypothesis in either round addresses. The
   frame made this invisible because "load time" is not part of the streaming question.
2. **"Why is prefill 10 s for a short prompt?"** Prefill is cold-cache decode with no overlap
   opportunities; it has never been decomposed. The frame's decode-centrism hides it; the
   product constraint ("TTFT matters", BRIEF §6) says it should be a first-class axis.
3. **"What is the read-to-use ratio?"** We read 84.73 MiB/tok to *use* ~0.94 GB of active
   weights — a ~9% yield per token, i.e. we re-read the same 10k experts at 425 MiB/s. A
   statistician's first question is the *rank-frequency distribution* of expert use and the
   *h(C) curve* (BRIEF §5.1: one point on it exists). The cache frame answers "policy", but the
   question "how much of the pool is ever touched in a conversation?" (the Zipf exponent, the
   long-tail mass) determines whether H1/H2/D2 are even in the right family.
4. **"Why is the router allowed to pick cold experts at all?"** The frame takes routing as
   fixed and optimizes the transport. The behavioral degree of freedom — selection itself (D1) —
   is invisible inside the frame, yet it is the only lever that can push byte traffic toward
   zero *by construction* rather than by statistics.
5. **"What does the memory profile look like across load → prefill → decode?"** The cache-3000
   death happened *during load* (create_tensor), not in steady state — a load-peak allocation
   problem (D2). The frame's "cache budget" language assumes the budget is a steady-state
   quantity; it is partly a load-time quantity, and the distinction has never been measured.

---

# Part D — New hypotheses (different in kind from Round 0)

## D1 — Residency-biased expert selection (δ-gated routing-to-cache)   [axis: e, different computation]   [novel: partial]

**Mechanism.** Leave the router's scores alone; change the *selection*. For each layer and token,
take the top-16 scored experts; choose the 8 that maximize score + λ·residency, subject to a
δ-gate: never swap out a true top-8 expert for a lower-scored resident one unless the score gap
is below δ (the router's top-k distribution is usually flat at the margin — Mixtral's own
locality data and the 30% same-expert probability [arXiv:2401.04088](https://arxiv.org/abs/2401.04088)
show the 8th-vs-16th mass is small). This converts cache misses into *non-selections*: bytes
stop being demanded at all, instead of being cached better. It is the inverse of every caching
hypothesis — instead of making the cache fit the routing, make the routing fit the cache. It is
lossy *by construction*, with the loss bounded by the δ-gate and measurable (router-weight
deltas, PPL).

**Model.** Per layer: selection cost C(λ,δ) = Σ_{i∈S}(s_i + λ·r_i) vs true top-8 score. Traffic:
T' = B_naive × P_layer(miss), P_layer(miss) = P(fewer than 8 resident among top-16, after the
δ-gate refuses swaps). IID bound: with per-load residency p = 0.719, P(Bin(16, p) < 8) ≈ 1.3%
(normal approx, continuity-corrected) ⇒ T' ≈ 4–8 MiB/tok ⇒ decode → 1/(0.012+0.116) = **7.8
tok/s, compute-bound, at zero bandwidth work**. Reality is worse (residency is correlated with
score — hot experts are resident — but so is the *quality* cost of swapping them; and topic-shift
tokens have cold top-8s that no selection can dodge): realistic T' ∈ [20, 60] MiB/tok ⇒ **5.7–
7.2 tok/s**. Quality: bounded by δ; expected ΔPPL small but unknown — the measurement IS the
gate.

**Prediction.** Decode 5.7–7.2 tok/s (byte-hit +8 to +20 points); TTFT unchanged; RSS unchanged
(+zero); energy slightly *up* per token if quality forces more swaps — [speculation]. Quality:
ΔPPL < 3% at λ,δ giving ≥ +8 byte points, else the gate is mis-set.

**Assumptions.** (1) Router top-k scores are flat enough at the 8/16 boundary that δ-gated swaps
are frequent *and* cheap. If the 9th–16th experts are consistently far below the 8th (steep
scores), the gate never fires and D1 dies — this is the falsification. (2) Residency correlates
with future utility (true by construction — LRU residency *is* recency). (3) The fork exposes the
selection point (it does: the router hook that already produces route traces). (4) Quality loss
is measurable — requires the Italian PPL gate (shared dependency with H1/H5/H6; unavoidable).

**Falsification.** Cheapest in the round, and offline: replay route traces; recompute selection
with (λ, δ); measure (a) achieved byte-hit at the *same* 2000 MB cache, (b) Σ dropped router
weight per token, (c) PPL delta on an Italian eval set. Kill if (a) < +8 points at (b) ≤ 2% of
routing mass. Expected under D1: hit climbs; under negation: the router's 8/16 gap is steep and
the gate never fires (selection ≈ top-8, hit unchanged). Runs tomorrow on a PC; no phone.

**Cost.** Low (analysis) → medium (fork patch in the selection path, ~50 lines). Breaks: the
quality contract — must be versioned and gated; deterministic given λ,δ (good for CSV).

**Prior art.** AdapMoE (adaptive-k *skipping*, [arXiv:2408.10284](https://arxiv.org/abs/2408.10284)),
Expert Choice (capacity-based selection, training-side), EdgeMoE (static hot/cold splits,
[arXiv:2308.14352](https://arxiv.org/abs/2308.14352)); server-side cache-aware scheduling
(SmartMoE/SeMoE class) — none of them is *online residency-biased selection under a quantized
flash-miss cost on a phone*, with the quality loss bounded by a score-gate. The combination is
not in my sweep or in Round 0's. **[novel: partial]** — flag for Round 2 to falsify the
"partial".

## D2 — Deferred expert-cache allocation: the load peak, not the steady state, is the RAM wall   [axis: f, cross-layer/system]   [novel: no as engineering — yes as deployment insight]

**Mechanism.** The cache-3000 run died *mid-load* (create_tensor, ~blk.38) [M, F4.4] while the
cache-2000 steady state sits at 4.6 GB RSS against a ~5.6 GB lmkd line. If the fork
pre-allocates `cache_mb` at load, the load peak = dense (1.75) + C + buffers (≈0.6) + runtime
(≈0.3) — at C = 3000 that is ≈5.7 GiB, over the line ✓; at C = 2000 ≈4.7, matching the observed
4.6 ✓. Deferring allocation to first-miss (the cache fills in ~15 tokens of misses ≈ 3 s, after
the load peak has passed) removes C from the *load* peak entirely: load peak ≈ 2.65 GiB,
steady-state peak = 2.65 + C. Then C = 2500 → 5.15 GiB and C = 2800 → 5.45 GiB both fit
([speculation] on exact buffer sizes — the RSS traces exist in the harness).

**Model.** h(C) is unknown (BRIEF §5.1: one point). The churn data bounds its slope: 55% of
misses are re-reads — the re-read mass (≈68 MiB/tok) is the pool that a bigger cache should
absorb. Linear bound: doubling the *marginal* coverage (21% → 27–30%) plausibly recovers
3–7 of the ~38 byte-points currently lost to churn [speculation]. T' = 88.8×(1 − Δh/0.291):
Δh = +5 → 73.5 MB → **5.4 tok/s**; Δh = +9 → 61.3 MB → **5.9 tok/s** (at 425 MiB/s). The
measurement IS the hypothesis: h(2000), h(2500), h(2800) is the h(C) curve the whole roundtable
has been groping for.

**Prediction.** Decode 5.3–6.0 tok/s; re-read share 55% → 30–40%; TTFT unchanged; RSS ≤ 5.5 GiB
(thin margin at 2800 — gate on measured peak, not on the estimate); energy slightly down with
traffic.

**Assumptions.** (1) The fork pre-allocates at load — checkable in source in an hour; if it
allocates lazily already, D2 collapses to "just run cache-2500" (which should be done *anyway* —
the cell was never taken in the valid regime [M, F4.4 "non ripresa"]). (2) lmkd's line is ~5.6
as measured [M]. (3) The re-read mass is budget-elastic, not content-pinned — partially
contradicted by F4.5's content dependence; the 2500/2800 cells resolve it.

**Falsification.** Cheapest phone experiment in the round: RSS trace through load→prefill→decode
at cache 2000 (baseline), then 2500 and 2800 with deferred allocation. Kill D2 if h(2500) −
h(2000) < 2 points (working set ≫ budget; only pool/pruning moves it). This is also the
"cache-3000 in valid regime" cell both rounds already listed as ~16 minutes — D2 adds the
deferred-allocation twist that makes it survivable.

**Cost.** Low: a load-path patch + 3 cells. Breaks: nothing (reversible; versioned).

**Prior art.** Lazy allocation is textbook; applied to *MoE streaming caches under an lmkd
ceiling* — not found in the sweep. The insight (the binding constraint is the load peak, not
steady state) is stated in no paper the rounds read; the F4.4 log is the evidence. **[novel: the
insight, yes; the mechanism, no]**

## D3 — Session-persistent hot-expert preload   [axis: f/d hybrid]   [novel: yes]

**Mechanism.** Every conversation starts cold: the first ~10–20 tokens pay the full miss stream
and prefill runs at cold-cache speed (10 s [M]). Persist per-expert hit counts across sessions
(a few KB file); at load, stream the top-400 most-frequent experts (~377 MB) into the cache
*while* the dense trunk loads (~1–2 s of extra I/O on a 19 s load). Prefill then runs warm:
prefill hit-rate rises from ~0 to the hot-set level; first-token latency and the first ~20
tokens of decode improve. This is a *memory across sessions* lever — orthogonal to every
cache-policy and layout hypothesis.

**Model.** Let m = mass of the first-token miss stream covered by the persistent hot-400
(Zipfian assumption). Prefill time ≈ T_prefill × (1 − m×h_warm) [speculation, m ∈ 0.25–0.5].
TTFT = load + prefill: 19 + 10 → 19 + 6.5–8 ⇒ **−2 to −4 s**; decode of the first ~20 tokens
+0.5–1.5 tok/s. Cost: +1–2 s of load I/O, ~400 KB of disk for the hot list.

**Prediction.** TTFT 27.5 → 23–25 s; cold-start decode 5.0 → 5.5–6.5; sustained unchanged; RSS
unchanged; energy slightly up during load (I/O), down during prefill.

**Assumptions.** (1) Cross-session expert heat is stable (the product is Italian chat — same
user, same domain; the 71–77% Italian locality supports stability). (2) The top-400 covers
≥25% of the cold-start miss mass — falsifiable from the first route trace, no phone work. (3)
The load I/O can absorb +377 MB without stretching the 19 s (at 266–450 MiB/s it adds 0.8–1.4 s
— acceptable). (4) Prefill actually benefits — prefill hit-rate has never been measured
separately from decode [M, BRIEF §5.5].

**Falsification.** (Offline) from the existing route traces, compute the cold-start miss
distribution and the top-400 coverage; kill if < 25%. (Phone) A/B with the preload flag, TTFT
and first-20-token speed. Expected under D3: TTFT −2 s+; under negation: the hot list is
session-specific and coverage is < 25%.

**Cost.** Low: counter persistence + loader hook. Breaks: nothing (a preload, not a replacement).

**Prior art.** MoE-Infinity ([arXiv:2401.14361](https://arxiv.org/abs/2401.14361)) traces
within a session; OS page caches persist across runs; **cross-session expert heat on an
on-device quantized stream — not found in either round's sweep**. **[novel: yes]**

## D4 — Intra-expert read fusion (three slices → one blob)   [axis: c, effective bandwidth]   [novel: no — but the *diagnosis* is the contribution]

**Mechanism.** One expert is three non-contiguous tensor slices (264/264/392 KiB) [V, F0.6].
Rewrite the GGUF so each expert is one contiguous 0.942 MB blob (and, if cheap, order experts by
layer and index contiguously). The loader then issues one ~0.9 MiB read per expert instead of
three 264–544 KiB reads. Per A.1, the device's 256k-class rate (~214 MiB/s qd1) is the pattern's
binding constraint; the 1 MiB class is 413 — a ~1.6–1.9× pattern gain with **zero changes to
caching, routing, or quality**. This is the first 20% of Round 0's H3, but it is different in
kind: H3 clusters *different* experts using traces; D4 fuses *within* an expert and needs no
traces, no co-activation analysis, and works for every workload.

**Model.** B_eff: 266 → 380–450 MiB/s (fio 1M class, QD4, [speculation] on the QD4 point — the
413 is qd1). t_io = 84.73/B_eff: 0.319 → 0.188–0.223 (as disk-service time) or, in the
overlap-steady-state view, t_io_wall 0.189 → ~0.13–0.17. Decode = 0.012 + max(0.116, t_io):
**5.4–6.9 tok/s** under my reading (pattern-limited), **5.0–5.4 tok/s** under Round 0's reading
(wall already at 425; fusion only helps the re-read share). **The experiment discriminates the
two bandwidth readings — that is a second reason to run it.**

**Prediction.** Decode 5.4–6.5 tok/s (wide range by design — see model); TTFT: −2 to −4 s if the
load path also uses fused reads (load traffic is mostly sequential anyway — small win); RSS
unchanged; energy down with time.

**Assumptions.** (1) The loader currently issues per-slice reads — checkable in source; if it
already coalesces (unlikely: the tensors are physically separated by shexp/router metadata),
D4 is free and already done. (2) UFS rewards the size jump at QD4 as at qd1 — the fio 2M/4M
cells (Part C, claim 6) are the 10-minute check. (3) Repacking doesn't disturb the cache-key
scheme (it shouldn't — keys are (layer, expert)). (4) Fused blob alignment: 0.942 MB is not
4K-aligned by construction — the rewriter must pad to the fs block class to avoid
page-split reads [speculation, minor].

**Falsification.** Microbenchmark: read 64 experts from the packed vs unpacked file with the
fork's I/O path; kill D4 if wall MiB/s < 1.25×. Expected under D4: ~1.5–1.9×; under negation:
the device is already at its 1 MiB-class ceiling for this pattern (i.e. Round 0's reading was
right and the 266 is pure accounting).

**Cost.** Medium: GGUF rewriter + loader change; versioned files; no traces, no phone runs
until the microbench. Breaks: stock-GGUF compatibility (same caveat as H3, smaller).

**Prior art.** F0.6 documented the non-contiguity; `kimi-k3-in-c` documents O_DIRECT batch
prefetch on NVMe (Linux x86, [PLAN §3.3](https://github.com/FareedKhan-dev) as cited); no
published phone-UFS expert-fused GGUF found. **[novel: no]** — but it is the cheapest test of
the two competing bandwidth readings, which makes it strategically first.

---

# Part E — Questions for Round 2

1. **The re-read storm.** From your own F4.2 log: 4,848 re-reads / 64 tokens = 75.8/token, i.e.
   ~55% of all misses are re-loads of experts LRU evicted earlier in the same run. What fraction
   of the 84.73 MiB/tok do you estimate is this self-inflicted churn, and does it change your
   H2-vs-H3 ranking? (The answer determines whether the first move is a policy bake-off or the
   cache-2500/2800 cells — they are confounded, and you ranked the policy above the cells.)

2. **The metric that cannot be reconciled.** From one log line: hit 56.9% and 84.73 MiB/tok. The
   byte-consistent per-load hit is 0.719; no simple counting model (per-load, per-slice,
   per-layer-batch) reproduces 56.9% jointly with 84.73. What exactly does `cache_hit_pct`
   count in bmoe-cli — and does the F4.5 content-dependence result (71–77%) inherit the same
   definition? Resolve in source before the "hit-rate is content-dependent" claim is used again.

3. **The read granularity.** Are expert reads issued per-slice (264/392 KiB — forced by the
   F0.6 layout) or per-expert (0.942 MB)? The runtime's 266 MiB/s sits exactly between fio-256k
   (214) and fio-1M (413): if per-slice, your "no headroom" verdict is a pattern property, not a
   device law, and a one-day GGUF fusion (D4) is worth 1.4–2× on the slow branch. Check the
   source and answer with the read-call sizes.

4. **The load peak.** cache-3000 died during create_tensor (load), while cache-2000 steady state
   is 4.6 GB RSS against ~5.6 GB lmkd. Does the fork pre-allocate `cache_mb` at load? If yes,
   why is cache-2500/2800 with deferred allocation — possibly the cheapest 0.5–1 tok/s in the
   project — not in your sequence? And separately: the load takes 19 s for ~1.75 GiB of resident
   weights — does the loader touch the expert tensors during load, and if so why is that 15 s
   of TTFT not treated as a bug?

5. **The quality gate for the lossy track.** F4.5 (5 prompts, one session, weak instrument) is
   being asked to license H1 (irreversible pruning), H5 (IQ1 cold experts), H6 (dual-precision
   RAM) and my D1. Propose the concrete instrument — corpus, tool (llama.cpp perplexity), ΔPPL
   threshold vs the UD-IQ2_M baseline, and sample size — and commit to running it *before*
   ranking any lossy lever. If you refuse the gate, say what substitutes for it; "human reading"
   is not one.

---

*Conventions: [M] measured (BRIEF/runs.csv), [D] derived here or re-checked, [V] verified online
(as marked in PLAN/F0.6), [speculation] unmeasured inference. Verified via web during this round:
HOBBIT 9.93× Jetson claim, 2505.16056 SRP/SCH, SpecMD Least-Stale 85×, Fate cross-layer gate —
URLs inline.*
