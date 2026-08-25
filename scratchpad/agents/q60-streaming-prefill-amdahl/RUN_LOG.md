# q60 streaming-MoE prefill — Jelly CPU-only measurement

## Session start / inventory

- PREREG lock: `14b23056`.
- Device target: Jelly only, adb serial `192.168.1.82:34037`; mDNS service `adb-JELLYS0000053795-UFuN1D`, `_adb-tls-connect._tcp`, `192.168.1.82:34037`.
- Device identity: `Jelly Star`, MediaTek `MT6789`, 8 logical CPUs.
- S23 protection: no `adb -s adb-R3CW406P8CV…` command issued.
- Power state before stay-awake: `mWakefulness=Awake`, `mStayOn=false`, `mIsPowered=false`, `mPlugType=0`, `mStayOnWhilePluggedInSetting=7`.
- Stay-awake action: `adb -s 192.168.1.82:34037 shell svc power stayon true`; setting recorded for exact restoration at session end.
- Battery inventory: AC=false, USB=false, Wireless=false, level=75%, temperature=240 tenths C (24.0 C), voltage=4072 mV, health=2.
- Memory inventory: `MemTotal=7,968,548 kB`; `MemAvailable=5,543,816 kB`.
- `/data` inventory: `df -k /data/local/tmp` available `109,947,916 kB` (54% used; mounted device path reports `/storage/emulated/0/Android/obb`).
- Resident streaming-regime MoE selected: `/data/local/tmp/Marco-Mini-Instruct.i1-Q4_K_M.gguf`, 10,505,424,704 bytes; larger than current MemAvailable; architecture is the resident Marco-Mini MoE (256 experts, native k=6 per prior device record). No model push.
- Resident llama-bench selected: `/data/local/tmp/llamabench/llama-bench`, 121,472,048 bytes; its help reports `-nr, --no-repack <0|1>` and `-lm, --load-mode <none|mmap|mlock|mmap+mlock|dio>`.
- GGUF inventory (bytes; on-device `sha256sum`):
  - `/data/local/tmp/llamabench/Qwen3.5-2B-Q4_K_M.gguf`: 1,280,835,840; `aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223`.
  - `/data/local/tmp/llamabench/Qwen3.5-2B-Q4_0.gguf`: 1,214,873,856; `cd70221bebaee0503e0f6717e174250cd7825aa88438b3aabec9ad55731d9bb1`.
  - `/data/local/tmp/llamabench/Qwen3.5-4B-Q4_K_M.gguf`: 2,834,975,040; `3874209241c9a397e2f62cd3f70f80fd2dfbf0dfccb6838416bdb48a714e8630`.
  - `/data/local/tmp/llamabench/LFM2.5-2.6B-Q4_K_M.gguf`: 1,674,454,848; `79fdf00351b46cf26f020aead28d01889886be87c55fa0eb907e6f9b00bfee14`.
  - `/data/local/tmp/llamabench/LFM2.5-1.2B-Instruct-Q4_K_M.gguf`: 730,895,168; `b1b3de114215d9507409a662a501a631095a479a419584e8a2ded6304b19b4f5`.
  - `/data/local/tmp/llamabench/LFM2.5-2.6B-QAD-Q4_0.gguf`: 1,593,894,944; `a247afd6414918eac8e520e9a6137dc271235461ecbe1180462221d5b8d40b03`.
  - `/data/local/tmp/LFM2.5-8B-A1B-Q4_K_M.gguf`: 5,155,564,768; `4923ec14f06b968b74d663e5949867d2d9c3bf13a20b8be1a9f9af39989b2bb0`.
  - `/data/local/tmp/Marco-Mini-Instruct.i1-Q4_K_M.gguf`: 10,505,424,704; `a001d324b6edc6a797009fbe6eb94a52a9f32453ee8d06465409875f3e3a6dbc`.
  - `/data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf`: 3,326,160,384; `9638a381f31fab658af2c8926181d8ced432c4179139904aefc648d75d8d84fd`.
- llama-bench inventory (bytes; on-device `sha256sum`): selected `/data/local/tmp/llamabench/llama-bench`, 121,472,048, `c61b2457f66419677a411f93bbadd6c15a43235fd905013b59eadcdf70a733a4`, supports `-nr` and `-lm mmap`. Other discovered binaries: `llamabench-vk/llama-bench` 159,329,952 (`ac41368525404f7eea95098424ad20eb177a4536e091c37e88870722ac245b29`); `llamabench-aff/llama-bench` 121,458,184 (`450f945d7e250e0e42ae8882fcb3990cdad2b0a487bb5e404ebc4ea40d159566`); `llamabench-kai/baseline/llama-bench` 121,450,152 (`8d3e289dcb7286c060cbd2b7cb58f2bb3deb020ece5b1c2d307efc5f23e47758`); `llamabench-kai/kleidi/llama-bench` 121,815,920 (`4486f2d78f6e0b2ba44c45fe274f46f1ddb780d4bcffe5d44947db821419ff7a`); `kalsa26/vk/llama-bench` 7,592 (`b4e9476ee03f270c85d0e9eb2dd578089756075d131dd058456bb039182c7b21`); `kalsa26/ocl2/llama-bench` 7,568 (`e3ab93f14d88bf9e6509cff5ddb6cdf17cb389ffc3526c4ff19588a0d1aab0e9`).
- Guard local SHA-256: `thermal_guard.sh` `f8b664194d7eae7d04ebb3bba8745769cbd79777796803d25eed7974e9bda84c`; `launch_with_guard.py` `64ef5fb808b7bd2784555b54db3c395aecd1d85021e568c948d1f07b7f783b40`; local LF check found no CR bytes. Pushed guard device SHA matches `f8b664194d7eae7d04ebb3bba8745769cbd79777796803d25eed7974e9bda84c`; device has `/system/bin/timeout`.

