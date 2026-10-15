# SCOPE C — September archive: GPU layer-count / partial-offload history

Read-only. Files read in full or in contiguous context:
`archived/ALIVE-2026-09-full.md`, `archived/PLAN-2026-09-full.md`. Every `file:line` below was
actually read. Line numbers refer to the archive files as they are on disk today.

**DATING WARNING (matters for the live question).** `ALIVE-2026-09-full.md:3` is headed
`# ALIVE — what is still standing, 2026-08-22`, and `archived/PLAN-2026-09-full.md:1` /
`ALIVE-2026-09-full.md:1` both say *"Two documents only (owner, 2026-09-09) ... Everything older is
under archived/"*. The September archive is therefore a **container**, not a September experiment
log: it carries late-August content (20–25/08) plus September appendices. The layer/offload
material below is overwhelmingly **20–25 August**, not September. Only rows dated 1–20/09 are
genuinely September, and those are almost entirely NPU/QDC-board work, not phone GPU legs.

## Candidate evidence table

| Candidate experiment / decision | file:line | Verbatim quote | Date | Device | plugged / unplugged / QDC | numbers |
|---|---|---|---|---|---|---|
| **The only GPU layer-count sweep (memory, not speed)** — q44 | `ALIVE-2026-09-full.md:449` | "**k (MemAvailable cost per offloaded weight byte) is NOT a constant**: k_set 1.74→1.05 from ngl 7 to full (N=25, LFM2.5-KEXP, S23), incremental k collapses 1.70→0.09. Post-hoc affine reading: partial offload ≈ **~750 MiB fixed (Adreno prealloc, present even at ngl 0) + ~1.0× offloaded bytes**; candidate conservative gate for the app `800 MiB + 1.05×bytes` (safe on all 5 measured points)." | 24/08 | Galaxy S23, Adreno 740 | not stated in the row | 5 measured points, N=25; k_set 1.74→1.05 |
| Same row, method detail | `ALIVE-2026-09-full.md:449` | "mmap weights cost ~nothing in MemAvailable (RssFile peak 3.1 GiB, ΔMA 35 MiB at ngl 0) and GPU weight copies are invisible to RssAnon (~80–110 MiB flat) — the app's gate blindness, now measured. Constants need a second model/device before shipping" | 24/08 | S23 | — | RssFile 3.1 GiB; ΔMA 35 MiB; RssAnon 80–110 MiB |
| **Partial GPU offload speed leg (the only one on a phone)** — Mellum2 #23 | `ALIVE-2026-09-full.md:169-172` | "Mellum2, llama-bench mmap, n=16: pure CPU `-ngl 0 -nr` **0.216** t/s (plugged, declared; level flat, no mem cliff) vs trunk-GPU partial `-ngl 2 -ncmoe 99` **0.223** (unplugged) — **GPU placement moves nothing in the streaming regime (±3%)**" | 22/08 (#23) | S23, Adreno 740 | **mixed**: CPU arm plugged, GPU arm unplugged — not a valid pair | CPU 0.216 vs GPU-partial 0.223 t/s, n=16 |
| Experts-GPU at ngl=2 rejected | `ALIVE-2026-09-full.md:188-191` | "experts-GPU at ngl=2 in the streaming regime is not viable (<0.11 t/s vs 0.22 dense-GPU/experts-CPU) — the GPU valve pays when the model fits in RAM, not against the flash-bandwidth wall." | 22/08 | S23 | — | <0.11 vs 0.22 t/s |
| Streaming: partial offload is the only feasible GPU config — and still loses | `ALIVE-2026-09-full.md:157-164` | "All-GPU is physically impossible; the only feasible GPU configs are partial offload, measured on Mellum2: 0.22 t/s dense-GPU / <0.11 experts-GPU vs **5.10 CPU with the Kalsa recipe** — in the streaming regime the wall is flash bandwidth and the GPU only adds per-token friction. ... Product answer for streaming models: CPU + recipe, full stop." | 22/08 | S23 | — | 0.22 / <0.11 vs 5.10 t/s |
| "Half-offload is NEVER right" (B = trunk-GPU/experts-CPU, **not** layer count) | `ALIVE-2026-09-full.md:180-181` | "Rules: want speed → pure CPU, always. Want cool on KEXP → all-GPU (−19% speed, −2.75°C). **Half-offload is NEVER right** — and that is the kernels' real product value" | 22/08 | S23 | — | −19% / −2.75 °C |
| Arm B worst, quantified | `ALIVE-2026-09-full.md:142-143` and `:155` | "on small-active MoEs the pure CPU always wins raw speed; half-offload (B) is always the worst" / table row "**B — trunk GPU, experts CPU** \| 7.90 ❌ worst \| 10.53 ❌ worst (n10 build) \| hotter than A" | 22/08 | S23 | — | KEXP 7.90; OLMoE 10.53 t/s |
| **PLAN ban, reaffirmed** | `PLAN-2026-09-full.md:543` | "- Mai half-offload (ALIVE 140-145); full o niente, cool-mode solo con delta misurato." | plan of 5/09→13/09 (superseded section) | — | — | — |
| PLAN ban, rationale restated | `PLAN-2026-09-full.md:217` | "L'half-offload tronco GPU/esperti CPU resta escluso dalle ricette oggetto delle misure che ne mostrano il costo di ping-pong." | Sept plan | — | — | — |
| PLAN ban, still standing in milestone M3 | `PLAN-2026-09-full.md:688-689` | "MoE su GPU con i due difetti Adreno noti, **half-offload escluso**, esperti su NPU mai misurati; stop/go 6/11." | M3, 20/11 milestone | — | — | — |
| **Fit refusal on the owner's Xiaomi: full-GPU killed the kernel** | `ALIVE-2026-09-full.md:414-415` | "**Marco-KEXP 6.385G full-GPU = kernel reboot** (fit-gate FAIL-HARD — the smoke even returned valid jsonl before the device died; **never retry full-GPU on this gguf/device**)." | 22/08, phase d, N=5 | Xiaomi 14, Adreno 750 | — | 6.385 GB model; CPU survivor tg 28.2 / pp 41.8 |
| **Fit refusal, Xiaomi, September** | `ALIVE-2026-09-full.md:16` (IT twin `PLAN-2026-09-full.md:22`) | "Qwen 4B loads on the Xiaomi (houji, 12 GB) ONLY via `kalsa.bench.norepack=1` — the fit-gate refuses it (`KALSA_LOAD refusedBy:"fit" model.tightNow` at ~3.65 GB MemAvailable; the ~3 GB anon repack copy is the hog, not the 2.83 GB model) and silently loads LFM instead" | **20/09 (night)** | Xiaomi 14 (houji, 12 GB) | owner's phone overnight | ~3.65 GB MemAvailable; ~3 GB repack; 2.83 GB model |
| **`NoFit` + `ngl` forced to 0 in-app — closest prior to today's incident** | `ALIVE-2026-09-full.md:492` | `KALSA_GOVERNOR {"engine_prefill":"CPU","engine_decode":"CPU","prefill_ctx_ngl":0,"forced":true,"fit":"NoFit","fallback_reason":"governor not eligible"}` — "**`forced:true`: il lever di banco `kalsa.bench.governor_force` era applicato e NON BASTA.**" | **8/09** | QRD8635 / SM8635 / Adreno 735 | QDC, session 808791 | A ttft 27 524 ms, 915 token, decode 8.227 t/s, skin 32.9→46.2 °C |
| The two static app gates behind that `NoFit` | `ALIVE-2026-09-full.md:492` | "(1) `src/engine/governorInputs.ts:82-83` ... `if (typeof kv !== "number" \|\| !Number.isFinite(kv) \|\| kv <= 0) return "NoFit"`, and the entry `qwen3.5-4b` in `ModelRegistry.ts:187` **omette apposta** quel campo ... ⇒ `gpu_fit` = NoFit **su qualunque device, sempre**, prima di ogni aritmetica di memoria; (2) `src/engine/LlamaService.ts:1387-1389`, il governor si aggancia solo se `governorBase.gpu_fit !== "NoFit" && !options.mmprojPath && !streamExperts`" | 8/09 | — | — | — |
| Fit refusal killed by RAM, not defect | `ALIVE-2026-09-full.md:447` | "**v73/S23 smoke attempt (24/08): killed by FIT, not by a defect** — the HTP load path materializes the experts as a 5996 MiB anon CPU buffer (+repack copies, 6360 MiB total on a 7074 MiB MemTotal phone) → LMK during load" | 24/08 | S23 | — | 5996 MiB; 6360 / 7074 MiB |
| Repack is the real memory hog | `ALIVE-2026-09-full.md:106-110` | "**The power-off wall was never the GPU (oomwall, 2026-08-21):** Mellum2-scale crashes were llama-bench's DEFAULT ARM repack (`use_extra_bufts=true`, no flag to disable) allocating ~6.5GB of anonymous memory — kernel death even at `-ngl 0`, proven by the single-variable W4/W4c pair." | 21/08 | — | — | ~6.5 GB; death even at `-ngl 0` |
| Generational law: memory before speed | `ALIVE-2026-09-full.md:533-536` | "**Memory decides before speed.** NPU path materializes everything anon (no mmap — hard fit on 8 GB phones); GPU costs ~750 MiB fixed + 1:1 driver-side invisible to RSS (q44); CPU+mmap is the only elastic-residency engine" | 24/08 | cross-generation | — | ~750 MiB fixed + 1:1 |
| **Reversal: full GPU re-admitted on 750-class only** | `ALIVE-2026-09-full.md:545` | GPU row, Xiaomi/750-class: "Decode parity (0.992) + prefill 2.48× → **default candidate where the model fits (fit-gate hard)**" | 24/08 | Xiaomi 14, Adreno 750 | — | decode 0.992; prefill 2.48× |
| Predecessor being reversed | `ALIVE-2026-09-full.md:146` | "\"GPU default candidate\" is retired." | 22/08 | S23 | — | — |
| 750 rationale + arm B still worst there | `ALIVE-2026-09-full.md:402-406` | "The 740 speed verdict does NOT generalize: exploratory A/B/C (N=3, tg128...) decode **A 24.47 ≈ C 24.28** (A/C 1.008 vs 0.812 on S23) and **prefill A = 2.21× C**. B (trunk-GPU/ experts-CPU) is the worst arm on both devices. On 750-class, full-GPU with our kernels is a candidate default" | 22/08 | Xiaomi 14, Adreno 750 | — | A 24.47 / C 24.28 t/s; A/C 1.008; prefill 2.21× |
| NPU layer ladder (8 → 12 → 99), **NPU/HTP not GPU, QDC board not phone** | `ALIVE-2026-09-full.md:480` | "Sei arm ... `-ngl 8` VIVE (proof 189), `-ngl 12` VIVE (297, **2.48 GiB vivi sul DSP**), `-ngl 8 tg128` VIVE (2688 dispatch = PRIMO decode NPU v73 mai registrato); `-ngl 99` MUORE con MBUF=512 e con VMEM=1800 ... **F6 RIFORMULATA: su v73 experts-on-NPU è viabile con pesi residenti ≤ ~2.5 GiB verificati e senza churn**" | **4/09** | HDK8550 (v73) | QDC board | ngl 8 / 12 / 99; 2.48 GiB; ≤~2.5 GiB rule |
| App boots the engine with `nGpuLayers 0` by construction | `PLAN-2026-09-full.md:1282` | "poi carica la variante JNI `rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl` con `nGpuLayers 0`: le HTP stanno su disco e non vengono mai mappate, il motore gira su CPU." | 19/09 (kalsa-2d, 22:50 EDT) | S23 | owner's phone | prewarm 1826 tokens OK on CPU |

