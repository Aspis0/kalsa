# Vulkan vs OpenCL S23 satellite (queue #15)

Date: 2026-08-21 (America/New_York)

**plugged exploratory — absolute numbers NOT comparable to the unplugged sessions; ratio is the deliverable.**

Result: **NO RATIO**. Vulkan on Adreno 740 enumerates and runs f16 dense MUL_MAT 242/242, then **aborts** (rc 134, uncaught `vk::SystemError`) on quantized Q2_K/Q3_K/Q4_K MUL_MAT_ID and Q4_K dense GEMV pipeline creation. Speed cells SKIP. No ship claims. Owner away, cannot unplug; both arms would have been plugged so the comparison would have been internally fair — it never started.

Engine HEAD: `c77fe135456b878e78f2840555eeb4acda34dda8` (`kalsa/kernel-s3-repack`). No remotes. No commits this session.

Device: Galaxy S23 `SM-S911U`, Adreno 740, serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`. PC-side `adb shell`.

## Arms and device dirs

| arm | dir | backend | do not |
|---|---|---|---|
| **O** | `/data/local/tmp/s3oracle` | OpenCL, barrier-verify set at `c77fe1354` | clobber |
| **V** | `/data/local/tmp/s15vk` | Vulkan, `build-android-vulkan-s15` | mix libs with O |

Both llama-bench invocations: `-ngl 99 -fa off -t 4 -nr -p 0 -n 512 -r 1 -o jsonl`.

## SHA pins (PC, to be matched on-device before every run)

### Vulkan (`s15vk`) — from `scratchpad/agents/vulkan-build-s15/REPORT.md`, rehashed this session

| file | bytes | SHA-256 |
|---|---:|---|
| `libggml-vulkan.so` | 47011288 | `5ff2db3d669c51beb9a6a6d0dab99bdcccbbbdceaa49fd4bcc3a4a4d86aaf297` |
| `libggml.so` | 537112 | `367ccf39e5d7be6193331aa82cb1401582cd993e00f97217e9df1ff86e7331bc` |
| `libggml-base.so` | 6103488 | `5b4685c9b4564907df918e1bf2cd71887c8ebfa8ad18cb2012f4f2f349f7c35d` |
| `libggml-cpu.so` | 5165048 | `652e311c73597ee7cd74b0dbeef446567b337c07d25a5f05c942f8e2e86d8a3c` |
| `libllama.so` | 39807616 | `a14dba6f891864ebc20c4eebe99a9f33131f73293dc52f0c40bea01f97e4123f` |
| `libllama-common.so` | 78377224 | `66e68b1bc372860d1d93db298292a6c3395efcf9afaa546669ac9818c6b13212` |
| `test-backend-ops` | 10182432 | `c24b311132021a968ab0669a60ed60dc3604ca47166d89e778f6ad77726c6178` |
| `llama-bench` | 7592 | `b4e9476ee03f270c85d0e9eb2dd578089756075d131dd058456bb039182c7b21` |
| `libllama-bench-impl.so` | 4253152 | `36b90cd131a2613d70f263f34a3721ffcdc86b6c9bbb5c9b5e103c9b0088fd35` |
| `libc++_shared.so` | 1794776 | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` |
| `libomp.so` | 1229304 | `ea27efff687f8359fabc728af9a4ea45766714399792344af94b09037d52d0b0` |

### OpenCL (`s3oracle`) — barrier-verify set, not rebuilt

