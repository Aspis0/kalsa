# S23 day-1 approved execution log

Date: 2026-08-26. Device: `adb-R3CW406P8CV-zyLM4b (2)._adb-tls-connect._tcp` (exact mDNS serial from `adb devices -l`). Xiaomi and Jelly were not touched. No `adb connect` was used.

Owner approval: delete DROP_CHAIN items #3–#13, preserving the two Marco files #1/#2 and all documented KEEP exceptions; then push the two approved models and run correctness only if battery >=40%.

## Pre-delete checks

`df -h /data` before:

```text
Filesystem       Size Used Avail Use% Mounted on
/dev/block/dm-60 104G  96G  7.9G  93% /data/user/0
```

Battery before: AC=false, USB=false, Wireless=false, status=3, level=95%, temperature=25.2 °C. Device was online.

Q53 PC-copy gate: `scratchpad/agents/q53-v73-npu-correctness/raw/` contained the q53 logs already; missing `lane2_qwen_htp_ppl.log` (1,219 B, SHA `5d0e6972f2c4a94dbc983b0d01bd192d280bf9d53064d4ccc4e70029e1659c46`) and `q53b_b512_htp_ppl.log` (27,936,049 B, SHA `a48da542c5b556a097f04d792aa7c2a93beb99fe23d32950cb716972e36b0e34`) were pulled before deletion. The other q53 log copies matched the device inventory by size+SHA.

## Deletion log

Every approved device `rm` will be recorded below as `rm <path> | size=<bytes> | result=<rc>`. KEEP exceptions are not listed as deletes and must remain.

