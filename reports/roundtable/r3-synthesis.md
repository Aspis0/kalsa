# ROUND 3 — Closing synthesis

**Role:** second speaker, closing round. I opened the attack in Round 1; Round 2 conceded, defended,
and counter-attacked; the arbiter injected source-verified facts between rounds. I did what the
arbiter's N4b directive demanded: I read the runtime's source
(`BigMoeOnEdge/core/src/moe/expert_stream_source.cpp`, `core/src/io/file_reader.cpp`,
`core/src/engine/session.cpp`, `cli/main.cpp`) and closed the counter loop. The result changes
several verdicts — including one of my own Round 1 claims. Arithmetic shown throughout.

**What the source audit established first (outranks everything said before it):**

- **S1 — The N4b loop closes exactly; no counter is broken.** `moe_read_mib` is a **decode-only**
  delta: `GenTally` cursors are taken *after prefill* with the comment *"the summary reports the
  generation phase only … (prefill routes near the whole bank)"* (session.cpp:1117-1127). But
  `cache_hit_pct`, `evictions`, `re-reads` are **absolute cumulative counters** (session.cpp:1443-1446;
  main.cpp:857-858 divides them by n_generated = 64). The arbiter's 1.83× gap is the prefill window:
  decode misses = 5422.72 MiB / 0.8984 MiB = **6036**; absolute insertions = 8843 evictions + 2226
  resident = **11069** ⇒ prefill insertions = 5033 ⇒ prefill reads ≈ **4521 MiB ≈ 450 MiB/s over the
  measured ~10 s prefill**. Prefill is the missing term. (See A.4 for the full closure.)
- **S2 — O_DIRECT is default but *per-file verified* and fallible** (file_reader.cpp:31-33,
  94-122): open-time aligned-block compare vs buffered; on mismatch the file silently drops to
  buffered I/O. The init line `bmoe: expert streaming ON … o_direct=%d` (expert_stream_source.cpp:346)
  **is not quoted anywhere in the archive** — the mode that actually ran in the gate cells is
  unverified, and F4's own recommendation list says "DirectIO | non misurato top-app". So Round 2's
  O_DIRECT counter-attack lands *as a mechanism* but the *fact* is still open, and it is a one-line
  log check.
- **S3 — eviction/re-read semantics confirmed**: `evict_tail()` increments once per whole
  (layer, expert) entry (line 730); `rereads_` on misses of ever-evicted entries (line 911); decode
  reads are exactly 6036 misses × 0.8984 MiB — no partial-projection accounting in the gate config.
- **S4 — the fio qd4 cells are untrustworthy**: raw `results/fio_runs.csv` shows 256k-qd4 =
  88.7 / 86.8 / **191.0** MiB/s (bimodal) measured **2026-08-04, before the top-app discovery** —
  the same 3-core cpuset confound that invalidated a full day of measurements later. The trustworthy
  cells are the qd1 ones (256k = 214, 1M = 413). Another instance of the project's recurring pattern:
  a derived quantity inheriting a bad input — this time at the *measurement* layer, not analysis.
- **S5 — the twin PLAN log lines are genuine determinism, not transcription error.** `--temp 0`,
  same prompt, same budget ⇒ identical access sequence ⇒ byte- and counter-identical runs; the two
  quoted lines indeed differ in exactly the timing fields (decode 1.070 vs 0.201 s/tok). Useful
  fact in itself: **cache behaviour is bit-reproducible across runs, so any A/B on it is clean.**

---

# Part A — Concessions, defences, mutations

## A.1 Concessions accepted (no re-litigation)

Round 2 conceded, and I accept: H4 decode-prefetch is dead (its β model treated the 0.073 s exposed
stall as schedulable slack; on a rate-bound path it is the rate deficit — R1 Eqs. 2-3); H5's ρ-table
and H1's gain table were wrong; the sequencing error (offline policy ranked above the cache-2500
cell); the hit-meter levels are not safe (ordinal only); "no headroom at current layout" was
overstated; D4 was under-ranked in R0. Settled.

## A.2 Defence check — did it name a real error, or re-assert?

| Defence | Verdict |
|---|---|
| **H2 (policy) as diagnostic + live lever** | **Mixed.** The EV-magnitude concession is real and the "diagnostic" framing was already my R1 verdict — so no new error in my objection was named there. But the *ranking* defence ("re-read ≈80% of traffic ⇒ policy-or-budget first") rested on the churn figure that N4b exposed. My closure (A.4) shows the **direction** survives at 55–80% of decode misses, so the ranking stands — but its evidence was partly wrong, and a defence that survives on corrected evidence is weaker than one that survives on its original evidence. H2 stays alive *as joint-first diagnostic with the h(C) cells*, not above them. |
| **O_DIRECT default weakens R1's page-cache story** | **Real error in my R1, lands.** I reconciled 425-vs-413 via page-cache service without checking the documented read path. With O_DIRECT active, buffered page-cache service of re-reads is impossible and my "30–40% of counted bytes never touch flash" collapses. **Conceded** — with S2's caveat: the *active* mode in the gate runs is unverified, so the question is not closed, it is *reposed* as a log check. |
| **`t_flash_io` is not exclusive wall time** | Correct — it was my own argument; R2 defended my point. No dispute. |
| **266 MiB/s "may be thread-rate AND land near the pattern-limited disk class"** | Convergence, not defence: this is R1's position (thread-accounted *and* pattern-consistent). Accepted as agreed. |
| **More I/O workers dead** | Agreed by both; the io-threads-5 cell settles it. |