## Guard / measurement timeline

- Guard T2 attempt 1 (`q60_t2_20260825_1`): guard READY/TRACKING/MAX, exit 0, max 26.0 C, sensor parser produced numeric current-block temperature/level; workload rc=1 solely because this binary rejected `-fa off` (`invalid parameter for argument: off`). Not counted as pass-through. No measured q60 run started.
- Guard T2 attempt 2 (`q60_t2_20260825_2`): same guard behavior, but workload rc=1 because this binary requires the explicit value for `-nr` (`invalid parameter for argument: -nr`). Not counted as pass-through. No measured q60 run started.
- Pending: corrected 30-second T2-style pass-through with `-nr 1`; flash-attention flag omitted because it is not part of the locked q60 requirements and the selected binary rejects the advertised `off` value.
- Guard T2 attempt 3 (`q60_t2_20260825_3`): PASS; workload/guard/launcher rc=0, guard READY/TRACKING/MAX, current-block numeric samples, max 27.0 C, no HTP evidence.
- pp128 run `q60_pp128_20260825_1`: guarded `llama-bench -m /data/local/tmp/Marco-Mini-Instruct.i1-Q4_K_M.gguf -p 128 -n 0 -r 3 --no-warmup -t 8 -o jsonl -ngl 0 -lm mmap -nr 1`; launcher/workload/guard rc=0; JSONL walls 15.265489231, 14.882078770, 14.882993232 s; sampler attached to binary PID 21797 and pulled as `q60_pp128_20260825_1.all.csv`; guard max 28.0 C.
- pp512 run `q60_pp512_20260825_1`: same guarded flags with `-p 512`; launcher/workload/guard rc=0; JSONL walls 23.918512079, 23.194683694, 24.592361463 s; sampler attached to binary PID 23218 and pulled as `q60_pp512_20260825_1.all.csv`; guard max 30.0 C. `/proc/pressure/io` was not readable from the sampler context (all PSI CSV fields `NA`).
- pp2048 run `q60_pp2048_20260825_1`: same guarded flags with `-p 2048`; launcher/workload/guard rc=0; JSONL walls 103.320454775, 116.701618699, 147.049400086 s; sampler attached to binary PID 25321 and pulled as `q60_pp2048_20260825_1.all.csv`; guard max 36.0 C; wall until launcher poll end 384.002 s. `/proc/pressure/io` was not readable from the sampler context.
- Cold-cache method: no unrelated file >= MemTotal was available. pp512 and pp2048 were each preceded by an explicit 30 s relaunch-after-cooldown; pp128 followed inventory/guard setup. Rep1 is cold-designated and reps2-3 warm within each `-r 3` process. The required inventory sha256sum read the selected model before measurement, so the cold designation is not an empty-page-cache guarantee and is reported separately as a limitation.

## Derived numbers

| n | rep | cache | wall_s | compute_share | io_share | read_MB | MB/s | majflt |
|---:|---:|---|---:|---:|---:|---:|---:|---:|
| 128 | 1 | cold-designated | 15.265489 | 0.193901 | 0.806099 | 12719.149 | 833.196 | 40647 |
| 128 | 2 | warm | 14.882079 | 0.600891 | 0.399109 | 9437.143 | 634.128 | 178482 |
| 128 | 3 | warm | 14.882993 | 0.599846 | 0.400154 | 9444.962 | 634.614 | 176033 |
| 512 | 1 | cold-designated | 23.918512 | 0.412599 | 0.587401 | 14119.940 | 590.335 | 30311 |
| 512 | 2 | warm | 23.194684 | 0.764884 | 0.235116 | 8372.535 | 360.968 | 59777 |
| 512 | 3 | warm | 24.592361 | 0.788710 | 0.211290 | 9240.158 | 375.733 | 63456 |
| 2048 | 1 | cold-designated | 103.320455 | 0.693123 | 0.306877 | 41093.218 | 397.726 | 215969 |
| 2048 | 2 | warm | 116.701619 | 0.761493 | 0.238507 | 38151.791 | 326.917 | 226507 |
| 2048 | 3 | warm | 147.049400 | 0.782509 | 0.217491 | 38232.932 | 260.001 | 165723 |

- pp512 warm compute_share mean=0.776797; median=0.788710.
- Frozen rule outcome: `GO as phase 2 of the HVX K-quant project (NPU-for-streaming ceiling >=2x)`.
- Guard maxima: pp128=28.0 C; pp512=30.0 C; pp2048=36.0 C.
- Anomalies: `/proc/pressure/io` unreadable (`NA` in every sampler row); `-fa off` rejected and `-nr` required explicit `1`; no unrelated >=MemTotal eviction file existed; inventory hashing warmed the selected model before cold-designated reps.

## Session end

- Wake restoration: `settings put global stay_on_while_plugged_in 7`; verified value `7`, matching the pre-session `mStayOnWhilePluggedInSetting=7` while unplugged `mStayOn=false`.
- Final Jelly battery: AC=false, USB=false, Wireless=false, level=65%, temperature=340 tenths C (34.0 C), voltage=3977 mV.
- Residual-process checks for `llama-bench`, `thermal_guard`, and `q60_sampler`: no matches.
