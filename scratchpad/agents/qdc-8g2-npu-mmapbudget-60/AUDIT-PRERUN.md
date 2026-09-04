# AUDIT-PRERUN — Cell #60

Date: pre-run, 0 QDC minutes spent. Files read: DISASM.md, PREREG.md, d_run.sh
(#60 and #59 base), REPORT.md (#59), source (main.c, ggml-hexagon.cpp,
htp-ctx.h, htp-ops.h), evidence (logcat, .err).

## 1. DISASM.md logic chain

| # | Claim | Source line / quote | Verdict | Sev |
|---|-------|---------------------|---------|-----|
| D1 | `htp_iface_start+0x1348` → 0x3E58 = return of `call abort@plt` at 0x3E54 | `hexagon-llvm-objdump` output quoted in DISASM.md; function base 0x2b10 + 0x1348 = 0x3E58 | CONFIRMED | — |
| D2 | `r2=#0x2d9` = 729 = `__LINE__` | `0x2d9` = 729 decimal; source main.c:729 `FARF(ERROR, "mmap failed : va %p fd %u size %u"…)` | CONFIRMED | — |
| D3 | Abort site is `mmap_buf()`:HAP_mmap returning -1 | main.c:726 `void *va = HAP_mmap(…)` → :729 `FARF(ERROR…)` → :730 `abort()` | CONFIRMED | — |
| D4 | "host 0x2e is the SYMPTOM of the PD crash" | logcat:544 `notif_callback…status 3` (tid 18224) THEN :545 `dspsignal_wait…error 0x2e` (tid 18218) THEN :550 `crashed…qurt_exit()` THEN .err:11103 `dspqueue_read failed: 0x2e` — callback BEFORE error | CONFIRMED | — |
| D5 | Six `abort@plt` calls in block with line constants 0x2d9/0x2d2/0x124 | main.c:729 (mmap_buf -1), :722 (mmap_buf >2GB), :293 (vtcm_acquire) — 0x124=292 is FARF at :292, abort at :293 | PLAUSIBLE (off-by-one on vtcm line; see D6) | NOTE |
| D6 | Binary line constant 0x2d9=729 for mmap_buf abort | source mmap_buf FARF is :729, abort() is :730; binary :729 maps to FARF not abort. Same pattern at vtcm_acquire (:292 FARF, :293 abort). Source likely shifted +1 since build. | CONFIRMED (binding correct, exact line off by 1) | NOTE |

**DISASM.md summary**: chain holds. Logcat ordering supports "host 0x2e = symptom, not cause". No unsupported assertions found.

## 2. PREREG grid

| # | Claim | Evidence | Verdict | Sev |
|---|-------|----------|---------|-----|
| P1 | `GGML_HEXAGON_MBUF=512` = 512 MiB per buffer | ggml-hexagon.cpp:4394 `opt_mbuf = strtoul(str_mbuf,…) * MiB`; MiB = 1024² | CONFIRMED | — |
| P2 | B2 expected ~13 mappings, under 16 slots | 8 mapped buffers from #59 .err total 3.7 GiB; at MBUF=512 the three ~1 GiB expert bufs each split ×2 = 6; plus op-queue(1) + small buf(1) + attn/embed/logits(3-5) = **16-18 slots** | **REFUTED** — "~13" is an underestimate; 16 slots likely exceeded | **BLOCKER** |
| P3 | B1 ~1.8 GiB = 8 layers × ~225 MiB expert bufs | 8 layers × 3 expert tensors × ~75 MiB = ~1.8 GiB; fits in 2 × ~1 GiB mappings (default MBUF). Grid's "buffers still ~1 GiB" is correct. | CONFIRMED | — |
| P4 | Proof counts: 24/36/48 = 3 × offloaded layers | .err: 48 MUL_MAT_ID execute-ops for ngl=99; 16 layers × 3 (gate/up/down). Attention = MUL_MAT (not ID). Output/trunk = no ffn_*_exps. grep in d_run.sh correctly isolates ffn_*_exps. | CONFIRMED | — |
| P5 | B2 METHOD-VOID if >16 slots (PREREG "Declared confounds") | PREREG: "if it exceeds 16 (HTP_MAX_MMAPS) the arm is METHOD-VOID (slot overflow, a different failure)". Grid rows G1-G5 do NOT cover METHOD-VOID B2 explicitly. | PLAUSIBLE (acknowledged but grid gap) | FIX |
| P6 | B3 runs "regardless of B1/B2 outcome unless gate/launch abort" | Driver: `if [ "$ABORT" -eq 0 ]` gates B3; ABORT=1 on ANY arm rc=7|8 including :729 death. B3 will NOT run after a B1/B2 hard death. | **REFUTED** — driver is stricter than PREREG | **FIX** |

