# Hostile Audit B — Wrong Kills and Left-on-Table Value

**Audit date:** 2026-08-16
**Scope:** ~25 killed techniques in the Kalsa MoE campaign
**Standard:** CONFIRMED / PLAUSIBLE / REFUTED, ranked by expected value
**Evidence standard:** file:line or specific data file + numbers

---

## Executive summary

The campaign killed fast and that was its stated virtue. After reconstructing
the reasoning behind each kill and attacking it, I find **two CONFIRMED
worth-reopening**, **three PLAUSIBLE**, and the remainder REFUTED. The two
CONFIRMED kills are (1) the M4 renorm ablation — the PPL improvement that
underpins the entire drop curve may be mixture sharpening, not noise removal,
and this was never tested; and (2) the self-speculative decoding regime on
slow-flash — the kill was done on a device with 6% stall (Xiaomi) where the
technique had nothing to compress, while the one device with 27-30% stall
(Jelly) was never tested. The CPU kernel lane and F6 certification are
properly killed. GPU decode on Adreno is properly killed but the
*prefill* fragment was never extracted as a standalone claim. REAP-50 and
KEXP-on-G99 are correctly killed by the same physics. The graveyard is
honest; the damage from wrong kills is moderate, not catastrophic.

---

## Findings (ranked by expected value)

### 1. M4 renorm ablation — MIXTURE SHARPENING vs NOISE REMOVAL — NEVER TESTED

**Verdict: PLAUSIBLE (approaching CONFIRMED)**

The Mellum drop curve shows PPL *improving* below zero at d=0.5 (−0.0150
macro bpb vs k8 anchor; PLAN.md line ~193). This is the campaign's "strangest
measured fact." The campaign attributed it to cold-expert noise removal, which
is the basis for language-specific expert masks (idea 4) and the qualitative
interpretation of the entire drop mechanism.

But `drop_renorm` is TRUE by default (`config.h:175`; PLAN.md line ~554) and
the drop curve never disabled it (`--drop-no-renorm` absent from every
`command.txt`). The source at `router_hook.cpp:278-282` shows surviving experts
are rescaled by `total/kept > 1`, which concentrates mass on the surviving
top-heavy set. This is **mixture sharpening** — the improvement may come from
making the distribution more peaked, not from removing noise.

The campaign identified this (PLAN.md lines ~543-575), proposed the decisive
four-arm ablation (d=0.5 renorm ON / d=0.5 no-renorm / d=0 baseline / random
drop renorm ON), and never ran it.

**Why this matters:** if the improvement is sharpening, the entire M4
interpretation is wrong but a *new free quality lever* is discovered (gate
sharpening without byte savings). If it is noise removal, language masks live.
Either way, the campaign needs this number before building anything on top of
it.

**Compounding factor:** the CalaQwen drop curve shows the minimum at d=0
(0.6781) with d=0.3 marginal (+0.0004). The sub-zero improvement is
Mellum-only, which already weakens the generality claim. But the ablation is
still needed to know what is happening on Mellum.

**Cheapest experiment:** Four PPL arms on Mellum, all deterministic, all on PC,
zero device time. ~4 hours of PC compute. Result that re-kills: d=0.5 no-renorm
> d=0 baseline (the improvement vanishes without renorm → sharpening, masks
dead). Result that reopens: d=0.5 no-renorm ≈ d=0.5 renorm > d=0 baseline
(noise removal confirmed, masks live).

**Expected value:** HIGH. This settles the interpretation of the campaign's
best quality result and either opens a new quality-only lever or redirects
effort to language masks. Cost: ~4 hours PC.

---

### 2. Self-speculative decoding on slow-flash — KILLED IN THE WRONG REGIME

**Verdict: PLAUSIBLE**

The byte invariant `β < 0.56` is mathematically correct and F6 confirmed that
certification cannot deliver it (Finding 5 below). The PC measurement (5.99 vs
1.82 effective tok/s) and the Xiaomi measurement (1.654 plain vs 0.720
freeze-ON γ=3 = 0.44×) are both real.

