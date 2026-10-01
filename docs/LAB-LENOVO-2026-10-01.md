# REPORT-SONNET — a better model than Gemma E4B on a 32 GB + RTX 4050 6 GB PC? (Lab, 2026-09-30/10-01)

Machine: owner's Lenovo "marcolenovo" — Core Ultra 9 185H, 32 GB, RTX 4050 Laptop (6,141 MiB, **5,152 MiB free** to Vulkan), Intel Arc iGPU, Windows 11, AC power. Engine: fork `e8065c7cf` Vulkan build (`llama-server --version` → `0.4.1-dev (build 0, commit unknown)`; commit is *not* embedded because it was built from `git archive`; the zip I built from has sha256 `9dbc8f1bee0f8d1607733d158c2ebefa4f56cb8ee995a101cee49cf7f28a3c0c`, byte-identical to `git archive e8065c7cf` re-created on the Mac, and the same hash on the PC).
All tools are mine (`~/lab/spec/lenovo-mtp/lab2/`: `lab2_bench.py`, `score.py`, `thermwin.py`, …), not the previous agent's. Raw notes: `lab2/NOTES.md`. Nothing in `kalsa-brain`/`kalsallama` was edited; nothing pushed or tagged.

**Evidence tags:** MEASURED = read from a run's output/telemetry. INFERENCE = my reading of it.

---

## Bottom line

1. **Among the routes the owner asked for (26B hybrid, 12B/QAT/Q3 variants) nothing beats Gemma E4B on this PC under the owner's criteria** (fast decode, fast prompt/TTFT, no RAM paging, sustained 10 min, ≥64k context). E4B: 46.6 tok/s, 1.9k tok/s prompt, TTFT 1.2 s, 3.8 GiB VRAM, no paging, 90/100 on the quality bank.
2. **A 12B can't be fully GPU-resident on 5.15 GiB free VRAM at ≥64k context at any quality that survives.** The QAT 12B (6.26 GiB) does not fit; the largest 12B file that fits fully (BatiAI iq3, 4.52 GiB) only does so at **16k** context and **loses coding badly (2/20 vs 17/20)**.
3. **Hybrid 12B Q4/QAT and the 26B-A4B (experts in RAM) run at 5–9 tok/s with 7–10 s TTFT on a 2k prompt and page RAM under the machine's real load.** They fail the speed/TTFT/paging bar.
4. **QAT (unsloth UD-Q4_K_XL) is a free quality-neutral swap for the Q4_K_M row *if* the matching drafter is used**: 97/100 vs 95/100 (not significant), 12% smaller, draft acceptance 0.80 with its own drafter vs 0.74 with the old drafter. It does not change the RTX verdict.
5. **The owner add-on Ling-3.0-tiny (official GGUF, MIT, 7.9B/1.3B-active MoE) is the one row that does beat E4B on speed**: 99 tok/s, 2.9k tok/s prompt, TTFT 0.76 s, fully on the RTX at 64k context, no paging, bank 95/100 — but 45/54 on the owner's Italian quiz (E4B 49, 12B 48) with invented details; promising, not shippable on this evidence (§8).
6. The two community Ollama builds (BatiAI q3 / iq3) are plain requants and are clearly worse on coding (85 and 78/100). Not recommended.

---

## 0. Re-verification of the previous anchors (MEASURED)

Same 10 prompts, seed 42, greedy, 128 tokens, an explicit warm-up request excluded, `--fit on --fit-target 300`, 6 threads, batch 2048/ubatch 512, ctx 65,536, q8_0 KV, flash-attn, MTP drafter on the GPU. All files sha256-verified (§7).

| Row | Previous report | Mine, run 1 | Mine, cooled run (no thermal bit, quiet-gated) | Verdict |
|---|---|---|---|---|
| (a) E4B Q4_K_M, RTX — decode median/min | 47.9 / 46.7 | 46.8 / 45.6 | **46.6 / 42.9** | **holds** (−3%) |
| (a) ~2.07k-token prompt tok/s | 1,973 | 1,914 | 1,903 (min 1,607) | holds (−3%) |
| (a) TTFT | 1.16 s | 1.17 s | 1.22 s | holds |
| (b) 12B Q4_K_M + MTP n3, RTX — decode | 8.74 / 3.65 | 5.35 / 4.03 (cargo+Defender+paging running) · 7.67 / 6.24 | **7.95 / 1.97** | median **roughly holds (−9%)** at best; swings 5.4–8.0 with load; the min is a stall artefact |
| (b) prompt tok/s | 349 | 313 · 316 | 325 | −7% |
| (b) TTFT | 6.7 s | 7.1 · 7.2 s | 6.95 s | holds |
| (b) draft acceptance | 83.7% | 80.5% | 80.5% | similar |

Why (b) is unstable: `--fit` puts only **25/49 layers (4,040 MiB) on the GPU**, the other half of the weights (4,040 MiB) and half the KV cache stay on the CPU, so decode is CPU/RAM-bound. During my runs the PC was busy with **other agents' work** (`cargo`/`rustc`/`link` builds, Paseo, Windows Defender scanning the GGUFs): telemetry for the cooled (b) run shows page-ins median 3.6k/s (p90 151k/s), available RAM 4.2 GB at the low point. Treat every hybrid row below as "under realistic desktop load". The previous 8.7 is the optimistic end of a 5–9 range.

The previous agent's E4B sustained row (42.9 → 36.6 tok/s) is consistent with mine (46.3 → 43.3) given thermals (§4).

---

## 1. Candidates: speed, memory (MEASURED unless marked)

Prompt/TTFT use three unique ~2,069-token prompts (cache off). "VRAM" = max `nvidia-smi` memory used; "RSS" = llama-server working set; "avail" = free+standby RAM during the run. Thermal column: **clean** = no 0x08/0x20/0x40 bit in my 5–10 s telemetry nor in the coordinator's `thermal.log` for the run window; rows marked *(own tel.)* predate the watcher and are clean by my telemetry only.

### Route 2 — 12B-class on the RTX (MTP n=3 where noted)