## A.3 Mutations attacked once each

**Mutated H1** (REAP, ranked only after PPL gate + re-read measurement; prediction 5.3–6.0 tok/s
decode, TTFT −25–45%). The mutation is honest and its decode claim is now calibrated (65.6 MB/tok
at p=0.5 ⇒ ~5.9 tok/s, not 6.5–7.5). But it has **two pillars that are substitutes, not
complements**: the TTFT pillar (−25–45% load from a smaller file) exists only if the load path
actually reads expert bodies — which is exactly what E1 attacks. If E1 lands (load ≈ 2 GiB instead
of ~11.5), file size stops mattering for load time (metadata + dense only) and **H1's TTFT pillar
collapses**. Mutated H1 is then a residual-miss lever only (+0.3–1.0 tok/s), and its compulsory-miss
premise remains in direct tension with the churn analysis. Verdict: **mutated H1 is smaller than it
claims and its two pillars must not both be counted; keep it lossy-last, after E1's verdict.**

**Mutated H2** (offline bake-off + h(C) cells as a joint first experiment). Acceptable — and my
closure strengthens it: decode-only hit is 70.5% (A.4), so the bake-off target is well-defined.
One required fix: the bake-off must replay traces with a **self-defined meter** (it does — it's a
simulation — but the calibration requirement "reproduce the runtime's hit within ±2 points"
(F7.2 in PLAN) is now *miscalibrated against a mixed-window counter*; calibrate against the
decode-only window instead).

**Mutated H3** (D4 first; γ_eff = γ_raw/(1+waste)). Arithmetic check: at γ_raw ∈ [1.2, 2.2] and
waste ∈ [0.2, 0.5], γ_eff ∈ **[0.80, 1.83]** — at the high-waste end, cross-expert packing is *net
negative*. The mutation must gate on a measured waste fraction before committing, and the fio 2M/4M
cells (never measured) set the γ_raw prior. Also, N3's source-verified design (expert-major repack
+ preadv) makes D4 the substrate H3 builds on — so mutated H3 is correctly a *later* step, not a
competitor. Fine as mutated.

**H4 residue** (prefill prefetch + admission): alive, TTFT-oriented, low priority — agreed.
**H5 promotion ladder**: PPL-gated, ranked last — agreed; Eq. 4 bound (78.5 MB/tok, ~5.3 tok/s)
unchanged. **H6**: the 1-hour LZ4 kill-switch is right; dual-bit only after max-C + PPL — agreed.
**H7**: instrumentation-only — agreed; the die-gated cooldown is a protocol fix, not a hypothesis.

**R2's E1/E2/E3** checked: E1 (load without experts) is now source-consistent (see B.2: it explains
both the 19 s load *and* the cache-3000 death at create_tensor). E2 is quantified by my closure —
prefill reads ~4.5 GiB at ~3.2% hit, the single largest I/O event in the run (B.4). E3 is correct
and my counter-window fix (A.4.2) is its enabling patch. All three survive; E1 becomes the
highest-value software fix in the whole exchange.

## A.4 The N4b close — the arbiter's three questions

### A.4.1 Which counter is wrong? Neither — the reporting mixes windows.

From the source (S1): `moe_read_mib` is decode-only; `evictions`, `rereads`, `cache_hit_pct` are
absolute (prefill + decode). The arbiter's loop mixed the two. Closing it, with all numbers [M,D]:

```
decode reads      = 84.73 MiB/tok × 64 = 5422.72 MiB            [M]
decode misses     = 5422.72 / 0.8984   = 6036                    [D]
decode lookups    = 64 × 8 × 40        = 20480                   [D]
decode hit        = (20480 − 6036)/20480 = 70.5%                 [D]  ← decode-only
insertions(total) = evictions + resident = 8843 + 2226 = 11069   [M,D]
prefill insertions = 11069 − 6036      = 5033                    [D]
prefill reads     = 5033 × 0.8984      = 4521 MiB                [D]
prefill rate      = 4521 / ~10 s       ≈ 450 MiB/s               [D]  ← matches prefill duration [M]
reported hit 56.9% = (14444 + (L_p−5033))/(20480 + L_p) ⇒ L_p ≈ 5202, prefill hit ≈ 3.2%   [D]
prefill evictions  = 5033 − 2226       = 2807  ⇒  decode evictions = 8843 − 2807 = 6036 = decode misses ✓
```

