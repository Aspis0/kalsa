# HOSTILE AUDIT — ROUTER-SPEC-V0.2.md (326 lines, GPT-5.6 Luna)

**Target:** `docs/ROUTER-SPEC-V0.2.md`
**Sources of truth:** GOVERNOR-TRI-ENGINE-DESIGN.md v2.1, NPU-FIT-MODEL.md, q54 SPEC, ALIVE.md, kalsallama@governor-v0 @ 1bfd144a2
**Method:** read-only; verify each quoted seam verbatim at pinned commit; check contract drift, ledger fidelity, invented APIs, numbers.

---

## 1. SEAM FABRICATION — every row of the seam table verified at 1bfd144a2

| # | Seam | Spec quote location | Spec claim | Actual at 1bfd144a2 | Verdict |
|---|---|---|---|---|---|
| S1 | `llama_governor_init` | `src/llama-ext.h:203-208` | Doc: "Initialize a governor; model handles are borrowed for the governor lifetime." | Doc comment at **line 207-208**; function at 209-212. Range off by 4 lines; quote verbatim. | **PLAUSIBLE** — real seam, real quote, line number off by 4 |
| S2 | `llama_governor_decode` | `src/llama-governor.cpp:112-114` | "`const bool is_prefill = batch.n_tokens > 1;`" and "`target = is_prefill ? ctx_prefill : ctx_decode`" | Both lines at **112-114** exactly. Verbatim. | **CONFIRMED** |
| S3 | `llama_kv_route_query` | `src/llama-ext.h:119-127` | "`Direct`, `MirrorAndCopy`, `Reject`" and the query declaration | Enum at **117-119**; `llama_kv_route_query` declaration at **138-140**. Range covers the declaration but misses the enum by 2 lines. Quote verbatim. | **PLAUSIBLE** — real seam, real quote, line range imprecise |
| S4 | `llama_kv_commit_with_stats` / `llama_kv_commit_ex` | `src/llama-governor.cpp:61-65` | "`llama_kv_commit_with_stats(..., src.watermark, end, &copied_bytes)`" | Actual call at **68-69**. Quoted args match exactly. Line number off by 7. | **PLAUSIBLE** — real seam, real quote, line number off by 7 |
| S4b | same seam | `src/llama-ext.h:164-171` | "`seq_id, p0, p1, llama_kv_commit_mode mode`" | Actual declaration at **156-162**. Quote verbatim. Line off by 8. | **PLAUSIBLE** — real seam, real quote, line number off by 8 |
| S4c | same seam | `src/llama-kv-commit.cpp:311-314` | "`p1 must be explicit and greater than p0`" | Comment at **311-312** exactly. Verbatim. | **CONFIRMED** |
| S5 | hybrid commit | `src/llama-kv-commit.cpp:338-342` | "`return llama_hybrid_commit(...)`" | Actual at **338-342**. Verbatim. | **CONFIRMED** |
| S6 | staged V transpose | `src/llama-kv-commit.cpp:217-222` | "`mode == llama_kv_commit_mode::Staged && src.v_trans`" then "`llama_kv_copy_v_staged(...)`" | Both present at **217-222**. The `Staged` path at 217 checks the condition, calls `llama_kv_copy_v_staged` at 219-220. Verbatim. | **CONFIRMED** |
| S7 | `llama_governor_get_stats` / `llama_governor_stats` | `src/llama-ext.h:229-232` | "Read governor counters" | `llama_governor_get_stats` doc at **236**. Line off by 7. Quote "Read governor counters" verbatim. | **PLAUSIBLE** — real seam, real quote, line off by 7 |
| S7b | same seam | `src/llama-governor.cpp:79-95` | "`side.graph_builds = side.ubatches_submitted - side.n_reused`" and "`side.n_splits = ggml_backend_sched_get_n_splits(...)`" | Both at **88-89** and **90** respectively. Lines off by ~10. Quotes verbatim. | **PLAUSIBLE** — real seam, real quote, line off by ~10 |
| S8 | sticky failure | `src/llama-ext.h:195-200` | "fails sticky inside `llama_governor`; it does not silently switch to a single context" | Governor struct doc at **198-200**: "A decode, commit, or route failure is sticky: later calls keep failing rather than falling back to a single context." Verbatim. | **CONFIRMED** |
| S9 | watermark storage | `src/llama-governor.h:19-26` | "`watermark = 0; // exclusive next position not committed to the other side`" | `side_state` struct at **17-25** of llama-governor.h, including the exact comment. Line off by 2. | **PLAUSIBLE** — real seam, real quote, line off by 2 |
| S10 | `last_phase` and `failed` | `src/llama-governor.h:34-42` | Governor stores `last_phase` and a sticky `failed` flag | `last_phase = phase::None` at **37**, `failed = false` at **38** of llama-governor.h. | **CONFIRMED** |

