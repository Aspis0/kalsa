# Audit of REPORT.md (s23-native-gpu-bench)

Independent read-only audit, 2026-09-21. Every claim below was checked against the raw files in
`raw/`, the worktree at `/Users/marco/Projects/kalsallama-wt-1068` (commit `1068eb03d`, clean,
detached HEAD verified via `git worktree list`), and the archive under `scratchpad/`. All derived
numbers (integrals, medians, percentiles, counter deltas, maxima, ratios) were recomputed from the
CSVs, not taken from the report.

## Can the headline numbers be quoted?

**Yes for the speed ratio and the GPU-side energy figure, with stated caveats; no for anything CPU-side
on energy, and no for the watts line as written.** The 8.2x prefill ratio (75.38 +/- 2.55 vs 9.19 +/-
0.62 t/s, pp256, `-fa 0` on both arms, same model file, same binary `1068eb03d (11194)`, same 6 threads)
reproduces exactly from the raw bench outputs and is safe to quote as a measured short-window prefill
ratio on this phone, noting it was taken at unmatched token counts (r=4 vs r=60) and that the hotter
arm was the GPU. The GPU energy figure 5.4-5.6 mAh/1000 prefilled tokens reproduces exactly from two
independent meters agreeing to 4.3 percent and is safe to quote as *charge* (mAh), not energy (mWh):
voltage was sampled once per arm, not integrated. The CPU-side energy must not be quoted as a number:
the coulomb counter never moved in the CPU window and the integral (24.4 mAh/1000, load-inclusive) is
uncalibrated at low currents, so only the report's own "< 54.9 mAh/1000" bound and "at least ~4x
cheaper per token" framing survive, both properly labeled. The "~0.8 W CPU vs ~6.4 W GPU" line should
not be quoted as-is: the two watts use different statistics (see B5). The 89.5 C CPU-cluster peak
belongs to the **GPU arm**, not the CPU arm. Q3's divergence is real and quotable as "CPU and GPU
greedy outputs diverge from the 7th generated token"; the specific token ids 355/677 and the equation
with the archive's "index 7" carry the caveats in C.

## Verdict summary

| item | verdict |
|---|---|
| A. the 8.2x | CONFIRMED (GPU-arm evidence is physics + flags, not dispatch logs; unplugged not directly evidenced) |
| B. the energy | PARTIAL - GPU arm PROVEN, CPU arm unresolved exactly as the report labels it; two nits sharpened |
| C. the divergence | PARTIAL - divergence PROVEN from raw text; token ids and archive-index equivalence not independently verified |
| D. the guard | CONFIRMED (two line-number citation offsets noted) |
| E. the two brief corrections | CONFIRMED (both); plus three citation-level findings, see E3-E5 |
| F. housekeeping | PARTIAL - shared build dir CONFIRMED untouched; phone-side claims have no archived evidence |

---

## A. The 8.2x - CONFIRMED

**Same everything.** Both arms ran through the same `runarm.sh` with the hardcoded `-fa 0`
(`raw/runarm.sh:14`), the same model path `/data/local/tmp/llamabench/LFM2.5-2.6B-Q4_K_M.gguf`,
`-p 256 -n 0 -t 6`, differing only in `-ngl 0` vs `-ngl 99` (`raw/q2/cpu4.meta`, `gpu4.meta`). Both
`raw/q2/cpu4.out` and `gpu4.out` self-report `build: 1068eb03d (11194)` and end `BENCH_EXIT=0`. The
bench table shows `fa 0` on both rows and `ngl 0` / `ngl 99`. Recomputed ratio: 75.38/9.19 = 8.20x.
Recomputed stats from the CSVs: CPU median current -73 mA (report says -71; sorted[54] of 108 is -71,
true median -73 - immaterial), p10 -355 (matches, index int(0.1*n)); GPU median -1535, p10 -1696
(exact match).

