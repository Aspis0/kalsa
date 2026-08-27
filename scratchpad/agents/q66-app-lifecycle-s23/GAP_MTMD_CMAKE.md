# GAP_MTMD_CMAKE — bootstrap-on-kalsallama: structural gap map (outside JSI)

Read-only structural mapping. Complements `WEBSEARCH_ENGINE_PIN.md` (mechanism) and the JSI-wrapper map (separate agent). Everything here is what breaks in the GENERATED engine tree + CMake when `scripts/bootstrap.sh` runs against kalsallama instead of its expected upstream snapshot. JSI/RN wrapper files (`cpp/jsi/**`, `cpp/rn-*`) are OUT OF SCOPE here.

## 0. Sources & pins

| Artifact | Pin / ref | Note |
|---|---|---|
| llama.rn clone (script source) | `scratchpad/agents/q66-app-lifecycle-s23/llama.rn-src` @ tag `v0.12.8`, commit `ce7f5fff26d563e506a7333a5d8791218d0de266` | `git describe` = `v0.12.8` exactly |
| Pristine shipped package (ground truth of what 0.12.8 shipped) | `C:\Users\gualt\q66c\node_modules\llama.rn` @ 0.12.8 | `cpp/` tree + `android/src/main/CMakeLists.txt` |
| 0.12.8 upstream engine gitlink | llama.cpp `91f8c9c5fb038c086e13e9cd823c29b33b07ba54` | `git ls-tree HEAD third_party/llama.cpp` in clone |
| Fork engine (READ ONLY) | `BigMoeOnEdge/third_party/llama.cpp` @ `a0cabca6b1b3248a92e05a8633fd0d82cf776e75` = `kalsakernel-v4-31-ga0cabca6b`, remote `https://github.com/Aspis0/kalsallama.git` | 31 commits past fork tag `kalsakernel-v4` |
| Staged engine in clone | `llama.rn-src/third_party/llama.cpp` | verified **byte-identical** to fork (`diff -rq` clean; `repack-q23k.h` md5 `b6e3a32e…` both sides) |
| App patch (READ ONLY) | `C:\Users\gualt\Desktop\Kalsa\ai-chat\patches\llama.rn+0.12.8.patch` | see §4 |

The clone's `scripts/bootstrap.sh` is pristine v0.12.8 plus exactly 4 local edits (diff vs `HEAD:scripts/bootstrap.sh`):
1. submodule init/update replaced by a guard: engine must already be staged at `third_party/llama.cpp` (bootstrap.sh:10-12);
2. `cp .../ggml-cpu/repack-q23k.h` line ADDED (bootstrap.sh:166) — the only fork-aware copy;
3. `cd example && npm install` skipped (bootstrap.sh:516);
4. `BUILD_NUMBER`/`BUILD_COMMIT` from `KALSA_ENGINE_BUILD_NUMBER`/`KALSA_ENGINE_COMMIT_SHORT` env instead of git-in-submodule (bootstrap.sh:542-543).

Shipped `cpp/` is therefore generated from `91f8c9c5`; the fork base is a much newer upstream roster (137 `src/models/*.cpp` incl. `qwen35`, `gemma4`, `deepseek4`, `glm-dsa`). All "shipped vs fork" deltas below conflate (kalsallama commits + upstream drift); both classes have the same practical effect on bootstrap.

## 1. BOOTSTRAP COPY LIST vs FORK

The copy list is **170 explicit `cp` lines** in `scripts/bootstrap.sh` (no globs in the copy phase): 156 file copies + 14 `cp -r` dir copies. Line numbers below refer to the clone's working-tree bootstrap.sh (pristine v0.12.8 + the 4 q66 edits listed in §0). Engine→cpp path mapping is literally the right-hand side of each `cp` line; the 14 dir copies map as:

| bootstrap.sh line | engine dir (third_party/llama.cpp/) | generated dir (cpp/) |
|---|---|---|
| 115/148/152/155 | `ggml/src/ggml-metal`, `ggml-blas`, `ggml-opencl`, `ggml-hexagon` | same name under `cpp/` (their CMakeLists removed, bootstrap.sh:116/149/153 — hexagon's kept, bootstrap.sh:156) |
| 182 | `ggml/src/ggml-cpu/amx` | `cpp/ggml-cpu/amx/` |
| 184-185 | `ggml-cpu/arch/arm`, `arch/x86` | `cpp/ggml-cpu/arch/{arm,x86}/` (whole dir — fork files inside ride along) |
| 208 | `src/models` | `cpp/models/` (whole dir) |
| 313-314 | `tools/mtmd/models`, `tools/mtmd/debug` | `cpp/tools/mtmd/{models,debug}/` (whole dir) |
| 330 | `common/jinja` | `cpp/common/jinja/` (+ `string.h`→`jinja-string.h` rename, bootstrap.sh:332-341) |
| 351/354/355 | `vendor/nlohmann`, `vendor/miniaudio`, `vendor/stb` | `cpp/nlohmann/`, `cpp/tools/mtmd/miniaudio/`, `cpp/tools/mtmd/stb/` |

### 1a. Expected-by-bootstrap but ABSENT in the fork (bootstrap aborts)

Exactly **2 of 170** copy sources are missing from kalsallama @ a0cabca6b:

| File | bootstrap.sh | Why missing in fork | Consequence if unfixed | Fix |
|---|---|---|---|---|
| `common/trie.h` | 304 | deleted in fork (literal-matching folded into `common/peg-parser.*`; word-boundary grep over fork `common/ src/ tools/mtmd/` finds no `"trie.h"` include, only comments) | `cp` fails → `bash -e` aborts bootstrap before the patch loop | delete both lines (fork is self-consistent without trie) |
| `common/trie.cpp` | 305 | same | same | same |

No other rename/relocation traps: every other copy source exists in the fork (168/170 verified by direct path check; dir-copy contents verified by include-graph below).

### 1b. Fork-only files bootstrap does NOT know about

Kalsallama's own additions within mirrored scope — what a regenerate would silently DROP:

| Fork file (BigMoeOnEdge/third_party/llama.cpp/) | Status | Required by | Verdict |
|---|---|---|---|
| `ggml/src/ggml-cpu/repack-q23k.h` | **the** kalsallama addition; already covered by the q66 copy line (bootstrap.sh:166) | `ggml-cpu/ggml-cpu.c:18`, `ggml-cpu/repack.cpp:21`, `ggml-cpu/traits.cpp:5` (all `#include "repack-q23k.h"`) | REQUIRED — load-bearing. Without the q66 line: 3 compile errors. Note the fork also modified `ggml-cpu.c`/`repack.cpp`/`traits.cpp` themselves (q23k mmap/native-nb work) — no llama.rn script-patch touches them, so no patch conflict. |
| `ggml/src/ggml.cpp` (26 lines) | upstream addition newer than the 0.12.8 pin; NOT copied by any line | nothing in the copy set references its symbols (self-registering `std::set_terminate` shim; `ggml_print_backtrace` is defined in ggml.c) | benign — only loses backtrace-on-uncaught-exception (0.12.8 shipped without it too). Fork's own `ggml/src/CMakeLists.txt:199-200` compiles ggml.c+ggml.cpp; llama.rn equivalents compile ggml.c only. |
| `ggml-cpu/{hbm.cpp,hbm.h,kleidiai/,llamafile/,spacemit/,cmake/}` | present in upstream 91f8c9c5 era as well — inherited, NOT kalsallama additions | all includes guard-guarded: `GGML_USE_CPU_HBM` (ggml-cpu.cpp:13), `GGML_USE_CPU_KLEIDIAI` (:17), `GGML_USE_LLAMAFILE` (ggml-cpu.c:51), `GGML_USE_CPU_RISCV64_SPACEMIT` (ggml-cpu.c:55) — none defined in rnllama targets | benign (status quo: shipped package omits them too) |
| `ggml/include/{ggml-cann,cuda,et,openvino,rpc,sycl,virtgpu,vulkan,webgpu,zdnn,zendnn}.h` | upstream backend headers, never copied | only `ggml-backend-reg.cpp` includes them, each under `#ifdef GGML_USE_<BACKEND>` (e.g. :33/:45/:77) — undefined in rnllama | benign |
| `common/{arg.*,base64.hpp,console.*,debug.*,download.*,hf-cache.*,http.h,imatrix-loader.*,llguidance.cpp,preset.*}` | upstream tool-side common, never copied | include-graph: **no copied file includes any of them** (sole referencer is `tools/mtmd/debug/mtmd-debug.cpp` → `arg.h`,`debug.h`, which neither android nor iOS compiles — see §3/§5) | benign |
| `vendor/{cpp-httplib,sheredom}` | not copied | `tools/mtmd/mtmd-helper.cpp` includes `sheredom/subprocess.h`, but `scripts/patches/mtmd-helper.cpp.patch` applies cleanly to the fork's prefixed file and removes it (verified §2.3) | benign (patch-dependent) |
| `tools/mtmd/{legacy-models/,deprecation-warning.cpp,mtmd-cli.cpp,test-*,tests*}` | not copied (bootstrap copies only `models/`, `debug/` + the 12 named files, bootstrap.sh:313-327) | nothing in the copied mtmd set references legacy-models or the CLI files | benign |
| `src/llama-quant.{h,cpp}` | not copied | quantize-tool only; no copied file references it | benign |

Fork mtmd/models adds **nothing** new vs shipped (34 files = shipped 36 minus `mimo-audio.cpp`+`minimax-m3.cpp`, see §2).

### 1c. Present in both (fine)

The remaining 168 file-copy sources (all ggml core/CPU/headers, all `src/llama-*` + unicode, all common files listed in bootstrap.sh:269-307, all 12 named mtmd files) exist in the fork. All 14 dir copies succeed and carry the fork's current contents (including 137 `src/models/*.cpp` and 156 `ggml-opencl/kernels/*.cl`).

### 1.4 Include-graph verification of the produced tree

Built the tree bootstrap-on-fork would produce (640 files, 470 C/C++ sources) and resolved every `#include "..."` (with bootstrap's renames applied: `jinja/string.h`→`jinja-string.h`, `../src/llama-ext.h`→`llama-ext.h`). Non-system includes that do NOT resolve, and their disposition:

| Includer | Include | Disposition |
|---|---|---|
| `ggml-cpu/ggml-cpu.c`, `repack.cpp`, `traits.cpp` | `repack-q23k.h` | resolved by the q66 copy line (would be a 3-file hole without it) |
| `tools/mtmd/mtmd-helper.cpp` | `sheredom/subprocess.h` | removed by `scripts/patches/mtmd-helper.cpp.patch` (applies OK) |
| `tools/mtmd/debug/mtmd-debug.cpp` | `arg.h`, `debug.h` | file never compiled (android CMake globs don't include `debug/`; podspec explicitly excludes it) |
| `ggml-backend-reg.cpp` | `ggml-{cuda,vulkan,cann,…}.h` | each under `#ifdef GGML_USE_*`, undefined in all rnllama targets |
| `ggml-cpu.c` / `ggml-cpu.cpp` | `llamafile/sgemm.h`, `spacemit/ime.h`, `hbm.h`, `kleidiai/kleidiai.h` | guard-guarded, macros undefined |
| `ggml-opencl/ggml-opencl.cpp` | `half.hpp` | inside `#if 0` (ggml-opencl.cpp:12056-12070, dead debug block) — never preprocessed |
| `ggml-hexagon/**` | `htp_iface.h`, HAP_*/qurt_* SDK headers | compiled only inside Hexagon SDK builds; llama.rn host target gets `htp_iface.h` via `htp/v73/` include dir (which the fork lacks — §2/§3) |
| `ggml-opencl/ggml-opencl.cpp` | 156 `*.cl.h` | CMake-generated; must match the `GGML_OPENCL_KERNELS` embed list — see §3.2 (6 missing) |

Everything else resolves. Conclusion: after the two trie-line deletions and with the q66 q23k line kept, the produced engine tree is include-consistent for the CPU targets; the opencl and hexagon target variants have the CMake-level breaks catalogued in §3.

## 2. SHIPPED 0.12.8 cpp/ vs WHAT BOOTSTRAP-ON-FORK WOULD PRODUCE

Definitive delta computed over source files (LC_ALL=C; llama.rn-owned `rn-*`, `jsi/`, `anyascii.*`, `ggml-ext.h` excluded from both sides). Shipped = 637 source files; produced-from-fork = 629. **46 shipped-only files**, grouped by disposition:

### 2.1 Generated files — reappear, no action (2)

| File | Regenerated by |
|---|---|
| `common/build-info.cpp` | bootstrap.sh:553-559 from fork `common/build-info.cpp.in` (exists in fork) |
| `ggml-metal/ggml-metal-embed.s` | bootstrap.sh:493-512 from fork's (patched) `ggml-metal.metal`; also `common/jinja/jinja-string.h` = rename artifact of fork's `string.h` |

### 2.2 Engine files that disappear — with compile mapping (44)

| Shipped-only file(s) | Compiled by (android) | Compiled by (iOS podspec) | API it needed | After fork regen |
|---|---|---|---|---|
| `common/trie.h`, `common/trie.cpp` | `COMMON_FILES` glob, rnllama/CMakeLists.txt:29 | wide glob podspec:34 | `Trie` class used by 0.12.8-era reasoning-budget matcher | glob shrinks; fork has no references (§1a) — clean |
| `ggml-hexagon/htp/dma-queue.{c,h}`, `hex-bitmap.h`, `hmx-flash-attn-ops.c`, `hmx-matmul-ops.c`, `hmx-ops.{c,h}`, `hmx-profile.h`, `htp-msg.h`, `htp-tensor.{c,h}`, `im2col-ops.c`, `vtcm-utils.h`, `work-queue.{c,h}` (14) | **never** — `htp/*.c` compile only inside Hexagon SDK DSP builds | excluded, podspec:37 | Hexagon SDK DSP-side HMX/queue/tensor APIs | fork restructured its DSP-side file set (self-consistent via fork's own CMake) — benign for llama.rn |
| `ggml-hexagon/htp/v73/htp_iface.h`, `v73/htp_iface_stub.c` (2) | host side of the hexagon target, rnllama/CMakeLists.txt:153-161 (explicit, plus FATAL_ERROR check) | excluded, podspec:37 | QAIC-generated FastRPC interface | **BREAK (hexagon variant only)**: fork ships no `htp/v73/` — the `rnllama_v8_2_dotprod_i8mm_hexagon_opencl` target hits the CMake FATAL_ERROR at :161 unless `scripts/build-hexagon-htp.sh` regenerates the artifacts |
| `ggml-opencl/cl-program-cache.cpp`, `cl-program-cache.h` (2) | explicit in opencl target, rnllama/CMakeLists.txt:417 | excluded, podspec:37 | OpenCL program-cache layer upstream had | **BREAK (opencl variant only)**: dangling `target_sources` entry — CMake cannot find the source file. Fork removed the cache layer (embeds kernels directly; adds `fa_tune.h` instead) |
| `ggml-opencl/kernels/{abs, gemm_moe_mxfp4_q8_1_dp4a, gemm_moe_q4_0_q8_1_dp4a, gemm_moe_q4_k_q8_1_dp4a, gemm_moe_q6_k_q8_1_dp4a, gemm_moe_q8_0_f32_ns, gemm_moe_q8_1_dp4a, gemm_noshuffle_iq4_nl_q8_1_dp4a, gemm_noshuffle_q4_0_q8_1_dp4a, gemm_noshuffle_q4_k_q8_1_dp4a, gemm_noshuffle_q5_0_q8_1_dp4a, gemm_noshuffle_q5_k_q8_1_dp4a, gemm_noshuffle_q6_k_q8_1_dp4a, gemm_noshuffle_q8_0_q8_1_dp4a, moe_combine, moe_reorder_quant_a_q8_1, quant_a_q8_1}.cl` (17) | embedded by custom-commands listed in `GGML_OPENCL_KERNELS` (rnllama/CMakeLists.txt:214+) | excluded, podspec:37 | kernels referenced by upstream 0.12.8 `ggml-opencl.cpp` | **BREAK (opencl variant only)**: these 17 embed entries reference `.cl` files the fork no longer has; exactly the 17 list entries fork's `ggml-opencl.cpp` stopped including (dp4a MoE paths + moe_combine + quant_a_q8_1 reworked by kalsallama). Prune 17 entries AND add 6 (§3.2) |
| `models/hy-v3.cpp`, `models/laguna.cpp`, `models/minimax-m3.cpp`, `models/nanbeige.cpp` (4) | `MODEL_FILES` glob, rnllama/CMakeLists.txt:22 | wide glob podspec:34 | `LLM_ARCH_{HY_V3,LAGUNA,MINIMAX_M3,NANBEIGE}` in `llama-arch` + `models/models.h` registration | glob shrinks silently, no dangling entry. Fork's `llama-arch` has no matching arch enums → loading those GGUFs fails at runtime with unknown-architecture (behavioral, not compile) |
| `tools/mtmd/models/mimo-audio.cpp`, `tools/mtmd/models/minimax-m3.cpp` (2) | `MTMD_MODEL_FILES` glob, rnllama/CMakeLists.txt:28 | wide glob podspec:34 | mtmd projector registration via `tools/mtmd/models/models.h` | glob shrinks; fork mtmd self-consistent. **MiniMax-M3 loses both text and vision support** after regen |

Net: **CPU-only targets (rnllama, rnllama_v8*, rnllama_x86_64): zero compile breaks.** The `_hexagon_opencl` variant target has 3 independent breaks (v73 artifacts, cl-program-cache, kernel-list drift).

### 2.3 llama.rn's own scripts/patches vs fork content (bootstrap aborts on failure)

All 16 `scripts/patches/*.patch` dry-run against the fork's prefix-transformed sources (faithful bootstrap emulation: prefix seds per `files_add_lm_prefix`; NO seds on `common/jinja/*`; jinja include-path patch validated raw):

| Patch | Result | Detail |
|---|---|---|
| chat.cpp / chat.h / common.cpp / ggml-metal-flash-attn-smem / ggml-metal-mul-mv-id-tiitg / ggml-quants.c / ggml.c / jinja-caps.cpp / jinja-value.cpp / llama-mmap.cpp / log.cpp / mtmd-audio.cpp / mtmd-helper.cpp | **OK** (13) | mtmd-helper patch removes the `sheredom/subprocess.h` include — load-bearing for the vendor gap (§1b); ggml-hexagon.cpp applies with +1181-line offset (fork's file is much larger) |
| `common.h.patch` | **FAIL — hunk 1 of 3** | hunk1 expects the 0.12.8-era reasoning-budget block (`reasoning_budget_end` as `std::vector<llama_tokens>`, aligned fields) to add `bool reasoning_budget_activate_immediately`. Fork's block (common.h:283-291) is a divergent evolution: `std::vector<llama_token>` end tags + extra fields `reasoning_budget_message`, `reasoning_control`. Hunks 2+3 (add `vocab_only`, `progress_callback` to `common_params`) apply cleanly — fork lacks both (it only has `load_progress_callback`, common.h:724), so no duplication risk |
| `sampling.cpp.patch` | **FAIL — hunk 1 of 1** | expects the braced `{params.reasoning_budget_start}` init call at sampling.cpp:299-306 to wrap it in an `if (params.reasoning_budget_activate_immediately)` adding a 6th `REASONING_BUDGET_COUNTING` arg. Fork calls `common_reasoning_budget_init(vocab, params.reasoning_budget_start, …)` unbraced (fork sampling.cpp:300-305; fork signature has 5 args + `initial_state` default, reasoning-budget.h:34-40) and gates on its own `params.reasoning_control` instead |

Both failures are the same root cause: **llama.rn's reasoning-budget feature pair (upstream PR #20297 backport, commit eafd3f3) vs kalsallama's divergent reasoning-budget evolution** (`reasoning_control` on-demand sampler, no `activate_immediately`). Under `bash -e` the first failed patch aborts bootstrap (no version.ts, no build-info.cpp, later patches unapplied). Fix = rebase both patches onto fork content (add the `activate_immediately` field + sampler branch, adapting to fork's `reasoning_control` gate) or accept fork semantics and drop the two patches. Cross-scope note: the rn/jsi wrapper references **neither** `reasoning_budget_*` nor `activate_immediately` nor `vocab_only`/`progress_callback` (grep over `rn-*` = 0 hits), so this divergence is invisible to the JSI layer's field access.

## 3. CMAKE ENUMERATION

Two CMake files on android (byte-identical between clone @v0.12.8 and shipped package; CRLF-only diff):

### 3.1 `android/src/main/CMakeLists.txt` (JNI shell, 168 lines)

- Compiles ONLY the JNI/JSI glue explicitly (lines 33-40: `RNLlamaJSI.cpp` + 6 `cpp/jsi/*` files); engine enters via `add_subdirectory(rnllama)` gated by `option(RNLLAMA_BUILD_FROM_SOURCE)` (:25-30).
- `build_rnllama_jni()` wraps each engine library with JNI; target matrix at :145-159: `rnllama_jni` (generic) + arm64 `v8 / v8_2 / v8_2_dotprod / v8_2_i8mm / v8_2_dotprod_i8mm_hexagon_opencl`; x86_64 gets one. Engine variant names `rnllama` / `rnllama_v8*` map to the rnllama/CMakeLists targets of the same names.
- Nothing engine-side is enumerated here → no dangling risk from the fork swap in this file.

### 3.2 `android/src/main/rnllama/CMakeLists.txt` (engine build, 453 lines) — the enumeration that matters

| Mechanism | Entries | Line | Fork-regen effect |
|---|---|---|---|
| `file(GLOB … CONFIGURE_DEPENDS)` | `models/*.cpp` | 22 | auto-follows fork: −4 files (§2.2), +0 → no dangling, self-consistent |
| | `ggml-cpu/*.c`, `ggml-cpu/*.cpp`, `ggml-cpu/amx/*.cpp` | 23-25 | same file names as shipped (+`repack-q23k.h` is a header, never globbed) → unchanged |
| | `llama*.cpp` (cpp root) | 26 | identical name set shipped↔fork → unchanged |
| | `tools/mtmd/*.cpp`, `tools/mtmd/models/*.cpp` | 27-28 | −0/−2 (§2.2) → no dangling |
| | `common/*.cpp`, `common/jinja/*.cpp` | 29-30 | −1 (`trie.cpp`) → no dangling |
| EXPLICIT core | `ggml.c ggml-alloc.c ggml-backend*.cpp ggml-opt.cpp ggml-threading.cpp ggml-quants.c gguf.cpp` | 35-43 | all present in fork → fine. NOTE: fork's `ggml.cpp` not listed (§1b, benign) |
| EXPLICIT | `unicode-data.cpp`, `unicode.cpp`, `anyascii.c` (llama.rn-owned) | 54-55, 60 | unchanged |
| EXPLICIT rn layer | `rn-llama.cpp`, `rn-completion.cpp`, `rn-tts.cpp`, `rn-slot.cpp`, `rn-slot-manager.cpp` | 70-74 | llama.rn-owned, not regenerated |
| EXPLICIT per-arch | `ggml-cpu/arch/${arch}/quants.c` + `repack.cpp` for arm/x86 targets | 104-105 | fork has both files in both arch dirs (dir-copied) → fine |
| EXPLICIT hexagon host | `ggml-hexagon.cpp`, `htp-drv.cpp` (:153-154) + `htp/v73/htp_iface_stub.c` (:161, with EXISTS check → **FATAL_ERROR** when missing) | 153-166 | ggml-hexagon.cpp/htp-drv.cpp exist in fork; **`htp/v73/` does not** → hexagon variant blocked until build-hexagon-htp.sh regenerates QAIC artifacts |
| EXPLICIT opencl | `ggml-opencl.cpp` (:416) + `cl-program-cache.cpp` (:417) + ~200-name `GGML_OPENCL_KERNELS` embed list (:214-410) via `kernels/embed_kernel.py` | 214-430 | **dangling: `cl-program-cache.cpp` gone from fork**; **kernel list drift: −17 dead entries (no `.cl` in fork), +6 missing entries fork's ggml-opencl.cpp includes under `GGML_OPENCL_EMBED_KERNELS`** (which the opencl target defines as `-DLM_GGML_OPENCL_EMBED_KERNELS`): `gemm_moe_q2_k_f32_ns`, `gemm_moe_q3_k_f32_ns`, `gemv_moe_q2_k_f32_ns`, `gemv_moe_q3_k_f32_ns`, `oracle_consumer_q4_0_gemm`, `oracle_consumer_q4_0_gemv` — all six `.cl` files exist in fork's kernels/ |

Target matrix (:438-451): `rnllama` (generic CPU), `rnllama_v8 / v8_2 / v8_2_dotprod / v8_2_i8mm` (arm), `rnllama_v8_2_dotprod_i8mm_hexagon_opencl` (opencl+hexagon), `rnllama_x86_64`. **All breaks concentrate in the `_hexagon_opencl` target; CPU targets configure+compile clean.**

### 3.3 Where the fork's own CMake defines sources that must enter llama.rn lists

| Fork CMake site | What it compiles | llama.rn coverage |
|---|---|---|
| `ggml/src/ggml-cpu/CMakeLists.txt:32-33` | `ggml-cpu/repack.cpp` + `repack.h` | covered: repack.cpp via :24 glob; repack-q23k.h via q66 copy line |
| `ggml/src/ggml-cpu/CMakeLists.txt:102 / :244 / :442 / :452-453` | `arch/arm/repack.cpp`, `arch/x86/repack.cpp`, `arch/riscv/repack.cpp`, `spacemit/repack.{cpp,h}` | arm/x86 covered via :104-105; riscv/spacemit are target-gated (macros undefined on android) → correctly NOT in llama.rn lists |
| `ggml/src/CMakeLists.txt:199-200` | `ggml.c` + `ggml.cpp` (ggml-base) | llama.rn compiles ggml.c only; ggml.cpp omission benign (§1b) |
| `ggml/src/ggml-opencl/CMakeLists.txt` | fork's opencl set (no program-cache) | llama.rn's :415-417 must drop cl-program-cache.cpp to match |

### 3.4 iOS contrast (llama-rn.podspec, for completeness)

Source build globs `cpp/**/*.{h,cpp,hpp,c,m,mm,s}` (podspec:34) minus `cpp/ggml-opencl/*.{c,cpp}`, `cpp/ggml-hexagon/**/*.{c,cpp}`, `cpp/tools/mtmd/debug/*.cpp` (podspec:37). No explicit engine file list → **nothing can dangle on iOS**; the glob compiles ggml-metal (needed there) and auto-follows the regenerated tree. Asymmetry to remember: any fork-new root-level `*.cpp` would compile on iOS but not on android — currently none exists in the produced tree (fork's `ggml.cpp` isn't copied at all).

## 4. APP PATCH NON-JSI HUNKS (`ai-chat/patches/llama.rn+0.12.8.patch`, 196 lines, 11 hunks)

**Answer: the app patch touches ZERO generated (engine) files.** All 6 target files are llama.rn-owned wrapper/JSI sources that bootstrap never rewrites (the prefix pass explicitly skips `cpp/rn-*`; jsi/ has no bootstrap step at all):

| File | Hunks | Scope |
|---|---|---|
| `cpp/jsi/JSIParams.cpp` | 3 | JSI (other agent) |
| `cpp/jsi/JSISession.h` | 1 | JSI |
| `cpp/jsi/RNLlamaJSI.cpp` | 1 | JSI |
| `cpp/rn-completion.cpp` | 3 | rn wrapper (other agent) |
| `cpp/rn-llama.cpp` | 2 | rn wrapper |
| `cpp/rn-slot.cpp` | 1 | rn wrapper |

Consequences for the regeneration plan:

1. **No app-patch hunks must be "preserved" through bootstrap** — there is nothing to rebase onto regenerated engine content. The patch targets are untouched by bootstrap, so it keeps applying verbatim after a regenerate.
2. Paths are `node_modules/llama.rn/...` (patch-package from the app root) — orthogonal to the bootstrap working tree in `llama.rn-src`.
3. The only real coupling is **compile-compatibility of patched `rn-*` code against the fork's engine API** (e.g. `common_params` shape drift from §2.3). Measured risk is low: the rn wrapper names none of the diverged fields (`reasoning_budget_*`, `activate_immediately`, `vocab_only`, `progress_callback` — 0 references). Full rn/jsi-vs-fork-API mapping belongs to the JSI agent's report.

## 5. MTMD SCOPE — can the mtmd group be excluded cleanly?

**Engine side: yes, cleanly. Wrapper side: no (requires rn-layer code edits).**

Engine-side evidence (all verified above):

1. **No engine reverse-dependencies.** Include-graph over the produced tree: outside `cpp/tools/mtmd/` itself, the only mtmd references are (a) `common/common.h` *struct fields* (`common_params_model mmproj`, `mtmd_batch_max_tokens`, common.h:593-601 — comments and plain data, **no `#include` of mtmd headers**), and (b) the rn wrapper (`rn-llama.cpp` ×17 refs, `rn-mtmd.hpp`, `rn-completion.cpp`, `rn-slot-manager.cpp`). `cpp/jsi/*` references mtmd **zero** times directly.
2. **Android CMake exclusion is 3 deletions**: `MTMD_FILES` glob (rnllama/CMakeLists.txt:27), `MTMD_MODEL_FILES` (:28), and the `${RNLLAMA_LIB_DIR}/tools/mtmd` include dir (:18). No explicit mtmd entries exist elsewhere; `mtmd/debug` was never compiled (§3).
3. **Bootstrap exclusion**: skip the whole mtmd copy block (bootstrap.sh:310-327) plus `vendor/miniaudio`+`vendor/stb` copies (:352-355, used only by mtmd). If mtmd is dropped, ALSO remove `scripts/patches/mtmd-audio.cpp.patch` and `mtmd-helper.cpp.patch` — otherwise `patch` fails on missing targets and `bash -e` aborts bootstrap (same failure mode as §2.3). `vendor/nlohmann` must stay (jinja/chat need it).
4. **iOS**: exclusion = add `cpp/tools/mtmd/**` to `exclude_files` (podspec:37); the wide glob would otherwise pull mtmd in.
5. **Dropping mtmd also erases the §2.2 mtmd deltas** (mimo-audio/minimax-m3 concerns vanish) and removes the mtmd-audio/mtmd-helper patch burden.

Wrapper-side blocker: `rn-llama.cpp`/`rn-mtmd.hpp`/`rn-completion.cpp`/`rn-slot-manager.cpp` have no `#ifdef` guard around mtmd usage (no `RNLLAMA_DISABLE_MTMD`-style macro exists) — dropping multimodal means editing those files (JSI agent scope) or keeping mtmd compiled-but-unused. If multimodal is kept, the fork's mtmd set is self-consistent and compiles: 34 model files (glob), `mtmd.cpp/clip.cpp/mtmd-helper.cpp/mtmd-audio.cpp/mtmd-image.cpp` + headers, with both mtmd script-patches applying cleanly to the fork's prefixed content.

---

## Summary of actionable bootstrap edits (outside JSI)

1. Delete `common/trie.h` + `common/trie.cpp` copy lines (bootstrap.sh:304-305) — fork dropped trie.
2. Keep the `repack-q23k.h` copy line (bootstrap.sh:166) — 3 fork files include it.
3. Rebase or drop `scripts/patches/common.h.patch` hunk1 + `scripts/patches/sampling.cpp.patch` hunk1 (reasoning-budget divergence; both currently abort bootstrap).
4. If the `_hexagon_opencl` variant is wanted: regenerate `htp/v73/` QAIC artifacts (build-hexagon-htp.sh), drop `cl-program-cache.cpp` from rnllama/CMakeLists.txt:417, and adjust `GGML_OPENCL_KERNELS` (−17 dead, +6 kalsallama kernels). If not wanted: remove that target (:447) and the CPU targets build clean as-is.
5. If dropping multimodal: mtmd globs + include dir, miniaudio/stb copies, 2 mtmd patches (§5).

## COMPLETE
