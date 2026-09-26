# S23 diagnostic command record

Device: `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` (adb server 5037).
All paths are relative to `scratchpad/agents/qdc-heat-3way/raw/s23-app-stutter-20260926/`.
Each command was logged as `command > log 2>&1; echo EXIT=$?`; per-command
exit statuses are in `commands.log` and the named output files.

## Preflight and idle app checks

```sh
/opt/homebrew/bin/adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell ps -A | grep -E 'llama|bench' > preflight/llama_processes.log 2>&1; echo EXIT=1
/opt/homebrew/bin/adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell dumpsys battery > preflight/battery.log 2>&1; echo EXIT=0
/opt/homebrew/bin/adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell dumpsys thermalservice > preflight/thermal.log 2>&1; echo EXIT=0
/opt/homebrew/bin/adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell getprop persist.traced.enable > preflight/traced.log 2>&1; echo EXIT=0
/opt/homebrew/bin/adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell settings get system screen_off_timeout > preflight/screen_settings.log 2>&1; echo EXIT=0
```

For each cold start, the recorded sequence was `am force-stop com.kalsa.app`,
`dumpsys gfxinfo com.kalsa.app reset`, `log -t S23_STUTTER_DIAG coldN_launch`,
`monkey -p com.kalsa.app 1`, `pidof com.kalsa.app`, then
`top -H -b -n 6 -d 5 -p <pid>`, `dumpsys gfxinfo com.kalsa.app`,
`logcat -d -v threadtime`, and before/after `dumpsys power`. Outputs are
`runN_{force_stop,gfx_reset,marker,launch,pid,top,gfxinfo,load_logcat,power_before,power_after}.log`.
The full logcat dumps were filtered by the cold-start PID for the retained
model-load/prewarm logs.

## CPU completion sequence

Before and after each complete run, the commands captured were
`dumpsys power`, `dumpsys battery`, `dumpsys thermalservice`, and
`cat /sys/devices/system/cpu/cpu7/cpufreq/scaling_cur_freq`; matching logs
are named `run*_power_*`, `run*_battery_*`, `run*_thermal_*`, and
`run*_cpu7_freq_*`. A persistent host loop sent
`adb shell input keyevent KEYCODE_WAKEUP` every 4 s; every wake exit and UTC
timestamp is in `cpu-decode/wake_keepalive.log` (maximum observed gap: 5 s).

The remote `llama-completion` command was the arm command with its backend
set to CPU and `-n 64`; A/B flags differed only by `--poll 1000`:

```sh
cd /data/local/tmp/heat3way
export LD_LIBRARY_PATH=/data/local/tmp/heat3way/lib ADSP_LIBRARY_PATH=/data/local/tmp/heat3way/lib GGML_HEXAGON_NDEV=1 GGML_HEXAGON_VERBOSE=1 GGML_OPENCL_LOG_KERNELS=1
printf 'CPUSET='; cat /proc/self/cpuset
exec ./bin/llama-completion -m ship.gguf -lm none -f prompt.txt -n 64 --ignore-eos --seed 1 --temp 0 -c 2048 -b 2048 -ub 1024 -t 8 -fa 1 --no-warmup --perf --simple-io --no-display-prompt [--poll 1000] -ngl 0
```

Runs: A1 `runA_valid1.log` (exit 0); B1 `runB_valid1.log` (exit 0);
A2 `runA2.log` (exit 0); B2 `runB2.log` (exit 0). `adb shell -t` was used
to allow sending EOF after the interactive completion prompt; the binary had
finished its 64-token budget and printed its perf summary before exit. The
two earlier attempts (`runA1.log`, `runB1.log`) are retained as invalid:
the detached wake loop had exited, so they were interrupted and excluded.

## CPU-only llama-bench and restore

```sh
cd /data/local/tmp/heat3way
export LD_LIBRARY_PATH=/data/local/tmp/heat3way/lib ADSP_LIBRARY_PATH=/data/local/tmp/heat3way/lib GGML_HEXAGON_NDEV=1 GGML_HEXAGON_VERBOSE=1 GGML_OPENCL_LOG_KERNELS=1
printf 'CPUSET='; cat /proc/self/cpuset
exec ./bin/llama-bench -m ship.gguf -ngl 0 -t 8 --poll 1000 -fa 1 -p 0 -n 64 -d 1018 -r 3
```

`llama_bench_cpu.log` has no result row. At the mid-run battery gate
(`bench_mid_battery.log`) the level reached 25%, so the process received
`adb shell pkill -INT -f 'llama-ben[ch]'` (exit 130); see
`bench_interrupt.log` and `bench_processes_after.log`.

Final state commands were `settings delete system screen_off_timeout`,
`settings get system screen_off_timeout`, `settings get global
stay_on_while_plugged_in`, and `getprop persist.traced.enable`. The original
timeout (`null`) and stay-on value (`0`) were restored; traced remained `0`.
