# EXPLORATORY — Mellum2 GPU-MoE vs CPU-MoE speed cell (S23)

**Label: EXPLORATORY.** Indicative / feasibility only. Not a pre-registered ship cell.

## Device / build

- Device: Galaxy S23 SM_S911U Adreno 740. Serial used: `192.168.1.152:5555` (pre-reboot), then `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` (post-reboot TLS, port 42645). **Not** Jelly `192.168.1.82:39591`.
- Dir: `/data/local/tmp/s3oracle`. `s3base`/`s3fix`/`s3printf` UNTOUCHED.
- llama.cpp: `c1bb48d32` (`kalsakernel-v3`) `kalsa/kernel-s3-repack`
- `libggml-opencl.so` sha **PC==device:** `a09ef68f6e4e0f8d0f778c9e4c9310780d57fbd4f891ff366dff49a7a7e502da`
- `llama-bench` stub `b2ae0fa6c413a504…` + `libllama-bench-impl.so` `bad179520546f8d5…` (built in `build-android-opencl-s3oracle` after enabling `LLAMA_BUILD_TOOLS=ON`; ggml commit `c1bb48d32`). OpenCL .so sha **unchanged** across that rebuild.
- Model: `Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf` 8071293600 B (7.52 GiB). sha256 **PC==device:** `b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7`

## Expert-placement mechanism in tree (c1bb48d32)

Both exist in `tools/llama-bench/llama-bench.cpp`:

- `-ncmoe, --n-cpu-moe N` (preferred for Arm B): for i in 0..N-1 pushes `llm_ffn_exps_block_regex(i)` = `blk\.{i}\.ffn_(up|down|gate|gate_up)_(ch|)exps` onto `ggml_backend_cpu_buffer_type()`.
- `-ot, --override-tensor <pattern>=<buffer type>;...` (semicolon between overrides). Buffer type name must match `ggml_backend_buft_name` (CPU is `CPU`).

Arm B would have been `-ngl N -ncmoe N` (same N as Arm A). **Never reached:** probe Arm A `-ngl 8` rebooted the phone.

## Unplug gate (before first run)

`dumpsys battery`: AC/USB/Wireless powered **false**, `status: 3` (discharging), level 100, temperature 301 (30.1 °C). Screen `mWakefulness=Dozing` (held constant; not woken). `/proc/self/cpuset` = `/`. HOST_REPACK/DUMP_Q/ORACLE/MOE_OPTS/CVT_OPTS unset.

## Probe 1 — ngl 8 (original)

`probe_ngl8.sh`: `llama-bench -ngl 8 -p 32 -n 16 -r 1 -t 4 -o csv`, `GGML_OPENCL_LOG_KERNELS=1`. stderr = 3-line OpenCL device banner (209 B), then **reboot** (`uptime` 1 min at 23:17; `ro.boot.bootreason=reboot`). MemAvailable poll 3548–4738 MB, still high. No CSV.

## Authorized retry — ngl 2 (HARD STOP)

Pre-flight (uptime 4 min, post-reboot-1): `.so` and GGUF re-sha **match**, unplugged status 3, temp 30.8 °C. Then Arm A `llama-bench -ngl 2 -p 0 -n 64 -r 1 -t 4`. stderr **identical 209 B banner**. Mem poll 28 s: 4111 MB → ~4.8 GB reclaim → cliff to **450 MB** → **second reboot** (`uptime` 0 min at 23:22, TLS port 42645→34909). Temp after 36.4 °C (under 40 °C stop). `.so` still `a09ef68f`.

**HARD STOP (a):** second reboot at any `-ngl` → cell terminated. No Arm B, no ngl 1, no further GPU-experts tonight. Verdict **BLOCKED_DRIVER**.

Plugged-history: USB 85→100 % until ~23:01, then unplug.
