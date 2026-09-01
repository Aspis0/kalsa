# PREREG — cell #46: v79 correctness with a REAL judge + PPL HTP-vs-CPU (qdc-8elite-npu-v79-judge)

**Status: rev-3 2026-09-01 night after hostile audit GLM `AUDIT-PREREG.md` (rev-1: 19
findings applied; rev-2 re-audit: N1/N2 blockers + N3–N13 + residuals applied here).
Awaiting re-audit; no QDC session until APPLY.**
Measures the correctness half of Session 1 D that #43/#44/#45 left OPEN; closes it only
under the rule in "Decision rule".

## Why

#43 and #45 ran `test-backend-ops -b HTP0` with an UNPATCHED harness: every quantized
MUL_MAT / MUL_MAT_ID "FAIL" was a judge artefact (CPU reference dequantizing HTP-tiled
bytes → `CPU=nan/inf`; 301/303 in #45), and 36 real `INTERNAL-ERROR` responses were
swallowed (`ggml-hexagon.cpp` flush_pending: log + `// TODO: handle errors`) so the op's
random fill was compared as if computed. `score_judge.sh` only re-labels log lines; it
cannot certify anything. The q32 patch (`scratchpad/agents/q32-npu-judge-exp/`,
device-verified on v75 in q35: `PLAIN_HOST=1` → cpu-src0 nan_scales=0, 34/70 of the
baseline FAILs now pass, 36 remain as finite ERR — the v75 m=16-family DSP errors)
fixes the reference copy; the error-propagation fix turns a swallowed DSP error into
`GGML_STATUS_FAILED`, which the judge compare path now reports as
`ggml_backend_graph_compute failed` and a FAIL.

**Erratum found during this prereg's audit (to be banked with #46):** #45's REPORT and
its audit counted `OK=0` on both op classes with `grep -c ': OK'`; the raw logs carry
ANSI colour escapes between `: ` and `OK`, and the harness summary lines read
`472/542 tests passed` (MUL_MAT) and `0/301 tests passed` (MUL_MAT_ID). #45's census
digits were reproducible but two of them (OK, FAIL) were grep artefacts; verdicts
unchanged (patched-correct was FAIL either way).

## Kit (frozen)

- Branch `kalsa/npu-judge-v79` in Aspis0/kalsallama (local, NOT pushed), built in the
  official container `ghcr.io/snapdragon-toolchain/arm64-android:v0.7` (same tree/flags
  as kit 556118a08, incremental, no skel rebuilt). Pin sha: **`93e9592fa`** (= 204e78259
  + 214ae986e judge port/error propagation + 93e9592fa status checks/DUMP off; hostile
  audit mimo `AUDIT-KIT.md` APPLY + re-audit APPLY). Tarball
  `~/kalsa-qdc/npu-v79-cell/npu-kit-93e9592fa.tgz` (11 018 937 B, 24 payload files,
  `bin/test-backend-ops` sha `9de50525…`). SHA256SUMS has no self-line; on device the
  driver verifies with `sha256sum -c` on the manifest minus any `SHA256SUMS` self-line
  and requires the OK count to equal that manifest's line count (24 for this kit).
- Diff vs 556118a08 is limited to: `tests/test-backend-ops.cpp` (q32 port:
  `GGML_TEST_PLAIN_HOST=1` → reference recopied via get/set; diagnostics; status
  checks), `ggml/src/ggml-hexagon/ggml-hexagon.cpp` (+7/−1: non-OK dsp-rsp →
  session `error_count` → graph status FAILED; the `dsp-rsp: INTERNAL-ERROR` log line is
  KEPT, so each DSP error emits BOTH lines), packaging (`llama-perplexity` +
  `libllama-perplexity-impl.so` added). **No kernel / skel / DSP-side change.**
- Bins: `test-backend-ops`, `llama-bench`, `llama-cli`, `llama-perplexity` (first
  llama-perplexity ever shipped in a v79 kit: its `--help` is captured at arm 1 and the
  driver checks `--load-mode`, `-fa`, `--chunks` individually, recording each in
  `events.txt`; a missing flag is a declared deviation — `--load-mode none` is added
  only if present; a missing `-fa`/`--chunks` is reported and the structural-VOID rule
  below covers the consequence).

## Device / session

QDC QRD8750 (Snapdragon 8 Elite, Hexagon v79, Android 16) ONLY. Interactive session
SSH+mirror, key `kalsa-mac`, cap **30 min** (QDC-enforced), name `npu-v79-judge-46`.
Owner does wizard+Connect; `connect.sh` raises the tunnel on local port **6037** (never
5037) and execs `d_run.sh`. One job at a time; a duplicate Submitted job is cancelled
before Running. Minutes bill from Running: an empty job (795454 pattern) is a cost.

**Clocks and cap policy.** `elapsed` = seconds from driver start (T0, `raw/serial.txt`),
declared non-identical to QDC Running time; the Running timestamp from the job page is
written by hand to `raw/running.txt` at connect time. The T0-vs-Running drift (owner
connects within ~2 min of Running) is ACCEPTED: the 24-min launch stop stays T0-based;
no recompute. The driver imposes no per-invocation timeout. If the QDC cap trips
mid-arm: the log captured up to the kill is banked; PPL output is ALSO tee'd to a
device-side file and pulled at the end (q55 pattern); because the tee makes stdout a
pipe (block-buffered), the driver prefixes `stdbuf -oL` when the device has `stdbuf`
(checked at arm 1) and otherwise the buffering limitation is declared in the REPORT
header; the fallback uses the last COMMON chunk actually present in both captured logs,
never an assumed one.

Env for every invocation (both arms, recorded): `LD_LIBRARY_PATH=<kit>/lib
ADSP_LIBRARY_PATH=<kit>/lib`, kit dir only (no `/vendor/lib64`). Backend name read from
`--list-devices` (expect `HTP0`, `Hexagon Arch version v79`). Missing v79 line →
**METHOD-VOID and END**: no further arms run (driver exits), only arm-1 raw is banked.
A failed `adb push` (device storage) ends the driver with `PUSH_FAIL` noted (exit 6).

**Thermal gate** (AMENDMENT-1 (#38) truth rule: `Current temperatures from HAL:` section
only, never `Cached`; cool-down gate before every RUN): live HAL max ≤ 60 °C AND Thermal
Status ≤ 1 before EACH invocation (arms 4–6 contain two invocations each — both gated;
CPU arms gated like NPU arms because #43 disclosed 61.5/63.0 °C in-run CPU excursions);
snapshot after each invocation. On gate fail: wait once (this cell: ≤ 3 min, stricter than
AMENDMENT-1's 10-min poll), then SKIP that invocation (declared `GATE_SKIP`); never run hot.

**Crash policy** (binding on the driver): `qurt_exit` / `dspqueue_(read|write) failed` /
`CDSP0 CRASHED` in any invocation = CRASH. Per the #45 lesson this ends the NPU work — no
retry, remaining HTP invocations are SKIPPED (`CRASH_SKIP`) — but CPU-only PPL
invocations still run and bank (judge- and NPU-independent). An `INTERNAL-ERROR` dsp-rsp
is NOT a crash: it is the defect the harness now surfaces as a FAIL; the run continues.

## Arms, in drop order (no new invocation launched at ≥ 24 min elapsed)

1. **Kit + list-devices + `llama-perplexity --help` + `stdbuf` probe** (≤ 1 min).
   Backend line quoted.
2. **Q_ops-patched**: `GGML_TEST_PLAIN_HOST=1 test-backend-ops -b HTP0 -o MUL_MAT`,
   then `-o MUL_MAT_ID`. Each log ends with `echo EXIT=$?` (binding rc = that line, #45
   lesson). Two harness witnesses (exact strings from `tests/test-backend-ops.cpp` @
   93e9592fa): the one-shot banner `[ref-buf] exp1 GGML_TEST_PLAIN_HOST=1 cpu_buft="CPU"`
   (`:10750`, prints once in MODE_TEST regardless of outcomes — proves only that the
   ported harness ran) and the per-test stderr line `[ref-buf] PLAIN_HOST=1
   copy-buffer="…" cpu_buft="CPU" recopy=get/set` (`:726`, printed each time the
   reference is recopied through get/set). `recopy_lines` = count of `recopy=get/set`
   lines; in arm 2 it must EQUAL `executed` (542 / 301) — the non-vacuous proof that
   every judged test used the repaired reference — and in arm 3 it must be 0.
   **Census** — executed by `census.awk` (in this directory, validated before the session
   on the #43 and #45 raw ops logs against the totals below; the script is part of the
   frozen method):
   - ANSI escapes stripped first; the scan STOPS at the first `tests passed` summary
     line (the `Failing tests:` recap and the `Backend HTP0: FAIL` / bare `FAIL` /
     `N/M backends passed` summary lines are excluded from every category);
   - a **test** = a line carrying the op header (`MUL_MAT(` resp. `MUL_MAT_ID(`); its
     **verdict** = the `OK` / `FAIL` / `not supported` token on the same line, or on the
     first following line that carries a verdict token (stderr from the library —
     `dsp-rsp: INTERNAL-ERROR`, `ggml_backend_graph_compute failed` — interleaves
     between header and verdict; #45 raw proves the verdict lands on the next physical
     line);
   - `ok`, `FAIL_total`, `skip` = verdict counts; `executed = ok + FAIL_total`;
     **conservation**: `ok + FAIL_total + skip` must equal MUL_MAT **1470** (542
     executed + 928 skip) and MUL_MAT_ID **812** (301 executed + 511 skip) — verified on
     #43 and #45 raw; a mismatch is a declared harness change, not silently absorbed;
   - per FAIL test, ONE category from the diagnostic text attached to that test: the
     header line itself (the harness prints `[MUL_MAT] NaN at index i (HTP0=x CPU=y)
     cpu_buf=… ` on the header line, #45 raw `ops_MUL_MAT.txt:47`), any lines between
     header and verdict, and the verdict line:
     `compute_failed` if a `ggml_backend_graph_compute failed` line is attached;
     else `judge_nonfinite` if `CPU=(nan|-nan|inf|-inf)`;
     else `htp_nonfinite` if `HTP0=(nan|-nan|inf|-inf)` with finite CPU (counted INTO
     the v79 defect list);
     else `real_fail` (both sides finite, or no values printed);
     `other` = FAIL_total − (compute_failed + judge_nonfinite + htp_nonfinite +
     real_fail) is reported and must be 0 by construction (a non-zero value = script
     bug, run VOID for the census);
   - `internal_error_lines` = count of `dsp-rsp: INTERNAL-ERROR` lines, reported as a
     cross-check of `compute_failed` (expected close, NOT required equal: a graph can
     carry several ops);
   - HTP execution proof: ≥ 1 line evidencing HTP0 execution (`HTP0=` value prefix in a
     diagnostic line, or the `HTP0` session-open line in the log). No proof → the arm is
     METHOD-VOID (vacuous run), not a repair result.
3. **Q_ops-control** (if elapsed-from-T0 < 8 min at trigger, matching the driver):
   `GGML_TEST_PLAIN_HOST=0 -o MUL_MAT_ID` only. Expected: `judge_nonfinite` = **301
   exactly** (deterministic: identical on units 2a38935c and f25c433a); a value outside
   290–315 triggers investigation before any banking. It proves the env switch is the
   variable for MUL_MAT_ID; the MUL_MAT repair half rests on arm 2 alone (declared).
4. **Q_ppl-ship**: LFM2.5-2.6B QAD-Q4_0 (host sha
   `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`, 1 593 894 944 B,
   `~/kalsa-models/LFM2.5-2.6B-QAD-Q4_0.gguf`), corpus `wiki.test.raw` (1 290 590 B, sha
   `173c87a53759e0201f33e0ccf978e510c2042d7f2cb78229d9a50d79b9e7dd08`, the q41/q43/q55
   corpus). Device sha must equal host sha: a corpus mismatch voids arms 4–6 (all PPL
   arms need the same corpus); a ship mismatch voids arm 4 only (METHOD-VOID).
   HTP invocation: `llama-perplexity -m ship.gguf -f wiki.test.raw --device HTP0 -ngl 99
   -c 2048 -b 2048 -ub 1024 -fa on --chunks 32 -t 8 [--load-mode none if supported]`
   with `GGML_HEXAGON_VERBOSE=1` (stdout+stderr in one log, tee'd on device).
   Execute-op proof: ≥ 1 `HTP0 execute-op MUL_MAT` line; hybrid lfm2: shortconv layers
   may stay on CPU — the split (device offload lines) is reported. **Proof absent →
   METHOD-VOID for that arm** (no PPL number banked; PASS/GREY/FAIL impossible), per
   q55's "proof lost → VOID" rule. KV placement (device vs host) recorded from the load
   lines for every arm.
   CPU invocation: same flags with `-ngl 0`, no `--device`, no VERBOSE, `-t 8` fixed,
   no cpu-mask (n_threads recorded; the 211/1512 t/s anchors were `-t 6 --cpu-mask 0xfc
   --cpu-strict 1` — non-comparable for rate, PPL values unaffected). The CPU arm keeps
   the same HTP env (recorded); proof of no HTP compute = the load lines record
   `n_gpu_layers = 0` / all layers on CPU AND no HTP device appears in the offload
   lines (both quoted); execute-op lines cannot appear (VERBOSE unset) and are not
   evidence either way.
   `r = PPL_HTP / PPL_CPU − 1` over the same 32 chunks, anchored on the tool's final
   summary line (`Final estimate: PPL = x +/- y`) and cross-checked against the last
   per-chunk `[32]` running line; both quoted verbatim. If the last chunk index < 32
   (corpus too small after tokenization), that is a declared deviation (record n): a
   final estimate at n < 32 banks as characterization and does NOT satisfy the
   "PASS (32 chunks)" closure condition.
   **PASS ≤ 2 %, GREY 2–5 %, FAIL > 5 % or NaN.** Structural failures are not
   numerical FAILs: an arm that dies before its first per-chunk PPL line is printed
   (OOM, flag parse, load failure) is METHOD-VOID (structural). **Precedence**: an HTP
   arm that exits non-zero at ANY point after its first per-chunk line (DSP error →
   status FAILED, abort) banks FAIL regardless of its running PPL; the n ≥ 8
   running-PPL fallback applies ONLY to thermal-SKIP / time-CAP stops where both arms
   executed (common chunk exists) — then it is a characterization at the last COMMON
   chunk present in both captured logs (record n), not a certification.
5. **Q_ppl-olmoe**: OLMoE all-Q4_0 requant (sha
   `9d0b90c60a5b4732ba1faeb0b8940523173bf7e2a7f038d5753ce3ac24b98618`, 3 928 038 208 B;
   the #44/#45 file), same flags, same rules; proof = ≥ 1 `HTP0 execute-op MUL_MAT_ID`
   on `ffn_*_exps`. Device sha mismatch = METHOD-VOID this arm. This is the
   experts-on-NPU correctness the v79 lane needs.
6. **Q_ppl-qwen** (only if elapsed < 18 min at trigger): Qwen3.5-4B Q4_0 requant (sha
   `f1635f9c30430dadae1230ee29047e70251a8926bb569a6eeae95db00ff4bd36`, the #45 file),
   same flags, same rules. Device sha mismatch = METHOD-VOID this arm.

**Time budget** (anchors with their flag basis): kit 11 MB ~5 s; ship upload 1 520.0 MiB
= 69 s @ 22 MiB/s / 81 s @ #44-measured 18.8; OLMoE upload 3 746.4 MiB = 170–199 s (use
3.3 min); ops arm 2 ~2 min (generous vs #45 actual) + control ~1 min; PPL 65 536 tokens
(= 32 × 2048, valid iff the corpus tokenizes ≥ 65 536 tokens — the `[32]` line is the
proof): ship CPU 211 t/s anchor (6-thread masked; cell runs -t 8 unmasked — assume
±30 %) ≈ 4–7 min, ship HTP 1512 t/s ≈ 0.75 min; OLMoE CPU 200 t/s (default-flag anchor,
±30 %) ≈ 4–7 min, OLMoE HTP 845.9 t/s VERBOSE (#44 measured; 863 is the non-verbose
number) ≈ 1.3 min; + device sha256 of 5.5 GB ~1 min, + gates ~1 min. Nominal sum
≈ 24–25 min → Qwen dropped in practice (declared); hard cap 30 min. If OLMoE CPU PPL is
cut by the cap → n ≥ 8 characterization per the precedence rule.

## Decision rule (pre-written)

- **Judge repaired** iff ALL hold: arm-2 banner present; `recopy_lines = executed` on both
  op classes (and = 0 in arm 3); `judge_nonfinite = 0` on both op classes; `ok > 0` on
  both op classes; `other = 0`; conservation totals match (1470 / 812); HTP execution
  proof present; AND arm 3 (control) ran and shows
  `judge_nonfinite = 301` on MUL_MAT_ID (investigation band 290–315). If arm 3 did not
  run (time gate), the repair verdict is **PROVISIONAL** and Session 1 D does NOT close.
  If `judge_nonfinite > 0` in arm 2 with the banner present, the q32 port is incomplete
  for v79 → METHOD-FAIL of the port (shapes quoted), no kernel language.
- **v79 defect list (real)** = `compute_failed` + `htp_nonfinite` + `real_fail` tests,
  shapes quoted verbatim. `patched-correct` for an op class iff `real_fail = 0` AND
  `htp_nonfinite = 0` AND `compute_failed = 0` AND `ok > 0` AND `other = 0`.
  INTERNAL-ERROR shapes (expected ≈ 36 on MUL_MAT: m=16 n=4..8 family + 7 outliers per
  #43) are the v79 work item, not a judge artefact.
- **Numerical certification** = Q_ppl-ship verdict on the SHIP model, 32 chunks, same
  corpus as every PPL gate of the campaign; Q_ppl-olmoe = the same for the experts-on-NPU
  lane. A PASS certifies the HTP-executed subset of the forward pass (hybrid split
  reported; shortconv and any KV-on-host paths are NOT exercised on HTP) on this corpus at
  -c 2048 / -ub 1024, prefill only, and nothing else.
- **Session 1 D closes on correctness** iff the judge is repaired (full, not provisional)
  AND Q_ppl-ship = PASS at 32 chunks. GREY or FAIL banks r but leaves D OPEN (discrepancy
  unresolved). VOID and n < 32 do not close. The ops defect list stays open as its own
  item: every report says "D OPEN on ops correctness" whenever `compute_failed +
  htp_nonfinite + real_fail > 0`.

## What this cell cannot say (binding)

Nothing about v73/v75; nothing about K-quant experts (KEXP) — HTP reads Q4_0-family /
Q8_0 / IQ4_NL / MXFP4 only; nothing about speed (PPL wall time recorded, not compared; the
t/s anchors above are budget inputs, not results); nothing about NPU decode/tg
correctness (PPL is prefill-only); nothing about context lengths other than 2048-chunked
or batch geometries other than -ub 1024; nothing about KV-cache numerics on HTP
(placement recorded, not varied); nothing about the governor/app; nothing about sustained
thermals or energy. HVX 28c stays frozen (q63 PASS rule §8 unchanged).

## Outputs

`raw/` (every log incl. `EXIT=` lines, `*.adb.exit`, device-side PPL tee files pulled,
thermal pre/post per invocation, sha files, kit verify capture, `list_devices.txt`,
`perplexity_help.txt`, `events.txt` (gate + skip + crash + flag-check events),
`running.txt`), `census.awk` output per ops log (`*.census.txt`), `REPORT.md` (numbers
only, quotes raw), `AUDIT.md` (hostile, different model from the report writer), then
PLAN STATO CORRENTE + ALIVE row 30 + PLAN-10DAYS addendum in the SAME commit as the
bank.