+rm /data/local/tmp/bmoe/abba_run.log | size=1380 | rc=0
rm /data/local/tmp/bmoe/abba_s23_aborted.csv | size=353 | rc=0
rm /data/local/tmp/bmoe/abba.csv | size=614 | rc=0
rm /data/local/tmp/bmoe/abba.sh | size=3870 | rc=0
rm /data/local/tmp/bmoe/abba/b1_1_A.log | size=38575 | rc=0
rm /data/local/tmp/bmoe/abba/b1_2_B.log | size=38412 | rc=0
rm /data/local/tmp/bmoe/abba/b1_3_B.log | size=38412 | rc=0
rm /data/local/tmp/bmoe/abba/b1_4_A.log | size=38576 | rc=0
rm /data/local/tmp/bmoe/abba/b2_1_A.log | size=38576 | rc=0
rm /data/local/tmp/bmoe/abba/b2_2_B.log | size=38410 | rc=0
rm /data/local/tmp/bmoe/abba/b2_3_B.log | size=38412 | rc=0
rm /data/local/tmp/bmoe/abba/b2_4_A.log | size=38576 | rc=0
rm /data/local/tmp/bmoe/abba/b3_1_A.log | size=38576 | rc=0
rm /data/local/tmp/bmoe/abba/b3_2_B.log | size=38412 | rc=0
rm /data/local/tmp/bmoe/abba/b3_3_B.log | size=38414 | rc=0
rm /data/local/tmp/bmoe/abba/b3_4_A.log | size=38578 | rc=0
rm /data/local/tmp/bmoe/bmoe-cli | size=6242576 | rc=0
rm /data/local/tmp/bmoe/libggml-base.so | size=7862440 | rc=0
rm /data/local/tmp/bmoe/libggml-cpu.so | size=4807968 | rc=0
rm /data/local/tmp/bmoe/libggml.so | size=4923416 | rc=0
rm /data/local/tmp/bmoe/libllama-common.so | size=65995304 | rc=0
rm /data/local/tmp/bmoe/libllama.so | size=34484400 | rc=0
rm /data/local/tmp/bmoe/s23_mmap.log | size=37672 | rc=0
rm /data/local/tmp/k22/mm.log | size=164981 | rc=0
rm /data/local/tmp/k22/mmid.log | size=114976 | rc=0
rm /data/local/tmp/k22/test-backend-ops | size=24993672 | rc=0
rm /data/local/tmp/k2ref/test-backend-ops | size=25075528 | rc=0
rm /data/local/tmp/kalsahtp_f2b/libggml-base.so | size=6655536 | rc=0
rm /data/local/tmp/kalsahtp_f2b/libggml-cpu.so | size=4799376 | rc=0
rm /data/local/tmp/kalsahtp_f2b/libggml-hexagon.so | size=3547016 | rc=0
rm /data/local/tmp/kalsahtp_f2b/libggml-htp-v73.so | size=645192 | rc=0
rm /data/local/tmp/kalsahtp_f2b/libggml.so | size=631352 | rc=0
rm /data/local/tmp/kalsahtp_f2b/libllama-bench-impl.so | size=4351368 | rc=0
rm /data/local/tmp/kalsahtp_f2b/libllama-common.so | size=75971424 | rc=0
rm /data/local/tmp/kalsahtp_f2b/libllama.so | size=43253832 | rc=0
rm /data/local/tmp/kalsahtp_f2b/llama-bench | size=7592 | rc=0
rm /data/local/tmp/kalsahtp/libggml-base.so | size=6144224 | rc=0
rm /data/local/tmp/kalsahtp/libggml-cpu.so | size=4230312 | rc=0
rm /data/local/tmp/kalsahtp/libggml-hexagon.so | size=3392064 | rc=0
rm /data/local/tmp/kalsahtp/libggml-htp-v73.so | size=645192 | rc=0
rm /data/local/tmp/kalsahtp/libggml.so | size=601568 | rc=0
rm /data/local/tmp/kalsahtp/libllama-bench-impl.so | size=4215304 | rc=0
rm /data/local/tmp/kalsahtp/libllama-common.so | size=68158328 | rc=0
rm /data/local/tmp/kalsahtp/libllama-perplexity-impl.so | size=1870368 | rc=0
rm /data/local/tmp/kalsahtp/libllama.so | size=37429104 | rc=0
rm /data/local/tmp/kalsahtp/llama-bench | size=7536 | rc=0
rm /data/local/tmp/kalsahtp/llama-gguf | size=192552 | rc=0
rm /data/local/tmp/kalsahtp/llama-gguf-hash | size=309208 | rc=0
rm /data/local/tmp/kalsahtp/llama-perplexity | size=7560 | rc=0
rm /data/local/tmp/kalsahtp/logs/bench_cpu.err | size=781 | rc=0
rm /data/local/tmp/kalsahtp/logs/bench_cpu.meta | size=281 | rc=0
rm /data/local/tmp/kalsahtp/logs/bench_cpu.out | size=983 | rc=0
rm /data/local/tmp/kalsahtp/logs/bench_cpu.rc | size=2 | rc=0
rm /data/local/tmp/kalsahtp/logs/bench_htp.err | size=781 | rc=0
rm /data/local/tmp/kalsahtp/logs/bench_htp.meta | size=388 | rc=0
rm /data/local/tmp/kalsahtp/logs/bench_htp.out | size=978 | rc=0
rm /data/local/tmp/kalsahtp/logs/bench_htp.rc | size=2 | rc=0
rm /data/local/tmp/kalsahtp/logs/bench_proof.err | size=1039 | rc=0
rm /data/local/tmp/kalsahtp/logs/bench_proof.meta | size=361 | rc=0
rm /data/local/tmp/kalsahtp/logs/bench_proof.out | size=928 | rc=0
rm /data/local/tmp/kalsahtp/logs/bench_proof.rc | size=2 | rc=0
rm /data/local/tmp/kalsahtp/logs/bench_proof2.err | size=1039 | rc=0
rm /data/local/tmp/kalsahtp/logs/bench_proof2.meta | size=392 | rc=0
rm /data/local/tmp/kalsahtp/logs/bench_proof2.out | size=929 | rc=0
rm /data/local/tmp/kalsahtp/logs/bench_proof2.rc | size=2 | rc=0
rm /data/local/tmp/kalsahtp/logs/bench_proof3.err | size=4160699 | rc=0
rm /data/local/tmp/kalsahtp/logs/bench_proof3.meta | size=398 | rc=0
rm /data/local/tmp/kalsahtp/logs/bench_proof3.out | size=545 | rc=0
rm /data/local/tmp/kalsahtp/logs/bench_proof3.rc | size=2 | rc=0
rm /data/local/tmp/kalsahtp/logs/run1.err | size=381112 | rc=0
rm /data/local/tmp/kalsahtp/logs/run1.meta | size=258 | rc=0
rm /data/local/tmp/kalsahtp/logs/run1.out | size=9082 | rc=0
rm /data/local/tmp/kalsahtp/logs/run1.rc | size=2 | rc=0
rm /data/local/tmp/kalsahtp/logs/run2.err | size=3205366 | rc=0
rm /data/local/tmp/kalsahtp/logs/run2.meta | size=262 | rc=0
rm /data/local/tmp/kalsahtp/logs/run2.out | size=210175 | rc=0
rm /data/local/tmp/kalsahtp/logs/run2.rc | size=2 | rc=0
rm /data/local/tmp/kalsahtp/logs/runA.err | size=4555568 | rc=0
rm /data/local/tmp/kalsahtp/logs/runA.meta | size=107 | rc=0
rm /data/local/tmp/kalsahtp/logs/runA.out | size=545 | rc=0
rm /data/local/tmp/kalsahtp/logs/runA.rc | size=2 | rc=0
rm /data/local/tmp/kalsahtp/logs/runB.err | size=4555569 | rc=0
rm /data/local/tmp/kalsahtp/logs/runB.meta | size=108 | rc=0
rm /data/local/tmp/kalsahtp/logs/runB.out | size=524 | rc=0
rm /data/local/tmp/kalsahtp/logs/runB.rc | size=2 | rc=0
rm /data/local/tmp/kalsahtp/Qwen3.5-4B-Q4_0.gguf | size=2583221408 | rc=0
rm /data/local/tmp/kalsahtp/run_bench_cpu.sh | size=954 | rc=0
rm /data/local/tmp/kalsahtp/run_bench_htp.sh | size=1237 | rc=0
rm /data/local/tmp/kalsahtp/run_htp.sh | size=901 | rc=0
rm /data/local/tmp/kalsahtp/test-backend-ops | size=10513672 | rc=0
rm /data/local/tmp/LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf | size=3580407296 | rc=0
rm /data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf | size=3326160384 | rc=0
rm /data/local/tmp/OLMoE-1B-7B-0924-Instruct-Q4_0.gguf | size=3928037856 | rc=0
rm /data/local/tmp/q53_v73_npu_correctness/lane1_lfm_cpuref_ppl.log | size=1454 | rc=0
rm /data/local/tmp/q53_v73_npu_correctness/lane1_lfm_htp_ppl.log | size=1783 | rc=0
rm /data/local/tmp/q53_v73_npu_correctness/lane1_lfm_htp_probe.log | size=6419742 | rc=0
rm /data/local/tmp/q53_v73_npu_correctness/lane2_qwen_htp_ppl.log | size=1219 | rc=0
rm /data/local/tmp/q53_v73_npu_correctness/lane2_qwen_htp_probe.log | size=10463161 | rc=0
rm /data/local/tmp/q53_v73_npu_correctness/lane2_s2_qwen_htp_ppl.log | size=76575653 | rc=0
rm /data/local/tmp/q53_v73_npu_correctness/lane2_s2_qwen_htp_probe.log | size=10463161 | rc=0
rm /data/local/tmp/q53_v73_npu_correctness/q53b_b512_htp_ppl.log | size=27936049 | rc=0
rm /data/local/tmp/s15vk/libggml-base.so | size=6103488 | rc=0
rm /data/local/tmp/s15vk/libggml-cpu.so | size=5165048 | rc=0
rm /data/local/tmp/s15vk/libggml-vulkan.so | size=47011288 | rc=0
rm /data/local/tmp/s15vk/libggml.so | size=537112 | rc=0
rm /data/local/tmp/s15vk/libllama-bench-impl.so | size=4253152 | rc=0
rm /data/local/tmp/s15vk/libllama-common.so | size=78377224 | rc=0
rm /data/local/tmp/s15vk/libllama.so | size=39807616 | rc=0
rm /data/local/tmp/s15vk/llama-bench | size=7592 | rc=0
rm /data/local/tmp/s15vk/logs/vk_bench_olmoe_n8.err | size=1140 | rc=0
rm /data/local/tmp/s15vk/logs/vk_bench_olmoe_n8.out | size=1232 | rc=0
rm /data/local/tmp/s15vk/logs/vk_bench_olmoe_n8.rc | size=4 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mm_f16.err | size=222 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mm_f16.out | size=30441 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mm_f16.rc | size=2 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mm_q4k.err | size=855 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mm_q4k.out | size=1259 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mm_q4k.rc | size=4 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mm_support.err | size=222 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mm_support.out | size=169824 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mm_support.rc | size=2 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mmid_q2k_id.err | size=875 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mmid_q2k_id.out | size=1267 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mmid_q2k_id.rc | size=4 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mmid_q2k.err | size=869 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mmid_q2k.out | size=25263 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mmid_q2k.rc | size=4 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mmid_q3k_id.err | size=875 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mmid_q3k_id.out | size=1267 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mmid_q3k_id.rc | size=4 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mmid_q3k.err | size=869 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mmid_q3k.out | size=25263 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mmid_q3k.rc | size=4 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mmid_q4k.err | size=875 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mmid_q4k.out | size=1264 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mmid_q4k.rc | size=4 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mmid_support.err | size=222 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mmid_support.out | size=80512 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mmid_support.rc | size=2 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mmid.err | size=875 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mmid.out | size=2350 | rc=0
rm /data/local/tmp/s15vk/logs/vk_mmid.rc | size=4 | rc=0
rm /data/local/tmp/s15vk/one_cell_vk.sh | size=477 | rc=0
rm /data/local/tmp/s15vk/run_vk_ops.sh | size=911 | rc=0
rm /data/local/tmp/s15vk/test-backend-ops | size=10182432 | rc=0
rm /data/local/tmp/s3base/libggml-base.so | size=6103504 | rc=0
rm /data/local/tmp/s3base/libggml-cpu.so | size=5165056 | rc=0
rm /data/local/tmp/s3base/libggml-opencl.so | size=7430256 | rc=0
rm /data/local/tmp/s3base/libggml.so | size=536872 | rc=0
rm /data/local/tmp/s3base/libllama-common.so | size=78377232 | rc=0
rm /data/local/tmp/s3base/libllama.so | size=39807624 | rc=0
rm /data/local/tmp/s3base/test-backend-ops | size=10165800 | rc=0
rm /data/local/tmp/s3fix/libggml-base.so | size=6103504 | rc=0
rm /data/local/tmp/s3fix/libggml-cpu.so | size=5165056 | rc=0
rm /data/local/tmp/s3fix/libggml-opencl.so | size=7429104 | rc=0
rm /data/local/tmp/s3fix/libggml.so | size=536872 | rc=0
rm /data/local/tmp/s3fix/libllama-common.so | size=78377232 | rc=0
rm /data/local/tmp/s3fix/libllama.so | size=39807616 | rc=0
rm /data/local/tmp/s3fix/test-backend-ops | size=10165792 | rc=0
rm /data/local/tmp/s3printf/libggml-base.so | size=6103512 | rc=0
rm /data/local/tmp/s3printf/libggml-cpu.so | size=5165056 | rc=0
rm /data/local/tmp/s3printf/libggml-opencl.so | size=7503528 | rc=0
rm /data/local/tmp/s3printf/libggml.so | size=536880 | rc=0
rm /data/local/tmp/s3printf/libllama-common.so | size=78377240 | rc=0
rm /data/local/tmp/s3printf/libllama.so | size=39807624 | rc=0
rm /data/local/tmp/s3printf/test-backend-ops | size=10165800 | rc=0

