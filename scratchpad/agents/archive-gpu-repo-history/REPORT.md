# GPU / OpenCL on Adreno: what our own history already contains

Role: explorer, read-only. No edits, no commits, no checkout, no stash, no push, no phone.
All statements below come from `git log`, `git show` and `git grep` against objects in the
repositories, never from the working tree (the engine checkout is dirty and another session
is committing into it).

Repositories read:

| repo | path | revision the analysis is anchored on |
|---|---|---|
| engine fork | `/Users/marco/Projects/kalsallama` | `HEAD` = `833cde99b` (main), plus branch tip `1068eb03d` (`kalsa-gpu-opencl-v73`) |
| binding fork | `/Users/marco/Projects/llama.rn-kalsa` | `HEAD` = `0288dc27` (main) |
| lab patches | `/Users/marco/Projects/kalsa-moe-experiments/patches/` | working state on disk |

Two-line summary before the detail: (a) every zero-copy / host-pinned / temp-buffer /
allocation-retry mechanism in our engine history was written by **Qualcomm contributors to
upstream llama.cpp**, not by this lab, and all of it is already inside the engine commits we
publish; (b) the one Adreno zero-copy claim in our history is a **comment with no citation**,
and it is about the Adreno **X1-85** (Snapdragon X Elite, `ADRENO_GPU_GEN::X1E`), **not** about
the Adreno 740 in the Galaxy S23 (`A7X`).

---

## SECTION 1 - Repo inventory and pin topology

### 1.1 Engine fork (`kalsallama`)

`git log --all --oneline | wc -l` = 16230 commits across all refs, which includes the full
ggml-org upstream history fetched into `remotes/upstream/*`. The fork's own work is a small
fraction. Local branches:

| branch | tip | date | note |
|---|---|---|---|
| `main` | `833cde99b` | 2026-09-21 15:23 -0400 | the checkout's HEAD |
| `kalsa-gpu-opencl-v73` | `1068eb03d` | 2026-09-21 15:33 -0400 | the GPU lane; **child of `833cde99b`**, not merged to main |
| `kalsa-slot-and-metal` | `2a290390d` | 2026-09-21 00:47 -0400 | |
| `b11010-merge` | `2a290390d` | same | same tip as above |
| `opencl-moe-masks` | `2361be359` | 2026-09-19 | strictly inside main |
| `bump-rehearsal-tmp` | `50a00c78e` | | |
| `mtp-ctx-other` | `284ea0f08` | | |

### 1.2 The four pins, and their real order

The mission names `4ccef2f85`, `2a290390d`, `8537d097c`, `1068eb03d` as "the engine commits we
ship". They are not four sibling commits; three of them are a linear chain and the fourth is a
branch tip on top of main. Verified with `git merge-base --is-ancestor`:

```
8537d097c  bmoe: build under minSdk 23 and under -Werror      2026-09-19 17:14
    |
4ccef2f85  ci : name tag builds after the tag ...             2026-09-20 15:18   <- binding's LLAMA_CPP_COMMIT
    |
2a290390d  ci : drop the Metal packaging work ...             2026-09-21 00:47
    |
833cde99b  server : stamp the cache namespace on a restored slot   2026-09-21 15:23   <- engine main HEAD
    |
1068eb03d  gpu: no exit(1) on the OpenCL compile path ...     2026-09-21 15:33   <- kalsa-gpu-opencl-v73, BRANCH ONLY
```

- `4ccef2f85` is the commit the binding actually pins: `vendor/VERSIONS` line reads
  `LLAMA_CPP_REF=4ccef2f85dbc27e095e11ffcbad4628be9961790`, and binding commit `0288dc27`
  is titled `build(engine): pin llama.cpp to 4ccef2f85 (checkpoint persistence + cache_salt)`.
- `8537d097c` was the earlier binding pin, set by `0a9b9379` `build(engine): pin 8537d09 so
  bmoe builds at minSdk 23 and under -Werror`.
- `2a290390d` and `833cde99b` are ancestors of main, so they ship.
- `1068eb03d` is **not** an ancestor of any of the other three. Nothing in the binding points at
  it. It carries the newest OpenCL work (verdict / kernel-set keying / V73 GPU prefill lane) and
  is currently unpinned.

Consequence for this mission: any OpenCL mechanism we design against "the current code" is
already the same file in `4ccef2f85` and in `1068eb03d`, differing only by the ~264-line
`ggml-opencl.cpp` delta of `1068eb03d` plus its `cl-program-cache.*` additions. Line numbers
below are given for both anchors where they differ.

### 1.3 The engine's `ggml-opencl` tree is 294 commits deep