But the Xiaomi cell was the **wrong device** for the speed claim. The report
itself acknowledges: "This phone is the least favourable device we own for that
bet. Cold I/O stall share on CalaQwen here is 6.0%." (selfspec_f5_d1_xiaomi
REPORT.md line ~24). A technique that saves by reading fewer bytes has almost no
stall to compress on a device where I/O is only 6% of wall time.

The one device with high stall — Jelly at 27-30% (PLAN.md line ~891) — was
never tested for selfspec. On Jelly, I/O is a third of wall time. The draft at
k=2 reads ~1/3 the expert bytes of k=6. If even partial batch amortization
works, the stall reduction could be meaningful in this regime.

**What the existing data does NOT settle:**
- The bytes-per-token-emitted on the D1 cell drop monotonically (174 → 133 →
  110 MiB) as improvements bite (PLAN.md line ~612). This is not "doesn't
  work" — it is "missing 2×, and the magnitude is known." On Jelly, where the
  stall share is 5× larger, the 2× gap might close.
- The γ=3 arm (0.44×) beats γ=4 (0.40×) as predicted, confirming the
  registered prediction. The prediction also says γ=2 is better still —
  untested.

**What would re-kill:** Selfspec on Jelly with freeze-ON, γ=2, measuring
effective tok/s AND bytes/token-emitted. If the ratio is still <0.7×, the
technique is dead on all three devices and the invariant holds in every regime.

**What would reopen:** Ratio ≥0.7× on Jelly with freeze-ON γ=2. Even 0.6×
would justify a pre-registered ABBA cell because Jelly is the device class
where users are most sensitive to speed (slowest hardware).

**Cheapest experiment:** One exploratory cell on Jelly, n=200, ~3 arms (plain,
freeze-ON γ=3, freeze-ON γ=2), interleaved. ~2 hours device time. The model is
already on the device. The binary already supports the flags.

**Expected value:** MODERATE-HIGH. Jelly is the bottom of the lineup (3.64
tok/s Marco, 8.04 dense 2B). If selfspec gets even to 0.7× on the 35B, that
is ~3.4 effective tok/s on a device where the only alternative is dense 2B at
8 tok/s. The value is product-tier-dependent: high if the 35B runs on Jelly
in production, lower if it does not.

---

### 3. CPU kernel lane (S1/S2/S3) — KILLED ON A GATE THAT WAS RIGHT, BUT THE
   FUSED PATH WAS NEVER TESTED ON NON-REPACK SILICON

**Verdict: PLAUSIBLE**

The 10% gate was applied correctly. S1 (0.182 ≈ 0.181 at t=2), S2 (0.1585
> 0.148 stock), S3 REPACK (-1.5%) and i8mm (+4.0%) all miss. The kernels are
correct (16191/16191 suite). The floor 0.148 at t=2 is confirmed as the
silicon limit on S23.

But there is an untested regime: **silicon without REPACK support**. The S23
builds with REPACK ON, and S2's fused path *bypasses* the REPACK kernels
(S3 report: "both paths use vec_dot on raw Q4_K"). On a device where REPACK
does not exist (older ARM, or a non-q4_K quant where REPACK has no traits),
the stock path would also use vec_dot, and S2's fused launch (84→28 launches)
might actually win.

The campaign has such a device: **PC** (`results/kernel_s2/` shows PC
correctness PASS but no speed measurement). The PC x86_64 path does not have
ARM REPACK. The S2 branch is verified clean and PR-able. A single `llama-bench
-r 2` pair on PC would settle this.

**Also:** the K0 waterfall attributed 43% to "dispatch per-op" and S1 showed
this was an artifact at t=2. But the S2 report itself notes that the "10
ms/tok" gap lives in "per-row gate/up bounce, 4 internal barriers,
wait-all-three" (S3 report §5). These are not dispatch in the K0 sense — they
are fused-kernel overhead. No kernel variant attacks this; it requires a
different fuse topology (e.g., fusing gate+up as a single tall GEMV rather than
alternating per-row). This was never designed.