Deletion result: 166/166 `rm` calls returned rc=0; logged bytes removed: 14,654,157,612. KEEP checks passed for both Marco files, `s3oracle/`, `q56_thermal_watchdog/`, Termux APK, `_gguf_keep`, and the preserved exact `libc++_shared.so`/`libomp.so` files.

`df -h /data` after deletion, before model push:

```text
Filesystem       Size Used Avail Use% Mounted on
/dev/block/dm-60 104G  82G   22G  80% /data/user/0
```

## Models pushed and verified

Both pushes used the exact requested filenames under `/data/local/tmp/`; PC SHA-256 equals device SHA-256:

| file | bytes | PC SHA-256 = device SHA-256 |
|---|---:|---|
| `/data/local/tmp/OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf` | 4,213,513,024 | `3bd9ec48045f526508956ef663c5c11dbb3ef791a06f4e10a6be88379c40e1fe` |
| `/data/local/tmp/Marco-Mini-Instruct-KEXP.gguf` | 6,385,238,848 | `2f921958540115384879eff2eeabfc7087597b245d32b0f515d9ce7b7414d777` |

`df -h /data` after model pushes and after correctness certification:

```text
Filesystem       Size Used Avail Use% Mounted on
/dev/block/dm-60 104G  92G   12G  89% /data/user/0
```

## Functional certification

Battery was 93% and unplugged at the gate, so certification ran. Under `/data/local/tmp/thermal_guard.sh` with WARN/KILL 40/43 °C, poll 10 s, and CPU mask `ff` (cpuset 0-7):

- `./test-backend-ops -o MUL_MAT_ID`: **407/407**, rc 0, guard rc 0.
- `./test-backend-ops -o MUL_MAT`: **925/925**, rc 0, guard rc 0.
- Roundtrip: skipped; no roundtrip executable existed in the preserved `s3oracle` set.
- No benchmark or model load was run. Raw evidence is under `raw/cert/s23_day1_cert/`.
