# K4-SPLIT N0 — Build-path recon

Date: 2026-08-12
Scope: how to produce an Android `bmoe-cli` with OpenCL + Adreno kernels **and** a statically
registered expert-ready hook (`GGML_BACKEND_DL=OFF`). No full build was started.
Submodule working tree at recon time: `kalsa/mld-gemv-m1` (see §checkout).

## Verdict (build only)

**Not BLOCKED_ARCH for compile.** Parent CMake already forwards `GGML_OPENCL` into the
submodule. The hook is detected from `ggml-cpu.h` and linked through `ggml` as long as
`GGML_BACKEND_DL` stays OFF. Product Android scripts **must stay CPU-default**.

**A compile-clean OpenCL `bmoe-cli` is not enough to express the split.** `n_gpu_layers`
is hardcoded to 0 and there is no `-ngl` / `-fa` / `-ot` in `bmoe-cli`. That is a parent
engine patch, not a kernel rewrite.

---

## 1. Call chain (build → hook → compute)

```
cmake -S BigMoeOnEdge -B <out-of-tree>
  BigMoeOnEdge/CMakeLists.txt:46-54
    add_subdirectory(third_party/llama.cpp)   # GGML_* cache flags apply here
    FORCE: LLAMA_BUILD_TESTS/EXAMPLES/SERVER=OFF, LLAMA_BUILD_COMMON=ON
  core/CMakeLists.txt:22-66
    bmoe_core links llama + llama-common
    if ggml-cpu.h matches ggml_cpu_set_expert_ready_hook → BMOE_HAVE_EXPERT_READY_HOOK=1
  cli/CMakeLists.txt:1-2
    add_executable(bmoe-cli) → bmoe_core
```

Runtime (CPU streaming path that must stay alive):

| step | file:line |
|---|---|
| backend init | `session.cpp:383` `llama_backend_init()` → `llama.cpp:89-101` |
| static OpenCL register (only if `GGML_USE_OPENCL`) | `ggml-backend-reg.cpp:147-148` inside ctor `119-174` |
| CPU always registered | `ggml-backend-reg.cpp:171-173` `#ifdef GGML_USE_CPU` |
| load, mmap, no repack, **GPU layers forced 0** | `session.cpp:405-410` |
| context; flash left at default AUTO | `session.cpp:500-519` + `llama-context.cpp:3432` |
| capture warmup harvests expert + dense leaves | `session.cpp:602-680`; leaves `router_hook.cpp:1235` |
| anon dense rebind | `expert_stream_source.cpp:296` → `dense_weights.cpp:234` `tensor->data = it.buf` |
| overlap hook | `session.cpp:715-717` → `expert_stream_source.cpp:1373-1376` `ggml_cpu_set_expert_ready_hook` |
| hook fires **only** in CPU `mul_mat_id` | `ggml-cpu.c:1666-1669` |

`llama_backend_init` calls `ggml_backend_load_all()` **only if** `ggml_backend_reg_count()==0`
(`llama.cpp:99-101`). With `GGML_BACKEND_DL=OFF` the static ctor already registered CPU
(+ OpenCL if compiled in), so there is **no** `dlopen` of `libggml-opencl.so`. That is the
hook-safe configuration.

`ggml_add_backend_library` (`ggml/src/CMakeLists.txt:265-281`):

- `GGML_BACKEND_DL=ON` → `add_library(... MODULE)` (dlopen). Hook symbol is **not** in
  `bmoe-cli`'s link set. This is what `build-android.ps1:16-19` forbids.
- `GGML_BACKEND_DL=OFF` (default, `ggml/CMakeLists.txt:86`) → `target_link_libraries(ggml PUBLIC ${backend})`.
  Hook lives in `ggml-cpu` and is in the same process whether `BUILD_SHARED_LIBS` is ON
  (`libggml-cpu.so` DT_NEEDED) or OFF (single ELF).

---

## 2. What already works

### 2.1 Product Android `bmoe-cli` (CPU, campaign)

`BigMoeOnEdge/scripts/build-android.ps1:55-71`:

- Ninja + NDK toolchain, `ANDROID_ABI=arm64-v8a`, `android-29`
- `GGML_OPENCL=OFF` **by design** (do not flip this default)
- `GGML_NATIVE=OFF`, `GGML_OPENMP=OFF`, `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16` (**no i8mm**)
- `LLAMA_CURL=OFF`, `BMOE_BUILD_TESTS=OFF`
- `cmake --build $buildPath -j` — **no job cap** in the script (override at invoke: `-j 4`)
- Stages `libbmoe-cli.so` + `libggml.so` `libggml-base.so` `libggml-cpu.so` `libllama.so`
  `libllama-common.so` + NDK `libc++_shared.so` (`build-android.ps1:73-95`)
- Staging list **omits** `libggml-opencl.so` on purpose (comment: leftover GPU cache once
  shipped in two APKs)

Linux/RunPod mirror: `scripts/build_bmoe_ndk.sh:271-289` — same flags, `GGML_OPENCL=OFF`,
`--target bmoe-cli`. Pins in that script (`PIN_LLAMA=5236140e5`) are **stale vs K2.2b**.
`JOBS` defaults to `nproc`; force `JOBS=4`.

On-device Termux (campaign path): `scripts/build_bmoe_termux.sh:281-348`

- `GGML_OPENCL=OFF`, `GGML_NATIVE=OFF`
- default `ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16` (**has i8mm**; S23-safe)
- `JOBS` defaults to `nproc` — force `JOBS=4` if ever used
- Campaign `bmoe-cli` sha `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f`
  was a Termux `build-bmoe` (`reports/moe-dropcold.md:31-32`). No arm64 copy on PC
  (`results/xiaomi_ab/sha_records.md:30-32`).

### 2.2 Proven Android OpenCL `llama-cli` (K2 / K2.2b)

Out-of-tree **llama.cpp standalone**, not the parent:

- Tree: `BigMoeOnEdge/third_party/llama.cpp`
- Branch of record: `kalsa/opencl-q6k-dispatch-fix` @ `04c5d362afb4ae3cf7762a81e204f6cba15c5480`
- Dir: `build-android-opencl-k2/`
- Exact cmake: `results/gdn_gpu_k2/BUILD_MANIFEST.md:29-59` (`-j 4`)
- Latest binaries @ `04c5d362a`: `results/gdn_gpu_k22b/BUILD_MANIFEST.md:45-48`

| flag | K2 value |
|---|---|
| `BUILD_SHARED_LIBS` | **OFF** (one ELF; DT_NEEDED: libm, libdl, **libOpenCL**, libc++_shared, libc) |
| `GGML_OPENCL` | ON |
| `GGML_OPENCL_USE_ADRENO_KERNELS` | ON (also default `ggml/CMakeLists.txt:266`) |
| `GGML_VULKAN` | OFF |
| `GGML_OPENMP` | OFF |
| `GGML_NATIVE` | OFF |
| `GGML_CPU_ARM_ARCH` | `armv8.2-a+dotprod+i8mm+fp16` |
| OpenCL headers | `deps/opencl-android/OpenCL-Headers` |
| OpenCL link stub | `deps/opencl-android/icd-build-android/libOpenCL.so` (device uses **vendor** ICD) |
| `HOST_CXX_COMPILER` | `deps/opencl-android/host_cxx.cmd` — **only** because `llama-cli` pulls UI embed (`tools/ui/CMakeLists.txt:40-47`) |

This binary has `-ngl` / `-fa` / `-ot` / **`-cmoe`** (`common/arg.cpp:2466-2476`) but **no**
`--moe-stream`. It cannot be the split product binary.

Adreno trunk correctness with `-fa off` is already proven (K2.2 greedy token-id; K0 op table).
M1 GEMV rewrite failed (NMSE); do not touch kernels.

### 2.3 PC `bmoe-cli`

`BigMoeOnEdge/scripts/build-host.sh:17-18` and `AGENTS.md:28-35`:

```
cmake -S BigMoeOnEdge -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j $JOBS --target bmoe-cli
```

