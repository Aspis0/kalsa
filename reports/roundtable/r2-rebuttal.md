# ROUND 2 — Rebuttal, concession, and counter-attack

**Role:** first speaker, answering Round 1.  
**Ground truth:** BRIEF.md.  
**Own prior:** `r0-dossier.md`.  
**Attack:** `r1-attack.md`.  
**New evidence used this round (not in R0):** F0.4 audit of BigMoeOnEdge (`reports/moe-f0.4.md`) — O_DIRECT default, hit counters, LRU, lazy `vm_commit`, layout.

**Headline.** Round 1 correctly killed my decode-prefetch model (H4), my H5 traffic table, and my H1 gain table. It correctly elevated **re-read churn** (4,848 re-reads / 64 tokens) to first-class physics. It incorrectly reconciled bandwidth via **page cache** without checking that the fork’s documented read path is **`O_DIRECT` by default** [V, F0.4] — that weakens R1’s “30–40% of counted bytes never touch flash” story and partially restores my ceiling reading, *until* `/proc/pid/io` is measured. Several of R1’s new hypotheses (D1, D3, D4) are real; D2’s *mechanism* is likely false given F0.4’s lazy commit, but its *measurement* (h(C) at higher C) remains mandatory.

---

# Part A — Answers to Round 1’s five questions

## Q1 — The re-read storm: fraction of 84.73 MiB/tok, and ranking H2 vs H3

**Arithmetic.**

From the same log line R1 cites [M, PLAN Registro / F4]:

```
re-reads = 4848 / 64 = 75.8 / token
evictions = 8843 / 64 = 138.2 / token
```

If each re-read is a full expert load at median size:

```
T_reread ≈ 75.8 × 0.8984 MiB = 68.1 MiB/tok
T_total  = 84.73 MiB/tok
fraction ≈ 68.1 / 84.73 = 80.4%
```

If each re-read is one projection only (264–392 KiB), the fraction falls to roughly:

```
75.8 × 0.30 MiB ≈ 22.7 MiB/tok → ~27% of traffic
```

**Which?** F0.4: cache entry key = `(layer, expert)`; prefetch commits **all projections** of an expert before publish; eviction releases “pages of the slice” for that entry. Re-reads are almost certainly **whole-expert reloads**, so **~80% of counted traffic is self-inflicted churn**, not first-time compulsory loads. Mark residual uncertainty: confirm `rereads_++` site in source counts full expert vs proj — but the entry model points to full expert.

**Does this change H2 vs H3 ranking?** **Yes — strongly, and in H2’s favour, with a confounded twin.**

| Miss class | ~share of flash bytes | Fixed by |
|---|---:|---|
| Re-read / churn | ~80% | larger C (budget), better admission/eviction (H2), residency-biased selection (D1) |
| First-touch compulsory | ~20% | larger C, pruning (H1), layout only helps *cost per miss* not count |

H3/D4 (layout) still matter: they raise **B_eff per miss**. But the dominant term in `T = n_miss × size` is `n_miss`, and most of `n_miss` is churn. **I was wrong to rank packing (H3) above policy on EV when the log already screamed re-reads.** Correct order of *investigation*:

1. Confirm O_DIRECT + re-read semantics in source (hours).  
2. **h(C) cells** at 2000 / 2500 / (if safe) 2800 — budget vs churn elasticity.  
3. **Offline H2 bake-off** on the same traces (policy vs churn).  
4. **D4 fusion** (pattern BW; also settles A.1).  
5. H3 cross-expert packing only after traces on product traffic.

H2 and budget cells are confounded (R1 C.2 case B is right on sequencing). Rank them as a **joint first experiment**, not H2 alone above everything.

---

## Q2 — What does `cache_hit_pct` count? Does F4.5 inherit it?

**What F0.4 documents [V]:**

- Counters: `chits_ / clookups_` in `ExpertStreamSource::touch_entry`.  
- Exposed as `Stats::cache_hits / cache_lookups` → `cache_hit_pct`.  
- Entry key: `il * n_expert + e` → **one entry per (layer, expert)**, not per request-batch.  
- LRU touch on demand hit → `lru_push_front`; bad prefetch → `lru_push_back`; `retain()` promotes **without** counting a hit.

So it is **not** “per HTTP-style request.” It is a **per-entry lookup hit rate** on the expert stream source.

**The reconciliation problem stands — I concede R1’s inconsistency.**

```
byte-consistent per-load hit = 1 − 84.73 / 287.5 = 0.705   (median expert size)
reported cache_hit_pct       = 0.569
If miss rate 0.431 and 320 loads/tok: miss bytes = 320 × 0.431 × 0.898 = 123.8 MiB ≠ 84.73
```

No simple model (per-load, per-slice, per-layer-batch) jointly fits 56.9% and 84.73. Hypotheses that do **not** resolve without source:

- cold-start bias over 64 tokens (affects both averages the same way if loads = lookups);  
- drop-cold (off in gate config);  
- partial projection accounting;  
- lookups that do not issue I/O;  
- `entry_bytes` ≠ 0.942 MiB for counter vs stream accounting.

**F4.5 content-dependence (71–77% vs 56.9%) uses the same `cache_hit_pct`.** The **ranking** across prompts is still informative (same broken meter, different readings). The **absolute levels** and any conversion “request-hit → byte-hit” are **not** safe until the meter is defined in code.

**What is needed (not bluffed):** open `expert_stream_source.cpp` around `touch_entry` (~884–918) and the MiB/token accumulator; print one token’s `clookups`, `chits`, bytes read, experts loaded. Until then: treat **84.73 MiB/tok as the trustworthy traffic metric**; treat **56.9% / F4.5 hit% as ordinal only**.

---

## Q3 — Read granularity: per-slice or per-expert?

**Answer from F0.4 + F0.6 [V], not from speculation:**

- Layout: gate / up / down are **three non-contiguous tensors**; shexp + router sit between them [F0.6].  
- Loader: `load_layer()` reads routed **slices** from flash; cache structure is per `(layer, projection)` buffer range; I/O jobs publish per projection readiness for `mul_mat_id` [F0.4].  
- Contiguity assumed **within** a tensor along expert dim, **not** across gate/up/down.

**Therefore reads are issued per-slice (≈264 / 264 / 392 KiB), not as one 0.942 MB blob** — unless a fused layout path exists (F0.4 mentions fused `ffn_gate_up_exps` as an alternate layout; our UD-IQ2_M dump is **non-fused**).

**Implication for the ceiling dispute:**

- fio: 256k = 214 MiB/s, 1M = 413 MiB/s [M].  
- Per-slice pattern sits in the **214–280 MiB/s class**, not the 413 class.  
- Runtime “266 MiB/s” is **consistent with a device-rate for this pattern** *if* that number is disk service rate — but it is still `84.73/0.319`, and `0.319 > 0.201`, so it remains **thread-accounted**, not pure wall.  
- **D4 (fuse three slices → one blob) is live** and is the cheapest way to move the pattern toward the 1 MiB class.  
- My R0 claim “no headroom at current layout” must be **mutated**: no headroom **for more workers on this pattern**; **pattern headroom via fusion is open**.

Exact `read()`/`pread` sizes: not printed in F0.4; answer above is structural. A one-line log of nbytes per I/O job would finish it.

---

## Q4 — Load peak: does the fork pre-allocate `cache_mb`? Why not 2500/2800? Why 19 s load?

### Pre-allocation

**F0.4 [V]: physical pages are committed on miss, not at load.**

```
vm_reserve  → address-only, MAP_NORESERVE
vm_commit   → on miss (touch_entry / commit_proj_pages)
vm_evict    → MADV_DONTNEED on LRU eviction
cache_max_  → caps cresident_ after staging a layer
```

R1’s D2 mechanism (“fork pre-allocates cache_mb at load ⇒ load peak includes C”) is **probably false** as stated. I should not have left “just raise cache” unexamined, but **deferred allocation may already be the design**.

Then why did cache-3000 die at `create_tensor` ~blk.38? Leading candidates:

1. **Dense-path peak** under `--dense-weights anon`: O_DIRECT → anon buffers for non-expert tensors while layers 0…38 materialise [F0.4].  
2. **`use_mmap = true` required at load** [F0.4]: full-file map pressure even though expert tensors later rebind.  
3. Interaction of (1)+(2) with a **higher `cache_mb` metadata/reserve** (weak — NORESERVE should not add ~1 GB RSS).  
4. Session/lmkd noise (battery 43%, prior demotions).

**What is needed:** RSS trace through load→prefill→decode at cache-2000 with counters for `cresident_` vs dense RSS. Until then: **do not assume D2’s pre-alloc story**.

### Why 2500/2800 was not in my R0 sequence

I ranked H2 offline above budget cells because offline is cheap and lossless. **That was a sequencing error given (a) re-read mass and (b) cache-2500 never measured in the valid regime [M, F4.4].** Even if allocation is already lazy, **the h(C) curve has one point** (BRIEF §5.1). Measuring C=2500 (and 2800 if RSS allows) is still among the highest-EV phone runs available. I concede the prioritisation mistake.

### 19 s load for ~1.75 GiB resident

Dense+shared ≈ file − routed pool ≈ 11.52 GiB − ~9.0–9.7 GiB ≈ **1.8–2.5 GiB** order (pool 256×40×0.94 MB ≈ 9.65 GB decimal). Sequential at 400–1600 MiB/s ⇒ **1–6 s**, not 19 s.

```
11.52 GiB / 19 s ≈ 620 MiB/s   (order of sequential UFS)
1.75 GiB / 19 s  ≈ 94 MiB/s    (implausibly slow for pure dense)
```

