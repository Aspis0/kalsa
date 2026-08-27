# Phase 2 — fork compatibility backports

Status date: 2026-08-27 12:58 EDT

## Isolated source and provenance

- Source clone: `C:\Users\gualt\kals-pin`
- Remote: `https://github.com/Aspis0/kalsallama.git`
- Base checkout: `a0cabca6b1b3248a92e05a8633fd0d82cf776e75`
- Branch: `app-pin-compat`
- Pushed branch head: `cb9fdd1f867afa53565a0547ceb8f86a79822857`
- Authoritative owner-WIP checkout and `ai-chat` were not touched.

## Implemented scope

All eight requested compatibility items are implemented in the fork and committed. Final q63-parity PC-native compile and targeted-test validation is recorded below.

1. **Implemented:** `llama_load_mode` enum and `common_params.load_mode`; conversion maps `NONE`, `MMAP`, `MLOCK`, `MMAP_MLOCK`, and `DIRECT_IO` to the fork's existing model booleans. Existing CLI mmap/mlock/direct-IO switches synchronize the new mode. This is the requested M surface; the full upstream loader chain remains later work.
2. **Implemented:** wrapper-named `progress_callback` and `_user_data`; conversion uses them when present and preserves the fork's legacy `load_progress_callback` fallback.
3. **Implemented:** `common_params.vocab_only` is threaded to `llama_model_params.vocab_only`.
4. **Implemented:** `reasoning_budget_activate_immediately` selects the fork's existing `REASONING_BUDGET_COUNTING` initial state; no dead field or new state machine was added.
5. **Implemented:** `reasoning_budget_end` is now a vector of token sequences. The fork sampler deliberately selects `.front()` because its matcher is single-sequence; server schema population and diagnostics were updated. First-sequence semantics are documented in code. Full multi-sequence matching remains later work.
6. **Implemented:** plural `common_chat_params.thinking_end_tags` is synchronized with the existing singular field at the public template-apply boundary. Existing fork consumers continue using the singular first tag.
7. **Implemented:** variant-aware caps struct/getter and `common_chat_templates_has_variant`; existing one-argument map getter is preserved.
8. **Implemented:** `mtmd_input_text.text_len`; tokenizer copies exactly that length, and the two in-tree callers populate it.

## Configure and build validation

RAM gate immediately before the build:

```text
FreePhysicalMemory_GB=12.29
RequiredMinimum_GB=8
```

Installed toolchain used for the cross-compile:

- Android NDK `27.1.12297006`
- Android SDK CMake `3.22.1`
- Android ABI `arm64-v8a`, platform `android-26`
- Ninja from the same SDK CMake installation

Configuration completed successfully with all fork libraries, common code, tools, examples, server, MTMD, and test targets enabled. The single bounded compile was launched at Idle priority with `CMAKE_BUILD_PARALLEL_LEVEL=2`, `NINJAFLAGS=-j2`, and CMake `--parallel 2`.

Build timing from `build-result.txt`:

```text
started=2026-08-27T11:17:34.3168905-04:00
ended=2026-08-27T11:17:59.1683319-04:00
wall_seconds=24.8514414
exit_code=
priority=Idle
```

The build stopped at `[6/550]`; the exact terminal diagnostic was:

```text
ninja: build stopped: interrupted by user.
```

No compiler error was emitted before the interruption. Per the one-attempt instruction, the build was not retried. Logs: [build-gate.txt](build-gate.txt), [configure.log](configure.log), [build.log](build.log), [build.err](build.err), and [build-result.txt](build-result.txt).

## Tests

The configured tests were queried and attempted after the incomplete build; no test executable existed:

- `test-sampling`: `Unable to find executable: C:/Users/gualt/kals-pin/build-phase2/bin/test-sampling`; `0% tests passed, 1 tests failed out of 1`.
- `test-reasoning-budget`: `Unable to find executable: C:/Users/gualt/kals-pin/build-phase2/bin/test-reasoning-budget`; `0% tests passed, 1 tests failed out of 1`.
- `test-chat` regex: `test-chat`, `test-chat-peg-parser`, `test-chat-auto-parser`, and `test-chat-template` all reported `Unable to find executable`; `0% tests passed, 4 tests failed out of 4`.

Full ctest output is in [ctest-sampling.log](ctest-sampling.log), [ctest-reasoning-budget.log](ctest-reasoning-budget.log), and [ctest-chat.log](ctest-chat.log).

