# S0 REPORT — MoE GPU spike Xiaomi 14 (houji / 23127PN0CG)

**Date**: 2026-08-11  
**Device**: Xiaomi 14 SM8650 Adreno 750, Android 16 / HyperOS, unplugged  
**adb**: `adb-625689a2-9xEOfw._adb-tls-connect._tcp`  
**Pin**: `5236140e514d5ceef2b801815b3ba9330f19732e` (`5236140e5`)  
**Channel**: `run-as com.termux` adb (NOT ssh — deliberate deviation)

## Battery
| moment | level | temp (°C) | plugged |
|---|---|---|---|
| S0 start | 89% | 33.9 | false (USB powered: false) |
| after OpenCL build | 86% | 38.9 | false |
| S0 end (B1 gate) | 82% | 34.6 | false |

Floor 40% never approached. No abort.

## 0. Inventory checklist (S0)
| item | status | evidence |
|---|---|---|
| Termux app | present, versionName=0.118.3 (versionCode=1002) | `pm dump com.termux` |
| Termux:API APK | present, versionName=0.53.0 (versionCode=1002), firstInstall 2026-08-11 | `pm dump com.termux.api` |
| dpkg `termux-api` | **NOT installed** (`un`); no `termux-battery-status` / `termux-notification` CLI | `dpkg -l termux-api` |
| TERMUX_API_VERSION | **NA** (no `$PREFIX/libexec/termux-api-package-version`) | inventory_checklist.txt |
| Termux:API usable helpers | limited; core binaries only (`termux-wake-lock`, `termux-info`, `termux-setup-storage`, …) — not the full API surface | `ls $PREFIX/bin/termux-*` |
| Termux:Boot | APK **installed** (0.8.1 / 1000) but `enabled=0`, `stopped=true`, `notLaunched=true` → **NOT operational / treat as unused** | `dumpsys package com.termux.boot` |
| sshd | binary present (`openssh 10.4p1`), host keys under `$PREFIX/etc/ssh`, **process not running** | `command -v sshd`; `pgrep -a sshd` empty |
| ssh channel | **NOT used** — campaign ran via `run-as com.termux` adb only (deviation) | this report §channel |
| disk space (post-S0) | `/data`: 482G total, 142G used, **339G free**, 30% | `df -h /data \| tail -1` → logs/disk_space.txt |
| disk before/after | only post-S0 snapshot available; models ~9.8 GB under `$HOME/models` | models listing |
| termux-info | captured | logs/termux_info.txt |

Full checklist artifact: `results/gpu_xiaomi/logs/inventory_checklist.txt`.

## 1. Packages
openssl recovered via `dpkg --force-confdef --force-confold --configure -a` (was `iU` after interactive openssl.cnf prompt).

Installed OK (all `ii`):
- git 2.55.0, cmake 4.4.2, ninja 1.13.2, clang 21.1.8
- opencl-headers 2026.05.29, ocl-icd 2.3.5, clinfo 3.0.25.02.14
- vulkan-headers 1.4.359, vulkan-loader 0.0.3, shaderc 2026.3, glslang 16.5.0
- spirv-headers 1.4.357.0 (added later for Vulkan cmake), python 3.14.6, openssh 10.4p1

## 2. Survival (HyperOS M2)
| action | result |
|---|---|
| `cmd appops set com.termux RUN_IN_BACKGROUND allow` | OK (`RUN_IN_BACKGROUND: allow`) |
| `dumpsys deviceidle whitelist +com.termux` | OK (`Added: com.termux`) — did NOT need root |
| `termux-wake-lock` | OK (binary present; ran) |
| `screen_off_timeout` | agent set / reaffirmed **1800000** (30 min) for lab discipline. RESTORE at session end. |
| storage perms | POST_NOTIFICATIONS granted=true; SELinux still blocks run-as from /sdcard |

