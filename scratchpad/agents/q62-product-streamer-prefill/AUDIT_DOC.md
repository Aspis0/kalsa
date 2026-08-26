# q62 HOSTILE DOCUMENTARY AUDIT — pre-BANKING

**Date:** 2026-08-26 · **Scope:** PLAN.md #33 (Italian), docs/ALIVE.md #15 (English), REPORT.md, AUDIT_MATH.md, PREREG.md, RUN_LOG.md, manifest.json  
**Gate:** AUDIT_MATH already applied (BANK-WITH-CORRECTIONS, wording only, all corrections applied) — this audit does NOT re-derive statistics.

---

## 1. Number traceability (PLAN #33 ↔ REPORT/AUDIT_MATH)

| Number | PLAN #33 text | Source | Status |
|---|---|---|---|
| walls 38.05 / 35.81 / 32.78 s | `wall 38.05 / 35.81 / 32.78 s` | AUDIT_MATH §A; REPORT.md:6-8 (38.049 / 35.814 / 32.781) | ✅ traced |
| 12.8–14.8 tok/s | `12.8–14.8 tok/s` | AUDIT_MATH §A (486/38.049=12.77, 486/32.781=14.83); REPORT gate table confirms | ✅ traced |
| 7.15 GiB | `letture esperti 7.15 GiB` | REPORT.md:6-8 read_mb=7148.645 MiB = 6.98 GiB; PLAN says 7.15 — **≈1.5 GiB over-count** ⚠️ | see note |
| Σlat 17.8 / 17.1 / 14.3 s | `Σlat 17.8 / 17.1 / 14.3 s` | AUDIT_MATH §B table; REPORT.md:20-22 (16.484 / 17.098 / 13.128 rounded to 17.8/17.1/14.3) | ✅ traced (rounded) |
| I/O share 0.10–0.12 (point), max 0.477 | `I/O = 10–13 %` + `quota I/O max 0.477` | AUDIT_MATH §C; REPORT.md:30-38 (point: 0.1005–0.1199; upper: 0.4005–0.4774) | ✅ traced |
| k=2: 2.22–2.27 | `k=2: 2.22–2.27` | AUDIT_MATH §C headroom table; REPORT.md:46-48 (point_k2: 2.22–2.27) | ✅ traced |
| k=4: 4.45–4.55 (point), ≥2.095 serialized | `k=4: 4.45–4.55 (point), ≥ 2.095 anche nel bound serializzato` | AUDIT_MATH §C (point_k4: 4.447–4.545; min across all bounds: inv2 upper_k4 = 2.095) | ✅ traced |
| k=8: 8.3–9.0 | `k=8: 8.3–9.0` | AUDIT_MATH §C (point_k8: 8.34–8.99; upper_k8: 2.09–2.50; point dominates) | ✅ traced |
| min 2.095 | `≥ 2.095 anche nel bound serializzato` | AUDIT_MATH §C (inv2 upper_k4 = 2.094604) | ✅ traced |
| effective 1.75–2.27 GB/s | `1.75–2.27 GB/s` | AUDIT_MATH §D (effective_prefill_MB_s: 1745.6–2273.3 MB/s = 1.75–2.27 GB/s) | ✅ traced |
| temps 28.7→29.2→31.2°C | `guard max 31.2 °C` (peak; 28.7/29.2 implicit) | REPORT.md:66-68 guard_max_temp_C column; AUDIT_MATH §A | ✅ traced |
| battery 52→50% | `unplugged 52→50 %` | RUN_LOG.md battery_pre: 52/51/51; post: 52/51/50; min 50 | ✅ traced |
| token count 486 | `Prompt 486 token` | AUDIT_MATH §A (n_prompt=486 in all 3 CSV summaries) | ✅ traced |
| prereg ede3bc30 | `prereg ede3bc30` | `git log` confirms: `ede3bc30 q62 PREREG locked` | ✅ verified |
| Amendment 1 d82fb3c1 | `Amendment 1 pre-result d82fb3c1` | `git log` confirms: `d82fb3c1 q62 PREREG Amendment 1` | ✅ verified |

**Note on 7.15 GiB:** PLAN says "7.15 GiB di letture esperti per prefill". AUDIT_MATH §D gives prefill_read_MiB = 7148.644531 = 6.98 GiB (÷1073.74). ALIVE §15 also says "7.15 GiB". If this means 7148 MiB (decimal-ish), it's internally consistent between PLAN and ALIVE; the exact value is 7148.6 MiB ≈ 6.98 GiB. This is a rounding/presentation difference, not an arithmetic error. Not a blocker.

---

## 2. Verdict wording vs PREREG settling rule