So the loader almost certainly **touches far more than the resident trunk** — consistent with mmap of the whole GGUF and/or reading expert tensor metadata/pages during `create_tensor`. F0.4: mmap mandatory at load; experts rebind later. **~10–15 s of TTFT may be software waste**, invisible inside the “stream+cache decode” frame. R1 is right; I under-weighted TTFT.

**Emergent action:** treat “load without faulting expert bodies” as a first-class bug/fix, orthogonal to decode tok/s.

---

## Q5 — Quality gate for the lossy track (concrete instrument)

I commit to this gate **before ranking or shipping any of H1 / H5 / H6 dual-bit / D1**.

| item | choice |
|---|---|
| Tool | llama.cpp `perplexity` (or equivalent) on the **same** bmoe-cli / quant path used for decode |
| Corpus | Italian: ≥ **500k tokens** of held-out chat-like + general IT text (e.g. cleaned OSCAR/it or Wikipedia-IT sample + a private chat-style set if available). **Not** coding-only. Report PPL on chat-IT and on a small code split separately. |
| Baseline | UD-IQ2_M, unpruned, current gate flags, temp irrelevant for PPL |
| Metric | ΔPPL = PPL_variant − PPL_baseline (nats or bits; pick one and keep) |
| Sample size | enough for SE(ΔPPL) ≪ decision threshold: target **≥100k tokens** eval after warmup; bootstrap CI |
| Thresholds (proposed) | **ΔPPL ≤ 0.05** (≈ small) → allow lossy lever into phone A/B; **0.05 < ΔPPL ≤ 0.15** → only with human secondary read on morphology-heavy prompts; **ΔPPL > 0.15** → reject for product. Numbers are **policy proposals**, not sacred — freeze them before the first lossy run. |
| Secondary | fixed 20-prompt IT morphology/code set, temp=0, side-by-side; catches cliffs PPL averages hide |
| What does **not** substitute | F4.5’s 5 human prompts alone; English coding REAP numbers; “feels fine” |

**Refuse to rank H1/H5/H6-lossy/D1 for implementation order until baseline PPL exists.** Lossless track (H2, D4, h(C), load-path TTFT) proceeds in parallel.

---

# Part B — Verdict on every attack

## H1 — MUTATE

**What lands.** My table did not follow my formula. R1 recompute:

```
c = 0.207, p = 0.50
T' = T · (1 − c/(1−p)) / (1−c) = 88.8 · (1 − 0.414)/0.793 = 88.8 · 0.739 = 65.6 MB/tok
```

At 425 MiB/s wall: t_io ≈ 0.147 s → tok/s ≈ 1/(0.012+max(0.116,0.147)) ≈ **5.9**, not 6.5–7.5. **I was wrong; the table was inflated.** Also: H1 compulsory-miss premise fights H2/churn; with ~80% re-read bytes, pool-halving attacks a minority of traffic unless it also shrinks the working set that churns.

**What survives.** File-size / TTFT win is real and independent of hit math. Relative coverage still rises. After churn is reduced, residual compulsory mass is H1’s proper target.

**Mutated H1.**  
*Domain-calibrated REAP at p∈{0.25,0.50}, ranked only after (i) Italian PPL gate, (ii) measured re-read fraction vs compulsory from traces, (iii) h(C) on unpruned model.*  
**Model:** use the formula bound T'≥65.6 MB/tok at p=0.5 as **optimistic** only if pruned mass ⊆ never-used; else T' closer to T.  
**Prediction:** **5.3–6.0 tok/s** decode if quality holds; TTFT load **−25–45%**; quality unknown until gate.  
**Cost of mutation:** loses “path to 7.5 tok/s by prune alone”; becomes a **TTFT + residual-miss** lever, not the primary decode lever.

---

## H2 — DEFEND (as diagnostic + live lever); CONCEDE (EV table magnitude)