### Restore verified
Captured post-session via:
```
adb -s adb-625689a2-9xEOfw._adb-tls-connect._tcp shell "settings get system screen_off_timeout; cmd appops get com.termux RUN_IN_BACKGROUND; dumpsys deviceidle whitelist | grep termux"
```
Output (artifact: `results/gpu_xiaomi/logs/restore_verified.txt`):
```
60000
RUN_IN_BACKGROUND: allow
user,com.termux,10649
```

Honest restore note:
- Agent mandate value for lab discipline: `screen_off_timeout=1800000` (artifact `screen_timeout.txt` still records that lab value).
- Orchestrator restored to **60000 (60 s)** — a sensible daily-phone value for the unplugged personal device.
- `RUN_IN_BACKGROUND: allow` and deviceidle whitelist entry for `com.termux` remain in place (not reverted).
- Do **not** treat 60000 as a failed restore of 1800000; it is the intentional daily-phone restore.

## 3. Probe — CPU capacity → `-t`
```
cpu0 capacity=379  max_freq=2265600
cpu1 capacity=379  max_freq=2265600
cpu2 capacity=923  max_freq=3148800
cpu3 capacity=923  max_freq=3148800
cpu4 capacity=923  max_freq=3148800
cpu5 capacity=867  max_freq=2956800
cpu6 capacity=867  max_freq=2956800
cpu7 capacity=1024 max_freq=3302400
```
max=1024; 50% threshold=512. Cores >512: cpu2..cpu7 → **n_threads = 6**. Confirmed G99-style.
Layout: 2+3+2+1 (little/mid/mid-high/prime).

## 4. Probe — thermal zones
- All thermal zones world-readable from u0_a649. Full table: `results/gpu_xiaomi/thermal_zones_snapshot.txt` (102 zones).
- Key zones: cpuss-0 (zone1), cpu_therm (zone57), gpuss-* (32-39), battery (zone75).

## 5. Build OpenCL — DONE
cmake flags: GGML_OPENCL=ON, GGML_VULKAN=OFF, GGML_NATIVE=OFF, GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16, LLAMA_CURL=OFF, Release, GGML_OPENCL_USE_ADRENO_KERNELS=ON.
Note: flag name is GGML_OPENCL_USE_ADRENO_KERNELS (not GGML_OPENCL_USE_ADRENO).
Binary: ~/llama.cpp/build-opencl/bin/llama-bench present.

Thermal (from `logs/thermal_opencl.log`, millidegC → °C):
| timestamp | event | max die °C |
|---|---|---:|
| 00:18:58 | build start sample | 36.1 |
| 00:19:58 | peak under `-j8` | **84.4** |
| 00:20:59 | post-peak | 74.6 |
| 00:22:06 | cool_poll (after kill) | 75.8 |
| 00:22:40 | cool_poll | **71.9** |
| 00:23:54 | RESUME_j4 | 49.1 |

**Max recorded die = 84.4°C** (log line `max=84400`). There was **no 88°C peak** in the log; any earlier prose citing ~88°C was wrong.

The orchestrator steer killed `-j8` **conservatively**, not because a hard threshold was crossed. The relaxation rule (≥85°C sustained >5 min) was **not** crossed (peak 84.4°C, single sample, then falling). Steer was over-conservative. Resume at `-j4` after cool-down to 49.1°C → BUILD_EXIT=0.

OpenCL backend note (gate-relevant): `logs/build_opencl.log:430` emits
`TODO: implement BF16, Q4_0, Q4_1, Q5_0, Q5_1, Q8_0, IQ4_NL support` — so **Q8_0 is not implemented** in this pinned OpenCL backend.

## 6. Build Vulkan — FAILED
shaderc: Invalid capability operand: 5447 on flash_attn_cm2 cooperative-matrix shaders.
CMAKE configured after spirv-headers + CMAKE_PREFIX_PATH. Build stopped. No llama-bench-vulkan.

