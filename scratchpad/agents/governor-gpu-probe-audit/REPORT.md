# Independent audit: governor GPU probe, engine half (step 2)

Auditor: independent reviewer, read-only. Subject: uncommitted working-tree change
in `/Users/marco/Projects/kalsallama` (HEAD `5c96b18dd`), 3 files under
`ggml/src/ggml-opencl/`, +331/-10. Coder's report:
`kalsa-moe-experiments/scratchpad/agents/governor-gpu-probe/REPORT.md` (375 lines).
Contract: `governor-gpu-recon/REPORT.md` section 4 (5 points).

Status: COMPLETE - all claims A through I verified; final verdicts in the last
three sections.

## Verified so far (working notes; final verdicts at the end)

- `git status --short`: exactly the 3 modified files. Untracked: `.zcode/` (created
  today 2026-09-21, session tooling artifact, not part of the change),
  `CMakeUserPresets.json` (2026-08-31), `pkg-snapdragon/` (2026-08-31). The coder's
  "two untracked paths" statement misses `.zcode/`; it predates nothing but is not
  part of the change either.
- `git diff --stat`: 3 files, +331/-10, matches the claim exactly.
- `build_program_from_source` (ggml-opencl.cpp:1440) passes `/*fatal=*/false`;
  on null it sets `kernel_build_failed` (:1444), calls
  `ggml_opencl_record_verdict(backend_ctx, false)` (:1445), returns nullptr. Confirmed
  by reading the source.
- `build_program_from_source_ex` exit(1) sites: :1368 is `if (fatal) exit(1);` and
  :1393-1395 is `if (fatal) { exit(1); }` - both behind the flag. The grep hit
  "1394: exit(1);" looked unconditional but is inside the brace block. Both return
  NULL/nullptr instead when fatal=false.
- Verdict read ordering: the public `ggml_backend_opencl_device_supports_op`
  (:14426-14429) calls `ggml_cl_init(dev)` BEFORE `ggml_opencl_supports_op`, and
  `ggml_cl_init` reads the persisted verdict (:7168-7178). `alloc_buffer`
  (:14218-14224) also goes through `ggml_cl_init` first. So the verdict is always
  read before the scheduler's first `supports_op` and before any buffer allocation.
  The internal `supports_op` (:9497) dereferences `dev_ctx->backend_ctx` without a
  null check, but every path into it from outside the file is wrapped by
  `ggml_cl_init` first; this deref is pre-existing code, and the new flag check
  (:9503) adds no new null-deref surface on those paths.
- `alloc_buffer` (:14218): `ggml_cl_init` -> `load_cl_kernels` -> `if
  (kernel_build_failed) return nullptr;` before any `clCreateBuffer`. On failure no
  OpenCL resource is created.

## A. What the first reviewer claimed to have verified

- (i) PARTIAL. `git status --short` shows exactly the 3 modified files and
  `git diff --stat` shows exactly `3 files changed, 331 insertions(+), 10 deletions(-)`.
  But there are THREE untracked paths, not two: `.zcode/` also appears (created
  2026-09-21 15:04, session tooling artifact, not part of the change; CMakeUserPresets.json
  2026-08-31, pkg-snapdragon/ 2026-08-31). The claim "two untracked paths" is off by
  one; the substantive point (only 3 modified files, all under ggml-opencl) holds.
- (ii) CONFIRMED by reading ggml-opencl.cpp:1440-1447. `/*fatal=*/false`; on null:
  sets `kernel_build_failed` (:1444), calls `ggml_opencl_record_verdict(backend_ctx,
  false)` (:1445), returns nullptr.
- (iii) CONFIRMED by my own independent scanner (fresh Python parse over the file,
  not the coder's): 187 call sites of `build_program_from_source(` (186 in
  `load_cl_kernels`, 1 in `load_cl_kernels_argsort`), 0 unguarded, 0 sites with a
  `clCreateKernel` between the call and its guard, 187 guard lines total in the file.
  Numbers 187 and 0 are right.
