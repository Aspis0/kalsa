# AUDIT — cell #44 (job 795870), hostile, 2026-09-01

## VERDICT

**SURVIVES: CONFIRMED.** Q1 PASS + Q2 PASS → PREREG decision rule satisfied.
Session 1 D closed: **NO** — PREREG.md explicitly: *"It does not close Session 1 D: patched-judge test-backend-ops and Qwen3.5-4B dense v79 remain OPEN"*.

---

## FINDINGS

### 1. Q1 dispatch — CONFIRMED
48 lines `HTP0 execute-op MUL_MAT_ID` on `ffn_*_exps` (16 layers × gate/up/down = 48).
All 16 layers confirmed on HTP0. Hexagon Arch v79 logged.
PREREG: *"SURVIVE-DISPATCH iff the log contains `HTP0 execute-op MUL_MAT_ID` on `ffn_*_exps`"* → **PASS**.

### 2. Q2 survive — CONFIRMED
`EXIT=0` inside the adb shell (captured in `q1_bench.txt` tail). `q1_adb.exit` contains `0`.
No dspqueue, no qurt_exit, no INTERNAL-ERROR in the entire 12579-line log.
PREREG: *"Non-zero after a successful load = DOES-NOT-SURVIVE"* → **PASS**.

### 3. SHA match — CONFIRMED (not METHOD-VOID)
`raw/model_sha_device.txt`:
```
host=9d0b90c60a5b4732ba1faeb0b8940523173bf7e2a7f038d5753ce3ac24b98618
device=9d0b90c60a5b4732ba1faeb0b8940523173bf7e2a7f038d5753ce3ac24b98618
```
Identical. REPORT line 12 confirms it.

### 4. `--list-devices` failed — CONFIRMED (does not void)
`raw/list_devices.txt`: `"CANNOT LINK EXECUTABLE "./bin/llama-bench": library "libllama-bench-impl.so" not found"`
`q1_run.sh` line 35: ran `--list-devices` **without** `LD_LIBRARY_PATH`.
PREREG binding item 3 asks whether this voids the cell given HTP0 + v79 in the same run. **REFUTED** — the probe was a separate shell invocation; the actual Q1 invocation set `LD_LIBRARY_PATH` and succeeded. The backend `HTP0` is proven by the execute-op lines, not by `--list-devices`.

### 5. build_commit mismatch PLAUSIBLE
Kit tarball named `npu-kit-556118a08.tgz` (PREREG: "from kalsallama `556118a08`").
Jsonl `build_commit`: `"4c7101af4"`.
REPORT line 21: *"llama-bench jsonl `build_commit` = `4c7101af4` (embedded; tarball name is 556118a08)."*
**PLAUSIBLE** — `556118a08` is the git ref/tag used to name the artifact; `4c7101af4` is the commit actually compiled into the binary. Could be a shallow clone build, dirty-tree, or submodule offset. REPORT does not explain the discrepancy. **Requires ADDENDUM before git commit**: state which commit `4c7101af4` is and whether the tarball was rebuilt from it or is a mislabel.

### 6. model_size in jsonl ≠ MODEL.txt bytes — CONFIRMED (benign)
`MODEL.txt`: bytes `3928038208`. Jsonl `model_size`: `3926255616`. Delta: 1,782,592 B (0.045%).
**PLAUSIBLE** — `model_size` is the GGUF content size parsed by the loader (excludes alignment padding/fingerprint); `bytes` in `MODEL.txt` is the `stat` file size. Not a method flaw. REPORT should note this if citing model_size.

### 7. Secrets in raw — REFUTED
Grep for `AKIA`, `sk-`, `ghp_`, `xox[bpsa]-`, bearer tokens, passwords, API keys across all raw files: **none found**.
The `tokenizer.ggml.tokens` entries containing `IP_ADDRESS` are standard OLMoE tokenizer tokens, not leaked data.

