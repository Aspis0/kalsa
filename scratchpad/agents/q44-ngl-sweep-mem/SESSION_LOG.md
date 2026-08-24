# q44 SESSION_LOG — S23 ngl sweep + live memory accounting

Protocol: `scratchpad/agents/q44-ngl-sweep-mem/PREREG.md` locked at commit `2ae386ae`.
Device serial: `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` (always `-s` this; never the Jelly Star).
adb: `C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe`

All timestamps UTC unless noted.

## 2026-08-24T03:50Z — session start / binary identification

- `adb devices -l`: S23 `SM_S911U` / `dm1q` on the TLS serial; Jelly Star also attached — ignored.
- Battery at probe: level=100, temperature=273 (27.3 °C), AC/USB/Wireless/Dock powered=false. Unplugged declared.
- `/data` avail 22G (`df -h /data`).
- No `llama` process running.

### #18 n5 pins (PC `results/kexp_speed_s23/n5/MANIFEST.md` + `sha_session_start.txt`)

| artifact | sha256 |
|---|---|
| llama-bench stub | `b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c` |
| libllama-bench-impl.so | `8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807` |
| libggml-opencl.so | `f432548328af0429fd0f885ccde70cae69f40666118836c713491602dedd6d6d` |
| libllama.so | `f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d` |
| libggml.so | `3f07bb31e79da8698635286a1a39dd2f21836e32dff9bdf578a1cce01351fb27` |
| libggml-base.so | `ed6bba3bd2f539ad044e1cb3ddabae12807bbaa698fbfd41b97e3c9a7f91e85c` |
| libggml-cpu.so | `fd9cb4b1f49c60a64eea964a4c19200c2878b74df450bc287cbbe6fdf8dcb0da` |
| libllama-common.so | `e58ece316ea0d8f829b748c8b663ac2bc2b53e66272c22f530291fd06a0a5200` |
| LFM2.5-8B-A1B-KEXP.gguf | `b07c80870f8a864549f4a419ccbfb4d4282ba2d55a2e8d808b7c377d3fc6c3f4` |

#18 cell wrapper: `/data/local/tmp/s3oracle` (`one_cell_n5.sh`). Flags: `-nr -fa off -t 4`. Thread count **verified** `-t 4` (not guessed).

### On-device sha256 (`sha256sum` in `/data/local/tmp/s3oracle`)

Exact match on stub + all seven `.so` listed above. **Chosen binary:** `/data/local/tmp/s3oracle/llama-bench` + `LD_LIBRARY_PATH=/data/local/tmp/s3oracle`.

### Model sha256 (on-device)

`b07c80870f8a864549f4a419ccbfb4d4282ba2d55a2e8d808b7c377d3fc6c3f4  /data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf` — MATCH pin. Size 3326160384 B.

### Other candidate dirs present (not used)

`bmoe`, `k22`, `k2ref`, `lineup_abs`, `s3fix`, `s3base`, `kalsaio`, `kalsahtp`, `s15vk`, `s18stock`, `s3printf`. s3oracle matched the documented #18 pin so no fallback.

### llama-bench help (device)

`-p` default 512, `-n` default 128, `-nr/--no-repack`, `-t/--threads`, `-fa on|off|auto`. Sweep invocation: `-ngl <p> -nr -fa off -t 4 -p 512 -n 128 -r 1 -o jsonl`.
`GGML_OPENCL_LOG_ALLOC=1` **set** for this accounting cell (payload = `OPENCL_ALLOC{...}` lines on stderr). Unset in #18 speed cells; this cell is not a speed-ship cell.

### KGSL

`/sys/class/kgsl/kgsl-3d0/` readable. `/sys/class/kgsl/kgsl-3d0/proc` absent at idle (expected; sampler will probe per-pid when bench is alive).

### nproc in adb shell

`nproc` = 7 (S23 is 8 cores). cpuset/`Cpus_allowed_list` of the bench pid is a **mandatory** per-point column.

## 2026-08-24T03:57Z — driver v1 launch

- LF-only `driver.sh` (13787 B, CR=0 on device after `tr -d '\r'`).
- `nohup` via `launch.sh`, wrapper pid 15556.
- Verified started: STATUS `RUNNING ngl=0`, log growing, llama-bench pid 15630, cpuset `/`, `Cpus_allowed_list: 0-7`.
- Sampler live (~1 Hz, slightly slower because mksh parses `/proc/meminfo`).

## 2026-08-24T04:00Z — ngl 0 SMOKE PASS

