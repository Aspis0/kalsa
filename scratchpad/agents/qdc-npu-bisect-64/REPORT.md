# REPORT — Cell #64: v73 TLBMISS bisect isolates upstream #26049 (HDK8550)

Date: 2026-09-04; QDC cell #64, pure-upstream v73 kits, OLMoE Q4_0.
The declared probe is `up_ngl8`; `up_ngl99` is recorded only for the mapping
question (PREREG.md:1, PREREG.md:40-44).

## Verdict: **G1 — culprit found**

The first BAD hexagon commit after a GOOD commit is
`0a50d9909a3478e82679f505bf8595d1eee4b0a8`, upstream #26049,
“hexagon: further improved pipeline of the core bits (L2, DMA, MM, FA)”
(BISECT-LOG.md:16). Index 7 is GOOD and index 8 is BAD; the observed order is
monotone: GOOD at the pin, index 6, and index 7; BAD at indices 8, 9, and 12
(raw/022458a/up_ngl8_sa803224.out:3, raw/0278d83/up_ngl8_sa803231.out:3,
raw/c0bc859/up_ngl8_sa803245.out:3, raw/0a50d99/up_ngl8_sa803245.out:1,
raw/355303e/up_ngl8_sa803237.out:1, raw/990e3bf/up_ngl8_sa803224.out:1).