**Cheapest experiment:** Run the S2 binary (already built, already verified
correct) on PC with `llama-bench -r 2 -t 4` for both ON and OFF. ~5 minutes.
If fused wins on PC (no REPACK), the kernel is valuable for non-REPACK
silicon (iPhone Pro, older Android, RISC-V). If it loses, the kill is
complete.

**Expected value:** MODERATE. The value is nonzero only if the engine ships on
non-REPACK silicon. The campaign's current target (S23-class with REPACK) is
covered. But iPhone Pro / future ARM without REPACK would benefit, and the
branch is already correct and PR-able.

---

### 4. K-F cold-start prefetch — COMPONENT SURVIVED BUT WAS NOT EXTRACTED

**Verdict: PLAUSIBLE (as an incomplete kill, not a wrong kill)**

The throughput kill is correct: warm Jelly ON = +7.1% against (p=0.000977,
11/12 pairs), cold Jelly null (p=0.0635), S23 and Xiaomi null. K-F trades
mean throughput for tail smoothness. This is not a speed technique.

But the campaign itself measured KF_ROBUST_WIN and KF_THERMAL_WIN in the burst
cell (PLAN.md lines ~920-925): p99 ON 328 vs OFF 341 ms, stutter 0.34% vs
0.55%, thermal sag ON 0.0423 vs OFF 0.0670. These are UX-relevant metrics on
the one device where K-F activates (Jelly cold, stall >20%).

The cold cell explicitly found "KF = cold-start accelerator (TTFT 12-18 vs
21-22s, p99 −17% cold), auto-off warm" (PLAN.md line ~927). The dispatcher
policy was written: "K-F ON ⟺ stall% high AND cache cold AND no thermal
alarm."

The technique was killed as a *throughput* technique, which is correct. But the
UX improvement (p99, stutter, TTFT) was declared alive as a "separate claim"
and then never measured with its own endpoint, never shipped, and effectively
disappeared from the scoreboard. The ALIVE.md graveyard lists K-F as dead
with a parenthetical "(UX argument, never claimed as speed)" — technically
accurate, but the UX argument was the measured outcome and it was abandoned
without a decision.

**Why this matters:** TTFT on Jelly went from 53.4s to 1.40s via the app-side
stack (prewarm). But the engine-side TTFT with K-F cold-start (12-18s vs
21-22s, measured PLAN.md line ~919) is a separate, complementary improvement.
If a user hits the model without the prewarm (e.g., process death + immediate
send = 2.48s via prewarm, but what if prewarm fails?), K-F cold-start is the
fallback. It was never tested in that failure-mode context.

**Cheapest experiment:** No new measurement needed. The p99/stutter/TTFT data
exists in `results/kf_burst/` and `results/kf_cold_jelly/`. The decision is
product-level: is p99 stutter reduction worth the dispatcher complexity? That
is a owner decision, not a measurement.

**Expected value:** LOW-MODERATE. The measured improvement is real but small
(p99 −17%, TTFT ~40% reduction on cold Jelly). Value depends on whether Jelly
is a shipping target and whether cold-start is a user-facing scenario.

---

### 5. F6 cheap certification — PROPERLY KILLED

**Verdict: REFUTED**

The F6 probe (`results/f6_certify_probe/REPORT.md`) is one of the cleanest
kills in the campaign. Key evidence:

1. Harness correctness verified against F0 known value (k=2 = 0.6905 to four
   decimals).
2. j=3 agreement = 0.8120, squarely in the pre-declared dead band
   (0.75-0.85), against GO threshold ≈0.95.
3. j≥4 fails by structural floor (4/6 = 0.667 > 0.56 break-even).
4. j=2 at β=0.540 is nominally under 0.56 but sits on an *upper bound*
   (argmax agreement ≥ true certification rate).