`git log --all --oneline -- ggml/src/ggml-opencl/ | wc -l` = **294**. It starts at
`a76c56fa1` (2024-12-13, lhez, *Introducing experimental OpenCL backend with support for
Qualcomm Adreno GPUs*, PR #10693) and runs to `1068eb03d`. Two distinct authorships live in
that range:

- **Upstream/Qualcomm** - `lhez <lih@qti.qualcomm.com>`, `Hongqiang Wang <wangh@qti.qualcomm.com>`,
  `shaofeiqi`, `yzyyzyhhh`, `rmatif`. These are real llama.cpp upstream commits, confirmed by
  `git merge-base --is-ancestor <c> upstream/master` returning true for e.g. `8a56aedd6` and
  `4fc4ec554`. They arrive in our tree through the fork's upstream merges
  (`3f3558b3b`, 2026-09-16, "Merge upstream snapshot 2026-09-04 (844 commits)").
- **This lab** - `Marco Gualtieri <66642624+Aspis0@users.noreply.github.com>` and the older
  identity `Saurias92`, which appears with two emails in the history
  (`66642624+Aspis0@users.noreply.github.com` on e.g. `206a8fe7f`, `66642624+Aspis0@users.noreply.github.com`
  on e.g. `c8f4fc05e`). Lab work starts 2026-08-12. Roughly 45 of the 294 commits.

Nothing else in either repo touches OpenCL.

### 1.4 Where the kernels and runtime actually live

Engine, `ggml/src/ggml-opencl/` at `HEAD`:

```
ggml-opencl.cpp                  (~14.5k lines - the whole runtime + all dispatch)
ggml-opencl-kalsa-diag.cpp       (337 lines, lab-only, moved out by 8e081313f)
ggml-opencl-kalsa-diag.h         (68 lines)
cl-program-cache.cpp             (upstream ed7adbfef + branch work in 1068eb03d)
cl-program-cache.h
fa_tune.h
libdl.h
kernels/                         (.cl sources + embed_kernel.py)
CMakeLists.txt                   (NOT evaluated by the app build - see SECTION 5)
```

---

## SECTION 2 - Commit ledger, newest first (engine, `ggml-opencl` plus host-memory work)

Status legend: `IN` = ancestor of that pin; `OUT` = not. The pins checked are
`4ccef2f85` / `2a290390d` / `8537d097c` / `1068eb03d`.

### 2.1 Lab-authored OpenCL commits

| hash | date | author | what it did | status |
|---|---|---|---|---|
| `1068eb03d` | 2026-09-21 | Marco Gualtieri | Removes `exit(1)` from the OpenCL compile path; records a whole-kernel-set verdict so a failed compile is reported, not fatal; adds `GGML_OPENCL_KERNEL_SET_ID` to the program-cache key (`cl-program-cache.cpp:249-259`) and a `cl_program_cache_save_verdict`/`load_verdict` pair keyed on device identity alone; adds the V73 GPU prefill lane. 264 lines in `ggml-opencl.cpp`, 81 in `cl-program-cache.cpp`. | **OUT of all three shipped pins; IN only itself** (branch-only `kalsa-gpu-opencl-v73`) |
| `2361be359` | 2026-09-19 | Marco Gualtieri | q4_K dp4a MoE GEMM: pass the `get_scale_min_k4` masks as kernel args instead of recomputing them in-kernel. Tip of `opencl-moe-masks`. | IN all |
| `26c7affb7` | 2026-09-19 | Marco Gualtieri | Same mask-as-arg fix for the build of `kernel_gemv_moe_q4_k_f32_ns_wimg`. | IN all |
| `754a96426` | 2026-09-19 | Marco Gualtieri | Guard the padded-grid destination stores in the q4_K/q6_K noshuffle GEMV tail (padded M leaves lanes writing out of range). | IN all |
| `738346fd6` | 2026-09-19 | Marco Gualtieri | Same guard for the remaining padded-grid store tails: split-K partial buffer and the mc3 GEMVs. | IN all |
| `cf1bc2395` | 2026-09-19 | Marco Gualtieri | Drop an over-broad `#error` on the bin-kernel path, keep the comment. | IN all |
| `8e081313f` | 2026-09-19 | Marco Gualtieri | Relocate the lab diagnostic scaffolding out of `ggml-opencl.cpp` into `ggml-opencl-kalsa-diag.cpp/.h` (337 + 68 new lines, 329 removed). This is the commit that later broke the app link - see SECTION 5. | IN all |
| `f6ba2786d` | 2026-09-19 | Marco Gualtieri | Set `CL_TARGET_OPENCL_VERSION` in the relocated diag translation unit. | IN all |
| `70b4302bb` | 2026-09-17 | Marco Gualtieri | Close two blocks the 2026-09-04 upstream merge broke. | IN all |
| `3f3558b3b` | 2026-09-16 | Marco Gualtieri | Merge upstream snapshot 2026-09-04 (844 commits) into the fork. The carrier for most upstream OpenCL work below. | IN all |
| `67c73d26c` | 2026-09-07 | Marco Gualtieri | Compute the Adreno q4_K GEMM product in f32. | IN all |
| `513bf4cea` | 2026-09-07 | Marco Gualtieri | Compute the Adreno q4_0 GEMM product in f32. | IN all |
| `2f3b24dee` | 2026-09-06 | Marco Gualtieri | Use the generic f16 kernel for the Adreno batched view `MUL_MAT`. | IN all |
| `c8f4fc05e` | 2026-08-20 | Saurias92 | Add `GGML_OPENCL_LOG_ALLOC=1`, an unbuffered allocation trace, for the oomwall work. This is the lab's only allocation-observation instrument on the OpenCL path. | IN all |
| `c1bb48d32` | 2026-08-20 | Saurias92 | **Fix q4_K/q5_K MoE `MUL_MAT_ID` on Adreno 740** by passing the `get_scale_min_k4` masks as kernel args. Called out as the "4th E031 miscompile". The single most S23-specific OpenCL fix in the tree. Superseded in form by `26c7affb7`/`2361be359`. | IN all |
| `9a4112106` | 2026-08-21 | Saurias92 | Make the q4/q5/q6 MoE K kernels barrier-safe. | IN all |
| `f700bf30c` | 2026-08-21 | Saurias92 | q2_K/q3_K Adreno MoE GEMV/GEMM plus `supports_op` (S3+S4). | IN all |
| `b5ef768af` | 2026-08-21 | Saurias92 | Reject flash attention when no FA kernel was compiled (fail closed instead of dispatching a null kernel). | IN all |
| `9dc1ec0cb` | 2026-08-19 | Saurias92 | Halve MoE `MUL_MAT_ID` error on Adreno by dropping unaligned vector loads. | IN all |
| `39a0b130f` | 2026-08-19 | Saurias92 | Fix Adreno trans4 pack sign-smear ("defect P") by shift-first nibble extraction. | IN all |
| `eaec5d884` | 2026-08-19 | Saurias92 | Fix Adreno MoE trans4 restore aliasing. | IN all |
| `538341999` .. `bcdbc9ed6` | 2026-08-19 | Saurias92 | Nine-commit run of in-situ GEMV audit and dequant-oracle probes (`GGML_OPENCL_GEMV_AUDIT`, `GGML_OPENCL_ORACLE`, `GGML_OPENCL_HOST_REPACK`). All diagnostic, all in-pin. | IN all |
| `dc3870579`, `8e0063d2a`, `7686ca6fc`, `1882bf8cd` | 2026-08-21 | Saurias92 | Guard the q6_K flat workaround by GPU family; make unknown compiler versions explicit; skip empty MoE matmul dispatch; stale-comment fixes. | IN all |
| `dcd0a7607`, `32b318aab` | 2026-08-12 | Saurias92 | Stop the Q6_K noshuffle kernel being stolen for large even-vocab M. | IN all |

**Branch-only / experimental lab commits (do not ship):**

| hash | date | what it did |
|---|---|---|
| `b33bea25b` | 2026-09-19 | Merge of `upstream/master` into `bump-rehearsal-tmp`. |
| `7ef9389bc`, `5d188a9e4`, `eefa27e30` | 2026-09-07 | Selectable precision / math flags / f32 activation operand / image-format narrowing for the Adreno q4_0 GEMM. Predecessors of the shipped `513bf4cea`. |
| `33ebbd210`, `5f0701dac` | 2026-09-06 | Fault-injected Adreno f16 GEMM behind `KALSA_BENCH_FAULT_INJECT`, explicitly "oracle negative control, never merge". |
| `303eb5965`, `2306c171c`, `208745803`, `042d76953`, `7670428d6` | 2026-08-12 | The "MLD" (subgroup-free Q4_K GEMV + tiled convert) experiment. |
| `836813816`, `5a5dd9b73`, `435eacf36` | 2026-08-22 | Mali / UNKNOWN-GPU probe commits, marked "do not merge". |

### 2.2 Upstream OpenCL commits that matter, and their pin status

All of these are `IN` all four pins unless marked.

| hash | date | author | what it did (problem -> solution) |
|---|---|---|---|
| `60081bb2b` | 2026-09-18 | dsproule | Add bin kernel `flash_attn_f32_f16_bin`. **OUT of every pin** - arrives after the `3f3558b3b` merge. |
| `ec9281505` | 2026-09-18 | shaofeiqi | Add bin kernel `kernel_gemm_noshuffle_q6_k_f32_32b_trans_ila_a8_bin`. OUT of every pin. |
| `c57da6fd8` | 2026-09-16 | lhez | OpenCL warning cleanup (#28984). |
| `9f31776c3` | 2026-09-15 | Hongqiang Wang | Choose the MoE expert matmul by batch size for speculative decoding / MTP (#27637). |
| `56b9eb280` | 2026-09-12 | Hongqiang Wang | Apply the noshuffle row-alignment rule to q4_K, q5_K and q8_0, not just q6_K (#28575). |
| **`8a56aedd6`** | **2026-09-11** | **Hongqiang Wang (Qualcomm)** | **"opencl: fix several bugs where the backend aborts" (#27630). THE commit for items 2 and 3. 224 insertions / 128 deletions in `ggml-opencl.cpp` only. Adds the temp upload/download buffer helpers with the Adreno X1-85 fragmentation comment and the three-step retry, the four-step retry in `alloc_buffer`, and the `CL_MEM_USE_HOST_PTR` claim. Detail in SECTION 3.** |
| `07fc97716` | 2026-09-11 | shaofeiqi | Add bin kernel `kernel_gemm_noshuffle_q4_k_f32_32b_trans_ila_a8_bin`. |
| `df03399b8` | 2026-09-10 | shaofeiqi | Add A8 Q4_0 mm binary kernel support. |
| `4acf4a4cb` | 2026-09-05 | yzyyzyhhh | Add the Adreno xmem SDPA path (#26331). |
| `1548a240e` | 2026-09-04 | Hongqiang Wang | Extend elementwise and data-movement op coverage (#27633). |
| `95ef7fc16` | 2026-09-03 | Hongqiang Wang | Quant lm_head / decode GEMV / medium-batch GEMM optimizations for spec decoding and MTP (#26477). One of the four commits in history that mentions `X1-85`. |
| `8fe4bf8d3` / `43d87ff2d` | 2026-09-01 | Hongqiang Wang | Fix out-of-bound reads in the Adreno image kernels (#27632). |
| `c841aeeb8` | 2026-08-29 | Hongqiang Wang | Use a better matmul path on two Adreno GPU generations (#27640). |
| `58546250c` | 2026-08-27 | Shawn Gu | Add bin kernels `kernel_gemm_moe_q4_0_q8_1_dp4a_bin`, `kernel_gemm_moe_mxfp4_q8_1_dp4a_bin`. |
| `9ee9fc04c` | 2026-08-19 | Hongqiang Wang | Make the MoE expert scatter deterministic (#26464). |
| `12f6d9b6d` / `60addddf3` | 2026-08-18 | Hongqiang Wang | Fix a write-after-read race in the generic FA tile kernels when the workgroup spans subgroups (#26434). |
| `cd26896c1` | 2026-08-20 | Hongqiang Wang | Keep the vocab-scale K-quant lm_head on the CPU for Adreno A7X (compiler workaround, #26440). **Adreno-family limitation, and it names A7X - the S23 family.** |
| `6503355df` | 2026-08-20 | Hongqiang Wang | Fix q6_K flat mul_mat for Adreno A6x/A7x with older E031 compilers (#26476). |
| `89e0aa6fd` | 2026-08-11 | Hongqiang Wang | Default FA c8 cluster width to 16 on X1E (#26433). Another `X1-85`-adjacent mention. |
| `cb27fe9c3` | 2026-08-11 | lhez | Use flat mv q5_K when the weight exceeds the `image1d_buffer_t` limit (#26880). **Directly relevant to a shared-weights design: it is an existing size-driven path switch on the weight buffer.** |
| `273043b82` / `8190848bb` | 2026-07-28 | Hongqiang Wang | Skip the Adreno KQ/KQV image kernels for multi-stream batches (#26189). |
| **`ed7adbfef`** | **2026-07-24** | **Hongqiang Wang** | **"opencl: cache compiled cl_program binaries on disk" (#26050). The program cache. Creates `cl-program-cache.cpp`.** |
| `c7ad97025` | 2026-07-19 | Hongqiang Wang | Support broadcast for Adreno `MUL_MAT` and honor `view_offs` for Adreno Q8_0 `MUL_MAT` for llama-server multi-stream (#25910). |
| `b7a5e926b` / `e8f19cc0a` | 2026-07-16 | Hongqiang Wang | Load quants as `uint` for q4_K and q5_K flat mv, optimization for Adreno A7x (#25780). |
| `3dafb585f` | 2026-07-15 | Hongqiang Wang | **Disable FA and MoE weights repack to work around compiler issues on Adreno 850 (#25745).** An Adreno-family capability limitation applied to a *repacked* weight layout. |
| `9463b3aa8` | 2026-07-15 | Hongqiang Wang | Fix two issues in flash attention for Adreno a7x (#25697). |
| **`4fc4ec554`** | **2026-07-01** | **lhez (Qualcomm)** | **"opencl: allow loading precompiled binary kernels from library" (#23042). The binary-kernel path. Adds `libdl.h` to break the `ggml-backend-dl` cyclic dependency, `device->get_adreno_bin_kernel_func_t`, and the `GGML_OPENCL_USE_ADRENO_BIN_KERNELS` CMake option.** |
| `6f8895feec`, `ebd048fc5` | 2026-07-06, 2026-06-27 | Hongqiang Wang | FA decode performance; also matches `-S retry` because they introduce retry loops in the FA kernel launch path. |
| `a76c56fa1` | 2024-12-13 | lhez | **Initial OpenCL backend.** Contains the only occurrence of `get_host_buffer_type` in the entire `ggml-opencl` history - see SECTION 4. |

### 2.3 The MoE mask work, specifically

The `get_scale_min_k4` mask work exists in **two generations**:

1. **Lab generation (S23-specific).** `c1bb48d32` (2026-08-20) is the origin: q4_K/q5_K MoE
   `MUL_MAT_ID` on Adreno 740 miscompiles under the E031 compiler, so the `get_scale_min_k4`
   masks are passed as kernel args rather than computed in the kernel. `26c7affb7` and
   `2361be359` (2026-09-19) are the same fix reapplied on top of the 2026-09-04 upstream merge,
   because the merge brought a fresh copy of the kernel and a new dp4a variant
   (`kernel_gemm_moe_q4_k_f32_ns_wimg`, `kernel_gemm_moe_q4_k_dp4a`).
2. **Upstream generation (repack-related).** `3dafb585f`, `dcd0a7607`, `32b318aab`, `56b9eb280`
   are about which kernel gets selected and how packed weights are laid out, not about the mask.

The distinction matters for a shared-weights design: the lab's mask work is a *kernel-argument
plumbing* change on the MoE paths, whereas the repack/selection work is what decides whether a
weight buffer is used in its GGUF layout or in a trans4/noshuffle repacked layout. A shared or
host-pinned weights buffer would sit upstream of both.

---

## SECTION 3 - Zero-copy, host memory, pinned memory, mmap of weights: the full search

### 3.1 What was searched

Searches run across **all refs and all paths** (`git log --all -S`, `--grep -i`, and
`--follow` on `ggml-opencl.cpp`):

| needle | commits found |
|---|---|
| `zero-copy` / `zero copy` in messages | 1 (`aee56b3ab`, OpenVINO, unrelated) |
| `CL_MEM_ALLOC_HOST_PTR` | 2 in `ggml-opencl`: `8a56aedd6`, `60081bb2b` |
| `CL_MEM_USE_HOST_PTR` | 1 in `ggml-opencl`: `8a56aedd6` |
| `pinned` / `host-pinned` | `a97123e49`, `5eec3ad01` (SYCL), `09d0882840`, `3df2244df` (CUDA), `aa8b62105` (CUDA host buffer type) - **none in `ggml-opencl`** |
| `host_buffer_type` | many, **none in `ggml-opencl`** |
| `mmap of weights` / `mmap.*weight` | none in `ggml-opencl`; one in the lab's own model-loading work (`206a8fe7f`, below) |
| `shared weight` | none anywhere |

So: **inside the OpenCL backend, the entire host-memory story is one commit, `8a56aedd6`.**

### 3.2 The lab's own mmap policy work (adjacent, and reusable context)

| hash | date | author | what it did | status |
|---|---|---|---|---|
| `206a8fe7f` | 2026-08-08 | Saurias92 | `mmap: add llama_model_params.mmap_prefetch (default true)`. Exposes the `prefetch` argument to `init_mappings`, previously hard-wired `true` at `llama-model.cpp:1506` (i.e. `MAP_POPULATE` + `MADV_WILLNEED` on the *whole* GGUF). Measured on Qwen3.6-35B-A3B UD-IQ2_M (campaign F4.8): 20.76 GiB `read_bytes` at load of which 19.14 GiB were faults from the whole-file prefault. ABI-safe append, default true. | **IN all four pins** |

Commit message quote (`206a8fe7f`):

> "With expert streaming + dense-weights anon the whole-file prefault is pure waste: experts are
> read via O_DIRECT on demand and the dense trunk is copied out of the mmap. [...] Expose bool
> mmap_prefetch at the end of llama_model_params (ABI-safe append), default true for classic
> warm-load compatibility."

The same change also exists as a patch outside the engine repo, in
`kalsa-moe-experiments/patches/llama.cpp/0001-*.patch`, documented in
`kalsa-moe-experiments/patches/README.md`, with the measured effect table:

| | prefault | without | delta |
|---|---:|---:|---:|
| `read_bytes` at load | 22.72 GiB | 12.08 GiB | -47% |
| `load_seconds` | 18.6 s | 10.6 s | -8.0 s |
| `VmHWM` at load | 4536 MiB | 3786 MiB | -750 MiB |

Relevance: the lab already has a *measured*, *shipped* mechanism for controlling how weights are
mapped into the process, and it already knows the number that matters for a shared-weights
scheme - how much of the GGUF actually gets touched. Anyone designing host-pinned shared weights
should build on this commit's vocabulary rather than inventing a parallel one.

### 3.3 Item 3 - the three-step retry commit, in full

**Commit: `8a56aedd6143a014e25ec9f4295164f2f66ce30f`**
**Date: 2026-09-11 22:11:12 -0700**
**Author: `Hongqiang Wang <wangh@qti.qualcomm.com>`** (Qualcomm - this is an upstream commit,
confirmed: `git merge-base --is-ancestor 8a56aedd6 upstream/master` succeeds)
**Subject: `opencl: fix several bugs where the backend aborts (#27630)`**
**Status: IN all four pins.**
**Preceded by:** `07fc97716` (2026-09-11) and `df03399b8` (2026-09-10) on the bin-kernel side, and
directly after a run of Adreno image-kernel out-of-bounds fixes (`8fe4bf8d3`, `43d87ff2d`,
2026-09-01). It is the first commit in the tree to introduce any host-pinned allocation.

The comment it added, verbatim (`ggml-opencl.cpp:10604-10618` at `HEAD`; `:10849-10863` at
`1068eb03d`):

```
// Allocate a temporary upload buffer of `nbytes` and populate it with `data`
// from host. On Adreno X1-85 the device-only pool intermittently fails to
// allocate at hundreds of MB once model weights fragment the heap (observed
// on Qwen3.5-9B output.weight Q6_K at 834 MB). Three-step retry:
//   1. CL_MEM_READ_WRITE alloc + clEnqueueWriteBuffer (normal fast path).
//   2. clFinish + retry (drains in-flight allocs that may be holding heap;
//      mirrors the proven pattern at the FD-split partial buffer alloc).
//   3. CL_MEM_ALLOC_HOST_PTR + map(WRITE_INVALIDATE) + memcpy + unmap -
//      different memory pool (host-pinned); true zero-copy on Adreno per
//      QCOM guidance. (CL_MEM_USE_HOST_PTR is NOT zero-copy on Adreno: the
//      driver triggers an internal copy because arbitrary host pages aren't
//      guaranteed mappable/coherent, AND it draws from the same exhausted
//      device pool - so it doesn't solve the problem.)
// Returns the ready-to-read buffer (caller must clReleaseMemObject) or NULL
// if all three strategies fail. The buffer is opaque to the caller - it can
// be passed as a kernel argument like any normal cl_mem.
```

(Note: the source uses em-dashes and a Unicode arrow in that comment; transcribed as ASCII
above. The engine has since been re-read and the comment now reads with `->` where the arrow
was.)

### 3.4 Item 3b - who wrote the `CL_MEM_USE_HOST_PTR` claim, and is there a source?

- **Who:** Hongqiang Wang (Qualcomm), in commit `8a56aedd6`, 2026-09-11, PR #27630. Not this lab.
  The lab has never written or edited that text; `git log -S'CL_MEM_USE_HOST_PTR'` returns
  exactly one commit, and it is his.
- **Is a source cited?** **No.** The only attribution is the phrase "per QCOM guidance" in the
  neighbouring sentence ("true zero-copy on Adreno per QCOM guidance"). There is no URL, no
  spec section, no driver release note, no Qualcomm document number, no test, and no
  measurement. `CL_MEM_USE_HOST_PTR` is claimed never to appear as an actual allocation anywhere
  in the tree - it appears **only inside that comment**. Verified at both anchors:

  ```
  $ git show HEAD:ggml/src/ggml-opencl/ggml-opencl.cpp | grep -n 'CL_MEM_USE_HOST_PTR'
  10613://      QCOM guidance. (CL_MEM_USE_HOST_PTR is NOT zero-copy on Adreno: the
  ```

  Same single hit at `1068eb03d:...:10858`. The claim is load-bearing for a shared-weights
  decision and is **unsourced and unverified**. Treat it as a hypothesis to test, not as a
  finding to build on.

### 3.5 What the retry commit actually does with host-pinned memory

Three concrete allocation sites, all *fallbacks*, none on the weights path:

**1. Temp upload buffer** - `ggml_cl_create_temp_upload_buffer`, `ggml-opencl.cpp:10620` (`HEAD`)
/ `:10865` (`1068eb03d`). Normal path is `CL_MEM_READ_WRITE` + `clEnqueueWriteBuffer`; on
failure `clFinish` + retry; on failure again
`CL_MEM_READ_ONLY | CL_MEM_ALLOC_HOST_PTR | CL_MEM_HOST_WRITE_ONLY` at `:10639` / `:10884`,
then map with `CL_MAP_WRITE_INVALIDATE_REGION`, `memcpy`, unmap. Logs
`"... device alloc failed, using CL_MEM_ALLOC_HOST_PTR fallback"` at `:10657` / `:10902`.

**2. Temp download buffer** - `ggml_cl_create_temp_download_buffer`, `:10668` / `:10913`. Flags
flipped to `CL_MEM_WRITE_ONLY | CL_MEM_ALLOC_HOST_PTR | CL_MEM_HOST_READ_ONLY` at `:10682` /
`:10927`; does not populate.

**3. Compute buffer type alloc** - `ggml_backend_opencl_buffer_type_alloc_buffer`, four-step
retry at `:13991-14027` / `:14235-14270`:

```
// On Adreno X1-85 the device pool intermittently fails at hundreds of MB
// once the heap fragments (e.g. graph-allocator compute-buffer reserve
// after model load). Four-step retry:
//   1. normal alloc (fast path)
//   2. clFinish + retry (drains in-flight allocs)
//   3. cl_qcom_large_buffer (X2-class driver only, OpenCL 3.0 only)
//   4. ALLOC_HOST_PTR (host-pinned pool) - last-resort fallback. This
//      buffer backs compute scratch read/written by every kernel in the
//      graph, so kernel accesses fall to host memory and runtime perf
//      degrades meaningfully. Better than failing to load, but the user
//      should see the warning and consider -ngl reduction.
```

with the warn at `:14020` / `:14264`:

> `"%s: %.2f MiB allocated via CL_MEM_ALLOC_HOST_PTR fallback - device pool exhausted; runtime perf will be degraded. Consider lowering -ngl or context size."`

Two things this tells us that are easy to miss:

- The author's own comment says host-pinned allocation **degrades runtime perf meaningfully**
  when it backs a buffer that kernels read and write. That is in direct tension with the
  "true zero-copy, therefore fast" framing. The retry exists to avoid a *failure*, not to gain
  a *speedup*.
- The `cl_qcom_large_buffer` step is guarded by
  `backend_ctx->adreno_has_large_buffer = strstr(ext_buffer, "cl_qcom_large_buffer") != NULL`
  at `:6770` / `:6994`, and the `CL_MEM_ALLOC_HOST_PTR` step is gated on the device not having
  it. Neither is exercised by the S23's Adreno 740 unless the QUALCOMM driver exposes the
  extension.

Both temp helpers are only reached from `ggml_backend_opencl_buffer_set_tensor` for the
quantized trans4 convert/restore paths. **They are weight-*upload* helpers, not a
weight-*sharing* mechanism.** For a shared-weights design they are useful as the closest existing
precedent for "allocate in the host-pinned pool and hand the `cl_mem` to a kernel", but they
deliberately allocate a *private copy* of the data and free it (`caller must clReleaseMemObject`).

---

## SECTION 4 - Item 4: `get_host_buffer_type` for OpenCL - never implemented

**Verdict: never implemented, not added, not removed, not stubbed-with-code. It has been `NULL`
continuously since the backend's first commit.**

Evidence. `git log --all -S'get_host_buffer_type' -- ggml/src/ggml-opencl/` returns exactly one
commit:

```
a76c56fa1  2024-12-13  lhez  Introducing experimental OpenCL backend with support for Qualcomm Adreno GPUs (#10693)
```

and the hit in that commit is the initialiser itself:

```
+    /* .get_host_buffer_type = */ NULL,
```

Same search restricted to `host_buffer_type`: same single commit, same reason. Current state at
both anchors:

| what | `HEAD` (`833cde99b`) | `1068eb03d` |
|---|---|---|
| `.get_host_buffer_type` in `ggml_backend_opencl_device_i` | `:14213` = `NULL` | `:14457` = `NULL` |
| `.buffer_from_host_ptr` in the same struct | `:14214` | `:14458` |
| `props->caps.host_buffer` | `:14139` = `false` | `:14383` = `false` |
| `props->caps.buffer_from_host_ptr` | `:14140` = `false` | `:14384` = `false` |
| `props->caps.mmap_support` | `:14142` = `false` | `:14386` = `false` |
| buffer-type `iface.is_host` | `:14096` = `NULL` | same |

Correction to a natural but wrong expectation: `buffer_from_host_ptr` **is** wired to a real
symbol (`ggml_backend_opencl_device_buffer_from_ptr`), but the symbol is a **pure stub** - it
ignores all four arguments and `return nullptr;`. Body at `HEAD:ggml-opencl.cpp:14177-14183`,
at `1068eb03d:14421`. So the device advertises the *existence* of a host-pointer path in its
interface table while declaring the *capability* false and returning null.

For contrast, the mechanism does exist in ggml generally and in other backends in this same
tree: `aa8b62105` (2026-02-16, Gaurav Garg, *Support device-specific host buffer types if all
underlying backends expose the same type... pinned memory instead of pageable memory for CUDA*),
which is **OUT** of all four pins, and the SYCL pinned-memory work `a97123e49` / `5eec3ad01`.
So the interface and the precedent exist; the OpenCL implementation does not.

---

## SECTION 5 - Item 5: the binding's Android build, confirmed from its own files

### 5.1 Confirmed: the app build never evaluates the engine's `ggml-opencl/CMakeLists.txt`

This is stated in the binding's own commit message and is visible in its CMake. Commit
`bde3f975` (2026-09-19, Marco Gualtieri, *fix(cmake): compile the whole OpenCL backend
directory, not two named files*):

> "The Android link step failed on fifteen undefined `ggml_opencl_*` symbols. They are defined
> in `ggml-opencl-kalsa-diag.cpp`, which is vendored and which the engine's own
> `ggml/src/ggml-opencl/CMakeLists.txt` builds - but **llama.rn does not use that CMakeLists**.
> It carried a hand-written list naming only `ggml-opencl.cpp` and `cl-program-cache.cpp`,
> repeated at three call sites, so the third file was never compiled and only the linker
> noticed."

Mechanism, verified in the current binding files:

- `cmake/rnllama-sources.cmake:78-86` declares
  `set(RNLLAMA_GGML_OPENCL_DIR "${_ggml}/ggml-opencl")` and then
  `file(GLOB RNLLAMA_GGML_OPENCL_SOURCES CONFIGURE_DEPENDS ${RNLLAMA_GGML_OPENCL_DIR}/*.cpp)`,
  where `_ggml = ${RNLLAMA_LLAMA_CPP_DIR}/ggml/src` and `RNLLAMA_LLAMA_CPP_DIR = vendor/llama.cpp`.
  The comment there says it outright: *"The engine's own CMakeLists builds this whole directory."*
- The three consumers are `android/src/main/rnllama/CMakeLists.txt`, `tests/android/CMakeLists.txt`
  (two targets), all now using `${RNLLAMA_GGML_OPENCL_SOURCES}`.
- `vendor/llama.cpp/ggml/src/ggml-opencl/CMakeLists.txt` **exists** in the vendored tree (so the
  file is present but inert for the app), and `vendor/llama.cpp` is committed as plain files in
  the outer repo (1559 tracked paths under `vendor/`; the directory has no `.git` of its own -
  `cd vendor/llama.cpp && git log` walks out to the binding's history).

Direct consequence for a shared-weights design: **any change to `ggml-opencl/CMakeLists.txt`
(adding a source file, a compile definition, a link library) has no effect on the app build.**
The app build's OpenCL compile definition set is hard-coded in
`android/src/main/rnllama/CMakeLists.txt` and its OpenCL source set is a glob. A new
`ggml-opencl-*.cpp` file in the engine would be picked up by the glob (that is what `bde3f975`
achieved), but a new CMake *option* or *definition* would not.

### 5.2 The JNI variant scheme

From `android/src/main/rnllama/CMakeLists.txt`. One function,
`build_rnllama_library(target_name arch cpu_flags)`, is called once per variant; the scheme is
driven by the target *name* string:

```cmake
set(ENABLE_OPENCL OFF)
if (${target_name} MATCHES ".*_opencl$")
    set(ENABLE_OPENCL ON)
endif ()

set(ENABLE_HEXAGON OFF)
if (${target_name} MATCHES ".*_hexagon.*")
    set(ENABLE_HEXAGON ON)
endif ()
```

Variant list (arm64-v8a only; x86_64 gets one plain target):

| variant | cpu_flags | OpenCL | Hexagon |
|---|---|---|---|
| `rnllama` | (none, `GGML_CPU_GENERIC`) | no | no |
| `rnllama_v8` | `-march=armv8-a` | no | no |
| `rnllama_v8_2` | `-march=armv8.2-a` | no | no |
| `rnllama_v8_2_dotprod` | `-march=armv8.2-a+dotprod` | no | no |
| `rnllama_v8_2_i8mm` | `-march=armv8.2-a+i8mm` | no | no |
| `rnllama_v8_2_dotprod_i8mm` | `-march=armv8.2-a+dotprod+i8mm` | no | no |
| **`rnllama_v8_2_dotprod_i8mm_hexagon_opencl`** | `-march=armv8.2-a+dotprod+i8mm` | **YES** | yes (if SDK present) |
| `rnllama_x86_64` | `-march=x86-64 -mtune=generic -msse4.2 -mpopcnt` | no | no |

**Exactly one variant carries OpenCL**, and it is the same one that carries Hexagon - the
heavy `+dotprod+i8mm` build. Selection at runtime is by target name; a device that loads the
plain `rnllama_v8_2_dotprod_i8mm` library gets no OpenCL at all. Per-variant `-flto=thin` is
used deliberately (a comment records that full LTO OOM-killed 16 GB CI runners).

### 5.3 OpenCL compile flags, as hard-coded in the binding

```cmake
target_compile_options(${target_name} PRIVATE
    -DGGML_USE_OPENCL
    -DGGML_OPENCL_USE_ADRENO_KERNELS
    -DGGML_OPENCL_EMBED_KERNELS
    -DGGML_OPENCL_SOA_Q
    -DGGML_OPENCL_TARGET_VERSION=300
)
```

Notable by its **absence**: `GGML_OPENCL_USE_ADRENO_BIN_KERNELS` is **not** set, so the entire
binary-kernel path from upstream `4fc4ec554` is compiled out of the shipped app even though the
commit is an ancestor of the pinned engine. Also absent: `GGML_OPENCL_PROFILING`.

Kernel embedding is done by the binding, not the engine: it globs
`${RNLLAMA_GGML_OPENCL_DIR}/kernels/*.cl` and drives the engine's own `embed_kernel.py` itself,
with a comment warning not to replace the glob with a name list (it says a hand list "did, and
the arm64 OpenCL target failed at build time").

### 5.4 The `libOpenCL.so` stub

```cmake
set(OPENCL_STUB_DIR ${RNLLAMA_ROOT_DIR}/bin/${ANDROID_ABI})
set(OPENCL_STUB     ${OPENCL_STUB_DIR}/libOpenCL.so)

if (EXISTS ${OPENCL_STUB})
    # Keep using -lOpenCL so we don't create a packagable .so target.
    target_link_directories(${target_name} PRIVATE ${OPENCL_STUB_DIR})
    target_link_libraries(${target_name} PRIVATE OpenCL)
else()
    message(WARNING "OpenCL library not found. Please build with ./scripts/build-opencl.sh")
endif()
```

`bin/arm64-v8a/libOpenCL.so` is present on disk (308544 bytes).
`scripts/build-opencl.sh` builds it from the vendored `vendor/OpenCL-ICD-Loader` at
`ANDROID_PLATFORM=android-21`, `NDK_VERSION=27.3.13750724`, and says in its own header comment:
*"the result is only used as a link stub"*. The real driver is resolved on-device by the
Android OpenCL loader. Include path comes from
`RNLLAMA_OPENCL_HEADERS_DIR = vendor/OpenCL-Headers`.

### 5.5 How the engine reaches the binding

`KALSA_FORK.md` states the invariant:

> `vendor/llama.cpp = the kalsallama pin + scripts/patches/llama.cpp/*.patch`
> "Nothing under `vendor/llama.cpp` is edited by hand: an edit there is lost on the next
> `npm run sync:vendor`. Any kalsa-specific engine change lives as a commit in the kalsallama
> fork (re-point `LLAMA_CPP_REF`) or as a patch under `scripts/patches/llama.cpp/`."

`vendor/VERSIONS` carries `LLAMA_CPP_REPO=https://github.com/Aspis0/kalsallama`,
`LLAMA_CPP_REF=4ccef2f85...`. The patch set in `scripts/patches/llama.cpp/` is 20 files and
contains **no OpenCL patch** - it is Barbet/architecture work, chat/jinja/sampling,
`llama-mmap.cpp.patch`, and Metal kernels (`ggml-metal-flash-attn-smem.patch`,
`ggml-metal-mul-mv-id-tiitg.patch`). `scripts/kalsa-patches/` has only `common.cpp.patch` and
`common.h.patch`. So all OpenCL content in the app arrives via the engine pin, not via patches.

---

## SECTION 6 - Item 6: phone GPU measurement, driver strings, family limitations

### 6.1 Measured GPU throughput on a phone: **no commit in either repo records one**

Searches that came back empty in commit messages and in touched files:

- `git log --all -S'Adreno (TM)'` -> nothing (no device string ever committed)
- `git log --all -S'QUALCOMM build'` -> nothing
- `git log --all -S'OpenCL 3.0 QUALCOMM'` -> nothing
- no commit message in either repo contains a phone GPU tokens/s figure, an Adreno 740
  benchmark table, or a Galaxy S23 throughput number

What *does* exist is the **instrumentation** to take such a measurement, but no recorded result
in git:

| hash | date | author | what |
|---|---|---|---|
| `c8f4fc05e` | 2026-08-20 | Saurias92 | `GGML_OPENCL_LOG_ALLOC=1`, an unbuffered allocation trace. Implemented in `ggml-opencl-kalsa-diag.cpp` (`ggml_opencl_log_alloc` at `:85`, `ggml_opencl_log_alloc_enabled` at `:79`, `ggml_opencl_log_alloc_note` at `:96`), called from the alloc path with pool labels `try.weights_pool`, `try.weights_pool.qcom_large`, `weights_pool` (`ggml-opencl.cpp:13988`, `:14009`, `:14027` at `HEAD`). **This is the lab's only allocation-side instrument, and it is already in all four pins.** |
| `c77fe1354` | 2026-08-21 | Saurias92 | `llama-bench/opencl: align no-repack and guard FA` - uses the common `-nr/--no-repack` spelling in llama-bench, keeps the old spelling as a hidden alias, dedupes valueless settings, and guards the OpenCL backend context before the lazy FA lookup. Bench harness plumbing, no numbers. |
| `815b8edc2` | 2026-08-21 | Saurias92 | `llama-bench: add no-extra-bufts control`. |
| `33ebbd210` | 2026-09-06 | Marco Gualtieri | `bench: fault-injected Adreno f16 GEMM (KALSA_BENCH_FAULT_INJECT, off by default) - oracle negative control, never merge`. **Branch-only, not in any pin.** A correctness control, not a perf measurement. |
| `f700bf30c`, `2217d61a0` | 2026-08-21 | Saurias92 | q2_K/q3_K Adreno MoE GEMV/GEMM plus GEMM padding-lane discriminators (m=96 n=4). Correctness tests, in-pin. |
| `1068eb03d` | 2026-09-21 | Marco Gualtieri | Adds `tests/test-opencl-moe-roundtrip.cpp` (82 lines) and a `tests/CMakeLists.txt` entry. **Branch-only.** |

The lab's OpenCL work between 2026-08-12 and 2026-09-21 is **entirely correctness** (E031
miscompiles, sign-smear, restore aliasing, barrier safety, out-of-range stores, kernel-set
verdicts). No commit in that run claims a speedup.

### 6.2 Adreno driver strings: parsed, never recorded

The code that reads them exists and is substantial; the *values* are not in git.

- `get_adreno_gpu_gen(const char * device_name)` at `ggml-opencl.cpp:285-321` (`HEAD`). Family
  classification by substring match on the device string:

  | substring | enum |
  |---|---|
  | `"740"`, `"750"` | `ADRENO_GPU_GEN::A7X` (`:302`) |
  | `"810"`, `"830"`, `"840"`, `"850"` | `A8X` |
  | `"X1"` | `X1E` |
  | `"X2"` | `X2E` |
  | else | `ADRENO_UNKNOWN` |

  **The Galaxy S23's Adreno 740 lands in `A7X`.** Called at `:6624` from
  `dev_ctx->device_version` and at `:6626` from `dev_ctx->device_name`.

- `get_adreno_cl_compiler_version(const char * driver_version)` at `:323+`. Parses `E031`
  (offsets 5/8/11, length 13) and `E17` (offsets 4/7/10, length 12) out of the driver string.
  It carries an unusually explicit comment about not guessing:

  > "The in-tree driver strings document E031 and DX layouts only. E17 is mentioned by the
  > kernel/compiler workarounds, but no E17 driver string or version-field layout is documented
  > here. Do not guess its offsets or gate semantics: unrecognized compiler strings remain
  > UNKNOWN."

- Driver string is read at `:6732-6737` via `clGetDeviceInfo(..., CL_DRIVER_VERSION, ...)` and
  stored in `backend_ctx->driver_version`; printed in the backend banner at `:6550`. It is a
  runtime value, never a committed one.

### 6.3 Adreno-family capability limitations that ARE recorded in commits

Every one of these is an upstream Qualcomm commit, and every one is `IN` all four pins unless
noted. Together they are the best available evidence of what this code believes about Adreno
families.

| hash | date | Adreno family | limitation |
|---|---|---|---|
| `8a56aedd6` | 2026-09-11 | **X1-85** (X1E) | Device-only pool intermittently fails at hundreds of MB once model weights fragment the heap; needs the three/four-step retry. Observed on Qwen3.5-9B `output.weight` Q6_K at 834 MB. Explicitly a laptop-class part, not a phone. |
| `c841aeeb8` | 2026-08-29 | two Adreno generations | "use a better matmul path on two Adreno GPU generations" (#27640) - i.e. gen-conditional kernel selection. |
| `cd26896c1` | 2026-08-20 | **A7X** | Keep the vocab-scale K-quant `lm_head` on the CPU - compiler issue workaround (#26440). **Directly names the S23's family.** |
| `6503355df` / `5c7e16fa6` | 2026-08-20 | **A6x / A7x, older E031** | q6_K flat `mul_mat` broken on older E031 compilers; fix and cherry-pick (#26476 + fork cherry-pick). |
| `273043b82` / `8190848bb` | 2026-07-28 | Adreno | Skip the KQ/KQV image kernels for multi-stream batches (#26189). |
| `3dafb585f` | 2026-07-15 | **Adreno 850** | Disable FA **and MoE weights repack** to work around compiler issues (#25745). The only recorded case of a *weight layout* being turned off per Adreno family. |
| `89e0aa6fd` | 2026-08-11 | **X1E** | Default FA c8 cluster width to 16 on X1E (#26433). |
| `ded446b34` | 2026-03-26 | Adreno | Allow the large buffer (`cl_qcom_large_buffer`, property `0x41A6`) for Adreno (#20997). |
| `a9883db8e` | 2026-05-13 | Adreno | Add opt-in xmem F16xF32 GEMM for prefill (#22755). |
| `1e4579fbb` | 2026-05-13 | Adreno | Fix crash when warming up MoE (#22876). |
| `5c0eb5ef5` | 2025-08-02 | Adreno | Fix the Adreno compiler detection logic (#15029). |
| `82974011f` | 2025-04-07 | Adreno | "better identify Adreno GPU" (#12760) - the ancestry of `get_adreno_gpu_gen`. |

Plus the **lab's own** S23 findings, all in-pin:

| hash | date | what was found on Adreno 740 |
|---|---|---|
| `c1bb48d32` | 2026-08-20 | q4_K/q5_K MoE `MUL_MAT_ID` miscompiles under E031; masks must be kernel args. Labelled the **4th** E031 miscompile. |
| `9dc1ec0cb` | 2026-08-19 | Unaligned vector loads double the MoE `MUL_MAT_ID` error; dropping them halves it. |
| `39a0b130f`, `f63746555` | 2026-08-19 | trans4 pack sign-smear ("defect P"); scalar-uint rewrite. |
| `eaec5d884` | 2026-08-19 | trans4 restore aliasing. |
| `9a4112106` | 2026-08-21 | q4/q5/q6 MoE K kernels were not barrier-safe. |
| `dcd0a7607`, `32b318aab` | 2026-08-12 | Q6_K noshuffle kernel was being selected for large even-vocab M where it is wrong. |
| `dc3870579` | 2026-08-21 | q6_K flat workaround had to be guarded by GPU family. |

### 6.4 The one thing that IS a memory-topology fact for the S23

`ggml_backend_opencl_device_get_memory` at `ggml-opencl.cpp:14114-14123` (`HEAD`) is the only
place the backend reasons about memory capacity, and its own comment concedes the limitation:

```
static const size_t opencl_extra_margin = 1024ull*1024ull*1024ull;

// OpenCL does not provide reliable currently-free device memory.
// Use total/global memory as a best-effort upper bound.
// Improved safety: Reduce by a 1GiB extra margin for common --fit
*total = dev_ctx->global_mem_size;
*free  = *total > opencl_extra_margin ? *total - opencl_extra_margin : 0;
```

So the OpenCL device reports `memory_free = global_mem_size - 1 GiB` and `memory_total =
global_mem_size`, with no distinction between device and host memory anywhere. A shared-weights
design that needs the scheduler to know host-pinned capacity would have to extend this function,
and there is no precedent in the OpenCL backend for what to report.

`backend_ctx->max_alloc_size` is set from `CL_DEVICE_MAX_MEM_ALLOC_SIZE` at `:6802` and used to
clamp the split-K / large-operand bounds (`:6906-6909`).

---

## SECTION 7 - MAP of pins, attach points, and what we do not know

### 7.1 MAP: which commit is in which pin

```
8537d097c  <-- binding pin #1 (0a9b9379)
   |
4ccef2f85  <-- binding pin #2, THE CURRENT PIN (0288dc27, vendor/VERSIONS LLAMA_CPP_REF)
   |
2a290390d  <-- ships (ancestor of main)
   |
833cde99b  <-- engine main HEAD
   |
1068eb03d  <-- kalsa-gpu-opencl-v73 tip. IN NO PIN. Carries the V73 GPU lane + verdict work.
```

Everything in SECTION 2 marked `IN all` is inside `4ccef2f85` and therefore inside the shipped
app. Everything marked `OUT` needs an explicit decision: either it is branch-only experiment
(Mali probes, MLD, fault injection, the pre-merge GEMM-precision series) or it is *upstream
work that arrived after the pin* (`60081bb2b` FA bin kernel, `ec9281505` q6_K bin kernel,
`aa8b62105` CUDA host buffer types) or it is the newest lab GPU commit (`1068eb03d`).

Branch tips that are ancestors of main and therefore shipped: `opencl-moe-masks` =
`2361be359`. Branch tips that are not: `1068eb03d`.

### 7.2 Attach points for a shared-weights / host-pinned design - exact `file:line`

All of these are in `ggml/src/ggml-opencl/ggml-opencl.cpp`. Two column values given where
`HEAD` and `1068eb03d` differ.

| # | mechanism | `HEAD` (`833cde99b`) | `1068eb03d` | what it is now |
|---|---|---|---|---|
| A | `ggml_backend_opencl_device_buffer_from_ptr` | `:14177-14183` | `:14421` | **Pure stub**: `GGML_UNUSED` on all four args, `return nullptr;`. This is the function the ggml device interface calls to wrap an existing host pointer as a backend buffer. Implementing it is the most direct route to shared weights, and `CL_MEM_USE_HOST_PTR` (or a map/unmap of an `ALLOC_HOST_PTR` buffer) is what it would use. |
| B | `/* .buffer_from_host_ptr = */ false` | `:14140` | `:14384` | Device capability flag. Must become `true` or the scheduler will never ask for A. |
| C | `/* .host_buffer = */ false` | `:14139` | `:14383` | Device capability flag for a host buffer type. |
| D | `/* .get_host_buffer_type = */ NULL` | `:14213` | `:14457` | Never implemented (SECTION 4). A second, alternative route: return a buft whose `is_host` is set and whose `alloc_buffer` allocates `CL_MEM_ALLOC_HOST_PTR`. |
| E | `iface.is_host = NULL` | `:14096` | same | The hook ggml itself uses: `ggml_backend_buft_is_host()` in `ggml/src/ggml-backend.cpp:81-85` calls it, and `ggml_backend_buffer_is_host()` (`:183-184`) is what the scheduler branches on at `ggml-backend.cpp:495`, `:970`, `:1694`, `:2392`. A host-pinned OpenCL buft without this set will not be treated as host memory. |
| F | `ggml_backend_opencl_buffer_type_alloc_buffer` | `:13976` | `:14226` | The **single** buffer type for this backend (weights *and* graph compute share it - there is exactly one `ggml_backend_opencl_buffer_type_interface`, declared at `:14090`, and one `dev_ctx->buffer_type` built at `:14165-14174`). Its 4th fallback already allocates `CL_MEM_READ_WRITE \| CL_MEM_ALLOC_HOST_PTR` at `:14018` / `:14262` when the device pool is exhausted. |
| G | `ggml_cl_create_temp_upload_buffer` | `:10620-10663` | `:10865` | Existing precedent for "allocate in the host-pinned pool, fill it, hand the `cl_mem` to a kernel": `CL_MEM_READ_ONLY \| CL_MEM_ALLOC_HOST_PTR \| CL_MEM_HOST_WRITE_ONLY` at `:10639` / `:10884`, `clEnqueueMapBuffer(..., CL_MAP_WRITE_INVALIDATE_REGION, ...)`, `memcpy`, `clEnqueueUnmapMemObject`. 10 call sites in `ggml_backend_opencl_buffer_set_tensor` (`:10815`, `:11125`, `:11255`, `:11417`, `:11568`, `:11677`, `:11777`, `:11858`, `:12062`, `:12250`). **It frees the buffer** - reuse means changing ownership, not copying the helper. |
| H | `ggml_cl_create_temp_download_buffer` | `:10668` | `:10913` | Mirror of G with `CL_MEM_WRITE_ONLY \| CL_MEM_ALLOC_HOST_PTR \| CL_MEM_HOST_READ_ONLY` (`:10682` / `:10927`); 15 call sites. |
| I | the comment that would have to be answered | `:10604-10618` | `:10849-10863` | The unsourced "`CL_MEM_USE_HOST_PTR` is NOT zero-copy on Adreno" claim plus "per QCOM guidance". Any design touching host imports must deal with this text. |
| J | `adreno_has_large_buffer` / `cl_qcom_large_buffer` detection | `:6770` (set), used at `:14009` | `:6994`, used at `:14252` | Existing extension-gated allocation path; the pattern to copy for any new Adreno-specific property. |
| K | `ggml_backend_opencl_device_get_memory` | `:14114-14123` | `:14358` | Reports device memory only, `global_mem_size` minus a 1 GiB margin, with an explicit comment that free memory is unknowable. Extending it is mandatory if host-pinned capacity must be visible to `--fit`. |
| L | `get_adreno_gpu_gen` | `:285-321` | same | Family gate. `"740"`/`"750"` -> `A7X` at `:302`. Any host-memory path that is Adreno-generation dependent gates here. |
| M | `GGML_OPENCL_LOG_ALLOC` instrument | `ggml-opencl-kalsa-diag.cpp:79-99` | same | Already in the pins. The cheapest way to observe where a new allocation actually lands. |

Note the tension between these: **D/E require declaring a buffer as host memory, while I claims
the natural host-import mechanism does not deliver zero-copy on Adreno.** The honest reading is
that a design would use `CL_MEM_ALLOC_HOST_PTR` (a host-pinned pool owned by the driver, as in G
and F) rather than `CL_MEM_USE_HOST_PTR` (importing arbitrary pages) - which is precisely what
the existing fallback already does, only for a private copy rather than a shared one.

### 7.3 WHAT WE DO NOT KNOW

Grouped by which decision it blocks.

**Blocks the whole premise:**

1. **Whether `CL_MEM_USE_HOST_PTR` is or is not zero-copy on Adreno 740.** The claim in I is
   unsourced, written by a Qualcomm engineer about the X1-85, and never tested in any commit.
   No commit in either repo measures a transfer or a mapping. This is the single highest-value
   unknown and it is testable. [CITATION NEEDED: Qualcomm Adreno OpenCL driver behaviour for
   `CL_MEM_USE_HOST_PTR` on A7X]
2. **Whether the S23's Adreno 740 pool fragments the way the X1-85 does.** The entire retry
   machinery exists because of X1-85, a laptop part (`X1E`), with an observation on a 9B Q6_K
   tensor at 834 MB. Nothing in git records the Adreno 740 showing this behaviour. If the phone
   does not fragment, the motivation for a host-pinned weights path largely evaporates.
3. **The actual driver and compiler versions on the S23.** `E031.x.y.z` values are parsed at
   `:323+` and never written down. The lab has fixed four E031 miscompiles on this device
   (`c1bb48d32` and siblings) without ever committing the version string it was fixing around.
4. **Whether `CL_MEM_ALLOC_HOST_PTR` is genuinely the *same* physical memory the CPU reads.**
   OpenCL calls it host-pinned; on a unified-memory SoC that is *not* automatically the same as
   the weight pages the CPU already mapped from the GGUF. The comment in I asserts "true
   zero-copy" but nothing verifies it, and no commit measures a saving.

**Blocks the mechanism choice:**

5. **Why OpenCL never got `get_host_buffer_type` while CUDA did.** No commit explains it, and no
   issue or TODO is left in the tree. There may be a reason (the E031 compiler, the single
   buffer type design, or simply nobody wrote it) - and the reason changes whether implementing
   it is cheap or a trap.
6. **Whether the app can even exercise a new path.** The shipped app compiles one variant with
   OpenCL and does **not** define `GGML_OPENCL_USE_ADRENO_BIN_KERNELS` (SECTION 5.3); the
   binding globs the engine's `ggml-opencl/*.cpp` but ignores the engine's CMake options
   (SECTION 5.1). A new file is fine, a new CMake knob is not.
7. **Which engine commit a change would actually land on.** `4ccef2f85` is what the app pins;
   `1068eb03d` (the GPU lane, containing the verdict/kernel-set work) is pinned by nothing. Line
   numbers differ by ~250 in `ggml-opencl.cpp` between them.

**Blocks any performance claim:**

8. **Any GPU throughput number on this phone, at all.** No commit in either repo contains one
   (SECTION 6.1). Whatever baseline a zero-copy design would be compared against does not exist
   in git; it lives in benchmark reports outside these repositories and would have to be
   re-established.
9. **The cost of the host-pinned fallback that already exists.** The author's own comment says
   perf "degrades meaningfully" when `CL_MEM_ALLOC_HOST_PTR` backs a read/written buffer, but
   gives no factor. `GGML_OPENCL_LOG_ALLOC` would let us *detect* that the fallback fired; no
   commit records what it cost when it did.
10. **Whether a shared-weights design and the trans4 repack can coexist.** The backend repacks
    weights into trans4/noshuffle layouts in `set_tensor` (this is what the temp upload helper
    serves). A shared buffer implies a fixed layout, and `3dafb585f` records one Adreno family
    (850) where repack had to be turned off entirely. Nothing in git resolves the ordering
    between "share the GGUF pages" and "repack into a device-friendly layout".

**Not investigated in this pass (out of declared scope):**

11. `kalsa-moe-experiments` is a git repository but its GPU-related content was not searched as
    a commit history - only its patch directory was read. If it has its own OpenCL history, it
    is not covered here.
12. The `tmp/kalsallama-src` tree inside the binding (a second, older copy of the engine) was
    not analysed; the binding's live path is `vendor/llama.cpp`.

### 7.4 If one thing is reusable as-is

The existing **upload helper + single buffer type fallback** pair (attach points F, G, H) is the
only code in either repository that already allocates `cl_mem` objects in the Adreno host-pinned
pool and hands them to kernels. It is in all four pins, it is exercised by every quantized
weight upload, and it is already instrumented by `GGML_OPENCL_LOG_ALLOC`. A shared-weights design
would extend its ownership rule (stop releasing, start importing), not its allocation strategy -
and the two capabilities it needs to switch on, `buffer_from_host_ptr` and `is_host`, are both
sitting there as stubs the OpenCL backend has never filled in.