Wrapper log ends with `BUILD_EXIT=0` **despite** Ninja failure:
```
shaderc: internal error: ... Invalid capability operand: 5447
vulkan-shaders-gen: one or more shaders failed to compile
ninja: build stopped: subcommand failed.
BUILD_EXIT=0
ls: cannot access 'build-vulkan/bin/llama-bench': No such file or directory
```

**Note (BUILD_EXIT unreliable):** The wrapper's auto-captured `BUILD_EXIT` is unreliable for build failures; the failure was detected manually from Ninja's stderr (shaderc coopmat2 capability 5447) and the absence of the `llama-bench-vulkan` / `build-vulkan/bin/llama-bench` binary. Treat any future Vulkan log with `BUILD_EXIT=0` but missing the binary as a failure.

## 7. OpenCL smoke / m1 probe — BLOCKED
Under run-as (SELinux u:r:runas_app:s0):
```
ggml_opencl: platform IDs not available.
```
Missing (never printed):
- ggml_opencl: OpenCL driver:
- ggml_opencl: vector subgroup broadcast support:
- ggml_opencl: cl_qcom_subgroup_shuffle support:

Vendor libOpenCL present at /vendor/lib64/libOpenCL.so. LD_LIBRARY_PATH=/vendor/lib64 works for resolution but clGetPlatformIDs fails under runas_app. Real Termux is untrusted_app_27. RUN_COMMAND signature-gated. ssh not set up (deviation).

**Out of scope for this fix pass:** CRITICAL m1 probe validity under run-as SELinux — user will run real-Termux smoke interactively.

## 8. Models — ALL ON DEVICE
| file | bytes | sha256 |
|---|---:|---|
| Llama-3.2-3B-Instruct-Q4_K_M.gguf | 2019377600 | 6c99cc00ae910f6a532a80022cb4bc1939094527a089c29294b841c0bd87f74d |
| Llama-3.2-3B-Instruct-UD-IQ2_XXS.gguf | 1046579648 | 71aae376aa27117203ae4311aba8733408a7caf437a7367da8067017f1e8a25d |
| Marco-Mini-Instruct.i1-IQ2_M.gguf | 5695505216 | c902bfcbec4a1c08dc57eb42dffca8de8dd84e058785ebda004e9537a4fe5b1e |
| Qwen3.5-2B-Q4_K_M.gguf | 1280835840 | aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223 |

Path: /data/data/com.termux/files/home/models/ + SHA256SUMS.txt
IQ2_XXS sha matches S23 campaign.

## 9. B1 GATE — STOP

### Dump provenance (FIX 1)
Reran on device 2026-08-11T01:02:22-04:00 under `run-as com.termux`.

Mandate command path `gguf-py/scripts/gguf_dump.py` does **not** exist in this tree; stock path is `gguf-py/gguf/scripts/gguf_dump.py` (sha256 `d8b8fc28e96d15d8a4d6f05cdff4a747f5a06f31172efee9dfc971998ed0203f`). Stock attempt EXIT=1 (`ModuleNotFoundError: numpy`). `/sdcard/Download` write denied under `u:r:runas_app`.

Working dump used the same no-deps tool as the original B1 dump:
```
python3 $HOME/logs/gguf_types_only.py $HOME/models/Marco-Mini-Instruct.i1-IQ2_M.gguf
# tool_sha256=465fd71748d8b004fe2dffaf3cab489c8d3d6df675a423968addc537117806d9
# python: Python 3.14.6
# EXIT=0
```
Artifacts:
- `results/gpu_xiaomi/logs/marco_dump_v2.txt` (header + full tensor list + `# EXIT=0`)
- `results/gpu_xiaomi/logs/marco_dump_v2.err` (`EXIT=0`)
- `results/gpu_xiaomi/logs/marco_dump_command.sh` (exact command + versions + SHAs)
- original: `results/gpu_xiaomi/logs/marco_gguf_dump.txt`

### Type counts (v2 vs original — no discrepancy)
Non-expert:
| type | count |
|---|---:|
| F32 | 141 |
| IQ2_S | 56 |
| IQ3_S | 28 |
| Q4_K | 28 |
| Q5_K | 1 |