## Per-question verdicts

1. **Partial GPU layer offload — EVIDENCE EXISTS, but almost none of it is a layer ladder.**
   `ALIVE-2026-09-full.md:449` is the single genuine GPU sweep over layer counts (ngl 7 → full,
   S23, 24/08) and it measured **memory, not speed**. The only partial-offload *speed* leg on a
   phone is `-ngl 2` on Mellum2/S23 at `:171`. Every other offload "split" in these files is the
   **trunk-vs-experts** split (arm B), which is a different axis from `n_gpu_layers` and must not be
   read as a layer-count result.

2. **Phone speed tables — EVIDENCE EXISTS (`ALIVE-2026-09-full.md:355-363`), but they are 22/08, not September.**
   Per-phone tok/s are tabulated for S23 / Xiaomi 14 (11.4 GB, 8Gen3) / Jelly Star (G99), e.g.
   `"| **CalaQwen** 35B-A3B KEXP | **6.810** t/s (t4...) | **4.75** t/s (t6) | — |"`. **Every one of
   those legs is CPU-only** — the header at `:350` says *"All numbers are screen-on and unplugged
   unless noted"*. The only full-vs-partial GPU comparison table is `:149-155`, S23-only, and it is
   also August.

3. **Memory-fit refusal / RAM gate / `NoFit` — EVIDENCE EXISTS, including one on the owner's Xiaomi.**
   Four independent instances: `:414` (Xiaomi 750 full-GPU kernel reboot, 22/08), `:16`
   (Xiaomi houji `refusedBy:"fit"`, **20/09**), `:492` (in-app `"fit":"NoFit"` → `prefill_ctx_ngl:0`
   **even with `forced:true`**, 8/09), `:447` (S23 HTP load killed by fit → LMK, 24/08). What the
   code then did: fell back to CPU silently, or to a different model (`silently loads LFM instead`).

