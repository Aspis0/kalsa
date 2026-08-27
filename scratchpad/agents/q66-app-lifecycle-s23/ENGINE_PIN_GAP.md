# ENGINE_PIN_GAP — q66 Phase 1 consolidated

Status: COMPLETE. This is the read-only integration of the two mapper reports. No
Phase 2 backports, source edits, submodule changes, app changes, or new builds were
started.

Date: 2026-08-27

## Inputs, pins, and scope

The inputs were read to their terminal `COMPLETE` markers:

- [GAP_JSI.md](GAP_JSI.md): 361 lines, wrapper symbol surface and the reported
  compile-risk list.
- [GAP_MTMD_CMAKE.md](GAP_MTMD_CMAKE.md): 208 lines, bootstrap file closure,
  CMake enumeration, MTMD, and non-JSI patch scope.
- [WEBSEARCH_ENGINE_PIN.md](WEBSEARCH_ENGINE_PIN.md): official llama.rn
  submodule/bootstrap mechanism and release timeline.

Compared trees:

| Side | Location / pin |
|---|---|
| llama.rn package and wrapper | `C:\Users\gualt\q66c\node_modules\llama.rn` @ `0.12.8`, app patch applied |
| llama.rn bootstrap reference | `llama.rn-src` @ tag `v0.12.8`, commit `ce7f5fff26d563e506a7333a5d8791218d0de266`, with the q66 staging edits recorded below |
| kalsallama engine | `BigMoeOnEdge\third_party\llama.cpp` @ `a0cabca6b1b3248a92e05a8633fd0d82cf776e75` |
| fork merge-base used for lineage inspection | `90e0f5cfcb6cdb4b7b60a4f81b0a26e542149ad5` |

The generated `cpp/` tree is the integration target. Engine names in the fork are
unprefixed; bootstrap rewrites them to `lm_ggml_*` / `LM_GGML_*` and corresponding
`lm_gguf_*` names. A header or symbol is considered available only after that
generated-tree transformation and the post-generation bootstrap patches are both
accounted for.

## Verification corrections

The mappers reported ten hard blockers. Direct spot checks against the actual
include/source closure change that count to nine definitive fork compatibility
blockers:

1. `llama_log_callback_default` is not a gap. The fork has the declaration in
   `src/llama-impl.h` and the implementation in `src/llama-impl.cpp`; the wrapper's
   `rn-llama.h` includes `llama-impl.h`. The generated fork tree therefore supplies
   the symbol. Do not backport a duplicate declaration or implementation.
2. `llama_get_ctx_other` is also already present in the fork's
   `src/llama-ext.h`/`src/llama-context.cpp` closure. It is not an extra fork gap;
   preserve the generated source when pinning.
3. Both the shipped q66 package and the fork declare
   `common_params_sampling::logit_bias` as `std::vector<llama_logit_bias>`. The
   wrapper's token-indexed `operator[]` use is a pre-existing semantic/robustness
   risk, but it is not a kalsallama-only API mismatch and is not a backport item.