Expert:
| type | count |
|---|---:|
| IQ2_S | 81 |
| IQ3_S | 3 |

Total tensors: 338. Types present in this model: `{F32, Q5_K, IQ2_S, IQ3_S, Q4_K}` only. No F16/BF16/Q8_0 tensors in Marco i1-IQ2_M. Cross-check vs original dump: **identical counts; no discrepancy**.

### Allowed-set (resolved for THIS spike)
Mandate allowed-set statement: `{Q4_K, Q5_K, Q6_K, F32, Q8_0}`.

Corrections for this pin/backend:
1. Dump tool type-map also knows **BF16 / F16** (and many other GGML types). Those are **not** in the mandate allowed-set; they are type-map extras, not a free pass.
2. OpenCL build log (`logs/build_opencl.log:430`) prints `TODO: implement ... Q8_0 support` → **Q8_0 is NOT safe** on this pinned OpenCL backend.

**Resolved gate allowed-set for THIS spike:** `{Q4_K, Q5_K, Q6_K, F32}`  
(Q8_0 removed as unsafe; BF16/F16 never in mandate set.)

### Verdict
```
VERDICT=STOP
BAD_TYPES: [IQ2_S, IQ3_S]
ALLOWED_SET_THIS_SPIKE: {Q4_K, Q5_K, Q6_K, F32}
```

Dense attention tensors are i-quants:
- every layer attn_q, attn_k → IQ2_S
- every layer attn_output → IQ3_S
- attn_v is Q4_K (OK); norms/gate_inp F32 (OK); embd Q5_K (OK)

OpenCL has zero IQ2/IQ3 kernels. Offload would silently fall back to CPU → S2 not interpretable. B1 STOP verdict **unaffected** by the Q8_0 tightening (bad types remain IQ2_S/IQ3_S).

Representative lines:
```
NONEXP F32        [1024]  output_norm.weight
NONEXP Q5_K       [1024, 151936]  token_embd.weight
NONEXP IQ2_S      [1024, 1024]  blk.0.attn_k.weight
NONEXP IQ3_S      [2048, 1024]  blk.0.attn_output.weight
NONEXP IQ2_S      [1024, 2048]  blk.0.attn_q.weight
NONEXP Q4_K       [1024, 1024]  blk.0.attn_v.weight
EXPERT IQ3_S      [768, 1024, 256]  blk.0.ffn_down_exps.weight
EXPERT IQ2_S      [1024, 768, 256]  blk.0.ffn_gate_exps.weight
EXPERT IQ2_S      [1024, 768, 256]  blk.0.ffn_up_exps.weight
```

## 10. Deviations
1. ssh not used — adb run-as only (sshd installed but not running)
2. OpenCL m1 probe lines missing (SELinux runas_app) — CRITICAL, out of scope here
3. Vulkan build failed (shaderc coopmat2 5447); wrapper BUILD_EXIT=0 is unreliable
4. One thermal kill under `-j8` at peak **84.4°C** (over-conservative steer; ≥85°C/5 min rule not crossed); resume `-j4`
5. CMake flag name GGML_OPENCL_USE_ADRENO_KERNELS
6. B1 STOP — S2 not started
7. Mandate `gguf_dump.py` path + numpy missing; used `gguf_types_only.py` with full provenance
8. screen_off_timeout restored by orchestrator to 60000 (daily-phone), not 1800000
9. Termux:Boot APK present but disabled/not launched; dpkg termux-api absent

## 11. STOP decision
S0 stops at B1. Do not dispatch S2/S3 on Marco i1-IQ2_M until dense requant or different quant.
S1 (dense 3B Q4_K_M) possible only after OpenCL platform init works in real Termux context.
Gate for any future quant on this OpenCL pin: dense tensors ⊆ `{Q4_K, Q5_K, Q6_K, F32}`.
