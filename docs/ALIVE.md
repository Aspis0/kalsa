# ALIVE — what is still standing, 2026-08-18

> ⚠️ **This file is a DERIVATIVE. `PLAN.md` is the main document and is
> authoritative** — it is updated at every verdict, kill, measurement and
> correction, as it happens. This page is refreshed **after a day's work**,
> summarising from the PLAN, and exists only to save the reader from 1800+
> lines. Nothing is written here that is not already in the PLAN, and nothing
> is decided from here: if the two ever disagree, the PLAN is right.

One page. Everything else in this repo is either shipped, dead, or history.
The campaign has produced roughly 30 tested techniques; **4 are alive**.

---

## 1. SHIPPED — in production, with a p-value

### La Ricetta — *name pending owner*

**⚠️ There are TWO configs and they are not the same one. An earlier version of
this page merged them and attached the p-values to the wrong one; corrected
2026-08-16 after a hostile audit.**

**(a) The A/B-VALIDATED config — this is what carries the p-values:**

```
-t 2 --n-expert-used 6 --drop-cold-experts 1.0
   (+ --moe-stream --cache-mb 2000 --dense-weights anon --overlap
      --io-threads 4 --ubatch 512 -c 4096 --temp 0 --chatml --no-think)
```

Verified in `run_ship_ab_s23.sh:421` and `run_ship_ab_xiaomi.sh:531` — both cells
tested exactly this as arm B, against arm A = stock `-t 4 --n-expert-used 8`.

| device / session | model | effect | test |
|---|---|---|---|
| S23, **`device/` session** (canonical) | Mellum2 | stock 0.2585 → **0.1480 s/tok, −42.7%** (3.87 → 6.76 tok/s) | Wilcoxon W=0, **p=0.000488**, 12/12 pairs, exact floor |
| S23, `screenon/` session (exploratory, protocol-deviant) | Mellum2 | 0.2665 → 0.1565, **−41.3%** | W=0, p=0.000488, 12/12 — independent second sample |
| Xiaomi 14 | Mellum2 | median **−14.5%**, HL −0.05625 s/tok | W=0, **p=0.000977**, 11 effective pairs (one exact tie) |

Both S23 sessions are named explicitly because they give different point
estimates (−42.7% vs −41.3%) and an earlier version of this page quoted the first
without saying which. The p-value is identical and at the exact floor either way.

**(b) The CAMPAIGN config for CalaQwen — changed 2026-08-18, `drop 0.65` retired:**

```
-t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap
--io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 1.0 --drop-no-renorm
```

**Why the change, and it is not a preference — `drop 0.65` was dominated: it cost
quality *and* time.** Measured on CalaQwen, on the shipped model and config:

| config | quality vs d=0.0 | speed vs d=0.0 (Jelly) | bytes read |
|---|---|---|---|
| d=0.0 | — | — | — |
| ~~d=0.65 (old default)~~ | +0.91 % | **+5.8 % SLOWER** | −27.3 % |
| ~~d=0.65 + no-renorm~~ | +0.20 % | ~+5.8 % slower | −27.3 % |
| **d=1.0 + `--drop-no-renorm`** | **+1.18 %** | **−12.9 %** | **−71.8 %** |

`d=0.65` was slower than not dropping at all in **all three rounds** (+10.9 / +5.2
/ +1.2 %) — it never bought speed. Only d=1.0 does, and `--drop-no-renorm` removes
70 % of its quality cost (+3.96 % → +1.18 %) **without changing which experts are
dropped, the bytes read, or the speed** (+1.1 % and −1.3 % across comparable
rounds — the sign flips, so they are equivalent).

Against CalaQwen's **real** k8d0 anchor (0.6660114, measured 2026-08-17) the new
default sits at **+0.0201 — 50 % of the `MACRO_PASS = 0.04` budget**. With the
renorm default left on, d=1.0 sat at +0.0389, **97 % of the budget: it passed by
0.0011**. The flag is what makes d=1.0 shippable rather than borderline.

Answer quality was verified, not assumed (`results/answer_quality_calaqwen`,
`results/answer_sanity_calaqwen`): checkable instruction constraints honoured, the
generated Python function passes **8/8 executed tests**, Italian prose with no
repetition collapse, and **15/16** on the common-sense battery — where the single
miss belongs to the k=8 *reference*, not to the candidate.

Its evidence is still a **PPL quality gate plus device speed**, not a paired
Wilcoxon test: **do not quote the −42.7 % / −14.5 % p-values in support of this
config** — those belong to Mellum2's own config (a) on Q4_K_M.