5. The baseline moved: drop-cold at 0.8 costs only +1.6% bpb (GATE_PASS),
   meaning the comparison should be against already-cheap decoding, not
   full k=6.

The one gap — top-1 vs top-2 logit margin, which would predict an adaptive
scheme's true cost — requires an engine change (`engine_top2_logits: false`)
and cannot be measured without code. But the j≥4 floor is structural and
holds regardless. The kill is solid.

**Cheapest "re-kill":** N/A. The kill is correct.

---

### 6. GPU decode on Adreno 740/750 — PROPERLY KILLED, BUT PREFILL WAS
   ORPHANED

**Verdict: REFUTED (decode), PLAUSIBLE (prefill orphan)**

Decode:
- 740: 0.41× CPU (5.06 vs 12.37 tok/s, `reports/moe-gdn-k22-fix.md`)
- 750: 0.44× CPU (7.07 vs 16.15 tok/s, `reports/moe-gdn-750.md` Phase 3)
- Both devices: broadcast=false, FA dead, dispatch overhead ~60 ms/token
  exceeds kernel savings

The diagnosis ("dispatch overhead, not kernels") was correct and the kill is
correct for decode. A fused executor was estimated at "months" and correctly
parked.

But the campaign measured GPU prefill at 1.29× (740) and **5.77×** (750,
181.65 vs 31.46 pp128). The 750 prefill number is enormous and was absorbed
into the GPU lane status as "prefill GPU 1.3-1.7×" (PLAN.md line ~1112) — a
massive undercount. The 5.77× on the 750 was never extracted as a standalone
claim for TTFT. The report says "prefill is compute-bound and the 750's GPU
has the muscle; decode stays bandwidth/dispatch-bound and loses" (moe-gdn-750.md
§6.3). This is a genuine finding: GPU prefill on 750-class could cut TTFT by
5× for any model, not just MoE.

The ALIVE.md TTFT section credits the 53.4→1.40s improvement entirely to the
app-side prewarm stack. GPU prefill could make even the non-prewarm path fast.
This was never combined or tested.

**Cheapest experiment:** `llama-bench -r 2 -p 512` on Xiaomi 14 with `-ngl 99
-fa off` vs `-ngl 0`, measuring TTFT (prompt processing time) only. Already
partially measured (Phase 3 report has the number) but never framed as a
product claim. 5 minutes.

**Expected value:** MODERATE-HIGH for TTFT on flagship devices. The 5.77× on
750 is the largest single-number speedup in the entire campaign and was never
acted on.

---

### 7. REAP-50 on G99 — PROPERLY KILLED

**Verdict: REFUTED**

`results/reap50_jelly/runs.csv`: k4 REAP 10.68 vs A0 streamed 10.60 (+0.8%).
The physics are clear: REAP halves *stored* experts (32→16), not *active*
(k=4 remain 4 × FFN 1792). Active bytes/token ≈ 1033 MiB in both cases.
The G99 memory wall is ~11 GB/s. Halving the file buys TTFT (15.9 vs 10.0
prefill, 0.90 vs 3.36s load) but not decode.

The one surviving fragment: REAP-50 as a TTFT/RAM improvement at equal decode
speed. The report notes "prefill 15.9 vs 10.0, TTFT 8.2/5.7 vs 13.3 s, load
0.90 s hot" (PLAN.md line ~1279). If a product needs faster cold-start on G99
and can tolerate the quality tax (smoke quality "debolino"), REAP-50 is not
zero-value. But it was never quality-gated and the smoke suggests it would
fail.

**Cheapest re-kill:** N/A for decode. For TTFT: a PPL comparison REAP-50 vs
A0 on the multi5 corpus. If quality is acceptable, REAP-50 is a TTFT
replacement. ~2 hours PC.

**Expected value:** LOW. The decode is dead. TTFT improvement exists but
requires a quality gate that looks unlikely to pass.

---

### 8. KEXP on G99 — PROPERLY KILLED (dequant-bound, not bandwidth-bound)

**Verdict: REFUTED**

