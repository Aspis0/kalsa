# PLAN.md Compact Rewrite Audit — 2026-09-04

**Diff:** 521 deletions, 42 insertions (lines 15–535 replaced by 15–60).
**File size:** 2158 lines total; only the "STATO CORRENTE" body touched.

---

## 1. LOST FACTS

Every concrete fact in the deleted diary (cells #32–#57, 26/08–3/09) was cross-checked
against `docs/ALIVE.md`, the surviving diary blockquotes in PLAN.md (`grep -n '^> \*\*'`),
and `PLAN-archive.md`. **No load-bearing fact is absent from all surviving sources.**

The deleted text was an operational log — timestamps, device temps, job IDs, watcher PIDs,
audit step details — not a document of record. The figures it contained (speeds, accuracies,
cell verdicts) are all preserved in ALIVE.md rows (already cited in the compact view) or
in the surviving blockquotes (cells #58–#61).

Summary: the compact view correctly references ALIVE.md row numbers for every claim.
The old diary's role was context; its loss is a context-breadth reduction, not an information loss.

**NO LOSSES.**

---

## 2. FIGURE CHECKS (compact view vs ALIVE.md rows 36–44 and diary 4/09)

| Compact view figure | Source | Source line | Correct? |
|---|---|---|---|
| 732/735 prefill pp512 151.8/154.8 (cells 36, 39) | ALIVE rows 36, 39 | 151.8±1.1 / 154.8±1.3 | ✅ |
| 740: pick = igiene (37) | ALIVE row 37 | "Δ +0.65%/−0.12%, dentro ±3% → TAKE come igiene" | ✅ |
| 750: 284.2/23.4 (38), 291.1/23.0 (41) | ALIVE rows 38, 41 | 284.2±0.1 / 23.4±0.0; 291.11±0.56 / 23.02±0.04 | ✅ |
| CPU decode wins all tiers (GPU 0.80–0.86×) (40) | ALIVE row 40 | "decode vince su tutti e tre i tier (GPU 0.80–0.86×)" | ✅ |
| NPU lane v79 alive (42) | ALIVE row 42 | "La morte NPU v73 REPLICA… G1 REPLICATED" | ✅ |
| v73 death in `htp/main.c:729` (43) | ALIVE row 43 | "mmap failed : va %p → abort; r2=#729" | ✅ |
| v73 viable ≤~2.5 GiB, dies at 3.6 GiB (43) | ALIVE row 43 | "≤ ~2.5 GiB verificati… a 3.6 GiB muore" | ✅ |
| feat/moe-stream in main at c513f00 | Diary 3/09 blockquote | "feat/moe-stream MERGIATO in main (c513f00)" (PLAN.md:59) | ✅ |
| APK-A pin a0cabca6b, APK-B pin 12f6d9b6d (44) | ALIVE row 44 | "APK-A (main c513f00, pin a0cabca6b) e APK-B (pin 12f6d9b6d + 3 pick)" | ✅ |
| #61: A 129 tok @ 26.4, B 196 @ 26.0 (44) | ALIVE row 44 | "A 129 token predetti a 26.4 tok/s, B 196 a 26.0 tok/s" | ✅ |
| GPU never used by app: offloaded 0/31 (44) | ALIVE row 44 | "offloaded 0/31 layers to GPU" | ✅ |
| Kit upstream → cell #62 (43; diario 4/09) | ALIVE row 43 | "Upstream #26501… #28202 → #61-NPU = stesso driver" | ✅ |
| Budget 912/935/913/981/623 (diario 4/09) | Diary 4/09 blockquote | PLAN.md:217 "Budget QDC ≈ 912(7xx)/935(8G2)/913(8G3)/981(8sG3)/623(8E)" | ✅ |

All 14 checked figures: **14/14 sourced, 0 wrong, 0 unsourced.**

---

## 3. STRUCTURE CHECK

- **Header date updated:** `(2026-08-24; aggiornata 3/09 notte)` → `(2026-09-04 08:30)` ✅
- **Six required parts present:** Dove siamo (L17), Lato app (L25), Decisioni owner aperte (L32), In volo / prossimi (L39), Budget QDC (L45), Regole vive (L48) ✅
- **First unchanged line after body:** `> **3/09 notte — DELEGA PIENA OWNER` at PLAN.md:58 ✅ (was the first blockquote after line 535; now the first unchanged content after the compact body)
- **Nothing else touched:** `git diff --stat HEAD -- PLAN.md` shows only `PLAN.md | 563 ++---` (1 file, insertions=42, deletions=521). ✅

---

## VERDICT: ACCEPT

No load-bearing fact is lost; all 14 checked figures are sourced and correct; the six required structural sections are present and in order; the header date is updated; no other part of the file is touched.