Both pre-registered A/B cells were recomputed from raw CSVs in a hostile audit
(2026-08-16) and the confirmatory arithmetic held exactly: medians, W, exact
p-floors, Hodges-Lehmann shifts and the 11-vs-12 effective-N explanation all
confirmed. Cohen's dz = 12.6 (S23) and 2.13 (Xiaomi) — large enough that the
device's ±50% run-to-run variance cannot reverse either.

Pre-registered on both devices. The Xiaomi PREREG **predicted a smaller effect
there and was right** — the model predicted magnitude, not just sign.

Side axes: sustained −38% ✅ · temp parity ✅ · TTFT parity ✅ · J/token +11.8% ❌
declared — **but reversed for interactive use**: screen-on, the fast config saves
22 s of display per response (4–13 J) against +2.6 J of compute, so it is a net
battery *saving* with the screen on. Policy: gate on thermals and screen-off
tasks, never on battery level in chat.

Bonus, not sought: the certified config is **robust to real RAM pressure** —
stock collapses 60–100× with dirty zram, reproduced twice.

### TTFT stack (app side) — merged on ai-chat main

**53.4 s → 1.40 s** (Jelly, cold + 90 s + send). Prewarm of the static system
prefix at boot + P0 memguard + P1 idle-zombie fix. Survives process death
(swipe-kill → relaunch → send = 2.48 s), which the keepalive never would have.

### Lineup

**CalaQwen** (Qwen3.6-35B-A3B KEXP) and **Marco1c** (Marco-Mini-Instruct-KEXP)
shipped on all three phones.

---

## 2. ALIVE AND PROMISING — the one lever still growing

### Expert skipping (`--drop-cold-experts`) as a standalone fast mode

The quality curve on CalaQwen is **complete, six points**, including the shipped
default measured at last rather than interpolated:

| drop | macro bpb (CalaQwen) | cost vs d0 |
|---|---|---|
| 0.0 | 0.6780748 | — |
| **0.3** | 0.6784793 | **+0.06 %** |
| 0.5 | 0.6802864 | +0.33 % |
| 0.65 | 0.6842309 | +0.91 % — *former default, retired 2026-08-18* |
| 0.8 | 0.6889289 | +1.60 % |
| 1.0 | 0.7049320 | +3.96 % |