- (iv) CONFIRMED. ggml-alloc.c:431-436 (`ggml_vbuffer_alloc`): NULL chunk ->
  `ggml_vbuffer_free(buf); return NULL;`. ggml-alloc.c:1131-1138
  (`alloc_tensor_range`): NULL buffer -> error log, `free_buffers(...)`,
  `return false`. Both clean.

## B. Does the process survive a failed bulk compile? (the crux)

Traced up every path the app really uses. Verdict: the primary path is clean, and
the coder's own honest-boundary statement is in fact CONSERVATIVE - but there is
one real remaining abort path (argsort), detailed below.

Path order in a governor session with n_gpu_layers=99 (all verified in source):

1. FIRST OpenCL `alloc_buffer` call is NOT the real weights buffer. It is the
   size-0 DUMMY buffer inside `weight_buft_supported`
   (src/llama-model-loader.cpp:1049-1054), called from `select_weight_buft`
   (:1060) for every weight tensor during `load_tensors` planning, BEFORE any real
   buffer exists. This is where `load_cl_kernels` first runs - and where the old
   code's `exit(1)` actually fired in-app. With the change: alloc returns nullptr,
   `w->buffer` stays nullptr (it was nullptr before), `ggml_backend_buffer_free(nullptr)`
   is a no-op (ggml-backend.cpp: `if (buffer == NULL) { return; }`), and
   `ggml_backend_dev_supports_op` -> `ggml_opencl_supports_op` now returns false
   because the flag is set. `select_weight_buft` falls through to the next buft
   (CPU is last in the list), so the weights route to CPU.
2. If a real OpenCL weights buffer is ever the first alloc
   (`ggml_backend_alloc_ctx_tensors_from_buft`, src/llama-model.cpp:1805): NULL ->
   `throw std::runtime_error` (:1808) -> caught at src/llama.cpp:374-377 ->
   `{-1, nullptr}` -> model load fails cleanly, process survives.
3. KV cache (src/llama-kv-cache.cpp:307-311): NULL -> `throw std::runtime_error`
   -> caught by llama-context try/catch -> clean failure. Not reachable as the
   FIRST OpenCL alloc in the app flow (weights selection always precedes it).
4. Scheduler compute buffers: `ggml_vbuffer_alloc` NULL -> reserve returns false
   (ggml-alloc.c:940-943). PRE-EXISTING upstream hazard, unchanged by this diff:
   `ggml_backend_sched_alloc_splits` (ggml-backend.cpp:1633) IGNORES the failed
   reserve's return and calls `ggml_gallocr_alloc_graph` again; if the plan is
   unchanged `needs_realloc` returns false and `init_tensor` can reach
   `ggml_vbuffer_tensor_alloc(NULL, ...)` (NULL-deref). This is NOT reachable in
   the app flow via `kernel_build_failed` (weights dummy alloc always runs first
   and poisons the flag before any graph is planned), and it is equally triggerable
   by a plain OOM with or without this change - i.e. pre-existing, not a moved
   abort introduced by this change. Noted, not charged to this change.