**Was the GPU arm really on the GPU?** There are no dispatch/split/offload lines in the arm logs
(llama-bench is quiet), and the `backend` column is worthless as evidence: it prints "OpenCL" for
BOTH arms because `llama-bench` lists all registered non-CPU backends regardless of ngl
(`tools/llama-bench/llama-bench.cpp:1573-1587` in the wt-1068 tree). The affirmative evidence is
physical and consistent: 8.2x speed on an identical build, median draw 1535 mA (~6.5 W) vs 73 mA,
GPU-only thermal zones (33-40) reaching 81.6 C during an ngl=99 arm while the battery rose 9.2 C in
268 s (`raw/q2/gp.csv`, gp.meta), against 0.2 C net over 466 s for the CPU arm. A CPU-fallback arm
cannot produce this signature. CONFIRMED as indirect but strong.

**Unplugged.** No raw file records plugged state (no `dumpsys battery` status lines archived). Every
sampled current in every arm CSV is negative or a tiny blip (max +22 mA across cpu4, +7 gpu4,
+10 cal), i.e. discharging, never charging. Consistent with unplugged; not directly evidenced.

**Thermal comparability and the 89.5 C.** Battery start: CPU arm 31.0 C, GPU arm 29.4 C (gpu4.meta) -
comparable, GPU slightly cooler. The **89.5 C CPU-cluster (thermal_zone6) peak occurred during the
GPU arm**, 69 percent into it (`gpu4.csv`); the CPU arm peaked at 78.6 C (tz5, 76 percent in,
`cpu4.csv`). So the CPU arm was NOT the throttled arm, and there is no evidence the 8.2x is inflated
by CPU throttling - if anything the GPU arm ran hotter. Caveat: no clocks were sampled, so mild
throttling of the CPU arm at 78.6 C cannot be excluded; the CPU t/s spread (+/-6.7 percent) is small
and llama-bench times compute only, excluding the ~5 min load phase. The report's own caveat that a
matched-token-count run was not done is correct.

Minor: the report's "clean unsampled `-r 3` run took 402 s wall" has no matching raw record -
`cpu3.out` shows `Killed`, `BENCH_EXIT=137` (OOM kill), and cal.csv spans 326 s. Unverified color;
nothing load-bearing rests on it. Also `raw/q2/cpu4.tmp`, cited in section 3, does not exist in raw/.

## B. The energy - PARTIAL (GPU PROVEN, CPU unresolved, as labeled)

**B1. The two meters.** Both are software reads, not a bench instrument: (1) the fuel-gauge coulomb
counter via `cmd battery get counter` (uAh, `sampler.sh:9`), and (2) `cmd battery get current_now`
(mA, `sampler.sh:8`) integrated over time. Voltage comes from `dumpsys battery`, read ONCE per arm
(`sampler.sh:14-15`: 4241 mV CPU arm, 4232 GPU arm). Note the four sysfs nodes in the brief were
root-only; `cmd battery` was the shell-accessible substitute, exactly as the report says.

**B2. The GPU figure reproduces exactly.** Counter 3333750 -> 3247500 uAh = 86.25 mAh (gpu4.csv).
Trapezoidal integral of current_now over actual timestamps = 82.5 mAh (recomputed). Agreement 4.3
percent ("within 5 percent" holds). Per 1000 tokens: 86.25/15.36k = 5.62 (counter), 82.5/15.36k =
5.37 (integral), second GPU arm 41.25/7.68k = 5.37 (gp.csv: 3221250 -> 3180000). The report's
5.4-5.6 band is honest. It is mAh, not mWh - a constant-voltage assumption is embedded in any watt
figure; fine for same-session ratios, worth saying when quoting.