**There is no "gate" column any more, and that is a correction.** An earlier
version of this page said "all GATE_PASS". The curve's `gate_vs_k8d0` column is
vacuous for CalaQwen: `GATE_DIR` is hardcoded to `results/mellum2_ppl_gate`
(`run_mellum2_dropcurve.py:31`), so the k8 anchor is **Mellum2-12B** (macro
1.020819). Reusing the script for CalaQwen left the anchor unchanged, so
`d_macro_vs_k8d0 ≈ −0.34` against a `MACRO_PASS = 0.04` threshold — every arm
passes by 0.38 bpb **because CalaQwen is a better model than Mellum2**, which says
nothing about the drop. The orchestrator's `DROPCURVE_FLAT(spread=0.0269,
noise=0.3537)` verdict is the same artefact: that "noise floor" is the
CalaQwen-minus-Mellum2 model gap, not run-to-run noise, which makes
"everything is within noise" a tautology.

What survives is the part that matters: `macro_bpb` and the **vs d0** column are
same model, same pinned binary, same corpus, and decode PPL is deterministic
(noise measured at 1e-6 on the Mellum2 campaign). So the real curve is **monotone
increasing, small but not flat and not free**.

**✅ The real anchor now exists** (`results/calaqwen_gate_anchor`, measured
2026-08-17): **CalaQwen k=8, drop 0.0 → macro bpb 0.6660114**. Predicted in advance
to land in 0.66–0.675, and it did. Scored against it, with the campaign's own
`MACRO_PASS = 0.04` budget:

| drop | vs k8d0 | share of budget |
|---|---|---|
| 0.00 | +0.0121 | 30 % |
| 0.65 | +0.0182 | 46 % |
| **1.00, renorm ON** | **+0.0389** | **97 % — passes by 0.0011** |
| **1.00 + `--drop-no-renorm`** | **+0.0201** | **50 %** |

Two things follow. Going from stock k=8 to k=6 costs **+0.0121 (1.81 %)** — the
step we already ship and consider fine, and a useful yardstick for every other
number here. And `d=1.0` on the renorm default **all but exhausts the quality
budget**: the flag is not a refinement, it is what separates "shippable" from
"one step from failing".

And on Mellum the curve goes **below the anchor**: d=0.5 measures macro bpb
**1.0058 against the k8 anchor's 1.0208**, i.e. a delta of **−0.0150** — skipping
cold experts *improves* multilingual perplexity, with run-to-run noise at 1e-6.
("Below zero" refers to the delta, not to an absolute negative bpb.)

**✅ The renormalisation question is answered, and the answer is the opposite of
what was suspected (M4, 2026-08-17, `results/m4_renorm_ablation/`).**

Two auditors flagged that `drop_renorm` is TRUE by default (`config.h:175`), so
`router_hook.cpp:278-282` rescales survivors by `total/kept > 1`, and suspected
the drop's good quality numbers came from that **sharpening** rather than from
removing noise. Measured, the renormalisation is not helping — **it is doing most
of the damage**:

| | renorm ON (default) | renorm OFF | Δ |
|---|---|---|---|
| **d=0.5** | 0.6802864 (+0.33 % vs d0) | 0.6791113 (+0.15 %) | −0.17 % |
| **d=1.0** | 0.7049320 (**+3.96 %**) | **0.6860923 (+1.18 %)** | **−2.67 %** |

**Roughly 70 % of the quality cost of aggressive dropping is the default, not the
drop.** The harm scales with how much is dropped (16× larger at d=1.0 than at
d=0.5) — predicted in advance from the mechanism, then confirmed. All five
languages moved the same way in both arms. With renorm ON the damage is also
lopsided (en +8.12 % vs zh +3.12 %); with it off it is uniform and small
(+0.91 % … +1.58 %).

The code comment that justifies the default fears "a systematic shrink the model
never sees in training". Empirically **the shrink is ~4× less harmful than the
rescale** at d=1.0: dropped experts carry little weight, so the shrink is tiny,
while `total/kept` amplifies the top experts past their trained magnitude.

**✅ The random-drop arm now EXISTS and it answered the question — the coldness
matters (2026-08-18, `results/droppolicy_quality_marco`).** An earlier version of
this page said the arm was impossible ("no such flag exists"). A `--drop-policy
{cold|weight|random}` flag was built on an isolated binary and the arm was run in
its own self-contained cell, so the identity pin of the campaign arms is untouched.

Marco-Mini KEXP, k=6, cache 2000, all arms on the **same** binary
(`build-pc-droppolicy`, sha `59f2762e54ed56af`). `random` drops the **same count**
per token, chosen uniformly among non-best experts:

| lang | d=0.0 | cold d=1.0 | random d=1.0 | cold | random |
|---|---|---|---|---|---|
| en | 0.640213 | 0.706213 | 0.745753 | +10.31 % | +16.49 % |
| es | 0.705789 | 0.782259 | 0.837969 | +10.83 % | +18.73 % |
| fr | 0.756660 | 0.861962 | 0.922563 | +13.92 % | +21.93 % |
| it | 0.785352 | 0.879999 | 0.954762 | +12.05 % | +21.57 % |
| zh | 0.944656 | 1.077903 | 1.128981 | +14.11 % | +19.51 % |
| **MACRO** | **0.766534** | **0.861667** | **0.918006** | **+12.41 %** | **+19.76 %** |

**Dropping at random costs +6.54 % bpb more than dropping the cold ones
(+0.0563 bpb — larger on its own than the whole `MACRO_PASS = 0.04` budget), and
it goes the same way in all five languages.** The reading was declared before the
numbers: *cold ≪ random ⇒ "select the cold experts" is a real result, the
cache-miss set is meaningfully better to discard than a random one.* That is the
branch that came out. (`random` lost `it`/`zh` to a `pread` failure and they were
re-measured in a separate `--langs it,zh` cell on the same binary; the estimate
from the first three languages was +6.63 %, so the partial held to 0.1 points.)

**So the residency query is not a tax to remove.** It had been proposed for
deletion to recover the arming-tax compute; deleting it would cost 6.6 % of
quality. At equal drop count it picks much better *which* experts fall — plausibly
because an expert absent from the cache is one not used recently, so the cache
doubles as a "recently useful" filter that random selection lacks.

⏳ **One arm still running:** `weight` (weight threshold only, no residency
query) started 17:01 on the same binary, due ~19:00. It is the arm that splits
how much of the win is the *cache* and how much is the *weight*. ⚠️ It is not a
like-for-like comparison — it drops more (63.4 % of slots vs cold's 46.9 % at
d=1.0) because it does not protect resident experts, so worse quality is expected
and does not by itself prove the residency query is what wins.

Note this cell is d=1.0, a mechanism probe: Marco ships **no drop**, and d=1.0
costs it +12.41 % macro bpb, far outside the gate.

**⚠️ The expert cache turned out to be a bigger lever than the drop — but only on
one of the two phones tested, and that is the point.** Sweeping `--cache-mb` on
Marco-Mini (3 rounds per cell, same binary and model on both devices):

| cache | hit at d=0 | Jelly (G99) drop benefit | S23 (SD 8 Gen 2) drop benefit |
|---|---|---|---|
| 1500 | 39.5 % | **−25 %** | ≈ −5 % |
| 2000 | 50.2 % | **−25 %** | ≈ −2 % |
| 4000 | 76.8 % | **+15 % (drop HURTS)** | ≈ −4 % (still helps) |

On the Jelly the absolute best is **cache 4000 with no drop at all** (0.113 s/tok
vs 0.124 for cache 2000 + drop) at zero quality cost. **On the S23 that is false:**
the drop never reaches −25 % and never reverses.

What *does* replicate is the mechanism: hit rate at d=0 is identical on both
phones and byte and drop counts match to the tenth of a MiB — the drop can only
discard cache misses, so a bigger cache leaves less to drop. What does not
replicate is the speed consequence. **So drop-vs-cache is a per-device choice, and
the general rule this was becoming was withdrawn before it shipped.**

🚨 **HOLD ON THE S23 COLUMN (2026-08-18 afternoon). Do not quote it yet.** The
harness that produced those three cells, `run_dropsweep_jelly.sh`, had **neither
the F4.3-bis cpuset gate nor the mandatory `nproc`/`affinity_mask` covariates**
(`runs.schema.md` requires both; the gate lived only in `run_f4.sh`). So *which
CPUs the binary was allowed to use is not recorded and cannot be recovered.* The
S23 result is therefore **unverifiable, not falsified** — and the anomaly it needs
to explain is real: at cache 2000 the S23 measures 0.229 s/tok against the Jelly's
0.166, i.e. a Snapdragon 8 Gen 2 losing to a Helio G99, which no ordinary reading
supports. Termux ssh sessions on that phone were observed in cpuset `/moderate`
(`Cpus_allowed_list: 0-2` — three A510 little cores at 2016 MHz, `nproc` = 3) while
`adb shell` sits in `/` with 0-7.
⚠️ **Two of my own inferences from that observation are withdrawn:** the probe was
taken on an *idle* shell (not the measured PID) and with the phone in
`mWakefulness=Dozing` (not the screen-on campaign posture). Right now the Termux
processes span **three cpusets at once** — `/`, `/background`, `/moderate` — so the
cpuset is per-process and per-state, never a property of the app. **The only
reading that settles it is the one taken from the binary's PID while it runs**,
which is exactly the covariate now added. `termux-wake-lock` was measured **not**
to promote the cpuset, so a wait-and-retry gate is dead time.
➡️ The three S23 cells stay on disk marked unverifiable and must be re-run with the
new harness. **The Jelly cells use the same harness and have the same gap** — and
the shipped default rests on them, so that check comes first when the Jelly is back.

Note the cache lever itself is not a discovery: `BigMoeOnEdge/docs/cache-sizing.md`
already calls it "the dominant throughput lever" and ships `--cache-mb auto`. What
is new is only its interaction with the drop. That doc also warns that
`cache_min_mb = 1500` is a blanket floor, not a per-model one: the real quantity is
`token_demand_MiB` (Marco 136.8, CalaQwen 334.5), and below one token cycle the hit
rate goes to **exactly 0 %**, not "low".

**The throughput + bytes gap is now closed, and it changed the story.** Two device
sweeps (`results/dropsweep_jelly`, Marco-Mini; `results/dropsweep_lfm_jelly`,
LFM2.5) measured time *and* bytes from a verified-cold cache:

- **The drop charges a fixed compute tax just for being armed.** At d=0.3 both
  models dropped ~0.05 % of routed slots (21 of 33600; 9 of 17600) and compute
  still rose 7–21 %. `drop_armed()` (`router_hook.cpp:213-215`) skips the entire
  residency-query and rescale path when the fraction is 0, so **d=0.0 is not
  "no drops" — it is the machinery switched off.**
- **It can only drop what is not cached** (`router_hook.cpp:271` requires
  `route_miss`), so **the cache hit rate caps the drop rate**. Both models obey
  the cap: Marco-Mini 50.2 % hit → 29.7 % of slots dropped at d=1.0; LFM2.5
  93.5 % hit → 3.6 %.
- **Therefore the drop pays only when it saves enough I/O to repay the tax.** On
  Marco-Mini d=1.0 is **−27 % time and −68 % bytes**; on LFM2.5, whose experts fit
  in cache, **every drop level is a net loss** and d=1.0 is the slowest arm.

An earlier explanation of mine — that low drop fractions cost time by disturbing
cache locality — **is withdrawn**: the cost is in compute, not stall, and on
LFM2.5 bytes fall while time rises, which no byte-based mechanism can do.

**Still unmeasured, and not substitutable by analysis:** the shipped model on a
phone. CalaQwen is 13.4 GB and is on no device we can use; the one CalaQwen device
cell (`results/adopt_dropcold`) has no stall/compute breakdown and uses a different
quantisation. **Resolved 2026-08-18:** CalaQwen was measured on the Jelly (12/12
runs) and `0.65` was confirmed dominated — slower than not dropping in all three
rounds — so the shipped default is now `d=1.0 --drop-no-renorm`. What follows was
written while `0.65` still shipped: it sat on a part of the curve that is
**dominated on the one device+model pair where it was measured, and untested on
the model we ship**. That is "not verified", not "wrong".

### GPU prefill on Adreno 750-class — *reopened 2026-08-16, was mis-filed as dead*

A hostile audit found this booked in the graveyard with the GPU-decode lane,
while its own report declared it alive. Measured (`reports/moe-gdn-750.md:201-206`,
Xiaomi 14 / Adreno 750, unplugged, llama-bench r=2, **Qwen3.5-2B dense**, `-t 6`):

| | pp128 (prefill) | tg256 (decode) |
|---|---|---|
| CPU `-ngl 0` | 31.46 | **16.15** |
| GPU `-ngl 99 -fa off` | **181.65** | 7.07 |

**⚠️ The 5.77× is WITHDRAWN — re-verified 2026-08-18 and it was a weak CPU
baseline, not a fake GPU.** Interleaved cells, 5 reps per ordering, unplugged: GPU
pp128 reproduces the book exactly (186.6 vs 181.65) but **CPU pp128 measures 57-62
t/s, not 31.46**. The original CPU samples were internally consistent (31.76/31.16),
so that run was in a genuinely slow state that was never re-measured. **Real ratio at
pp128: 3.18×**, and both orderings agree (3.10× / 3.27×), so it is not a cold-cell
artefact — the first GPU of the night was the *slowest* and the first CPUs the
*fastest*, the opposite of the 740 failure mode.

**But the lever comes out stronger, because the advantage grows with prompt length
and 128 tokens is not the operating point:**

| pp | 2B GPU/CPU | 4B GPU/CPU |
|---|---|---|
| 128 | 3.18× | 4.17× |
| 512 | 3.95× | 5.70× |
| **1024** | **5.35×** | **6.95×** |
| 2048 | 6.69× | 6.46× |

At the app's ~1.4k-token system prompt: **2B TTFT ~6.5 s on GPU vs ~33 s on CPU;
4B ~16 s vs ~108 s** — the 4B is only usable with GPU prefill.

**The most robust argument is not the ratio but the stability:** CPU prefill is
thermally fragile, GPU prefill is not. CPU outliers (29.5 t/s at pp1024, 18.8 at
pp2048) appeared at 38-40 °C while the GPU beside them held 216.7 and 212.2.

Nothing left to squeeze: `-ngl 99` beats partial offload, `-ub 512` beats
128/256/1024, batch and GPU threads are noise. **`-fa on` crashes (exit 134)** — a
bug to file, not a config. Decode still loses (**0.66×**, 17.5 vs 26.5) and stays
dead.

**Scope, which the audit omitted:** measured on a **dense 2B**, not the 35B MoE.
For CalaQwen the Q7 landmine stands — the expert-ready streaming hook lives only
in the CPU `mul_mat_id` loop, so 35B experts must stay on CPU. So this is a lever
for **dense 2B/4B on 750-class silicon**, which is exactly the free-tier and
small-model lineup, and the app's TTFT pain is the ~1.4k-token system-prompt
prefill — i.e. precisely prefill.

**Before spending it:** the earlier "1.29× GPU prefill" claim on the 740 turned
out to be a cold-outlier artifact. This needs the same severity of re-check —
though a different device and a 4× larger margin make an artifact a poor
explanation.

### Frozen Draft (E4/F5) — *name pending owner*

Attention-only self-draft with the GDN recurrent state **frozen** (skip-write at
compute time, never snapshot/restore). Unpublished polarity; the mirror paper
(Component-Aware SSD, arXiv:2605.01106) tried the opposite polarity on sequential
hybrids and got α=0.038.

**Alive as:** a *correction* mechanism and a RAM saving.
**Dead as:** a speed technique (see §3).

- α_step1 **0.987** (γ=4), macro 0.823, E[L] 2.995
- **alpha_alltok 0.413** vs the mirror paper's 0.038 — the apples-to-apples number
- real decode loop: acceptance **8.6 % → 24.6 %** with the freeze on
- multi-turn chat: without freeze acceptance decays 3.9× along the conversation
  (0.117 → 0.100 → 0.030); with freeze it does not (0.183 → 0.275 → 0.138)
- **251.25 MiB of RAM saved**, measured, at γ=4
- four bitwise gates green: freezing does not contaminate, catch-up reconstructs
  exactly (max |Δlogit| = 0 over 300 positions)

---

## 3. THE GRAVEYARD — tested honestly, killed with a number

| technique | verdict |
|---|---|
| **K-F cold-start prefetch** | mapped, then closed. Jelly warm +7.1 % against (p=0.000977); Jelly cold **+4.3 % against, p=0.0635 null**; S23 / Xiaomi / CalaQwen all null. Mechanism works (stall 21.9 % → 13.4 %) but reads rise +14 % at 76 % precision. **Trades mean throughput for tail smoothness** (p99 328 vs 341 ms, stutter 0.34 % vs 0.55 %) — a UX argument, never claimed as speed. |
| **F6 cheap certification** | DEAD on bytes. Argmax agreement j=3 = 0.8120 against a GO threshold of 0.95; β=0.594 vs break-even 0.56. j≥4 fails on the structural floor by construction. |
| **Draft-by-drop** | DEAD before implementation. Assumed draft cost 0.2×; measured 0.91×. bpb is not a proxy for greedy acceptance. The expert cache is a second non-rewindable state that speculation pollutes. |
| **Self-speculative decoding for BYTES** | closed by the invariant (below). 0.31× on PC, 0.44× on phone; reads 32.8 GiB vs 12.7 for 256 tokens. |
| **CPU kernels S1/S2/S3, i8mm, REPACK** | three kernels, correct and audited (16191/16191 suite), all under the 10 % gate. **0.148 s/tok compute at t2 is the silicon floor.** Legacy: the config `t2 + k6d1.0` = 5.151 t/s, free. |
| **K-E (i8mm)** | never runs — mmla lives only in the REPACK path that streamed experts bypass. |
| **K-G (GPU prefill)** | the 1.29× was a cold-outlier artifact; honest 1.12 %. |
| **GPU DECODE (Adreno 740/750)** | 0.41× CPU on 740, 0.44× on 750. The E2E gap is ~60 ms/token of dispatch glue, not kernels — a fix is a fused executor (months), not a kernel (weeks). **Decode only — see the prefill row, which is NOT dead.** |
| **REAP-50** | halves *stored* experts, not *active* ones. Same ~11 GB/s wall. |
| **MTP / speculation for byte amortization** | 0.00 % amortized, three independent mechanisms. |
| **cache policies · cache size · ubatch · cross-layer prefetch · k<6 · extreme drop as a compute lever · 1c requant · hand IQ2 kernels · similarity/skew · asymmetric drop · typeahead · phase-split 2B · LFM on G99 · Ling 3.0 Tiny** | all closed with numbers. See PLAN.md. |

---

## 4. THE THEORY THAT KILLED MOST OF IT

> With batched verify: `bytes/token = [γα + (γ+1)β] / L`, with `L ≤ γ+1`.
> **If β ≥ 1, bytes/token ≥ 1 even with free drafts (α=0)** — speculation can at
> best tie plain decoding. The only escape is `β < 1`: verification must read
> fewer bytes than plain generation.

Break-even for our regime (γ=4, α=1/3, L≈3): **β < 0.56**, i.e. fewer than ~3.3
experts on average. F6 measured that and it fails.

**The supporting measurement** (routing entropy, our own): 96 % of the 256
experts are touched within 300 tokens; the top-16 carry only 25 % of the mass;
~45 expert re-reads per token. Consecutive tokens route to **near-disjoint**
expert sets — which is why batching does not amortize on this architecture, and
why every cache-similarity trick died by physics.

---

## 5. MEASURED SPEEDS — the lineup, per model per device

All numbers screen-on and unplugged unless noted. Product-card numbers, not
cell-internal numbers.

**⚠️ Provenance gap, flagged by audit and not yet closed:** these are lineup-card
figures carried forward in the PLAN, and several of them (CalaQwen S23 5.86,
Marco1c Jelly 3.64) do **not** trace to a `runs.csv` + analysis pair you can
re-open from this table. They are consistent with the KEXP speed grid
(`results/kexp_grid/speed_cells.csv`) and the lineup cell, but until each cell of
this table cites its source file, treat it as a card, not as evidence. Closing
this is a queue item.

| model | S23 (8 GB, 8Gen2, UFS 3.1) | Xiaomi 14 (11.4 GB, 8Gen3) | Jelly Star (G99, 8 GB) |
|---|---|---|---|
| **CalaQwen** 35B-A3B KEXP | **5.86** t/s (t4, k6d065) | **4.75** t/s (t6) | — |
| **Marco1c** | **8.82** t/s (t4) | **10.57** t/s (t4) ← *flagship overtakes* | 3.64 t/s (t2, ranking) |
| **Mellum2** 12B/A2.5B | **5.151** t/s (t2, k6d1.0) — certified | — | — |
| Qwen3.5-2B dense | 15.9 t/s | — | 8.04 t/s (t2) |
| Qwen3.5-4B dense | 8.38 t/s (llama-bench) | — | 3.52 t/s (t2) |
| Qwen3.5-1.5B | 25.8 t/s (LiteRT CPU) | — | — |
| LFM2.5-8B-A1B | — | — | 10.60 (k4) / 12.28 (k3) / 14.38 (k2) |

Notes that matter more than the numbers:

- **The streaming regime is silicon-independent.** CalaQwen reads 30.4 MiB/token
  at 80.7 % hit on Xiaomi and 30.7 / 80.7 on S23 — identical to the digit. The
  machine transfers; only the compute multiplier changes.
- **Thread count is per-model, not per-SoC.** Marco is compute-heavy (t4 = 2.1×
  t6 on Xiaomi); CalaQwen is flash-bound and thread-flat. The card rule
  "cpu_capacity ≥ 50 % → t6" strangles SM8650 on Marco.
- **Screen state is a first-class variable.** The "flagship is half as fast" story
  was HyperOS Doze throttling flash I/O (0.22 → 0.50 s/tok). CalaQwen on Xiaomi is
  4.75, not 2.55. `mWakefulness` is now a column in every runs.csv.
- **On weak silicon, fewer bytes ≠ more decode.** KEXP on G99 is dequant-bound on
  2×A76: 8.83 t/s against a 14.7 projection. Same lesson as REAP: only *active*
  bytes per token move the decode.
- **Device variance is ±50 % between consecutive runs** on the same model and
  config (3.99 → 8.27 t/s measured). Any speed claim needs ABBA pairs; two
  back-to-back runs prove nothing.

---

## 6. OPEN QUEUE — what is left to finish

| item | state | blocked on |
|---|---|---|
| ~~CalaQwen drop curve~~ | **DONE, 6 arms** (0.0/0.3/0.5/0.65/0.8/1.0) + a real CalaQwen `k8d0` anchor (0.6660114) | — |
| **Clean throughput + bytes cell for expert skipping** | **DONE on two models** — and it moved the mechanism: arming tax + hit-rate cap (see §2) | — |
| **M4 renorm ablation (renorm ON vs OFF at d=0.5 and d=1.0)** | **armed, starts when the curve frees the PC** | — |
| ~~Drop sweep on the SHIPPED model (CalaQwen) on a phone~~ | **DONE 2026-08-17, 12/12.** Model transferred over USB and sha-verified; `0.65` slower than no drop in all three rounds; `d=1.0` and `d=1.0+no-renorm` equivalent in speed | — |
| ~~Same treatment for Marco1c~~ | **DONE, and the verdict is the opposite of CalaQwen's.** Marco's own `k8d0` anchor is 0.761332; against it `d=1.0` costs +0.1003 with renorm and **+0.0490 without, against a 0.04 budget — it FAILS both ways**. Marco ships **no drop** (`d=0.0`, +0.0052, 13 % of budget); `d=0.65` was already excluded for being *slower* than not dropping. Same flag, same level, opposite verdict to CalaQwen: the config is per-model | — |
| **Corroborate Marco's gate rejection** | the 4-question sanity battery does **not** confirm it: on the one discriminating question the best-bpb config answers 3, the shipped one 5, and the *gate-rejected* one 4 (correct). Four questions cannot rank configs | a real battery (tens of questions, blind judge) if that rejection ever becomes expensive |
| **Re-measure absolute device tok/s under the new default** | every S23/Xiaomi speed cell was run at `drop 0.65`; the sign is known (−12.9 % on Jelly) but the absolutes are not | device time |
| ~~Random-drop arm (is it *cold* experts, or any experts?)~~ | **DONE 2026-08-18, and the coldness wins.** Flag built on an isolated binary, self-contained cell: random costs **+6.63 % bpb more than cold** at equal drop count, same direction in all 3 measured languages. The residency query buys quality; it is not a tax to delete (see §2) | — |
| **Finish the drop-policy cell** | `random` died at 3/5 languages (`pread failed at 5783089152`) and took the orchestrator with it, so **`weight` never ran** — the arm that separates cache from weight. Re-run both on the SAME binary `59f2762e54ed56af` | PC time |
| **Cpuset gate + covariates in the device harness** | **DONE 2026-08-18**, `run_dropsweep_jelly.sh`: `exit 93` on `nproc<6` / background-or-moderate cpuset / popcount<6, `ALLOW_RESTRICTED_CPUSET=1` hatch that stamps every row, `nproc`+`affinity_mask` read from the **binary's PID**, old-CSV header migration. Hostile-reviewed (3 CONFIRMED defects found and fixed: comma-in-`exclude_reason` ragged rows, unknown-header raggedness, `FAIL_CPUSET` missing from the watchdog's terminal set → 1 h relaunch storm) | uncommitted |
| **Re-run the three S23 cache cells** | current ones have no cpuset covariate and are unverifiable; same check due on the Jelly cells, which carry the shipped default | device time, after the gate lands |
| **Runtime config probe at first launch** | **the largest unshipped win, and it is not quantisation.** Thread count and screen state are worth **2.6× measured** on Marco1c (Xiaomi: 4.11 t/s at t6 → 8.58 at t4 → **10.57** screen-on) and cache sizing is worth **−32 % at zero quality cost** on the Jelly. Both are config, both are per-model and per-device, and the card rule `cpu_capacity ≥ 50 % → t6` actively strangles SM8650 on Marco. Designed in PLAN, **not built** | owner GO |
| ~~CalaQwen quality gate for the recipe~~ | **DONE 2026-08-17**: CalaQwen has its own `k8d0` anchor (0.6660114), so the gate is a same-model statement at last. The shipped default sits at 50 % of the budget | — |
| ~~PPL corpus v2~~ | **DONE, this line was stale.** `corpus/multi5/it.txt` has sha `498a5f3b554f`, identical to `it_v2_wikipedia_caffe.txt` — the campaign metric is already modern Wikipedia prose, not the memorised Dante slice (kept as `it_v1_literary.txt`). Verified 2026-08-17. | — |
| FT tool-call + IT lane (Qwen3.5-2B) | **all gates closed** (licence, recipe ×2 families, registry FROZEN) | owner GO |
| Free-tier G99 decision | (i) accept A0 k4 = 10.6 · (iii) no LFM on G99 — (ii) REAP eliminated with data | owner |
| ~~Three naming slots~~ | **DECIDED 2026-08-18.** The shipped config is **Kalsa Recipe**. The other two get **no name**: cold-start prefetch and frozen draft keep their descriptive labels. Owner's standard: a coined name claims novelty, and neither has any — cold-start prefetch is in the graveyard (+7.1 % *against* warm), and frozen draft has an unpublished polarity result but **no product** to attach a name to. Only what a user receives gets named | — |

---

## 7. THE SCOREBOARD, WITHOUT DECORATION

**1 confirmed and replicated win** (the recipe), **1 shipped app result** (TTFT),
**1 strong candidate mid-flight** (expert skipping), **1 real mechanism with no
speed payoff** (Frozen Draft), **~25 techniques retired with numbers**.

The kill/win ratio is high and that is correct: each kill cost hours, not months,
because the theory said what to measure. Three techniques died on 2026-08-16
alone — two of them before a line of code was written.

**And the honest reading of that scoreboard, asked for by the owner 2026-08-18:**
outside the recipe, **nothing new has shipped into the app**. The runtime config
probe does not exist, the OpenCL Q6_K dispatch fix is published nowhere, and the
seven `kalsa/*` engine branches live only on one disk. The single biggest
non-quantisation result of the month is not a kernel and not a technique — it is
that **config chosen at runtime is worth 2.6× on Marco1c and −32 % on cache**, and
it is sitting unbuilt.

**The real bottleneck is measurement discipline, not ideas.** On 2026-08-18 alone
three of my own conclusions had to be withdrawn — an idle shell mistaken for the
measured process, a `Dozing` phone mistaken for the screen-on campaign posture, and
the binary named in a script mistaken for the binary that actually ran (PowerShell
had read the file before it was edited). All three were avoidable by the same
discipline: **record the condition in the data row instead of inferring it later**,
which is precisely what the cpuset gate added — and why an item that produces no
number was the most useful work of that day. Corollary now standing: *the binary
that ran is read from the run's JSON, never from the script.*
