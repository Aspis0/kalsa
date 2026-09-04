# AUDIT-PRERUN — Cell #59 PREREG hostile review

Date: 2026-09-03. Read-only audit. All claims below quote source lines.

---

## 1. HISTORICAL FIDELITY

### 1a. "48 MUL_MAT_ID execute-ops" — CONFIRMED
hostbuf1/driver.out line: `n_exps_htp0=48 n_mul_mat_id=48 n_attn=96` (hostbuf1/driver.out:1).
48 = 16 layers × 3 ops (gate/up/down). The PREREG's "48 MUL_MAT_ID execute-ops seen"
matches the q48 HOSTBUF=1 proof count exactly.

### 1b. "rc=134" — CONFIRMED
hostbuf1/driver.out: `a proof rc_a=134` (hostbuf1/driver.out:1).
bprime/a_rc.txt: `134`. n0/stderr.txt: `Aborted` (SIGABRT). All S23 arms that died
returned 134.

### 1c. "dspqueue_read 0x2e as the characterized load-death signature" — CONFIRMED
hostbuf1 a_stderr.txt:16878: `ggml-hex: dspqueue_read failed: 0x0000002e`
f2b a_stderr.txt:22322: `ggml-hex: dspqueue_read failed: 0x0000002e`
tombstone_08.txt:13: `signal 6 (SIGABRT)` triggered by `ggml_abort` in `flush_pending`
(backtrace: `ggml_abort → flush_pending → graph_compute_async → process_ubatch → decode`).

### 1d. "both HOSTBUF unset AND HOSTBUF=1 died at pp16" — CONFIRMED, but with nuance
- HOSTBUF unset (n0): died at pp16. tombstone_08 captured. n0/stderr.txt shows
  `dspqueue_read failed: 0x0000002e` at pp16.
- HOSTBUF=1 (hostbuf1): died at pp16 with rc=134, n_exps=48. Same `dspqueue_read
  failed: 0x0000002e` in stderr.