No device work, llama.rn work, or Gradle work was performed in Phase 2. No Gradle daemon was started, so no `gradlew --stop` action applied to this CMake-only phase.

## Corrected validation attempt — native-PC gate

The requested corrected validation was rechecked on 2026-08-27. The RAM gate passed immediately before launcher execution:

```text
FREE_RAM_GB=14.16
```

The detached launcher’s own gate also passed:

```text
FreePhysicalMemory_GB=13.88
RequiredMinimum_GB=8
flags=DETACHED_PROCESS|CREATE_NEW_PROCESS_GROUP|CREATE_UNICODE_ENVIRONMENT|CREATE_BREAKAWAY_FROM_JOB
CMAKE_BUILD_PARALLEL_LEVEL=2
NINJAFLAGS=-j2
```

The prior `build-phase2` tree is explicitly Android/NDK-targeted (`android.toolchain.cmake`, ABI `arm64-v8a`, platform `android-26`) and was not used because this phase requires a PC-native compile and explicitly forbids NDK/Android work. Host-toolchain discovery found no `cl`, `clang`, `clang++`, `gcc`, or `g++`; no Visual Studio, LLVM, MinGW, or MSYS host installation was present. WSL exposed only a stopped `docker-desktop` distribution.

A detached native CMake configure was run with Idle priority, `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`, Ninja explicitly selected, and `-DLLAMA_BUILD_TESTS=ON`. It exited `1` before compilation. The durable logs are [cmake-detached-gate.txt](cmake-detached-gate.txt), [cmake-detached-result.txt](cmake-detached-result.txt), and [native-configure.log](native-configure.log). The exact CMake diagnostic was:

```text
-- The C compiler identification is unknown
-- The CXX compiler identification is unknown
CMake Error at CMakeLists.txt:2 (project):
  No CMAKE_C_COMPILER could be found.

  Tell CMake where to find the compiler by setting either the environment
  variable "CC" or the CMake cache entry CMAKE_C_COMPILER to the full path to
  the compiler, or to the compiler name if it is in the PATH.

CMake Error at CMakeLists.txt:2 (project):
  No CMAKE_CXX_COMPILER could be found.

  Tell CMake where to find the compiler by setting either the environment
  variable "CXX" or the CMake cache entry CMAKE_CXX_COMPILER to the full path
  to the compiler, or to the compiler name if it is in the PATH.

-- Configuring incomplete, errors occurred!
```

Therefore no full native compile occurred and no targeted ctest was run: the native test executables do not exist. The earlier missing-executable ctest results and `[6/550] ninja: build stopped: interrupted by user` remain historical evidence from the disallowed Android-configured attempt, not passing validation. No source changes were made during this validation attempt; branch `app-pin-compat` remains at `cb9fdd1f867afa53565a0547ceb8f86a79822857`, pushed to `origin/app-pin-compat`. No Gradle daemon was started.

**Historical status: BLOCKED — a PC-native C/C++ toolchain was not yet discovered. Superseded by the final q63-parity validation below.**

## Final q63-parity PC-native validation

Status: **BUILD PASSED; TARGETED TESTS PASSED 7/7.** This is the authoritative Phase 2 validation record; the earlier interrupted/invalid attempts above remain historical only.

### Recipe and controls

- The q63 proven recipe was read from `scratchpad/agents/q63-dense-htp-recipe/build_quantizer.cmd` and `build_perplexity.cmd`, plus their logs. It uses `VsDevCmd.bat -arch=x64`, the BuildTools CMake 3.31.6-msvc6 and Ninja, Release configuration, and the MSVC defaults initialized by that environment.
- The detached child executed the `VsDevCmd` bootstrap itself via [run-native-msvc-exact.cmd](run-native-msvc-exact.cmd), so the compiler environment did not depend on parent-process inheritance.
- CMake source/build: `C:\Users\gualt\kals-pin` → `C:\Users\gualt\kals-pin\build-phase2-native-q63c`.
- Configure included `-DLLAMA_BUILD_TESTS=ON`, CPU/native backend only, and q63's disabled CUDA/HIP/Vulkan/Metal/SYCL/RPC/OpenCL/Hexagon backends. `-DLLAMA_BUILD_SERVER=ON` was required because this tree's test CMake links `test-chat` against `server-context`; this is the only deliberate deviation from the q63 tool-only recipe.
- Detached launcher flags: `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_UNICODE_ENVIRONMENT | CREATE_BREAKAWAY_FROM_JOB`; process priority `IDLE_PRIORITY_CLASS`; `CMAKE_BUILD_PARALLEL_LEVEL=2`; `NINJAFLAGS=-j2`; CMake `--parallel 2`; one heavy job only.
- RAM gate immediately before launch: `FreePhysicalMemory_GB=12.26`, required minimum `8`. Free RAM after completion: `11.51 GB`.
- The corrected launcher result is [build-native-msvc-result.txt](build-native-msvc-result.txt):

