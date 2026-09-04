# AUDIT-PRERUN — Cell #62 (hostile, read-only)

## 1. Cross-file tracer (PREREG ↔ driver)

**F1 — Knob-existence guard missing (BLOCKER)**
PREREG.md U2: `if the knob still exists; else METHOD-VOID by declaration`
PREREG.md U5: `same caveat`
d_run.sh:207: `run_arm up_ngl99_mbuf512 900 "$T -ngl 99" "GGML_HEXAGON_MBUF=512" 48`
d_run.sh:209: `run_arm up_ngl99_vmem1800 900 "$T -ngl 99" "GGML_HEXAGON_VMEM=1800" 48`
**PLAUSIBLE — BLOCKER.** Driver has no probe for whether upstream recognizes MBUF/VMEM. If unknown, U2/U5 run identical to U0 → false signal.

**F2 — `n_exec_any` not declared in PREREG (FIX)**
d_run.sh:153: `n_exec_any=$(grep "execute-op" "$err" 2>/dev/null | wc -l | tr -d ' ')`
d_run.sh:165: `printf 'SIGNATURE=%s expected_exps=%s n_exec_any=%s\n'`
**CONFIRMED — FIX.** .sig carries n_exec_any; PREREG never names it. Undeclared fallback.

**F3 — Arm order (NOTE)**
PREREG.md: U0, U2, U5, U1. d_run.sh:205-212: same. **REFUTED** — matches.

**F4 — Resume skips kit SHA check (NOTE)**
d_run.sh:62-68: resume guard checks model SHA + binary; kit SHA256SUMS at :87-93 is in else-branch only. **CONFIRMED — NOTE.** Same as #60.

**F5 — KIT_MISSING guard (NOTE)**
d_run.sh:41-44: `if [ ! -f "$KIT" ]; then log "KIT_MISSING"; exit 5; fi` **CONFIRMED.**

**F6 — BIN_MISSING guard (NOTE)**
d_run.sh:67-69: `log "BIN_MISSING"; exit 5` **CONFIRMED.** New vs #60.

**F7 — D=kalsa62 consistent (NOTE)**
PREREG.md: D=/data/local/tmp/kalsa62. d_run.sh:13: same. **CONFIRMED.**

**F8 — `.farf` path (NOTE)**
PREREG.md: 0x1F. d_run.sh:97: `printf '0x1F' > $D/lib-fix/llama-bench.farf`. **CONFIRMED.**

**F9 — KIT path (NOTE)**
PREREG.md: `~/kalsa-qdc/npu-v79-cell/npu-kit-62-upstream.tgz`. d_run.sh:9: same. **CONFIRMED.**

**F10 — MODEL_SHA (NOTE)**
PREREG.md: `361e8d83…`. d_run.sh:11: full sha matches. **CONFIRMED.**

**F11 — Conditional arms removed (NOTE)**
#60 had B1_OK + ABORT guards on B3/B4. #62 drops both: four unconditional arms. Correct for different hypothesis.

## 2. Grid

**F12 — H1-H4 exhaustive (NOTE)**
H1: all survive. H2: U0 dies, U2|U5 survives. H3: U0+U2+U5 die (mapping chain). H4: non-mapping signature. U1-dies = METHOD-VOID declared before grid. **CONFIRMED.**

**F13 — U1-dies over H4 (NOTE)**
PREREG.md: `U1 dies → METHOD-VOID for the whole cell`. H4 only for U0/U2/U5. Precedence clear. **CONFIRMED.**

**F14 — Survival counter fragility (FIX)**
d_run.sh:143-144: `n_exps_htp0=$(grep "HTP0 execute-op MUL_MAT_ID" | grep -E "ffn_gate_exps|ffn_up_exps|ffn_down_exps" | wc -l)`. If upstream renames → count 0 → false death. PREREG promises re-derivation in BUILD.md. BUILD.md absent. **CONFIRMED — FIX.**

## 3. PREREG promises vs deliverables

**F15 — BUILD.md absent (BLOCKER)**
PREREG.md: `every flag re-verified ... before lock (BUILD.md)`. No BUILD.md in directory. **CONFIRMED — BLOCKER.** Flag re-verification + counter re-derivation cannot occur.

**F16 — Lock fill items (NOTE)**
PREREG requires: kit sha (not yet built), MODEL_SHA.txt (matches), flag check (BUILD.md absent).

## 4. Ops

**F17 — Caps vs booking (NOTE)**
4 arms × 900 s = 3600 s worst. PREREG: 30-min booking, ~12 min expected. Caps are kill switches, not expected durations. **PLAUSIBLE — NOTE.**

**F18 — Session rules (NOTE)**
PREREG: `One session; End Session = ref-click End + Yes + reload`. Driver:215: `Remember: End Session`. **CONFIRMED.**

## 5. Reuse

**F19 — Clean simplification of #60 (NOTE)**
Removed: B1_OK, conditional B3/B4, ngl12/ngl8_tg128/ngl99_vmem0. Added: KIT_MISSING, BIN_MISSING, kit_listing, n_exec_any. No stale #60 references.

---

## Delta audit (lock addenda)

**F1 — ACCEPT.** ggml-hexagon.cpp:6335-6336 confirms `getenv("GGML_HEXAGON_VMEM")` and `getenv("GGML_HEXAGON_MBUF")` in this tree. Runtime knob probe without a device is impossible; pre-declared post-hoc evidence (MBUF: buffer sizes ≤ 512 MiB in `-v` output; VMEM: DSP fd_mmap_destroy churn in adsprpc log) is the only viable method. Both criteria are binary, machine-checkable, and declared before the session.

**F2 — ACCEPT.** Lock addendum 2 declares: n_exec_any > 0 + n_exps_htp0 = 0 + exit 0 → "proof format changed"; both zero + exit 0 → METHOD-VOID. Decision rule complete.

**F14 — ACCEPT.** BUILD.md lists all 11 template T flags with source-line hits. Counter patterns unchanged in upstream per source-line check.

**F15 — ACCEPT.** BUILD.md exists: recipe + exit codes, llama-bench flag table, mmap_buf objdump (2-try HAP_mmap loop + defrag path, strings at L960-961), kit sha 1baee516…, ancs = #26501 and #28202 ancestors of HEAD.

**DD (defrag signature) — CONFIRMED.** DISASM-upstream.txt: `0x468c abort@plt` r2=#0x3c0 (960) = `prep-bufs : mmap failed after defragmentation` → abort L961. PREREG lock addendum correctly names this as H3 death signature replacing #60's :729. 2-try HAP_mmap loop at 0x47b0/0x47c0 confirmed.

**MODEL_SHA.txt — CONFIRMED.** kit_sha256=1baee516…, model_sha256=361e8d83…, locked=2026-09-04 08:33. Matches driver and PREREG.

---

## Verdict: **RUN**

All BLOCKERs and FIXs resolved by lock addenda. F1 post-hoc verification acceptable (see above). Kit sha, MODEL_SHA.txt, flag check, defrag signature, n_exec_any decision rule all verified.
