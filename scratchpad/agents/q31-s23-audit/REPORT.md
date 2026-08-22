# Hostile read-only audit — session q31 (S23)

Scope: on-disk evidence only. No device/ADB access, reruns, git operations, or writes outside this report.

## Claim 1 — io-gate

Status: **CONFIRMED**.

- The six raw cells are exactly S R S R S R, all rc=0, with the declared 2000 blocks, 983040-byte block size, seed 14, and `odirect=1` (`results/io_gate/s23_ufs31/cell_01_seq.out:1`; c02–c06 likewise; six `.rc` files independently contain `0`). The declared order and parameters are also recorded in `results/io_gate/s23_ufs31/summary.txt:12-17`.
- Recomputing from the cell CSV: seq = `[411.284,452.654,430.223]`, median `430.223`; rand = `[435.851,406.625,371.546]`, median `406.625`; ratio `430.223 / 406.625 = 1.05803381494006`, displayed as `1.058`. The summary agrees exactly (`results/io_gate/s23_ufs31/cells.csv:1-7`; `summary.txt:1-7`).
- The raw cell lines identify a 1,966,080,000-byte read window and the same GGUF path (`cell_01_seq.out:1`; `cell_02_rand.out:1`; all six cells). Battery probes show AC/USB/wireless false, status 3, and 83% before and after (`results/io_gate/s23_ufs31/batt_pre.txt:2-3,10,13`; `batt_post.txt:2-3,10,13`). The summary records `plugged=NO` and 83%→83% (`summary.txt:17-19`).
- The PC tool hash and on-device binary hash are identical: `0f4a936d7d11472fa69a2f97ced14e4cdc3d95b5b981ee88044601c1707cca48` (`results/io_gate/s23_ufs31/sha256_pc.txt:1`; `sha256_device_iogate.txt:1`). The on-device GGUF probe records the full `b07c80870f8a864549f4a419ccbfb4d4282ba2d55a2e8d808b7c377d3fc6c3f4` hash (`sha256_gguf.txt:1`).
- Read-only is supported by the actual source, not merely by a comment: the tool opens the target with `O_RDONLY | O_DIRECT` and reads with `pread` (`results/io_gate/s23_ufs31/iogate_ufs4.c:62,107`); the driver script only invokes the binary against the file (`run_cells.sh:10`). No write/open-for-write operation appears in the tool source.

No arithmetic or protocol discrepancy was found in this claim. The result is a median over three sequential and three random point measurements, not a repeated-sample uncertainty estimate.

## Claim 2 — HTP v73 session and cross-device failure set

Status: **REFUTED as worded; the remaining subclaims are CONFIRMED**.

- The saved registration record is verbatim and directly supports the OneUI/PD claim: v73, the `error 0x14` URI failure, fallback to the single-session URI, hwinfo `threads 4, hvx 4, hmx 1, vtcm 8 MB`, and `PD: GRANTED` (`results/htp_smoke/s23_v73/hwinfo.txt:3-13`; the same runtime facts appear in `run1.err:1-8`). `run1.rc:1` is `1` because the backend-ops run had an ADD failure; it does not contradict the separately logged PD grant.
- Recounting the raw S23 run gives 486 `OK`, 70 `FAIL`, and 1007 `not supported` MUL_MAT case lines (`results/htp_smoke/s23_v73/run2.out:7-1642`). The saved summary agrees (`run2_summary.txt:1-7`), and the overall run rc is correctly `1` (`run2.rc:1`).
- The “all 70 FAILs show CPU=nan” statement is false. Only 44 of the 70 failure case lines contain `CPU=nan`/`CPU=-nan` (`results/htp_smoke/s23_v73/run2.out:34-1179`; `run2_summary.txt:4`). The other 26 failures do not carry that CPU-NaN signature; the report itself says `fail_cpu_nan=44 of 70` and describes the remainder as huge-error failures (`scratchpad/agents/q31-s23-session/REPORT.md:166-175`).
- The cross-device case-name claim survives a hostile comparison. Extracting the complete `MUL_MAT(...)` argument string from every FAIL line in S23 and Xiaomi produced 70 lines / 63 unique signatures on each side and zero multiset differences, not merely equal aggregate counts (`results/htp_smoke/s23_v73/run2.out:34-1179`; `results/htp_smoke/xiaomi_v75/run2.out:34-1179`). This confirms identical failing case signatures as tested, while not proving identical numeric error magnitudes.