Windows (README:365-367): CMake + VS Build Tools; output `build\cli\Release\bmoe-cli.exe`.
The bash script is not the Windows path.

Cap: `-j 4`. Do not enable OpenCL on the host unless you only need a compile check; Adreno
kernels are meaningless on the PC GPU and `find_package(OpenCL)` would pick a desktop ICD.

---

## 3. What is hardcoded shut

| item | where | effect |
|---|---|---|
| Product Android OpenCL | `build-android.ps1:65` `GGML_OPENCL=OFF` | APK/CLI stay CPU. **Leave this.** |
| NDK helper OpenCL | `build_bmoe_ndk.sh:283` same | same |
| Termux helper OpenCL | `build_bmoe_termux.sh:286` same | same |
| `n_gpu_layers` | `session.cpp:410` `= 0` | even an OpenCL-linked `bmoe-cli` never offloads |
| no `-ngl` / `--gpu-layers` | `cli/main.cpp` (no matches) | cannot pass 99 from the command line |
| no `-fa` | `session.cpp:500-519` never sets `flash_attn_type` | default **AUTO** (`llama-context.cpp:3432`) — FA compile abort on A7X if ngl ever turns on |
| no `-ot` / `-cmoe` | parent does not set `mparams.tensor_buft_overrides` (`llama.h:299-300`) | llama-cli already has both (`arg.cpp:2466-2476`, regex `common.h:1058-1065`) |
| `use_extra_bufts` | `session.cpp:409` false | load-bearing for streamer rebind (`docs/moe-streaming.md:66-71`, `AGENTS.md:43-45`) |
| `LLAMA_BUILD_TOOLS` | defaults OFF when llama.cpp is a subdir (`llama.cpp/CMakeLists.txt:108` + standalone OFF) | parent cmake **does not** emit `llama-cli` |
| `BUILD_SHARED_LIBS` default ON | `llama.cpp/CMakeLists.txt:58-62` | product `bmoe-cli` is `.so`-split; OpenCL would add `libggml-opencl.so` **not** in the PS1 stage list |
| current submodule HEAD | `.git/modules/third_party/llama.cpp/HEAD` → `kalsa/mld-gemv-m1` | **not** the Q6_K-fix branch. M1 kernels must not ship |

`llama_model_default_params` sets `n_gpu_layers = -1` (all layers, `llama-model.cpp:2305`).
The parent override to 0 is the only thing keeping a GPU-capable build on CPU today.

`supports_op` `MUL_MAT_ID` (`ggml-opencl.cpp:6792-6817`): Q2_K / Q3_K fall through to
`return false`. KEXP routed experts therefore **cannot** run on OpenCL even if placed on a
GPU buffer. Mechanism (a) is real for those types. Q4_K/Q5_K/Q6_K *would* be accepted on
Adreno when the name/shape heuristic `use_adreno_moe_kernels` matches — that is the hook-kill
path. Do not let those expert tensors land on OpenCL.

---

## 4. RAM / double-residency risk (build-relevant)

Campaign config holds dense trunk in CPU anon (`--dense-weights anon`, default
`config.h:104`). After load:

1. llama.cpp mmap's the GGUF (`session.cpp:408`).
2. Capture warmup faults dense pages (`session.cpp:602-622`).
3. `DenseWeights::read_anonymous` copies every non-expert file tensor into anon/pinned
   buffers and **rebinds** `tensor->data` (`dense_weights.cpp:234`).
4. `drop_mmap_copies` MADV_DONTNEED's the file pages (`dense_weights.cpp:271-289`).

That already spends ~1.75 GiB CPU-side for KEXP dense.

If `n_gpu_layers>0` **at load**, `load_tensors` assigns layers to OpenCL bufts
(`llama-model.cpp:1236-1303`, `i_gpu_start` at 1292). OpenCL then holds a second copy in
CL buffers (same DRAM). After that, step 3 still rebinds `tensor->data` to CPU anon using
pointers harvested from the graph (`router_hook.cpp:1235`). Two failure modes:

- **Double residency** (RescueParty): GPU CL buffers + CPU anon + `--cache-mb 2000` + KV.
  Mandate abort if MemFree <300 MiB.
- **Semantic smash**: rebind of a tensor whose storage is an OpenCL buffer would point
  `tensor->data` at host anon while the scheduler still thinks the weight is on GPU.

`drop_mmap_copies` only drops **file** VMAs, not CL allocations. There is no
`--dense-weights anon-gpu` today.

Build implication: the first **small** parent patch is placement + flash-attn-off + a
policy for dense after GPU upload. Not a CMake issue, but an OpenCL `bmoe-cli` must not
be smoke-tested at `-ngl 99 --dense-weights anon` until this is designed (N0_DESIGN_NOTES).

---

## 5. Smallest surface to change

**Do not edit** `build-android.ps1`, `build_bmoe_ndk.sh`, `build_bmoe_termux.sh` defaults.

**Do not** start from `kalsa/mld-gemv-m1`. Create `kalsa/split-trunk-gpu` from
`kalsa/opencl-q6k-dispatch-fix` @ `04c5d362a`.

### 5.1 Out-of-tree Android `bmoe-cli` + OpenCL + hook (proposed; not run)

Reuse K2 toolchain. Parent source dir, **not** llama.cpp standalone.

```
NDK=C:/Users/gualt/AppData/Local/Android/Sdk/ndk/27.1.12297006
CMAKE=C:/Users/gualt/AppData/Local/Android/Sdk/cmake/3.22.1/bin/cmake.exe
NINJA=C:/Users/gualt/AppData/Local/Android/Sdk/cmake/3.22.1/bin/ninja.exe
OCL=C:/Users/gualt/Desktop/Kalsa/moe-experiments/deps/opencl-android

# first: checkout llama.cpp to 04c5d362a, branch kalsa/split-trunk-gpu

$CMAKE -S BigMoeOnEdge -B build-android-opencl-k4split -G Ninja
  -DCMAKE_TOOLCHAIN_FILE=$NDK/build/cmake/android.toolchain.cmake
  -DANDROID_ABI=arm64-v8a
  -DANDROID_PLATFORM=android-29
  -DANDROID_STL=c++_shared
  -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_MAKE_PROGRAM=$NINJA
  -DBMOE_BUILD_TESTS=OFF
  -DBUILD_SHARED_LIBS=OFF          # K2 single-ELF; no extra .so to stage
  -DGGML_BACKEND_DL=OFF            # default; keep
  -DGGML_NATIVE=OFF
  -DGGML_OPENCL=ON                 # this cache only
  -DGGML_OPENCL_USE_ADRENO_KERNELS=ON
  -DGGML_OPENCL_EMBED_KERNELS=ON   # default; needs Python3
  -DGGML_VULKAN=OFF
  -DGGML_OPENMP=OFF
  -DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16   # match campaign Termux + K2
  -DLLAMA_CURL=OFF
  -DOpenCL_INCLUDE_DIR=$OCL/OpenCL-Headers
  -DOpenCL_LIBRARY=$OCL/icd-build-android/libOpenCL.so

$CMAKE --build build-android-opencl-k4split -j 4 --target bmoe-cli
```

Why this is hook-safe:

- `GGML_BACKEND_DL=OFF` → OpenCL + CPU are `PUBLIC` link deps of `ggml` (`ggml/src/CMakeLists.txt:278-279`)
- `GGML_USE_OPENCL` compile def on `ggml` (`ggml/src/CMakeLists.txt:318-320`)
- `BMOE_HAVE_EXPERT_READY_HOOK` from header scan (`core/CMakeLists.txt:55-60`)
- `BUILD_SHARED_LIBS=OFF` → one `cli/bmoe-cli` ELF like K2 `llama-cli`; stage
  `bmoe-cli` + NDK `libc++_shared.so` (sha `e69496a4…`). Device `LD_LIBRARY_PATH` + vendor
  `libOpenCL.so`.
- No `HOST_CXX` — parent does not build `llama-cli` / UI embed.