```text
started=2026-08-27T12:48:34.5494850-04:00
ended=2026-08-27T12:57:06.6329253-04:00
wall_seconds=512.0834403
pid=17692
exit_code=0
priority=IDLE_PRIORITY_CLASS
recipe=VsDevCmd.bat -arch=x64; MSVC CMake/Ninja; CMAKE_BUILD_PARALLEL_LEVEL=2; NINJAFLAGS=-j2
```

- CMake configure output/logs: [cmake-native.log](cmake-native.log) and [cmake-native.err](cmake-native.err). The cache confirms q63 MSVC defaults: `CMAKE_CXX_FLAGS=/DWIN32 /D_WINDOWS /EHsc`, Release `/O2 /Ob2 /DNDEBUG`, `CMAKE_C_FLAGS=/DWIN32 /D_WINDOWS`, Release `/O2 /Ob2 /DNDEBUG`, linker `/machine:x64`, Release `/INCREMENTAL:NO`.
- Build output/error files: [build-native-msvc.log](build-native-msvc.log) and [build-native-msvc.err](build-native-msvc.err). The stderr contains only the known `VsDevCmd` warning, verbatim: `'vswhere.exe' is not recognized as an internal or external command, operable program or batch file.` The completed Ninja record has 501 entries in `C:\Users\gualt\kals-pin\build-phase2-native-q63c\.ninja_log`; the detached command exited `0`.

### Targeted ctest evidence

The runner [run-targeted-ctest.ps1](run-targeted-ctest.ps1) invoked the same `VsDevCmd` environment and ran serially with regex `^(test-sampling|test-reasoning-budget|test-chat.*|test-arg-parser)$`. Full output is [ctest-targeted.log](ctest-targeted.log), errors are [ctest-targeted.err](ctest-targeted.err), and timing/exit evidence is [ctest-targeted-result.txt](ctest-targeted-result.txt).

```text
1/7 Test #16: test-sampling ....................   Passed    2.08 sec
2/7 Test #17: test-reasoning-budget ............   Passed    0.09 sec
3/7 Test #22: test-chat ........................   Passed   10.31 sec
4/7 Test #26: test-chat-peg-parser .............   Passed    0.19 sec
5/7 Test #29: test-chat-auto-parser ............   Passed    1.33 sec
6/7 Test #30: test-chat-template ...............   Passed    0.35 sec
7/7 Test #35: test-arg-parser ..................   Passed    0.36 sec

100% tests passed, 0 tests failed out of 7
Total Test time (real) =  15.02 sec
```

`test-arg-parser` is the existing targeted coverage selected for the common-parameter/load-related surface; no separately named `load_mode` test exists in the configured suite. No source fix was required after the corrected q63-parity recipe. Branch `app-pin-compat` remains clean at `cb9fdd1f867afa53565a0547ceb8f86a79822857`, and that head is present at `origin/app-pin-compat`. No Android/NDK/device/Gradle work was performed in this phase.

## Hostile-review fixes and final validation (2026-08-27)

The review in `REVIEW_PHASE2.md` was read and addressed on `app-pin-compat`. The
final pushed head is `3b372c74906c94bd0919fafdcf73254fc15aafcd`.

### Fix decisions

- **F1:** The fork's two-argument `common_chat_templates_get_caps(tmpls, variant)`
  and `common_chat_templates_has_variant(tmpls, variant)` declarations/definitions
  were checked against llama.rn `scripts/patches/chat.h.patch` and
  `chat.cpp.patch`. Signatures are equivalent and the wrapper calls the equivalent
  `""`/`"tool_use"` variants. Phase 3 must remove the **caps hunks** from both
  bootstrap patches before regenerating `cpp/`; unrelated JSON/extra-fields and
  FunctionGemma hunks remain required. This is a hard Phase 3 prerequisite.