| step / index | commit and title | kit SHA-256 prefix | `up_ngl8` proof / exit | bisect signature | `up_ngl99` |
|---|---|---|---|---|---|
| 0 / pin | `022458a` — good endpoint | `e8f5cfd1…` (BUILDS.txt:4) | `n_exps_htp0=189`, exit `0` (raw/022458a/up_ngl8_sa803224.out:3) | — | exit `134`; mapping death, `mmap failed : va FFFFFFFF` (raw/022458a/logcat_up_ngl99_sa803224.txt:491-497) |
| 1 / 12 | `990e3bf` — FA HMX queue ordering (#27042) (BISECT.md:24) | `5306f3f8…` (BUILDS.txt:5) | `n_exps_htp0=21`, exit `134` (raw/990e3bf/up_ngl8_sa803224.out:1) | TLBMISS thread `work-queue:0`, Fault PC `0x20089E4C` (raw/990e3bf/logcat_up_ngl8_sa803224.txt:169,172) | exit `134`, `0x2e` (raw/990e3bf/up_ngl99_sa803224.out:1) |
| 2 / 6 | `0278d83` — activation ops update (#25974) (BISECT.md:18) | `e64a3697…` (BUILDS.txt:6) | `n_exps_htp0=189`, exit `0` (raw/0278d83/up_ngl8_sa803231.out:3) | — | exit `134`; mapping death, `mmap failed : va FFFFFFFF` (raw/0278d83/logcat_up_ngl99_sa803231.txt:448-456) |
| 3 / 9 | `355303e` — partial im2col support (#26007) (BISECT.md:21) | `dd9cd8dd…` (BUILDS.txt:8) | `n_exps_htp0=21`, exit `134` (raw/355303e/up_ngl8_sa803237.out:1) | TLBMISS thread `work-queue:2`, Fault PC `0x20089EEC` (raw/355303e/logcat_up_ngl8_sa803237.txt:631,634) | exit `134`, `0x2e` (raw/355303e/up_ngl99_sa803237.out:1) |
| 4 / 8 | `0a50d99` — #26049, further improved core pipeline (BISECT.md:20) | `8e1044d2…` (BUILDS.txt:9) | `n_exps_htp0=21`, exit `134` (raw/0a50d99/up_ngl8_sa803245.out:1) | TLBMISS thread `work-queue:1`, Fault PC `0x20089ECC` (raw/0a50d99/logcat_up_ngl8_sa803245.txt:502,505) | exit `134`, `0x2e` (raw/0a50d99/up_ngl99_sa803245.out:1) |
| 5 / 7 | `c0bc859` — op_poll Windows crash fix (#26029) (BISECT.md:19) | `25a83981…` (BUILDS.txt:11) | `n_exps_htp0=189`, exit `0` (raw/c0bc859/up_ngl8_sa803245.out:3) | — | exit `134`; mapping death, `mmap failed : va FFFFFFFF` (raw/c0bc859/logcat_up_ngl99_sa803245.txt:577-579) |

All six assembled kits passed the device manifest through line 39, including
`lib/libmtmd.so: OK` (raw/022458a/kit_verify_sa803224.txt:39,
raw/990e3bf/kit_verify_sa803224.txt:39, raw/0278d83/kit_verify_sa803231.txt:39,
raw/355303e/kit_verify_sa803237.txt:39, raw/0a50d99/kit_verify_sa803245.txt:39,
raw/c0bc859/kit_verify_sa803245.txt:39). The GOOD rows therefore have both
the required HTP proof and the separate ngl99 mapping death. Thus ngl99 shows
the mapping death for every GOOD commit, including the pin; the BAD commits
are decided earlier by their ngl8 TLBMISS. This does not answer whether #26501
or #28202 repairs that mapping path: those commits are later entries in the
full candidate table, not in the pin-to-culprit segment (BISECT.md:26,
BISECT.md:34).

## Run integrity and the void run

The first 990e3bf attempt was void: it reused the step-0 kit and model because
the old resume guard skipped both pushes (raw/990e3bf-VOID-ran-kit-022458a/driver_void.log:1-10).
The driver fix always removes and re-pushes `bin`, `lib`, `lib-fix`,
`SHA256SUMS`, and `kit.tgz`; only the sha-verified model may be reused
(d_run.sh:53-68). The valid rerun logs a fresh kit push, model resume, and kit
SHA `5306f3f8…` (raw/driver_990e3bf_sa803224.log:2-5); its manifest passes
(raw/990e3bf/kit_verify_sa803224.txt:1-39).

Three build detours were recorded. The runner was edited while active, leaving
an unexpected-EOF/syntax failure (logs/runner.log:4-8). The attempted
`cmake --install` path expected every HTP skel and then failed on the missing
`test-tokenizer-0` artifact (logs/022458a/04-install.log:4-10,
logs/022458a/04-install.log:33-41). The subsequent all-tests/all-target build
was stopped by the orchestrator once index 6 came back GOOD: `BUILDS.txt`
records `b2dd28a 0 - 431`, and the companion `logs/runner-3-9.log` is empty
(BISECT-LOG.md:25-26; BUILDS.txt:7; logs/runner-3-9.log). The partial
b2dd28a log ends at `[221/485]` without an end record
(logs/b2dd28a/03-host-build.log:337-345). The durable solution was to assemble from the build
tree: copy the four host binaries, the historical test binary, and the v73
skel into both library directories, then require 39 manifest entries
(build-kit.sh:116-196; logs/022458a/05-assemble-kit.log:3-6).

## What #26049 changes

Read-only `git show --stat 0a50d9909` reports 17 touched files, 1662 insertions,
and 757 deletions. Under `ggml/src/ggml-hexagon/htp/`, it touches
`dma-queue.c`, `dma-queue.h`, `flash-attn-ops.c`, `flash-attn-ops.h`,
`hmx-mm-kernels-tiled.h`, `htp-ctx.h`, `htp-ops.h`, `htp-tensor.c`,
`htp-tensor.h`, `hvx-fa-kernels.h`, `hvx-reduce.h`, `main.c`, `matmul-ops.c`,
and `matmul-ops.h`; the remaining files are `ggml-hexagon.cpp`,
`scripts/snapdragon/ggml-hexagon-profile.py`, and
`scripts/snapdragon/ggml-hexagon-trace.py`. The diff is therefore
a broad L2/DMA/MM/FA pipeline change, not a single isolated mapping edit
(read-only git show output).

The declared confound remains: the candidate table is a hexagon-only slice of
the full 844-commit history, whose other commits are not separately bisected
(BISECT.md:47-50). The requested read-only query
`git rev-list --count c0bc8591e..0a50d9909` returns `1`, and the first-ten
`--oneline` listing contains only `0a50d9909 hexagon: further improved pipeline
of the core bits (L2, DMA, MM, FA) (#26049)`; there is no additional intervening
commit between these adjacent SHAs. The claim is consequently “first BAD
hexagon commit,” not “only cause.”

## Session accounting

Portal figures are **PLAUSIBLE** (portal figures, not in raw): Six runs in FOUR
sessions — 799155: pin plus index 12; 799162: index 6; 799168: index 9; and
799176: indices 8 plus 7 with the model reused — with durations ~10/~6/~6/~24
≈ 46 min, including approximately 9 minutes of queue time and approximately
12 minutes idle waiting for the index-7 kit
(BISECT-LOG.md:16). Raw driver logs confirm the
same job/session ordering and model reuse (raw/driver_022458a_sa803224.log:1-14,
raw/driver_0278d83_sa803231.log:1-14, raw/driver_355303e_sa803237.log:1-14,
raw/driver_0a50d99_sa803245.log:1-14, raw/driver_c0bc859_sa803245.log:1-13).

## Not shown and next step

This cell shows no fix yet; it makes no claim about v75 or newer hardware, and
it reports no performance result (PREREG.md:80-86). It also does not establish
that #26049 alone is the only causal change in the broad history.

Next options, in owner order:

1. Revert or patch #26049 on top of `64a155d24`, then re-test at ngl8 and ngl99.
   The ngl99 result is the discriminating test for whether later #26501/#28202
   fix the mapping death (PREREG.md:6-7,71-73; BISECT.md:26,34).
2. Study #26049’s v73-specific path, especially the L2/DMA changes, and fix it
   in the fork or drop the path. Owner policy remains: never make this an
   upstream issue (PREREG.md:3-7).