Every row is internally consistent, including the exact match decode-evictions = decode-misses
(each decode miss eventually evicts; the last 2226 stay resident). **The 1.83× "unaccounted" is
prefill traffic** — 4521 MiB at ~450 MiB/s, exactly the measured ~10 s prefill. Neither counter is
broken; the summary printouts compare a decode-only numerator with a prefill+decode denominator.
This also resolves R1's Q2 inconsistency completely: **the 56.9% was never the decode hit rate;
the decode-only hit rate is 70.5%, matching BRIEF's 70.9% byte-hit within rounding.** The meter is
cumulative; the byte counter is a window. Both were right, both were misread.

The provenance warning (N4b) closes the same way: the identical counter values in the two PLAN
lines are expected under `--temp 0` determinism (S5) — a useful property, not a transcription.

### A.4.2 The one-line instrumentation

The byte counter already gets the treatment the others lack. Add the same cursor pattern to
`GenTally::record` (session.cpp:127-185):

```c
m.evicts    = st->evictions  - prev_evicts;    prev_evicts   = st->evictions;
m.rereads   = st->rereads    - prev_rereads;   prev_rereads  = st->rereads;
m.lookups   = st->cache_lookups - prev_lookups; prev_lookups = st->cache_lookups;
m.hits      = st->cache_hits   - prev_hits;    prev_hits     = st->cache_hits;
```

plus a prefill-window printout from the existing `st0` snapshot (taken after prefill — the prefill
window is `st0` itself). ~6 lines. Every future "per token" cache figure then means what it says.
The churn KPI (E3) is `rereads_delta × 0.8984 / read_bytes_delta`.

### A.4.3 Churn share both ways — does the H2-vs-D4 ranking flip?

- **As printed (mixed window):** 4848/64 = 75.8 "re-reads/tok" × 0.8984 = 68.1 MiB/tok = **80%** of
  84.73 — upper bound, inflated by the denominator being decode-only while the numerator includes
  prefill re-reads.
- **Corrected (decode-only):** decode misses = 6036; decode re-reads = 4848 − prefill_rereads.
  Prefill re-reads ≤ prefill evictions = 2807, realistically a few hundred (prefill demand is
  mostly unique; hit ≈ 3.2%). So decode churn share ∈ **[34%, 80%]**, realistically **~55–75%** —
  the printed 80% is the top of the range, not the value.
- **Ranking test:** under BOTH derivations churn is the dominant decode miss class (≥55% in the
  realistic middle; ≥34% even in the most conservative bound, vs ~20% first-touch compulsory in
  R2's table — and the boundary only matters if the two classes' levers were exclusive, which they
  are not). Policy/budget (H2, D2/h(C), D1) attack the miss *count*; D4 attacks miss *cost*
  (size/B_eff); they compose multiplicatively in t_io = (1−h)·B_naive/B_eff. **The ranking does not
  flip between the two derivations.** Verdict: N4b is a bookkeeping/reporting bug, not a
  decision-relevant one — fix the reporting (A.4.2), keep the plan. The third instance of the
  pattern N5 names, and the cheapest to fix of the three.

### A.4.4 Bonus findings of the closure

1. **Decode-only hit = 70.5%** — every F4.5 content-dependence *level* (71–77%) is a cumulative
   number diluted by a cold prefill; the *ranking* across prompts survives, the levels do not.
2. **Prefill reads ≈ 4.5 GiB at ~3.2% hit** — the single largest I/O event in the run, bigger than
   the 64-token decode's 5.4 GiB (for a ~16-token prompt), previously invisible because the
   counters mixed windows. Prefill is a cold-fill, and every decode hit claim inherits a cache
   filled by it. This reframes E2 and D3 (B.4).
3. **The load peak is explained without cache pre-allocation**: `vm_reserve`/lazy `vm_commit`
   (expert_stream_source.cpp:157-166, 897-907) means the cache adds no load-time RSS — so the
   cache-3000 death at create_tensor and the 19 s load are consistent with **mmap'd file pages
   faulting into RSS during load** (E1's premise), not with D2's mechanism. See B.2.

## A.5 Concessions on my own D-hypotheses, in plain language

- **D2 (deferred cache allocation): the mechanism was wrong.** The source shows `vm_reserve`
  (address-only) at init and commit-on-miss; the cache was never pre-committed at load, and the
  load peak is explained by mmap file-page faults instead. I concede the mechanism fully. What
  survives is the measurement programme (h(C) at 2500/2800 + the RSS timeline), which is now the
  shared position of both rounds and the arbiter.
- **D1 (residency-biased selection): the 7.8 tok/s headline was a rhetorical bound, and R2 is
  right that the δ-gate fires where quality harm concentrates.** I concede the headline. The
  remaining claim is narrow and offline: measure the rank-8-vs-rank-16 score gap on traces; if the
  gap is steep, D1 dies cleanly. That experiment costs an afternoon and stays in the plan.
- **D3 (session-persistent hot preload): the model was hand-wavy.** The closure upgrades it: the
  target is now measured — prefill runs at ~3.2% hit and moves ~4.5 GiB; warming even 400 experts
  before prefill attacks the largest single I/O event in the run, not a nicety. Still needs the
  top-400-coverage check from traces.
- **D4 (intra-expert read fusion): N2 proves my alignment assumption false in our favour (the
  layout is exactly 4 KiB-aligned by construction), and N3 gives the design — but the O_DIRECT-425
  reading shrinks my bandwidth claim.** If the device already delivers ~1M-class rates for the
  semi-clustered pattern (425 wall ≈ 413 fio-1M), fusion's gain is mostly per-miss latency (2
  saved seeks ≈ 0.3 ms × 94 misses/token ≈ 28 ms ≈ 14% of decode) plus syscall count — **+0.4–1.0
  tok/s, not the 1.6–1.9× I implied.** D4 survives as substrate + discriminator, demoted from
  headline.