REMAINING HOLE (this is a real defect against the contract's intent):

- src/llama-model-loader.cpp path is clean, but the ARGSORT lazy path is not:
  ggml-opencl.cpp:9835-9839 (inside `ggml_opencl_supports_op`, case
  `GGML_OP_ARGSORT`) calls `load_cl_kernels_argsort(backend_ctx)` and then
  `get_kernel_workgroup_size(backend_ctx->kernel_argsort_f32_i32)`. If the bulk
  set compiled fine (flag false at entry, so the :9503 entry check passes) and the
  argsort kernel then fails to build, `load_cl_kernels_argsort` returns with
  `kernel_argsort_f32_i32 == nullptr` (guard at :1500 returns before
  `clCreateKernel`), and `get_kernel_workgroup_size(nullptr)` ->
  `clGetKernelWorkGroupInfo(NULL, ...)` returns CL_INVALID_KERNEL ->
  `CL_CHECK` -> `GGML_ASSERT(0)` -> SIGABRT (CL_CHECK at :67-75). So for an
  argsort-only failure the process dies today, exactly the class of death the
  slice was meant to remove (before the change it died by exit(1) at the same
  spot instead). In-app reachability is narrow: it requires an ARGSORT node in a
  graph (uncommon in LLM decode graphs) AND a driver that compiles the bulk set
  but fails argsort. One-line fix (re-check the flag or the null kernel after the
  load call in the ARGSORT case). Not fixed by this change.

## C. The 187-site edit

- Independent scan (above): 187/187 guarded, guard immediately after the call,
  never after a `clCreateKernel`. The four deeply nested sites examined by hand:
  :3647/:3652/:3665 (conv2d, inside `if (!kernel_src.empty())` - guard correctly
  inside the same conditional; the else branch already nulled the kernels
  pre-change) and :3808 (gated_delta_net variant loop; guard inside the nested
  loops before clCreateKernel and clReleaseProgram). Correct.
- Early-return side effects: `load_cl_kernels` contains no locks or mutexes
  (grep over :1545-5598: no match). The early return skips only
  `GGML_LOG_CONT("\n")` and `load_cl_kernels.done` logging - cosmetic. The failed
  program is released inside `build_program_from_source_ex` itself (:1392), so no
  leak at the guard. No state update is skipped that later code needs.
- `kernels_loaded` CANNOT be set on a partial set: `kernels_loaded = true` is at
  :5597, after the last build site and after `ggml_opencl_record_verdict(...,
  true)` (:5596); every guard returns before both. Likewise
  `kernels_loaded_argsort` (:1503) only after its clCreateKernel. And re-entry is
  a no-op because `load_cl_kernels` checks `kernel_build_failed` at :1546.
- `load_cl_kernels_argsort` caller tolerance: the ONLY caller is :9836, and it
  does NOT tolerate a null kernel - see the REMAINING HOLE in B.
- The FA sites the coder cited as precedent (:6026-6031, :6508-6516) call
  `build_program_from_source_ex` directly with fatal=false and `if (!prog) return
  false;` - pre-existing, unchanged, and correctly do NOT poison the device (an
  optional variant failing is not a device failure). Consistent design.

## D. The verdict file

- Keying: `compute_verdict_key` (cl-program-cache.cpp:175-186) = SHA-256 over
  `key_suffix` = CL_DEVICE_NAME + CL_DRIVER_VERSION + CL_DEVICE_VERSION +
  CL_PLATFORM_VERSION + `fmt=<CL_PROGRAM_CACHE_FORMAT_VERSION>` (:238-252), the
  same suffix the per-program cache keys fold in. Driver update -> new key.
  CONFIRMED. But compile options and the kernel-set contents are NOT in the
  verdict key: an app update that fixes or changes kernels keeps the old verdict
  unless CL_PROGRAM_CACHE_FORMAT_VERSION is bumped. A stale `fail` survives an
  app update. Real gap, not acknowledged in the report ("no expiry" is
  acknowledged for transient causes only).
- Atomicity: `write_atomic` (:268-290) = tmp file with pid suffix + rename.
  Crash mid-write leaves the old file or no file, never a partial verdict. Good.
- Corruption/empty: `load_verdict` (:487-517) requires the 14-byte
  "GGMLCLVERDICT " header; an empty or foreign file returns false (treated as
  absent, device NOT disabled - fail-open in the safe direction for availability).
  A file truncated after the header would parse with `ok` missing -> default
  false -> read as FAIL. Practically unreachable given atomic writes; corrupt
  external truncation could disable a working device until the file is cleared.
- FALSE-NEGATIVE risk (fail verdict disabling a WORKING device): REAL and
  acknowledged by the coder. A single transient bulk-build failure (e.g.
  CL_OUT_OF_HOST_MEMORY; the bulk path passes no retry_queue, so one attempt)
  writes `fail`, and every later launch disables the device without ever
  re-probing. There is no expiry, no retry budget, no rehabilitation path: while
  the verdict says fail, `load_cl_kernels` is never called again. Compared to the
  old behavior (exit(1) every launch, user can retry), the new behavior keeps the
  app alive but permanently gives up on the GPU after ONE transient failure until
  the cache is cleared. "Not a regression" is defensible only in the
  process-survival sense; the never-retry property is new.
- Compile-options/n_ctx dimension: options are not in the verdict key (see
  above); n_ctx does not affect compilation at all (kernel opts are constant
  per build), so that part of the concern is moot.
- OK verdict on a partial set: IMPOSSIBLE. Written only at :5596 after all 186
  sites; any failure writes fail first and returns. A later argsort failure
  (separate lazy path) overwrites ok with fail - conservative direction.
- Ordering: verdict is read in `ggml_cl_init` (:7168-7178), which runs at latest
  on the first `supports_op` (public wrapper at :14426-14429 calls `ggml_cl_init`
  before the check), `supports_buft` (:14440), backend init (:14388), or
  `alloc_buffer` (:14219). So the persisted verdict is ALWAYS read before the
  scheduler's first `supports_op` and before any allocation. CONFIRMED.
- Cache-disabled case: with no writable cache dir (Android default app context),
  `save/load_verdict` are no-ops (`state.dir.empty()`), verdict is in-process
  only. Matches the coder's limitation #2.

## E. Happy path unchanged

Full inventory of non-mechanical diff lines obtained (sorted uniq over the diff
minus the 187 guards): nothing beyond the reviewed hunks. On the all-kernels-
compile path:

- Same kernel set, same order, same `CL_CHECK`s, same program-cache use
  (try_load -> _ex -> try_save), same logs. The only flow delta: the program
  cache init moved from `alloc_buffer` to `ggml_cl_init`, i.e. it now happens at
  device/backend init instead of first buffer - so `make_dir_recursive` (cache
  dir creation) and the `kernel cache enabled at` log appear EARLIER, even for a
  process that never allocates an OpenCL buffer. Same content, different timing.
- `build_program_from_source` success path: old `if (p != nullptr) { try_save }`
  collapsed to unconditional `try_save` (p is non-null there) - identical
  behavior.
- New per-call costs: one bool check in `supports_op` (per op per graph plan),
  one bool check per kernel build site (187 per process), one small verdict-file
  read at init and write at end of kernel load (only when cache enabled).
  Negligible; no consumed return values found.
- The failed-load retry concern is absent: `load_cl_kernels` early-outs on the
  flag, so a poisoned device does not recompile on every allocation.

## F. Other fatal paths (all re-tested, not repeated)

- :1368/:1393-1395 (`build_program_from_source_ex`): both behind `fatal`; the only
  caller passing fatal=true was the bulk wrapper, now false. grep
  `fatal=*/true` -> 0. The `_ex` FA callers pass false. No other caller exists.
- :1463/:1474 (`build_program_from_binary`): callers exist at :4139, :4380, :4633,
  :4705, :4793, :5000, :5054, :5090, :5301, :5374 - all guarded by RUNTIME
  `if (use_adreno_bin_kernels(backend_ctx))`, which returns false at COMPILE time
  when `GGML_OPENCL_USE_ADRENO_BIN_KERNELS` is undefined (:1536-1543 `#ifndef`
  branch). build-android-ocl has `GGML_OPENCL_USE_ADRENO_BIN_KERNELS:BOOL=OFF`
  (CMakeCache verified). The app build per recon defines
  GGML_OPENCL_USE_ADRENO_KERNELS (different macro) - taken from recon, app repo
  not rebuilt here. Unreachable in-app CONFIRMED for the engine build; app-build
  claim rests on recon.
- :3753 and :31103 (`sg_size < 0`): reachable only for gpu_family neither ADRENO
  nor INTEL. `ggml_opencl_is_device_supported` (:6834-6858) REJECTS any such
  device at registration (:6744-6747 drops it, UNKNOWN family -> return false),
  and it sets ADRENO for any Adreno/Qualcomm name. So no accepted device can have
  sg_size < 0. CONFIRMED unreachable in-app.
- :6640/:6658/:6669/:6682: fire only on `GGML_OPENCL_PLATFORM`/`GGML_OPENCL_DEVICE`
  env values (read :6622-6623). An Android app does not set process env vars.
  CONFIRMED unreachable in-app (barring an app explicitly setting env).
- The `CL_CHECK` -> `GGML_ASSERT(0)` trap: closed at all 187 sites by the guards
  (my scan), but NOT closed at the argsort caller (:9836-9839) - see B.

## G. The no-test justification

AGENTS.md line 87, quoted exactly:

  Do NOT add a new file in `tests/*` without maintainers' approval. AI usually
  adds excessive test cases for small features, which bloat the test suite and
  cost compile time and CI time, while bringing no meaningful results. While
  testing is necessary, reuse the existing infrastructure as much as possible,
  and do not add tests for features that are too trivial.

It forbids a NEW FILE under tests/* without approval (and discourages excessive
tests for small features). It does NOT forbid extending an existing test file -
on the contrary, "reuse the existing infrastructure as much as possible". The
coder's use of AGENTS.md covers only the new-file route.

Technical claim: CONFIRMED for the compile-failure path. The OpenCL >= 2.0
requirement is enforced at ggml-opencl.cpp:6862-6867 (`opencl_c_version.major
< 2` -> device rejected), and registration drops rejected devices (:6744-6747).
The only host OpenCL is Apple 1.2 (coder's probe; not re-run here, but the gate
is in source), so no host device registers and `load_cl_kernels` is unreachable
from any host-run binary. A compile-failure test would need a fake libOpenCL -
a new subsystem, exactly as the report says.

BUT the deliverable has a testable half it skipped: the verdict writer/reader
round-trip (`cl_program_cache_save_verdict`/`cl_program_cache_load_verdict`,
plus `write_atomic`) needs NO device, NO context, only a `cl_program_cache_state`
with a temp dir. An existing non-ctest test file already links the OpenCL build
(`tests/test-opencl-moe-roundtrip.cpp`, built unconditionally by
tests/CMakeLists.txt:332) and could carry such a case; running it on host
requires a host build with GGML_OPENCL=ON (one cmake flag; no such build dir
exists today - host `build/` has GGML_OPENCL=OFF). So: a GPU-less test of the
persistence half IS buildable by extending an existing test file at the cost of
one host build config. That is a gap in the deliverable, not a detail: the
report's own NOT VERIFIED list admits no round-trip test exists.

## Reproduced builds and tests

- `cd build-android-ocl && ninja ggml-opencl`: up to date; forced rebuild of both
  objects succeeds; artifact newer than all 3 sources (mtimes checked). Exactly 7
  warnings, all pre-existing and outside added lines (:1534 unused param,
  :8315/:8459 -Wcast-qual, :9534 #pragma TODO, :12999/:13200/:13304 unused err) -
  matches the coder's c1 exactly.
- `cd build && ctest -R governor`: `100% tests passed out of 9`, with
  test-governor-v0-mtp-hybrid, -devices, -hybrid skipped - matches the coder's c2
  exactly (8 governor targets: 5 pass / 3 skip, plus the download-model fixture).

## H. The report's honest-boundary sentence

The sentence: "on the *first* session in which a build fails, the failure is
discovered inside `alloc_buffer` ... after the scheduler has already chosen
backends for that graph. That session fails the buffer allocation and the process
survives; the recorded verdict makes the *next* session keep nodes on CPU."

- "survives": SUPPORTED for a bulk kernel-set failure. No abort, assert, or
  unchecked-null deref exists on the app's real paths (see B).
- "after the scheduler has already chosen backends" / "that session fails the
  buffer allocation": WRONG in mechanism, in the user's favor. The first OpenCL
  `alloc_buffer` in a governor session is the size-0 dummy buffer inside
  `weight_buft_supported` (src/llama-model-loader.cpp:1051), reached during model
  weight-buft selection - BEFORE llama_context (and therefore any scheduler)
  exists. After the failure, `select_weight_buft` falls through to the CPU bufts
  (each GPU device's list explicitly appends the CPU fallback,
  src/llama-model.cpp:1478-1480, and `make_cpu_buft_list` always ends with the
  plain CPU buft, :1110-1116). The first failing session therefore does NOT fail:
  it silently reroutes all weights to CPU during planning and completes as a
  CPU-only load. The coder's "deliberately not done" note (not moving the compile
  to init/supports_op) is also moot for the app flow: the dummy probe already is
  an implicit probe inside selection.
- Verdict on the sentence: UNDERSTATED and mechanically inaccurate, in the
  conservative direction. The exception-throwing weights path
  (llama-model.cpp:1805-1808 -> caught at llama.cpp:374) is real code but is not
  what runs first in this app. The one accurate caveat the report could have made
  and did not: the argsort edge (B), where the process does NOT survive.

## I. The on-device proof strings

Both strings are verbatim in the code at the exact lines the report cites:

- `ggml_opencl: kernel compile error (err=%d)...` - ggml-opencl.cpp:1390
  (GGML_LOG_ERROR, emitted from `build_program_from_source_ex` before returning
  null; present on both the old and new code, so it marks the failure event, not
  the fix).
- `ggml_opencl: kernel set failed to build on '%s' (driver '%s'); device disabled,
  ops stay on CPU` - ggml-opencl.cpp:7175 (GGML_LOG_WARN, emitted from
  `ggml_cl_init` when a persisted fail verdict is read).
- Supporting line the proof needs but does not name: `ggml_opencl: kernel cache
  enabled at '%s'` - cl-program-cache.cpp:354, the only log that distinguishes
  cache-enabled (verdict persists) from cache-disabled (in-process flag only).

Delivery to logcat - caveat: these go through the ggml logger. `llama_log_set`
redirects ggml's logger to the same callback (src/llama-impl.cpp:33), and the app
installs `logToJsCallback` (RNLlamaJSI.cpp:253) which writes to stderr AND mirrors
to JS, where LlamaService.ts:514 logs `KALSA_NATIVE <level> <text>` to the RN
console (logcat tag ReactNativeJS on debug builds). There is no native
`__android_log_print` for these lines, and `llama_log_callback_default` is plain
`fputs(stderr)` - on a release app stderr is typically dropped. So the grep works
(compile: `adb logcat | grep -F "ggml_opencl: kernel compile error"`; verdict:
`grep -F "device disabled, ops stay on CPU"`), but the expected tag is
ReactNativeJS/stderr, and on a release build without the JS handler the lines may
be invisible - the proof should be run on a debug build.

PASS looks like: compile-error line appears, then continued process activity (no
tombstone, no exit); the session's weights log CPU placement; next launch (cache
enabled) shows the verdict WARN line and NO compile-error line. FAIL looks like:
process death right after the compile-error line (exit or SIGABRT/tombstone -
SIGABRT specifically would indicate the argsort-class hole or a CL_CHECK trap),
or a second launch that recompiles (verdict not read) or dies.

## Verdicts per claim

- A(i) PARTIAL - 3 untracked paths exist (`.zcode/` also present, created this
  session; the 2 named ones do pre-date the change); the 3 modified files /
  +331/-10 are exact.
- A(ii) CONFIRMED. A(iii) CONFIRMED (independent scanner: 187 sites, 0 unguarded,
  0 kernel-before-guard). A(iv) CONFIRMED.
- B CONFIRMED-SURVIVES for the bulk path with one exception: the process survives
  a bulk kernel-set failure on every path the app uses (and reroutes to CPU even
  more cleanly than claimed); but ggml-opencl.cpp:9836-9839 can still SIGABRT on
  an argsort-only failure (null kernel -> `get_kernel_workgroup_size` ->
  `CL_CHECK` -> `GGML_ASSERT(0)`). The pre-existing ignored-reserve-return at
  ggml-backend.cpp:1633 is a latent NULL-deref hazard, unreachable via
  kernel_build_failed in the app flow and not introduced by this change.
- C CONFIRMED at all 187 sites (mechanical scan + hand-check of the 4 nested
  sites); no skipped cleanup/mutex/state; `kernels_loaded` cannot be set on a
  partial set. The argsort caller intolerance is counted under B.
- D MOSTLY CONFIRMED - keying folds device+driver+device-version+platform-version
  +format-version via the cache's key_suffix; tmp+rename atomic; empty/foreign
  file treated as absent (safe direction); OK only after the complete set;
  verdict read before the scheduler's first supports_op. Two real gaps: no
  expiry/re-validation (one transient failure permanently disables the GPU - the
  report acknowledges the transience but calls it "not a regression", which is
  only true for process survival, not for the never-retry property), and the
  verdict key omits the kernel-set/compile-options identity, so an app update
  that fixes the kernels keeps a stale fail verdict until the cache is cleared or
  CL_PROGRAM_CACHE_FORMAT_VERSION is bumped (not acknowledged).
- E CONFIRMED - same kernel set, same cache use, same logs; the only control-flow
  delta is cache init (and dir creation) moving from first alloc_buffer to
  device init; new costs are one bool check per supports_op call and per build
  site plus one small file read/write per process. Nothing consumed or dropped.
- F CONFIRMED - binary exit(1)s unreachable (compile-time OFF verified in
  build-android-ocl CMakeCache; runtime gate returns false without the define);
  sg_size exits unreachable (UNKNOWN-family devices rejected at registration,
  :6842-6857); env-probe exits require GGML_OPENCL_PLATFORM/DEVICE env vars;
  no caller passes fatal=true anymore. Caveat: the app-build define claims come
  from recon; the app repo was not rebuilt.
- G PARTIAL - AGENTS.md:87 quote is accurate and forbids only NEW test files
  (extending existing files is explicitly encouraged); the OpenCL 2.0 gate
  (ggml-opencl.cpp:6862-6867) really does make the compile-failure path
  unreachable on this host; BUT the verdict writer/reader round-trip needs no
  device and could have been tested by extending tests/test-opencl-moe-roundtrip.cpp
  with a host GGML_OPENCL=ON build config (one cmake flag, no such config exists
  today). That is a gap in the deliverable, plainly said.
- H The sentence is UNDERSTATED and mechanically inaccurate in the user's favor:
  "survives" is supported; "fails cleanly ... after the scheduler already chose
  backends" is wrong - the failure surfaces during model-load buft selection
  before any scheduler exists, and the session silently completes on CPU. The
  unspoken exception is the argsort edge, where "survives" would be false.
- I CONFIRMED - both strings verbatim at the cited lines (:1390, :7175), plus the
  cache-enabled line at cl-program-cache.cpp:354; logcat delivery is via the
  app's JS mirror (ReactNativeJS tag) or debug-build stderr, not a native log
  tag - the proof protocol should specify a debug build.

## What I could not verify and why

- Everything runtime: no device was touched. The degradation story
  (CPU reroute, verdict suppression) is traced in source, not observed. The
  coder's own NOT VERIFIED list is honest on this point.
- Whether the rnllama app build defines GGML_OPENCL_USE_ADRENO_BIN_KERNELS or
  enables the kernel cache dir: rests on recon; the app repo exists on disk
  (/Users/marco/Projects/kalsa) but was not rebuilt or configured.
- The coder's host OpenCL 1.2 probe (c5) was not re-run; the 2.0 gate in source
  makes the conclusion robust regardless of the exact host version.
- Whether any model graph the app runs actually contains GGML_OP_ARGSORT (would
  make the argsort hole more or less reachable in practice).

## Bottom line

The plan's step-2 outcome, read literally - "no more exit(1) in-app" - is
ACHIEVED by this change: the only in-app-reachable exit(1) class (the bulk
kernel-set build) now returns a null program at all 187 sites with correct
guards, the failure poisons the device instead of the process on every path the
app really uses, the first failing session silently reroutes to CPU during
weight-buft selection (better than the report itself claims), and the persisted
verdict suppresses the device from the first supports_op of the next launch.
It is not, however, the full spirit of "a compile failure never kills the
process": one narrow path still aborts - an argsort-only build failure reached
through the lazy load at ggml-opencl.cpp:9836-9839 passes a null kernel to
`get_kernel_workgroup_size`, whose `CL_CHECK` is `GGML_ASSERT(0)` - so a device
that compiles the bulk set but not argsort dies with SIGABRT instead of exit(1).
The smallest remaining change is one line in the GGML_OP_ARGSORT case: after
`load_cl_kernels_argsort(backend_ctx)`, `if (backend_ctx->kernel_build_failed ||
!backend_ctx->kernel_argsort_f32_i32) { return false; }`. Two further hygiene
gaps should be fixed or consciously accepted: the verdict never expires or
re-probes (a single transient OOM permanently disables a working GPU), and its
key does not fold the kernel-set identity (an app update that fixes the kernels
keeps a stale fail verdict).

## End of report. The review was NOT interrupted; all claims A through I were
checked and every verdict above is final.
