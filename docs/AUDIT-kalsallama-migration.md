# Hostile audit of the kalsallama migration plan — 2026-08-23

Auditor: deepseek-v4-flash (thinking max), read-only, against repo @ ad085ff, fork @ 9890d1054,
vendored llama.rn 0.12.8. Ten findings, all CONFIRMED with verbatim quotes. Ordered by severity.

## F1 — Android production NEVER offloads to GPU, and no CI benchmark can
- `src/engine/engineParams.ts:99` — "Production sets no override at all and stays n_gpu_layers=0 either way."
- `src/engine/deviceTuning.ts:737` — `return backend.kind === "gpu-metal" ? 99 : 0;`  (only iOS Metal)
- `.github/workflows/bench.yml:184` — APK built **x86_64 only**; the OpenCL target is arm64-only
  (`rnllama/CMakeLists.txt:477-482`, inside `if (ANDROID_ABI STREQUAL "arm64-v8a")`).
The only cell exercising OpenCL is a manual device bench with `NGL=N` + `flashAttn:"off"` — the cell
`engineParams.ts:63-73` records as having previously killed `llama_init_from_model`.
**Consequence: the plan's headline (the OpenCL kernel list) has no measurable effect today.**

## F2 — q2_K/q3_K GPU dispatch is gated by a tensor-NAME heuristic and falls to CPU silently
Fork `ggml-opencl.cpp:7214-7216`: dispatch requires `strstr(name,"ffn") && strstr(name,"exps")`
or `strstr(name,"as")`, plus `ne01 % 32 == 0` and `ne[3] == 1`.
Plain `GGML_OP_MUL_MAT` (7660-7690) lists F16/BF16/F32/Q1_0/Q4_0/Q4_1/Q5_0/Q5_1/MXFP4/IQ4_NL/
Q4_K/Q5_K/Q6_K/Q8_0 — **Q2_K and Q3_K absent**, so non-ID q2_K matmul is always `return false`.
A per-op `supports_op` decline is invisible in a split graph. The fork ships the diagnostic the plan
never uses: `GGML_OPENCL_LOG_KERNELS` (ggml-opencl.cpp:59-73).

## F3 — the binary guard inspects the wrong artifact, and the loader downgrades silently
`RNLlama.java:201` tries `rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl`; `tryLoadLibrary` catches
`UnsatisfiedLinkError` and returns false with **no log**, so the app runs the CPU-only .so.
`scripts/native/assert-native-patch.sh` greps the **generic** `librnllama.so`, which carries the marker
regardless of which variant loaded. Wrong variant, assert still green.

## F4 — nothing reconciles the committed overlay against the pin
`VENDOR_SHA` is written, never enforced. After `sync-kalsallama.sh bump`, a forgotten regeneration
yields a green build on a silently old engine. The plan's "CI compiles the same SHA" is a trust
statement, not a check.

## F5 — the replaced surface is bigger than three llama.h symbols, and it is called at runtime
Absent from the fork but called by glue:
- `common_chat_templates_has_variant` — `RNLlamaJSI.cpp:302`, runs on **every model load**; declared
  `common/chat.h:366` in the vendored tree, added by llama.rn's own `chat.cpp.patch:145`.
- `reasoning_budget_activate_immediately` — `JSIParams.cpp:555`; llama.rn-patch-added to
  `common_params_sampling` and used by `sampling.cpp:300`. (Both bases have `reasoning_control`;
  what is missing is llama.rn's field — the plan's parenthetical is imprecise.)
- `common_reasoning_budget_get_end_match` — absent from fork `common/reasoning-budget.h`.
- `extra_fields`, `common_chat_template_caps` — absent from the fork's `chat.h`.
All depend on llama.rn's ~16 bootstrap patches applying to the fork at sync time.

## F6 — an include rewrite the plan never mentions
Fork `common/fit.cpp:5` and `common/speculative.cpp:12`: `#include "../src/llama-ext.h"`. After
flattening that path does not exist. llama.rn's bootstrap rewrites it — proof in the artifact:
vendored `common/speculative.cpp:12` reads `#include "../llama-ext.h"`.

## F7 — size figure wrong, and two bloat traps
Copy dirs measure **30.2 MiB**, not "~26M". Fork `models/` holds **74.4 MiB** of gguf (110 files) and
is only excluded if the copy list says so. llama.rn's bootstrap ships only `nlohmann` from `vendor/`;
the plan copies all five fork vendor dirs (5.8 MiB) for nothing. The RN `COMMON_FILES` glob would
compile **31** fork `common/*.cpp` against 19 today.

## F8 — iOS keeps upstream, and the split deepens
`llama-rn.podspec:33-44`: default iOS uses the prebuilt xcframework. True that nothing breaks — but
iOS is also the only platform with a GPU policy (`deviceTuning.ts:737` → 99 layers on Metal). After
this change iOS runs upstream Metal kernels while Android runs fork CPU kernels, 49 days + 64 commits
apart, with no verification surface on the iOS side.

## F9 — no rollback path
The plan's exit clause is "stop and report". Reverting only the patch leaves postinstall stale;
reverting only `package.json` leaves the overlay unused. The recovery sequence (revert,
`rm -rf node_modules`, `npm ci`, re-prebuild) is never stated, and execution destroys the working
baseline inside `node_modules`.

## F10 — the plan's own feared failure modes are LOUD; the silent one is elsewhere
Missing `.cl` → `embed_kernel.py:15` FileNotFoundError (loud). Missing `.cl.h` → compile fail (loud).
The silent path: lose `-DLM_GGML_OPENCL_EMBED_KERNELS` and every kernel switches to the runtime
`read_file()` fallback; the files are absent on Android, init fails, and the app converts that into
CPU-only via `KALSA_GPU_FALLBACK` (`LlamaService.ts:1381`, `params.n_gpu_layers = 0`).
Loud in the build, silent in the measurement.

## Verified CORRECT in the plan
merge-base `22b69b6e9`; 64 fork commits / 192 llama.rn commits; `arch/arm/repack.cpp` 5492 vs 5156
with `ggml_gemv_q2_K_8x4_q8_K` at line 748 and `ggml_gemv_q3_K_8x4_q8_K` at 823, absent from llama.rn;
the four Adreno kernels present and #included at 4442/4459/4476/4493; hardcoded `GGML_OPENCL_KERNELS`
at CMakeLists.txt:249 with 167 entries, zero q2_k/q3_k, exactly 17 absent from the fork (set-equality
verified); `llama.h` 1599 vs 1605 with the LLAMA_API diff being exactly `llama_load_mode*`; every
JSIParams quote verbatim at the claimed lines; the expert-ready hook at `ggml-cpu.h:151` /
`ggml-cpu.c:63`; the whole build chain; CI has **no** `secrets.*` anywhere; `mtmd.h` identical
between fork and RN (multimodal glue compiles); `whisper.rn` uses `WSP_GGML_*` so coexistence holds.

## Stated by the plan, NOT verifiable locally
"~16 llama.rn-owned patches" (count), build number "b10156", and the bootstrap `rm -rf` list — the
vendored tree contradicts the `cpp/ggml-opencl` part, since that directory ships in the tarball.
