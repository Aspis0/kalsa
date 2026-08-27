# q67 — q63's Candidate 1 (IQ4_NL-M) on HTP v75: load + correctness characterization + pp512 spike — PREREG

**Status: LOCKED at commit time (orchestrator, 2026-08-27 morning). Owner delegated device use
("Ok mentre aspetti q63 hai il galaxy s23 staccato e lo Xiaomi attaccato. Decidi te").
Motivation: the Xiaomi (only v75 device) becomes unavailable ~28/08 for 10 days; q63's C1 has
passed the quality gate in preview on the PC, but nobody has shown the recipe actually loads and
executes on a real HTP. If it cannot, road D is moot regardless of PPL.**

## Question
q63's CANDIDATE_1.gguf (IQ4_NL base + Q8_0 on the tensors Q4_K_M promotes, all tensor types
HTP-readable on paper) — does it (1) load and execute on HTP0 (v75) with execute-op proof,
(2) produce HTP-vs-CPU numerics `r` within the q55 gate on the dense lane, and (3) what pp512
spike premium does it show vs CPU on the same file? This cell does NOT gate q63's quality bank
(PC PPL vs control); it gates the practical "HTP-readable" claim of road D.

## Device / build (frozen)
- Xiaomi houji (v75, 11.2 GiB MemTotal), serial `adb-625689a2-9xEOfw._adb-tls-connect._tcp`,
  **PLUGGED (AC, 47 % charging at recon)** — declared deviation from q55's unplugged runs; this
  is a load/correctness cell, not an energy cell; battery temp still governs the guard.
- Runtime: `/data/local/tmp/kalsahtp/` pinned q55 set (`llama-perplexity`, `llama-bench`,
  `libggml-htp-v75.so` + libs). sha256 of the two binaries recorded on device at run start into
  manifest (provenance = q55 pinned set; no rebuild, no re-push of binaries).
- Model: `CANDIDATE_1.gguf` from q63 (PC sha256
  `c54e95f8a8be9e444428fe89519be241bb4f15d3436e5864e4bd85ec54b9d89d`, 3 098 664 160 B), pushed to
  `/data/local/tmp/q67/CANDIDATE_1.gguf`, sha256 verified on device BEFORE any arm (mismatch →
  re-push once, then NOT-RUN). Not deleted afterwards (301 GB free; owner decides).
- Corpus: `/data/local/tmp/wiki.test.raw` — verified on device at recon, sha256
  `173c87a53759e0201f33e0ccf978e510c2042d7f2cb78229d9a50d79b9e7dd08` (same corpus as q63 wiki cell).
- Env (HTP arms, as q55/q48): `LD_LIBRARY_PATH=/data/local/tmp/kalsahtp:/vendor/lib64:/system/vendor/lib64:/system/lib64`;
  `ADSP_LIBRARY_PATH=/data/local/tmp/kalsahtp`; `CDSP_LIBRARY_PATH=/data/local/tmp/kalsahtp`;
  `GGML_HEXAGON_NDEV=1`; `GGML_HEXAGON_HOSTBUF=1`; `GGML_HEXAGON_VERBOSE=1`. CPU arm: same env
  retained (q55 convention, recorded). All arms from `adb shell` (cpuset 0-7, verified via
  `/proc/<binary_pid>/cpuset` per [[cpuset-gate-every-harness]]), never Termux. Host side
  `MSYS_NO_PATHCONV=1`.

## Guard limits (hard)
q56-class guard, poll 10 s, on battery temp. NPU arms: WARN 40.0 / **KILL 41.0 °C**, wall cap
**10 min** (kill at cap = datum, not stop). CPU arms: WARN 40.0 / KILL 43.0 °C. Battery ≥ 40 %.
Cool start ≤ **35.0 °C** battery temp before each arm (plugged idle runs warmer than q55's
unplugged ≤ 32; recorded); if above, wait ≤ 15 min then NOT-RUN. `MemAvailable ≥ 4.0 GiB`
pre-arm (no processes closed to get there — below floor → NOT-RUN, record). Battery level +
temps pre/post every arm.

## Arms (order frozen; N = 1 per arm — characterization cell)
- **A1 HTP correctness**: `llama-perplexity -m /data/local/tmp/q67/CANDIDATE_1.gguf -ngl 99
  -dev HTP0 -c 2048 -b 2048 -ub 1024 -fa on --load-mode none --chunks 32 -nkvo -v` (running-PPL
  log captured; -nkvo per the q55 dense-lane characterization).
- **A2 CPU-ref**: same flags, `-ngl 0`, no `-dev`, `-t 8`, `--chunks 32`, `-nkvo` kept for
  symmetry.
- **B pp512 spike** (after A, if no stop event): `llama-bench -m .../CANDIDATE_1.gguf -p 512
  -n 0 -r 2 --no-warmup -t 8 -fa on --load-mode none -o jsonl`, order NPU then CPU (NPU adds
  `-ngl 99 -dev HTP0 -v`), one invocation each, guard active.

## Frozen derivations
- **LOAD**: HTP arm completes ≥ 1 chunk with proof (execute-op lines on HTP0 > 0 AND attention
  execute-ops > 0, counted from the `-v` log as in q55/q53); loader tensor rejection, silent
  full-CPU fallback (execute_op_htp0 = 0), or a stop-rule signature → **FAIL-LOAD**.
- **r = PPL_HTP / PPL_CPU − 1** at the last common chunk n ≥ 8 (32 if both arms complete;
  record n). Gate as q55: **PASS ≤ 2 %, GREY 2–5 %, FAIL > 5 % or NaN**. Common chunks < 8 →
  VOID (describe what was seen, no gate letter).
- **B**: pp512 t/s HTP vs CPU on the same file (exploratory, first-sample + jsonl avg both
  reported), ΔT and MAX per arm.
- **Verdict wording (pre-declared)**: **HTP-VIABLE** (LOAD ok ∧ PASS — characterization, NOT a
  certification and NOT a ship decision), **HTP-GREY**, **FAIL-LOAD**, **FAIL-NUMERICS**.
  Consequence: HTP-VIABLE → q63 bank gains "recipe executes on v75 with r = <x> (n chunks)";
  FAIL-LOAD → road D blocked at the practical layer, number to the owner before any HVX talk.

## Stop rule (exact, case-sensitive substrings)
`CDSP0 CRASHED`; `dspqueue_read failed`; `dspqueue_write failed`; `INTERNAL-ERROR`;
`ggml_abort`; `GGML_ASSERT`; `Aborted`; `Segmentation`; workload rc ≥ 128 not caused by the
guard → record and STOP the cell, no retry. The benign `common_fit_params ... abort` warning is
not a stop. Any guard kill in an NPU arm → record and STOP (no retry), per q55.

## Hygiene
No deletions on device; all new files under `/data/local/tmp/q67/`. PC side: NO builds, nothing
heavy in parallel with the q63 PPL runner (the 3.1 GB adb push is I/O-light and allowed; one
push at a time). Outputs: `RUN_LOG.md` (timestamped), `manifest.json` (shas, device state,
battery/temps, exact commands, binary shas), `raw/` (running-PPL logs, execute-op counts, guard
CSV, jsonl, stderr), `REPORT.md` numbers only. Audit before bank (math = DeepSeek on r and
chunk arithmetic, doc = mimo, short form); bank alongside q63 (PLAN #35) or as its appendix.