**B3. "CPU counter never moved" is an instrument failure in that window, not a law.** The counter
sat at exactly 3397500 for all 108 samples over 466 s while the integral says ~25 mAh flowed. The
report's explanation ("one 56.25 mAh fuel-gauge quantum not reached") is supported by cal.csv, where
the counter moved exactly one step of 56250 uAh after 82 samples - but it is contradicted elsewhere
in the same session: within the GPU arm the counter moved 86250 uAh (1.53 quanta), and between-run
gaps moved 26250-63750 uAh; the GCD of all observed deltas is 750 uAh. So the counter is not
quantized at 56.25 mAh; it updates lazily and unevenly. Consequence: the "< 54.9 mAh/1000 from the
counter" bound (56.25/1.024) rests on a quantum model the session's own data violates, and should be
quoted, if at all, as "counter did not resolve" rather than as an upper bound. The integral (24.4
mAh/1000, load-inclusive) is the only usable CPU figure, and its accuracy at ~70-300 mA currents is
uncalibrated: cal.csv shows the two meters disagreeing 3.7x at exactly those currents (the counter
jumped 56.25 mAh where the integral accumulated ~15 mAh), and the archive retraction quoted in the
report says the same. Which meter was wrong in cal.csv is unknown; the GPU-arm agreement validates
the pair only at ~1.5 A. **How much is solid: the GPU number (both meters), and the sign and rough
size of the GPU-vs-CPU gap (at least ~4x per token). Nothing more precise on the CPU side.** The
report already labels the CPU figure NOT VERIFIED; that label is correct and must survive into any
product use.

**B4. Temperatures reproduce.** CPU arm battery 31.0 -> max 31.7 (end 31.2; the report's arrow uses
max, not end - minor), GPU arm 29.4 -> 38.6 (end = max), gpuss probe 36.8 -> 81.6 C (gp.csv), CPU-zone
maxima 78.6 (cpu4) and 89.5 C (gpu4). Per-1000-token battery rises +0.68 (CPU, using max) vs +0.60 C
(GPU) recompute correctly. Caveat the report glosses: battery temperature is a lagging signal and the
CPU arm ended cooler than its own peak; per-token battery-delta "similarity" depends on choosing max
over end, and matched-token arms were not run (report says so).

**B5. The watts line mixes bases.** "~0.8 W CPU" does not follow from the quoted median (-71 mA x
4.241 V = 0.30 W); it matches the integral-derived mean (~193 mA x 4.241 V = 0.82 W). "~6.4 W GPU"
matches the median (-1535 x 4.232 = 6.50 W). Mean-vs-mean would be 5.7x, median-vs-median 21x; the
report's "about 5x" matches neither quoted statistic. Do not quote this line without restating the
basis; the energy-per-token comparison in B2/B3 is the load-bearing result and is unaffected.

## C. The divergence - PARTIAL

**Protocol is clean.** `raw/q3.sh` shows one COMMON flag string for both arms: same model path,
`-fa 0 -st -n 32 --temp 0 --top-k 1 --seed 42 -t 6`, only `-ngl 0` vs `-ngl 99`; both transcripts
(`q3_cpu.out`, `q3_gpu.out`) self-report `build : b11194-1068eb03d` and exit 0. Greedy sampling
confirmed (temp 0, top-k 1).

**The divergence itself is PROVEN from raw text.** `cpu_completion.txt` reads "The user is asking for
the capital of France..." vs `gpu_completion.txt` "The user has provided an incomplete sentence...".
Common prefix "[Start thinking]\n\nThe user " is exactly 27 characters; the texts diverge at the 7th
generated token (" is" vs " has"). Identical tokens 0-5 followed by divergence at 6 is the classic
near-tie flip shape, consistent with the report's framing.

**Token ids not independently verifiable.** The `llama-tokenize` outputs establishing ids
[67, 10520, 6416, 64197, 597, 4695, ...] and 355/677 are NOT archived in raw/ (no transcript file).
The ids are textually self-consistent (355=" is" and 677=" has" fit the completions; 374=" for",
278=" the" continue the CPU text correctly), but no host gguf or host tokenizer exists here to
re-verify, and the on-device run left no artifact. Quote the divergence by position and text; treat
the numeric ids as author-asserted.

