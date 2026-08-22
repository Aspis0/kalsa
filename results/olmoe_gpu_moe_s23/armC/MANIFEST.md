# OLMoE arm C -- queue #20 MANIFEST

**DECISION CELL, exploratory-registered, not a prereg ship claim.**
Run with full #18 gate discipline (cooldown 35.0 C / 10 min warm-start, unplug per block, Awake per cell with wake_post check, no SIGTERM, 10-min cap = exclude/wait, raw probes archived, no full dumpsys dumps, sha on-device before cells, medians full-precision).

Date: 2026-08-22T11:05:39.1117339-04:00
Serial: `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`
Protocol: `armC-exploratory-gates-v1.2`
git HEAD: `b8e55a92985d87da5d23a048810564f7c79c2559`

## THIS IS THE HEAD BUILD, NOT the old OLMoE-N5 pin

The confirmatory OLMoE N>=5 ship cell (queue 2d-i, SHIP 1.553x A/B) used opencl `2ed2e48a...` which is **no longer extant**. This session uses the **currently deployed verified set** in `/data/local/tmp/s3oracle` (engine head, device-verified MUL_MAT_ID 407/407). Arm A is therefore **RE-MEASURED in-session**. Never compare C against the old session's A numbers, only within-session A vs C.

| artifact | sha256 | note |
|---|---|---|
| libllama-bench-impl.so | 8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807 | HEAD; `-nr` mandatory |
| libggml-opencl.so | f432548328af0429fd0f885ccde70cae69f40666118836c713491602dedd6d6d | HEAD (kalsakernel-v4 + #26476 + barrier-safe); NOT 2ed2e48a |
| llama-bench stub | b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c | unchanged |
| OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf | 3bd9ec48045f526508956ef663c5c11dbb3ef791a06f4e10a6be88379c40e1fe | on-device path `/data/local/tmp/s3oracle/OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf` |

Stock extra_bufts `bad179520546f8d5316cd98124e948d025e8acb2999bf92b94977879ce72c171` is **forbidden**. No rebuild / no redeploy this session.

Flags: A `-ngl 16` (same ngl as the OLMoE ship cell), C `-ngl 0`; BOTH `-nr -fa off -t 4`; tg512 `-p 0 -n 512 -r 1 -o jsonl`.
Block: palindrome A,C,C,A x 3 (12 cells). Cooldown 35.0C / 10 min warm-start. **Battery floor 40% at block start = SESSION END** (nobody available to plug; no recharge pause). Finish a running block, then stop.
Cell cap 10 min = exclude/wait; 15 min = STOP. NEVER SIGTERM. MemAvailable drop >= 2.0 GB / rc!=0 / adb 255 / power-off = abort.
wake_post != Awake -> exclude cell, drop incomplete block.
