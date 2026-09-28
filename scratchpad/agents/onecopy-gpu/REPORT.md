# One weight copy for CPU + NPU + GPU: Adreno reads the raw Q4_0 bytes (spike, phase 1)

Engine worktree `/Users/marco/Projects/kalsallama-onecopy-gpu`, branch `spike/onecopy-gpu-rawq4`
from `c939a135d` (tip of `spike/hexagon-onecopy-rawq4`). Commit: `133cef802`; review fixes in
`5e6b66e86` (rebuild below, §5). Not pushed.
No adb, no phone. Everything below is source, docs, a Mac GPU run and an Android build.
`orig:` = line numbers in `/Users/marco/Projects/kalsallama-onecopy` (unchanged tree);
`new:` = line numbers in the `-gpu` worktree.

## Verdict

**Feasible in design, one dma-buf, no second weight copy. Unproven on a phone.** The mechanism is
`cl_qcom_ion_host_ptr` (fallback Khronos `cl_khr_external_memory_dma_buf`) importing the
Hexagon `-HOST` rpcmem dma-buf, read by a plain-layout Q4_0 kernel. Whether the S23's driver
accepts a dma-heap fd on that path, and what the raw layout costs in speed, is exactly what the
S23 runs at the end decide. What is built: the import registry, the raw GEMM kernel (verified
against a CPU reference on the Mac's GPU), the scheduler/backend wiring, a standalone probe,
and Android artifacts. Plain `CL_MEM_USE_HOST_PTR` is **not** a mechanism: the backend's own
comment says the Adreno driver copies (`orig:10938`).

## 1. What ggml-opencl already has (orig)

**(a) A plain-layout Q4_0 kernel: yes, but compiled out of the dispatch.**

- `kernels/mul_mv_q4_0_f32.cl` (kernel `kernel_mul_mat_q4_0_f32`) and
  `kernels/mul_mv_q4_0_f32_v.cl:232` (`kernel_mul_mat_q4_0_f32_v`, the Adreno variant: 64-wide
  subgroup via `qcom_reqd_sub_group_size("half")`, 4 rows per subgroup, `struct block_q4_0 {half d;
  uint8_t qs[16];}` read at `:44-48`, `x = src0 + first_row*nb`, `:130`). Both are **always built**:
  `ggml-opencl.cpp:2062` and `:2079`.
- Their dispatch is the `#else // GGML_OPENCL_SOA_Q` arm of the Q4_0 case,
  `ggml-opencl.cpp:25435-25471` (Adreno: `_v`, `nth0 = 64`, `ndst = 4`, args `src0, offset0`
  `:25456-25457`). `GGML_OPENCL_SOA_Q` is defined unconditionally,
  `ggml/src/ggml-opencl/CMakeLists.txt:20`. There is **no runtime option** to turn the conversion
  off. `GGML_OPENCL_HOST_REPACK` (`:10638`, `:11243`) is an oracle/diagnostic probe, not a layout
  switch.
- Prefill: the SoA build has no plain-layout GEMM. `mul_mm_q4_0_f32_l4_lm.cl` reads separate `src0_q`
  and `src0_d` arrays (`:13-14`, `:86-88`), used at `ggml-opencl.cpp:24642`. Plain Q4_0 also
  exists on device for the quantised KV cache (dequant-to-f16 route `:23949-23971`,
  `flash_attn_f32_q4_0.cl`), so plain blocks in an OpenCL buffer are already a supported thing;
  only weights are converted.
- The conversion: `set_tensor` Q4_0 `:11133-11175` splits the tensor's own `cl_mem` into scale and
  quant sub-buffers via a convert kernel; views and non-contiguous tensors stay AoS
  (`:11134-11138`, "direct-aos"). `get_alloc_size` even reserves carve slack for it
  (`:14465-14492`).

**(b) Buffers.**

- One `clCreateBuffer(ctx, CL_MEM_READ_WRITE, size, NULL)` per ggml buffer, `alloc_buffer`
  `:14381-14443` (`:14394`), retries `:14408`, `cl_qcom_large_buffer` `:14417-14418`, last resort
  `CL_MEM_ALLOC_HOST_PTR` `:14422`. Tensors are `(cl_mem, byte offset)`: `get_base` returns the
  device alignment as a fake pointer (`:10549-10552`), `init_tensor` stores
  `extra->offset = data - base` and `extra->data_device` (`:10554-10593`).
- **A buffer over existing host memory: not today.** `buffer_from_host_ptr` returns `nullptr`
  (`:14581-14587`), `caps.buffer_from_host_ptr = false` (`:14544`), `.is_host = NULL` (`:14500`),
  `.get_host_buffer_type = NULL` (`:14617`), `supports_buft` accepts only OpenCL bufts
  (`:14594-14598`), and `.offload_op = NULL` (`:14621`).
- Two limits that shape the design: `CL_DEVICE_MAX_MEM_ALLOC_SIZE` is **884 MB on the S23**
  (Adreno 740; log `results/barrier_verify_s23/mmid_m96.err`, "max mem alloc size: 884 MB"), while
  the Hexagon `-HOST` buffer type allows 1 GiB (`opt_mbuf`, `ggml-hexagon.cpp:93`, env
  `GGML_HEXAGON_MBUF`). And the scheduler only offers a **host** weight to a device whose
  `offload_op` says yes; otherwise the op runs on the CPU (`ggml-backend.cpp:961-987`).

## 2. Zero-copy mechanisms on Adreno

| mechanism | verdict | evidence |
|---|---|---|
| `CL_MEM_USE_HOST_PTR` (plain) | **No.** The driver makes an internal copy. | backend comment `orig:10938-10945` (repo claim, not measured here); the Qualcomm extension exists to make USE_HOST_PTR usable: `CL_MEM_EXT_HOST_PTR_QCOM` "is valid only when used together with CL_MEM_USE_HOST_PTR" |
| `cl_qcom_ext_host_ptr` + `cl_qcom_ion_host_ptr` | **Chosen (primary).** `clCreateBuffer(CL_MEM_USE_HOST_PTR | CL_MEM_EXT_HOST_PTR_QCOM, size, &{allocation_type = CL_MEM_ION_HOST_PTR_QCOM, host_cache_policy, ion_filedesc, ion_hostptr})`. Rules: memory page-aligned (`CL_DEVICE_PAGE_SIZE_QCOM`), allocation padded at the end by `CL_DEVICE_EXT_MEM_PADDING_IN_BYTES_QCOM`; cached allocation may use `WRITEBACK` or `IOCOHERENT`, else `UNCACHED`. | https://registry.khronos.org/OpenCL/extensions/qcom/cl_qcom_ext_host_ptr.txt , https://registry.khronos.org/OpenCL/extensions/qcom/cl_qcom_ion_host_ptr.txt , https://registry.khronos.org/OpenCL/extensions/qcom/cl_qcom_ext_host_ptr_iocoherent.txt ("imported allocation is mapped as io-coherent for the GPU", "avoids the need for the OpenCL driver to explicitly issue CPU cache operation calls", must be a cached allocation, "GPU performance can be slower in some cases") |
| `cl_qcom_dmabuf_host_ptr` | Exists (named by TVM PR #17519, same `SetNativePtr` family) but **no public header or spec** found: struct and constant unknown, so not guessed. On kernels without ION the "ion fd" is a dma-buf fd, which is why the ION route is expected to work. | https://www.mail-archive.com/commits@tvm.apache.org/msg110621.html ; searched Khronos registry, `cl_ext.h` (Khronos and two Qualcomm SDK header copies): no `DMABUF_HOST_PTR` |
| `cl_qcom_android_ahardwarebuffer_host_ptr` / `..._native_buffer_host_ptr` | Not applicable: needs a gralloc `AHardwareBuffer`, not the rpcmem fd the DSP maps. | Khronos `cl_qcom_android_native_buffer_host_ptr.txt` |
| `cl_khr_external_memory` + `cl_khr_external_memory_dma_buf` | **Chosen (fallback, standard).** `clCreateBufferWithProperties({CL_EXTERNAL_MEMORY_HANDLE_DMA_BUF_KHR = 0x2067, fd, CL_MEM_DEVICE_HANDLE_LIST_KHR = 0x2051, dev, 0}, 0)` then `clEnqueueAcquireExternalMemObjectsKHR` before use. | Khronos `cl_ext.h` (`1958-1965`, `1900`), https://registry.khronos.org/OpenCL/specs/unified/refpages/man/html/cl_khr_external_memory.html. The 8 Elite dump lists `cl_khr_external_memory*` (`results/cmdbuf/recon_q1_driver.md:125`); the 750 dump does not |
| SVM | **No.** `clSVMAlloc` allocates its own memory; it cannot wrap an existing dma-buf, and nothing gives the DSP an fd for SVM memory. | S23 (Adreno 740): coarse-grain buffer true, fine-grain buffer true, fine-grain system false (`results/barrier_verify_s23/mmid_m96.err`, printed by `orig:6875-6880`) |

**What the devices expose: not known from the lab.** No lab log ever printed
`CL_DEVICE_EXTENSIONS` (ggml-opencl does not, `results/cmdbuf/recon_q1_driver.md`), and the only
public dumps (750: `cl_qcom_recordable_queues`, `cl_qcom_subgroup_shuffle`, ...; 830: adds
`cl_khr_external_memory*`) elide the host-ptr entries. The new probe prints the full list
(`EXT` lines), `CL_DEVICE_EXT_MEM_PADDING_IN_BYTES_QCOM`, `CL_DEVICE_PAGE_SIZE_QCOM`, and tries
every import route. **S23 = Adreno 740; 8 Elite = Adreno 830: both unverified for host-ptr
extensions.**

## 3. Design: one buffer, three readers

```
GGUF read()/memcpy ──> rpcmem system heap, CACHED  (Hexagon `-HOST` buffer, orig:547-556, 2075)
                          │  one dma-buf fd, page-aligned base, +4 KiB guard page (orig:633-643)
        CPU  ─ plain loads on the CPU mapping (generic Q4_0 kernel, no repack)
        HTP  ─ fastrpc_mmap(fd); DSP converts 32-row groups to tiles in VTCM (raw path, lab REPORT)
        GPU  ─ ONE cl_mem imported from the same fd; raw Q4_0 kernels read (cl_mem, byte offset)
```

**Why one buffer works.** Every OpenCL kernel takes `(cl_mem, byte offset)`. A tensor inside the
imported buffer is `(imported cl_mem, data - base)`. Nothing is converted, so the bytes are the
GGUF bytes, and all three readers read them.

**The smallest change (built):**

1. `ggml/src/ggml-dmabuf-export.h` (22 lines): a tiny contract, `GGML_DMABUF_EXPORT_PROC`
   returning `{fd, base, size, capacity}` for a buffer.
2. Hexagon (`new:2055`, `:7153`): exports only `-HOST` buffers (normal buffers hold repacked
   tiles). No allocation change: the block already pads (`orig:633-643`).
3. OpenCL `ggml-opencl-rawq4.{h,cpp}` + `-import.cpp`: per-buffer import registry, gated by
   **`GGML_OPENCL_RAWQ4=1`** (off = byte-identical behaviour). `supports_buft` accepts an
   exporting buffer type (`new:14649`); `supports_op` accepts **only** a Q4_0 `MUL_MAT` on such
   a weight and declines every other op that touches one (they stay on the CPU, which reads the
   same bytes); `offload_op` opts the GPU in from `GGML_OPENCL_RAWQ4_MIN_BATCH` columns
   (default 1) (`new:14669`, needed because a host weight otherwise stays on the CPU,
   `ggml-backend.cpp:961-987`).
4. Kernels: prefill `kernels/mul_mm_q4_0_f32_l4_lm_raw.cl` (new, same tiling and dequant as
   `mul_mm_q4_0_f32_l4_lm.cl`, only the A loads read 18-byte blocks with `vload_half`/`vload4`);
   decode reuses the existing `kernel_mul_mat_q4_0_f32_v`. Dispatch `ggml_cl_mul_mat_q4_0_raw`
   (`new:24005`), threshold 32 columns.

**Import rules, all checked with a logged error rather than a silent fallback:**
buffer <= `CL_DEVICE_MAX_MEM_ALLOC_SIZE` (884 MB S23: run with `GGML_HEXAGON_MBUF=512`, the
1.3 GiB trunk becomes 3 buffers, 3 imports); base page-aligned; `capacity - size >=
CL_DEVICE_EXT_MEM_PADDING_IN_BYTES_QCOM` (the 4 KiB guard page covers a page-sized padding); a
freed-and-reallocated buffer at the same address is re-imported (identity = fd, base, size).

**Cache coherence: who flushes what.**

- Writers: the CPU only, once, at load (`read()` into the mapping, or `memcpy` in `set_tensor`,
  `orig:2017`), through a **cached** mapping (`rpcmem.h:50`: default flags = cached). Readers
  (CPU, HTP, GPU) never write a weight. That is what makes this tractable.
- GPU with `CL_MEM_HOST_IOCOHERENT_QCOM` (used when `cl_qcom_ext_host_ptr_iocoherent` is
  present): the GPU snoops, no maintenance (spec above). With `WRITEBACK`/Khronos import: the
  CPU's dirty lines must reach memory before the first GPU read: `DMA_BUF_IOCTL_SYNC`
  START|END (write) once after the last write and after import (`publish_cpu_writes`). Nobody
  ever invalidates: readers cannot make CPU lines stale.
- Same discipline the HTP path already needs; its own flush/invalidate runs at batch start/end
  (`htp/main.c:1134-1137`). The HOST-path CPU-write -> DSP-read region has not been proven
  either (`governor-onecopy/DESIGN.md` §1.3): the S23 runs pass through the same open question.
- Reloading weights in place is not supported (needs re-publish plus a GPU cache invalidate).

**If a single buffer cannot be shared with the GPU** (import refused by the driver): the
minimum is today's architecture, the GPU keeps its own SoA copy of the Q4_0 trunk (~1.3 GiB,
`governor-onecopy/DESIGN.md` §3), CPU+NPU still share. There is no cheaper GPU-only variant: the
GPU cannot read the HTP's normal buffer (repacked tiles) either.

**Performance cost of the raw layout: not measured; expectation from source.** The fast Adreno
kernels exist because of the SoA/noshuffle/image layout (`ggml-opencl.cpp:11133-11399`, the
`gemv/gemm_noshuffle_q4_0_f32.cl` family): scales and quants in separate planes read as
aligned 32-bit words, the quant plane also through a texture view. The raw layout has 18-byte
blocks (2-byte alignment): the decode kernel does 16-bit loads (`mul_mv_q4_0_f32_v.cl:62-82`) and
the prefill kernel byte loads, both on a plain buffer with no texture path. Expect **both raw
kernels slower than the SoA ones**; by how much is what the probe (GB/s of the raw kernels vs a
raw read sweep) and the G0/G1 arms (wall time per prompt) measure. No number is claimed here.
In its favour: KV, activations and the rest stay on the normal GPU path, and f32 accumulation
throughout avoids the half-product divergence documented for the noshuffle GEMM
(`archive-gpu-docs/REPORT.md:754`).

## 4. Built and tested on the host

| item | where | lines |
|---|---|---|
| export contract | `ggml/src/ggml-dmabuf-export.h` | 22 |
| Hexagon export | `ggml-hexagon.cpp` (`+17`) | |
| registry / policy | `ggml-opencl-rawq4.{h,cpp}` | 55 + 90 |
| import mechanics (ion, Khronos, rules, sync) | `ggml-opencl-rawq4-import.cpp` | 190 |
| raw GEMM | `kernels/mul_mm_q4_0_f32_l4_lm_raw.cl` | 170 |
| wiring | `ggml-opencl.cpp` (kernel load, supports_buft/op, offload_op, dispatch) | ~150 |
| probe + kernel check | `tests/opencl-q4_0-raw/{probe,q4raw,dmabuf}.{c,h}` | 188 + 214 + 96 (+ headers) |

**Mac GPU check** (Apple M1 Max, OpenCL 1.2; `raw/evidence.tar.gz:host_mac_probe.log`): raw GEMM vs a CPU double
reference (own dequantiser identical to `dequantize_row_q4_0`), random blocks, weights at byte
offsets 0/2/18/32/34/96 (block starts only 2-byte aligned for 2/18/34), shapes
K in {512, 2048, 6144}, M in {130, 200, 512, 2048, 6144, 10752}, N in {1, 33, 64, 70, 128}
(M and N deliberately not multiples of 64): **all PASS, max error 1.5e-6 .. 1.1e-5 of the RMS**
(fp32 accumulation). Not exercised on the Mac: the decode kernel `_v` (needs Adreno subgroup
extensions), any import, any timing (Apple's event timestamps are not meaningful:
the probe prints 7-15 TB/s).

## 5. Android build (`build-onecopy-v73*` not touched; logs are in `raw/evidence.tar.gz`, `.log`/`.txt` are gitignored here)

Same image and preset as the HTP builds: `ghcr.io/snapdragon-toolchain/arm64-android:v0.7`,
`arm64-android-snapdragon-release`, `BUILD_SHARED_LIBS=OFF`, new dir
`/Users/marco/Projects/kalsallama-onecopy-gpu/build-onecopy-gpu` (`build-onecopy-v73*` untouched).

```sh
docker run --rm --volume /Users/marco/Projects/kalsallama-onecopy-gpu:/workspace --workdir /workspace --platform linux/amd64 -u 501:20 ghcr.io/snapdragon-toolchain/arm64-android:v0.7 bash -c 'cmake --preset arm64-android-snapdragon-release -B /workspace/build-onecopy-gpu -DBUILD_SHARED_LIBS=OFF' > raw/configure.log 2>&1; echo $?
docker run ... bash -c 'cmake --build /workspace/build-onecopy-gpu --target llama-perplexity llama-eval-callback htp-v73 -j2' > raw/build_androidN.log 2>&1; echo $?
docker run ... bash -c '/opt/android-ndk-r29/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android34-clang -O2 -Wall -Wextra -o /workspace/build-onecopy-gpu/q4raw-probe tests/opencl-q4_0-raw/probe.c tests/opencl-q4_0-raw/q4raw.c tests/opencl-q4_0-raw/dmabuf.c -lOpenCL -ldl -lm'
```

Configure `0`. Build: attempts 1-3 (`-j2`) died on the known silent `embed_kernel.py` flake
(`raw/evidence.tar.gz`: `build_attempts.txt`, `build_android1-3.log`), attempt 4 `0` but built **before** my last
edits (registry split, Khronos import, const kernel pointer), so it was redone: attempt 5
linked `llama-perplexity` and had `llama-eval-callback` **OOM-killed** in the LTO link
(`clang++: error: unable to execute command: Killed`, `build_android5.log`), attempt 6 `0`.
The wrapper's exit status is the docker command's; the first background wrapper masked it with a
trailing `cat`, which is why attempt 1's "exit 0" notification was wrong (its log shows `FAILED`).
All 7 warnings are in pre-existing lines (`ggml-opencl.cpp:1541, 8416, 8560, 9667, 13215,
13416, 13520`); none in new code. `strings` on the binary shows the raw kernel,
`GGML_OPENCL_RAWQ4_IMPORT`, `cl_khr_external_memory_dma_buf` and the export proc name.

| Artifact | SHA-256 |
|---|---|
| `build-onecopy-gpu/bin/llama-perplexity` | `e6a35a9bd1c374e5f4ab5914ec447fdb1d2a52f7d4ef7a3c3720c15e3d7c56ae` |
| `build-onecopy-gpu/bin/llama-eval-callback` | `438e7be0bfa8ac4bddac72f1bd6f56f7273693fd7242fcc2cb31e6afe73d7d05` |
| `build-onecopy-gpu/ggml/src/ggml-hexagon/libggml-htp-v73.so` | `61c8d6f592786302b257d0d5676d992efcb21bde68aad2cde22447c3fedca640` (identical to v73c/v73d: no DSP change) |
| `build-onecopy-gpu/q4raw-probe` (AArch64 PIE) | `e9abd1661abcd0138ac20ce01f692ad34f1d39355f3a6e9cb8bb65593f3d7cc2` |
| `kernels/mul_mm_q4_0_f32_l4_lm_raw.cl` | `2bbab74d596362159e69cc71944de6f53ab26e15c14054a0834d8e739abc4768` |
| `kernels/mul_mv_q4_0_f32_v.cl` | `d144489d59830879de907bcb8cf98280fcbbba1b06cd36003d1f35614f9cdf77` |

(`raw/SHA256SUMS.txt`.) The probe reads the two `.cl` files from a directory at run time; the
engine binary has them embedded.

### 2026-09-28 16:33 EDT — review-fix rebuild (engine `5e6b66e86`)

One commit on the spike branch, `133cef802` -> `5e6b66e86`, the four SHIP-review fixes; with
`GGML_OPENCL_RAWQ4` off the behaviour is unchanged.

1. **fd lifetime**: `lookup` `dup()`s the exported dma-buf fd (registry field `dup_fd`, the
   export's fd is only an identity) and passes the duplicate to `clCreateBuffer`. The dup is
   closed when the entry is replaced (buffer freed and reallocated) and in
   `ggml_opencl_rawq4_release`, next to `clReleaseMemObject`. The owner can free the `-HOST`
   buffer before backend teardown without unmapping memory the `cl_mem` still reads; a failed
   `dup` refuses the import with a logged error.
2. **Sync is fatal**: `publish_cpu_writes` returns `bool` and logs the `errno` (`strerror`) of
   both `DMA_BUF_IOCTL_SYNC` halves; on failure the wrapper logs the fd and route, releases the
   fresh `cl_mem` and fails the import, so the op stays on the CPU (it reads the same bytes).
   A platform with no dma-buf sync refuses the import too, with its own log line.
3. **Khronos route**: both routes go through the same wrapper sync (now fatal), and
   `import_khr` documents/logs that this route has no host cache policy knob, so coherence
   rests on `DMA_BUF_IOCTL_SYNC`; the refusal line names the route (`route ion|khr`), and the
   KHR INFO line says which coherence mechanism applies.
4. **2-byte offset**: `lookup` refuses an odd tensor byte offset with a logged error naming
   the tensor — the raw kernels' documented precondition (18-byte Q4_0 blocks read with
   `vload_half` / 16-bit loads, `mul_mm_q4_0_f32_l4_lm_raw.cl:4`).

Build: same image, preset, targets and `build-onecopy-gpu` dir as above. Configure `EXIT=0`
(`raw/configure_r2.log`). Attempt 7 `EXIT=1`: `llama-eval-callback` OOM-killed again in the
LTO link (`raw/build_android7.log`, same failure as attempt 5) after `llama-perplexity`
linked; attempt 8 `EXIT=0` (`raw/build_android8.log`). Probe rebuild `EXIT=0`
(`raw/probe_build_android_r2.log`). Same 7 warnings, all in the pre-existing `ggml-opencl.cpp`
lines listed above; none in `ggml-opencl-rawq4*`. `strings` finds the new refusal messages in
both binaries.

| Artifact | SHA-256 (2026-09-28 16:33 EDT, `5e6b66e86`) |
|---|---|
| `build-onecopy-gpu/bin/llama-perplexity` | `b6055ec202c4004ca92cbb4efe0b806e8a971102d0b7dcdeecd63a3a58477415` |
| `build-onecopy-gpu/bin/llama-eval-callback` | `dd1a934ad4a11b51b3ad0af422506644d8b43d7cbfbd50ee708f4900a7113739` |
| `build-onecopy-gpu/ggml/src/ggml-hexagon/libggml-htp-v73.so` | `61c8d6f592786302b257d0d5676d992efcb21bde68aad2cde22447c3fedca640` (unchanged: no DSP change) |
| `build-onecopy-gpu/q4raw-probe` (AArch64 PIE) | `e9abd1661abcd0138ac20ce01f692ad34f1d39355f3a6e9cb8bb65593f3d7cc2` (unchanged: probe sources untouched) |
| `kernels/mul_mm_q4_0_f32_l4_lm_raw.cl` | `2bbab74d596362159e69cc71944de6f53ab26e15c14054a0834d8e739abc4768` (unchanged) |
| `kernels/mul_mv_q4_0_f32_v.cl` | `d144489d59830879de907bcb8cf98280fcbbba1b06cd36003d1f35614f9cdf77` (unchanged) |

The table above this section (attempt 6, `133cef802`) is kept for history.

## 6. S23 session (coordinator; not run)

Wrapper: `scratchpad/agents/onecopy-gpu/run-onecopy-gpu.sh` (`sh -n` clean, never run). Same
per-run gates as `../hexagon-onecopy-rawq4/raw/device-correctness-2026-09-28-fe2daf5d6/run-v73b-correctness.sh`
(Awake, level > 30, battery < 43.0 C, thermal status < 3, `traced` 0, app force-stopped and
absent). Screen on, Kalsa **not** foreground-required for the engine binaries but Awake is.
Correctness runs may be plugged in (as before); **no timing conclusion from a plugged run.**
New files only under `/data/local/tmp/govhtp/onecopy-gpu/`; the kit and earlier dirs are
untouched. Serial: `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`.

```sh
sh run-onecopy-gpu.sh push          # mkdir + 5 pushes + sha256sum on device
sh run-onecopy-gpu.sh probe         # step 1
sh run-onecopy-gpu.sh kld           # steps 2-3 (control, then raw)
sh run-onecopy-gpu.sh kld-decode    # step 4 (one token per ubatch)
```

The wrapper expands to these device commands (S = the serial, R = `/data/local/tmp/govhtp`,
D = `$R/onecopy-gpu`):

```sh
adb -s S shell "mkdir -p D/bin D/dsp D/kernels D/probe"
adb -s S push build-onecopy-gpu/bin/llama-perplexity D/bin/
adb -s S push build-onecopy-gpu/ggml/src/ggml-hexagon/libggml-htp-v73.so D/dsp/
adb -s S push build-onecopy-gpu/q4raw-probe D/probe/
adb -s S push ggml/src/ggml-opencl/kernels/mul_mm_q4_0_f32_l4_lm_raw.cl D/kernels/
adb -s S push ggml/src/ggml-opencl/kernels/mul_mv_q4_0_f32_v.cl D/kernels/
adb -s S shell "cd D && export LD_LIBRARY_PATH=R/lib && ./probe/q4raw-probe --kernels D/kernels --import rpcmem --k 2048 --m 6144 --n 128 --sweep-mb 64"
adb -s S shell "cd D && export LD_LIBRARY_PATH=R/lib && ./probe/q4raw-probe --kernels D/kernels --import system --k 2048 --m 6144 --n 128 --sweep-mb 64"
# G0 control (normal SoA GPU path, same fixture/base as the HTP one-copy runs)
adb -s S shell "cd R && export LD_LIBRARY_PATH=R/lib TMPDIR=D GGML_OPENCL_LOG_KERNELS=1 && D/bin/llama-perplexity -m /data/local/tmp/heat3way/ship.gguf -f R/input/kld_english_fixture.txt -c 512 -b 512 -ub 128 -ngl 99 -dev GPUOpenCL -lm none --chunks 2 --kl-divergence-base R/input/cause-cpu-base.logits --kl-divergence > D/g0-normal-ub128.log 2>&1"
# G1 raw one-copy: Q4_0 matmul weights in the shared -HOST buffer, GPU reads them in place
adb -s S shell "cd R && export LD_LIBRARY_PATH=R/lib ADSP_LIBRARY_PATH='D/dsp;R/lib' TMPDIR=D GGML_OPENCL_RAWQ4=1 GGML_HEXAGON_DEVICES=HTP0:0 GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_MBUF=512 GGML_HEXAGON_VERBOSE=1 GGML_OPENCL_LOG_KERNELS=1 && D/bin/llama-perplexity -m /data/local/tmp/heat3way/ship.gguf -f R/input/kld_english_fixture.txt -c 512 -b 512 -ub 128 -ngl 99 -dev GPUOpenCL -ot 'blk\.[0-9]+\.(attn_(q|k|v|output)|ffn_(gate|up|down)|shortconv\.(in|out)_proj)\.weight=HTP0:0-HOST' -lm none --chunks 2 --kl-divergence-base R/input/cause-cpu-base.logits --kl-divergence > D/g1-raw-ub128.log 2>&1"
```

`kld-decode` repeats G0/G1 with `-ub 1` (the GEMV path).

**Pass criteria**

Step 1, probe (`out/probe-rpcmem.log`, `out/probe-system.log`; each `RESULT` line says
`PASS` when the error is < 1e-3 of the RMS):

1. `INFO` and `EXT` lines are captured. Record: `cl_qcom_ion_host_ptr`,
   `cl_qcom_dmabuf_host_ptr`, `cl_qcom_ext_host_ptr_iocoherent`, `cl_khr_external_memory_dma_buf`
   present or not; `ext_mem_padding` (must be <= 4096: the Hexagon guard page), `page_size`,
   `svm_caps`. Absent both import extensions = the mechanism is dead on this device.
2. `normal-buffer gemm` **and** `gemv1` PASS: the raw kernels are correct on Adreno 740
   (the Mac only proved the GEMM).
3. At least one `import-<policy>-synced` row PASS for the `rpcmem` source (that is the Hexagon
   allocator): the import works and the GPU reads the CPU-written bytes. Non-PASS with a
   `clCreateBuffer` error code: record the code; try the other rows.
4. Coherence: for the policy the engine will pick (`ioc` if the extension is listed, else `wb`)
   compare `nosync` vs `synced`. `synced` PASS is required; `nosync` FAIL or PASS is a finding
   (PASS means the mapping is coherent here, FAIL confirms the publish step is needed).
5. Cost of the import: `import-*` `sweep read_GB/s` and `gemm/gemv1 weights_GB/s` vs
   `normal-buffer`. Below ~70 % of normal on the chosen policy is a red flag to report, not a
   stop.

Steps 2-4 (`kld`, `kld-decode`), each arm `EXIT=0`, `error_markers=0`:

- **G0**: record Mean KLD / same-top / PPL and the `GPUOpenCL model buffer size` (the SoA copy,
  ~1.3 GiB). Reference from another protocol: S23 OpenCL on 8 chunks was 0.001876 / 97.696 %
  (`governor-htp-prefill-spike/REPORT.md`), same order expected.
- **G1** (the test): `imports` = the number of `HTP0:0-HOST model buffer size` lines (3 with
  `GGML_HEXAGON_MBUF=512`); `GGML_OPENCL_LOG_KERNELS: kernel_mul_mm_q4_0_f32_l4_lm_raw` present
  for `-ub 128` and `kernel_mul_mat_q4_0_f32_v` for `-ub 1` (proves the raw kernels ran);
  **one copy shown by the load log**: the `GPUOpenCL model buffer size` shrinks by about the
  `HTP0:0-HOST` total (~1.3 GiB) relative to G0, and no `CPU_REPACK` line for those tensors;
  **KLD gate as for the HTP one-copy: Mean KLD <= 0.005, same-top >= 95 %**, and Mean KLD <=
  G0's + 0.001 (the raw path is f32 end to end, so it should not be worse than G0);
  PPL finite and within the ±1 chunk spread of G0's.
- Any `GGML_ABORT`/`GGML_ASSERT`/`does not meet the import rules`/`exceeds CL_DEVICE_MAX_MEM_ALLOC_SIZE`/
  `no usable dma-buf import extension` line stops the session; the log names the rule. Fixes
  the coordinator can try without a rebuild: `GGML_OPENCL_RAWQ4_IMPORT=khr` (or `ion`),
  `GGML_OPENCL_RAWQ4_POLICY=wb|ioc|uc`, smaller `GGML_HEXAGON_MBUF`.
- Timing (only when unplugged, in a later session): compare the `prompt eval time` lines of G0
  and G1, and the probe's `weights_GB/s`. No threshold is set; the owner reads the cost of the
  raw layout.

## 7. Unproven, in order of risk

1. **The driver may refuse the import** (ION route on a dma-heap fd; padding/page rules;
   Khronos route absent on the 740). The probe answers this first, in seconds.
2. **Coherence**: GPU sees CPU-written weights only after the clean; the probe prints
   `nosync` vs `synced` per cache policy. If `nosync` fails and `synced` passes, the rule above is
   confirmed; if both fail the mapping is wrong.
3. **Raw-kernel speed** (Section 3). If decode drops far below the SoA path, "one copy for the GPU"
   costs speed the owner may not want to pay; that is a product decision, not a bug.
4. `_v` decode kernel and the whole scheduler wiring (`offload_op`, `supports_buft`) are untested
   on any device; the first `G1` run also shows whether the scheduler really hands the GPU the
   matmuls (`GGML_OPENCL_LOG_KERNELS` prints the kernels dispatched).
5. All non-matmul weights stay in normal GPU buffers in the test config (norms, conv, embedding),
   so this spike shares the **Q4_0 trunk only** (~1.3 GiB of 1.5). Sharing the rest needs
   the CPU/GPU-readable placement discussed in `governor-onecopy/DESIGN.md` §2.
6. Lifetime: as of `5e6b66e86` the import owns a `dup()` of the dma-buf fd, so the owner
   freeing the buffer first no longer unmaps the GPU's view (the `cl_mem` keeps its own ref
   until backend teardown), and a lost DSP session still takes the weights the GPU reads
   (`governor-onecopy/DESIGN.md` §7 item 7).