| Candidate (file, size) | Placement at ctx | Decode med/min tok/s | Prompt tok/s | TTFT | Draft acc. | VRAM / RSS / avail-RAM low | Thermal |
|---|---|---|---|---|---|---|---|
| **12B Q4_K_M** (pinned, 7.13 GiB) | 25/49 layers, 64k | 7.95 / 1.97 | 325 | 6.95 s | 0.805 | 5.4 GiB / 8.7–9.0 GB / **4.2 GB** | clean |
| **12B QAT unsloth UD-Q4_K_XL** (6.26 GiB) + **unsloth drafter** | 30/49, 64k | 6.34 / 4.71 | 294 | 8.0 s | **0.80** | 5.5 GiB / 7.7 GB / 5.9 GB | clean *(own tel.)* |
| same QAT + **pinned (non-QAT) drafter** | 30/49, 64k | 5.12 / 3.14 | 228 | 9.6 s | **0.74** | 5.5 GiB / 7.5 GB / **0.34 GB** | clean *(own tel.)* |
| 12B IQ3_XXS plain requant (bartowski, 4.79 GiB) | 38/49, 64k | 6.73 / 5.52 | 410 | 6.1 s | 0.778 | 5.5 GiB / 6.1 GB / 6.7 GB | clean *(own tel.)* |
| 12B Q3_K_M — **community BatiAI q3** (5.67 GiB) | 32/49, 64k | 6.50 / 2.12 | 348 | 6.7 s | 0.755 | 5.5 GiB / 7.1 GB / 4.8 GB | clean *(own tel.)* |
| 12B iq3 — **community BatiAI iq3** (4.52 GiB) | 40/49, 64k | 8.59 / 7.20 | 463 | 5.2 s | 0.77 | 5.4 GiB / 5.8 GB / 9.7 GB | clean |
| BatiAI iq3, **all 49 layers on GPU, ctx 16,384, no MTP** | full GPU | **27.2 / 27.0** | 417 (min 236)* | 6.5 s* | – | 5.2 GiB / 4.9 GB / 8.1 GB | clean |
| BatiAI iq3, full GPU, 16k, **MTP n3 (GPU drafter), ubatch 256** | full GPU | **36.9 / 29.1** | 644 / 612 | **3.4 s** | 0.770 | 5.6 GiB / 5.5 GB / 8.7 GB | clean |
| …same at **temperature 1.0** (the app's sampling) | full GPU | 34.4 / 29.1 | 631 | 3.5 s | **0.709** | same | clean |
| …drafter on CPU (`--spec-draft-ngl 0`) | full GPU | 25.8 / 20.0 | 672 | 3.4 s | 0.770 | 5.2 GiB | clean |
| E4B Q4_K_M, RTX, full GPU, 64k (reference) | full GPU | **46.6 / 42.9** | **1,903** | **1.22 s** | – | **3.8 GiB / 3.2 GB / 12.3 GB** | clean |
| E4B at temperature 1.0 | full GPU | 47.7 / 46.6 | 1,912 | 1.15 s | – | same | clean |

\* the cooled no-MTP row's prefill was disturbed by a concurrent compile (`link.exe`/`rustc` seen by the quiet gate): the earlier, throttle-flagged run of the same config measured 628 tok/s prompt / 3.5 s TTFT, so GPU-resident prefill is 420–630 tok/s depending on CPU contention (INFERENCE: the CPU submit thread starves).

Findings that matter:
- **VRAM budget (MEASURED):** Vulkan sees 5,152 MiB free of 6,141. The 12B *projected* use with 64k KV + drafter + compute buffers: Q4_K_M 8.1 GiB (fit chose 25 layers), QAT 7.2 GiB, BatiAI q3 6.6 GiB, IQ3_XXS 5.7 GiB, BatiAI iq3 5.5 GiB — **none fits 5.15 GiB at 64k**. IQ3_XXS even fails to allocate at 16k with the GPU drafter.
- **"Fully in 6 GB" only worked with ctx 16k and `--ubatch-size 256`.** With ubatch 512 the same config loaded and answered a 20-token prompt at 32 tok/s, then crashed with `ErrorOutOfDeviceMemory` on the first 2k-token prompt (compute buffer grows at run time). *The model fitting at load is not the same as fitting.*
- **No QAT variant fits.** The unsloth repo ships exactly one model file (UD-Q4_K_XL, 6.26 GiB) plus mmproj/MTP files; Google's own `qat-q4_0` is 6.50 GiB. QAT is 4-bit-only; there is no 3-bit QAT file, so the owner's "low-bit QAT loses far less" premise could not be tested: no such file exists.
- **MTP is worth +36% only when the drafter is on the GPU** (36.9 vs 27.2 tok/s); on the CPU it is a wash (25.8). At temperature 1.0 acceptance falls 0.77 → 0.71 and the gain to +26%.
- **Hybrid decode barely improves with more GPU layers** (25/49 → 40/49 gives 5–8 → 8.6 tok/s): the CPU half and CPU↔GPU sync dominate (INFERENCE).

### Route 1 — Gemma 4 26B-A4B (MoE), experts in RAM

File: **google/gemma-4-26B-A4B-it-qat-q4_0-gguf @ d1c082be**, `gemma-4-26B_q4_0-it.gguf`, 14,439,363,584 B (the catalog pin), sha256 verified. No MTP drafter exists for it (catalog `drafter: None`). The fork supports `--n-cpu-moe N`, `-ot`, `--cpu-moe`; **`--fit on` already moves the experts of 26 layers to RAM on its own** ("31 layers (26 overflowing), 4,765 MiB used") — no manual flag is required.

| Config (ctx 64k, no MTP) | Decode med/min | Prompt tok/s | TTFT | VRAM / RSS / avail-RAM | Thermal |
|---|---|---|---|---|---|
| `--fit on` (auto) | 6.55 / 2.78 | 194 (min 115) | 9.9 s | 4.9 GiB / 9–10 GB / **0.2 GB low** | clean *(own tel.)* |
| `--n-cpu-moe 24` (VRAM 5.3 GiB) | **9.55 / 7.56** | 232 | 9.0 s | 5.4 GiB / **13.6–13.9 GB** / **0.8 GB** (median 1.3 GB) | clean *(own tel.)* |
| `--n-cpu-moe 26` | 8.90 / 7.44 | 177 (min 71) | 10.6 s | 4.6 GiB / 12–13.6 GB / 0.4 GB | clean *(own tel.)* |
| `--n-cpu-moe 22` | – | – | – | out of VRAM at load | – |

**10-minute sustained (n-cpu-moe 24; 2k-token prompt + ≤192 new tokens per request, MEASURED, clean thermally):** decode **8.4 → 4.6 → 2.7–7.6 tok/s** (13 requests in 10 min), prompt ~200 tok/s, available RAM 0.6–5.5 GB (median 2.6 GB), **page-ins median 3.9k/s, p90 21k/s** — it pages. FAILS.

Quality (MEASURED, §3): **95/100** — same as the 12B Q4_K_M. The 26B is the *quality* peer of the 12B; it fails on speed, TTFT and paging, not on answers.

### Sustained 10 minutes (continuous 2k-token prompt + ≤192 tokens, per-minute) — MEASURED

| Row | Minute 1 → 10 decode tok/s | Prompt tok/s | Thermal verdict |
|---|---|---|---|
| **E4B** (cooled start 61 °C) | 46.3 → 43.3 (min 43.3) | 1,942 → 1,537 | **THROTTLED** (SW thermal 0x20 in 91% of samples; GPU med 83 °C, max 88 °C; 5 watcher samples) |
| BatiAI iq3 full GPU 16k + MTP (cooled start 62 °C) | 29.7 → 24.2 (min 23.1) | 634 → 505 | **THROTTLED** (0x20 in 91%; GPU med 86 °C, max 90 °C; clocks fell to 480 MHz at worst) |
| 26B-A4B hybrid (n-cpu-moe 24) | 8.4 → 3.6 (min 2.7) | ~200 | clean, but **paging** (above) |
| 12B Q4/QAT hybrids | not run (decode 5–8 tok/s already below any floor) | – | – |

By the coordinator's rule the two throttled rows are **not speed numbers**; they are the sustained *floor under thermal slowdown* — which is what a user would actually get after ~1–2 minutes of full-GPU work on this chassis, and is unavoidable (a re-run after cool-down throttles again by minute 2). Hybrid rows keep the GPU at 64–77 °C because the CPU does the work.

---

## 2. Memory/RAM facts that decide the verdict (MEASURED)

- E4B: RSS 3.2 GB, available RAM never below 10.6 GB. **No paging** (page-ins median 14/s).
- 12B hybrids: RSS 6–9 GB; available RAM down to 4.2 GB (0.34 GB in one noisy run); page-ins median 0.8–7.9k/s.
- 26B hybrid: RSS 11–14 GB; **available RAM 0.2–1.3 GB (median)** and page-ins median 3.9k–34k/s: the PC's own desktop (Paseo, Slack, browsers, Defender, builds) keeps ~15 GB. The earlier note "12B on the Arc pages" applies even more to the 26B hybrid.
- The Arc: i-quants are very slow there (BatiAI iq3 on Arc: 4.7 tok/s decode, 8 tok/s prompt vs 15 tok/s for Q4_K_M and 12.5 tok/s for Q3_K_M), so the Arc is also no escape for IQ3 files.

---

## 3. Quality: 100-question bank, unmodified scorer (MEASURED)

**Scorer proof.** I import `score()` unchanged from `~/lab/spec/q4diag/quality/run_quality.py` (sha256 `dce0544c4d0a88bbcf8af0c5ce13dcc0d768306c2d491a4efe9a957c480efe50`; `questions.jsonl` sha256 `390f32b4a74d4adc9a55f79cc85de4f0971a1ea5dfa385254525a0d7ac9b5e89`). Re-scoring the 200 stored published greedy answers gave **0 mismatches** vs the stored `correct` flags and no non-determinism, so the scorer is deterministic. Python-test items use `signal.alarm`, which does not exist on Windows — scoring on the PC would silently fail every coding item — so **generation ran on the Lenovo (`lab2_bench.py quality`) and scoring on the Mac**. `finish=length` counts wrong, as in the published analysis.
**Settings, identical for every row:** greedy (temperature 0), seed 42, `max_tokens 2048`, `cache_prompt false`, one answer per question, MTP n=3 where a drafter exists, q8_0 KV. Device differs (Vulkan: Arc for K-quants, RTX for IQ3/E4B) — INFERENCE: device does not change the answers' correctness, and the published M1 Max (Metal) run of the same Q4_K_M scored 97 (no speculation) / 96 (MTP), vs my 95 on Vulkan: **±2 items is the noise floor between backends**. I did **not** reuse the M1 number; Q4_K_M was re-run here under the same stack.

| Model (file) | Score | Math 40 | Italian 20 | Coding 20 | Instr. 20 | Truncated | Draft acc. | vs Q4_K_M: only-base-right / only-this-right, exact p |
|---|---|---|---|---|---|---|---|---|
| **12B Q4_K_M** (pinned baseline) | **95** | 40 | 20 | 17 | 18 | 4 | 0.82 | – |
| 12B **QAT unsloth UD-Q4_K_XL** (own drafter) | **97** | 40 | 20 | 18 | 19 | 3 | 0.834 | 0 / 2, p=0.50 (91/100 answers textually identical) |
| 12B **QAT Google q4_0** (pinned drafter) | **95** | 40 | 20 | 18 | 17 | 2 | **0.729** | 1 / 1, p=1.0 (92/100 identical) |
| **E4B Q4_K_M** | **90** | 36 | 20 | 20 | 14 | 0 | – | 8 / 3, p=0.23 (77/100 identical) |
| 12B BatiAI **q3** (Q3_K_M, community) | **85** | 40 | 20 | **8** | 17 | **15** | 0.743 | 10 / 0, **p=0.002** (84/100 identical) |
| 12B BatiAI **iq3** (community) | **78** | 40 | 20 | **2** | 16 | **22** | 0.82 | 17 / 0, **p<0.001** (78/100 identical) |
| 26B-A4B Q4_0 QAT hybrid (RTX, `--n-cpu-moe 24`, no spec.; run paused once and resumed from its checkpoint file) | **95** | 40 | 20 | 16 | 19 | 5 | – | 2 / 2, p=1.0 (85/100 identical) |
| 12B IQ3_XXS plain requant (bartowski) — **PARTIAL, stopped by me at 71/100 answers (items 1–71: math, Italian, coding 1–11; instruction block and coding 12–20 not run; ~4 min per truncating coding item)** | 67/71 | 40/40 | 19/20 | 8/11 | not run | 4 of 71 | 0.807 | on the same 71 items: only-baseline-right 3 / only-this-right 0, p=0.25 |

How to read it:
- **The bank is nearly saturated at the top** (math 40/40 and Italian 19–20/20 for every 12B row): it cannot separate the three Q4-class 12B builds (95/97/95). Claim only "no measurable quality loss from QAT, not a gain".
- **The 3-bit builds fail on coding in a specific way:** the failing answers have *empty* final text — the model spends all 2,048 tokens inside its reasoning (6–7k characters vs 0.8–4.9k for Q4_K_M) without answering. It is reasoning inflation/looping, not wrong code (INFERENCE: with a larger token budget some would finish). In the app that is a long wait followed by a cut-off.
- E4B loses 5 items (math 36/40, instruction 14/20) but never truncates (14k tokens total vs 33–55k) — it is the *fastest to a final answer* by far.
- **QAT vs drafter match (MEASURED):** pinned (non-QAT) drafter on QAT weights: acceptance 0.74 (unsloth QAT) and 0.729 (Google QAT) vs 0.805–0.82 on Q4_K_M; unsloth's own drafter on unsloth QAT: 0.80–0.834. So **the old drafter works, but loses ~6–8 points of acceptance**; the matching speed rows show 5.1 vs 6.3 tok/s (−19%, noisy; INFERENCE: roughly −10–20% decode in the MTP regime). Use the QAT-matched drafter.

---

## 4. Temperature (the owner asked) — MEASURED

- **GPU (NVIDIA, every run, 5–10 s samples + start/end + the coordinator's 2-min watcher):** full-GPU runs go from a 55–62 °C cooled start to **82–91 °C** within 1–2 minutes (median 83–86 °C sustained). From minute ~1–2 the driver reports **SW thermal slowdown (0x20) in 78–91% of samples** and power-cap (0x4) in 0–15%; clocks drop from 2.6 GHz to 1.67–1.94 GHz (instants at 315–480 MHz). No HW slowdown (0x08/0x40) was ever seen. Short cooled runs (≤ 4–5 min, with cooling between requests) stayed clean at max 77–86 °C.
- **Effect on speed:** E4B −6.5% over 10 min, 12B iq3 full-GPU −19% (29.7 → 24.2).
- **Hybrid/CPU-bound runs** keep the RTX at 62–77 °C; the heat moves to the CPU.
- **CPU die temperature: not available.** ACPI thermal zones return 0 / −273.2 °C (`MSAcpi_ThermalZoneTemperature`, `Thermal Zone Information` counters), no sensor tool is installed and I installed none. Proxy: `% Processor Performance` stayed 89–97% (min 89% during sustained GPU runs) → no strong CPU throttling visible. Intel Arc temperature: not exposed either.
- **Sampling temperature** (separate question): speed rows above are greedy (T=0) like the previous report, plus T=1.0 rows (the app's setting): E4B unchanged (47.7), full-GPU 12B MTP 36.9 → 34.4 because draft acceptance falls 0.77 → 0.71.

---

## 5. Recommendation

**Keep Gemma 4 E4B Q4_K_M as the default for this class of PC (32 GB + RTX 4050 6 GB) among the routes asked for; the owner add-on Ling-3.0-tiny (§8) is the only challenger worth the owner's quality review, because it is ~2× faster at the same 64k fit.** It is the only row that meets all of: ≥40 tok/s decode after thermal slowdown, 1.2 s TTFT / 1.9k tok/s prompt (family-room re-reads), 3.8 GiB VRAM + 3.2 GB RAM (no paging), 64k context, 10-minute sustained at 43 tok/s, and a bank score of 90.

Why not the alternatives (all MEASURED above):
- *12B Q4_K_M / QAT hybrid:* 5–8 tok/s, 7–10 s TTFT, 4 GB RAM headroom at the low point → too slow for a room.
- *26B-A4B hybrid:* 9.5 tok/s peak, 9 s TTFT, 0.8–1.3 GB free RAM and paging, sustained 2.7–8 tok/s → rejected. (Matches the owner's earlier "Gemma 26B is not the speed answer" decision.)
- *12B 3-bit fully on the GPU:* 27–37 tok/s and TTFT 3.4 s, but (a) only at **16k** context (rule is ≥64k; at 64k it spills and falls to 8.6 tok/s), (b) coding collapses (2/20), (c) the file is a community build, (d) 91% throttled after minute 2.
- *If the owner still wants a 12B-class option on this PC:* the only defensible one is **12B QAT UD-Q4_K_XL + matching drafter as an explicit "Smarter (slow)" choice** — about 6 tok/s, ~8 s TTFT; it needs a chooser warning, and it is **not** a default. I would not offer it automatically here.

**QAT in the catalog:** adopt **unsloth QAT UD-Q4_K_XL + its matching drafter** as a candidate replacement for the 12B Q4_K_M row where a 12B runs well (Macs/GPU PCs): 12% smaller (6.26 vs 7.13 GiB), bank 97 vs 95 (tie within noise), acceptance 0.80 vs 0.80 (with the right drafter). Caveats: one 100-question bank, ±2 noise; third-party quant (Dynamic quant of Google's QAT) — Google's own `qat-q4_0` is the official file but measured 0.73 acceptance with the pinned drafter and wants its own matched drafter (the unsloth QAT drafter is the one I tested). Validate on the M1 Max (bandwidth-bound) before changing the row; do **not** replace the pinned file on evidence from this PC alone.

### What the app's model chooser would need to pick any of these (INFERENCE from the measurements)

1. **Real free VRAM, not total:** Windows left 5,152 of 6,141 MiB. Budget = weights + KV(ctx) + SWA pool + compute buffer(ubatch) + drafter + a ~300–500 MiB margin; the compute buffer grows at the first long prompt, so fit-at-load ≠ fit-at-use (ubatch 256 made the difference at 16k).
2. **A hybrid fit model:** a row is "n GPU layers + rest in RAM" with `1/tok_s ≈ GPU_bytes/BW_vram + CPU_bytes/BW_ram + fixed`; for MoE the engine's `--fit on` already offloads experts, but the chooser must *predict* the result (26B: 26 layers' experts in RAM = ~13.7 GB RSS).
3. **A prefill/TTFT gate:** hybrid prompt speed is CPU-bound (230–320 tok/s ⇒ 7–10 s for a 2k prompt) while a GPU-resident E4B does 1.9k tok/s. Decode-only floors let the 12B/26B through; a TTFT-at-2k ≤ ~4–5 s gate would reject them.
4. **Available-RAM headroom, not installed RAM:** measure MemAvailable under the owner's load and refuse a row whose RSS would leave < ~4–6 GB (the 26B left 0.8–1.3 GB and paged).
5. **Context-aware row selection:** "fits fully" only at ≤16k for the 12B-class; with the ≥64k rule the full-GPU option disappears — the chooser must price ctx explicitly (catalog already prices 64k; it must also price ubatch/compute).
6. **Thermal derate for laptop dGPUs:** apply ~−6…−20% (E4B/12B iq3 measured) to sustained decode, and prefer partial GPU use less than expected because it does not cool.
7. **MTP only with a GPU-resident drafter** (+36% vs 0% on CPU), a drafter matched to the weights (QAT-matched), and a temperature-1.0 acceptance haircut (−0.06).
8. **Plain-requant 3-bit rows must not be offered** (coding collapse); a smaller-quant variant row is only acceptable if it is QAT or if a bank/coding gate passes.

---

## 6. Caveats (read before quoting any number)

- **Shared machine.** Another agent's `cargo`/`rustc`/`link`/clippy builds, Paseo, `node`, Windows Defender (scanning fresh GGUFs) and SearchIndexer ran during the runs; `other_cores` in every telemetry file shows it. A "quiet gate" (wait ≤10 min for compile processes to end) and a cool-down gate (GPU ≤ 62 °C and no throttle bits) were used only for the final cooled rows (`r2-*`), not for the earlier rows. Hybrid rows are the most sensitive.
- Rows marked *(own tel.)* have no start/end GPU snapshot and no watcher coverage; they are clean only by my 10 s telemetry.
- 10 prompts × 1 request each; medians/mins are across prompts; `min` is dominated by single stalls. Prefill/TTFT use 3 repeats.
- Quality: 100 questions, single greedy run each, 2,048-token cap (a truncation is a wrong answer by the published rule); backends differ from the published run.
- Several earlier measurements were **superseded** because a thermal bit appeared: E4B sustained (v1), 12B-iq3 benches `f-…/g2/g3/g4`, `e-bativ3`, sustained g3, anchor-(b) run 2. They are kept in the telemetry folder; their numbers are not used above except where labelled.
- A first BatiAI iq3 quality attempt on the Arc was aborted at 61/100 (4.7 tok/s) and redone on the RTX.

---

## 7. Provenance, hashes, commands

| File | Source (commit/digest) | Bytes | sha256 (verified on the PC) |
|---|---|---|---|
| gemma-4-E4B-it-Q4_K_M.gguf | unsloth/gemma-4-E4B-it-GGUF @ bfc15c38 (catalog pin) | 4,977,171,584 | 85a896a0…fab87 ✔ |
| gemma-4-12B-it-Q4_K_M.gguf | bartowski/gemma-4-12B-it-GGUF @ 2ae7d41b (catalog pin) | 7,662,533,088 | 3962624d…71509 ✔ |
| mtp-gemma-4-12B-it-Q8_0.gguf (pinned drafter) | ggml-org/gemma-4-12B-it-GGUF @ e3e68173 | 465,109,152 | 16c90eb9…f0610 ✔ |
| gemma-4-26B_q4_0-it.gguf | google/gemma-4-26B-A4B-it-qat-q4_0-gguf @ d1c082be (catalog pin) | 14,439,363,584 | 3eca3b8f…eca51d ✔ |
| gemma-4-12B-it-qat-UD-Q4_K_XL.gguf | unsloth/gemma-4-12B-it-qat-GGUF @ 980b060c (apache-2.0; HF LFS oid) | 6,716,356,800 | 90fd44e2…0c370 ✔ |
| mtp-unsloth-qat-Q8_0.gguf (QAT drafter) | same repo, `MTP/mtp-gemma-4-12B-it-Q8_0.gguf` | 465,127,936 | f58dff98…eaec1b ✔ |
| gemma-4-12b-it-qat-q4_0-google.gguf | google/gemma-4-12B-it-qat-q4_0-gguf @ 29d09777 (official) | 6,975,879,296 | 93567e57…a538b ✔ |
| gemma-4-12B-it-IQ3_XXS.gguf | bartowski/gemma-4-12B-it-GGUF @ 2ae7d41b | 5,145,090,528 | 3a85fa01…6f4c3 ✔ |
| batiai-gemma4-12b-q3.gguf | **community** — `ollama.com/batiai/gemma4-12b:q3`, registry blob | 6,087,087,360 | f3f3549c…c459b6 ✔ (= the blob digest) |
| batiai-gemma4-12b-iq3.gguf | **community** — `…:iq3`, registry blob | 4,849,194,528 | 21a4aaea…84f7f ✔ |

**BatiAI provenance (community build — do not ship without review):** the model page (`ollama.com/batiai/gemma4-12b:q3`) says "Gemma 4 12B-it — Quantized by BatiAI … Quantized directly from official Google weights … imatrix calibrated (IQ variants) … BatiAI signed (general.author=BatiAI) … Built for BatiFlow" (a Mac automation app, BatiAI is its maker). Manifest config: `model_format gguf, model_family gemma4, model_type 11.9B, file_type Q3_K_M`. So it is **a plain post-training requant (Q3_K_M, no imatrix claimed for q3), NOT QAT**; the Ollama param layer ships `temperature 0.7`, `num_ctx 131072`, system prompt "You are a helpful AI assistant." (ignored by us). It loads fine in the fork (standard `gemma4` GGUF), and it is not a different model — only worse.

Commands (all on the PC via `ssh -i ~/.ssh/qdc_ed25519 gualt@100.102.128.70`; `<PY>` = `C:\Users\gualt\AppData\Local\Programs\Python\Python312\python.exe`):
```
<PY> C:\kalsa-bench\mtp\lab2\lab2_bench.py --config <tag>.json --mode bench   [--temp 1.0] [--cool-to 62 --quiet-wait 10 --req-cool 78 --telemetry-interval 5]
<PY> …\lab2_bench.py --config <tag>.json --mode sustain --minutes 10 --cool-to 62 --quiet-wait 10 --telemetry-interval 5
<PY> …\lab2_bench.py --config <tag>.json --mode quality     # generation only; scoring: python3 lab2/score.py qa-q4km <tags…> on the Mac
```
Server argv (printed in every `*-run.log`): `llama-server.exe --host 127.0.0.1 --port 8301 --model <gguf> --device Vulkan0 --fit on --fit-target 300 --threads 6 --threads-batch 6 --batch-size 2048 --ubatch-size 512 --ctx-size 65536 --flash-attn on --cache-type-k q8_0 --cache-type-v q8_0 --temp 0 --top-p 0.95 --top-k 64 --no-webui --parallel 1 --sleep-idle-seconds 300 --cache-ram 0` (+ `--model-draft <drafter> --spec-type draft-mtp --spec-draft-n-max 3 --spec-draft-n-min 0 --spec-draft-type-k q8_0 --spec-draft-type-v q8_0 --spec-draft-device Vulkan0`; full-GPU rows: `--fit off -ngl 99 --ctx-size 16384 --ubatch-size 256`; 26B: `--fit off -ngl 99 --n-cpu-moe 24`; Arc quality rows: `--device Vulkan1 --fit off -ngl 99 --ctx-size 16384`). Configs: `lab2/cfg/*.json`. Everything of mine on the PC is under `C:\kalsa-bench\` (models 20+ GB, scripts, logs).

---

## 8. Ling tiny 3 8B (owner add-on)

### What it is (MEASURED from Hugging Face and the fork source — quotes are verbatim)
- The owner's "Ling tiny 3 8B" is **`inclusionAI/Ling-3.0-tiny`** (official, author inclusionAI, `license: mit`, not gated, last modified 2026-09-24; repo sha 9a98e35f). Card: "**Ling-3.0-tiny**, a lightweight hybrid reasoning MoE model with **7.9B** total parameters and only **1.3B** activated parameters per token." / "a 3:1 alternating stacking of KDA and MLA (3 Kimi Delta Attention layers followed by 1 Multi-Head Latent Attention layer per 4-layer block) with a sparse MoE FFN comprising 128 routed experts. Each token activates only 8 routed experts and 1 shared expert." / "Thinking mode is enabled by default. The recommended sampling parameters … are `temperature=1.0`, `top_p=0.95`, and `top_k=20`." So: **MoE (not dense), 7.9B total / 1.3B active.**
- **Official GGUF exists:** `inclusionAI/Ling-3.0-tiny-GGUF` @ 01b850e2 (mit; architecture `bailingmoe3`, context_length 131072). Files: Q4_K_M 4,823,894,944 B (4.49 GiB), Q5_K_M, Q6_K, Q8_0, bf16. I used the **official Q4_K_M** (same quant class as my E4B/12B rows). **sha256 `246d67d45f5b0c7447ca0ce0bdb8b46b8a47b593c5068635dc16422c051d7be9` = the HF LFS oid, verified on the PC** (curl exit 0, size exact).
- **The fork loads it:** `git grep` in `kalsallama` at `e8065c7cf` (read-only): `src/llama-arch.cpp:113 { LLM_ARCH_BAILINGMOE3, "bailingmoe3" }`, `src/llama-model.cpp:267-268 case LLM_ARCH_BAILINGMOE3: return new llama_model_bailingmoe3(params);`. It loaded and ran without any patch. **Caveat:** the Windows app currently pins fork **v1.1.2** (memory note) — I did *not* verify that v1.1.2 contains `bailingmoe3`; `e8065c7cf` (v1.1.3 candidate) does.
- It is a hybrid-linear-attention model, so its KV cache is tiny: **229.5 MiB at 64k context** (vs 800+ MiB for the 12B).

### Speed (MEASURED; cooled start 61–62 °C, quiet-gated, no thermal bit in my 5 s telemetry; protocol identical to §0)

| Row | Decode med/min tok/s | Prompt tok/s (2.07k) | TTFT | VRAM / RSS / free RAM low | Thermal |
|---|---|---|---|---|---|
| Ling Q4_K_M, `--fit on` auto (fit leaves "2 overflowing" layers' experts in RAM, 4.77 GiB projected) | 96.0 / 93.1 | 2,391 | 0.90 s | 4.8 GiB / 4.8 GB / 11.2 GB | clean (max 77 °C) |
| **Ling Q4_K_M, all 25 layers on the GPU, ctx 65,536, q8 KV** (best split) | **99.1 / 86.3** | **2,932** | **0.76 s** | **4.87 GiB / 4.8 GB / 11.9 GB** | clean (max 72 °C) |
| …same at temperature 1.0 (the card's sampling) | 115.8 / 109.9 | 2,920 | 0.74 s | same | clean (max 73 °C) |
| *E4B Q4_K_M (§1)* | *46.6 / 42.9* | *1,903* | *1.22 s* | *3.8 GiB / 3.2 GB / 12.3 GB* | *clean* |
| *Best 12B for speed (BatiAI iq3, full GPU, **16k ctx**, MTP)* | *36.9 / 29.1* | *644* | *3.4 s* | *5.6 GiB* | *clean* |
| *12B Q4_K_M/QAT hybrid, 64k (the quality rows)* | *6–8 / 2–5* | *294–325* | *7–8 s* | *5.4 GiB / 7.7–9 GB / 4–6 GB* | *clean* |

- Best split = **everything on the RTX at the full 64k context**: 4,465 MiB weights + 230 MiB KV + ~133 MiB compute = 4,989 MiB used of 5,152 free. This is the **first row on this PC that is fully GPU-resident at 64k**. `--fit on` alone does not find it (it keeps a 300 MiB margin and spills 2 layers), a chooser must test "all layers" explicitly.
- No MTP drafter exists for it (none tried; the card mentions a built-in NEXTN only for SGLang).
- Speed varies with the text (MoE routing): greedy 99 vs T=1.0 116 tok/s on the same prompts.

**Sustained 10 min (continuous 2k-token prompt + ≤192 tokens, per-minute; all-GPU config) — THROTTLED floor (SW thermal 0x20 in 74% of samples, GPU median 86 °C / max 90 °C; 4 watcher samples; start 62 °C):**
decode per minute **96.8, 90.0, 71.9, 103.2, 106.4, 92.4, 95.5, 42.9, 66.8, 81.0** tok/s (median of minutes 91, worst minute 42.9); prompt 2,860 → 2,247 (worst minute 1,866). The two dips (minutes 3 and 8) coincide with other-process CPU bursts (Defender/node up to ~10 cores), thermal slowdown and one stall where GPU power fell to 8.7 W — I cannot separate them. RAM: RSS 4.8 GB, free RAM never below 8.8 GB, page-ins median 69/s (no paging). Not a clean speed number by the rule; even its worst minute (42.9) equals E4B's throttled steady state (43–46).

### Quality (MEASURED, same bank, same scorer, same settings as §3)
| Model | Bank score | Math | Italian | Coding | Instr. | Truncated | Total tokens generated |
|---|---|---|---|---|---|---|---|
| **Ling-3.0-tiny Q4_K_M** (RTX, all-GPU) | **95** | 40 | 19 | 19 | 17 | 1 | 14.9k |
| 12B Q4_K_M (baseline) | 95 | 40 | 20 | 17 | 18 | 4 | 35.1k |
| E4B Q4_K_M | 90 | 36 | 20 | 20 | 14 | 0 | 14.1k |

vs the 12B Q4_K_M baseline: 3 only-baseline-right / 3 only-Ling-right, p=1.0; 72/100 answers textually identical. Wrong: coding-14, instruction-10/14/19, italian-14. Same caveat as before: the bank is saturated at the top and cannot separate 95 from 97.

**The owner's own Italian quiz (`docs/quiz-2026-09-26`, 26 questions; his `grade.py` applied unchanged, read-only; same sampling recipe he used for other models, here the card's: T=1.0 / top_p 0.95 / top_k 20, 3 seeds, 6,000 tokens; plus greedy):**
| Run | Script score (18 gradable) |
|---|---|
| greedy | 15/18 (1 empty answer) |
| seeds 1/2/3 | 14, 15, 16 → **45/54** (2 empty answers in s2) |
| *his table, same grader (other models, other hardware/sampling)* | *E4B Q4_K_M 49, 12B Q4_K_M 48, LFM2.5 BF16 48, Q8 47, Q6_K 50, Q4_0 QAD 48* |

The script mis-scored nothing in Ling's favour that I could find on a hand read of the failures. Specific problems (answers quoted): **Spa 2000 → "Michael Schumacher" 0/3** (the 12B also 0/3; E4B 1/3 wrong); **heptagon → "enneagono, 9 lati" / "4 lati" / "decagono, 10"** (0/3; greedy: "esagono, 6 lati"); **greedy: *I promessi sposi* → "Giovanni Berchet (nato Giovanni Mannini)"** (3 sampled seeds correct); greedy feathers-vs-iron: says a kilo of feathers is lighter (450 g); Berlin wall "eretto … dal governo **estone**"; "feche di barbone (le feci di lumache o lombrici)"; one answer wrote **"venerdà"** for "venerdì" (accent corruption); the 4-line rhymed poem on coffee is broken; **greedy *Odyssey in one sentence* ran to the 6,000-token limit with an empty answer** (and 2 more empties in seed 2), i.e. reasoning loops without an answer in 3 of 104 quiz runs and 1 of 100 bank runs. Right: capital, Manzoni (sampled), 1989, "r" in ferrovia, apples, plane riddle, Po, Michelangelo, H₂O₂, cat/microwave, Tuesday+10, translation, gold, Napolitano, 1440, whale, 2034.

### Comparison and reading (INFERENCE where marked)
- **vs E4B:** 2.1× decode (99 vs 47; ~91 vs ~44 even in the throttled sustained median), 1.5× prompt (2,932 vs 1,903), TTFT 0.76 vs 1.22 s, +1.1 GiB VRAM, +1.6 GB RAM, no paging, same 64k context, bank 95 vs 90 (p not significant, but math 40 vs 36). On the owner's quiz Ling is **3–4 points lower** (45 vs 49/48) with more invented detail and an accent glitch.
- **vs the best 12B:** it beats every 12B row on this PC on speed (the 12B quality rows are 6–8 tok/s, TTFT 7–8 s; the only fast 12B is a 3-bit build at 16k that fails coding) and ties the 12B Q4_K_M on the bank (95) while thinking ~2.4× less (14.9k vs 35k tokens). The 12B is still the more *knowledgeable* model on the quiz (48 vs 45 by his grader; INFERENCE: small sample, ±3).
- **Why it is fast (INFERENCE):** 1.3B active params ⇒ ~0.75 GB of weights read per token, ×~2 MoE traffic factor (the catalog's 2.06×) ≈ 1.5 GB/token over the RTX's ~190 GB/s ⇒ ~120 tok/s ceiling; measured 99–116, consistent.
- **Caution (owner's earlier verdict):** LFM2.5-8B-A1B (a small MoE) was rejected on quality; Ling is a *different* model and scores far better on the bank, but the quiz shows the same family of weakness (factual slips, language polish). I would **not** pitch it as "the answer" — it is a strong, cheap *Faster* candidate for 6 GB-VRAM PCs that needs the owner's own Italian-chat judgement before anything ships.
- **What the chooser would need for it:** (1) treat a MoE whose total bytes fit free VRAM as a plain full-GPU row — here 4.49 GiB + 0.23 + 0.13 ≤ 5.15 — and test all-layers explicitly instead of trusting `--fit`'s margin; (2) the hybrid-linear KV model (KDA/MLA) with ~3.6 KiB/token growth, not the Gemma sliding-window formula; (3) predicted decode from *active* bytes ×2 (works: ~120 predicted vs 99–116 measured); (4) engine version gate for `bailingmoe3` (present in `e8065c7cf`, unverified in the pinned v1.1.2); (5) sampling from the card (1.0 / 0.95 / 20, thinking default on) and a reasoning-loop guard (empty answers at 6,000 tokens).


---

## 9. Intel Arc iGPU — can it make Gemma 12B usable on the Lenovo? (2026-10-01, fork `e8065c7cf`)

**Answer (MEASURED): no. TTFT is the problem, not decode.** On the ~2.07k-token prompt the 12B waits **26–34 s before the first word on the Arc, 16–23 s split across RTX+Arc** (room rule: ≤ ~4–5 s), in every configuration tried; MTP lifts decode to ~16–18 tok/s but does nothing for prompt processing (it makes it slightly worse). Even E4B on the Arc waits 10.3 s. Source for every number: the `*-summary.json` named in the table / text, copied to `~/lab/spec/lenovo-mtp/lab2/results/` (telemetry `*.telemetry.jsonl`, logs `*.run.log` / `*.server.log` beside them); PC originals under `C:\kalsa-bench\mtp\lab2\`.

### 9.1 Method and device proof
- Harness: mine (`lab2_bench.py`), protocol as §0: 10 fixed prompts × 128 tokens, seed 42, greedy; warm-up excluded; three unique ~2,069-token prompts for prompt tok/s (cache off) and for streamed TTFT; `--ctx-size 65536`, q8_0 KV, flash-attn, batch 2048 / ubatch 512, 6 threads, **`--device Vulkan1 --fit off -ngl 99`** (all layers forced onto the Arc; MTP drafter `--spec-draft-device Vulkan1`). Cool-start gate (RTX ≤ 62 °C as a chassis proxy) and quiet gate (≤ 10 min wait for compile processes) before each row; telemetry every 5 s. Config files: `lab2/cfg/ar-*.json`, `du-*.json` (argv is also printed in each `*.run.log`).
- **Proof the Arc ran it** (`results/ar-12b-n3-probe.server.log`, run with `-lv 5`; `results/ar-12b-n3-probe.summary.json`): `load_tensors: offloaded 49/49 layers to GPU`, `Vulkan1 model buffer size = 7292.47 MiB`, KV buffers `Vulkan1 544 + 255 MiB`; **54 `assigned to device Vulkan1` lines, 0 for `Vulkan0`, no non-zero `Vulkan0` buffer**; RTX `nvidia-smi` memory used = **5 MiB** (`vram_used_mib` in that summary and `RTX vram max` in every Arc row's telemetry). The Windows per-process GPU counters in every `*.telemetry.jsonl` (`gpu_proc`) show the server on adapter LUID `0x00000000_0x00012645` at 94–99% median engine use and **7.5–9.0 GB of *shared* (= system) memory** for the 12B, 3.8 GB for E4B.
- Version string for all rows: `0.4.1-dev (build 0, commit unknown)` (`server_version` field; the first row `ar-12b-off` predates that field, same binary dir `build-vulkan\bin`).

### 9.2 Rows (all numbers read from the named summary / telemetry file)
| Row | **TTFT @2k med/min** | Prompt tok/s | Decode med/min | Accept | RSS / free-RAM low | Page-ins/s med | Pkg W / iGPU W (med) | RTX thermal bits | Source (`C:\kalsa-bench\mtp\lab2\`) |
|---|---|---|---|---|---|---|---|---|---|
| 12B Q4_K_M, Arc, MTP off | **28.5 / 28.4 s** | 74 | 6.0 / 5.9 | – | 9.3 GB / 4.2 GB | 16 | 32 / 18 | 0x0 | `ar-12b-off-bench.summary.json` |
| 12B Q4_K_M, Arc, MTP n=2 | **33.8 / 30.6 s** | 73 | 13.0 / 11.9 | 0.873 | 10.4 GB / 1.8 GB | 34 | 36 / 21 | 0x0 | `ar-12b-n2-bench.summary.json` |
| 12B Q4_K_M, Arc, MTP n=3 | **29.7 / 28.6 s** | 73 | 16.3 / 13.7 | 0.797 | 10.4 GB / 3.7 GB | 146 | 39 / 23 | 0x0 | `ar-12b-n3-bench.summary.json` |
| 12B Q4_K_M, Arc, MTP n=4 | **28.6 / 28.3 s** | 73 | 16.8 / 12.6 | 0.754 | 10.4 GB / 4.2 GB | 17 | 38 / 23 | 0x0 | `ar-12b-n4-bench.summary.json` |
| 12B Q4_K_M, Arc, MTP n=4, T=1.0 | **33.8 / 31.7 s** | 65 | 15.2 / 12.0 | 0.709 | 10.4 GB / 1.0 GB | 2453 | 45 / 23 | 0x0 | `ar-12b-n4-t1-bench.summary.json` |
| 12B QAT UD-Q4_K_XL, Arc, MTP off | **25.9 / 25.7 s** | 84 | 7.2 / 7.0 | – | 8.2 GB / 3.9 GB | 461 | 33 / 17 | 0x0 | `ar-qat-off-bench.summary.json` |
| 12B QAT, Arc, own drafter n=3 | **28.1 / 27.8 s** | 73 | 14.9 / 11.5 | 0.802 | 9.2 GB / 0.1 GB | 8364 | 39 / 18 | 0x0 | `ar-qat-n3-bench.summary.json` |
| 12B QAT, Arc, own drafter n=4 | **28.4 / 26.9 s** | 77 | 18.4 / 14.7 | 0.764 | 9.3 GB / 1.2 GB | 1042 | 44 / 21 | 0x0 | `ar-qat-n4-bench.summary.json` |
| 12B Q4_K_M, RTX+Arc split 5/5, MTP off | **17.6 / 16.9 s** | 122 | 8.3 / 5.9 | – | 6.1 GB / 5.5 GB | 72 | 36 / 13 | 0x0 | `du-12b-ts55-off-bench.summary.json` |
| 12B Q4_K_M, RTX+Arc split 5/5, MTP n=3 | **22.8 / 22.5 s** | 114 | 16.1 / 10.2 | 0.808 | 7.1 GB / 4.4 GB | 9745 | 38 / 13 | 0x20 (THROTTLED) | `du-12b-ts55-n3-bench.summary.json` |
| 12B Q4_K_M, RTX+Arc split 6/4, MTP n=3 | **15.8 / 15.5 s** | 148 | 18.9 / 16.7 | 0.833 | 6.4 GB / 3.2 GB | 2062 | 32 / 13 | 0x0 | `du-12b-ts64-n3-bench.summary.json` |
| E4B Q4_K_M, Arc | **10.3 / 10.2 s** | 181 | 13.0 / 12.2 | – | 6.2 GB / 4.2 GB | 3499 | 43 / 17 | 0x20 (THROTTLED) | `ar-e4b-bench.summary.json` |
| *E4B Q4_K_M, RTX (reference)* | **1.2 / 1.2 s** | 1903 | 46.6 / 42.9 | – | 3.2 GB / 12.0 GB | 205 | nan / nan | 0x0 | `r2-e4b-bench.summary.json` |
| *Ling-3.0-tiny Q4_K_M, all GPU 64k (reference)* | **0.8 / 0.7 s** | 2932 | 99.1 / 86.3 | – | 4.7 GB / 11.7 GB | 4 | nan / nan | 0x0 | `r3-ling-full-bench.summary.json` |

Notes on the table: *Accept* = draft acceptance (summary field `acceptance`). *RSS* = server working set (median), *free-RAM low* = minimum `avail_mb` in telemetry; Arc rows use system RAM as video memory, so RSS + shared memory are the same pages. Power = RAPL `Energy Meter` counters in the telemetry (package; iGPU rail "PP1"); `nan` = telemetry of those older reference rows predates the power counters. **THROTTLED / thermal bit:** the 0x20 (SW thermal slowdown) bit is NVIDIA's on the *RTX*; for Arc-only rows the RTX is idle, so the bit there means "the chassis was hot" (E4B-on-Arc row: RTX idle at ≤ 71 °C, bit set → thermally suspect, I did not re-run). The split 5/5 n=3 row had the RTX working and the bit set → **THROTTLED, not a clean speed number** (the cooler 6/4 row and the 5/5 MTP-off row are clean). The coordinator's `thermal.log` ends at 2026-10-01 03:59, so these rows rely on my own 5 s telemetry plus start/end snapshots only.

Extra rows / facts:
- **12B QAT UD-Q4_K_XL + matching drafter on the Arc** (6.26 GiB, 25.9 s TTFT MTP-off, `ar-qat-off`; n=3 / n=4 above): the smaller file prefilled 14% faster (84 vs 74 tok/s) and reached **18.4 tok/s** at n=4 — the best Arc decode — but with free RAM down to 0.1–1.2 GB and heavy paging (8.4k page-ins/s median in `ar-qat-n3`; `other_cores` 6.0 there, i.e. other agents were busy), so those two rows are noisy.
- **RTX+Arc split** (`--device Vulkan0,Vulkan1 --tensor-split …`, `results/du-12b-ts64-n3-probe.server.log`: `Vulkan0 model buffer 4044 MiB`, `Vulkan1 3248 MiB`, both KV pools split): loads cleanly at 5/5 and 6/4 and halves the Arc's share of prefill, but the ceiling is the RTX's 5,152 MiB: 6/4 already uses **5,129 MiB** (`du-12b-ts64-n3-bench.summary.json` telemetry `vram_used_mib` max), so a bigger RTX share would not fit. **Drafter on the RTX in a split run crashes at load** (exit code 3221226505 = `0xC0000409`, `results/du-12b-ts55-n3-drRTX-probe.run.log`) — the drafter stays on the Arc. Best split: **TTFT 15.8 s, decode 18.9 tok/s** — still 3–4× over the room limit.
- **Temperature 1.0** (the app's sampling): best Arc row (12B n=4) becomes TTFT 33.8 s, decode 15.2 / 12.0, acceptance 0.709 (`ar-12b-n4-t1-bench.summary.json`) vs 28.6 s / 16.8 / 0.754 greedy.

### 9.3 Sustained 10 minutes, best Arc row (12B Q4_K_M, MTP n=4; 2k-token prompt + ≤192 new tokens per request)
Source: `results/ar-12b-n4-sustain.summary.json` / `.telemetry.jsonl`. Per-minute decode **9.8, 10.7, 10.5, 10.1, 8.4, 10.2, 10.4, 10.3, 10.7, 8.4 tok/s**; prompt **50–66 tok/s**; **12 requests in 10 minutes**; the **median wait before each answer's first token (prompt time) was 32.3 s, worst 41.2 s**. RAM: free RAM min **0.44 GB** (median 2.5 GB), page-ins median 3.8k/s, p90 93k/s, other-process CPU median 6 cores — i.e. it **pages under the PC's real load** (same conclusion as the earlier Arc sustained attempt, which was stopped for paging). No RTX thermal bit, CPU `Performance Limit Flags` always 0, `% Performance Limit` always 100.

### 9.4 What I could and could not measure on the Arc
- **Could:** engine utilization per adapter (GPU Engine counters), system memory used as VRAM (GPU Process Memory counters), **RAPL package / cores / iGPU-rail power** (package median 32–33 W MTP-off → 36–45 W with MTP; iGPU rail 17–23 W; DRAM rail reads 0, unsupported), CPU actual frequency (median 2.0–2.2 GHz), CPU performance-limit flags/percent (never limited), free RAM and page-ins, RTX temperature/throttle bits as a chassis proxy. (INFERENCE, package power only, not wall power: ≈ 5.3 J/token MTP-off vs ≈ 2.3 J/token MTP n=4 on the 12B.)
- **Could not:** Arc temperature, Arc clock, CPU die temperature (ACPI thermal zones read 0 / −273 °C; no vendor sensor tool installed, none installed by me), wall power. The Arc does not appear in `nvidia-smi`.

### 9.5 Previous (luna) Arc claim, re-verified
Previous report: Arc 12B MTP-off 7.03 → n=2 11.98 → n=3 14.0 → n=4 14.7 tok/s, prompt 69 tok/s, TTFT ~29–30 s. Mine: **5.96 → 13.0 → 16.3 → 16.8**, prompt **73 tok/s**, TTFT **28.6–29.7 s** (`ar-12b-off/n2/n3/n4-bench.summary.json`). So the *shape holds* (≈2.8× from MTP, best at n=3–4), the off baseline is 15% lower, MTP rows 7–19% higher; the **prompt speed and the ~29 s TTFT are confirmed** — and they are what decides usability.

### 9.6 Verdict against the room rule and the other candidates
- **12B on the Arc: not usable** — TTFT 25.9–33.8 s (all `ar-12b-*`, `ar-qat-*` rows), ~64 tok/s prompt and a 32 s median first-token wait in the 10-minute run, 9 GB of the PC's RAM taken, paging. **12B split RTX+Arc: not usable** — TTFT 15.8–22.8 s, RTX VRAM at the limit.
- **E4B on the Arc is a sensible *fallback* when the RTX is busy, not a room model:** 13.0 tok/s, TTFT 10.3 s, 3.8 GB shared memory (`ar-e4b-bench.summary.json`) — twice the room limit, vs E4B on the RTX 46.6 tok/s / 1.2 s (`r2-e4b-bench.summary.json`) and Ling all-GPU 99.1 tok/s / 0.76 s (`r3-ling-full-bench.summary.json`).
- Quality is unchanged by device (the same GGUFs; scores in §3: Q4_K_M 95, QAT 97, E4B 90); the Arc only changes speed and RAM use.
- **Chooser implication (INFERENCE):** the iGPU's prefill rate (73–84 tok/s for a 12B, 181 for E4B) must be a separate predicted number; an Arc row with TTFT@2k > ~5 s should not be offered as a room model whatever its decode speed. Treat the Arc as a ≤ 4B-class device or as a fallback.

### 9.7 Exact re-run commands for the v1.1.4 asset (only `--bin-dir` / `--tag-suffix` change; for the v1.1.4 asset also `--exe-name kalsa-server.exe`; write the suffix as `--tag-suffix=-v114`, argparse rejects `--tag-suffix -v114`)
`<BIN>` = directory containing the v1.1.4 Windows Vulkan `llama-server.exe` and its DLLs (the harness puts it first on `PATH` together with the Vulkan SDK `bin`). `<PY>` = `C:\Users\gualt\AppData\Local\Programs\Python\Python312\python.exe`. Each row writes `<tag>-v114-bench.summary.json` (fields `bin_dir` and `server_version` record what ran) next to the `e8065c7cf` files; the e8065c7cf rows above are never overwritten.
```
# 1) E4B Q4_K_M on the RTX (baseline row: r2-e4b-bench.summary.json)
<PY> C:\kalsa-bench\mtp\lab2\lab2_bench.py --config C:\kalsa-bench\mtp\lab2\r2-e4b.json --mode bench --cool-to 62 --quiet-wait 10 --req-cool 78 --telemetry-interval 5 --bin-dir <BIN> --tag-suffix=-v114
# 2) Ling-3.0-tiny Q4_K_M, all 25 layers on the GPU, ctx 65536 (baseline: r3-ling-full-bench.summary.json)
<PY> C:\kalsa-bench\mtp\lab2\lab2_bench.py --config C:\kalsa-bench\mtp\lab2\r3-ling-full.json --mode bench --cool-to 62 --quiet-wait 10 --req-cool 78 --telemetry-interval 5 --bin-dir <BIN> --tag-suffix=-v114
# 3) best Arc row: 12B Q4_K_M on the Arc, MTP n=4 (baseline: ar-12b-n4-bench.summary.json) and MTP off (ar-12b-off-bench.summary.json)
<PY> C:\kalsa-bench\mtp\lab2\lab2_bench.py --config C:\kalsa-bench\mtp\lab2\ar-12b-n4.json  --mode bench --cool-to 62 --quiet-wait 10 --telemetry-interval 5 --bin-dir <BIN> --tag-suffix=-v114
<PY> C:\kalsa-bench\mtp\lab2\lab2_bench.py --config C:\kalsa-bench\mtp\lab2\ar-12b-off.json --mode bench --cool-to 62 --quiet-wait 10 --telemetry-interval 5 --bin-dir <BIN> --tag-suffix=-v114
```
Detached (survives an SSH logout) — put the four lines into `C:\kalsa-bench\mtp\lab2\queue-v114.txt` in the form `<tag> bench <same flags> --bin-dir <BIN> --tag-suffix=-v114` (e.g. `r2-e4b bench --cool-to 62 --quiet-wait 10 --req-cool 78 --telemetry-interval 5 --bin-dir <BIN> --tag-suffix=-v114`) and run `powershell -File C:\kalsa-bench\mtp\lab2\launch.ps1 -QueueFile C:\kalsa-bench\mtp\lab2\queue-v114.txt`; progress in `queue.log`. Compare with `python3 lab2/arcrow.py <tag>-v114` (fetches summary+telemetry from the PC). Optional sustained / T=1.0 rows: same line with `--mode sustain --minutes 10` or `--temp 1.0`.
Caveats for any re-run: another agent's builds, Paseo and Defender share the PC (`other_cores` in telemetry); prefer a moment when `cargo`/`rustc` are idle; the Arc rows are RAM-limited (free RAM fell to 0.1–1.2 GB in some runs).


---

## 10. Engine v1.1.4 (kalsa-server 0.5.0-dev, build 11585, commit 61c909481) vs e8065c7cf (2026-10-01)

**Verdict in one line:** v1.1.4 is **not slower** on this PC; the −35% Ling reading was a cold-page-cache run under load, not the engine (§10.3). E4B gets **1.9× decode from the official MTP drafter** (§10.4). The tiled-MM prefill on the CPU build is **~1.3× faster** than with it off (§10.5).

### 10.1 What ran, integrity
- Downloaded to `C:\kalsa-bench\v114\` (nothing else touched): `kalsa-server-v1.1.4-bin-win-vulkan-x64.zip` 27,831,749 B sha256 `5fcea54b…df75e3` ✔ and `…-bin-win-cpu-x64.zip` 14,487,114 B sha256 `122c2ca1…ed4307e` ✔ (`results/v114-download-verify.txt`). Extracted `kalsa-server.exe` sha256: Vulkan `147fa7b8…792b26` ✔, CPU `a7ac3d1f…12ca26` ✔ (both match the values you gave, hashed on the PC *before* any run). VC++ DLLs ship beside the exe. `--version`: `0.5.0-dev (build 11585, commit 61c909481)`, MSVC 19.51; Vulkan build lists Vulkan0 = RTX 4050, Vulkan1 = Arc; the CPU zip ships per-CPU backend DLLs (alderlake, haswell, sandybridge, skylakex, …); which one loaded was **not** logged at default verbosity (`results/v114-version-devices-flags.txt`); the verbose v1.1.4 log's feature string shows AVX, AVX_VNNI, AVX2, FMA, BMI2.
- E4B drafter `mtp-gemma-4-E4B-it-Q8_0.gguf`: 98,653,280 B, sha256 `f38ae629…8b665` ✔ (same file).
- Harness changes (no engine change): `--bin-dir` / `--exe-name kalsa-server.exe` / `--tag-suffix=-v114` (**write the suffix with `=`**: argparse rejects `--tag-suffix -v114`; §9.7 above is corrected), page-cache prewarm of every GGUF before the server starts (field `prewarm_s`; added *after* the first v1.1.4 Ling run, see §10.3), quick decode probe, `--priority high` for CPU rows, `decode` / `prefill` modes, and telemetry for per-process faults. An earlier bug: my telemetry counted `kalsa-server.exe` as "other" CPU, so the `other_cores` field of the first v1.1.4 rows is inflated; real other load was Defender/Paseo/rustc at ~2–3 cores.

### 10.2 Rows 1–3: v1.1.4 vs e8065c7cf (same configs, same cool-start discipline; summary file named per row)
| Row | TTFT @2k | Prompt tok/s | Decode med/min | Accept | VRAM max (RTX) | RSS / free-RAM low | RTX thermal bits | Source |
|---|---|---|---|---|---|---|---|---|
| E4B RTX, e8065c7cf | **1.22 s** | 1903 | 46.6 / 42.9 | – | 3809 MiB | 3.2 GB / 12.0 GB | 0x0 | `r2-e4b-bench.summary.json` |
| E4B RTX, v1.1.4 | **1.23 s** | 1857 | 45.7 / 44.4 | – | 3809 MiB | 3.2 GB / 7.0 GB | 0x0 | `r2-e4b-v114-bench.summary.json` |
| Ling all-GPU 64k, e8065c7cf (original run) | **0.76 s** | 2932 | 99.1 / 86.3 | – | 4989 MiB | 4.7 GB / 11.7 GB | 0x0 | `r3-ling-full-bench.summary.json` |
| Ling all-GPU 64k, v1.1.4 (first run, cold cache) | **0.78 s** | 2736 | 64.0 / 50.9 | – | 4982 MiB | 4.8 GB / 2.6 GB | 0x0 | `r3-ling-full-v114-bench.summary.json` |
| 12B Arc MTP off, e8065c7cf | **28.51 s** | 74 | 6.0 / 5.9 | – | 5 MiB | 9.3 GB / 4.2 GB | 0x0 | `ar-12b-off-bench.summary.json` |
| 12B Arc MTP off, v1.1.4 | **31.91 s** | 61 | 5.6 / 4.6 | – | 0 MiB | 9.4 GB / 1.0 GB | 0x20 THROTTLED | `ar-12b-off-v114-bench.summary.json` |
| 12B Arc MTP n=4, e8065c7cf | **28.56 s** | 73 | 16.8 / 12.6 | 0.754 | 5 MiB | 10.4 GB / 4.2 GB | 0x0 | `ar-12b-n4-bench.summary.json` |
| 12B Arc MTP n=4, v1.1.4 | **29.75 s** | 72 | 17.1 / 13.0 | 0.754 | 53 MiB | 10.4 GB / 3.0 GB | 0x20 THROTTLED | `ar-12b-n4-v114-bench.summary.json` |

- **E4B on the RTX: no change** (decode 45.7 vs 46.6, prompt 1,857 vs 1,903, TTFT 1.23 vs 1.22 s, VRAM identical).
- **Ling: see §10.3** — the single 63.99 reading does not reproduce.
- **Arc 12B:** n=4 matches (17.1 vs 16.8 tok/s, TTFT 29.8 vs 28.6 s, acceptance 0.754 both); the MTP-off row was slower on prompt (61 vs 74 tok/s, TTFT 31.9 vs 28.5 s) in a run where another process held ~6 cores and the (idle) RTX showed a thermal bit (chassis hot): thermally suspect; the interleaved e8065c7cf/v1.1.4 repeat of these two Arc rows is in §10.7 (no build difference).

### 10.3 Ling-3.0-tiny all-GPU 64k: is v1.1.4 a regression? **No (not confirmed; effect ≤ ~8%, inside run-to-run noise)**
The first v1.1.4 run read 63.99 / 50.9 tok/s vs 99.13 / 86.3 on e8065c7cf. Re-checked with identical args, the same 62 °C GPU start before every run, page cache prewarmed, a decode-only quick probe right after cool-down, RTX flags/clocks per run:

| Pair | build | decode med / min | quick probe (3 prompts) | prompt tok/s | TTFT | GPU start | clock med/min MHz | max °C | thermal | sys page-ins/s | summary file |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | old (e8065c7cf) | 103.3 / 82.3 | [113.13, 106.48, 93.37] | 2840 | 0.78 s | 62 °C / 0001 | 2625 / 2625 | 73 | 0x0 | 264 | `r3-ling-full-ab-e80-1-bench.summary.json` |
| 1 | new (v1.1.4) | 69.1 / 60.2 | [85.35, 77.9, 78.45] | 2737 | 0.78 s | 62 °C / 0001 | 2625 / 2625 | 74 | 0x0 | 11897 | `r3-ling-full-ab-v114-1-bench.summary.json` |
| 2 | old (e8065c7cf) | 88.7 / 78.7 | [75.96, 78.03, 81.52] | 2890 | 0.78 s | 62 °C / 0001 | 2490 / 2355 | 72 | 0x0 | 228 | `r3-ling-full-ab-e80-2-bench.summary.json` |
| 2 | new (v1.1.4) | 101.3 / 81.3 | [94.33, 97.19, 83.11] | 2869 | 0.74 s | 62 °C / 0001 | 2340 / 2055 | 72 | 0x0 | 473 | `r3-ling-full-ab-v114-2-bench.summary.json` |
| 3 | old (e8065c7cf) | 79.5 / 74.8 | [113.92, 106.37, 91.9] | 2820 | 0.82 s | 62 °C / 0001 | 2055 / 2055 | 71 | 0x0 | 890 | `r3-ling-full-ab-e80-3-bench.summary.json` |
| 3 | new (v1.1.4) | 72.5 / 65.7 | [73.29, 76.54, 72.49] | 2749 | 0.77 s | 62 °C / 0001 | 2332 / 2055 | 74 | 0x0 | 13849 | `r3-ling-full-ab-v114-3-bench.summary.json` |
| 4 (old second) | old (e8065c7cf) | 79.2 / 72.8 | [67.09, 77.95, 85.86] | 2840 | 0.79 s | 62 °C / 0001 | 2625 / 1905 | 74 | 0x0 | 9100 | `r3-ling-full-ab-e80-4-bench.summary.json` |
| 4 (new first) | new (v1.1.4) | 81.6 / 75.5 | [80.8, 75.77, 77.36] | 2783 | 0.78 s | 62 °C / 0001 | 1500 / 375 | 72 | 0x0 | 54373 | `r3-ling-full-ab-v114-4-bench.summary.json` |
| 5 (old second) | old (e8065c7cf) | 104.5 / 90.9 | [100.78, 89.03, 90.98] | 2907 | 0.78 s | 62 °C / 0001 | 2340 / 2055 | 72 | 0x0 | 22 | `r3-ling-full-ab-e80-5-bench.summary.json` |
| 5 (new first) | new (v1.1.4) | 86.6 / 77.0 | [94.15, 83.65, 80.92] | 2837 | 0.74 s | 61 °C / 0001 | 2340 / 2055 | 72 | 0x0 | 15395 | `r3-ling-full-ab-v114-5-bench.summary.json` |

- **Five interleaved pairs** (pairs 1–3 old→new, pairs 4–5 new→old to cancel order): decode medians old [103.28, 88.65, 79.45, 79.19, 104.49] → **median 88.65**, new [69.09, 101.26, 72.5, 81.63, 86.64] → **median 81.63**; ratio new/old **0.921**; min-of-mins 72.85 vs 60.25; paired ratios [0.67, 1.14, 0.91, 1.03, 0.83]; prompt ratio 0.98. Each build's own five runs span ~70–105 tok/s. **All ten runs thermally clean** (0x0 bits, GPU max 71–74 °C, clocks 2.05–2.6 GHz, same start temperature). `results/ling-v114-recheck.summary.json`.
- **Decode-only runs** (10 prompts × 128 tokens, nothing else; interleaved old/new/no-fusion/no-descriptor-reuse ×2, `*-decode.summary.json`): old default **114.8 (min 100.9) / 109.2 (min 95.3)**; new default **112.0 (min 100.3) / 112.2 (min 99.2)** → identical. Toggles on v1.1.4, each twice: `GGML_VK_DISABLE_FUSION=1` → 97.7 (min 85.7) / 98.7 (min 85.4); `GGML_VK_DISABLE_DESCRIPTOR_REUSE=1` → 109.6 (min 105.1) / 103.0 (min 77.5). **Neither toggle changes the picture** (fusion off is *slower*, −12%; descriptor reuse off is −5%); there is no gap for them to close.
- **Per-op GPU times** (`GGML_VK_PERF_LOGGER=1`, `…_FREQUENCY=32`, two runs per build, tables summed, `results/ling-perop-old-vs-new.txt`; logs `x-ling-perf-perf-{e80,v114}-{1,2}-decode.server.log`): GPU op time **per graph old 12.26 ms vs new 10.86 ms (new/old 0.89)**; identical call counts per graph for every op. Top ops (µs per graph, old → new): MUL_MAT_VEC 3953 → 3609 (0.91), MUL_MAT_ID_VEC 1652 → 1650 (1.00), DIV 782 → 503, MUL_MAT_ADD 614 → 613, GET_ROWS 613 → 516, GATED_DELTA_NET 598 → 447 (0.75), RMS_NORM_MUL 572 → 453, SCALE 563 → 401. **No op is slower on v1.1.4, and GATED_DELTA_NET (the Vulkan GDN tune) is not it: in the two individual runs it was 0.44× and 1.20×, i.e. ±40% between runs of the *same* binary.** So no evidence implicates the "Tune GDN kernel" (5c200e0c8), the q8_0-KV-view change (526247161) or 83dd71f86.
- **Host-side time per token** (wall ms/token minus GPU op ms/graph, same logger runs, `results/ling-host-side.json`): old **2.29 ms** (wall 14.55, GPU 12.27), new **2.03 ms** (wall 12.89, GPU 10.86); ~15% of wall on both builds. (Includes the logger's own sync overhead; prompt/warm-up graphs make up <3% of the graphs.)
- **Device confirmation.** Fresh verbose v1.1.4 run (`results/r3-ling-full-ab-v114-probe.server.log`): line 78 `using device Vulkan0 (NVIDIA GeForce RTX 4050 Laptop GPU) (0000:01:00.0) - 5152 MiB free`; line 1514 `load_tensors: offloaded 25/25 layers to GPU`; line 1516 `Vulkan0 model buffer size = 4464.69 MiB`; 25 layer assignments to Vulkan0, 0 to Vulkan1 or CPU. The 63.99 run itself (`r3-ling-full-v114-bench.summary.json`): argv `--device Vulkan0 --fit off -ngl 99`, `nvidia-smi` RTX memory 4,973 / 4,982 MiB. Both builds log identical placement (Vulkan0 4,464.69 MiB, KV 229.50 MiB, recurrent-state 19.27 MiB, compute 122.01 MiB, `graph nodes = 3126, splits = 2`, same fused-op lines, `flash_attn` on, q8_0 KV, `load_mode = mmap`); the only log differences are cosmetic (v1.1.4 prints the graph line as `graph: nodes = 3126, splits = 2, …`, adds debug lines, and reports `AVX_VNNI`/`BMI2` in the CPU feature string).
- **Why the first run read 63.99:** it ran **cold** — the owner had just deleted other models and others' builds were evicting RAM: telemetry of that run shows page-ins of 45–66k/s, free RAM 2.7 GB, GPU utilisation 0–20% during the first seconds, and the quiet gate had waited 456 s for compiles; decode climbed 54 → 73 tok/s within the run (`r3-ling-full-v114-bench.telemetry.jsonl`, `…run.log`). Prewarm was added afterwards.
- **A lead I cannot close:** across the ten pair runs decode correlates with *system-wide* page-ins (log10, Pearson r = −0.77) and four of the five v1.1.4 runs carried high page-ins (11.9k, 0.5k, 13.8k, 54k, 15.4k /s) against one of five for e8065c7cf (0.3k, 0.2k, 0.9k, 9.1k, 0.02k /s). The server's own page-fault rate (recorded for pairs 4–5) is equal (14.3–16.7k/s), so it is not the server's own paging; something else on the PC faults more while the new binary runs (Defender scanning the new DLL set is my first suspect, not tested). If the coordinator wants this closed: re-run the pairs with the v1.1.4 folder already scanned and a per-process IO counter.
- **What was building** (asked): the quiet gate saw `rustc.exe` for the first 31 s before pair old-2 and `clippy-driver.exe` for 62 s before pair new-5; neither was present during the measured windows (those runs' telemetry shows only Paseo/svchost/Defender at ~2 cores). Command lines were not captured at the time; the only Rust workspaces with recent activity are other agents' `devboule*` projects on the Desktop. No build process is running now.
- **Qwen3.6-35B-A3B old/new pair: skipped** — not on the Lenovo (only `ggml-vocab-qwen*.gguf` stubs under `C:\kalsa-bench`); nothing was downloaded.

### 10.4 Gemma E4B + the official MTP drafter (v1.1.4, RTX) — **verdict: ~1.9× decode, prompt/TTFT unchanged, fits fully on the GPU at 64k**
- **Proof it loads and the MTP head attaches** (`results/v-e4b-n3-v114-probe.server.log`, `-lv 5`): `common_speculative_init_result: loading draft model '…mtp-gemma-4-E4B-it-Q8_0.gguf'`; `gemma4-assistant.nextn_predict_layers u32 = 4`; `nextn.pre_projection.weight` / `nextn.post_projection.weight` tensors loaded; `spec common_specu: adding speculative implementation 'draft-mtp'`; `srv load_model: speculative decoding context initialized`; slot `"speculative":true`; `max possible draft: 14`. Placement: E4B `offloaded 43/43 layers to GPU` (`Vulkan0 model buffer 2883.51 MiB`, per-layer embeddings `CPU_Mapped 2208 MiB`), KV 544 + 21 MiB, drafter 5/5 layers on Vulkan0; **VRAM used 3,828 MiB with the drafter and 64k KV** (`v-e4b-n3-v114-probe.summary.json`; 3,974 MiB max in the benches) — it fits with ~1.2 GiB to spare.
- Greedy, cooled, quiet-gated (summary files in the Source column):
| Row | TTFT @2k | Prompt tok/s | Decode med/min | Accept | VRAM max (RTX) | RSS / free-RAM low | RTX thermal bits | Source |
|---|---|---|---|---|---|---|---|---|
| E4B RTX, no drafter (-ngl 99) | **1.17 s** | 1971 | 47.5 / 46.4 | – | 3809 MiB | 3.2 GB / 7.5 GB | 0x0 | `v-e4b-off-v114-bench.summary.json` |
| E4B + MTP n=2 | **1.17 s** | 1856 | 89.7 / 79.7 | 0.793 | 3974 MiB | 3.5 GB / 10.6 GB | 0x0 | `v-e4b-n2-v114-bench.summary.json` |
| E4B + MTP n=3 | **1.75 s** | 1544 | 77.1 / 60.4 | 0.744 | 3828 MiB | 3.4 GB / 10.7 GB | 0x0 | `v-e4b-n3-v114-bench.summary.json` |
| E4B + MTP n=4 | **1.19 s** | 1916 | 84.6 / 66.8 | 0.669 | 3974 MiB | 3.5 GB / 6.0 GB | 0x0 | `v-e4b-n4-v114-bench.summary.json` |
- Repeat in reverse order (n=4, 3, 2): **92.0 / 91.6 / 90.7 tok/s** (`v-e4b-n4/n3/n2-v114-b-bench.summary.json`) — so n=2/3/4 are the same within noise at greedy; the first-round dips for n=3 were interference.
- **Temperature 1.0 (the app's sampling):** no drafter 47.7 → n=2 **87.5** (acceptance 0.736), n=3 **87.0** (0.656), n=4 **86.3** (0.592): gain **1.83×**, best at n=2 (also the best minimum, 76.8) (`v-e4b-{off,n2,n3,n4}-v114-t1-bench.summary.json`). Recommendation: draft n_max 2–3 for E4B; MTP on is a free ~1.8–1.9× on the RTX here.
- **CPU-only E4B** (CPU build, 6 threads, ctx 16384, **high-priority** server, one prompt for the TTFT in `--lite` rows; earlier normal-priority rows were distorted by other processes): off **9.8 / 9.9 tok/s** (two runs) vs MTP n=3 **17.1 / 17.3** (two runs; acceptance 0.748) = **1.75×**; the CPU path's 2k-prompt prefill is 31–32 tok/s (**TTFT ≈ 65 s**), unchanged by the drafter. n=4 on the CPU was worse in its one run (12.4 tok/s, acceptance 0.664, noisy). Rows:
| Row | TTFT @2k | Prompt tok/s | Decode med/min | Accept | VRAM max (RTX) | RSS / free-RAM low | RTX thermal bits | Source |
|---|---|---|---|---|---|---|---|---|
| CPU E4B off (first run, other load) | **73.53 s** | 18 | 4.9 / 1.0 | – | 49 MiB | 5.3 GB / 5.0 GB | 0x0 | `c-e4b-off-v114-bench.summary.json` |
| CPU E4B n=2 (lite, 1 prompt) | **75.99 s** (n=1) | 29 (n=1) | 11.4 / 8.3 | 0.781 | 0 MiB | 5.5 GB / 5.5 GB | 0x0 | `c-e4b-n2-v114-bench.summary.json` |
| CPU E4B n=3 (lite) | **69.86 s** (n=1) | 30 (n=1) | 16.4 / 13.7 | 0.748 | 0 MiB | 5.5 GB / 6.1 GB | 0x0 | `c-e4b-n3-v114-bench.summary.json` |
| CPU E4B n=4 (lite) | **101.33 s** (n=1) | 18 (n=1) | 12.4 / 3.3 | 0.664 | 0 MiB | 5.5 GB / 4.0 GB | 0x0 | `c-e4b-n4-v114-bench.summary.json` |
| CPU E4B off, high priority, run 1 (lite) | **66.10 s** (n=1) | 32 (n=1) | 9.8 / 9.7 | – | 0 MiB | 5.3 GB / 9.6 GB | 0x0 | `c-e4b-off-v114-hp-r1-bench.summary.json` |
| CPU E4B n=3, high priority, run 1 (lite) | **65.70 s** (n=1) | 32 (n=1) | 17.1 / 14.1 | 0.748 | 0 MiB | 5.5 GB / 10.3 GB | 0x0 | `c-e4b-n3-v114-hp-r1-bench.summary.json` |
| CPU E4B off, high priority, run 2 (lite) | **65.67 s** (n=1) | 31 (n=1) | 9.9 / 9.7 | – | 0 MiB | 5.3 GB / 10.0 GB | 0x0 | `c-e4b-off-v114-hp-r2-bench.summary.json` |
| CPU E4B n=3, high priority, run 2 (lite) | **65.05 s** (n=1) | 32 (n=1) | 17.3 / 14.1 | 0.748 | 0 MiB | 5.5 GB / 9.9 GB | 0x0 | `c-e4b-n3-v114-hp-r2-bench.summary.json` |

### 10.5 CPU tiled k-quant prefill (`GGML_CPU_TILED_MM`), CPU build, interleaved A/B
Same prompt (~1,061 tokens, three distinct prompts per run), server at high priority, 6 threads, ctx 16384, each round = default run then `GGML_CPU_TILED_MM=0` run, no quiet-gate wait (interleaving instead). Prompt tok/s medians, ratio default / tiled-off (files `c-<model>-{def,t0}-v114-hp-r<N>-prefill.summary.json`; env recorded in each):
- **E4B Q4_K_M** (4 rounds): 31.9 vs 21.3 (1.50), 28.9 vs 21.9 (1.32), 24.4 vs 23.5 (1.04), 24.3 vs 19.8 (1.23) → **median ratio 1.28** (range 1.04–1.50; interference visible in the noisier reps).
- **12B Q4_K_M** (3 rounds; the originally cut round 2 was re-run as 2b): 9.2 vs 7.7 (1.19), 12.6 vs 9.8 (1.29), 12.6 vs 9.4 (1.33) → **median ratio 1.29**; the last two rounds have very tight reps (12.4–12.6 vs 9.4–9.8).
- Reading: the default (tiled) path is **~1.3× faster** for Q4_K_M prefill on this CPU (Core Ultra 9 185H; AVX2 + AVX-VNNI per the build's feature string — the loaded CPU-backend DLL was not logged); absolute CPU prefill is still only 12–32 tok/s.

### 10.6 Housekeeping (closed)
- All planned v1.1.4 runs are finished; queue `queue21.txt` ended 17:07 and nothing of mine is running on the PC. The interleaved Arc repeat is in §10.7.
- Everything cited is in `lab2/results/` (summaries, telemetry, run logs; server logs for the probes and the logger runs). Every GPU row above is thermally clean (0x0) except the noted Arc rows (idle-RTX chassis bit 0x20, both builds); the coordinator's thermal watcher log ends 03:59, so thermal verdicts rely on my own 5 s telemetry + start/end snapshots.
- Nothing was deleted by me. The Lab GGUFs and builds under `C:\kalsa-bench` are no longer needed (list given in the reply).


### 10.7 Arc 12B, interleaved e8065c7cf vs v1.1.4 (closes the open Arc rows of §10.2; cooled start ≤ 62 °C, prewarmed, old→new twice, `--device Vulkan1`, same args)
| Row | build | TTFT @2k | Prompt tok/s | Decode med / min | Accept | RTX bit (idle RTX = chassis hot) | free-RAM low | Source |
|---|---|---|---|---|---|---|---|---|
| 12B Arc MTP off, pair 1 | e8065c7cf | **28.6 s** | 74 | 7.8 / 7.7 | – | 0x0 (start 60 °C, max 64) | 5.7 GB | `ar-12b-off-rc-e80-1-bench.summary.json` |
| 12B Arc MTP off, pair 1 | v1.1.4 | **31.8 s** | 65 | 7.2 / 6.3 | – | 0x0 (start 60 °C, max 66) | 4.1 GB | `ar-12b-off-rc-v114-1-bench.summary.json` |
| 12B Arc MTP off, pair 2 | e8065c7cf | **29.0 s** | 70 | 7.3 / 7.0 | – | 0x20 THROTTLED (start 61 °C, max 74) | 3.4 GB | `ar-12b-off-rc-e80-2-bench.summary.json` |
| 12B Arc MTP off, pair 2 | v1.1.4 | **28.9 s** | 71 | 7.1 / 7.0 | – | 0x20 THROTTLED (start 62 °C, max 73) | 4.2 GB | `ar-12b-off-rc-v114-2-bench.summary.json` |
| 12B Arc MTP n=4, pair 1 | e8065c7cf | **30.5 s** | 68 | 15.5 / 11.4 | 0.754 | 0x0 (start 61 °C, max 66) | 3.1 GB | `ar-12b-n4-rc-e80-1-bench.summary.json` |
| 12B Arc MTP n=4, pair 1 | v1.1.4 | **28.5 s** | 74 | 14.8 / 11.2 | 0.754 | 0x20 THROTTLED (start 62 °C, max 70) | 3.7 GB | `ar-12b-n4-rc-v114-1-bench.summary.json` |
| 12B Arc MTP n=4, pair 2 | e8065c7cf | **28.7 s** | 73 | 15.5 / 11.2 | 0.754 | 0x20 THROTTLED (start 61 °C, max 71) | 3.1 GB | `ar-12b-n4-rc-e80-2-bench.summary.json` |
| 12B Arc MTP n=4, pair 2 | v1.1.4 | **30.0 s** | 69 | 15.9 / 11.6 | 0.754 | 0x20 THROTTLED (start 61 °C, max 72) | 1.6 GB | `ar-12b-n4-rc-v114-2-bench.summary.json` |

**Verdict: v1.1.4 ≈ e8065c7cf on the Arc.** MTP off: decode 7.2 vs 7.5 tok/s (mean of 2, −4%); MTP n=4: 15.3 vs 15.5 (−1%, v1.1.4 won pair 2); prompt 65–74 tok/s and TTFT 28.5–31.8 s on both builds, acceptance 0.754 on every n=4 run. The earlier slow MTP-off v1.1.4 row (61 tok/s prompt, TTFT 31.9 s) was one draw of that same 65–74 / 28.5–31.8 spread. **Throttle flags:** the 0x20 bit is the *idle* RTX reporting a hot chassis (Arc/CPU load), set on 2 of 4 e8065c7cf runs and 3 of 4 v1.1.4 runs (max RTX 64–74 °C); no 0x08/0x40 anywhere; so these Arc rows are "thermally suspect" on both builds equally and carry no build difference. The 12B on the Arc remains unusable for a room (TTFT ≈ 29 s) on either engine.
