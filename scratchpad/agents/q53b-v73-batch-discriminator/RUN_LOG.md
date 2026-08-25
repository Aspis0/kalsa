# q53b RUN_LOG

Measurement cell: q53b-v73-batch-discriminator  
Locked pre-registration: commit 5e54cf8c  
Device: Galaxy S23, Hexagon v73  
Serial: adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp

## Start declarations

- PREREG.md for q53b and q53 were read before measurement actions.
- Device state at preflight: adb `device`; battery 95%; 29.6 °C; AC=false,
  USB=false, Wireless=false, Dock=false.
- q53b b512 cool-start declaration: 2026-08-25T03:12:23.073222Z, battery
  95%, 29.5 °C, unplugged.

## Immutable preflight

All device hashes matched the values recorded in q53 RUN_LOG.md; no mismatch
was observed.

| device path | sha256 | expected |
|---|---|---|
| `/data/local/tmp/kalsahtp/llama-bench` | `5db18906bfe159ba97da18404c513886a5b2a07ec715c18dda7a1bc2d6d38507` | MATCH |
| `/data/local/tmp/kalsahtp/libggml-hexagon.so` | `f06aa3098f63fd4f419d9943063a07a4718fc32832a919734d0094fccdea6448` | MATCH |
| `/data/local/tmp/kalsahtp/libggml-htp-v73.so` | `c8f9d14a388455ec364e99d4f63dbee773a4bad6de204b61496fe128f125edd5` | MATCH |
| `/data/local/tmp/LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf` | `38a93d7120ef217effba39e4490d341ce02a0ed04fef899d65b03c1322a1b13a` | MATCH |
| `/data/local/tmp/kalsahtp/Qwen3.5-4B-Q4_0.gguf` | `298fcb5fe7a77ccc79745ae24751560c5ac56874caff4bb39b1f2055bd72b8bb` | MATCH |
| `/data/local/tmp/wiki.test.raw` | `173c87a53759e0201f33e0ccf978e510c2042d7f2cb78229d9a50d79b9e7dd08` | MATCH |

`/data/local/tmp/kalsahtp/llama-perplexity` was present (7,560 B). The model
and corpus were not pushed.

## q53b b512 arm

- Command: `-b 512 -ub 512 -c 2048 --chunks 32 -ngl 99 -dev HTP0 -v`.
- Launch: `adb shell`; `BINARY_PID=14941`; `CPUSET=/`; launcher `RC=134`.
- Start: 2026-08-25T03:12:23.073222Z, battery 95%, 29.5 °C, unplugged.
- End: 2026-08-25T03:33:09.743753Z, battery 84%, 38.1 °C, unplugged.
- Finite chunk values completed: 9/32: 34.7892, 36.5029, 38.0736, 36.0812,
  34.8397, 29.4338, 28.4682, 28.5376, 29.6137.
- HTP execute-op lines in pulled raw log: 19,376.
- Frozen outcome: `DIES-512`; b1024 was not run.

Exact terminal error line:

`C:/Users/gualt/Desktop/Kalsa/moe-experiments/upstream-hexagon/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:1624: ggml-hex: HTP0 dspqueue_write failed: 0x00000001`

Exact backtrace:

```text
0: 0x719035566c
1: 0x7190355578 ggml_print_backtrace
2: 0x7190355864 ggml_abort
3: 0x719a982a28 _ZN20ggml_hexagon_session11flush_batchEv
4: 0x719a996470
5: 0x7190377930 ggml_backend_sched_graph_compute_async
6: 0x7191741d14 _ZN13llama_context13graph_computeEP11ggml_cgraphb
7: 0x7191741af8 _ZN13llama_context14process_ubatchERK12llama_ubatch14llm_graph_typeP22llama_memory_context_iR11ggml_status
8: 0x71917431b0 _ZN13llama_context6decodeERK11llama_batch
9: 0x719174bd84 llama_decode
10: 0x7194072a68
11: 0x7194069d08 _Z16llama_perplexityiPPc
12: 0x7190ee5664 __libc_init
```

## q53 lane 2 session 2 partial attempt

- HTP probe: `BINARY_PID=11993`, `CPUSET=/`, `RC=0`; start 84%, 34.7 °C,
  unplugged at 2026-08-25T03:36:15.791760Z; end 84%, 37.0 °C, unplugged at
  2026-08-25T03:37:09.657542Z.
- HTP PPL: `BINARY_PID=14265`, `CPUSET=/`; start 83%, 35.0 °C, unplugged at
  2026-08-25T03:38:42.198984Z. A live device-log capture reached chunks
  1–4/32: 7.9075, 9.4123, 9.8187, 9.9195. The serial went offline at
  2026-08-25T03:46:11.441006Z; launcher `adb_rc=255`; post snapshot and full
  remote log were unavailable. Pull record: `adb: error: failed to get
  feature set: device offline`.
- CPU-ref was not launched because the device was offline.
- Recovery attempts: `adb connect 192.168.1.152:43741` was retried; the phone
  continued to answer ping and advertise mDNS, but TCP 43741 actively refused
  connections. No retry arm was launched.
- Lane-2 session 2 status: incomplete; no r or gate is computed.

## Files

- q53b raw evidence: `raw/q53b_b512_htp_ppl.log`, its launcher/JSON/pull and
  battery records.
- q53 lane-2 partial live capture: `raw/lane2_s2_qwen_htp_ppl_live_capture.txt`.