- HOSTBUF unset + NO_BINARY=1 (f2b): died at pp16 with rc=134, n_exps=42 (6 fewer
  dispatches than hostbuf1 — some experts didn't fire before the crash). Also same
  `dspqueue_read failed: 0x0000002e`.
- **All three configs die at pp16 with the same signature.** HOSTBUF is exonerated.
  NO_BINARY=1 does not save v73 either (f2b MANIFEST: "removing binary ops from HTP
  does NOT save v73").

### 1e. "ALIVE §8's 'clean retry queued' note is stale" — PLAUSIBLE but requires care
ALIVE row 13 says: "the v73/v75 crash discriminator carried a second variable,
HOSTBUF unset vs =1 — the clean retry is queued". This "clean retry" likely refers
to re-testing HOSTBUF unset on v75 (houji), not to another S23 retry. The PREREG
is correct that the HOSTBUF question is settled on S23 — both configs die. The word
"stale" is accurate in the sense that no further HOSTBUF retry is needed on S23
v73; the PREREG supersedes this queued item.

### 1f. "model sha 43379486…" — CONFIRMED
MANIFEST.md: `43379486db3178d89b338358d298ea0721d6c123e0107d91c5d6179371000500`
(PEREG: "43379486db3178d89b338358d298ea0721d6c123e0107d91c5d6179371000500").
Both match.

### 1g. "3 928 037 856 B" model size — CONFIRMED
MANIFEST.md: `OLMoE-1B-7B-0924-Instruct-Q4_0.gguf | /data/local/tmp/ 3928037856 B`.

### 1h. Three death mechanisms (ALIVE rows 9/11/13) — CONFIRMED, but PREREG grep
   misses one
From ALIVE row 13:
1. `dspqueue_read 0x2e` — the pp16/decode death (tombstone_08, n0/stderr, hostbuf1
   stderr, f2b stderr). **PREREG catches this** via `grep dspqueue_read` and `0x2e`.
2. `qurt_exit()` in `fastrpc_shell_unsigned_3`/`htp_iface_stop` — second mechanism
   found in f2b (binary ops removed, "Bounded skel fixes have no target"). **PREREG
   partially catches this** via `grep fastrpc` — but `fastrpc` appears in benign log
   lines too (`libcdsprpc.so` loading), producing false-positive grep hits.
3. `dspqueue_write 0x1` in `flush_batch` — third mechanism from q53 (B′ trunk under
   perplexity batch-2048). **PREREG DOES NOT CATCH THIS.** The grep for
   `dspqueue_read` misses `dspqueue_write`. If the HDK8550 dies with mechanism 3
   instead of mechanism 1, the PREREG would misclassify it as G4 (DIFFERENT DEATH)
   rather than recognizing it as a dspqueue-family variant.

**SEVERITY: MEDIUM.** Add `dspqueue_write` to the grep pattern. This is a
false-negative risk, not a false-positive — it would cause a finding to be
misclassified between G1 and G4.

---

## 2. ENV-VAR SPELLING

### 2a. GGML_HEXAGON_NDEV=1 — CONFIRMED
All three historical drivers set this:
- hostbuf1_driver.sh: `export GGML_HEXAGON_NDEV=1`
- f2b_driver.sh: `export GGML_HEXAGON_NDEV=1`
- bprime_driver.sh: `export GGML_HEXAGON_NDEV=1`
PREREG: `GGML_HEXAGON_NDEV=1` — **matches**.

### 2b. GGML_HEXAGON_VERBOSE=1 — CONFIRMED
All three historical drivers set `GGML_HEXAGON_VERBOSE=1` (not plain `VERBOSE=1`).
The MANIFEST.md shorthand "VERBOSE=1" is just a summary; the actual env var is
`GGML_HEXAGON_VERBOSE=1`. PREREG: `GGML_HEXAGON_VERBOSE=1` — **matches**.

### 2c. GGML_HEXAGON_HOSTBUF — correctly absent from A1/A3/A5
hostbuf1_driver.sh `setup_env_htp()`: `export GGML_HEXAGON_HOSTBUF=1`
bprime_driver.sh `setup_env_htp()`: `unset GGML_HEXAGON_HOSTBUF`
f2b_driver.sh `setup_env_htp()`: `export GGML_HEXAGON_HOSTBUF=1` (but also
`GGML_HEXAGON_NO_BINARY=1`)
PREREG A1/A3/A5 (HOSTBUF unset): no GGML_HEXAGON_HOSTBUF in the env — **correct**.
PREREG A2/A4 (HOSTBUF=1): `GGML_HEXAGON_HOSTBUF=1` — **correct**.

### 2d. --no-host 1 pairing — REFUTED (A1 carries a confound)
The PREREG says A1 is "the original S23 death config" with HOSTBUF unset.
But the S23 n0 driver (the original HOSTBUF-unset death) did NOT use `--no-host 1`.
The `--no-host 1` flag was only added in q48 (HOSTBUF=1) to mirror the houji config.

**Quote from hostbuf1_driver.sh header_session.txt:**
`HOSTBUF=1 NDEV=1 --no-host 1 -dev HTP0 VERBOSE=1 (houji pair; S23 previous had
HOSTBUF unset and no --no-host)`

The PREREG template is the q48 hostbuf1 invocation, not the n0 original. A1 thus
carries TWO variables changed from the original S23 death:
1. HOSTBUF unset (same as original — correct)
2. `--no-host 1` ADDED (different from original — **confound**)

**SEVERITY: HIGH.** The `--no-host 1` flag changes the CPU/DSP work split. If the
death still occurs with `--no-host 1`, that strengthens the result (death is
arch-bound even with reduced DSP load). If the death does NOT occur, it is
ambiguous: did HOSTBUF save it, or did `--no-host 1`? The PREREG should either:
(a) run an additional A0 arm WITHOUT `--no-host 1` (the true S23 mirror), or
(b) declare the deviation explicitly and accept the ambiguity on the HOSTBUF
question (the PREREG already considers HOSTBUF settled, so this is defensible).
Current status: **APPLY-WITH-FIXES** — add a note declaring the deviation, or
add A0.

### 2e. GGML_HEXAGON_NO_BINARY — correctly absent from A1-A5
f2b_driver.sh set `GGML_HEXAGON_NO_BINARY=1`; this was the f2b-specific guard.
PREREG does NOT include it — correct (the PREREG is not reproducing the f2b arm).

### 2f. ADSP/CDSP_LIBRARY_PATH — matches pattern
All historical drivers: `ADSP_LIBRARY_PATH=$BINDIR` and `CDSP_LIBRARY_PATH=$BINDIR`.
PREREG: `ADSP/CDSP_LIBRARY_PATH=$D/lib-fix` — matches the $BINDIR→lib-fix
substitution pattern.

### 2g. LD_LIBRARY_PATH — matches pattern
All historical drivers: `LD_LIBRARY_PATH="$BINDIR:/vendor/lib64:..."`.
PREREG: `LD_LIBRARY_PATH=$D/lib-fix` — the driver must include the `/vendor/lib64`
path for libcdsprpc.so to load. The PREREG's shorthand is fine as long as the
derived driver expands it correctly (the historical drivers all include it).

---

## 3. GRID DECIDABILITY

### 3a. "Dies" definition — CONFIRMED
PREREG: non-zero exit (134/abort) OR dspqueue/fastrpc fatal in stderr/logcat/tombstone.
Historical: all three S23 deaths had rc=134 + `dspqueue_read failed: 0x0000002e` in
stderr. The dual definition covers both the clean abort and the partial-output case.

### 3b. "Survives" = exit 0 + n_exps_htp0 > 0 — CONFIRMED
hostbuf1_driver.sh computes `n_exps` via:
```
grep "HTP0 execute-op MUL_MAT_ID" "$src" | grep -E "ffn_gate_exps|ffn_up_exps|ffn_down_exps"
```
then `n_exps=$(count_lines "$BASE/a_execute_op_exps_htp0.txt")`.
The PREREG's `n_exps_htp0 > 0` check matches this exact extraction.

### 3c. Is the jsonl extraction feasible from `-v -o jsonl` stderr on llama-bench?
The historical drivers use `grep '^{' "$stderr" > stdout_from_stderr.jsonl` to
extract jsonl from stderr (since `-oe jsonl` duplicates jsonl on stderr). The
`jsonl_n()` function counts `avg_ts` lines in the jsonl. This works.

**One risk:** if `-n 0` is not accepted by llama-bench on the QDC, A3/A4 would
produce no jsonl and the survival check would fail even if the model loaded
correctly. The bprime_driver.sh (S23) had this exact issue — it fell back to
`-n 1` when `-n 0` produced no jsonl. The PREREG does not mention this fallback.

**SEVERITY: MEDIUM.** The driver should include the `-n 0` fallback. If A3/A4
get exit 0 but zero jsonl, the arm is METHOD-VOID, not a survival. The PREREG
should declare: "if `-n 0` produces no jsonl, retry with `-n 1` and record the
deviation."

### 3d. G1-G4 outcomes — CONFIRMED decidable, with one gap
- G1: A1+A2 die with dspqueue/fastrpc signature — **decidable** from exit codes
  + stderr grep + logcat + tombstone.
- G2: A1/A2 exit 0 with proof, A3/A4 die — **decidable**.
- G3: A1-A4 all exit 0 with HTP proof — **decidable**.
- G4: any arm dies outside dspqueue/fastrpc family — **decidable**.
- Mixed HOSTBUF: A1 dies, A2 survives or vice versa — **decidable**.

**Gap:** The PREREG does not define what happens if an arm exits 0 but has
n_exps_htp0=0 (silent CPU fallback). The "METHOD-VOID" label is mentioned in
the "Survives" definition but not in the grid. If A1 exits 0 with n_exps=0,
is that G3 (survived) or METHOD-VOID (void)? The PREREG says "without the
proof a green run is a silent CPU fallback and the arm is METHOD-VOID." This
should be added to the grid explicitly.

**SEVERITY: LOW.** Add METHOD-VOID as a grid outcome.

---

## 4. BUILD CONFOUND

### 4a. "death=strong, survival=ambiguous" — SOUND
PREREG: "Kit v6 is built from kalsa/npu-judge-v79, which carries post-pin
hexagon changes, including upstream #25968 'check tensor type when reusing
descriptors' and HMX-eligibility gating." These changes could FIX a dspqueue
death (by preventing the problematic dispatch). A death with a newer build
that includes potential fixes is indeed stronger evidence than a death with
the original build.

### 4b. Could kit-v6 cause a FALSE death (new crash)?
The PREREG mentions: "changes that could plausibly FIX a dspqueue death."
But could they also CAUSE a new crash?

From ALIVE cell #46 (v79 judge kit): the descriptor-type check was refuted as
the Class B NaN cause (cell #51: "NaN present in ALL FOUR arms"). But the
HMX-eligibility gating (`ne01%32` check) is a new runtime path that didn't
exist in the S23-era build. If the QDC's v73 HTP hits a code path that the
new gating rejects differently than the S23 build did, it could produce a
new crash — but this would be caught by the PREREG's G4 (DIFFERENT DEATH)
classification if the signature is outside the dspqueue/fastrpc family.

**The real risk:** a new crash WITHIN the dspqueue/fastrpc family — e.g., the
HMX gating causes a DSP error that manifests as a fastrpc fatal, which the
PREREG would classify as G1 (REPLICATED) even though it's a new bug, not the
S23 bug. This is a false-positive risk on G1.

**SEVERITY: MEDIUM.** The PREREG's "same family (dspqueue/fastrpc fatal during
expert dispatch) suffices; a different family goes to G4 instead" is too
permissive. A pre-registered discriminator: if G1 fires, check whether the
f2b result (NO_BINARY=1) would have changed the outcome. If the S23's f2b
died too (it did — n_exps=42, rc=134), then the build confound is weaker
because f2b also had post-pin changes and still died. The cheapest
discriminator is: does the crash happen at the same opcode count (pp16, same
n_exps range)? If so, it's likely the same bug. If it happens at a different
count, flag for manual review.

---

## 5. ARM DESIGN

### 5a. Caps — CONFIRMED
A1/A2: 900s. A3/A4/A5: 1500s. These are reasonable for pp16 (fast) and
pp512/tg128 (slower, especially with model load). The S23 hostbuf1 arm (a)
completed in ~8s; the f2b arm (a) in ~8s. The caps are generous.

### 5b. Gating chain — CONFIRMED
A3 runs only if A1 exits 0. A4 runs only if A2 exits 0. A5 runs only if A3
exits 0. This is correct: if pp16 dies, pp512/tg128 are redundant. If pp512
dies, tg128 is redundant.

### 5c. -p 512 -n 0 — VALID but with caveat
`-p 512 -n 0` is valid for llama-bench: it runs a 512-token prefill with no
decode. The bprime_driver.sh used `-p 512 -n 0 -r 2`. However, the S23 had
to fall back to `-n 1` when `-n 0` produced no jsonl. The PREREG should
include this fallback.

### 5d. -p 0 -n 128 — VALID
`-p 0 -n 128` is a pure decode of 128 tokens from an empty prompt. Standard
llama-bench usage. The S23 hostbuf1 and f2b drivers used `-p 0 -n 128`.

### 5e. --load-mode none — CONFIRMED
All S23 drivers used `--load-mode none`. This forces non-mmap loading (the
model is loaded into memory via read(), not mmap). On the QDC, this is
fine — the model fits in RAM (~3.9 GB on a 12+ GB device).

### 5f. tombstone/logcat capture feasibility — CONFIRMED
The S23 drivers captured tombstones via `ls -t /data/tombstones/tombstone_*`
and logcat via a separate logcat capture. The PREREG declares "logcat ring
captured per arm, tombstones pulled." This is feasible over adb on the QDC
(same as S23).

---

## 6. ANYTHING ELSE

### 6a. Model push size/time — PLANNED
PREREG: "model push ~2 min on QDC's link." The model is 3.9 GB. Over USB3.0
(~30 MB/s), 3.9 GB takes ~130s ≈ 2.2 min. Over network adb (slower), could
be 5-10 min. The PREREG's 2-minute estimate is reasonable for USB.

### 6b. Budget arithmetic — TIGHT
PREREG: "45 min booked, expected ~20-25 min billed." With 5 arms:
- A1: ~10s (pp16 is fast)
- A2: ~10s
- A3 (if runs): ~150s (pp512)
- A4 (if runs): ~150s
- A5 (if runs): ~150s
Total active: ~470s ≈ 8 min. Plus thermal gates (5 × ~1 min cooldown) = 5 min.
Plus model push: 2 min. Plus ADB setup: 3 min. Plus overhead: 5 min.
Total: ~23 min. Within the 45-min session with margin. But if thermal gates
are aggressive (the HDK ran hot in #53), retries could consume the margin.

### 6c. Thermal realism on HDK — RISK
PREREG: "the HDK ran hot in #53." The S23 ran hot during sustained NPU load
(q57: 2.33 °C/min). The HDK8550 is a reference board — it may have worse
thermal management than a retail phone. The thermal gate (#38) before every
arm is correct. But if the HDK throttles aggressively, the NPU speed could
be significantly reduced, affecting the tim budget.

### 6d. libggml-htp-v73.so in kit-v6 — CONFIRMED
`ls ~/kalsa-qdc/npu-v79-cell/kit-v6/lib-fix/`: `libggml-htp-v73.so` is present
at 678,452 bytes. Also present: libggml-hexagon.so, libggml-htp-v75.so,
libggml-htp-v79.so, libggml-htp-v81.so, libggml-opencl.so.

### 6e. bin/ ELFs are thin wrappers — CONFIRMED
`file ~/kalsa-qdc/npu-v79-cell/kit-v6/bin/llama-bench`: "ELF 64-bit LSB pie
executable, ARM aarch64, dynamically linked." Size 4,464 bytes — clearly a
thin wrapper that loads libs from LD_LIBRARY_PATH. The driver MUST set
`LD_LIBRARY_PATH=$D/lib-fix:/vendor/lib64:/system/vendor/lib64:/system/lib64`
for the binary to find libcdsprpc.so and the HTP libs.

---

## SEVERITY-RANKED FINDINGS

| # | Finding | Verdict | Severity |
|---|---|---|---|
| 1 | A1 carries `--no-host 1` not present in original S23 death | REFUTED (as "original S23 death config") | HIGH |
| 2 | `dspqueue_write` not in grep patterns (mechanism 3 gap) | PLAUSIBLE risk | MEDIUM |
| 3 | No `-n 0` fallback declared for A3/A4 | PLAUSIBLE risk | MEDIUM |
| 4 | Build confound could cause false G1 (new crash in same family) | PLAUSIBLE risk | MEDIUM |
| 5 | METHOD-VOID not in grid outcomes | PLAUSIBLE gap | LOW |
| 6 | `fastrpc` grep will false-positive on benign log lines | PLAUSIBLE noise | LOW |

---

## VERDICT

**APPLY-WITH-FIXES.**

The PREREG is historically faithful on all major claims (rc, proof counts, shas,
HOSTBUF exoneration, env-var spellings). The grid is decidable. The build
confound reasoning is sound. Three fixes required before the driver is derived:

1. **Declare the `--no-host 1` deviation in A1** (or add A0 without it). The
   current text says A1 is "the original S23 death config" — this is inaccurate.
2. **Add `dspqueue_write` to the grep patterns** in the grid definition. Change
   "grep `dspqueue_read` / `0x2e` / `fastrpc`" to
   "grep `dspqueue` / `0x2e` / `fastrpc`" (the broader `dspqueue` catches both
   `dspqueue_read` and `dspqueue_write`).
3. **Declare the `-n 0` fallback**: "if `-n 0` produces no jsonl, retry with
   `-n 1` and record the deviation" — matching the S23 bprime_driver.sh pattern.