**Index base and archive comparability.** The report says "index 6 (0-based)" - internally consistent
with the quoted id lists (six common tokens). The archive's PREREG says the strict oracle "FAILs on
Adreno 732/735/750 at index 7" (`scratchpad/agents/logit-oracle/PREREG.md:8`) but does not state its
indexing convention on that line. If the archive's is one-based (as the report asserts), index 7
one-based = index 6 zero-based = the same 7th token, and this run lands exactly where the archive's
did; that reading is plausible but UNVERIFIED from the archived text. Beyond the index, note the
archive's finding was on a different model, prompt and builds; "consistent with" is the right
strength, and the report uses it - but "same phenomenon" is not established, only "same class:
early near-tie divergence in greedy CPU-vs-GPU prefill".

## D. The guard - CONFIRMED

All verified in `/Users/marco/Projects/kalsallama-wt-1068` at `1068eb03d` (clean worktree, HEAD =
1068eb03d301a1dc..., so file lines = committed lines):

- The refusal exists in `ggml_opencl_supports_op` (defined `ggml-opencl.cpp:9497`), FLASH_ATTN_EXT
  case (`:9856`). The quoted comment is at `:9893-9901`; the executable refusal
  `if (backend_ctx && backend_ctx->adreno_gen == ADRENO_GPU_GEN::A7X && (is_f32_f16 || is_f32_q8_0 ||
  is_f32_q4_0)) return false;` is at `:9903-9906`. The report's ":9893" cites the comment block;
  off by 10 lines from the `if`. Content matches the report's quote (the report rendered the source's
  em-dash as ASCII).
- A7X-keyed on GPU generation, not driver string: `get_adreno_gpu_gen` returns A7X for device names
  containing exactly "730", "740", "750" - at `:299-303`, not ":293-297" as the report cites
  (6-line offset; content correct). Fall-through returns `ADRENO_UNKNOWN` at `:320`. "732"/"735"
  match none of the strstr literals, so the guard does not fire on those parts. CONFIRMED.
- Introduced 2026-08-20: `6503355df` ("opencl: fix q6_K flat mul_mat for Adreno A6x/A7x GPUs with
  older E031 compilers", Aug 20 10:58 2026) and the cherry-pick `5c7e16fa6` (same date) both add it;
  both predate `1068eb03d` (Sep 21 15:33 2026), and `git show 1068eb03d:...ggml-opencl.cpp` contains
  the identical block. CONFIRMED.
- Reason no engine run compiled FA: the filtered run attempted zero f16/f16 cases
  (`raw/q1_f16f16.out`: "0/0 tests passed", 2559 "not supported [OpenCL]" lines, exit 0), and the
  `-fa 1` engine runs show `flash_attn = enabled` with no FA compile (`q1_bench_fa.out:827`,
  `q1_fa2.out:842,1779,2720`, `q1_olmoe.out:640`). Meanwhile f32/f32 FA does compile and pass
  (224 OK cases at hsk=64 in `q1_flash.out`) - consistent with the guard refusing only the
  KV-convert variants. CONFIRMED.
- Verdict cache cannot carry a SIGSEGV: `cl_program_cache_save_verdict`
  (`ggml/src/ggml-opencl/cl-program-cache.cpp:476`) writes an ok/fail text verdict after a returned
  build result; `1068eb03d`'s only fatal-path change is `fatal=true` -> `fatal=false` (one hunk,
  verified in `git show 1068eb03d`), which applies to returned CL errors only. A signal raised inside
  `clBuildProgram` kills the process before any verdict write. CONFIRMED. The probe transcripts
  (`raw/pA-pJ`, `probeA-D`) show exactly this: `[step] calling clBuildProgram` then `Segmentation
  fault` for `flash_attn_f32_f16.cl` at DK=40/64/256 with and without every option combination,
  while `flash_attn_f32.cl`, `flash_attn_pre_f16.cl` and the trivial kernel build err=0 (pE, pG,
  pT1-pT3). probe_cl.c is unbuffered (`setvbuf ... _IONBF`), so the last printed step is the last
  executed step, as the report claims.