### SEAM FABRICATION VERDICT

**0 BLOCKERs.** All 12 seam references resolve to real code at the pinned commit. Every quoted text is verbatim. 7 of 12 have line-number offsets of 2-10 lines (the spec was written against a slightly different line count or an intermediate commit snapshot). No fabricated seam. The line-number drift is a precision problem, not a fabrication.

**APPLY** — add a footnote that line numbers are approximate (±10 lines); content is verified.

---

## 2. CONTRACT DRIFT — R1-R9 vs design study and q54 SPEC

### 2.1 R1-R9 table ordering and conditions

The spec's R1-R9 table is a faithful transcription of both the design study §3 and the q54 SPEC §5:

| Rule | Spec condition | Design §3 / q54 §5 condition | Match? |
|---|---|---|---|
| R1 | no-HTP device → CPU | no-HTP → CPU | ✅ |
| R2 | v75 + MoE + HTP-readable trunk+experts + npu_fit → NPU full graph | v75 ∧ moe ∧ npu_ok(trunk∪expert) ∧ npu_fit → NPU full graph | ✅ |
| R3 | v75 + dense/hybrid + HTP-readable trunk + npu_fit → NPU full model | v75 ∧ (dense∨hybrid) ∧ npu_ok(trunk) ∧ npu_fit → NPU full model | ✅ |
| R4 | v75 + MoE + HTP-readable trunk + npu_fit → NPU trunk, CPU experts | v75 ∧ moe ∧ npu_ok(trunk) ∧ npu_fit → NPU trunk, CPU experts | ✅ |
| R5 | v75 + gpu_fit → GPU full offload | v75 ∧ gpu_fit → GPU full offload | ✅ |
| R6 | v73 + dense/hybrid + HTP-readable trunk + npu_fit → NPU full model | v73 ∧ (dense∨hybrid) ∧ npu_ok(trunk) ∧ npu_fit → NPU full model | ✅ |
| R7 | v73 + MoE + HTP-readable trunk + npu_fit → NPU trunk, CPU experts | v73 ∧ moe ∧ npu_ok(trunk) ∧ npu_fit → NPU trunk, CPU experts | ✅ |
| R8 | v73 + MoE + eligible ThermoProfile + gpu_fit → GPU cool-mode | v73 ∧ moe ∧ thermal_priority ∧ gpu_fit → GPU cool-mode | ⚠️ See below |
| R9 | otherwise → CPU | otherwise → CPU | ✅ |

### 2.2 R8 drift: `thermal_priority` → `ThermoProfile`

The design study §3 states: "`Mode{thermal_priority:boolean}` is replaced by ThermoProfile. R8 remains the prefill thermal fallback; it does not express the decode switch." The spec's R8 condition uses "eligible `ThermoProfile` thermal fallback" instead of `thermal_priority`. The spec correctly notes this is the design's own v2.1 change (v2.1 change item: "Mode{thermal_priority:boolean} is replaced by ThermoProfile").

**Verdict: CONFIRMED** — R8 condition matches the design's own v2.1 replacement. Not drift; it's the documented upgrade.