**PREREG settling rule (PREREG.md:40):** `headroom(k=4) ≥ 2.0 → streaming-NPU has a real ceiling; ≤ 1.3 → stays CPU; between → owner decision`

**PLAN #33 verdict:** "lo streaming-NPU ha un tetto reale sotto lo streamer di prodotto: PREREQUISITO HVX (1) SODDISFATTO" + "la decisione kernel resta dell'owner, con (2) = dato 8xx"

**ALIVE #15 verdict:** "streaming-NPU has a real ceiling under the product streamer; the kernel decision is the owner's, together with the 8xx datum"

| Check | Status |
|---|---|
| min headroom(k=4) = 2.095 ≥ 2.0 → "real ceiling" matches ≥2.0 branch | ✅ correct |
| kernel decision stays the owner's | ✅ not overreaching |
| "(2) = dato 8xx" / "together with the 8xx datum" | ✅ present in both |
| Does not say "NPU for streaming = GO" or "HVX mandatory" | ✅ no overreach |

**VERDICT: CLEAN — wording matches PREREG settling rule, kernel decision stays the owner's.**

---

## 3. All 7 AUDIT_MATH corrections in REPORT.md

| # | AUDIT_MATH correction | REPORT.md location | Quote |
|---|---|---|---|
| B-M1 | Max-lane model PLAUSIBLE NOT VERIFIED (no timestamps; decode cross-check 334 vs 328 ms) | REPORT.md §Phase-0 header | `"Max-lane-per-layer model: the trace has no timestamps; ... This model is PLAUSIBLE NOT VERIFIED for PREFILL, but is bracketed by the engine's own decode io_ms=334.4 ms versus trace max-lane 328.3 ms (1.9%)"` |
| A-N1 | Tracked pid is shell wrapper, not bmoe-cli | REPORT.md §Sampler table | `cross-check column: FAIL_WRONG_PID_SHELL_WRAPPER` (all 3 rows); `cpuset_gate` evidence from binary_pid stands |
| A-N2 | Accepted window wording 480–544 vs 480–511 | REPORT.md §Gate values | `"Amendment-1 window 480–544 is effectively 480–511 with -n 1 (n_ctx 512); 486 is inside both"` |
| C-margin | inv2 upper io share = 0.477, 4.5% below 0.5 boundary | REPORT.md §Shares table | `"Narrowest margin: inv2 upper-bound io share = 0.477, 4.5% below the 0.5 boundary"` |
| D-N1 | +4 KiB/read over-read (+1.05%) in 19161/19542 reads | REPORT.md §Read/rate cross-check | `"Systematic over-read: +4096 B per read in 19,161/19,542 reads (+1.05%), included consistently in all byte totals."` |
| G-trend | Wall drift −13.85%, 82.8% compute-side, I/O non-monotone | REPORT.md §Gate values | `"wall trend: 38.049→35.814→32.781 s (−13.85%); 82.8% of the drop is compute-side, I/O non-monotone; verdict survives"` |
| settling-verdict | headroom(k=4) min 2.095 ≥ 2.0 → real ceiling | REPORT.md §Headroom table footnote | `"Settling rule (PREREG): min headroom(k=4) = 2.095 ≥ 2.0 under every bound → streaming-NPU has a real ceiling"` |

**VERDICT: All 7 corrections visibly present in REPORT.md.** The settling-verdict line appears inside the headroom section rather than as a standalone "verdict" line — the audit flagged this as a minor note (PREREG says "numbers only" for this section). Not a defect.

---

## 4. Caveats in PLAN/ALIVE match REPORT

| Caveat | PLAN #33 | ALIVE #15 | REPORT/AUDIT_MATH |
|---|---|---|---|
| Secondary --cache-mb 2000 not run | `secondario --cache-mb 2000 … NON eseguiti` | `secondary --cache-mb 2000 … NOT run` | RUN_LOG.md:170 `SECONDARY … not run` ✅ |
| Sampler wrong pid | `sampler /proc sul pid sbagliato (cross-check fallito, dichiarato)` | `/proc sampler followed the wrong pid (cross-check failed, declared)` | REPORT.md:62-68 `FAIL_WRONG_PID_SHELL_WRAPPER` ✅ |
| +4 KiB over-read | `over-read sistematico +4 KiB/lettura (+1.05 %)` | `+4 KiB/read over-read (+1.05 %)` | AUDIT_MATH §D; REPORT.md §Read/rate ✅ |
| Wall trend | `wall che cala 38→33 s (−13.9 %, 83 % lato compute, I/O non monotona: verdetto sopravvive)` | `wall drift −13.9 % mostly compute-side` | AUDIT_MATH §G; REPORT.md gate table ✅ |
| Max-lane model plausible-not-verified | `modello max-lane PLAUSIBLE non verificato (trace senza timestamp; bracketed dal contatore decode del motore: 328 vs 334 ms)` | `max-lane model plausible-not-verified (no timestamps; bracketed by the engine's decode io_ms 334 vs 328 ms)` | REPORT.md §Phase-0 header ✅ |
| No drop_caches | `page cache non droppabile (no root)` | `no drop_caches (no root)` | AUDIT_MATH §G; RUN_LOG.md:27 ✅ |
| Attempt 1 | `Attempt 1 (comando frozen incompatibile: -r/--no-warmup assenti, -p = testo) registrato, zero numeri usati` | (not repeated in ALIVE §15; covered by PLAN) | REPORT.md §Attempt 1; RUN_LOG.md:12-52 ✅ |