The following checks corroborate the remaining map: q66's `JSIParams.cpp` reads
`load_mode`, `vocab_only`, and `reasoning_budget_activate_immediately`; q66's
`RNLlamaJSI.cpp` uses plural `thinking_end_tags`, the two-argument chat-cap API,
and the progress callback; q66's `rn-mtmd.hpp:283` writes `text_len`; the fork has
the singular/flat/renamed forms or no member as described below. The fork's current
`common.h` contains the older reasoning-budget fields plus `reasoning_control`, but
not the immediate-activation field. `acb7c7906` (#20297) is in the current fork
ancestry; `e6dd0e29a` (#20834) and `910196f6b` (#25544) are not ancestors of the
current fork HEAD, consistent with the current file shapes.

## 1. Definitive compatibility backport list for kalsallama

Size legend: S is a field, alias, declaration, or small function; M is a coherent
change across one to three files; L is a multi-file feature chain whose parser,
sampler, chat, continuation, or tests must remain semantically consistent.

### 1.1 Required wrapper-facing API compatibility

| Item | Wrapper use | Fork state | Files to change in the fork/generated source | Provider and estimate |
|---|---|---|---|---|
| `common_params.load_mode` and `LLAMA_LOAD_MODE_*` | `cpp/jsi/JSIParams.cpp:363-379` | Missing; fork still has `use_mmap`, `use_mlock`, and `use_direct_io` | `include/llama.h`, `common/common.h`, `common/common.cpp`; optionally `common/arg.cpp` and loader files for full CLI/loader parity | Upstream #20834, merge `e6dd0e29a`. M for the wrapper-compatible enum/field/conversion; L for the complete direct-I/O and loader chain. |
| `common_params.progress_callback` and `_user_data` | `cpp/jsi/RNLlamaJSI.cpp:556-589` | Fork exposes only `load_progress_callback` and `_user_data` | `common/common.h` plus `common/common.cpp` conversion; retain the fork's loader names internally or add an explicit wrapper-name alias | S/M. A field-only alias is insufficient unless conversion gives the callback to model loading. |
| `common_params.vocab_only` | `cpp/jsi/JSIParams.cpp:324-334` | Missing on `common_params`; present only on `llama_model_params` | `common/common.h`, `common/common.cpp` (`common_model_params_to_llama`) | S. Add the common field and thread it to the existing model parameter. |
| `reasoning_budget_activate_immediately` | `cpp/jsi/JSIParams.cpp:516,554-555` | Missing; fork has the reasoning sampler and `reasoning_control` instead | `common/common.h`, `common/sampling.cpp`, and the fork reasoning-budget API/state as needed | #20297 / llama.rn bootstrap patch `eafd3f3`. M for a coherent compile-compatible branch; do not add only a dead field. |
| Multiple `reasoning_budget_end` sequences | `cpp/jsi/JSIParams.cpp:547` pushes a token vector into a vector of sequences | Fork is flat `std::vector<llama_token>` | `common/common.h`, `common/sampling.cpp`, `common/reasoning-budget.{h,cpp}`, `common/chat.{h,cpp}` as required by the chosen semantics | #25544, `910196f6b`, plus its reasoning-budget consumers. M for a deliberately limited adapter; L for the real multi-end-sequence matcher/replay/continuation behavior. |
| `common_chat_params.thinking_end_tags` | `cpp/jsi/RNLlamaJSI.cpp:256,878-879` | Fork has singular `std::string thinking_end_tag` | `common/chat.h`, `common/chat.cpp`, and all chat/reasoning consumers | #25544. M/L; changing only the member type is not enough for parser and sampler behavior. |
| `common_chat_templates_has_variant(tmpls, variant)` | `cpp/jsi/RNLlamaJSI.cpp:302,318` | Absent from fork headers | `common/chat.h`, `common/chat.cpp` | llama.rn's `chat.h.patch` / `chat.cpp.patch` generated compatibility surface. S. |
| Variant `common_chat_templates_get_caps(tmpls, variant)` and caps struct | `cpp/jsi/RNLlamaJSI.cpp:303-325` | Fork has only the one-argument map-returning API | `common/chat.h`, `common/chat.cpp` | llama.rn's chat bootstrap patches. S/M; preserve the fork's existing one-argument API if other fork code uses it. |
| `mtmd_input_text.text_len` | `cpp/rn-mtmd.hpp:283` | Absent from `tools/mtmd/mtmd.h` | `tools/mtmd/mtmd.h` in the pinned fork, then generated `cpp/tools/mtmd/mtmd.h` | S. The fork's MTMD code does not need new behavior for this field. |

The reasoning rows are one compatibility group. The fork already contains the
#20297-era reasoning budget implementation and later fork-specific control behavior;
the required work is to choose and implement a coherent surface, not to paste the
0.12.8 fields independently. Full #25544 parity is an L effort. A q66 compile-only
minimum can be smaller, but must be explicitly tested for the fork's semantics.

### 1.2 Bootstrap closure items

The fixed q66 bootstrap copy list contains these two sources that do not exist in
the fork:

| Missing source | Current consequence | Recommended Phase 2 action | Size |
|---|---|---|---|
| `common/trie.h` | `cp` fails under `bash -e` before the patch loop | Delete or conditionally skip the copy line. The fork's current `peg-parser`/reasoning implementation has no live include of this file. If full #25544 trie-based semantics is selected, restore it as part of that L chain instead. | S to remove/guard; M/L only if actually backporting the trie implementation |
| `common/trie.cpp` | Same bootstrap abort; `COMMON_FILES` would otherwise glob it automatically | Same disposition as `trie.h` | S to remove/guard; M/L only with the full reasoning matcher |

The two bootstrap patches that must be realigned against fork content are:

- `scripts/patches/common.h.patch`: hunks adding `vocab_only` and the wrapper
  progress callback apply to the fork; its first hunk assumes the 0.12.8 vector
  reasoning-end block and fails. Rebase that hunk onto the fork's flat-end,
  `reasoning_control` block while making the chosen reasoning design explicit.
- `scripts/patches/sampling.cpp.patch`: its context expects the 0.12.8 braced
  five-argument call and adds the immediate-activation branch. The fork's call is
  unbraced and uses its own `reasoning_control` gate. Rebase the hunk to the fork's
  actual signature/state machine; do not force the old context.

The mapper's dry-run found 2 of 16 bootstrap patches failing for this reason and
the remaining patches applying to the prefix-transformed fork tree. The two fixes
are M as a compatibility pair, or part of the L reasoning backport if full
multi-sequence semantics is adopted.

### 1.3 Kalsallama work already present — preserve, do not re-backport

These are the native features the app ultimately needs. They are already in
kalsallama at `a0cabca6b`; Phase 2 must make bootstrap regenerate them, not recreate
them as an independent graft:

| Lineage | Exact fork files | State / estimate |
|---|---|---|
| Q2/Q3 K 8x4 repack and expert-ready hook | `ggml/include/ggml-cpu.h`; `ggml/src/ggml-cpu/arch-fallback.h`; `ggml/src/ggml-cpu/arch/arm/quants.c`; `ggml/src/ggml-cpu/arch/arm/repack.cpp`; `ggml/src/ggml-cpu/ggml-cpu.c`; `ggml/src/ggml-cpu/ops.cpp`; `ggml/src/ggml-cpu/repack-q23k.h`; `ggml/src/ggml-cpu/repack.cpp`; `ggml/src/ggml-cpu/repack.h`; `ggml/src/ggml-cpu/traits.cpp` | Present. L-sized native payload if reimplemented; zero backport work. The new `repack-q23k.h` is load-bearing for three CPU files and must be included by bootstrap. |
| `mmap_prefetch` hook | `include/llama.h`; `src/llama-model.cpp` | Present. S/M-sized native payload; preserve. The fork's `src/llama-mmap.cpp/.h` are not changed by this lineage diff, so do not invent a separate mmap-file backport. Commits are `206a8fe7f` plus ABI fix `e5605f3bd`. |

The generated mapping for the repack group is `ggml/src/ggml-cpu/**` to
`cpp/ggml-cpu/**`; `repack.cpp` is already covered by the CPU C++ glob, while the
new header is not a source-list entry and must be copied by bootstrap.

## 2. Pin, bootstrap, and generated-tree mechanism

The official mechanism is a pinned submodule, not an external source-directory
variable:

1. Keep the literal submodule path `third_party/llama.cpp`, change its remote/pin
   to the exact kalsallama commit, and record the llama.rn commit and engine commit
   together.
2. Run `npm run bootstrap` from the llama.rn root in Git Bash/MSYS2 (the script is
   POSIX Bash, not a native PowerShell recipe).
3. Bootstrap copies the selected engine files, rewrites the `ggml`/`gguf` symbols
   with the `LM_`/`lm_` prefix, regenerates metadata, and applies
   `scripts/patches/*.patch` after generation.
4. On Android, `rnllamaBuildFromSource=true` (selected by the app's source-build
   setup) makes Gradle compile the generated tree. It does not redirect the source
   path and it must not be tested against downloaded prebuilt libraries.

The q66 staging copy has four local bootstrap edits, already recorded in the
mapper/PREP history: it expects the engine to be pre-staged instead of updating a
submodule, adds the `repack-q23k.h` copy at bootstrap line 166, skips the example
`npm install`, and takes build metadata from Kalsa environment variables. These
are staging aids, not yet an app-main implementation. The two `common/trie` copy
lines and two reasoning patch hunks remain the explicit Phase 2 work.

### 2.1 Definitive path map from bootstrap.sh

| Engine source | Generated `cpp/` destination | Rule |
|---|---|---|
| Selected `ggml/include/ggml*.h`, `gguf.h` | `cpp/ggml*.h`, `cpp/gguf.h` | Explicit copies; only selected public headers enter the package. |
| Selected `ggml/src/ggml-cpu/*` plus `amx`, `arch/arm`, `arch/x86` | `cpp/ggml-cpu/**` | Root CPU files are explicit; architecture directories are copied recursively. |
| `ggml/src/ggml-metal`, `ggml-blas`, `ggml-opencl`, `ggml-hexagon` | Same-named `cpp/` directories | Recursive copies with selected CMake files removed/retained as the script specifies. |
| Selected `ggml/src` core C/C++ files | `cpp/` root | Explicit copies such as `ggml.c`, backend files, `gguf.cpp`, and threading files. |
| `include/llama.h`, `include/llama-cpp.h` | `cpp/llama.h`, `cpp/llama-cpp.h` | Explicit public API copies. |
| `src/models` | `cpp/models/` | Whole directory copy; the Android CMake model glob follows its resulting contents. |
| Selected `src/llama*.{h,cpp}` | `cpp/llama*.{h,cpp}` | Explicit copies including context, model, mmap, impl, ext, memory, vocab, and sampler files. |
| `src/unicode*` | `cpp/unicode*` | Explicit copies. |
| Selected `common/*` | `cpp/common/*` | Explicit copies; `common/jinja` is copied with the script's string-header rename. |
| `tools/mtmd` named files plus `models` and `debug` directories | `cpp/tools/mtmd/**` | The fork's self-consistent MTMD set is regenerated; q-only model files may disappear. |
| `vendor/nlohmann`, `vendor/miniaudio`, `vendor/stb` | `cpp/nlohmann`, `cpp/tools/mtmd/miniaudio`, `cpp/tools/mtmd/stb` | Vendor copies; miniaudio/stb are MTMD support. |
| llama.rn `cpp/rn-*`, `cpp/jsi/*`, `cpp/anyascii.c`, `cpp/ggml-ext.h` | Remain llama.rn-owned | Not copied or prefix-rewritten by bootstrap. App patch-package hunks target these files separately. |

## 3. CMake scope for the q66 APK

The app Android engine file is
`node_modules/llama.rn/android/src/main/rnllama/CMakeLists.txt`. Its CPU-relevant
source enumeration is:

- globbed `models/*.cpp`, `ggml-cpu/*.c`, `ggml-cpu/*.cpp`, `ggml-cpu/amx/*.cpp`,
  root `llama*.cpp`, `common/*.cpp`, `common/jinja/*.cpp`, and the MTMD groups;
- explicit core GGML files, unicode, `anyascii.c`, and llama.rn RN wrapper files;
- arm64 CPU targets `rnllama`, `rnllama_v8`, `rnllama_v8_2`,
  `rnllama_v8_2_dotprod`, `rnllama_v8_2_i8mm`, and
  `rnllama_v8_2_dotprod_i8mm`.

For the first q66 APK, the intended CMake scope is arm64 CPU only. The q23k header
does not need a new CMake source entry: `repack.cpp` is already in the CPU glob and
the header is included by the fork sources. `common/trie.cpp` disappears cleanly
from the common glob if its copy lines are removed; it must not be left as a
dangling explicit copy failure.

Explicitly out of scope for this APK and listed as later work:

- `rnllama_v8_2_dotprod_i8mm_hexagon_opencl` and its Hexagon host QAIC
  `ggml-hexagon/htp/v73` artifacts. The current CMake has a fatal existence check;
  regenerating those artifacts belongs to a separate Hexagon build.
- OpenCL's explicit `cl-program-cache.cpp` entry and kernel embed list drift. The
  fork lacks `cl-program-cache.cpp`, has 17 dead upstream kernel entries, and has
  six fork kernels that would need adding. Later work should prune 17/add 6 and
  remove or replace the cache source.

The structural map reports zero CPU-target compile breaks after the trie-copy
failure and the two reasoning patch failures are handled. That is a source/CMake
closure result, not a substitute for the later arm64 Android build.

## 4. MTMD verdict: keep it in the first pin

Keep MTMD compiled for the first kalsallama pin.

- The fork's MTMD core and its copied model set regenerate as a self-consistent
  CPU tree. `mimo-audio.cpp` and `minimax-m3.cpp` from the 0.12.8 package may
  disappear, which means loss of those model/projector capabilities at runtime,
  not a CPU compile break.
- The wrapper has no `RNLLAMA_DISABLE_MTMD`, `BUILD_MTMD`, or equivalent guard.
  `rn-llama.cpp`, `rn-mtmd.hpp`, `rn-completion.cpp`, and `rn-slot-manager.cpp`
  use MTMD directly. Excluding it would require RN-wrapper and CMake edits and
  would be a larger, unrelated change for q66.
- Keep the small `mtmd_input_text.text_len` compatibility field in the fork.
- If MiniMax/MiMo audio/vision support becomes a product requirement, restore and
  validate the complete matching model/API set as a later L effort. Do not mix
  individual q-only model files into the pinned generated tree.

## 5. App patch and non-JSI survival

`ai-chat/patches/llama.rn+0.12.8.patch` is 196 lines and targets six llama.rn-owned
files:

| File | Patch surface | Bootstrap interaction |
|---|---|---|
| `cpp/jsi/JSIParams.cpp` | 3 logical changes | JSI-owned; bootstrap does not copy it. |
| `cpp/jsi/JSISession.h` | 1 change | JSI-owned; bootstrap does not copy it. |
| `cpp/jsi/RNLlamaJSI.cpp` | 1 change | JSI-owned; bootstrap does not copy it. |
| `cpp/rn-completion.cpp` | 3 hunks | `rn-*` is explicitly skipped by prefix/copy pass; survives. |
| `cpp/rn-llama.cpp` | 2 hunks | Same; survives. |
| `cpp/rn-slot.cpp` | 1 hunk | Same; survives. |

The non-JSI changes are DFlash handling, batch-thread passthrough, context-type
fallback, and KALSA diagnostics/marker behavior. The app patch does not modify
generated engine files and should apply verbatim after engine regeneration; the
compatibility work above is what makes the unchanged wrapper compile against the
fork. The llama.rn `scripts/patches/chat.cpp.patch` and other bootstrap patches are
a separate generated-engine layer and must continue to run after bootstrap.

## 6. R1 versus R2 decision

### R1 — recommended: llama.rn 0.12.8 plus compatibility backports into the fork

R1 is strongly favored.

Reasons:

- It preserves the app's current 0.12.8 wrapper and the already-applicable
  196-line app patch. The patch targets are outside bootstrap's generated engine
  set, so there is no six-file version rebase before the engine work is even
  tested.
- It lets the fork's q23k/repack and mmap-prefetch work remain authoritative and
  be regenerated through the official submodule path, prefix rewrite, and patch
  loop.
- The CPU structural map found only two bootstrap patch divergences plus the
  listed wrapper-facing API compatibility items. MTMD is internally clean and
  has no supported exclusion switch.
- The current fork does include the #20297-era reasoning-budget base, but its
  current shape has fork-specific `reasoning_control` and a flat end sequence.
  That is a bounded realignment problem, not evidence that the whole feature must
  be replaced.

R1 must still be honest about feature size:

- Minimum q66 compile-compatible load-mode surface: M; complete #20834 loader and
  direct-I/O parity: L.
- Minimum immediate-reasoning surface: M; complete multiple-end-sequence
  #25544 semantics, trie/matcher, replay, and continuation behavior: L.
- Chat variant/cap APIs: S/M.
- Progress/vocab fields and MTMD text length: S/M together.
- Bootstrap closure and two patch realignments: M, or included in the reasoning L
  chain.

Estimated R1 total: **24–40 focused engineering hours**, approximately **4–7
working days including Android build, device smoke, and lifecycle validation**.
The lower half assumes q66 needs compile/runtime compatibility rather than every
server/CLI behavior from the full upstream feature chains. Full upstream semantic
parity, especially #25544, should be budgeted at the upper end or beyond it.

### R2 — fallback: pair an older llama.rn release with the fork era

The release-history candidate is llama.rn **v0.12.5**, whose named engine snapshot
is **b9769** (2026-06-24). The fork merge-base is 2026-07-08; v0.12.6/b9982 is
after that point, while v0.12.8 names b10156. The exact v0.12.5 submodule gitlink
must be verified before using this route; it is a candidate pairing, not yet a
pin decision.

This older wrapper era avoids the later `load_mode` and plural
`thinking_end_tags` expectations and keeps singular thinking tags, but it does not
remove the need to regenerate the fork or validate the remaining chat, progress,
vocabulary, and MTMD surfaces. It also requires rebasing the app patch across the
changed wrapper files:

- `cpp/jsi/JSIParams.cpp` — the DFlash/thread/context-related changes;
- `cpp/jsi/JSISession.h` — state/session change;
- `cpp/jsi/RNLlamaJSI.cpp` — native binding/marker change;
- `cpp/rn-completion.cpp` — DFlash, batch/thread, and diagnostics hunks;
- `cpp/rn-llama.cpp` — context/model integration hunks;
- `cpp/rn-slot.cpp` — slot integration hunk.

That is the exact app-patch target surface, not a claim that every line will
conflict. R2 estimate: roughly **20–36 focused hours** with higher uncertainty,
because the old wrapper/core pair must be rebuilt and the six-file patch rebase
must be followed by a fork compatibility audit. R2 is therefore a fallback if R1's
coherent backports prove unstable, not the current recommendation.

The release evidence and mechanism are recorded in
[WEBSEARCH_ENGINE_PIN.md](WEBSEARCH_ENGINE_PIN.md), including the official
[llama.rn release history](https://github.com/mybigday/llama.rn/releases),
[bootstrap script](https://raw.githubusercontent.com/mybigday/llama.rn/v0.12.4/scripts/bootstrap.sh),
and the direct [ChatterUI/cui-llama.rn precedent](https://github.com/Vali-98/cui-llama.rn).

## 7. Open risks and phase boundary

- No Phase 2 source backport has been implemented or compile-tested. The CPU
  zero-break result is a structural dry-run, not a release artifact.
- Reasoning budget and load-mode changes must be ported as coherent behavior;
  field-only shims can compile and still change token forcing or model loading.
- Prefix-transformed patch contexts must be checked after bootstrap. A patch that
  applies to unprefixed fork files is not automatically correct in `cpp/`.
- The q-only MiniMax/MiMo model files disappearing is a runtime capability loss;
  it is not justification for hand-copying files from the 0.12.8 package.
- Hexagon/OpenCL are not validated by the q66 CPU APK plan and remain later work.
- `logit_bias` remains a shared wrapper semantic risk and should be addressed only
  with a dedicated behavioral decision; it is not part of the kalsallama pin gap.
- The app repo and authoritative kalsallama checkout remain untouched. Phase 2 and
  Phase 3 require owner review of this file first.

## Fallback APK status

The CI-parity fallback is retained and recorded in [PREP.md](PREP.md):

- APK: `C:\Users\gualt\q66c\android\app\build\outputs\apk\release\app-release.apk`
- SHA-256: `444CCC8D7116D7CC07ED1998272E21E36C46D59C13CDE63FA148D68199BA7608`
- It is **not** a kalsallama-engine artifact: packaged arm64 libraries contained
  `kalsa-native-patches` only in `librnllama_jni*.so`; `mmap_prefetch`,
  `mmap-prefetch-opt`, `repack-q23k`, `q23k`, `a0cabca6b`, and `kalsallama` were
  absent.
- No S23 installation was performed.

Phase 1 is complete. No implementation should begin until this gap list and the
R1 decision are reviewed.
