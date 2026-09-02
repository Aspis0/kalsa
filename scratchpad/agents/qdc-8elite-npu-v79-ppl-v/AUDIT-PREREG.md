# Hostile Audit: PREREG cell #47 (qdc-8elite-npu-v79-ppl-v)

**Target:** `PREREG.md` + `d_run.sh` in this directory.
**Delta over:** `../qdc-8elite-npu-v79-judge/PREREG.md` (rev-3).
**Context:** `FINDINGS-reviewer.md` §6, raw logs, q55 PREREG, #44 REPORT.

---

## Angle 1: CPU PPL reuse — is "deterministic" claim safe?

**Prereg claim** (PREREG.md:22-24): "CPU PPL is deterministic for identical binary (same kit sha), model (same sha), corpus (same sha), flags and thread count (`-t 8`), on the same device class."

**Evidence:**
- Kit sha: `93e9592fa` — same binary for both #46 and #47. CONFIRMED (`npu-kit-93e9592fa.tgz`, SHA256SUMS verified).
- Model sha: ship `a247afd6…`, OLMoE `9d0b90c6…` — same GGUFs. CONFIRMED.
- Corpus sha: `173c87a5…` — same wiki.test.raw. CONFIRMED.
- Flags: `-c 2048 -b 2048 -ub 1024 -fa on --chunks 32 -t 8` — identical. CONFIRMED.
- Device class: same QRD8750, same `ro.serialno`. CONFIRMED (prereg binding).

**Nondeterminism sources:**
- **f32 accumulation order with `-t 8`:** Thread scheduling can vary between runs. However, `ggml` uses threadpool barriers between graph nodes; for identical graphs on identical hardware with the same thread count, the accumulation order is the same across runs. The `-fa on` path is deterministic for fixed input shapes (2048 fixed context). **PLAUSIBLE — same-device f32 PPL is reproducible to ≥4 digits.**
- **`-v` flag difference:** #47 adds `-v` to the HTP arm but NOT to the (reused) CPU arm. `-v` only affects logging, not computation (verified: `tools/perplexity/perplexity.cpp` has no conditional on `params.verbosity` in the compute path; `common/log.cpp:454-458` only filters log output). **No effect on PPL. CONFIRMED.**
- **lfm2 shortconv hybrid path:** Ship model is LFM2.5-2.6B. The shortconv layers may use a different code path. But with the same binary and same `-ngl 0`, the CPU dispatch is identical. **No issue.**

**Verdict:** Reuse is safe for this cell's precision requirement (4 digits). The prereg's justification is adequate.

**PLAUSIBLE, no fix.**

---

## Angle 2: Does `-v` make execute-op lines appear?

This is the core question. Two-layer gating:

### Layer 1: Hexagon backend generates the line

`ggml-hexagon.cpp:107-110`:
```cpp
static void ggml_hexagon_dump_op_exec(...) {
    if (!opt_verbose) return;
    GGML_LOG_DEBUG("ggml-hex: %s execute-op %s|...", ...);
}
```

`opt_verbose` is set from `GGML_HEXAGON_VERBOSE` env var at `ggml-hexagon.cpp:4377`:
```cpp
opt_verbose = str_verbose ? atoi(str_verbose) : 0;
```

The driver sets `GGML_HEXAGON_VERBOSE=1` in the subshell (`d_run.sh:82`):
```sh
CMD="export GGML_HEXAGON_VERBOSE=1 && ./bin/llama-perplexity ..."
```

**Layer 1 satisfied: `opt_verbose=1`, line is generated as `GGML_LOG_DEBUG`. CONFIRMED.**

### Layer 2: llama-perplexity's log filter passes DEBUG through

`GGML_LOG_DEBUG` maps to `GGML_LOG_LEVEL_DEBUG` (`ggml/include/ggml.h:638`).

llama's log callback (`common/log.cpp:454-458`):
```cpp
void common_log_default_callback(enum ggml_log_level level, const char * text, void *) {
    auto verbosity = common_get_verbosity(level);
    if (verbosity <= common_log_verbosity_thold) {
        common_log_add(common_log_main(), level, "%s", text);
    }
}
```

For `GGML_LOG_LEVEL_DEBUG`: `common_get_verbosity` returns `LOG_LEVEL_DEBUG = 5` (`common/log.h:24`).