| file | bytes | SHA-256 |
|---|---:|---|
| `libggml-opencl.so` | 8381304 | `bbd700de84e32c30c7ea68725e6ed553c5ac25d842f7d0d9b4271917f79f81ea` |
| `libggml.so` | 536880 | `3f07bb31e79da8698635286a1a39dd2f21836e32dff9bdf578a1cce01351fb27` |
| `libggml-base.so` | 6103496 | `2e16b95119208c7bb70cf3be444670611259a050480e9923f2790541d3e489a8` |
| `libggml-cpu.so` | 5165056 | `fd9cb4b1f49c60a64eea964a4c19200c2878b74df450bc287cbbe6fdf8dcb0da` |
| `libllama.so` | 39807624 | `f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d` |
| `libllama-common.so` | 78377240 | `7547a07298165871f415b835bc66852713ca02afcc43c0d3e3abcb2eca8be2c8` |
| `llama-bench` | 7600 | `b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c` |
| `libllama-bench-impl.so` | 4253160 | `8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807` |
| `libc++_shared.so` | 1794776 | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` |
| `libomp.so` | 1229304 | `ea27efff687f8359fabc728af9a4ea45766714399792344af94b09037d52d0b0` |

### Models

| model | path | SHA-256 |
|---|---|---|
| OLMoE-1B-7B Q4_K_M | `/data/local/tmp/s3oracle/OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf` | `3bd9ec48045f526508956ef663c5c11dbb3ef791a06f4e10a6be88379c40e1fe` |
| LFM2.5-8B-A1B-KEXP | `/data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf` | `b07c80870f8a864549f4a419ccbfb4d4282ba2d55a2e8d808b7c377d3fc6c3f4` |

## Protocol (exploratory, locked hygiene)

- Screen: `screen_off_timeout=900000` (15 min, sized to 10 min cap), brightness 128.
- Awake grep only (`mWakefulness=`). No full `dumpsys power`.
- Battery: header grep only (`USB/AC/Wireless powered`, `level`, `temperature`, `Charge counter`). Plugged is expected.
- Cooldown between blocks: ≤35.0 °C or 10 min timeout → warm-start flag, run anyway.
- Cell cap 10 min: wait, exclude if rc=0 and wall≥10 min; never SIGTERM. 15 min still running → session STOP.
- MemAvailable drop ≥ 2.0 GiB in one cell → abort that model’s remaining cells.
- Raw probe archives under `probes/`, not hand transcriptions.
- `runs.csv` column discipline matches `results/kexp_speed_s23/runs.csv` plus `backend` and `sha_vulkan`.

## Results

### Step 1 — Vulkan sanity

Device: `Adreno (TM) 740`, `uma=1 fp16=1 bf16=0 warp=64 shmem=32768 int_dot=0 matrix cores: none`.

**Execute is not the support table.** `support` mode lists q2_K/q3_K/q4_K MUL_MAT_ID as SUPPORTED. The first real dispatch of those pipelines throws `vk::SystemError` / `createComputePipeline: ErrorUnknown` and the process dies rc 134.

| suite | mode | rc | totals / abort pipeline |
|---|---|---:|---|
| MUL_MAT_ID | support | 0 | q2_K 5 SUP / 0 not; q3_K 5/0; q4_K 82/0; q4_0 73/1; f16 80/0 |
| MUL_MAT_ID | test (full) | 134 | f16 ID OK, abort `matmul_id_subgroup_q4_0_f32_f16acc_aligned_s` |
| MUL_MAT_ID | test `type_a=q4_K` | 134 | abort `matmul_id_subgroup_q4_k_f32_f16acc_aligned_s` |
| MUL_MAT_ID | test `type_a=q2_K` | 134 | abort `matmul_id_subgroup_q2_k_f32_f16acc_aligned_s` |
| MUL_MAT_ID | test `type_a=q3_K` | 134 | abort `matmul_id_subgroup_q3_k_f32_f16acc_aligned_s` |
| MUL_MAT | support | 0 | q2_K 11/0; q3_K 11/0; q4_K 42 SUP / 36 not; f16 242/28 |
| MUL_MAT | test `type_a=q4_K` | 134 | abort `mul_mat_vec_q4_k_f32_f32` |
| MUL_MAT | test `type_a=f16` | 0 | **242/242 passed** |
| llama-bench OLMoE ngl 99 n=8 | smoke | 134 | abort at decode on `mul_mat_vec_q4_k_f32_f32` |

Raw: `sanity/`. SHA of those files in `evidence_sha256.txt`.

### Step 2 — OLMoE tg512 V vs O

**SKIP.** Vulkan cannot create the Q4_K GEMV pipeline used by OLMoE Q4_K_M at ngl 99. No VOOV bag. `runs.csv` has header only (KEXP columns + `backend` + `sha_vulkan`), zero rows.

### Step 3 — KEXP tg512 V vs O

**SKIP.** Vulkan MUL_MAT_ID q2_K and q3_K abort on subgroup `matmul_id` pipelines. OpenCL on this device/head dispatches those kernels (barrier-verify). That asymmetry is the dossier point.

### Ratios

**Not estimable.** No complete V cell, therefore no V/O ratio and no per-block ratios. Do not compare any plugged OpenCL-only number from this session to unplugged sessions; none were collected here anyway.