---

# Part B — The collision harvest

## B.1 Compositions

**Super-additive:**

- **C1 — the TTFT stack: [E1 load-without-experts] + [D3 hot preload] + [D4 fusion] + [E2 prefill
  roofline] share one toolchain.** The expert-major repack (D4) and its offset table are the same
  infrastructure E1's expert-skipping loader and D3's preload hook need; the cost of all four is
  the cost of one GGUF-format change plus loader hooks. Effect: E1 removes ~10–14 s of load waste
  (19 s → 5–8 s); D3 raises prefill's 3.2% hit toward ~40–60% (4.5 GiB → 2–2.7 GiB, prefill 10 s →
  5–7 s); E2 instruments the rest. **TTFT 27.5 s → ~12–16 s**, with decode untouched. The first
  response to a user (27.5 s TTFT + 64 tokens ≈ 40 s) is ~60% TTFT — this stack attacks the larger
  half of the product experience, which the exchange has spent ~zero rounds on. `[emergent]` —
  composition; the parts are R1/R2's, the *stack* is not.

- **C2 — ridge-pairing: churn+bandwidth work saturates at 7.8 tok/s; only compute work moves the
  ceiling, and it must be paired with the I/O work, not deferred.** The roofline (R1 A.2):
  t = 0.012 + max(0.116, t_io). Churn work (H2/D2) + fusion (D4) drive t_io toward 0.116; the
  moment t_io ≤ 0.116, **every further byte- or bandwidth-euro returns zero** and the system is
  compute-bound at 7.8 tok/s. The compute work that lifts the ridge — profile the 0.116 s
  (dispatch vs GEMM), KleidiAI-class kernels on the 2048×512 expert GEMMs, mixed-residency quant
  (resident dense trunk at Q4_0, routed at 2 bpw — R0's B.4, resurrected) — has been killed by
  "compute is not the problem", which is *true only until the first I/O win*. Π = 54 GFLOPS is
  5–10% of 8 Gen 2's int8 class; even a 1.5–2× kernel win moves the ridge to 9–11 tok/s. The
  composition rule: **every I/O hypothesis must state which side of the ridge it targets, and the
  project must schedule compute work for the day the ridge is reached — not after.** `[emergent]`.

**Anti-additive (do NOT both, or do in the right order):**

- **E1 vs H1's TTFT pillar are substitutes** (A.3): if E1 lands, file size stops mattering for load
  and H1's −25–45% TTFT claim collapses. Budget the two as alternatives, not a sum.
- **H2 vs D1 overlap on the selection-avoidable misses** (D1 subsumes policy there); D1's residual
  (δ-gate-refused swaps) is policy's domain. Do H2 first (lossless, cheap), D1 after traces.
- **D4 vs H3 are not competitors — D4 is H3's substrate** (N3, source-verified). H3's γ_eff < 1
  risk (A.3) means H3 must not be scheduled until D4 + waste measurement exist.
- **H2 vs the h(C) cells are confounded** (both rounds agree): run them as one joint experiment
  (cache 2000/2500/2800 with per-window counters), not sequentially.

## B.2 Assumptions the exchange killed — and what each makes possible

| Assumption (held at start of R0) | Status at end of R2 | What is now possible |
|---|---|---|
| "The runtime is at the storage ceiling (413), 0% headroom" | **Killed** (pattern-relative; 266 is the 256k-class; 425 wall is either real 1M-class pattern service or buffered fallback — unverified) | Honest D4 valuation; the qd4-fio confound (S4) is visible instead of trusted |
| "56.9% is the hit rate" | **Killed** — decode-only hit is 70.5% (A.4) | F4.5 *levels* reinterpreted (ordinal only); the real meter is now defined; the h* = 0.82 crossover is measured against the right number |
| "The 19 s load is the price of an 11.5 GiB file" | **Killed** — resident trunk is ~1.75–2.5 GiB; 19 s ≈ whole-file read; a software bug, not physics | **E1**: TTFT −10–14 s without touching decode. This is the single most valuable kill of the exchange: an idea (fix the loader) that was invisible under the false assumption, and which makes H1's TTFT pillar redundant |
| "The cache budget is a steady-state quantity" | **Killed** — load-time RSS (mmap file faults) is the binding constraint (S1/A.4.4-3); cache-3000 died during create_tensor, not decode | The RSS-timeline measurement; the cache-2500/2800 cells become *safe* experiments instead of lmkd gambles |
| "Prefetch hides decode latency on this device" | **Killed** (rate-bound; R1 Eqs. 2–3; R2 conceded) | Effort redirected to admission (H2-class) and prefill, where latency hiding still exists |
| "h(C) ≈ 85–90% at 21% coverage (literature)" | **Killed** — measured 70.5% decode-only, content-dependent | The h(C) curve becomes a first-class measurement (D2 cells), not a calibration |
| "The re-read storm = 80% of traffic (R2)" | **Killed as a number** by N4b; survived as a direction at ~55–75% decode-only | The counter-window fix (A.4.2); every future churn number trustworthy; the ranking survived the correction |
| "O_DIRECT default ⇒ no page cache in play" | **Killed as a fact** — per-file verified fallback (S2), active mode unverified in the gate runs | One grep of the logs settles which bandwidth reading is true |

The most productive single kill: **"the load is the price of the file"**. Everything downstream of
it — H1's TTFT pillar, the cache-3000 "RAM wall" story, the frame's decode-centrism — was built on
it. The 19 s load was never measured against the resident-trunk size; one `read_bytes` sample
during load decides it.

## B.3 Reframings against BRIEF §5's open questions

The exchange spent ~90% of its words on decode throughput (BRIEF §2). BRIEF §5 lists seven open
questions; the harvest maps onto them:

- **TTFT (5.5 in BRIEF terms — the product's stated #1 obstacle):** E1 (−10–14 s), D3 (−2–4 s),
  E2 (−2–4 s) ⇒ 27.5 → ~12–16 s. H1's TTFT pillar only if E1 fails.
- **Sustained behaviour (5.3):** untouched by the whole exchange. The 4B control showed ~half
  burst sustained (8.90 → 4.68 [M, F2.4]); the die hits 47 °C inside a 13 s burst [M]; nothing has
  measured 5+ minutes in the valid top-app regime. H7's instrumentation is the only item aimed at
  it, and it is the *product* gate.
- **Energy (5.6):** one hypothesis in all three rounds (H7's j/token column). The Registro's
  6 J/token estimate fails a 30 W sanity check at 5.02 tok/s; ~1.5–2.5 J/token is more plausible
  [speculation]; nothing measures it.
- **Quality (5.4):** R2's committed PPL gate (≥500k Italian tokens, ΔPPL ≤ 0.05/0.15 tiers,
  bootstrap CI, morphology side-set) is the binding prerequisite for every lossy lever (H1, H5,
  H6, D1). Both rounds now agree; neither has built it.
- **h(C) (5.1):** the D2 cells at 2000/2500/2800 — the one-point curve becomes a curve.
- **Access distribution (5.2):** F7.1 traces — metrology, prerequisite for H2's bake-off, D1's
  score-gap, D3's top-400 coverage, H3's co-activation matrix.
- **Prefill (5.5):** E2 + the closure's quantification (4.5 GiB, ~3.2% hit).

## B.4 The unasked question

The frame — *stream experts from flash, cache them in RAM, make that loop faster* — makes three
things invisible, and all three are now measured rather than asserted:

1. **The load path.** 19 s to materialise ~1.75–2.5 GiB of resident weights is a software bug
   against the fork's own architecture (S1, B.2). The frame had no word for it because "loading"
   is not "streaming".
2. **Prefill.** The largest single I/O event in the benchmark run (4.5 GiB at 3.2% hit, vs 5.4 GiB
   of decode traffic) was invisible because the counters mixed windows. The cache is **filled by
   prefill**; every decode hit-rate claim inherits a cold fill; "the system's steady state" is a
   fiction over a 64-token window — the run is ~3/4 cold-event traffic (11.5 GiB load + 4.5 GiB
   prefill ≈ 16 GiB vs 5.4 GiB decode) under the E1-pessimistic assumption, ~45/55 even if the
   load is already lean.
3. **The meters.** This project has now made *four* decisions on derived quantities that inherited
   bad inputs: 343 MB (shared-expert double count), 74% (from 343), the 3-core tok/s day (cpuset),
   and the mixed-window cache counters. N5 names the pattern; the counters are the fourth instance,
   and the cheapest to fix.

**Answer in my own voice, given ONLY the measured numbers:** the highest-value thing to attack is
(1) the load path + prefill — the ~60% of first-response time that contains a software bug — and
(2) the counter windows, so the next decision is not the fifth victim of the pattern. The exchange
has been arguing about the other 40%, and about a ceiling (7.8 tok/s) that the TTFT stack
does not even need. The frame made the strongest move invisible; the collision — N4b's injection —
is what exposed it.

## B.5 The harvest — three emergent ideas

### C1 — The TTFT stack (E1+D3+E2+D4 as one programme) `[emergent: the composition, not the parts]`

**Mechanism.** One GGUF-format change (expert-major repack, exactly 4 KiB-aligned by construction —
N2) plus three loader/runtime hooks: (a) load materialises only dense + shared + embeddings, never
expert bodies (E1); (b) during load, preload the session-persistent hot-400 experts into the cache
(D3); (c) prefill runs with per-window counters and, if the cache is warm, hits the hot set instead
of cold-filling (E2). Memory layout, mul_mat_id, cache keying, quality: untouched (N3).

**Model.** Current: TTFT = load 19 s + prefill ~10 s = 27.5 s [M]. Load is ~11.5 GiB at ~600 MiB/s
sequential-class ⇒ lean load ≈ 2 GiB/600 ≈ 3.5 s, with fixed overheads ≈ 5–8 s. Prefill traffic at
hot-400 warm: 4.5 GiB × (1 − m·h_warm), m = hot-set coverage of prefill demand, h_warm ≈ 0.4–0.6:
→ 2–2.7 GiB ≈ 4.5–6 s. **TTFT' ∈ [12, 16] s.** Decode unchanged. RSS load peak down.

**Prediction.** TTFT 27.5 → 12–16 s (−40–55%); decode 5.02 tok/s unchanged; energy per first
response down (less flash); quality unchanged.

**Assumptions.** (1) Load currently faults expert bodies — 19 s ≈ whole-file read says yes, and
load-only `read_bytes` decides in one run. (2) Hot-400 covers ≥25% of prefill demand — falsifiable
from traces. (3) The fork's rebind survives a skipped-populate load (byte-identity gate after first
decode). (4) m ∈ [0.25, 0.5] — Zipfian prior, untested.

**Falsification.** Kill on any of: load-only read_bytes < 3 GiB (E1 already true — the stack
shrinks to D3+E2 only); top-400 coverage < 25% (D3 dies, stack shrinks); TTFT' > 20 s measured
(assumptions wrong, not the mechanism).

**Cost.** Medium: one format change + hooks; shares ~80% of its engineering with D4's repack.

**Prior art.** LLM-in-a-Flash windowing ([arXiv:2312.11514](https://arxiv.org/abs/2312.11514));
kimi-k3's O_DIRECT streaming (PLAN §3.3); no published on-device system combines lean-load +
cross-session warm-start + cold-fill-aware prefill. The parts exist; the stack does not.

### C2 — Ridge-pairing: schedule compute work for the day the I/O ridge is reached `[emergent]`

**Mechanism.** The roofline (R1 A.2): t = 0.012 + max(0.116, (1−h)·291.1/B_eff). Every I/O lever in
this exchange (H2, D2, D4, H1, D1) drives the second term toward 0.116 — the ridge. Past the ridge,
their marginal value is zero. The only lever that moves the ridge is Π_cpu (54 GFLOPS today =
5–10% of silicon): profile the 0.116 s (dispatch/barrier vs GEMM on 2048×512 experts), KleidiAI /
Q4_0-class kernels where the quant allows, mixed-residency quant (resident dense trunk at Q4_0,
routed at 2 bpw — R0 B.4) — all previously de-prioritised by "compute is not the problem".

**Model.** At h = 0.82 or B_eff = 730 MiB/s (both reachable per the crossover math), t_io ≤ 0.116
and decode = 0.128 s = 7.8 tok/s. Π: 54 → 80–120 GFLOPS ⇒ ridge decode = 0.012 + 6.29e9/Π:
0.091–0.079 s ⇒ **8.5–11 tok/s ceiling**.

**Prediction.** Ceiling 7.8 → 8.5–11 tok/s if the compute work lands after (or parallel with) the
I/O work; zero gain before the ridge.

**Assumptions.** (1) A meaningful share of the 0.116 s is dispatch/overhead, not dequant-bound
dot-product — unprofiled in the valid regime [speculation, testable]. (2) IQ2 kernels can be
improved at all on ARM (the quant is the pathology; Trellis-class arithmetic is the escape).
(3) The resident trunk can be re-quantised to Q4_0 without touching routed experts (per-tensor
requant — PLAN F9.1 tooling).

**Falsification.** Profile the 0.116 s (dispatch vs GEMM); then a Q4_0-only microbench of the dense
trunk's GEMMs. Kill if dispatch share < 20% (compute is already dequant-bound and quant-locked).

**Cost.** High (kernels/requant tooling), but shareable with the product track (the 4B control
inherits the same kernels).

**Prior art.** KleidiAI ([github.com/ARM-software/kleidiai](https://github.com/ARM-software/kleidiai))
measured on dense SLMs, not MoE IQ2 dispatch; ik_llama.cpp Trellis claims on ARM
([ik_llama.cpp](https://github.com/ikawrakow/ik_llama.cpp), MoE regression #1699 caveat). The
*ridge-pairing* rule — I/O and compute work must be scheduled so they meet, not sequenced so the
second starts after the first finishes — is not in either round's literature. `[emergent]`.

### C3 — Cold-start dominance: the cache never reaches the steady state the exchange assumed `[emergent: the reframing; D3's mechanism seen correctly]`

**Mechanism/finding.** Over a 64-token benchmark run, flash traffic is ~16 GiB (load ~11.5 +
prefill ~4.5) against ~5.4 GiB decode — and prefill fills the cache at ~3.2% hit. The decode
"steady state" is a cache built by a cold event, on a device whose product usage is *punctuated
cold starts* (each new conversation, each app restart, re-fills). The exchange's decode-centric
reasoning assumed a warm steady state; the closure shows there isn't one.

**What becomes possible.** (a) The benchmark protocol must report per-phase (load/prefill/decode)
traffic — the counters exist; the windows don't. (b) D3's preload is upgraded from "TTFT nicety"
to "the only lever on the largest I/O event". (c) Hit-rate comparisons must use decode-only windows
(70.5% for the bench), not cumulative (56.9%). (d) Product metric: **first-response time =
TTFT + first-token burst**, which the TTFT stack (C1) halves without touching decode.

**Prediction.** Under C3's protocol, the project's own headline ("5.02 tok/s, 56.9% hit") is
reported as "70.5% decode-only hit; ~16 GiB per cold start; 5.02 tok/s". The numbers don't change;
their meaning does.

**Assumptions.** Load read_bytes ≈ 11.5 GiB (E1's premise; else the cold share is ~45% and C3
weakens but survives).

**Falsification.** Load-only read_bytes. Kill only if load < 3 GiB AND prefill < 1 GiB (neither
plausible given 19 s + 10 s [M]).

**Cost.** Trivial (reporting). **Prior art.** MoE-Infinity traces within a session
([arXiv:2401.14361](https://arxiv.org/abs/2401.14361)); nothing treats the load+prefill cold
events as the dominant cost of a chat turn on a phone. Honesty note: C3 is D3/E2's mechanism seen
from the correct frame; the *frame* is the emergent part, and it was made visible only by the
counter-window injection.

---

# Part C — The decision table

| id | one-line mechanism | axis | status | predicted gain | confidence | cost | decisive experiment | outcome implication |
|---|---|---|---|---|---|---|---|---|
| **M1** read_bytes window vs 84.73 | metrology | — | alive | — | — | 3 h | one instrumented run | counted=disk (R0 ceiling) vs ≪ (page cache/buffered) vs ≫ (hidden traffic) |
| **M2** o_direct log grep | metrology | — | alive | — | — | 0.1 h | `grep o_direct` gate logs | which bandwidth reading is even in play |
| **M3** counter-window patch | metrology | — | alive | — | 90% (source-verified) | 0.5 h | A.4.2 patch | every future cache figure trustworthy |
| **E1** load without experts | f | alive | TTFT −10–14 s | 65% (19 s ≈ whole-file read; direct check trivial) | med | load-only read_bytes | unlocks C1; kills H1's TTFT pillar |
| **D2/h(C)** cache 2500/2800 + RSS timeline | f | alive | +0.3–1.0 tok/s if elastic | 45% (churn real at 55–75%; elasticity unknown — the point) | low | 2000/2500/2800 cells | budget-elastic (raise C, policy secondary) vs working-set (H2/D1/H1) |
| **H2** policy bake-off | b | alive (diagnostic) | +0–1.5 tok/s | 50% (churn is real and policy-shaped; content skew may dominate Δh) | low | offline trace replay, defined meter | policy world vs content world; feeds everything |
| **D4** fusion + preadv | c | alive (substrate) | +0.4–1.0 tok/s | 60% overall; 75% for ≥0.3 | med | packed-vs-unpacked microbench ≥1.25× | pattern ceiling; answers N3's preadv question |
| **D3** session hot preload | f/d | alive | TTFT −2–4 s | 50% (prefill target now measured: 4.5 GiB, 3.2% hit) | low | top-400 coverage + A/B | tames the largest I/O event |
| **E2** prefill roofline | d/f | alive | TTFT −2–4 s | 50% | low→med | prefill counter dump | prefill policy possible |
| **D1** residency-biased selection | e | wounded→trace experiment | +0.5–2.0 if flat margin | 25% (score-gap distribution unknown; could be zero) | low | rank-8-vs-16 gap on traces | selection degree of freedom real or dead |
| **H1** REAP pruning | a | mutated | +0.3–1.0; TTFT only if E1 fails | 40% (quality + churn premise; TTFT pillar at risk) | high, irreversible | Italian PPL + p=0.25 + mib_tok | lossy track unlocked or closed |
| **H3** cross-expert packing | c | mutated | +0–1 after D4 | 35% (γ_eff<1 possible at high waste) | high | fio 2M/4M + traces + waste measure | packing pays or is net-negative |
| **H5** promotion ladder | a/e | mutated | +0.2–0.5 | 30% (PPL gate + dual store) | high | PPL gate | last lossy lever |
| **H6** dual-bit RAM | f | mutated | +0.3–1.0 | 25% | med | after max-C + PPL | third tier value |
| H6 compress | f | dead | +0.1–0.3 | — | 1 h | LZ4 ratio microbench | kill switch |
| H4 decode prefetch | d | **dead** | ≤0 | — | — | — | — |
| H4 residue (prefill/admit) | d | alive | TTFT only | 40% | med | prefill counters | admission-as-policy |
| **C2** compute ridge work | e | emergent | 7.8 → 8.5–11 ceiling | 55% (dispatch share unknown; quant-locked risk) | high | profile 0.116 s | next wall after I/O |
| **C3** cold-start protocol | — | emergent | metrology | 90% | trivial | per-phase counters | honest headline numbers |
| H7 instrument (die gate, j/token) | f | alive | enables F5 | 90% | low | max(cpu-*) + power columns | sustained/energy meters exist |
| H7 speed claim | f | **dead** | 0 | — | — | — | — |
| F6 MTP | d | open | ? | 35% (byte-amortization reasoning flipped; GPU anecdotes don't transfer) | med | F6 A/B with majflt/bytes | amortization lever or dead end |

**Ordered plan — discriminating experiments before knobs.** Total ~2.5–3 weeks of calendar, most
of it PC-side and parallelisable:

1. **M2 + M3 (1 h, PC):** grep the gate logs for `o_direct=1`; apply the 6-line counter-window
   patch. *Decides:* which bandwidth reading is in play; makes every subsequent number honest.
2. **M1 — the one instrumented run (3 h, phone):** valid top-app, cold fadvise, gate config, 64
   tokens; `/proc/<pid>/io` read_bytes window; per-window counter deltas; RSS at load-end/prefill-
   end/decode-end; **plus load-only read_bytes** (E1's verdict); plus a cache-2500 rep if RSS
   margins hold. *Decides:* the ceiling dispute, the churn share, E1 liveness, the h(C) slope's
   first point. This is the run that changes the tree; nothing after it is worth doing before it.
3. **M4 — fio 2M/4M/8M + qd4 recheck (1 h, phone, cooldown-gated, top-app):** the γ prior for H3,
   and a re-test of the qd4-256k anomaly under the correct cpuset. *Decides:* whether the fio qd1
   cells are the right ceiling at all.
4. **P5 — Italian PPL gate (3–5 days, PC, parallel to everything):** ≥500k Italian tokens,
   llama.cpp perplexity on the bmoe path, ΔPPL thresholds frozen in advance (R2's Q5 commitment).
   *Unlocks:* every lossy lever; *forecloses:* H1/H5/H6/D1-runtime until it exists.
5. **M5 — traces (F7.1) (2 h phone + 1 day PC):** route traces on Italian product prompts +
   bench. *Feeds:* H2 bake-off, D1's rank-8/16 gap, D3's top-400 coverage, H3's co-activation
   matrix, the decode-only content hit meter. The single highest-leverage data collection.
6. **P1 — E1 load fix (2–4 days):** if M1 shows load reads ≳ 8 GiB. *Unlocks:* C1's TTFT stack;
   *forecloses:* H1's TTFT pillar (re-ranking).
7. **P2 — D4 microbench → implement (2–4 days):** packed-vs-unpacked read microbench first
   (1 day); if ≥1.25×, implement preadv scatter. *Answers:* N3's preadv question empirically;
   raises B_eff for all subsequent work.
8. **P3 — H2 bake-off (2 days, PC):** on M5 traces, defined meter; kill below 3 points.
9. **P4 — D3 hot preload (1–2 days):** after E1; top-400 coverage gated on M5.
10. **F5 sustained + H7 instrumentation (2–3 h, phone) — before ANY product claim:** 10-minute
    run with max(cpu-*) logging and j/token. *Decides:* whether the product survives contact with
    a real conversation (see failure paragraph).
11. **F6 MTP (2 days):** after metrology, with read_bytes per accepted token as the metric.
12. **Lossy ladder (H1 p=0.25 → H5 → H6):** only after PPL + churn results; each step gated.

**The failure paragraph, no stake.** The single most likely way this whole approach fails is that
**every headline number is a 13-second burst at ≤32 °C, and the product is a 10-minute
conversation**. The dense 4B control already showed sustained ≈ half of burst (8.90 → 4.68 tok/s
[M, F2.4]); the die touches 47 °C inside a single burst [M]; lmkd lives ~1 GB above the steady RSS
[M]; and in the entire campaign, no one has run the 35B for five minutes in the valid regime.
Thermal throttling, memory-pressure kills, or simple workload drift cutting 5 tok/s toward 2.5 is
not a research failure — it is the difference between a shipped assistant and a benchmark. The
earliest, cheapest signal is one **10-minute F5 run with max(cpu-*) and tok/s logged per 30 s
block** — the harness exists, the die gate is specified, it costs an afternoon. If decode decays
toward ~2.5–3 tok/s or the process dies, nothing else in this document matters. The runner-up
failure mode is the one this round was built on: the project keeps deciding on derived numbers
that inherited bad inputs — four times now (343 MB, 74%, the 3-core day, the mixed-window
counters). Steps M2+M3 of the plan are the antidote, and they cost 90 minutes.

---

*Conventions: [M] measured in BRIEF/runs.csv/logs; [D] derived (arithmetic shown); [V] source- or
web-verified; [speculation] unmeasured inference. Source facts S1–S5 read directly from
`BigMoeOnEdge/core/src/moe/expert_stream_source.cpp`, `core/src/io/file_reader.cpp`,
`core/src/engine/session.cpp`, `cli/main.cpp` (commit `b0c4e5b`, submodule `5236140e5`).*
