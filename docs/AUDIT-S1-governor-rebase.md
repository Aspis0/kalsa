# Hostile S1 audit — governor v0.3 rebase

Scope: `/Users/marco/Projects/kalsallama-wt-governor-v03`, branch
`kalsa/governor-v0.3-on-12f6d9b6d`, HEAD `8665e9a9f`. Code and worktrees were
read-only. Overall: **GO-WITH-FIXES**. The rebase is sound; the app-overlay
gate is not ready, and the governor arm was not executed on this host.

## Findings

1. **Rebase identity — CONFIRMED.** `git range-diff a0cabca6b..1a33da0f6
   12f6d9b6d..8665e9a9f` produced 28 rows, every row marked `=`; final row was
   `28: 1a33da0f6 = 28: 8665e9a9f`. Counts were `28` and `28`. Also read:
   `HEAD~28 = 12f6d9b6d370005212fcb9cef80d48fe407cfbe3`,
   `merge-base = 12f6d9b6d370005212fcb9cef80d48fe407cfbe3`,
   `unmerged-index=       0`, and clean branch status.
2. **“Zero conflicts” — PLAUSIBLE, not provable from retained evidence.** The
   reflog has `rebase (start)`, 28 `rebase (pick)` entries, and
   `rebase (finish)` with no abort/skip; no actual `<<<<<<<`/`>>>>>>>` markers
   or unmerged index remain. Git did not retain a no-conflict certificate.
3. **OpenCL preservation — CONFIRMED.** `git diff --stat a0cabca6b 12f6d9b6d
   -- ggml/src/ggml-opencl/` read `6 files changed, 193 insertions(+), 60
   deletions(-)` across the three OpenCL commits. Post-base OpenCL log was
   empty; `git diff 12f6d9b6d HEAD -- ggml/src/ggml-opencl/` returned
   `opencl diff exit=0`.
4. **38-file diff / no OpenCL file — CONFIRMED.** The name-status count was
   `38`; the OpenCL name-only filter printed nothing. This is consistent with
   the rebase, not evidence that the OpenCL changes were independently tested.

5. **Native source registration — CONFIRMED.** `src/CMakeLists.txt` contains
   `llama-kv-commit.cpp`, `llama-kv-staged.cpp`, `llama-hybrid-commit.cpp`,
   `llama-governor.cpp`, `llama-governor-runtime.cpp`,
   `llama-governor-metrics.cpp`, and `llama-governor-policy.cpp`. All 14 files
   listed by PLAN §2 (the seven `.cpp` files plus seven headers) exist.
6. **Configure/build evidence — PLAUSIBLE exit 0, not confirmed.** Cache says
   `CMAKE_BUILD_TYPE:STRING=Release`, `GGML_METAL:BOOL=OFF`, and
   `GGML_OPENCL:BOOL=OFF`; configure tail says `-- Configuring done`,
   `-- Generating done`, and `-- Build files have been written to:`. Build
   tails say `Built target test-governor-v02-router`, `Built target
   governor-bench`, and `Built target llama-cli`. There are no exit files,
   command transcripts, or recorded return codes.
7. **Router test — CONFIRMED PASS; fresh-binary provenance PLAUSIBLE.** Read
   `router_v02_golden=PASS` and `router_v02_metrics=PASS`. The test binary and
   its link/build log both have timestamp `2026-09-04 15:10:07 -0400`, while
   `router.log` is `15:12:10`; that strongly supports a fresh build, but the
   log does not name the executable path.
8. **Arm C benchmark — CONFIRMED as reported.** The exact tail is
   `summary=median arm=C turns=3 repetitions=3 ... build_commit=8665e9a9f ...
   prefill_backend=CPU decode_backend=CPU ttft_ms=10087.136 decode_tps=19.619`.
   This is a CPU baseline, not governor performance.
9. **Arm G fail-fast — CONFIRMED behavior, observed exit code only PLAUSIBLE.**
   Source returns `2` after `arm=%c fail-fast: no non-CPU backend resolved`; log
   reads `governor-bench: arm=G fail-fast: no non-CPU backend resolved;
   resolved_backend=CPU`. No exit-code file exists, and G never reaches model
   setup on this `METAL=OFF`/`OPENCL=OFF` host.
10. **Half-offload — CONFIRMED absent in the governor path.** Bench source
    reads `load_model(..., 99)` for `state.prefill_model` and
    `load_model(..., 0)` for `state.decode_model`, then calls
    `llama_governor_init(...)`; governor dispatch selects `ctx_prefill` for
    `batch.n_tokens > 1`, `ctx_decode` otherwise, and calls
    `llama_decode(target, batch)`. No partial `n_gpu_layers` path exists.
    A/C are separate single-context baselines at 99/0, not half-offload.
11. **Android/app proof — REFUTED as an implied S1 result.** No Android build,
    llama.rn overlay build, two-context JSI owner, session pair-save/restore,
    token-equality oracle, or real accelerator governor turn was tested. PLAN
    explicitly reserves those checks for S2–S5.
12. **Overlay copy list — CONFIRMED defect.** PLAN §2 requires these 14 new
    files: `llama-governor.{cpp,h}`, `llama-governor-runtime.cpp`,
    `llama-governor-policy.{cpp,h}`, `llama-governor-metrics.{cpp,h}`,
    `llama-kv-commit.{cpp,h}`, `llama-kv-staged.{cpp,h}`, and
    `llama-hybrid-commit.{cpp,h}`. `scripts/sync-kalsallama.sh:341-369` stops
    at `llama-ext.h`; none is listed. The app pin still says
    `a0cabca6b1b3248a92e05a8633fd0d82cf776e75`, and all 14 are absent from
    `vendor/kalsallama-cpp`. Fix the list, regenerate/freeze the vendor pin,
    then run the Android overlay build before S2 acceptance.
13. **Leftover artifacts — CONFIRMED present, not overlay/commit inputs.** The
    branch worktree has `build/` and `logs/`; `.gitignore` reports
    `.gitignore:46:/build*` and `.gitignore:17:*.log`, and tracked build/log
    matches were empty (apart from tracked `build-xcframework.sh`). The sync
    script uses `git archive` for vendor extraction and `rsync --delete` from
    `vendor/`, so these artifacts are not copied by the app overlay. They are
    still stale evidence hazards; do not mistake them for reproducible CI.

**Verdict: GO-WITH-FIXES.** Accept the rebase and CPU/router evidence. Do not
call S1 governor execution validated, and do not advance the app overlay until
the 14-file sync-list defect is fixed and an Android build proves the copied
sources compile.