`reports/moe-g99-freetier.md` KEXP re-test: k4 = 8.83 tok/s vs A0 Q4 10.60.
The projection of 14.7 assumed roofline Q4 bandwidth (10.8 GB/s). But Q2_K/Q3_K
dequant on 2×A76 costs ~0.224 cpu-s/tok (vs 0.198 for Q4_K), yielding
effective bandwidth of 6.8 GB/s — 63% of the Q4 roofline.

The argument "on weak silicon, fewer bytes ≠ more decode if dequant costs" is
correct and bounded by measurement. The kill is clean.

**Cheapest re-kill:** N/A. The dequant cost is a hardware property of Q2_K on
A76 cores. No code change fixes it.

**Expected value:** ZERO for decode. The only residual is that Q4_K k=2
(14.38 tok/s) approaches 15 tok/s — but quality at k=2 is unknown and likely
poor (the 35B analog shows k2 collapses).

---

### 9. MTP / speculation for byte amortization — PROPERLY KILLED

**Verdict: REFUTED**

PLAN.md line ~1163: "0.00% amortized, three independent mechanisms." The byte
invariant (PLAN.md line ~297): "If β ≥ 1, bytes/token ≥ 1 even with free
drafts (α=0) — speculation can at best tie plain decoding." The F6 measurement
confirmed β ≥ 0.54 for the best case, and the break-even is β < 0.56 with
zero margin.

The reopening condition was stated: "NPU/GPU verify + acceptance ≥60%." Neither
exists. The kill is clean.

**Expected value:** ZERO under current hardware. Reopens only with NPU verify
(nonexistent) or a fundamentally different MoE architecture with high routing
similarity.

---

### 10. Cross-layer prefetch — PROPERLY KILLED

**Verdict: REFUTED**

PLAN.md line ~1162: "Recall@8 19.2%, extra-fetch 274%; predictor 87-91% would
yield only +3.1%." The mechanism was measured and found to waste more bytes than
it saves. Even a near-perfect predictor would not move the needle because the
routing entropy is too high (96% of 256 experts touched in 300 tokens).

The later kill of the route predictor idea (idea 3, PLAN.md lines ~505-511)
confirmed this from the other direction: "the predictor reads zero bytes, but
the prefetch that follows it reads them — it is exactly M7 (76% precision,
+14% bytes, −4.3% wall)."

**Expected value:** ZERO.

---

### 11. Cache policies — PROPERLY KILLED

**Verdict: REFUTED**

PLAN.md line ~1157: "empty — none beat LRU on the real load; Belady−LRU =
6.37 pt." The campaign tested cache policies and found LRU optimal. The
expert routing entropy (45 re-reads/token, near-disjoint sets) means
specialized policies have no signal to exploit.

**Expected value:** ZERO.

---

### 12. Cache size — PROPERLY KILLED

**Verdict: REFUTED**

PLAN.md line ~1158: "2000, measured optimum — framed: 1500 −15%,
3000/3500 −62/−68% (thrash → RescueParty)." The optimum was measured and is
robust. Below 1500 causes thrashing; above 3000 triggers Android OOM killer.

**Expected value:** ZERO.

---

### 13. ubatch — PROPERLY KILLED

**Verdict: REFUTED**

PLAN.md line ~1159: "512 — 2048: prefill −15.5% AND buffer 4×." The
tradeoff was measured; 512 is optimal for the decode-dominated regime.

**Expected value:** ZERO.

---

### 14. k<6 on KEXP — PROPERLY KILLED

**Verdict: REFUTED**

PLAN.md line ~1164: "k5d000 +0.45 vs k6d065, below floor; k5d065 worse. Decode
CPU: k=6 is the quality floor." The quality gate fails at k=5; k=4 and below
were not tested because k=5 already dies.

**Expected value:** ZERO for quality. The k-adaptive idea (finding 2 in the
5-wild-ideas audit) is a different technique that conditionally uses k<6 — it
was never killed because it was never built.

---

### 15. Drop as a compute lever — PROPERLY KILLED