Default threshold: `LOG_DEFAULT_LLAMA = LOG_LEVEL_INFO = 3` (`common/log.h:32`). `5 <= 3` is **FALSE** → DEBUG messages **SUPPRESSED** without `-v`.

`-v` sets threshold to `INT_MAX` (`common/arg.cpp:3498`):
```cpp
params.verbosity = INT_MAX;
common_log_set_verbosity_thold(INT_MAX);
```

`5 <= INT_MAX` is **TRUE** → DEBUG messages **PASS**.

The callback is registered at `common/common.cpp:394`:
```cpp
llama_log_set(common_log_default_callback, NULL);
```

**Layer 2 satisfied: `-v` raises threshold above DEBUG. CONFIRMED.**

### Prereg author's source-level claim verification

PREREG.md:79-87 claims:
- "execute-op line is emitted with `GGML_LOG_DEBUG(...)` (under the `GGML_HEXAGON_VERBOSE` gate)" — **CONFIRMED** at ggml-hexagon.cpp:110.
- "common_log drops DEBUG unless raised" — **CONFIRMED** at common/log.cpp:454-458, common/log.h:24,32.
- "`-v` = 'Set verbosity level to infinity'" — **CONFIRMED** at raw/perplexity_help.txt:200.
- "#46 set the env but not `-v` → 12-line logs" — **CONFIRMED** (ppl_ship_htp.txt has12 lines, no execute-op).
- "llama-bench (#44) printed the lines because it does not install the filtering logger" — **PARTIALLY CONFIRMED.** llama-bench at `tools/llama-bench/llama-bench.cpp:2228-2230`: `if (!params.verbose) { llama_log_set(llama_null_log_callback, NULL); }`. When `-v` is NOT passed, it nulls the callback. When `-v` IS passed, it doesn't call `llama_log_set` at all, leaving the default `ggml_log_callback_default` (`ggml/src/ggml.c:7826`), which writes ALL levels to stderr unconditionally. So the claim is correct: llama-bench with `-v` has no filtering; without `-v`, it nulls everything. The #44 driver (`q1_run.sh`) used `-v` + `GGML_HEXAGON_VERBOSE=1`, so both layers were satisfied.
- "Both the env AND `-v` are required; #47 sets both" — **CONFIRMED.**

**Verdict: Entire claim chain CONFIRMED.**

---

## Angle 3: `-v` log volume — can the driver handle it?

### Volume estimate

Per the #44 REPORT, the OLMoE model has 16 layers × 3 expert ops (gate/up/down) = 48 `MUL_MAT_ID` execute-op lines per forward pass. For perplexity with 32 chunks × 2048 tokens = 65,536 tokens, and ~35-40 ops per token (attention + FFN + norms), total execute-op lines ≈ 65,536 × 38 ≈ **2.5M lines**. Each line is ~200-300 bytes. Execute-op alone ≈ **500-750 MB**. Add set-tensor, get-tensor, mapped-buffer, init-tensor HEX_VERBOSE lines → total **1-2 GB**.

### Driver approach

`d_run.sh:82-84`:
```sh
adb -s "$SER" shell "cd $DEVDIR && $HTP_ENV && ( $CMD; echo EXIT=\$? ) 2>&1 | tee $DEVDIR/ppl_$tag.dev.txt" \
  > "$RAW/ppl_$tag.txt" 2>&1 || true
```

The entire stdout+stderr is tee'd: one copy stays on device (`ppl_$tag.dev.txt`), one goes to host (`ppl_$tag.txt`). The host stream goes through the adb tunnel/pty.

### Risk assessment

- **adb pty buffer:** Typical adb shell pty buffers 4-64 KB. 1-2 GB of log will overflow this. The `|| true` after the adb command means the shell won't fail, but the host log (`ppl_$tag.txt`) may be truncated.
- **Device tee:** `tee` on device writes to flash — reliable but slow for 1-2 GB.
- **Host pull:** `adb pull` of the device copy is reliable (file-to-file).
- **20-min cap:** Log I/O could add minutes. Ship HTP with `-v` might take 80s compute + 30-60s log I/O = ~2-3 min. OLMoE similar. Total ~10-13 min. Should fit in 20 min.