Two counting nits in section 2.2, neither load-bearing: the itemized pass breakdown
(224+1+1+1+1) sums to 228, not 229 - the harness's own "229/229" total stands, and an exact
per-case enumeration is obscured by stderr interleaving (226 case lines end in OK, 4 more OK
results are detached from their case lines); and the f16/f16 case header at `q1_flash.out:292`
appears, via interleaving, to have compiled `fa f32` but its own result is "not supported
[OpenCL]" - the report's "every f16/f16 case refused" reading is correct.

## E. The two corrections to the brief - CONFIRMED (both)

**E1. Correction (i): the archived `loadprobe_FAcrash` is a 732 run.** The loadprobe file itself
contains no device banner (it died at 0.18 s, before/during init), so the attribution is
campaign-level: same device serial (sa801864) and session as `raw/tbo_mm_sa801864.out:3-4`, which
prints `QUALCOMM Adreno(TM) 732 (OpenCL 3.0 Adreno(TM) 732)` with driver `...Compiler
E031.45.02.16` (`:6`) - a different compiler from this S23's `E031.41.03.62`. The campaign report
states the GPU is Adreno 732 "from the OpenCL banner in every bench output"
(`scratchpad/agents/qdc-7pg3-govbench-52/REPORT.md:10`), headlines "Adreno 732" at `:17`, and
"FLASH_ATTN kernels do NOT compile on Adreno 732" at `:28` - both cited line numbers are exact.
CONFIRMED.

**E2. Correction (ii): it crashed on 2026-09-03 despite the guard existing.** File birth/mtime Sep 3
2026 05:34 (verified via stat). The kit's source commit is 5c3979438
(`qdc-7pg3-govbench-52/PREREG.md:35-36`), binaries self-report `build: 5c3979438 (10050)`
(`raw/bench_gpu_sa801864.out:10`). In git: `5c3979438` (Aug 29, kalsa/governor-v0) DOES contain the
A7X guard - it arrived via cherry-pick `5c7e16fa6`, which is an ancestor (verified
`git merge-base --is-ancestor` and `git show 5c3979438:...ggml-opencl.cpp` contains the guard
comment) - and does NOT contain the Jul 15 `flash_attn_f32_f16.cl` fix (neither `9463b3aa8` nor
`c3d47e696` is an ancestor; the kit's copy of the .cl lacks the `#define sub_group_shuffle_xor`
shim). That is exactly consistent with the log: the guard allowed the case (732 falls through to
UNKNOWN), the old source failed compilation with "implicit declaration of 'sub_group_shuffle_xor'"
plus ambiguous `max` (err=-11, caught and logged), then a 1,804,626,176-byte allocation failure,
then segfault, `exit=139` (`raw/loadprobe_FAcrash_sa801864.out:3,19-25`). CONFIRMED: guard present,
did not fire, on a 732, on 2026-09-03.

