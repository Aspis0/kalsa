# VERDICT — "we tested the GPU at different layer counts": does the evidence exist, and is it usable?

**Date:** 2026-10-15
**Coordinator:** governor session `0dc81aaa`
**Sources:** four independent read-only sweeps of disjoint trees, every key citation re-verified
by the coordinator against the file on disk (exit codes below).
Scope reports: `SCOPE-A.md` (86 L), `SCOPE-B.md` (74 L), `SCOPE-C.md` (100 L), `SCOPE-D.md` (87 L) — 347 lines total.

---

## 1. Short answer

**The evidence exists, but it exists in two halves that were never measured together, and on
two different phones. It is enough to *describe* what layer counts cost and buy. It is NOT
enough to *decide* today's question on the Xiaomi — because the half we need (memory, on this
phone) does not exist for this phone at all.**

The memory Marco remembers being tested at several layer counts was tested **on the S23**.
The speed test on the actual Xiaomi exists but **carries no memory instrumentation whatsoever**.

---

## 2. What exists, per axis

### 2.1 Memory cost per layer count — S23 only, one model, one sweep

| Item | Value |
|---|---|
| Cell | `q44-ngl-sweep-mem` (`results/ngl_sweep_s23/device/kalsa_q44/driver.sh:88`, loop `:414`) |
| Device | Galaxy S23 / Adreno 740, unplugged |
| Model | LFM2.5-KEXP |
| Grid | ngl {0, 7, 13, 19, 99} |
| Instrumentation | 1 Hz device-side sampler: `MemAvailable/MemFree/SwapFree` + `VmRSS/RssAnon/RssFile/VmSwap` |

**This is the only cell in the entire evidence trees that ever paired a layer count with memory
accounting.** Result (`archived/ALIVE-2026-09-full.md:449`):

- k (MemAvailable cost per offloaded weight byte) is **not** a constant: `k_set` 1.74 → 1.05 from
  ngl 7 to full (N=25); incremental k collapses 1.70 → 0.09.
- Post-hoc affine reading: **partial offload ≈ ~750 MiB fixed (Adreno prealloc, present even at
  ngl 0) + ~1.0× offloaded bytes**.
- Candidate conservative gate: **`800 MiB + 1.05×bytes`**, safe on all 5 measured points.
- Bonus proofs: mmap weights cost ~nothing in MemAvailable (RssFile peak 3.1 GiB, ΔMA 35 MiB at
  ngl 0); GPU weight copies are invisible to RssAnon (~80–110 MiB flat) — "the app's gate
  blindness, now measured".

**The gate constant in production code today is exactly that number.**
`gpufit-drop-memory-gate/REPORT.md:120`, verified on disk:

```
gpuReserveMiB = 800 + 1.05*offloadedBytes/MIB
requiredMiB   = nonEvictableMiB + gpuReserveMiB + computeMiB + kvMiB
availableMiB  = (memory.availableMemoryBytes ?? 0)/MIB
return requiredMiB <= availableMiB ? "Fit" : "NoFit"
```

**The q44 row itself warns: "Constants need a second model/device before shipping."** That
warning was never discharged. This is the single most load-bearing citation in this document.

### 2.2 Speed per layer count — the real Xiaomi, no memory at all

| Item | Value |
|---|---|
| Cell | `results/gpu_prefill_recheck_xiaomi/run_part2.sh:92` → `for ngl in 8 16 24; do` |
| Device | **Xiaomi 14 / Adreno 750 (SM8650)**, unplugged, 2026-08-18 |
| Grid | ngl {8, 16, 24, 99} |
| Instrumentation | speed only |

Verified numbers (`results/gpu_prefill_recheck_xiaomi/report.md:106-109`):

| knob | t/s | vs full |
|---|---|---|
| `-ngl 8 -fa off` | 53.82 | **much worse (≈ CPU)** |
| `-ngl 16 -fa off` | 89.53 | worse |
| `-ngl 24 -fa off` | 200.33 | close (model has a bit more than 24 layers) |
| `-ngl 99` (full) | **216.70** | best ngl |

And the verdict the cell wrote itself (`report.md:178`, verified verbatim):

> **Partial offload is not "almost as good" until you are nearly at full.** ngl 8 ≈ CPU.
> ngl 16 ≈ 2× CPU. ngl 24 ≈ 200 t/s (93% of full). **Full offload is the right product setting.**

This cell has ~286 artifacts and **zero** meminfo / smaps / rpcmem / kgsl data. Its driver
samples no memory at all.

### 2.3 The gap, stated precisely

The two halves never met. So today, on the Xiaomi, the verdict
`available_mib 3004.93` vs `required_mib_without_repack 3385.06` is being decided by a constant
fitted on **one S23 sweep with one model**, applied to a **different phone**. The coordinator
reached this same conclusion independently today in `governor-nofit-prefill/REPORT.md:81-83`.

---

## 3. Why the question has to be re-framed before it can be answered

The decision on the table is **not** "should we ship partial offload". It never was, and the
evidence says it should not be:

- On this very phone, ngl 8 (53.8 t/s) ≈ CPU and ngl 16 is still 2× worse than full.
- Partial offload buys nothing until you are essentially at full, and at that point you should
  just go full.

**So the only useful outcome of loosening the memory gate is reaching FULL offload on the
Xiaomi** — 216.7 t/s prefill instead of the 109.4 s we measured for 1760 tokens today.
Everything in between is a strictly dominated configuration.

