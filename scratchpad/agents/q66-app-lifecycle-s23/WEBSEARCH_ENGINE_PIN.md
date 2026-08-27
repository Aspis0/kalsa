# llama.rn with a custom/forked llama.cpp

Research date: 2026-08-27. Scope: `mybigday/llama.rn` around v0.12.x, with current-main files checked where they document the same workflow. The short answer is that llama.rn does **not** expose a supported “external llama.cpp checkout” path. Its established integration point is the checkout at the fixed path `third_party/llama.cpp`; `scripts/bootstrap.sh` copies and transforms selected upstream files into the package’s generated `cpp/` tree, and the iOS/Android source builds compile that generated tree.

## 1. Official llama.rn mechanism

### Distribution versus source build

The npm package downloads a release-matched iOS `rnllama.xcframework` and Android native libraries during `postinstall`. iOS consumers use the prebuilt framework by default; setting `RNLLAMA_BUILD_FROM_SOURCE=1` in the Podfile selects the C++ sources. Android consumers use prebuilt `.so` files by default; setting `rnllamaBuildFromSource=true` in `android/gradle.properties` selects the source build. The example app enables source builds and the example README explicitly says it builds llama.rn from source by default, with commands to build replacement frameworks/libs.

Sources: [llama.rn README](https://github.com/mybigday/llama.rn), [maintainer development guide](https://github.com/mybigday/llama.rn/blob/main/AGENTS.md), [example README](https://github.com/mybigday/llama.rn/blob/main/example/README.md), [v0.12.4 Podspec](https://raw.githubusercontent.com/mybigday/llama.rn/v0.12.4/llama-rn.podspec), [Android CMake](https://raw.githubusercontent.com/mybigday/llama.rn/v0.12.4/android/src/main/CMakeLists.txt).

Important distinction: `RNLLAMA_BUILD_FROM_SOURCE` / `rnllamaBuildFromSource` are **artifact-selection switches**, not source-location switches. They decide whether the native target is compiled from the package’s `ios/**/*` + `cpp/**/*` or linked from packaged artifacts. They do not point CMake at another llama.cpp checkout.

### What `bootstrap.sh` does

The v0.12.4 script starts with:

```sh
LLAMA_DIR=third_party/llama.cpp
CPP_DIR="$ROOT_DIR/cpp"
SRC_DIR="$ROOT_DIR/src"
git submodule init "$LLAMA_DIR"
git submodule update --recursive "$LLAMA_DIR"
```

The [v0.12.4 bootstrap script](https://raw.githubusercontent.com/mybigday/llama.rn/v0.12.4/scripts/bootstrap.sh) then mirrors these groups into `cpp/`:

| Upstream group | Generated destination and treatment |
|---|---|
| `ggml` | Public headers such as `ggml.h`, `ggml-backend.h`, `ggml-cpu.h`, `ggml-metal.h`, `gguf.h`; CPU sources/architectures; core ggml C/C++ sources; Metal, BLAS, OpenCL, and Hexagon trees. It removes standalone CMake files where llama.rn builds those sources directly. |
| `src` / llama API | `include/llama.h` and `llama-cpp.h` become `cpp/llama.h` and `cpp/llama-cpp.h`; `src/models` becomes `cpp/models`; the selected `src/llama*.{h,cpp}` implementation files, KV/memory/loader/model/batch/architecture files become top-level `cpp/*`. |
| `common` | `cpp/common/` is recreated from upstream common headers/sources: logging, argument/common parameter types, sampling/speculative decoding, chat/Jinja/parser helpers, Unicode, reasoning-budget support, fit/build-info helpers, and related files. |
| `tools/mtmd` | `cpp/tools/mtmd/` is recreated from upstream MTMD sources, including `mtmd.h/.cpp`, `clip.*`, media/model helpers, model implementations, and debug sources where applicable; bundled `miniaudio`/`stb` dependencies are copied as needed. |
| `jsi` | This is **not** an upstream llama.cpp group. `cpp/jsi/` is llama.rn’s own React-Native JSI bridge and remains maintained in the llama.rn tree. The bootstrap script has no `jsi` copy step. The RN-specific `rn-*` wrapper files are also excluded from the upstream prefix-rewrite pass. |

After copying, the script rewrites the mirrored symbols to avoid collisions with other RN native libraries: `GGML_` → `LM_GGML_`, `ggml_` → `lm_ggml_`, `GGUF_` → `LM_GGUF_`, and `gguf_` → `lm_gguf_`. It skips `cpp/rn-*` and the local compatibility shim `ggml-ext.h`. It also embeds the Metal source into `ggml-metal-embed.s`, generates `src/version.ts` from the submodule commit/count, generates `cpp/common/build-info.cpp`, and applies every `scripts/patches/*.patch` with `patch -p0 -d ./cpp`.

The current-main [bootstrap script](https://raw.githubusercontent.com/mybigday/llama.rn/main/scripts/bootstrap.sh) makes the same contract especially explicit: the path is still a literal `third_party/llama.cpp`; it uses upstream `CMakeLists.txt` for the generated version header; the prefix pass enumerates `ggml-*`, `models`, `tools/mtmd`, top-level llama files, and `common`; and the patch loop runs after generation. Current main also mirrors `codec.cpp`, which is an additional current-main concern but not part of the basic v0.12.4 engine swap.

The [C++ README](https://github.com/mybigday/llama.rn/blob/main/cpp/README.md) says the mirrored files are generated from the submodule and should not be edited as the durable source of truth: change the submodule and rerun bootstrap, or encode a local behavior change as a patch under `scripts/patches/`.

### Is there an external-checkout variable/configuration?

I found no supported `LLAMA_CPP_DIR`, `LLAMA_DIR`, or equivalent external-checkout environment variable in the official v0.12.4/current scripts. The script assigns `LLAMA_DIR=third_party/llama.cpp` and immediately initializes/updates that submodule. The official sync script also hardcodes `LLAMA_DIR="third_party/llama.cpp"`.

The [maintainer sync script](https://raw.githubusercontent.com/mybigday/llama.rn/v0.12.4/scripts/sync-llama-cpp-submodule.sh) fetches an upstream llama.cpp release tag, checks it out in that submodule, commits the gitlink, runs `npm run bootstrap`, and commits the generated `cpp/` changes. The [scheduled sync workflow](https://raw.githubusercontent.com/mybigday/llama.rn/v0.12.4/.github/workflows/sync-llama-cpp.yml) checks out recursive submodules, runs that sync/bootstrap process, then builds/tests Android and iOS artifacts. This is a pin-and-regenerate workflow, not a link-to-an-arbitrary-checkout workflow.

For modified sources, the documented workflow is: modify the C++ source or the pinned submodule; run `npm run bootstrap`; enable the example source builds while developing; and, if the change is not actually in the forked submodule, create a reproducible patch under `scripts/patches/`. Issue [#301](https://github.com/mybigday/llama.rn/issues/301) confirms the practical trap: edits under `cpp/` do nothing against the default prebuilt xcframework until `RNLLAMA_BUILD_FROM_SOURCE=1` is set before `pod install`.

## 2. Prior art and what actually worked

### Strongest direct precedent: ChatterUI / cui-llama.rn

[ChatterUI](https://github.com/Vali-98/ChatterUI) uses a custom adapter, [`cui-llama.rn`](https://github.com/Vali-98/cui-llama.rn), rather than the stock package. The adapter is a fork of llama.rn for ChatterUI-specific features. Its [`.gitmodules`](https://raw.githubusercontent.com/Vali-98/cui-llama.rn/main/.gitmodules) keeps the expected path but changes the source to:

```ini
[submodule "third_party/llama.cpp"]
path = third_party/llama.cpp
url = https://github.com/Vali-98/llama.cpp
branch = cui-llama.rn
```

Its [bootstrap script](https://raw.githubusercontent.com/Vali-98/cui-llama.rn/main/scripts/bootstrap.sh) still uses `LLAMA_DIR=third_party/llama.cpp`, copies the same families, applies the same `LM_`/`lm_` prefixing, and applies patch files. This is the clearest evidence for the recommended fork integration: change the submodule remote/branch or pin, preserve the expected path, then rerun bootstrap. It is not an external CMake include path.

### llama.rn’s own patch precedent

When the llama.rn submodule pin was older than a needed upstream feature, the maintainer used bootstrap patches rather than trying to mix an independently built library. Commit [`eafd3f3`](https://github.com/mybigday/llama.rn/commit/eafd3f3), “fix: add bootstrap patches for reasoning budget,” adds `scripts/patches/common.h.patch` and `scripts/patches/sampling.cpp.patch`. The patch adds `reasoning_budget_activate_immediately` and changes sampler construction to use either `REASONING_BUDGET_COUNTING` or prompt-prefill state. This is a concrete, maintained example of the `scripts/patches/` route for a version gap.

### llama.node

The sibling [llama.node developer guide](https://github.com/mybigday/llama.node/blob/main/AGENTS.md) describes a related but separate arrangement: llama.node has its own `src/llama.cpp` and `src/llama.rn` submodules, copies the shared RN implementation during build, applies patches, and performs the inverse prefix conversion (`lm_ggml` → `ggml`, etc.). It explicitly uses a generated patch for its Barbet architecture and provides [`scripts/regenerate-patch.sh`](https://github.com/mybigday/llama.node/blob/main/scripts/regenerate-patch.sh). That is useful prior art for keeping fork-specific changes reproducible, but it is not evidence that llama.rn accepts an arbitrary external checkout.

### PocketPal AI, ChatterUI, cactus, smolchat

PocketPal publishes a [llama.rn fork/package](https://www.npmjs.com/package/%40pocketpalai/llama.rn) and describes it as aiming for parity with upstream while carrying fixes/integrations. The [PocketPal app](https://github.com/a-ghorbani/pocketpal-ai) is therefore relevant fork-maintenance prior art, but I did not find a primary-source declaration that it points llama.rn at an independently located llama.cpp checkout; the app’s documented dependency path is the packaged llama.rn pin.

ChatterUI is the case with affirmative custom-engine evidence: its README says the local mode uses `cui-llama.rn`. By contrast, [cactus-react-native](https://github.com/cactus-compute/cactus-react-native/) is a separate React-Native native stack rather than a llama.rn source-swap recipe, and [SmolChat-Android](https://github.com/shubham0204/SmolChat-Android) uses its own JNI/native inference integration. I found no relevant external-checkout contract in those projects.

### Version mismatch evidence

llama.rn’s release notes show that each release is coupled to a specific llama.cpp snapshot: v0.12.3 carries b9254, and v0.12.4 syncs b9297 and then b9309. See the [release history](https://github.com/mybigday/llama.rn/releases). The issues show why mixing independently selected versions is risky:

* [#336](https://github.com/mybigday/llama.rn/issues/336) records v0.12.0-rc.4/b8665 and rc.9/b8827 separately, notes that one older pin had a native abort fixed by the newer pin, and still reports a JSI-visible failure across the range.
* [#332](https://github.com/mybigday/llama.rn/issues/332) identifies a crash in `rn-llama.cpp` when `common_init_from_params()` returns a model but no context; it was observed with prebuilt Android libs. This illustrates why the wrapper/core pair must be tested together.
* [#350](https://github.com/mybigday/llama.rn/issues/350) ties a native aarch64 crash to llama.rn 0.12.3 / llama.cpp b9254.
* [#374](https://github.com/mybigday/llama.rn/issues/374) compares llama.rn b10156 against standalone llama.cpp b10150 and finds divergent iOS CPU behavior even though the snapshots are close, pointing at build flags/configuration as well as source revision. For a fork, rebuild the complete generated source set and preserve the target’s compile settings; do not assume a separately built upstream binary is equivalent.

I found no llama.rn discussion or PR establishing `patch-package` as the engine-swap solution. The project’s own durable patch mechanism is `scripts/patches/`, and the direct fork example changes `.gitmodules` plus reruns bootstrap.

## 3. Upstream symbol timeline

The names span different llama.cpp eras. v0.12.4’s generated headers contain `reasoning_budget_activate_immediately` and singular `thinking_end_tag`, but do not contain `common_params::load_mode` or plural `thinking_end_tags`. That is consistent with the upstream history below.

| Symbol / shape | Introduction | What to backport |
|---|---|---|
| `common_params_sampling::reasoning_budget_activate_immediately` | Upstream PR [#20297](https://github.com/ggml-org/llama.cpp/pull/20297), commit [`acb7c79`](https://github.com/ggml-org/llama.cpp/commit/acb7c79), “common/parser: handle reasoning budget,” merged 2026-03-11. The commit adds the reasoning-budget sampler, `reasoning_budget_tokens`, the immediate-activation bool, start/end/forced token state, and the initial singular chat thinking tags. | Backport the coherent reasoning-budget change set, not just the field. In an older llama.rn pin, also copy the matching sampler/parser/common changes or use the llama.rn-style `scripts/patches/` files; commit [`eafd3f3`](https://github.com/mybigday/llama.rn/commit/eafd3f3) shows the latter. |
| `common_chat_params.thinking_end_tag` (singular) | Introduced with the same upstream PR [#20297](https://github.com/ggml-org/llama.cpp/pull/20297); the diff adds `thinking_start_tag` and `thinking_end_tag` strings to `common_chat_params`. llama.rn v0.12.4 still has the singular fields ([header](https://raw.githubusercontent.com/mybigday/llama.rn/v0.12.4/cpp/common/chat.h)). | Keep the singular form if matching llama.rn v0.12.4. The RN wrapper and generated common/chat code must agree on this shape. |
| `common_params::load_mode` and `enum llama_load_mode` | Upstream PR [#20834](https://github.com/ggml-org/llama.cpp/pull/20834), merge 2026-07-23; the merged implementation is commit [`e6dd0e29a`](https://github.com/ggml-org/llama.cpp/commit/e6dd0e29a). The PR adds the public enum/API, `common_params::load_mode`, parser support for `--load-mode`, and conversion into `llama_model_params`. The PR’s files view shows the exact additions. | This is a broader API/source change than a field-only backport: include `include/llama.h`, common argument parsing/conversion, model loader use, and any wrapper code that still uses `use_mmap/use_mlock/use_direct_io`. v0.12.4 predates it, so do not mix only the header with an older loader. |
| `common_chat_params.thinking_end_tags` (plural vector) | Upstream PR [#25544](https://github.com/ggml-org/llama.cpp/pull/25544), merged 2026-07-25 as [`910196f`](https://github.com/ggml-org/llama.cpp/commit/910196f). The PR description says it refactors the singular end tag to multiple end sequences, updates parsers and reasoning-budget state, adds matching-sequence reporting, and updates sampler/continuation behavior. | Backport the whole multi-end-sequence chain: `common/chat.h/.cpp`, reasoning-budget matcher/trie changes, sampling replay, continuation/server plumbing, and tests. Simply changing `std::string` to `std::vector<std::string>` will leave the wrapper/core behavior inconsistent. |

The upstream file history corroborates the sequencing: [reasoning-budget.h history](https://github.com/ggml-org/llama.cpp/commits/master/common/reasoning-budget.h) shows PR #20297 first, then later reasoning-budget refinements; [chat.h history](https://github.com/ggml-org/llama.cpp/commits/master/common/chat.h?query=thinking_end_tag) shows the singular field in the March reasoning-budget change and the pluralization in #25544.

## 4. Windows-specific gotchas

I found no llama.rn issue/discussion documenting a separate Windows-native source-build recipe or a Windows-only failure beyond the known long-path problem. The following are source-backed gotchas and, where marked, direct inferences from the scripts:

1. **The bootstrap/build helpers are Bash/POSIX scripts, not PowerShell scripts.** `bootstrap.sh` and `build-android.sh` use Bash, `uname`, `cp`, `rm`, `awk`, `sed`, `curl`, `tar`, `patch`, `od`, and Unix-style path handling. `build-android.sh` only detects Darwin/Linux for CPU-count selection and leaves Windows as `OS_TYPE=unknown` with one job. On Windows, run the bootstrap in Git Bash/MSYS2/WSL or replace it with an equivalent reproducible script; native PowerShell is not the documented execution environment. This is an inference from the [bootstrap source](https://raw.githubusercontent.com/mybigday/llama.rn/main/scripts/bootstrap.sh) and [Android build source](https://raw.githubusercontent.com/mybigday/llama.rn/main/scripts/build-android.sh), not a llama.rn issue report.

2. **iOS source/framework generation is macOS-only.** `build-ios.sh` invokes CMake’s Xcode generator, `xcodebuild`, `ditto`, `dwarfdump`, and `sysctl`; Windows cannot run that workflow. Build the custom iOS framework on macOS or CI, then consume it with the source/prebuilt configuration as appropriate. Android is the practical Windows-hosted target.

3. **Android source builds still require the Android toolchain and path discipline.** The helper expects `ANDROID_HOME` or Unix-like auto-detected SDK/NDK paths, invokes CMake and `llvm-strip`, and builds arm64-v8a and x86_64. If using Windows tooling directly, prefer the Gradle/Android Studio source build or a controlled MSYS2/WSL environment; avoid mixing Windows and MSYS/WSL path spellings in the generated CMake cache. The package documentation limits Android to arm64-v8a/x86_64 and requires New Architecture from v0.10 onward ([README](https://github.com/mybigday/llama.rn)).

4. **Hexagon is an extra Windows complication.** Current bootstrap downloads a Linux `.tar.xz` Hexagon SDK when absent and recommends Docker for consistent Android/HTP builds. If the fork only needs CPU/OpenCL, keep the Hexagon path out of the first validation loop; otherwise use the project’s Docker/WSL-style route and verify the produced HTP assets separately. See the [current bootstrap setup](https://raw.githubusercontent.com/mybigday/llama.rn/main/scripts/bootstrap.sh) and [Android build helper](https://raw.githubusercontent.com/mybigday/llama.rn/main/scripts/build-android.sh).

5. **The prebuilt artifact trap is platform-independent but especially easy to misdiagnose on Windows.** Changing `third_party/llama.cpp` or generated `cpp/` and then launching an app that still links the downloaded `.so`/xcframework proves nothing. Turn on the source build, clean/reconfigure Gradle or Pods as appropriate, and verify the loaded artifact/build identifier. Issue [#301](https://github.com/mybigday/llama.rn/issues/301) is the direct evidence for this failure mode.

6. **Keep paths short.** MAX_PATH is already known here; it remains relevant because the checkout, generated tree, Gradle intermediates, and NDK toolchain paths compound. A short workspace path and short temporary/build paths reduce failures in Git/MSYS, CMake, and Gradle. I did not find a llama.rn-specific alternative to this workaround.

## Recommended integration route (5 lines)

1. Fork/pin llama.rn and make `third_party/llama.cpp` resolve to the exact kalsallama commit, preferably by changing `.gitmodules` URL/branch while preserving that path.
2. Run `npm run bootstrap` so ggml, llama `src`, common, MTMD, generated metadata, symbol prefixes, and patches are regenerated from kalsallama.
3. Use `RNLLAMA_BUILD_FROM_SOURCE=1` for iOS and `rnllamaBuildFromSource=true` for Android; never validate the fork against stock prebuilt artifacts.
4. Backport whole upstream feature sets or encode fork-only deltas in `scripts/patches/`, keeping JSI/RN wrappers matched to the generated C++ API shape.
5. Build/test the complete native artifact on macOS for iOS and controlled Bash/Gradle/NDK tooling for Android, then pin both the llama.rn commit and kalsallama commit together.
