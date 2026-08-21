# AUDIT REPORT — prereg-kexp-audit (hostile methodology audit, PREREG_KEXP_N5.md v1.0)

Auditor: hostile/paranoid, read-only. Target: `results/kexp_speed_s23/PREREG_KEXP_N5.md` (v1.0, queue #18).
Context: `results/olmoe_gpu_moe_s23/PREREG_N10.md` v1.2, `results/kexp_speed_s23/{runs.csv,MANIFEST.md,sha_session_start.txt,kexp_host.log,REPORT.md}`, `scratchpad/agents/n10-kexp-audit/REPORT.md`, engine source `BigMoeOnEdge/third_party/llama.cpp`, `PLAN.md`.

**STATUS: COMPLETE.**

## FINDINGS

### F1 — REFUTED (attack fails): every cited exploratory number and sha recomputes exactly

Recomputed from `results/kexp_speed_s23/runs.csv` (8 rows, raw values):

- Median A = (12.278213+15.202009)/2 = **13.740111** → 13.740 ✓. Median B = (7.569378+7.594689)/2 = **7.582034** → 7.582 ✓. Ratio = **1.812193** → 1.812 ✓. N=4+4 ✓.
- Per-block mean(A)/mean(B): block 1 = 14.120425/7.582034 = **1.8629** → 1.862 ✓; block 2 = 13.384982/7.498691 = **1.7849** → 1.785 ✓.
- Decay: 1−12.278213/15.962636 = **23.1%** ✓; 1−11.567954/15.202009 = **23.9%** ✓. First-A 15.96/15.20, second-A 12.28/11.57 ✓.
- Cell wall times from iso_pre/iso_post: 56, 83, 83, 68, 56, 81, 88, 71 s → range **56–88 s** ✓; A cells 56/68/56/71 → "~56–72 s" ✓; B cells 83/83/81/88 → "~81–88 s" ✓.
- Temp peaks: A 32.1/37.8/36.7/38.7, B 36.1/37.8/38.6/38.7 → "32–39 vs 36–39 °C" ✓ (rounding).
- Shas: impl `d2030f23…` and opencl `b9d99fa8…` match all 8 csv rows, `sha_session_start.txt`, host-log SHA_BLOCK, MANIFEST ✓. Model `b07c8087…` in `sha_session_start.txt` (last line) and host log 18:24:13 ✓.
- **Stub `b2ae0fa6…`: EXISTS.** It is line 1 of `sha_session_start.txt` (`llama-bench`), in the host-log SHA_BLOCK (18:24:17), and in the MANIFEST pins table. The attack premise ("nowhere") fails.

One numeric error found, see F2.

### F2 — CONFIRMED (trivial): "B flat (7.59–7.31)" is the wrong range

Exploratory B values are 7.594689, 7.569378, 7.683361, 7.314020. The actual range is **7.31–7.68**, not "7.59–7.31" — the quoted interval excludes the maximum 7.683. Cosmetic, but a prereg that gets its own motivation data's range wrong on the first page invites the reviewer who checks nothing else. Fix: "B flat (7.31–7.68)".

### F3 — CONFIRMED (moderate): palindrome math is right for first-order, overstated for second-order

Verified: positions A{1,6}, B{2,5}, C{3,4}; mean position **3.5 for all three** ✓; position sums all 7, so any **linear** drift cancels exactly for all arms ✓. That part of the claim is correct.

But for a quadratic component f(t)=ct²: mean penalty A = c·(1+36)/2 = **18.5c**, B = c·(4+25)/2 = **14.5c**, C = c·(9+16)/2 = **12.5c**. The documented ~24% A-decay is precisely such a convex (thermal) component, and the prereg itself concedes the second A now follows **four** cells (B,C,C,B) instead of two, so decay may exceed 24%. "The palindrome is the control" / "ABC-CBA still balances it" is therefore overstated: the design does **not** balance second-order drift; it systematically assigns A the largest share of it (A sits on both extremes, C on the two middle positions).

Mitigation, which the audit acknowledges: the bias direction is **conservative for both floors** — it depresses measured A, hence depresses A/B and A/C. A real effect is more likely to fail a floor than to fake a pass. And the pre-declared per-block robustness check catches a thermal collapse. So this is a wording defect, not a validity defect. Required change: state explicitly that the palindrome cancels first-order drift only, that the quadratic component loads on A (≈18.5 vs 12.5 in units of curvature), and that this biases both floors downward (conservative).

### F4 — CONFIRMED (moderate — the prime-suspicion finding): arm-C "upstream default" framing is false as written; it is the PRODUCT default

Verified in engine source (`BigMoeOnEdge/third_party/llama.cpp`):

1. **Stock upstream default has repack ON.** `ggml/CMakeLists.txt:152` `GGML_CPU_REPACK … ON`; `common/arg.cpp:2174` documents weight repacking `default: enabled`; `src/llama-model.cpp:2317` `use_extra_bufts = true`. The `use_extra_bufts=false` at `src/llama.cpp:416` is **this fork's** noextra override — i.e. the frozen `d2030f23` impl is the *non-default* configuration upstream.
2. **ARM repack coverage** (`ggml/src/ggml-cpu/repack.cpp`, `ggml_repack_get_optimal_repack_type`, NEON i8mm/dotprod branches): Q4_0, Q4_K, **Q5_K**, **Q6_K**, IQ4_NL, MXFP4, Q8_0. **Q2_K is gated on AVX512 / RISC-V only — never on ARM. Q3_K has no traits at all — never repacked on any arch.**
3. **KEXP tensor types** (PLAN.md line 64, "verificato al gguf"; recipe: 44×q2_k gate/up, 22×q3_k down): **experts = Q2_K + Q3_K; trunk = Q5_K + Q6_K.**

Consequences:

- The experts — the tensors whose placement A and B differ on — are **repack-invariant on this SoC**. Repack cannot touch the A-vs-B comparison, and cannot touch the expert side of C. That part of the design survives a hostile reviewer.
- But at `-ngl 0` the **trunk (Q5_K/Q6_K) sits on CPU**, and genuine upstream default **would repack it** (NEON i8mm 8x8 / dotprod 8x4, `ne[1]%8`). So the prereg's noextra C is a **slower-or-equal lower bound** on true upstream-default CPU performance, and the measured A/C ratio **overstates** the advantage vs what upstream actually gives. If measured A/C lands 1.20–1.30, the true upstream-default ratio can be <1.20 — the ship sentence would not survive an external reviewer who reads `arg.cpp`.
- The sentence "pure CPU — **upstream default** with the GPU MoE gate active" conflates two defaults. It is the **product** default: PLAN.md (oomwall chapter, line 216) says production is "strutturalmente immune, use_extra_bufts=false". Product-faithful, yes; upstream default, no.
- Internal tension: the same document **forbids** the stock extra_bufts binary (`bad17952…`) while calling the noextra configuration "upstream default". A reviewer will ask why the upstream-default binary is banned in a doc claiming to measure the upstream default.

What survives: the oomwall rationale for the ban is type-specific — the Mellum2 wall was ~6.5 GB anonymous `posix_memalign` from **Q4_K expert** repack; KEXP experts (Q2_K/Q3_K) have no ARM repack path, so a stock-impl C cell would only pack trunk copies, and the oomwall mechanism cannot fire the same way.

Required change (pick one, minimum is (a)):
- (a) Rename the claim: C = "pure CPU under the same frozen noextra binary — the **product** default placement", drop "upstream default", and add one justification paragraph: Q2_K has no ARM repack (AVX512/RVV only), Q3_K none at all, so the placement comparison is repack-invariant on the experts; trunk Q5_K/Q6_K would repack upstream, making noextra-C a conservative bound.
- (b) Stronger: add a pre-declared **D probe cell** (stock `bad17952` impl, `-ngl 0`, descriptive, not gated) to bound the trunk-repack delta on C directly.

(Also fix F2 while editing this paragraph.)

### F5 — CONFIRMED (moderate): enforcement has four unhandled / ambiguous states

The 10-min cap (exclude/wait/STOP, no SIGTERM), exclusion rule 3 (rc≠0 aborts everything) and the 15-min STOP are individually coherent, and the specific case asked about — a C cell returning rc=0 at 12 min — is handled correctly: rule 6 excludes it, the block is incomplete, rule 7 drops it and requires extra blocks; it is **not** a "15-min-still-running" STOP trigger and correctly feeds the C-amendment watch. But a tired operator still hits these holes:

- **(a) "If C *regularly* exceeds 10 min" is undefined.** No count, no window. Is 2 over-cap C cells in 5 blocks "regularly"? 3? Operator-invented thresholds post-hoc = protocol drift. Fix: e.g. "≥2 C cells ≥10 min within the first 2 blocks → stop + amend".
- **(b) Over-cap cell that returns rc≠0** (LMK kill at minute 11): rule 3 says rc≠0 aborts everything; rule 6 says ≥10 min excludes. Precedence unspecified — one reading kills the whole dataset for a cell that was already destined for exclusion. Fix: state that wall≥10 min ⇒ exclude regardless of rc, unless a MemAvailable/adb-255/power-off event also fired.
- **(c) 15-min STOP leaves the process alive and says "do not start the next cell"** — but never says whether the prereg is dead or the session may resume after the process eventually exits. Fix: one sentence.
- **(d) Mid-cell Doze is not gated.** Exclusion rule 1 checks `mWakefulness` at launch only; `wake_post` is recorded but nothing keys an exclusion to it. The Mellum2 incident (n10-audit F10) proves mid-cell Doze happens on this device even under a 30-min pin. A <10-min rc=0 cell corrupted by mid-cell Doze would enter the median unflagged. The 15-min screen timeout protects only cells under the cap, and the cap permits cells up to exactly that boundary. Fix: add "wake_post ≠ Awake → exclude".

### F6 — PLAUSIBLE (moderate): the A/B 1.50 floor can fail in the all-warm session the doc explicitly allows

From the exploratory: first-A 15.20–15.96, second-A 11.57–12.28, B temp-flat 7.31–7.68 (B pairs near-equal within block at 36–39 °C — B is temperature-insensitive in range, A is not). With 10 A cells, median(A) = mean of 5th/6th order stats ≈ (typical second-A + typical first-A)/2.

Warm-stack scenario (all blocks warm-start at ~37–38 °C, which v1.0 permits and counts): first-A ~13, second-A ~10.5 → median ≈ 11.75 → ratio ≈ **1.55** — passes but thin. One step worse (second-A ~9.5, first-A ~12.5): median ≈ 11.0 → **1.45** — a true ~1.8 effect fails to ship. The floor justification argues from the exploratory point estimate and cross-model comparison but never models the warm-stacked session its own sensitivity analysis makes primary. This is a calibration gap, not a lock-integrity flaw. Fix: pre-declare that an A/B fail with ≥3 warm-start blocks triggers an owner decision to re-run cooled rather than silent refute.

### F7 — REFUTED (one residual): the "locked before run" language is internally airtight, but tamper-evidence is asserted, not provable

Airtight parts: the doc states 1.20 is a guess, adjudication notes bind against changing it after seeing C, C has no exploratory number anywhere (verified: no C rows in any artifact), and the run has not happened (`kexp.log` ends at exploratory block 3; `REPORT.md` is exploratory-only; status "Not run" truthful).

Residual (CONFIRMED, minor): nothing binds the text to a point in time — no git sha / content hash of this file is recorded anywhere. "Locked before the run" is currently an assertion a hostile external reviewer cannot check. Fix: commit the doc and print its own sha inside it before lock.

### F8 — CONFIRMED (minor): two session-audit hygiene findings are NOT incorporated

Checked each n10-audit item against v1.0:

- F9 raw probe archive → incorporated ✓ (binding `probes/` section, raw pulls, sha'd, ps/kgsl for stalls).
- F16 pause path → incorporated ✓ (`results/kexp_speed_s23/pauses/`; the stray record has already been relocated there).
- Screen-timeout sizing → incorporated ✓ (900000 ms justified against the cap, not the happy path).
- No-SIGTERM → incorporated ✓ (cap items 1–3 + criterion 10 + exclusion 3's rc=143 clause).
- F18 device-side stderr → incorporated ✓ (stderr in per-cell minimum archive).
- **F19 NOT incorporated:** `GGML_OPENCL_LOG_ALLOC unset` remains an asserted pin with no evidence step. Fix: archive `printenv | grep GGML_OPENCL_LOG_ALLOC` (or adb equivalent) at session start.
- **F10 lesson NOT incorporated:** mid-cell Doze — see F5(d).
- **F1 lesson NOT incorporated:** no rounding rule is fixed for reported medians. The temp gate margin (0.5 °C) is 5× the sensor's 0.1 granularity; a 38.95→39.0-style upward rounding could flip a tight pass either way. Fix: report medians to full precision or 3 decimals, never round across the margin.

### F9 — REFUTED (two soft spots): ship criteria are testable as written

Criteria 1–4 map to runs.csv/state medians; 6 to MemAvailable logs; 7 to per-cell sha blocks (the raw-archive section mandates them); 8–9 to recorded settings/governor/pause/probe files. Criterion 10 (no SIGTERM) is verifiable only indirectly (rc column ≠143, absence of kill records) — acceptable for an absence claim. Two soft spots:

- Criterion 5 says gates held "on every counted cell", but the unplug gate is checked **per block** only; a mid-block plug-in is detectable solely via level deltas. Either add a per-cell header grep or reword to "every counted block".
- Criterion 8 "screen timeout 900000 **or the recorded settings get value**" is circular — any recorded value satisfies it. Tighten to "recorded value == 900000, else explain".

## VERDICT SUMMARY

| # | Finding | Verdict | Severity |
|---|---|---|---|
| F1 | All cited exploratory numbers + shas recompute; stub `b2ae0fa6` EXISTS (sha_session_start.txt, host log, MANIFEST) | REFUTED (attack fails) | — |
| F2 | "B flat (7.59–7.31)" wrong range (actual 7.31–7.68) | CONFIRMED | trivial |
| F3 | Palindrome: first-order cancellation exact; quadratic drift loads on A (18.5c vs 14.5c vs 12.5c); "the palindrome is the control" overstated — but bias is conservative for both floors | CONFIRMED | moderate (wording) |
| F4 | Arm C = product/noextra default, NOT upstream default; trunk Q5_K/Q6_K repackable on ARM, experts Q2_K/Q3_K repack-invariant (Q2_K AVX512/RVV-only, Q3_K no traits); noextra-C understates CPU → measured A/C overstates vs true upstream default; doc bans the stock binary while claiming to measure it | CONFIRMED | **moderate-high (framing)** |
| F5 | "regularly exceeds" undefined; over-cap rc≠0 precedence unspecified; post-STOP resumption unspecified; mid-cell Doze ungated | CONFIRMED | moderate |
| F6 | A/B 1.50 floor can fail in an all-warm session (~1.45 achievable with a true ~1.8 effect); warm-stack scenario unmodeled | PLAUSIBLE | moderate |
| F7 | 1.20 locked-guess language airtight internally; run verifiably not started; missing self-hash/commit tamper-evidence | REFUTED (residual: minor) | minor |
| F8 | Hygiene: F9/F16/F18/timeout/SIGTERM incorporated; F19 (LOG_ALLOC evidence), F10 (mid-cell Doze), F1 (rounding rule) NOT | CONFIRMED | minor |
| F9 | Ship criteria testable from planned artifacts; criterion 5 per-cell unplug claim vs per-block gate; criterion 8 circular "or recorded value" | REFUTED (soft spots noted) | minor |

## FINAL VERDICT

**AMEND.** The core design is sound and every number it cites is real, but lock is denied as-is. Required changes before locking v1.1:

1. **F4:** Rewrite the arm-C sentence: drop "upstream default"; C = pure CPU under the same frozen noextra binary = the **product** default placement. Add one justification paragraph: Q2_K has no ARM repack path (AVX512/RVV only in `repack.cpp`), Q3_K none at all → expert placement comparison is repack-invariant; trunk Q5_K/Q6_K would repack upstream, so noextra-C is a conservative (slower-CPU) bound on upstream stock. Optionally add a pre-declared descriptive D probe (stock `bad17952`, `-ngl 0`) — the Mellum2 oomwall mechanism cannot fire on this model's expert types.
2. **F5:** Define "regularly" (e.g. ≥2 C cells ≥10 min within the first 2 blocks → stop+amend); state that wall≥10 min ⇒ exclude regardless of rc unless MemAvailable/adb-255/power-off also fired; state whether the session resumes after a 15-min STOP process exit; add exclusion "wake_post ≠ Awake → exclude".
3. **F6:** Pre-declare that an A/B floor fail with ≥3 warm-start blocks triggers an owner cooled-re-run decision rather than silent refute.
4. **F8:** Add archived LOG_ALLOC-unset evidence at session start; fix the exploratory range to 7.31–7.68 (F2); fix median rounding rule (full precision / 3 decimals, never round across the 0.5 °C margin).
5. **F9:** Reword criterion 5 to "every counted block" or add per-cell unplug grep; tighten criterion 8 to "recorded value == 900000".
6. **F7:** Record the document's own sha/commit inside it before lock.
7. **F3:** State that ABC-CBA cancels first-order drift only and that the quadratic component loads on A (conservative direction for both floors).

---

## v1.1 RE-VERIFY (2026-08-21, re-read of PREREG_KEXP_N5.md v1.1)

Per-amendment check against v1.1 body text, not the changelog:

| # | Amendment | Implementation found | Verdict |
|---|---|---|---|
| F2 | B range fix | "B flat (**7.31–7.68**)" in both header paragraph and intra-block table section | **PASS** |
| F3 | First-order-only palindrome + quadratic loads on A + conservative direction | New "First-order only (F3)" paragraph with positions A{1,6}/B{2,5}/C{3,4}, penalties 18.5c/14.5c/12.5c, explicit "does **not** cancel that component … depresses measured A and therefore **both** A/B and A/C"; "Why ABC-CBA" now scoped to first-order; intra-block section ends "…is the control, not 'balanced second-order.'"; expected-outcomes table updated | **PASS** |
| F4 | Arm-C rename + repack-coverage paragraph | Title/hypothesis/arms table all renamed to "product default / no-offload baseline"; new "Repack coverage" paragraph states: stock upstream repack ON (`use_extra_bufts=true`) ✓; experts Q2_K+Q3_K / trunk Q5_K+Q6_K ✓; Q2_K AVX512/RVV-only no NEON path ✓; Q3_K no traits ✓; trunk would repack at `-ngl 0` upstream ✓; noextra-C understates → A/C overstates ✓; "ships the product/no-offload sentence, not an upstream-llama.cpp sentence" ✓ — all four type facts match the repack.cpp findings exactly | **PASS** |
| F5 | Cap ambiguities closed | "regularly" = ≥2 C cells wall≥10 min → stop+amend ✓; precedence "rule 3 > rule 6", over-cap rc≠0 = wall abort, rule 3 "regardless of wall-clock", rule 6 now gated on rc=0 ✓; 15-min STOP = "session is OVER", resumption needs written amendment ✓; new exclusion rule 7 `wake_post ≠ Awake` → exclude, mirrored in Wakefulness-at-return section, harness notes (pre **and** post), and criterion 5 | **PASS** |
| F6 | Warm-stack floor risk | Floor stays 1.50; new interpretive rule: all-blocks 1.40–1.50 AND cool-start secondary ≥1.50 on ≥3 cool blocks → report + re-run with cooldown emphasis, not ship/refute; <3 cool blocks → fall-through stated. Different mechanism than my suggested warm-count trigger but a tighter implementation of the same intent — owner-arbitrated, accepted | **PASS** |
| F7 | Lock tamper-evidence | New Lock paragraph: v1.1 committed to Aspis0 before session, session log cites commit hash, no invented in-file hash, git history = tamper evidence; new ship criterion 11 | **PASS** |
| F8 | LOG_ALLOC evidence + rounding rule | Binary/flags: LOG_ALLOC-unset evidenced by archived env grep under `probes/` (empty/absent = pass); raw-archive minimum includes it; criterion 7 includes it; harness notes include it. New "Median comparison rule": full precision, report 3 decimals, no rounding before floor compare or the 0.5 °C margin ("38.95 is not 39.0"); criteria 2–3 reference it | **PASS** |
| F9 | Criteria 5/8 tightening | Criterion 5 reworded to unplug-per-block + Awake-per-cell (launch and wake_post); criterion 8 brightness readback must equal 128, else justify/fix before block 1; pinning table and harness notes aligned | **PASS** |

**(b) Regression sweep:** arms A/B flags unchanged; floors 1.50/1.20 unchanged; temp gate unchanged; cap mechanics (exclude/wait/STOP, no SIGTERM) intact — cap item 2's added rc≠0 pointer is consistent with the precedence fix, not a change of behavior; cooldown/battery/pins/wifi/governor sections unchanged except the brightness readback strengthening (intended); exclusion rules 1–5 preserved, 6 narrowed exactly per precedence, old rule 7 renumbered to 8 verbatim; tg512-only, J/token, model/opencl/impl/stub shas unchanged; counts still 30 cells / 10 per arm; stock extra_bufts forbidden scope correctly limited to A/B/C. Changelog entries match the body.

**(c) Arm-D paragraph:** after-the-bag ✓ ("Only after N≥5 complete blocks are on disk"); never-ship ✓ ("Never enters any median or ship sentence" + listed under Not-ship criteria); MemAvailable abort ✓ (drop ≥2.0 GB = oomwall-class); cannot-touch ✓ ("stop D immediately, leave A/B/C files alone", power-off/adb-255 same). The quoted full stock sha `bad179520546…c171` was independently verified against `results/oomwall_s23/MANIFEST.md`, `results/oomwall_s23/staging/SHA256.txt`, and `results/olmoe_gpu_moe_s23/n10/_pc_sha.txt` — genuine, not invented. Residual nitpick (non-blocking): exclusion rule 3 still reads "abort the whole N≥5" without an A/B/C scope marker, while the D paragraph overrides for D cells; the specific override governs and D runs post-completion so the abort is moot — one scoping word ("in an A/B/C cell") would remove the last pedant target.

**(d) Repack facts:** verified correct against my source findings (see F4 row). No misstatement found.

**RE-VERIFY VERDICT:** all 8 amendments present and correctly implemented; no regressions; arm-D wording respects all three constraints; repack paragraph accurate. One optional scoping word noted above, non-blocking.

**LOCK**