Configure must print: `OpenCL will use matmul kernels optimized for Adreno` and
`bmoe: expert-ready hook present`.

If `BUILD_SHARED_LIBS` is left ON, also ship `libggml-opencl.so` (PS1 will not). Prefer OFF.

Optional second tree (op tests only): reuse `build-android-opencl-k2/` after checkout
`04c5d362a`; already has `llama-cli` / `test-backend-ops` @ K2.2b hashes. Do not mix M1 objects.

### 5.2 Parent code surface (not this file's job, but blocking for a useful binary)

Minimum to make `-ngl 99 -fa off` mean something, without kernels:

1. `RunConfig` + CLI: `--n-gpu-layers` / `-ngl`, `--flash-attn off` (must default **off** on this product or force `LLAMA_FLASH_ATTN_TYPE_DISABLED` whenever `n_gpu_layers!=0`).
2. `session.cpp:410` read the flag instead of `= 0`.
3. Optional: `--override-tensor` or hard `ffn_.*_exps=CPU` via `mparams.tensor_buft_overrides` (llama-cli `-cmoe` regex already exists).
4. Dense/GPU residency policy (see §4).

Prefer parent-engine wiring. llama.cpp patch only if `tensor_buft_overrides` under `--moe-stream`
is not enough; then only on `kalsa/split-trunk-gpu`.

### 5.3 SHA recording (after the real build)

```
Get-FileHash -Algorithm SHA256 build-android-opencl-k4split/cli/bmoe-cli
Get-FileHash -Algorithm SHA256 $NDK/toolchains/llvm/prebuilt/windows-x86_64/sysroot/usr/lib/aarch64-linux-android/libc++_shared.so
```

Write `results/k4split/BUILD_MANIFEST.md` with: branch, HEAD, cmake argv, `-j 4`,
configure snippets (`Adreno`, `expert-ready hook present`), sizes, sha256, DT_NEEDED.
Mirror on device with `sha256sum` before any run.

PC host `bmoe-cli` (no OpenCL) if needed for flag compile:

```
cmake -S BigMoeOnEdge -B build-pc-k4split -DCMAKE_BUILD_TYPE=Release
cmake --build build-pc-k4split -j 4 --target bmoe-cli
```

---

## 6. Open questions

1. ISA for the split binary: campaign Termux = **+i8mm**; product PS1 = **no i8mm**; K2 OpenCL = **+i8mm**. S23 has i8mm. Recommend +i8mm so A/B vs campaign is one variable (placement), not ISA.
2. After GPU upload, can we skip anon copy of tensors already in an OpenCL buft, or must we disable `--dense-weights anon` on the split arm? (RAM gate.)
3. Does capture warmup with `n_gpu_layers>0` still hand host-readable `tensor->data` for expert rebind? Streamer assumes file-native layout in a CPU buffer (`docs/moe-streaming.md:66-71`).
4. Shared expert is dense `MUL_MAT` (not `_ID`) — it *will* go GPU with ngl. Confirm names are **not** matched by `LLM_FFN_EXPS_REGEX` (`common.h:1058`).
5. Parent FORCE-disables llama tools. Need a second cmake for `llama-cli` only if N1 wants `GGML_SCHED_DEBUG` dumps from llama-cli; `bmoe-cli` stderr may suffice.
6. `build_bmoe_ndk.sh` fail-closes on llama pin `5236140e5`. Do not use that script for this branch.

---

## BLOCKERS

**None for compiling** an OpenCL, hook-linked, Adreno-kernel `bmoe-cli` out of tree.

**Blocked for a runnable split** until parent wiring exists (`n_gpu_layers`, `-fa off`).
That is not BLOCKED_ARCH of the fork — llama.cpp already expresses the split (`-ngl 99 -fa off -cmoe` / `-ot`). The parent engine currently refuses to ask for it.

**Process:** checkout `04c5d362a` before any cmake of this tree. Current `mld-gemv-m1` is the wrong HEAD.

No device work. No full build started. `-j4` reserved for the later compile.