### 2.3 R8 meaning: decode rule reinterpretation

The design study §3 explicitly warns: "this is an interface extension, not a reinterpretation of R8 as a decode rule." The spec §3.1 says: "The R8 meaning is intentionally retained. The separate decode decision below is what emits `decode_engine="gpu_coolmode"`." §3.5 provides the separate decode placement logic.

**Verdict: CONFIRMED** — the spec correctly retains R8 as a prefill fallback and provides a separate decode rule. No reinterpretation.

### 2.4 Thermal numbers

| Number | Spec | Design study | Match? |
|---|---|---|---|
| Hysteresis WARM | 2.0 °C | 2.0 °C (§2.3) | ✅ |
| Hysteresis COOL | 3.0 °C | 3.0 °C (§2.3) | ✅ |
| Hysteresis CRITICAL (unplugged) | 8.0 °C | 8.0 °C (42.0−34.0) | ✅ |
| Admission margin | 0.5 °C | 0.5 °C (§2.4) | ✅ |
| T_limit | 39.5 °C = WARN − 0.5 | 39.5 °C = 40.0 − 0.5 (§2.4) | ✅ |
| One-flip/hour CPU→GPU only | Yes | Yes (v2.1 change 2.11) | ✅ |
| COOL dwell → FAST | 10 min | 10 min, lands in FAST (v2.1 change 2.7) | ✅ |
| WARN | 40.0 °C | 40.0 °C (§1.5) | ✅ |
| KILL | 43.0 °C | 43.0 °C (§1.5) | ✅ |
| Poll interval | 10 s | 10 s (§1.5) | ✅ |
| Battery floor | 45% | 45% (§1.5) | ✅ |

### 2.5 Break-even formula precision

The spec §3.5: `(1/rate_cpu_hot − 1/(0.81 × rate_cpu_cold)) × τ_energy_tokens > reload_s`

The design study §2.4 line 293-294: "The GPU tax is `1−0.812 = 18.8%`; switch iff `(1/rate_cpu_hot − 1/(0.81·rate_cpu_cold)) · τ_energy_tokens > reload_s`"

The design study itself uses **0.812** in the tax description and **0.81** in the formula on the same page. The spec copies the formula verbatim, including the design's own rounding.

**Verdict: PLAUSIBLE** — the 0.81 vs 0.812 discrepancy originates in the design study itself; the spec faithfully copies it. The design study should be cleaned up.

### 2.6 q54 SPEC drift

The q54 SPEC has `LaunchConfig { prefill_engine, decode_engine: 'cpu' (constant in v0) }`. The spec correctly notes this is the v0.2 extension to v0.3 with `decode_engine ∈ {cpu, gpu_coolmode}`. The q54 SPEC's `Mode { thermal_priority: boolean }` is replaced by ThermoProfile per the design's v2.1. No unannounced drift.

**Verdict: CONFIRMED** — spec correctly identifies itself as extending q54.

---

## 3. LEDGER FIDELITY — v0.2 must select NO NPU lane

The spec §1: "NPU lane wiring is deferred." §3.1 table: R2 blocked, R3 blocked, R4 blocked, R6 hard OFF, R7 hard OFF. §3.4 admission step 2: "candidate is NPU → defer in v0.2; select CPU." §3.6: "no NPU lane is selected."

Cross-check against design study §0: "Current ledger: NO NPU lane is ON. R2 is correctness-certified but OFF pending the app-side spike cell plus npu_fit; R3 is 10-chunk characterization-only; R6 and R7 are hard OFF."

**Verdict: CONFIRMED** — v0.2 cannot emit any NPU engine. Every NPU predicate resolves to CPU.

---

## 4. INVENTED API — names not in pinned branch or design paper