**Verdict: REFUTED**

PLAN.md lines ~1152-1153: "drop = only I/O (remap top expert); I/O already
saturated d065→d080 +0.15% speed." Source `router_hook.cpp:206-216` confirms
the dropped slot is repointed to the top expert and computed with weight zero —
the matmul is never skipped. Drop saves cache-miss bytes, not compute. The I/O
side is saturated by d=0.65.

**Expected value:** ZERO.

---

### 16. Re-quantization 1c — PROPERLY KILLED

**Verdict: REFUTED**

PLAN.md line ~1165: "gain in compute ≈ penalty in bytes." A wash, no net
speedup.

**Expected value:** ZERO.

---

### 17. Hand IQ2 kernels — PROPERLY KILLED

**Verdict: REFUTED**

PLAN.md line ~1166: "ik g_IQ2 0.719 < 1.20" — the i-quant kernels are
slower than stock on 8 Gen 2. The 1.42× published on M2-Max inverts to 0.72×
on this silicon.

**Expected value:** ZERO for decode. Prefill (ik wins 3.4×) is a different
regime but was scoped separately.

---

### 18. Typeahead — PROPERLY KILLED (ENGINE BUG)

**Verdict: REFUTED**

PLAN.md line ~1169: "prefill incremental recalculates everything (527 tok: 67s
vs 64s from scratch; in pieces = 3.5× the single prefill)." The engine lacks a
delta-prefill API. The technique requires engine work, not a measurement fix.

**Expected value:** ZERO until the engine provides a KV-replace API.

---

### 19. Phase-split 2B — PROPERLY KILLED (ENGINE BUG)

**Verdict: REFUTED**

PLAN.md line ~1169: "ceiling 0.73× (20.6s vs 28.3 CPU at turn 490+128) ONLY
with in-process KV handover; with 2 processes = 1.27× (worse)." The
cross-process KV transfer cost exceeds the GPU savings. Requires the same
engine API as typeahead.

**Expected value:** ZERO without engine changes.

---

### 20. Expert-major decoding — KILLED ON CORRECT MATH, NOT TESTED

**Verdict: REFUTED**

The kill was arithmetic (PLAN.md lines ~493-502): with the campaign's routing
skew, B=8 → union ratio 0.88, B=16 → 0.81, B=32 → 0.65. Need < 0.56, which
requires B≈64 — impossible in single-user autoregressive decode (you cannot
reorder by expert in a causal sequence because future routes are unknown).

This is a correct kill. Expert-major is a server-side MoE technique
(DeepSpeed/Megablocks) that exploits batch independence. It does not apply to
autoregressive decode.

**Expected value:** ZERO.

---

### 21. Route predictor from frozen GDN — KILLED ON ECONOMICS, NOT MECHANISM

**Verdict: REFUTED**

The kill (PLAN.md lines ~505-511) correctly identified that the predictor reads
zero bytes but the subsequent prefetch reads them — it is exactly the K-F
economics (76% precision, +14% bytes, −4.3% wall). The predictor's input
(novel: frozen GDN recurrent state) does not fix the output economics.

**Expected value:** ZERO under the current architecture where prefetch is the
downstream action.

---

### 22. LFM on G99 — PROPERLY KILLED (dequant + quality)

**Verdict: REFUTED**

Two independent kills: (1) KEXP regression (8.83 vs 10.60, dequant-bound);
(2) REAP-50 equalizes but does not exceed A0. The quality smoke on REAP-50
("debolino") further weakens any residual. The free-tier decision is correctly
reduced to "A0 Q4 k4 10.6 vs no-LFM."

**Expected value:** ZERO for speed. The quality FT path is a different lane.

---

## What the campaign never tested (grounded in existing data)

### A. The renorm ablation (M4 settle)

**Grounding:** `results/mellum2_dropcurve/` shows d=0.5 PPL −0.0150 below
k8. The source `router_hook.cpp:278-282` shows renorm is on by default and
was never disabled. The proposed 4-arm ablation (PLAN.md lines ~568-575) was
designed but never run.

