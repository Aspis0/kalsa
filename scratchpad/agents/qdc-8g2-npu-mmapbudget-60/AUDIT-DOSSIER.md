# AUDIT-DOSSIER.md — Cell #60 dossier diff (upstream-v73-hexagon-report.md)

Date: 2026-09-04. Scope: new material in diff only (root cause section, Summary sentence, Cell #60 "does not bear" sentences, What-this-report-is-not-claiming addition).

## Finding index

| # | File:line quoted | Line in dossier | Verdict | Sev |
|---|---|---|---|---|
| 1 | `ggml-hexagon.cpp:1546` | `int err = dspqueue_read(...)` | REFUTED (actual: line 1548, off by 2) | FIX |
| 2 | `ggml-hexagon.cpp:1552` | `GGML_ABORT("ggml-hex: dspqueue_read failed: ...")` | CONFIRMED | — |
| 3 | `main.c:711` | `static inline void mmap_buf(...)` | CONFIRMED | — |
| 4 | `main.c:718-720` | `#if __HVX_ARCH__ > 73` / HAP_mmap2 / `#else` | CONFIRMED | — |
| 5 | `main.c:726` | `void *va = HAP_mmap(...)` | CONFIRMED | — |
| 6 | `main.c:729` | `FARF(ERROR, "mmap failed : va %p fd %u size %u"...)` | CONFIRMED | — |
| 7 | `main.c:730` | `abort(); // can't do much else` | CONFIRMED | — |
| 8 | `main.c:743,765,769,776` | `prep_op_bufs` / vmem check / drop / mmap_buf | CONFIRMED | — |
| 9 | `ggml-hexagon.cpp:4373` | `opt_vmem = ... 3000 * MiB` | CONFIRMED | — |
| 10 | `ggml-hexagon.cpp:1608-1634` | `measure_max_vmem` / alloc loop / cleanup / return | CONFIRMED | — |
| 11 | B5 raw lines 291-297 | `qurt_vtlb_mmap` / `fastrpc_mmap` / `HAP_mmap2 failed` / `mmap failed : va FFFFFFFF` | CONFIRMED (all verbatim) | — |
| 12 | #59 crash block (lines 550-565) | `qurt_exit()` / `abort+0x8` / `htp_iface_start+0x1348` | CONFIRMED (verbatim; note: raw also has `Bad VA: 0x0` at line 556, omitted from dossier excerpt) | NOTE |
| 13 | #59 raw A1 proof | `n_htp=484 n_mul_mat_id=48 n_exps_htp0=48 exit=134` | CONFIRMED | — |
| 14 | #59 raw A2 proof | Same as A1 | CONFIRMED | — |
| 15 | B6 err: `measured max vmem 3221225472` | Line 33 of `.err` | CONFIRMED | — |
| 16 | B6 err: `buffer mapping failed ... error 0x00000001` | Lines 24 and 850 of `.err` | CONFIRMED | — |
| 17 | Section title "Signature 1 root cause" | New h2 before Cross-cutting | REFUTED-by-my-reading (see finding 18) | BLOCKER |
| 18 | Structural: #59 DSP crash ≠ S23 Sig 1 crash | S23 Sig 1: `TLBMISS RW / op_binary+0x5B9C / htp-main`; #59: `qurt_exit() / abort / htp_iface_start+0x1348 / thread ""`. Host error 0x2e is identical; DSP mechanism differs. Section title implies it explains S23's op_binary root cause but shows a different mmap_buf mechanism on different hardware. | REFUTED-by-my-reading | BLOCKER |
| 19 | Minimal reproduction command | Missing `--mmap 0` (PREREG template T includes it; #59 used it) | REFUTED-by-my-reading | FIX |
| 20 | Expected output block | Omits `Error 0x8000054d: HAP_mmap2 failed...` line present in B5 raw (line 296) between fastrpc_mmap and mmap failed | PLAUSIBLE (fd/size caveat covers variability, but the HAP_mmap2 line is a structural part of the chain, not an fd/size variant) | FIX |
| 21 | "Relation to upstream" | "All claims... as reported by web search on 2026-09-04, not re-verified" | CONFIRMED | — |
| 22 | "no issue has been filed" | In "Suggested upstream action" | CONFIRMED | — |
| 23 | "This remains a local draft" | In "Suggested upstream action" | CONFIRMED | — |
| 24 | "does not discriminate among (1) fragmentation... (2) TLB/alignment... (3) VA not reclaimed" | Paragraph before six-arm table | CONFIRMED (correctly lists alternatives, does NOT claim fragmentation as fact) | — |
| 25 | "excludes ... a hard 2 GiB PD cap on this HDK" | Same paragraph | PLAUSIBLE (B3 2475 MiB + B6 3.00 GiB support it; tension with fastrpc #137 "2GB on older devices" not mentioned in this text) | NOTE |
| 26 | Cell #60 "does not bear on" Sig 2 | One-sentence addition after Sig 2 Minimal reproduction | CONFIRMED (correct: #60 used OLMoE mapping-budget, not F2b) | — |
| 27 | Cell #60 "does not bear on" Sig 3 | One-sentence addition after Sig 3 Minimal reproduction | CONFIRMED (correct: #60 used OLMoE, not trunk-only PPL) | — |
| 28 | "What this report is not claiming" addition | Cell #60 does not identify fragmentation as unique cause; partial-offload not a performance/correctness claim | CONFIRMED | — |
| 29 | "measurement should be non-destructive" | In the prep_op_bufs paragraph | PLAUSIBLE (correct hedging for a suggestion; the REPORT.md is more prescriptive) | — |
| 30 | `ggml-hexagon.cpp:1546-1552` in "Suggested upstream action" | Range for dspqueue_read fallback suggestion | REFUTED (should be 1548-1552) | FIX |
| 31 | Structure of new section | No Trigger / Ruled out / Minimal reproduction pattern | PLAUSIBLE (narrative fits the root-cause identification purpose; minor structural inconsistency with rest of dossier) | NOTE |
| 32 | `ggml-hexagon.cpp:1624` in Sig 3 minimal reproduction | Pre-existing text; actual GGML_ABORT for dspqueue_write is at line 1590 | REFUTED (off by 34 lines) | FIX |

## Summary

**BLOCKERs (2):**
- **#18**: Section "Signature 1 root cause" shows #59's DSP crash is `qurt_exit() / abort / htp_iface_start+0x1348` (mmap_buf at main.c:729), while S23's Signature 1 was `TLBMISS RW / op_binary+0x5B9C`. These are different crash mechanisms producing the same host 0x2e. The section title and narrative do not reconcile the two mechanisms; an upstream maintainer will immediately ask "is this the same bug or a different one?"
- **#17/#18 (same root)**: The section implicitly attributes #59's `qurt_exit()` to mmap_buf's `abort()` via the objdump chain, which is valid. But it does not explain why S23 had `op_binary` TLBMISS while HDK had `mmap_buf` abort, or whether these are two independent v73 failure modes that both manifest as 0x2e.

**FIXes (4):**
- **#1**: `ggml-hexagon.cpp:1546` → should be `:1548` (dspqueue_read is at line 1548, not 1546).
- **#19**: Minimal public reproduction command is missing `--mmap 0` (PREREG template T includes it; #59 used it).
- **#20**: Expected output block omits the `HAP_mmap2 failed` FARF line that appears between `fastrpc_mmap` and `mmap failed` in B5 raw.
- **#32**: Pre-existing `ggml-hexagon.cpp:1624` for Signature 3's dspqueue_write should be `:1590` (GGML_ABORT) or `:1588` (dspqueue_write call).

**NOTEs (4):**
- **#12**: #59 crash block excerpt omits `Bad VA: 0x0` (raw line 556), which is present in the full crash and is the same VA as S23's Sig 1. Consider including it for completeness.
- **#25**: The "hard 2 GiB PD cap" exclusion does not mention tension with fastrpc #137's "2GB on older devices" comment (8 Gen 2 may qualify as "older").
- **#29**: "measurement should be non-destructive" is correctly hedged for a suggestion.
- **#31**: Narrative format deviates from Trigger/Ruled out/Minimal reproduction pattern used elsewhere.

## Delta audit (post-fix, 2026-09-04)

Scope: re-audit of the updated diff (330 lines) against the six items from the first audit.

| # | Item | Check | Verdict |
|---|---|---|---|
| B1 | Reconciliation of S23 TLBMISS vs HDK abort | New section "Same host symptom, two DSP-side manifestations" present; hedges: "not established" (×3), "UNPROVEN" (×1). 3f545bec lines quoted: :837 `for (uint32_t i=0; i < HTP_MAX_MMAPS; i++) {`, :848 `void *va = HAP_mmap(...)`, :850 `if (va == (void*)-1) {`, :851-852 `FARF(ERROR,...) / abort()`, :860-863 `return;` + braces — all verified against `git show 3f545bec:...main.c \| sed -n 833,860p`. Summary and What-this-report-is-not-claiming updated identically. | CONFIRMED |
| B2 | Line numbers now 1545/1551 (+1552 explained) | Dossier: `:1545`: `int err = dspqueue_read(...)`; `:1551`: `GGML_ABORT(...)`. Source (offset 1540): line 1545 = `int err = dspqueue_read(...)`, line 1551 = `GGML_ABORT(...)`. Suggested upstream: `1545`/`:1551`; runtime prints `:1552`. Sig 3: `:1588` `dspqueue_write`, `:1590` `GGML_ABORT` — both match grep. | CONFIRMED |
| F3 | `--mmap 0` in repro command | Command: `...--mmap 0 -fa on --ubatch-size 1024 -ngl 99`. PREREG T: `...--mmap 0 -fa on --ubatch-size 1024`. Command = T + `-ngl 99`. | CONFIRMED |
| F4 | Four CDSP0 lines in expected output | Lines present: `qurt_vtlb_mmap...29a01000` (raw :291), `fastrpc_mmap failed...` (:292), `HAP_mmap2 failed...` (:296), `mmap failed : va FFFFFFFF...` (:297). All verbatim. `htp_iface_start+0x1348` from #59 raw. | CONFIRMED |
| F5 | Old `1624` reference gone | `grep -c 1624 docs/upstream-v73-hexagon-report.md` = 0. Replaced by `:1590` in text block and `:1588`/`:1590` in Sig 3 step 4. | CONFIRMED |
| F6 | No new over-claim | "not established" ×3, "UNPROVEN" ×1, "plausible but" ×1 in new text. No unqualified causal claims. | CONFIRMED |

All six items resolved. No residual BLOCKERs or FIXes from the first audit.

## Delta audit 3 (cell #62 addition, 2026-09-04)

Scope: 50 new lines (subsection "Signature 1 reproduced with pure upstream master", recipe B, Summary/Relation additions). diff --stat confirms only 1 file changed.

| # | Claim | Source line | Verdict |
|---|---|---|---|
| 1 | Fault PC `0x20242B34`, Bad VA `0x0`, Error code `0x7003` | logcat_up_ngl8 lines 188/191/194 | CONFIRMED |
| 2 | `op_binary+0x50E4` | logcat_up_ngl8 line 196 | CONFIRMED |
| 3 | Disasm: `42b0c: …if (!p0.new) jump:t 0x42bb8 <binary_job_vector_same_shape+0xa78>`, `42b2c: loop0(0x42b34,r13)`, `42b34: v20 = vmem(r9++#0x1)`, `42b38: v22.qf32 = vadd(v20.sf,v21.sf)` | crash_pc_resolution.txt | CONFIRMED (verbatim) |
| 4 | U0/U2/U5/U1 proof 33/32/34/14 exit 134 | .out files | CONFIRMED |
| 5 | commit `64a155d24` | MODEL_SHA.txt:4 | CONFIRMED |
| 6 | model sha `361e8d83…` | MODEL_SHA.txt:6 | CONFIRMED |
| 7 | host abort `ggml-hexagon.cpp:2734` | up_ngl8_sa803054.err:8881 | CONFIRMED |
| 8 | Two ADD lines (node_928/view, ffn_moe_out-15) | up_ngl8_sa803054.err:8872,8874 | CONFIRMED (verbatim) |
| 9 | Zero `mmap failed`/`defragmentation` in all 4 logcats | grep = 0 across all 4 | CONFIRMED |
| 10 | Async-queue caveat | "The queue is asynchronous, so these lines do not prove which operation faulted" | PRESENT |
| 11 | "separating change not established" / "unestablished" | Summary + body (×3) | PRESENT |
| 12 | Recipe B: `--mmap 0`, board, build, model, command, expected | All present; command = T + `-ngl 8`/`-ngl 99` | CONFIRMED |
| 13 | No over-claim vs #26501 | "candidate explanations … none was bisected" | CONFIRMED |
| 14 | No other file changed | diff --stat: 1 file, +50/-3 | CONFIRMED |

No BLOCKERs, no FIXes.