**Error in the objection’s kill attempt.** R1 does not kill H2; it correctly says the **+5–12 Δh table is unjustified transfer**. I agree: SpecMD’s 85× is OLMoE / 0.6 GB VRAM ([arXiv:2602.03921](https://arxiv.org/abs/2602.03921)); SCH curves are future-aware ([arXiv:2505.16056](https://arxiv.org/abs/2505.16056)). Domain of Δh is unknown.

**What the objection underweights.** Re-read ≈80% of traffic under whole-expert re-read accounting is **prima facie policy-or-budget shaped**, not pure content. Content (F4.5) moves the *level*; it does not erase churn structure. Offline bake-off remains the cheapest split between policy vs budget vs content.

**Arithmetic of the Δh table:** internally consistent; only the prior on Δh was soft. At h≥0.82 the system is compute-bound at 7.8 tok/s (R1 A.2 ridge — I accept that ridge under the Round-0 BW reading).

**Defend ranking among lossless ideas:** H2 offline + h(C) phone cells **before** H3 full packing. Concede: not “before measuring cache-2500.”

---

## H3 — MUTATE

**What lands.** Span-waste model was missing; γ∈[1,4] was optimistic; AndroBench 1.6 GB/s ≠ 1–4 MB spans; product traces ≠ EN bench. Sequencing error vs D4.

**What survives.** Contiguity still raises B_eff; G3 gap still real; fio size curve is the right physics.

**Mutated H3.**  
*(i) D4 first — fuse gate/up/down per expert, no traces.*  
*(ii) Cross-expert co-activation packing only after Italian route traces, with*  
`γ_eff = γ_raw / (1 + waste_frac)`, waste_frac = mean cached fraction of span.  
**Prediction:** D4 alone **+0.3–1.5 tok/s** (wide: depends on BW reading); full H3 after D4 **additional +0–1 tok/s** after waste.  
**γ prior:** **[1.2, 2.2]** not [1, 4], pending fio 2M/4M.

---

## H4 — CONCEDE (decode-overlap form); residue MUTATE

**What killed it.** On a **rate-bound** I/O path, prefetch cannot compress device time. My β model treated 0.073 s as schedulable slack; it is the rate deficit. R1 Eqs. 2–3:

```
t_io' = (84.73 + w) / B_dev  ≥  0.189     (at B_dev≈446 under R0 reading)
t'    = 0.012 + max(0.116, t_io')
```

Wrong prefetches **cost the saturated resource**. At SpecPrefetch Recall@8 ~0.86–0.89 ([arXiv:2607.24787](https://arxiv.org/abs/2607.24787)), order-of-magnitude waste ~ tens of MiB/tok can make decode **slower**. Even w=0 leaves steady-state decode unchanged if the pipeline already overlaps I/O.

**I was wrong.** Decode-latency-hiding H4 as written is **dead**.

**Residue (mutated):**  
(1) **Prefetch as admission** into the 2 GB cache (= H2 with a predictor) — value equals hit-rate only; measure offline.  
(2) **Prefill/TTFT path** — cold cache, little overlap; prediction can still cut exposed latency there.  
Not a top decode lever under saturation.

---

## H5 — CONCEDE table; MUTATE mechanism ranking

**What killed the table.** I applied ρ to all traffic. Correct (R1 Eq. 4):

```
T' = T · (1 − (1−ρ)(1−h)) = 88.8 · (1 − 0.4×0.291) = 78.5 MB/tok   (ρ=0.6, h=0.709)
→ ~5.3 tok/s, not 6.3
```

My own prose (“miss traffic only”) contradicted my table. **Concede.**

**Mutated H5.** Promotion ladder only: miss → low-bit load; promote to IQ2_M on second use (re-read counter is free signal). Bound ≈ Eq. 4 **plus** churn reduction if promotion sticky. **Blocked on PPL gate.** Ranked last among lossy.

---

## H6 — MUTATE (concede pure-compress novelty overclaim)

**What lands.** IQ2 residual compressibility likely q≈0.9–0.97; pure compress ≈ +0.1–0.3 tok/s; competitor is **more full-precision slots** if RSS headroom exists; “novel mechanism” overstated (compression of weights is old; combination is niche).

**Mutated H6.**  
(1) One-hour LZ4/ZSTD microbench on 100 expert tensors — expect kill of pure compress.  
(2) Dual-precision RAM tier **only after** max safe full-precision C is pinned and PPL gate exists.  
Not novel in mechanism; keep only as third-tier under hard budget.

---

## H7 — CONCEDE as tok/s lever; DEFEND as instrumentation

**What killed the speed claim.** No measured thermal cliff in valid top-app regime [M, BRIEF §5.7]. Half-speed/10 min is untrusted 3-core data. “+20–50% sustained” is baseless.

**What survives.** Die-gated cooldown (`max(cpu-*)`), not battery; j/token column never measured; Registro 6 J/tok is physically absurd at 5 tok/s (⇒ ~30 W). Sanity **~1.5–2.5 J/tok at 8–12 W** is still **[speculation]** until measured.

**Mutated H7.** Instrumentation-only: `soc_temp_*`, `power_w` / `j_per_token` when measurable; no tok/s prediction.

---

## Side concessions on R0 Part A (bandwidth)

| R0 claim | Verdict now |
|---|---|
| `t_flash_io` is not exclusive wall time (0.319>0.201) | **DEFEND** — still true |
| 266 MiB/s is not device wall BW | **DEFEND** as “not wall”; **MUTATE** — may be thread-rate *and* land near pattern-limited disk class |
| Wall 425 ≥ fio 413 ⇒ at device ceiling, 0% headroom | **WOUNDED** — true only if counted bytes = disk bytes; O_DIRECT default [F0.4] makes page-cache escape hatch weaker than R1 claims, but Android O_DIRECT behaviour is **unverified in the valid regime** |
| More I/O workers dead | **DEFEND** — io-threads-5 [M] |
| Pattern headroom (fusion) dead | **CONCEDE I buried it** — D4 lives |

**Settling measurement (both rounds agree; still not run):** `/proc/<pid>/io` `read_bytes` over 64 tokens, cold cache via fadvise, top-app, optional competing fio.

- `read_bytes/tok ≈ 84.7 MiB` → counted≈disk; R0 ceiling mostly right; O_DIRECT doing its job.  
- `read_bytes/tok ∈ [50,70]` → page cache or double-count; R1 right.  
- `read_bytes/tok ≫ 84.7` → hidden traffic layer (load/mmap); both incomplete.

---

# Part C — Attack Round 1

## C.1 Attacks on D1–D4

### D1 — Residency-biased expert selection   **WOUNDED**

**Strongest objection.** The headline IID calculation is a rhetorical upper bound, not a prediction:

```
p_res = 0.719, n=16: P(Bin(16,p)<8) ≈ 1.3%  [R1; arithmetic OK]
⇒ T' ≈ 4–8 MiB/tok ⇒ 7.8 tok/s
```

But residency is **positively correlated with router score** (hot experts are hot because they score high and stay resident). The δ-gate fires exactly when score and residency **disagree** — topic shifts, rare morphology, code identifiers — i.e. where quality harm concentrates. The “realistic 20–60 MiB” band is asserted without a score-gap distribution.

**Hidden assumptions.** (1) Flat mass at ranks 8–16. **Falsifiable from one route-trace file** (weight of rank-8 vs rank-16). If median gap ≫ δ, gate never fires → D1 dies cleanly. (2) Italian PPL gate exists — shared blocker. (3) Changing selection does not destabilise later layers’ routing (distribution shift).

**Prior art check.** AdapMoE is adaptive *skipping* of low-sensitivity experts ([arXiv:2408.10284](https://arxiv.org/abs/2408.10284)), not residency-biased replacement among top-16. EdgeMoE is static quant tiers ([arXiv:2308.14352](https://arxiv.org/abs/2308.14352)). “Partial novel” is fair for the combination; not for the idea of cache-aware scheduling.

**Arithmetic.** 7.8 tok/s line is **not** a serious prediction; use only after measuring P(swap|δ) on traces. Until then D1 is a **trace experiment**, not a phone claim.

**Verdict:** WOUNDED — survive as offline analysis; do not sell 7.8 tok/s.

---

### D2 — Deferred cache allocation   **FATAL as mechanism; SURVIVES as measurement programme**

**Strongest objection.** F0.4 documents **lazy `vm_commit` on miss** and `MAP_NORESERVE` reserve. The story “C is inside the load peak because pre-alloc” contradicts the audit. cache-3000 death at `create_tensor` is more consistent with **dense anon + mmap load**, not expert cache fill (decode has not started).

**Arithmetic of “4.6 + 1 GB headroom”** still useful: steady-state RSS 4.6 vs lmkd ~5.6 [M] suggests **~1 GB** may exist for **more resident experts** if load peak is the killer and steady state is not — but only if raising `cache_mb` does not also raise load peak via another path.

**What survives:**  
- Measure h(2000), h(2500), h(2800) in valid regime.  
- RSS timeline load→prefill→decode.  
- If lazy already, “just run cache-2500” is the experiment; if something still pre-touches C at load, then fix that bug.

**Verdict:** FATAL as stated mechanism; **alive as “get the h(C) curve and RSS timeline.”**

---

### D3 — Session-persistent hot-expert preload   **SURVIVES (narrow, TTFT-oriented)**

**Strongest objection.** Model for prefill time is hand-wavy (`T_prefill × (1−m×h_warm)`); prefill has never been decomposed [M, BRIEF §5.5]. Cross-session stability of top-400 is plausible for Italian chat but unmeasured. +377 MB during load may **extend** the 19 s load if the load path is already reading the world.

**What holds.** Cold-start tax is real; few-KB heat file is cheap; offline coverage of top-400 on traces is a clean kill switch; orthogonal to decode-steady-state levers.

**Arithmetic check.** At 266–450 MiB/s, 377 MB ≈ 0.8–1.4 s extra I/O — acceptable **if** load is not already saturated with useless expert faults. If load already streams 11 GB, preloading hot experts might be free (already in cache) or reorder work.

**Verdict:** SURVIVES as low-cost TTFT experiment after load-path audit.

---

### D4 — Intra-expert read fusion   **SURVIVES — promote**

**Strongest objection is weak.** R1 understates how well this matches F0.4/F0.6: non-fused layout + per-projection I/O is documented. Cost is medium, not low, but **no traces, no quality risk**. Dual purpose: speed + bandwidth-reading discriminator.

**Arithmetic.**  
R0 reading (already ~425 wall): fusion helps less on rate, still helps syscall/QD efficiency — small.  
R1 pattern reading (disk ~266 class): jump toward 413 → t_io drop material → **~5.4–6.5 tok/s** plausible.  
Microbench kill if packed/unpacked wall MiB/s < 1.25× is well-posed.

**Citation hygiene.** Fine; kimi-k3 O_DIRECT is different OS.

**Verdict:** SURVIVES; **rank among first lossless eng tasks.**

---

## C.2 Round 1’s “received wisdom” section

### What R1 got right (extend it)

1. **“413 is the ceiling” is over-claimed.** Extend: even under O_DIRECT, ceiling is **(block size × QD × FS path)**-specific. fio 2M/4M/8M qd1–4 is a 10-minute prerequisite to any packing paper.  
2. **“Compute is not the problem” becomes false at the ridge.** Extend: 54 GFLOPS is a small fraction of 8 Gen 2 int8-class; once h→0.82 or B_eff doubles, **kernel quality on 2048×512 expert GEMMs** becomes the next wall. Profiling the 0.116 s (dispatch vs matmul) is not optional forever.  
3. **Quality instrument is too weak for lossy levers.** Extend: every Registro argument that ranks REAP “first line” without PPL is process debt.  
4. **MTP/GPU anecdote is not a phone result.** Extend: MTP’s byte-amortization **targets our constraint class**; EVICT-style expert-union ([arXiv:2605.00342](https://arxiv.org/abs/2605.00342)) matters more here than on GPU. Do not promote MTP to “will work” — promote it to “must measure, reason flipped.”  
5. **1.6 GB/s packing fantasy.** Agree; cap γ priors.  
6. **Hit content-dependence levels inherit bad meter.** Agree; keep ranking only.

### Where R1 is merely contrarian / incomplete

**Contrarian case A (not at ceiling).** Strengthened by per-slice pattern; **weakened by O_DIRECT default** which R1 did not cite. Claiming “30–40% of counted bytes never touch flash” without checking F0.4 is the same sin R1 accused me of (unchecked assumption). Honest status: **unsettled**, not “R1 wins.”

**Contrarian case B (policy near zero).** Sequencing yes; “policy worthless” no. Re-read structure under O_DIRECT means churn burns **real flash**, not free page cache. Budget and policy both live.

**Claim 3 edge:** R1 is right that compute sets the 7.8 floor; wrong if read as “spend now on Kleidi before measuring bytes” — still second-order until T drops.

---

## C.3 Reframing — R1 found real blind spots; develop them

R1’s five “frame-invisible” questions are **better than most of my H-list**. Developed further:

### R1-1 Load touches experts → **E1 (emergent)**
If create_tensor / mmap faults expert bodies, TTFT is a **loader bug**, not a caching research problem. Expected fix value: **−5 to −12 s TTFT** with no decode change. Prioritise above H3.

### R1-2 Prefill undecomposed → **E2**
Prefill 10 s is product-critical (BRIEF §6). Needs the same compute/cache/io split as decode. Prefetch/H4 residue lives here.

### R1-3 Zipf / rank-frequency → **prerequisite**, not a hypothesis
Without unique-expert CDF per conversation length, H1/H2/D2 are uncalibrated. Route-trace is not optional research; it is **metrology**.

### R1-4 Routing as degree of freedom → D1 (already)
Keep, offline first.

### R1-5 Load vs steady RAM → D2 mutated
RSS timeline; stop talking about “cache budget” as one number.

**If I had only BRIEF numbers and no literature:** I would attack, in order:  
(1) `/proc/pid/io` vs 84.73;  
(2) re-read fraction and h(C);  
(3) load-path TTFT;  
(4) fuse 3-slice reads;  
(5) Italian PPL.  
That sequence is more honest than R0’s literature-shaped ranking.

---

# Part D — Emergent hypotheses `[emergent]`

## E1 — Expert-avoiding model load (TTFT without decode research)   [axis: f]   `[emergent]`

**Mechanism.** Force load path to materialise **only** dense + shared + embeddings + graph, never expert tensor bodies. Today `use_mmap=true` plus create_tensor likely faults far beyond the resident set (19 s ≈ sequential-class time for ~full file). Rebind experts to empty stream buffers **before** any WILLNEED/populate on expert ranges; optionally `MADV_DONTNEED` expert file regions after bind.

**Model.**  
Let B_load be bytes faulted at load. Observed t_load≈19 s. If B_load falls from ~11.5 GiB to ~2 GiB:

```
t_load' ≈ 19 × (2/11.5) ≈ 3.3 s   (linear fault model; optimistic)
```

Realistic with fixed overheads: **t_load' ∈ [5, 12] s**. TTFT = t_load + t_prefill; prefill may still be ~10 s until E2.

**Prediction.** TTFT **27.5 → 15–22 s**; decode tok/s **unchanged**; RSS load peak **down**; energy load **down**.

**Assumptions.** (1) Current load faults experts — **unverified, but 19 s strongly suggests it**. (2) Fork can skip expert populate without breaking rebind. (3) Android mmap allows DONTNEED on those ranges without root.

**Falsification.** Log `read_bytes` and majflt during **load only** (no decode). If load `read_bytes` ≈ 2 GB, E1 is already done (kill). If ≈ 11 GB, E1 is live. Phone, one instrumented run.

**Cost.** Medium (loader path). Breaks: easy to get wrong (silent CPU garbage on first expert use) — need byte-identity gate after first decode.

**Prior art.** Explicit streaming runtimes (BigMoeOnEdge’s own design intent); LLM-in-a-Flash; kimi-k3 O_DIRECT. The emergent point is **treating 19 s as a bug against the fork’s own architecture**, which neither R0 nor the literature ranking prioritised.

---

## E2 — Prefill as first-class roofline (cold-cache, no overlap)   [axis: d/f]   `[emergent]`

**Mechanism.** Decompose prefill with the same counters as decode: compute / cache_mgmt / flash_io / mib_tok / hit / re-reads. Optimise **prefill** separately: larger speculative admission only during prefill; sequential layer sweep packing; optional lower k for prefill only (`--n-expert-used` or drop-cold prefill — fork already has `drop_prefill` default off [F0.4]).

**Model.** Prefill time T_p ≈ 10 s for short prompt [M]. If cold hit≈0 and traffic ≈ 291 MiB × n_prompt_tokens (not per gen token — **prefill is many tokens**):

Actually prefill processes n_prompt tokens; expert loads scale with n_prompt. For n_p=64–256, I/O dominates worse than decode steady state.

**Prediction.** After E1+E2: TTFT **−30–50%**; decode steady **unchanged** unless admission warms cache for first decode tokens (**synergy with D3**).

**Assumptions.** Prefill currently unoptimized [M]. Overlap less effective in prefill (R1) — then layout (D4) and load-warm (D3/E1) beat decode-prefetch.

**Falsification.** One prefill-only counter dump; if prefill is already compute-bound, E2 dies.

**Cost.** Low (instrument) → medium (prefill-specific policy).

**Prior art.** DistServe-style prefill/decode split in servers; not applied to on-device expert stream TTFT. Emergent from R1 frame critique + BRIEF TTFT constraint.

---

## E3 — Churn-aware cost: re-read share as the primary KPI   [axis: b/f]   `[emergent]`

**Mechanism.** Stop optimising “hit%” until defined. Optimise **re-read_bytes / total_read_bytes** and **unique_experts / token** from counters that already exist (`rereads_`, MiB/tok). Policies (H2), budget (h(C)), and D1 all report on this KPI. O_DIRECT makes re-reads expensive; page-cache theories do not excuse them.

**Model.**  
T ≈ T_first + T_reread; currently T_reread/T ≈ 0.8 (whole-expert assumption).  
Every 10-point cut in re-read share at fixed first-touch:

```
T' ≈ 84.73 × (0.2 + 0.8×(1−α))     α = fraction of re-read mass removed
α=0.5 → T'≈50.8 MiB/tok → ~6.5–7.0 tok/s at 425 MiB/s
```

**Prediction.** Decode **5.5–7.0** if α∈[0.3,0.6] via budget+policy; TTFT minor; quality lossless for H2/budget.

**Assumptions.** Re-read counter semantics; O_DIRECT active in valid runs.

**Falsification.** If `rereads_` counts something other than full expert reloads, rebuild model. Source check + one run.

**Cost.** Trivial metrology; then H2/h(C).

**Prior art.** SpecMD collision misses; classic cache thrash metrics. Emergent **priority** of the KPI from R1’s elevation of 4848 re-reads + F0.4 O_DIRECT.

---

## Composition note (not a separate H)

**D4 + E3 + h(C):** fusion reduces cost/miss; churn reduction reduces misses; larger C reduces thrash. Superadditive if currently thrashing below working set. **H4 decode is not in this composition.**

Nothing else emerged that is not a mutation of R0/R1. I will not rebrand H2 as novel.

---

# Part E — Current standing

| ID | Origin | Status | Predicted gain (tok/s or other) | Uncertainty | Cost | Cheapest decisive experiment |
|---|---|---|---|---|---|---|
| Ceiling claim (425=disk) | R0 | **unsettled** | n/a | high | low | `/proc/pid/io` read_bytes / 64 tok + optional fio fight |
| More io-threads | tried | **dead** | −3.7% | none | done | — |
| H1 REAP | R0 | **mutated** | +0.3–1.0 tok/s; TTFT −25–45% | high (quality) | high | Italian PPL + p=0.25 prune; kill if ΔPPL>0.15 or mib_tok −<10% |
| H2 TinyLFU/Least-Stale | R0 | **alive** | +0–1.5 tok/s | high (Δh) | low offline | Trace replay: best−LRU <3 pt ⇒ deprioritise policy |
| H3 pack (cross-expert) | R0 | **mutated** | +0–1 after D4 | high | high | After D4 + Italian co-activation matrix |
| H4 decode prefetch | R0 | **dead** | ≤0 decode (wasted BW) | low | — | — |
| H4 residue prefill/admit | R0/R1 | **alive** | TTFT / hit only | med | med | Prefill counters; offline admit value |
| H5 HOBBIT ladder | R0 | **mutated** | +0.2–0.5 tok/s | high (quality) | high | PPL gate; Eq.4 bound |
| H6 pure compress | R0 | **dead** (likely) | +0.1–0.3 | low | 1 h | LZ4 ratio on 100 experts; kill if q>0.95 |
| H6 dual-bit RAM | R0 | **mutated** | +0.3–1.0 | high | med | After max C + PPL |
| H7 thermal speed | R0 | **dead** | 0 | — | — | — |
| H7 instrument | R0 | **alive** | enables F5 | low | low | max(cpu-*) gate + j/token column |
| D1 residency select | R1 | **wounded** | +0.5–2.0 if flat margin | very high | low offline | Trace: rank8–16 gap; kill if gate never fires |
| D2 deferred alloc | R1 | **dead mech** | — | — | — | — |
| D2 h(C)+RSS timeline | R1 | **alive** | +0.3–1.0 if elastic | med | low phone | cache 2000/2500/2800 + RSS |
| D3 session hot preload | R1 | **alive** | TTFT −2–4 s | med | low | Top-400 coverage on traces; then A/B TTFT |
| D4 slice fusion | R1 | **alive** | +0.3–1.5 | med | med | Packed vs unpacked read microbench ≥1.25× |
| E1 load without experts | R2 | **alive** `[emergent]` | TTFT −5–12 s | med | med | load-only read_bytes |
| E2 prefill roofline | R2 | **alive** `[emergent]` | TTFT −10–40% | high | low→med | Prefill counter dump |
| E3 re-read KPI | R2 | **alive** `[emergent]` | metrology | low | trivial | Define reread_bytes/total |

---

## If we can run exactly one phone experiment this week

**Run this:**

> Valid top-app, cold `posix_fadvise(DONTNEED)`, gate config (t=4, io=4, cache=2000, anon, overlap), n_gen=64, **plus**:  
> (1) sample `/proc/<pid>/io` `read_bytes` before/after generate;  
> (2) log existing `evictions`, `re-reads`, `mib_tok`, `cache_hit_pct`;  
> (3) RSS at end of load, end of prefill, end of decode;  
> (4) optional second rep at **cache-mb 2500** only if load RSS leaves ≥0.8 GB margin under 5.6.

**Why one experiment changes the tree:**

| Outcome | What we do next |
|---|---|
| `read_bytes/tok ≈ 84.7 MiB` and re-read mass high | Trust counted traffic; **chase churn** (H2 offline + C↑); D4 for pattern; stop page-cache stories |
| `read_bytes/tok ≪ 84.7` | Kernel serves bytes; re-open BW headroom theory; prioritise O_DIRECT verification / accounting bugs |
| `read_bytes/tok ≫ 84.7` or load-only already ~11 GB | **E1 load path first** — TTFT bug dominates research |
| h(2500)−h(2000) ≥ 3 pt (or re-reads drop hard) | Budget is elastic; raise C; policy secondary |
| h(2500)−h(2000) < 2 pt, re-reads still high | Working set ≫ C; **policy (H2) or D1/H1**, not more RAM |
| Same outcome all branches | (Impossible if we log all four — that is why this design) |

An experiment that only re-measures 5.02 tok/s without `read_bytes` / re-reads / RSS **does not change actions** and is worthless this week.

---

# Closing honesty ledger

| Item | Who was right |
|---|---|
| H4 decode β model | **R1** — I concede |
| H5 T'=ρT table | **R1** — I concede |
| H1 gain table vs formula | **R1** — I concede |
| Re-read storm as central fact | **R1** — I underused data that was already in the log |
| Page-cache explains 425 vs 413 | **Open; R1 incomplete** — ignored F0.4 O_DIRECT |
| More workers dead | **Both** |
| Pattern headroom (D4) | **R1** elevated correctly; R0 under-ranked |
| Hit meter inconsistency | **R1** — both rounds must stop treating 56.9% as byte-hit |
| D2 pre-alloc mechanism | **R2/F0.4** against R1 mechanism |
| Load TTFT as bug | **R1** frame critique — accepted as E1 |
| Lossy levers before PPL | **Both claimed; neither executed** — gate now concrete |

Conceding H4/H5-table/H1-table frees the next round for **metrology, churn, fusion, and load TTFT** — the collision’s real product.

---

**END ROUND 2**