## 3. Driver ↔ PREREG cross-check

| # | Item | Lines / quote | Verdict | Sev |
|---|------|---------------|---------|-----|
| X1 | B2 ENV applied inside nohup | d_run.sh: `env_prefix="unset GGML_HEXAGON_HOSTBUF; GGML_HEXAGON_MBUF=512"` → composed into `nohup sh -c 'cd $D; $env_prefix LD_LIBRARY_PATH=… $3 > …'` — ENV is a shell assignment inside the sh -c, visible to llama-bench | CONFIRMED | — |
| X2 | B3 ENV (empty string) | `env_prefix="unset GGML_HEXAGON_HOSTBUF; "` — HOSTBUF unset, no MBUF override | CONFIRMED | — |
| X3 | .farf creation after kit extraction, resume-safe | d_run.sh:66 `printf '0x1F' > $D/lib-fix/llama-bench.farf` — AFTER kit push+extract (or resume guard); adbT failure is non-fatal (`log "FARF_CREATE_FAIL — continuing"`) | CONFIRMED | — |
| X4 | Arm names match PREREG | PREREG: B1=ngl8_mbuf1g, B2=ngl99_mbuf512, B3=ngl12_mbuf1g, B4=ngl8_tg128. d_run.sh: exact match. | CONFIRMED | — |
| X5 | B4 gating: only if B1 exit 0 | d_run.sh: `if [ "$B1_OK" -eq 1 ] && [ "$ABORT" -eq 0 ]` — B1_OK set only on rc=0. | CONFIRMED | — |
| X6 | Template matches PREREG | PREREG T = `./bin/llama-bench -m olmoe.gguf -p 16 -n 8 -r 1 --no-warmup -dev HTP0 -v -o jsonl --mmap 0 -fa on --ubatch-size 1024`. d_run.sh T: exact match. | CONFIRMED | — |

## 4. Removed-behaviour audit (vs #59 d_run.sh)

| #59 feature | Present in #60? | Notes |
|-------------|-----------------|-------|
| Tombstone before/after + diff pull | ✅ | Identical code |
| Thermal gate (gate_or_abort, 3 retries) | ✅ | Identical |
| pkill bracket (timeout kill) | ✅ | Identical |
| adbT perl-alarm caps | ✅ | Identical |
| Resume guard (sha + BINOK) | ✅ | Identical |
| End Session reminder | ✅ | log at bottom |
| logcat -c before arm | ✅ | Identical |
| HOSTBUF hostbuf/nohost logic | ❌ removed | Correct — #60 doesn't test HOSTBUF; env_prefix always unsets it |
| A2/A4 arm names | ❌ removed | Correct — replaced by B1-B4 grid |

No unintentional removals found.

## 5. Reuse/simplify

| # | Finding | Verdict | Sev |
|---|---------|---------|-----|
| R1 | run_arm $4 (env arg) is now always "unset HOSTBUF; $passed_env" — the `hostbuf`/`nohost` conditional from #59 is dead code replaced by a simpler prefix | Correct simplification | — |
| R2 | Driver has `-n 1` fallback logic (case `"* -n 0 *"`) — none of B1-B4 use `-n 0`, so this is dead code | Harmless, could be removed for clarity | NOTE |

