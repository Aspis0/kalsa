# S23 native arm64 OpenCL run - report

Arm: coder / device run, native binary. Target: Galaxy S23 (SM-S911U), unplugged.
Engine commit: `1068eb03d` ("gpu: no exit(1) on the OpenCL compile path, verdict keyed on
the kernel set, V73 GPU prefill lane"), read from a detached worktree
(`/Users/marco/Projects/kalsallama-wt-1068`), not from the shared dirty working tree.
No commit, no push. The installed Kalsa app was never opened; nothing was installed,
uninstalled, or cleared; the Jelly Star was not touched.

Status: **complete** for Q1-Q3 and the coordinator addendum. Sections 0-6 below. No commit, no
push; the host worktree/build and the raw evidence under `raw/` are left in place.

---

## 0. Coordinator correction (recorded so nobody thinks we re-ran the archive)

The coordinator corrected the brief before measurement started:

- Q3 (CPU vs GPU tokens) is **already answered** in the archive. The strict greedy-token
  oracle fails on Adreno 732/735/750 at index 7 with a byte-identical GPU sequence across
  the three GPUs (`scratchpad/agents/logit-oracle/PREREG.md`, `Why` section). A logit-margin
  oracle was designed precisely because token equality cannot separate a near-tie flip from a
  real error.
- On the **740**, dense Qwen3.5-2B through `gemv_noshuffle_q6_k_f32` was recorded as
  numerically correct, greedy `-ngl 99 -fa off` "matches CPU token-for-token"
  (`reports/moe-gdn-k22-fix.md:16-19`). So token identity holds on some A7X paths and fails
  on others.
- The decode side is settled on this tier: GPU decode 0.41x CPU on 740 (`moe-gdn-k22-fix.md:23`),
  sustained CPU 10.2-12.2 t/s at 42.3 C rising vs GPU 8.2 t/s at 38.5 C plateau, energy proxy
  ~0.61 %/1k tok CPU vs ~0.79 % GPU (`moe/reports/moe-gpu-sustained.md:139-143`). The archive
  verdict: "the GPU dividend on A7X remains prefill/TTFT only" (`:174-175`).

Therefore this run treats **Q3 as a single confirmation arm** on our own model and build, and
spends the measurement on **prefill only** (Q2). We did **not** re-run the 32-step protocol and
did not design an oracle. The synthesis index read first was
`scratchpad/QDC-GPU-GOVERNOR-MAP-2026-09-16.md`.

---

## 1. Build and deployment (the part nobody in this lab had done)

### 1.1 Build

Separate worktree and separate build dir; `build-android-ocl` was not configured, deleted, or
written to.

```
git worktree add --detach /Users/marco/Projects/kalsallama-wt-1068 1068eb03d
cmake -S . -B build-android-ocl-1068 -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE=/opt/homebrew/share/android-ndk/build/cmake/android.toolchain.cmake \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-28 -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PREFIX_PATH=/Users/marco/kalsa-opencl-deps/android-prefix \
  -DOpenCL_INCLUDE_DIR=/Users/marco/kalsa-opencl-deps/android-prefix/include \
  -DOpenCL_LIBRARY=/Users/marco/kalsa-opencl-deps/android-prefix/lib/libOpenCL.so \
  -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=ON \
  -DGGML_OPENCL=ON -DGGML_OPENCL_EMBED_KERNELS=ON -DGGML_OPENCL_TARGET_VERSION=300 \
  -DGGML_OPENCL_USE_ADRENO_KERNELS=ON -DGGML_OPENCL_USE_ADRENO_BIN_KERNELS=OFF \
  -DGGML_OPENMP=ON -DGGML_LLAMAFILE=ON \
  -DLLAMA_BUILD_EXAMPLES=ON -DLLAMA_BUILD_TOOLS=ON -DLLAMA_BUILD_TESTS=ON -DLLAMA_BUILD_SERVER=ON \
  -DLLAMA_OPENSSL=ON
ninja llama-bench llama-cli test-backend-ops
```

`cmake` reports `ggml commit: 1068eb03d`. No errors. *(Author assertion, not archived: the
"410/410 ninja targets", the warning counts and the sha256 table below come from the session
transcript, not from a preserved build log. The load-bearing fact - that the on-device binaries
are from `1068eb03d` - is evidenced by the binaries' own `build: 1068eb03d (11194)` lines in
`raw/q1_flash.out` and `raw/q2/*.out`.)* The warnings seen in the transcript were the
pre-existing `ggml-opencl.cpp` ones the lab had already recorded (`governor-gpu-probe/REPORT.md`
section c1).

Binaries (sha256):

| binary | sha256 |
|---|---|
| `llama-bench` | `36f59e9e5097196f94d9ce88b4d94b75daf6812918549bc15b92ef81e3d0a520` |
| `llama-cli`   | `c98363497bf5868a4d92afcc74cbade4c4a8dd3f783fccb701abab8373ecce02` |
| `test-backend-ops` | `0de9c7f7a44b9c517589ade82a4d7c79aca299f70bff538f4c6f93cdd6426e46` |

`llama-cli` self-reports `build : b11194-1068eb03d`, confirming the deployed binary is ours.

### 1.2 libOpenCL: which one, and what the loader actually needs

- The build links `-DOpenCL_LIBRARY=/Users/marco/kalsa-opencl-deps/android-prefix/lib/libOpenCL.so`.
  That file is **not** a stub: it is the **Khronos OpenCL ICD loader** (`dlopen`/`dlsym` imports,
  strings `Khronos OpenCL ICD Loader`, `OCL_ICD_FILENAMES`, vendor search path
  `/system/vendor/Khronos/OpenCL/vendors`). The app's build uses a stub; a native binary cannot.
- The device's vendor implementation is `/vendor/lib64/libOpenCL.so` (163320 bytes, Qualcomm
  direct implementation: `qCLDefaultAPI_clGetPlatformIDs`, `qCLDrvAPI_*`, **no SONAME**).