4. **Measured GPU memory footprint per layer — EVIDENCE EXISTS but only in aggregate.**
   `ALIVE-2026-09-full.md:449` gives the affine model `~750 MiB fixed + ~1.0× offloaded bytes`, and
   the proposed app gate `800 MiB + 1.05×bytes`. Method: MemAvailable cost per offloaded weight
   byte, N=25, cross-checked with RssFile/RssAnon. **No per-layer MiB figure exists anywhere in
   these two files**, and the row itself warns "Constants need a second model/device before
   shipping" — it is single-device, single-model.

5. **Tried-and-rejected partial offload, plus a later reversal — EVIDENCE EXISTS on both sides.**
   Rejection: `:143`, `:155`, `:181` ("Half-offload is NEVER right"), `:217`/`:543`/`:689` in PLAN.
   Reversal — but of a *different* claim: `:146` retired "GPU default candidate" on 22/08, then
   `:545` (24/08) and `:406` (22/08) re-admitted **full** GPU on 750-class only. **The half-offload
   ban itself is never reversed in these files.**

## What I could NOT verify

- **No speed-vs-layer-count ladder for the GPU, on any phone, exists in the September archive.**
  Layer counts actually measured on a phone GPU are only `ngl 0`, `ngl 2` (trunk, Mellum2), `ngl 7`
  (memory only, q44), and full (`ngl 16` OLMoE / `ngl 99`). So the owner's memory of "we tested the
  GPU at different layer counts" is **half right**: a memory sweep happened (q44), a speed ladder
  did not.