**E3. The report's "exit 139 -> 134" is a different archived event.** The Sep 3 loadprobe records
exit=139 only. The "139 then 134" record is the S23 740's own August abort
(`scratchpad/agents/archive-gpu-docs/REPORT.md:376-379`, citing `reports/moe-gdn-k2-e2e.md:81, :164`;
again at `:455` for the 732's 139, and `:662`). Section 2.1's sentence "the run that the archive
recorded as exit 139 -> 134 now returns exit 0" therefore stitches together two distinct archive
records (the 740's August abort and the 732's Sep 3 loadprobe). Both records exist and both are FA
failures, so the section's substance survives, but the conflation should be cleaned up before the
report is quoted on history.

**E4. A dangling citation.** Section 3 cites "`moe/docs/ALIVE.md:410`, 'Charge-counter energy
inconclusive (5.3x spread on identical work - do not cite)'". No `moe/docs/ALIVE.md` exists in this
workspace; `docs/ALIVE.md:410` here is unrelated text. The quoted substance DOES exist in the
archive, verbatim, at `archived/ALIVE-2026-09-full.md:448` (the q57 B/C entry, 25/08). Content
CONFIRMED, citation wrong - repoint it.

**E5. Context the report omits (does not invalidate it).** The same archive
(`archive-gpu-docs/REPORT.md:662-667`) records that a QDC HDK8550 Adreno 740 with compiler
`E031.41.03.56` PASSES FLASH_ATTN_EXT 229/229, leaving an unreconciled compiler micro-version
question (.62 vs .56) for the 740. This run's driver-level SIGSEGV probes were on .62, so the
report's own conclusions stand; anyone quoting "the 740 cannot build f32_f16" should scope it to
the .62 compiler until that is reconciled.

## F. Housekeeping - PARTIAL

- **Shared `build-android-ocl` untouched: CONFIRMED** by mtime evidence - no file under
  `/Users/marco/Projects/kalsallama/build-android-ocl` is newer than 15:35 today, while every s23
  session artifact is 17:48 or later; the dir was last modified 15:20, before commit `1068eb03d`
  (15:33) even existed.
- **Worktree left in place: CONFIRMED** (`git worktree list` shows `kalsallama-wt-1068` detached at
  `1068eb03d`).
- **Never plugged in: not directly evidenced.** No `dumpsys battery` status output is archived. All
  sampled currents in all arms are negative (discharge) with blips no higher than +22 mA, which is
  consistent with battery operation and inconsistent with charging, but it is inference, not a read.
- **No device setting changed (`screen_off_timeout` 30000): UNVERIFIED.** No transcript of a settings
  read/write is archived. The four archived scripts (`sampler.sh`, `runarm.sh`, `gpuss_arm.sh`,
  `q3.sh`) contain only reads and writes under `/data/local/tmp/s23gpu`, so the automated arms could
  not have changed a setting - but that proves nothing about the interactive adb session.
- **`/data/local/tmp` cleaned (rm -rf s23gpu, entry count back to 74, models untouched): UNVERIFIED.**
  No cleanup transcript or post-state listing is archived. Nothing in raw/ contradicts it either.
- Also unverifiable from raw (no build log archived): the "410/410 ninja targets", the binary
  sha256 table, and the "7 pre-existing warnings" claim. The load-bearing part - that the on-device
  binaries were built from `1068eb03d` - IS evidenced by the binaries' own `build:` lines in the raw
  logs. Two labeling slips: the report cites `raw/q2/cpu4.tmp` (does not exist) and calls
  `probe_cl.c` "9.6 KB" (the compiled binary `probe_cl` is 9608 bytes; the source is 2505 bytes).

## Bottom line

The report is substantially accurate and, unusually for a burst-and-summarize workflow, its numbers
reproduce from raw to the decimal where it claims they do (75.38/9.19, 86.25/82.5 mAh, 5.62/5.37,
41.25 mAh, 9.19+/-0.62, 75.38+/-2.55, 25.0/82.5 integrals, all maxima). The guard analysis (D) and
both brief corrections (E) are correct, including the subtle cherry-pick provenance of the guard in
the archived kit. Fix before any external quoting: the watts sentence (B5), the CPU counter
explanation (B3), the 139->134 conflation (E3), the ALIVE.md citation (E4), the two line-number
offsets and the 228/229 nit (D), and add the missing raw artifacts (tokenize transcript, plugged-state
and settings reads, cleanup listing) if housekeeping is to be claimed rather than asserted.