This is also the honest answer to "was Marco remembering something real?": **yes — the memory
sweep is real (S23), and the speed ladder is real (Xiaomi). What never existed is the join.**

---

## 4. The strongest safety caution, on the actual device

`scratchpad/agents/q16-xiaomi/REPORT.md` (verified):

- `:338` — full-GPU `-ngl 99` smoke of the 17.25B GGUF **kernel-rebooted** the Xiaomi.
- `:400` — `MemAvailable after smoke: 6704924 kB` (6.7 GB free, i.e. not a low-RAM event).
- `:417` — verdict `ngl=99 Marco = FAIL-HARD (delayed watchdog reboot after GPU smoke)`.
- `:419` — "Do **not** retry A/B."

Today's model is far smaller, so this is not the same regime. But **Xiaomi + Adreno 750 + full
offload has a known FAIL-HARD precedent on this exact device**, and that precedent was recorded
with 6.7 GB free — so it is not explained by today's 380 MiB shortfall and must not be waved off
as "just memory pressure".

Secondary: `oomwall/REPORT.md:19` shows `-ngl 0` power-off at 12B scale, and that cell itself
proved the cliff was llama-bench's CPU_REPACK rather than the layers — noted so nobody re-reads
that row as "layers crash phones".

---

## 5. Two disambiguations that would otherwise poison the decision

1. **"Half-offload is NEVER right"** (`ALIVE-2026-09-full.md:181`, `PLAN-2026-09-full.md:543`,
   reaffirmed `PLAN:689`) is about the **trunk-vs-experts split** (arm B: `7.90` t/s on KEXP,
   the worst arm on both devices). It is **not** about a partial layer count. Do not cite it as
   an argument against partial layer offload — it is not one.
2. **`NoFit` does not by itself mean RAM was short.** `laneFit` returns `NoFit` for an unknown
   SoC even with 18.9 GB free (`PLAN-2026-10-09-full.md:958-959`). Always read `available_mib`
   alongside the verdict.

---

## 6. The cheapest next experiment, and it is not a bench

The shortfall today is **380 MiB (12.6%)**. On 2026-09-20 the same phone measured
`MemTotal 11.44 GB`, `MemAvailable 3.65 GB`, **~3.4 GB already resident in zram**, and:

> "Force-stopping the app freed the resident LFM and lifted MemAvailable to ~5 GB."
> — `analysis/XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md:80`

**Force-stopping the app returned ~1.35 GB on this exact device — 3.5× the shortfall we are
arguing about.** So the first question is not "what is the right constant", it is:

> Would the same load, on the same phone, with a cold app process, have had 380 MiB of headroom
> and therefore gone full-GPU?

That is a re-run of an existing path, not a new bench, and it costs one phone session.

**Closed option, do not re-open:** making the gate swap-aware is explicitly rejected product
decision (`analysis/…:82-83`, agreed with kalsa-63): "do NOT teach the gate to count zram as
available for weights — compressed RAM counted as free buys thrashing." The defensible fix was
lazy vision, not a swap-aware gate.

---

## 7. Verification ledger (coordinator, real exit codes)

| # | Claim | Command | Result |
|---|---|---|---|
| 0 | 4 reports on disk | `wc -l scratchpad/agents/gpu-layers-history/SCOPE-*.md` | **0** — 86 / 74 / 100 / 87 = 347 |
| 1 | q44 memory sweep + `800 MiB + 1.05×bytes` | `sed -n 449p archived/ALIVE-2026-09-full.md` | **0** — verbatim match |
| 2 | NoFit → `n_gpu_layers = 0` documented | `sed -n 946p archived/PLAN-2026-10-09-full.md` | **0** — "fallback is now Android-only" |
| 3 | S23 starved but reported Fit | `sed -n 973,975p archived/PLAN-2026-10-09-full.md` | **0** — 123 MB free, 2998 vs 3458.93 |
| 4 | Xiaomi ngl ladder exists | `sed -n 92p results/gpu_prefill_recheck_xiaomi/run_part2.sh` | **0** — `for ngl in 8 16 24` |
| 5 | Gate constant in production | `sed -n 118,122p …/gpufit-drop-memory-gate/REPORT.md` | **0** — exact formula |
| 6 | Xiaomi kernel reboot at ngl 99 | `sed -n 398,410p …/q16-xiaomi/REPORT.md` + grep | **0** — `6704924 kB`, FAIL-HARD |
| 7 | Partial offload rejected on speed | `grep -n "ngl 8\|Full offload is the right" …/report.md` | **0** — `:106`, `:178` verbatim |
| 8 | Xiaomi memory reality + swap-blind by decision | `read analysis/XIAOMI-QWEN-FITGATE-…md:76-84` | file on disk, §4 read |

**Nothing in this document is taken on a subagent's word.**

---

## 8. What this means for the backlog

`BACKLOG-LOW-PRIORITY.md:107-109` item **A2** (NoFit → CPU fallback, open since 2026-10-11) is the
natural home for this. Recommendation, for the owner to confirm:

- **A2 becomes the top governor item**, reframed as: *"recover full-GPU prefill on the Xiaomi"*
  rather than *"make NoFit smarter"*.
- The first step is the cold-process re-run (§6), not a constant re-fit.
- A constant re-fit on the S23 data would be **re-deriving a number the q44 row already warned
  against**. If the Xiaomi memory ladder ever gets measured, it is a new cell on a new device —
  owner's call on phone time.
- Backlog priority changes are the owner's; this document only records the evidence.