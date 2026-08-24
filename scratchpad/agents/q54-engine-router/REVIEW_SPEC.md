# REVIEW_SPEC — Hostile Audit of q54 Engine Router v0 SPEC.md

**Audit date:** 2026-08-24. **Auditor:** hostile, read-only.  
**Target:** `scratchpad/agents/q54-engine-router/SPEC.md`  
**Ground truth:** ALIVE.md §8 + lanes 9–13; q44 REPORT; q46 REPORT; q48 REPORT; q53 PREREG.

---

## Fidelity Findings (numbers vs banked sources)

### F1 — R7 cites q46 for "+14% pp" — metric absent from q46 [HIGH]

**Verdict: CONFIRMED**

SPEC R7: `"+14% pp [q46]"`. The q46 REPORT (`scratchpad/agents/q46-lfm-bprime-smoke/REPORT.md`) contains NO percentage prefill comparison. The report provides raw pp512 numbers (HTP 58.43, CPU 51.08) and concludes "HTP wins prefill; CPU wins tg in this cell. Not a ship number." The ratio from those raw numbers is 58.43/51.08 = 1.144×, i.e. +14.4% — but q46 never computes or states this figure. The "+14% pp" appears first in ALIVE lane 11 as "LFM-B′ on S23 pp512 1.14×" — a cell the SPEC did not cite.

**Impact:** The spec attributes a derived figure to the wrong cell. If someone reads q46 to verify R7's basis, the number is not there.

**Fix:** Either cite ALIVE lane 11 ("LFM-B′ on S23 pp512 1.14×") or compute and cite the raw q46 numbers (58.43/51.08).

---

### F2 — R3 uses 3.19× without cell citation; §8 says 3.2× [LOW]

**Verdict: CONFIRMED**

SPEC R3: `"3.19×"` with no `[q##]` tag. ALIVE §8 lists "dense-NPU 3.2×" in the ranking. The precise 3.19× comes from ALIVE lane 9 (`pp512 HTP median 165.4 t/s vs CPU 51.9 = 3.19×`). Every other rule in the table cites its cell — R2 cites q48, R4 implicitly cites q44, R7 cites q46. R3 is orphaned.

**Impact:** Minor. The number itself is correct; the missing citation breaks the spec's own rule that every figure must trace to a banked cell.

---

### F3 — R8 "KEXP only" is not a rule condition — mislabeled policy [MEDIUM]

**Verdict: CONFIRMED**

SPEC R8 condition: `v73 ∧ moe ∧ thermal_priority ∧ gpu_fit`. There is no arch_class or model-identity check. The "KEXP only" qualifier appears only in the comment column and is not enforced by the predicate. Any v73 MoE model that passes `gpu_fit` would match R8 if `thermal_priority` is true.

ALIVE §8 GPU row for 740-class: "Cool-mode on KEXP only (−19 %, −2.75 °C)". The measured -19%/-2.75°C was on KEXP only — no other v73 MoE was tested on GPU. The spec encodes the word "KEXP" as decoration, not as a predicate.

**Impact:** A non-KEXP MoE on v73 with thermal_priority enabled would fire R8, receiving the KEXP-specific cool-mode numbers in its `reason` string. The cool-mode numbers are untested on non-KEXP models. The rule ordering makes this currently unreachable for MoE (see F4), so it is dormant, but the mislabeling is a latent correctness gap.