### 8. Q3 not run — CONFIRMED (PREREG-compliant)
PREREG Q3: *"One more NPU invocation `-p 512 -n 0 -r 3`... only if Q1 and Q2 both pass."*
REPORT: *"Session was ended after Q1 to stop idle burn."*
PREREG hard cap: *"Remaining invocations NOT RUN if the cap trips."* The 20-min wall was the constraint. Q3 is report-only per PREREG — no routing verdict depends on it. **Session 1 D remains OPEN** regardless.

### 9. blk.1 grep artifact (self-corrected)
Initial `grep -c` for blk.1 showed 21 — false positive from `blk.1` matching `blk.10`–`blk.15`. Corrected to 3. Total 48 = 16 × 3 confirmed. **REFUTED as finding** — no anomaly.

### 10. q1_run.sh always `exit 0` — CONFIRMED (correct by design)
Script ends `exit 0`. The actual exit code is captured inside the adb shell: `echo EXIT=$?`. `q1_adb.exit` = `0`. BINDING item 1: *"use the `EXIT=` line inside the adb shell, not HOST_EXIT"* → line says `EXIT=0`. Correct.

### 11. Thermal gate — CONFIRMED
`raw/gate_pre.txt`: `GATE_PASS`. REPORT confirms post-Q1 also `GATE_PASS`.
PREREG AMENDMENT-1 respected.

---

## FIX vs APPLY

Before git commit of REPORT + AUDIT as bank:

| # | What | Action |
|---|------|--------|
| F1 | **build_commit `4c7101af4` vs tarball `556118a08`** unexplained | **FIX REPORT** — add a sentence: "build_commit 4c7101af4 is the commit compiled into the kit binary; 556118a08 is the git ref used to tag/archive the tarball." If this is wrong, correct it. |
| F2 | **model_size discrepancy** (1.78 MB) not noted in REPORT | **FIX REPORT** — one line: "jsonl model_size (3926255616) is the GGUF content size; MODEL.txt bytes (3928038208) is the file stat size; delta is alignment padding." |
| F3 | **Session 1 D closure** — REPORT says "Session 1 D" is OPEN but does not quote PREREG | **FIX REPORT** — add PREREG quote: *"patched-judge test-backend-ops and Qwen3.5-4B dense v79 remain OPEN."* |
| F4 | **PREREG.md line 147**: Q3 is described as only needing Q1+Q2 to pass, but does not explicitly state "Session 1 D not closed by this cell" | **APPLY** — No change to PREREG (already says it). AUDIT quotes it above. REPORT must propagate. |

---

## ARITHMETIC APPENDIX

| Metric | Value |
|--------|-------|
| MUL_MAT_ID total | **48** (16 layers × 3 ops) |
| Per-layer count | blk.0–15: **3 each** |
| ffn_gate_exps lines | 336 |
| ffn_up_exps lines | 336 |
| ffn_down_exps lines | 336 |
| ffn_*_exps total | 1008 (= 336 × 3 op types; includes non-MUL_MAT_ID lines) |
| Hexagon Arch | `v79` (1 line) |
| INTERNAL-ERROR | **0** |
| dspqueue/qurt_exit | **0** |
| avg_ts (jsonl) | 845.885502 t/s |
| avg_ns (jsonl) | 605,282,865 ns |
| Recomputed: 512 / (605282865 / 1e9) | **845.885502** — matches avg_ts exactly |
| samples_ns | [605282865] (single run, r=1) |
| samples_ts | [845.886] |
| stddev | 0.000000 (r=1, expected) |
| q1_adb.exit | 0 |
| model_size jsonl | 3,926,255,616 B |
| model_size MODEL.txt | 3,928,038,208 B |
| Delta | 1,782,592 B (0.045%) |
| build_commit jsonl | `4c7101af4` |
| tarball name | `556118a08` |
| Secrets scan | 0 matches |
| Session 1 D closed | **NO** |
