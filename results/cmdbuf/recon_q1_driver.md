# CMDBUF recon Q1 — do Adreno drivers expose `cl_khr_command_buffer` or `cl_qcom_recordable_queues`?

Mandate: `mandates/cmdbuf-recon.md` question 1 only.

Question: do Adreno drivers expose `cl_khr_command_buffer` (or Qualcomm recordable-queue equivalents)? Specifically our 740 (`0676.73` / `E031.41`) and 750 (`0762.36` / `E031.45`)?

Search date: 2026-08-13. PC/web + this repo. No device, no GEMV kernel work, no PLAN.md edits.

## Verdict (yes / no / unknown)

| Device (our campaign) | `cl_khr_command_buffer` | `cl_khr_command_buffer_mutable_dispatch` | `cl_qcom_recordable_queues` |
|---|---|---|---|
| Adreno **740**, driver `0676.73`, compiler `E031.41.03.62` | **NO** | **NO** | **YES** |
| Adreno **750**, driver `0762.36.1`, compiler `E031.45.02.25` | **NO** | **NO** | **YES** |

Caveats on the YES column (not hidden):

- **750 recordable = YES on the compiler family, not a verbatim dump of build `0762.36.1`.** Closest public clinfo is Adreno 750 / `Compiler E031.45.02.06` (same E031.45 line, older micro). Qualcomm IWOCL 2026 (May 2026, after that dump and after our campaign drivers) still lists the vendor extension as **shipping**.
- **740 recordable = YES by sandwich + Qualcomm "shipping", not a verbatim `0676.73` extension string.** No public clinfo of Adreno 740 / `0676.73` was found (queries listed at the end). Every adjacent Adreno dump (730 / E031.38, 732 / E031.45.02.09, 750 / E031.45.02.06, 830 / E031.47) advertises `cl_qcom_recordable_queues` and none advertise `cl_khr_command_buffer`.
- **KHR command-buffer = NO on both, including our exact ICDs, because Qualcomm themselves say it is not available on Adreno** (IWOCL 2026, May 2026). That is stronger than a missing dump.

The actual extension string in every clinfo is **`cl_qcom_recordable_queues`** (plural). One Qualcomm slide writes `cl_qcom_recordable_queue` (singular). That is a slide typo; clinfo and MNN use the plural.

## What the two APIs are

`cl_khr_command_buffer` is the Khronos (still experimental / beta-header) record-once / replay-many extension. Ratified as an extension, last modified 2025-07-10, revision 0.9.8. It records via new entry points (`clCreateCommandBufferKHR`, `clCommandNDRangeKernelKHR`, `clFinalizeCommandBufferKHR`, `clEnqueueCommandBufferKHR`), not by wrapping a live `clEnqueueNDRangeKernel`. Mutable kernel args live in the layered extension `cl_khr_command_buffer_mutable_dispatch`.

- Spec / man page: https://registry.khronos.org/OpenCL/specs/unified/refpages/man/html/cl_khr_command_buffer.html
- Announcement of mutable-dispatch: https://www.khronos.org/blog/opencl-3.0.12-released-with-command-buffers-mutable-dispatch-extension-and-enhanced-layers-support
- Local generated header (Khronos headers, **not** an Adreno driver dump): `deps/opencl-android/OpenCL-Headers/CL/cl_ext.h:48-54` (`"cl_khr_command_buffer"`), `:622-628` (`"cl_khr_command_buffer_mutable_dispatch"`).

`cl_qcom_recordable_queues` is Qualcomm's **shipping vendor** equivalent, documented since IWOCL 2022. Flow: create a queue with `CL_QUEUE_RECORDABLE_QCOM` → `clNewRecordingQCOM` → ordinary `clEnqueueNDRangeKernel` while recording → `clEndRecordingQCOM` → replay with `clEnqueueRecordingQCOM`, which accepts an `cl_array_arg_qcom` array (arg / GWS / LWS updates). That last call is the vendor analog of mutable dispatch.

Official Adreno OpenCL SDK + programming guide (QPM login wall, not fetched as a PDF): https://qpm.qualcomm.com/#/main/tools/details/Adreno_OpenCL_SDK (cited by IWOCL 2026 slide 5).

## Qualcomm, in their own slides

### IWOCL 2026 (May 2026) — closest official statement to our phones

Wang, He, Gu, Qi, Xu, Bourd, *Advancing OpenCL-Based LLM Inference in Llama.cpp on Qualcomm Adreno GPUs*, IWOCL 2026, Heilbronn.

PDF: https://www.iwocl.org/wp-content/uploads/IWOCL-2026-Wang-Llamacpp.pdf