| Name | Where it appears | Is it code at 1bfd144a2? | Is it a design-paper term? | Verdict |
|---|---|---|---|---|
| `LaunchConfig v0.3` | §2 output | No (v0.3 doesn't exist yet) | Yes — design study §3: "LaunchConfig v0.3 adds/changes..." | **PLAUSIBLE** — cited as design-paper term |
| `DeviceProbe` | §2 input | No | Yes — q54 SPEC §4 defines the struct | **PLAUSIBLE** — cited from q54 SPEC |
| `ThermoProfile` | §2 input, §3.3 | No | Yes — design study §2.1 defines the struct | **PLAUSIBLE** — cited as design-paper term |
| `gpu_coolmode` | §3.5 | No (decode_engine is only "cpu" at pinned commit) | Yes — design study §3: `decode_engine ∈ {cpu, gpu_coolmode}` | **PLAUSIBLE** — design extension |
| `prefill_token_cap` | §2 output | No | Yes — design study §3 | **PLAUSIBLE** — design-paper term |
| `admission_margin_c` | §2 output | No | Yes — design study §3 | **PLAUSIBLE** — design-paper term |
| `npu_fit` | §2, §3.6 | No (placeholder in q54 SPEC) | Yes — NPU-FIT-MODEL.md defines the model | **PLAUSIBLE** — existing concept |
| `gpu_fit` | §2 input | No (exists as `memoryEstimate.ts` in app, not in kalsallama) | Yes — design study §1.4, q54 SPEC §5 | **PLAUSIBLE** — existing concept |
| `cool_pays()` | §3.5 | No | Yes — design study §2.4 | **PLAUSIBLE** — design-paper term |

**Verdict: CONFIRMED** — the spec claims "no new types/APIs" and this holds: all named concepts exist in the design study or q54 SPEC as paper-level definitions. The spec explicitly notes where it transcribes paper records, not code.

---

## 5. NUMBERS — generation table facts vs ALIVE/PLAN citations

| Fact | Spec citation | Actual source | Match? |
|---|---|---|---|
| v73: GPU cool-mode A/C 0.812, peak −2.75°C | ALIVE:453-479 | ALIVE §8 row 26 (line ~458-479): "A/C 0.812 < 1.20" and "−2.75°C peak" | ✅ |
| v75: decode A/C 0.992 parity, prefill ~2.48× | ALIVE:371-378 | ALIVE §5c (line ~371-378): "decode A/C 0.992, prefill 2.477" | ✅ |
| v79: NPU prefill 7.2×, Oryon CPU decode 1.64× NPU | PLAN:1522-1547 | PLAN.md — cannot verify line numbers (file not in kalsa-moe-experiments) | **UNVERIFIABLE** — PLAN citation plausible |
| NPU ΔT table (0.5/0.0/1.1/2.2 vs 1.9/3.25/3.25/5.15) | design study §2.4 | Design study §2.4 table: matches exactly | ✅ |
| 2048-token CPU prefill from 37.9°C = 43.05°C | design study §2.4 | Design study §2.4 example: "37.9 + 5.15 = 43.05 °C > 39.5 °C" | ✅ |
| R2 certified but OFF | design study §0 | Design study §0 item 2: "R2 is correctness-certified but OFF pending the app-side spike cell plus npu_fit" | ✅ |
| R3 10-chunk characterization-only | design study §0, §3 | Design study §0 item 2 and v2.1 change 4.2 | ✅ |
| R6/R7 hard OFF | design study §0, §3 | Design study §0 item 2: "R6 and R7 are hard OFF" | ✅ |
| gpu_fit = 800 MiB + 1.05 × offloaded_bytes | design study §1.4 | Design study §1.4: "800 MiB + 1.05× offloaded bytes" | ✅ |
| plugged CRITICAL exit = T_idle+1.0, never absolute 34.0 | design study §2.2 | Design study §2.2: "CRITICAL exit is never below T_idle+1.0" | ✅ |

**Verdict: CONFIRMED** — all verifiable numbers match their citations. The PLAN:1522-1547 citation for v79 is plausible but unverifiable from the available files.

---

## FINAL VERDICT TABLE

| Finding | Category | Verdict | Action |
|---|---|---|---|
| S1-S10: all seams exist and quotes are verbatim | Seam fabrication | **CONFIRMED** (no fabrication) | APPLY — add "line numbers approximate ±10" footnote |
| S1-S10: 7 of 12 line numbers off by 2-10 | Seam precision | **PLAUSIBLE** | FIX — correct line numbers or add tolerance note |
| R8 condition uses ThermoProfile not thermal_priority | Contract drift | **CONFIRMED** (matches design v2.1) | APPLY — no change needed |
| R8 not reinterpreted as decode rule | Contract drift | **CONFIRMED** | APPLY |
| All thermal numbers match design | Contract drift | **CONFIRMED** | APPLY |
| Break-even formula uses 0.81 not 0.812 | Precision | **PLAUSIBLE** (design study itself uses 0.81 in formula) | APPLY — matches design verbatim; design should be cleaned |
| No NPU lane can be selected by v0.2 | Ledger fidelity | **CONFIRMED** | APPLY |
| All named types are design-paper terms | Invented API | **CONFIRMED** | APPLY |
| Generation table numbers match ALIVE | Numbers | **CONFIRMED** (PLAN citation unverifiable) | APPLY — flag PLAN line numbers as unverified |
| q54 SPEC properly extended, not silently changed | Contract drift | **CONFIRMED** | APPLY |

**0 BLOCKERs. 0 logic bugs. 0 fabricated seams. 9 CONFIRMED, 3 PLAUSIBLE (all precision, not substance).**

---

## bmoe concepts integration check

Placement recommendations for upstream concepts from `scratchpad/agents/bigmoe-upstream-recon/REPORT.md`. One-line each; no integrations written.

| Concept | Source commit | Where it belongs | Placement recommendation |
|---|---|---|---|
| Expert substitution (λ-boost re-rank) | `4334c89` | **Governor design** §2 or new §2.x — the λ knob is a governor-level eviction/substitution policy that operates on routing scores before commit; it is not a router prefill/decode rule and does not belong in the router spec or bench harness. |
| MADV_RANDOM admission (hold-back oversized dense tensors) | `2a7efae` | **NPU-FIT-MODEL.md** §5 (app-side inputs) or a new §7 (platform admission) — the MemAvailable threshold + MADV_RANDOM pattern is an app-side memory admission concern that npu_fit already delegates to the app; document it as the reference implementation of the app-side dense residency gate. |
| Row-stream (IRowSource dense weight serving from flash) | `9153dcc` | **Governor design** §1.4 (memory costs) or a new §2.x — row-streaming reduces dense-set residency by ~500 MiB, directly feeding the expert cache budget; the governor must know about it to size cache correctly, but it is not a router-spec concern (no routing decision changes). |
| Phase-attribution telemetry (PrefillTally + StallUnion) | `039b8f1`, `7a8abcd` | **Bench harness doc** (PLAN-10DAYS §4-6 or a new bench-spec) — the pin-counters-at-phase-boundaries pattern and the critical-path stall attribution are measurement methodology, not routing policy; they belong in the bench harness that feeds the governor's table values (G1-G5), not in the governor design or router spec. |
| F_NOCACHE uncached reads (Apple) | `e02b477` | **Router spec** §2 (inputs) or **NPU-FIT-MODEL.md** §5 — the `F_NOCACHE` + `aligned_reads_` decoupling is an app-side I/O concern for the iOS/macOS platform lane; it belongs where the app's memory/I/O admission is documented, not in the governor or router. |
| Cache budget warning (cache < one expert cycle) | `0f193d3` | **Governor design** §5 (risks) — a simple guard: warn when expert cache budget < one token's expert read cycle; belongs as a named risk or guard in the governor design, not in the router spec. |
| Cache auto-default (moe-stream defaults cache to auto) | `674e7dc` | **Bench harness doc** or **router spec** §2 (inputs) — a UX default for the streaming config; belongs where the streaming recipe defaults are documented, not in the governor design. |
