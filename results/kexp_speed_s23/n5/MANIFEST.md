# KEXP N>=5 queue #18 MANIFEST

Lock commit: `618323c77e45d275746b1aa5df023a0cc6bc6056` (`618323c`). Protocol v1.2.
Date: 2026-08-22T01:41:42.1749170-04:00
Serial: `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`

## Pins (on-device, verified at session start; NOT pushed this session)

| artifact | sha256 |
|---|---|
| libllama-bench-impl.so | 8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807 |
| libggml-opencl.so | f432548328af0429fd0f885ccde70cae69f40666118836c713491602dedd6d6d |
| llama-bench stub | b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c |
| LFM2.5-8B-A1B-KEXP.gguf | b07c80870f8a864549f4a419ccbfb4d4282ba2d55a2e8d808b7c377d3fc6c3f4 |

Stock extra_bufts `bad179520546f8d5316cd98124e948d025e8acb2999bf92b94977879ce72c171` is **forbidden** on A/B/C. Optional arm D uses a **separate** dir `/data/local/tmp/s18stock`.

Flags: A `-ngl 99`, B `-ngl 99 -ncmoe 99`, C `-ngl 0`; ALL `-nr -fa off -t 4`; tg512 `-p 0 -n 512 -r 1 -o jsonl`.
Block: ABC-CBA. Cooldown 35.0C / 10 min warm-start. Battery floor 40% pauses under `results/kexp_speed_s23/pauses/`.
Cell cap 10 min = exclude/wait; 15 min = STOP. NEVER SIGTERM. MemAvailable drop >= 2.0 GB / rc!=0 / adb 255 / power-off = abort A/B/C.