Slide 25 (PDF page 24), under "Recordable Command Queue/Buffers":

> `cl_qcom_recordable_queue` enables replay of per-layer launches with minimal CPU overhead
>
> `cl_khr_command_buffer` is expected to replace the vendor extension once it is available on Adreno
>
> Reduced CPU overhead and improved GPU utilization
>
> Up to ~10% performance uplift observed on selected large models (MoE models)

Slide 28 (PDF page 27) capability table, row "Pre-recorded cmd buffers": OpenCL = **partial**, closure path = "`cl_khr_command_buffer` adoption."

Slide 29 (PDF page 28) extension table (quoted in full for the two rows that matter):

| Extension | Status | Used by | Notes |
|---|---|---|---|
| `cl_qcom_recordable_queues` | shipping | Latency-critical loops | Pre-built command-stream replay |
| `cl_khr_command_buffer` | shipping | **Not available on Adreno** | Pre-recorded launches, low CPU overhead |

"shipping" on the KHR row means the **Khronos spec** is shipping. The "Used by" cell is the Adreno-driver fact: **not available**. Four years after the vendor extension shipped, Qualcomm still treat KHR command buffers as a future replacement, not a present ICD string.

They also say they already measured "~10%" on selected MoE models with the **vendor** path. That is Qualcomm's number, not ours.

### IWOCL 2022 (11 May 2022) — what the vendor API does

Calidas, *Machine Learning on Mobile with OpenCL*, IWOCL 2022. Hosted by Khronos:

https://www.khronos.org/developers/linkto/machine-learning-on-mobile-with-opencl

Slide 5:

> `cl_qcom_recordable_queues`
>
> Record a sequence of EnqueueNDRangeKernel commands
>
> Replay recording with optional updates to kernel arguments
>
> Significant improvements in dispatch latency and CPU power consumption for enqueue of Machine Learning models.
>
> Especially useful for streaming mode ML use cases.

Slide 6 lists `cl_khr_command_buffer` / `cl_khr_mutable_dispatch` as **upcoming Khronos** (provisional in 2022). IWOCL 2026 is the later status: vendor path shipping, KHR still not on Adreno.

Qualcomm engineers (Calidas, Kelly) are named contributors on the KHR spec. They designed the standard. They have not shipped it on Adreno.

## Public clinfo dumps (quoted extension strings)

None of these dumps contain `cl_khr_command_buffer` or `cl_khr_command_buffer_mutable_dispatch`. All of them contain `cl_qcom_recordable_queues` at version `0x400001 (1.0.1)`.

### Adreno 750 / E031.45.02.06 — closest public 750 to ours

Source: https://github.com/Oblomov/clinfo/issues/92#issuecomment-2629350597 (ahorek, 2025-02-02)

```
Device Name                                     QUALCOMM Adreno(TM) 750
Device Version                                  OpenCL 3.0 Adreno(TM) 750
Driver Version                                  OpenCL 3.0 QUALCOMM build: commit unknown Compiler E031.45.02.06
...
Device Extensions                               ... cl_qcom_protected_context cl_qcom_recordable_queues cl_qcom_reqd_sub_group_size cl_qcom_subgroup_shuffle ...
Device Extensions with Version                  ...
                                                  cl_qcom_recordable_queues                                        0x400001 (1.0.1)
```

Full KHR list on that dump: `cl_ext_image_from_buffer`, `cl_ext_image_requirements_info`, `cl_khr_3d_image_writes`, `cl_khr_byte_addressable_store`, `cl_khr_depth_images`, `cl_khr_egl_event`, `cl_khr_egl_image`, `cl_khr_extended_bit_ops`, `cl_khr_fp16`, `cl_khr_gl_sharing`, `cl_khr_global_int32_base_atomics`, `cl_khr_global_int32_extended_atomics`, `cl_khr_image2d_from_buffer`, `cl_khr_integer_dot_product`, `cl_khr_local_int32_base_atomics`, `cl_khr_local_int32_extended_atomics`, `cl_khr_mipmap_image`, `cl_khr_srgb_image_writes`, `cl_khr_subgroups`, `cl_khr_subgroup_ballot`. Then the `cl_qcom_*` block. **No `cl_khr_command_buffer*`.**

Our 750 unit (`results/gdn_gpu_750/driver_header.txt:10`): `OpenCL 3.0 QUALCOMM build: 0762.36.1 Compiler E031.45.02.25`. Same compiler family (E031.45), newer micro (`.02.25` vs `.02.06`). ggml-opencl never prints `CL_DEVICE_EXTENSIONS`, so this file cannot confirm the string locally.