The correct wording is “44/70 failures have CPU=nan; the complete 70-case fail signature matches Xiaomi.”

## Claim 3 — prefill arms and scheduler proof

Status: **UNVERIFIABLE as literally phrased; core numbers and scheduler evidence are CONFIRMED**.

Arithmetic and configuration that are directly confirmed:

- The HTP JSONL contains pp512 samples `84.0324, 87.0257, 76.3374`, mean `82.465169`, JSON standard deviation `5.513803`; the CPU JSONL contains `22.6416, 26.1299, 24.0786`, mean `24.283394`, standard deviation `1.753151` (`results/htp_smoke/s23_v73/bench_htp.out:1`; `bench_cpu.out:1`). Independent recomputation gives mean ratio `82.465169 / 24.283394 = 3.395949...` -> `3.40`. The medians are 84.0324 and 24.0786, ratio 3.4899 -> 3.49. The summary agrees (`results/htp_smoke/s23_v73/bench_summary.txt:16-40`).
- Both timed JSON objects have `n_prompt=512`, `n_gen=0`, three samples, `build_commit=3f545bec`, and the same 4B model path (`bench_htp.out:1`; `bench_cpu.out:1`). The run summary explicitly records `n_seqs=1`, `reps=3`, and `pp512` configuration (`bench_summary.txt:4-8,18,32`).
- The PC and device model probes contain the same full SHA-256 `298fcb5fe7a77ccc79745ae24751560c5ac56874caff4bb39b1f2055bd72b8bb` and size 2,583,221,408 B (`results/htp_smoke/s23_v73/sha256_qwen4b_pc.txt:1-2`; `sha256_qwen4b_device.txt:1-3`). Both timed arms have rc=0 (`bench_htp.rc:1`; `bench_cpu.rc:1`).
- The HTP command is explicitly `-p 512 -n 0 -r 3 -ngl 99 -dev HTP0 --load-mode none --no-host 1 -fa on --ubatch-size 1024` (`bench_htp.meta:1-6`); the CPU command holds p/n/r/load-mode/fa/ubatch constant and uses `-ngl 0` with no HTP device (`bench_cpu.meta:1-3`).

Scheduler proof:

- The verbose proof contains the required HTP0-REPACK allocation (`1787.12 MiB`), `n_tokens=512, n_seqs=1`, 51 graph splits, and actual q4_0 MUL_MAT execute operations routed `HTP0-REPACK x HTP0 -> HTP0|hmx-tiled` (`results/htp_smoke/s23_v73/bench_proof3.err:2257,2693,30288,35187,35259`). The proof summary reports pp512, HTP0, `noh=1`, and build `3f545bec` (`bench_proof3.out:1-5`). The evidence is in `bench_proof3.err`, not in `.out`; the literal “bench_proof*.out must show” wording is inaccurate, but the saved proof itself is strong.
- The no-`--no-host 1` runs are not missing. `bench_proof.meta:6` and `bench_proof2.meta:6` omit that flag; their JSON outputs report `no_host=false` and pp512 `77.811017` and `91.872562` (`bench_proof.out:1-2`; `bench_proof2.out:1-2`), both rc=0 (`bench_proof.rc:1`; `bench_proof2.rc:1`). Their complete 13-line verbose stderr captures contain zero `execute-op` lines (`bench_proof.err:1-13`; `bench_proof2.err:1-13`). This confirms the observed “no HTP execute-op with similar throughput” trap run. It does not, by itself, prove every operation executed on CPU: the JSON still labels the backend HTP/HTP0 and the raw logs do not contain a positive CPU-execution trace. “Silent no-HTP/fallback behavior” is supported; “CPU fallback” is an inference.

Unplugged state is directly recorded for the pre-bench and pre-registration probes (`results/htp_smoke/s23_v73/batt_pre_bench.txt:2-3,10,13`; `batt_pre_run1.txt:2-3,10,13`), and the summary says `plugged=NO` (`bench_summary.txt:8`). There is no separately timestamped CPU-arm pre-battery file, so “unplugged both arms” is session-level evidence rather than two independent arm snapshots.