**Key insight:** The prereg says "the driver keeps it whole — no `tail`, no filtering on device" (PREREG.md:14-15). This is correct — the device tee copy is pulled intact. The host stream may truncate, but the summary grep (`d_run.sh:85`) runs on the host copy. If the host copy is truncated, the grep for `Final estimate` and `execute-op` might miss lines at the end.

**However:** `Final estimate` appears near the end of the log. If the adb stream truncates before that line, the summary would show empty results. The `|| true` means the script continues. The grep for `execute-op` counts in the host copy — if truncated, counts would be low.

**PLAUSIBLE, MINOR.** The device tee copy is the authoritative log. The host copy is a best-effort mirror. If the host copy truncates, the device copy can be pulled again. The prereg's "keep it whole" intent is satisfied by the device copy. **No fix needed, but the driver should document that the device copy is authoritative.**

---

## Angle 4: Cross-check — must PPL_HTP(#47) == PPL_HTP(#46)?

**Prereg claim** (PREREG.md:25): "the same HTP computation with and without `-v` must agree to the printed precision (40.2720 / 9.0620)"

**Analysis:**
- `-v` only affects logging (`common/log.cpp:454-458`), not computation. No code path in the perplexity compute loop reads `params.verbosity`.
- `GGML_HEXAGON_VERBOSE=1` sets `opt_verbose=1` which enables `HEX_VERBOSE` logging. This calls `GGML_LOG_DEBUG` which invokes the log callback. The callback acquires a mutex (`common_log_add` at `common/log.cpp:200`). This could theoretically add contention, but:
  - The mutex is per-log-call, not held during computation.
  - Logging happens after each op completes, not during.
  - Thread scheduling could shift by microseconds, but f32 accumulation order is deterministic for fixed graphs.
- **No numeric effect from `-v`.** The "identical to printed precision" requirement (4 decimal places) is appropriate.
- **No threading/ordering effect.** `GGML_HEXAGON_VERBOSE` logging is per-op, serialized by the log mutex. It doesn't change op scheduling or thread assignment.

**Verdict: CONFIRMED. Identical precision is the right check. "identical to printed precision" is not too strict — it's exactly right for detecting any unexpected side effect.**

---

## Angle 5: Decision rule consistency

**Prereg rule** (PREREG.md:27-29): "Session 1 D closes on correctness iff #46's judge-repaired verdict stands after its hostile audit AND ship = PASS here at 32 chunks"

**Check against #46 prereg:**
- #46's judge verdict: MUL_MAT patched-correct = CLOSED; MUL_MAT_ID = CLOSED (301/31 OK). These are in the ops cell, not this PPL cell. The prereg correctly defers to "#46's judge-repaired verdict stands after its hostile audit."
- Ship = PASS at 32 chunks: this is the new measurement from #47. Correct.
- OLMOe = PASS: "certifies the experts lane in addition; it is not required for D." Correct — OLMoE is supplementary.
- "The #46 ops defect list (36 INTERNAL-ERROR shapes + attribution note) stays open as its own item regardless." Correct — doesn't block D.

**Escape hatch:** The prereg has no explicit escape hatch beyond the METHOD-VOID / ANOMALY categories. If the ship HTP PPL differs from #46's by >0.05% (the cross-check threshold), it's ANOMALY and blocks banking until explained. This is consistent.

**Verdict: CONFIRMED. Decision rule is internally consistent and consistent with #46's prereg.**

---

## Angle 6: Driver vs prereg discrepancies

### 6a. Cap: `over()` 960 s vs 20-min cap — MAJOR

**Prereg** (PREREG.md:17): "cap **20 min**" = 1200 seconds.

**Driver** (`d_run.sh:17`): `over() { [ "$(elapsed)" -ge 960 ]; }` = 16 minutes.

The driver cuts off at 16 minutes, 4 minutes before the prereg's 20-minute cap. This is a **stricter** constraint than the prereg — it could skip the OLMoE arm prematurely if the ship arm + upload takes >16 minutes.

**Worst-case timing:**
- Kit: 5 s
- Ship upload: ~80 s
- Ship HTP + `-v` overhead: ~80-160 s
- OLMoE upload: ~200 s
- OLMoE HTP + `-v` overhead: ~80-160 s
- Gates + shas: ~90 s
- **Total: ~535-715 s** (9-12 min). Should fit in 960 s.