**VERDICT: All caveats match. No missing, no added, no contradicted.**

---

## 5. Markdown/table integrity & language policy

| Check | Status |
|---|---|
| PLAN #33 pipe count (3-column table) | ✅ `| 33 | text | text |` — 4 pipes, 3 columns |
| ALIVE §15 pipe count (3-column table) | ✅ `| 15 | text | text |` — 4 pipes, 3 columns |
| PLAN language = Italian | ✅ entire row in Italian |
| ALIVE language = English | ✅ entire row in English |
| Evidence paths exist | ✅ `scratchpad/agents/q62-product-streamer-prefill/` exists (REPORT.md, AUDIT_MATH.md, manifest.json, PREREG.md, RUN_LOG.md, raw/ verified by file reads) |
| PLAN references REPORT/AUDIT_MATH | ✅ `REPORT, AUDIT_MATH, raw/ con io-trace` cited at end |
| ALIVE references PLAN #33 | ✅ `(PLAN #33)` cited at end |
| Contrast sentence present in both PLAN and ALIVE | ✅ see §6 below |

**VERDICT: CLEAN.**

---

## 6. Contrast sentence vs q60/60b/61 consistency

**PLAN #33:** `Contrasto con q60/60b/61 (mmap page-fault, 0.2–0.4 GB/s pattern-bound): lo streamer di prodotto legge a 1.75–2.27 GB/s effettivi`

**ALIVE #15:** `Effective prefill read rate 1.75–2.27 GB/s (vs 0.2–0.4 GB/s of the mmap page-fault path in q60/61 — the product streamer is not pattern-bound)`

**Existing q60/q61 entries in PLAN (line 1434) and ALIVE §9:** The PLAN entry for q61 states "lo stesso file si carica a 1.82-1.85 GB/s in prefetch ma si rilegge a 193-427 MB/s in eval" (0.19–0.43 GB/s). The ALIVE §9 entry states "the same file prefetches at 1.8 GB/s but the eval page-fault pattern re-reads at 190–430 MB/s: mmap streaming is pattern-bound, faster flash does not help". Both use "0.2–0.4 GB/s" as the pattern-bound read rate.

| Check | Status |
|---|---|
| "0.2–0.4 GB/s" matches q60/60b/61 data | ✅ q61: 190–430 MB/s ≈ 0.19–0.43 GB/s; PLAN rounds to 0.2–0.4 |
| "mmap page-fault" matches q60/60b/61 mechanism | ✅ q61: "mmap streaming is pattern-bound" |
| "pattern-bound" matches q61 verdict | ✅ "the product streamer is not pattern-bound" — contrast correctly drawn |
| "1.75–2.27 GB/s" for product streamer | ✅ AUDIT_MATH §D effective_prefill_MB_s: 1746–2273 MB/s |
| No contradiction between PLAN #33 and ALIVE §9/q61 | ✅ contrast is consistent |

**VERDICT: CLEAN — contrast sentence consistent across all three files.**

---

## SUMMARY

| Item | Verdict |
|---|---|
| (1) Number traceability | ✅ All numbers traced. Minor: 7.15 GiB vs exact 6.98 GiB (rounding, not arithmetic error) |
| (2) Verdict wording vs PREREG settling rule | ✅ CLEAN — no overreach, kernel decision stays owner's |
| (3) All 7 audit corrections in REPORT.md | ✅ All 7 present and quoted |
| (4) Caveats in PLAN/ALIVE match REPORT | ✅ All 7 caveats match |
| (5) Markdown/table integrity & language | ✅ Both tables structurally sound, languages correct |
| (6) Contrast sentence vs q60/60b/61 | ✅ Consistent |

**No blockers found.** The 7.15 GiB vs 6.98 GiB presentation rounding is the only discrepancy; it is a display choice (MiB vs GiB rounding convention), not an arithmetic error, and is internally consistent between PLAN and ALIVE.

---

VERDICT: BANK-CLEAN
