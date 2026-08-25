# q56 thermal watchdog — run log

Safety-critical session. Hard limits: no HTP/NPU workload, no perplexity, max 3 minutes per command/run, abort at battery temperature >= 38.0 C or level < 45%.

## Phase 0 — cooldown gate

- Start epoch (device): 1787631844; initial battery level: 56%; AC=false; USB=false; wireless=false; temperature=343 (34.3 C); health=2; voltage=3882 mV.
- mDNS endpoint: 192.168.1.152:41679; connected using adb serial `192.168.1.152:41679`.
- Cooldown samples (epoch,temp_tenths,level):
- 1787631844,343,56
- 1787631938,337,55 (AC=false, USB=false)
- 1787632059,329,55 (AC=false, USB=false)
- 1787632135,324,55 (AC=false, USB=false)
- 1787632209,321,55 (AC=false, USB=false)
- 1787632284,316,55 (AC=false, USB=false)
- 1787632356,314,55 (AC=false, USB=false)
- 1787632428,309,55 (AC=false, USB=false)
- 1787632500,307,55 (AC=false, USB=false)
- 1787632572,305,55 (AC=false, USB=false)
- 1787632645,302,55 (AC=false, USB=false)
- 1787632718,301,55 (AC=false, USB=false)
- 1787632793,299,55 (AC=false, USB=false) — cooldown gate reached (<=300).
- Cooldown elapsed from first sample: 949 s (15.8 min). No sample reached the 38.0 C or 45% abort limits.

## Phase 1 — pulled lane-2 evidence

- Pulled new device log `/data/local/tmp/q53_v73_npu_correctness/lane2_s2_qwen_htp_ppl.log` to `q53-v73-npu-correctness/raw/lane2_s2_qwen_htp_ppl.log` (75,675,653 B). Existing `lane2_s2_qwen_htp_probe.log` and `q53b_b512_htp_ppl.log` were already present in their local raw directories and were not overwritten.
- Pulled lane-2 session-2 log summary: chunk markers reach `[32]8.5179`; `Final estimate: PPL = 8.5179 +/- 0.12523`; no `dspqueue_write` line in the pulled log; the log contains HTP0 execute-op lines. This is evidence that the device-side log contains more completion data than the live capture saw before adb went offline.
- Last 30 lines of the pulled device log:

```text
35.26.562.221 D ggml-hex: HTP0 op-queue pop batch #8 : n-bufs 4 n-tensors 43 n-ops 28 : m-size 10120 b-size 96 t-size 2408 o-size 6272
35.26.564.181 D ggml-hex: HTP0 synchronize
36.00.558.733 D ggml-hex: HTP0 synchronize
[32]8.5179,
36.01.690.343 I Final estimate: PPL = 8.5179 +/- 0.12523

36.01.708.743 I llama_perf_context_print:        load time =    9693.79 ms
36.01.708.806 I llama_perf_context_print: prompt eval time = 1890137.66 ms / 65536 tokens (   28.84 ms per token,    34.67 tokens per second)
36.01.708.823 I llama_perf_context_print:        eval time =       0.00 ms /     1 runs   (    0.00 ms per token,      inf tokens per second)
36.01.708.835 I llama_perf_context_print:        total time = 1993191.00 ms / 65537 tokens
36.01.708.846 I llama_perf_context_print:    graphs reused =          0
36.01.712.234 I common_memory_breakdown_print: | memory breakdown [MiB] | total   free    self   model   context   compute    unaccounted |
36.01.712.304 I common_memory_breakdown_print: |   - HTP0 (Hexagon)     |     0 =    0 + (1787 =  1787 +       0 +       0) +       -1787 |
36.01.712.333 I common_memory_breakdown_print: |   - Host               |                 1727 =   500 +     114 +    1112               
36.01.712.347 I common_memory_breakdown_print: |   - CPU_REPACK         |                  662 =   662 +       0 +       0                
36.01.715.071 D ggml-hex: HTP0 synchronize
36.01.715.153 D ~llama_context:       HTP0 compute buffer size is 132.0392 MiB, matches expectation of 132.0392 MiB
36.01.715.170 D ~llama_context:        CPU compute buffer size is 980.0039 MiB, matches expectation of 980.0039 MiB
36.01.926.693 D ggml-hex: HTP0 unmapped buffer: base 0x6f71b3a000 size 138453120 fd 22
36.01.927.165 D ggml-hex: HTP0 freed buffer: base 0x6f71b3a000 size 138453120 fd -1
36.02.554.990 D ggml-hex: HTP0 unmapped buffer: base 0x6fd9f45000 size 52695040 fd 21
36.02.555.208 D ggml-hex: HTP0 freed buffer: base 0x6fd9f45000 size 52695040 fd -1
36.02.556.543 D ggml-hex: HTP0 unmapped buffer: base 0x6fdd186000 size 67112960 fd 17
36.02.556.778 D ggml-hex: HTP0 freed buffer: base 0x6fdd186000 size 67112960 fd -1
36.02.558.094 D ggml-hex: HTP0 unmapped buffer: base 0x7010d37000 size 1073145856 fd 19
36.02.561.331 D ggml-hex: HTP0 freed buffer: base 0x7010d37000 size 1073145856 fd -1
36.02.562.849 D ggml-hex: HTP0 unmapped buffer: base 0x6fe1187000 size 800782336 fd 20
36.02.565.678 D ggml-hex: HTP0 freed buffer: base 0x6fe1187000 size 800782336 fd -1
36.02.567.114 D ggml-hex: HTP0 unmapped buffer: base 0x70e8654000 size 3850240 fd 18
36.02.567.306 D ggml-hex: HTP0 freed buffer: base 0x70e8654000 size 3850240 fd -1
```