But if device is slow or thermal gate triggers a 3-min wait: +180 s → 715-895 s. Still under 960 s in most cases.

**Verdict: MAJOR.** The driver's 960 s is inconsistent with the prereg's 1200 s. Either:
- **Fix driver:** `over() { [ "$(elapsed)" -ge 1200 ]; }` to match the prereg.
- **Fix prereg:** change cap to 16 min if that's the intended policy.

**Recommended fix: Change driver `over()` to 1200 to match the prereg.**

### 6b. Exit 8 on crash — CONFIRMED, OK

**Prereg** (PREREG.md:10): "crash policy" (inherited from #46).

**Driver** (`d_run.sh:87`): `if crashed "$RAW/ppl_$tag.txt"; then note "CRASH_$tag (cell ends)"; exit 8; fi`

`exit 8` ends the script. Consistent with "crash ends the cell." CONFIRMED.

### 6c. Grep pattern `execute-op MUL_MAT[^_]` — CONFIRMED, OK

**Actual line format** (from #44 REPORT):
```
ggml-hex: HTP0 execute-op MUL_MAT_ID|blk.0.ffn_gate_exps.weight ...
```

**Driver grep** (`d_run.sh:85`): `grep -c 'execute-op MUL_MAT[^_]' "$RAW/ppl_$tag.txt"`

Tested:
- `execute-op MUL_MAT|foo` → matches (count=1) ✓
- `execute-op MUL_MAT_ID|foo` → does NOT match (count=0) ✓

Pattern correctly counts MUL_MAT (non-ID) and excludes MUL_MAT_ID. CONFIRMED.

### 6d. File names — CONFIRMED, OK

Driver outputs: `ppl_ship_htp.txt`, `ppl_olmoe_htp.txt`, `ppl_ship_htp.dev.txt`, `ppl_olmoe_dev.txt`. Device tee copies pulled to `raw/`. Matches prereg's "raw/ (both HTP logs whole, device tee copies, ...)". CONFIRMED.

### 6e. --device $BDEV vs hardcoded HTP0 — MINOR

**#46 prereg** used `--device HTP0` (hardcoded). **#47 driver** uses `--device $BDEV` (from `list_devices`). Both are correct — `$BDEV` defaults to `HTP0` if not found (`d_run.sh:46`). The dynamic approach is more robust. No issue. CONFIRMED.

### 6f. Drop order — CONFIRMED, OK

**Prereg** (PREREG.md:26): "kit → ship HTP → OLMoE HTP. No ops arms, no Qwen."

**Driver** (`d_run.sh:90-96`): kit → ship HTP → OLMoE HTP. No ops arms. CONFIRMED.

---

## Final verdicts

| # | Finding | Verdict | Severity | Fix |
|---|---------|---------|----------|-----|
| 1 | CPU PPL reuse is safe | PLAUSIBLE | — | — |
| 2 | `-v` makes execute-op lines appear (two-layer gating) | CONFIRMED | — | — |
| 2a | Prereg author's source-level claim chain | CONFIRMED | — | — |
| 3 | Log volume manageable, device tee authoritative | PLAUSIBLE | MINOR | Document device copy as authoritative |
| 4 | Cross-check precision requirement is correct | CONFIRMED | — | — |
| 5 | Decision rule consistent with #46 | CONFIRMED | — | — |
| 6a | **Driver `over()` 960 s ≠ prereg cap 1200 s** | MAJOR | **MAJOR** | **Change `over()` to 1200** |
| 6b | Exit 8 on crash consistent | CONFIRMED | — | — |
| 6c | Grep pattern correct | CONFIRMED | — | — |
| 6d | File names consistent | CONFIRMED | — | — |

**1 MAJOR: `over()` 960 vs prereg 1200.**

---

## FIX

Change `d_run.sh:17` from:
```sh
over() { [ "$(elapsed)" -ge 960 ]; }
```
to:
```sh
over() { [ "$(elapsed)" -ge 1200 ]; }
```

To match the prereg's "cap **20 min**" (1200 seconds). The current 960 s (16 min) is stricter than declared and could prematurely skip the OLMoE arm under adverse timing.

**FIX**