- **§7.18 is not in my scope files.** `PLAN-2026-09-full.md:526-527` only *references* it
  ("`memoryEstimate.ts` impara il termine memoria driver GPU (§7.18) → `gpu_fit`"). The actual
  formula behind today's `required_mib_without_repack` lives in a doc outside SCOPE C — likely the
  August archive or current `docs/ALIVE.md`, both owned by another explorer.
- **`results/q44-*/` and `scratchpad/agents/q44-*/` were not opened** (out of my scope). The q44 raw
  CSVs — which would carry the per-point ngl/k values behind the "5 measured points" — are
  unverified by me; I only have the one-line summary at `:449`.
- **Plugged/unplugged is not recorded for the q44 sweep** (`:449`), nor for the Xiaomi 750 phase-d
  kernel reboot (`:414`). Only the Mellum2 legs at `:169-171` carry it, and there the CPU arm was
  plugged while the GPU arm was unplugged — that pair is thermally and power-confounded.
- **The 8 Elite / QDC rows (`:457`-`:492`) are reference boards, not the owner's phones.** I did not
  find any September GPU layer experiment on the Xiaomi 14, the S23, or the Jelly Star. Every
  1–20/09 GPU row is a Qualcomm QDC board.
- **"Ladder" is a false friend in these files.** Grep for `ladder` returns UI typing ladders
  (`200/100` chars per block, `PLAN:2404`, `ALIVE:2404`, `:2637`, `:2850`), not layer ladders.
- Files I expected but did not find in scope: any September phone table with a GPU leg carrying
  fewer layers than the model has; any `n_gpu_layers` occurrence at all in either file (the only
  literal is `nGpuLayers 0` at `PLAN:1282`, a boot-time constant, not a sweep).