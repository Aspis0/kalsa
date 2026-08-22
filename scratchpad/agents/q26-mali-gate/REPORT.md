# Queue #26 — Mali GPU door (Jelly Star, Mali-G57)

Status: **DONE**. **PLUGGED exploratory.** Absolute numbers are NOT comparable to unplugged/ship cells. Gate is correctness + order-of-magnitude, not ship speed. No ship claims.

Device: Jelly Star (Mali-G57 MC2, Helio G99 / mt6789, 8 GB) — wireless adb `192.168.1.82:35785` (product `Jelly_Star`, historical serial `JELLYS0000053795`). **PLUGGED / AC charging** the entire session (level 42→69, temp 33.0→38.0 °C). S23 (`SM_S911U`) and Xiaomi (`houji`) were attached on adb and **not touched**.
Work dir: `/data/local/tmp/kalsa26/{vk,ocl}`
Evidence: `results/mali_gate_jelly/raw/`
Engine: reused `build-android-vulkan-s15` (HEAD `c77fe1354` `kalsa/kernel-s3-repack` from the S15 report). OpenCL one-shot from `build-android-opencl-s3oracle`. **No edits** to either build tree or the engine fork.

Adreno 740 (S23, queue #15) signature: `createComputePipeline ErrorUnknown` → SIGABRT (rc 134) on every K-quant; dense f16 MUL_MAT 242/242 pass.
Mali-G57 this cell: **different**. Vulkan enumerates. `support` over-claims. Every `test` execute path SIGSEGV (rc 139) on first GPU buffer alloc (`vkGetBufferDeviceAddress` pfn = NULL). Never reaches shader compile / pipeline create.

## Pre-declaration

**PLUGGED.** Exploratory correctness + order-of-magnitude. Not a ship speed cell.

All device work via `adb -s 192.168.1.82:35785 shell`. Scripts LF-only (`run_vk.sh` od starts `23 21 … 0a`). No sleep >60s. `KEYCODE_WAKEUP` before each run.

## Step 0 — PC artifacts / device / space

| item | status | PLUGGED |
|---|---|---|
| Jelly serial | `192.168.1.82:35785` (mDNS `adb-JELLYS0000053795-UFuN1D`; `:39591` refused, `:35785` connected) | PLUGGED |
| `/data` free | ~120 G (`df -k /data` 125725696 1K-blocks avail) | PLUGGED |
| Vulkan tree `build-android-vulkan-s15/bin` | present: `test-backend-ops`, `llama-bench` + `.so`. `llama-cli` **absent** (never built in S15; not required) | — |
| OpenCL tree `build-android-opencl-s3oracle/bin` | present; used once | — |
| SHA256 PC == device | **yes** for every pushed binary (tables below) | PLUGGED |
| GGUF hashed on-device | not used (Phase 2 skipped). Models already on device, listed in `raw/on_device_ggufs.txt` | PLUGGED |

### Vulkan SHA256 (PC == device)

| file | sha256 | bytes |
|---|---|---:|
| `libggml-vulkan.so` | `5ff2db3d669c51beb9a6a6d0dab99bdcccbbbdceaa49fd4bcc3a4a4d86aaf297` | 47011288 |
| `libggml.so` | `367ccf39e5d7be6193331aa82cb1401582cd993e00f97217e9df1ff86e7331bc` | 537112 |
| `libggml-base.so` | `5b4685c9b4564907df918e1bf2cd71887c8ebfa8ad18cb2012f4f2f349f7c35d` | 6103488 |
| `libggml-cpu.so` | `652e311c73597ee7cd74b0dbeef446567b337c07d25a5f05c942f8e2e86d8a3c` | 5165048 |
| `libllama.so` | `a14dba6f891864ebc20c4eebe99a9f33131f73293dc52f0c40bea01f97e4123f` | 39807616 |
| `libllama-common.so` | `66e68b1bc372860d1d93db298292a6c3395efcf9afaa546669ac9818c6b13212` | 78377224 |
| `test-backend-ops` | `c24b311132021a968ab0669a60ed60dc3604ca47166d89e778f6ad77726c6178` | 10182432 |
| `llama-bench` | `b4e9476ee03f270c85d0e9eb2dd578089756075d131dd058456bb039182c7b21` | 7592 |
| `libllama-bench-impl.so` | `36b90cd131a2613d70f263f34a3721ffcdc86b6c9bbb5c9b5e103c9b0088fd35` | 4253152 |
| `libc++_shared.so` | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` | 1794776 |
| `libomp.so` | `ea27efff687f8359fabc728af9a4ea45766714399792344af94b09037d52d0b0` | 1229304 |

Pins match S15 `results/vulkan_vs_opencl_s23/MANIFEST.md` (`libggml-vulkan.so` `5ff2db3d…`, `test-backend-ops` `c24b3111…`).

### OpenCL SHA256 (PC == device)

| file | sha256 | bytes |
|---|---|---:|
| `libggml-opencl.so` | `0154b01db52b48bc7d75da55e9949ac13131972c97fbfc78158e5c489f116083` | 8376320 |
| `libggml.so` | `3f07bb31e79da8698635286a1a39dd2f21836e32dff9bdf578a1cce01351fb27` | 536880 |
| `libggml-base.so` | `8aa74499f1fea39bfbcb32f729f7904a2b1b98622af2c628f4a6cc017238ba59` | 6103496 |
| `libggml-cpu.so` | `fd9cb4b1f49c60a64eea964a4c19200c2878b74df450bc287cbbe6fdf8dcb0da` | 5165056 |
| `libllama.so` | `f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d` | 39807624 |
| `libllama-common.so` | `5370b18b8354aa45af1b8bdf7dc67a98c17768bfb8d89c5d3bab8cd41161e270` | 78377240 |
| `test-backend-ops` | `9a3fd4b07dd2edce2723ce2d17503f76d2b6bea0d254d616e3de199456b587bc` | 10182432 |
| `libc++_shared.so` / `libomp.so` | same NDK hashes as Vulkan | 1794776 / 1229304 |

## Phase 1 — does Vulkan even stand up on Mali-G57?

### 1.0 Backend name

`--help` does **not** list backends (rc 1, usage only). Invalid `-b NOSUCHBACKEND` enumerates:

```text
ggml_vulkan: Found 1 Vulkan devices:
ggml_vulkan: 0 = Mali-G57 MC2 (Mali-G57 MC2) | uma: 1 | fp16: 1 | bf16: 0 | warp size: 16 | shared memory: 32768 | int dot: 0 | matrix cores: none
Backend 1/2: Vulkan0
Backend 2/2: CPU
```

Exact name: **`Vulkan0`** (not `Vulkan`). Same lesson as GPUOpenCL vs OpenCL. Subsequent runs used `-b Vulkan0`.

Driver blob: `/vendor/lib64/hw/vulkan.mali.so -> mt6789/vulkan.mali.so`. `ro.hardware.vulkan=mali`. GLES 3.2 (`ro.opengles.version=196610`).

vs Adreno 740: warp 16 vs 64; otherwise same print shape (uma, fp16, no int-dot, no matrix cores, 32 KiB shmem).

### 1.1 Vulkan `test-backend-ops` MUL_MAT

**PLUGGED.** AC powered, awake.

| run | cmd | rc | result | PLUGGED |
|---|---|---:|---|---|
| `mm_support` | `support -b Vulkan0 -o MUL_MAT` | 0 | init OK. Device `Mali-G57 MC2`, 7777 MB. 1134 SUPPORTED / 331 NOT. q2_K 11/11, q3_K 11/11, q4_K 44 SUP / 34 NOT, f16 242 SUP / 28 NOT, f32 235 SUP / 28 NOT | PLUGGED |
| `mm_f16` | `test -b Vulkan0 -o MUL_MAT -p type_a=f16` | **139** | init OK, then SIGSEGV. **zero test lines**. ~13 s (AEE dump) | PLUGGED |
| `mm_f32` | `test -b Vulkan0 -o MUL_MAT -p type_a=f32` | **139** | same | PLUGGED |
| `mm_q4k` | `test -b Vulkan0 -o MUL_MAT -p type_a=q4_K` | **139** | same. **not** Adreno SIGABRT / `createComputePipeline ErrorUnknown` | PLUGGED |
| `mm_q2k` | `test -b Vulkan0 -o MUL_MAT -p type_a=q2_K` | **139** | same | PLUGGED |

Full unfiltered `test -o MUL_MAT` was not left to run: the first `test_case::eval` already dies on buffer alloc, so the suite cannot produce pass/fail counts.

Logs: `raw/vk_mm_support.{out,err}`, `raw/vk_mm_f16.{out,err}`, `raw/vk_mm_f32.*`, `raw/vk_mm_q4k.*`, `raw/vk_mm_q2k.*`, `raw/logcat_crashbuf.txt`.

### 1.2 Vulkan `test-backend-ops` MUL_MAT_ID (MoE)

**PLUGGED.**

| run | cmd | rc | result | PLUGGED |
|---|---|---:|---|---|
| `mmid_support` | `support -b Vulkan0 -o MUL_MAT_ID` | 0 | **808/808 SUPPORTED**, 0 NOT. q2_K 5/5, q3_K 5/5, q4_K 82/82, f16 80/80 | PLUGGED |
| `mmid_f16` | `test -b Vulkan0 -o MUL_MAT_ID -p type_a=f16` | **139** | SIGSEGV, zero test lines | PLUGGED |
| `mmid_q4k` | `test -b Vulkan0 -o MUL_MAT_ID -p type_a=q4_K` | **139** | same | PLUGGED |

`supports_op` over-claims on Mali the same way it did on Adreno 740. The execute failure mode is **not** the same.

Logs: `raw/vk_mmid_support.{out,err}`, `raw/vk_mmid_f16.*`, `raw/vk_mmid_q4k.*`, `raw/logcat_crashbuf_battery.txt`.

### Crash (all execute runs)

logcat crash buffer (`raw/logcat_crashbuf.txt`):

```text
Fatal signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0
Cause: null pointer dereference
Cmdline: ./test-backend-ops test -b Vulkan0 -o MUL_MAT -p type_a=f16
pc 0000000000000000
#01 pc 0000000001f62e18  libggml-vulkan.so
#02 pc 0000000001f61ad0  libggml-vulkan.so
#03 pc 0000000001f61824  libggml-vulkan.so
#04 pc 0000000000052290  libggml-base.so
```

llvm-symbolizer on the S15 `.so` (`raw/symbolize_mm_f16.txt`):

```text
vk::Device::getBufferAddress<vk::DispatchLoaderDynamic>(...)
  vulkan_funcs.hpp:6563
  inlined from ggml_vk_create_buffer  ggml-vulkan.cpp:3233
ggml_vk_create_buffer_device                  ggml-vulkan.cpp:3260
ggml_backend_vk_buffer_type_alloc_buffer      ggml-vulkan.cpp:15314
alloc_tensor_range                            ggml-alloc.c:1131
test_case::eval                               test-backend-ops.cpp:1401
```

Site:

```cpp
// ggml-vulkan.cpp:3231
if (device->buffer_device_address) {
    const vk::BufferDeviceAddressInfo addressInfo(buf->buffer);
    buf->bda_addr = device->device.getBufferAddress(addressInfo);  // d.vkGetBufferDeviceAddress == NULL
}
```

`device->buffer_device_address` is set from `vk12_features.bufferDeviceAddress` after `vkGetPhysicalDeviceFeatures2` (`ggml-vulkan.cpp:6209`). The dynamic dispatcher’s `vkGetBufferDeviceAddress` is a null function pointer, so the call is `pc=0`. There is **no** `GGML_VK_DISABLE_*` env for BDA. `GGML_VK_PREFER_HOST_MEMORY` still goes through `ggml_vk_create_buffer` and would hit the same line.

This is **not** the Adreno 740 K-quant pipeline-create abort. Mali dies earlier, on **every** execute type including f16/f32, before a single op is dispatched.

### vs Adreno 740 (queue #15)

| item | Adreno 740 (S23) | Mali-G57 MC2 (Jelly) | PLUGGED |
|---|---|---|---|
| Enumerates | yes | yes | PLUGGED |
| `support` MUL_MAT / MUL_MAT_ID | over-claims K-quants | over-claims K-quants (and f16) | PLUGGED |
| f16 MUL_MAT execute | **242/242 pass** | **SIGSEGV 139**, 0 tests | PLUGGED |
| q4_K / q2_K execute | SIGABRT 134, `createComputePipeline ErrorUnknown` | SIGSEGV 139, BDA pfn NULL (never reaches pipeline create) | PLUGGED |
| llama-bench ngl 99 | abort on q4_K GEMV pipeline | not run (Phase 2 gated off) | PLUGGED |

### 1.3 OpenCL one-shot MUL_MAT (expected dead)

**PLUGGED.** Do not insist. Binary from `build-android-opencl-s3oracle`.

First attempt without `libllama.so` / `libllama-common.so`: `CANNOT LINK EXECUTABLE` (recorded `raw/ocl_badbackend.err`). Relinked with those two libs (hashes match PC) and retried.

| run | cmd | rc | outcome | PLUGGED |
|---|---|---:|---|---|
| `badbackend2` | `-b NOSUCHBACKEND` | 0 | platform `ARM Platform`; device `Mali-G57 MC2 r0p1 (OpenCL 3.0 v1.r32p1-01eac0.…)` then **`unsupported GPU` + `drop unsupported device`**. Only backend left: CPU | PLUGGED |
| `mm_f16` | `test -o MUL_MAT -p type_a=f16` | 0 | GPU backend never registered. `Testing 1 devices` / `Skipping CPU backend`. No GPU execute | PLUGGED |
| `named_gpuopencl` | `test -b GPUOpenCL -o MUL_MAT -p type_a=f16` | 0 | same drop; CPU skipped (name filter) | PLUGGED |
| `named_opencl` | `test -b OpenCL -o MUL_MAT -p type_a=f16` | 0 | same | PLUGGED |

Drop path is `ggml_opencl_is_device_supported` (`ggml-opencl.cpp:5895–5910`): allowlist is Adreno/Qualcomm/Intel; Mali falls into `GPU_FAMILY::UNKNOWN` and returns false, then `drop unsupported device`. **`UNKNOWN_COMPILER` was not the branch taken** — that enum is the Adreno CL-compiler classifier (`ADRENO_CL_COMPILER_TYPE::UNKNOWN_COMPILER`). Outcome is still **dead, as expected**.

Logs: `raw/ocl_badbackend2.{out,err}`, `raw/ocl_mm_f16.{out,err}`, `raw/ocl_named_{gpuopencl,opencl}.*`.

## Phase 2 — order-of-magnitude prefill

**SKIP.** Phase 1 has no live GPU execute path (f16, f32, q4_K, q2_K, MUL_MAT_ID f16/q4_K all SIGSEGV 139). llama-bench ngl 99 would hit the same `ggml_vk_create_buffer` BDA call.

Models already on device (not hashed, not used):

| path | bytes |
|---|---:|
| `/data/local/tmp/llamabench/Qwen3.5-2B-Q4_K_M.gguf` | 1280835840 |
| `/data/local/tmp/llamabench/Qwen3.5-2B-Q4_0.gguf` | 1214873856 |
| `/data/local/tmp/llamabench/LFM2.5-1.2B-Instruct-Q4_K_M.gguf` | 730895168 |
| `/data/local/tmp/LFM2.5-8B-A1B-Q4_K_M.gguf` | 5155564768 |
| `/data/local/tmp/Marco-Mini-Instruct.i1-Q4_K_M.gguf` | 10505424704 |
| plus LFM 2.6B Q4_K_M / QAD-Q4_0, Qwen3.5-4B Q4_K_M | see `raw/on_device_ggufs.txt` |

No PC push of Qwen3.5-2B (already present). No f16 GGUF found on device; even if one existed, Phase 1 f16 execute is dead.

| cell | ngl | pp | t/s | batt% | temp | AC | notes |
|---|---:|---:|---|---:|---:|---|---|
| GPU Vulkan | 99 | 128 | — | — | — | **PLUGGED** | SKIP: execute-dead |
| CPU same build | 0 | 128 | — | — | — | **PLUGGED** | SKIP: gated off with GPU |
| GPU Vulkan | 99 | 512 | — | — | — | **PLUGGED** | SKIP |
| CPU same build | 0 | 512 | — | — | — | **PLUGGED** | SKIP |

| metric | value | PLUGGED |
|---|---|---|
| pp128 GPU/CPU | **not estimable** | PLUGGED |
| pp512 GPU/CPU | **not estimable** | PLUGGED |
| gate read | **dead** (enumerate-alive, execute-dead). Not alive-and-close, not alive-but-garbage | PLUGGED |

Paper context (generic kernels <3% ALU on Mali; G57 MP2 is small) is **not testable on this stack yet**. We never dispatched a matmul. The honest gap is not “slow kernels”; it is “first `vkGetBufferDeviceAddress` is a null pfn”.

## Verdict

**No technical door for GPU prefill on this Mali with the current binaries.**

| item | verdict | PLUGGED |
|---|---|---|
| Vulkan enumerates Mali-G57 MC2 | **yes** (`Vulkan0`, fp16, warp 16, no matrix cores) | PLUGGED |
| `support` MUL_MAT / MUL_MAT_ID | yes, over-claims | PLUGGED |
| any GPU execute (f16/f32/K-quant/MoE) | **SIGSEGV 139** on BDA | PLUGGED |
| vs Adreno 740 K-quant SIGABRT | **different** (earlier, broader, different API) | PLUGGED |
| OpenCL | device seen, **dropped** (`GPU_FAMILY::UNKNOWN`) | PLUGGED |
| GPU/CPU prefill ratio | **not estimable** | PLUGGED |
| ship | **no** | PLUGGED |

A **code** door exists and is out of this cell’s scope: ggml-vulkan must not set `buffer_device_address` (or must not call `getBufferAddress`) unless `vkGetBufferDeviceAddress` is a real pfn, and/or must enable/load BDA correctly on Vulkan 1.1 Mali. Until that is fixed and re-run, Mali stays execute-dead. Do not treat this as a kernel-quality or ALU-utilization result.

## Disconnects

Reconnect attempts: **0 / 3**. Device stayed up for the session (`transport_id:281` unchanged). Other adb devices left idle.