- rc=0, sampler 37 samples (>=30). Wall ~03:58:01–04:00:30.
- stdout jsonl (exploratory): pp512 24.961 t/s; tg128 13.290 t/s. `n_threads=4`, `no_repack=true`, `n_gpu_layers=0`.
- stderr: OpenCL Adreno 740 + `OPENCL_ALLOC` Adreno prealloc sum_mib=753.69 even at ngl 0. **No** `load_tensors: offloaded X/N` line without `-v`.
- cpuset `/` (mandatory gate captured).
- Battery gate: level 100, temp10=268 (26.8 °C).

## 2026-08-24T04:01Z — first N parse STOP (harness bug, recovered)

- Driver probed ngl 1 without `-v`; still no offload line → `STOP cannot_parse_N`.
- Continue driver with `-v` probe: captured `load_tensors: offloaded 1/25 layers to GPU` into `offload_line_raw.txt`, but `N=$(probe_N)` swallowed `log()` stdout so N parsed as 0 → second `STOP cannot_parse_N`.
- Engine line is the payload: **N=25**.

## 2026-08-24T04:08Z — continue driver v3 (N from file)

- Read N from `offload_line_raw.txt` (never from function stdout). N=25.
- Mapping: `-ngl {0, ceil(25/4)=7, ceil(25/2)=13, ceil(3*25/4)=19, 99}`.
- ngl 0 not re-run. Remaining points use `-v` so each stderr has `offloaded X/N`.
- pid 18091, cooldown 180 s then ngl 7. Battery 99 %, temp10=281, unplugged.
- Snapshot of ngl0 pulled to `results/ngl_sweep_s23/device_snap_ngl0/` before continue overwrote session-start dumps.

Sweep now unattended on device. PC polls; driver survives adb/PC sleep.

## 2026-08-24T04:17Z–04:57Z — remaining points

| ngl | launch UTC | rc | samples | offloaded |
|---:|---|---:|---:|---|
| 7 | 04:17:17 | 0 | 47 | 7/25 |
| 13 | 04:28:53 | 0 | 61 | 13/25 |
| 19 | 04:42:34 | 0 | 48 | 19/25 |
| 99 | 04:54:30 | 0 | 44 | 25/25 |

All cool-start PASS (temp10 273–282). Cooldown wall ~8 min (sleep slack) but ≥180 s counted. Battery 100→96 %, unplugged, peak post temp 30.9 °C. No STOP. STATUS `DONE` at 04:57:36Z. Driver pid 18091. No leftover llama.

Pulled 136 files (994120 B) → `results/ngl_sweep_s23/device/kalsa_q44/`. MANIFEST sha256 PC-side in `results/ngl_sweep_s23/MANIFEST.md`. REPORT written.

k_set (ΔMA / OPENCL_SET_TENSOR bytes): 1.74, 1.43, 1.27, 1.05 at ngl 7/13/19/99. Not linear. See REPORT.md.

## Phase 2 next

Batt 96 % ≥ 40 %, temp 28.3 °C ≤ 35.0 °C, unplugged. Sweep wins if we had to choose; we do not. Starting B-prime Q8_0-trunk HTP smoke after the pull.

## PHASE 2 — B-prime Q8_0-trunk HTP smoke v73

- Space: 22G free, 6.5 GB file. **No deletions.**
- Push 6509642624 B in 351.6 s (17.7 MB/s) → `/data/local/tmp/Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf`.
- On-device sha256 `bd63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419` MATCH pin.
- kalsahtp binaries match v73 MANIFEST (`llama-bench` `5db18906…` @ 3f545be, `libggml-htp-v73.so` `c8f9d14a…`).
- Env: NDEV=1 VERBOSE=1 HOSTBUF **unset** (v73 llama-bench working path, not test-backend-ops HOSTBUF=1).
- Battery at launch: 94 % unplugged, 30.1 °C. Cool-start PASS.

### Attempt 1 (nohup via phase2_launch.sh, pid 1425)

05:16:34Z start. Model sha re-verified. (a) launched 05:17:19Z. adb later `error: closed`; reconnect. Driver dead, llama gone. stderr 196051 B stops at `load_all_data` dots. 0 execute-op. No rc.

### Attempt 2 (`setsid` + nohup, pid 16748)

06:49:32Z start (PC had been asleep; device-side relaunch). Same cool-start PASS (91 %, 25.7 °C). Same death, **same 196051 B stderr**, still 0 execute-op, driver_dead after 10+ min wait. No third try.

Load-time split recorded: CPU 5995.65 MiB (experts) / HTP0-REPACK 178.50 MiB (Q8_0 trunk attn). `init-tensor` of `attn_q/k/v/output` on HTP0. `offloaded 29/29`. Generation never ran.

(b) skipped. GGUF left on device. Pulled to `results/htp_smoke/s23_v73_bprime/`. No git add/commit/push. Did not touch BigMoeOnEdge/.



