# KIT-BUILD — which binary does speculative decoding, and the Android build recipe

All references are engine `kalsallama` @ `f25f0c1c5` (worktree `/Users/marco/Projects/kalsallama-wt-oom`,
branch `kalsa-opencl-upload-oom-throw`). No adb, no device was touched.

## Which binary runs speculative decoding

| binary | source | spec? |
|---|---|---|
| `llama-speculative-simple` | `examples/speculative-simple/` | **yes, direct** — parses `--spec-type`, `-md`, `-devd`, `-ngld`; prints `n_drafted / n_accept / accept %` (the metrics we need) |
| `llama-speculative` | `examples/speculative/` | yes (older two-model example) |
| `llama-server` | `tools/server/` | yes (`common_speculative` in `server-task.cpp`) |
| `llama-cli` | `tools/cli/` | accepts the spec flags (README rows `--spec-type`, `-md`, `-devd`) but is a server-wrapping UI/client; npu-spec-verify dropped it from the kit for exactly that reason |
| `llama-completion` | `tools/completion/` | **no** spec support (plain decode only) |
| `llama-bench` | `tools/llama-bench/` | no spec |

`llama-speculative-simple` refuses to run without a working spec implementation: both a missing draft model and
`--spec-type none` end in `failed to initialize speculative decoding`, EXIT=1
(`raw/host_armA_no_draft_check.log`, `raw/host_armA_specnone_check.log`) — that is why arm A of PLAN.md uses
`llama-completion`.

## Status of the npu-spec-verify kit vs OpenCL

`npu-kit-f25f0c1c5.tgz` contains `llama-bench`, `llama-completion` (+ libs) — **no spec-capable binary**, so it
cannot run the DSpark arms as-is. OpenCL **is** enabled in that build: the `arm64-android-snapdragon-release`
preset sets `GGML_OPENCL=ON`, `build-s23-step0-v73/bin/libggml-opencl.so` is present, and the new binary contains
the `GPUOpenCL` / `ggml_opencl` strings. HTP skels in the kit are irrelevant here (target is pinned to CPU).

## Exact build recipe (one-target change of that cell's recorded build commands)

```sh
# same container, same build dir, one added target (their build_tools command + llama-speculative-simple)
docker run --rm --volume /Users/marco/Projects/kalsallama-wt-oom:/workspace --workdir /workspace --platform linux/amd64 -u 501:20 ghcr.io/snapdragon-toolchain/arm64-android:v0.7 bash -c 'cmake --build /workspace/build-s23-step0-v73 --target llama-speculative-simple -j6' > raw/build_android_llama-speculative-simple.log 2>&1; echo EXIT=$?
# EXIT=0 — 2 steps: compile speculative-simple.cpp.o + link bin/llama-speculative-simple (ELF aarch64, not stripped yet)
```

Packaging (strip with the NDK llvm-strip from the same image, stage = npu-spec-verify's already-stripped libs,
regenerate `SHA256SUMS`, tar outside the repo, keep the sums in this cell):

```sh
./pack_kit.sh; echo EXIT=$?
# EXIT=0 -> /Users/marco/kalsa-qdc/dspark-spec-v73/dspark-kit-f25f0c1c5.tgz
# sha256 bd6be0a4808c35885318647fede6ef91dfa8f3fe4366a4a706f5110ae45447df (10,151,778 B)
# contents: bin/llama-completion, bin/llama-speculative-simple, lib/libggml-{base,cpu,opencl,hexagon}.so,
#           lib/libggml.so, lib/libggml-htp-v73.so, SHA256SUMS (8 entries, raw/kit_SHA256SUMS.txt)
```

## llama-completion ships in the kit but this cell NEVER runs it — conversation warning

every arm (A included) is `llama-speculative-simple` (`arm.sh arm_cmd`); `bin/llama-completion` is only in the
kit for parity with npu-spec-verify. If anyone ever runs it by hand on the S23, remember (f25f0c1c5):

- `common/arg.cpp:1899-1907`: `{-cnv, --conversation}` / `{-no-cnv, --no-conversation}` — "interactive mode is
  also enabled", "default: auto enabled if chat template is available". Also `-st/--single-turn`
  (`:1909-1914`, exits after one turn when the prompt is predefined).
- The S23 trap (cell A, `raw/s23-3way-5/s23-3way-5-t1cpu.log:204,214`): the GGUF chat template auto-enables
  conversation (`tools/completion/completion.cpp:170-177`, log `… chat template is available, enabling
  conversation mode (disable it with -no-cnv)`), templating kicks in at `:250`, and the process then prints
  `:413 interactive mode on.` / `:484 == Running in interactive mode. ==` and waits on stdin → 900 s timeout.
- So: always pass `-no-cnv` (or `-st`) and redirect stdin (`</dev/null`) — the driver already does the latter
  at the adbT transport, and both parses void any log containing `Running in interactive mode` (`interactive_mode`).

## Host smoke build (same commit, CPU/OpenCL-off host build, scratch dir reused)

```sh
cmake --build /Users/marco/Projects/kalsallama-wt-oom/build -j 10 --target llama-speculative-simple \
  > raw/host_build_f25f0c1c5.log 2>&1; echo EXIT=$?
# EXIT=0; ./build/bin/llama-speculative-simple --version -> commit f25f0c1c5 (was d4d321fd7 before the rebuild)
```

Draft GGUF selection: HF `LiquidAI/LFM2.5-2.6B-DSpark-GGUF` ships F16 (663,691,776 B), Q8_0 (356,491,776 B),
Q4_K_M (199,680,512 B). Q8_0 wins under the "Q8_0 or F16 if < 1 GB" rule and is GEMM-supported by our OpenCL
backend (`type_has_gemm` includes `Q8_0`); Q4_K_M would have hit the K-quant path instead. Downloaded file sha256
`85a98fafdaf1328b6876fd1360d7ed69e74c6cefc14dd07fb6306e1940386c87` matches the HF LFS oid.