- **F2/F3:** The repository-wide assignment sweep found only the common-parameter
  post-parse mutation in `examples/training/finetune.cpp`; it now recomputes
  `load_mode` after forcing mmap off. `common_load_mode_from_flags()` and the
  conversion switch preserve all eight mmap/mlock/direct-IO combinations, rather
  than silently dropping mlock.
- **F4/F5/F6:** Reasoning forcing advances `force_pos` in `apply()`, not
  `accept()`, and the sampler no longer consumes generation-prompt/prefill tokens;
  counting starts on generated tokens. Immediate activation is allowed without a
  start sequence. The normal default path remains IDLE until its start matcher fires.
- **F11:** Invalid `load_mode` now throws
  `std::invalid_argument("invalid llama_load_mode")` instead of silently retaining
  default mmap behavior.
- **F16:** Added regression coverage for apply-time forced-position advancement,
  `common_sampler_init()` budget/forced-open behavior, all load-mode mappings plus
  out-of-enum rejection, and singular/plural `thinking_end_tags` synchronization.
  The sampler regression uses a fixed seed and `no_perf=true` because standalone
  construction does not initialize the ggml timing clock.

### Final build

Fresh build tree: `C:\Users\gualt\kals-pin\build-phase2-native-q63f`.
The detached child ran the q63 MSVC recipe itself (`VsDevCmd.bat -arch=x64`),
Release CPU/native CMake/Ninja, `-DLLAMA_BUILD_TESTS=ON`,
`CMAKE_BUILD_PARALLEL_LEVEL=2`, `NINJAFLAGS=-j2`, CMake `--parallel 2`, and
Idle priority. The pre-launch gate was `FREE_RAM_GB=14.85` (minimum 8); free RAM
stayed above 13.6 GiB. `build-native-msvc-result.txt` records:

```text
started=2026-08-27T14:25:32.8874691-04:00
ended=2026-08-27T14:33:50.1205508-04:00
wall_seconds=497.2330817
pid=13808
exit_code=0
priority=IDLE_PRIORITY_CLASS
recipe=VsDevCmd.bat -arch=x64; MSVC CMake/Ninja; CMAKE_BUILD_PARALLEL_LEVEL=2; NINJAFLAGS=-j2
```

The clean Ninja log contains `501` completed entries. Build stderr contains only
the existing bootstrap warning:

```text
'vswhere.exe' is not recognized as an internal or external command,
operable program or batch file.
```

### Final tests

The full configured suite has 58 tests. The final detached/Idle/serial run is in
`build-native-msvc-result-all-ctest.txt` and exited 8 because one existing host
capability skip is not registered as a CTest skip:

```text
started=2026-08-27T14:34:10.5538234-04:00
ended=2026-08-27T14:36:24.8656255-04:00
wall_seconds=134.3118021
pid=51776
exit_code=8
priority=IDLE_PRIORITY_CLASS
```

`Testing/Temporary/LastTestsFailed.log` contains exactly:

```text
45:test-repack-q23k-load
```

Full result: **57 passed, 1 failed out of 58**. The sole failure is verbatim:

```text
**** SKIP: no Q2_K_8x4/Q3_K_8x4 trait selected (neon=0 dotprod=0 extra=null). This host cannot cover the 3-D q23k load contract. Run on armv8.2+dotprod. exit=77 ****
test-repack-q23k-load neon=0 dotprod=0 loader_set=0
```

It is not caused by the backports and no test code was changed to mask it. The
required wrapper-reachable targeted set passed 7/7 (`ctest-targeted.log`):

```text
1/7 Test #16: test-sampling ....................   Passed    1.95 sec
2/7 Test #17: test-reasoning-budget ............   Passed    0.02 sec
3/7 Test #22: test-chat ........................   Passed   10.93 sec
4/7 Test #26: test-chat-peg-parser .............   Passed    0.11 sec
5/7 Test #29: test-chat-auto-parser ............   Passed    1.24 sec
6/7 Test #30: test-chat-template ...............   Passed    0.28 sec
7/7 Test #35: test-arg-parser ..................   Passed    0.16 sec

100% tests passed, 0 tests failed out of 7
Total Test time (real) =  14.75 sec
```

The branch is clean and `origin/app-pin-compat` points to
`3b372c74906c94bd0919fafdcf73254fc15aafcd`. No NDK, Android, device, Gradle,
ai-chat, or authoritative WIP checkout was touched.