## Hostile extras

- **Mean versus median:** the HTP mean `82.465169` is arithmetically valid for three pre-existing repetitions, and the reported `5.513803` is the sample standard deviation. But `76.3374` is the low outlier: HTP median is `84.0324`, the min/max span is `10.6883 tok/s`, and mean and median differ by `1.5672 tok/s`. The table should retain mean±sample-SD for transparency but also show median and the full three-value spread; a median-only headline would be more robust, not a license to discard 76.3. CPU similarly has mean `24.283394`, median `24.0786`, sample SD `1.753151`. (`results/htp_smoke/s23_v73/bench_htp.out:1`; `bench_cpu.out:1`; `bench_summary.txt:16-19,30-33`.)
- **No silent exclusion in the timed samples:** each timed arm has one JSON object containing all three `samples_ts`, and the summary repeats all three values (`bench_htp.out:1`; `bench_cpu.out:1`; `bench_summary.txt:16-19,30-33`). The proof1/proof2 runs are separate scheduler diagnostics, not hidden replacements for timed samples. However, the report’s initial CPU-link failure experiment is not separately archived under a named raw file; only the successful `bench_cpu` run and rc=0 are present. That failed-attempt narrative is therefore UNVERIFIABLE from the supplied raw directory.
- **Battery floor:** the recorded endpoints support 83% session start and 80% final level, with unplugged/discharging probes and no recorded value near the 40% floor (`results/io_gate/s23_ufs31/batt_pre.txt:2-3,10,13`; `results/htp_smoke/s23_v73/batt_pre_bench.txt:2-3,10,13`; `bench_summary.txt:8-14,30-39`). This confirms the recorded floor compliance, but the archive is not a continuous battery trace.
- **The “6.1G free” note is not raw-backed here:** neither supplied raw directory contains a saved `df /data` result or a `6.1G`/`6.2G` filesystem-free line. The only related raw lines say HTP “Device memory: 0 MB (0 MB free)” (`results/htp_smoke/s23_v73/run2.out:5`), which is a backend-reported device-memory field and not host `/data` free space. The session report’s 6.1G/6.2G statements (`scratchpad/agents/q31-s23-session/REPORT.md:25,191`) are therefore UNVERIFIABLE from the stated raw evidence.
- **Cross-arm comparability:** both timed commands use the same model, build, p512/n0/r3, load mode, flash-attention, and ubatch settings (`bench_htp.meta:1-6`; `bench_cpu.meta:1-3`), and neither timed command includes `--no-warmup`. That establishes command-level symmetry, but no raw file records the internal warmup count, so “same warmup” is not independently verifiable. The arms were run sequentially: HTP JSON time is 21:53:11Z and CPU is 21:55:18Z (`bench_htp.out:1`; `bench_cpu.out:1`); HTP post temperature is 28.6 C while CPU post is 30.1 C (`bench_summary.txt:12-14`), and there is no CPU pre-temperature file. The 3.40× mean ratio is valid for the recorded configurations, but not a perfectly interleaved thermal comparison. Also, the HTP result is a hybrid 51-split graph, not a pure-NPU dense-4B result (`bench_summary.txt:26-28`; `scratchpad/agents/q31-s23-session/REPORT.md:215,243`).

## Verdict

Claim 1: **CONFIRMED**.

Claim 2: **REFUTED as written** because “70 FAILs show CPU=nan” is false; the exact corrected subclaim is 44/70 CPU-NaN failures, with the complete 70-case failure signature matching Xiaomi.

Claim 3: **UNVERIFIABLE as literally phrased** because the core numbers and HTP scheduler execution are confirmed, but the CPU-fallback mechanism, separate CPU-arm pre-battery capture, and exact internal warmup equality are not directly proven. The no-`--no-host` diagnostic runs do exist and show zero captured HTP `execute-op` lines.

**BANK-WITH-CORRECTIONS** — bank the io-gate result, corrected HTP failure-set comparison, and scoped pp512 performance/scheduler result; correct the universal CPU=nan wording, present median plus spread alongside the HTP mean, and label filesystem-free, fallback-mechanism, and warmup claims according to the raw gaps above.