A search-engine snippet of PrimeGrid host XML for the same user also indexes `QUALCOMM Adreno (TM) 750` + `0762.39` + `cl_qcom_recordable_queues` (https://www.primegrid.com/forum_user_posts.php?userid=105564). The first page of that thread did not contain the XML; treat as supporting, not as a quoted dump.

### Adreno 830 / 0800.56.1 / E031.47.18.42 — newer than 750, still no KHR cmdbuf

Source: https://github.com/ggml-org/whisper.cpp/issues/3708 (guranu, 2026-03-15)

```
Device Name                                     QUALCOMM Adreno(TM) 830
Driver Version                                  OpenCL 3.0 QUALCOMM build: 0800.56.1 Compiler E031.47.18.42
Device Extensions                               ... cl_qcom_protected_context cl_qcom_recordable_queues cl_qcom_subgroup_shuffle ... cl_qcom_local_memory_control
Device Extensions with Version                  ...
                                                  cl_qcom_recordable_queues                                        0x400001 (1.0.1)
```

This 830 dump has *more* KHR extensions than the 750 dump (`cl_khr_external_memory*`, `cl_khr_semaphore`, `cl_khr_subgroup_shuffle`, `cl_khr_subgroup_shuffle_relative`, …). Still **no** `cl_khr_command_buffer`. Recordable queues stay at 1.0.1.

### Adreno 732 / E031.45.02.09 — same compiler family as our 750

Source: https://github.com/termux-user-repository/tur/issues/1866#issuecomment-3138515728 (2025-07-31)

```
Device Name                                     QUALCOMM Adreno(TM) 732
Driver Version                                  OpenCL 3.0 QUALCOMM build: commit unknown Compiler E031.45.02.09
Device Extensions                               ... cl_qcom_recordable_queues cl_qcom_reqd_sub_group_size cl_qcom_subgroup_shuffle ...
                                                  cl_qcom_recordable_queues                                        0x400001 (1.0.1)
```

No `cl_khr_command_buffer`.

### Adreno 730 / E031.38.11.14 — older than our 740

Source: https://gist.github.com/woachk/9a0c542a946e4d2838564f104e0833d7 (2024-05-17)

```
Device Version OpenCL 3.0 Adreno(TM) 730
Driver Version OpenCL 3.0 QUALCOMM build: commit #dad4038ba6 ... Compiler E031.38.11.14
Device Extensions ... cl_qcom_protected_context cl_qcom_recordable_queues cl_qcom_reqd_sub_group_size cl_qcom_subgroup_shuffle cl_qcom_vector_image_ops
cl_qcom_recordable_queues 0x400001 (1.0.1)
```

No `cl_khr_command_buffer`. Compiler **E031.38** is older than our 740 **E031.41**. Recordable queues were already in the ICD then.

### Timeline (compiler, not marketing GPU name)

| GPU | Compiler | `cl_qcom_recordable_queues` | `cl_khr_command_buffer` | Source |
|---|---|---|---|---|
| 730 | E031.38.11.14 | yes 1.0.1 | **absent** | gist woachk |
| **740 (ours)** | **E031.41.03.62 / 0676.73** | **no verbatim dump** | **no verbatim dump** | this repo logs only |
| 732 | E031.45.02.09 | yes 1.0.1 | **absent** | tur#1866 |
| 750 public | E031.45.02.06 | yes 1.0.1 | **absent** | clinfo#92 |
| **750 (ours)** | **E031.45.02.25 / 0762.36.1** | **no verbatim dump** | **no verbatim dump** | this repo logs only |
| 830 | E031.47.18.42 / 0800.56.1 | yes 1.0.1 | **absent** | whisper.cpp#3708 |
| Adreno (Qualcomm, May 2026) | — | **shipping** | **not available on Adreno** | IWOCL 2026 slide 29 |

## This repo: what our 740 / 750 logs actually print

`ggml-opencl.cpp` **does** call `clGetDeviceInfo(..., CL_DEVICE_EXTENSIONS, ...)` but **does not log the string**. It only probes a handful of tokens.

```5874:5901:llama.cpp/ggml/src/ggml-opencl/ggml-opencl.cpp
    size_t ext_str_size;
    clGetDeviceInfo(device, CL_DEVICE_EXTENSIONS, 0, NULL, &ext_str_size);
    char *ext_buffer = (char *)alloca(ext_str_size + 1);
    clGetDeviceInfo(device, CL_DEVICE_EXTENSIONS, ext_str_size, ext_buffer, NULL);
    ext_buffer[ext_str_size] = '\0'; // ensure it is null terminated
    // ...
    backend_ctx->has_qcom_subgroup_shuffle = strstr(ext_buffer, "cl_qcom_subgroup_shuffle") != NULL;
    backend_ctx->has_subgroup_shuffle =
        strstr(ext_buffer, "cl_khr_subgroup_shuffle") != NULL ||
        backend_ctx->has_qcom_subgroup_shuffle;
    backend_ctx->has_integer_dot =
        strstr(ext_buffer, "cl_khr_integer_dot_product") != NULL;
```

Probed: `cl_qcom_subgroup_shuffle`, `cl_khr_fp16`, `cl_qcom_large_buffer`, `cl_khr_subgroup_shuffle`, `cl_khr_integer_dot_product`. **Not** probed: `cl_khr_command_buffer`, `cl_khr_command_buffer_mutable_dispatch`, `cl_qcom_recordable_queues`.

Printed init header (`ggml_opencl_print_backend_info`, `llama.cpp/ggml/src/ggml-opencl/ggml-opencl.cpp:5673-5710`) therefore cannot answer Q1 from a phone log.

### 740 (S23) — driver string we do have

`results/gdn_gpu_k2/s23/logs/support_gdn.txt:5-19` and `results/mld_m1/corr_mld_flat.txt:24,38`:

```
ggml_opencl: OpenCL driver: OpenCL 3.0 QUALCOMM build: 0676.73 Compiler E031.41.03.62
ggml_opencl: vector subgroup broadcast support: false
ggml_opencl: subgroup shuffle support: true
...
ggml_opencl: cl_qcom_subgroup_shuffle support: true
```

Same string in K2.2 / K4-split N3 / reports (`reports/moe-gdn-k2-e2e.md:56`, `reports/moe-mld-m1.md:4`).

So on **this exact ICD** the extension string contains `cl_qcom_subgroup_shuffle`. That is consistent with every public 7xx/8xx dump, all of which also contain `cl_qcom_recordable_queues`. It is **not** a local proof of recordable queues.

### 750 (Xiaomi 14 / houji) — driver string we do have

`results/gdn_gpu_750/driver_header.txt:10-24`:

```
ggml_opencl: OpenCL driver: OpenCL 3.0 QUALCOMM build: 0762.36.1 Compiler E031.45.02.25
ggml_opencl: vector subgroup broadcast support: false
...
ggml_opencl: cl_qcom_subgroup_shuffle support: true
```

Mandate shorthand `0762.36 / E031.45` is this unit: **`0762.36.1` / `E031.45.02.25`**. Same missing-broadcast class as 740 (`reports/moe-gdn-750.md:18,52`).

Ripgrep of `results/` for `CL_DEVICE_EXTENSIONS`, `cl_khr_command_buffer`, `cl_qcom_recordable` in `*.txt`/`*.md`/`*.log`: **no matches**. The only in-repo mention of `cl_qcom_recordable_queue` before this file is the IWOCL 2026 paraphrase in `reports/research-adreno-opencl.md:151`.

## Production users of the vendor API (not llama.cpp)

Alibaba MNN ships a full recordable-queue path. Detection (https://raw.githubusercontent.com/alibaba/MNN/master/source/backend/opencl/core/runtime/OpenCLRuntime.cpp):

```cpp
if((false == OpenCLSymbolsOperator::getOpenclSymbolsPtr()->isQcomError())
   && getDeviceSupportsExtension(*(mFirstGPUDevicePtr.get()), "cl_qcom_recordable_queues")){
    mSupportRecordQueue = true;
    uint32_t MaxRecordableQueueSize = mFirstGPUDevicePtr->getInfo<CL_DEVICE_RECORDABLE_QUEUE_MAX_SIZE>();
    ...
    mRecordableQueuePtr = std::make_shared<cl::CommandQueue>(*mContext, *mFirstGPUDevicePtr, CL_QUEUE_RECORDABLE_QCOM, &err);
}
```

Symbols loaded from `libOpenCL.so` (`OpenCLWrapper.cpp`): `clNewRecordingQCOM`, `clEndRecordingQCOM`, `clReleaseRecordingQCOM`, `clRetainRecordingQCOM`, `clEnqueueRecordingQCOM`, `clEnqueueRecordingSVMQCOM`.

Replay with mutable args (`OpenCLBackend.cpp` `enqeueRecord` / `clearRecord`):

```cpp
cl_int res = mOpenCLRuntime->commandQueue().EnqueueRecordingQCOM(
    mRecordings[i].record, update_kernel_args.size(), update_kernel_args.data(),
    0, nullptr,
    update_global_size.size(), update_global_size.data(),
    update_local_size.size(), update_local_size.data(),
    0, nullptr, nullptr);
```

MNN is not a 740/750 clinfo, but it is proof the vendor entry points exist as exported ICD symbols on shipping Adreno `libOpenCL.so`, and that a production ML runtime already uses them for the exact "record graph, update args, replay" job Q1 is asking about.

Secondary Chinese write-ups of the Adreno OpenCL SDK chapter "9.1.3 Recordable command queue (`cl_qcom_recordable_queues`)" name the same tokens (`CL_QUEUE_RECORDABLE_QCOM`, `clNewRecordingQCOM`, `clEndRecordingQCOM`, `clEnqueueRecordingQCOM`):

- https://blog.csdn.net/qq_35227495/article/details/134905376 (page fetch blocked from this host; title/snippets only)
- https://www.csdn.net/article/2022-09-23/127008367 (same)

## llama.cpp / this fork

`ggml-opencl` in this tree does **not** use either extension. Extension checks listed above. No `clCreateCommandBufferKHR`, no `CL_QUEUE_RECORDABLE_QCOM`.

Upstream (out of Q1 scope, recorded so Q1 does not over-claim): draft PR https://github.com/ggml-org/llama.cpp/pull/22764 implements ggml graph plans on `cl_khr_command_buffer` and was tested on **PoCL-CUDA and ROCm, not Adreno**. That matches Qualcomm's "not available on Adreno".

## Queries that returned nothing (or a wall)

These were run. Absence is evidence of a missing **verbatim 740 / 0762.36 dump**, not of a missing feature.

| Query | Result |
|---|---|
| `"Adreno(TM) 740"` + `cl_qcom_recordable_queues` / `cl_khr_command_buffer` + clinfo | no hit |
| `"OpenCL 3.0 Adreno(TM) 740"` + Device Extensions | no hit |
| `"0676.73"` + recordable / extensions / clinfo | only our own logs (driver string, no ext list) |
| `"0762.36"` + recordable / extensions / clinfo | only our own logs |
| `site:github.com` `"OpenCL 3.0 Adreno(TM) 740"` clinfo | empty |
| `site:gist.github.com` Adreno 740 clinfo | empty (730 gist exists; 740 does not) |
| Qualcomm support forum Adreno 750 `cl_khr_subgroup_shuffle` | https://mysupport.qualcomm.com/supportforums/s/question/0D5dK00000N2FaZSAV/is-clkhrsubgroupshuffle-supported-in-newer-driver-for-adreno-750 — fetch failed (login) |
| Adreno OpenCL SDK PDF from QPM | https://qpm.qualcomm.com/#/main/tools/details/Adreno_OpenCL_SDK — login wall |
| IWOCL 2025 Wang llama.cpp slides | PDF not published under an obvious `iwocl.org/wp-content` name; 2026 deck is the one that answers Q1 |
| ACM IWOCL 2022 paper PDF `10.1145/3529538.3530002` | paywall (`Just a moment...`); Calidas slides above cover the same talk |
| PrimeGrid user-posts page first 10 posts | no Adreno XML; search-engine snippet claims `0762.39` + `cl_qcom_recordable_queues` |
| `docs.qualcomm.com` "recordable" OpenCL | no public hit |
| Qualcomm developer blog 2024-11 llama.cpp OpenCL | https://www.qualcomm.com/developer/blog/2024/11/introducing-new-opn-cl-gpu-backend-llama-cpp-for-qualcomm-adreno-gpu — JS shell, no extension list in the crawl |
| This repo `results/gdn_gpu_k2`, `results/gdn_gpu_750`, `results/mld_m1` | driver version + `cl_qcom_subgroup_shuffle=true` only |

## Bottom line for the other Qs

- Do **not** plan a `cl_khr_command_buffer` / `cl_khr_command_buffer_mutable_dispatch` path on 740 or 750. Qualcomm, May 2026: not available on Adreno. Public dumps from 730 through 830 agree.
- The driver-side door that exists is **`cl_qcom_recordable_queues`**, with replay-time arg / NDRange updates (`clEnqueueRecordingQCOM`). That is the QCOM equivalent of "record the per-token stream once, mutate positions, replay."
- Our campaign ICDs never printed the extension string. A one-line `clinfo` (or a `GGML_LOG_INFO` of `ext_buffer`) on either phone would close the remaining dump gap. Until then the 740 YES is sandwich + Qualcomm "shipping"; the 750 YES is same-family clinfo + Qualcomm "shipping".