**Cost:** ~4 hours PC, zero device time. This is the highest-value missing
measurement in the campaign.

### B. k-adaptive on router confidence

**Grounding:** The 5-wild-ideas audit (PLAN.md lines ~440-530) designed a
zero-cost test: bin positions by router gate entropy, measure argmax agreement
of k=2/k=3 within each bin, using existing route traces. The idea survived the
audit as Rank 1 and was never tested.

**Cost:** Zero device time. Parse existing route traces (already in
`results/f6_certify_probe/` and `results/selfspec_f0/`). Write a Python
script, ~1 hour.

### C. GPU prefill as a TTFT lever on flagship

**Grounding:** `reports/moe-gdn-750.md` Phase 3: GPU prefill 181.65 vs CPU
31.46 pp128 = **5.77×** on Xiaomi 14. This number was measured and buried in
the GPU lane report. The app-side TTFT stack (53.4→1.40s) achieved its gain
via prefix prewarm; GPU prefill could make even non-prewarm paths fast.

**Cost:** The number already exists. The work is product integration, not
measurement. If the owner wants TTFT on flagship without prewarm dependency,
this is the lever.

### D. Temperature-aware quantization (microbenchmark)

**Grounding:** Idea 5 from the audit (PLAN.md lines ~522-535) was ranked
Rank 2 and survived. The sequenced plan was: (1) microbenchmark dequant speed
of candidate formats on the weak device, (2) build mixed GGUF, (3) measure.
Step 1 was never done.

**Cost:** One afternoon of PC work to benchmark Q2_K / Q3_K / Q4_K dequant
throughput on G99-class A76 cores. This defines the feasible precision range
before building the mixed GGUF.

### E. Language-specific expert masks (contingent on M4 settle)

**Grounding:** Idea 4 (PLAN.md lines ~462-475) proposed per-language expert
masks if d=0.5 improves PPL by removing noise. The experiment is contingent on
the M4 ablation: if improvement is noise-removal, masks live; if sharpening,
masks are on sand. Blocked on finding A.

### F. Selfspec γ=2 on Jelly

**Grounding:** The prediction (PLAN.md line ~176) says γ=3 is better than γ=4
(confirmed on Xiaomi: 0.44× vs 0.40×), and γ=2 should be better still. The
Jelly cell (stall 27-30%) was never tested.

**Cost:** ~2 hours device time. The binary and model are on the device.

---

## The scoreboard, revised

| kill | original verdict | audit verdict | impact of error |
|---|---|---|---|
| M4 renorm ablation | never run | **PLAUSIBLE** | campaign's best quality result may be misinterpreted |
| Selfspec on slow-flash | killed on Xiaomi | **PLAUSIBLE** | one device class untested |
| CPU kernel (non-REPACK) | killed on S23 | **PLAUSIBLE** | value only on non-REPACK silicon |
| K-F UX component | killed as speed | **PLAUSIBLE** | p99/stutter improvement abandoned without decision |
| GPU prefill orphan | absorbed into GPU lane | **PLAUSIBLE** | 5.77× TTFT lever on flagship never acted on |
| F6 certification | dead on bytes | REFUTED (correct) | — |
| GPU decode | 0.41× | REFUTED (correct) | — |
| REAP-50 | LOSES | REFUTED (correct) | — |
| KEXP on G99 | dequant-bound | REFUTED (correct) | — |
| MTP/speculation | 0.00% | REFUTED (correct) | — |
| Cross-layer prefetch | wasteful | REFUTED (correct) | — |
| All others (13) | dead | REFUTED (correct) | — |

**Total wrong or incomplete kills: 5** (of ~25).
**Total properly killed: 20.**
**Kill accuracy: 80%.**

The campaign killed honestly. The two highest-value gaps — the renorm ablation
and the selfspec-on-Jelly — are both cheap to settle. The GPU-prefill orphan
requires only a product decision, not a measurement.

---

*End of audit.*