**Fix:** Either add an explicit model-class predicate (e.g. `arch_class == 'kexp'` — but the model profile doesn't carry this field), or remove "KEXP only" from the comment and add a footnote that the numbers are KEXP-specific and non-KEXP cool-mode is untested.

---

### F4 — R8 is unreachable for MoE on v73 due to rule ordering [MEDIUM]

**Verdict: CONFIRMED**

For any v73 MoE model where `npu_ok(trunk_quants)` is true and `npu_fit` holds: R6 or R7 fires first. R8 is the 8th rule and requires `gpu_fit` — but by the time R8 is evaluated, R6/R7 already matched and terminated the cascade. R8 is only reachable when `npu_ok(trunk_quants)` is false OR `npu_fit` is false, i.e. when trunk quants are not HTP-readable or the model is too large for NPU.

Trace for KEXP on S23 (v73): trunk_quants = {Q5_K, Q6_K}. `npu_ok({Q5_K, Q6_K})` = false (Q5_K ∉ HTP_READABLE). R6 skips. R7 skips. R8 condition: `v73 ∧ moe ∧ thermal_priority ∧ gpu_fit` — fires. KEXP is reachable.

Trace for an hypothetical OLMoE-Q4_0 on S23 (v73): trunk_quants = {Q4_0}. `npu_ok({Q4_0})` = true. If `npu_fit`: R7 fires → NPU trunk, experts CPU. R8 never reached. For this hypothetical to reach R8, `npu_fit` must fail (model too large for NPU), which is the realistic case on 8 GB.

So R8 IS reachable for KEXP (which fails `npu_ok` on trunk) but NOT reachable for any v73 MoE with HTP-compatible trunk that fits NPU. The rule ordering means R8 is the thermal fallback for "NPU can't take the trunk" cases only. This is logically correct but undocumented — the spec does not explain that R8 is the thermal fallback for the NPU-incompatible subset of v73 MoE.

**Impact:** The rule ordering is correct for KEXP (the only tested v73 MoE). But the spec presents R8 as a general "GPU cool-mode" rule, when it is really "GPU cool-mode for v73 MoE models whose trunk is NOT HTP-readable." No incorrect engine assignment for any tested model, but the undocumented logic coupling is a maintenance hazard.

---

## Table Logic Findings

### T1 — R2 description "NPU experts+trunk" conflates two configurations [MEDIUM]

**Verdict: PLAUSIBLE**

SPEC R2: `"NPU experts+trunk"`. The q48 Xiaomi/v75 data (the source for 4.82×) ran OLMoE-Q4_0 where ALL tensors (experts + trunk) are Q4_0 and all 3.6 GiB landed on HTP0-REPACK. This is truly "everything on NPU."

But for a hypothetical v75 KEXP-B′ (experts Q2_K/Q3_K, trunk Q8_0), `npu_ok(expert_quants)` = false, so R2 does not match. R4 matches instead (trunk NPU, experts CPU).

The description "NPU experts+trunk" is correct for OLMoE-Q4_0 but would be misleading if a reader assumed it means "experts AND trunk separately on NPU" for all MoE models. The actual semantics are: R2 fires when experts are NPU-compatible; the trunk placement is implicit (it goes where it fits, which on v75 with Q4_0 everything, is also NPU). The description conflates the specific OLMoE-Q4_0 result with a general rule.

**Impact:** Low for correctness (the predicate logic is right), medium for documentation clarity.

---

### T2 — R5 "hybrid ngl only if measured" references B-arm being worst [LOW]

**Verdict: PLAUSIBLE**

SPEC R5 note: `"hybrid ngl only if measured"`. This appears to reference ALIVE's finding that B-arm (trunk-GPU/experts-CPU, i.e. hybrid ngl) is the worst configuration (7.90 t/s on KEXP, 10.53 on OLMoE). But R5 is about full GPU offload (`gpu_fit` → ngl per fit-gate, which is full offload). The "hybrid ngl" caveat seems to warn against partial offload, which is correct but confusingly placed — R5 is the full-offload path, not the hybrid path.

**Impact:** The caveat is directionally correct (partial GPU offload is always worst per ALIVE), but its placement in R5 could mislead a reader into thinking R5 sometimes produces hybrid offload.

---

## Edge Case Findings

### E1 — npu_fit placeholder has no formal fallback for unknown models [MEDIUM]

**Verdict: CONFIRMED**

SPEC §4: `"The 1.1 margin is a placeholder: no q44-equivalent sweep exists for the HTP path yet"` and `"Until then npu_fit uses the conservative q46/q48 observed footprints per known model, table-driven."`

No model not in the q46/q48 footprint table can be evaluated for `npu_fit`. For an unknown model: `npu_fit` = false (conservative default), R2–R7 all skip (they require `npu_fit`), R8 may or may not match, R9 fires → CPU. This is safe (CPU is always allowed) but means the router is blind to NPU for any model without a measured footprint.

**Impact:** Not a bug — the conservative default is correct. But the spec should state the fallback explicitly: "unknown model → npu_fit = false → CPU."

---

### E2 — mem probe returning garbage could cause NPU OOM [MEDIUM]

**Verdict: PLAUSIBLE**

SPEC §3: `"mem_available_mb: number // probed at load, not cached"`. No validation or sanity check is specified. If the probe returns 0 (permission denied, kernel bug), both `gpu_fit` and `npu_fit` fail → R9 (CPU). Safe. If the probe returns a garbage large value (e.g. 99999), `npu_fit` passes for a model that won't actually fit → NPU load attempt → OOM/LMK kill.

The GPU path has an analogous issue but Adreno's driver would fail the OpenCL alloc and return an error. The NPU path materializes everything anon (ALIVE §8 law 4: "hard fit on 8 GB phones") with no graceful fallback — it is SIGKILL or nothing.

**Impact:** Real but bounded: the mem probe is the app's existing responsibility, and garbage values are rare. The spec should note that `npu_fit` trusts the probe and that a corrupt probe could cause NPU OOM.

---

### E3 — R8 condition "gpu_fit" on device with no GPU verdict [LOW]

**Verdict: CONFIRMED (non-issue)**

SPEC R8 requires `gpu_fit`. For Jelly (no HTP, Adreno G57): `gpu_fit` checks the q44 affine gate. The G57 GPU prefill is 0.24–0.96× (ALIVE §8), so the gate might pass (the model fits in memory) even though GPU prefill is slower than CPU. If R8 fires on Jelly: `v73` condition fails (Jelly is `no-htp`, not `v73`). R8 never fires on Jelly. Safe.

For a hypothetical v73 device with no GPU (hypothetical SoC): `gpu_fit` = false → R8 skips → R9 (CPU). Safe.

**Impact:** No real issue. The rule ordering prevents R8 from firing on devices where GPU prefill is pointless.

---

## Omission Findings

### O1 — ALIVE §8 law 5 energy datum presented as fact, but explicitly pending [MEDIUM]

**Verdict: CONFIRMED**

SPEC §4: `"Energy, first datum: NPU arm 0.86× J/token at matched work (single replica; the #24 sustained cell will confirm or kill it)."` — this is in the spec's §4 preamble, not in any rule.

ALIVE §8 law 5: `"Energy, first datum: NPU arm 0.86× J/token at matched work (single replica; the #24 sustained cell will confirm or kill it)."`

The spec copies this verbatim, including the caveat. However, the 0.86× J/token appears NOWHERE in the decision table rules (R1–R9). The router does not use energy data. This is correct — the spec should not encode unconfirmed data as policy. But the presence of the 0.86× figure in the spec's preamble without explicit "NOT used by router" labeling could mislead a reader into thinking the router accounts for energy.

**Impact:** The router correctly ignores the unconfirmed energy datum. The preamble mention is informational, not a policy error. Low risk of misinterpretation.

---

### O2 — ALIVE lane 13 "correctness gate still owed" for experts-on-NPU not flagged in §6 [HIGH]

**Verdict: CONFIRMED**

ALIVE lane 13: `"Correctness gate (text/PPL device HTP-vs-CPU) still owed."` for the 4.82× experts-on-NPU result.

SPEC §6 certification ladder: `"v75 experts-NPU (R2) | banked (4.82×) | uncertified — Xiaomi window | OFF"`. The word "uncertified" is present. But the spec's "correctness" column says "uncertified — Xiaomi window" without explicitly stating that NO correctness measurement exists — only dispatch/liveness (q48 shows `dspqueue_read 0x2e` death on v73, survival on v75 with 0 errors). The q48 report states: "this is a liveness + dispatch result, not a numerical-correctness proof."

The spec does say "uncertified" and routes it to OFF, so the behavior is correct. But the severity of the gap is understated: it is not merely "uncertified" (implying a test is running), it is "no correctness test has been designed or started for this specific lane." The q53 PREREG covers v73 trunk-NPU only, not v75 experts-NPU.

**Impact:** The OFF status is correct. The understatement of the correctness gap could lead someone to expect a faster flip to ON than is realistic.

---

### O3 — ALIVE lane 11 notes "single replica" for 1.46× / 0.86× — spec copies without highlighting fragility [LOW]

**Verdict: PLAUSIBLE**

ALIVE lane 11: the 1.46× and 0.86× J/token are from a single-replica measurement. SPEC R4: `"1.46×, J/token 0.86× (single replica)"` — the parenthetical is present but the implications are not expanded.

Single-replica means n=1 for the HTP arm; no variance estimate, no ABBA design, no statistical test. The number could be a warm-cache artifact or a cold-start outlier. ALIVE explicitly marks the energy as pending #24 sustained confirmation.

**Impact:** The spec acknowledges "single replica" in the text. A reader who sees this knows the number is weak. The spec could be more explicit that this is n=1 with no CI, but the current disclosure is adequate.

---

### O4 — GPU half-offload prohibition: spec hardcodes "NEVER allowed" but ALIVE never measured it as forbidden [MEDIUM]

**Verdict: PLAUSIBLE**

SPEC §4: `"half-offload GPU splits ('mezzo-offload MAI', 740 campaign)"` — listed as "never allowed, hardcoded." ALIVE's evidence: "B (trunk-GPU, experts-CPU) is the worst arm on both devices" (A/C 0.812 on KEXP, A/C 0.724 on OLMoE). B-arm IS a half-offload (trunk GPU, experts CPU), and it was measured as worst — but "worst" ≠ "forbidden."

The spec upgrades "always slow" to "hardcoded never." This is a policy choice, not a measurement result. ALIVE says "half-offload is NEVER right" in the synthesis paragraph, which does support the spec's stance. But ALIVE's language is "never right" (performance verdict), while the spec's "NEVER allowed, hardcoded" is an implementation prohibition. The gap is between "don't do it" and "can't do it."

**Impact:** The prohibition is defensible given ALIVE's data. The spec should clarify whether the prohibition is because (a) half-offload is always slower (measured) or (b) there is a technical reason it cannot work (not measured). Currently it presents as (b) when the evidence supports (a).

---

## Over-Engineering Findings

### OE1 — No over-engineering detected [CLEAN]

**Verdict: REFUTED (no finding)**

The spec is a static table + pure function + reason string logging. No runtime autotuning, no online benchmarking, no per-request switching, no scheduler. The `reason` field is a string logged at model load — trivial overhead. The `thermal_priority` toggle is a boolean. The fit predicates are arithmetic comparisons. The certification ladder is a manual table flip.

This is exactly the "static table + pure function" the owner wants.

---

## Rule Ordering Exhaustive Trace

For each requested (device, model) combo, the rule that fires:

| Combo | Arch | Trunk | Expert | Rules evaluated (skip → match) | Fires | Engine |
|---|---|---|---|---|---|---|
| S23 + KEXP | moe | Q5_K/Q6_K | Q2_K/Q3_K | R1 skip, R2 skip (v73), R3 skip (v73), R4 skip (v73), R5 skip (gpu_fit on KEXP=...?), **R8** if thermal_priority+gpu_fit, else **R9** | R8 (thermal) or R9 (CPU) | GPU-cool or CPU |
| S23 + dense-Q4_0 | dense | Q4_0 | n/a | R1 skip, R2 skip, R3 skip (v73), R6: v73 ∧ dense ∧ npu_ok(Q4_0)=T ∧ npu_fit | **R6** | NPU full |
| S23 + Marco-B′ (6.5G) | moe | Q8_0 | Q2_K/Q3_K | R1 skip, R2 skip (v73), R3 skip (v73), R4 skip (v73), R5 gpu_fit=FAIL (6.5G > 8GB-OS), R6 skip (moe≠dense∨hybrid), R7: v73 ∧ moe ∧ npu_ok(Q8_0)=T ∧ **npu_fit=FAIL** (6.5G anon > 8GB), R8 gpu_fit=FAIL, **R9** | R9 | CPU |
| Xiaomi + KEXP-B′ | moe | Q8_0 | Q2_K/Q3_K | R1 skip, R2 skip (npu_ok(Q2_K/Q3_K)=F), R3 skip (moe), R4: v75 ∧ moe ∧ npu_ok(Q8_0)=T ∧ npu_fit | **R4** | NPU trunk, experts CPU |
| Xiaomi + OLMoE-Q4_0 | moe | Q4_0 | Q4_0 | R1 skip, R2: v75 ∧ moe ∧ npu_ok(Q4_0)=T ∧ npu_fit | **R2** | NPU experts+trunk |
| Jelly + KEXP | moe | Q5_K/Q6_K | Q2_K/Q3_K | **R1**: no-htp | **R1** | CPU |

All combos produce a result. No combo falls through all rules without matching (R9 is the universal fallback). No combo produces a clearly wrong engine for the measured data.

---

## Summary

| Severity | Count | IDs |
|---|---|---|
| HIGH | 2 | F1 (R7 cites wrong cell), O2 (correctness gap understated) |
| MEDIUM | 5 | F3 (R8 "KEXP only" not in predicate), F4 (R8 unreachable for fitting v73 MoE), T1 (R2 description conflates configs), E1 (npu_fit unknown-model fallback), E2 (garbage probe → NPU OOM), O4 (half-offload prohibition overclaims) |
| LOW | 4 | F2 (R3 missing citation), T2 (R5 hybrid caveat misplaced), E3 (non-issue), O3 (single replica disclosure), O1 (energy datum in preamble) |
| CLEAN | 1 | OE1 (no over-engineering) |

**Total findings: 12 (2 HIGH, 5 MEDIUM, 4 LOW, 1 REFUTED)**

No rule produces a wrong engine for any tested (device, model) combination. The table logic is correct for all six enumerated combos. The findings are documentation fidelity gaps, not logic bugs. The most consequential is F1 (R7 cites a cell that does not contain the claimed number) and O2 (the v75 experts-NPU lane has no correctness test designed, let alone running, and the spec understates this). The R8 ordering constraint (F4) is a latent maintenance hazard — the rule is unreachable for the majority of v73 MoE models and its "KEXP only" label is decoration, not enforcement.

---

## RE-AUDIT v0.1

**Audit date:** 2026-08-24 (same session). **Spec under review:** `SPEC.md` v0.1.
**Ground truth unchanged:** ALIVE.md §8 + lanes 9–13; q44/q46/q48 REPORTs; q53 PREREG.

### 1. Verification of v0 findings (12 items)

| # | Finding | v0.1 status | Evidence |
|---|---|---|---|
| F1 | R7 cited q46 for "+14% pp" — metric absent | **FIXED** | R7 now reads `pp512 1.14× [ALIVE lane 11, from q46 raw 58.43/51.08]` — cites the correct cell AND shows the derivation. |
| F2 | R3 used 3.19× without cell citation | **FIXED** | R3 now reads `3.19× [ALIVE lane 9]`. |
| F3 | R8 "KEXP only" not enforced by predicate | **MITIGATED, OPEN** | R8 condition unchanged (`v73 ∧ moe ∧ thermal_priority ∧ gpu_fit`). The note now documents the gap and pins `cool-mode-untested-model` into the `reason` string as a golden-test sentinel. The predicate itself still does not filter by model identity — any NPU-incompatible v73 MoE reaching R8 fires with KEXP-specific numbers. Mitigation is adequate for v0; the predicate gap remains. |
| F4 | R8 unreachable for fitting v73 MoE | **FIXED** | New note in §5: "R8 is reachable only when the NPU lanes declined — i.e. for v73 MoE whose trunk is NOT HTP-readable (KEXP Q5_K/Q6_K: exactly the measured case) or that fails npu_fit. It is the thermal fallback for the NPU-incompatible subset." This is the correct characterization. |
| T1 | R2 "NPU experts+trunk" conflated two configs | **FIXED** | R2 condition changed to `npu_ok(expert_quants ∪ trunk_quants)` — the union makes the all-Q4_0 semantics explicit. Basis cell annotated `[q48, OLMoE all-Q4_0]`. No ambiguity remains. |
| T2 | R5 "hybrid ngl only if measured" misplaced | **FIXED** | R5 now reads `GPU, FULL offload only (ngl per fit-gate; partial splits prohibited, see below)` with the prohibition rationale in the "Never allowed" block. The ambiguous hybrid caveat is gone. |
| E1 | npu_fit unknown-model fallback undetermined | **FIXED** | §5: `Unknown model ⇒ npu_fit = false ⇒ CPU (explicit conservative fallback, audit E1)`. Explicit. |
| E2 | Garbage mem probe → NPU OOM | **FIXED** | §4: `mem_available_mb is sanity-clamped against device total RAM; an implausible probe (≤0 or > total) fails ALL fit-gates → CPU`. Cross-references audit E2. |
| E3 | R8 gpu_fit on device with no GPU verdict | **CLOSED (non-issue, unchanged)** | Still a non-issue: no known device lacks a GPU while having v73. |
| O1 | Energy datum in preamble presented as fact | **FIXED** | §5 preamble: `Informational, NOT used by any rule: the 0.86× J/token energy datum is single-replica and pending #24 — v0 ignores energy entirely.` Unambiguous. |
| O2 | v75 experts-NPU correctness gap understated | **FIXED** | §6 R2 row: `NO correctness test designed yet — q48 was liveness+dispatch only; needs its own cell (q55 candidate, Xiaomi window)`. §7 item 2: `q55 (to be designed)`. No more "uncertified" without explanation. |
| O3 | Single-replica 1.46×/0.86× disclosure thin | **UNCHANGED** | R4 retains `single replica [ALIVE lane 11 houji]`. Adequate — the parenthetical flags the weakness. |
| O4 | Half-offload prohibition overclaims technical impossibility | **FIXED** | §5 "Never allowed" block: `Partial GPU offload splits: performance ban, not a technical impossibility (audit O4) — the B-arm measured WORST on both generations`. Honest about what the evidence supports. |

**Scorecard: 10 FIXED, 1 MITIGATED/OPEN (F3), 1 UNCHANGED (O3, adequate), 1 CLOSED (E3).**

### 2. Attack on new material

#### §2 Modularity — is anything over-engineering?

Four modules, all data or pure functions. No plugin runtime, no service bus, no dynamic loading. The spec explicitly excludes these in §1 non-goals. The `schema_version` check is a string comparison that fails to CPU — trivial. Golden contract tests are unit tests pinning the six traced combos and OFF lanes — standard practice, not over-engineering.

**One gap:** §2 says fit-gates are "swappable functions referenced BY NAME from the tables" but does not define the failure mode when a name does not resolve to a loaded function. If a table references `npu_fit_v2` but only `npu_fit` is implemented: unresolvable name → the fit-gate cannot be evaluated → `npu_fit = false` → CPU. Safe, but undocumented. **F13 (LOW):** add one sentence: "Unresolvable fit-gate name ⇒ fit = false ⇒ CPU."

**No over-engineering finding.** The module split is the minimum viable separation for the owner's update-without-breaking requirement.

#### §2 Certification ledger vs §5/§6 consistency

The ledger is data (lane ON/OFF + evidence cell id). The tables are data (per-generation verdict columns). The rules reference both. §5 states: "A rule fires ONLY if its lane is ON in the ledger." This is the correct glue. No inconsistency found: the ledger and tables serve different axes (proven-state vs measured-speed), and the rule engine checks both before firing.

**One edge case:** R9 (otherwise → CPU) has no ledger entry — it is the implicit fallback when no rule matches. This is correct (R9 is not a lane, it is the absence of a lane) but could confuse a implementer who tries to look up R9 in the ledger. **F14 (LOW):** add a one-liner: "R9 has no ledger entry; it fires when no other rule matches."

#### §4 Generation recognition — contradiction with "no runtime migration"?

Post-launch lane verification checks whether the chosen lane actually engaged (offloaded-layer count for GPU, execute-op evidence for NPU). On failure: log `lane_fallback`, continue on CPU. No retry, no migration, no re-routing.

This is verification + fallback, not runtime migration. The non-goal says "no runtime engine migration" meaning the router does not switch engines mid-request or between requests. A one-time post-load check that catches a silent CPU fallback is defensive instrumentation, not a scheduler. **No contradiction.**

#### §4 LaunchConfig — `npu-experts` dropped

v0 had `npu-experts` as a prefill_engine option. v0.1 drops it: `cpu|gpu|npu-full|npu-trunk`. This is correct — R2 now describes "NPU full graph" (all tensors HTP-readable → everything on NPU), so `npu-full` covers both dense-NPU and MoE-all-Q4_0 cases. No rule produces `npu-experts` anymore. **Clean.**

#### R2 rewording

v0: `npu_ok(expert_quants)` → v0.1: `npu_ok(expert_quants ∪ trunk_quants)`. Correct. The union ensures ALL tensors must be HTP-readable for full-NPU dispatch. For KEXP-B′: `npu_ok({Q2_K,Q3_K} ∪ {Q8_0}) = false` → R2 skips → R4 matches (trunk NPU, experts CPU). For OLMoE-Q4_0: `npu_ok({Q4_0} ∪ {Q4_0}) = true` → R2 fires → full NPU. Both match measured data. **Clean.**

#### R7 rewording

Basis changed from `[q46]` to `[ALIVE lane 11, from q46 raw 58.43/51.08]`. The derivation is now transparent. **Clean.**

#### R8 note and golden-test sentinel

The note correctly characterizes R8 as "thermal fallback for the NPU-incompatible subset" and pins `cool-mode-untested-model` into the reason string for any non-KEXP model reaching R8. The golden test pins this sentinel. This is a sound v0 mitigation for F3 — the predicate gap is acknowledged, not hidden. **Acceptable for v0.**

#### New prohibition rationales

Three "Never allowed" items now carry explicit evidence citations:
1. Experts-on-NPU on v73: `F6 — two characterized skel firmware defects`. Cites q48/q50/q51. Correct.
2. Partial GPU offload: `performance ban, not a technical impossibility (audit O4)`. Cites A/C ratios. Honest.
3. Vulkan on K-quants: `backend dead`. Matches ALIVE. **Clean.**

### 3. Certification ladder §6 vs current reality

| Lane | §6 claim | Reality check | Verdict |
|---|---|---|---|
| v73 trunk-NPU (R7) | `q53 RUNNING` → OFF → ON at PASS | q53 PREREG is locked, owner said "procedi". RUNNING is accurate. | **CORRECT** |
| v73 dense-NPU (R6) | `q53 lane-2 conditional` → OFF | q53 lane-2: "ONLY IF an NPU-compatible dense/hybrid gguf is ALREADY on the device". If none exists: SKIP + record. §6 hedges correctly with "conditional". But §6 does not note the likely outcome: q53 lane-2 will likely SKIP (no dense/HPT-compatible gguf on S23 per q53 constraints — no new pushes allowed, /data ~96% full). **F15 (LOW):** §6 R6 row should note: "q53 lane-2 likely SKIP unless a dense HTP-compatible gguf is already on device". |
| v75 experts-NPU (R2) | `NO correctness test designed yet` → OFF | q48 was liveness+dispatch on v75. No PPL/correctness cell exists. q55 mentioned as candidate in §7 but not designed. | **CORRECT** |
| v75 dense/trunk NPU (R3/R4) | `uncertified, no cell designed` → OFF | R4 is single-replica. No correctness cell for R3 or R4 exists. | **CORRECT** |
| GPU 750 prefill (R5) | `407/407 kernel suite` → ON | ALIVE confirms 407/407 on 750. Speed banked at 2.48×. | **CORRECT** |
| GPU 740 cool-mode (R8) | `407/407` → OFF until #24 | #24 (sustained energy/thermal) not yet run. OFF correct. | **CORRECT** |
| q55 | Referenced in §7 as candidate | q55 does not exist. The spec says "to be designed", not "running". | **CORRECT (no overclaim)** |

### 4. Re-audit findings

| ID | Severity | Description |
|---|---|---|
| F3-open | MEDIUM | R8 predicate still lacks model-identity check. Mitigated by reason-string sentinel + golden test, but the predicate itself is unchanged from v0. Acceptable for v0; must be addressed if a non-KEXP v73 MoE ever exists. |
| F13 | LOW | Fit-gate name resolution failure mode undocumented. Safe default (fit = false → CPU) but should be stated. |
| F14 | LOW | R9 has no ledger entry. Correct by design but should be stated to avoid implementer confusion. |
| F15 | LOW | §6 R6 row does not note q53 lane-2 is likely SKIP (no qualifying gguf on device under q53 constraints). |

**Re-audit total: 1 MEDIUM, 3 LOW, 0 HIGH.**

### Verdict

**FINDINGS REMAINING: 4 (1 MEDIUM, 3 LOW).**

The v0→v0.1 revision resolved 10 of 12 original findings completely, mitigated 1 (F3, now a documented & golden-tested sentinel), and left 1 unchanged but adequate (O3). The new modularity model is clean — no over-engineering, no inconsistency with the ledger/rules split. The generation recognition and post-launch verification do not contradict the non-goals. The four new findings are all LOW-to-MEDIUM documentation gaps with safe defaults; none produces a wrong engine assignment. The spec is in a shippable state for v0 implementation with the understanding that F3 (R8 predicate) is a known v1 item.
