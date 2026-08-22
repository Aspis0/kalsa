# Queue item #11: llama-bench flag and OpenCL FLASH_ATTN guard

Status: complete. This report was updated after the implementation, build, and final verification milestones.

## Scope and repository

- Repository: `BigMoeOnEdge/third_party/llama.cpp`
- Branch: `kalsa/kernel-s3-repack`
- Starting HEAD: `9a411210697ca216bf29208973757ef751b60e7b`
- No git remotes are configured.
- Only the nested llama.cpp checkout was modified; the outer `BigMoeOnEdge` repository was not touched.

## Findings

### Task 1: llama-bench plumbing

llama-cli's existing path is:

- `common/arg.cpp:2172-2178`: the common `--repack` / `--no-repack` option sets `common_params.no_extra_bufts`.
- `common/common.cpp:1566`: `common_model_params_to_llama()` mirrors that setting with
  `mparams.use_extra_bufts = !params.no_extra_bufts;`.

llama-bench constructs `llama_model_params` directly in `tools/llama-bench/llama-bench.cpp`, so the same inversion belongs in `cmd_params_instance::to_llama_mparams()`.

### Task 2: OpenCL lookup

The OpenCL admission function is `ggml/src/ggml-opencl/ggml-opencl.cpp:7477`.
Before this change it admitted the hard-coded FA dimension list even when a lazy kernel compile had failed and the dispatch map was empty. The relevant unguarded lookups are:

- `ggml/src/ggml-opencl/ggml-opencl.cpp:15728`: mixed-KV split-kernel selection.
- `ggml/src/ggml-opencl/ggml-opencl.cpp:16272`: mixed-KV prefill K-image fallback to the split kernel.

The nearby A7X `FLASH_ATTN_EXT` compiler-crash carve-out remains unchanged.

## Changes

### Commit `815b8edc26982a916c0e7bdaaac5d9f946d68bcc`

`llama-bench: add no-extra-bufts control`

- Added `--no-extra-bufts` as a flag with default `false`, preserving extra buffer types/repacking by default.
- Plumbed it to `llama_model_params.use_extra_bufts = !no_extra_bufts`.
- Included it in model-parameter equality/reload decisions.
- Added `no_extra_bufts` to all benchmark output formats. It follows the existing boolean convention: Markdown/CSV values are `0`/`1`, while JSON/JSONL values are `false`/`true`.

### Commit `b5ef768afd82ec7b5e13aadd8abc0e40b9c7d487`

`opencl: reject flash attention without a compiled kernel`

- Made `g_opencl_fa_dims` in `fa_tune.h` the source of truth for supported FA head-size pairs.
- During `supports_op`, ensured the selected base FA variant is compiled for non-DK=512 paths. A missing/failed variant now returns `false` from `supports_op`, allowing CPU fallback before any dispatch `.at()` lookup.
- Left the existing DK=512 handling and A7X carve-out intact.

## Verification

- PC llama-bench build: PASS
  - Tree: `build-llama-pc`
  - Command: `ninja -C build-llama-pc llama-bench -j 8` using the installed Visual Studio developer environment and bundled Ninja.
- Flag parse/help check: PASS, exit code `0`
  - Command: `build-llama-pc/bin/llama-bench.exe --no-extra-bufts --help`
  - Output: `--no-extra-bufts                            (default: disabled)`
- Requested Android/OpenCL build: PASS
  - Tree: `build-android-opencl-s3oracle`, configured against this nested checkout.
  - Command: `ninja -C build-android-opencl-s3oracle test-backend-ops ggml-opencl llama-bench -j 8`
  - Final rerun: `ninja: no work to do.`
- `git diff --check`: PASS.
- Final nested checkout: clean, with exactly the two commits above and still no remotes.

## Honest limits

The Android targets were built but not executed on a device. No PC-side OpenCL runtime can prove the ARM compiler-failure path, the actual CPU fallback during graph scheduling, or the 8 GB device memory/power behavior. Those require an ARM/OpenCL device run, ideally with an affected head size and the benchmark's `--no-extra-bufts` output captured.