- `/system/vendor -> /vendor`, so the ICD loader's default vendor dir resolves to
  `/vendor/Khronos/OpenCL/vendors`, which **does not exist** on this phone. The ICD loader alone
  finds no platforms.
- What actually happens: the built binary's `DT_NEEDED` is `libOpenCL.so`; at run time bionic
  resolves that name from the default namespace, where **`/vendor/lib64` is a search path**, so
  the process binds the Qualcomm implementation directly. No stub, no ICD vendor file, and
  **`LD_LIBRARY_PATH=/vendor/lib64` was not needed** - verified: `env -u LD_LIBRARY_PATH ./probe_cl`
  initialises the device and builds a kernel (exit 0).
- `LD_LIBRARY_PATH=/data/local/tmp/s23gpu` **is** needed, but for `libomp.so`: the build uses
  `GGML_OPENMP=ON` and the binary carries `DT_NEEDED libomp.so`, which is absent from
  `/system/lib64` and `/vendor/lib64`. The NDK 29 runtime
  `.../lib/clang/21/lib/linux/aarch64/libomp.so` was pushed alongside.
- SELinux is `Enforcing`; no `avc: denied` appeared for these runs, and `/data/local/tmp` needs no
  special handling. `adb root` is unavailable (production build); `su` is absent, so the
  root-only battery sysfs is unreachable (see Q2).
- `df /data` = 104 G size / 35 G avail. The model was **already on the phone** and was reused:
  `/data/local/tmp/llamabench/LFM2.5-2.6B-Q4_K_M.gguf` (1674454848 bytes = 1.56 GiB). That is the
  same `lfm26.gguf` the archive's `loadprobe_FAcrash_sa801864.out` used, so no push of a 1.5 GiB
  file was required.

Device strings (verbatim, from `ggml_opencl`):

```
ggml_opencl: device: 'QUALCOMM Adreno(TM) (OpenCL 3.0 Adreno(TM) 740)'
ggml_opencl: OpenCL driver: OpenCL 3.0 QUALCOMM build: 0676.73 Compiler E031.41.03.62
ggml_opencl: vector subgroup broadcast support: false
ggml_opencl: subgroup shuffle support: true
ggml_opencl: device FP16 support: true
ggml_opencl: khr dot product support: true
ggml_opencl: global mem size: 3536 MB
ggml_opencl: max mem alloc size: 884 MB
ggml_opencl: device max image buffer size (pixels): 134217728
ggml_opencl: device max image2d size: 16384 x 16384
ggml_opencl: device max workgroup size: 1024
```

The driver string is **the same one the archive blames** (`E031.41.03.62`; `moe-gdn-k22-fix.md`
also records `0676.73`). `max mem alloc size = 884 MB` matters: the archived failing allocation
was a single 1804626176-byte (1.72 GiB) OpenCL buffer, far above this per-allocation limit.

---

## 2. Q1 - does the kernel set compile on this 740, and does our change turn the abort into a clean fallback?

> Correction to the brief's attribution, found while tracing for section 5: the archived
> `loadprobe_FAcrash_sa801864.out` is an **Adreno 732** run (all qdc-7pg3 raw logs print
> `Adreno(TM) 732`), not this S23's 740. This phone's 740 carries driver
> `E031.41.03.62` and nevertheless passes the prescribed FA test matrix 229/229. The 732 crash is
> still real and is explained in section 5.2 (the A7X carve-out omits 732/735).

### 2.1 Prescribed test - PROVEN clean

```
cd /data/local/tmp/s23gpu
LD_LIBRARY_PATH=/data/local/tmp/s23gpu TMPDIR=/data/local/tmp/s23gpu \
GGML_OPENCL_KERNEL_CACHE_DIR=/data/local/tmp/s23gpu/cl-cache \
./test-backend-ops test -b GPUOpenCL -o FLASH_ATTN_EXT
```

Raw: `raw/q1_flash.out` (1.2 MB). Result:

```
  229/229 tests passed
Running FA vec slice tests (env LLAMA_TEST_FA_VEC_DISABLE=1 to skip)
  Backend OpenCL: OK
Backend 2/2: CPU
  Skipping
2/2 backends passed
EXIT=0
```

Zero occurrences of `compile error`, `abort`, `Segmentation`. Every unsupported shape is a clean
`not supported [OpenCL]` skip, not a failure. The commit's verdict was written:

```
GGMLCLVERDICT 1
ok=1
vendor=QUALCOMM
device_name=QUALCOMM Adreno(TM)
driver_version=OpenCL 3.0 QUALCOMM build: 0676.73 Compiler E031.41.03.62
global_mem_size=3708798976
has_integer_dot=1
```

On the prescribed test the answer is: **clean, no abort - exit 0.** Historical note, to avoid a
conflation: the `exit 139 -> 134` record in the archive belongs to **this 740's separate August
abort** (`scratchpad/agents/archive-gpu-docs/REPORT.md:379`, citing `reports/moe-gdn-k2-e2e.md:81`;
also `:662`), whereas the qdc-7pg3 loadprobe this run corrects records **exit 139 only**
(`raw/loadprobe_FAcrash_sa801864.out`, last line). They are two different FA-failure events and
must not be stitched together.

### 2.2 Serious caveat - the exact August program is NOT covered by that test

The programs the test actually built were:

```
   3 compiling fa f32
   3 compiling fa prepass f16
   1 lazy-compiling flash_attn prepass for DK=128 DV=128
   1 ... DK=64 DV=64
   1 ... DK=96 DV=96
```

The August failure was building **`fa f32_f16`** (the `flash_attn_f32_f16.cl` program, i.e.
`FA_VARIANT_F32_F16`, f16 KV cache). That program is compiled only for `type_K=f16,type_V=f16`.
A targeted filter shows the OpenCL backend refuses **every** such case, i.e. 0 tests are even
attempted:

```
./test-backend-ops test -b GPUOpenCL -o FLASH_ATTN_EXT -p "type_K=f16,type_V=f16"
  ... 0/0 tests passed      (2559 lines of "not supported [OpenCL]")
```

The passing cases seen are dominated by `type_K=f32,type_V=f32` (variant F32), with a few other
supported combinations. An exact per-case enumeration is not recoverable from the log because
stderr interleaving detaches some `OK` results from their case lines (226 case lines end in `OK`,
plus 4 detached `OK`s); the harness's own total, **229/229**, stands. The point is that all of
them are variants that compiled, and **`flash_attn_f32_f16.cl` was never compiled.** So `229/229`
does not certify the program this run probed.

### 2.3 Direct driver test of the August program - PROVEN crash

To close that gap I built a minimal native OpenCL probe (`raw/probe_cl.c`, 2505 bytes of source;
the compiled `raw/probe_cl` is 9608 bytes; NDK clang
`--target=aarch64-linux-android28`, linked `-lOpenCL`) that calls `clGetPlatformIDs` ->
`clCreateContext` -> `clCreateProgramWithSource` -> `clBuildProgram` on a named `.cl` file and
prints the build log. Control: a trivial kernel builds (exit 0) with the full option string.

Base options = the engine's `kernel_compile_opts`
`-cl-std=CL3.0 -cl-mad-enable -cl-unsafe-math-optimizations -cl-finite-math-only -cl-fast-relaxed-math`.

| # | source | DK/DV | extra opts | result |
|---|---|---|---|---|
| E | `flash_attn_f32.cl` | 64/64 | - | **BUILD_OK err=0** |
| F | `flash_attn_f32_f16.cl` | 64/64 | - | **Segmentation fault (exit 139)** |
| G | `flash_attn_pre_f16.cl` | 64/64 | - | **BUILD_OK err=0** |
| A | `flash_attn_f32_f16.cl` | 40/40 | `-D cl_qcom_subgroup_shuffle=1` | **SIGSEGV 139** |
| B | `flash_attn_f32_f16.cl` | 40/40 | (none) | **SIGSEGV 139** |
| C/J | `flash_attn_f32_f16.cl` | 256/256 | `-D cl_qcom_subgroup_shuffle=1` | **SIGSEGV 139** |
| H | `flash_attn_f32_f16.cl` | 64/64 | full engine opts (`-D cl_qcom_subgroup_shuffle=1 -D FA_K_LDS_T`) | **SIGSEGV 139** |
| I | `flash_attn_f32_f16.cl` | 64/64 | `-D FA_K_LDS_T` only | **SIGSEGV 139** |

DK=40 and DK=256 are not arbitrary: both are entries of the default FA tuning table
(`fa_tune.h`, `{40,40,...}` and `{256,256,...}`) and both are named in the August log.

The crash is **inside `clBuildProgram`**, with unbuffered output confirming the last executed
step. Sibling kernels from the same directory build fine. So on this exact driver, the
`flash_attn_f32_f16.cl` program cannot be built at all.

**Consequence for the commit's claim.** The failure mode is a SIGSEGV in the driver, not a
returned `CL_*` error. `1068eb03d` changed `build_program_from_source_ex(..., fatal=true)` to
`fatal=false` and records a fail verdict on a *returned* error. It cannot intercept a signal
raised inside `clBuildProgram`; the process dies before any C++ handler runs. Two further facts
make this concrete:

- The source was already fixed for the August diagnostic: `flash_attn_f32_f16.cl:33-36` (added
  2026-07-15, upstream `9463b3aa8` / fork `c3d47e696`, "fix two issues on flash attention for
  Adreno a7x") defines `sub_group_shuffle_xor` as `qcom_sub_group_shuffle_xor(...)`. The
  "implicit declaration" of the August log cannot occur with the current source; the compile gets
  further and reaches the driver crash instead.
- So our commit did not *cause* the fixed compile, and for this program it does not *prevent* the
  crash either.

### 2.4 Engine-level status - NOT VERIFIED

I could not make the engine itself compile `FA_VARIANT_F32_F16`. With `-fa 1` and `-v`, and a
clean kernel cache, neither model on the phone dispatched any FA program:

- `llama-cli ... -ngl 99 -fa 1 -st -p ... -n 4 -v` -> exit 0, `flash_attn = enabled`, no
  `compiling fa` line, 197 cache files, verdict `ok=1` (so the *bulk* set built fine).
- `llama-bench -m lfm26 -ngl 99 -fa 1 -p 128 -n 0 -r 1 -v` -> exit 0, no FA compile.
- `llama-bench -m OLMoE-1B-7B -ngl 12 -fa 1 -p 128 -n 0 -r 1 -v` -> exit 0, no FA compile.

`flash_attn = enabled` is only the parameter; no `ggml_flash_attn_ext` reached the OpenCL
backend in these runs (LFM2.5 is a hybrid, OLMoE was only partly offloaded). Because
`supports_op` rejects all `f16/f16` FA cases, the engine may in practice never select the
crashing program. Whether the current engine can be *forced* into it, and whether that is a
segfault or a caught error, was not observed. **Engine-level: NOT VERIFIED.** Driver-level crash
on the exact program: **PROVEN**.

### 2.5 Q1 verdict

| claim | verdict |
|---|---|
| The OpenCL kernel set compiles on this phone's Adreno 740 (driver `E031.41.03.62`) | **PROVEN for the set the prescribed test exercises** (229/229, exit 0, verdict `ok=1`) |
| The August `fa f32_f16` program now builds | **REFUTED** - it SIGSEGVs the driver at DK=40/64/256 (`raw/pE.out`, `raw/pF.out`, `raw/pH.out`, ...) |
| `1068eb03d` turned August's abort into a clean recorded fallback | **REFUTED for this failure mode.** A return-valued compile error is now non-fatal, but the observed failure is a SIGSEGV inside `clBuildProgram`, which no in-process handling can catch. The fallback path was not exercised: no returned compile error occurred. |
| Engine reaches the crashing program | **NOT VERIFIED by direct observation, but see section 5: a pre-existing `supports_op` carve-out refuses it** (no FA dispatch observed with either on-device model) |

Driver string: `OpenCL 3.0 QUALCOMM build: 0676.73 Compiler E031.41.03.62`.
Memory: global 3536 MB, **max mem alloc 884 MB**, images 134217728 px / 16384x16384, wg 1024.

**Important follow-up (section 5):** the tree at `1068eb03d` already contains a preventive
refusal for exactly this crash, in `ggml_opencl_supports_op` (`ggml-opencl.cpp:9903-9906`), added
2026-08-20 by `6503355df`, i.e. *before* our commit. That is why no FA program was dispatched in
any engine run above. The `fatal=false` change in `1068eb03d` is a separate, narrower safety net
for clean compile errors; it is not what prevents this crash.

---

## 3. Q2 - what is GPU prefill worth in speed, temperature and energy?

Model `LFM2.5-2.6B-Q4_K_M` (1.55 GiB), commit build `1068eb03d (11194)`, phone unplugged
throughout. Every arm ran `-fa 0`. Sampling used a 1 Hz on-device loop writing the Meter columns
(`raw/sampler.sh`): `t_s` from `/proc/uptime` (CLOCK_BOOTTIME), plus `current_mA`,
`charge_counter_uAh`, `voltage_mV`, `batt_temp_dC` and four CPU thermal zones. The four sysfs
nodes in the brief are **root-only on this production build**: `cat
/sys/class/power_supply/battery/current_now` -> `Permission denied` as `shell` (uid 2000),
`adb root` -> "adbd cannot run as root in production builds", `su` absent. The shell-accessible
equivalent `cmd battery get current_now|counter|temp` was used instead. No device setting was
changed.

Raw: `raw/q2/{cpu4.out,cpu4.csv,cpu4.meta,gpu4.*,gp.*}`.

| arm | command | pp256 t/s | duration | battery C (start -> peak) | max CPU zone | gpuss zone | charge Δ | ∫current |
|---|---|---|---|---|---|---|---|---|
| CPU | `-ngl 0 -fa 0 -p 256 -n 0 -r 4 -t 6` | **9.19 ± 0.62** | 466 s | 31.0 -> 31.7 | 78.6 C | n/m | **0 uAh** | 25.0 mAh |
| GPU | `-ngl 99 -fa 0 -p 256 -n 0 -r 60 -t 6` | **75.38 ± 2.55** | 268 s | 29.4 -> **38.6** | 89.5 C | n/m | 86.25 mAh | 82.5 mAh |
| GPU (gpuss probe) | `-ngl 99 -fa 0 -p 256 -n 0 -r 30 -t 6` | **75.81 ± 0.95** | 162 s | 33.5 -> 37.9 | n/m | 36.8 -> **81.6** | 41.25 mAh | - |

(n/m = not measured in that arm; the two GPU arms used different zone sets. The battery column is
start -> peak; the CPU arm ended at 31.2 C, below its own peak. The gpuss row covers zones 33-40.)

**Speed.** GPU prefill is **8.20x** the CPU's on this model (75.38 vs 9.19 t/s). Note the CPU run
is dominated by model load: a clean unsampled `-r 3` run took 402 s wall for ~125 s of measured
compute, i.e. roughly 4-5 min of CPU-side load. The GPU arm loads far faster.

**Instrument cross-check (this is the load-bearing calibration).** For the GPU arm the two
independent software reads agree: charge counter 86.25 mAh and integral of `current_now` 82.5 mAh,
a 4.3 % difference. So at ~1.5 A the pair is mutually consistent. **For the CPU arm the coulomb
counter never moved at all** (it sat at 3397500 uAh for all 108 samples over 466 s) while the
integral recorded ~25 mAh. The earlier explanation that this was a coarse 56.25 mAh quantum is
**withdrawn**: within this same session the counter moved 86250 uAh inside one GPU arm, and all
observed deltas share a 750 uAh GCD, so the counter is not quantized at 56.25 mAh - it updates
lazily and unevenly. It is a failing instrument in this window, not a coarse one. An independent
calibration at exactly the CPU arm's ~70-300 mA currents (`raw/q2/cal.csv`) showed the two reads
disagreeing 3.7x, the same failure the archive already records: "charge-counter energy
inconclusive (5.3x spread on identical work - do not cite)" (`archived/ALIVE-2026-09-full.md:448`).
Which read was wrong there is unknown. **The pair is validated only at ~1.5 A (the GPU arm).**

**Power (one basis, stated, because mixing bases is how this line gets misquoted).** On a **mean**
basis - the trapezoidal integral of `current_now` divided by the arm duration, times the single
per-arm voltage sample (4241 mV CPU, 4232 mV GPU) - the CPU arm averages ~195 mA, i.e. ~**0.83 W**,
and the GPU arm ~1117 mA, i.e. ~**4.73 W**: a ratio of **5.7x**. On a **median** basis (-71 mA vs
-1535 mA, same voltages) it would be 0.30 W vs 6.50 W, a ratio of 21x. Mean and median are not
interchangeable here. Either basis shows a multi-fold power increase; the mean basis is the one
consistent with the mAh figures below. Do not quote a single watt number without its basis.

**Charge and degrees per 1000 prefilled tokens.**

**Every figure below is CHARGE (mAh), not energy.** Voltage was sampled once per arm, not
integrated, so none of these are joules, mWh or watts; converting to energy embeds a
constant-voltage assumption. Say "mAh" when quoting.

| metric | CPU | GPU |
|---|---|---|
| mAh / 1000 tokens | counter unresolved; integral **24.4** (load-inclusive, uncalibrated at low current) | **5.4-5.6** (86.25/15.36 = 5.62 counter; 82.5/15.36 = 5.37 integral; 41.25/7.68 = 5.37 second run) |
| battery C / 1000 tokens | +0.68 | +0.60 |
| battery C / second | +0.0015 | +0.035 |

**Verdict for Q2.**

- tok/s: **PROVEN** - GPU 8.20x CPU prefill on this model and phone.
- charge per token: **PROVEN for the GPU arm** (two independent reads agree, at ~1.5 A). The GPU
  uses about **5.4-5.6 mAh of charge per 1000 prefilled tokens**. **Nothing CPU-side here is
  quotable as a number.** The counter did not resolve (it never moved), and while the integral
  gives 24.4 mAh/1000 load-inclusive, the 3.7x meter disagreement at exactly those currents leaves
  its absolute value uncalibrated. The only defensible CPU statements are the integral itself
  (24.4 mAh/1000 including the load phase, labelled uncalibrated) and the loose conclusion that
  the GPU is *at least* about 4x cheaper per token. The previously quoted "< 54.9 mAh/1000" is
  **withdrawn** - it rested on the 56.25 mAh quantum model the data refutes.
- degrees: **PROVEN, with the arm attribution stated.** The **GPU arm** is the hot one: battery
  29.4 -> 38.6 C, a CPU cluster peaking at **89.5 C** (thermal_zone6, ~69 % into that arm) and
  gpuss at 81.6 C. The **CPU arm** peaked at 31.7 C battery and 78.6 C CPU cluster (thermal_zone5,
  ~76 % in). The arms did different amounts of work, so per 1000 tokens the battery rises are
  similar (+0.60 vs +0.68 C); but the 89.5 C ceiling belongs to the GPU arm, which matters for
  throttling: the CPU arm was **not** the throttled one, so there is no evidence the 8.2x is
  inflated by CPU thermal decay. No clocks were sampled, so mild CPU throttling at 78.6 C cannot
  be fully excluded.
- **The owner's premise is partly refuted.** GPU prefill is not "cooler" in absolute temperature
  on this phone: it drives the SoC to ~90 C and the battery up 9.2 C in 4.5 minutes. It is 8x
  faster and (per token) no more expensive, and it reaches that ceiling *faster*, so the heat is
  delivered sooner and harder. The correct statement is "GPU prefill is faster and per-token no
  hotter, but it is a multi-watt mode (4.7-6.5 W depending on basis, section above) that heats
  the device much faster per second", not "GPU keeps the
  phone cool". A follow-up with matched token counts per arm would be needed to separate the
  per-token figure from the per-second figure exactly; that was not run.

---

## 4. Q3 - one greedy token-identity arm (CPU prefill vs GPU prefill)

Run as a single confirmation arm, not a protocol (`raw/q3/q3.sh`):

```
./llama-cli -m LFM2.5-2.6B-Q4_K_M.gguf -fa 0 -st -n 32 --temp 0 --top-k 1 --seed 42 -t 6 \
            -p "The capital of France is" -ngl 0    # then -ngl 99
```

Both arms exited 0. Generated completions (`raw/q3/*_completion.txt`):

```
CPU: [Start thinking]\n\nThe user is asking for the capital of France. This is a straightforward...
GPU: [Start thinking]\n\nThe user has provided an incomplete sentence: "The capital of France is"...
```

**The tokens diverge.** The raw completion texts are archived (`raw/q3/cpu_completion.txt`,
`raw/q3/gpu_completion.txt`). The common prefix is exactly the 27 characters `"[Start thinking]
\n\nThe user "`; the texts then diverge at the **7th generated token**: CPU continues `" is"`
(then "asking for..."), GPU continues `" has"` (then "provided an incomplete..."). Tokens 0-5
are identical; divergence at the 7th token is the classic near-tie-flip shape. **The divergence
itself - CPU and GPU greedy outputs differ from the 7th generated token - is PROVEN from the
archived raw text.**

**The numeric token ids are NOT archived.** `llama-tokenize` was run on the device to obtain
`[67, 10520, 6416, 64197, 597, 4695, 355, ...]` vs `[..., 677, ...]` and `355 = " is"` /
`677 = " has"`, but no transcript of that run was kept, the tokenizer and model left with the
device, and nothing on the host can re-derive them. They survive only in this report's earlier
text. So after this correction: **the divergence position (7th generated token) and the two token
strings (`" is"` vs `" has"`) are evidence-backed; the ids `355` and `677` are author-asserted
and unarchived.**

**Comparability with the archive is same-class, NOT established.** The archive's strict oracle is
recorded as failing "at index 7" on Adreno 732/735/750 (`scratchpad/agents/logit-oracle/
PREREG.md:8`), but that line does not state its indexing convention, and this run is a different
model, prompt and build. If the archive's index is one-based, its index 7 is the same 7th token
this run diverged on; if it is zero-based, they differ by one. The defensible claim is "same
class: early near-tie divergence in greedy CPU-vs-GPU prefill", not "the same phenomenon". Per
the coordinator we stopped here: no oracle, no 32-step protocol. Note this arm ran `-fa 0`; on
this device FA is not dispatched anyway (section 5), so the divergence comes from the GPU
matmul/prefill kernels, not from FA.

---

## 5. Consequence - is the crash reachable from the shipped app? (read-only)

### 5.1 Who decides FA and the KV type

**App side.** `kalsa/src/engine/engineParams.ts:79` sets
`params.flash_attn_type = override.flashAttn`; the mode is `FlashAttnMode` with a default of
`"auto"` (`engineParams.test.ts:21`, `:76`). `engineParams.ts:90` forces `params.cache_type_v =
"f16"` when quantized V is not allowed. `kalsa/src/engine/deviceTuning.ts:744-745` sets
`type_k = input.model.kvCache?.k ?? "q8_0"` and `type_v = input.model.kvCache?.v ?? "q4_0"`, and
`kalsa/src/engine/LlamaService.ts:2401-2402` passes `cache_type_k`/`cache_type_v` into the
context params. So the app **can** and usually **does** run with a non-f32 KV type (q8_0/q4_0 or
f16) while `flash_attn_type` is `auto`.

**Native side.** `llama.rn-kalsa/cpp/rn-llama.cpp:256-263` maps the flash-attn string;
`:241-253` maps the KV type with an explicit **"Default to F16 if empty string"** at `:243`. So
`type_K=f16` is the default whenever the app does not override it.

So yes: the app can produce `type_K != f32` with FA enabled. The thing that stops it is the
OpenCL backend.

### 5.2 The refusal already exists

`ggml/src/ggml-opencl/ggml-opencl.cpp`, function `ggml_opencl_supports_op` (defined at `:9497`),
case `GGML_OP_FLASH_ATTN_EXT` (`:9856`). The explanatory comment is at **`9893-9902`**; the
executable refusal `if` is at **`9903-9906`**:

```cpp
// A7X (Adreno 740, compiler E031.41) SIGSEGVs inside clBuildProgram
// building the flash_attn programs whose KV path is mixed-type or
// dequantized - f32_f16, q8_0, q4_0 (reproduced at DK=40 and DK=64; it
// is DK-independent). ...
if (backend_ctx && backend_ctx->adreno_gen == ADRENO_GPU_GEN::A7X &&
    (is_f32_f16 || is_f32_q8_0 || is_f32_q4_0)) {
    return false;
}
```

- **Introduced by `6503355df`, 2026-08-20** (also carried by the cherry-pick `5c7e16fa6`), so it
  **predates `1068eb03d`** and is present in the committed file at that commit (`git show
  1068eb03d:...ggml-opencl.cpp`, refusal `if` at line 9903).
- It keys on the **GPU generation**, not the driver string: `get_adreno_gpu_gen()` returns
  `A7X` for a device name containing `730`/`740`/`750` (`ggml-opencl.cpp:299-303`). Broader than
  `E031.41.03.62` for those three IDs, which is what the coordinator asked for.
- **The classification has a hole.** `732` and `735` are **not** in that list (`:299-303`) and fall
  through to `ADRENO_GPU_GEN::ADRENO_UNKNOWN` (`:320`), so on those parts the carve-out **does not fire**
  and the crashing variants remain reachable. This is not hypothetical: the archived FA abort
  that the brief attributed to this 740 is in fact an Adreno **732** run - every qdc-7pg3 raw log
  says `device: 'QUALCOMM Adreno(TM) 732 ...'` (`scratchpad/agents/qdc-7pg3-govbench-52/raw/
tbo_mm_sa801864.out`), and the cell's own report heading says "FLASH_ATTN kernels do NOT compile on
  Adreno 732" (`.../REPORT.md:28`). Its binary was `test-backend-ops from gov-kit-5c3979438`
  (`.../REPORT.md:19`), i.e. a build that already carried the guard; the guard simply did not
  match the 732. So the raw archive does not support "this S23's 740 aborts" - it supports "a 732
  aborts, and the carve-out is not defined for 732".
- The shipped app's pinned engine also has it: `llama.rn-kalsa/vendor/llama.cpp/.../
ggml-opencl.cpp` contains the same comment; the engine is pinned at `0288dc27` (2026-09-20).
- This is exactly why every engine run in this report refused FA: the test matrix reported `0/0`
  supported `f16/f16` cases, and `-fa 1` on two models never compiled a single FA program.

### 5.3 Can the `1068eb03d` verdict mechanism carry it?

**No.** `cl_program_cache_save_verdict` (`ggml/src/ggml-opencl/cl-program-cache.cpp:476`) records
an `ok`/`fail` verdict on a *returned* build result. The failure here is a SIGSEGV inside
`clBuildProgram` (probe arms A/B/C/F/H/I/J, all exit 139); the process dies before any verdict can
be written. The verdict cache can remember a **clean** failure, not this one. The mechanism that
*can* carry it is the return-value carve-out in `supports_op`, and that already exists.

### 5.4 One sentence

**On this 740, no - `1068eb03d` does not leave the crash reachable, because the pre-existing
A7X carve-out in `ggml_opencl_supports_op` (`ggml-opencl.cpp:9903-9906`, since 2026-08-20,
`6503355df`) refuses the `f32_f16`/`q8_0`/`q4_0` variants before any `clBuildProgram`; but on an
Adreno 732/735 the same crash stays reachable, because `get_adreno_gpu_gen`
(`ggml-opencl.cpp:299-303`, fall-through `:320`) omits those IDs and the guard never fires.**

The single line that stands between us and the crash on the uncovered parts is therefore the
classification at `ggml-opencl.cpp:299-303`, not the carve-out itself. Matching on the compiler
string (`E031.41`, observed on this 740, and `E031.45`, the 732's `E031.45.02.16` seen in
`qdc-7pg3`) would be a tighter key than a device-name list. That is a policy change, not done
here - this section is read-only, no code was written.

---

## 6. Cleanup, leftovers, and raw evidence

**On the phone (author assertions - no archived transcript).** Everything this session pushed
lived under `/data/local/tmp/s23gpu` (520 MB: three binaries, `libomp.so`, `llama-tokenize`, the
kernel `.cl` files, the `cl-cache`, and all arm CSVs/logs). That directory was removed (`rm -rf`)
and the stray `/tmp/t0` from the timed CPU run was removed; `/data/local/tmp` was reported back at
its pre-session entry count (74). Pre-existing material was not touched: the models
`Marco-Mini-Instruct-KEXP.gguf`, `OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf` and
`llamabench/LFM2.5-*.gguf` were all present and unchanged. **None of this - the cleanup, the
entry count, or the unchanged models - has a saved transcript; it is report-author assertion.**
The phone was never plugged in, no app was opened, nothing was installed or uninstalled, no app
data was cleared, and no setting was changed (`screen_off_timeout` was read as `30000`); those are
**likewise assertions**. The only device-state statement with raw backing is indirect: every
sampled current in every archived arm CSV is negative (discharge), which is consistent with
battery operation and inconsistent with charging, and the archived scripts (`raw/sampler.sh`,
`runarm.sh`, `gpuss_arm.sh`, `q3.sh`) contain only reads and writes under `/data/local/tmp/s23gpu`,
so the automated arms could not have changed a setting.

**On the host (left in place as evidence).**
- `/Users/marco/Projects/kalsallama-wt-1068` - detached git worktree at `1068eb03d`
  (`git worktree remove` was not run so the build stays inspectable).
- `/Users/marco/Projects/kalsallama-wt-1068/build-android-ocl-1068` - the separate build dir
  (`build-android-ocl` was never reconfigured or deleted).
- All raw device outputs are in `scratchpad/agents/s23-native-gpu-bench/raw/` (Q1 transcripts and
  probes, Q2 CSVs, Q3 completion texts - the Q3 token-id transcript was **not** kept - the vendor
  `libOpenCL.so`, `probe_cl.c`, `sampler.sh`, `runarm.sh`, `q3.sh`).

**What was NOT VERIFIED.**
1. The engine was never observed compiling `flash_attn_f32_f16.cl`; the driver crash is proven by
   the standalone probe, and the reason no engine run reached it is the `supports_op` carve-out
   (section 5), not a passed test.
2. CPU-side mAh per 1000 tokens: the fuel gauge did not move over the 466 s CPU arm.
3. The FA-crash program on a real Adreno **732/735** was not reproduced here (no such device was
   in scope); it is inferred from `get_adreno_gpu_gen`'s missing IDs plus the archived qdc-7pg3 run.
4. Matched-token-count thermal arms were not run; Q2's per-token temperature/charge figures carry
   the load-phase and token-count caveats stated in section 3.
5. **Open question, worth scoping later (not investigated in this session):** the archive records
   a 740 (QDC HDK8550, SM8550) with compiler `E031.41.03.56` that **passes FLASH_ATTN_EXT 229/229**
   (`scratchpad/agents/archive-gpu-docs/REPORT.md:181-182`, `:304`, `:664-665`), while this
   phone's 740 is `E031.41.03.62` and its `flash_attn_f32_f16.cl` SIGSEGVs. The micro-version
   difference (.56 vs .62) is unreconciled. Any statement that "the 740 cannot build f32_f16"
   should be scoped to the `.62` compiler until this is settled.

---

## 7. Corrections after audit

Independent audit: `AUDIT.md` in this directory. Report-only corrections; no new device
measurements, no code, no branch, no commit. Conclusions unchanged; their support was fixed.

| # | what changed | where |
|---|---|---|
| 1 | Guard line numbers fixed: refusal `if` is `ggml-opencl.cpp:9903-9906` (comment `:9893-9902`); A7X generation list `:299-303`; fall-through `ADRENO_UNKNOWN` `:320`. Previously `:9893` and `:293-297` (10- and 6-line offsets). Re-verified against the clean worktree at `1068eb03d`. | 2.5, 5.2, 5.4 |
| 2 | Charge-counter "56.25 mAh quantum" explanation **withdrawn** (contradicted by this session's own data: 86250 uAh moved in one GPU arm, deltas share a 750 uAh GCD - lazy/uneven gauge, not coarse). The "< 54.9 mAh/1000" CPU bound **withdrawn** and CPU-side charge now explicitly not quotable as a number. | 3 |
| 3 | Watts line recomputed on one stated basis: mean (integral/duration x single voltage) = ~0.83 W CPU vs ~4.73 W GPU (5.7x); the median basis (21x) stated separately. | 3 |
| 4 | Charge vs energy made explicit: all figures are **mAh of charge**, voltage sampled once per arm, so none are mWh/joules/watts. | 3 |
| 5 | Q3 token ids marked **unarchived author assertion** (divergence at the 7th generated token and the token strings remain evidence-backed). Archive comparison downgraded to same-class, not established (PREREG does not fix the counting convention). | 4 |
| 6 | 89.5 C attributed explicitly to the **GPU arm** (~69 % in); CPU arm peak 78.6 C (~76 % in); added that the CPU arm was not the throttled one. | 3 |
| 7 | `exit 139 -> 134` re-pointed to the 740's separate August abort (`archive-gpu-docs/REPORT.md:379`, `:662`); the 732 loadprobe records 139 only. Charge-counter retraction citation repointed to `archived/ALIVE-2026-09-full.md:448`. | 2.1, 3 |
| 8 | Added the open micro-version question: archive 740 `.56` passes FA 229/229 vs this phone's `.62` SIGSEGV; scope the claim to `.62`. | 6 |
| 9 | Evidence standard: build-progress/sha256/warning counts and all phone-side housekeeping claims marked as author assertions with no archived transcript; the claims with raw backing are named. | 1.1, 6 |
| 10 | Minor: removed the non-existent `raw/q2/cpu4.tmp` citation; corrected `probe_cl.c` size (2505 bytes source, 9608-byte binary); replaced the 224+4 itemization with the harness total plus an interleaving note; labelled the battery column start -> peak; removed "token ids" from the archived-artifacts list. | 1.1, 2.2, 2.3, 3, 6 |

Audit strength summary: the 8.2x prefill ratio and the GPU-side 5.4-5.6 mAh/1000 figure reproduce
from raw to the decimal and remain quotable (as charge); the guard analysis and both brief
corrections were CONFIRMED. The audit's indirect-only caveats (GPU dispatch evidenced physically
rather than by dispatch logs; unplugged inferred from current sign) are recorded in section 6.