## Phase 1 — integrity

- Small-file hashes at device epoch 1787633100: all matched RUN_LOG.md values.
  - `/data/local/tmp/kalsahtp/llama-bench`: `5db18906bfe159ba97da18404c513886a5b2a07ec715c18dda7a1bc2d6d38507` — MATCH.
  - `/data/local/tmp/kalsahtp/libggml-hexagon.so`: `f06aa3098f63fd4f419d9943063a07a4718fc32832a919734d0094fccdea6448` — MATCH.
  - `/data/local/tmp/kalsahtp/libggml-htp-v73.so`: `c8f9d14a388455ec364e99d4f63dbee773a4bad6de204b61496fe128f125edd5` — MATCH.
  - `/data/local/tmp/kalsahtp/llama-perplexity`: `4aef69d7b032db4fea15d5fab86041328c2180b0086f74656c319d9331f7ba50` — MATCH.
  - `/data/local/tmp/wiki.test.raw`: `173c87a53759e0201f33e0ccf978e510c2042d7f2cb78229d9a50d79b9e7dd08` — MATCH.
- Temperature immediately after small-file hashes: dumpsys `294` (29.4 C); battery-zone94 `29400`; level 55%; AC=false; USB=false.
- Large-file hash 1 at 29.4 C start: `/data/local/tmp/LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf` = `38a93d7120ef217effba39e4490d341ce02a0ed04fef899d65b03c1322a1b13a` — MATCH.
- Required temperature sample between large hashes: device epoch 1787633129; battery-zone94 `29300` (29.3 C); dumpsys `293`; level 55%; AC=false; USB=false.
- Large-file hash 2 after the intervening sample: `/data/local/tmp/kalsahtp/Qwen3.5-4B-Q4_0.gguf` = `298fcb5fe7a77ccc79745ae24751560c5ac56874caff4bb39b1f2055bd72b8bb` — MATCH.
- Integrity result: all five small files and both large GGUFs match the recorded values; no mismatch.
- Pre-test-1 safety sample at epoch 1787633501: dumpsys `286` (28.6 C), battery-zone94 `28600`, level 54%, AC=false, USB=false. Test-1 kill threshold selected as `281` tenths (current minus 0.5 C, rounded down); warn threshold also `281`; interval 1 s; max run 120 s.
- Test 1 (`test1_kill`) completed in 2.031 s: `BINARY_PID=25380`, `CPUSET=/`, guard log `1787633525,286,54` then `WARN` then `KILLED`; guard exit `2`; workload rc `137`; max temperature `286` (28.6 C); no `execute-op.*HTP0` in stderr; all three pulled logs succeeded. Test 1 PASS.
- Inter-test cooldown gate: immediately after Test 1, dumpsys temperature `286` (28.6 C), level 54%; already <=32.0 C and >=45%, unplugged. Proceeded to Test 2.
- Test 2 (`test2_pass`) completed in 23.270 s: `BINARY_PID=25431`, `CPUSET=/`, workload rc `0`, guard exit `0`, guard log ended `1787633577,295,54,MAX`; max temperature `295` (29.5 C); no `execute-op.*HTP0` in stderr; two jsonl rows were pulled and include `n_gpu_layers=0`, `devices=auto`; all three pulls succeeded. Test 2 PASS.
- Test-2 final health sample: dumpsys `295` (29.5 C), level 54%, health=2, AC=false, USB=false, voltage=3757 mV.
- Final residue check: no `llama-bench` or `thermal_guard` processes matched `ps -A`; final battery-zone94 `28800` (28.8 C), dumpsys `288`, level 54%, AC=false, USB=false. No temperature sample reached 380 or level 45.

## Phase 2 — watchdog deliverable and validation

- Local files: `thermal_guard.sh`, `launch_with_guard.py`; local Python and POSIX `sh -n` checks passed.
- `thermal_guard.sh` local SHA256 = `af2819af183e64f447680e7e5058fa8da1f4237fbe65548e427b55e98edab3e2`; device SHA256 = same; `exec-out head -c 200 ... | od -c` showed LF (`\\n`) and no CR (`\\r`).
- Device install: `/data/local/tmp/q56_thermal_watchdog/thermal_guard.sh`, mode 755. No device deletion, model push, charging-state change, BigMoeOnEdge access, or git operation.
- Exact production invocation used for Test 2 (CPU-only offload proof):

```text
python scratchpad\\agents\\q56-thermal-watchdog\\launch_with_guard.py --serial 192.168.1.152:41679 --tag future_cell --warn-tenths 400 --kill-tenths 430 --interval-s 10 --max-seconds 120 --local-dir scratchpad\\agents\\q56-thermal-watchdog\\raw -- /data/local/tmp/kalsahtp/llama-bench -m /data/local/tmp/LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf -p 64 -n 16 -r 1 --no-warmup -t 8 -o jsonl -ngl 0 --load-mode none -fa on --ubatch-size 1024
```
- Session hard cutoff remains 380 tenths; production 430-tenth kill value is retained as the caller value but cannot override the 38.0 C safety limit.