## Overall findings summary

| Sev | Count | Items |
|-----|-------|-------|
| BLOCKER | 1 | P2: B2 mapping count ~13 is wrong (likely 16-18); grid doesn't cover METHOD-VOID B2 outcome |
| FIX | 2 | P5: grid lacks METHOD-VOID row for B2; P6: driver B3 gating contradicts PREREG ("regardless of B1/B2") |
| NOTE | 3 | D5/D6: off-by-one line constants; R2: dead -n 1 fallback code |

---

## Delta audit (amendment 1)

### P2 refutation — ACCEPT
PREREG "Audit response" arithmetic: 48 expert tensors × 75497472 B = 3600 MiB. At MBUF=512 MiB → 7 buffers (7 × 72 MiB = 504 MiB each, 7 fit per buffer). + 4 non-expert (fd 19/21/22/27 from evidence: 12.3 + 33.6 + 8.9 + 1.9 MiB) = **11 mappings ≤ 16**. My own count of the 8 `mapped buffer` lines confirms: fd 23-26 = 3600.02 MiB expert REPACK; fd 19/21/22/27 = 56.7 MiB non-expert. 7+4=11. Revised PREREG estimate "≈11" is correct; my original BLOCKER was wrong.

### P6 refutation — ACCEPT
d_run.sh: `return 9` (line after `[ "$e" = "0" ] && return 0`) is the arm-death return. `case $rc in 7|8)` only catches gate/launch aborts (rc 7) and clean failures (rc 8). rc=9 (device death) does NOT set ABORT=1. B3 runs after B1/B2 deaths at :729 exactly as PREREG states. My original FIX was wrong.

### B5/B6 source verification
- **(a) opt_vmem default + env override**: ggml-hexagon.cpp:4373 `opt_vmem = opt_arch >= 75 ? HTP_OP_MAX_VMEM_DEFAULT : 3000 * MiB;` (3000 MiB for v73). Line 4395 `opt_vmem = str_vmem ? strtoul(str_vmem, NULL, 0) * MiB : opt_vmem;` — env wins after default. CONFIRMED.
- **(b) VMEM=0 triggers measurement**: ggml-hexagon.cpp:1812 `if (!opt_vmem) { opt_vmem = ggml_hexagon_measure_max_vmem(this); }`. `strtoul("0")*MiB = 0`. CONFIRMED.
- **(c) Skel eviction**: main.c:762 `if ((m_vmem + e_vmem) > ctx->max_vmem)` drops unused mappings, then :776 `mmap_buf(ctx, b)` for each missing buffer. H1' chain: host says 3000 MiB → skel never evicts (≤3000) → HAP_mmap fails past real ~2 GiB PD budget → abort :729. CONFIRMED. No hole: host opbatch b_vmem_max (line 1282 `if ((extra_vmem + b_vmem) > b_vmem_max) return false;`) splits batches at 1800 MiB, so skel never receives >1800 MiB of buffer data per batch.

### B5/B6 driver verification
- B5: `run_arm ngl99_vmem1800 900 "$T -ngl 99" "GGML_HEXAGON_VMEM=1800" 48` — ENV applied, cap 900s, expected 48, after B2. CONFIRMED.
- B6: `run_arm ngl99_vmem0 900 "$T -ngl 99" "GGML_HEXAGON_VMEM=0" 48` — ENV applied, cap 900s, expected 48 (informative; B6 outcome is not a grid input). CONFIRMED.
- Order B1→B2→B5→B6→B3→B4 matches amendment. No contradiction with original grid.

---

**OVERALL VERDICT: RUN**

P2 and P6 both ACCEPTED — original BLOCKER and FIX withdrawn. B5/B6 arms verified against source and driver. Grid amended with G1a/G1b sub-rows and G6 (B2 METHOD-VOID). No remaining BLOCKERs or FIXes.
